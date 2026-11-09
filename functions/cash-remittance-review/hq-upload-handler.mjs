import {accessId} from './access-model.mjs';
import {uploadIntent,uploadError} from './hq-upload-model.mjs';
const origins=['https://takodeal-owner.vercel.app','https://takodeal-franchise.vercel.app'];
export function createHQUploadHandler({verifyToken,store,now=Date.now}={}){
 if(typeof verifyToken!=='function'||typeof store?.grant!=='function')throw Error('Trusted attachment verification is required.');
 // A warm-instance request bound also counts denied and repeated intents. The
 // store separately enforces the shared persistent cap on new grants.
 let minute=-1,total=0;const users=new Map(),ips=new Map();
 const requestBudget=(actor,request)=>{const slot=Math.floor(now()/60000);if(slot!==minute){minute=slot;total=0;users.clear();ips.clear();}const ip=typeof request.trustedIP==='string'&&request.trustedIP.length<=200?request.trustedIP:null;if(total>=1200||(users.get(actor.uid)||0)>=120||ip&&(ips.get(ip)||0)>=300)throw uploadError(429,'hq-upload/request-rate','Too many attachment checks. Wait a minute and retry the same file.');total++;users.set(actor.uid,(users.get(actor.uid)||0)+1);if(ip)ips.set(ip,(ips.get(ip)||0)+1);};
 return async request=>{const origin=origins.includes(request.origin)?request.origin:null,headers={'Cache-Control':'no-store',Pragma:'no-cache',Vary:'Origin','Content-Type':'application/json; charset=utf-8',...(origin?{'Access-Control-Allow-Origin':origin}:{})},reply=(status,body)=>({status,headers,body});
  try{
   if(!origin||request.path!=='/hq-upload/grant')throw uploadError(403,'hq-upload/origin','Use the approved workspace.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(key=>!['authorization','content-type'].includes(key)))throw uploadError(403,'hq-upload/preflight','Use the approved workspace.');return{...reply(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}};}
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>4096||Buffer.byteLength(JSON.stringify(request.body||null))>4096)throw uploadError(400,'hq-upload/request','Reopen the exact attachment.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)throw uploadError(401,'hq-upload/sign-in','Sign in again before attaching a file.');
   let actor;try{actor=await verifyToken(token,true);}catch{throw uploadError(401,'hq-upload/sign-in','Sign in again before attaching a file.');}
   if(!accessId(actor?.uid)||actor.firebase?.sign_in_provider!=='google.com'||actor.email_verified!==true||typeof actor.email!=='string'||!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(actor.email))throw uploadError(403,'hq-upload/identity','Use your approved Google workspace account.');
   requestBudget(actor,request);
   return reply(200,await store.grant(uploadIntent(request.body),actor));
  }catch(error){return reply(error.status||503,{code:error.status?error.code:'hq-upload/unavailable',message:error.status?error.message:'The attachment permission could not be confirmed. Reconnect and retry.'});}
 };
}
