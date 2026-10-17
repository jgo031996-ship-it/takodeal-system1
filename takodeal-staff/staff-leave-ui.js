import {createStaffLeaveService} from './leave-request-actions.js';
import {activeLeaveDates,describeLeaveDates,leaveToday,leaveFingerprint,normalizeLeaveInput,proposedLeaveDates} from './leave-model.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function staffLeaveDetailsHTML(row,today=leaveToday()){
 if(row.type==='Leave Change')return '<strong>'+escape(row.changeKind==='Dates'?'Date change request':'Cancellation request')+'</strong><br><span>Requested remaining dates: '+escape(describeLeaveDates(row.requestedActiveDates||[]))+'</span><br><small>'+escape(row.reason||'')+'</small>'+(row.status==='Pending'?'<p class="leave-history-note">Pending management review. Your approved dates remain active until management confirms this change.</p>':'');
 let active;try{active=activeLeaveDates(row);}catch{return '<strong>Your saved leave dates need management review.</strong>';}
 let html='<strong>'+escape(row.leaveType||'Leave')+'</strong><br><span>Original dates: '+escape(row.startDate)+' to '+escape(row.endDate)+'</span><br><small>'+escape(row.reason||'')+'</small>';
 if(row.status==='Approved')html+='<p class="leave-history-note">'+escape(row.leaveState||'Approved')+' · Remaining dates: '+escape(describeLeaveDates(active))+'</p>'+(row.pendingLeaveChangeId?'<small>A change is pending management review. Approved dates stay active until confirmed.</small>':row.leaveScheduleSync?.version===1?'<small>Linked to your saved schedule. Released dates return to standby after approval.</small>':'<small>Ask management to confirm schedule sync for these approved dates.</small>');
 return html;
}
export function staffLeaveActionsHTML(row,today=leaveToday()){
 const button=(kind,label)=>'<button type="button" data-staff-leave-action="'+kind+'" data-staff-leave-request="'+escape(row.id)+'">'+label+'</button>';
 if(row.status==='Pending')return '<div class="leave-history-actions">'+button('Withdraw','Withdraw pending request')+'</div>';
 if(row.type!=='Leave'||row.status!=='Approved'||row.pendingLeaveChangeId)return '';
 let dates;try{dates=activeLeaveDates(row);}catch{return '';}
 return '<div class="leave-history-actions">'+(dates.some(date=>date>=today)?button('Cancel','Request cancellation'):'')+button('Dates','Request new dates')+'</div>';
}
export function installStaffLeaveUI(w,d,{getIdentity=()=>({staffId:w.localStorage.getItem('takodeal_staff_id'),staffName:w.localStorage.getItem('takodeal_staff_name')}),service=createStaffLeaveService(w,{getIdentity}),now=()=>new Date(),makeId=()=>w.crypto.randomUUID(),onSaved}={}){
 const el=(tag,cls,text)=>{const node=d.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};let generation=0,dialog=null,newDraft=null;
 const identity=()=>leaveFingerprint(getIdentity()),currentIdentity=key=>key===identity();
 const notice=error=>w.Swal?.fire?.('Check leave request',error.message||'Connect to HQ and refresh your leave request.','warning');
 const notifySaved=async result=>{if(onSaved)await onSaved(result);else await w.loadInbox?.();};
 async function open({mode,row,input}){
  const token=++generation,key=identity();dialog?.close();dialog?.remove();const root=el('dialog','leave-review-dialog'),header=el('header'),heading=el('div'),title=el('h2','',mode==='Submit'?'Confirm leave request':mode==='Withdraw'?'Withdraw pending request':mode==='Cancel'?'Request leave cancellation':'Request new leave dates');heading.append(el('small','','STAFF · LEAVE REQUEST'),title);const close=el('button','','×');close.type='button';close.setAttribute('aria-label','Close leave request');header.append(heading,close);const body=el('div','leave-review-body'),status=el('p','leave-note','Management must review approved leave changes before your schedule changes.');status.setAttribute('role','status');const footer=el('footer'),confirm=el('button','leave-primary',mode==='Withdraw'?'Withdraw request':'Send to management');confirm.type='button';footer.append(el('p','','Enter your staff PIN only in this app.'),confirm);root.append(header,body,footer);body.append(status);d.body.append(root);dialog=root;root.showModal();close.onclick=()=>root.close();let busy=false,requestId=mode==='Submit'?input.id:makeId(),lastIntent=null;
  const current=()=>root.open&&generation===token&&currentIdentity(key),setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('is-error',error);status.setAttribute('role',error?'alert':'status');};
  let checks=[],start,end,reason;const fields=[];
  if(mode==='Submit')body.append(el('p','leave-request-reason',input.leaveType+' · '+input.startDate+' to '+input.endDate),el('p','',input.reason));
  else{body.append(el('p','leave-request-reason',(row.leaveType||'Leave')+' · '+(row.type==='Leave Change'?'Pending '+(row.changeKind==='Dates'?'date change':'cancellation'):describeLeaveDates(activeLeaveDates(row)))));}
  if(mode==='Cancel'){
   const list=el('div','leave-cancel-dates');for(const date of activeLeaveDates(row).filter(date=>date>=leaveToday(now()))){const label=el('label'),check=el('input');check.type='checkbox';check.value=date;check.checked=true;label.append(check,el('span','',date));list.append(label);checks.push(check);}body.append(el('p','','Select dates you want management to cancel:'),list);fields.push(...checks);
  }
  if(mode==='Dates'){
   const dates=activeLeaveDates(row).filter(date=>date>=leaveToday(now()));start=el('input');end=el('input');start.type=end.type='date';start.min=end.min=leaveToday(now());start.value=dates[0]||start.min;end.value=dates.at(-1)||start.value;const datesFields=el('div','leave-review-fields');for(const [label,input]of [['New start date',start],['New end date',end]]){const wrapper=el('label','',label);wrapper.append(input);datesFields.append(wrapper);}body.append(datesFields);fields.push(start,end);
  }
  if(mode==='Cancel'||mode==='Dates'){reason=el('textarea');reason.rows=3;reason.maxLength=1500;reason.placeholder='Explain why you need to change these dates.';const label=el('label','leave-reply-label','Reason for this change');label.append(reason);body.append(label);fields.push(reason);}
  const pin=el('input');pin.type='password';pin.inputMode='numeric';pin.autocomplete='off';pin.maxLength=100;const pinLabel=el('label','leave-reply-label','Staff PIN');pinLabel.append(pin);body.append(pinLabel);fields.push(pin);pin.focus();
  root.addEventListener('cancel',event=>{if(busy)event.preventDefault();});confirm.onclick=async()=>{
   if(busy||!current())return;let payload={requestId:row?.id,pin:pin.value};
   if(!payload.pin.trim())return setStatus('Enter your staff PIN in the app to confirm this request.',true);
   if(mode==='Submit')payload={...input,pin:pin.value};
   if(mode==='Cancel'||mode==='Dates'){payload={...payload,kind:mode,reason:reason.value.trim()};if(mode==='Cancel')payload.cancelDates=checks.filter(check=>check.checked).map(check=>check.value);else{payload.startDate=start.value;payload.endDate=end.value;}try{if(payload.reason.length<3)throw Error('Enter a short reason for changing your leave.');proposedLeaveDates(row,payload,leaveToday(now()));}catch(error){return setStatus(error.message,true);}const intent=leaveFingerprint({...payload,pin:undefined});if(lastIntent!==null&&lastIntent!==intent)requestId=makeId();lastIntent=intent;payload.id=requestId;}
   busy=true;confirm.disabled=close.disabled=true;for(const field of fields)field.disabled=true;setStatus('Confirming your saved staff account with HQ…');
   try{let result;if(mode==='Submit')result=await service.submit(payload);else if(mode==='Withdraw')result=await service.withdraw(payload);else result=await service.requestChange(payload);pin.value='';if(!current())return;root.close();if(mode==='Submit'){newDraft=null;const old=d.getElementById('requestModal');if(old)old.style.display='none';}await notifySaved(result);await w.Swal?.fire?.('Request saved',mode==='Withdraw'?'Your pending request was withdrawn. Your schedule was not changed.':mode==='Submit'?'Your leave request was sent to management. Your schedule changes only after approval.':'Your requested change is pending management review. Existing approved dates stay active until confirmed.','success');return true;}
   catch(error){pin.value='';if(current())setStatus(error.message||'Connect to HQ and retry this same request.',true);}finally{busy=false;if(root.open){confirm.disabled=close.disabled=false;for(const field of fields)field.disabled=false;}}
  };
 }
 async function submitFromForm(){const key=identity(),raw={startDate:d.getElementById('reqStart')?.value||'',endDate:d.getElementById('reqEnd')?.value||'',leaveType:d.getElementById('reqLeaveType')?.value||'Leave',reason:d.getElementById('reqReason')?.value||''},intent=leaveFingerprint({key,...raw});if(!newDraft||newDraft.intent!==intent)newDraft={id:makeId(),intent};try{return open({mode:'Submit',input:normalizeLeaveInput({id:newDraft.id,...raw},{today:leaveToday(now())})});}catch(error){return notice(error);}}
 async function action(id,mode){try{const key=identity(),rows=await service.list();if(!currentIdentity(key))return;const row=rows.find(row=>row.id===id);if(!row)throw Error('This leave request is no longer available. Refresh your inbox.');if(mode==='Withdraw'&&row.status!=='Pending')throw Error('Management already reviewed this request. Refresh your inbox.');if(mode!=='Withdraw'&&(row.type!=='Leave'||row.status!=='Approved'||row.pendingLeaveChangeId))throw Error('Management must finish the existing review before another change.');return open({mode,row});}catch(error){return notice(error);}}
 d.body.addEventListener('click',event=>{const target=event.target?.closest?.('button[data-staff-leave-action]');if(target&&['Cancel','Dates','Withdraw'].includes(target.dataset.staffLeaveAction))void action(target.dataset.staffLeaveRequest,target.dataset.staffLeaveAction);});
 const ui={service,list:()=>service.list(),submitFromForm,action,details:row=>staffLeaveDetailsHTML(row,leaveToday(now())),actions:row=>staffLeaveActionsHTML(row,leaveToday(now()))};w.staffLeaveUI=ui;return ui;
}
