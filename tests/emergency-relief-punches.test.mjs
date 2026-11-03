import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createEarlyTimeOutService} from '../Takodeal-POS/early-time-out-actions.js';
import {prepareEarlyTimeOut} from '../Takodeal-POS/early-time-out-ui.js';
import {emergencyReliefMarker,validEmergencyReliefMarker,isEmergencyReliefRequest} from '../Takodeal-POS/relief-attendance-model.js';
import {createScheduleRevision} from '../Takodeal-POS/schedule-history.js';

const staffId='fictional-relief-staff',name='Fictional Relief Crew',home='Fictional Home Branch',branch='Fictional Cover Branch';
const at=value=>new Date('2032-04-30T'+value+':00+08:00');
const marker={version:1,homeBranch:home,branch,requiresReview:true};
function fixture({verified=false,startMarker=false,profileHome=home,clock=at('21:20')}={}){
 const h=firestoreHarness();let now=new Date(clock),tokens=0;
 const start={id:'fictional-relief-time-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:at('13:50'),scheduleSnapshot:{version:1,source:'clock-in',branch,staffName:name,clockInAt:at('13:50').toISOString(),expectedStartAt:at('14:00').toISOString(),expectedEndAt:at('21:00').toISOString(),shiftId:'fictional-part-time',shiftName:'Part Time',wasScheduled:verified,needsScheduleReview:!verified,scheduleReviewReason:verified?'':'missing-dated-assignment',scheduleRevisionId:'fictional-schedule'}};
 if(startMarker)start.emergencyRelief=structuredClone(marker);
 const profile={cashierName:name,branch:profileHome,pin:'fictional-pin',active:true};
 h.put('attendance_logs/'+start.id,start);h.put('cashiers/'+staffId,profile);h.put('payroll_records/fictional-paid',{status:'Paid',frozenData:{amount:2000,paidHours:40}});
 h.api.serverTimestamp=()=>new Date(now);h.api.auth={currentUser:{uid:'fictional-owner',email:'owner@example.test'}};h.api.sessionUser={uid:'fictional-owner',email:'owner@example.test'};
 const service=createEarlyTimeOutService(h.api,{now:()=>new Date(now),makeToken:()=>`fictional-relief-token-${++tokens}`}),input={start,staffId,staffName:name,pin:'fictional-pin',assertCurrent(){}};
 const attendance={staffId,staffName:name,branch,type:'TIME OUT',sourceApp:'staff',timestamp:at('01:00'),locationLat:0.1,locationLng:0.2,distanceMeters:10};
 return {h,start,profile,service,input,attendance,close:extra=>service.close({...input,attendance,reliefForReview:true,...extra}),setClock:value=>now=new Date(value),get now(){return now;}};
}
const outs=h=>[...h.docs].filter(([path])=>/^attendance_logs\/time-out-/.test(path));
const requests=h=>[...h.docs].filter(([path])=>path.startsWith('staff_requests/'));
function savedSchedule(f,assigned){
 const snapshot={currentYear:2032,currentMonth:4,branchConfig:{[branch]:[{id:'fictional-part-time',name:'Fictional Part Time',shiftType:'other',startTime:'14:00',endTime:'21:00',active:true}]},currentSchedule:{30:{[branch]:{scheduled:{'fictional-part-time':assigned?name:'Other Fictional Staff'},rest:assigned?[]:[name],unavailable:[],swaps:{}}}},employees:[{id:staffId,name,cashierName:name,branch:home}],unavailability:{}};
 const revision=createScheduleRevision(snapshot,{revisionId:'fictional-schedule',effectiveFrom:'2032-04-01',savedAt:new Date('2032-04-01T00:00:00+08:00'),cutover:'2032-04-01'});
 f.h.put('settings/global_schedule',{...revision.snapshot,scheduleRevisionId:revision.revisionId,payrollHistoryEnforcedFrom:'2032-04-01'});f.h.put('settings/schedule_month_2032_04',{month:'2032-04',revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId});f.h.put('settings/schedule_revision_'+revision.revisionId,revision);
}

test('cross-branch markers describe actual placement without asserting schedule or pay authority',()=>{
 assert.deepEqual(emergencyReliefMarker({branch},{branch:home}),marker);
 assert.equal(emergencyReliefMarker({branch},{branch}),null);
 assert.equal(emergencyReliefMarker({branch},{branch:'Unknown'}),null);
 assert.equal(emergencyReliefMarker({branch:'All'},{branch:home}),null);
 assert.equal(validEmergencyReliefMarker({...marker,expectedEndAt:at('21:00')},branch),null);
 assert.equal(validEmergencyReliefMarker({...marker,branch:home},branch),null);
 assert.deepEqual(emergencyReliefMarker({branch,emergencyRelief:marker},{branch}),marker);
});

test('unverified emergency cover records the actual linked Time Out and Pending HR review atomically',async()=>{
 const f=fixture(),before=structuredClone(f.h.get('attendance_logs/'+f.start.id)),paid=structuredClone(f.h.get('payroll_records/fictional-paid'));
 const preview=await f.service.inspect(f.input);assert.equal(preview.unknown,true);assert.equal(preview.provisionalRelief,true);assert.deepEqual(preview.emergencyRelief,marker);
 const raw=structuredClone(f.attendance),saved=await f.close(),out=f.h.get('attendance_logs/'+saved.id),list=requests(f.h);
 assert.equal(saved.saved,true);assert.equal(saved.provisionalRelief,true);assert.equal(list.length,1);const [requestPath,row]=list[0];
 assert.equal(out.type,'TIME OUT');assert.equal(out.timeInLogId,f.start.id);assert.equal(+out.timestamp,+f.now);assert.equal(out.branch,branch);assert.equal(out.locationLat,raw.locationLat);assert.deepEqual(out.emergencyRelief,marker);assert.equal(out.reliefRequestId,requestPath.split('/')[1]);assert.equal(out.earlyTimeOut,undefined);assert.equal(out.emergencyShiftConfirmation,undefined);
 assert.equal(row.status,'Pending');assert.equal(row.requiresScheduleReview,true);assert.equal(row.timeOutLogId,saved.id);assert.equal(row.actualTimeOutAt,f.now.toISOString());assert.equal(row.scheduledEndAt,null);assert.ok(isEmergencyReliefRequest(row));
 assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),before);assert.deepEqual(f.h.get('payroll_records/fictional-paid'),paid);assert.deepEqual(f.attendance,raw);assert.equal([...f.h.docs].filter(([path])=>path.startsWith('attendance_time_out_approvals/')).length,0);
});

