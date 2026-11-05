import {createWorkedShiftCorrectionService} from './worked-shift-correction-service.js';
import {OWNER_EMAIL} from './workspace-access-model.js';
import {attendanceMillis} from './attendance-reconcile.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
export function workedShiftActionHint(api,data,log){
 const user=api?.auth?.currentUser;
 if(!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||api.sessionUser?.uid!==user.uid||!api.sessionUser?.isOwner||data?.isPaid||api.paidPayrollSnapshots?.has(data)||!log?.attendanceLogId||!data.staffId||log.out==='MISSED')return null;
 const start=attendanceMillis(log.timeInAt),end=attendanceMillis(log.timeOutAt),expected=attendanceMillis(log.expectedStartAt),finish=attendanceMillis(log.expectedEndAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>18*3600000||log.workedShiftCorrectionId)return null;
 const overlap=Math.max(0,Math.min(end,finish)-Math.max(start,expected));
 if(log.bonusReviewRequired||!Number.isFinite(expected)||!Number.isFinite(finish)||Math.abs(start-expected)>=3*3600000&&overlap<(end-start)/2)return {label:'Apply worked shift',context:{attendanceLogId:log.attendanceLogId,staffId:data.staffId,branch:log.branch||data.branch,from:data.start,to:data.end}};
 return null;
}
export function installWorkedShiftCorrectionUI(w,d,{service=createWorkedShiftCorrectionService(w)}={}){
 if(w.workedShiftCorrectionUI)return w.workedShiftCorrectionUI;
 let dialog=null,pending=false,epoch=0;
 const tell=(text,error=false)=>w.ManagerUI?.notify?.(text,error?'warning':undefined);
 async function open(context,{assertCurrent=()=>{},onApplied}={}){
  if(pending)return false;
  pending=true;const token=++epoch;let view;
  const current=()=>{assertCurrent();if(token!==epoch)throw Error('The selected work record changed. Open it again.');};
  async function save(key){
   current();const proposal=service.propose(view,key);const result=await service.apply(proposal);current();
   dialog?.close();dialog?.remove();dialog=null;
   await onApplied?.(result);
   w.dispatchEvent?.(new w.CustomEvent('worked-shift-corrected',{detail:{...result,staffId:context.staffId,branch:context.branch}}));
   tell('Worked shift saved for '+result.workDate+'. The roster and unpaid payroll use the corrected assignment. Lateness stays as reviewed.');return result;
  }
  function choose(){
   dialog?.close();dialog?.remove();const node=d.createElement('dialog');dialog=node;node.setAttribute('aria-labelledby','workedShiftTitle');node.style.cssText='position:fixed;inset:0;margin:auto;width:560px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:0;border:1px solid #cadbcf;border-radius:16px;background:#fff;color:#214738;box-shadow:0 24px 80px #102b2640';
   const records=view.recordChoices||[],choices=view.choices||[],blockers=view.blockers||[];
   node.innerHTML='<header style="padding:20px;background:#173f32;color:white;display:flex;justify-content:space-between;gap:12px"><div><small>SCHEDULE MANAGER · EXACT WORK DATE</small><h2 id="workedShiftTitle" style="margin:6px 0 0;font-size:21px">Choose the worked shift</h2></div><button type="button" data-close aria-label="Close" style="background:transparent;color:white;border:1px solid #6a8e7d;border-radius:8px;padding:8px 12px">×</button></header><div style="padding:20px;overflow:auto;max-height:calc(100dvh - 220px)"><p style="margin-top:0"><strong>'+esc(view.staff?.staffName||view.staffName||'Saved employee')+'</strong> · '+esc(context.branch||view.branch||'')+'</p><p style="padding:12px;background:#f2f7ef;border-radius:9px;font-size:13px">'+(view.timeInAt&&view.timeOutAt?'Recorded: '+esc(stamp(view.timeInAt))+' → '+esc(stamp(view.timeOutAt)): 'Choose the exact saved work record.')+'</p><p data-status role="status" style="font-size:13px;color:#815421">'+esc(blockers.join(' '))+'</p>'+(records.length?'<label>Work record<select data-record style="display:block;width:100%;padding:12px;margin-top:8px">'+records.map(row=>'<option value="'+esc(row.attendanceLogId)+'">'+esc(stamp(row.timeInAt))+(row.timeOutAt?' → '+esc(stamp(row.timeOutAt)):' · missing Time Out')+'</option>').join('')+'</select></label>':'<label>Saved branch shift<select data-choice style="display:block;width:100%;padding:12px;margin-top:8px">'+choices.map(row=>'<option value="'+esc(row.key)+'"'+(row.blockers?.length?' disabled':'')+'>'+esc(row.shiftName)+' · '+esc(stamp(row.expectedStartAt))+' → '+esc(stamp(row.expectedEndAt))+(row.blockers?.length?' · '+esc(row.blockers.join(' ')):'')+'</option>').join('')+'</select></label>')+'<p style="font-size:12px;color:#5a7061;margin-bottom:0">This corrects this employee’s assignment for this date. Original punches, paid payslips and lateness decisions stay on file.</p></div><footer style="display:flex;gap:10px;justify-content:end;border-top:1px solid #dce8de;padding:16px"><button type="button" data-close style="padding:11px 16px;border:1px solid #cbdccf;border-radius:8px;background:white">Cancel</button><button type="button" data-apply style="padding:11px 16px;border:0;border-radius:8px;background:#16634e;color:white;font-weight:bold">'+(records.length?'Choose record':'Apply shift')+'</button></footer>';
   d.body.append(node);node.showModal();node.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>node.close());node.addEventListener('close',()=>{node.remove();if(dialog===node)dialog=null;});
   const button=node.querySelector('[data-apply]');button.disabled=records.length?false:!!blockers.length||!choices.some(row=>!row.blockers?.length);
   button.onclick=async()=>{if(pending)return;pending=true;button.disabled=true;try{current();if(records.length){const id=node.querySelector('[data-record]').value;node.close();pending=false;return await open({...context,attendanceLogId:id},{assertCurrent,onApplied});}await save(node.querySelector('[data-choice]').value);}catch(error){const status=node.querySelector('[data-status]');if(status)status.textContent=error.message;else tell(error.message,true);}finally{pending=false;if(node.open)button.disabled=false;}};
   return node;
  }
  try{current();view=await service.inspect(context);current();if(view.recommendedKey&&!(view.blockers||[]).length)return await save(view.recommendedKey);return choose();}catch(error){tell(error.message||'The worked shift was not confirmed. Retry when connected.',true);return false;}finally{pending=false;}
 }
 const ui={open,service};w.workedShiftCorrectionUI=ui;return ui;
}
