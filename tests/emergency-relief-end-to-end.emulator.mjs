// Actual client SDK transactions against a dedicated loopback emulator.
// Every staff, phone, branch, punch and payroll record in this suite is fictional.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {createEarlyTimeOutService as createStaffClock} from '../takodeal-staff/early-time-out-actions.js';
import {createEarlyTimeOutService as createCashierClock} from '../Takodeal-POS/early-time-out-actions.js';
import {createReliefHoursHandler,RELIEF_OWNER_ORIGIN} from '../functions/cash-remittance-review/relief-hours-handler.mjs';
import {createReliefHoursStore} from '../functions/cash-remittance-review/relief-hours-store.mjs';
import {linkedTimeOutId} from '../takodeal-manager/attendance-reconcile.js';
import {resolveAttendanceShift,attendanceLateMinutes,latePay,earnedNightBonus} from '../takodeal-manager/payroll-safety.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';

const host='127.0.0.1',port=8872,projectId='demo-emergency-relief-end-to-end',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,getDocFromServer,getDocsFromServer,query,where,collection,writeBatch}=sdk;
const adminReq=createRequire(resolve(root,'functions/cash-remittance-review/package.json')),{initializeApp,deleteApp,cert}=adminReq('firebase-admin/app'),{getFirestore,FieldValue}=adminReq('firebase-admin/firestore');
const priorMetadataDetection=process.env.METADATA_SERVER_DETECTION;process.env.METADATA_SERVER_DETECTION='none';
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The local emulator runtime is missing.');
let env,child,adminDB,adminApp,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{
 if(await reachable())throw Error('Refusing an occupied test port.');
 child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));
 const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}
 env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 adminApp=initializeApp({projectId,credential:cert({projectId,clientEmail:'fictional-emulator@'+projectId+'.iam.gserviceaccount.com',privateKey})},'emergency-relief-e2e-only');adminDB=getFirestore(adminApp);adminDB.settings({host:endpoint,ssl:false,ignoreUndefinedProperties:true});assert.equal(adminApp.options.projectId,projectId);
},{timeout:45000});
beforeEach(async()=>{await env.clearFirestore();});
after(async()=>{await adminDB?.terminate();if(adminApp)await deleteApp(adminApp).catch(()=>{});await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}if(priorMetadataDetection===undefined)delete process.env.METADATA_SERVER_DETECTION;else process.env.METADATA_SERVER_DETECTION=priorMetadataDetection;});

