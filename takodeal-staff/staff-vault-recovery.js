import {STAFF_SETUP_ENDPOINT,normalizeSetupCode,freshSetupId} from './staff-setup-access.js';
import {validVaultPin} from './staff-privacy.js';
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const phone=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,fields)=>object(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
const recoveryError=Symbol('staff-vault-recovery');
const failure=(message,code='recovery-unavailable')=>Object.assign(Error(message),{code,[recoveryError]:true});
const unavailable=()=>failure('Use your personally approved Staff phone. Ask HQ to confirm its personal setup and give you your personal setup code.');
const messages={
 'setup-code-invalid':'The personal setup code could not be verified. Check it with HQ and try again.',
 'setup-not-enabled':'Personal phone setup is not enabled. Ask HQ to confirm your phone before recovering this PIN.',
 'device-unavailable':'This phone could not be verified for your staff account. Ask HQ to review your personal phone setup.',
 'device-registry-unavailable':'HQ must review your personal phone registrations before PIN recovery.',
 'authentication-required':'Reconnect and sign in again before recovering the Payslip PIN.',
 'staff-auth-required':'Use your personally approved Staff phone to recover this PIN.',
 'try-later':'Too many attempts. Wait before trying again or ask HQ for help.',
 'version-changed':'The Payslip PIN changed on another phone. Close this form and check again.',
 'operation-conflict':'This retry differs from the previous request. Close this form and check your PIN settings again.',
 'pin-not-separate':'Choose a Payslip PIN different from your daily Staff login PIN.'
};
// This client never changes a public staff profile, grants device access or opens
// pay. The trusted service authorizes and atomically records the PIN recovery.
export function createStaffVaultRecoveryClient({auth,authority,identity,deviceId,fetcher=globalThis.fetch,cryptoAPI=globalThis.crypto,timeoutMs=20000,delay=setTimeout,cancelDelay=clearTimeout,Controller=AbortController}={}){
 if(!auth||typeof identity!=='function'||typeof deviceId!=='function'||typeof fetcher!=='function')throw Error('The protected Staff recovery service is not ready.');
 const access=()=>typeof authority==='function'?authority():authority;
 let generation=0,status=null,attempt=null,flight=null,activeController=null;
 const capture=()=>{
  const staffId=identity(),selectedDevice=deviceId(),user=auth.currentUser,a=access();
  if(!key(staffId)||!phone(selectedDevice)||!user?.uid||user.isAnonymous!==true||!a?.confirm||!a?.capture||!a?.assert)throw unavailable();
  return{staffId,deviceId:selectedDevice,user,authority:a,generation};
 };
 const still=(scope,assertCurrent)=>{
  assertCurrent();if(scope.generation!==generation||auth.currentUser!==scope.user||identity()!==scope.staffId||deviceId()!==scope.deviceId||access()!==scope.authority)throw failure('Your staff account or phone changed. Reopen PIN recovery.','account-changed');
 };
 const binding=(scope,assertCurrent)=>{
  still(scope,assertCurrent);const a=scope.authority,b=a.binding?.();
  if(a.mode?.()!=='protected'||!a.isVerified?.()||!b||b.status!=='Active'||b.staffId!==scope.staffId||b.deviceId!==scope.deviceId)throw unavailable();
  return b;
 };
 async function run(action,assertCurrent){
  if(flight)throw failure('The earlier PIN check is still pending. Wait for it to finish before retrying.','recovery-busy');
  const scope=capture(),controller=new Controller();activeController=controller;let expired=false,timer;
  const check=()=>{if(expired)throw failure('HQ has not confirmed this PIN action yet. It may have saved. Retry the same request when the connection returns.','recovery-timeout');still(scope,assertCurrent);};
  const physical=Promise.resolve().then(async()=>{
   check();await auth.authStateReady?.();check();await scope.authority.confirm(scope.deviceId);check();binding(scope,assertCurrent);
   const proof=scope.authority.capture(),savedBinding=JSON.stringify(scope.authority.binding());
   const guard=()=>{check();scope.authority.assert(proof,scope.staffId);binding(scope,assertCurrent);if(JSON.stringify(scope.authority.binding())!==savedBinding)throw failure('Your personal phone setup changed. Reopen PIN recovery.','account-changed');};
   async function post(route,body){
    guard();const token=await scope.user.getIdToken();guard();if(typeof token!=='string'||!token)throw unavailable();
    const response=await fetcher(STAFF_SETUP_ENDPOINT+route,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:controller.signal});guard();
    let data;try{data=await response.json();}catch{guard();throw failure('HQ returned an incomplete PIN result. Close this form and check again.');}guard();
    if(!object(data)||JSON.stringify(data).length>4096)throw failure('HQ returned an unsupported PIN result. Close this form and check again.');
    if(!response.ok){const code=data.error?.code;throw failure(messages[code]||'HQ could not confirm this PIN action. It may have saved. Retry the same request or ask HQ for help.',typeof code==='string'?code:'recovery-unavailable');}
    return data;
   }
   return action(scope,{post,guard});
  });
  flight=physical;const cleanup=()=>{if(flight===physical){flight=null;activeController=null;}};physical.then(cleanup,cleanup);
  try{return await Promise.race([physical,new Promise((_,reject)=>{timer=delay(()=>{expired=true;controller.abort();reject(failure('HQ has not confirmed this PIN action yet. It may have saved. Retry the same request when the connection returns.','recovery-timeout'));},timeoutMs);})]);}
  catch(error){if(error?.[recoveryError])throw error;throw failure('HQ could not confirm this PIN action. It may have saved. Retry the same request or ask HQ for help.');}
  finally{expired=true;cancelDelay(timer);}
 }
 return{
  invalidate(){generation++;status=null;attempt=null;activeController?.abort();},
  status({assertCurrent=()=>{}}={}){return run(async(scope,{post,guard})=>{
   status=null;
   const result=await post('/vault-pin-status',{staffId:scope.staffId,deviceId:scope.deviceId});guard();
   if(!exact(result,['staffId','deviceId','version','configured'])||result.staffId!==scope.staffId||result.deviceId!==scope.deviceId||!Number.isSafeInteger(result.version)||result.version<0||typeof result.configured!=='boolean')throw failure('HQ could not confirm your own PIN settings. Ask HQ to review this phone.');
   status={...result,uid:scope.user.uid,user:scope.user};return{...result};
  },assertCurrent);},
  reset({code,newPin,confirmPin,assertCurrent=()=>{}}={}){
   if(typeof newPin!=='string'||typeof confirmPin!=='string'||!validVaultPin(newPin)||newPin!==confirmPin)return Promise.reject(failure('Use 6–8 digits and make sure the new PINs match.','invalid-pin'));
   let normalized;try{if(typeof code!=='string')throw Error();normalized=normalizeSetupCode(code);}catch{return Promise.reject(failure('Enter the 10-digit personal setup code from HQ.','invalid-code'));}
   return run(async(scope,{post,guard})=>{
    if(!status||status.user!==scope.user||status.uid!==scope.user.uid||status.staffId!==scope.staffId||status.deviceId!==scope.deviceId)throw failure('Check this phone and your PIN settings before saving a new PIN.');
    const expectedVersion=status.version;if(!Number.isSafeInteger(expectedVersion+1))throw failure('HQ must review this PIN version before recovery.');
    const bytes=await cryptoAPI.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope.user.uid,scope.staffId,scope.deviceId,expectedVersion,normalized,newPin])));guard();const intent=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(!attempt||attempt.intent!==intent)attempt={intent,id:'vault-'+freshSetupId(cryptoAPI)};
    const result=await post('/vault-pin-reset',{staffId:scope.staffId,deviceId:scope.deviceId,code:normalized,newPin,expectedVersion,operationId:attempt.id});guard();
    if(!exact(result,['version','configured'])||result.version!==expectedVersion+1||result.configured!==true)throw failure('HQ returned an unsupported PIN save result. Close this form and check again.');
    status=null;attempt=null;return{...result};
   },assertCurrent);
  }
 };
}

