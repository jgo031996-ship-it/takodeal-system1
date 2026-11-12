// Fictional records and explicit active policy on loopback only. No production writes.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
const tools=process.env.TAKODEAL_TEST_TOOLS,policyFile=process.env.PREP_RULES_FILE;
if(!tools||!policyFile)throw Error('Explicit isolated tools and active policy are required.');
const source=readFileSync(policyFile,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'32cdfdbaa3ae3599d5c4956e122fd26f0eadf402ff99db4369bd38e6f1ffe356');
const host='127.0.0.1',port=8887,projectId='demo-measured-prep-private-rules';
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==host+':'+port)throw Error('Refusing a non-test endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=host+':'+port;
const req=createRequire(resolve(tools,'package.json')),{initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection}=sdk;
let child,env,output='';const pause=ms=>new Promise(r=>setTimeout(r,ms)),reachable=()=>new Promise(done=>{const s=createConnection({host,port});s.setTimeout(200);s.once('connect',()=>{s.destroy();done(true);});s.once('error',()=>done(false));s.once('timeout',()=>{s.destroy();done(false);});});
before(async()=>{if(await reachable())throw Error('Occupied isolated test port');const {java}=JSON.parse(readFileSync(resolve(tools,'runtime.json')));child=spawn(java,['-jar',resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar'),'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[child.stdout,child.stderr])s.on('data',v=>output=(output+v).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error(output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:source}});},{timeout:45000});
beforeEach(()=>env.clearFirestore());after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);}});
const owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const clients=()=>[env.authenticatedContext('sample-staff',{firebase:{sign_in_provider:'anonymous'}}).firestore(),env.unauthenticatedContext().firestore(),env.authenticatedContext('sample-device',{firebase:{sign_in_provider:'anonymous'}}).firestore(),owner(),env.authenticatedContext('sample-foreign',{email:'sample@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore()];
for(const table of ['prep_yield_warnings','prep_yield_warning_reviews'])test(table+' remains server-only for anonymous, approved Cashier and verified Owner clients',async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),table,'sample'),{version:1,operationId:'sample',status:'Closed',stockPosted:false,actorUid:'owner'}));
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const[path,data]of Object.entries({'staff_document_devices/sample-staff':{uid:'sample-staff',staffId:'sample-staff',branch:'Sample Branch',active:true,deviceId:'DEV-SAMPLE-STAFF'},'staff_private_documents/sample-staff':{staffId:'sample-staff',branch:'Sample Branch',version:1},'pos_bindings/sample-device':{uid:'sample-device',status:'Active',deviceId:'DEV-SAMPLE-VOID',branch:'Sample Branch',legacyDeviceDocId:'sample-device'},'pos_devices/sample-device':{status:'Active',appType:'Cashier',deviceId:'DEV-SAMPLE-VOID',branch:'Sample Branch'},'hq_managers/sample-owner':{uid:'sample-owner',email:'jgo031996@gmail.com',role:'Owner',active:true,permissions:['all']},'manager_alerts/sample-public-control':{type:'INVENTORY_REVIEW',branch:'Sample Branch',message:'Fictional positive read control'}}))await setDoc(doc(db,path),data);});
 const staff=env.authenticatedContext('sample-staff',{firebase:{sign_in_provider:'anonymous'}}).firestore();await assertSucceeds(getDocFromServer(doc(staff,'staff_private_documents','sample-staff')));
 await assertSucceeds(getDocFromServer(doc(owner(),'manager_alerts','sample-public-control')));
 const cashier=env.authenticatedContext('sample-device',{firebase:{sign_in_provider:'anonymous'}}).firestore();await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'staff_login_sessions/sample-device'),{schemaVersion:1,uid:'sample-device',staffId:'sample-staff',app:'cashier',deviceId:'DEV-SAMPLE-VOID',branch:'Sample Branch',sessionId:'sample-current-session',expiresAt:new Date(Date.now()+3600000)}));
 await assertSucceeds(getDocFromServer(doc(cashier,'pos_bindings','sample-device')));for(const db of [...clients(),cashier]){await assertFails(getDocFromServer(doc(db,table,'sample')));await assertFails(getDocsFromServer(collection(db,table)));await assertFails(setDoc(doc(db,table,'new'),{version:1}));await assertFails(updateDoc(doc(db,table,'sample'),{status:'Saved'}));await assertFails(deleteDoc(doc(db,table,'sample')));}
 await env.withSecurityRulesDisabled(async c=>{assert.equal((await getDocFromServer(doc(c.firestore(),table,'sample'))).data().stockPosted,false);assert.equal((await getDocFromServer(doc(c.firestore(),table,'new'))).exists(),false);});
});
