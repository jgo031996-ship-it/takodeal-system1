import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
import {loadStockRequestDraft} from '../takodeal-manager/dispatch-request-draft.js';
import {renderStockRequestReview} from '../takodeal-manager/stock-request-review.js';
import {installDispatchDestinationRepair} from '../takodeal-manager/dispatch-destination-repair.js';
import {installDispatchRestockUI} from '../takodeal-manager/dispatch-restock-ui.js';
const copy=value=>structuredClone(value);
const ordinary={name:'Chicken Powder',itemName:'Chicken Powder',qty:2000,rawQty:2,displayQty:2,uom:'Gram',baseUom:'Gram',purchaseUom:'Pack',displayUom:'Pack',conversionRate:1000,requestType:'Restock (AI Forecast)',isForecast:true,systemStock:1250};
const counted={...ordinary,requestType:'Maintaining Stock (Auto-Fill)',isForecast:false,physicalStock:1250,countSnapshot:{version:1,baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:250,totalBaseQty:1250}};
const defaultPO={branch:'Maa',status:'Pending',type:'AI Auto-Forecast',requestedBy:'Sample staff',items:[ordinary]};
const hqDetails={'Chicken Powder':{name:'Chicken Powder',branch:'Main Office',currentStock:10000,uom:'Gram',purchaseUom:'Pack',conversionRate:1000}};
function localStorageFixture(initial={}){
    const storage={};Object.defineProperties(storage,{getItem:{value:key=>Object.hasOwn(storage,key)?storage[key]:null},setItem:{value:(key,value)=>{storage[key]=String(value);}},removeItem:{value:key=>{delete storage[key];}}});for(const [key,value] of Object.entries(initial))storage.setItem(key,value);return storage;
}
const storageData=storage=>Object.fromEntries(Object.keys(storage).sort().map(key=>[key,storage.getItem(key)]));
function fixture({po=defaultPO,cart=[],storage={},hq=hqDetails}={}){
    const h=firestoreHarness(),user={uid:'manager-user',email:'sample-manager@example.test',emailVerified:true},saved={email:user.email,permissions:['dispatch'],role:'Manager',assignedBranch:['Maa','Cabantian'],pin:'1111'};
    h.put('purchase_orders/po',copy(po));h.put('inventory/hq',copy(hq['Chicken Powder']));
    const writes=[],dialogs=[],nodes={dispFrom:{value:'Main Office'},dispTo:{value:'Maa'}},memory=localStorageFixture(storage);let renders=0,refreshes=0,clears=0;
    const api={...h.api,auth:{currentUser:user},sessionUser:createWorkspaceSession(user,saved),crypto:globalThis.crypto,dispatchCart:copy(cart),isBranchAllowed:branch=>['Maa','Cabantian'].includes(branch),
        getDoc:async ref=>({exists:()=>h.docs.has(ref.path),data:()=>copy(h.get(ref.path))}),getDocs:async query=>{const result=await h.api.getDocsFromServer(query);return {...result,forEach:fn=>result.docs.forEach(fn)};},
        updateDoc:async(ref,data)=>{writes.push({path:ref.path,data:copy(data)});h.put(ref.path,{...h.get(ref.path),...data});},
        renderDispatchCart:()=>{renders++;},loadDispatchLogs:()=>{refreshes++;},clearDispatchCart:async()=>{clears++;throw Error('Consolidation failed');}};
    const document={getElementById:id=>nodes[id] || null};const f={h,api,po:copy(po),hq,document,storage:memory,writes,dialogs,nodes,get renders(){return renders;},get refreshes(){return refreshes;},get clears(){return clears;},answer:()=>({})};
    const original=api.runTransaction;api.runTransaction=(db,callback)=>original(db,tx=>callback({...tx,update:(ref,data)=>{writes.push({path:ref.path,data:copy(data)});tx.update(ref,data);}}));
    f.load=()=>loadStockRequestDraft(api,{poId:'po',po:f.po,hqDetails:f.hq},{storage:memory,document});
    f.prepareReview=()=>{
        const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.reviewPurchaseOrder = async function(poId)'),end=source.indexOf('\n};',start)+3;assert.ok(start>=0 && end>start);
        const context=vm.createContext({window:api,document,localStorage:memory,console:{error(){}},renderStockRequestReview,loadStockRequestDraft,
            Swal:{fire:async(...args)=>{dialogs.push(args);return f.answer(...args);},showLoading(){}}});vm.runInContext(source.slice(start,end),context);
    };
    f.runReview=async()=>{f.prepareReview();return api.reviewPurchaseOrder('po');};
    f.collectSend=async()=>{
        const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.lastIndexOf('window.submitMultiDispatch = async function() {'),end=source.indexOf('\n};',start)+3;assert.ok(start>=0 && end>start);
        const sent=[];nodes.btnSubmitDispatch={disabled:false,textContent:'Send delivery'};api.ManagerUI={prompt:async()=> 'QA driver',notify(){}};api.invalidateCache=()=>{};api.loadDispatchDashboard=()=>{};
        vm.runInNewContext(source.slice(start,end),{window:api,document,localStorage:memory,crypto:globalThis.crypto,Swal:{fire:async(...args)=>{dialogs.push(args);return {};}},commitDispatch:async(_api,payload)=>{sent.push(copy(payload));return 'dispatched';}});
        await api.submitMultiDispatch();return sent;
    };
    return f;
}
test('draft loading preserves ordinary and AI saved base quantity through current HQ conversion',async()=>{
    const f=fixture({hq:{'Chicken Powder':{...hqDetails['Chicken Powder'],conversionRate:500}}}),original=copy(f.po);assert.equal((await f.load()).loaded,true);
    const row=f.api.dispatchCart[0];assert.equal(row.qty,2000);assert.equal(row.rawQty,4);assert.equal(row.origBaseQty,2000);assert.equal(row.origRawQty,4);assert.equal(row.convRate,500);assert.equal(row.selectedUom,'purch');assert.equal(row.friendlyUom,'Pack');
    assert.deepEqual(f.po,original);assert.deepEqual(f.h.get('purchase_orders/po').items,original.items);assert.equal(f.h.get('inventory/hq').currentStock,10000);assert.equal(f.h.get('purchase_orders/po').status,'Drafting');assert.equal(f.storage.getItem('takodeal_active_po'),'po');assert.equal(f.h.docs.size,2);
});
test('reported-count audit rows preserve physical/count metadata and intentionally start dispatch quantity at zero',async()=>{
    const f=fixture({po:{...defaultPO,items:[counted]}});await f.load();const row=f.api.dispatchCart[0];assert.equal(row.qty,0);assert.equal(row.rawQty,0);assert.equal(row.origBaseQty,0);assert.equal(row.physicalStock,1250);assert.equal(row.systemStock,1250);assert.deepEqual(row.countSnapshot,counted.countSnapshot);assert.deepEqual(f.h.get('purchase_orders/po').items,[counted]);
});
test('already loaded request preserves manually edited cart and creates no additional status write',async()=>{
    const f=fixture();await f.load();f.api.dispatchCart[0].qty=750;f.api.dispatchCart[0].rawQty=0.75;f.storage.setItem('takodeal_dispatch_cart',JSON.stringify(f.api.dispatchCart));const cart=copy(f.api.dispatchCart),stored=storageData(f.storage),writes=f.writes.length;
    assert.equal((await f.load()).alreadyLoaded,true);assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(storageData(f.storage),stored);assert.equal(f.writes.length,writes);
});
test('cross-branch draft is blocked without implicit consolidation, writes or changed cart/storage',async()=>{
    const cart=[{name:'Old item',qty:5,rawQty:5}],f=fixture({cart,storage:{takodeal_dispatch_cart:JSON.stringify(cart),takodeal_dispatch_to:'Cabantian',takodeal_active_po:'old-po'}}),before=storageData(f.storage);
    const result=await f.load();assert.equal(result.blockedDestination,true);assert.equal(result.destination,'Cabantian');assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(storageData(f.storage),before);assert.equal(f.h.get('purchase_orders/po').status,'Pending');assert.equal(f.writes.length,0);assert.equal(f.clears,0);
});
test('failed draft-status commit leaves old local cart and all draft storage intact',async()=>{
    const cart=[{name:'Existing other item',qty:1,rawQty:1}],f=fixture({cart,storage:{takodeal_dispatch_cart:JSON.stringify(cart),takodeal_dispatch_to:'Maa',takodeal_active_po:'other-po',takodeal_draft_qty_0:'7'}}),before=storageData(f.storage);f.h.failNextCommit();
    f.h.put('purchase_orders/other-po',{branch:'Maa',status:'Drafting',items:copy(cart)});
    await assert.rejects(f.load(),/Commit rejected/);assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(storageData(f.storage),before);assert.equal(f.h.get('purchase_orders/po').status,'Pending');
});
test('lost acknowledgement records no local draft until retry, then publishes once without double quantities',async()=>{
    const f=fixture();f.h.loseNextAck();await assert.rejects(f.load(),/Connection lost/);assert.deepEqual(f.api.dispatchCart,[]);assert.deepEqual(storageData(f.storage),{});assert.equal(f.h.get('purchase_orders/po').status,'Drafting');
    assert.equal((await f.load()).loaded,true);assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal((await f.load()).alreadyLoaded,true);assert.equal(f.api.dispatchCart[0].qty,2000);
    const marker=f.h.get('purchase_orders/po').dispatchDraftOperation;assert.equal(marker.actorUid,'manager-user');assert.equal(marker.version,1);
});
test('concurrent duplicate loads publish one cart quantity and treat the later call as already loaded',async()=>{
    const f=fixture(),results=await Promise.all([f.load(),f.load()]);assert.equal(results.filter(result=>result.loaded).length,1);assert.equal(results.filter(result=>result.alreadyLoaded).length,1);assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.storage.getItem('takodeal_active_po'),'po');
});
test('fresh branch/items/status checks reject stale request without touching local draft',async()=>{
    for(const patch of [{branch:'Cabantian'},{items:[{...ordinary,qty:3000}]},{status:'Completed'},{status:'Rejected'},{status:'Delayed'}]){
        const f=fixture();f.h.put('purchase_orders/po',{...f.h.get('purchase_orders/po'),...patch});await assert.rejects(f.load(),/changed|processed/);assert.deepEqual(f.api.dispatchCart,[]);assert.deepEqual(storageData(f.storage),{});assert.deepEqual(f.h.get('purchase_orders/po'),{...defaultPO,...patch});
    }
});
test('actor change or manual cart edit while status read waits cannot publish stale draft',async()=>{
    for(const change of ['actor','cart']){const f=fixture(),original=f.api.runTransaction;f.api.runTransaction=(db,callback)=>original(db,tx=>callback({...tx,get:async ref=>{const row=await tx.get(ref);if(change==='actor')f.api.auth.currentUser={...f.api.auth.currentUser,uid:'other'};else f.api.dispatchCart.push({name:'Manual new item',qty:3});return row;}}));
        await assert.rejects(f.load(),/account changed|draft changed|Unlock/);assert.equal(f.h.get('purchase_orders/po').status,'Pending');assert.deepEqual(storageData(f.storage),{});if(change==='cart')assert.deepEqual(f.api.dispatchCart,[{name:'Manual new item',qty:3}]);else assert.deepEqual(f.api.dispatchCart,[]);
    }
});
test('storage save failure rolls back related keys, never reports loaded and leaves cart untouched',async()=>{
    const f=fixture({storage:{takodeal_draft_qty_0:'7'}}),before=storageData(f.storage),set=f.storage.setItem;let fail=true;
    const storage={getItem:f.storage.getItem,removeItem:f.storage.removeItem,setItem:(key,value)=>{if(key==='takodeal_dispatch_to'&&fail){fail=false;throw Error('Quota');}set(key,value);}};Object.defineProperty(storage,'takodeal_draft_qty_0',{enumerable:true,get:()=>f.storage.getItem('takodeal_draft_qty_0')});
    await assert.rejects(loadStockRequestDraft(f.api,{poId:'po',po:f.po,hqDetails:f.hq},{storage,document:f.document}),/could not save the draft/);assert.deepEqual(f.api.dispatchCart,[]);assert.deepEqual(storageData(f.storage),before);assert.equal(f.h.get('purchase_orders/po').status,'Drafting');
});
test('actual review Close performs no cloud writes, local persistence or cart changes',async()=>{
    const f=fixture({po:{...defaultPO,items:[counted]},cart:[{name:'Existing draft',qty:1}],storage:{takodeal_active_po:'old',takodeal_dispatch_to:'Maa'}}),cart=copy(f.api.dispatchCart),stored=storageData(f.storage),original=copy(f.h.get('purchase_orders/po'));
    f.answer=options=>options?.showDenyButton?{isDismissed:true}:{};await f.runReview();assert.equal(f.writes.length,0);assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(storageData(f.storage),stored);assert.deepEqual(f.h.get('purchase_orders/po'),original);assert.equal(f.renders,0);
    const dialog=f.dialogs.find(([options])=>options?.showDenyButton)[0];assert.equal(dialog.customClass.popup,'stock-request-review-popup');assert.match(dialog.html,/Status \/ reason/);assert.match(dialog.html,/Reported count/);assert.match(dialog.html,/1 Pack \+ 250 Gram/);assert.match(dialog.html,/Restock requested/);assert.match(dialog.html,/2 Pack/);
});
test('actual Postpone sets existing Delayed/reason semantics once and never modifies draft or stock',async()=>{
    const f=fixture({cart:[{name:'Existing draft',qty:1}],storage:{takodeal_active_po:'old',takodeal_dispatch_to:'Maa'}}),cart=copy(f.api.dispatchCart),stored=storageData(f.storage);
    f.answer=options=>options?.showDenyButton?{isDenied:true}:options?.input==='text'?{value:'Waiting for HQ stock'}:{};await f.runReview();assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'purchase_orders/po');assert.equal(f.h.get('purchase_orders/po').status,'Delayed');assert.equal(f.h.get('purchase_orders/po').managerMessage,'Waiting for HQ stock');assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(storageData(f.storage),stored);assert.equal(f.h.get('inventory/hq').currentStock,10000);
});
test('actual Postpone cancelled reason leaves every record and draft unchanged',async()=>{
    const f=fixture();f.answer=options=>options?.showDenyButton?{isDenied:true}:{};await f.runReview();assert.equal(f.writes.length,0);assert.equal(f.h.get('purchase_orders/po').status,'Pending');assert.deepEqual(f.api.dispatchCart,[]);assert.deepEqual(storageData(f.storage),{});
});
test('actual confirmed review uses staged helper and retains source request base fields',async()=>{
    const f=fixture(),original=copy(f.h.get('purchase_orders/po'));f.answer=options=>options?.showDenyButton?{isConfirmed:true}:{};await f.runReview();assert.equal(f.api.dispatchCart[0].qty,2000);assert.equal(f.api.dispatchCart[0].rawQty,2);assert.deepEqual(f.h.get('purchase_orders/po').items,original.items);assert.equal(f.h.get('purchase_orders/po').status,'Drafting');assert.equal(f.h.get('inventory/hq').currentStock,10000);assert.ok(f.h.get('purchase_orders/po').dispatchDraftOperation);assert.equal(f.renders,1);
});
test('actual confirmed review never mixes a previous branch draft or calls destructive clear',async()=>{
    const cart=[{name:'Old item',qty:5}],f=fixture({cart,storage:{takodeal_dispatch_to:'Cabantian',takodeal_dispatch_cart:JSON.stringify(cart),takodeal_active_po:'old'}}),stored=storageData(f.storage);f.answer=options=>options?.showDenyButton?{isConfirmed:true}:{};await f.runReview();assert.equal(f.clears,0);assert.deepEqual(f.api.dispatchCart,cart);assert.deepEqual(storageData(f.storage),stored);assert.equal(f.writes.length,0);assert.equal(f.h.get('purchase_orders/po').status,'Pending');
});
test('same-item base selection or different package conversion is blocked before status/local writes',async()=>{
    for(const row of [
        {name:'Chicken Powder',qty:100,rawQty:100,selectedUom:'base',convRate:1,friendlyUom:'Gram',baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000},
        {name:'Chicken Powder',qty:500,rawQty:1,selectedUom:'purch',convRate:500,friendlyUom:'Pack',baseUom:'Gram',purchaseUom:'Pack',conversionRate:500},
        {name:'Chicken Powder',qty:1000,rawQty:1,selectedUom:'purch',convRate:1000,friendlyUom:'Carton',baseUom:'Gram',purchaseUom:'Carton',conversionRate:1000}
    ]){
        const f=fixture({cart:[row],storage:{takodeal_dispatch_to:'Maa',takodeal_active_po:'old',takodeal_dispatch_cart:JSON.stringify([row])}}),stored=storageData(f.storage);
        f.h.put('purchase_orders/old',{branch:'Maa',status:'Drafting',items:[copy(row)]});
        await assert.rejects(f.load(),/different units|package conversion/);assert.deepEqual(f.api.dispatchCart,[row]);assert.deepEqual(storageData(f.storage),stored);assert.equal(f.writes.length,0);assert.equal(f.h.get('purchase_orders/po').status,'Pending');
        const sent=await f.collectSend();assert.equal(sent.length,1);assert.equal(sent[0].items[0].qty,row.qty);
    }
});
test('compatible package merge preserves total base quantity through actual Send delivery recomputation',async()=>{
    const row={name:'Chicken Powder',qty:1000,rawQty:1,selectedUom:'purch',convRate:1000,friendlyUom:'Pack',baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000};
    const f=fixture({cart:[row],storage:{takodeal_dispatch_to:'Maa',takodeal_active_po:'old'}});f.h.put('purchase_orders/old',{branch:'Maa',status:'Drafting',items:[copy(row)]});await f.load();assert.equal(f.api.dispatchCart.length,1);const merged=f.api.dispatchCart[0];assert.equal(merged.qty,3000);assert.equal(merged.rawQty,3);assert.equal(merged.selectedUom,'purch');assert.equal(merged.friendlyUom,'Pack');assert.equal(f.storage.getItem('takodeal_active_po'),'old,po');
    const sent=await f.collectSend();assert.equal(sent.length,1);assert.equal(sent[0].items[0].qty,3000);assert.equal(sent[0].items[0].rawQty,3);assert.deepEqual(sent[0].purchaseOrderIds,['old','po']);
});
test('same-name HQ units with non-one conversion cannot create a draft that Send delivery would shrink',async()=>{
    const f=fixture({hq:{'Chicken Powder':{...hqDetails['Chicken Powder'],purchaseUom:'Gram'}}});await assert.rejects(f.load(),/units.*inconsistent/);assert.deepEqual(f.api.dispatchCart,[]);assert.equal(f.h.get('purchase_orders/po').status,'Pending');assert.equal(f.writes.length,0);
});
test('empty cart removes obsolete destination links without moving the original request or including its unseen goods',async()=>{
    for(const destination of ['Cabantian',null]){
        const storage={takodeal_active_po:'old-cabantian',takodeal_dispatch_cart:'[]',...(destination?{takodeal_dispatch_to:destination}:{})},f=fixture({cart:[],storage});f.nodes.dispTo.value='Maa';
        const original={branch:'Cabantian',status:'Drafting',items:[copy(ordinary)]};f.h.put('purchase_orders/old-cabantian',original);
        const result=await f.load();assert.equal(result.loaded,true);assert.equal(f.storage.getItem('takodeal_active_po'),'po');assert.equal(f.storage.getItem('takodeal_dispatch_to'),'Maa');
        assert.equal(f.api.dispatchCart.length,1);assert.equal(f.api.dispatchCart[0].qty,ordinary.qty);assert.equal(f.h.get('purchase_orders/po').status,'Drafting');assert.deepEqual(f.h.get('purchase_orders/old-cabantian'),original);assert.equal(f.writes.length,1);
    }
});
test('a fresh helper after lost acknowledgement can adopt the saved marker with a newly read Drafting request',async()=>{
    const f=fixture();f.h.loseNextAck();await assert.rejects(f.load(),/Connection lost/);const storedMarker=copy(f.h.get('purchase_orders/po').dispatchDraftOperation),saved=copy(f.h.get('purchase_orders/po'));
    const fresh=await import('../takodeal-manager/dispatch-request-draft.js?isolated-reload-test');const result=await fresh.loadStockRequestDraft(f.api,{poId:'po',po:saved,hqDetails:f.hq},{storage:f.storage,document:f.document});
    assert.equal(result.loaded,true);assert.equal(f.api.dispatchCart[0].qty,2000);assert.deepEqual(f.h.get('purchase_orders/po').dispatchDraftOperation,storedMarker);assert.equal(f.storage.getItem('takodeal_active_po'),'po');
});
test('compatible legacy base-unit cart without rawQty retains its complete amount in the real Send consumer',async()=>{
    const row={name:'Cup',qty:100,selectedUom:'base',convRate:1,baseUom:'pcs',uom:'pcs'},request={name:'Cup',qty:12,rawQty:12,uom:'pcs',baseUom:'pcs',purchaseUom:'pcs',requestType:'Request'},f=fixture({po:{...defaultPO,items:[request]},cart:[row],storage:{takodeal_dispatch_to:'Maa',takodeal_active_po:'old'},hq:{...hqDetails,Cup:{name:'Cup',purchaseUom:'pcs',uom:'pcs',conversionRate:1,currentStock:1000}}});
    f.h.put('purchase_orders/old',{branch:'Maa',status:'Drafting',items:[copy(row)]});
    await f.load();assert.equal(f.api.dispatchCart[0].qty,112);assert.equal(f.api.dispatchCart[0].rawQty,112);assert.equal(f.api.dispatchCart[0].origBaseQty,112);const sent=await f.collectSend();assert.equal(sent.length,1);assert.equal(sent[0].items[0].qty,112);
});

