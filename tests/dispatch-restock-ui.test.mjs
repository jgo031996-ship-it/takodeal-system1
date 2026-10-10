import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {collectDispatchDraft,installDispatchRestockUI} from '../takodeal-manager/dispatch-restock-ui.js';

// Exercise the real UI installer and real transaction callbacks against an
// optimistic in-memory Firestore. No production Firebase or browser is used.
const copy=value=>structuredClone(value);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const user={uid:'synthetic-hq-ui',email:'synthetic-hq-ui@example.test',emailVerified:true};
const profile={email:user.email,fullName:'Synthetic HQ Manager',role:'Manager',permissions:['dispatch','inventory','financial-flow'],assignedBranch:['Main Office','Maa','Cabantian','Citygate']};
const item={name:'Chicken Powder',itemName:'Chicken Powder',qty:2000,rawQty:2,origBaseQty:2000,convRate:1000,selectedUom:'purch',baseUom:'Gram',uom:'Gram',purchaseUom:'Pack',friendlyUom:'Pack'};
function localStorage(initial={}){
    const storage={};
    Object.defineProperties(storage,{
        getItem:{value:key=>Object.hasOwn(storage,key)?storage[key]:null},
        setItem:{value:(key,value)=>{storage[key]=String(value);}},
        removeItem:{value:key=>{delete storage[key];}}
    });
    for(const [key,value]of Object.entries(initial))storage.setItem(key,value);
    return storage;
}
function environment({source='Main Office',destination='Cabantian',currentStock=9000,quantity='2',rows=[item],legacySubmit}={}){
    const h=firestoreHarness();
    for(const [index,name]of ['Main Office','Maa','Cabantian','Citygate'].entries())h.put('branches/branch-'+index,{name,active:true,isFranchise:false});
    for(const branch of ['Main Office','Maa','Cabantian','Citygate'])h.put('inventory/'+branch,{branch,name:item.name,currentStock:branch===source?currentStock:23,uom:'Gram',purchaseUom:'Pack',conversionRate:1000,baseCost:0.2,purchaseCost:200});
    h.put('cash_accounts/hq',{branch:'Main Office',balance:30000});
    const elements={dispFrom:{value:source},dispTo:{value:destination},btnSubmitDispatch:{disabled:false,textContent:'Send delivery'}};
    rows.forEach((row,index)=>{elements['cartQty_'+index]={value:index===0?quantity:String(row.rawQty??row.qty)};});
    const document={getElementById:id=>elements[id]||null};
    // Deliberately stale: UI values, not these old convenience keys, own intent.
    const storage=localStorage({takodeal_dispatch_cart:JSON.stringify(rows),takodeal_dispatch_from:'Main Office',takodeal_dispatch_to:'Maa'});
    const calls={dialogs:[],notifications:[],queries:[],singleReads:[],renders:0,dashboard:0,logs:0,legacySubmit:0,reverts:[],invalidations:[],ids:0};
    const dialogs={async fire(...args){calls.dialogs.push(args);if(args[0]?.input==='text')return {isConfirmed:true,value:'Synthetic Driver'};return {isConfirmed:false};}};
    const baseRead=h.api.getDocsFromServer;
    const api={...h.api,auth:{currentUser:copy(user)},sessionUser:createWorkspaceSession(user,profile),dispatchCart:copy(rows),
        crypto:{subtle:webcrypto.subtle,randomUUID:()=>{calls.ids++;return 'synthetic-'+calls.ids;}},
        async getDocsFromServer(query){calls.queries.push(query);return baseRead(query);},
        async getDocFromServer(reference){calls.singleReads.push(reference.path);const value=copy(h.get(reference.path));return {id:reference.id,ref:reference,exists:()=>value!==undefined,data:()=>copy(value)};},
        renderDispatchCart(){calls.renders++;},async loadDispatchDashboard(){calls.dashboard++;},loadDispatchLogs(){calls.logs++;},
        invalidateCache:key=>calls.invalidations.push(key),ManagerUI:{notify:message=>calls.notifications.push(message)},
        async submitMultiDispatch(){calls.legacySubmit++;return legacySubmit?.({api,elements,calls,h});},async revertAndEditRestock(encoded){calls.reverts.push(JSON.parse(decodeURIComponent(encoded)));},async loadFinancialFlow(){}
    };
    api.getDocs=api.getDocsFromServer;
    api.isBranchAllowed=branch=>api.sessionUser.allowedBranches.includes('All')||api.sessionUser.allowedBranches.includes(branch);
    const ui=installDispatchRestockUI(api,{document,storage,dialogs});
    return {h,api,elements,document,storage,calls,dialogs,ui};
}
const records=(f,table)=>[...f.h.docs].filter(([path])=>path.startsWith(table+'/'));
const snapshot=f=>copy([...f.h.docs]);
const storageSnapshot=f=>Object.fromEntries(Object.keys(f.storage).map(key=>[key,f.storage.getItem(key)]));
const messages=f=>f.calls.dialogs.filter(call=>typeof call[0]==='string').map(call=>call.join(' ')).join('\n');
function linked(f,id,changes={}){
    const row={branch:f.elements.dispTo.value,sourceBranch:f.elements.dispFrom.value,status:'Drafting',requestedBy:'Synthetic Requester',type:'Manual Count',items:[copy(item)],managerMessage:'Original request note',...changes};
    f.h.put('purchase_orders/'+id,row);return copy(row);
}
function awaitDriver(f){
    const opened=deferred(),answer=deferred(),fire=f.dialogs.fire;
    f.dialogs.fire=async(...args)=>{if(args[0]?.input==='text'){f.calls.dialogs.push(args);opened.resolve(args[0]);return answer.promise;}return fire(...args);};
    return {opened,answer};
}
function delayedAcknowledgement(f){
    const committed=deferred(),ack=deferred(),run=f.api.runTransaction;
    f.api.runTransaction=async(...args)=>{const result=await run(...args);committed.resolve(result);await ack.promise;return result;};
    return {committed,ack};
}

