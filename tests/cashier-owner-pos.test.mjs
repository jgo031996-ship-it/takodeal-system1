import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {installOwnerPOS} from '../Takodeal-POS/cashier-owner-pos.js';

const item={name:'Sample takoyaki',basePrice:65,variantPrice:65,qty:1,addons:{},notes:'Less sauce'};
async function fixture(){
    const h=firestoreHarness(), db=h.api.db, draw={shiftId:'CURRENT'}, storage=new Map(),dialogs=[];
    const session={isOwner:true,branch:'Agdao'},user={uid:'sample-owner'},nodes=new Map();
    const d={getElementById:id=>nodes.get(id)};
    const w={...h.api,crypto:webcrypto,cart:[],platformCarts:{},sessionUser:session,posPlatform:'Standard',navigator:{locks:{request:(_k,_o,fn)=>fn({})}},
        limit:()=>({limit:2}),query:(q,...filters)=>h.api.query(q,...filters.filter(f=>!f.limit)),
        getDocFromServer:async ref=>({exists:()=>h.docs.has(ref.path),data:()=>h.get(ref.path)}),
        processRawItemsIntoMenu:items=>items,buildCategories(){},renderOrderAndPaymentUI(){},renderCart(){},switchView(){},
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        Swal:{fire:async options=>{dialogs.push(options);return options.showDenyButton?{isDenied:true}:{isConfirmed:true};}},
        cashierOwnerRegister:{openShift:()=>draw,paintStatus(){}}};
    w.switchPosPlatform=platform=>{w.posPlatform=platform;};
    const c={db,branch:'Agdao',session,user,actionActor:'Owner: Sample',assertCurrent(){assert.equal(w.sessionUser,session);},
        prepareSale:async()=>({checkTransaction:async tx=>{const snap=await tx.get(h.ref('hq_managers','owner'));if(!snap.data()?.active)throw Error('Owner access revoked');}})};
    w.getCashierOwnerWorkspaceContext=()=>c;
    h.put('branches/A',{name:'Agdao',allowedCategories:['Food']});h.put('menu/A',{name:item.name,category:'Food'});h.put('menu/B',{name:'Elsewhere',category:'Unavailable'});
    h.put('bom/R',{menuItem:item.name,ingredientName:'Flour',qty:2});h.put('inventory/F',{branch:'Agdao',name:'Flour',baseUom:'g',currentStock:20});
    h.put('inventory/M',{branch:'Maa',name:'Flour',baseUom:'g',currentStock:40});h.put('shifts/CURRENT',{branch:c.branch,active:true});
    h.put('hq_managers/owner',{active:true});
    const pos=installOwnerPOS(w,d);w.cashierOwnerPOS=pos;await pos.loadMenu(c);
    function punch(){return pos.checkout({cart:w.cart,branch:'Agdao',shiftId:'CURRENT',orderType:'Dine-In',paymentMethod:'Cash',netTotal:w.cart[0].qty*65});}
    w.cart=[structuredClone(item)];
    return {w,h,c,pos,punch,storage,dialogs,nodes};
}
test('verified Owner uses selected menu, creates a sale, returns another cashier’s wrong punch to cart, and posts one corrected receipt',async()=>{
    const {w,h,pos,punch,storage}=await fixture();
    assert.deepEqual(w.masterPOSData.items.map(i=>i.name),[item.name]);
    const sale=await punch();assert.equal(sale.status,'committed',sale.error);assert.equal(h.get('inventory/F').currentStock,18);assert.equal(h.get('shifts/CURRENT').salesRevision,1);
    const path='transactions/'+sale.saleId;const original=h.get(path);assert.equal(original.cashier,'Owner: Sample');assert.equal(original.ownerInput,undefined);
    h.put(path,{...original,cashier:'Original Staff'});w.cart=[];await pos.changeReceipt(sale.saleId,sale.receiptId);
    assert.equal(h.get(path).voidReason,'WrongPunched');assert.equal(h.get(path).voidOwnerUid,'sample-owner');assert.equal(h.get('inventory/F').currentStock,20);
    assert.equal(w.cart[0].notes,'Less sauce');w.cart[0].qty=2;await pos.changeReceipt(sale.saleId,sale.receiptId);assert.equal(w.cart[0].qty,2);
    const replacement=await punch();assert.equal(replacement.status,'committed',replacement.error);assert.equal(replacement.payload.voidCorrection.sourceSaleId,sale.saleId);
    w.cart=[];await pos.changeReceipt(sale.saleId,sale.receiptId);
    assert.equal(w.cart.length,0);assert.equal(h.get('inventory/F').currentStock,16);assert.equal(h.get('inventory/M').currentStock,40);assert.equal(storage.size,0);
});
test('a lost sale acknowledgement reuses the saved payment exactly once, even after closing the shift',async()=>{
    const {h,pos,punch,storage,dialogs}=await fixture();h.loseNextAck();assert.equal((await punch()).status,'owner-pending');
    h.put('shifts/CURRENT',{branch:'Agdao',active:false});await pos.reviewPending();
    assert.equal(storage.size,0);assert.equal(h.get('inventory/F').currentStock,18);assert.equal(dialogs.at(-1).title,'Receipt confirmed');
    assert.equal([...h.docs.keys()].filter(path=>path.startsWith('transactions/')).length,1);
});
test('revoked owner, changed branch, and closed register prevent any financial or stock writes',async()=>{
    for(const change of ['account','branch','closed']){
        const {h,punch}=await fixture();
        if(change==='account')h.put('hq_managers/owner',{active:false});
        else h.put('shifts/CURRENT',{branch:change==='branch'?'Maa':'Agdao',active:change!=='closed'});
        assert.notEqual((await punch()).status,'committed');assert.equal(h.get('inventory/F').currentStock,20);
        assert.equal([...h.docs.keys()].some(path=>path.startsWith('transactions/')),false);
    }
});
test('Owner cancellation restores only applied stock once and identifies both operators in the security alert',async()=>{
    const {h,w,pos,punch}=await fixture();const sale=await punch();w.Swal.fire=async()=>({isConfirmed:true});
    w.cart=[{name:'another unpaid order'}];await pos.changeReceipt(sale.saleId,sale.receiptId);await pos.changeReceipt(sale.saleId,sale.receiptId);
    const alerts=[...h.docs].filter(([path])=>path.startsWith('manager_alerts/void-'));
    assert.equal(alerts.length,1);assert.equal(alerts[0][1].voidReason,'OrderCancelled');assert.equal(alerts[0][1].ownerUid,'sample-owner');
    assert.equal(h.get('inventory/F').currentStock,20);assert.equal(w.cart[0].name,'another unpaid order');
});

