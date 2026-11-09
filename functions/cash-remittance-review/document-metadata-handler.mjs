import {DOCUMENT_IMAGE_ENDPOINT,DocumentMetadataError,documentId,documentError,documentUploadIntent,documentReviewIntent} from './document-metadata-model.mjs';
const origins=['https://takodeal-staff.vercel.app','https://takodeal-owner.vercel.app'];
const unavailable=()=>documentError(503,'unavailable','The private document update could not be confirmed. Reconnect and retry the same action.');
export function createDocumentAttestation({fetchFn=globalThis.fetch,timeoutMs=20000}={}){
 if(typeof fetchFn!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)throw Error('A bounded private image attestation transport is required.');
 return async({kind,input,inspection,token,origin})=>{
  if(!origins.includes(origin)||typeof token!=='string'||!token||!['upload','review'].includes(kind))throw unavailable();
  const body=kind==='upload'?{purpose:'upload',...input}:{purpose:'review',staffId:input.staffId,group:input.group,uploadId:input.uploadId,version:inspection?.record?.version,sha256:input.sha256};
  const controller=new AbortController();let timer;
  const work=(async()=>{
   let response;try{response=await fetchFn(DOCUMENT_IMAGE_ENDPOINT+'/attest',{method:'POST',redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}catch{throw unavailable();}
   if(controller.signal.aborted||!response||response.redirected||response.url&&response.url!==DOCUMENT_IMAGE_ENDPOINT+'/attest')throw unavailable();
   if(!response.ok){await response.body?.cancel?.();if([400,401,403,409].includes(response.status))throw documentError(response.status,response.status===409?'changed':response.status===403?'permission-denied':response.status===401?'sign-in':'invalid-request','Private document verification changed. Reconnect and refresh its exact record.');throw unavailable();}
   if(response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw unavailable();
   const length=response.headers?.get('content-length');if(length!=null&&(!/^\d+$/.test(length)||Number(length)>8192))throw unavailable();
   let text='';
   if(response.body?.getReader){const reader=response.body.getReader();let bytes=0;const decoder=new TextDecoder();try{while(true){const next=await reader.read();if(controller.signal.aborted)throw unavailable();if(next.done)break;bytes+=next.value.length;if(bytes>8192){await reader.cancel();throw unavailable();}text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock?.();}}
   else{const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>8192)throw unavailable();text=new TextDecoder().decode(bytes);}
   if(controller.signal.aborted)throw unavailable();try{return JSON.parse(text);}catch{throw unavailable();}
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},timeoutMs);})]);}finally{clearTimeout(timer);controller.abort();}
 };
}
export function createDocumentMetadataHandler({verifyToken,store,attest,now=Date.now}={}){
 if(typeof verifyToken!=='function'||typeof store?.inspect!=='function'||typeof store?.commit!=='function'||typeof attest!=='function')throw Error('Trusted private document dependencies are required.');
 let minute=-1,total=0;const users=new Map(),ips=new Map();
 return async request=>{
  const origin=origins.includes(request.origin)?request.origin:null,headers={'Cache-Control':'no-store',Pragma:'no-cache','X-Content-Type-Options':'nosniff',Vary:'Origin','Content-Type':'application/json; charset=utf-8',...(origin?{'Access-Control-Allow-Origin':origin}:{})},reply=(status,body)=>({status,headers,body});
  try{
   if(!origin||!['/document-metadata/upload','/document-metadata/review'].includes(request.path))throw documentError(403,'origin','Use the approved private document workspace.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(key=>!['authorization','content-type'].includes(key)))throw documentError(403,'preflight','Use the approved document workspace.');return{...reply(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'}};}
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>4096||Buffer.byteLength(JSON.stringify(request.body??null))>4096)throw documentError(400,'invalid-request','Refresh the exact private document.');
   const kind=request.path.endsWith('/upload')?'upload':'review',input=kind==='upload'?documentUploadIntent(request.body):documentReviewIntent(request.body),token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)throw documentError(401,'sign-in','Sign in again before updating private documents.');
   let actor;try{actor=await verifyToken(token,true);}catch{throw documentError(401,'sign-in','Sign in again before updating private documents.');}
   if(!documentId(actor?.uid)||kind==='upload'&&(origin!==origins[0]||actor.firebase?.sign_in_provider!=='anonymous')||kind==='review'&&(origin!==origins[1]||actor.firebase?.sign_in_provider!=='google.com'||actor.email_verified!==true))throw documentError(403,'identity','Use the approved employee phone or HQ Google account.');
   const slot=Math.floor(now()/60000);if(slot!==minute){minute=slot;total=0;users.clear();ips.clear();}const ip=typeof request.trustedIP==='string'&&request.trustedIP.length<=200?request.trustedIP:null;if(total>=600||(users.get(actor.uid)||0)>=30||ip&&(ips.get(ip)||0)>=120)throw documentError(429,'rate','Too many document checks. Wait a minute, then retry the same action.');total++;users.set(actor.uid,(users.get(actor.uid)||0)+1);if(ip)ips.set(ip,(ips.get(ip)||0)+1);
   const inspection=await store.inspect(kind,input,actor),proof=kind==='upload'||input.status==='approved'?await attest({kind,input,inspection,token,origin}):null;
   let fresh;try{fresh=await verifyToken(token,true);}catch{throw documentError(401,'sign-in','Your private document access changed. Sign in again.');}
   if(fresh?.uid!==actor.uid||fresh.firebase?.sign_in_provider!==actor.firebase?.sign_in_provider||fresh.email!==actor.email||fresh.email_verified!==actor.email_verified)throw documentError(403,'identity','Your account changed. Open the document again.');
   return reply(200,await store.commit(kind,input,fresh,inspection,proof));
  }catch(error){const known=error instanceof DocumentMetadataError&&[400,401,403,409,429,503].includes(error.status)&&/^document-metadata\/(?:origin|preflight|invalid-request|sign-in|identity|rate|permission-denied|changed|unavailable)$/.test(error.code);return reply(known?error.status:503,{code:known?error.code:'document-metadata/unavailable',message:known?error.message:'The private document update could not be confirmed. Reconnect and retry the same action.'});}
 };
}