test('collect and Send use the current Cabantian selection and latest quantity instead of stale Maa storage or cart data',async()=>{
    const f=environment({quantity:'3.5'}),draft=collectDispatchDraft(f.api,{document:f.document,storage:f.storage});
    assert.equal(draft.destination,'Cabantian');assert.equal(draft.items[0].rawQty,3.5);assert.equal(draft.items[0].qty,3500);
    await f.api.submitMultiDispatch();
    const delivery=records(f,'dispatch_logs')[0]?.[1];assert.ok(delivery,messages(f));
    assert.equal(delivery.toBranch,'Cabantian');assert.equal(delivery.sourceBranch,'Main Office');assert.equal(delivery.qty,3500);assert.equal(delivery.displayQty,3.5);
    assert.equal(f.h.get('inventory/Main Office').currentStock,5500);assert.equal(f.h.get('inventory/Cabantian').currentStock,23);
    assert.equal(f.storage.getItem('takodeal_dispatch_to'),null);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.calls.dashboard,1);
    assert.equal(f.elements.btnSubmitDispatch.disabled,false);assert.deepEqual(f.calls.invalidations,['inventory','hq_restocks']);
});

test('Set Aside saves current source, destination and edited quantity and retains every selected original request',async()=>{
    const f=environment({source:'Cabantian',destination:'Citygate',quantity:'4'}),first=linked(f,'request-a'),other=linked(f,'not-selected');
    f.storage.setItem('takodeal_active_po','request-a');const inventory=copy(f.h.get('inventory/Cabantian')),cash=copy(f.h.get('cash_accounts/hq'));
    await f.api.clearDispatchCart();
    const saved=f.h.get('purchase_orders/setaside-synthetic-1');assert.ok(saved,messages(f));
    assert.equal(saved.sourceBranch,'Cabantian');assert.equal(saved.branch,'Citygate');assert.equal(saved.destinationBranch,'Citygate');assert.equal(saved.type,'Merged Set Aside');
    assert.equal(saved.items[0].qty,4000);assert.equal(saved.items[0].rawQty,4);assert.deepEqual(saved.sourcePurchaseOrderIds,['request-a']);
    const original=f.h.get('purchase_orders/request-a');assert.equal(original.status,'Merged');assert.equal(original.mergedInto,'setaside-synthetic-1');
    assert.deepEqual(original.items,first.items);assert.equal(original.requestedBy,first.requestedBy);assert.equal(original.managerMessage,first.managerMessage);
    assert.deepEqual(f.h.get('purchase_orders/not-selected'),other);assert.deepEqual(f.h.get('inventory/Cabantian'),inventory);assert.deepEqual(f.h.get('cash_accounts/hq'),cash);
    assert.equal(records(f,'dispatch_logs').length,0);assert.match(messages(f),/original requests are retained/i);assert.deepEqual(f.api.dispatchCart,[]);
});

