import {renderPayslipOptionalDeductions,renderRecurringPayslipDeductions} from '../takodeal-manager/payslip-optional-deductions.js';
import {isOwnerDeduction} from '../takodeal-manager/owner-deduction-model.js';
import {readPayrollOwnerDeductions,ownerDeductionDisplayRows} from '../takodeal-manager/owner-deduction-payroll.js';
import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import * as roster from '../takodeal-manager/payroll-roster-model.js';
import * as rosterUI from '../takodeal-manager/payroll-balance-review.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-manager/payroll-safety.js';
import * as schedule from '../takodeal-manager/schedule-history.js';
import * as sanctions from '../takodeal-manager/sanction-schedule.js';
import * as freshness from '../takodeal-manager/payroll-schedule-freshness.js';
import * as preview from '../takodeal-manager/payroll-preview-guard.js';
import * as loading from '../takodeal-manager/payroll-loading.js';
import * as completion from '../takodeal-manager/payroll-completion.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';
import {attendanceMillis} from '../takodeal-manager/attendance-reconcile.js';
import {readPayrollCashShortages} from '../takodeal-manager/payroll-settlement.js';
import {approvedCashShortage} from './helpers/cash-shortage-fixture.mjs';
import {isCashShortageDeduction} from '../takodeal-manager/cash-shortage-model.js';
import {canReviewCashShortage} from '../takodeal-manager/cash-shortage-ui.js';

