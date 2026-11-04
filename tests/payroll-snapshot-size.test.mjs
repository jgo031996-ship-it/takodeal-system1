import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollScheduleStamp,assertPayrollScheduleFresh} from '../takodeal-manager/payroll-schedule-freshness.js';
import {validateOrdinaryPayrollSnapshot,confirmedPayrollResult,finalizeOrdinaryPayroll,ordinaryPayrollId,PAYROLL_SETTLEMENT_LIMITS} from '../takodeal-manager/payroll-settlement.js';
import {validateRefundPayrollSnapshot,createRefundPayrollEngine} from '../takodeal-manager/refund-payroll.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

const cutoff={start:'2026-10-16',end:'2026-10-31'},staffId='sample-payroll-staff',name='Sample Payroll Staff',branch='Maa';
function savedHistory(){
 const revisions=Array.from({length:24},(_,index)=>{
  const revisionId='saved-revision-'+String(index).padStart(4,'0');
  return {month:'2026-10',revisionId,sequence:index+1,savedAt:'2026-10-15T00:00:00Z',source:'manager-save',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',
   snapshot:{currentYear:2026,currentMonth:10,branchConfig:{Maa:[],Cabantian:[],Citygate:[]}},
   daySnapshots:Object.fromEntries(Array.from({length:31},(_,day)=>['2026-10-'+String(day+1).padStart(2,'0'),{configRevisionId:revisionId,daySchedule:Object.fromEntries(['Maa','Cabantian','Citygate'].map(branch=>[branch,{scheduled:Object.fromEntries(Array.from({length:6},(_,shift)=>['saved-shift-'+shift,{staffId:'sample-staff-'+shift,staffName:'Example Saved Employee '+shift,start:'17:30',end:'02:30'}]))}]))}]))};
 });
 return {payrollHistoryEnforcedFrom:'2026-10-01',historyMonths:{'2026-10':{revisions,shiftAmendments:[]}},holidays:{}};
}
const history=savedHistory(),stamp=payrollScheduleStamp(history,cutoff);
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
function preview(extra={}){
 return {staffId,name,branch,...cutoff,scheduleEvidenceStamp:stamp,profile:{staffId,cashierName:name,role:'Crew',dateHired:'2026-01-01',hourlyRate:450,salaryRateVersion:0},
  hours:108.5,recordedHours:108.5,shiftsWorked:12,basicPay:5400,nightBonus:450,straightBonus:0,holidayPayTotal:0,perfBonus:0,
  lateDeduction:0,sss:0,philhealth:0,pagibig:0,advances:0,meals:1124.5,loans:0,customDeductions:[],customDeductionsTotal:0,
  attendanceLogIds:['time-in-original','time-out-original'],logs:[{date:'Oct 16',in:'05:30 PM',out:'02:30 AM',hrs:'9.00',remark:'Complete',dailyRate:450,rateWorkDate:'2026-10-16',scheduleSource:'history',scheduleRevisionId:'saved-revision-0023',scheduleAmendmentIds:['shift-amendment-original'],expectedStartAt:'2026-10-16T09:30:00.000Z',expectedEndAt:'2026-10-16T18:30:00.000Z'}],...extra};
}
function paymentFixture(data){
 const h=firestoreHarness(),uid='sample-owner',email='jgo031996@gmail.com';
 h.api.auth={currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}};
 h.api.sessionUser={uid,email,isOwner:true,isFranchisee:false,role:'Owner',permissions:['payroll'],allowedBranches:['All']};
 h.put('hq_managers/'+uid,{email,cashierName:'Example Owner',role:'System Architect',permissions:['payroll'],assignedBranch:'All',pin:'fixture-only'});
 h.put('cashiers/'+staffId,{...data.profile,cashierName:name,branch});h.put('cash_accounts/cash',{name:'Example Cash',branch:'Main Office',balance:10000});
 h.api.getDocFromServer=async ref=>({id:ref.id,ref,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 h.put('staff_deductions/meal-original',{staffId,staffName:name,branch,type:'Staff Meal',amount:data.meals,status:'Unpaid',dateAdded:new Date('2026-10-20T12:00:00+08:00'),receiptId:'OR-ORIGINAL',items:[{name:'Original meal',qty:1}]});
 return h;
}

test('real cutoff schedule evidence can exceed the document budget while its payable snapshot retains all payroll facts compactly',()=>{
 assert.ok(bytes(stamp)>PAYROLL_SETTLEMENT_LIMITS.documentBytes,'the actual schedule-stamp function must reproduce the old failure');
 const data=preview(),before=structuredClone(data),frozen=validateOrdinaryPayrollSnapshot(data,4725.5);
 assert.equal(Object.hasOwn(frozen,'scheduleEvidenceStamp'),false);assert.ok(bytes(frozen)<10000);
 assert.equal(frozen.finalNetPay,4725.5);assert.equal(frozen.basicPay,5400);assert.equal(frozen.nightBonus,450);assert.equal(frozen.meals,1124.5);
 assert.deepEqual(frozen.logs,data.logs);assert.deepEqual(frozen.attendanceLogIds,data.attendanceLogIds);assert.equal(frozen.profile.hourlyRate,450);assert.deepEqual(data,before);
});

test('snapshot serialization excludes only the transient stamp and does not read its JSON representation',()=>{
 const transient={toJSON(){throw Error('the preview guard must not enter saved payroll');}},data=preview({scheduleEvidenceStamp:transient,sourcePerfBonus:15,manualPerformanceBonus:0,penalties:20,penaltyRows:[{id:'sanction-original',amount:20,revision:2,effectiveDate:'2026-10-20'}]});
 const frozen=validateOrdinaryPayrollSnapshot(data,4725.5);
 assert.equal(frozen.sourcePerfBonus,15);assert.equal(frozen.manualPerformanceBonus,0);assert.equal(frozen.penalties,20);assert.deepEqual(frozen.penaltyRows,data.penaltyRows);assert.equal(data.scheduleEvidenceStamp,transient);
});

test('the original preview still requires exact fresh schedule evidence after creating the saved snapshot',async()=>{
 const data=preview(),api={auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>history};
 validateOrdinaryPayrollSnapshot(data,4725.5);assert.equal(data.scheduleEvidenceStamp,stamp);await assertPayrollScheduleFresh(api,data);
 api.loadPayrollScheduleHistory=async()=>{const changed=structuredClone(history);changed.historyMonths['2026-10'].revisions[0].daySnapshots['2026-10-16'].daySchedule.Maa.scheduled['saved-shift-0'].staffName='Changed assignment';return changed;};
 await assert.rejects(assertPayrollScheduleFresh(api,data),/saved shift times changed/i);assert.equal(data.scheduleEvidenceStamp,stamp);
});

test('large actual attendance and other saved payroll facts still fail the unchanged safety budget',()=>{
 assert.equal(PAYROLL_SETTLEMENT_LIMITS.documentBytes,750000);
 for(const extra of [{logs:[{date:'Oct 16',in:'05:30 PM',out:'02:30 AM',remark:'x'.repeat(760000)}]},{savedPayrollNote:'x'.repeat(760000)}])assert.throws(()=>validateOrdinaryPayrollSnapshot(preview(extra),4725.5),/too large for one payment/);
 assert.throws(()=>validateOrdinaryPayrollSnapshot(preview({attendanceReviewRequired:true}),4725.5),/HR review/);
 assert.throws(()=>validateOrdinaryPayrollSnapshot(preview(),4725.51),/total changed/);
});

test('refund payroll shares the compact validator while retaining exact refund rows, amounts and original evidence links',()=>{
 const onlineRefundRows=[{id:'online-refund-source',amount:80,sourceTransactionId:'transaction-original'}],data=preview({onlineRefunds:80,onlineRefundRows}),before=structuredClone(data);
 const frozen=validateRefundPayrollSnapshot(data,4645.5);
 assert.equal(Object.hasOwn(frozen,'scheduleEvidenceStamp'),false);assert.equal(frozen.onlineRefunds,80);assert.equal(frozen.finalNetPay,4645.5);assert.deepEqual(frozen.onlineRefundRows,onlineRefundRows);assert.deepEqual(frozen.logs,data.logs);assert.deepEqual(data,before);
});

test('ordinary payment with a large transient stamp saves its exact deduction detail and debits only once on retry',async()=>{
 const data=preview(),h=paymentFixture(data),input={data,accountId:'cash',finalNetPay:4725.5},saved=await finalizeOrdinaryPayroll(h.api,input),recordId=ordinaryPayrollId(staffId,cutoff.start,cutoff.end);
 assert.equal(saved.alreadyPaid,false);assert.equal(h.get('cash_accounts/cash').balance,5274.5);assert.equal(h.get('expenses/'+recordId).amount,4725.5);
 assert.equal(h.get('staff_deductions/meal-original').status,'Paid');assert.equal(saved.frozenData.deductionDetails[0].receiptId,'OR-ORIGINAL');assert.equal(saved.frozenData.deductionDetails[0].items[0].name,'Original meal');assert.equal(Object.hasOwn(saved.frozenData,'scheduleEvidenceStamp'),false);
 const before=structuredClone([...h.docs]),retry=await finalizeOrdinaryPayroll(h.api,input);assert.equal(retry.alreadyPaid,true);assert.equal(retry.finalNetPay,4725.5);assert.deepEqual([...h.docs],before);assert.equal(data.scheduleEvidenceStamp,stamp);
});

test('refund payment and retry retain refund/detail settlements with the same compact snapshot',async()=>{
 const refundRows=[{id:'online-refund-source',amount:80}],data=preview({onlineRefunds:80,onlineRefundRows:refundRows}),h=paymentFixture(data);
 h.put('staff_deductions/online-refund-source',{staffId,staffName:name,branch,type:'Online Order Refund',amount:80,status:'Unpaid',dateAdded:new Date('2026-10-20T12:00:00+08:00')});
 h.put('online_order_incidents/online-refund-source',{staffId,status:'Unpaid'});h.put('staff_deduction_notices/online-refund-source',{staffId,status:'Unpaid'});
 const meal={...h.get('staff_deductions/meal-original'),id:'meal-original'},engine=createRefundPayrollEngine(h.api,{ownerCheck:()=>true}),input={data,accountId:'cash',finalNetPay:4645.5,deductionRows:[meal],bonusRows:[]},saved=await engine.pay(input);
 assert.equal(saved.alreadyPaid,false);assert.equal(h.get('cash_accounts/cash').balance,5354.5);assert.equal(Object.hasOwn(saved.frozenData,'scheduleEvidenceStamp'),false);assert.deepEqual(saved.frozenData.onlineRefundRows,refundRows);assert.equal(saved.frozenData.deductionDetails[0].items[0].name,'Original meal');
 for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])assert.equal(h.get(table+'/online-refund-source').status,'Paid');
 const before=structuredClone([...h.docs]),retry=await engine.pay(input);assert.equal(retry.alreadyPaid,true);assert.deepEqual([...h.docs],before);assert.equal(data.scheduleEvidenceStamp,stamp);
});

test('a prior paid record is recovered unchanged even if its original frozen snapshot retained a transient stamp',()=>{
 const old=preview({isPaid:true,finalNetPay:4725.5}),before=structuredClone(old),record={staffId,staffName:name,branch,startDate:cutoff.start,endDate:cutoff.end,finalNetPay:4725.5,frozenData:old};
 const recovered=confirmedPayrollResult(record,{id:'original-paid-record',staffId,...cutoff});assert.equal(recovered.alreadyPaid,true);assert.equal(recovered.frozenData.scheduleEvidenceStamp,stamp);assert.deepEqual(record.frozenData,before);
});
