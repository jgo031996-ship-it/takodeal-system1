export const RIDER_ACCESS_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/rider-access';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value),unknown='Rider access was not confirmed. Reconnect and retry the same sign-in or saved application.';
export const riderAccessCanonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export function createRiderAccessClient(api,{fetch=api.fetch?.bind(api)||globalThis.fetch,timeoutMs=30000,makeId=()=> 'rider-session-'+(api.crypto||globalThis.crypto).randomUUID(),now=Date.now}={}){
 const credentials=new Map(),cancelled=new Set(),cancelling=new Map();
 async function revoke(sessionId){
  cancelled.add(sessionId);const entry=credentials.get(sessionId);if(!entry)return true;
  if(cancelling.has(sessionId))return cancelling.get(sessionId);
  const work=(async()=>{const controller=new AbortController();let timer;
   try{
    const request=(async()=>{const token=api.auth?.currentUser===entry.user?await entry.user.getIdToken():entry.token;
     if(controller.signal.aborted)throw Error(unknown);
     const response=await fetch(RIDER_ACCESS_ENDPOINT+'/logout',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sessionId}),cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
     const result=await response.json();if(!response.ok||result?.loggedOut!==true)throw Error(unknown);return true;})();
    await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(unknown));},10000);})]);
    credentials.delete(sessionId);return true;
   }finally{clearTimeout(timer);}
  })();
  cancelling.set(sessionId,work);work.finally(()=>{if(cancelling.get(sessionId)===work)cancelling.delete(sessionId);}).catch(()=>{});return work;
 }
 async function post(route,body,{assertCurrent=()=>{},cancelOnTimeout=true}={}){
  const user=api.auth?.currentUser,uid=user?.uid,sessionId=body.sessionId;if(!id(uid)||typeof user.getIdToken!=='function'||!id(sessionId))throw Error('Reconnect to the Rider sign-in service.');
  const current=()=>{if(api.auth?.currentUser!==user||api.auth.currentUser.uid!==uid||cancelled.has(sessionId))throw Error('This Rider sign-in was cancelled or the account changed.');assertCurrent();};
  const controller=new AbortController();let timer;
  const work=(async()=>{current();const token=await user.getIdToken();if(typeof token!=='string'||token.length<20)throw Error('Reconnect to the Rider sign-in service.');credentials.set(sessionId,{uid,user,token});try{current();}catch(error){await revoke(sessionId).catch(()=>{});throw error;}if(controller.signal.aborted){await revoke(sessionId).catch(()=>{});throw Error(unknown);}const response=await fetch(RIDER_ACCESS_ENDPOINT+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});let result;try{result=await response.json();}catch{throw Error(unknown);}try{current();}catch(error){await revoke(sessionId).catch(()=>{});throw error;}if(!response.ok)throw Object.assign(Error(typeof result?.message==='string'?result.message.slice(0,1000):unknown),{status:response.status,code:result?.code});if(!result||typeof result!=='object'||Array.isArray(result))throw Error(unknown);return result;})();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();if(cancelOnTimeout)void revoke(sessionId).catch(()=>{});reject(Object.assign(Error(unknown),{code:'rider-access/timeout'}));},timeoutMs);})]);}finally{clearTimeout(timer);}
 }
 function checked(result,sessionId){const session=result.session,rider=result.rider;if(!session||session.schemaVersion!==1||session.uid!==api.auth?.currentUser?.uid||session.sessionId!==sessionId||!id(session.riderId)||!Number.isSafeInteger(session.riderAuthRevision)||session.riderAuthRevision<1||!Number.isFinite(Date.parse(session.expiresAt))||Date.parse(session.expiresAt)<=now()||Date.parse(session.expiresAt)>now()+9*60*60*1000||!rider||rider.id!==session.riderId||rider.riderAuthRevision!==session.riderAuthRevision||rider.riderPinManaged!==true||['pin','verifier','registrationFingerprint','registrationUid'].some(key=>Object.hasOwn(rider,key)))throw Error(unknown);return result;}
 return {
  newSession:()=>makeId(),cancel:revoke,
  async receipt({orderId,sessionId,assertCurrent}){if(!id(orderId))throw Error('Choose an exact delivery.');const result=await post('/receipt-check',{orderId,sessionId},{assertCurrent,cancelOnTimeout:false});if(!id(result.id)||typeof result.receiptId!=='string'||typeof result.branch!=='string'||Object.keys(result).sort().join(',')!=='branch,id,receiptId')throw Error(unknown);return result;},
  async login(values,{sessionId=makeId(),assertCurrent}={}){try{return checked(await post('/login',{phone:values.phone,pin:values.pin,sessionId},{assertCurrent}),sessionId);}catch(error){void revoke(sessionId).catch(()=>{});throw error;}},
  async preflight(values,{sessionId,assertCurrent}={}){try{const result=await post('/registration-check',{registrationId:values.registrationId,phone:values.phone,pin:values.pin,fingerprint:values.fingerprint,sessionId},{assertCurrent});if(result.available!==true||result.registrationId!==values.registrationId)throw Error(unknown);return result.alreadyRegistered?checked(result,sessionId):result;}catch(error){void revoke(sessionId).catch(()=>{});throw error;}},
  async register(values,{sessionId,assertCurrent}={}){try{return checked(await post('/register',{...values,sessionId},{assertCurrent}),sessionId);}catch(error){void revoke(sessionId).catch(()=>{});throw error;}}
 };
}