const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const reviewSource=fs.readFileSync(new URL('../takodeal-manager/hr-review-ui.js',import.meta.url),'utf8');
const reviewStart=reviewSource.indexOf('export function heldPayrollReviewHTML('),reviewEnd=reviewSource.indexOf('\n}',reviewStart);
assert.ok(reviewStart>=0&&reviewEnd>reviewStart,'actual held payroll renderer exists');
const heldRenderer=reviewSource.slice(reviewStart,reviewEnd+2).replace('export ','');
function extract(name){const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,name+' source exists');return source.slice(start+1,end+3);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const held=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const stamp=value=>({toDate:()=>new Date(value)});
function harness(options={}){
 const nodes=new Map(),events=[],writes=[],calls=[];
 const node=id=>{if(!nodes.has(id)){const listeners={};nodes.set(id,{id,value:'',innerText:'0',textContent:'',innerHTML:'',style:{},parentElement:{style:{},querySelector:()=>null},tagName:'DIV',disabled:false,addEventListener:(name,fn)=>{(listeners[name]||=[]).push(fn);},emit:name=>{for(const fn of listeners[name]||[])fn({target:node(id)});}});}return nodes.get(id);};
 node('payrollStart').value=node('payrollEnd').value='2030-01-16';node('payrollGrandTotalContainer').style.display='flex';node('payrollGrandTotalAmount').innerText='₱1,234.56';node('payslipModal').style.display='block';
 const person={id:'person-a',cashierName:'Sample Staff',scheduleNickname:'SAMPLE',branch:'Sample Branch',hourlyRate:450,nightDiffRate:0},owner={uid:'owner-a',email:'owner@example.test',emailVerified:true};
 const plan={currentYear:2030,currentMonth:1,branchConfig:{'Sample Branch':[{id:'day',name:'Day',startTime:'09:00',endTime:'17:00',shiftType:'morning',active:true}]},currentSchedule:{16:{'Sample Branch':{scheduled:{day:'SAMPLE'}}},17:{'Sample Branch':{scheduled:{day:'SAMPLE'}}}}};
 const logs=day=>[{id:'in-'+day,staffId:person.id,staffName:person.cashierName,branch:person.branch,type:'TIME IN',timestamp:stamp('2030-01-'+day+'T09:00:00+08:00'),lateMinutes:0},{id:'out-'+day,staffId:person.id,staffName:person.cashierName,branch:person.branch,type:'TIME OUT',timestamp:stamp('2030-01-'+day+'T17:00:00+08:00')}];
 const records={cashiers:[person],cash_accounts:[{id:'sample-account',name:'Sample Cash',branch:'Sample Branch',balance:5000}],staff_ledger:[],payroll_records:[],attendance_logs:logs(16),staff_deductions:[],staff_bonuses:[]};
 const snapshot=(rows,metadata={fromCache:false,hasPendingWrites:false})=>{const docs=rows.map((row,index)=>({id:row.id||String(index),metadata:{fromCache:false,hasPendingWrites:false},data:()=>row}));return {docs,metadata,forEach:fn=>docs.forEach(fn)};};
 const api={db:{},auth:{currentUser:{...owner}},sessionUser:{...owner,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:()=>({}),query:(ref,...filters)=>({...ref,filters}),getDocs:async()=>assert.fail('Default cached getDocs must never be called for payroll preview'),getDocsFromServer:async ref=>{calls.push(ref);return options.read?options.read(ref,{snapshot,records,logs}):snapshot(records[ref.table]||[]);},getDoc:async()=>({exists:()=>true,data:()=>plan}),isBranchAllowed:()=>true,loadPayrollScheduleHistory:async()=>schedule.assembleScheduleHistory(plan),ManagerUI:{notify:message=>events.push(message)},liveAccounts:[{id:'sample-account',name:'Sample Cash',balance:5000}],globalPayrollCache:{Old:{name:'Old'}},currentPayslipData:{name:'Old'},updateDoc:async()=>writes.push('update'),addDoc:async()=>writes.push('add')};
 api.getDocFromServer=async ref=>{if(options.readDoc)return options.readDoc(ref,{records});const row=(records[ref.table]||[]).find(item=>item.id===ref.id||item.staffId===ref.id);return {exists:()=>!!row,data:()=>row,metadata:{fromCache:false,hasPendingWrites:false}};};
 const Swal={fire:async(...args)=>{events.push(args);return options.confirm?options.confirm(...args):{isConfirmed:false};},showValidationMessage:message=>events.push(message)};
 const document={getElementById:id=>id==='payrollBalanceReview'?null:node(id),querySelectorAll:()=>[]};
 const context=vm.createContext({renderPayslipOptionalDeductions,renderRecurringPayslipDeductions,isOwnerDeduction,readPayrollOwnerDeductions,ownerDeductionDisplayRows,activeStaffProfile,...roster,...rosterUI,...roster,...rosterUI,...api,...payroll,...schedule,...sanctions,...freshness,...preview,...loading,...completion,readPayrollCashShortages,canOpenWorkspacePage,planPayrollAttendance,attendanceMillis,window:api,document,Swal,Date,console:{error(){},log(){}},escapeHtml:value=>String(value)});
 context.html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 vm.runInContext(heldRenderer,context);
 for(const name of ['getPayrollPreviewGuard','requirePayrollPreview','loadPayrollGenerator','generateAutoPayslips','openPayslipModal','finalizePayslip'])vm.runInContext(extract(name),context);
 return {context,w:api,node,nodes,events,writes,calls,records,logs,snapshot,person};
}

for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': SDK dispatch occurs under the captured account before a queued account switch, and the late result is discarded',async()=>{const dispatched=[];let h;h=harness({read:(ref,{snapshot,records})=>{dispatched.push(h.w.auth.currentUser.uid);return snapshot(records[ref.table]||[]);}});h.context.savedSchedule={historyMonths:{}};vm.runInContext('window.loadPayrollScheduleHistory=()=>Promise.resolve(savedSchedule);',h.context);const work=h.w[generator]();queueMicrotask(()=>{h.w.auth.currentUser={uid:'other-owner',email:'other@example.test'};});await work;assert.deepEqual(dispatched,Array(6).fill('owner-a'),'all six independent queries dispatch synchronously for the captured user; no later queries dispatch after account switch');assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.equal(h.writes.length,0);assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());});
 test(generator+': a cached/partial server result revokes the old total and cache instead of publishing smaller payroll',async()=>{const h=harness({read:(ref,{snapshot,records})=>snapshot(records[ref.table]||[],{fromCache:ref.table==='attendance_logs',hasPendingWrites:false})});await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalContainer').style.display,'none');assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.equal(h.w.currentPayslipData,null);assert.equal(h.node('btnFinalizePayslip').disabled,true);assert.match(h.node('payrollPreviewStatus').textContent,/could not be confirmed/);assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());});
 test(generator+': complete server results publish once, while an empty next cutoff cannot retain the previous amount',async()=>{const h=harness();await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'].hours,8);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');h.records.attendance_logs=[];await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalContainer').style.display,'none');assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.match(h.node('payrollPreviewStatus').textContent,/No payroll records/);});
 test(generator+': an older held attendance response cannot replace a newer cutoff preview or clear its ready state',async()=>{const gate=held();let first=true;const h=harness({read:(ref,{snapshot,records,logs})=>{if(ref.table==='attendance_logs'){if(first){first=false;return gate.promise;}return snapshot(logs(17));}return snapshot(records[ref.table]||[]);}});const old=h.w[generator]();for(let n=0;n<20&&first;n++)await tick();assert.equal(first,false);h.node('payrollStart').value=h.node('payrollEnd').value='2030-01-17';h.node('payrollStart').emit('change');const next=h.w[generator]();await tick();assert.equal(h.calls.filter(ref=>ref.table==='attendance_logs').length,1,'the latest cutoff waits for the old physical run rather than stacking more query bursts');gate.resolve(h.snapshot([]));await old;await next;const current=h.w.globalPayrollCache['Sample Staff'];assert.equal(current.start,'2030-01-17');assert.equal(h.w.globalPayrollCache['Sample Staff'],current);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');assert.doesNotThrow(()=>h.w.getPayrollPreviewGuard().requireReady());});
 test(generator+': changing the signed-in account during a physical read publishes no preview',async()=>{const gate=held();let waiting=false;const h=harness({read:(ref,{snapshot,records})=>{if(ref.table==='attendance_logs'){waiting=true;return gate.promise;}return snapshot(records[ref.table]||[]);}});const work=h.w[generator]();for(let n=0;n<20&&!waiting;n++)await tick();assert.equal(waiting,true);h.w.auth.currentUser={uid:'other',email:'other@example.test'};gate.resolve(h.snapshot(h.records.attendance_logs));await work;assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());});
}

test('actual modal and payment handlers deny a stale preview before rendering a payslip or opening a payment dialog',async()=>{const h=harness();await h.w.loadPayrollGenerator();const old=h.w.globalPayrollCache['Sample Staff'];h.node('payrollEnd').value='2030-01-17';await h.w.openPayslipModal('Sample Staff');assert.equal(h.w.currentPayslipData,null);assert.equal(h.node('payslipModal').style.display,'none');h.w.currentPayslipData=old;await h.w.finalizePayslip();assert.equal(h.writes.length,0);assert.ok(h.events.some(event=>Array.isArray(event)&&/Refresh unpaid payslip/.test(event[0])));});
test('an existing payment confirmation cannot write after the cutoff changes underneath it',async()=>{const gate=held();let confirmation=false;const h=harness({confirm:async options=>{if(options?.title==='💸 Disburse Payroll'){confirmation=true;return gate.promise;}return {isConfirmed:false};}});await h.w.generateAutoPayslips();h.w.currentPayslipData=h.w.globalPayrollCache['Sample Staff'];h.node('psNetPay').innerText='450.00';for(const id of ['psLoans','psAdvance','psFoods'])h.node(id).innerText='0';const work=h.w.finalizePayslip();for(let n=0;n<20&&!confirmation;n++)await tick();assert.equal(confirmation,true);h.node('payrollEnd').value='2030-01-17';h.node('payrollEnd').emit('change');gate.resolve({isConfirmed:true,value:'0'});await work;assert.equal(h.writes.length,0);assert.equal(h.node('btnFinalizePayslip').disabled,true);});

function datedSalary(h){
 Object.assign(h.person,{hourlyRate:500,salaryRateVersion:1,salaryRateRevision:'raise'});
 h.records.staff_salary_rates=[{id:'person-a',staffId:'person-a',branch:h.person.branch,version:1,revision:1,revisionId:'raise',baselineDailyRate:450,rates:{raise:{effectiveDate:'2030-01-17',dailyRate:500,sequence:1}}}];
}
for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': dated salary keeps the earlier cutoff old and splits a mixed cutoff per shift',async()=>{
  const h=harness();datedSalary(h);await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'].basicPay,450);
  h.node('payrollEnd').value='2030-01-17';h.records.attendance_logs=[...h.logs(16),...h.logs(17)];await h.w[generator]();
  const d=h.w.globalPayrollCache['Sample Staff'];assert.equal(d.basicPay,950);assert.equal(d.shiftsWorked,2);assert.equal(d.logs.filter(row=>row.dailyRate===450).length,1);assert.equal(d.logs.filter(row=>row.dailyRate===500).length,1);
  assert.equal(Object.hasOwn(d.profile,'salaryRateTimeline'),false);assert.equal(h.writes.length,0);
 });
 test(generator+': mixed-cutoff lateness uses each work date daily wage divided by eight',async()=>{
  const h=harness();datedSalary(h);h.node('payrollEnd').value='2030-01-17';h.records.attendance_logs=[...h.logs(16),...h.logs(17)].map(row=>row.type==='TIME IN'?{...row,lateMinutes:30}:row);await h.w[generator]();
  const d=h.w.globalPayrollCache['Sample Staff'];assert.equal(d.basicPay,950);assert.equal(d.lateDeduction,118.75);
 });
 test(generator+': post-midnight clock-in retains the previous scheduled work date wage',async()=>{
  const h=harness();datedSalary(h);h.node('payrollEnd').value='2030-01-17';
  h.records.attendance_logs=[{...h.logs(16)[0],timestamp:stamp('2030-01-17T00:15:00+08:00'),lateExempted:true,scheduleSnapshot:{expectedStartAt:'2030-01-16T23:00:00+08:00',expectedEndAt:'2030-01-17T07:00:00+08:00',shiftId:'night',shiftType:'night',isNightShift:true,wasScheduled:true}}, {...h.logs(16)[1],timestamp:stamp('2030-01-17T08:15:00+08:00')}];
  await h.w[generator]();const d=h.w.globalPayrollCache['Sample Staff'];assert.equal(d.basicPay,450);assert.equal(d.logs[0].rateWorkDate,'2030-01-16');
 });
 test(generator+': private salary read failure holds unpaid amounts while paid snapshots stay immutable',async()=>{
  const h=harness({readDoc:()=>{throw Error('Private salary access unavailable');}});datedSalary(h);await h.w[generator]();
  const held=h.w.globalPayrollCache['Sample Staff'];assert.equal(held.hours,8);assert.equal(held.attendanceReviewRequired,true);assert.equal(held.salaryReviewRequired,true);assert.equal(held.profile.hourlyRate,null);assert.equal(held.isPaid,undefined);assert.equal(h.writes.length,0);
  assert.match(held.payrollReviewReasons.join(' '),/Daily wage history could not be confirmed/);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱0.00');
  await h.w.openPayslipModal('Sample Staff');assert.equal(h.node('btnFinalizePayslip').disabled,true);await h.w.finalizePayslip();assert.equal(h.writes.length,0);
  const frozen={name:'Sample Staff',isPaid:true,basicPay:123,shiftsWorked:1,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{hourlyRate:123}};
  h.records.payroll_records=[{id:'paid',staffName:'Sample Staff',startDate:'2030-01-16',endDate:'2030-01-16',frozenData:frozen}];await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'],frozen);assert.equal(frozen.basicPay,123);assert.equal(h.writes.length,0);
 });
 test(generator+': one unavailable private wage retains its hours while another employee remains payable',async()=>{
  const h=harness({readDoc:()=>{throw Error('Private salary access unavailable');}});datedSalary(h);
  h.records.cashiers.push({id:'person-b',cashierName:'Other Staff',branch:h.person.branch,hourlyRate:450});
  h.records.attendance_logs.push(...h.logs(16).map((row,index)=>({...row,id:'other-'+index,staffId:'person-b',staffName:'Other Staff'})));
  await h.w[generator]();const held=h.w.globalPayrollCache['Sample Staff'],valid=h.w.globalPayrollCache['Other Staff'];
  assert.equal(held.hours,8);assert.equal(held.attendanceReviewRequired,true);assert.equal(held.profile.hourlyRate,null);
  assert.equal(valid.hours,8);assert.equal(valid.basicPay,450);assert.equal(valid.attendanceReviewRequired,false);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');assert.equal(h.writes.length,0);
 });
 test(generator+': a workdate before the saved wage baseline holds only that employee without inventing a zero wage',async()=>{
  const h=harness();datedSalary(h);h.records.staff_salary_rates[0].baselineDailyRate=null;
  h.records.cashiers.push({id:'person-b',cashierName:'Other Staff',branch:h.person.branch,hourlyRate:450});
  h.records.attendance_logs.push(...h.logs(16).map((row,index)=>({...row,id:'other-'+index,staffId:'person-b',staffName:'Other Staff'})));
  await h.w[generator]();const held=h.w.globalPayrollCache['Sample Staff'],valid=h.w.globalPayrollCache['Other Staff'];
  assert.equal(held.hours,8);assert.equal(held.attendanceReviewRequired,true);assert.equal(held.profile.hourlyRate,null);assert.match(held.payrollReviewReasons.join(' '),/Daily wage is not confirmed for 2030-01-16/);
  assert.equal(valid.basicPay,450);assert.equal(valid.attendanceReviewRequired,false);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');assert.equal(h.writes.length,0);
 });
 test(generator+': a dated-wage profile with no cutoff source does not launch an unrelated private read',async()=>{
  const reads=[],h=harness({readDoc:ref=>{reads.push(ref.id);throw Error('Unrelated wage must not be read');}});
  h.records.cashiers.push({id:'no-cutoff-work',cashierName:'No Cutoff Work',branch:h.person.branch,hourlyRate:500,salaryRateVersion:1,salaryRateRevision:'private'});
  await h.w[generator]();assert.deepEqual(reads,[]);assert.equal(h.w.globalPayrollCache['Sample Staff'].basicPay,450);assert.equal(Object.hasOwn(h.w.globalPayrollCache,'No Cutoff Work'),false);assert.equal(h.writes.length,0);
 });
 test(generator+': established employment and missing start confirmation never erase completed cutoff hours',async()=>{
  const h=harness();h.person.dateHired='2029-02-25';h.person.onboardingStartConfirmation=null;
  h.records.attendance_logs.push({...h.logs(17)[0],id:'missing-out',timestamp:stamp('2030-01-16T23:00:00+08:00')});
  await h.w[generator]();const row=h.w.globalPayrollCache['Sample Staff'];assert.equal(row.hours,8);assert.equal(row.basicPay,450);assert.equal(row.attendanceReviewRequired,false);assert.equal(row.profile.dateHired,'2029-02-25');assert.ok(row.logs.some(item=>item.out==='MISSED'));assert.equal(h.writes.length,0);
 });
}
test('actual finalization refuses a changed salary revision before any cash or payroll write',async()=>{
 const h=harness();datedSalary(h);await h.w.generateAutoPayslips();h.w.currentPayslipData=h.w.globalPayrollCache['Sample Staff'];h.person.salaryRateRevision='another-change';await h.w.finalizePayslip();
 assert.equal(h.writes.length,0);assert.ok(h.events.some(event=>JSON.stringify(event).includes('Salary dates changed')));
});

test('actual finalization refuses a legacy preview after the first dated salary change',async()=>{
 const h=harness();await h.w.generateAutoPayslips();h.w.currentPayslipData=h.w.globalPayrollCache['Sample Staff'];assert.equal(h.w.currentPayslipData.profile.salaryRateVersion,undefined);
 datedSalary(h);await h.w.finalizePayslip();assert.equal(h.writes.length,0);assert.ok(h.events.some(event=>JSON.stringify(event).includes('Salary dates changed')));
});

for(const generator of ['loadPayrollGenerator','generateAutoPayslips'])test(generator+': scoped HQ excludes foreign payroll inputs before requesting a private salary',async()=>{
 const privateReads=[],h=harness({readDoc:ref=>{privateReads.push(ref.id);throw Error('An out-of-scope private salary must not be read');}});
 h.w.sessionUser={...h.w.sessionUser,permissions:['payroll'],allowedBranches:['Sample Branch'],isOwner:true};
 const foreign={id:'foreign',cashierName:'Foreign Staff',branch:'Foreign Branch',hourlyRate:500,salaryRateVersion:1,salaryRateRevision:'foreign-change'};h.records.cashiers.push(foreign);
 h.records.attendance_logs.push(...h.logs(16).map((row,index)=>({...row,id:'foreign-'+index,staffId:'foreign',staffName:'Foreign Staff',branch:'Foreign Branch'})));
 h.records.staff_deductions=[{staffName:'Foreign Staff',branch:'Foreign Branch',type:'Cash Advance',amount:100,status:'Unpaid',dateAdded:stamp('2030-01-16T12:00:00+08:00')}];
 h.records.staff_bonuses=[{staffName:'Foreign Staff',branch:'Foreign Branch',amount:100,dateAdded:stamp('2030-01-16T12:00:00+08:00')}];h.records.payroll_records=[{staffName:'Foreign Paid Staff',frozenData:{name:'Foreign Paid Staff',branch:'Foreign Branch',basicPay:500,hours:8,isPaid:true}}];
 await h.w[generator]();assert.deepEqual(privateReads,[]);assert.deepEqual(Object.keys(h.w.globalPayrollCache),['Sample Staff']);assert.equal(h.w.globalPayrollCache['Sample Staff'].basicPay,450);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');assert.equal(h.node('payrollGeneratorBody').innerHTML.includes('Foreign'),false);assert.equal(h.writes.length,0);
});

for(const generator of ['loadPayrollGenerator','generateAutoPayslips'])test(generator+': repeated Generate clicks share one physical query bundle and keep one current preview',async()=>{
 const gate=held();let h;h=harness({read:async(ref,{snapshot,records})=>{await gate.promise;return snapshot(records[ref.table]||[]);}});
 const pending=Array.from({length:12},()=>h.w[generator]());assert.equal(h.calls.length,6);gate.resolve();await Promise.all(pending);assert.equal(h.calls.length,6);assert.equal(h.w.globalPayrollCache['Sample Staff'].basicPay,450);assert.doesNotThrow(()=>h.w.getPayrollPreviewGuard().requireReady());assert.equal(h.writes.length,0);
});

function addReviewedCashShortage(h,options={}){
 h.w.auth.currentUser.providerData=[{providerId:'google.com'}];
 const row=approvedCashShortage({staffId:h.person.id,name:h.person.cashierName,branch:h.person.branch,effectiveDate:'2030-01-16',...options});
 h.records.staff_deductions.push(row.deduction);(h.records.cash_shortage_reviews||=[]).push(row.review);(h.records.staff_deduction_notices||=[]).push(row.notice);(h.records.shifts||=[]).push({...row.shift,id:row.shiftId});return row;
}
for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': the real generator includes only due Owner-reviewed cash shortages with full linked amount and keeps legacy penalties excluded',async()=>{
  const h=harness(),row=addReviewedCashShortage(h);addReviewedCashShortage(h,{shiftId:'future',effectiveDate:'2030-01-17'});
  h.records.staff_deductions.push({id:'legacy',staffName:h.person.cashierName,branch:h.person.branch,type:'Penalty',scheduleVersion:1,scheduleRevision:1,effectiveDate:'2030-01-16',amount:500,status:'Unpaid',dateAdded:stamp('2030-01-16T12:00:00+08:00')});
  await h.w[generator]();const d=h.w.globalPayrollCache['Sample Staff'];assert.ok(d,JSON.stringify(h.events));assert.equal(d.cashShortages,90);assert.deepEqual(JSON.parse(JSON.stringify(d.cashShortageRows)),[{id:row.id,amount:90}]);assert.equal(d.penalties,500);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱360.00');assert.match(h.node('payrollGeneratorBody').innerHTML,/90.00 \(Owner-reviewed cash shortage\)/);assert.match(h.node('payrollGeneratorBody').innerHTML,/excluded from net pay/);assert.equal(h.writes.length,0);
 });
 test(generator+': revoked cash review stops a new preview rather than publishing a smaller or unverified payroll',async()=>{
  const h=harness();addReviewedCashShortage(h);h.records.staff_deduction_notices[0].status='Cancelled';await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.equal(h.writes.length,0);assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());
 });
 test(generator+': a confirmed earlier paid cutoff remains read-only while future cash shortages are withheld',async()=>{
  const h=harness();addReviewedCashShortage(h,{effectiveDate:'2030-01-17'});const frozen={name:'Sample Staff',branch:h.person.branch,staffId:h.person.id,isPaid:true,finalNetPay:123,basicPay:123,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{hourlyRate:123}};h.records.payroll_records=[{id:'old-paid',staffId:h.person.id,staffName:h.person.cashierName,startDate:frozen.start,endDate:frozen.end,frozenData:frozen}];await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'],frozen);assert.equal(frozen.basicPay,123);assert.equal(frozen.cashShortages,undefined);assert.equal(h.writes.length,0);
 });
 test(generator+': a newly reviewed cash source cannot block or recompute an already paid staff snapshot',async()=>{
  const h=harness();addReviewedCashShortage(h);h.records.cash_shortage_reviews[0].status='Cancelled';const frozen={name:'Sample Staff',branch:h.person.branch,staffId:h.person.id,isPaid:true,finalNetPay:123,basicPay:123,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{hourlyRate:123}};h.records.payroll_records=[{id:'old-paid',staffId:h.person.id,staffName:h.person.cashierName,startDate:frozen.start,endDate:frozen.end,frozenData:frozen}];await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'],frozen);assert.equal(frozen.cashShortages,undefined);assert.equal(h.writes.length,0);
 });
}

