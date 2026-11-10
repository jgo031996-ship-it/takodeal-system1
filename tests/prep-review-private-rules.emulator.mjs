// Fictional records against the exact active policy. Root runs this on hosted CI;
// importing this file starts a local emulator, so do not run it on an active PC.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';

const tools=process.env.TAKODEAL_TEST_TOOLS,policyFile=process.env.PREP_RULES_FILE;
if(!tools||!policyFile)throw Error('Explicit isolated tools and the exact active Firestore policy are required.');
const source=readFileSync(policyFile,'utf8'),hash=value=>createHash('sha256').update(value).digest('hex');
const policyHash='32cdfdbaa3ae3599d5c4956e122fd26f0eadf402ff99db4369bd38e6f1ffe356';
assert.equal(hash(source),policyHash,'This test may not silently substitute a new database policy.');
const host='127.0.0.1',port=8873,projectId='demo-prep-review-private-rules',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const req=createRequire(resolve(tools,'package.json')),{initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');
sdk.setLogLevel('silent');
const{doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,Timestamp}=sdk;
let child,env,output='';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const reachable=()=>new Promise(done=>{const socket=createConnection({host,port});socket.setTimeout(200);socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>done(false));socket.once('timeout',()=>{socket.destroy();done(false);});});
before(async()=>{
 if(await reachable())throw Error('Refusing an occupied isolated emulator port.');
 const{java}=JSON.parse(readFileSync(resolve(tools,'runtime.json')));
 child=spawn(java,['-jar',resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar'),'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of[child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));
 const deadline=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error('Isolated emulator did not start: '+output);await pause(100);}
 env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:source}});
},{timeout:45000});
const anonymous=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'anonymous'}}).firestore();
const owner=()=>env.authenticatedContext('fixture-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const sample=()=>({version:1,kind:'cashier-prep-review',operationId:'fixture-prep-review',actorType:'cashier',actorUid:'fixture-cashier',actorEmail:'',staffId:'fixture-crew',deviceId:'DEV-FIXTURE-CASHIER',sessionId:'fixture-session-123456789',branch:'Fixture Branch',outputInventoryId:'fixture-prepared',outputName:'Fixture Sauce',declaredName:'Fixture Sauce',qty:2,reason:'',skipReason:'SkipForNow',note:'',status:'Pending',stockPosted:false,sourceFingerprint:'a'.repeat(64),intentHash:'b'.repeat(64),reviewIntentHash:'c'.repeat(64),issue:{code:'insufficient-stock',message:'Fictional ingredient shortage',details:{inventoryId:'fixture-raw',itemName:'Fixture Raw',role:'ingredient'}},sources:{output:{id:'fixture-prepared',updateTime:'1:123456789'},recipes:[],ingredients:[]},createdAt:Timestamp.fromMillis(1000)});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  for(const[path,data]of Object.entries({
   'prep_review_requests/fixture-prep-review':sample(),
   'staff_document_devices/fixture-staff':{uid:'fixture-staff',staffId:'fixture-crew',branch:'Fixture Branch',active:true,deviceId:'DEV-FIXTURE-STAFF'},
   'staff_private_documents/fixture-crew':{staffId:'fixture-crew',branch:'Fixture Branch',version:1},
   'cashiers/fixture-crew':{cashierName:'Fictional Crew',branch:'Fixture Branch',active:true,status:'Active'},
   'pos_bindings/fixture-cashier':{uid:'fixture-cashier',status:'Active',branch:'Fixture Branch',deviceId:'DEV-FIXTURE-CASHIER',legacyDeviceDocId:'fixture-device'},
   'pos_devices/fixture-device':{uid:'fixture-cashier',status:'Active',branch:'Fixture Branch',deviceId:'DEV-FIXTURE-CASHIER',appType:'Cashier'},
   'manager_alerts/fixture-existing-alert':{type:'INVENTORY_REVIEW',branch:'Fixture Branch',reviewStatus:'Pending',stockPosted:false,message:'Fictional existing inventory alert.',isRead:false,timestamp:Timestamp.fromMillis(1000)}
  }))await setDoc(doc(db,path),data);
 });
});
after(async()=>{
 await env?.cleanup();
 if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(done=>child.once('exit',done)),pause(3000)]);}
 assert.equal(hash(readFileSync(policyFile,'utf8')),policyHash,'The tested policy must remain unchanged.');
});
const actors={unauthenticated:()=>env.unauthenticatedContext().firestore(),anonymous:()=>anonymous('fixture-anonymous'),Staff:()=>anonymous('fixture-staff'),Cashier:()=>anonymous('fixture-cashier'),Owner:owner};
for(const[label,client]of Object.entries(actors))test(label+' SDK cannot get/list/create/update/delete the broker-only prep review namespace',async()=>{
 const db=client(),existing=doc(db,'prep_review_requests','fixture-prep-review'),fresh=doc(db,'prep_review_requests','fixture-new-review');
 await assertFails(getDocFromServer(existing));
 await assertFails(getDocsFromServer(collection(db,'prep_review_requests')));
 await assertFails(setDoc(fresh,{...sample(),operationId:'fixture-new-review'}));
 await assertFails(updateDoc(existing,{status:'Reviewed',stockPosted:true}));
 await assertFails(deleteDoc(existing));
 await env.withSecurityRulesDisabled(async context=>{const trusted=context.firestore(),saved=await getDocFromServer(doc(trusted,'prep_review_requests','fixture-prep-review'));assert.equal(saved.data().status,'Pending');assert.equal(saved.data().stockPosted,false);assert.equal((await getDocFromServer(doc(trusted,'prep_review_requests','fixture-new-review'))).exists(),false);});
});
test('valid Staff private binding, Cashier binding and normal authorized Owner alert reads still work',async()=>{
 const staff=await assertSucceeds(getDocFromServer(doc(anonymous('fixture-staff'),'staff_private_documents','fixture-crew')));assert.equal(staff.data().staffId,'fixture-crew');
 const cashier=await assertSucceeds(getDocFromServer(doc(anonymous('fixture-cashier'),'pos_bindings','fixture-cashier')));assert.equal(cashier.data().status,'Active');
 const notification=await assertSucceeds(getDocFromServer(doc(owner(),'manager_alerts','fixture-existing-alert')));assert.equal(notification.data().stockPosted,false);assert.equal(notification.data().reviewStatus,'Pending');
});
