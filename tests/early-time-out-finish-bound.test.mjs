import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createEarlyTimeOutService} from '../takodeal-manager/early-time-out-actions.js';
import {createEarlyTimeOutReviewService} from '../takodeal-manager/early-time-out-review.js';
import {createScheduleRevision} from '../takodeal-manager/schedule-history.js';

const branch='Maa',staffId='fictional-maa-staff',name='Fictional Maa Crew',email='maa-reviewer@example.test';
const at=time=>new Date(`2026-10-19T${time}:00+08:00`);
function fixture({extraRules=[]}={}){
 const h=firestoreHarness();let clock=at('17:00'),sequence=0;
 h.api.serverTimestamp=()=>new Date(clock);
 h.api.getDocFromServer=async ref=>({exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}});
 const query=h.api.getDocsFromServer;h.api.getDocsFromServer=async ref=>{const result=await query(ref);return {...result,metadata:{fromCache:false,hasPendingWrites:false},docs:result.docs.map(row=>({...row,metadata:{fromCache:false,hasPendingWrites:false}}))};};
 h.api.auth={currentUser:{uid:'maa-reviewer',email,emailVerified:true}};
 h.api.sessionUser={uid:'maa-reviewer',email,role:'Manager',permissions:['inbox'],allowedBranches:[branch]};
 h.put('hq_managers/maa-reviewer',{email,role:'Manager',permissions:['inbox'],assignedBranch:branch,pin:'4829',active:true});
 h.put('hq_email_access/'+email,{active:true,permissions:['inbox'],allowedBranches:[branch]});
 h.put('cashiers/'+staffId,{cashierName:name,branch,pin:'7281',active:true});
 h.put('payroll_records/frozen-paid',{status:'Paid',frozenData:{paidHours:80,netPay:4500}});
 const input={currentYear:2026,currentMonth:10,branchConfig:{[branch]:[
  {id:'m1',name:'Morning Staff 1',shiftType:'morning',startTime:'09:00',endTime:'17:30',active:true},
  {id:'m2',name:'Morning Staff 2',shiftType:'morning',startTime:'09:30',endTime:'18:00',active:true},...extraRules]},
  currentSchedule:{19:{[branch]:{scheduled:{m1:'Other Fictional Crew',m2:'UNFILLED'},rest:[name],unavailable:[],swaps:{}}}},
  employees:[{id:staffId,name,branch}],unavailability:{}};
 const revision=createScheduleRevision(input,{revisionId:'captured-maa-revision',effectiveFrom:'2026-10-01',savedAt:new Date('2026-10-01T07:00:00+08:00'),cutover:'2026-10-01'});
 h.put('settings/global_schedule',{...revision.snapshot,scheduleRevisionId:revision.revisionId,payrollHistoryEnforcedFrom:'2026-10-01'});
 h.put('settings/schedule_month_2026_10',{month:'2026-10',revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId});
 h.put('settings/schedule_revision_'+revision.revisionId,revision);
 const start={id:'fictional-maa-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:at('08:49'),scheduleSnapshot:{
  version:1,source:'clock-in',branch,staffName:name,clockInAt:at('08:49').toISOString(),expectedStartAt:at('09:00').toISOString(),expectedEndAt:at('17:30').toISOString(),
  shiftId:'m1',wasScheduled:false,needsScheduleReview:false,scheduleRevisionId:revision.revisionId}};
 h.put('attendance_logs/'+start.id,start);
 const service=createEarlyTimeOutService(h.api,{now:()=>new Date(clock),makeToken:()=>`fictional-request-${++sequence}`});
 const review=createEarlyTimeOutReviewService(h.api,{now:()=>new Date(clock)});
 const staffInput={start,staffId,staffName:name,pin:'7281',assertCurrent(){}};
 return {h,start,service,review,staffInput,setClock:value=>{clock=at(value);},request:()=>service.request({...staffInput,reason:'Fictional test review only'}),
  attendance:{staffId,staffName:name,branch,type:'TIME OUT',sourceApp:'synthetic-test-only'}};
}
const records=h=>structuredClone([...h.docs]);
const attendance=h=>[...h.docs].filter(([path])=>path.startsWith('attendance_logs/'));

test('unassigned preserved punch permits normal close only after every plausible captured shift has ended',async()=>{
 const f=fixture(),raw=structuredClone(f.start),paid=structuredClone(f.h.get('payroll_records/frozen-paid'));
 f.setClock('17:40');const before=await f.service.inspect(f.staffInput);
 assert.equal(before.unknown,true);assert.equal(before.early,false);assert.equal(before.complete,false);assert.equal(before.clockOutCompleteOnly,true);
 assert.equal(before.clockOutLatestFinishAt,at('18:00').toISOString());
 const request=await f.request();assert.equal(f.h.get('staff_requests/'+request.id).requiresScheduleReview,true);
 await assert.rejects(f.review.review({requestId:request.id,decision:'Approved'}),/does not identify a verified assigned shift finish/);
 await assert.rejects(f.service.close({...f.staffInput,attendance:f.attendance}),/could not be verified/);
 assert.equal(attendance(f.h).length,1);
 f.setClock('18:40');const complete=await f.service.inspect(f.staffInput);
 assert.equal(complete.unknown,false);assert.equal(complete.early,false);assert.equal(complete.complete,true);assert.equal(complete.scheduledEndAt,at('18:00').toISOString());
 assert.deepEqual(complete.clockOutScheduleEvidence.shiftIds,['m1','m2']);assert.equal(attendance(f.h).length,1,'inspection never records departure');
 const result=await f.service.close({...f.staffInput,attendance:{...f.attendance,timestamp:at('17:40')}});
 assert.equal(result.saved,true);const out=f.h.get('attendance_logs/'+result.id);
 assert.equal(+out.timestamp,+at('18:40'),'actual final close overrides stale submitted timestamp');assert.equal(out.earlyTimeOut,undefined);
 assert.equal(f.h.get('staff_requests/'+request.id).status,'Completed Normally');assert.equal(f.h.get('attendance_time_out_approvals/'+request.id),undefined);
 assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),raw);assert.deepEqual(f.h.get('payroll_records/frozen-paid'),paid);
 assert.equal((await f.service.close({...f.staffInput,attendance:f.attendance})).alreadySaved,true);assert.equal(attendance(f.h).length,2);
});

