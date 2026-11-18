import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {removeAttendancePunch} from '../takodeal-manager/attendance-log-removal.js';
import {linkedTimeOutId} from '../takodeal-manager/attendance-reconcile.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';

function setup(){
 const h=firestoreHarness(),api=h.api,id='sample-clock',profile='sample-employee';
 const owner={uid:'owner',email:'owner@example.test',getIdToken:async force=>assert.equal(force,true)};
 Object.assign(api,{auth:{currentUser:owner},sessionUser:{uid:'owner',isOwner:true,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,limit:n=>({limit:n})});
 const doc=api.doc;
 api.doc=(db,table,key)=>table===undefined?h.ref(db.table,'archived-example'):doc(db,table,key);
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
test('paid, reviewed, OT-linked and changed punches retain their original attendance',async()=>{
 for(const kind of ['paid','review','bonus','changed','branch']){
  const f=setup(),selected={...f.row,id:f.id};
  if(kind==='paid')f.h.put('payroll_records/saved',{staffName:f.row.staffName,startDate:'2026-11-01',endDate:'2026-11-15',frozenData:{isPaid:true}});
  if(kind==='review')f.h.put('attendance_logs/'+f.id,{...f.row,scheduleAmendmentReview:{version:1}});
  if(kind==='bonus')f.h.put('staff_bonuses/attendance-ot-'+f.id,{status:'Unpaid',type:'Overtime'});
  if(kind==='changed')selected.timestamp=new Date('2026-11-12T11:00:00Z');
  if(kind==='branch')f.h.api.isBranchAllowed=()=>false;
  await assert.rejects(removeAttendancePunch(f.h.api,selected));assert.equal(f.h.get('attendance_logs/'+f.id).deleted,undefined);
 }
});
test('a linked start and a departure reviewed for branch cover report the specific blocking record',async()=>{
 const f=setup();
 f.h.put('attendance_logs/start',{...f.row,type:'TIME IN',reliefScheduleReview:{version:1}});
 f.h.put('attendance_logs/'+f.id,{...f.row,timeInLogId:'start'});
 await assert.rejects(f.remove(),/HR-reviewed cover shift/);
 f.h.put('attendance_logs/start',{...f.row,type:'TIME IN'});
 await assert.rejects(f.remove('start'),/saved Time Out refers/);
});
test('an OT award for a legacy unlinked departure still protects its source Time In',async()=>{
 const f=setup();f.h.put('attendance_logs/start',{...f.row,type:'TIME IN'});
 f.h.put('staff_bonuses/granted',{type:'Overtime',timeInLogId:'start',timeOutLogId:f.id,status:'Unpaid'});
 await assert.rejects(f.remove('start'),/OT bonus refers/);
 assert.equal(f.h.get('attendance_logs/start').deleted,undefined);
});
