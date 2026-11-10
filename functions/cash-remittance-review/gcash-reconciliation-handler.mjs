import {accessId,isAccessOwner} from './access-model.mjs';
import {reconciliationError,reconciliationSettingsInput,reconciliationVerifyInput} from './gcash-reconciliation-model.mjs';
const ORIGIN='https://takodeal-owner.vercel.app';
export function createGCashReconciliationHandler({verifyToken,store,now=Date.now}={}){
 if(typeof verifyToken!=='function'||typeof store?.saveSettings!=='function'||typeof store?.verify!=='function')throw Error('Trusted reconciliation authentication and storage are required.');
 let minute=-1,total=0;const users=new Map(),ips=new Map();
 function budget(actor,request){
  const slot=Math.floor(now()/60000);if(slot!==minute){minute=slot;total=0;users.clear();ips.clear();}
  const ip=typeof request.trustedIP==='string'&&request.trustedIP.length<=200?request.trustedIP:null;
  if(total>=600||(users.get(actor.uid)||0)>=120||ip&&(ips.get(ip)||0)>=240)throw reconciliationError(429,'request-rate','Too many reconciliation requests. Wait a minute before retrying this preview.');
  total++;users.set(actor.uid,(users.get(actor.uid)||0)+1);if(ip)ips.set(ip,(ips.get(ip)||0)+1);
 }
 return async request=>{
  const allowed=request.origin===ORIGIN,headers={'Cache-Control':'no-store',Pragma:'no-cache','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',Vary:'Origin',...(allowed?{'Access-Control-Allow-Origin':ORIGIN}:{})},reply=(status,body)=>({status,headers,body});
  try{
   if(!allowed)throw reconciliationError(403,'origin','Open reconciliation in the approved Owner app.');
   if(!['/gcash-reconciliation/settings','/gcash-reconciliation/verify'].includes(request.path))throw reconciliationError(404,'route','This reconciliation action is unavailable.');
   if(request.method==='OPTIONS'){
    if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(key=>!['authorization','content-type'].includes(key)))throw reconciliationError(403,'preflight','Use the approved Owner app.');
    return{...reply(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};
   }
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>2*1024*1024||Buffer.byteLength(JSON.stringify(request.body||null))>2*1024*1024)throw reconciliationError(400,'request','Reopen the exact saved statement preview.');
   const body=request.path.endsWith('/settings')?reconciliationSettingsInput(request.body):reconciliationVerifyInput(request.body);
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)throw reconciliationError(401,'sign-in','Sign in again before verifying a statement.');
   let actor;try{actor=await verifyToken(token,true);}catch{throw reconciliationError(401,'sign-in','Sign in again before verifying a statement.');}
   if(!accessId(actor?.uid)||!isAccessOwner(actor))throw reconciliationError(403,'identity','Unlock the verified Owner Google account before reconciling payments.');
   budget(actor,request);await store.rate?.(actor.uid);
   return reply(200,await (request.path.endsWith('/settings')?store.saveSettings(body,actor):store.verify(body,actor)));
  }catch(error){return reply(error.status||503,{code:error.status?error.code:'gcash-reconciliation/unavailable',message:error.status?error.message:'Verification has not been confirmed. Retry this exact preview to check its saved result.'});}
 };
}
