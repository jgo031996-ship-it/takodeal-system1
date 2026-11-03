// Display only: preserve the saved request type, status and attendance records.
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const isTimeOutScheduleReview=row=>row?.type==='Early Time Out'&&row.requiresScheduleReview===true;
export function hasConfirmedReliefReview(row){
 if(row?.type!=='Early Time Out'||row.status!=='Not Required'||row.emergencyRelief?.version!==1||!/^time-out-[a-f0-9]{64}$/.test(row.timeOutLogId||'')||typeof row.timeInLogId!=='string'||!row.timeInLogId||typeof row.reliefReviewAuditId!=='string')return false;
 const prefix='relief-'+row.timeInLogId+'-',revision=row.reliefReviewAuditId.startsWith(prefix)?row.reliefReviewAuditId.slice(prefix.length):'';
 return /^[1-9]\d*$/.test(revision)&&Number.isSafeInteger(Number(revision));
}
export function timeOutRequestLabel(row){
 return row?.emergencyRelief?.version===1&&row.timeOutLogId?'Emergency branch cover':isTimeOutScheduleReview(row)?'Time-out schedule review':String(row?.type||'Request');
}
export function timeOutRequestDetailsHTML(row){
 if(row?.type!=='Early Time Out')return '';
 if(row.emergencyRelief?.version===1&&row.timeOutLogId)return '<p>Your actual Time Out is recorded. '+escape(row.status==='Pending'?'Assigned hours are waiting for Owner HR review. No lateness or early departure was inferred.':hasConfirmedReliefReview(row)?'Owner confirmed your assigned hours. Your actual punches remain on file.':'The saved Owner review status is shown above. Your actual punches remain on file.')+'</p>';
 let html='<span>'+escape(row.reason||'No reason recorded')+'</span>';
 if(isTimeOutScheduleReview(row)){
  const message=row.status==='Completed Normally'?'Normal Time Out was recorded for this shift. This schedule-review request remains in history; no early-time-out approval was used.':row.status==='Not Required'?'Management completed this schedule review without early-time-out approval. This request did not create or change a Time Out.':row.status==='Pending'?'The assigned shift finish needs schedule review. This does not establish that you left early. Sending this request does not record Time Out.':'This request was submitted for schedule review. It does not establish that you left early. The saved decision is shown above; recorded attendance remains separate.';
  html+='<p style="margin-top:8px;padding:10px 12px;border:1px solid #d6e3d8;border-radius:7px;background:#f4f8f1;color:#476553;font-size:12px;line-height:1.6;">'+escape(message)+'</p>';
 }
 return html;
}
