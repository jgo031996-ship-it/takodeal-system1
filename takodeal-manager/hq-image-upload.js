// A grant permits one immutable image only; it does not approve its business action.
const endpoint='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/hq-upload/grant';
const attempts=new WeakMap(),types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const scope=api=>JSON.stringify([api.auth?.currentUser?.uid,api.sessionUser?.email,api.sessionUser?.role,api.sessionUser?.permissions,api.sessionUser?.allowedBranches,api.sessionUser?.assignedBranch]);
export async function uploadHQImage(api,file,{purpose,sourceId,branch,assertCurrent=()=>{}}={}){
 const user=api.auth?.currentUser,session=api.sessionUser,stamp=scope(api),guard=()=>{assertCurrent();if(api.auth?.currentUser!==user||api.sessionUser!==session||scope(api)!==stamp)throw Error('Your account or attachment window changed. Reopen this action.');};
 guard();if(!user?.uid||typeof user.getIdToken!=='function'||!Object.hasOwn(types,file?.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP attachment up to 5 MB while signed in.');
 const cryptoApi=api.crypto||globalThis.crypto,fetcher=api.fetch?.bind(api)||globalThis.fetch;
 if(!cryptoApi?.subtle||typeof fetcher!=='function'||typeof api.getMetadata!=='function')throw Error('Reload the workspace to enable secure attachment uploads.');
 const key=JSON.stringify([user.uid,purpose,sourceId||null,branch||null,stamp]);let byScope=attempts.get(file);if(!byScope){byScope=new Map();attempts.set(file,byScope);}let attempt=byScope.get(key);
 if(!attempt){attempt={operationId:cryptoApi.randomUUID()};byScope.set(key,attempt);}
 if(attempt.url){guard();return attempt.url;}
 if(!attempt.sha256){const bytes=await file.arrayBuffer();guard();attempt.sha256=[...new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');guard();}
 const body={operationId:attempt.operationId,purpose,mime:file.type,size:file.size,sha256:attempt.sha256,...(sourceId!==undefined?{sourceId}:{branch})};
 const token=await user.getIdToken(true);guard();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let response;
 try{response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},credentials:'omit',cache:'no-store',signal:controller.signal,body:JSON.stringify(body)});}finally{clearTimeout(timer);}guard();
 const grant=await response.json();guard();if(!response.ok)throw Error(grant?.message||'The attachment permission could not be confirmed. Retry the same file.');
 const expected='hq_business_files/'+user.uid+'/'+grant.grantId+'/'+attempt.sha256+'.'+types[file.type];
 if(grant.schemaVersion!==1||grant.uid!==user.uid||!/^hqupload-[a-f0-9]{64}$/.test(grant.grantId||'')||grant.path!==expected||grant.purpose!==purpose||grant.mime!==file.type||grant.size!==file.size||grant.sha256!==attempt.sha256||typeof grant.branch!=='string'||!grant.branch||branch!==undefined&&grant.branch!==branch||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())throw Error('The attachment permission changed or expired. Reopen this action.');
 const reference=api.ref(api.storage,grant.path),metadata={contentType:file.type,customMetadata:{hqUploadUid:user.uid,hqUploadGrantId:grant.grantId,sha256:attempt.sha256}};
 guard();try{await api.uploadBytes(reference,file,metadata);guard();}catch(error){guard();let saved;try{saved=await api.getMetadata(reference);}catch{throw error;}guard();if(saved.size!==file.size||saved.contentType!==file.type||saved.customMetadata?.hqUploadUid!==user.uid||saved.customMetadata?.hqUploadGrantId!==grant.grantId||saved.customMetadata?.sha256!==attempt.sha256)throw error;}
 const url=await api.getDownloadURL(reference);guard();attempt.url=url;return url;
}
