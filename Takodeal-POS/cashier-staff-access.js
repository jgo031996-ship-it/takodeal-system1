// PIN verification is online and server-authorized. No credential/roster cache.
import {bindCashierOperationalSdk} from './cashier-operational-sdk.js';
export const CASHIER_STAFF_LOGIN_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/access/staff-login';
export const CASHIER_STAFF_PIN_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/access/verify-staff-pin';
export const CASHIER_MEAL_IDENTITY_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/access/meal-identity';
export const CASHIER_STAFF_LOGOUT_KEY='takodeal_staff_logout_pending_v1';
const OWNER_EMAIL='jgo031996@gmail.com';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const safeText=(value,max=180)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const sessionNonce=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const scopeId=value=>typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=1500&&!/[\/\u0000-\u001f\u007f]/.test(value)&&!/^\.+$/.test(value);
const markerKey=row=>CASHIER_STAFF_LOGOUT_KEY+':'+encodeURIComponent(row.uid)+':'+row.sessionId;
export function pendingCashierSessionMarkers(storage){
 if(typeof storage?.key!=='function'||!Number.isSafeInteger(storage.length)||storage.length<0||storage.length>10000)throw Error('This tablet could not check its saved sign-out state. Keep the app data and ask HQ to review it.');
 const rows=[];for(let index=0;index<storage.length;index++){const name=storage.key(index);if(typeof name!=='string'||!name.startsWith(CASHIER_STAFF_LOGOUT_KEY+':'))continue;let row;try{row=JSON.parse(storage.getItem(name));}catch{throw Error('A saved sign-out needs HQ review. Keep this tablet data.');}
  if(!object(row)||row.schemaVersion!==1||!key(row.uid)||!sessionNonce(row.sessionId)||!safeText(row.branch,120)||!/^DEV-[A-Z0-9-]{6,80}$/.test(row.deviceId||'')||!['login-attempt','logout'].includes(row.state)||!Number.isFinite(row.createdAt)||markerKey(row)!==name)throw Error('A saved staff session needs HQ review before another sign in.');rows.push({name,row,raw:storage.getItem(name)});
 }return rows;
}
const BOOLEAN_FIELDS=new Set(['active','isActive','archived','isArchived','blocked','isDeleted','deleted','revoked','offboarded','resigned','terminated','disabled']);
const PROFILE_FIELDS=new Set(['staffId','cashierName','name','fullName','branch','role','scheduleNickname','scheduleName','nickname','scheduleAliases','contractStatus','employmentStatus','status',...BOOLEAN_FIELDS]);
export function operationalStaffProfile(profile,staffId,{requireActive=true,allowDocumentId=false}={}){
 if(!object(profile)||!(allowDocumentId?scopeId(staffId):key(staffId))||profile.staffId!==staffId||typeof profile.cashierName!=='string'||!profile.cashierName.trim()||profile.cashierName.length>200||typeof profile.branch!=='string'||profile.branch.length>120)throw Error('HQ returned an unconfirmed staff identity. Reconnect and try again.');
 if(Object.keys(profile).some(field=>!PROFILE_FIELDS.has(field)))throw Error('HQ returned an unexpected staff profile. Login was not confirmed.');
 for(const [field,value] of Object.entries(profile)){
  if(BOOLEAN_FIELDS.has(field)){if(typeof value!=='boolean')throw Error('HQ returned an invalid staff status.');}
  else if(field==='scheduleAliases'){if(!Array.isArray(value)||value.length>20||value.some(alias=>!safeText(alias)))throw Error('HQ returned invalid staff schedule names.');}
  else if(field==='staffId'&&allowDocumentId){if(!scopeId(value))throw Error('HQ returned an invalid meal identity.');}
  else if(typeof value!=='string'||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw Error('HQ returned an invalid staff identity.');
 }
 if(requireActive&&(profile.active===false||profile.isActive===false||['blocked','archived','isArchived','deleted','isDeleted','revoked','offboarded','terminated','resigned','disabled'].some(field=>profile[field]===true)||['status','employmentStatus','contractStatus'].some(field=>/^(blocked|inactive|terminated|disabled|revoked|archived|resigned|deleted|ended|expired|offboarded)$/i.test(profile[field]?.trim()||''))))throw Error('This staff account is not active. Ask HQ to review it.');
 return structuredClone(profile);
}
export async function readOperationalStaffDirectory(api,{assertCurrent=()=>{}}={}){
 const guard=()=>{api.assertStaffOperationalCurrent?.();assertCurrent();};guard();const snapshot=await api.getDocsFromServer(api.query(api.collection(api.db,'staff_directory'),api.limit(2001)));guard();
 const fresh=row=>row?.metadata?.fromCache===false&&row.metadata.hasPendingWrites===false;
 if(!Array.isArray(snapshot?.docs)||snapshot.docs.length>=2001||!fresh(snapshot)||snapshot.docs.some(row=>!fresh(row)))throw Error('The current staff directory could not be confirmed. Reconnect and reopen Time Clock.');
 const seen=new Set();return snapshot.docs.map(row=>{if(!key(row.id)||seen.has(row.id))throw Error('The staff directory needs HQ review.');seen.add(row.id);const {schemaVersion,profileRevision,updatedAt,syncedAt,...profile}=row.data();return {...operationalStaffProfile(profile,row.id,{requireActive:false}),id:row.id,profileRevision};});
}
export function createCashierOperationalApi(w,{primaryAuth,primaryDb=w.db,deviceContext,readStaffSessionProfile,readOperationalRecords,closeShiftTrusted,flushLogout,registerStop}={}){
 return async({assertCurrent=()=>{}}={})=>{
  if(pendingCashierSessionMarkers(w.localStorage).length){if(typeof flushLogout!=='function')throw Error('Reconnect to confirm the previous staff sign-out before continuing.');await flushLogout();assertCurrent();}
  const branch=w.localStorage.getItem('takodeal_device_branch'),deviceId=w.localStorage.getItem('takodeal_device_id'),session=w.sessionUser,primaryUser=primaryAuth?.currentUser;let selectedAuth,user;
  const guard=()=>{assertCurrent();if(w.sessionUser!==session||primaryAuth?.currentUser!==primaryUser||w.localStorage.getItem('takodeal_device_branch')!==branch||w.localStorage.getItem('takodeal_device_id')!==deviceId||selectedAuth&&selectedAuth.currentUser!==user)throw Error('The staff, branch or tablet changed. Reopen Time Clock.');};guard();
  let api;if(primaryUser?.email?.toLowerCase()===OWNER_EMAIL&&primaryUser.emailVerified===true&&primaryUser.providerData?.some(provider=>provider.providerId==='google.com')){selectedAuth=primaryAuth;user=primaryUser;api={...w,db:primaryDb};}
  else{const context=await deviceContext.resolve({assertCurrent:guard});guard();selectedAuth=context?.auth;user=selectedAuth?.currentUser;if(!user?.uid||user.isAnonymous!==true)throw Error('Check this tablet’s saved approval before loading the staff directory.');api=context.deviceApi;}
  guard();const result={db:api.db,auth:selectedAuth,localStorage:w.localStorage,staffProfileCollection:'staff_directory',requireStaffLogin:true,assertStaffOperationalCurrent:guard,staffPinActor:()=>{guard();return {uid:user.uid,deviceId,app:'cashier',sessionId:w.sessionUser?.staffLoginSessionId};},verifyStaffPin:input=>w.verifyStaffPin(input)};
  Object.assign(result,bindCashierOperationalSdk(api,guard,{registerStop}));
  if(typeof readStaffSessionProfile==='function')result.readStaffSessionProfile=input=>readStaffSessionProfile(result,input);
  if(typeof readOperationalRecords==='function')result.readOperationalRecords=(table,options)=>readOperationalRecords(result,table,options);
  if(typeof closeShiftTrusted==='function')result.closeShiftTrusted=input=>closeShiftTrusted(result,input);
  Object.defineProperty(result,'sessionUser',{get:()=>w.sessionUser});return result;
 };
}
export function createCashierDirectoryReader(w,options={}){
 const resolve=options.resolveApi||createCashierOperationalApi(w,options);return async({assertCurrent=()=>{}}={})=>readOperationalStaffDirectory(await resolve({assertCurrent}),{assertCurrent});
}
export function staffLoginIdentity(result,{branch,sessionId,now=Date.now()}={}){
 if(!object(result)||result.schemaVersion!==1||!key(result.staffId)||!sessionNonce(result.sessionId)||sessionId&&result.sessionId!==sessionId||!safeText(result.branch,120)||branch&&result.branch!==branch||typeof result.sessionExpiresAt!=='string')throw Error('HQ returned an unconfirmed staff login. Reconnect and try again.');
 const expiry=Date.parse(result.sessionExpiresAt);if(!Number.isFinite(expiry)||expiry<=now||expiry>now+12*60*60*1000+60000)throw Error('The staff login has expired or needs HQ review. Try again online.');
 const profile=operationalStaffProfile(result.profile,result.staffId);
 return {...profile,id:result.staffId,homeBranch:profile.branch,branch:result.branch,staffLoginExpiresAt:result.sessionExpiresAt,staffLoginSessionId:result.sessionId};
}
export function staffPinVerification(result,{staffId,branch,now=Date.now(),allowDocumentId=false}={}){
 if(!object(result)||result.schemaVersion!==1||result.staffId!==staffId||result.branch!==branch||!key(result.verificationId)||typeof result.expiresAt!=='string')throw Error('HQ has not confirmed this staff PIN proof. Try again online.');
 const expiry=Date.parse(result.expiresAt);if(!Number.isFinite(expiry)||expiry<=now||expiry>now+15*60*1000+60000)throw Error('The staff PIN confirmation expired. Enter your PIN again.');
 return {schemaVersion:1,staffId,profile:operationalStaffProfile(result.profile,staffId,{allowDocumentId}),branch,verificationId:result.verificationId,expiresAt:result.expiresAt};
}
export function createCashierStaffAccess({primaryAuth,primaryDb,deviceContext,storage,getSession=()=>null,online=()=>true,fetcher=globalThis.fetch,now=Date.now,timeoutMs=7000,makeSessionId=()=>globalThis.crypto.randomUUID()}={}){
 let flight=null,flightSessionId=null,lastLoginActor=null,flushFlight=null;
 const connections=new WeakMap();
 function saveMarker(row){const name=markerKey(row),raw=JSON.stringify(row);storage.setItem(name,raw);if(storage.getItem(name)!==raw)throw Error('This tablet could not retain the sign-in reference. Keep the app open and ask HQ to check storage.');return {name,raw,row};}
 function removeMarker(marker){if(storage.getItem(marker.name)===marker.raw)storage.removeItem(marker.name);}
 function physical(){const branch=storage?.getItem('takodeal_device_branch'),deviceId=storage?.getItem('takodeal_device_id');if(!safeText(branch,120)||typeof deviceId!=='string'||!/^DEV-[A-Z0-9-]{6,80}$/.test(deviceId))throw Error('Choose this tablet’s saved branch and check its device approval before signing in.');return {branch,deviceId};}
 async function call(pin,{assertCurrent=()=>{},signal,selectedStaffId,staffId,purpose,scope,mealLevelId,mealIdentity=false,logout=false,expectedUid,sessionId:requestedSessionId}={}){
  if(!logout&&(typeof pin!=='string'||!/^\d{4,10}$/.test(pin)))throw Error('Enter your current staff login PIN.');
  if(!online())throw Error('Connect to HQ to confirm your PIN. Saved orders and queued receipts are kept.');
  if(flight&&!logout)throw Error('A PIN check is still in progress. Wait for it to finish before trying again.');
  if(selectedStaffId!==undefined&&!key(selectedStaffId)||staffId!==undefined&&!key(staffId))throw Error('Choose the current saved staff account.');
  if(purpose!==undefined&&(!['time-clock','meal','purchase','leave','early-time-out'].includes(purpose)||!key(staffId))||scope!==undefined&&!scopeId(scope)||mealIdentity&&(!scopeId(scope)||!key(mealLevelId)))throw Error('Choose a supported staff PIN action.');
  const device=physical(),session=getSession(),primaryUser=primaryAuth?.currentUser,loginAttempt=!logout&&!purpose&&!mealIdentity,sessionId=loginAttempt?makeSessionId():requestedSessionId;
  if((loginAttempt||logout)&&!sessionNonce(sessionId)||requestedSessionId!==undefined&&!sessionNonce(requestedSessionId))throw Error('A secure staff session reference could not be confirmed. Update this app before signing in.');
  let retired=false,timer,selectedAuth,selectedDb,user,marker=null,accepted=false;const controller=new AbortController();
  const guard=()=>{assertCurrent();if(retired||signal?.aborted)throw Error('This PIN check ended. Reopen sign in and try again.');if(!logout&&getSession()!==session||primaryAuth?.currentUser!==primaryUser||JSON.stringify(physical())!==JSON.stringify(device))throw Error('The account, branch or tablet changed. Reopen sign in.');if(selectedAuth&&selectedAuth.currentUser!==user)throw Error('The secure tablet account changed. Check its saved approval again.');};
  const abort=()=>{retired=true;controller.abort();};signal?.addEventListener('abort',abort,{once:true});
  const work=(async()=>{
   guard();const owner=primaryUser?.email?.toLowerCase()===OWNER_EMAIL&&primaryUser.emailVerified===true&&primaryUser.providerData?.some(provider=>provider.providerId==='google.com');
   if(owner){selectedAuth=primaryAuth;selectedDb=primaryDb;user=primaryUser;}
   else{if(!deviceContext?.resolve)throw Error('Secure tablet approval is not ready. Open Check saved device approval.');const context=await deviceContext.resolve({assertCurrent:guard});guard();selectedAuth=context?.auth;selectedDb=context?.deviceApi?.db;user=selectedAuth?.currentUser;if(!user?.uid||user.isAnonymous!==true)throw Error('Check this tablet’s saved device approval with HQ before signing in. Your saved orders are kept.');}
   guard();if(expectedUid&&user.uid!==expectedUid)throw Error('The pending sign-out belongs to another tablet account. Ask HQ to review it.');if(typeof user?.getIdToken!=='function')throw Error('Reconnect the approved tablet account before signing in.');const token=await user.getIdToken();guard();if(typeof token!=='string'||token.length<20)throw Error('The tablet sign-in could not be confirmed.');
   if(loginAttempt)marker=saveMarker({schemaVersion:1,uid:user.uid,...device,sessionId,state:'login-attempt',createdAt:now()});
   const body=logout?{deviceId:device.deviceId,app:'cashier',sessionId}:{pin,deviceId:device.deviceId,branch:device.branch,app:'cashier',...(loginAttempt?{sessionId}:{}),...(purpose?{staffId,purpose,...(requestedSessionId?{sessionId:requestedSessionId}:{}),...(scope?{scope}:{})}:mealIdentity?{mealLevelId,...(requestedSessionId?{sessionId:requestedSessionId}:{}),scope}:selectedStaffId?{selectedStaffId}:{})};
   const endpoint=logout?CASHIER_STAFF_LOGIN_ENDPOINT.replace('/staff-login','/staff-logout'):mealIdentity?CASHIER_MEAL_IDENTITY_ENDPOINT:purpose?CASHIER_STAFF_PIN_ENDPOINT:CASHIER_STAFF_LOGIN_ENDPOINT;
   let response;try{response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:controller.signal,cache:'no-store',redirect:'error',credentials:'omit'});}catch{guard();throw Error('HQ could not confirm this account action. Check the connection and try again. Saved orders are kept.');}
   guard();let result;try{result=await response.json();}catch{throw Error('HQ returned an incomplete PIN confirmation. Try again online.');}guard();
   if(!response.ok){const error=Error(response.status===429?'Too many PIN attempts. Wait a little before trying again.':result?.code==='access/pin'?'PIN not confirmed. Enter your current staff login PIN.':response.status===401?'PIN not confirmed. Check your PIN and reconnect the approved tablet.':response.status===403?'This tablet or staff account is not approved. Check saved device approval with HQ.':'HQ could not confirm your PIN. Reconnect and try again.');error.status=response.status;error.code=typeof result?.code==='string'?result.code.slice(0,100):'staff-login-unconfirmed';throw error;}
   let identity;if(logout){if(result?.schemaVersion!==1||result.signedOut!==true)throw Error('HQ has not confirmed the previous sign-out. Reconnect and try again.');identity={schemaVersion:1,signedOut:true};}
   else if(mealIdentity){if(!['cashiers','hq_managers'].includes(result?.source)||!['staff','manager','co_owner','owner','franchise_owner'].includes(result?.mealRole)||result.scope!==scope||result.mealLevelId!==mealLevelId||!/^\d{4}-\d{2}-\d{2}$/.test(result.day||''))throw Error('HQ has not confirmed this meal account.');identity={...staffPinVerification(result,{staffId:result.staffId,branch:device.branch,now:now(),allowDocumentId:result.source==='hq_managers'}),source:result.source,mealRole:result.mealRole,day:result.day,mealLevelId,scope};}
   else identity=purpose?staffPinVerification(result,{staffId,branch:device.branch,now:now()}):staffLoginIdentity(result,{branch:device.branch,sessionId,now:now()});guard();if(loginAttempt){lastLoginActor={uid:user.uid,...device,sessionId};identity.staffLoginUid=user.uid;identity.staffLoginDeviceId=device.deviceId;connections.set(identity,{auth:selectedAuth,db:selectedDb,user,primaryUser,session,device});accepted=true;removeMarker(marker);}return identity;
  })();
  if(!logout){flight=work;flightSessionId=sessionId;work.finally(()=>{if(flight===work){flight=null;flightSessionId=null;}}).catch(()=>{});}
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(Error('HQ has not confirmed this PIN yet. Reconnect and try again. Your saved orders are kept.'));},timeoutMs);})]);}
  finally{retired=true;controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);if(marker&&!accepted){try{if(storage.getItem(marker.name)===marker.raw)saveMarker({...marker.row,state:'logout'});}catch{}void flushLogout().catch(()=>{});}}
 }
 async function flushLogout(){
  if(flushFlight)return flushFlight;
  const task=(async()=>{for(let count=0;count<40;count++){
   const marker=pendingCashierSessionMarkers(storage)[0];if(!marker)return;
   const device=physical(),pending=marker.row;if(pending.branch!==device.branch||pending.deviceId!==device.deviceId)throw Error('A pending sign-out belongs to another tablet setup. Ask HQ to review it.');
   if(pending.state==='login-attempt'&&now()-pending.createdAt>=0&&now()-pending.createdAt<Math.max(10000,timeoutMs+1000))throw Error('A staff sign-in is still in progress in this app. Wait for it to finish.');
   await call(undefined,{logout:true,expectedUid:pending.uid,sessionId:pending.sessionId});removeMarker(marker);if(flightSessionId===pending.sessionId){flight=null;flightSessionId=null;}
  }throw Error('Too many staff session references need HQ review. Keep this tablet data.');})();
  flushFlight=task;try{return await task;}finally{if(flushFlight===task)flushFlight=null;}
 }
 return {takeOperationalContext(identity){const connection=connections.get(identity);if(!connection?.db||connection.auth.currentUser!==connection.user||primaryAuth?.currentUser!==connection.primaryUser||getSession()!==connection.session||JSON.stringify(physical())!==JSON.stringify(connection.device)||identity.staffLoginUid!==connection.user.uid)throw Error('The verified Cashier connection changed. Sign in again before continuing.');connections.delete(identity);return{auth:connection.auth,db:connection.db,user:connection.user};},async login(pin,options){await flushLogout();return call(pin,options);},async verify({pin,purpose,...options}){if(!purpose)throw Error('Choose a supported staff PIN action.');await flushLogout();return call(pin,{purpose,...options});},async mealIdentity({pin,...options}){await flushLogout();return call(pin,{mealIdentity:true,...options});},logout(){const device=physical(),identity=getSession(),uid=identity?.staffLoginUid||lastLoginActor?.uid,sessionId=identity?.staffLoginSessionId||lastLoginActor?.sessionId;if(!key(uid)||!sessionNonce(sessionId))throw Error('Reconnect and confirm this staff account before signing out.');for(const marker of pendingCashierSessionMarkers(storage))saveMarker({...marker.row,state:'logout'});saveMarker({schemaVersion:1,uid,...device,sessionId,state:'logout',createdAt:now()});return flushLogout();},flushLogout,busy:()=>!!flight};
}