test('negative HQ preview shows the separate old-balance correction and last-price estimate before the confirmed atomic delivery',async()=>{
    const f=environment({currentStock:-82500,quantity:'7.5'}),driver=awaitDriver(f),before=snapshot(f);
    const sending=f.api.submitMultiDispatch(),dialog=await driver.opened.promise;
    assert.deepEqual(snapshot(f),before);assert.equal(f.elements.btnSubmitDispatch.disabled,true);assert.match(dialog.title,/Cabantian/);
    assert.match(dialog.html,/₱1,500\.00/);assert.match(dialog.html,/Restock: 7,500 Gram/);assert.match(dialog.html,/-82,500 Gram/);
    assert.match(dialog.html,/correction is excluded from the purchase cost/);assert.match(dialog.html,/does not record a cash payment/);
    driver.answer.resolve({isConfirmed:true,value:'  Synthetic Driver  '});await sending;
    const invoice=records(f,'hq_restocks')[0]?.[1];assert.ok(invoice,messages(f));assert.equal(invoice.totalCost,1500);assert.equal(invoice.items[0].restockQty,7500);assert.equal(invoice.items[0].correctionQty,82500);
    assert.equal(records(f,'dispatch_logs')[0][1].driver,'Synthetic Driver');assert.equal(f.h.get('inventory/Main Office').currentStock,0);assert.equal(f.h.get('cash_accounts/hq').balance,30000);
    assert.equal(records(f,'expenses').length,0);assert.equal(records(f,'account_logs').length,0);
});

test('cancelling the driver dialog makes no writes, no saved attempt and keeps the complete draft for retry',async()=>{
    const f=environment({currentStock:-10}),driver=awaitDriver(f),before=snapshot(f),saved=storageSnapshot(f),cart=f.api.dispatchCart;
    const pending=f.api.submitMultiDispatch();await driver.opened.promise;driver.answer.resolve({isConfirmed:false});await pending;
    assert.deepEqual(snapshot(f),before);assert.deepEqual(storageSnapshot(f),saved);assert.equal(f.api.dispatchCart,cart);assert.equal(f.calls.ids,0);
    assert.equal(f.elements.btnSubmitDispatch.disabled,false);assert.equal(f.elements.btnSubmitDispatch.textContent,'Send delivery');
});

