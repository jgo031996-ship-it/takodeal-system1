import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';
const email=value=>String(value||'').trim().toLowerCase();
export function canExportSopBranch(api,branch){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||user.emailVerified!==true||!session||session.uid!==user.uid||email(session.email)!==email(user.email)||!canOpenWorkspacePage(session,'sop'))return false;
 if(typeof branch!=='string'||!branch.trim()||branch.length>150||branch.includes('/'))return false;
 if(email(user.email)===OWNER_EMAIL)return true;
 const allowed=Array.isArray(session.allowedBranches)?session.allowedBranches:[];
 return allowed.includes(branch)||!session.isFranchisee&&allowed.includes('All');
}
const identity=api=>JSON.stringify([api.auth?.currentUser?.uid,email(api.auth?.currentUser?.email),api.auth?.currentUser?.emailVerified,api.sessionUser?.uid,email(api.sessionUser?.email),api.sessionUser?.permissions,api.sessionUser?.allowedBranches,api.sessionUser?.isFranchisee]);
const cleaned=tasks=>tasks.map(value=>value.trim()).filter(Boolean);
const pendingReads=new WeakMap();
function readSavedChecklist(api,branch,key,guard){
 guard();let pending=pendingReads.get(api);if(!pending){pending=new Map();pendingReads.set(api,pending);}const requestKey=JSON.stringify([key,branch]);let physical=pending.get(requestKey);
 if(!physical){try{guard();physical=Promise.resolve(api.getDocFromServer(api.doc(api.db,'settings','sop_'+branch)));}catch(error){physical=Promise.reject(error);}pending.set(requestKey,physical);physical.finally(()=>{if(pending.get(requestKey)===physical)pending.delete(requestKey);}).catch(()=>{});}
 return physical;
}
export async function loadSopChecklistExport(api,{branch,role='',scope='selected',draftTasks,assertCurrent=()=>{}}={}, {timeoutMs=25000}={}){
 if(!canExportSopBranch(api,branch))throw Error('SOP download is unavailable for this account or branch.');
 if(!['selected','branch'].includes(scope)||scope==='selected'&&(!role||typeof role!=='string'))throw Error('Choose a role or download all roles in this branch.');
 const key=identity(api),guard=()=>{assertCurrent();if(identity(api)!==key||!canExportSopBranch(api,branch))throw Error('The signed-in account or branch access changed. Reopen the download.');};guard();
 let timer;const snap=await Promise.race([readSavedChecklist(api,branch,key,guard),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The saved SOP could not be confirmed. Reconnect and try downloading again.')),timeoutMs);})]).finally(()=>clearTimeout(timer));guard();
 if(!snap?.exists?.()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('No confirmed saved SOP was found. Save the checklist and try again.');
 const saved=snap.data()?.roles;if(!saved||Array.isArray(saved)||typeof saved!=='object')throw Error('The saved SOP roles need review before downloading.');
 const names=Object.keys(saved);if(!names.length||names.length>100)throw Error('No saved roles are available, or this SOP is too large. Choose a role after reviewing it.');
 if(scope==='selected'&&!Object.hasOwn(saved,role))throw Error('This role is no longer saved. Reload the branch and choose a role again.');
 if(draftTasks!==undefined){if(!Array.isArray(draftTasks)||draftTasks.some(task=>typeof task!=='string'))throw Error('The displayed tasks need review. Reopen the checklist.');if(role&&!Object.hasOwn(saved,role))throw Error('This displayed role is no longer saved. Reload the branch before downloading.');if(role){if(!Array.isArray(saved[role])||saved[role].some(task=>typeof task!=='string')||JSON.stringify(cleaned(draftTasks))!==JSON.stringify(cleaned(saved[role])))throw Error('The displayed checklist differs from the latest saved SOP. Save your edits or reload the role before downloading.');}}
 const selected=scope==='selected'?[role]:names;let taskCount=0,charCount=0;
 const roles=selected.map(name=>{const tasks=saved[name];if(!name.trim()||name.length>500||!Array.isArray(tasks)||tasks.length>500||tasks.some(task=>typeof task!=='string'||task.length>20000))throw Error('A saved role or task needs review before exporting.');taskCount+=tasks.length;charCount+=name.length+tasks.reduce((sum,task)=>sum+task.length,0);return {name,tasks:[...tasks]};});
 if(taskCount>2000||charCount>250000)throw Error('This branch checklist is too large for one download. Download one role at a time.');guard();
 return {branch,roles,generatedAt:new Date().toISOString()};
}
