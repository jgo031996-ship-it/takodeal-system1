// Private document operations. The operational Staff PIN is never authorization.
import {validateDocumentDraft, validateDocumentRecord} from './staff-document-model.js';
import {createDocumentBroker,trustedDocumentBroker,DOCUMENT_POLICY_VERSION} from './staff-document-broker.js';
export {DOCUMENT_POLICY_VERSION} from './staff-document-broker.js';
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function documentFilePath(uid, staffId, kind, operationId) {
    if (![uid, staffId, operationId].every(safeId) || !['valid_id','health_card','clearance'].includes(kind)) throw Error('Invalid document identity.');
    return `staff_private_documents/${uid}/${staffId}/${kind}/${operationId}.jpg`;
}
export function createDocumentStore({sdk, db, auth, identity, isHQ=false, broker=createDocumentBroker({auth,identity}), uuid=()=>crypto.randomUUID(),now=()=>Date.now()}) {
    const documentRef = (id, kind) => sdk.doc(db, 'staff_private_documents', id, 'files', kind);
    const me = () => { const user=auth.currentUser; if(!user?.uid) throw Error('Private document access is not ready.'); return user; };
    const currentId = () => { const id=identity(); if(!safeId(id)) throw Error('Choose the employee again.'); return id; };
    const assertSame = (id, uid) => { if(identity()!==id || auth.currentUser?.uid!==uid) throw Error('Your account changed. Open the profile again.'); };
    let config;const verifiedFiles=new Map();
    async function ready({refresh=false}={}) {
        // A closed or not-yet-configured vault must be recoverable with Refresh
        // after HQ enables it. Cache only a successfully enabled policy.
        if(refresh || config?.enabled!==true || config.policyVersion!==DOCUMENT_POLICY_VERSION) {
            config=null;
            const snap=await sdk.getDocFromServer(sdk.doc(db,'staff_document_config','current')),loaded=snap.exists()?snap.data():{};
            trustedDocumentBroker(loaded);config=loaded;
        }
        trustedDocumentBroker(config);return config;
    }
    async function binding() {
        const uid=me().uid, id=currentId();
        const snap=await sdk.getDocFromServer(sdk.doc(db,'staff_document_devices',uid)); assertSame(id,uid);
        const data=snap.exists()?snap.data():null;
        if(data?.active!==true || data.uid!==uid || data.staffId!==id || typeof data.branch!=='string' || !data.branch) throw Error('Ask HQ to approve this device for your private documents.');
        return {...data, uid};
    }
    async function records() {
        const id=currentId(), uid=me().uid; await ready(); assertSame(id,uid);
        if(!isHQ) {await binding();assertSame(id,uid);}
        const result={};
        await Promise.all(['valid_id','health_card','clearance'].map(async kind=> { const snap=await sdk.getDocFromServer(documentRef(id,kind)); assertSame(id,uid);result[kind]=snap.exists()?snap.data():null; }));
        assertSame(id,uid); return result;
    }
    async function requestDevice({deviceId='',deviceName='Staff device'}={}) {
        const id=currentId(), uid=me().uid; await ready(); assertSame(id,uid);
        const target=sdk.doc(db,'staff_document_requests',uid);
        return sdk.runTransaction(db,async tx=> {
            assertSame(id,uid);
            const existingBinding=await tx.get(sdk.doc(db,'staff_document_devices',uid));assertSame(id,uid);
            const request=await tx.get(target); assertSame(id,uid);
            if(existingBinding.exists() && existingBinding.data().active) {
                if(existingBinding.data().staffId===id)return {alreadyApproved:true};
                throw Error('This device is approved for another employee. Ask HQ to review it.');
            }
            if(request.exists() && request.data().staffId===id && request.data().status==='pending')return {alreadyRequested:true};
            if(request.exists() && request.data().staffId!==id)throw Error('HQ must review this device before it can be assigned to another employee.');
            assertSame(id,uid);
            tx.set(target,{uid,staffId:id,deviceId:String(deviceId).slice(0,128),deviceName:String(deviceName).slice(0,80),status:'pending',requestedAt:sdk.serverTimestamp()});
            return {requested:true};
        });
    }
    async function upload(kind, blob, draft, expectedVersion=0, operationId=uuid()) {
        if(!Number.isSafeInteger(expectedVersion) || expectedVersion<0)throw Error('Refresh the profile before uploading.');
        const id=currentId(), uid=me().uid; const transferConfig=await ready({refresh:true}); assertSame(id,uid);
        const access=await binding();assertSame(id,uid);
        if(isHQ)throw Error('Upload documents using the employee’s Staff app.');
        if(blob.type!=='image/jpeg' || !(blob.size>0) || blob.size>2*1024*1024)throw Error('Choose a clear photo under 2 MB after processing.');
        const checked=validateDocumentDraft({...draft,group:kind});
        if(!checked.valid)throw Error(checked.errors.join(' '));
        const bytes=await blob.arrayBuffer();assertSame(id,uid);
        const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');assertSame(id,uid);
        const path=documentFilePath(uid,id,kind,operationId);
        const existingVersion=await sdk.getDocFromServer(sdk.doc(db,'staff_private_documents',id,'versions',operationId));
        assertSame(id,uid);
        if(existingVersion.exists() && (existingVersion.data().group!==kind || existingVersion.data().sha256!==sha256 || existingVersion.data().uploadedByUid!==uid || (existingVersion.data().clearanceType||'')!==(checked.clearanceType||'') || (existingVersion.data().expiresOn||'')!==(checked.expiresOn||'')))throw Error('This upload retry does not match the original photo and details. Choose the photo again.');
        // The trusted broker creates immutable GCS bytes without Firebase download
        // tokens. It verifies retries against the original bytes and intent.
        const transferred=await broker.upload(transferConfig,{staffId:id,group:kind,uploadId:operationId,expectedVersion,sha256,clearanceType:checked.clearanceType||'',expiresOn:checked.expiresOn||'',bytes:new Uint8Array(bytes)});
        if(transferred?.storagePath!==path || transferred.contentType!=='image/jpeg' || transferred.size!==blob.size
            || transferred.sha256!==sha256 || typeof transferred.alreadyExists!=='boolean')throw Error('This upload could not be safely resumed. Choose the photo again.');
        assertSame(id,uid);
        return sdk.runTransaction(db,async tx=> {
            assertSame(id,uid);
            const record=await tx.get(documentRef(id,kind));assertSame(id,uid);
            const version=await tx.get(sdk.doc(db,'staff_private_documents',id,'versions',operationId));assertSame(id,uid);
            const liveBinding=await tx.get(sdk.doc(db,'staff_document_devices',uid)); assertSame(id,uid);
            if(!liveBinding.exists() || liveBinding.data().active!==true || liveBinding.data().staffId!==id || liveBinding.data().branch!==access.branch)throw Error('HQ changed this device’s access. Ask them to review it.');
            const before=record.exists()?record.data():null;
            if(before?.uploadId===operationId) {
                if(before.staffId!==id || before.branch!==access.branch || before.group!==kind || before.uploadedByUid!==uid || before.storagePath!==path || before.contentType!==blob.type || before.size!==blob.size || before.sha256!==sha256 || (before.clearanceType||'')!==(checked.clearanceType||'') || (before.expiresOn||'')!==(checked.expiresOn||''))throw Error('This upload retry does not match the original photo and details. Choose the photo again.');
                return {alreadySaved:true,record:before};
            }
            if((before?.version||0)!==expectedVersion)throw Error('This document changed. Refresh the profile before uploading again.');
            if(version.exists())throw Error('This upload was already used for an earlier document. Choose the photo again.');
            const next={staffId:id,branch:access.branch,group:kind,uploadId:operationId,uploadedByUid:uid,storagePath:path,contentType:'image/jpeg',size:blob.size,sha256,clearanceType:checked.clearanceType||'',expiresOn:checked.expiresOn||'',status:'pending_review',reviewNote:'',version:expectedVersion+1,uploadedAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()};
            assertSame(id,uid);
            tx.set(documentRef(id,kind),next);
            tx.set(sdk.doc(db,'staff_private_documents',id,'versions',operationId),next);
            return {saved:true,record:next};
        });
    }
    async function file(record,{validatePhoto}={}) {
        const id=currentId(),uid=me().uid;const transferConfig=await ready({refresh:true});assertSame(id,uid);
        if(!validateDocumentRecord(record?.group,record).valid || record?.staffId!==id || record.storagePath!==documentFilePath(record.uploadedByUid,id,record.group,record.uploadId))throw Error('The document link is invalid.');
        const live=await sdk.getDocFromServer(documentRef(id,record.group)); assertSame(id,uid);
        const matching=value=>value?.staffId===id && value.group===record.group && value.uploadId===record.uploadId
            && value.version===record.version && value.sha256===record.sha256 && value.size===record.size
            && value.contentType===record.contentType && value.storagePath===record.storagePath;
        if(!live.exists() || !matching(live.data()))throw Error('This document was replaced. Refresh the profile.');
        const blob=await broker.download(transferConfig,{staffId:id,group:record.group,uploadId:record.uploadId,version:record.version,sha256:record.sha256});assertSame(id,uid);
        if(blob.type!=='image/jpeg' || blob.size>2*1024*1024)throw Error('The private photo format is invalid. Refresh the profile.');
        const bytes=await blob.arrayBuffer();assertSame(id,uid);
        const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
        if(blob.size!==record.size || sha256!==record.sha256)throw Error('The photo does not match its saved record. Ask the employee to upload it again.');
        assertSame(id,uid);
        if(isHQ) {if(typeof validatePhoto!=='function')throw Error('Open the photo before marking it reviewed.');await validatePhoto(blob);assertSame(id,uid);}
        const confirmed=await sdk.getDocFromServer(documentRef(id,record.group));assertSame(id,uid);
        if(!confirmed.exists() || !matching(confirmed.data()))throw Error('This document changed while opening. Refresh the profile.');
        verifiedFiles.set(record.group,{staffId:id,actorUid:uid,uploadId:record.uploadId,version:record.version,sha256,at:now()});return blob;
    }
    async function review(kind, expectedVersion, status, note='') {
        if(!isHQ || !['approved','rejected'].includes(status))throw Error('Document review is unavailable.');
        if(status==='rejected' && String(note).trim().length<3)throw Error('Add a reason so the employee knows what to upload again.');
        const id=currentId(),uid=me().uid; await ready();assertSame(id,uid);
        const operationId=uuid();
        const proof=verifiedFiles.get(kind);
        if(status==='approved' && (!proof || proof.staffId!==id || proof.actorUid!==uid || proof.version!==expectedVersion || now()-proof.at>300000))throw Error('View or download this photo before marking it reviewed.');
        return sdk.runTransaction(db,async tx=> {
            assertSame(id,uid);
            const target=documentRef(id,kind),snap=await tx.get(target); assertSame(id,uid);
            if(!snap.exists() || snap.data().version!==expectedVersion)throw Error('This document changed. Refresh before reviewing.');
            const prior=snap.data();
            if(status==='approved' && (prior.uploadId!==proof.uploadId || prior.sha256!==proof.sha256))throw Error('This photo changed. View it again before marking it reviewed.');
            const patch={status,reviewId:operationId,reviewNote:String(note).trim().slice(0,300),reviewedByUid:uid,reviewedAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),version:expectedVersion+1};
            assertSame(id,uid);
            tx.update(target,patch); tx.update(sdk.doc(db,'staff_private_documents',id,'versions',prior.uploadId),patch);
            tx.set(sdk.doc(db,'staff_private_documents',id,'reviews',operationId),{staffId:id,branch:prior.branch,recordVersion:expectedVersion+1,group:kind,uploadId:prior.uploadId,status,note:patch.reviewNote,actorUid:uid,recordedAt:sdk.serverTimestamp()});
        });
    }
    return {ready,binding,records,requestDevice,upload,file,review};
}
