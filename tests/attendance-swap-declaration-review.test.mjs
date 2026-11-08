import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {inspectScheduleDeclaration,scheduleDeclarationHTML,scheduleDeclarationSourceFingerprint,acknowledgeScheduleDeclaration} from '../takodeal-manager/attendance-swap-declaration.js';
import {lateRequestSummaryHTML} from '../takodeal-manager/late-request-summary.js';
import {reviewOriginalLateRequest,lateRequestResolutionFingerprint} from '../takodeal-manager/late-request-resolution.js';
const email='jgo031996@gmail.com',at=new Date('2026-11-08T09:10:00+08:00');
function fixture(){
 const f=firestoreHarness(),branch='Synthetic Branch',requestId='synthetic-declaration',attendanceId='synthetic-punch';
 const declaration={schemaVersion:1,kind:'unrequested-swap',referenceOnly:true,staffId:'synthetic-staff',staffName:'Synthetic Crew',attendanceBranch:branch,declaredAt:at.toISOString(),coworkerStaffId:'synthetic-coworker',coworkerName:'Other Synthetic Crew',coworkerHomeBranch:'Other Synthetic Branch',workDate:'2026-11-08',targetBranch:branch,targetShiftId:'morning',targetShiftName:'Morning',targetAssignedName:'Other Synthetic Crew',targetStartAt:'2026-11-08T09:00:00+08:00',targetEndAt:'2026-11-08T18:00:00+08:00',sourceRevisionId:'synthetic-roster',sourceFingerprint:'synthetic-source',originalScheduleFingerprint:'synthetic-original',explanation:'The actual branch shift needs an independent review.'};
 const request={type:'Schedule Declaration',status:'Pending',staffId:declaration.staffId,staffName:declaration.staffName,branch,attendanceLogId:attendanceId,timestamp:at,explanationCause:'Unrequested shift swap',explanationMessage:declaration.explanation,scheduleDeclaration:declaration};
 const attendance={type:'TIME IN',staffId:request.staffId,staffName:request.staffName,branch,timestamp:at,lateMinutes:10,scheduleSnapshot:{expectedStartAt:'2026-11-08T09:00:00+08:00',lateMinutes:10},scheduleDeclaration:structuredClone(declaration),scheduleDeclarationRequestId:requestId};
 Object.assign(f.api,{auth:{currentUser:{uid:'synthetic-owner',email,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'synthetic-owner',email,isOwner:true,permissions:['all'],allowedBranches:['All']},isBranchAllowed:value=>value===branch});
 f.put('staff_requests/'+requestId,request);f.put('attendance_logs/'+attendanceId,attendance);f.put('cashiers/'+request.staffId,{cashierName:request.staffName,branch,active:true});f.put('payroll_records/synthetic-paid',{paid:true,amount:123});f.put('settings/global_schedule',{original:true});
 const req=()=>({...f.get('staff_requests/'+requestId),id:requestId}),log=()=>({...f.get('attendance_logs/'+attendanceId),id:attendanceId});
 const input=()=>({requestId,attendanceId,branch,expectedFingerprint:scheduleDeclarationSourceFingerprint(req(),log())});
 return Object.assign(f,{branch,requestId,attendanceId,req,log,input});
}
const state=f=>structuredClone([...f.docs]);

test('the Owner sees a staff statement and exact dated coworker reference without any approval claim',()=>{
 const f=fixture(),before=state(f),html=scheduleDeclarationHTML(f.req());assert.equal(inspectScheduleDeclaration(f.req(),f.log()).coworkerStaffId,'synthetic-coworker');assert.match(html,/Unrequested shift swap · staff statement/);assert.match(html,/Other Synthetic Crew/);assert.match(html,/does not approve a swap/);assert.deepEqual(state(f),before);
 const late={...f.req(),type:'Reason Letter',lateMinutes:10,explanationCause:'Tardiness / Late Arrival · Unrequested shift swap'};assert.match(lateRequestSummaryHTML(late),/staff statement/);assert.match(lateRequestSummaryHTML(late),/Original submission · 10/);
});
test('staff-provided labels are escaped and malformed declarations never masquerade as an approved shift',()=>{
 const f=fixture(),row=f.req();row.scheduleDeclaration.coworkerName='<img src=x onerror=bad()>';row.scheduleDeclaration.targetAssignedName=row.scheduleDeclaration.coworkerName;const html=scheduleDeclarationHTML(row);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);row.scheduleDeclaration.referenceOnly=false;assert.match(scheduleDeclarationHTML(row),/needs review/);assert.doesNotMatch(scheduleDeclarationHTML(row),/approved shift/);
});
for(const defect of ['other punch','other employee','other branch','missing backlink','changed statement','voided','not TIME IN','missing punch time'])test(defect+' cannot supply a declaration source for acknowledgment',()=>{
 const f=fixture(),row=f.log();if(defect==='other punch')row.id='other';if(defect==='other employee')row.staffId='other';if(defect==='other branch')row.branch='other';if(defect==='missing backlink')delete row.scheduleDeclarationRequestId;if(defect==='changed statement')row.scheduleDeclaration.explanation='Different statement';if(defect==='voided')row.status='Voided';if(defect==='not TIME IN')row.type='TIME OUT';if(defect==='missing punch time')delete row.timestamp;assert.throws(()=>scheduleDeclarationSourceFingerprint(f.req(),row),/does not match/);
});
test('Date and Firestore Timestamp representations bind the same original instant',()=>{const f=fixture(),before=scheduleDeclarationSourceFingerprint(f.req(),f.log()),row=f.log();row.timestamp={seconds:+at/1000,nanoseconds:0};assert.equal(scheduleDeclarationSourceFingerprint(f.req(),row),before);});
test('an exact saved roster alias and an unrecorded home branch remain distinct informational fields',()=>{const f=fixture();for(const path of ['staff_requests/'+f.requestId,'attendance_logs/'+f.attendanceId]){const row=f.get(path);row.scheduleDeclaration.targetAssignedName='Other Crew';row.scheduleDeclaration.coworkerHomeBranch='';}assert.ok(scheduleDeclarationSourceFingerprint(f.req(),f.log()));const html=scheduleDeclarationHTML(f.req());assert.match(html,/Other Synthetic Crew/);assert.match(html,/Roster name: Other Crew/);assert.match(html,/home branch Not recorded/);});
test('marking a statement reviewed changes only its inbox record, retaining raw lateness and paid payroll',async()=>{
 const f=fixture(),before=state(f);assert.equal((await acknowledgeScheduleDeclaration(f.api,f.input())).reviewed,true);const row=f.req();assert.equal(row.status,'Reviewed');assert.equal(row.declarationAcknowledgement.acknowledgementOnly,true);assert.deepEqual([...f.docs].filter(([path])=>path!=='staff_requests/'+f.requestId),before.filter(([path])=>path!=='staff_requests/'+f.requestId));assert.equal(f.log().lateMinutes,10);assert.equal(f.log().scheduleSnapshot.lateMinutes,10);
});
test('failed commits and lost acknowledgments preserve one idempotent informational review',async()=>{
 const f=fixture(),before=state(f),input=f.input();f.failNextCommit();await assert.rejects(acknowledgeScheduleDeclaration(f.api,input),/Commit rejected/);assert.deepEqual(state(f),before);f.loseNextAck();await assert.rejects(acknowledgeScheduleDeclaration(f.api,input),/lost after commit/);const saved=state(f);assert.equal((await acknowledgeScheduleDeclaration(f.api,input)).alreadyReviewed,true);assert.deepEqual(state(f),saved);
});
for(const changed of ['statement','punch','source roster'])test(changed+' changed after preview cannot be acknowledged',async()=>{
 const f=fixture(),input=f.input();if(changed==='statement')f.get('staff_requests/'+f.requestId).scheduleDeclaration.explanation='Different explanation';if(changed==='punch')f.get('attendance_logs/'+f.attendanceId).timestamp=new Date(+at+60000);if(changed==='source roster'){for(const path of ['staff_requests/'+f.requestId,'attendance_logs/'+f.attendanceId])f.get(path).scheduleDeclaration.sourceRevisionId='new-roster';}const before=state(f);await assert.rejects(acknowledgeScheduleDeclaration(f.api,input),/changed|does not match/);assert.deepEqual(state(f),before);
});
for(const denied of ['not verified','wrong provider','franchise','different UID','branch outside access','no inbox permission'])test(denied+' cannot acknowledge a declaration',async()=>{
 const f=fixture(),input=f.input();if(denied==='not verified')f.api.auth.currentUser.emailVerified=false;if(denied==='wrong provider')f.api.auth.currentUser.providerData=[];if(denied==='franchise')f.api.sessionUser.isFranchisee=true;if(denied==='different UID')f.api.sessionUser.uid='other';if(denied==='branch outside access')f.api.isBranchAllowed=()=>false;if(denied==='no inbox permission'){f.api.auth.currentUser.email='hq@example.invalid';Object.assign(f.api.sessionUser,{email:'hq@example.invalid',isOwner:false,role:'Manager',permissions:[],allowedBranches:[f.branch]});}const before=state(f);await assert.rejects(acknowledgeScheduleDeclaration(f.api,input),/approved HQ/);assert.deepEqual(state(f),before);
});
test('identity replacement during a transaction aborts without touching attendance or requests',async()=>{
 const f=fixture(),input=f.input(),run=f.api.runTransaction;f.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async ref=>{const result=await tx.get(ref);if(ref.path==='attendance_logs/'+f.attendanceId)f.api.auth.currentUser={...f.api.auth.currentUser};return result;}}));const before=state(f);await assert.rejects(acknowledgeScheduleDeclaration(f.api,input),/account.*changed/);assert.deepEqual(state(f),before);
});
test('a late-letter review requires the displayed declaration source and rejects a missing or stale preview',async()=>{
 const f=fixture(),request=f.get('staff_requests/'+f.requestId);Object.assign(request,{type:'Reason Letter',lateMinutes:10,explanationCause:'Tardiness / Late Arrival · Unrequested shift swap'});const before=state(f);
 await assert.rejects(reviewOriginalLateRequest(f.api,{requestId:f.requestId,attendanceId:f.attendanceId,profileId:request.staffId,action:'Approved',reply:'Original hours reviewed separately.',actor:'Synthetic Owner'}),/statement.*changed/);assert.deepEqual(state(f),before);
 const fingerprint=lateRequestResolutionFingerprint(f.req(),f.log(),{});f.get('attendance_logs/'+f.attendanceId).scheduleDeclarationRequestId='other';assert.throws(()=>lateRequestResolutionFingerprint(f.req(),f.log(),{}),/does not match/);assert.ok(fingerprint.includes('declarationSource'));
});
