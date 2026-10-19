import {staffRateDate,validRateDate} from './staff-rate-model.js';
import {dateLegacyStaffIncrease,legacyStaffIncreaseEligibility,staffProfileOperation} from './staff-rate-changes.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
export function ensureSalaryDateStyles(d){if(!d.head||d.querySelector('link[data-salary-date-style],link[href*="staff-salary-date-ui.css"]'))return;const link=d.createElement('link');link.rel='stylesheet';link.href=new URL('./staff-salary-date-ui.css',import.meta.url).href;link.setAttribute('data-salary-date-style','true');d.head.append(link);}
export function ensureSalaryEffectiveField(d,{today=staffRateDate()}={}){
 ensureSalaryDateStyles(d);
 const rate=d.getElementById('empHourlyRate'),modal=d.getElementById('employeeProfileModal');if(!rate||!modal?.contains(rate))return null;
 const mounted=d.getElementById('salaryEffectiveControl');if(mounted)return d.getElementById('empRateEffectiveDate');
 let input=d.getElementById('empRateEffectiveDate');if(input&&!modal.contains(input))return null;
 let label=modal.querySelector('label[for="empRateEffectiveDate"]'),help=d.getElementById('empRateEffectiveHelp');
 const host=d.createElement('div');host.id='salaryEffectiveControl';host.className='salary-effective-control';
 rate.parentNode.insertBefore(host,label||input||rate.nextSibling);
 if(!label){label=d.createElement('label');label.htmlFor='empRateEffectiveDate';}label.textContent='Salary effective date';
 if(!input){input=d.createElement('input');input.type='date';input.id='empRateEffectiveDate';input.value=today;}input.required=true;input.setAttribute('aria-describedby','empRateEffectiveHelp');
 if(!help){help=d.createElement('p');help.id='empRateEffectiveHelp';}help.textContent='The new daily wage starts on this Philippine work date. Earlier shifts keep their previous wage.';
 const row=d.createElement('div');row.className='salary-effective-picker';const button=d.createElement('button');button.type='button';button.textContent='Choose date';button.setAttribute('aria-label','Open salary effective date calendar');button.onclick=()=>{try{if(typeof input.showPicker==='function')input.showPicker();else input.focus();}catch{input.focus();}};
 host.append(label,row,help);row.append(input,button);return input;
}
export function legacySalaryDateMarkup(profile,candidate){return '<div class="salary-date-record"><div><strong>Choose when this increase starts</strong><p>'+escape(money(candidate.fromDailyRate))+' → '+escape(money(candidate.toDailyRate))+' per day. This recorded increase has no effective date yet.</p><small>Set its start date to keep earlier unpaid work at the previous wage. Paid payslips stay as saved.</small></div><button type="button" data-date-legacy-increase>Set effective date</button></div>';}
export function installStaffSalaryDateUI(w,d,{save=dateLegacyStaffIncrease}={}){
 if(w.staffSalaryDateUIInstalled)return w.staffSalaryDateUIInstalled;let epoch=0,currentDialog=null;const pending=new Map();
 function saveBounded(id,auditId,options){const actorKey=identity(),generation=epoch,key=options.operationId+'|'+actorKey;let physical=pending.get(key),timer;if(!physical){physical=Promise.resolve().then(()=>{if(identity()!==actorKey||epoch!==generation||!currentProfile(id))throw Error('The account or employee changed. Reopen the salary date before saving.');return save(w,id,auditId,options);});pending.set(key,physical);physical.finally(()=>{if(pending.get(key)===physical)pending.delete(key);}).catch(()=>{});}return Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ has not confirmed this date yet. Keep the same date when retrying, or reopen the profile to check whether it was saved.')),25000);})]).finally(()=>clearTimeout(timer));}
 const identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.sessionUser?.uid,w.sessionUser?.email]);
 const currentProfile=id=>d.getElementById('empProfileId')?.value===id&&d.getElementById('employeeProfileModal')?.style.display!=='none';
 function clear(){epoch++;const host=d.getElementById('salaryLegacyDateActions');host?.remove();if(currentDialog?.open)currentDialog.close();}
 ensureSalaryEffectiveField(d);
 for(const name of ['openEmployeeProfile','addNewStaff']){const original=w[name];if(typeof original==='function')w[name]=function(...args){clear();ensureSalaryEffectiveField(d);w.staffSalaryDateReopenRequired=null;return original.apply(this,args);};}
 async function choose(profile,candidate){
  const token=epoch,key=identity(),id=candidate.staffId;if(!currentProfile(id))return;
  currentDialog?.close();currentDialog?.remove();const dialog=d.createElement('dialog');currentDialog=dialog;dialog.className='salary-date-dialog';dialog.setAttribute('aria-labelledby','legacySalaryDateTitle');
  dialog.innerHTML='<header><div><small>STAFF & SECURITY · DAILY WAGE</small><h2 id="legacySalaryDateTitle">Set increase effective date</h2></div><button type="button" data-close aria-label="Close salary date">×</button></header><div class="salary-date-body"><p><strong>'+escape(profile.cashierName)+'</strong> · '+escape(profile.branch)+'</p><p>'+escape(money(candidate.fromDailyRate))+' → '+escape(money(candidate.toDailyRate))+' per day</p><label for="legacySalaryEffectiveDate">First work date at the increased wage</label><input type="date" id="legacySalaryEffectiveDate" required><p>Before this date, unpaid shifts use '+escape(money(candidate.fromDailyRate))+'. From this date, they use '+escape(money(candidate.toDailyRate))+'. Saved paid payslips keep their original amounts.</p><p role="status" data-status>Choose the actual agreed start date. The original increase record stays on file.</p></div><footer><button type="button" data-cancel>Cancel</button><button type="button" data-save>Save effective date</button></footer>';
  d.body.append(dialog);dialog.showModal();const input=dialog.querySelector('input'),status=dialog.querySelector('[data-status]'),buttons=[...dialog.querySelectorAll('button')];let busy=false;
  const isCurrent=()=>token===epoch&&key===identity()&&currentProfile(id)&&dialog.open;
  const close=()=>{if(!busy)dialog.close();};dialog.querySelector('[data-close]').onclick=close;dialog.querySelector('[data-cancel]').onclick=close;dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());input.focus();
  dialog.querySelector('[data-save]').onclick=async()=>{if(busy||!isCurrent())return;if(!validRateDate(input.value)){status.textContent='Choose a valid effective date before saving.';status.setAttribute('role','alert');input.focus();return;}
   const effectiveDate=input.value,operationId=staffProfileOperation(w,{action:'date-legacy-increase',legacyAuditId:candidate.legacyAuditId},id,{effectiveDate});busy=true;dialog.dataset.saving='true';buttons.forEach(button=>button.disabled=true);input.disabled=true;status.textContent='Saving this effective date…';
   try{const result=await saveBounded(id,candidate.legacyAuditId,{effectiveDate,operationId,expectedRate:candidate.toDailyRate,expectedRateRevision:profile.salaryRateRevision??null});if(!isCurrent())return;w.staffSalaryDateReopenRequired=id;const host=d.getElementById('salaryLegacyDateActions');if(host)host.textContent='Effective date saved: '+result.effectiveDate+'. Reopen this profile to load the dated wage before making other edits.';dialog.close();await w.Swal.fire('Salary date saved','The increase starts on '+result.effectiveDate+'. Earlier unpaid work uses the previous wage. Reopen this profile, then regenerate any unpaid payroll preview.','success');}
   catch(error){if(isCurrent()){status.textContent=error.message||'This save could not be confirmed. Retry the same date or reopen the profile.';status.setAttribute('role','alert');}}
   finally{busy=false;delete dialog.dataset.saving;if(dialog.open){buttons.forEach(button=>button.disabled=false);input.disabled=false;}}
  };
 }
 w.renderSalaryEffectiveDateActions=(profile,events=[])=>{clear();if(!profile||!currentProfile(profile.staffId))return;const id=profile.staffId,audit=events.find(row=>row.id===profile.staffRateAuditId),candidate=legacyStaffIncreaseEligibility(profile,audit,{staffId:id,auditId:audit?.id});if(!candidate.eligible)return;
  const anchor=d.getElementById('masterRateHistory');if(!anchor)return;const host=d.createElement('div');host.id='salaryLegacyDateActions';host.innerHTML=legacySalaryDateMarkup(profile,candidate);anchor.parentNode.insertBefore(host,anchor);host.querySelector('button').onclick=()=>choose(profile,candidate);
 };
 w.onAuthStateChanged?.(w.auth,()=>clear());const installed={ensure:()=>ensureSalaryEffectiveField(d),clear};w.staffSalaryDateUIInstalled=installed;return installed;
}
