import {OWNER_EMAIL,createWorkspaceSession} from './workspace-access-model.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {createScheduleHistoryStore,scheduleDateKey} from './schedule-history.js';
import {resolveAttendanceShift} from './payroll-safety.js';
import {attendanceAmendmentReviewFingerprint,amendmentReviewResult} from './attendance-amendment-review-model.js';
const validId=id=>typeof id==='string'&&/^[-A-Za-z0-9_]{1,180}$/.test(id),data=s=>s?.exists?.()?s.data():null;
const instant=v=>v?.toDate?.()||(v?.seconds!==undefined?new Date(v.seconds*1000):new Date(v));
function actor(api){const u=api.auth?.currentUser,s=api.sessionUser;if(!u?.uid||u.email?.toLowerCase()!==OWNER_EMAIL||u.emailVerified!==true||!u.providerData?.some(x=>x.providerId==='google.com')||s?.uid!==u.uid||s.email?.toLowerCase()!==OWNER_EMAIL||s.isOwner!==true||s.isFranchisee===true)throw Error('The verified Owner must confirm this dated attendance review.');return JSON.stringify([u.uid,u.email,s.uid,s.email,s.permissions,s.allowedBranches,s.isOwner]);}
export async function confirmAttendanceAmendmentReview(api,{attendanceId,expectedFingerprint,expectedRevision,choice,reason}){
 if(!validId(attendanceId)||typeof expectedFingerprint!=='string'||expectedFingerprint.length>30000||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof reason!=='string'||reason.trim().length<8||reason.trim().length>1500)throw Error('Open the affected Time In and complete its review first.');
 const key=actor(api),ref=(table,id)=>api.doc(api.db,table,id),hq=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',OWNER_EMAIL)));
 if(hq.metadata?.fromCache||hq.metadata?.hasPendingWrites||hq.docs.length>10||hq.docs.some(r=>r.metadata?.fromCache||r.metadata?.hasPendingWrites))throw Error('The Owner account could not be confirmed with HQ.');
 const guard=()=>{if(actor(api)!==key)throw Error('The Owner account changed. Reopen the attendance review.');};guard();
 return api.runTransaction(api.db,async tx=>{
  const attRef=ref('attendance_logs',attendanceId),snap=await tx.get(attRef),log=data(snap);if(!log||log.type!=='TIME IN'||log.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(log.status)||!validId(log.staffId))throw Error('This Time In needs a saved staff ID before its review can be confirmed.');
  const [staff,...accounts]=await Promise.all([tx.get(ref('cashiers',log.staffId)),...hq.docs.map(r=>tx.get(ref('hq_managers',r.id)))]),profile=data(staff),account=resolveHQAccount(accounts.filter(s=>s.exists()).map(s=>({id:s.id,data:s.data()})));
  if(account.active===false||account.blocked===true||/blocked|inactive|revoked|disabled/i.test(String(account.status||''))||/^(REVOKED|BLOCKED)$/i.test(savedPin(account)))throw Error('The saved Owner account is inactive.');createWorkspaceSession(api.auth.currentUser,account);
  if(!profile||profile.cashierName!==log.staffName)throw Error('The saved staff identity changed. Ask HR to confirm it.');
  const at=instant(log.timestamp);if(!Number.isFinite(+at))throw Error('The Time In date is invalid.');
  const read=reference=>tx.get(reference),store=createScheduleHistoryStore({...api,getDocFromServer:read,getDoc:read}),history=await store.loadRange(new Date(+at-86400000),new Date(+at+86400000));guard();
  const shift=resolveAttendanceShift({...log,id:attendanceId},history,{[log.staffName]:{...profile,staffId:log.staffId}},log.staffName);
  if(!shift?.attendanceCorrectionVerified||!shift.scheduleAmendmentIds?.length)throw Error('No verified dated correction can be reviewed for this Time In. Open its workday schedule.');
  const fingerprint=attendanceAmendmentReviewFingerprint(log,shift),previous=log.scheduleAmendmentReview,revision=(previous?.revision||0)+1;
  if(fingerprint!==expectedFingerprint||(previous?.revision||0)!==expectedRevision)throw Error('The attendance, schedule or saved review changed. Refresh this specific record before confirming.');
  const result=amendmentReviewResult(log,shift,choice),id='amendment-'+attendanceId+'-'+revision,auditRef=ref('attendance_amendment_reviews',id),audit=await tx.get(auditRef);if(audit.exists())throw Error('This review reference already exists. Refresh its confirmed result.');
  const marker={version:1,revision,auditId:id,sourceFingerprint:fingerprint,choice,...result,reason:reason.trim(),actorUid:api.auth.currentUser.uid,actorEmail:OWNER_EMAIL,reviewedAt:api.serverTimestamp()};guard();
  tx.set(auditRef,{...marker,attendanceId,staffId:log.staffId,staffName:log.staffName,branch:log.branch,workDate:shift.workDate||scheduleDateKey(at),previousReview:previous||null,previousDecision:{lateMinutes:log.lateMinutes??null,reviewedLateMinutes:log.reviewedLateMinutes??null,lateExempted:log.lateExempted===true,lateDecision:log.lateDecision||null,lateReviewRequestId:log.lateReviewRequestId||null}});
  tx.update(attRef,{scheduleAmendmentReview:marker});return {attendanceId,revision,...result};
 });
}
