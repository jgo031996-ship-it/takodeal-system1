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

test('actual Manual Count saves base stock and a frozen whole/loose count separately from the restock request',async()=>{
    const h=harness([{...chicken}],{chicken_purch:'1',chicken_base:'250'});await h.window.submitAllManualCounts();
    assert.deepEqual(h.writes.filter(row=>row.action==='update'),[{action:'update',collection:'inventory',id:'chicken',payload:{currentStock:1250}}]);
    const log=h.writes.find(row=>row.collection==='stock_logs').payload;
    assert.equal(log.oldQty,1500);assert.equal(log.newQty,1250);assert.equal(log.variance,-250);assert.equal(log.uom,'Gram');
    assert.deepEqual(log.countSnapshot,{version:1,baseUom:'Gram',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:250,totalBaseQty:1250});
    const request=h.writes.find(row=>row.collection==='purchase_orders').payload;
    assert.equal(request.branch,'Maa');assert.equal(request.items.length,1);
    const row=request.items[0];assert.equal(row.qty,2000);assert.equal(row.rawQty,2);assert.equal(row.displayQty,2);assert.equal(row.physicalStock,1250);assert.equal(row.systemStock,1500);
    assert.deepEqual(row.countSnapshot,log.countSnapshot);assert.equal(stockReportQuantities(row).reported.text,'1 Pack + 250 Gram');assert.equal(stockReportQuantities(row).requested.text,'2 Pack');
    assert.deepEqual(h.removed,['takodeal_stock_count_memory']);assert.equal(h.nodes.manualCountSearch.value,'');assert.equal(h.refreshes,1);assert.equal(h.nodes.btnSubmitAllCounts.disabled,false);
});
test('submission freezes units before the first write so a concurrent catalog refresh cannot change its saved request conversion',async()=>{
    const item={...chicken,id:'second'};const h=harness([{...chicken},item],{chicken_purch:'1',second_purch:'1'},()=>{item.conversionRate=500;item.purchaseUom='Carton';item.uom='Milliliter';});
    await h.window.submitAllManualCounts();const row=h.writes.find(write=>write.collection==='purchase_orders').payload.items[1];
    assert.equal(row.physicalStock,1000);assert.equal(row.qty,2000);assert.equal(row.rawQty,2);assert.equal(row.displayUom,'Pack');assert.equal(row.uom,'Gram');assert.equal(row.countSnapshot.conversionRate,1000);
});
test('one invalid count rejects the complete preparation before any stock, log or request write',async()=>{
    const h=harness([{...chicken},{...chicken,id:'bad'}],{chicken_purch:'1',bad_purch:'-1'});await h.window.submitAllManualCounts();
    assert.deepEqual(h.writes,[]);assert.deepEqual(h.removed,[]);assert.equal(h.window.stockCountMemory.chicken_purch,'1');assert.equal(h.refreshes,0);assert.equal(h.nodes.btnSubmitAllCounts.disabled,false);
    assert.equal(h.dialogs[0][0],'Check Stock Count');
});
test('zero physical count stays zero, blank rows stay unreported and a count above par creates no request',async()=>{
    const h=harness([{...chicken},{...chicken,id:'enough'},{...chicken,id:'blank'}],{chicken_base:'0',enough_purch:'4'});await h.window.submitAllManualCounts();
    assert.deepEqual(h.writes.filter(row=>row.action==='update').map(row=>row.payload.currentStock),[0,4000]);
    const request=h.writes.find(row=>row.collection==='purchase_orders').payload;assert.equal(request.items.length,1);assert.equal(request.items[0].physicalStock,0);assert.equal(request.items[0].qty,3000);
    assert.equal(stockReportQuantities(request.items[0]).reported.text,'0 Gram');assert.equal(h.writes.filter(row=>row.collection==='stock_logs').length,2);
});
test('ordinary single-unit physical count saves correct stock without an automatic request',async()=>{
    const h=harness([{id:'cup',name:'Cup',uom:'Piece',currentStock:5,maintainingStock:0}],{cup_base:'7'});await h.window.submitAllManualCounts();
    assert.equal(h.writes[0].payload.currentStock,7);const log=h.writes[1].payload;assert.equal(log.variance,2);assert.equal(log.countSnapshot.totalBaseQty,7);assert.equal(log.countSnapshot.conversionRate,1);
    assert.equal(h.writes.some(row=>row.collection==='purchase_orders'),false);
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
