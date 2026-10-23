import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFranchisePayslip} from '../takodeal-franchise/franchise-payroll-model.js';
const branch='Sample Branch',staff={id:'sample-staff',branch,cashierName:'Sample Crew',hourlyRate:500};
const at=(day,time)=>`${day}T${time}:00+08:00`;
function punches(day='2026-10-01',id=staff.id){return [{id:'in-'+day,staffId:id,staffName:staff.cashierName,branch,type:'TIME IN',timestamp:at(day,'09:00'),scheduleSnapshot:{version:1,branch,staffName:staff.cashierName,shiftId:'m',shiftType:'Morning',wasScheduled:true,expectedStartAt:at(day,'09:00'),expectedEndAt:at(day,'17:30')}},{id:'out-'+day,staffId:id,staffName:staff.cashierName,branch,type:'TIME OUT',timeInLogId:'in-'+day,timestamp:at(day,'17:30')}];}
function input(patch={}){return {staff,profiles:[staff],branch,start:'2026-10-01',end:'2026-10-15',logs:punches(),schedule:{currentYear:2026,currentMonth:10,branchConfig:{[branch]:[{id:'m',name:'Morning',startTime:'09:00',endTime:'17:30',active:true}]},currentSchedule:{1:{[branch]:{scheduled:{m:'Sample Crew'}}},2:{[branch]:{scheduled:{m:'Sample Crew'}}}}},...patch};}
const row=(id,type,amount,extra={})=>({id,staffId:staff.id,staffName:staff.cashierName,branch,type,amount,status:'Unpaid',dateAdded:at('2026-10-01','10:00'),...extra});
const frozen={staffId:staff.id,name:'Original Saved Name',branch,start:'2026-10-01',end:'2026-10-15',isPaid:true,basicPay:4000,nightBonus:350,meals:534.5,customDeductionsTotal:218,profile:{staffId:staff.id,customDeductions:[{name:'Wi-Fi',amount:50},{name:'Cancelled Orders',amount:168}]},finalNetPay:3597.5};
const saved=(f=frozen)=>({id:'sample-paid',staffId:staff.id,staffName:f.name,branch,startDate:f.start,endDate:f.end,finalNetPay:f.finalNetPay,frozenData:structuredClone(f),processedAt:at('2026-10-16','11:00')});

