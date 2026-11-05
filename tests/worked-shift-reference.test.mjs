import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleRevision} from '../takodeal-manager/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift,latePay,calculateShiftEarnings} from '../takodeal-manager/payroll-safety.js';
import {planWorkedShiftCorrection,createWorkedShiftRevision,workedShiftSourceFingerprint} from '../takodeal-manager/worked-shift-correction-model.js';
import {workedShiftLatenessReference} from '../takodeal-manager/worked-shift-reference.js';
const branch='Fictional Branch',name='Fictional Crew',staffId='fictional-staff',owner='jgo031996@gmail.com',at=value=>new Date(value+'+08:00');
const rule=(id,type)=>({id,name:id,shiftType:type,startTime:type==='night'?'17:30':'09:00',endTime:type==='night'?'02:00':'17:30'});
function fixture({two=false}={}){
 const profile={id:staffId,staffId,cashierName:name,branch,hourlyRate:450,nightDiffRate:50,active:true};
 const snapshot={currentYear:2026,currentMonth:10,branchConfig:{[branch]:[rule('morning','morning'),rule('night','night'),...(two?[rule('morning-two','morning'),rule('night-two','night')]:[])]},employees:[{id:staffId,name,branch}],currentSchedule:{17:{[branch]:{scheduled:{morning:name,night:'UNFILLED',...(two?{'morning-two':'Second Fictional Crew','night-two':'UNFILLED'}:{})},rest:[],unavailable:[]}}}};
 const revision=createScheduleRevision(snapshot,{revisionId:'fictional-original',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:at('2026-10-01T00:00:00')}),history={...snapshot,historyMonths:{'2026-10':{revisions:[revision]}}};
 const start={id:'fictional-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:at('2026-10-17T17:11:00'),lateMinutes:37,lateExempted:false};start.scheduleSnapshot=captureAttendanceSchedule(start.timestamp,branch,name,history,{[name]:profile});
 const out={id:'fictional-out',staffId,staffName:name,branch,type:'TIME OUT',timestamp:at('2026-10-18T02:06:00'),timeInLogId:start.id,timeInAt:start.timestamp},before=resolveAttendanceShift(start,history,{[name]:profile});
 const apply=(log,end,person,source,target,operation)=>{const plan=planWorkedShiftCorrection({start:log,out:end,profile:person,history:source,attendance:[log,end],matchedShift:resolveAttendanceShift(log,source,{[log.staffName]:person}),now:at('2026-11-05T12:00:00')});plan.sourceFingerprint=workedShiftSourceFingerprint(log);return createWorkedShiftRevision(plan,plan.choices.find(row=>row.shiftId===target).key,{operationId:operation,actor:{uid:'fictional-owner',email:owner},at:at('2026-11-05T12:00:00'),index:{revisionIds:source.historyMonths['2026-10'].revisions.map(row=>row.revisionId)}});};
 const correction=apply(start,out,profile,history,'night','fictional-operation'),corrected={...history,historyMonths:{'2026-10':{revisions:[revision,correction]}}};
 return {profile,snapshot,revision,history,start,out,before,correction,corrected,apply};
}
const resolve=f=>resolveAttendanceShift(f.start,f.corrected,{[name]:f.profile});
test('a genuine correction changes its assigned reference while preserving the original monetary lateness rate and wage date',()=>{
 const f=fixture(),after=resolve(f);assert.equal(after.workedShiftCorrectionId,f.correction.revisionId);assert.equal(after.shiftType,'night');assert.equal(after.lateMinutes,37);assert.deepEqual(latePay(after.lateMinutes,f.profile,after),latePay(f.before.lateMinutes,f.profile,f.before));assert.equal(latePay(after.lateMinutes,f.profile,after).amount,56.25);assert.equal(workedShiftLatenessReference(after).isNightShift,false);assert.equal(workedShiftLatenessReference({...after}).isNightShift,true);
});
for(const field of ['bounds','type','rule-type','rule-config','audit'])test('inconsistent '+field+' is held rather than falling back to an old payable assignment',()=>{
 const f=fixture(),marker=f.correction.snapshot.workedShiftCorrections[f.start.id];
 if(field==='bounds')marker.expectedStartAt=at('2026-10-17T18:00:00').toISOString();if(field==='type')marker.shiftType='morning';if(field==='rule-type')f.correction.snapshot.branchConfig[branch][1].shiftType='invented';if(field==='rule-config')f.correction.snapshot.branchConfig[branch]={broken:true};if(field!=='audit')f.correction.historicalWorkedShiftReview=structuredClone(marker);else f.correction.historicalWorkedShiftReview.reason='Changed standalone audit';
 const after=resolve(f);assert.equal(after.needsScheduleReview,true);assert.equal(after.assignmentReconciliationRequired,true);const result=calculateShiftEarnings(f.profile,after,f.start.timestamp,f.out.timestamp);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
test('a second employee correction on the same date retains the first independent immutable correction and lateness basis',()=>{
 const f=fixture({two:true}),secondName='Second Fictional Crew',profile={...f.profile,id:'second-fictional',staffId:'second-fictional',cashierName:secondName},start={...f.start,id:'second-in',staffId:profile.staffId,staffName:secondName,timestamp:at('2026-10-17T17:12:00')};start.scheduleSnapshot=captureAttendanceSchedule(start.timestamp,branch,secondName,f.history,{[secondName]:profile});const out={...f.out,id:'second-out',staffId:profile.staffId,staffName:secondName,timeInLogId:start.id,timeInAt:start.timestamp,timestamp:at('2026-10-18T02:07:00')};
 const next=f.apply(start,out,profile,f.corrected,'night-two','second-operation');f.corrected.historyMonths['2026-10'].revisions.push(next);const first=resolve(f),second=resolveAttendanceShift(start,f.corrected,{[secondName]:profile});assert.equal(first.workedShiftCorrectionId,f.correction.revisionId);assert.equal(second.workedShiftCorrectionId,next.revisionId);assert.equal(first.shiftId,'night');assert.equal(second.shiftId,'night-two');assert.equal(latePay(first.lateMinutes,f.profile,first).amount,56.25);assert.deepEqual(f.history.historyMonths['2026-10'].revisions[0],f.revision);
 // A forged copy of a valid old marker without its ancestry cannot inherit it.
 next.historicalWorkedShiftReview.sourceRevisionId=f.revision.revisionId;const held=resolve(f);assert.equal(held.needsScheduleReview,true);assert.equal(held.assignmentReconciliationRequired,true);
});
test('a later actual Time Out requires a fresh worked-shift review instead of using the old correction silently',()=>{
 const f=fixture(),after=resolve(f);assert.throws(()=>calculateShiftEarnings(f.profile,after,f.start.timestamp,at('2026-10-18T02:07:00')),/earlier Time Out/);
});
test('a later saved lateness decision takes precedence while the corrected assigned window remains intact',()=>{
 const f=fixture();f.start.reviewedLateMinutes=0;f.start.lateExempted=true;f.start.lateDecision='Later reviewed zero';const after=resolve(f);assert.equal(after.shiftId,'night');assert.equal(after.lateMinutes,0);assert.equal(latePay(after.lateMinutes,f.profile,after,f.start.lateExempted).amount,0);
});
