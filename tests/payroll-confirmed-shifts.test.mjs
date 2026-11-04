import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPayrollPreviewInputs,coordinatePayrollLoad,invalidatePayrollLoad} from '../takodeal-manager/payroll-loading.js';
import {payrollScheduleStamp,assertPayrollScheduleFresh} from '../takodeal-manager/payroll-schedule-freshness.js';
import {captureAttendanceSchedule,resolveAttendanceShift} from '../takodeal-manager/payroll-safety.js';
import {loadStaffPayrollShiftConfirmations} from '../takodeal-staff/payroll-confirmed-shifts.js';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
import {emergencyShiftBounds,emergencyShiftSourceFingerprint} from '../takodeal-manager/emergency-shift-model.js';
const owner='jgo031996@gmail.com',name='Fictional Crew',staffId='fictional-staff',branch='Fictional Branch',inId='fictional-oct23-in',outId='fictional-oct24-out';
const options={start:'2026-10-16',end:'2026-10-31',fetchStartDate:new Date('2026-10-15T00:00:00+08:00'),trueStartDate:new Date('2026-10-16T00:00:00+08:00'),fetchEndDate:new Date('2026-11-01T12:00:00+08:00')};
const snap=docs=>({docs,metadata:{fromCache:false,hasPendingWrites:false},forEach(callback){docs.forEach(callback);}});
function fixture({head=true,paid=false}={}){
 const docs=new Map(),reads=[],queries=[];
 const profile={cashierName:name,branch,active:true,hourlyRate:450},at=new Date('2026-10-23T15:59:00+08:00');
 const plan={currentYear:2026,currentMonth:10,employees:[{id:staffId,name,branch}],branchConfig:{[branch]:[{id:'mid',name:'Mid',shiftType:'mid',startTime:'16:00',endTime:'00:30'},{id:'late-mid',name:'Later Mid',shiftType:'mid',startTime:'17:00',endTime:'01:30'}]},currentSchedule:{23:{[branch]:{scheduled:{mid:'Other Fictional Crew','late-mid':name},rest:[],unavailable:[],swaps:{}}}}};
 const revision=createScheduleRevision(plan,{revisionId:'fictional-saved-october',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:new Date('2026-10-01T00:00:00+08:00')});
 const schedule=assembleScheduleHistory(plan,[{month:'2026-10',revisions:[revision]}],{enforcedFrom:'2026-10-01'});
 const start={staffId,staffName:name,branch,type:'TIME IN',timestamp:at,lateMinutes:57,scheduleSnapshot:captureAttendanceSchedule(at,branch,name,schedule,{[name]:{...profile,staffId}})},out={staffId,staffName:name,branch,type:'TIME OUT',timestamp:new Date('2026-10-24T00:30:00+08:00'),timeInLogId:inId,timeInAt:at,source:'owner-confirmed-time-out',attendanceVersion:2,reliefScheduleReview:{kind:'owner-time-out-correction',version:1,auditId:'fictional-departure-audit'}};
 const bounds=emergencyShiftBounds({workDate:'2026-10-23',startTime:'16:00',endTime:'00:30',shiftName:'Mid',reason:'Assigned hours checked independently with this branch.'},{...start,id:inId});
 const confirmation={schemaVersion:1,status:'Confirmed',revisionId:'fictional-owner-hours-v1',version:1,staffId,staffName:name,branch,timeInLogId:inId,timeInAt:at,workDate:bounds.workDate,expectedStartAt:bounds.expectedStartAt,expectedEndAt:bounds.expectedEndAt,shiftName:bounds.shiftName,sourceFingerprint:emergencyShiftSourceFingerprint({...start,id:inId}),reviewedByUid:'fictional-owner',reviewedByEmail:owner,reviewedAt:new Date('2026-11-04T14:00:00+08:00')};
 docs.set('cashiers/'+staffId,profile);docs.set('attendance_logs/'+inId,start);docs.set('attendance_logs/'+outId,out);if(head)docs.set('attendance_shift_confirmations/'+inId,confirmation);
 if(paid)docs.set('payroll_records/frozen',{staffId,startDate:options.start,endDate:options.end,status:'Paid',finalNetPay:4725.5,frozenData:{staffId,name,isPaid:true,finalNetPay:4725.5}});
 const reference=(table,id)=>({table,id,path:table+'/'+id}),snapshot=ref=>({id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>docs.has(ref.path),data:()=>structuredClone(docs.get(ref.path))});
 const api={db:{},auth:{currentUser:{uid:'fictional-owner',email:owner,emailVerified:true}},sessionUser:{uid:'fictional-owner',email:owner,isOwner:true,permissions:['payroll'],allowedBranches:['All']},isBranchAllowed:()=>true,
  doc:(_db,table,id)=>reference(table,id),collection:(_db,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:()=>({}),query:(ref,...filters)=>({...ref,filters}),
  getDocFromServer:async ref=>{reads.push(ref.path);return snapshot(ref);},
  getDocsFromServer:async ref=>{queries.push(ref);return snap([...docs].filter(([path,data])=>path.startsWith(ref.table+'/')&&(ref.filters||[]).every(({field,op,value})=>!field||op==='=='?(!field||data[field]===value):op==='>='?data[field]>=value:op==='<='?data[field]<=value:false)).map(([path])=>snapshot(reference(ref.table,path.slice(ref.table.length+1)))));},
  loadPayrollScheduleHistory:async()=>structuredClone(schedule)};
 const load=()=>loadPayrollPreviewInputs(api,options),preview=loaded=>({staffId,name,branch,...options,scheduleEvidenceStamp:payrollScheduleStamp(loaded.scheduleData,options)});
 return {docs,reads,queries,api,start,out,confirmation,schedule,load,preview};
}

test('actual payroll loader includes the fresh exact Owner-confirmed overnight hours without changing original punches or late minutes',async()=>{
 const f=fixture(),before=structuredClone([...f.docs]),loaded=await f.load(),saved=loaded.scheduleData.payrollShiftConfirmations[inId];
 assert.equal(saved.expectedStartAt.toISOString(),'2026-10-23T08:00:00.000Z');assert.equal(saved.expectedEndAt.toISOString(),'2026-10-23T16:30:00.000Z');
 assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationErrors,{});assert.equal(loaded.scheduleData.payrollShiftConfirmationEvidence.length,1);assert.match(loaded.scheduleData.payrollShiftConfirmationEvidence[0].sourceFingerprint,/^[a-f0-9]{64}$/);
 assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationEvidence[0].departures.map(row=>row.id),[outId]);assert.deepEqual([...f.docs],before);assert.equal(f.start.lateMinutes,57);
 assert.deepEqual(f.reads,['attendance_shift_confirmations/'+inId]);assert.equal(f.queries.some(row=>row.table==='attendance_shift_confirmations'),false,'no global confirmation query');
 await assertPayrollScheduleFresh(f.api,f.preview(loaded));assert.deepEqual([...f.docs],before);
 const resolved=resolveAttendanceShift({...f.start,id:inId},loaded.scheduleData,{[name]:{...f.docs.get('cashiers/'+staffId),staffId}});
 assert.equal(resolved.payrollHoursConfirmed,true);assert.equal(resolved.expectedStartAt.toISOString(),'2026-10-23T08:00:00.000Z');assert.equal(resolved.lateMinutes,57,'confirmed hours must not waive original lateness');assert.equal(resolved.bonusCategoryVerified,true);
});

