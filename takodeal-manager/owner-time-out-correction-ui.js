import {canCorrectOwnerTimeOut} from './owner-time-out-correction.js';
import {createOwnerTimeOutClient} from './owner-time-out-client.js';
import {validateManualAttendance} from './attendance-audit.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const when=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Not recorded';
const local=value=>{const at=new Date(value);return Number.isFinite(+at)?new Date(+at+8*3600000).toISOString().slice(0,19):'';};
const messages={accepted:'Your reason has been reviewed and accepted. The actual departure shown in this review is recorded for this shift.',correction:'The previously saved departure was checked and corrected to the actual Time Out shown in this review.'};
export function installOwnerTimeOutCorrectionUI(w,d,{service=createOwnerTimeOutClient(w),refreshTimeoutMs=12000}={}){
 let dialog=null,generation=0;
 const actor=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.auth?.currentUser?.emailVerified,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 async function open(context={}){
  if(!canCorrectOwnerTimeOut(w,context.branch))return w.ManagerUI?.notify?.('Only the verified Owner can record a confirmed actual Time Out.');
  dialog?.close();dialog?.remove();const key=actor(),token=++generation;let view=null,busy=false,loading=false,review=null,submitted=null;
  const node=d.createElement('dialog');dialog=node;node.className='owner-time-out-correction';node.id='ownerTimeOutCorrectionDialog';node.setAttribute('aria-labelledby','ownerTimeOutCorrectionTitle');
  node.innerHTML='<header><div><small>OWNER · ATTENDANCE REVIEW</small><h2 id="ownerTimeOutCorrectionTitle">Accept reason & record Time Out</h2></div><button type="button" data-close aria-label="Close Time Out correction">×</button></header><div class="owner-time-out-body"><p class="owner-time-out-note">Accept the staff reason and record their departure together. Check the full date and time below. Approving an older request uses the departure you confirm here, not today’s approval time.</p><p data-status role="status" aria-live="polite">Checking saved attendance…</p><div data-source></div><div data-form hidden><label>Actual departure · Philippine date and time<input data-actual type="datetime-local" step="1" required aria-describedby="ownerTimeOutActualHelp"></label><p id="ownerTimeOutActualHelp">A request’s submission time may be suggested for convenience. Change it if the employee left at another time. For an overnight shift, check the next day’s date.</p><label>Message template<select data-template><option value="accepted">Reason accepted · record departure</option><option value="correction">Correct a saved departure</option><option value="custom">Write my own message</option></select></label><label>Review message / correction reason<textarea data-reason rows="3" maxlength="1500" placeholder="Choose a message or explain the correction · at least 8 characters"></textarea></label><label class="owner-time-out-check"><input type="checkbox" data-verified><span>I checked this departure with the staff member or branch and confirm it is their actual Time Out.</span></label><div data-review></div></div></div><footer><button type="button" data-close>Close</button><button type="button" data-refresh>Refresh saved attendance</button><button type="button" data-prepare disabled>Review & confirm</button></footer>';
  d.body.append(node);node.showModal();const el=selector=>node.querySelector(selector),status=el('[data-status]'),source=el('[data-source]'),form=el('[data-form]'),actual=el('[data-actual]'),reason=el('[data-reason]'),verified=el('[data-verified]'),template=el('[data-template]'),prepare=el('[data-prepare]'),refresh=el('[data-refresh]'),panel=el('[data-review]');
  const current=()=>dialog===node&&token===generation&&node.open&&actor()===key&&canCorrectOwnerTimeOut(w,view?.branch||context.branch);
  const message=(text,error=false)=>{status.textContent=text;status.dataset.tone=error?'warning':'';};
  const controls=()=>{prepare.disabled=busy||loading||!current()||!view?.canSave||service.isSaving?.()===true;refresh.disabled=busy||loading;for(const field of [actual,reason,verified,template])field.disabled=busy||loading||!view?.canSave;for(const button of node.querySelectorAll('[data-confirm],[data-back]'))button.disabled=busy||loading||service.isSaving?.()===true;};
  node.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>node.close());node.addEventListener('close',()=>{if(dialog===node)dialog=null;node.remove();});
  if(typeof context.onReturn==='function'){const back=d.createElement('button');back.type='button';back.setAttribute('data-return-review','');back.textContent='Back to schedule review';back.onclick=()=>{if(!current())return;node.close();if(actor()===key)void context.onReturn();};el('footer').append(back);}
  async function inspect(){
   if(loading||busy||!current())return;loading=true;review=null;panel.innerHTML='';controls();message('Checking the exact Time In, saved Time Out and payroll…');
   try{
    const checked=await service.inspect(context);if(!current())return;view=checked;
    el('#ownerTimeOutCorrectionTitle').textContent=view.request?'Accept reason & record Time Out':view.existingTimeOut?'Correct saved Time Out':'Record actual Time Out';
    source.innerHTML='<dl><div><dt>Employee / branch</dt><dd>'+escape(view.staffName)+' · '+escape(view.branch)+'</dd></div><div><dt>Original Time In</dt><dd>'+escape(when(view.timeInAt))+'</dd></div><div><dt>Time In reference</dt><dd>'+escape(view.context.attendanceLogId)+'</dd></div>'+(view.existingTimeOut?'<div><dt>Currently saved Time Out</dt><dd>'+escape(when(view.existingTimeOut.timestamp))+'</dd></div>':'')+(view.request?'<div><dt>Request status</dt><dd>'+escape(view.request.status)+'</dd></div><div><dt>Request sent · reference only</dt><dd>'+escape(when(view.request.requestedDepartureAt))+'</dd></div>':'')+'</dl>'+(view.request?.reason?'<p class="owner-time-out-note owner-time-out-reason">Staff reason: '+escape(view.request.reason)+'</p>':'');
    form.hidden=!view.canSave;
    if(view.paidCutoffs.length){message('A paid payslip covers this shift. Its saved figures need a separate Owner payroll review; no departure was changed.',true);source.innerHTML+='<p>'+view.paidCutoffs.map(row=>escape(row.from+' to '+row.to)).join('<br>')+'</p>';}
    else if(view.existingTimeOut)message('A departure is already saved. You can accept the same time or correct it below. The original value is kept in the correction history.');
    else message('Confirm the actual departure below. Accepting the reason and recording Time Out will be saved together.');
    if(!actual.value){const suggested=view.request?.requestedDepartureAt||view.existingTimeOut?.timestamp;const distance=Date.parse(suggested)-Date.parse(view.timeInAt);if(distance>0&&distance<=18*3600000)actual.value=local(suggested);}
    if(!reason.value){template.value=view.existingTimeOut?'correction':'accepted';reason.value=context.reviewNote?.trim()||messages[template.value];}
    if(submitted&&(view.lastOperationId||view.existingTimeOut?.operationId)===submitted.operationId)completed({saved:true,id:view.existingTimeOut.id,timestamp:view.existingTimeOut.timestamp,requestStatus:view.request?.status});
   }catch(error){if(current())message(error.message||'The saved attendance could not be confirmed.',true);}
   finally{loading=false;if(current())controls();}
  }
  function preview(){
   if(!current()||!view?.canSave||busy||loading||service.isSaving?.())return;
   try{
    const user=w.auth.currentUser,payload=validateManualAttendance({staffId:view.staffId,staffName:view.staffName,branch:view.branch,type:'TIME OUT',dateTimeRaw:actual.value,remarks:reason.value.trim()},{actor:{uid:user.uid,email:user.email,name:w.sessionUser.email},allowed:true,branchAllowed:branch=>canCorrectOwnerTimeOut(w,branch)});
    if(reason.value.trim().length<8||reason.value.trim().length>1500)throw Error('Use a review message between 8 and 1,500 characters.');
    if(verified.checked!==true)throw Error('Confirm the actual departure checkbox before approving. The request time is a reference until you verify it.');
    const details={context:{...view.context},expectedFingerprint:view.expectedFingerprint,dateTimeRaw:actual.value,reason:reason.value.trim(),managementReply:reason.value.trim(),confirmActualDeparture:true,acceptReason:!!view.request};
    const same=submitted&&JSON.stringify(details)===submitted.details;
    const makeId=w.crypto?.randomUUID?.bind(w.crypto)||globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if(!same&&!makeId)throw Error('Reopen the updated app before confirming this departure.');
    review={...details,operationId:same?submitted.operationId:makeId()};
    panel.innerHTML='<article><h3>Confirm the actual departure</h3><p><strong>'+escape(view.staffName)+' · '+escape(view.branch)+'</strong><br>Time In: '+escape(when(view.timeInAt))+(view.existingTimeOut?'<br>Previously saved Time Out: '+escape(when(view.existingTimeOut.timestamp)):'')+'<br>Actual Time Out: <strong>'+escape(when(payload.timestamp))+'</strong></p><p class="owner-time-out-reason">'+escape(review.reason)+'</p><p>'+(view.request?'This accepts the staff reason and records the confirmed departure together. ':'This records the confirmed departure. ')+'The original evidence stays in correction history. Assigned hours remain separate; unpaid payroll is refreshed after saving. Paid payslips keep their saved figures.</p><div><button type="button" data-confirm>'+(view.request?'Approve reason & record Time Out':'Save confirmed actual Time Out')+'</button><button type="button" data-back>Back · keep editing</button></div></article>';
    message('Check the full departure date and time. Nothing has been submitted yet.');controls();panel.scrollIntoView?.({block:'nearest'});panel.querySelector('[data-confirm]')?.focus?.();
   }catch(error){review=null;panel.innerHTML='';message(error.message,true);}
  }
  function completed(result){
   if(actor()!==key||!canCorrectOwnerTimeOut(w,context.branch))return;
   const requestId=view?.context?.requestId;
   const accepted=result.requestStatus?' · Reason accepted.':'';
   const hours=result.requiresScheduleReview?' Assigned hours still need Owner review.':'';
   if(current()){review=null;submitted=null;panel.innerHTML='';view={...view,canSave:false,existingTimeOut:{id:result.id,timestamp:result.timestamp}};form.hidden=true;source.innerHTML='<dl><div><dt>Employee / branch</dt><dd>'+escape(view.staffName)+' · '+escape(view.branch)+'</dd></div><div><dt>Original Time In</dt><dd>'+escape(when(view.timeInAt))+'</dd></div><div><dt>Confirmed actual Time Out</dt><dd>'+escape(when(result.timestamp))+'</dd></div><div><dt>Request result</dt><dd>'+escape(result.requestStatus?(result.requiresScheduleReview?'Reason accepted · assigned hours pending':'Reason accepted'):'Attendance correction saved')+'</dd></div></dl><p class="owner-time-out-note">The previous departure evidence is retained in correction history.</p>';message((result.alreadySaved?'This departure was already saved. ':'Actual Time Out saved. ')+when(result.timestamp)+accepted+hours+' Refreshing unpaid payroll separately…');controls();}
   let timer;const refreshWork=Promise.resolve().then(()=>{if(typeof w.refreshPayrollAfterAttendanceCorrection==='function')return w.refreshPayrollAfterAttendanceCorrection();w.invalidateCache?.('attendance_logs');w.getPayrollPreviewGuard?.().invalidate?.('Time Out saved. Generate List again to refresh unpaid payroll.');});
   Promise.race([refreshWork,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Payroll refresh timed out')),refreshTimeoutMs);})]).then(()=>{if(current())message('Actual Time Out saved. '+when(result.timestamp)+accepted+hours+' Payroll was refreshed when available. Other held records may still need review.');},()=>{if(current())message('Actual Time Out saved. '+when(result.timestamp)+accepted+hours+' Payroll refresh could not finish. The Time Out remains saved; use Generate List to refresh payroll.',true);}).finally(()=>clearTimeout(timer));
   if(result.requestStatus){try{Promise.resolve(w.applyConfirmedInboxRequest?.(requestId)||w.loadInbox?.()).catch(()=>{});}catch{}}
  }
  async function save(){
   if(!review||busy||loading||!current()||service.isSaving?.())return;
   if(actual.value!==review.dateTimeRaw||reason.value.trim()!==review.reason||verified.checked!==true){review=null;panel.innerHTML='';message('Details changed. Review the actual departure again before saving.',true);return;}
   const intent=review;submitted={operationId:intent.operationId,details:JSON.stringify(Object.fromEntries(Object.entries(intent).filter(([key])=>key!=='operationId')))};busy=true;controls();message('Saving the departure'+(intent.acceptReason?' and accepting the reason':'')+' with HQ…');
   try{completed(await service.save(intent));}
   catch(error){if(current())message(error.message||'The save was not confirmed. Refresh saved attendance or retry these same details.',true);if(error.code==='owner-time-out/pending'&&error.settled)Promise.resolve(error.settled).then(result=>{completed(result);if(current())controls();},()=>{}).catch(()=>{});}
   finally{busy=false;if(current())controls();}
  }
  node.addEventListener('click',event=>{if(event.target.closest('[data-confirm]'))void save();if(event.target.closest('[data-back]')&&!busy){review=null;panel.innerHTML='';message('Nothing submitted. Your details remain in the form.');}});
  const edited=()=>{if(review&&!busy){review=null;panel.innerHTML='';message('Details changed. Review the actual departure again before saving.');}};
  for(const field of [actual,reason,verified])for(const event of ['input','change'])field.addEventListener(event,edited);
  template.addEventListener('change',()=>{if(messages[template.value])reason.value=messages[template.value];edited();});
  prepare.onclick=preview;refresh.onclick=()=>void inspect();await inspect();return node;
 }
 return {open,close:()=>dialog?.close(),service};
}
