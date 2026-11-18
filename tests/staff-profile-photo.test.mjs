import test from 'node:test';
import assert from 'node:assert/strict';
import {adminMemory} from './helpers/admin-memory.mjs';
import {createStaffSessionStore} from '../functions/cash-remittance-review/staff-session.mjs';
import {createStaffPrivateProfileStore} from '../functions/cash-remittance-review/staff-private-profile-store.mjs';
import {createStaffPrivateProfileHandler} from '../functions/cash-remittance-review/staff-private-profile-handler.mjs';
import {validProfilePhoto} from '../functions/cash-remittance-review/profile-photo.mjs';
import {installStaffProfilePhoto} from '../takodeal-staff/staff-profile-photo.js';
import {photo} from './profile-photo-fixture.mjs';
const actor={uid:'staff-test',firebase:{sign_in_provider:'anonymous'}},scope={staffId:'employee-test',deviceId:'DEV-TEST-0001'};
async function fixture(){
 const f=adminMemory();
 f.put('cashiers/'+scope.staffId,{cashierName:'Fictional Employee',branch:'Test Branch',role:'Crew',pin:'4321',dailyRate:500,active:true});
 f.put('pos_devices/'+scope.deviceId,{appType:'Staff',status:'Active',deviceId:scope.deviceId});
 f.put('staff_document_config/current',{enabled:true,policyVersion:2,brokerEndpoint:'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'});
 f.put('staff_document_devices/'+actor.uid,{active:true,uid:actor.uid,...scope,branch:'Test Branch'});
 await createStaffSessionStore(f.db).login({...scope,pin:'4321'},actor,'test');
 f.store=createStaffPrivateProfileStore(f.db,{serverTimestamp:f.serverTimestamp});
 f.input={...scope,operationId:'photo-operation',expectedFingerprint:(await f.store.read(scope,actor)).expectedFingerprint,profilePicUrl:photo};return f;
}
test('verified photo save persists across reopening and Owner reads; lost acknowledgment retry is idempotent',async()=>{
 const f=await fixture(),before=f.get('cashiers/'+scope.staffId);
 assert.equal((await f.store.photo(f.input,actor)).saved,true);
 assert.equal((await f.store.photo(f.input,actor)).alreadySaved,true);
 assert.deepEqual(f.get('cashiers/'+scope.staffId),{...before,profilePicUrl:photo});
 assert.equal((await f.store.read({...scope,profileVersion:3},actor)).profile.profilePicUrl,photo);
 assert.equal(Object.hasOwn((await f.store.read({...scope,profileVersion:2},actor)).profile,'profilePicUrl'),false);
 assert.equal((await f.store.read({...scope,profileVersion:3},actor)).profile.dailyRate,500);
});
test('photo endpoint rejects a foreign employee, blocked device, stale revision and fields outside the photo',async()=>{
 for(const kind of ['foreign','blocked','stale','extra']){
  const f=await fixture(),input={...f.input};
  if(kind==='foreign')input.staffId='other';
  if(kind==='blocked')f.put('staff_document_devices/'+actor.uid,{active:false});
  if(kind==='stale')f.put('cashiers/'+scope.staffId,{...f.get('cashiers/'+scope.staffId),phone:'Owner update'});
  if(kind==='extra')input.pin='1234';
  await assert.rejects(f.store.photo(input,actor));assert.equal(f.get('cashiers/'+scope.staffId).profilePicUrl,undefined);
 }
});
test('photo boundary permits a bounded JPEG only; arbitrary URLs, SVG, oversized files and dimensions fail',()=>{
 assert.equal(validProfilePhoto(photo),true);
 for(const value of ['https://example.test/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=',photo+'a','data:image/jpeg;base64,'+'a'.repeat(180000),'data:image/jpeg;base64,/9j/AAAA'])assert.equal(validProfilePhoto(value),false);
 const bytes=Buffer.from(photo.split(',')[1],'base64');const frame=bytes.indexOf(Buffer.from([255,192]));assert.ok(frame>0);bytes.writeUInt16BE(641,frame+7);assert.equal(validProfilePhoto('data:image/jpeg;base64,'+bytes.toString('base64')),false);
});
test('HTTP photo route retains token, origin, exact-field, size and verified-phone boundaries',async()=>{
 const f=await fixture(),handle=createStaffPrivateProfileHandler({verifyToken:async()=>actor,store:f.store});
 const request={origin:'https://takodeal-staff.vercel.app',path:'/staff-private-profile/photo',method:'POST',contentType:'application/json',rawSize:JSON.stringify(f.input).length,body:f.input,authorization:'Bearer '+'x'.repeat(30)};
 assert.equal((await handle({...request,origin:'https://foreign.example'})).status,403);
 assert.equal((await handle({...request,authorization:''})).status,401);
 assert.equal((await handle({...request,rawSize:185001})).status,400);
 assert.equal((await handle(request)).status,200);
});
function ui({prepare=async()=>photo}={}){
 const values=new Map([['takodeal_staff_id',scope.staffId],['takodeal_device_id',scope.deviceId]]),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{display:'flex'},textContent:''});return nodes.get(id);};
 const api={localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},auth:{currentUser:{uid:actor.uid}},staffPrivateProfileUI:{refreshHead:async()=>true}};
 const calls=[],client={read:async()=>({expectedFingerprint:'a'.repeat(64),profile:{profilePicUrl:calls.length?photo:undefined}}),photo:async input=>{calls.push(input);}};
 const d={hidden:false,getElementById:node};installStaffProfilePhoto(api,d,{client,prepare,uuid:()=> 'photo-ui-operation'});
 return{api,d,node,values,calls,client,event:{target:{files:[{type:'image/jpeg'}],value:'selected'}}};
}
test('photo picker saves via verified broker once and updates avatar only after a confirmed reload',async()=>{
 const f=ui(),one=f.api.previewProfileImage(f.event),two=f.api.previewProfileImage(f.event);assert.equal(one,two);assert.equal(await one,true);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].staffId,scope.staffId);assert.equal(f.node('profilePreview').src,photo);assert.equal(f.values.get('takodeal_staff_pic'),photo);assert.match(f.node('staffProfileStatus').textContent,/photo saved/);assert.equal(f.event.target.value,'');
});
test('account changes while decoding prevent upload; failures do not show an unsaved photo',async()=>{
 let finish;const f=ui({prepare:()=>new Promise(resolve=>finish=resolve)}),task=f.api.previewProfileImage(f.event);f.values.set('takodeal_staff_id','other');finish(photo);assert.equal(await task,false);assert.equal(f.calls.length,0);assert.equal(f.values.get('takodeal_staff_pic'),undefined);
 const g=ui();g.client.photo=async()=>{throw Error('Reconnect and retry');};assert.equal(await g.api.previewProfileImage(g.event),false);assert.equal(g.node('profilePreview').src,undefined);assert.match(g.node('staffProfileStatus').textContent,/Reconnect/);
});
