// Fictional records and explicit active policy on loopback only. No production writes.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
const tools=process.env.TAKODEAL_TEST_TOOLS,policyFile=process.env.VOID_RULES_FILE;
if(!tools||!policyFile)throw Error('Explicit isolated tools and active policy are required.');
const source=readFileSync(policyFile,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'32cdfdbaa3ae3599d5c4956e122fd26f0eadf402ff99db4369bd38e6f1ffe356');
const host='127.0.0.1',port=8873,projectId='demo-cashier-void-private-rules';
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==host+':'+port)throw Error('Refusing a non-test endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=host+':'+port;
const req=createRequire(resolve(tools,'package.json')),{initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection}=sdk;
let child,env,output='';const pause=ms=>new Promise(r=>setTimeout(r,ms)),reachable=()=>new Promise(done=>{const s=createConnection({host,port});s.setTimeout(200);s.once('connect',()=>{s.destroy();done(true);});s.once('error',()=>done(false));s.once('timeout',()=>{s.destroy();done(false);});});
before(async()=>{if(await reachable())throw Error('Occupied isolated test port');const {java}=JSON.parse(readFileSync(resolve(tools,'runtime.json')));child=spawn(java,['-jar',resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar'),'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[child.stdout,child.stderr])s.on('data',v=>output=(output+v).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error(output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:source}});},{timeout:45000});
beforeEach(()=>env.clearFirestore());after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);}});
const owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const clients=()=>[env.unauthenticatedContext().firestore(),env.authenticatedContext('sample-device',{firebase:{sign_in_provider:'anonymous'}}).firestore(),owner(),env.authenticatedContext('sample-foreign',{email:'sample@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore()];
for(const table of['cashier_void_quotes','cashier_void_operations','cashier_void_sources'])test(table+' remains inaccessible to every direct client including the verified Owner',async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),table,'sample'),{schemaVersion:1,branch:'Sample Branch',actorUid:'sample-device',outcome:'saved'}));
 for(const db of clients()){
  await assertFails(getDocFromServer(doc(db,table,'sample')));await assertFails(getDocsFromServer(collection(db,table)));await assertFails(setDoc(doc(db,table,'new'),{schemaVersion:1}));await assertFails(updateDoc(doc(db,table,'sample'),{outcome:'cancelled'}));await assertFails(deleteDoc(doc(db,table,'sample')));
 }
 await env.withSecurityRulesDisabled(async c=>{const row=await getDocFromServer(doc(c.firestore(),table,'sample'));assert.equal(row.data().outcome,'saved');assert.equal((await getDocFromServer(doc(c.firestore(),table,'new'))).exists(),false);});
});
test('existing Cashier branch sold-out operation remains available under the untouched live rules',async()=>{
 const db=env.authenticatedContext('sample-device',{firebase:{sign_in_provider:'anonymous'}}).firestore();await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'menu/sample'),{name:'Sample meal',price:100,unavailableAt:[]}));
 await assertSucceeds(updateDoc(doc(db,'menu/sample'),{unavailableAt:['Sample Branch']}));assert.deepEqual((await getDocFromServer(doc(db,'menu/sample'))).data().unavailableAt,['Sample Branch']);
});
