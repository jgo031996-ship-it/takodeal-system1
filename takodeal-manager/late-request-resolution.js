import {OWNER_EMAIL,createWorkspaceSession,canOpenWorkspacePage} from './workspace-access-model.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {loadClockOutSchedule} from './attendance-schedule-reader.js';
import {resolveAttendanceShift,attendanceLateMinutes,isLatenessRequest,requestLateMinutes,legacyAttendanceCandidates,reviewLateRequest} from './payroll-safety.js';
import {attendanceAmendmentReviewFingerprint} from './attendance-amendment-review-model.js';
import {memoizedAttendanceTransaction} from './attendance-transaction-reader.js';

const idEncoder=new TextEncoder();
const validId=value=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!/[\/\u0000-\u001f\u007f-\u009f]/u.test(value)&&idEncoder.encode(value).length<=1500;
const key=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const instant=value=>value?.toMillis?.()??(value?.seconds!==undefined?value.seconds*1000+Math.floor((value.nanoseconds||0)/1e6):value instanceof Date?+value:Date.parse(value));
const canonical=value=>value instanceof Date||value?.seconds!==undefined||typeof value?.toMillis==='function'?{at:instant(value)}:Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(name=>[name,canonical(value[name])])):value??null;
function authority(api){const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||session.email?.toLowerCase()!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true)throw Error('The verified Owner must resolve this corrected attendance letter.');return JSON.stringify([user.uid,user.email,session.uid,session.email,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches]);}
function fresh(snapshot){if(!snapshot||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('HQ has not confirmed the saved attendance review. Reconnect and reopen this letter.');return snapshot;}
// Bind the original letter and its exact linked punch/review. Resolution fields
// are excluded so a lost acknowledgement can confirm the same saved operation.
export function lateRequestResolutionFingerprint(request,attendance,shift){
 const fields=['id','type','staffId','staffName','branch','attendanceLogId','lateMinutes','explanationCause','explanationMessage','timestamp','payrollReviewVersion','lateDeductionHours','payrollEffect','penaltyCharged'];
 return JSON.stringify(canonical({request:Object.fromEntries(fields.map(name=>[name,request?.[name]??null])),attendanceReview:attendanceAmendmentReviewFingerprint(attendance,shift),confirmedReview:attendance.scheduleAmendmentReview||null}));
}
export async function resolveCorrectedLateRequest(api,{requestId,attendanceId,expectedFingerprint,action,reply=''}){
 if(!validId(requestId)||!validId(attendanceId)||typeof expectedFingerprint!=='string'||!expectedFingerprint||expectedFingerprint.length>60000||!['Approved','Rejected'].includes(action)||typeof reply!=='string'||reply.length>1500)throw Error('Reopen the exact corrected attendance letter before confirming.');
 const user=api.auth?.currentUser,session=api.sessionUser,captured=authority(api),guard=()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session||authority(api)!==captured)throw Error('The Owner account changed. Reopen the attendance letter.');};
 const query=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',OWNER_EMAIL)));
 if(query.metadata?.fromCache||query.metadata?.hasPendingWrites||!Array.isArray(query.docs)||!query.docs.length||query.docs.length>10||query.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('The saved Owner account could not be confirmed with HQ.');guard();
 const reference=(table,id)=>api.doc(api.db,table,id),message=reply.trim();
 return api.runTransaction(api.db,async tx=>{
  const reqRef=reference('staff_requests',requestId),logRef=reference('attendance_logs',attendanceId),[requestSnap,logSnap]=await Promise.all([tx.get(reqRef).then(fresh),tx.get(logRef).then(fresh)]);guard();
  if(!requestSnap.exists()||!logSnap.exists())throw Error('The letter or its original Time In is missing.');
  const request={...requestSnap.data(),id:requestId},log={...logSnap.data(),id:attendanceId};
  if(!isLatenessRequest(request)||request.attendanceLogId!==attendanceId||!validId(log.staffId)||request.staffId&&request.staffId!==log.staffId||log.branch!==request.branch||key(log.staffName)!==key(request.staffName)||String(log.type).toUpperCase()!=='TIME IN'||log.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(log.status)||log.lateReasonRequestId&&log.lateReasonRequestId!==requestId||log.lateReviewRequestId&&log.lateReviewRequestId!==requestId)throw Error('The letter does not match this active saved Time In. Open its exact attendance review.');
  if(typeof api.isBranchAllowed==='function'&&!api.isBranchAllowed(log.branch))throw Error('This attendance branch is outside your Owner workspace.');
  const [personSnap,...accountSnaps]=await Promise.all([tx.get(reference('cashiers',log.staffId)).then(fresh),...query.docs.map(row=>tx.get(reference('hq_managers',row.id)).then(fresh))]);guard();
  const records=accountSnaps.filter(row=>row.exists()).map(row=>({id:row.id,data:row.data()}));if(records.some(row=>key(row.data.email)!==OWNER_EMAIL))throw Error('The saved Owner account changed.');
  const account=resolveHQAccount(records);if(account.active===false||account.blocked===true||account.archived===true||/blocked|inactive|revoked|disabled/i.test(String(account.status||''))||/^(REVOKED|BLOCKED)$/i.test(savedPin(account)))throw Error('The saved Owner account is inactive.');const saved=createWorkspaceSession(user,account);if(saved.isOwner!==true||saved.isFranchisee===true)throw Error('The saved account cannot resolve this Owner review.');
  const person=personSnap.exists()?personSnap.data():null;if(!person||key(person.cashierName)!==key(log.staffName))throw Error('The saved staff identity changed. Ask HR to confirm it.');
  const read=ref=>{guard();return tx.get(ref).then(fresh);},history=await loadClockOutSchedule({db:api.db,doc:api.doc},log,{...person,id:log.staffId,staffId:log.staffId},{read,assertCurrent:guard}),shift=resolveAttendanceShift(log,history,{[log.staffName]:{...person,staffId:log.staffId}},log.staffName);guard();
  if(shift?.attendanceCorrectionVerified!==true||shift.amendmentNeedsReview===true||shift.needsScheduleReview===true||!Array.isArray(shift.scheduleAmendmentIds)||!shift.scheduleAmendmentIds.length||attendanceLateMinutes(log,shift)!==0)throw Error('This letter needs a confirmed dated correction with zero lateness. Open the linked HR review first.');
  const fingerprint=lateRequestResolutionFingerprint(request,log,shift);if(fingerprint!==expectedFingerprint)throw Error('The letter, attendance or confirmed schedule review changed. Reopen this exact record.');
  const existing=request.datedLateResolution;
  if(request.status!=='Pending'){
   if(request.status===action&&request.managerReply===message&&request.currentReviewedLateMinutes===0&&request.originalSubmissionPreserved===true&&existing?.version===1&&existing.sourceFingerprint===fingerprint&&existing.attendanceId===attendanceId&&existing.actorUid===user.uid&&existing.actorEmail===OWNER_EMAIL)return {alreadyResolved:true,requestId,attendanceId,lateMinutes:0};
   throw Error('This letter was already resolved. Refresh its saved result.');
  }
  if(existing)throw Error('A dated resolution is already saved for this letter. Refresh its history before any further review.');
  const stamp=api.serverTimestamp(),marker={version:1,attendanceId,sourceFingerprint:fingerprint,currentReviewedLateMinutes:0,originalLateMinutes:requestLateMinutes(request,log),scheduleAmendmentIds:[...shift.scheduleAmendmentIds],scheduleReviewAuditId:log.scheduleAmendmentReview?.auditId||'',expectedStartAt:new Date(instant(shift.expectedStartAt)).toISOString(),actorUid:user.uid,actorEmail:OWNER_EMAIL,recordedAt:stamp};guard();
  tx.update(reqRef,{status:action,managerReply:message,processedAt:stamp,processedBy:OWNER_EMAIL,currentReviewedLateMinutes:0,originalSubmissionPreserved:true,datedLateResolution:marker});
  return {resolved:true,requestId,attendanceId,lateMinutes:0};
 });
}
// The original decision path remains available to approved HQ managers. Its
// schedule guard runs in the very same transaction as the unchanged legacy
// attendance updates, so a correction arriving after preview cannot be missed.
export async function reviewOriginalLateRequest(api,{requestId,attendanceId,profileId,action,reply='',actor}){
 if(!validId(requestId)||!validId(attendanceId)||!validId(profileId)||!['Approved','Rejected'].includes(action)||typeof reply!=='string'||reply.length>1500||typeof actor!=='string'||!actor.trim()||actor.length>200)throw Error('Reopen the original attendance letter and its exact employee profile.');
 const identity=()=>{const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||!user.email||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||key(session.email)!==key(user.email)||session.isFranchisee===true||!canOpenWorkspacePage(session,'inbox'))throw Error('Sign in with approved HQ Request Inbox access to review this letter.');return JSON.stringify([user.uid,user.email,session.uid,session.email,session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches,session.branch]);};
 const user=api.auth?.currentUser,session=api.sessionUser,captured=identity(),current=()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session||identity()!==captured)throw Error('The signed-in HQ account changed. Reopen the attendance letter.');};
 const guardedAPI={db:api.db,doc:api.doc,serverTimestamp:api.serverTimestamp,runTransaction:(db,callback)=>api.runTransaction(db,async original=>{
  const transaction=memoizedAttendanceTransaction(original);let branch;
  const guard=()=>{current();if(branch&&(key(user.email)!==OWNER_EMAIL&&!session.allowedBranches?.includes('All')&&!session.allowedBranches?.includes(branch)||branch&&typeof api.isBranchAllowed==='function'&&!api.isBranchAllowed(branch)))throw Error('This attendance branch is outside your Request Inbox access.');};
  const read=reference=>{guard();return transaction.get(reference).then(snapshot=>{guard();return fresh(snapshot);});};
  const bound=Object.freeze({get:read,set(...args){guard();transaction.set(...args);return bound;},update(...args){guard();transaction.update(...args);return bound;},delete(...args){guard();transaction.delete(...args);return bound;}});
  const reference=(table,id)=>api.doc(db,table,id),[reqSnap,logSnap,personSnap]=await Promise.all([read(reference('staff_requests',requestId)),read(reference('attendance_logs',attendanceId)),read(reference('cashiers',profileId))]);
  if(!reqSnap.exists()||!logSnap.exists()||!personSnap.exists())throw Error('The letter, original Time In or exact employee profile is missing.');
  const request={...reqSnap.data(),id:requestId},log={...logSnap.data(),id:attendanceId},person=personSnap.data();branch=log.branch;guard();
  if(!isLatenessRequest(request)||!branch||request.branch!==branch||key(request.staffName)!==key(log.staffName)||key(person.cashierName)!==key(log.staffName)||request.staffId&&request.staffId!==profileId||log.staffId&&log.staffId!==profileId||String(log.type).toUpperCase()!=='TIME IN'||log.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(log.status)||request.attendanceLogId&&request.attendanceLogId!==attendanceId||!request.attendanceLogId&&!legacyAttendanceCandidates(request,[log]).length)throw Error('The selected letter, Time In and employee profile do not match. Reopen the exact record.');
  const history=await loadClockOutSchedule({db:api.db,doc:api.doc},log,{...person,id:profileId,staffId:profileId},{read,assertCurrent:guard}),shift=resolveAttendanceShift(log,history,{[log.staffName]:{...person,staffId:profileId}},log.staffName);guard();
  if(shift?.attendanceCorrectionVerified===true||shift?.amendmentNeedsReview===true||shift?.assignmentReconciliationRequired===true)throw Error('A dated schedule correction now applies to this attendance. Open its HR review before resolving the original letter.');
  return callback(bound);
 })};
 current();return reviewLateRequest(guardedAPI,{requestId,attendanceId,action,reply,actor});
}
