import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {attendanceMillis,attendanceKind,belongsToAttendance,readStaffRecords,latestAttendance,linkedAttendanceHistory,sopCoversShift,linkedTimeOutId,closeAttendanceShift} from '../takodeal-staff/attendance-reconcile.js';

const time=value=>new Date(value);
const start={id:'cashier-in',staffId:'employee-1',staffName:'Original Name',branch:'Maa',type:'TIME IN',timestamp:time('2026-10-06T22:00:00+08:00'),sourceApp:'cashier'};
const out={staffId:'employee-1',staffName:'Renamed Staff',branch:'Maa',type:'TIME OUT',timestamp:time('2026-10-07T06:00:00+08:00'),sourceApp:'staff'};
function fixture(){const h=firestoreHarness();h.put('attendance_logs/'+start.id,start);h.put('cashiers/employee-1',{cashierName:'Renamed Staff'});h.put('payroll_records/paid',{status:'Paid',netPay:999,attendanceIds:[start.id]});return h;}

test('both apps ship byte-identical cross-app attendance rules',()=>{
    assert.equal(readFileSync(new URL('../takodeal-staff/attendance-reconcile.js',import.meta.url),'utf8'),readFileSync(new URL('../Takodeal-POS/attendance-reconcile.js',import.meta.url),'utf8'));
});
test('employee ID survives a rename and excludes another person with the same display name',async()=>{
    const h=fixture();h.put('attendance_logs/other',{...start,id:'other',staffId:'employee-2',staffName:'Renamed Staff'});
    const reads=[],server=h.api.getDocsFromServer;h.api.getDocsFromServer=q=>{reads.push(q);return server(q);};
    const rows=await readStaffRecords(h.api,'employee-1','Renamed Staff');assert.deepEqual(rows.map(row=>row.id),['cashier-in']);
    assert.deepEqual(reads.map(q=>q.filters[0].key),['staffId','staffName']);assert.equal(latestAttendance(rows,'employee-1','Renamed Staff',+out.timestamp).id,start.id);
    assert.equal(belongsToAttendance({staffId:'employee-2',staffName:'Renamed Staff'},'employee-1',['Renamed Staff']),false);
});
test('exact legacy names work only when the directory maps the name uniquely to this staff ID',async()=>{
    const h=fixture();h.put('attendance_logs/legacy',{staffName:'Renamed Staff',branch:'Maa',type:'TIME IN',timestamp:start.timestamp});
    h.put('attendance_logs/substring',{staffName:'Renamed Staff Jr',type:'TIME IN',timestamp:start.timestamp});
    let rows=await readStaffRecords(h.api,'employee-1','Renamed Staff');assert.equal(rows.some(row=>row.id==='legacy'),true);assert.equal(rows.some(row=>row.id==='substring'),false);
    h.put('cashiers/employee-2',{cashierName:'Renamed Staff'});await assert.rejects(readStaffRecords(h.api,'employee-1','Renamed Staff'),/legacy name-only/);
});
test('cached attendance is never accepted when a fresh cross-app verification fails',async()=>{
    const h=fixture();h.api.getDocs=()=>({docs:[{id:start.id,data:()=>start}]});h.api.getDocsFromServer=()=>Promise.reject(Error('offline'));
    await assert.rejects(readStaffRecords(h.api,'employee-1','Renamed Staff'),/confirmed with HQ/);
});
test('unknown timestamps cannot create a current or phantom punch; supported timestamps preserve the exact time',()=>{
    const exact=+start.timestamp;for(const value of [start.timestamp,start.timestamp.toISOString(),{seconds:exact/1000}, {toMillis:()=>exact},{toDate:()=>start.timestamp}])assert.equal(attendanceMillis(value),exact);
    for(const value of [null,undefined,'broken',{seconds:'1'},{toDate:()=>{throw Error('invalid');}}]){
        assert.ok(Number.isNaN(attendanceMillis(value)));assert.throws(()=>latestAttendance([{...start,timestamp:value}],'employee-1','Renamed Staff',+out.timestamp),/timestamp/);
    }
    assert.throws(()=>latestAttendance([{...start,timestamp:new Date(+out.timestamp+120000)}],'employee-1','Renamed Staff',+out.timestamp),/ahead/);
});
test('known auto and explicitly manual punches are recognized; arbitrary strings are not attendance',()=>{
    assert.equal(attendanceKind({type:'AUTO TIME OUT (Penalty)'}),'TIME OUT');assert.equal(attendanceKind({type:'TIME OUT (AUTO)'}),'TIME OUT');
    assert.equal(attendanceKind({type:'TIME IN (Manual Edit: System Error)',isManual:true}),'TIME IN');
    assert.equal(attendanceKind({type:'TIME IN (Manual Edit: System Error)'}),'');assert.equal(attendanceKind({type:'NOT TIME IN'}),'');
});
test('overnight SOP is checked against the Time In workday, employee and branch, including a linked shift ID',()=>{
    const beforeMidnight={staffId:'employee-1',staffName:'Renamed Staff',branch:'Maa',timestamp:time('2026-10-06T23:30:00+08:00')};
    assert.equal(sopCoversShift([beforeMidnight],start,'employee-1','Renamed Staff',+out.timestamp),true);
    for(const patch of [{branch:'Cabantian'},{staffId:'employee-2'},{timestamp:time('2026-10-05T23:59:00+08:00')},{timestamp:null},{timeInLogId:'another-shift'}])assert.equal(sopCoversShift([{...beforeMidnight,...patch}],start,'employee-1','Renamed Staff',+out.timestamp),false);
});
test('the same active shift has the same Time Out ID across apps, while another shift differs',async()=>{
    assert.equal(await linkedTimeOutId('employee-1',start.id),await linkedTimeOutId('employee-1',start.id));assert.notEqual(await linkedTimeOutId('employee-1',start.id),await linkedTimeOutId('employee-1','later-in'));
});
test('Cashier Time In can be closed from Staff without changing original, manual or frozen payroll records',async()=>{
    const h=fixture();h.put('attendance_logs/manual',{...start,id:'manual',type:'TIME OUT (Manual Edit: HR)',isManual:true,timestamp:time('2026-10-01T18:00:00+08:00')});
    const original=structuredClone(h.get('attendance_logs/'+start.id)),paid=structuredClone(h.get('payroll_records/paid')),manual=structuredClone(h.get('attendance_logs/manual'));
    const result=await closeAttendanceShift(h.api,{start,attendance:out});const row=h.get('attendance_logs/'+result.id);
    assert.equal(row.timeInLogId,start.id);assert.equal(row.timeInAt,start.timestamp.toISOString());assert.equal(row.sourceApp,'staff');assert.equal(row.staffName,'Original Name');
    assert.deepEqual(h.get('attendance_logs/'+start.id),original);assert.deepEqual(h.get('payroll_records/paid'),paid);assert.deepEqual(h.get('attendance_logs/manual'),manual);
    const history=linkedAttendanceHistory([{...row,id:result.id},start],'employee-1','Renamed Staff',out.timestamp);assert.equal(history.length,1);assert.equal(history[0].hours,8);assert.equal(history[0].status,'Complete');
});
test('concurrent Cashier and Staff Time Out write exactly one closure and one related record',async()=>{
    const h=fixture();const related={ref:h.ref('staff_requests','reason'),data:{message:'One reason'}};
    // Hold both transactions after reading the same absent closure to force contention.
    const run=h.api.runTransaction;let arrivals=0,release;const gate=new Promise(resolve=>release=resolve);
    h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async ref=>{const snap=await tx.get(ref);if(ref.path.startsWith('attendance_logs/time-out-') && arrivals<2){arrivals++;if(arrivals===2)release();await gate;}return snap;}}));
    const results=await Promise.all([closeAttendanceShift(h.api,{start,attendance:out,records:[related]}),closeAttendanceShift(h.api,{start,attendance:{...out,sourceApp:'cashier'},records:[{ref:related.ref,data:{message:'Different reason'}}]})]);
    assert.equal(results.filter(row=>row.saved).length,1);assert.equal(results.filter(row=>row.alreadySaved).length,1);assert.ok(h.retries()>0);
    assert.equal([...h.docs.keys()].filter(path=>path.startsWith('attendance_logs/time-out-')).length,1);assert.equal(h.get('staff_requests/reason').message,results[0].saved?'One reason':'Different reason');
});
test('a lost response can retry the existing closure without adding or replacing attendance',async()=>{
    const h=fixture();h.loseNextAck();await assert.rejects(closeAttendanceShift(h.api,{start,attendance:out}),/lost after commit/);
    const count=h.docs.size,result=await closeAttendanceShift(h.api,{start,attendance:out});assert.equal(result.alreadySaved,true);assert.equal(h.docs.size,count);
});
test('transaction rechecks the active employee, branch, timestamp and session before writing',async()=>{
    for(const invalid of [{staffId:'employee-2'},{branch:'Cabantian'},{timestamp:time('2026-10-06T23:00:00+08:00')},{type:'TIME OUT'},{deleted:true}]){
        const h=fixture();h.put('attendance_logs/'+start.id,{...start,...invalid});await assert.rejects(closeAttendanceShift(h.api,{start,attendance:out}),/changed/);assert.equal(h.docs.size,3);
    }
    const h=fixture();await assert.rejects(closeAttendanceShift(h.api,{start,attendance:{...out,branch:'Cabantian'}}),/active shift/);
    await assert.rejects(closeAttendanceShift(h.api,{start,attendance:out,assertCurrent:()=>{throw Error('session changed');}}),/session changed/);assert.equal(h.docs.size,3);
});
test('a rejected commit leaves no Time Out or staged request',async()=>{
    const h=fixture();h.failNextCommit();await assert.rejects(closeAttendanceShift(h.api,{start,attendance:out,records:[{ref:h.ref('staff_requests','reason'),data:{message:'reason'}}]}),/rejected/);
    assert.equal(h.docs.size,3);assert.equal(h.get('staff_requests/reason'),undefined);
});
test('history follows explicit shift links instead of pairing a later Time In; unknown timestamps remain reviewable',()=>{
    const newer={...start,id:'newer',timestamp:time('2026-10-07T02:00:00+08:00')},closed={...out,id:'out',timeInLogId:start.id};
    const rows=linkedAttendanceHistory([start,newer,closed,{...start,id:'unknown',timestamp:null}],'employee-1','Renamed Staff',out.timestamp);
    const complete=rows.find(row=>row.status==='Complete');assert.equal(complete.in.id,start.id);assert.equal(complete.hours,8);assert.equal(rows.find(row=>row.status==='On duty').in.id,'newer');assert.equal(rows.find(row=>row.status==='Review timestamp').in.id,'unknown');
    const unlinked=linkedAttendanceHistory([start,{...out,timeInLogId:'removed'}],'employee-1','Renamed Staff',out.timestamp);assert.equal(unlinked.filter(row=>row.status==='Complete').length,0);
});

