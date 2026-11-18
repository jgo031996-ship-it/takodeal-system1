import {createStaffAccessClient} from './staff-access.js';

const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validLegacyPin=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=100;
const changed=()=>Error('Your Staff account changed. Reopen Time Clock before uploading.');

// Backport only verified screenshot uploads. The stable login and clock readers
// do not depend on the unactivated staff_directory Firestore rules.
export function createClockUploadAccess({auth,deviceId,Swal,authority=()=>globalThis.window?.staffSetupAccess,fetcher=globalThis.fetch,storage=globalThis.localStorage,crypto=globalThis.crypto,makeClient=createStaffAccessClient}={}){
 let sessionId=null,busy=false,generation=0;
 const client=makeClient({auth,deviceId,storage,fetcher,sessionId:()=>sessionId,
  ensureUser:async({guard=()=>{}}={})=>{await auth.authStateReady();guard();return auth.currentUser;},
  makeSessionId:()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),value=>value.toString(16).padStart(2,'0')).join('')});
 return async({staffId,attendanceId,assertCurrent=()=>{}}={})=>{
  if(busy)throw Error('The previous screenshot check is still finishing. Please wait.');
  if(!validId(staffId)||!validId(attendanceId))throw Error('Reopen Time Clock before attaching the screenshot.');
  busy=true;const attempt=++generation;
  try{
   await auth.authStateReady();assertCurrent();
   const user=auth.currentUser,selectedDevice=deviceId();
   if(!user?.isAnonymous||!validId(user.uid))throw Error('Reconnect and sign in to the Staff app before attaching your screenshot.');
   const current=()=>{assertCurrent();if(attempt!==generation||auth.currentUser!==user||deviceId()!==selectedDevice)throw changed();};current();
   const setup=authority();
   if(!setup||typeof setup.confirm!=='function'||typeof setup.capture!=='function'||typeof setup.assert!=='function'||typeof setup.binding!=='function')throw Error('Phone setup is still connecting. Reconnect and reopen Time Clock.');
   const status=await setup.confirm(selectedDevice);current();
   if(status?.mode==='protected'){
    const snapshot=setup.capture(),binding=setup.binding();setup.assert(snapshot,staffId);current();
    if(status.device?.status!=='Active'||status.device.staffId!==staffId||status.device.deviceId!==selectedDevice||binding?.status!=='Active'||binding.staffId!==staffId||binding.deviceId!==selectedDevice||typeof binding.branch!=='string'||!binding.branch.trim())throw Error('This phone is not activated for your Staff account. Use your personal setup code or ask the Owner to check this phone.');
    const activatedCurrent=()=>{current();setup.assert(snapshot,staffId);const fresh=setup.binding();if(fresh?.status!=='Active'||fresh.staffId!==staffId||fresh.deviceId!==selectedDevice||fresh.branch!==binding.branch)throw changed();};
    return {path:`staff_requests/${user.uid}/${staffId}/activated_late_${attendanceId}.jpg`,metadata:{contentType:'image/jpeg',customMetadata:{staffUploadUid:user.uid,staffId,staffUploadDeviceId:selectedDevice,staffUploadAuthority:'phone-activation'}},assertCurrent:activatedCurrent};
   }
   if(status?.mode!=='legacy'||status.enabled!==false)throw Error('This phone’s activation could not be confirmed. Reconnect and check the Staff app again.');
   const answer=await Swal.fire({title:'Confirm your Staff PIN',text:'Verify your account to attach this screenshot securely. Your attendance has not been saved yet.',input:'password',inputAttributes:{autocomplete:'off',autocapitalize:'none',spellcheck:'false'},showCancelButton:true,confirmButtonText:'Verify PIN',cancelButtonText:'Back',allowOutsideClick:false,inputValidator:value=>validLegacyPin(value)?undefined:'Enter your existing Staff account PIN (1–100 characters).'});current();
   if(!answer?.isConfirmed)return null;
   if(!validLegacyPin(answer.value))throw Error('Enter your existing Staff account PIN (1–100 characters).');const pin=answer.value.trim();
   Swal.fire({title:'Securing your screenshot…',text:'Confirming your account with HQ.',allowOutsideClick:false,allowEscapeKey:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});
   const verified=await client.login({pin,selectedStaffId:staffId,assertCurrent:current});current();
   if(verified.staffId!==staffId||!validId(verified.sessionId)||verified.sessionId.length<16)throw changed();
   sessionId=verified.sessionId;const issuedSession=sessionId;
   return {path:`staff_requests/${user.uid}/${staffId}/late_${attendanceId}.jpg`,metadata:{contentType:'image/jpeg',customMetadata:{staffUploadUid:user.uid,staffId}},assertCurrent:()=>{current();if(sessionId!==issuedSession)throw changed();}};
  }finally{busy=false;}
 };
}
