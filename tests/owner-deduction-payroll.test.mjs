import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {seedCashShortage} from './helpers/cash-shortage-fixture.mjs';
import {finalizeOrdinaryPayroll,ordinaryPayrollId,validateOrdinaryPayrollSnapshot} from '../takodeal-manager/payroll-settlement.js';
import {finalizeRefundPayroll} from '../takodeal-manager/refund-payroll.js';
import {readPayrollOwnerDeductions,payrollOwnerDeductionRows,ownerDeductionDisplayRows} from '../takodeal-manager/owner-deduction-payroll.js';
import {OWNER_DEDUCTION_TYPE,OWNER_DEDUCTION_BASES,OWNER_DEDUCTION_LIMIT} from '../takodeal-manager/owner-deduction-model.js';
import {payslipDeductionBreakdown,payslipDeductionDetailsHTML} from '../takodeal-manager/payroll-deduction-details.js';

const staffId='sample-staff',name='Sample Staff',branch='Maa',start='2030-01-01',end='2030-01-15',recordId=ordinaryPayrollId(staffId,start,end);
function fixture({manager=false}={}){
 const h=firestoreHarness(),uid=manager?'manager':'owner',email=manager?'manager@example.test':'jgo031996@gmail.com';
 h.api.auth={currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}};h.api.sessionUser={uid,email,isOwner:!manager,isFranchisee:false,role:manager?'Manager':'Owner',permissions:['payroll'],allowedBranches:['All']};
 h.put('hq_managers/'+uid,{email,cashierName:'HQ',pin:'1234',role:manager?'Manager':'System Architect',permissions:['payroll'],assignedBranch:'All'});h.put('hq_email_access/'+email,{active:true,permissions:['payroll'],allowedBranches:['All']});
 const profile={staffId,cashierName:name,branch,hourlyRate:450,customDeductions:[]};h.put('cashiers/'+staffId,profile);h.put('cash_accounts/cash',{name:'Bank',branch,balance:5000});
 h.api.getDocFromServer=async ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const data={staffId,name,branch,start,end,profile,basicPay:450,nightBonus:0,holidayPayTotal:0,straightBonus:0,perfBonus:0,lateDeduction:0,sss:0,pagibig:0,philhealth:0,advances:0,meals:0,loans:0,cashShortages:0,cashShortageRows:[],ownerDeductions:0,ownerDeductionRows:[],ownerDeductionDetails:[]};
 const net=()=>data.basicPay-(data.ownerDeductions||0)-(data.cashShortages||0)-(data.onlineRefunds||0)-(data.customDeductionsTotal||0);
 return {h,data,pay:(extra={})=>finalizeOrdinaryPayroll(h.api,{data,accountId:'cash',finalNetPay:net(),...extra}),refund:(extra={})=>finalizeRefundPayroll(h.api,{data,accountId:'cash',finalNetPay:net(),...extra})};
}
function seedOwner(f,{number=1,amount=50,effectiveDate='2030-01-01',dateAdded=new Date('2030-02-01T12:00:00+08:00'),include=true}={}){
 const id='owner-deduction-00000000-0000-4000-8000-'+String(number).padStart(12,'0'),details='PRIVATE incident explanation',evidence='PRIVATE evidence reference',finding='PRIVATE finding confirming reviewed responsibility',authorityReference='PRIVATE authority reference';
 const common={id,type:OWNER_DEDUCTION_TYPE,staffId,staffName:name,branch,sourcePlatform:'Owner review',sourceReceiptId:id,label:'Damaged cups '+number,category:'Damaged item',incidentDate:'2030-01-01',amount,effectiveDate};
 const review={...common,schemaVersion:1,staffBranch:branch,status:'Approved',revision:2,authorizedAmount:amount,proposedAmount:amount,sourceLossCents:Math.round(amount*100),responsibilityConfirmed:true,lawfulAuthorityConfirmed:true,weeklyLimitConfirmed:true,lawfulBasis:OWNER_DEDUCTION_BASES[0],authorityReference,finding,details,evidence,replyRevisionReviewed:1};
 const charge={...common,incidentId:id,ownerDeductionVersion:1,status:'Unpaid',reviewRevision:2,authorizedAmount:amount,dateAdded};
 const notice={...common,incidentId:id,version:1,status:'Approved',noticeRevision:2,replyRevision:1,staffReply:'PRIVATE staff explanation',sourceLossCents:review.sourceLossCents,weeklyLimitConfirmed:true,lawfulBasis:review.lawfulBasis,authorityReference,finding,ownerReply:finding,details,evidence};
 for(const [table,row]of [['staff_deductions',charge],['owner_deduction_reviews',review],['staff_deduction_notices',notice]])f.h.put(table+'/'+id,row);
 if(include){f.data.ownerDeductions+=amount;f.data.ownerDeductionRows.push({id,amount});f.data.ownerDeductionDetails.push({id,amount,label:'Forged preview label',evidence:'PRIVATE leaked preview evidence'});}
 return {id,review,charge,notice};
}
function seedRefund(f,number=1){const id='online-refund-'+number,row={staffId,staffName:name,branch,type:'Online Order Refund',amount:10,status:'Unpaid',dateAdded:new Date('2030-01-02T12:00:00+08:00')};for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])f.h.put(table+'/'+id,row);f.data.onlineRefunds=(f.data.onlineRefunds||0)+10;(f.data.onlineRefundRows||=[]).push({id,amount:10});}
function beforeTransaction(f,work){const run=f.h.api.runTransaction;let once=true;f.h.api.runTransaction=async(...args)=>{if(once){once=false;work();}return run(...args);};}
function noDebit(f){assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('payroll_records/')||path.startsWith('expenses/')),false);}

