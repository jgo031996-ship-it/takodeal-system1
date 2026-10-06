import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {loadRecipeState,createRecipeBatch,operationFor,recipePlan,saveRecipePlan,readRecipeRevision,recipeOperationApplied,loadInventoryDeletionState,inventoryDeletionPlan} from '../takodeal-manager/recipe-changes.js';
import {recipeProblems,ingredientUses} from '../takodeal-manager/recipe-integrity.js';
const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function fixture() {
    const h=firestoreHarness(),notices=[],elements=new Map();
    h.put('hq_managers/access',{email:'qa@example.test',pin:'1234',role:'Manager',permissions:['menu','inventory']});
    const api=h.api;api.auth={currentUser:{uid:'qa',email:'qa@example.test'}};api.sessionUser={uid:'qa',email:'qa@example.test',permissions:['menu','inventory'],cashierName:'QA user'};
    api.getDocFromServer=async ref=>({id:ref.id,ref,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
    const getDocs=api.getDocsFromServer;api.getDocsFromServer=async q=>{const result=await getDocs(q);result.forEach=fn=>result.docs.forEach(fn);return result;};
    let next=0;const doc=api.doc;api.doc=(...args)=>args.length===1?h.ref(args[0].table,'new-'+(++next)):doc(...args);
    api.ManagerUI={notify:text=>notices.push(text),confirm:async()=>true};api.invalidateCache=()=>{};api.loadInventoryData=async()=>{};api.loadMenuEditor=async()=>{};
    const el=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},disabled:false,checked:false,files:[],classList:{contains:()=>false}});return elements.get(id);};
    const ctx={window:api,document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[]},console:{error(){}},Swal:{fire(){}},setTimeout:()=>{},
        loadRecipeState,createRecipeBatch,operationFor,recipePlan,saveRecipePlan,readRecipeRevision,recipeOperationApplied,loadInventoryDeletionState,inventoryDeletionPlan,recipeProblems,ingredientUses};
    const route=name=>{const start=main.indexOf('window.'+name+' ='),end=main.indexOf('\n};',start)+3;assert.ok(start>=0 && end>start);vm.runInNewContext(main.slice(start,end),ctx);return api[name];};
    h.put('inventory/maa',{name:'Old Sauce',branch:'Maa',uom:'gram',baseUom:'gram',currentStock:500,maintainingStock:70});
    h.put('inventory/office',{name:'Old Sauce',branch:'Main Office',uom:'gram',baseUom:'gram',currentStock:800,maintainingStock:90});
    h.put('menu/small',{name:'Takoyaki 6 Pcs',category:'Takoyaki',price:100,image:'keep.jpg'});
    h.put('bom/small',{menuItem:'Takoyaki 6 Pcs',ingredientName:'Old Sauce',qty:20});
    const values={editInvId:'maa',editInvBranch:'Maa',editInvCat:'Ingredients',editInvName:'New Sauce',editInvPurchUom:'pack',editInvBaseUom:'gram',editInvPurchCost:'10',editInvConversion:'100',editInvLowStock:'1',editInvHqLowStock:'2',editInvOldQty:'500',editInvNewQtyPurch:'',editInvNewQtyBase:'',editInvNote:'',editInvCycle:'Monthly',editInvMaintainPurch:'',editInvMaintainBase:'70'};
    for(const [id,value] of Object.entries(values))el(id).value=value;
    return {h,api,el,notices,route,document:ctx.document};
}

test('actual ingredient rename updates BOM and all branch metadata atomically while preserving stock and par levels',async()=>{
    const {h,route,notices}=fixture();h.put('global_addons/extra',{name:'Extra Sauce',linkedIngredient:'Old Sauce',deductQty:5});
    await route('saveInventoryEdit')();assert.equal(h.get('bom/small').ingredientName,'New Sauce');assert.equal(h.get('inventory/maa').currentStock,500);assert.equal(h.get('inventory/office').currentStock,800);
    assert.equal(h.get('inventory/office').maintainingStock,90);assert.equal(h.get('global_addons/extra').linkedIngredient,'New Sauce');assert.equal(h.get('settings/recipe_revision').version,1);assert.equal(notices.length,0);
});

