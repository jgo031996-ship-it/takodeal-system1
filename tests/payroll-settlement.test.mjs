import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {finalizeOrdinaryPayroll,ordinaryPayrollId,validateOrdinaryPayrollSnapshot,confirmedPayrollResult,PAYROLL_SETTLEMENT_LIMITS,sameSavedPayrollValue,checkSavedPayrollPayment} from '../takodeal-manager/payroll-settlement.js';
import {createRefundPayrollEngine,finalizeRefundPayroll,freezeRefundPayslip} from '../takodeal-manager/refund-payroll.js';
const branch='Maa',staffId='sample-staff',name='Sample Staff',start='2030-01-01',end='2030-01-15';
const paymentId=ordinaryPayrollId(staffId,start,end),refundPaymentId='refund-payroll-'+staffId+'-'+start+'-'+end;
const at=day=>new Date(`2030-01-${String(day).padStart(2,'0')}T12:00:00+08:00`);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({manager=false}={}){
 const h=firestoreHarness(),uid=manager?'sample-manager':'sample-owner',email=manager?'payroll@example.test':'jgo031996@gmail.com';
 h.api.auth={currentUser:{uid,email,emailVerified:true,providerData:[{providerId:'google.com'}]}};
 h.api.sessionUser={uid,email,isOwner:!manager,isFranchisee:false,role:manager?'Manager':'Owner',permissions:['payroll'],allowedBranches:manager?[branch]:['All']};
 h.put('hq_managers/'+uid,{email,cashierName:'Sample HQ',pin:'1234',role:manager?'Manager':'System Architect',permissions:['payroll'],assignedBranch:manager?branch:'All'});
 h.put('hq_email_access/'+email,{active:true,permissions:['payroll'],allowedBranches:manager?[branch]:['All']});
 const profile={staffId,cashierName:name,branch,role:'Crew',hourlyRate:450,dateHired:'2029-01-01',pin:'PRIVATE PIN',phone:'PRIVATE PHONE',bankAccount:'PRIVATE BANK'};
 h.put('cashiers/'+staffId,profile);h.put('cash_accounts/cash',{name:'Sample Cash',branch:manager?branch:'Main Office',balance:5000});
 h.api.getDocFromServer=async ref=>({id:ref.id,ref,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const data={staffId,name,branch,start,end,profile:{...profile},hours:8,shiftsWorked:1,basicPay:450,nightBonus:0,straightBonus:0,holidayPayTotal:0,perfBonus:0,lateDeduction:0,sss:0,philhealth:0,pagibig:0,advances:0,meals:0,loans:0,customDeductions:[],customDeductionsTotal:0,logs:[{date:'Jan 1',in:'09:00',out:'17:00',hrs:'8.00',remark:'Complete'}]};
 const input={data,accountId:'cash',finalNetPay:450,sourcePerfBonus:0};
 return {h,data,input,pay:overrides=>finalizeOrdinaryPayroll(h.api,{...input,...overrides})};
}
const paths=(h,table)=>[...h.docs.keys()].filter(path=>path.startsWith(table+'/'));
function deduction(id,amount,type='Staff Meal',day=3,extra={}){return {staffId,staffName:name,branch,type,amount,status:'Unpaid',dateAdded:at(day),...extra};}
function reward(amount,day=3,extra={}){return {staffId,staffName:name,branch,type:'Performance Bonus',status:'Unpaid',amount,dateAdded:at(day),...extra};}
function afterPreflight(f,work){const run=f.h.api.runTransaction;let once=true;f.h.api.runTransaction=async(...args)=>{if(once){once=false;await work();}return run(...args);};}
function refundData(){return {staffId,name,branch,start,end,profile:{staffId,cashierName:name,hourlyRate:450,dateHired:'2029-01-01'},basicPay:450,onlineRefunds:80,onlineRefundRows:[{id:'online-refund-sample',amount:80}],advances:0,meals:0,loans:0,perfBonus:0};}
function seedRefund(h){h.put('staff_deductions/online-refund-sample',deduction('online-refund-sample',80,'Online Order Refund'));h.put('online_order_incidents/online-refund-sample',{staffId,status:'Unpaid'});h.put('staff_deduction_notices/online-refund-sample',{staffId,status:'Unpaid'});}
const reverseMaps=value=>value instanceof Date?new Date(value):Array.isArray(value)?value.map(reverseMaps):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,row])=>[key,reverseMaps(row)])):value;
function varyPayrollReadOrder(f,transform=reverseMaps){const read=f.h.api.getDocsFromServer;f.h.api.getDocsFromServer=async reference=>{const snap=await read(reference);return reference.table==='payroll_records'?{...snap,docs:snap.docs.map(row=>({...row,data:()=>{const saved=row.data();return {...saved,frozenData:transform(saved.frozenData)};}}))}:snap;};}
function savedRecord(f,extra={}){return {staffId,staffName:name,branch,startDate:start,endDate:end,finalNetPay:450,accountId:'previous-bank',accountName:'Original Payment Bank',acknowledged:false,frozenData:{...structuredClone(f.data),isPaid:true,finalNetPay:450},...extra};}

