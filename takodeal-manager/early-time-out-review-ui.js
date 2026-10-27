import {createEarlyTimeOutReviewService,canReviewEarlyTimeOut} from './early-time-out-review.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>{if(value==null||value==='')return 'Needs schedule review';const at=value?.toDate?.()||new Date(value);return Number.isFinite(+at)?at.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Needs schedule review';};
export function earlyTimeOutSummaryHTML(row){const normal=row.status==='Completed Normally',closed=['Completed Normally','Consumed','Not Required','Cancelled','Rejected'].includes(row.status);return '<strong>'+(normal?'Normal Time Out recorded':row.requiresScheduleReview?'Time-out schedule review':'Early time-out approval')+'</strong><br>'+(normal?'<span>No early approval was used. The original request is retained for review.</span>':'<span>Scheduled finish: '+escape(date(row.scheduledEndAt))+'</span>')+'<br><small>'+escape(row.reason||'No reason recorded')+'</small>'+(row.managerReply?'<br><small>Management: '+escape(row.managerReply)+'</small>':'')+(row.requiresScheduleReview&&!closed?'<br><small>The saved roster does not confirm the assigned finish. This does not establish that the staff member left early. The request is not a recorded Time Out.</small>':'')+(row.id?'<br><small style="overflow-wrap:anywhere">Reference: '+escape(row.id)+'</small>':'');}
const requestIdentity=row=>JSON.stringify([row.type,row.status,row.branch,row.staffId,row.staffName,row.requestVersion,row.requestToken]);
const phDate=value=>{const at=value?.toDate?.()||new Date(value);if(!Number.isFinite(+at))return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(part=>[part.type,part.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
function validWorkDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const at=new Date(value+'T00:00:00Z');return Number.isFinite(+at)&&at.toISOString().slice(0,10)===value;}
const wallMinutes=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
export function installManagerEarlyTimeOutUI(w,d,{service=createEarlyTimeOutReviewService(w)}={}){
 let generation=0,currentDialog=null;
 const identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.auth?.currentUser?.emailVerified,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.role,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 async function review(requestId,decision){
  if(!['Approved','Rejected'].includes(decision)||!canReviewEarlyTimeOut(w))return w.Swal.fire('Approval access required','Sign in with Request Inbox access for this staff branch.','warning');
  const token=++generation,key=identity();currentDialog?.close();currentDialog?.remove();
  const dialog=d.createElement('dialog');dialog.className='early-time-out-review';dialog.setAttribute('aria-labelledby','earlyReviewTitle');
  dialog.innerHTML='<header><div><small>HUMAN RESOURCES · ATTENDANCE</small><h2 id="earlyReviewTitle">Time-out schedule review</h2></div><button type="button" data-close aria-label="Close time-out review">×</button></header><div class="early-review-body"><p data-status role="status">Confirming the saved request and scheduled finish…</p><button type="button" data-retry hidden>Retry schedule check</button><div data-details></div><nav class="early-review-record-actions" aria-label="Open the saved attendance or schedule"><button type="button" data-open-attendance hidden>Open this Time In</button><button type="button" data-open-schedule hidden>Open this workday schedule</button><button type="button" data-open-replacement hidden>Confirm replacement shift</button></nav><details data-shift-panel class="replacement-shift-panel" hidden><summary data-shift-title>Confirm replacement shift</summary><div class="replacement-shift-content"><p>For an emergency cover or swap, confirm the actual shift this staff member was asked to work. Enter the times yourself after checking with the branch.</p><p class="replacement-shift-note">This confirmation applies only to the original Time In. Attendance punches, the plotted schedule and payroll calculations stay on file. Early departure still needs its own approval.</p><div class="replacement-shift-grid"><label class="replacement-shift-wide">Work date (Philippine time)<input data-shift-date type="date" required></label><label>Scheduled start<input data-shift-start type="time" required></label><label>Scheduled finish<input data-shift-end type="time" required></label><label class="replacement-shift-wide">Role / shift name (optional)<input data-shift-name type="text" maxlength="120" placeholder="For example, replacement cashier"></label></div><p class="replacement-shift-note">A finish at or before the start means the next day. Use a shift lasting 1–18 hours.</p><p data-shift-preview class="replacement-shift-note" role="status"></p><label>Reason for confirming this shift<textarea data-shift-reason rows="3" minlength="8" maxlength="1500" placeholder="Explain the cover or swap and who confirmed these actual hours." required></textarea></label><p data-shift-status role="status"></p><button type="button" data-shift-confirm disabled>Save replacement shift</button></div></details><label>Management reply<textarea data-reply rows="3" maxlength="1500" placeholder="Optional note to the staff member"></textarea></label><p data-guidance>Checking this request does not record Time Out or change worked hours.</p></div><footer><button type="button" data-dismiss hidden disabled>Dismiss unnecessary request</button><button type="button" data-confirm disabled>'+(decision==='Approved'?'Approve early time-out':'Reject request')+'</button></footer>';
  d.body.append(dialog);currentDialog=dialog;dialog.showModal();
  const status=dialog.querySelector('[data-status]'),confirm=dialog.querySelector('[data-confirm]'),dismiss=dialog.querySelector('[data-dismiss]'),retry=dialog.querySelector('[data-retry]'),close=dialog.querySelector('[data-close]'),reply=dialog.querySelector('[data-reply]'),details=dialog.querySelector('[data-details]'),guidance=dialog.querySelector('[data-guidance]'),title=dialog.querySelector('#earlyReviewTitle');
  const shiftPanel=dialog.querySelector('[data-shift-panel]'),shiftDate=dialog.querySelector('[data-shift-date]'),shiftStart=dialog.querySelector('[data-shift-start]'),shiftEnd=dialog.querySelector('[data-shift-end]'),shiftName=dialog.querySelector('[data-shift-name]'),shiftReason=dialog.querySelector('[data-shift-reason]'),shiftStatus=dialog.querySelector('[data-shift-status]'),shiftConfirm=dialog.querySelector('[data-shift-confirm]'),shiftTitle=dialog.querySelector('[data-shift-title]'),shiftFields=[shiftDate,shiftStart,shiftEnd,shiftName,shiftReason];
  const shiftPreview=dialog.querySelector('[data-shift-preview]');
  const openAttendance=dialog.querySelector('[data-open-attendance]'),openSchedule=dialog.querySelector('[data-open-schedule]'),openReplacement=dialog.querySelector('[data-open-replacement]');
  let busy=false,loading=false,row=null,navigationRow=null,inspection=null,timer,shiftOperation=null,lastShiftIntent=null,confirmedReplacement=false;
  const current=()=>token===generation&&dialog.open&&identity()===key;
  function previewShiftDates(){
   const workDate=shiftDate.value,start=wallMinutes(shiftStart.value),end=wallMinutes(shiftEnd.value);
   shiftPreview.setAttribute('role','status');
   if(!validWorkDate(workDate)||Number(workDate.slice(0,4))<2000||Number(workDate.slice(0,4))>2199||start===null||end===null){shiftPreview.textContent='Choose the work date and both times to see their full Philippine dates before saving.';return;}
   const duration=end-start+(end<=start?1440:0),planned=new Date(workDate+'T'+shiftStart.value+':00+08:00'),finish=new Date(+planned+duration*60000),hours=Number((duration/60).toFixed(2));
   shiftPreview.textContent='Planned start: '+date(planned)+' · Planned finish: '+date(finish)+(end<=start?' · next day':'')+' · '+hours+' hours.';
   if(duration<60||duration>18*60){shiftPreview.textContent+=' Outside the allowed 1–18 hours. Correct the start or finish before saving.';shiftPreview.setAttribute('role','alert');}
  }
  for(const field of [shiftDate,shiftStart,shiftEnd])for(const event of ['input','change'])field.addEventListener(event,previewShiftDates);
  const eligible=()=>!!row&&!!inspection&&(decision==='Rejected'||inspection.early===true&&!inspection.unknown&&!inspection.closed&&!inspection.complete&&!inspection.scheduleChanged);
  const dismissible=()=>!!inspection&&(inspection.complete===true||inspection.closed===true)&&!inspection.unknown;
  const completingReview=()=>decision==='Approved'&&dismissible();
  const replacementNeeded=()=>!!row&&!!inspection&&!inspection.closed&&(inspection.unknown===true||inspection.scheduleChanged===true);
  const replacementEligible=()=>replacementNeeded()&&typeof service.confirmShift==='function'&&Number.isSafeInteger(inspection.emergencyShiftVersion)&&inspection.emergencyShiftVersion>=0&&typeof inspection.emergencyShiftSourceFingerprint==='string'&&!!inspection.emergencyShiftSourceFingerprint&&typeof inspection.scheduleFingerprint==='string'&&!!inspection.scheduleFingerprint&&canReviewEarlyTimeOut(w,row.branch);
  const recoveryContext=()=>{const saved=row||navigationRow;if(!saved||typeof saved.timeInLogId!=='string'||!saved.timeInLogId||saved.timeInLogId.includes('/')||!saved.staffId||!saved.branch||!phDate(saved.timeInAt))return null;return {attendanceLogId:saved.timeInLogId,staffId:saved.staffId,staffName:saved.staffName,branch:saved.branch,workDate:phDate(saved.timeInAt),requestId,requestVersion:saved.requestVersion,requestToken:saved.requestToken};};
  const canNavigate=kind=>!!recoveryContext()&&typeof w[kind==='attendance'?'openAttendanceRecovery':'openScheduleRecovery']==='function'&&canReviewEarlyTimeOut(w,(row||navigationRow).branch);
  const controls=()=>{confirm.textContent=completingReview()?'Confirm review':decision==='Approved'?'Approve early time-out':'Reject request';confirm.disabled=busy||loading||!current()||!(eligible()||completingReview());dismiss.hidden=!dismissible()||completingReview();dismiss.disabled=busy||loading||!current()||!dismissible();close.disabled=reply.disabled=busy;retry.disabled=busy||loading;shiftConfirm.disabled=busy||loading||!current()||!replacementEligible();for(const field of shiftFields)field.disabled=busy||loading||!current();for(const [button,kind]of [[openAttendance,'attendance'],[openSchedule,'schedule']]){button.hidden=!canNavigate(kind);button.disabled=busy||loading||!current()||!canNavigate(kind);}openReplacement.hidden=shiftPanel.hidden;openReplacement.disabled=busy||loading||!current()||!replacementEligible();};
  async function navigate(kind){if(busy||loading||!current()||!canNavigate(kind))return;const context=recoveryContext(),callback=w[kind==='attendance'?'openAttendanceRecovery':'openScheduleRecovery'];dialog.close();try{return await callback(context);}catch(error){if(identity()===key)await w.Swal.fire('Record could not be opened',error.message||'Reopen Request Inbox and try this saved record again.','warning');}}
  close.onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>{clearTimeout(timer);dialog.remove();});
  async function inspect({afterConfirmation=false}={}){
   if(loading||busy&&!afterConfirmation||!current())return;loading=true;row=null;navigationRow=null;inspection=null;retry.hidden=true;dismiss.hidden=true;controls();status.setAttribute('role','status');status.textContent=afterConfirmation?'Replacement shift saved. Rechecking the scheduled finish…':'Confirming the saved request and scheduled finish…';
   let accepting=true;
   try{
    let original;
    const verifyRequest=saved=>{if(!accepting||!current())return;if(saved.type!=='Early Time Out'||saved.status!=='Pending'||!canReviewEarlyTimeOut(w,saved.branch))throw Error('This request is no longer pending or is outside your branch access.');original=saved;navigationRow=saved;};
    const work=async()=>{
     if(service.includesVerifiedRequest===true)return service.inspect({requestId,onVerifiedRequest:verifyRequest});
     // Compatibility with a supplied legacy inspector. The production service
     // returns its own fresh request, so it needs no duplicate UI database get.
     const snap=await w.getDocFromServer(w.doc(w.db,'staff_requests',requestId));if(!accepting||!current())return null;
     if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('The saved request could not be confirmed. Refresh Request Inbox.');
     verifyRequest(snap.data());return service.inspect({requestId,expectedRequestVersion:original.requestVersion,expectedRequestToken:original.requestToken});
    };
    const checked=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ and retry the schedule check.')),25000);})]);
    clearTimeout(timer);if(!current())return;
    if(!original)throw Error('The saved request could not be confirmed. Refresh Request Inbox.');
    if(!current())return;
    if(!checked?.request||requestIdentity(checked.request)!==requestIdentity(original)||!canReviewEarlyTimeOut(w,checked.request.branch))throw Error('The saved request changed during the schedule check. Retry before reviewing it.');
    row=checked.request;inspection=checked;
    const unknown=checked.unknown===true||!checked.scheduledEndAt&&!checked.closed;
    if(unknown)inspection={...checked,unknown:true};
    const earlyLabel=checked.early&&!unknown&&!checked.scheduleChanged&&!checked.complete&&!checked.closed;
    details.innerHTML='<p><strong>'+escape(row.staffName)+'</strong> · '+escape(row.branch)+'</p><strong>'+(earlyLabel?'Early time-out approval':'Time-out schedule review')+'</strong><br><span>'+(unknown?'Scheduled finish: Needs schedule review':(checked.clockOutCompleteOnly?'Latest matching shift finish: ':'Verified scheduled finish: ')+escape(date(checked.scheduledEndAt)))+'</span><br><small>'+escape(row.reason||'No reason recorded')+'</small>'+(row.managerReply?'<br><small>Management: '+escape(row.managerReply)+'</small>':'')+(checked.scheduleChanged?'<br><small>The request originally listed: '+escape(date(row.scheduledEndAt))+'.</small>':'');
    if(checked.emergencyShift){const saved=checked.emergencyShift;details.innerHTML+='<p class="replacement-shift-summary"><strong>Confirmed replacement shift · version '+escape(saved.version)+'</strong><br>'+escape(saved.workDate)+' · '+escape(date(saved.expectedStartAt))+' to '+escape(date(saved.expectedEndAt))+(saved.shiftName?'<br>'+escape(saved.shiftName):'')+(saved.reviewedByEmail?'<br><small>Confirmed by '+escape(saved.reviewedByEmail)+'</small>':'')+'</p>';}
    shiftPanel.hidden=typeof service.confirmShift!=='function'||!replacementNeeded();shiftTitle.textContent=checked.emergencyShift?'Update replacement shift':'Confirm actual / replacement shift';shiftConfirm.textContent=checked.emergencyShift?'Save updated replacement shift':'Save confirmed shift';
    // A missing assignment (including work on a plotted day off) should show
    // its existing protected repair form immediately, not hide it behind an
    // ambiguous disabled Approve button. No times are inferred or filled in.
    if(inspection.unknown&&!shiftPanel.hidden)shiftPanel.open=true;
    if(!shiftDate.value)shiftDate.value=phDate(row.timeInAt);
    previewShiftDates();
    if(!shiftPanel.hidden&&!replacementEligible()){shiftStatus.textContent='Refresh the schedule check before confirming replacement hours.';shiftStatus.setAttribute('role','alert');}
    title.textContent=completingReview()?'Confirm time-out review':eligible()&&decision==='Approved'?'Approve early time-out':decision==='Rejected'?'Reject time-out request':'Time-out schedule review';
    if(inspection.unknown){status.textContent='The saved schedule reference could not be verified. This does not establish that the staff member left early. Approval is unavailable until the schedule reference is confirmed.';status.setAttribute('role','alert');guidance.textContent=typeof service.confirmShift==='function'?'For an emergency cover or swap, open Confirm replacement shift and verify the actual assigned hours. Then recheck this request. You can also reject it with an explanation or close the review while HQ checks the reference. Actual attendance punches stay on file.':'Keep the actual attendance punches on file. You can reject this request with an explanation, or close this review while HQ checks the saved reference.';}
    else if(checked.closed){status.textContent='Attendance already has a recorded Time Out. No early time-out approval is needed for this request.';guidance.textContent='Confirm review closes this unnecessary request with your reply. It does not alter the recorded Time Out, worked hours or payroll.';}
    else if(checked.complete){status.textContent=checked.clockOutCompleteOnly?'All matching saved shifts have finished. No early time-out approval is needed.':'The verified scheduled finish has already passed. No early time-out approval is needed.';guidance.textContent='Confirm review closes this request with your reply; early approval is not required. Staff should tap normal Time Out when they finish. This request is not a recorded Time Out and does not change actual worked hours.';}
    else if(checked.scheduleChanged){status.textContent='The verified saved schedule differs from this request. Review the verified scheduled finish shown here; the old request cannot authorize early Time Out.';status.setAttribute('role','alert');guidance.textContent=checked.emergencyShift?'Ask staff to refresh and reopen Time Out to submit a request for the confirmed replacement shift. If they are still leaving early, review that new request separately. Actual attendance and worked hours remain on file.':'Staff should retry Time Out using the current saved schedule. Actual attendance and worked hours remain on file.';}
    else if(checked.early){status.textContent='The saved schedule confirms that this shift has not reached its scheduled finish. Review the staff member and reason before confirming.';guidance.textContent='Approval permits early clock-out for up to 30 minutes. It does not end the shift. Staff must tap Time Out when they finish; actual recorded hours remain on file.';}
    else{inspection={...checked,unknown:true};status.textContent='The saved schedule result could not confirm whether early approval is needed. Retry the schedule check.';status.setAttribute('role','alert');retry.hidden=false;}
    dismiss.hidden=!dismissible()||completingReview();
    if(afterConfirmation)status.textContent='Replacement shift saved. '+status.textContent;
    return true;
   }catch(error){if(current()){row=null;inspection=null;status.textContent=(confirmedReplacement?'The replacement shift is saved. ':'')+(error.message||'The saved schedule could not be confirmed. Retry the schedule check.');status.setAttribute('role','alert');retry.hidden=false;}}
   finally{accepting=false;clearTimeout(timer);loading=false;if(dialog.open)controls();}
  }
  async function saveReplacement(){
   if(busy||loading||!current()||!replacementEligible())return;
   previewShiftDates();
   const workDate=shiftDate.value,startTime=shiftStart.value,endTime=shiftEnd.value,name=shiftName.value.trim(),reason=shiftReason.value.trim(),start=wallMinutes(startTime),end=wallMinutes(endTime);
   const problem=message=>{shiftStatus.textContent=message;shiftStatus.setAttribute('role','alert');};
   if(!validWorkDate(workDate)||Number(workDate.slice(0,4))<2000||Number(workDate.slice(0,4))>2199)return problem('Choose the actual Philippine work date for this replacement shift.');
   if(start===null||end===null)return problem('Enter both the scheduled start and finish. Staff remarks do not set these times.');
   const duration=end-start+(end<=start?1440:0);
   if(duration<60||duration>18*60)return problem('Use a shift lasting at least 1 hour and no more than 18 hours. A finish at or before the start belongs to the next day.');
   if(reason.length<8||reason.length>1500)return problem('Explain this replacement or swap in 8–1,500 characters.');
   if(name.length>120)return problem('Keep the optional role or shift name to 120 characters.');
   const actual=row.timeInAt?.toDate?.()||new Date(row.timeInAt),planned=new Date(workDate+'T'+startTime+':00+08:00'),finish=+planned+duration*60000,distance=(+actual-+planned)/60000;
   if(!Number.isFinite(+actual)||distance< -90||distance>=18*60||finish<=+actual||finish>+actual+24*3600000)return problem('These hours do not fit the original Time In. Confirm its actual work date and replacement start/finish before saving.');
   const input={requestId,expectedRequestVersion:row.requestVersion,expectedRequestToken:row.requestToken,expectedScheduleFingerprint:inspection.scheduleFingerprint,expectedConfirmationVersion:inspection.emergencyShiftVersion,expectedSourceFingerprint:inspection.emergencyShiftSourceFingerprint,workDate,startTime,endTime,shiftName:name,reason};
   const intent=JSON.stringify(input);
   if(intent!==lastShiftIntent){const makeId=w.crypto?.randomUUID?.bind(w.crypto)||globalThis.crypto?.randomUUID?.bind(globalThis.crypto);if(!makeId)return problem('Reopen the updated app before confirming this shift.');shiftOperation=makeId();lastShiftIntent=intent;}
   input.operationId=shiftOperation;busy=true;controls();shiftStatus.setAttribute('role','status');shiftStatus.textContent='Confirming the replacement hours with HQ…';let saved=false;
   try{
    const result=await service.confirmShift(input);if(!current())return;saved=true;confirmedReplacement=true;
    shiftStatus.textContent=result.alreadySaved?'These replacement hours were already saved. Rechecking the current finish…':'Replacement shift saved. Rechecking the current finish…';
    const refreshed=await inspect({afterConfirmation:true});
    if(refreshed&&current()&&inspection?.emergencyShiftVersion>=result.version){shiftReason.value='';shiftStatus.textContent='These replacement hours are saved. Enter a new reason before making another correction.';}
   }catch(error){if(current()){shiftStatus.textContent=(saved?'The replacement shift is saved. Retry the schedule check. ':'The replacement confirmation could not be confirmed. Retry these same hours after checking your connection. ')+(error.message||'');shiftStatus.setAttribute('role','alert');if(saved)retry.hidden=false;}}
   finally{busy=false;if(dialog.open)controls();}
  }
  async function save(isDismiss){
   if(busy||loading||!current()||!row||!canReviewEarlyTimeOut(w,row.branch)||(isDismiss?!dismissible():!eligible()))return;
   busy=true;controls();status.setAttribute('role','status');status.textContent=isDismiss?'Closing this unnecessary request with HQ…':decision==='Approved'?'Saving this approval with HQ…':'Saving this rejection with HQ…';
   try{
    const input={requestId,reviewNote:reply.value.trim(),expectedRequestVersion:row.requestVersion,expectedRequestToken:row.requestToken,expectedScheduleFingerprint:inspection.scheduleFingerprint};
    const result=isDismiss?await service.dismiss(input):await service.review({...input,decision});
    if(!current())return;dialog.close();if(identity()!==key)return;
    // The transaction has confirmed the decision. Updating the list must not
    // delay that confirmation or turn a later refresh failure into a save error.
    try{const refresh=typeof w.applyConfirmedInboxRequest==='function'?w.applyConfirmedInboxRequest(requestId):w.loadInbox?.();Promise.resolve(refresh).catch(()=>{if(identity()===key)w.ManagerUI?.notify?.('The decision is saved. Refresh Request Inbox to see its latest row.');});}catch{if(identity()===key)w.ManagerUI?.notify?.('The decision is saved. Refresh Request Inbox to see its latest row.');}
    await w.Swal.fire(isDismiss?'Time-out review completed':decision==='Approved'?'Early time-out approved':'Request rejected',result.alreadySaved?'This decision was already saved.':isDismiss?'Your review and reply were saved. Early approval was not required, so the request was closed as Not Required. Attendance, actual worked hours and payroll were not changed.':decision==='Approved'?'Staff can now tap Time Out within the approved time window (up to 30 minutes). Recorded hours are preserved.':'The request was rejected. Recorded attendance and worked hours are preserved.','success');
   }catch(error){if(current()){status.textContent=error.message||'The save could not be confirmed. Retry this same review.';status.setAttribute('role','alert');retry.hidden=false;}}
   finally{busy=false;if(dialog.open)controls();}
  }
  confirm.onclick=()=>save(completingReview());dismiss.onclick=()=>save(true);retry.onclick=()=>inspect();shiftConfirm.onclick=saveReplacement;
  openAttendance.onclick=()=>navigate('attendance');openSchedule.onclick=()=>navigate('schedule');openReplacement.onclick=()=>{if(busy||loading||!current()||!replacementEligible())return;shiftPanel.open=true;shiftPanel.scrollIntoView?.({block:'nearest'});shiftPanel.querySelector('summary')?.focus?.();};
  await inspect();
 }
 return {review,service};
}
