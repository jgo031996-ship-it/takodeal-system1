import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlySchedulePlan} from '../takodeal-manager/monthly-schedule-model.js';
import {scheduleLeaveMarkerIds,openSavedScheduleLeave} from '../takodeal-manager/schedule-leave-markers.js';
import {toScheduleEmployee} from '../takodeal-manager/schedule-staff-directory.js';

const clone=value=>structuredClone(value);
const day=()=>({scheduled:{},rest:[],unavailable:[],swaps:{}});
const shift=(extra={})=>({id:'day',name:'Day',active:true,days:[0,1,2,3,4,5,6],startTime:'09:00',endTime:'17:30',...extra});
function fixture(branch='Maa'){
 const staffProfiles=['Alice','Bea','Cora'].map((name,i)=>toScheduleEmployee({cashierName:'Synthetic '+branch+' '+name,branch,active:true},'synthetic-'+branch+'-'+i));
 const person=staffProfiles[0],marker={name:person.name,status:'Leave',staffId:person.staffId,leaveRequestId:'synthetic-leave'};
 const snapshot={currentYear:2026,currentMonth:11,branchConfig:{Maa:[shift()],Agdao:[shift()]},employees:staffProfiles,currentSchedule:{1:{[branch]:day()},5:{[branch]:day()}},unavailability:{},holidays:{}};
 snapshot.currentSchedule[1][branch].unavailable=[clone(marker)];snapshot.unavailability['2026-11-01']={[person.name]:clone(marker)};
 const record={type:'Leave',status:'Approved',staffId:person.staffId,staffName:person.name,branch,startDate:'2026-11-01',endDate:'2026-11-01'};
 return {snapshot,month:'2026-11',branch,staffProfiles,approvedLeaves:[],sanctions:[],leaveSources:[{id:marker.leaveRequestId,record}],today:'2026-10-31',effectiveFrom:'2026-11-01',mode:'auto',person,marker};
}

for(const branch of ['Maa','Agdao'])for(const state of ['Rejected','Withdrawn','Cancelled','historical','cancelled dates','deleted'])test(branch+': '+state+' linked November marker is released only in the proposed draft',()=>{
 const data=fixture(branch),source=data.leaveSources[0];
 if(state==='deleted')source.record=null;
 else if(state==='historical'){source.record.startDate='2026-10-01';source.record.endDate='2026-10-02';}
 else if(state==='cancelled dates')source.record.activeLeaveDates=[];
 else source.record.status=state;
 const before=clone(data),plan=buildMonthlySchedulePlan(data);
 assert.deepEqual(data,before);assert.equal(plan.releasedLeaveMarkers.length,1);assert.equal(plan.snapshot.unavailability['2026-11-01'],undefined);
 assert.deepEqual(plan.snapshot.currentSchedule[1][branch].unavailable,[]);assert.equal(plan.assignments.some(row=>row.date==='2026-11-01'&&row.staffId===data.person.staffId),true);
 assert.match(plan.warnings.join(' '),/synthetic-leave.*local draft/);
});
test('approved leave and a newer manual Day Off remain protected when a different marker is stale',()=>{
 const data=fixture();data.leaveSources[0].record.status='Rejected';data.snapshot.currentSchedule[1].Maa.unavailable.push({name:data.person.name,status:'Day Off'});
 data.snapshot.unavailability['2026-11-01'][data.person.name]='Day Off';
 const plan=buildMonthlySchedulePlan(data);assert.equal(plan.snapshot.unavailability['2026-11-01'][data.person.name],'Day Off');assert.equal(plan.snapshot.currentSchedule[1].Maa.unavailable[0].status,'Day Off');assert.equal(plan.assignments.some(row=>row.date==='2026-11-01'&&row.staffId===data.person.staffId),false);
 const approved=fixture();approved.approvedLeaves=[{id:'synthetic-leave',...approved.leaveSources[0].record}];const active=buildMonthlySchedulePlan(approved);assert.equal(active.releasedLeaveMarkers.length,0);assert.equal(active.assignments.some(row=>row.date==='2026-11-01'&&row.staffId===approved.person.staffId),false);
});
test('a second approved leave still blocks assignment after the first rejected marker is released',()=>{
 const data=fixture();data.leaveSources[0].record.status='Rejected';data.approvedLeaves=[{...data.leaveSources[0].record,id:'second-active',status:'Approved'}];const plan=buildMonthlySchedulePlan(data);
 assert.equal(plan.releasedLeaveMarkers.length,1);assert.equal(plan.assignments.some(row=>row.date==='2026-11-01'&&row.staffId===data.person.staffId),false);assert.equal(plan.snapshot.currentSchedule[1].Maa.unavailable[0].leaveRequestId,'second-active');
});
test('recovery never changes an earlier date, another branch row, a swap note or a request record',()=>{
 const data=fixture();data.leaveSources[0].record.status='Rejected';data.snapshot.currentSchedule[1].Agdao=day();data.snapshot.currentSchedule[1].Maa.swaps={legacy:'Keep this note'};
 const before=clone(data),plan=buildMonthlySchedulePlan({...data,effectiveFrom:'2026-11-05'});assert.deepEqual(plan.snapshot.currentSchedule[1],before.snapshot.currentSchedule[1]);assert.deepEqual(plan.snapshot.unavailability,before.snapshot.unavailability);assert.equal(plan.releasedLeaveMarkers.length,0);assert.deepEqual(data,before);
});
for(const conflict of ['missing ID','different ID','ambiguous name','malformed dates','pending decision'])test('recovery holds '+conflict+' without releasing or guessing a recipient',()=>{
 const data=fixture(),source=data.leaveSources[0].record;source.status='Rejected';
 if(conflict==='missing ID')data.staffProfiles=[];
 if(conflict==='different ID')source.staffId='another-person';
 if(conflict==='ambiguous name')data.staffProfiles.push({...data.person,staffId:'namesake'});
 if(conflict==='malformed dates'){source.status='Approved';source.activeLeaveDates=['invalid'];}
 if(conflict==='pending decision')source.status='Pending';
 const before=clone(data);assert.throws(()=>buildMonthlySchedulePlan(data));assert.deepEqual(data,before);
});
test('absent source evidence cannot authorize removing a saved marker',()=>{
 const data=fixture();data.leaveSources=[];const plan=buildMonthlySchedulePlan(data);assert.equal(plan.releasedLeaveMarkers.length,0);assert.equal(plan.assignments.some(row=>row.date==='2026-11-01'&&row.staffId===data.person.staffId),false);
});
test('Agdao opening review starts November 5 and respects inactive shifts and weekdays',()=>{
 const data=fixture('Agdao');data.snapshot.branchConfig.Agdao=[shift({days:[1,2,3,4,5,6]}),shift({id:'night',active:false,startTime:'20:00',endTime:'04:00'})];
 const before=clone(data.snapshot.currentSchedule[1]),plan=buildMonthlySchedulePlan({...data,effectiveFrom:'2026-11-05'});assert.equal(plan.days.length,26);assert.equal(plan.days[0].date,'2026-11-05');assert.deepEqual(plan.snapshot.currentSchedule[1],before);assert.equal(plan.snapshot.currentSchedule[8].Agdao.scheduled.day,'N/A');assert.equal(plan.snapshot.currentSchedule[5].Agdao.scheduled.night,undefined);
});
test('automatic assignment avoids a previous overnight shift and reports preserved cross-branch duplicates',()=>{
 const data=fixture('Agdao');data.snapshot.currentSchedule={4:{Maa:{...day(),scheduled:{day:data.person.name}}},5:{Agdao:day()}};data.snapshot.unavailability={};data.snapshot.branchConfig.Maa=[shift({startTime:'22:00',endTime:'10:00'})];
 const plan=buildMonthlySchedulePlan({...data,effectiveFrom:'2026-11-05'});assert.equal(plan.assignments.some(row=>row.date==='2026-11-05'&&row.staffId===data.person.staffId),false);
 data.snapshot.currentSchedule[5].Agdao.scheduled.day=data.person.name;data.snapshot.currentSchedule[5].Maa={...day(),scheduled:{day:data.person.name}};
 const conflict=buildMonthlySchedulePlan({...data,effectiveFrom:'2026-11-05'});assert.equal(conflict.snapshot.currentSchedule[5].Agdao.scheduled.day,data.person.name);assert.match(conflict.conflicts.map(row=>row.reason).join(' '),/duplicate|overlap/);
});
test('source reads are scoped to the reviewed work dates and selected branch and are deduplicated',()=>{
 const data=fixture(),ids=scheduleLeaveMarkerIds(data.snapshot,{branch:'Maa',from:'2026-11-01',to:'2026-11-30'});assert.deepEqual(ids,['synthetic-leave']);assert.deepEqual(scheduleLeaveMarkerIds(data.snapshot,{branch:'Maa',from:'2026-11-05',to:'2026-11-30'}),[]);
});

