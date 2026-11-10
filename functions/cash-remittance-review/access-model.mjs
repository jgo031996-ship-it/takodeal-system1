import {activeStaffProfile} from './relief-core/staff-lifecycle-model.js';
export const ACCESS_OWNER='jgo031996@gmail.com';
export const OPERATIONAL_STAFF_FIELDS=Object.freeze(['cashierName','name','fullName','branch','role','scheduleNickname','scheduleName','nickname','scheduleAliases','active','isActive','status','archived','isArchived','blocked','isDeleted','deleted','revoked','offboarded','resigned','terminated','disabled','employmentStatus','contractStatus']);
export const STAFF_PIN_PURPOSES=Object.freeze(['time-clock','meal','purchase','leave','early-time-out','receipt-void']);
export const accessId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export const accessDocumentId=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=1500&&!/^\.+$/.test(value)&&!/[\/\u0000-\u001f\u007f]/.test(value);
export const accessDevice=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
export const accessText=value=>typeof value==='string'?value.trim():'';
export function activeAccessStaff(profile){
 if(!profile||typeof profile!=='object'||!accessText(profile.cashierName)||!accessText(profile.branch))return false;
 return activeStaffProfile(profile);
}
export function operationalStaffProfile(staffId,profile,{requireActive=true}={}){
 if(!accessId(staffId)||!profile||typeof profile!=='object'||Array.isArray(profile)||requireActive&&!activeAccessStaff(profile))throw Error('This employee account is inactive or needs HQ review.');
 const result={staffId};
 for(const field of OPERATIONAL_STAFF_FIELDS){
  const value=profile[field];if(value===undefined)continue;
  if(field==='scheduleAliases'){if(!Array.isArray(value)||value.length>10||value.some(item=>typeof item!=='string'||item.length>160))throw Error('The staff schedule aliases need HQ review.');result[field]=[...value];}
  else if(typeof value==='boolean')result[field]=value;
  else if(typeof value==='string'&&value.length<=200)result[field]=value;
  else if(value!==null)throw Error('The staff operational record needs HQ review.');
 }
 if(typeof profile.cashierName!=='string'||!profile.cashierName.trim()||profile.cashierName.length>200||typeof profile.branch!=='string'||profile.branch.length>120)throw Error('The staff operational identity needs HQ review.');
 result.cashierName=profile.cashierName;result.branch=profile.branch;return result;
}
export function isAccessOwner(actor){return actor?.email_verified===true&&actor?.firebase?.sign_in_provider==='google.com'&&String(actor.email||'').toLowerCase()===ACCESS_OWNER;}