test('lost Send acknowledgement retries the same ID, driver and preview without duplicate stock, restock or delivery writes',async()=>{
    const f=environment({currentStock:-10}),cart=f.api.dispatchCart;f.h.loseNextAck();await f.api.submitMultiDispatch();
    assert.equal(f.api.dispatchCart,cart);const attempt=JSON.parse(f.storage.getItem('takodeal_dispatch_attempt'));assert.equal(attempt.id,'dispatch-synthetic-1');assert.match(messages(f),/Connection lost after commit/);
    assert.equal(records(f,'dispatch_logs').length,1);assert.equal(records(f,'hq_restocks').length,1);const committed=snapshot(f);
    await f.api.submitMultiDispatch();assert.deepEqual(snapshot(f),committed);assert.equal(f.calls.ids,1);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.storage.getItem('takodeal_dispatch_attempt'),null);
    const retries=f.calls.dialogs.filter(call=>call[0]?.input==='text');assert.equal(retries.length,2);assert.equal(retries[1][0].title,'Retry saved delivery');assert.equal(retries[1][0].inputValue,'Synthetic Driver');
});

test('lost Set Aside acknowledgement reuses its stable ID and preserves the original linked request on retry',async()=>{
    const f=environment();linked(f,'request-a');f.storage.setItem('takodeal_active_po','request-a');const cart=f.api.dispatchCart;f.h.loseNextAck();
    await f.api.clearDispatchCart();const attempt=JSON.parse(f.storage.getItem('takodeal_set_aside_attempt'));assert.equal(attempt.id,'setaside-synthetic-1');assert.equal(f.api.dispatchCart,cart);
    assert.equal(f.h.get('purchase_orders/request-a').status,'Merged');const committed=snapshot(f);await f.api.clearDispatchCart();
    assert.deepEqual(snapshot(f),committed);assert.equal(f.calls.ids,1);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.storage.getItem('takodeal_set_aside_attempt'),null);assert.equal(records(f,'purchase_orders').length,2);
});

test('failed Send and Set Aside commits retain the draft and stable attempt, restore the button and succeed on an unchanged retry',async()=>{
    for(const action of ['submitMultiDispatch','clearDispatchCart']){
        const f=environment(),before=snapshot(f),cart=f.api.dispatchCart,saved=storageSnapshot(f);f.h.failNextCommit();await f.api[action]();
        assert.deepEqual(snapshot(f),before,action);assert.equal(f.api.dispatchCart,cart);assert.equal(f.storage.getItem('takodeal_dispatch_cart'),saved.takodeal_dispatch_cart);assert.equal(f.storage.getItem('takodeal_dispatch_to'),'Maa');
        assert.equal(f.elements.btnSubmitDispatch.disabled,false);assert.match(messages(f),/Commit rejected/);assert.equal(f.calls.ids,1);
        await f.api[action]();assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.calls.ids,1);assert.equal(records(f,action==='submitMultiDispatch'?'dispatch_logs':'purchase_orders').length,1);
    }
});

test('a changed draft after a committed Send acknowledgement preserves the new cart, selections, linked IDs and stored quantities',async()=>{
    const f=environment(),delay=delayedAcknowledgement(f),pending=f.api.submitMultiDispatch();await delay.committed.promise;
    const newer=[{...item,qty:5000,rawQty:5}],stored=JSON.stringify(newer);f.api.dispatchCart=newer;f.elements.dispTo.value='Citygate';f.elements.cartQty_0.value='5';
    f.storage.setItem('takodeal_dispatch_cart',stored);f.storage.setItem('takodeal_dispatch_to','Citygate');f.storage.setItem('takodeal_active_po','new-request');f.storage.setItem('takodeal_draft_qty_new','5');
    delay.ack.resolve();await pending;assert.equal(f.api.dispatchCart,newer);assert.equal(f.storage.getItem('takodeal_dispatch_cart'),stored);assert.equal(f.storage.getItem('takodeal_dispatch_to'),'Citygate');
    assert.equal(f.storage.getItem('takodeal_active_po'),'new-request');assert.equal(f.storage.getItem('takodeal_draft_qty_new'),'5');assert.equal(f.calls.dashboard,0);assert.equal(f.calls.logs,1);assert.match(f.calls.notifications[0],/newer draft was kept/i);
    assert.equal(records(f,'dispatch_logs')[0][1].toBranch,'Cabantian');assert.equal(records(f,'dispatch_logs')[0][1].qty,2000);
});

