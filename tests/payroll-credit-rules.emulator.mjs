// Real Rules permission checks use only fictional records in a loopback demo.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
const host='127.0.0.1',port=8879,projectId='demo-payroll-credit-rules',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,serverTimestamp,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The local emulator runtime is missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing an occupied test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>env.clearFirestore());
const email='jgo031996@gmail.com',id='payroll-adjustment-'+'a'.repeat(64),path='staff_bonuses/'+id;
const db=(kind='owner')=>kind==='public'?env.unauthenticatedContext().firestore():env.authenticatedContext('fictional-'+kind,{...(kind==='staff'?{}:{email:kind==='manager'?'manager@example.test':email,email_verified:kind!=='unverified'}),firebase:{sign_in_provider:kind==='staff'?'anonymous':kind==='password'?'password':'google.com'}}).firestore();
const credit=()=>({id,type:'Payroll Adjustment',payrollAdjustmentVersion:1,staffId:'fictional-staff',staffName:'Fictional Crew',branch:'Fictional Branch',amount:125,status:'Unpaid',originalStart:'2030-01-01',originalEnd:'2030-01-15',effectiveDate:'2030-02-01',sourcePayrollRecordId:'fictional-old-paid',reason:'A fictional missed allowance was reviewed.',createIntent:'fictional-exact-review',createdByUid:'fictional-owner',createdByEmail:email,createdAt:serverTimestamp(),dateAdded:serverTimestamp()});
const seed=(at,row)=>env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),at),row));

for(const kind of ['public','staff','manager','password','unverified'])test(kind+' cannot forge a typed or reserved-ID payroll credit, mutate it or remove its markers',async()=>{
 const client=db(kind),row=credit();
 await assertFails(setDoc(doc(client,path),row));
 await assertFails(setDoc(doc(client,'staff_bonuses/fictional-unreserved-credit'),{...row,id:'fictional-unreserved-credit'}));
 await assertFails(setDoc(doc(client,path),{type:'Performance Bonus',amount:125,status:'Unpaid'}));
 await seed(path,row);
 for(const patch of [{amount:999},{status:'Paid',paidAt:serverTimestamp(),payrollRecordId:'fictional-forged-payroll'},{type:deleteField(),payrollAdjustmentVersion:deleteField()},{status:'Cancelled',cancel:'A forged cancellation cannot erase the credit.'}])await assertFails(updateDoc(doc(client,path),patch));
 await assertFails(deleteDoc(doc(client,path)));
 const saved=(await getDocFromServer(doc(db(),path))).data();assert.equal(saved.status,'Unpaid');assert.equal(saved.amount,125);assert.equal(saved.type,'Payroll Adjustment');
});

test('verified Google Owner may create a credit and only settle or cancel its immutable unpaid review',async()=>{
 const owner=db();await assertSucceeds(setDoc(doc(owner,path),credit()));
 for(const patch of [{amount:999},{staffId:'another-staff'},{reason:'A later reason cannot replace the saved review.'},{type:deleteField()},{createdByEmail:'other@example.test'}])await assertFails(updateDoc(doc(owner,path),patch));
 await assertFails(deleteDoc(doc(owner,path)));
 await assertSucceeds(updateDoc(doc(owner,path),{status:'Paid',payrollRecordId:'fictional-receiving-payroll'}));
 await assertFails(updateDoc(doc(owner,path),{status:'Unpaid'}));await assertFails(updateDoc(doc(owner,path),{status:'Cancelled',cancel:'A paid credit cannot be cancelled.'}));
 const cancelPath='staff_bonuses/payroll-adjustment-'+'b'.repeat(64);await assertSucceeds(setDoc(doc(owner,cancelPath),{...credit(),id:cancelPath.split('/')[1]}));
 for(const patch of [{status:'Cancelled',cancelledByUid:'fictional-owner'},{status:'Cancelled',cancelledByEmail:email},{status:'xPaid'},{status:'Paidx'},{status:'xCancelled'},{status:'Cancelledx'},{status:'Partially Paid'},{status:'PaidCancelled'},{status:null},{status:{}},{status:'Paid',paidAt:serverTimestamp()},{status:'Cancelled',cancelReason:'Long preview metadata is deliberately no longer writable.',cancelledAt:serverTimestamp()}])await assertFails(updateDoc(doc(owner,cancelPath),patch));
 await assertSucceeds(updateDoc(doc(owner,cancelPath),{status:'Cancelled',cancel:'Fictional reviewed correction before payment.',at:serverTimestamp()}));
 await assertFails(updateDoc(doc(owner,cancelPath),{status:'Paid',paidAt:serverTimestamp(),payrollRecordId:'fictional-receiving-payroll'}));
 const stopped=(await getDocFromServer(doc(owner,cancelPath))).data();assert.equal(stopped.createdByUid,'fictional-owner');assert.equal(stopped.createdByEmail,email);assert.equal(stopped.cancel,'Fictional reviewed correction before payment.');assert.equal(typeof stopped.at.toMillis,'function');
});

test('unreserved typed credits remain protected when their old type would otherwise be stripped',async()=>{
 const at='staff_bonuses/fictional-unreserved-credit';await seed(at,{...credit(),id:'fictional-unreserved-credit'});
 for(const client of [db('staff'),db('manager'),db()]){await assertFails(updateDoc(doc(client,at),{type:'Performance Bonus'}));await assertFails(deleteDoc(doc(client,at)));}
});

test('the narrow credit guard preserves existing noncredit legacy bonus writes',async()=>{
 const staff=db('staff'),untyped='staff_bonuses/fictional-untyped';await assertSucceeds(setDoc(doc(staff,untyped),{amount:25,status:'Unpaid'}));await assertSucceeds(deleteDoc(doc(staff,untyped)));const at='staff_bonuses/fictional-performance';await assertSucceeds(setDoc(doc(staff,at),{type:'Performance Bonus',amount:25,status:'Unpaid'}));await assertSucceeds(updateDoc(doc(staff,at),{amount:30}));await assertSucceeds(deleteDoc(doc(staff,at)));
});
