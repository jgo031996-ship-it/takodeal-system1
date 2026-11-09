// Actual generated Rules, fictional records, and a fresh loopback-only emulator.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
const host='127.0.0.1',port=8846,projectId='demo-owner-boundary',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,collection,getDocFromServer,getDocsFromServer,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,deleteField,Timestamp}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'),'utf8')).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
let env,child,output='';const pause=ms=>new Promise(r=>setTimeout(r,ms)),reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied boundary test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-18000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local boundary emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);}});
const branchId='sample-branch',branch='Synthetic Branch',ownerUid='owner-boundary',ownerEmail='jgo031996@gmail.com';
const actor=(uid,{email,verified=true,provider='google.com'}={})=>env.authenticatedContext(uid,{...(email!==undefined?{email,email_verified:verified}:{}),firebase:{sign_in_provider:provider}}).firestore();
const owner=()=>actor(ownerUid,{email:ownerEmail}),publicDB=()=>env.unauthenticatedContext().firestore();
const seed=async rows=>env.withSecurityRulesDisabled(async c=>{for(const [path,row]of Object.entries(rows))await setDoc(doc(c.firestore(),path),row);});
const read=async path=>{let result;await env.withSecurityRulesDisabled(async c=>{result=(await getDocFromServer(doc(c.firestore(),path))).data();});return result;};
const payload=(overrides={})=>({branchId,branch,wifi:'SYNTHETIC_ONLY',updatedAt:serverTimestamp(),updatedByUid:ownerUid,...overrides});
beforeEach(async()=>{await env.clearFirestore();await seed({['branches/'+branchId]:{name:branch,address:'Before'},'branches/foreign':{name:'Other Synthetic Branch'}});});