test('a newer draft remains intact when Set Aside finishes its captured legitimate old save',async()=>{
    const f=environment(),delay=delayedAcknowledgement(f),pending=f.api.clearDispatchCart();await delay.committed.promise;
    const newer=[{...item,qty:3000,rawQty:3}];f.api.dispatchCart=newer;f.elements.dispFrom.value='Maa';f.elements.dispTo.value='Citygate';f.elements.cartQty_0.value='3';
    f.storage.setItem('takodeal_dispatch_cart',JSON.stringify(newer));f.storage.setItem('takodeal_dispatch_from','Maa');f.storage.setItem('takodeal_dispatch_to','Citygate');f.storage.setItem('takodeal_active_po','new-request');
    const saved=storageSnapshot(f);delay.ack.resolve();await pending;
    assert.equal(f.api.dispatchCart,newer);assert.deepEqual(storageSnapshot(f),saved);assert.equal(f.h.get('purchase_orders/setaside-synthetic-1').branch,'Cabantian');assert.match(messages(f),/newer draft was kept/i);
});

test('sign-out, permission revocation and branch-scope removal during driver confirmation cause zero writes',async()=>{
    for(const mode of ['sign-out','permission','scope','session']){
        const f=environment({currentStock:-10}),driver=awaitDriver(f),before=snapshot(f),cart=f.api.dispatchCart,pending=f.api.submitMultiDispatch();await driver.opened.promise;
        if(mode==='sign-out')f.api.auth.currentUser=null;if(mode==='permission')f.api.sessionUser.permissions=['inventory'];if(mode==='scope')f.api.sessionUser.allowedBranches=['Main Office'];if(mode==='session')f.api.sessionUser={...f.api.sessionUser};
        driver.answer.resolve({isConfirmed:true,value:'Synthetic Driver'});await pending;
        assert.deepEqual(snapshot(f),before,mode);assert.equal(f.api.dispatchCart,cart);assert.equal(f.storage.getItem('takodeal_dispatch_attempt'),null);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
        assert.match(messages(f),/Google|access|account|draft changed/i,mode);
    }
});

test('changed current source, destination or quantity during driver confirmation refuses the old plan and retains the latest form',async()=>{
    for(const field of ['dispFrom','dispTo','cartQty_0']){
        const f=environment(),driver=awaitDriver(f),before=snapshot(f),pending=f.api.submitMultiDispatch();await driver.opened.promise;
        const latest=field==='dispFrom'?'Maa':field==='dispTo'?'Citygate':'8';f.elements[field].value=latest;driver.answer.resolve({isConfirmed:true,value:'Synthetic Driver'});await pending;
        assert.deepEqual(snapshot(f),before,field);assert.equal(f.elements[field].value,latest);assert.equal(f.storage.getItem('takodeal_dispatch_attempt'),null);assert.equal(f.api.dispatchCart.length,1);assert.match(messages(f),/draft changed/);
    }
});

test('duplicate Send and Set Aside clicks during a confirmation or save cannot open a second operation',async()=>{
    const f=environment(),driver=awaitDriver(f),sending=f.api.submitMultiDispatch();await driver.opened.promise;
    await Promise.all([f.api.submitMultiDispatch(),f.api.clearDispatchCart()]);assert.equal(f.calls.dialogs.length,1);assert.equal(f.calls.ids,0);assert.equal(records(f,'purchase_orders').length,0);
    driver.answer.resolve({isConfirmed:true,value:'Synthetic Driver'});await sending;assert.equal(records(f,'dispatch_logs').length,1);assert.equal(f.calls.ids,1);
    const aside=environment(),delay=delayedAcknowledgement(aside),saving=aside.api.clearDispatchCart();await delay.committed.promise;
    await Promise.all([aside.api.clearDispatchCart(),aside.api.submitMultiDispatch()]);assert.equal(aside.calls.ids,1);assert.equal(records(aside,'purchase_orders').length,1);assert.equal(aside.calls.dialogs.length,0);delay.ack.resolve();await saving;
});

