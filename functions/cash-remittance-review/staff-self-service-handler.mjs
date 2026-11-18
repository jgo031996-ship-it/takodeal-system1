import {PrivateProfileError,profileError,profileId} from './staff-private-profile-model.mjs';
export function createStaffSelfServiceHandler({verifyToken,sessions,hiring,rate}={}){
 const routes={login:[sessions,'login'],status:[sessions,'status'],logout:[sessions,'logout'],'hire-create':[hiring,'create'],'hire-preview':[hiring,'preview'],'hire-submit':[hiring,'submit'],contract:[hiring,'contract']};
 return async request=>{
  const allowed=['https://takodeal-staff.vercel.app','https://takodeal-owner.vercel.app'].includes(request.origin),headers={'Cache-Control':'no-store',Pragma:'no-cache',Vary:'Origin','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',...(allowed?{'Access-Control-Allow-Origin':request.origin}:{})},reply=(status,body)=>({status,headers,body});
  try{
   const key=request.path?.replace('/staff-self-service/',''),route=Object.hasOwn(routes,key)?routes[key]:null;
   if(!allowed||!route||request.origin==='https://takodeal-owner.vercel.app'&&!['hire-create','contract'].includes(key))throw profileError(403,'origin','Open the approved Staff or Owner app.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).some(v=>!['authorization','content-type'].includes(v)))throw profileError(403,'origin','Use the approved app.');return{...reply(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}};}
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>150000||Buffer.byteLength(JSON.stringify(request.body??null))>150000)throw profileError(400,'request','Check the form and retry.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];let actor;
   try{if(!token)throw Error();actor=await verifyToken(token,true);if(!profileId(actor.uid))throw Error();}catch{throw profileError(401,'sign-in','Reconnect and sign in again.');}
   await rate(actor.uid);return reply(200,await route[0][route[1]](request.body,actor,request.trustedIP));
  }catch(error){const known=error instanceof PrivateProfileError;return reply(known?error.status:503,{code:known?error.code:'staff-private-profile/unavailable',message:known?error.message:'The save could not be confirmed. Keep this form open and retry the same submission.'});}
 };
}
