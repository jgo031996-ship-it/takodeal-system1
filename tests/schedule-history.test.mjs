import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleDateKey,monthKey,defaultScheduleEffectiveFrom,createScheduleRevision,resolveScheduleForDate,assembleScheduleHistory,createScheduleHistoryStore} from '../takodeal-manager/schedule-history.js';

const now = new Date('2026-10-05T18:00:00Z'); // October 6 in the Philippines.
const copy = value => structuredClone(value);
function schedule(month='2026-10',start='09:00',staff='Ana') {
    const [year,number]=month.split('-').map(Number);
    return {currentYear:year,currentMonth:number,branchConfig:{Maa:[{id:'morning',name:'Morning',startTime:start,endTime:'18:00',active:true,days:[0,1,2,3,4,5,6]}]},currentSchedule:{1:{Maa:{scheduled:{morning:staff},rest:['Bea'],unavailable:[],swaps:{}}},6:{Maa:{scheduled:{morning:staff},rest:[],unavailable:[],swaps:{}}},20:{Maa:{scheduled:{morning:staff},rest:[],unavailable:[],swaps:{}}}},employees:[{name:staff,branch:'Maa'}],unavailability:{},holidays:{'2026-10-06':'Regular'}};
}
function revision(input,from,id='one',savedAt=now) {return createScheduleRevision(input,{revisionId:id,effectiveFrom:from,savedAt});}
function mock(initial={}) {
    const documents=new Map(Object.entries(copy(initial))),changes=[];let id=0,queue=Promise.resolve(),clock=now,denied=false;
    const snap=value=>({exists:()=>value!==undefined,data:()=>copy(value)});
    const api={db:{},doc:(_db,collection,key)=>`${collection}/${key}`,getDocFromServer:async ref=>snap(documents.get(ref)),runTransaction(_db,callback){
        const action=queue.then(async()=>{const writes=new Map();let writing=false;
            const tx={async get(ref){assert.equal(writing,false,'transaction reads must precede writes');return snap(documents.get(ref));},set(ref,value){writing=true;writes.set(ref,copy(value));}};
            const result=await callback(tx);if(denied)throw Error('permission-denied');for(const [ref,value]of writes){documents.set(ref,value);changes.push(ref);}return result;
        });queue=action.catch(()=>{});return action;
    }};
    const store=createScheduleHistoryStore(api,{now:()=>clock,makeId:()=>`rev_${String(++id).padStart(4,'0')}`});
    return {api,store,documents,changes,set clock(value){clock=value;},set denied(value){denied=value;}};
}

