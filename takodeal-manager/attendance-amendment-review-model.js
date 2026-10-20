const minute=60000;
const millis=v=>v?.toMillis?.()??(v?.seconds!==undefined?v.seconds*1000+Math.floor((v.nanoseconds||0)/1e6):v instanceof Date?+v:Date.parse(v));
const canonical=v=>v instanceof Date||v?.seconds!==undefined||typeof v?.toMillis==='function'?{at:millis(v)}:Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v??null;
const validReviewInstant=v=>!!v&&(v instanceof Date||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)||typeof v?.toMillis==='function'||typeof v?.seconds==='number')&&Number.isFinite(millis(v));
export const amendmentReviewChoices=['Keep saved lateness decision','Use corrected schedule minutes','Waive lateness'];
export function attendanceAmendmentReviewFingerprint(log,shift){
 return JSON.stringify(canonical({staffId:log.staffId||null,staffName:log.staffName,branch:log.branch,type:log.type,timestamp:log.timestamp,scheduleSnapshot:log.scheduleSnapshot||null,lateMinutes:log.lateMinutes??null,reviewedLateMinutes:log.reviewedLateMinutes??null,lateExempted:log.lateExempted===true,lateReviewRequestId:log.lateReviewRequestId||null,lateDecision:log.lateDecision||null,lateReviewedAt:log.lateReviewedAt||null,lateReviewedBy:log.lateReviewedBy||null,amendmentIds:shift.scheduleAmendmentIds,shiftId:shift.shiftId,originalShiftId:shift.originalShiftId,targetShiftId:shift.targetShiftId,expectedStartAt:shift.expectedStartAt,expectedEndAt:shift.expectedEndAt,correctedLateMinutes:shift.correctedLateMinutes,workDate:shift.workDate}));
}
export function amendmentReviewResult(log,shift,choice){
 if(!amendmentReviewChoices.includes(choice)||shift?.attendanceCorrectionVerified!==true||!Array.isArray(shift.scheduleAmendmentIds)||!shift.scheduleAmendmentIds.length)throw Error('A verified dated shift correction and review choice are required.');
 const lateMinutes=choice==='Waive lateness'?0:choice==='Use corrected schedule minutes'?shift.correctedLateMinutes:Number(log.reviewedLateMinutes??log.lateMinutes??shift.lateMinutes??0);
 if(!Number.isSafeInteger(lateMinutes)||lateMinutes<0||lateMinutes>18*60)throw Error('The saved late minutes need attendance review.');
 return {lateMinutes,exempt:choice==='Waive lateness'||choice==='Keep saved lateness decision'&&log.lateExempted===true};
}
export function applyAttendanceAmendmentReview(log,shift){
 const row=log.scheduleAmendmentReview;if(!row)return shift;
 try{const expected=amendmentReviewResult(log,shift,row.choice);if(row.version!==1||!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.auditId!=='string'||!/^amendment-[-A-Za-z0-9_]{1,180}-[1-9]\d*$/.test(row.auditId)||log.id&&row.auditId!=='amendment-'+log.id+'-'+row.revision||row.sourceFingerprint!==attendanceAmendmentReviewFingerprint(log,shift)||row.lateMinutes!==expected.lateMinutes||row.exempt!==expected.exempt||typeof row.actorUid!=='string'||!row.actorUid.trim()||row.actorUid.length>128||row.actorEmail!=='jgo031996@gmail.com'||!validReviewInstant(row.reviewedAt)||typeof row.reason!=='string'||row.reason.trim().length<8||row.reason.trim().length>1500)return shift;
  return {...shift,amendmentNeedsReview:false,needsScheduleReview:false,amendmentReviewVerified:true,amendmentLateExempted:expected.exempt,lateMinutes:expected.lateMinutes};
 }catch{return shift;}
}