test('a saved five-PM confirmation is shown as five PM; the reader never substitutes the earlier requested hours',async()=>{
 const f=fixture();Object.assign(f.confirmation,{expectedStartAt:new Date('2026-10-23T17:00:00+08:00'),expectedEndAt:new Date('2026-10-24T01:30:00+08:00')});
 const loaded=await f.load();assert.equal(loaded.scheduleData.payrollShiftConfirmations[inId].expectedStartAt.getHours(),f.confirmation.expectedStartAt.getHours());assert.equal(loaded.attSnap.docs.find(row=>row.id===outId).data().timestamp.toISOString(),f.out.timestamp.toISOString());
});

for(const mode of ['non-Owner','wrong staff','wrong branch','wrong Time In','stale source','malformed schema','cached response','pending response','failed read'])test(mode+' confirmation becomes an exact employee review hold instead of using stale original hours',async()=>{
 const f=fixture();if(mode==='non-Owner')f.confirmation.reviewedByEmail='manager@example.test';if(mode==='wrong staff')f.confirmation.staffId='other';if(mode==='wrong branch')f.confirmation.branch='Other Branch';if(mode==='wrong Time In')f.confirmation.timeInLogId='other-in';if(mode==='stale source')f.confirmation.sourceFingerprint='wrong';if(mode==='malformed schema')f.confirmation.extra='not in schema';
 if(['cached response','pending response','failed read'].includes(mode)){const read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{if(mode==='failed read')throw Error('Fictional network unavailable');return {...await read(ref),metadata:mode==='cached response'?{fromCache:true}:{hasPendingWrites:true}};};}
 const before=structuredClone([...f.docs]),loaded=await f.load();assert.equal(loaded.scheduleData.payrollShiftConfirmations[inId],undefined);assert.ok(loaded.scheduleData.payrollShiftConfirmationErrors[inId]);assert.equal(loaded.scheduleData.payrollShiftConfirmationEvidence[0].reviewRequired,true);
 await assert.rejects(assertPayrollScheduleFresh(f.api,f.preview(loaded)),/Assigned hours could not be confirmed/);assert.deepEqual([...f.docs],before);
});

