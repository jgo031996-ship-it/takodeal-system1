export const CASHIER_OPERATIONAL_HISTORY_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/access/staff-operational-history';
const tables=new Set(['attendance_logs','sop_logs','staff_requests','hr_sanctions','announcements','acknowledgments','shift_swaps']);
const id=value=>typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=1500&&!/^\.+$/.test(value)&&!/[\/\u0000-\u001f\u007f]/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const metadata={fromCache:false,hasPendingWrites:false};
export function reviveOperationalRecord(value){
 if(value instanceof Date)return new Date(value);
 if(Array.isArray(value))return value.map(reviveOperationalRecord);
 if(!object(value))return value;
 const result=Object.fromEntries(Object.entries(value).map(([key,row])=>[key,reviveOperationalRecord(row)]));
 if(Object.keys(result).length===2&&Number.isSafeInteger(result.seconds)&&Number.isInteger(result.nanoseconds)&&result.nanoseconds>=0&&result.nanoseconds<1e9){Object.defineProperties(result,{toMillis:{value:()=>result.seconds*1000+result.nanoseconds/1e6},toDate:{value:()=>new Date(result.seconds*1000+result.nanoseconds/1e6)}});}
 return result;
}
export function operationalRecordsSnapshot(records){const docs=records.map(({id,...row})=>({id,data:()=>reviveOperationalRecord(row),metadata}));return{docs,empty:!docs.length,metadata,forEach:callback=>docs.forEach(callback)};}
export async function readCashierOperationalHistory(api,{staffId,table,assertCurrent=()=>{},fetcher=globalThis.fetch,timeoutMs=20000}={}){
 if(!/^[-A-Za-z0-9_]{1,128}$/.test(staffId||'')||!tables.has(table)||typeof fetcher!=='function')throw Error('Reopen the selected employee history.');
 const user=api.auth?.currentUser,actor=api.staffPinActor?.(),guard=()=>{assertCurrent();api.assertStaffOperationalCurrent?.();if(!user?.uid||api.auth?.currentUser!==user)throw Error('The employee or secure tablet account changed. Reopen this view.');};
 guard();if(actor?.uid!==user.uid||!/^DEV-[A-Z0-9-]{6,80}$/.test(actor.deviceId||''))throw Error('Check the tablet approval before loading staff history.');
 const controller=new AbortController();let timer,retired=false;
 const check=()=>{if(retired)throw Error('HQ history check ended. Reconnect and retry.');guard();};
 const work=(async()=>{const token=await user.getIdToken();check();if(typeof token!=='string'||token.length<20)throw Error('Reconnect the secure tablet account.');
  const body={staffId,deviceId:actor.deviceId,app:'cashier',table,...(actor.sessionId?{sessionId:actor.sessionId}:{})};
  const response=await fetcher(CASHIER_OPERATIONAL_HISTORY_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});check();const result=await response.json();check();
  if(!response.ok){const error=Error(response.status===403?'HQ could not confirm this employee or tablet approval. Ask management to review it.':'HQ history could not be confirmed. Reconnect and retry; no new punch has been created.');error.code=response.status===403?'permission-denied':response.status===401?'unauthenticated':'unavailable';throw error;}
  if(!object(result)||result.schemaVersion!==1||result.staffId!==staffId||result.table!==table||result.complete!==true||typeof result.asOf!=='string'||!Number.isFinite(Date.parse(result.asOf))||!Array.isArray(result.records)||result.records.length>5000)throw Error('HQ returned incomplete staff history. Ask management to review it before continuing.');
  const seen=new Set();return result.records.map(row=>{if(!object(row)||!id(row.id)||seen.has(row.id))throw Error('HQ returned invalid staff history.');seen.add(row.id);return reviveOperationalRecord(row);});
 })();
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{retired=true;controller.abort();const error=Error('HQ history check timed out. Reconnect and retry; no new punch has been created.');error.code='deadline-exceeded';reject(error);},timeoutMs);})]);}finally{retired=true;controller.abort();clearTimeout(timer);}
}
export function createCashierAttendanceHistoryReader(api,{staffId,assertCurrent=()=>{},fetcher,timeoutMs}={}){
 const pending=new Map();
 return async search=>{
  assertCurrent();api.assertStaffOperationalCurrent?.();let rows;
  if(search?.table==='staff_directory'&&search.field==='cashierName'){
   const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'staff_directory'),api.where('cashierName','==',search.value),api.limit(3)));assertCurrent();return snap;
  }
  if(!['attendance_logs','sop_logs'].includes(search?.table)||!['staffId','staffName'].includes(search.field)||typeof search.value!=='string')throw Error('Reopen the selected employee attendance.');
  if(!pending.has(search.table))pending.set(search.table,readCashierOperationalHistory(api,{staffId,table:search.table,assertCurrent,fetcher,timeoutMs}));
  rows=await pending.get(search.table);assertCurrent();api.assertStaffOperationalCurrent?.();const docs=rows.filter(row=>row[search.field]===search.value).map(({id,...row})=>({id,data:()=>reviveOperationalRecord(row),metadata}));
  return{docs,empty:!docs.length,metadata,forEach:callback=>docs.forEach(callback)};
 };
}