const ownerEmail='jgo031996@gmail.com',staffId='fiction-e2e-staff',startId='fiction-e2e-time-in',staffName='Fictional Emergency Cover Staff',home='Fictional Home Branch',branch='Fictional Cover Branch';
const actualIn=new Date('2026-10-30T17:55:00+08:00'),actualOut=new Date('2026-10-31T02:35:00+08:00'),marker={version:1,homeBranch:home,branch,requiresReview:true};
const profile={cashierName:staffName,branch:home,pin:'fiction-e2e-pin',active:true,hourlyRate:450,nightDiffRate:50};
const paid={staffId,staffName,startDate:'2026-10-01',endDate:'2026-10-15',isPaid:true,frozenData:{isPaid:true,basicPay:4500,netPay:4400},finalNetPay:4400};
const plain=value=>value&&typeof value.toMillis==='function'?{milliseconds:value.toMillis()}:Array.isArray(value)?value.map(plain):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,plain(value[key])])):value;
const admin=callback=>env.withSecurityRulesDisabled(context=>callback(context.firestore()));
const ownerDB=()=>env.authenticatedContext('fiction-e2e-owner',{email:ownerEmail,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const phoneDB=app=>env.authenticatedContext('fiction-e2e-'+app,{firebase:{sign_in_provider:'anonymous'}}).firestore();
const read=async(db,table,id)=>{const snap=await getDocFromServer(doc(db,table,id));return snap.exists()?{...snap.data(),id:snap.id}:null;};
const history=async db=>(await getDocsFromServer(query(collection(db,'attendance_logs'),where('staffId','==',staffId)))).docs.map(row=>({...row.data(),id:row.id}));
function trackedAdminStore(state){
 const tracked=new WeakMap(),wrap=(value,table,filters=[])=>{const proxy=new Proxy(value,{get(target,key){if(['where','limit','select'].includes(key))return (...args)=>wrap(target[key](...args),table,key==='where'?[...filters,args]:filters);const found=Reflect.get(target,key,target);return typeof found==='function'?found.bind(target):found;}});tracked.set(proxy,{actual:value,table,filters});return proxy;};
 const adapter={doc:path=>adminDB.doc(path),collection:table=>wrap(adminDB.collection(table),table),runTransaction:callback=>adminDB.runTransaction(tx=>callback({get:async reference=>{const meta=tracked.get(reference),snapshot=await tx.get(meta?.actual||reference);if(state.concurrentPayment&&!state.paymentStarted&&meta?.table==='payroll_records'&&meta.filters.some(([field])=>field==='staffName')){state.paymentStarted=true;state.events.push('last-paid-query-read');state.paymentPromise=adminDB.doc('payroll_records/fiction-concurrent-custom').set(state.concurrentPayment).then(result=>{state.paymentCommittedAt=result.writeTime;state.events.push('payment-committed');});await Promise.race([state.paymentPromise,pause(200)]);}return snapshot;},set:(...args)=>tx.set(...args),update:(...args)=>tx.update(...args)}))};
 return createReliefHoursStore(adapter,{serverTimestamp:()=>FieldValue.serverTimestamp()});
}
async function fixture({app='staff',startMarker=true}={}){
 const start={staffId,staffName,branch,type:'TIME IN',timestamp:actualIn,lateMinutes:0,scheduleSnapshot:{version:1,source:'clock-in',branch,staffName,wasScheduled:false,needsScheduleReview:true,expectedStartAt:'2026-10-30T18:00:00+08:00',expectedEndAt:'2026-10-31T02:30:00+08:00',scheduleReviewReason:'missing-dated-assignment'},...(startMarker?{emergencyRelief:marker}:{})};
 await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'cashiers',staffId),profile);batch.set(doc(db,'attendance_logs',startId),start);batch.set(doc(db,'hq_managers','fiction-e2e-owner'),{email:ownerEmail,cashierName:'Fictional Owner',pin:'fiction-owner-pin',role:'System Architect',permissions:['all'],assignedBranch:'All',active:true});batch.set(doc(db,'payroll_records','fiction-earlier-paid'),paid);await batch.commit();});
 const db=phoneDB(app),uid='fiction-e2e-'+app,api={...sdk,db,auth:{currentUser:{uid}},sessionUser:{uid,cashierName:staffName,branch}},clock=(app==='staff'?createStaffClock:createCashierClock)(api,{now:()=>new Date(actualOut),makeToken:()=> 'fiction-e2e-review-token-0001'}),source=await read(db,'attendance_logs',startId),outId=await linkedTimeOutId(staffId,startId),requestId='early-'+outId.slice('time-out-'.length);
 const input={start:source,staffId,staffName,pin:profile.pin,reliefForReview:true,assertCurrent(){assert.equal(api.auth.currentUser.uid,uid);},attendance:{staffId,staffName,branch,type:'TIME OUT',sourceApp:app,locationLat:1.25,locationLng:2.5,distanceMeters:10}};
 const owner=ownerDB(),actor={uid:'fiction-e2e-owner',email:ownerEmail,email_verified:true,firebase:{sign_in_provider:'google.com'}},token='FICTIONAL_OWNER_TOKEN_123456789',state={loseReviewAck:false,events:[],paymentStarted:false},physicalStore=trackedAdminStore(state),store={...physicalStore,transaction:async callback=>{const result=await physicalStore.transaction(callback);if(result?.saved)state.events.push('review-committed');if(state.loseReviewAck&&result?.saved){state.loseReviewAck=false;throw Error('Fictional review acknowledgement lost after the actual Admin commit.');}return result;}},handle=createReliefHoursHandler({verifyToken:async(value,revoked)=>{assert.equal(revoked,true);if(value!==token)throw Error('Unknown fictional token');return actor;},store});
 const call=(path,body,patch={})=>handle({method:'POST',path,query:{},origin:RELIEF_OWNER_ORIGIN,contentType:'application/json',authorization:'Bearer '+token,rawSize:Buffer.byteLength(JSON.stringify(body)),body,...patch}),review={inspect:async context=>{const result=await call('/relief-hours/inspect',{context});assert.equal(result.status,200,result.body.message);return result.body;},save:async body=>{const result=await call('/relief-hours/confirm',body);assert.equal(result.status,200,result.body.message);return result.body;}};
 return {db,api,clock,input,source,outId,requestId,owner,review,call,actor,state,context:{attendanceLogId:startId,staffId,branch,from:'2026-10-16',to:'2026-10-31'}};
}
function payrollState(records){
 const start=records.find(row=>row.id===startId),shift=resolveAttendanceShift(start,{}, {[staffName]:{...profile,id:staffId,staffId}}),plan=planPayrollAttendance(records);
 return {shift,plan};
}
async function confirmInput(f,patch={}){const view=await f.review.inspect(f.context);return {context:view.context,expectedFingerprint:view.expectedFingerprint,expectedRevision:view.expectedRevision,workDate:'2026-10-30',startTime:'18:00',endTime:'02:30',shiftType:'night',shiftName:'Fictional emergency cover night',choice:'Use confirmed schedule minutes',reason:'Fictional branch manager confirmed the emergency cover assignment and checked original attendance.',...patch};}

