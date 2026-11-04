import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createPayrollAdjustmentService} from '../takodeal-manager/payroll-adjustments.js';
import {PAYROLL_ADJUSTMENT_TYPE,payrollAdjustmentPreview,payrollAdjustmentDetailsHTML,payrollAdjustmentHistoryHTML,savedPayrollAdjustmentDetails} from '../takodeal-manager/payroll-adjustment-model.js';
import {finalizeOrdinaryPayroll,ordinaryPayrollId} from '../takodeal-manager/payroll-settlement.js';
import {createRefundPayrollEngine} from '../takodeal-manager/refund-payroll.js';
import {payrollEstimate} from '../takodeal-manager/payroll-completion.js';

const staffId='synthetic-adjustment-staff',name='Fictional Adjustment Crew',branch='Synthetic Adjustment Branch';
const ownerEmail='jgo031996@gmail.com',today='2030-02-01',start=today,end='2030-02-15';
const original={staffId,staffName:name,branch,startDate:'2030-01-01',endDate:'2030-01-15',finalNetPay:1000,accountId:'old-bank',processedAt:new Date('2030-01-16T00:00:00Z'),frozenData:{staffId,name,branch,start:'2030-01-01',end:'2030-01-15',basicPay:1000,isPaid:true,finalNetPay:1000,logs:[{date:'Jan 1',in:'08:00',out:'17:00',remark:'Original saved record'}]}};
const input=extra=>({staffId,originalStart:'2030-01-01',originalEnd:'2030-01-15',effectiveDate:today,amount:125,reason:'The original night allowance was missed.',sourcePayrollRecordId:'original-paid',...extra});
function fixture({paid=true}={}){
 const h=firestoreHarness(),uid='synthetic-owner';h.api.auth={currentUser:{uid,email:ownerEmail,emailVerified:true,providerData:[{providerId:'google.com'}]}};
 h.api.sessionUser={uid,email:ownerEmail,isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']};
 h.put('hq_managers/'+uid,{email:ownerEmail,role:'System Architect',permissions:['all'],assignedBranch:'All',active:true,pin:'fixture-only'});
 const profile={staffId,cashierName:name,branch,role:'Crew',hourlyRate:450,dateHired:'2029-01-01'};h.put('cashiers/'+staffId,profile);h.put('cash_accounts/current-bank',{name:'Fictional Current Bank',branch,balance:5000});if(paid)h.put('payroll_records/original-paid',structuredClone(original));
 h.api.getDocFromServer=async ref=>({ref,id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const service=createPayrollAdjustmentService(h.api,{now:()=>new Date(today+'T00:00:00+08:00')});
 const data={staffId,name,branch,start,end,profile,basicPay:450,nightBonus:0,straightBonus:0,holidayPayTotal:0,perfBonus:0,meals:0,advances:0,loans:0,customDeductions:[],customDeductionsTotal:0};
 const f={h,service,data};f.credit=async extra=>{const result=await service.create(input(extra));const row={...h.get('staff_bonuses/'+result.id),id:result.id};const preview=payrollAdjustmentPreview([row],{staffId,name,branch,start,end});data.payrollAdjustments=(data.payrollAdjustments||0)+preview.amount;(data.payrollAdjustmentRows||=[]).push(...preview.rows);return {...result,row};};
 f.pay=extra=>finalizeOrdinaryPayroll(h.api,{data,accountId:'current-bank',finalNetPay:450+(data.payrollAdjustments||0),...extra});return f;
}
const all=f=>structuredClone([...f.h.docs]);
const credits=f=>[...f.h.docs.entries()].filter(([path])=>path.startsWith('staff_bonuses/'));

test('Owner credit creation records the exact paid source and review without changing old payroll, cash or staff profile',async()=>{
 const f=fixture(),before=all(f),result=await f.service.create(input()),row=f.h.get('staff_bonuses/'+result.id);
 assert.equal(result.alreadySaved,false);assert.equal(row.type,PAYROLL_ADJUSTMENT_TYPE);assert.equal(row.payrollAdjustmentVersion,1);assert.equal(row.status,'Unpaid');assert.equal(row.sourcePayrollRecordId,'original-paid');assert.equal(row.amount,125);assert.equal(row.createdByEmail,ownerEmail);assert.equal(row.staffId,staffId);assert.equal(row.originalEnd,'2030-01-15');
 assert.deepEqual([...f.h.docs].filter(([path])=>!path.startsWith('staff_bonuses/')),before);assert.equal(credits(f).length,1);
});
test('identical review retries, concurrent submits and lost acknowledgement create exactly one unchanged credit',async()=>{
 const f=fixture(),results=await Promise.all([f.service.create(input()),f.service.create(input())]);assert.equal(new Set(results.map(row=>row.id)).size,1);assert.equal(credits(f).length,1);
 const before=all(f);assert.equal((await f.service.create(input())).alreadySaved,true);assert.deepEqual(all(f),before);
 const g=fixture();g.h.loseNextAck();await assert.rejects(g.service.create(input()),/lost after commit/);const saved=all(g),retry=await g.service.create(input());assert.equal(retry.alreadySaved,true);assert.equal(credits(g).length,1);assert.deepEqual(all(g),saved);
});
test('a forgotten unpaid cutoff can be credited without inventing an original paid record',async()=>{
 const f=fixture({paid:false}),result=await f.service.create(input({sourcePayrollRecordId:''}));assert.equal(result.status,'Unpaid');assert.equal(f.h.get('staff_bonuses/'+result.id).sourcePayrollRecordId,'');assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('payroll_records/')),false);
});
for(const change of [{amount:-1},{amount:0},{amount:1.001},{originalEnd:'2030-02-02'},{effectiveDate:'2030-01-31'},{originalStart:'2030-02-30'},{reason:'short'},{sourcePayrollRecordId:''},{sourcePayrollRecordId:'wrong-record'}])test('invalid or mismatched credit review is rejected without writes: '+JSON.stringify(change),async()=>{
 const f=fixture(),before=all(f);await assert.rejects(f.service.create(input(change)));assert.deepEqual(all(f),before);
});
for(const change of ['manager','unverified','provider','session','saved-owner','inactive-staff'])test('credit creation freshly refuses '+change+' authority before a write',async()=>{
 const f=fixture();if(change==='manager')f.h.api.auth.currentUser.email=f.h.api.sessionUser.email='manager@example.invalid';if(change==='unverified')f.h.api.auth.currentUser.emailVerified=false;if(change==='provider')f.h.api.auth.currentUser.providerData=[];if(change==='session')f.h.api.sessionUser.uid='other';if(change==='saved-owner')f.h.put('hq_managers/synthetic-owner',{email:ownerEmail,active:false});if(change==='inactive-staff')f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),status:'Resigned'});const before=all(f);await assert.rejects(f.service.create(input()));assert.deepEqual(all(f),before);
});
test('changed original paid figures and switched selection are checked again inside the creation transaction',async()=>{
 for(const mode of ['source','selection']){const f=fixture(),run=f.h.api.runTransaction;let current=true;f.h.api.runTransaction=async(...args)=>{if(mode==='source')f.h.put('payroll_records/original-paid',{...structuredClone(original),finalNetPay:900});else current=false;return run(...args);};await assert.rejects(f.service.create(input(),{assertCurrent:()=>{if(!current)throw Error('Selection changed');}}));assert.equal(credits(f).length,0);assert.equal(f.h.get('cash_accounts/current-bank').balance,5000);}
});
test('only an unpaid credit can be cancelled, preserving its original review and idempotent history',async()=>{
 const f=fixture(),created=await f.credit(),row=structuredClone(created.row),result=await f.service.cancel(created.id,{reason:'The earlier review used the wrong allowance amount.'});assert.equal(result.status,'Cancelled');const saved=f.h.get('staff_bonuses/'+created.id);for(const key of ['amount','originalStart','originalEnd','sourcePayrollRecordId','reason','createdAt'])assert.deepEqual(saved[key],row[key]);assert.equal(saved.cancelledByEmail,ownerEmail);assert.equal((await f.service.cancel(created.id,{reason:saved.cancelReason})).alreadySaved,true);
 const g=fixture(),paid=await g.credit();await g.pay();const before=all(g);await assert.rejects(g.service.cancel(paid.id,{reason:'Cannot cancel a credit already included in paid payroll.'}));assert.deepEqual(all(g),before);
});