test('uses the stored daily wage once per completed shift, rather than multiplying it by hours',()=>{
 const model=buildFranchisePayslip(input());assert.equal(model.kind,'estimate',JSON.stringify(model.reviewReasons));assert.equal(model.hours,8.5);assert.equal(model.totals.basic,500);assert.equal(model.totals.net,500);assert.equal(model.rateRows[0].dailyRate,500);assert.ok(Object.isFrozen(model));assert.ok(Object.isFrozen(model.totals));
});
test('dated wage increases apply to their own work dates',()=>{
 const person={...staff,salaryRateVersion:1,salaryRateTimeline:{version:1,revision:1,baselineDailyRate:450,rates:{increase:{dailyRate:480,effectiveDate:'2026-10-02',sequence:1}}}};
 const model=buildFranchisePayslip(input({staff:person,profiles:[person],logs:[...punches(),...punches('2026-10-02')]}));assert.equal(model.kind,'estimate',JSON.stringify(model.reviewReasons));assert.equal(model.totals.basic,930);assert.deepEqual(model.rateRows.map(row=>row.dailyRate),[450,480]);
});
test('names each fixed and ledger deduction and exposes selected cancelled food items',()=>{
 const person={...staff,sssAmount:30,customDeductions:[{name:'Wi-Fi',amount:10}]};
 const deductions=[row('meal','Staff Meal (POS Auto)',20),row('portion','Cancelled Food Purchase',30,{sourcePlatform:'Grab',sourceReceiptId:'SAMPLE-OR',purchasedItems:[{name:'Mango shake',qty:1,amount:15,addons:{Cream:{name:'Cream',qty:2}}},{name:'Bonito takoyaki',qty:1,amount:15}]}),row('advance','Cash Advance',20)];
 const model=buildFranchisePayslip(input({staff:person,profiles:[person],deductions,bonuses:[row('bonus','Performance bonus',100)]}));
 assert.equal(model.kind,'estimate',JSON.stringify(model.reviewReasons));assert.equal(model.totals.gross,600);assert.equal(model.totals.deductions,110);assert.equal(model.totals.net,490);assert.equal(model.deductionRows.find(row=>row.label==='Wi-Fi').amount,10);const food=model.deductionRows.find(row=>row.key==='meals');assert.equal(food.amount,50);assert.equal(food.details[1].platform,'Grab');assert.equal(food.details[1].receipt,'SAMPLE-OR');assert.deepEqual(food.details[1].items.map(row=>[row.name,row.qty]),[['Mango shake',1],['Bonito takoyaki',1]]);assert.equal(food.details[1].originalOptions,true);
});
test('a paid frozen record is authoritative despite current raises, broken punches and changed custom labels',()=>{
 const person={...staff,hourlyRate:9999,customDeductions:[{name:'Today label',amount:999}]},record=saved(),before=structuredClone(record);
 const model=buildFranchisePayslip(input({staff:person,profiles:[person],logs:[punches()[0]],payrollRecords:[record]}));
 assert.equal(model.kind,'paid');assert.equal(model.name,'Original Saved Name');assert.equal(model.totals.net,3597.5);assert.equal(model.totals.deductions,752.5);assert.deepEqual(model.deductionRows.filter(row=>row.key.startsWith('custom')).map(row=>[row.label,row.amount]),[['Wi-Fi',50],['Cancelled Orders',168]]);assert.deepEqual(record,before);assert.equal(model.rateRows.length,0);assert.match(model.deductionRows.find(row=>row.key==='meals').note,/older payslip/);assert.equal(model.hours,null);
});
test('legacy frozen totals never borrow current profile labels or fresh receipts',()=>{
 const old={...frozen,profile:{staffId:staff.id}},model=buildFranchisePayslip(input({staff:{...staff,customDeductions:[{name:'Today WiFi',amount:218}]},payrollRecords:[saved(old)],deductions:[row('new','Staff Meal',534.5)]}));
 assert.equal(model.kind,'paid');assert.equal(model.deductionRows.find(row=>row.key==='custom').label,'Other saved custom deductions');assert.equal(model.deductionRows.find(row=>row.key==='meals').details.length,0);assert.equal(model.totals.net,3597.5);
});
test('frozen receipt rows are displayed only when they reconcile to their saved bucket',()=>{
 const correct={...frozen,deductionDetailsVersion:1,deductionDetails:[{type:'Staff Meal',bucket:'meals',amount:534.5,sourceReceiptId:'SAVED-ONLY',purchasedItems:[{name:'Sample item',qty:2}]}]};
 assert.equal(buildFranchisePayslip(input({payrollRecords:[saved(correct)]})).deductionRows.find(row=>row.key==='meals').details[0].receipt,'SAVED-ONLY');
 const mismatch={...correct,deductionDetails:[{...correct.deductionDetails[0],amount:500}]};assert.equal(buildFranchisePayslip(input({payrollRecords:[saved(mismatch)]})).deductionRows.find(row=>row.key==='meals').details.length,0);
});
test('missing, duplicate and invalid-duration punches produce review without a net estimate',()=>{
 for(const logs of [[punches()[0]],[...punches(),{...punches()[0],id:'another-in'}],[punches()[0],{...punches()[1],timestamp:at('2026-10-02','06:00')}]]){const model=buildFranchisePayslip(input({logs}));assert.equal(model.kind,'held');assert.equal(model.totals.net,null);assert.equal(model.incomeRows.length,0);assert.equal(model.deductionRows.length,0);}
});
test('unique explicit-branch legacy identity works, while ambiguous names and missing branches require HQ',()=>{
 const legacy=punches().map(({staffId,...row})=>row);assert.equal(buildFranchisePayslip(input({logs:legacy})).kind,'estimate');
 assert.equal(buildFranchisePayslip(input({logs:legacy.map(({branch,...row})=>row)})).kind,'held');
 assert.equal(buildFranchisePayslip(input({logs:legacy,profiles:[staff,{...staff,id:'same-name'}]})).kind,'held');
 const explicitOther=[...punches(),...punches('2026-10-02','another-staff')],model=buildFranchisePayslip(input({logs:explicitOther}));assert.equal(model.kind,'estimate');assert.equal(model.totals.basic,500);
 const conflict=saved();conflict.frozenData.staffId='other';assert.equal(buildFranchisePayslip(input({payrollRecords:[conflict]})).kind,'held');
 const legacySaved=saved();delete legacySaved.staffId;delete legacySaved.frozenData.staffId;delete legacySaved.frozenData.profile.staffId;legacySaved.staffName=staff.cashierName;legacySaved.frozenData.name=staff.cashierName;assert.equal(buildFranchisePayslip(input({payrollRecords:[legacySaved]})).kind,'paid');assert.equal(buildFranchisePayslip(input({profiles:[staff,{...staff,id:'same-name'}],payrollRecords:[legacySaved]})).kind,'held');legacySaved.frozenData.name='Different saved person';assert.equal(buildFranchisePayslip(input({payrollRecords:[legacySaved]})).kind,'held');
});
test('invalid rates, money, cutoff and mismatched frozen arithmetic never turn into zero estimates',()=>{
 for(const patch of [{staff:{...staff,hourlyRate:'bad'}},{deductions:[row('bad','Staff Meal','unknown')]},{end:'2026-09-30'},{payrollRecords:[{...saved(),finalNetPay:1}]},{deductions:[row('unsupported','Unreviewed charge',100)]}]){const model=buildFranchisePayslip(input(patch));assert.equal(model.kind,'held',JSON.stringify(patch));assert.equal(model.totals.net,null);}
});
test('historical paid name-only deductions and old bonuses do not contaminate a new cutoff',()=>{
 const model=buildFranchisePayslip(input({deductions:[{type:'Staff Meal',staffName:staff.cashierName,branch,status:'Paid',amount:999,dateAdded:at('2026-09-01','10:00')}],bonuses:[{staffName:staff.cashierName,branch,amount:999,dateAdded:at('2026-09-01','10:00')}]}));assert.equal(model.kind,'estimate');assert.equal(model.totals.net,500);
});
test('legacy deduction identity needs a unique directory; current staff IDs remain authoritative through a rename',()=>{
 const legacy=row('meal','Staff Meal',20);delete legacy.staffId;const model=buildFranchisePayslip(input({deductions:[legacy]}));assert.equal(model.kind,'estimate');assert.equal(model.totals.net,480);
 assert.equal(buildFranchisePayslip(input({deductions:[legacy],profiles:[staff,{...staff,id:'duplicate'}]})).kind,'held');
 const renamed={...staff,cashierName:'New Saved Name'};assert.equal(buildFranchisePayslip(input({staff:renamed,profiles:[renamed],deductions:[row('food','Staff Meal',20)]})).totals.net,480);
 const noBranch={...legacy};delete noBranch.branch;assert.equal(buildFranchisePayslip(input({deductions:[noBranch]})).kind,'held');assert.equal(buildFranchisePayslip(input({deductions:[noBranch],identityDirectoryComplete:true})).totals.net,480);
});
test('future effective deductions and scheduled penalties stay outside the current estimate',()=>{
 const model=buildFranchisePayslip(input({deductions:[row('future','Cash Advance',100,{effectiveDate:'2026-10-16'}),row('penalty','Sanction penalty',50,{scheduleVersion:1,effectiveDate:'2026-10-01'})]}));assert.equal(model.kind,'estimate');assert.equal(model.totals.deductions,0);assert.match(model.notes.join(' '),/separate HQ ledger review/);
 assert.equal(buildFranchisePayslip(input({deductions:[row('bad','Cash Advance',50,{effectiveDate:'2026-02-31'})]})).kind,'held');
});
