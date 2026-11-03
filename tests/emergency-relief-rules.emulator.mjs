// Full generated Rules, real local SDK, and fictional records only.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {linkedTimeOutId} from '../takodeal-manager/attendance-reconcile.js';
import {reliefScheduleSourceFingerprint} from '../takodeal-manager/relief-schedule-review-model.js';
import {resolveAttendanceShift} from '../takodeal-manager/payroll-safety.js';
const host='127.0.0.1',port=8871,projectId='demo-emergency-relief-rules',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,writeBatch,serverTimestamp}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The local emulator runtime is missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing an occupied test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
const email='jgo031996@gmail.com',staffId='fiction-staff',startId='fiction-relief-in',outId=await linkedTimeOutId(staffId,startId),requestId='early-'+outId.slice('time-out-'.length),auditId='relief-'+startId+'-1';
const marker={version:1,homeBranch:'Fictional Home',branch:'Fictional Cover',requiresReview:true};
const profile={cashierName:'Fictional Relief Staff',branch:marker.homeBranch,active:true,pin:'fiction-only'};
const start={staffId,staffName:profile.cashierName,branch:marker.branch,type:'TIME IN',timestamp:new Date('2026-10-30T05:57:00Z'),emergencyRelief:marker,scheduleSnapshot:{version:1,source:'clock-in',staffName:profile.cashierName,branch:marker.branch,wasScheduled:false,needsScheduleReview:true,expectedStartAt:'2026-10-30T06:00:00Z',expectedEndAt:'2026-10-30T13:00:00Z'}};
const out={staffId,staffName:profile.cashierName,branch:marker.branch,type:'TIME OUT',timestamp:new Date('2026-10-30T13:05:00Z'),timeInLogId:startId,timeInAt:start.timestamp.toISOString(),emergencyRelief:marker,reliefRequestId:requestId};
const request={type:'Early Time Out',schemaVersion:1,staffId,staffName:profile.cashierName,branch:marker.branch,timeInLogId:startId,timeInAt:start.timestamp.toISOString(),timeOutLogId:outId,actualTimeOutAt:out.timestamp.toISOString(),emergencyRelief:marker,requiresScheduleReview:true,status:'Pending',requestVersion:1,requestToken:'fictional-token-0001',scheduleFingerprint:'fictional-unverified-schedule',scheduledEndAt:null,reason:'Fictional emergency cover, actual departure recorded.',timestamp:new Date('2026-10-30T13:05:00Z')};
const owner=()=>env.authenticatedContext('fiction-owner',{email,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const anonymous=()=>env.authenticatedContext('fiction-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const wrong=kind=>env.authenticatedContext('fiction-other',{email:kind==='other'?'other@example.test':email,email_verified:kind!=='unverified',firebase:{sign_in_provider:kind==='anonymous'?'anonymous':'google.com'}}).firestore();
const admin=callback=>env.withSecurityRulesDisabled(context=>callback(context.firestore()));
beforeEach(async()=>{await env.clearFirestore();await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'cashiers',staffId),profile);batch.set(doc(db,'attendance_logs',startId),start);batch.set(doc(db,'attendance_logs',outId),out);batch.set(doc(db,'staff_requests',requestId),request);batch.set(doc(db,'hq_managers','fiction-owner'),{email,cashierName:'Fictional Owner',pin:'fiction-only',role:'System Architect',permissions:['all'],assignedBranch:'All'});await batch.commit();});});
function decision(){return {lateMinutes:null,reviewedLateMinutes:null,lateExempted:false,lateDecision:null,lateReviewRequestId:null};}
function payload(){const review={version:1,revision:1,auditId,sourceFingerprint:reliefScheduleSourceFingerprint({...start,id:startId}),workDate:'2026-10-30',expectedStartAt:new Date('2026-10-30T06:00:00Z'),expectedEndAt:new Date('2026-10-30T13:00:00Z'),shiftName:'Fictional relief shift',shiftType:'other',isNightShift:false,lateMinutes:0,exempt:false,actorUid:'fiction-owner',actorEmail:email,reviewedAt:serverTimestamp()};return {review,audit:{review,attendanceId:startId,staffId,staffName:profile.cashierName,branch:marker.branch,timeOutLogId:outId,timeOutAt:out.timestamp,requestId,requestVersion:1,requestToken:request.requestToken,reason:'Fictional verified branch assignment and actual work records.',previousReview:null,previousDecision:decision()}};}
function batch(db,{change=()=>{},includeMarker=true,includeAudit=true,includeRequest=true,punchChange=false}={}){const p=payload();change(p);const b=writeBatch(db);if(includeMarker)b.update(doc(db,'attendance_logs',startId),{reliefScheduleReview:p.review,...(punchChange?{timestamp:new Date('2026-10-30T06:00:00Z')}:{})});if(includeAudit)b.set(doc(db,'attendance_relief_reviews',auditId),p.audit);if(includeRequest)b.update(doc(db,'staff_requests',requestId),{status:'Not Required',reliefReviewAuditId:auditId,processedAt:serverTimestamp(),processedByUid:'fiction-owner',processedBy:email,managerReply:'Fictional confirmed assigned hours.'});return b;}
// Admin seeds below represent the trusted server result only. The actual
// review-server authentication, transaction and resolver flow has its own E2E suite.
async function seedReviewed(){await admin(db=>batch(db).commit());}

