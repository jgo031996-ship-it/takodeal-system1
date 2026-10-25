import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {eligibleBundleProducts,bundleCategoryNames,normalizeCategoryBundleDraft,categoryBundleSummary,quoteCategoryBundle,validateCategoryBundleShape} from '../takodeal-manager/bundle-category-model.js';
import {normalizeBundleDraft,bundleDraftRows} from '../takodeal-manager/menu-options-model.js';
import {createMenuOptionsService} from '../takodeal-manager/menu-options-service.js';
const owner='jgo031996@gmail.com';
const product=(name,category,price,grabPrice=price,foodpandaPrice=price)=>({name,category,price,grabPrice,foodpandaPrice});
function state(menu){return {documents:{menu,settings:{}}};}
function sample(){return state({foodA:product('Food A','Food',100,120,130),foodB:product('Food B','Food',200,220,230),drinkA:product('Drink A','Drinks',10,15,20),drinkB:product('Drink B','Drinks',30,35,40)});}
const input={version:2,name:'Choose food and drink',slots:[{category:'Food',qty:2},{category:'Drinks',qty:1}],discountPercent:10,notes:'A future plan'};
function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid:'sample-owner',email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}};h.api.sessionUser={uid:'sample-owner',email:owner,permissions:['all'],role:'Owner'};
 h.put('hq_managers/owner',{email:owner,active:true,role:'Owner',permissions:['all'],assignedBranch:'All'});
 for(const [id,row]of Object.entries(sample().documents.menu))h.put('menu/'+id,row);
 h.put('inventory/keep',{branch:'Maa',name:'Sample stock',currentStock:17});h.put('bom/keep',{menuItem:'Food A',ingredientName:'Sample stock',qty:2});h.put('transactions/keep',{cart:[{name:'Food A',qty:1}],inventoryMovements:[{inventoryId:'keep',quantity:2}]});h.put('global_addons/keep',{name:'Keep add-on',price:5,category:['Food']});
 h.api.getDocFromServer=async ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});h.service=createMenuOptionsService(h.api);return h;
}
const options=(state,operationId)=>({state,operationId});
const commerce=h=>[...h.docs].filter(([path])=>!path.startsWith('settings/')).map(([path,row])=>[path,structuredClone(row)]);

test('eligible category products exclude internal or inactive records without guessing from product names',()=>{
 const s=sample();Object.assign(s.documents.menu,{prep:product('Prepared drink','Prep Batch',1),supplies:product('Cleaning',' cOnSuMaBlEs ',1),extra:product('Flavor','Extras',1),pack:product('Box','TAKEOUT PACKAGING',1),closed:{...product('Closed','Food',1),active:false},archive:{...product('Archived','Food',1),archived:true},disabled:{...product('Disabled','Food',1),disabled:true},named:product('Drinks food named like another category','Food',5),idMismatch:{...product('Canonical ID','Food',5),id:'drinkA'}});
 assert.deepEqual(bundleCategoryNames(s),['Drinks','Food']);assert.equal(eligibleBundleProducts(s,'Drinks').length,2);assert.ok(eligibleBundleProducts(s,'Food').some(row=>row.name.startsWith('Drinks food')));assert.equal(eligibleBundleProducts(s,'Food').find(row=>row.name==='Canonical ID').id,'idMismatch');assert.equal(eligibleBundleProducts(s,'food').length,0);
});

test('normalization captures reviewed category membership and preserves an explicit subset after new products appear',()=>{
 const s=sample(),all=normalizeCategoryBundleDraft({...input,discountPercent:undefined},s);assert.equal(all.version,2);assert.equal(all.status,'draft');assert.equal(all.discountPercent,0);assert.deepEqual(all.slots[0].menuIds,['foodA','foodB']);
 const subset=normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:'1',menuIds:['foodB']}]},s);s.documents.menu.new=product('New food','Food',1);assert.deepEqual(normalizeCategoryBundleDraft(subset,s).slots[0].menuIds,['foodB']);assert.equal(categoryBundleSummary(subset,s).combinationCount,'1');
});