test('active-shift selection agrees with history when a newer raw Time Out closes an older Time In',()=>{
    const newer={...start,id:'newer',timestamp:time('2026-10-07T02:00:00+08:00')},olderClosed={...out,id:'old-out',timeInLogId:start.id};
    const rows=[start,newer,olderClosed];assert.equal(latestAttendance(rows,'employee-1','Renamed Staff',+out.timestamp).id,'newer');
    assert.equal(linkedAttendanceHistory(rows,'employee-1','Renamed Staff',out.timestamp).find(shift=>shift.status==='On duty').in.id,'newer');
    const newerClosed={...out,id:'new-out',timeInLogId:'newer',timestamp:time('2026-10-07T04:00:00+08:00')};
    assert.equal(latestAttendance([...rows,newerClosed],'employee-1','Renamed Staff',+out.timestamp).id,'new-out','the newest shift is closed by its own closure, not the later older-shift closure');
});
test('legacy unlinked Time Out still closes its chronological latest shift; an invalid explicit link cannot close it',()=>{
    const newer={...start,id:'newer',timestamp:time('2026-10-07T02:00:00+08:00')};
    assert.equal(latestAttendance([start,newer,{...out,id:'legacy-out'}],'employee-1','Renamed Staff',+out.timestamp).id,'legacy-out');
    assert.equal(latestAttendance([start,newer,{...out,id:'wrong-link',timeInLogId:'removed'}],'employee-1','Renamed Staff',+out.timestamp).id,'newer');
});
