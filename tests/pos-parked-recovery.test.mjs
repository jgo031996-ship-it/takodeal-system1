import test from 'node:test';
import assert from 'node:assert/strict';
import {createParkedRecoveryStore,installParkedRecovery} from '../Takodeal-POS/pos-parked-recovery.js';
const branch='Sample Branch',staffName='Sample Crew';
function storageFixture(){const values=new Map();let writeError=false,removeError=false;return {values,setWriteError:value=>writeError=value,setRemoveError:value=>removeError=value,
    getItem:key=>values.get(key)??null,setItem(key,value){if(writeError)throw Error('Storage full');values.set(key,String(value));},removeItem(key){if(removeError)throw Error('Storage denied');values.delete(key);},key:i=>[...values.keys()][i],get length(){return values.size;}};}
function fixture(){const storage=storageFixture(),docs=new Map(),queued=[],reads=[];storage.setItem('takodeal_device_id','sample-device');storage.setItem('takodeal_device_branch',branch);let ids=0;
    const w={localStorage:storage,sessionUser:{staffId:'sample-staff',cashierName:staffName,branch},cart:[],crypto:{randomUUID:()=>`sample-park-${++ids}`},confirm:()=>true,
        db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:async ref=>{reads.push(ref);return {id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>docs.has(ref.table+'/'+ref.id),data:()=>docs.get(ref.table+'/'+ref.id)};},saleOutbox:{list:async()=>queued},Swal:{fire:async()=>{}},renderCart(){},closeModal(){},updateParkedBadge(){}};
    const permit={branch,manageRecovery:false,assertCurrent(){}};w.authorizePOSSetting=async()=>permit;
    const recovery=installParkedRecovery(w,{getElementById:()=>null}),order={id:'sample-original',branch,name:'Sample Customer',items:[{name:'Sample Food',qty:1,price:50}],total:50,orderType:'Dine-In'};
    const capture=()=>recovery.capture(order,permit);const activate=()=>{const row=capture();recovery.activate(row.id,permit);return row;};
    return {w,recovery,store:recovery.store,storage,docs,queued,reads,order,permit,capture,activate};}
const checkout=(f,row)=>({resumeRecoveryId:row.id,branch,cart:f.w.cart,netTotal:50,paymentMethod:'Cash',customerName:'Sample Customer',amountReceived:100,globalDiscountAmount:0,globalDiscountReason:'',saleId:'sample-sale',receiptId:'SAMPLE-RECEIPT',saleVersion:2,localTimestamp:'2030-01-01T00:00:00Z'});

