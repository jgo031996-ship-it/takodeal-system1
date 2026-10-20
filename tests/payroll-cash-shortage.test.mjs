import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {seedCashShortage} from './helpers/cash-shortage-fixture.mjs';
import {finalizeOrdinaryPayroll,ordinaryPayrollId,readPayrollCashShortages,validateOrdinaryPayrollSnapshot} from '../takodeal-manager/payroll-settlement.js';
import {finalizeRefundPayroll,createRefundPayrollEngine} from '../takodeal-manager/refund-payroll.js';
import {CASH_SHORTAGE_LIMIT} from '../takodeal-manager/cash-shortage-model.js';
import {payrollEstimate} from '../takodeal-manager/payroll-completion.js';
const staffId='sample-staff',name='Sample Staff',branch='Maa',start='2030-01-01',end='2030-01-15',recordId=ordinaryPayrollId(staffId,start,end);
function fixture({manager=false}={}){
 const h=firestoreHarness(),uid=manager?'manager':'owner',email=manager?'manager@example.test':'jgo031996@gmail.com';
 h.api.auth={currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}};h.api.sessionUser={uid,email,isOwner:!manager,isFranchisee:false,role:manager?'Manager':'Owner',permissions:['payroll'],allowedBranches:['All']};
 h.put('hq_managers/'+uid,{email,cashierName:'HQ',pin:'1234',role:manager?'Manager':'System Architect',permissions:['payroll'],assignedBranch:'All'});h.put('hq_email_access/'+email,{active:true,permissions:['payroll'],allowedBranches:['All']});
 const profile={staffId,cashierName:name,branch,hourlyRate:450};h.put('cashiers/'+staffId,profile);h.put('cash_accounts/cash',{name:'Bank',branch,balance:5000});
 h.api.getDocFromServer=async ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const data={staffId,name,branch,start,end,profile,basicPay:450,nightBonus:0,holidayPayTotal:0,straightBonus:0,perfBonus:0,lateDeduction:0,sss:0,pagibig:0,philhealth:0,advances:0,meals:0,loans:0,cashShortages:0,cashShortageRows:[]};
 return {h,data,pay:(overrides={})=>finalizeOrdinaryPayroll(h.api,{data,accountId:'cash',finalNetPay:450-data.cashShortages,...overrides})};
}
function charge(f,options={}){const row=seedCashShortage(f.h,options);f.data.cashShortages+=row.review.amount;f.data.cashShortageRows.push({id:row.id,amount:row.review.amount});return row;}
function changeBeforeTransaction(f,work){const run=f.h.api.runTransaction;let once=true;f.h.api.runTransaction=async(...args)=>{if(once){once=false;work();}return run(...args);};}
function noDebit(f){assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal([...f.h.docs.keys()].some(path=>path.startsWith('payroll_records/')||path.startsWith('expenses/')),false);}
function seedRefund(f,{id='online-refund',amount=80}={}){const row={id,staffId,staffName:name,branch,type:'Online Order Refund',amount,status:'Unpaid',dateAdded:new Date('2030-01-02T12:00:00+08:00')};for(const table of ['staff_deductions','online_order_incidents','staff_deduction_notices'])f.h.put(table+'/'+id,{...row});f.data.onlineRefunds=(f.data.onlineRefunds||0)+amount;(f.data.onlineRefundRows||=[]).push({id,amount});return row;}

test('one reviewed cash shortage is included once and all linked records commit Paid with one frozen full amount',async()=>{
 const f=fixture(),row=charge(f),result=await f.pay();assert.equal(result.finalNetPay,360);assert.equal(f.h.get('cash_accounts/cash').balance,4640);
 const record=f.h.get('payroll_records/'+recordId);assert.deepEqual(record.cashShortageSettlements,{[row.id]:90});assert.deepEqual(record.frozenData.cashShortageRows,[{id:row.id,amount:90}]);assert.equal(record.frozenData.cashShortages,90);assert.equal(payrollEstimate(f.data),360);
 for(const table of ['staff_deductions','cash_shortage_reviews','staff_deduction_notices']){const paid=f.h.get(table+'/'+row.id);assert.equal(paid.status,'Paid');assert.equal(paid.payrollRecordId,recordId);assert.deepEqual(paid.paidAt,record.processedAt);assert.equal(paid.amount,90);}
 assert.equal(f.h.get('cash_shortage_reviews/'+row.id).revision,2);assert.deepEqual(f.h.get('shifts/'+row.shiftId),row.shift);
});

