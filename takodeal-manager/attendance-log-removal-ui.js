import {attendanceKind,attendanceMillis} from './attendance-reconcile.js';
import {removeAttendancePunch} from './attendance-log-removal.js';
import {invalidatePayrollLoad} from './payroll-loading.js';

export function confirmPunchRemoval(d,row){
 const kind=attendanceKind(row)==='TIME IN'?'Time In':'Time Out';
 const node=d.createElement('dialog');
 node.className='owner-time-out-correction punch-removal-dialog';
 node.setAttribute('aria-labelledby','punchRemovalTitle');
 node.innerHTML='<header><h2 id="punchRemovalTitle"></h2><button type="button" data-close aria-label="Close">&times;</button></header><div class="owner-time-out-body"><strong data-person></strong><p data-when></p><p>The original punch and its HR decision will be kept in attendance history. Removing this punch affects unpaid payroll. The other punch stays on file.</p></div><footer><button type="button" data-close>Cancel</button><button type="button" data-confirm></button></footer>';
 node.querySelector('h2').textContent='Remove incorrect '+kind+'?';
 node.querySelector('[data-person]').textContent=row.staffName+' · '+row.branch;
 node.querySelector('[data-when]').textContent=new Date(attendanceMillis(row.timestamp)).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'})+' (PH)';
 const confirm=node.querySelector('[data-confirm]');confirm.textContent='Remove '+kind;
 return new Promise(resolve=>{
  let approved=false;
  node.addEventListener('close',()=>{node.remove();resolve(approved);},{once:true});
  for(const button of node.querySelectorAll('[data-close]'))button.onclick=()=>node.close();
  confirm.onclick=()=>{approved=true;node.close();};
  d.body.append(node);node.showModal();
 });
}

export async function requestPunchRemoval(api,d,row,button,{assertCurrent=()=>{},afterRemoved}={}){
 if(!row||button.disabled)return false;
 button.disabled=true;
 try{
  assertCurrent();
  if(!await confirmPunchRemoval(d,row))return false;
  assertCurrent();
  const result=await removeAttendancePunch(api,row,{assertCurrent});
  invalidatePayrollLoad(api);
  api.invalidateCache?.('attendance_logs');
  api.getPayrollPreviewGuard?.().invalidate?.('Attendance changed. Generate the unpaid payroll list again.');
  api.ManagerUI?.notify(result.alreadyRemoved?'This punch was already removed.':'Punch removed. Generate the unpaid payroll list again.');
  try{await afterRemoved?.();}catch{api.ManagerUI?.notify('The removal was saved. Refresh attendance to see the updated records.','warning');}
  return true;
 }catch(error){
  const code=String(error?.code||'').split('/').pop();
  const message=code==='permission-denied'?'HQ declined this removal. Verify that you are signed in with the Owner account.':
   code==='unauthenticated'?'Sign in again to confirm attendance removal.':error.message||'HQ could not confirm the removal. Refresh the attendance feed.';
  api.ManagerUI?.notify(message,'warning');return false;
 }finally{button.disabled=false;}
}
