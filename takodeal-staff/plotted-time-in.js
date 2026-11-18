import {createScheduleHistoryStore} from './schedule-history.js';
import {captureAttendanceSchedule} from './payroll-safety.js';
import {assertAttendanceScheduleUnchanged,attendanceScheduleIdentity} from './attendance-schedule-preview.js';
import {memoizedAttendanceTransaction} from './attendance-transaction-reader.js';

// The roster read and punch write share one transaction. Concurrent roster
// changes retry these reads; a later edit cannot slip behind the final preview.
// This does not approve an unassigned shift or change configured pay rules.
export function createPlottedTimeInBatch(api,{attendanceRef,attendance,profile:inputProfile,assertCurrent=()=>{},now=Date.now}={}){
 // Missing private profile data may still record an actual, review-required
 // arrival. It cannot upgrade the schedule evidence that the employee saw.
 const profile=inputProfile||{};
 const path=attendanceRef?.path,staffId=profile?.staffId||profile?.id||(!inputProfile?attendance?.staffId:null),at=new Date(attendance?.scheduleSnapshot?.clockInAt),rows=[];
 if(typeof api?.runTransaction!=='function'||typeof api?.doc!=='function'||!path?.startsWith('attendance_logs/')||attendance?.type!=='TIME IN'||!staffId||attendance.staffId!==staffId||!attendance.staffName||!attendance.branch||!Number.isFinite(+at))throw Error('The plotted Time In reference is incomplete. Reopen Clock before saving.');
 let flight=null,committed=false;
 const source=()=>JSON.stringify([attendance,profile,rows.map(row=>[row.ref.path,row.data])]);
 const current=()=>{assertCurrent();const age=Number(now())-+at;if(!Number.isFinite(age)||age<0||age>60000)throw Error('Time In verification expired. No new punch was saved. Reopen Clock to confirm the current time and location.');};
 const canonical=value=>JSON.stringify((function sort(row){if(row instanceof Date)return row.toISOString();if(row?.toDate)return row.toDate().toISOString();return Array.isArray(row)?row.map(sort):row&&typeof row==='object'?Object.fromEntries(Object.keys(row).sort().map(key=>[key,sort(row[key])])):row;})(value));
 const sameAttempt=saved=>{if(saved?.scheduleSnapshot?.clockInAt!==attendance.scheduleSnapshot.clockInAt)return false;try{assertAttendanceScheduleUnchanged(attendance.scheduleSnapshot,saved.scheduleSnapshot);}catch{return false;}return Object.keys(attendance).filter(key=>!['timestamp','createdAt','scheduleSnapshot'].includes(key)).every(key=>canonical(saved[key])===canonical(attendance[key]));};
 const batch={
  set(ref,data){if(flight||committed||!ref?.path||rows.some(row=>row.ref.path===ref.path))throw Error('This attendance batch changed or contains a duplicate reference.');rows.push({ref,data});return batch;},
  commit(){
   if(flight)return flight;if(committed)return Promise.resolve({alreadySaved:true});
   current();if(rows.filter(row=>row.ref.path===path&&row.data===attendance).length!==1)throw Error('The original Time In must be included exactly once.');
   const fingerprint=source();const guard=()=>{current();if(source()!==fingerprint)throw Error('The attendance details changed during saving. Reopen Clock; no new punch was saved.');};
   flight=api.runTransaction(api.db,async original=>{
    const tx=memoizedAttendanceTransaction(original);guard();const existing=await tx.get(attendanceRef);guard();
    if(existing.exists()){if(!sameAttempt(existing.data()))throw Error('This Time In reference already belongs to another recorded punch.');return {alreadySaved:true,scheduleSnapshot:existing.data().scheduleSnapshot};}
    const read=async reference=>{guard();const snapshot=await tx.get(reference);guard();if(!snapshot||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('The current plotted schedule could not be confirmed. No Time In was saved.');return snapshot;};
    const history=await createScheduleHistoryStore({...api,getDoc:read,getDocFromServer:read}).loadRange(new Date(+at-86400000),new Date(+at+86400000));guard();
    const profiles={[attendance.staffName]:profile},fresh=captureAttendanceSchedule(at,attendance.branch,attendance.staffName,history,profiles);
    assertAttendanceScheduleUnchanged(attendance.scheduleSnapshot,fresh);
    const present=captureAttendanceSchedule(new Date(Number(now())),attendance.branch,attendance.staffName,history,profiles);
    assertAttendanceScheduleUnchanged(fresh,present);
    if(fresh.wasScheduled===true&&fresh.lateMinutes!==present.lateMinutes)throw Error('The current clock time changed during saving. No Time In was saved. Tap Time In again so its lateness and explanation use the current time.');
    if(attendance.scheduleDeclaration&&attendanceScheduleIdentity(fresh)!==attendanceScheduleIdentity(attendance.scheduleSnapshot))throw Error('The saved swap reference changed during saving. Review the latest plotted shift before Time In.');
    const saved={...attendance,scheduleSnapshot:fresh};guard();
    for(const row of rows)tx.set(row.ref,row.ref.path===path?saved:row.data);
    return {alreadySaved:false,scheduleSnapshot:fresh};
   });
   flight=Promise.resolve(flight).then(result=>{committed=true;return result;}).finally(()=>{flight=null;});return flight;
  }
 };return batch;
}
