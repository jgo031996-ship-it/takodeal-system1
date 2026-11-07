import {installWorkedShiftCorrectionUI} from './worked-shift-correction-ui.js';

// A proposal is a reference, never an authorization. Use the existing exact-date
// Owner correction service, then reopen the letter from fresh saved evidence.
export async function reviewLateRequestWorkedShift(api,d,context,attendance){
 const user=api.auth?.currentUser,session=api.sessionUser,token=api.lateRequestOpenToken,request=context.request;
 const reply=d.getElementById('replyMessage')?.value||'',decision=d.getElementById('replyStaffShiftDecision')?.value||'';
 const current=()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session||api.lateRequestOpenToken!==token)throw Error('The account or request changed. Reopen the saved letter.');};
 current();
 const input={attendanceLogId:attendance.id,staffId:attendance.staffId||context.profile.staffId||request.staffId,branch:attendance.branch,workDate:request.staffShiftProposal.workDate};
 d.getElementById('dynamicReplyModal')?.remove();api.lateRequestContext=null;
 let returned=false,applied=false;
 const reopen=async(cancelled=false)=>{
  if(returned)return;current();returned=true;
  await api.handleRequest(context.requestId,context.action,request.type,request.amount||0,request.staffName);
  const fresh=api.lateRequestContext;
  if(api.auth?.currentUser!==user||api.sessionUser!==session||fresh?.requestId!==context.requestId||fresh.action!==context.action)return;
  const message=d.getElementById('replyMessage');if(message)message.value=reply;
  const choice=d.getElementById('replyStaffShiftDecision');if(choice)choice.value=cancelled?decision:'';
  api.updateLateRequestPreview();
 };
 try{
  const ui=api.workedShiftCorrectionUI||(api.workedShiftCorrectionUI=installWorkedShiftCorrectionUI(api,d));
  const result=await ui.open(input,{assertCurrent:current,onApplied:async()=>{current();applied=true;api.invalidateCache?.('global_schedule');api.invalidateCache?.('attendance_logs');await reopen();}});
  if(result?.addEventListener)result.addEventListener('close',()=>{if(!applied)void reopen(true).catch(()=>{});},{once:true});
  else if(!applied)await reopen(true);
  return result;
 }catch(error){try{current();await reopen(true);api.ManagerUI?.notify?.(error.message||'The worked shift could not be reviewed.');}catch{/* A newer account or request owns the view. */}return false;}
}

export function reviewLateRequestDatedAttendance(api,d,context,recovery){
 const user=api.auth?.currentUser,session=api.sessionUser,token=api.lateRequestOpenToken,reply=d.getElementById('replyMessage')?.value||'';
 const current=()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session||api.lateRequestOpenToken!==token)throw Error('The account or letter changed. Reopen the saved request.');};
 current();d.getElementById('dynamicReplyModal')?.remove();api.lateRequestContext=null;let returned=false;
 return api.openAttendanceRecovery({...recovery,returnToRequest:async()=>{
  if(returned)return;current();returned=true;const request=context.request;
  await api.handleRequest(context.requestId,context.action,request.type,request.amount||0,request.staffName);
  if(api.auth?.currentUser!==user||api.sessionUser!==session||api.lateRequestContext?.requestId!==context.requestId)return;
  const message=d.getElementById('replyMessage');if(message)message.value=reply;
  api.updateLateRequestPreview();
 }});
}
