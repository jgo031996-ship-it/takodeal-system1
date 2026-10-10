import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {loadStockRequestDraft} from '../takodeal-manager/dispatch-request-draft.js';
import {installDispatchRestockUI} from '../takodeal-manager/dispatch-restock-ui.js';

// The actual request loader, UI installer and atomic stock transaction share
// one optimistic in-memory Firestore. No SDK, production data or network.
const copy=value=>structuredClone(value);
const user={uid:'synthetic-loaded-request',email:'synthetic-loaded-request@example.test',emailVerified:true};
const profile={email:user.email,fullName:'Synthetic HQ Manager',role:'Manager',permissions:['dispatch','inventory'],assignedBranch:['Main Office','Maa','Cabantian']};
const stock={name:'Chicken Powder',branch:'Main Office',currentStock:-82500,uom:'Gram',purchaseUom:'Pack',conversionRate:1000,baseCost:0.2,purchaseCost:200};
const item={name:'Chicken Powder',itemName:'Chicken Powder',qty:2000,rawQty:2,uom:'Gram',baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000};
const manual={...item,rawQty:1,qty:1000,origBaseQty:1000,convRate:1000,selectedUom:'purch',friendlyUom:'Pack'};
function storageFixture(initial={}){
    const storage={};Object.defineProperties(storage,{getItem:{value:key=>Object.hasOwn(storage,key)?storage[key]:null,writable:true},setItem:{value:(key,value)=>{storage[key]=String(value);},writable:true},removeItem:{value:key=>{delete storage[key];},writable:true}});
    for(const [key,value]of Object.entries(initial))storage.setItem(key,value);return storage;
}
function environment({status='Pending',changes={},cart=[],stored={},oldRequests={}}={}){
    const h=firestoreHarness(),po={branch:'Maa',status,type:'Manual Stock Request',requestedBy:'Synthetic Cashier',items:[copy(item)],...copy(changes)};
    h.put('purchase_orders/fresh',po);h.put('inventory/hq',copy(stock));h.put('inventory/maa',{...copy(stock),branch:'Maa',currentStock:17});
    for(const [index,name]of ['Main Office','Maa','Cabantian'].entries())h.put('branches/branch-'+index,{name,active:true,isFranchise:false});
    for(const [id,row]of Object.entries(oldRequests))if(row!==null)h.put('purchase_orders/'+id,{branch:'Maa',sourceBranch:'Main Office',items:[copy(item)],...copy(row)});
    const storage=storageFixture(stored),elements={dispFrom:{value:'Main Office',options:['Main Office','Maa','Cabantian'].map(value=>({value}))},dispTo:{value:'Maa'},btnSubmitDispatch:{disabled:false,textContent:'Send delivery'}},dialogs=[],notifications=[];
    let ids=0;
    const api={...h.api,auth:{currentUser:copy(user)},sessionUser:createWorkspaceSession(user,profile),dispatchCart:copy(cart),crypto:{subtle:webcrypto.subtle,randomUUID:()=>String(++ids)},
        async getDocFromServer(ref){const row=copy(h.get(ref.path));return {ref,id:ref.id,exists:()=>row!==undefined,data:()=>copy(row)};},
        renderDispatchCart(){for(const key of Object.keys(elements))if(key.startsWith('cartQty_'))delete elements[key];api.dispatchCart.forEach((row,index)=>{elements['cartQty_'+index]={value:String(row.rawQty??row.qty)};});},
        invalidateCache(){},async loadDispatchDashboard(){},loadDispatchLogs(){},async loadFinancialFlow(){},async submitMultiDispatch(){throw Error('The legacy submission path must not run.');},async revertAndEditRestock(){throw Error('The legacy restock reversal path must not run.');},
        ManagerUI:{notify:message=>notifications.push(message)}};
    api.getDocs=api.getDocsFromServer;api.getDoc=api.getDocFromServer;api.isBranchAllowed=branch=>api.sessionUser.allowedBranches.includes(branch);
    const document={getElementById:id=>elements[id]||null},Swal={async fire(...args){dialogs.push(args);return args[0]?.input==='text'?{isConfirmed:true,value:'Synthetic Driver'}:{isConfirmed:false};}};
    installDispatchRestockUI(api,{document,storage,dialogs:Swal});api.renderDispatchCart();
    const f={h,api,po:copy(po),storage,elements,document,dialogs,dialogService:Swal,notifications};
    f.load=async()=>{const result=await loadStockRequestDraft(api,{poId:'fresh',po:f.po,hqDetails:{'Chicken Powder':copy(h.get('inventory/hq'))}},{document,storage});api.renderDispatchCart();return result;};
    f.send=()=>api.submitMultiDispatch();return f;
}
const rows=(f,table)=>[...f.h.docs].filter(([path])=>path.startsWith(table+'/'));
const state=f=>copy([...f.h.docs]);
const local=f=>Object.fromEntries(Object.keys(f.storage).sort().map(key=>[key,f.storage.getItem(key)]));
const errors=f=>f.dialogs.map(args=>args.map(value=>typeof value==='string'?value:value&&typeof value==='object'?[value.titleText,value.title,value.text].filter(Boolean).join(' '):'').join(' ')).join('\n');
const request=f=>f.h.get('purchase_orders/fresh');

