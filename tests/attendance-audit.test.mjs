import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManualAttendance,saveManualAttendance} from '../takodeal-manager/attendance-audit.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const actor={uid:'owner-google-uid',email:'owner@example.test',name:'Owner'};
const now=new Date('2026-10-06T20:00:00+08:00');
const input={staffName:'John Lester Garcia',branch:'Maa',type:'TIME IN',dateTimeRaw:'2026-10-04T17:04',remarks:'Staff reported a missed punch; owner reviewed the time.'};
const validate=(value=input,opts={})=>validateManualAttendance(value,{actor,allowed:true,branchAllowed:branch=>branch==='Maa',now,...opts});
const save=(h,payload=validate(),options={})=>saveManualAttendance(h.api,payload,{operationId:'12345678-1234-1234-1234-123456789abc',actor,now,...options});

test('manual datetime-local is interpreted explicitly in Philippine time with the real reviewer recorded',()=>{
    const data=validate();assert.equal(data.timestamp.toISOString(),'2026-10-04T09:04:00.000Z');
    assert.equal(data.source,'manager-correction');assert.equal(data.isManual,true);assert.equal(data.actorUid,actor.uid);
    assert.equal(data.loggedBy,actor.email);assert.equal(data.actorEmail,actor.email);assert.equal(data.actorName,'Owner');
});
test('missing actor, denied payroll access or an unauthorized branch never yields a correction',()=>{
    for(const options of [{actor:null},{actor:{email:actor.email}},{allowed:false},{allowed:()=>false},{branchAllowed:false},{branchAllowed:()=>false}])assert.throws(()=>validate(input,options));
    const h=firestoreHarness();assert.equal(h.docs.size,0);
});
test('invalid staff, branch, type, remarks, dates and future times cannot be saved',()=>{
    for(const change of [{staffName:''},{staffName:'Unknown'},{branch:'All'},{type:'TIME OUT (AUTO)'},{remarks:''},{dateTimeRaw:'2026-02-30T15:30'},{dateTimeRaw:'2026-10-04T25:30'},{dateTimeRaw:'2026-10-04T17:04Z'},{dateTimeRaw:'2026-10-07T00:00'},{staffId:'bad/path'}])assert.throws(()=>validate({...input,...change}));
});
test('concurrent taps create one immutable correction document with a server-recorded audit time',async()=>{
    const h=firestoreHarness();const responses=await Promise.all(Array.from({length:15},()=>save(h)));
    assert.equal(h.docs.size,1);assert.equal(responses.filter(value=>value.status==='created').length,1);
    const saved=h.get('attendance_logs/manual_12345678-1234-1234-1234-123456789abc');
    assert.equal(saved.isManual,true);assert.equal(saved.source,'manager-correction');assert.equal(saved.actorUid,actor.uid);
    assert.equal(saved.actorEmail,actor.email);assert.deepEqual(saved.recordedAt,{seconds:1});
});
test('lost acknowledgement retries the same correction without adding a second punch',async()=>{
    const h=firestoreHarness();h.loseNextAck();await assert.rejects(save(h),/lost/);
    assert.equal((await save(h)).status,'already-recorded');assert.equal(h.docs.size,1);
});
test('failed commit creates no attendance and the same operation can safely retry',async()=>{
    const h=firestoreHarness();h.failNextCommit();await assert.rejects(save(h),/rejected/);
    assert.equal(h.docs.size,0);assert.equal((await save(h)).status,'created');
});
test('an operation cannot be reused to overwrite another staff member, timestamp or explanation',async()=>{
    const h=firestoreHarness();await save(h);
    for(const change of [{staffName:'Other Staff'},{dateTimeRaw:'2026-10-04T18:04'},{remarks:'Different explanation'}])await assert.rejects(save(h,validate({...input,...change})),/different attendance details/);
    assert.equal(h.docs.size,1);assert.equal(h.get('attendance_logs/manual_12345678-1234-1234-1234-123456789abc').staffName,input.staffName);
});
test('actor changes and permission revocation during the transaction leave attendance unchanged',async()=>{
    const h=firestoreHarness();h.api.auth={currentUser:{...actor}};
    const payload=validate();let checks=0;
    await assert.rejects(save(h,payload,{authorize:()=>{if(++checks===2)throw Error('Permission changed');}}),/Permission changed/);
    assert.equal(h.docs.size,0);
    h.api.auth.currentUser={uid:'other',email:'other@example.test'};await assert.rejects(save(h),/account changed/);assert.equal(h.docs.size,0);
});
test('supplied schedule evidence is preserved without affecting any earlier punches or financial records',async()=>{
    const h=firestoreHarness();h.put('attendance_logs/old',{staffName:input.staffName,type:'TIME IN',isManual:true,remarks:'System Error'});h.put('payroll_records/paid',{netPay:5000});
    const snapshot={version:1,branch:'Maa',staffName:input.staffName,expectedStartAt:'2026-10-04T17:00:00+08:00',expectedEndAt:'2026-10-05T01:00:00+08:00',isNightShift:true};
    await save(h,validate({...input,scheduleSnapshot:snapshot}));
    assert.deepEqual(h.get('attendance_logs/manual_12345678-1234-1234-1234-123456789abc').scheduleSnapshot,snapshot);
    assert.deepEqual(h.get('attendance_logs/old'),{staffName:input.staffName,type:'TIME IN',isManual:true,remarks:'System Error'});
    assert.deepEqual(h.get('payroll_records/paid'),{netPay:5000});
    assert.throws(()=>validate({...input,scheduleSnapshot:{...snapshot,branch:'Other'}}),/another staff member or branch/);
});