test('Firestore nested map order cannot block a new cutoff because a different old paid record is serialized in another order',async()=>{
 const f=fixture(),old=savedRecord(f,{startDate:'2029-12-16',endDate:'2029-12-31'});old.frozenData.logs[0].recordedAt={seconds:1893456000,nanoseconds:123456789};f.h.put('payroll_records/previous-cutoff',old);assert.notEqual(JSON.stringify(old.frozenData),JSON.stringify(reverseMaps(old.frozenData)));varyPayrollReadOrder(f);
 const result=await f.pay();assert.equal(result.alreadyPaid,false);assert.equal(result.finalNetPay,450);assert.deepEqual(f.h.get('payroll_records/previous-cutoff'),old);assert.equal(f.h.get('cash_accounts/cash').balance,4550);
});
test('an existing unacknowledged paid cutoff wins over new edits and reordered maps without another debit or obligation settlement',async()=>{
 for(const legacy of [false,true]){const f=fixture(),record=savedRecord(f,{finalNetPay:123,frozenData:{...structuredClone(f.data),basicPay:123,isPaid:true,finalNetPay:123}}),recordKey=legacy?'legacy-random-payment':paymentId;if(legacy)delete record.staffId;f.h.put('payroll_records/'+recordKey,record);f.h.put('staff_deductions/new-food',deduction('new-food',50));varyPayrollReadOrder(f);const before=structuredClone([...f.h.docs]);
  const result=await f.pay({data:{...f.data,basicPay:999,meals:50},finalNetPay:949});assert.equal(result.alreadyPaid,true);assert.equal(result.finalNetPay,123);assert.equal(result.accountId,'previous-bank');assert.equal(result.accountName,'Original Payment Bank');assert.deepEqual([...f.h.docs],before);assert.equal(f.h.get('payroll_records/'+recordKey).acknowledged,false);
 }
});
test('semantic saved-map comparison recognizes Timestamp serialization but retains primitive types, array order and every changed value',()=>{
 class Timestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}}
 const first={profile:{name:'Sample',rate:450},logs:[{stamp:new Timestamp(100,123456789),in:'09:00'},{out:'17:00'}]},second={logs:[{in:'09:00',stamp:{nanoseconds:123456789,seconds:100}},{out:'17:00'}],profile:{rate:450,name:'Sample'}};assert.equal(sameSavedPayrollValue(first,second),true);assert.equal(sameSavedPayrollValue(new Date(100000),{seconds:100,nanoseconds:0}),true);
 for(const changed of [{...second,profile:{...second.profile,rate:451}},{...second,profile:{...second.profile,rate:'450'}},{...second,logs:[...second.logs].reverse()},{...second,logs:[{stamp:{seconds:100,nanoseconds:123456788},in:'09:00'},second.logs[1]]}])assert.equal(sameSavedPayrollValue(first,changed),false);
 assert.equal(sameSavedPayrollValue({seconds:100},{seconds:100,nanoseconds:0}),false);assert.equal(sameSavedPayrollValue({seconds:100,nanoseconds:0,type:'duration'},{seconds:100,nanoseconds:0}),false);
});
test('actual saved financial or attendance changes still stop payment before any financial write',async()=>{
 for(const change of ['money','array','stamp','cutoff']){const f=fixture(),old=savedRecord(f,{startDate:'2029-12-16',endDate:'2029-12-31'});old.frozenData.logs=[{stamp:{seconds:100,nanoseconds:123},in:'09:00'},{out:'17:00'}];f.h.put('payroll_records/previous',old);varyPayrollReadOrder(f);afterPreflight(f,()=>{const current=structuredClone(old);if(change==='money')current.frozenData.basicPay++;if(change==='array')current.frozenData.logs.reverse();if(change==='stamp')current.frozenData.logs[0].stamp.nanoseconds++;if(change==='cutoff')current.endDate='2030-01-01';f.h.put('payroll_records/previous',current);});await assert.rejects(f.pay(),/saved payroll record changed/);assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal(paths(f.h,'expenses').length,0);}
});

