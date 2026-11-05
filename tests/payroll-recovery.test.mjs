import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createPayrollAdjustmentService} from '../takodeal-manager/payroll-adjustments.js';
import {createOwnerDeductionService} from '../takodeal-manager/owner-deductions.js';
import {OWNER_DEDUCTION_BASES,validateOwnerDeductionLink} from '../takodeal-manager/owner-deduction-model.js';
import {ownerDeductionDisplayRows,readPayrollOwnerDeductions} from '../takodeal-manager/owner-deduction-payroll.js';
import {finalizeOrdinaryPayroll,confirmedPayrollResult} from '../takodeal-manager/payroll-settlement.js';
import {finalizeRefundPayroll} from '../takodeal-manager/refund-payroll.js';
import {payrollRecoveryEvidence,readPayrollRecoveryEvidence,payrollRecoveryFromReview,payrollRecoverySourceFingerprint,PAYROLL_RECOVERY_LABEL} from '../takodeal-manager/payroll-recovery-model.js';
import {payslipDeductionDetailsHTML} from '../takodeal-manager/payroll-deduction-details.js';
import {payslipDeductionDetailsHTML as staffDetailsHTML} from '../takodeal-staff/payroll-deduction-details.js';

const uid='synthetic-recovery-owner',email='jgo031996@gmail.com',staffId='synthetic-recovery-staff',name='Fictional Recovery Crew',branch='Synthetic Recovery Branch',today='2030-02-01';
const original={staffId,staffName:name,branch,startDate:'2030-01-01',endDate:'2030-01-15',finalNetPay:1000,processedAt:new Date('2030-01-16T00:00:00Z'),signatureBase64:'data:image/png;base64,ORIGINAL',frozenData:{staffId,name,branch,basicPay:1000,isPaid:true,finalNetPay:1000,logs:[{date:'Jan 1',remark:'Original signed payroll'}]}};
const input=extra=>({staffId,originalStart:'2030-01-01',originalEnd:'2030-01-15',effectiveDate:today,amount:125,correctedNetPay:875,reason:'The original payroll paid a duplicate allowance.',sourcePayrollRecordId:'original-paid',...extra});
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

