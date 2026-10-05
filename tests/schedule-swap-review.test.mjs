import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApprovedSwapSnapshot,approveScheduleSwap,rejectScheduleSwap} from '../takodeal-manager/schedule-swap-review.js';
import {createScheduleHistoryStore,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';
const at=new Date('2026-10-06T03:00:00Z'),copy=value=>structuredClone(value);
function schedule(){return {currentYear:2026,currentMonth:10,branchConfig:{Maa:[{id:'morning',name:'Morning',startTime:'09:00',endTime:'18:00',active:true,days:[0,1,2,3,4,5,6]},{id:'night',name:'Night',startTime:'18:30',endTime:'03:00',active:true,days:[0,1,2,3,4,5,6]}]},currentSchedule:{5:{Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cam'],unavailable:[],swaps:{}}},6:{Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cam'],unavailable:[],swaps:{}}},7:{Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cam'],unavailable:[],swaps:{}}}},employees:[],unavailability:{},holidays:{}};}
function request(extra={}){return {branch:'Maa',workDate:'2026-10-06',sourceScheduleMonth:'2026-10',sourceRevisionId:null,dateStr:'Tuesday, October 6',dayIndex:6,requesterName:'Ana Example',requesterAssignedName:'Ana',targetName:'Bea',targetAssignedName:'Bea',requesterShiftId:'morning',targetShiftId:'night',status:'Awaiting HQ Approval',acceptanceVersion:1,acceptedByStaffId:'bea-id',...extra};}
function mock(){const docs=new Map([['settings/global_schedule',schedule()],['shift_swaps/swap',request()]]),writes=[];let id=0,queued=Promise.resolve(),denied=false;
 const snap=value=>({exists:()=>value!==undefined,data:()=>copy(value)});
 const api={db:{},sessionUser:{uid:'manager-id',email:'manager@example.com',permissions:['schedule'],allowedBranches:['Maa']},auth:{currentUser:{uid:'manager-id',email:'manager@example.com',emailVerified:true}},doc:(_db,col,id)=>`${col}/${id}`,getDocFromServer:async ref=>snap(docs.get(ref)),serverTimestamp:()=>at.toISOString(),runTransaction(_db,fn){const result=queued.then(async()=>{const pending=new Map();let started=false;const tx={async get(ref){assert.equal(started,false);return snap(docs.get(ref));},set(ref,value){started=true;pending.set(ref,copy(value));}};const value=await fn(tx);if(denied)throw Error('permission-denied');for(const [key,datum]of pending){docs.set(key,datum);writes.push(key);}return value;});queued=result.catch(()=>{});return result;}};
 const store=createScheduleHistoryStore(api,{now:()=>at,makeId:()=>`swap_rev_${++id}`});return {api,store,docs,writes,set denied(value){denied=value;}};
}
test('pure approved swap exchanges exact assignments on one date and preserves past/other days',()=>{
 const before=schedule(),updated=buildApprovedSwapSnapshot(before,request(),at);assert.equal(updated.currentSchedule[6].Maa.scheduled.morning,'Bea');assert.equal(updated.currentSchedule[6].Maa.scheduled.night,'Ana');
 assert.deepEqual(updated.currentSchedule[5],before.currentSchedule[5]);assert.deepEqual(updated.currentSchedule[7],before.currentSchedule[7]);assert.equal(before.currentSchedule[6].Maa.scheduled.morning,'Ana');assert.deepEqual(updated.currentSchedule[6].Maa.swaps,{morning:'Ana',night:'Bea'});
});
test('rest-day swap exchanges one exact standby name and preserves the other working shift',()=>{
 const updated=buildApprovedSwapSnapshot(schedule(),request({targetName:'Cam',targetAssignedName:'Cam',targetShiftId:'STANDBY'}),at);
 assert.equal(updated.currentSchedule[6].Maa.scheduled.morning,'Cam');assert.equal(updated.currentSchedule[6].Maa.scheduled.night,'Bea');assert.deepEqual(updated.currentSchedule[6].Maa.rest,['Ana']);
});
test('past dates, missing ISO work dates, wrong month/day and fuzzy names are rejected',()=>{
 assert.throws(()=>buildApprovedSwapSnapshot(schedule(),request({workDate:'2026-10-05',dayIndex:5}),at),/passed/);
 assert.throws(()=>buildApprovedSwapSnapshot(schedule(),request({workDate:null}),at),/exact work date/);
 assert.throws(()=>buildApprovedSwapSnapshot(schedule(),request({sourceScheduleMonth:'2026-09'}),at),/source schedule month/);
 assert.throws(()=>buildApprovedSwapSnapshot(schedule(),request({dayIndex:7}),at),/calendar day/);
 assert.throws(()=>buildApprovedSwapSnapshot(schedule(),request({requesterAssignedName:'Ana Example'}),at),/exact shift/);
});
test('HQ approval atomically archives the original and updates only the selected work date and swap status',async()=>{
 const app=mock(),result=await approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at});assert.equal(app.docs.get('shift_swaps/swap').status,'Approved');
 assert.equal(app.docs.get('shift_swaps/swap').scheduleRevisionId,result.latestRevisionId);assert.equal(app.docs.get('settings/global_schedule').currentSchedule[6].Maa.scheduled.morning,'Bea');
 const month=await app.store.loadMonth('2026-10');assert.equal(month.revisions.length,2);assert.equal(month.revisions.find(row=>row.source==='legacy-capture').snapshot.currentSchedule[6].Maa.scheduled.morning,'Ana');
 const history=await app.store.loadRange('2026-10-06','2026-10-07');assert.equal(resolveScheduleForDate(history,'2026-10-06').currentSchedule[6].Maa.scheduled.morning,'Bea');assert.equal(resolveScheduleForDate(history,'2026-10-07').currentSchedule[7].Maa.scheduled.morning,'Ana');
 assert.ok(app.writes.every(ref=>ref.startsWith('settings/')||ref.startsWith('shift_swaps/')));assert.ok(!app.writes.some(ref=>/attendance|payroll/.test(ref)));
});
test('future swap approval writes its one-day revision without changing today’s live schedule',async()=>{
 const app=mock();app.docs.set('shift_swaps/swap',request({workDate:'2026-10-07',dayIndex:7}));
 const result=await approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at});assert.equal(result.publishedCurrent,false);assert.equal(app.docs.get('settings/global_schedule').currentSchedule[7].Maa.scheduled.morning,'Ana');
 const history=await app.store.loadRange('2026-10-06','2026-10-07');assert.equal(resolveScheduleForDate(history,'2026-10-07').currentSchedule[7].Maa.scheduled.morning,'Bea');
});
test('limited access, wrong branch and mismatched Google identity cannot approve or reject',async()=>{
 for(const change of [api=>api.sessionUser.permissions=['history'],api=>api.sessionUser.allowedBranches=['Cabantian'],api=>api.auth.currentUser.uid='other',api=>api.auth.currentUser.email='other@example.com']){
  const app=mock();change(app.api);await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/access|account/);await assert.rejects(rejectScheduleSwap(app.api,'swap',{now:()=>at}),/access|account/);assert.equal(app.writes.length,0);
 }
});
test('a stale assignment or unavailable staff prevents archive and approval writes',async()=>{
 const changed=mock();changed.docs.get('settings/global_schedule').currentSchedule[6].Maa.scheduled.morning='Ana Maria';await assert.rejects(approveScheduleSwap(changed.api,'swap',{store:changed.store,now:()=>at}),/exact shift/);assert.equal(changed.writes.length,0);
 const blocked=mock();blocked.docs.get('settings/global_schedule').currentSchedule[6].Maa.unavailable=[{name:'Bea',status:'Vacation'}];await assert.rejects(approveScheduleSwap(blocked.api,'swap',{store:blocked.store,now:()=>at}),/unavailable/);assert.equal(blocked.writes.length,0);
});
test('duplicate approval cannot create a second revision or exchange the staff back',async()=>{
 const app=mock();await approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at});const writes=app.writes.length;
 await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/no longer awaiting/);assert.equal(app.writes.length,writes);assert.equal((await app.store.loadMonth('2026-10')).revisions.length,2);
});
test('rejecting a valid accepted request updates only that request and leaves attendance and schedule intact',async()=>{
 const app=mock(),before=copy(app.docs.get('settings/global_schedule'));await rejectScheduleSwap(app.api,'swap',{reason:'Coverage required',now:()=>at});
 assert.equal(app.docs.get('shift_swaps/swap').status,'Rejected by HQ');assert.equal(app.docs.get('shift_swaps/swap').hqRejectionReason,'Coverage required');assert.deepEqual(app.docs.get('settings/global_schedule'),before);assert.deepEqual(app.writes,['shift_swaps/swap']);
});
test('a permission failure rolls back both the new archive and approved status',async()=>{
 const app=mock(),before=copy([...app.docs]);app.denied=true;await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/permission-denied/);assert.deepEqual([...app.docs],before);assert.equal(app.writes.length,0);
});

