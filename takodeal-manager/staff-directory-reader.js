import {loadStaffSalaryTimeline} from './staff-rate-model.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';

const sessions=new WeakMap();let nextSession=0;
const email=value=>String(value||'').trim().toLowerCase();
export function staffDirectoryActorKey(api,page='branches'){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!['branches','payroll'].includes(page)||!user?.uid||!email(user.email)||user.emailVerified!==true||session?.uid!==user.uid||email(session.email)!==email(user.email)||session.active===false||session.blocked===true||/^(blocked|disabled|inactive|revoked)$/i.test(String(session.status||''))||!canOpenWorkspacePage(session,page))throw Error('Sign in with your approved staff-management account before loading employee records.');
 if(session.isFranchisee===true&&(!Array.isArray(session.allowedBranches)||session.allowedBranches.length!==1||!session.branch||session.branch==='All'||session.allowedBranches[0]!==session.branch))throw Error('The franchise account needs its one assigned branch before loading employee records.');
 if(!sessions.has(session))sessions.set(session,++nextSession);
 return JSON.stringify([user.uid,email(user.email),user.emailVerified,sessions.get(session),session.uid,email(session.email),session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches,session.branch,session.assignedBranch,session.active,session.blocked,session.status,page]);
}
async function mapBounded(tasks,guard,concurrency){
 const values=new Array(tasks.length);let next=0,failure;
 await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{
  while(!failure&&next<tasks.length){const index=next++;try{guard();values[index]=await tasks[index]();guard();}catch(error){failure ||= error;}}
 }));
 if(failure)throw failure;return values;
}
function directoryRows(snapshot){
 if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||!Array.isArray(snapshot.docs)||snapshot.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Connect to HQ to confirm the current employee directory.');
 return snapshot.docs.map(row=>({...row.data(),id:row.id,staffId:row.id}));
}

// This reader changes scheduling, not freshness: every invocation obtains new
// server data. It never persists or caches employee profiles or wage history.
export function loadStaffDirectory(api,{page='branches',selectedBranch=null,assertCurrent=()=>{},profileFilter=()=>true,readRates=()=>true,allowPartialRates=false,concurrency=4,timeoutMs=25000}={}){
 try{
  if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>6||!Number.isFinite(timeoutMs)||timeoutMs<1||typeof api.getDocsFromServer!=='function'||typeof api.getDocFromServer!=='function')throw Error('Reconnect to HQ before loading staff records.');
  const actor=staffDirectoryActorKey(api,page),session=api.sessionUser,all=email(api.auth.currentUser.email)===OWNER_EMAIL||session.allowedBranches?.includes('All'),assigned=[...new Set((session.allowedBranches||[]).filter(branch=>typeof branch==='string'&&branch&&branch!=='All'))];
  if(selectedBranch!==null&&(typeof selectedBranch!=='string'||!selectedBranch||!all&&!assigned.includes(selectedBranch))||!all&&!assigned.length)throw Error('This employee directory is outside your assigned branches.');
  const branches=selectedBranch!==null?[selectedBranch]:all?[null]:assigned;let expired=false,timer;
  const guard=()=>{assertCurrent();if(expired)throw Error('HQ took too long to confirm staff records. Reconnect and refresh.');if(staffDirectoryActorKey(api,page)!==actor)throw Error('The staff-management account or branch access changed. Reopen the employee directory.');};guard();
  const work=(async()=>{
   const snapshots=await mapBounded(branches.map(branch=>async()=>{guard();const base=api.collection(api.db,'cashiers'),reference=branch===null?base:api.query(base,api.where('branch','==',branch));return directoryRows(await api.getDocsFromServer(reference));}),guard,concurrency);
   const records=new Map();for(const rows of snapshots)for(const profile of rows)if((all||assigned.includes(profile.branch))&&(selectedBranch===null||profile.branch===selectedBranch)&&profileFilter(profile))records.set(profile.id,profile);
   const profiles=[...records.values()],tasks=profiles.map(profile=>async()=>{
    if(profile.salaryRateVersion!==1||!readRates(profile))return profile;
    try{
     const checked=await loadStaffSalaryTimeline(api,profile,{read:async reference=>{guard();const snapshot=await api.getDocFromServer(reference);guard();return snapshot;}});guard();
     if(profile.salaryRateRevision&&checked.salaryRateTimeline.revisionId!==profile.salaryRateRevision)throw Error('Salary dates changed while this directory was loading. Refresh the employee record.');
     return {...checked,salaryRateUnavailable:false};
    }catch(error){guard();if(!allowPartialRates)throw error;return {...profile,salaryRateUnavailable:true};}
   });
   const loaded=await mapBounded(tasks,guard,concurrency);guard();return loaded;
  })();
  return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('HQ took too long to confirm staff records. Reconnect and refresh.'));},timeoutMs);})]).finally(()=>clearTimeout(timer));
 }catch(error){return Promise.reject(error);}
}