for(const status of ['Pending','Drafting','Approved'])test(`${status} request loads through real UI and dispatches its edited base quantity exactly once`,async()=>{
    const f=environment({status}),original=copy(request(f));
    assert.equal((await f.load()).loaded,true);assert.equal(request(f).status,'Drafting');assert.equal(f.storage.getItem('takodeal_active_po'),'fresh');
    assert.deepEqual(request(f).items,original.items);assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.api.dispatchCart[0].rawQty,2);
    f.elements.cartQty_0.value='3';await f.send();
    assert.equal(rows(f,'dispatch_logs').length,1,errors(f));const delivery=rows(f,'dispatch_logs')[0][1];
    assert.equal(delivery.qty,3000);assert.equal(delivery.displayQty,3);assert.equal(delivery.toBranch,'Maa');assert.equal(delivery.sourceBranch,'Main Office');
    assert.equal(request(f).status,'Completed');assert.equal(request(f).dispatchBatchId,delivery.batchId);assert.deepEqual(request(f).items,original.items);
    assert.equal(f.h.get('inventory/hq').currentStock,0);assert.equal(f.h.get('inventory/maa').currentStock,17);
    assert.equal(rows(f,'hq_restocks')[0][1].totalCost,600);assert.equal(rows(f,'hq_restocks')[0][1].items[0].restockQty,3000);
    assert.equal(f.storage.getItem('takodeal_active_po'),null);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

for(const closed of ['Completed','Rejected','Merged','Missing'])test(`empty cart recovers a stale ${closed} link before loading and sending a fresh request`,async()=>{
    const row=closed==='Missing'?null:{status:closed,...(closed==='Completed'?{dispatchBatchId:'previous-batch'}:{}),...(closed==='Merged'?{mergedInto:'previous-draft'}:{})};
    const f=environment({stored:{takodeal_active_po:'old',takodeal_dispatch_cart:'[]',takodeal_dispatch_to:'Maa',takodeal_dispatch_from:'Main Office'},oldRequests:{old:row}}),old=copy(f.h.get('purchase_orders/old'));
    assert.equal((await f.load()).loaded,true);assert.equal(f.storage.getItem('takodeal_active_po'),'fresh');assert.equal(f.api.dispatchCart[0].qty,2000);
    await f.send();assert.equal(rows(f,'dispatch_logs').length,1,errors(f));assert.equal(request(f).status,'Completed');assert.deepEqual(f.h.get('purchase_orders/old'),old);
});

for(const status of ['Pending','Drafting','Approved'])test(`empty cart unlinks an old ${status} request without completing its unseen goods`,async()=>{
    const f=environment({stored:{takodeal_active_po:'old',takodeal_dispatch_cart:'[]',takodeal_dispatch_to:'Maa',takodeal_dispatch_from:'Main Office'},oldRequests:{old:{status}}}),old=copy(f.h.get('purchase_orders/old'));
    assert.equal((await f.load()).loaded,true);assert.equal(f.storage.getItem('takodeal_active_po'),'fresh');assert.equal(f.api.dispatchCart[0].qty,2000);
    await f.send();assert.equal(rows(f,'dispatch_logs').length,1,errors(f));assert.deepEqual(f.h.get('purchase_orders/old'),old);assert.equal(request(f).status,'Completed');assert.equal(rows(f,'dispatch_logs')[0][1].qty,2000);
});

test('empty cart can recover old branch selections and IDs without silently moving an old request',async()=>{
    const f=environment({stored:{takodeal_active_po:'old',takodeal_dispatch_cart:'[]',takodeal_dispatch_to:'Cabantian',takodeal_dispatch_from:'Cabantian'},oldRequests:{old:{status:'Drafting',branch:'Cabantian',sourceBranch:'Maa'}}}),old=copy(f.h.get('purchase_orders/old'));
    f.elements.dispFrom.value='Cabantian';f.elements.dispTo.value='Cabantian';assert.equal((await f.load()).loaded,true);
    assert.equal(f.storage.getItem('takodeal_active_po'),'fresh');assert.equal(f.elements.dispFrom.value,'Main Office');assert.equal(f.elements.dispTo.value,'Maa');
    await f.send();assert.equal(rows(f,'dispatch_logs').length,1,errors(f));assert.deepEqual(f.h.get('purchase_orders/old'),old);assert.equal(rows(f,'dispatch_logs')[0][1].toBranch,'Maa');
});

for(const status of ['Pending','Drafting'])test(`empty cart with the requested ${status} ID restores its actual rows instead of falsely reporting already loaded`,async()=>{
    const f=environment({status,stored:{takodeal_active_po:'fresh',takodeal_dispatch_cart:'[]',takodeal_dispatch_to:'Maa',takodeal_dispatch_from:'Main Office'}});
    const result=await f.load();assert.equal(result.loaded,true);assert.notEqual(result.alreadyLoaded,true);assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.storage.getItem('takodeal_active_po'),'fresh');
    await f.send();assert.equal(rows(f,'dispatch_logs').length,1,errors(f));assert.equal(request(f).status,'Completed');
});

