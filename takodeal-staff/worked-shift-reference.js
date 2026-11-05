import {resolveScheduleForDate,scheduleDateKey,shiftAmendmentFingerprint} from './schedule-history.js';
import {emergencyShiftSourceFingerprint} from './emergency-shift-model.js';
import {attendanceMillis} from './attendance-reconcile.js';
// Matches the existing shared payroll Owner identity; public Staff bundles do
// not import the Owner workspace authorization module.
const OWNER_EMAIL='jgo031996@gmail.com';
const lateReferences=new WeakMap();
export const workedShiftLatenessReference=shift=>lateReferences.get(shift)||shift;
const minutes=value=>{const match=typeof value==='string'&&value.trim().match(/^(\d{1,2}):(\d{2})$/);return match&&+match[1]<24&&+match[2]<60?+match[1]*60+ +match[2]:null;};
const ruleKind=rule=>['morning','mid','night','other'].includes(rule.shiftType)?rule.shiftType:/\bnight\b/i.test(rule.name||'')||/^n\d/i.test(rule.id)?'night':/\bmid(?:shift|-shift)?\b/i.test(rule.name||'')||/^mid/i.test(rule.id)?'mid':/\bmorning\b/i.test(rule.name||'')||/^m\d/i.test(rule.id)?'morning':'other';
function correctionAncestor(revision,id,revisions,workDate){const seen=new Set();while(revision&&!seen.has(revision.revisionId)){if(revision.revisionId===id)return true;seen.add(revision.revisionId);if(revision.source!=='owner-worked-shift'||revision.effectiveFrom!==workDate||revision.effectiveTo!==workDate)return false;const parent=revision.historicalWorkedShiftReview?.sourceRevisionId;revision=revisions.find(row=>row.revisionId===parent);}return false;}

