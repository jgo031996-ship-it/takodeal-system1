import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-manager/payroll-safety.js';
import * as schedule from '../takodeal-manager/schedule-history.js';
import * as sanctions from '../takodeal-manager/sanction-schedule.js';
import * as freshness from '../takodeal-manager/payroll-schedule-freshness.js';
import * as preview from '../takodeal-manager/payroll-preview-guard.js';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';
import {attendanceMillis} from '../takodeal-manager/attendance-reconcile.js';

const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function extract(name){const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,name+' source exists');return source.slice(start+1,end+3);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const held=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const stamp=value=>({toDate:()=>new Date(value)});
function harness(options={}){
 const nodes=new Map(),events=[],writes=[],calls=[];
 const node=id=>{if(!nodes.has(id)){const listeners={};nodes.set(id,{id,value:'',innerText:'0',textContent:'',innerHTML:'',style:{},tagName:'DIV',disabled:false,addEventListener:(name,fn)=>{(listeners[name]||=[]).push(fn);},emit:name=>{for(const fn of listeners[name]||[])fn({target:node(id)});}});}return nodes.get(id);};
 node('payrollStart').value=node('payrollEnd').value='2030-01-16';node('payrollGrandTotalContainer').style.display='flex';node('payrollGrandTotalAmount').innerText='₱1,234.56';node('payslipModal').style.display='block';
 const person={id:'person-a',cashierName:'Sample Staff',scheduleNickname:'SAMPLE',branch:'Sample Branch',hourlyRate:450,nightDiffRate:0},owner={uid:'owner-a',email:'owner@example.test'};
 const plan={currentYear:2030,currentMonth:1,branchConfig:{'Sample Branch':[{id:'day',name:'Day',startTime:'09:00',endTime:'17:00',shiftType:'morning',active:true}]},currentSchedule:{16:{'Sample Branch':{scheduled:{day:'SAMPLE'}}},17:{'Sample Branch':{scheduled:{day:'SAMPLE'}}}}};
 const logs=day=>[{id:'in-'+day,staffId:person.id,staffName:person.cashierName,branch:person.branch,type:'TIME IN',timestamp:stamp('2030-01-'+day+'T09:00:00+08:00'),lateMinutes:0},{id:'out-'+day,staffId:person.id,staffName:person.cashierName,branch:person.branch,type:'TIME OUT',timestamp:stamp('2030-01-'+day+'T17:00:00+08:00')}];
 const records={cashiers:[person],staff_ledger:[],payroll_records:[],attendance_logs:logs(16),staff_deductions:[],staff_bonuses:[]};
 const snapshot=(rows,metadata={fromCache:false,hasPendingWrites:false})=>{const docs=rows.map((row,index)=>({id:row.id||String(index),metadata:{fromCache:false,hasPendingWrites:false},data:()=>row}));return {docs,metadata,forEach:fn=>docs.forEach(fn)};};
 const api={db:{},auth:{currentUser:{...owner}},sessionUser:{...owner,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:()=>({}),query:(ref,...filters)=>({...ref,filters}),getDocs:async()=>assert.fail('Default cached getDocs must never be called for payroll preview'),getDocsFromServer:async ref=>{calls.push(ref);return options.read?options.read(ref,{snapshot,records,logs}):snapshot(records[ref.table]||[]);},getDoc:async()=>({exists:()=>true,data:()=>plan}),isBranchAllowed:()=>true,loadPayrollScheduleHistory:async()=>schedule.assembleScheduleHistory(plan),ManagerUI:{notify:message=>events.push(message)},liveAccounts:[{id:'sample-account',name:'Sample Cash',balance:5000}],globalPayrollCache:{Old:{name:'Old'}},currentPayslipData:{name:'Old'},updateDoc:async()=>writes.push('update'),addDoc:async()=>writes.push('add')};
 api.getDocFromServer=async ref=>{if(options.readDoc)return options.readDoc(ref,{records});const row=(records[ref.table]||[]).find(item=>item.id===ref.id||item.staffId===ref.id);return {exists:()=>!!row,data:()=>row,metadata:{fromCache:false,hasPendingWrites:false}};};
 const Swal={fire:async(...args)=>{events.push(args);return options.confirm?options.confirm(...args):{isConfirmed:false};},showValidationMessage:message=>events.push(message)};
 const document={getElementById:node,querySelectorAll:()=>[]};
 const context=vm.createContext({...api,...payroll,...schedule,...sanctions,...freshness,...preview,canOpenWorkspacePage,planPayrollAttendance,attendanceMillis,window:api,document,Swal,Date,console:{error(){},log(){}},escapeHtml:value=>String(value)});
 for(const name of ['getPayrollPreviewGuard','requirePayrollPreview','loadPayrollGenerator','generateAutoPayslips','openPayslipModal','finalizePayslip'])vm.runInContext(extract(name),context);
 return {context,w:api,node,nodes,events,writes,calls,records,logs,snapshot,person};
}

for(const generator of ['loadPayrollGenerator','generateAutoPayslips']){
 test(generator+': SDK dispatch occurs under the captured account before a queued account switch, and the late result is discarded',async()=>{const dispatched=[];let h;h=harness({read:(ref,{snapshot,records})=>{dispatched.push(h.w.auth.currentUser.uid);return snapshot(records[ref.table]||[]);}});h.context.savedSchedule={historyMonths:{}};vm.runInContext('window.loadPayrollScheduleHistory=()=>Promise.resolve(savedSchedule);',h.context);const work=h.w[generator]();queueMicrotask(()=>{h.w.auth.currentUser={uid:'other-owner',email:'other@example.test'};});await work;assert.deepEqual(dispatched,['owner-a']);assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.equal(h.writes.length,0);assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());});
 test(generator+': a cached/partial server result revokes the old total and cache instead of publishing smaller payroll',async()=>{const h=harness({read:(ref,{snapshot,records})=>snapshot(records[ref.table]||[],{fromCache:ref.table==='attendance_logs',hasPendingWrites:false})});await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalContainer').style.display,'none');assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.equal(h.w.currentPayslipData,null);assert.equal(h.node('btnFinalizePayslip').disabled,true);assert.match(h.node('payrollPreviewStatus').textContent,/could not be confirmed/);assert.throws(()=>h.w.getPayrollPreviewGuard().requireReady());});
 test(generator+': complete server results publish once, while an empty next cutoff cannot retain the previous amount',async()=>{const h=harness();await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'].hours,8);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');h.records.attendance_logs=[];await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.node('payrollGrandTotalContainer').style.display,'none');assert.equal(h.node('payrollGrandTotalAmount').innerText,'—');assert.match(h.node('payrollPreviewStatus').textContent,/No payroll records/);});
 test(generator+': an older held attendance response cannot replace a newer cutoff preview or clear its ready state',async()=>{const gate=held();let first=true;const h=harness({read:(ref,{snapshot,records,logs})=>{if(ref.table==='attendance_logs'){if(first){first=false;return gate.promise;}return snapshot(logs(17));}return snapshot(records[ref.table]||[]);}});const old=h.w[generator]();for(let n=0;n<20&&first;n++)await tick();assert.equal(first,false);h.node('payrollStart').value=h.node('payrollEnd').value='2030-01-17';h.node('payrollStart').emit('change');await h.w[generator]();const current=h.w.globalPayrollCache['Sample Staff'];assert.equal(current.start,'2030-01-17');gate.resolve(h.snapshot([]));await old;assert.equal(h.w.globalPayrollCache['Sample Staff'],current);assert.equal(h.node('payrollGrandTotalAmount').innerText,'₱450.00');assert.doesNotThrow(()=>h.w.getPayrollPreviewGuard().requireReady());});
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
  const h=harness({readDoc:()=>{throw Error('Private salary access unavailable');}});datedSalary(h);await h.w[generator]();assert.equal(Object.keys(h.w.globalPayrollCache).length,0);assert.equal(h.writes.length,0);
  const frozen={name:'Sample Staff',isPaid:true,basicPay:123,shiftsWorked:1,hours:8,start:'2030-01-16',end:'2030-01-16',logs:[],profile:{hourlyRate:123}};
  h.records.payroll_records=[{id:'paid',staffName:'Sample Staff',startDate:'2030-01-16',endDate:'2030-01-16',frozenData:frozen}];await h.w[generator]();assert.equal(h.w.globalPayrollCache['Sample Staff'],frozen);assert.equal(frozen.basicPay,123);assert.equal(h.writes.length,0);
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