test('invalid slot identities, quantities, categories and discounts cannot be silently normalized',()=>{
 const s=sample(),bad=[{slots:[]},{slots:Array.from({length:21},()=>({category:'Food',qty:1}))},{slots:[{category:'Gone',qty:1}]},{slots:[{category:'Food',qty:0}]},{slots:[{category:'Food',qty:.5}]},{slots:[{category:'Food',qty:101}]},{slots:[{category:'Food',qty:true}]},{slots:[{category:'Food',qty:1,menuIds:[]}]},{slots:[{category:'Food',qty:1,menuIds:['foodA','foodA']}]},{slots:[{category:'Food',qty:1,menuIds:['drinkA']}]},{slots:[{category:'Food',qty:1,menuIds:['constructor']}]},{slots:[{category:'PrepBatch',qty:1}]},{discountPercent:-1},{discountPercent:101},{discountPercent:null},{discountPercent:'bad'}];for(const patch of bad)assert.throws(()=>normalizeCategoryBundleDraft({...input,...patch},s));
 s.documents.menu.foodA.active=false;assert.throws(()=>normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:1,menuIds:['foodA']}]},s),/inactive/);
});

test('summary calculates exact channel min/max from category choices without averaging',()=>{
 const s=sample(),draft=normalizeCategoryBundleDraft(input,s),summary=categoryBundleSummary(draft,s);assert.equal(summary.combinationCount,'4');assert.equal(summary.slotSummaries[0].productCount,2);assert.equal(summary.slotSummaries[0].channels.base.min,200);assert.equal(summary.slotSummaries[0].channels.base.max,400);
 assert.deepEqual(Object.fromEntries(Object.entries(summary.channels).map(([channel,row])=>[channel,[row.min,row.max]])),{base:[189,387],grab:[229.5,427.5],foodpanda:[252,450]});
 const quote=quoteCategoryBundle(draft,['foodB','drinkA'],s);assert.equal(quote.channels.base.subtotal,410);assert.equal(quote.channels.base.total,369);assert.equal(quote.channels.grab.total,409.5);assert.equal(quote.items[0].channels.base.unitPrice,200);assert.equal(quote.items[0].channels.base.subtotal,400);
});

test('a discounted sum rounds once per channel using exact cents, including decimal percentages',()=>{
 const s=state({a:product('Small A','Food',.05),b:product('Small B','Drinks',.05)}),draft=normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:1},{category:'Drinks',qty:1}]},s);
 const quote=quoteCategoryBundle(draft,['a','b'],s);assert.equal(quote.channels.base.subtotal,.1);assert.equal(quote.channels.base.total,.09);assert.equal(categoryBundleSummary(draft,s).channels.base.min,.09);
 const thirds=normalizeCategoryBundleDraft({...draft,slots:[{category:'Food',qty:3,menuIds:['a']}],discountPercent:10},s);assert.equal(quoteCategoryBundle(thirds,['a'],s).channels.base.total,.14);
 const percent=normalizeCategoryBundleDraft({...draft,discountPercent:12.5},s);assert.equal(quoteCategoryBundle(percent,['a','b'],s).channels.base.total,.09);
});

test('zero prices and a 100 percent discount remain valid and do not hide missing channel prices',()=>{
 const s=state({a:product('Free food','Food',0,0,0)}),draft=normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:100}],discountPercent:100},s),quote=quoteCategoryBundle(draft,['a'],s);assert.equal(quote.complete,true);assert.equal(quote.channels.foodpanda.total,0);assert.equal(categoryBundleSummary(draft,s).channels.base.max,0);
 delete s.documents.menu.a.foodpandaPrice;const missing=quoteCategoryBundle(draft,['a'],s);assert.equal(missing.channels.foodpanda.complete,false);assert.equal(missing.channels.foodpanda.total,null);assert.equal(missing.channels.base.complete,true);
});

