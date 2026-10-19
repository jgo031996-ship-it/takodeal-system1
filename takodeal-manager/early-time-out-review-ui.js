import {createEarlyTimeOutReviewService,canReviewEarlyTimeOut} from './early-time-out-review.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>{if(value==null||value==='')return 'Needs schedule review';const at=value?.toDate?.()||new Date(value);return Number.isFinite(+at)?at.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Needs schedule review';};
export function earlyTimeOutSummaryHTML(row){return '<strong>Early time-out approval</strong><br><span>Scheduled finish: '+escape(date(row.scheduledEndAt))+'</span><br><small>'+escape(row.reason||'No reason recorded')+'</small>'+(row.managerReply?'<br><small>Management: '+escape(row.managerReply)+'</small>':'')+(row.requiresScheduleReview?'<br><small>Saved schedule needs review before approval.</small>':'');}
export function installManagerEarlyTimeOutUI(w,d,{service=createEarlyTimeOutReviewService(w)}={}){
 let generation=0,currentDialog=null;
 const identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 async function review(requestId,decision){
  if(!['Approved','Rejected'].includes(decision)||!canReviewEarlyTimeOut(w))return w.Swal.fire('Approval access required','Sign in with Request Inbox access for this staff branch.','warning');
  const token=++generation,key=identity();currentDialog?.close();currentDialog?.remove();
  const dialog=d.createElement('dialog');dialog.className='early-time-out-review';dialog.setAttribute('aria-labelledby','earlyReviewTitle');
  dialog.innerHTML='<header><div><small>HUMAN RESOURCES · ATTENDANCE</small><h2 id="earlyReviewTitle">'+(decision==='Approved'?'Approve early time-out':'Reject early time-out')+'</h2></div><button type="button" data-close aria-label="Close early time-out review">×</button></header><div class="early-review-body"><p data-status role="status">Confirming the saved request…</p><div data-details></div><label>Management reply<textarea data-reply rows="3" maxlength="1500" placeholder="Optional note to the staff member"></textarea></label><p>Approval permits early clock-out for up to 30 minutes. It does not end the shift. Staff must tap Time Out when they finish; actual recorded hours remain on file.</p></div><footer><button type="button" data-confirm disabled>'+(decision==='Approved'?'Approve early time-out':'Reject request')+'</button></footer>';
  d.body.append(dialog);currentDialog=dialog;dialog.showModal();const status=dialog.querySelector('[data-status]'),confirm=dialog.querySelector('[data-confirm]'),close=dialog.querySelector('[data-close]'),reply=dialog.querySelector('[data-reply]');let busy=false,timer;
  const current=()=>token===generation&&dialog.open&&identity()===key;
  close.onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());
  try{
   const snap=await Promise.race([w.getDocFromServer(w.doc(w.db,'staff_requests',requestId)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ and reopen the request.')),25000);})]);
   if(!current())return;if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('The saved request could not be confirmed. Refresh Request Inbox.');
   const row=snap.data();if(row.type!=='Early Time Out'||row.status!=='Pending'||!canReviewEarlyTimeOut(w,row.branch))throw Error('This request is no longer pending or is outside your branch access.');
   dialog.querySelector('[data-details]').innerHTML='<p><strong>'+escape(row.staffName)+'</strong> · '+escape(row.branch)+'</p>'+earlyTimeOutSummaryHTML(row);status.textContent='Review the staff member, scheduled finish and reason before confirming.';confirm.disabled=false;
   confirm.onclick=async()=>{if(busy||!current())return;busy=true;confirm.disabled=close.disabled=reply.disabled=true;status.textContent='Saving this approval with HQ…';
    try{const result=await service.review({requestId,decision,reviewNote:reply.value.trim(),expectedRequestVersion:row.requestVersion,expectedRequestToken:row.requestToken});if(!current())return;dialog.close();await w.loadInbox?.();await w.Swal.fire(decision==='Approved'?'Early time-out approved':'Request rejected',result.alreadySaved?'This decision was already saved.':decision==='Approved'?'Staff can now tap Time Out within the approved time window (up to 30 minutes). Recorded hours are preserved.':'The shift stays open. Staff can see your reply.','success');}
    catch(error){if(current()){status.textContent=error.message||'The save could not be confirmed. Retry this same review.';status.setAttribute('role','alert');}}
    finally{busy=false;if(dialog.open)confirm.disabled=close.disabled=reply.disabled=false;}
   };
  }catch(error){if(current()){status.textContent=error.message;status.setAttribute('role','alert');}}finally{clearTimeout(timer);}
 }
 return {review,service};
}