test('one owner-added amount settles all three exact linked records with one bank debit and a minimal frozen detail',async()=>{
 const f=fixture(),row=seedOwner(f),result=await f.pay();assert.equal(result.finalNetPay,400);assert.equal(f.h.get('cash_accounts/cash').balance,4600);const paid=f.h.get('payroll_records/'+recordId);assert.deepEqual(paid.ownerDeductionSettlements,{[row.id]:50});assert.deepEqual(paid.frozenData.ownerDeductionRows,[{id:row.id,amount:50}]);assert.equal(paid.frozenData.ownerDeductions,50);assert.deepEqual(paid.frozenData.ownerDeductionDetails,[{id:row.id,type:OWNER_DEDUCTION_TYPE,bucket:'ownerDeductions',amount:50,label:'Damaged cups 1',category:'Damaged item',incidentDate:'2030-01-01',effectiveDate:'2030-01-01',reviewRevision:2}]);assert.doesNotMatch(JSON.stringify(paid),/PRIVATE|Forged preview label/);
 for(const table of ['staff_deductions','owner_deduction_reviews','staff_deduction_notices']){const saved=f.h.get(table+'/'+row.id);assert.equal(saved.status,'Paid');assert.equal(saved.payrollRecordId,recordId);assert.deepEqual(saved.paidAt,paid.processedAt);assert.equal(saved.amount,50);}
 assert.equal(f.h.get('expenses/'+recordId).amount,400);assert.equal(f.h.get('expenses/'+recordId).payrollRecordId,recordId);
});
test('recurring profile deductions stay separate from owner one-time source details',async()=>{
 const f=fixture();seedOwner(f);f.data.customDeductions=[{name:'Wi-Fi',amount:15}];f.data.customDeductionsTotal=15;const paid=await f.pay();assert.equal(paid.finalNetPay,385);assert.equal(paid.frozenData.customDeductionsTotal,15);assert.equal(paid.frozenData.ownerDeductions,50);assert.deepEqual(payslipDeductionBreakdown(paid.frozenData).groups.map(row=>[row.label,row.amount]),[['Owner-added one-time deductions',50],['Wi-Fi',15]]);
});
test('an effective date governs eligibility even when dateAdded is later, while future and pending rows do not charge early',async()=>{
 const f=fixture(),due=seedOwner(f),future=seedOwner(f,{number:2,effectiveDate:'2030-01-16',include:false}),pending=seedOwner(f,{number:3,include:false});f.h.put('staff_deductions/'+pending.id,{...pending.charge,status:'Pending Review',amount:0});const paid=await f.pay();assert.equal(paid.finalNetPay,400);assert.equal(f.h.get('staff_deductions/'+due.id).status,'Paid');assert.equal(f.h.get('staff_deductions/'+future.id).status,'Unpaid');assert.equal(f.h.get('staff_deductions/'+pending.id).status,'Pending Review');
});
for(const route of ['pay','refund'])for(const failure of ['omitted','partial','duplicate','total','forged'])test(route+' rejects a '+failure+' due one-time source without a financial write',async()=>{
 const f=fixture(),row=seedOwner(f);if(route==='refund')seedRefund(f);if(failure==='omitted'){f.data.ownerDeductions=0;f.data.ownerDeductionRows=[];}if(failure==='partial'){f.data.ownerDeductions=25;f.data.ownerDeductionRows[0].amount=25;}if(failure==='duplicate'){f.data.ownerDeductions=100;f.data.ownerDeductionRows.push({id:row.id,amount:50});}if(failure==='total')f.data.ownerDeductions=45;if(failure==='forged')f.data.ownerDeductionRows[0].id='owner-deduction-00000000-0000-4000-8000-000000000099';await assert.rejects(f[route](),/owner.added|one.time/i);noDebit(f);assert.equal(f.h.get('staff_deductions/'+row.id).status,'Unpaid');
});
for(const route of ['pay','refund'])for(const failure of ['review','notice','reply','amount','effective','identity','deleted','authority'])test(route+' observes a fresh '+failure+' change before settling any source',async()=>{
 const f=fixture(),row=seedOwner(f);if(route==='refund')seedRefund(f);beforeTransaction(f,()=>{if(failure==='review')f.h.put('owner_deduction_reviews/'+row.id,{...row.review,status:'Dismissed'});if(failure==='notice')f.h.put('staff_deduction_notices/'+row.id,{...row.notice,label:'A changed label'});if(failure==='reply')f.h.put('staff_deduction_notices/'+row.id,{...row.notice,replyRevision:2});if(failure==='amount')f.h.put('staff_deductions/'+row.id,{...row.charge,amount:40});if(failure==='effective')f.h.put('owner_deduction_reviews/'+row.id,{...row.review,effectiveDate:'2030-01-16'});if(failure==='identity')f.h.put('staff_deductions/'+row.id,{...row.charge,staffId:'other'});if(failure==='deleted')f.h.docs.delete('staff_deduction_notices/'+row.id);if(failure==='authority')f.h.put('owner_deduction_reviews/'+row.id,{...row.review,weeklyLimitConfirmed:false});});await assert.rejects(f[route](),/owner.added|one.time/i);noDebit(f);
});
test('fresh ID query catches a renamed or forged source name rather than silently omitting its charge',async()=>{
 const f=fixture(),row=seedOwner(f);f.h.put('staff_deductions/'+row.id,{...row.charge,staffName:'Different name'});await assert.rejects(f.pay(),/one.time/i);noDebit(f);
});
test('a rejected combined transaction changes no bank, payroll, expense or one-time companion record',async()=>{
 const f=fixture(),row=seedOwner(f),before=structuredClone([...f.h.docs]);f.h.failNextCommit();await assert.rejects(f.pay(),/rejected/);assert.deepEqual([...f.h.docs],before);assert.equal(f.h.get('staff_deductions/'+row.id).status,'Unpaid');
});
test('concurrent clients and a lost acknowledgement consume the one-time charge exactly once and return its saved details',async()=>{
 const f=fixture();seedOwner(f);const result=await Promise.all([f.pay(),finalizeOrdinaryPayroll({...f.h.api},{data:f.data,accountId:'cash',finalNetPay:400})]);assert.equal(result.filter(row=>!row.alreadyPaid).length,1);assert.equal(f.h.get('cash_accounts/cash').balance,4600);
 const g=fixture(),row=seedOwner(g);g.h.loseNextAck();await assert.rejects(g.pay(),/lost after commit/);g.h.put('owner_deduction_reviews/'+row.id,{...row.review,finding:'changed after payment'});g.data.ownerDeductions=1;g.data.ownerDeductionRows=[{id:row.id,amount:1}];const retry=await g.pay();assert.equal(retry.alreadyPaid,true);assert.equal(retry.finalNetPay,400);assert.equal(retry.frozenData.ownerDeductionDetails[0].label,'Damaged cups 1');assert.equal(g.h.get('cash_accounts/cash').balance,4600);
});
for(const route of ['pay','refund'])test(route+' recovers an old paid snapshot before later custom obligations are validated or allocated',async()=>{
 const f=fixture();seedOwner(f);if(route==='refund')seedRefund(f);const first=await f[route](),balance=f.h.get('cash_accounts/cash').balance,newRows=[];for(let number=2;number<=7;number++)newRows.push(seedOwner(f,{number}));const read=f.h.api.getDocFromServer,paths=[];f.h.api.getDocFromServer=ref=>{paths.push(ref.path);return read(ref);};const result=await f[route]();assert.equal(result.alreadyPaid,true);assert.equal(result.finalNetPay,first.finalNetPay);assert.deepEqual(result.frozenData,first.frozenData);assert.equal(f.h.get('cash_accounts/cash').balance,balance);for(const row of newRows)assert.equal(f.h.get('staff_deductions/'+row.id).status,'Unpaid');assert.equal(paths.some(path=>path.startsWith('owner_deduction_reviews/')),false);
});
test('concurrent different cutoffs cannot consume the same owner-approved source twice',async()=>{
 const f=fixture(),row=seedOwner(f),other=structuredClone(f.data);other.start='2030-01-16';other.end='2030-01-31';const results=await Promise.allSettled([f.pay(),finalizeOrdinaryPayroll({...f.h.api},{data:other,accountId:'cash',finalNetPay:400})]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);assert.equal(f.h.get('cash_accounts/cash').balance,4600);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('payroll_records/')).length,1);assert.equal(f.h.get('staff_deductions/'+row.id).status,'Paid');
});
test('a different cutoff cannot charge a Paid source again, and a clean next cutoff retains only recurring custom charges',async()=>{
 const f=fixture();seedOwner(f);await f.pay();f.data.start='2030-01-16';f.data.end='2030-01-31';await assert.rejects(f.pay(),/owner.added/i);assert.equal(f.h.get('cash_accounts/cash').balance,4600);f.data.ownerDeductions=0;f.data.ownerDeductionRows=[];f.data.customDeductions=[{name:'Wi-Fi',amount:15}];f.data.customDeductionsTotal=15;const next=await f.pay();assert.equal(next.finalNetPay,435);assert.deepEqual(next.frozenData.ownerDeductionDetails,[]);assert.equal(payslipDeductionBreakdown(next.frozenData).groups.some(group=>group.key==='ownerDeductions'),false);
});
test('Owner-only approval is required even when a Manager can otherwise process ordinary payroll',async()=>{
 const f=fixture({manager:true});seedOwner(f);await assert.rejects(f.pay(),/verified Owner/);noDebit(f);assert.equal((await fixture({manager:true}).pay()).finalNetPay,450);
});
test('refund and owner one-time rows share a single atomic payout and return the immutable payment on retry',async()=>{
 const f=fixture(),row=seedOwner(f);seedRefund(f);f.h.loseNextAck();await assert.rejects(f.refund(),/lost after commit/);const paid=await f.refund();assert.equal(paid.alreadyPaid,true);assert.equal(paid.finalNetPay,390);assert.equal(f.h.get('cash_accounts/cash').balance,4610);assert.deepEqual(f.h.get('payroll_records/'+paid.id).ownerDeductionSettlements,{[row.id]:50});assert.equal(f.h.get('owner_deduction_reviews/'+row.id).payrollRecordId,paid.id);
});
test('the conservative combined custom, cash and refund limit preserves no-custom cash/refund behavior',async()=>{
 for(const count of [OWNER_DEDUCTION_LIMIT,OWNER_DEDUCTION_LIMIT+1]){const f=fixture();f.data.basicPay=2000;seedOwner(f);const cash=seedCashShortage(f.h);f.data.cashShortages=90;f.data.cashShortageRows=[{id:cash.id,amount:90}];for(let number=1;number<=count-2;number++)seedRefund(f,number);if(count>OWNER_DEDUCTION_LIMIT){await assert.rejects(f.refund(),/too many linked/);noDebit(f);}else assert.equal((await f.refund()).finalNetPay,2000-50-90-(count-2)*10);}
});
test('preview link hydration reads only exact due private companions and returns minimal display metadata',async()=>{
 const f=fixture(),row=seedOwner(f),future=seedOwner(f,{number:2,effectiveDate:'2030-01-16',include:false}),reads=[],read=f.h.api.getDocFromServer;f.h.api.getDocFromServer=ref=>{reads.push(ref.path);return read(ref);};assert.equal((await readPayrollOwnerDeductions(f.h.api,[],end)).size,0);assert.deepEqual(reads,[]);const result=await readPayrollOwnerDeductions(f.h.api,[row.charge,future.charge],end);assert.deepEqual(reads.sort(),['owner_deduction_reviews/'+row.id,'staff_deduction_notices/'+row.id].sort());assert.equal(result.get(row.id).amount,50);assert.doesNotMatch(JSON.stringify([...result.values()]),/PRIVATE/);assert.equal(ownerDeductionDisplayRows([...result.values()])[0].reviewRevision,2);
});
for(const mode of ['cached','pending','missing','account'])test('preview '+mode+' linked evidence cannot confirm a custom payroll amount',async()=>{
 const f=fixture(),row=seedOwner(f),read=f.h.api.getDocFromServer;f.h.api.getDocFromServer=async ref=>{const snap=await read(ref);if(mode==='cached')snap.metadata.fromCache=true;if(mode==='pending')snap.metadata.hasPendingWrites=true;if(mode==='missing')snap.exists=()=>false;if(mode==='account')f.h.api.auth.currentUser.uid='other';return snap;};await assert.rejects(readPayrollOwnerDeductions(f.h.api,[row.charge],end));noDebit(f);
});
test('frozen custom details are escaped, individual and independent of current profile or private fields',async()=>{
 const f=fixture(),row=seedOwner(f);for(const table of ['staff_deductions','owner_deduction_reviews','staff_deduction_notices'])f.h.put(table+'/'+row.id,{...f.h.get(table+'/'+row.id),label:'<img src=x> Damaged cups'});const paid=await f.pay(),html=payslipDeductionDetailsHTML(paid.frozenData);assert.match(html,/&lt;img src=x&gt; Damaged cups/);assert.match(html,/Incident date 2030-01-01/);assert.match(html,/Payroll effective 2030-01-01/);assert.doesNotMatch(html,/<img\b|PRIVATE|Forged/);assert.equal(payslipDeductionBreakdown({frozenData:paid.frozenData,ownerDeductions:9999}).total,50);
});
test('canonical custom tuples reject mismatches without changing recurring profile deductions or a frozen input',()=>{
 const f=fixture(),row=seedOwner(f),before=structuredClone(f.data);assert.deepEqual(payrollOwnerDeductionRows(f.data),[{id:row.id,amount:50}]);assert.throws(()=>validateOrdinaryPayrollSnapshot({...f.data,ownerDeductions:45},405),/details/);assert.throws(()=>validateOrdinaryPayrollSnapshot(f.data,-1));assert.deepEqual(f.data,before);
});
