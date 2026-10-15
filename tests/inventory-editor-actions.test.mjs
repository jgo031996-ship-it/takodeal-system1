import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {loadInventoryEditorState,saveInventoryEditorSettings,saveInventoryStockCorrection} from '../takodeal-manager/inventory-editor-actions.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';

function fixture({owner=true,branches='All'}={}){
 const h=firestoreHarness(),email=owner?OWNER_EMAIL:'manager@example.test';
 h.api.auth={currentUser:{uid:'actor',email}};h.api.sessionUser={uid:'actor',email,cashierName:'Sample manager'};
 h.put('hq_managers/access',{email,pin:'1234',role:'Manager',permissions:['inventory'],assignedBranch:branches});
 h.api.getDocFromServer=async reference=>({id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))});
 for(const branch of ['Main Office','Maa','Agdao']){
  h.put('branches/'+branch,{name:branch});
  h.put('inventory/'+branch,{name:'Sauce',branch,purchaseUom:'Gallon',uom:'gram',conversionRate:1000,purchaseCost:100,baseCost:.1,currentStock:500,maintainingStock:1000,lowStockAlert:200,reorderLevel:200,restockCycle:'Monthly'});
 }
 h.put('inventory/other',{...h.get('inventory/Maa'),name:'Other item',branch:'Maa'});
 return h;
}
const open=(h,id='Main Office')=>loadInventoryEditorState(h.api,id);

test('opening inventory retains exact branch snapshots and permission-scoped directory without writes',async()=>{
 const h=fixture({owner:false,branches:'Maa'}),state=await open(h,'Maa');
 assert.equal(state.original.id,'Maa');assert.deepEqual(state.items.map(row=>row.branch),['Maa']);
 assert.deepEqual(state.permittedBranches,['Maa']);assert.equal(state.allItems.length,3);
 assert.equal(h.get('settings/recipe_revision'),undefined);
 await assert.rejects(open(h,'Main Office'),/branch access/);
});

test('Waste-only inventory permission cannot open or save the Live Stocks editor',async()=>{
 const h=fixture({owner:false}),state=await open(h);
 h.put('hq_managers/access',{...h.get('hq_managers/access'),permissions:['waste']});
 await assert.rejects(open(h),/permissions.*Live Stocks/);
 await assert.rejects(saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'2'}),/permissions.*Live Stocks/);
 await assert.rejects(saveInventoryStockCorrection(h.api,state,{baseQty:'100',note:'Count'}),/permissions.*Live Stocks/);
 assert.equal(h.get('inventory/Main Office').currentStock,500);assert.equal(h.get('inventory/Main Office').maintainingStock,1000);
 assert.equal(h.get('settings/recipe_revision'),undefined);
});

test('Main Office target edits never change branch quantities, costs, metadata or settings',async()=>{
 const h=fixture(),state=await open(h),maa=structuredClone(h.get('inventory/Maa'));
 const result=await saveInventoryEditorSettings(h.api,state,{branch:'Main Office',maintainingPurchaseQty:'5',maintainingBaseQty:'0',lowStockPurchaseQty:'1',restockCycle:'Weekly'},{operationId:'hq-target'});
 assert.deepEqual(result.copiedBranches,[]);assert.equal(h.get('inventory/Main Office').maintainingStock,5000);
 assert.equal(h.get('inventory/Main Office').lowStockAlert,1000);assert.deepEqual(h.get('inventory/Maa'),maa);
 assert.equal(h.get('inventory/Main Office').currentStock,500);assert.equal(h.get('inventory/Main Office').baseCost,.1);
});

test('store edits automatically copy only changed restock settings to exact compatible stores',async()=>{
 const h=fixture(),state=await open(h,'Maa'),hq=structuredClone(h.get('inventory/Main Office'));
 const result=await saveInventoryEditorSettings(h.api,state,{branch:'Maa',maintainingPurchaseQty:'3',category:'Updated local category',purchaseCost:'110'},{operationId:'store-target'});
 assert.deepEqual(result.copiedBranches,['Agdao']);assert.equal(h.get('inventory/Agdao').maintainingStock,3000);
 assert.equal(h.get('inventory/Agdao').category,undefined);assert.equal(h.get('inventory/Agdao').purchaseCost,100);assert.equal(h.get('inventory/Agdao').baseCost,.1);
 assert.equal(h.get('inventory/Maa').purchaseCost,110);assert.equal(h.get('inventory/Maa').category,'Updated local category');
 assert.deepEqual(h.get('inventory/Main Office'),hq);assert.equal(h.get('inventory/other').maintainingStock,1000);
});

