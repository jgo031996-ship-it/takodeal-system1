import test from 'node:test';
import assert from 'node:assert/strict';
import {installRecipeCostUI} from '../takodeal-manager/recipe-cost-ui.js';

class Element {
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.parentElement=null;this._text='';this.value='';this.style={};this.dataset={};this.attributes={};this.listeners={};this.className='';this.hidden=false;this.disabled=false;}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}set textContent(value){this._text=String(value??'');this.children=[];}
 get classList(){return {contains:name=>this.className.split(/\s+/).includes(name)};}
 get isConnected(){return this===this.ownerDocument.body||!!this.parentElement?.isConnected;}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
 before(node){const parent=this.parentElement;if(!parent)throw Error('Missing parent');node.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 addEventListener(name,listener){(this.listeners[name]||=[]).push(listener);}
 emit(name){for(const listener of this.listeners[name]||[])listener({target:this});}
 closest(tag){for(let node=this;node;node=node.parentElement)if(node.tagName===tag.toUpperCase())return node;return null;}
 querySelectorAll(selector){const matches=node=>selector.startsWith('.')?node.className.split(/\s+/).includes(selector.slice(1)):node.tagName===selector.toUpperCase();return this.children.flatMap(child=>[...(matches(child)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 set innerHTML(_value){throw Error('Recipe cost UI must use safe DOM text, not HTML.');}
}
const ice=(branch,price=15)=>({id:branch+'-ice',name:'Ice Cubes',branch,baseUom:'gram',uom:'gram',purchaseUom:'Kilo',conversionRate:1000,baseCost:price/1000});
const snapshot=rows=>({metadata:{fromCache:false,hasPendingWrites:false},docs:rows.map(row=>({id:row.id,metadata:{fromCache:false,hasPendingWrites:false},data:()=>structuredClone(row)}))});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({rows=[ice('Main Office',100),ice('Maa'),ice('Cabantian')],timeoutMs=1000}={}){
 const document={createElement:tag=>new Element(tag,document),getElementById:id=>{const find=node=>node.id===id?node:node.children.map(find).find(Boolean);return find(document.body)||null;}};document.body=document.createElement('body');
 const add=(id,tag='input',parent=document.body)=>{const node=document.createElement(tag);node.id=id;parent.append(node);return node;};
 const menu=add('view-menu','section');menu.className='active';const table=add('menuCostTable','table',menu);add('menuTableBody','tbody',table);
 const modal=add('advancedProductModal','div');modal.style.display='flex';const recipeTable=add('recipeTable','table',modal);add('advRecipeBody','tbody',recipeTable);
 for(const id of ['advTotalCost','profSellPrice','profProdCost','profMargin','profMarginPct'])add(id,'div',modal);
 add('advProdPrice').value='100';add('advProdGrabPrice').value='150';add('advProdFpPrice').value='155';
 const baseline={revision:{version:3},documents:{inventory:{original:ice('Maa',100)},bom:{saved:{ingredientName:'Ice Cubes',qty:100}},menu:{saved:{price:100}}}};
 const reads=[],notifications=[],w={db:{},auth:{currentUser:{uid:'owner-a',email:'owner@example.test'}},sessionUser:{uid:'owner-a',email:'owner@example.test',permissions:['menu'],role:'Owner',allowedBranches:['All']},currentAdvRecipe:[{docId:'original-row',ingredientName:'Ice Cubes',qty:170}],deletedAdvRecipes:['earlier-delete'],advRecipeState:baseline,pendingAdvMenuRef:{id:'new-product-id'},globalMenuItemsCache:[{name:'Drink',price:100}],collection:(_db,name)=>({name}),getDocsFromServer:async ref=>{reads.push(ref.name);return snapshot(rows);},renderMenuEditorUI:()=>{},ManagerUI:{notify:value=>notifications.push(value)}};
 let costs;const controller=installRecipeCostUI({window:w,document,setCosts:value=>{costs=value;},now:()=>Date.parse('2026-10-26T12:00:00Z'),timeoutMs});
 w.removeAdvRecipeRow=index=>{w.currentAdvRecipe.splice(index,1);w.renderAdvRecipeTable();};
 return {w,document,controller,reads,baseline,node:id=>document.getElementById(id),costs:()=>costs,basis:()=>document.body.querySelector('.recipe-cost-basis').querySelector('select'),setRows:value=>{rows=value;},notifications};
}
test('fresh costs use a server inventory read, display the shared store basis and ignore independent HQ pricing',async()=>{
 const f=fixture();await f.controller.freshInventory();f.w.renderAdvRecipeTable();assert.deepEqual(f.reads,['inventory']);assert.equal(f.node('advTotalCost').textContent,'₱2.55');assert.match(f.document.body.textContent,/Stores · shared cost/);assert.match(f.document.body.textContent,/Main Office is separate/);assert.equal(f.node('profMargin').textContent,'₱97.45');assert.equal(f.costs()['Ice Cubes'].cost,.015);
});
test('different store costs require an explicit store and all cost controls keep the same basis',async()=>{
 const f=fixture({rows:[ice('Maa',100),ice('Cabantian',15),ice('Main Office',100)]});await f.controller.freshInventory();f.w.renderAdvRecipeTable();assert.equal(f.node('advTotalCost').textContent,'Recipe cost needs review');assert.match(f.document.body.textContent,/Store costs differ/);
 f.basis().value='Cabantian';f.basis().emit('change');assert.equal(f.node('advTotalCost').textContent,'₱2.55');assert.equal(f.controller.getBasis(),'Cabantian');assert.ok(f.document.body.querySelectorAll('.recipe-cost-basis').every(bar=>bar.querySelector('select').value==='Cabantian'));
});
test('typing a quantity updates that row cost and the total without replacing the active quantity field',async()=>{
 const f=fixture();await f.controller.freshInventory();f.w.renderAdvRecipeTable();const row=f.node('advRecipeBody').children[0],quantity=row.children[1].children[0];quantity.value='200';quantity.emit('input');assert.equal(f.w.currentAdvRecipe[0].qty,200);assert.equal(f.node('advRecipeBody').children[0].children[1].children[0],quantity);assert.equal(row.children[3].querySelector('strong').textContent,'₱3.00');assert.equal(f.node('advTotalCost').textContent,'₱3.00');assert.equal(quantity.isConnected,true);
});
test('a cost-only refresh preserves unsaved recipe rows, prices, deleted-row intent and the original save baseline',async()=>{
 const f=fixture({rows:[ice('Maa',100)]});await f.controller.freshInventory();f.w.renderAdvRecipeTable();const recipe=f.w.currentAdvRecipe,deleted=f.w.deletedAdvRecipes,pending=f.w.pendingAdvMenuRef;f.setRows([ice('Maa',15)]);await f.controller.refresh();assert.equal(f.node('advTotalCost').textContent,'₱2.55');assert.equal(f.w.currentAdvRecipe,recipe);assert.deepEqual(recipe,[{docId:'original-row',ingredientName:'Ice Cubes',qty:170}]);assert.equal(f.w.deletedAdvRecipes,deleted);assert.deepEqual(deleted,['earlier-delete']);assert.equal(f.w.advRecipeState,f.baseline);assert.equal(f.w.pendingAdvMenuRef,pending);assert.deepEqual(['advProdPrice','advProdGrabPrice','advProdFpPrice'].map(id=>f.node(id).value),['100','150','155']);
});
test('fresh product-opening server inventory replaces an older cost map without rebasing the draft',async()=>{
 const f=fixture({rows:[ice('Maa',100)]});await f.controller.freshInventory();f.w.renderAdvRecipeTable();assert.equal(f.node('advTotalCost').textContent,'₱17.00');f.setRows([ice('Maa',15)]);await f.controller.freshInventory();f.w.renderAdvRecipeTable();assert.equal(f.node('advTotalCost').textContent,'₱2.55');assert.equal(f.w.advRecipeState,f.baseline);
});
test('unverified cached rows and a failed server refresh cannot remain plausible old or zero costs',async()=>{
 const f=fixture();f.controller.useInventory([ice('Maa')]);f.w.renderAdvRecipeTable();assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).total,null);assert.equal(f.node('profProdCost').textContent,'—');await f.controller.freshInventory();f.w.renderAdvRecipeTable();f.w.getDocsFromServer=async()=>{throw Error('Connection unavailable');};await assert.rejects(f.controller.refresh(),/Connection unavailable/);assert.equal(f.node('profProdCost').textContent,'—');assert.equal(f.costs()['Ice Cubes'],undefined);assert.match(f.document.body.textContent,/Connection unavailable/);
});
test('a delayed response after an account switch is discarded',async()=>{
 const f=fixture(),wait=deferred();f.w.getDocsFromServer=()=>wait.promise;const work=f.controller.freshInventory();f.w.auth.currentUser={uid:'owner-b',email:'different@example.test'};wait.resolve(snapshot([ice('Maa')]));await assert.rejects(work,/account/);assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).total,null);assert.equal(f.costs()['Ice Cubes'],undefined);
});
test('simultaneous cost requests share one read and an inventory change supersedes an older response',async()=>{
 const f=fixture(),first=deferred(),second=deferred();let reads=0;f.w.getDocsFromServer=()=>++reads===1?first.promise:second.promise;const a=f.controller.freshInventory(),b=f.controller.freshInventory();await Promise.resolve();assert.equal(reads,1);const changed=f.controller.inventoryChanged({branch:'Maa'});await Promise.resolve();assert.equal(reads,2);second.resolve(snapshot([ice('Maa',15)]));await changed;first.resolve(snapshot([ice('Maa',100)]));await assert.rejects(a,/newer inventory/);await assert.rejects(b,/newer inventory/);assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).total,2.55);
});
test('timeout marks costs unknown and permits a later successful retry',async()=>{
 const f=fixture({timeoutMs:5});f.w.getDocsFromServer=()=>new Promise(()=>{});await assert.rejects(f.controller.freshInventory(),/too long/);assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).total,null);f.w.getDocsFromServer=async()=>snapshot([ice('Maa')]);await f.controller.refresh();assert.equal(f.node('advTotalCost').textContent,'₱2.55');
});
test('unsafe saved names remain DOM text and no business write APIs are needed',async()=>{
 const name='<img src=x onerror=steal()>',f=fixture({rows:[{...ice('Maa'),name}]});for(const key of ['updateDoc','setDoc','writeBatch'])f.w[key]=()=>{throw Error('No writes allowed');};f.w.currentAdvRecipe=[{ingredientName:name,qty:170}];await f.controller.freshInventory();f.w.renderAdvRecipeTable();assert.equal(f.node('advRecipeBody').children[0].children[0].querySelector('input').value,name);assert.equal(f.node('advTotalCost').textContent,'₱2.55');assert.equal(f.document.body.querySelectorAll('img').length,0);
});
test('installer is safe before sign-in but a locked account cannot start a cost read',async()=>{
 const f=fixture();f.w.sessionUser=null;await assert.rejects(f.controller.freshInventory(),/Unlock/);assert.deepEqual(f.reads,[]);assert.equal(installRecipeCostUI({window:f.w,document:f.document}),f.controller);
});
for(const kind of ['snapshot-cache','snapshot-pending','snapshot-missing','document-cache','document-pending','document-missing'])test('unconfirmed server metadata is rejected: '+kind,async()=>{
 const f=fixture(),saved=snapshot([ice('Maa')]);
 if(kind==='snapshot-cache')saved.metadata.fromCache=true;if(kind==='snapshot-pending')saved.metadata.hasPendingWrites=true;if(kind==='snapshot-missing')delete saved.metadata;
 if(kind==='document-cache')saved.docs[0].metadata.fromCache=true;if(kind==='document-pending')saved.docs[0].metadata.hasPendingWrites=true;if(kind==='document-missing')delete saved.docs[0].metadata;
 f.w.getDocsFromServer=async()=>saved;await assert.rejects(f.controller.freshInventory(),/cached or have unconfirmed/);assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,null);assert.equal(f.costs()['Ice Cubes'],undefined);
});
test('an arbitrary array or recipe baseline cannot be promoted to a fresh verified cost batch',async()=>{
 const f=fixture();await f.controller.freshInventory();assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,2.55);
 f.controller.useInventory([ice('Maa',100)],{fresh:true});assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,null);
 f.controller.useRecipeState({documents:{inventory:{sample:ice('Maa',100)}}});assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,null);
});
test('restricted HQ staff see only their assigned branches and cannot trust isOwner as a forged boolean',async()=>{
 const f=fixture({rows:[ice('Maa',100),ice('Cabantian',15),ice('Main Office',80)]});f.w.sessionUser.allowedBranches=['Cabantian'];f.w.sessionUser.isOwner=true;await f.controller.freshInventory();assert.deepEqual(f.controller.getCatalog().branches,['Cabantian']);assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,2.55);assert.ok(!f.basis().children.some(option=>option.value==='Maa'||option.value==='Main Office'));
});
test('the verified Owner email may compare all store branches and explicit HQ even with a narrow session label',async()=>{
 const f=fixture();f.w.auth.currentUser.email='jgo031996@gmail.com';f.w.sessionUser.email='jgo031996@gmail.com';f.w.sessionUser.allowedBranches=['Cabantian'];await f.controller.freshInventory();assert.deepEqual(f.controller.getCatalog().branches,['Cabantian','Maa','Main Office']);
});
test('account/branch scope changes clear earlier cost and reject reuse of the earlier verified batch',async()=>{
 const f=fixture(),rows=await f.controller.freshInventory();f.basis().value='Main Office';f.basis().emit('change');assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,17);f.w.sessionUser.allowedBranches=['Cabantian'];assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,null);assert.equal(f.controller.getBasis(),'@stores');assert.throws(()=>f.controller.useInventory(rows,{fresh:true}),/account changed/);assert.equal(f.costs()['Ice Cubes'],undefined);
});
test('an older main-view response cannot overwrite a newer confirmed cost list',async()=>{
 const f=fixture({rows:[ice('Maa',100)]}),oldRows=await f.controller.freshInventory();f.setRows([ice('Maa',15)]);await f.controller.freshInventory();assert.throws(()=>f.controller.useInventory(oldRows,{fresh:true}),/newer inventory cost check/);assert.equal(f.controller.recipeSummary(f.w.currentAdvRecipe).cost,2.55);
});
test('rendering the legacy costing page after refresh uses the current catalog without a second inventory read',async()=>{
 const f=fixture();f.node('view-menu').className='';const products=f.document.createElement('section');products.id='view-products';products.className='active';f.document.body.append(products);const calls=[];f.w.loadMenuCosting=async options=>calls.push(options);await f.controller.refresh();assert.deepEqual(f.reads,['inventory']);assert.deepEqual(calls,[{reuseCosts:true}]);
});
