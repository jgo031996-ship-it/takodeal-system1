import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildHQAccessIndex} from '../functions/cash-remittance-review/company-access-index.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.STAFF_DOCUMENT_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),{doc,setDoc}=req('firebase/firestore'),{ref,uploadBytes,getMetadata,getDownloadURL,updateMetadata,deleteObject,listAll}=req('firebase/storage');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8788'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9798')throw Error('Run the dedicated isolated Storage launcher.');
let env;const projectId='demo-security-private-uploads',bytes=Uint8Array.from([255,216,255,224,1]),image={contentType:'image/jpeg'},uid='sample-person-phone',staffId='sample-person',sid='sample-session-nonce-1234',branch='Sample Branch';
const anonymous=id=>env.authenticatedContext(id,{firebase:{sign_in_provider:'anonymous'}}),owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}});
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8788,rules:"rules_version='2';service cloud.firestore{match /databases/{database}/documents{match /{doc=**}{allow read,write:if false;}}}"},storage:{host:'127.0.0.1',port:9798,rules:readFileSync(new URL('../docs/staff-document-storage.rules.snippet',import.meta.url),'utf8')}});});
beforeEach(async()=>env.clearFirestore());after(async()=>env?.cleanup());
const put=(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
async function staff(){await put('cashiers/'+staffId,{cashierName:'SAMPLE Staff',branch,active:true});await put('staff_login_sessions/'+uid,{schemaVersion:1,uid,staffId,deviceId:'DEV-SAMPLE-PHONE',sessionId:sid,app:'staff',branch,expiresAt:new Date(Date.now()+3600000)});}
async function rider(){await put('riders/sample-rider',{status:'Active',riderPinManaged:true,riderAuthRevision:1});await put('rider_login_sessions/'+uid,{schemaVersion:1,uid,riderId:'sample-rider',sessionId:sid,riderAuthRevision:1,expiresAt:new Date(Date.now()+3600000)});}
let sequence=0;const filename=()=>String(++sequence)+'.jpg';
test('public images remain readable but unauthenticated/customer writes and private root listing are denied',async()=>{
 const target='menu_images/'+filename();await assertSucceeds(uploadBytes(ref(owner().storage(),target),bytes,image));await assertSucceeds(getMetadata(ref(env.unauthenticatedContext().storage(),target)));await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'menu_images/'+filename()),bytes,image));await assertFails(uploadBytes(ref(anonymous('unapproved').storage(),'expenses/'+filename()),bytes,image));await assertFails(listAll(ref(env.unauthenticatedContext().storage(),'hr_evidence')));
});
test('private document broker prefix stays denied even to the Owner and operational phones',async()=>{
 for(const ctx of [owner(),anonymous(uid),env.unauthenticatedContext()]){const target=ref(ctx.storage(),'staff_private_documents/sample/file.jpg');await assertFails(uploadBytes(target,bytes,image));await assertFails(getMetadata(target));await assertFails(updateMetadata(target,{customMetadata:{firebaseStorageDownloadTokens:'forged'}}));}
});
test('own Staff request/profile uploads require exact UID/staff metadata, valid grant and immutable image bytes',async()=>{
 await staff();for(const prefix of ['staff_requests','staff_profiles']){const path=prefix+'/'+uid+'/'+staffId+'/'+filename(),target=ref(anonymous(uid).storage(),path),metadata={...image,customMetadata:{staffUploadUid:uid,staffId}};await assertSucceeds(uploadBytes(target,bytes,metadata));await assertSucceeds(getMetadata(target));await assertFails(uploadBytes(target,bytes,metadata));await assertFails(deleteObject(target));await assertFails(getMetadata(ref(anonymous('foreign').storage(),path)));await assertFails(uploadBytes(ref(anonymous(uid).storage(),prefix+'/'+uid+'/other/'+filename()),bytes,{...image,customMetadata:{staffUploadUid:uid,staffId:'other'}}));}
 await put('cashiers/'+staffId,{cashierName:'SAMPLE Staff',branch,active:false});await assertFails(uploadBytes(ref(anonymous(uid).storage(),'staff_profiles/'+uid+'/'+staffId+'/'+filename()),bytes,{...image,customMetadata:{staffUploadUid:uid,staffId}}));
});
test('prelogin clock proof for a selected person can save only that person’s request photo before its expiry',async()=>{
 await put('staff_pin_contexts/'+uid+'_time-clock',{uid,staffId,purpose:'time-clock',expiresAt:new Date(Date.now()+120000)});const metadata={...image,customMetadata:{staffUploadUid:uid,staffId}};await assertSucceeds(uploadBytes(ref(anonymous(uid).storage(),'staff_requests/'+uid+'/'+staffId+'/'+filename()),bytes,metadata));await assertFails(uploadBytes(ref(anonymous(uid).storage(),'staff_profiles/'+uid+'/'+staffId+'/'+filename()),bytes,metadata));await put('staff_pin_contexts/'+uid+'_time-clock',{uid,staffId,purpose:'time-clock',expiresAt:new Date(0)});await assertFails(uploadBytes(ref(anonymous(uid).storage(),'staff_requests/'+uid+'/'+staffId+'/'+filename()),bytes,metadata));
});
test('Rider registration photo ownership cannot overwrite another application or bypass MIME/hash constraints',async()=>{
 const registrationId='sample-registration-0001',path='riders/licenses/'+registrationId+'.jpg',metadata={...image,customMetadata:{riderRegistrationUid:uid,riderRegistrationId:registrationId,sha256:'a'.repeat(64)}};await assertSucceeds(uploadBytes(ref(anonymous(uid).storage(),path),bytes,metadata));await assertSucceeds(getMetadata(ref(anonymous(uid).storage(),path)));await assertFails(getMetadata(ref(anonymous('other').storage(),path)));await assertFails(uploadBytes(ref(anonymous(uid).storage(),path),bytes,metadata));await assertFails(uploadBytes(ref(anonymous(uid).storage(),'riders/selfies/bad.jpg'),bytes,{...metadata,contentType:'image/svg+xml'}));
});
test('registration preserves8MiB contract while operational photos remain capped5MiB',async()=>{
 const registrationId='sample-large-registration-0001',metadata={...image,customMetadata:{riderRegistrationUid:uid,riderRegistrationId:registrationId,sha256:'b'.repeat(64)}},target=ref(anonymous(uid).storage(),'riders/licenses/'+registrationId+'.jpg');await assertSucceeds(uploadBytes(target,new Uint8Array(6*1024*1024),metadata));assert.equal((await getMetadata(target)).size,6*1024*1024);await assertFails(uploadBytes(ref(anonymous(uid).storage(),'riders/orcr/'+registrationId+'.jpg'),new Uint8Array(8*1024*1024+1),metadata));await staff();await assertFails(uploadBytes(ref(anonymous(uid).storage(),'staff_requests/'+uid+'/'+staffId+'/'+filename()),new Uint8Array(6*1024*1024),{...image,customMetadata:{staffUploadUid:uid,staffId}}));
});
test('Rider delivery/topup evidence is bound to the current UID/session/revision, immutable, and inaccessible to another Rider',async()=>{
 await rider();const metadata={...image,customMetadata:{riderUploadUid:uid,riderId:'sample-rider',riderSessionId:sid}};for(const prefix of ['riders/topups','deliveries/proofs']){const path=prefix+'/'+uid+'/'+sid+'/sample-order/sample-operation/'+filename(),target=ref(anonymous(uid).storage(),path);await assertSucceeds(uploadBytes(target,bytes,metadata));await assertSucceeds(getMetadata(target));await assertFails(uploadBytes(target,bytes,metadata));await assertFails(getMetadata(ref(anonymous('other').storage(),path)));}
 await put('riders/sample-rider',{status:'Active',riderPinManaged:true,riderAuthRevision:2});await assertFails(uploadBytes(ref(anonymous(uid).storage(),'riders/topups/'+uid+'/'+sid+'/sample-order/op/'+filename()),bytes,metadata));
});
test('a deleted Rider immediately loses operational-file access despite unchanged status, credential revision and old session',async()=>{
 await rider();const path='riders/topups/'+uid+'/'+sid+'/sample-order/sample-operation/'+filename(),metadata={...image,customMetadata:{riderUploadUid:uid,riderId:'sample-rider',riderSessionId:sid}},target=ref(anonymous(uid).storage(),path);await assertSucceeds(uploadBytes(target,bytes,metadata));await put('riders/sample-rider',{status:'Active',riderPinManaged:true,riderAuthRevision:1,deleted:true});await assertFails(getMetadata(target));await assertFails(uploadBytes(ref(anonymous(uid).storage(),'deliveries/proofs/'+uid+'/'+sid+'/sample-order/op/'+filename()),bytes,metadata));
});
test('HQ global-all source/index may create public catalog images but cannot read or create generic private business files',async()=>{
 const email='sample-hq@example.test',profile={email,role:'Manager',active:true,permissions:['all'],assignedBranch:['All']},index=buildHQAccessIndex([{id:'sample-hq',data:profile}])[0],ctx=env.authenticatedContext('sample-hq',{email,email_verified:true,firebase:{sign_in_provider:'google.com'}});await put('hq_managers/sample-hq',profile);await put('hq_account_index/'+email,index);await put('hq_email_access/'+email,{active:false,permissions:[],allowedBranches:[]});const publicPath='inventory_images/'+filename();await assertSucceeds(uploadBytes(ref(ctx.storage(),publicPath),bytes,image));for(const root of ['expenses','waste_proofs','sop_proofs','owner_records','government_permits']){const path=root+'/'+filename();await assertSucceeds(uploadBytes(ref(owner().storage(),path),bytes,image));await assertFails(getMetadata(ref(ctx.storage(),path)));await assertFails(uploadBytes(ref(ctx.storage(),root+'/'+filename()),bytes,image));}
 for(const patch of [{status:'Terminated'},{employmentStatus:'Inactive'},{contractStatus:'offboarded'},{offboarded:true},{permissions:['menu']},{role:'Co-Owner'}]){await put('hq_managers/sample-hq',{...profile,...patch});await assertFails(uploadBytes(ref(ctx.storage(),'menu_images/'+filename()),bytes,image));}
});
test('branch-only and partial-permission HQ indexes cannot acquire generic global upload rights',async()=>{
 for(const [n,permissions,assignedBranch]of [['branch',['all'],['Sample Branch']],['partial',['menu'],['All']]]){const email=n+'@example.test',profile={email,role:'Manager',active:true,permissions,assignedBranch},index=buildHQAccessIndex([{id:n,data:profile}])[0],ctx=env.authenticatedContext(n,{email,email_verified:true,firebase:{sign_in_provider:'google.com'}});await put('hq_managers/'+n,profile);await put('hq_account_index/'+email,index);await assertFails(uploadBytes(ref(ctx.storage(),'menu_images/'+filename()),bytes,image));await assertFails(uploadBytes(ref(ctx.storage(),'expenses/'+filename()),bytes,image));}
});
const hqGoogle=(id='sample-hq-uploader',verified=true,provider='google.com')=>env.authenticatedContext(id,{email:'sample-hq@example.test',email_verified:verified,firebase:{sign_in_provider:provider}});
async function hqGrant({purpose='request-proof',extra={}}={}){
 const uid='sample-hq-uploader',grantId='hq-grant-'+(++sequence),file=filename(),path='hq_business_files/'+uid+'/'+grantId+'/'+file,grant={schemaVersion:1,uid,path,purpose,branch,mime:'image/jpeg',size:bytes.length,sha256:'c'.repeat(64),expiresAt:new Date(Date.now()+240000),...extra},metadata={...image,customMetadata:{hqUploadUid:uid,hqUploadGrantId:grantId,sha256:grant.sha256}};await put('hq_upload_grants/'+grantId,grant);return{uid,grantId,file,path,grant,metadata};
}
test('each explicit HQ business purpose uses one exact private image grant and recovers missing-object/lost-upload acknowledgments',async()=>{
 for(const purpose of ['request-proof','discipline-evidence','inventory-photo','waste-proof']){
  const f=await hqGrant({purpose}),target=ref(hqGoogle().storage(),f.path);await assert.rejects(getMetadata(target),error=>error.code==='storage/object-not-found');
  await assertSucceeds(uploadBytes(target,bytes,f.metadata));const saved=await assertSucceeds(getMetadata(target));assert.equal(saved.size,bytes.length);assert.equal(saved.customMetadata.hqUploadGrantId,f.grantId);
  await assertFails(uploadBytes(target,bytes,f.metadata));await assertFails(updateMetadata(target,{customMetadata:{sha256:'d'.repeat(64)}}));await assertFails(deleteObject(target));await assertFails(listAll(ref(hqGoogle().storage(),'hq_business_files/'+f.uid+'/'+f.grantId)));
 }
});
test('HQ grant uploads reject foreign or unverified identity, path/MIME/size/hash changes, unapproved metadata and generic Owner bypass',async()=>{
 const f=await hqGrant();for(const ctx of [env.unauthenticatedContext(),hqGoogle('foreign-hq'),hqGoogle(f.uid,false),hqGoogle(f.uid,true,'password'),owner()])await assertFails(uploadBytes(ref(ctx.storage(),f.path),bytes,f.metadata));
 for(const [label,path,data,metadata]of [['nested path',f.path+'/nested',bytes,f.metadata],['different file',f.path+'.other',bytes,f.metadata],['MIME',f.path,bytes,{...f.metadata,contentType:'image/png'}],['size',f.path,new Uint8Array(bytes.length+1),f.metadata],['hash',f.path,bytes,{...image,customMetadata:{...f.metadata.customMetadata,sha256:'d'.repeat(64)}}],['extra visible metadata',f.path,bytes,{...image,customMetadata:{...f.metadata.customMetadata,unapprovedField:'not-authorized'}}]])await assertFails(uploadBytes(ref(hqGoogle().storage(),path),data,metadata)).catch(error=>{throw Error(label+': '+error.message,{cause:error});});
 await assertSucceeds(uploadBytes(ref(hqGoogle().storage(),f.path),bytes,f.metadata));await assertFails(getMetadata(ref(hqGoogle('foreign-hq').storage(),f.path)));await assertFails(getMetadata(ref(owner().storage(),f.path)));
 await assertFails(uploadBytes(ref(owner().storage(),'hq_business_files/sample-owner/no-grant/'+filename()),bytes,image));
});
test('business evidence retains bearer download links: hidden reserved token metadata is not an authorization boundary or a private-document guarantee',async()=>{
 const f=await hqGrant(),target=ref(hqGoogle().storage(),f.path),metadata={...image,customMetadata:{...f.metadata.customMetadata,firebaseStorageDownloadTokens:'synthetic-capability-token'}};await assertSucceeds(uploadBytes(target,bytes,metadata));
 await assertFails(getMetadata(ref(env.unauthenticatedContext().storage(),f.path)));await assertFails(getMetadata(ref(hqGoogle('foreign-hq').storage(),f.path)));
 const url=await getDownloadURL(target),parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.port,'9798');
 const read=async()=>{const result=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(result.status,200);assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);};await read();
 await put('hq_upload_grants/'+f.grantId,{...f.grant,expiresAt:new Date(0)});await assertFails(getMetadata(target));await read();
 // The separate staff_private_documents prefix still denies every direct SDK
 // read/write even for Owner; its broker does not issue these bearer URLs.
});
test('missing, expired, overly long, malformed or revoked HQ upload grants hold both creation and existing-object SDK access',async()=>{
 const f=await hqGrant(),target=ref(hqGoogle().storage(),f.path);await assertSucceeds(uploadBytes(target,bytes,f.metadata));
 for(const patch of [{expiresAt:new Date(0)},{expiresAt:new Date(Date.now()+3600000)},{uid:'foreign-hq'},{schemaVersion:2},{purpose:'arbitrary-private-root'},{path:f.path+'.wrong'},{mime:'image/svg+xml'},{size:5*1024*1024+1},{sha256:'bad'}]){await put('hq_upload_grants/'+f.grantId,{...f.grant,...patch});await assertFails(getMetadata(target));await assertFails(uploadBytes(ref(hqGoogle().storage(),f.path),bytes,f.metadata));}
 await assertFails(uploadBytes(ref(hqGoogle().storage(),'hq_business_files/'+f.uid+'/missing/'+filename()),bytes,f.metadata));
});