test('branch access excludes stores outside the fresh saved scope even if the UI session says all',async()=>{
 const h=fixture({owner:false,branches:'Maa'}),state=await open(h,'Maa');
 h.api.sessionUser.allowedBranches=['All'];
 const result=await saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'2'},{operationId:'scoped-target'});
 assert.deepEqual(result.copiedBranches,[]);assert.equal(h.get('inventory/Agdao').maintainingStock,1000);
});

test('restock-only save reads no BOM and allows normal stock movement without replacing it',async()=>{
 const h=fixture(),state=await open(h),get=h.api.getDocsFromServer;
 h.api.getDocsFromServer=q=>{assert.notEqual(q.table,'bom');return get(q);};
 h.put('inventory/Main Office',{...h.get('inventory/Main Office'),currentStock:350,baseCost:.125,purchaseCost:125});
 await saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'4'},{operationId:'live-sales'});
 assert.equal(h.get('inventory/Main Office').currentStock,350);assert.equal(h.get('inventory/Main Office').baseCost,.125);assert.equal(h.get('inventory/Main Office').purchaseCost,125);
});

test('copied store targets retain auto-restock quantities and average costs saved after opening',async()=>{
 const h=fixture(),state=await open(h,'Maa');
 for(const branch of ['Maa','Agdao'])h.put('inventory/'+branch,{...h.get('inventory/'+branch),currentStock:1400,purchaseCost:130,baseCost:.13});
 await saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'4'},{operationId:'store-restock'});
 for(const branch of ['Maa','Agdao']){const row=h.get('inventory/'+branch);assert.equal(row.maintainingStock,4000);assert.equal(row.currentStock,1400);assert.equal(row.purchaseCost,130);assert.equal(row.baseCost,.13);}
});

test('a stale target, conversion or peer setting holds the complete settings operation',async()=>{
 for(const [id,patch] of [['Maa',{maintainingStock:5000}],['Agdao',{maintainingStock:6000}],['Maa',{conversionRate:1200}]]){
  const h=fixture(),state=await open(h,'Maa');h.put('inventory/'+id,{...h.get('inventory/'+id),...patch});
  await assert.rejects(saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'3'},{operationId:'stale-'+id+Object.keys(patch)}),/affected item changed/);
  assert.equal(h.get('inventory/Maa').maintainingStock,id==='Maa'&&patch.maintainingStock?5000:1000);
  assert.equal(h.get('settings/recipe_revision'),undefined);
 }
});

test('settings retry after a lost acknowledgment returns one completed operation',async()=>{
 const h=fixture(),state=await open(h);h.loseNextAck();
 await assert.rejects(saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'2'},{operationId:'lost-settings'}),/Connection lost/);
 assert.equal((await saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'2'},{operationId:'lost-settings'})).status,'already-applied');
 assert.equal(h.get('settings/recipe_revision').version,1);
 await assert.rejects(saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'3'},{operationId:'lost-settings'}),/different edits/);
});

