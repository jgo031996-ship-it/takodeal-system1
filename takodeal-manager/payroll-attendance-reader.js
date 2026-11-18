// Fresh, Rules-authorized payroll evidence. Attendance photos are not payroll inputs.
import {ATTENDANCE_METADATA_FIELDS} from './attendance-metadata-reader.js';
export const PAYROLL_ATTENDANCE_FIELDS=Object.freeze([...ATTENDANCE_METADATA_FIELDS,'penaltyAmount']);
const fail=(message,code='payroll/read-invalid')=>Object.assign(Error(message),{code});
class PayrollTimestamp{
 constructor(value){const ms=Date.parse(value);if(!Number.isFinite(ms))throw fail('Invalid payroll timestamp.');this.seconds=Math.floor(ms/1000);this.nanoseconds=Number((String(value).match(/\.(\d{1,9})(?:Z|[+-]\d\d:\d\d)$/)?.[1]||'').padEnd(9,'0'));}
 toDate(){return new Date(this.seconds*1000+this.nanoseconds/1e6);}
 toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}
}
function decode(v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw fail('Invalid payroll response.');
 if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;
 if('timestampValue'in v)return new PayrollTimestamp(v.timestampValue);
 if('integerValue'in v){const n=Number(v.integerValue);if(!Number.isSafeInteger(n))throw fail('Invalid payroll number.');return n;}
 if('doubleValue'in v){if(!Number.isFinite(v.doubleValue))throw fail('Invalid payroll number.');return v.doubleValue;}
 if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
 if('arrayValue'in v)return (v.arrayValue.values||[]).map(decode);
 throw fail('Unsupported payroll response value.');
}
export function createPayrollAttendanceReader({projectId,apiKey,auth,fetch:send=globalThis.fetch,getAppCheckToken}={}){
 if(!projectId||!apiKey||typeof send!=='function')return null;
 if(!/^[a-z][a-z0-9-]{3,62}$/.test(projectId))throw fail('Invalid payroll connection.');
 const base='projects/'+projectId+'/databases/(default)/documents',url='https://firestore.googleapis.com/v1/'+base+':runQuery?key='+encodeURIComponent(apiKey);
 return async({from,to,timeoutMs=25000,assertCurrent=()=>{}})=>{
  if(!(from instanceof Date)||!(to instanceof Date)||!Number.isFinite(+from)||!Number.isFinite(+to)||from>to)throw fail('Choose valid payroll dates.');
  const user=auth?.currentUser;const guard=()=>{assertCurrent();if(!user?.uid||auth?.currentUser!==user||typeof user.getIdToken!=='function')throw fail('Sign in again to confirm payroll.','unauthenticated');};guard();
  const token=await user.getIdToken();guard();if(!token)throw fail('Sign in again to confirm payroll.','unauthenticated');
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  if(getAppCheckToken){const value=await getAppCheckToken();guard();const appToken=typeof value==='string'?value:value?.token;if(!appToken)throw fail('Device verification could not finish.','permission-denied');headers['X-Firebase-AppCheck']=appToken;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await send(url,{method:'POST',headers,cache:'no-store',credentials:'omit',signal:controller.signal,body:JSON.stringify({structuredQuery:{select:{fields:PAYROLL_ATTENDANCE_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'attendance_logs'}],where:{compositeFilter:{op:'AND',filters:[['GREATER_THAN_OR_EQUAL',from],['LESS_THAN_OR_EQUAL',to]].map(([op,date])=>({fieldFilter:{field:{fieldPath:'timestamp'},op,value:{timestampValue:date.toISOString()}}}))}},orderBy:[{field:{fieldPath:'timestamp'},direction:'ASCENDING'}],limit:10001}})});guard();
   const result=await response.json();guard();const remote=Array.isArray(result)?result.find(row=>row?.error)?.error:result?.error;
   if(!response.ok||remote)throw fail('HQ could not confirm attendance for payroll.',String(remote?.status||({401:'unauthenticated',403:'permission-denied',429:'resource-exhausted'}[response.status])||'unavailable').toLowerCase().replaceAll('_','-'));
   if(!Array.isArray(result)||!result.length||result.some(row=>!row||row.skippedResults>0||!row.document&&!row.readTime))throw fail('HQ returned incomplete payroll attendance.');
   const docs=[],seen=new Set(),prefix=base+'/attendance_logs/';
   for(const row of result){if(!row.document)continue;const source=row.document,id=source.name?.startsWith(prefix)?source.name.slice(prefix.length):'';if(!id||id.includes('/')||seen.has(id))throw fail('HQ returned conflicting payroll attendance.');seen.add(id);const data=Object.fromEntries(Object.entries(source.fields||{}).map(([k,v])=>[k,decode(v)]));if(Object.keys(data).some(k=>!PAYROLL_ATTENDANCE_FIELDS.includes(k))||!data.timestamp||+data.timestamp.toDate()<+from||+data.timestamp.toDate()>+to)throw fail('HQ returned attendance outside this cutoff.');docs.push({id,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});}
   if(docs.length>=10001)throw fail('Choose a shorter payroll period; this period contains too many punches.','resource-exhausted');
   return {docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn),metadata:{fromCache:false,hasPendingWrites:false}};
  }catch(error){guard();if(controller.signal.aborted)throw fail('Payroll attendance took too long. Reconnect and generate the list again.','deadline-exceeded');throw error;}finally{clearTimeout(timer);}
 };
}
