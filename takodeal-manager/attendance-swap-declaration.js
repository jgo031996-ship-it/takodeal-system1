import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const id=value=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!/[\/\u0000-\u001f\u007f-\u009f]/u.test(value)&&new TextEncoder().encode(value).length<=1500;
const instant=value=>value?.toMillis?.()??(value?.seconds!==undefined?value.seconds*1000+Math.floor((value.nanoseconds||0)/1e6):value instanceof Date?+value:Date.parse(value));
export const declarationCanonical=value=>value instanceof Date||value?.seconds!==undefined||typeof value?.toMillis==='function'?{at:instant(value)}:Array.isArray(value)?value.map(declarationCanonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(name=>[name,declarationCanonical(value[name])])):value??null;
const stamp=value=>{const at=instant(value);return Number.isFinite(at)?new Date(at).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)':'Time needs review';};
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500;

// This is an employee's statement and a roster reference, never evidence of an
// approved swap, corrected lateness or an authorized payroll change.
export function inspectScheduleDeclaration(request,attendance){
 const value=request?.scheduleDeclaration;
 if(!value||Array.isArray(value)||value.schemaVersion!==1||value.kind!=='unrequested-swap'||value.referenceOnly!==true||!id(value.staffId)||!id(value.coworkerStaffId)||value.staffId===value.coworkerStaffId||![value.staffName,value.attendanceBranch,value.coworkerName,value.targetBranch,value.targetShiftId,value.targetShiftName,value.targetAssignedName,value.sourceRevisionId].every(text)||typeof value.coworkerHomeBranch!=='string'||value.coworkerHomeBranch.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(value.workDate||'')||!Number.isFinite(instant(value.targetStartAt))||!Number.isFinite(instant(value.targetEndAt))||instant(value.targetEndAt)<=instant(value.targetStartAt)||instant(value.targetEndAt)-instant(value.targetStartAt)>24*3600000||typeof value.sourceFingerprint!=='string'||!value.sourceFingerprint||value.sourceFingerprint.length>60000||typeof value.originalScheduleFingerprint!=='string'||!value.originalScheduleFingerprint||value.originalScheduleFingerprint.length>60000||value.staffId!==request.staffId||value.staffName!==request.staffName||value.attendanceBranch!==request.branch)throw Error('The saved shift declaration needs its original source reviewed.');
 if(!Number.isFinite(instant(value.declaredAt))||typeof value.explanation!=='string'||value.explanation.length>1500)throw Error('The saved shift statement needs its dated reference reviewed.');
 if(attendance&&(attendance.id!==request.attendanceLogId||attendance.type!=='TIME IN'||!Number.isFinite(instant(attendance.timestamp))||attendance.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(attendance.status)||attendance.staffId!==request.staffId||attendance.staffName!==request.staffName||attendance.branch!==request.branch||attendance.scheduleDeclarationRequestId!==request.id||JSON.stringify(declarationCanonical(attendance.scheduleDeclaration))!==JSON.stringify(declarationCanonical(value))))throw Error('This declaration does not match its original linked Time In.');
 return value;
}
export function scheduleDeclarationHTML(request){
 if(!request?.scheduleDeclaration)return '';
 try{const row=inspectScheduleDeclaration(request);return '<section class="schedule-declaration-summary" style="padding:12px;background:#fff8e8;border:1px solid #e8d6ab;border-radius:8px;margin:8px 0"><strong>Unrequested shift swap · staff statement</strong><p>'+escape(row.staffName)+' reported swapping with '+escape(row.coworkerName)+' · home branch '+escape(row.coworkerHomeBranch||'Not recorded')+'.</p><p>Saved roster reference: '+escape(row.targetShiftName)+' · '+escape(row.targetBranch)+' · '+escape(row.workDate)+'<br>Roster name: '+escape(row.targetAssignedName)+'<br>'+escape(stamp(row.targetStartAt))+' → '+escape(stamp(row.targetEndAt))+'</p>'+(row.explanation?'<p>'+escape(String(row.explanation).slice(0,1500))+'</p>':'')+'<small>Pending a separate attendance review. This statement does not approve a swap or change the original punch, assigned hours, lateness or payroll.</small></section>';}catch{return '<p role="status">A shift-swap statement was saved, but its identity or dated source needs review. No approval or schedule change is established.</p>';}
}
export function scheduleDeclarationSourceFingerprint(request,attendance){
 inspectScheduleDeclaration(request,attendance);
 const result=JSON.stringify(declarationCanonical({request:Object.fromEntries(['id','type','staffId','staffName','branch','attendanceLogId','timestamp','lateMinutes','explanationCause','explanationMessage','scheduleDeclaration'].map(name=>[name,request[name]??null])),attendance:Object.fromEntries(['id','type','staffId','staffName','branch','timestamp','scheduleSnapshot','lateMinutes','scheduleDeclaration','scheduleDeclarationRequestId'].map(name=>[name,attendance[name]??null]))}));
 if(result.length>180000)throw Error('The declaration source is too large for this review. Open the original attendance with HQ.');return result;
}
function authority(api,branch){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||!user.email||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||session.email?.toLowerCase()!==user.email.toLowerCase()||session.isFranchisee===true||!canOpenWorkspacePage(session,'inbox')||api.isBranchAllowed?.(branch)!==true||user.email.toLowerCase()!==OWNER_EMAIL&&!session.allowedBranches?.some(value=>value==='All'||value===branch))throw Error('Open this branch with an approved HQ Request Inbox account.');
 return JSON.stringify([user.uid,user.email,session]);
}
const fresh=snapshot=>{if(!snapshot||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the original saved declaration.');return snapshot;};
export async function acknowledgeScheduleDeclaration(api,{requestId,attendanceId,expectedFingerprint,branch}){
 if(!id(requestId)||!id(attendanceId)||typeof expectedFingerprint!=='string'||!expectedFingerprint||expectedFingerprint.length>180000)throw Error('Reopen the exact saved declaration before marking it reviewed.');
 const user=api.auth?.currentUser,session=api.sessionUser,key=authority(api,branch),guard=()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session||authority(api,branch)!==key)throw Error('The HQ account or branch access changed. Reopen this declaration.');};
 return api.runTransaction(api.db,async tx=>{
  const requestRef=api.doc(api.db,'staff_requests',requestId),attendanceRef=api.doc(api.db,'attendance_logs',attendanceId),[saved,punch]=await Promise.all([tx.get(requestRef).then(fresh),tx.get(attendanceRef).then(fresh)]);guard();
  if(!saved.exists()||!punch.exists())throw Error('The saved declaration or original clock-in is missing.');
  const request={...saved.data(),id:requestId},attendance={...punch.data(),id:attendanceId};
  if(request.type!=='Schedule Declaration'||request.branch!==branch||request.attendanceLogId!==attendanceId||scheduleDeclarationSourceFingerprint(request,attendance)!==expectedFingerprint)throw Error('The statement or its original clock-in changed. Reopen it before review.');
  if(request.status==='Reviewed'&&request.declarationAcknowledgement?.acknowledgementOnly===true&&request.declarationAcknowledgement.sourceFingerprint===expectedFingerprint)return {alreadyReviewed:true,requestId};
  if(request.status!=='Pending')throw Error('This statement was already processed. Refresh its saved result.');
  guard();tx.update(requestRef,{status:'Reviewed',managerReply:'Staff statement reviewed. Any assigned-hours correction must be reviewed separately on the linked attendance.',processedAt:api.serverTimestamp(),processedBy:user.email,declarationAcknowledgement:{version:1,acknowledgementOnly:true,attendanceId,sourceFingerprint:expectedFingerprint,reviewedByUid:user.uid,reviewedByEmail:user.email,recordedAt:api.serverTimestamp()}});
  return {reviewed:true,requestId};
 });
}
export function installScheduleDeclarationReview(api=window,d=document){
 let dialog=null,generation=0,busy=false;
 async function open(requestId){
  if(busy)throw Error('The earlier acknowledgment is being saved. Wait for its result.');if(!id(requestId))throw Error('Choose one saved declaration.');
  const token=++generation,user=api.auth?.currentUser,session=api.sessionUser;dialog?.close();dialog=d.createElement('dialog');const node=dialog;
  node.setAttribute('aria-label','Review staff shift statement');node.style.cssText='width:min(680px,94vw);max-height:88vh;overflow:auto;border:1px solid #c9dbd0;border-radius:14px;padding:24px;color:#173f32';node.innerHTML='<h2>Staff shift statement</h2><p data-declaration-status role="status">Loading the exact saved statement and clock-in…</p><div data-declaration-content></div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button type="button" data-declaration-attendance disabled>Review linked attendance</button><button type="button" data-declaration-ack disabled>Mark statement reviewed</button><button type="button" data-declaration-close>Close</button></div>';d.body.append(node);node.showModal();
  const status=node.querySelector('[data-declaration-status]'),ack=node.querySelector('[data-declaration-ack]'),close=node.querySelector('[data-declaration-close]'),attendanceButton=node.querySelector('[data-declaration-attendance]'),current=()=>generation===token&&dialog===node&&node.open&&api.auth?.currentUser===user&&api.sessionUser===session;
  const guard=()=>{if(!current())throw Error('The open statement or account changed.');};close.onclick=()=>{if(!busy){generation++;node.close();node.remove();}};node.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  try{
   const read=async(table,key)=>{let timeout;try{return fresh(await Promise.race([api.getDocFromServer(api.doc(api.db,table,key)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('The statement took too long. Close it and retry.')),15000);})]));}finally{clearTimeout(timeout);}};
   const saved=await read('staff_requests',requestId);guard();if(!saved.exists())throw Error('This statement no longer exists.');const request={...saved.data(),id:requestId};authority(api,request.branch);if(request.type!=='Schedule Declaration'||!id(request.attendanceLogId))throw Error('Choose the linked schedule declaration in Request Inbox.');
   const punch=await read('attendance_logs',request.attendanceLogId);guard();authority(api,request.branch);if(!punch.exists())throw Error('The original linked Time In is missing.');const attendance={...punch.data(),id:request.attendanceLogId},fingerprint=scheduleDeclarationSourceFingerprint(request,attendance);
   node.querySelector('[data-declaration-content]').innerHTML=scheduleDeclarationHTML(request)+'<p>Original Time In: '+escape(stamp(attendance.timestamp))+' · '+escape(attendance.branch)+'</p><p>Marking this statement reviewed acknowledges the explanation only. Use linked attendance for any dated-hours decision.</p>';
   status.textContent=request.status==='Reviewed'?'This staff statement was acknowledged. Its schedule review remains separate.':'Review the statement and its linked attendance.';attendanceButton.disabled=false;ack.disabled=request.status!=='Pending';
   attendanceButton.onclick=()=>{guard();authority(api,request.branch);node.close();generation++;return api.openAttendanceRecovery?.({staffId:request.staffId,staffName:request.staffName,branch:request.branch,attendanceLogId:request.attendanceLogId,from:request.scheduleDeclaration.workDate,to:request.scheduleDeclaration.workDate});};
   ack.onclick=async()=>{if(busy||!current())return;busy=true;ack.disabled=true;close.disabled=true;attendanceButton.disabled=true;status.textContent='Saving the acknowledgment. A submitted save cannot be canceled by closing the page.';try{const result=await acknowledgeScheduleDeclaration(api,{requestId,attendanceId:request.attendanceLogId,branch:request.branch,expectedFingerprint:fingerprint});guard();status.textContent=result.alreadyReviewed?'This statement was already marked reviewed.':'Statement reviewed. Original attendance, assigned hours and payroll remain unchanged.';await api.ownerInbox?.applyConfirmedRequest?.(requestId);}catch(error){if(current()){status.textContent=error.message;ack.disabled=false;}}finally{busy=false;if(current()){close.disabled=false;attendanceButton.disabled=false;}}};
  }catch(error){if(current())status.textContent=error.message;}
 }
 api.reviewScheduleDeclaration=requestId=>open(requestId).catch(error=>api.ManagerUI?.notify?.(error.message));return {open,dispose(){if(busy)return;generation++;dialog?.close();dialog?.remove();dialog=null;}};
}
