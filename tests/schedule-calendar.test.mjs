import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {planScheduleCalendar,calendarReviewWarnings} from '../takodeal-manager/schedule-calendar.js';
import {createScheduleRevision,createScheduleHistoryStore} from '../takodeal-manager/schedule-history.js';
import {buildMonthlySchedulePlan} from '../takodeal-manager/monthly-schedule-model.js';
import {createOwnerScheduleSync} from '../takodeal-manager/owner-schedule-sync.js';
import {projectScheduleMonth} from '../takodeal-manager/schedule-sync.js';

const clone=structuredClone;
const day=name=>({Cabantian:{scheduled:{morning:name},rest:['Synthetic Standby'],unavailable:[],swaps:{morning:'Synthetic Prior'}}});
function schedule(month='2026-11'){
 const [currentYear,currentMonth]=month.split('-').map(Number);
 return {currentYear,currentMonth,branchConfig:{Cabantian:[{id:'morning',name:'Morning',active:true,days:[0,1,2,3,4,5,6],startTime:'09:00',endTime:'17:30'}]},employees:[],currentSchedule:{1:day('Synthetic Alice'),3:day('Synthetic Bea'),31:day('Synthetic Extra')},unavailability:{'2026-11-03':{'Synthetic Off':'Day Off'}},holidays:{'2026-11-01':'Regular'}};
}
test('reproduces the exact November save failure and proposes a calendar with every excluded row retained',()=>{
 const input=schedule(),before=clone(input);
 assert.throws(()=>createScheduleRevision(input,{revisionId:'synthetic',effectiveFrom:'2026-11-01',savedAt:'2026-10-31T04:00:00Z'}),/A schedule day does not belong to the selected month/);
 const plan=planScheduleCalendar(input);assert.equal(plan.count,30);assert.equal(plan.changed,true);assert.deepEqual(plan.excluded,[{key:'31',reason:'Outside selected month',rows:before.currentSchedule[31]}]);assert.equal(plan.snapshot.currentSchedule[31],undefined);assert.deepEqual(plan.snapshot.currentSchedule[3],before.currentSchedule[3]);assert.deepEqual(plan.snapshot.unavailability,before.unavailability);assert.deepEqual(input,before);
 assert.match(calendarReviewWarnings(plan).join(' '),/2026-11 has 30 days/);assert.match(calendarReviewWarnings(plan).join(' '),/Synthetic Extra/);
 assert.equal(createScheduleRevision(plan.snapshot,{revisionId:'synthetic',effectiveFrom:'2026-11-01',savedAt:'2026-10-31T04:00:00Z'}).month,'2026-11');
});
for(const [month,count]of [['2026-10',31],['2026-11',30],['2027-02',28],['2028-02',29]])test(month+' honors its calendar and never shifts day 31 into another month',()=>{
 const plan=planScheduleCalendar(schedule(month));assert.equal(plan.count,count);assert.equal(plan.excluded.length,count===31?0:1);assert.equal(plan.snapshot.currentMonth,Number(month.slice(-2)));assert.equal(plan.snapshot.currentSchedule[1].Cabantian.scheduled.morning,'Synthetic Alice');
});
test('padded keys normalize only when unambiguous; malformed and duplicate rows remain available in the repair record',()=>{
 const data=schedule();delete data.currentSchedule[31];data.currentSchedule['02']=day('Synthetic Padded');data.currentSchedule['03']=day('Synthetic Duplicate');data.currentSchedule.undefined=day('Synthetic Malformed');
 const plan=planScheduleCalendar(data);assert.deepEqual(plan.renamed,[{from:'02',to:'2'}]);assert.equal(plan.snapshot.currentSchedule[2].Cabantian.scheduled.morning,'Synthetic Padded');assert.equal(plan.snapshot.currentSchedule[3].Cabantian.scheduled.morning,'Synthetic Bea');assert.deepEqual(plan.excluded.map(row=>row.key),['03','undefined']);assert.equal(plan.excluded[0].rows.Cabantian.scheduled.morning,'Synthetic Duplicate');
});
test('monthly prepare keeps valid assignments and exposes the exact extra calendar row for review without mutating the source',()=>{
 const snapshot=schedule(),before=clone(snapshot),plan=buildMonthlySchedulePlan({snapshot,month:'2026-11',branch:'Cabantian',staffProfiles:[],today:'2026-10-31',effectiveFrom:'2026-11-01'});
 assert.equal(plan.calendarRepair.excluded[0].key,'31');assert.match(plan.warnings.join(' '),/Synthetic Extra/);assert.equal(plan.snapshot.currentSchedule[3].Cabantian.scheduled.morning,'Synthetic Bea');assert.equal(plan.snapshot.currentSchedule[31],undefined);assert.deepEqual(snapshot,before);
});

