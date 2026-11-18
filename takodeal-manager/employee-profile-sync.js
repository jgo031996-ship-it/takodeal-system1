import {staffDirectoryActorKey} from './staff-directory-reader.js';
import {OWNER_EMAIL} from './workspace-access-model.js';

const inputs={
 cashierName:'empFullName',scheduleNickname:'empScheduleName',
 phone:'empPhone',address:'empAddress',email:'empEmail',emergencyName:'empEmergencyName',
 emergencyPhone:'empEmergencyPhone',gcashName:'empGcashName',gcashNum:'empGcashNum',
 gotymeName:'empGotymeName',gotymeNum:'empGotymeNum',sss:'empSSS',philhealth:'empPhilhealth',pagibig:'empPagibig'
};
const aliases={emergencyPhone:['emergencyNumber','emergencyContactNumber','emergNum','emergencyContact'],
 gcashNum:['gcashNumber'],gotymeNum:['gotymeNumber','goTymeNumber','gotymeAcc','gotymeAccount','goTymeAccount','gotymeAccountNumber'],
 gotymeName:['goTymeName','gotyme'],sss:['sssNumber'],philhealth:['philhealthNumber'],pagibig:['pagibigNumber']};
function value(row,key){
 for(const k of [key,...(aliases[key]||[])])if(row?.[k]!=null)return String(row[k]).trim();
 return '';
}
export function sharedProfileValues(row){
 return Object.fromEntries(Object.keys(inputs).map(k=>[k,value(row,k)]));
}
export function protectStaffEdits(payload,baseline,live){
 if(!baseline||!live)return payload;
 const update={...payload};
 for(const key of Object.keys(inputs)){
  if(!Object.hasOwn(update,key))continue;
  const wanted=String(update[key]??'').trim(),latest=value(live,key);
  if(wanted===baseline[key]||wanted===latest)delete update[key];
  else if(latest!==baseline[key])throw Error('This employee changed a field you also edited. Reopen the profile to see the saved value.');
 }
 return update;
}
export function watchEmployeeProfile(api,d,id){
 api.stopEmployeeProfileSync?.();
 const row=api.globalStaffData?.[id],baseline=api.staffProfileBaseline;
 if(!row||baseline?.id!==id||typeof api.onSnapshot!=='function')return;
 const el=key=>d.getElementById(key),modal=el('employeeProfileModal'),session=api.sessionUser;
 let actor;try{actor=staffDirectoryActorKey(api,'branches');}catch{return;}
 const allowed=branch=>api.auth.currentUser?.email?.toLowerCase()===OWNER_EMAIL||session.allowedBranches?.includes('All')||session.allowedBranches?.includes(branch);
 if(!allowed(row.branch))return;
 const fields=sharedProfileValues(row);baseline.shared=fields;baseline.pinVersion=row.loginPinVersion??0;
 const pin=el('empPin');
 const showPinStatus=profile=>{if(pin)pin.placeholder=profile.pin?'••••  PIN saved':'Enter a daily PIN';};
 if(pin)pin.type='password';
 showPinStatus(row);
 const status=el('employeeLiveProfileStatus');
 const message=text=>{if(status)status.textContent=text;};
 for(const [key,input] of Object.entries(inputs))if(el(input))el(input).value=fields[key];
 let inactive=false,unsub,observer,displayedPhoto=row.profilePicUrl||'';
 message('Checking for profile updates…');
 const current=()=>!inactive&&!d.hidden&&api.staffProfileBaseline===baseline&&el('empProfileId')?.value===id&&modal?.style.display!=='none';
 const stop=()=>{inactive=true;unsub?.();observer?.disconnect();d.removeEventListener?.('visibilitychange',visibility);api.removeEventListener?.('pagehide',stop);};
 const visibility=()=>{if(d.hidden){unsub?.();unsub=null;}else if(current()&&!unsub)subscribe();};
 function subscribe(){
  unsub=api.onSnapshot(api.doc(api.db,'cashiers',id),{includeMetadataChanges:true},snap=>{
   if(!current())return;
   let authorized=false;try{authorized=actor===staffDirectoryActorKey(api,'branches');}catch{}
   if(!authorized||!snap.exists()||!allowed(snap.data().branch)){stop();modal.style.display='none';return;}
   if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||api.staffProfileSaveOwner)return;
   const next=snap.data();let overlap=false;
   for(const [key,input] of Object.entries(inputs)){
    const node=el(input),latest=value(next,key);
    if(!node)continue;
    if(node.value.trim()===fields[key]||node.value.trim()===latest){node.value=latest;fields[key]=latest;}
    else if(latest!==fields[key])overlap=true;
   }
   showPinStatus(next);
   if(!pin?.value)baseline.pinVersion=next.loginPinVersion??0;
   const photo=el('masterProfilePic');
   const nextPhoto=next.profilePicUrl||'';
   if(photo&&nextPhoto!==displayedPhoto&&!el('profileImageInput')?.files?.length){
    try{if(!api.ownerEmployeePhoto?.capture?.()?.profilePicUrl){photo.src=nextPhoto||photo.dataset?.defaultAvatar||'';displayedPhoto=nextPhoto;}}catch{}
   }
   message(overlap?'A field you are editing also changed in Staff. Reopen the profile to review it.':
    'Synced with Staff · Daily PIN '+(next.pin?'set':'not set')+' · Vault PIN '+(next.payslipPin||next.payslipPinManaged?'set':'not set'));
  },error=>{
   if(!current())return;
   if(error?.code==='permission-denied'||error?.code==='unauthenticated'){stop();modal.style.display='none';return;}
   message('Profile sync interrupted. Reopen this employee when connected.');
  });
 }
 if(typeof MutationObserver==='function'&&modal){
  observer=new MutationObserver(()=>{if(modal.style.display==='none'||api.staffProfileBaseline!==baseline)stop();});
  observer.observe(modal,{attributes:true,attributeFilter:['style']});
 }
 api.stopEmployeeProfileSync=stop;d.addEventListener?.('visibilitychange',visibility);api.addEventListener?.('pagehide',stop);subscribe();
}
