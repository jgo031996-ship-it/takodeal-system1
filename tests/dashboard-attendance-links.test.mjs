import test from 'node:test';
import assert from 'node:assert/strict';
import { onDuty } from '../takodeal-manager/dashboard-data.js';

const now = Date.parse('2026-10-07T06:01:00+08:00');
const first = { id:'first-in', staffId:'staff-1', staffName:'Alex', branch:'Maa', type:'TIME IN', timestamp:'2026-10-06T22:00:00+08:00' };
const newer = { ...first, id:'newer-in', timestamp:'2026-10-07T02:00:00+08:00' };
const olderOut = { ...first, id:'older-out', type:'TIME OUT', timeInLogId:first.id, timestamp:'2026-10-07T06:00:00+08:00' };

test('a delayed linked Time Out of the earlier shift leaves the newer shift visible', () => {
    const logs = [olderOut, newer, first], saved = structuredClone(logs);
    const duty = onDuty(logs, ['Maa'], now);
    assert.deepEqual(duty.map(row => [row.id,row.needsReview]), [[newer.id,false]]);
    assert.deepEqual(logs,saved,'dashboard computation must not rewrite attendance');
    assert.deepEqual(onDuty(logs,['Cabantian'],now),[]);
});

test('only the newer shift’s own linked closure removes it, even when the older closure arrives later', () => {
    const newerOut = { ...olderOut, id:'newer-out', timeInLogId:newer.id, timestamp:'2026-10-07T04:00:00+08:00' };
    assert.deepEqual(onDuty([first,newer,newerOut,olderOut],['Maa'],now),[]);
    assert.equal(onDuty([first,newer,{...olderOut,timeInLogId:'missing-start'}],['Maa'],now)[0].id,newer.id);
});

test('staff IDs preserve renamed shifts and do not conflate employees who share a name', () => {
    const renamed = { ...newer, staffName:'Alex Renamed' };
    assert.deepEqual(onDuty([first,renamed,olderOut],['Maa'],now).map(row=>row.id),[renamed.id]);
    const other = { ...newer, id:'other-in', staffId:'staff-2' };
    assert.deepEqual(onDuty([first,other,olderOut],['Maa'],now).map(row=>row.id),[other.id]);
});

test('legacy name-only punches retain chronological closure, action aliases and overdue review', () => {
    const legacyOut = { ...olderOut, staffId:undefined, timeInLogId:undefined };
    assert.deepEqual(onDuty([first,newer,legacyOut],['Maa'],now),[]);
    const actionOnly = { staffName:'Legacy',branch:'Cabantian',action:'TIME IN',timestamp:now-17*3600000 };
    assert.equal(onDuty([actionOnly],['Cabantian'],now)[0].needsReview,true);
    assert.deepEqual(onDuty([actionOnly,{...actionOnly,action:'TIME OUT',timestamp:now}],['Cabantian'],now),[]);
});

test('uncertain linked timestamps hold that employee for review without breaking other live duty rows', () => {
    const uncertain = { ...olderOut, timestamp:null };
    const other = { ...newer,id:'other-in',staffId:'staff-2',staffName:'Sam' };
    const duty = onDuty([first,newer,uncertain,other],['Maa'],now);
    assert.equal(duty.find(row=>row.staffId==='staff-1').needsReview,true);
    assert.equal(duty.find(row=>row.staffId==='staff-1').reviewReason,'Attendance time needs HQ review');
    assert.equal(duty.find(row=>row.staffId==='staff-2').needsReview,false);
});