test('basePrice is a same-channel legacy alias while invalid filled prices and missing platform prices stay incomplete',()=>{
 const s=state({a:{name:'Legacy base','category':'Food',basePrice:35,grabPrice:40,foodpandaPrice:45}}),draft=normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:1}],discountPercent:0},s);assert.equal(quoteCategoryBundle(draft,['a'],s).channels.base.total,35);
 s.documents.menu.a.price=null;assert.equal(quoteCategoryBundle(draft,['a'],s).channels.base.total,35);
 for(const invalid of ['',true,-1,'35oops',Infinity,NaN,1.005,1e-10,'1.0000000001']){s.documents.menu.a.price=invalid;const quote=quoteCategoryBundle(draft,['a'],s);assert.equal(quote.channels.base.complete,false);assert.equal(quote.channels.base.total,null);assert.ok(quote.channels.base.reasons.length);assert.equal(quote.channels.grab.total,40);}
 s.documents.menu.a.price=10;delete s.documents.menu.a.grabPrice;assert.equal(quoteCategoryBundle(draft,['a'],s).channels.grab.total,null);
});

test('a missing eligible price makes the template range incomplete but another reviewed exact combination can be priced',()=>{
 const s=sample();delete s.documents.menu.foodB.foodpandaPrice;const draft=normalizeCategoryBundleDraft(input,s),summary=categoryBundleSummary(draft,s);assert.equal(summary.channels.foodpanda.complete,false);assert.equal(summary.channels.foodpanda.min,null);assert.equal(summary.channels.base.complete,true);
 assert.equal(quoteCategoryBundle(draft,['foodA','drinkA'],s).complete,true);assert.equal(quoteCategoryBundle(draft,['foodB','drinkA'],s).channels.foodpanda.total,null);
});

test('quotes reject unreviewed selections and report saved choices that became unavailable without adding new products',()=>{
 const s=sample(),draft=normalizeCategoryBundleDraft(input,s);s.documents.menu.new=product('Future food','Food',1);assert.equal(categoryBundleSummary(draft,s).combinationCount,'4');const selected=quoteCategoryBundle(draft,['new','drinkA'],s);assert.equal(selected.complete,false);assert.match(selected.channels.base.reasons.join(' '),/reviewed/);assert.equal(quoteCategoryBundle(draft,['foodA'],s).complete,false);
 s.documents.menu.foodA.category='Other';assert.equal(categoryBundleSummary(draft,s).channels.base.complete,false);assert.equal(quoteCategoryBundle(draft,['foodA','drinkA'],s).channels.base.total,null);
});

test('combination counts use multiplication across reviewed slots without generating a Cartesian list',()=>{
 const s=state(Object.fromEntries(Array.from({length:250},(_,index)=>['p'+index,product('Choice '+index,'Food',1)]))),draft=normalizeCategoryBundleDraft({...input,slots:Array.from({length:20},()=>({category:'Food',qty:1}))},s),summary=categoryBundleSummary(draft,s);assert.equal(summary.combinationCount,(250n**20n).toString());assert.equal(summary.channels.base.min,18);assert.equal(summary.slotSummaries.length,20);assert.equal(summary.combinations,undefined);
 s.documents.menu.extra=product('Choice extra','Food',1);assert.throws(()=>normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:1}]},s),/250/);
});

test('the union of reviewed product IDs is bounded without preventing repeated category slots',()=>{
 const s=state(Object.fromEntries(Array.from({length:301},(_,index)=>['p'+index,product('Choice '+index,index<250?'Food':'Drinks',1)])));assert.throws(()=>normalizeCategoryBundleDraft(input,s),/300 different/);
 const repeated=normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:1,menuIds:['p1']},{category:'Food',qty:2,menuIds:['p1']}]},s);assert.equal(quoteCategoryBundle(repeated,['p1','p1'],s).channels.base.subtotal,3);
});

test('legacy product draft schema remains readable and editable beside category templates',()=>{
 const s=sample(),legacy=normalizeBundleDraft({name:'Old plan',components:[{menuId:'foodA',qty:1}],basePrice:90},s),category=normalizeBundleDraft(input,s);assert.equal(legacy.version,1);assert.equal(legacy.basePrice,90);assert.equal(category.version,2);
 s.documents.settings.menu_bundle_drafts={version:1,revision:2,drafts:[{...legacy,id:'old'},{...category,id:'new'}]};assert.deepEqual(bundleDraftRows(s).map(row=>row.version),[1,2]);assert.throws(()=>normalizeBundleDraft({...input,version:3},s),/unsupported/);
});

