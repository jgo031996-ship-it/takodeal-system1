import {canCorrectOwnerTimeOut} from './owner-time-out-correction.js';
import {createOwnerTimeOutClient} from './owner-time-out-client.js';
import {validateManualAttendance} from './attendance-audit.js';
import {invalidatePayrollLoad} from './payroll-loading.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const when=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Not recorded';
const local=value=>{const at=new Date(value);return Number.isFinite(+at)?new Date(+at+8*3600000).toISOString().slice(0,19):'';};
const shiftWindow=view=>{const start=Date.parse(view?.timeInAt);if(!Number.isFinite(start))throw Error('The original Time In date could not be confirmed. Refresh saved attendance.');return {start,end:start+18*3600000};};
export function ownerTimeOutDepartureFields(view){
 const bounds=shiftWindow(view),within=value=>{const at=Date.parse(value);return Number.isFinite(at)&&at>bounds.start&&at<=bounds.end;},minimum=local(bounds.start+1000),maximum=local(bounds.end);
 let date=minimum.slice(0,10),time='',basis='Date anchored to the original Time In. Enter the actual departure time; use the following day if the employee left after midnight.';
 if(within(view.existingTimeOut?.timestamp)){const saved=local(view.existingTimeOut.timestamp);date=saved.slice(0,10);time=saved.slice(11);basis='This is the currently saved Time Out. Verify the date and time before accepting it or making a correction.';}
 else if(within(view.request?.requestedDepartureAt)){date=local(view.request.requestedDepartureAt).slice(0,10);basis='Date anchored to the request for this original shift. The request sent time is a reference; enter the actual departure time.';}
 else if(within(view.request?.scheduledEndAt)){date=local(view.request.scheduledEndAt).slice(0,10);basis='Date anchored to the saved scheduled finish. Assigned hours do not establish the actual departure; enter the actual time.';}
 return {date,time,basis,minDate:minimum.slice(0,10),maxDate:maximum.slice(0,10),minTime:minimum.slice(11),maxTime:maximum.slice(11)};
}
export function ownerTimeOutDepartureValue(date,time,view){
 if(!date)throw Error('Choose the actual departure date near the original Time In.');
 if(!time)throw Error('Enter the actual departure time. A date or scheduled finish does not record Time Out.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(time))throw Error('Enter a valid Philippine departure date and time.');
 const raw=date+'T'+time,at=Date.parse(raw+'+08:00'),roundtrip=local(at),bounds=shiftWindow(view);
 if(!Number.isFinite(at)||roundtrip.slice(0,raw.length)!==raw)throw Error('Enter a valid Philippine departure date and time.');
 if(at<=bounds.start||at>bounds.end)throw Error('The actual Time Out must follow this original Time In and stay within an 18-hour shift. Check the departure date.');
 return raw;
}
const messages={accepted:'Your reason has been reviewed and accepted. The actual departure shown in this review is recorded for this shift.',correction:'The previously saved departure was checked and corrected to the actual Time Out shown in this review.'};
export function installOwnerTimeOutCorrectionUI(w,d,{service=createOwnerTimeOutClient(w),refreshTimeoutMs=12000}={}){
 let dialog=null,generation=0;
 const actor=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.auth?.currentUser?.emailVerified,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 async function open(context={}){
  if(!canCorrectOwnerTimeOut(w,context.branch))return w.ManagerUI?.notify?.('Only the verified Owner can record a confirmed actual Time Out.');
  dialog?.close();dialog?.remove();const key=actor(),token=++generation;let view=null,busy=false,loading=false,review=null,submitted=null,departureTouched=false;
  const node=d.createElement('dialog');dialog=node;node.className='owner-time-out-correction';node.id='ownerTimeOutCorrectionDialog';node.setAttribute('aria-labelledby','ownerTimeOutCorrectionTitle');
  node.innerHTML='<header><div><small>OWNER · ATTENDANCE REVIEW</small><h2 id="ownerTimeOutCorrectionTitle">Accept reason & record Time Out</h2></div><button type="button" data-close aria-label="Close Time Out correction">×</button></header><div class="owner-time-out-body"><p class="owner-time-out-note">Accept the staff reason and record their departure together. Check the full date and time below. Approving an older request uses the departure you confirm here, not today’s approval time.</p><p data-status role="status" aria-live="polite">Checking saved attendance…</p><div data-source></div><div data-form hidden><fieldset class="owner-time-out-date-fields"><legend>Actual departure · Philippine date and time</legend><label>Departure date<input data-actual-date type="date" required aria-describedby="ownerTimeOutActualHelp"></label><label>Actual time<input data-actual-time type="time" step="1" required aria-describedby="ownerTimeOutActualHelp"></label></fieldset><div class="owner-time-out-date-shortcuts" data-date-shortcuts></div><p id="ownerTimeOutActualHelp" data-date-basis></p><label>Message template<select data-template><option value="accepted">Reason accepted · record departure</option><option value="correction">Correct a saved departure</option><option value="custom">Write my own message</option></select></label><label>Review message / correction reason<textarea data-reason rows="3" maxlength="1500" placeholder="Choose a message or explain the correction · at least 8 characters"></textarea></label><label class="owner-time-out-check"><input type="checkbox" data-verified><span>I checked this departure with the staff member or branch and confirm it is their actual Time Out.</span></label><div data-review></div></div></div><footer><button type="button" data-close>Close</button><button type="button" data-refresh>Refresh saved attendance</button><button type="button" data-prepare disabled>Review & confirm</button></footer>';
  d.body.append(node);node.showModal();const el=selector=>node.querySelector(selector),status=el('[data-status]'),source=el('[data-source]'),form=el('[data-form]'),actualDate=el('[data-actual-date]'),actualTime=el('[data-actual-time]'),dateBasis=el('[data-date-basis]'),dateShortcuts=el('[data-date-shortcuts]'),reason=el('[data-reason]'),verified=el('[data-verified]'),template=el('[data-template]'),prepare=el('[data-prepare]'),refresh=el('[data-refresh]'),panel=el('[data-review]');
  const current=()=>dialog===node&&token===generation&&node.open&&actor()===key&&canCorrectOwnerTimeOut(w,view?.branch||context.branch);
  const message=(text,error=false)=>{status.textContent=text;status.dataset.tone=error?'warning':'';};
  const controls=()=>{prepare.disabled=busy||loading||!current()||!view?.canSave||service.isSaving?.()===true;refresh.disabled=busy||loading;for(const field of [actualDate,actualTime,reason,verified,template,...dateShortcuts.querySelectorAll('button')])field.disabled=busy||loading||!view?.canSave;for(const button of node.querySelectorAll('[data-confirm],[data-back]'))button.disabled=busy||loading||service.isSaving?.()===true;};
  const dateBounds=()=>{if(!view)return;const bounds=ownerTimeOutDepartureFields(view);actualDate.min=bounds.minDate;actualDate.max=bounds.maxDate;actualTime.min=actualDate.value===bounds.minDate?bounds.minTime:'00:00:00';actualTime.max=actualDate.value===bounds.maxDate?bounds.maxTime:'23:59:59';};
  node.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>node.close());node.addEventListener('close',()=>{if(dialog===node)dialog=null;node.remove();});
  if(typeof context.onReturn==='function'){const back=d.createElement('button');back.type='button';back.setAttribute('data-return-review','');back.textContent='Back to schedule review';back.onclick=()=>{if(!current())return;node.close();if(actor()===key)void context.onReturn();};el('footer').append(back);}
  async function inspect(){
   if(loading||busy||!current())return;loading=true;review=null;panel.innerHTML='';controls();message('Checking the exact Time In, saved Time Out and payroll…');
   try{
    const checked=await service.inspect(context);if(!current())return;const changed=!!view&&view.expectedFingerprint!==checked.expectedFingerprint;view=checked;if(changed)verified.checked=false;
    el('#ownerTimeOutCorrectionTitle').textContent=view.request?'Accept reason & record Time Out':view.existingTimeOut?'Correct saved Time Out':'Record actual Time Out';
    source.innerHTML='<dl><div><dt>Employee / branch</dt><dd>'+escape(view.staffName)+' · '+escape(view.branch)+'</dd></div><div><dt>Original Time In</dt><dd>'+escape(when(view.timeInAt))+'</dd></div><div><dt>Time In reference</dt><dd>'+escape(view.context.attendanceLogId)+'</dd></div>'+(view.existingTimeOut?'<div><dt>Currently saved Time Out</dt><dd>'+escape(when(view.existingTimeOut.timestamp))+'</dd></div>':'')+(view.request?'<div><dt>Request status</dt><dd>'+escape(view.request.status)+'</dd></div><div><dt>Request sent · reference only</dt><dd>'+escape(when(view.request.requestedDepartureAt))+'</dd></div>':'')+'</dl>'+(view.request?.reason?'<p class="owner-time-out-note owner-time-out-reason">Staff reason: '+escape(view.request.reason)+'</p>':'');
    form.hidden=!view.canSave;
    if(view.paidCutoffs.length){message('A paid payslip covers this shift. Its saved figures need a separate Owner payroll review; no departure was changed.',true);source.innerHTML+='<p>'+view.paidCutoffs.map(row=>escape(row.from+' to '+row.to)).join('<br>')+'</p>';}
    else if(view.existingTimeOut)message('A departure is already saved. You can accept the same time or correct it below. The original value is kept in the correction history.');
    else message('Confirm the actual departure below. Accepting the reason and recording Time Out will be saved together.');
    const anchored=ownerTimeOutDepartureFields(view);
    if(!departureTouched){actualDate.value=anchored.date;actualTime.value=anchored.time;dateBasis.textContent=anchored.basis;}
    dateBounds();dateShortcuts.innerHTML='';
    if(anchored.minDate!==anchored.maxDate)for(const [label,date]of [['Time In date',anchored.minDate],['Following day',anchored.maxDate]]){const button=d.createElement('button');button.type='button';button.textContent=label+' · '+date;button.onclick=()=>{if(busy||loading||!current()||!view?.canSave)return;actualDate.value=date;departureTouched=true;verified.checked=false;dateBounds();edited();};dateShortcuts.append(button);}
    if(!reason.value){template.value=view.existingTimeOut?'correction':'accepted';reason.value=context.reviewNote?.trim()||messages[template.value];}
    if(submitted&&(view.lastOperationId||view.existingTimeOut?.operationId)===submitted.operationId)completed({saved:true,id:view.existingTimeOut.id,timestamp:view.existingTimeOut.timestamp,requestStatus:view.request?.status});
   }catch(error){if(current())message(error.message||'The saved attendance could not be confirmed.',true);}
   finally{loading=false;if(current())controls();}
  }
  function preview(){
   if(!current()||!view?.canSave||busy||loading||service.isSaving?.())return;
   try{
    const dateTimeRaw=ownerTimeOutDepartureValue(actualDate.value,actualTime.value,view),user=w.auth.currentUser,payload=validateManualAttendance({staffId:view.staffId,staffName:view.staffName,branch:view.branch,type:'TIME OUT',dateTimeRaw,remarks:reason.value.trim()},{actor:{uid:user.uid,email:user.email,name:w.sessionUser.email},allowed:true,branchAllowed:branch=>canCorrectOwnerTimeOut(w,branch)});
    if(reason.value.trim().length<8||reason.value.trim().length>1500)throw Error('Use a review message between 8 and 1,500 characters.');
    if(verified.checked!==true)throw Error('Confirm the actual departure checkbox before approving. The request time is a reference until you verify it.');
    const details={context:{...view.context},expectedFingerprint:view.expectedFingerprint,dateTimeRaw,reason:reason.value.trim(),managementReply:reason.value.trim(),confirmActualDeparture:true,acceptReason:!!view.request};
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
   invalidatePayrollLoad(w);
   const payrollContext={...view.context,isCurrent:()=>actor()===key};
   let timer;const refreshWork=Promise.resolve().then(()=>{if(typeof w.refreshPayrollAfterAttendanceCorrection==='function')return w.refreshPayrollAfterAttendanceCorrection(payrollContext);w.invalidateCache?.('attendance_logs');w.getPayrollPreviewGuard?.().invalidate?.('Time Out saved. Generate List again to refresh unpaid payroll.');});
   Promise.race([refreshWork,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Payroll refresh timed out')),refreshTimeoutMs);})]).then(()=>{if(current())message('Actual Time Out saved. '+when(result.timestamp)+accepted+hours+' Payroll was refreshed when available. Other held records may still need review.');},()=>{if(current())message('Actual Time Out saved. '+when(result.timestamp)+accepted+hours+' Payroll refresh could not finish. The Time Out remains saved; use Generate List to refresh payroll.',true);}).finally(()=>clearTimeout(timer));
   if(result.requestStatus){try{Promise.resolve(w.applyConfirmedInboxRequest?.(requestId)||w.loadInbox?.()).catch(()=>{});}catch{}}
  }
  async function save(){
   if(!review||busy||loading||!current()||service.isSaving?.())return;
   let dateTimeRaw;try{dateTimeRaw=ownerTimeOutDepartureValue(actualDate.value,actualTime.value,view);}catch(error){review=null;panel.innerHTML='';message(error.message,true);return;}
   if(dateTimeRaw!==review.dateTimeRaw||reason.value.trim()!==review.reason||verified.checked!==true){review=null;panel.innerHTML='';message('Details changed. Review the actual departure again before saving.',true);return;}
   const intent=review;submitted={operationId:intent.operationId,details:JSON.stringify(Object.fromEntries(Object.entries(intent).filter(([key])=>key!=='operationId')))};busy=true;controls();message('Saving the departure'+(intent.acceptReason?' and accepting the reason':'')+' with HQ…');
   try{completed(await service.save(intent));}
   catch(error){if(current())message(error.message||'The save was not confirmed. Refresh saved attendance or retry these same details.',true);if(error.code==='owner-time-out/pending'&&error.settled)Promise.resolve(error.settled).then(result=>{completed(result);if(current())controls();},()=>{}).catch(()=>{});}
   finally{busy=false;if(current())controls();}
  }
  node.addEventListener('click',event=>{if(event.target.closest('[data-confirm]'))void save();if(event.target.closest('[data-back]')&&!busy){review=null;panel.innerHTML='';message('Nothing submitted. Your details remain in the form.');}});
  const edited=()=>{if(review&&!busy){review=null;panel.innerHTML='';message('Details changed. Review the actual departure again before saving.');}};
  for(const field of [actualDate,actualTime])for(const event of ['input','change'])field.addEventListener(event,()=>{departureTouched=true;verified.checked=false;dateBounds();edited();});
  for(const field of [reason,verified])for(const event of ['input','change'])field.addEventListener(event,edited);
  template.addEventListener('change',()=>{if(messages[template.value])reason.value=messages[template.value];edited();});
  prepare.onclick=preview;refresh.onclick=()=>void inspect();await inspect();return node;
 }
 return {open,close:()=>dialog?.close(),service};
}
