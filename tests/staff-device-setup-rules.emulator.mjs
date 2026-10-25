// Full candidate Rules, loopback-only emulator and synthetic records.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
const host='127.0.0.1',port=8801,projectId='demo-staff-device-setup',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing');
const sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,writeBatch,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const s=createConnection({host,port});s.setTimeout(250);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied test emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>{await env.clearFirestore();});
const anon=()=>env.authenticatedContext('sample-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const publicDB=()=>env.unauthenticatedContext().firestore();
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const r=(db,id='DEV-SAMPLE-PHONE')=>doc(db,'pos_devices',id);
const legacy={deviceId:'DEV-SAMPLE-PHONE',deviceName:'SAMPLE phone',branch:'SAMPLE Branch',appType:'Staff',status:'Pending'};
const reserved={...legacy,setupVersion:1,setupUid:'sample-phone',staffId:'sample-staff',status:'Active'};
const roots=['staff_setup_credentials','staff_app_setup_config','staff_app_bindings','staff_app_device_index','staff_setup_audit','staff_setup_operations','staff_setup_attempts'];

test('private setup credentials, bindings, counters and audit cannot be read or written by browser identities',async()=>{
 for(const root of roots)await admin(db=>setDoc(doc(db,root,'sample'),{sample:true}));
 for(const db of [publicDB(),anon(),owner()])for(const root of roots){
  await assertFails(getDocFromServer(doc(db,root,'sample')));await assertFails(getDocsFromServer(collection(db,root)));
  await assertFails(setDoc(doc(db,root,'new'),{sample:true}));await assertFails(updateDoc(doc(db,root,'sample'),{sample:false}));await assertFails(deleteDoc(doc(db,root,'sample')));
 }
});
test('private nested records have no overlapping legacy wildcard grant',async()=>{
 await admin(db=>setDoc(doc(db,'staff_setup_credentials/sample/child/sample'),{sample:true}));
 for(const db of [publicDB(),anon(),owner()]){await assertFails(getDocFromServer(doc(db,'staff_setup_credentials/sample/child/sample')));await assertFails(setDoc(doc(db,'staff_setup_credentials/sample/child/new'),{sample:true}));}
});
test('legacy Staff registration remains compatible only before protected rollout is enabled',async()=>{
 await assertSucceeds(setDoc(r(publicDB()),legacy));
 await admin(db=>setDoc(doc(db,'staff_app_setup_config/current'),{enabled:true,revision:1}));
 await assertFails(setDoc(r(publicDB(),'DEV-NEW-PHONE'),{...legacy,deviceId:'DEV-NEW-PHONE'}));
 await assertSucceeds(setDoc(r(publicDB(),'DEV-POS-LEGACY'),{...legacy,deviceId:'DEV-POS-LEGACY',appType:'POS'}));
});
test('browser cannot create reserved marker fields even before rollout',async()=>{
 for(const db of [publicDB(),anon(),owner()])for(const patch of [{setupVersion:1},{setupVersion:0},{setupUid:'forged'}])await assertFails(setDoc(r(db,'DEV-FORGE-'+crypto.randomUUID()),{...legacy,...patch}));
});
test('protected fleet mirror remains visible but all direct browser edits and deletes are denied',async()=>{
 await admin(async db=>{const batch=writeBatch(db);batch.set(r(db),reserved);batch.set(doc(db,'staff_app_device_index/DEV-SAMPLE-PHONE'),{uid:'sample-phone',staffId:'sample-staff'});await batch.commit();});
 for(const db of [publicDB(),anon(),owner()]){
  await assertSucceeds(getDocFromServer(r(db)));
  for(const patch of [{status:'Active'},{status:'Blocked'},{staffId:'different'},{setupVersion:deleteField(),setupUid:deleteField()},{setupVersion:0,setupUid:deleteField()}])await assertFails(updateDoc(r(db),patch));
  await assertFails(deleteDoc(r(db)));await assertFails(setDoc(r(db),legacy));
 }
});
test('immutable private index protects a marker-stripped legacy mirror and a deleted mirror ID',async()=>{
 await admin(async db=>{await setDoc(r(db),legacy);await setDoc(doc(db,'staff_app_device_index/DEV-SAMPLE-PHONE'),{uid:'sample-phone',status:'Deleted'});});
 for(const db of [publicDB(),anon(),owner()]){await assertFails(updateDoc(r(db),{status:'Active'}));await assertFails(deleteDoc(r(db)));}
 await admin(db=>deleteDoc(r(db)));
 for(const db of [publicDB(),anon(),owner()])await assertFails(setDoc(r(db),legacy));
});
test('deleting the private index and mirror together cannot bypass the protected state',async()=>{
 await admin(async db=>{const batch=writeBatch(db);batch.set(r(db),reserved);batch.set(doc(db,'staff_app_device_index/DEV-SAMPLE-PHONE'),{uid:'sample-phone'});await batch.commit();});
 const db=owner(),batch=writeBatch(db);batch.delete(doc(db,'staff_app_device_index/DEV-SAMPLE-PHONE'));batch.delete(r(db));await assertFails(batch.commit());
 await admin(async db=>{assert.equal((await getDocFromServer(r(db))).exists(),true);assert.equal((await getDocFromServer(doc(db,'staff_app_device_index/DEV-SAMPLE-PHONE'))).exists(),true);});
});
test('unrelated legacy POS actions and private document protection stay compatible',async()=>{
 await assertSucceeds(setDoc(r(publicDB()),{...legacy,appType:'POS'}));await assertSucceeds(updateDoc(r(publicDB()),{status:'Active'}));await assertSucceeds(deleteDoc(r(owner())));
 await assertSucceeds(setDoc(doc(publicDB(),'expenses/SAMPLE-EXPENSE'),{branch:'SAMPLE Branch',amount:1}));
 for(const db of [publicDB(),anon(),owner()])await assertFails(setDoc(doc(db,'staff_private_documents/SAMPLE'),{branch:'SAMPLE Branch',staffId:'SAMPLE'}));
});
