import {createHash} from 'node:crypto';
import {readDutyAttendanceState,verifyDutyInterval,guardIds,paid} from './owner-time-out-service.mjs';
import {loadSavedShiftChoices} from './relief-core/saved-shift-proposal.js';
import {emergencyShiftBounds,emergencyShiftSourceFingerprint} from './relief-core/emergency-shift-model.js';
import {resolveHQAccount,savedPin} from './relief-core/hq-account-model.js';
import {createWorkspaceSession,canOpenWorkspacePage,OWNER_EMAIL} from './relief-core/workspace-access-model.js';
import {attendanceMillis} from './relief-core/attendance-reconcile.js';
import {ATTENDANCE_METADATA_FIELDS} from './relief-core/attendance-metadata-reader.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=value=>typeof value==='string'&&/^[-_a-zA-Z0-9]{1,180}$/.test(value);
const instant=value=>new Date(attendanceMillis(value)).toISOString();
const clock=value=>new Date(Date.parse(value)+28800000).toISOString().slice(11,16);
const deny=()=>{throw Object.assign(Error('Request Inbox access is required for this branch.'),{status:403});};
async function reviewer(db,tx,actor,branch){
 const email=actor.email?.toLowerCase();if(!email||!actor.email_verified||actor.firebase?.sign_in_provider!=='google.com')deny();
 const results=await tx.get(db.collection('hq_managers').where('email','==',email).limit(11));
 if(!results.size||results.size>10)deny();
 const profile=resolveHQAccount(results.docs.map(s=>({id:s.id,data:s.data()})));
 if(profile.archived||profile.blocked||profile.active===false||/blocked|disabled|inactive|revoked|terminated|archived|resigned|deleted/i.test(profile.status||'')||/^(REVOKED|BLOCKED)$/i.test(savedPin(profile)))deny();
 const saved=createWorkspaceSession(actor,profile);if(!canOpenWorkspacePage(saved,'inbox'))deny();
 if(email!==OWNER_EMAIL){
  const grant=(await tx.get(db.doc('hq_email_access/'+email))).data();
  if(!grant?.active||!Array.isArray(grant.permissions)||!grant.permissions.some(p=>['all','inbox','payroll'].includes(p))||![grant.allowedBranches,saved.allowedBranches].every(list=>Array.isArray(list)&&(list.includes('All')||list.includes(branch))))deny();
 }
}
export function createDutyReview(db,{serverTimestamp}){
 return async function duty(action,body,actor){
  if(!['read','save'].includes(action)||!key(body.requestId)||!actor.email_verified||actor.firebase?.sign_in_provider!=='google.com')deny();
  return db.runTransaction(async tx=>{
   const get=async path=>{const snap=await tx.get(db.doc(path));return snap.exists?{...snap.data(),id:snap.id}:null;};
   const request=await get('staff_requests/'+body.requestId);
   if(!request||request.type!=='Early Time Out'||!key(request.timeInLogId)||!key(request.staffId))throw Error('Reopen the saved early Time Out request.');
   await reviewer(db,tx,actor,request.branch);
   if(request.id!=='early-'+hash([request.staffId,request.timeInLogId]))throw Error('The request does not match the original clock record.');
   const context={attendanceLogId:request.timeInLogId,staffId:request.staffId,branch:request.branch,requestId:request.id};
   const query=async(table,field,value)=>{
    const limits={staff_requests:51,cashiers:3,attendance_logs:5001,payroll_records:501},limit=limits[table];
    let q=db.collection(table).where(field,'==',value).limit(limit);if(table==='attendance_logs')q=q.select(...ATTENDANCE_METADATA_FIELDS);
    const snap=await tx.get(q);if(snap.size>=limit)throw Error('The saved records need a separate HR review.');
    return snap.docs.map(s=>({...s.data(),id:s.id}));
   };
   const operationId=body.operationId,revisionId='duty-'+hash([actor.uid,operationId||'']),eventRef=db.doc('attendance_shift_confirmation_events/'+revisionId);
   const intent=hash([context,body.expected||'',body.selection??null]);
   if(action==='save'){
    if(!key(operationId)||operationId.length<16)throw Error('Reopen this duty review.');
    const previous=(await tx.get(eventRef)).data();
    if(previous){if(previous.intent!==intent||previous.requestId!==request.id)throw Error('Reopen the changed duty review.');return {saved:true,recorded:previous.recorded,alreadySaved:true};}
   }
   const state=await readDutyAttendanceState({get,query},context,actor,null,()=>{}),{start,existing}=state;
   if(existing)verifyDutyInterval(state.history,start,existing,new Date(instant(existing.timestamp)));
   const headRef=db.doc('attendance_shift_confirmations/'+start.id),head=(await tx.get(headRef)).data();
   const expected=hash([state.expectedFingerprint,head?.revisionId||'',head?.version||0]);
   const api={db,doc:(db,collection,id)=>db.doc(collection+'/'+id)};
   const {choices}=await loadSavedShiftChoices(api,{start,staffName:start.staffName,staffId:context.staffId},{read:async ref=>{const snap=await tx.get(ref);return {id:snap.id,exists:()=>snap.exists,data:()=>snap.data()};}});
   const blocked=state.covering.length?'This duty is covered by a completed payslip.':request.status!=='Pending'?'This request has already been reviewed.':'';
   if(action==='read')return {staffName:start.staffName,branch:start.branch,requestId:request.id,workDate:new Date(attendanceMillis(start.timestamp)+28800000).toISOString().slice(0,10),timeInAt:instant(start.timestamp),timeOutAt:existing?instant(existing.timestamp):null,reason:request.reason||'',expected,blocked,choices:choices.map(({key,shiftName,workDate,expectedStartAt,expectedEndAt,sourceFingerprint})=>({key,shiftName,workDate,expectedStartAt,expectedEndAt,sourceFingerprint}))};
   if(blocked||expected!==body.expected)throw Error(blocked||'The punches, duty or request changed. Reopen the review.');
   const chosen=body.selection;let input,category,source;
   if(chosen?.mode==='plotted'){
    const selected=choices.find(c=>c.key===chosen.key&&c.sourceFingerprint===chosen.fingerprint);
    if(!selected)throw Error('The plotted schedule changed. Reopen this review.');
    input={workDate:selected.workDate,startTime:clock(selected.expectedStartAt),endTime:clock(selected.expectedEndAt),shiftName:selected.shiftName,reason:'Confirmed plotted duty'};category=selected.shiftType;source={key:selected.key,fingerprint:selected.sourceFingerprint};
   }else if(chosen?.mode==='custom'&&['morning','mid','night','other'].includes(chosen.shiftType)){
    input=chosen;category=chosen.shiftType;source={custom:true};
   }else throw Error('Choose a saved or emergency schedule.');
   const bounds=emergencyShiftBounds(input,start);
   for(const id of guardIds(context,[bounds.workDate])){const record=await get('payroll_records/'+id);if(record&&paid(record,context,[bounds.workDate]))throw Error('A completed payslip covers the selected duty.');}
   const historical=await Promise.all([query('payroll_records','staffId',context.staffId),query('payroll_records','staffName',start.staffName)]);
   if(historical.flat().some(r=>paid(r,context,[bounds.workDate])))throw Error('A completed payslip covers the selected duty.');
   const reviewedAt=serverTimestamp(),email=actor.email.toLowerCase();
   const next={dutyCategory:category,schemaVersion:1,status:'Confirmed',revisionId,version:(head?.version||0)+1,staffId:context.staffId,staffName:start.staffName,branch:start.branch,timeInLogId:start.id,timeInAt:start.timestamp,workDate:bounds.workDate,expectedStartAt:bounds.expectedStartAt,expectedEndAt:bounds.expectedEndAt,shiftName:bounds.shiftName,sourceFingerprint:emergencyShiftSourceFingerprint(start),reviewedByUid:actor.uid,reviewedByEmail:email,reviewedAt};
   tx.set(headRef,next);
   tx.create(eventRef,{schemaVersion:1,source:'recorded-duty-review-v1',head:next,category,selection:source,reason:bounds.reason,previousRevisionId:head?.revisionId||null,requestId:request.id,requestVersion:request.requestVersion,requestToken:request.requestToken,recorded:!!existing,timeOutLogId:existing?.id||null,intent});
   const update={dutyReviewRevisionId:revisionId,managerReply:existing?'Duty confirmed against your recorded Time In and Time Out.':'Duty confirmed. Your Time Out has not been recorded.',staffAcknowledged:false};
   if(existing)Object.assign(update,{status:'Completed Normally',reasonAccepted:true,requiresScheduleReview:false,actualTimeOutRecorded:true,actualTimeOutAt:existing.timestamp,timeOutLogId:existing.id,processedAt:reviewedAt,processedBy:email,processedByUid:actor.uid});
   tx.update(db.doc('staff_requests/'+request.id),update);
   return {saved:true,recorded:!!existing};
  });
 };
}