test('actual ingredient rename rejects same-branch destination collisions and embedded add-on/flavor/legacy links',async()=>{
    const cases=[f=>f.h.put('inventory/collision',{name:'New Sauce',branch:'Maa',uom:'gram'}),...['addons','mixMatchConfig','recipe'].map(field=>f=>f.h.put('menu/small',{...f.h.get('menu/small'),[field]:[{linkedIngredient:'Old Sauce',item:'Old Sauce'}]})),f=>f.h.put('settings/global_mixmatch',{mappings:[{linkedIngredient:'Old Sauce',flavor:'Sauce'}]})];
    for(const change of cases){const f=fixture();change(f);await f.route('saveInventoryEdit')();assert.equal(f.h.get('bom/small').ingredientName,'Old Sauce');assert.equal(f.h.get('settings/recipe_revision'),undefined);assert.match(f.notices[0],/duplicate stock|before renaming/i);assert.equal(f.el('btnSaveInvEdit').disabled,false);}
});

test('actual metadata-only rename preserves a sale stock movement during preparation instead of restoring the old count',async()=>{
    const f=fixture(),read=f.api.getDocsFromServer;let injected=false;f.api.getDocsFromServer=async q=>{if(q.table==='inventory' && q.filters?.some(filter=>filter.value==='Old Sauce') && !injected){injected=true;f.h.put('inventory/maa',{...f.h.get('inventory/maa'),currentStock:480});}return read(q);};
    await f.route('saveInventoryEdit')();assert.equal(f.h.get('inventory/maa').name,'New Sauce');assert.equal(f.h.get('inventory/maa').currentStock,480);assert.equal(f.h.get('settings/recipe_revision').version,1);
});

test('actual manual stock adjustment retains the original count baseline through the sync query and rejects a concurrent sale',async()=>{
    const f=fixture();f.el('editInvNewQtyBase').value='450';f.el('editInvNote').value='Verified count';const read=f.api.getDocsFromServer;let injected=false;
    f.api.getDocsFromServer=async q=>{if(q.table==='inventory' && q.filters?.some(filter=>filter.value==='Old Sauce') && !injected){injected=true;f.h.put('inventory/maa',{...f.h.get('inventory/maa'),currentStock:480});}return read(q);};
    await f.route('saveInventoryEdit')();assert.equal(f.h.get('inventory/maa').currentStock,480);assert.equal(f.h.get('inventory/maa').name,'Old Sauce');assert.match(f.notices[0],/affected item changed/);assert.equal(f.h.get('settings/recipe_revision'),undefined);assert.ok(![...f.h.docs.keys()].some(path=>path.startsWith('stock_logs/')));
});

test('actual manual count lost acknowledgment retry recovers the prior save without another log or count rewrite',async()=>{
    const f=fixture();f.el('editInvName').value='Old Sauce';f.el('editInvNewQtyBase').value='450';f.el('editInvNote').value='Verified count';f.h.loseNextAck();const save=f.route('saveInventoryEdit');await save();assert.equal(f.h.get('inventory/maa').currentStock,450);await save();
    assert.equal(f.h.get('settings/recipe_revision').version,1);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('stock_logs/')).length,1);assert.match(f.notices.at(-1),/already saved/);
});

test('actual product deletion remains atomic and a lost acknowledgment retry does not create another recipe revision',async()=>{
    const f=fixture();f.h.put('bom/second',{menuItem:'Takoyaki 6 Pcs',ingredientName:'Other',qty:10});f.h.put('menu/keep',{name:'Other product'});f.h.put('transactions/keep',{cart:[{name:'Takoyaki 6 Pcs',qty:1}],inventoryMovements:[{ingredientName:'Old Sauce',quantity:20}]});
    const history=structuredClone(f.h.get('transactions/keep')),remove=f.route('deleteMenuAndBom');f.h.loseNextAck();await remove('small','Takoyaki 6 Pcs');assert.equal(f.h.get('menu/small'),undefined);await remove('small','Takoyaki 6 Pcs');
    assert.equal(f.h.get('bom/second'),undefined);assert.equal(f.h.get('settings/recipe_revision').version,1);assert.deepEqual(f.h.get('transactions/keep'),history);assert.ok(f.h.get('menu/keep'));
});

