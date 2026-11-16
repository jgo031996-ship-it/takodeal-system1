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
   if(dialog){const savedDialog=dialog;savedDialog.dataset.workedShiftSaved='true';savedDialog.close();savedDialog.remove();dialog=null;}
   await onApplied?.(result);
   w.dispatchEvent?.(new w.CustomEvent('worked-shift-corrected',{detail:{...result,staffId:context.staffId,branch:context.branch}}));
   tell('Worked shift confirmed for '+result.workDate+'.');return result;
  }
  function choose(){
   dialog?.close();dialog?.remove();const node=d.createElement('dialog');dialog=node;node.setAttribute('aria-labelledby','workedShiftTitle');node.style.cssText='position:fixed;inset:0;margin:auto;width:560px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:0;border:1px solid #cadbcf;border-radius:16px;background:#fff;color:#214738;box-shadow:0 24px 80px #102b2640';
   const records=view.recordChoices||[],choices=view.choices||[],blockers=view.blockers||[];
   const available=choices.filter(row=>!row.blockers.length),blocked=choices.filter(row=>row.blockers.length);
   const proposed=available.find(row=>row.shiftId===context.proposedShiftId),preferred=proposed?.key||view.recommendedKey;
   let selected=null,saving=false;
   node.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
   const rowTime=row=>esc(stamp(row.expectedStartAt))+' → '+esc(stamp(row.expectedEndAt));
   const notes=row=>[
     row.key===proposed?.key?'Requested by employee':'',
     row.occupied?'Another employee holds this slot. Confirming records this employee’s duty only.':'',
     row.undatedLeaveIds?.length?'A leave has incomplete dates. Confirm only if you verified this employee worked this date. The leave stays on file.':''
   ].filter(Boolean).map(note=>'<small style="display:block;margin-top:4px">'+esc(note)+'</small>').join('');
   const cards=available.map((row,index)=>'<label style="display:flex;align-items:flex-start;gap:10px;border:1px solid #a9c2b3;border-radius:8px;padding:12px;margin:8px 0;cursor:pointer"><input type="radio" name="workedShiftChoice" data-choice value="'+index+'"><span><strong>'+esc(row.shiftName)+'</strong><br>'+rowTime(row)+notes(row)+'</span></label>').join('');
   const unavailable=blocked.length?'<details'+(available.length?'':' open')+'><summary>Unavailable shifts ('+blocked.length+')</summary>'+blocked.map(row=>'<p><strong>'+esc(row.shiftName)+'</strong><br>'+esc(row.blockers.join(' '))+'</p>').join('')+'</details>':'';
   const options=records.length?'<label>Work record<select data-record style="display:block;width:100%;padding:12px">'+records.map(row=>'<option value="'+esc(row.attendanceLogId)+'">'+esc(stamp(row.timeInAt))+(row.timeOutAt?' → '+esc(stamp(row.timeOutAt)):' · missing Time Out')+'</option>').join('')+'</select></label>':'<fieldset style="padding:0;border:0"><legend>Which shift did this employee work?</legend>'+cards+'</fieldset>'+unavailable;
   node.innerHTML='<header style="padding:16px 20px;background:#173f32;color:white;display:flex;justify-content:space-between;align-items:center"><h2 id="workedShiftTitle" style="margin:0;font-size:21px">Choose the worked shift</h2><button type="button" data-close aria-label="Close">×</button></header><div style="padding:16px 20px;overflow:auto;max-height:calc(100dvh - 190px)"><strong>'+esc(view.staffName||'Saved employee')+'</strong> · '+esc(context.branch||view.branch||'')+'<p>'+(view.timeInAt&&view.timeOutAt?'Recorded: '+esc(stamp(view.timeInAt))+' → '+esc(stamp(view.timeOutAt)):'Choose the exact saved work record.')+'</p>'+options+'<p data-status role="status">'+esc(blockers.join(' '))+'</p></div><footer style="display:flex;gap:10px;justify-content:end;border-top:1px solid #dce8de;padding:12px"><button type="button" data-close>Cancel</button><button type="button" data-apply style="padding:12px;border:0;border-radius:8px;background:#16634e;color:white;font-weight:bold">'+(records.length?'Choose record':'Confirm worked shift')+'</button></footer>';
   d.body.append(node);node.showModal();node.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{if(!saving)node.close();});node.addEventListener('close',()=>{node.remove();if(dialog===node)dialog=null;});
   const button=node.querySelector('[data-apply]'),status=node.querySelector('[data-status]');
   const refresh=()=>{button.disabled=pending||(!records.length&&(!selected||!!blockers.length));};
   function select(row){
    selected=row;
    status.textContent=blockers.join(' ')||(row.attendanceOnly?'Confirm the recorded duty. All plotted assignments stay in place.':'Confirm this employee’s assignment for '+row.workDate+'.');
    refresh();
   }
   node.querySelectorAll('[data-choice]').forEach((radio,index)=>{
    const row=available[index];radio.onchange=()=>select(row);
    if(row.key===preferred&&!row.attendanceOnly){radio.checked=true;select(row);}
   });
   button.disabled=!records.length&&(!selected||!!blockers.length);
   button.onclick=async()=>{
    if(pending||button.disabled)return;
    pending=true;saving=true;button.disabled=true;
    try{
     current();
     if(records.length){const id=node.querySelector('[data-record]').value;node.close();pending=false;return await open({...context,attendanceLogId:id},{assertCurrent,onApplied});}
     await save(selected.key);
    }catch(error){status.textContent=error.message||'Could not save this shift. Reopen it to check the current record.';}
    finally{pending=false;saving=false;if(node.open)refresh();}
   };
   return node;
  }
  try{current();view=await service.inspect(context);current();return choose();}catch(error){tell(error.message||'The worked shift was not confirmed. Retry when connected.',true);return false;}finally{pending=false;}
 }
 const ui={open,service};w.workedShiftCorrectionUI=ui;return ui;
}
