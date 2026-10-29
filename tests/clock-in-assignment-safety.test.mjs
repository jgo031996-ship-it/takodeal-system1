import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureAttendanceSchedule,resolveAttendanceShift,calculateLateMinutes} from '../takodeal-manager/payroll-safety.js';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';

const name='Synthetic Princess',staffId='synthetic-princess',branch='Synthetic Branch';
const at=(time,date='2026-10-29')=>new Date(date+'T'+time+':00+08:00');
function fixture({assigned='morning2',aliasField='scheduleNickname',workDate='2026-10-29'}={}) {
    const profile={id:staffId,staffId,cashierName:name,[aliasField]:'Princess',branch};
    const rules=[{id:'morning1',name:'Morning 1',shiftType:'morning',startTime:'09:00',endTime:'17:30',active:true},
        {id:'morning2',name:'Morning 2',shiftType:'morning',startTime:'10:00',endTime:'18:30',active:true},
        {id:'night',name:'Night',shiftType:'night',startTime:'18:30',endTime:'03:00',active:true}];
    const plan={currentYear:Number(workDate.slice(0,4)),currentMonth:Number(workDate.slice(5,7)),branchConfig:{[branch]:rules},employees:[{staffId,name:'Princess',cashierName:name,branch}],
        currentSchedule:{[Number(workDate.slice(-2))]:{[branch]:{scheduled:{morning1:assigned==='morning1'?'Princess':'Other',morning2:assigned==='morning2'?'Princess':'UNFILLED',night:assigned==='night'?'Princess':'UNFILLED'},rest:assigned?[]:['Princess']}}}};
    return {profile,plan,workDate,profiles:{[name]:profile}};
}
function history(f) {
    const revision=createScheduleRevision(f.plan,{revisionId:'synthetic-clock-in',effectiveFrom:f.workDate,savedAt:at('06:00',f.workDate),cutover:f.workDate});
    return assembleScheduleHistory(f.plan,[{month:f.workDate.slice(0,7),revisions:[revision],latestRevisionId:revision.revisionId}]);
}
const capture=(f,time='09:57',date=f.workDate,schedule=history(f))=>captureAttendanceSchedule(at(time,date),branch,name,schedule,f.profiles);