test('both Owner helper paths require exact verified Google identity and reject password, unverified, foreign and anonymous accounts',async()=>{
 await assertSucceeds(setDoc(doc(owner(),'hq_managers/owner-proof'),{synthetic:true}));await assertSucceeds(setDoc(doc(owner(),'offline_policy/'+branch),{synthetic:true}));
 for(const db of [publicDB(),actor('no-email',{provider:'anonymous'}),actor('foreign',{email:'foreign@example.test'}),actor('unverified',{email:ownerEmail,verified:false}),actor('password',{email:ownerEmail,provider:'password'}),actor('custom',{email:ownerEmail,provider:'custom'}),actor('wrong-case',{email:'JGO031996@gmail.com'})]){await assertFails(setDoc(doc(db,'hq_managers/denied'),{synthetic:true}));await assertFails(setDoc(doc(db,'offline_policy/denied'),{synthetic:true}));}
});
test('anonymous approved-tablet setup retains its baseline safe-false Owner alternative',async()=>{
 const uid='pending-tablet',db=actor(uid,{provider:'anonymous'}),data={uid,deviceId:'DEV-SYNTHETIC-BOUNDARY',deviceName:'Synthetic tablet',branch,legacyDeviceDocId:'synthetic-mirror',status:'Pending',requestedAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(db,'pos_bindings/'+uid),data));await assertFails(setDoc(doc(db,'pos_bindings/another-uid'),data));
});
test('public branch WiFi cannot be created or reintroduced through any legacy OR alternative',async()=>{
 for(const db of [publicDB(),actor('ordinary',{provider:'anonymous'}),actor('manager',{email:'manager@example.test'}),owner()]){await assertFails(setDoc(doc(db,'branches/new'),{name:'Synthetic New',wifi:'DO_NOT_PUBLISH'}));await assertFails(updateDoc(doc(db,'branches/'+branchId),{wifi:'DO_NOT_PUBLISH'}));}
 await assertSucceeds(getDocFromServer(doc(publicDB(),'branches/'+branchId)));await assertSucceeds(updateDoc(doc(owner(),'branches/'+branchId),{address:'Public address only'}));assert.equal((await read('branches/'+branchId)).wifi,undefined);
});
test('actual five-field network contract atomically removes an old public value and saves its private replacement',async()=>{
 await seed({['branches/'+branchId]:{name:branch,address:'Before',wifi:'OLD_SYNTHETIC'}});const db=owner(),batch=writeBatch(db);batch.update(doc(db,'branches/'+branchId),{address:'After',wifi:deleteField()});batch.set(doc(db,'branch_private_settings/'+branchId),payload());await assertSucceeds(batch.commit());
 assert.equal((await read('branches/'+branchId)).wifi,undefined);assert.equal((await read('branches/'+branchId)).address,'After');assert.equal((await read('branch_private_settings/'+branchId)).wifi,'SYNTHETIC_ONLY');
});
test('private read/list is Owner-only, including nonexistent-document probes, and private deletion is not granted',async()=>{
 await seed({['branch_private_settings/'+branchId]:{branchId,branch,wifi:'SYNTHETIC_ONLY',updatedAt:Timestamp.now(),updatedByUid:ownerUid}});await assertSucceeds(getDocFromServer(doc(owner(),'branch_private_settings/'+branchId)));await assertSucceeds(getDocsFromServer(collection(owner(),'branch_private_settings')));
 for(const db of [publicDB(),actor('anonymous',{provider:'anonymous'}),actor('manager',{email:'manager@example.test'}),actor('password',{email:ownerEmail,provider:'password'})]){await assertFails(getDocFromServer(doc(db,'branch_private_settings/'+branchId)));await assertFails(getDocFromServer(doc(db,'branch_private_settings/missing')));await assertFails(getDocsFromServer(collection(db,'branch_private_settings')));}
 await assertFails(deleteDoc(doc(owner(),'branch_private_settings/'+branchId)));
});
test('malformed private schema, source identity and audit fields deny the entire public/private batch without partial writes',async()=>{
 const cases=[{extra:true},{branchId:'foreign'},{branch:'Other Synthetic Branch'},{wifi:123},{wifi:'x'.repeat(257)},{updatedByUid:'another'},{updatedAt:Timestamp.fromMillis(1)}];
 for(const override of cases){const db=owner(),batch=writeBatch(db);batch.update(doc(db,'branches/'+branchId),{address:'MUST_NOT_SAVE'});batch.set(doc(db,'branch_private_settings/'+branchId),payload(override));await assertFails(batch.commit());assert.equal((await read('branches/'+branchId)).address,'Before');assert.equal(await read('branch_private_settings/'+branchId),undefined);}
 const missing=payload();delete missing.wifi;await assertFails(setDoc(doc(owner(),'branch_private_settings/'+branchId),missing));
});
test('numeric, blank and oversized branch names fail even when they equal the public record; valid boundary strings remain supported',async()=>{
 for(const name of [123,'','x'.repeat(129)]){await seed({['branches/'+branchId]:{name,address:'Before'}});await assertFails(setDoc(doc(owner(),'branch_private_settings/'+branchId),payload({branch:name})));}
 const name='x'.repeat(128);await seed({['branches/'+branchId]:{name,address:'Before'}});await assertSucceeds(setDoc(doc(owner(),'branch_private_settings/'+branchId),payload({branch:name,wifi:'x'.repeat(256)})));
});
test('missing source, uncleared public credentials and changed private branch identity cannot be accepted',async()=>{
 await assertFails(setDoc(doc(owner(),'branch_private_settings/missing'),payload({branchId:'missing'})));await seed({['branches/'+branchId]:{name:branch,wifi:'OLD_SYNTHETIC'}});await assertFails(setDoc(doc(owner(),'branch_private_settings/'+branchId),payload()));
 await seed({['branches/'+branchId]:{name:branch},['branch_private_settings/'+branchId]:{branchId,branch:'Previous Synthetic Branch',wifi:'UNCHANGED',updatedAt:Timestamp.now(),updatedByUid:ownerUid}});await assertFails(setDoc(doc(owner(),'branch_private_settings/'+branchId),payload()));assert.equal((await read('branch_private_settings/'+branchId)).wifi,'UNCHANGED');
});
