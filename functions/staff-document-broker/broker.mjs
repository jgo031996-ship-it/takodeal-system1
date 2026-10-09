import {createHash} from 'node:crypto';
export const BROKER_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker';
export const MAX_BYTES=2*1024*1024;
export const MAX_REQUEST_BYTES=3*1024*1024;
export const PRODUCTION_ORIGINS=['https://takodeal-staff.vercel.app','https://takodeal-owner.vercel.app'];
const OWNER_EMAIL='jgo031996@gmail.com';
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const groups=['valid_id','health_card','clearance'];
export class BrokerError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const reject=(status,code,message)=>{throw new BrokerError(status,code,message);};
const object=value=>value && typeof value==='object' && !Array.isArray(value);
const timestamp=value=>object(value) && (typeof value.toMillis==='function' || Number.isSafeInteger(value.seconds) || Number.isSafeInteger(value._seconds));
function day(value) {
    if(value==='')return true;if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const [y,m,d]=value.split('-').map(Number);return y>=1000 && m>=1 && m<=12 && d>=1 && d<=31 && new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)===value;
}
function schema(body,upload) {
    const keys=upload?['staffId','group','uploadId','expectedVersion','sha256','clearanceType','expiresOn','base64']:['staffId','group','uploadId','version','sha256'];
    if(!object(body) || Object.keys(body).some(key=>!keys.includes(key)) || keys.some(key=>!Object.hasOwn(body,key)))reject(400,'invalid-request','Choose the document again.');
    if(!id(body.staffId) || !id(body.uploadId) || !groups.includes(body.group) || !hash(body.sha256))reject(400,'invalid-request','The document reference is invalid.');
    const version=upload?body.expectedVersion:body.version;
    if(!Number.isSafeInteger(version) || version<(upload?0:1))reject(400,'invalid-version','Refresh the document before continuing.');
    if(upload && (!day(body.expiresOn) || body.group==='clearance' && !['NBI','POLICE'].includes(body.clearanceType) || body.group!=='clearance' && body.clearanceType!==''))reject(400,'invalid-details','Check the expiry and clearance details.');
}
function jpeg(bytes,expectedHash) {
    if(!Buffer.isBuffer(bytes) || bytes.length<6 || bytes.length>MAX_BYTES)reject(413,'invalid-size','The processed JPEG must be no larger than 2 MB.');
    if(bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255 || bytes.at(-2)!==255 || bytes.at(-1)!==217)reject(400,'invalid-jpeg','Choose a complete JPEG photo.');
    if(digest(bytes)!==expectedHash)reject(409,'hash-mismatch','The photo does not match its saved details.');
}
const recordPath=body=>`staff_private_documents/${body.staffId}/files/${body.group}`;
function filePath(uid,body) {if(!id(uid))reject(403,'invalid-identity','Private access is unavailable.');return `staff_private_documents/${uid}/${body.staffId}/${body.group}/${body.uploadId}.jpg`;}
function currentRecord(record,body,branch) {
    const allowed=['staffId','branch','group','uploadId','uploadedByUid','storagePath','contentType','size','sha256','clearanceType','expiresOn','status','reviewNote','version','uploadedAt','updatedAt','reviewId','reviewedByUid','reviewedAt'];
    if(!object(record) || Object.keys(record).some(key=>!allowed.includes(key)) || allowed.slice(0,16).some(key=>!Object.hasOwn(record,key)) || record.staffId!==body.staffId || record.group!==body.group || record.branch!==branch || !id(record.uploadId) || !id(record.uploadedByUid) || record.storagePath!==filePath(record.uploadedByUid,{...body,uploadId:record.uploadId}) || record.contentType!=='image/jpeg' || !Number.isSafeInteger(record.size) || record.size<6 || record.size>MAX_BYTES || !hash(record.sha256) || !Number.isSafeInteger(record.version) || record.version<1 || !['pending_review','approved','rejected'].includes(record.status) || typeof record.reviewNote!=='string' || record.reviewNote.length>300 || !timestamp(record.uploadedAt) || !timestamp(record.updatedAt) || !day(record.expiresOn) || record.group==='clearance' && !['NBI','POLICE'].includes(record.clearanceType) || record.group!=='clearance' && record.clearanceType!=='')reject(409,'invalid-record','HQ must review this document record.');
    if(record.status!=='pending_review' && (!id(record.reviewId) || !id(record.reviewedByUid) || !timestamp(record.reviewedAt) || record.status==='rejected' && record.reviewNote.length<3))reject(409,'invalid-record','HQ must review this document record.');
}
const sameIntent=(record,body,uid,path,size,branch)=>record.uploadId===body.uploadId && record.uploadedByUid===uid && record.storagePath===path && record.size===size && record.sha256===body.sha256 && record.clearanceType===body.clearanceType && record.expiresOn===body.expiresOn && record.branch===branch;
const canonical=value=>JSON.stringify(value,(_,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const objectDetails=(body,uid,branch)=>({staffId:body.staffId,documentGroup:body.group,uploadId:body.uploadId,sha256:body.sha256,uploaderUid:uid,branch,clearanceType:body.clearanceType,expiresOn:body.expiresOn,policyVersion:'2'});
function validateObject(meta,details,size) {
    if(!meta || meta.contentType!=='image/jpeg' || Number(meta.size)!==size || !/^[1-9]\d*$/.test(String(meta.generation || '')) || canonical(meta.metadata)!==canonical(details))reject(409,'object-mismatch','HQ must review the private photo storage.');
}
export function createPrivateDocumentBroker({verifyToken,read,objects,allowedOrigins=[]}) {
    const origins=new Set(allowedOrigins);
    if([...origins].some(origin=>{try{const url=new URL(origin);return url.protocol!=='https:' || url.origin!==origin || url.username || url.password;}catch{return true;}}))throw Error('Broker origins must be exact HTTPS origins.');
    async function authorize(token,body,upload) {
        let actor;try{actor=await verifyToken(token,true);}catch{reject(401,'invalid-auth','Sign in again before using private documents.');}
        if(!id(actor?.uid) || !actor.firebase)reject(401,'invalid-auth','Sign in again before using private documents.');
        const policy=await read('staff_document_config/current');
        if(policy?.enabled!==true || policy.policyVersion!==2 || policy.brokerEndpoint!==BROKER_ENDPOINT)reject(503,'vault-disabled','Private documents are not enabled.');
        const scope=await read(`staff_private_documents/${body.staffId}`);
        if(scope?.staffId!==body.staffId || scope.version!==1 || typeof scope.branch!=='string' || !scope.branch.trim() || scope.branch.length>128)reject(403,'scope-denied','HQ must approve this employee scope.');
        const anonymous=actor.firebase.sign_in_provider==='anonymous';
        if(upload || anonymous) {
            if(!anonymous)reject(403,'upload-denied','Upload through the approved employee Staff app.');
            const binding=await read(`staff_document_devices/${actor.uid}`);
            if(binding?.uid!==actor.uid || binding.active!==true || binding.staffId!==body.staffId || binding.branch!==scope.branch || !id(binding.approvedByUid) || !timestamp(binding.approvedAt))reject(403,'binding-denied','HQ must approve this device for this employee.');
        } else {
            if(actor.email_verified!==true || typeof actor.email!=='string')reject(403,'scope-denied','A verified HQ account is required.');
            const email=actor.email.toLowerCase();
            if(email!==OWNER_EMAIL) {
                if(!/^[^\s@<>/]+@[^\s@<>/]+\.[^\s@<>/]+$/.test(email))reject(403,'scope-denied','A verified HQ account is required.');
                const access=await read(`hq_email_access/${email}`);
                if(access?.active!==true || !Array.isArray(access.permissions) || !access.permissions.some(value=>['all','branches'].includes(value)) || !Array.isArray(access.allowedBranches) || !access.allowedBranches.some(value=>value==='All' || value===scope.branch))reject(403,'scope-denied','This employee is outside your saved HQ access.');
            }
        }
        return {uid:actor.uid,branch:scope.branch};
    }
    async function committedRecord(body,branch) {
        const record=await read(recordPath(body));currentRecord(record,body,branch);
        const version=await read(`staff_private_documents/${body.staffId}/versions/${record.uploadId}`);currentRecord(version,body,branch);
        if(canonical(record)!==canonical(version))reject(409,'version-changed','Refresh the document before continuing.');
        return record;
    }
    async function upload(token,body) {
        schema(body,true);
        if(typeof body.base64!=='string' || !body.base64 || body.base64.length>4*Math.ceil(MAX_BYTES/3) || body.base64.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))reject(413,'invalid-size','Choose a processed JPEG under 2 MB.');
        const bytes=Buffer.from(body.base64,'base64');if(bytes.toString('base64')!==body.base64)reject(400,'invalid-jpeg','Choose the photo again.');jpeg(bytes,body.sha256);
        const access=await authorize(token,body,true),path=filePath(access.uid,body);
        async function checkState() {
            const now=await authorize(token,body,true);if(now.uid!==access.uid || now.branch!==access.branch)reject(403,'scope-changed','HQ changed this device scope.');
            const record=await read(recordPath(body)),version=await read(`staff_private_documents/${body.staffId}/versions/${body.uploadId}`);
            if(record)currentRecord(record,body,access.branch);
            if(record?.uploadId===body.uploadId) {
                currentRecord(version,body,access.branch);
                if(!sameIntent(record,body,access.uid,path,bytes.length,access.branch) || canonical(record)!==canonical(version))reject(409,'retry-mismatch','This retry does not match the saved photo.');
            } else if((record?.version || 0)!==body.expectedVersion || version)reject(409,'version-changed','Refresh before replacing this document.');
        }
        await checkState();
        let existing=await objects.metadata(path),alreadyExists=Boolean(existing);
        const metadata=objectDetails(body,access.uid,access.branch);
        if(!existing) {
            await checkState();
            try{await objects.create(path,bytes,{contentType:'image/jpeg',cacheControl:'private, no-store, max-age=0',metadata},0);}catch(error){if(error?.code!==412)throw error;alreadyExists=true;}
            existing=await objects.metadata(path);
        }
        validateObject(existing,metadata,bytes.length);
        const stored=await objects.bytes(path,String(existing.generation),MAX_BYTES);jpeg(stored,body.sha256);if(stored.length!==bytes.length)reject(409,'object-mismatch','The saved photo size does not match.');
        await checkState();
        return {storagePath:path,contentType:'image/jpeg',size:bytes.length,sha256:body.sha256,alreadyExists};
    }
    async function download(token,body) {
        schema(body,false);const access=await authorize(token,body,false),record=await committedRecord(body,access.branch);
        if(record.uploadId!==body.uploadId || record.version!==body.version || record.sha256!==body.sha256)reject(409,'version-changed','This document changed. Refresh its profile.');
        const path=record.storagePath,meta=await objects.metadata(path);
        validateObject(meta,objectDetails(record,record.uploadedByUid,access.branch),record.size);
        const bytes=await objects.bytes(path,String(meta.generation),MAX_BYTES);jpeg(bytes,body.sha256);if(bytes.length!==record.size)reject(409,'object-mismatch','The photo size does not match.');
        const fresh=await authorize(token,body,false);if(fresh.uid!==access.uid || fresh.branch!==access.branch)reject(403,'scope-changed','Your saved access changed.');
        const current=await committedRecord(body,fresh.branch);
        if(current.uploadId!==body.uploadId || current.version!==body.version || current.sha256!==body.sha256 || current.storagePath!==path)reject(409,'version-changed','This document changed. Refresh its profile.');
        return bytes;
    }
    return async request=> {
        const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
        try {
            if(!origins.has(request.origin))reject(403,'origin-denied','This app origin is not approved.');headers['Access-Control-Allow-Origin']=request.origin;
            if(!['/upload','/download'].includes(request.path) || request.query && Object.keys(request.query).length)reject(404,'not-found','Route unavailable.');
            if(request.method==='OPTIONS') {
                if(request.preflightMethod!=='POST' || String(request.preflightHeaders || '').split(',').filter(Boolean).some(header=>!['authorization','content-type'].includes(header.trim().toLowerCase())))reject(403,'preflight-denied','This document request is not approved.');
                return {status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'},body:null};
            }
            if(request.method!=='POST')reject(405,'method-denied','Use the approved document action.');
            if(!/^application\/json(?:\s*;|$)/i.test(request.contentType || '') || !Number.isSafeInteger(request.rawSize) || request.rawSize<0 || request.rawSize>MAX_REQUEST_BYTES)reject(413,'invalid-request','The document request is too large or unsupported.');
            if(typeof request.authorization!=='string' || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(request.authorization))reject(401,'invalid-auth','Sign in again before using private documents.');
            const token=request.authorization.slice(7);
            if(request.path==='/upload')return {status:200,headers:{...headers,'Content-Type':'application/json'},body:await upload(token,request.body)};
            return {status:200,headers:{...headers,'Content-Type':'image/jpeg','Content-Disposition':`attachment; filename="${request.body?.group || 'document'}.jpg"`},body:await download(token,request.body)};
        }catch(error){const known=error instanceof BrokerError;return {status:known?error.status:503,headers:{...headers,'Content-Type':'application/json'},body:{error:{code:known?error.code:'temporarily-unavailable',message:known?error.message:'Private documents are temporarily unavailable. Try again later.'}}};}
    };
}
