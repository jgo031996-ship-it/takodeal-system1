import {SALE_VERSION,safeId,saleFingerprint,countBalls} from './pos-safety.js';
import {cancelledFoodPolicy} from './pos-config-model.js';
import {mealRole,savedPin} from './hq-account-model.js';
export const CANCELLATION_REASONS=Object.freeze({customer:'Prepared but customer cancelled',rider:'Prepared but rider cancelled'});
export const cancelledPlatform=sale=>{const value=String(sale.paymentMethod||'').trim().toLowerCase();return value==='grab'?'Grab':['foodpanda','panda'].includes(value)?'Foodpanda':null;};
export function eligibleCancelledFoodBuyer(profile){
    return Boolean(profile && ['staff','manager'].includes(mealRole(profile,'cashiers')) && ['staff','staff crew','crew','cashier','manager'].includes(String(profile.role??'Staff').trim().toLowerCase()) && profile.active!==false && profile.archived!==true && !/blocked|inactive|terminated|archived|resigned|deleted/i.test(String(profile.status||'')) && savedPin(profile).trim().toUpperCase()!=='REVOKED');
}
export async function findCancelledFoodBuyer(api,pin){
    pin=String(pin||'');if(pin.length<4)throw Error('Enter the employee’s registered login PIN (not their private Pay PIN).');
    const values=[pin];if(/^\d+$/.test(pin)&&String(Number(pin))===pin)values.push(Number(pin));
    const matches=(await Promise.all(['pin','securityPin'].flatMap(field=>values.map(value=>api.read('cashiers',field,value))))).flat();
    const profiles=[...new Map(matches.map(row=>[row.id,row])).values()].filter(row=>eligibleCancelledFoodBuyer(row.data)&&savedPin(row.data)===pin);
    if(!profiles.length)throw Error('No active crew or manager matches this login PIN. Check the employee’s registered login PIN in Owner → Master Employee Profile.');
    if(profiles.length!==1)throw Error('This login PIN belongs to multiple employees. Ask the Owner to assign unique PINs.');
    const row=profiles[0],name=row.data.cashierName||row.data.fullName||row.data.name;
    if(!name)throw Error('The employee profile needs a saved name.');
    return {id:row.id,staffName:name};
}
const cents=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('This receipt has an invalid amount. Ask HQ to review it.');return Math.round(value*100);};
const text=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCancelledOrderEngine(api,{sessionCheck=()=>true}={}){
    const ref=(table,id)=>api.doc(api.db,table,id);
    function guard(input){if(!input.sourceSaleId||!input.branch||!input.shiftId||!sessionCheck(input))throw Error('Your branch or shift changed. Reopen sales history before continuing.');}
    async function source(tx,input){
        guard(input);
        const saleRef=ref('transactions',input.sourceSaleId),snapshot=await tx.get(saleRef);
        if(!snapshot.exists())throw Error('Receipt is missing. Reload sales history.');
        const sale=snapshot.data(),marker=await tx.get(ref('pos_sale_commits',input.sourceSaleId));
        if(sale.branch!==input.branch||sale.shiftId!==input.shiftId)throw Error('This receipt belongs to another branch or shift.');
        if(!cancelledPlatform(sale)||sale.cancelledFoodSourceId)throw Error('Only prepared Grab or Foodpanda orders can use this action.');
        if(sale.saleVersion!==SALE_VERSION||sale.saleId!==input.sourceSaleId||!Array.isArray(sale.cart)||!sale.cart.length||!Array.isArray(sale.inventoryMovements)||!['applied','deferred'].includes(sale.inventoryState)||!marker.exists()||marker.data().saleId!==sale.saleId||marker.data().branch!==sale.branch||marker.data().receiptId!==sale.receiptId||marker.data().fingerprint!==saleFingerprint(sale))throw Error('This older receipt needs HQ reconciliation before cancellation.');
        return {saleRef,sale};
    }
    async function openShift(tx,input){const shift=await tx.get(ref('shifts',input.shiftId));if(!shift.exists()||shift.data().branch!==input.branch||shift.data().active!==true||shift.data().status==='Closed')throw Error('This shift is already closed. Ask HQ to reconcile the order; saved settlements are unchanged.');}
    function quote(sale,input,settings){
        const policy=cancelledFoodPolicy(settings);if(!policy.cancelledFoodPurchaseEnabled)throw Error('Staff purchases of cancelled food are disabled in Owner POS Config → Purchased Cancelled Orders.');
        const base=cents(sale.subTotalBeforeDiscount??sale.netTotal),discount=Math.round(base*policy.cancelledFoodDiscountPct/100);
        return {sourceSaleId:input.sourceSaleId,branch:input.branch,shiftId:input.shiftId,sourceReceiptId:sale.receiptId,platform:cancelledPlatform(sale),baseAmount:base/100,discountPct:policy.cancelledFoodDiscountPct,discountAmount:discount/100,amount:(base-discount)/100,fingerprint:saleFingerprint(sale)};
    }
    const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
    function committedPurchase(sale,existing,deduction,input,id){
        if(!existing.exists()||!deduction.exists())return null;
        const data=existing.data(),charge=deduction.data();
        if(sale.status!=='Voided'||!sale.preparedCancellation?.prepared||sale.cancelledFoodPurchaseId!==id||
            data.saleId!==id||data.branch!==input.branch||data.shiftId!==input.shiftId||data.status!=='Paid'||data.paymentMethod!=='Salary Deduction'||
            data.cancelledFoodSourceId!==input.sourceSaleId||data.cancelledFoodSourceReceiptId!==sale.receiptId||data.receiptId!=='CF-'+sale.receiptId||
            data.cancelledFoodStaffId!==input.staffId||data.customerName!==input.staffName||!same(data.cancelledFoodQuote,input.quote)||data.netTotal!==input.quote?.amount||
            charge.type!=='Cancelled Food Purchase'||charge.purchaseId!==id||charge.sourceSaleId!==input.sourceSaleId||charge.sourceReceiptId!==sale.receiptId||
            charge.receiptId!==data.receiptId||charge.branch!==input.branch||charge.staffId!==input.staffId||charge.staffName!==input.staffName||charge.amount!==data.netTotal)return null;
        return {alreadyPurchased:true,saleId:id,receiptId:data.receiptId,amount:data.netTotal};
    }
    async function acknowledgePurchase(input,id){
        guard(input);let timer;
        try{
            const result=await Promise.race([api.runTransaction(api.db,async tx=>{
                const {sale}=await source(tx,input),existing=await tx.get(ref('transactions',id)),deduction=await tx.get(ref('staff_deductions',id));
                guard(input);return committedPurchase(sale,existing,deduction,input,id);
            }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Purchase acknowledgement check timed out.')),5000);})]);
            guard(input);return result;
        }finally{clearTimeout(timer);}
    }
    return {
        async cancel(input){
            if(!Object.hasOwn(CANCELLATION_REASONS,input.reason)||!input.cashier)throw Error('Choose who cancelled the prepared order.');
            return api.runTransaction(api.db,async tx=>{
                const {saleRef,sale}=await source(tx,input);
                if(sale.preparedCancellation){if(sale.preparedCancellation.reason!==input.reason)throw Error('This order already has a different cancellation reason.');return {alreadyCancelled:true};}
                if(sale.status==='Voided'||sale.status==='Parked')throw Error('This order has already been voided or is unpaid.');
                await openShift(tx,input);guard(input);
                // Voided is the established non-revenue accounting state. The
                // separate prepared marker keeps consumed stock and distinguishes
                // this cancellation from a conventional inventory-returning void.
                tx.update(saleRef,{status:'Voided',voidedBy:input.cashier,voidTime:api.serverTimestamp(),preparedCancellation:{reason:input.reason,label:CANCELLATION_REASONS[input.reason],platform:cancelledPlatform(sale),prepared:true}});
                tx.update(ref('shifts',input.shiftId),{salesRevision:api.increment(1)});
                if(sale.statsApplied&&sale.ballsCounted>0)tx.set(ref('settings','global_stats'),{totalTakoyakiBalls:api.increment(-sale.ballsCounted),['balls_'+input.branch]:api.increment(-sale.ballsCounted),lastSaleId:input.sourceSaleId,lastSaleBranch:input.branch,lastSaleDirection:-1},{merge:true});
                tx.set(ref('manager_alerts','prepared-cancel-'+input.sourceSaleId),{type:'PREPARED_ORDER_CANCELLED',branch:input.branch,cashier:input.cashier,receiptId:sale.receiptId,saleId:input.sourceSaleId,message:`${text(cancelledPlatform(sale))} receipt ${text(sale.receiptId)}: ${CANCELLATION_REASONS[input.reason]}. Platform revenue excluded. Prepared ingredient consumption is retained.`,timestamp:api.serverTimestamp(),isRead:false});
                return {alreadyCancelled:false};
            });
        },
        async quote(input){return api.runTransaction(api.db,async tx=>{const {sale}=await source(tx,input);await openShift(tx,input);if(!sale.preparedCancellation||sale.status!=='Voided')throw Error('Record the prepared-order cancellation first.');if(sale.cancelledFoodPurchaseId)throw Error('This prepared order was already purchased by staff.');const config=await tx.get(ref('settings','global_pos_config'));return quote(sale,input,config.exists()?config.data():{});});},
        async purchase(input){
            if(!input.staffId||!input.staffName||!input.cashier||String(input.pin||'').length<4)throw Error('A verified staff PIN is required.');
            const id='cancelled-food-'+safeId(input.sourceSaleId);
            try{return await api.runTransaction(api.db,async tx=>{
                const {saleRef,sale}=await source(tx,input),purchaseRef=ref('transactions',id),existing=await tx.get(purchaseRef),deductionRef=ref('staff_deductions',id),deduction=await tx.get(deductionRef);
                if(existing.exists()){
                    const result=committedPurchase(sale,existing,deduction,input,id);guard(input);
                    if(!result)throw Error('This prepared food was already assigned to another purchase. Reload its receipt.');
                    return result;
                }
                if(sale.cancelledFoodPurchaseId||deduction.exists())throw Error('This prepared food is already assigned. Ask HQ to review the linked record.');
                if(!sale.preparedCancellation||sale.status!=='Voided')throw Error('Record the prepared-order cancellation first.');
                await openShift(tx,input);
                const config=await tx.get(ref('settings','global_pos_config')),currentQuote=quote(sale,input,config.exists()?config.data():{});
                if(!same(currentQuote,input.quote))throw Error('The discount or order changed. Review the current quote before confirming the deduction.');
                const staff=await tx.get(ref('cashiers',input.staffId));
                if(!staff.exists()||!eligibleCancelledFoodBuyer(staff.data())||String(staff.data().cashierName||staff.data().fullName||staff.data().name)!==input.staffName||savedPin(staff.data())!==String(input.pin))throw Error('The employee login PIN or access changed. Verify their active crew or manager profile again.');
                guard(input);
                const cart=sale.cart.map(item=>({...item})),receiptId='CF-'+sale.receiptId,payload={saleVersion:SALE_VERSION,saleId:id,receiptId,branch:input.branch,shiftId:input.shiftId,cashier:input.cashier,cart,orderType:'Take-Out',status:'Paid',customerName:input.staffName,paymentMethod:'Salary Deduction',paymentVerified:true,subTotalBeforeDiscount:currentQuote.baseAmount,globalDiscountType:'cancelled_food',globalDiscountValue:currentQuote.discountPct,globalDiscountAmount:currentQuote.discountAmount,globalDiscountReason:'Prepared platform cancellation — staff purchase',netTotal:currentQuote.amount,amountReceived:0,inventoryMovements:[],inventoryState:'applied',inventoryReviewRequired:false,ballsCounted:countBalls(cart),statsApplied:true,cancelledFoodSourceId:input.sourceSaleId,cancelledFoodSourceReceiptId:sale.receiptId,cancelledFoodStaffId:input.staffId,cancelledFoodQuote:currentQuote,timestamp:api.serverTimestamp()};
                tx.set(purchaseRef,payload);
                tx.set(ref('pos_sale_commits',id),{saleId:id,branch:input.branch,receiptId,fingerprint:saleFingerprint(payload),committedAt:api.serverTimestamp()});
                tx.set(deductionRef,{staffId:input.staffId,staffName:input.staffName,branch:input.branch,type:'Cancelled Food Purchase',category:'Foods',status:'Unpaid',amount:currentQuote.amount,originalAmount:currentQuote.baseAmount,discountPct:currentQuote.discountPct,discountAmount:currentQuote.discountAmount,sourceSaleId:input.sourceSaleId,sourceReceiptId:sale.receiptId,sourcePlatform:currentQuote.platform,purchaseId:id,receiptId,item:cart.map(item=>`${item.qty}x ${item.name||item.itemName}`).join(', '),dateAdded:api.serverTimestamp(),loggedBy:input.cashier});
                tx.update(saleRef,{cancelledFoodPurchaseId:id});
                tx.update(ref('shifts',input.shiftId),{salesRevision:api.increment(1)});
                if(payload.ballsCounted>0)tx.set(ref('settings','global_stats'),{totalTakoyakiBalls:api.increment(payload.ballsCounted),['balls_'+input.branch]:api.increment(payload.ballsCounted),lastSaleId:id,lastSaleBranch:input.branch,lastSaleDirection:1},{merge:true});
                tx.set(ref('manager_alerts',id),{type:'CANCELLED_FOOD_PURCHASE',branch:input.branch,cashier:input.cashier,receiptId,saleId:id,staffName:input.staffName,message:`Prepared cancelled receipt ${text(sale.receiptId)} purchased by ${text(input.staffName)}. Foods salary deduction: ₱${currentQuote.amount.toFixed(2)} at ${currentQuote.discountPct}% discount. No second ingredient deduction.`,timestamp:api.serverTimestamp(),isRead:false});
                return {alreadyPurchased:false,saleId:id,receiptId,amount:currentQuote.amount};
            });}catch(error){
                // Rules may reject a concurrent stale create before the SDK can
                // retry its callback. Read only the deterministic linked records
                // to acknowledge an exact committed intent; never replay writes.
                try{const result=await acknowledgePurchase(input,id);if(result)return result;}catch{}
                throw error;
            }
        }
    };
}