test('absence remains baseline behavior, but a later Owner confirmation invalidates the old unpaid preview',async()=>{
 const f=fixture({head:false}),loaded=await f.load(),data=f.preview(loaded);assert.deepEqual(loaded.scheduleData.payrollShiftConfirmations,{});assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationErrors,{});await assertPayrollScheduleFresh(f.api,data);
 f.docs.set('attendance_shift_confirmations/'+inId,f.confirmation);await assert.rejects(assertPayrollScheduleFresh(f.api,data),/Owner-confirmed hours changed/);
});

for(const changed of ['confirmed hours','confirmation version','source Time In','saved lateness decision','actual Time Out','deleted actual Time Out','Time In penalty amount','Time Out penalty amount'])test('a changed '+changed+' after preview blocks payment without rewriting any record',async()=>{
 const f=fixture(),loaded=await f.load(),data=f.preview(loaded);
 if(changed==='confirmed hours')f.confirmation.expectedEndAt=new Date('2026-10-24T01:30:00+08:00');if(changed==='confirmation version')f.confirmation.version=2;if(changed==='source Time In')f.start.timestamp=new Date('2026-10-23T16:05:00+08:00');if(changed==='saved lateness decision')f.start.lateExempted=true;if(changed==='actual Time Out')f.out.timestamp=new Date('2026-10-24T01:00:00+08:00');if(changed==='deleted actual Time Out')f.docs.delete('attendance_logs/'+outId);
 if(changed==='Time In penalty amount')f.start.penaltyAmount=25;if(changed==='Time Out penalty amount')f.out.penaltyAmount=30;
 const before=structuredClone([...f.docs]);await assert.rejects(assertPayrollScheduleFresh(f.api,data),/changed/);assert.deepEqual([...f.docs],before);
});

