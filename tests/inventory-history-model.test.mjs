import test from 'node:test';
import assert from 'node:assert/strict';
import {historyMillis,historyPeriod,historyInPeriod,historyNumber,historyDateLabel,normalizeInventoryHistory,summarizeInventoryHistory,historyBranch,safeHistoryProof,restockReversalPlan} from '../takodeal-manager/inventory-history-model.js';
import {inventoryHistoryRecordMarkup} from '../takodeal-manager/inventory-history-workspace.js';

test('history dates use inclusive Philippine days, including midnight boundaries',()=>{
 const range=historyPeriod('2026-10-15','2026-10-16');assert.equal(range.start.toISOString(),'2026-10-14T16:00:00.000Z');assert.equal(range.end.toISOString(),'2026-10-16T16:00:00.000Z');
 assert.equal(historyInPeriod({timestamp:new Date('2026-10-14T16:00:00Z')},range),true);assert.equal(historyInPeriod({timestamp:new Date('2026-10-16T16:00:00Z')},range),false);assert.equal(historyInPeriod({date:'2026-10-15'},range),true);
 assert.equal(historyMillis('2026-10-15'),Date.parse('2026-10-14T16:00:00Z'));assert.match(historyDateLabel('2026-10-15'),/time not recorded/);
});
test('invalid legacy timestamps and impossible dates never become now or zero',()=>{
 for(const value of [null,'',false,{},'2026-02-30','Oct 15','2026-10-15T09:00:00'])assert.equal(historyMillis(value),null);
 for(const [from,to] of [['2026-02-30','2026-03-01'],['2026-10-16','2026-10-15'],['2024-01-01','2026-01-01']])assert.throws(()=>historyPeriod(from,to));
 assert.equal(historyInPeriod({timestamp:null},historyPeriod('2026-10-15','2026-10-15')),false);
});
test('quantities and values preserve explicit zero but reject booleans, blanks and invalid numbers',()=>{
 for(const value of ['',null,false,true,[],{},NaN,Infinity])assert.equal(historyNumber(value),null);assert.equal(historyNumber(0),0);assert.equal(historyNumber('0'),0);
 const rows=normalizeInventoryHistory('Waste',{stock_logs:[{id:'a',branch:'Maa',type:'Waste',variance:0,valueLost:0},{id:'b',branch:'Maa',type:'Waste',variance:'bad',wasteCost:false}]});
 assert.equal(rows[0].quantity,0);assert.equal(rows[0].recordedValue,0);assert.equal(rows[1].quantity,null);assert.equal(rows[1].recordedValue,null);assert.equal(rows[1].estimatedValue,null);
});
test('waste source links deduplicate only linked events and retain genuinely separate identical losses',()=>{
 const stock=[{id:'one',branch:'Maa',item:'Sauce',type:'Waste',variance:-2,inventoryLogId:'linked'}],legacy=[{id:'linked',type:'Waste',branch:'Maa',item:'Sauce',quantity:2},{id:'backlink',stockLogId:'one',type:'Waste',branch:'Maa',quantity:2},{id:'two',type:'Waste',branch:'Maa',item:'Sauce',quantity:2}];
 const rows=normalizeInventoryHistory('Waste',{stock_logs:stock,inventory_logs:legacy});assert.deepEqual(rows.map(row=>row.key).sort(),['inventory_logs/two','stock_logs/one']);
});
test('waste totals separate recorded, saved-cost estimates and unpriced records without summing units',()=>{
 const rows=normalizeInventoryHistory('Waste',{stock_logs:[{id:'a',branch:'Maa',item:'Sauce',type:'Waste',variance:-1000,uom:'gram',valueLost:100},{id:'b',branch:'Maa',item:'Bowl',type:'Spoilage',variance:-2,uom:'piece',costSnapshot:{baseUnitCost:1.5}},{id:'c',branch:'Maa',item:'Bowl',type:'Waste',variance:-1,uom:'piece'}]});
 const [summary]=summarizeInventoryHistory(rows,['Maa'],{kind:'Waste'});assert.equal(summary.records,3);assert.equal(summary.itemCount,2);assert.equal(summary.recordedValue,100);assert.equal(summary.estimatedValue,3);assert.equal(summary.unknownValues,1);assert.equal('quantity' in summary,false);
});
test('invoice supplier references never determine the receiving branch',()=>{
 assert.equal(historyBranch({supplier:'CITYGATE'}),null);const rows=normalizeInventoryHistory('Invoices',{hq_restocks:[{id:'hq',branch:'Main Office',supplier:'CITYGATE',totalCost:100,items:[]},{id:'unknown',supplier:'Maa',totalCost:5,items:[]}]});
 assert.equal(rows.find(row=>row.id==='hq').branch,'Main Office');assert.equal(rows.find(row=>row.id==='unknown').branch,null);
 const groups=summarizeInventoryHistory(rows,['Main Office','Maa'],{kind:'Invoices'});assert.equal(groups.find(row=>row.branch==='Maa').records,0);assert.equal(groups.find(row=>row.branch===null).recordedValue,5);
});
test('dispatch estimates remain separate from supplier purchases and conflicting totals stay unpriced',()=>{
 const rows=normalizeInventoryHistory('Invoices',{hq_restocks:[{id:'paid',branch:'Main Office',totalCost:25,items:[{name:'Bowl',qty:1,purchUom:'Pack',subtotal:25}]},{id:'auto',branch:'Main Office',dispatchAutoRestock:true,dispatchBatchId:'d',totalCost:50,items:[{name:'Bowl',purchaseQty:2,purchaseUom:'Pack',estimatedSubtotal:50}]},{id:'bad',branch:'Main Office',dispatchAutoRestock:true,dispatchBatchId:'e',totalCost:100,items:[{name:'Bowl',estimatedSubtotal:10}]},{id:'undo',branch:'Main Office',status:'Reverted',totalCost:200,items:[]}]});
 const [group]=summarizeInventoryHistory(rows,['Main Office'],{kind:'Invoices'});assert.equal(group.recordedValue,25);assert.equal(group.estimatedValue,50);assert.equal(group.partialEstimate,10);assert.equal(group.unknownValues,1);assert.equal(group.revertedRecords,1);
});
test('history HTML escapes names, notes and references and rejects unsafe proofs',()=>{
 const rows=normalizeInventoryHistory('Waste',{stock_logs:[{id:'id',branch:'Maa',item:'<img src=x onerror=1>',type:'Waste',variance:-1,note:'<script>1</script>',photoUrl:'javascript:alert(1)'}]});
 const html=inventoryHistoryRecordMarkup(rows[0],'Waste',0);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script|javascript:/);
 for(const value of ['javascript:alert(1)','http://example.test/p.jpg','data:text/html;base64,abc','https://user:pass@example.test/a.png'])assert.equal(safeHistoryProof(value),'');assert.equal(safeHistoryProof('https://example.test/proof.jpg'),'https://example.test/proof.jpg');
});
const before={name:'Sauce',branch:'Main Office',category:'Prepared Batch',uom:'gram',purchaseUom:'Gallon',conversionRate:1000,currentStock:20,baseCost:1},after={...before,currentStock:1020,baseCost:2,purchaseCost:2000,purchCost:2000,cost:2000};
const invoice=()=>({id:'invoice',version:2,branch:'Main Office',inventoryEffects:[{inventoryId:'hq',before:{...before},after:{...after}}]});
test('guarded reversal restores only the recorded cost and stock fields, retaining unrelated settings',()=>{
 const [plan]=restockReversalPlan(invoice(),[{id:'hq',...after,maintainingStock:5000,restockCycle:'Monthly'}]);assert.equal(plan.restored.currentStock,20);assert.equal(plan.restored.baseCost,1);assert.equal(plan.restored.maintainingStock,5000);assert.equal(plan.restored.restockCycle,'Monthly');assert.equal(Object.hasOwn(plan.restored,'purchaseCost'),false);
});
test('legacy, delivery-linked and already-reverted invoices cannot use reversal',()=>{
 for(const row of [{id:'x',items:[]},{...invoice(),dispatchBatchId:'d'},{...invoice(),status:'Reverted'},{...invoice(),branch:'Maa'}])assert.throws(()=>restockReversalPlan(row,[{id:'hq',...after}]));
});
test('reversal refuses later stock/cost/unit changes, missing rows, duplicate effects and invalid snapshots',()=>{
 for(const patch of [{currentStock:1019},{baseCost:3},{conversionRate:2000},{branch:'Maa'}])assert.throws(()=>restockReversalPlan(invoice(),[{id:'hq',...after,...patch}]));
 assert.throws(()=>restockReversalPlan(invoice(),[]));const duplicate=invoice();duplicate.inventoryEffects.push(duplicate.inventoryEffects[0]);assert.throws(()=>restockReversalPlan(duplicate,[{id:'hq',...after}]));
 const invalid=invoice();invalid.inventoryEffects[0].before.baseCost=null;assert.throws(()=>restockReversalPlan(invalid,[{id:'hq',...after}]));
});
test('a recorded negative prior balance is restored honestly rather than wiped to zero',()=>{
 const row=invoice();row.inventoryEffects[0].before.currentStock=-10;const [plan]=restockReversalPlan(row,[{id:'hq',...after}]);assert.equal(plan.restored.currentStock,-10);
});

