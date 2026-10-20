import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadClockOutSchedule} from '../takodeal-manager/attendance-schedule-reader.js';
import {createScheduleHistoryStore,createScheduleRevision} from '../takodeal-manager/schedule-history.js';
import {resolveClockOutShift} from '../takodeal-manager/clock-out-schedule.js';
import {assessEarlyTimeOut} from '../takodeal-manager/early-time-out-model.js';

const date='2026-10-20',name='Sample Crew',branch='Sample Branch',staffId='sample-staff';
const copy=value=>structuredClone(value),at=(time,day=date)=>new Date(day+'T'+time+':00+08:00');
function fixture({count=150,corrected=true}={}){
    const snapshot={currentYear:2026,currentMonth:10,branchConfig:{[branch]:[
        {id:'night',name:'Night',startTime:corrected?'19:30':'18:30',endTime:corrected?'04:00':'03:00',shiftType:'night',active:true},
        {id:'other',name:'Other',startTime:'15:00',endTime:'23:00',active:true}
    ]},employees:[{staffId,name}],currentSchedule:Object.fromEntries(Array.from({length:31},(_,index)=>[index+1,{[branch]:{scheduled:{night:name,other:'Someone Else'},rest:[]}}]))};
    const beforePlan=copy(snapshot);beforePlan.branchConfig[branch][0].startTime='18:30';beforePlan.branchConfig[branch][0].endTime='03:00';
    const before=createScheduleRevision(beforePlan,{revisionId:'before',effectiveFrom:'2026-10-01',savedAt:at('07:00','2026-10-01'),cutover:'2026-10-01'});
    const revision=createScheduleRevision(snapshot,{revisionId:'canonical',effectiveFrom:'2026-10-16',savedAt:at('07:00','2026-10-16'),cutover:'2026-10-01'});revision.sequence=2;
    const event={id:'night-change',branch,effectiveFrom:'2026-10-16',effectiveTo:'2026-10-31',sourceRevisionId:'before',sourceRevisionIds:['before'],sourceDates:Object.fromEntries(Array.from({length:16},(_,i)=>['2026-10-'+(i+16),'before'])),canonicalRevisionId:'canonical',sequence:1,recordedAt:at('07:00','2026-10-16').toISOString(),reason:'Correct saved night shift hours',changes:[{shiftId:'night',beforeStart:'18:30',beforeEnd:'03:00',startTime:'19:30',endTime:'04:00'}]};
    const revisions=[before,revision];
    for(let index=2;index<count;index++){const older=copy(before);older.revisionId='older-'+index;older.sequence=index;older.effectiveTo='2026-10-15';for(const entry of Object.values(older.daySnapshots))entry.configRevisionId=older.revisionId;revisions.push(older);}
    const index={schemaVersion:1,kind:'schedule-month',month:'2026-10',revisionIds:revisions.map(row=>row.revisionId),latestRevisionId:'canonical',payrollHistoryEnforcedFrom:'2026-10-01',shiftAmendments:[event]};
    const docs=new Map([['settings/global_schedule',{...snapshot,scheduleRevisionId:'canonical',payrollHistoryEnforcedFrom:'2026-10-01'}],['settings/schedule_history_policy',{payrollHistoryEnforcedFrom:'2026-10-01'}],['settings/schedule_month_2026_10',index],['settings/schedule_shift_amendments_2026_10',{month:'2026-10',shiftAmendments:[copy(event)]}],...revisions.map(row=>['settings/schedule_revision_'+row.revisionId,row])]);
    const reads=[];const api={db:{},doc:(_,table,id)=>({path:table+'/'+id}),getDocFromServer:async ref=>{reads.push(ref.path);const row=docs.get(ref.path);return {exists:()=>row!==undefined,data:()=>copy(row),metadata:{fromCache:false,hasPendingWrites:false}};}};
    const start={id:'sample-in',type:'TIME IN',staffName:name,staffId,branch,timestamp:at(corrected?'19:35':'18:35'),scheduleSnapshot:{version:1,source:'clock-in',branch,staffName:name,shiftId:'night',wasScheduled:true,needsScheduleReview:false,expectedStartAt:at(corrected?'19:30':'18:30').toISOString(),expectedEndAt:at(corrected?'04:00':'03:00','2026-10-21').toISOString(),scheduleRevisionId:corrected?'canonical':'before'}};
    const person={cashierName:name,staffId,branch,scheduleNickname:name},profiles={[name]:person};
    return {api,docs,reads,start,person,profiles,event,index,revision,before};
}
async function full(f){return createScheduleHistoryStore(f.api).loadRange(new Date(+f.start.timestamp-86400000),new Date(+f.start.timestamp+86400000));}
async function compare(f){
    const expected=resolveClockOutShift(f.start,await full(f),f.profiles);f.reads.length=0;
    const history=await loadClockOutSchedule(f.api,f.start,f.person),actual=resolveClockOutShift(f.start,history,f.profiles);
    assert.deepEqual(actual,expected);
    for(const elapsed of [30*60000,8*3600000,10*3600000]){const now=new Date(+f.start.timestamp+elapsed);assert.deepEqual(assessEarlyTimeOut(f.start,actual,now),assessEarlyTimeOut(f.start,expected,now));}
    return {history,actual,reads:[...f.reads]};
}
function events(f,rows){f.index.shiftAmendments=copy(rows);f.docs.get('settings/schedule_shift_amendments_2026_10').shiftAmendments=copy(rows);}