test('storage refusal prevents capture and never silently discards the original unpaid order',()=>{
    const f=fixture();f.storage.setWriteError(true);assert.throws(f.capture,/safely retain/);assert.deepEqual(f.w.cart,[]);assert.equal(f.store.list(f.recovery.scope()).length,0);
});
test('a durable recovery is visible only on its original device, branch and staff scope',()=>{
    const f=fixture(),row=f.capture(),scope=f.recovery.scope();assert.equal(f.store.list(scope)[0].id,row.id);
    for(const changed of [{deviceId:'another-device'},{branch:'Another Branch'},{staffId:'another-staff',staffName:'Another Crew'}])assert.equal(f.store.list({...scope,...changed}).length,0);
    assert.equal(f.store.list({...scope,staffId:'another-staff',staffName:'Another Crew'},true).length,1);assert.equal(f.store.list({...scope,branch:'Another Branch'},true).length,0);
});
test('successful resume retains a deep original copy until a durable receipt is acknowledged',()=>{
    const f=fixture(),row=f.activate();f.w.cart[0].qty=2;assert.equal(f.store.get(row.id).order.items[0].qty,1);assert.equal(f.recovery.activeId(),row.id);assert.equal(f.w.isResumedParkedOrder,true);
});
test('a checkout with uncertain acknowledgement retries the exact saved sale and receipt identity',async()=>{
    const f=fixture(),row=f.activate(),payload=checkout(f,row);f.recovery.linkCheckout(payload);assert.equal(f.store.get(row.id).linkedSaleId,'sample-sale');
    const retry={...payload};delete retry.saleId;delete retry.receiptId;delete retry.localTimestamp;delete retry.saleVersion;await f.recovery.prepareCheckout(retry);assert.equal(retry.saleId,'sample-sale');assert.equal(retry.receiptId,'SAMPLE-RECEIPT');assert.ok(f.store.get(row.id));
});
test('a changed received amount, split payment or discount explanation cannot silently replay an old checkout',async()=>{
    const f=fixture(),row=f.activate(),payload=checkout(f,row);f.recovery.linkCheckout(payload);
    for(const change of [{amountReceived:200},{splitDetails:[{method:'Cash',amount:50}]},{globalDiscountReason:'Different reason'},{customerName:'Different customer'}])await assert.rejects(f.recovery.prepareCheckout({...payload,...change}),/earlier checkout attempt/);
    assert.equal(f.store.get(row.id).salePayload.amountReceived,100);
});
test('an existing queued or uploaded linked sale prevents a second recovered checkout',async()=>{
    for(const where of ['queue','server']){const f=fixture(),row=f.activate(),payload=checkout(f,row);f.recovery.linkCheckout(payload);if(where==='queue')f.queued.push({saleId:payload.saleId,payload});else f.docs.set('transactions/'+payload.saleId,payload);
        await assert.rejects(f.recovery.prepareCheckout(payload),/already has a saved receipt/);const before=f.w.cart;assert.equal(await f.recovery.recover(row.id),false);assert.equal(f.w.cart,before);assert.equal(f.store.get(row.id),null);await assert.rejects(f.recovery.prepareCheckout(payload),/already saved/);}
});
test('a failed recovery-key removal cannot tag an unrelated new cart or duplicate its completed receipt',async()=>{
    const f=fixture(),row=f.activate(),payload=checkout(f,row);f.recovery.linkCheckout(payload);f.storage.setRemoveError(true);f.recovery.acknowledgeCheckout(payload);assert.ok(f.store.get(row.id));assert.equal(f.recovery.activeId(),row.id);await assert.rejects(f.recovery.prepareCheckout(payload),/already saved/);
    f.w.cart=[{name:'New customer',qty:1}];assert.equal(f.recovery.activeId(),null);
});
test('reparking an uncertain attempt reuses its ID and compares all saved customer/order details',async()=>{
    const f=fixture(),row=f.activate(),payload={branch,cashier:staffName,items:f.w.cart,total:50,name:'Sample Customer',orderType:'Dine-In',platform:'Standard'};
    const attempt=await f.recovery.preparePark(payload),same=await f.recovery.preparePark({...payload});assert.equal(attempt.id,same.id);assert.equal(attempt.matchesSaved({...payload,timestamp:{seconds:1}}),true);assert.equal(attempt.matchesSaved({...payload,name:'Different'}),false);
    for(const change of [{name:'Changed customer'},{total:70},{orderType:'Takeout'}])await assert.rejects(f.recovery.preparePark({...payload,...change}),/different details/);
    assert.equal(f.store.get(row.id).linkedParkedId,attempt.id);f.recovery.acknowledgePark(attempt.id);assert.equal(f.store.get(row.id),null);
});
test('a server-confirmed repark or void marker retires the old recovery without recreating its cart',async()=>{
    for(const kind of ['park','void']){const f=fixture(),row=f.capture();if(kind==='park'){f.store.put({...row,linkedParkedId:'sample-new-park'});f.docs.set('parked_orders/sample-new-park',{branch,resumeRecoveryId:row.id});}else f.docs.set('transactions/parked-delete-sample-original',{branch,parkedOrderId:row.order.id,status:'Voided'});
        const before=f.w.cart;assert.equal(await f.recovery.recover(row.id),false);assert.equal(f.w.cart,before);assert.equal(f.store.get(row.id),null);}
});
test('a changed cashier or branch cannot checkout an earlier active recovered cart',async()=>{
    const f=fixture(),row=f.activate(),payload=checkout(f,row);f.w.sessionUser={...f.w.sessionUser,staffId:'other',cashierName:'Other Crew'};await assert.rejects(f.recovery.prepareCheckout(payload),/original branch/);assert.ok(f.store.get(row.id));assert.equal(f.w.cart[0].qty,1);
});
test('unconfirmed server proof leaves the recovery available for a later explicit check',async()=>{
    const f=fixture(),row=f.capture();f.w.getDocFromServer=async()=>({metadata:{fromCache:true},exists:()=>false});await assert.rejects(f.recovery.recover(row.id),/Connect to HQ/);assert.ok(f.store.get(row.id));assert.deepEqual(f.w.cart,[]);
});
test('an unacknowledged missing parked order is held instead of resurrecting a competing transfer',async()=>{
    const f=fixture(),row=f.capture();await assert.rejects(f.recovery.recover(row.id),/transfer was not confirmed/);assert.ok(f.store.get(row.id));assert.deepEqual(f.w.cart,[]);
    f.recovery.acknowledgeResume(row.id);assert.equal(await f.recovery.recover(row.id),true);assert.equal(f.w.cart[0].name,'Sample Food');
});
