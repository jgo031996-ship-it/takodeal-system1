// Real candidate Rules, a loopback-only emulator and synthetic cash records.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
const host='127.0.0.1',port=8805,projectId='demo-cash-remittance-rules',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing');
const sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,writeBatch,serverTimestamp,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing an occupied emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>{await env.clearFirestore();});
const publicDB=()=>env.unauthenticatedContext().firestore(),anon=()=>env.authenticatedContext('sample-tablet',{firebase:{sign_in_provider:'anonymous'}}).firestore(),owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const unverifiedOwner=()=>env.authenticatedContext('unverified-owner',{email:'jgo031996@gmail.com',email_verified:false,firebase:{sign_in_provider:'google.com'}}).firestore();
const browsers=()=>[publicDB(),anon(),owner(),unverifiedOwner()],admin=callback=>env.withSecurityRulesDisabled(context=>callback(context.firestore()));
const seed=(path,value)=>admin(db=>setDoc(doc(db,path),value));
const legacy={branch:'SAMPLE Branch',amount:22500,cashierName:'Sample Cashier',channel:'Cash',status:'Pending',timestamp:new Date('2026-10-26T01:00:00Z')};
const protectedRemit={...legacy,remittanceVersion:4,cashPolicyVersion:4,sourceShiftId:'sample-shift',reconciliation:{expectedBeforeCents:3482775,sentCents:2250000,countedRemainingCents:1232775,varianceCents:0}};
const openShift={branch:'SAMPLE Branch',active:true,isMallBranch:true,startTime:new Date('2026-10-26T01:00:00Z'),startingCash:2000,status:'Open'};
const v4Shift={...openShift,expectedRetainedCash:undefined,lastCashRemittanceId:'manual-v4-sample',cashReconciliationVersion:4,cashRemittanceRevision:1,manualRemittanceCashOut:1000};delete v4Shift.expectedRetainedCash;
const mallRow=(shiftId,patch={})=>({branch:'SAMPLE Branch',shiftId,cashierName:'Sample Cashier',amount:5500,retainedCash:2000,type:'Mall Daily Remittance',channel:'Physical Handover',status:'Pending',dateStr:'2026-10-26',timestamp:serverTimestamp(),cashPolicyVersion:2,...patch});
const mallClosing=(shiftId,patch={})=>({...openShift,active:false,status:'Closed',endTime:serverTimestamp(),isFinalShiftOfDay:true,declaredCash:7500,retainedCash:2000,remittedCash:5500,remittanceId:'mall-'+shiftId,...patch});
test('manual and forged version-four remittances cannot be created by any browser identity',async()=>{
 for(const db of browsers())for(const row of [legacy,protectedRemit,{...protectedRemit,type:'Mall Daily Remittance'}])await assertFails(setDoc(doc(db,'remittances/manual-v4-sample'),row));
});
test('all saved remittances are immutable to browsers, including legacy approvals and marker-stripping replacements',async()=>{
 await seed('remittances/legacy-sample',legacy);await seed('remittances/manual-v4-sample',protectedRemit);
 for(const db of browsers())for(const id of ['legacy-sample','manual-v4-sample']){const ref=doc(db,'remittances',id);await assertFails(updateDoc(ref,{status:'Received'}));await assertFails(updateDoc(ref,{amount:1,remittanceVersion:deleteField(),cashPolicyVersion:deleteField()}));await assertFails(setDoc(ref,legacy));await assertFails(deleteDoc(ref));}
});
test('existing history reads remain compatible without granting private cash-review access',async()=>{
 await seed('remittances/legacy-sample',legacy);await seed('remittances/manual-v4-sample',protectedRemit);
 for(const db of browsers()){await assertSucceeds(getDocFromServer(doc(db,'remittances/manual-v4-sample')));const result=await assertSucceeds(getDocsFromServer(collection(db,'remittances')));assert.equal(result.size,2);}
});
test('private quotes, operations, rate counters, drawer reviews and nested records have no browser grants',async()=>{
 for(const name of ['cash_remittance_quotes','cash_remittance_operations','cash_remittance_attempts','cash_drawer_reviews']){await seed(name+'/sample',{branch:'SAMPLE Branch'});for(const db of browsers()){await assertFails(getDocFromServer(doc(db,name,'sample')));await assertFails(getDocsFromServer(collection(db,name)));await assertFails(setDoc(doc(db,name,'new'),{branch:'SAMPLE Branch'}));await assertFails(updateDoc(doc(db,name,'sample'),{reviewStatus:'Reviewed'}));await assertFails(deleteDoc(doc(db,name,'sample')));await assertFails(setDoc(doc(db,name+'/sample/nested/record'),{amount:1}));}}
});
test('remittance-linked and reserved expense creation is denied even if version markers are omitted',async()=>{
 const variants=[{remittanceId:'legacy-sample'},{cashMovement:'Remittance'},{cashMovement:' reMITtance '},{category:'Cash Remittance'},{category:' cash remittance '},{description:'[REMITTANCE TO HQ] - Cash to HQ'},{cashPolicyVersion:4},{remittanceVersion:4}];
 for(const db of browsers()){for(let index=0;index<variants.length;index++)await assertFails(setDoc(doc(db,'expenses','forged-'+index),{branch:'SAMPLE Branch',amount:1,...variants[index]}));await assertFails(setDoc(doc(db,'expenses/remittance-manual-v4-sample'),{branch:'SAMPLE Branch',amount:1}));}
});
test('existing legacy and version-four remittance expenses cannot be edited, deleted or stripped of their linkage',async()=>{
 const records={legacy:{branch:'SAMPLE Branch',amount:24000,description:'[REMITTANCE TO HQ] - Cash'},versioned:{branch:'SAMPLE Branch',amount:22500,remittanceId:'manual-v4-sample',cashPolicyVersion:4}};
 for(const [id,row]of Object.entries(records))await seed('expenses/'+id,row);
 for(const db of browsers())for(const id of Object.keys(records)){const ref=doc(db,'expenses',id);await assertFails(updateDoc(ref,{amount:0}));await assertFails(setDoc(ref,{branch:'SAMPLE Branch',amount:1}));await assertFails(deleteDoc(ref));}
});
test('version-four HQ receipt logs remain readable but cannot be forged, overwritten or deleted',async()=>{
 await seed('account_logs/remittance-old-sample',{branch:'Main Office',amount:22500,receiptPolicyVersion:4});
 for(const db of browsers()){await assertSucceeds(getDocFromServer(doc(db,'account_logs/remittance-old-sample')));await assertFails(setDoc(doc(db,'account_logs/remittance-manual-v4-new'),{amount:1}));await assertFails(setDoc(doc(db,'account_logs/forged-receipt'),{amount:1,receiptPolicyVersion:4}));await assertFails(updateDoc(doc(db,'account_logs/remittance-old-sample'),{amount:1,receiptPolicyVersion:deleteField()}));await assertFails(setDoc(doc(db,'account_logs/remittance-old-sample'),{amount:1}));await assertFails(deleteDoc(doc(db,'account_logs/remittance-old-sample')));}
});
test('clients cannot create service-owned shift checkpoint fields',async()=>{
 for(const db of browsers())for(const field of ['expectedRetainedCash','lastCashRemittanceId','cashReconciliationVersion','cashRemittanceRevision','manualRemittanceCashOut'])await assertFails(setDoc(doc(db,'shifts','forged-'+field),{...openShift,[field]:field.endsWith('Id')?'forged':4}));
});
test('active checkpoints protect cash identity and service counters while retaining legitimate sale and expense updates',async()=>{
 await seed('shifts/checkpoint',v4Shift);
 for(const db of browsers())for(const patch of [{branch:'OTHER Branch'},{startTime:new Date(0)},{startingCash:999999},{manualRemittanceCashOut:0},{cashRemittanceRevision:2},{cashReconciliationVersion:deleteField()},{lastCashRemittanceId:deleteField()},{expectedRetainedCash:0}])await assertFails(updateDoc(doc(db,'shifts/checkpoint'),patch));
 await assertSucceeds(updateDoc(doc(anon(),'shifts/checkpoint'),{salesRevision:3}));await assertSucceeds(updateDoc(doc(publicDB(),'shifts/checkpoint'),{cashOut:100,expenses:100}));await assertFails(deleteDoc(doc(owner(),'shifts/checkpoint')));
});
test('a genuine close may append counted closure fields without rewriting its service-owned checkpoint',async()=>{
 await seed('shifts/checkpoint',v4Shift);await assertSucceeds(updateDoc(doc(anon(),'shifts/checkpoint'),{active:false,status:'Closed',endTime:serverTimestamp(),declaredCash:5000,retainedCash:5000,cashBreakdown:{1000:5},cashPolicyVersion:2}));
 for(const db of browsers())for(const patch of [{active:true},{retainedCash:0},{declaredCash:0},{expectedCash:0},{salesRevision:99},{endTime:new Date(0)},{startingCash:999}])await assertFails(updateDoc(doc(db,'shifts/checkpoint'),patch));await assertFails(deleteDoc(doc(owner(),'shifts/checkpoint')));
});
test('new ordinary shifts and unrelated legacy expenses retain their preceding permissions',async()=>{
 const db=publicDB();await assertSucceeds(setDoc(doc(db,'shifts/ordinary'),openShift));await assertSucceeds(updateDoc(doc(db,'shifts/ordinary'),{salesRevision:1,cashOut:100}));await assertSucceeds(setDoc(doc(db,'expenses/supplies'),{branch:'SAMPLE Branch',shiftId:'ordinary',amount:100,paidFrom:'Drawer',category:'Supplies'}));await assertSucceeds(updateDoc(doc(db,'expenses/supplies'),{amount:120}));await assertSucceeds(deleteDoc(doc(owner(),'expenses/supplies')));
});
test('legacy Owner grant equivalence preserves its original email policy while strict cash writes stay server-only',async()=>{
 for(const [name,db]of [['verified',owner()],['unverified',unverifiedOwner()]])await assertSucceeds(setDoc(doc(db,'menu','sample-'+name),{name:'Synthetic menu item',price:1}));
 for(const db of [publicDB(),anon(),env.authenticatedContext('other-owner',{email:'other@example.invalid',email_verified:true}).firestore()])await assertFails(setDoc(doc(db,'menu/denied-menu'),{name:'Synthetic menu item',price:1}));
 await assertFails(setDoc(doc(unverifiedOwner(),'remittances/manual-v4-unverified'),protectedRemit));
});
test('a valid atomic final mall close creates its one matching automatic handover',async()=>{
 const id='mall-shift';await seed('shifts/'+id,openShift);const db=anon(),batch=writeBatch(db);batch.set(doc(db,'shifts',id),mallClosing(id));batch.set(doc(db,'remittances','mall-'+id),mallRow(id));await assertSucceeds(batch.commit());assert.equal((await getDocFromServer(doc(db,'remittances','mall-'+id))).data().amount,5500);
 await assertFails(updateDoc(doc(owner(),'remittances','mall-'+id),{status:'Received'}));await assertFails(deleteDoc(doc(owner(),'remittances','mall-'+id)));
});
test('Owner clearance can preserve an earlier accepted close time with its matching atomic mall handover',async()=>{
 const id='reviewed-mall';await seed('shifts/'+id,openShift);const db=owner(),batch=writeBatch(db);batch.set(doc(db,'shifts',id),mallClosing(id,{endTime:new Date('2026-10-26T10:00:00Z')}));batch.set(doc(db,'remittances','mall-'+id),mallRow(id,{timestamp:new Date('2026-10-26T11:00:00Z')}));await assertSucceeds(batch.commit());
});
test('standalone or mismatched mall handovers cannot masquerade as a valid atomic close',async()=>{
 const variants=[{row:{amount:5499}},{row:{retainedCash:1999}},{row:{branch:'OTHER Branch'}},{row:{cashPolicyVersion:4}},{row:{remittanceVersion:4}},{row:{channel:'Cash'}},{row:{amount:Infinity},closing:{remittedCash:Infinity}},{row:{retainedCash:Infinity},closing:{retainedCash:Infinity}},{closing:{isFinalShiftOfDay:false}},{closing:{active:true}},{closing:{remittanceId:'different'}},{before:{isMallBranch:false}},{before:{active:false,status:'Closed'}}];
 for(let i=0;i<variants.length;i++){const id='mall-invalid-'+i,v=variants[i];await seed('shifts/'+id,{...openShift,...v.before});const db=anon(),batch=writeBatch(db);batch.set(doc(db,'shifts',id),mallClosing(id,v.closing));batch.set(doc(db,'remittances','mall-'+id),mallRow(id,v.row));await assertFails(batch.commit());assert.equal((await getDocFromServer(doc(db,'remittances','mall-'+id))).exists(),false);}
 await seed('shifts/standalone',openShift);await assertFails(setDoc(doc(anon(),'remittances/mall-standalone'),mallRow('standalone')));
});
test('competing browser decisions cannot partially post HQ cash or alter a pending remittance',async()=>{
 await seed('remittances/manual-v4-sample',protectedRemit);await seed('cash_accounts/sample-cash',{branch:'Main Office',name:'Cash',balance:100});
 const outcomes=await Promise.allSettled(['Received','Rejected'].map(status=>{const db=owner(),batch=writeBatch(db);batch.update(doc(db,'remittances/manual-v4-sample'),{status});batch.update(doc(db,'cash_accounts/sample-cash'),{balance:22600});batch.set(doc(db,'account_logs/remittance-manual-v4-sample'),{amount:22500,receiptPolicyVersion:4});return batch.commit();}));assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,0);
 await admin(async db=>{assert.equal((await getDocFromServer(doc(db,'remittances/manual-v4-sample'))).data().status,'Pending');assert.equal((await getDocFromServer(doc(db,'cash_accounts/sample-cash'))).data().balance,100);});
});
