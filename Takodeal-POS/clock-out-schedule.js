// Clock-out evidence only. Payroll continues to use the original saved punch.
import {resolveAttendanceShift,timeMinutes,shiftType,bonusShift} from './payroll-safety.js';
import {resolveScheduleForDate,scheduleDateKey} from './schedule-history.js';
import {attendanceKind,attendanceMillis} from './attendance-reconcile.js';
const minute=60000,day=1440*minute;
const nameKey=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!value.includes('/');
const trusted=shift=>{
 const start=attendanceMillis(shift?.expectedStartAt),end=attendanceMillis(shift?.expectedEndAt);
 return shift?.wasScheduled===true&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=18*60*minute
  &&(shift.attendanceCorrectionVerified===true||shift.needsScheduleReview!==true&&shift.amendmentNeedsReview!==true);
};
function needsReview(original,reason){return {...original,wasScheduled:false,needsScheduleReview:true,clockOutScheduleRecovered:false,clockOutScheduleReviewReason:reason};}
function midnight(date){const key=scheduleDateKey(date);return Date.parse(key+'T00:00:00+08:00');}
function aliases(name,profile){return new Set([name,profile.cashierName,profile.scheduleNickname,profile.scheduleName,profile.nickname].filter(Boolean).map(nameKey));}
function directoryConflict(saved,assigned,staffId){
 return (Array.isArray(saved.employees)?saved.employees:[]).some(person=>{
  const linked=person.staffId||person.id;
  return linked&&String(linked)!==staffId&&[person.name,person.fullName,person.cashierName,person.scheduleNickname,person.scheduleName,person.nickname].some(value=>value&&nameKey(value)===nameKey(assigned));
 });
}
function capturedFinishBound(start,schedule,original){
 const captured=start.scheduleSnapshot,begin=attendanceMillis(start.timestamp),expected=attendanceMillis(captured?.expectedStartAt),capturedEnd=attendanceMillis(captured?.expectedEndAt);
 if(!captured||!validId(captured.scheduleRevisionId)||!validId(captured.shiftId)||!Number.isFinite(expected))return null;
 const workDate=scheduleDateKey(new Date(expected)),workMidnight=midnight(new Date(expected)),month=workDate.slice(0,7),archive=schedule?.historyMonths?.[month];
 const revisions=Array.isArray(archive)?archive:archive?.revisions;
 const linked=Array.isArray(revisions)?revisions.filter(row=>row?.revisionId===captured.scheduleRevisionId):[];
 if(linked.length!==1)return null;
 const revision=linked[0],saved=revision.snapshot,day=revision.daySnapshots?.[workDate];
 if(revision.month!==month||revision.effectiveFrom>workDate||revision.effectiveTo<workDate||day?.configRevisionId!==revision.revisionId||Number(saved?.currentYear)!==Number(workDate.slice(0,4))||Number(saved?.currentMonth)!==Number(workDate.slice(5,7)))return null;
 const rules=saved.branchConfig?.[start.branch],weekday=new Date(workMidnight+8*60*minute).getUTCDay();
 if(!Array.isArray(rules)||!rules.length)return null;
 const ids=new Set(),candidates=[];
 for(const rule of rules){
  if(rule.active===false||Array.isArray(rule.days)&&!rule.days.includes(weekday))continue;
  const startMinute=timeMinutes(rule.startTime),endMinute=timeMinutes(rule.endTime);
  // Missing start means its relevance cannot be excluded safely.
  if(startMinute===null)return null;
  const ruleStart=workMidnight+startMinute*minute,distance=(begin-ruleStart)/minute;
  if(distance< -90||distance>=240)continue;
  const duration=endMinute===null?0:(endMinute-startMinute+1440)%1440;
  if(!validId(rule.id)||ids.has(rule.id)||endMinute===null||duration<60||duration>18*60)return null;
  ids.add(rule.id);candidates.push({shiftId:rule.id,startAt:ruleStart,endAt:ruleStart+duration*minute});
 }
 const anchor=candidates.filter(row=>row.shiftId===captured.shiftId&&row.startAt===expected&&(!Number.isFinite(capturedEnd)||capturedEnd===row.endAt));
 if(anchor.length!==1||!candidates.length)return null;
 const latest=Math.max(...candidates.map(row=>row.endAt));
 return {...original,expectedStartAt:new Date(expected),clockOutCompleteOnly:true,clockOutLatestFinishAt:new Date(latest),clockOutScheduleRecovered:false,
  clockOutScheduleReviewReason:'unassigned-captured-shift',clockOutScheduleEvidence:{schemaVersion:1,source:'captured-revision-finish-bound',staffId:start.staffId,branch:start.branch,
   workDate,scheduleRevisionId:revision.revisionId,shiftIds:candidates.map(row=>row.shiftId),expectedStartAt:new Date(expected).toISOString(),
   latestFinishAt:new Date(latest).toISOString(),candidateFinishes:candidates.map(row=>({shiftId:row.shiftId,expectedStartAt:new Date(row.startAt).toISOString(),expectedEndAt:new Date(row.endAt).toISOString()}))}};
}
export function resolveClockOutShift(start,schedule,profiles={}){
 const name=start?.staffName,profile=profiles[name]||{},profileId=profile.staffId||profile.id;
 const original=resolveAttendanceShift(start,schedule,profiles);
 if(attendanceKind(start)!=='TIME IN'||!name||!start.branch||!Number.isFinite(attendanceMillis(start.timestamp)))return needsReview(original,'invalid-active-time-in');
 if(profile.cashierName&&nameKey(profile.cashierName)!==nameKey(name)||start.staffId&&profileId&&String(start.staffId)!==String(profileId))return needsReview(original,'staff-identity-mismatch');
 const captured=start.scheduleSnapshot;
 if(captured&&(captured.branch&&captured.branch!==start.branch||captured.staffName&&nameKey(captured.staffName)!==nameKey(name)))return needsReview(original,'saved-punch-identity-mismatch');
 if(trusted(original))return original;
 // Recovery cannot be based on a mutable current-month head or a typed reason.
 if(!validId(start.staffId)||!validId(String(profileId||''))||start.staffId!==String(profileId)||nameKey(profile.cashierName)!==nameKey(name))return needsReview(original,'dated-staff-identity-required');
 const actual=attendanceMillis(start.timestamp),base=midnight(new Date(actual)),names=aliases(name,profile),candidates=[];
 for(const offset of [-1,0,1]){
  const workMidnight=base+offset*day,workDate=scheduleDateKey(new Date(workMidnight));
  const saved=resolveScheduleForDate(schedule,workDate);
  if(!saved||saved.snapshotDate!==workDate||!validId(saved.scheduleRevisionId)||Number(saved.currentYear)!==Number(workDate.slice(0,4))||Number(saved.currentMonth)!==Number(workDate.slice(5,7)))continue;
  if(captured?.scheduleRevisionId){if(saved.scheduleRevisionId!==captured.scheduleRevisionId)continue;}
  else{
   const archive=schedule.historyMonths?.[workDate.slice(0,7)],revisions=Array.isArray(archive)?archive:archive?.revisions;
   const sources=Array.isArray(revisions)?revisions.filter(row=>row?.revisionId===saved.scheduleRevisionId):[];
   if(sources.length!==1||!Number.isFinite(attendanceMillis(sources[0].savedAt))||attendanceMillis(sources[0].savedAt)>actual)continue;
  }
  const rules=saved.branchConfig?.[start.branch],assignments=saved.currentSchedule?.[Number(workDate.slice(-2))]?.[start.branch]?.scheduled;
  if(!Array.isArray(rules)||!assignments||typeof assignments!=='object'||Array.isArray(assignments))continue;
  const assigned=rules.filter(rule=>names.has(nameKey(assignments[rule.id])));
  // Two assigned slots remain ambiguous even if their displayed times match.
  if(assigned.length!==1){if(assigned.length>1)candidates.push({invalid:'ambiguous-dated-assignment'});continue;}
  const rule=assigned[0],startMinute=timeMinutes(rule.startTime),endMinute=timeMinutes(rule.endTime);
  if(!validId(rule.id)||rules.filter(item=>item.id===rule.id).length!==1||rule.active===false||startMinute===null||endMinute===null){candidates.push({invalid:'invalid-explicit-dated-times'});continue;}
  const duration=(endMinute-startMinute+1440)%1440;
  if(duration<60||duration>18*60){candidates.push({invalid:'invalid-explicit-dated-times'});continue;}
  const expectedStartAt=new Date(workMidnight+startMinute*minute),expectedEndAt=new Date(+expectedStartAt+duration*minute),distance=(actual-expectedStartAt)/minute;
  if(distance< -90||distance>=18*60)continue;
  if(directoryConflict(saved,assignments[rule.id],start.staffId)){candidates.push({invalid:'dated-staff-identity-mismatch'});continue;}
  const weekday=new Date(workMidnight+8*60*minute).getUTCDay();
  if(Array.isArray(rule.days)&&!rule.days.includes(weekday)){candidates.push({invalid:'dated-assignment-disabled-day'});continue;}
  candidates.push({saved,rule,workDate,expectedStartAt,expectedEndAt});
 }
 if(candidates.some(row=>row.invalid))return needsReview(original,candidates.find(row=>row.invalid).invalid);
 if(candidates.length!==1)return candidates.length?needsReview(original,'ambiguous-dated-assignment'):capturedFinishBound(start,schedule,original)||needsReview(original,'missing-dated-assignment');
 const chosen=candidates[0];
 // A valid, conflicting preserved clock value needs an explicit correction,
 // rather than silently replacing it with a later schedule revision.
 for(const key of ['expectedStartAt','expectedEndAt']){
  const value=captured?.[key]??start[key],saved=attendanceMillis(value);
  if(value!=null&&value!==''&&Number.isFinite(saved)&&saved!==+chosen[key])return needsReview(original,'preserved-schedule-conflict');
 }
 const amendmentIds=(chosen.saved.scheduleAmendments||[]).map(row=>row.id).filter(Boolean);
 return {...original,shiftId:chosen.rule.id,shiftName:chosen.rule.name||'',shiftType:shiftType(chosen.rule),isNightShift:bonusShift(chosen.rule),
  expectedStartAt:chosen.expectedStartAt,expectedEndAt:chosen.expectedEndAt,wasScheduled:true,needsScheduleReview:false,amendmentNeedsReview:false,
  scheduleSource:'clock-out-dated-assignment',scheduleRevisionId:chosen.saved.scheduleRevisionId,scheduleAmendmentIds:amendmentIds,
  payrollScheduleNeedsReview:original.needsScheduleReview===true,payrollAmendmentNeedsReview:original.amendmentNeedsReview===true,
  clockOutScheduleRecovered:true,clockOutScheduleReviewReason:'',clockOutScheduleEvidence:{schemaVersion:1,source:'dated-assignment',staffId:start.staffId,branch:start.branch,
   workDate:chosen.workDate,shiftId:chosen.rule.id,scheduleRevisionId:chosen.saved.scheduleRevisionId,amendmentIds,
   expectedStartAt:chosen.expectedStartAt.toISOString(),expectedEndAt:chosen.expectedEndAt.toISOString()}};
}