test('explicit provisional confirmation is required; unrelated unverified home shifts still use normal review',async()=>{
 const cross=fixture();await assert.rejects(cross.close({reliefForReview:false}),/confirm Record Time Out/);assert.equal(outs(cross.h).length,0);assert.equal(requests(cross.h).length,0);
 const own=fixture({profileHome:branch});assert.equal((await own.service.inspect(own.input)).provisionalRelief,false);await assert.rejects(own.close(),/could not be verified/);assert.equal(outs(own.h).length,0);
});

test('a confirmed assigned relief shift retains its legitimate early-departure approval check',async()=>{
 const f=fixture({verified:true,clock:at('20:00')});const ctx=await f.service.inspect(f.input);assert.equal(ctx.unknown,false);assert.equal(ctx.early,true);assert.equal(ctx.provisionalRelief,false);
 await assert.rejects(f.close(),/Management approval/);assert.equal(outs(f.h).length,0);assert.equal(requests(f.h).length,0);
 f.setClock(at('21:00'));const result=await f.close();assert.equal(result.saved,true);assert.equal(result.provisionalRelief,undefined);assert.equal(requests(f.h).length,0);
});

test('a common captured finish can prove normal completion without losing its still-unconfirmed assigned-hours review',async()=>{
 const f=fixture();savedSchedule(f,false);const ctx=await f.service.inspect(f.input);assert.equal(ctx.complete,true);assert.equal(ctx.unknown,false);assert.equal(ctx.clockOutCompleteOnly,true);assert.equal(ctx.provisionalRelief,true);
 const saved=await f.close();assert.equal(saved.provisionalRelief,true);assert.equal(requests(f.h)[0][1].status,'Pending');assert.equal(requests(f.h)[0][1].requiresScheduleReview,true);assert.equal(outs(f.h).length,1);
});

test('dated clock-out recovery keeps the original unverified payroll assignment in HR review',async()=>{
 const f=fixture({clock:at('20:00')});savedSchedule(f,true);const ctx=await f.service.inspect(f.input);assert.equal(ctx.unknown,false);assert.equal(ctx.early,true);assert.equal(ctx.payrollScheduleNeedsReview,true);assert.equal(ctx.provisionalRelief,true);
 const saved=await f.close();assert.equal(saved.provisionalRelief,true);assert.equal(requests(f.h)[0][1].status,'Pending');assert.equal(outs(f.h)[0][1].earlyTimeOut,undefined);
});