test('saving a category template writes only the draft settings and revision markers',async()=>{
 const h=fixture(),state=await h.service.load(),before=commerce(h);await h.service.saveBundleDraft('category-plan',input,options(state,'category-save'));const saved=h.get('settings/menu_bundle_drafts').drafts[0];assert.equal(saved.version,2);assert.deepEqual(saved.slots[0].menuIds,['foodA','foodB']);assert.equal(saved.basePrice,undefined);assert.deepEqual(commerce(h),before);assert.equal(h.get('settings/recipe_revision').version,1);
 const reload=await h.service.load();assert.equal(reload.drafts[0].version,2);assert.equal(categoryBundleSummary(reload.drafts[0],reload).combinationCount,'4');
});

test('incomplete pricing remains saveable as a non-live plan without inventing totals',async()=>{
 const h=fixture();delete h.get('menu/foodA').foodpandaPrice;const state=await h.service.load();await h.service.saveBundleDraft('needs-price',input,options(state,'save-incomplete'));assert.equal(categoryBundleSummary(h.get('settings/menu_bundle_drafts').drafts[0],state).channels.foodpanda.min,null);assert.equal(h.get('menu/needs-price'),undefined);
});

test('category template lost acknowledgments and concurrent retries recover one settings revision',async()=>{
 const h=fixture(),state=await h.service.load(),draft=normalizeCategoryBundleDraft(input,state);h.loseNextAck();await assert.rejects(h.service.saveBundleDraft('plan',draft,options(state,'category-retry')),/Connection lost/);const repeated=await Promise.all(Array.from({length:4},()=>h.service.saveBundleDraft('plan',draft,options(state,'category-retry'))));assert.ok(repeated.every(row=>row.repeated));const fresh=await h.service.load();assert.equal((await h.service.saveBundleDraft('plan',draft,options(fresh,'category-retry'))).repeated,true);assert.equal(h.get('settings/menu_bundle_drafts').drafts.length,1);assert.equal(h.get('settings/recipe_revision').version,1);
 await assert.rejects(h.service.saveBundleDraft('plan',{...draft,discountPercent:5},options(fresh,'category-retry')),/different edits/);
});

test('new current category products do not expand saved eligibility on an explicit reviewed template',async()=>{
 const h=fixture(),state=await h.service.load(),draft=normalizeCategoryBundleDraft(input,state);h.put('menu/future',product('Future choice','Food',1));await h.service.saveBundleDraft('plan',draft,options(state,'no-auto-add'));assert.deepEqual(h.get('settings/menu_bundle_drafts').drafts[0].slots[0].menuIds,['foodA','foodB']);
});

test('stale price, category, name, eligibility, settings and recipe revisions abort before any draft write',async()=>{
 for(const kind of ['price','category','name','inactive','deleted','settings','revision']){
  const h=fixture(),state=await h.service.load();if(kind==='price')h.put('menu/foodA',{...h.get('menu/foodA'),foodpandaPrice:999});if(kind==='category')h.put('menu/foodA',{...h.get('menu/foodA'),category:'Other'});if(kind==='name')h.put('menu/foodA',{...h.get('menu/foodA'),name:'Renamed'});if(kind==='inactive')h.put('menu/foodA',{...h.get('menu/foodA'),active:false});if(kind==='deleted')h.docs.delete('menu/foodA');if(kind==='settings')h.put('settings/menu_bundle_drafts',{version:1,revision:1,drafts:[]});if(kind==='revision')h.put('settings/recipe_revision',{version:1,revisionId:'concurrent'});const before=structuredClone([...h.docs]);await assert.rejects(h.service.saveBundleDraft('plan',input,options(state,'held-'+kind)),/after this preview/);assert.deepEqual([...h.docs],before);
 }
});

