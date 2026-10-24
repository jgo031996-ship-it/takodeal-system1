import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createMenuOptionsService} from '../takodeal-manager/menu-options-service.js';
import {normalizeGlobalAddon,previewAddonApply,addonUsage,normalizeBundleDraft,addonAppliesToProduct,normalizeGlobalMixMatch} from '../takodeal-manager/menu-options-model.js';
import {recipePlan,saveRecipePlan,loadRecipeState} from '../takodeal-manager/recipe-changes.js';
const email='jgo031996@gmail.com';
const addon={name:'Cheese',price:10,linkedIngredient:'Sauce',deductQty:2,category:['Takoyaki']};
function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid:'sample-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}};
 h.api.sessionUser={uid:'sample-owner',email,role:'Owner',permissions:['all'],allowedBranches:['All']};
 h.put('hq_managers/owner',{email,role:'Owner',pin:'SAMPLE-ONLY',active:true,permissions:['all'],assignedBranch:'All'});
 h.put('inventory/hq-sauce',{name:'Sauce',branch:'Main Office',uom:'gram',baseUom:'gram',currentStock:500,baseCost:1});
 h.put('inventory/store-sauce',{name:'Sauce',branch:'Sample Branch',uom:'gram',currentStock:400});
 h.put('global_addons/cheese',addon);
 h.put('menu/tako',{name:'Takoyaki',category:'Takoyaki',price:100,grabPrice:120,foodpandaPrice:130,image:'keep.jpg',addons:[{name:'Cheese',price:10,linkedIngredient:'Sauce',deductQty:2},{name:'Unrelated extra',price:25,linkedIngredient:'',deductQty:0}]});
 h.put('menu/shake',{name:'Mango shake',category:'Drinks',price:90,grabPrice:100,foodpandaPrice:110});
 h.put('bom/recipe',{menuItem:'Takoyaki',ingredientName:'Sauce',qty:20});
 h.put('transactions/history',{receiptId:'SAMPLE-RECEIPT',cart:[{name:'Takoyaki',price:100,qty:1,addons:{Cheese:{price:10,qty:1}}}],inventoryMovements:[{inventoryId:'store-sauce',quantity:22}]});
 h.api.getDocFromServer=async ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 h.service=createMenuOptionsService(h.api);return h;
}
const options=(state,operationId)=>({state,operationId});
const commercialBefore=h=>structuredClone({tako:h.get('menu/tako'),shake:h.get('menu/shake'),bom:h.get('bom/recipe'),hq:h.get('inventory/hq-sauce'),store:h.get('inventory/store-sauce'),receipt:h.get('transactions/history')});
const assertNoCommercialChanges=(h,before)=>assert.deepEqual(commercialBefore(h),before);