test('Check saved payment is read-only, uses original paid amount/account and treats pending Staff acknowledgment as already paid',async()=>{
 const f=fixture(),record=savedRecord(f,{frozenData:{...f.data,isPaid:true,finalNetPay:450,cashShortages:90,cashShortageRows:[{id:'cash-shortage-closed-case',amount:90}]}});f.h.put('payroll_records/'+paymentId,record);f.h.put('staff_deductions/still-open',deduction('still-open',50));varyPayrollReadOrder(f);const before=structuredClone([...f.h.docs]),queried=[],read=f.h.api.getDocsFromServer;f.h.api.getDocsFromServer=async reference=>{queried.push(reference.table);return read(reference);};
 const result=await checkSavedPayrollPayment(f.h.api,{data:f.data});assert.equal(result.status,'paid');assert.equal(result.alreadyPaid,true);assert.equal(result.finalNetPay,450);assert.equal(result.accountId,'previous-bank');assert.equal(result.frozenData.cashShortages,90);assert.equal(f.h.get('payroll_records/'+paymentId).acknowledged,false);assert.deepEqual([...f.h.docs],before);assert.equal(queried.some(table=>['cash_accounts','expenses','staff_deductions','cash_shortage_reviews'].includes(table)),false);
});
test('a read-only check finding no saved record leaves every financial record and the edited preview unchanged',async()=>{
 const f=fixture(),preview=structuredClone(f.data);f.h.put('staff_deductions/food',deduction('food',50));const before=structuredClone([...f.h.docs]);assert.deepEqual(await checkSavedPayrollPayment(f.h.api,{data:f.data}),{status:'not-recorded',alreadyPaid:false});assert.deepEqual(f.data,preview);assert.deepEqual([...f.h.docs],before);
});
test('read-only check holds explicit drafts, unpaid or incomplete saved records and ambiguous duplicate payments',async()=>{
 for(const status of ['Draft','Unpaid','Pending','Cancelled','Voided']){const f=fixture();f.h.put('payroll_records/'+paymentId,savedRecord(f,{status}));const before=structuredClone([...f.h.docs]);await assert.rejects(checkSavedPayrollPayment(f.h.api,{data:f.data}),/incomplete saved/);assert.deepEqual([...f.h.docs],before);await assert.rejects(f.pay(),/incomplete saved/);assert.deepEqual([...f.h.docs],before);}
 const f=fixture();f.h.put('payroll_records/'+paymentId,savedRecord(f));f.h.put('payroll_records/'+refundPaymentId,savedRecord(f));await assert.rejects(checkSavedPayrollPayment(f.h.api,{data:f.data}),/More than one/);assert.equal(f.h.get('cash_accounts/cash').balance,5000);
 const g=fixture();g.h.put('payroll_records/'+paymentId,savedRecord(g,{finalNetPay:undefined}));await assert.rejects(checkSavedPayrollPayment(g.h.api,{data:g.data}),/amount/);
});
test('read-only check revalidates Manager grant, exact saved employee and account/branch scope without a write',async()=>{
 const f=fixture({manager:true});f.h.put('payroll_records/'+paymentId,savedRecord(f));assert.equal((await checkSavedPayrollPayment(f.h.api,{data:f.data})).status,'paid');
 const g=fixture({manager:true});g.h.put('payroll_records/'+paymentId,savedRecord(g,{branch:'Citygate',frozenData:{...g.data,isPaid:true,finalNetPay:450,branch:'Citygate'}}));await assert.rejects(checkSavedPayrollPayment(g.h.api,{data:g.data}),/outside/);
 const k=fixture({manager:true});k.h.put('payroll_records/'+paymentId,savedRecord(k));afterPreflight(k,()=>k.h.put('hq_email_access/payroll@example.test',{active:false,allowedBranches:[branch],permissions:['payroll']}));await assert.rejects(checkSavedPayrollPayment(k.h.api,{data:k.data}),/access/);assert.equal(k.h.get('cash_accounts/cash').balance,5000);
});
test('a read-only check cannot label cached/failed network data or a switched account as confirmed payment',async()=>{
 for(const failure of ['cache','network','account']){const f=fixture();f.h.put('payroll_records/'+paymentId,savedRecord(f));const read=f.h.api.getDocsFromServer;f.h.api.getDocsFromServer=async reference=>{if(failure==='network')throw Error('Synthetic network failure');const snap=await read(reference);if(failure==='cache')return {...snap,metadata:{fromCache:true}};f.h.api.auth.currentUser={...f.h.api.auth.currentUser,uid:'different-owner'};return snap;};const before=structuredClone([...f.h.docs]);await assert.rejects(checkSavedPayrollPayment(f.h.api,{data:f.data}),/confirmed|network|account|Google/);assert.deepEqual([...f.h.docs],before);}
});

test('ordinary payroll saves one atomic debit, expense and frozen edited payslip without leaking private profile fields',async()=>{
 const f=fixture(),before=structuredClone(f.data);const result=await f.pay();
 assert.equal(result.id,paymentId);assert.equal(result.alreadyPaid,false);assert.equal(result.accountBalance,4550);
 assert.equal(f.h.get('cash_accounts/cash').balance,4550);assert.deepEqual(paths(f.h,'payroll_records'),['payroll_records/'+paymentId]);assert.deepEqual(paths(f.h,'expenses'),['expenses/'+paymentId]);
 assert.equal(result.frozenData.profile.dateHired,'2029-01-01');assert.equal(result.frozenData.profile.role,'Crew');assert.equal(result.frozenData.profile.hourlyRate,450);
 for(const field of ['pin','phone','bankAccount','salaryRateTimeline'])assert.equal(Object.hasOwn(result.frozenData.profile,field),false);
 assert.deepEqual(f.data,before);assert.equal(f.h.get('expenses/'+paymentId).note,`Payslip for ${name} (${start} to ${end}) - Branch: Maa`);
});

test('a rejected atomic commit changes no account, deductions, expense or payroll',async()=>{
 const f=fixture();f.data.meals=100;f.input.finalNetPay=350;f.h.put('staff_deductions/food',deduction('food',100));
 const before=structuredClone([...f.h.docs]);f.h.failNextCommit();await assert.rejects(f.pay(),/Commit rejected/);
 assert.deepEqual([...f.h.docs],before);
});

