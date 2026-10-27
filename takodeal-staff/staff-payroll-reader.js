import {ATTENDANCE_METADATA_FIELDS} from './attendance-metadata-reader.js';

// Payroll also uses a saved manual penalty. Keep it without expanding the
// shared Time Clock projection or downloading historical attendance photos.
export const STAFF_PAYROLL_ATTENDANCE_FIELDS=Object.freeze([...ATTENDANCE_METADATA_FIELDS,'penaltyAmount']);
const problem=(message,code='attendance/read-invalid')=>Object.assign(Error(message),{code});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// SDK Timestamp.toMillis retains fractional milliseconds used by the linked
// punch overlap checks. A Date alone would silently discard that evidence.
class PayrollTimestamp{
 constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}
 toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}
 toDate(){return new Date(this.toMillis());}
}
function timestamp(value){
 const match=typeof value==='string'&&value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/),millis=match?Date.parse(match[1]+match[3]):NaN;
 if(!Number.isFinite(millis)||millis%1000!==0)throw problem('HQ returned an invalid attendance timestamp.');
 return new PayrollTimestamp(millis/1000,Number((match[2]||'').padEnd(9,'0')));
}
const clone=value=>value instanceof PayrollTimestamp?new PayrollTimestamp(value.seconds,value.nanoseconds):Array.isArray(value)?value.map(clone):object(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
function valueOf(value){
 if(!object(value))throw problem('HQ returned an invalid payroll attendance value.');
 if('nullValue'in value){if(value.nullValue!==null)throw problem('HQ returned an invalid empty attendance value.');return null;}
 if('stringValue'in value){if(typeof value.stringValue!=='string')throw problem('HQ returned an invalid attendance text.');return value.stringValue;}
 if('booleanValue'in value){if(typeof value.booleanValue!=='boolean')throw problem('HQ returned an invalid attendance flag.');return value.booleanValue;}
 if('integerValue'in value){if(!/^-?\d+$/.test(String(value.integerValue)))throw problem('HQ returned an invalid attendance number.');const number=Number(value.integerValue);if(!Number.isSafeInteger(number))throw problem('HQ returned an unsafe attendance number.');return number;}
 if('doubleValue'in value){if(typeof value.doubleValue!=='number'||!Number.isFinite(value.doubleValue))throw problem('HQ returned an invalid attendance number.');return value.doubleValue;}
 if('timestampValue'in value)return timestamp(value.timestampValue);
 if('mapValue'in value){if(!object(value.mapValue)||value.mapValue.fields!==undefined&&!object(value.mapValue.fields))throw problem('HQ returned an invalid attendance map.');return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([key,item])=>[key,valueOf(item)]));}
 if('arrayValue'in value){if(!object(value.arrayValue)||value.arrayValue.values!==undefined&&!Array.isArray(value.arrayValue.values))throw problem('HQ returned an invalid attendance list.');return(value.arrayValue.values||[]).map(valueOf);}
 throw problem('HQ returned an unsupported payroll attendance value.');
}
function input(staffId,names){
 if(typeof staffId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(staffId)||!Array.isArray(names)||!names.length||names.some(name=>typeof name!=='string'||!name.trim()||name.length>300))throw problem('The payroll attendance identity is invalid.','invalid-argument');
 const aliases=[...new Set(names)].sort();if(aliases.length>10)throw problem('The payroll attendance name list needs review.','invalid-argument');return aliases;
}
function decode(result,base,staffId,names){
 if(!Array.isArray(result)||!result.length||result.some(row=>!object(row)||Number(row.skippedResults||0)!==0||!row.document&&!row.readTime))throw problem('HQ returned incomplete payroll attendance evidence.');
 const prefix=base+'/attendance_logs/',selected=new Set(STAFF_PAYROLL_ATTENDANCE_FIELDS),aliases=new Set(names),seen=new Set(),rows=[];
 for(const entry of result){
  if(!entry.document)continue;const document=entry.document;
  if(!object(document)||typeof document.name!=='string'||!document.name.startsWith(prefix)||!document.name.slice(prefix.length)||document.name.slice(prefix.length).includes('/')||document.fields!==undefined&&!object(document.fields))throw problem('HQ returned attendance outside this payroll search.');
  const id=document.name.slice(prefix.length);if(seen.has(id))throw problem('HQ returned duplicate payroll attendance records.');seen.add(id);
  if(Object.keys(document.fields||{}).some(field=>!selected.has(field)))throw problem('HQ returned attendance fields outside the payroll projection.');
  const data=Object.fromEntries(Object.entries(document.fields||{}).map(([key,value])=>[key,valueOf(value)]));
  if(data.staffId!==staffId&&!aliases.has(data.staffName))throw problem('HQ returned attendance outside this employee search.');
  rows.push({id,data});
 }
 // Match the preceding name-query union followed by ID-only records. This
 // retains the legacy tie order used before payroll's timestamp sorting.
 const encoder=new TextEncoder(),compare=(a,b)=>{const left=encoder.encode(a),right=encoder.encode(b);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];return left.length-right.length;};
 rows.sort((a,b)=>Number(!aliases.has(a.data.staffName))-Number(!aliases.has(b.data.staffName))||compare(a.id,b.id));
 return rows;
}
function snapshot(rows){const docs=rows.map(row=>({id:row.id,data:()=>clone(row.data),metadata:{fromCache:false,hasPendingWrites:false}}));return{docs,empty:!docs.length,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>docs.forEach(callback)};}

