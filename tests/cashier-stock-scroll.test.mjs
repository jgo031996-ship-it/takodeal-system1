import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
const page=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
function section(text,start,end){const at=text.indexOf(start),stop=text.indexOf(end,at);assert.ok(at>=0&&stop>at);return text.slice(at,stop);}
const countCode=section(source,'window.stockCountMemory = JSON.parse','// 🛡️ ANTI-SLEEP');
function harness(items=[]){
    const saved=new Map([['takodeal_device_branch','Maa'],['takodeal_stock_count_memory',JSON.stringify({'item-64_base':'17','item-0_purch':'2'})]]);
    const nodes=Object.fromEntries(['manualStockCountBody','manualCountSearch','manualCountCycleFilter','stockReqTabNew','stockReqTabHistory','btnTabReqNew','btnTabReqHist','topBarTitle'].map(id=>[id,{style:{},innerHTML:'',value:id==='manualCountCycleFilter'?'All':''}]));
    const classes=()=>({values:new Set(['visible-row']),add(v){this.values.add(v);},remove(v){this.values.delete(v);},contains(v){return this.values.has(v);}});
    const rows=items.filter(i=>i.allowRequest!==false).map(i=>({item:i,style:{},classList:classes(),draft:{value:'keep'},getAttribute:key=>key==='data-name'?i.name.toLowerCase():i.restockCycle||'Monthly'}));
    const category={style:{},querySelectorAll:()=>rows.filter(r=>r.classList.contains('visible-row'))};
    const cycle={style:{},querySelectorAll:()=>[category]};
    const reads=[],writes=[];let historyReads=0;
    const window={sessionUser:{branch:'Maa'},consumablesCart:[{id:'draft',qty:2}],fetchCachedInventory:async branch=>{reads.push(branch);return items;},loadStockRequestHistory(){historyReads++;},stopShiftSalesFeed(){},updateDoc(){writes.push('update');},addDoc(){writes.push('add');}};
    const views=['pos','stockreq','consumables'].map(id=>({id:'view-'+id,classList:classes()}));views.forEach(v=>{nodes[v.id]=v;v.classList.remove('active');});
    const document={getElementById:id=>nodes[id],querySelectorAll:selector=>selector==='.manual-count-row'?rows:selector==='.manual-count-category'?[category]:selector==='.manual-count-cycle-section'?[cycle]:selector==='.view-container'?views:[]};
    const context=vm.createContext({window,document,localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},currentShift:{id:'QA'},console:{error(){}}});
    vm.runInContext(countCode,context);
    return {window,nodes,rows,category,cycle,reads,writes,saved,context,get historyReads(){return historyReads;}};
}

