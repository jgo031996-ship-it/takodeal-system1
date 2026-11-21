import {workedShiftActionHint} from './worked-shift-correction-ui.js';
import {attendanceMillis} from './attendance-reconcile.js';
import {payrollActorKey} from './payroll-completion.js';
import {invalidatePayrollLoad} from './payroll-loading.js';
import {capturePayslipEdits,restorePayslipEdits} from './payroll-adjustment-refresh.js';

const openBatches=new WeakMap();
const dateTime=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

// Each confirmation has its own fresh inspection and transaction. Only the
// expensive regeneration of the employee's cutoff is deferred until Finish.
export function openPayslipWorkedShifts(w,d,data,initial,chooser){
 const existing=openBatches.get(w);
 if(existing?.open)return existing;
 const rows=new Map();
 for(const log of data.logs||[]){
  const hint=workedShiftActionHint(w,data,log);
  if(hint&&!rows.has(log.attendanceLogId))rows.set(log.attendanceLogId,{log,context:hint.context,saved:false});
 }
 if((rows.size<2&&!initial.workedLeaveReview)||!rows.has(initial.attendanceLogId))return null;
 const actor=payrollActorKey(w),user=w.auth.currentUser,session=w.sessionUser;
 const edits=capturePayslipEdits(data,d),node=d.createElement('dialog');
 node.className='owner-time-out-correction';node.setAttribute('aria-labelledby','workedShiftBatchTitle');
 node.innerHTML='<header><div><h2 id="workedShiftBatchTitle">Apply worked shifts</h2><span data-employee></span></div></header><div class="owner-time-out-body"><p data-status role="status" aria-live="polite"></p><div data-dates></div></div><footer><button type="button" data-exit hidden>Close for now</button><button type="button" data-confirm data-finish>Close</button></footer>';
 const find=selector=>node.querySelector(selector),status=find('[data-status]'),finish=find('[data-finish]'),exit=find('[data-exit]');
 find('[data-employee]').textContent=data.name+' · '+data.start+' to '+data.end;
 let active=null,finishing=false,savedCount=0,refreshFailed=false;
 function scope(){
  if(!node.open||w.auth.currentUser!==user||w.sessionUser!==session||payrollActorKey(w)!==actor||
      d.getElementById('payrollStart')?.value!==data.start||d.getElementById('payrollEnd')?.value!==data.end)
   throw Error('The account or cutoff changed. Open the current payroll list to continue.');
  if(!savedCount){
   if(w.currentPayslipData!==data||data.isPaid||w.paidPayrollSnapshots?.has(data))throw Error('Reopen the selected unpaid payslip.');
   w.requirePayrollPreview(data);
  }
 }
 function controls(){
  for(const row of rows.values()){
   row.button.disabled=!!active||finishing||row.saved;
   row.button.textContent=row.saved?'Saved':active===row?'Opening…':'Choose shift';
   row.button.setAttribute('aria-label',row.button.textContent+' · '+row.label);
  }
  finish.disabled=!!active||finishing;
  finish.textContent=finishing?'Refreshing payroll…':savedCount?'Finish & refresh payroll':'Close';
  exit.hidden=!refreshFailed;exit.disabled=finishing||!!active;
 }
 const progress=()=>{status.textContent=savedCount?savedCount+' of '+rows.size+' shifts saved. Choose another date or finish to refresh payroll.':'Choose the shift for each date. Payroll refreshes once when you finish.';};
 async function choose(row){
  if(active||finishing||row.saved)return;
  try{
   scope();active=row;controls();
   const child=await chooser.open(row.context,{assertCurrent:scope,refreshCutoff:false,onApplied:async()=>{
    if(row.saved)return;
    row.saved=true;savedCount++;
    w.invalidateCache?.('attendance_logs');invalidatePayrollLoad(w);
    w.getPayrollPreviewGuard().invalidate('Worked shifts saved. Finish the shift review to refresh payroll.');
    progress();controls();
    if(rows.size===1){active=null;await complete();}
   }});
   if(child?.open){
    child.addEventListener('close',()=>{active=null;controls();},{once:true});
    return;
   }
   if(!row.saved)status.textContent='This shift did not open. You can retry it or choose another date.';
  }catch(error){status.textContent=error.message;}
  active=null;controls();
 }
 async function complete(){
  if(active||finishing)return;
  if(!savedCount){node.close();return;}
  finishing=true;refreshFailed=false;controls();status.textContent='Refreshing the selected cutoff.';
  try{
   scope();await w.generateAutoPayslips();scope();w.getPayrollPreviewGuard().requireReady();
   const fresh=Object.values(w.globalPayrollCache||{}).find(row=>row.staffId===data.staffId&&row.start===data.start&&row.end===data.end);
   if(!fresh)throw Error('This employee is missing from the refreshed cutoff.');
   await w.openPayslipModal(fresh.name);scope();
   if(w.currentPayslipData!==fresh)throw Error('The refreshed payslip could not be opened.');
   if(!fresh.isPaid&&!w.paidPayrollSnapshots?.has(fresh))restorePayslipEdits(w,d,edits);
   node.close();
  }catch(error){
   refreshFailed=true;status.textContent=savedCount+' shift(s) saved. '+error.message+' Retry the refresh or close for now.';
  }finally{finishing=false;if(node.open)controls();}
 }
 for(const row of rows.values()){
  const line=d.createElement('p'),label=d.createElement('span'),button=d.createElement('button');
  line.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #dbe6d9';
  label.textContent=dateTime.format(attendanceMillis(row.log.timeInAt))+' – '+dateTime.format(attendanceMillis(row.log.timeOutAt))+' · '+row.context.branch;
  row.label=label.textContent;button.type='button';
  button.onclick=()=>choose(row);row.button=button;line.append(label,button);find('[data-dates]').append(line);
 }
 finish.onclick=complete;exit.onclick=()=>{if(!active&&!finishing&&refreshFailed)node.close();};
 node.addEventListener('cancel',event=>{event.preventDefault();void complete();});
 node.addEventListener('close',()=>{if(openBatches.get(w)===node)openBatches.delete(w);node.remove();},{once:true});
 d.body.append(node);openBatches.set(w,node);node.showModal();progress();controls();
 void choose(rows.get(initial.attendanceLogId));
 return node;
}
