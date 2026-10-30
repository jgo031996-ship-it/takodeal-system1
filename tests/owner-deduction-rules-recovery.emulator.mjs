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

async function reply(id,message='This is my fictional explanation of the damaged item.'){await updateDoc(doc(staff(),'staff_deduction_notices',id),{staffReply:message,replyRevision:1,repliedAt:serverTimestamp(),repliedByUid:'staff-phone'});}
function approval(db,row,{amount=90,effectiveDate=plain(),review={},charge={},notice={}}={}){const batch=writeBatch(db),fields={amount,authorizedAmount:amount,effectiveDate};batch.update(doc(db,'owner_deduction_reviews',row.id),{...fields,status:'Approved',revision:2,lawfulBasis:'Legal authority permitting this deduction',authorityReference:'Fictional documented authority reference.',finding:'Fictional review records the established responsibility and permitted amount.',responsibilityConfirmed:true,lawfulAuthorityConfirmed:true,weeklyLimitConfirmed:true,replyRevisionReviewed:1,approvalIntent:'fictional-approval-intent',reviewedAt:serverTimestamp(),reviewedBy:ownerEmail,...review});batch.update(doc(db,'staff_deductions',row.id),{...fields,status:'Unpaid',reviewRevision:2,reviewedAt:serverTimestamp(),reviewedBy:ownerEmail,...charge});batch.update(doc(db,'staff_deduction_notices',row.id),{amount,effectiveDate,status:'Approved',noticeRevision:2,lawfulBasis:'Legal authority permitting this deduction',authorityReference:'Fictional documented authority reference.',finding:'Fictional review records the established responsibility and permitted amount.',ownerReply:'Fictional review records the established responsibility and permitted amount.',weeklyLimitConfirmed:true,updatedAt:serverTimestamp(),...notice});return batch;}
async function seedApproved(n=1){const row=await seedPending(n);await reply(row.id);await admin(db=>approval(db,row).commit());return row;}
function payrollBatch(db,rows,{patch={},debit=450-90*rows.length,expense=true,bank=true,omitTable,paidAmount,detailsPatch}={}){const id='payroll-staff-a-'+plain()+'-'+offset(14),batch=writeBatch(db),end=offset(14),tuples=rows.map(row=>({id:row.id,amount:90})),details=rows.map(row=>({id:row.id,type,bucket:'ownerDeductions',amount:90,label:row.charge.label,category:row.charge.category,incidentDate:plain(),effectiveDate:plain(),reviewRevision:2,...detailsPatch})),record={staffId:'staff-a',staffName:profile.cashierName,branch:'Maa',startDate:plain(),endDate:end,frozenData:{staffId:'staff-a',name:profile.cashierName,branch:'Maa',isPaid:true,basicPay:450,ownerDeductions:90*rows.length,ownerDeductionRows:tuples,ownerDeductionDetails:details},finalNetPay:450-90*rows.length,accountId:'bank',accountName:'Fictional bank',ownerDeductionSettlements:Object.fromEntries(tuples.map(row=>[row.id,row.amount])),processedAt:serverTimestamp(),processedBy:ownerEmail,acknowledged:false,...patch};batch.set(doc(db,'payroll_records',id),record);for(const row of rows)for(const table of ['owner_deduction_reviews','staff_deductions','staff_deduction_notices'])if(table!==omitTable)batch.update(doc(db,table,row.id),{status:'Paid',paidAt:serverTimestamp(),payrollRecordId:id,...(paidAmount!==undefined?{amount:paidAmount}:{})});if(bank)batch.update(doc(db,'cash_accounts/bank'),{balance:1000-debit});if(expense)batch.set(doc(db,'expenses',id),{branch:'Main Office',category:'Payroll',amount:record.finalNetPay,account:'Fictional bank',note:'Fictional payroll only',payrollRecordId:id,timestamp:serverTimestamp()});return {batch,id,record};}
const seedBank=()=>seed('cash_accounts/bank',{branch:'Main Office',name:'Fictional bank',balance:1000});



