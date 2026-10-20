import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attendanceAmendmentReviewFingerprint,amendmentReviewResult,applyAttendanceAmendmentReview,amendmentReviewChoices} from '../takodeal-manager/attendance-amendment-review-model.js';
import {confirmAttendanceAmendmentReview} from '../takodeal-manager/attendance-amendment-review.js';
import {attendanceLateMinutes,latePay} from '../takodeal-manager/payroll-safety.js';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';

test('all four apps ship byte-identical dated attendance review evidence and choices',()=>{const expected=readFileSync(new URL('../takodeal-manager/attendance-amendment-review-model.js',import.meta.url));for(const app of ['Takodeal-POS','takodeal-staff','takodeal-franchise'])assert.deepEqual(readFileSync(new URL('../'+app+'/attendance-amendment-review-model.js',import.meta.url)),expected);});

test('review fingerprints bind the exact original decision, punch and correction chain while canonicalizing timestamp encodings',async()=>{
 const f=await amendmentFixture(),log=f.withId(),shift=f.shift(),fingerprint=attendanceAmendmentReviewFingerprint(log,shift),before=structuredClone({log,shift});assert.equal(shift.amendmentNeedsReview,true);assert.equal(shift.correctedLateMinutes,0);
 assert.equal(attendanceAmendmentReviewFingerprint({...log,timestamp:{seconds:+log.timestamp/1000,nanoseconds:0},lateReviewedAt:{seconds:+log.lateReviewedAt/1000}},shift),fingerprint);
 for(const change of [{staffId:'different'},{staffName:'Changed name'},{branch:'Other Branch'},{timestamp:new Date(+log.timestamp+60000)},{reviewedLateMinutes:0},{lateExempted:true},{lateDecision:'Approved'},{lateReviewRequestId:'new-review'},{lateReviewedBy:'other-reviewer'},{scheduleSnapshot:{...log.scheduleSnapshot,shiftId:'different'}}])assert.notEqual(attendanceAmendmentReviewFingerprint({...log,...change},shift),fingerprint);
 for(const change of [{scheduleAmendmentIds:['sample-correction','new-correction']},{expectedStartAt:new Date(+shift.expectedStartAt+60000)},{expectedEndAt:new Date(+shift.expectedEndAt+60000)},{correctedLateMinutes:1},{targetShiftId:'different'},{workDate:'2026-10-17'}])assert.notEqual(attendanceAmendmentReviewFingerprint(log,{...shift,...change}),fingerprint);assert.deepEqual({log,shift},before);
});

test('invalid choices, incomplete correction evidence and unsafe minutes cannot form a reviewed outcome',async()=>{
 const f=await amendmentFixture(),log=f.withId(),shift=f.shift();assert.deepEqual(amendmentReviewResult(log,shift,amendmentReviewChoices[0]),{lateMinutes:35,exempt:false});assert.deepEqual(amendmentReviewResult(log,shift,amendmentReviewChoices[1]),{lateMinutes:0,exempt:false});assert.deepEqual(amendmentReviewResult(log,shift,amendmentReviewChoices[2]),{lateMinutes:0,exempt:true});
 for(const [badLog,badShift,choice] of [[log,shift,'Auto approve'],[log,{...shift,attendanceCorrectionVerified:false},amendmentReviewChoices[1]],[log,{...shift,scheduleAmendmentIds:[]},amendmentReviewChoices[1]],[log,{...shift,correctedLateMinutes:0.5},amendmentReviewChoices[1]],[{...log,reviewedLateMinutes:-1},shift,amendmentReviewChoices[0]]])assert.throws(()=>amendmentReviewResult(badLog,badShift,choice));
});

