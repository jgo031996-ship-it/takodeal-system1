import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createPayrollAdjustmentService} from '../takodeal-manager/payroll-adjustments.js';
import {createOwnerDeductionService} from '../takodeal-manager/owner-deductions.js';
import {OWNER_DEDUCTION_BASES,validateOwnerDeductionLink} from '../takodeal-manager/owner-deduction-model.js';
import {ownerDeductionDisplayRows} from '../takodeal-manager/owner-deduction-payroll.js';
import {finalizeOrdinaryPayroll,confirmedPayrollResult} from '../takodeal-manager/payroll-settlement.js';
import {finalizeRefundPayroll} from '../takodeal-manager/refund-payroll.js';
import {payrollRecoveryEvidence,readPayrollRecoveryEvidence,payrollRecoveryFromReview,PAYROLL_RECOVERY_LABEL} from '../takodeal-manager/payroll-recovery-model.js';
import {payslipDeductionDetailsHTML} from '../takodeal-manager/payroll-deduction-details.js';
import {payslipDeductionDetailsHTML as staffDetailsHTML} from '../takodeal-staff/payroll-deduction-details.js';

const uid='synthetic-recovery-owner',email='jgo031996@gmail.com',staffId='synthetic-recovery-staff',name='Fictional Recovery Crew',branch='Synthetic Recovery Branch',today='2030-02-01';
const original={staffId,staffName:name,branch,startDate:'2030-01-01',endDate:'2030-01-15',finalNetPay:1000,processedAt:new Date('2030-01-16T00:00:00Z'),signatureBase64:'data:image/png;base64,ORIGINAL',frozenData:{staffId,name,branch,basicPay:1000,isPaid:true,finalNetPay:1000,logs:[{date:'Jan 1',remark:'Original signed payroll'}]}};
const input=extra=>({staffId,originalStart:'2030-01-01',originalEnd:'2030-01-15',effectiveDate:today,amount:125,reason:'The original payroll paid a duplicate allowance.',sourcePayrollRecordId:'original-paid',...extra});
function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}};h.api.sessionUser={uid,email,isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']};
 h.put('hq_managers/'+uid,{email,role:'System Architect',permissions:['all'],assignedBranch:'All',active:true,pin:'fixture-only'});const profile={staffId,cashierName:name,branch,hourlyRate:450,dateHired:'2029-01-01'};h.put('cashiers/'+staffId,profile);h.put('cash_accounts/bank',{name:'Fictional Bank',branch,balance:5000});h.put('payroll_records/original-paid',structuredClone(original));
 h.api.getDocFromServer=async ref=>({ref,id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const now=()=>new Date(today+'T00:00:00+08:00'),service=createPayrollAdjustmentService(h.api,{now}),reviews=createOwnerDeductionService(h.api,{now});
 const data={staffId,name,branch,start:today,end:'2030-02-15',profile,basicPay:450,meals:0,advances:0,loans:0,perfBonus:0,customDeductions:[],customDeductionsTotal:0};
 const f={h,service,reviews,data};f.request=async extra=>{const prefill=await service.prepareRecovery(input(extra));return {...await reviews.create(prefill),prefill};};
 f.reply=id=>{const notice=h.get('staff_deduction_notices/'+id);h.put('staff_deduction_notices/'+id,{...notice,replyRevision:1,readRevision:1,staffReply:'I have read the original payroll recovery request.'});};
 f.approve=async id=>{const approved=await reviews.approve(id,{amount:125,effectiveDate:today,lawfulBasis:OWNER_DEDUCTION_BASES[0],authorityReference:'Synthetic applicable authority reference',finding:'Synthetic reviewed finding after the saved staff response.',responsibilityConfirmed:true,lawfulAuthorityConfirmed:true,weeklyLimitConfirmed:true,expectedRevision:1,expectedReplyRevision:1});data.ownerDeductions=125;data.ownerDeductionRows=[{id,amount:125}];return approved;};
 f.pay=extra=>finalizeOrdinaryPayroll(h.api,{data,accountId:'bank',finalNetPay:450-(data.ownerDeductions||0),...extra});return f;
}
const state=f=>structuredClone([...f.h.docs]);

test('a recovery proposal links a confirmed paid cutoff through the existing pending Staff-response review without moving money',async()=>{
 const f=fixture(),before=state(f),requested=await f.request(),review=f.h.get('owner_deduction_reviews/'+requested.id),charge=f.h.get('staff_deductions/'+requested.id),notice=f.h.get('staff_deduction_notices/'+requested.id);
 assert.equal(review.status,'Pending Review');assert.equal(review.label,PAYROLL_RECOVERY_LABEL+' · 2030-01-01 to 2030-01-15');assert.equal(review.category,'Other');assert.equal(review.amount,0);assert.equal(review.proposedAmount,125);assert.equal(charge.status,'Pending Review');assert.equal(charge.amount,0);assert.equal(notice.status,'Pending Review');assert.equal(notice.details,input().reason);assert.equal(readPayrollRecoveryEvidence(notice.evidence).sourcePayrollRecordId,'original-paid');assert.equal(readPayrollRecoveryEvidence(notice.evidence).requestedEffectiveDate,today);
 assert.deepEqual([...f.h.docs].filter(([path])=>!['owner_deduction_reviews/','staff_deductions/','staff_deduction_notices/'].some(prefix=>path.startsWith(prefix))),before);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('staff_bonuses/')),false);
 const view=await f.service.inspect(staffId);assert.equal(view.recoveries.length,1);assert.equal(view.recoveries[0].id,requested.id);
});
test('repeated recovery preparation and a lost pending-review acknowledgement reuse one exact review reference',async()=>{
 const f=fixture(),a=await f.service.prepareRecovery(input()),b=await f.service.prepareRecovery(input());assert.equal(a.operationId,b.operationId);f.h.loseNextAck();await assert.rejects(f.reviews.create(a),/lost after commit/);const committed=state(f),retry=await f.reviews.create(b);assert.equal(retry.alreadySaved,true);assert.deepEqual(state(f),committed);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('owner_deduction_reviews/')).length,1);
});
for(const extra of [{sourcePayrollRecordId:''},{sourcePayrollRecordId:'wrong-paid'},{amount:1000.01},{originalEnd:'2030-01-14'},{amount:-10}])test('invalid recovery source or amount is rejected without any record: '+JSON.stringify(extra),async()=>{
 const f=fixture(),before=state(f);await assert.rejects(f.service.prepareRecovery(input(extra)));assert.deepEqual(state(f),before);
});
for(const patch of [{finalNetPay:0},{status:'Draft'},{isPaid:false},{frozenData:{...original.frozenData,staffId:'another-person'}},{frozenData:{...original.frozenData,finalNetPay:999}},{staffId:undefined,frozenData:{...original.frozenData,staffId:undefined}}])test('incomplete or mismatched original paid payroll cannot authorize a recovery: '+JSON.stringify(patch),async()=>{
 const f=fixture();f.h.put('payroll_records/original-paid',{...structuredClone(original),...patch});const before=state(f);await assert.rejects(f.service.prepareRecovery(input()));assert.deepEqual(state(f),before);
});
test('the protected review creation rechecks the original paid amount inside its transaction before creating any companion',async()=>{
 const f=fixture(),prefill=await f.service.prepareRecovery(input()),run=f.h.api.runTransaction;f.h.api.runTransaction=async(...args)=>{f.h.put('payroll_records/original-paid',{...structuredClone(original),finalNetPay:900});return run(...args);};await assert.rejects(f.reviews.create(prefill),/original paid payroll/i);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('owner_deduction_reviews/')),false);assert.equal(f.h.get('cash_accounts/bank').balance,5000);
});
test('a recovery-labelled generic deduction cannot omit or forge its original paid reference',async()=>{
 const f=fixture(),prefill=await f.service.prepareRecovery(input());for(const patch of [{evidence:'An arbitrary reference cannot replace the original payslip.'},{label:'A relabelled generic case'},{category:'Damaged item'},{incidentDate:'2030-01-14'},{actualLoss:1001,proposedAmount:1001}]){const before=state(f);await assert.rejects(f.reviews.create({...prefill,...patch}));assert.deepEqual(state(f),before);}
});
test('a payroll recovery still requires the saved Staff reply and every existing Owner approval confirmation',async()=>{
 const f=fixture(),requested=await f.request(),before=state(f);await assert.rejects(f.approve(requested.id),/response|review/i);assert.deepEqual(state(f),before);f.reply(requested.id);
 await assert.rejects(f.reviews.approve(requested.id,{amount:125,effectiveDate:today,lawfulBasis:OWNER_DEDUCTION_BASES[0],authorityReference:'Synthetic authority reference',finding:'Synthetic reviewed finding after the saved staff response.',responsibilityConfirmed:true,lawfulAuthorityConfirmed:false,weeklyLimitConfirmed:true,expectedRevision:1,expectedReplyRevision:1}));assert.equal(f.h.get('staff_deductions/'+requested.id).status,'Pending Review');assert.equal(f.h.get('cash_accounts/bank').balance,5000);
});
test('a pending recovery does not reduce payroll, and a later approval cannot rewrite an already paid receiving cutoff',async()=>{
 const f=fixture(),requested=await f.request(),first=await f.pay();assert.equal(first.finalNetPay,450);assert.equal(f.h.get('cash_accounts/bank').balance,4550);f.reply(requested.id);await f.approve(requested.id);const paid=state(f),retry=await f.pay();assert.equal(retry.alreadyPaid,true);assert.equal(retry.finalNetPay,450);assert.deepEqual(state(f),paid);assert.equal(f.h.get('staff_deductions/'+requested.id).status,'Unpaid');
 f.data.start='2030-02-16';f.data.end='2030-02-28';const next=await f.pay();assert.equal(next.finalNetPay,325);assert.equal(f.h.get('cash_accounts/bank').balance,4225);assert.equal(f.h.get('staff_deductions/'+requested.id).payrollRecordId,next.id);assert.deepEqual(f.h.get('payroll_records/original-paid'),original);
});
test('approved recovery settlement freezes the old cutoff, reason and source, consumes the three companions once and preserves original payroll',async()=>{
 const f=fixture(),requested=await f.request();f.reply(requested.id);await f.approve(requested.id);f.h.loseNextAck();await assert.rejects(f.pay(),/lost after commit/);const committed=state(f),paid=await f.pay();assert.equal(paid.alreadyPaid,true);assert.equal(paid.finalNetPay,325);assert.equal(f.h.get('cash_accounts/bank').balance,4675);assert.deepEqual(state(f),committed);
 for(const table of ['owner_deduction_reviews','staff_deductions','staff_deduction_notices']){const row=f.h.get(table+'/'+requested.id);assert.equal(row.status,'Paid');assert.equal(row.payrollRecordId,paid.id);}
 const detail=paid.frozenData.payrollRecoveryRows[0];assert.equal(detail.sourcePayrollRecordId,'original-paid');assert.equal(detail.originalEnd,'2030-01-15');assert.equal(detail.sourceNetPay,1000);assert.equal(detail.reason,input().reason);assert.equal(paid.frozenData.ownerDeductions,125);assert.equal(paid.frozenData.payrollAdjustments,0);assert.deepEqual(f.h.get('payroll_records/original-paid'),original);
 const html=payslipDeductionDetailsHTML(paid.frozenData);assert.match(html,/Previous payroll recovery/);assert.match(html,/2030-01-15/);assert.match(html,/original-paid/);assert.match(html,/duplicate allowance/);assert.equal(staffDetailsHTML(paid.frozenData),html);
});
test('a new Staff response after approval holds recovery without hiding or collecting it',async()=>{
 const f=fixture(),requested=await f.request();f.reply(requested.id);await f.approve(requested.id);f.h.put('staff_deduction_notices/'+requested.id,{...f.h.get('staff_deduction_notices/'+requested.id),replyRevision:2,staffReply:'Please review my newer explanation.'});const before=state(f);await assert.rejects(f.pay(),/owner.added|one.time/i);assert.deepEqual(state(f),before);
});
test('refund payroll preserves the same reviewed recovery metadata and settles it once with the independent refund',async()=>{
 const f=fixture(),requested=await f.request();f.reply(requested.id);await f.approve(requested.id);for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])f.h.put(table+'/synthetic-refund',{staffId,staffName:name,branch,type:'Online Order Refund',amount:25,status:'Unpaid',dateAdded:new Date(today+'T00:00:00+08:00')});f.data.onlineRefunds=25;f.data.onlineRefundRows=[{id:'synthetic-refund',amount:25}];const request={data:f.data,accountId:'bank',finalNetPay:300};const result=await finalizeRefundPayroll(f.h.api,request);assert.equal(result.finalNetPay,300);assert.equal(result.frozenData.payrollRecoveryRows[0].sourcePayrollRecordId,'original-paid');const before=state(f);assert.equal((await finalizeRefundPayroll(f.h.api,request)).alreadyPaid,true);assert.deepEqual(state(f),before);assert.deepEqual(f.h.get('payroll_records/original-paid'),original);
});
test('confirmed history exposes original processed date and signature as local result metadata without rewriting its frozen data',()=>{
 const before=structuredClone(original),result=confirmedPayrollResult(original,{id:'original-paid',staffId,start:original.startDate,end:original.endDate});assert.deepEqual(result.processedAt,original.processedAt);assert.equal(result.staffSignature,original.signatureBase64);assert.equal(Object.hasOwn(result.frozenData,'processedAt'),false);assert.deepEqual(original,before);
});