test('actual photo upload failure unlocks save and creates no recipe or stock writes',async()=>{
    const f=fixture();f.el('editInvPhoto').files=[{name:'test.png'}];f.api.ref=()=>({});f.api.uploadBytes=async()=>{throw Error('Photo upload failed');};await f.route('saveInventoryEdit')();assert.equal(f.el('btnSaveInvEdit').disabled,false);assert.match(f.notices[0],/Photo upload failed/);assert.equal(f.h.get('settings/recipe_revision'),undefined);
});

test('actual advanced product editor uses the guarded adapter, preserves images and rejects a stale open recipe',async()=>{
    const f=fixture();f.api.advRecipeState=await loadRecipeState(f.api);f.api.currentAdvRecipe=[{docId:'small',ingredientName:'Old Sauce',qty:25}];f.api.deletedAdvRecipes=[];
    for(const [id,value] of Object.entries({advProdId:'small',advProdName:'Takoyaki 6 Pcs',advProdCat:'Takoyaki',advProdPrice:'120',advProdGrabPrice:'',advProdFpPrice:'',advProdMixMatch:''}))f.el(id).value=value;
    const save=f.route('saveAdvancedProduct');await save();assert.equal(f.h.get('bom/small').qty,25);assert.equal(f.h.get('menu/small').image,'keep.jpg');assert.equal(f.h.get('menu/small').price,120);assert.equal(f.h.get('settings/recipe_revision').version,1);
    f.api.currentAdvRecipe[0].qty=30;await save();assert.equal(f.h.get('bom/small').qty,25);assert.match(f.notices.at(-1),/after this preview/);
});

test('actual new product lost acknowledgment retry reuses exact menu/BOM IDs with one revision',async()=>{
    const f=fixture();f.api.advRecipeState=await loadRecipeState(f.api);f.api.currentAdvRecipe=[{ingredientName:'Old Sauce',qty:20,isNew:true}];f.api.deletedAdvRecipes=[];
    for(const [id,value] of Object.entries({advProdId:'',advProdName:'New Takoyaki',advProdCat:'Takoyaki',advProdPrice:'120',advProdGrabPrice:'',advProdFpPrice:'',advProdMixMatch:''}))f.el(id).value=value;
    const save=f.route('saveAdvancedProduct');f.h.loseNextAck();await save();await save();assert.equal(f.h.get('settings/recipe_revision').version,1);assert.equal([...f.h.docs.values()].filter(row=>row.name==='New Takoyaki').length,1);assert.equal([...f.h.docs.values()].filter(row=>row.menuItem==='New Takoyaki').length,1);assert.ok(f.el('advProdId').value);
});

test('actual editor refuses a stale selected product name and clears the prior recipe and save baseline',async()=>{
    const f=fixture();f.api.currentAdvRecipe=[{docId:'unrelated',ingredientName:'Other Sauce',qty:200}];f.api.preloadInventoryForAddons=async()=>{};
    await f.route('openBomEditor')('Old menu name','small');assert.equal(f.api.advRecipeState,null);assert.equal(f.api.currentAdvRecipe.length,0);assert.match(f.notices[0],/changed or its name is duplicated/);
});

test('actual single unused-stock deletion advances the recipe revision and recovers a lost acknowledgment once',async()=>{
    const f=fixture();f.h.put('inventory/unused',{name:'Old Packaging',branch:'Maa',uom:'piece',currentStock:90});f.h.put('transactions/old',{inventoryMovements:[{ingredientName:'Old Packaging',quantity:1,inventoryId:'unused'}]});const history=structuredClone(f.h.get('transactions/old'));
    f.route('checkInventoryDeletion');const remove=f.route('deleteInventoryItem');f.h.loseNextAck();await remove('unused','Old Packaging');assert.equal(f.h.get('inventory/unused'),undefined);await remove('unused','Old Packaging');
    assert.equal(f.h.get('settings/recipe_revision').version,1);assert.deepEqual(f.h.get('transactions/old'),history);assert.equal(f.api.inventoryDeletionBusy,false);
});

test('actual bulk unused-stock deletion is all-or-nothing through failure, lost acknowledgment and retry',async()=>{
    const f=fixture();for(const id of ['unused-one','unused-two'])f.h.put('inventory/'+id,{name:id,branch:'Maa',uom:'piece',currentStock:90});
    f.document.querySelectorAll=()=>[{value:'unused-two'},{value:'unused-one'}];f.route('checkInventoryDeletion');const remove=f.route('bulkDeleteInventory');
    f.h.failNextCommit();await remove();assert.ok(f.h.get('inventory/unused-one'));assert.ok(f.h.get('inventory/unused-two'));assert.equal(f.h.get('settings/recipe_revision'),undefined);
    f.h.loseNextAck();await remove();assert.equal(f.h.get('inventory/unused-one'),undefined);assert.equal(f.h.get('inventory/unused-two'),undefined);await remove();assert.equal(f.h.get('settings/recipe_revision').version,1);assert.equal(f.api.inventoryDeletionBusy,false);
});

