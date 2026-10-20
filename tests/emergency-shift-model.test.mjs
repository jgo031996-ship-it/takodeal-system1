import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emergencyShiftBounds,emergencyShiftSourceFingerprint,resolveEmergencyShift,EMERGENCY_SHIFT_COLLECTION,EMERGENCY_SHIFT_EVENTS} from '../takodeal-manager/emergency-shift-model.js';
import {assessEarlyTimeOut} from '../takodeal-manager/early-time-out-model.js';
const start={id:'fictional-time-in',staffId:'fictional-staff',staffName:'Fictional Crew',branch:'Sample Branch',type:'TIME IN',timestamp:new Date('2026-10-20T19:20:00+08:00'),scheduleSnapshot:{version:1,source:'clock-in',wasScheduled:false,needsScheduleReview:true,shiftName:'A typed label cannot supply these times'}};
const person={id:start.staffId,cashierName:start.staffName,active:true,branch:'Home Branch'};
const input={workDate:'2026-10-20',startTime:'19:30',endTime:'04:00',shiftName:'Emergency night cover',reason:'Emergency cover after a colleague became unavailable.'};
function head(extra={}){const bounds=emergencyShiftBounds(input,start);return {schemaVersion:1,status:'Confirmed',revisionId:'fictional-operation',version:1,staffId:start.staffId,staffName:start.staffName,branch:start.branch,timeInLogId:start.id,timeInAt:start.timestamp,expectedStartAt:bounds.expectedStartAt,expectedEndAt:bounds.expectedEndAt,workDate:bounds.workDate,shiftName:bounds.shiftName,sourceFingerprint:emergencyShiftSourceFingerprint(start),reviewedByUid:'reviewer-id',reviewedByEmail:'manager@example.test',reviewedAt:new Date('2026-10-20T20:00:00+08:00'),...extra};}
test('explicit Philippine workdate and times produce the next-day overnight finish without modifying the punch',()=>{
 const original=structuredClone(start),checked=emergencyShiftBounds(input,start);assert.equal(checked.expectedStartAt.toISOString(),'2026-10-20T11:30:00.000Z');assert.equal(checked.expectedEndAt.toISOString(),'2026-10-20T20:00:00.000Z');assert.equal(checked.workDate,'2026-10-20');assert.deepEqual(start,original);
});
test('same-day planned end and an optional default shift name are explicit and do not infer from a reason or label',()=>{
 const day={...start,timestamp:new Date('2026-10-20T09:00:00+08:00')},checked=emergencyShiftBounds({...input,startTime:'09:00',endTime:'17:30',shiftName:''},day);assert.equal(checked.expectedEndAt.toISOString(),'2026-10-20T09:30:00.000Z');assert.equal(checked.shiftName,'Emergency covering shift');
 assert.throws(()=>emergencyShiftBounds({workDate:input.workDate,shiftName:'19:30–04:00',reason:input.reason},start),/time fields/);
});
test('invalid calendar dates, time fields, reasons, names and shift ranges are rejected',()=>{
 for(const patch of [{workDate:'2026-02-30'},{workDate:'10/20/2026'},{workDate:'1999-10-20'},{startTime:'7:30 PM'},{startTime:'24:00'},{endTime:'04:60'},{reason:'short'},{reason:'x'.repeat(1501)},{shiftName:'x'.repeat(161)},{startTime:'19:30',endTime:'19:30'},{startTime:'19:30',endTime:'20:00'},{startTime:'19:30',endTime:'14:00'},{workDate:'2026-10-21'},{startTime:'21:00',endTime:'04:00'}])assert.throws(()=>emergencyShiftBounds({...input,...patch},start),undefined,JSON.stringify(patch));
});
test('the existing early/late clock-in plausibility limits are preserved exactly',()=>{
 const planned='2026-10-20T19:30:00+08:00',at=minutes=>({...start,timestamp:new Date(+new Date(planned)+minutes*60000)});
 assert.doesNotThrow(()=>emergencyShiftBounds(input,at(-90)));assert.throws(()=>emergencyShiftBounds(input,at(-91)));
 const long={...input,startTime:'01:00',endTime:'19:00'};assert.doesNotThrow(()=>emergencyShiftBounds(long,{...start,timestamp:new Date('2026-10-20T18:59:00+08:00')}));assert.throws(()=>emergencyShiftBounds(long,{...start,timestamp:new Date('2026-10-20T19:00:00+08:00')}));
});
test('source fingerprints bind original attendance identity and complete saved snapshot across SDK timestamp shapes',()=>{
 const millis=+start.timestamp,seconds=Math.floor(millis/1000),fingerprint=emergencyShiftSourceFingerprint(start);
 assert.equal(emergencyShiftSourceFingerprint({...start,timestamp:{seconds,nanoseconds:0}}),fingerprint);assert.equal(emergencyShiftSourceFingerprint({...start,timestamp:{toDate:()=>new Date(millis)}}),fingerprint);
 for(const patch of [{id:'other'},{staffId:'other'},{staffName:'Other'},{branch:'Other Branch'},{timestamp:new Date(millis+60000)},{scheduleSnapshot:{...start.scheduleSnapshot,shiftId:'changed'}}])assert.notEqual(emergencyShiftSourceFingerprint({...start,...patch}),fingerprint);
});
test('a missing confirmation gives no emergency authority and present invalid data fails closed',()=>{
 assert.equal(resolveEmergencyShift(start,person,null),null);assert.equal(resolveEmergencyShift(start,person,undefined),null);
 for(const patch of [{schemaVersion:2},{status:'Pending'},{revisionId:'bad/id'},{version:0},{version:1.5},{staffId:'another'},{staffName:'Another'},{branch:'Another'},{timeInLogId:'another'},{timeInAt:new Date(+start.timestamp+1)},{timeInAt:start.timestamp.toISOString()},{sourceFingerprint:'forged'},{expectedStartAt:'19:30'},{expectedEndAt:new Date('2026-10-21T15:00:00+08:00')},{workDate:'2026-10-19'},{shiftName:''},{reviewedByUid:''},{reviewedByEmail:'bad'},{reviewedByEmail:'Manager@EXAMPLE.test'},{reviewedAt:null},{reason:'This belongs in the private audit'}])assert.throws(()=>resolveEmergencyShift(start,person,head(patch)),undefined,JSON.stringify(patch));
});
test('a confirmed assignment is clock-out-only and never creates payroll, lateness forgiveness or actual departure time',()=>{
 const before=structuredClone({start,person}),saved=head(),resolved=resolveEmergencyShift(start,person,saved);assert.equal(resolved.wasScheduled,true);assert.equal(resolved.needsScheduleReview,false);assert.equal(resolved.emergencyShiftConfirmed,true);assert.equal(resolved.clockOutOnly,true);assert.equal(resolved.clockOutScheduleRecovered,true);assert.equal(resolved.clockOutScheduleEvidence.source,'hq-emergency-shift');assert.equal(resolved.clockOutScheduleEvidence.version,1);assert.equal(resolved.clockOutScheduleEvidence.revisionId,saved.revisionId);assert.equal(resolved.scheduleRevisionId,saved.revisionId);assert.equal(resolved.lateMinutes,undefined);assert.equal(resolved.attendanceCorrectionVerified,undefined);assert.equal(resolved.timestamp,undefined);assert.deepEqual({start,person},before);
 const early=assessEarlyTimeOut(start,resolved,new Date('2026-10-21T03:59:00+08:00')),complete=assessEarlyTimeOut(start,resolved,new Date('2026-10-21T04:00:00+08:00'));assert.equal(early.early,true);assert.equal(early.complete,false);assert.equal(complete.complete,true);assert.equal(complete.early,false);
});
test('a later confirmation revision changes the approval fingerprint and cannot silently reuse old approval evidence',()=>{
 const first=resolveEmergencyShift(start,person,head()),next=resolveEmergencyShift(start,person,head({revisionId:'fictional-operation-two',version:2,expectedEndAt:new Date('2026-10-21T05:00:00+08:00')}));
 assert.notEqual(assessEarlyTimeOut(start,first,new Date('2026-10-21T03:00:00+08:00')).scheduleFingerprint,assessEarlyTimeOut(start,next,new Date('2026-10-21T03:00:00+08:00')).scheduleFingerprint);
});
test('foreign or inactive staff, deleted punches and changed source snapshots cannot use a saved confirmation',()=>{
 for(const patch of [{cashierName:'Other'},{id:'other'},{active:false},{archived:true},{blocked:true},{status:'Resigned'}])assert.throws(()=>resolveEmergencyShift(start,{...person,...patch},head()));
 for(const patch of [{deleted:true},{status:'Cancelled'},{type:'TIME OUT'},{branch:'Other'},{timestamp:new Date(+start.timestamp+1)},{scheduleSnapshot:{...start.scheduleSnapshot,expectedEndAt:'changed'}}])assert.throws(()=>resolveEmergencyShift({...start,...patch},person,head()));
});
test('the collection contract and Owner, Staff and POS pure models remain identical',()=>{
 assert.equal(EMERGENCY_SHIFT_COLLECTION,'attendance_shift_confirmations');assert.equal(EMERGENCY_SHIFT_EVENTS,'attendance_shift_confirmation_events');const expected=readFileSync(new URL('../takodeal-manager/emergency-shift-model.js',import.meta.url));for(const app of ['takodeal-staff','Takodeal-POS'])assert.deepEqual(readFileSync(new URL('../'+app+'/emergency-shift-model.js',import.meta.url)),expected);
});