test('load uses current server state, exposes saved IDs and creates no records',async()=>{
 const h=fixture(),before=structuredClone([...h.docs]),state=await h.service.load();assert.equal(state.addons[0].id,'cheese');assert.equal(state.menu.length,2);assert.deepEqual(state.drafts,[]);assert.ok(Object.isFrozen(state));assert.deepEqual([...h.docs],before);
});
test('only the verified matching Owner Google session can load or mutate',async()=>{
 for(const scenario of ['other-owner','unverified','provider','uid','signed-out']){
  const h=fixture();if(scenario==='other-owner'){h.api.auth.currentUser.email='other@example.test';h.api.sessionUser.email='other@example.test';}
  if(scenario==='unverified')h.api.auth.currentUser.emailVerified=false;
  if(scenario==='provider')h.api.auth.currentUser.providerData=[{providerId:'password'}];
  if(scenario==='uid')h.api.sessionUser.uid='other';
  if(scenario==='signed-out')h.api.sessionUser=null;
  await assert.rejects(h.service.load(),/verified Owner Google/);assert.equal(h.get('settings/recipe_revision'),undefined);
 }
});
test('a blocked saved Owner or revoked protected grant cannot edit',async()=>{
 for(const kind of ['blocked','inactive','grant']){const h=fixture(),state=await h.service.load();if(kind==='blocked')h.put('hq_managers/owner',{...h.get('hq_managers/owner'),blocked:true});if(kind==='inactive')h.put('hq_managers/owner',{...h.get('hq_managers/owner'),active:false});if(kind==='grant')h.put('hq_email_access/'+email,{active:false});await assert.rejects(h.service.saveAddon('new',{...addon,name:'New'},options(state,'blocked-'+kind)),/blocked|inactive|revoked/);assert.equal(h.get('global_addons/new'),undefined);}
});
test('invalid price, deduction quantity and missing or ambiguous ingredient are never coerced to zero',async()=>{
 const h=fixture(),state=await h.service.load();
 for(const value of ['',-1,'12oops','Infinity',NaN,true,1.005])assert.throws(()=>normalizeGlobalAddon({...addon,price:value},state,{id:'cheese'}),/price|number|decimal/i);
 for(const value of [-1,'NaN','2foo',true])assert.throws(()=>normalizeGlobalAddon({...addon,deductQty:value},state,{id:'cheese'}),/number/i);
 assert.throws(()=>normalizeGlobalAddon({...addon,linkedIngredient:'Gone'},state,{id:'cheese'}),/missing or duplicated/);
 assert.throws(()=>normalizeGlobalAddon({...addon,linkedIngredient:'',deductQty:2},state,{id:'cheese'}),/zero/);
 assert.throws(()=>normalizeGlobalAddon({...addon,deductQty:0},state,{id:'cheese'}),/positive/);
 h.put('inventory/duplicate',{name:'Sauce',branch:'Main Office',uom:'gram'});const duplicate=await h.service.load();assert.throws(()=>normalizeGlobalAddon(addon,duplicate,{id:'cheese'}),/duplicated/);
});
test('category validation is explicit and matching never guesses from a product name substring',async()=>{
 const h=fixture(),state=await h.service.load();for(const category of [[],['Unknown'],['All','Drinks']])assert.throws(()=>normalizeGlobalAddon({...addon,category},state,{id:'cheese'}),/categories/);
 assert.equal(addonAppliesToProduct({category:['Drinks']},{name:'Drinks combo',category:'Takoyaki'}),false);
 assert.equal(addonAppliesToProduct({category:['Drinks']},{name:'Mango shake',category:'Drinks'}),true);
 assert.equal(addonAppliesToProduct({category:['All']},{name:'Any',category:'Takoyaki'}),true);
});
test('saving a global definition changes no product prices, stock, recipes or historical receipts',async()=>{
 const h=fixture(),state=await h.service.load(),before=commercialBefore(h);await h.service.saveAddon('cheese',{...addon,price:15},options(state,'edit-global'));
 assert.equal(h.get('global_addons/cheese').price,15);assert.equal(h.get('settings/recipe_revision').version,1);assertNoCommercialChanges(h,before);
});
test('new definitions use stable caller IDs and concurrent/lost-ACK retries save once',async()=>{
 const h=fixture(),state=await h.service.load(),input={name:'No-stock service upgrade',price:0,linkedIngredient:'',deductQty:0,category:['Drinks']};
 h.loseNextAck();await assert.rejects(h.service.saveAddon('stable-id',input,options(state,'stable-operation')),/Connection lost/);
 const results=await Promise.all(Array.from({length:4},()=>h.service.saveAddon('stable-id',input,options(state,'stable-operation'))));assert.ok(results.every(row=>row.repeated));assert.equal(h.get('settings/recipe_revision').version,1);assert.equal(h.get('global_addons/stable-id').revision,1);assert.equal([...h.docs.keys()].filter(path=>path.startsWith('global_addons/')).length,2);
 const fresh=await h.service.load();assert.equal((await h.service.saveAddon('stable-id',input,options(fresh,'stable-operation'))).repeated,true);
 await assert.rejects(h.service.saveAddon('stable-id',{...input,price:1},options(fresh,'stable-operation')),/different edits/);
});
test('duplicate global names are rejected even when case or whitespace differ',async()=>{
 const h=fixture(),state=await h.service.load();await assert.rejects(h.service.saveAddon('duplicate',{...addon,name:' cheese '},options(state,'duplicate')),/already uses this name/);assert.equal(h.get('global_addons/duplicate'),undefined);
});
test('legacy adoption is exact and applying preserves all unrelated options and every channel price',async()=>{
 const h=fixture(),state=await h.service.load(),before=commercialBefore(h),preview=previewAddonApply(state,'cheese',{productIds:['tako','shake']});assert.equal(preview.canApply,true);assert.deepEqual(preview.changes.map(row=>row.action),['adopt','attach']);assert.equal(preview.conflicts.length,0);
 await h.service.applyAddonToProducts('cheese',{productIds:['tako','shake']},options(state,'apply-two'));const product=h.get('menu/tako');
 assert.equal(product.addons[0].globalAddonId,'cheese');assert.deepEqual(product.addons[1],before.tako.addons[1]);for(const field of ['price','grabPrice','foodpandaPrice','image'])assert.equal(product[field],before.tako[field]);
 assert.deepEqual(h.get('inventory/hq-sauce'),before.hq);assert.deepEqual(h.get('inventory/store-sauce'),before.store);assert.deepEqual(h.get('bom/recipe'),before.bom);assert.deepEqual(h.get('transactions/history'),before.receipt);
});
test('a saved global price edit can update only a provable legacy definition, retaining its rename history',async()=>{
 const h=fixture();let state=await h.service.load();await h.service.saveAddon('cheese',{...addon,name:'Cheese upgrade',price:15},options(state,'price-and-name'));state=await h.service.load();
 assert.equal(addonUsage(state,'cheese').length,1);assert.equal(addonUsage(state,'cheese')[0].matchedBy,'legacy name');const preview=previewAddonApply(state,'cheese',{productIds:['tako']});assert.equal(preview.canApply,true);
 await h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(state,'adopt-original'));assert.equal(h.get('menu/tako').addons[0].name,'Cheese upgrade');assert.equal(h.get('menu/tako').addons[0].price,15);
});
test('product-specific legacy overrides and ambiguous choice names block the entire apply',async()=>{
 for(const kind of ['price','ingredient','quantity','duplicate','other-link']){
  const h=fixture(),product=h.get('menu/tako');if(kind==='price')product.addons[0].price=99;if(kind==='ingredient')product.addons[0].linkedIngredient='Other';if(kind==='quantity')product.addons[0].deductQty=99;if(kind==='duplicate')product.addons.push({...product.addons[0]});if(kind==='other-link')product.addons[0].globalAddonId='other-source';h.put('menu/tako',product);
  const state=await h.service.load(),before=commercialBefore(h),preview=previewAddonApply(state,'cheese',{productIds:['tako','shake']});assert.equal(preview.canApply,false);assert.equal(preview.conflicts.length,1,kind);await assert.rejects(h.service.applyAddonToProducts('cheese',{productIds:['tako','shake']},options(state,'conflict-'+kind)),/Review|review/);assertNoCommercialChanges(h,before);
 }
});
test('explicit source IDs permit updates and remove stale stock aliases without losing unrelated metadata',async()=>{
 const h=fixture(),p=h.get('menu/tako');p.addons[0]={...p.addons[0],globalAddonId:'cheese',ingredient:'Old fallback',qty:99,displayHint:'Keep this note'};h.put('menu/tako',p);let state=await h.service.load();await h.service.saveAddon('cheese',{...addon,linkedIngredient:'',deductQty:0},options(state,'no-stock-link'));state=await h.service.load();
 await h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(state,'clear-aliases'));const row=h.get('menu/tako').addons[0];assert.equal(row.linkedIngredient,'');assert.equal(row.deductQty,0);assert.equal(row.ingredient,undefined);assert.equal(row.qty,undefined);assert.equal(row.displayHint,'Keep this note');
});
test('apply lost acknowledgments recover against both the original and reloaded state without another revision',async()=>{
 const h=fixture(),state=await h.service.load();h.loseNextAck();await assert.rejects(h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(state,'apply-retry')),/Connection lost/);
 assert.equal((await h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(state,'apply-retry'))).repeated,true);
 const current=await h.service.load();assert.equal((await h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(current,'apply-retry'))).repeated,true);assert.equal(h.get('settings/recipe_revision').version,1);
});
test('failed saves and failed multi-product applies are all-or-nothing',async()=>{
 for(const kind of ['save','apply']){
  const h=fixture(),state=await h.service.load(),before=structuredClone([...h.docs]);h.failNextCommit();
  const job=kind==='save'?h.service.saveAddon('new',{...addon,name:'New'},options(state,'fail-save')):h.service.applyAddonToProducts('cheese',{productIds:['tako','shake']},options(state,'fail-apply'));await assert.rejects(job,/Commit rejected/);assert.deepEqual([...h.docs],before);
 }
});
test('stale product/add-on records and concurrent recipe revisions cannot overwrite reviewed data',async()=>{
 for(const kind of ['product','addon','revision']){
  const h=fixture(),state=await h.service.load();if(kind==='product')h.put('menu/tako',{...h.get('menu/tako'),price:999});if(kind==='addon')h.put('global_addons/cheese',{...addon,price:99});if(kind==='revision')h.put('settings/recipe_revision',{version:1,revisionId:'other-editor'});
  const before=structuredClone([...h.docs]);await assert.rejects(h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(state,'stale-'+kind)),/after this preview/);assert.deepEqual([...h.docs],before);
 }
});
test('normal stock-count changes do not get replaced or needlessly invalidate an option edit',async()=>{
 const h=fixture(),state=await h.service.load();h.put('inventory/hq-sauce',{...h.get('inventory/hq-sauce'),currentStock:400});await h.service.saveAddon('cheese',{...addon,price:15},options(state,'stock-safe'));assert.equal(h.get('inventory/hq-sauce').currentStock,400);
 const fresh=await h.service.load();h.put('inventory/hq-sauce',{...h.get('inventory/hq-sauce'),uom:'ml'});await assert.rejects(h.service.saveAddon('cheese',{...addon,price:16},options(fresh,'unit-stale')),/affected item changed/);
});
test('a cooperating normal recipe edit invalidates an open add-on preview',async()=>{
 const h=fixture(),state=await h.service.load(),recipeState=await loadRecipeState(h.api);await saveRecipePlan(h.api,recipePlan(recipeState,[{table:'bom',id:'recipe',mode:'update',data:{qty:30}}]),{operationId:'normal-recipe'});
 await assert.rejects(h.service.saveAddon('cheese',{...addon,price:11},options(state,'stale-recipe')),/after this preview/);assert.equal(h.get('global_addons/cheese').price,10);
});
test('permission revocation during the transaction and same-account re-login fail closed',async()=>{
 const h=fixture(),state=await h.service.load(),run=h.api.runTransaction;h.api.runTransaction=async(db,callback)=>{h.put('hq_email_access/'+email,{active:false});return run(db,callback);};
 await assert.rejects(h.service.saveAddon('new',{...addon,name:'New'},options(state,'tx-revocation')),/revoked/);assert.equal(h.get('global_addons/new'),undefined);
 const other=fixture(),old=await other.service.load();other.api.sessionUser={...other.api.sessionUser};await assert.rejects(other.service.saveAddon('new',{...addon,name:'New'},options(old,'same-login')),/account changed/);
});
test('a caller cannot forge or mutate the loaded state or ignore its current-view guard',async()=>{
 const h=fixture(),state=await h.service.load();assert.throws(()=>{state.documents.menu.tako.price=1;},TypeError);
 await assert.rejects(h.service.saveAddon('new',{...addon,name:'New'},options({...state},'forged-state')),/Reload the saved menu state/);
 await assert.rejects(h.service.saveAddon('new',{...addon,name:'New'},{state,operationId:'view-changed',assertCurrent:()=>{throw Error('View changed');}}),/View changed/);assert.equal(h.get('global_addons/new'),undefined);
});
test('used add-ons cannot be cascade deleted and unused deletion never rewrites receipts or menu',async()=>{
 const h=fixture(),state=await h.service.load(),before=commercialBefore(h);await assert.rejects(h.service.deleteAddon('cheese',options(state,'used-delete')),/still used/);
 await h.service.saveAddon('unused',{name:'Unused',price:5,linkedIngredient:'',deductQty:0,category:['All']},options(state,'create-unused'));const ready=await h.service.load();h.loseNextAck();await assert.rejects(h.service.deleteAddon('unused',options(ready,'delete-unused')),/Connection lost/);assert.equal((await h.service.deleteAddon('unused',options(ready,'delete-unused'))).repeated,true);const fresh=await h.service.load();assert.equal((await h.service.deleteAddon('unused',options(fresh,'delete-unused'))).repeated,true);assert.equal(h.get('global_addons/unused'),undefined);assertNoCommercialChanges(h,before);
});
test('a new legacy product reference after deletion preview prevents deleting the global source',async()=>{
 const h=fixture();h.put('global_addons/unused',{name:'Unused',price:0,linkedIngredient:'',deductQty:0,category:['All']});const state=await h.service.load();h.put('menu/shake',{...h.get('menu/shake'),addons:[{name:'Unused',price:0,linkedIngredient:'',deductQty:0}]});await assert.rejects(h.service.deleteAddon('unused',options(state,'late-use')),/affected item changed/);assert.ok(h.get('global_addons/unused'));
});
const bundle={name:'Takoyaki + drink plan',components:[{menuId:'tako',qty:1},{menuId:'shake',qty:1}],basePrice:175,grabPrice:195,foodpandaPrice:200,notes:'Future plan only'};
test('bundle plans validate product identities and optional prices without inventing a selling price',async()=>{
 const h=fixture(),state=await h.service.load();const draft=normalizeBundleDraft({...bundle,basePrice:'',grabPrice:undefined,foodpandaPrice:null},state);assert.equal(draft.status,'draft');assert.equal(draft.basePrice,null);assert.equal(draft.grabPrice,null);assert.equal(draft.foodpandaPrice,null);
 for(const patch of [{components:[]},{components:[{menuId:'missing',qty:1}]},{components:[{menuId:'tako',qty:0}]},{components:[{menuId:'tako',qty:.5}]},{components:[{menuId:'tako',qty:1},{menuId:'tako',qty:2}]},{basePrice:-1},{foodpandaPrice:'invalid'}])assert.throws(()=>normalizeBundleDraft({...bundle,...patch},state));
});
test('bundle drafts are saved only as non-live settings and never create a menu, BOM, sale or stock write',async()=>{
 const h=fixture(),state=await h.service.load(),before=commercialBefore(h);await h.service.saveBundleDraft('plan-one',bundle,options(state,'save-plan'));const saved=h.get('settings/menu_bundle_drafts');assert.equal(saved.version,1);assert.equal(saved.drafts[0].status,'draft');assert.deepEqual(saved.drafts[0].components,bundle.components);assert.equal(saved.drafts[0].basePrice,175);assertNoCommercialChanges(h,before);assert.equal(h.get('menu/plan-one'),undefined);
 const current=await h.service.load();assert.equal(current.drafts[0].id,'plan-one');assert.equal(current.drafts[0].name,bundle.name);
});
test('bundle lost-ACK retries, concurrent edits and rejected commits cannot duplicate or partially replace plans',async()=>{
 const h=fixture(),state=await h.service.load();h.loseNextAck();await assert.rejects(h.service.saveBundleDraft('plan-one',bundle,options(state,'plan-retry')),/Connection lost/);assert.equal((await h.service.saveBundleDraft('plan-one',bundle,options(state,'plan-retry'))).repeated,true);assert.equal(h.get('settings/menu_bundle_drafts').drafts.length,1);
 const ready=await h.service.load();h.failNextCommit();await assert.rejects(h.service.saveBundleDraft('plan-one',{...bundle,name:'New title'},options(ready,'plan-reject')),/Commit rejected/);assert.equal(h.get('settings/menu_bundle_drafts').drafts[0].name,bundle.name);
 await h.service.saveBundleDraft('plan-two',{...bundle,name:'Second plan'},options(ready,'plan-two'));await assert.rejects(h.service.saveBundleDraft('plan-one',{...bundle,name:'Stale edit'},options(ready,'plan-stale')),/after this preview/);assert.equal(h.get('settings/menu_bundle_drafts').drafts.length,2);
});
test('a changed component product holds the reviewed bundle while unrelated stock movements remain untouched',async()=>{
 const h=fixture(),state=await h.service.load();h.put('menu/shake',{...h.get('menu/shake'),price:999});await assert.rejects(h.service.saveBundleDraft('plan',bundle,options(state,'component-changed')),/affected item changed/);assert.equal(h.get('settings/menu_bundle_drafts'),undefined);
});
test('deleting a bundle draft is idempotent and remains separate from live menu and stocks',async()=>{
 const h=fixture(),state=await h.service.load(),before=commercialBefore(h);await h.service.saveBundleDraft('plan',bundle,options(state,'draft-first'));const ready=await h.service.load();h.loseNextAck();await assert.rejects(h.service.deleteBundleDraft('plan',options(ready,'draft-delete')),/Connection lost/);assert.equal((await h.service.deleteBundleDraft('plan',options(ready,'draft-delete'))).repeated,true);const fresh=await h.service.load();assert.equal((await h.service.deleteBundleDraft('plan',options(fresh,'draft-delete'))).repeated,true);assert.deepEqual(h.get('settings/menu_bundle_drafts').drafts,[]);assertNoCommercialChanges(h,before);
});
test('apply selection is bounded and does not silently target every product',async()=>{
 const h=fixture(),state=await h.service.load();assert.equal(previewAddonApply(state,'cheese').targets.length,0);assert.equal(previewAddonApply(state,'cheese').canApply,false);
 assert.throws(()=>previewAddonApply(state,'cheese',{productIds:['tako','tako']}),/unique/);assert.throws(()=>previewAddonApply(state,'cheese',{productIds:Array.from({length:101},(_,i)=>'p'+i)}),/100/);
 const byCategory=previewAddonApply(state,'cheese',{categories:['Takoyaki']});assert.deepEqual(byCategory.targets.map(row=>row.id),['tako']);
});
test('saved embedded IDs cannot redirect an option edit away from the selected document',async()=>{
 const h=fixture();h.put('menu/tako',{...h.get('menu/tako'),id:'shake'});const state=await h.service.load(),preview=previewAddonApply(state,'cheese',{productIds:['tako']});assert.equal(preview.targets[0].id,'tako');await h.service.applyAddonToProducts('cheese',{productIds:['tako']},options(state,'canonical-id'));assert.equal(h.get('menu/tako').addons[0].globalAddonId,'cheese');assert.equal(h.get('menu/shake').addons,undefined);
});
test('prototype-like IDs never fabricate a saved product or existing add-on',async()=>{
 const h=fixture(),state=await h.service.load();for(const menuId of ['constructor','__proto__','toString']){assert.throws(()=>previewAddonApply(state,'cheese',{productIds:[menuId]}),/no longer exists/);assert.throws(()=>normalizeBundleDraft({...bundle,components:[{menuId,qty:1}]},state),/missing/);}
 await h.service.saveAddon('constructor',{name:'Constructor-named real record',price:0,linkedIngredient:'',deductQty:0,category:['All']},options(state,'prototype-safe'));assert.deepEqual(h.get('global_addons/constructor').legacyDefinitions,[]);assert.equal(h.get('global_addons/constructor').revision,1);
});