test('a new recovery binds the full original source, corrected net and exact overpayment without copying private frozen data into its notice',async()=>{
 const f=fixture(),prefill=await f.service.prepareRecovery(input()),proof=readPayrollRecoveryEvidence(prefill.evidence);assert.equal(proof.version,2);assert.equal(proof.correctedNetPay,875);assert.equal(proof.overpaymentAmount,125);assert.equal(proof.sourceFingerprint,await payrollRecoverySourceFingerprint(original));assert.equal(proof.recoveryGeneration,0);assert.equal(prefill.actualLoss,125);assert.equal(prefill.evidence.includes('Original signed payroll'),false);assert.equal(f.h.get('cash_accounts/bank').balance,5000);
});
for(const extra of [{correctedNetPay:undefined},{correctedNetPay:-1},{correctedNetPay:1000},{correctedNetPay:1001},{correctedNetPay:900},{amount:100,correctedNetPay:875}])test('an undocumented or mismatched overpayment is rejected before writes: '+JSON.stringify(extra),async()=>{
 const f=fixture(),before=state(f);await assert.rejects(f.service.prepareRecovery(input(extra)));assert.deepEqual(state(f),before);
});
test('editing amount, reason or requested date cannot create a second economic recovery for a pending original',async()=>{
 const f=fixture(),first=await f.request(),before=state(f);for(const extra of [{reason:'A changed description for the same past payroll.'},{effectiveDate:'2030-02-02'},{amount:100,correctedNetPay:900}])await assert.rejects(f.service.prepareRecovery(input(extra)),error=>error.code==='payroll-recovery-existing'&&error.recoveryId===first.id);assert.deepEqual(state(f),before);
});
test('two independent clients preparing different descriptions contend on the same stable recovery case rather than creating two charges',async()=>{
 const f=fixture(),a=await f.service.prepareRecovery(input()),b=await f.service.prepareRecovery(input({reason:'A different description of the same duplicate allowance.'}));assert.equal(a.operationId,b.operationId);const other=createOwnerDeductionService(f.h.api,{now:()=>new Date(today+'T00:00:00+08:00')});const results=await Promise.allSettled([f.reviews.create(a),other.create(b)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('owner_deduction_reviews/')).length,1);assert.equal(f.h.get('cash_accounts/bank').balance,5000);
});
test('an arbitrary second case ID or inflated actual-loss field cannot bypass the documented recovery identity and cap',async()=>{
 for(const change of [{operationId:'11111111-1111-4111-8111-111111111111'},{actualLoss:1000},{actualLoss:100,proposedAmount:100}]){const f=fixture(),prefill=await f.service.prepareRecovery(input()),before=state(f);await assert.rejects(f.reviews.create({...prefill,...change}));assert.deepEqual(state(f),before);}
});
for(const field of ['basicPay','logs','profile'])test('a same-net original frozen '+field+' change after preparation blocks pending review creation',async()=>{
 const f=fixture(),prefill=await f.service.prepareRecovery(input()),changed=structuredClone(original);changed.frozenData[field]=field==='basicPay'?999:field==='logs'?[{remark:'Changed original attendance'}]:{cashierName:name,privateDetail:'Changed original profile'};f.h.put('payroll_records/original-paid',changed);const before=state(f);await assert.rejects(f.reviews.create(prefill),/original paid payroll changed/i);assert.deepEqual(state(f),before);
});
test('a source change after the Staff reply blocks approval with all three records still pending',async()=>{
 const f=fixture(),first=await f.request();f.reply(first.id);f.h.put('payroll_records/original-paid',{...structuredClone(original),accountId:'changed-account'});const before=state(f);await assert.rejects(f.approve(first.id),/original paid payroll changed/i);assert.deepEqual(state(f),before);assert.equal(f.h.get('owner_deduction_reviews/'+first.id).revision,1);
});
for(const patch of [{pendingSync:true},{paymentStatus:'Pending'},{paymentState:'Failed'},{frozenData:{...original.frozenData,pendingSync:true}}])test('an unconfirmed original payment cannot be recovered even when its net amount is unchanged: '+JSON.stringify(patch),async()=>{
 const f=fixture();f.h.put('payroll_records/original-paid',{...structuredClone(original),...patch});const before=state(f);await assert.rejects(f.service.prepareRecovery(input()),/original paid payroll/i);assert.deepEqual(state(f),before);
});
test('a changed original after approval is rejected both by fresh preview hydration and by ordinary settlement',async()=>{
 const f=fixture(),first=await f.request();f.reply(first.id);await f.approve(first.id);f.h.put('payroll_records/original-paid',{...structuredClone(original),frozenData:{...original.frozenData,basicPay:999}});const before=state(f),charge={...f.h.get('staff_deductions/'+first.id),id:first.id};await assert.rejects(readPayrollOwnerDeductions(f.h.api,[charge],f.data.end),/original paid payroll changed/i);await assert.rejects(finalizeOrdinaryPayroll(f.h.api,{data:f.data,accountId:'bank',finalNetPay:325}),/original paid payroll changed/i);assert.deepEqual(state(f),before);
});
test('refund settlement also rereads the exact original source before any bank or linked-record write',async()=>{
 const f=fixture(),first=await f.request();f.reply(first.id);await f.approve(first.id);for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])f.h.put(table+'/synthetic-refund',{staffId,staffName:name,branch,type:'Online Order Refund',amount:25,status:'Unpaid',dateAdded:new Date(today+'T00:00:00+08:00')});f.data.onlineRefunds=25;f.data.onlineRefundRows=[{id:'synthetic-refund',amount:25}];f.h.put('payroll_records/original-paid',{...structuredClone(original),frozenData:{...original.frozenData,logs:[]}});const before=state(f);await assert.rejects(finalizeRefundPayroll(f.h.api,{data:f.data,accountId:'bank',finalNetPay:300}),/original paid payroll changed/i);assert.deepEqual(state(f),before);
});
test('a source changed after it was read causes transaction retry and no partial payroll payment',async()=>{
 const f=fixture(),first=await f.request();f.reply(first.id);await f.approve(first.id);const run=f.h.api.runTransaction;let changed=false;f.h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async ref=>{const result=await tx.get(ref);if(!changed&&ref.path==='payroll_records/original-paid'){changed=true;f.h.put(ref.path,{...structuredClone(original),accountId:'source-changed-during-payment'});}return result;}}));await assert.rejects(finalizeOrdinaryPayroll(f.h.api,{data:f.data,accountId:'bank',finalNetPay:325}),/original paid payroll changed|saved payroll record changed/i);assert.equal(f.h.get('cash_accounts/bank').balance,5000);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('expenses/')).length,0);assert.equal(f.h.get('staff_deductions/'+first.id).status,'Unpaid');
});
test('routine acknowledgment of the original payroll does not change its immutable financial source fingerprint',async()=>{
 const f=fixture(),first=await f.request(),hash=await payrollRecoverySourceFingerprint(original);f.reply(first.id);const acknowledged={...structuredClone(original),acknowledged:true,acknowledgedAt:new Date(),signatureBase64:'data:image/png;base64,LATER_ACK'};f.h.put('payroll_records/original-paid',acknowledged);assert.equal(await payrollRecoverySourceFingerprint(acknowledged),hash);await f.approve(first.id);await finalizeOrdinaryPayroll(f.h.api,{data:f.data,accountId:'bank',finalNetPay:325});assert.equal(f.h.get('cash_accounts/bank').balance,4675);
});
test('source fingerprints preserve nested types, exceptional numbers, array order and nanosecond timestamp evidence',async()=>{
 const base=structuredClone(original),digest=await payrollRecoverySourceFingerprint(base),reordered={...base,frozenData:Object.fromEntries(Object.entries(base.frozenData).reverse())};assert.equal(await payrollRecoverySourceFingerprint(reordered),digest);
 const stamp={...base,processedAt:{seconds:Math.floor(+base.processedAt/1000),nanoseconds:0}};assert.equal(await payrollRecoverySourceFingerprint(stamp),digest);stamp.processedAt.nanoseconds=1;assert.notEqual(await payrollRecoverySourceFingerprint(stamp),digest);
 const nan={...base,frozenData:{...base.frozenData,unknownAmount:NaN}},nil={...base,frozenData:{...base.frozenData,unknownAmount:null}};assert.notEqual(await payrollRecoverySourceFingerprint(nan),await payrollRecoverySourceFingerprint(nil));assert.notEqual(await payrollRecoverySourceFingerprint({...base,finalNetPay:'1000'}),digest);
});
test('only an explicitly dismissed recovery can be replaced and the new generation leaves the dismissed history unchanged',async()=>{
 const f=fixture(),first=await f.request();await f.reviews.dismiss(first.id,{reason:'The proposed recovery was withdrawn before approval.',expectedRevision:1});const dismissed=structuredClone(f.h.get('owner_deduction_reviews/'+first.id)),prefill=await f.service.prepareRecovery(input({amount:100,correctedNetPay:900}));assert.notEqual('owner-deduction-'+prefill.operationId,first.id);assert.equal(readPayrollRecoveryEvidence(prefill.evidence).recoveryGeneration,1);const next=await f.reviews.create(prefill);assert.notEqual(next.id,first.id);assert.deepEqual(f.h.get('owner_deduction_reviews/'+first.id),dismissed);assert.equal(f.h.get('cash_accounts/bank').balance,5000);
});
test('a paid recovery prevents another economic charge while payment retries still return the saved receiving payroll before source reallocation',async()=>{
 const f=fixture(),first=await f.request();f.reply(first.id);await f.approve(first.id);const request={data:f.data,accountId:'bank',finalNetPay:325};await finalizeOrdinaryPayroll(f.h.api,request);await assert.rejects(f.service.prepareRecovery(input({amount:100,correctedNetPay:900})),error=>error.recoveryId===first.id);f.h.put('payroll_records/original-paid',{...structuredClone(original),accountId:'changed-after-receiving-payment'});const before=state(f),retry=await finalizeOrdinaryPayroll(f.h.api,request);assert.equal(retry.alreadyPaid,true);assert.deepEqual(state(f),before);
});
test('legacy unfingerprinted recovery history stays readable but cannot be newly approved or collected without a fresh review',async()=>{
 const f=fixture(),first=await f.request(),legacy=payrollRecoveryEvidence({staffId,originalStart:original.startDate,originalEnd:original.endDate,sourcePayrollRecordId:'original-paid',sourceNetPay:1000,requestedEffectiveDate:today});for(const table of ['owner_deduction_reviews','staff_deduction_notices'])f.h.put(table+'/'+first.id,{...f.h.get(table+'/'+first.id),evidence:legacy});f.reply(first.id);const before=state(f);assert.equal(payrollRecoveryFromReview(f.h.get('owner_deduction_reviews/'+first.id)).sourceNetPay,1000);await assert.rejects(f.approve(first.id),/legacy recovery.*fresh/i);assert.deepEqual(state(f),before);
});