for(const invalid of ['Completed','Rejected','Merged','Missing','Different branch'])test(`populated cart with an invalid ${invalid} link is preserved and rejected before adding a new request`,async()=>{
    const row=invalid==='Missing'?null:{status:invalid==='Different branch'?'Drafting':invalid,...(invalid==='Different branch'?{branch:'Cabantian'}:{})};
    const f=environment({cart:[manual],stored:{takodeal_active_po:'old',takodeal_dispatch_cart:JSON.stringify([manual]),takodeal_dispatch_to:'Maa',takodeal_dispatch_from:'Main Office'},oldRequests:{old:row}}),before=state(f),stored=local(f),cart=copy(f.api.dispatchCart);
    await assert.rejects(f.load(),/request|draft|processed|missing|branch|different|removed/i);
    assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(request(f).status,'Pending');
});

for(const closed of ['Completed','Rejected','Merged','Missing'])test(`already-loaded ${closed} request is freshly rejected and cannot silently reopen`,async()=>{
    const f=environment();await f.load();const cart=copy(f.api.dispatchCart),stored=local(f);
    if(closed==='Missing')f.h.docs.delete('purchase_orders/fresh');else f.h.put('purchase_orders/fresh',{...request(f),status:closed,...(closed==='Completed'?{dispatchBatchId:'other-send'}:{})});
    const before=state(f);await assert.rejects(f.load(),/request|draft|processed|missing|removed/i);
    assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);
});

test('fresh valid already-loaded request preserves typed quantities and sends those edited values',async()=>{
    const f=environment();await f.load();f.api.dispatchCart[0].qty=500;f.api.dispatchCart[0].rawQty=0.5;f.storage.setItem('takodeal_dispatch_cart',JSON.stringify(f.api.dispatchCart));f.api.renderDispatchCart();
    const before=state(f),stored=local(f);assert.equal((await f.load()).alreadyLoaded,true);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.equal(f.elements.cartQty_0.value,'0.5');
    await f.send();assert.equal(rows(f,'dispatch_logs')[0][1].qty,500,errors(f));assert.equal(request(f).status,'Completed');
});

test('lost Send acknowledgement retries the same completed request operation without another stock or invoice write',async()=>{
    const f=environment();await f.load();f.h.loseNextAck();await f.send();
    assert.equal(request(f).status,'Completed');assert.equal(rows(f,'dispatch_logs').length,1);assert.equal(rows(f,'hq_restocks').length,1);assert.ok(f.storage.getItem('takodeal_dispatch_attempt'));assert.equal(f.api.dispatchCart[0].qty,2000);
    const before=state(f);await f.send();assert.deepEqual(state(f),before);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.storage.getItem('takodeal_dispatch_attempt'),null);assert.equal(f.storage.getItem('takodeal_active_po'),null);
});