test('date and month keys use Philippine dates around UTC midnight and reject invalid dates',()=>{
    assert.equal(scheduleDateKey('2026-10-05T16:05:00Z'),'2026-10-06');assert.equal(monthKey({currentYear:2026,currentMonth:9}),'2026-09');
    assert.equal(scheduleDateKey({seconds:Math.floor(now.getTime()/1000)}),'2026-10-06');
    assert.throws(()=>scheduleDateKey('2026-02-30'),/valid/);assert.throws(()=>monthKey('2026-13'),/valid/);
    assert.equal(defaultScheduleEffectiveFrom(schedule(),now),'2026-10-06');assert.equal(defaultScheduleEffectiveFrom(schedule('2026-11'),now),'2026-11-01');
});
test('revisions freeze actual times, assignments, holidays and future date snapshots without sharing mutable editor objects',()=>{
    const input=schedule(),saved=revision(input,'2026-10-06');input.branchConfig.Maa[0].startTime='12:00';input.currentSchedule[6].Maa.scheduled.morning='Bea';
    assert.equal(saved.snapshot.branchConfig.Maa[0].startTime,'09:00');assert.equal(saved.daySnapshots['2026-10-06'].daySchedule.Maa.scheduled.morning,'Ana');
    assert.equal(saved.snapshot.holidays['2026-10-06'],'Regular');assert.equal(saved.daySnapshots['2026-10-01'],undefined);assert.equal(Object.keys(saved.daySnapshots).length,26);
});
test('legacy name-only times are materialized explicitly, including noon and overnight shifts',()=>{
    const input=schedule();input.branchConfig.Maa=[{id:'n',name:'Night (6:30pm-3am)',active:true},{id:'mid',name:'Mid (12nn-9pm)',active:true}];
    const saved=revision(input,'2026-10-06');assert.equal(saved.snapshot.branchConfig.Maa[0].startTime,'18:30');assert.equal(saved.snapshot.branchConfig.Maa[0].endTime,'03:00');assert.equal(saved.snapshot.branchConfig.Maa[1].startTime,'12:00');
});
test('saving past dates, malformed times, wrong-month days or duplicate shift IDs is rejected',()=>{
    assert.throws(()=>revision(schedule(),'2026-10-01'),/Past dates/);assert.throws(()=>revision(schedule('2026-09'),'2026-09-01'),/Past dates/);
    const bad=schedule();bad.branchConfig.Maa[0].startTime='30:00';assert.throws(()=>revision(bad,'2026-10-06'),/both Time/);
    const dup=schedule();dup.branchConfig.Maa.push(copy(dup.branchConfig.Maa[0]));assert.throws(()=>revision(dup,'2026-10-06'),/unique ID/);
    const day=schedule('2026-11');day.currentSchedule[31]={};assert.throws(()=>revision(day,'2026-11-01'),/selected month/);
});
test('day selection retains earlier shift rules and takes only revisions effective on that work date',()=>{
    const first=revision(schedule(),'2026-10-06','first'),later=revision(schedule('2026-10','11:00'),'2026-10-20','later');
    const history=assembleScheduleHistory(schedule('2026-10','11:00'),[{month:'2026-10',revisions:[first,later]}]);
    assert.equal(resolveScheduleForDate(history,'2026-10-06').branchConfig.Maa[0].startTime,'09:00');assert.equal(resolveScheduleForDate(history,'2026-10-19').branchConfig.Maa[0].startTime,'09:00');
    assert.equal(resolveScheduleForDate(history,'2026-10-20').branchConfig.Maa[0].startTime,'11:00');assert.equal(resolveScheduleForDate(history,'2026-10-05'),null);
});
test('September remains unknown when October is open, and an October rollout capture never fabricates September coverage',()=>{
    const captured=createScheduleRevision(schedule('2026-09'),{revisionId:'legacy',source:'legacy-capture',savedAt:now,effectiveFrom:'2026-10-06'});
    assert.deepEqual(captured.daySnapshots,{});const history=assembleScheduleHistory(schedule(),[{month:'2026-09',revisions:[captured]}]);
    assert.equal(resolveScheduleForDate(history,'2026-09-30'),null);assert.equal(resolveScheduleForDate(history,'2026-10-06'),null);
});
test('effective-date selection spans month/year boundaries without borrowing adjacent-month configurations',()=>{
    const september=createScheduleRevision(schedule('2026-09','18:30'),{revisionId:'sep',savedAt:'2026-09-01T00:00:00Z',effectiveFrom:'2026-09-01'});
    const october=revision(schedule('2026-10','19:30'),'2026-10-06','oct');
    const history=assembleScheduleHistory(schedule(),[{month:'2026-09',revisions:[september]},{month:'2026-10',revisions:[october]}]);
    assert.equal(resolveScheduleForDate(history,'2026-09-30').branchConfig.Maa[0].startTime,'18:30');assert.equal(resolveScheduleForDate(history,'2026-10-01'),null);
    assert.equal(resolveScheduleForDate(history,'2026-10-06').branchConfig.Maa[0].startTime,'19:30');
});
test('server baseline and new revision commit atomically before replacing the active head',async()=>{
    const app=mock({'settings/global_schedule':schedule()});const result=await app.store.save(schedule('2026-10','11:00'),{effectiveFrom:'2026-10-06',actor:'Owner',expectedRevisionId:null});
    assert.equal(result.publishedCurrent,true);assert.equal(app.documents.get('settings/global_schedule').branchConfig.Maa[0].startTime,'11:00');
    const month=await app.store.loadMonth('2026-10');assert.equal(month.revisions.length,2);assert.equal(month.revisions[0].source,'legacy-capture');assert.equal(month.revisions[0].snapshot.branchConfig.Maa[0].startTime,'09:00');
    assert.equal(month.latestRevision.revisionId,result.latestRevisionId);assert.equal(app.documents.get('settings/schedule_history_policy').payrollHistoryEnforcedFrom,'2026-10-06');
});
test('future November and October 20 plans do not publish their rules into today’s live global schedule',async()=>{
    const app=mock({'settings/global_schedule':schedule()});
    const november=await app.store.save(schedule('2026-11','12:00'),{effectiveFrom:'2026-11-01',expectedRevisionId:null});assert.equal(november.publishedCurrent,false);
    const october=await app.store.loadMonth('2026-10');
    const planned=await app.store.save(schedule('2026-10','10:00'),{effectiveFrom:'2026-10-20',expectedRevisionId:october.latestRevisionId});assert.equal(planned.publishedCurrent,false);
    assert.equal(app.documents.get('settings/global_schedule').currentMonth,10);assert.equal(app.documents.get('settings/global_schedule').branchConfig.Maa[0].startTime,'09:00');
    const history=await app.store.loadRange('2026-10-06','2026-11-30');assert.equal(resolveScheduleForDate(history,'2026-10-19').branchConfig.Maa[0].startTime,'09:00');assert.equal(resolveScheduleForDate(history,'2026-10-20').branchConfig.Maa[0].startTime,'10:00');assert.equal(resolveScheduleForDate(history,'2026-11-01').branchConfig.Maa[0].startTime,'12:00');
});
test('repeated capture is idempotent and normalized Firestore key order does not create extra baselines',async()=>{
    const app=mock({'settings/global_schedule':schedule()});await app.store.captureCurrent();await app.store.captureCurrent();
    assert.equal((await app.store.loadMonth('2026-10')).revisions.length,1);
    const current=app.documents.get('settings/global_schedule');app.documents.set('settings/global_schedule',Object.fromEntries(Object.entries(current).sort(([a],[b])=>a.localeCompare(b))));
    await app.store.captureCurrent();assert.equal((await app.store.loadMonth('2026-10')).revisions.length,1);
});
test('concurrent stale edits reject the later save instead of overwriting a revision from another session',async()=>{
    const app=mock({'settings/global_schedule':schedule()});await app.store.captureCurrent();const before=(await app.store.loadMonth('2026-10')).latestRevisionId;
    const results=await Promise.allSettled([app.store.save(schedule('2026-10','10:00'),{expectedRevisionId:before}),app.store.save(schedule('2026-10','11:00'),{expectedRevisionId:before})]);
    assert.equal(results.filter(item=>item.status==='fulfilled').length,1);assert.match(results.find(item=>item.status==='rejected').reason.message,/another session/);
    assert.equal(app.documents.get('settings/global_schedule').branchConfig.Maa[0].startTime,'10:00');
});
test('permissions or validation failure leaves the active head, archives and policy unchanged',async()=>{
    const app=mock({'settings/global_schedule':schedule()});const before=copy([...app.documents]);app.denied=true;
    await assert.rejects(app.store.save(schedule()),/permission-denied/);assert.deepEqual([...app.documents],before);assert.equal(app.changes.length,0);
});
test('an explicitly reused revision ID recognizes a lost acknowledgement without duplicating or replaying it',async()=>{
    const app=mock({'settings/global_schedule':schedule()});const first=await app.store.save(schedule(),{revisionId:'retryable',expectedRevisionId:null});const count=app.changes.length;
    const second=await app.store.save(schedule(),{revisionId:'retryable',expectedRevisionId:null});assert.equal(second.alreadySaved,true);assert.equal(second.latestRevisionId,first.latestRevisionId);assert.equal(app.changes.length,count);
    await assert.rejects(app.store.save(schedule('2026-10','11:00'),{revisionId:'retryable'}),/different data/);
});
test('a month load replaces the date/shift map rather than carrying October rows into a missing historical month',async()=>{
    const app=mock({'settings/global_schedule':schedule()});await app.store.save(schedule());const september=await app.store.loadMonth('2026-09');
    assert.equal(september.latestRevision,null);assert.deepEqual(september.revisions,[]);const history=await app.store.loadRange('2026-09-16','2026-10-15');
    assert.deepEqual(history.historyMonths['2026-09'].revisions,[]);assert.equal(history.payrollHistoryEnforcedFrom,'2026-10-06');assert.equal(resolveScheduleForDate(history,'2026-09-30'),null);
});
test('readonly loaders require no transaction or write permission and reject reversed or excessive ranges',async()=>{
    const app=mock();const readonly=createScheduleHistoryStore({db:app.api.db,doc:app.api.doc,getDoc:app.api.getDocFromServer});
    const history=await readonly.loadRange('2026-09-01','2026-10-15');assert.deepEqual(Object.keys(history.historyMonths),['2026-09','2026-10']);
    await assert.rejects(readonly.save(schedule()),/atomic save/);await assert.rejects(readonly.loadRange('2026-10','2026-09'),/reversed/);await assert.rejects(readonly.loadRange('2023-01','2026-01'),/24/);
});
test('atomic extension checks the request before writes and commits its approval with the schedule',async()=>{
    const app=mock({'settings/global_schedule':schedule(),'staff_requests/request1':{status:'Pending'}});
    await app.store.save(schedule('2026-10','10:00'),{readExtra:async(tx,context)=>{assert.equal(context.current.branchConfig.Maa[0].startTime,'09:00');assert.equal(context.revision.snapshot.branchConfig.Maa[0].startTime,'10:00');const request=(await tx.get('staff_requests/request1')).data();if(request.status!=='Pending')throw Error('Request already reviewed');return request;},writeExtra:(tx,request)=>tx.set('staff_requests/request1',{...request,status:'Approved'})});
    assert.equal(app.documents.get('staff_requests/request1').status,'Approved');assert.equal(app.documents.get('settings/global_schedule').branchConfig.Maa[0].startTime,'10:00');
});
test('failed atomic request approval rolls back the archive and live head together',async()=>{
    const app=mock({'settings/global_schedule':schedule(),'staff_requests/request1':{status:'Approved'}});const before=copy([...app.documents]);
    await assert.rejects(app.store.save(schedule('2026-10','10:00'),{readExtra:async tx=>{const request=(await tx.get('staff_requests/request1')).data();if(request.status!=='Pending')throw Error('Already reviewed');}}),/Already reviewed/);
    assert.deepEqual([...app.documents],before);
});

