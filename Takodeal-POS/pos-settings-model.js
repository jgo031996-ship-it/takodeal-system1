// Settings permissions are read from saved HQ grants, never from a cashier's role label.
import {eligibleCancelledFoodBuyer} from './cancelled-orders.js';
import {savedPin} from './hq-account-model.js';
export const POS_SETTINGS_POLICY_ID = 'pos_settings_global';
export const POS_SETTINGS_ACTIONS = ['audit','kds','autoDrawer','manualDrawer'];
export const POS_SETTINGS_DEFAULTS = Object.freeze({version:1,staff:{parkedOrders:true,printerTools:true,manualDrawer:false},manager:{audit:true,kds:true,autoDrawer:true,manualDrawer:true}});
const text = value => String(value || '').trim();
const list = value => [...new Set((Array.isArray(value)?value:text(value).split(',')).map(text).filter(Boolean))];
export function posSettingsPolicy(value) {
    if(value==null)return structuredClone(POS_SETTINGS_DEFAULTS);
    if(!value || typeof value!=='object' || Array.isArray(value) || value.version!==1)throw Error('The saved POS access policy needs Owner review.');
    const result={version:1,staff:{},manager:{}};
    for(const group of ['staff','manager'])for(const key of Object.keys(POS_SETTINGS_DEFAULTS[group])) {
        if(typeof value[group]?.[key]!=='boolean')throw Error('Choose a valid permission for every POS tool.');
        result[group][key]=value[group][key];
    }
    return result;
}
export function hqPOSAccess(user,profile,grant,branch) {
    const email=text(user?.email).toLowerCase();
    if(!user?.uid || !email || user.emailVerified!==true || text(profile?.email).toLowerCase()!==email
        || profile.active===false || profile.archived===true || /blocked|disabled|inactive|revoked|terminated|archived|resigned|deleted/i.test(text(profile.status))
        || ['REVOKED','BLOCKED'].includes(savedPin(profile).toUpperCase()))return null;
    const role=text(profile.role).toLowerCase();
    const permissions=list(profile.permissions).map(value=>value.toLowerCase());
    if(email==='jgo031996@gmail.com')return {kind:'owner',email,uid:user.uid,branch,permissions};
    if(!['manager','appointed manager','co-owner','co owner','co_owner','owner','franchisee','franchise owner'].includes(role))return null;
    const assigned=list(profile.assignedBranch),allowed=list(grant?.allowedBranches);
    if(!branch || grant?.active!==true || !(allowed.includes('All')||allowed.includes(branch))
        || !(assigned.includes('All')||assigned.includes(branch)))return null;
    const protectedPermissions=list(grant.permissions).map(value=>value.toLowerCase());
    const effective=permissions.includes('all')?protectedPermissions:protectedPermissions.includes('all')?permissions:permissions.filter(key=>protectedPermissions.includes(key));
    if(!effective.length)return null;
    return {kind:'manager',email,uid:user.uid,branch,permissions:effective};
}
const grants={audit:['inventory','audits'],kds:['posconfig'],autoDrawer:['posconfig'],manualDrawer:['posconfig']};
export function canUsePOSSetting(action,{policy=POS_SETTINGS_DEFAULTS,staff=null,hq=null}={}) {
    policy=posSettingsPolicy(policy);
    if(hq?.kind==='owner')return true;
    if(['parkedOrders','printerTools'].includes(action))return !!staff&&policy.staff[action]===true;
    if(action==='manualDrawer' && staff && policy.staff.manualDrawer)return true;
    return hq?.kind==='manager' && policy.manager[action]===true
        && (hq.permissions.includes('all') || (grants[action]||[]).some(key=>hq.permissions.includes(key)));
}
export function activePOSStaff(profile,session) {
    if(!session || !eligibleCancelledFoodBuyer(profile) || profile.cashierName!==session.cashierName
        || !savedPin(profile).trim() || ['BLOCKED','REVOKED'].includes(savedPin(profile).trim().toUpperCase()))return null;
    if(session.staffId && profile.staffId!==session.staffId)return null;
    return {staffId:profile.staffId,name:profile.cashierName};
}
export function settingsApprovalFingerprint(profile) {
    return JSON.stringify([profile.docId,profile.email,profile.role,profile.active,profile.status,profile.permissions,profile.assignedBranch,
        profile.pinUpdatedAt?.toMillis?.() ?? profile.pinUpdatedAt?.seconds ?? profile.pinUpdatedAt ?? '',profile.profileUpdatedAt?.toMillis?.() ?? profile.profileUpdatedAt?.seconds ?? '']);
}