test('Manual Count renders every eligible branch item and restores both saved count units without stock writes',async()=>{
    const items=Array.from({length:75},(_,i)=>({id:'item-'+i,name:'Item '+String(i).padStart(2,'0'),category:i%2?'Packaging':'Ingredients',restockCycle:'Monthly',uom:'piece',purchaseUom:'pack',conversionRate:10}));
    items.push({id:'excluded',name:'Excluded',allowRequest:false});
    const h=harness(items);await h.window.loadStockRequestUI();
    assert.equal(h.window.currentStockChecklist.length,75);assert.equal((h.nodes.manualStockCountBody.innerHTML.match(/class="manual-count-row visible-row"/g)||[]).length,75);
    assert.match(h.nodes.manualStockCountBody.innerHTML,/id="countBase_item-64" value="17"/);assert.match(h.nodes.manualStockCountBody.innerHTML,/id="countPurch_item-0" value="2"/);
    assert.match(h.nodes.manualStockCountBody.innerHTML,/Item 74/);assert.doesNotMatch(h.nodes.manualStockCountBody.innerHTML,/Excluded/);
    assert.deepEqual(h.reads,['Maa']);assert.deepEqual(h.writes,[]);
});
test('Search and cycle filtering change visibility without discarding typed counts',()=>{
    const h=harness([{id:'a',name:'Milk Tea',restockCycle:'Weekly'},{id:'b',name:'Paper Bowl',restockCycle:'Monthly'}]);
    const drafts=h.rows.map(r=>r.draft);h.nodes.manualCountSearch.value='paper';h.window.filterManualStockCount();assert.deepEqual(h.rows.map(r=>r.style.display),['none','']);
    h.nodes.manualCountCycleFilter.value='Weekly';h.window.filterManualStockCount();assert.equal(h.category.style.display,'none');assert.equal(h.cycle.style.display,'none');
    h.nodes.manualCountSearch.value='';h.nodes.manualCountCycleFilter.value='All';h.window.filterManualStockCount();assert.deepEqual(h.rows.map(r=>r.style.display),['','']);
    assert.equal(h.rows[0].draft,drafts[0]);assert.equal(h.rows[1].draft.value,'keep');assert.deepEqual(h.writes,[]);
});
test('Typing and clearing a single count preserves the other unit and survives a list refresh',async()=>{
    const h=harness([{id:'item-0',name:'Item 00',uom:'piece',purchaseUom:'pack',conversionRate:10}]);
    h.window.saveCountMemory('item-0','base','23');h.window.saveCountMemory('item-0','purch','');await h.window.loadStockRequestUI();
    const stored=JSON.parse(h.saved.get('takodeal_stock_count_memory'));assert.equal(stored['item-0_base'],'23');assert.equal(stored['item-0_purch'],undefined);
    assert.match(h.nodes.manualStockCountBody.innerHTML,/id="countBase_item-0" value="23"/);assert.match(h.nodes.manualStockCountBody.innerHTML,/id="countPurch_item-0" value=""/);assert.deepEqual(h.writes,[]);
});
test('History and page navigation leave count DOM, count memory and consumables cart intact',()=>{
    const h=harness();h.nodes.manualStockCountBody.innerHTML='keep count inputs';const memory=h.window.stockCountMemory,cart=h.window.consumablesCart;
    h.window.switchStockReqTab('History');assert.equal(h.historyReads,1);assert.equal(h.nodes.stockReqTabNew.style.display,'none');
    h.window.switchStockReqTab('New');assert.equal(h.nodes.stockReqTabNew.style.display,'block');assert.equal(h.nodes.manualStockCountBody.innerHTML,'keep count inputs');
    vm.runInContext(section(page,'    function switchView(viewName)','    function closeModal(id)'),h.context);
    vm.runInContext("switchView('consumables'); switchView('stockreq');",h.context);
    assert.equal(h.nodes['view-stockreq'].classList.contains('active'),true);assert.equal(h.nodes['view-consumables'].classList.contains('active'),false);
    assert.equal(h.window.stockCountMemory,memory);assert.equal(h.window.consumablesCart,cart);assert.deepEqual(h.writes,[]);
});
test('A failed refresh retains saved count memory for the next successful load',async()=>{
    const h=harness();const memory=h.window.stockCountMemory;h.window.fetchCachedInventory=async()=>{throw Error('Offline');};await h.window.loadStockRequestUI();
    assert.match(h.nodes.manualStockCountBody.innerHTML,/Database Error/);assert.equal(h.window.stockCountMemory,memory);assert.equal(memory['item-64_base'],'17');assert.deepEqual(h.writes,[]);
});
test('Delivery History keeps all completed groups and uses the scoped viewport scroll dialog without writes',async()=>{
    const h=harness();const options=[];const queryCalls=[];
    Object.assign(h.window,{db:{},collection:(_db,name)=>({name}),where:(...args)=>({where:args}),query:(...args)=>{queryCalls.push(args);return args;},getDocs:async()=>({forEach:fn=>Array.from({length:55},(_,i)=>({id:'d-'+i,data:()=>({dispatchId:'batch-'+i,date:'Oct 7',driver:'QA',receivedBy:'QA cashier',receivedAt:{toDate:()=>new Date(2026,9,7,12,i)},item:'Delivery '+i,qty:1,uom:'piece',status:i===54?'Pending':'Received'})})).forEach(fn)})});
    h.context.Swal={fire:optionsValue=>options.push(optionsValue),showLoading(){}};
    vm.runInContext(section(source,'window.openDeliveryHistoryModal = async function','// 🗑️ UPGRADED WASTE'),h.context);
    await h.window.openDeliveryHistoryModal();const result=options.at(-1);
    assert.match(result.customClass.popup,/cashier-stock-delivery-popup/);assert.match(result.html,/cashier-stock-delivery-list/);assert.equal((result.html.match(/Dispatched:/g)||[]).length,54);assert.match(result.html,/Delivery 53/);assert.doesNotMatch(result.html,/Delivery 54/);
    assert.deepEqual(JSON.parse(JSON.stringify(queryCalls)),[[{name:'dispatch_logs'},{where:['toBranch','==','Maa']}]]);assert.deepEqual(h.writes,[]);
});
