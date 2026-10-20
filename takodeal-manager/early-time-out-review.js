import {createEarlyTimeOutService} from './early-time-out-actions.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {createWorkspaceSession,canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';
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
 async function read(promise){let timer;try{const result=await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ and reopen this time-out request.')),timeoutMs);})]);if(result.metadata?.fromCache||result.metadata?.hasPendingWrites||result.docs?.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Confirm the saved approval account with HQ before reviewing.');return result;}finally{clearTimeout(timer);}}
 async function invoke(action,input){
  if(!canReviewEarlyTimeOut(api))throw Error('Sign in with approved Request Inbox access to review early time-out.');
  const actor={uid:api.auth.currentUser.uid,email:api.auth.currentUser.email.toLowerCase()},key=reviewerIdentity(api);
  const guard=()=>{if(key!==reviewerIdentity(api)||!canReviewEarlyTimeOut(api))throw Error('The signed-in approval account changed. Reopen the request.');};
  const accounts=await read(api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email))));guard();
  const grant=actor.email===OWNER_EMAIL?null:await read(api.getDocFromServer(api.doc(api.db,'hq_email_access',actor.email)));guard();
  authority(api,actor,resolveHQAccount(accounts.docs.map(row=>({id:row.id,data:row.data()}))),grant?.exists()?grant.data():null);
  let checked=null;
  const protectedAPI={...api,runTransaction:(db,callback)=>api.runTransaction(db,async tx=>{
   guard();const profiles=[];for(const row of accounts.docs){const snap=await tx.get(api.doc(api.db,'hq_managers',row.id));if(snap.exists())profiles.push({id:row.id,data:snap.data()});}
   const bridge=actor.email===OWNER_EMAIL?null:await tx.get(api.doc(api.db,'hq_email_access',actor.email));guard();
   checked={profile:resolveHQAccount(profiles),grant:bridge?.exists()?bridge.data():null};authority(api,actor,checked.profile,checked.grant);
   return callback(tx);
  })};
  return createEarlyTimeOutService(protectedAPI,{now})[action]({...input,reviewer:actor,assertReviewAccess:branch=>{guard();if(!checked)throw Error('Confirm the approval account again.');authority(api,actor,checked.profile,checked.grant,branch);return true;}});
 }
 return {review:input=>invoke('review',input),inspect:input=>invoke('inspectRequest',input),confirmShift:input=>invoke('confirmShiftRequest',input),dismiss:input=>invoke('dismissRequest',input)};
}
