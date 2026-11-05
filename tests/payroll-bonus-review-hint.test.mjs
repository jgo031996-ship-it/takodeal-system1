import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollBonusReviewHint,payrollBonusReviewHintHTML,openPayrollBonusReviewHint} from '../takodeal-manager/payroll-bonus-review-hint.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';

function fixture(){
 const log={attendanceLogId:'fictional-original-in',branch:'Fictional Branch',timeInAt:'2026-10-17T17:11:00+08:00',timeOutAt:'2026-10-18T02:06:00+08:00',expectedStartAt:'2026-10-17T09:00:00+08:00',expectedEndAt:'2026-10-17T17:30:00+08:00',rateWorkDate:'2026-10-17',nightBonus:0,shiftType:'morning'};
 const data={staffId:'fictional-person',name:'Fictional Crew',branch:log.branch,start:'2026-10-16',end:'2026-10-31',profile:{id:'fictional-person',hourlyRate:450,eligibleNightDiff:true},basicPay:450,nightBonus:0,logs:[log]},calls=[];
 const api={auth:{currentUser:{uid:'fictional-owner',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'fictional-owner',email:OWNER_EMAIL,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,currentPayslipData:data,globalPayrollCache:{[data.name]:data},requirePayrollPreview:value=>{assert.equal(value,data);calls.push('ready');},openAttendanceRecovery:context=>{calls.push(['attendance',context]);return 'opened';},openScheduleRecovery:context=>{calls.push(['schedule',context]);return 'schedule-opened';},updateDoc:()=>assert.fail('No writes'),addDoc:()=>assert.fail('No writes'),runTransaction:()=>assert.fail('No writes')};return{api,data,log,calls};
}
test('the shifted 8.92-hour example gets a nonblocking exact-record review hint without changing its Morning reference or awarding the configured 50',()=>{
 const f=fixture(),before=JSON.stringify(f.data),hint=payrollBonusReviewHint(f.api,f.data,f.log);assert.ok(hint);assert.equal(hint.blocking,false);assert.ok(Math.abs(hint.actualHours-535/60)<1e-10);assert.equal(hint.configuredBonus,50);assert.equal(hint.actionLabel,'Review actual-work bonus');assert.equal(hint.context.attendanceLogId,f.log.attendanceLogId);assert.equal(hint.context.staffId,f.data.staffId);assert.equal(hint.context.workDate,'2026-10-17');assert.equal(hint.context.from,'2026-10-16');assert.equal(hint.context.to,'2026-10-31');assert.match(hint.message,/scheduled reference/);assert.equal(JSON.stringify(f.data),before);assert.equal(f.log.shiftType,'morning');assert.equal(f.log.nightBonus,0);assert.equal(f.calls.length,0);
});
test('normal Morning work, modest lateness and long Morning-start duty do not get this shifted-reference hint',()=>{
 for(const [start,end]of [['2026-10-17T09:00:00+08:00','2026-10-17T17:55:00+08:00'],['2026-10-17T10:00:00+08:00','2026-10-17T19:00:00+08:00'],['2026-10-17T09:00:00+08:00','2026-10-18T01:21:00+08:00']]){const f=fixture();f.log.timeInAt=start;f.log.timeOutAt=end;assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);}
});
test('inclusive 500 with an explicit zero Night rate, disabled eligibility and short duty are not warned',()=>{
 for(const mode of ['inclusive-zero','disabled','short']){const f=fixture();if(mode==='inclusive-zero')Object.assign(f.data.profile,{hourlyRate:500,nightDiffRate:0});else if(mode==='disabled')f.data.profile.eligibleNightDiff=false;else f.log.timeOutAt='2026-10-17T20:00:00+08:00';assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);}
});
test('a bonus already awarded and both kinds of saved paid snapshots remain untouched and have no review hint',()=>{
 for(const mode of ['awarded','paid','paid-set']){const f=fixture();if(mode==='awarded')f.log.nightBonus=50;else if(mode==='paid')f.data.isPaid=true;else f.api.paidPayrollSnapshots=new WeakSet([f.data]);const before=JSON.stringify(f.data);assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);assert.equal(openPayrollBonusReviewHint(f.api,f.data,f.log),false);assert.equal(JSON.stringify(f.data),before);assert.equal(f.calls.length,0);}
});
test('a correctly referenced Mid or Night shift without an award does not infer another category from its clock time',()=>{
 const f=fixture();f.log.expectedStartAt='2026-10-17T18:30:00+08:00';f.log.expectedEndAt='2026-10-18T03:30:00+08:00';assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);
});
test('a custom positive configured rate is only described, never added to earnings',()=>{
 for(const rate of [25,100]){const f=fixture();f.data.profile.nightDiffRate=rate;assert.equal(payrollBonusReviewHint(f.api,f.data,f.log).configuredBonus,rate);assert.equal(f.data.basicPay,450);assert.equal(f.data.nightBonus,0);}
});
test('Staff, managers, unverified, password and foreign session identities cannot see or open the Owner-only hint',()=>{
 for(const mode of ['staff','manager','unverified','password','session','franchise']){const f=fixture();if(mode==='staff'||mode==='manager')f.api.auth.currentUser.email=f.api.sessionUser.email=mode+'@example.invalid';else if(mode==='unverified')f.api.auth.currentUser.emailVerified=false;else if(mode==='password')f.api.auth.currentUser.providerData=[{providerId:'password'}];else if(mode==='session')f.api.sessionUser.uid='other';else f.api.sessionUser.isFranchisee=true;assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);assert.equal(openPayrollBonusReviewHint(f.api,f.data,f.log),false);assert.equal(f.calls.length,0);}
});
test('missing raw dates, original identity, saved hours or an unknown awarded amount cannot manufacture a hint',()=>{
 for(const patch of [{timeInAt:'5:11 PM'},{timeInAt:'2026-10-17T17:11'},{timeInAt:'2026-02-30T17:11:00+08:00'},{timeOutAt:null},{expectedEndAt:null},{expectedStartAt:'2026-10-19T09:00:00+08:00'},{attendanceLogId:''},{nightBonus:undefined},{nightBonus:-50},{timeOutAt:'2026-10-18T12:00:00+08:00'}]){const f=fixture();Object.assign(f.log,patch);assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);}
});
test('only a substantial mismatch is hinted; exactly half-overlapping work remains outside this narrowly scoped prompt',()=>{
 const f=fixture();f.log.expectedEndAt='2026-10-17T17:00:00+08:00';f.log.timeInAt='2026-10-17T13:00:00+08:00';f.log.timeOutAt='2026-10-17T21:00:00+08:00';assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);
});
test('the review opens exact original attendance with cutoff and employee context, without a write or status change',()=>{
 const f=fixture(),before=JSON.stringify(f.data);assert.equal(openPayrollBonusReviewHint(f.api,f.data,f.log),'opened');assert.equal(f.calls[0],'ready');assert.equal(f.calls[1][0],'attendance');assert.deepEqual(f.calls[1][1].attendanceLogIds,['fictional-original-in']);assert.equal(f.calls[1][1].staffName,'Fictional Crew');assert.equal(f.calls[1][1].branch,'Fictional Branch');assert.equal(JSON.stringify(f.data),before);
});
test('an unavailable actual-work review route never substitutes a schedule-assignment editor',()=>{
 const f=fixture();delete f.api.openAttendanceRecovery;assert.throws(()=>openPayrollBonusReviewHint(f.api,f.data,f.log),/HR attendance review/);assert.equal(f.calls.filter(row=>Array.isArray(row)).length,0);
});
test('stale current payslip, cache, branch or ready token cannot navigate from another employee’s preview',()=>{
 for(const mode of ['payslip','cache','branch','token']){const f=fixture();if(mode==='payslip')f.api.currentPayslipData={name:'Another person'};else if(mode==='cache')f.api.globalPayrollCache[f.data.name]={...f.data};else if(mode==='branch')f.api.isBranchAllowed=()=>false;else f.api.requirePayrollPreview=()=>{throw Error('Stale preview');};if(mode==='branch')assert.equal(openPayrollBonusReviewHint(f.api,f.data,f.log),false);else assert.throws(()=>openPayrollBonusReviewHint(f.api,f.data,f.log));assert.equal(f.calls.some(row=>Array.isArray(row)),false);}
});
test('the rendering helper escapes text and keeps the warning informational',()=>{
 const html=payrollBonusReviewHintHTML({message:'Check <img src=x> & saved hours'});assert.match(html,/&lt;img src=x&gt; &amp;/);assert.doesNotMatch(html,/<img/);assert.match(html,/Actual-work bonus check/);assert.equal(payrollBonusReviewHintHTML(null),'');
});
test('malformed or stale display work-date metadata falls back to the exact saved reference date without inventing a new assignment',()=>{
 for(const value of ['2026-13-99','not-a-date','2026-10-18']){const f=fixture();f.log.rateWorkDate=value;const hint=payrollBonusReviewHint(f.api,f.data,f.log);assert.equal(hint.context.workDate,'2026-10-17');assert.equal(f.log.rateWorkDate,value);assert.match(hint.message,/does not request an assignment or lateness change/);assert.equal(f.log.nightBonus,0);}
});
test('a computed actual-work bonus basis never demands an assignment correction, including a configured zero amount',()=>{
 for(const amount of [0,50]){const f=fixture(),before=JSON.stringify(f.data);f.log.bonusBasis={version:1,status:'qualified',source:'actual-punches',shiftType:'night',workedHours:535/60};f.log.nightBonus=amount;const current=JSON.stringify(f.data);assert.equal(payrollBonusReviewHint(f.api,f.data,f.log),null);assert.equal(openPayrollBonusReviewHint(f.api,f.data,f.log),false);assert.equal(JSON.stringify(f.data),current);assert.notEqual(current,before);assert.equal(f.calls.length,0);}
});
test('an unresolved actual-work classification opens the original punches with a bonus-only purpose and preserves every amount and late decision',()=>{
 const f=fixture();f.log.bonusBasis={version:1,status:'review',source:'actual-punches',shiftType:null,workedHours:535/60};f.log.bonusReviewRequired=true;f.log.bonusReviewReason='Morning and Night branch hours overlap equally.';f.log.lateMins=37;delete f.log.expectedStartAt;delete f.log.expectedEndAt;const before=JSON.stringify(f.data),hint=payrollBonusReviewHint(f.api,f.data,f.log);assert.ok(hint);assert.equal(hint.actionLabel,'Review actual-work bonus');assert.match(hint.message,/overlap equally/);assert.match(hint.message,/lateness decisions stay unchanged/);assert.equal(openPayrollBonusReviewHint(f.api,f.data,f.log),'opened');assert.equal(f.calls[1][1].reviewPurpose,'actual-work-bonus');assert.equal(f.calls[1][1].attendanceLogId,f.log.attendanceLogId);assert.equal(JSON.stringify(f.data),before);
});