test('actual payslip editor shows a fixed cash shortage line and includes it once in recalculated net',async()=>{
 const h=harness();addReviewedCashShortage(h);await h.w.generateAutoPayslips();h.node('psDynamicDeductionsArea').innerHTML='';
 vm.runInContext(extract('recalcPayslip'),h.context);await h.w.openPayslipModal('Sample Staff');assert.equal(h.node('psCashShortages').textContent,'90.00');assert.equal(h.node('psTotalDeduct').innerText,'90.00');assert.equal(h.node('psNetPay').innerText,'360.00');assert.equal(h.w.currentPayslipData.cashShortages,90);assert.equal(h.writes.length,0);
});

function installLedgerHandlers(h,{payment='20',owner=true}={}){
 const changes=[],alerts=[],reloads=[];
 h.node('ledgerBranchFilter').value='All';
 h.w.auth.currentUser.email=h.w.sessionUser.email=owner?'jgo031996@gmail.com':'manager@example.test';h.w.sessionUser.isOwner=owner;
 h.context.getDocs=async ref=>h.snapshot((h.records[ref.table]||[]).filter(row=>(ref.filters||[]).every(filter=>filter.op!=='=='||row[filter.field]===filter.value)));
 h.context.updateDoc=async(ref,patch)=>{changes.push({ref,patch});const row=(h.records[ref.table]||[]).find(row=>row.id===ref.id);if(!row)throw Error('Missing saved row');Object.assign(row,patch);};
 h.context.addDoc=async(ref,data)=>{changes.push({ref,data});(h.records[ref.table]||=[]).push({id:'created-'+changes.length,...data});};
 h.context.serverTimestamp=()=>stamp('2030-01-16T12:00:00+08:00');h.context.isCashShortageDeduction=isCashShortageDeduction;h.context.canReviewCashShortage=canReviewCashShortage;h.context.installSanctionScheduling=()=>{};h.context.dailyStaffRate=profile=>profile.hourlyRate;
 h.context.Swal.fire=async(...args)=>{alerts.push(args);return args[0]?.input==='number'?{value:payment}:{isConfirmed:false};};
 for(const name of ['loadLedger','logLoanPayment','openEmployeeProfile'])vm.runInContext(extract(name),h.context);
 return {changes,alerts,reloads,stubReload:()=>{h.w.loadLedger=()=>reloads.push(true);}};
}
function ordinaryLedgerRow(h,{id='meal',type='Staff Meal',amount=20}={}){return {id,type,amount,staffName:h.person.cashierName,staffId:h.person.id,branch:h.person.branch,status:'Unpaid',dateAdded:stamp('2030-01-15T12:00:00+08:00')};}