test('lost draft-status acknowledgement retries its original rows once before the real Send transaction',async()=>{
    const f=environment();f.h.loseNextAck();await assert.rejects(f.load(),/Connection lost after commit/);
    assert.equal(request(f).status,'Drafting');assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.storage.getItem('takodeal_active_po'),null);const operation=copy(request(f).dispatchDraftOperation);
    assert.equal((await f.load()).loaded,true);assert.deepEqual(request(f).dispatchDraftOperation,operation);assert.equal(f.api.dispatchCart[0].qty,2000);
    await f.send();assert.equal(rows(f,'dispatch_logs').length,1,errors(f));assert.equal(rows(f,'dispatch_logs')[0][1].qty,2000);assert.equal(request(f).status,'Completed');
});

test('concurrent fresh loads publish one request quantity and the actual Send posts one delivery',async()=>{
    const f=environment(),results=await Promise.all([f.load(),f.load()]);
    assert.equal(results.filter(result=>result.loaded).length,1);assert.equal(results.filter(result=>result.alreadyLoaded).length,1);assert.equal(f.api.dispatchCart.length,1);assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.storage.getItem('takodeal_active_po'),'fresh');
    await f.send();assert.equal(rows(f,'dispatch_logs').length,1,errors(f));assert.equal(rows(f,'dispatch_logs')[0][1].qty,2000);assert.equal(rows(f,'hq_restocks')[0][1].totalCost,400);
});

test('completed request without this operation marker cannot be dispatched under a new batch ID',async()=>{
    const f=environment();await f.load();f.h.put('purchase_orders/fresh',{...request(f),status:'Completed',dispatchBatchId:'another-batch'});const before=state(f),stored=local(f);
    await f.send();assert.equal(rows(f,'dispatch_logs').length,0);assert.deepEqual(state(f),before);assert.equal(f.storage.getItem('takodeal_active_po'),stored.takodeal_active_po);assert.equal(f.api.dispatchCart[0].qty,2000);assert.match(errors(f),/processed|changed|completed/i);
});

for(const [marker,value]of [['dispatchBatchId','existing-batch'],['mergedInto','existing-merged-request'],['completedAt',{seconds:123}]])test(`legacy Approved request with retained ${marker} cannot reopen as an unprocessed approval`,async()=>{
    const f=environment({status:'Approved',changes:{[marker]:value}}),before=state(f);
    await assert.rejects(f.load(),error=>error.code==='DISPATCH_REQUEST_LINK'&&error.issues?.some(issue=>issue.id==='fresh'&&issue.status==='Approved'));assert.deepEqual(state(f),before);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.storage.getItem('takodeal_active_po'),null);
});

test('another sender processing the request during the driver dialog blocks all stock, invoice and completion changes',async()=>{
    const f=environment();await f.load();const fire=f.dialogService.fire;let savedAfterOtherSender;
    f.dialogService.fire=async(...args)=>{if(args[0]?.input==='text'){f.h.put('purchase_orders/fresh',{...request(f),status:'Completed',dispatchBatchId:'other-manager-batch'});savedAfterOtherSender=state(f);}return fire(...args);};
    await f.send();assert.deepEqual(state(f),savedAfterOtherSender);assert.equal(rows(f,'dispatch_logs').length,0);assert.equal(rows(f,'hq_restocks').length,0);assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.elements.btnSubmitDispatch.disabled,false);assert.match(errors(f),/request|processed|saved delivery/i);
});

test('request destination changed after draft loading cannot move its goods through Send',async()=>{
    const f=environment();await f.load();f.h.put('purchase_orders/fresh',{...request(f),branch:'Cabantian',destinationBranch:'Cabantian'});const before=state(f);
    await f.send();assert.deepEqual(state(f),before);assert.equal(rows(f,'dispatch_logs').length,0);assert.equal(rows(f,'hq_restocks').length,0);assert.equal(f.elements.dispTo.value,'Maa');assert.equal(f.api.dispatchCart[0].qty,2000);assert.match(errors(f),/request|destination|branch/i);
});

