import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {loadInventoryDeletionState,inventoryDeletionPreflight,inventoryDeletionPlan,inventoryDeletionConfirmation,saveRecipePlan,operationFor,recipeOperationApplied} from '../takodeal-manager/recipe-changes.js';
import {buildRecipeCostCatalog,summarizeRecipeCosts} from '../takodeal-manager/recipe-cost-model.js';

const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const clone=value=>structuredClone(value);
const base={name:'Fork',branch:'Citygate',category:'Consumables',purchaseUom:'pack',baseUom:'piece',uom:'piece',conversionRate:700,purchaseCost:165,baseCost:165/700};
function fixture(){
 const h=firestoreHarness(),api=h.api,notices=[],confirmations=[],elements=new Map(),selected=[{value:'duplicate'}],invalidations=[],deleteButton={disabled:false,textContent:'Delete'};
 h.put('hq_managers/access',{email:'qa@example.test',role:'Manager',pin:'1234',permissions:['inventory'],allowedBranches:['All']});
 api.auth={currentUser:{uid:'qa',email:'qa@example.test'}};api.sessionUser={uid:'qa',email:'qa@example.test',role:'Manager',permissions:['inventory'],allowedBranches:['All']};
 api.getDocFromServer=async ref=>({id:ref.id,ref,exists:()=>h.docs.has(ref.path),data:()=>clone(h.get(ref.path))});
 h.put('inventory/duplicate',{...base,currentStock:0});h.put('inventory/retained',{...base,currentStock:-10533});
 h.put('inventory/hq',{...base,branch:'Main Office',currentStock:2100});
 h.put('inventory/maa',{...base,branch:'Maa',currentStock:-4771});
 h.put('bom/linked',{menuItem:'Fictional Takoyaki',ingredientName:'Fork',qty:1});
 h.put('menu/linked',{name:'Fictional Takoyaki',price:99,addons:[{name:'Extra',linkedIngredient:'Fork',deductQty:1}]});
 h.put('global_addons/linked',{name:'Fictional utensil',linkedIngredient:'Fork',deductQty:1});
 h.put('settings/global_mixmatch',{mappings:[{flavor:'Fictional',linkedIngredient:'Fork',deductQty:1}]});
 h.put('stock_logs/old-target',{inventoryId:'duplicate',itemName:'Fork',branch:'Citygate',qty:12});
 h.put('stock_logs/old-retained',{inventoryId:'retained',itemName:'Fork',branch:'Citygate',qty:700});
 h.put('transactions/paid',{branch:'Citygate',status:'Paid',total:99,inventoryMovements:[{inventoryId:'retained',ingredientName:'Fork',quantity:1}]});
 h.put('payroll_records/paid',{staffId:'fictional-staff',finalNetPay:2000});
 h.put('cash_accounts/saved',{balance:3000});
 const protectedPaths=['stock_logs/old-target','stock_logs/old-retained','transactions/paid','payroll_records/paid','cash_accounts/saved','bom/linked','menu/linked','global_addons/linked','settings/global_mixmatch','inventory/hq','inventory/maa'];
 const protectedBefore=new Map(protectedPaths.map(path=>[path,clone(h.get(path))]));
 const el=id=>{if(!elements.has(id))elements.set(id,{disabled:false,checked:true,style:{},value:'',scrollTop:81,textContent:'',setAttribute(){}});return elements.get(id);};
 api.ManagerUI={notify:value=>notices.push(String(value)),confirm:async value=>{confirmations.push(String(value));return true;}};
 api.invalidateCache=name=>invalidations.push(name);api.loadInventoryData=async()=>{};api.recipeCostUI={inventoryChanged:async()=>{invalidations.push('recipe-costs');}};
 const document={getElementById:el,querySelectorAll:selector=>selector.includes('inv-bulk-checkbox')?selected:[],querySelector:selector=>selector==='#inventoryTableBody'?{closest:()=>({querySelector:()=>deleteButton})}:null};
 const context={window:api,document,console:{error(){}},setTimeout:fn=>fn(),loadInventoryDeletionState,inventoryDeletionPreflight,inventoryDeletionPlan,inventoryDeletionConfirmation,saveRecipePlan,operationFor,recipeOperationApplied};
 const route=name=>{const start=main.indexOf('window.'+name+' ='),end=main.indexOf('\n};',start)+3;assert.ok(start>=0&&end>start,'Actual handler must exist: '+name);vm.runInNewContext(main.slice(start,end),context);return api[name];};
 const unchanged=()=>{for(const [path,value]of protectedBefore)assert.deepEqual(h.get(path),value,path+' must be preserved');};
 const setup=()=>{route('checkInventoryDeletion');return {single:route('deleteInventoryItem'),bulk:route('bulkDeleteInventory')};};
 return {h,api,notices,confirmations,selected,invalidations,deleteButton,el,document,context,route,setup,unchanged};
}
async function deletion(f,ids=['duplicate'],operationId='delete-fictional-duplicate'){
 const state=await loadInventoryDeletionState(f.api,ids),plan=inventoryDeletionPlan(state,ids);
 return {state,plan,save:()=>saveRecipePlan(f.api,plan,{operationId,route:'inventory'})};
}