for(const app of ['staff','cashier'])test(app+' actual provisional close, retry, Owner hours review and payroll form one preserved overnight flow',{timeout:35000},async()=>{
 const f=await fixture({app,startMarker:app==='staff'}),original=plain(f.source),paidBefore=plain(await read(f.owner,'payroll_records','fiction-earlier-paid'));
 const preview=await f.clock.inspect(f.input);assert.equal(preview.provisionalRelief,true);assert.equal(preview.unknown,true);
 const saved=await assertSucceeds(f.clock.close(f.input));assert.equal(saved.saved,true);assert.equal(saved.provisionalRelief,true);assert.equal(saved.id,f.outId);
 const pending=await read(f.db,'staff_requests',f.requestId),out=await read(f.db,'attendance_logs',f.outId),outBefore=plain(out);
 assert.equal(pending.status,'Pending');assert.equal(pending.requiresScheduleReview,true);assert.equal(pending.timeOutLogId,f.outId);assert.equal(Date.parse(pending.actualTimeOutAt),+actualOut);assert.equal(out.timeInLogId,startId);assert.equal(Date.parse(out.timeInAt),+actualIn);assert.equal(out.timestamp.toMillis(),+actualOut);assert.equal(out.earlyTimeOut,undefined);assert.deepEqual(out.emergencyRelief,marker);assert.deepEqual(plain(await read(f.db,'attendance_logs',startId)),original);
 const retry=await assertSucceeds(f.clock.close(f.input));assert.equal(retry.alreadySaved,true);assert.equal(retry.provisionalRelief,true);assert.equal((await history(f.db)).filter(row=>row.type==='TIME OUT').length,1);assert.equal((await getDocsFromServer(collection(f.db,'staff_requests'))).size,1);
 const before=payrollState(await history(f.owner));assert.equal(before.shift.needsScheduleReview,true);assert.equal(before.plan.heldNames.has(staffName),true,'Unconfirmed emergency-cover hours must not enter payable payroll');assert.equal(before.plan.logs.length,0);
 const view=await f.review.inspect(f.context);assert.equal(view.canSave,true);assert.equal(Date.parse(view.timeOutAt),+actualOut);
 const input={context:view.context,expectedFingerprint:view.expectedFingerprint,expectedRevision:view.expectedRevision,workDate:'2026-10-30',startTime:'18:00',endTime:'02:30',shiftType:'night',shiftName:'Fictional emergency cover night',choice:'Use confirmed schedule minutes',reason:'Fictional branch manager confirmed the emergency cover assignment and checked original attendance.'};
 const approved=await assertSucceeds(f.review.save(input));assert.equal(approved.saved,true);const checked=await read(f.owner,'attendance_logs',startId),{reliefScheduleReview,...unchanged}=checked;
 assert.deepEqual(plain(unchanged),original);assert.deepEqual(plain(await read(f.owner,'attendance_logs',f.outId)),outBefore);assert.equal(Object.hasOwn(reliefScheduleReview,'reason'),false);assert.equal((await read(f.owner,'staff_requests',f.requestId)).status,'Not Required');
 const after=payrollState(await history(f.owner));assert.equal(after.shift.reliefReviewVerified,true);assert.equal(after.shift.needsScheduleReview,false);assert.equal(after.plan.heldNames.has(staffName),false);assert.equal(after.plan.logs.length,2);assert.equal(attendanceLateMinutes(checked,after.shift),0);assert.equal(latePay(attendanceLateMinutes(checked,after.shift),profile,after.shift).amount,0);assert.equal(earnedNightBonus(profile,after.shift,out.timestamp),50);
 const repeated=await assertSucceeds(f.review.save(input));assert.equal(repeated.alreadySaved,true);assert.equal((await getDocsFromServer(collection(f.owner,'attendance_relief_reviews'))).size,1);assert.deepEqual(plain(await read(f.owner,'payroll_records','fiction-earlier-paid')),paidBefore);
 await assertFails(getDocFromServer(doc(f.db,'attendance_relief_reviews',approved.auditId)));
});

