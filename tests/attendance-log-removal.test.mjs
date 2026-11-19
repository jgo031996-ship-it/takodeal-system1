import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {removeAttendancePunch} from '../takodeal-manager/attendance-log-removal.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import {linkedTimeOutId} from '../takodeal-manager/attendance-reconcile.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';

function setup(){
 const h=firestoreHarness(),api=h.api,id='sample-clock',profile='sample-employee';
 const owner={uid:'owner',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async force=>assert.equal(force,true)};
 Object.assign(api,{auth:{currentUser:owner},sessionUser:{uid:'owner',isOwner:true,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,limit:n=>({limit:n})});
 const doc=api.doc;
 let eventNumber=0;
 api.doc=(db,table,key)=>table===undefined?h.ref(db.table,db.table==='attendance_punch_void_events'?'event'+String(++eventNumber).padStart(15,'0'):'archived-example'):doc(db,table,key);
 api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false}});
 const row={staffName:'Example Person',staffId:profile,branch:'Sample',type:'TIME OUT',timestamp:new Date('2026-11-11T20:59:00+08:00')};
 h.put('attendance_logs/'+id,row);h.put('cashiers/'+profile,{cashierName:row.staffName,branch:'Sample'});
 return {h,id,row,remove:(key=id)=>removeAttendancePunch(api,{...h.get('attendance_logs/'+key),id:key})};
}
test('removal keeps an audit, disappears from unpaid attendance and can be retried after a lost acknowledgement',async()=>{
 const f=setup(),selected={...f.row,id:f.id};f.h.loseNextAck();
 await assert.rejects(f.remove(),/after commit/);
 assert.equal((await removeAttendancePunch(f.h.api,selected)).alreadyRemoved,true);
 const saved=f.h.get('attendance_logs/'+f.id);assert.equal(saved.status,'Voided');assert.equal(saved.voidedByUid,'owner');
 assert.equal(planPayrollAttendance([{...saved,id:f.id}]).logs.length,0);
});
test('the deterministic departure slot is released and its original is archived in the same transaction',async()=>{
 const f=setup(),key=await linkedTimeOutId(f.row.staffId,'start');
 f.h.put('attendance_logs/start',{...f.row,type:'TIME IN',timestamp:new Date('2026-11-11T09:58:00+08:00')});
 f.h.put('attendance_logs/'+key,{...f.row,timeInLogId:'start'});
 f.h.failNextCommit();await assert.rejects(f.remove(key),/rejected/);
 assert.ok(f.h.get('attendance_logs/'+key));assert.equal(f.h.get('attendance_logs/archived-example'),undefined);
 await f.remove(key);assert.equal(f.h.get('attendance_logs/'+key),undefined);
 const audit=f.h.get('attendance_logs/archived-example');assert.equal(audit.originalAttendanceLogId,key);assert.equal(audit.deleted,true);
});
test('paid, OT-linked and changed punches retain their original attendance',async()=>{
 for(const kind of ['paid','bonus','changed','branch']){
  const f=setup(),selected={...f.row,id:f.id};
  if(kind==='paid')f.h.put('payroll_records/saved',{staffName:f.row.staffName,startDate:'2026-11-01',endDate:'2026-11-15',frozenData:{isPaid:true}});
  if(kind==='bonus')f.h.put('staff_bonuses/attendance-ot-'+f.id,{status:'Unpaid',type:'Overtime'});
  if(kind==='changed')selected.timestamp=new Date('2026-11-12T11:00:00Z');
  if(kind==='branch')f.h.api.isBranchAllowed=()=>false;
  await assert.rejects(removeAttendancePunch(f.h.api,selected));assert.equal(f.h.get('attendance_logs/'+f.id).deleted,undefined);
 }
});
test('a mistaken manual departure with a schedule review is voided in place with its saved decision',async()=>{
 const f=setup(),review={version:1,decision:'Approved'};
 f.h.put('attendance_logs/'+f.id,{...f.row,isManual:true,scheduleAmendmentReview:review});
 await f.remove();
 assert.deepEqual(f.h.get('attendance_logs/'+f.id).scheduleAmendmentReview,review);
 assert.equal(f.h.get('attendance_logs/'+f.id).status,'Voided');
});
test('a reviewed start and departure can be removed separately and their original decisions are archived',async()=>{
 const f=setup(),start={...f.row,type:'TIME IN',reliefScheduleReview:{version:1},timestamp:new Date('2026-11-11T14:04:57+08:00')};
 f.h.put('attendance_logs/start',start);
 const key=await linkedTimeOutId(f.row.staffId,'start'),out={...f.row,isManual:true,timeInLogId:'start',timestamp:new Date('2026-11-11T15:30:00+08:00'),scheduleAmendmentReview:{version:1}};
 f.h.put('attendance_logs/'+key,out);
 await assert.rejects(f.remove('start'),/Time Out refers/);
 f.h.failNextCommit();await assert.rejects(f.remove(key),/rejected/);
 assert.deepEqual(f.h.get('attendance_logs/'+key),out);
 const selected={...out,id:key};f.h.loseNextAck();await assert.rejects(f.remove(key),/after commit/);
 assert.equal((await removeAttendancePunch(f.h.api,selected)).alreadyRemoved,true);
 const head=f.h.get('attendance_punch_voids/'+key);
 assert.deepEqual(f.h.get('attendance_punch_void_events/'+head.eventId).original,out);
 assert.deepEqual(f.h.get('attendance_logs/start'),start);assert.equal(f.h.get('attendance_logs/'+key),undefined);
 await f.remove('start');assert.equal(f.h.get('attendance_logs/start'),undefined);
 const startReceipt=f.h.get('attendance_punch_voids/start');assert.notEqual(startReceipt.eventId,head.eventId);
 assert.deepEqual(f.h.get('attendance_punch_void_events/'+startReceipt.eventId).original,start);
 assert.deepEqual(f.h.get('attendance_punch_void_events/'+head.eventId).original,out);
});
test('a reviewed record remains when the cutoff is paid, the caller is a manager, or the row changed',async()=>{
 for(const kind of ['paid','manager','changed','foreign']){
  const f=setup(),row={...f.row,reliefScheduleReview:{version:1}},selected={...row,id:f.id};f.h.put('attendance_logs/'+f.id,row);
  if(kind==='paid')f.h.put('payroll_records/saved',{staffId:f.row.staffId,startDate:'2026-11-01',endDate:'2026-11-15',frozenData:{isPaid:true}});
  if(kind==='manager')f.h.api.sessionUser.isOwner=false;
  if(kind==='foreign')f.h.api.auth.currentUser.email='someone@example.test';
  if(kind==='changed')selected.timestamp=new Date('2026-11-12T11:00:00Z');
  await assert.rejects(removeAttendancePunch(f.h.api,selected));
  assert.deepEqual(f.h.get('attendance_logs/'+f.id),row);assert.equal(f.h.get('attendance_punch_voids/'+f.id),undefined);
 }
});
test('a legacy empty review field and an unpaid orphan Time Out can each be removed',async()=>{
 for(const patch of [{scheduleAmendmentReview:null},{timeInLogId:'missing-start'}]){
  const f=setup();f.h.put('attendance_logs/'+f.id,{...f.row,...patch});await f.remove();assert.equal(f.h.get('attendance_logs/'+f.id).deleted,true);
 }
});
test('an OT award for a legacy unlinked departure still protects its source Time In',async()=>{
 const f=setup();f.h.put('attendance_logs/start',{...f.row,type:'TIME IN'});
 f.h.put('staff_bonuses/granted',{type:'Overtime',timeInLogId:'start',timeOutLogId:f.id,status:'Unpaid'});
 await assert.rejects(f.remove('start'),/OT bonus refers/);
 assert.equal(f.h.get('attendance_logs/start').deleted,undefined);
});
