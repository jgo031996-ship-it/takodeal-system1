import {createCancelledOrderEngine,CANCELLATION_REASONS,cancelledPlatform} from './cancelled-orders.js';
import {findMealIdentity} from './meal-checkout.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
        if(tx.preparedCancellation)return tx.cancelledFoodPurchaseId?'<div class="action-item" aria-disabled="true">Staff purchase recorded</div>':`<div class="action-item" onclick="window.purchaseCancelledFood('${key}')">Staff purchase with discount</div>`;
        return tx.status==='Voided'?'':`<div class="action-item" onclick="window.cancelPreparedOrder('${key}')">Cancelled order</div>`;
    };
    w.purchaseCancelledFood=async(value)=>{
        if(busy)return;busy=true;
        const input=context(value);
        try{
            if(!valid(input))throw Error('Sign in on an approved Cashier device and open a shift first.');
            await device();const quote=await engine.quote(input);
            const result=await w.Swal.fire({title:'Staff purchase of prepared food',html:`<div class="cancelled-food-form"><p>Original ${esc(quote.platform)} receipt <strong>${esc(quote.sourceReceiptId)}</strong></p><p>The whole prepared order will be assigned once. This does not use the regular daily staff meal allowance.</p><dl><div><dt>Food price</dt><dd>₱${quote.baseAmount.toFixed(2)}</dd></div><div><dt>Manager discount (${quote.discountPct}%)</dt><dd>−₱${quote.discountAmount.toFixed(2)}</dd></div><div><dt>Foods payslip deduction</dt><dd><strong>₱${quote.amount.toFixed(2)}</strong></dd></div></dl><label for="cancelledFoodPin">Staff PIN<input id="cancelledFoodPin" type="password" inputmode="numeric" autocomplete="off" minlength="4"></label><label class="cancelled-food-consent"><input id="cancelledFoodConsent" type="checkbox">The staff member agrees to this Foods salary deduction.</label></div>`,showCancelButton:true,confirmButtonText:'Confirm staff purchase',cancelButtonText:'Keep food unassigned',allowOutsideClick:()=>!w.Swal.isLoading(),showLoaderOnConfirm:true,customClass:{popup:'cancelled-food-dialog'},preConfirm:async()=>{
                const pin=d.getElementById('cancelledFoodPin'),consent=d.getElementById('cancelledFoodConsent');
                try{
                    if(!consent?.checked)throw Error('Confirm that the staff member agrees to the displayed deduction.');
                    if(!valid(input))throw Error('Your branch or shift changed. Reopen the receipt.');
                    await device();const profiles=new Map(),identity=await findMealIdentity({read:async(...args)=>{const rows=await read(...args);for(const row of rows)profiles.set(row.id,row.data);return rows;}},String(pin?.value||''),{roles:['staff']});
                    const profile=profiles.get(identity.id),staffName=profile?.cashierName||profile?.fullName||profile?.name;
                    return await engine.purchase({...input,staffId:identity.id,staffName,pin:String(pin.value),quote});
                }catch(error){w.Swal.showValidationMessage(esc(error.message));return false;}
                finally{if(pin)pin.value='';}
            }});
            if(result.isConfirmed){refresh();await w.Swal.fire({title:'Staff purchase recorded',text:`Receipt ${result.value.receiptId}: ₱${result.value.amount.toFixed(2)} added to Foods for the next eligible payslip. Prepared ingredients were not deducted again.`,icon:'success'});}
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
            const result=await w.Swal.fire({title:'Prepared order cancelled',text:'The original receipt and ingredient use are kept for review. Does a staff member want to buy the whole prepared order?',icon:'success',showCancelButton:true,confirmButtonText:'Staff purchase',cancelButtonText:'Done'});buy=result.isConfirmed;
        }catch(error){await w.Swal.fire({title:'Cancellation was not confirmed',text:error.message,icon:'warning'});}
        finally{busy=false;}
        if(buy)await w.purchaseCancelledFood(value);
    };
    return {engine};
}