test('lost acknowledgement and repeated taps debit once and return the original saved figures',async()=>{
 const f=fixture();f.h.loseNextAck();await assert.rejects(f.pay(),/lost after commit/);
 const result=await f.pay();assert.equal(result.alreadyPaid,true);assert.equal(result.frozenData.basicPay,450);
 const changed={...f.data,basicPay:900};const replay=await f.pay({data:changed,finalNetPay:900});assert.equal(replay.alreadyPaid,true);assert.equal(replay.finalNetPay,450);
 assert.equal(f.h.get('cash_accounts/cash').balance,4550);assert.equal(paths(f.h,'payroll_records').length,1);assert.equal(paths(f.h,'expenses').length,1);
});

test('a confirmed commit remains authoritative if screen or account changes during acknowledgement',async()=>{
 for(const change of ['screen','account']){
  const f=fixture(),run=f.h.api.runTransaction;let current=true;
  f.h.api.runTransaction=async(...args)=>{const result=await run(...args);if(change==='screen')current=false;else f.h.api.auth.currentUser={...f.h.api.auth.currentUser,uid:'next-user'};return result;};
  const result=await f.pay({assertCurrent:()=>{if(!current)throw Error('Screen selection changed');}});
  assert.equal(result.alreadyPaid,false);assert.equal(result.finalNetPay,450);assert.equal(result.accountBalance,4550);
  assert.equal(f.h.get('cash_accounts/cash').balance,4550);assert.equal(paths(f.h,'payroll_records').length,1);
 }
});

test('concurrent calls on one and separate clients keep one stable staff-cutoff payment',async()=>{
 const f=fixture();await Promise.all(Array.from({length:12},()=>f.pay()));
 assert.equal(f.h.get('cash_accounts/cash').balance,4550);assert.equal(paths(f.h,'expenses').length,1);
 const g=fixture(),second={...g.h.api};const results=await Promise.all([g.pay(),finalizeOrdinaryPayroll(second,g.input)]);
 assert.equal(results.filter(row=>!row.alreadyPaid).length,1);assert.equal(results.filter(row=>row.alreadyPaid).length,1);assert.equal(g.h.get('cash_accounts/cash').balance,4550);
});

test('partial edited Foods and advances clear only their exact oldest included amounts',async()=>{
 const f=fixture();f.data.meals=110;f.data.advances=25;f.input.finalNetPay=315;
 f.h.put('staff_deductions/first',deduction('first',100,'Cancelled Food Purchase',2));f.h.put('staff_deductions/second',deduction('second',25,'Staff Meal',3));
 f.h.put('staff_deductions/vale',deduction('vale',40,'Cash Advance',4));f.h.put('staff_deductions/future',deduction('future',80,'Staff Meal',16));f.h.put('staff_deductions/prior-paid',deduction('prior-paid',90,'Staff Meal',1,{status:'Paid'}));
 const result=await f.pay();assert.equal(result.frozenData.meals,110);assert.equal(result.frozenData.advances,25);
 assert.equal(f.h.get('staff_deductions/first').status,'Paid');assert.equal(f.h.get('staff_deductions/second').amount,15);assert.equal(f.h.get('staff_deductions/second').status,'Unpaid');
 assert.equal(f.h.get('staff_deductions/vale').amount,15);assert.equal(f.h.get('staff_deductions/future').status,'Unpaid');assert.equal(f.h.get('staff_deductions/prior-paid').amount,90);
});

test('fresh deduction and salary changes between preparation and transaction stop all financial writes',async()=>{
 for(const change of ['deduction','rate','revision']){
  const f=fixture();f.data.meals=50;f.input.finalNetPay=400;f.h.put('staff_deductions/food',deduction('food',50));
  if(change==='revision'){Object.assign(f.data.profile,{salaryRateVersion:1,salaryRateRevision:'first'});f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),salaryRateVersion:1,salaryRateRevision:'first'});f.h.put('staff_salary_rates/'+staffId,{version:1,staffId,branch,baselineDailyRate:450,rates:{},revision:1,revisionId:'first'});}
  afterPreflight(f,()=>{if(change==='deduction')f.h.put('staff_deductions/food',{...f.h.get('staff_deductions/food'),amount:60});else f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),...(change==='rate'?{hourlyRate:480}:{salaryRateRevision:'second'})});});
  await assert.rejects(f.pay(),/changed/);assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal(paths(f.h,'expenses').length,0);assert.equal(paths(f.h,'payroll_records').length,0);
 }
});

test('funds use the fresh transaction balance and an overdraft needs the explicit confirmation flag',async()=>{
 const f=fixture();afterPreflight(f,()=>f.h.put('cash_accounts/cash',{...f.h.get('cash_accounts/cash'),balance:400}));
 await assert.rejects(f.pay(),/balance is too low/);assert.equal(f.h.get('cash_accounts/cash').balance,400);
 const paid=await f.pay({allowNegativeBalance:true});assert.equal(paid.accountBalance,-50);assert.equal(f.h.get('cash_accounts/cash').balance,-50);
 await assert.rejects(f.pay({allowNegativeBalance:'yes'}),/Confirm/);
});

