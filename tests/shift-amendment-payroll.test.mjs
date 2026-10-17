import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureAttendanceSchedule,resolveAttendanceShift,resolveAttendanceAmendment,attendanceLateMinutes,latePay} from '../takodeal-manager/payroll-safety.js';
import {createScheduleRevision,assembleScheduleHistory,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';
import {dutyAttendance} from '../takodeal-manager/dashboard-data.js';
import {attendanceEstimate} from '../takodeal-franchise/franchise-data.js';
import {createDashboard} from '../takodeal-manager/dashboard.js';

const branch='Sample Branch',names=['Sample One','Sample Two','Sample Three'];
const profiles=Object.fromEntries(names.map(name=>[name,{cashierName:name,staffId:'id_'+name.replace(/ /g,'_'),hourlyRate:450,nightDiffRate:50}]));
function plan(mid='13:00',night='18:30') {
 const shifts=[{id:'mid',name:'Mid',shiftType:'mid',startTime:mid,endTime:'22:00',active:true},{id:'night1',name:'Night 1',shiftType:'night',startTime:night,endTime:'03:30',active:true},{id:'night2',name:'Night 2',shiftType:'night',startTime:night,endTime:'03:30',active:true}];
 return {currentYear:2026,currentMonth:10,branchConfig:{[branch]:shifts},currentSchedule:Object.fromEntries(Array.from({length:31},(_,i)=>[i+1,{[branch]:{scheduled:{mid:names[0],night1:names[1],night2:names[2]}}}]))};
}
const revision=(data,id,from='2026-10-06')=>createScheduleRevision(data,{revisionId:id,effectiveFrom:from,savedAt:new Date(from+'T08:00:00+08:00'),cutover:'2026-10-06'});
function fixture({canonical=false}={}) {
 const old=plan(),updated=plan('14:00','19:30'),first=revision(old,'before'),after=revision(updated,'canonical','2026-10-17');
 const event={id:'correction_16',branch,effectiveFrom:'2026-10-16',effectiveTo:'2026-10-31',sourceRevisionId:'before',sourceRevisionIds:['before'],sourceDates:Object.fromEntries(Array.from({length:16},(_,i)=>['2026-10-'+(i+16),'before'])),canonicalRevisionId:'canonical',sequence:1,recordedAt:'2026-10-17T01:00:00.000Z',actor:{uid:'owner'},reason:'Correct the saved branch shift start times',changes:[{shiftId:'mid',beforeStart:'13:00',beforeEnd:'22:00',startTime:'14:00',endTime:'22:00'},{shiftId:'night1',beforeStart:'18:30',beforeEnd:'03:30',startTime:'19:30',endTime:'03:30'},{shiftId:'night2',beforeStart:'18:30',beforeEnd:'03:30',startTime:'19:30',endTime:'03:30'}]};
 const archive={month:'2026-10',revisions:canonical?[first,after]:[first],shiftAmendments:[event]};
 const history=assembleScheduleHistory(updated,[archive],{enforcedFrom:'2026-10-06'}),original=assembleScheduleHistory(old,[{month:'2026-10',revisions:[first]}],{enforcedFrom:'2026-10-06'});
 const punch=(name,time,day='2026-10-16',extra={})=>{const at=new Date(day+'T'+time+':00+08:00'),snapshot=captureAttendanceSchedule(at,branch,name,original,profiles);return {id:'in_'+name,staffName:name,staffId:profiles[name].staffId,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:snapshot,lateMinutes:snapshot.lateMinutes,...extra};};
 return {old,updated,first,after,event,history,original,punch};
}
test('the three false lateness values become zero only under the confirmed October 16 amendment',()=>{
 const h=fixture();for(const [name,time,oldLate]of [['Sample One','13:59',59],['Sample Two','19:05',35],['Sample Three','19:03',33]]) {
  const log=h.punch(name,time),before=structuredClone(log);assert.equal(log.lateMinutes,oldLate);
  const resolved=resolveAttendanceShift(log,h.history,profiles);assert.equal(resolved.lateMinutes,0);assert.equal(resolved.attendanceCorrectionVerified,true);assert.equal(resolved.workDate,'2026-10-16');assert.equal(attendanceLateMinutes(log,resolved),0);assert.equal(latePay(attendanceLateMinutes(log,resolved),profiles[name],resolved).amount,0);
  assert.deepEqual(log,before);assert.equal(attendanceLateMinutes(log,0),oldLate,'numeric callers keep legacy saved-minute behavior');
 }
});
test('real lateness remains chargeable and ordinary false exemption defaults do not block correction',()=>{
 const h=fixture(),log=h.punch('Sample Two','19:40','2026-10-16',{lateExempted:false}),resolved=resolveAttendanceShift(log,h.history,profiles);
 assert.equal(log.lateMinutes,70);assert.equal(resolved.correctedLateMinutes,10);assert.equal(resolved.amendmentNeedsReview,false);assert.equal(attendanceLateMinutes(log,resolved),10);assert.equal(latePay(10,profiles['Sample Two'],resolved).amount,62.5);
 const late=resolveAttendanceShift(h.punch('Sample Two','20:41'),h.history,profiles);assert.equal(late.lateMinutes,71);assert.equal(latePay(late.lateMinutes,profiles['Sample Two'],late).hours,2);
});
test('pre-effective dates and an October 15 overnight work date remain unchanged after Philippine midnight',()=>{
 const h=fixture(),previous=h.punch('Sample One','13:59','2026-10-15'),overnight=h.punch('Sample Two','00:05','2026-10-16');
 assert.equal(resolveAttendanceShift(previous,h.history,profiles).lateMinutes,59);assert.equal(resolveAttendanceAmendment(previous,h.history,profiles),null);
 assert.equal(overnight.scheduleSnapshot.expectedStartAt,'2026-10-15T10:30:00.000Z');assert.equal(resolveAttendanceAmendment(overnight,h.history,profiles),null);assert.equal(resolveAttendanceShift(overnight,h.history,profiles).lateMinutes,335);
});
test('manual decisions and true exemptions are preserved and flagged for HQ review',()=>{
 const h=fixture();for(const extra of [{reviewedLateMinutes:35},{reviewedLateMinutes:0},{lateExempted:true},{lateExempted:false,lateDecision:'Rejected'},{lateReviewedBy:'owner'}]) {
  const log=h.punch('Sample Two','19:05','2026-10-16',extra),before=structuredClone(log),resolved=resolveAttendanceShift(log,h.history,profiles);
  assert.equal(resolved.correctedLateMinutes,0);assert.equal(resolved.amendmentNeedsReview,true);assert.equal(resolved.needsScheduleReview,true);assert.equal(attendanceLateMinutes(log,resolved),attendanceLateMinutes(log));assert.deepEqual(log,before);
  if(log.lateExempted)assert.equal(latePay(resolved.lateMinutes,profiles['Sample Two'],resolved,true).amount,0);
 }
});
test('unknown snapshots, foreign identities, conflicting slots and incomplete source evidence cannot waive saved lateness',()=>{
 const h=fixture(),base=h.punch('Sample Two','19:05');
 for(const change of [{staffId:'different'},{staffName:'Someone else'},{scheduleSnapshot:{...base.scheduleSnapshot,branch:'Another Branch'}},{scheduleSnapshot:{...base.scheduleSnapshot,expectedStartAt:'2026-10-16T18:00:00+08:00'}},{scheduleSnapshot:{...base.scheduleSnapshot,needsScheduleReview:true}}])assert.equal(resolveAttendanceAmendment({...base,...change},h.history,profiles),null);
 const ambiguous=structuredClone(h.history);ambiguous.historyMonths['2026-10'].revisions[0].daySnapshots['2026-10-16'].daySchedule[branch].scheduled.mid='Sample Two';assert.equal(resolveAttendanceAmendment(base,ambiguous,profiles),null);
 const missing=structuredClone(h.history);missing.historyMonths['2026-10'].shiftAmendments[0].sourceRevisionId='absent';assert.equal(resolveAttendanceAmendment(base,missing,profiles),null);
 assert.equal(resolveAttendanceAmendment(base,h.history,{}),null);
});
test('wrong fallback slots require an explicit audited reconciliation to the exact dated assignment',()=>{
 const h=fixture(),old=plan(),who='Sample One';old.branchConfig[branch].push({id:'kitchen',name:'Mid Kitchen',shiftType:'mid',startTime:'18:30',endTime:'02:30',active:true});
 for(const day of Object.values(old.currentSchedule)){day[branch].scheduled.mid='Another Staff';day[branch].scheduled.kitchen=who;}
 const before=revision(old,'before'),original=assembleScheduleHistory(old,[{month:'2026-10',revisions:[before]}],{enforcedFrom:'2026-10-06'}),at=new Date('2026-10-16T16:57:52+08:00'),snapshot=captureAttendanceSchedule(at,branch,who,original,profiles);
 assert.equal(snapshot.shiftId,'mid');assert.equal(snapshot.wasScheduled,false);assert.equal(snapshot.lateMinutes,237);
 const event={...h.event,reconcileSavedAssignments:true,changes:[...h.event.changes,{shiftId:'kitchen',beforeStart:'18:30',beforeEnd:'02:30',startTime:'17:00',endTime:'01:00'}]},history=assembleScheduleHistory(old,[{month:'2026-10',revisions:[before],shiftAmendments:[event]}],{enforcedFrom:'2026-10-06'});
 const log={staffId:profiles[who].staffId,staffName:who,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:snapshot,lateMinutes:237},raw=structuredClone(log);
 const corrected=resolveAttendanceShift(log,history,profiles);assert.equal(corrected.lateMinutes,0);assert.equal(corrected.assignmentReconciled,true);assert.equal(corrected.originalShiftId,'mid');assert.equal(corrected.targetShiftId,'kitchen');assert.equal(corrected.expectedStartAt.toISOString(),'2026-10-16T09:00:00.000Z');assert.deepEqual(log,raw);
 const strict=structuredClone(history);strict.historyMonths['2026-10'].shiftAmendments[0].reconcileSavedAssignments=false;const held=resolveAttendanceShift(log,strict,profiles);assert.equal(held.lateMinutes,237);assert.equal(held.amendmentNeedsReview,true);assert.equal(held.assignmentReconciliationRequired,true);
 const previous={...log,timestamp:new Date('2026-10-15T16:57:52+08:00'),scheduleSnapshot:{...snapshot,clockInAt:'2026-10-15T08:57:52.000Z',expectedStartAt:'2026-10-15T05:00:00.000Z',expectedEndAt:'2026-10-15T14:00:00.000Z'}};assert.equal(resolveAttendanceAmendment(previous,history,profiles),null);
 const ambiguous=structuredClone(history);ambiguous.historyMonths['2026-10'].revisions[0].daySnapshots['2026-10-16'].daySchedule[branch].scheduled.night1=who;assert.equal(resolveAttendanceAmendment(log,ambiguous,profiles),null);
});
test('a punch without a snapshot needs an exact assigned dated slot; canonical amendments retain the original source',()=>{
 const h=fixture({canonical:true}),log=h.punch('Sample Two','19:05','2026-10-17');delete log.scheduleSnapshot;
 const resolved=resolveAttendanceShift(log,h.history,profiles);assert.equal(resolved.lateMinutes,0);assert.equal(resolved.attendanceCorrectionVerified,true);
 const unassigned=structuredClone(h.history);for(const rev of unassigned.historyMonths['2026-10'].revisions)delete rev.daySnapshots['2026-10-17'].daySchedule[branch].scheduled.night1;
 assert.equal(resolveAttendanceAmendment(log,unassigned,profiles),null);
 const snap=h.punch('Sample Two','19:05','2026-10-17');assert.equal(resolveAttendanceShift(snap,h.history,profiles).lateMinutes,0);
});
test('later ordinary revisions stay outside an earlier correction ancestry',()=>{
 const h=fixture(),later=plan('15:00','20:00');h.history.historyMonths['2026-10'].revisions.push(revision(later,'legitimate_later','2026-10-17'));
 const log=h.punch('Sample Two','19:05','2026-10-17');assert.equal(resolveAttendanceAmendment(log,h.history,profiles),null);assert.equal(resolveAttendanceShift(log,h.history,profiles).lateMinutes,35);
});
test('a later correction can amend a snapshot already captured under the first correction',()=>{
 const h=fixture({canonical:true}),at=new Date('2026-10-17T19:40:00+08:00'),snapshot=captureAttendanceSchedule(at,branch,'Sample Two',h.history,profiles);
 assert.equal(snapshot.expectedStartAt,'2026-10-17T11:30:00.000Z');
 const next=plan('14:00','20:00'),nextRevision=revision(next,'canonical_two','2026-10-17');nextRevision.sequence=3;
 h.after.sequence=2;const archive=h.history.historyMonths['2026-10'];archive.revisions.find(row=>row.revisionId==='canonical').sequence=2;archive.revisions.push(nextRevision);
 archive.shiftAmendments.push({...h.event,id:'correction_two',sequence:2,sourceRevisionId:'canonical',sourceDates:{'2026-10-17':'canonical'},canonicalRevisionId:'canonical_two',effectiveFrom:'2026-10-17',changes:[{shiftId:'night1',beforeStart:'19:30',beforeEnd:'03:30',startTime:'20:00',endTime:'03:30'}]});
 const log={staffName:'Sample Two',staffId:profiles['Sample Two'].staffId,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:snapshot,lateMinutes:10};
 const corrected=resolveAttendanceShift(log,h.history,profiles);assert.equal(corrected.lateMinutes,0);assert.deepEqual(corrected.scheduleAmendmentIds,['correction_two']);assert.equal(snapshot.expectedStartAt,'2026-10-17T11:30:00.000Z');
});
test('future punches capture the corrected date rule without mutating the historical source',()=>{
 const h=fixture(),before=structuredClone(h.history),at=new Date('2026-10-16T19:40:00+08:00');
 assert.equal(resolveScheduleForDate(h.history,'2026-10-16',{amendments:false}).branchConfig[branch][1].startTime,'18:30');
 const snapshot=captureAttendanceSchedule(at,branch,'Sample Two',h.history,profiles);assert.equal(snapshot.expectedStartAt,'2026-10-16T11:30:00.000Z');assert.equal(snapshot.lateMinutes,10);assert.deepEqual(h.history,before);
});
test('dashboard and Franchise preview share corrected values, while manual decisions hold the estimate',()=>{
 const h=fixture(),entry=h.punch('Sample Two','19:05'),out={...entry,id:'out',type:'TIME OUT',timeInLogId:entry.id,timestamp:new Date('2026-10-17T03:30:00+08:00')};
 const duty=dutyAttendance(entry,h.history,profiles);assert.equal(duty.lateMinutes,0);assert.equal(duty.scheduledStart,'07:30 PM');
 const result=attendanceEstimate({logs:[entry,out],profiles:[{...profiles['Sample Two'],id:profiles['Sample Two'].staffId}],schedule:h.history,start:'2026-10-16',end:'2026-10-16',branch});assert.equal(result[0].late,0);assert.equal(result[0].attendanceHeld,undefined);
 const held=attendanceEstimate({logs:[{...entry,reviewedLateMinutes:35},out],profiles:[{...profiles['Sample Two'],id:profiles['Sample Two'].staffId}],schedule:h.history,start:'2026-10-16',end:'2026-10-16',branch});assert.equal(held[0].attendanceHeld,true);assert.equal(held[0].net,null);assert.equal(held[0].late,62.5);
});
test('all four apps ship identical shared correction math',()=>{
 const expected=readFileSync(new URL('../takodeal-manager/payroll-safety.js',import.meta.url));for(const app of ['takodeal-pos','takodeal-staff','takodeal-franchise'])assert.deepEqual(readFileSync(new URL('../'+app+'/payroll-safety.js',import.meta.url)),expected);
});
function dashboardFixture(readHistory) {
 const ids=[...readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(match=>match[1]);
 const nodes=new Map(ids.map(id=>[id,{id,value:'',innerHTML:'',textContent:'',hidden:false,style:{},classList:{contains:()=>true},querySelector:()=>({}),querySelectorAll:()=>[],setAttribute(){}}]));
 nodes.set('dashBranchFilter',{...nodes.get('dashStartDate'),value:'All'});nodes.get('dashStartDate').value=nodes.get('dashEndDate').value='2026-10-16';
 const listeners=[],snap=data=>({docs:data.map((row,index)=>({id:row.id||String(index),data:()=>row})),exists:()=>!!data.length,data:()=>data[0],metadata:{fromCache:false}});
 const w={db:{},sessionUser:{uid:'owner',email:'owner@test',isOwner:true},isBranchAllowed:()=>true,collection:(_,table)=>({table}),doc:(_,table,id)=>({table:table+'/'+id}),where:(field,op,value)=>({field,op,value}),query:ref=>ref,getDocs:async ref=>snap(ref.table==='branches'?[{name:branch}]:[]),loadPayrollScheduleHistory:readHistory,onSnapshot:(ref,_,next,error)=>{const listener={ref,next,error,stopped:false};listeners.push(listener);return()=>{listener.stopped=true;};},Swal:{fire:async()=>{}}};
 const controller=createDashboard(w,{getElementById:id=>nodes.get(id),body:{classList:{add(){}}}});
 const emit=(table,data)=>listeners.find(listener=>!listener.stopped&&listener.ref.table===table).next(snap(data));
 return {w,controller,nodes,listeners,emit};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('live dashboard ignores a superseded history read and uses one follow-up for pending amendment metadata',async()=>{
 const h=fixture(),first=deferred(),second=deferred();let calls=0;
 const f=dashboardFixture(()=>++calls===1?first.promise:second.promise);await f.controller.load();
 f.emit('attendance_logs',[h.punch('Sample Two','19:05')]);f.emit('cashiers',[{...profiles['Sample Two'],id:profiles['Sample Two'].staffId}]);
 assert.match(f.nodes.get('branchTableBody').innerHTML,/Checking schedule/);assert.doesNotMatch(f.nodes.get('branchTableBody').innerHTML,/Late · 35 min/);
 f.listeners.find(listener=>listener.ref.table.startsWith('settings/schedule_month_')).next({metadata:{fromCache:false}});first.resolve(h.original);await tick();assert.equal(calls,2);
 assert.doesNotMatch(f.nodes.get('branchTableBody').innerHTML,/Late · 35 min/);second.resolve(h.history);await tick();
 assert.match(f.nodes.get('branchTableBody').innerHTML,/Scheduled 07:30 PM/);assert.doesNotMatch(f.nodes.get('branchTableBody').innerHTML,/Late · 35 min/);f.controller.stop();
});
test('dashboard history errors keep clock-ins visible and do not claim a zero late balance',async()=>{
 const h=fixture(),request=deferred(),f=dashboardFixture(()=>request.promise);await f.controller.load();f.emit('attendance_logs',[h.punch('Sample Two','19:05')]);f.emit('cashiers',[{...profiles['Sample Two'],id:profiles['Sample Two'].staffId}]);request.reject(Error('History unavailable'));await tick();
 assert.match(f.nodes.get('branchTableBody').innerHTML,/In · <time/);assert.match(f.nodes.get('branchTableBody').innerHTML,/Late status unavailable/);assert.doesNotMatch(f.nodes.get('branchTableBody').innerHTML,/Late · 35 min/);f.controller.stop();
});
