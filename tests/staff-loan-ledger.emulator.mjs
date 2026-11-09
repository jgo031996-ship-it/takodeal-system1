// Real Admin transactions on a dedicated loopback demo project; no production data.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {createStaffLoanLedgerStore} from '../functions/cash-remittance-review/staff-loan-ledger-store.mjs';
import {createStaffLoanLedgerHandler,STAFF_LOAN_ORIGIN} from '../functions/cash-remittance-review/staff-loan-ledger-handler.mjs';
import {normalizeStaffLoanLedger,staffLoanLedgerHTML} from '../takodeal-staff/staff-loan-ledger-model.js';
import {createAccessPayrollReader,createAccessPayrollAcknowledger} from '../functions/cash-remittance-review/access-payroll-store.mjs';
import {deflateSync} from 'node:zlib';
import {createAccessPayrollInputsReader} from '../functions/cash-remittance-review/access-payroll-inputs-store.mjs';
import {normalizeStaffPayslip} from '../takodeal-staff/staff-payslip-snapshot.js';
const host='127.0.0.1',port=8828,endpoint=host+':'+port,projectId='demo-private-staff-loan-ledger';
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing another Firestore endpoint.');process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json')),adminReq=createRequire(resolve(root,'functions/cash-remittance-review/package.json'));
const {initializeTestEnvironment}=req('@firebase/rules-unit-testing'),{initializeApp,deleteApp,cert}=adminReq('firebase-admin/app'),{getFirestore,FieldValue}=adminReq('firebase-admin/firestore');
const priorMetadata=process.env.METADATA_SERVER_DETECTION;process.env.METADATA_SERVER_DETECTION='none';
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let child,env,db,app,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{
 if(await reachable())throw Error('Refusing occupied emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));
 const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator startup failed: '+output);await pause(100);}
 env=await initializeTestEnvironment({projectId,firestore:{host,port}});
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 app=initializeApp({projectId,credential:cert({projectId,clientEmail:'sample-loan@'+projectId+'.iam.gserviceaccount.com',privateKey})},'private-loan-demo-only');db=getFirestore(app);db.settings({host:endpoint,ssl:false});assert.equal(app.options.projectId,projectId);
},{timeout:45000});
after(async()=>{await db?.terminate();if(app)await deleteApp(app).catch(()=>{});await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}if(priorMetadata===undefined)delete process.env.METADATA_SERVER_DETECTION;else process.env.METADATA_SERVER_DETECTION=priorMetadata;});
beforeEach(async()=>env.clearFirestore());
const uid='sample-private-phone',staffId='sample-staff',deviceId='DEV-SAMPLE-PHONE',staffName='SAMPLE Current Staff',branch='SAMPLE Branch',now=()=>Date.parse('2026-11-09T00:00:00Z'),scope={uid,staffId,deviceId};
const profile={cashierName:staffName,branch,active:true,scheduleAliases:['SAMPLE Former Staff']},config={enabled:true,policyVersion:2,brokerEndpoint:'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'},binding={uid,staffId,deviceId,branch,active:true};
const sourceLedger={staffId,staffName,branch,totalLoaned:1000,totalPaid:250,cutoffDeduction:125},sourcePayment={staffId,staffName,branch,type:'Company Loan Payment',amount:250,status:'Paid',paidAt:new Date('2026-11-01T00:00:00Z'),payrollRecordId:'saved-paid-payroll',remarks:'Auto-deducted from payslip'};
async function seed({profilePatch={},ledger=sourceLedger,payment=sourcePayment}={}){const rows={'staff_document_config/current':config,['staff_document_devices/'+uid]:binding,['cashiers/'+staffId]:{...profile,...profilePatch},...(ledger?{'staff_ledger/saved-ledger':ledger}:{}),...(payment?{'staff_deductions/saved-payment':payment}:{})};const batch=db.batch();for(const [path,data]of Object.entries(rows))batch.set(db.doc(path),data);await batch.commit();}
const store=()=>createStaffLoanLedgerStore(db,{now});
const business=async()=>Object.fromEntries(await Promise.all(['staff_ledger','staff_deductions','payroll_records','cash_accounts','expenses'].map(async table=>[table,(await db.collection(table).get()).docs.map(row=>({id:row.id,...row.data()}))])));
test('real Admin ledger → private handler → Staff renderer retains frozen repayment history with no second balance debit or finance writes',async()=>{
 await seed();await db.doc('payroll_records/saved-paid-payroll').set({staffId,finalNetPay:750,frozenData:{loans:250}});const before=await business(),physical=store();
 const handle=createStaffLoanLedgerHandler({verifyToken:async(_token,revoked)=>{assert.equal(revoked,true);return{uid,firebase:{sign_in_provider:'anonymous'}};},store:physical}),body={staffId,deviceId};
 const response=await handle({origin:STAFF_LOAN_ORIGIN,path:'/staff-loan-ledger',method:'POST',query:{},contentType:'application/json',authorization:'Bearer SAMPLE_PRIVATE_FIREBASE_TOKEN_123456789',rawSize:JSON.stringify(body).length,body});
 assert.equal(response.status,200,response.body.message);const result=normalizeStaffLoanLedger(response.body,{staffId});assert.equal(result.ledger.remainingBalance,750);assert.equal(result.ledger.totalPaid,250);assert.equal(result.history[0].payrollRecordId,'saved-paid-payroll');assert.match(staffLoanLedgerHTML(result),/₱750\.00/);assert.deepEqual(await business(),before);assert.equal((await db.collection('cash_remittance_attempts').get()).size,1);
});
test('stable IDs survive renamed names, foreign IDs are excluded and private source fields never leave the model',async()=>{
 await seed({ledger:{...sourceLedger,staffName:'SAMPLE Old Display',pin:'PRIVATE_PIN',bankAccount:'PRIVATE_BANK'},payment:{...sourcePayment,staffName:'SAMPLE Old Display',medical:'PRIVATE_MEDICAL'}});
 await db.doc('staff_ledger/foreign').set({...sourceLedger,staffId:'another-staff',totalLoaned:99999});await db.doc('staff_deductions/foreign').set({...sourcePayment,staffId:'another-staff',amount:99999});
 const result=await store().read(scope);assert.equal(result.ledger.remainingBalance,750);assert.equal(result.history.length,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|99999/);
});
test('unique saved legacy aliases are resolved but duplicate aliases hold every balance instead of exposing the wrong loan',async()=>{
 const old=profile.scheduleAliases[0],{staffId:ignored,...legacyPayment}=sourcePayment;
 await seed({ledger:{staffName:old,totalLoaned:1000,totalPaid:250,cutoffDeduction:125},payment:{...legacyPayment,staffName:old}});
 const result=await store().read(scope);assert.equal(result.ledger.remainingBalance,750);assert.equal(result.reviewRequired,false);assert.equal(result.history.length,1);
 await db.doc('cashiers/another-staff').set({cashierName:'SAMPLE Other',branch:'Other',scheduleAliases:[old]});
 await assert.rejects(store().read(scope),error=>error.status===409);
});
test('duplicate own ledgers and wrong-branch stable sources cannot publish a partial balance',async()=>{
 await seed();await db.doc('staff_ledger/duplicate').set(sourceLedger);let result=await store().read(scope);assert.equal(result.ledger,null);assert.equal(result.reviewRequired,true);
 await db.doc('staff_ledger/duplicate').delete();await db.doc('staff_ledger/saved-ledger').update({branch:'Another'});await assert.rejects(store().read(scope),error=>error.status===409);
});
test('legacy whitespace in the exact saved Owner name is queried, proved and retained rather than fabricated absent',async()=>{
 const saved='  SAMPLE Padded Staff  ';await seed({profilePatch:{cashierName:saved,scheduleAliases:[]},ledger:{staffName:saved,totalLoaned:1000,totalPaid:250,cutoffDeduction:125},payment:null});
 const result=await store().read(scope);assert.equal(result.ledger.remainingBalance,750);assert.equal(result.reviewRequired,false);
});
test('fresh config, exact UID/staff/device/branch and every canonical employment lifecycle flag is enforced',async()=>{
 await seed();
 for(const [path,patch]of [['staff_document_config/current',{enabled:false}],['staff_document_devices/'+uid,{active:false}],['staff_document_devices/'+uid,{deviceId:'DEV-OTHER-PHONE'}],['staff_document_devices/'+uid,{branch:'Other'}],['cashiers/'+staffId,{isActive:false}],['cashiers/'+staffId,{isArchived:true}],['cashiers/'+staffId,{isDeleted:true}],['cashiers/'+staffId,{revoked:true}],['cashiers/'+staffId,{employmentStatus:'Offboarded'}],['cashiers/'+staffId,{contractStatus:'Terminated'}]]){
  const original=(await db.doc(path).get()).data();await db.doc(path).update(patch);await assert.rejects(store().read(scope),error=>error.status===403);await db.doc(path).set(original);
 }
 for(const changed of [{...scope,uid:'another'},{...scope,staffId:'another'},{...scope,deviceId:'DEV-OTHER-PHONE'}])await assert.rejects(store().read(changed),error=>error.status===403);
});
test('missing and explicit-zero ledgers remain distinct, invalid totals and non-paid entries cannot create a guessed paid balance',async()=>{
 await seed({ledger:null,payment:null});let result=await store().read(scope);assert.equal(result.ledger,null);assert.equal(result.reviewRequired,false);
 await db.doc('staff_ledger/zero').set({...sourceLedger,totalLoaned:0,totalPaid:0});result=await store().read(scope);assert.equal(result.ledger.remainingBalance,0);
 await db.doc('staff_ledger/zero').update({totalLoaned:'invalid'});result=await store().read(scope);assert.equal(result.ledger,null);assert.equal(result.reviewRequired,true);
 await db.doc('staff_ledger/zero').set(sourceLedger);await db.doc('staff_deductions/unpaid').set({...sourcePayment,status:'Unpaid'});result=await store().read(scope);assert.equal(result.reviewRequired,true);assert.equal(result.historyComplete,false);assert.deepEqual(result.history,[]);
});
test('bounded overfull history is explicitly partial and cannot masquerade as a complete account',async()=>{
 await seed();for(let from=0;from<502;from+=250){const batch=db.batch();for(let n=from;n<Math.min(502,from+250);n++)batch.set(db.doc('staff_deductions/sample-'+String(n).padStart(4,'0')),{staffId,staffName,type:'Staff Meal',amount:1,status:'Paid'});await batch.commit();}
 const result=await store().read(scope);assert.equal(result.historyComplete,false);assert.equal(result.reviewRequired,true);assert.match(staffLoanLedgerHTML(result),/balance is unavailable/);
});
const frozenPayroll={staffId,name:staffName,branch,start:'2026-10-01',end:'2026-10-15',isPaid:true,basicPay:120,nightBonus:0,overtime:50,customDeductionsTotal:20,customDeductions:[{name:'Owner edited Wi-Fi',amount:20}],finalNetPay:100,profile:{staffId,cashierName:staffName,hourlyRate:450,pin:'PRIVATE_PIN',payslipPin:{hash:'PRIVATE_VERIFIER'},bankAccount:'PRIVATE_BANK',sssNumber:'PRIVATE_GOV'},logs:[{date:'2026-10-01',hrs:8,remark:'Saved hours',phone:'PRIVATE_PHONE'}],deductionDetails:[{id:'meal',type:'Staff Meal',bucket:'meals',amount:0,privateFinding:'PRIVATE_HR',items:[{name:'Sample food',qty:1,phone:'PRIVATE_FOOD_PHONE',addons:{extra:{name:'Extra option',qty:1,privateRecord:'PRIVATE_OPTION'}}}]}]};
const savedPayroll={staffId,staffName,branch,startDate:frozenPayroll.start,endDate:frozenPayroll.end,finalNetPay:100,processedAt:new Date('2026-10-16T00:00:00Z'),acknowledged:true,signatureBase64:'data:image/png;base64,U0FNUExFX1NJR05BVFVSRQ==',frozenData:frozenPayroll};
test('private payroll endpoint preserves manual amounts, edited zeros, labels and saved signature while projecting all private profile fields',async()=>{
 await seed();await db.doc('payroll_records/saved-owner-payslip').set(savedPayroll);const before=await business(),result=await createAccessPayrollReader(db,{now})(scope);
 assert.equal(result.complete,true);assert.equal(result.held.length,0);assert.equal(result.records.length,1);const record=result.records[0],data=normalizeStaffPayslip(record,{staffId});assert.equal(data.finalNetPay,100);assert.equal(data.nightBonus,0);assert.equal(data.totalDeductions,20);assert.equal(data.customDeductions[0].name,'Owner edited Wi-Fi');assert.equal(record.signatureBase64,savedPayroll.signatureBase64);assert.equal(record.frozenData.deductionDetails[0].items[0].addons.extra.name,'Extra option');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);assert.deepEqual(await business(),before);
});
test('private payroll reads all four stable-ID schemas and excludes foreign-ID aliases',async()=>{
 await seed();for(const [index,make]of [row=>({...row,staffId}),row=>({...row,frozenData:{...row.frozenData,staffId}}),row=>({...row,frozenData:{...row.frozenData,profile:{staffId}}}),row=>({...row,frozenData:{...row.frozenData,profile:{id:staffId}}})].entries()){
  const base={staffName:'SAMPLE Old Staff',branch,finalNetPay:100,frozenData:{...frozenPayroll,name:'SAMPLE Old Staff'}};delete base.frozenData.staffId;delete base.frozenData.profile;await db.doc('payroll_records/id-'+index).set(make(base));
 }
 await db.doc('payroll_records/foreign').set({...savedPayroll,staffId:'other',frozenData:{...frozenPayroll,staffId:'other',profile:{staffId:'other'}},finalNetPay:9999});const result=await createAccessPayrollReader(db,{now})(scope);assert.equal(result.records.length,4);assert.equal(result.held.length,0);assert.doesNotMatch(JSON.stringify(result),/9999/);
});
test('private payroll proves unique legacy aliases server-side and holds an ambiguous old name without exposing its record',async()=>{
 const old=profile.scheduleAliases[0];await seed();const legacy={staffName:old,finalNetPay:100,frozenData:{...frozenPayroll,name:old}};delete legacy.frozenData.staffId;delete legacy.frozenData.profile;await db.doc('payroll_records/legacy-random-id').set(legacy);
 let result=await createAccessPayrollReader(db,{now})(scope);assert.equal(result.records.length,1);assert.equal(result.records[0].staffId,staffId);assert.equal(normalizeStaffPayslip(result.records[0],{staffId}).finalNetPay,100);
 await db.doc('cashiers/other').set({cashierName:'SAMPLE Other',branch:'Other',scheduleAliases:[old]});result=await createAccessPayrollReader(db,{now})(scope);assert.equal(result.records.length,0);assert.equal(result.complete,false);assert.equal(result.held.length,1);assert.equal(result.held[0].recordId,undefined);
});
test('private payroll canonical read holds malformed late payment instead of allowing an unpaid shared duplicate',async()=>{
 await seed();await db.doc('staff_payslip_previews/shared-preview').set({staffId,startDate:frozenPayroll.start,endDate:frozenPayroll.end});const canonical='payroll-'+staffId+'-'+frozenPayroll.start+'-'+frozenPayroll.end;await db.doc('payroll_records/'+canonical).set({staffId:'other',staffName:'SAMPLE Other',finalNetPay:99999});
 const result=await createAccessPayrollReader(db,{now})(scope);assert.equal(result.records.length,0);assert.equal(result.held[0].recordId,canonical);assert.doesNotMatch(JSON.stringify(result),/99999|SAMPLE Other/);
});
test('private payroll rejects fresh grant and employment revocation and never reconstructs a malformed paid snapshot',async()=>{
 await seed();await db.doc('payroll_records/bad').set({...savedPayroll,frozenData:{...frozenPayroll,customDeductionsTotal:20,basicPay:{privatePin:'SECRET'}}});let result=await createAccessPayrollReader(db,{now})(scope);assert.equal(result.records.length,0);assert.equal(result.held.length,1);assert.doesNotMatch(JSON.stringify(result),/SECRET/);
 await db.doc('staff_document_devices/'+uid).update({active:false});await assert.rejects(createAccessPayrollReader(db,{now})(scope),error=>error.status===403);await db.doc('staff_document_devices/'+uid).update({active:true});await db.doc('cashiers/'+staffId).update({isActive:false});await assert.rejects(createAccessPayrollReader(db,{now})(scope),error=>error.status===403);
});
const crc32=bytes=>{let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=crc>>>1^(crc&1?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
function signature(width=32,height=16){const chunk=(type,data)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length,0);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;},header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const raw=Buffer.alloc((32*4+1)*16);for(let row=0;row<16;row++){raw[row*129]=0;for(let col=0;col<32;col++)raw[row*129+col*4+4]=255;}return'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
async function ackFixture({legacy=false,protectedPatch={}}={}){
 await seed();const source={...savedPayroll,acknowledged:false,frozenData:{...frozenPayroll,...protectedPatch}};delete source.signatureBase64;
 if(legacy){source.staffName=profile.scheduleAliases[0];source.frozenData.name=source.staffName;delete source.staffId;delete source.frozenData.staffId;source.frozenData.profile={...source.frozenData.profile};delete source.frozenData.profile.staffId;}
 await db.doc('payroll_records/sample-acknowledgment').set(source);const result=await createAccessPayrollReader(db,{now})(scope);assert.equal(result.records.length,1);const body={...scope,recordId:'sample-acknowledgment',signatureBase64:signature(),expectedFingerprint:result.records[0].fingerprint,operationId:'sample-ack-operation'},ack=createAccessPayrollAcknowledger(db,{now,serverTimestamp:()=>FieldValue.serverTimestamp()});return{body,ack,source};
}
test('ordinary private acknowledgment preserves every paid financial field and retries only the exact saved operation/image',async()=>{
 const {ack,body,source}=await ackFixture(),before=await business();let result=await ack(body);assert.equal(result.alreadySaved,false);const saved=(await db.doc('payroll_records/'+body.recordId).get()).data();assert.equal(saved.acknowledged,true);assert.equal(saved.signatureBase64,body.signatureBase64);assert.deepEqual(saved.frozenData,source.frozenData);assert.equal(saved.finalNetPay,100);
 result=await ack(body);assert.equal(result.alreadySaved,true);await assert.rejects(ack({...body,operationId:'another-ack-operation'}),error=>error.status===409);
 const after=await business();for(const table of ['staff_ledger','staff_deductions','cash_accounts','expenses'])assert.deepEqual(after[table],before[table]);const receipt=(await db.collection('staff_access_operations').get()).docs[0].data();assert.equal(Object.keys(receipt).some(key=>/pin/i.test(key)),false);
});
test('ordinary legacy acknowledgment requires fresh unique-name proof and never writes a fabricated staff ID or financial field',async()=>{
 const {ack,body}=await ackFixture({legacy:true});await ack(body);const saved=(await db.doc('payroll_records/'+body.recordId).get()).data();assert.equal(saved.staffId,undefined);assert.equal(saved.acknowledged,true);assert.equal(saved.finalNetPay,100);
 await env.clearFirestore();const ambiguous=await ackFixture({legacy:true});await db.doc('cashiers/another').set({cashierName:'SAMPLE Other',scheduleAliases:profile.scheduleAliases,branch:'Other'});await assert.rejects(ambiguous.ack(ambiguous.body),error=>error.status===409);assert.equal((await db.doc('payroll_records/'+ambiguous.body.recordId).get()).data().acknowledged,false);
});
test('stale financial fingerprint, revoked private grant and existing reviewed-case markers cannot use ordinary acknowledgment',async()=>{
 let f=await ackFixture();await db.doc('payroll_records/'+f.body.recordId).update({'frozenData.basicPay':125});await assert.rejects(f.ack(f.body),error=>error.status===409);assert.equal((await db.doc('payroll_records/'+f.body.recordId).get()).data().acknowledged,false);
 await env.clearFirestore();f=await ackFixture();await db.doc('staff_document_devices/'+uid).update({active:false});await assert.rejects(f.ack(f.body),error=>error.status===403);
 for(const patch of [{cashShortages:1},{ownerDeductions:1},{ownerDeductionRows:[{id:'case',amount:1}]},{payrollRecoveryRows:[{id:'recovery',amount:1}]}]){await env.clearFirestore();f=await ackFixture({protectedPatch:patch});await assert.rejects(f.ack(f.body),error=>error.code==='access/payroll-protected');assert.equal((await db.doc('payroll_records/'+f.body.recordId).get()).data().acknowledged,false);}
});
test('signature PNG validation rejects excess bytes, dimensions, damaged CRC and unsupported compressed image before writes',async()=>{
 const {ack,body}=await ackFixture(),broken=Buffer.from(body.signatureBase64.slice(22),'base64');broken[20]^=1;
 for(const image of ['data:image/png;base64,'+'A'.repeat(350000),signature(5000,16),'data:image/png;base64,'+broken.toString('base64'),signature(32,20),'data:image/jpeg;base64,AAAA'])await assert.rejects(ack({...body,signatureBase64:image}),error=>error.status===400);
 assert.equal((await db.doc('payroll_records/'+body.recordId).get()).data().acknowledged,false);assert.equal((await db.collection('staff_access_operations').get()).size,0);
});
test('private payroll inputs use exact IDs and fresh unique aliases, preserve selected food details and exclude photos/private fields',async()=>{
 await seed();const old=profile.scheduleAliases[0],big='PRIVATE_IMAGE_'+ 'x'.repeat(500000);
 await db.doc('staff_deductions/legacy-meal').set({staffName:old,type:'Staff Meal',amount:30,status:'Unpaid',dateAdded:new Date('2026-11-01'),items:[{name:'Sample food',qty:1,variantName:'Large',addons:{extra:{name:'Sample option',qty:1,bank:'PRIVATE_ITEM_BANK'}},image:big}],phone:'PRIVATE_PHONE',bank:'PRIVATE_BANK',image:big});
 await db.doc('staff_bonuses/own-bonus').set({staffId,staffName:'SAMPLE Older Name',type:'Performance Bonus',amount:50,status:'Unpaid',dateAdded:new Date('2026-11-01'),privateNotes:'PRIVATE_BONUS'});await db.doc('staff_bonuses/foreign').set({staffId:'other',staffName,amount:99999,type:'Performance Bonus'});
 const before=await business(),result=await createAccessPayrollInputsReader(db,{now})(scope);assert.equal(result.complete,true);assert.equal(result.staffBonuses.length,1);assert.equal(result.staffBonuses[0].amount,50);const meal=result.staffDeductions.find(row=>row.id==='legacy-meal');assert.equal(meal.staffId,staffId);assert.equal(meal.amount,30);assert.equal(meal.items[0].variantName,'Large');assert.equal(meal.items[0].addons.extra.name,'Sample option');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|99999/);assert.ok(JSON.stringify(result).length<5000);assert.deepEqual(await business(),before);
 await db.doc('cashiers/other-alias').set({cashierName:'SAMPLE Other',branch:'Other',scheduleAliases:[old]});const ambiguous=await createAccessPayrollInputsReader(db,{now})(scope);assert.equal(ambiguous.complete,false);assert.equal(ambiguous.staffDeductions.some(row=>row.id==='legacy-meal'),false);
});
test('private input metadata is paged without false truncation, while an invalid amount holds the estimate rather than inventing zero',async()=>{
 await seed();const batch=db.batch();for(let n=0;n<30;n++)batch.set(db.doc('staff_deductions/sample-page-'+String(n).padStart(2,'0')),{staffId,staffName,type:'Staff Meal',amount:1,status:'Unpaid',dateAdded:new Date('2026-11-01')});await batch.commit();
 let result=await createAccessPayrollInputsReader(db,{now})(scope);assert.equal(result.complete,true);assert.equal(result.staffDeductions.length,31);
 await db.doc('staff_bonuses/invalid').set({staffId,staffName,type:'Performance Bonus',amount:NaN});result=await createAccessPayrollInputsReader(db,{now})(scope);assert.equal(result.complete,false);assert.equal(result.staffBonuses.length,0);
 await db.doc('staff_document_devices/'+uid).update({active:false});await assert.rejects(createAccessPayrollInputsReader(db,{now})(scope),error=>error.status===403);
});
