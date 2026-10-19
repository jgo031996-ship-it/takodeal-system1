import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveClockOutShift} from '../takodeal-manager/clock-out-schedule.js';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
import {resolveAttendanceShift} from '../takodeal-manager/payroll-safety.js';
import {assessEarlyTimeOut} from '../takodeal-manager/early-time-out-model.js';
const name='Sample Crew',branch='Maa',staffId='sample-staff',date='2026-10-19';
const at=time=>`${date}T${time}:00+08:00`;
function fixture({assigned=false,legacyAlias=true}={}){
 const rules=[{id:'m1',name:'Morning shift, Staff 1',shiftType:'morning',startTime:'09:00',endTime:'17:30',active:true},
  {id:'m2',name:'Morning shift, Staff 2 9:30a.m. 6p.m.',shiftType:'morning',startTime:'09:30',endTime:'18:00',active:true},
  {id:'mid',name:'Mid',shiftType:'mid',startTime:'16:00',endTime:'00:30',active:true}];
 const plan={currentYear:2026,currentMonth:10,branchConfig:{Maa:rules},employees:[],currentSchedule:{19:{Maa:{scheduled:{m1:'Other Crew',m2:assigned?'Sample':'UNFILLED'},rest:assigned?[]:['Sample']}}}};
 const revision=createScheduleRevision(plan,{revisionId:'captured-revision',effectiveFrom:date,savedAt:at('07:00'),cutover:date});
 const schedule=assembleScheduleHistory(plan,[{month:'2026-10',revisions:[revision],latestRevisionId:revision.revisionId}],{enforcedFrom:date});
 const profile={id:staffId,staffId,cashierName:name,branch,...(legacyAlias?{scheduleName:'Sample'}:{scheduleNickname:'Sample'})};
 const start={id:'sample-time-in',type:'TIME IN',staffId,staffName:name,branch,timestamp:new Date(at(assigned?'09:30':'08:49')),lateMinutes:19,
  scheduleSnapshot:{version:1,source:'clock-in',branch,staffName:name,clockInAt:new Date(at(assigned?'09:30':'08:49')).toISOString(),
   expectedStartAt:new Date(at(assigned?'09:30':'09:00')).toISOString(),expectedEndAt:new Date(at(assigned?'18:00':'17:30')).toISOString(),
   shiftId:assigned?'m2':'m1',shiftName:'Morning',shiftType:'morning',wasScheduled:false,needsScheduleReview:false,scheduleRevisionId:revision.revisionId}};
 return {start,profile,schedule,revision,profiles:{[name]:profile}};
}
test('a verified saved clock-in finish remains authoritative without rereading current rules',()=>{
 const f=fixture();f.start.scheduleSnapshot.wasScheduled=true;const expected=resolveAttendanceShift(f.start,null,f.profiles);
 assert.deepEqual(resolveClockOutShift(f.start,null,f.profiles),expected);assert.equal(expected.expectedEndAt.toISOString(),new Date(at('17:30')).toISOString());
});
test('a legacy scheduleName assignment recovers only the uniquely saved dated shift and keeps payroll evidence unchanged',()=>{
 const f=fixture({assigned:true}),before=structuredClone(f),old=resolveAttendanceShift(f.start,f.schedule,f.profiles),resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);
 assert.equal(old.wasScheduled,false);assert.equal(resolved.wasScheduled,true);assert.equal(resolved.clockOutScheduleRecovered,true);assert.equal(resolved.expectedEndAt.toISOString(),new Date(at('18:00')).toISOString());
 assert.equal(resolved.lateMinutes,19);assert.equal(resolved.clockOutScheduleEvidence.scheduleRevisionId,'captured-revision');assert.deepEqual(f,before);
 assert.equal(resolveAttendanceShift(f.start,f.schedule,f.profiles).wasScheduled,false);
});
test('scheduleNickname, nickname and a home branch different from the assigned work branch remain supported',()=>{
 for(const field of ['scheduleNickname','nickname']){const f=fixture({assigned:true});delete f.profile.scheduleName;f.profile[field]='Sample';f.profile.branch='Home Branch';
  assert.equal(resolveClockOutShift(f.start,f.schedule,f.profiles).wasScheduled,true);}
});
test('an unassigned 08:49 punch has a complete-only bound at 18:00 across both plausible morning rules',()=>{
 const f=fixture(),before=structuredClone(f),resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);
 assert.equal(resolved.clockOutCompleteOnly,true);assert.equal(resolved.wasScheduled,false);assert.equal(resolved.clockOutScheduleRecovered,false);
 assert.equal(resolved.clockOutLatestFinishAt.toISOString(),new Date(at('18:00')).toISOString());assert.deepEqual(resolved.clockOutScheduleEvidence.shiftIds,['m1','m2']);
 assert.equal(resolved.lateMinutes,19);assert.equal(resolved.scheduleSource,'clock-in');assert.deepEqual(f,before);
});
test('the complete-only assessment stays unknown before 18:00, becomes normal at 18:00, and never becomes early approval',()=>{
 const f=fixture(),shift=resolveClockOutShift(f.start,f.schedule,f.profiles),before=structuredClone({start:f.start,shift});
 for(const time of ['17:30','17:59']){const result=assessEarlyTimeOut(f.start,shift,new Date(at(time)));assert.equal(result.unknown,true);assert.equal(result.early,false);assert.equal(result.complete,false);assert.equal(result.scheduledEndAt,null);}
 for(const time of ['18:00','18:40']){const result=assessEarlyTimeOut(f.start,shift,new Date(at(time)));assert.equal(result.unknown,false);assert.equal(result.early,false);assert.equal(result.complete,true);assert.equal(result.scheduledEndAt,new Date(at('18:00')).toISOString());}
 assert.deepEqual({start:f.start,shift},before);assert.equal(shift.lateMinutes,19);
});
test('invalid or excessive finish bounds cannot authorize a completed or early clock-out',()=>{
 const f=fixture(),shift=resolveClockOutShift(f.start,f.schedule,f.profiles);
 for(const bound of [null,undefined,'invalid',at('08:00'),'2026-10-21T18:00:00+08:00']){const result=assessEarlyTimeOut(f.start,{...shift,clockOutLatestFinishAt:bound},new Date(at('18:40')));assert.equal(result.unknown,true);assert.equal(result.early,false);assert.equal(result.complete,false);}
});
test('the bound uses the captured immutable revision when a later head or later dated revision differs',()=>{
 const f=fixture();f.schedule.branchConfig.Maa[0].endTime='10:00';f.schedule.branchConfig.Maa[1].endTime='10:00';
 const laterPlan=structuredClone(f.revision.snapshot);laterPlan.branchConfig.Maa[0].endTime='19:00';laterPlan.branchConfig.Maa[1].endTime='19:30';
 const later=createScheduleRevision(laterPlan,{revisionId:'later-revision',effectiveFrom:date,savedAt:at('14:00'),cutover:date});later.sequence=2;
 f.schedule.historyMonths['2026-10'].revisions.push(later);
 const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.clockOutLatestFinishAt.toISOString(),new Date(at('18:00')).toISOString());assert.equal(resolved.clockOutScheduleEvidence.scheduleRevisionId,'captured-revision');
});
test('all plausible captured ends are included even when the nearest rule finishes earlier',()=>{
 const f=fixture();f.revision.snapshot.branchConfig.Maa.push({id:'m3',startTime:'10:00',endTime:'18:30',active:true});
 f.schedule.historyMonths['2026-10'].revisions=[f.revision];
 const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.clockOutLatestFinishAt.toISOString(),new Date(at('18:30')).toISOString());assert.deepEqual(resolved.clockOutScheduleEvidence.shiftIds,['m1','m2','m3']);
});
test('a later same-day roster assignment cannot turn an unassigned captured shift into an earlier authorized finish',()=>{
 const f=fixture(),plan=structuredClone(f.revision.snapshot);plan.currentSchedule[19].Maa.scheduled.m1='Sample';plan.currentSchedule[19].Maa.rest=[];
 const later=createScheduleRevision(plan,{revisionId:'later-assignment',effectiveFrom:date,savedAt:at('14:00'),cutover:date});later.sequence=2;f.schedule.historyMonths['2026-10'].revisions.push(later);
 const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.wasScheduled,false);assert.equal(resolved.clockOutCompleteOnly,true);assert.equal(resolved.clockOutLatestFinishAt.toISOString(),new Date(at('18:00')).toISOString());assert.equal(resolved.clockOutScheduleEvidence.scheduleRevisionId,'captured-revision');
});
test('without a captured reference, a newly saved dated roster after Time In cannot authorize exact recovery',()=>{
 const f=fixture({assigned:true});delete f.start.scheduleSnapshot.scheduleRevisionId;f.schedule.historyMonths['2026-10'].revisions[0].savedAt=new Date(at('14:00')).toISOString();
 const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.wasScheduled,false);assert.notEqual(resolved.clockOutCompleteOnly,true);
});
test('an overnight complete-only bound remains on the captured previous workdate',()=>{
 const f=fixture(),previous='2026-10-18';f.start.timestamp=new Date(`${date}T00:05:00+08:00`);
 f.start.scheduleSnapshot={...f.start.scheduleSnapshot,clockInAt:f.start.timestamp.toISOString(),shiftId:'night1',expectedStartAt:`${previous}T23:00:00+08:00`,expectedEndAt:`${date}T07:00:00+08:00`};
 f.revision.effectiveFrom=previous;f.revision.daySnapshots[previous]={configRevisionId:f.revision.revisionId,daySchedule:{Maa:{scheduled:{},rest:['Sample']}}};
 f.revision.snapshot.branchConfig.Maa=[{id:'night1',startTime:'23:00',endTime:'07:00',active:true},{id:'night2',startTime:'22:30',endTime:'07:30',active:true}];f.schedule.historyMonths['2026-10'].revisions=[f.revision];
 const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.clockOutCompleteOnly,true);assert.equal(resolved.clockOutScheduleEvidence.workDate,previous);assert.equal(resolved.clockOutLatestFinishAt.toISOString(),new Date(`${date}T07:30:00+08:00`).toISOString());
});
test('a typed reason or shift label never supplies the clock-out finish',()=>{
 const f=fixture();f.start.reason='Morning 9:30 AM to 6 PM';f.start.scheduleSnapshot.shiftName='9:30 AM–6:00 PM';
 for(const rule of f.revision.snapshot.branchConfig.Maa){delete rule.startTime;delete rule.endTime;rule.name='9:30 AM–6:00 PM';}f.schedule.historyMonths['2026-10'].revisions=[f.revision];
 const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.notEqual(resolved.wasScheduled,true);assert.notEqual(resolved.clockOutCompleteOnly,true);
});
test('missing archives and a mutable current-month global head cannot authorize recovery or completion',()=>{
 for(const assigned of [true,false]){const f=fixture({assigned});delete f.schedule.historyMonths;const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.notEqual(resolved.wasScheduled,true);assert.notEqual(resolved.clockOutCompleteOnly,true);}
});
test('a wrong staff ID, profile name, snapshot identity, or target branch keeps clock-out review blocked',()=>{
 for(const change of ['id','name','snapshotBranch','snapshotName','targetBranch']){const f=fixture({assigned:true});
  if(change==='id')f.profile.staffId='other-staff';if(change==='name')f.profile.cashierName='Different Crew';if(change==='snapshotBranch')f.start.scheduleSnapshot.branch='Different Branch';if(change==='snapshotName')f.start.scheduleSnapshot.staffName='Different Crew';if(change==='targetBranch')f.start.branch='Different Branch';
  const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.wasScheduled,false,change);assert.notEqual(resolved.clockOutCompleteOnly,true,change);}
});
test('recovery requires the exact verified directory ID and cannot match a name-only punch',()=>{
 for(const missing of ['profile','punch']){const f=fixture({assigned:true});if(missing==='profile'){delete f.profile.id;delete f.profile.staffId;}else delete f.start.staffId;const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.wasScheduled,false);assert.notEqual(resolved.clockOutCompleteOnly,true);}
});
test('two dated assignments or a conflicting linked directory identity cannot invent one staff slot',()=>{
 for(const conflict of ['slots','directory']){const f=fixture({assigned:true}),day=f.schedule.historyMonths['2026-10'].revisions[0].daySnapshots[date].daySchedule.Maa;
  if(conflict==='slots')day.scheduled.m1='Sample';else f.schedule.historyMonths['2026-10'].revisions[0].snapshot.employees=[{staffId:'different-id',name:'Sample'}];
  const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.equal(resolved.wasScheduled,false);assert.notEqual(resolved.clockOutCompleteOnly,true);}
});
test('conflicting preserved valid times require an explicit correction instead of silent replacement',()=>{
 const f=fixture({assigned:true});f.start.scheduleSnapshot.expectedEndAt=new Date(at('19:00')).toISOString();const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);
 assert.equal(resolved.wasScheduled,false);assert.equal(resolved.clockOutScheduleReviewReason,'preserved-schedule-conflict');assert.notEqual(resolved.clockOutCompleteOnly,true);
});
test('a plausible missing end, duplicate rule ID, or invalid duration prevents a complete-only bound',()=>{
 for(const invalid of ['end','id','duration','start']){const f=fixture(),rules=f.revision.snapshot.branchConfig.Maa;
  if(invalid==='end')delete rules[1].endTime;if(invalid==='id')rules[1].id='m1';if(invalid==='duration')rules[1].endTime='09:30';if(invalid==='start')delete rules[2].startTime;
  f.schedule.historyMonths['2026-10'].revisions=[f.revision];const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.notEqual(resolved.clockOutCompleteOnly,true,invalid);assert.equal(resolved.wasScheduled,false,invalid);}
});
test('missing or mismatched immutable revision workday evidence cannot produce a finish bound',()=>{
 for(const invalid of ['revision','day','month','anchor','duplicate']){const f=fixture();
  if(invalid==='revision')f.start.scheduleSnapshot.scheduleRevisionId='not-saved';if(invalid==='day')delete f.revision.daySnapshots[date];if(invalid==='month')f.revision.month='2026-11';if(invalid==='anchor')f.start.scheduleSnapshot.expectedEndAt=new Date(at('17:45')).toISOString();
  f.schedule.historyMonths['2026-10'].revisions=invalid==='duplicate'?[f.revision,structuredClone(f.revision)]:[f.revision];const resolved=resolveClockOutShift(f.start,f.schedule,f.profiles);assert.notEqual(resolved.clockOutCompleteOnly,true,invalid);}
});
test('the Staff, POS and Owner resolver copies stay byte-identical',()=>{
 const paths=['takodeal-manager','takodeal-staff','Takodeal-POS'].map(app=>new URL(`../${app}/clock-out-schedule.js`,import.meta.url));
 const files=paths.map(path=>readFileSync(path,'utf8'));assert.equal(files[0],files[1]);assert.equal(files[0],files[2]);
});