test('30 branches with eight shifts and a full named month stay below the Firestore document budget',()=>{
    const input={currentYear:2026,currentMonth:11,branchConfig:{},currentSchedule:{},employees:[],holidays:{},unavailability:{}};
    for(let branch=0;branch<30;branch++){
        const name=`Franchise Location ${branch}`;input.branchConfig[name]=[];
        for(let shift=0;shift<8;shift++)input.branchConfig[name].push({id:`shift_${shift}`,name:`Morning staff slot ${shift}`,startTime:'09:00',endTime:'18:00',active:true,days:[0,1,2,3,4,5,6],shiftType:'morning'});
        for(let day=1;day<=30;day++){input.currentSchedule[day]||={};input.currentSchedule[day][name]={scheduled:Object.fromEntries(input.branchConfig[name].map(shift=>[shift.id,`Franchise Employee ${branch} ${shift.id}`])),rest:['Staff on weekly rest'],unavailable:[],swaps:{}};}
    }
    const saved=revision(input,'2026-11-01'),size=new TextEncoder().encode(JSON.stringify(saved)).length;
    assert.ok(size<950000,`archive bytes: ${size}`);assert.equal(saved.daySnapshots['2026-11-15'].branchConfig,undefined);
    assert.equal(saved.daySnapshots['2026-11-15'].configRevisionId,saved.revisionId);
    const selected=resolveScheduleForDate({month:'2026-11',revisions:[saved]},'2026-11-15');assert.equal(Object.keys(selected.branchConfig).length,30);assert.equal(Object.keys(selected.currentSchedule).length,1);
});
test('oversized archival payloads fail before any active schedule can be overwritten',()=>{
    const input=schedule('2026-11');input.employees=[{name:'Large',note:'x'.repeat(950000)}];assert.throws(()=>revision(input,'2026-11-01'),/too large to archive/);
});
test('revision sequence resolves simultaneous same-date saves in committed order rather than UUID order',async()=>{
    const app=mock({'settings/global_schedule':schedule()});const first=await app.store.save(schedule('2026-10','10:00'),{revisionId:'zzzz'});
    await app.store.save(schedule('2026-10','11:00'),{revisionId:'aaaa',expectedRevisionId:first.latestRevisionId});
    const history=await app.store.loadRange('2026-10-06','2026-10-06');assert.equal(resolveScheduleForDate(history,'2026-10-06').branchConfig.Maa[0].startTime,'11:00');
});
test('old-client changes are recaptured from today while previously archived rules remain immutable',async()=>{
    const app=mock({'settings/global_schedule':schedule()});const first=await app.store.save(schedule());app.clock=new Date('2026-10-07T02:00:00Z');
    const head=app.documents.get('settings/global_schedule');head.branchConfig.Maa[0].startTime='12:00';
    await app.store.captureCurrent();const history=await app.store.loadRange('2026-10-06','2026-10-07');
    assert.equal(resolveScheduleForDate(history,'2026-10-06').branchConfig.Maa[0].startTime,'09:00');assert.equal(resolveScheduleForDate(history,'2026-10-07').branchConfig.Maa[0].startTime,'12:00');
    assert.equal(app.documents.get(`settings/schedule_revision_${first.latestRevisionId}`).snapshot.branchConfig.Maa[0].startTime,'09:00');
});