test('Owner can cancel the same stable employee credit after a rename or branch transfer without rewriting its original review',async()=>{
 for(const change of ['rename','transfer']){
  const f=fixture(),created=await f.service.create(input()),path='staff_bonuses/'+created.id,credit=structuredClone(f.h.get(path));
  const person={...f.h.get('cashiers/'+staffId),...(change==='rename'?{cashierName:'Renamed Fictional Crew'}:{branch:'Transferred Fictional Branch'})};f.h.put('cashiers/'+staffId,person);
  const before=all(f),reason='Cancel this stale credit after reviewing the changed saved employee profile.';
  const result=await f.service.cancel(created.id,{reason}),saved=f.h.get(path);
  assert.equal(result.status,'Cancelled');assert.equal(saved.cancelledByEmail,ownerEmail);
  for(const field of ['staffId','staffName','branch','amount','reason','originalStart','originalEnd','effectiveDate','sourcePayrollRecordId','createIntent','createdAt'])assert.deepEqual(saved[field],credit[field]);
  assert.deepEqual([...f.h.docs].filter(([name])=>name!==path),before.filter(([name])=>name!==path));
  assert.equal((await f.service.cancel(created.id,{reason})).alreadySaved,true);assert.equal(f.h.get('cash_accounts/current-bank').balance,5000);
 }
});

