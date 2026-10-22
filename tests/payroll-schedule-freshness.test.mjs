import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {payrollScheduleStamp,assertPayrollScheduleFresh} from '../takodeal-manager/payroll-schedule-freshness.js';
import {createScheduleRevision,resolveScheduleForDate,createScheduleHistoryStore} from '../takodeal-manager/schedule-history.js';
import {resolveAttendanceShift} from '../takodeal-manager/payroll-safety.js';
const schedule={historyMonths:{'2030-01':{revisions:[],shiftAmendments:[]}}};
const range={start:'2030-01-01',end:'2030-01-15'};
const preview=(history=schedule)=>({...range,scheduleEvidenceStamp:payrollScheduleStamp(history,range)});
const apiFor=history=>({auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>structuredClone(history)});
const revision=(id='basis',from='2030-01-01',to='2030-01-31')=>({revisionId:id,month:'2030-01',sequence:1,savedAt:'2030-01-01T00:00:00.000Z',source:'manager-save',effectiveFrom:from,effectiveTo:to,
 snapshot:{currentYear:2030,currentMonth:1,branchConfig:{Maa:[{id:'m1',name:'Morning',startTime:'09:00',endTime:'17:30'}]},holidays:{'2030-01-01':'Regular','2030-01-22':'Special'}},daySnapshots:{'2030-01-01':{configRevisionId:id,daySchedule:{Maa:{scheduled:{m1:'Sample Staff'}}}},'2030-01-22':{configRevisionId:id,daySchedule:{Maa:{scheduled:{m1:'Other Staff'}}}}}});
