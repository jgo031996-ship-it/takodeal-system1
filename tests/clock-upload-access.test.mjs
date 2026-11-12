import test from 'node:test';
import assert from 'node:assert/strict';
import {createClockUploadAccess} from '../takodeal-staff/clock-upload-access.js';
import {installAttendanceProofUploader} from '../takodeal-staff/attendance-proof.js';
import {createStaffSetupAuthority} from '../takodeal-staff/staff-setup-access.js';
const staffId='sample-staff',attendanceId='sample-attendance',uid='sample-phone',device='DEV-SAMPLE-PHONE';
function harness({answer={isConfirmed:true,value:'1234'},response,fetcher,activated=false}={}){
 const user={uid,isAnonymous:true,getIdToken:async()=>'SYNTHETIC_TOKEN'},auth={currentUser:user,authStateReady:async()=>{}},calls=[],prompts=[],saved=[],values=new Map();let counter=0,currentDevice=device;
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:key=>values.get(key)??null,setItem:(key,value)=>{saved.push(value);values.set(key,value);},removeItem:key=>values.delete(key)};
 const Swal={fire:async options=>{prompts.push(options);return options.input==='password'?typeof answer==='function'?answer():answer:undefined;},showLoading(){},update(){},close(){}};
 let setupStatus=activated?{enabled:false,mode:'protected',device:{staffId,staffName:'Sample Staff',branch:'Sample Branch',deviceId:device,status:'Active'}}:{enabled:false,mode:'legacy',device:null},beforeConfirm;const confirmations=[];
 const setup=createStaffSetupAuthority({getUid:()=>auth.currentUser?.uid,transport:{ready:async()=>user,call:async(route,body)=>{confirmations.push({route,body});await beforeConfirm?.();return structuredClone(setupStatus);}}});
 const authorize=createClockUploadAccess({auth,deviceId:()=>currentDevice,authority:()=>setup,Swal,storage,crypto:{getRandomValues:array=>array.fill(++counter)},fetcher:fetcher||(async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {ok:true,url,json:async()=>response||{schemaVersion:1,staffId,profile:{staffId,cashierName:'Sample Staff',branch:'Sample Branch',active:true},branch:'Sample Branch',sessionId:body.sessionId,sessionExpiresAt:new Date(Date.now()+3600000).toISOString()}};})});
 return{authorize,auth,user,calls,prompts,saved,Swal,setup,confirmations,status:value=>{setupStatus=value;},beforeConfirm:fn=>{beforeConfirm=fn;},device:value=>{currentDevice=value;}};
}
test('fresh PIN verification creates only a caller-owned screenshot path and immutable upload metadata',async()=>{
 const h=harness(),result=await h.authorize({staffId,attendanceId});
 assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/\/access\/staff-login$/);assert.equal(h.calls[0].body.selectedStaffId,staffId);assert.equal(h.calls[0].body.deviceId,device);assert.equal(h.calls[0].body.app,'staff');
 assert.equal(result.path,`staff_requests/${uid}/${staffId}/late_${attendanceId}.jpg`);assert.deepEqual(result.metadata,{contentType:'image/jpeg',customMetadata:{staffUploadUid:uid,staffId}});result.assertCurrent();
 assert.ok(h.saved.every(value=>!value.includes('"1234"')&&!value.includes('SYNTHETIC_TOKEN')));assert.equal(h.prompts[0].input,'password');
});
test('cancelled PIN confirmation creates no session or upload credentials',async()=>{const h=harness({answer:{isConfirmed:false}});assert.equal(await h.authorize({staffId,attendanceId}),null);assert.equal(h.calls.length,0);});
test('empty or oversized PIN and malformed identity never reach the account service',async()=>{for(const value of['','   ','x'.repeat(101),null,1234]){const h=harness({answer:{isConfirmed:true,value}});await assert.rejects(h.authorize({staffId,attendanceId}),/PIN/);assert.equal(h.calls.length,0);}const h=harness();await assert.rejects(h.authorize({staffId:'../other',attendanceId}),/Reopen/);assert.equal(h.calls.length,0);});