/** Fresh projected union, with no date bound or post-response cache. Concurrent
 * callers share only the same pending auth/staff/alias read. Their own view
 * guards remain independent; a stale caller cannot cancel a current caller.
 */
export function createStaffPayrollAttendanceReader({projectId,apiKey,databaseId='(default)',auth,fetch:send=globalThis.fetch,getAppCheckToken,timeoutMs=20000}={}){
 if(typeof send!=='function'||!projectId||!apiKey)return null;
 if(!/^[a-z][a-z0-9-]{3,62}$/.test(projectId)||!/^\(default\)$|^[a-z][a-z0-9-]{2,62}$/.test(databaseId)||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('The payroll attendance connection configuration is invalid.');
 const base='projects/'+projectId+'/databases/'+databaseId+'/documents',url='https://firestore.googleapis.com/v1/'+base+':runQuery?key='+encodeURIComponent(apiKey),flights=new Map(),identities=new WeakMap();let sequence=0;
 return async function readStaffPayrollAttendance({staffId,names,assertCurrent=()=>{}}={}){
  const aliases=input(staffId,names);if(typeof assertCurrent!=='function')throw problem('The payroll view guard is invalid.','invalid-argument');assertCurrent();
  const user=auth?.currentUser||null,uid=user?.uid||null;if(user&&!identities.has(user))identities.set(user,++sequence);
  const authGuard=()=>{if((auth?.currentUser||null)!==user||(auth?.currentUser?.uid||null)!==uid)throw problem('The signed-in payroll account changed. Reopen Pay.','unauthenticated');};
  const key=JSON.stringify([staffId,aliases,user?identities.get(user):null,uid]),caller={assertCurrent,error:null};let flight=flights.get(key);
  if(!flight){
   flight={callers:new Set(),expired:false,controller:new AbortController(),promise:null};flights.set(key,flight);
   const active=flight,guard=()=>{if(active.expired)throw problem('Payroll attendance took too long. Reconnect and refresh Pay.','attendance/read-timeout');authGuard();let valid=false;for(const waiter of active.callers){if(waiter.error)continue;try{waiter.assertCurrent();valid=true;}catch(error){waiter.error=error;}}if(!valid)throw [...active.callers].find(waiter=>waiter.error)?.error||problem('This payroll view closed. Reopen Pay.','attendance/view-changed');};
   let timer;
   const work=Promise.resolve().then(async()=>{
    guard();const headers={'Content-Type':'application/json'};
    if(user){if(typeof user.getIdToken!=='function')throw problem('The payroll sign-in could not be confirmed.','unauthenticated');const token=await user.getIdToken();guard();if(typeof token!=='string'||!token)throw problem('The payroll sign-in token is unavailable.','unauthenticated');headers.Authorization='Bearer '+token;}
    if(typeof getAppCheckToken==='function'){const result=await getAppCheckToken();guard();const token=typeof result==='string'?result:result?.token;if(typeof token!=='string'||!token)throw problem('The payroll device verification is unavailable.','permission-denied');headers['X-Firebase-AppCheck']=token;}
    guard();const response=await send(url,{method:'POST',headers,cache:'no-store',credentials:'omit',redirect:'error',signal:active.controller.signal,body:JSON.stringify({structuredQuery:{select:{fields:STAFF_PAYROLL_ATTENDANCE_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'attendance_logs'}],where:{compositeFilter:{op:'OR',filters:[{fieldFilter:{field:{fieldPath:'staffId'},op:'EQUAL',value:{stringValue:staffId}}},{fieldFilter:{field:{fieldPath:'staffName'},op:'IN',value:{arrayValue:{values:aliases.map(stringValue=>({stringValue}))}}}}]}}}})});guard();
    let result;try{result=await response.json();}catch{guard();throw problem('HQ returned an incomplete payroll attendance response.');}guard();
    const remote=Array.isArray(result)?result.find(row=>row?.error)?.error:result?.error;
    if(!response.ok||remote){const status=String(remote?.status||'').toLowerCase().replaceAll('_','-'),code=status||({401:'unauthenticated',403:'permission-denied',429:'resource-exhausted',503:'unavailable',504:'deadline-exceeded'}[response.status])||'unknown';throw problem(String(remote?.message||'HQ payroll attendance search failed.'),code);}
    const rows=decode(result,base,staffId,aliases);guard();return rows;
   });
   active.promise=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{active.expired=true;active.controller.abort();reject(problem('Payroll attendance took too long. Reconnect and refresh Pay.','attendance/read-timeout'));},timeoutMs);})]).finally(()=>{active.expired=true;active.controller.abort();clearTimeout(timer);if(flights.get(key)===active)flights.delete(key);});
  }
  flight.callers.add(caller);
  try{const rows=await flight.promise;authGuard();if(caller.error)throw caller.error;assertCurrent();return snapshot(rows);}
  finally{flight.callers.delete(caller);}
 };
}