test('actual ledger totals exclude approved, future, disputed and prefix-protected cash cases while ordinary debts stay payable',async()=>{
 const h=harness(),cash=approvedCashShortage({staffId:h.person.id,name:h.person.cashierName,branch:h.person.branch,effectiveDate:'2030-01-16'});
 h.records.staff_deductions=[{...cash.deduction,dateAdded:stamp('2030-01-01T19:00:00+08:00')},{...cash.deduction,id:'cash-shortage-future',effectiveDate:'2030-01-31',amount:70},{...cash.deduction,id:'cash-shortage-disputed',amount:80},{...cash.deduction,id:'cash-shortage-legacy-looking',type:'Staff Meal',amount:10},ordinaryLedgerRow(h)];
 const controls=installLedgerHandlers(h);await h.w.loadLedger();assert.match(h.node('ledgerTableBody').innerHTML,/logLoanPayment\('undefined', 'Sample Staff', 0, 0, 20\)/);assert.equal(controls.changes.length,0);
 controls.stubReload();await h.w.logLoanPayment('undefined','Sample Staff',0,0,20);assert.equal(controls.changes.length,1);assert.equal(controls.changes[0].ref.id,'meal');assert.equal(h.records.staff_deductions.at(-1).status,'Paid');for(const row of h.records.staff_deductions.slice(0,-1))assert.equal(row.status,'Unpaid');assert.equal(controls.reloads.length,1);
});

