// Actual client transports + server core, atomic in-memory database, fake tokens.
// No Firebase/cloud calls and no real staff/code/device records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStaffDeviceSetup,PRODUCTION_ORIGINS} from '../functions/staff-device-setup/service.mjs';
import {createSetupOwnerClient,generateStaffSetupCode} from '../takodeal-manager/staff-setup-codes.js';
import {createStaffSetupTransport,createStaffSetupAuthority} from '../takodeal-staff/staff-setup-access.js';

function fixture(){
 const data=new Map([['cashiers/sample-one',{cashierName:'SAMPLE Crew One',branch:'SAMPLE Maa',status:'Active',pin:'SAMPLE-LOGIN'}],['cashiers/sample-two',{cashierName:'SAMPLE Crew Two',branch:'SAMPLE Maa',status:'Active',pin:'SAMPLE-OTHER'}]]);
 let tail=Promise.resolve(),clock=1792900000000;
 const store={transaction(callback){const run=tail.then(async()=>{const writes=[];let wrote=false;const result=await callback({async get(p){if(wrote)throw Error('Read after write');return data.has(p)?structuredClone(data.get(p)):null;},set(p,v){wrote=true;writes.push(['set',p,structuredClone(v)]);},delete(p){wrote=true;writes.push(['delete',p]);}});for(const [action,p,value]of writes)action==='set'?data.set(p,value):data.delete(p);return result;});tail=run.catch(()=>{});return run;}};
 const actors=new Map(),ownerToken='sample-owner-token-with-more-than-20-chars';actors.set(ownerToken,{uid:'sample-owner',email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}});
 const handle=createStaffDeviceSetup({verifyToken:async(token,revoked)=>{assert.equal(revoked,true);if(!actors.has(token))throw Error('Invalid sample token');return actors.get(token);},store,now:()=>clock++});
 let loseReply=null;
 const fetcher=origin=>async(url,options)=>{const route=new URL(url).pathname.split('/').at(-1),body=JSON.parse(options.body),result=await handle({method:options.method,path:'/'+route,query:{},origin,contentType:options.headers['Content-Type'],authorization:options.headers.Authorization,rawSize:Buffer.byteLength(options.body),body,trustedIP:'127.0.0.1'});if(loseReply===route&&result.status===200){loseReply=null;throw Error('SAMPLE response lost after server commit');}return{ok:result.status>=200&&result.status<300,status:result.status,json:async()=>structuredClone(result.body)};};
 const ownerUser={uid:'sample-owner',email:'jgo031996@gmail.com',emailVerified:true,getIdToken:async()=>ownerToken},owner=createSetupOwnerClient({auth:{currentUser:ownerUser}},{fetcher:fetcher(PRODUCTION_ORIGINS[1])});
 function phone(uid='sample-phone-one'){
  const token='sample-phone-token-'+uid+'-more-than-20-chars';actors.set(token,{uid,firebase:{sign_in_provider:'anonymous'}});
  const user={uid,getIdToken:async()=>token},auth={currentUser:user},transport=createStaffSetupTransport({auth,ensureUser:async()=>user,fetcher:fetcher(PRODUCTION_ORIGINS[0])}),authority=createStaffSetupAuthority({transport,getUid:()=>auth.currentUser?.uid,now:()=>clock});
  return {transport,authority,uid};
 }
 const issue=(code,expectedVersion=0,operationId=randomUUID())=>({staffId:'sample-one',code,expectedVersion,operationId});
 const activation=(code,deviceId='DEV-SAMPLE-PHONE-ONE',operationId=randomUUID())=>({staffId:'sample-one',code,deviceId,deviceName:'SAMPLE crew phone',operationId});
 async function enable(){return owner('policy',{enabled:true,expectedRevision:0,operationId:randomUUID()});}
 return{data,owner,phone,issue,activation,enable,lose:route=>{loseReply=route;}};
}

