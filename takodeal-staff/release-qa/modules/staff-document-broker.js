// Only this reviewed HTTPS service may receive private Firebase credentials.
// A public configuration document cannot choose another destination.
export const DOCUMENT_POLICY_VERSION = 2;
export const DOCUMENT_BROKER_ENDPOINT = 'https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker';
const TRUSTED_ENDPOINTS = Object.freeze([DOCUMENT_BROKER_ENDPOINT]);
const MAX_BYTES = 2 * 1024 * 1024;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeGroup = value => ['valid_id','health_card','clearance'].includes(value);
export function trustedDocumentBroker(config) {
    if(config?.enabled!==true || config.policyVersion!==DOCUMENT_POLICY_VERSION
        || typeof config.brokerEndpoint!=='string' || !TRUSTED_ENDPOINTS.includes(config.brokerEndpoint)) {
        throw Error('Private uploads are being prepared. Ask HQ to enable the verified document service.');
    }
    const url = new URL(config.brokerEndpoint);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash
        || url.href!==config.brokerEndpoint) throw Error('The private document service is not verified.');
    return config.brokerEndpoint;
}
function codeError(code) {
    const messages = {
        'unauthenticated':'Sign in again before opening private documents.',
        'permission-denied':'Private document access was not permitted. Ask HQ to review this device or account.',
        'not-found':'This private photo is unavailable. Refresh the profile.',
        'failed-precondition':'Private document access changed. Refresh the profile before trying again.',
        'already-exists':'This upload reference does not match the original photo. Choose the photo again.',
        'invalid-argument':'The private photo or its saved details are invalid. Refresh the profile.',
        'unavailable':'The private document service is unavailable. Reconnect and try again.'
    };
    const error = Error(messages[code] || 'The private document transfer could not be verified. Try again when connected.');
    error.code = 'document-broker/' + (Object.hasOwn(messages,code)?code:'unavailable');
    return error;
}
async function responseError(response) {
    let code;
    try { const body=await response.json(); code=body?.error?.code ?? body?.code; } catch {}
    if(!['unauthenticated','permission-denied','not-found','failed-precondition','already-exists','invalid-argument','unavailable'].includes(code)) {
        code = ({401:'unauthenticated',403:'permission-denied',404:'not-found',409:'failed-precondition',400:'invalid-argument'})[response.status] || 'unavailable';
    }
    // Never echo an arbitrary server response, credential, token or URL.
    return codeError(code);
}
function base64(bytes) {
    let binary='';
    for(let at=0;at<bytes.length;at+=8192) binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
    return btoa(binary);
}
async function boundedPhoto(response,check) {
    check();
    if(response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/jpeg') throw codeError('invalid-argument');
    const length=response.headers?.get('content-length');
    if(length!==null && length!==undefined && (!/^\d+$/.test(length) || Number(length)>MAX_BYTES || Number(length)<=0)) throw codeError('invalid-argument');
    let bytes;
    if(response.body?.getReader) {
        const reader=response.body.getReader(),chunks=[];let size=0;
        try {
            while(true) { const next=await reader.read();check();if(next.done)break;size+=next.value.length;
                if(size>MAX_BYTES) {await reader.cancel();throw codeError('invalid-argument');}chunks.push(next.value);
            }
        } finally {reader.releaseLock?.();}
        bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    } else {bytes=new Uint8Array(await response.arrayBuffer());check();}
    if(!bytes.length || bytes.length>MAX_BYTES || bytes[0]!==255 || bytes[1]!==216) throw codeError('invalid-argument');
    return new Blob([bytes],{type:'image/jpeg'});
}
export function createDocumentBroker({auth,identity,fetchFn=globalThis.fetch,timeoutMs=60000}={}) {
    if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000)throw codeError('unavailable');
    function actor(staffId) {
        const user=auth?.currentUser;
        if(!safeId(staffId) || identity?.()!==staffId || !user?.uid || !safeId(user.uid)
            || typeof user.getIdToken!=='function') throw codeError('unauthenticated');
        return {user,uid:user.uid,staffId};
    }
    function same(caller) {
        if(auth.currentUser!==caller.user || auth.currentUser?.uid!==caller.uid || identity()!==caller.staffId) {
            throw Error('Your account changed. Open the profile again.');
        }
    }
    async function post(config,route,request,read) {
        const endpoint=trustedDocumentBroker(config),caller=actor(request.staffId);
        if(typeof fetchFn!=='function' || typeof AbortController!=='function')throw codeError('unavailable');
        const controller=new AbortController();let timer;
        const check=()=>{same(caller);if(controller.signal.aborted)throw codeError('unavailable');};
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(codeError('unavailable'));},timeoutMs);});
        const transfer=(async()=>{
            let token;
            try {token=await caller.user.getIdToken();}
            catch {check();throw codeError('unauthenticated');}
            check();
            if(typeof token!=='string' || !token)throw codeError('unauthenticated');
            let response;
            try {response=await fetchFn(endpoint+'/'+route,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(request)});}
            catch {check();throw codeError('unavailable');}
            check();
            if(response.redirected || response.type==='opaque' || response.type==='opaqueredirect'
                || response.url && response.url!==endpoint+'/'+route)throw codeError('unavailable');
            if(!response.ok) {const error=await responseError(response);check();throw error;}
            const result=await read(response,caller,check);check();return result;
        })();
        try {return await Promise.race([transfer,deadline]);}
        finally {clearTimeout(timer);controller.abort();}
    }
    async function upload(config,{staffId,group,uploadId,expectedVersion,sha256,clearanceType='',expiresOn='',bytes}) {
        trustedDocumentBroker(config);
        if(!safeGroup(group) || !safeId(uploadId) || !safeHash(sha256) || !Number.isSafeInteger(expectedVersion)
            || expectedVersion<0 || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length>MAX_BYTES
            || bytes[0]!==255 || bytes[1]!==216) throw codeError('invalid-argument');
        return post(config,'upload',{staffId,group,uploadId,expectedVersion,sha256,clearanceType,expiresOn,base64:base64(bytes)},async(response,caller,check)=>{
            let result;try {result=await response.json();}catch {check();throw codeError('failed-precondition');}check();
            const keys=['storagePath','contentType','size','sha256','alreadyExists'];
            if(!result || Object.keys(result).some(key=>!keys.includes(key)) || keys.some(key=>!Object.hasOwn(result,key))
                || result.storagePath!==`staff_private_documents/${caller.uid}/${staffId}/${group}/${uploadId}.jpg`
                || result.contentType!=='image/jpeg' || result.size!==bytes.length || result.sha256!==sha256
                || typeof result.alreadyExists!=='boolean') throw codeError('failed-precondition');
            return result;
        });
    }
    async function download(config,{staffId,group,uploadId,version,sha256}) {
        trustedDocumentBroker(config);
        if(!safeGroup(group) || !safeId(uploadId) || !Number.isSafeInteger(version) || version<1 || !safeHash(sha256)) throw codeError('invalid-argument');
        return post(config,'download',{staffId,group,uploadId,version,sha256},(response,_caller,check)=>boundedPhoto(response,check));
    }
    return {upload,download};
}