const recoveryKey='takodeal_dispatch_recovery_'+user.uid;
function brokenDraft({stored={}}={}){
    return environment({cart:[manual],stored:{takodeal_dispatch_cart:JSON.stringify([manual]),takodeal_dispatch_from:'Main Office',takodeal_dispatch_to:'Maa',takodeal_active_po:'old',takodeal_draft_qty_0:'2.75',...stored},oldRequests:{old:{status:'Completed',dispatchBatchId:'old-batch'}}});
}
function confirmRecovery(f,beforeConfirm=()=>{}){
    const fire=f.dialogService.fire;f.dialogService.fire=async(...args)=>{
        if(args[0]?.confirmButtonText==='Save copy and refresh draft'){beforeConfirm();f.dialogs.push(args);return {isConfirmed:true};}
        return fire(...args);
    };
}

test('explicit confirmed recovery saves edited quantities before clearing only the local broken draft',async()=>{
    const pendingDispatch=JSON.stringify({id:'uncommitted-delivery'}),pendingAside=JSON.stringify({id:'uncommitted-aside'}),f=brokenDraft({stored:{takodeal_dispatch_attempt:pendingDispatch,takodeal_set_aside_attempt:pendingAside}}),before=state(f);
    f.elements.cartQty_0.value='2.75';confirmRecovery(f);assert.equal(await f.api.resetDispatchDraftLinks(),true);
    assert.deepEqual(state(f),before);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
    for(const key of ['takodeal_dispatch_cart','takodeal_dispatch_from','takodeal_dispatch_to','takodeal_active_po','takodeal_dispatch_attempt','takodeal_set_aside_attempt','takodeal_draft_qty_0'])assert.equal(f.storage.getItem(key),null,key);
    const backup=JSON.parse(f.storage.getItem(recoveryKey));assert.equal(backup.version,1);assert.equal(backup.actorUid,user.uid);assert.equal(backup.source,'Main Office');assert.equal(backup.destination,'Maa');assert.deepEqual(backup.purchaseOrderIds,['old']);
    assert.equal(backup.items[0].rawQty,2.75);assert.equal(backup.items[0].qty,2750);assert.equal(backup.items[0].convRate,1000);assert.deepEqual(backup.attempts,{dispatch:pendingDispatch,setAside:pendingAside});assert.ok(Number.isFinite(Date.parse(backup.savedAt)));
    assert.equal(rows(f,'dispatch_logs').length,0);assert.equal(rows(f,'hq_restocks').length,0);assert.equal(f.h.get('inventory/hq').currentStock,-82500);assert.equal(f.h.get('inventory/maa').currentStock,17);
});

