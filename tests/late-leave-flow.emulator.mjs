// Actual client service + generated Rules + a loopback-only demo project.
// Every staff member, schedule, punch and paid record below is fictional.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {createLeaveScheduleService} from '../takodeal-manager/leave-schedule-actions.js';
import {createScheduleRevision,createScheduleHistoryStore,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';

const host='127.0.0.1',port=8818,projectId='demo-late-leave-flow',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,getDocFromServer,getDocsFromServer,collection,writeBatch,Timestamp}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The isolated local emulator runtime is missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
before(async()=>{
 if(await reachable())throw Error('Refusing an occupied test port.');
 child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{cwd:tools,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));
 const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}
 env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});
},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>{await env.clearFirestore();});

const now=new Date('2026-10-31T04:00:00Z'),ownerEmail='jgo031996@gmail.com',branch='Fictional Branch',otherBranch='Other Fictional Branch',staffId='fictional-leave-staff',staffName='Fictional Leave Person',requestId='fictional-leave-request';
const google=(uid,email,verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified,firebase:{sign_in_provider:'google.com'}}).firestore();
const owner=()=>google('fictional-owner',ownerEmail),copy=value=>structuredClone(value);
const admin=async callback=>{let result;await env.withSecurityRulesDisabled(async context=>{result=await callback(context.firestore());});return result;};
const seed=(path,value)=>admin(db=>setDoc(doc(db,path),value));
const get=path=>admin(async db=>(await getDocFromServer(doc(db,path))).data());
async function dump(){return admin(async db=>{const rows=[];for(const table of ['cashiers','settings','staff_requests','attendance_logs','payroll_records']){const result=await getDocsFromServer(collection(db,table));for(const item of result.docs)rows.push({path:table+'/'+item.id,data:item.data()});}return rows.sort((a,b)=>a.path.localeCompare(b.path));});}
function apiFor({uid='fictional-owner',email=ownerEmail,verified=true,allowed=['All'],isOwner=true}={}){
 const db=google(uid,email,verified),api={...sdk,db,auth:{currentUser:{uid,email,emailVerified:verified,providerData:[{providerId:'google.com'}]}},sessionUser:{uid,email,cashierName:'Fictional Reviewer',isOwner,isFranchisee:false,permissions:['inbox','schedule'],allowedBranches:allowed},isBranchAllowed:value=>allowed.includes('All')||allowed.includes(value)};
 return api;
}
function schedule(month){const count=month===10?31:30,day=()=>({[branch]:{scheduled:{morning:staffName},rest:[],unavailable:[],swaps:{}},[otherBranch]:{scheduled:{morning:'Other Fictional Person'},rest:[],unavailable:[],swaps:{}}});return {currentYear:2026,currentMonth:month,branchConfig:{[branch]:[{id:'morning',name:'Morning',startTime:'09:00',endTime:'17:30',active:true,days:[0,1,2,3,4,5,6]}],[otherBranch]:[{id:'morning',name:'Morning',startTime:'10:00',endTime:'18:30',active:true,days:[0,1,2,3,4,5,6]}]},employees:[{name:staffName,branch},{name:'Other Fictional Person',branch:otherBranch}],unavailability:{},holidays:{},currentSchedule:Object.fromEntries(Array.from({length:count},(_,index)=>[index+1,day()]))};}
function pending(startDate='2026-10-30',endDate='2026-10-31'){return {type:'Leave',schemaVersion:1,staffId,staffName,branch,startDate,endDate,leaveType:'Leave',reason:'Fictional family appointment',status:'Pending',staffAcknowledged:false,timestamp:Timestamp.fromDate(new Date('2026-10-28T02:00:00Z')),leaveVersion:0};}
function markLeave(snapshot,date){const day=Number(date.slice(-2)),marker={status:'Leave',leaveRequestId:requestId,staffId};snapshot.currentSchedule[day][branch].scheduled.morning='UNFILLED';snapshot.currentSchedule[day][branch].unavailable=[{name:staffName,...marker}];snapshot.unavailability[date]={[staffName]:marker};}
async function fixture({startDate='2026-10-30',endDate='2026-10-31',approved=false}={}){
 const october=schedule(10),november=schedule(11),row=pending(startDate,endDate);
 if(approved){Object.assign(row,{status:'Approved',activeLeaveDates:['2026-10-31','2026-11-01'],leaveVersion:1,leaveState:'Active',leaveScheduleSync:{version:1,updatedAt:'2026-10-28T03:00:00.000Z',activeDates:['2026-10-31','2026-11-01'],revisionIds:['base-oct','base-nov'],skippedHistoricalDates:[]},originalLeaveApproval:{at:'2026-10-28T03:00:00.000Z',actor:{uid:'fictional-owner',email:ownerEmail},reply:'Originally approved fictional leave',startDate,endDate,reason:'Fictional family appointment'}});markLeave(october,'2026-10-31');markLeave(november,'2026-11-01');}
 const revisions=[createScheduleRevision(october,{revisionId:'base-oct',effectiveFrom:'2026-10-01',savedAt:'2026-10-01T00:00:00Z',actor:ownerEmail,cutover:'2026-10-01'}),createScheduleRevision(november,{revisionId:'base-nov',effectiveFrom:'2026-11-01',savedAt:'2026-10-01T00:00:00Z',actor:ownerEmail,cutover:'2026-10-01'})];for(const revision of revisions)revision.sequence=1;
 await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'cashiers',staffId),{cashierName:staffName,branch,pin:'FICTIONAL_ONLY_PIN',status:'Active',active:true});batch.set(doc(db,'cashiers','other-fictional-staff'),{cashierName:'Other Fictional Person',branch:otherBranch,pin:'OTHER_FICTIONAL_PIN',status:'Active',active:true});for(const revision of revisions){batch.set(doc(db,'settings','schedule_revision_'+revision.revisionId),revision);batch.set(doc(db,'settings','schedule_month_'+revision.month.replace('-','_')),{schemaVersion:1,kind:'schedule-month',month:revision.month,revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId,payrollHistoryEnforcedFrom:'2026-10-01'});}batch.set(doc(db,'settings','global_schedule'),{...copy(revisions[0].snapshot),scheduleRevisionId:'base-oct',scheduleEffectiveFrom:'2026-10-01',payrollHistoryEnforcedFrom:'2026-10-01'});batch.set(doc(db,'settings','schedule_history_policy'),{schemaVersion:1,payrollHistoryEnforcedFrom:'2026-10-01'});batch.set(doc(db,'staff_requests',requestId),row);if(approved)batch.set(doc(db,'settings','schedule_leave_staff_'+staffId),{schemaVersion:1,kind:'staff-leave-claims',staffId,dates:Object.fromEntries(row.activeLeaveDates.map(date=>[date,{requestId,staffId}])),updatedAt:'2026-10-28T03:00:00Z'});await batch.commit();});
 const api=apiFor(),service=createLeaveScheduleService(api,{now:()=>new Date(now)}),store=createScheduleHistoryStore(api,{now:()=>new Date(now)});return {api,service,store,row,revisions};
}
const approve=(operationId='late-approval',patch={})=>({requestId,action:'Approved',operationId,confirmHistorical:true,reply:'Reviewed and confirmed the delayed leave request',...patch});