const historyWith=(rows=[revision()])=>({currentYear:2030,currentMonth:1,payrollHistoryEnforcedFrom:'2030-01-01',branchConfig:{Maa:[{id:'m1',startTime:'09:00',endTime:'17:30'}]},currentSchedule:{1:{Maa:{scheduled:{m1:'Sample Staff'}}},22:{Maa:{scheduled:{m1:'Other Staff'}}}},historyMonths:{'2030-01':{latestRevisionId:rows.at(-1)?.revisionId,revisions:rows,shiftAmendments:[]}}});
test('unpaid preview must use fresh dated schedule evidence',async()=>{
 const api={auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>structuredClone(schedule)};
 await assertPayrollScheduleFresh(api,preview());
 api.loadPayrollScheduleHistory=async()=>({...structuredClone(schedule),historyMonths:{'2030-01':{revisions:[],shiftAmendments:[{id:'correction',effectiveFrom:'2030-01-01',effectiveTo:'2030-01-31'}]}}});
 await assert.rejects(assertPayrollScheduleFresh(api,preview()),/Regenerate/);
 await assert.rejects(assertPayrollScheduleFresh(api,{start:'2030-01-01'}),/Regenerate/);
});
test('paid figures are preserved and failed reads never authorize payment',async()=>{
 const paid={...preview(),isPaid:true,finalNetPay:150};const before=structuredClone(paid);
 await assertPayrollScheduleFresh({},paid);assert.deepEqual(paid,before);
 await assert.rejects(assertPayrollScheduleFresh({auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>{throw Error('offline');}},preview()),/offline/);
});
test('account change during read holds the unpaid preview',async()=>{
 const api={auth:{currentUser:{uid:'first',email:'owner@example.test'}},sessionUser:{uid:'first',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>{api.auth.currentUser.uid='second';return schedule;}};
 await assert.rejects(assertPayrollScheduleFresh(api,preview()),/authorized payroll|Regenerate/);
});
test('both Owner generators stamp previews and use shared amendment-aware minutes',()=>{
 const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
 // Each generator computes the stamp once per fresh run and shares that
 // evidence with its staff rows instead of serializing the schedule per row.
 assert.equal((source.match(/const scheduleEvidenceStamp=payrollScheduleStamp\(scheduleData,\{start:(?:startDateRaw|startInput),end:(?:endDateRaw|endInput)\}\)/g)||[]).length,2);
 assert.equal((source.match(/^\s+scheduleEvidenceStamp,$/gm)||[]).length,2);
 assert.equal((source.match(/attendanceLateMinutes\(log, matchedShift\)/g)||[]).length,2);
 assert.equal((source.match(/assertPayrollScheduleFresh\(window,data\)/g)||[]).length,2);
 assert.ok(source.includes('attendanceLateMinutes(data, matchedShift)'));
});

test('later current-month saves do not invalidate unchanged closed-cutoff evidence',async()=>{
 const initial=historyWith(),later=structuredClone(initial),future=revision('future-capture','2030-01-22');future.sequence=2;
 later.historyMonths['2030-01'].revisions.push(future);later.historyMonths['2030-01'].latestRevisionId=future.revisionId;
 later.currentSchedule[22].Maa.scheduled.m1='New Future Assignment';
 later.historyMonths['2030-01'].revisions[0].snapshot.holidays['2030-01-22']='Updated future holiday';
 later.historyMonths['2030-01'].revisions[0].daySnapshots['2030-01-22'].daySchedule.Maa.scheduled.m1='New Future Assignment';
 assert.equal(payrollScheduleStamp(initial,range),payrollScheduleStamp(later,range));
 await assertPayrollScheduleFresh(apiFor(later),preview(initial));
});

test('a backdated correction or actual cutoff shift, assignment, holiday or policy change still holds payment',async()=>{
 const initial=historyWith();
 for(const mutate of [
  history=>{history.historyMonths['2030-01'].revisions[0].snapshot.branchConfig.Maa[0].endTime='18:00';},
  history=>{history.historyMonths['2030-01'].revisions[0].daySnapshots['2030-01-01'].daySchedule.Maa.scheduled.m1='Changed Staff';},
  history=>{history.historyMonths['2030-01'].revisions[0].snapshot.holidays['2030-01-01']='Special';},
  history=>{history.holidays={'2030-01-02':'Regular'};},
  history=>{history.payrollHistoryEnforcedFrom='2030-01-02';},
  history=>{const backdated=revision('backdated','2030-01-02');backdated.sequence=2;history.historyMonths['2030-01'].revisions.push(backdated);},
  history=>{history.historyMonths['2030-01'].shiftAmendments.push({id:'times',effectiveFrom:'2030-01-05',effectiveTo:'2030-01-31',sequence:1,recordedAt:'2030-01-22T00:00:00Z',intentFingerprint:'checked shift correction',changes:[{shiftId:'m1',endTime:'18:00'}]});}
 ]){
  const changed=structuredClone(initial);mutate(changed);
  await assert.rejects(assertPayrollScheduleFresh(apiFor(changed),preview(initial)),/saved shift times changed/);
 }
});

test('immutable row ordering and equal timestamp representations do not fabricate a change',async()=>{
 const one=revision(),two=revision('second','2030-01-02');two.sequence=2;two.savedAt='2030-01-02T12:34:56.123456789Z';
 const initial=historyWith([one,two]),equivalent=structuredClone(initial);
 equivalent.historyMonths['2030-01'].revisions.reverse();
 equivalent.historyMonths['2030-01'].revisions[0].savedAt={seconds:Math.floor(Date.parse(two.savedAt)/1000),nanoseconds:123456789};
 equivalent.historyMonths['2030-01'].revisions[1].savedAt=new Date(one.savedAt);
 assert.equal(payrollScheduleStamp(initial,range),payrollScheduleStamp(equivalent,range));
 await assertPayrollScheduleFresh(apiFor(equivalent),preview(initial));
 equivalent.historyMonths['2030-01'].revisions[0].savedAt.nanoseconds++;
 assert.notEqual(payrollScheduleStamp(initial,range),payrollScheduleStamp(equivalent,range));
});

test('equal-instant normalization cannot hide a changed legacy resolver winner or correction order',()=>{
 const one=revision('a'),two=revision('b');one.sequence=0;two.sequence=0;
 one.savedAt='2030-01-01T00:00:00Z';two.savedAt='2030-01-01T00:00:00.000Z';
 two.snapshot.branchConfig.Maa[0].endTime='18:00';
 two.daySnapshots['2030-01-01'].configRevisionId='b';
 const initial=historyWith([one,two]),changed=structuredClone(initial);changed.historyMonths['2030-01'].revisions[0].savedAt='2030-01-01T00:00:00.000Z';
 assert.equal(resolveScheduleForDate(initial,'2030-01-01').scheduleRevisionId,'a');
 assert.equal(resolveScheduleForDate(changed,'2030-01-01').scheduleRevisionId,'b');
 assert.notEqual(payrollScheduleStamp(initial,range),payrollScheduleStamp(changed,range));
 const amendments=historyWith(),events=[{id:'a',sequence:0,effectiveFrom:'2030-01-01',effectiveTo:'2030-01-31',recordedAt:'2030-01-01T00:00:00Z'},{id:'b',sequence:0,effectiveFrom:'2030-01-01',effectiveTo:'2030-01-31',recordedAt:'2030-01-01T00:00:00.000Z'}];
 amendments.historyMonths['2030-01'].shiftAmendments=events;
 const reordered=structuredClone(amendments);reordered.historyMonths['2030-01'].shiftAmendments[0].recordedAt='2030-01-01T00:00:00.000Z';
 assert.notEqual(payrollScheduleStamp(amendments,range),payrollScheduleStamp(reordered,range));
});

test('future-only amendments are ignored but overnight and next-day matching boundaries remain protected',()=>{
 const initial=historyWith(),future=structuredClone(initial);
 future.historyMonths['2030-01'].shiftAmendments.push({id:'future',effectiveFrom:'2030-01-22',effectiveTo:'2030-01-31'});
 assert.equal(payrollScheduleStamp(initial,range),payrollScheduleStamp(future,range));
 const before=structuredClone(initial),after=structuredClone(initial);
 before.historyMonths['2029-12']={revisions:[{...revision('overnight','2029-12-31','2029-12-31'),month:'2029-12'}],shiftAmendments:[]};
 after.historyMonths['2030-01'].revisions.push(revision('next-day','2030-01-16','2030-01-16'));
 assert.notEqual(payrollScheduleStamp(initial,range),payrollScheduleStamp(before,range));
 assert.notEqual(payrollScheduleStamp(initial,range),payrollScheduleStamp(after,range));
});

test('legacy fallback rules and dated legacy assignments remain protected without holding unrelated future roster days',()=>{
 const initial=historyWith([]);initial.payrollHistoryEnforcedFrom='2030-01-20';
 const future=structuredClone(initial);future.currentSchedule[22].Maa.scheduled.m1='Future Staff';
 assert.equal(payrollScheduleStamp(initial,range),payrollScheduleStamp(future,range));
 const shift=structuredClone(initial);shift.branchConfig.Maa[0].endTime='18:00';
 const assigned=structuredClone(initial);assigned.currentSchedule[1].Maa.scheduled.m1='Changed';
 assert.notEqual(payrollScheduleStamp(initial,range),payrollScheduleStamp(shift,range));
 assert.notEqual(payrollScheduleStamp(initial,range),payrollScheduleStamp(assigned,range));
});

test('a legacy punch just before cutover protects its real next-work-date assignment',()=>{
 const initial=historyWith([]);initial.payrollHistoryEnforcedFrom='2030-01-16';
 initial.branchConfig={Maa:[{id:'m1',name:'Night one',shiftType:'night',startTime:'00:00',endTime:'08:00'},{id:'m2',name:'Night two',shiftType:'night',startTime:'00:30',endTime:'08:30'}]};
 initial.currentSchedule={16:{Maa:{scheduled:{m1:'Other Staff',m2:'Sample Staff'}}}};
 const changed=structuredClone(initial);changed.currentSchedule[16].Maa.scheduled={m1:'Sample Staff',m2:'Other Staff'};
 const log={staffName:'Sample Staff',branch:'Maa',type:'TIME IN',timestamp:new Date('2030-01-15T23:15:00+08:00')},profiles={'Sample Staff':{cashierName:'Sample Staff'}};
 const before=resolveAttendanceShift(log,initial,profiles),after=resolveAttendanceShift(log,changed,profiles);
 assert.equal(before.shiftId,'m2');assert.equal(after.shiftId,'m1');assert.equal(+before.expectedStartAt-+after.expectedStartAt,30*60000);
 const boundary={start:'2030-01-15',end:'2030-01-15'};
 assert.notEqual(payrollScheduleStamp(initial,boundary),payrollScheduleStamp(changed,boundary));
});

test('the older generator prior-day read also protects its prior work-date match',()=>{
 const initial=historyWith([]);initial.payrollHistoryEnforcedFrom='2030-01-20';
 initial.branchConfig={Maa:[{id:'n1',name:'Night',shiftType:'night',startTime:'18:00',endTime:'06:00'},{id:'m1',name:'Morning',shiftType:'morning',startTime:'06:00',endTime:'14:00'}]};
 initial.currentSchedule={13:{Maa:{scheduled:{n1:'Sample Staff'}}},14:{Maa:{scheduled:{m1:'Other Staff'}}}};
 const changed=structuredClone(initial);changed.currentSchedule[13].Maa.scheduled.n1='Other Staff';
 const log={staffName:'Sample Staff',branch:'Maa',type:'TIME IN',timestamp:new Date('2030-01-14T06:01:00+08:00')},profiles={'Sample Staff':{cashierName:'Sample Staff'}};
 assert.equal(resolveAttendanceShift(log,initial,profiles).shiftId,'n1');
 assert.equal(resolveAttendanceShift(log,changed,profiles).shiftId,'m1');
 const boundary={start:'2030-01-15',end:'2030-01-15'};
 assert.notEqual(payrollScheduleStamp(initial,boundary),payrollScheduleStamp(changed,boundary));
});

test('real schedule server loading and the payroll resolver retain a closed cutoff through later planning while holding changed dated evidence',async()=>{
 const snapshot={currentYear:2030,currentMonth:1,branchConfig:{Maa:[{id:'m1',name:'Morning',shiftType:'morning',startTime:'09:00',endTime:'17:30'}]},currentSchedule:Object.fromEntries(Array.from({length:31},(_,index)=>[index+1,{Maa:{scheduled:{m1:'Sample Staff'}}}]))};
 const basis=createScheduleRevision(snapshot,{revisionId:'real-basis',effectiveFrom:'2030-01-01',savedAt:new Date('2030-01-01T00:00:00Z'),cutover:'2030-01-01'});basis.sequence=1;
 const docs=new Map([['global_schedule',{...snapshot,scheduleRevisionId:basis.revisionId,payrollHistoryEnforcedFrom:'2030-01-01'}],['schedule_history_policy',{payrollHistoryEnforcedFrom:'2030-01-01'}],['schedule_month_2030_01',{revisionIds:[basis.revisionId],latestRevisionId:basis.revisionId}],['schedule_revision_'+basis.revisionId,basis]]);
 let reads=0;const store=createScheduleHistoryStore({db:{},doc:(_db,_collection,id)=>({id}),getDocFromServer:async reference=>{reads++;const value=structuredClone(docs.get(reference.id));return {exists:()=>value!==undefined,data:()=>value};}});
 const load=()=>store.loadRange('2029-12-30',range.end),initial=await load(),data=preview(initial),log={staffName:'Sample Staff',branch:'Maa',type:'TIME IN',timestamp:new Date('2030-01-05T09:30:00+08:00')},profiles={'Sample Staff':{cashierName:'Sample Staff'}};
 const original=resolveAttendanceShift(log,initial,profiles);
 assert.equal(original.wasScheduled,true);assert.equal(original.lateMinutes,30);
 const futureSnapshot=structuredClone(snapshot);futureSnapshot.currentSchedule[22].Maa.scheduled.m1='Future Staff';
 const future=createScheduleRevision(futureSnapshot,{revisionId:'real-future',effectiveFrom:'2030-01-22',savedAt:new Date('2030-01-22T00:00:00Z'),cutover:'2030-01-01'});future.sequence=2;
 docs.set('schedule_revision_'+future.revisionId,future);docs.set('schedule_month_2030_01',{revisionIds:[basis.revisionId,future.revisionId],latestRevisionId:future.revisionId});docs.set('global_schedule',{...futureSnapshot,scheduleRevisionId:future.revisionId,payrollHistoryEnforcedFrom:'2030-01-01'});
 const later=await load();assert.deepEqual(resolveAttendanceShift(log,later,profiles),original);
 await assertPayrollScheduleFresh({...apiFor(later),loadPayrollScheduleHistory:load},data);
 // The resolver uses the immutable day snapshot rather than the full-month
 // convenience roster inside a revision. Its projection must do the same.
 docs.get('schedule_revision_'+basis.revisionId).snapshot.currentSchedule[5].Maa.scheduled.m1='Unrelated convenience value';
 const convenience=await load();assert.deepEqual(resolveAttendanceShift(log,convenience,profiles),original);assert.equal(payrollScheduleStamp(initial,range),payrollScheduleStamp(convenience,range));
 docs.get('schedule_revision_'+basis.revisionId).daySnapshots['2030-01-05'].daySchedule.Maa.scheduled.m1='Changed dated assignment';
 assert.equal(resolveAttendanceShift(log,await load(),profiles).wasScheduled,false);
 await assert.rejects(assertPayrollScheduleFresh({...apiFor(later),loadPayrollScheduleHistory:load},data),/saved shift times changed/);
 assert.ok(reads>10);
});

test('old unscoped previews and changed or malformed cutoff dates require regeneration before any server read',async()=>{
 let reads=0;const api={...apiFor(schedule),loadPayrollScheduleHistory:async()=>{reads++;return schedule;}};
 for(const stamp of ['broken','{"months":{}}','{"version":1,"start":"2030-01-01","end":"2030-01-15"}'])await assert.rejects(assertPayrollScheduleFresh(api,{...preview(),scheduleEvidenceStamp:stamp}),/Regenerate.*cutoff-specific/);
 await assert.rejects(assertPayrollScheduleFresh(api,{...preview(),end:'2030-01-16'}),/Regenerate.*cutoff-specific/);
 assert.equal(reads,0);
 for(const invalid of [undefined,{start:'2030-02-30',end:'2030-03-15'},{start:'2030-01-16',end:'2030-01-15'},{start:'2030-01-01',end:'2033-01-01'}])assert.throws(()=>payrollScheduleStamp(schedule,invalid),/valid cutoff/);
});

test('matching evidence never authorizes a signed-out or out-of-scope account',async()=>{
 for(const api of [{},{auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'other',email:'owner@example.test',isOwner:true,permissions:['payroll']}},{auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll'],isFranchisee:true}}])await assert.rejects(assertPayrollScheduleFresh({...api,loadPayrollScheduleHistory:async()=>schedule},preview()),/authorized payroll/);
});
