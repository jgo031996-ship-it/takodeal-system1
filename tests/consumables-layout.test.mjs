import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function harness(items=[]) {
    const classes=()=>({values:new Set(),add(value){this.values.add(value);},remove(value){this.values.delete(value);}});
    const nodes=Object.fromEntries(['consumablesItemGrid','consumablesCategoryHeader','consumablesTabNew','consumablesTabHistory','consumablesCartPanel','btnTabConsNew','btnTabConsHist'].map(id=>[id,{style:{},classList:classes(),innerHTML:''}]));
    nodes.consumablesCategoryHeader.firstElementChild={classList:classes()};
    const cards=items.map(item=>({category:item.category,style:{},getAttribute(name){assert.equal(name,'data-category');return this.category;}}));
    const categoryButtons=[nodes.consumablesCategoryHeader.firstElementChild,{classList:classes()}];
    const reads=[],writes=[],cart=[{id:'draft',name:'Keep this draft',qty:2,uom:'piece'}];let historyReads=0;
    const window={db:{},consumableCategories:['Consumables','Cleaning Supplies','Packaging'],consumablesCart:cart,
        doc:(_db,table,id)=>({table,id}),getDoc:async ref=>{reads.push(ref);return {exists:()=>true,data:()=>({consumableCats:['Consumables','Cleaning Supplies','Packaging']})};},
        fetchCachedInventory:async branch=>{reads.push({branch});return items;},loadConsumablesHistory(){historyReads++;},
        updateDoc:()=>writes.push('update'),addDoc:()=>writes.push('add')};
    const context=vm.createContext({window,document:{getElementById:id=>nodes[id],querySelectorAll:selector=>selector==='.cons-ultra-card'?cards:categoryButtons},
        localStorage:{getItem:key=>key==='takodeal_device_branch'?'Maa':null},imageFor:()=>'',Image:class {},console:{error(){}}});
    vm.runInContext(section('window.loadConsumablesView = async function','window.addToConsumablesCart = async function'),context);
    vm.runInContext(section('window.switchConsumablesTab = function','window.loadConsumablesHistory = async function'),context);
    return {window,nodes,cards,reads,writes,cart,get historyReads(){return historyReads;}};
}

test('Consumables loads every matching supply from the branch cache without truncating a long list or writing stock',async()=>{
    const items=Array.from({length:65},(_,index)=>({id:'supply-'+index,name:'Supply '+String(index).padStart(2,'0'),category:index%2?'Packaging':'Consumables',currentStock:20,uom:'piece'}));
    items.push({id:'ingredient',name:'Ingredient',category:'Ingredients',currentStock:10});
    const h=harness(items);await h.window.loadConsumablesView();
    assert.equal(h.window.consumablesData.length,65);assert.equal((h.nodes.consumablesItemGrid.innerHTML.match(/class="item-card cons-ultra-card"/g)||[]).length,65);
    assert.match(h.nodes.consumablesItemGrid.innerHTML,/Supply 64/);assert.doesNotMatch(h.nodes.consumablesItemGrid.innerHTML,/Ingredient/);
    assert.deepEqual(h.reads,[{table:'settings',id:'global_pos_config'},{branch:'Maa'}]);assert.deepEqual(h.writes,[]);assert.equal(h.window.consumablesCart,h.cart);
});

test('Category changes reveal all matching cards and returning to All retains the selected store-use draft',()=>{
    const h=harness([{category:'Packaging'},{category:'Consumables'},{category:'Packaging'}]);
    h.window.filterConsumables('Packaging',h.nodes.btnTabConsNew);assert.deepEqual(h.cards.map(card=>card.style.display),['flex','none','flex']);
    h.window.filterConsumables('All',h.nodes.btnTabConsNew);assert.deepEqual(h.cards.map(card=>card.style.display),['flex','flex','flex']);
    assert.equal(h.window.consumablesCart,h.cart);assert.equal(h.cart[0].qty,2);assert.deepEqual(h.writes,[]);
});

test('History and New navigation hide only the correct panel and retain the cart without inventory writes',()=>{
    const h=harness();h.window.switchConsumablesTab('History');
    assert.equal(h.nodes.consumablesTabNew.style.display,'none');assert.equal(h.nodes.consumablesTabHistory.style.display,'block');assert.equal(h.nodes.consumablesCartPanel.style.display,'none');assert.equal(h.historyReads,1);
    h.window.switchConsumablesTab('New');assert.equal(h.nodes.consumablesTabNew.style.display,'block');assert.equal(h.nodes.consumablesTabHistory.style.display,'none');assert.equal(h.nodes.consumablesCartPanel.style.display,'flex');
    assert.equal(h.window.consumablesCart,h.cart);assert.equal(h.historyReads,1);assert.deepEqual(h.writes,[]);
});

test('A failed Consumables refresh reports the failure and retains an unsaved selection',async()=>{
    const h=harness();h.window.fetchCachedInventory=async()=>{throw Error('Offline test');};await h.window.loadConsumablesView();
    assert.match(h.nodes.consumablesItemGrid.innerHTML,/Error loading consumables/);assert.equal(h.window.consumablesCart,h.cart);assert.equal(h.cart[0].qty,2);assert.deepEqual(h.writes,[]);
});
