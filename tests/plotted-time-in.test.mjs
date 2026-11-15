import test from 'node:test';import assert from 'node:assert/strict';
import {createPlottedTimeInBatch} from '../Takodeal-POS/plotted-time-in.js';
import {captureAttendanceSchedule,resolveAttendanceShift,calculateShiftEarnings} from '../Takodeal-POS/payroll-safety.js';
import {createScheduleHistoryStore,createScheduleRevision} from '../Takodeal-POS/schedule-history.js';
import {assertAttendanceScheduleUnchanged} from '../Takodeal-POS/attendance-schedule-preview.js';
import {resolveClockOutShift} from '../Takodeal-POS/clock-out-schedule.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const branch='Newly Opened Branch',name='Fictional Crew',staffId='fictional-crew';
const rules=[['morning1','Morning 1','08:00','16:30'],['morning2','Morning 2','10:00','18:30'],['mid','Mid','12:00','20:30'],['night1','Night 1','16:00','00:30'],['night2','Night 2','19:00','03:30']].map(([id,name,startTime,endTime])=>({id,name,startTime,endTime,active:true,days:[0,1,2,3,4,5,6]}));
async function fixture({slot='morning1',workDate='2026-11-16',at,kind='cashier'}={}){
 const h=firestoreHarness(),profile={id:staffId,staffId,cashierName:name,branch:'Different Home Branch',dailyRate:400,eligibleNightDiff:false},rule=rules.find(row=>row.id===slot),clock=new Date(at||workDate+'T'+rule.startTime+':00+08:00');
 const plan={currentYear:Number(workDate.slice(0,4)),currentMonth:Number(workDate.slice(5,7)),branchConfig:{[branch]:structuredClone(rules)},employees:[{staffId,name,branch:profile.branch}],currentSchedule:{[Number(workDate.slice(-2))]:{[branch]:{scheduled:{[slot]:name},rest:[],unavailable:[]}}}};
 const suffix=workDate.slice(0,7).replace('-','_');let sequence=0;
 function publish(value,id){sequence++;const revision=createScheduleRevision(value,{revisionId:id,effectiveFrom:workDate,savedAt:new Date(Date.parse(workDate+'T00:00:00Z')+sequence*1000),actor:'fictional-owner'});h.put('settings/schedule_revision_'+id,revision);const old=h.get('settings/schedule_month_'+suffix);h.put('settings/schedule_month_'+suffix,{month:workDate.slice(0,7),revisionIds:[...(old?.revisionIds||[]),id],latestRevisionId:id});h.put('settings/global_schedule',{...structuredClone(value),scheduleRevisionId:id});return revision;}
 publish(plan,'revision-one');h.api.getDocFromServer=async ref=>({exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 const history=await createScheduleHistoryStore(h.api).loadRange(new Date(+clock-86400000),new Date(+clock+86400000)),snapshot=captureAttendanceSchedule(clock,branch,name,history,{[name]:profile});
 assert.equal(snapshot.wasScheduled,true,JSON.stringify(snapshot));
 const attendance={type:'TIME IN',staffId,staffName:name,branch,timestamp:clock,sourceApp:kind,photoBase64:'fictional-photo',scheduleSnapshot:snapshot},ref=h.ref('attendance_logs','attempt-one');
 let valid=true;const batch=()=>createPlottedTimeInBatch(h.api,{attendanceRef:ref,attendance,profile,now:()=>+clock,assertCurrent(){if(!valid)throw Error('Changed staff or branch');}});
 return {h,profile,plan,history,attendance,ref,clock,batch,publish,invalidate(){valid=false;}};
}
for(const rule of rules)test(rule.name+' preserves its exact plotted slot and work date at a newly opened branch, independently of home branch',async()=>{
 const f=await fixture({slot:rule.id});await f.batch().set(f.ref,f.attendance).commit();const saved=f.h.get(f.ref.path);assert.equal(saved.scheduleSnapshot.shiftId,rule.id);assert.equal(saved.scheduleSnapshot.shiftName,rule.name);assert.equal(saved.branch,branch);assert.equal(saved.scheduleSnapshot.expectedStartAt,new Date('2026-11-16T'+rule.startTime+':00+08:00').toISOString());assert.equal(saved.scheduleSnapshot.wasScheduled,true);
 const resolved=resolveAttendanceShift({...saved,id:f.ref.id},f.history,{[name]:f.profile}),finish=new Date(saved.scheduleSnapshot.expectedEndAt),pay=calculateShiftEarnings(f.profile,resolved,f.clock,finish);assert.equal(pay.basicPay,400);assert.equal(pay.shiftMultiplier,1);assert.equal(pay.salaryReviewRequired,false);assert.equal(resolveClockOutShift(saved,f.history,{[name]:f.profile}).shiftId,rule.id);
});
test('an unrelated roster edit can advance the revision while preserving this employee’s exact assigned hours',async()=>{
 const f=await fixture();const next=structuredClone(f.plan);next.currentSchedule[17]={[branch]:{scheduled:{morning2:'Another Crew'}}};f.publish(next,'revision-two');await f.batch().set(f.ref,f.attendance).commit();const saved=f.h.get(f.ref.path);assert.equal(saved.scheduleSnapshot.scheduleRevisionId,'revision-two');assert.equal(saved.scheduleSnapshot.expectedStartAt,f.attendance.scheduleSnapshot.expectedStartAt);assert.equal(saved.scheduleSnapshot.shiftId,'morning1');
});
for(const change of ['time','assignment','branch'])test('a concurrent '+change+' change retries the actual transaction and never saves a stale plotted punch',async()=>{
 const f=await fixture(),run=f.h.api.runTransaction;let changed=false;
 f.h.api.runTransaction=(db,work)=>run(db,tx=>work({...tx,get:async ref=>{const snap=await tx.get(ref);if(!changed&&ref.path==='settings/global_schedule'){changed=true;const next=structuredClone(f.plan);if(change==='time')next.branchConfig[branch][0].startTime='08:30';if(change==='assignment')next.currentSchedule[16][branch].scheduled.morning1='Different Crew';if(change==='branch'){next.currentSchedule[16]['Other Branch']=next.currentSchedule[16][branch];delete next.currentSchedule[16][branch];}f.publish(next,'revision-two');}return snap;}}));
 await assert.rejects(f.batch().set(f.ref,f.attendance).commit(),/No Time In was saved/);assert.equal(f.h.get(f.ref.path),undefined);assert.ok(f.h.retries()>0);
});
test('a concurrent unrelated change retries successfully with the latest revision and one attendance record',async()=>{
 const f=await fixture(),run=f.h.api.runTransaction;let changed=false;f.h.api.runTransaction=(db,work)=>run(db,tx=>work({...tx,get:async ref=>{const snap=await tx.get(ref);if(!changed&&ref.path==='settings/global_schedule'){changed=true;const next=structuredClone(f.plan);next.holidays={'2026-11-25':'Special'};f.publish(next,'revision-two');}return snap;}}));await f.batch().set(f.ref,f.attendance).commit();assert.ok(f.h.retries()>0);assert.equal(f.h.get(f.ref.path).scheduleSnapshot.scheduleRevisionId,'revision-two');assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,1);
});
test('lost save acknowledgement can retry the exact attendance ID after a later schedule edit without duplicating the punch',async()=>{
 const f=await fixture();f.h.loseNextAck();const batch=f.batch().set(f.ref,f.attendance);await assert.rejects(batch.commit(),/Connection lost after commit/);const next=structuredClone(f.plan);next.branchConfig[branch][0].endTime='17:30';f.publish(next,'revision-two');assert.equal((await batch.commit()).alreadySaved,true);assert.equal(f.h.get(f.ref.path).scheduleSnapshot.scheduleRevisionId,'revision-one');assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('attendance_logs/')).length,1);
});
test('a stored Time In and its Time Out preserve the original overnight work date across a month change',async()=>{
 const f=await fixture({slot:'night2',workDate:'2026-11-30',at:'2026-12-01T00:05:00+08:00'});await f.batch().set(f.ref,f.attendance).commit();const saved=f.h.get(f.ref.path),next=structuredClone(f.plan);next.branchConfig[branch][4].endTime='04:30';f.publish(next,'revision-two');const history=await createScheduleHistoryStore(f.h.api).loadRange(new Date(+f.clock-86400000),new Date(+f.clock+86400000)),out=resolveClockOutShift(saved,history,{[name]:f.profile});assert.equal(out.expectedStartAt.toISOString(),'2026-11-30T11:00:00.000Z');assert.equal(out.expectedEndAt.toISOString(),'2026-11-30T19:30:00.000Z');
});
test('a staff or branch change during saving cannot write attendance or its linked explanation',async()=>{
 const f=await fixture({kind:'staff'}),run=f.h.api.runTransaction;f.h.api.runTransaction=(db,work)=>run(db,tx=>work({...tx,get:async ref=>{const snap=await tx.get(ref);f.invalidate();return snap;}}));await assert.rejects(f.batch().set(f.h.ref('staff_requests','late-one'),{type:'Reason Letter'}).set(f.ref,f.attendance).commit(),/Changed staff or branch/);assert.equal(f.h.get(f.ref.path),undefined);assert.equal(f.h.get('staff_requests/late-one'),undefined);
});
test('clock-in at or after the plotted finish cannot claim a completed Morning 1 shift for payroll',async()=>{
 const f=await fixture(),end=new Date(f.attendance.scheduleSnapshot.expectedEndAt),profiles={[name]:f.profile};assert.equal(captureAttendanceSchedule(end,branch,name,f.history,profiles).wasScheduled,false);assert.equal(resolveAttendanceShift({...f.attendance,timestamp:end},f.history,profiles).needsScheduleReview,true);
});
test('only a verified unchanged assignment may ignore a revision-only change; provisional evidence still requires review',()=>{
 const before={branch,staffName:name,shiftId:'morning1',shiftName:'Morning 1',shiftType:'morning',expectedStartAt:'2026-11-16T00:00:00Z',expectedEndAt:'2026-11-16T08:30:00Z',wasScheduled:true,needsScheduleReview:false,scheduleRevisionId:'one'};assert.doesNotThrow(()=>assertAttendanceScheduleUnchanged(before,{...before,scheduleRevisionId:'two'}));assert.throws(()=>assertAttendanceScheduleUnchanged({...before,wasScheduled:false},{...before,wasScheduled:false,scheduleRevisionId:'two'}));
});
test('missing private profile data preserves a review-required actual arrival without inventing an assigned shift',async()=>{
 const f=await fixture(),history=f.history,snapshot=captureAttendanceSchedule(f.clock,branch,name,history,{});assert.equal(snapshot.wasScheduled,false);const attendance={...f.attendance,scheduleSnapshot:snapshot};
 const batch=createPlottedTimeInBatch(f.h.api,{attendanceRef:f.ref,attendance,now:()=>+f.clock});await batch.set(f.ref,attendance).commit();const saved=f.h.get(f.ref.path);assert.equal(saved.scheduleSnapshot.needsScheduleReview,true);assert.equal(saved.scheduleSnapshot.wasScheduled,false);assert.equal(saved.scheduleSnapshot.lateMinutes,0);
});