test('legacy comma-separated categories normalize and apply without guessing product names',async()=>{
 const h=fixture();h.put('global_addons/cheese',{...addon,category:'Takoyaki, Drinks'});const state=await h.service.load();
 assert.deepEqual(normalizeGlobalAddon(state.documents.global_addons.cheese,state,{id:'cheese'}).category,['Takoyaki','Drinks']);
 assert.equal(addonAppliesToProduct({category:'Coffee, Drinks'},{category:'Drinks'}),true);
 assert.equal(addonAppliesToProduct({category:'Coffee, Drinks'},{category:'Takoyaki',name:'Drinks combination'}),false);
 const preview=previewAddonApply(state,'cheese',{productIds:['tako','shake']});assert.equal(preview.canApply,true);await h.service.applyAddonToProducts('cheese',{productIds:['tako','shake']},options(state,'legacy-comma-apply'));assert.equal(h.get('menu/shake').addons[0].globalAddonId,'cheese');
});

const mix={categories:['Takoyaki'],flavors:['Sauce','Plain'],mappings:[{flavor:'Sauce',linkedIngredient:'Sauce',deductQty:2}]};
const disabledMix={categories:[],flavors:[],mappings:[]};
test('load includes global mix-and-match and saved display order, using canonical IDs then alphabetical fallback',async()=>{
 const h=fixture();h.put('global_addons/z-last',{...addon,name:'Zebra'});h.put('global_addons/a-first',{...addon,name:'Apple',id:'cheese'});h.put('global_addons/b-second',{...addon,name:'Banana'});
 h.put('settings/global_mixmatch',mix);h.put('settings/pos_addon_layout',{items:['z-last','gone','z-last','cheese'],itemNames:['zebra','cheese'],note:'Preserve'});
 const before=structuredClone([...h.docs]),state=await h.service.load();assert.deepEqual(state.addons.map(row=>row.id),['z-last','cheese','a-first','b-second']);assert.deepEqual(state.documents.settings.global_mixmatch,mix);assert.equal(state.documents.settings.pos_addon_layout.note,'Preserve');assert.deepEqual([...h.docs],before);
});

