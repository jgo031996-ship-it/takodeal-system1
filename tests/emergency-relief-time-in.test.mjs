import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emergencyReliefForClockIn,emergencyReliefTimeOutNotice,plannedAttendancePreview,renderAttendanceSchedulePreview} from '../takodeal-staff/attendance-schedule-preview.js';

const snapshot=()=>({version:1,source:'clock-in',staffName:'Fictional Cover Crew',branch:'Fictional Cover Branch',wasScheduled:false,needsScheduleReview:true,scheduleReviewReason:'missing-dated-assignment',expectedStartAt:'2026-10-30T06:00:00.000Z',expectedEndAt:'2026-10-30T13:00:00.000Z',shiftId:'part',shiftName:'Part time',lateMinutes:0});
const profile=()=>({id:'fictional-cover-crew',staffId:'fictional-cover-crew',cashierName:'Fictional Cover Crew',branch:'Fictional Home Branch',active:true});
const expected=()=>({version:1,homeBranch:'Fictional Home Branch',branch:'Fictional Cover Branch',requiresReview:true});

test('cross-branch unverified Time In gets descriptive relief metadata without changing identity, profile or schedule evidence',()=>{
 const saved=snapshot(),person=profile(),before=structuredClone({saved,person});
 assert.deepEqual(emergencyReliefForClockIn(saved,person),expected());
 assert.deepEqual({saved,person},before);assert.equal(saved.needsScheduleReview,true);assert.equal(saved.wasScheduled,false);
});

test('a verified Owner-plotted relief shift stays a normal verified assignment',()=>{
 const saved={...snapshot(),wasScheduled:true,needsScheduleReview:false};
 assert.equal(emergencyReliefForClockIn(saved,profile()),null);
 const planned=plannedAttendancePreview(saved,{emergencyRelief:expected()});
 assert.equal(planned.verified,true);assert.equal(planned.emergencyRelief,false);
 assert.match(renderAttendanceSchedulePreview(saved,{emergencyRelief:expected()}),/Saved assigned shift/);
});

test('same-branch and unknown-home-branch review cases are not classified as emergency branch cover',()=>{
 for(const branch of ['Fictional Cover Branch',' Fictional Cover Branch ','',undefined])assert.equal(emergencyReliefForClockIn(snapshot(),{...profile(),branch}),null);
});

test('emergency preview explains actual punches and later HR review without claiming an assigned finish',()=>{
 const saved=snapshot(),relief=emergencyReliefForClockIn(saved,profile()),planned=plannedAttendancePreview(saved,{emergencyRelief:relief}),html=renderAttendanceSchedulePreview(saved,{emergencyRelief:relief});
 assert.equal(planned.verified,false);assert.equal(planned.emergencyRelief,true);assert.equal(planned.homeBranch,profile().branch);
 assert.match(html,/Emergency branch cover/);assert.match(html,/Reference hours for HR review/);
 assert.match(html,/Actual Time In and Time Out can be recorded/);assert.match(html,/HR will confirm the assigned hours afterward/);
 assert.match(html,/no lateness or early-out decision is inferred/);assert.doesNotMatch(html,/Unverified reference hours|HQ could not confirm|Saved assigned shift/);
});

test('preview never treats an unrelated or malformed supplied marker as a confirmed relief assignment',()=>{
 for(const marker of [{...expected(),branch:'Other Fictional Branch'},{...expected(),requiresReview:false},{...expected(),version:2},{...expected(),homeBranch:snapshot().branch}]){
  const planned=plannedAttendancePreview(snapshot(),{emergencyRelief:marker});assert.equal(planned.emergencyRelief,false);assert.equal(planned.verified,false);
 }
 const html=renderAttendanceSchedulePreview(snapshot(),{emergencyRelief:{...expected(),homeBranch:'<img onerror=bad>'}});
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});

const staffSource=fs.readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
const posSource=fs.readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
function fragment(source){
 const first=source.indexOf('            const emergencyRelief=emergencyReliefForClockIn(attendance.scheduleSnapshot');
 assert.ok(first>0);const last=source.indexOf('\n',source.indexOf('if(emergencyRelief)',first));assert.ok(last>first);
 return source.slice(first,last);
}