test('an ordinary or refund payment appearing after credit preflight requires refreshing the original paid source before credit creation',async()=>{
 for(const kind of ['ordinary','refund']){
  const f=fixture({paid:false}),ordinary=ordinaryPayrollId(staffId,'2030-01-01','2030-01-15'),sourceId=kind==='ordinary'?ordinary:ordinary.replace(/^payroll-/,'refund-payroll-'),run=f.h.api.runTransaction;
  let inserted=false;f.h.api.runTransaction=(db,callback)=>{if(!inserted){inserted=true;f.h.put('payroll_records/'+sourceId,structuredClone(original));}return run(db,callback);};
  await assert.rejects(f.service.create(input({sourcePayrollRecordId:''})),/original|paid|refresh|reopen/i);
  assert.equal(credits(f).length,0);assert.deepEqual(f.h.get('payroll_records/'+sourceId),original);assert.equal(f.h.get('cash_accounts/current-bank').balance,5000);
  const checked=await f.service.create(input({sourcePayrollRecordId:sourceId}));assert.equal(credits(f).length,1);assert.equal(f.h.get('staff_bonuses/'+checked.id).sourcePayrollRecordId,sourceId);
 }
});
test('ordinary payroll includes a separate full credit and settles it once without rewriting the original paid cutoff',async()=>{
 const f=fixture(),credit=await f.credit(),before=structuredClone(f.h.get('payroll_records/original-paid')),result=await f.pay();assert.equal(result.finalNetPay,575);assert.equal(f.h.get('cash_accounts/current-bank').balance,4425);assert.equal(result.frozenData.payrollAdjustments,125);assert.equal(result.frozenData.perfBonus,0);assert.deepEqual(result.frozenData.payrollAdjustmentRows,f.data.payrollAdjustmentRows);assert.equal(f.h.get('staff_bonuses/'+credit.id).status,'Paid');assert.equal(f.h.get('staff_bonuses/'+credit.id).payrollRecordId,result.id);assert.deepEqual(f.h.get('payroll_records/original-paid'),before);assert.equal(payrollEstimate(result.frozenData),575);
 const after=all(f),retry=await f.pay({data:{...f.data,basicPay:9999,payrollAdjustments:0,payrollAdjustmentRows:[]},finalNetPay:9999});assert.equal(retry.alreadyPaid,true);assert.equal(retry.finalNetPay,575);assert.deepEqual(all(f),after);
});
test('an overdue unpaid credit carries forward by its effective date while future credits remain pending',async()=>{
 const f=fixture();const due=await f.credit();const future=await f.service.create(input({amount:25,effectiveDate:'2030-03-01',reason:'A separate future-dated payroll difference was confirmed.'}));const result=await f.pay();assert.equal(result.finalNetPay,575);assert.equal(f.h.get('staff_bonuses/'+due.id).status,'Paid');assert.equal(f.h.get('staff_bonuses/'+future.id).status,'Unpaid');
 const row={...f.h.get('staff_bonuses/'+future.id),id:future.id};const later=payrollAdjustmentPreview([row],{staffId,name,branch,start:'2030-04-01',end:'2030-04-15'});assert.equal(later.amount,25);
});
for(const change of ['omitted','partial','duplicate','reason','source','missing','paid','branch'])test('settlement rejects '+change+' credit data before any financial write',async()=>{
 const f=fixture(),credit=await f.credit();if(change==='omitted'){f.data.payrollAdjustments=0;f.data.payrollAdjustmentRows=[];}if(change==='partial'){f.data.payrollAdjustments=50;f.data.payrollAdjustmentRows[0].amount=50;}if(change==='duplicate'){f.data.payrollAdjustmentRows.push({...f.data.payrollAdjustmentRows[0]});f.data.payrollAdjustments=250;}if(change==='reason')f.data.payrollAdjustmentRows[0].reason='A changed unsaved reason cannot replace the original.';if(change==='source')f.data.payrollAdjustmentRows[0].sourcePayrollRecordId='another-source';if(change==='missing')f.h.docs.delete('staff_bonuses/'+credit.id);if(change==='paid')f.h.put('staff_bonuses/'+credit.id,{...credit.row,status:'Paid'});if(change==='branch')f.h.put('staff_bonuses/'+credit.id,{...credit.row,branch:'Other Branch'});const before=all(f);await assert.rejects(f.pay());assert.deepEqual(all(f),before);
});
test('failed commits, lost responses and concurrent payroll clients cannot pay a positive credit twice',async()=>{
 const f=fixture();await f.credit();const before=all(f);f.h.failNextCommit();await assert.rejects(f.pay(),/rejected/);assert.deepEqual(all(f),before);f.h.loseNextAck();await assert.rejects(f.pay(),/lost after commit/);const committed=all(f);const retry=await f.pay();assert.equal(retry.alreadyPaid,true);assert.deepEqual(all(f),committed);
 const g=fixture();await g.credit();const results=await Promise.all([g.pay(),finalizeOrdinaryPayroll({...g.h.api},{data:g.data,accountId:'current-bank',finalNetPay:575})]);assert.equal(results.filter(row=>!row.alreadyPaid).length,1);assert.equal(g.h.get('cash_accounts/current-bank').balance,4425);
});
test('refund payroll uses the same distinct credit and exact once-settlement beside its refund deduction',async()=>{
 const f=fixture(),credit=await f.credit();for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])f.h.put(table+'/synthetic-refund',{staffId,staffName:name,branch,type:'Online Order Refund',amount:25,status:'Unpaid',dateAdded:new Date(start+'T00:00:00+08:00')});f.data.onlineRefunds=25;f.data.onlineRefundRows=[{id:'synthetic-refund',amount:25}];const engine=createRefundPayrollEngine(f.h.api,{ownerCheck:()=>true}),request={data:f.data,accountId:'current-bank',finalNetPay:550};f.h.loseNextAck();await assert.rejects(engine.pay(request),/lost after commit/);const paid=await engine.pay(request);assert.equal(paid.alreadyPaid,true);assert.equal(paid.finalNetPay,550);assert.equal(paid.frozenData.payrollAdjustmentRows[0].reason,input().reason);assert.equal(f.h.get('cash_accounts/current-bank').balance,4450);assert.equal(f.h.get('staff_bonuses/'+credit.id).payrollRecordId,paid.id);assert.equal(f.h.get('payroll_records/original-paid').finalNetPay,1000);
});