test('actual Owner service approves late leave and saves historical provenance without replacing original schedule versions',async()=>{
 const f=await fixture(),original=await get('settings/schedule_revision_base-oct'),result=await assertSucceeds(f.service.review(approve()));assert.deepEqual(result.changedDates,['2026-10-30','2026-10-31']);assert.deepEqual(result.historicalDates,['2026-10-30']);assert.deepEqual(await get('settings/schedule_revision_base-oct'),original);
 const parent=await get('staff_requests/'+requestId);assert.equal(parent.status,'Approved');assert.equal(parent.originalLeaveApproval.at,now.toISOString());assert.equal(parent.leaveActions.length,1);const history=await f.store.loadRange('2026-10-29','2026-10-31');assert.equal(resolveScheduleForDate(history,'2026-10-29').currentSchedule[29][branch].scheduled.morning,staffName);const actual=resolveScheduleForDate(history,'2026-10-30');assert.equal(actual.currentSchedule[30][branch].scheduled.morning,'UNFILLED');assert.equal(actual.currentSchedule[30][branch].unavailable[0].leaveRequestId,requestId);assert.equal(actual.branchConfig[branch][0].startTime,'09:00');const revision=await get('settings/schedule_revision_late-approval-20261030');assert.equal(revision.historicalLeaveReview.basisRevisionId,'base-oct');assert.equal(revision.historicalLeaveReview.recordedAt,now.toISOString());assert.equal((await get('settings/schedule_leave_staff_'+staffId)).dates['2026-10-30'].requestId,requestId);
});

test('an entirely earlier pending leave completes instead of being relabeled cancelled',async()=>{
 const f=await fixture({startDate:'2026-10-29',endDate:'2026-10-30'}),result=await assertSucceeds(f.service.review(approve('all-past-approval')));assert.deepEqual(result.historicalDates,['2026-10-29','2026-10-30']);const parent=await get('staff_requests/'+requestId);assert.equal(parent.leaveState,'Completed');assert.equal(parent.status,'Approved');assert.deepEqual(parent.activeLeaveDates,['2026-10-29','2026-10-30']);
});

