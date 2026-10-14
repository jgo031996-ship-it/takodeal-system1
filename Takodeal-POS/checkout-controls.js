// Checkout presentation follows the same payment value that is saved with the receipt.
const key=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const el=(d,id)=>d?.getElementById?.(id);
const buttons=d=>Array.from(d?.querySelectorAll?.('.payment-grid .pay-btn')||[]);
export const checkoutPlatform=(w,d)=>w.posPlatform||el(d,'posPlatformSelect')?.value||'Standard';
const platformLocked=(w,d)=>['Grab','Foodpanda'].includes(checkoutPlatform(w,d));
export function paymentButtonMethod(button){return button.classList.contains('split-btn')?'split':key(button.dataset.paymentMethod||button.dataset.tkMethod||button.textContent);}
export function syncPaymentButtons(w,d){
    const selected=key(w.selectedPaymentMethod);
    for(const button of buttons(d)){
        const method=paymentButtonMethod(button);
        if(method==='split'&&!button.querySelector('[data-split-label]')){
            button.innerHTML='<svg class="payment-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h3c5 0 5 14 10 14h3m-4-4 4 4-4 4M4 19h3c2 0 3-2 4-4m3-6c1-2 2-4 3-4h3m-4-4 4 4-4 4"/></svg><span data-split-label>Split payment</span>';
            button.dataset.paymentMethod='split';
        }
        const active=method===selected;
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
    }
}
function resetPayment(w,d){
    const platform=checkoutPlatform(w,d);
    const cash=buttons(d).find(b=>paymentButtonMethod(b)==='cash');
    const first=buttons(d).find(b=>paymentButtonMethod(b)!=='split');
    w.selectedPaymentMethod=platformLocked(w,d)?platform:(cash||!first?'Cash':first.dataset.tkMethod||first.dataset.paymentMethod||first.textContent.trim());
    w.isSplitMode=false;w.splitRows=[];
    w.amountReceivedStr=platformLocked(w,d)?String(w.currentGrandTotal??0):'0';
    for(const id of ['splitAmount1','splitAmount2'])if(el(d,id))el(d,id).value='';
    for(const id of ['splitMethod1','splitMethod2']){const select=el(d,id);if(select)select.value=Array.from(select.options||[]).some(o=>o.value==='Cash')?'Cash':select.options?.[0]?.value||'';}
    if(el(d,'splitPaymentContainer'))el(d,'splitPaymentContainer').style.display='none';
    syncPaymentButtons(w,d);
}
export function resetCheckoutForNextOrder(w,d){
    if(!platformLocked(w,d)){const type=el(d,'mainOrderType');if(type)type.value='';}
    if(el(d,'checkoutDiscountType'))el(d,'checkoutDiscountType').value='none';
    for(const id of ['checkoutDiscountValue','checkoutDiscountReason','checkoutStaffPin','finalCustomerName','finalDeliveryAddress','finalContactNumber'])if(el(d,id))el(d,id).value='';
    const name=el(d,'finalCustomerName');if(name){name.readOnly=false;if(name.style)name.style.fontWeight='';}
    if(el(d,'checkoutStaffPinContainer'))el(d,'checkoutStaffPinContainer').style.display='none';
    resetPayment(w,d);
    w.updateNumpadDisplay?.();
}
export function installCheckoutControls(w,d){
    if(w.checkoutControlsInstalled||!el(d,'checkoutModal'))return;
    w.checkoutControlsInstalled=true;
    const wrap=(name,after)=>{const original=w[name];if(typeof original==='function')w[name]=function(...args){if(['setPaymentMethod','toggleSplitPaymentUI'].includes(name)&&(w.isSubmittingOrder||w.isProcessingOrder))return;const result=original.apply(this,args);after();return result;};};
    for(const name of ['setPaymentMethod','handleDiscountTypeChange','updateNumpadDisplay'])wrap(name,()=>syncPaymentButtons(w,d));
    wrap('toggleSplitPaymentUI',()=>{
        if(el(d,'splitPaymentContainer')?.style.display==='none'&&key(w.selectedPaymentMethod)==='split'){resetPayment(w,d);w.updateNumpadDisplay?.();}
        syncPaymentButtons(w,d);
    });
    wrap('renderOrderAndPaymentUI',()=>syncPaymentButtons(w,d));
    const open=w.openCheckoutModal;
    if(typeof open==='function')w.openCheckoutModal=function(...args){
        if(w.isSubmittingOrder)return;
        const result=open.apply(this,args);
        if(el(d,'checkoutModal').style.display==='flex'){resetPayment(w,d);w.updateNumpadDisplay?.();}
        return result;
    };
    syncPaymentButtons(w,d);
}