test('a later plausible saved shift extends the bound; an unrelated late shift does not',async()=>{
 const f=fixture({extraRules:[{id:'m3',startTime:'10:00',endTime:'19:00',active:true},{id:'night',startTime:'20:00',endTime:'04:00',active:true}]});
 f.setClock('18:40');const ctx=await f.service.inspect(f.staffInput);
 assert.equal(ctx.unknown,true);assert.equal(ctx.complete,false);assert.equal(ctx.clockOutLatestFinishAt,at('19:00').toISOString());
 assert.deepEqual(ctx.clockOutScheduleEvidence.shiftIds,['m1','m2','m3']);
 await assert.rejects(f.service.close({...f.staffInput,attendance:f.attendance}),/could not be verified/);
 f.setClock('19:00');assert.equal((await f.service.inspect(f.staffInput)).complete,true);
});

test('HQ fresh inspection is read-only and explicit dismissal clears only the obsolete request audit',async()=>{
 const f=fixture(),request=await f.request(),pending=structuredClone(f.h.get('staff_requests/'+request.id));
 f.setClock('18:40');const before=records(f.h),ctx=await f.review.inspect({requestId:request.id,expectedRequestVersion:pending.requestVersion,expectedRequestToken:pending.requestToken});
 assert.equal(ctx.complete,true);assert.equal(ctx.early,false);assert.equal(ctx.unknown,false);assert.equal(ctx.closed,false);assert.equal(ctx.clockOutCompleteOnly,true);assert.equal(ctx.scheduleChanged,true);assert.deepEqual(records(f.h),before);
 await assert.rejects(f.review.review({requestId:request.id,decision:'Approved'}),/approval is not required/);
 const result=await f.review.dismiss({requestId:request.id,expectedRequestVersion:pending.requestVersion,expectedRequestToken:pending.requestToken,reviewNote:'Verified saved finish has passed. Use normal Time Out.'});
 assert.equal(result.decision,'Not Required');const row=f.h.get('staff_requests/'+request.id);
 assert.equal(row.status,'Not Required');assert.equal(row.timeOutReview.verifiedFinishAt,at('18:00').toISOString());assert.equal(row.timeOutReview.completeOnly,true);assert.equal(row.timeOutReview.existingTimeOutLogId,null);
 assert.equal(row.processedBy,email);assert.equal(+row.processedAt,+at('18:40'));assert.equal(f.h.get('attendance_time_out_approvals/'+request.id),undefined);assert.equal(attendance(f.h).length,1);
 for(const [path,value]of before)if(path!=='staff_requests/'+request.id)assert.deepEqual(f.h.get(path),value,path);
 const after=records(f.h);assert.equal((await f.review.dismiss({requestId:request.id})).alreadySaved,true);assert.deepEqual(records(f.h),after);
 const closed=await f.service.close({...f.staffInput,attendance:f.attendance});assert.equal(closed.saved,true);assert.equal(+f.h.get('attendance_logs/'+closed.id).timestamp,+at('18:40'));assert.equal(f.h.get('staff_requests/'+request.id).status,'Not Required');
});

test('dismissal before the finish, a replacement request, or revoked saved Manager grant cannot change records',async()=>{
 const early=fixture(),request=await early.request(),pending=structuredClone(early.h.get('staff_requests/'+request.id)),before=records(early.h);
 await assert.rejects(early.review.dismiss({requestId:request.id}),/still needs an attendance decision/);assert.deepEqual(records(early.h),before);
 early.h.put('staff_requests/'+request.id,{...pending,requestVersion:pending.requestVersion+1,requestToken:'replacement-request-token'});early.setClock('18:40');const changed=records(early.h);
 for(const operation of ['inspect','dismiss'])await assert.rejects(early.review[operation]({requestId:request.id,expectedRequestVersion:pending.requestVersion,expectedRequestToken:pending.requestToken}),/changed after you opened/);
 assert.deepEqual(records(early.h),changed);
 const revoked=fixture(),second=await revoked.request();revoked.setClock('18:40');revoked.h.put('hq_email_access/'+email,{active:false,permissions:['inbox'],allowedBranches:[branch]});const locked=records(revoked.h);
 for(const operation of ['inspect','dismiss'])await assert.rejects(revoked.review[operation]({requestId:second.id}),/not granted/);assert.deepEqual(records(revoked.h),locked);
});

test('grant revocation after preview and before the dismissal transaction is rechecked',async()=>{
 const f=fixture(),request=await f.request();f.setClock('18:40');assert.equal((await f.review.inspect({requestId:request.id})).complete,true);
 const run=f.h.api.runTransaction;f.h.api.runTransaction=(...args)=>{f.h.put('hq_email_access/'+email,{active:false,permissions:['inbox'],allowedBranches:[branch]});return run(...args);};
 await assert.rejects(f.review.dismiss({requestId:request.id}),/not granted/);assert.equal(f.h.get('staff_requests/'+request.id).status,'Pending');assert.equal(attendance(f.h).length,1);
});
