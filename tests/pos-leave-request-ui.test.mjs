import test from 'node:test';
import assert from 'node:assert/strict';
import {installPOSLeaveRequests} from '../Takodeal-POS/leave-request-ui.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
function fixture({pin='7281',authenticated=true}={}) {
    const h=firestoreHarness(),nodes=new Map(),legacy=[],dialogs=[];let ids=0;
    for(const [id,value] of [['reqLeaveStart','2030-01-10'],['reqLeaveEnd','2030-01-11'],['reqLeaveType','Personal Leave'],['reqLeaveReason','Family appointment']])nodes.set(id,{value});
    h.put('cashiers/sample-crew',{cashierName:'Sample Crew',branch:'Saved Branch',role:'Staff',pin:'7281',status:'Active'});
    const w={...h.api,sessionUser:{staffId:'sample-crew',cashierName:'Sample Crew',branch:'Device Branch'},crypto:{randomUUID:()=>{ids++;return 'sample-request-'+ids;}},
        Swal:{fire:async (...args)=>{dialogs.push(args);return typeof args[0]==='object'&&args[0].input==='password'?{isConfirmed:true,value:pin}:{};}},submitStaffRequest:async type=>{legacy.push(type);return 'original';},loadStaffPersonalInbox:async()=>{}};
    installPOSLeaveRequests(w,{getElementById:id=>nodes.get(id)},{primaryAuth:{currentUser:authenticated?{uid:'registered-device'}:null}});
    return {h,w,nodes,legacy,dialogs,ids:()=>ids};
}
test('actual POS leave submission uses the saved employee ID and branch without storing its PIN',async()=>{
    const f=fixture();assert.equal(await f.w.submitStaffRequest('Leave'),true);
    const saved=f.h.get('staff_requests/sample-request-1');assert.equal(saved.staffId,'sample-crew');assert.equal(saved.branch,'Saved Branch');assert.equal(saved.startDate,'2030-01-10');assert.equal(saved.status,'Pending');
    assert.equal(Object.hasOwn(saved,'pin'),false);assert.equal(JSON.stringify(saved).includes('7281'),false);assert.equal(f.nodes.get('reqLeaveStart').value,'');assert.deepEqual(f.legacy,[]);
});
test('a lost leave-save acknowledgement retains the form and retries the same stable request ID',async()=>{
    const f=fixture();f.h.loseNextAck();assert.equal(await f.w.submitStaffRequest('Leave'),false);assert.equal(f.nodes.get('reqLeaveStart').value,'2030-01-10');
    assert.equal(await f.w.submitStaffRequest('Leave'),true);assert.equal(f.ids(),1);assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('staff_requests/')).length,1);
});
test('incorrect staff PIN blocks POS leave writes and keeps its entered dates',async()=>{
    const f=fixture({pin:'wrong'});assert.equal(await f.w.submitStaffRequest('Leave'),false);assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('staff_requests/')).length,0);assert.equal(f.nodes.get('reqLeaveStart').value,'2030-01-10');
});
test('the new POS leave flow preserves existing Cash Advance and Meal request handlers',async()=>{
    const f=fixture();for(const type of ['Cash Advance','Staff Meal'])assert.equal(await f.w.submitStaffRequest(type),'original');assert.deepEqual(f.legacy,['Cash Advance','Staff Meal']);assert.equal(f.dialogs.length,0);
});
test('a PIN-only staff session can request leave using the fresh profile and entered PIN',async()=>{
    const f=fixture({authenticated:false});assert.equal(await f.w.submitStaffRequest('Leave'),true);assert.equal(f.h.get('staff_requests/sample-request-1').staffId,'sample-crew');
});
test('the actual POS UI uses injected isolated directory and server proof without any private roster read',async()=>{
 const f=fixture(),actor={uid:'approved-device',deviceId:'DEV-SYNTHETIC-POS',app:'cashier',sessionId:'synthetic-session-0001'},calls=[];f.h.docs.delete('cashiers/sample-crew');f.h.put('staff_directory/sample-crew',{staffId:'sample-crew',cashierName:'Sample Crew',branch:'Saved Branch',role:'Staff',active:true,profileRevision:'directory-revision'});
 f.w.localStorage={getItem:key=>key==='takodeal_device_branch'?'Device Branch':key==='takodeal_device_id'?actor.deviceId:null};const api={...f.h.api,auth:{currentUser:{uid:actor.uid}},staffProfileCollection:'staff_directory',staffPinActor:()=>actor,verifyStaffPin:async input=>{input.assertCurrent?.();calls.push(input);assert.equal(input.pin,'7281');f.h.put('staff_pin_verifications/server-proof',{schemaVersion:1,...actor,staffId:'sample-crew',purpose:'leave',scope:input.scope,profileRevision:'directory-revision',expiresAt:new Date('2035-01-01')});return{staffId:'sample-crew',verificationId:'server-proof'};}};f.w.resolveCashierOperationalApi=async({assertCurrent})=>{assertCurrent();return api;};
 assert.equal(await f.w.submitStaffRequest('Leave'),true);assert.equal(calls.length,1);assert.equal(calls[0].purpose,'leave');const saved=f.h.get('staff_requests/sample-request-1');assert.equal(saved.staffPinVerificationId,'server-proof');assert.equal(saved.staffId,'sample-crew');assert.equal(saved.branch,'Saved Branch');assert.equal(Object.hasOwn(saved,'pin'),false);
});