test('a referenced zero-stock duplicate has an exact retained branch record and deletes only the selected document',async()=>{
 const f=fixture(),retained=clone(f.h.get('inventory/retained')),removed=clone(f.h.get('inventory/duplicate')),{state,plan,save}=await deletion(f);
 assert.deepEqual(state.deletionRetainedIds,['retained']);assert.deepEqual(state.documents.inventory.retained,retained);
 assert.equal(plan.writes.length,1);assert.deepEqual(plan.writes[0],{table:'inventory',id:'duplicate',mode:'delete'});
 assert.ok(plan.expected.some(row=>row.table==='inventory'&&row.id==='retained'&&row.exists));
 assert.equal((await save()).status,'saved');assert.equal(f.h.get('inventory/duplicate'),undefined);assert.deepEqual(f.h.get('inventory/retained'),retained);
 assert.equal(f.h.get('settings/recipe_revision').version,1);
 const audit=f.h.get('settings/recipe_operation_delete-fictional-duplicate');assert.deepEqual(audit.deletedInventory,[{id:'duplicate',record:removed}]);assert.deepEqual(audit.retainedInventory,[{removedId:'duplicate',keptId:'retained',name:'Fork',branch:'Citygate'}]);f.unchanged();
});
test('an explicitly saved numeric-string zero is accepted without changing survivor stock',async()=>{
 const f=fixture();f.h.put('inventory/duplicate',{...base,currentStock:'0'});const {save}=await deletion(f);await save();assert.equal(f.h.get('inventory/retained').currentStock,-10533);f.unchanged();
});
test('removing the empty duplicate clears the Citygate recipe-cost ambiguity using the untouched retained unit cost',async()=>{
 const f=fixture(),rows=()=>[...f.h.docs].filter(([path])=>path.startsWith('inventory/')).map(([path,data])=>({...clone(data),id:path.slice('inventory/'.length)}));
 const recipe=[{ingredientName:'Fork',qty:1}],before=buildRecipeCostCatalog(rows(),{basis:'Citygate'});assert.equal(summarizeRecipeCosts(recipe,before).valid,false);assert.match(before.issues.Fork,/Duplicate inventory records in Citygate/);
 const {save}=await deletion(f);await save();const after=summarizeRecipeCosts(recipe,buildRecipeCostCatalog(rows(),{basis:'Citygate'}));assert.equal(after.valid,true);assert.equal(after.total,165/700);assert.equal(f.h.get('inventory/retained').currentStock,-10533);f.unchanged();
});
for(const [label,stock]of [['positive',1],['negative',-1],['missing',undefined],['blank',''],['whitespace',' '],['null',null],['boolean',false],['NaN',NaN],['infinite',Infinity],['object',{}]]){
 test('a linked '+label+' stock record is not authorized as an empty duplicate',async()=>{
  const f=fixture(),row={...base};if(stock!==undefined)row.currentStock=stock;f.h.put('inventory/duplicate',row);
  await assert.rejects(loadInventoryDeletionState(f.api,['duplicate']));assert.deepEqual(f.h.get('inventory/duplicate'),row);assert.equal(f.h.get('settings/recipe_revision'),undefined);f.unchanged();
 });
}
test('the last linked stock item cannot be deleted even when the same item exists in other branches',async()=>{
 const f=fixture();f.h.docs.delete('inventory/retained');await assert.rejects(loadInventoryDeletionState(f.api,['duplicate']),/still used|retained|matching|last|duplicate/i);assert.ok(f.h.get('inventory/duplicate'));f.unchanged();
});
test('selecting both duplicates cannot leave the branch without its linked ingredient',async()=>{
 const f=fixture();f.h.put('inventory/retained',{...base,currentStock:0});await assert.rejects(loadInventoryDeletionState(f.api,['duplicate','retained']));assert.ok(f.h.get('inventory/duplicate'));assert.ok(f.h.get('inventory/retained'));f.unchanged();
});
test('three matches are not silently resolved to an arbitrary retained inventory record',async()=>{
 const f=fixture();f.h.put('inventory/third',{...base,currentStock:800});await assert.rejects(loadInventoryDeletionState(f.api,['duplicate']));assert.ok(f.h.get('inventory/duplicate'));f.unchanged();
});
test('several selected empty copies may leave exactly one compatible retained record',async()=>{
 const f=fixture();f.h.put('inventory/duplicate-two',{...base,currentStock:0});const {plan,save}=await deletion(f,['duplicate','duplicate-two']);
 assert.deepEqual(plan.writes.map(row=>row.id).sort(),['duplicate','duplicate-two']);await save();assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal(f.h.get('inventory/duplicate-two'),undefined);assert.equal(f.h.get('inventory/retained').currentStock,-10533);f.unchanged();
});
for(const [label,patch]of [['base unit',{baseUom:'gram',uom:'gram'}],['purchase unit',{purchaseUom:'box'}],['conversion',{conversionRate:100}],['conflicting unit aliases',{uom:'gram'}],['conflicting conversion aliases',{conversion:600}],['unknown conversion',{conversionRate:''}],['unknown base',{baseUom:'',uom:''}]]){
 test('a retained item with '+label+' differences is not treated as a safe interchangeable record',async()=>{
  const f=fixture();f.h.put('inventory/retained',{...f.h.get('inventory/retained'),...patch});await assert.rejects(loadInventoryDeletionState(f.api,['duplicate']));assert.ok(f.h.get('inventory/duplicate'));assert.equal(f.h.get('settings/recipe_revision'),undefined);
 });
}
test('case-different or whitespace-different saved names cannot stand in for exact recipe links',async()=>{
 for(const name of ['fork','Fork ']){const f=fixture();f.h.put('inventory/retained',{...f.h.get('inventory/retained'),name});await assert.rejects(loadInventoryDeletionState(f.api,['duplicate']));assert.ok(f.h.get('inventory/duplicate'));}
});
test('an unused single stock record keeps the existing deletion behavior without a linked-name waiver',async()=>{
 const f=fixture();f.h.put('inventory/unused',{...base,name:'Unused packaging',currentStock:7});const {plan,save}=await deletion(f,['unused']);assert.deepEqual(plan.writes.map(row=>row.id),['unused']);await save();assert.equal(f.h.get('inventory/unused'),undefined);assert.ok(f.h.get('inventory/duplicate'));f.unchanged();
});
for(const [label,change]of [
 ['target stock',f=>f.h.put('inventory/duplicate',{...f.h.get('inventory/duplicate'),currentStock:1})],
 ['retained stock',f=>f.h.put('inventory/retained',{...f.h.get('inventory/retained'),currentStock:-10534})],
 ['retained existence',f=>f.h.docs.delete('inventory/retained')],
 ['retained unit',f=>f.h.put('inventory/retained',{...f.h.get('inventory/retained'),conversionRate:500})],
 ['recipe link',f=>f.h.put('bom/linked',{...f.h.get('bom/linked'),qty:2})],
 ['global add-on link',f=>f.h.put('global_addons/linked',{...f.h.get('global_addons/linked'),deductQty:2})],
 ['mix match link',f=>f.h.put('settings/global_mixmatch',{mappings:[{linkedIngredient:'Fork',flavor:'Changed'}]})],
 ['saved recipe revision',f=>f.h.put('settings/recipe_revision',{version:1,revisionId:'another-editor'})],
 ['saved account access',f=>f.h.put('hq_managers/access',{...f.h.get('hq_managers/access'),permissions:[]})]
]){
 test('a changed '+label+' after the preview cancels the whole duplicate deletion',async()=>{
  const f=fixture(),{save}=await deletion(f);change(f);await assert.rejects(save());assert.ok(f.h.get('inventory/duplicate'));assert.equal(f.h.get('settings/recipe_operation_delete-fictional-duplicate'),undefined);
 });
}
test('a recipe revision change during same-name candidate loading cannot authorize deletion',async()=>{
 const f=fixture(),read=f.api.getDocsFromServer;let changed=false;f.api.getDocsFromServer=async query=>{const result=await read(query);if(query.table==='inventory'&&!changed){changed=true;f.h.put('settings/recipe_revision',{version:3,revisionId:'during-candidates'});}return result;};
 await assert.rejects(loadInventoryDeletionState(f.api,['duplicate']),/changed|refresh/i);assert.ok(f.h.get('inventory/duplicate'));assert.equal(changed,true);
});
test('a stalled server dependency check times out without authorizing deletion and can be retried',async()=>{
 const f=fixture(),before=clone([...f.h.docs]),read=f.api.getDocsFromServer;f.api.getDocsFromServer=async()=>new Promise(()=>{});
 await assert.rejects(loadInventoryDeletionState(f.api,['duplicate'],{timeoutMs:5}),/took too long|Nothing was deleted/);assert.deepEqual([...f.h.docs],before);
 f.api.getDocsFromServer=read;const {save}=await deletion(f);await save();assert.equal(f.h.get('inventory/duplicate'),undefined);f.unchanged();
});
test('a rejected commit preserves duplicate, survivor, historical records and retry identity',async()=>{
 const f=fixture(),{save}=await deletion(f);f.h.failNextCommit();await assert.rejects(save(),/Commit rejected/);assert.ok(f.h.get('inventory/duplicate'));assert.equal(f.h.get('settings/recipe_revision'),undefined);f.unchanged();await save();assert.equal(f.h.get('inventory/duplicate'),undefined);f.unchanged();
});
test('a lost acknowledgement is recovered from the exact operation marker without a second deletion revision',async()=>{
 const f=fixture(),{save}=await deletion(f);f.h.loseNextAck();await assert.rejects(save(),/Connection lost after commit/);assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal((await save()).status,'already-applied');assert.equal(f.h.get('settings/recipe_revision').version,1);f.unchanged();
});
test('two simultaneous attempts with the same operation identity apply one immutable result',async()=>{
 const f=fixture(),{save}=await deletion(f);const result=await Promise.all([save(),save()]);assert.ok(result.some(row=>row.status==='saved'));assert.ok(result.some(row=>row.status==='already-applied'));assert.equal(f.h.get('settings/recipe_revision').version,1);f.unchanged();
});
test('actual single Delete preflights, confirms the duplicate and preserves the retained branch balance',async()=>{
 const f=fixture(),{single}=f.setup();await single('duplicate','Fork');assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal(f.h.get('inventory/retained').currentStock,-10533);assert.equal(f.confirmations.length,1);assert.match(f.confirmations[0],/Fork/);assert.match(f.confirmations[0],/Citygate|retained|keep|duplicate/i);assert.equal(f.api.inventoryDeletionBusy,false);assert.ok(f.invalidations.includes('inventory'));f.unchanged();
});
test('actual bulk Delete uses exact selected IDs and does not delete same-name items in other branches',async()=>{
 const f=fixture(),{bulk}=f.setup();await bulk();assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal(f.h.get('inventory/retained').currentStock,-10533);assert.equal(f.api.inventoryDeletionBusy,false);assert.equal(f.el('selectAllInv').checked,false);assert.equal(f.confirmations.length,1);assert.ok(f.invalidations.includes('recipe-costs'));f.unchanged();
});
test('cancelling actual bulk duplicate confirmation produces no stock, revision or history write',async()=>{
 const f=fixture(),before=clone([...f.h.docs]),{bulk}=f.setup();f.api.ManagerUI.confirm=async()=>false;await bulk();assert.deepEqual([...f.h.docs],before);assert.equal(f.api.inventoryDeletionBusy,false);
});
test('actual main Delete recovers its applied outcome after a lost acknowledgement without checking now-missing target again',async()=>{
 const f=fixture(),{bulk}=f.setup();f.h.loseNextAck();await bulk();assert.equal(f.h.get('inventory/duplicate'),undefined);await bulk();assert.equal(f.h.get('settings/recipe_revision').version,1);assert.equal(f.api.inventoryDeletionBusy,false);assert.equal(f.confirmations.length,1);f.unchanged();
});
test('actual linked-last-item refusal occurs before confirmation and clears the busy state',async()=>{
 const f=fixture();f.h.docs.delete('inventory/retained');const {bulk}=f.setup();await bulk();assert.ok(f.h.get('inventory/duplicate'));assert.equal(f.confirmations.length,0);assert.equal(f.api.inventoryDeletionBusy,false);assert.equal(f.h.get('settings/recipe_revision'),undefined);assert.ok(f.notices.some(value=>/not deleted|still used|retained|duplicate/i.test(value)));
});
test('actual bulk button shows checking, confirmation and save progress while duplicate taps share one operation',async()=>{
 const f=fixture(),{bulk}=f.setup(),read=f.api.getDocsFromServer,transaction=f.api.runTransaction;let release,checks=0,confirms=0,saves=0;
 const gate=new Promise(resolve=>{release=resolve;});f.api.getDocsFromServer=async query=>{if(query.table==='hq_managers'&&checks++===0)await gate;return read(query);};
 f.api.ManagerUI.confirm=async()=>{confirms++;assert.equal(f.deleteButton.disabled,true);assert.equal(f.deleteButton.textContent,'Confirm selected items');return true;};
 f.api.runTransaction=async(...args)=>{saves++;assert.equal(f.deleteButton.textContent,'Deleting selected items…');return transaction(...args);};
 const first=bulk();assert.equal(f.deleteButton.disabled,true);assert.equal(f.deleteButton.textContent,'Checking selected items…');await bulk();release();await first;
 assert.equal(confirms,1);assert.equal(saves,1);assert.equal(f.deleteButton.disabled,false);assert.equal(f.deleteButton.textContent,'Delete');assert.equal(f.h.get('settings/recipe_revision').version,1);f.unchanged();
});
test('actual bulk network check failure restores its button without confirmation or deleting anything',async()=>{
 const f=fixture(),{bulk}=f.setup(),before=clone([...f.h.docs]);f.api.getDocsFromServer=async()=>{throw Error('Fictional network failure');};await bulk();
 assert.deepEqual([...f.h.docs],before);assert.equal(f.confirmations.length,0);assert.equal(f.api.inventoryDeletionBusy,false);assert.equal(f.deleteButton.disabled,false);assert.equal(f.deleteButton.textContent,'Delete');assert.match(f.notices.at(-1),/Fictional network failure/);
});
for(const stage of ['initial account query','initial operation marker']){
 test('the complete preflight deadline also covers a stalled '+stage+' and later read completion writes nothing',async()=>{
  const f=fixture(),before=clone([...f.h.docs]),docs=f.api.getDocsFromServer,doc=f.api.getDocFromServer;let release;
  const gate=new Promise(resolve=>{release=resolve;});
  if(stage==='initial account query')f.api.getDocsFromServer=async query=>{await gate;return docs(query);};
  else f.api.getDocFromServer=async ref=>{if(ref.path==='settings/recipe_operation_preflight-hung')await gate;return doc(ref);};
  await assert.rejects(inventoryDeletionPreflight(f.api,['duplicate'],{operationId:'preflight-hung',intent:{ids:['duplicate']},timeoutMs:5}),/took too long|retry Delete/i);
  assert.deepEqual([...f.h.docs],before);release();for(let i=0;i<20;i++)await Promise.resolve();assert.deepEqual([...f.h.docs],before);
  f.api.getDocsFromServer=docs;f.api.getDocFromServer=doc;const result=await inventoryDeletionPreflight(f.api,['duplicate'],{operationId:'preflight-hung',timeoutMs:100});assert.equal(result.alreadyApplied,false);assert.deepEqual(result.state.deletionRetainedIds,['retained']);
 });
}
for(const mode of ['single','bulk']){
 test('actual '+mode+' Delete reports a committed removal truthfully if cache invalidation fails',async()=>{
  const f=fixture(),routes=f.setup(),remove=()=>mode==='single'?routes.single('duplicate','Fork'):routes.bulk();f.api.invalidateCache=()=>{throw Error('Fictional cache issue');};
  await remove();assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal(f.h.get('settings/recipe_revision').version,1);assert.match(f.notices.at(-1),/was deleted|were deleted/);assert.doesNotMatch(f.notices.at(-1),/not deleted|not confirmed/);
  await remove();assert.equal(f.h.get('settings/recipe_revision').version,1);assert.equal(f.api.inventoryDeletionBusy,false);assert.equal(f.deleteButton.disabled,false);f.unchanged();
 });
 test('actual '+mode+' Delete retains its committed result when the refreshed list cannot load',async()=>{
  const f=fixture(),routes=f.setup();f.api.loadInventoryData=async()=>{throw Error('Fictional refresh issue');};if(mode==='single')await routes.single('duplicate','Fork');else await routes.bulk();
  assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal(f.h.get('settings/recipe_revision').version,1);assert.match(f.notices.at(-1),/was deleted|were deleted/);assert.match(f.notices.at(-1),/Refresh Live Stocks/);assert.doesNotMatch(f.notices.at(-1),/not deleted|not confirmed/);assert.equal(f.api.inventoryDeletionBusy,false);f.unchanged();
 });
}
test('actual bulk Delete tolerates a removed master checkbox after commit without reporting a false failure',async()=>{
 const f=fixture(),{bulk}=f.setup(),get=f.document.getElementById;f.document.getElementById=id=>id==='selectAllInv'?null:get(id);await bulk();
 assert.equal(f.h.get('inventory/duplicate'),undefined);assert.equal(f.h.get('settings/recipe_revision').version,1);assert.ok(f.notices.some(value=>/Successfully deleted/.test(value)));assert.ok(!f.notices.some(value=>/not deleted|not confirmed/.test(value)));assert.equal(f.api.inventoryDeletionBusy,false);f.unchanged();
});