function memoryDrafts(){const records=new Map();return {records,write:async row=>{records.set(row.key,clone(row));return clone(row);},remove:async key=>records.delete(key),list:async()=>[...records.values()].map(clone)};}
function syncFixture(extra={}){
 let snapshot=schedule(),expected=null,selected='2026-11';const draftStore=memoryDrafts(),writes=[],statuses=[];
 const controller=createOwnerScheduleSync({draftStore,now:()=>new Date('2026-10-31T04:00:00Z'),getSnapshot:()=>snapshot,captureEditor:()=>clone(snapshot),getMonth:()=>selected,getIdentity:()=>({uid:'synthetic-co-owner',email:'coowner@example.test',role:'Co-Owner'}),getEffectiveFrom:()=> '2026-11-01',getExpectedRevision:()=>expected,setExpectedRevision:id=>expected=id,readView:async()=>({month:'2026-11',editorSnapshot:clone(snapshot),expectedRevisionId:null,archive:{revisions:[]},hasSavedSchedule:true}),applyView:view=>snapshot=clone(view.editorSnapshot),saveSnapshot:async(value,options)=>{writes.push({value,options});return {revision:{snapshot:value,revisionId:options.revisionId},latestRevisionId:options.revisionId};},onStatus:message=>statuses.push(message),...extra});
 return {controller,draftStore,writes,statuses,get snapshot(){return snapshot;},set snapshot(value){snapshot=value;},set selected(value){selected=value;}};
}
test('calendar validation blocks any server write, while a separately preserved raw backup survives repaired Save Edits',async()=>{
 const f=syncFixture();await f.controller.load();const before=clone(f.snapshot);assert.equal(await f.controller.save(),false);assert.equal(f.writes.length,0);assert.equal(f.controller.lastError().code,'schedule/calendar-review-needed');
 assert.equal(await f.controller.preserveCalendarBackup(),true);assert.equal(await f.controller.preserveCalendarBackup(),true);assert.equal(f.draftStore.records.size,1);
 f.snapshot=planScheduleCalendar(f.snapshot).snapshot;f.controller.markDirty();assert.equal(await f.controller.save(),true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].value.currentSchedule[31],undefined);
 const copies=[...f.draftStore.records.values()].filter(row=>row.editorId.startsWith('calendar-'));assert.equal(copies.length,1);assert.deepEqual(copies[0].editorSnapshot,before);assert.equal(copies[0].pending,null);assert.equal(f.statuses.at(-1),'Saved to shared schedule. Other Owner devices and staff apps can now load this version.');f.controller.stop();
});
test('a mismatched selected month cannot save or re-date a roster',async()=>{
 const f=syncFixture();await f.controller.load();f.snapshot=planScheduleCalendar(f.snapshot).snapshot;f.snapshot.currentMonth=10;assert.equal(await f.controller.save(),false);assert.equal(f.writes.length,0);assert.match(f.statuses.at(-1),/editor month differs/);f.controller.stop();
});
test('a failed calendar backup cannot claim that the original draft was preserved',async()=>{
 const f=syncFixture({draftStore:{write:async()=>{throw Error('Synthetic local storage failure');},list:async()=>[]}});await f.controller.load();assert.equal(await f.controller.preserveCalendarBackup(),false);assert.equal(f.writes.length,0);assert.equal(f.snapshot.currentSchedule[31].Cabantian.scheduled.morning,'Synthetic Extra');f.controller.stop();
});