test('edited income and custom details freeze exactly, including a positive manual performance addition',async()=>{
 const f=fixture();Object.assign(f.data,{basicPay:460,nightBonus:50,straightBonus:20,holidayPayTotal:30,perfBonus:40,lateDeduction:10,sss:5,philhealth:5,pagibig:5,customDeductions:[{name:'Edited custom',amount:10}],customDeductionsTotal:10});
 const result=await f.pay({finalNetPay:565,sourcePerfBonus:0});
 assert.equal(result.frozenData.basicPay,460);assert.equal(result.frozenData.perfBonus,40);assert.equal(result.frozenData.holidayPayTotal,30);assert.equal(result.frozenData.manualPerformanceBonus,40);
 assert.deepEqual(result.frozenData.profile.customDeductions,[{name:'Edited custom',amount:10}]);assert.equal(result.finalNetPay,565);
 assert.equal(paths(f.h,'staff_bonuses').length,0);
});

test('only included saved performance rewards are marked paid; lower edits and stale source totals are held',async()=>{
 const f=fixture();f.h.put('staff_bonuses/current',reward(50));f.h.put('staff_bonuses/future',reward(90,17));f.h.put('staff_bonuses/old',reward(30,1,{dateAdded:new Date('2029-12-31T12:00:00+08:00')}));f.data.perfBonus=80;
 const result=await f.pay({finalNetPay:530,sourcePerfBonus:50});assert.equal(result.frozenData.manualPerformanceBonus,30);
 assert.equal(f.h.get('staff_bonuses/current').status,'Paid');assert.equal(f.h.get('staff_bonuses/future').status,'Unpaid');assert.equal(f.h.get('staff_bonuses/old').status,'Unpaid');
 for(const edited of [40,80]){const g=fixture();g.h.put('staff_bonuses/current',reward(50));g.data.perfBonus=edited;await assert.rejects(g.pay({finalNetPay:450+edited,sourcePerfBonus:edited===40?50:40}),/performance|bonuses/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);}
});

test('loan repayment and its paid trace are committed once with the company balance',async()=>{
 const f=fixture();f.data.loans=100;f.input.finalNetPay=350;f.data.ledgerId='loan';f.h.put('staff_ledger/loan',{staffId,staffName:name,branch,totalLoaned:500,totalPaid:200});
 await f.pay();await f.pay();assert.equal(f.h.get('staff_ledger/loan').totalPaid,300);assert.equal(f.h.get('staff_deductions/'+paymentId+'-loan').amount,100);assert.equal(paths(f.h,'expenses').length,1);
 const g=fixture();g.data.loans=100;g.input.finalNetPay=350;g.data.ledgerId='loan';g.h.put('staff_ledger/loan',{staffId,staffName:name,branch,totalLoaned:500,totalPaid:450});await assert.rejects(g.pay(),/loan balance changed/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);
});

test('a known legacy random-ID paid record is returned read-only and an overlapping cutoff is held',async()=>{
 const f=fixture(),frozen={...structuredClone(f.data),isPaid:true,finalNetPay:123,basicPay:123};
 f.h.put('payroll_records/old-random',{staffName:name,startDate:start,endDate:end,frozenData:frozen,finalNetPay:123});
 const paid=await f.pay();assert.equal(paid.alreadyPaid,true);assert.equal(paid.id,'old-random');assert.equal(paid.frozenData.basicPay,123);assert.equal(f.h.get('cash_accounts/cash').balance,5000);
 assert.deepEqual(f.h.get('payroll_records/old-random').frozenData,frozen);
 const g=fixture();g.h.put('payroll_records/overlap',{staffId,staffName:name,startDate:'2029-12-20',endDate:'2030-01-02',frozenData:{...frozen},finalNetPay:123});await assert.rejects(g.pay(),/overlaps/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);
});

test('partial legacy expense, duplicate saved payments and malformed frozen identity cannot cause another debit',async()=>{
 for(const kind of ['expense','duplicate','malformed']){const f=fixture(),record={staffId,staffName:name,startDate:start,endDate:end,frozenData:{...structuredClone(f.data),isPaid:true,finalNetPay:450},finalNetPay:450};
  if(kind==='expense')f.h.put('expenses/old-partial',{category:'Payroll',amount:450,note:`Payslip for ${name} (${start} to ${end}) - Branch: Maa`});
  else if(kind==='duplicate'){f.h.put('payroll_records/one',record);f.h.put('payroll_records/two',record);}
  else f.h.put('payroll_records/'+paymentId,{...record,frozenData:{...record.frozenData,staffId:'wrong-person'}});
  await assert.rejects(f.pay(),/expense|Duplicate|identity|conflicting employee IDs/);assert.equal(f.h.get('cash_accounts/cash').balance,5000);
 }
});

test('a fresh protected grant is required for Manager employee and account branches',async()=>{
 const f=fixture({manager:true});assert.equal((await f.pay()).alreadyPaid,false);
 const g=fixture({manager:true});g.h.put('cash_accounts/cash',{name:'HQ Cash',branch:'Main Office',balance:5000});await assert.rejects(g.pay(),/outside/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);
 const k=fixture({manager:true});afterPreflight(k,()=>k.h.put('hq_email_access/payroll@example.test',{active:false,permissions:['payroll'],allowedBranches:[branch]}));await assert.rejects(k.pay(),/access/);assert.equal(paths(k.h,'payroll_records').length,0);
});