test('real transaction acknowledgement loss retries one provisional Time Out and one pending review',{timeout:20000},async()=>{
 const f=await fixture(),real=f.api.runTransaction;let lose=true;
 f.api.runTransaction=async(db,callback)=>{const result=await real(db,callback);if(lose&&result?.saved){lose=false;throw Error('Fictional connection acknowledgement lost after actual commit.');}return result;};
 await assert.rejects(f.clock.close(f.input),/acknowledgement lost/);const requestBefore=plain(await read(f.db,'staff_requests',f.requestId)),outBefore=plain(await read(f.db,'attendance_logs',f.outId));
 const retry=await assertSucceeds(f.clock.close(f.input));assert.equal(retry.alreadySaved,true);assert.equal((await history(f.db)).filter(row=>row.type==='TIME OUT').length,1);assert.equal((await getDocsFromServer(collection(f.db,'staff_requests'))).size,1);assert.deepEqual(plain(await read(f.db,'staff_requests',f.requestId)),requestBefore);assert.deepEqual(plain(await read(f.db,'attendance_logs',f.outId)),outBefore);
});

test('the trusted Owner route rejects forged identity, wrong origin, revoked profile and invalid assigned hours without writing a review',{timeout:25000},async()=>{
 const f=await fixture();await f.clock.close(f.input);const input=await confirmInput(f),original=plain(await read(f.owner,'attendance_logs',startId)),outOriginal=plain(await read(f.owner,'attendance_logs',f.outId));
 for(const patch of [{origin:'https://takodeal-cashier.vercel.app'},{authorization:'Bearer FICTIONAL_BAD_TOKEN_123456789'},{query:{unexpected:'value'}},{rawSize:200000}])assert.notEqual((await f.call('/relief-hours/confirm',input,patch)).status,200);
 for(const change of [()=>f.actor.email='other@example.test',()=>f.actor.email_verified=false,()=>f.actor.firebase.sign_in_provider='anonymous']){change();assert.equal((await f.call('/relief-hours/confirm',input)).status,403);f.actor.email=ownerEmail;f.actor.email_verified=true;f.actor.firebase.sign_in_provider='google.com';}
 for(const patch of [{startTime:'21:00'},{endTime:'17:30'},{workDate:'2026-10-28'},{shiftType:'unknown'},{reason:'short'},{choice:''}])assert.notEqual((await f.call('/relief-hours/confirm',{...input,...patch})).status,200);
 await adminDB.doc('cashiers/'+staffId).update({active:false});assert.notEqual((await f.call('/relief-hours/confirm',input)).status,200);await adminDB.doc('cashiers/'+staffId).update({active:true});
 assert.equal((await getDocsFromServer(collection(f.owner,'attendance_relief_reviews'))).size,0);assert.deepEqual(plain(await read(f.owner,'attendance_logs',startId)),original);assert.deepEqual(plain(await read(f.owner,'attendance_logs',f.outId)),outOriginal);assert.equal((await read(f.owner,'staff_requests',f.requestId)).status,'Pending');
});