test('09:57 compares with the exact assigned Morning 1 or Morning 2 hours',()=>{
    for(const [assigned,expected]of [['morning1',57],['morning2',0]]) {
        const f=fixture({assigned}),before=structuredClone(f),value=capture(f);
        assert.equal(value.shiftId,assigned);assert.equal(value.wasScheduled,true);assert.equal(value.lateMinutes,expected);
        assert.equal(value.needsScheduleReview,false);assert.equal(value.scheduleReviewReason,'');assert.deepEqual(f,before);
    }
});
test('shift category and misleading label do not replace the explicit start/end pair',()=>{
    const f=fixture();f.plan.branchConfig[branch][1].name='Morning 1 Kitchen (9am-5:30pm)';
    const value=capture(f);assert.equal(value.shiftId,'morning2');assert.equal(value.lateMinutes,0);
    assert.equal(value.expectedStartAt,at('10:00').toISOString());assert.equal(value.expectedEndAt,at('18:30').toISOString());
});
test('current scheduleNickname, legacy scheduleName and nickname resolve the exact dated assignment',()=>{
    for(const aliasField of ['scheduleNickname','scheduleName','nickname']) {
        const f=fixture({aliasField}),value=capture(f);assert.equal(value.wasScheduled,true,aliasField);assert.equal(value.shiftId,'morning2');assert.equal(value.lateMinutes,0);
    }
});
test('a stable employee ID may bind a saved old alias; an unlinked alias cannot',()=>{
    const f=fixture();f.profile.scheduleNickname='New label';f.plan.employees[0].name='Old label';f.plan.currentSchedule[29][branch].scheduled.morning2='Old label';
    assert.equal(capture(f).wasScheduled,true);
    delete f.plan.employees[0].staffId;
    const value=capture(f);assert.equal(value.wasScheduled,false);assert.equal(value.needsScheduleReview,true);assert.equal(value.lateMinutes,0);
});
test('an alias claimed by another stable employee ID stays in identity review',()=>{
    for(const source of ['saved','current']) {
        const f=fixture(),other={staffId:'another-person',cashierName:'Other Person',scheduleNickname:'Princess'};
        if(source==='saved')f.plan.employees.push(other);else f.profiles['Other Person']=other;
        const value=capture(f);assert.equal(value.wasScheduled,false);assert.equal(value.needsScheduleReview,true);
        assert.equal(value.scheduleReviewReason,'dated-staff-identity-conflict');assert.equal(value.lateMinutes,0);
    }
});
test('unassigned and standby punches retain evidence but never invent confirmed lateness',()=>{
    for(const time of ['09:57','10:57']) {
        const f=fixture({assigned:null}),value=capture(f,time);
        assert.equal(value.wasScheduled,false);assert.equal(value.needsScheduleReview,true);assert.equal(value.lateMinutes,0);
        assert.equal(value.scheduleReviewReason,'missing-dated-assignment');assert.ok(value.expectedStartAt);assert.ok(value.expectedEndAt);
    }
});
test('missing schedule evidence preserves a reviewable punch shape without a late charge',()=>{
    const f=fixture(),value=capture(f,'09:57',f.workDate,null);assert.equal(value.needsScheduleReview,true);
    assert.equal(value.scheduleReviewReason,'missing-schedule-history');assert.equal(value.wasScheduled,false);assert.equal(value.lateMinutes,0);
    assert.equal(value.expectedStartAt,'');assert.equal(value.expectedEndAt,'');assert.equal(value.version,1);assert.equal(value.source,'clock-in');
});
test('conflicting assigned shifts cannot be selected by nearest start',()=>{
    const f=fixture();f.plan.currentSchedule[29][branch].scheduled.morning1='Princess';
    const value=capture(f);assert.equal(value.scheduleReviewReason,'conflicting-dated-assignment');assert.equal(value.needsScheduleReview,true);assert.equal(value.wasScheduled,false);assert.equal(value.lateMinutes,0);
});
test('distinct later shifts on the same assigned workday also need explicit review',()=>{
    const f=fixture();f.plan.currentSchedule[29][branch].scheduled.night='Princess';
    const value=capture(f);assert.equal(value.scheduleReviewReason,'conflicting-dated-assignment');assert.equal(value.needsScheduleReview,true);
});
test('multiple assigned roles with one identical time/category pair have a common verified shift',()=>{
    const f=fixture(),copy={...f.plan.branchConfig[branch][1],id:'morning2-kitchen',name:'Morning 2 Kitchen'};
    f.plan.branchConfig[branch].push(copy);f.plan.currentSchedule[29][branch].scheduled[copy.id]='Princess';
    const value=capture(f);assert.equal(value.shiftId,null);assert.equal(value.wasScheduled,true);assert.equal(value.needsScheduleReview,false);assert.equal(value.lateMinutes,0);
    assert.equal(value.expectedEndAt,at('18:30').toISOString());
});
test('inactive, day-disabled, duplicate-ID and invalid-time assignments cannot confirm a new punch',()=>{
    for(const [change,reason]of [
        [f=>{f.plan.branchConfig[branch][1].active=false;},'inactive-dated-shift'],
        [f=>{f.plan.branchConfig[branch][1].days=[0];},'dated-assignment-disabled-day'],
        [f=>{f.plan.branchConfig[branch].push({...f.plan.branchConfig[branch][1]});},'invalid-dated-shift'],
        [f=>{f.plan.branchConfig[branch][1].endTime='bad';},'invalid-dated-shift'],
        [f=>{f.plan.branchConfig[branch][1].endTime='10:00';},'invalid-dated-shift']
    ]) {
        const f=fixture();change(f);const value=capture(f,'09:57',f.workDate,f.plan);
        assert.equal(value.scheduleReviewReason,reason);assert.equal(value.wasScheduled,false);assert.equal(value.needsScheduleReview,true);assert.equal(value.lateMinutes,0);
    }
});
test('overnight assigned work preserves its original workday and next-day finish',()=>{
    const f=fixture({assigned:'night'}),value=capture(f,'00:06','2026-10-30');
    assert.equal(value.wasScheduled,true);assert.equal(value.shiftId,'night');assert.equal(value.expectedStartAt,at('18:30').toISOString());
    assert.equal(value.expectedEndAt,at('03:00','2026-10-30').toISOString());assert.equal(value.lateMinutes,336);
});
test('a month-boundary overnight shift uses the captured prior-month revision',()=>{
    const f=fixture({assigned:'night',workDate:'2026-10-31'}),value=capture(f,'00:06','2026-11-01');
    assert.equal(value.wasScheduled,true);assert.equal(value.expectedStartAt,at('18:30','2026-10-31').toISOString());
    assert.equal(value.expectedEndAt,at('03:00','2026-11-01').toISOString());assert.equal(value.scheduleRevisionId,'synthetic-clock-in');
});
test('a completed previous-night assignment cannot displace today’s Morning 2',()=>{
    const f=fixture();f.plan.currentSchedule[28]={[branch]:{scheduled:{night:'Princess'}}};
    const value=capture(f,'09:57',f.workDate,f.plan);assert.equal(value.shiftId,'morning2');assert.equal(value.wasScheduled,true);assert.equal(value.lateMinutes,0);
});
test('overlapping plausible assignments on adjacent workdays require review',()=>{
    const f=fixture();f.plan.currentSchedule[28]={[branch]:{scheduled:{night:'Princess'}}};f.plan.branchConfig[branch][2].endTime='10:30';
    const value=capture(f,'09:57',f.workDate,f.plan);assert.equal(value.needsScheduleReview,true);assert.equal(value.scheduleReviewReason,'conflicting-dated-assignment');
});
test('a preserved old snapshot and historical legacy calculator retain their previous math',()=>{
    const f=fixture({assigned:null}),old={version:1,source:'clock-in',branch,staffName:name,expectedStartAt:at('09:00').toISOString(),expectedEndAt:at('17:30').toISOString(),shiftId:'morning1',shiftType:'morning',wasScheduled:false,needsScheduleReview:false,lateMinutes:57};
    const log={type:'TIME IN',staffName:name,branch,timestamp:at('09:57'),lateMinutes:57,scheduleSnapshot:old},before=structuredClone(log);
    const resolved=resolveAttendanceShift(log,f.plan,f.profiles);assert.equal(resolved.lateMinutes,57);assert.equal(resolved.expectedStartAt.toISOString(),old.expectedStartAt);assert.deepEqual(log,before);
    assert.equal(calculateLateMinutes(at('10:57'),branch,name,f.plan,f.profiles).lateMinutes,57);
});
test('all four apps ship the same capture logic',()=>{
    const source=readFileSync(new URL('../takodeal-manager/payroll-safety.js',import.meta.url),'utf8');
    for(const dir of ['Takodeal-POS','takodeal-staff','takodeal-franchise'])assert.equal(readFileSync(new URL('../'+dir+'/payroll-safety.js',import.meta.url),'utf8'),source,dir);
});