// A one-day Owner correction changes the displayed assigned shift. It carries
// the existing lateness result forward and grants no straight-duty approval.
export function resolveWorkedShiftReference(log,history,profile,original){
 if(!log?.id||!profile||!original||original.reliefNeedsReview||original.amendmentNeedsReview||original.payrollShiftConfirmationError)return null;
 const staffId=profile.staffId||profile.id,actual=attendanceMillis(log.timestamp);
 if(!staffId||log.staffId&&log.staffId!==staffId||!Number.isFinite(actual))return null;
 const dates=[scheduleDateKey(new Date(actual)),scheduleDateKey(new Date(actual-86400000))];
 for(const workDate of dates){
  const dated=resolveScheduleForDate(history,workDate),marker=dated?.workedShiftCorrections?.[log.id];
  if(!marker)continue;
  const invalid=()=>({...original,needsScheduleReview:true,assignmentReconciliationRequired:true,workedShiftCorrectionError:'The saved worked-shift correction no longer matches its dated source. Reopen that work date before paying.'});
  const revision=history?.historyMonths?.[workDate.slice(0,7)]?.revisions?.find(row=>row.revisionId===dated.scheduleRevisionId);
  // A second employee's correction on this date carries earlier corrections
  // forward. Each retained marker still needs its own exact immutable audit.
  const revisions=history?.historyMonths?.[workDate.slice(0,7)]?.revisions||[],authority=revisions.find(row=>row.revisionId===marker.correctionId);
  if(revision?.source!=='owner-worked-shift'||revision.effectiveFrom!==workDate||revision.effectiveTo!==workDate||authority?.source!=='owner-worked-shift'||authority.effectiveFrom!==workDate||authority.effectiveTo!==workDate||authority.daySnapshots?.[workDate]?.configRevisionId!==authority.revisionId||!correctionAncestor(revision,marker.correctionId,revisions,workDate)||marker.version!==1||shiftAmendmentFingerprint(authority.historicalWorkedShiftReview)!==shiftAmendmentFingerprint(marker)||shiftAmendmentFingerprint(authority.snapshot?.workedShiftCorrections?.[log.id])!==shiftAmendmentFingerprint(marker)||marker.staffId!==staffId||marker.branch!==log.branch||marker.workDate!==workDate||marker.timeInLogId!==log.id||attendanceMillis(marker.timeInAt)!==actual||marker.reviewedByEmail!==OWNER_EMAIL||!marker.reviewedByUid||!Number.isFinite(attendanceMillis(marker.reviewedAt))||marker.sourceFingerprint!==emergencyShiftSourceFingerprint(log))return invalid();
  const begin=attendanceMillis(marker.expectedStartAt),end=attendanceMillis(marker.expectedEndAt),out=attendanceMillis(marker.timeOutAt),day=Number(workDate.slice(-2)),assigned=dated.currentSchedule?.[day]?.[log.branch]?.scheduled?.[marker.shiftId],config=dated.branchConfig?.[log.branch],rules=Array.isArray(config)?config.filter(row=>row?.id===marker.shiftId):[];
  const aliases=new Set([log.staffName,profile.cashierName,profile.fullName,profile.scheduleNickname,profile.nickname].filter(Boolean).map(value=>String(value).trim().toLowerCase()));
  if(!Number.isFinite(begin)||!Number.isFinite(end)||end<=begin||end-begin>18*3600000||!Number.isFinite(out)||out<=actual||!marker.timeOutLogId||!aliases.has(String(assigned||'').trim().toLowerCase())||rules.length!==1||!['morning','mid','night','other'].includes(marker.shiftType))return invalid();
  const rule=rules[0],start=minutes(rule.startTime),finish=minutes(rule.endTime),duration=start==null||finish==null?0:(finish-start+1440)%1440,midnight=Date.parse(workDate+'T00:00:00+08:00'),weekday=new Date(workDate+'T00:00:00Z').getUTCDay();
  if(rule.active===false||rule.active!==undefined&&rule.active!==true||rule.shiftType!==undefined&&!['morning','mid','night','other'].includes(rule.shiftType)||rule.days!==undefined&&(!Array.isArray(rule.days)||rule.days.some(value=>!Number.isInteger(value)||value<0||value>6)||!rule.days.includes(weekday))||duration<60||duration>1080||begin!==midnight+start*60000||end!==begin+duration*60000||marker.shiftType!==ruleKind(rule))return invalid();
  const late=marker.preservedLateness;
  if(late?.choice!=='Keep saved lateness decision'||!Number.isInteger(late.lateMinutes)||late.lateMinutes<0||late.lateMinutes>1080||typeof late.exempt!=='boolean')return invalid();
  // Later changes to a punch's lateness review take precedence over the audit.
  const unchanged=['lateMinutes','reviewedLateMinutes','lateDecision','lateReviewRequestId'].every(key=>shiftAmendmentFingerprint(log[key]??null)===shiftAmendmentFingerprint(late.original?.[key]??null))&&(log.lateExempted===true)===(late.original?.lateExempted===true);
  const lateMinutes=unchanged?late.lateMinutes:original.lateMinutes;
  const corrected={...original,shiftId:marker.shiftId,shiftName:marker.shiftName,shiftType:marker.shiftType,isNightShift:['mid','night'].includes(marker.shiftType),expectedStartAt:new Date(begin),expectedEndAt:new Date(end),expectedStartHour:(begin-Date.parse(workDate+'T00:00:00+08:00'))/3600000,wasScheduled:true,needsScheduleReview:false,scheduleSource:'owner-worked-shift',scheduleRevisionId:marker.correctionId,workDate,workedShiftCorrectionId:marker.correctionId,workedShiftTimeOutAt:marker.timeOutAt,workedShiftTimeOutLogId:marker.timeOutLogId,lateMinutes,latenessPreserved:true,originalExpectedStartAt:original.expectedStartAt,originalExpectedEndAt:original.expectedEndAt};
  lateReferences.set(corrected,workedShiftLatenessReference(original));return corrected;
 }
 return null;
}

// Keep the editable monthly head separate from corrected historical workdays.
export function projectWorkedShiftCorrections(view){
 if(!view?.editorSnapshot||!view.daySnapshots)return view;
 let editor=null;
 for(const [day,snapshot] of Object.entries(view.daySnapshots)){
  if(snapshot?.scheduleSource!=='owner-worked-shift'||!snapshot.workedShiftCorrections)continue;
  editor ||= structuredClone(view.editorSnapshot);
  editor.currentSchedule ||= {};editor.currentSchedule[day]=structuredClone(snapshot.currentSchedule?.[day]||{});
 }
 return editor?{...view,editorSnapshot:editor}:view;
}