test('global mix-and-match validates exact categories, unique flavors and unambiguous positive HQ mappings',async()=>{
 const h=fixture(),state=await h.service.load();assert.deepEqual(normalizeGlobalMixMatch(disabledMix,state),disabledMix);assert.deepEqual(normalizeGlobalMixMatch({...mix,categories:'Takoyaki, Drinks',mappings:[{flavor:' sauce ',linkedIngredient:'Sauce',deductQty:'2'}]},state),{...mix,categories:['Takoyaki','Drinks']});
 for(const patch of [{categories:['Unknown']},{categories:['All','Drinks']},{categories:null},{flavors:[]},{flavors:['Same',' same ']},{flavors:Array.from({length:31},(_,index)=>'Flavor '+index)},{mappings:[{flavor:'Gone',linkedIngredient:'Sauce',deductQty:2}]},{mappings:[{flavor:'Sauce',linkedIngredient:'Sauce',deductQty:0}]},{mappings:[{flavor:'Sauce',linkedIngredient:'Sauce',deductQty:-1}]},{mappings:[{flavor:'Sauce',linkedIngredient:'Sauce',deductQty:'2oops'}]},{mappings:[{flavor:'Sauce',linkedIngredient:'Gone',deductQty:2}]},{mappings:[{flavor:'Sauce',linkedIngredient:'',deductQty:2}]},{mappings:[{flavor:'Sauce',linkedIngredient:'Sauce',deductQty:2},{flavor:' sauce ',linkedIngredient:'Sauce',deductQty:3}]}])assert.throws(()=>normalizeGlobalMixMatch({...mix,...patch},state));
 h.put('inventory/duplicate',{name:'Sauce',branch:'Main Office',uom:'gram'});const duplicate=await h.service.load();assert.throws(()=>normalizeGlobalMixMatch(mix,duplicate),/duplicated/);h.docs.delete('inventory/duplicate');h.put('inventory/hq-sauce',{name:'Sauce',branch:'Main Office'});assert.throws(()=>normalizeGlobalMixMatch(mix,{...state,documents:{...state.documents,inventory:{stock:h.get('inventory/hq-sauce')}}}),/base unit/);
});

