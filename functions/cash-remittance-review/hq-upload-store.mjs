import {activeAccessStaff,isAccessOwner} from './access-model.mjs';
import {buildHQAccessIndex,HQ_SOURCE_ACCESS_FIELDS} from './company-access-index.mjs';
import {HQ_UPLOAD_PURPOSES,uploadIntent,uploadDenied,uploadError,uploadHash,uploadGrantId,uploadPath} from './hq-upload-model.mjs';
const data=snapshot=>snapshot?.exists?snapshot.data():null;
const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'&&typeof v.toMillis!=='function'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,sort(v[key])])):v;})(value));
const inactive=row=>!row||row.active===false||row.isActive===false||row.archived===true||row.isArchived===true||row.deleted===true||row.isDeleted===true||row.blocked===true||/^(closed|inactive|disabled|deleted|archived|revoked)$/i.test(row.status||'');
const expiry=value=>value?.toMillis?.()??(value instanceof Date?+value:NaN);
export function createHQUploadStore(db,{now=Date.now,serverTimestamp}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted attachment grant store is required.');
 return{async grant(body,actor){
  const input=uploadIntent(body),email=String(actor.email||'').toLowerCase(),id=uploadGrantId(actor.uid,input.operationId),spec=HQ_UPLOAD_PURPOSES[input.purpose];
  return db.runTransaction(async tx=>{
   const profiles=await tx.get(db.collection('hq_managers').select(...HQ_SOURCE_ACCESS_FIELDS,'pin','securityPin').limit(201)),matching=profiles.docs.filter(row=>String(row.data().email||'').trim().toLowerCase()===email);if(profiles.size>200||matching.length!==1)uploadDenied();
   const source=matching[0],profile=source.data(),expected=buildHQAccessIndex([{id:source.id,data:profile}])[0];
   const [indexSnap,bridgeSnap,oldSnap]=await Promise.all([tx.get(db.doc('hq_account_index/'+email)),tx.get(db.doc('hq_email_access/'+email)),tx.get(db.doc('hq_upload_grants/'+id))]);
   const index=data(indexSnap),bridge=data(bridgeSnap),old=data(oldSnap);
   if(!expected?.active||!index?.active||index.schemaVersion!==1||index.sourceProfileId!==source.id||['sourceAccess','permissions','allowedBranches','role'].some(key=>canonical(index[key])!==canonical(expected[key]))||bridge&&(bridge.active!==true||bridge.role&&bridge.role!==index.role)||String(profile.securityPin||'').toUpperCase()==='REVOKED'||String(profile.securityPin||'').toUpperCase()==='BLOCKED')uploadDenied();
   let branch=input.branch;
   if(input.sourceId){const saved=data(await tx.get(db.doc(spec.table+'/'+input.sourceId)));if(!saved||typeof saved.branch!=='string')uploadDenied();branch=saved.branch;if(input.purpose==='request-proof'&&saved.status!=='Pending'||input.purpose==='discipline-evidence'&&!activeAccessStaff(saved)||saved.archived===true||saved.deleted===true)uploadDenied();}
   const catalog=isAccessOwner(actor)&&input.purpose==='inventory-photo'&&!input.sourceId&&branch==='All';
   if(!catalog){const branches=await tx.get(db.collection('branches').where('name','==',branch).limit(3));if(branches.size!==1||inactive(branches.docs[0].data()))uploadDenied();}
   const allowed=(permissions,branches)=>Array.isArray(permissions)&&permissions.some(key=>spec.permissions.includes(key))&&Array.isArray(branches)&&branches.some(value=>value==='All'||value===branch);
   if(!isAccessOwner(actor)&&(!allowed(index.permissions,index.allowedBranches)||bridge&&!allowed(bridge.permissions,bridge.allowedBranches)))uploadDenied();
   const intentHash=uploadHash([input,branch]),path=uploadPath(actor.uid,id,input),view=row=>({schemaVersion:1,grantId:id,uid:actor.uid,path:row.path,purpose:row.purpose,branch:row.branch,mime:row.mime,size:row.size,sha256:row.sha256,expiresAt:new Date(expiry(row.expiresAt)).toISOString()});
   if(old){if(old.schemaVersion!==1||old.uid!==actor.uid||old.intentHash!==intentHash||old.path!==path||['purpose','mime','size','sha256'].some(key=>old[key]!==input[key])||old.branch!==branch||!Number.isFinite(expiry(old.expiresAt)))throw uploadError(409,'hq-upload/intent-changed','This attachment reference changed. Reopen its exact original file.');if(expiry(old.expiresAt)<=now())throw uploadError(409,'hq-upload/expired','The attachment permission expired. Reopen the attachment and choose it again.');return view(old);}
   const slot=Math.floor(now()/900000),rateRef=db.doc('cash_remittance_attempts/hq-upload-'+uploadHash([actor.uid,slot])),rate=data(await tx.get(rateRef));
   if(rate&&(!Number.isSafeInteger(rate.count)||rate.count<0)||Number(rate?.count||0)>=60)throw uploadError(429,'hq-upload/rate','Too many attachment checks. Wait a few minutes and retry.');
   const grant={schemaVersion:1,uid:actor.uid,path,purpose:input.purpose,branch,mime:input.mime,size:input.size,sha256:input.sha256,intentHash,sourceTable:spec.table,sourceId:input.sourceId||null,createdAt:serverTimestamp(),expiresAt:new Date(now()+300000)};
   tx.create(db.doc('hq_upload_grants/'+id),grant);tx.set(rateRef,{count:Number(rate?.count||0)+1,expiresAt:new Date((slot+2)*900000)});return view(grant);
  });
 }};
}
