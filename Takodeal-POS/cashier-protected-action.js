// Select an existing identity for an explicit protected action. This never signs
// in, signs out, registers, approves or rewrites the tablet's physical branch.
const OWNER='jgo031996@gmail.com',OWNER_APP='takodeal-pos-owner-preview-v1';
const ownerUser=user=>user?.isAnonymous===false&&user.email?.toLowerCase()===OWNER&&user.emailVerified===true&&user.providerData?.some(row=>row.providerId==='google.com');
const ownerGuidance='On the Owner desktop, sign in with the verified Google Owner account before retrying this action. Keep saved orders and correction references; do not request another tablet approval.';
const oldWork=reference=>Error('A saved correction or prep still belongs to its original Cashier sign-in'+(reference?' ('+String(reference).slice(0,128)+')':'')+'. Keep this tablet’s app data and use that original sign-in or ask the Owner to review its reference. It was not moved to the Owner account.');

export function isCashierOwnerActionUser(user){return Boolean(ownerUser(user));}

function savedWork(w,uid,deviceId){
 const storage=w.localStorage,known=new Map();
 if(typeof storage?.key!=='function'||!Number.isSafeInteger(storage.length)||storage.length<0||storage.length>10000)throw oldWork();
 for(let index=0;index<storage.length;index++){
  const name=storage.key(index);if(typeof name!=='string')continue;
  const isVoid=name.startsWith('takodeal_cashier_void_v1_'),isPrep=name.startsWith('takodeal_cashier_prep_v2_')||name.startsWith('takodeal_cashier_prep_v1_');if(!isVoid&&!isPrep)continue;
  let row,actor;try{row=JSON.parse(storage.getItem(name));actor=JSON.parse(row.scope);}catch{throw oldWork();}
  if(isVoid&&actor?.uid===uid&&actor.deviceId===deviceId&&row.operationId)known.set(row.operationId,row);
  if(isVoid&&['closed','cancelled'].includes(row.state)||isPrep&&row.state&&row.state!=='pending')continue;
  if(!actor?.uid||!actor.deviceId||!row.operationId)throw oldWork();
  if(actor.deviceId!==deviceId)continue;
  if(actor.uid!==uid)throw oldWork(row.receiptId||row.operationId);
  if(isVoid)known.set(row.operationId,row);
 }
 return known;
}

export function createCashierOwnerDesktopContext(w,{primaryAuth,primaryDb,firebaseConfig,initializeApp,getApps,getAuth,getFirestore,timeoutMs=20000}={}){
 return async({assertCurrent=()=>{}}={})=>{
  const originalPrimary=primaryAuth?.currentUser,branch=w.localStorage.getItem('takodeal_device_branch'),deviceId=w.localStorage.getItem('takodeal_device_id');let auth,db,user,retired=false,timer;
  const current=()=>{assertCurrent();if(retired||primaryAuth?.currentUser!==originalPrimary||w.localStorage.getItem('takodeal_device_branch')!==branch||w.localStorage.getItem('takodeal_device_id')!==deviceId||auth&&(auth.currentUser!==user||!ownerUser(user)))throw Error('The Owner account, branch or device changed. Reopen the protected action.');};
  const exactApp=app=>app&&['projectId','appId','apiKey','authDomain'].every(key=>typeof firebaseConfig?.[key]==='string'&&firebaseConfig[key].length>0&&app.options?.[key]===firebaseConfig[key])&&firebaseConfig?.projectId==='takodeal-pos';
  const work=(async()=>{
   current();
   if(ownerUser(originalPrimary)){auth=primaryAuth;db=primaryDb;user=originalPrimary;}
   else{
    if(!exactApp(primaryAuth?.app)||![initializeApp,getApps,getAuth,getFirestore].every(value=>typeof value==='function'))throw Error(ownerGuidance);
    const apps=getApps();if(!Array.isArray(apps))throw Error(ownerGuidance);const matches=apps.filter(app=>app?.name===OWNER_APP);if(matches.length>1)throw Error(ownerGuidance);
    const app=matches[0]||initializeApp(firebaseConfig,OWNER_APP);if(app?.name!==OWNER_APP||!exactApp(app))throw Error(ownerGuidance);
    const candidate=getAuth(app);if(typeof candidate?.authStateReady!=='function')throw Error(ownerGuidance);await candidate.authStateReady();current();
    if(!ownerUser(candidate.currentUser))return null;
    auth=candidate;db=getFirestore(app);user=auth.currentUser;
   }
   current();if(!exactApp(auth.app)||db?.app!==auth.app||typeof user.getIdTokenResult!=='function'||typeof user.getIdToken!=='function')throw Error(ownerGuidance);
   const result=await user.getIdTokenResult(true);current();const claims=result?.claims;
   if(claims?.sub!==user.uid||claims.email?.toLowerCase()!==OWNER||claims.email_verified!==true||claims.firebase?.sign_in_provider!=='google.com')throw Error(ownerGuidance);
   return {auth,db,user,current};
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>timer=setTimeout(()=>{retired=true;reject(Error('The Owner connection check is taking too long. Keep the current order and retry when connected.'));},timeoutMs))]);}
  finally{clearTimeout(timer);}
 };
}

export async function resolveCashierProtectedAction(w,{resolveDevice,resolveOwnerDesktop,assertCurrent=()=>{}}={}){
 assertCurrent();const owner=typeof resolveOwnerDesktop==='function'?await resolveOwnerDesktop({assertCurrent}):null;assertCurrent();
 if(!owner){
  let result;try{result=await resolveDevice({action:'check',assertCurrent});assertCurrent();}
  catch(error){assertCurrent();throw Object.assign(Error((error?.message||'This protected action could not confirm the tablet connection.')+' '+ownerGuidance),{code:error?.code,status:error?.status});}
  return checkedWork(w,result,assertCurrent);
 }
 const {auth,db,user}=owner,current=()=>{assertCurrent();owner.current();};current();return checkedWork(w,{api:{auth,db,assertStockAuditCurrent:current},actorUid:user.uid,ownerDesktop:true},current);
}
async function checkedWork(w,result,current){
 const uid=result?.actorUid;if(typeof uid!=='string'||!uid)return result;const deviceId=w.localStorage.getItem('takodeal_device_id');savedWork(w,uid,deviceId);
 if(w.cashierVoidQueue?.list){const queued=await w.cashierVoidQueue.list();current();if(!Array.isArray(queued)||queued.length>2000)throw oldWork();const known=savedWork(w,uid,deviceId);for(const item of queued){const operationId=item.payload?.voidCorrection?.operationId;if(!operationId||!known.has(operationId))throw oldWork(item.payload?.receiptId||item.saleId);}}
 savedWork(w,uid,deviceId);current();return result;
}