test('an unrelated attendance photo edit is excluded from the compact financial evidence',async()=>{
 const f=fixture(),loaded=await f.load();f.start.photo='data:image/jpeg;base64,'+'A'.repeat(10000);await assertPayrollScheduleFresh(f.api,f.preview(loaded));assert.ok(f.preview(loaded).scheduleEvidenceStamp.length<100000);assert.doesNotMatch(f.preview(loaded).scheduleEvidenceStamp,/base64/);
});

test('paid stable-ID sources need no confirmation lookup and keep their frozen saved figures',async()=>{
 const f=fixture({paid:true}),before=structuredClone([...f.docs]),loaded=await f.load();assert.deepEqual(f.reads,[]);assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationEvidence,[]);await assertPayrollScheduleFresh({}, {...f.preview(loaded),isPaid:true});assert.deepEqual([...f.docs],before);
});

test('payment rechecks only the selected employee while cross-branch worked records retain their exact identity',async()=>{
 const f=fixture(),loaded=await f.load(),data={...f.preview(loaded),branch:'Fictional Home Branch'};await assertPayrollScheduleFresh(f.api,data);
 f.api.isBranchAllowed=value=>value!==branch;await assert.rejects(assertPayrollScheduleFresh(f.api,data),/confirm the saved assigned hours/);
});

test('an account replacement during confirmation hydration rejects the whole stale run',async()=>{
 const f=fixture(),read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const value=await read(ref);f.api.sessionUser={...f.api.sessionUser};return value;};await assert.rejects(f.load(),/account or branch access changed/);
});

test('an acknowledged correction queues a new same-cutoff run rather than sharing its pre-correction result',async()=>{
 const api={},seen=[];let release;const first=coordinatePayrollLoad(api,{kind:'generate',start:'2026-10-16',end:'2026-10-31'},()=>{seen.push('old');return new Promise(resolve=>{release=resolve;});});
 invalidatePayrollLoad(api);const fresh=coordinatePayrollLoad(api,{kind:'generate',start:'2026-10-16',end:'2026-10-31'},()=>seen.push('fresh'));
 assert.notEqual(first,fresh);assert.deepEqual(seen,['old']);release('old result');await first;await fresh;assert.deepEqual(seen,['old','fresh']);
});
test('a post-save refresh dispatches new dated reads and cannot reuse the pre-save physical schedule flight',async()=>{
 const f=fixture();let resolveOld,loads=0;f.api.loadPayrollScheduleHistory=()=>++loads===1?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(structuredClone(f.schedule));
 const stale=f.load(),rejected=assert.rejects(stale,/Attendance changed/);invalidatePayrollLoad(f.api);f.out.timestamp=new Date('2026-10-24T00:45:00+08:00');
 const refreshed=await f.load();assert.equal(loads,2);assert.equal(refreshed.attSnap.docs.find(row=>row.id===outId).data().timestamp.toISOString(),'2026-10-23T16:45:00.000Z');
 resolveOld(structuredClone(f.schedule));await rejected;await assertPayrollScheduleFresh(f.api,f.preview(refreshed));
});

test('Staff hydration reads only the signed-in employee and selected two-cutoff dates, not all staff or old history',async()=>{
 const f=fixture(),other={...f.start,id:'foreign-in',staffId:'foreign-staff',staffName:'Foreign Crew'},old={...f.start,id:'old-in',timestamp:new Date('2020-01-01T09:00:00+08:00')},before=structuredClone([...f.docs]);
 const schedule=await loadStaffPayrollShiftConfirmations(f.api,{scheduleData:f.schedule,staffId,profile:f.docs.get('cashiers/'+staffId),attendanceRecords:[{...f.start,id:inId},{...f.out,id:outId},other,old],start:options.start,end:options.end});
 assert.deepEqual(f.reads,['attendance_shift_confirmations/'+inId]);assert.equal(schedule.payrollShiftConfirmations[inId].version,1);assert.equal(schedule.payrollShiftConfirmationEvidence.length,1);assert.deepEqual([...f.docs],before);
 const resolved=resolveAttendanceShift({...f.start,id:inId},schedule,{[name]:{...f.docs.get('cashiers/'+staffId),staffId}});assert.equal(resolved.payrollHoursConfirmed,true);
});