test('cancelled broken-link recovery changes no stock, request, quantity or local key',async()=>{
    const f=brokenDraft(),before=state(f),stored=local(f),cart=copy(f.api.dispatchCart);f.elements.cartQty_0.value='2.75';
    assert.equal(await f.api.resetDispatchDraftLinks(),false);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(f.elements.cartQty_0.value,'2.75');assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

test('a valid request link cannot trigger recovery or discard an editable draft',async()=>{
    const f=brokenDraft();f.h.put('purchase_orders/old',{...f.h.get('purchase_orders/old'),status:'Drafting',dispatchBatchId:undefined});const before=state(f),stored=local(f),cart=copy(f.api.dispatchCart);confirmRecovery(f);
    assert.equal(await f.api.resetDispatchDraftLinks(),false);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(f.dialogs.some(args=>args[0]?.confirmButtonText==='Save copy and refresh draft'),false);
});

for(const kind of ['dispatch','setAside'])test(`recovery refuses a committed pending ${kind} operation and keeps its complete local draft`,async()=>{
    const key=kind==='dispatch'?'takodeal_dispatch_attempt':'takodeal_set_aside_attempt',id='saved-'+kind,f=brokenDraft({stored:{[key]:JSON.stringify({id})}});
    f.h.put(kind==='dispatch'?'settings/dispatch_commit_'+id:'purchase_orders/'+id,{id,sourceBranch:'Main Office',branch:'Maa',status:'Pending'});const before=state(f),stored=local(f),cart=copy(f.api.dispatchCart);confirmRecovery(f);
    assert.equal(await f.api.resetDispatchDraftLinks(),false);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(f.storage.getItem(recoveryKey),null);assert.match(errors(f),/already saved|keep this draft/i);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

test('failed recovery backup storage write leaves every existing local key and entered quantity intact',async()=>{
    const f=brokenDraft(),before=state(f),stored=local(f),cart=copy(f.api.dispatchCart),write=f.storage.setItem;f.elements.cartQty_0.value='2.75';
    f.storage.setItem=(key,value)=>{if(key===recoveryKey)throw Error('Synthetic backup storage full');write(key,value);};confirmRecovery(f);
    assert.equal(await f.api.resetDispatchDraftLinks(),false);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(f.elements.cartQty_0.value,'2.75');assert.match(errors(f),/backup storage full/);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

test('failed local cleanup restores all removed draft keys and keeps the original cart plus its backup',async()=>{
    const f=brokenDraft(),before=state(f),stored=local(f),cart=copy(f.api.dispatchCart),remove=f.storage.removeItem;f.elements.cartQty_0.value='2.75';let fail=true;
    f.storage.removeItem=key=>{if(key==='takodeal_active_po'&&fail){fail=false;throw Error('Synthetic cleanup failure');}remove(key);};confirmRecovery(f);
    assert.equal(await f.api.resetDispatchDraftLinks(),false);assert.deepEqual(state(f),before);for(const [key,value]of Object.entries(stored))assert.equal(f.storage.getItem(key),value,key);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(f.elements.cartQty_0.value,'2.75');assert.equal(JSON.parse(f.storage.getItem(recoveryKey)).items[0].qty,2750);assert.match(errors(f),/cleanup failure/);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

for(const change of ['quantity','access','account'])test(`recovery confirmation cannot clear a newer ${change} context`,async()=>{
    const f=brokenDraft(),before=state(f),stored=local(f),cart=copy(f.api.dispatchCart);
    confirmRecovery(f,()=>{if(change==='quantity')f.elements.cartQty_0.value='3.75';else if(change==='access')f.api.sessionUser.permissions=[];else f.api.auth.currentUser={...f.api.auth.currentUser,uid:'different-account'};});
    assert.equal(await f.api.resetDispatchDraftLinks(),false);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,cart);assert.equal(f.elements.btnSubmitDispatch.disabled,false);if(change==='quantity')assert.equal(f.elements.cartQty_0.value,'3.75');
});

test('Send preflight offers explicit recovery for broken links without opening the driver dialog or posting stock',async()=>{
    const f=brokenDraft(),before=state(f),stored=local(f);await f.send();
    assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.equal(f.dialogs.some(args=>args[0]?.input==='text'),false);assert.equal(f.dialogs.some(args=>args[0]?.confirmButtonText==='Save copy and refresh draft'),true);assert.equal(f.api.dispatchCart[0].qty,1000);assert.equal(f.elements.btnSubmitDispatch.disabled,false);
});

test('saved quantity reference remains viewable after recovery leaves no cart or selected destination',async()=>{
    const f=brokenDraft();f.elements.cartQty_0.value='2.75';confirmRecovery(f);await f.api.resetDispatchDraftLinks();f.elements.dispTo.value='';f.elements.dispFrom.value='';const before=state(f),stored=local(f),count=f.dialogs.length;
    await f.api.showDispatchDraftBackup();const reference=f.dialogs.slice(count).find(args=>args[0]?.titleText==='Saved quantity reference');assert.ok(reference);assert.match(reference[0].html,/Chicken Powder/);assert.match(reference[0].html,/2\.75 Pack/);assert.match(reference[0].html,/Main Office.*Maa/);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);assert.deepEqual(f.api.dispatchCart,[]);
});

test('saved reference viewer rechecks current branch scope and never renders out-of-scope quantities',async()=>{
    const f=brokenDraft();confirmRecovery(f);await f.api.resetDispatchDraftLinks();f.api.sessionUser.allowedBranches=['Cabantian'];const before=state(f),stored=local(f),count=f.dialogs.length;
    await f.api.showDispatchDraftBackup();const calls=f.dialogs.slice(count);assert.equal(calls.some(args=>args[0]?.titleText==='Saved quantity reference'),false);assert.match(calls.flat().filter(value=>typeof value==='string').join(' '),/outside|access/i);assert.deepEqual(state(f),before);assert.deepEqual(local(f),stored);
});