test('a changed draft after lost acknowledgement cannot silently create another delivery or pending request',async()=>{
    for(const [action,key]of [['submitMultiDispatch','takodeal_dispatch_attempt'],['clearDispatchCart','takodeal_set_aside_attempt']]){
        const f=environment();f.h.loseNextAck();await f.api[action]();const prior=f.storage.getItem(key),committed=snapshot(f);
        f.elements.cartQty_0.value='4';await f.api[action]();assert.deepEqual(snapshot(f),committed);assert.equal(f.storage.getItem(key),prior);assert.equal(f.calls.ids,1);assert.equal(f.elements.cartQty_0.value,'4');assert.equal(f.api.dispatchCart.length,1);assert.match(messages(f),/already saved/);
    }
});

test('an unchanged lost-ack retry refuses a different driver and keeps the original attempt for a safe retry',async()=>{
    const f=environment();f.h.loseNextAck();await f.api.submitMultiDispatch();const committed=snapshot(f),attempt=f.storage.getItem('takodeal_dispatch_attempt');
    const fire=f.dialogs.fire;f.dialogs.fire=async(...args)=>args[0]?.input==='text'?(f.calls.dialogs.push(args),{isConfirmed:true,value:'Different Driver'}):fire(...args);
    await f.api.submitMultiDispatch();assert.deepEqual(snapshot(f),committed);assert.equal(f.storage.getItem('takodeal_dispatch_attempt'),attempt);assert.equal(f.calls.ids,1);assert.equal(f.api.dispatchCart.length,1);assert.match(messages(f),/saved driver name/);
});

test('non-HQ source remains a normal stock transfer with actual selected source and no automatic HQ purchase',async()=>{
    const f=environment({source:'Maa',destination:'Cabantian',currentStock:6000,quantity:'3'});await f.api.submitMultiDispatch();
    const delivery=records(f,'dispatch_logs')[0]?.[1];assert.ok(delivery,messages(f));assert.equal(delivery.sourceBranch,'Maa');assert.equal(delivery.toBranch,'Cabantian');assert.equal(delivery.qty,3000);
    assert.equal(f.h.get('inventory/Maa').currentStock,3000);assert.equal(f.h.get('inventory/Main Office').currentStock,23);assert.equal(records(f,'hq_restocks').length,0);assert.equal(f.h.get('cash_accounts/hq').balance,30000);
});

test('legacy Revert & Edit refuses a fresh linked invoice even when the supplied payload disguises it as a manual purchase',async()=>{
    for(const marker of [{dispatchAutoRestock:true},{dispatchBatchId:'saved-delivery'}]){
        const f=environment();f.h.put('hq_restocks/linked',{...marker,totalCost:150,items:[{name:item.name,qty:1000}],supplier:'Linked estimate'});const before=snapshot(f);
        await f.api.revertAndEditRestock(encodeURIComponent(JSON.stringify({id:'linked',dispatchAutoRestock:false,dispatchBatchId:'',totalCost:999999})));
        assert.deepEqual(f.calls.singleReads,['hq_restocks/linked']);assert.equal(f.calls.reverts.length,0);assert.deepEqual(snapshot(f),before);assert.match(messages(f),/linked to a saved delivery/);
    }
});

test('legacy manual invoice editing receives fresh saved data, not forged client quantities or prices',async()=>{
    const f=environment(),saved={branch:'Main Office',totalCost:150,supplier:'Synthetic supplier',items:[{name:item.name,qty:1000}],timestamp:{seconds:1}};f.h.put('hq_restocks/manual',saved);
    await f.api.revertAndEditRestock(encodeURIComponent(JSON.stringify({id:'manual',totalCost:900000,items:[],supplier:'Forged supplier',dispatchAutoRestock:true})));
    assert.deepEqual(f.calls.reverts,[{...saved,id:'manual'}]);assert.deepEqual(f.calls.singleReads,['hq_restocks/manual']);assert.equal(messages(f),'');
});

