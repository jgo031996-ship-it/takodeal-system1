import {resolvePrivatePhoneIdentity} from './private-phone-identity.js';
export const STAFF_ACCESS_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/access';
export const STAFF_OPERATIONAL_FIELDS=Object.freeze(['staffId','cashierName','fullName','name','branch','role','scheduleNickname','scheduleName','nickname','scheduleAliases','status','employmentStatus','contractStatus','active','isActive','archived','isArchived','blocked','revoked','offboarded','resigned','terminated','disabled','deleted','isDeleted','profilePicUrl','scheduleEligible']);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const device=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const error=(message,code='staff-access/unavailable')=>Object.assign(Error(message),{code});
const unavailable=()=>error('Your Staff access could not be verified. Reconnect and sign in again.');
export function staffAccessRecovery(remoteCode,{route,pin}={}){
 const owner='Owner → Staff & Security';
 if(remoteCode==='access/pin')return {title:'Check your daily Staff PIN',action:'pin',message:'Your daily Staff PIN was not accepted for this check. Use the existing PIN saved in your employee profile. There is no separate PIN approval. '+owner+' → employee profile is where the Owner checks it.'};
 if(remoteCode==='access/approval')return {title:'Check this Staff phone’s access',action:'phone',message:'This Staff phone could not be verified. Cashier login and Staff phone approval are separate checks. '+owner+' → Staff & POS devices is where the Owner checks this phone. For personal activation, open the employee profile → Staff app setup code. Keep using your daily login PIN.'};
 if(remoteCode==='access/sign-in')return {title:'Reconnect your Staff sign-in',action:'sign-in',message:'The Staff phone sign-in could not be verified. Reconnect and sign in again with your usual daily PIN. A new PIN approval is not required.'};
 if(remoteCode==='access/request'&&route==='/staff-login'&&typeof pin==='string'&&!/^\d{4,10}$/.test(pin))return {title:'Activate this phone for screenshot uploads',action:'phone',message:'This older daily PIN format cannot confirm a screenshot through the legacy attendance check. Keep your daily PIN. Ask the Owner for your personal setup code under '+owner+' → employee profile → Staff app setup code, then activate this Staff phone with that code.'};
 if(remoteCode==='access/review')return {title:'Staff account needs Owner review',action:'review',message:'HQ found an ambiguous or changed Staff account. '+owner+' → employee profile is where the Owner checks the saved account, branch and PIN. No attendance or PIN change was confirmed.'};
 return null;
}
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function operationalStaffProfile(value,staffId){
 if(!id(staffId)||!object(value)||Object.keys(value).some(key=>!STAFF_OPERATIONAL_FIELDS.includes(key))||value.staffId!=null&&value.staffId!==staffId||typeof value.cashierName!=='string'||!value.cashierName.trim()||typeof value.branch!=='string'||!value.branch.trim())throw unavailable();
 if(value.scheduleAliases!==undefined&&(!Array.isArray(value.scheduleAliases)||value.scheduleAliases.length>20||value.scheduleAliases.some(name=>typeof name!=='string'||!name.trim()||name.length>200)))throw unavailable();
 return{...value,staffId};
}
export function createStaffAccessClient({auth,ensureUser,deviceId,sessionId=()=>null,makeSessionId=()=>globalThis.crypto.randomUUID(),storage=globalThis.localStorage,fetcher=globalThis.fetch,now=Date.now,timeoutMs=20000,Controller=AbortController,delay=setTimeout,cancelDelay=clearTimeout}={}){
 if(!auth||typeof ensureUser!=='function'||typeof deviceId!=='function'||typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw unavailable();
 let epoch=0,loginFlight=null,pendingLogin=null;const cancellations=new Map(),cancelFlights=new Map(),prefix='takodeal_staff_session_pending_v1:';
 const markerKey=row=>prefix+row.uid+':'+row.sessionId;
 function remember(attempt){const row={schemaVersion:1,uid:attempt.user.uid,deviceId:attempt.deviceId,sessionId:attempt.sessionId,createdAt:now()},key=markerKey(row);storage?.setItem(key,JSON.stringify(row));cancellations.set(key,row);}
 function forget(row){const key=markerKey(row);storage?.removeItem(key);cancellations.delete(key);}
 function markers(){
  if(storage)for(let at=0;at<storage.length;at++){const key=storage.key(at);if(!key?.startsWith(prefix))continue;let row;try{row=JSON.parse(storage.getItem(key));}catch{throw unavailable();}if(!exact(row,['schemaVersion','uid','deviceId','sessionId','createdAt'])||row.schemaVersion!==1||!id(row.uid)||!id(row.sessionId)||!device(row.deviceId)||!Number.isFinite(row.createdAt)||markerKey(row)!==key)throw unavailable();cancellations.set(key,row);}
  if(cancellations.size>30)throw unavailable();return[...cancellations.values()];
 }
 async function cancelOne(row,token){
  const key=markerKey(row);if(cancelFlights.has(key))return cancelFlights.get(key);
  const controller=new Controller();let timer;
  const action=Promise.resolve().then(async()=>{const response=await fetcher(STAFF_ACCESS_ENDPOINT+'/staff-logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({deviceId:row.deviceId,app:'staff',sessionId:row.sessionId}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',keepalive:true,signal:controller.signal});if(response.redirected||!response.ok)throw unavailable();const result=await response.json();if(result?.schemaVersion!==1||result.signedOut!==true)throw unavailable();forget(row);});
  const bounded=Promise.race([action,new Promise((_,reject)=>{timer=delay(()=>{controller.abort();reject(error('Reconnect to confirm the previous Staff sign-out before signing in again.','staff-access/cancellation-pending'));},5000);})]).finally(()=>{cancelDelay(timer);if(cancelFlights.get(key)===bounded)cancelFlights.delete(key);});cancelFlights.set(key,bounded);return bounded;
 }
 async function flush(assertCurrent=()=>{}){
  let expired=false,timer;const generation=epoch,guard=()=>{if(expired||generation!==epoch)throw error('Reconnect to confirm the previous Staff sign-out before signing in again.','staff-access/cancellation-pending');assertCurrent();};
  const work=Promise.resolve().then(async()=>{for(const row of markers()){guard();const user=await ensureUser({guard});guard();if(user?.uid!==row.uid||auth.currentUser!==user)throw error('A saved Staff sign-out belongs to another phone account. Ask HQ to review this phone.','staff-access/cancellation-pending');const token=await user.getIdToken();guard();await cancelOne(row,token);guard();}});
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=delay(()=>{expired=true;reject(error('Reconnect to confirm the previous Staff sign-out before signing in again.','staff-access/cancellation-pending'));},timeoutMs);})]);}finally{expired=true;cancelDelay(timer);}
 }
 function cancelLogin(attempt){
  if(!attempt?.token||attempt.cancelled)return;attempt.cancelled=true;
  cancelOne({uid:attempt.user.uid,deviceId:attempt.deviceId,sessionId:attempt.sessionId},attempt.token).catch(()=>{});
 }
 async function call(route,body,{assertCurrent=()=>{},privateClient,onDispatch}={}){
  const generation=epoch,selectedDevice=deviceId(),primaryUser=auth.currentUser,controller=new Controller();let user,selectedAuth=auth,privateIdentity,expired=false,timer;
  const guard=()=>{if(expired)throw error('The Staff check took too long. Check your connection and try again.','staff-access/timeout');if(generation!==epoch||privateClient&&auth.currentUser!==primaryUser||deviceId()!==selectedDevice||user&&selectedAuth.currentUser!==user)throw error('Your Staff account or phone changed. Sign in again.','staff-access/changed');assertCurrent();};
  const action=Promise.resolve().then(async()=>{
   guard();if(!device(selectedDevice))throw unavailable();
   if(privateClient){const client=await privateClient({assertCurrent:guard});guard();selectedAuth=client.auth;user=selectedAuth?.currentUser;privateIdentity=await resolvePrivatePhoneIdentity({client,staffId:body.staffId,assertCurrent:guard});guard();}else user=await ensureUser({guard});
   guard();if(!user?.uid||user.isAnonymous!==true||typeof user.getIdToken!=='function')throw unavailable();
   const token=await user.getIdToken();guard();if(typeof token!=='string'||!token)throw unavailable();if(privateIdentity){await privateIdentity.assertFresh();guard();}
   onDispatch?.({token,user,deviceId:selectedDevice});guard();
   const response=await fetcher(STAFF_ACCESS_ENDPOINT+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...body,deviceId:privateIdentity?.deviceId||selectedDevice}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});guard();
   if(response.redirected||response.type==='opaque'||response.url&&response.url!==STAFF_ACCESS_ENDPOINT+route)throw unavailable();
   const result=await response.json();guard();if(privateIdentity){await privateIdentity.assertFresh();guard();}if(!object(result)||JSON.stringify(result).length>(['/staff-payroll-history','/staff-operational-history'].includes(route)?7*1024*1024:route==='/staff-payroll-inputs'?3*1024*1024:524288))throw unavailable();
   if(!response.ok){const denied=[400,401,403].includes(response.status),limited=response.status===429,recovery=!limited?staffAccessRecovery(result.code,{route,pin:body.pin}):null;const failure=error(recovery?.message||(limited?'Too many Staff checks. Wait a minute and try again.':denied?'Your PIN, account or approved phone could not be verified. Check the details or ask HQ for help.':'The Staff service is unavailable. Reconnect and try again.'),denied?'staff-access/denied':limited?'staff-access/rate-limit':'staff-access/unavailable');if(recovery)failure.staffAccessRecovery=recovery;throw failure;}
   return result;
  });
  try{return await Promise.race([action,new Promise((_,reject)=>{timer=delay(()=>{expired=true;controller.abort();reject(error('The Staff check took too long. Check your connection and try again.','staff-access/timeout'));},timeoutMs);})]);}
  catch(failure){guard();if(failure?.code?.startsWith('staff-access/'))throw failure;throw unavailable();}
  finally{cancelDelay(timer);controller.abort();}
 }
 return{
  invalidate(){epoch++;cancelLogin(pendingLogin);},
  flushCancellations:flush,
  async login({pin,selectedStaffId,assertCurrent=()=>{}}={}){
   if(loginFlight)throw error('The earlier sign-in is still finishing. Please wait.','staff-access/busy');
   if(typeof pin!=='string'||!pin.trim()||pin.length>100||selectedStaffId!==undefined&&!id(selectedStaffId))throw unavailable();
   const attempt={sessionId:makeSessionId(),deviceId:deviceId()},previousSession=sessionId();if(!id(attempt.sessionId))throw unavailable();pendingLogin=attempt;
   const loginEpoch=epoch,loginGuard=()=>{if(loginEpoch!==epoch||sessionId()!==previousSession)throw error('Your Staff sign-in changed in another view. Sign in again.','staff-access/changed');assertCurrent();};
   const pending=Promise.resolve().then(async()=>{await flush(loginGuard);loginGuard();return call('/staff-login',{pin:pin.trim(),app:'staff',sessionId:attempt.sessionId,...(selectedStaffId?{selectedStaffId}:{})},{assertCurrent:loginGuard,onDispatch:value=>{Object.assign(attempt,value);remember(attempt);}});});loginFlight=pending;
   try{const result=await pending;if(!exact(result,['schemaVersion','staffId','profile','branch','sessionExpiresAt','sessionId'])||result.schemaVersion!==1||result.sessionId!==attempt.sessionId||!id(result.staffId)||selectedStaffId&&result.staffId!==selectedStaffId||typeof result.sessionExpiresAt!=='string'||!Number.isFinite(Date.parse(result.sessionExpiresAt))||Date.parse(result.sessionExpiresAt)<=now())throw unavailable();const profile=operationalStaffProfile(result.profile,result.staffId);if(result.branch!==profile.branch)throw unavailable();loginGuard();forget({uid:attempt.user.uid,sessionId:attempt.sessionId});return{...result,profile};}
   catch(failure){cancelLogin(attempt);throw failure;}
   finally{if(loginFlight===pending)loginFlight=null;if(pendingLogin===attempt)pendingLogin=null;}
  },
  async verifyPin({pin,staffId,purpose,scope,branch,assertCurrent=()=>{}}={}){
   if(!id(staffId)||typeof pin!=='string'||!pin.trim()||pin.length>100||!['leave','early-time-out','time-clock','meal','purchase'].includes(purpose)||scope!==undefined&&(typeof scope!=='string'||scope.length>200))throw unavailable();
   const currentSession=sessionId();if(!id(currentSession))throw unavailable();
   const result=await call('/verify-staff-pin',{pin:pin.trim(),staffId,app:'staff',sessionId:currentSession,purpose,...(scope?{scope}:{}),...(branch?{branch}:{})},{assertCurrent:()=>{if(sessionId()!==currentSession)throw unavailable();assertCurrent();}});
   if(!exact(result,['schemaVersion','staffId','profile','branch','verificationId','expiresAt'])||result.schemaVersion!==1||result.staffId!==staffId||!id(result.verificationId)||typeof result.expiresAt!=='string'||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=now())throw unavailable();
   const profile=operationalStaffProfile(result.profile,staffId);if(result.branch!==(branch||profile.branch))throw unavailable();return{...result,profile};
  },
  async changePin({staffId,newPin,operationId,expectedVersion,createPrivateClient,assertCurrent=()=>{}}={}){
   if(!id(staffId)||typeof newPin!=='string'||!/^\d{4,10}$/.test(newPin)||!id(operationId)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||typeof createPrivateClient!=='function')throw unavailable();
   const result=await call('/change-staff-pin',{staffId,newPin,operationId,expectedVersion},{assertCurrent,privateClient:createPrivateClient});
   if(!exact(result,['schemaVersion','staffId','version','changed','alreadySaved'])||result.schemaVersion!==1||result.staffId!==staffId||result.version!==expectedVersion+1||result.changed!==true||typeof result.alreadySaved!=='boolean')throw unavailable();return result;
  },
  async payroll({staffId,createPrivateClient,assertCurrent=()=>{}}={}){
   if(!id(staffId)||typeof createPrivateClient!=='function')throw unavailable();
   const result=await call('/staff-payroll-history',{staffId},{assertCurrent,privateClient:createPrivateClient});
   if(!exact(result,['schemaVersion','staffId','staffName','branch','asOf','records','held','complete'])||result.schemaVersion!==1||result.staffId!==staffId||typeof result.staffName!=='string'||!result.staffName.trim()||typeof result.branch!=='string'||!result.branch.trim()||typeof result.asOf!=='string'||!Number.isFinite(Date.parse(result.asOf))||!Array.isArray(result.records)||result.records.length>250||!Array.isArray(result.held)||result.held.length>250||typeof result.complete!=='boolean'||result.held.some(row=>!object(row)||Object.keys(row).some(key=>!['recordId','message'].includes(key))||typeof row.message!=='string'||row.message.length>500||row.recordId!==undefined&&(typeof row.recordId!=='string'||row.recordId.length>250)))throw unavailable();
   return result;
  },
  async acknowledgePayroll({staffId,recordId,signatureBase64,expectedFingerprint,operationId,createPrivateClient,assertCurrent=()=>{}}={}){
   if(!id(staffId)||typeof recordId!=='string'||!/^[-A-Za-z0-9_]{1,250}$/.test(recordId)||typeof signatureBase64!=='string'||signatureBase64.length>349550||!signatureBase64.startsWith('data:image/png;base64,')||!/^[a-f0-9]{64}$/.test(expectedFingerprint||'')||!id(operationId)||typeof createPrivateClient!=='function')throw unavailable();
   const result=await call('/staff-payroll-acknowledge',{staffId,recordId,signatureBase64,expectedFingerprint,operationId},{assertCurrent,privateClient:createPrivateClient});
   if(!exact(result,['schemaVersion','staffId','recordId','acknowledged','alreadySaved'])||result.schemaVersion!==1||result.staffId!==staffId||result.recordId!==recordId||result.acknowledged!==true||typeof result.alreadySaved!=='boolean')throw unavailable();return result;
  },
  async payrollInputs({staffId,createPrivateClient,assertCurrent=()=>{}}={}){
   if(!id(staffId)||typeof createPrivateClient!=='function')throw unavailable();const result=await call('/staff-payroll-inputs',{staffId},{assertCurrent,privateClient:createPrivateClient});
   if(!exact(result,['schemaVersion','staffId','asOf','complete','staffDeductions','staffBonuses'])||result.schemaVersion!==1||result.staffId!==staffId||typeof result.asOf!=='string'||!Number.isFinite(Date.parse(result.asOf))||typeof result.complete!=='boolean'||!Array.isArray(result.staffDeductions)||!Array.isArray(result.staffBonuses)||result.staffDeductions.length>500||result.staffBonuses.length>500)throw unavailable();return result;
  },
  async operational({staffId,table,assertCurrent=()=>{}}={}){
   const currentSession=sessionId();if(!id(staffId)||!id(currentSession)||!['attendance_logs','sop_logs','staff_requests','shift_swaps','acknowledgments','announcements','hr_sanctions'].includes(table))throw unavailable();
   const result=await call('/staff-operational-history',{staffId,app:'staff',sessionId:currentSession,table},{assertCurrent:()=>{if(sessionId()!==currentSession)throw unavailable();assertCurrent();}});
   if(!exact(result,['schemaVersion','staffId','table','asOf','complete','records'])||result.schemaVersion!==1||result.staffId!==staffId||result.table!==table||typeof result.asOf!=='string'||!Number.isFinite(Date.parse(result.asOf))||result.complete!==true||!Array.isArray(result.records)||result.records.length>10000||result.records.some(row=>!object(row)||typeof row.id!=='string'||!row.id||row.id.length>500||row.id.includes('/'))||new Set(result.records.map(row=>row.id)).size!==result.records.length)throw unavailable();return result;
  },
  async logout({assertCurrent=()=>{}}={}){
   const currentSession=sessionId();if(!id(currentSession))return{signedOut:true};
   const user=await ensureUser({guard:assertCurrent});assertCurrent();remember({user,deviceId:deviceId(),sessionId:currentSession});
   const result=await call('/staff-logout',{app:'staff',sessionId:currentSession},{assertCurrent});if(result?.schemaVersion!==1||result.signedOut!==true)throw unavailable();forget({uid:user.uid,sessionId:currentSession});return result;
  }
 };
}
