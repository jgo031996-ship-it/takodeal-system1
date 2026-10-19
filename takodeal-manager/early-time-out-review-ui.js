import {createEarlyTimeOutReviewService,canReviewEarlyTimeOut} from './early-time-out-review.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>{if(value==null||value==='')return 'Needs schedule review';const at=value?.toDate?.()||new Date(value);return Number.isFinite(+at)?at.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Needs schedule review';};
export function earlyTimeOutSummaryHTML(row){return '<strong>'+(row.requiresScheduleReview?'Time-out schedule review':'Early time-out approval')+'</strong><br><span>Scheduled finish: '+escape(date(row.scheduledEndAt))+'</span><br><small>'+escape(row.reason||'No reason recorded')+'</small>'+(row.managerReply?'<br><small>Management: '+escape(row.managerReply)+'</small>':'')+(row.requiresScheduleReview?'<br><small>The saved schedule reference needs verification; this request is not a recorded Time Out.</small>':'');}
const requestIdentity=row=>JSON.stringify([row.type,row.status,row.branch,row.staffId,row.staffName,row.requestVersion,row.requestToken]);
export function installManagerEarlyTimeOutUI(w,d,{service=createEarlyTimeOutReviewService(w)}={}){
 let generation=0,currentDialog=null;
 const identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.auth?.currentUser?.emailVerified,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.role,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 async function review(requestId,decision){
  if(!['Approved','Rejected'].includes(decision)||!canReviewEarlyTimeOut(w))return w.Swal.fire('Approval access required','Sign in with Request Inbox access for this staff branch.','warning');
  const token=++generation,key=identity();currentDialog?.close();currentDialog?.remove();
  const dialog=d.createElement('dialog');dialog.className='early-time-out-review';dialog.setAttribute('aria-labelledby','earlyReviewTitle');
  dialog.innerHTML='<header><div><small>HUMAN RESOURCES · ATTENDANCE</small><h2 id="earlyReviewTitle">Time-out schedule review</h2></div><button type="button" data-close aria-label="Close time-out review">×</button></header><div class="early-review-body"><p data-status role="status">Confirming the saved request and scheduled finish…</p><button type="button" data-retry hidden>Retry schedule check</button><div data-details></div><label>Management reply<textarea data-reply rows="3" maxlength="1500" placeholder="Optional note to the staff member"></textarea></label><p data-guidance>Checking this request does not record Time Out or change worked hours.</p></div><footer><button type="button" data-dismiss hidden disabled>Dismiss unnecessary request</button><button type="button" data-confirm disabled>'+(decision==='Approved'?'Approve early time-out':'Reject request')+'</button></footer>';
  d.body.append(dialog);currentDialog=dialog;dialog.showModal();
  const status=dialog.querySelector('[data-status]'),confirm=dialog.querySelector('[data-confirm]'),dismiss=dialog.querySelector('[data-dismiss]'),retry=dialog.querySelector('[data-retry]'),close=dialog.querySelector('[data-close]'),reply=dialog.querySelector('[data-reply]'),details=dialog.querySelector('[data-details]'),guidance=dialog.querySelector('[data-guidance]'),title=dialog.querySelector('#earlyReviewTitle');
  let busy=false,loading=false,row=null,inspection=null,timer;
  const current=()=>token===generation&&dialog.open&&identity()===key;
  const eligible=()=>!!row&&!!inspection&&(decision==='Rejected'||inspection.early===true&&!inspection.unknown&&!inspection.closed&&!inspection.complete&&!inspection.scheduleChanged);
  const dismissible=()=>!!inspection&&(inspection.complete===true||inspection.closed===true)&&!inspection.unknown;
  const controls=()=>{confirm.disabled=busy||loading||!current()||!eligible();dismiss.disabled=busy||loading||!current()||!dismissible();close.disabled=reply.disabled=busy;retry.disabled=busy||loading;};
  close.onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{clearTimeout(timer);dialog.remove();});
  async function inspect(){
   if(loading||busy||!current())return;loading=true;row=null;inspection=null;retry.hidden=true;dismiss.hidden=true;controls();status.setAttribute('role','status');status.textContent='Confirming the saved request and scheduled finish…';
   try{
    const snap=await Promise.race([w.getDocFromServer(w.doc(w.db,'staff_requests',requestId)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ and retry the schedule check.')),25000);})]);
    clearTimeout(timer);if(!current())return;
    if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('The saved request could not be confirmed. Refresh Request Inbox.');
    const original=snap.data();if(original.type!=='Early Time Out'||original.status!=='Pending'||!canReviewEarlyTimeOut(w,original.branch))throw Error('This request is no longer pending or is outside your branch access.');
    const checked=await service.inspect({requestId,expectedRequestVersion:original.requestVersion,expectedRequestToken:original.requestToken});
    if(!current())return;
    if(!checked?.request||requestIdentity(checked.request)!==requestIdentity(original)||!canReviewEarlyTimeOut(w,checked.request.branch))throw Error('The saved request changed during the schedule check. Retry before reviewing it.');
    row=checked.request;inspection=checked;
    const unknown=checked.unknown===true||!checked.scheduledEndAt&&!checked.closed;
    if(unknown)inspection={...checked,unknown:true};
    const earlyLabel=checked.early&&!unknown&&!checked.scheduleChanged&&!checked.complete&&!checked.closed;
    details.innerHTML='<p><strong>'+escape(row.staffName)+'</strong> · '+escape(row.branch)+'</p><strong>'+(earlyLabel?'Early time-out approval':'Time-out schedule review')+'</strong><br><span>'+(unknown?'Scheduled finish: Needs schedule review':(checked.clockOutCompleteOnly?'Latest matching shift finish: ':'Verified scheduled finish: ')+escape(date(checked.scheduledEndAt)))+'</span><br><small>'+escape(row.reason||'No reason recorded')+'</small>'+(row.managerReply?'<br><small>Management: '+escape(row.managerReply)+'</small>':'')+(checked.scheduleChanged?'<br><small>The request originally listed: '+escape(date(row.scheduledEndAt))+'.</small>':'');
    title.textContent=eligible()&&decision==='Approved'?'Approve early time-out':decision==='Rejected'?'Reject time-out request':'Time-out schedule review';
    if(inspection.unknown){status.textContent='The saved schedule reference could not be verified. This does not establish that the staff member left early. Approval is unavailable until the schedule reference is confirmed.';status.setAttribute('role','alert');guidance.textContent='Keep the actual attendance punches on file. You can reject this request with an explanation, or close this review while HQ checks the saved reference.';}
    else if(checked.closed){status.textContent='Attendance already has a recorded Time Out. No early time-out approval is needed for this request.';guidance.textContent='Dismissing this unnecessary request only closes the request. It does not alter the recorded Time Out, worked hours or payroll.';}
    else if(checked.complete){status.textContent=checked.clockOutCompleteOnly?'All matching saved shifts have finished. No early time-out approval is needed.':'The verified scheduled finish has already passed. No early time-out approval is needed.';guidance.textContent='Staff should tap normal Time Out when they finish. This request is not a recorded Time Out. Dismissing it only closes the request and preserves actual worked hours.';}
    else if(checked.scheduleChanged){status.textContent='The verified saved schedule differs from this request. Review the verified scheduled finish shown here; the old request cannot authorize early Time Out.';status.setAttribute('role','alert');guidance.textContent='Staff should retry Time Out using the current saved schedule. Actual attendance and worked hours remain on file.';}
    else if(checked.early){status.textContent='The saved schedule confirms that this shift has not reached its scheduled finish. Review the staff member and reason before confirming.';guidance.textContent='Approval permits early clock-out for up to 30 minutes. It does not end the shift. Staff must tap Time Out when they finish; actual recorded hours remain on file.';}
    else{inspection={...checked,unknown:true};status.textContent='The saved schedule result could not confirm whether early approval is needed. Retry the schedule check.';status.setAttribute('role','alert');retry.hidden=false;}
    dismiss.hidden=!dismissible();
   }catch(error){if(current()){row=null;inspection=null;status.textContent=error.message||'The saved schedule could not be confirmed. Retry the schedule check.';status.setAttribute('role','alert');retry.hidden=false;}}
   finally{clearTimeout(timer);loading=false;if(dialog.open)controls();}
  }
  async function save(isDismiss){
   if(busy||loading||!current()||!row||!canReviewEarlyTimeOut(w,row.branch)||(isDismiss?!dismissible():!eligible()))return;
   busy=true;controls();status.setAttribute('role','status');status.textContent=isDismiss?'Closing this unnecessary request with HQ…':decision==='Approved'?'Saving this approval with HQ…':'Saving this rejection with HQ…';
   try{
    const input={requestId,reviewNote:reply.value.trim(),expectedRequestVersion:row.requestVersion,expectedRequestToken:row.requestToken,expectedScheduleFingerprint:inspection.scheduleFingerprint};
    const result=isDismiss?await service.dismiss(input):await service.review({...input,decision});
    if(!current())return;dialog.close();await w.loadInbox?.();if(identity()!==key)return;
    await w.Swal.fire(isDismiss?'Unnecessary request dismissed':decision==='Approved'?'Early time-out approved':'Request rejected',result.alreadySaved?'This decision was already saved.':isDismiss?'Only the request was closed. Attendance, actual worked hours and payroll were not changed.':decision==='Approved'?'Staff can now tap Time Out within the approved time window (up to 30 minutes). Recorded hours are preserved.':'The request was rejected. Recorded attendance and worked hours are preserved.','success');
   }catch(error){if(current()){status.textContent=error.message||'The save could not be confirmed. Retry this same review.';status.setAttribute('role','alert');retry.hidden=false;}}
   finally{busy=false;if(dialog.open)controls();}
  }
  confirm.onclick=()=>save(false);dismiss.onclick=()=>save(true);retry.onclick=inspect;
  await inspect();
 }
 return {review,service};
}