test('missing or malformed invoice arguments fail visibly without invoking the legacy destructive handler',async()=>{
    for(const input of [encodeURIComponent(JSON.stringify({id:'missing'})),'%not-json']){
        const f=environment(),before=snapshot(f);await f.api.revertAndEditRestock(input);assert.equal(f.calls.reverts.length,0);assert.deepEqual(snapshot(f),before);assert.match(messages(f),/Restock needs review/);
    }
});

function financialFixture(){
    const f=environment(),html=[];
    f.elements.financialFlowchartContainer={insertAdjacentHTML:(position,value)=>{assert.equal(position,'beforeend');html.push(value);}};
    f.elements.flowBranchFilter={value:'Cabantian'};f.elements.flowTimeFilter={value:'month'};f.elements.flowMonthPicker={value:'2026-10'};f.elements.flowYearPicker={value:'2026'};
    const rows=[{id:'synthetic-linked',dispatchAutoRestock:true,dispatchBatchId:'synthetic-batch',toBranch:'Cabantian',timestamp:new Date('2026-10-10T08:00:00+08:00'),costStatus:'Estimated',totalCost:150,
        items:[{name:item.name,restockQty:750,baseUom:'Gram',purchaseQty:0.75,purchaseUom:'Pack',estimatedSubtotal:150,correctionQty:50}]},
        {id:'synthetic-other-branch',dispatchAutoRestock:true,dispatchBatchId:'synthetic-other',toBranch:'Maa',timestamp:new Date('2026-10-10T08:00:00+08:00'),costStatus:'Estimated',totalCost:999,items:[{name:'Other stock',restockQty:1,baseUom:'Unit',estimatedSubtotal:999}]},
        {id:'manual-invoice',toBranch:'Cabantian',timestamp:new Date('2026-10-10T08:00:00+08:00'),totalCost:900000,items:[]}];
    f.api.where=(key,op,value)=>({key,op,value});
    const read=f.api.getDocsFromServer;
    f.api.getDocsFromServer=async query=>{if(query.table!=='hq_restocks')return read(query);f.calls.queries.push(query);return {docs:rows.map(row=>({id:row.id,data:()=>copy(row)}))};};
    return {...f,html};
}

test('Financial Flow appends only selected-branch linked estimates and explicitly excludes purchases, corrections and cash movements from profit',async()=>{
    const f=financialFixture(),before=snapshot(f);await f.api.loadFinancialFlow();assert.deepEqual(snapshot(f),before);assert.equal(f.html.length,1);
    assert.match(f.html[0],/HQ restock for Cabantian/);assert.match(f.html[0],/₱150\.00/);assert.match(f.html[0],/Old negative-stock correction:/);assert.match(f.html[0],/do not deduct cash, create an expense, or change the profit/);
    assert.doesNotMatch(f.html[0],/Other stock|900,000|₱999\.00/);const q=f.calls.queries.find(query=>query.table==='hq_restocks');assert.deepEqual(q.filters.map(filter=>filter.op),['>=','<=']);
});

test('Financial Flow discards late estimate results after account, session, branch or permission changes',async()=>{
    for(const mode of ['account','session','branch','permission']){
        const f=financialFixture(),opened=deferred(),result=deferred(),read=f.api.getDocsFromServer;
        f.api.getDocsFromServer=async query=>{if(query.table!=='hq_restocks')return read(query);opened.resolve();await result.promise;return read(query);};
        const pending=f.api.loadFinancialFlow();await opened.promise;
        if(mode==='account')f.api.auth.currentUser=null;if(mode==='session')f.api.sessionUser={...f.api.sessionUser};if(mode==='branch')f.elements.flowBranchFilter.value='Maa';if(mode==='permission')f.api.sessionUser.permissions=['dispatch','inventory'];
        result.resolve();await pending;assert.deepEqual(f.html,[],mode+' must not append a stale financial report');
    }
});

