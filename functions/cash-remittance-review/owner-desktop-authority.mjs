import {ACCESS_OWNER,accessId,accessDevice,accessDocumentId,isAccessOwner} from './access-model.mjs';
import {activeStaffProfile} from './relief-core/staff-lifecycle-model.js';

export class OwnerDesktopAuthorityError extends Error{
 constructor(){super('Use the already signed-in verified Owner account on its active Main Office desktop and choose an active branch. Existing tablet registrations are unchanged.');this.name='OwnerDesktopAuthorityError';this.status=403;this.code='owner-desktop/approval-required';}
}
const deny=()=>{throw new OwnerDesktopAuthorityError();};
const active=row=>row&&activeStaffProfile(row)&&!['closed','inactive','disabled','blocked','revoked','archived','deleted'].includes(String(row.status||'').trim().toLowerCase());
const validBranch=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=120&&!/^all$/i.test(value)&&!/[\u0000-\u001f\u007f]/.test(value);
// All readers MUST use the caller's current Admin transaction. This returns
// audit context only, never a reusable permission token or new device grant.
export async function freshOwnerDesktopAuthority({actor,deviceId,branch,owners,devices,branches}={}){
 if(!isAccessOwner(actor)||!accessId(actor.uid)||!accessDevice(deviceId)||!validBranch(branch)||![owners,devices,branches].every(value=>typeof value==='function'))deny();
 const [ownerRows,deviceRows,branchRows]=await Promise.all([owners(),devices(),branches()]);
 if(!Array.isArray(ownerRows)||ownerRows.length!==1||!Array.isArray(deviceRows)||deviceRows.length>2||!Array.isArray(branchRows)||branchRows.length!==1)deny();
 const owner=ownerRows[0];
 if(!owner||String(owner.email||'').trim().toLowerCase()!==ACCESS_OWNER||owner.uid!=null&&owner.uid!==''&&owner.uid!==actor.uid||!active(owner)||/franchise/i.test(String(owner.role||''))||[owner.pin,owner.securityPin].some(value=>/^(REVOKED|BLOCKED)$/i.test(String(value??'').trim())))deny();
 const registered=deviceRows.filter(row=>row?.status==='Active');if(registered.length!==1)deny();const device=registered[0],target=branchRows[0];
 if(!accessDocumentId(device.id)||device.deviceId!==deviceId||device.branch!=='Main Office'||!active(device)||String(device.appType||'').trim().toLowerCase()==='staff'||device.setupVersion===1||device.setupUid||target?.name!==branch||!active(target))deny();
 return {schemaVersion:1,mode:'owner-desktop',ownerUid:actor.uid,registrationId:device.id,registrationBranch:'Main Office',workingBranch:branch};
}
export function ownerDesktopSessionMatches(session,authority){
 const saved=session?.ownerDesktopAuthority;
 return Boolean(saved&&Object.keys(saved).length===6&&saved.schemaVersion===1&&saved.mode==='owner-desktop'&&saved.ownerUid===authority.ownerUid&&saved.registrationId===authority.registrationId&&saved.registrationBranch==='Main Office'&&saved.workingBranch===authority.workingBranch);
}
