import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScheduleHistoryStore,createScheduleRevision,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';
import {leavePerson,projectLeaveDay} from '../takodeal-manager/leave-model.js';
import {createScheduleMonthReader,loadScheduleMonthView,projectScheduleMonth} from '../takodeal-manager/schedule-sync.js';

const now = new Date('2026-10-16T12:00:00+08:00');
const clone = value => structuredClone(value);
function schedule(month='2026-10',name='Ana') {
    const [currentYear,currentMonth] = month.split('-').map(Number);
    const shift = {id:'night',name:'Night',startTime:'19:30',endTime:'03:00',shiftType:'night',active:true,days:[0,1,2,3,4,5,6]};
    const row = staff => ({scheduled:{night:staff},rest:[],unavailable:[],swaps:{}});
    return {currentYear,currentMonth,branchConfig:{Cabantian:[shift],Agdao:[{...shift,id:'agdao-night'}]},
        currentSchedule:Object.fromEntries([1,15,16,20,31].filter(day=>day<=new Date(Date.UTC(currentYear,currentMonth,0)).getUTCDate())
            .map(day=>[day,{Cabantian:row(name),Agdao:row('Bea')} ])),
        employees:[{name,branch:'Cabantian'},{name:'Bea',branch:'Agdao'}],holidays:{},unavailability:{}};
}
function memory(initial={}) {
    const records=new Map(Object.entries(clone(initial))),reads=[],writes=[];let seq=0,clock=now;
    const snap=value=>({exists:()=>value!==undefined,data:()=>clone(value)});
    const api={db:{},sessionUser:{email:'owner@example.test',isOwner:true},doc:(_,table,id)=>table+'/'+id,
        getDocFromServer:async path=>{reads.push(path);return snap(records.get(path));},
        getDoc:async()=>{throw Error('A cached document read must not be used.');},
        async runTransaction(_,callback){const pending=new Map();const result=await callback({get:async path=>snap(records.get(path)),set:(path,value)=>pending.set(path,clone(value))});for(const [path,value]of pending){records.set(path,value);writes.push(path);}return result;}};
    const store=createScheduleHistoryStore(api,{now:()=>clock,makeId:()=>`sync_${++seq}`});
    return {api,store,records,reads,writes,set clock(value){clock=value;}};
}

test('a second device reads the exact current-month Save Edits revision with no writes or shared mutable snapshot',async()=>{
    const h=memory({'settings/global_schedule':schedule()});
    const saved=await h.store.save(schedule('2026-10','Cora'),{effectiveFrom:'2026-10-16',expectedRevisionId:null});
    const before=clone([...h.records]),writes=h.writes.length;
    const device={...h.api,sessionUser:{email:'second@example.test',isOwner:true}};
    const view=await loadScheduleMonthView(device,{month:'2026-10',now});
    assert.equal(view.expectedRevisionId,saved.latestRevisionId);assert.equal(view.hasSavedSchedule,true);
    assert.equal(view.editorSnapshot.currentSchedule[16].Cabantian.scheduled.night,'Cora');
    assert.equal(view.snapshot.currentSchedule[16].Cabantian.scheduled.night,'Cora');
    assert.equal(view.dayRevisions[16],saved.latestRevisionId);
    view.editorSnapshot.currentSchedule[16].Cabantian.scheduled.night='local draft';
    assert.equal(view.snapshot.currentSchedule[16].Cabantian.scheduled.night,'Cora');
    assert.deepEqual([...h.records],before);assert.equal(h.writes.length,writes);
});

test('a saved future change appears in the editor while earlier work-day assignments and times remain unchanged',async()=>{
    const h=memory({'settings/global_schedule':schedule()});
    h.clock=new Date('2026-10-15T12:00:00+08:00');
    const first=await h.store.save(schedule(),{effectiveFrom:'2026-10-15',expectedRevisionId:null});
    h.clock=now;
    const planned=schedule('2026-10','Cora');planned.branchConfig.Cabantian[0].startTime='20:30';
    const later=await h.store.save(planned,{effectiveFrom:'2026-10-20',expectedRevisionId:first.latestRevisionId});
    assert.equal(later.publishedCurrent,false);
    const view=await loadScheduleMonthView(h.api,{month:'2026-10',now});
    assert.equal(view.editorSnapshot.currentSchedule[16].Cabantian.scheduled.night,'Cora');
    assert.equal(view.editorSnapshot.branchConfig.Cabantian[0].startTime,'20:30');
    assert.equal(view.snapshot.currentSchedule[16].Cabantian.scheduled.night,'Ana');
    assert.equal(view.daySnapshots[16].branchConfig.Cabantian[0].startTime,'19:30');
    assert.equal(view.dayRevisions[16],first.latestRevisionId);
    assert.equal(view.snapshot.currentSchedule[20].Cabantian.scheduled.night,'Cora');
    assert.equal(view.daySnapshots[20].branchConfig.Cabantian[0].startTime,'20:30');
    assert.equal(view.dayRevisions[20],later.latestRevisionId);
});

