import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {readInventoryHistory,historyReadError,clearInventoryHistoryCache,previewRestockReversal,commitRestockReversal} from '../takodeal-manager/inventory-history-services.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
const clone=value=>structuredClone(value);
function readFixture({owner=true,branches='All',permissions=['inventory']}={}){
 const h=firestoreHarness(),email=owner?OWNER_EMAIL:'manager@example.test';h.api.auth={currentUser:{uid:'actor',email}};h.api.sessionUser={uid:'actor',email,permissions,allowedBranches:['All']};h.put('hq_managers/access',{email,pin:'1234',role:'Manager',permissions,assignedBranch:branches});
 for(const branch of ['Main Office','Maa','Agdao'])h.put('branches/'+branch,{name:branch});
 const calls=[];h.api.where=(key,op,value)=>({kind:'where',key,op,value});h.api.orderBy=(key,order)=>({kind:'order',key,order});h.api.limit=value=>({kind:'limit',value});h.api.startAfter=snapshot=>({kind:'after',id:snapshot.id});
 h.api.getDocFromServer=async reference=>({id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>clone(h.get(reference.path))});
 h.api.getDocsFromServer=async q=>{
  calls.push(q);let data=[...h.docs].filter(([path])=>path.startsWith(q.table+'/')).map(([path,value])=>({id:path.slice(q.table.length+1),value}));
  for(const f of q.filters||[])if(f.kind==='where')data=data.filter(row=>f.op==='=='?row.value[f.key]===f.value:f.op==='>='?row.value[f.key] instanceof Date&&row.value[f.key]>=f.value:f.op==='<'?row.value[f.key] instanceof Date&&row.value[f.key]<f.value:false);
  const order=q.filters?.find(f=>f.kind==='order');data.sort((a,b)=>order?(+b.value[order.key])-(+a.value[order.key])||a.id.localeCompare(b.id):a.id.localeCompare(b.id));const cursor=q.filters?.find(f=>f.kind==='after');if(cursor)data=data.slice(data.findIndex(row=>row.id===cursor.id)+1);const limit=q.filters?.find(f=>f.kind==='limit');if(limit)data=data.slice(0,limit.value);
  return {docs:data.map(row=>({id:row.id,data:()=>clone(row.value)}))};
 };return {...h,calls};
}
const options={kind:'StockLogs',from:'2026-10-15',to:'2026-10-16'};
const stamp=new Date('2026-10-15T12:00:00Z');
test('history reads are date-bounded, paged and branch-scoped using fresh saved permissions',async()=>{
 const h=readFixture({owner:false,branches:'Maa'});h.put('stock_logs/maa',{branch:'Maa',timestamp:stamp,item:'Bowl',variance:-1});h.put('stock_logs/hq',{branch:'Main Office',timestamp:stamp,item:'Sauce',variance:-1});
 const report=await readInventoryHistory(h.api,options);assert.deepEqual(report.rows.map(row=>row.id),['maa']);assert.deepEqual(report.branches,['Maa']);const query=h.calls.find(q=>q.table==='stock_logs');assert.ok(query.filters.some(f=>f.key==='branch'&&f.value==='Maa'));assert.ok(query.filters.some(f=>f.key==='timestamp'&&f.op==='>='));assert.ok(query.filters.some(f=>f.kind==='limit'&&f.value===501));
});
test('history tab permission cannot be broadened by an outdated UI session',async()=>{
 const h=readFixture({owner:false,permissions:['waste']});await assert.rejects(readInventoryHistory(h.api,options),/permissions/);assert.equal(h.calls.some(q=>q.table==='stock_logs'),false);
});
test('same period reopens use a cache without repeating stock or directory reads',async()=>{
 const h=readFixture();h.put('stock_logs/a',{branch:'Maa',timestamp:stamp,item:'Bowl',variance:-1});await readInventoryHistory(h.api,options);await readInventoryHistory(h.api,options);
 assert.equal(h.calls.filter(q=>q.table==='stock_logs').length,1);assert.equal(h.calls.filter(q=>q.table==='branches').length,1);assert.equal(h.calls.filter(q=>q.table==='hq_managers').length,2);
});
test('manual pagination exposes partial totals and does not double-count the extra cursor row',async()=>{
 const h=readFixture();for(let index=0;index<505;index++)h.put('stock_logs/'+String(index).padStart(4,'0'),{branch:'Maa',timestamp:stamp,item:'Bowl',variance:-1});
 const first=await readInventoryHistory(h.api,options);assert.equal(first.rows.length,500);assert.equal(first.partial,true);assert.equal(first.hasMore,true);const next=await readInventoryHistory(h.api,{...options,more:true});assert.equal(next.rows.length,505);assert.equal(next.partial,false);assert.equal(new Set(next.rows.map(row=>row.id)).size,505);
});
test('legacy check is explicit and bounded, and date-only strings have no invented time',async()=>{
 const h=readFixture();h.put('stock_logs/legacy',{branch:'Maa',date:'2026-10-15',item:'Bowl',variance:-1});assert.equal((await readInventoryHistory(h.api,options)).rows.length,0);
 const report=await readInventoryHistory(h.api,{...options,legacy:true});assert.equal(report.rows.length,1);const last=h.calls.filter(q=>q.table==='stock_logs').at(-1);assert.ok(last.filters.some(f=>f.kind==='limit'));assert.equal(last.filters.some(f=>f.key==='timestamp'),false);
});
test('legacy invoices with no branch stay unassigned for the Owner and never leak into a scoped branch',async()=>{
 const h=readFixture();h.put('hq_restocks/a',{timestamp:stamp,supplier:'Maa',totalCost:100,items:[]});const own=await readInventoryHistory(h.api,{...options,kind:'Invoices'});assert.equal(own.rows[0].branch,null);
 const scoped=readFixture({owner:false,branches:'Maa'});scoped.put('hq_restocks/a',{timestamp:stamp,supplier:'Maa',totalCost:100,items:[]});assert.equal((await readInventoryHistory(scoped.api,{...options,kind:'Invoices'})).rows.length,0);
});
test('one waste source failure is shown as partial data rather than a false zero',async()=>{
 const h=readFixture(),read=h.api.getDocsFromServer;h.put('stock_logs/a',{branch:'Maa',timestamp:stamp,item:'Bowl',type:'Waste',variance:-1});h.api.getDocsFromServer=q=>q.table==='inventory_logs'?Promise.reject(Object.assign(Error('Denied'),{code:'permission-denied'})):read(q);
 const report=await readInventoryHistory(h.api,{...options,kind:'Waste'});assert.equal(report.rows.length,1);assert.equal(report.partial,true);assert.equal(report.errors.length,1);assert.match(historyReadError(report.errors[0].error),/did not allow/);
});
test('quota failures do not trigger collection fallback queries or automatic retry loops',async()=>{
 const h=readFixture(),read=h.api.getDocsFromServer;let attempts=0;h.api.getDocsFromServer=q=>q.table==='stock_logs'?(attempts++,Promise.reject(Object.assign(Error('Quota exceeded'),{code:'resource-exhausted'}))):read(q);
 await assert.rejects(readInventoryHistory(h.api,options),/Quota/);await assert.rejects(readInventoryHistory(h.api,{...options,refresh:true}),/quota/i);assert.equal(attempts,1);assert.match(historyReadError({code:'resource-exhausted'}),/quota is exhausted/);
});
test('repeated Refresh shares the actual in-flight SDK request after its UI deadline',async()=>{
 const h=readFixture(),read=h.api.getDocsFromServer;let finish,attempts=0;h.api.getDocsFromServer=q=>q.table==='stock_logs'?(attempts++,new Promise(resolve=>{finish=resolve;})):read(q);
 h.api.setTimeout=callback=>setTimeout(callback,5);h.api.clearTimeout=clearTimeout;
 await assert.rejects(readInventoryHistory(h.api,options),/taking longer/);clearInventoryHistoryCache(h.api);await assert.rejects(readInventoryHistory(h.api,{...options,refresh:true}),/taking longer/);assert.equal(attempts,1);finish({docs:[]});await new Promise(resolve=>setTimeout(resolve,0));
});
test('missing composite indexes remain explicit errors without an unbounded branch fallback',async()=>{
 const h=readFixture({owner:false,branches:'Maa'}),read=h.api.getDocsFromServer;let attempts=0;h.api.getDocsFromServer=q=>q.table==='stock_logs'?(attempts++,Promise.reject(Object.assign(Error('Index needed'),{code:'failed-precondition'}))):read(q);
 await assert.rejects(readInventoryHistory(h.api,options),/Index/);assert.equal(attempts,1);assert.match(historyReadError({code:'failed-precondition',message:'Index needed'}),/needs a database index/);
});
const before={name:'Sauce',branch:'Main Office',category:'Prepared Batch',uom:'gram',purchaseUom:'Gallon',conversionRate:1000,currentStock:20,baseCost:1},after={...before,currentStock:1020,baseCost:2,purchaseCost:2000,purchCost:2000,cost:2000};
function reversalFixture(){const h=readFixture();h.put('inventory/hq',{...after,maintainingStock:5000});h.put('hq_restocks/invoice',{version:2,branch:'Main Office',supplier:'Supplier',items:[{id:'hq',name:'Sauce',qty:1,purchUom:'Gallon',unitCost:2020,subtotal:2020}],totalCost:2020,inventoryEffects:[{inventoryId:'hq',before:{...before},after:{...after}}]});return h;}
test('invoice reversal restores stock/cost atomically and retains the invoice with an audit',async()=>{
 const h=reversalFixture(),preview=await previewRestockReversal(h.api,'invoice');const result=await commitRestockReversal(h.api,preview);assert.equal(result.status,'saved');assert.equal(h.get('inventory/hq').currentStock,20);assert.equal(h.get('inventory/hq').baseCost,1);assert.equal(h.get('inventory/hq').maintainingStock,5000);assert.equal(h.get('inventory/hq').purchaseCost,undefined);assert.equal(h.get('hq_restocks/invoice').status,'Reverted');assert.equal(h.get('stock_logs/restock_reversal_invoice_0').variance,-1000);
});
test('invoice reversal commit failures cannot leave partial stock/cost/audit changes',async()=>{
 const h=reversalFixture(),preview=await previewRestockReversal(h.api,'invoice');h.failNextCommit();await assert.rejects(commitRestockReversal(h.api,preview),/Commit rejected/);assert.equal(h.get('inventory/hq').currentStock,1020);assert.equal(h.get('hq_restocks/invoice').status,undefined);assert.equal(h.get('stock_logs/restock_reversal_invoice_0'),undefined);
});
test('lost reversal acknowledgment retries exactly once using a retained operation marker',async()=>{
 const h=reversalFixture(),preview=await previewRestockReversal(h.api,'invoice');h.loseNextAck();await assert.rejects(commitRestockReversal(h.api,preview),/after commit/);const retry=await commitRestockReversal(h.api,preview);assert.equal(retry.status,'already-applied');assert.equal(h.get('inventory/hq').currentStock,20);assert.equal([...h.docs.keys()].filter(key=>key.startsWith('stock_logs/')).length,1);
});
test('saved access revocation or later stock movement holds the entire invoice reversal',async()=>{
 for(const revoke of [false,true]){const h=reversalFixture(),preview=await previewRestockReversal(h.api,'invoice');if(revoke)h.put('hq_managers/access',{...h.get('hq_managers/access'),active:false});else h.put('inventory/hq',{...h.get('inventory/hq'),currentStock:1000});await assert.rejects(commitRestockReversal(h.api,preview));assert.equal(h.get('hq_restocks/invoice').status,undefined);assert.equal(h.get('stock_logs/restock_reversal_invoice_0'),undefined);}
});