test('a newly saved unselected custom-cutoff payment blocks the Admin review and preserves its frozen amount',{timeout:20000},async()=>{
 const f=await fixture();await f.clock.close(f.input);const input=await confirmInput(f),custom={staffId,staffName,startDate:'2026-10-29',endDate:'2026-11-02',isPaid:true,frozenData:{isPaid:true,netPay:7777},finalNetPay:7777};
 await adminDB.doc('payroll_records/fiction-new-custom-cutoff').set(custom);const result=await f.call('/relief-hours/confirm',input);assert.notEqual(result.status,200);assert.match(result.body.message,/paid payslip/);assert.equal((await getDocsFromServer(collection(f.owner,'attendance_relief_reviews'))).size,0);assert.equal((await read(f.owner,'attendance_logs',startId)).reliefScheduleReview,undefined);assert.equal((await read(f.owner,'payroll_records','fiction-new-custom-cutoff')).finalNetPay,7777);assert.equal((await read(f.owner,'attendance_logs',f.outId)).timestamp.toMillis(),+actualOut);
});

test('lost Admin review acknowledgement retries the exact input once without a second audit or punch',{timeout:20000},async()=>{
 const f=await fixture();await f.clock.close(f.input);const input=await confirmInput(f),outBefore=plain(await read(f.owner,'attendance_logs',f.outId));f.state.loseReviewAck=true;assert.notEqual((await f.call('/relief-hours/confirm',input)).status,200);
 const retried=await f.call('/relief-hours/confirm',input);assert.equal(retried.status,200,retried.body.message);assert.equal(retried.body.alreadySaved,true);assert.equal((await getDocsFromServer(collection(f.owner,'attendance_relief_reviews'))).size,1);assert.equal((await history(f.owner)).filter(row=>row.type==='TIME OUT').length,1);assert.deepEqual(plain(await read(f.owner,'attendance_logs',f.outId)),outBefore);assert.equal(payrollState(await history(f.owner)).plan.heldNames.has(staffName),false);
});

test('a real concurrent unselected custom payment and hours review serialize without modifying a paid payroll',{timeout:35000},async()=>{
 const f=await fixture();await f.clock.close(f.input);const input=await confirmInput(f),payment={staffId,staffName,startDate:'2026-10-29',endDate:'2026-11-02',isPaid:true,frozenData:{isPaid:true,netPay:8888},finalNetPay:8888},outBefore=plain(await read(f.owner,'attendance_logs',f.outId));f.state.concurrentPayment=payment;
 const result=await f.call('/relief-hours/confirm',input);assert.equal(f.state.paymentStarted,true);await f.state.paymentPromise;const audits=await getDocsFromServer(collection(f.owner,'attendance_relief_reviews'));
 if(result.status===200){assert.equal(result.body.saved,true);assert.equal(audits.size,1);const reviewedAt=audits.docs[0].data().review.reviewedAt;assert.ok(reviewedAt.toMillis()<=f.state.paymentCommittedAt.toMillis(),'A successful review must precede the concurrent payment commit: '+JSON.stringify({events:f.state.events,reviewedAt:reviewedAt.toMillis(),paymentAt:f.state.paymentCommittedAt.toMillis()}));await assertFails(getDocFromServer(doc(f.db,'attendance_relief_reviews',result.body.auditId)));}
 else{assert.match(result.body.message,/paid payslip|payment.*changed|saved payroll.*changed/);assert.equal(audits.size,0);assert.equal((await read(f.owner,'attendance_logs',startId)).reliefScheduleReview,undefined);assert.equal((await read(f.owner,'staff_requests',f.requestId)).status,'Pending');}
 const paid=await read(f.owner,'payroll_records','fiction-concurrent-custom');assert.equal(paid.finalNetPay,8888);assert.equal(paid.frozenData.netPay,8888);assert.deepEqual(plain(await read(f.owner,'attendance_logs',f.outId)),outBefore);assert.equal((await history(f.owner)).filter(row=>row.type==='TIME OUT').length,1);
});