test('a new-month plan syncs to another device without publishing it into the current live head',async()=>{
    const h=memory({'settings/global_schedule':schedule()});
    const saved=await h.store.save(schedule('2026-11','Future Staff'),{effectiveFrom:'2026-11-01',expectedRevisionId:null});
    const before=clone(h.records.get('settings/global_schedule'));
    const view=await loadScheduleMonthView({...h.api},{month:'2026-11',now});
    assert.equal(saved.publishedCurrent,false);assert.equal(view.editorSnapshot.currentMonth,11);
    assert.equal(view.expectedRevisionId,saved.latestRevisionId);assert.equal(view.dayRevisions[1],saved.latestRevisionId);
    assert.equal(view.snapshot.currentSchedule[1].Cabantian.scheduled.night,'Future Staff');
    assert.deepEqual(h.records.get('settings/global_schedule'),before);
});

test('an unsaved month is explicitly empty and never borrows another month’s assignments, holidays or revision',async()=>{
    const current=schedule();current.holidays={'2026-10-16':'Regular'};current.scheduleRevisionId='october';
    const h=memory({'settings/global_schedule':current}),view=await loadScheduleMonthView(h.api,{month:'2026-09',now});
    assert.equal(view.hasSavedSchedule,false);assert.equal(view.source,'missing-month');assert.equal(view.expectedRevisionId,null);
    assert.equal(view.editorSnapshot.currentMonth,9);assert.deepEqual(view.snapshot.currentSchedule,{});
    assert.deepEqual(view.snapshot.holidays,{});assert.deepEqual(view.daySnapshots,{});
    assert.equal(view.editorSnapshot.scheduleRevisionId,undefined);assert.equal(h.writes.length,0);
});

test('unarchived same-month head edits remain visible from today while archived earlier work dates stay intact',async()=>{
    const h=memory({'settings/global_schedule':schedule()});h.clock=new Date('2026-10-15T12:00:00+08:00');
    const saved=await h.store.save(schedule(),{effectiveFrom:'2026-10-15',expectedRevisionId:null});
    const legacy=h.records.get('settings/global_schedule');
    for(const day of [15,16,20])legacy.currentSchedule[day].Cabantian.scheduled.night='Legacy Staff';
    legacy.branchConfig.Cabantian[0].startTime='20:30';h.records.set('settings/global_schedule',legacy);
    const view=await loadScheduleMonthView(h.api,{month:'2026-10',now});
    assert.equal(view.source,'live-unarchived');assert.equal(view.editorSnapshot.currentSchedule[16].Cabantian.scheduled.night,'Legacy Staff');
    assert.equal(view.snapshot.currentSchedule[15].Cabantian.scheduled.night,'Ana');assert.equal(view.dayRevisions[15],saved.latestRevisionId);
    assert.equal(view.snapshot.currentSchedule[16].Cabantian.scheduled.night,'Legacy Staff');assert.equal(view.dayRevisions[16],undefined);
    assert.ok(view.unverifiedDays.includes(16));assert.equal(view.daySnapshots[16].scheduleSource,'unverified');
});

test('read projections obey current branch access without deleting other saved branches from the editor document',async()=>{
    const h=memory({'settings/global_schedule':schedule()});h.api.isBranchAllowed=branch=>branch==='Agdao';
    const before=clone([...h.records]),view=await loadScheduleMonthView(h.api,{month:'2026-10',branch:'Agdao',now});
    assert.deepEqual(Object.keys(view.snapshot.branchConfig),['Agdao']);assert.deepEqual(Object.keys(view.snapshot.currentSchedule[16]),['Agdao']);
    assert.deepEqual(view.snapshot.employees.map(row=>row.branch),['Agdao']);
    assert.ok(view.editorSnapshot.currentSchedule[16].Cabantian,'an authorized editor must retain unrelated saved branches');
    await assert.rejects(loadScheduleMonthView(h.api,{month:'2026-10',branch:'Cabantian',now}),/outside your access/);
    assert.deepEqual([...h.records],before);assert.equal(h.writes.length,0);
});

