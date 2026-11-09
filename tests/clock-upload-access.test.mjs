import test from 'node:test';
import assert from 'node:assert/strict';
import {createClockUploadAccess} from '../takodeal-staff/clock-upload-access.js';
import {installAttendanceProofUploader} from '../takodeal-staff/attendance-proof.js';
const staffId='sample-staff',attendanceId='sample-attendance',uid='sample-phone',device='DEV-SAMPLE-PHONE';
function harness({answer={isConfirmed:true,value:'1234'},response,fetcher}={}){
 const user={uid,isAnonymous:true,getIdToken:async()=>'SYNTHETIC_TOKEN'},auth={currentUser:user,authStateReady:async()=>{}},calls=[],prompts=[],saved=[],values=new Map();let counter=0,currentDevice=device;
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:key=>values.get(key)??null,setItem:(key,value)=>{saved.push(value);values.set(key,value);},removeItem:key=>values.delete(key)};
 const Swal={fire:async options=>{prompts.push(options);return options.input==='password'?typeof answer==='function'?answer():answer:undefined;},showLoading(){},update(){},close(){}};
 const authorize=createClockUploadAccess({auth,deviceId:()=>currentDevice,Swal,storage,crypto:{getRandomValues:array=>array.fill(++counter)},fetcher:fetcher||(async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {ok:true,url,json:async()=>response||{schemaVersion:1,staffId,profile:{staffId,cashierName:'Sample Staff',branch:'Sample Branch',active:true},branch:'Sample Branch',sessionId:body.sessionId,sessionExpiresAt:new Date(Date.now()+3600000).toISOString()}};})});
 return{authorize,auth,user,calls,prompts,saved,Swal,device:value=>{currentDevice=value;}};
}
test('fresh PIN verification creates only a caller-owned screenshot path and immutable upload metadata',async()=>{
 const h=harness(),result=await h.authorize({staffId,attendanceId});
 assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/\/access\/staff-login$/);assert.equal(h.calls[0].body.selectedStaffId,staffId);assert.equal(h.calls[0].body.deviceId,device);assert.equal(h.calls[0].body.app,'staff');
 assert.equal(result.path,`staff_requests/${uid}/${staffId}/late_${attendanceId}.jpg`);assert.deepEqual(result.metadata,{contentType:'image/jpeg',customMetadata:{staffUploadUid:uid,staffId}});result.assertCurrent();
 assert.ok(h.saved.every(value=>!value.includes('"1234"')&&!value.includes('SYNTHETIC_TOKEN')));assert.equal(h.prompts[0].input,'password');
});
test('cancelled PIN confirmation creates no session or upload credentials',async()=>{const h=harness({answer:{isConfirmed:false}});assert.equal(await h.authorize({staffId,attendanceId}),null);assert.equal(h.calls.length,0);});
test('invalid PIN and malformed identity never reach the account service',async()=>{const h=harness({answer:{isConfirmed:true,value:'not-a-pin'}});await assert.rejects(h.authorize({staffId,attendanceId}),/PIN/);await assert.rejects(h.authorize({staffId:'../other',attendanceId}),/Reopen/);assert.equal(h.calls.length,0);});
test('account change while confirming the PIN prevents verification',async()=>{const h=harness({answer:()=>{h.auth.currentUser={...h.user,uid:'another-phone'};return{isConfirmed:true,value:'1234'};}});await assert.rejects(h.authorize({staffId,attendanceId}),/changed/);assert.equal(h.calls.length,0);});
test('device or employee change invalidates credentials before photo upload',async()=>{
 let sameEmployee=true;const h=harness(),result=await h.authorize({staffId,attendanceId,assertCurrent:()=>{if(!sameEmployee)throw Error('Employee changed');}});sameEmployee=false;assert.throws(result.assertCurrent,/Employee changed/);sameEmployee=true;h.device('DEV-OTHER-PHONE');assert.throws(result.assertCurrent,/changed/);
});
test('a later verified session invalidates an earlier prepared upload',async()=>{const h=harness(),first=await h.authorize({staffId,attendanceId});await h.authorize({staffId,attendanceId:'next-attendance'});assert.throws(first.assertCurrent,/changed/);});
test('wrong-account service responses do not produce upload credentials',async()=>{const h=harness({response:{schemaVersion:1,staffId:'different',profile:{staffId:'different',cashierName:'Other',branch:'Sample Branch'},branch:'Sample Branch',sessionId:'sample-session-long-enough',sessionExpiresAt:new Date(Date.now()+3600000).toISOString()}});await assert.rejects(h.authorize({staffId,attendanceId}));});
test('a cancelled verification releases the busy state for an explicit retry',async()=>{let attempt=0;const h=harness({answer:()=>++attempt===1?{isConfirmed:false}:{isConfirmed:true,value:'1234'}});assert.equal(await h.authorize({staffId,attendanceId}),null);assert.equal(h.calls.length,0);assert.ok(await h.authorize({staffId,attendanceId}));});
test('verified ownership passes through the real uploader into the Storage SDK before URL confirmation',async()=>{
 const h=harness(),access=await h.authorize({staffId,attendanceId}),seen=[],api={storage:{}},blob=new Blob([Uint8Array.from([255,216,255])],{type:'image/jpeg'});
 installAttendanceProofUploader(api,{getElementById:()=>null},{Swal:h.Swal,prepare:async()=>({blob,originalBytes:3,uploadBytes:3}),ref:(_storage,path)=>({fullPath:path}),getStorage(){throw Error('Expected the current app storage.');},
  uploadBytesResumable:(reference,value,metadata)=>{seen.push({reference,blob:value,metadata});const task={snapshot:{ref:reference},cancel(){},on(_event,next,_failed,complete){setImmediate(()=>{next({bytesTransferred:3,totalBytes:3});complete();});return()=>{};}};return task;},getDownloadURL:async reference=>'https://sample.invalid/'+reference.fullPath});
 const result=await api.uploadAttendanceProof({file:blob,path:access.path,metadata:access.metadata,assertCurrent:access.assertCurrent});assert.equal(seen.length,1);assert.equal(seen[0].reference.fullPath,access.path);assert.deepEqual(seen[0].metadata.customMetadata,{staffUploadUid:uid,staffId});assert.equal(seen[0].blob,blob);assert.equal(result.url,'https://sample.invalid/'+access.path);
});
