import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {loadInventoryStockFormState,saveInventoryCreate,saveHqRestock,saveKitchenPrep,runInventoryStockFormRead} from '../takodeal-manager/inventory-stock-form-actions.js';
import {buildInventoryCreate,restockLine,mergeRestockLine,buildHqRestock,buildKitchenPrep,inventoryCreateId} from '../takodeal-manager/inventory-stock-form-model.js';
import {recipePlan,saveRecipePlan} from '../takodeal-manager/recipe-changes.js';
import {inventoryStockFormMarkup} from '../takodeal-manager/inventory-stock-forms.js';

function fixture({owner=true,permissions=['inventory'],branch='All'}={}){
 const h=firestoreHarness(),email=owner?OWNER_EMAIL:'manager@example.test';h.api.auth={currentUser:{uid:'actor',email}};h.api.sessionUser={uid:'actor',email,cashierName:'Test manager'};
 h.put('hq_managers/access',{email,role:'Manager',pin:'1234',permissions,assignedBranch:branch});
 h.api.getDocFromServer=async reference=>({id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))});
 for(const name of ['Main Office','Maa','Agdao'])h.put('branches/'+name,{name});
 h.put('branches/closed',{name:'Closed store',active:false});
 for(const branch of ['Main Office','Maa']){
  h.put('inventory/sugar-'+branch,{name:'Sugar',branch,category:'Ingredients',purchaseUom:'Kilo',uom:'gram',baseUom:'gram',conversionRate:1000,currentStock:3000,purchaseCost:100,baseCost:.1});
  h.put('inventory/sauce-'+branch,{name:'Sauce',branch,category:'Prepared Batch',purchaseUom:'Gallon',uom:'gram',baseUom:'gram',conversionRate:3750,currentStock:100,purchaseCost:200,baseCost:200/3750});
 }
 h.put('bom/sauce',{menuItem:'Sauce',ingredientName:'Sugar',qty:400});return h;
}
const input={branch:'Main Office',name:'New bowl',category:'Packaging',purchaseUom:'Pack',baseUom:'piece',conversion:'50',cost:'100',initialQty:'2',targetPurchase:'10',targetBase:'5',alertPurchase:'1',cycle:'Weekly',broadcast:true,allowRequest:true,showInPrep:false};
const item=(h,id='sugar-Main Office')=>({id,...h.get('inventory/'+id)});
const cart=h=>[restockLine(item(h),{quantity:2,unitCost:150})];
const logs=h=>[...h.docs].filter(([path])=>path.startsWith('stock_logs/')).map(([,data])=>data);

