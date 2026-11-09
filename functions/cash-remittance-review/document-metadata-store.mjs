import {activeAccessStaff,isAccessOwner} from './access-model.mjs';
import {buildHQAccessIndex,HQ_SOURCE_ACCESS_FIELDS} from './company-access-index.mjs';
import {DOCUMENT_IMAGE_ENDPOINT,documentId,documentBranch,documentTimestamp,documentDeny,documentChanged,documentCanonical,documentFingerprint,documentStoragePath,assertDocumentRecord,documentUploadMatches,assertDocumentAttestation,documentUploadIntent,documentReviewIntent} from './document-metadata-model.mjs';
const row=snapshot=>snapshot?.exists?snapshot.data():null;
const revision=snapshot=>snapshot?.exists?documentFingerprint([snapshot.data(),snapshot.updateTime??null]):null;
export function createDocumentMetadataStore(db,{serverTimestamp}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted private document transaction store is required.');
 async function authorize(tx,input,actor,kind){
  const [policySnap,scopeSnap,staffSnap]=await Promise.all(['staff_document_config/current','staff_private_documents/'+input.staffId,'cashiers/'+input.staffId].map(path=>tx.get(db.doc(path))));
  const policy=row(policySnap),scope=row(scopeSnap),staff=row(staffSnap);
  if(policy?.enabled!==true||policy.policyVersion!==2||policy.brokerEndpoint!==DOCUMENT_IMAGE_ENDPOINT||scope?.staffId!==input.staffId||scope.version!==1||!documentBranch(scope.branch)||!activeAccessStaff(staff)||staff.branch.trim()!==scope.branch)documentDeny();
  const anonymous=actor.firebase?.sign_in_provider==='anonymous';
  if(kind==='upload'){
   if(!anonymous)documentDeny();const binding=row(await tx.get(db.doc('staff_document_devices/'+actor.uid)));
   if(binding?.uid!==actor.uid||binding.active!==true||binding.staffId!==input.staffId||binding.branch!==scope.branch||!documentId(binding.approvedByUid)||!documentTimestamp(binding.approvedAt))documentDeny();
  }else{
   if(actor.firebase?.sign_in_provider!=='google.com'||actor.email_verified!==true||typeof actor.email!=='string')documentDeny();const email=actor.email.trim().toLowerCase();
   if(!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email))documentDeny();
   const profiles=await tx.get(db.collection('hq_managers').select(...HQ_SOURCE_ACCESS_FIELDS,'pin','securityPin').limit(201)),matching=profiles.docs.filter(snap=>String(snap.data().email||'').trim().toLowerCase()===email);
   if(profiles.size>200||matching.length!==1)documentDeny();const source=matching[0],profile=source.data(),expected=buildHQAccessIndex([{id:source.id,data:profile}])[0];
   const [indexSnap,bridgeSnap]=await Promise.all([tx.get(db.doc('hq_account_index/'+email)),tx.get(db.doc('hq_email_access/'+email))]),index=row(indexSnap),bridge=row(bridgeSnap);
   if(!expected?.active||!index?.active||index.schemaVersion!==1||index.sourceProfileId!==source.id||['sourceAccess','permissions','allowedBranches','role'].some(key=>documentCanonical(index[key])!==documentCanonical(expected[key]))||['pin','securityPin'].some(key=>/^(REVOKED|BLOCKED)$/i.test(String(profile[key]||'').trim()))||bridge&&(bridge.active!==true||bridge.role&&bridge.role!==index.role))documentDeny();
   const allowed=grant=>Array.isArray(grant?.permissions)&&grant.permissions.some(value=>['all','branches'].includes(value))&&Array.isArray(grant.allowedBranches)&&grant.allowedBranches.some(value=>value==='All'||value===scope.branch);
   if(!isAccessOwner(actor)&&(!allowed(index)||bridge&&!allowed(bridge)))documentDeny();
  }
  return scope.branch;
 }
 async function load(tx,kind,input,actor){
  const branch=await authorize(tx,input,actor,kind),headRef=db.doc(`staff_private_documents/${input.staffId}/files/${input.group}`),headSnap=await tx.get(headRef),head=row(headSnap);
  if(head)assertDocumentRecord(head,{...input,branch});
  const versionId=kind==='upload'?input.uploadId:head?.uploadId||input.uploadId,versionRef=db.doc(`staff_private_documents/${input.staffId}/versions/${versionId}`),versionSnap=await tx.get(versionRef),version=row(versionSnap);
  const originalVersionSnap=head&&head.uploadId!==versionId?await tx.get(db.doc(`staff_private_documents/${input.staffId}/versions/${head.uploadId}`)):versionSnap;
  if(head&&documentCanonical(row(originalVersionSnap))!==documentCanonical(head))documentChanged();
  if(kind==='review'&&!head)documentChanged();
  let auditSnap=null,auditRef=null,audit=null;
  if(kind==='review'){auditRef=db.doc(`staff_private_documents/${input.staffId}/reviews/${input.reviewId}`);auditSnap=await tx.get(auditRef);audit=row(auditSnap);}
  const sameHead=version&&head&&documentCanonical(version)===documentCanonical(head);
  if(kind==='upload'){
   if(head?.uploadId===input.uploadId){if(!sameHead||!documentUploadMatches(head,input,actor.uid,branch))documentChanged();}
   else if(version||(head?.version||0)!==input.expectedVersion)documentChanged();
  }else{
   if(!sameHead||head.uploadId!==input.uploadId||head.sha256!==input.sha256)documentChanged();
   if(audit){const expected={staffId:input.staffId,branch,recordVersion:input.expectedVersion+1,group:input.group,uploadId:input.uploadId,status:input.status,note:input.note,actorUid:actor.uid};if(Object.keys(audit).length!==9||Object.entries(expected).some(([key,value])=>audit[key]!==value)||!audit.recordedAt||documentCanonical(audit.recordedAt)!==documentCanonical(head.reviewedAt)||head.reviewId!==input.reviewId||head.version!==input.expectedVersion+1||head.status!==input.status||head.reviewNote!==input.note||head.reviewedByUid!==actor.uid)documentChanged();}
   else if(head.version!==input.expectedVersion)documentChanged();
  }
  return{branch,headRef,head,versionRef,version,auditRef,audit,revision:documentFingerprint([revision(headSnap),revision(versionSnap),revision(originalVersionSnap),revision(auditSnap)])};
 }
 const ack=(input,head,alreadySaved)=>({staffId:input.staffId,group:input.group,uploadId:input.uploadId,version:head.version,alreadySaved,...(input.reviewId?{reviewId:input.reviewId,status:input.status}:{})});
 return{
  async inspect(kind,raw,actor){const input=kind==='upload'?documentUploadIntent(raw):documentReviewIntent(raw);return db.runTransaction(async tx=>{const state=await load(tx,kind,input,actor);return{branch:state.branch,revision:state.revision,record:state.head};});},
  async commit(kind,raw,actor,inspection,attestation){
   const input=kind==='upload'?documentUploadIntent(raw):documentReviewIntent(raw);
   return db.runTransaction(async tx=>{
    const state=await load(tx,kind,input,actor);
    if(state.branch!==inspection?.branch)documentDeny();
    if(kind==='upload'||input.status==='approved')assertDocumentAttestation(attestation,{kind,input,uid:actor.uid,branch:state.branch,record:state.head});
    if(kind==='upload'&&state.head?.uploadId===input.uploadId)return ack(input,state.head,true);
    if(kind==='review'&&state.audit)return ack(input,state.head,true);
    if(state.revision!==inspection.revision)documentChanged();
    if(kind==='upload'){
     const saved={staffId:input.staffId,branch:state.branch,group:input.group,uploadId:input.uploadId,uploadedByUid:actor.uid,storagePath:documentStoragePath(actor.uid,input),contentType:'image/jpeg',size:input.size,sha256:input.sha256,clearanceType:input.clearanceType,expiresOn:input.expiresOn,status:'pending_review',reviewNote:'',version:input.expectedVersion+1,uploadedAt:serverTimestamp(),updatedAt:serverTimestamp()};
     tx.set(state.headRef,saved);tx.create(state.versionRef,saved);return ack(input,saved,false);
    }
    const patch={status:input.status,reviewId:input.reviewId,reviewNote:input.note,reviewedByUid:actor.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp(),version:input.expectedVersion+1};
    tx.update(state.headRef,patch);tx.update(state.versionRef,patch);tx.create(state.auditRef,{staffId:input.staffId,branch:state.branch,recordVersion:patch.version,group:input.group,uploadId:input.uploadId,status:input.status,note:input.note,actorUid:actor.uid,recordedAt:serverTimestamp()});return ack(input,patch,false);
   });
  }
 };
}