test('a stale manual payment that included cash shortages fails before any ordinary deduction or loan write',async()=>{
 const h=harness();h.records.staff_deductions=[ordinaryLedgerRow(h),{...ordinaryLedgerRow(h,{id:'cash-shortage-case',type:'Cash Shortage',amount:90}),effectiveDate:'2030-01-31'}];h.records.staff_ledger=[{id:'loan',staffName:h.person.cashierName,totalLoaned:200,totalPaid:0}];
 const controls=installLedgerHandlers(h,{payment:'310'});controls.stubReload();await h.w.logLoanPayment('loan','Sample Staff',0,200,110);assert.deepEqual(controls.changes,[]);assert.equal(h.records.staff_deductions[0].status,'Unpaid');assert.equal(h.records.staff_deductions[1].status,'Unpaid');assert.equal(h.records.staff_ledger[0].totalPaid,0);assert.ok(controls.alerts.some(args=>String(args[1]).includes('Cash shortages can only be collected through their reviewed payroll')));
});

test('manual cash payment still applies ordinary rows first and the remaining amount to its legacy loan',async()=>{
 const h=harness();h.records.staff_deductions=[ordinaryLedgerRow(h),ordinaryLedgerRow(h,{id:'advance',type:'Cash Advance',amount:30}),ordinaryLedgerRow(h,{id:'cash-shortage-hold',type:'Cash Shortage',amount:90})];h.records.staff_ledger=[{id:'loan',staffName:h.person.cashierName,totalLoaned:200,totalPaid:0}];
 const controls=installLedgerHandlers(h,{payment:'100'});controls.stubReload();await h.w.logLoanPayment('loan','Sample Staff',0,200,50);assert.equal(h.records.staff_deductions[0].status,'Paid');assert.equal(h.records.staff_deductions[1].status,'Paid');assert.equal(h.records.staff_deductions[2].status,'Unpaid');assert.equal(h.records.staff_ledger[0].totalPaid,50);assert.equal(controls.changes.some(row=>row.ref.id==='cash-shortage-hold'),false);assert.equal(controls.reloads.length,1);
});

