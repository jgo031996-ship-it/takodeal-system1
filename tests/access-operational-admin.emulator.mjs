import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {createAccessOperationalReader} from '../functions/cash-remittance-review/access-operational-store.mjs';
import {createCashierShiftCloser} from '../functions/cash-remittance-review/cashier-shift-close-store.mjs';
import {reviewOrdinaryStaffRequest} from '../takodeal-manager/request-review-service.js';
const host='127.0.0.1',port=8832,endpoint=host+':'+port,projectId='demo-private-operational-history';
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing another endpoint.');process.env.FIRESTORE_EMULATOR_HOST=endpoint;
process.env.METADATA_SERVER_DETECTION='none';
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json')),admin=createRequire(resolve(root,'functions/cash-remittance-review/package.json'));
const {initializeTestEnvironment}=req('@firebase/rules-unit-testing'),{initializeApp,deleteApp,cert}=admin('firebase-admin/app'),{getFirestore,Timestamp,FieldValue}=admin('firebase-admin/firestore');
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
let child,env,db,app,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Occupied emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const deadline=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error(output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port}});const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});app=initializeApp({projectId,credential:cert({projectId,clientEmail:'sample@'+projectId+'.iam.gserviceaccount.com',privateKey})},'operational-demo');db=getFirestore(app);db.settings({host:endpoint,ssl:false});},{timeout:45000});
after(async()=>{await db?.terminate();if(app)await deleteApp(app);await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>env.clearFirestore());
const uid='sample-phone',staffId='sample-person',deviceId='DEV-SAMPLE-PHONE',sessionId='sample-session-nonce-12345678',branch='SAMPLE Branch',now=()=>Date.parse('2026-11-09T02:00:00Z');
const scope={uid,staffId,deviceId,sessionId,app:'staff'},profile={cashierName:'SAMPLE Current',branch,scheduleAliases:['SAMPLE Former']};
async function put(path,row){await db.doc(path).set(row);}
const revision=snapshot=>snapshot.updateTime.seconds+'|'+snapshot.updateTime.nanoseconds;
async function seed(){await put('cashiers/'+staffId,profile);await put('pos_devices/sample-mirror',{deviceId,status:'Active',appType:'Staff'});const current=await db.doc('cashiers/'+staffId).get();await put('staff_login_sessions/'+uid,{schemaVersion:1,uid,staffId,deviceId,sessionId,branch,app:'staff',profileRevision:revision(current),expiresAt:new Date(now()+3600000)});}
const read=(table,extra={})=>createAccessOperationalReader(db,{now})({...scope,table,...extra});
test('own stable and unique legacy history survives private Rules migration without private fields, photos or foreign IDs',async()=>{
 await seed();const time=new Timestamp(1794189600,123456789);await put('attendance_logs/id',{staffId,staffName:'SAMPLE Old spelling',branch,timestamp:time,type:'TIME IN',pin:'PRIVATE_PIN',photo:'PRIVATE_PHOTO'});await put('attendance_logs/legacy',{staffName:'SAMPLE Former',branch,timestamp:time,type:'TIME OUT'});await put('attendance_logs/foreign',{staffId:'other',staffName:'SAMPLE Former',branch,type:'TIME IN',timestamp:time});
 const result=await read('attendance_logs');assert.equal(result.complete,true);assert.deepEqual(result.records.map(row=>row.id).sort(),['id','legacy']);const saved=(await db.doc('attendance_logs/id').get()).data().timestamp;assert.deepEqual(result.records[0].timestamp,{seconds:saved.seconds,nanoseconds:saved.nanoseconds});assert.equal(result.records[0].timestamp.nanoseconds%1000000,456000);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|foreign/);assert.equal((await db.collection('cash_remittance_attempts').get()).size,0);
});
test('ambiguous alias, expired session, foreign UID, disabled profile, and revoked legacy device fail closed',async()=>{
 await seed();await put('attendance_logs/legacy',{staffName:'SAMPLE Former',timestamp:new Date(now()),type:'TIME IN'});await put('cashiers/other',{cashierName:'Another',branch,scheduleAliases:['SAMPLE Former']});await assert.rejects(read('attendance_logs'),error=>error.status===409);await db.doc('cashiers/other').delete();
 for(const [path,patch]of [['staff_login_sessions/'+uid,{expiresAt:new Date(now()-1)}],['cashiers/'+staffId,{isArchived:true}],['pos_devices/sample-mirror',{status:'Blocked'}]]){const prior=(await db.doc(path).get()).data();await db.doc(path).update(patch);await assert.rejects(read('attendance_logs'),error=>error.status===403);await put(path,prior);}
 await assert.rejects(read('attendance_logs',{uid:'other-uid'}),error=>error.status===403);await assert.rejects(read('staff_ledger'),error=>error.status===403);
});
test('announcements include legacy global but isolate exact branch and individual notices',async()=>{
 await seed();for(const [id,row]of Object.entries({global:{},explicit:{targetType:'All'},branch:{targetType:'Branch',targetBranch:branch},individual:{targetType:'Individual',targetStaff:'SAMPLE Former'},foreignBranch:{targetType:'Branch',targetBranch:'Other'},foreignId:{targetType:'Individual',targetStaff:'SAMPLE Former',targetStaffId:'other'},inactive:{active:false}}))await put('announcements/'+id,{active:true,title:id,...row});
 const result=await read('announcements');assert.deepEqual(result.records.map(row=>row.id).sort(),['branch','explicit','global','individual']);
});
test('incoming swaps honor stable target IDs before legacy names and support current pending status',async()=>{
 await seed();for(const [id,row]of Object.entries({stable:{targetStaffId:staffId,targetName:'Renamed'},legacy:{targetName:'SAMPLE Former'},foreign:{targetStaffId:'other',targetName:'SAMPLE Former'},done:{targetStaffId:staffId,status:'Approved'}}))await put('shift_swaps/'+id,{status:'Pending Staff Acceptance',...row});
 assert.deepEqual((await read('shift_swaps')).records.map(row=>row.id).sort(),['legacy','stable']);
});
test('Cashier history uses the exact approved isolated device and fresh employee PIN proof before login',async()=>{
 await seed();await put('pos_bindings/'+uid,{uid,status:'Active',deviceId,branch,legacyDeviceDocId:'cashier-mirror'});await put('pos_devices/cashier-mirror',{deviceId,branch,status:'Active'});await put('staff_pin_contexts/'+uid+'_time-clock',{schemaVersion:1,uid,staffId,deviceId,app:'cashier',branch,purpose:'time-clock',profileRevision:revision(await db.doc('cashiers/'+staffId).get()),expiresAt:new Date(now()+120000)});await put('sop_logs/own',{staffId,staffName:profile.cashierName,branch,roleName:'Opener',scorePercentage:100,timestamp:new Date(now())});
 assert.equal((await read('sop_logs',{app:'cashier',sessionId:undefined})).records[0].roleName,'Opener');assert.equal((await read('staff_requests',{app:'cashier',sessionId:undefined})).complete,true);await assert.rejects(read('acknowledgments',{app:'cashier',sessionId:undefined}),error=>error.status===403);await db.doc('pos_devices/cashier-mirror').update({status:'Blocked'});await assert.rejects(read('sop_logs',{app:'cashier'}),error=>error.status===403);
});
test('broker rejects changed source revisions, a relinked Cashier branch, malformed expiry and stale prelogin proofs',async()=>{
 await seed();await put('attendance_logs/own',{staffId,staffName:profile.cashierName,branch,type:'TIME IN',timestamp:new Date(now())});
 assert.equal((await read('attendance_logs')).records.length,1);
 await db.doc('cashiers/'+staffId).update({nickname:'A changed operational profile'});
 await assert.rejects(read('attendance_logs'),error=>error.status===403);
 const current=await db.doc('cashiers/'+staffId).get();await db.doc('staff_login_sessions/'+uid).update({app:'cashier',profileRevision:revision(current)});
 await put('pos_bindings/'+uid,{uid,status:'Active',deviceId,branch,legacyDeviceDocId:'cashier-mirror'});await put('pos_devices/cashier-mirror',{deviceId,branch,status:'Active'});
 assert.equal((await read('attendance_logs',{app:'cashier'})).records.length,1);
 await db.doc('pos_bindings/'+uid).update({branch:'Another branch'});await db.doc('pos_devices/cashier-mirror').update({branch:'Another branch'});
 await assert.rejects(read('attendance_logs',{app:'cashier'}),error=>error.status===403);
 await db.doc('pos_bindings/'+uid).update({branch});await db.doc('pos_devices/cashier-mirror').update({branch});
 const proof={schemaVersion:1,uid,staffId,deviceId,app:'cashier',branch,purpose:'time-clock',profileRevision:revision(current),expiresAt:new Date(now()+120000)};
 for(const patch of [{expiresAt:'not-a-date'},{schemaVersion:0},{profileRevision:'A stale profile revision'}]){
  await put('staff_pin_contexts/'+uid+'_time-clock',{...proof,...patch});
  await assert.rejects(read('attendance_logs',{app:'cashier',sessionId:undefined}),error=>error.status===403);
 }
 await put('staff_pin_contexts/'+uid+'_time-clock',proof);assert.equal((await read('attendance_logs',{app:'cashier',sessionId:undefined})).records.length,1);
 await db.doc('pos_devices/cashier-mirror').update({appType:' staff '});
 await assert.rejects(read('attendance_logs',{app:'cashier',sessionId:undefined}),error=>error.status===403);
 assert.equal((await db.collection('attendance_logs').get()).size,1);assert.equal((await db.collection('account_logs').get()).size,0);
});
const actor={uid,firebase:{sign_in_provider:'anonymous'}},shiftId='sample-shift';
const closingBody=()=>({deviceId,app:'cashier',branch,sessionId,shiftId,declaredCash:280,isFinalShiftOfDay:false,businessDay:'2026-11-09',expectedSalesRevision:4,expectedCash:280,cashBreakdown:{'₱200':1,'₱20':4},physicalStockCount:[]});
async function seedClosing(){
 await seed();const source=(await db.doc('cashiers/'+staffId).get()).updateTime;await db.doc('staff_login_sessions/'+uid).update({app:'cashier',profileRevision:source.seconds+'|'+source.nanoseconds});await put('pos_bindings/'+uid,{uid,deviceId,branch,status:'Active',legacyDeviceDocId:'cashier-mirror'});await put('pos_devices/cashier-mirror',{deviceId,branch,status:'Active'});await put('branches/sample',{name:branch,royaltyPercent:10});await put('shifts/'+shiftId,{branch,active:true,status:'Open',startingCash:100,salesRevision:4});
 for(const [id,patch]of Object.entries({cash:{paymentMethod:'Cash',netTotal:100},split:{paymentMethod:'Split',netTotal:200,splitDetails:[{method:'Cash',amount:100},{method:'Grab',amount:100}]},grab:{paymentMethod:'Grab',netTotal:100},gcash:{paymentMethod:'GCash',netTotal:50},freeMeal:{paymentMethod:'Salary Deduction',netTotal:0},void:{paymentMethod:'Cash',netTotal:5000,status:'Voided'}}))await put('transactions/'+id,{branch,shiftId,status:'Paid',inventoryMovements:[],...patch});
 await put('expenses/own',{branch,shiftId,amount:20});await put('expenses/manager',{branch,shiftId,amount:40,paidFrom:'Manager Fund'});await put('expenses/foreign',{branch:'Other',shiftId,amount:9999});await put('cash_accounts/grab',{branch:'Main Office',name:'Grab',balance:1000});await put('cash_accounts/gcash',{branch:'Main Office',name:'GCash',balance:9000});await put('inventory/untouched',{branch,currentStock:20});
}
const close=(body=closingBody(),who=actor)=>createCashierShiftCloser(db,{now,serverTimestamp:()=>FieldValue.serverTimestamp()})(body,who);
test('trusted close derives saved sales/expenses/royalty, credits platforms exactly once and never sends HQ balances',async()=>{
 await seedClosing();const result=await close();assert.deepEqual(result,{schemaVersion:1,shiftId,branch,status:'closed'});const saved=(await db.doc('shifts/'+shiftId).get()).data();assert.equal(saved.totalCashSales,200);assert.equal(saved.totalDigitalSales,250);assert.equal(saved.expectedCash,280);assert.equal(saved.closedBy.staffId,staffId);assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,1200);assert.equal((await db.doc('cash_accounts/gcash').get()).data().balance,9000);assert.equal((await db.doc('franchise_ledger/royalty-'+shiftId).get()).data().amount,45);assert.equal((await db.doc('inventory/untouched').get()).data().currentStock,20);
 assert.equal((await close()).status,'already-closed');assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,1200);assert.equal((await db.collection('account_logs').get()).size,1);
});
test('concurrent trusted closes serialize one settlement and preserve the first closer',async()=>{
 await seedClosing();const results=await Promise.all([close(),close()]);assert.deepEqual(results.map(row=>row.status).sort(),['already-closed','closed']);assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,1200);assert.equal((await db.collection('franchise_ledger').get()).size,1);
});
test('trusted close preserves finite signed legacy platform balances, creates absent accounts once, and holds unknown existing balances',async()=>{
 for(const [saved,expected]of [[-250.25,-50.25],['-250.25',-50.25],['1000.50',1200.50]]){
  await env.clearFirestore();await seedClosing();await db.doc('cash_accounts/grab').update({balance:saved});
  const results=await Promise.all([close(),close()]);assert.deepEqual(results.map(row=>row.status).sort(),['already-closed','closed']);
  assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,expected);assert.equal((await db.collection('account_logs').get()).size,1);
  assert.equal((await close()).status,'already-closed');assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,expected);
 }
 for(const invalid of [undefined,null,'','  ','not-money','1.001',true]){
  await env.clearFirestore();await seedClosing();const row={branch:'Main Office',name:'Grab'};if(invalid!==undefined)row.balance=invalid;await put('cash_accounts/grab',row);
  await assert.rejects(close(),error=>error.status===409);
  assert.equal((await db.doc('shifts/'+shiftId).get()).data().active,true);assert.deepEqual((await db.doc('cash_accounts/grab').get()).data(),row);
  assert.equal((await db.collection('account_logs').get()).size,0);assert.equal((await db.collection('franchise_ledger').get()).size,0);
 }
 await env.clearFirestore();await seedClosing();await db.doc('cash_accounts/grab').delete();await close();
 assert.equal((await db.doc('cash_accounts/platform-Grab').get()).data().balance,200);assert.equal((await db.collection('account_logs').get()).size,1);
});
test('saved expense amounts retain exact valid decimal strings and reject empty, nondecimal or fractional-cent amounts atomically',async()=>{
 for(const value of [20,'20','20.00']){
  await env.clearFirestore();await seedClosing();await db.doc('expenses/own').update({amount:value});await close();
  assert.equal((await db.doc('shifts/'+shiftId).get()).data().expectedCash,280);assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,1200);
 }
 await env.clearFirestore();await seedClosing();await db.doc('expenses/own').update({amount:'20.25'});
 await close({...closingBody(),declaredCash:279.75,expectedCash:279.75,cashBreakdown:{'₱200':1,'₱50':1,'₱20':1,'₱5':1,'₱1':4,'₱0.25':3}});
 assert.equal((await db.doc('shifts/'+shiftId).get()).data().expectedCash,279.75);
 for(const amount of ['', '  ', '0x10', '1e2', '20tail', '20.001', null, false]){
  await env.clearFirestore();await seedClosing();await put('expenses/unknown',{branch,shiftId,amount});
  await assert.rejects(close(),error=>error.status===409);
  assert.equal((await db.doc('shifts/'+shiftId).get()).data().active,true);assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,1000);
  assert.equal((await db.collection('account_logs').get()).size,0);assert.equal((await db.collection('franchise_ledger').get()).size,0);
 }
});
test('tampered review, denomination mismatch, duplicate platform account, wrong branch, expired staff and revoked device cannot partially close',async()=>{
 for(const mutate of [async()=>{},async()=>db.doc('cash_accounts/duplicate').set({branch:'Main Office',name:'Grab',balance:50}),async()=>db.doc('staff_login_sessions/'+uid).update({expiresAt:new Date(now()-1)}),async()=>db.doc('pos_devices/cashier-mirror').update({status:'Blocked'})]){await env.clearFirestore();await seedClosing();await mutate();const body=closingBody();if(mutate.toString()==='async()=>{}')body.expectedCash=279;await assert.rejects(close(body));assert.equal((await db.doc('shifts/'+shiftId).get()).data().active,true);assert.equal((await db.doc('cash_accounts/grab').get()).data().balance,1000);assert.equal((await db.collection('account_logs').get()).size,0);}
 await env.clearFirestore();await seedClosing();await assert.rejects(close({...closingBody(),branch:'Other'}));await assert.rejects(close({...closingBody(),cashBreakdown:{'₱100':1}}));await assert.rejects(close(closingBody(),{...actor,uid:'foreign'}));
});
test('actual ordinary approval preserves source Timestamp, serializes one stable charge, and does not charge free meals or malformed amounts',async()=>{
 const api={db,doc:(_db,table,id)=>db.doc(table+'/'+id),isBranchAllowed:selected=>selected===branch,serverTimestamp:()=>FieldValue.serverTimestamp(),runTransaction:(_db,callback)=>db.runTransaction(tx=>callback({get:async reference=>{const snapshot=await tx.get(reference);return{exists:()=>snapshot.exists,data:()=>snapshot.data()};},set:(reference,value)=>tx.set(reference,value),update:(reference,value)=>tx.update(reference,value)}))};
 const saved={staffId,staffName:profile.cashierName,branch,status:'Pending',timestamp:Timestamp.fromMillis(now()),type:'Cash Advance',amount:'25.50'},review=id=>reviewOrdinaryStaffRequest(api,{id,action:'Approved',reply:'Reviewed exact saved source',actor:'Synthetic Owner'});
 await put('staff_requests/advance',saved);const results=await Promise.all([review('advance'),review('advance')]);assert.equal(results.filter(row=>row.charged).length,1);
 const charge=(await db.doc('staff_deductions/request-advance').get()).data();assert.equal(charge.amount,25.5);assert.equal(charge.staffId,staffId);assert.ok(charge.dateAdded instanceof Timestamp);assert.equal(charge.dateAdded.toMillis(),now());
 assert.equal((await db.collection('staff_deductions').get()).size,1);assert.equal((await review('advance')).alreadyReviewed,true);
 await put('staff_requests/free',{...saved,type:'Staff Meal (POS Auto)',amount:0});assert.equal((await review('free')).charged,false);assert.equal((await db.doc('staff_requests/free').get()).data().status,'Approved');assert.equal((await db.doc('staff_deductions/request-free').get()).exists,false);
 for(const [id,patch]of [['boolean',{amount:true}],['array',{amount:[25]}],['array-type',{type:['Staff Meal (POS Auto)']}],['invalid-date',{timestamp:'2026-11-09T02:00:00Z'}],['zero-advance',{amount:0}]]){
  await put('staff_requests/'+id,{...saved,...patch});await assert.rejects(review(id));assert.equal((await db.doc('staff_requests/'+id).get()).data().status,'Pending');assert.equal((await db.doc('staff_deductions/request-'+id).get()).exists,false);
 }
 assert.equal((await db.collection('staff_deductions').get()).size,1);
});
