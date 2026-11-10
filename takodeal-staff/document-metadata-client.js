import {trustedDocumentBroker} from './staff-document-broker.js';
export const DOCUMENT_METADATA_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/document-metadata';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const failure=status=>Object.assign(Error(status===401?'Sign in again before updating this private document.':status===403?'Private document access changed. Ask HQ to review this phone or account.':status===409?'This document changed. Refresh the profile before continuing.':'The private document update was not confirmed. Reconnect and retry the same photo or review.'),{code:'document-metadata/'+(status===401?'sign-in':status===403?'permission-denied':status===409?'changed':'unavailable')});
const keys=(value,list)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
export function createDocumentMetadataClient({auth,identity,fetchFn=globalThis.fetch,timeoutMs=35000}={}){
 if(typeof fetchFn!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)throw failure(503);
 async function post(config,kind,input,{assertCurrent=()=>{}}={}){
  trustedDocumentBroker(config);const user=auth?.currentUser,staffId=input?.staffId;
  if(!id(staffId)||identity?.()!==staffId||!id(user?.uid)||typeof user.getIdToken!=='function')throw failure(401);
  if(!['valid_id','health_card','clearance'].includes(input.group)||!id(input.uploadId)||!hash(input.sha256)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<(kind==='upload'?0:1)||input.expectedVersion>=Number.MAX_SAFE_INTEGER)throw failure(409);
  const controller=new AbortController();let timer,expired=false;
  const guard=()=>{if(expired||controller.signal.aborted)throw failure(503);assertCurrent();if(auth.currentUser!==user||identity()!==staffId)throw Error('Your account changed. Open the profile again.');};
  const operation=Promise.resolve().then(async()=>{
   guard();let token;try{token=await user.getIdToken();}catch{guard();throw failure(401);}guard();if(typeof token!=='string'||!token)throw failure(401);
   const body=JSON.stringify(input);if(body.length>4096)throw failure(409);let response;
   try{response=await fetchFn(DOCUMENT_METADATA_ENDPOINT+'/'+kind,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});}catch{guard();throw failure(503);}guard();
   if(response.redirected||['opaque','opaqueredirect'].includes(response.type)||response.url&&response.url!==DOCUMENT_METADATA_ENDPOINT+'/'+kind)throw failure(503);
   if(!response.ok)throw failure(response.status);if(response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw failure(503);
   const length=response.headers?.get('content-length');if(length!=null&&(!/^\d+$/.test(length)||Number(length)>4096))throw failure(503);
   let bytes;
   if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const part=await reader.read();guard();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();throw failure(503);}chunks.push(part.value);}}finally{reader.releaseLock?.();}bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}}
   else{bytes=new Uint8Array(await response.arrayBuffer());guard();if(bytes.length>4096)throw failure(503);}
   let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw failure(503);}guard();
   const expected=['staffId','group','uploadId','version','alreadySaved',...(kind==='review'?['reviewId','status']:[])];
   if(!keys(result,expected)||result.staffId!==staffId||result.group!==input.group||result.uploadId!==input.uploadId||!Number.isSafeInteger(result.version)||result.version<input.expectedVersion+1||typeof result.alreadySaved!=='boolean'||!result.alreadySaved&&result.version!==input.expectedVersion+1||kind==='review'&&(result.version!==input.expectedVersion+1||result.reviewId!==input.reviewId||result.status!==input.status))throw failure(409);
   return result;
  });
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(failure(503));},timeoutMs);})]);}finally{clearTimeout(timer);controller.abort();}
 }
 return{upload:(config,input,options)=>post(config,'upload',input,options),review:(config,input,options)=>post(config,'review',input,options)};
}
