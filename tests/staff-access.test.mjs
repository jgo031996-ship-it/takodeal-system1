import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStaffAccessClient,operationalStaffProfile,STAFF_ACCESS_ENDPOINT} from '../takodeal-staff/staff-access.js';
import {createStaffPrivateProfileAccess} from '../takodeal-staff/staff-private-profile.js';
import {createStaffLeaveService} from '../takodeal-staff/leave-request-actions.js';
import {createEarlyTimeOutService} from '../takodeal-staff/early-time-out-actions.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const staffId='sample-staff',deviceId='DEV-SAMPLE-PHONE',uid='sample-phone-auth',profile={staffId,cashierName:'SAMPLE Staff',branch:'SAMPLE Branch',active:true,scheduleAliases:['SAMPLE Old Name']},NOW=Date.parse('2030-01-01T00:00:00Z');
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};},tick=()=>new Promise(resolve=>setImmediate(resolve));
function transport({fetcher,ensureUser,delay,cancelDelay}={}){
 const user={uid,isAnonymous:true,getIdToken:async()=>'SAMPLE_TOKEN'},auth={currentUser:user},calls=[];let selectedDevice=deviceId;
 const client=createStaffAccessClient({auth,ensureUser:ensureUser||(async()=>auth.currentUser),deviceId:()=>selectedDevice,sessionId:()=> 'sample-session-id',makeSessionId:()=> 'sample-session-id',now:()=>NOW,fetcher:fetcher||(async(url,request)=>{calls.push({url,request});return{ok:true,url,json:async()=>({schemaVersion:1,staffId,profile,branch:profile.branch,sessionId:'sample-session-id',sessionExpiresAt:new Date(NOW+3600000).toISOString()})};}),...(delay?{delay,cancelDelay}:{})});
 return{client,auth,user,calls,device:value=>selectedDevice=value};
}
test('operational responses reject every private credential, wage and contact field',()=>{
 for(const field of ['pin','payslipPin','hourlyRate','dailyRate','sssNumber','phone','address','bankAccount','email','customDeductions'])assert.throws(()=>operationalStaffProfile({...profile,[field]:'PRIVATE'},staffId));
 assert.equal(operationalStaffProfile(profile,staffId).staffId,staffId);
});
test('normal PIN login uses only the pinned server route, exact ephemeral body and primary anonymous account',async()=>{
 const h=transport(),result=await h.client.login({pin:'004321',selectedStaffId:staffId});assert.equal(result.staffId,staffId);assert.equal(h.calls.length,1);const call=h.calls[0];assert.equal(call.url,STAFF_ACCESS_ENDPOINT+'/staff-login');assert.deepEqual(JSON.parse(call.request.body),{pin:'004321',app:'staff',sessionId:'sample-session-id',selectedStaffId:staffId,deviceId});assert.equal(call.request.cache,'no-store');assert.equal(call.request.credentials,'omit');assert.equal(call.request.redirect,'error');
});
test('malformed, expired, foreign and private-field login responses never establish a client session',async()=>{
 const valid={schemaVersion:1,staffId,profile,branch:profile.branch,sessionId:'sample-session-id',sessionExpiresAt:new Date(NOW+3600000).toISOString()};
 for(const result of [{...valid,staffId:'other'},{...valid,sessionExpiresAt:'invalid'},{...valid,sessionExpiresAt:new Date(NOW-1).toISOString()},{...valid,profile:{...profile,pin:'SECRET'}},{...valid,branch:'Other'},{...valid,token:'extra'}]){const h=transport({fetcher:async()=>({ok:true,json:async()=>result})});await assert.rejects(h.client.login({pin:'004321',selectedStaffId:staffId}));}
});
test('abandoning a dispatched login sends a PIN-free cancellation for its exact session and suppresses its late profile',async()=>{
 const response=deferred(),calls=[],h=transport({fetcher:async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});if(url.endsWith('/staff-login'))return response.promise;return{ok:true,json:async()=>({schemaVersion:1,signedOut:true})};}});
 const login=h.client.login({pin:'004321'});await tick();h.client.invalidate();await tick();const cancellation=calls.find(call=>call.url.endsWith('/staff-logout'));assert.deepEqual(cancellation.body,{deviceId,app:'staff',sessionId:'sample-session-id'});assert.equal(Object.hasOwn(cancellation.body,'pin'),false);response.resolve({ok:true,json:async()=>({})});await assert.rejects(login,{code:'staff-access/changed'});
});
test('a reloaded Staff client drains durable PIN-free cancellation markers before dispatching another login',async()=>{
 const rows=new Map(),storage={get length(){return rows.size;},key:at=>[...rows.keys()][at],getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,String(value)),removeItem:key=>rows.delete(key)},user={uid,isAnonymous:true,getIdToken:async()=>'SAMPLE_TOKEN'},auth={currentUser:user},calls=[];
 const options={auth,ensureUser:async()=>user,deviceId:()=>deviceId,sessionId:()=>null,now:()=>NOW,storage};
 const old=createStaffAccessClient({...options,makeSessionId:()=> 'abandoned-session',fetcher:async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});if(url.endsWith('/staff-logout'))throw Error('offline');return{ok:true,json:async()=>({})};}});
 await assert.rejects(old.login({pin:'004321'}));await tick();assert.equal(rows.size,1);assert.equal([...rows.values()].some(value=>value.includes('004321')),false);
 const cancelled=deferred(),next=createStaffAccessClient({...options,makeSessionId:()=> 'next-session',fetcher:async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});if(url.endsWith('/staff-logout')){await cancelled.promise;return{ok:true,json:async()=>({schemaVersion:1,signedOut:true})};}return{ok:true,json:async()=>({schemaVersion:1,staffId,profile,branch:profile.branch,sessionId:'next-session',sessionExpiresAt:new Date(NOW+3600000).toISOString()})};}});
 const login=next.login({pin:'009876'});await tick();assert.equal(calls.filter(call=>call.url.endsWith('/staff-login')).length,1,'new PIN is not sent while the earlier session can still be granted');assert.deepEqual(calls.at(-1).body,{deviceId,app:'staff',sessionId:'abandoned-session'});cancelled.resolve();await login;assert.equal(rows.size,0);assert.equal(calls.at(-1).body.sessionId,'next-session');
});
test('a saved cancellation for another anonymous phone account cannot silently allow a new Staff login',async()=>{
 const row={schemaVersion:1,uid:'previous-phone-uid',deviceId,sessionId:'abandoned-session',createdAt:NOW},key='takodeal_staff_session_pending_v1:'+row.uid+':'+row.sessionId,storage={length:1,key:()=>key,getItem:()=>JSON.stringify(row),setItem(){},removeItem(){}};let calls=0;
 const user={uid,isAnonymous:true,getIdToken:async()=>'SAMPLE_TOKEN'},client=createStaffAccessClient({auth:{currentUser:user},ensureUser:async()=>user,deviceId:()=>deviceId,sessionId:()=>null,makeSessionId:()=> 'next-session',storage,fetcher:async()=>{calls++;throw Error('must not dispatch');}});
 await assert.rejects(client.login({pin:'004321'}),{code:'staff-access/cancellation-pending'});assert.equal(calls,0);
});
test('normal login deadline and account/device/view races cannot send a late PIN or show a late profile',async()=>{
 const token=deferred(),h=transport();h.user.getIdToken=()=>token.promise;const pending=h.client.login({pin:'004321'});await tick();h.auth.currentUser={uid:'another'};token.resolve('OLD_TOKEN');await assert.rejects(pending,{code:'staff-access/changed'});assert.equal(h.calls.length,0);
 const reply=deferred(),other=transport({fetcher:async()=>({ok:true,json:()=>reply.promise})});const waiting=other.client.login({pin:'004321'});await tick();other.device('DEV-OTHER-PHONE');reply.resolve({});await assert.rejects(waiting,{code:'staff-access/changed'});
 let expire;const never=deferred(),timed=transport({ensureUser:()=>never.promise,delay:fn=>{expire=fn;return 1;},cancelDelay(){}});const loading=timed.client.login({pin:'004321'});await tick();await assert.rejects(timed.client.login({pin:'004321'}),{code:'staff-access/busy'});expire();await assert.rejects(loading,{code:'staff-access/timeout'});never.resolve(timed.user);await tick();assert.equal(timed.calls.length,0);
});
test('private change-PIN uses a separate approved private token and validates its exact acknowledged version',async()=>{
 let route,request;const h=transport({fetcher:async(url,options)=>{route=url;request=options;return{ok:true,json:async()=>({schemaVersion:1,staffId,version:3,changed:true,alreadySaved:false})};}}),privateUser={uid:'private-approved',isAnonymous:true,getIdToken:async()=>'PRIVATE_TOKEN'};
 const result=await h.client.changePin({staffId,newPin:'987654',operationId:'sample-operation',expectedVersion:2,createPrivateClient:async()=>({auth:{currentUser:privateUser}})});assert.equal(result.version,3);assert.equal(route,STAFF_ACCESS_ENDPOINT+'/change-staff-pin');assert.equal(request.headers.Authorization,'Bearer PRIVATE_TOKEN');assert.deepEqual(JSON.parse(request.body),{staffId,newPin:'987654',operationId:'sample-operation',expectedVersion:2,deviceId});
});
function privateProfile(){
 const h=firestoreHarness(),user={uid:'private-approved',isAnonymous:true},auth={currentUser:user},identity={staffId};
 const config={enabled:true,policyVersion:2,brokerEndpoint:'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'};h.put('staff_document_config/current',config);h.put('staff_document_devices/'+user.uid,{uid:user.uid,staffId,active:true,branch:profile.branch});h.put('cashiers/'+staffId,{...profile,pin:'004321',hourlyRate:450,phone:'SAMPLE_PHONE'});
 const snapshot=ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}});h.api.getDocFromServer=async ref=>snapshot(ref);const client={auth,db:h.api.db,sdk:h.api};
 const access=createStaffPrivateProfileAccess({identity:()=>identity.staffId,createPrivateClient:async()=>client});return{h,auth,user,access,client,identity};
}
test('private self-profile returns actual fresh snapshots and limits contact updates without PIN/salary/role writes',async()=>{
 const f=privateProfile(),snap=await f.access.read(staffId);assert.equal(snap.id,staffId);assert.equal(snap.data().phone,'SAMPLE_PHONE');await f.access.update(staffId,{phone:'NEW_SAMPLE_PHONE',scheduleNickname:'Sample Nick'});assert.equal(f.h.get('cashiers/'+staffId).phone,'NEW_SAMPLE_PHONE');
 for(const patch of [{pin:'1234'},{hourlyRate:0},{branch:'Other'},{role:'Owner'},{staffId:'other'},{payslipPin:{hash:'new'}}])await assert.rejects(async()=>f.access.update(staffId,patch));assert.equal(f.h.get('cashiers/'+staffId).hourlyRate,450);
});
test('private profile fails closed for changed identity/auth, revoked policy/binding and managed PIN changes',async()=>{
 const f=privateProfile();await assert.rejects(f.access.read('other'));f.h.put('staff_document_config/current',{enabled:false});await assert.rejects(f.access.read(staffId));
 const g=privateProfile();g.h.put('staff_document_devices/'+g.user.uid,{uid:g.user.uid,staffId:'other',active:true,branch:profile.branch});await assert.rejects(g.access.read(staffId));
 const managed=privateProfile();managed.h.put('cashiers/'+staffId,{...profile,payslipPinManaged:true});await assert.rejects(managed.access.update(staffId,{payslipPin:{sample:'verifier'}},{allowPayslipPin:true}));
 const late=privateProfile(),pending=deferred(),read=late.client.sdk.getDocFromServer;late.client.sdk.getDocFromServer=async ref=>{if(ref.path.startsWith('cashiers/'))await pending.promise;return read(ref);};const waiting=late.access.read(staffId);await tick();late.auth.currentUser={uid:'other'};pending.resolve();await assert.rejects(waiting);
});
function proofApi({bad={},clock='2030-01-01T15:00:00+08:00'}={}){
 const h=firestoreHarness(),actor={uid,deviceId,app:'staff',sessionId:'sample-session-id'},now=()=>new Date(clock);let verifications=0;
 h.api.staffProfileCollection='staff_directory';h.api.staffPinActor=()=>({...actor});h.put('staff_directory/'+staffId,{...profile,profileRevision:'sample-version'});
 h.api.getDocFromServer=async ref=>({exists:()=>h.docs.has(ref.path),data:()=>h.get(ref.path),metadata:{fromCache:false,hasPendingWrites:false}});
 h.api.verifyStaffPin=async input=>{assert.equal(input.pin,'004321');input.assertCurrent();verifications++;const verificationId='pin-sample-'+verifications;h.put('staff_pin_verifications/'+verificationId,{schemaVersion:1,...actor,staffId,purpose:input.purpose,scope:input.scope,branch:input.branch||profile.branch,profileRevision:'sample-version',expiresAt:new Date(+now()+120000),...bad});return{schemaVersion:1,staffId,profile,branch:input.branch||profile.branch,verificationId,expiresAt:new Date(+now()+120000).toISOString()};};
 return{h,now,actor,get verifications(){return verifications;}};
}
test('protected leave service reads only safe directory and exact server PIN proof before writing its linked request',async()=>{
 const f=proofApi(),service=createStaffLeaveService(f.h.api,{getIdentity:()=>({staffId,staffName:profile.cashierName}),now:f.now});const input={id:'sample-leave',startDate:'2030-01-05',endDate:'2030-01-06',leaveType:'Personal',reason:'SAMPLE leave reason',pin:'004321'};
 await service.submit(input);const saved=f.h.get('staff_requests/'+input.id);assert.equal(saved.staffId,staffId);assert.match(saved.staffPinVerificationId,/^pin-sample-/);assert.equal(JSON.stringify(saved).includes('004321'),false);assert.equal(f.h.docs.has('cashiers/'+staffId),false);
 for(const bad of [{uid:'foreign'},{deviceId:'DEV-OTHER-PHONE'},{purpose:'purchase'},{scope:'other-request'},{expiresAt:new Date('2029-01-01')},{profileRevision:'older'}]){const wrong=proofApi({bad}),own=createStaffLeaveService(wrong.h.api,{getIdentity:()=>({staffId,staffName:profile.cashierName}),now:wrong.now});await assert.rejects(own.submit(input));assert.equal(wrong.h.docs.has('staff_requests/'+input.id),false);}
});
test('protected early-clock-out requests use safe directory and proof while normal finished clock-out adds no private grant or PIN prompt',async()=>{
 const setup=(options={})=>{const f=proofApi(options),start={id:'sample-time-in',staffId,staffName:profile.cashierName,branch:profile.branch,type:'TIME IN',timestamp:new Date('2030-01-01T09:00:00+08:00'),scheduleSnapshot:{version:1,source:'clock-in',branch:profile.branch,staffName:profile.cashierName,clockInAt:'2030-01-01T01:00:00.000Z',expectedStartAt:'2030-01-01T01:00:00.000Z',expectedEndAt:'2030-01-01T09:00:00.000Z',shiftId:'sample-slot',wasScheduled:true,needsScheduleReview:false,scheduleRevisionId:'sample-original'}};f.h.put('attendance_logs/'+start.id,start);const service=createEarlyTimeOutService(f.h.api,{now:f.now,makeToken:()=> 'sample-operation-token'});return{...f,get verifications(){return f.verifications;},start,service,input:{start,staffId,staffName:profile.cashierName,pin:'004321',assertCurrent(){}}};};
 const early=setup();await early.service.request({...early.input,reason:'Sample family appointment'});assert.equal(early.verifications,1);const saved=[...early.h.docs].find(([key])=>key.startsWith('staff_requests/'))[1];assert.match(saved.staffPinVerificationId,/^pin-/);assert.equal(JSON.stringify(saved).includes('004321'),false);
 const done=setup({clock:'2030-01-01T17:01:00+08:00'});const result=await done.service.close({...done.input,pin:undefined,attendance:{staffId,staffName:profile.cashierName,branch:profile.branch,type:'TIME OUT',timestamp:done.now()}});assert.equal(result.saved,true);assert.equal(done.verifications,0);assert.equal(done.h.docs.has('cashiers/'+staffId),false);
});
test('private payroll display helper copies remain byte identical to the reviewed Staff amounts and detail models',()=>{
 for(const file of ['staff-payslip-snapshot.js','payroll-deduction-details.js','payroll-recovery-model.js','payroll-adjustment-model.js'])assert.equal(readFileSync(new URL('../functions/cash-remittance-review/payroll-view-core/'+file,import.meta.url),'utf8'),readFileSync(new URL('../takodeal-staff/'+file,import.meta.url),'utf8'),file);
});
