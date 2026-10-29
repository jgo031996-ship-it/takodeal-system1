// Display only: preserve the saved request type, status and attendance records.
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const isTimeOutScheduleReview=row=>row?.type==='Early Time Out'&&row.requiresScheduleReview===true;
export function timeOutRequestLabel(row){
 return isTimeOutScheduleReview(row)?'Time-out schedule review':String(row?.type||'Request');
}
export function timeOutRequestDetailsHTML(row){
 if(row?.type!=='Early Time Out')return '';
 let html='<span>'+escape(row.reason||'No reason recorded')+'</span>';
 if(isTimeOutScheduleReview(row)){
  const message=row.status==='Completed Normally'?'Normal Time Out was recorded for this shift. This schedule-review request remains in history; no early-time-out approval was used.':row.status==='Not Required'?'Management completed this schedule review without early-time-out approval. This request did not create or change a Time Out.':row.status==='Pending'?'The assigned shift finish needs schedule review. This does not establish that you left early. Sending this request does not record Time Out.':'This request was submitted for schedule review. It does not establish that you left early. The saved decision is shown above; recorded attendance remains separate.';
  html+='<p style="margin-top:8px;padding:10px 12px;border:1px solid #d6e3d8;border-radius:7px;background:#f4f8f1;color:#476553;font-size:12px;line-height:1.6;">'+escape(message)+'</p>';
 }
 return html;
}