test('enabled global mix-and-match can be explicitly disabled without changing menu prices, recipes, stock or receipts',async()=>{
 const h=fixture(),before=commercialBefore(h),state=await h.service.load();await h.service.saveMixMatch({...mix,ignored:'Not part of the consumer schema'},options(state,'mix-enable'));assert.deepEqual(h.get('settings/global_mixmatch'),mix);assert.equal(h.get('settings/recipe_revision').version,1);assertNoCommercialChanges(h,before);
 const enabled=await h.service.load();await h.service.saveMixMatch(disabledMix,options(enabled,'mix-disable'));assert.deepEqual(h.get('settings/global_mixmatch'),disabledMix);assert.equal(h.get('settings/recipe_revision').version,2);assertNoCommercialChanges(h,before);
});

test('global mix-and-match lost-ACK recovery and concurrent retries save a single revision',async()=>{
 const h=fixture(),state=await h.service.load();h.loseNextAck();await assert.rejects(h.service.saveMixMatch(mix,options(state,'mix-retry')),/Connection lost/);const results=await Promise.all(Array.from({length:4},()=>h.service.saveMixMatch(mix,options(state,'mix-retry'))));assert.ok(results.every(result=>result.repeated));
 const refreshed=await h.service.load();assert.equal((await h.service.saveMixMatch(mix,options(refreshed,'mix-retry'))).repeated,true);assert.equal(h.get('settings/recipe_revision').version,1);await assert.rejects(h.service.saveMixMatch(disabledMix,options(refreshed,'mix-retry')),/different edits/);assert.deepEqual(h.get('settings/global_mixmatch'),mix);
});

