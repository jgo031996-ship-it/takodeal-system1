import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureAttendanceSchedule,resolveAttendanceShift,calculateShiftEarnings,earnedNightBonus,latePay} from '../takodeal-manager/payroll-safety.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
import {emergencyShiftSourceFingerprint} from '../takodeal-manager/emergency-shift-model.js';
import {reliefScheduleSourceFingerprint} from '../takodeal-manager/relief-schedule-review-model.js';
import {attendanceAmendmentReviewFingerprint} from '../takodeal-manager/attendance-amendment-review-model.js';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';
const branch='Fictional Branch',name='Fictional Crew',staffId='fictional-crew',profile={staffId,id:staffId,cashierName:name,scheduleNickname:'CREW',branch,hourlyRate:450,nightDiffRate:50};
const at=(clock,day=4)=>new Date('2026-11-'+String(day).padStart(2,'0')+'T'+clock+':00+08:00');
const rule=(id,startTime,endTime,shiftType)=>({id,name:id,startTime,endTime,shiftType,active:true,days:[0,1,2,3,4,5,6]});
function history(rules=[rule('morning','09:00','17:00','morning'),rule('mid','16:00','00:30','mid'),rule('night','19:30','04:00','night')],assigned='morning'){
 const current={currentYear:2026,currentMonth:11,branchConfig:{[branch]:rules},currentSchedule:{4:{[branch]:{scheduled:{[assigned]:'CREW'},rest:[],unavailable:[],swaps:{}}}},employees:[],holidays:{},unavailability:{}};
 const revision=createScheduleRevision(current,{revisionId:'fictional-dated-rules',effectiveFrom:'2026-11-04',effectiveTo:'2026-11-30',savedAt:at('00:00')});
 return assembleScheduleHistory(current,[{month:'2026-11',revisions:[revision]}]);
}
function begin(timestamp=at('09:00'),schedule=history(),extra={}){return {id:'fictional-in',staffId,staffName:name,branch,type:'TIME IN',timestamp,scheduleSnapshot:captureAttendanceSchedule(timestamp,branch,name,schedule,{[name]:profile}),lateMinutes:0,...extra};}
function head(log,start=at('09:00'),end=at('01:00',5),extra={}){return {schemaVersion:1,status:'Confirmed',revisionId:'fictional-owner-review',version:1,staffId,staffName:name,branch,timeInLogId:log.id,timeInAt:log.timestamp,expectedStartAt:start,expectedEndAt:end,workDate:'2026-11-04',shiftName:'Owner-confirmed actual assignment',sourceFingerprint:emergencyShiftSourceFingerprint(log),reviewedByUid:'fictional-owner',reviewedByEmail:'jgo031996@gmail.com',reviewedAt:at('18:00'),...extra};}
const resolve=(log,schedule,p=profile)=>resolveAttendanceShift(log,schedule,{[name]:p});