test('Owner and co-owner save directly through the same version check; a stale second editor cannot overwrite the first',async()=>{
 const initial=schedule();delete initial.currentSchedule[31];const records=new Map([['settings/global_schedule',initial]]);let serial=Promise.resolve(),number=0;
 const snap=value=>({exists:()=>value!==undefined,data:()=>clone(value)});
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async key=>snap(records.get(key)),runTransaction:(_db,work)=>{const next=serial.then(async()=>{const pending=new Map(),result=await work({get:async key=>snap(records.get(key)),set:(key,value)=>pending.set(key,clone(value))});for(const [key,value]of pending)records.set(key,value);return result;});serial=next.catch(()=>{});return next;}};
 const store=createScheduleHistoryStore(api,{now:()=>new Date('2026-10-31T04:00:00Z'),makeId:()=> 'synthetic-'+(++number)});
 function device(uid){let local,expected=null;const controller=createOwnerScheduleSync({draftStore:memoryDrafts(),getIdentity:()=>({uid,email:uid+'@example.test',role:uid==='owner'?'Owner':'Co-Owner'}),getSnapshot:()=>local,getMonth:()=> '2026-11',getEffectiveFrom:()=> '2026-11-01',getExpectedRevision:()=>expected,setExpectedRevision:id=>expected=id,readView:async()=>projectScheduleMonth({month:'2026-11',current:records.get('settings/global_schedule'),archive:await store.loadMonth('2026-11'),now:new Date('2026-10-31T04:00:00Z')}),applyView:view=>local=clone(view.editorSnapshot),saveSnapshot:(value,options)=>store.save(value,{...options,actor:uid}),makeId:()=> uid+'-'+(++number)});return {controller,get snapshot(){return local;}};}
 const owner=device('owner'),coowner=device('co-owner');await owner.controller.load();await coowner.controller.load();coowner.snapshot.currentSchedule[3].Cabantian.scheduled.morning='Synthetic Coowner Edit';assert.equal(await coowner.controller.save(),true);const saved=[...records.values()].find(row=>row.kind==='schedule-revision'&&row.actor==='co-owner'&&row.source==='manager-save');assert.ok(saved);assert.equal(saved.snapshot.currentSchedule[3].Cabantian.scheduled.morning,'Synthetic Coowner Edit');
 owner.snapshot.currentSchedule[3].Cabantian.scheduled.morning='Stale Owner Edit';assert.equal(await owner.controller.save(),false);assert.match(owner.controller.lastError().message,/another session/);assert.equal(owner.snapshot.currentSchedule[3].Cabantian.scheduled.morning,'Stale Owner Edit');assert.equal((await store.loadMonth('2026-11')).latestRevision.actor,'co-owner');owner.controller.stop();coowner.controller.stop();
});

test('actual Save Edits opens calendar review on a known calendar error without announcing a successful save',async()=>{
 const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.saveManualSchedule = '),end=source.indexOf('\n};',start),alerts=[];let opened=0,closed=0;
 const w={captureTempShiftConfig(){},getScheduleMemorySnapshot:()=>({branchConfig:{}}),saveToCloud:async()=>false,getOwnerScheduleSync:()=>({lastError:()=>({code:'schedule/calendar-review-needed'})}),openMonthlySchedule:async()=>opened++};
 vm.runInNewContext(source.slice(start,end+4),{window:w,document:{getElementById:()=>null},Swal:{fire:async value=>alerts.push(value),close:()=>closed++,showLoading(){}},validateShiftConfig(){}});
 assert.equal(await w.saveManualSchedule(),false);assert.equal(opened,1);assert.equal(closed,1);assert.equal(alerts.some(row=>row.icon==='success'),false);
});