test('a failure or current access revocation cannot create a partial category draft',async()=>{
 for(const kind of ['commit','access','account','view']){
  const h=fixture(),state=await h.service.load();if(kind==='commit')h.failNextCommit();if(kind==='access')h.put('hq_email_access/'+owner,{active:false});if(kind==='account')h.api.sessionUser={...h.api.sessionUser};const before=structuredClone([...h.docs]),settings={state,operationId:'reject-'+kind,...(kind==='view'?{assertCurrent:()=>{throw Error('View changed');}}:{})};await assert.rejects(h.service.saveBundleDraft('plan',input,settings),/Commit rejected|revoked|account changed|View changed/);assert.deepEqual([...h.docs],before);
 }
});

test('v1 and v2 saves preserve the other draft and draft deletion remains idempotent',async()=>{
 const h=fixture();let state=await h.service.load();await h.service.saveBundleDraft('legacy',{name:'Legacy',components:[{menuId:'foodA',qty:1}],basePrice:85},options(state,'legacy-first'));state=await h.service.load();const old=structuredClone(state.drafts[0]);await h.service.saveBundleDraft('category',input,options(state,'category-next'));state=await h.service.load();assert.deepEqual(state.drafts.find(row=>row.id==='legacy'),old);await h.service.saveBundleDraft('legacy',{...old,name:'Legacy renamed'},options(state,'legacy-edit'));state=await h.service.load();assert.equal(state.drafts.find(row=>row.id==='category').version,2);h.loseNextAck();await assert.rejects(h.service.deleteBundleDraft('category',options(state,'delete-category')),/Connection lost/);assert.equal((await h.service.deleteBundleDraft('category',options(state,'delete-category'))).repeated,true);assert.equal(h.get('settings/menu_bundle_drafts').drafts.length,1);
});

test('unsafe monetary totals stay incomplete and an oversized draft document is refused without writes',async()=>{
 const s=state({a:product('Large A','Food',80000000000000),b:product('Large B','Drinks',80000000000000)}),draft=normalizeCategoryBundleDraft({...input,slots:[{category:'Food',qty:1},{category:'Drinks',qty:1}]},s);assert.equal(categoryBundleSummary(draft,s).channels.base.complete,false);assert.equal(quoteCategoryBundle(draft,['a','b'],s).channels.base.total,null);
 const h=fixture();h.put('settings/menu_bundle_drafts',{version:1,revision:1,drafts:[{id:'old',version:1,status:'draft',name:'Historical oversized notes',notes:'x'.repeat(750000),components:[]}]});const loaded=await h.service.load(),before=structuredClone([...h.docs]);await assert.rejects(h.service.saveBundleDraft('new',input,options(loaded,'too-large')),/too large/);assert.deepEqual([...h.docs],before);
});

test('persisted v2 shape validation prevents malformed slots from reaching the renderer without rejecting stale product IDs',async()=>{
 const h=fixture(),original=normalizeCategoryBundleDraft(input,await h.service.load());const draft={...original,id:'saved',revision:1};
 for(const patch of [{slots:{}},{slots:[null]},{slots:[{category:'Food',qty:1,menuIds:{}}]},{slots:[{category:'Food',qty:1,menuIds:['foodA','foodA']}]},{slots:[{category:'Food',qty:'bad',menuIds:['foodA']}]},{discountPercent:200}]){h.put('settings/menu_bundle_drafts',{version:1,revision:1,drafts:[{...draft,...patch}]});await assert.rejects(h.service.load(),/saved category bundle draft needs Owner review/);}
 h.put('settings/menu_bundle_drafts',{version:1,revision:1,drafts:[draft]});h.docs.delete('menu/foodA');h.put('menu/foodB',{...h.get('menu/foodB'),archived:true});const loaded=await h.service.load();assert.equal(validateCategoryBundleShape(loaded.drafts[0]),true);assert.deepEqual(loaded.drafts[0].slots[0].menuIds,['foodA','foodB']);assert.equal(categoryBundleSummary(loaded.drafts[0],loaded).channels.base.complete,false);
});
