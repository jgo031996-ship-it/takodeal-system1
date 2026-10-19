import {attendanceMillis,attendanceKind} from './attendance-reconcile.js';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const earlyTimeOutFingerprint=value=>JSON.stringify(canonical(value));
export const EARLY_TIME_OUT_TYPE='Early Time Out';
export const EARLY_TIME_OUT_APPROVALS='attendance_time_out_approvals';
export function assessEarlyTimeOut(start,shift,now=new Date()){
    const time=attendanceMillis(now),begin=attendanceMillis(start?.timestamp),end=attendanceMillis(shift?.expectedEndAt),expectedStart=attendanceMillis(shift?.expectedStartAt);
    if(attendanceKind(start)!=='TIME IN'||!Number.isFinite(begin)||!Number.isFinite(time)||time<begin)throw Error('The active Time In or device clock needs management review.');
    // A confirmed dated correction may retain a manual lateness review. Its
    // verified end time still governs clock-out; no lateness decision changes.
    const verifiedCorrection=shift?.attendanceCorrectionVerified===true&&shift?.wasScheduled===true;
    const unknown=!shift||!verifiedCorrection&&(shift.needsScheduleReview===true||shift.amendmentNeedsReview===true)||shift.wasScheduled!==true||!Number.isFinite(end)||!Number.isFinite(expectedStart)||end<=expectedStart||end-begin>24*3600000;
    const evidence={branch:start.branch,timeInLogId:start.id,timeInAt:new Date(begin).toISOString(),shiftId:shift?.shiftId??null,scheduledStartAt:Number.isFinite(expectedStart)?new Date(expectedStart).toISOString():null,scheduledEndAt:!unknown?new Date(end).toISOString():null,scheduleRevisionId:shift?.scheduleRevisionId||'',amendmentIds:shift?.scheduleAmendmentIds||shift?.amendmentIds||[],needsScheduleReview:unknown};
    return {unknown,early:!unknown&&time<end,complete:!unknown&&time>=end,minutesEarly:!unknown?Math.max(0,Math.ceil((end-time)/60000)):null,...evidence,scheduleFingerprint:earlyTimeOutFingerprint(evidence)};
}
export function sameEarlyTimeOutLink(row,context){return !!row&&row.staffId===context.staffId&&row.staffName===context.staffName&&row.branch===context.branch&&row.timeInLogId===context.timeInLogId&&row.timeInAt===context.timeInAt;}
export function validEarlyTimeOutApproval(request,approval,context,now=new Date()){
    if(context.unknown||request?.type!==EARLY_TIME_OUT_TYPE||request.schemaVersion!==1||approval?.schemaVersion!==1||!Number.isSafeInteger(request.requestVersion)||request.requestVersion<1||typeof request.requestToken!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(request.requestToken)||!sameEarlyTimeOutLink(request,context)||!sameEarlyTimeOutLink(approval,context)||request.status!=='Approved'||approval.decision!=='Approved'||request.requestVersion!==approval.requestVersion||request.requestToken!==approval.requestToken||approval.requestId!==request.id||approval.scheduleFingerprint!==context.scheduleFingerprint||request.scheduleFingerprint!==context.scheduleFingerprint||approval.scheduledEndAt!==context.scheduledEndAt||!approval.reviewedByUid||!approval.reviewedByEmail)return false;
    const approved=attendanceMillis(approval.reviewedAt),expires=attendanceMillis(approval.validUntil),time=attendanceMillis(now);
    return Number.isFinite(approved)&&Number.isFinite(expires)&&approved<=time&&time<expires&&expires<=approved+30*60000&&expires<=attendanceMillis(context.timeInAt)+24*3600000;
}
