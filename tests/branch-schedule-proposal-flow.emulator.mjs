// Full candidate Rules, loopback-only emulator and synthetic records.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
const host='127.0.0.1',port=8804,projectId='demo-schedule-proposal-flow',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing');
const sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,writeBatch,deleteField}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const s=createConnection({host,port});s.setTimeout(250);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied test emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-16000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator did not start: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>{await env.clearFirestore();});
const anon=()=>env.authenticatedContext('sample-phone',{firebase:{sign_in_provider:'anonymous'}}).firestore();
const owner=()=>env.authenticatedContext('sample-owner',{email:'jgo031996@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const publicDB=()=>env.unauthenticatedContext().firestore();
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const r=(db,id='DEV-SAMPLE-PHONE')=>doc(db,'pos_devices',id);
const legacy={deviceId:'DEV-SAMPLE-PHONE',deviceName:'SAMPLE phone',branch:'SAMPLE Branch',appType:'Staff',status:'Pending'};
const reserved={...legacy,setupVersion:1,setupUid:'sample-phone',staffId:'sample-staff',status:'Active'};
const roots=['staff_setup_credentials','staff_app_setup_config','staff_app_bindings','staff_app_device_index','staff_setup_audit','staff_setup_operations','staff_setup_attempts','staff_setup_device_slots'];


import {createScheduleHistoryStore,createScheduleRevision} from '../takodeal-manager/schedule-history.js';
import {projectScheduleMonth} from '../takodeal-manager/schedule-sync.js';
import {scheduleProposalContext} from '../takodeal-manager/schedule-proposal-model.js';
import {createScheduleProposalReview} from '../takodeal-manager/schedule-proposal-review.js';
const fixedNow=new Date('2026-10-25T12:00:00Z');
async function fixture(){
 const branch='SAMPLE Branch',staff=[{staffId:'sample-staff',name:'Sample Staff',scheduleName:'Sample Staff',branch},{staffId:'sample-two',name:'Second Staff',scheduleName:'Second Staff',branch}];
 const row=()=>({scheduled:{m1:'Sample Staff'},rest:['Second Staff'],unavailable:[],swaps:{}}),other=()=>({scheduled:{m1:'Other Staff'},rest:[],unavailable:[]});
 const snapshot={currentYear:2026,currentMonth:10,branchConfig:{[branch]:[{id:'m1',name:'Morning',startTime:'09:00',endTime:'17:30',active:true,days:[0,1,2,3,4,5,6]}],Other:[{id:'m1',name:'Morning',startTime:'08:00',endTime:'16:00',active:true,days:[0,1,2,3,4,5,6]}]},employees:staff,currentSchedule:{25:{[branch]:row(),Other:other()},26:{[branch]:row(),Other:other()},24:{[branch]:row(),Other:other()}},holidays:{},unavailability:{}};
 const revision=createScheduleRevision(snapshot,{revisionId:'sample-base',effectiveFrom:'2026-10-25',savedAt:new Date('2026-10-24T12:00:00Z'),actor:'jgo031996@gmail.com'});revision.sequence=1;
 const head={...revision.snapshot,scheduleRevisionId:revision.revisionId,scheduleEffectiveFrom:revision.effectiveFrom,payrollHistoryEnforcedFrom:'2026-10-25'},index={schemaVersion:1,kind:'schedule-month',month:'2026-10',revisionIds:['sample-base'],latestRevisionId:'sample-base',payrollHistoryEnforcedFrom:'2026-10-25'};
 const view=projectScheduleMonth({month:'2026-10',current:head,archive:{...index,revisions:[revision],latestRevision:revision},now:fixedNow});
 const context=scheduleProposalContext({monthView:view,staff,branch,from:'2026-10-25',to:'2026-10-26',today:'2026-10-25'});
 const proposal={version:1,id:'sample-proposal',branch,month:'2026-10',from:context.from,to:context.to,reason:'Sample illness cover',baseRevisionId:context.baseRevisionId,baseBranchFingerprint:context.baseBranchFingerprint,days:context.days.map(day=>({date:day.date,scheduled:[{shiftId:'m1',staffId:'sample-two'}],standbyStaffIds:['sample-staff'],offStaffIds:[]}))};
 const saved={schemaVersion:1,proposal,intent:'sample-intent',status:'Pending',submittedBy:{uid:'sample-phone',staffId:'sample-staff',staffName:'Sample Staff',deviceId:'DEV-SAMPLE-POS',deviceName:'Sample tablet',branch},submittedAt:'2026-10-25T11:00:00.000Z',reviewedAt:null,reviewedByUid:null,reviewedByEmail:null,reviewNote:'',revisionId:null};
 await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'settings/global_schedule'),head);batch.set(doc(db,'settings/schedule_month_2026_10'),index);batch.set(doc(db,'settings/schedule_revision_sample-base'),revision);batch.set(doc(db,'settings/schedule_history_policy'),{schemaVersion:1,payrollHistoryEnforcedFrom:'2026-10-25'});batch.set(doc(db,'branch_schedule_proposals/sample-proposal'),saved);batch.set(doc(db,'attendance_logs/sample-punch'),{staffId:'sample-staff',type:'TIME IN',timestamp:'2026-10-25T09:00:00+08:00'});batch.set(doc(db,'payroll_records/sample-paid'),{status:'Paid',amount:1234});for(const person of staff)batch.set(doc(db,'cashiers',person.staffId),{cashierName:person.name,scheduleNickname:person.scheduleName,branch,pin:'000111',role:'Crew',status:'Active'});await batch.commit();});
 const db=owner(),api={...sdk,db,auth:{currentUser:{uid:'sample-owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'sample-owner',email:'jgo031996@gmail.com',isOwner:true},isBranchAllowed:()=>true};
 const store=createScheduleHistoryStore(api,{now:()=>fixedNow});api.getScheduleHistoryStore=()=>store;
 return {db,api,service:createScheduleProposalReview(api,{now:()=>fixedNow}),snapshot,proposal};
}
test('actual Owner review atomically approves the proposal and a dated canonical revision without changing other branches, past days, punches or paid payroll',async()=>{
 const f=await fixture();const prepared=await f.service.prepare('sample-proposal');assert.equal(prepared.snapshot.currentSchedule[25]['SAMPLE Branch'].scheduled.m1,'Second Staff');
 const result=await f.service.decide({id:'sample-proposal',decision:'Approved',reason:'Verified sample illness cover',expectedIntent:'sample-intent'});assert.equal(result.row.status,'Approved');
 const revision=(await getDocFromServer(doc(f.db,'settings/schedule_revision_proposal-sample-proposal'))).data();assert.equal(revision.branchScheduleProposalId,'sample-proposal');assert.equal(revision.snapshot.currentSchedule[25]['SAMPLE Branch'].scheduled.m1,'Second Staff');assert.equal(revision.snapshot.currentSchedule[26]['SAMPLE Branch'].scheduled.m1,'Second Staff');assert.deepEqual(revision.snapshot.currentSchedule[25].Other,f.snapshot.currentSchedule[25].Other);assert.deepEqual(revision.snapshot.currentSchedule[24],f.snapshot.currentSchedule[24]);assert.equal(revision.branchScheduleProposalAudit.submittedBy.staffName,'Sample Staff');assert.equal(revision.branchScheduleProposalAudit.reviewedByEmail,'jgo031996@gmail.com');assert.ok(revision.branchScheduleProposalAudit.approvedAt.toMillis()>0);
 await admin(async db=>{assert.deepEqual((await getDocFromServer(doc(db,'payroll_records/sample-paid'))).data(),{status:'Paid',amount:1234});assert.equal((await getDocFromServer(doc(db,'attendance_logs/sample-punch'))).data().timestamp,'2026-10-25T09:00:00+08:00');});
 const repeat=await f.service.decide({id:'sample-proposal',decision:'Approved',reason:'Verified sample illness cover',expectedIntent:'sample-intent'});assert.equal(repeat.alreadySaved,true);const index=(await getDocFromServer(doc(f.db,'settings/schedule_month_2026_10'))).data();assert.equal(index.revisionIds.filter(x=>x==='proposal-sample-proposal').length,1);
});
test('actual Owner rejection records attribution without creating any schedule revision',async()=>{
 const f=await fixture();const result=await f.service.decide({id:'sample-proposal',decision:'Rejected',reason:'Please ask the branch to resubmit',expectedIntent:'sample-intent'});assert.equal(result.row.status,'Rejected');assert.equal((await getDocFromServer(doc(f.db,'settings/schedule_revision_proposal-sample-proposal'))).exists(),false);assert.equal((await getDocFromServer(doc(f.db,'settings/global_schedule'))).data().scheduleRevisionId,'sample-base');
});