test('global mix-and-match rejects stale settings, ingredient units and menu category previews atomically',async()=>{
 for(const kind of ['settings','ingredient','category','revision','commit','authority']){
  const h=fixture(),state=await h.service.load();if(kind==='settings')h.put('settings/global_mixmatch',{categories:['All'],flavors:['Legacy'],mappings:[]});if(kind==='ingredient')h.put('inventory/hq-sauce',{...h.get('inventory/hq-sauce'),uom:'ml'});if(kind==='category')h.put('menu/tako',{...h.get('menu/tako'),category:'Changed category'});if(kind==='revision')h.put('settings/recipe_revision',{version:1,revisionId:'other'});if(kind==='commit')h.failNextCommit();if(kind==='authority')h.put('hq_email_access/'+email,{status:'revoked'});
  const before=structuredClone([...h.docs]);await assert.rejects(h.service.saveMixMatch(mix,options(state,'mix-held-'+kind)),/after this preview|Commit rejected|revoked/);assert.deepEqual([...h.docs],before);
 }
});

test('display order saves exactly current add-on IDs and POS names while preserving unrelated setting fields',async()=>{
 const h=fixture();h.put('global_addons/second',{...addon,name:'Pearls'});h.put('settings/pos_addon_layout',{items:['cheese','second'],itemNames:['cheese','pearls'],note:'Keep this setting'});const state=await h.service.load(),before=commercialBefore(h);
 await h.service.saveAddonOrder(['second','cheese'],options(state,'order-save'));assert.deepEqual(h.get('settings/pos_addon_layout'),{items:['second','cheese'],itemNames:['pearls','cheese'],note:'Keep this setting'});assertNoCommercialChanges(h,before);assert.deepEqual((await h.service.load()).addons.map(row=>row.id),['second','cheese']);
});