test('a caller-supplied refund approval callback cannot let a Manager settle an Owner payroll credit',async()=>{
 const f=fixture();await f.credit();for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])f.h.put(table+'/synthetic-refund',{staffId,staffName:name,branch,type:'Online Order Refund',amount:25,status:'Unpaid',dateAdded:new Date(start+'T00:00:00+08:00')});f.data.onlineRefunds=25;f.data.onlineRefundRows=[{id:'synthetic-refund',amount:25}];f.h.api.auth.currentUser.email=f.h.api.sessionUser.email='manager@example.invalid';f.h.api.sessionUser.isOwner=false;const before=all(f),engine=createRefundPayrollEngine(f.h.api,{ownerCheck:()=>true});await assert.rejects(engine.pay({data:f.data,accountId:'current-bank',finalNetPay:550}),/verified Owner/);assert.deepEqual(all(f),before);
});
test('Staff credit details display original cutoff, escaped reason, amount and payment status independently of current profile',async()=>{
 const f=fixture(),credit=await f.credit({reason:'Missed <script> allowance & adjustment'});const html=payrollAdjustmentDetailsHTML(f.data,{live:true});assert.match(html,/2030-01-01/);assert.match(html,/125.00/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(payrollAdjustmentHistoryHTML([credit.row]),/Pending next eligible payroll/);await f.pay();assert.match(payrollAdjustmentHistoryHTML([{...f.h.get('staff_bonuses/'+credit.id),id:credit.id}]),/Included in paid payslip/);assert.deepEqual(savedPayrollAdjustmentDetails(f.data).rows,f.data.payrollAdjustmentRows);
});