test('a protected confirmed replacement shift cannot be bypassed as provisional emergency cover',async()=>{
 const f=fixture({clock:at('20:00')}),made=await f.service.request({...f.input,reason:'Fictional emergency cover needs confirmation'}),reviewer={uid:'fictional-owner',email:'owner@example.test'},preview=await f.service.inspectRequest({requestId:made.id,reviewer,assertReviewAccess:()=>true});
 await f.service.confirmShiftRequest({requestId:made.id,reviewer,assertReviewAccess:()=>true,operationId:'fictional-protected-cover-0001',expectedRequestVersion:preview.request.requestVersion,expectedRequestToken:preview.request.requestToken,expectedConfirmationVersion:preview.emergencyShiftVersion,expectedSourceFingerprint:preview.emergencyShiftSourceFingerprint,expectedScheduleFingerprint:preview.scheduleFingerprint,workDate:'2032-04-30',startTime:'14:00',endTime:'21:00',shiftName:'Fictional confirmed cover',reason:'Fictional branch manager confirmed these hours.'});
 const ctx=await f.service.inspect(f.input);assert.equal(ctx.unknown,false);assert.equal(ctx.early,true);assert.equal(ctx.provisionalRelief,false);await assert.rejects(f.close(),/Management approval/);assert.equal(outs(f.h).length,0);
});

test('initial nonauthoritative cover evidence survives a later home-branch transfer',async()=>{
 const f=fixture({startMarker:true,profileHome:branch});assert.equal((await f.service.inspect(f.input)).provisionalRelief,true);assert.equal((await f.close()).saved,true);assert.equal(requests(f.h)[0][1].emergencyRelief.homeBranch,home);
});

test('a matching Pending request retains the original version, token, explanation and submission date',async()=>{
 const f=fixture(),made=await f.service.request({...f.input,reason:'Fictional emergency replacement agreed with branch'}),path='staff_requests/'+made.id,original=structuredClone(f.h.get(path));
 f.h.put(path,{...original,managerReply:'Earlier management note'});const result=await f.close(),row=f.h.get(path);
 assert.equal(row.requestVersion,original.requestVersion);assert.equal(row.requestToken,original.requestToken);assert.equal(row.reason,original.reason);assert.deepEqual(row.timestamp,original.timestamp);assert.equal(row.requestedDepartureAt,original.requestedDepartureAt);assert.equal(row.managerReply,'Earlier management note');assert.equal(row.status,'Pending');assert.equal(row.timeOutLogId,result.id);assert.equal(row.emergencyReliefPriorRequest,undefined);
});

test('earlier request decisions remain in explicit prior evidence when a new provisional review is needed',async()=>{
 for(const status of ['Rejected','Cancelled','Approved','Not Required']){
  const f=fixture(),made=await f.service.request({...f.input,reason:'Original fictional explanation'}),path='staff_requests/'+made.id,row=f.h.get(path),prior={...row,status,managerReply:'Original fictional decision',processedAt:at('20:00').toISOString(),processedBy:'owner@example.test',timeOutReview:{verifiedFinishAt:null}};
  f.h.put(path,prior);f.h.put('attendance_time_out_approvals/'+made.id,{schemaVersion:1,decision:status,requestVersion:1,requestToken:prior.requestToken});const approval=structuredClone(f.h.get('attendance_time_out_approvals/'+made.id));
  await f.close();const saved=f.h.get(path);assert.equal(saved.status,'Pending');assert.equal(saved.requestVersion,prior.requestVersion+1);assert.notEqual(saved.requestToken,prior.requestToken);assert.equal(saved.reason,prior.reason);assert.equal(saved.emergencyReliefPriorRequest.status,status);assert.equal(saved.emergencyReliefPriorRequest.managerReply,prior.managerReply);assert.equal(saved.emergencyReliefPriorRequest.requestedDepartureAt,prior.requestedDepartureAt);assert.deepEqual(saved.emergencyReliefPriorRequest.timeOutReview,prior.timeOutReview);assert.deepEqual(f.h.get('attendance_time_out_approvals/'+made.id),approval);
 }
});

test('mismatched request source, revoked staff, wrong PIN, changed session and stale clock cannot write a provisional pair',async()=>{
 for(const failure of ['request','revoked','pin','session','clock']){
  const f=fixture();let extra={};if(failure==='request'){const made=await f.service.request({...f.input,reason:'Fictional pending review'}),p='staff_requests/'+made.id;f.h.put(p,{...f.h.get(p),timeInLogId:'different-source'});}if(failure==='revoked')f.h.put('cashiers/'+staffId,{...f.profile,active:false});if(failure==='pin')extra.pin='wrong';if(failure==='session')extra.assertCurrent=()=>{throw Error('session changed');};if(failure==='clock')f.setClock(at('13:49'));
  const before=structuredClone([...f.h.docs]);await assert.rejects(f.close(extra));assert.deepEqual([...f.h.docs],before);assert.equal(outs(f.h).length,0);
 }
 const old=fixture();old.setClock(new Date(+old.start.timestamp+25*3600000));await assert.rejects(old.close(),/too old/);assert.equal(outs(old.h).length,0);
});

