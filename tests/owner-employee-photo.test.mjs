import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {prepareEmployeePhoto,installEmployeePhoto} from '../takodeal-manager/employee-photo.js';
import {dailyStaffRate,staffProfileOperation,saveStaffProfileAtomic} from '../takodeal-manager/staff-rate-changes.js';
import {normalizeStaffMessengerUrl} from '../takodeal-manager/staff-messenger-link.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {ReviewDocument,deferred,tick} from './helpers/review-dom.mjs';
const PHOTO='data:image/jpeg;base64,/9j/AAAA',owner='jgo031996@gmail.com',branch='Sample Branch';
function fixture({prepare=async()=>PHOTO}={}){
 const document=new ReviewDocument(),nodes={},create=document.createElement.bind(document);document.createElement=tag=>{const node=create(tag);node.style={};return node;};
 for(const id of ['profileImageInput','masterProfilePic','empBranchAssign','empProfileId','employeeProfileModal','btnSaveEmpProfile']){const node=document.createElement('div');node.id=id;node.style={};document.body.append(node);nodes[id]=node;}
 nodes.empBranchAssign.value=branch;nodes.empProfileId.value='sample';nodes.employeeProfileModal.style.display='flex';nodes.masterProfilePic.src='original';
 const api={auth:{currentUser:{uid:'owner',email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'owner',email:owner,isOwner:true,permissions:['all'],allowedBranches:[branch]},staffProfileFormGeneration:1,isBranchAllowed:value=>api.sessionUser.allowedBranches.includes(value)};
 const ui=installEmployeePhoto(api,document,{prepare});return {api,document,nodes,ui,choose:()=>api.previewProfileImage({target:{files:[{name:'sample.jpg'}],value:'selected'}})};
}
const jpegFile=()=>new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'});
test('photo decoding re-encodes a bounded local JPEG and releases the decoded image without fetching a URL',async()=>{
 let closed=0,drawn,dimensions;const canvas={getContext:()=>({fillRect(){},drawImage:(...args)=>drawn=args}),toDataURL:(type)=>{assert.equal(type,'image/jpeg');dimensions=[canvas.width,canvas.height];return PHOTO;}};
 assert.equal(await prepareEmployeePhoto(jpegFile(),{createImageBitmap:async()=>({width:1600,height:1200,close(){closed++;}}),document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}}),PHOTO);
 assert.deepEqual(dimensions,[640,480]);assert.equal(drawn[3],640);assert.equal(closed,1);
});
test('unsupported, spoofed and oversized uploads are refused before decoding',async()=>{
 let calls=0;const options={createImageBitmap:async()=>{calls++;}};
 for(const file of [new Blob(['<svg/>'],{type:'image/svg+xml'}),new Blob(['not a JPEG'],{type:'image/jpeg'}),{type:'image/png',size:9*1024*1024}])await assert.rejects(prepareEmployeePhoto(file,options),/photo|image|JPEG/i);
 assert.equal(calls,0);
});
test('oversized decoded dimensions and oversized or non-JPEG encoder results cannot enter a profile',async()=>{
 await assert.rejects(prepareEmployeePhoto(jpegFile(),{createImageBitmap:async()=>({width:10000,height:10000,close(){}})}),/20 million/);
 for(const result of ['https://attacker.invalid/photo','data:image/svg+xml,<svg/>','data:image/jpeg;base64,/9j/'+'A'.repeat(180000)])await assert.rejects(prepareEmployeePhoto(jpegFile(),{createImageBitmap:async()=>({width:1,height:1,close(){}}),document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=>result})}}),/too large/);
});
test('a decoding timeout also releases a bitmap that finishes late',async()=>{
 const gate=deferred();let closed=0;await assert.rejects(prepareEmployeePhoto(jpegFile(),{createImageBitmap:()=>gate.promise,timeoutMs:1}),/too long/);gate.resolve({width:1,height:1,close(){closed++;}});await tick();assert.equal(closed,1);
});
test('a prepared photo previews locally and is supplied only to the current profile save',async()=>{
 const f=fixture();assert.equal(await f.choose(),true);assert.equal(f.nodes.masterProfilePic.src,PHOTO);assert.deepEqual(f.ui.capture(),{profilePicUrl:PHOTO});assert.match(f.document.getElementById('employeePhotoStatus').textContent,/Save the profile/);f.ui.reset();assert.deepEqual(f.ui.capture(),{});
});
test('pending preparation blocks Save and late results cannot enter another form, account or branch',async()=>{
 for(const change of ['form','account','session','scope','closed']){const gate=deferred(),f=fixture({prepare:()=>gate.promise}),pending=f.choose();assert.throws(()=>f.ui.capture(),/finish preparing/);
  if(change==='form'){f.api.staffProfileFormGeneration++;f.nodes.empProfileId.value='other';f.ui.reset();}
  if(change==='account')f.api.auth.currentUser={...f.api.auth.currentUser};
  if(change==='session')f.api.sessionUser={...f.api.sessionUser};
  if(change==='scope')f.api.sessionUser.allowedBranches=[];
  if(change==='closed')f.nodes.employeeProfileModal.style.display='none';
  gate.resolve(PHOTO);assert.equal(await pending,false);assert.equal(f.nodes.masterProfilePic.src,'original');assert.deepEqual(f.ui.capture(),{});
 }
});
test('a newer selected photo owns the result and a replaced account cannot save an earlier prepared photo',async()=>{
 const first=deferred(),second=deferred();let calls=0;const f=fixture({prepare:()=>++calls===1?first.promise:second.promise}),old=f.choose(),next=f.choose();second.resolve(PHOTO);assert.equal(await next,true);first.resolve(PHOTO+'AAAA');assert.equal(await old,false);assert.equal(f.nodes.masterProfilePic.src,PHOTO);f.api.auth.currentUser={...f.api.auth.currentUser};assert.throws(()=>f.ui.capture(),/earlier profile/);
});
test('unsigned, mismatched identity or revoked branch cannot prepare a photo',async()=>{
 for(const change of ['unsigned','mismatch','branch']){let prepared=0;const f=fixture({prepare:async()=>{prepared++;return PHOTO;}});if(change==='unsigned')f.api.auth.currentUser.emailVerified=false;if(change==='mismatch')f.api.sessionUser.uid='other';if(change==='branch')f.api.sessionUser.allowedBranches=[];assert.equal(await f.choose(),false);assert.equal(prepared,0);}
});
test('actual Save Data passes the prepared photo through the real atomic staff save without touching paid payroll',async()=>{
 const h=firestoreHarness(),f=fixture();Object.assign(f.api,h.api);f.api.auth={currentUser:{uid:'owner',email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}};f.api.sessionUser={uid:'owner',email:owner,isOwner:true,permissions:['all'],allowedBranches:[branch]};
 h.put('hq_managers/owner',{email:owner,role:'Owner',pin:'1234',permissions:['all'],assignedBranch:'All'});const old={cashierName:'Sample Staff',branch,role:'Crew',hourlyRate:450,pin:'1111',empId:'SAMPLE',profilePicUrl:'old-photo'};h.put('cashiers/sample',old);h.put('payroll_records/paid',{finalNetPay:4500,frozenData:{name:'Sample Staff',isPaid:true}});const paid=structuredClone(h.get('payroll_records/paid'));
 const node=id=>{let n=f.document.getElementById(id);if(!n){n=f.document.createElement('input');n.id=id;n.style={};f.document.body.append(n);}return n;};
 for(const [id,value]of Object.entries({empFullName:'Sample Staff',empHourlyRate:'450',empRole:'Crew',empPin:'1111',profEmpId:'SAMPLE',empRateEffectiveDate:'2026-11-08',empProfileId:'sample',empBranchAssign:branch}))node(id).value=value;
 Object.assign(f.api,{globalStaffData:{sample:old},staffProfileBaseline:{id:'sample',exists:true,rate:450,rateRevision:null},ManagerUI:{notify:message=>assert.fail(message)},loadHRModule(){}});
 assert.equal(await f.choose(),true);const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),from=main.indexOf('window.saveEmployeeProfile ='),fn=main.slice(from,main.indexOf('\n};',from)+3),alerts=[];
 vm.runInNewContext(fn,{window:f.api,document:{getElementById:node,querySelectorAll:()=>[]},dailyStaffRate,staffProfileOperation,saveStaffProfileAtomic,normalizeStaffMessengerUrl,Swal:{fire:(...args)=>alerts.push(args)},console});await f.api.saveEmployeeProfile();assert.equal(h.get('cashiers/sample').profilePicUrl,PHOTO);assert.deepEqual(h.get('payroll_records/paid'),paid);assert.equal(node('employeeProfileModal').style.display,'none');assert.ok(alerts.some(([row])=>row?.icon==='success'));
});
