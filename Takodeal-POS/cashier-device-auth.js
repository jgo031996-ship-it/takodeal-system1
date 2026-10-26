// A protected Cashier action may use its own device identity without replacing
// the Google account used to set up the tablet. This module never signs in/out.
export const CASHIER_DEVICE_APP_NAME='takodeal-pos-secure-device-v1';
export const CASHIER_DEVICE_MODE_PREFIX='takodeal_pos_device_auth_v1:';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const failure='Secure tablet setup could not be confirmed. Reopen the protected action and check approval again.';

export function createCashierDeviceAuthContext(w,{primaryAuth,primaryDb,firebaseConfig,initializeApp,getApps,getAuth,getFirestore,timeoutMs=20000}={}){
 let pending=null;
 const physical=()=>{
  const branch=w.localStorage.getItem('takodeal_device_branch'),deviceId=w.localStorage.getItem('takodeal_device_id');
  if(typeof branch!=='string'||!branch.trim()||branch.length>120||!key(deviceId))throw Error('Choose the approved branch and tablet setup before checking secure approval.');
  return {branch,deviceId,signature:JSON.stringify([branch,deviceId])};
 };
 const adapter=(auth,db)=>{
  if(!auth?.app||!db?.app||auth.app!==db.app)throw Error('The secure tablet identity and database do not match. Ask HQ to update this Cashier app.');
  const api={auth,db};
  for(const method of ['doc','collection','query','where','limit','getDocFromServer','getDocsFromServer','runTransaction','serverTimestamp']){
   if(typeof w[method]!=='function')throw Error('Secure tablet setup is still loading. Reopen this action in a moment.');
   api[method]=(...args)=>w[method](...args);
  }
  return api;
 };
 return {async resolve({assertCurrent=()=>{}}={}){
  assertCurrent();let device;try{device=physical();}catch(error){throw Error(error.message||failure);}
  if(pending?.scope===device.signature){const result=await pending.promise;assertCurrent();if(physical().signature!==device.signature)throw Error('The branch or tablet changed. Reopen this action.');return result;}
  let expired=false,timer;const guard=()=>{if(expired)throw Error('Secure tablet setup took too long. Check the connection, then choose Check approval.');assertCurrent();if(physical().signature!==device.signature)throw Error('The branch or tablet changed. Reopen this action.');};
  const work=(async()=>{
   guard();if(typeof primaryAuth?.authStateReady!=='function')throw Error('Secure tablet setup is unavailable. Ask HQ to update this Cashier app.');
   await primaryAuth.authStateReady();guard();const primaryUser=primaryAuth.currentUser;
   const markerKey=CASHIER_DEVICE_MODE_PREFIX+encodeURIComponent(device.signature),raw=w.localStorage.getItem(markerKey);let marker=null;
   if(raw!==null){try{marker=JSON.parse(raw);}catch{throw Error('This tablet’s saved secure setup needs HQ review. Keep its app data and contact the Owner.');}
    if(!object(marker)||Object.keys(marker).sort().join('|')!=='appName|branch|deviceId|kind|version'||marker.version!==1||marker.kind!=='isolated'||marker.appName!==CASHIER_DEVICE_APP_NAME||marker.branch!==device.branch||marker.deviceId!==device.deviceId)throw Error('This tablet’s saved secure setup does not match this branch and device. Ask the Owner to review it.');
   }
   if(!marker&&(!primaryUser||primaryUser.isAnonymous===true))return {auth:primaryAuth,deviceApi:adapter(primaryAuth,primaryDb),kind:'default'};
   if(!firebaseConfig?.projectId||!firebaseConfig?.appId||!firebaseConfig?.apiKey||![initializeApp,getApps,getAuth,getFirestore].every(value=>typeof value==='function'))throw Error('The separate Cashier device setup is unavailable. Ask HQ to update this app. Your Google account remains signed in.');
   const apps=getApps();if(!Array.isArray(apps))throw Error(failure);const matches=apps.filter(app=>app?.name===CASHIER_DEVICE_APP_NAME);if(matches.length>1)throw Error('The separate Cashier device setup needs HQ review.');
   let app=matches[0];if(app&&['projectId','appId','apiKey','authDomain'].some(field=>app.options?.[field]!==firebaseConfig[field]))throw Error('The separate Cashier device setup belongs to a different project. Ask HQ to review it.');
   if(!app)app=initializeApp(firebaseConfig,CASHIER_DEVICE_APP_NAME);guard();
   if(app?.name!==CASHIER_DEVICE_APP_NAME||['projectId','appId','apiKey','authDomain'].some(field=>app.options?.[field]!==firebaseConfig[field]))throw Error('The separate Cashier device setup could not be verified.');
   const auth=getAuth(app),db=getFirestore(app);adapter(auth,db);
   if(typeof auth.authStateReady!=='function')throw Error(failure);await auth.authStateReady();guard();
   if(primaryAuth.currentUser!==primaryUser)throw Error('The main account changed during secure setup. Reopen this action. Your account has been kept signed in.');
   if(auth.currentUser&&(!key(auth.currentUser.uid)||auth.currentUser.isAnonymous!==true))throw Error('The separate Cashier device setup contains another sign-in. Ask HQ to review it. Your Google account has been kept signed in.');
   const deviceApi=adapter(auth,db);
   if(!marker){const saved=JSON.stringify({version:1,kind:'isolated',appName:CASHIER_DEVICE_APP_NAME,branch:device.branch,deviceId:device.deviceId});guard();w.localStorage.setItem(markerKey,saved);if(w.localStorage.getItem(markerKey)!==saved)throw Error('The secure tablet choice could not be saved. Keep this app open and ask HQ to check device storage.');}
   guard();return {auth,deviceApi,kind:'isolated'};
  })();
  const promise=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Secure tablet setup took too long. Check the connection, then choose Check approval.'));},timeoutMs);})]).finally(()=>{expired=true;clearTimeout(timer);if(pending?.promise===promise)pending=null;});
  pending={scope:device.signature,promise};return promise;
 }};
}