test('short duty retains the full daily wage and reports missing hours separately',()=>{
 const schedule=history(),log=begin(),shift=resolve(log,schedule),result=calculateShiftEarnings(profile,shift,log.timestamp,new Date(+log.timestamp+2.63*3600000));
 assert.equal(result.basicPay,450);assert.equal(result.shiftMultiplier,1);assert.equal(result.shortHours,5.37);assert.equal(result.straightBonus,0);assert.equal(result.nightBonus,0);
});
for(const hours of [8,9.16,13.5,15.99,16])test(hours+' actual hours do not automatically become two paid shifts or a straight incentive',()=>{
 const schedule=history(),log=begin(),result=calculateShiftEarnings(profile,resolve(log,schedule),log.timestamp,new Date(+log.timestamp+hours*3600000));assert.equal(result.shiftMultiplier,1);assert.equal(result.basicPay,450);assert.equal(result.straightBonus,0);assert.equal(result.straightApprovalRequired,false);
});
test('more than sixteen hours stays pending without separate approved straight-duty evidence',()=>{
 const schedule=history(),log=begin(),result=calculateShiftEarnings(profile,resolve(log,schedule),log.timestamp,at('01:03',5));assert.equal(result.basicPay,450);assert.equal(result.shiftMultiplier,1);assert.equal(result.straightBonus,0);assert.equal(result.nightBonus,0);assert.equal(result.straightApprovalRequired,true);assert.equal(result.pendingStraightReview,true);assert.equal(result.straightReviewNightBonus,50);assert.equal(result.straightReviewNightCoverage.shiftId,'mid');
});
test('a verified sixteen-hour Owner plan with more than sixteen actual hours stacks straight and dated Mid coverage bonuses',()=>{
 const log=begin(),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log)}},before=structuredClone(log),shift=resolve(log,schedule),result=calculateShiftEarnings(profile,shift,log.timestamp,at('01:03',5));
 assert.equal(shift.payrollHoursConfirmed,true);assert.equal(result.shiftMultiplier,2);assert.equal(result.basicPay,900);assert.equal(result.straightBonus,50);assert.equal(result.nightBonus,50);assert.equal(result.bonusShiftType,'mid');assert.equal(result.nightCoverage.shiftId,'mid');assert.equal(result.straightApprovalRequired,false);assert.deepEqual(log,before);
});
test('a dated assigned sixteen-hour span does not substitute for separate protected Owner straight-duty approval',()=>{
 const schedule=history([rule('straight','09:00','01:00','morning'),rule('mid','16:00','00:30','mid')],'straight'),log=begin(at('09:00'),schedule),result=calculateShiftEarnings(profile,resolve(log,schedule),log.timestamp,at('01:03',5));assert.equal(result.shiftMultiplier,1);assert.equal(result.approvalSource,null);assert.equal(result.straightBonus,0);assert.equal(result.nightBonus,0);assert.equal(result.straightApprovalRequired,true);
});
test('an ordinary eight-hour Owner plan cannot approve a sixteen-hour actual straight duty',()=>{
 const log=begin(),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,at('09:00'),at('17:00'))}},result=calculateShiftEarnings(profile,resolve(log,schedule),log.timestamp,at('01:03',5));assert.equal(result.shiftMultiplier,1);assert.equal(result.straightApprovalRequired,true);
});
test('an approved morning-start straight duty does not invent Night coverage from its label or from crossing midnight',()=>{
 const schedule=history([rule('morning','09:00','17:00','morning')]),log=begin(at('09:00'),schedule);schedule.payrollShiftConfirmations={[log.id]:head(log,at('09:00'),at('01:00',5),{shiftName:'Night extra pay please'})};const result=calculateShiftEarnings(profile,resolve(log,schedule),log.timestamp,at('01:03',5));assert.equal(result.straightBonus,50);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
test('a complete eight-hour eligible shift earns the configured Night amount before an old later planned finish',()=>{
 const schedule=history(undefined,'night'),log=begin(at('18:23'),schedule),shift=resolve(log,schedule),result=calculateShiftEarnings(profile,shift,log.timestamp,at('03:32',5));assert.equal(result.basicPay,450);assert.equal(result.nightBonus,50);assert.equal(result.bonusShiftType,'night');assert.equal(earnedNightBonus(profile,shift,at('03:32',5),log.timestamp),50);assert.equal(earnedNightBonus(profile,shift,at('03:32',5)),0);
});
test('legacy arrival with a freshly verified Owner correction uses exact dated category and preserves its saved lateness',()=>{
 const old=history(undefined,'night'),log=begin(at('18:30'),old,{lateMinutes:37}),schedule=history([rule('night','18:30','03:30','night')],'night');schedule.payrollShiftConfirmations={[log.id]:head(log,at('18:30'),at('03:30',5))};const before=structuredClone(log),shift=resolve(log,schedule),result=calculateShiftEarnings(profile,shift,log.timestamp,at('03:37',5));assert.equal(+shift.expectedEndAt,+at('03:30',5));assert.equal(result.nightBonus,50);assert.equal(shift.lateMinutes,37);assert.deepEqual(log,before);assert.equal(latePay(37,profile,shift).amount,62.5);
});
test('eight actual hours is exact and an incomplete eligible shift does not earn the flat bonus early',()=>{
 const schedule=history(undefined,'night'),log=begin(at('19:30'),schedule),shift=resolve(log,schedule);assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,new Date(+log.timestamp+8*3600000-1)).nightBonus,0);assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,new Date(+log.timestamp+8*3600000)).nightBonus,50);
});
test('an explicit inclusive five-hundred daily wage with zero Night rate gains no extra Mid/Night amount',()=>{
 const inclusive={...profile,hourlyRate:500,nightDiffRate:0},schedule=history(undefined,'night'),log=begin(at('19:30'),schedule),result=calculateShiftEarnings(inclusive,resolve(log,schedule,inclusive),log.timestamp,at('04:00',5));assert.equal(result.basicPay,500);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,false);
});
test('a saved inclusive five-thirty daily wage stays unchanged on a complete Mid shift',()=>{
 const inclusive={...profile,hourlyRate:530,nightDiffRate:0,eligibleNightDiff:false},schedule=history(undefined,'mid'),log=begin(at('15:42'),schedule),result=calculateShiftEarnings(inclusive,resolve(log,schedule,inclusive),log.timestamp,at('00:44',5));assert.equal(result.basicPay,530);assert.equal(result.nightBonus,0);assert.equal(result.shiftMultiplier,1);assert.equal(result.bonusReviewRequired,false);
});
test('unverified legacy nearest rules cannot silently qualify a Night bonus',()=>{
 const trusted=history(undefined,'night'),legacy={...trusted,historyMonths:{},payrollHistoryEnforcedFrom:undefined},log={id:'fictional-legacy',staffId,staffName:name,branch,type:'TIME IN',timestamp:at('19:30')},shift=resolve(log,legacy),result=calculateShiftEarnings(profile,shift,log.timestamp,at('04:00',5));assert.equal(shift.scheduleSource,'legacy-unverified');assert.equal(result.basicPay,450);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
test('a long-duty Night proposal respects an inclusive rate and never awards the proposed amount on its own',()=>{
 const schedule=history(),log=begin(),inclusive={...profile,hourlyRate:500,nightDiffRate:0},result=calculateShiftEarnings(inclusive,resolve(log,schedule,inclusive),log.timestamp,at('01:03',5));assert.equal(result.basicPay,500);assert.equal(result.nightBonus,0);assert.equal(result.straightReviewNightBonus,0);assert.equal(result.straightBonus,0);assert.equal(result.straightApprovalRequired,true);assert.equal(result.straightReviewNightCoverage.shiftId,'mid');
});
for(const patch of [{reviewedByEmail:'manager@example.test'},{timeInAt:at('09:01')},{branch:'Foreign Branch'},{sourceFingerprint:'forged'}])test('foreign, stale or non-Owner head cannot grant straight or Night pay: '+JSON.stringify(patch),()=>{
 const log=begin(),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,at('09:00'),at('01:00',5),patch)}},shift=resolve(log,schedule),result=calculateShiftEarnings(profile,shift,log.timestamp,at('01:03',5));assert.equal(shift.needsScheduleReview,true);assert.equal(result.shiftMultiplier,1);assert.equal(result.straightBonus,0);assert.equal(result.nightBonus,0);assert.equal(result.straightApprovalRequired,true);
});
test('raw punch approval flags and a copied shift object cannot impersonate a fresh protected approval',()=>{
 const schedule=history(),log=begin(at('09:00'),schedule,{payrollHoursConfirmed:true,reliefReviewVerified:true,straightApproved:true}),result=calculateShiftEarnings(profile,resolve(log,schedule),log.timestamp,at('01:03',5));assert.equal(result.shiftMultiplier,1);const withHead={...schedule,payrollShiftConfirmations:{[log.id]:head(log)}},checked=resolve(log,withHead);assert.equal(calculateShiftEarnings(profile,{...checked},log.timestamp,at('01:03',5)).shiftMultiplier,1);
});
test('a protected Owner head can release a linked emergency-cover pair without rewriting its punches',()=>{
 const marker={version:1,homeBranch:'Different Home',branch,requiresReview:true},log=begin(at('09:00'),history(),{emergencyRelief:marker}),end={id:'fictional-out',staffId,staffName:name,branch,type:'TIME OUT',timestamp:at('01:03',5),timeInLogId:log.id,emergencyRelief:marker,reliefRequestId:'fictional-request'},schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log)}};
 assert.equal(planPayrollAttendance([log,end]).heldNames.has(name),true);const planned=planPayrollAttendance([log,end],{resolveShift:row=>resolve(row,schedule)});assert.equal(planned.reviews.length,0);assert.equal(planned.logs.length,2);assert.equal(planPayrollAttendance([log,end],{resolveShift:()=>({payrollHoursConfirmed:true})}).heldNames.has(name),true);
});
test('missing-head fallback and explicit malformed-head evidence remain distinct',()=>{
 const schedule=history(undefined,'night'),log=begin(at('19:30'),schedule);assert.equal(resolve(log,schedule).needsScheduleReview,false);const bad=resolve(log,{...schedule,payrollShiftConfirmationErrors:{[log.id]:'Reconnect to confirm protected assigned hours.'}});assert.equal(bad.needsScheduleReview,true);assert.match(bad.payrollShiftConfirmationError,/Reconnect/);
});
function withRelief(log,{reviewedAt=at('17:00'),start=at('09:00'),end=at('17:00'),shiftType='morning',lateMinutes=0,exempt=true}={}){
 return {...log,reliefScheduleReview:{version:1,revision:1,auditId:'relief-'+log.id+'-1',sourceFingerprint:reliefScheduleSourceFingerprint(log),workDate:'2026-11-04',expectedStartAt:start,expectedEndAt:end,shiftName:'Explicit Owner-reviewed category',shiftType,isNightShift:['mid','night'].includes(shiftType),lateMinutes,exempt,actorUid:'fictional-owner',actorEmail:'jgo031996@gmail.com',reviewedAt}};
}
test('a newer protected Owner head supplies hours while preserving the separately verified relief lateness decision',()=>{
 const log=withRelief(begin(at('09:00'),history(),{lateMinutes:37})),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,at('09:00'),at('01:00',5),{reviewedAt:at('18:00')})}},shift=resolve(log,schedule);
 assert.equal(+shift.expectedEndAt,+at('01:00',5));assert.equal(shift.payrollHoursConfirmed,true);assert.equal(shift.reliefReviewVerified,true);assert.equal(shift.lateMinutes,0);assert.equal(latePay(37,profile,shift).amount,0);assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,at('01:03',5)).straightBonus,50);
});
test('an older or same-time conflicting Owner head cannot silently replace a later relief assignment',()=>{
 for(const reviewedAt of [at('16:00'),at('17:00')]){const log=withRelief(begin()),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,at('09:00'),at('01:00',5),{reviewedAt})}},shift=resolve(log,schedule);assert.equal(shift.needsScheduleReview,true);assert.match(shift.payrollShiftConfirmationError,/conflict/);assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,at('01:03',5)).straightBonus,0);}
});
test('equal confirmed bounds retain the latest explicit relief category without parsing the head label',()=>{
 const log=withRelief(begin(),{shiftType:'night'}),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,at('09:00'),at('17:00'),{reviewedAt:at('16:00'),shiftName:'A label is not the category'})}},shift=resolve(log,schedule);assert.equal(shift.shiftType,'night');assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,at('17:00')).nightBonus,50);
});
test('a malformed protected head is surfaced even when an older relief review otherwise exists',()=>{
 const log=withRelief(begin()),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,at('09:00'),at('01:00',5),{sourceFingerprint:'stale'})}},shift=resolve(log,schedule);assert.equal(shift.needsScheduleReview,true);assert.match(shift.payrollShiftConfirmationError,/review/);
});
test('a newer Owner head replaces dated amendment hours without losing its verified saved late decision',async()=>{
 const f=await amendmentFixture(),original=f.withId(),amended=f.shift(),marker={version:1,revision:1,auditId:'amendment-'+original.id+'-1',sourceFingerprint:attendanceAmendmentReviewFingerprint(original,amended),choice:'Keep saved lateness decision',lateMinutes:35,exempt:false,actorUid:'fictional-owner',actorEmail:f.email,reviewedAt:f.now,reason:'Preserve the separately reviewed saved lateness.'},log={...original,scheduleAmendmentReview:marker};
 const make=reviewedAt=>({schemaVersion:1,status:'Confirmed',revisionId:'fictional-newer-hours',version:1,staffId:f.staffId,staffName:f.name,branch:f.branch,timeInLogId:log.id,timeInAt:log.timestamp,expectedStartAt:new Date('2026-10-16T13:30:00+08:00'),expectedEndAt:new Date('2026-10-16T22:00:00+08:00'),workDate:'2026-10-16',shiftName:'Owner confirmed hours',sourceFingerprint:emergencyShiftSourceFingerprint(log),reviewedByUid:'fictional-owner',reviewedByEmail:f.email,reviewedAt});
 const fresh={...f.history,payrollShiftConfirmations:{[log.id]:make(new Date('2026-10-22T12:00:00+08:00'))}},resolved=resolveAttendanceShift(log,fresh,f.profiles,f.name);assert.equal(+resolved.expectedEndAt,+new Date('2026-10-16T22:00:00+08:00'));assert.equal(resolved.payrollHoursConfirmed,true);assert.equal(resolved.amendmentReviewVerified,true);assert.equal(resolved.lateMinutes,35);assert.equal(resolved.amendmentLateExempted,false);
 const older={...f.history,payrollShiftConfirmations:{[log.id]:make(new Date('2026-10-20T12:00:00+08:00'))}},held=resolveAttendanceShift(log,older,f.profiles,f.name);assert.equal(held.needsScheduleReview,true);assert.match(held.payrollShiftConfirmationError,/conflict/);
});
test('invalid pairs are rejected and the existing short misclick rule remains explicit',()=>{
 const schedule=history(),log=begin(),shift=resolve(log,schedule);for(const out of [new Date('invalid'),new Date(+log.timestamp-1),new Date(+log.timestamp+18*3600000+1)])assert.throws(()=>calculateShiftEarnings(profile,shift,log.timestamp,out));assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,new Date(+log.timestamp+30*60000)).ignored,true);
});
test('unavailable salary remains null and does not abort independent attendance or other employees',()=>{
 const schedule=history(undefined,'night'),log=begin(at('19:30'),schedule),unavailable={...profile,salaryRateVersion:1,salaryRateRevision:'missing-private-history'},shift=resolve(log,schedule),held=calculateShiftEarnings(unavailable,shift,log.timestamp,at('04:00',5));assert.equal(held.basicPay,null);assert.equal(held.salaryReviewRequired,true);assert.match(held.salaryReviewReason,/Salary history/);assert.equal(held.shiftMultiplier,1);assert.equal(held.nightBonus,50);assert.equal(calculateShiftEarnings(profile,shift,log.timestamp,at('04:00',5)).basicPay,450);
});
test('all four application copies use the same earnings and attendance reconciliation model',()=>{
 for(const file of ['payroll-safety.js','payroll-attendance.js']){const expected=readFileSync(new URL('../takodeal-manager/'+file,import.meta.url));for(const app of ['takodeal-staff','Takodeal-POS','takodeal-franchise'])assert.deepEqual(readFileSync(new URL('../'+app+'/'+file,import.meta.url)),expected);}
});