test('failed commits and lost acknowledgements retain one actual Time Out and one review',async()=>{
 const f=fixture();f.h.failNextCommit();await assert.rejects(f.close(),/rejected/);assert.equal(outs(f.h).length,0);assert.equal(requests(f.h).length,0);
 f.h.loseNextAck();await assert.rejects(f.close(),/lost after commit/);const prior=structuredClone(requests(f.h)[0][1]);f.setClock(at('21:35'));const retry=await f.close();assert.equal(retry.alreadySaved,true);assert.equal(retry.provisionalRelief,true);assert.equal(outs(f.h).length,1);assert.equal(requests(f.h).length,1);assert.deepEqual(requests(f.h)[0][1],prior);assert.equal(+outs(f.h)[0][1].timestamp,+at('21:20'));
});

test('concurrent devices cannot duplicate provisional punches, pending reviews or request versions',async()=>{
 const f=fixture(),other=createEarlyTimeOutService(f.h.api,{now:()=>new Date(f.now),makeToken:()=> 'fictional-second-device-token'}),results=await Promise.all([f.close(),other.close({...f.input,attendance:{...f.attendance,sourceApp:'cashier'},reliefForReview:true})]);
 assert.equal(results.filter(r=>r.saved).length,1);assert.equal(results.filter(r=>r.alreadySaved).length,1);assert.equal(outs(f.h).length,1);assert.equal(requests(f.h).length,1);assert.equal(requests(f.h)[0][1].requestVersion,1);
});

test('after actual departure the pending assigned-hours review cannot be cancelled or dismissed as normal',async()=>{
 const f=fixture();await f.close();const [path,row]=requests(f.h)[0],requestId=path.split('/')[1],before=structuredClone(row);
 await assert.rejects(f.service.cancel(f.input),/cannot be cancelled/);
 await assert.rejects(f.service.dismissRequest({requestId,reviewer:{uid:'fictional-owner',email:'owner@example.test'},assertReviewAccess:()=>true}),/HR Review/);
 assert.deepEqual(f.h.get(path),before);assert.equal((await f.service.inspectRequest({requestId,reviewer:{uid:'fictional-owner',email:'owner@example.test'},assertReviewAccess:()=>true})).provisionalRelief,true);
});

test('relief UI records only explicit confirmed choice and never treats it as a schedule approval',async()=>{
 for(const confirmed of [true,false]){const calls=[],service={inspect:async()=>({unknown:true,provisionalRelief:true,emergencyRelief:marker,branch})},api={Swal:{fire:async input=>{calls.push(input);return {isConfirmed:confirmed};}}},result=await prepareEarlyTimeOut(api,{start:{branch},staffName:name},{service});
  assert.equal(result.proceed,confirmed);assert.equal(result.reliefForReview,confirmed);assert.equal(result.service,service);assert.equal(calls.length,1);assert.equal(calls[0].confirmButtonText,'Record Time Out for HR review');assert.match(calls[0].html,/assigned hours still need Owner confirmation/);assert.doesNotMatch(calls[0].html,/Request approval before leaving/);
 }
});

test('service rechecks current evidence at close: a newly verified early shift cannot reuse a provisional UI choice',async()=>{
 const f=fixture({clock:at('20:00')}),ctx=await f.service.inspect(f.input);assert.equal(ctx.provisionalRelief,true);f.h.put('attendance_logs/'+f.start.id,{...f.start,scheduleSnapshot:{...f.start.scheduleSnapshot,wasScheduled:true,needsScheduleReview:false}});
 await assert.rejects(f.close(),/Management approval/);assert.equal(outs(f.h).length,0);assert.equal(requests(f.h).length,0);
});

test('all three clock consumers use byte-identical emergency relief actions and UI',()=>{
 for(const file of ['early-time-out-actions.js','early-time-out-ui.js'])for(const app of ['takodeal-manager','takodeal-staff'])assert.equal(readFileSync(new URL('../'+app+'/'+file,import.meta.url),'utf8'),readFileSync(new URL('../Takodeal-POS/'+file,import.meta.url),'utf8'));
 for(const app of ['takodeal-manager','takodeal-staff','takodeal-franchise'])assert.equal(readFileSync(new URL('../'+app+'/relief-attendance-model.js',import.meta.url),'utf8'),readFileSync(new URL('../Takodeal-POS/relief-attendance-model.js',import.meta.url),'utf8'));
});
