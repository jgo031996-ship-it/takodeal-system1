import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.STAFF_DOCUMENT_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),{doc,setDoc,getDocFromServer}=req('firebase/firestore'),{ref,uploadBytes,getMetadata,updateMetadata,deleteObject,listAll}=req('firebase/storage');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8848'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9848')throw Error('Run only the dedicated fictional-record test launcher.');
const projectId='demo-activated-attendance',uid='sample-activated-phone',staffId='sample-staff',deviceId='DEV-SAMPLE-ACTIVATED',branch='Synthetic Branch',bytes=Uint8Array.from([255,216,255,224,1,255,217]);let env,sequence=0;
const phone=(id=uid)=>env.authenticatedContext(id,{firebase:{sign_in_provider:'anonymous'}}),owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}});
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8848,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')},storage:{host:'127.0.0.1',port:9848,rules:readFileSync(new URL('../docs/staff-document-storage.rules.snippet',import.meta.url),'utf8')}});});beforeEach(async()=>env.clearFirestore());after(async()=>env?.cleanup());
const put=(path,row)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),row));
const binding=patch=>({protocolVersion:1,uid,staffId,deviceId,staffName:'Synthetic Staff',branch,status:'Active',deviceName:'Synthetic Phone',...patch}),profile=patch=>({cashierName:'Synthetic Staff',branch,active:true,...patch});
const metadata=patch=>({contentType:'image/jpeg',customMetadata:{staffUploadUid:uid,staffId,staffUploadDeviceId:deviceId,staffUploadAuthority:'phone-activation',...patch}}),path=()=>`staff_requests/${uid}/${staffId}/activated_late_sample-${++sequence}.jpg`;
async function seed(){await put('staff_app_bindings/'+uid,binding());await put('cashiers/'+staffId,profile());}
async function legacy(){await put('staff_login_sessions/'+uid,{schemaVersion:1,uid,staffId,sessionId:'sample-session-long-enough',expiresAt:new Date(Date.now()+3600000)});await put('staff_pin_contexts/'+uid+'_time-clock',{uid,staffId,purpose:'time-clock',expiresAt:new Date(Date.now()+120000)});}
test('activated phone can create/read its exact screenshot with only protected binding plus current employee and no second approval/session',async()=>{
 await seed();const target=ref(phone().storage(),path());await assertSucceeds(uploadBytes(target,bytes,metadata()));await assertSucceeds(getMetadata(target));await assertSucceeds(getMetadata(ref(owner().storage(),target.fullPath)));
 await env.withSecurityRulesDisabled(async ctx=>{for(const table of ['staff_login_sessions','staff_document_devices','staff_pin_contexts'])assert.equal((await getDocFromServer(doc(ctx.firestore(),table,uid))).exists(),false);});
});
test('foreign users, another employee, unauthenticated callers and Google actors cannot create activated evidence',async()=>{
 await seed();for(const ctx of [phone('foreign-phone'),env.unauthenticatedContext(),owner()])await assertFails(uploadBytes(ref(ctx.storage(),path()),bytes,metadata()));
 await assertFails(uploadBytes(ref(phone().storage(),`staff_requests/${uid}/another-staff/activated_late_other.jpg`),bytes,metadata({staffId:'another-staff'})));
 const saved=path();await assertSucceeds(uploadBytes(ref(phone().storage(),saved),bytes,metadata()));await assertFails(getMetadata(ref(phone('foreign-phone').storage(),saved)));
});
test('blocking, deleting or revoking the protected binding immediately denies reads and new uploads despite valid legacy proofs',async()=>{
 for(const status of ['Blocked','Deleted','Revoked']){await seed();await legacy();const saved=path();await assertSucceeds(uploadBytes(ref(phone().storage(),saved),bytes,metadata()));await put('staff_app_bindings/'+uid,binding({status}));await assertFails(getMetadata(ref(phone().storage(),saved)));await assertFails(uploadBytes(ref(phone().storage(),path()),bytes,metadata()));}
});
test('changed home branch and all inactive lifecycle flags/statuses immediately hold activated evidence',async()=>{
 await seed();const saved=path();await assertSucceeds(uploadBytes(ref(phone().storage(),saved),bytes,metadata()));
 for(const patch of [{branch:'Other Branch'},{active:false},{isActive:false},{blocked:true},{archived:true},{isArchived:true},{deleted:true},{isDeleted:true},{revoked:true},{offboarded:true},{terminated:true},{resigned:true},{disabled:true},{status:'Inactive'},{status:'Terminated'},{status:' Blocked '},{employmentStatus:'Finished contract'},{employmentStatus:' inactive '},{contractStatus:'offboarded'},{contractStatus:' revoked '},{pin:'REVOKED'},{pin:'revoked'},{pin:' blocked '}]){await put('cashiers/'+staffId,profile(patch));await assertFails(getMetadata(ref(phone().storage(),saved)));await assertFails(uploadBytes(ref(phone().storage(),path()),bytes,metadata()));}
 await put('cashiers/'+staffId,profile({branch:' '+branch+' '}));await assertSucceeds(uploadBytes(ref(phone().storage(),path()),bytes,metadata()));
});
test('malformed/foreign binding fields and copied metadata cannot establish activated ownership',async()=>{
 await seed();for(const patch of [{uid:'foreign'},{staffId:'other'},{protocolVersion:2},{branch:'Other Branch'},{deviceId:'invalid'}]){await put('staff_app_bindings/'+uid,binding(patch));await assertFails(uploadBytes(ref(phone().storage(),path()),bytes,metadata()));}
 await put('staff_app_bindings/'+uid,binding());for(const patch of [{staffUploadUid:'foreign'},{staffId:'other'},{staffUploadDeviceId:'DEV-OTHER-PHONE'},{staffUploadAuthority:'legacy'},{arbitrary:'field'}])await assertFails(uploadBytes(ref(phone().storage(),path()),bytes,metadata(patch)));
});
test('reserved activated filenames cannot fall back to a legacy session and old flat screenshot paths remain denied',async()=>{
 await put('cashiers/'+staffId,profile());await legacy();await assertFails(uploadBytes(ref(phone().storage(),path()),bytes,metadata()));await assertFails(uploadBytes(ref(phone().storage(),`staff_requests/${uid}/${staffId}/activated_wrong.jpg`),bytes,metadata()));
 for(const ctx of [phone(),owner(),env.unauthenticatedContext()])await assertFails(uploadBytes(ref(ctx.storage(),'staff_requests/late_old-flat-'+(++sequence)+'.jpg'),bytes,metadata()));
 const legacyMetadata={contentType:'image/jpeg',customMetadata:{staffUploadUid:uid,staffId}};await assertSucceeds(uploadBytes(ref(phone().storage(),`staff_requests/${uid}/${staffId}/late_legacy-${++sequence}.jpg`),bytes,legacyMetadata));
});
test('activated uploads are immutable and MIME/size constrained, including metadata/list/delete APIs',async()=>{
 await seed();const saved=path(),target=ref(phone().storage(),saved);await assertSucceeds(uploadBytes(target,bytes,metadata()));await assertFails(uploadBytes(target,bytes,metadata()));await assertFails(updateMetadata(target,{customMetadata:{staffUploadAuthority:'other'}}));await assertFails(deleteObject(target));await assertFails(listAll(ref(phone().storage(),`staff_requests/${uid}/${staffId}`)));
 await assertFails(uploadBytes(ref(phone().storage(),path()),bytes,{...metadata(),contentType:'image/svg+xml'}));await assertFails(uploadBytes(ref(phone().storage(),path()),new Uint8Array(5*1024*1024+1),metadata()));
});
test('operational activation grants no private document/profile/payroll approval and cannot be self-created through the SDK',async()=>{
 await seed();await assertFails(setDoc(doc(phone().firestore(),'staff_app_bindings',uid),binding()));await assertFails(setDoc(doc(phone().firestore(),'staff_document_devices',uid),{uid,staffId,branch,active:true}));
 for(const ctx of [phone(),owner()])await assertFails(uploadBytes(ref(ctx.storage(),`staff_private_documents/${uid}/${staffId}/valid_id/sample.jpg`),bytes,{contentType:'image/jpeg'}));
 await assertFails(uploadBytes(ref(phone().storage(),`staff_profiles/${uid}/${staffId}/sample.jpg`),bytes,{contentType:'image/jpeg',customMetadata:{staffUploadUid:uid,staffId}}));
 await assertFails(getDocFromServer(doc(phone().firestore(),'staff_private_documents',staffId)));await assertFails(getDocFromServer(doc(phone().firestore(),'staff_payslip_previews','sample-unapproved')));
});