function guardFixture(record,metadata={fromCache:false,hasPendingWrites:false}){
 const calls={opened:0,cancel:[],notices:[],writes:0};let current=true;
 const w={db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:async()=>({exists:()=>record!==null,data:()=>record,metadata}),openMonthlySchedule:async()=>calls.opened++,getManagerLeaveUI:()=>({change:(...args)=>calls.cancel.push(args)}),ManagerUI:{notify:message=>calls.notices.push(message)},setDoc:()=>{calls.writes++;assert.fail('No business writes permitted');}};
 return {w,calls,options:{marker:{leaveRequestId:'synthetic-leave'},date:'2026-11-01',isCurrent:()=>current},invalidate:()=>current=false};
}
for(const status of ['Rejected','Cancelled','missing'])test('manual roster guard routes '+status+' source to a separate local monthly review without saving',async()=>{
 const f=guardFixture(status==='missing'?null:{type:'Leave',status});await openSavedScheduleLeave(f.w,f.options);assert.equal(f.calls.opened,1);assert.equal(f.calls.cancel.length,0);assert.equal(f.calls.writes,0);assert.match(f.calls.notices[0],/local draft.*Save Edits/);
});
test('manual guard keeps current approved leave in its explicit cancellation workflow',async()=>{
 const f=guardFixture({type:'Leave',status:'Approved',startDate:'2026-11-01',endDate:'2026-11-02'});await openSavedScheduleLeave(f.w,f.options);assert.equal(f.calls.opened,0);assert.deepEqual(f.calls.cancel,[['synthetic-leave','Cancel',{date:'2026-11-01'}]]);assert.equal(f.calls.writes,0);
});
test('cached or obsolete manual reviews cannot release a marker or open another account review',async()=>{
 for(const obsolete of [true,false]){const f=guardFixture(null,{fromCache:!obsolete,hasPendingWrites:false});if(obsolete)f.invalidate();await openSavedScheduleLeave(f.w,f.options);assert.equal(f.calls.opened,0);assert.equal(f.calls.cancel.length,0);assert.equal(f.calls.writes,0);}
});
