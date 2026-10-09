import {resolveHQAccount} from './hq-account-model.js';
import {OWNER_EMAIL,configuredPermissions} from './workspace-access-model.js';
const emailOf=value=>String(value ?? '').trim().toLowerCase();
const validEmail=value=>/^[^\s@<>/]+@[^\s@<>/]+\.[^\s@<>/]+$/.test(value);
const inactive=data=>data.active===false || data.blocked===true || ['blocked','disabled','inactive','revoked'].includes(String(data.status || '').trim().toLowerCase());
const ordered=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(ordered):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const signature=value=>JSON.stringify(ordered(value));
const group=(rows,email)=>rows.filter(row=>emailOf(row.data.email)===email);
const escaped=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function verifiedAccessOwner(api) {
    const actor=api.auth?.currentUser;
    if(!actor?.uid || actor.emailVerified!==true || emailOf(actor.email)!==OWNER_EMAIL)throw Error('Only the verified main Owner can synchronize account access.');
    return {uid:actor.uid,email:OWNER_EMAIL};
}
function sameOwner(api,actor) {const current=verifiedAccessOwner(api);if(current.uid!==actor.uid)throw Error('The Owner account changed. Reopen this access review.');}
export function protectedSavedAccess(rows) {
    if(!rows.length)return {active:false,allowedBranches:[],permissions:[]};
    const account=resolveHQAccount(rows),permissions=configuredPermissions(account);
    const active=!inactive(account),franchise=['franchisee','franchise owner'].includes(String(account.role || '').trim().toLowerCase());
    const assigned=account.assignedBranch;
    const branches=[...new Set((Array.isArray(assigned)?assigned:typeof assigned==='string'?assigned.split(','):[]).filter(value=>typeof value==='string').map(value=>value.trim()).filter(Boolean))];
    if(emailOf(account.email)===OWNER_EMAIL && !branches.length)branches.push('All');
    if(active && (!branches.length || franchise && branches.some(branch=>branch.toLowerCase()==='all')))throw Error('Assign this account to its explicit permitted branches before synchronizing access. Franchise accounts cannot use All branches.');
    // All tabs does not widen an explicitly saved branch assignment.
    return {active,allowedBranches:branches.map(branch=>branch.toLowerCase()==='all'?'All':branch),permissions};
}
export async function readHQAccessState(api,{id,email,newEmail}={}) {
    const actor=verifiedAccessOwner(api);
    const snap=await api.getDocsFromServer(api.collection(api.db,'hq_managers'));sameOwner(api,actor);
    const all=snap.docs.map(row=>({id:row.id,data:row.data()})),selected=all.find(row=>row.id===id);
    const target=emailOf(email || selected?.data.email),next=emailOf(newEmail || target);
    if(!validEmail(target) || !validEmail(next))throw Error('Select an account with a valid Google email.');
    const emails=[...new Set([target,next])],rows=all.filter(row=>emails.includes(emailOf(row.data.email))).sort((a,b)=>a.id.localeCompare(b.id));
    const bridges={};
    for(const value of emails){const bridge=await api.getDocFromServer(api.doc(api.db,'hq_email_access',value));sameOwner(api,actor);bridges[value]=bridge.exists()?bridge.data():null;}
    return {actor,id,target,next,rows,bridges,signature:signature({rows,bridges})};
}
export function planHQAccessChange(state,intent) {
    const type=intent.type,id=intent.id || state.id;
    if(!['sync','register','update','revoke'].includes(type))throw Error('Unknown account access action.');
    const existing=state.rows.find(row=>row.id===id),target=state.target;
    if(target===OWNER_EMAIL && type!=='sync' && (type!=='update' || Object.keys(intent.patch || {}).some(key=>!['fullName','phone','pin'].includes(key))))throw Error('The main Owner access record is protected.');
    if(type!=='register' && !existing && type!=='sync')throw Error('This account record no longer exists. Refresh access.');
    const before=group(state.rows,target),patch={...(intent.patch || {})};
    const allowed=['email','permissions','role','assignedBranch','active','blocked','status','fullName','phone','pin'];
    if(Object.keys(patch).some(key=>!allowed.includes(key)))throw Error('Unknown account profile field.');
    if(patch.permissions!==undefined)patch.permissions=configuredPermissions(patch);
    const nextEmail=emailOf(patch.email || intent.profile?.email || target);
    if(!validEmail(nextEmail) || nextEmail!==state.next)throw Error('The selected email changed. Reopen this account.');
    const nextRows=state.rows.map(row=>({id:row.id,data:{...row.data}})),changes=[];
    if(type==='register') {
        if(before.length || nextRows.some(row=>row.id===id) || group(nextRows,nextEmail).length)throw Error('This Google account is already registered. Refresh access.');
        if(!id || id.includes('/') || !intent.profile || emailOf(intent.profile.email)!==target)throw Error('Invalid account registration.');
        const data={...intent.profile,email:target,permissions:configuredPermissions(intent.profile)};
        changes.push({id,data,create:true});nextRows.push({id,data});
    } else if(type==='update') {
        if(nextEmail!==target && group(nextRows,nextEmail).length)throw Error('The new Google email already has access. Review its existing records first.');
        for(const row of nextRows.filter(row=>emailOf(row.data.email)===target)) {
            const common=Object.fromEntries(Object.entries(patch).filter(([key])=>!['fullName','phone'].includes(key)));
            common.email=nextEmail;
            const updates={...common,...(row.id===id?Object.fromEntries(Object.entries(patch).filter(([key])=>['fullName','phone'].includes(key))):{})};
            row.data={...row.data,...updates};changes.push({id:row.id,patch:updates});
        }
    } else if(type==='revoke') {
        if(before.length!==1)throw Error('This email has multiple records. Disable the whole account from its profile before removing any record.');
        changes.push({id,remove:true});nextRows.splice(nextRows.findIndex(row=>row.id===id),1);
    }
    if(['sync','update'].includes(type) && !group(nextRows,nextEmail).every(row=>inactive(row.data))) {
        const canonical=resolveHQAccount(group(nextRows,nextEmail));
        for(const row of nextRows.filter(row=>emailOf(row.data.email)===nextEmail)) {
            const patch={email:nextEmail,permissions:configuredPermissions(canonical),role:canonical.role || 'Manager',active:!inactive(canonical),blocked:canonical.blocked===true,status:canonical.status || (!inactive(canonical)?'Active':'Inactive')};
            if(canonical.assignedBranch!==undefined)patch.assignedBranch=canonical.assignedBranch;
            row.data={...row.data,...patch};const change=changes.find(change=>change.id===row.id);
            if(change)change.patch={...change.patch,...patch};else changes.push({id:row.id,patch});
        }
    }
    const bridges={};
    for(const value of [...new Set([target,nextEmail])]) {
        const rows=group(nextRows,value);
        // Revocation must be possible even if legacy duplicate PINs conflict.
        bridges[value]=rows.length && rows.every(row=>inactive(row.data))?{active:false,allowedBranches:[],permissions:[]}:protectedSavedAccess(rows);
    }
    return {type,id,target,next:nextEmail,intent,changes,bridges,expectedSignature:state.signature,expectedRows:state.rows,expectedBridges:state.bridges};
}
export async function saveHQAccessChange(api,plan,{operationId}={}) {
    const actor=verifiedAccessOwner(api);
    if(!operationId || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId))throw Error('Reopen this access change before saving.');
    if(plan.actor && plan.actor.uid!==actor.uid)throw Error('The Owner account changed. Reopen this access review.');
    const inputHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature({type:plan.type,id:plan.id,target:plan.target,next:plan.next,intent:plan.intent})))),value=>value.toString(16).padStart(2,'0')).join('');sameOwner(api,actor);
    const state=await readHQAccessState(api,{id:plan.id,email:plan.target,newEmail:plan.next});sameOwner(api,actor);
    const prior=state.bridges[plan.next];
    if(prior?.lastSyncOperationId===operationId) {
        if(prior.lastSyncInputHash!==inputHash || prior.updatedByUid!==actor.uid)throw Error('This access save reference belongs to another change. Reopen the account.');
        return {alreadySaved:true};
    }
    if(state.signature!==plan.expectedSignature)throw Error('The saved account or protected access changed after this review. Refresh before saving.');
    return api.runTransaction(api.db,async tx=>{
        sameOwner(api,actor);
        const ids=[...new Set([...state.rows.map(row=>row.id),...plan.changes.map(row=>row.id)])],rows=[];
        for(const id of ids){const row=await tx.get(api.doc(api.db,'hq_managers',id));sameOwner(api,actor);if(row.exists())rows.push({id,data:row.data()});}
        rows.sort((a,b)=>a.id.localeCompare(b.id));
        const bridges={};for(const value of Object.keys(plan.bridges)){const bridge=await tx.get(api.doc(api.db,'hq_email_access',value));sameOwner(api,actor);bridges[value]=bridge.exists()?bridge.data():null;}
        const previous=bridges[plan.next];
        if(previous?.lastSyncOperationId===operationId){if(previous.lastSyncInputHash!==inputHash || previous.updatedByUid!==actor.uid)throw Error('This save reference belongs to another access change.');return {alreadySaved:true};}
        if(signature({rows,bridges})!==plan.expectedSignature)throw Error('The saved account or protected access changed during this review. Refresh before saving.');
        // Recompute authority from the transaction's fresh documents before writing.
        const freshPlan=planHQAccessChange({...state,rows,bridges},plan.intent);sameOwner(api,actor);
        for(const change of freshPlan.changes) {
            const ref=api.doc(api.db,'hq_managers',change.id);
            if(change.remove)tx.delete(ref);
            else if(change.create)tx.set(ref,{...change.data,addedAt:api.serverTimestamp(),pinUpdatedAt:api.serverTimestamp(),profileUpdatedAt:api.serverTimestamp(),permissionsUpdatedAt:api.serverTimestamp()});
            else tx.update(ref,{...change.patch,...(change.patch.permissions!==undefined?{permissionsUpdatedAt:api.serverTimestamp()}:{}),...(change.id===plan.id && Object.keys(plan.intent.patch || {}).some(key=>['email','role','assignedBranch','active','blocked','status','fullName','phone'].includes(key))?{profileUpdatedAt:api.serverTimestamp()}:{}),...(change.patch.pin!==undefined?{pinUpdatedAt:api.serverTimestamp()}:{} )});
        }
        for(const [email,access]of Object.entries(freshPlan.bridges)) {
            const version=Number.isSafeInteger(bridges[email]?.accessVersion)?bridges[email].accessVersion:0;
            tx.set(api.doc(api.db,'hq_email_access',email),{...access,updatedAt:api.serverTimestamp(),updatedByUid:actor.uid,accessVersion:version+1,lastSyncOperationId:operationId,lastSyncInputHash:inputHash},{merge:true});
        }
        return {saved:true,bridges:freshPlan.bridges};
    });
}
export function accessOperation(api,plan) {
    api.hqAccessPending ||= new Map();const key=signature({intent:plan.intent,expectedSignature:plan.expectedSignature,actorUid:plan.actor?.uid});let id=api.hqAccessPending.get(key);
    if(!id){id='hq-access-'+crypto.randomUUID();api.hqAccessPending.set(key,id);}return id;
}
export function installHQAccessSync(api=window) {
    api.syncSavedHQAccess=async id=>{
        try {
            const state=await readHQAccessState(api,{id}),plan={...planHQAccessChange(state,{type:'sync',id}),actor:state.actor};
            const access=plan.bridges[state.target],operationId=accessOperation(api,plan);
            const answer=await api.Swal.fire({title:'Synchronize saved access?',html:`<p>${escaped(state.target)}</p><p>This copies the current saved Settings permissions to protected access. It does not add permissions. Duplicate records retain the same effective access; their email spelling is normalized for Google sign-in.</p><p><strong>${access.active?'Active':'Inactive'}</strong><br>Branches: ${escaped(access.allowedBranches.join(', ') || 'None')}<br>Permissions: ${escaped(access.permissions.join(', ') || 'None')}<br>${state.rows.length} saved record(s)</p>`,showCancelButton:true,confirmButtonText:'Sync saved access',showLoaderOnConfirm:true,allowOutsideClick:()=>!api.Swal.isLoading(),preConfirm:async()=>{try{return await saveHQAccessChange(api,plan,{operationId});}catch(error){api.Swal.showValidationMessage(error.message);return false;}}});
            if(answer.isConfirmed){await api.loadAdminDashboard?.();return true;}return false;
        }catch(error){api.ManagerUI?.notify?.(error.message);return false;}
    };
    api.removeHqManager=async id=>{
        try{const state=await readHQAccessState(api,{id}),plan={...planHQAccessChange(state,{type:'revoke',id}),actor:state.actor};
            if(!await api.ManagerUI.confirm(`Revoke access for ${state.target}? Its protected access will be disabled in the same save.`))return;
            await saveHQAccessChange(api,plan,{operationId:accessOperation(api,plan)});await api.loadAdminDashboard?.();
        }catch(error){api.ManagerUI?.notify?.(error.message);}
    };
    if(api.TKCashierStatus)api.TKCashierStatus.grantMonitorAccess=id=>api.syncSavedHQAccess(id);
}
