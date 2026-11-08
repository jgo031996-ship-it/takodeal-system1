import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createCountSnapshot,stockReportQuantities} from '../Takodeal-POS/stock-report-units.js';

const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
function section(start,end) {
    const at=source.indexOf(start),stop=source.indexOf(end,at);
    assert.ok(at>=0 && stop>at);return source.slice(at,stop);
}
const submitCode=section('window.submitAllManualCounts = async function() {','window.filterStockReq = function() {');
const modalCode=section('window.viewStockRequestItems = function(encodedOrder)','// 📡 REAL-TIME SYNC ENGINE');
const copy=value=>JSON.parse(JSON.stringify(value));
function harness(items=[],memory={},updateHook=()=>{}) {
    const writes=[],dialogs=[],removed=[],nodes={btnSubmitAllCounts:{innerHTML:'Submit counts',disabled:false},manualCountSearch:{value:'Chicken'}};
    let refreshes=0;
    const window={db:{},sessionUser:{branch:'Maa',cashierName:'QA cashier'},currentStockChecklist:items,stockCountMemory:{...memory},
        doc:(_db,collection,id)=>({collection,id}),collection:(_db,collection)=>({collection}),serverTimestamp:()=>({qaTimestamp:true}),
        async updateDoc(ref,payload){writes.push({action:'update',...ref,payload:copy(payload)});await updateHook(ref,payload);},
        async addDoc(ref,payload){writes.push({action:'add',...ref,payload:copy(payload)});return {id:'QA'};},
        loadStockRequestUI(){refreshes++;}};
    const context=vm.createContext({window,document:{getElementById:id=>nodes[id]||null},localStorage:{removeItem:key=>removed.push(key)},
        Swal:{fire:(...args)=>{dialogs.push(args);return Promise.resolve({});}},console:{error(){}},createCountSnapshot,stockReportQuantities});
    vm.runInContext(submitCode+modalCode,context);
    return {window,writes,dialogs,removed,nodes,get refreshes(){return refreshes;},render(order){window.viewStockRequestItems(encodeURIComponent(JSON.stringify(order)));return dialogs.at(-1)[0].html;}};
}
const chicken={id:'chicken',name:'Chicken Powder',uom:'Gram',purchaseUom:'Pack',conversionRate:1000,currentStock:1500,maintainingStock:3000};

test('retired legacy submission cannot bypass the secure count engine or silently create requests',async()=>{
    const memory={chicken_purch:'1',chicken_base:'250'},h=harness([{...chicken}],memory);await h.window.submitAllManualCounts();
    assert.deepEqual(h.writes,[]);assert.deepEqual(h.removed,[]);assert.deepEqual(h.window.stockCountMemory,memory);assert.equal(h.refreshes,0);assert.equal(h.dialogs[0][0],'Stock Report is starting');
});

test('actual report modal recovers legacy package ratios without rewriting base fields or confusing the count and requested deficit',()=>{
    const h=harness(),order={status:'Pending',items:[
        {name:'Chicken Powder',physicalStock:1000,qty:1000,rawQty:1,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack'},
        {name:'F1',physicalStock:100000,qty:50000,rawQty:1,uom:'Gram',purchaseUom:'Sack',displayUom:'Sack'}
    ]},before=JSON.stringify(order),html=h.render(order);
    assert.match(html,/Reported Count \/ Restock/);assert.match(html,/Reported:<\/span> 1 Pack/);assert.match(html,/Equivalent stock: 1,000 Gram/);assert.match(html,/Reported:<\/span> 2 Sack/);assert.match(html,/Restock requested: 1 Sack/);
    assert.doesNotMatch(html,/1,000 Pack|50,000 Sack/);assert.equal(JSON.stringify(order),before);assert.deepEqual(h.writes,[]);
});
test('missing conversion shows retained base stock and ordinary requests do not invent a physical count',()=>{
    const h=harness(),html=h.render({items:[
        {name:'Legacy Chicken',physicalStock:1000,qty:1000,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack'},
        {name:'Ordinary request',qty:5,uom:'Piece'},
        {name:'Emergency audit',physicalStock:1000,qty:0,rawQty:0,uom:'Gram',purchaseUom:'Pack',displayUom:'Pack',displayQty:1,convRate:1000}
    ]});
    assert.match(html,/Reported:<\/span> 1,000 Gram/);assert.match(html,/Package conversion was not retained/);assert.match(html,/Physical count not recorded/);assert.match(html,/Restock requested: 5 Piece/);
    assert.match(html,/Restock requested: 0 Gram/);assert.doesNotMatch(html,/Reported:<\/span> 1,000 Pack|Restock requested: 1 Pack/);assert.deepEqual(h.writes,[]);
});
test('report modal escapes both item names and saved unit labels',()=>{
    const h=harness(),html=h.render({items:[{name:'<img src=x onerror=alert(1)>',qty:2,physicalStock:2,uom:'<svg onload=alert(1)>'}]});
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/2 &lt;svg onload=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img|<svg/);assert.deepEqual(h.writes,[]);
});
