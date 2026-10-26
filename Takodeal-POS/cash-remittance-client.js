import {createScheduleProposalDeviceGate,createScheduleProposalSession} from './cashier-schedule-proposals.js';
export const CASH_REMITTANCE_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const key=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(x);
const canonical=x=>JSON.stringify(x,(_k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function hasPendingCashRemittance(storage,branch){
 if(!branch)return false;if(!storage||typeof storage.key!=='function'||!Number.isSafeInteger(storage.length)||storage.length<0||storage.length>10000)throw Error('The saved cash transfer list could not be checked. Open cash remittance for review.');
 for(let i=0;i<storage.length;i++){const name=storage.key(i);if(typeof name!=='string'||!name.startsWith('takodeal_cash_remittance_v4:'))continue;let saved,actor;try{saved=JSON.parse(storage.getItem(name));actor=JSON.parse(saved.actor);}catch{return true;}if(!Array.isArray(actor)||actor.length!==3||typeof actor[2]!=='string')return true;if(actor[2]===branch)return true;}return false;
}
export async function assertCashRecordsReady(w,actor,{timeoutMs=20000}={}){
 const check=()=>{actor.assertCurrent();if(w.navigator?.onLine===false)throw Error('Reconnect and upload pending sales before counting drawer cash.');if(w.isProcessingOrder||w.isSubmittingOrder||w.isSyncing)throw Error('Wait for checkout and receipt uploads to finish before counting cash.');};
 check();if(typeof w.getPendingSales!=='function')throw Error('The saved sales queue is not ready. Finish loading the Cashier app, then check the drawer again.');
 let timer;try{const rows=await Promise.race([Promise.resolve().then(()=>w.getPendingSales()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The pending sales queue could not be confirmed. Keep this count open and try again.')),timeoutMs);})]);check();if(!Array.isArray(rows))throw Error('The pending sales queue could not be verified.');if(rows.some(row=>{const payload=row?.payload||row;return !payload?.branch||payload.branch===actor.branch;}))throw Error('Upload or reconcile this branch’s pending sales before counting cash. Open Sales awaiting upload to check them.');return true;}finally{clearTimeout(timer);}
}
export function createCashierCashClient({auth,fetcher=globalThis.fetch,timeoutMs=25000}={}){
 return {call(route,body,{uid,assertCurrent=()=>{}}={}){
  if(!['/quote','/submit','/history','/status','/cancel'].includes(route))throw Error('Unsupported cash action.');
  const controller=new AbortController();let expired=false,timer;
  const guard=()=>{assertCurrent();if(expired)throw Error('HQ has not confirmed this cash action. Keep the original details and retry.');if(auth?.currentUser?.uid!==uid||auth.currentUser.isAnonymous!==true)throw Error('The tablet account changed. Reopen cash remittance.');};
  const work=(async()=>{guard();const token=await auth.currentUser.getIdToken();guard();if(typeof token!=='string'||token.length<20)throw Error('Reconnect this approved Cashier tablet.');
   const r=await fetcher(CASH_REMITTANCE_ENDPOINT+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:controller.signal,cache:'no-store',redirect:'error',credentials:'omit'});guard();const result=await r.json();guard();
   if(!r.ok){const e=Error(typeof result?.message==='string'?result.message.slice(0,600):'HQ has not confirmed this cash action.');e.code=result?.code;e.status=r.status;throw e;}
   if(!object(result))throw Error('HQ returned an unconfirmed cash result. Keep the original transfer details.');return result;
  })();return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(Error('HQ has not confirmed this cash action yet. Keep the original transfer details and retry.'));},timeoutMs);})]).finally(()=>clearTimeout(timer));
 }};
}
export function createCashRemittanceAttempts(storage,{makeId=()=>crypto.randomUUID()}={}){
 const path=actor=>'takodeal_cash_remittance_v4:'+encodeURIComponent(canonical([actor.uid,actor.staffId,actor.branch]));
 function pending(actor){const raw=storage.getItem(path(actor));if(!raw)return null;let row;try{row=JSON.parse(raw);}catch{throw Error('The saved cash transfer needs Owner review. Keep this device data.');}if(!object(row)||!key(row.operationId)||row.actor!==canonical([actor.uid,actor.staffId,actor.branch])||!object(row.body)||row.body.operationId!==row.operationId||'pin'in row.body||row.fingerprint!==canonical(row.body))throw Error('The saved cash transfer could not be verified. Ask the Owner to review it.');return row;}
 return {pending,prepare(actor,input,snapshot){const body={...input};delete body.pin;const prior=pending(actor);if(prior){if(canonical({...body,operationId:prior.operationId})!==prior.fingerprint)throw Error('An earlier transfer is awaiting confirmation. Retry its original details first.');return prior;}const operationId=makeId();if(!key(operationId))throw Error('A secure transfer number could not be created.');body.operationId=operationId;const row={version:4,actor:canonical([actor.uid,actor.staffId,actor.branch]),operationId,body,fingerprint:canonical(body),snapshot,createdAt:new Date().toISOString()};storage.setItem(path(actor),JSON.stringify(row));if(storage.getItem(path(actor))!==JSON.stringify(row))throw Error('This device could not preserve the transfer number. Keep the form open.');return row;},complete(actor,operationId){if(pending(actor)?.operationId===operationId)storage.removeItem(path(actor));}};
}
export function createCashRemittanceDeviceSession(w,{primaryAuth,signInAnonymously,deviceGate}={}){
 const session=createScheduleProposalSession(w,primaryAuth),gate=deviceGate||createScheduleProposalDeviceGate({api:w,auth:primaryAuth,signInAnonymously});
 return {async check(request=false){const permit=session.captureStaff(),result=await gate.check({permit,request});permit.assertCurrent();return result;},capture:()=>session.capture()};
}