test('a valid review clears its exact hold while malformed, forged or stale markers retain the original review-required object',async()=>{
 const f=await amendmentFixture(),log=f.withId(),shift=f.shift(),marker={version:1,revision:1,auditId:'amendment-'+f.attendanceId+'-1',sourceFingerprint:attendanceAmendmentReviewFingerprint(log,shift),choice:'Use corrected schedule minutes',lateMinutes:0,exempt:false,actorUid:'sample-owner',actorEmail:f.email,reviewedAt:f.now,reason:'Confirmed exact workday correction.'};
 const applied=applyAttendanceAmendmentReview({...log,scheduleAmendmentReview:marker},shift);assert.equal(applied.amendmentNeedsReview,false);assert.equal(applied.needsScheduleReview,false);assert.equal(applied.amendmentReviewVerified,true);assert.equal(applied.lateMinutes,0);assert.equal(shift.amendmentNeedsReview,true);
 for(const change of [{version:2},{revision:0},{auditId:'amendment-other-in-1'},{auditId:'../forged'},{actorUid:{}},{actorUid:' '},{actorEmail:'other@example.test'},{reviewedAt:null},{reviewedAt:0},{reviewedAt:'123'},{reviewedAt:{seconds:NaN}},{reason:'short'},{reason:'x'.repeat(1501)},{sourceFingerprint:'old-schedule'},{lateMinutes:35},{exempt:true},{choice:'Auto approve'}])assert.equal(applyAttendanceAmendmentReview({...log,scheduleAmendmentReview:{...marker,...change}},shift),shift);
 assert.equal(applyAttendanceAmendmentReview({...log,lateDecision:'Approved',scheduleAmendmentReview:marker},shift),shift);assert.equal(applyAttendanceAmendmentReview(log,shift),shift);
});

test('keeping an exemption, explicitly replacing it with corrected minutes, and waiving it yield the selected deduction without rewriting old decisions',async()=>{
 for(const choice of amendmentReviewChoices){const f=await amendmentFixture({extraLog:{reviewedLateMinutes:35,lateExempted:true}}),at=new Date('2026-10-16T14:10:00+08:00'),row=f.get('attendance_logs/'+f.attendanceId);row.timestamp=at;row.scheduleSnapshot={...row.scheduleSnapshot,clockInAt:at.toISOString()};f.put('attendance_logs/'+f.attendanceId,row);assert.equal(f.shift().correctedLateMinutes,10);await confirmAttendanceAmendmentReview(f.api,f.input({choice}));const saved=f.get('attendance_logs/'+f.attendanceId),resolved=f.shift();assert.equal(saved.lateExempted,true);assert.equal(saved.reviewedLateMinutes,35);assert.equal(resolved.amendmentReviewVerified,true);assert.equal(latePay(attendanceLateMinutes(saved,resolved),f.profile,resolved,saved.lateExempted).amount,choice==='Use corrected schedule minutes'?62.5:0);}
});

test('concurrent real confirmations permit one revision, and a fresh subsequent revision retains the first immutable audit',async()=>{
 const f=await amendmentFixture(),input=f.input(),before=structuredClone(f.get('attendance_logs/sample-out')),paid=structuredClone(f.get('payroll_records/sample-paid')),results=await Promise.allSettled([confirmAttendanceAmendmentReview(f.api,input),confirmAttendanceAmendmentReview(f.api,input)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal([...f.docs.keys()].filter(k=>k.startsWith('attendance_amendment_reviews/')).length,1);assert.equal(f.get('attendance_logs/'+f.attendanceId).scheduleAmendmentReview.revision,1);const first=structuredClone(f.get('attendance_amendment_reviews/amendment-'+f.attendanceId+'-1'));
 await confirmAttendanceAmendmentReview(f.api,f.input({choice:'Waive lateness'}));assert.equal(f.get('attendance_logs/'+f.attendanceId).scheduleAmendmentReview.revision,2);assert.deepEqual(f.get('attendance_amendment_reviews/amendment-'+f.attendanceId+'-1'),first);assert.equal(f.get('attendance_amendment_reviews/amendment-'+f.attendanceId+'-2').previousReview.revision,1);assert.deepEqual(f.get('attendance_logs/sample-out'),before);assert.deepEqual(f.get('payroll_records/sample-paid'),paid);
});

test('deleted, voided and cancelled original Time Ins cannot receive a new reviewed marker',async()=>{
 for(const change of [{deleted:true},{status:'Voided'},{status:'Cancelled'},{status:'Canceled'},{status:'Deleted'}]){const f=await amendmentFixture(),input=f.input();f.put('attendance_logs/'+f.attendanceId,{...f.get('attendance_logs/'+f.attendanceId),...change});const before=structuredClone([...f.docs]);await assert.rejects(confirmAttendanceAmendmentReview(f.api,input));assert.deepEqual([...f.docs],before);}
});