test('the Franchise compatibility path keeps one busy owner until its captured legacy request finishes',async()=>{
    const started=deferred(),finish=deferred();let actualRequests=0;
    const f=environment({legacySubmit:async({elements})=>{
        // Mirrors the existing main.js compatibility handler's button lock.
        if(elements.btnSubmitDispatch.disabled)return;
        actualRequests++;elements.btnSubmitDispatch.disabled=true;started.resolve();
        try{await finish.promise;}finally{elements.btnSubmitDispatch.disabled=false;}
    }});
    f.api.sessionUser=createWorkspaceSession(user,{...profile,role:'Franchisee',assignedBranch:'Cabantian',permissions:['dispatch']});
    const first=f.api.submitMultiDispatch();await started.promise;
    try{
        await Promise.all([f.api.submitMultiDispatch(),f.api.clearDispatchCart()]);
        assert.equal(f.calls.legacySubmit,1,'a second compatibility invocation must not unlock the first');
        assert.equal(actualRequests,1);assert.equal(f.elements.btnSubmitDispatch.disabled,true);assert.equal(records(f,'purchase_orders').length,0);
    }finally{finish.resolve();await first;}
    assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

test('a confirmed save followed by failed UI refresh is reported as saved and never as a failed financial or stock commit',async()=>{
    for(const action of ['submitMultiDispatch','clearDispatchCart']){
        const f=environment({currentStock:-10});
        if(action==='submitMultiDispatch')f.api.loadDispatchDashboard=async()=>{throw Error('Synthetic post-save refresh failure');};
        else f.api.renderDispatchCart=()=>{throw Error('Synthetic post-save render failure');};
        await f.api[action]();
        assert.equal(records(f,action==='submitMultiDispatch'?'dispatch_logs':'purchase_orders').length,1);
        if(action==='submitMultiDispatch')assert.equal(records(f,'hq_restocks').length,1);
        assert.equal(f.h.get('cash_accounts/hq').balance,30000);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
        assert.match(messages(f),/saved/i);assert.doesNotMatch(messages(f),/Delivery was not sent|Draft was not saved/);
        assert.equal(f.calls.ids,1,'refresh failure must never automatically replay the write');
    }
});

test('the actual Manager entry imports every new runtime symbol from a real local export and installs UI after final legacy handlers',async()=>{
    const file=new URL('../takodeal-manager/main.js',import.meta.url),source=await readFile(file,'utf8');
    const imports=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].map(match=>({names:match[1].split(',').map(value=>value.trim().split(/\s+as\s+/)),path:match[2]}));
    for(const [name,path]of [
        ['installDispatchRestockUI','./dispatch-restock-ui.js'],['renderAutoRestockInvoiceRow','./dispatch-restock-ui.js'],
        ['isDispatchAutoRestock','./dispatch-restock-model.js'],['collectDispatchRestockEstimates','./dispatch-restock-finance.js']
    ]){
        const entry=imports.find(value=>value.path===path&&value.names.some(([exported,local])=>(local||exported)===name));
        assert.ok(entry,name+' must be bound in the actual main.js entry, not just used in a function body');
        const module=await import(new URL(path,file));const exported=entry.names.find(([value,local])=>(local||value)===name)[0];
        assert.equal(typeof module[exported],'function',name+' must exist in the shipped dependency');
    }
    const installer=source.lastIndexOf('installDispatchRestockUI(window)');assert.ok(installer>0);
    for(const handler of ['submitMultiDispatch','clearDispatchCart','revertAndEditRestock','loadFinancialFlow']){
        const assignments=[...source.matchAll(new RegExp('window\\.'+handler+'\\s*=','g'))];assert.ok(assignments.length>0,handler+' legacy handler must exist');
        assert.ok(assignments.every(match=>match.index<installer),'the new UI must wrap the final '+handler+' handler');
    }
});
