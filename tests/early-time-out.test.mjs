import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createEarlyTimeOutService} from '../Takodeal-POS/early-time-out-actions.js';
import {assessEarlyTimeOut} from '../Takodeal-POS/early-time-out-model.js';
import {createScheduleRevision} from '../Takodeal-POS/schedule-history.js';
const name='Sample Crew',branch='Sample Branch',staffId='sample-staff',iso=time=>'2030-01-10T'+time+':00+08:00';
function fixture({startAt=iso('09:00'),endAt=iso('17:00'),nowAt=iso('15:00'),student=false,snapshot=true}={}){
    const h=firestoreHarness();let clock=new Date(nowAt),tokens=0;
    const start={id:'sample-time-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:new Date(startAt)};
    if(snapshot)start.scheduleSnapshot={version:1,source:'clock-in',branch,staffName:name,clockInAt:new Date(startAt).toISOString(),expectedStartAt:new Date(startAt).toISOString(),expectedEndAt:new Date(endAt).toISOString(),shiftId:'sample-slot',wasScheduled:true,needsScheduleReview:false,scheduleRevisionId:'sample-original'};
    h.put('attendance_logs/'+start.id,start);h.put('cashiers/'+staffId,{cashierName:name,branch,pin:'7281',active:true,isWorkingStudent:student});h.put('payroll_records/paid',{status:'Paid',frozenData:{paidHours:40,amount:2000}});
    h.api.serverTimestamp=()=>clock.toISOString();h.api.auth={currentUser:{uid:'sample-manager',email:'manager@example.test'}};h.api.sessionUser={uid:'sample-manager',email:'manager@example.test'};
    const service=createEarlyTimeOutService(h.api,{now:()=>new Date(clock),makeToken:()=>`sample-token-${++tokens}`}),input={start,staffId,staffName:name,pin:'7281',assertCurrent(){}};
    const attendance={staffId,staffName:name,branch,type:'TIME OUT',timestamp:new Date(clock),sourceApp:'staff'};
    return {h,service,input,start,attendance,setClock:value=>clock=new Date(value),get clock(){return clock;},async request(){return service.request({...input,reason:'Need to leave for a family appointment'});},async approve(requestId,extra={}){return service.review({requestId,decision:'Approved',reviewer:{uid:'sample-manager',email:'manager@example.test'},assertReviewAccess:b=>{assert.equal(b,branch);return true;},...extra});}};
}
test('early Time Out uses saved end including overnight and shorter student schedules, never a fixed eight hours',async()=>{
    const day=fixture(),ctx=await day.service.inspect(day.input);assert.equal(ctx.early,true);assert.equal(ctx.minutesEarly,120);
    const short=fixture({endAt:iso('12:00'),nowAt:iso('12:00'),student:true});assert.equal((await short.service.inspect(short.input)).complete,true);const saved=await short.service.close({...short.input,attendance:short.attendance});assert.equal(saved.saved,true);
    const night=fixture({startAt:iso('22:00'),endAt:'2030-01-11T06:00:00+08:00',nowAt:'2030-01-11T05:30:00+08:00'});assert.equal((await night.service.inspect(night.input)).minutesEarly,30);
});
test('pending request is reused across devices and cannot authorize Time Out by changing staff request status alone',async()=>{
    const f=fixture(),first=await f.request(),second=await f.request();assert.equal(first.id,second.id);assert.equal(second.alreadySaved,true);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('staff_requests/')).length,1);
    const row=f.h.get('staff_requests/'+first.id);f.h.put('staff_requests/'+first.id,{...row,status:'Approved'});await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/Management approval/);assert.equal([...f.h.docs.keys()].filter(path=>path.includes('/time-out-')).length,0);
});
test('protected approval closes once atomically, keeps actual final timestamp and preserves original/paid records',async()=>{
    const f=fixture(),original=structuredClone(f.h.get('attendance_logs/'+f.start.id)),paid=structuredClone(f.h.get('payroll_records/paid')),request=await f.request();await f.approve(request.id);f.setClock(iso('15:10'));
    const otherDevice=createEarlyTimeOutService(f.h.api,{now:()=>new Date(f.clock)}),raw=structuredClone(f.attendance),results=await Promise.all([f.service.close({...f.input,attendance:f.attendance}),otherDevice.close({...f.input,attendance:{...f.attendance,sourceApp:'cashier'}})]);
    assert.equal(results.filter(row=>row.saved).length,1);assert.equal(results.filter(row=>row.alreadySaved).length,1);const out=f.h.get('attendance_logs/'+results[0].id);assert.equal(+out.timestamp,+new Date(iso('15:10')));assert.equal(out.earlyTimeOut.requestId,request.id);assert.equal(f.h.get('staff_requests/'+request.id).status,'Consumed');assert.deepEqual(f.attendance,raw);assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),original);assert.deepEqual(f.h.get('payroll_records/paid'),paid);
});
test('approval expires after thirty minutes and cannot cross shifts, branches, versions or tokens',async()=>{
    for(const change of ['expired','branch','version','token','schedule']){const f=fixture(),request=await f.request();await f.approve(request.id);const path='attendance_time_out_approvals/'+request.id,row=f.h.get(path);if(change==='expired')f.setClock(iso('15:31'));else f.h.put(path,{...row,...(change==='branch'?{branch:'Other Branch'}:change==='version'?{requestVersion:99}:change==='token'?{requestToken:'other'}:{scheduleFingerprint:'other-rule'})});await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/Management approval/);}
});

