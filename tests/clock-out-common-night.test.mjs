import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAttendanceSchedule,resolveAttendanceShift} from '../takodeal-manager/payroll-safety.js';
import {resolveClockOutShift} from '../takodeal-manager/clock-out-schedule.js';
import {assessEarlyTimeOut} from '../takodeal-manager/early-time-out-model.js';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
import {createEarlyTimeOutService} from '../takodeal-manager/early-time-out-actions.js';
import {createEarlyTimeOutReviewService} from '../takodeal-manager/early-time-out-review.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

const name='Synthetic Night Crew',branch='Cabantian',staffId='synthetic-night-staff';
function commonNightFixture({startTime='18:30',endTime='03:00',timeIn='18:26',extraRules=[],workDate='2026-10-28'}={}){
 const clock=new Date(workDate+'T'+timeIn+':00+08:00');
 const rules=['night-kitchen','night-cashier'].map(id=>({id,name:id,shiftType:'night',startTime,endTime,active:true}));
 const plan={currentYear:2026,currentMonth:10,branchConfig:{[branch]:[...rules,...extraRules]},employees:[{staffId,name,branch}],
  currentSchedule:{[Number(workDate.slice(-2))]:{[branch]:{scheduled:{'night-kitchen':'Other Crew','night-cashier':'UNFILLED'},rest:[name]}}}};
 const revision=createScheduleRevision(plan,{revisionId:'captured-common-night',effectiveFrom:'2026-10-01',savedAt:'2026-10-01T07:00:00+08:00',cutover:'2026-10-01'});
 const schedule=assembleScheduleHistory(plan,[{month:'2026-10',revisions:[revision],latestRevisionId:revision.revisionId}],{enforcedFrom:'2026-10-01'});
 const profile={id:staffId,staffId,cashierName:name,branch},profiles={[name]:profile};
 const start={id:'common-night-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:clock,lateMinutes:0,scheduleSnapshot:captureAttendanceSchedule(clock,branch,name,schedule,profiles)};
 return {start,profile,profiles,schedule,revision,workDate};
}

test('a real null-slot common overnight capture completes only after all immutable plausible finishes',()=>{
 const f=commonNightFixture(),before=structuredClone(f),captured=f.start.scheduleSnapshot;
 assert.equal(captured.shiftId,null);assert.equal(captured.wasScheduled,false);assert.equal(captured.expectedEndAt,'2026-10-28T19:00:00.000Z');
 const shift=resolveClockOutShift(f.start,f.schedule,f.profiles);
 assert.equal(shift.clockOutCompleteOnly,true);assert.equal(shift.wasScheduled,false);assert.equal(shift.clockOutScheduleRecovered,false);
 assert.equal(shift.clockOutLatestFinishAt.toISOString(),captured.expectedEndAt);
 assert.deepEqual(shift.clockOutScheduleEvidence.capturedCommonTimePair.shiftIds,['night-kitchen','night-cashier']);
 for(const time of ['02:59','03:00','03:06']){
  const assessment=assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T'+time+':00+08:00'));
  assert.equal(assessment.early,false);assert.equal(assessment.complete,time!=='02:59');assert.equal(assessment.unknown,time==='02:59');
 }
 assert.deepEqual(f,before);assert.equal(resolveAttendanceShift(f.start,f.schedule,f.profiles).wasScheduled,false);
});

test('common-pair completion includes a later overlapping saved rule and ignores mutable current rules',()=>{
 const f=commonNightFixture({extraRules:[{id:'later',name:'Later night',shiftType:'night',startTime:'19:00',endTime:'04:00',active:true}]}),captured=structuredClone(f.start.scheduleSnapshot);
 f.schedule.branchConfig[branch].forEach(rule=>{rule.endTime='01:00';});
 const shift=resolveClockOutShift(f.start,f.schedule,f.profiles);
 assert.equal(shift.clockOutLatestFinishAt.toISOString(),'2026-10-28T20:00:00.000Z');assert.deepEqual(shift.clockOutScheduleEvidence.shiftIds,['night-kitchen','night-cashier','later']);
 assert.equal(assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T03:06:00+08:00')).unknown,true);
 assert.equal(assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T04:00:00+08:00')).complete,true);
 assert.deepEqual(f.start.scheduleSnapshot,captured);
});

test('a plausible adjacent-day rule keeps a null-slot capture in review instead of omitting its later finish',()=>{
 const f=commonNightFixture({startTime:'23:00',endTime:'07:00',timeIn:'23:10',extraRules:[{id:'after-midnight',shiftType:'night',startTime:'00:00',endTime:'09:00',active:true}]}),before=structuredClone(f);
 assert.equal(f.start.scheduleSnapshot.shiftId,null);
 const shift=resolveClockOutShift(f.start,f.schedule,f.profiles),assessment=assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T07:30:00+08:00'));
 assert.notEqual(shift.clockOutCompleteOnly,true);assert.equal(assessment.unknown,true);assert.equal(assessment.early,false);assert.equal(assessment.complete,false);assert.deepEqual(f,before);
});

test('a different immutable adjacent-day revision cannot be omitted from a common capture finish bound',()=>{
 const f=commonNightFixture({startTime:'23:00',endTime:'07:00',timeIn:'23:10'}),laterPlan=structuredClone(f.revision.snapshot);
 laterPlan.branchConfig[branch].push({id:'midnight-next-day',shiftType:'night',startTime:'00:00',endTime:'09:00',active:true});
 const next=createScheduleRevision(laterPlan,{revisionId:'next-day-published-before-time-in',effectiveFrom:'2026-10-29',savedAt:'2026-10-28T12:01:00+08:00',cutover:'2026-10-01'});next.sequence=2;
 f.schedule.historyMonths['2026-10'].revisions.push(next);
 f.start.scheduleSnapshot=captureAttendanceSchedule(f.start.timestamp,branch,name,f.schedule,f.profiles);
 assert.equal(f.start.scheduleSnapshot.shiftId,null);assert.equal(f.start.scheduleSnapshot.scheduleRevisionId,f.revision.revisionId);
 const before=structuredClone(f),shift=resolveClockOutShift(f.start,f.schedule,f.profiles),assessment=assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T07:30:00+08:00'));
 assert.notEqual(shift.clockOutCompleteOnly,true);assert.equal(assessment.unknown,true);assert.equal(assessment.early,false);assert.equal(assessment.complete,false);assert.deepEqual(f,before);
});

test('null-slot recovery rejects missing IDs, incomplete capture provenance and unmatched captured pairs',()=>{
 for(const change of [row=>{delete row.shiftId;},row=>{row.shiftId='';},row=>{row.shiftId='bad/path';},row=>{row.version=2;},row=>{row.source='typed';},row=>{row.branch='Other';},row=>{row.staffName='Other';},row=>{row.needsScheduleReview=true;},row=>{row.expectedEndAt='';},row=>{row.expectedEndAt='2026-10-28T19:15:00.000Z';},row=>{row.expectedStartAt='bad';},row=>{row.shiftType='morning';},row=>{row.isNightShift=false;}]){
  const f=commonNightFixture();change(f.start.scheduleSnapshot);const shift=resolveClockOutShift(f.start,f.schedule,f.profiles);
  assert.notEqual(shift.clockOutCompleteOnly,true);assert.equal(assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T03:06:00+08:00')).unknown,true);
 }
});

test('null-slot recovery requires a complete immutable revision that already existed at Time In',()=>{
 for(const change of [row=>{delete row.effectiveFrom;},row=>{delete row.effectiveTo;},row=>{row.effectiveFrom='2026-02-30';},row=>{row.effectiveTo='2026-13-01';},row=>{delete row.savedAt;},row=>{row.savedAt='2026-10-28T18:27:00+08:00';},row=>{row.schemaVersion=2;},row=>{row.kind='current-settings';},row=>{delete row.daySnapshots['2026-10-28'];},row=>{row.daySnapshots['2026-10-28'].configRevisionId='different';}]){
  const f=commonNightFixture();change(f.revision);f.schedule.historyMonths['2026-10'].revisions=[f.revision];
  assert.notEqual(resolveClockOutShift(f.start,f.schedule,f.profiles).clockOutCompleteOnly,true);
 }
 const f=commonNightFixture();f.schedule.historyMonths['2026-10'].revisions.push(structuredClone(f.revision));assert.notEqual(resolveClockOutShift(f.start,f.schedule,f.profiles).clockOutCompleteOnly,true);
});

test('a null-slot pair needs at least two valid same-category nearest anchors and all relevant rules remain validated',()=>{
 for(const change of [rules=>{rules.pop();},rules=>{rules[1].id=rules[0].id;},rules=>{rules[1].id='';},rules=>{rules[1].endTime='';},rules=>{rules[1].endTime='18:30';},rules=>{rules[1].shiftType='mid';},rules=>{rules[1].startTime='';},rules=>{rules.push({id:'broken-overlap',startTime:'19:00',endTime:'bad',active:true});}]){
  const f=commonNightFixture();change(f.revision.snapshot.branchConfig[branch]);f.schedule.historyMonths['2026-10'].revisions=[f.revision];
  assert.notEqual(resolveClockOutShift(f.start,f.schedule,f.profiles).clockOutCompleteOnly,true);
 }
});

test('Staff server timestamps may differ slightly from their local common-pair capture time',()=>{
 const f=commonNightFixture();f.start.timestamp=new Date(+f.start.timestamp+3200);
 const shift=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(shift.clockOutCompleteOnly,true);
 assert.equal(assessEarlyTimeOut(f.start,shift,new Date('2026-10-29T03:06:00+08:00')).complete,true);
});

test('a common overnight finish rolls into the next month without changing its captured work date',()=>{
 const f=commonNightFixture({workDate:'2026-10-31'}),shift=resolveClockOutShift(f.start,f.schedule,f.profiles);
 assert.equal(shift.clockOutCompleteOnly,true);assert.equal(shift.clockOutScheduleEvidence.workDate,'2026-10-31');
 assert.equal(shift.clockOutLatestFinishAt.toISOString(),'2026-10-31T19:00:00.000Z');
 assert.equal(assessEarlyTimeOut(f.start,shift,new Date('2026-11-01T03:06:00+08:00')).complete,true);
});

function protectedCommonFixture(options={}){
 const f=commonNightFixture(options),h=firestoreHarness(),email='night-reviewer@example.test';let clock=new Date('2026-10-29T02:59:00+08:00'),token=0;
 h.api.serverTimestamp=()=>new Date(clock);
 h.api.getDocFromServer=async ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}});
 const query=h.api.getDocsFromServer;h.api.getDocsFromServer=async ref=>{const result=await query(ref);return {...result,metadata:{fromCache:false,hasPendingWrites:false},docs:result.docs.map(row=>({...row,metadata:{fromCache:false,hasPendingWrites:false}}))};};
 h.api.auth={currentUser:{uid:'synthetic-night-reviewer',email,emailVerified:true}};
 h.api.sessionUser={uid:'synthetic-night-reviewer',email,role:'Manager',permissions:['inbox'],allowedBranches:[branch]};
 h.put('hq_managers/night-reviewer',{email,role:'Manager',permissions:['inbox'],assignedBranch:branch,pin:'4829',active:true});
 h.put('hq_email_access/'+email,{active:true,permissions:['inbox'],allowedBranches:[branch]});
 h.put('cashiers/'+staffId,{cashierName:name,branch,pin:'7281',active:true});
 h.put('payroll_records/frozen-paid',{status:'Paid',frozenData:{paidHours:80,netPay:4500}});
 h.put('settings/global_schedule',{...f.revision.snapshot,scheduleRevisionId:f.revision.revisionId,payrollHistoryEnforcedFrom:'2026-10-01'});
 h.put('settings/schedule_month_2026_10',{month:'2026-10',revisionIds:[f.revision.revisionId],latestRevisionId:f.revision.revisionId});
 h.put('settings/schedule_revision_'+f.revision.revisionId,f.revision);
 h.put('attendance_logs/'+f.start.id,f.start);
 const service=createEarlyTimeOutService(h.api,{now:()=>new Date(clock),makeToken:()=> 'synthetic-night-request-'+(++token)}),review=createEarlyTimeOutReviewService(h.api,{now:()=>new Date(clock)});
 const input={start:f.start,staffId,staffName:name,pin:'7281',assertCurrent(){}},attendance={staffId,staffName:name,branch,type:'TIME OUT',sourceApp:'synthetic-test-only'};
 return {...f,h,service,review,input,attendance,setClock:value=>{clock=new Date(value);}};
}

test('real protected close after a common night finish records actual departure once with no early approval or payroll change',async()=>{
 const f=protectedCommonFixture(),original=structuredClone([...f.h.docs]),before=await f.service.inspect(f.input);
 assert.equal(before.unknown,true);assert.equal(before.early,false);assert.equal(before.complete,false);assert.equal(before.clockOutCompleteOnly,true);
 const requested=await f.service.request({...f.input,reason:'Synthetic shared night schedule review.'});
 assert.equal(f.h.get('staff_requests/'+requested.id).requiresScheduleReview,true);
 await assert.rejects(f.review.review({requestId:requested.id,decision:'Approved'}),/does not identify a verified assigned shift finish/);
 await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/could not be verified/);
 assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,1);
 f.setClock('2026-10-29T03:06:00+08:00');const inspected=structuredClone([...f.h.docs]),complete=await f.review.inspect({requestId:requested.id});
 assert.equal(complete.complete,true);assert.equal(complete.early,false);assert.equal(complete.unknown,false);assert.equal(complete.closed,false);
 assert.equal(complete.scheduledEndAt,'2026-10-28T19:00:00.000Z');assert.deepEqual([...f.h.docs],inspected,'Owner inspection is read-only');
 assert.deepEqual(complete.clockOutScheduleEvidence.capturedCommonTimePair.shiftIds,['night-kitchen','night-cashier']);
 const closed=await f.service.close({...f.input,attendance:{...f.attendance,timestamp:new Date('2026-10-29T02:00:00+08:00')}});
 assert.equal(closed.saved,true);const out=f.h.get('attendance_logs/'+closed.id);
 assert.equal(+out.timestamp,+new Date('2026-10-29T03:06:00+08:00'));assert.equal(out.timeInLogId,f.start.id);assert.equal(out.earlyTimeOut,undefined);
 assert.equal(f.h.get('staff_requests/'+requested.id).status,'Completed Normally');assert.equal(f.h.get('attendance_time_out_approvals/'+requested.id),undefined);
 for(const [path,value]of original)assert.deepEqual(f.h.get(path),value,path);
 const committed=structuredClone([...f.h.docs]);assert.equal((await f.service.close({...f.input,attendance:f.attendance})).alreadySaved,true);assert.deepEqual([...f.h.docs],committed);
});

