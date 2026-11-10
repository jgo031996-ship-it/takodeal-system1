import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffAccessClient} from '../takodeal-staff/staff-access.js';
const now=1700000000000,staffId='synthetic-staff',privateDevice='DEV-OLD-PRIVATE',operationalDevice='DEV-NEW-OPERATIONAL',branch='Synthetic Branch';
function fixture({beforeResponse}={}){
 const user={uid:'private-uid',isAnonymous:true,getIdToken:async()=>'SYNTHETIC_PRIVATE_TOKEN'},primary={uid:'primary-uid',isAnonymous:true},auth={currentUser:primary},privateAuth={currentUser:user},binding={uid:user.uid,staffId,deviceId:privateDevice,branch,active:true},state={device:operationalDevice,reads:0},calls=[];
 const privateClient={auth:privateAuth,db:{},sdk:{doc:(_db,table,id)=>({table,id}),getDocFromServer:async ref=>{assert.equal(ref.table,'staff_document_devices');assert.equal(ref.id,user.uid);state.reads++;return{exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>({...binding})};}}};
 const client=createStaffAccessClient({auth,ensureUser:async()=>{throw Error('Never use primary authority for private RPC');},deviceId:()=>state.device,now:()=>now,fetcher:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});assert.equal(body.deviceId,privateDevice);assert.equal(options.headers.Authorization,'Bearer SYNTHETIC_PRIVATE_TOKEN');await beforeResponse?.({binding,state,auth,privateAuth,user});const result=url.endsWith('/staff-payroll-history')?{schemaVersion:1,staffId,staffName:'Synthetic Staff',branch,asOf:new Date(now).toISOString(),records:[],held:[],complete:true}:url.endsWith('/staff-payroll-inputs')?{schemaVersion:1,staffId,asOf:new Date(now).toISOString(),complete:true,staffDeductions:[],staffBonuses:[]}:url.endsWith('/staff-payroll-acknowledge')?{schemaVersion:1,staffId,recordId:'paid-record',acknowledged:true,alreadySaved:false}:{schemaVersion:1,staffId,version:1,changed:true,alreadySaved:false};return{ok:true,status:200,json:async()=>result};}});
 const invoke=kind=>client[kind]({staffId,createPrivateClient:async()=>privateClient,...(kind==='changePin'?{newPin:'1234',operationId:'synthetic-operation',expectedVersion:0}:kind==='acknowledgePayroll'?{recordId:'paid-record',signatureBase64:'data:image/png;base64,SYNTHETIC',expectedFingerprint:'a'.repeat(64),operationId:'synthetic-operation'}:{})});
 return{client,binding,auth,privateAuth,user,state,calls,invoke};
}
test('private payroll, inputs, ACK and private daily-PIN change preserve the approved private ID after operational activation',async()=>{
 for(const kind of ['payroll','payrollInputs','acknowledgePayroll','changePin']){const f=fixture();await f.invoke(kind);assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.deviceId,privateDevice);assert.equal(f.binding.deviceId,privateDevice);assert.equal(f.state.device,operationalDevice);assert.equal(f.privateAuth.currentUser,f.user);assert.equal(f.state.reads,3);}
});
test('missing/foreign/revoked private binding cannot fall back to the generated operational phone',async()=>{
 for(const patch of[{uid:'foreign'},{staffId:'foreign'},{active:false},{deviceId:''}]){const f=fixture();Object.assign(f.binding,patch);await assert.rejects(f.invoke('payroll'));assert.equal(f.calls.length,0);assert.equal(f.state.device,operationalDevice);}
});
test('binding, private UID, primary account or operational-ID change during a private response rejects its late acknowledgment',async()=>{
 for(const change of[f=>{f.binding.deviceId='DEV-OTHER-PRIVATE';},f=>{f.binding.active=false;},f=>{f.privateAuth.currentUser={...f.user};},f=>{f.auth.currentUser={uid:'different-primary'};},f=>{f.state.device='DEV-OTHER-OPERATIONAL';}]){const f=fixture({beforeResponse:change});await assert.rejects(f.invoke('payrollInputs'));assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.deviceId,privateDevice);}
});


test('normal initial anonymous sign-in still establishes its primary identity rather than requiring a pre-existing account',async()=>{
 const auth={currentUser:null},user={uid:'new-primary',isAnonymous:true,getIdToken:async()=>'SYNTHETIC_PRIMARY_TOKEN'},sessionId='new-primary-session-0001';const client=createStaffAccessClient({auth,ensureUser:async({guard})=>{guard();auth.currentUser=user;return user;},deviceId:()=>operationalDevice,storage:{length:0,key(){},setItem(){},removeItem(){}},makeSessionId:()=>sessionId,now:()=>now,fetcher:async()=>({ok:true,status:200,json:async()=>({schemaVersion:1,staffId,profile:{staffId,cashierName:'Synthetic Staff',branch,active:true},branch,sessionId,sessionExpiresAt:new Date(now+60000).toISOString()})})});const result=await client.login({pin:'CrewAlpha'});assert.equal(result.staffId,staffId);assert.equal(auth.currentUser,user);
});
