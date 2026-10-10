import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as meal from '../Takodeal-POS/meal-checkout.js';
import {installSaleSafety} from '../Takodeal-POS/pos-checkout.js';
import {createSaleEngine} from '../Takodeal-POS/pos-safety.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

const start=new Date('2026-10-10T00:00:00+08:00'),today=new Date('2026-10-10T12:00:00+08:00');
const missingIndex=(code='failed-precondition',message='The query requires an index. You can create it here: https://console.firebase.google.com/example')=>Object.assign(Error(message),{code});
const staffName='Synthetic Staff';
const request=(id,timestamp=today,changes={})=>({id,staffName,timestamp,type:'Staff Meal (POS Auto)',mealRole:'staff',status:'Pending',...changes});
const requestSnapshot=row=>({id:row.id,data:()=>({...row})});
const docs=result=>{const rows=result.docs??result;assert.ok(Array.isArray(rows),'The returned meal claims must include document snapshots.');return rows;};
function lookup({compoundError=null,fast=[],fallback=[]}={}){
    const calls=[],api={db:{},collection:(_,table)=>({table}),where:(key,op,value)=>({key,op,value}),query:(table,...filters)=>({...table,filters}),async getDocsFromServer(query){
        calls.push(query);assert.equal(query.table,'staff_requests');assert.equal(query.filters.filter(filter=>filter.key==='staffName'&&filter.op==='=='&&filter.value===staffName).length,1);
        if(query.filters.length===2){if(compoundError)throw compoundError;return {docs:fast.map(requestSnapshot)};}
        assert.equal(query.filters.length,1,'The fallback must be one exact staff-name filter, without a date, limit or whole-collection read.');return {docs:fallback.filter(row=>row.staffName===staffName).map(requestSnapshot)};
    }};
    return {api,calls,read:()=>meal.readStaffMealClaims(api,{staffName,start})};
}
const ids=result=>docs(result).map(row=>row.id);

test('available compound index keeps the fresh exact-name/date server lookup and avoids fallback reads',async()=>{
    const f=lookup({fast:[request('today')]});assert.deepEqual(ids(await f.read()),['today']);assert.equal(f.calls.length,1);
    assert.deepEqual(f.calls[0].filters,[{key:'staffName',op:'==',value:staffName},{key:'timestamp',op:'>=',value:start}]);
});

for(const code of ['failed-precondition','firestore/failed-precondition'])test(`${code} missing-index error uses only an exact-name server fallback and filters historical meals`,async()=>{
    const f=lookup({compoundError:missingIndex(code),fallback:[request('old',new Date(+start-1)),request('today'),request('other-person',today,{staffName:'Another Synthetic Staff'})]});
    assert.deepEqual(ids(await f.read()),['today']);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].filters,[{key:'staffName',op:'==',value:staffName}]);
});

test('fallback preserves Firestore timestamps, Date, serialized timestamps and ISO date boundaries',async()=>{
    const rows=[request('Date',today),request('toMillis',{toMillis:()=>+today}),request('toDate',{toDate:()=>today}),request('seconds',{seconds:+today/1000,nanoseconds:500000000}),request('ISO',today.toISOString()),request('at-start',{seconds:+start/1000,nanoseconds:0}),request('before-start',{seconds:+start/1000-1,nanoseconds:999000000})];
    const f=lookup({compoundError:missingIndex(),fallback:rows});assert.deepEqual(ids(await f.read()),rows.slice(0,6).map(row=>row.id));
});

for(const [code,message]of [['permission-denied','Missing or insufficient permissions.'],['unavailable','The service is unavailable.'],['failed-precondition','The transaction requires a different state.'],['unknown','The query requires an index.']])test(`${code}: ${message} never causes a permission or unrelated-error fallback`,async()=>{
    const problem=missingIndex(code,message),f=lookup({compoundError:problem,fallback:[request('today')]});await assert.rejects(f.read(),error=>error===problem);assert.equal(f.calls.length,1);
});

test('fallback query failure propagates rather than allowing an unverified Staff meal',async()=>{
    const f=lookup({compoundError:missingIndex()}),read=f.api.getDocsFromServer,problem=Object.assign(Error('Fallback denied'),{code:'permission-denied'});
    f.api.getDocsFromServer=query=>query.filters.length===1?Promise.reject(problem):read(query);await assert.rejects(f.read(),error=>error===problem);
});

for(const timestamp of [undefined,null,'not-a-date',{seconds:'invalid'},{toMillis:()=>NaN}])test(`fallback refuses an eligible meal with untrustworthy timestamp ${String(timestamp)}`,async()=>{
    const f=lookup({compoundError:missingIndex(),fallback:[request('unknown-time',today,{timestamp})]});await assert.rejects(f.read(),/HQ|review|timestamp|time|date/i);
});

