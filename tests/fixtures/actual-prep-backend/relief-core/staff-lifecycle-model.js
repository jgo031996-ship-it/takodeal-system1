// Presentation and selection only: no record, balance or dated assignment is deleted.
const text=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const nameKey=value=>text(value).normalize('NFKC').toLocaleLowerCase('en');
const former=new Set(['resigned','terminated','inactive','disabled','revoked','archived','blocked','deleted','offboarded','offboard','finished contract','contract ended','end of contract']);
const id=value=>typeof value==='string'&&value.length>0&&!['.','..'].includes(value)&&!/[\/\0]/.test(value)?value:'';
const profileId=profile=>id(profile?.staffId)||id(profile?.id);
const aliases=profile=>[profile?.cashierName,profile?.fullName,profile?.name,profile?.scheduleNickname,profile?.scheduleName,profile?.nickname,...(Array.isArray(profile?.scheduleAliases)?profile.scheduleAliases:[])].map(nameKey).filter(Boolean);

export function staffLifecycleState(profile){
 if(!profile||typeof profile!=='object'||Array.isArray(profile))return {active:false,missing:true,status:'Missing profile',reason:'The saved employee profile is unavailable. Keep its records in identity review.'};
 const statuses=[profile.status,profile.employmentStatus].map(text),inactiveStatus=statuses.find(value=>former.has(value.toLowerCase()));
 const terminalContract=['resigned','terminated','revoked','offboarded'].includes(text(profile.contractStatus).toLowerCase());
 const inactive=profile.active===false||profile.isActive===false||['archived','isArchived','deleted','isDeleted','blocked','revoked','offboarded','resigned','terminated','disabled'].some(field=>profile[field]===true)||!!inactiveStatus||terminalContract||['REVOKED','BLOCKED'].includes(text(profile.pin).toUpperCase());
 return {active:!inactive,missing:false,status:inactiveStatus||statuses.find(Boolean)||(inactive?'Archived / inactive':'Active'),reason:inactive?'Former, archived or inactive employee. Earlier records remain available.':''};
}
export const activeStaffProfile=profile=>staffLifecycleState(profile).active;

// IDs remain authoritative. Legacy aliases bind only when exactly one saved
// account owns the name; never guess a typo or prefix, or override a missing ID.
export function createStaffHistoryResolver(profiles=[]){
 const list=Array.isArray(profiles)?profiles:[],byId=new Map(),byName=new Map();
 const add=(map,key,value)=>{if(!key)return;const values=map.get(key)||[];values.push(value);map.set(key,values);};
 for(const profile of list){if(!profile||typeof profile!=='object')continue;add(byId,profileId(profile),profile);for(const key of new Set(aliases(profile)))add(byName,key,profile);}
 return function resolve(record={}){
  const raw=typeof record==='string'?{staffName:record}:record||{},rawId=raw.staffId,reference=id(rawId),name=text(raw.staffName)||text(raw.name)||text(raw.cashierName),branch=text(raw.branch);
  const review=(reason,status='identity-review')=>({status,active:false,profile:null,staffId:reference,name,branch,reason});
  if(rawId!==undefined&&rawId!==null&&rawId!==''&&!reference)return review('This record has an invalid employee ID.');
  const named=byName.get(nameKey(name))||[],candidates=reference?(byId.get(reference)||[]):named;
  if(candidates.length!==1)return review(reference&&!candidates.length?'The saved employee ID no longer has a profile.':candidates.length?'More than one employee owns this saved name or ID.':'No saved employee matches this exact name or saved alias.');
  const profile=candidates[0],staffId=profileId(profile);
  if(!staffId||![profile.cashierName,profile.fullName,profile.name].some(value=>text(value)))return review('The employee profile is missing its stable account ID or saved name.');
  if(reference&&named.length&&!named.includes(profile))return review('The saved employee ID and name point to different accounts.');
  if(!reference&&branch&&text(profile.branch)&&branch!==text(profile.branch))return review('This name-only record belongs to a different recorded branch. Confirm its employee.');
  const state=staffLifecycleState(profile);
  return {status:state.active?'active':'archived',active:state.active,profile,staffId,name:name||text(profile.cashierName)||text(profile.fullName)||text(profile.name),branch:branch||text(profile.branch),reason:state.reason};
 };
}

export function staffHistoryView(rows,profiles,{view='active'}={}){
 const resolve=createStaffHistoryResolver(profiles);
 return (Array.isArray(rows)?rows:[]).map(row=>({row,identity:resolve(row)})).filter(entry=>view==='all'?true:view==='archived'?!entry.identity.active:entry.identity.active);
}
