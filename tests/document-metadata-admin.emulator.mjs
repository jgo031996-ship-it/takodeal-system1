import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {documentMetadataFixture,STAFF,UID,BRANCH,OWNER_TOKEN,MANAGER_TOKEN} from './helpers/document-metadata-fixture.mjs';
const host='127.0.0.1',port=8851,endpoint=host+':'+port,projectId='demo-document-metadata';
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test endpoint.');process.env.FIRESTORE_EMULATOR_HOST=endpoint;process.env.METADATA_SERVER_DETECTION='none';
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json')),admin=createRequire(resolve(root,'functions/cash-remittance-review/package.json'));
const {initializeTestEnvironment}=req('@firebase/rules-unit-testing'),{initializeApp,deleteApp,cert}=admin('firebase-admin/app'),{getFirestore,FieldValue}=admin('firebase-admin/firestore');
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');let child,env,db,app,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Occupied document metadata test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const deadline=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error(output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port}});const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});app=initializeApp({projectId,credential:cert({projectId,clientEmail:'sample@'+projectId+'.iam.gserviceaccount.com',privateKey})},'document-metadata-demo');db=getFirestore(app);db.settings({host:endpoint,ssl:false});},{timeout:45000});
after(async()=>{await db?.terminate();if(app)await deleteApp(app);await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});beforeEach(async()=>env.clearFirestore());
const fixture=()=>documentMetadataFixture({db,serverTimestamp:()=>FieldValue.serverTimestamp(),approvedAt:new Date(1700000000000),put:(path,row)=>db.doc(path).set(row),read:async path=>{const snap=await db.doc(path).get();return snap.exists?snap.data():null;}});
async function uploaded(){const f=await fixture();await f.uploadBytes();assert.equal((await f.request('upload')).status,200);return f;}
const headPath=`staff_private_documents/${STAFF}/files/valid_id`,versionPath=id=>`staff_private_documents/${STAFF}/versions/${id}`;
test('actual Admin commit creates exact16-field equal head/version once and lost acknowledgment retries without any timestamp/version rewrite',async()=>{
 const f=await fixture();await f.uploadBytes();f.lostAck=true;assert.equal((await f.request('upload')).status,503);const original=await f.head(),stamp=original.uploadedAt.toMillis();assert.equal(Object.keys(original).length,16);assert.equal(original.updatedAt.toMillis(),stamp);const response=await f.request('upload');assert.equal(response.status,200);assert.equal(response.body.alreadySaved,true);assert.deepEqual(await f.head(),original);assert.deepEqual(await f.version(f.input.uploadId),original);assert.equal((await db.collection(`staff_private_documents/${STAFF}/versions`).get()).size,1);assert.equal(f.creates,1);
});
test('simultaneous same upload intents converge while different intents with one original head cannot both publish',async()=>{
 const f=await fixture();await f.uploadBytes();const same=await Promise.all([f.request('upload'),f.request('upload')]);assert.ok(same.every(result=>result.status===200),JSON.stringify(same));assert.equal((await f.head()).version,1);
 const a={...f.input,uploadId:'sample-next-a',expectedVersion:1},b={...f.input,uploadId:'sample-next-b',expectedVersion:1};await f.uploadBytes(a);await f.uploadBytes(b);const results=await Promise.all([f.request('upload',a),f.request('upload',b)]);assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal((await f.head()).version,2);assert.equal((await db.collection(`staff_private_documents/${STAFF}/versions`).get()).size,2);
});
test('actual HQ review updates head and immutable upload version plus9-field audit atomically and retries a lost ACK only once',async()=>{
 const f=await uploaded(),input=await f.review();f.lostAck=true;assert.equal((await f.request('review',input,OWNER_TOKEN)).status,503);const original=await f.head(),audit=await f.read(`staff_private_documents/${STAFF}/reviews/${input.reviewId}`);assert.equal(original.status,'approved');assert.equal(original.version,2);assert.equal(Object.keys(audit).length,9);assert.equal(audit.recordedAt.toMillis(),original.reviewedAt.toMillis());assert.deepEqual(await f.version(input.uploadId),original);assert.equal((await f.request('review',input,OWNER_TOKEN)).body.alreadySaved,true);assert.deepEqual(await f.head(),original);assert.equal((await db.collection(`staff_private_documents/${STAFF}/reviews`).get()).size,1);
});
test('a missing object can still be rejected without an image read while approval requires full verified immutable bytes',async()=>{
 const f=await uploaded();f.images.clear();const approve=await f.request('review',await f.review(),OWNER_TOKEN);assert.equal(approve.status,409);assert.equal((await f.head()).version,1);const calls=f.requests.length;assert.equal((await f.request('review',await f.review('rejected'),OWNER_TOKEN)).status,200);assert.equal(f.requests.length,calls);assert.equal((await f.head()).status,'rejected');
});
test('real updateTime detects a restored ABA head while source bytes and original version remain untouched',async()=>{
 const f=await uploaded(),before=await f.head(),input={...f.input,expectedVersion:1,uploadId:'sample-aba-replacement'};await f.uploadBytes(input);f.afterAttest=async()=>{await db.doc(headPath).set({...before,reviewNote:'temporary'});await db.doc(headPath).set(before);};assert.equal((await f.request('upload',input)).status,409);assert.deepEqual(await f.head(),before);assert.deepEqual(await f.version(f.input.uploadId),before);assert.equal((await db.doc(versionPath(input.uploadId)).get()).exists,false);
});
test('fresh private binding and target employee revocation after attestation deny real writes and preserve the previous facts',async()=>{
 for(const path of ['staff_document_devices/'+UID,'cashiers/'+STAFF]){await env.clearFirestore();const f=await fixture();await f.uploadBytes();f.afterAttest=async()=>db.doc(path).update({active:false});assert.equal((await f.request('upload')).status,403);assert.equal(await f.head(),null);assert.equal((await db.collection(`staff_private_documents/${STAFF}/versions`).get()).size,0);}
});
test('scoped HQ grants are freshly intersected and both revoked PIN markers defeat a still-active index',async()=>{
 for(const key of ['pin','securityPin']){await env.clearFirestore();const f=await uploaded();await f.seedManager();await db.doc('hq_managers/sample-doc-manager').update({[key]:' blocked '});assert.equal((await f.request('review',await f.review('rejected'),MANAGER_TOKEN)).status,403);assert.equal((await f.head()).version,1);}
 await env.clearFirestore();const f=await uploaded();await f.seedManager();f.afterAttest=async()=>db.doc('hq_email_access/doc-manager@example.test').update({allowedBranches:['Other Branch']});assert.equal((await f.request('review',await f.review(),MANAGER_TOKEN)).status,403);assert.equal((await f.head()).version,1);
});
test('review audit IDs cannot be repurposed and broken history cannot be approved or replaced',async()=>{
 const f=await uploaded(),input=await f.review('rejected');assert.equal((await f.request('review',input,OWNER_TOKEN)).status,200);assert.equal((await f.request('review',{...input,note:'A different decision'},OWNER_TOKEN)).status,409);assert.equal((await db.collection(`staff_private_documents/${STAFF}/reviews`).get()).size,1);
 await db.doc(versionPath(f.input.uploadId)).update({sha256:'b'.repeat(64)});assert.equal((await f.request('review',await f.review('rejected',{reviewId:'another-review'}),OWNER_TOKEN)).status,409);
});
