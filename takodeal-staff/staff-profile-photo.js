import {prepareEmployeePhoto} from './profile-photo-prepare.js';

export function showStaffProfilePhoto(api,d,value){
 if(typeof value!=='string'||!value)return;
 const preview=d.getElementById('profilePreview'),placeholder=d.getElementById('profilePlaceholder'),avatar=d.getElementById('topAvatar');
 api.localStorage.setItem('takodeal_staff_pic',value);
 if(preview){preview.src=value;preview.style.display='block';}
 if(placeholder)placeholder.style.display='none';
 if(avatar){avatar.textContent='';avatar.style.backgroundImage='url('+JSON.stringify(value)+')';}
}
export function installStaffProfilePhoto(api,d,{client,prepare=file=>prepareEmployeePhoto(file,{document:d}),uuid=()=>crypto.randomUUID()}={}){
 let flight=null,pending=null;
 const identity=()=>api.localStorage.getItem('takodeal_staff_id'),device=()=>api.localStorage.getItem('takodeal_device_id');
 const status=message=>{const node=d.getElementById('staffProfileStatus');if(node)node.textContent=message;};
 api.previewProfileImage=event=>{
  const file=event?.target?.files?.[0];if(!file)return Promise.resolve(false);if(flight)return flight;
  const staffId=identity(),deviceId=device(),account=api.auth?.currentUser;
  const guard=()=>{if(!staffId||identity()!==staffId||device()!==deviceId||api.auth?.currentUser!==account||d.hidden||d.getElementById('profileModal')?.style.display==='none')throw Error('Reopen your own profile and choose the photo again.');};
  const save=async()=>{
   try{
    guard();status('Preparing your profile photo…');
    const photo=await prepare(file);guard();
    // Keep the same intent after a lost response. A different selection starts a new save.
    if(!pending||pending.staffId!==staffId||pending.deviceId!==deviceId||pending.profilePicUrl!==photo){
     const before=await client.read(staffId,{assertCurrent:guard});guard();
     pending={staffId,deviceId,profilePicUrl:photo,expectedFingerprint:before.expectedFingerprint,operationId:uuid()};
    }
    const input=pending;status('Saving your profile photo…');
    await client.photo(input,{assertCurrent:guard});guard();pending=null;
    const fresh=await client.read(staffId,{assertCurrent:guard});guard();
    if(!fresh.profile.profilePicUrl)throw Error('The photo was saved, but could not be reloaded. Reopen your profile to check it.');
    showStaffProfilePhoto(api,d,fresh.profile.profilePicUrl);
    await api.staffPrivateProfileUI?.refreshHead();guard();
    status('Profile photo saved. It is also available in your Owner employee profile.');
    return true;
   }catch(error){
    try{guard();if(error.code==='private-profile/changedProfile')pending=null;status(error.message||'The photo could not be saved. Choose it again to retry.');}catch{}
    return false;
   }finally{if(event?.target)event.target.value='';}
  };
  flight=save().finally(()=>{flight=null;});return flight;
 };
 // Disable the superseded direct Storage uploader; all picker events use the verified route.
 api.uploadProfilePicture=()=>api.previewProfileImage({target:d.getElementById('profileImageInput')});
 return {get busy(){return Boolean(flight);}};
}
