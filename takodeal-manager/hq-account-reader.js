// A fresh Rules-authorized HTTPS query avoids the persistent Firestore listen
// transport during unlock. Account authority and PINs are never read from disk.
export const HQ_ACCOUNT_FIELDS=Object.freeze(['email','fullName','name','role','assignedBranch','permissions','active','blocked','archived','status','pin','securityPin','profileUpdatedAt','pinUpdatedAt','permissionsUpdatedAt']);
const problem=(code,message)=>Object.assign(Error(message),{code});
const invalid=()=>problem('hq/invalid-response','HQ returned an incomplete account confirmation. Choose Retry; the workspace stays locked.');
class AccountTimestamp {
 constructor(value){this.seconds=Math.floor(Date.parse(value)/1000);const fraction=value.match(/\.(\d{1,9})(?:Z|[+-]\d\d:\d\d)$/)?.[1]||'';this.nanoseconds=Number(fraction.padEnd(9,'0'));}
 toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}
}
function decode(value,depth=0){
 if(!value||typeof value!=='object'||Array.isArray(value)||depth>12)throw invalid();
 if('nullValue'in value)return null;
 if('stringValue'in value&&typeof value.stringValue==='string')return value.stringValue;
 if('booleanValue'in value&&typeof value.booleanValue==='boolean')return value.booleanValue;
 if('integerValue'in value){if(typeof value.integerValue!=='string'||!/^[-]?(?:0|[1-9][0-9]*)$/.test(value.integerValue))throw invalid();const number=Number(value.integerValue);if(!Number.isSafeInteger(number))throw invalid();return number;}
 if('doubleValue'in value&&Number.isFinite(value.doubleValue))return value.doubleValue;
 // Keep the same fractional-millisecond ordering as Firebase Timestamp.
 // Truncating to Date or integer seconds could select an older permission/PIN.
 if('timestampValue'in value&&typeof value.timestampValue==='string'&&Number.isFinite(Date.parse(value.timestampValue)))return new AccountTimestamp(value.timestampValue);
 if('arrayValue'in value){const values=value.arrayValue.values??[];if(!Array.isArray(values))throw invalid();return values.map(item=>decode(item,depth+1));}
 if('mapValue'in value){const fields=value.mapValue.fields??{};if(!fields||typeof fields!=='object'||Array.isArray(fields))throw invalid();return Object.fromEntries(Object.entries(fields).map(([key,item])=>[key,decode(item,depth+1)]));}
 throw invalid();
}
export function createHQAccountReader({projectId,apiKey,databaseId='(default)',auth,fetch:send=globalThis.fetch,getAppCheckToken,timeoutMs=12000,onDiagnostic=()=>{},now=()=>Date.now()}={}){
 if(typeof send!=='function')return null;
 if(!/^[a-z][a-z0-9-]{3,62}$/.test(projectId||'')||!/^\(default\)$|^[a-z][a-z0-9-]{2,62}$/.test(databaseId)||typeof apiKey!=='string'||!apiKey)throw problem('hq/configuration','The account connection is unavailable. Reload the app while online.');
 const base='projects/'+projectId+'/databases/'+databaseId+'/documents',prefix=base+'/hq_managers/',url='https://firestore.googleapis.com/v1/'+base+':runQuery?key='+encodeURIComponent(apiKey);
 let flight=null;
 return function readAccount(user){
  const uid=user?.uid,email=user?.email;
  const sameActor=()=>auth?.currentUser===user&&user?.uid===uid&&user?.email===email;
  if(!user||typeof uid!=='string'||!uid||typeof email!=='string'||!email||typeof user.getIdToken!=='function'||!sameActor())return Promise.reject(problem('hq/account-changed','Your signed-in account changed. Choose Retry or sign in again.'));
  if(flight&&flight.user===user&&flight.uid===uid&&flight.email===email)return flight.visible;
  if(flight)flight.controller.abort();
  const started=now(),controller=new AbortController();let expired=false,stage='token',timer;
  const emit=(next,code='')=>{if(sameActor())try{onDiagnostic(Object.freeze({stage:next,code,elapsedMs:Math.max(0,Math.round(now()-started))}));}catch{}};
  const assertCurrent=()=>{if(!sameActor())throw problem('hq/account-changed','Your signed-in account changed. Choose Retry or sign in again.');if(expired||controller.signal.aborted)throw problem('hq/deadline-exceeded','Account confirmation timed out. Check your connection and choose Retry.');};
  emit('checking');
  const physical=Promise.resolve().then(async()=>{
   assertCurrent();let token;try{token=await user.getIdToken();}catch{throw problem('hq/sign-in-unavailable','Google sign-in could not be confirmed. Check your connection and choose Retry, or sign in again.');}assertCurrent();
   if(typeof token!=='string'||!token)throw problem('hq/sign-in-unavailable','Google sign-in could not be confirmed. Choose Retry or sign in again.');
   const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
   if(typeof getAppCheckToken==='function'){let checked;try{checked=await getAppCheckToken();}catch{throw problem('hq/device-unavailable','Device confirmation could not finish. Reload while online and choose Retry.');}assertCurrent();const appToken=typeof checked==='string'?checked:checked?.token;if(typeof appToken!=='string'||!appToken)throw problem('hq/device-unavailable','Device confirmation could not finish. Reload while online and choose Retry.');headers['X-Firebase-AppCheck']=appToken;}
   stage='query';emit('connecting');assertCurrent();let response;
   try{response=await send(url,{method:'POST',headers,signal:controller.signal,cache:'no-store',credentials:'omit',body:JSON.stringify({structuredQuery:{select:{fields:HQ_ACCOUNT_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'hq_managers'}],where:{fieldFilter:{field:{fieldPath:'email'},op:'EQUAL',value:{stringValue:email}}}}})});}catch{assertCurrent();throw problem('hq/network-unavailable','HQ could not be reached. Check your connection and choose Retry.');}
   assertCurrent();let result;try{result=await response.json();}catch{assertCurrent();throw invalid();}assertCurrent();
   const remote=Array.isArray(result)?result.find(row=>row?.error)?.error:result?.error;
   if(!response.ok||remote){const status=String(remote?.status||'').toUpperCase();if(response.status===401||status==='UNAUTHENTICATED')throw problem('hq/sign-in-expired','Google sign-in needs to be renewed. Choose Retry or sign in again.');if(response.status===403||status==='PERMISSION_DENIED')throw problem('hq/permission-denied','HQ did not allow this account confirmation. Sign in with your approved Google account or ask the Owner to review access.');if(response.status===429||status==='RESOURCE_EXHAUSTED')throw problem('hq/busy','HQ is busy. Wait a moment, then choose Retry.');throw problem('hq/server-unavailable','HQ account confirmation is temporarily unavailable. Choose Retry when connected.');}
   if(!Array.isArray(result)||!result.length||result.some(row=>!row||typeof row!=='object'||row.skippedResults>0||!row.document&&!row.readTime))throw invalid();
   const ids=new Set(),docs=[];
   for(const row of result){if(!row.document)continue;const record=row.document,name=record.name;if(typeof name!=='string'||!name.startsWith(prefix)||!name.slice(prefix.length)||name.slice(prefix.length).includes('/')||!record.fields||typeof record.fields!=='object'||Array.isArray(record.fields))throw invalid();const id=name.slice(prefix.length);if(ids.has(id))throw invalid();ids.add(id);const data=()=>Object.fromEntries(Object.entries(record.fields).map(([key,value])=>[key,decode(value)]));if(data().email!==email)throw invalid();docs.push({id,data,metadata:{fromCache:false,hasPendingWrites:false}});}
   assertCurrent();emit('verified');return {docs,empty:docs.length===0,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>docs.forEach(callback)};
  });
  const visible=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(problem(stage==='token'?'hq/sign-in-timeout':'hq/deadline-exceeded',stage==='token'?'Google sign-in confirmation timed out. Reload this verification tab while online to renew sign-in, then try again.':'HQ account confirmation timed out. Check your connection and choose Retry.'));},timeoutMs);})]).catch(error=>{emit('failed',error.code||'hq/verification-failed');throw error;});
  const current={user,uid,email,controller,physical,visible};flight=current;
  // Keep a timed-out physical operation single-flight until its cancellation
  // settles. A transport that ignores abort cannot stack requests on Retry or
  // supply a late profile. Native fetch settles promptly on abort.
  physical.finally(()=>{clearTimeout(timer);if(flight===current)flight=null;}).catch(()=>{});
  return visible;
 };
}