test('actual unused-stock deletion cannot use its pre-confirmation check after a new recipe begins referencing it',async()=>{
    const f=fixture();f.h.put('inventory/unused',{name:'New Packaging',branch:'Maa',uom:'piece',currentStock:90});f.route('checkInventoryDeletion');
    f.api.ManagerUI.confirm=async()=>{const state=await loadRecipeState(f.api);await saveRecipePlan(f.api,recipePlan(state,[{table:'bom',id:'new-link',mode:'set',data:{menuItem:'Takoyaki 6 Pcs',ingredientName:'New Packaging',qty:1}}]),{operationId:'new-reference'});return true;};
    await f.route('deleteInventoryItem')('unused','New Packaging');assert.ok(f.h.get('inventory/unused'));assert.equal(f.h.get('bom/new-link').ingredientName,'New Packaging');assert.match(f.notices.at(-1),/after this preview/);assert.equal(f.h.get('settings/recipe_revision').version,1);
});

test('actual unused-stock deletion guards existing dependency documents even when a legacy edit does not advance the revision',async()=>{
    const f=fixture();f.h.put('inventory/unused',{name:'New Packaging',branch:'Maa',uom:'piece',currentStock:90});f.route('checkInventoryDeletion');
    f.api.ManagerUI.confirm=async()=>{f.h.put('bom/small',{...f.h.get('bom/small'),ingredientName:'New Packaging'});return true;};
    await f.route('deleteInventoryItem')('unused','New Packaging');assert.ok(f.h.get('inventory/unused'));assert.match(f.notices.at(-1),/affected item changed/);assert.equal(f.h.get('settings/recipe_revision'),undefined);
});

test('actual linked-stock deletion is refused before confirmation and fresh revoked inventory access prevents deletion',async()=>{
    const f=fixture();let confirmed=0;f.api.ManagerUI.confirm=async()=>{confirmed++;return true;};f.route('checkInventoryDeletion');await f.route('deleteInventoryItem')('maa','Old Sauce');assert.equal(confirmed,0);assert.match(f.notices.at(-1),/still used/);
    f.h.put('inventory/unused',{name:'Unused',branch:'Maa',uom:'piece',currentStock:90});f.api.ManagerUI.confirm=async()=>{f.h.put('hq_managers/access',{...f.h.get('hq_managers/access'),permissions:['menu']});return true;};await f.api.deleteInventoryItem('unused','Unused');assert.ok(f.h.get('inventory/unused'));assert.match(f.notices.at(-1),/permissions/);assert.equal(f.h.get('settings/recipe_revision'),undefined);
});

test('dependency loading holds a recipe revision change during its server reads',async()=>{
    const f=fixture();f.h.put('inventory/unused',{name:'Unused',branch:'Maa',uom:'piece',currentStock:90});const read=f.api.getDocsFromServer;let changed=false;
    f.api.getDocsFromServer=async q=>{const result=await read(q);if(q.table==='bom' && !changed){changed=true;f.h.put('settings/recipe_revision',{version:1,revisionId:'concurrent-editor'});}return result;};
    await assert.rejects(loadInventoryDeletionState(f.api,['unused']),/changed while checking deletion/);assert.ok(f.h.get('inventory/unused'));
});

test('the menu permission scope cannot be used to write inventory, and inventory cannot write menu',async()=>{
    const f=fixture(),state=await loadRecipeState(f.api);await assert.rejects(saveRecipePlan(f.api,recipePlan(state,[{table:'inventory',id:'maa',mode:'update',data:{currentStock:1}}]),{operationId:'wrong-scope'}),/permission scope/);
    await assert.rejects(saveRecipePlan(f.api,recipePlan(state,[{table:'menu',id:'small',mode:'delete'}]),{operationId:'wrong-scope-two',route:'inventory'}),/permission scope/);assert.equal(f.h.get('inventory/maa').currentStock,500);
});
