import {createStaffSetupTransport,normalizeSetupCode,freshSetupId} from './staff-setup-access.js';
import {resolvePrivatePhoneIdentity} from './private-phone-identity.js';
export const SELF_SERVICE_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/staff-self-service';
export function createPersonalPhonePreparation({auth,ensureUser,identity,storage,authority,createPrivateClient,prompt,reload,transport=createStaffSetupTransport({auth,ensureUser}),uuid=()=>freshSetupId()}={}){
 const key='takodeal_profile_activation_v1';let flight=null,pending=null;
 return function prepare({assertCurrent=()=>{}}={}){
  if(flight)return flight;
  const action=(async()=>{
   const user=await ensureUser(),staffId=identity();
   const guard=()=>{assertCurrent();if(auth.currentUser!==user||identity()!==staffId)throw Error('Your employee account changed. Reopen your profile.');};guard();
   if(!staffId)throw Error('Sign in with your daily Staff PIN first.');
   let draft;try{draft=JSON.parse(storage.getItem(key)||'null');}catch{draft=null;}
   if(draft&&(draft.uid!==user.uid||draft.staffId!==staffId))draft=null;
   const deviceId=draft?.deviceId||storage.getItem('takodeal_device_id'),status=await transport.call('/device-status',{deviceId});guard();
   if(status.mode==='protected'&&status.device?.status==='Active'){
    if(status.device.staffId!==staffId)throw Error('This personal phone belongs to another employee. Sign in to its assigned account.');
    if(draft){storage.setItem('takodeal_device_id',draft.deviceId);storage.removeItem(key);authority()?.invalidate?.();reload();throw Error('Phone activated. Opening your saved profile.');}
    return true;
   }
   if(status.mode==='protected'&&status.device)throw Error('This phone registration is blocked. Use your active personal phone.');
   // Preserve an already verified private-document identity on older phones.
   try{const client=await createPrivateClient();guard();await resolvePrivatePhoneIdentity({client,staffId,assertCurrent:guard});return true;}catch{guard();}
   if(!pending||pending.uid!==user.uid||pending.staffId!==staffId){
    const entered=await prompt();guard();if(!entered)throw Error('Activate this phone once with your personal setup code to edit your private profile. No separate HQ approval is needed.');
    const code=normalizeSetupCode(entered);
    draft??={uid:user.uid,staffId,deviceId:'DEV-'+uuid().toUpperCase(),operationId:uuid()};
    storage.setItem(key,JSON.stringify(draft));pending={...draft,code,deviceName:'Personal phone'};
   }
   const {uid,...input}=pending;let result;try{result=await transport.call('/activate',input);}catch(error){if([400,403].includes(error.status))pending=null;throw error;}guard();
   if(result.mode!=='protected'||result.device?.status!=='Active'||result.device.staffId!==staffId||result.device.deviceId!==pending.deviceId)throw Error('The personal phone activation could not be confirmed. Retry this step.');
   storage.setItem('takodeal_device_id',pending.deviceId);storage.removeItem(key);pending=null;authority()?.invalidate?.();reload();throw Error('Phone activated. Opening your saved profile.');
  })();flight=action;action.finally(()=>{if(flight===action)flight=null;}).catch(()=>{});return action;
 };
}
export function createStaffSelfService({auth,ensureUser,identity,deviceId,prompt,fetcher=fetch}={}){
 let confirmation=null;
 async function call(action,body,{assertCurrent=()=>{}}={}){
  const user=await ensureUser();assertCurrent();const token=await user.getIdToken();assertCurrent();if(auth.currentUser!==user)throw Error('Your account changed. Reopen this form.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{const response=await fetcher(SELF_SERVICE_ENDPOINT+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});assertCurrent();if(auth.currentUser!==user)throw Error('Your account changed. Reopen this form.');const result=await response.json();if(!response.ok)throw Object.assign(Error(result.message||'Reconnect and retry the same submission.'),{status:response.status,code:result.code});return result;}catch(error){if(error.name==='AbortError')throw Error('The server has not confirmed this action yet. Keep this form open and retry the same submission.');throw error;}finally{clearTimeout(timer);}
 }
 async function confirm({assertCurrent=()=>{},interactive=false}={}){
  const staffId=identity(),selectedDevice=deviceId(),user=auth.currentUser;
  const guard=()=>{assertCurrent();if(identity()!==staffId||deviceId()!==selectedDevice||auth.currentUser!==user)throw Error('Your Staff account changed. Reopen your profile.');};
  try{return await call('status',{staffId,deviceId:selectedDevice},{assertCurrent:guard});}
  catch(error){guard();if(!interactive||error.status!==403)throw error;if(!confirmation)confirmation=(async()=>{const pin=await prompt();guard();if(!pin)throw Error('Enter your daily Staff PIN to load your saved details.');return call('login',{staffId,deviceId:selectedDevice,pin},{assertCurrent:guard});})();try{return await confirmation;}finally{confirmation=null;}}
 }
 return{call,confirm,login:(staffId,pin)=>call('login',{staffId,deviceId:deviceId(),pin}),logout:()=>call('logout',{staffId:identity(),deviceId:deviceId()})};
}
export function createDailyPinRecoveryClient({profile,identity,uuid=()=>crypto.randomUUID()}={}){
 let state=null,attempt=null;
 return{
  invalidate(){state=null;attempt=null;},
  async status(options){const staffId=identity();state=await profile.vaultSettings(staffId,options);return{configured:state.verifier!==null,version:state.version};},
  async reset({code,newPin,confirmPin,assertCurrent}){if(!state||state.staffId!==identity())throw Error('Reopen PIN recovery.');if(!/^\d{6,8}$/.test(newPin)||newPin!==confirmPin)throw Error('Use 6–8 digits and make sure the new PINs match.');if(!code)throw Error('Enter your current daily Staff PIN.');const key=JSON.stringify([code,newPin]);if(!attempt||attempt.key!==key)attempt={key,input:{staffId:state.staffId,expectedFingerprint:state.expectedFingerprint,operationId:uuid(),mode:'recover',currentPin:code,newPin}};await profile.vaultSave(attempt.input,{assertCurrent});return{configured:true,version:state.version+1};}
 };
}