test('real complete-only night bound cannot close early when another plausible saved finish is later',async()=>{
 const f=protectedCommonFixture({extraRules:[{id:'later-night',shiftType:'night',startTime:'19:00',endTime:'04:00',active:true}]});
 f.setClock('2026-10-29T03:06:00+08:00');const before=structuredClone([...f.h.docs]),shift=await f.service.inspect(f.input);
 assert.equal(shift.unknown,true);assert.equal(shift.complete,false);assert.equal(shift.early,false);assert.equal(shift.clockOutLatestFinishAt,'2026-10-28T20:00:00.000Z');
 await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/could not be verified/);assert.deepEqual([...f.h.docs],before);
 f.setClock('2026-10-29T04:00:00+08:00');assert.equal((await f.service.close({...f.input,attendance:f.attendance})).saved,true);
});

test('the actual fresh revision reader rejects future or incomplete common-pair evidence before writing a departure',async()=>{
 for(const change of [row=>{delete row.effectiveFrom;},row=>{delete row.effectiveTo;},row=>{row.savedAt='2026-10-28T18:27:00+08:00';},row=>{row.snapshot.branchConfig[branch][1].endTime='';}]){
  const f=protectedCommonFixture();change(f.revision);f.h.put('settings/schedule_revision_'+f.revision.revisionId,f.revision);f.setClock('2026-10-29T03:06:00+08:00');const before=structuredClone([...f.h.docs]);
  const result=await Promise.allSettled([f.service.close({...f.input,attendance:f.attendance})]);assert.equal(result[0].status,'rejected');assert.deepEqual([...f.h.docs],before);
 }
});
