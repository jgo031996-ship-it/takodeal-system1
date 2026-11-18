import {createAttendanceOvertimeService,attendanceOvertimeAmount} from './attendance-overtime.js';
import {canCorrectOwnerTimeOut} from './owner-time-out-correction.js';
import {loadStaffDirectory} from './staff-directory-reader.js';
import {invalidatePayrollLoad} from './payroll-loading.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const when=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)';
export function attendanceOvertimeAction(timeOutId){return '<button type="button" data-attendance-ot="'+escape(timeOutId)+'" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;min-height:44px;padding:7px 10px;border-radius:6px;font-weight:bold;cursor:pointer">OT bonus · work date</button>';}
export function installAttendanceOvertimeUI(w,d,{service=createAttendanceOvertimeService(w)}={}){
 let dialog=null,generation=0;
 const actor=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 async function open({timeOutId,staffId}={}){
  if(!canCorrectOwnerTimeOut(w))return w.ManagerUI?.notify?.('Only the verified Owner can manage OT bonuses.');
  dialog?.close();dialog?.remove();const token=++generation,key=actor(),node=d.createElement('dialog');dialog=node;node.id='attendanceOvertimeDialog';node.setAttribute('aria-labelledby','attendanceOvertimeTitle');node.className='owner-time-out-correction attendance-ot-dialog';
  node.innerHTML='<header><h2 id="attendanceOvertimeTitle">'+(timeOutId?'OT bonus for this Time Out':'Review OT bonus history')+'</h2><button type="button" data-close aria-label="Close OT bonus review">&times;</button></header><div class="owner-time-out-body"><p data-status role="status" aria-live="polite">Checking the shift and payroll with HQ…</p><div data-selector></div><div data-shift></div><div data-grant></div><div data-confirmation></div><details data-history-panel '+(timeOutId?'':'open')+'><summary>Saved OT bonus history</summary><div data-history></div>'+(timeOutId?'<button type="button" data-full-history>View all work dates</button>':'')+'</details></div><footer><button type="button" data-close>Close</button><button type="button" data-refresh>Refresh saved result</button></footer>';
  d.body.append(node);node.showModal();const q=selector=>node.querySelector(selector),status=q('[data-status]'),shift=q('[data-shift]'),grant=q('[data-grant]'),history=q('[data-history]'),confirmation=q('[data-confirmation]');let view=null,busy=false,loading=false,intent=null,readAttempt=0;
  const draft={hours:'',reason:''};let historyRows=[],historyRequest=0;
  const current=()=>dialog===node&&node.open&&token===generation&&actor()===key&&canCorrectOwnerTimeOut(w);
  const assertCurrent=()=>{if(!current())throw Error('The Owner account or OT review changed.');};
  const message=(text,error=false)=>{status.textContent=text;status.style.color=error?'#9a3412':'#375a4c';};
  const controls=()=>{for(const control of node.querySelectorAll('button,input,select,textarea'))if(!control.hasAttribute('data-close'))control.disabled=busy||!current()||(loading&&!control.hasAttribute('data-hours')&&!control.hasAttribute('data-reason'))||(!control.hasAttribute('data-refresh')&&service.isSaving?.()===true)||control.hasAttribute('data-review-grant')&&!view?.canGrant;};
  for(const button of node.querySelectorAll('[data-close]'))button.onclick=()=>node.close();node.addEventListener('close',()=>{if(dialog===node)dialog=null;node.remove();});
  function form(){
   if(q('[data-hours]'))return;
   grant.innerHTML='<section><h3>Add OT bonus</h3><label style="display:block;margin:12px 0">OT hours<input data-hours type="number" min="0.01" max="24" step="0.25" style="display:block;min-height:44px;width:100%;box-sizing:border-box"></label><p data-amount>Calculated OT bonus: ₱0.00</p><label style="display:block;margin:12px 0">Reason (at least 8 characters)<textarea data-reason minlength="8" rows="2" maxlength="1000" style="display:block;min-height:60px;width:100%;box-sizing:border-box"></textarea></label><button type="button" data-review-grant style="min-height:44px">Review OT bonus</button></section>';
   const hours=q('[data-hours]'),reason=q('[data-reason]');
   hours.value=draft.hours;reason.value=draft.reason;
   hours.addEventListener('input',()=>{draft.hours=hours.value;clearReview();calculate();});
   reason.addEventListener('input',()=>{draft.reason=reason.value;clearReview();});
   calculate();
  }
  function clearReview(){intent=null;confirmation.innerHTML='';}
  function calculate(){
   if(!q('[data-amount]'))return;
   let value='The amount will appear when HQ confirms the shift rate.';
   if(view?.canGrant){try{value='Calculated OT bonus: '+money(attendanceOvertimeAmount(view,Number(q('[data-hours]').value)));}catch{value='Enter OT hours to calculate the amount.';}}
   q('[data-amount]').textContent=value;
  }
  function displayHistory(bonuses){
   historyRows=bonuses;
   history.innerHTML=historyRows.length?historyRows.map((row,index)=>'<article style="padding:12px 0;border-bottom:1px solid #dce5df"><strong>'+escape(row.workDate||'Work date needs review')+' · '+money(row.amount)+'</strong><br>'+escape(row.hours)+' hours · '+escape(row.status)+(row.legacy?' · legacy saved bonus':'')+'<p style="white-space:pre-wrap">'+escape(row.remarks)+'</p><small>Reference: '+escape(row.id)+'</small>'+(row.canCancel?'<p><button type="button" data-remove-ot="'+index+'" style="min-height:44px;color:#9a3412">Remove mistaken unpaid bonus</button></p>':'<p>'+escape(row.cancellationReason||row.hold||'Removal saved; original details retained.')+'</p>')+(row.previous?.length?'<details><summary>Previous OT revisions · '+row.previous.length+'</summary>'+row.previous.map(prior=>'<p>Revision '+escape(prior.revision)+' · '+money(prior.amount)+' · '+escape(prior.hours)+' hours · '+escape(prior.status)+'<br>'+escape(prior.reason)+'<br>Removal: '+escape(prior.cancellationReason)+'</p>').join('')+'</details>':'')+'</article>').join(''):'<p>No saved OT bonuses in this view.</p>';
  }
  function render(){
   if(timeOutId){shift.innerHTML='<section style="padding:14px;background:#f0f8f4;border-radius:8px"><strong>'+escape(view.staffName)+' · '+escape(view.branch)+'</strong><p style="font-size:19px;font-weight:bold">Work date: '+escape(view.workDate)+'</p><p>Time In: '+escape(when(view.timeInAt))+'<br>Time Out: '+escape(when(view.timeOutAt))+'</p><small>Daily wage for this date: '+money(view.dailyRate)+(view.appliedNightRate?' + '+money(view.appliedNightRate)+' night rate':'')+' · OT hourly rate: '+money(view.hourlyRate)+'</small></section>';
    if(view.canGrant){form();calculate();}else grant.innerHTML='<p class="ot-hold">'+escape(view.hold)+'</p>';
   }else{shift.innerHTML='<p><strong>'+escape(view.staffName)+' · '+escape(view.branch)+'</strong></p>';grant.innerHTML='';}
   displayHistory(view.bonuses);
   if(timeOutId)q('[data-full-history]').hidden=false;
   controls();
  }
  async function load(receipt=''){
   if(loading||busy||!current())return;
   loading=true;historyRequest++;view=null;intent=null;confirmation.innerHTML='';
   if(timeOutId){form();calculate();}
   controls();message(receipt|| (timeOutId?'Enter the OT hours and reason while HQ checks this work date.':'Loading saved bonuses…'));
   const attempt=++readAttempt;let timer;
   try{
    const read=timeOutId?service.inspect(timeOutId,{workDateOnly:true}):service.history(staffId);
    const result=await Promise.race([read,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ took too long to confirm the shift. Choose Refresh saved result to retry.')),60000);})]);
    if(!current()||attempt!==readAttempt)return;
    view=result;render();message(timeOutId?'Review the original work date and OT amount before saving.':'Select a saved bonus to review.');
   }catch(error){if(current()){view=null;history.innerHTML=shift.innerHTML='';if(!timeOutId)grant.innerHTML='';message(error.message||'HQ could not confirm the saved OT history.',true);}}
   finally{clearTimeout(timer);loading=false;if(current())controls();}
  }
  function reviewGrant(){if(!view?.canGrant||busy||loading||!current())return;try{const hours=Number(q('[data-hours]').value),reason=q('[data-reason]').value.trim(),amount=attendanceOvertimeAmount(view,hours);if(reason.length<8){q('[data-reason]').focus?.();throw Error('Enter at least 8 characters in Reason to review the bonus.');}intent={kind:'grant',input:{timeOutId,expectedFingerprint:view.sourceFingerprint,hours,reason}};confirmation.innerHTML='<section style="padding:14px;background:#fff7ed"><h3>Confirm OT bonus</h3><p><strong>'+escape(view.staffName)+' · Work date '+escape(view.workDate)+'</strong><br>'+escape(hours)+' OT hours · '+money(amount)+'</p><p>'+escape(reason)+'</p><p>This creates one bonus linked to this saved Time Out. It does not pay a payslip.</p><button type="button" data-confirm style="min-height:44px">Save OT bonus</button> <button type="button" data-back style="min-height:44px">Back</button></section>';message('Review the work date and amount before saving.');confirmation.scrollIntoView?.({block:'nearest'});q('[data-confirm]')?.focus?.();}catch(error){confirmation.textContent=error.message;message(error.message,true);}}
  function remove(index){const row=historyRows[index];if(!row?.canCancel||busy||loading||!current())return;intent={kind:'cancel',row};confirmation.innerHTML='<section style="padding:14px;background:#fff7ed"><h3>Remove mistaken unpaid OT</h3><p><strong>'+escape(view.staffName)+' · Saved work date '+escape(row.workDate)+'</strong><br>'+money(row.amount)+' · '+escape(row.hours)+' hours</p><p>Reference: '+escape(row.id)+'</p><p>The bonus will be excluded from unpaid payroll. Its original amount, date and explanation remain in history. A paid bonus cannot be removed.</p><label>Reason for removal<textarea data-removal-reason rows="2" maxlength="1000" style="display:block;min-height:60px;width:100%;box-sizing:border-box"></textarea></label><button type="button" data-confirm style="min-height:44px">Confirm removal</button> <button type="button" data-back style="min-height:44px">Keep bonus</button></section>';message('Explain the mistaken unpaid bonus. Nothing has been removed yet.');confirmation.scrollIntoView?.({block:'nearest'});}
  async function saved(result){if(!current())return;intent=null;confirmation.innerHTML='';invalidatePayrollLoad(w);w.getPayrollPreviewGuard?.().invalidate?.('OT bonus changed. Generate the unpaid payroll list again.');busy=false;draft.hours='';draft.reason='';const receipt=result.cancelled?'OT removal saved.':'OT bonus saved for this shift.';message(receipt);grant.innerHTML='';await load(receipt+' Refreshing the saved details…');if(current()&&!view){message(receipt+' Refresh to reload the saved details.');return;}if(current())message(result.cancelled?'OT removal saved. Original details remain in history. Generate List again for unpaid payroll.':'OT bonus saved for this shift. Generate List again for unpaid payroll.');}
  async function commit(){if(!intent||busy||loading||!current()||service.isSaving?.())return;let input;try{if(intent.kind==='grant'){if(Number(q('[data-hours]').value)!==intent.input.hours||q('[data-reason]').value.trim()!==intent.input.reason)throw Error('The OT details changed. Review them again.');input=intent.input;}else{const reason=q('[data-removal-reason]').value.trim();if(reason.length<8)throw Error('Explain the removal using at least 8 characters.');input={staffId:view.staffId,bonusId:intent.row.id,expectedFingerprint:intent.row.expectedFingerprint,reason};}busy=true;controls();message('Saving with HQ. Keep this reference until its result is confirmed.');await saved(await service[intent.kind==='grant'?'grant':'cancel'](input));}catch(error){if(current())message(error.message||'The OT change was not confirmed. Refresh the same saved result before retrying.',true);if(error.code==='attendance-ot/pending'&&error.settled)Promise.resolve(error.settled).then(saved,lateError=>{if(current()){message(lateError.message||'HQ did not save this OT change. Refresh its saved result before retrying.',true);controls();}}).catch(()=>{});}finally{busy=false;if(current())controls();}}
  node.addEventListener('click',event=>{const target=event.target.closest?.('button');if(!target)return;if(target.hasAttribute('data-review-grant'))reviewGrant();if(target.hasAttribute('data-remove-ot'))remove(Number(target.getAttribute('data-remove-ot')));if(target.hasAttribute('data-confirm'))void commit();if(target.hasAttribute('data-back')&&!busy){intent=null;confirmation.innerHTML='';message('Nothing submitted. The saved bonus is unchanged.');}});q('[data-refresh]').onclick=()=>void load();
  if(timeOutId)q('[data-full-history]').onclick=async()=>{
   if(!view||busy||loading||!current())return;
   const button=q('[data-full-history]'),request=++historyRequest;button.disabled=true;
   try{
    const result=await service.history(view.staffId);
    if(!current()||request!==historyRequest)return;
    displayHistory(result.bonuses);button.hidden=true;
   }catch(error){if(current()&&request===historyRequest)message(error.message||'Could not load the older OT bonuses.',true);}
   finally{if(current()&&request===historyRequest)button.disabled=false;}
  };
  if(!timeOutId&&!staffId){loading=true;controls();try{const profiles=await loadStaffDirectory(w,{page:'payroll',assertCurrent,readRates:()=>false});assertCurrent();const select=d.createElement('select');select.setAttribute('aria-label','Staff OT bonus history');select.style.cssText='min-height:44px;width:100%';const placeholder=d.createElement('option');placeholder.value='';placeholder.textContent='Choose staff to review OT history';select.append(placeholder);for(const profile of profiles.sort((a,b)=>String(a.cashierName).localeCompare(String(b.cashierName)))){const option=d.createElement('option');option.value=profile.staffId||profile.id;option.textContent=profile.cashierName+' · '+profile.branch;select.append(option);}q('[data-selector]').append(select);select.onchange=()=>{staffId=select.value;if(staffId)void load();};message('Choose an employee to review existing OT. Add a new bonus from that employee’s saved Time Out.');}catch(error){if(current())message(error.message,true);}finally{loading=false;if(current())controls();}}
  else await load();return node;
 }
 return {open:timeOutId=>open({timeOutId}),history:staffId=>open({staffId}),close:()=>dialog?.close(),service};
}
