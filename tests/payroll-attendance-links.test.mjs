import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';
const punch=(id,type,time,extra={})=>({id,staffId:'one',staffName:'Staff One',branch:'Maa',type,timestamp:new Date(time),...extra});
const start=punch('in','TIME IN','2026-10-06T22:00:00+08:00');
const end=punch('out','TIME OUT','2026-10-07T06:00:00+08:00',{timeInLogId:'in'});
test('shared payroll planner and attendance reconciler are identical across their consuming apps',()=>{
    for(const app of ['takodeal-staff','takodeal-franchise'])assert.equal(readFileSync(new URL('../'+app+'/payroll-attendance.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/payroll-attendance.js',import.meta.url),'utf8'));
    for(const app of ['takodeal-staff','takodeal-franchise','Takodeal-POS'])assert.equal(readFileSync(new URL('../'+app+'/attendance-reconcile.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/attendance-reconcile.js',import.meta.url),'utf8'));
});
test('valid exact linked pairs remain usable and the original punches are immutable',()=>{
    const records=[start,end],before=structuredClone(records),plan=planPayrollAttendance(records);
    assert.equal(plan.reviews.length,0);assert.deepEqual(plan.logs.map(row=>row.id),['in','out']);assert.deepEqual(records,before);
});
test('legacy unlinked order and values are preserved without new holds or inferred links',()=>{
    const records=[start,{...end,timeInLogId:undefined}],plan=planPayrollAttendance(records);
    assert.equal(plan.reviews.length,0);assert.deepEqual(plan.logs.map(({payrollStaffName,...row})=>row),records);
});
test('a linked older shift overlapping a newer Time In holds that employee instead of inventing payable hours',()=>{
    const newer=punch('newer','TIME IN','2026-10-07T02:00:00+08:00'),other=punch('other','TIME IN','2026-10-07T09:00:00+08:00',{staffId:'two',staffName:'Other Staff'}),plan=planPayrollAttendance([start,newer,end,other]);
    assert.deepEqual(plan.logs.map(row=>row.id),['other']);assert.ok(plan.heldNames.has('Staff One'));assert.match(plan.reviews[0].reason,/overlap/);assert.deepEqual(plan.reviews[0].recordIds,['in','newer','out']);
});
test('missing, wrong-person, wrong-branch, duplicate and impossible explicit closures require review without new deductions',()=>{
    const changes=[{timeInLogId:'missing'},{staffId:'two'},{branch:'Citygate'},{timestamp:null},{timestamp:new Date('2026-10-06T21:00:00+08:00')},{timestamp:new Date('2026-10-08T22:00:00+08:00')}];
    for(const change of changes){const plan=planPayrollAttendance([start,{...end,...change,penaltyAmount:999}]);assert.ok(plan.heldNames.has('Staff One'));assert.equal(plan.logs.length,0);}
    const twice=planPayrollAttendance([start,end,{...end,id:'duplicate'}]);assert.equal(twice.logs.length,0);assert.match(twice.reviews[0].reason,/More than one/);
});
test('distinct employee IDs resolving to one payroll name are held even before a closure exists',()=>{
    const plan=planPayrollAttendance([start,{...start,id:'other',staffId:'two'}]);assert.equal(plan.logs.length,0);assert.match(plan.reviews[0].reason,/multiple employee IDs/);
});
test('a rename can use its known employee ID, but an old-name frozen payslip prevents a second unpaid preview',()=>{
    const options={resolveName:row=>row.staffId==='one'?'Current Name':row.staffName};
    const normal=planPayrollAttendance([start,{...end,staffName:'Current Name'}],options);assert.equal(normal.reviews.length,0);assert.equal(normal.logs[0].payrollStaffName,'Current Name');
    const paid=planPayrollAttendance([start,{...end,staffName:'Current Name'}],{...options,frozenNames:['Staff One']});assert.equal(paid.logs.length,0);assert.match(paid.reviews[0].reason,/saved payslip/);
});
test('voided linked closures are ignored instead of closing or holding a live shift',()=>{
    const plan=planPayrollAttendance([start,{...end,status:'Voided'}]);assert.equal(plan.reviews.length,0);assert.deepEqual(plan.logs.map(row=>row.id),['in']);
});
test('known previous-cutoff closures are verified without being charged to the current cutoff or a newer shift',()=>{
    const next=punch('next','TIME IN','2026-10-07T09:00:00+08:00'),plan=planPayrollAttendance([end,next],{referenceRecords:[start,end,next]});
    assert.equal(plan.reviews.length,0);assert.deepEqual(plan.logs.map(row=>row.id),['next']);
    const overlapping=punch('next','TIME IN','2026-10-07T02:00:00+08:00'),held=planPayrollAttendance([end,overlapping],{referenceRecords:[start,end,overlapping]});
    assert.ok(held.heldNames.has('Staff One'));assert.match(held.reviews[0].reason,/overlap/);
});
test('adjacent linked shifts close before the next Time In at the same timestamp without changing legacy tie order',()=>{
    const first=punch('a','TIME IN','2026-10-07T09:00:00+08:00'),second=punch('b','TIME IN','2026-10-07T12:00:00+08:00'),firstOut=punch('oa','TIME OUT','2026-10-07T12:00:00+08:00',{timeInLogId:'a'}),secondOut=punch('ob','TIME OUT','2026-10-07T20:00:00+08:00',{timeInLogId:'b'});
    const records=[first,second,firstOut,secondOut],before=structuredClone(records),plan=planPayrollAttendance(records);
    assert.equal(plan.reviews.length,0);assert.deepEqual(plan.logs.map(row=>row.id),['a','oa','b','ob']);assert.deepEqual(records,before);
    const legacy=records.map(({timeInLogId,...row})=>row),legacyPlan=planPayrollAttendance(legacy);assert.deepEqual(legacyPlan.logs.map(row=>row.id),['a','b','oa','ob']);
});
test('same-instant zero-duration links keep their own start first; impossible coincident order is held',()=>{
    const start=punch('a','TIME IN','2026-10-07T12:00:00+08:00'),close=punch('oa','TIME OUT','2026-10-07T12:00:00+08:00',{timeInLogId:'a'}),next=punch('b','TIME IN','2026-10-07T12:00:00+08:00'),nextClose=punch('ob','TIME OUT','2026-10-07T20:00:00+08:00',{timeInLogId:'b'});
    const safe=planPayrollAttendance([next,close,start,nextClose]);assert.equal(safe.reviews.length,0);assert.deepEqual(safe.logs.map(row=>row.id),['a','oa','b','ob']);
    const cycle=planPayrollAttendance([start,next,close,{...nextClose,timestamp:start.timestamp}]);assert.equal(cycle.logs.length,0);assert.match(cycle.reviews[0].reason,/ambiguous order/);
});
test('original-name frozen protection covers unlinked ID rows and exact-key case or punctuation changes',()=>{
    for(const current of ['Current Name','STAFF ONE','Staff, One']){
        for(const raw of ['Staff One',...(current==='STAFF ONE'?['STAFF ONE']:[])]){
            const rows=[{...start,staffName:raw},{...end,staffName:raw,timeInLogId:undefined}],plan=planPayrollAttendance(rows,{resolveName:()=>current,frozenNames:['Staff One']});
            assert.equal(plan.logs.length,0,current+' from '+raw);assert.match(plan.reviews[0].reason,/saved payslip/);
        }
    }
});