test('invalid timestamps in Voided meals and unrelated requests do not invent a daily meal claim',async()=>{
    const f=lookup({compoundError:missingIndex(),fallback:[request('voided',null,{status:'Voided'}),request('advance',null,{type:'Cash Advance',mealRole:null}),request('another',null,{staffName:'Another Synthetic Staff'})]});
    assert.deepEqual(ids(await f.read()),[]);
});

// An asynchronous IndexedDB stand-in, used by the actual durable outbox code.
// Browser outbox tests separately verify native locking and persistence.
function memoryIndexedDB(){
    const rows=new Map(),db={createObjectStore(){},transaction(){
        let pending=0,finished=false;const tx={objectStore:()=>store,abort(){finished=true;queueMicrotask(()=>tx.onabort?.());}};
        function request(action){const req={};pending++;queueMicrotask(()=>{if(finished)return;try{req.result=structuredClone(action());req.onsuccess?.();}catch(error){req.error=error;req.onerror?.();tx.abort();}pending--;queueMicrotask(()=>{if(!pending&&!finished){finished=true;tx.oncomplete?.();}});});return req;}
        const store={get:id=>request(()=>rows.get(id)),getAll:()=>request(()=>[...rows.values()]),add:row=>request(()=>rows.set(row.saleId,structuredClone(row))),put:row=>request(()=>rows.set(row.saleId,structuredClone(row))),delete:id=>request(()=>rows.delete(id))};return tx;
    }};return {open(){const req={result:db};queueMicrotask(()=>{req.onupgradeneeded?.();req.onsuccess?.();});return req;}};
}
function checkout({claimRows=[],requestError=missingIndex()}={}){
    const h=firestoreHarness(),nodes={},calls=[],notices=[],alerts=[],storage=new Map([['takodeal_device_branch','Maa']]);
    for(const id of ['btnSubmitFinal','checkoutDiscountType','checkoutStaffPin','checkoutDiscountValue','checkoutDiscountReason','finalCustomerName','mainOrderType','finalDeliveryAddress','finalContactNumber','rcptId','rcptDate','rcptTime','rcptTotal','rcptPaid','rcptChange','receiptModal'])nodes[id]={value:'',innerText:'',style:{}};
    Object.assign(nodes.checkoutDiscountType,{value:'staff_meal'});nodes.checkoutStaffPin.value='5678';nodes.checkoutDiscountReason.value='Authorized Staff meal';nodes.mainOrderType.value='Dine-In';
    const document={getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],addEventListener(){}};
    h.put('inventory/batter',{branch:'Maa',name:'Batter',currentStock:100,uom:'Gram'});h.put('cash_accounts/hq',{balance:30000});h.put('cash_accounts/maa',{balance:2000});
    h.put('cashiers/synthetic-staff',{cashierName:staffName,pin:'5678',role:'Staff'});
    h.put('settings/global_pos_config',{staffMealTakoPct:20,staffMealOtherPct:10});
    const api=h.api,baseRead=api.getDocsFromServer;
    api.where=(key,op,value)=>({key,op,value});api.getDocFromServer=async ref=>{const value=structuredClone(h.get(ref.path));return {id:ref.id,exists:()=>value!==undefined,data:()=>structuredClone(value)};};
    api.getDocsFromServer=async query=>{
        calls.push(query);if(query.table==='hq_managers')throw Error('A Staff-only meal must not read the protected HQ directory.');
        if(query.table==='staff_requests'){if(query.filters.some(filter=>filter.key==='timestamp')&&requestError)throw requestError;return {docs:claimRows.map(requestSnapshot)};}
        return baseRead(query);
    };
    const w={...api,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
        masterPOSData:{items:[],bom:[{menuItem:'6 Pcs Takoyaki',ingredientName:'Batter',qty:6}],settings:{}},sessionUser:{branch:'Maa',cashierName:'Synthetic Cashier'},currentShift:{shiftId:'synthetic-shift'},cart:[{name:'6 Pcs Takoyaki',qty:1,lineTotalFinal:100}],currentGrandTotal:100,finalCheckoutAmount:80,finalCheckoutDiscount:20,selectedPaymentMethod:'Cash',amountReceivedStr:'0',posPlatform:'Store POS',
        addEventListener(){},Swal:{fire:(...args)=>{notices.push(args);return Promise.resolve({});}},updateNumpadDisplay(){},renderCart(){},closeModal(){},updateReceiptSyncStatus(){}};
    const environment={window:w,crypto:webcrypto,indexedDB:memoryIndexedDB(),navigator:{onLine:false},document,localStorage:w.localStorage,setTimeout(){return 1;},setInterval(){return 1;}};
    installSaleSafety(api,environment);meal.installMealCheckout({window:w,document});
    const html=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8'),begin=html.indexOf('window.submitFinalOrder = async function()'),end=html.indexOf('window.updateReceiptSyncStatus = function',begin);
    assert.ok(begin>0&&end>begin);vm.runInNewContext(html.slice(begin,end),{window:w,document,Swal:w.Swal,console,Date,alert:message=>alerts.push(message)});
    return {h,w,nodes,api,environment,calls,notices,alerts,storage};
}
const tableRows=(f,table)=>[...f.h.docs].filter(([path])=>path.startsWith(table+'/'));