test('account switching and forged session-only permissions stop payment before a write',async()=>{
 const f=fixture(),read=f.h.api.getDocsFromServer;let switched=false;
 f.h.api.getDocsFromServer=async ref=>{const result=await read(ref);if(!switched){switched=true;f.h.api.auth.currentUser={...f.h.api.auth.currentUser,uid:'another-user'};}return result;};
 await assert.rejects(f.pay(),/account|Google/);assert.equal(f.h.get('cash_accounts/cash').balance,5000);
 const g=fixture({manager:true});g.h.put('hq_managers/sample-manager',{...g.h.get('hq_managers/sample-manager'),permissions:['dashboard']});await assert.rejects(g.pay(),/permissions/);assert.equal(paths(g.h,'expenses').length,0);
});

test('ambiguous directory, stale employee branch and a new online refund require regeneration',async()=>{
 const f=fixture();f.h.put('cashiers/duplicate',{...f.h.get('cashiers/'+staffId)});await assert.rejects(f.pay(),/one saved employee/);
 const g=fixture();afterPreflight(g,()=>g.h.put('cashiers/'+staffId,{...g.h.get('cashiers/'+staffId),branch:'Citygate'}));await assert.rejects(g.pay(),/identity or branch changed/);
 const k=fixture();seedRefund(k.h);await assert.rejects(k.pay(),/protected refund workflow/);assert.equal(k.h.get('cash_accounts/cash').balance,5000);
});

test('money and edited-total validation fail closed without changing the submitted form',async()=>{
 const f=fixture(),before=structuredClone(f.data);
 for(const value of [-1,NaN,Infinity,'not-a-number',1e20])await assert.rejects(f.pay({finalNetPay:value}));
 await assert.rejects(f.pay({finalNetPay:451}),/edited payslip total/);
 await assert.rejects(f.pay({data:{...f.data,customDeductions:[{name:'Mismatch',amount:10}],customDeductionsTotal:0}}),/Custom deduction/);
 await assert.rejects(f.pay({data:{...f.data,attendanceReviewRequired:true}}),/HR review/);
 assert.deepEqual(f.data,before);assert.equal(paths(f.h,'expenses').length,0);
});

test('fresh reads are bounded in parallel and a cached server snapshot cannot authorize payment',async()=>{
 const f=fixture(),read=f.h.api.getDocsFromServer;let active=0,max=0;
 f.h.api.getDocsFromServer=async ref=>{active++;max=Math.max(max,active);await tick();try{return await read(ref);}finally{active--;}};
 await f.pay();assert.ok(max>1&&max<=PAYROLL_SETTLEMENT_LIMITS.readConcurrency);
 const g=fixture(),original=g.h.api.getDocsFromServer;g.h.api.getDocsFromServer=async ref=>({...await original(ref),metadata:{fromCache:true}});await assert.rejects(g.pay(),/could not be confirmed/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);
});

test('a failed read stops new requests and drains in-flight readers before rejection',async()=>{
 const f=fixture(),read=f.h.api.getDocsFromServer;let release,active=0,calls=0,settled=false,transactions=0;
 const gate=new Promise(resolve=>release=resolve),run=f.h.api.runTransaction;
 f.h.api.runTransaction=(...args)=>{transactions++;return run(...args);};
 f.h.api.getDocsFromServer=async reference=>{
  const call=++calls;active++;
  try{if(call===1)throw Error('Synthetic read failure');await gate;return await read(reference);}finally{active--;}
 };
 const payment=f.pay();payment.then(()=>settled=true,()=>settled=true);await tick();
 assert.ok(active>0);assert.equal(settled,false,'failure must wait for already-started reads');
 assert.ok(calls<=PAYROLL_SETTLEMENT_LIMITS.readConcurrency,'no queued reads start after the first failure');
 release();await assert.rejects(payment,/Synthetic read failure/);assert.equal(active,0);assert.equal(transactions,0);
 assert.equal(f.h.get('cash_accounts/cash').balance,5000);
});

test('only exact Unpaid queries load deductions and bonuses, preserving other saved statuses',async()=>{
 const f=fixture(),read=f.h.api.getDocsFromServer,queries=[];
 f.h.api.getDocsFromServer=async reference=>{queries.push(reference);return read(reference);};
 f.h.put('staff_bonuses/pending',reward(75,3,{status:'Pending'}));
 f.h.put('staff_bonuses/missing-status',reward(80,3,{status:undefined}));
 f.h.put('staff_bonuses/paid',reward(90,3,{status:'Paid'}));
 f.h.put('staff_deductions/paid',deduction('paid',50,'Staff Meal',3,{status:'Paid'}));
 await f.pay();
 for(const table of ['staff_deductions','staff_bonuses']){
  const reference=queries.find(row=>row.table===table);assert.ok(reference);
  assert.deepEqual(reference.filters,[{key:'staffName',value:name},{key:'status',value:'Unpaid'}]);
 }
 assert.equal(f.h.get('staff_bonuses/pending').status,'Pending');assert.equal(f.h.get('staff_bonuses/missing-status').status,undefined);
 assert.equal(f.h.get('staff_bonuses/paid').amount,90);assert.equal(f.h.get('staff_deductions/paid').amount,50);
 const g=fixture();g.h.put('staff_bonuses/current',reward(50));g.data.perfBonus=50;
 afterPreflight(g,()=>g.h.put('staff_bonuses/current',{...g.h.get('staff_bonuses/current'),status:'Pending'}));
 await assert.rejects(g.pay({finalNetPay:500,sourcePerfBonus:50}),/performance bonus changed/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);
});

