import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {payrollScheduleStamp,payrollBonusBranches,assertPayrollScheduleFresh} from '../takodeal-manager/payroll-schedule-freshness.js';
import {createScheduleRevision,resolveScheduleForDate,createScheduleHistoryStore} from '../takodeal-manager/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift,calculateShiftEarnings} from '../takodeal-manager/payroll-safety.js';
import {createPayrollBonusHistoryStore,publishedPayrollTemplateEvidence} from '../takodeal-manager/payroll-bonus-templates.js';
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
 // Both routes retain their cutoff check and bind each row's actually used
 // published fallback branches after its attendance details are calculated.
 assert.equal((source.match(/const scheduleEvidenceStamp=payrollScheduleStamp\(scheduleData,\{start:(?:startDateRaw|startInput),end:(?:endDateRaw|endInput)\}\)/g)||[]).length,2);
 assert.equal((source.match(/scheduleEvidenceStamp:payrollScheduleStamp\(scheduleData,\{start:(?:startDateRaw|startInput),end:(?:endDateRaw|endInput)\},\{bonusBranches:payrollBonusBranches\(d\.logs,d\.branch\)\}\)/g)||[]).length,2);
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

const publishedBranch='Fictional Branch',publishedName='Fictional Crew',publishedStaffId='fictional-staff';
const publishedRange={start:'2026-10-16',end:'2026-10-31'};
const selectedBonus={bonusBranches:[publishedBranch]};
const publishedRule=(extra={})=>({id:'night',name:'Saved duty',shiftType:'night',startTime:'17:30',endTime:'02:00',active:true,days:[0,1,2,3,4,5,6],...extra});
async function publishedFixture(){
 const current={currentYear:2026,currentMonth:11,branchConfig:{[publishedBranch]:[publishedRule()]},currentSchedule:{},scheduleRevisionId:'fictional-published-a',payrollHistoryEnforcedFrom:'2026-10-01'};
 const docs=new Map([['global_schedule',current],['schedule_history_policy',{payrollHistoryEnforcedFrom:'2026-10-01'}]]),reads=[];
 const api={...apiFor(null),db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:async reference=>{reads.push(reference);return {id:reference.id,exists:()=>docs.has(reference.id),data:()=>structuredClone(docs.get(reference.id)),metadata:{fromCache:false,hasPendingWrites:false}};}};
 api.loadPayrollScheduleHistory=(from,to)=>createPayrollBonusHistoryStore(api).loadRange(from,to);
 const history=await api.loadPayrollScheduleHistory(publishedRange.start,publishedRange.end);
 return {history,api,docs,reads};
}
test('a post-cutover historical fallback binds its actual fresh published templates before payment',async()=>{
 const {history,api,docs}=await publishedFixture(),profile={id:publishedStaffId,staffId:publishedStaffId,cashierName:publishedName,branch:publishedBranch,hourlyRate:450,nightDiffRate:50};
 const timeIn=new Date('2026-10-17T17:11:00+08:00'),timeOut=new Date('2026-10-18T02:06:00+08:00'),source={currentYear:2026,currentMonth:10,branchConfig:{[publishedBranch]:[publishedRule({shiftType:'morning'})]},currentSchedule:{17:{[publishedBranch]:{scheduled:{night:publishedName}}}},employees:[{id:publishedStaffId,name:publishedName,branch:publishedBranch}]};
 const archived=createScheduleRevision(source,{revisionId:'fictional-original',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:new Date('2026-10-01T00:00:00+08:00')}),original={...source,historyMonths:{'2026-10':{revisions:[archived],shiftAmendments:[]}}};
 const log={id:'fictional-time-in',staffId:publishedStaffId,staffName:publishedName,branch:publishedBranch,type:'TIME IN',timestamp:timeIn,scheduleSnapshot:captureAttendanceSchedule(timeIn,publishedBranch,publishedName,original,{[publishedName]:profile})};
 const earn=schedule=>calculateShiftEarnings(profile,resolveAttendanceShift(log,schedule,{[publishedName]:profile}),timeIn,timeOut),data={...publishedRange,staffId:publishedStaffId,name:publishedName,branch:publishedBranch,logs:[{branch:publishedBranch,bonusBasis:earn(history).bonusBasis}],scheduleEvidenceStamp:payrollScheduleStamp(history,publishedRange,selectedBonus)};
 assert.equal(earn(history).nightBonus,50);assert.equal(JSON.parse(data.scheduleEvidenceStamp).legacy,null);await assertPayrollScheduleFresh(api,data);
 docs.get('global_schedule').branchConfig[publishedBranch][0].shiftType='morning';
 const changed=await api.loadPayrollScheduleHistory(publishedRange.start,publishedRange.end);assert.equal(earn(changed).nightBonus,0);assert.notEqual(payrollScheduleStamp(changed,publishedRange,selectedBonus),data.scheduleEvidenceStamp);await assert.rejects(assertPayrollScheduleFresh(api,data),/saved shift times changed/);
});
test('same-revision rule edits and revision-only changes both invalidate trusted published evidence',async()=>{
 const mutations=[row=>{row.branchConfig[publishedBranch][0].startTime='18:30';},row=>{row.branchConfig[publishedBranch][0].endTime='03:00';},row=>{row.branchConfig[publishedBranch][0].days=[0];},row=>{row.branchConfig[publishedBranch][0].active=false;},row=>{row.scheduleRevisionId='fictional-published-b';}];
 for(const change of mutations){const {history,api,docs}=await publishedFixture(),data={...publishedRange,scheduleEvidenceStamp:payrollScheduleStamp(history,publishedRange,selectedBonus)};change(docs.get('global_schedule'));await assert.rejects(assertPayrollScheduleFresh(api,data),/saved shift times changed/);}
});
test('published evidence is captured once from the server, survives a spread and cannot be substituted by draft edits or serialization',async()=>{
 const {history}=await publishedFixture(),before=payrollScheduleStamp(history,publishedRange,selectedBonus),captured=publishedPayrollTemplateEvidence(history);
 history.branchConfig[publishedBranch]=[publishedRule({shiftType:'morning'})];history.scheduleRevisionId='draft-only';
 assert.equal(payrollScheduleStamp({...history},publishedRange,selectedBonus),before);assert.equal(captured.scheduleRevisionId,'fictional-published-a');assert.throws(()=>{captured.branchConfig[publishedBranch][0].shiftType='morning';},TypeError);
 const copied=JSON.parse(JSON.stringify(history));assert.equal(publishedPayrollTemplateEvidence(copied),null);assert.notEqual(payrollScheduleStamp(copied,publishedRange,selectedBonus),before);
});
test('a missing fresh published proof cannot authorize an old proven fallback and paid figures remain frozen',async()=>{
 const {history,api,reads}=await publishedFixture(),data={...publishedRange,scheduleEvidenceStamp:payrollScheduleStamp(history,publishedRange,selectedBonus)};
 api.loadPayrollScheduleHistory=async()=>JSON.parse(JSON.stringify(history));await assert.rejects(assertPayrollScheduleFresh(api,data),/saved shift times changed/);
 const paid={...data,isPaid:true,finalNetPay:500},before=structuredClone(paid),readCount=reads.length;await assertPayrollScheduleFresh(api,paid);assert.deepEqual(paid,before);assert.equal(reads.length,readCount);
});
test('fully dated or Owner-reviewed bonus rows do not bind later current planning and unrelated branch config is excluded',async()=>{
 const {history,api,docs}=await publishedFixture(),logs=[{branch:publishedBranch,bonusBasis:{source:'actual-punches',templateSource:'dated'}},{branch:publishedBranch,bonusBasis:{source:'owner-review',templateSource:'owner-review'}}];
 const branches=payrollBonusBranches(logs,publishedBranch),data={...publishedRange,branch:publishedBranch,logs,scheduleEvidenceStamp:payrollScheduleStamp(history,publishedRange,{bonusBranches:branches})};assert.deepEqual(branches,[]);
 const scoped=payrollScheduleStamp(history,publishedRange,selectedBonus);docs.get('global_schedule').branchConfig['Other Fictional Branch']=[publishedRule({shiftType:'morning'})];const other=await api.loadPayrollScheduleHistory(publishedRange.start,publishedRange.end);assert.equal(payrollScheduleStamp(other,publishedRange,selectedBonus),scoped);
 docs.get('global_schedule').scheduleRevisionId='future-planning';docs.get('global_schedule').branchConfig[publishedBranch][0].shiftType='morning';await assertPayrollScheduleFresh(api,data);
});
test('unresolved actual bonus branches are scoped too and an old unscoped fallback preview requires regeneration',async()=>{
 const {history,api}=await publishedFixture(),logs=[{branch:publishedBranch,bonusBasis:{source:'actual-punches',templateSource:null}},{bonusBasis:{source:'actual-punches',templateSource:'current-published'}},{branch:publishedBranch,bonusBasis:{source:'actual-punches',templateSource:'dated'}}];
 assert.deepEqual(payrollBonusBranches(logs,publishedBranch),[publishedBranch]);
 await assert.rejects(assertPayrollScheduleFresh(api,{...publishedRange,branch:publishedBranch,logs,scheduleEvidenceStamp:payrollScheduleStamp(history,publishedRange)}),/Regenerate.*actual-work bonus source/);
 for(const bonusBranches of ['wrong',[null],[''],[5]])assert.throws(()=>payrollScheduleStamp(history,publishedRange,{bonusBranches}),/actual-work bonus branch/);
});
test('a long cutoff can contain more than one hundred fallback duties in one branch without becoming one hundred distinct scopes',()=>{
 const logs=Array.from({length:150},()=>({branch:publishedBranch,bonusBasis:{source:'actual-punches',templateSource:'current-published'}}));assert.deepEqual(payrollBonusBranches(logs,publishedBranch),[publishedBranch]);
 assert.throws(()=>payrollBonusBranches([...logs,{branch:null,bonusBasis:{source:'actual-punches',templateSource:null}}]),/actual-work bonus branch/);
});
test('worked-shift immutable audits and carried marker fields are financially protected by cutoff freshness',async()=>{
 const worked=revision('worked','2030-01-05','2030-01-05');worked.source='owner-worked-shift';worked.snapshot.workedShiftCorrections={first:{workDate:'2030-01-05',expectedStartAt:'2030-01-05T17:30:00+08:00',preservedLateness:{lateMinutes:37}},future:{workDate:'2030-01-22',reason:'Unrelated future correction'}};worked.historicalWorkedShiftReview={workDate:'2030-01-05',timeInLogId:'first',reason:'Owner reviewed'};const initial=historyWith([worked]);
 for(const mutate of [h=>{h.historyMonths['2030-01'].revisions[0].snapshot.workedShiftCorrections.first.preservedLateness.lateMinutes=0;},h=>{h.historyMonths['2030-01'].revisions[0].historicalWorkedShiftReview.reason='Changed audit';},h=>{delete h.historyMonths['2030-01'].revisions[0].snapshot.workedShiftCorrections.first;}]){const changed=structuredClone(initial);mutate(changed);assert.notEqual(payrollScheduleStamp(changed,range),payrollScheduleStamp(initial,range));await assert.rejects(assertPayrollScheduleFresh(apiFor(changed),preview(initial)),/saved shift times changed/);}
 const future=structuredClone(initial);future.historyMonths['2030-01'].revisions[0].snapshot.workedShiftCorrections.future.reason='Future only';assert.equal(payrollScheduleStamp(future,range),payrollScheduleStamp(initial,range));
});
