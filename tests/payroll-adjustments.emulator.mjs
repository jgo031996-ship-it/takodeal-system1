// Actual payroll credit/recovery services, real Firebase SDK and unchanged Rules.
// Only synthetic records in a fresh loopback demo project are used.
import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {finalizeOrdinaryPayroll,ordinaryPayrollId} from '../takodeal-manager/payroll-settlement.js';
import {createPayrollAdjustmentService} from '../takodeal-manager/payroll-adjustments.js';
import {createOwnerDeductionService} from '../takodeal-manager/owner-deductions.js';
import {OWNER_DEDUCTION_BASES} from '../takodeal-manager/owner-deduction-model.js';
import {payrollAdjustmentPreview} from '../takodeal-manager/payroll-adjustment-model.js';

const host = '127.0.0.1', port = 8878, projectId = 'demo-payroll-adjustments';
const endpoint = host + ':' + port;
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== endpoint) {
    throw Error('Refusing a non-test Firestore endpoint.');
}
process.env.FIRESTORE_EMULATOR_HOST = endpoint;
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = resolve(root, '../staff-nextlevel-tools');
const req = createRequire(resolve(tools, 'package.json'));
const {initializeTestEnvironment} = req('@firebase/rules-unit-testing');
const sdk = req('firebase/firestore');
sdk.setLogLevel('silent');
const {doc, setDoc, getDocFromServer, getDocsFromServer, collection, query, where, limit,
    runTransaction, serverTimestamp, Timestamp, updateDoc} = sdk;
const java = JSON.parse(readFileSync(resolve(tools, 'runtime.json'))).java;
const jar = resolve(tools, 'emulators/cloud-firestore-emulator-v1.22.0.jar');
if (!existsSync(java) || !existsSync(jar)) throw Error('Local emulator runtime missing.');
let env, child, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reachable = () => new Promise(resolve => {
    const socket = createConnection({host, port});
    socket.setTimeout(250);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
before(async () => {
    if (await reachable()) throw Error('Refusing an occupied emulator port.');
    child = spawn(java, ['-jar', jar, '--host', host, '--port', String(port), '--project_id', projectId], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', value => output = (output + value).slice(-16000));
    }
    const until = Date.now() + 30000;
    while (!await reachable()) {
        if (child.exitCode !== null || Date.now() > until) throw Error('Local emulator did not start: ' + output);
        await pause(100);
    }
    env = await initializeTestEnvironment({projectId, firestore: {
        host, port, rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8')
    }});
}, {timeout: 45000});
after(async () => {
    await env?.cleanup();
    if (child && child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, 'exit'), pause(3000)]);
    }
});
beforeEach(async () => { await env.clearFirestore(); });