test('actual Staff final-Time-In fragment stores the cover marker and clears inferred late decisions only for unverified branch cover',()=>{
 const apply=new Function('emergencyReliefForClockIn','attendance','person',`let pendingLateRequest={id:'fictional-old-inference'};const staffName=attendance.scheduleSnapshot.staffName,closestBranch=attendance.scheduleSnapshot.branch,punchScheduleProfiles={[staffName]:person};${fragment(staffSource)};return {attendance,pendingLateRequest};`);
 const saved=snapshot(),person=profile(),before=structuredClone({saved,person});
 const value=apply(emergencyReliefForClockIn,{scheduleSnapshot:saved,lateMinutes:37},person);
 assert.deepEqual(value.attendance.emergencyRelief,expected());assert.equal(value.attendance.lateMinutes,0);assert.equal(value.pendingLateRequest,null);
 assert.deepEqual({saved,person},before);
 const verified={...snapshot(),wasScheduled:true,needsScheduleReview:false};
 const normal=apply(emergencyReliefForClockIn,{scheduleSnapshot:verified,lateMinutes:5},profile());
 assert.equal(normal.attendance.emergencyRelief,undefined);assert.equal(normal.attendance.lateMinutes,5);assert.equal(normal.pendingLateRequest.id,'fictional-old-inference');
});

test('actual Cashier final-Time-In fragment records the same marker without changing branch or snapshot',()=>{
 const apply=new Function('emergencyReliefForClockIn','attendance','staffProfile',`const finalBranch=attendance.branch;${fragment(posSource)};return attendance;`);
 const saved=snapshot(),before=structuredClone(saved),value=apply(emergencyReliefForClockIn,{branch:saved.branch,scheduleSnapshot:saved,lateMinutes:91},profile());
 assert.deepEqual(value.emergencyRelief,expected());assert.equal(value.lateMinutes,0);assert.equal(value.branch,saved.branch);assert.deepEqual(value.scheduleSnapshot,before);
 const verified={...snapshot(),wasScheduled:true,needsScheduleReview:false},normal=apply(emergencyReliefForClockIn,{branch:verified.branch,scheduleSnapshot:verified,lateMinutes:5},profile());
 assert.equal(normal.emergencyRelief,undefined);assert.equal(normal.lateMinutes,5);
});

test('actual Staff and Cashier Time Out callers pass only an explicit review choice and retain the confirmed close result',async()=>{
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const [source,app]of [[staffSource,'Staff'],[posSource,'Cashier']]){
  const first=source.indexOf('timeOutResult=await earlyClockOut.service.close('),last=source.indexOf(';',first);
  assert.ok(first>0&&last>first,app);
  const run=new AsyncFunction('earlyClockOut',`let timeOutResult=null;const activeTimeIn={id:'fictional-time-in'},staffName='Fictional Cover Crew',punchStaffId='fictional-cover-crew',staffProfile={id:punchStaffId},inputPin='synthetic-only',attendance={id:'fictional-time-out'},pendingAttendanceRecords=[],assertClockCurrent=()=>{};${source.slice(first,last+1)}return timeOutResult;`);
  for(const choice of [true,false,undefined,'true']){
   let received;const confirmed={provisionalRelief:choice===true};
   const result=await run({reliefForReview:choice,service:{close:async input=>{received=input;return confirmed;}}});
   assert.equal(received.reliefForReview,choice===true,app);assert.equal(received.start.id,'fictional-time-in');assert.equal(received.attendance.id,'fictional-time-out');assert.equal(result,confirmed);
  }
  await assert.rejects(run({reliefForReview:true,service:{close:async()=>{throw Error('Fictional HQ save failed');}}}),/Fictional HQ save failed/);
 }
});

test('the HR-pending success notice appears only after the close operation confirms a provisional pair',()=>{
 assert.match(emergencyReliefTimeOutNotice({provisionalRelief:true},'Fictional Cover Branch'),/Actual Time Out recorded at Fictional Cover Branch/);
 assert.match(emergencyReliefTimeOutNotice({provisionalRelief:true},'Fictional Cover Branch'),/HR will confirm/);
 for(const value of [undefined,{},true,{reliefForReview:true},{provisionalRelief:false},{provisionalRelief:'true'}])assert.equal(emergencyReliefTimeOutNotice(value,'Fictional Cover Branch'),'');
});