test('even the verified Google Owner cannot write review metadata or its private audit from a client',async()=>{await assertFails(batch(owner()).commit());const db=owner();await assertFails(setDoc(doc(db,'attendance_relief_reviews','fiction-forged-audit'),payload().audit));await assertFails(updateDoc(doc(db,'attendance_logs',startId),{reliefScheduleReview:payload().review}));});
for(const kind of ['anonymous','unverified','other'])test(kind+' cannot create a trusted payroll schedule marker or review audit',async()=>{await assertFails(batch(wrong(kind)).commit());});
for(const [label,context] of [['Staff',anonymous],['Owner',owner]])test(label+' cannot forge trusted review metadata when creating Time In',async()=>{await assertFails(setDoc(doc(context(),'attendance_logs','fiction-forged'),{...start,reliefScheduleReview:payload().review}));});
for(const missing of ['includeAudit','includeMarker','includeRequest'])test('a client cannot bypass the review server by omitting '+missing,async()=>{await assertFails(batch(owner(),{[missing]:false}).commit());});

test('Admin-issued hours are readable and independently verified by payroll without changing the original punches',async()=>{await seedReviewed();const a=(await getDocFromServer(doc(anonymous(),'attendance_logs',startId))).data(),b=(await getDocFromServer(doc(anonymous(),'attendance_logs',outId))).data();assert.equal(a.timestamp.toMillis(),+start.timestamp);assert.equal(b.timestamp.toMillis(),+out.timestamp);assert.deepEqual(a.scheduleSnapshot,start.scheduleSnapshot);assert.equal(a.reliefScheduleReview.auditId,auditId);const shift=resolveAttendanceShift({...a,id:startId},null,{[profile.cashierName]:{...profile,id:staffId,staffId}});assert.equal(shift.needsScheduleReview,false);assert.equal(shift.lateMinutes,0);assert.equal(+shift.expectedStartAt,Date.parse('2026-10-30T06:00:00Z'));});

test('a malformed Admin seed still fails closed in the payable schedule resolver',async()=>{await admin(db=>batch(db,{change:p=>{p.review.isNightShift=true;}}).commit());const log={...(await getDocFromServer(doc(anonymous(),'attendance_logs',startId))).data(),id:startId};const shift=resolveAttendanceShift(log,null,{[profile.cashierName]:{...profile,id:staffId,staffId}});assert.equal(shift.needsScheduleReview,true);assert.notEqual(shift.reliefReviewVerified,true);});