test('waste log deducts duplicate item lines atomically and saves accurate cost snapshots',async()=>{
 const {commitDirectWasteCart}=await import('../takodeal-manager/inventory-history-services.js');const h=readFixture();h.put('inventory/bowl',{name:'Bowl',branch:'Maa',uom:'piece',purchaseUom:'Pack',conversionRate:50,currentStock:150,baseCost:2});
 const line={id:'bowl',name:'Bowl',branch:'Maa',rawQty:1,unitKind:'purchase',baseUom:'piece',purchaseUom:'Pack',conversionRate:50,reason:'Damaged / Broken'},result=await commitDirectWasteCart(h.api,[line,{...line,unitKind:'base',rawQty:5}],{operationId:'test'});
 assert.equal(result.status,'saved');assert.equal(h.get('inventory/bowl').currentStock,95);assert.equal(h.get('stock_logs/manager_waste_test_0').valueLost,100);assert.equal(h.get('stock_logs/manager_waste_test_0').newQty,100);assert.equal(h.get('stock_logs/manager_waste_test_1').oldQty,100);assert.equal(h.get('stock_logs/manager_waste_test_1').valueLost,10);
});
test('waste logging respects fresh transactions so concurrent sales changes are not overwritten',async()=>{
 const {commitDirectWasteCart}=await import('../takodeal-manager/inventory-history-services.js');const h=readFixture();h.put('inventory/bowl',{name:'Bowl',branch:'Maa',uom:'piece',purchaseUom:'piece',conversionRate:1,currentStock:100,baseCost:0});
 const line={id:'bowl',name:'Bowl',branch:'Maa',rawQty:5,unitKind:'base',baseUom:'piece',purchaseUom:'piece',conversionRate:1,reason:'Damaged'},run=h.api.runTransaction;let changed=false;h.api.runTransaction=(db,callback)=>run(db,async tx=>{const result=await callback(tx);if(!changed){changed=true;h.put('inventory/bowl',{...h.get('inventory/bowl'),currentStock:90});}return result;});
 await commitDirectWasteCart(h.api,[line],{operationId:'concurrent'});assert.equal(h.get('inventory/bowl').currentStock,85);assert.equal(h.get('stock_logs/manager_waste_concurrent_0').oldQty,90);assert.equal(h.get('stock_logs/manager_waste_concurrent_0').valueLost,0);assert.ok(h.retries()>0);
});
test('failed or repeated waste saves cannot leave partial deductions or duplicate logs',async()=>{
 const {commitDirectWasteCart}=await import('../takodeal-manager/inventory-history-services.js');const h=readFixture();h.put('inventory/bowl',{name:'Bowl',branch:'Maa',uom:'piece',purchaseUom:'piece',conversionRate:1,currentStock:20,baseCost:2});const line={id:'bowl',name:'Bowl',branch:'Maa',rawQty:5,unitKind:'base',baseUom:'piece',purchaseUom:'piece',conversionRate:1,reason:'Damaged'};
 h.failNextCommit();await assert.rejects(commitDirectWasteCart(h.api,[line],{operationId:'atomic'}),/Commit rejected/);assert.equal(h.get('inventory/bowl').currentStock,20);assert.equal(h.get('stock_logs/manager_waste_atomic_0'),undefined);
 h.loseNextAck();await assert.rejects(commitDirectWasteCart(h.api,[line],{operationId:'atomic'}),/after commit/);const repeated=await commitDirectWasteCart(h.api,[line],{operationId:'atomic'});assert.equal(repeated.status,'already-applied');assert.equal(h.get('inventory/bowl').currentStock,15);assert.equal([...h.docs.keys()].filter(key=>key.startsWith('stock_logs/')).length,1);
});
test('waste cannot silently create negative stock, change units, cross saved branch scope or fabricate a cost',async()=>{
 const {commitDirectWasteCart}=await import('../takodeal-manager/inventory-history-services.js');const base={id:'bowl',name:'Bowl',branch:'Maa',rawQty:5,unitKind:'base',baseUom:'piece',purchaseUom:'Pack',conversionRate:50,reason:'Damaged'};
 for(const patch of [{currentStock:4},{currentStock:-10},{conversionRate:100}]){const h=readFixture();h.put('inventory/bowl',{name:'Bowl',branch:'Maa',uom:'piece',purchaseUom:'Pack',conversionRate:50,currentStock:20,...patch});await assert.rejects(commitDirectWasteCart(h.api,[base],{operationId:'held'}));assert.equal(h.get('stock_logs/manager_waste_held_0'),undefined);}
 const scoped=readFixture({owner:false,branches:'Agdao'});await assert.rejects(commitDirectWasteCart(scoped.api,[base],{operationId:'scope'}),/outside/);
 const h=readFixture();h.put('inventory/bowl',{name:'Bowl',branch:'Maa',uom:'piece',purchaseUom:'Pack',conversionRate:50,currentStock:20});await commitDirectWasteCart(h.api,[base],{operationId:'unknown'});assert.equal(h.get('stock_logs/manager_waste_unknown_0').valueLost,null);
});
test('floating point boundaries can record a complete physical loss without creating a negative balance',async()=>{
 const {commitDirectWasteCart}=await import('../takodeal-manager/inventory-history-services.js');const h=readFixture();h.put('inventory/bowl',{name:'Bowl',branch:'Maa',uom:'gram',purchaseUom:'gram',conversionRate:1,currentStock:.3,baseCost:1});const line={id:'bowl',name:'Bowl',branch:'Maa',unitKind:'base',baseUom:'gram',purchaseUom:'gram',conversionRate:1,reason:'Spilled'};
 await commitDirectWasteCart(h.api,[{...line,rawQty:.1},{...line,rawQty:.2}],{operationId:'fraction'});assert.equal(h.get('inventory/bowl').currentStock,0);
});