test('automatic operation identity survives retry without asking the UI to invent an ID',async()=>{
 const h=fixture(),state=await open(h);h.loseNextAck();const input={purchaseQty:'1',note:'Stock recount'};
 await assert.rejects(saveInventoryStockCorrection(h.api,state,input),/Connection lost/);
 assert.equal((await saveInventoryStockCorrection(h.api,state,input)).status,'already-applied');
 assert.equal([...h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,1);
 assert.equal(h.get('settings/recipe_revision').version,1);
});

test('linked names are blocked in this editor even if a caller supplies a rename confirmation',async()=>{
 const h=fixture(),state=await open(h);h.put('bom/r',{menuItem:'Takoyaki',ingredientName:'Sauce',qty:20});h.put('global_addons/a',{name:'Extra sauce',linkedIngredient:'Sauce',deductQty:10});
 for(const renameLinked of [false,true])await assert.rejects(saveInventoryEditorSettings(h.api,state,{name:'New sauce'},{renameLinked,operationId:'rename'}),/use recipe replacement/);
 for(const branch of ['Main Office','Maa','Agdao']){assert.equal(h.get('inventory/'+branch).name,'Sauce');assert.equal(h.get('inventory/'+branch).currentStock,500);assert.equal(h.get('inventory/'+branch).baseCost,.1);}
 assert.equal(h.get('bom/r').ingredientName,'Sauce');assert.equal(h.get('global_addons/a').linkedIngredient,'Sauce');assert.equal(h.get('settings/recipe_revision'),undefined);
});

test('name collision, missing branch access and embedded product recipe links prevent a rename',async()=>{
 for(const kind of ['duplicate','scope','embedded']){
  const h=fixture({owner:kind!=='scope',branches:kind==='scope'?'Maa':'All'}),state=await open(h,kind==='scope'?'Maa':'Main Office');
  if(kind==='duplicate')h.put('inventory/collision',{...h.get('inventory/Maa'),name:'New sauce'});
  if(kind==='embedded')h.put('menu/product',{name:'Product',recipe:[{ingredientName:'Sauce',qty:5}]});
  await assert.rejects(saveInventoryEditorSettings(h.api,state,{name:'New sauce'},{renameLinked:true,operationId:kind}),/use recipe replacement/);
  assert.equal(h.get('inventory/Main Office').name,'Sauce');assert.equal(h.get('settings/recipe_revision'),undefined);
 }
});

test('base-unit edits cannot invalidate linked recipe or add-on quantities even with zero stock',async()=>{
 const h=fixture();h.put('inventory/Main Office',{...h.get('inventory/Main Office'),currentStock:0});h.put('bom/r',{menuItem:'Takoyaki',ingredientName:'Sauce',qty:20});
 const state=await open(h);await assert.rejects(saveInventoryEditorSettings(h.api,state,{baseUom:'ml'},{operationId:'unit'}),/linked to recipes/);
 assert.equal(h.get('inventory/Main Office').uom,'gram');
});

test('physical correction uses the opened conversion and writes one complete audit log only',async()=>{
 const h=fixture(),state=await open(h),before=structuredClone(h.get('inventory/Main Office'));
 const result=await saveInventoryStockCorrection(h.api,state,{purchaseQty:'2',baseQty:'25',note:'Counted at closing',operationId:'count'});
 assert.equal(result.newQty,2025);assert.equal(h.get('inventory/Main Office').currentStock,2025);
 const after=h.get('inventory/Main Office');delete after.currentStock;delete before.currentStock;assert.deepEqual(after,before);
 const log=h.get('stock_logs/inventory_correction_count');assert.equal(log.oldQty,500);assert.equal(log.variance,1525);assert.equal(log.conversionRate,1000);assert.equal(log.purchaseQty,2);assert.equal(log.looseBaseQty,25);assert.equal(log.inventoryId,'Main Office');
 assert.equal(h.get('inventory/Maa').currentStock,500);
});

test('physical corrections reject missing reasons, blank or negative counts and stale live counts',async()=>{
 for(const input of [{purchaseQty:'1',note:''},{note:'Missing count'},{purchaseQty:'-1',note:'Bad count'},{purchaseQty:'Infinity',note:'Bad count'}]){
  const h=fixture(),state=await open(h);await assert.rejects(saveInventoryStockCorrection(h.api,state,input),/reason|count/);assert.equal(h.get('inventory/Main Office').currentStock,500);
 }
 const h=fixture(),state=await open(h);h.put('inventory/Main Office',{...h.get('inventory/Main Office'),currentStock:450});
 await assert.rejects(saveInventoryStockCorrection(h.api,state,{purchaseQty:'1',note:'Count',operationId:'stale-count'}),/affected item changed/);
 assert.equal([...h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,0);
 // An entered count equal to the opened value must not evade the stale-count guard.
 await assert.rejects(saveInventoryStockCorrection(h.api,state,{baseQty:'500',note:'Count matches old screen',operationId:'equal-old-count'}),/affected item changed/);
});

test('a verified unchanged physical count records one zero-variance audit without metadata changes',async()=>{
 const h=fixture(),state=await open(h),before=structuredClone(h.get('inventory/Main Office'));
 const result=await saveInventoryStockCorrection(h.api,state,{baseQty:'500',note:'Verified count',operationId:'same-count'});
 assert.equal(result.variance,0);assert.deepEqual(h.get('inventory/Main Office'),before);assert.equal(h.get('stock_logs/inventory_correction_same-count').variance,0);
});

test('separate opened previews record separate same-count audits while each preview retries only once',async()=>{
 const h=fixture(),first=await open(h),input={baseQty:'500',note:'Verified stock count'};
 h.loseNextAck();await assert.rejects(saveInventoryStockCorrection(h.api,first,input),/Connection lost/);
 const firstRetries=await Promise.all(Array.from({length:4},()=>saveInventoryStockCorrection(h.api,first,input)));
 assert.ok(firstRetries.every(result=>result.status==='already-applied'));
 assert.equal([...h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,1);
 const second=await open(h);assert.notEqual(second.previewId,first.previewId);
 assert.equal((await saveInventoryStockCorrection(h.api,second,input)).status,'saved');
 assert.equal((await saveInventoryStockCorrection(h.api,second,input)).status,'already-applied');
 assert.equal((await saveInventoryStockCorrection(h.api,first,input)).status,'already-applied','a newer preview does not replace the older retry identity');
 const logs=[...h.docs].filter(([path])=>path.startsWith('stock_logs/'));
 assert.equal(logs.length,2);assert.ok(logs.every(([,log])=>log.variance===0&&log.oldQty===500&&log.newQty===500));
 assert.equal(h.get('inventory/Main Office').currentStock,500);assert.equal(h.get('settings/recipe_revision').version,2);
});

test('zero physical count is valid, lost acknowledgments and concurrent retries cannot duplicate correction logs',async()=>{
 const h=fixture(),state=await open(h);h.loseNextAck();const input={purchaseQty:'0',baseQty:'0',note:'No stock left',operationId:'zero-count'};
 await assert.rejects(saveInventoryStockCorrection(h.api,state,input),/Connection lost/);
 const retry=await Promise.all(Array.from({length:6},()=>saveInventoryStockCorrection(h.api,state,input)));
 assert.ok(retry.every(result=>result.status==='already-applied'));assert.equal(h.get('inventory/Main Office').currentStock,0);
 assert.equal([...h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,1);assert.equal(h.get('settings/recipe_revision').version,1);
});

test('permission revocation after preview or inside a transaction prevents all changes',async()=>{
 const h=fixture({owner:false}),state=await open(h);h.put('hq_managers/access',{...h.get('hq_managers/access'),permissions:['dashboard']});
 await assert.rejects(saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'2'}),/permissions/);
 const f=fixture(),opened=await open(f),run=f.api.runTransaction;
 f.api.runTransaction=(db,callback)=>run(db,async tx=>{f.put('hq_managers/access',{...f.get('hq_managers/access'),assignedBranch:'Agdao'});return callback(tx);});
 await assert.rejects(saveInventoryStockCorrection(f.api,opened,{purchaseQty:'1',note:'Count',operationId:'revoked-scope'}),/affected item changed/);
 assert.equal(f.get('inventory/Main Office').currentStock,500);
});

test('rejected commits are atomic and no-op settings produce no revision or log',async()=>{
 const h=fixture(),state=await open(h);assert.equal((await saveInventoryEditorSettings(h.api,state,{})).status,'unchanged');
 assert.equal(h.get('settings/recipe_revision'),undefined);h.failNextCommit();
 await assert.rejects(saveInventoryStockCorrection(h.api,state,{purchaseQty:'1',note:'Count',operationId:'reject'}),/Commit rejected/);
 assert.equal(h.get('inventory/Main Office').currentStock,500);assert.equal([...h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,0);
});

test('mutated open baselines and invalid saved counts or conversions are refused before correction',async()=>{
 const h=fixture(),state=await open(h);state.original.currentStock=900;
 await assert.rejects(saveInventoryStockCorrection(h.api,state,{baseQty:'100',note:'Count'}),/baseline changed/);
 for(const patch of [{conversionRate:true},{conversionRate:''},{currentStock:false},{currentStock:''}]){
  const f=fixture();f.put('inventory/Main Office',{...f.get('inventory/Main Office'),...patch});const opened=await open(f);
  await assert.rejects(saveInventoryStockCorrection(f.api,opened,{baseQty:'100',note:'Count'}),/conversion|quantity is invalid/);
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,0);
 }
});

test('a missing or null recorded count never becomes a fabricated zero baseline or adjustment history',async()=>{
 for(const missing of [true,false]){
  const h=fixture(),original={...h.get('inventory/Main Office')};
  if(missing)delete original.currentStock;else original.currentStock=null;
  h.put('inventory/Main Office',original);const state=await open(h);
  await assert.rejects(saveInventoryStockCorrection(h.api,state,{baseQty:'100',note:'Physical count',operationId:'unknown-baseline'}),/no recorded stock balance/);
  assert.deepEqual(h.get('inventory/Main Office'),original);
  assert.equal(h.get('settings/recipe_revision'),undefined);
  assert.equal([...h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,0);
 }
});

test('account identity changes and simultaneous settings saves cannot overwrite each other',async()=>{
 const h=fixture(),state=await open(h);h.api.auth.currentUser.uid='other';h.api.sessionUser.uid='other';
 await assert.rejects(saveInventoryEditorSettings(h.api,state,{maintainingPurchaseQty:'2'}),/account changed/);
 const f=fixture(),opened=await open(f);
 const results=await Promise.allSettled([
  saveInventoryEditorSettings(f.api,opened,{maintainingPurchaseQty:'2'},{operationId:'first'}),
  saveInventoryEditorSettings(f.api,opened,{maintainingPurchaseQty:'3'},{operationId:'second'})
 ]);
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.get('settings/recipe_revision').version,1);
 assert.ok([2000,3000].includes(f.get('inventory/Main Office').maintainingStock));
});