test('approval leaves a server-clock margin, while larger clock skew cannot authorize closure',async()=>{
    const serverAt=new Date(iso('15:00'));
    const f=fixture({nowAt:'2030-01-10T15:00:02+08:00'});f.h.api.serverTimestamp=()=>new Date(serverAt);const request=await f.request();await f.approve(request.id);const approval=f.h.get('attendance_time_out_approvals/'+request.id);
    assert.equal(+approval.validUntil-+f.clock,29*60000);assert.equal(+approval.validUntil-+serverAt,29*60000+2000);assert.ok(+approval.validUntil<=+serverAt+30*60000);assert.equal((await f.service.inspect(f.input)).approved,true);assert.equal((await f.service.close({...f.input,attendance:f.attendance})).saved,true);
    const skewed=fixture({nowAt:iso('15:02')});skewed.h.api.serverTimestamp=()=>new Date(serverAt);const skewRequest=await skewed.request();await skewed.approve(skewRequest.id);assert.equal((await skewed.service.inspect(skewed.input)).approved,false);await assert.rejects(skewed.service.close({...skewed.input,attendance:skewed.attendance}),/Management approval/);assert.equal([...skewed.h.docs.keys()].filter(path=>path.includes('/time-out-')).length,0);
});
test('cancellation and re-request cannot reuse the earlier protected approval',async()=>{
    const f=fixture(),first=await f.request();await f.approve(first.id);await f.service.cancel(f.input);const next=await f.request();assert.equal(next.id,first.id);assert.equal(f.h.get('staff_requests/'+next.id).requestVersion,2);await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/Management approval/);await f.approve(next.id);assert.equal((await f.service.close({...f.input,attendance:f.attendance})).saved,true);
});

