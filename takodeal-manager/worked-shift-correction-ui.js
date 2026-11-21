import {createWorkedShiftCorrectionService} from './worked-shift-correction-service.js';
import {OWNER_EMAIL} from './workspace-access-model.js';
import {attendanceMillis} from './attendance-reconcile.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
export function workedShiftActionHint(api,data,log){
 const user=api?.auth?.currentUser;
 if(!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||api.sessionUser?.uid!==user.uid||!api.sessionUser?.isOwner||data?.isPaid||api.paidPayrollSnapshots?.has(data)||!log?.attendanceLogId||!data.staffId||log.out==='MISSED')return null;
 const start=attendanceMillis(log.timeInAt),end=attendanceMillis(log.timeOutAt),expected=attendanceMillis(log.expectedStartAt),finish=attendanceMillis(log.expectedEndAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>18*3600000||log.workedShiftCorrectionId&&!log.workedLeaveReview)return null;
 const overlap=Math.max(0,Math.min(end,finish)-Math.max(start,expected));
 if(log.workedLeaveReview||log.bonusReviewRequired||!Number.isFinite(expected)||!Number.isFinite(finish)||Math.abs(start-expected)>=3*3600000&&overlap<(end-start)/2)return {label:log.workedLeaveReview?'Review leave and worked shift':'Apply worked shift',context:{...(log.workedLeaveReview?{workDate:log.rateWorkDate,allowManual:true}:{}),attendanceLogId:log.attendanceLogId,staffId:data.staffId,branch:log.branch||data.branch,from:data.start,to:data.end}};
 return null;
}
export function installWorkedShiftCorrectionUI(w,d,{service=createWorkedShiftCorrectionService(w)}={}){
 if(w.workedShiftCorrectionUI)return w.workedShiftCorrectionUI;
 let dialog=null,pending=false,epoch=0;
 const tell=(text,error=false)=>w.ManagerUI?.notify?.(text,error?'warning':undefined);
 // Roster entry points identify a dated cell before choosing its exact Time In.
 async function open(context,{assertCurrent=()=>{},onApplied,refreshCutoff=!context.attendanceLogId}={}){
  if(pending)return false;
  pending=true;const token=++epoch;let view;
  const current=()=>{assertCurrent();if(token!==epoch)throw Error('The selected work record changed. Open it again.');};
  async function completed(result,node){
   current();
   node.dataset.workedShiftSaved='true';node.close();node.remove();if(dialog===node)dialog=null;
   w.invalidateCollectionCache?.('settings');
   w.invalidateCache?.('staff_requests');w.invalidateCollectionCache?.('staff_requests');
   w.invalidateCache?.('global_schedule');
   w.dispatchEvent?.(new w.CustomEvent('worked-shift-corrected',{detail:{...result,staffId:context.staffId,branch:context.branch}}));
   try{
    const from=d.getElementById('payrollStart')?.value,to=d.getElementById('payrollEnd')?.value;
    const reload=refreshCutoff&&from&&to&&from<=result.workDate&&result.workDate<=to;
    await Promise.all([onApplied?.(result),reload?w.refreshPayrollAfterAttendanceCorrection?.():null]);
    tell('Worked shift confirmed for '+result.workDate+' at '+view.branch+'.');
   }
   catch{tell('Hours saved for '+result.workDate+'. Open Payroll and select Generate List to refresh the payslip.',true);}
  }
  function choose(){
   dialog?.close();dialog?.remove();const node=d.createElement('dialog');dialog=node;node.setAttribute('aria-labelledby','workedShiftTitle');node.className='owner-time-out-correction payroll-worked-shift';node.style.cssText='position:fixed;inset:0;margin:auto;width:560px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:0;border:1px solid #cadbcf;border-radius:16px;background:#fff;color:#214738;box-shadow:0 24px 80px #102b2640';
   const records=view.recordChoices||[],choices=view.choices||[],blockers=view.blockers||[];
   const available=choices.filter(row=>!row.blockers.length),blocked=choices.filter(row=>row.blockers.length);
   const proposed=available.find(row=>row.shiftId===context.proposedShiftId),preferred=proposed?.key||view.recommendedKey;
   let selected=null,saving=false,proposal=null,draftKey='',manualMode=false,reviewedChange='',leaveReview='';
   const saved=view.confirmedDuty;
   node.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
   const rowTime=row=>esc(stamp(row.expectedStartAt))+' → '+esc(stamp(row.expectedEndAt));
   const notes=row=>[
     row.key===proposed?.key?'Requested by employee':'',
     row.ownerEntered?'Owner-entered hours for this punch.':row.standalone?'No dated roster for this branch. Select these hours only if you can confirm the assignment for this punch.':'',
     row.occupied?'Another employee holds this slot. Confirming records this employee’s duty only.':'',
     row.leave?'Approved '+row.leave.type+' · '+row.leave.date+' · request '+row.leave.requestId:'',
     row.undatedLeaveIds?.length?'A leave has incomplete dates. Confirm only if you verified this employee worked this date. The leave stays on file.':''
   ].filter(Boolean).map(note=>'<small style="display:block;margin-top:4px">'+esc(note)+'</small>').join('');
   const cards=available.map((row,index)=>'<label style="display:flex;align-items:flex-start;gap:10px;border:1px solid #a9c2b3;border-radius:8px;padding:12px;margin:8px 0;cursor:pointer"><input type="radio" name="workedShiftChoice" data-choice value="'+index+'"><span><strong>'+esc(row.shiftName)+'</strong><br>'+rowTime(row)+notes(row)+'</span></label>').join('');
   const unavailable=blocked.length?'<details><summary>Unavailable shifts ('+blocked.length+')</summary>'+blocked.map(row=>'<p><strong>'+esc(row.shiftName)+'</strong><br>'+esc(row.blockers.join(' '))+'</p>').join('')+'</details>':'';
   const options=records.length?'<label>Work record<select data-record style="display:block;width:100%;padding:12px">'+records.map(row=>'<option value="'+esc(row.attendanceLogId)+'">'+esc(stamp(row.timeInAt))+(row.timeOutAt?' → '+esc(stamp(row.timeOutAt)):' · missing Time Out')+'</option>').join('')+'</select></label>':'<fieldset style="padding:0;border:0"><legend>Which shift did this employee work?</legend>'+cards+'</fieldset>'+unavailable;
   const allowManual=!records.length&&!!view.timeInAt&&!context.proposedShiftId&&(saved||!available.length||choices.some(row=>row.standalone||row.rosterException)||context.allowManual);
   const useManualFirst=allowManual&&!available.length;
   const local=value=>new Date(Date.parse(value)+8*3600000).toISOString();
   const savedNotice=saved?'<p class="owner-time-out-note"><strong>Previously confirmed</strong><br>'+esc(saved.name)+'<br>'+rowTime(saved)+'</p>':'';
   const dateInManila=view.timeInAt?local(saved?.expectedStartAt||view.timeInAt).slice(0,10):'';
   const manual=allowManual?'<details class="worked-manual" data-manual'+(useManualFirst?' open':'')+'><summary>Enter assigned hours for this punch</summary><label>Work date<input type="date" data-manual-date value="'+dateInManila+'"></label><label>Shift name<input data-manual-name maxlength="120"></label><label>Category<select data-manual-kind><option value="">Select category</option><option value="morning">Morning</option><option value="mid">Mid</option><option value="night">Night</option><option value="other">Other</option></select></label><label>Assigned start<input type="time" data-manual-start></label><label>Assigned finish<input type="time" data-manual-end></label><small>A finish earlier than the start falls on the next day.</small></details>':'';
   node.innerHTML='<header style="padding:16px 20px;background:#173f32;color:white;display:flex;justify-content:space-between;align-items:center"><h2 id="workedShiftTitle" style="margin:0;font-size:21px;color:inherit">Choose the worked shift</h2><button type="button" data-close aria-label="Close worked shift">&times;</button></header><div style="padding:16px 20px;overflow:auto;max-height:calc(100dvh - 190px)"><strong>'+esc(view.staffName||'Saved employee')+'</strong> · '+esc(context.branch||view.branch||'')+'<p>'+(view.timeInAt&&view.timeOutAt?'Recorded: '+esc(stamp(view.timeInAt))+' → '+esc(stamp(view.timeOutAt)):'Choose the exact saved work record.')+'</p>'+savedNotice+options+manual+'</div><p class="worked-shift-status" data-status role="status" aria-live="polite">'+esc(blockers.join(' '))+'</p><footer style="display:flex;gap:10px;justify-content:end;border-top:1px solid #dce8de;padding:12px"><button type="button" data-close>Cancel</button><button type="button" data-apply style="padding:12px;border:0;border-radius:8px;background:#16634e;color:white;font-weight:bold">'+(records.length?'Choose record':'Confirm worked shift')+'</button></footer>';
   d.body.append(node);node.showModal();node.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{if(!saving)node.close();});node.addEventListener('close',()=>{node.remove();if(dialog===node)dialog=null;});
   const button=node.querySelector('[data-apply]'),status=node.querySelector('[data-status]');
   const manualPanel=node.querySelector('[data-manual]');
   const fields=manualPanel?Object.fromEntries(['date','name','kind','start','end'].map(key=>[key,node.querySelector('[data-manual-'+key+']')])):{};
   const radios=node.querySelectorAll('[data-choice]');
   const values=()=>Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value.trim()]));
   function payrollLocation(row){
    const exception=row?.rosterException;
    if(!exception)return '';
    const notes=['Payroll will use the Time In branch ('+view.branch+') for this duty.'];
    if(exception.otherBranches.length)notes.push('Plotted elsewhere at '+exception.otherBranches.join(', ')+'.');
    if(exception.unavailableBranches.length||exception.dateRestriction)notes.push('The roster lists this employee as unavailable.');
    return notes.join(' ');
   }
   const clearDraft=()=>{leaveReview='';reviewedChange='';proposal=null;draftKey='';};
   const refresh=()=>{
    const ready=manualMode&&Object.values(values()).every(Boolean);
    button.textContent=records.length?'Choose record':leaveReview?'Confirm work and remove this leave date':manualMode?(reviewedChange?'Confirm updated hours':'Confirm assigned hours'):'Confirm worked shift';
    button.disabled=saving||(!records.length&&(manualMode?!ready:!selected||!!blockers.length));
   };
   function activateManual(){
    if(saving)return;
    manualMode=true;selected=null;clearDraft();radios.forEach(radio=>radio.checked=false);
    const labels={date:'work date',name:'shift name',kind:'category',start:'assigned start',end:'assigned finish'};
    const missing=Object.entries(values()).filter(([,value])=>!value).map(([key])=>labels[key]);
    const location=payrollLocation(choices.find(row=>row.workDate===fields.date.value&&row.rosterException));
    status.textContent=[missing.length?'Complete the '+missing.join(', ')+'.':'Select Confirm assigned hours to save the entered shift.',location].filter(Boolean).join(' ');
    refresh();
   }
   if(manualPanel){
    if(saved){
     fields.name.value=saved.name||'';fields.kind.value=saved.shiftType||'';
     fields.start.value=local(saved.expectedStartAt).slice(11,16);fields.end.value=local(saved.expectedEndAt).slice(11,16);
    }
    for(const field of Object.values(fields)){
     field.addEventListener('input',activateManual);field.addEventListener('change',activateManual);
    }
    manualPanel.addEventListener('toggle',()=>{
     if(saving||manualPanel.open===manualMode)return;
     if(manualPanel.open)activateManual();
     else{manualMode=false;clearDraft();status.textContent='Choose a worked shift or open the assigned-hours form.';refresh();}
    });
    manualMode=!!useManualFirst;
   }
   function select(row){
    selected=row;manualMode=false;clearDraft();if(manualPanel)manualPanel.open=false;
    status.textContent=blockers.join(' ')||payrollLocation(row)||(row.attendanceOnly?'Confirm the recorded duty. All plotted assignments stay in place.':'Confirm this employee’s assignment for '+row.workDate+'.');
    if(!blockers.length){
      const minutes=Math.max(0,Math.floor((Date.parse(view.timeInAt)-Date.parse(row.expectedStartAt))/60000));
      status.textContent+=' Arrival against this shift: '+minutes+' min late. Any saved waiver still applies.';
    }
    refresh();
   }
   node.querySelectorAll('[data-choice]').forEach((radio,index)=>{
    const row=available[index];radio.onchange=()=>select(row);
    if(row.key===preferred&&!row.attendanceOnly){radio.checked=true;select(row);}
   });
   refresh();
   if(!selected&&!records.length){
    status.textContent=(manualMode&&saved?'Check the previously confirmed hours, or edit the assignment below.':manualMode?(blocked[0]?.blockers||[]).join(' '):blockers.join(' '))||
      (manualMode?'Check the assigned hours and select Confirm assigned hours.':available.length?'Select the shift you verified for this work date.':blockers.join(' '));
   }
   function lock(value){
    saving=value;for(const control of [...radios,...Object.values(fields),...node.querySelectorAll('[data-close]')])control.disabled=value;
    refresh();
   }
   function prepare(checked,row){
     const leave=row.leave;
     if(leave){
      const key=JSON.stringify([checked.expectedFingerprint,row.key]);
      if(leaveReview!==key){
       leaveReview=key;
       status.textContent='Approved '+leave.type+' (request '+leave.requestId+') covers '+leave.dates.join(', ')+'. Recorded at '+checked.branch+': '+stamp(checked.timeInAt)+' to '+stamp(checked.timeOutAt)+'. Dated roster: '+(row.rosterException?.otherBranches?.length?'also assigned at '+row.rosterException.otherBranches.join(', '):row.plottedName||'no employee in this slot')+'. Assigned '+row.shiftName+': '+stamp(row.expectedStartAt)+' to '+stamp(row.expectedEndAt)+'. Confirm only if the employee worked and no leave applies on '+row.workDate+'. Other leave dates stay approved. For partial leave or uncertain hours, cancel to keep this date under review.';
       return null;
      }
     }
     return service.propose(checked,row.key,{workedLeaveRequestId:leave?.requestId||null});
    }
    button.onclick=async()=>{
    if(pending||button.disabled||!node.open)return;
    pending=true;lock(true);
    try{
     current();
     if(records.length){const id=node.querySelector('[data-record]').value;node.close();pending=false;return await open({...context,attendanceLogId:id},{assertCurrent,onApplied,refreshCutoff});}
     if(manualMode){
      const draft=values(),key=JSON.stringify(draft);
      if(draft.start===draft.end)throw Error('Assigned start and finish must be different.');
      const manualDuty={name:draft.name,shiftType:draft.kind,startTime:draft.start,endTime:draft.end};
      const differs=saved&&(draft.date!==local(saved.expectedStartAt).slice(0,10)||draft.start!==local(saved.expectedStartAt).slice(11,16)||draft.end!==local(saved.expectedEndAt).slice(11,16)||draft.kind!==saved.shiftType||draft.name!==saved.name);
      if(differs&&reviewedChange!==key){
       reviewedChange=key;
       status.textContent='Previously confirmed: '+stamp(saved.expectedStartAt)+' to '+stamp(saved.expectedEndAt)+'. New assignment: '+draft.name+' ('+draft.kind+'), '+draft.date+' at '+draft.start+' to '+draft.end+(draft.end<draft.start?' the next day':'')+'. Select Confirm updated hours to save this change.';
       return;
      }
      if(!proposal||key!==draftKey){
       status.textContent='Checking the assigned hours for this punch…';
       const checked=await service.inspect({...context,attendanceLogId:view.attendanceLogId,workDate:draft.date,manualDuty,reviewedApproval:saved?.token});
       current();if(!node.open||dialog!==node)return;
       if(checked.timeOutLogId!==view.timeOutLogId||checked.timeInAt!==view.timeInAt||checked.timeOutAt!==view.timeOutAt||checked.confirmedDuty?.token!==saved?.token)
        throw Error('The saved punch or approval changed. Reopen it to check the latest hours.');
       const choice=checked.choices.find(row=>row.ownerEntered&&row.workDate===draft.date);
       if(!choice||checked.blockers.length||choice.blockers.length)throw Error(choice?.blockers[0]||checked.blockers[0]||'Check that the assigned window overlaps the recorded duty.');
       proposal=prepare(checked,choice);draftKey=key;
      }
     }else proposal||=prepare(view,selected);
     if(!proposal)return;
     status.textContent='Saving the confirmed hours…';
     let result;
     try{result=await service.apply(proposal);}
     catch(error){
      if(!error.settled)throw error;
      status.textContent='Waiting for HQ to confirm this save…';result=await error.settled;
     }
     current();await completed(result,node);
    }catch(error){status.textContent=error.message||'The save could not be verified. Retry these same hours.';if(!node.open)tell(status.textContent,true);}
    finally{pending=false;if(node.open)lock(false);}
   };
   return node;
  }
  try{current();view=await service.inspect(context);current();return choose();}catch(error){tell(error.message||'The worked shift was not confirmed. Retry when connected.',true);return false;}finally{pending=false;}
 }
 const ui={open,service};w.workedShiftCorrectionUI=ui;return ui;
}
