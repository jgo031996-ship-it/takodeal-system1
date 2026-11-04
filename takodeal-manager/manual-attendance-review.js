import {attendanceKind,attendanceMillis,readStaffRecords} from './attendance-reconcile.js';
import {createAttendanceMetadataReader} from './attendance-metadata-reader.js';
import {createOwnerTimeOutClient} from './owner-time-out-client.js';

const clients=new WeakMap(),attempts=new WeakMap();
const active=row=>!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status);
export function manualTimeOutReferences(records,payload){
 const finish=attendanceMillis(payload?.timestamp);
 if(payload?.type!=='TIME OUT'||!payload.staffId||!Number.isFinite(finish))throw Error('Choose the saved employee and actual Time Out first.');
 const rows=records.filter(row=>active(row)&&(row.staffId?row.staffId===payload.staffId:row.staffName===payload.staffName));
 if(rows.some(row=>attendanceKind(row)&&!Number.isFinite(attendanceMillis(row.timestamp))))throw Error('A saved attendance time needs HR review before another departure can be recorded.');
 return rows.filter(row=>attendanceKind(row)==='TIME IN'&&row.branch===payload.branch&&row.id&&finish>attendanceMillis(row.timestamp)&&finish-attendanceMillis(row.timestamp)<=18*3600000)
  .sort((a,b)=>attendanceMillis(b.timestamp)-attendanceMillis(a.timestamp));
}

// The manual form supplies the actual departure; the existing Owner service
// confirms its original punch, paid-cutoff protection and private audit.
export async function prepareManualTimeOut(api,payload,{operationId,assertCurrent=()=>{},chooseReference,
 readAttendance,client}={}){
 const user=api.auth?.currentUser,key=JSON.stringify([user?.uid,user?.email,operationId,payload.staffId,payload.staffName,payload.branch,attendanceMillis(payload.timestamp),payload.remarks]);
 if(typeof operationId!=='string'||!operationId)throw Error('Reopen the manual attendance form before saving this departure.');
 let cached=attempts.get(api);if(!cached){cached=new Map();attempts.set(api,cached);}
 assertCurrent();if(cached.has(key))return cached.get(key);
 let history;
 if(readAttendance)history=await readAttendance(payload,assertCurrent);
 else{
  const metadata=api.readStaffMetadata||createAttendanceMetadataReader({...api.deviceFleetConnection,auth:api.auth,fetch:api.fetch?.bind(api)||globalThis.fetch});
  history=await readStaffRecords({...api,readStaffMetadata:metadata},payload.staffId,payload.staffName,{metadataOnly:true,assertCurrent});
 }
 assertCurrent();if(!Array.isArray(history))throw Error('Reconnect to confirm the original saved Time In.');
 const choices=manualTimeOutReferences(history,payload);
 if(!choices.length)throw Error('No original Time In matches this employee, branch and actual departure within 18 hours. Review the missing or conflicting attendance first.');
 const selected=choices.length===1?choices[0].id:await chooseReference?.(choices);
 assertCurrent();if(!selected)throw Error('Choose the exact original Time In before recording this departure.');
 const start=choices.find(row=>row.id===selected);if(!start)throw Error('The selected original Time In changed. Reopen this correction.');
 let service=client||clients.get(api);if(!service){service=createOwnerTimeOutClient(api);clients.set(api,service);}
 const context={attendanceLogId:start.id,staffId:payload.staffId,staffName:payload.staffName,branch:payload.branch};
 const view=await service.inspect(context);assertCurrent();
 if(!view.canSave)throw Error(view.paidCutoffs?.length?'A paid payslip covers this work date. Its original figures require a separate payroll adjustment.':'This saved departure needs a separate attendance review before it can be changed.');
 if(view.context?.attendanceLogId!==start.id||view.staffId!==payload.staffId||view.branch!==payload.branch||attendanceMillis(view.timeInAt)!==attendanceMillis(start.timestamp))throw Error('The original Time In changed during review. Reopen this correction.');
 const request=Object.freeze({context:{...view.context},expectedFingerprint:view.expectedFingerprint,operationId,
  dateTimeRaw:new Date(attendanceMillis(payload.timestamp)+8*3600000).toISOString().slice(0,19),reason:payload.remarks,
  managementReply:payload.remarks,confirmActualDeparture:true,acceptReason:!!view.request});
 const prepared={view,request,async save(){
  assertCurrent();cached.set(key,prepared);
  try{const result=await service.save(request);cached.delete(key);return result;}
  catch(error){if(Number.isInteger(error.status))cached.delete(key);throw error;}
 }};
 // Retain the exact confirmed intent after a lost acknowledgement. The existing
 // service recovers that operation without creating a second departure.
 return prepared;
}