for(const owner of [true,false])test('actual employee history offers protected cash review only to Owner and preserves ordinary controls ('+(owner?'Owner':'Manager')+')',async()=>{
 const h=harness(),cash=approvedCashShortage({staffId:h.person.id,name:h.person.cashierName,branch:h.person.branch});h.records.staff_deductions=[{...cash.deduction,dateAdded:stamp('2030-01-16T12:00:00+08:00')},ordinaryLedgerRow(h)];h.w.globalStaffData={[h.person.id]:h.person};
 const controls=installLedgerHandlers(h,{owner});h.w.openEmployeeProfile(h.person.id);await tick();const html=h.node('empProfileHistoryBody').innerHTML,cashHTML=html.slice(html.indexOf('Cash Shortage'),html.indexOf('</tr>',html.indexOf('Cash Shortage')));assert.ok(cashHTML);assert.doesNotMatch(cashHTML,/forceMarkDeductionPaid|deleteStaffDeduction/);
 if(owner)assert.match(cashHTML,/data-cash-shortage="closed-sample"/);else {assert.doesNotMatch(cashHTML,/data-cash-shortage=/);assert.match(cashHTML,/Owner review/);}
 assert.match(html,/forceMarkDeductionPaid\('meal'/);assert.match(html,/deleteStaffDeduction\('meal'/);assert.deepEqual(controls.changes,[]);
});

// Actual-handler identity regressions: a later name-only classification must
// not erase a conflict detected on an original staff-ID-bearing source row.
for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': revoked and unmatched old balances are reviewable without zero-hour payable staff or source changes',async()=>{
  const h=harness();h.w.auth.currentUser.email=h.w.sessionUser.email=OWNER_EMAIL;h.records.attendance_logs=[];Object.assign(h.person,{status:'Resigned',pin:'REVOKED',dateResigned:'2030-01-10'});
  h.records.staff_deductions=[ordinaryLedgerRow(h,{id:'former-meal',amount:120}),{id:'orphan-advance',staffName:'Unmatched Former Sample',branch:h.person.branch,type:'Cash Advance',amount:300,status:'Unpaid',dateAdded:stamp('2029-12-01T12:00:00+08:00')}];
  const sources=h.records.staff_deductions.map(row=>[row.id,row.staffId,row.staffName,row.amount,row.status]);let review=[];h.context.renderPayrollBalanceReview=(_document,rows)=>{review=rows;};
  await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalContainer').style.display,'none');
  for(const id of ['former-meal','orphan-advance'])assert.ok(review.some(row=>row.records?.some(record=>record.id===id)),id+' remains reviewable');
  assert.deepEqual(h.records.staff_deductions.map(row=>[row.id,row.staffId,row.staffName,row.amount,row.status]),sources);assert.equal(h.writes.length,0);
 });
 test(generator+': a current employee with only unpaid balances remains in the payroll list',async()=>{
  const h=harness();h.records.attendance_logs=[];h.records.staff_deductions=[ordinaryLedgerRow(h,{amount:20})];await h.w[generator]();
  const row=h.w.globalPayrollCache[h.person.cashierName];assert.ok(row);assert.equal(row.hours,0);assert.equal(row.meals,20);assert.equal(row.attendanceReviewRequired,false);assert.equal(h.writes.length,0);
 });
 test(generator+': offboarding after actual cutoff work does not hide legitimate final pay',async()=>{
  const h=harness();Object.assign(h.person,{status:'Resigned',pin:'REVOKED',dateResigned:'2030-01-17'});await h.w[generator]();
  const row=h.w.globalPayrollCache[h.person.cashierName];assert.ok(row);assert.equal(row.hours,8);assert.equal(row.basicPay,450);assert.equal(row.attendanceReviewRequired,false);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');assert.equal(h.writes.length,0);
 });
 test(generator+': an archived paid snapshot remains available even after its live employee profile is missing',async()=>{
  const h=harness();h.w.auth.currentUser.email=h.w.sessionUser.email=OWNER_EMAIL;h.records.cashiers=[];h.records.attendance_logs=[];
  const frozen={name:'Archived Sample Staff',staffId:'former-person',branch:'Former Sample Branch',isPaid:true,basicPay:333,finalNetPay:222,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{staffId:'former-person',hourlyRate:333}};
  h.records.payroll_records=[{id:'archived-paid',staffId:'former-person',staffName:frozen.name,branch:frozen.branch,startDate:frozen.start,endDate:frozen.end,frozenData:frozen}];
  await h.w[generator]();assert.equal(h.w.globalPayrollCache[frozen.name],frozen);assert.equal(frozen.basicPay,333);assert.equal(frozen.finalNetPay,222);assert.equal(h.writes.length,0);
 });
 for(const sourceId of ['person-b','missing-person'])test(generator+': conflicting or missing source staff ID cannot pay the matching display name ('+sourceId+')',async()=>{
  const h=harness();h.records.cashiers.push({...h.person,id:'person-b',cashierName:'Other Sample Staff',scheduleNickname:'OTHER'});
  // Only the actual Owner receives unmatched legacy rows. Scoped HQ accounts
  // correctly cannot infer access from an unknown employee's display name.
  if(sourceId==='missing-person'){h.w.auth.currentUser.email=OWNER_EMAIL;h.w.sessionUser.email=OWNER_EMAIL;}
  h.records.attendance_logs=h.logs(16).map(row=>({...row,staffId:sourceId}));
  const source=h.records.attendance_logs.map(row=>[row.id,row.staffId,row.staffName,row.type]);
  await h.w[generator]();const preview=h.w.globalPayrollCache[h.person.cashierName];
  assert.ok(preview,'the affected cutoff work remains visible for identity review');assert.equal(preview.attendanceReviewRequired,true);
  assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱0.00');assert.equal(h.writes.length,0);
  assert.deepEqual(h.records.attendance_logs.map(row=>[row.id,row.staffId,row.staffName,row.type]),source);
 });
 test(generator+': a bonus with conflicting employee identity is kept for review and cannot increase another employee pay',async()=>{
  const h=harness();h.records.cashiers.push({...h.person,id:'person-b',cashierName:'Other Sample Staff',scheduleNickname:'OTHER'});
  h.records.staff_bonuses=[{id:'conflicting-bonus',staffId:'person-b',staffName:h.person.cashierName,branch:h.person.branch,type:'Manual OT',amount:100,dateAdded:stamp('2030-01-16T12:00:00+08:00')}];
  let review=[];h.context.renderPayrollBalanceReview=(_document,rows)=>{review=rows;};await h.w[generator]();
  assert.equal(h.w.globalPayrollCache[h.person.cashierName].nightBonus,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');
  assert.ok(review.some(row=>row.records?.some(record=>record.id==='conflicting-bonus')));assert.equal(h.writes.length,0);
 });
 test(generator+': a renamed employee already paid for this cutoff cannot get another payable preview',async()=>{
  const h=harness(),frozen={name:'Previous Sample Name',staffId:h.person.id,branch:h.person.branch,isPaid:true,basicPay:123,finalNetPay:123,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{staffId:h.person.id,hourlyRate:123}};
  h.records.payroll_records=[{id:'renamed-paid',staffId:h.person.id,staffName:frozen.name,startDate:frozen.start,endDate:frozen.end,frozenData:frozen}];
  await h.w[generator]();assert.equal(h.w.globalPayrollCache[frozen.name],frozen);assert.equal(frozen.basicPay,123);
  const candidate=h.w.globalPayrollCache[h.person.cashierName];assert.ok(!candidate||candidate.attendanceReviewRequired===true,'same employee ID must never produce another payable row');
  assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱123.00');assert.equal(h.writes.length,0);
 });
 test(generator+': conflicting cutoff work under a paid name remains reviewable without changing the frozen payslip',async()=>{
  const h=harness(),frozen={name:h.person.cashierName,staffId:h.person.id,branch:h.person.branch,isPaid:true,basicPay:123,finalNetPay:123,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{staffId:h.person.id,hourlyRate:123}};
  h.records.payroll_records=[{id:'same-name-paid',staffId:h.person.id,staffName:frozen.name,startDate:frozen.start,endDate:frozen.end,frozenData:frozen}];
  h.records.cashiers.push({...h.person,id:'person-b',cashierName:'Other Sample Staff',scheduleNickname:'OTHER'});h.records.attendance_logs=h.logs(16).map(row=>({...row,staffId:'person-b'}));
  let review=[];h.context.renderPayrollBalanceReview=(_document,rows)=>{review=rows;};await h.w[generator]();
  assert.equal(h.w.globalPayrollCache[frozen.name],frozen);assert.equal(frozen.basicPay,123);
  assert.ok(review.some(row=>row.records?.some(record=>record.id==='in-16'&&record.staffId==='person-b')),'the conflict cannot vanish behind a different employee paid name');
  assert.equal(h.writes.length,0);
 });
}

for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': a wrong-ID loan cannot deduct from the matching display name and holds payroll for review',async()=>{
  const h=harness();h.records.cashiers.push({...h.person,id:'person-b',cashierName:'Other Sample Staff',scheduleNickname:'OTHER'});
  const loan={id:'wrong-person-loan',staffId:'person-b',staffName:h.person.cashierName,branch:h.person.branch,totalLoaned:1000,totalPaid:250,cutoffDeduction:100};h.records.staff_ledger=[loan];
  let review=[];h.context.renderPayrollBalanceReview=(_document,rows)=>{review=rows;};await h.w[generator]();const row=h.w.globalPayrollCache[h.person.cashierName];
  assert.ok(row);assert.equal(row.attendanceReviewRequired,true);assert.equal(row.loans,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱0.00');
  assert.ok(review.some(entry=>entry.records?.some(record=>record.id===loan.id)));assert.equal(loan.totalPaid,250);assert.equal(h.writes.length,0);
 });
 test(generator+': duplicate positive loans are retained separately and cannot select a last-write deduction',async()=>{
  const h=harness();h.records.staff_ledger=[{id:'first-loan',staffId:h.person.id,staffName:h.person.cashierName,totalLoaned:1000,totalPaid:250,cutoffDeduction:100},{id:'second-loan',staffId:h.person.id,staffName:h.person.cashierName,totalLoaned:800,totalPaid:50,cutoffDeduction:80}];
  const source=JSON.stringify(h.records.staff_ledger);let review=[];h.context.renderPayrollBalanceReview=(_document,rows)=>{review=rows;};await h.w[generator]();const row=h.w.globalPayrollCache[h.person.cashierName];
  assert.equal(row.attendanceReviewRequired,true);assert.equal(row.loans,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱0.00');
  for(const id of ['first-loan','second-loan'])assert.ok(review.some(entry=>entry.records?.some(record=>record.id===id)),id);
  assert.equal(JSON.stringify(h.records.staff_ledger),source);assert.equal(h.writes.length,0);
 });
 test(generator+': a valid legacy exact-name loan keeps the existing cutoff deduction unchanged',async()=>{
  const h=harness(),loan={id:'legacy-loan',staffName:h.person.cashierName,totalLoaned:1000,totalPaid:250,cutoffDeduction:100};h.records.staff_ledger=[loan];await h.w[generator]();
  const row=h.w.globalPayrollCache[h.person.cashierName];assert.equal(row.hours,8);assert.equal(row.basicPay,450);assert.equal(row.loans,100);assert.equal(row.ledgerId,'legacy-loan');assert.equal(row.attendanceReviewRequired,false);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱350.00');assert.equal(loan.totalPaid,250);assert.equal(h.writes.length,0);
 });
 test(generator+': a former loan-only balance remains reviewable without creating a payable payroll employee',async()=>{
  const h=harness();Object.assign(h.person,{status:'Resigned',pin:'REVOKED'});h.records.attendance_logs=[];
  h.records.staff_ledger=[{id:'former-loan',staffId:h.person.id,staffName:h.person.cashierName,branch:h.person.branch,totalLoaned:1000,totalPaid:250,cutoffDeduction:100}];
  let review=[];h.context.renderPayrollBalanceReview=(_document,rows)=>{review=rows;};await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalContainer').style.display,'none');
  assert.equal(review.length,1);assert.equal(review[0].records[0].id,'former-loan');assert.equal(review[0].records[0].amount,750);assert.equal(h.records.staff_ledger[0].totalPaid,250);assert.equal(h.writes.length,0);
 });
}

for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': a buffered earlier orphan cannot erase selected-cutoff hours',async()=>{const h=harness(),valid=h.logs(16);valid[1].timeInLogId=valid[0].id;h.records.attendance_logs=[{...valid[1],id:'old-out',timestamp:stamp('2030-01-15T03:00:00+08:00'),timeInLogId:'unfetched-older-in'},...valid];await h.w[generator]();const data=h.w.globalPayrollCache[h.person.cashierName];assert.equal(data.hours,8);assert.equal(data.basicPay,450);assert.equal(data.attendanceReviewRequired,false);assert.equal(h.writes.length,0);});
 test(generator+': a future linked closure never creates hours for an unmatched cutoff-ending Time In',async()=>{const h=harness(),base={staffId:h.person.id,staffName:h.person.cashierName,branch:h.person.branch};h.records.attendance_logs=[{...base,id:'selected',type:'TIME IN',timestamp:stamp('2030-01-16T20:00:00+08:00')},{...base,id:'future-in',type:'TIME IN',timestamp:stamp('2030-01-17T01:00:00+08:00')},{...base,id:'future-out',type:'TIME OUT',timeInLogId:'future-in',branch:'Other Branch',timestamp:stamp('2030-01-17T09:00:00+08:00')}];await h.w[generator]();const data=h.w.globalPayrollCache[h.person.cashierName];assert.equal(data?.hours||0,0);assert.equal(data?.basicPay||0,0);assert.equal(h.writes.length,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱0.00');});
 test(generator+': an affected employee retains readable completed pairs while a separate in-cutoff source is held',async()=>{const h=harness(),valid=h.logs(16);valid[1].timeInLogId=valid[0].id;h.records.attendance_logs=[...valid,{...valid[1],id:'unmatched-out',timestamp:stamp('2030-01-16T20:00:00+08:00'),timeInLogId:'missing-source'}];await h.w[generator]();const data=h.w.globalPayrollCache[h.person.cashierName];assert.equal(data.attendanceReviewRequired,true);assert.equal(data.recordedHours,8);assert.equal(data.attendanceLogIds.includes('unmatched-out'),true);assert.equal(data.logs.some(row=>row.hrs==='8.00'&&row.remark.includes('Recorded pair')),true);assert.match(h.node('payrollGeneratorBody').innerHTML,/8.00 recorded paired hrs/);await h.w.openPayslipModal(h.person.cashierName);assert.equal(h.node('btnFinalizePayslip').disabled,true);await h.w.finalizePayslip();assert.equal(h.writes.length,0);});
 test(generator+': unavailable wage totals are labelled for review instead of a payable zero, while paid snapshots keep their saved net',async()=>{const h=harness({readDoc:()=>{throw Error('Private wage unavailable');}});datedSalary(h);vm.runInContext(extract('recalcPayslip'),h.context);await h.w[generator]();await h.w.openPayslipModal(h.person.cashierName);assert.equal(h.node('psBasicPay').innerText,'Awaiting rate review');assert.equal(h.node('psGross').innerText,'Awaiting rate review');assert.equal(h.node('psNetPay').innerText,'Awaiting rate review');assert.equal(h.node('btnFinalizePayslip').disabled,true);h.w.currentPayslipData={isPaid:true,salaryReviewRequired:true,finalNetPay:123};h.w.recalcPayslip();assert.equal(h.node('psNetPay').innerText,'123.00');assert.equal(h.writes.length,0);});
 test(generator+': a canonical prior-cutoff source omitted from the query response verifies its closure without adding prior work to pay',async()=>{
  const docReads=[];let original;const h=harness({readDoc:async ref=>{docReads.push(ref);return {id:ref.id,exists:()=>ref.table==='attendance_logs'&&ref.id==='previous-in',data:()=>original,metadata:{fromCache:false,hasPendingWrites:false}};}});
  const valid=h.logs(16);valid[1].timeInLogId=valid[0].id;original={...valid[0],id:'previous-in',timestamp:stamp('2030-01-15T18:30:00+08:00')};
  h.node('payrollEnd').value='2030-01-31';h.records.attendance_logs=[{...valid[1],id:'previous-out',timeInLogId:'previous-in',timeInAt:'2099-01-01T00:00:00Z',timestamp:stamp('2030-01-16T03:00:00+08:00')},...valid];
  await h.w[generator]();const data=h.w.globalPayrollCache[h.person.cashierName];assert.equal(data.attendanceReviewRequired,false);assert.equal(data.hours,8);assert.equal(data.basicPay,450);assert.equal(data.shiftsWorked,1);assert.equal(data.logs.some(row=>row.in==='HR REVIEW'),false);assert.equal(data.logs.some(row=>row.hrs==='8.50'),false);assert.deepEqual(docReads,[{table:'attendance_logs',id:'previous-in'}]);
  const query=h.calls.find(ref=>ref.table==='attendance_logs'),from=query.filters.find(filter=>filter.field==='timestamp'&&filter.op==='>=');assert.equal(+from.value,+new Date(generator==='loadPayrollGenerator'?'2030-01-15T00:00:00':'2030-01-16T00:00:00'));assert.equal(h.writes.length,0);
 });
 test(generator+': a real unresolved source identifies its exact issue day and IDs instead of dating the hold from the first valid shift',async()=>{
  const h=harness(),valid=h.logs(16);valid[1].timeInLogId=valid[0].id;h.node('payrollEnd').value='2030-01-31';
  h.records.attendance_logs=[...valid,{...valid[1],id:'actual-orphan-out',timeInLogId:'actual-missing-in',timestamp:stamp('2030-01-18T03:00:00+08:00')}];
  await h.w[generator]();const data=h.w.globalPayrollCache[h.person.cashierName],heldRow=data.logs.find(row=>row.in==='HR REVIEW');assert.equal(data.attendanceReviewRequired,true);assert.equal(data.recordedHours,8);assert.deepEqual(Array.from(data.attendanceLogIds),['actual-orphan-out']);assert.equal(data.attendanceIssues[0].id,'actual-orphan-out');assert.equal(data.attendanceIssues[0].timeInLogId,'actual-missing-in');assert.equal(+data.attendanceIssues[0].timestamp.toDate(),+new Date('2030-01-18T03:00:00+08:00'));assert.equal(heldRow.date,new Date('2030-01-18T03:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}));assert.deepEqual(Array.from(heldRow.attendanceLogIds),['actual-orphan-out']);
  await h.w.openPayslipModal(h.person.cashierName);assert.equal(h.node('btnFinalizePayslip').disabled,true);await h.w.finalizePayslip();assert.equal(h.writes.length,0);
 });
}

test('the actual attendance correction refresh callback rebuilds the selected unpaid payroll from saved punches',async()=>{
 const h=harness(),changes=[];h.records.attendance_logs=[h.logs(16)[0]];
 await h.w.generateAutoPayslips();assert.equal(h.w.globalPayrollCache[h.person.cashierName].logs[0].out,'MISSED');
 h.w.invalidateCache=table=>changes.push(table);h.w.loadAttendanceLogs=async()=>changes.push('attendance-list-read');
 vm.runInContext(extract('refreshPayrollAfterAttendanceCorrection'),h.context);
 h.records.attendance_logs.push(h.logs(16)[1]);await h.w.refreshPayrollAfterAttendanceCorrection();
 const fresh=h.w.globalPayrollCache[h.person.cashierName];assert.equal(fresh.hours,8);assert.equal(fresh.basicPay,450);assert.equal(fresh.logs.some(row=>row.out==='MISSED'),false);
 assert.deepEqual(changes,['attendance_logs','attendance-list-read']);assert.doesNotThrow(()=>h.w.getPayrollPreviewGuard().requireReady());assert.equal(h.writes.length,0);
});
test('the actual attendance correction refresh callback reports an unsuccessful fresh payroll read',async()=>{
 const h=harness();await h.w.generateAutoPayslips();vm.runInContext(extract('refreshPayrollAfterAttendanceCorrection'),h.context);
 h.w.getDocsFromServer=async()=>{throw Error('Fictional connection unavailable');};
 await assert.rejects(h.w.refreshPayrollAfterAttendanceCorrection());assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());assert.equal(h.writes.length,0);
});

for(const generator of ['loadPayrollGenerator','generateAutoPayslips'])test(generator+': actual generation itemizes due one-time custom deductions and excludes future records without changing profile recurring settings',async()=>{
 const h=harness(),id='owner-deduction-00000000-0000-4000-8000-000000000001',futureId='owner-deduction-00000000-0000-4000-8000-000000000002';h.w.auth.currentUser.email=OWNER_EMAIL;h.w.auth.currentUser.providerData=[{providerId:'google.com'}];h.w.sessionUser.email=OWNER_EMAIL;h.context.console.error=e=>h.events.push(e?.message||String(e));const guard=h.w.getPayrollPreviewGuard(),fail=guard.fail;guard.fail=(token,error)=>{h.events.push(error.message);return fail(token,error);};
 const common={id,type:'Owner Custom Deduction',staffId:h.person.id,staffName:h.person.cashierName,branch:h.person.branch,sourcePlatform:'Owner review',sourceReceiptId:id,label:'Damaged cup',category:'Damaged item',incidentDate:'2030-01-15',amount:35,effectiveDate:'2030-01-16'};
 const review={...common,schemaVersion:1,staffBranch:h.person.branch,status:'Approved',revision:2,authorizedAmount:35,proposedAmount:35,sourceLossCents:3500,responsibilityConfirmed:true,lawfulAuthorityConfirmed:true,weeklyLimitConfirmed:true,lawfulBasis:'Legal authority permitting this deduction',authorityReference:'PRIVATE authority reference',finding:'PRIVATE responsibility finding',details:'PRIVATE incident details',evidence:'PRIVATE evidence',replyRevisionReviewed:1};
 const charge={...common,incidentId:id,ownerDeductionVersion:1,status:'Unpaid',reviewRevision:2,authorizedAmount:35,dateAdded:stamp('2030-02-01T09:00:00+08:00')},notice={...common,incidentId:id,version:1,status:'Approved',noticeRevision:2,replyRevision:1,staffReply:'PRIVATE staff response',sourceLossCents:3500,weeklyLimitConfirmed:true,lawfulBasis:review.lawfulBasis,authorityReference:review.authorityReference,finding:review.finding,ownerReply:review.finding,details:review.details,evidence:review.evidence};
 h.records.staff_deductions=[charge,{...charge,id:futureId,incidentId:futureId,sourceReceiptId:futureId,effectiveDate:'2030-02-01'}];h.records.owner_deduction_reviews=[review];h.records.staff_deduction_notices=[notice];await h.w[generator]();const data=h.w.globalPayrollCache[h.person.cashierName];assert.ok(data,JSON.stringify({events:h.events,status:h.node('payrollPreviewStatus').textContent,keys:Object.keys(h.w.globalPayrollCache),body:h.node('payrollGeneratorBody').innerHTML}));assert.equal(data.ownerDeductions,35);assert.equal(data.ownerDeductionRows.length,1);assert.equal(data.ownerDeductionRows[0].id,id);assert.equal(data.ownerDeductionDetails[0].label,'Damaged cup');assert.doesNotMatch(JSON.stringify(data.ownerDeductionDetails),/PRIVATE/);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱415.00');assert.equal(h.writes.length,0);assert.equal(h.person.customDeductions,undefined);
});