test('management cannot decide a replacement request from an older open preview',async()=>{
    const f=fixture(),first=await f.request(),preview=structuredClone(f.h.get('staff_requests/'+first.id));await f.service.cancel(f.input);await f.service.request({...f.input,reason:'A different reason needing a new management review'});const pending=structuredClone(f.h.get('staff_requests/'+first.id));assert.equal(pending.requestVersion,preview.requestVersion+1);assert.notEqual(pending.requestToken,preview.requestToken);
    for(const decision of ['Approved','Rejected'])await assert.rejects(f.approve(first.id,{decision,expectedRequestVersion:preview.requestVersion,expectedRequestToken:preview.requestToken}),/changed after you opened/);
    await assert.rejects(f.approve(first.id,{expectedRequestVersion:pending.requestVersion,expectedRequestToken:preview.requestToken}),/changed after you opened/);assert.equal(f.h.get('attendance_time_out_approvals/'+first.id),undefined);assert.deepEqual(f.h.get('staff_requests/'+first.id),pending);
    await f.approve(first.id,{expectedRequestVersion:pending.requestVersion,expectedRequestToken:pending.requestToken});assert.equal(f.h.get('attendance_time_out_approvals/'+first.id).requestToken,pending.requestToken);
});
test('a pending request does not block normal Time Out at the saved end, and waiting is recorded only at actual final close',async()=>{
    const f=fixture(),request=await f.request();f.setClock(iso('17:00'));const result=await f.service.close({...f.input,attendance:f.attendance}),out=f.h.get('attendance_logs/'+result.id);assert.equal(+out.timestamp,+new Date(iso('17:00')));assert.equal(out.earlyTimeOut,undefined);assert.equal(f.h.get('staff_requests/'+request.id).status,'Completed Normally');
});
test('unknown schedules request review, cannot be approved automatically and never fabricate worked hours',async()=>{
    const f=fixture({snapshot:false}),ctx=await f.service.inspect(f.input);assert.equal(ctx.unknown,true);const request=await f.request();assert.equal(f.h.get('staff_requests/'+request.id).requiresScheduleReview,true);await assert.rejects(f.approve(request.id),/schedule changed or cannot be verified/);await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/could not be verified/);assert.equal(f.h.get('attendance_logs/'+f.start.id).timestamp.getTime(),f.start.timestamp.getTime());
});
test('source and staff identity, own PIN, reviewer identity and device clock are checked before writes',async()=>{
    const f=fixture();await assert.rejects(f.service.request({...f.input,pin:'wrong',reason:'Leaving early'}),/own staff/);await assert.rejects(f.service.inspect({...f.input,staffId:'different'}),/Time In changed/);await assert.rejects(f.service.inspect({...f.input,assertCurrent(){throw Error('session changed');}}),/session changed/);f.setClock(iso('08:59'));await assert.rejects(f.service.inspect(f.input),/device clock/);
    const g=fixture(),request=await g.request();await assert.rejects(g.approve(request.id,{reviewer:{uid:'other',email:'other@example.test'}}),/reviewer changed/);
});
test('transaction failures and lost acknowledgements cannot create duplicate closure or consume without a Time Out',async()=>{
    const f=fixture(),request=await f.request();await f.approve(request.id);f.h.failNextCommit();await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/rejected/);assert.equal(f.h.get('staff_requests/'+request.id).status,'Approved');f.h.loseNextAck();await assert.rejects(f.service.close({...f.input,attendance:f.attendance}),/lost after commit/);assert.equal((await f.service.close({...f.input,attendance:f.attendance})).alreadySaved,true);assert.equal([...f.h.docs.keys()].filter(path=>path.includes('/time-out-')).length,1);
});
test('assessment refuses invalid or negative-time evidence without changing raw punch data',()=>{
    const start={id:'sample',type:'TIME IN',branch,timestamp:new Date(iso('09:00'))},raw=structuredClone(start);assert.throws(()=>assessEarlyTimeOut(start,null,new Date(iso('08:00'))),/device clock/);assert.equal(assessEarlyTimeOut(start,{expectedStartAt:iso('09:00'),expectedEndAt:iso('12:00'),wasScheduled:true},new Date(iso('12:00'))).complete,true);assert.deepEqual(start,raw);
});
test('a manual lateness review does not block a normal clock-out with a separately verified corrected end',()=>{
    const start={id:'sample',type:'TIME IN',branch,timestamp:new Date(iso('09:00'))},shift={expectedStartAt:iso('09:00'),expectedEndAt:iso('17:00'),wasScheduled:true,attendanceCorrectionVerified:true,needsScheduleReview:true,amendmentNeedsReview:true,lateMinutes:33};const raw=structuredClone(shift);assert.equal(assessEarlyTimeOut(start,shift,new Date(iso('17:00'))).complete,true);assert.deepEqual(shift,raw);assert.equal(assessEarlyTimeOut(start,{...shift,attendanceCorrectionVerified:false},new Date(iso('17:00'))).unknown,true);
});
test('Cashier and Staff use the shared approval path without fixed eight-hour or whole-shift forfeiture rules',()=>{
    for(const app of ['Takodeal-POS/main.js','Takodeal-Staff/app.js']){const text=readFileSync(new URL('../'+app,import.meta.url),'utf8');assert.match(text,/await prepareEarlyTimeOut\(window/);assert.match(text,/earlyClockOut\.service\.close\(/);}const pos=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');assert.doesNotMatch(pos,/hoursSinceLastLog < 8/);const ui=readFileSync(new URL('../Takodeal-POS/early-time-out-ui.js',import.meta.url),'utf8');assert.match(ui,/This request does not end your shift/);assert.match(ui,/worked hours remain saved/);assert.doesNotMatch(ui,/forfeit|unpaid whole shift/i);
});
test('management can reject unknown or changed schedules using the original pending descriptor',async()=>{
    for(const unknown of [true,false]){const f=fixture({snapshot:!unknown}),request=await f.request(),before=structuredClone(f.h.get('staff_requests/'+request.id));if(!unknown){const source=f.h.get('attendance_logs/'+f.start.id);f.h.put('attendance_logs/'+f.start.id,{...source,scheduleSnapshot:{...source.scheduleSnapshot,expectedEndAt:new Date(iso('18:00')).toISOString()}});}
        await f.service.review({requestId:request.id,decision:'Rejected',reviewer:{uid:'sample-manager',email:'manager@example.test'},assertReviewAccess:()=>true,reviewNote:'Please confirm the schedule with management'});const token=f.h.get('attendance_time_out_approvals/'+request.id);assert.equal(token.decision,'Rejected');assert.equal(token.validUntil,null);assert.equal(token.scheduleFingerprint,before.scheduleFingerprint);assert.equal(token.scheduledEndAt,before.scheduledEndAt);}
});
test('malformed request versions and tokens cannot receive protected approval',async()=>{
    for(const change of [{requestVersion:0},{requestVersion:1.5},{requestToken:''},{requestToken:'x'.repeat(121)}]){const f=fixture(),request=await f.request();f.h.put('staff_requests/'+request.id,{...f.h.get('staff_requests/'+request.id),...change});await assert.rejects(f.approve(request.id),/version review/);assert.equal(f.h.get('attendance_time_out_approvals/'+request.id),undefined);}
});
test('a timed-out request retains one physical transaction; late acknowledgement is safely reused',async()=>{
    const f=fixture(),original=f.h.api.runTransaction;let release,calls=0;const gate=new Promise(resolve=>release=resolve);f.h.api.runTransaction=async(...args)=>{calls++;await gate;return original(...args);};const service=createEarlyTimeOutService(f.h.api,{now:()=>new Date(f.clock),makeToken:()=> 'sample-stable-token',timeoutMs:5});
    const input={...f.input,reason:'Family appointment'};await assert.rejects(service.request(input),/not confirmed/);await assert.rejects(service.request(input),/not confirmed/);assert.equal(calls,1);release();await new Promise(resolve=>setImmediate(resolve));const result=await service.request(input);assert.equal(result.alreadySaved,true);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('staff_requests/')).length,1);assert.equal([...f.h.docs.keys()].filter(path=>path.includes('/time-out-')).length,0);
});
test('a saved dated shift amendment supplies the corrected end without rewriting the punch snapshot',async()=>{
    const f=fixture({nowAt:iso('17:05')}),plan=end=>({currentYear:2030,currentMonth:1,branchConfig:{[branch]:[{id:'sample-slot',name:'Saved shift',shiftType:'day',startTime:'09:00',endTime:end,active:true}]},currentSchedule:{10:{[branch]:{scheduled:{'sample-slot':name}}}}});
    const before=createScheduleRevision(plan('17:00'),{revisionId:'before',effectiveFrom:'2030-01-01',savedAt:new Date('2030-01-01T00:00:00+08:00'),cutover:'2030-01-01'}),after=createScheduleRevision(plan('18:00'),{revisionId:'canonical',effectiveFrom:'2030-01-10',savedAt:new Date(iso('12:00')),cutover:'2030-01-01'});
    const event={id:'sample_correction',branch,effectiveFrom:'2030-01-10',effectiveTo:'2030-01-31',sourceRevisionId:'before',sourceRevisionIds:['before'],sourceDates:{'2030-01-10':'before'},canonicalRevisionId:'canonical',sequence:1,recordedAt:new Date(iso('12:00')).toISOString(),actor:{uid:'sample-owner'},reason:'Correct saved shift end',changes:[{shiftId:'sample-slot',beforeStart:'09:00',beforeEnd:'17:00',startTime:'09:00',endTime:'18:00'}]};
    f.h.put('settings/global_schedule',{...after.snapshot,scheduleRevisionId:'canonical',payrollHistoryEnforcedFrom:'2030-01-01'});f.h.put('settings/schedule_month_2030_01',{month:'2030-01',revisionIds:['before','canonical'],latestRevisionId:'canonical',shiftAmendments:[event]});f.h.put('settings/schedule_revision_before',before);f.h.put('settings/schedule_revision_canonical',after);f.h.put('settings/schedule_shift_amendments_2030_01',{month:'2030-01',shiftAmendments:[event]});const original=structuredClone(f.h.get('attendance_logs/'+f.start.id));
    const ctx=await f.service.inspect(f.input);assert.equal(ctx.early,true);assert.equal(ctx.minutesEarly,55);assert.equal(ctx.scheduledEndAt,new Date(iso('18:00')).toISOString());assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),original);
});
