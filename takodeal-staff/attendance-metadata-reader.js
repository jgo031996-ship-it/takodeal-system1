// Full reconciliation evidence without downloading every historical attendance photo.
// This is a fresh Firestore Rules-authorized query, never a cache or privileged backend.
export const ATTENDANCE_METADATA_FIELDS=Object.freeze(['staffId','staffName','branch','type','timestamp','status','deleted','isManual','source','timeInLogId','timeInAt','attendanceVersion','scheduleSnapshot','lateMinutes','originalLateMinutes','reviewedLateMinutes','lateExempted','lateReviewRequestId','lateDecision','lateReviewedAt','lateReviewedBy','lateReviewHistory','lateAmendmentReview','scheduleAmendmentReview','reviewedScheduleAmendmentId']);
const problem=(message,code)=>Object.assign(Error(message),{code});
function valueOf(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw problem('HQ returned an invalid attendance value.','attendance/read-invalid');
 if('nullValue'in value)return null;if('stringValue'in value)return value.stringValue;if('booleanValue'in value)return value.booleanValue;
 if('integerValue'in value){const number=Number(value.integerValue);if(!Number.isSafeInteger(number))throw problem('HQ returned an invalid attendance number.','attendance/read-invalid');return number;}
 if('doubleValue'in value){if(!Number.isFinite(value.doubleValue))throw problem('HQ returned an invalid attendance number.','attendance/read-invalid');return value.doubleValue;}
 if('timestampValue'in value){const date=new Date(value.timestampValue);if(!Number.isFinite(+date))throw problem('HQ returned an invalid attendance timestamp.','attendance/read-invalid');return date;}
 if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([key,item])=>[key,valueOf(item)]));
 if('arrayValue'in value)return (value.arrayValue.values||[]).map(valueOf);
 throw problem('HQ returned an unsupported attendance value.','attendance/read-invalid');
}
export function createAttendanceMetadataReader({projectId,apiKey,databaseId='(default)',auth,fetch:send=globalThis.fetch,getAppCheckToken}={}){
 if(typeof send!=='function'||!projectId||!apiKey)return null;
 if(!/^[a-z][a-z0-9-]{3,62}$/.test(projectId)||!/^\(default\)$|^[a-z][a-z0-9-]{2,62}$/.test(databaseId))throw Error('The attendance database configuration is invalid.');
 const base='projects/'+projectId+'/databases/'+databaseId+'/documents',url='https://firestore.googleapis.com/v1/'+base+':runQuery?key='+encodeURIComponent(apiKey);
 return async function readStaffMetadata({table,field,value}){
  if(!((['attendance_logs','sop_logs'].includes(table)&&['staffId','staffName'].includes(field))||(table==='cashiers'&&field==='cashierName'))||typeof value!=='string'||!value.trim())throw problem('The attendance search identity is invalid.','invalid-argument');
  const user=auth?.currentUser||null,uid=user?.uid||null,assertIdentity=()=>{if((auth?.currentUser||null)!==user||(auth?.currentUser?.uid||null)!==uid)throw problem('The signed-in attendance account changed. Reopen Time Clock.','unauthenticated');};
  const headers={'Content-Type':'application/json'};
  if(user){if(typeof user.getIdToken!=='function')throw problem('The signed-in attendance account could not be confirmed.','unauthenticated');const token=await user.getIdToken();assertIdentity();if(typeof token!=='string'||!token)throw problem('The attendance sign-in token is unavailable.','unauthenticated');headers.Authorization='Bearer '+token;}
  if(typeof getAppCheckToken==='function'){const result=await getAppCheckToken(),token=typeof result==='string'?result:result?.token;assertIdentity();if(typeof token!=='string'||!token)throw problem('The attendance device verification is unavailable.','permission-denied');headers['X-Firebase-AppCheck']=token;}
  assertIdentity();
  const fields=table==='cashiers'?['cashierName']:ATTENDANCE_METADATA_FIELDS;
  const response=await send(url,{method:'POST',headers,cache:'no-store',credentials:'omit',body:JSON.stringify({structuredQuery:{select:{fields:fields.map(fieldPath=>({fieldPath}))},from:[{collectionId:table}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}}}})});assertIdentity();
  let result;try{result=await response.json();}catch(error){throw problem('HQ returned an incomplete attendance response.','attendance/read-invalid');}assertIdentity();
  const remote=Array.isArray(result)?result.find(row=>row?.error)?.error:result?.error;
  if(!response.ok||remote){const status=String(remote?.status||'').toLowerCase().replaceAll('_','-'),code=status||({401:'unauthenticated',403:'permission-denied',429:'resource-exhausted',503:'unavailable',504:'deadline-exceeded'}[response.status])||'unknown';throw problem(String(remote?.message||'HQ attendance search failed.'),code);}
  if(!Array.isArray(result)||!result.length||result.some(row=>!row||typeof row!=='object'||row.skippedResults>0||!row.document&&!row.readTime))throw problem('HQ returned incomplete attendance search evidence.','attendance/read-invalid');
  const prefix=base+'/'+table+'/',docs=[];
  for(const entry of result){if(!entry.document)continue;const document=entry.document;if(typeof document.name!=='string'||!document.name.startsWith(prefix)||!document.name.slice(prefix.length)||document.name.slice(prefix.length).includes('/')||document.fields!=null&&(typeof document.fields!=='object'||Array.isArray(document.fields)))throw problem('HQ returned an attendance record outside this search.','attendance/read-invalid');const id=document.name.slice(prefix.length),record=Object.fromEntries(Object.entries(document.fields||{}).map(([key,item])=>[key,valueOf(item)]));docs.push({id,data:()=>structuredClone(record),metadata:{fromCache:false,hasPendingWrites:false}});}
  return {docs,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>docs.forEach(callback)};
 };
}