test('a current corrected saved snapshot reads four fresh sentinels instead of 150 revision bodies',async()=>{
    const f=fixture(),original=copy(f.start),result=await compare(f);
    assert.equal(result.reads.length,4);assert.equal(result.reads.filter(path=>path.includes('schedule_revision_')).length,0);
    assert.equal(result.actual.expectedEndAt.toISOString(),at('04:00','2026-10-21').toISOString());assert.deepEqual(f.start,original);
});
test('without amendments, trusted saved snapshots do not need unrelated archived month bodies',async()=>{
    const f=fixture();events(f,[]);const result=await compare(f);assert.equal(result.reads.length,4);
});
test('other branches, shifts, dates and unmatched exact time pairs cannot amend the saved snapshot',async()=>{
    for(const kind of ['branch','shift','date','start','end']){
        const f=fixture(),row=copy(f.event);row.changes[0].beforeStart='19:30';row.changes[0].beforeEnd='04:00';row.changes[0].startTime='20:00';row.changes[0].endTime='04:30';
        if(kind==='branch')row.branch='Other Branch';if(kind==='shift')row.changes[0].shiftId='other';
        if(kind==='date'){row.effectiveFrom='2026-10-21';row.sourceDates=Object.fromEntries(Object.entries(row.sourceDates).filter(([key])=>key>='2026-10-21'));}
        if(kind==='start')row.changes[0].beforeStart='19:31';if(kind==='end')row.changes[0].beforeEnd='04:01';events(f,[row]);
        const result=await compare(f);assert.equal(result.reads.length,4,kind);
    }
});
test('an old pre-correction snapshot uses every dated source and produces the unchanged amended assessment',async()=>{
    const f=fixture({corrected:false}),result=await compare(f);
    assert.equal(result.reads.length,154);assert.equal(result.reads.filter(path=>path.includes('schedule_revision_')).length,150);
    assert.equal(result.actual.attendanceCorrectionVerified,true);assert.equal(new Set(result.reads).size,result.reads.length,'fallback reuses transaction sentinel reads');
});
test('a matching pair in any later correction chain falls back, including a return to an earlier time',async()=>{
    for(const repeat of [false,true]){
        const f=fixture(),last=copy(f.revision);last.revisionId='later';last.sequence=3;last.snapshot.branchConfig[branch][0].startTime=repeat?'18:30':'20:00';last.snapshot.branchConfig[branch][0].endTime=repeat?'03:00':'04:30';for(const day of Object.values(last.daySnapshots))day.configRevisionId=last.revisionId;
        f.index.revisionIds.push('later');f.index.latestRevisionId='later';f.docs.set('settings/schedule_revision_later',last);
        const row={...copy(f.event),id:'later-change',sourceRevisionId:'canonical',sourceRevisionIds:['canonical'],sourceDates:{[date]:'canonical'},canonicalRevisionId:'later',effectiveFrom:date,sequence:2,changes:[{shiftId:'night',beforeStart:'19:30',beforeEnd:'04:00',startTime:repeat?'18:30':'20:00',endTime:repeat?'03:00':'04:30'}]};events(f,[f.event,row]);
        const result=await compare(f);assert.equal(result.reads.length,155);assert.equal(result.actual.attendanceCorrectionVerified,true);
    }
});
test('manual lateness reviews on a matching correction keep their original flags and clock-out correction',async()=>{
    const f=fixture({corrected:false});f.start.reviewedLateMinutes=7;const result=await compare(f);
    assert.equal(result.reads.length,154);assert.equal(result.actual.attendanceCorrectionVerified,true);assert.equal(result.actual.needsScheduleReview,true);assert.equal(result.actual.lateMinutes,7);
});
test('assignment reconciliation and an unassigned punch always retain the complete dated resolver',async()=>{
    for(const reconcile of [false,true]){
        const f=fixture({corrected:false}),before=f.docs.get('settings/schedule_revision_before');
        before.snapshot.branchConfig[branch].push({id:'assigned',name:'Assigned night',startTime:'19:00',endTime:'03:30',active:true});
        for(const day of Object.values(before.daySnapshots)){day.daySchedule[branch].scheduled.night='Other Crew';day.daySchedule[branch].scheduled.assigned=name;}
        const row={...copy(f.event),reconcileSavedAssignments:reconcile,changes:[...f.event.changes,{shiftId:'assigned',beforeStart:'19:00',beforeEnd:'03:30',startTime:'19:30',endTime:'04:00'}]};events(f,[row]);
        f.start.scheduleSnapshot.wasScheduled=false;const result=await compare(f);assert.equal(result.reads.length,154);
    }
});
test('missing snapshots, unknown snapshots and identity conflicts fall back rather than trusting current labels',async()=>{
    for(const kind of ['missing','unknown','identity']){
        const f=fixture();if(kind==='missing')delete f.start.scheduleSnapshot;if(kind==='unknown')f.start.scheduleSnapshot.needsScheduleReview=true;if(kind==='identity')f.start.scheduleSnapshot.staffName='Wrong Crew';
        const result=await compare(f);assert.equal(result.reads.length,154,kind);
    }
});
test('the original Philippine day window reads both month sentinels around a month boundary',async()=>{
    const f=fixture();f.start.timestamp=at('00:20','2026-11-01');f.start.scheduleSnapshot.expectedStartAt=at('19:30','2026-10-31').toISOString();f.start.scheduleSnapshot.expectedEndAt=at('04:00','2026-11-01').toISOString();
    const result=await compare(f);assert.equal(result.reads.length,6);assert.ok(result.reads.includes('settings/schedule_month_2026_11'));assert.ok(result.reads.includes('settings/schedule_shift_amendments_2026_11'));
});
test('malformed index, amendment history, source links and offline metadata cannot authorize a fast answer',async()=>{
    for(const kind of ['ids','id','latest','month','prefix','event','source','sourceDates','cached','pending','snapshot']){
        const f=fixture();
        if(kind==='ids')f.index.revisionIds={};if(kind==='id')f.index.revisionIds.push('invalid/id');if(kind==='latest')f.index.latestRevisionId='missing';
        if(kind==='month')f.docs.get('settings/schedule_shift_amendments_2026_10').month='2026-11';
        if(kind==='prefix')f.docs.get('settings/schedule_shift_amendments_2026_10').shiftAmendments[0].reason='Different saved correction';
        if(kind==='event'){const row=copy(f.event);row.changes[0].beforeStart='invalid';events(f,[row]);}
        if(kind==='source'){const row=copy(f.event);row.canonicalRevisionId='missing';events(f,[row]);}
        if(kind==='sourceDates'){const row=copy(f.event);row.sourceDates={invalid:'before'};events(f,[row]);}
        const read=async ref=>{const result=await f.api.getDocFromServer(ref);if(ref.path==='settings/global_schedule'){if(kind==='cached')result.metadata.fromCache=true;if(kind==='pending')result.metadata.hasPendingWrites=true;if(kind==='snapshot')return null;}return result;};
        await assert.rejects(loadClockOutSchedule(f.api,f.start,f.person,{read}),undefined,kind);
    }
});
test('fresh server reads and action guards run again for each action rather than reusing a settled local answer',async()=>{
    const f=fixture();await loadClockOutSchedule(f.api,f.start,f.person);assert.equal(f.reads.length,4);
    f.reads.length=0;await loadClockOutSchedule(f.api,f.start,f.person);assert.equal(f.reads.length,4);
    let current=true;const original=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const row=await original(ref);current=false;return row;};
    await assert.rejects(loadClockOutSchedule(f.api,f.start,f.person,{assertCurrent:()=>{if(!current)throw Error('Account changed');}}),/Account changed/);
});
test('a later correction appended to durable history invalidates the next action even before the inline copy catches up',async()=>{
    const f=fixture();await loadClockOutSchedule(f.api,f.start,f.person);f.reads.length=0;
    const last=copy(f.revision);last.revisionId='later';last.sequence=3;last.snapshot.branchConfig[branch][0].startTime='20:00';for(const day of Object.values(last.daySnapshots))day.configRevisionId=last.revisionId;
    f.index.revisionIds.push('later');f.index.latestRevisionId='later';f.docs.set('settings/schedule_revision_later',last);
    const row={...copy(f.event),id:'later-change',sourceRevisionId:'canonical',sourceRevisionIds:['canonical'],sourceDates:{[date]:'canonical'},canonicalRevisionId:'later',effectiveFrom:date,sequence:2,changes:[{shiftId:'night',beforeStart:'19:30',beforeEnd:'04:00',startTime:'20:00',endTime:'04:00'}]};
    f.docs.get('settings/schedule_shift_amendments_2026_10').shiftAmendments.push(row);
    const result=await compare(f);assert.equal(result.reads.length,155);assert.equal(result.actual.expectedStartAt.toISOString(),at('20:00').toISOString());
});
test('generated snapshot, manual-review, roster and correction combinations remain identical to the complete archive',async()=>{
    let compared=0,fast=0,fallback=0;
    for(const savedStart of ['18:30','19:30','20:00'])for(const savedEnd of ['03:00','04:00'])for(const manual of [false,true])for(const assigned of [false,true])for(const reconcile of [false,true]){
        const f=fixture({count:5});f.start.timestamp=at(savedStart);f.start.scheduleSnapshot.expectedStartAt=at(savedStart).toISOString();f.start.scheduleSnapshot.expectedEndAt=at(savedEnd,'2026-10-21').toISOString();
        if(manual)f.start.reviewedLateMinutes=15;
        if(!assigned){for(const id of ['before','canonical'])for(const entry of Object.values(f.docs.get('settings/schedule_revision_'+id).daySnapshots))entry.daySchedule[branch].scheduled.night='Other Crew';}
        const row={...copy(f.event),reconcileSavedAssignments:reconcile};events(f,[row]);
        const result=await compare(f);compared++;if(result.reads.length===4)fast++;else fallback++;
    }
    assert.equal(compared,48);assert.equal(fast,40);assert.equal(fallback,8);
});
test('fresh read failures do not fall back to a cached roster or a current shift label',async()=>{
    const f=fixture();await assert.rejects(loadClockOutSchedule(f.api,f.start,f.person,{read:async()=>{throw Error('permission-denied');}}),/permission-denied/);
});
test('Owner, Staff and POS ship the identical transaction-only schedule reader',()=>{
    const expected=readFileSync(new URL('../takodeal-manager/attendance-schedule-reader.js',import.meta.url));
    for(const app of ['takodeal-staff','Takodeal-POS'])assert.deepEqual(readFileSync(new URL('../'+app+'/attendance-schedule-reader.js',import.meta.url)),expected);
});
