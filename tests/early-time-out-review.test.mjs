import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createEarlyTimeOutService} from '../takodeal-manager/early-time-out-actions.js';
import {createEarlyTimeOutReviewService,canReviewEarlyTimeOut} from '../takodeal-manager/early-time-out-review.js';
import {earlyTimeOutSummaryHTML} from '../takodeal-manager/early-time-out-review-ui.js';
const branch='Sample Branch',staffId='sample-staff',name='Sample Crew',email='manager@example.test',clock=new Date('2030-01-10T15:00:00+08:00');
async function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid:'hq-manager',email,emailVerified:true}};h.api.sessionUser={uid:'hq-manager',email,role:'Manager',permissions:['inbox'],allowedBranches:[branch]};h.api.serverTimestamp=()=>new Date(clock);
 h.api.getDocFromServer=async reference=>({exists:()=>h.get(reference.path)!==undefined,data:()=>structuredClone(h.get(reference.path))});
 h.put('hq_managers/sample-manager',{email,role:'Manager',permissions:['inbox'],assignedBranch:branch,pin:'4829',active:true});h.put('hq_email_access/'+email,{active:true,permissions:['inbox'],allowedBranches:[branch]});
 h.put('cashiers/'+staffId,{cashierName:name,branch,pin:'7281',active:true});
 const at=new Date('2030-01-10T09:00:00+08:00'),end=new Date('2030-01-10T17:00:00+08:00'),start={id:'sample-time-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:{version:1,source:'clock-in',branch,staffName:name,clockInAt:at.toISOString(),expectedStartAt:at.toISOString(),expectedEndAt:end.toISOString(),shiftId:'day-slot',wasScheduled:true,needsScheduleReview:false,scheduleRevisionId:'sample-revision'}};
 h.put('attendance_logs/'+start.id,start);const service=createEarlyTimeOutService(h.api,{now:()=>new Date(clock),makeToken:()=> 'sample-request-token'}),request=await service.request({staffId,staffName:name,start,reason:'Medical appointment',pin:'7281'});
 return {...h,start,request,service,review:createEarlyTimeOutReviewService(h.api,{now:()=>new Date(clock)})};
}
test('an assigned verified Manager saves the real protected early-time-out approval and a retry is idempotent',async()=>{
 const h=await fixture(),result=await h.review.review({requestId:h.request.id,decision:'Approved',reviewNote:'Approved for today'});assert.equal(result.decision,'Approved');
 const approval=h.get('attendance_time_out_approvals/'+h.request.id);assert.equal(approval.reviewedByUid,'hq-manager');assert.equal(approval.reviewedByEmail,email);assert.equal(approval.reviewNote,'Approved for today');assert.equal(h.get('staff_requests/'+h.request.id).status,'Approved');assert.equal((await h.review.review({requestId:h.request.id,decision:'Approved'})).alreadySaved,true);
});
test('an invented Manager session cannot bypass a missing, revoked or unrelated protected grant',async()=>{
 for(const change of [null,{active:false,permissions:['inbox'],allowedBranches:[branch]},{active:true,permissions:['history'],allowedBranches:[branch]},{active:true,permissions:['inbox'],allowedBranches:['Other Branch']}] ){
  const h=await fixture();if(change===null)h.docs.delete('hq_email_access/'+email);else h.put('hq_email_access/'+email,change);h.api.sessionUser.permissions=['all'];await assert.rejects(h.review.review({requestId:h.request.id,decision:'Approved'}));assert.equal(h.get('attendance_time_out_approvals/'+h.request.id),undefined);assert.equal(h.get('staff_requests/'+h.request.id).status,'Pending');
 }
});
test('fresh saved HQ status and branch permissions constrain the requested approval',async()=>{
 for(const change of [{permissions:['history']},{active:false},{archived:true},{pin:'REVOKED'},{assignedBranch:'Other Branch'}]){const h=await fixture();h.put('hq_managers/sample-manager',{...h.get('hq_managers/sample-manager'),...change});await assert.rejects(h.review.review({requestId:h.request.id,decision:'Approved'}));assert.equal(h.get('staff_requests/'+h.request.id).status,'Pending');}
});
test('grant revocation inside the approval transaction prevents the pending decision from being saved',async()=>{
 const h=await fixture(),run=h.api.runTransaction;h.api.runTransaction=(...args)=>{h.put('hq_email_access/'+email,{active:false,permissions:['inbox'],allowedBranches:[branch]});return run(...args);};await assert.rejects(h.review.review({requestId:h.request.id,decision:'Approved'}));assert.equal(h.get('attendance_time_out_approvals/'+h.request.id),undefined);assert.equal(h.get('staff_requests/'+h.request.id).status,'Pending');
});
test('a fresh Google and matching session are required even when an old inbox remains open',async()=>{
 const h=await fixture();for(const change of [{uid:'another-user',email,emailVerified:true},{uid:'hq-manager',email,emailVerified:false},null]){h.api.auth.currentUser=change;assert.equal(canReviewEarlyTimeOut(h.api),false);await assert.rejects(h.review.review({requestId:h.request.id,decision:'Rejected'}));}assert.equal(h.get('staff_requests/'+h.request.id).status,'Pending');
});
test('Request Inbox renders escaped reasons and routes early approvals away from generic request writes',()=>{
 const html=earlyTimeOutSummaryHTML({reason:'<script>attack()</script>',managerReply:'<img onerror=attack()>',scheduledEndAt:'2030-01-10T17:00:00+08:00'});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
 assert.match(earlyTimeOutSummaryHTML({scheduledEndAt:null}),/Needs schedule review/);assert.doesNotMatch(earlyTimeOutSummaryHTML({scheduledEndAt:null}),/1970/);
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');assert.match(main,/if\(req\.type==='Early Time Out'\)return window\.getManagerEarlyTimeOutUI\(\)\.review\(docId,action\)/);assert.match(main,/if\(originalRequest\.data\(\)\.type==='Early Time Out'\)/);
});
