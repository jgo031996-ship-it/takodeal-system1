// Explicit local-only full-rules checks; no production Firebase connection.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {publishStaffPayslip} from '../takodeal-manager/staff-payslip-publication.js';
import {readStaffSavedPayslips} from '../takodeal-staff/staff-saved-payslips.js';
const host='127.0.0.1',port=8824,projectId='demo-staff-vault-payslip',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing');
const sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,query,where,collection,serverTimestamp,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local test emulator runtime is missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing an occupied test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>env.clearFirestore());
const auth=(uid,email,provider='google.com',verified=true)=>env.authenticatedContext(uid,{...(email?{email,email_verified:verified}:{}),firebase:{sign_in_provider:provider}}).firestore();
const owner=()=>auth('sample-owner','jgo031996@gmail.com'),anonymous=()=>auth('sample-phone',null,'anonymous'),publicDB=()=>env.unauthenticatedContext().firestore();
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const staffId='sample-staff',start='2030-01-01',end='2030-01-15',previewId=staffId+'-'+start+'-'+end;
const preview=(extra={})=>({schemaVersion:1,kind:'owner-shared-payslip',status:'Published',staffId,staffName:'Sample Staff',branch:'Sample Branch',startDate:start,endDate:end,revision:1,publishedAt:serverTimestamp(),publishedByUid:'sample-owner',publishedByEmail:'jgo031996@gmail.com',snapshot:{staffId,name:'Sample Staff',branch:'Sample Branch',start,end,isPaid:false,grossPay:120,totalDeductions:20,finalNetPay:100,customDeductions:[{name:'Sample edited deduction',amount:20}],logs:[],profile:{}},finalNetPay:100,...extra});
const ref=db=>doc(db,'staff_payslip_previews',previewId);
async function seedPrivateDevice({active=true,other=false}={}){await admin(async db=>{await setDoc(doc(db,'staff_document_config/current'),{enabled:true,policyVersion:2,brokerEndpoint:'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'});await setDoc(doc(db,'staff_document_devices/sample-phone'),{uid:'sample-phone',staffId:other?'other-staff':staffId,branch:'Sample Branch',active});});}