// Existing phones may have HQ-approved private document access while global
// Staff setup is disabled. That separate Firebase UID/grant is an equally
// explicit ownership source; public legacy device mirrors never substitute.
async function recoveryForPhone({auth,authority,identity,deviceId,createPrivateClient,assertCurrent=()=>{},...options}={}){
 const staffId=identity?.(),selectedDevice=deviceId?.();if(!key(staffId)||!phone(selectedDevice))throw unavailable();
 const local=()=>{assertCurrent();if(identity()!==staffId||deviceId()!==selectedDevice)throw failure('Your staff account or phone changed. Reopen PIN recovery.','account-changed');};local();
 await auth?.authStateReady?.();local();const primaryUser=auth?.currentUser,a=typeof authority==='function'?authority():authority;
 const primaryCurrent=()=>{local();if(auth?.currentUser!==primaryUser)throw failure('Your Staff phone identity changed. Reopen PIN recovery.','account-changed');};
 if(primaryUser?.uid&&primaryUser.isAnonymous===true&&a?.confirm){
  try{const result=await a.confirm(selectedDevice);primaryCurrent();const b=a.binding?.();if(result?.enabled===true&&a.mode?.()==='protected'&&b?.status==='Active'&&b.staffId===staffId&&b.deviceId===selectedDevice)return createStaffVaultRecoveryClient({auth,authority,identity,deviceId,...options});}
  catch{primaryCurrent();}
 }
 primaryCurrent();if(typeof createPrivateClient!=='function')throw unavailable();
 const client=await createPrivateClient();primaryCurrent();const privateAuth=client?.auth,sdk=client?.sdk,db=client?.db;
 await privateAuth?.authStateReady?.();primaryCurrent();const user=privateAuth?.currentUser;
 if(!user?.uid||user.isAnonymous!==true||!sdk?.getDocFromServer||!sdk?.doc)throw unavailable();
 const privatePhone=await resolvePrivatePhoneIdentity({client,staffId,assertCurrent:primaryCurrent}),privateDevice=privatePhone.deviceId;primaryCurrent();
 let current=null,epoch=0;
 const guard=()=>{primaryCurrent();if(privateAuth.currentUser!==user)throw failure('Your approved private phone identity changed. Reopen PIN recovery.','account-changed');};
 const server=snapshot=>{if(!snapshot||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||!snapshot.exists())throw unavailable();return snapshot.data();};
 const privateAuthority={
  async confirm(value){
   guard();if(value!==privateDevice)throw unavailable();
   const [config,record]=await Promise.all([sdk.getDocFromServer(sdk.doc(db,'staff_document_config','current')),sdk.getDocFromServer(sdk.doc(db,'staff_document_devices',user.uid))]);guard();
   const policy=server(config),binding=server(record);
   if(policy.enabled!==true||policy.policyVersion!==2||policy.brokerEndpoint!=='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'||binding.active!==true||binding.uid!==user.uid||binding.staffId!==staffId||binding.deviceId!==privateDevice||binding.branch!==privatePhone.branch)throw unavailable();
   const next={staffId,deviceId:privateDevice,branch:binding.branch,status:'Active'};if(JSON.stringify(current)!==JSON.stringify(next))epoch++;current=next;
   return{enabled:true,mode:'protected',device:{...next}};
  },
  mode:()=>current?'protected':null,isVerified:()=>Boolean(current&&privateAuth.currentUser===user),binding:()=>current?{...current}:null,capture:()=>({epoch,uid:user.uid}),
  assert(proof,id){guard();if(!current||proof?.epoch!==epoch||proof?.uid!==user.uid||id!==staffId)throw unavailable();}
 };
 await privateAuthority.confirm(privateDevice);guard();
 return createStaffVaultRecoveryClient({auth:privateAuth,authority:privateAuthority,identity,...options,deviceId:()=>privateDevice});
}
export async function createStaffVaultRecoveryForPhone(options={}){
 let expired=false,timer;const current=options.assertCurrent||(()=>{}),schedule=options.delay||setTimeout,cancel=options.cancelDelay||clearTimeout;
 try{return await Promise.race([recoveryForPhone({...options,assertCurrent:()=>{if(expired)throw failure('The personal phone check took too long. Reconnect and check again.','recovery-timeout');current();}}),new Promise((_,reject)=>{timer=schedule(()=>{expired=true;reject(failure('The personal phone check took too long. Reconnect and check again.','recovery-timeout'));},options.timeoutMs??20000);})]);}
 catch(error){if(error?.[recoveryError])throw error;throw unavailable();}
 finally{cancel(timer);}
}
import {resolvePrivatePhoneIdentity} from './private-phone-identity.js';