test('ordinary and refund routes return the exact other saved payment without a second debit',async()=>{
 const f=fixture();await f.pay();seedRefund(f.h);const engine=createRefundPayrollEngine(f.h.api,{ownerCheck:()=>true});
 const refund=await engine.pay({data:refundData(),accountId:'cash',finalNetPay:370});assert.equal(refund.alreadyPaid,true);assert.equal(refund.id,paymentId);assert.equal(refund.finalNetPay,450);assert.equal(f.h.get('cash_accounts/cash').balance,4550);assert.equal(f.h.get('staff_deductions/online-refund-sample').status,'Unpaid');
 const g=fixture();seedRefund(g.h);await createRefundPayrollEngine(g.h.api,{ownerCheck:()=>true}).pay({data:refundData(),accountId:'cash',finalNetPay:370});
 const ordinary=await g.pay();assert.equal(ordinary.alreadyPaid,true);assert.equal(ordinary.id,refundPaymentId);assert.equal(ordinary.finalNetPay,370);assert.equal(g.h.get('cash_accounts/cash').balance,4630);assert.equal(paths(g.h,'expenses').length,1);
});

for(const first of ['ordinary','refund'])test('concurrent ordinary/refund commits exclude each other when '+first+' reaches commit first',async()=>{
 const f=fixture(),run=f.h.api.runTransaction;let allowOrdinary,allowRefund,ordinaryReady,refundReady;
 const ordinaryGate=new Promise(resolve=>allowOrdinary=resolve),refundGate=new Promise(resolve=>allowRefund=resolve);
 const ordinaryReached=new Promise(resolve=>ordinaryReady=resolve),refundReached=new Promise(resolve=>refundReady=resolve);
 f.h.api.runTransaction=async(db,callback)=>{ordinaryReady();await ordinaryGate;return run(db,callback);};
 const ordinary=f.pay();await ordinaryReached;seedRefund(f.h);
 const refundApi={...f.h.api,runTransaction:async(db,callback)=>{refundReady();await refundGate;return run(db,callback);}};
 const refund=createRefundPayrollEngine(refundApi,{ownerCheck:()=>true}).pay({data:refundData(),accountId:'cash',finalNetPay:370});await refundReached;
 if(first==='ordinary'){allowOrdinary();await ordinary;allowRefund();}else{allowRefund();await refund;allowOrdinary();}
 const results=await Promise.all([ordinary,refund]);assert.equal(results.filter(row=>!row.alreadyPaid).length,1);assert.equal(results.filter(row=>row.alreadyPaid).length,1);
 assert.equal(paths(f.h,'payroll_records').length,1);assert.equal(paths(f.h,'expenses').length,1);assert.equal(f.h.get('cash_accounts/cash').balance,first==='ordinary'?4550:4630);
});

test('refund retry with already-settled Meals and bonuses returns the saved snapshot before reallocation',async()=>{
 const f=fixture();seedRefund(f.h);f.h.put('staff_deductions/food',deduction('food',20));f.h.put('staff_bonuses/reward',reward(30));
 const data={...refundData(),meals:20,perfBonus:30},input={data,accountId:'cash',finalNetPay:380};
 f.h.loseNextAck();await assert.rejects(finalizeRefundPayroll(f.h.api,input),/lost after commit/);
 const retry=await finalizeRefundPayroll(f.h.api,input);assert.equal(retry.alreadyPaid,true);assert.equal(retry.frozenData.meals,20);assert.equal(retry.frozenData.perfBonus,30);assert.equal(f.h.get('cash_accounts/cash').balance,4620);
 assert.equal(retry.frozenData.profile.dateHired,'2029-01-01');
});

test('malformed cross-route saved payment holds instead of returning a guessed zero payout',async()=>{
 const f=fixture();seedRefund(f.h);f.h.put('payroll_records/'+paymentId,{staffId,startDate:start,endDate:end,frozenData:{name,staffId,isPaid:true}});
 await assert.rejects(createRefundPayrollEngine(f.h.api,{ownerCheck:()=>true}).pay({data:refundData(),accountId:'cash',finalNetPay:370}),/amount/);
 assert.equal(f.h.get('cash_accounts/cash').balance,5000);
 assert.throws(()=>confirmedPayrollResult({staffId:'wrong',startDate:start,endDate:end,frozenData:{name,isPaid:true},finalNetPay:450},{id:paymentId,staffId,start,end}),/identity/);
 for(const value of ['', '   ', null])assert.throws(()=>confirmedPayrollResult({staffId,startDate:start,endDate:end,frozenData:{name,staffId,isPaid:true},finalNetPay:value},{id:paymentId,staffId,start,end}),/amount/);
});

test('refund wrapper retains screen and Owner identity checks across fresh preflight reads',async()=>{
 for(const change of ['screen','account']){
  const f=fixture();seedRefund(f.h);const read=f.h.api.getDocsFromServer;let current=true;
  f.h.api.getDocsFromServer=async reference=>{const snap=await read(reference);if(change==='screen')current=false;else f.h.api.auth.currentUser={...f.h.api.auth.currentUser,uid:'another-owner'};return snap;};
  await assert.rejects(finalizeRefundPayroll(f.h.api,{data:refundData(),accountId:'cash',finalNetPay:370,assertCurrent:()=>{if(!current)throw Error('Selected payslip changed');},allowNegativeBalance:false}),/changed/);
  assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal(paths(f.h,'payroll_records').length,0);assert.equal(f.h.get('staff_deductions/online-refund-sample').status,'Unpaid');
 }
});

