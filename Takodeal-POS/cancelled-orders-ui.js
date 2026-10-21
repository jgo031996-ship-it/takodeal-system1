import {createCancelledOrderEngine,CANCELLATION_REASONS,cancelledPlatform,findCancelledFoodBuyer} from './cancelled-orders.js';
import {createCancelledFoodOperationId,quoteCancelledFoodPortion,MAX_CANCELLED_FOOD_LINES} from './cancelled-food-portions.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cancelledFoodPortionForm(offer){
    const detail=item=>[item.variantName,item.notes,...Object.entries(item.addons||{}).filter(([,addon])=>Number(addon.qty)>0).map(([key,addon])=>`Original line extras (${item.qty} item${item.qty===1?'':'s'}): ${addon.qty}× ${addon.name||key}`)].filter(Boolean).join(' · ');
    return `<div class="cancelled-food-form"><p>Original ${esc(offer.platform)} receipt <strong>${esc(offer.sourceReceiptId)}</strong></p><p>Choose only the items this employee will take. Other staff can buy the remaining food separately. Select up to ${MAX_CANCELLED_FOOD_LINES} receipt lines per purchase.</p><div class="cancelled-food-items">${offer.lines.map(line=>`<div class="cancelled-food-item"><div><strong>${esc(line.item.name||line.item.itemName)}</strong><small>Receipt line ${line.lineIndex+1}${detail(line.item)?' · '+esc(detail(line.item)):''}</small><small>${line.remainingQty} of ${line.originalQty} remaining${line.purchasedQty?' · '+line.purchasedQty+' already assigned':''}</small></div><label for="cancelledFoodQty${line.lineIndex}">Take<input id="cancelledFoodQty${line.lineIndex}" data-cancelled-food-qty="${line.lineIndex}" type="number" inputmode="numeric" min="0" max="${line.remainingQty}" step="1" value="0"${line.remainingQty?'':' disabled'} aria-label="Quantity of ${esc(line.item.name||line.item.itemName)}, receipt line ${line.lineIndex+1}"></label></div>`).join('')}</div><p id="cancelledFoodSelectionStatus" role="status">Choose quantities to see this employee’s deduction.</p><dl><div><dt>Selected food price</dt><dd id="cancelledFoodBase">₱0.00</dd></div><div><dt>Cancelled-order discount (${offer.discountPct}%)</dt><dd id="cancelledFoodDiscount">−₱0.00</dd></div><div><dt>This employee’s Foods deduction</dt><dd><strong id="cancelledFoodAmount">₱0.00</strong></dd></div></dl><p class="cancelled-food-price-note">Prices use the original receipt’s item totals. Any cent rounding is shared across the original quantities. This purchase does not use the daily staff meal allowance.</p><label for="cancelledFoodPin">Employee login PIN<input id="cancelledFoodPin" type="password" inputmode="numeric" autocomplete="off" minlength="4" aria-describedby="cancelledFoodPinHelp"></label><p id="cancelledFoodPinHelp">Use the registered login PIN for an active crew member or manager. The private Pay PIN is different.</p><label class="cancelled-food-consent"><input id="cancelledFoodConsent" type="checkbox">The staff member agrees to the selected items and displayed salary deduction.</label></div>`;
}
export function installCancelledOrders(api,{window:w=window,document:d=document}={}){
    let busy=false;
    const valid=input=>Boolean(input.authUid&&api.auth?.currentUser?.uid===input.authUid&&w.sessionUser===input.sessionRef&&w.currentShift===input.shiftRef&&w.sessionUser?.branch===input.branch&&w.currentShift?.shiftId===input.shiftId&&w.currentShift?.active&&w.sessionUser?.cashierName===input.cashier);
    const engine=createCancelledOrderEngine(api,{sessionCheck:valid});
    const context=value=>({sourceSaleId:decodeURIComponent(value),branch:w.sessionUser?.branch,shiftId:w.currentShift?.shiftId,cashier:w.sessionUser?.cashierName,authUid:api.auth?.currentUser?.uid,sessionRef:w.sessionUser,shiftRef:w.currentShift});
    const read=async(source,field,value)=>{const snap=await api.getDocsFromServer(api.query(api.collection(api.db,source),api.where(field,'==',value)));return snap.docs.map(row=>({id:row.id,data:row.data()}));};
    async function device(){const id=w.localStorage?.getItem('takodeal_device_id');if(id&&(await read('pos_devices','deviceId',id)).some(row=>String(row.data.status||'').toLowerCase()==='blocked'))throw Error('This device is blocked. Ask HQ to review access.');}
    const refresh=()=>w.refreshVisibleShiftSales?.()||w.loadSalesDashboard?.();
    w.preparedCancellationActions=tx=>{
        const id=tx.id||tx.saleId;if(!id||tx.isPendingSync||tx.needsReconciliation||!cancelledPlatform(tx)||tx.cancelledFoodSourceId||tx.status==='Parked')return '';
        const key=esc(encodeURIComponent(id));
        if(tx.preparedCancellation){const total=(tx.cart||[]).reduce((sum,item)=>sum+Number(item.qty||0),0);return tx.cancelledFoodPurchaseId||total>0&&tx.cancelledFoodPurchasedUnits>=total?'<div class="action-item" aria-disabled="true">All prepared food assigned</div>':`<div class="action-item" onclick="window.purchaseCancelledFood('${key}')">Choose cancelled food items${tx.cancelledFoodPurchasedUnits?' · remaining food':''}</div>`;}
        return tx.status==='Voided'?'':`<div class="action-item" onclick="window.cancelPreparedOrder('${key}')">Cancelled order</div>`;
    };
    w.purchaseCancelledFood=async(value)=>{
        if(busy)return;busy=true;
        const input=context(value);
        try{
            if(!valid(input))throw Error('Sign in on an approved Cashier device and open a shift first.');
            const pendingKey='takodeal_cancelled_food_pending_v1:'+JSON.stringify([input.branch,input.shiftId,input.sourceSaleId]);
            const removePending=()=>w.localStorage.removeItem(pendingKey);
            let pending=null;try{const saved=w.localStorage.getItem(pendingKey);if(saved){pending=JSON.parse(saved);if(pending.quote?.portionVersion!==1||pending.quote.sourceSaleId!==input.sourceSaleId||pending.quote.branch!==input.branch||pending.quote.shiftId!==input.shiftId||!pending.staffId||!pending.staffName)throw Error();}}catch{throw Error('This device’s saved purchase reference needs HQ review before another charge.');}
            await device();
            if(pending){const saved=await engine.confirmPortion({...input,...pending});if(saved){removePending();refresh();await w.Swal.fire({title:'Staff purchase already recorded',text:`The previous confirmation is saved once: ₱${saved.amount.toFixed(2)}. No second deduction was created.`,icon:'success'});return;}}
            const offer=await engine.available(input);if(!offer.lines.some(line=>line.remainingQty>0))throw Error('All items on this receipt have already been assigned to staff.');
            const operationId=pending?.quote.operationId??createCancelledFoodOperationId(w.crypto??globalThis.crypto);let purchaseIntent=pending?JSON.stringify({staffId:pending.staffId,quote:pending.quote}):null;
            const quantities=()=>Array.from(d.querySelectorAll('[data-cancelled-food-qty]')).map(node=>({lineIndex:Number(node.dataset.cancelledFoodQty),qty:Number(node.value)})).filter(row=>row.qty!==0);
            const liveQuote=()=>pending?.quote??quoteCancelledFoodPortion(offer,quantities(),operationId);
            const renderTotal=()=>{const consent=d.getElementById('cancelledFoodConsent');if(consent)consent.checked=false;try{const quote=liveQuote();for(const [id,value]of[['cancelledFoodBase',quote.baseAmount],['cancelledFoodDiscount',quote.discountAmount],['cancelledFoodAmount',quote.amount]]){const node=d.getElementById(id);if(node)node.textContent=(id==='cancelledFoodDiscount'?'−':'')+'₱'+value.toFixed(2);}const status=d.getElementById('cancelledFoodSelectionStatus');if(status)status.textContent=quote.selection.reduce((sum,row)=>sum+row.qty,0)+' item(s) selected for this employee.';}catch(error){const status=d.getElementById('cancelledFoodSelectionStatus');if(status)status.textContent=error.message;}};
            const result=await w.Swal.fire({title:'Staff purchase of prepared food',html:cancelledFoodPortionForm(offer),didOpen:()=>{d.querySelectorAll('[data-cancelled-food-qty]').forEach(node=>{if(pending){node.value=String(pending.quote.selection.find(row=>row.lineIndex===Number(node.dataset.cancelledFoodQty))?.qty??0);node.disabled=true;}else node.addEventListener('input',renderTotal);});if(pending){renderTotal();const status=d.getElementById('cancelledFoodSelectionStatus');if(status)status.textContent=`Confirming the previous selection for ${pending.staffName}. Re-enter that employee’s login PIN. The same purchase reference will be retried.`;}},showCancelButton:true,confirmButtonText:pending?'Retry saved confirmation':'Confirm selected items',cancelButtonText:'Keep food unassigned',allowOutsideClick:()=>!w.Swal.isLoading(),showLoaderOnConfirm:true,customClass:{popup:'cancelled-food-dialog'},preConfirm:async()=>{
                const pin=d.getElementById('cancelledFoodPin'),consent=d.getElementById('cancelledFoodConsent');
                try{
                    const quote=liveQuote();
                    if(!consent?.checked)throw Error('Confirm that the staff member agrees to the displayed deduction.');
                    if(!valid(input))throw Error('Your branch or shift changed. Reopen the receipt.');
                    await device();const identity=await findCancelledFoodBuyer({read},String(pin?.value||''));
                    const intent=JSON.stringify({staffId:identity.id,quote});
                    if(purchaseIntent&&purchaseIntent!==intent)throw Error('A previous confirmation may still be saving. Close and reopen this receipt before changing the buyer or selected food.');
                    purchaseIntent=intent;
                    const saved=JSON.stringify({staffId:identity.id,staffName:identity.staffName,quote});
                    try{w.localStorage.setItem(pendingKey,saved);if(w.localStorage.getItem(pendingKey)!==saved)throw Error();}catch{throw Error('This device could not save the purchase reference. Free local storage before confirming; no deduction was sent.');}
                    const answer=await engine.purchase({...input,staffId:identity.id,staffName:identity.staffName,pin:String(pin.value),quote});removePending();return answer;
                }catch(error){if(error.code==='cancelled-food/selection-stale'){try{const saved=JSON.parse(w.localStorage.getItem(pendingKey));if(saved&&!await engine.confirmPortion({...input,...saved}))removePending();}catch{}}w.Swal.showValidationMessage(esc(error.message));return false;}
                finally{if(pin)pin.value='';}
            }});
            if(result.isConfirmed){refresh();await w.Swal.fire({title:'Staff purchase recorded',text:`₱${result.value.amount.toFixed(2)} added to this employee’s Foods deductions with the selected items and source receipt. Remaining food can be assigned to another staff member. Prepared ingredients were not deducted again.`,icon:'success'});}
        }catch(error){await w.Swal.fire({title:'Purchase was not confirmed',text:error.message,icon:'warning'});}
        finally{busy=false;}
    };
    w.cancelPreparedOrder=async(value)=>{
        if(busy)return;busy=true;const input=context(value);let buy=false;
        try{
            if(!valid(input))throw Error('Sign in on an approved Cashier device and open a shift first.');
            await device();
            const choice=await w.Swal.fire({title:'Record a cancelled platform order',text:'Use this after Grab or Foodpanda confirms the cancellation. Prepared ingredients stay consumed and the platform sale is excluded from revenue. This action does not send a platform refund.',input:'select',inputOptions:CANCELLATION_REASONS,inputPlaceholder:'Choose the cancellation reason',inputValidator:value=>Object.hasOwn(CANCELLATION_REASONS,value)?null:'Choose who cancelled the prepared order.',showCancelButton:true,confirmButtonText:'Record cancellation',cancelButtonText:'Back',customClass:{popup:'cancelled-food-dialog'}});
            if(!choice.isConfirmed)return;
            await engine.cancel({...input,reason:choice.value});refresh();
            const result=await w.Swal.fire({title:'Prepared order cancelled',text:'The original receipt and ingredient use are kept for review. Does a staff member want to choose some of the prepared food?',icon:'success',showCancelButton:true,confirmButtonText:'Choose staff items',cancelButtonText:'Done'});buy=result.isConfirmed;
        }catch(error){await w.Swal.fire({title:'Cancellation was not confirmed',text:error.message,icon:'warning'});}
        finally{busy=false;}
        if(buy)await w.purchaseCancelledFood(value);
    };
    return {engine};
}