test('legacy Unknown Branch merged/set-aside request repairs its destination then uses actual Review, safe load and atomic Send without reviving old links',async()=>{
    const legacy={...defaultPO,branch:'Unknown Branch',type:'Internal Request',requestedBy:'System (Merged / Set Aside)',timestamp:new Date('2026-10-10T19:45:00+08:00'),managerMessage:'Original saved note'};
    const f=fixture({po:legacy,storage:{takodeal_dispatch_cart:'[]',takodeal_active_po:'older-completed',takodeal_dispatch_to:'Cabantian',takodeal_dispatch_from:'Main Office'}});
    const older={branch:'Cabantian',status:'Completed',dispatchBatchId:'older-delivery',items:[copy(ordinary)]};f.h.put('purchase_orders/older-completed',older);
    f.h.put('branches/hq',{name:'Main Office',active:true});f.h.put('branches/maa',{name:'Maa',active:true});f.h.put('branches/cabantian',{name:'Cabantian',active:true});
    const user=f.api.auth.currentUser;user.providerData=[{providerId:'google.com'}];
    const saved={email:user.email,fullName:'Synthetic HQ',role:'Manager',permissions:['dispatch','inventory'],assignedBranch:['Main Office','Maa','Cabantian']};
    f.h.put('hq_managers/synthetic',saved);f.api.sessionUser=createWorkspaceSession(user,saved);f.api.isBranchAllowed=branch=>f.api.sessionUser.allowedBranches.includes(branch);
    f.api.getDocFromServer=f.api.getDoc;f.api.getDocsFromServer=async query=>{const result=await f.h.api.getDocsFromServer(query);return {...result,forEach:fn=>result.docs.forEach(fn)};};
    f.nodes.btnSubmitDispatch={disabled:false,textContent:'Send delivery'};
    f.api.loadDispatchDashboard=async()=>{};f.api.invalidateCache=()=>{};f.api.ManagerUI={notify(){}};f.api.submitMultiDispatch=async()=>{throw Error('Legacy Send must not run');};f.api.revertAndEditRestock=async()=>{};f.api.loadFinancialFlow=async()=>{};
    const render=f.api.renderDispatchCart;f.api.renderDispatchCart=()=>{render();f.api.dispatchCart.forEach((row,index)=>{f.nodes['cartQty_'+index]={value:String(row.rawQty??row.qty)};});};
    const dialogs={fire:async(...args)=>{f.dialogs.push(args);return f.answer(...args);},showLoading(){}};
    f.answer=options=>options?.input==='select'?{isConfirmed:true,value:'maa'}:options?.showDenyButton?{isConfirmed:true}:options?.input==='text'?{isConfirmed:true,value:'Synthetic Driver'}:{};
    f.prepareReview();f.api.reviewStockRequest=f.api.reviewPurchaseOrder;
    installDispatchRestockUI(f.api,{document:f.document,storage:f.storage,dialogs});installDispatchDestinationRepair(f.api,{document:f.document,dialogs});
    await f.api.reviewPurchaseOrder('po');
    const prepared=f.h.get('purchase_orders/po');assert.equal(prepared.branch,'Maa');assert.equal(prepared.destinationBranch,'Maa');assert.equal(prepared.sourceBranch,'Main Office');assert.equal(prepared.status,'Drafting');
    assert.deepEqual(prepared.items,legacy.items);assert.deepEqual(prepared.timestamp,legacy.timestamp);assert.equal(prepared.type,legacy.type);assert.equal(prepared.requestedBy,legacy.requestedBy);assert.equal(prepared.destinationRepair.previousBranch,'Unknown Branch');
    assert.equal(f.storage.getItem('takodeal_active_po'),'po');assert.equal(f.storage.getItem('takodeal_dispatch_to'),'Maa');assert.equal(f.api.dispatchCart[0].qty,2000);
    await f.api.submitMultiDispatch();
    const deliveries=[...f.h.docs].filter(([path])=>path.startsWith('dispatch_logs/'));assert.equal(deliveries.length,1,JSON.stringify(f.dialogs));assert.equal(deliveries[0][1].toBranch,'Maa');assert.equal(deliveries[0][1].sourceBranch,'Main Office');assert.equal(deliveries[0][1].qty,2000);
    assert.equal(f.h.get('inventory/hq').currentStock,8000);assert.equal(f.h.get('purchase_orders/po').status,'Completed');assert.deepEqual(f.h.get('purchase_orders/older-completed'),older);assert.deepEqual(f.api.dispatchCart,[]);
});
