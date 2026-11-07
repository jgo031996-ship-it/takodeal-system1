import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApprovedSwapSnapshot,approveScheduleSwap,rejectScheduleSwap} from '../takodeal-manager/schedule-swap-review.js';
import {createScheduleHistoryStore,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';
import {SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION} from '../takodeal-manager/schedule-swap-model.js';
const at=new Date('2026-10-06T03:00:00Z'),copy=value=>structuredClone(value);
function schedule(){return {currentYear:2026,currentMonth:10,branchConfig:{Maa:[{id:'morning',name:'Morning',startTime:'09:00',endTime:'18:00',active:true,days:[0,1,2,3,4,5,6]},{id:'night',name:'Night',startTime:'18:30',endTime:'03:00',active:true,days:[0,1,2,3,4,5,6]}]},currentSchedule:{5:{Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cam'],unavailable:[],swaps:{}}},6:{Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cam'],unavailable:[],swaps:{}}},7:{Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cam'],unavailable:[],swaps:{}}}},employees:[],unavailability:{},holidays:{}};}
function request(extra={}){return {branch:'Maa',workDate:'2026-10-06',sourceScheduleMonth:'2026-10',sourceRevisionId:null,dateStr:'Tuesday, October 6',dayIndex:6,requesterName:'Ana Example',requesterAssignedName:'Ana',targetName:'Bea',targetAssignedName:'Bea',requesterStaffId:'ana-id',targetStaffId:'bea-id',requesterShiftId:'morning',targetShiftId:'night',status:'Awaiting HQ Approval',acceptanceVersion:1,acceptedByStaffId:'bea-id',...extra};}
function mock(){const docs=new Map([['settings/global_schedule',schedule()],['shift_swaps/swap',request()],['cashiers/ana-id',{cashierName:'Ana Example',scheduleNickname:'Ana',branch:'Maa',status:'Active'}],['cashiers/bea-id',{cashierName:'Bea',branch:'Maa',status:'Active'}]]),writes=[];let id=0,queued=Promise.resolve(),denied=false;
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

function crossBranch(app,{standby=false}={}){
 const snapshot=app.docs.get('settings/global_schedule');snapshot.branchConfig.Cabantian=[{id:'morning',name:'Cabantian Day',startTime:'10:00',endTime:'18:00',active:true,days:[0,1,2,3,4,5,6]}];
 snapshot.employees=[{staffId:'ana-id',cashierName:'Ana Example',scheduleNickname:'Ana',branch:'Maa'},{staffId:'bea-id',cashierName:'Bea',branch:'Cabantian'},{staffId:'cam-id',cashierName:'Cam',branch:'Maa'}];
 snapshot.currentSchedule[6].Maa.scheduled.night='UNFILLED';snapshot.currentSchedule[6].Cabantian={scheduled:{morning:standby?'UNFILLED':'Bea'},rest:standby?['Bea']:[],unavailable:[],swaps:{},savedNote:'preserve'};
 app.docs.set('shift_swaps/swap',request({targetBranch:'Cabantian',targetShiftId:standby?'STANDBY':'morning'}));app.api.sessionUser.allowedBranches=['Maa','Cabantian'];app.docs.get('cashiers/bea-id').branch='Cabantian';return snapshot;
}
test('HQ approval atomically exchanges cross-branch slots with equal shift IDs',async()=>{
 const app=mock(),before=copy(crossBranch(app));await approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at});const after=app.docs.get('settings/global_schedule');
 assert.equal(after.currentSchedule[6].Maa.scheduled.morning,'Bea');assert.equal(after.currentSchedule[6].Cabantian.scheduled.morning,'Ana');assert.equal(after.currentSchedule[6].Cabantian.savedNote,'preserve');assert.deepEqual(after.currentSchedule[5],before.currentSchedule[5]);assert.equal(app.docs.get('cashiers/bea-id').branch,'Cabantian');assert.equal(app.docs.get('shift_swaps/swap').status,'Approved');assert.ok(app.writes.every(ref=>ref.startsWith('settings/')||ref.startsWith('shift_swaps/')));
});
test('HQ cross-branch standby approval places requester on original-branch rest',async()=>{
 const app=mock();crossBranch(app,{standby:true});await approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at});const day=app.docs.get('settings/global_schedule').currentSchedule[6];assert.equal(day.Maa.scheduled.morning,'Bea');assert.deepEqual(day.Maa.rest,['Cam','Ana']);assert.deepEqual(day.Cabantian.rest,[]);
});
test('cross-branch approval and rejection require authority for both branches',async()=>{
 for(const branches of [['Maa'],['Cabantian']]){const app=mock();crossBranch(app);app.api.sessionUser.allowedBranches=branches;await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/access/);await assert.rejects(rejectScheduleSwap(app.api,'swap',{now:()=>at}),/access/);assert.equal(app.writes.length,0);}
});
test('fresh participant profiles block revoked accounts and mismatched acceptance IDs',async()=>{
 for(const change of [app=>app.docs.get('cashiers/bea-id').blocked=true,app=>app.docs.get('cashiers/ana-id').status='Inactive',app=>app.docs.delete('cashiers/bea-id'),app=>app.docs.get('shift_swaps/swap').acceptedByStaffId='someone-else']){const app=mock();crossBranch(app);change(app);await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/active|account links/);assert.equal(app.writes.length,0);assert.equal(app.docs.get('shift_swaps/swap').status,'Awaiting HQ Approval');}
});
test('a participant becoming blocked immediately before the transaction prevents all writes',async()=>{
 const app=mock();crossBranch(app);const run=app.api.runTransaction;app.api.runTransaction=(db,fn)=>{app.docs.get('cashiers/bea-id').pin='BLOCKED';return run(db,fn);};await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/no longer active/);assert.equal(app.writes.length,0);
});
test('concurrent target branch and identity edits are included in the review fingerprint',async()=>{
 for(const change of [request=>request.targetBranch='Citygate',request=>request.targetStaffId='new-id',request=>request.requesterStaffId='new-id']){const app=mock();crossBranch(app);app.api.sessionUser.allowedBranches=['All'];const run=app.api.runTransaction;app.api.runTransaction=(db,fn)=>{change(app.docs.get('shift_swaps/swap'));return run(db,fn);};await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/request changed/);assert.equal(app.writes.length,0);}
});
test('legacy same-branch target link uses exact accepted staff identity; unbound requester requires resend',async()=>{
 const legacy=mock();delete legacy.docs.get('shift_swaps/swap').targetStaffId;await approveScheduleSwap(legacy.api,'swap',{store:legacy.store,now:()=>at});assert.equal(legacy.docs.get('shift_swaps/swap').status,'Approved');
 const unbound=mock();delete unbound.docs.get('shift_swaps/swap').requesterStaffId;await assert.rejects(approveScheduleSwap(unbound.api,'swap',{store:unbound.store,now:()=>at}),/resend/);assert.equal(unbound.writes.length,0);
});
test('cross-branch HQ approval rejects standby already working elsewhere',async()=>{
 const app=mock();crossBranch(app,{standby:true});app.docs.get('settings/global_schedule').currentSchedule[6].Maa.scheduled.night='Bea';await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/already has/);assert.equal(app.writes.length,0);
});
test('HQ month-boundary approval requires the next saved month and rechecks its evidence atomically',async()=>{
 const app=mock(),snapshot=crossBranch(app);Object.assign(snapshot.branchConfig.Cabantian[0],{startTime:'18:00',endTime:'01:00'});snapshot.currentSchedule[31]=copy(snapshot.currentSchedule[6]);app.docs.set('shift_swaps/swap',request({targetBranch:'Cabantian',targetShiftId:'morning',workDate:'2026-10-31',dayIndex:31}));
 await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/adjacent/);assert.equal(app.writes.length,0);
 const next=copy(snapshot);next.currentMonth=11;next.currentSchedule={1:{},2:{}};const saved=await app.store.save(next,{effectiveFrom:'2026-11-01'}),before=app.writes.length;
 const run=app.api.runTransaction;app.api.runTransaction=(db,fn)=>{const revision=app.docs.get('settings/schedule_revision_'+saved.latestRevisionId);revision.snapshot.branchConfig.Cabantian[0].startTime='17:00';return run(db,fn);};
 await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/adjacent saved schedule changed/);assert.equal(app.writes.length,before);assert.equal(app.docs.get('shift_swaps/swap').status,'Awaiting HQ Approval');
});
test('HQ month-end daytime approval needs no following-month publication or read',async()=>{
 for(const endTime of ['18:00','00:00']){const app=mock(),snapshot=crossBranch(app);snapshot.currentMonth=11;snapshot.currentSchedule={29:{},30:copy(snapshot.currentSchedule[6])};Object.assign(snapshot.branchConfig.Cabantian[0],{startTime:'10:00',endTime});app.docs.set('shift_swaps/swap',request({targetBranch:'Cabantian',targetShiftId:'morning',workDate:'2026-11-30',sourceScheduleMonth:'2026-11',dayIndex:30}));
  const reads=[],get=app.api.getDocFromServer,run=app.api.runTransaction;app.api.getDocFromServer=async ref=>{reads.push(ref);return get(ref);};app.api.runTransaction=(db,fn)=>run(db,tx=>fn({...tx,get:async ref=>{reads.push(ref);return tx.get(ref);}}));const store=createScheduleHistoryStore(app.api,{now:()=>at,makeId:(()=>{let i=0;return()=>`monthend-${++i}`;})()});
  await approveScheduleSwap(app.api,'swap',{store,now:()=>at});assert.equal(app.docs.get('shift_swaps/swap').status,'Approved');assert.ok(!reads.some(ref=>ref.includes('schedule_month_2026_12')||ref.includes('schedule_shift_amendments_2026_12')));const archive=await store.loadMonth('2026-11');assert.equal(archive.latestRevision.snapshot.currentSchedule[30].Cabantian.scheduled.morning,'Ana');
 }
});
test('HQ atomically approves a versioned request from the new staff acceptance flow',async()=>{
 const app=mock();crossBranch(app);Object.assign(app.docs.get('shift_swaps/swap'),{status:SWAP_REVIEW_STATUS,requestVersion:SWAP_REQUEST_VERSION});const result=await approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),request=app.docs.get('shift_swaps/swap');
 assert.equal(request.status,'Approved');assert.equal(request.requestVersion,2);assert.equal(request.scheduleRevisionId,result.latestRevisionId);assert.equal(app.docs.get('settings/global_schedule').currentSchedule[6].Cabantian.scheduled.morning,'Ana');assert.equal((await app.store.loadMonth('2026-10')).latestRevisionId,result.latestRevisionId);
});
test('HQ rejects malformed versioned review states without any record writes',async()=>{
 for(const [status,requestVersion]of [[SWAP_REVIEW_STATUS,undefined],[SWAP_REVIEW_STATUS,1],[SWAP_REVIEW_STATUS,3],[SWAP_REVIEW_STATUS,'2'],['Awaiting HQ Approval',2]]){const app=mock();Object.assign(app.docs.get('shift_swaps/swap'),{status,requestVersion});const before=copy([...app.docs]);await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/request version/);await assert.rejects(rejectScheduleSwap(app.api,'swap',{now:()=>at}),/request version/);assert.equal(app.writes.length,0);assert.deepEqual([...app.docs],before);}
});
test('a versioned request cannot switch to the legacy protocol while HQ is reviewing',async()=>{
 const app=mock();crossBranch(app);Object.assign(app.docs.get('shift_swaps/swap'),{status:SWAP_REVIEW_STATUS,requestVersion:SWAP_REQUEST_VERSION});const run=app.api.runTransaction;app.api.runTransaction=(db,fn)=>{const request=app.docs.get('shift_swaps/swap');delete request.requestVersion;request.status='Awaiting HQ Approval';return run(db,fn);};await assert.rejects(approveScheduleSwap(app.api,'swap',{store:app.store,now:()=>at}),/request changed/);assert.equal(app.writes.length,0);
});
