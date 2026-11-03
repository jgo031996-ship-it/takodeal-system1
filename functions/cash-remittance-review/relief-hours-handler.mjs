import {createReliefScheduleReviewService} from './relief-core/relief-schedule-review.js';
import {readStaffRecords} from './relief-core/attendance-reconcile.js';
export const RELIEF_OWNER_ORIGIN='https://takodeal-owner.vercel.app',RELIEF_MAX_BYTES=131072;
const owner='jgo031996@gmail.com',routes=new Set(['/relief-hours/inspect','/relief-hours/confirm']),object=v=>v&&typeof v==='object'&&!Array.isArray(v),fields=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const contextKeys=['attendanceLogId','staffId','staffName','branch','from','to','workDate','requestId'];
const inputKeys=['context','expectedFingerprint','expectedRevision','workDate','startTime','endTime','shiftType','shiftName','choice','reason'];
const error=(status,code,message)=>Object.assign(Error(message),{status,code});
export function createReliefHoursHandler({verifyToken,store}={}){
 if(typeof verifyToken!=='function'||typeof store?.transaction!=='function')throw Error('Trusted Owner verification and attendance transactions are required.');
 return async request=>{
  const origin=request.origin,response=(status,body)=>({status,body,headers:{'Cache-Control':'no-store','Content-Type':'application/json','X-Takodeal-Relief-Version':'1',Vary:'Origin',...(origin===RELIEF_OWNER_ORIGIN?{'Access-Control-Allow-Origin':origin}:{})}});
  try{
   if(origin!==RELIEF_OWNER_ORIGIN)throw error(403,'owner-origin-required','Open the approved Owner app to review emergency-cover hours.');
   if(!routes.has(request.path))throw error(404,'route-unavailable','This emergency-review action is unavailable.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(s=>s.trim().toLowerCase()).some(s=>!['authorization','content-type'].includes(s)))throw error(403,'preflight-unavailable','This request is outside the approved Owner app.');return {...response(204,null),headers:{...response(204,null).headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};}
   if(request.method!=='POST')throw error(405,'method-unavailable','Use the Owner app review action.');
   if(!/^application\/json(?:;|$)/i.test(request.contentType||'')||Object.keys(request.query||{}).length||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>RELIEF_MAX_BYTES)throw error(400,'invalid-request','The emergency-review request is incomplete or too large.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)throw error(401,'owner-token-required','Sign in again with the verified Owner account.');let actor;try{actor=await verifyToken(token,true);}catch{throw error(401,'owner-token-required','The Owner account could not be confirmed. Sign in again.');}
   if(!/^[-A-Za-z0-9_]{1,180}$/.test(actor?.uid||'')||actor.email?.toLowerCase()!==owner||actor.email_verified!==true||actor.firebase?.sign_in_provider!=='google.com')throw error(403,'owner-auth-required','Only the verified Google Owner may confirm assigned hours.');
   const inspect=request.path.endsWith('/inspect'),body=request.body;if(!fields(body,inspect?['context']:inputKeys)||!fields(body.context,contextKeys)||typeof body.context.attendanceLogId!=='string'||Object.values(body.context).some(v=>typeof v!=='string'||v.length>200)||!inspect&&(typeof body.expectedFingerprint!=='string'||body.expectedFingerprint.length>100000||!Number.isSafeInteger(body.expectedRevision)||typeof body.reason!=='string'||body.reason.length>1500||['workDate','startTime','endTime','shiftType','shiftName','choice'].some(key=>typeof body[key]!=='string'||body[key].length>200)))throw error(400,'invalid-request','Reopen the exact emergency-cover record and review its assigned hours.');
   await store.rateOwner?.(actor.uid);const result=await store.transaction(async io=>{
    const api={...io,auth:{currentUser:{uid:actor.uid,email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:actor.uid,email:owner,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true};
    const service=createReliefScheduleReviewService(api,{readAttendance:(start,profile)=>readStaffRecords(api,start.staffId,profile.cashierName,{metadataOnly:false})});return inspect?service.inspect(body.context):service.save(body);
   });return response(200,result);
  }catch(e){return response(e.status||409,{code:e.code||'relief-review-not-confirmed',message:e.status?e.message:e.message||'The emergency-review outcome could not be confirmed. Refresh these same records before retrying.'});}
 };
}