const reviewChanges=(revision=3,amount=80)=>({
 review:{amount,authorizedAmount:amount,effectiveDate:plain(),status:'Approved',revision,replyRevisionReviewed:1,reviewedAt:serverTimestamp(),reviewedBy:ownerEmail},
 charge:{amount,authorizedAmount:amount,effectiveDate:plain(),status:'Unpaid',reviewRevision:revision,reviewedAt:serverTimestamp(),reviewedBy:ownerEmail},
 notice:{amount,effectiveDate:plain(),status:'Approved',noticeRevision:revision,updatedAt:serverTimestamp()}
});
async function ownerApproved(n=1){const row=await seedPending(n);await reply(row.id);await assertSucceeds(approval(owner(),row).commit());return row;}
for(const selected of [['staff_deductions','charge'],['staff_deduction_notices','notice'],['staff_deductions','charge','staff_deduction_notices','notice']])test('v2: old Approved source cannot authorize standalone review '+selected.join('/'),async()=>{
 const row=await ownerApproved(),change=reviewChanges(),db=owner(),batch=writeBatch(db);
 for(let i=0;i<selected.length;i+=2)batch.update(doc(db,selected[i],row.id),change[selected[i+1]]);
 await assertFails(batch.commit());
 assert.equal((await getDocFromServer(doc(db,'owner_deduction_reviews',row.id))).data().revision,2);
 assert.equal((await getDocFromServer(doc(db,'staff_deductions',row.id))).data().amount,90);
 assert.equal((await getDocFromServer(doc(db,'staff_deduction_notices',row.id))).data().noticeRevision,2);
});
for(const status of ['Pending Review','Approved'])test('v2: source-only '+status+' revision change cannot skip exact companion review',async()=>{
 const row=status==='Approved'?await ownerApproved():await seedPending();if(status!=='Approved')await reply(row.id);
 const revision=status==='Approved'?3:2;
 await assertFails(updateDoc(doc(owner(),'owner_deduction_reviews',row.id),reviewChanges(revision).review));
});
test('v2: restamping a previous source without increasing revision cannot authorize companion updates',async()=>{
 const row=await ownerApproved(),change=reviewChanges(),db=owner(),batch=writeBatch(db);
 batch.update(doc(db,'owner_deduction_reviews',row.id),{reviewedAt:serverTimestamp(),reviewedBy:ownerEmail});
 batch.update(doc(db,'staff_deductions',row.id),change.charge);batch.update(doc(db,'staff_deduction_notices',row.id),change.notice);
 await assertFails(batch.commit());
});
test('v2: an attempted revision jump cannot authorize three otherwise matching review updates',async()=>{
 const row=await seedPending();await reply(row.id);
 await assertFails(approval(owner(),row,{review:{revision:3},charge:{reviewRevision:3},notice:{noticeRevision:3}}).commit());
});
test('v2: actual approval followed by a new Staff reply and monotonic re-review updates all exact links',async()=>{
 const row=await ownerApproved();await updateDoc(doc(staff(),'staff_deduction_notices',row.id),{staffReply:'A second fictional explanation for the reviewed incident.',replyRevision:2,repliedAt:serverTimestamp(),repliedByUid:'staff-phone'});
 await assertSucceeds(approval(owner(),row,{amount:80,review:{revision:3,replyRevisionReviewed:2},charge:{reviewRevision:3},notice:{noticeRevision:3}}).commit());
 const source=(await getDocFromServer(doc(owner(),'owner_deduction_reviews',row.id))).data(),charge=(await getDocFromServer(doc(owner(),'staff_deductions',row.id))).data(),notice=(await getDocFromServer(doc(owner(),'staff_deduction_notices',row.id))).data();
 assert.equal(source.revision,3);assert.equal(source.replyRevisionReviewed,2);assert.equal(charge.reviewRevision,3);assert.equal(notice.noticeRevision,3);assert.equal(notice.replyRevision,2);assert.equal(charge.amount,80);
});
for(const start of ['Pending Review','Approved'])test('v2: correct '+start+' dismissal still updates all companions without a payroll posting',async()=>{
 const row=start==='Approved'?await ownerApproved():await seedPending(),revision=start==='Approved'?3:2,reason='Fictional review did not establish this proposed charge.',db=owner(),batch=writeBatch(db);
 batch.update(doc(db,'owner_deduction_reviews',row.id),{status:'Dismissed',amount:0,authorizedAmount:0,revision,dismissalReason:reason,reviewedAt:serverTimestamp(),reviewedBy:ownerEmail});
 batch.update(doc(db,'staff_deductions',row.id),{status:'Dismissed',amount:0,authorizedAmount:0,reviewRevision:revision,reviewedAt:serverTimestamp(),reviewedBy:ownerEmail});
 batch.update(doc(db,'staff_deduction_notices',row.id),{status:'Dismissed',amount:0,noticeRevision:revision,ownerReply:reason,updatedAt:serverTimestamp()});
 await assertSucceeds(batch.commit());for(const table of ['owner_deduction_reviews','staff_deductions','staff_deduction_notices']){const stored=(await getDocFromServer(doc(db,table,row.id))).data();assert.equal(stored.status,'Dismissed');assert.equal(stored.amount,0);assert.equal(stored.payrollRecordId,undefined);}
});
for(const key of ['charge','notice'])for(const [field,value]of [['label','A renamed incident'],['staffId','staff-b'],['branch','Cabantian'],['amount',50],['effectiveDate',offset(1)],['sourceReceiptId','another-id']])test('v2: '+key+' review cannot change joined '+field+' while source revision advances',async()=>{
 const row=await ownerApproved();await assertFails(approval(owner(),row,{review:{revision:3},charge:{reviewRevision:3,...(key==='charge'?{[field]:value}:{})},notice:{noticeRevision:3,...(key==='notice'?{[field]:value}:{})}}).commit());
 assert.equal((await getDocFromServer(doc(owner(),'owner_deduction_reviews',row.id))).data().revision,2);
});
for(const review of [{responsibilityConfirmed:false},{lawfulAuthorityConfirmed:false},{weeklyLimitConfirmed:false},{authorityReference:'bad'},{replyRevisionReviewed:0},{finding:'bad'}])test('v2: companion dedup retains authoritative responsibility, authority and reply review '+Object.keys(review)[0],async()=>{
 const row=await seedPending();await reply(row.id);await assertFails(approval(owner(),row,{review}).commit());
});
for(const kind of ['owner','cash'])for(const status of ['Pending Review','Approved','Paid'])test('v2: hoisted '+kind+' '+status+' notice read/reply belongs only to its approved Staff phone',async()=>{
 let id,notice;
 if(kind==='owner'){const row=pending();id=row.id;notice={...row.notice,status,noticeRevision:2,replyRevision:1,staffReply:'The original fictional explanation.',amount:status==='Pending Review'?0:90};}
 else{const row=approvedCashShortage({shiftId:'fictional-cash',staffId:'staff-a',name:profile.cashierName,branch:'Maa',amount:90,effectiveDate:plain()});id=row.id;notice={...row.notice,status,readRevision:0};}
 await seed('staff_deduction_notices/'+id,notice);
 const ownRef=doc(staff(),'staff_deduction_notices',id),foreignRef=doc(otherStaff(),'staff_deduction_notices',id);
 await assertSucceeds(getDocFromServer(ownRef));await assertFails(getDocFromServer(foreignRef));
 await assertSucceeds(updateDoc(ownRef,{readRevision:2,readAt:serverTimestamp()}));
 await assertFails(updateDoc(foreignRef,{readRevision:2,readAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ownRef,{staffReply:'My updated fictional explanation, not financial authorization.',replyRevision:2,repliedAt:serverTimestamp(),repliedByUid:'staff-phone'}));
 await assertFails(updateDoc(foreignRef,{staffReply:'A foreign reply.',replyRevision:3,repliedAt:serverTimestamp(),repliedByUid:'other-phone'}));
 await assertFails(updateDoc(ownRef,{staffReply:'Cannot combine a reply with an amount change.',replyRevision:3,repliedAt:serverTimestamp(),repliedByUid:'staff-phone',amount:1}));
 await assertFails(updateDoc(ownRef,{staffId:'staff-b',readRevision:2,readAt:serverTimestamp()}));
 const stored=(await getDocFromServer(ownRef)).data();assert.equal(stored.amount,notice.amount);assert.equal(stored.status,status);assert.equal(stored.staffId,'staff-a');assert.equal(stored.replyRevision,2);
});
test('v2: Paid source cannot be re-reviewed and original linked payroll amount stays immutable',async()=>{
 const row=await ownerApproved();await seedBank();const {batch,id}=payrollBatch(owner(),[row]);await assertSucceeds(batch.commit());
 await assertFails(approval(owner(),row,{amount:80,review:{revision:3},charge:{reviewRevision:3},notice:{noticeRevision:3}}).commit());
 const saved=(await getDocFromServer(doc(owner(),'payroll_records',id))).data();assert.equal(saved.finalNetPay,360);assert.equal(saved.frozenData.ownerDeductions,90);assert.equal((await getDocFromServer(doc(owner(),'owner_deduction_reviews',row.id))).data().status,'Paid');
});
