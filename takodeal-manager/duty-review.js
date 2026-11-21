import {crewRequest,operationFor,html} from './crew-operations-client.js';
const when=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const openings=new Map();
export function openDutyReview(w,d,requestId){
 const user=w.auth?.currentUser,session=w.sessionUser,k=user?.uid+'|'+requestId;
 if(!user||!requestId)return;
 if(openings.has(k))return openings.get(k);
 const guard=()=>{if(w.auth.currentUser!==user||w.sessionUser!==session)throw Error('Your review account changed. Reopen Request Inbox.');};
 const work=(async()=>{
  try{
   const detail=await crewRequest(user,'duty/read',{requestId},guard),saved=detail.choices;
   const clock=detail.timeOutAt?when(detail.timeOutAt)+' PH':'No Time Out on file';
   const markup='<p style="text-align:left"><strong>'+html(detail.staffName)+' · '+html(detail.branch)+'</strong><br>Time In · '+html(when(detail.timeInAt))+' PH<br>Time Out · '+html(clock)+'</p><p>'+html(detail.reason)+'</p>';
   if(detail.blocked)return w.Swal.fire({title:'Recorded duty',html:markup+'<p>'+html(detail.blocked)+'</p>'});
   const result=await w.Swal.fire({title:'Confirm duty schedule',html:markup+'<label>Branch duty<select id="duty-choice" class="swal2-select"><option value="">Choose a schedule</option>'+saved.map((o,i)=>'<option value="'+i+'">'+html(o.shiftName)+' · '+html(when(o.expectedStartAt))+' to '+html(when(o.expectedEndAt))+'</option>').join('')+'<option value="custom">Custom emergency schedule</option></select></label><fieldset id="duty-custom" hidden><legend>Emergency duty in Philippine time</legend><label>Work date <input type="date" id="duty-date" value="'+html(detail.workDate)+'"></label><label>Scheduled start <input type="time" id="duty-start"></label><label>Scheduled finish <input type="time" id="duty-end"></label><label>Shift <select id="duty-type"><option value="other">Other</option><option value="morning">Morning</option><option value="mid">Mid</option><option value="night">Night</option></select></label><label>Reason <input id="duty-why" maxlength="240" placeholder="For example, closed early due to rain"></label></fieldset><p>'+(detail.timeOutAt?'The schedule will be applied to these recorded punches.':'You can confirm the duty now. The request stays open until there is a recorded departure.')+'</p>',showCancelButton:true,confirmButtonText:'Confirm duty',showLoaderOnConfirm:true,allowOutsideClick:()=>!w.Swal.isLoading(),didOpen:()=>{const select=d.getElementById('duty-choice');select.onchange=()=>{d.getElementById('duty-custom').hidden=select.value!=='custom';};},
   preConfirm:async()=>{try{guard();const val=id=>d.getElementById(id).value,choice=val('duty-choice');if(!choice)throw Error('Choose a plotted or custom duty.');let selection;
    if(choice==='custom'){const reason=val('duty-why').trim(),startTime=val('duty-start'),endTime=val('duty-end'),workDate=val('duty-date');if(reason.length<8||!workDate||!startTime||!endTime)throw Error('Enter the scheduled hours, date and emergency reason.');selection={mode:'custom',reason,startTime,endTime,workDate,shiftType:val('duty-type'),shiftName:'Emergency '+val('duty-type')+' duty'};}
    else{const slot=saved[Number(choice)];selection={mode:'plotted',key:slot.key,fingerprint:slot.sourceFingerprint};}
    const body={requestId,expected:detail.expected,selection},op=operationFor(w.sessionStorage,k,body);const ack=await crewRequest(user,'duty/save',{...body,operationId:op.id},guard);op.done();return ack;
   }catch(e){w.Swal.showValidationMessage(e.message);return false;}}});
   if(result.isConfirmed){w.invalidateCache?.('staff_requests');w.invalidateCache?.('attendance_logs');await w.ownerInbox?.applyConfirmedRequest?.(requestId);await w.Swal.fire('Duty confirmed',result.value.recorded?'The review is complete. The recorded punches are on file. Refresh unpaid payroll to see the assigned duty.':'The duty is saved. Staff still need a recorded Time Out.','success');}
  }catch(e){await w.Swal.fire('Duty review',e.message,'warning');}
 })().finally(()=>openings.delete(k));openings.set(k,work);return work;
}
