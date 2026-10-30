// Full generated Rules, an isolated loopback emulator and fictional records.
// This file is a required release check; it never selects a production project.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {approvedCashShortage} from './helpers/cash-shortage-fixture.mjs';
import {createOwnerDeductionService} from '../takodeal-manager/owner-deductions.js';
const host='127.0.0.1',port=8812,projectId='demo-owner-deduction-recovery',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing');
const sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,query,where,writeBatch,serverTimestamp,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The local emulator runtime is missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing an occupied test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>{await env.clearFirestore();await admin(async db=>{await setDoc(doc(db,'cashiers/staff-a'),profile);await setDoc(doc(db,'staff_document_devices/staff-phone'),{uid:'staff-phone',staffId:'staff-a',active:true});await setDoc(doc(db,'staff_document_devices/other-phone'),{uid:'other-phone',staffId:'staff-b',active:true});});});
const ownerEmail='jgo031996@gmail.com',owner=()=>env.authenticatedContext('fiction-owner',{email:ownerEmail,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const staff=()=>env.authenticatedContext('staff-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore(),otherStaff=()=>env.authenticatedContext('other-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const publicDB=()=>env.unauthenticatedContext().firestore(),anon=()=>env.authenticatedContext('other-anon',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const manager=()=>env.authenticatedContext('fiction-manager',{email:'manager@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const wrongOwner=provider=>env.authenticatedContext('wrong-owner',{email:ownerEmail,email_verified:provider!=='unverified',firebase:{sign_in_provider:provider==='unverified'?'google.com':provider}}).firestore();
const admin=async callback=>{let result;await env.withSecurityRulesDisabled(async context=>{result=await callback(context.firestore());});return result;};
const seed=(path,row)=>admin(db=>setDoc(doc(db,path),row)),plain=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10),offset=n=>new Date(Date.parse(plain()+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const profile={cashierName:'Fictional Staff',branch:'Maa',active:true,pin:'fictional-only'},type='Owner Custom Deduction',caseId=n=>'owner-deduction-00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function pending(n=1){const id=caseId(n),common={incidentId:id,type,staffId:'staff-a',staffName:profile.cashierName,branch:'Maa',sourcePlatform:'Owner review',sourceReceiptId:id,label:'Fictional damaged jar',category:'Damaged item',incidentDate:plain(),amount:0,effectiveDate:null,status:'Pending Review'};return {id,review:{schemaVersion:1,id,type,staffId:common.staffId,staffName:common.staffName,staffBranch:'Maa',branch:'Maa',sourcePlatform:common.sourcePlatform,sourceReceiptId:id,label:common.label,category:common.category,incidentDate:common.incidentDate,details:'Fictional item damage explanation for local tests only.',evidence:'Fictional supporting record only.',sourceLossCents:10000,proposedAmount:100,revision:1,status:'Pending Review',amount:0,authorizedAmount:0,effectiveDate:null,openIntent:'fictional-create-intent',createdAt:serverTimestamp(),createdByUid:'fiction-owner',createdBy:ownerEmail},charge:{...common,ownerDeductionVersion:1,authorizedAmount:0,reviewRevision:1,dateAdded:serverTimestamp(),loggedBy:ownerEmail,remarks:'Owner custom deduction review only; no payroll charge is authorized.'},notice:{...common,version:1,id,sourceLossCents:10000,reasonLabel:common.label,details:'Fictional item damage explanation for local tests only.',evidence:'Fictional supporting record only.',noticeRevision:1,readRevision:0,replyRevision:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}};}
function createBatch(db,row){const batch=writeBatch(db);batch.set(doc(db,'owner_deduction_reviews',row.id),row.review);batch.set(doc(db,'staff_deductions',row.id),row.charge);batch.set(doc(db,'staff_deduction_notices',row.id),row.notice);return batch;}
async function seedPending(n=1){const row=pending(n);await admin(db=>createBatch(db,row).commit());return row;}

// Each negative case commits the actual three-document write against the full
// generated policy. It proves the authoritative source rule still validates
// the shared fields after the companion create validators are deduplicated.
test('recovery: verified Owner still creates exactly linked zero-charge pending records',async()=>{
 const row=pending();await assertSucceeds(createBatch(owner(),row).commit());
 for(const [table,status]of [['owner_deduction_reviews','Pending Review'],['staff_deductions','Pending Review'],['staff_deduction_notices','Pending Review']]){
  const data=(await getDocFromServer(doc(owner(),table,row.id))).data();assert.equal(data.status,status);assert.equal(data.amount,0);
 }
});
for(const [table,key]of [['owner_deduction_reviews','review'],['staff_deductions','charge'],['staff_deduction_notices','notice']])test('recovery: standalone '+table+' cannot create an orphan',async()=>{
 const row=pending();await assertFails(setDoc(doc(owner(),table,row.id),row[key]));
 assert.equal((await admin(db=>getDocFromServer(doc(db,table,row.id)))).exists(),false);
});
for(const missing of ['owner_deduction_reviews','staff_deductions','staff_deduction_notices'])test('recovery: atomic creation missing '+missing+' is denied',async()=>{
 const row=pending(),db=owner(),batch=writeBatch(db);
 for(const [table,key]of [['owner_deduction_reviews','review'],['staff_deductions','charge'],['staff_deduction_notices','notice']])if(table!==missing)batch.set(doc(db,table,row.id),row[key]);
 await assertFails(batch.commit());
 for(const table of ['owner_deduction_reviews','staff_deductions','staff_deduction_notices'])assert.equal((await admin(db=>getDocFromServer(doc(db,table,row.id)))).exists(),false);
});
for(const [missing,key]of [['staff_deductions','charge'],['staff_deduction_notices','notice']])test('recovery: an existing pending source cannot authorize recreation of '+missing,async()=>{
 const row=pending();await admin(async db=>{
  await setDoc(doc(db,'owner_deduction_reviews',row.id),row.review);
  const other=missing==='staff_deductions'?'staff_deduction_notices':'staff_deductions',value=missing==='staff_deductions'?row.notice:row.charge;
  await setDoc(doc(db,other,row.id),value);
 });
 await assertFails(setDoc(doc(owner(),missing,row.id),row[key]));
 assert.equal((await admin(db=>getDocFromServer(doc(db,missing,row.id)))).exists(),false);
});
test('recovery: rewriting an existing pending trio cannot masquerade as a fresh source create',async()=>{
 const row=await seedPending();await assertFails(createBatch(owner(),row).commit());
});
const links=[['label','A different fictional item'],['staffId','staff-b'],['staffName','Another fictional staff'],['branch','Cabantian'],['amount',1],['sourcePlatform','Other review'],['sourceReceiptId','another-source'],['category','Wastage'],['incidentDate','2000-01-01'],['effectiveDate','2000-01-01']];
for(const key of ['charge','notice'])for(const [field,value]of links)test('recovery: '+key+' mismatched '+field+' remains denied by the source join',async()=>{
 const row=pending();row[key][field]=value;await assertFails(createBatch(owner(),row).commit());
 assert.equal((await admin(db=>getDocFromServer(doc(db,'owner_deduction_reviews',row.id)))).exists(),false);
});
for(const [key,field,value]of [['charge','ownerDeductionVersion',2],['notice','version',2],['charge','reviewRevision',2],['notice','noticeRevision',2],['notice','id','other'],['notice','incidentId','other'],['charge','incidentId','other'],['notice','sourceLossCents',9999]])test('recovery: '+key+' mismatched '+field+' cannot bypass the authoritative create',async()=>{
 const row=pending();row[key][field]=value;await assertFails(createBatch(owner(),row).commit());
});
for(const [key,field,value]of [['charge','evidence','Private field must not reach public charge'],['charge','finding','Private finding must not reach public charge'],['charge','extraAuthority',true],['notice','unknownPrivateField','not in the saved schema'],['review','unknownSourceField',true]])test('recovery: '+key+' disallowed '+field+' fails its own exact schema',async()=>{
 const row=pending();row[key][field]=value;await assertFails(createBatch(owner(),row).commit());
});
for(const [field,value]of [['details','Changed private explanation'],['evidence','Changed private evidence'],['reasonLabel','Other display label'],['readRevision',1],['replyRevision',1],['createdAt',new Date('2000-01-01')],['updatedAt',new Date('2000-01-01')]])test('recovery: notice initial '+field+' retains its dedicated guard',async()=>{
 const row=pending();row.notice[field]=value;await assertFails(createBatch(owner(),row).commit());
});
for(const [field,value]of [['dateAdded',new Date('2000-01-01')],['loggedBy','another@example.test'],['remarks','A different authorization statement']])test('recovery: charge initial '+field+' retains its dedicated guard',async()=>{
 const row=pending();row.charge[field]=value;await assertFails(createBatch(owner(),row).commit());
});
for(const dbFactory of [publicDB,anon,staff,manager,()=>wrongOwner('password'),()=>wrongOwner('unverified')])test('recovery: companion dedup cannot bypass verified Google Owner authorization '+dbFactory.name,async()=>{
 await assertFails(createBatch(dbFactory(),pending()).commit());
});