test('Owner-issued code activates a bound phone automatically and cannot switch employee account',async()=>{
 const f=fixture(),code=generateStaffSetupCode(),phone=f.phone();
 assert.deepEqual(await f.owner('config',{}),{enabled:false,revision:0,protocolVersion:1,deviceLimit:2});
 assert.equal((await f.owner('issue-code',f.issue(code))).version,1);await f.enable();
 const payload=f.activation(code);assert.equal((await phone.authority.confirm(payload.deviceId)).device,null);
 const activated=await phone.transport.call('/activate',payload);assert.equal(activated.device.status,'Active');
 await phone.authority.confirm(payload.deviceId);assert.equal(phone.authority.assertStaff('sample-one'),true);assert.throws(()=>phone.authority.assertStaff('sample-two'),/different staff/);
 assert.equal(f.data.get('pos_devices/'+payload.deviceId).status,'Active');
 assert.equal(f.data.get('staff_app_bindings/'+phone.uid).staffId,'sample-one');
 assert.equal(JSON.stringify(activated).includes(code),false);assert.equal(JSON.stringify(activated).includes('SAMPLE-LOGIN'),false);
});
test('wrong setup code creates no binding or approved device; valid retry activates once',async()=>{
 const f=fixture(),code=generateStaffSetupCode(),phone=f.phone();await f.owner('issue-code',f.issue(code));await f.enable();
 const payload=f.activation(code),wrong=code==='0000000000'?'9999999999':'0000000000';
 await assert.rejects(phone.transport.call('/activate',{...payload,code:wrong}));assert.equal(f.data.has('staff_app_bindings/'+phone.uid),false);assert.equal(f.data.has('pos_devices/'+payload.deviceId),false);
 await phone.transport.call('/activate',payload);await phone.transport.call('/activate',payload);
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('staff_app_bindings/')).length,1);
 assert.equal([...f.data.keys()].filter(k=>k.startsWith('pos_devices/')).length,1);
});
test('cleared app identity needs code again; disabling code blocks new activations but preserves active phone',async()=>{
 const f=fixture(),code=generateStaffSetupCode(),phone=f.phone();await f.owner('issue-code',f.issue(code));await f.enable();
 const payload=f.activation(code);await phone.transport.call('/activate',payload);
 const reset=f.phone('sample-phone-reset');assert.equal((await reset.authority.confirm('DEV-SAMPLE-RESET-PHONE')).device,null);
 await reset.transport.call('/activate',f.activation(code,'DEV-SAMPLE-RESET-PHONE'));
 await f.owner('disable-code',{staffId:'sample-one',expectedVersion:1,operationId:randomUUID()});
 assert.equal((await phone.authority.confirm(payload.deviceId)).device.status,'Active');
 await assert.rejects(f.phone('sample-third-phone').transport.call('/activate',f.activation(code,'DEV-SAMPLE-THIRD-PHONE')));
});
test('replacing setup code rejects old code for new phones while current phone remains active',async()=>{
 const f=fixture(),oldCode='1234567890',newCode='9876543210',phone=f.phone();await f.owner('issue-code',f.issue(oldCode));await f.enable();
 const payload=f.activation(oldCode);await phone.transport.call('/activate',payload);
 await f.owner('issue-code',f.issue(newCode,1));assert.equal((await phone.authority.confirm(payload.deviceId)).device.status,'Active');
 const fresh=f.phone('sample-new-phone'),next=f.activation(newCode,'DEV-SAMPLE-NEXT-PHONE');await assert.rejects(fresh.transport.call('/activate',{...next,code:oldCode}));
 assert.equal((await fresh.transport.call('/activate',next)).device.status,'Active');
});
test('blocked phone cannot replay activation and remains blocked after rollout is paused',async()=>{
 const f=fixture(),code=generateStaffSetupCode(),phone=f.phone();await f.owner('issue-code',f.issue(code));await f.enable();const payload=f.activation(code);await phone.transport.call('/activate',payload);
 await f.owner('device-action',{deviceId:payload.deviceId,action:'block',operationId:randomUUID()});
 assert.equal((await phone.authority.confirm(payload.deviceId)).device.status,'Blocked');assert.throws(()=>phone.authority.assertStaff('sample-one'));
 await assert.rejects(phone.transport.call('/activate',payload));await f.owner('policy',{enabled:false,expectedRevision:1,operationId:randomUUID()});
 const blocked=await phone.authority.confirm(payload.deviceId);assert.equal(blocked.mode,'protected');assert.equal(blocked.device.status,'Blocked');
});
test('lost server acknowledgements reuse same issuance and activation without duplicate effects',async()=>{
 const f=fixture(),code=generateStaffSetupCode(),issue=f.issue(code);f.lose('issue-code');await assert.rejects(f.owner('issue-code',issue),/response lost/);
 assert.equal((await f.owner('issue-code',issue)).version,1);await f.enable();const phone=f.phone(),payload=f.activation(code);f.lose('activate');
 await assert.rejects(phone.transport.call('/activate',payload),/response lost/);assert.equal((await phone.transport.call('/activate',payload)).device.status,'Active');
 assert.equal(f.data.get('staff_setup_credentials/sample-one').version,1);assert.equal([...f.data.keys()].filter(k=>k.startsWith('staff_app_bindings/')).length,1);
});
test('stale issuance and policy acknowledgements cannot misreport newer Owner decisions',async()=>{
 const f=fixture(),first=f.issue('1234567890');await f.owner('issue-code',first);await f.owner('issue-code',f.issue('9876543210',1));
 await assert.rejects(f.owner('issue-code',first),/changed|Refresh|refresh/);
 const enable={enabled:true,expectedRevision:0,operationId:randomUUID()};await f.owner('policy',enable);await f.owner('policy',{enabled:false,expectedRevision:1,operationId:randomUUID()});
 await assert.rejects(f.owner('policy',enable),/changed|Refresh|refresh/);assert.equal((await f.owner('config',{})).enabled,false);
});
test('legacy preparation mode remains usable but never turns a public approved ID into a protected enrollment',async()=>{
 const f=fixture(),phone=f.phone(),id='DEV-SAMPLE-LEGACY-PHONE';f.data.set('pos_devices/'+id,{appType:'Staff',status:'Active',branch:'SAMPLE Maa'});
 assert.deepEqual(await phone.authority.confirm(id),{enabled:false,mode:'legacy',device:null});
 await f.owner('issue-code',f.issue('1234567890'));await f.enable();assert.equal((await phone.authority.confirm(id)).device,null);
 await assert.rejects(phone.transport.call('/activate',f.activation('1234567890',id)));
 assert.equal((await phone.transport.call('/activate',f.activation('1234567890','DEV-SAMPLE-PROTECTED-NEW'))).device.status,'Active');
});
