import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {snapshotPayrollDeductionRows,payslipDeductionBreakdown,payslipDeductionSummaryHTML,payslipDeductionDetailsHTML,deductionEntryHTML} from '../takodeal-staff/payroll-deduction-details.js';
const legacy=()=>({name:'Sample Staff',staffId:'sample-staff',start:'2030-01-01',end:'2030-01-15',basicPay:4000,nightBonus:350,meals:534.5,customDeductionsTotal:218,profile:{customDeductions:[{name:'Wi-Fi',amount:50},{name:'Cancelled Orders',amount:168}]},isPaid:true,finalNetPay:3597.5});
test('an older paid snapshot separates meals, Wi-Fi and cancelled orders without altering the total or borrowing current charges',()=>{
 const saved=legacy(),before=structuredClone(saved),breakdown=payslipDeductionBreakdown(saved);
 assert.equal(breakdown.total,752.5);assert.deepEqual(breakdown.groups.map(row=>[row.label,row.amount]),[['Meals and cancelled food purchases',534.5],['Wi-Fi',50],['Cancelled Orders',168]]);
 const html=payslipDeductionDetailsHTML(saved);assert.match(html,/Wi-Fi/);assert.match(html,/₱50\.00/);assert.match(html,/Cancelled Orders/);assert.match(html,/₱168\.00/);assert.match(html,/₱534\.50/);assert.match(html,/₱752\.50/);assert.match(html,/without individual receipt details/);assert.doesNotMatch(html,/326\.25|208\.25/);assert.deepEqual(saved,before);
 assert.equal(payslipDeductionBreakdown({frozenData:saved,profile:{customDeductions:[{name:'TODAY ONLY',amount:9999}]}}).total,752.5);
});
test('frozen partial-food purchases retain selected items, source receipts, discount and amounts while dropping private fields',()=>{
 const rows=[{id:'purchase-1',type:'Cancelled Food Purchase',amount:120,originalAmount:160,sourcePlatform:'Grab',sourceReceiptId:'SAMPLE-OR',receiptId:'CF-SAMPLE-1',discountPct:25,pin:'PRIVATE PIN',bank:'PRIVATE BANK',purchasedItems:[{name:'Mango shake',qty:1,amount:60,size:'M',notes:'No ice',addons:[{name:'Pearls',price:10}],sourceLineIndex:0},{name:'Bonito takoyaki',qty:1,amount:60,sourceLineIndex:1}]}];
 const frozen=snapshotPayrollDeductionRows(rows,[{id:'purchase-1',taken:120}]);const data={meals:120,deductionDetailsVersion:1,deductionDetails:frozen};
 const html=payslipDeductionDetailsHTML(data);assert.equal(payslipDeductionBreakdown(data).total,120);assert.match(html,/1 × Mango shake/);assert.match(html,/1 × Bonito takoyaki/);assert.match(html,/Grab/);assert.match(html,/SAMPLE-OR/);assert.match(html,/CF-SAMPLE-1/);assert.match(html,/25% staff discount/);assert.match(html,/Pearls/);assert.match(html,/No ice/);assert.doesNotMatch(JSON.stringify(frozen),/PRIVATE/);
 rows[0].purchasedItems[0].qty=99;assert.equal(frozen[0].items[0].qty,1);
});
test('a partially settled food amount uses only the amount collected and flags inconsistent receipt evidence instead of presenting it as an exact breakdown',()=>{
 const saved=snapshotPayrollDeductionRows([{id:'food',type:'Staff Meal (POS Auto)',amount:200,item:'2x Sample meal'}],[{id:'food',taken:50}]);assert.equal(saved[0].amount,50);
 const exact=payslipDeductionBreakdown({meals:50,deductionDetailsVersion:1,deductionDetails:saved});assert.equal(exact.groups[0].entries[0].amount,50);
 const mismatch=payslipDeductionBreakdown({meals:75,deductionDetailsVersion:1,deductionDetails:saved});assert.equal(mismatch.groups[0].entries.length,0);assert.equal(mismatch.total,75);assert.match(mismatch.groups[0].note,/without individual receipt details/);
});
test('cancelled-food add-ons are identified as original receipt options without implying the original extra quantity was purchased',()=>{
 const rows=[{id:'portion',type:'Cancelled Food Purchase',amount:60,purchasedItems:[{name:'Mango shake',qty:1,amount:60,addons:[{name:'Pearls',qty:2}]}]}];
 const frozen=snapshotPayrollDeductionRows(rows,[{id:'portion',taken:60}]),html=payslipDeductionDetailsHTML({meals:60,deductionDetailsVersion:1,deductionDetails:frozen});
 assert.match(html,/1 × Mango shake/);assert.match(html,/Original receipt options: Pearls/);assert.match(html,/Options describe the original receipt line; quantities shown apply to the selected food/);assert.doesNotMatch(html,/2 × Pearls|2x Pearls/);assert.deepEqual(frozen[0].items[0].addons,['Pearls']);
 const ordinary=deductionEntryHTML({type:'Staff Meal',amount:60,items:[{name:'Shake',qty:1,addons:['Pearls']}]});assert.doesNotMatch(ordinary,/Original receipt options|Options describe/);
});
test('actual POS object-map options retain names and key fallbacks without carrying original quantities into selected purchase quantities',()=>{
 const rows=[{id:'object-options',type:'Cancelled Food Purchase',amount:60,purchasedItems:[{name:'Mango shake',qty:1,amount:60,addons:{Cream:{name:'Sweet cream',qty:2,price:5},Pearls:{qty:3,price:10},'Named string':'Extra mango',Excluded:false}}]}];
 const frozen=snapshotPayrollDeductionRows(rows,[{id:'object-options',taken:60}]),html=payslipDeductionDetailsHTML({meals:60,deductionDetailsVersion:1,deductionDetails:frozen});
 assert.deepEqual(frozen[0].items[0].addons,['Sweet cream','Pearls','Extra mango']);assert.match(html,/Original receipt options: Sweet cream, Pearls, Extra mango/);assert.match(html,/Options describe the original receipt line/);assert.doesNotMatch(html,/2 × Sweet cream|3 × Pearls|Excluded/);assert.match(html,/1 × Mango shake/);
});
test('a legacy custom total without saved matching labels remains explicit and never fabricates names',()=>{
 const data={customDeductionsTotal:218,profile:{customDeductions:[{name:'Wrong current amount',amount:300}]}};const result=payslipDeductionBreakdown(data);assert.equal(result.total,218);assert.equal(result.groups.length,1);assert.equal(result.groups[0].label,'Other saved custom deductions');assert.doesNotMatch(payslipDeductionDetailsHTML(data),/Wrong current amount/);
});
test('deduction labels, receipt evidence, notes and item variants are escaped',()=>{
 const html=payslipDeductionDetailsHTML({meals:1,customDeductions:[{name:'<img src=x onerror=alert(1)>',amount:1}],deductionDetailsVersion:1,deductionDetails:[{id:'a',bucket:'meals',amount:1,type:'<script>',sourcePlatform:'Grab<img>',sourceReceiptId:'"><img>',purchasedItems:[{name:'<svg onload=x>',variantName:'<script>',qty:1,notes:'<img>',addons:['<iframe>']}]}]});
 assert.doesNotMatch(html,/<img|<script|<svg|<iframe/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);
});
test('cent arithmetic keeps saved custom and statutory deductions exact and does not conflate refunds with voluntary food purchases',()=>{
 const result=payslipDeductionBreakdown({sss:.1,philhealth:.2,pagibig:.3,meals:10,onlineRefunds:20,cashShortages:30,customDeductions:[{name:'Wi-Fi',amount:50}]});assert.equal(result.total,110.6);assert.deepEqual(result.groups.filter(row=>['meals','onlineRefunds','cashShortages'].includes(row.key)).map(row=>row.amount),[10,20,30]);
});
test('invalid, duplicate and missing allocations cannot create a frozen receipt detail',()=>{
 const row={id:'a',type:'Staff Meal',amount:100};for(const allocations of [[{id:'a',taken:101}],[{id:'missing',taken:1}],[{id:'a',taken:1},{id:'a',taken:2}],[{id:'a',taken:0}],[{id:'a',taken:NaN}]])assert.throws(()=>snapshotPayrollDeductionRows([row],allocations));
});
async function actualPayslipFunction(name,endMarker){
 const app=await readFile(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),start=app.indexOf(`window.${name} = function`),end=app.indexOf(endMarker,start);
 assert.ok(start>0&&end>start);const script=app.slice(start,end);let shown;
 const sandbox={window:{staffVaultSession:{epoch:1,allows:()=>true}},localStorage:{getItem:()=> 'sample-staff'},document:{},payslipDeductionBreakdown,payslipDeductionSummaryHTML,payslipDeductionDetailsHTML,Swal:{fire:options=>{shown=options;return Promise.resolve({isConfirmed:false});}},console};
 vm.runInNewContext(script,sandbox);return {call:async data=>{await sandbox.window[name]('id',encodeURIComponent(JSON.stringify(data)));return shown;},view:async data=>{await sandbox.window[name](encodeURIComponent(JSON.stringify(data)));return shown;}};
}
test('the actual acknowledgment dialog presents saved custom names and preserves the paid net amount',async()=>{
 const fn=await actualPayslipFunction('openPayslipSignatureModal','// ========================================================\n// 💳 STAFF APP: MY LOAN LEDGER VIEWER');const result=await fn.call({...legacy(),perfBonus:25});
 assert.match(result.html,/Wi-Fi/);assert.match(result.html,/Cancelled Orders/);assert.match(result.html,/3,597\.50/);assert.match(result.html,/₱4375\.00/);assert.doesNotMatch(result.html,/Vales\/Meals/);
});
test('the actual full payslip includes readable saved detail and receipt items rather than a Foods/Penalties lump',async()=>{
 const fn=await actualPayslipFunction('viewPastPayslip','// 🔥 NEW: DEDICATED IMAGE DOWNLOADER');const result=await fn.view({...legacy(),perfBonus:25});
 assert.match(result.html,/Wi-Fi/);assert.match(result.html,/Cancelled Orders/);assert.match(result.html,/3,597\.50/);assert.match(result.html,/4375\.00/);assert.doesNotMatch(result.html,/Foods \/ Penalties/);
});
test('Staff and HQ freeze the same public deduction-detail schema',async()=>{assert.equal(await readFile(new URL('../takodeal-staff/payroll-deduction-details.js',import.meta.url),'utf8'),await readFile(new URL('../takodeal-manager/payroll-deduction-details.js',import.meta.url),'utf8'));});
