import {restoreVoidPlatform} from './cashier-void.js';
import {resetCheckoutForNextOrder} from './checkout-controls.js';
import {voidCanonical} from './cashier-void-model.js';
import {clearMobileOrder} from './mobile-delivery-state.js';

function contents(row){
    return voidCanonical([row.branch,row.name||row.customerName||'',row.items||row.cart||[],row.total??row.netTotal??0,
        row.platform||'Standard',row.orderType||'',row.mobileOrderId||null,row.mobileOrderCode||null,row.deliveryFee||0,row.deliveryAddress||'',row.contactNumber||'']);
}
export function installOwnerParked(w,d,{context,shift,exclusive,discard,blocked}){
    let resumed=null,draft=null;
    const field=id=>d.getElementById(id);
    const ref=(c,id)=>w.doc(c.db,'parked_orders',id);
    const current=c=>resumed?.session===c.session&&resumed.cart===w.cart?resumed:null;
    async function available(tx,c,order){
        const row=await tx.get(ref(c,order.id));
        if(!row.exists()||row.data().branch!==c.branch||contents(row.data())!==order.contents)
            throw Error('This parked order was changed or picked up at the store. Reopen Parked orders.');
    }
    async function run(fn){
        try{
            const c=context();if(!shift()||!w.cashierOwnerPOS.isReady())throw Error('Open the branch register before working on parked orders.');
            return await exclusive(c,()=>fn(c));
        }catch(e){await w.Swal.fire({title:'Parked orders',text:e.message,icon:'info'});return false;}
    }
    function clearCart(){
        w.cart=[];if(w.platformCarts)w.platformCarts[w.posPlatform||'Standard']=w.cart;
        clearMobileOrder(w);resetCheckoutForNextOrder(w,d);w.renderCart();resumed=null;
    }
    async function parkOrder(){
        return run(async c=>{
            if(!w.cart?.length)return;
            if(blocked(c))throw Error('Finish the saved payment or receipt correction before parking this cart.');
            const type=field('mainOrderType')?.value;
            if(!type)throw Error('Choose an order type before parking.');
            const cart=w.cart,items=structuredClone(cart),name=field('finalCustomerName')?.value||'';
            const answer=await w.Swal.fire({title:'Park order',input:'text',inputLabel:'Customer name or table',inputValue:name,showCancelButton:true,confirmButtonText:'Park order',inputValidator:value=>!String(value||'').trim()?'Enter a name or table.':undefined});
            if(!answer.isConfirmed)return;
            const unchanged=()=>{c.assertCurrent();if(cart!==w.cart||voidCanonical(items)!==voidCanonical(cart))throw Error('The cart changed. Review it before parking.');};
            unchanged();
            const row={branch:c.branch,cashier:c.actionActor,ownerUid:c.user.uid,name:String(answer.value).trim(),items,total:w.currentGrandTotal,orderType:type,
                platform:w.posPlatform||'Standard',isMobileOrder:!!w.isActiveOrderMobile,mobileOrderId:w.activeMobileOrderId||null,mobileOrderCode:w.activeMobileOrderCode||null,
                deliveryFee:w.mobileDeliveryFeeForCart?.()||0,deliveryAddress:field('finalDeliveryAddress')?.value||'',contactNumber:field('finalContactNumber')?.value||''};
            const old=current(c),signature=contents(row),guard=await c.prepareSale();
            if(!draft||draft.session!==c.session||draft.cart!==cart)draft={session:c.session,cart,id:old?.id||w.doc(w.collection(c.db,'parked_orders')).id};
            const id=draft.id;
            await w.runTransaction(c.db,async tx=>{
                await guard.checkTransaction(tx);const snap=await tx.get(ref(c,id));unchanged();
                if(snap.exists()&&contents(snap.data())===signature&&snap.data().ownerUid===c.user.uid)return;
                if(old)await available(tx,c,old);else if(snap.exists())throw Error('This order already has a different parked ticket. Review Parked orders.');
                unchanged();tx.set(ref(c,id),{...row,timestamp:w.serverTimestamp()});
            });
            unchanged();clearCart();draft=null;w.updateParkedBadge?.();
        });
    }
    async function resumeOrder(id){
        return run(async c=>{
            if(w.cart?.length||blocked(c))throw Error('Finish or park your current order first.');
            const snap=await w.getDocFromServer(ref(c,id));c.assertCurrent();const row=snap.exists()&&snap.data();
            if(!row||row.branch!==c.branch)throw Error('This ticket is no longer parked at this branch.');
            const cart=structuredClone(row.items||row.cart||[]);
            if(!cart.length)throw Error('This parked order has no items.');
            if(w.cart?.length)throw Error('The cart changed. Reopen Parked orders.');
            restoreVoidPlatform(w,d,row.platform||'Standard');resetCheckoutForNextOrder(w,d);
            w.cart=cart;w.platformCarts||={};w.platformCarts[row.platform||'Standard']=cart;
            clearMobileOrder(w);
            if(row.mobileOrderId){w.isActiveOrderMobile=true;w.activeMobileOrderId=row.mobileOrderId;w.activeMobileOrderCode=row.mobileOrderCode;w.activeMobileDelivery={orderId:row.mobileOrderId,branch:c.branch,fee:Number(row.deliveryFee)||0};}
            for(const [key,value] of Object.entries({mainOrderType:row.orderType,finalCustomerName:row.name||row.customerName,finalDeliveryAddress:row.deliveryAddress,finalContactNumber:row.contactNumber})){
                const node=field(key);if(node)node.value=value||'';
            }
            resumed={session:c.session,id,contents:contents(row),cart};w.renderCart();w.closeModal?.('parkedModal');w.switchView?.('pos');
        });
    }
    async function deleteParkedOrderManually(id){
        return run(async c=>{
            if(!(await w.Swal.fire({title:'Remove unpaid parked order?',text:'A void will be recorded for this branch.',showCancelButton:true,confirmButtonText:'Remove order'})).isConfirmed)return;
            c.assertCurrent();const drawer=shift();if(!drawer)throw Error('The branch register closed.');
            if(!await discard(c,drawer.shiftId,id))throw Error('This order was already picked up or removed.');
            if(current(c)?.id===id)clearCart();
            w.updateParkedBadge?.();w.showParkedOrders?.();
        });
    }
    return {parkOrder,resumeOrder,deleteParkedOrderManually,current,available,clear:()=>{resumed=null;draft=null;}};
}
