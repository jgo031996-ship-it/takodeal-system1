// Source-bound manual OT only. Automatic Mid/Night/straight-duty calculations
// and already-paid snapshots retain their existing interpretation.
import {attendanceKind,attendanceMillis} from './attendance-reconcile.js';
import {staffRateWorkDate} from './staff-rate-model.js';

export const PAYROLL_OVERTIME_VERSION=1;
export const PAYROLL_OVERTIME_LIMIT=100;
const fields=['type','otVersion','otRevision','status','staffId','staffName','branch','workDate','workDateEvidence','timeInLogId','timeOutLogId','dateAdded','amount','hours','remarks','sourceFingerprint','grantFingerprint','loggedBy','timestamp','createdByUid','createdByEmail','cancelledAt','cancelledBy','canceledAt','canceledBy','cancellationReason','paidAt','payrollRecordId','payrollLockedAt','payrollLockedByUid'];
const text=value=>typeof value==='string'?value.trim():'';
const nameKey=value=>text(value).normalize('NFKC').toLocaleLowerCase('en');
const owns=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
const key=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_]{1,180}$/.test(value))throw Error('An overtime source reference needs Owner review.');return value;};
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const error=()=>Error('Manual overtime changed. Generate this unpaid payslip again before paying.');
const rawAmount=value=>{if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim())||!Number.isFinite(Number(value))||Number(value)<=0||Number(value)>10000000000)throw Error('A saved overtime amount needs Owner review.');return Number(value);};
const cents=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||value>10000000000)throw error();return Math.round(value*100);};
function portable(value,depth=0){
 if(depth>12)throw error();
 if(value instanceof Date){if(!Number.isFinite(+value))throw error();return{seconds:Math.floor(+value/1000),nanoseconds:(+value%1000+1000)%1000*1000000};}
 if(value&&typeof value==='object'){
  if(Number.isSafeInteger(value.seconds)&&Number.isSafeInteger(value.nanoseconds??0)&&(value.nanoseconds??0)>=0&&(value.nanoseconds??0)<1000000000&&Object.keys(value).every(key=>['seconds','nanoseconds','type'].includes(key)))return{seconds:value.seconds,nanoseconds:value.nanoseconds??0};
  if(Array.isArray(value))return value.map(item=>portable(item,depth+1));
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,portable(value[key],depth+1)]));
 }
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 throw error();
}
export const overtimeRecordFingerprint=row=>JSON.stringify(portable(Object.fromEntries(fields.filter(field=>owns(row,field)).map(field=>[field,row[field]]))));
export function overtimeBonusId(timeOutLogId){const result='attendance-ot-'+key(timeOutLogId);return key(result);}
export function overtimeWorkDateEvidence(timeIn,shift={}){
 const iso=value=>value==null?null:Number.isFinite(attendanceMillis(value))?new Date(attendanceMillis(value)).toISOString():(()=>{throw error();})();
 const workDate=staffRateWorkDate(timeIn,shift);if(!day(workDate))throw error();
 const expectedStartAt=iso(shift.expectedStartAt),expectedEndAt=iso(shift.expectedEndAt);
 if(expectedStartAt&&(staffRateWorkDate(timeIn,{expectedStartAt})!==workDate||!expectedEndAt||Date.parse(expectedEndAt)<=Date.parse(expectedStartAt)))throw error();
 return{workDate,expectedStartAt,expectedEndAt,scheduleSource:shift.scheduleSource??null,scheduleRevisionId:shift.scheduleRevisionId??null,scheduleAmendmentIds:shift.scheduleAmendmentIds||[],workedShiftCorrectionId:shift.workedShiftCorrectionId||null,originalShiftId:shift.originalShiftId||null,targetShiftId:shift.targetShiftId||null,assignmentReconciled:shift.assignmentReconciled===true};
}
function validatePair({timeIn,timeOut,staffId}){
 key(staffId);key(timeIn?.id);key(timeOut?.id);
 if(attendanceKind(timeIn)!=='TIME IN'||attendanceKind(timeOut)!=='TIME OUT'||!text(timeIn.branch)||timeIn.branch!==timeOut.branch||[timeIn,timeOut].some(row=>row.deleted||['Voided','Cancelled'].includes(row.status)||row.staffId&&row.staffId!==staffId)||timeOut.timeInLogId&&timeOut.timeInLogId!==timeIn.id)throw Error('The original overtime attendance pair changed. Review its exact Time In and Time Out.');
 if((!timeIn.staffId||!timeOut.staffId)&&(!nameKey(timeIn.staffName)||nameKey(timeIn.staffName)!==nameKey(timeOut.staffName)))throw Error('The original overtime employee identity is conflicting.');
 const begin=attendanceMillis(timeIn.timestamp),finish=attendanceMillis(timeOut.timestamp);
 if(!Number.isFinite(begin)||!Number.isFinite(finish)||finish<=begin||finish-begin>24*3600000)throw Error('Overtime needs one completed, unambiguous attendance pair.');
 return{begin,finish};
}
export async function overtimeAttendanceFingerprint(pair,cryptoApi=globalThis.crypto){
 validatePair(pair);if(!cryptoApi?.subtle)throw Error('Reconnect with a supported browser to confirm overtime evidence.');
 const selected=row=>Object.fromEntries(['id','type','staffId','staffName','branch','timestamp','timeInLogId','timeInAt','attendanceVersion','status','deleted','scheduleSnapshot','scheduleAmendmentReview','reliefScheduleReview','emergencyRelief','expectedStartAt','expectedEndAt'].filter(field=>owns(row,field)).map(field=>[field,row[field]]));
 const source=JSON.stringify(portable({staffId:pair.staffId,timeIn:selected(pair.timeIn),timeOut:selected(pair.timeOut)}));
 return [...new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function context(input){
 if(!input||!key(input.staffId)||!text(input.name)||!text(input.branch)||!day(input.start)||!day(input.end)||input.start>input.end)throw error();
 return input;
}
function identityMatches(row,data){
 if(row.staffId!==undefined&&row.staffId!==null&&row.staffId!==''){key(row.staffId);if(row.staffId!==data.staffId)return false;}
 const profile=data.profile||{},names=[data.name,profile.cashierName,profile.fullName,profile.name,profile.scheduleNickname,profile.scheduleName,profile.nickname,...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].map(nameKey).filter(Boolean);
 if(!names.includes(nameKey(row.staffName))){if(row.staffId===data.staffId)throw Error('An overtime employee name changed. Review the saved employee before payroll.');return false;}
 if(row.otVersion===undefined&&row.branch&&row.branch!==data.branch)throw Error('A legacy overtime branch conflicts with this payslip. Ask the Owner to review it.');
 return true;
}
export function capturePayrollOvertimeRow(row,input){
 const data=context(input);if(!row||row.type!=='Overtime'||!identityMatches(row,data))return null;key(row.id);
 if(['Paid','Cancelled','Canceled','Voided'].includes(row.status))return null;
 if(row.payrollRecordId||row.paidAt)throw Error('This overtime has a saved payment link. Ask the Owner to review its paid payroll.');
 if(row.status!==undefined&&row.status!==null&&row.status!=='Unpaid')throw Error('An overtime status needs Owner review.');
 const added=attendanceMillis(row.dateAdded);if(!Number.isFinite(added))throw Error('The saved overtime work date is missing. Ask the Owner to review it.');
 const workDate=row.workDate??new Date(added+8*3600000).toISOString().slice(0,10);
 if(!day(workDate))throw Error('The saved overtime work date needs Owner review.');
 if(workDate<data.start||workDate>data.end)return null;
 const amount=rawAmount(row.amount);
 if(owns(row,'otVersion')){
  if(row.otVersion!==1||row.status!=='Unpaid'||typeof row.amount!=='number'||!Number.isSafeInteger(row.otRevision)||row.otRevision<1||!day(row.workDate)||row.staffId!==data.staffId||!text(row.branch)||row.id!==overtimeBonusId(row.timeOutLogId)||!key(row.timeInLogId)||! /^[a-f0-9]{64}$/.test(row.sourceFingerprint||'')||! /^[a-f0-9]{64}$/.test(row.grantFingerprint||'')||Math.abs(amount*100-Math.round(amount*100))>0.00001)throw Error('This linked overtime source is incomplete. Ask the Owner to review it.');
 }else if(owns(row,'otRevision')||owns(row,'timeOutLogId'))throw Error('This overtime source version needs Owner review.');
 const source=JSON.parse(overtimeRecordFingerprint(row));
 if(new TextEncoder().encode(JSON.stringify(source)).length>12000)throw Error('The overtime audit is too large for this payroll. Ask the Owner to review it separately.');
 return{id:row.id,amount,source};
}
export function payrollOvertimePreview(rows,input){
 const data=context(input);if(!Array.isArray(rows))throw error();const found=[],seen=new Set();
 for(const row of rows){const value=capturePayrollOvertimeRow(row,data);if(!value)continue;if(seen.has(value.id))throw Error('Duplicate overtime sources need Owner review.');seen.add(value.id);found.push(value);}
 if(found.length>PAYROLL_OVERTIME_LIMIT)throw Error('This employee has too many overtime sources for one safe payroll.');
 found.sort((a,b)=>a.id.localeCompare(b.id));
 // Legacy calculator rows can contain fractional cents. Preserve each raw
 // value and the original aggregate rounding; do not round each old row up.
 const total=found.reduce((sum,row)=>sum+row.amount,0);
 return{overtimeEvidenceVersion:1,sourceManualOvertime:cents(total)/100,manualOvertimeRows:found};
}
export function payrollOvertimeReferenceIds(data){
 const refs=new Set();for(const row of data.manualOvertimeRows||[])refs.add(key(row.id));
 for(const log of data.logs||[])if(log.timeOutLogId)refs.add(overtimeBonusId(log.timeOutLogId));
 return [...refs].sort();
}
export function payrollOvertimeAttendanceRefs(data,candidates=[]){
 const refs=new Map();for(const row of [...(data.manualOvertimeRows||[]).map(row=>row.source),...candidates])if(row?.otVersion===1)for(const id of[row.timeInLogId,row.timeOutLogId])refs.set(key(id),{table:'attendance_logs',id});
 if(data.overtimeEvidenceVersion===1)for(const log of data.logs||[])if(log.timeOutLogId)for(const id of[log.attendanceLogId,log.timeOutLogId])refs.set(key(id),{table:'attendance_logs',id});
 return[...refs.values()];
}
function payrollPair(data,log,get){
 const timeIn=get('attendance_logs',key(log.attendanceLogId)),timeOut=get('attendance_logs',key(log.timeOutLogId));if(!timeIn||!timeOut)throw error();
 const pair={timeIn:{...timeIn,id:log.attendanceLogId},timeOut:{...timeOut,id:log.timeOutLogId},staffId:data.staffId};validatePair(pair);
 if(log.branch!==timeIn.branch||!day(log.rateWorkDate)||log.rateWorkDate<data.start||log.rateWorkDate>data.end||log.needsAttendanceReview||log.needsScheduleReview||attendanceMillis(log.timeInAt)!==attendanceMillis(timeIn.timestamp)||attendanceMillis(log.timeOutAt)!==attendanceMillis(timeOut.timestamp))throw error();
 const evidence=overtimeWorkDateEvidence(timeIn,log);if(evidence.workDate!==log.rateWorkDate)throw error();return{pair,evidence};
}
// Write the same deterministic slot that a grant reads/writes, even when there
// was no bonus. This closes payment-first races for arbitrary payroll cutoffs.
// A lock has no amount/dateAdded and is never a money-bonus record.
export async function payrollOvertimeLocks(data,get,{recordId,uid,stamp,crypto=globalThis.crypto}={}){
 if(data.overtimeEvidenceVersion!==1)return[];key(recordId);key(uid);const locks=[],seen=new Set();
 for(const log of data.logs||[])if(log.timeOutLogId){
  const id=overtimeBonusId(log.timeOutLogId);if(seen.has(id))throw error();seen.add(id);
  const {pair,evidence}=payrollPair(data,log,get),prior=get('staff_bonuses',id);
  if(prior){
   if(prior.type!=='Overtime'||prior.otVersion!==1||prior.timeInLogId!==pair.timeIn.id||prior.timeOutLogId!==pair.timeOut.id||prior.staffId!==data.staffId||prior.branch!==pair.timeIn.branch||prior.workDate!==evidence.workDate||!['Unpaid','Cancelled'].includes(prior.status)||prior.payrollRecordId||prior.paidAt||JSON.stringify(portable(evidence))!==JSON.stringify(portable(prior.workDateEvidence))||await overtimeAttendanceFingerprint(pair,crypto)!==prior.sourceFingerprint)throw error();
   if(prior.status==='Cancelled')locks.push({id,update:true,data:{payrollRecordId:recordId,payrollLockedAt:stamp,payrollLockedByUid:uid}});
  }else locks.push({id,update:false,data:{type:'Attendance OT Payroll Lock',otSlotVersion:1,status:'Payroll closed',staffId:data.staffId,staffName:data.name,branch:pair.timeIn.branch,workDate:evidence.workDate,workDateEvidence:evidence,timeInLogId:pair.timeIn.id,timeOutLogId:pair.timeOut.id,payrollRecordId:recordId,lockedAt:stamp,lockedByUid:uid}});
 }
 return locks;
}
export async function readPayrollOvertimeSources(api,data,{readRows,assertCurrent=()=>{}}={}){
 if(typeof readRows!=='function')throw error();
 const names=new Set([data.name,...(data.manualOvertimeRows||[]).map(row=>row.source?.staffName)].filter(value=>typeof value==='string'&&value.trim()));
 if(names.size>21)throw Error('Too many saved overtime names need a separate Owner identity review.');
 const filters=[['staffId',key(data.staffId)],...[...names].map(name=>['staffName',name])],records=new Map();
 // Single-field equality queries use existing automatic indexes and include
 // old rows without a status or staffId. Every returned document is bounded
 // and subsequently reread inside the actual payment transaction.
 for(const[field,value]of filters){assertCurrent();const query=api.query(api.collection(api.db,'staff_bonuses'),api.where(field,'==',value),...(typeof api.limit==='function'?[api.limit(251)]:[]));const rows=await readRows(query);assertCurrent();for(const row of rows)if(row.type==='Overtime')records.set(key(row.id),row);}
 return[...records.values()];
}
export async function validatePayrollOvertimeSet(data,candidates,get,{profile=data.profile,crypto=globalThis.crypto}={}){
 const ctx={...data,profile},query=payrollOvertimePreview(candidates,ctx);
 if(data.overtimeEvidenceVersion===undefined){if(query.manualOvertimeRows.length||(data.manualOvertimeRows||[]).length||data.sourceManualOvertime)throw error();return[];}
 if(data.overtimeEvidenceVersion!==1||!Array.isArray(data.manualOvertimeRows)||data.manualOvertimeRows.length>PAYROLL_OVERTIME_LIMIT||typeof data.sourceManualOvertime!=='number')throw error();
 const expected=data.manualOvertimeRows.map(row=>{
  if(!row||Object.keys(row).sort().join(',')!=='amount,id,source'||!row.source||typeof row.source!=='object'||Array.isArray(row.source))throw error();
  const captured=capturePayrollOvertimeRow({...row.source,id:row.id},ctx);if(!captured||JSON.stringify(portable(captured))!==JSON.stringify(portable(row)))throw error();return captured;
 });
 if(new Set(expected.map(row=>row.id)).size!==expected.length)throw error();
 const expectedById=new Map(expected.map(row=>[row.id,row]));
 if(cents(expected.reduce((sum,row)=>sum+row.amount,0))!==cents(data.sourceManualOvertime)||cents(data.nightBonus||0)<cents(data.sourceManualOvertime)||JSON.stringify(query.manualOvertimeRows)!==JSON.stringify([...expected].sort((a,b)=>a.id.localeCompare(b.id))))throw error();
 const live=[];
 // These include absent deterministic slots for every previewed Time Out.
 // Existing grants conflict on this read; payrollOvertimeLocks also writes
 // absent/cancelled slots so payment-first races cannot permit a late grant.
 for(const id of payrollOvertimeReferenceIds(data)){
  const fresh=get('staff_bonuses',id),wanted=expectedById.get(id);
  if(!fresh){if(wanted)throw error();continue;}
  const captured=capturePayrollOvertimeRow({...fresh,id},ctx);
  if(!captured){if(wanted)throw error();continue;}
  if(!wanted||JSON.stringify(portable(captured))!==JSON.stringify(portable(wanted)))throw error();
  if(fresh.otVersion===1){
   const timeIn=get('attendance_logs',fresh.timeInLogId),timeOut=get('attendance_logs',fresh.timeOutLogId);if(!timeIn||!timeOut)throw error();
   const pair={timeIn:{...timeIn,id:fresh.timeInLogId},timeOut:{...timeOut,id:fresh.timeOutLogId},staffId:data.staffId};
   validatePair(pair);const matching=(data.logs||[]).filter(log=>log.attendanceLogId===fresh.timeInLogId&&log.timeOutLogId===fresh.timeOutLogId);if(matching.length!==1)throw error();
   const {evidence}=payrollPair(data,matching[0],get);
   if(timeIn.branch!==fresh.branch||evidence.workDate!==fresh.workDate||JSON.stringify(portable(evidence))!==JSON.stringify(portable(fresh.workDateEvidence))||await overtimeAttendanceFingerprint(pair,crypto)!==fresh.sourceFingerprint)throw error();
  }
  live.push(captured);
 }
 if(live.length!==expected.length)throw error();
 return live.sort((a,b)=>a.id.localeCompare(b.id));
}
