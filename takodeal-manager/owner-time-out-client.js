import {canCorrectOwnerTimeOut} from './owner-time-out-correction.js';

export const OWNER_TIME_OUT_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/owner-time-out';
const unknown='HQ has not confirmed the result. Refresh saved attendance or retry these same details. Do not record a second departure.';
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\/\\\0]/.test(value);
const validTime=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const wireContext=context=>Object.fromEntries(['attendanceLogId','staffId','staffName','branch','requestId','cutoffStart','cutoffEnd','from','to'].filter(field=>typeof context?.[field]==='string'&&context[field]).map(field=>[field,context[field]]));
const identity=api=>{
 if(!canCorrectOwnerTimeOut(api))throw Error('Sign in and unlock the verified Owner account first.');
 const user=api.auth.currentUser;
 return JSON.stringify([user.uid,user.email,user.emailVerified,api.sessionUser.uid,api.sessionUser.email,api.sessionUser.allowedBranches,api.sessionUser.permissions]);
};
export function createOwnerTimeOutClient(api,{fetch=globalThis.fetch,timeoutMs=45000}={}){
 const pending=new Map(),uncertain=new Map();
 const slot=(key,context)=>key+'|'+(context.requestId||context.attendanceLogId);
 const guard=key=>{if(identity(api)!==key)throw Error('The Owner account changed. Reopen this review.');};
 async function exchange(route,input,key){
  const controller=new AbortController();let timer;
  const work=(async()=>{
   guard(key);const user=api.auth.currentUser,token=await user.getIdToken();guard(key);
   if(controller.signal.aborted)throw Error(unknown);
   if(user!==api.auth.currentUser||typeof token!=='string'||token.length<20)throw Error('Sign in again to verify the Owner account.');
   const response=await fetch(OWNER_TIME_OUT_ENDPOINT+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal,redirect:'error',cache:'no-store',credentials:'omit'});
   guard(key);let result;try{result=await response.json();}catch{throw Error(unknown);}guard(key);
   if(!response.ok)throw Object.assign(Error(typeof result?.message==='string'?result.message.slice(0,1000):unknown),{code:result?.code,status:response.status});
   if(!result||typeof result!=='object'||Array.isArray(result))throw Error(unknown);
   return result;
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error(unknown),{code:'owner-time-out/pending'}));},timeoutMs);})]);}
  finally{clearTimeout(timer);}
 }
 return {
  isSaving:()=>pending.size>0,
  async inspect(context){
   const key=identity(api);if(!canCorrectOwnerTimeOut(api,context.branch))throw Error('Owner access to this branch is required.');const view=await exchange('/inspect',{context:wireContext(context)},key);
   if(!validId(view.context?.attendanceLogId)||!validId(view.staffId)||view.context.staffId!==view.staffId||view.context.branch!==view.branch||typeof view.branch!=='string'||!canCorrectOwnerTimeOut(api,view.branch)||typeof view.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(view.expectedFingerprint)||!Array.isArray(view.paidCutoffs)||typeof view.canSave!=='boolean'||!validTime(view.timeInAt))throw Error(unknown);
   if(context.attendanceLogId&&context.attendanceLogId!==view.context.attendanceLogId||context.requestId&&context.requestId!==view.context.requestId)throw Error(unknown);
   for(const field of ['staffId','staffName','branch'])if(context[field]&&view.context[field]!==context[field])throw Error(unknown);
   if(view.existingTimeOut&&(!validId(view.existingTimeOut.id)||!validTime(view.existingTimeOut.timestamp)))throw Error(unknown);
   const id=slot(key,context),held=uncertain.get(id);
   if(held&&(view.lastOperationId||view.existingTimeOut?.operationId)===held.operationId)uncertain.delete(id);
   return view;
  },
  save(input){
   const key=identity(api);if(!canCorrectOwnerTimeOut(api,input.context?.branch))return Promise.reject(Error('Owner access to this branch is required.'));const id=slot(key,input.context),intent=JSON.stringify(input),old=pending.get(id),held=uncertain.get(id);
   if(old)return old.intent===intent?old.promise:Promise.reject(Error('Wait for the current correction, then refresh saved attendance.'));
   if(held&&held.intent!==intent)return Promise.reject(Error('An earlier correction has an unknown result. Retry the same confirmed details or refresh its saved result before changing them.'));
   const promise=(async()=>{
    try{
     const result=await exchange('/confirm',{...input,context:wireContext(input.context)},key);
     if(!(result.saved===true||result.alreadySaved===true)||!validId(result.id)||!validId(result.auditId)||!validTime(result.timestamp)||result.operationId!==input.operationId||Date.parse(result.timestamp)!==Date.parse(input.dateTimeRaw+'+08:00')||result.staffId!=null&&result.staffId!==input.context.staffId||result.branch!=null&&result.branch!==input.context.branch)throw Error(unknown);
     uncertain.delete(id);return result;
    }catch(error){
     // An HTTP validation failure is a known rejection. A lost response may
     // still have committed, so only the same operation may be retried.
     if(!Number.isInteger(error.status))uncertain.set(id,{intent,operationId:input.operationId});
     throw error;
    }
   })();
   pending.set(id,{intent,promise});promise.finally(()=>{if(pending.get(id)?.promise===promise)pending.delete(id);}).catch(()=>{});return promise;
  }
 };
}
