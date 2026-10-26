import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {buildRecipeCostCatalog,summarizeRecipeCosts} from '../takodeal-manager/recipe-cost-model.js';
const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const stock=(branch,baseCost=.015)=>({id:branch,name:'Ice Cubes',branch,baseCost,baseUom:'gram',uom:'gram'});
const recipe={menuItem:'Sample drink',ingredientName:'Ice Cubes',qty:170};
const menu={id:'sample-menu',name:'Sample drink',price:100,category:'Drinks'};
const snapshot=rows=>({forEach:fn=>rows.forEach(row=>fn({id:row.id,data:()=>row}))});
const summary=(rows,catalog)=>{const checked=summarizeRecipeCosts(rows,catalog);return {...checked,cost:checked.total,issues:checked.problems};};

test('actual Menu editor starts cached menu/BOM and fresh server inventory reads together without rendering the hidden costing page',async()=>{
 const from=main.indexOf('window.loadMenuEditor = async function()'),to=main.indexOf('// 🖱️ DRAG & DROP MENU ARRANGER ENGINE',from),source=main.slice(from,to),reads=[],pending=new Map(['menu','bom','inventory'].map(name=>[name,deferred()])),tbody={innerHTML:''};let rendered=0,catalog;
 const w={fetchCachedCollection:name=>{if(name==='inventory')throw Error('Inventory must be read from the server');reads.push(name);return pending.get(name).promise;},recipeCostUI:{freshInventory:()=>{reads.push('inventory-server');return pending.get('inventory').promise;},useInventory:(rows,options)=>{assert.equal(options.fresh,true);catalog=buildRecipeCostCatalog(rows);}},menuLayoutSnapshot:{exists:()=>true,data:()=>({items:[]})},renderMenuEditorUI:()=>rendered++,loadMenuCosting:()=>{throw Error('Hidden costing page must not render');}},context={window:w,document:{getElementById:id=>id==='menuTableBody'?tbody:null},console};vm.createContext(context);vm.runInContext(source,context);
 const work=w.loadMenuEditor();assert.deepEqual(reads,['menu','bom','inventory-server']);assert.equal(rendered,0);pending.get('menu').resolve([menu]);pending.get('bom').resolve([recipe]);pending.get('inventory').resolve([stock('Main Office',.1),stock('Maa'),stock('Cabantian')]);await work;
 assert.equal(rendered,1);assert.equal(catalog.costs['Ice Cubes'].cost,.015);assert.equal(w.globalMenuItemsCache[0].name,'Sample drink');assert.equal(w.menuRecipeRows.length,1);
});

test('actual standalone costing runs its three reads concurrently and displays selected-basis cost, not the highest branch',async()=>{
 const start=main.indexOf('window.loadMenuCosting = async function'),end=main.indexOf('window.openNewProductModal = async function',start),source=main.slice(start,end),reads=[],pending=new Map(['menu','bom','inventory'].map(name=>[name,deferred()])),nodes={bomTableBody:{innerHTML:''},bomAvgMargin:{innerText:''},bomMissing:{innerText:''}};let catalog;
 const w={activeCostingTab:'All',recipeCostUI:{freshInventory:()=>{reads.push('inventory-server');return pending.get('inventory').promise;},useInventory:rows=>{catalog=buildRecipeCostCatalog(rows);},recipeSummary:rows=>summary(rows,catalog)}},context={window:w,document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>[]},cachedSnapshot:name=>{reads.push(name);return pending.get(name).promise;},formatMoney:value=>'₱'+Number(value).toFixed(2),console};vm.createContext(context);vm.runInContext(source,context);
 const work=w.loadMenuCosting();assert.deepEqual(reads,['inventory-server','bom','menu']);pending.get('inventory').resolve([stock('Main Office',.1),stock('Maa'),stock('Cabantian')]);pending.get('bom').resolve(snapshot([recipe]));pending.get('menu').resolve(snapshot([menu]));await work;
 assert.match(nodes.bomTableBody.innerHTML,/₱2\.55/);assert.match(nodes.bomTableBody.innerHTML,/₱97\.45/);assert.doesNotMatch(nodes.bomTableBody.innerHTML,/₱17\.00/);assert.equal(nodes.bomMissing.innerText,0);
 reads.length=0;await w.loadMenuCosting({reuseCosts:true});assert.deepEqual(reads,['bom','menu']);assert.match(nodes.bomTableBody.innerHTML,/₱2\.55/);
});

test('actual Menu table holds unknown recipe cost instead of presenting zero cost or a false margin',()=>{
 const from=main.indexOf('window.renderMenuEditorUI = function()'),to=main.indexOf('window.saveMenuItemLayout = async function',from),source=main.slice(from,to),nodes={menuTableBody:{innerHTML:''},menuWorkspaceSummary:{innerHTML:''}};let catalog=buildRecipeCostCatalog([stock('Maa',.1),stock('Cabantian',.015)]);
 const w={globalMenuItemsCache:[menu],menuRecipeRows:[recipe],recipeCostUI:{recipeSummary:rows=>summary(rows,catalog)}},context={window:w,document:{getElementById:id=>nodes[id]||null},formatMoney:value=>'₱'+Number(value).toFixed(2),escapeHtml:value=>String(value),console};vm.createContext(context);vm.runInContext(source,context);w.renderMenuEditorUI();
 assert.match(nodes.menuTableBody.innerHTML,/Check recipe/);assert.doesNotMatch(nodes.menuTableBody.innerHTML,/₱0\.00|₱97\.45/);assert.match(nodes.menuWorkspaceSummary.innerHTML,/Recipes needing attention<\/span><strong>1/);
 catalog=buildRecipeCostCatalog([stock('Maa'),stock('Cabantian')]);w.renderMenuEditorUI();assert.match(nodes.menuTableBody.innerHTML,/₱2\.55/);assert.match(nodes.menuTableBody.innerHTML,/₱97\.45/);
});