test('identical dispatch estimate copies count once; conflicting copies are unpriced',()=>{
 const common={branch:'Main Office',timestamp:new Date('2026-10-15T10:00:00Z'),dispatchAutoRestock:true,dispatchBatchId:'d',totalCost:10,items:[{name:'Bowl',purchaseQty:1,purchaseUom:'Pack',estimatedSubtotal:10}]};
 const same=normalizeInventoryHistory('Invoices',{hq_restocks:[{...common,id:'one'},{...common,id:'two'}]});assert.equal(same.length,1);assert.equal(same[0].estimatedValue,10);assert.equal(same[0].duplicateCount,1);
 const conflict=normalizeInventoryHistory('Invoices',{hq_restocks:[{...common,id:'one'},{...common,id:'two',totalCost:20}]});assert.equal(conflict.length,1);assert.equal(conflict[0].estimatedValue,null);assert.equal(conflict[0].partialEstimate,0);assert.equal(conflict[0].duplicateConflict,true);
});
test('corrupt invoice snapshots cannot move stock into another branch or rename an item',()=>{
 for(const patch of [{branch:'Maa'},{name:'Other item'}]){const row=invoice();Object.assign(row.inventoryEffects[0].before,patch);assert.throws(()=>restockReversalPlan(row,[{id:'hq',...after}]));}
});