test('Staff account changes before the confirmation dispatch cannot start a point read or display old hours',async()=>{
 const f=fixture();let current=true;const pending=loadStaffPayrollShiftConfirmations(f.api,{scheduleData:f.schedule,staffId,profile:f.docs.get('cashiers/'+staffId),attendanceRecords:[{...f.start,id:inId}],start:options.start,end:options.end,assertCurrent:()=>{if(!current)throw Error('Staff account changed');}});current=false;
 await assert.rejects(pending,/Staff account changed/);assert.equal(f.reads.length,0);
});

test('future buffer Time Ins and wholly earlier completed shifts cannot hold this cutoff with unrelated confirmation errors',async()=>{
 const f=fixture(),priorIn={...f.start,timestamp:new Date('2026-10-15T09:00:00+08:00')},priorOut={...f.out,timeInLogId:'prior-in',timestamp:new Date('2026-10-15T17:30:00+08:00')},future={...f.start,timestamp:new Date('2026-11-01T09:00:00+08:00')};
 f.docs.set('attendance_logs/prior-in',priorIn);f.docs.set('attendance_logs/prior-out',priorOut);f.docs.set('attendance_logs/future-in',future);
 for(const id of ['prior-in','future-in'])f.docs.set('attendance_shift_confirmations/'+id,{malformed:true});
 const loaded=await f.load();assert.deepEqual(f.reads,['attendance_shift_confirmations/'+inId]);assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationErrors,{});await assertPayrollScheduleFresh(f.api,f.preview(loaded));
});

test('a legacy shift completed before the cutoff is context only, while an overnight source crossing into the cutoff is retained',async()=>{
 const f=fixture(),priorIn={...f.start,timestamp:new Date('2026-10-15T09:00:00+08:00')},priorOut={...f.out,timestamp:new Date('2026-10-15T17:30:00+08:00')},overnight={...f.start,timestamp:new Date('2026-10-15T18:30:00+08:00')},overnightOut={...f.out,timeInLogId:'overnight-in',timestamp:new Date('2026-10-16T03:00:00+08:00')};delete priorOut.timeInLogId;
 f.docs.set('attendance_logs/prior-in',priorIn);f.docs.set('attendance_logs/prior-out',priorOut);f.docs.set('attendance_logs/overnight-in',overnight);f.docs.set('attendance_logs/overnight-out',overnightOut);
 f.docs.set('attendance_shift_confirmations/prior-in',{malformed:true});f.docs.set('attendance_shift_confirmations/overnight-in',{malformed:true});
 const loaded=await f.load();assert.equal(f.reads.includes('attendance_shift_confirmations/prior-in'),false);assert.equal(f.reads.includes('attendance_shift_confirmations/overnight-in'),true);assert.ok(loaded.scheduleData.payrollShiftConfirmationErrors['overnight-in']);assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationEvidence.find(row=>row.attendanceLogId==='overnight-in').departures.map(row=>row.id),['overnight-out']);
});

for(const change of ['timestamp','penaltyAmount'])test('legacy paired Time Out '+change+' is bound to the unpaid preview and freshly checked before payment',async()=>{
 const f=fixture();delete f.out.timeInLogId;const loaded=await f.load();assert.deepEqual(loaded.scheduleData.payrollShiftConfirmationEvidence[0].departures.map(row=>row.id),[outId]);await assertPayrollScheduleFresh(f.api,f.preview(loaded));
 if(change==='timestamp')f.out.timestamp=new Date('2026-10-24T00:45:00+08:00');else f.out.penaltyAmount=35;
 await assert.rejects(assertPayrollScheduleFresh(f.api,f.preview(loaded)),/actual Time Out changed/);assert.equal(f.docs.size,4);
});
