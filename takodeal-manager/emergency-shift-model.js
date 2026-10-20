import {attendanceMillis,attendanceKind} from './attendance-reconcile.js';
import {scheduleDateKey} from './schedule-history.js';

export const EMERGENCY_SHIFT_COLLECTION='attendance_shift_confirmations';
export const EMERGENCY_SHIFT_EVENTS='attendance_shift_confirmation_events';
const minute=60000,day=86400000;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!value.includes('/');
const revision=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value);
const stamp=value=>value instanceof Date||typeof value?.toMillis==='function'||typeof value?.toDate==='function'||Number.isFinite(value?.seconds);
const canonical=value=>{
    if(value instanceof Date||typeof value?.toDate==='function'||typeof value?.toMillis==='function'||value&&typeof value==='object'&&Number.isFinite(value.seconds)){
        const time=attendanceMillis(value);if(!Number.isFinite(time))throw Error('The saved Time In contains an invalid date.');return new Date(time).toISOString();
    }
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
    return value;
};
function source(start){
    if(!id(start?.id)||attendanceKind(start)!=='TIME IN'||!id(start.branch)||typeof start.staffName!=='string'||!start.staffName.trim()||!Number.isFinite(attendanceMillis(start.timestamp))||start.deleted||['Voided','Cancelled'].includes(start.status))throw Error('Refresh the original active Time In before confirming its emergency shift.');
    return start;
}
export function emergencyShiftSourceFingerprint(start){
    source(start);
    return JSON.stringify(canonical({id:start.id,staffId:start.staffId||'',staffName:start.staffName,branch:start.branch,timestamp:new Date(attendanceMillis(start.timestamp)),scheduleSnapshot:start.scheduleSnapshot??null}));
}
function dateKey(value){
    if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$|^21\d{2}-\d{2}-\d{2}$/.test(value)||scheduleDateKey(value)!==value)throw Error('Choose a valid Philippine work date.');return value;
}
function time(value){
    if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('Set both planned shift times using the time fields.');return Number(value.slice(0,2))*60+Number(value.slice(3));
}
function checkedBounds(workDate,expectedStartAt,expectedEndAt,start){
    const actual=attendanceMillis(source(start).timestamp),begin=attendanceMillis(expectedStartAt),end=attendanceMillis(expectedEndAt),midnight=Date.parse(dateKey(workDate)+'T00:00:00+08:00'),distance=(actual-begin)/minute,duration=(end-begin)/minute;
    if(!Number.isFinite(begin)||!Number.isFinite(end)||begin<midnight||begin>=midnight+day||begin%minute!==0||end%minute!==0||duration<60||duration>18*60||distance< -90||distance>=18*60||end<=actual||end-actual>day)throw Error('Check the work date and planned times. The shift must last 1–18 hours and cover this saved Time In.');
    return {workDate,expectedStartAt:new Date(begin),expectedEndAt:new Date(end)};
}
export function emergencyShiftBounds(input,start){
    const workDate=dateKey(input?.workDate),begin=time(input?.startTime),finish=time(input?.endTime),midnight=Date.parse(workDate+'T00:00:00+08:00'),reason=String(input?.reason||'').trim(),shiftName=String(input?.shiftName||'').trim()||'Emergency covering shift';
    if(reason.length<8||reason.length>1500)throw Error('Explain the emergency reassignment in 8–1,500 characters.');
    if(shiftName.length>160)throw Error('Keep the covering shift name within 160 characters.');
    return {...checkedBounds(workDate,new Date(midnight+begin*minute),new Date(midnight+(finish+(finish<=begin?1440:0))*minute),start),shiftName,reason};
}
const headKeys=['schemaVersion','status','revisionId','version','staffId','staffName','branch','timeInLogId','timeInAt','expectedStartAt','expectedEndAt','workDate','shiftName','sourceFingerprint','reviewedByUid','reviewedByEmail','reviewedAt'];
export function resolveEmergencyShift(start,person,head){
    if(head==null)return null;
    source(start);
    if(!head||typeof head!=='object'||Array.isArray(head)||Object.keys(head).length!==headKeys.length||headKeys.some(key=>!Object.hasOwn(head,key))||head.schemaVersion!==1||head.status!=='Confirmed'||!revision(head.revisionId)||!Number.isSafeInteger(head.version)||head.version<1||!id(head.staffId)||head.timeInLogId!==start.id||head.staffName!==start.staffName||head.branch!==start.branch||start.staffId&&start.staffId!==head.staffId||!person||person.cashierName!==head.staffName||(person.staffId||person.id)&&String(person.staffId||person.id)!==head.staffId||person.active===false||person.archived===true||person.blocked===true||/blocked|revoked|terminated|resigned|inactive|disabled|archived|deleted/i.test(String(person.status||''))||!stamp(head.timeInAt)||attendanceMillis(head.timeInAt)!==attendanceMillis(start.timestamp)||head.sourceFingerprint!==emergencyShiftSourceFingerprint(start)||!stamp(head.expectedStartAt)||!stamp(head.expectedEndAt)||!stamp(head.reviewedAt)||!Number.isFinite(attendanceMillis(head.reviewedAt))||!id(head.reviewedByUid)||typeof head.reviewedByEmail!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(head.reviewedByEmail)||head.reviewedByEmail!==head.reviewedByEmail.toLowerCase()||typeof head.shiftName!=='string'||!head.shiftName.trim()||head.shiftName.length>160)throw Error('The saved emergency shift confirmation needs an HQ review. Reopen this request; no Time Out was recorded.');
    const bounds=checkedBounds(head.workDate,head.expectedStartAt,head.expectedEndAt,start),evidence={schemaVersion:1,source:'hq-emergency-shift',revisionId:head.revisionId,version:head.version,staffId:head.staffId,branch:head.branch,timeInLogId:head.timeInLogId,workDate:bounds.workDate,expectedStartAt:bounds.expectedStartAt.toISOString(),expectedEndAt:bounds.expectedEndAt.toISOString(),reviewedByUid:head.reviewedByUid,reviewedAt:new Date(attendanceMillis(head.reviewedAt)).toISOString()};
    return {shiftId:'emergency-'+head.revisionId,shiftName:head.shiftName,shiftType:'other',isNightShift:false,expectedStartHour:(+bounds.expectedStartAt-Date.parse(bounds.workDate+'T00:00:00+08:00'))/3600000,expectedStartAt:bounds.expectedStartAt,expectedEndAt:bounds.expectedEndAt,wasScheduled:true,needsScheduleReview:false,amendmentNeedsReview:false,scheduleSource:'hq-emergency-shift',scheduleRevisionId:head.revisionId,scheduleAmendmentIds:[],emergencyShiftConfirmed:true,emergencyShiftVersion:head.version,clockOutOnly:true,clockOutScheduleRecovered:true,clockOutScheduleReviewReason:'',clockOutScheduleEvidence:evidence};
}