test('simultaneous views share server reads, but the next settled load sees a later server change',async()=>{
    const h=memory({'settings/global_schedule':schedule()});let release;
    const original=h.api.getDocFromServer;
    h.api.getDocFromServer=path=>path==='settings/global_schedule'?new Promise(resolve=>{release=()=>original(path).then(resolve);}):original(path);
    const reader=createScheduleMonthReader(h.api);
    const first=reader.load('2026-10',{now}),second=reader.load('2026-10',{branch:'Agdao',now});
    while(!release)await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([first,second]);
    assert.equal(h.reads.filter(path=>path==='settings/global_schedule').length,1);
    assert.equal(h.reads.filter(path=>path==='settings/schedule_month_2026_10').length,1);
    h.api.getDocFromServer=original;h.records.get('settings/global_schedule').currentSchedule[16].Cabantian.scheduled.night='Newest';
    const later=await reader.load('2026-10',{now});assert.equal(later.snapshot.currentSchedule[16].Cabantian.scheduled.night,'Newest');
    assert.equal(h.reads.filter(path=>path==='settings/global_schedule').length,2);
});

test('a UI timeout retains the physical in-flight read so repeated refreshes cannot pile up database requests',async()=>{
    const h=memory({'settings/global_schedule':schedule()});let release,calls=0;
    const original=h.api.getDocFromServer;
    h.api.getDocFromServer=path=>{if(path!=='settings/global_schedule')return original(path);calls++;return new Promise(resolve=>{release=()=>original(path).then(resolve);});};
    const reader=createScheduleMonthReader(h.api,{timeoutMs:5});
    await assert.rejects(reader.load('2026-10',{now}),/could not be confirmed/);
    await assert.rejects(reader.load('2026-10',{now}),/could not be confirmed/);
    await assert.rejects(reader.load('2026-10',{now}),/could not be confirmed/);assert.equal(calls,1);
    release();await new Promise(resolve=>setImmediate(resolve));h.api.getDocFromServer=original;
    assert.equal((await reader.load('2026-10',{now})).hasSavedSchedule,true);
});

test('server failures and changed identity or permissions reject instead of claiming an empty saved month',async()=>{
    const h=memory({'settings/global_schedule':schedule()});
    const unavailable={...h.api,getDocFromServer:async()=>{throw Error('resource-exhausted');}};
    await assert.rejects(loadScheduleMonthView(unavailable,{month:'2026-10',now}),/resource-exhausted/);
    const cachedOnly={...h.api,getDocFromServer:undefined,getDoc:async()=>{throw Error('Cached reader must not run.');}};
    await assert.rejects(loadScheduleMonthView(cachedOnly,{month:'2026-10',now}),/server read API/);
    let release;const original=h.api.getDocFromServer;
    h.api.getDocFromServer=path=>path==='settings/global_schedule'?new Promise(resolve=>{release=()=>original(path).then(resolve);}):original(path);
    const pending=loadScheduleMonthView(h.api,{month:'2026-10',now});while(!release)await new Promise(resolve=>setImmediate(resolve));
    h.api.sessionUser={email:'new@example.test',isFranchisee:true,allowedBranches:['Agdao']};release();
    await assert.rejects(pending,/access changed/);assert.equal(h.writes.length,0);
});

test('a dangling latest revision is an incomplete-version error, never a successful empty month',()=>{
    assert.throws(()=>projectScheduleMonth({month:'2026-10',current:schedule(),archive:{month:'2026-10',latestRevisionId:'missing',revisions:[]},now}),/incomplete/);
});

test('the four apps ship identical read-only projections and existing history transaction code stays identical',()=>{
    for(const filename of ['schedule-sync.js','schedule-history.js']) {
        const manager=readFileSync(new URL('../takodeal-manager/'+filename,import.meta.url),'utf8');
        for(const app of ['takodeal-staff','Takodeal-POS','takodeal-franchise'])assert.equal(readFileSync(new URL('../'+app+'/'+filename,import.meta.url),'utf8'),manager,app+'/'+filename);
    }
});

function reviewedHistoricalMonth() {
    const original=schedule();for(let day=1;day<=31;day++)original.currentSchedule[day] ||= clone(original.currentSchedule[1]);
    original.unavailability['2026-10-10']={Bea:{status:'Day Off'}};
    const first=createScheduleRevision(original,{revisionId:'month-original',effectiveFrom:'2026-10-01',savedAt:'2026-10-01T00:00:00Z'});first.sequence=1;
    const planned=clone(original);planned.branchConfig.Cabantian[0].startTime='20:30';for(const day of Object.values(planned.currentSchedule))day.Cabantian.scheduled.night='Cora';
    const future=createScheduleRevision(planned,{revisionId:'month-future',effectiveFrom:'2026-10-20',savedAt:now});future.sequence=2;
    const workDate='2026-10-15',basis=resolveScheduleForDate({month:'2026-10',revisions:[first,future]},workDate),person=leavePerson({cashierName:'Ana',branch:'Cabantian',pin:'0420'},'staff_ana');
    const projected=projectLeaveDay(basis,workDate,{person,requestId:'leave-request'}).snapshot;
    const reviewed=createScheduleRevision(projected,{revisionId:'month-late-review',effectiveFrom:workDate,effectiveTo:workDate,savedAt:now,actor:'owner@example.test',source:'approved-leave',historicalLeaveReview:{basis,staffId:'staff_ana',staffNames:['Ana'],requestId:'leave-request',operationId:'late-review',reason:'Reviewed a delayed request'}});reviewed.sequence=3;
    return {original,first,future,reviewed,workDate,archive:{month:'2026-10',revisions:[first,future,reviewed],latestRevisionId:reviewed.revisionId,latestRevision:reviewed}};
}