import {transitionMobileOrder,mobileActor} from '../Takodeal-POS/mobile-order-actions.js';
test('remote Owner accepts an incoming order, charges its original code once and marks it ready and complete',async()=>{
    const {w,h,pos,c}=await fixture();
    const id='online-fixture',ref='incoming_orders/'+id;
    h.put(ref,{branch:c.branch,orderCode:'WEB-42',items:[item],status:'mobile_queue'});
    assert.equal(mobileActor(w).uid,c.user.uid);
    const change=to=>transitionMobileOrder(w,{id,to,prepTime:15,proofCheckAcknowledged:true});
    await change('preparing');
    const input={cart:w.cart,branch:c.branch,shiftId:'CURRENT',orderType:'Take-Out',paymentMethod:'Cash',netTotal:65,isMobileOrder:true,mobileOrderCode:'WEB-42',mobileOrderId:id};
    const paid=await pos.checkout(input);
    assert.equal(paid.status,'committed',paid.error);assert.equal(paid.receiptId,'WEB-42');
    assert.equal(h.get(ref).acceptedByUid,c.user.uid);assert.equal(h.get(ref).paymentStatus,'paid');
    assert.equal((await pos.checkout(input)).status,'failed');assert.equal(h.get('inventory/F').currentStock,18);
    await change('ready');await change('completed');assert.equal(h.get(ref).completedBy,c.actionActor);
    h.put(ref,{branch:'Maa',items:[item],status:'mobile_queue'});await assert.rejects(change('preparing'),/another branch/);
    h.put(ref,{branch:c.branch,items:[item],status:'mobile_queue'});h.put('hq_managers/owner',{active:false});await assert.rejects(change('preparing'),/revoked/);
});
test('remote Owner resumes a branch parked ticket and consumes it atomically with successful payment',async()=>{
    const {w,h,pos,c,punch}=await fixture();const origin='parked_orders/table-4';
    const row={branch:c.branch,items:[item],name:'Table 4',total:65,orderType:'Take-Out',platform:'Standard'};
    h.put(origin,row);w.cart=[];await pos.parked.resumeOrder('table-4');
    assert.equal(w.cart[0]?.name,item.name);assert.deepEqual(h.get(origin),row);
    assert.equal((await punch()).status,'committed');assert.equal(h.get(origin),undefined);
    assert.equal(h.get('inventory/F').currentStock,18);
});
test('checkout detects a parked order already picked up on the store tablet before recording payment',async()=>{
    const {w,h,pos,c,punch}=await fixture();const path='parked_orders/table-5';
    h.put(path,{branch:c.branch,items:[item],name:'Table 5',total:65});w.cart=[];await pos.parked.resumeOrder('table-5');
    h.put(path,{branch:c.branch,items:[{...item,qty:3}],name:'Table 5',total:195});
    const paid=await punch();assert.equal(paid.status,'failed');assert.equal(h.get('inventory/F').currentStock,20);
});

test('a store pickup between preparation and commit clears only the superseded Owner payment',async()=>{
    const {w,h,pos,c,punch,storage}=await fixture(),path='parked_orders/shared';
    h.put(path,{branch:c.branch,items:[item],name:'Table 6',total:65});w.cart=[];await pos.parked.resumeOrder('shared');
    const save=w.localStorage.setItem;
    w.localStorage.setItem=(key,value)=>{save(key,value);h.docs.delete(path);};
    const result=await punch();assert.equal(result.status,'failed',result.error);assert.equal(storage.size,0);assert.equal(h.get('inventory/F').currentStock,20);
});
test('a mobile payment already recorded on another terminal is reported as paid at the store',async()=>{
    const {w,h,pos,c,storage}=await fixture(),id='remote',path='incoming_orders/'+id;
    h.put(path,{branch:c.branch,orderCode:'M-2',status:'preparing',items:[item]});
    const input={branch:c.branch,shiftId:'CURRENT',cart:w.cart,netTotal:65,orderType:'Take-Out',paymentMethod:'Cash',isMobileOrder:true,mobileOrderId:id,mobileOrderCode:'M-2'};
    const save=w.localStorage.setItem;
    w.localStorage.setItem=(key,value)=>{save(key,value);const payload=JSON.parse(value);h.put('transactions/'+payload.saleId,{...payload,ownerUid:null,cashier:'Branch cashier'});h.put(path,{...h.get(path),paymentStatus:'paid',receiptId:'M-2'});};
    const result=await pos.checkout(input);assert.equal(result.status,'failed');assert.match(result.error,/store already recorded/);assert.equal(storage.size,0);assert.equal(h.get('inventory/F').currentStock,20);
});