test('display order rejects omitted, repeated, fabricated or invalid IDs before any write',async()=>{
 const h=fixture();h.put('global_addons/second',{...addon,name:'Pearls'});const state=await h.service.load(),before=structuredClone([...h.docs]);for(const ids of [null,[],['cheese'],['cheese','cheese'],['cheese','missing'],['cheese','constructor'],['cheese',{}]])await assert.rejects(h.service.saveAddonOrder(ids,options(state,'bad-order')),/every current saved add-on/);assert.deepEqual([...h.docs],before);
});

test('display order lost acknowledgments recover once and stale settings or names cannot overwrite another edit',async()=>{
 const h=fixture(),state=await h.service.load();h.loseNextAck();await assert.rejects(h.service.saveAddonOrder(['cheese'],options(state,'order-retry')),/Connection lost/);assert.equal((await h.service.saveAddonOrder(['cheese'],options(state,'order-retry'))).repeated,true);const fresh=await h.service.load();assert.equal((await h.service.saveAddonOrder(['cheese'],options(fresh,'order-retry'))).repeated,true);assert.equal(h.get('settings/recipe_revision').version,1);
 for(const kind of ['settings','name','revision','commit']){
  const f=fixture(),baseline=await f.service.load();if(kind==='settings')f.put('settings/pos_addon_layout',{items:['other'],itemNames:['other']});if(kind==='name')f.put('global_addons/cheese',{...addon,name:'Updated name'});if(kind==='revision')f.put('settings/recipe_revision',{version:1,revisionId:'other'});if(kind==='commit')f.failNextCommit();const before=structuredClone([...f.docs]);await assert.rejects(f.service.saveAddonOrder(['cheese'],options(baseline,'order-held-'+kind)),/after this preview|Commit rejected/);assert.deepEqual([...f.docs],before);
 }
});