const STAFF='fictional-adjustment-staff',NAME='Fictional Adjustment Crew',BRANCH='Synthetic Payroll Branch';
const UID='fictional-adjustment-owner',EMAIL='jgo031996@gmail.com',BANK='fictional-payroll-bank';
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const offset=days=>new Date(Date.parse(today+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const originalStart=offset(-30),originalEnd=offset(-16),end=offset(14);
const admin=callback=>env.withSecurityRulesDisabled(context=>callback(context.firestore()));
const original=()=>({staffId:STAFF,staffName:NAME,branch:BRANCH,startDate:originalStart,endDate:originalEnd,finalNetPay:1000,processedAt:Timestamp.fromDate(new Date(originalEnd+'T12:00:00Z')),frozenData:{staffId:STAFF,name:NAME,branch:BRANCH,start:originalStart,end:originalEnd,basicPay:1000,finalNetPay:1000,isPaid:true,logs:[{date:originalStart,remark:'Fictional original payroll attendance'}]}});
const request=extra=>({staffId:STAFF,originalStart,originalEnd,effectiveDate:today,amount:125,reason:'The earlier payroll missed the saved allowance.',sourcePayrollRecordId:'original-paid',...extra});
async function fixture({paid=true}={}){
 await admin(async db=>{
  await setDoc(doc(db,'hq_managers',UID),{email:EMAIL,role:'System Architect',permissions:['all'],assignedBranch:'All',pin:'fixture-only',active:true});
  await setDoc(doc(db,'cashiers',STAFF),{cashierName:NAME,branch:BRANCH,role:'Crew',hourlyRate:450,dateHired:'2020-01-01',pin:'fixture-only',active:true});
  await setDoc(doc(db,'cash_accounts',BANK),{name:'Fictional Payroll Bank',branch:BRANCH,balance:5000});
  await setDoc(doc(db,'staff_document_devices','fictional-staff-phone'),{uid:'fictional-staff-phone',staffId:STAFF,active:true});
  if(paid)await setDoc(doc(db,'payroll_records','original-paid'),original());
 });
 const db=env.authenticatedContext(UID,{email:EMAIL,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();let loseAck=false;
 const api={...sdk,db,auth:{currentUser:{uid:UID,email:EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:UID,email:EMAIL,isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,runTransaction:async(...args)=>{const result=await runTransaction(...args);if(loseAck){loseAck=false;throw Error('Synthetic payroll response lost after commit');}return result;}};
 const service=createPayrollAdjustmentService(api),reviews=createOwnerDeductionService(api),data={staffId:STAFF,name:NAME,branch:BRANCH,start:today,end,profile:{staffId:STAFF,cashierName:NAME,role:'Crew',hourlyRate:450,dateHired:'2020-01-01'},basicPay:450,meals:0,advances:0,loans:0,perfBonus:0,customDeductions:[],customDeductionsTotal:0,logs:[]};
 const staffDb=env.authenticatedContext('fictional-staff-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore();
 return {api,service,reviews,data,staffDb,loseNextAck:()=>{loseAck=true;},pay:()=>finalizeOrdinaryPayroll(api,{data,accountId:BANK,finalNetPay:450+(data.payrollAdjustments||0)-(data.ownerDeductions||0)}),reply:(id,revision=1)=>updateDoc(doc(staffDb,'staff_deduction_notices',id),{staffReply:'Fictional staff response to the original payroll recovery.',replyRevision:revision,repliedAt:serverTimestamp(),repliedByUid:'fictional-staff-phone'})};
}
async function state(){let result;await admin(async db=>{const rows=async table=>(await getDocsFromServer(collection(db,table))).docs.map(snap=>({id:snap.id,...snap.data()})).sort((a,b)=>a.id.localeCompare(b.id));result={accounts:await rows('cash_accounts'),payroll:await rows('payroll_records'),expenses:await rows('expenses'),credits:await rows('staff_bonuses'),reviews:await rows('owner_deduction_reviews'),deductions:await rows('staff_deductions'),notices:await rows('staff_deduction_notices')};});return result;}
async function approvedRecovery(f){
 const prefill=await f.service.prepareRecovery(request({reason:'The earlier payroll included a duplicate allowance.'})),created=await f.reviews.create(prefill);await f.reply(created.id);
 await f.reviews.approve(created.id,{amount:125,effectiveDate:today,lawfulBasis:OWNER_DEDUCTION_BASES[0],authorityReference:'Fictional applicable authority reviewed for this test.',finding:'Fictional responsibility and payroll-limit review after the saved staff response.',responsibilityConfirmed:true,lawfulAuthorityConfirmed:true,weeklyLimitConfirmed:true,expectedRevision:1,expectedReplyRevision:1});
 f.data.ownerDeductions=125;f.data.ownerDeductionRows=[{id:created.id,amount:125}];return created.id;
}

test('real SDK creates one distinct positive credit and pays it once after a lost acknowledgement without changing original payroll',async()=>{
 const f=await fixture(),created=await f.service.create(request()),again=await f.service.create(request());assert.equal(again.id,created.id);assert.equal(again.alreadySaved,true);
 const credit=(await getDocFromServer(doc(f.api.db,'staff_bonuses',created.id))).data(),preview=payrollAdjustmentPreview([{...credit,id:created.id}],{staffId:STAFF,name:NAME,branch:BRANCH,start:today,end});f.data.payrollAdjustments=preview.amount;f.data.payrollAdjustmentRows=preview.rows;
 f.loseNextAck();await assert.rejects(f.pay(),/response lost/);const committed=await state(),paid=await f.pay();assert.equal(paid.alreadyPaid,true);assert.equal(paid.finalNetPay,575);assert.equal(committed.accounts[0].balance,4425);assert.equal(committed.credits.length,1);assert.equal(committed.credits[0].status,'Paid');assert.equal(committed.credits[0].payrollRecordId,paid.id);assert.equal(paid.frozenData.payrollAdjustmentRows[0].originalEnd,originalEnd);assert.equal(paid.frozenData.perfBonus,0);assert.deepEqual(await state(),committed);assert.deepEqual(committed.payroll.find(row=>row.id==='original-paid'),{id:'original-paid',...original()});
});
test('real protected recovery requires Staff response and Owner review, then settles exact base tuples plus separate source metadata once',async()=>{
 const f=await fixture(),id=await approvedRecovery(f);f.loseNextAck();await assert.rejects(f.pay(),/response lost/);const committed=await state(),paid=await f.pay();assert.equal(paid.alreadyPaid,true);assert.equal(paid.finalNetPay,325);assert.equal(committed.accounts[0].balance,4675);assert.equal(committed.expenses.length,1);assert.equal(paid.frozenData.ownerDeductionDetails[0].id,id);assert.equal(Object.hasOwn(paid.frozenData.ownerDeductionDetails[0],'payrollRecovery'),false);assert.equal(paid.frozenData.payrollRecoveryRows[0].sourcePayrollRecordId,'original-paid');assert.equal(paid.frozenData.payrollRecoveryRows[0].reason,'The earlier payroll included a duplicate allowance.');for(const rows of [committed.reviews,committed.deductions,committed.notices]){assert.equal(rows[0].status,'Paid');assert.equal(rows[0].payrollRecordId,paid.id);}assert.deepEqual(await state(),committed);assert.deepEqual(committed.payroll.find(row=>row.id==='original-paid'),{id:'original-paid',...original()});
});
test('a newer real Staff response holds the approved recovery and leaves all payroll financial records untouched',async()=>{
 const f=await fixture(),id=await approvedRecovery(f);await f.reply(id,2);const before=await state();await assert.rejects(f.pay(),/one.time|owner.added/i);assert.deepEqual(await state(),before);assert.equal(before.accounts[0].balance,5000);
});
test('an unpaid credit remains cancellable by its stable staff ID after a saved rename and branch transfer',async()=>{
 const f=await fixture(),created=await f.service.create(request());await admin(db=>updateDoc(doc(db,'cashiers',STAFF),{cashierName:'Fictional Renamed Crew',branch:'Synthetic Transfer Branch'}));const before=await state(),result=await f.service.cancel(created.id,{reason:'Reissue under the confirmed current name and branch.'});assert.equal(result.status,'Cancelled');const after=await state();assert.equal(after.credits[0].status,'Cancelled');assert.equal(after.credits[0].staffName,NAME);assert.equal(after.credits[0].branch,BRANCH);assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.payroll,before.payroll);assert.deepEqual(after.expenses,before.expenses);
});
test('a real original-payment sentinel inserted after preflight stops an unlinked forgotten-pay credit',async()=>{
 const f=await fixture({paid:false}),run=f.api.runTransaction,sourceId=ordinaryPayrollId(STAFF,originalStart,originalEnd);let once=true;f.api.runTransaction=async(...args)=>{if(once){once=false;await admin(db=>setDoc(doc(db,'payroll_records',sourceId),original()));}return run(...args);};await assert.rejects(f.service.create(request({sourcePayrollRecordId:''})),/original payment appeared/i);const checked=await state();assert.equal(checked.credits.length,0);assert.equal(checked.accounts[0].balance,5000);const refreshed=await f.service.create(request({sourcePayrollRecordId:sourceId}));assert.equal(refreshed.status,'Unpaid');assert.equal((await state()).credits.length,1);
});