test('only the verified Google Owner can publish a reviewed unpaid payslip',async()=>{
 for(const db of [publicDB(),anonymous(),auth('manager','manager@example.invalid'),auth('unverified','jgo031996@gmail.com','google.com',false),auth('non-google','jgo031996@gmail.com','password')])await assertFails(setDoc(ref(db),preview()));
 await assertSucceeds(setDoc(ref(owner()),preview()));
 await assertSucceeds(getDocFromServer(ref(owner())));
});
test('published payslips are private, exact-staff readable and cannot be edited by staff',async()=>{
 await assertSucceeds(setDoc(ref(owner()),preview()));await seedPrivateDevice();
 await assertFails(getDocFromServer(ref(publicDB())));await assertSucceeds(getDocFromServer(ref(anonymous())));
 await assertSucceeds(getDocsFromServer(query(collection(anonymous(),'staff_payslip_previews'),where('staffId','==',staffId))));
 await assertFails(getDocsFromServer(collection(anonymous(),'staff_payslip_previews')));
 await assertFails(updateDoc(ref(anonymous()),{finalNetPay:999}));await assertFails(deleteDoc(ref(anonymous())));
 await seedPrivateDevice({active:false});await assertFails(getDocFromServer(ref(anonymous())));
 await seedPrivateDevice({other:true});await assertFails(getDocFromServer(ref(anonymous())));
});
test('Owner updates require one new revision, consistent identity, metadata and saved totals',async()=>{
 const db=owner();await assertSucceeds(setDoc(ref(db),preview()));
 for(const change of [{revision:1},{revision:3},{revision:2,publishedByUid:'forged'},{revision:2,publishedByEmail:'other@example.invalid'},{revision:2,staffId:'other-staff'},{revision:2,finalNetPay:101},{revision:2,unexpected:true},{revision:2,status:'Paid'}])await assertFails(setDoc(ref(db),preview(change)));
 await assertSucceeds(setDoc(ref(db),preview({revision:2})));await assertFails(deleteDoc(ref(db)));
});
test('paid payroll references prevent creating or replacing a shared unpaid draft',async()=>{
 for(const prefix of ['payroll-','refund-payroll-']){await admin(db=>setDoc(doc(db,'payroll_records',prefix+previewId),{staffId}));await assertFails(setDoc(ref(owner()),preview()));await admin(db=>deleteDoc(doc(db,'payroll_records',prefix+previewId)));}
 await assertSucceeds(setDoc(ref(owner()),preview()));await admin(db=>setDoc(doc(db,'payroll_records','payroll-'+previewId),{staffId}));await assertFails(setDoc(ref(owner()),preview({revision:2})));
});
test('managed PIN marker, version and verifier cannot be forged, downgraded or deleted through browser rules',async()=>{
 const target=db=>doc(db,'cashiers',staffId),managed={cashierName:'Sample Staff',branch:'Sample Branch',payslipPinManaged:true,payslipPinVersion:1,payslipPin:{sample:'server verifier'}};
 await admin(db=>setDoc(target(db),managed));
 for(const db of [publicDB(),anonymous(),owner()]){
  for(const change of [{payslipPin:{forged:true}},{payslipPin:deleteField()},{payslipPinManaged:false},{payslipPinManaged:deleteField()},{payslipPinVersion:2},{payslipPinVersion:deleteField()}])await assertFails(updateDoc(target(db),change));
  await assertFails(setDoc(target(db),{cashierName:'Replaced'}));await assertFails(deleteDoc(target(db)));
  await assertSucceeds(updateDoc(target(db),{phone:'sample normal profile edit'}));
 }
 await admin(db=>setDoc(target(db),{cashierName:'Sample Staff',branch:'Sample Branch'}));
 for(const db of [publicDB(),anonymous(),owner()])await assertFails(updateDoc(target(db),{payslipPinManaged:true,payslipPinVersion:1}));
});
test('unmanaged legacy PIN changes retain compatibility without adding managed authority',async()=>{
 await admin(db=>setDoc(doc(db,'cashiers',staffId),{cashierName:'Sample Staff',branch:'Sample Branch'}));
 await assertSucceeds(updateDoc(doc(publicDB(),'cashiers',staffId),{payslipPin:{sample:'legacy screen lock'}}));
 const db=owner();await assertFails(setDoc(doc(db,'cashiers','new-managed'),{cashierName:'New',payslipPinManaged:true}));
 assert.equal((await getDocFromServer(doc(publicDB(),'cashiers',staffId))).data().payslipPinManaged,undefined);
});
test('actual Owner publisher and Staff reader preserve revised manual deductions across full candidate rules',async()=>{
 const staffName='Sample Staff',branch='Sample Branch',profile={staffId,cashierName:staffName,branch,hourlyRate:450,customDeductions:[]};
 await admin(db=>setDoc(doc(db,'cashiers',staffId),profile));await seedPrivateDevice();
 const api={...sdk,db:owner(),auth:{currentUser:{uid:'sample-owner',email:'jgo031996@gmail.com',emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'sample-owner',email:'jgo031996@gmail.com',isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']}};
 const data={staffId,name:staffName,branch,start,end,isPaid:false,basicPay:120,nightBonus:0,straightBonus:0,holidayPayTotal:0,perfBonus:0,payrollAdjustments:0,lateDeduction:0,sss:0,philhealth:0,pagibig:0,advances:0,meals:0,loans:0,onlineRefunds:0,cashShortages:0,ownerDeductions:0,customDeductionsTotal:20,customDeductions:[{name:'Owner edited deduction',amount:20}],profile,logs:[]};
 const privateClient={sdk,db:anonymous(),auth:{currentUser:{uid:'sample-phone'}}};
 const read=()=>readStaffSavedPayslips({...sdk,db:publicDB()},{staffId,staffName,profile,createVault:async()=>privateClient});
 await publishStaffPayslip(api,{data,finalNetPay:100,expectedRevision:0});
 let state=await read();assert.equal(state.errors.length,0);assert.equal(state.shared.length,1);assert.equal(state.shared[0].data.finalNetPay,100);assert.equal(state.shared[0].data.customDeductionsTotal,20);assert.equal(state.shared[0].data.customDeductions[0].name,'Owner edited deduction');
 const changed={...data,customDeductionsTotal:35,customDeductions:[{name:'Revised deduction',amount:35}]};
 const saved=await publishStaffPayslip(api,{data:changed,finalNetPay:85,expectedRevision:1});
 state=await read();assert.equal(state.shared[0].data.finalNetPay,85);assert.equal(state.shared[0].data.customDeductionsTotal,35);assert.equal(state.shared[0].data.publicationRevision,2);
 await admin(db=>setDoc(doc(db,'payroll_records','payroll-'+previewId),{staffId,staffName,branch,startDate:start,endDate:end,finalNetPay:80,processedAt:serverTimestamp(),frozenData:{...saved.snapshot,isPaid:true,customDeductionsTotal:40,customDeductions:[{name:'Final paid deduction',amount:40}],totalDeductions:40,finalNetPay:80}}));
 state=await read();assert.equal(state.shared.length,0);assert.equal(state.paid.length,1);assert.equal(state.paid[0].data.finalNetPay,80);assert.equal(state.paid[0].data.customDeductions[0].name,'Final paid deduction');
 await assert.rejects(publishStaffPayslip(api,{data:changed,finalNetPay:85,expectedRevision:2}),/saved payroll record/);
});
