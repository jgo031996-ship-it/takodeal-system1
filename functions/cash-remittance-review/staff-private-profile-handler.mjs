import {PRIVATE_PROFILE_ORIGIN,PrivateProfileError,profileId,profileIntent,profileError} from './staff-private-profile-model.mjs';
export function createStaffPrivateProfileHandler({verifyToken,store}={}){
 if(typeof verifyToken!=='function'||typeof store?.read!=='function'||typeof store?.update!=='function'||typeof store?.rate!=='function')throw Error('Trusted private Staff profile dependencies are required.');
 let minute=-1,total=0;const users=new Map(),ips=new Map();
 return async request=>{
  const origin=request.origin===PRIVATE_PROFILE_ORIGIN,headers={'Cache-Control':'no-store',Pragma:'no-cache',Vary:'Origin','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':PRIVATE_PROFILE_ORIGIN}:{})},reply=(status,body)=>({status,headers,body});
  try{
   if(!origin||!['/staff-private-profile/read','/staff-private-profile/update','/staff-private-profile/vault-settings','/staff-private-profile/vault-save'].includes(request.path))throw profileError(403,'origin','Open your profile in the approved Staff app.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(value=>!['authorization','content-type'].includes(value)))throw profileError(403,'preflight','Use the approved Staff app.');return{...reply(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}};}
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>16384||Buffer.byteLength(JSON.stringify(request.body??null))>16384)throw profileError(400,'request','Reopen your private profile.');
   const kind=request.path.slice('/staff-private-profile/'.length),method={'read':'read','update':'update','vault-settings':'vaultSettings','vault-save':'vaultSave'}[kind],input=profileIntent(kind,request.body),token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)throw profileError(401,'sign-in','Reconnect your personally approved Staff phone.');
   let actor;try{actor=await verifyToken(token,true);}catch{throw profileError(401,'sign-in','Sign in again on your personally approved Staff phone.');}
   if(!profileId(actor?.uid)||actor.firebase?.sign_in_provider!=='anonymous')throw profileError(403,'approval','Use your personally approved private Staff phone.');
   const slot=Math.floor(Date.now()/60000);if(slot!==minute){minute=slot;total=0;users.clear();ips.clear();}const ip=typeof request.trustedIP==='string'&&request.trustedIP.length<=200?request.trustedIP:null;if(total>=600||(users.get(actor.uid)||0)>=60||ip&&(ips.get(ip)||0)>=120)throw profileError(429,'rate','Too many profile checks. Wait a minute and retry.');total++;users.set(actor.uid,(users.get(actor.uid)||0)+1);if(ip)ips.set(ip,(ips.get(ip)||0)+1);
   await store.rate(actor.uid);return reply(200,await store[method](input,actor));
  }catch(error){const known=error instanceof PrivateProfileError&&[400,401,403,409,429,503].includes(error.status);return reply(known?error.status:503,{code:known?error.code:'staff-private-profile/unavailable',message:known?error.message:'Your private profile could not be confirmed. Reconnect and retry the same action.'});}
 };
}