test('private evidence is read only by the verified Google Owner and clients cannot alter or delete it',async()=>{await seedReviewed();await assertSucceeds(getDocFromServer(doc(owner(),'attendance_relief_reviews',auditId)));for(const context of [anonymous,...['anonymous','unverified','other'].map(kind=>()=>wrong(kind))])await assertFails(getDocFromServer(doc(context(),'attendance_relief_reviews',auditId)));for(const context of [anonymous,owner]){await assertFails(updateDoc(doc(context(),'attendance_relief_reviews',auditId),{reason:'Overwrite private evidence'}));await assertFails(deleteDoc(doc(context(),'attendance_relief_reviews',auditId)));}const publicMarker=(await getDocFromServer(doc(anonymous(),'attendance_logs',startId))).data().reliefScheduleReview;assert.equal(Object.hasOwn(publicMarker,'reason'),false);});

test('Staff and Owner clients cannot replace or remove an Admin-issued marker',async()=>{await seedReviewed();for(const context of [anonymous,owner]){const ref=doc(context(),'attendance_logs',startId);await assertFails(updateDoc(ref,{reliefScheduleReview:{...payload().review,lateMinutes:15}}));await assertFails(setDoc(ref,start));await assertFails(deleteDoc(ref));}});

const changedSourceFields={timestamp:new Date('2026-10-30T14:00:00Z'),type:'VOID',staffId:'fiction-other-staff',staffName:'Fictional Other Staff',branch:'Fictional Other Branch',timeInLogId:'fiction-other-start',timeInAt:'2026-10-30T06:01:00Z',scheduleSnapshot:{version:1,source:'fictional overwrite'},status:'Voided',deleted:true};
for(const [name,id] of [['Time In',startId],['linked Time Out',outId]])test('reviewed '+name+' preserves every original source field',async()=>{await seedReviewed();for(const [field,value] of Object.entries(changedSourceFields))await assertFails(updateDoc(doc(anonymous(),'attendance_logs',id),{[field]:value}));await assertFails(updateDoc(doc(owner(),'attendance_logs',id),{timestamp:changedSourceFields.timestamp}));});

test('reviewed Time Out cannot be unlinked or deleted by Staff, another account or the Owner client',async()=>{await seedReviewed();const ref=doc(anonymous(),'attendance_logs',outId);await assertFails(updateDoc(ref,{timeInLogId:''}));for(const context of [anonymous,()=>wrong('other'),owner])await assertFails(deleteDoc(doc(context(),'attendance_logs',outId)));});

test('reviewed pairs still allow unrelated operational payroll metadata',async()=>{await seedReviewed();for(const id of [startId,outId])await assertSucceeds(updateDoc(doc(anonymous(),'attendance_logs',id),{payrollRecordId:'fiction-paid-record',payrollRecorded:true}));});

test('ordinary unverified punch creation remains available without trusted review fields',async()=>{await assertSucceeds(setDoc(doc(anonymous(),'attendance_logs','fiction-new-punch'),start));});

test('ordinary unreviewed linked and unlinked Time Out records retain legacy updates',async()=>{await assertSucceeds(updateDoc(doc(anonymous(),'attendance_logs',outId),{timestamp:new Date('2026-10-30T13:06:00Z')}));await assertSucceeds(setDoc(doc(anonymous(),'attendance_logs','fiction-unlinked-out'),{...out,timeInLogId:''}));await assertSucceeds(updateDoc(doc(anonymous(),'attendance_logs','fiction-unlinked-out'),{staffName:'Fictional Corrected Staff'}));await assertSucceeds(deleteDoc(doc(anonymous(),'attendance_logs',outId)));});

test('an orphan legacy Time Out remains editable without a missing-source error',async()=>{const ref=doc(anonymous(),'attendance_logs','fiction-orphan-out');await assertSucceeds(setDoc(ref,{...out,timeInLogId:'fiction-absent-start'}));await assertSucceeds(updateDoc(ref,{timestamp:new Date('2026-10-30T13:07:00Z')}));await assertSucceeds(deleteDoc(ref));});