test('new item copies never broadcast selected branch stock, alert or maintaining target',()=>{
 const result=buildInventoryCreate(input,{branches:['Main Office','Maa','Agdao']});assert.equal(result.created.length,3);
 const hq=result.created.find(row=>row.data.branch==='Main Office').data;assert.equal(hq.currentStock,100);assert.equal(hq.maintainingStock,505);assert.equal(hq.lowStockAlert,50);
 for(const row of result.created.filter(row=>row.data.branch!=='Main Office')){assert.equal(row.data.currentStock,0);assert.equal(row.data.maintainingStock,0);assert.equal(row.data.lowStockAlert,0);}
 const maa=buildInventoryCreate({...input,branch:'Maa'},{branches:['Main Office','Maa']});assert.equal(maa.created.find(row=>row.data.branch==='Main Office').data.maintainingStock,0);
});
test('new item conversion, costs and stock quantities reject blanks, negatives and nonfinite numbers',()=>{
 for(const [field,value] of [['conversion',0],['conversion','Infinity'],['cost',''],['cost',-1],['initialQty',-1],['targetBase','abc'],['alertPurchase',-1],['cost',true]])assert.throws(()=>buildInventoryCreate({...input,[field]:value},{branches:['Main Office']}),/Enter/);
 assert.equal(buildInventoryCreate({...input,cost:0,initialQty:''},{branches:['Main Office']}).created[0].data.currentStock,0);
 assert.notEqual(inventoryCreateId('A_B','C'),inventoryCreateId('A','B_C'));
});
test('duplicate names are case/spacing safe and existing copies are skipped, never overwritten',()=>{
 assert.throws(()=>buildInventoryCreate({...input,name:' sugar '},{branches:['Main Office'],items:[{name:'Sugar',branch:'Main Office'}]}),/already exists/);
 const result=buildInventoryCreate(input,{branches:['Main Office','Maa'],items:[{name:'NEW  BOWL',branch:'Maa'}]});assert.deepEqual(result.skipped,['Maa']);assert.equal(result.created.length,1);
});
test('new item creation writes initial stock history and all branch copies atomically',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'add');assert.ok(!state.branches.includes('Closed store'));
 await saveInventoryCreate(h.api,state,input,{operationId:'create'});assert.equal(h.get('inventory/'+inventoryCreateId('Main Office','New bowl')).currentStock,100);assert.equal(h.get('inventory/'+inventoryCreateId('Maa','New bowl')).currentStock,0);assert.equal(logs(h).length,1);assert.equal(logs(h)[0].variance,100);
});
test('creation commit failure leaves no stock, copy or audit record',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'add');h.failNextCommit();await assert.rejects(saveInventoryCreate(h.api,state,input,{operationId:'create-fail'}),/Commit rejected/);assert.equal(h.get('inventory/'+inventoryCreateId('Main Office','New bowl')),undefined);assert.equal(logs(h).length,0);
});
test('creation retry and concurrent retries after lost acknowledgment create one initial audit',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'add');h.loseNextAck();await assert.rejects(saveInventoryCreate(h.api,state,input,{operationId:'create-once'}),/Connection lost/);
 const results=await Promise.all([1,2,3].map(()=>saveInventoryCreate(h.api,state,input,{operationId:'create-once'})));assert.ok(results.every(result=>result.status==='already-applied'));assert.equal(logs(h).length,1);
});
test('fresh saved branch permissions limit creation and reject Main Office receiving',async()=>{
 const h=fixture({owner:false,branch:'Maa'}),state=await loadInventoryStockFormState(h.api,'add');assert.deepEqual(state.branches,['Maa']);await assert.rejects(saveInventoryCreate(h.api,state,input),/branch.*access/);await assert.rejects(loadInventoryStockFormState(h.api,'restock'),/Main Office/);
 await saveInventoryCreate(h.api,state,{...input,branch:'Maa'},{operationId:'local'});assert.equal(h.get('inventory/'+inventoryCreateId('Main Office','New bowl')),undefined);
});
test('restock mixed-price cart lines use weighted purchase cost and an exact cart invoice total',()=>{
 const h=fixture(),first=restockLine(item(h),{quantity:1,unitCost:100}),second=restockLine(item(h),{quantity:3,unitCost:200});const merged=mergeRestockLine([first],second);assert.equal(merged[0].purchQty,4);assert.equal(merged[0].unitCost,175);assert.equal(merged[0].subtotal,700);
 const result=buildHqRestock([item(h)],merged);assert.equal(result.totalCost,700);assert.equal(result.updates[0].newQty,7000);assert.equal(result.updates[0].patch.baseCost,1000/7000);
});
test('restock preserves negative debt while averaging only the real received quantity',()=>{
 const h=fixture(),negative={...item(h),currentStock:-2500};const result=buildHqRestock([negative],[restockLine(negative,{quantity:2,unitCost:150})]);assert.equal(result.updates[0].newQty,-500);assert.equal(result.updates[0].patch.baseCost,.15);assert.equal(result.updates[0].oldQty,-2500);
});
test('restock supports explicit free stock and refuses invalid/missing historical positive-stock costs',()=>{
 const h=fixture(),row=item(h);assert.equal(buildHqRestock([row],[restockLine(row,{quantity:1,unitCost:0})]).updates[0].patch.baseCost,.075);
 for(const patch of [{conversionRate:0},{currentStock:'bad'},{purchaseCost:-1},{purchaseCost:undefined,baseCost:undefined}]){const invalid={...row,...patch};assert.throws(()=>buildHqRestock([invalid],[{...cart(h)[0]}]),/valid|missing|existing cost/);}
});
test('restock values existing stock with its recorded base cost rather than a stale purchase cost alias',()=>{
 const h=fixture(),row={...item(h),baseCost:.2,purchaseCost:100};const result=buildHqRestock([row],[restockLine(row,{quantity:1,unitCost:100})]);assert.equal(result.updates[0].patch.baseCost,.175);assert.equal(result.updates[0].patch.purchaseCost,175);
 assert.throws(()=>buildHqRestock([{...row,baseCost:-1}],[restockLine(row,{quantity:1,unitCost:100})]),/base cost/);
});
test('restock stock, audit and versioned invoice snapshots save together and retry once',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'restock'),input={cart:cart(h),supplier:'Invoice 123',operationId:'restock-once'};h.loseNextAck();await assert.rejects(saveHqRestock(h.api,state,input),/Connection lost/);assert.equal((await saveHqRestock(h.api,state,input)).status,'already-applied');
 assert.equal(h.get('inventory/sugar-Main Office').currentStock,5000);assert.equal(logs(h).length,1);const invoice=h.get('hq_restocks/hq_restock_restock-once');assert.equal(invoice.totalCost,300);assert.equal(invoice.version,2);assert.equal(invoice.inventoryEffects[0].before.currentStock,3000);assert.equal(invoice.inventoryEffects[0].after.currentStock,5000);assert.equal(invoice.inventoryEffects[0].before.purchaseCost,100);assert.equal(invoice.inventoryEffects[0].after.purchaseCost,120);assert.equal(h.get('inventory/sugar-Maa').currentStock,3000);
});
test('restock stale quantity or cost aborts every invoice and audit write',async()=>{
 for(const patch of [{currentStock:2999},{baseCost:.2},{purchaseCost:120},{conversionRate:500}]){const h=fixture(),state=await loadInventoryStockFormState(h.api,'restock');h.put('inventory/sugar-Main Office',{...h.get('inventory/sugar-Main Office'),...patch});await assert.rejects(saveHqRestock(h.api,state,{cart:cart(h),operationId:'stale'}),/affected item changed|units changed/);assert.equal(logs(h).length,0);assert.equal(h.get('hq_restocks/hq_restock_stale'),undefined);}
});
test('failed restock transaction leaves inventory, invoice and audit untouched',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'restock');h.failNextCommit();await assert.rejects(saveHqRestock(h.api,state,{cart:cart(h),operationId:'restock-fail'}),/Commit rejected/);assert.equal(h.get('inventory/sugar-Main Office').currentStock,3000);assert.equal(logs(h).length,0);assert.equal(h.get('hq_restocks/hq_restock_restock-fail'),undefined);
});
test('prep output uses purchase-unit yield and validates full ingredient requirements',()=>{
 const h=fixture(),items=[...h.docs].filter(([p])=>p.startsWith('inventory/')).map(([p,data])=>({id:p.slice(10),...data})),bom=[h.get('bom/sauce')];const plan=buildKitchenPrep(items,bom,{branch:'Main Office',itemId:'sauce-Main Office',quantity:2});assert.equal(plan.added,7500);assert.equal(plan.newQty,7600);assert.equal(plan.requirements[0].newQty,2200);assert.equal(plan.requirements[0].needed,800);
 for(const badBom of [[],[...bom,...bom],[{...bom[0],qty:0}],[{...bom[0],ingredientName:'Missing'}],[{...bom[0],ingredientName:'Sauce'}]])assert.throws(()=>buildKitchenPrep(items,badBom,{branch:'Main Office',itemId:'sauce-Main Office',quantity:1}),/recipe|BOM|inventory|itself/i);
 assert.throws(()=>buildKitchenPrep(items,bom,{branch:'Main Office',itemId:'sauce-Main Office',quantity:10}),/Not enough/);
});
test('prep atomically records ingredient deductions and prepared output without changing cost or other branches',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'prep');await saveKitchenPrep(h.api,state,{branch:'Main Office',itemId:'sauce-Main Office',quantity:'2'},{operationId:'prep'});assert.equal(h.get('inventory/sugar-Main Office').currentStock,2200);assert.equal(h.get('inventory/sauce-Main Office').currentStock,7600);assert.equal(h.get('inventory/sauce-Maa').currentStock,100);assert.equal(h.get('inventory/sauce-Main Office').purchaseCost,200);assert.equal(logs(h).length,2);const output=logs(h).find(row=>row.type==='Manager Prep Batch');assert.equal(output.ingredients[0].qty,800);assert.equal(output.purchaseQty,2);
});
test('prep no partial deductions on failed commit, insufficient stock or stale BOM/ingredient',async()=>{
 for(const failure of ['commit','low','recipe','stale']){const h=fixture(),state=await loadInventoryStockFormState(h.api,'prep');if(failure==='commit')h.failNextCommit();if(failure==='low')state.items.find(row=>row.id==='sugar-Main Office').currentStock=1;if(failure==='recipe')h.put('bom/sauce',{...h.get('bom/sauce'),qty:1000});if(failure==='stale')h.put('inventory/sugar-Main Office',{...h.get('inventory/sugar-Main Office'),currentStock:2900});await assert.rejects(saveKitchenPrep(h.api,state,{branch:'Main Office',itemId:'sauce-Main Office',quantity:2},{operationId:failure}),/Commit rejected|preview changed|affected item changed/);assert.equal(h.get('inventory/sauce-Main Office').currentStock,100);assert.equal(logs(h).length,0);}
});
test('prep same open retry is idempotent but a new open records a separate real batch',async()=>{
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'prep'),input={branch:'Main Office',itemId:'sauce-Main Office',quantity:1};h.loseNextAck();await assert.rejects(saveKitchenPrep(h.api,state,input),/Connection lost/);assert.equal((await saveKitchenPrep(h.api,state,input)).status,'already-applied');const next=await loadInventoryStockFormState(h.api,'prep');await saveKitchenPrep(h.api,next,input);assert.equal(h.get('inventory/sugar-Main Office').currentStock,2200);assert.equal(logs(h).length,4);
});
test('revoke, account switch and wrong tab permissions reject every stock writer before commit',async()=>{
 for(const kind of ['add','prep','restock']){const h=fixture({owner:false}),state=await loadInventoryStockFormState(h.api,kind);h.put('hq_managers/access',{...h.get('hq_managers/access'),permissions:['waste']});const save=kind==='add'?()=>saveInventoryCreate(h.api,state,input):kind==='prep'?()=>saveKitchenPrep(h.api,state,{branch:'Main Office',itemId:'sauce-Main Office',quantity:1}):()=>saveHqRestock(h.api,state,{cart:cart(h)});await assert.rejects(save(),/permissions/);assert.equal(logs(h).length,0);}
 const h=fixture(),state=await loadInventoryStockFormState(h.api,'restock');h.api.auth.currentUser={uid:'different',email:'other@test.invalid'};await assert.rejects(saveHqRestock(h.api,state,{cart:cart(h)}),/approved account/);
});
test('hq_restocks inventory transaction is allowed only through the inventory route and saved authorized session',async()=>{
 const h=fixture({owner:false}),state={revision:{version:0,revisionId:''},documents:{}};const plan=recipePlan(state,[{table:'hq_restocks',id:'invoice',mode:'set',data:{totalCost:1}}]);
 await assert.rejects(saveRecipePlan(h.api,plan,{operationId:'menu-block',route:'menu'}),/invalid writes/);await saveRecipePlan(h.api,plan,{operationId:'inventory-save',route:'inventory'});assert.equal(h.get('hq_restocks/invoice').totalCost,1);
 const other=fixture({owner:false,permissions:['history']});await assert.rejects(saveRecipePlan(other.api,plan,{operationId:'denied',route:'inventory'}),/permissions/);assert.equal(other.get('hq_restocks/invoice'),undefined);
});
test('new form markup has grouped optional settings, explicit broadcast and responsive cart cards',()=>{
 const add=inventoryStockFormMarkup('add'),prep=inventoryStockFormMarkup('prep'),restock=inventoryStockFormMarkup('restock');assert.ok(add.includes('Starting stock · optional'));assert.ok(add.includes('Copies start at zero stock and zero targets'));assert.ok(!add.includes('id="newInvBroadcastAll" checked'));assert.ok(prep.includes('batchRecipePreview'));assert.ok(restock.includes('inventory-stock-cart'));assert.ok(!restock.includes('<table'));assert.ok(!restock.includes('overflow-x'));
});
test('opening or retrying a timed-out read never starts another pending SDK request',async()=>{
 const h=fixture();let resolve,calls=0;const work=()=>{calls++;return new Promise(done=>resolve=done);};
 const first=runInventoryStockFormRead(h.api,'sample',work,{timeoutMs:5}),same=runInventoryStockFormRead(h.api,'sample',work,{timeoutMs:5});assert.equal(first,same);
 await assert.rejects(first,/still pending/);await assert.rejects(runInventoryStockFormRead(h.api,'sample',work,{timeoutMs:5}),/No additional read/);assert.equal(calls,1);
 resolve('finished');await new Promise(done=>setTimeout(done,0));assert.equal(await runInventoryStockFormRead(h.api,'sample',async()=>{calls++;return 'new';},{timeoutMs:5}),'new');assert.equal(calls,2);
});
test('prep and restock reads stay within the selected branch and prepared recipes',async()=>{
 const h=fixture(),reads=[],get=h.api.getDocsFromServer;h.api.getDocsFromServer=query=>{reads.push(query);return get(query);};
 const prep=await loadInventoryStockFormState(h.api,'prep',{branch:'Maa'});assert.equal(prep.branch,'Maa');assert.ok(prep.items.every(row=>row.branch==='Maa'));assert.ok(reads.filter(row=>row.table==='inventory').every(row=>row.filters.some(filter=>filter.key==='branch'&&filter.value==='Maa')));assert.ok(reads.filter(row=>row.table==='bom').every(row=>row.filters.some(filter=>filter.key==='menuItem'&&filter.value==='Sauce')));
 reads.length=0;const restock=await loadInventoryStockFormState(h.api,'restock');assert.ok(restock.items.every(row=>row.branch==='Main Office'));assert.ok(reads.filter(row=>row.table==='inventory').every(row=>row.filters.some(filter=>filter.key==='branch'&&filter.value==='Main Office')));assert.equal(reads.filter(row=>row.table==='bom').length,0);
});