test('a concurrent request decision aborts approval before any archive or schedule writes',async()=>{
 const app=mock(),transaction=app.api.runTransaction;let changed=false;app.api.runTransaction=(db,fn)=>{if(!changed){changed=true;app.docs.get('shift_swaps/swap').status='Rejected by HQ';}return transaction(db,fn);};
 await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/no longer awaiting/);assert.equal(app.writes.length,0);assert.equal(app.docs.get('settings/global_schedule').currentSchedule[6].Maa.scheduled.morning,'Ana');
});
test('an old client’s concurrent live rule change is not overwritten by a loaded approval draft',async()=>{
 const app=mock(),transaction=app.api.runTransaction;app.api.runTransaction=(db,fn)=>{app.docs.get('settings/global_schedule').branchConfig.Maa[0].startTime='10:00';return transaction(db,fn);};
 await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/live schedule changed/);assert.equal(app.writes.length,0);assert.equal(app.docs.get('shift_swaps/swap').status,'Awaiting HQ Approval');assert.equal(app.docs.get('settings/global_schedule').branchConfig.Maa[0].startTime,'10:00');
});
test('a request linked to an earlier revision cannot approve against a changed version silently',async()=>{
 const app=mock();const earlier=await app.store.save(schedule());app.docs.get('shift_swaps/swap').sourceRevisionId=earlier.latestRevisionId;
 const revised=schedule();revised.branchConfig.Maa[0].startTime='10:00';await app.store.save(revised,{expectedRevisionId:earlier.latestRevisionId});const count=app.writes.length;
 await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/version changed/);assert.equal(app.writes.length,count);
});
