import {createStaffAccessClient} from './staff-access.js';

const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const changed=()=>Error('Your Staff account changed. Reopen Time Clock before uploading.');

// Backport only verified screenshot uploads. The stable login and clock readers
// do not depend on the unactivated staff_directory Firestore rules.
export function createClockUploadAccess({auth,deviceId,Swal,fetcher=globalThis.fetch,storage=globalThis.localStorage,crypto=globalThis.crypto,makeClient=createStaffAccessClient}={}){
 let sessionId=null,busy=false;
 const client=makeClient({auth,deviceId,storage,fetcher,sessionId:()=>sessionId,
  ensureUser:async({guard=()=>{}}={})=>{await auth.authStateReady();guard();return auth.currentUser;},
  makeSessionId:()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),value=>value.toString(16).padStart(2,'0')).join('')});
 return async({staffId,attendanceId,assertCurrent=()=>{}}={})=>{
  if(busy)throw Error('The previous screenshot check is still finishing. Please wait.');
  if(!validId(staffId)||!validId(attendanceId))throw Error('Reopen Time Clock before attaching the screenshot.');
  busy=true;
  try{
   await auth.authStateReady();assertCurrent();
   const user=auth.currentUser,selectedDevice=deviceId();
   if(!user?.isAnonymous||!validId(user.uid))throw Error('Reconnect and sign in to the Staff app before attaching your screenshot.');
   const current=()=>{assertCurrent();if(auth.currentUser!==user||deviceId()!==selectedDevice)throw changed();};current();
   const answer=await Swal.fire({title:'Confirm your Staff PIN',text:'Verify your account to attach this screenshot securely. Your attendance has not been saved yet.',input:'password',inputAttributes:{inputmode:'numeric',autocomplete:'off'},showCancelButton:true,confirmButtonText:'Verify PIN',cancelButtonText:'Back',allowOutsideClick:false,inputValidator:value=>/^\d{4,10}$/.test(String(value||'').trim())?undefined:'Enter your Staff account PIN.'});current();
   if(!answer?.isConfirmed)return null;
   const pin=String(answer.value||'').trim();if(!/^\d{4,10}$/.test(pin))throw Error('Enter your Staff account PIN.');
   Swal.fire({title:'Securing your screenshot…',text:'Confirming your account with HQ.',allowOutsideClick:false,allowEscapeKey:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});
   const verified=await client.login({pin,selectedStaffId:staffId,assertCurrent:current});current();
   if(verified.staffId!==staffId||!validId(verified.sessionId)||verified.sessionId.length<16)throw changed();
   sessionId=verified.sessionId;const issuedSession=sessionId;
   return {path:`staff_requests/${user.uid}/${staffId}/late_${attendanceId}.jpg`,metadata:{contentType:'image/jpeg',customMetadata:{staffUploadUid:user.uid,staffId}},assertCurrent:()=>{current();if(sessionId!==issuedSession)throw changed();}};
  }finally{busy=false;}
 };
}