test('the October 30–31 date-change request remains valid when the Owner reviews it on October 31',async()=>{
 const f=await fixture({startDate:'2026-10-31',endDate:'2026-11-01',approved:true}),approval=copy(f.row.originalLeaveApproval),childId='fictional-date-correction';await seed('staff_requests/'+requestId,{...f.row,pendingLeaveChangeId:childId});await seed('staff_requests/'+childId,{type:'Leave Change',schemaVersion:1,staffId,staffName,branch,leaveRequestId:requestId,changeKind:'Dates',requestedActiveDates:['2026-10-30','2026-10-31'],cancelDates:['2026-11-01'],proposedStartDate:'2026-10-30',proposedEndDate:'2026-10-31',reason:'Fictional correction of the wrong requested day',status:'Pending',staffAcknowledged:false,timestamp:Timestamp.fromDate(new Date('2026-10-29T03:00:00Z')),sourceLeaveVersion:1,sourceActiveDates:['2026-10-31','2026-11-01']});
 const result=await assertSucceeds(f.service.review({...approve('late-child-review'),requestId:childId}));assert.deepEqual(result.changedDates,['2026-10-30','2026-11-01']);const parent=await get('staff_requests/'+requestId);assert.deepEqual(parent.activeLeaveDates,['2026-10-30','2026-10-31']);assert.deepEqual(parent.originalLeaveApproval,approval);assert.equal(parent.pendingLeaveChangeId,null);assert.equal((await get('staff_requests/'+childId)).status,'Approved');assert.deepEqual(await get('settings/schedule_revision_base-nov'),f.revisions[1]);const history=await f.store.loadRange('2026-10-30','2026-11-01');assert.equal(resolveScheduleForDate(history,'2026-10-30').currentSchedule[30][branch].unavailable[0].staffId,staffId);assert.deepEqual(resolveScheduleForDate(history,'2026-11-01').currentSchedule[1][branch].rest,[staffName]);
});

test('late approval requires its explicit confirmation and management note before any persistent change',async()=>{
 const f=await fixture(),before=await dump();for(const patch of [{confirmHistorical:false},{confirmHistorical:undefined},{reply:''},{reply:'a'}]){await assert.rejects(f.service.review(approve('needs-review',patch)),/confirm|historical|earlier|note|reason/i);assert.deepEqual(await dump(),before);}
});

test('a paid cutoff matched by stable staff ID holds the late approval without changing any document',async()=>{
 const f=await fixture();await seed('payroll_records/fictional-frozen-payroll',{staffId,staffName:'Former Fictional Name',startDate:'2026-10-16',endDate:'2026-10-31',status:'Paid',frozenData:{hours:80,net:4000}});const before=await dump();await assert.rejects(f.service.review(approve('paid-review')),/paid|payroll|payslip/i);assert.deepEqual(await dump(),before);
});

test('recorded overnight work on an affected leave workday holds approval and preserves both original punches',async()=>{
 const f=await fixture({startDate:'2026-10-30',endDate:'2026-10-30'});await seed('attendance_logs/fictional-time-in',{staffId,staffName,branch,type:'TIME IN',timestamp:Timestamp.fromDate(new Date('2026-10-30T18:30:00+08:00'))});await seed('attendance_logs/fictional-time-out',{staffId,staffName,branch,type:'TIME OUT',timestamp:Timestamp.fromDate(new Date('2026-10-31T03:06:00+08:00')),timeInLogId:'fictional-time-in'});const before=await dump();await assert.rejects(f.service.review(approve('recorded-work-review')),/recorded|attendance|shift|Time In/i);assert.deepEqual(await dump(),before);
});

test('the real service refuses an unverified reviewer and a reviewer outside the staff branch without writing leave or schedules',async()=>{
 await fixture();const before=await dump();const actors=[apiFor({verified:false}),apiFor({uid:'wrong-branch-reviewer',email:'wrong-branch@example.test',allowed:[otherBranch],isOwner:false})];for(const api of actors){const service=createLeaveScheduleService(api,{now:()=>new Date(now)});await assert.rejects(service.review(approve('denied-review')));assert.deepEqual(await dump(),before);}
});

test('lost acknowledgement and retries retain one approved action, dated revision and date claim through real transactions',async()=>{
 const f=await fixture(),run=f.api.runTransaction;let lose=true;f.api.runTransaction=async(...args)=>{const result=await run(...args);if(lose){lose=false;throw Error('Fictional lost acknowledgement after commit');}return result;};const input=approve('lost-ack-review');await assert.rejects(f.service.review(input),/lost acknowledgement/);const saved=await dump(),recovered=await assertSucceeds(f.service.review(input));assert.equal(recovered.alreadySaved,true);assert.deepEqual(await dump(),saved);const parent=await get('staff_requests/'+requestId);assert.equal(parent.leaveActions.filter(action=>action.id===input.operationId).length,1);const index=await get('settings/schedule_month_2026_10');assert.equal(index.revisionIds.filter(id=>id==='lost-ack-review-20261030').length,1);assert.equal((await get('settings/schedule_leave_staff_'+staffId)).dates['2026-10-30'].requestId,requestId);await assert.rejects(f.service.review({...input,reply:'Changed details on the same review reference'}),/different saved details/);assert.deepEqual(await dump(),saved);
});

test('future-only leave still approves without a historical acknowledgement and keeps the current head month',async()=>{
 const f=await fixture({startDate:'2026-11-01',endDate:'2026-11-02'}),head=await get('settings/global_schedule'),input=approve('future-only-review');delete input.confirmHistorical;const result=await assertSucceeds(f.service.review(input));assert.deepEqual(result.changedDates,['2026-11-01','2026-11-02']);assert.deepEqual(result.historicalDates,[]);assert.deepEqual(await get('settings/global_schedule'),head);const history=await f.store.loadRange('2026-11-01','2026-11-02');assert.equal(resolveScheduleForDate(history,'2026-11-01').currentSchedule[1][branch].unavailable[0].leaveRequestId,requestId);
});