test('cash shortage repeated clicks, separate clients and a lost acknowledgement debit once and preserve saved payroll after source changes',async()=>{
 const f=fixture(),row=charge(f);await Promise.all([f.pay(),finalizeOrdinaryPayroll({...f.h.api},{data:f.data,accountId:'cash',finalNetPay:360})]);assert.equal(f.h.get('cash_accounts/cash').balance,4640);
 const g=fixture(),other=charge(g);g.h.loseNextAck();await assert.rejects(g.pay(),/lost after commit/);g.h.put('shifts/'+other.shiftId,{...other.shift,declaredCash:1});g.data.cashShortages=1;g.data.cashShortageRows=[{id:other.id,amount:1}];
 const retry=await g.pay({finalNetPay:449});assert.equal(retry.alreadyPaid,true);assert.equal(retry.frozenData.cashShortages,90);assert.equal(retry.finalNetPay,360);assert.equal(g.h.get('cash_accounts/cash').balance,4640);
 assert.equal([...g.h.docs.keys()].filter(path=>path.startsWith('payroll_records/')).length,1);assert.equal(f.h.get('staff_deductions/'+row.id).status,'Paid');
});

for(const failure of ['case','notice','source','deleted','identity','amount','effective','reply'])test('a fresh '+failure+' change holds the whole cash shortage payment without a partial debit',async()=>{
 const f=fixture(),row=charge(f);changeBeforeTransaction(f,()=>{
  if(failure==='case')f.h.put('cash_shortage_reviews/'+row.id,{...row.review,status:'Cancelled'});
  if(failure==='notice')f.h.put('staff_deduction_notices/'+row.id,{...row.notice,status:'Pending Review'});
  if(failure==='source')f.h.put('shifts/'+row.shiftId,{...row.shift,declaredCash:14200});
  if(failure==='deleted')f.h.docs.delete('staff_deduction_notices/'+row.id);
  if(failure==='identity')f.h.put('staff_deductions/'+row.id,{...row.deduction,staffId:'other-person'});
  if(failure==='amount')f.h.put('staff_deductions/'+row.id,{...row.deduction,amount:80});
  if(failure==='effective')f.h.put('cash_shortage_reviews/'+row.id,{...row.review,effectiveDate:'2030-01-16'});
  if(failure==='reply')f.h.put('staff_deduction_notices/'+row.id,{...row.notice,replyRevision:2});
 });await assert.rejects(f.pay(),/cash shortage|closed shift|cash totals/i);noDebit(f);
});

test('a stale generator cannot omit, duplicate, alter or partially charge a due approved cash shortage',async()=>{
 for(const failure of ['omitted','partial','duplicate','total','forged']){const f=fixture(),row=charge(f);
  if(failure==='omitted'){f.data.cashShortages=0;f.data.cashShortageRows=[];}
  if(failure==='partial'){f.data.cashShortages=50;f.data.cashShortageRows[0].amount=50;}
  if(failure==='duplicate'){f.data.cashShortages=180;f.data.cashShortageRows.push({id:row.id,amount:90});}
  if(failure==='total')f.data.cashShortages=80;
  if(failure==='forged')f.data.cashShortageRows[0].id='cash-shortage-not-real';
  await assert.rejects(f.pay(),/cash shortage|approved amount/i);noDebit(f);
 }
});

test('staff ID query catches renamed or forged names rather than silently omitting a due charge',async()=>{
 const f=fixture(),row=seedCashShortage(f.h);f.h.put('staff_deductions/'+row.id,{...row.deduction,staffName:'Different name'});await assert.rejects(f.pay(),/cash shortage/i);noDebit(f);
});

test('future and Pending Review cash shortages do not charge earlier work or change old paid cutoffs',async()=>{
 const f=fixture(),future=seedCashShortage(f.h,{effectiveDate:'2030-01-16'}),pending=seedCashShortage(f.h,{shiftId:'pending'});f.h.put('staff_deductions/'+pending.id,{...pending.deduction,status:'Pending Review',amount:0});
 const paid=await f.pay();assert.equal(paid.finalNetPay,450);assert.equal(paid.frozenData.cashShortages,0);assert.deepEqual(paid.frozenData.cashShortageRows,[]);assert.equal(f.h.get('staff_deductions/'+future.id).status,'Unpaid');assert.equal(f.h.get('staff_deductions/'+pending.id).status,'Pending Review');
 Object.assign(f.data,{start:'2030-01-16',end:'2030-01-31',cashShortages:90,cashShortageRows:[{id:future.id,amount:90}]});const next=await f.pay();assert.equal(next.finalNetPay,360);assert.equal(f.h.get('payroll_records/'+recordId).finalNetPay,450);
});

test('Manager can pay ordinary payroll but a protected cash shortage requires the verified Owner',async()=>{
 const f=fixture({manager:true});charge(f);await assert.rejects(f.pay(),/verified Owner/);noDebit(f);const g=fixture({manager:true});assert.equal((await g.pay()).finalNetPay,450);
});

test('cash shortage can never make net pay negative and legacy penalties remain excluded',async()=>{
 const f=fixture();charge(f);f.data.basicPay=80;await assert.rejects(f.pay({finalNetPay:-10}),/range/);noDebit(f);
 const g=fixture();g.h.put('staff_deductions/legacy',{staffId,staffName:name,branch,type:'Penalty',amount:900,status:'Unpaid',dateAdded:new Date('2030-01-02T00:00:00Z')});assert.equal((await g.pay()).finalNetPay,450);assert.equal(g.h.get('staff_deductions/legacy').status,'Unpaid');
});