test('a one-day historical review keeps the complete past-month editor, latest planned rules and unrelated staff',()=>{
    const f=reviewedHistoricalMonth(),before=clone(f.archive),view=projectScheduleMonth({month:'2026-10',current:schedule('2026-11'),archive:f.archive,now:new Date('2026-11-02T02:00:00Z')});
    assert.equal(view.expectedRevisionId,f.reviewed.revisionId);assert.equal(Object.keys(view.editorSnapshot.currentSchedule).length,31);
    assert.equal(view.editorSnapshot.branchConfig.Cabantian[0].startTime,'20:30');assert.deepEqual(view.editorSnapshot.employees,f.future.snapshot.employees);
    assert.equal(view.editorSnapshot.currentSchedule[15].Cabantian.scheduled.night,'UNFILLED');assert.equal(view.editorSnapshot.currentSchedule[20].Cabantian.scheduled.night,'Cora');
    assert.deepEqual(view.editorSnapshot.currentSchedule[15].Agdao,f.original.currentSchedule[15].Agdao);assert.equal(view.editorSnapshot.unavailability[f.workDate].Ana.staffId,'staff_ana');
    assert.deepEqual(view.snapshot.unavailability['2026-10-10'],{Bea:{status:'Day Off'}});assert.equal(view.snapshot.unavailability[f.workDate].Ana.leaveRequestId,'leave-request');
    assert.equal(view.daySnapshots[1].branchConfig.Cabantian[0].startTime,'19:30');assert.equal(view.daySnapshots[20].branchConfig.Cabantian[0].startTime,'20:30');assert.deepEqual(f.archive,before);
});

test('a later full-month future plan cannot resurrect the winning historical leave in the monthly editor',()=>{
    const f=reviewedHistoricalMonth(),next=clone(f.future.snapshot);next.branchConfig.Cabantian[0].startTime='21:30';
    const planned=createScheduleRevision(next,{revisionId:'later-full-plan',effectiveFrom:'2026-10-25',savedAt:now});planned.sequence=4;
    f.archive.revisions.push(planned);f.archive.latestRevisionId=planned.revisionId;f.archive.latestRevision=planned;
    const current={...clone(f.first.snapshot),scheduleRevisionId:f.first.revisionId},view=projectScheduleMonth({month:'2026-10',current,archive:f.archive,now});
    assert.equal(view.expectedRevisionId,planned.revisionId);assert.equal(view.editorSnapshot.branchConfig.Cabantian[0].startTime,'21:30');assert.equal(Object.keys(view.editorSnapshot.currentSchedule).length,31);
    assert.equal(view.editorSnapshot.currentSchedule[15].Cabantian.scheduled.night,'UNFILLED');assert.equal(view.editorSnapshot.unavailability[f.workDate].Ana.staffId,'staff_ana');
    assert.equal(view.editorSnapshot.currentSchedule[25].Cabantian.scheduled.night,'Cora');assert.equal(view.daySnapshots[15].branchConfig.Cabantian[0].startTime,'19:30');
});

test('unarchived current and future head edits stay visible while an older reviewed leave overlays only its past workday',()=>{
    const f=reviewedHistoricalMonth();f.archive.revisions=[f.first,f.reviewed];f.archive.latestRevisionId=f.reviewed.revisionId;f.archive.latestRevision=f.reviewed;
    const current={...clone(f.first.snapshot),scheduleRevisionId:f.first.revisionId};current.branchConfig.Cabantian[0].startTime='22:00';current.currentSchedule[20].Cabantian.scheduled.night='Unsaved Current Staff';
    const view=projectScheduleMonth({month:'2026-10',current,archive:f.archive,now});
    assert.equal(view.source,'live-unarchived');assert.equal(view.editorSnapshot.branchConfig.Cabantian[0].startTime,'22:00');assert.equal(view.editorSnapshot.currentSchedule[20].Cabantian.scheduled.night,'Unsaved Current Staff');
    assert.equal(view.snapshot.currentSchedule[20].Cabantian.scheduled.night,'Unsaved Current Staff');assert.equal(view.editorSnapshot.currentSchedule[15].Cabantian.scheduled.night,'UNFILLED');assert.equal(view.dayRevisions[15],f.reviewed.revisionId);
});
