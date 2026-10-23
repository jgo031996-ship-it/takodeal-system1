// Isolated, full production Rules tests. This file never uses cloud credentials.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {saveStaffSssRemittance,sssRemittanceId} from '../takodeal-manager/staff-sss-service.js';
import {readOwnerRecordFile} from '../takodeal-manager/owner-record-files.js';
const host='127.0.0.1',port=8792,projectId='demo-owner-compliance-extra',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing another Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),requireTools=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=requireTools('@firebase/rules-unit-testing'),sdk=requireTools('firebase/firestore');
const {doc,collection,query,where,orderBy,limit,startAfter,getDocsFromServer,getDocFromServer,runTransaction,serverTimestamp,setDoc,updateDoc,deleteDoc,writeBatch}=sdk;sdk.setLogLevel('silent');
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(r=>setTimeout(r,ms));
const reachable=()=>new Promise(r=>{const s=createConnection({host,port});s.setTimeout(300);s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));s.once('timeout',()=>{s.destroy();r(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-9000));const deadline=Date.now()+25000;while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error('Emulator startup failed: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:40000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
const email='jgo031996@gmail.com',staffId='sample-compliance-staff',staffName='SAMPLE Compliance Employee',branch='Maa';
const owner=()=>env.authenticatedContext('sample-owner',{email,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const foreign=()=>env.authenticatedContext('sample-manager',{email:'sample-manager@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const anon=()=>env.authenticatedContext('sample-pos',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const api=(db=owner())=>({db,doc,collection,query,where,orderBy,limit,startAfter,getDocsFromServer,getDocFromServer,runTransaction,serverTimestamp,crypto,auth:{currentUser:{uid:'sample-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'sample-owner',email,isOwner:true,isFranchisee:false,permissions:['all'],role:'Owner',allowedBranches:['All']}});
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const read=path=>getDocFromServer(doc(owner(),path)).then(s=>s.data());
const payroll=id=>({staffId,staffName,branch,startDate:'2026-10-01',endDate:'2026-10-15',finalNetPay:4000,status:'Paid',frozenData:{staffId,name:staffName,start:'2026-10-01',end:'2026-10-15',sss:100,isPaid:true,finalNetPay:4000}});
beforeEach(async()=>{await env.clearFirestore();await admin(async db=>{const b=writeBatch(db);b.set(doc(db,'branches/sample-maa'),{name:branch,active:true});b.set(doc(db,'hq_managers/sample-owner-record'),{email,role:'Owner',permissions:['all'],assignedBranch:'All',active:true,pin:'SAMPLE-NOT-A-LIVE-PIN'});b.set(doc(db,'cashiers/'+staffId),{cashierName:staffName,branch});for(let n=0;n<6;n++)b.set(doc(db,'payroll_records/sample-payroll-'+n),payroll(n));await b.commit();});});
const sssInput=(n=1)=>({staffId,contributionMonth:'2026-10',remittedDate:'2026-10-21',reference:'SAMPLE-SSS-'+n,employerShareCents:2000,ecShareCents:100,notes:'SAMPLE only',evidenceReference:'SAMPLE PRN',allocations:[{payrollRecordId:'sample-payroll-0',startDate:'2026-10-01',endDate:'2026-10-15',deductedCents:10000,amountCents:5000}]});
const sampleFile=(bytes=100)=>new File([Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(bytes-9)])],'SAMPLE-proof.pdf',{type:'application/pdf'});

const links=(count=2,amountCents=1000)=>Array.from({length:count},(_,n)=>({...sssInput().allocations[0],payrollRecordId:'sample-payroll-'+n,amountCents}));
// Deliberately bypass all client validation: these raw paired writes test Rules.
async function rawPair({allocations=links(),mutateRecord=()=>{},mutateLedger=()=>{},recordOnly=false,ledgerOnly=false}={}){
 const db=owner(),reference='SAMPLE-RAW-'+crypto.randomUUID(),recordId=await sssRemittanceId(staffId,'2026-10',reference);
 const old=await read('staff_sss_allocation_totals/'+staffId),allocated={...(old?.allocatedCentsByPayroll||{})};
 for(const row of allocations)allocated[row.payrollRecordId]=(allocated[row.payrollRecordId]||0)+row.amountCents;
 const employeeShareCents=allocations.reduce((sum,row)=>sum+row.amountCents,0),stamp=serverTimestamp();
 const record={version:1,recordId,staffId,staffName,branch,contributionMonth:'2026-10',remittedDate:'2026-10-21',
 employeeShareCents,employerShareCents:2000,ecShareCents:100,totalCents:employeeShareCents+2100,
 reference,referenceKey:reference,notes:'SAMPLE only',evidenceReference:'SAMPLE PRN',allocations,proof:null,intent:'SAMPLE raw Rules adversary',
 recordedAt:stamp,recordedByUid:'sample-owner',recordedBy:email};
 const ledger={version:1,staffId,revision:(old?.revision||0)+1,allocatedCentsByPayroll:allocated,lastRemittanceId:recordId,updatedAt:stamp,updatedByUid:'sample-owner'};
 mutateRecord(record);mutateLedger(ledger);const batch=writeBatch(db);
 if(!ledgerOnly)batch.set(doc(db,'staff_sss_remittances',recordId),record);
 if(!recordOnly)batch.set(doc(db,'staff_sss_allocation_totals',staffId),ledger);
 return batch.commit();
}

test('SSS: two cutoff proofs and maximum private proof fit the real Rules budget',async()=>{
 const a=api(),input={...sssInput(),allocations:links(2,10000),file:sampleFile(2*1024*1024),fileId:crypto.randomUUID(),operationId:crypto.randomUUID()};
 const result=await assertSucceeds(saveStaffSssRemittance(a,input));
 assert.equal(result.record.allocations.length,2);assert.equal(result.record.proof.chunkCount,15);
 assert.equal((await readOwnerRecordFile(a,result.record.proof)).size,2*1024*1024);
 const file=doc(a.db,'owner_record_files',input.fileId),chunk=doc(a.db,'owner_record_files',input.fileId,'chunks','0000');
 await assertFails(updateDoc(file,{fileName:'SAMPLE altered.pdf'}));await assertFails(deleteDoc(file));
 await assertFails(updateDoc(chunk,{data:'QQ=='}));await assertFails(deleteDoc(chunk));
 await assertFails(getDocFromServer(doc(foreign(),'owner_record_files',input.fileId)));
});
test('SSS: a raw third cutoff is rejected atomically',async()=>{await assertFails(rawPair({allocations:links(3)}));assert.equal(await read('staff_sss_allocation_totals/'+staffId),undefined);});
test('SSS: arbitrary additional allocation map keys are rejected',async()=>{await assertFails(rawPair({mutateLedger:row=>{row.allocatedCentsByPayroll['not-a-linked-payroll']=100;}}));});
test('SSS: duplicate payroll links are rejected',async()=>{const selected=links(1);await assertFails(rawPair({allocations:[selected[0],{...selected[0]}]}));});
test('SSS: exact cumulative deltas cannot be decreased or over-allocated',async()=>{
 await assertSucceeds(rawPair({allocations:links(1,4000)}));
 await assertFails(rawPair({allocations:[links()[1]],mutateLedger:row=>{row.allocatedCentsByPayroll['sample-payroll-0']=1000;}}));
 await assertFails(rawPair({allocations:links(1,7000)}));
 assert.equal((await read('staff_sss_allocation_totals/'+staffId)).allocatedCentsByPayroll['sample-payroll-0'],4000);
});
test('SSS: a new record and its fresh ledger stamp must be one atomic pair',async()=>{
 await assertFails(rawPair({recordOnly:true}));await assertFails(rawPair({ledgerOnly:true}));
 await assertFails(rawPair({mutateLedger:row=>{row.updatedByUid='somebody-else';}}));
 await assertFails(rawPair({mutateRecord:row=>{row.recordedByUid='somebody-else';}}));
});
const payrollAttacks={
 'saved staff identity':row=>{row.staffId='another-staff';},
 'frozen staff identity':row=>{row.frozenData.staffId='another-staff';},
 'frozen profile identity':row=>{row.frozenData.profile={staffId:'another-staff'};},
 'unpaid status':row=>{row.status='Unpaid';},
 'unpaid frozen snapshot':row=>{row.frozenData.isPaid=false;},
 'frozen amount':row=>{row.frozenData.sss=99;},
 'missing frozen net':row=>{delete row.finalNetPay;delete row.frozenData.finalNetPay;},
 'changed frozen net':row=>{row.frozenData.finalNetPay=3999;},
 'changed frozen cutoff':row=>{row.frozenData.start='2026-10-02';}
};
for(const at of [0,1])for(const [label,attack]of Object.entries(payrollAttacks))test('SSS: '+label+' fails at linked position '+at,async()=>{
 const changed=payroll(at);attack(changed);await admin(db=>setDoc(doc(db,'payroll_records/sample-payroll-'+at),changed));
 await assertFails(rawPair());assert.equal(await read('staff_sss_allocation_totals/'+staffId),undefined);
});
test('private files: an orphan manifest or chunk cannot be created',async()=>{
 const db=owner(),id=crypto.randomUUID(),recordId='sss-'+'a'.repeat(64),descriptor={id,kind:'sss_remittance',recordId,fileName:'SAMPLE.pdf',contentType:'application/pdf',size:10,sha256:'a'.repeat(64),chunkCount:1};
 const manifest={schemaVersion:1,...descriptor,chunkSize:147456,operationId:crypto.randomUUID(),createdAt:serverTimestamp(),createdByUid:'sample-owner',createdByEmail:email};
 await assertFails(setDoc(doc(db,'owner_record_files',id),manifest));
 await assertFails(setDoc(doc(db,'owner_record_files',id,'chunks','0000'),{schemaVersion:1,fileId:id,index:0,size:10,sha256:'a'.repeat(64),data:'U0FNUExF'}));
});

test('permit create/update dispatch retains initial revision and immutable creation metadata with a fully matched audit',async()=>{
 const db=owner(),id=crypto.randomUUID();
 const business=record=>Object.fromEntries(['branch','permitType','permitName','agency','permitNumber','issueDate','expiryDate','renewalStatus','notes','attachment','archived'].map(key=>[key,record[key]]));
 function rawPermit(recordId,before=null,mutate=()=>{}){
  const operationId=crypto.randomUUID(),stamp=serverTimestamp();
  const record={schemaVersion:1,recordId,branch,permitType:'Business permit',permitName:'SAMPLE raw dispatch permit',agency:'SAMPLE agency',permitNumber:'SAMPLE-2026',issueDate:'2026-01-01',expiryDate:'2026-12-31',renewalStatus:'Not started',notes:'SAMPLE Rules equivalence only',attachment:null,archived:false,
   revision:(before?.revision||0)+1,createdAt:before?.createdAt??stamp,createdByUid:before?.createdByUid??'sample-owner',createdByEmail:before?.createdByEmail??email,
   updatedAt:stamp,updatedByUid:'sample-owner',updatedByEmail:email,lastChangeId:operationId};
  mutate(record);
  const event={schemaVersion:1,operationId,recordId,revision:record.revision,action:before?'Updated':'Created',before:before?business(before):null,after:business(record),reason:'SAMPLE paired dispatch control',recordedAt:stamp,recordedByUid:'sample-owner',recordedByEmail:email,intent:'a'.repeat(64)};
  const batch=writeBatch(db);batch.set(doc(db,'government_permits',recordId),record);batch.set(doc(db,'government_permits',recordId,'changes',operationId),event);
  return {operationId,commit:()=>batch.commit()};
 }
 // Both legitimate operations must pass the same common shape/audit helpers.
 await assertSucceeds(rawPermit(id).commit());
 const original=await read('government_permits/'+id);
 const attacks={createdAt:row=>{row.createdAt=new Date('2000-01-01T00:00:00Z');},createdByUid:row=>{row.createdByUid='forged-creator';},createdByEmail:row=>{row.createdByEmail='forged-creator@example.invalid';}};
 for(const [field,mutate]of Object.entries(attacks)){
  const attempt=rawPermit(id,original,mutate);await assertFails(attempt.commit());
  assert.deepEqual(await read('government_permits/'+id),original,field);
  assert.equal(await read('government_permits/'+id+'/changes/'+attempt.operationId),undefined,field);
 }
 await assertSucceeds(rawPermit(id,original).commit());
 const updated=await read('government_permits/'+id);assert.equal(updated.revision,2);
 for(const field of Object.keys(attacks))assert.deepEqual(updated[field],original[field],field);
 const freshId=crypto.randomUUID(),wrongFirst=rawPermit(freshId,null,row=>{row.revision=2;});
 await assertFails(wrongFirst.commit());assert.equal(await read('government_permits/'+freshId),undefined);assert.equal(await read('government_permits/'+freshId+'/changes/'+wrongFirst.operationId),undefined);
 await assertSucceeds(rawPermit(freshId).commit());assert.equal((await read('government_permits/'+freshId)).revision,1);
});