test('actual final checkout uses the missing-index fallback, queues one Salary Deduction sale and creates one pending meal request on retry',async()=>{
    const f=checkout(),beforeCash=structuredClone([f.h.get('cash_accounts/hq'),f.h.get('cash_accounts/maa')]);
    await f.w.submitFinalOrder();const queued=await f.w.saleOutbox.list();assert.equal(queued.length,1);const payload=queued[0].payload;
    assert.equal(payload.paymentMethod,'Salary Deduction');assert.equal(payload.paymentVerified,false);assert.equal(payload.mealStaffName,staffName);assert.equal(payload.mealIdentityId,'synthetic-staff');assert.equal(payload.netTotal,80);assert.equal(payload.amountReceived,80);
    assert.equal(f.w.cart.length,0);assert.equal(f.nodes.checkoutStaffPin.value,'');assert.equal(f.nodes.receiptModal.style.display,'flex');assert.equal(f.nodes.btnSubmitFinal.disabled,false);
    assert.equal(f.calls.some(query=>query.table==='hq_managers'),false);assert.ok(f.calls.some(query=>query.table==='staff_requests'&&query.filters.length===1));
    const engine=createSaleEngine(f.api),prepared=await engine.prepare(payload,payload.recipeSnapshot);f.h.loseNextAck();await assert.rejects(engine.commit(prepared),/Connection lost/);await Promise.all(Array.from({length:10},()=>engine.commit(prepared)));
    assert.equal(tableRows(f,'transactions').length,1);assert.equal(tableRows(f,'staff_requests').length,1);assert.equal(f.h.get('inventory/batter').currentStock,94);
    const deductionRequest=tableRows(f,'staff_requests')[0][1];assert.equal(deductionRequest.amount,80);assert.equal(deductionRequest.status,'Pending');assert.equal(deductionRequest.saleId,payload.saleId);assert.equal(deductionRequest.receiptId,payload.receiptId);assert.equal(deductionRequest.type,'Staff Meal (POS Auto)');
    assert.equal(tableRows(f,'staff_deductions').length,0,'The existing HQ approval workflow, not checkout, creates payroll deductions.');
    for(const table of ['remittances','expenses','franchise_ledger'])assert.equal(tableRows(f,table).length,0,table);assert.deepEqual([f.h.get('cash_accounts/hq'),f.h.get('cash_accounts/maa')],beforeCash);
    await f.w.saleOutbox.acknowledge(payload.saleId);assert.equal((await f.w.saleOutbox.list()).length,0);assert.ok(!JSON.stringify(f.h.get('transactions/'+payload.saleId)).includes('"5678"'));
});

test('today Staff meal found by fallback blocks actual final checkout without queuing, cash changes or lost cart',async()=>{
    const f=checkout({claimRows:[request('today',new Date())]}),before=structuredClone([...f.h.docs]),cart=structuredClone(f.w.cart);await f.w.submitFinalOrder();
    assert.deepEqual([...f.h.docs],before);assert.deepEqual(f.w.cart,cart);assert.equal((await f.w.saleOutbox.list()).length,0);assert.equal(f.nodes.btnSubmitFinal.disabled,false);assert.equal(f.w.isSubmittingOrder,false);assert.ok(f.notices.flat().some(value=>typeof value==='string'&&/already claimed/i.test(value)));
});

test('another unsynchronized Staff meal remains a daily-limit blocker before any claim query or second checkout',async()=>{
    const f=checkout();await f.w.saleOutbox.enqueue({saleId:'existing-queued-meal',receiptId:'QUEUED-1',branch:'Maa',netTotal:80,cart:[{name:'Meal',qty:1}],mealStaffName:staffName,mealRole:'staff',localTimestamp:new Date().toISOString()});
    const cart=structuredClone(f.w.cart);await f.w.submitFinalOrder();assert.deepEqual(f.w.cart,cart);assert.equal((await f.w.saleOutbox.list()).length,1);assert.equal(f.calls.filter(query=>query.table==='staff_requests').length,0);assert.equal(tableRows(f,'transactions').length,0);assert.ok(f.notices.flat().some(value=>typeof value==='string'&&/awaiting synchronization/i.test(value)));
});