test('existing short, alphanumeric and long Staff PINs reach exact server validation without numeric coercion or credential caching',async()=>{for(const value of['7','Ab12','  Staff.Code-42  ','x'.repeat(100)]){const h=harness({answer:{isConfirmed:true,value}}),result=await h.authorize({staffId,attendanceId});assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.pin,value.trim());assert.equal(h.calls[0].body.selectedStaffId,staffId);assert.equal(h.calls[0].body.app,'staff');assert.equal(result.path,`staff_requests/${uid}/${staffId}/late_${attendanceId}.jpg`);assert.equal(h.prompts[0].input,'password');assert.equal(Object.hasOwn(h.prompts[0].inputAttributes,'inputmode'),false);assert.ok(h.saved.every(raw=>!Object.hasOwn(JSON.parse(raw),'pin')&&!raw.includes('SYNTHETIC_TOKEN')));}});

test('wider legitimate input does not authorize an incorrect PIN: server denial yields no upload credentials',async()=>{let sent;const h=harness({answer:{isConfirmed:true,value:'wrongAlphaPIN'},fetcher:async(_url,options)=>{const body=JSON.parse(options.body);if(Object.hasOwn(body,'pin'))sent=body;return{ok:false,status:403,json:async()=>({code:'access/invalid-pin'})};}});await assert.rejects(h.authorize({staffId,attendanceId}),/could not be verified/);assert.equal(sent.pin,'wrongAlphaPIN');assert.equal(sent.selectedStaffId,staffId);assert.equal(h.saved.some(raw=>raw.includes('wrongAlphaPIN')),false);});
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

test('fresh personal-code activation authorizes only exact attendance evidence with no second PIN prompt or account service call',async()=>{
 const h=harness({activated:true}),access=await h.authorize({staffId,attendanceId});assert.equal(h.confirmations.length,1);assert.equal(h.confirmations[0].route,'/device-status');assert.equal(h.calls.length,0);assert.equal(h.prompts.length,0);assert.equal(h.saved.length,0);
 assert.equal(access.path,`staff_requests/${uid}/${staffId}/activated_late_${attendanceId}.jpg`);assert.deepEqual(access.metadata.customMetadata,{staffUploadUid:uid,staffId,staffUploadDeviceId:device,staffUploadAuthority:'phone-activation'});access.assertCurrent();
});
test('a stale cached activation is freshly rechecked and blocked or mismatched protected phones never fall back to a PIN session',async()=>{
 for(const patch of [{status:'Blocked'},{status:'Revoked'},{staffId:'another-staff'},{branch:''}]){const h=harness({activated:true});await h.setup.confirm(device);h.status({enabled:false,mode:'protected',device:{staffId,staffName:'Sample Staff',branch:'Sample Branch',deviceId:device,status:'Active',...patch}});await assert.rejects(h.authorize({staffId,attendanceId}));assert.equal(h.calls.length,0);assert.equal(h.prompts.length,0);}
});
test('account changes during fresh activation and later revocation or branch changes invalidate prepared evidence',async()=>{
 const h=harness({activated:true});h.beforeConfirm(()=>{h.auth.currentUser={...h.user,uid:'other'};});await assert.rejects(h.authorize({staffId,attendanceId}));assert.equal(h.calls.length,0);
 const live=harness({activated:true}),access=await live.authorize({staffId,attendanceId});live.setup.invalidate();assert.throws(access.assertCurrent);
 const moved=harness({activated:true}),prior=await moved.authorize({staffId,attendanceId});moved.status({enabled:false,mode:'protected',device:{staffId,staffName:'Sample Staff',branch:'Changed Branch',deviceId:device,status:'Active'}});await moved.setup.confirm(device);assert.throws(prior.assertCurrent,/changed/);
});
test('an unconfirmed setup service cannot silently choose the legacy PIN fallback',async()=>{const h=harness({activated:true});h.beforeConfirm(()=>{throw Error('Setup is offline');});await assert.rejects(h.authorize({staffId,attendanceId}),/offline/);assert.equal(h.calls.length,0);assert.equal(h.prompts.length,0);});
