import {isLatenessRequest,attendanceLateMinutes,legacyAttendanceCandidates} from './payroll-safety.js';
import {historyTime} from './request-history.js';
import {scheduleDateKey} from './schedule-history.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const key=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const minutes=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1080?value:null;
const idEncoder=new TextEncoder();
const recordId=value=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!/[\/\u0000-\u001f\u007f-\u009f]/u.test(value)&&idEncoder.encode(value).length<=1500?value:'';
const phTime=value=>{const at=historyTime(value);return at?new Date(at).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'';};
function savedLetterResolution(request,originalMinutes){
 const marker=request.datedLateResolution,fields=['version','attendanceId','sourceFingerprint','currentReviewedLateMinutes','originalLateMinutes','scheduleAmendmentIds','scheduleReviewAuditId','expectedStartAt','actorUid','actorEmail','recordedAt'];
 if(!marker||Array.isArray(marker)||Object.keys(marker).length!==fields.length||fields.some(field=>!Object.hasOwn(marker,field))||marker.version!==1||!['Approved','Rejected'].includes(request.status)||request.currentReviewedLateMinutes!==0||request.originalSubmissionPreserved!==true||!recordId(request.attendanceLogId)||marker.attendanceId!==request.attendanceLogId||marker.currentReviewedLateMinutes!==0||originalMinutes===null||marker.originalLateMinutes!==originalMinutes||marker.actorEmail!=='jgo031996@gmail.com'||typeof marker.actorUid!=='string'||!marker.actorUid.trim()||marker.actorUid.length>128||!historyTime(marker.recordedAt)||!historyTime(marker.expectedStartAt)||typeof marker.sourceFingerprint!=='string'||!marker.sourceFingerprint||marker.sourceFingerprint.length>60000||!Array.isArray(marker.scheduleAmendmentIds)||!marker.scheduleAmendmentIds.length||marker.scheduleAmendmentIds.length>100||marker.scheduleAmendmentIds.some(id=>!recordId(id))||new Set(marker.scheduleAmendmentIds).size!==marker.scheduleAmendmentIds.length||typeof marker.scheduleReviewAuditId!=='string'||marker.scheduleReviewAuditId&&!recordId(marker.scheduleReviewAuditId))return null;
 try{
  const proof=JSON.parse(marker.sourceFingerprint),letter=proof.request,attendance=JSON.parse(proof.attendanceReview),review=proof.confirmedReview;
  for(const field of ['id','type','staffId','staffName','branch','attendanceLogId','lateMinutes','explanationCause','explanationMessage','payrollReviewVersion','lateDeductionHours','payrollEffect','penaltyCharged'])if(letter?.[field]!== (request[field]??null))return null;
  if(letter.timestamp?.at!==historyTime(request.timestamp)||attendance.staffName!==request.staffName||attendance.branch!==request.branch||request.staffId&&attendance.staffId!==request.staffId||attendance.expectedStartAt?.at!==historyTime(marker.expectedStartAt)||JSON.stringify(attendance.amendmentIds)!==JSON.stringify(marker.scheduleAmendmentIds)||(review?(review.auditId!==marker.scheduleReviewAuditId||review.lateMinutes!==0):marker.scheduleReviewAuditId!==''||attendance.correctedLateMinutes!==0))return null;
  return {minutes:0,recordedAt:phTime(marker.recordedAt)};
 }catch{return null;}
}
function linked(request,attendance){
 if(!attendance||!recordId(attendance.id)||attendance.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(attendance.status)||String(attendance.type).toUpperCase()!=='TIME IN'||attendance.branch!==request.branch||key(attendance.staffName)!==key(request.staffName)||request.staffId&&attendance.staffId&&request.staffId!==attendance.staffId)return false;
 return request.attendanceLogId?request.attendanceLogId===attendance.id:legacyAttendanceCandidates(request,[attendance]).length===1;
}
// The letter is historical evidence, not a fresh schedule calculation. A caller
// may supply an already verified exact clock-in and resolved dated history.
export function lateRequestSummary(request,{attendance=null,shift=null}={}){
 if(!isLatenessRequest(request))return null;
 const parsed=String(request.explanationMessage||'').match(/clocked in\s+(\d+)\s+minutes?\s+late/i)?.[1],originalMinutes=minutes(request.lateMinutes)??(parsed===undefined?null:minutes(Number(parsed))),hasLink=linked(request,attendance);
 const savedResolution=savedLetterResolution(request,originalMinutes);
 const result={originalMinutes,originalText:String(request.explanationMessage||'No explanation provided'),linked:hasLink,reviewedMinutes:null,correctedMinutes:null,reviewLabel:'Open the linked attendance to check its current dated review.',reviewRequired:false,expectedStart:'',clockIn:'',savedResolutionMinutes:savedResolution?.minutes??null,savedResolutionAt:savedResolution?.recordedAt??''};
 if(!hasLink)return result;
 result.clockIn=phTime(attendance.timestamp);
 if(shift?.attendanceCorrectionVerified===true){
  result.correctedMinutes=minutes(shift.correctedLateMinutes);result.expectedStart=phTime(shift.expectedStartAt);
  if(shift.amendmentReviewVerified===true){result.reviewedMinutes=minutes(attendanceLateMinutes(attendance,shift));result.reviewLabel='Confirmed dated attendance review';return result;}
  if(shift.amendmentNeedsReview===true){result.reviewRequired=true;result.reviewLabel='Dated correction awaits Owner confirmation';return result;}
  result.reviewedMinutes=minutes(attendanceLateMinutes(attendance,shift));result.reviewLabel='Verified dated schedule';return result;
 }
 if(attendance.lateReviewRequestId===request.id&&['Approved','Rejected'].includes(attendance.lateDecision)&&attendance.lateReviewedAt&&attendance.lateReviewedBy){result.reviewedMinutes=minutes(attendance.reviewedLateMinutes);result.reviewLabel='Saved attendance review'+(attendance.lateExempted===true?' · waived':'');}
 return result;
}
export function lateRequestSummaryHTML(request,options={}){
 const summary=lateRequestSummary(request,options);if(!summary)return '<strong>Cause: '+escape(request.explanationCause||'Variance')+'</strong><br><small>'+escape(request.explanationMessage||'No explanation provided')+'</small>';
 let html='<strong>Cause: '+escape(request.explanationCause||'Tardiness / Late Arrival')+'</strong><div style="margin-top:5px;"><small><b>Original submission'+(summary.originalMinutes===null?'':' · '+summary.originalMinutes+' minutes reported')+'</b><br>'+escape(summary.originalText)+'</small></div>';
 if(summary.savedResolutionMinutes===0)html+='<p style="margin:6px 0;color:#166653;"><b>Saved dated letter resolution: 0 minutes late</b><br><small>'+escape(summary.savedResolutionAt)+'. This is the letter’s saved resolution. Open linked attendance for the latest review.</small></p>';
 if(summary.reviewedMinutes!==null)html+='<p style="margin:6px 0;color:#166653;"><b>'+escape(summary.reviewLabel)+': '+summary.reviewedMinutes+' minutes late</b></p>';
 else html+='<p style="margin:6px 0;color:#6a5844;font-size:12px;">'+escape(summary.reviewLabel)+(summary.reviewRequired&&summary.correctedMinutes!==null?' · corrected schedule indicates '+summary.correctedMinutes+' minutes late.':'.')+'</p>';
 if(summary.clockIn||summary.expectedStart)html+='<small>'+(summary.clockIn?'Time In: '+escape(summary.clockIn):'')+(summary.expectedStart?'<br>Verified dated start: '+escape(summary.expectedStart):'')+'</small>';
 html+='<p style="margin:6px 0;font-size:11px;color:#64748b;">Changing shift rules alone does not confirm past attendance. Review the correct work date; original punches and paid payslips stay on file.</p>';
 return html;
}
export function lateRequestRecoveryContext(request){
 if(!isLatenessRequest(request))return null;
 const context={staffName:String(request.staffName||''),branch:String(request.branch||'')},staffId=recordId(request.staffId),attendanceLogId=recordId(request.attendanceLogId);if(staffId)context.staffId=staffId;if(attendanceLogId)context.attendanceLogId=attendanceLogId;
 const at=historyTime(request.timestamp);if(at){const to=scheduleDateKey(new Date(at));context.from=new Date(Date.parse(to+'T12:00:00Z')-86400000).toISOString().slice(0,10);context.to=to;}
 return context;
}
