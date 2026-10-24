import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {installProductAddonDrafts,readProductAddonRows} from '../takodeal-manager/product-options-draft.js';

const oldOption=globalThis.Option;
class Node {
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.attributes={};this.listeners={};this.dataset={};this.style={};this.className='';this.textContent='';this.disabled=false;this._value='';}
 set value(value){this._value=String(value??'');}get value(){return this._value;}
 get options(){return this.children.filter(node=>node.tagName==='OPTION');}
 get isConnected(){return this===this.ownerDocument.body||!!this.parentNode?.isConnected;}
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
 remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}}
 setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name]??null;}
 addEventListener(name,handler){this.listeners[name]=handler;}
 querySelectorAll(selector){const match=node=>selector.startsWith('.')?node.className.split(/\s+/).includes(selector.slice(1)):node.tagName===selector.toUpperCase();return this.children.flatMap(node=>[...(match(node)?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 set innerHTML(value){throw Error('The draft controller must build options using DOM properties, not HTML: '+value);}
}
globalThis.Option=class OptionNode extends Node {constructor(label,value){super('option',documentForOption);this.textContent=String(label);this.value=value;}};
let documentForOption;
after(()=>{if(oldOption===undefined)delete globalThis.Option;else globalThis.Option=oldOption;});
const wait=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const snapshot=rows=>({docs:rows.map(row=>({id:row.id,data:()=>structuredClone(row)}))});

function fixture({globals=[],source={addons:[]}}={}){
 const elements=new Map(),document={createElement:tag=>new Node(tag,document),getElementById:id=>elements.get(id)||null,querySelectorAll(selector){const match=selector.match(/^#([^ ]+) (.+)$/);return match?this.getElementById(match[1])?.querySelectorAll(match[2])||[]:[];}};document.body=document.createElement('body');documentForOption=document;
 const add=(id,tag='input',value='')=>{const node=document.createElement(tag);node.id=id;node.value=value;elements.set(id,node);document.body.append(node);return node;};
 add('advancedProductModal','div').style.display='flex';add('advProdId','input','target-product');add('advProdCat','input','Takoyaki');add('addonCloneSelect','select','source-product');add('addonTableBody','tbody');add('btnAutoLoadAddons','button').textContent='Load category options';
 const dialogs=[],reads=[],api={db:{},auth:{currentUser:{uid:'sample-owner',email:'owner@example.test'}},advRecipeState:{documents:{inventory:{sauce:{name:'Sample sauce',branch:'Main Office',uom:'gram'},other:{name:'Other branch stock',branch:'Maa',uom:'gram'}}}},
  collection:(_db,table)=>({table}),doc:(_db,table,id)=>({table,id}),getDocsFromServer:async ref=>{reads.push(ref.table);return snapshot(globals);},getDocFromServer:async ref=>{reads.push(ref.table+'/'+ref.id);return {exists:()=>source!==null,data:()=>structuredClone(source)};},Swal:{fire:async options=>{dialogs.push(options);return {isConfirmed:true};}}};
 const controller=installProductAddonDrafts(api,document),node=id=>document.getElementById(id),rows=()=>document.querySelectorAll('#addonTableBody tr');
 return {api,document,node,controller,rows,reads,dialogs};
}

test('category loading uses exact category names, category arrays and All without product-name substring matches',async()=>{
 const f=fixture({globals:[{id:'exact',name:'Extra cheese',price:15,category:['Takoyaki'],linkedIngredient:'Sample sauce',deductQty:2},{id:'all',name:'Universal extra',price:10,category:['All']},{id:'legacy',name:'Legacy category list',price:5,category:'Coffee, Takoyaki'},{id:'substring',name:'Takoyaki sauce wording',category:'Sauce'},{id:'larger-category',name:'Other product',category:['Takoyaki Rice']}]});
 await f.api.autoLoadCategoryAddons();assert.deepEqual(f.controller.readRows().map(row=>row.name),['Extra cheese','Universal extra','Legacy category list']);assert.deepEqual(f.reads,['global_addons']);assert.equal(f.node('btnAutoLoadAddons').disabled,false);assert.match(f.dialogs.at(-1).text,/3 option\(s\) added/);
});

test('duplicate global names block the whole load before a valid earlier row can be added',async()=>{
 const f=fixture({globals:[{id:'good',name:'Unique first',price:10,category:'Takoyaki'},{id:'a',name:'Cheese',price:10,category:'Takoyaki'},{id:'b',name:' cheese ',price:20,category:'Takoyaki'}]});
 await f.api.autoLoadCategoryAddons();assert.equal(f.rows().length,0);assert.match(f.dialogs.at(-1).text,/duplicate or missing names/);assert.equal(f.node('btnAutoLoadAddons').disabled,false);
});

test('a matching global option cannot silently choose between duplicate names in different categories',async()=>{
 const f=fixture({globals:[{id:'a',name:'Cheese',category:['Takoyaki'],price:10},{id:'b',name:'CHEESE',category:['Coffee'],price:20}]});await f.api.autoLoadCategoryAddons();assert.equal(f.rows().length,0);assert.match(f.dialogs.at(-1).text,/duplicate or missing names/);
});

test('stable globalAddonId is retained through DOM rows and collection without inventing one for local options',()=>{
 const f=fixture();f.api.addAddonRow('Sample option',15,'Sample sauce',2,{globalAddonId:'saved-global-a'});f.api.addAddonRow('Local option',0,'',0);
 assert.deepEqual(readProductAddonRows(f.document),[{name:'Sample option',price:15,linkedIngredient:'Sample sauce',deductQty:2,globalAddonId:'saved-global-a'},{name:'Local option',price:0,linkedIngredient:'',deductQty:0}]);assert.equal(f.rows()[0].dataset.globalAddonId,'saved-global-a');
});

test('product option stock quantity displays the saved base unit ahead of its purchase unit',()=>{
 const f=fixture();f.api.advRecipeState.documents.inventory.sauce={name:'Sample sauce',branch:'Main Office',uom:'Pack',baseUom:'gram'};f.api.addAddonRow('Sauce',15,'Sample sauce',2);
 const selected=f.rows()[0].querySelector('.addon-ingredient').options.find(row=>row.value==='Sample sauce');assert.equal(selected.textContent,'Sample sauce · gram');assert.equal(f.controller.readRows()[0].deductQty,2);
});

test('collecting a draft rejects case-folded duplicate option names',()=>{
 const f=fixture();f.api.addAddonRow('Extra Cheese',15,'',0);f.api.addAddonRow(' extra cheese ',20,'',0);assert.throws(()=>f.controller.readRows(),/unique name/);
});

test('collecting a draft ignores an empty new row but rejects a filled row with no name',()=>{
 const f=fixture();f.api.addAddonRow();assert.deepEqual(f.controller.readRows(),[]);f.api.addAddonRow('  ',15,'Sample sauce',2);assert.throws(()=>f.controller.readRows(),/name/i);
});

for(const scenario of ['category','product','account','email','recipe-state','closed-modal'])test('a delayed category read cannot add rows after '+scenario+' changes',async()=>{
 const f=fixture(),pending=wait();f.api.getDocsFromServer=()=>pending.promise;const loading=f.api.autoLoadCategoryAddons();
 if(scenario==='category')f.node('advProdCat').value='Coffee';if(scenario==='product')f.node('advProdId').value='another-product';if(scenario==='account')f.api.auth.currentUser.uid='another-owner';if(scenario==='email')f.api.auth.currentUser.email='another@example.test';if(scenario==='recipe-state')f.api.advRecipeState=structuredClone(f.api.advRecipeState);if(scenario==='closed-modal')f.node('advancedProductModal').style.display='none';
 pending.resolve(snapshot([{id:'a',name:'New option',price:5,category:'Takoyaki'}]));await loading;assert.equal(f.rows().length,0);assert.match(f.dialogs.at(-1).text,/draft changed/);
});

test('repeated category loads preserve existing option values and add no duplicate rows',async()=>{
 const f=fixture({globals:[{id:'global-cheese',name:'Cheese',price:15,linkedIngredient:'Sample sauce',deductQty:2,category:'Takoyaki'}]});f.api.addAddonRow('cheese',99,'Local stock',4);await f.api.autoLoadCategoryAddons();await f.api.autoLoadCategoryAddons();assert.deepEqual(f.controller.readRows(),[{name:'cheese',price:99,linkedIngredient:'Local stock',deductQty:4}]);assert.equal(f.rows().length,1);
});

test('copying options retains existing names and preserves provenance for newly copied rows',async()=>{
 const f=fixture({source:{addons:[{name:'CHEESE',price:15,linkedIngredient:'Sample sauce',deductQty:2,globalAddonId:'different-global'},{name:'Pearls',price:10,ingredient:'Legacy stock',qty:3,globalAddonId:'global-pearls'}]}});f.api.addAddonRow('Cheese',99,'Local stock',4,{globalAddonId:'original-global'});await f.api.cloneAddons();
 assert.deepEqual(f.controller.readRows(),[{name:'Cheese',price:99,linkedIngredient:'Local stock',deductQty:4,globalAddonId:'original-global'},{name:'Pearls',price:10,linkedIngredient:'Legacy stock',deductQty:3,globalAddonId:'global-pearls'}]);assert.deepEqual(f.reads,['menu/source-product']);
});

test('cancelled copy confirmation performs no source read and changes no draft rows',async()=>{
 const f=fixture();f.api.Swal.fire=async()=>({isConfirmed:false});await f.api.cloneAddons();assert.deepEqual(f.reads,[]);assert.equal(f.rows().length,0);
});

for(const scenario of ['category','product','account','source'])test('a delayed source read cannot copy into a draft after '+scenario+' changes',async()=>{
 const f=fixture(),pending=wait();let started=false;f.api.getDocFromServer=()=>{started=true;return pending.promise;};const copy=f.api.cloneAddons();while(!started)await Promise.resolve();
 if(scenario==='category')f.node('advProdCat').value='Coffee';if(scenario==='product')f.node('advProdId').value='new-product';if(scenario==='account')f.api.auth.currentUser.uid='new-account';if(scenario==='source')f.node('addonCloneSelect').value='different-source';
 pending.resolve({exists:()=>true,data:()=>({addons:[{name:'Wrong async option',price:10}]})});await copy;assert.equal(f.rows().length,0);assert.match(f.dialogs.at(-1).text,/changed|source/i);
});

test('a deleted source product leaves the existing draft intact with an actionable message',async()=>{
 const f=fixture({source:null});f.api.addAddonRow('Kept option',15,'',0);const before=f.controller.readRows();await f.api.cloneAddons();assert.deepEqual(f.controller.readRows(),before);assert.match(f.dialogs.at(-1).text,/unavailable/);
});

test('option and stock names containing markup are assigned as text without HTML construction',()=>{
 const f=fixture(),name='Chef\'s <img src=x onerror=alert(1)> & "extra"',ingredient='<svg onload=alert(1)>';
 f.api.advRecipeState.documents.inventory.malicious={name:ingredient,branch:'Main Office',uom:'gram'};const row=f.api.addAddonRow(name,15,ingredient,2,{globalAddonId:'literal-id'});
 assert.equal(row.querySelector('.addon-name').value,name);assert.equal(row.querySelector('.addon-ingredient').value,ingredient);assert.equal(row.querySelector('.addon-ingredient').options.find(option=>option.value===ingredient).textContent,ingredient+' · gram');assert.deepEqual(f.controller.readRows()[0],{name,price:15,linkedIngredient:ingredient,deductQty:2,globalAddonId:'literal-id'});
});

test('the row remove button removes only its own unsaved option',()=>{
 const f=fixture(),a=f.api.addAddonRow('A',1,'',0),b=f.api.addAddonRow('B',2,'',0);a.querySelector('button').listeners.click();assert.equal(a.isConnected,false);assert.equal(b.isConnected,true);assert.deepEqual(f.controller.readRows().map(row=>row.name),['B']);
});