test('refund transaction rechecks edited intent before writes and trusts the committed ACK afterward',async()=>{
 const f=fixture();seedRefund(f.h);const run=f.h.api.runTransaction;let current=true;
 f.h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async reference=>{const snap=await tx.get(reference);if(reference.path==='cashiers/'+staffId)current=false;return snap;}}));
 await assert.rejects(finalizeRefundPayroll(f.h.api,{data:refundData(),accountId:'cash',finalNetPay:370,assertCurrent:()=>{if(!current)throw Error('Selected payslip changed');}}),/changed/);
 assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal(paths(f.h,'expenses').length,0);
 const g=fixture();seedRefund(g.h);const commit=g.h.api.runTransaction;let screen=true;
 g.h.api.runTransaction=async(...args)=>{const result=await commit(...args);screen=false;return result;};
 const saved=await finalizeRefundPayroll(g.h.api,{data:refundData(),accountId:'cash',finalNetPay:370,assertCurrent:()=>{if(!screen)throw Error('Selected payslip changed');}});
 assert.equal(saved.alreadyPaid,false);assert.equal(saved.finalNetPay,370);assert.equal(g.h.get('cash_accounts/cash').balance,4630);
});

test('refund payment respects explicit current-balance confirmation',async()=>{
 const f=fixture();seedRefund(f.h);f.h.put('cash_accounts/cash',{name:'Cash',branch,balance:300});
 const input={data:refundData(),accountId:'cash',finalNetPay:370,allowNegativeBalance:false};
 await assert.rejects(finalizeRefundPayroll(f.h.api,input),/balance is too low/);assert.equal(f.h.get('cash_accounts/cash').balance,300);
 const paid=await finalizeRefundPayroll(f.h.api,{...input,allowNegativeBalance:true});assert.equal(paid.accountBalance,-70);
 const g=fixture();seedRefund(g.h);await assert.rejects(finalizeRefundPayroll(g.h.api,{...input,allowNegativeBalance:'yes'}),/Confirm/);assert.equal(g.h.get('cash_accounts/cash').balance,5000);
});

test('refund payment rejects stale legacy wage and dated salary revisions before settling deductions',async()=>{
 for(const kind of ['legacy','dated','missing-private']){
  const f=fixture();seedRefund(f.h);const data=refundData();
  if(kind!=='legacy'){
   Object.assign(data.profile,{salaryRateVersion:1,salaryRateRevision:'first'});f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),salaryRateVersion:1,salaryRateRevision:'first'});
   if(kind!=='missing-private')f.h.put('staff_salary_rates/'+staffId,{version:1,staffId,branch,baselineDailyRate:450,rates:{first:{effectiveDate:start,dailyRate:450,sequence:1}},revision:1,revisionId:'first'});
  }
  if(kind!=='missing-private')afterPreflight(f,()=>f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),...(kind==='legacy'?{hourlyRate:480}:{salaryRateRevision:'second'})}));
  await assert.rejects(finalizeRefundPayroll(f.h.api,{data,accountId:'cash',finalNetPay:370}),/wage changed|Salary dates changed/);
  assert.equal(f.h.get('cash_accounts/cash').balance,5000);assert.equal(f.h.get('staff_deductions/online-refund-sample').status,'Unpaid');assert.equal(paths(f.h,'expenses').length,0);
 }
});

test('refund edited net and custom details must match before a new payment, while a confirmed snapshot remains read-only',async()=>{
 const f=fixture();seedRefund(f.h);const data={...refundData(),customDeductions:[{name:'Edited custom',amount:10}],customDeductionsTotal:10};
 await assert.rejects(finalizeRefundPayroll(f.h.api,{data,accountId:'cash',finalNetPay:361}),/edited payslip total/);
 await assert.rejects(finalizeRefundPayroll(f.h.api,{data:{...data,customDeductionsTotal:0},accountId:'cash',finalNetPay:360}),/Custom deduction/);
 assert.equal(f.h.get('cash_accounts/cash').balance,5000);
 const saved=await finalizeRefundPayroll(f.h.api,{data,accountId:'cash',finalNetPay:360});assert.deepEqual(saved.frozenData.profile.customDeductions,[{name:'Edited custom',amount:10}]);assert.equal(saved.frozenData.onlineRefunds,80);assert.equal(saved.finalNetPay,360);
 f.h.put('cashiers/'+staffId,{...f.h.get('cashiers/'+staffId),hourlyRate:999});
 const replay=await finalizeRefundPayroll(f.h.api,{data:{...data,basicPay:1,customDeductionsTotal:999},accountId:'cash',finalNetPay:1});
 assert.equal(replay.alreadyPaid,true);assert.equal(replay.finalNetPay,360);assert.equal(replay.frozenData.basicPay,450);assert.equal(f.h.get('cash_accounts/cash').balance,4640);
});