test('more than the safe protected case limit holds, while six full linked cash cases can commit',async()=>{
 for(const n of [CASH_SHORTAGE_LIMIT,CASH_SHORTAGE_LIMIT+1]){const f=fixture();f.data.basicPay=2000;for(let i=0;i<n;i++)charge(f,{shiftId:'case-'+i});if(n>CASH_SHORTAGE_LIMIT){await assert.rejects(f.pay({finalNetPay:2000-f.data.cashShortages}),/too many/);noDebit(f);}else assert.equal((await f.pay({finalNetPay:2000-f.data.cashShortages})).finalNetPay,1460);}
});

test('refund and cash shortage combine in one atomic debit and immutable snapshot; retry returns that exact saved cutoff',async()=>{
 const f=fixture(),row=charge(f);seedRefund(f);const input={data:f.data,accountId:'cash',finalNetPay:280};f.h.loseNextAck();await assert.rejects(finalizeRefundPayroll(f.h.api,input),/lost after commit/);
 const result=await finalizeRefundPayroll(f.h.api,input);assert.equal(result.alreadyPaid,true);assert.equal(result.finalNetPay,280);assert.equal(result.frozenData.cashShortages,90);assert.equal(f.h.get('cash_accounts/cash').balance,4720);
 const saved=f.h.get('payroll_records/'+result.id);assert.deepEqual(saved.cashShortageSettlements,{[row.id]:90});assert.deepEqual(saved.refundSettlements,{'online-refund':80});assert.equal(f.h.get('cash_shortage_reviews/'+row.id).payrollRecordId,result.id);
});

test('refund path rejects changed cash sources and omitted charges before any refund or cash case is marked paid',async()=>{
 for(const failure of ['source','omitted','authority']){const f=fixture(),row=charge(f);seedRefund(f);
  if(failure==='omitted'){f.data.cashShortages=0;f.data.cashShortageRows=[];}
  else changeBeforeTransaction(f,()=>failure==='source'?f.h.put('shifts/'+row.shiftId,{...row.shift,declaredCash:0}):f.h.put('hq_managers/owner',{...f.h.get('hq_managers/owner'),active:false}));
  await assert.rejects(finalizeRefundPayroll(f.h.api,{data:f.data,accountId:'cash',finalNetPay:370-f.data.cashShortages}),/cash shortage|HQ account/i);noDebit(f);assert.equal(f.h.get('staff_deductions/online-refund').status,'Unpaid');assert.equal(f.h.get('staff_deductions/'+row.id).status,'Unpaid');
 }
});

test('mixed cash and refund protected rows exceeding the conservative Rules limit are held without writing',async()=>{
 const f=fixture();f.data.basicPay=2000;for(let i=0;i<3;i++)charge(f,{shiftId:'cash-'+i});for(let i=0;i<4;i++)seedRefund(f,{id:'refund-'+i,amount:10});
 await assert.rejects(createRefundPayrollEngine(f.h.api,{ownerCheck:()=>true}).pay({data:f.data,accountId:'cash',finalNetPay:1690}),/too many linked/);noDebit(f);
});

test('generation verifies due protected links and original shift, skips future rows and performs no new reads for normal payroll',async()=>{
 const f=fixture(),row=seedCashShortage(f.h),future=seedCashShortage(f.h,{shiftId:'future',effectiveDate:'2030-01-16'}),reads=[];const read=f.h.api.getDocFromServer;f.h.api.getDocFromServer=async reference=>{reads.push(reference.path);return read(reference);};
 assert.equal((await readPayrollCashShortages(f.h.api,[],end)).size,0);assert.deepEqual(reads,[]);
 const result=await readPayrollCashShortages(f.h.api,[row.deduction,future.deduction],end);assert.deepEqual([...result.values()].map(({id,amount})=>({id,amount})),[{id:row.id,amount:90}]);assert.deepEqual(reads.sort(),['cash_shortage_reviews/'+row.id,'shifts/'+row.shiftId,'staff_deduction_notices/'+row.id].sort());
 f.h.put('shifts/'+row.shiftId,{...row.shift,declaredCash:100});await assert.rejects(readPayrollCashShortages(f.h.api,[row.deduction],end),/cash shortage/i);
});

test('generation rejects cached links, changed accounts and a late failure without leaving in-flight reads',async()=>{
 for(const mode of ['cache','actor']){const f=fixture(),row=seedCashShortage(f.h),read=f.h.api.getDocFromServer;f.h.api.getDocFromServer=async reference=>{const snap=await read(reference);if(mode==='cache')snap.metadata.fromCache=true;else f.h.api.auth.currentUser={...f.h.api.auth.currentUser,uid:'other'};return snap;};await assert.rejects(readPayrollCashShortages(f.h.api,[row.deduction],end),/confirmed|account|Google/);noDebit(f);}
 const f=fixture();assert.throws(()=>validateOrdinaryPayrollSnapshot({...f.data,cashShortages:90,cashShortageRows:[]},360),/details/);
});
