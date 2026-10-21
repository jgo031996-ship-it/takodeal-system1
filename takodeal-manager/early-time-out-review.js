import {createEarlyTimeOutService} from './early-time-out-actions.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {createWorkspaceSession,canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';
import {linkedTimeOutId} from './attendance-reconcile.js';
const text=value=>String(value??'').trim();
const permissions=value=>(Array.isArray(value)?value:[]).map(entry=>text(entry).toLowerCase());
const reviewerIdentity=api=>JSON.stringify([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.role,api.sessionUser?.permissions,api.sessionUser?.allowedBranches]);
export function canReviewEarlyTimeOut(api,branch){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||!user.email||user.emailVerified!==true||session?.uid!==user.uid||text(session.email).toLowerCase()!==user.email.toLowerCase()||!canOpenWorkspacePage(session,'inbox'))return false;
 return !branch||user.email.toLowerCase()===OWNER_EMAIL||session.allowedBranches?.includes('All')||session.allowedBranches?.includes(branch);
}
function authority(api,actor,profile,grant,branch){
 if(!canReviewEarlyTimeOut(api,branch)||api.auth.currentUser.uid!==actor.uid||api.auth.currentUser.email.toLowerCase()!==actor.email)throw Error('Your signed-in attendance approval access changed. Reopen the request.');
 if(profile.active===false||profile.archived===true||profile.blocked===true||/blocked|disabled|inactive|revoked|terminated|archived|resigned|deleted/i.test(text(profile.status))||['BLOCKED','REVOKED'].includes(savedPin(profile).toUpperCase()))throw Error('Your saved HQ account is inactive. Ask the Owner to review Access Control.');
 const saved=createWorkspaceSession(api.auth.currentUser,profile);
 if(!canOpenWorkspacePage(saved,'inbox')||branch&&actor.email!==OWNER_EMAIL&&!saved.allowedBranches.includes('All')&&!saved.allowedBranches.includes(branch))throw Error('Saved Request Inbox access is required for this branch.');
 if(actor.email===OWNER_EMAIL)return;
 if(grant?.active!==true||!permissions(grant.permissions).some(key=>['all','payroll','inbox'].includes(key))||!Array.isArray(grant.allowedBranches)||branch&&!grant.allowedBranches.includes('All')&&!grant.allowedBranches.includes(branch))throw Error('The Owner has not granted Request Inbox approval for this branch.');
}
export function createEarlyTimeOutReviewService(api,{timeoutMs=25000,now=()=>new Date()}={}){
 const pending=new Map();
 const validId=id=>typeof id==='string'&&id.length>0&&id.length<=150&&!id.includes('/');
 function fresh(snapshot,{strict=false}={}){if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||strict&&(!snapshot.metadata||snapshot.metadata.fromCache!==false||snapshot.metadata.hasPendingWrites!==false)||snapshot.docs?.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites||strict&&(!row.metadata||row.metadata.fromCache!==false||row.metadata.hasPendingWrites!==false)))throw Error('Confirm the saved request and approval account with HQ before reviewing.');return snapshot;}
 function invoke(action,input){
  if(!canReviewEarlyTimeOut(api))throw Error('Sign in with approved Request Inbox access to review early time-out.');
  const actor={uid:api.auth.currentUser.uid,email:api.auth.currentUser.email.toLowerCase()},identity=reviewerIdentity(api),preview=action==='inspectRequest';
  const key=JSON.stringify([identity,action,{...input,onVerifiedRequest:undefined}]);let entry=pending.get(key);
  if(entry){if(typeof input.onVerifiedRequest==='function'){entry.listeners.add(input.onVerifiedRequest);if(entry.request&&!entry.expired)input.onVerifiedRequest(entry.request);}return entry.bounded;}
  entry={expired:false,listeners:new Set(typeof input.onVerifiedRequest==='function'?[input.onVerifiedRequest]:[]),request:null,physical:new Set()};pending.set(key,entry);
  const guard=()=>{if(entry.expired)throw Error('HQ has not confirmed this review yet. Reopen the request after checking its saved status.');if(identity!==reviewerIdentity(api)||!canReviewEarlyTimeOut(api))throw Error('The signed-in approval account changed. Reopen the request.');};
  let timer;
  const retain=promise=>{const saved=Promise.resolve(promise);entry.physical.add(saved);saved.catch(()=>{});return saved;};
  const physical=Promise.resolve().then(async()=>{
   guard();if(!validId(input.requestId))throw Error('Refresh the saved time-out request.');
   // This map belongs to this one fresh preview only. It never serves a later
   // approval transaction or another account/operation.
   const reads=new Map(),read=reference=>{guard();const key=reference?.path||reference;if(!reads.has(key))reads.set(key,Promise.resolve().then(()=>{guard();return retain(api.getDocFromServer(reference));}).then(snapshot=>{guard();fresh(snapshot,{strict:true});if(typeof snapshot.exists!=='function')throw Error('The saved attendance response is incomplete.');return snapshot;}));return reads.get(key);};
   const requestRef=api.doc(api.db,'staff_requests',input.requestId),request=preview?read(requestRef):null;
   // The source read is independent of HQ account loading, but no request is
   // exposed until fresh branch authority has been checked below.
   if(request)request.then(async snapshot=>{const row=snapshot.exists()?snapshot.data():null;if(row?.type!=='Early Time Out'||!validId(row.timeInLogId)||!validId(row.staffId)||!canReviewEarlyTimeOut(api,row.branch))return;const outId=await linkedTimeOutId(row.staffId,row.timeInLogId);guard();await Promise.all([
    read(api.doc(api.db,'attendance_logs',row.timeInLogId)),read(api.doc(api.db,'cashiers',row.staffId)),read(api.doc(api.db,'attendance_logs',outId)),read(api.doc(api.db,'attendance_time_out_approvals',input.requestId)),read(api.doc(api.db,'attendance_shift_confirmations',row.timeInLogId))
   ]);}).catch(()=>{});
   const [accounts,grant]=await Promise.all([
    Promise.resolve().then(()=>retain(api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email))))).then(snapshot=>fresh(snapshot,{strict:preview})),
    actor.email===OWNER_EMAIL?null:preview?read(api.doc(api.db,'hq_email_access',actor.email)):retain(api.getDocFromServer(api.doc(api.db,'hq_email_access',actor.email))).then(snapshot=>fresh(snapshot))
   ]);guard();
   let checked={profile:resolveHQAccount(accounts.docs.map(row=>({id:row.id,data:row.data()}))),grant:grant?.exists()?grant.data():null};authority(api,actor,checked.profile,checked.grant);
   if(preview){const snapshot=await request;guard();const row=snapshot.exists()?snapshot.data():null;if(!row||row.type!=='Early Time Out'||row.status!=='Pending')throw Error('This request is no longer pending. Refresh Request Inbox.');authority(api,actor,checked.profile,checked.grant,row.branch);entry.request={...row,id:input.requestId};for(const callback of entry.listeners)callback(entry.request);}
   const protectedAPI={...api,runTransaction:preview?async(_db,callback)=>{
    // The core inspector is read-only. Keeping its existing resolver/link
    // checks while using server gets avoids a read-only Firestore transaction
    // and duplicate HQ reads. Every write below uses the real transaction.
    const readonly={get:read,set(){throw Error('Attendance previews cannot write.');},update(){throw Error('Attendance previews cannot write.');},delete(){throw Error('Attendance previews cannot write.');}};
    const result=await retain(callback(readonly));guard();authority(api,actor,checked.profile,checked.grant,result.request?.branch);return result;
   }:(db,callback)=>retain(api.runTransaction(db,async tx=>{
    guard();const [profiles,bridge]=await Promise.all([
     Promise.all(accounts.docs.map(async row=>{const snapshot=await tx.get(api.doc(api.db,'hq_managers',row.id));return snapshot.exists()?{id:row.id,data:snapshot.data()}:null;})),
     actor.email===OWNER_EMAIL?null:tx.get(api.doc(api.db,'hq_email_access',actor.email))
    ]);guard();checked={profile:resolveHQAccount(profiles.filter(Boolean)),grant:bridge?.exists()?bridge.data():null};authority(api,actor,checked.profile,checked.grant);return callback(tx);
   }))};
   const result=await createEarlyTimeOutService(protectedAPI,{now,timeoutMs})[action]({...input,reviewer:actor,assertReviewAccess:branch=>{guard();authority(api,actor,checked.profile,checked.grant,branch);return true;}});guard();return result;
  });
  entry.bounded=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>{entry.expired=true;reject(Error('HQ has not confirmed this review yet. Refresh the saved request before retrying. Your attendance and actual hours remain on file.'));},timeoutMs);})]).finally(()=>clearTimeout(timer));
  // A timed-out physical read keeps its slot until it settles, preventing a
  // retry flood. Its late result cannot enable controls or authorize a write.
  physical.finally(async()=>{await Promise.allSettled([...entry.physical]);if(pending.get(key)===entry)pending.delete(key);entry.listeners.clear();}).catch(()=>{});
  return entry.bounded;
 }
 return {includesVerifiedRequest:true,review:input=>Promise.resolve().then(()=>invoke('review',input)),inspect:input=>Promise.resolve().then(()=>invoke('inspectRequest',input)),confirmShift:input=>Promise.resolve().then(()=>invoke('confirmShiftRequest',input)),dismiss:input=>Promise.resolve().then(()=>invoke('dismissRequest',input))};
}
