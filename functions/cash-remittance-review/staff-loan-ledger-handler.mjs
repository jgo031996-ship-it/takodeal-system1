export const STAFF_LOAN_ORIGIN='https://takodeal-staff.vercel.app';
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const device=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
export function createStaffLoanLedgerHandler({verifyToken,store}={}){
 if(typeof verifyToken!=='function'||typeof store?.read!=='function')throw Error('Verified private Staff loan access is required.');
 return async request=>{
  const allowed=request.origin===STAFF_LOAN_ORIGIN;
  const headers={'Cache-Control':'no-store',Pragma:'no-cache','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',Vary:'Origin',...(allowed?{'Access-Control-Allow-Origin':STAFF_LOAN_ORIGIN}:{})};
  const response=(status,body)=>({status,headers,body});
  try{
   if(!allowed)fail(403,'staff-loans/origin','Open your loan ledger in the approved Staff app.');
   if(request.path!=='/staff-loan-ledger')fail(404,'staff-loans/route','This Staff action is unavailable.');
   if(request.method==='OPTIONS'){
    if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(value=>!['authorization','content-type'].includes(value)))fail(403,'staff-loans/preflight','Use the approved Staff app.');
    return{...response(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};
   }
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||''))fail(400,'staff-loans/request','Reopen your private loan ledger.');
   const body=request.body;
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='deviceId,staffId'||!key(body.staffId)||!device(body.deviceId)||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>2048||Buffer.byteLength(JSON.stringify(body))>2048)fail(400,'staff-loans/request','The private loan request is incomplete.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];
   if(!token)fail(401,'staff-loans/sign-in','Reconnect your personally approved Staff phone.');
   let actor;try{actor=await verifyToken(token,true);}catch{fail(401,'staff-loans/sign-in','Sign in again on your personally approved Staff phone.');}
   if(!key(actor?.uid)||actor.firebase?.sign_in_provider!=='anonymous')fail(403,'staff-loans/approval','Use your personally approved Staff phone.');
   await store.rate?.(actor.uid);
   return response(200,await store.read({uid:actor.uid,...body}));
  }catch(error){return response(error.status||503,{code:error.code||'staff-loans/unavailable',message:error.status?error.message:'Your saved loan ledger could not be confirmed. Reconnect and try again; no balance has been estimated.'});}
 };
}
