import {OWNER_EMAIL} from './workspace-access-model.js';
import {inventoryEvidenceRows} from './inventory-intelligence-model.js';

const TABLES={branches:{cap:60,directory:true},inventory:{cap:400},transactions:{cap:750,field:'timestamp'},stock_logs:{cap:400,field:'timestamp'},inventory_logs:{cap:300,field:'timestamp'},shifts:{cap:100,field:'startTime'}};
const STOP_CODES=new Set(['quota','permission','timeout','network','pending']);
export function inventoryReadError(error){
 const raw=String(error?.code||''),message=String(error?.message||'');
 const code=/resource-exhausted|quota/i.test(raw+' '+message)?'quota':/permission-denied|unauthenticated/i.test(raw)?'permission':raw==='inventory-timeout'?'timeout':/unavailable|offline|network/i.test(raw+' '+message)?'network':/failed-precondition/i.test(raw)&&/index/i.test(message)?'index':'unknown';
 const messages={quota:'The database read limit was reached. This scan stopped. Retry manually after capacity is available.',permission:'Your account cannot read this source. Ask the Owner to review its saved access.',timeout:'This source took too long. The scan stopped; retry manually when the connection is ready.',network:'The server could not be reached. Reconnect, then retry manually.',index:'This branch/date query needs an index. A bounded dated sample may be shown; predictions stay unavailable.',unknown:'This source could not load. Retry manually.'};
 const result=new Error(messages[code]);result.code=code;result.originalCode=raw;return result;
}
export function createInventoryIntelligenceReader({now=Date.now,timeoutMs=12000,ttlMs=60000,maxReportReads=1800}={}){
 const cache=new Map(),inFlight=new Map(),wireFlights=new Map();let epoch=0;
 const identity=api=>JSON.stringify([api.auth?.currentUser?.uid,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.allowedBranches,api.sessionUser?.permissions]);
 const allowed=(api,branch)=>!!api.auth?.currentUser?.uid&&!!api.sessionUser&&(!api.sessionUser.uid||api.sessionUser.uid===api.auth.currentUser.uid)
  &&(api.sessionUser.email?.toLowerCase()===OWNER_EMAIL||api.sessionUser.allowedBranches?.some(value=>value==='All'||value===branch));
 const deadline=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Timed out'),{code:'inventory-timeout'})),timeoutMs);})]).finally(()=>clearTimeout(timer));};
 const read=async(api,{table,branch,period,cap:requestedCap,force=false})=>{
  const config=TABLES[table],signedIn=!!api.auth?.currentUser?.uid&&!!api.sessionUser&&(!api.sessionUser.uid||api.sessionUser.uid===api.auth.currentUser.uid);
  if(!config||!branch||!signedIn||!config.directory&&!allowed(api,branch))throw Object.assign(Error('This branch is outside your inventory access.'),{code:'permission'});
  const cap=Math.min(config.cap,requestedCap??config.cap);
  if(!Number.isInteger(cap)||cap<1)throw Error('The scan read budget is exhausted.');
  if(config.field&&(!period?.start||!period?.end))throw Error('Choose a bounded reporting period.');
  const user=identity(api),token=epoch,dates=config.field?[period.from,period.to]:[],key=JSON.stringify([user,token,table,branch,...dates,cap]);
  if(inFlight.has(key))return inFlight.get(key);
  const saved=cache.get(key);if(!force&&saved&&now()-saved.at<ttlMs){if(saved.error)throw saved.error;return saved.value;}
  const job=(async()=>{
   try{
    const dated=config.field?[api.where(config.field,'>=',period.start),api.where(config.field,'<',period.end)]:[];
    const order=config.field&&api.orderBy?[api.orderBy(config.field,'desc')]:[];
    const bounded=(scoped)=>api.query(api.collection(api.db,table),...(scoped?[api.where('branch','==',branch)]:[]),...dated,...order,api.limit(cap));
    const request=async scoped=>{
     const wireKey=JSON.stringify([user,table,branch,...dates,cap,scoped]);let wire=wireFlights.get(wireKey);
     if(wire&&(wire.timedOut||wire.epoch!==token))throw Object.assign(Error('The previous server read is still pending or backing off. No additional read was started. Retry manually after it finishes.'),{code:'pending'});
     if(!wire){
      wire={epoch:token,timedOut:false,promise:Promise.resolve().then(()=>(api.getDocsFromServer||api.getDocs)(bounded(scoped)))};
      wireFlights.set(wireKey,wire);const cleanup=()=>{if(wireFlights.get(wireKey)===wire)wireFlights.delete(wireKey);};wire.promise.then(cleanup,cleanup);
     }
     try{return await deadline(wire.promise);}catch(error){if(error.code==='inventory-timeout')wire.timedOut=true;throw error;}
    };
    let snapshot,fallback=false;
    try{snapshot=await request(!config.directory);}
    catch(error){const classified=error.code==='pending'?error:inventoryReadError(error);if(classified.code!=='index'||!config.field)throw classified;fallback=true;snapshot=await request(false);}
    if(token!==epoch||user!==identity(api)||!config.directory&&!allowed(api,branch))throw Object.assign(Error('Inventory access or data changed during the scan. Run it again.'),{code:'stale'});
    const all=snapshot.docs.map(row=>({...row.data(),id:row.id})),rows=config.directory?all.filter(row=>allowed(api,row.name)):config.field?inventoryEvidenceRows(all,{branch,start:period.start,end:period.end,field:config.field}):all.filter(row=>row.branch===branch);
    const result={table,branch,rows,complete:!fallback&&all.length<cap,partial:fallback||all.length>=cap,readCount:all.length,limit:cap,loadedAt:now(),basis:fallback?'Bounded dated sample; branch index unavailable':'Bounded branch query'};
    cache.set(key,{at:now(),value:result});return result;
   }catch(error){const classified=['stale','permission','quota','timeout','network','index','unknown','pending'].includes(error.code)?error:inventoryReadError(error);if(token===epoch)cache.set(key,{at:now(),error:classified});throw classified;}
  })().finally(()=>inFlight.delete(key));inFlight.set(key,job);return job;
 };
 return {read,invalidate(){++epoch;cache.clear();},
  async report(api,{branch,period,kind='brief',force=false}){
   const sources=kind==='alerts'?['inventory']:kind==='forecast'?['inventory','transactions','stock_logs']:['inventory','transactions','stock_logs','inventory_logs','shifts'];
   const data={},coverage=[];let remaining=maxReportReads,stopped='';
   for(const table of sources){
    if(stopped||remaining<1){data[table]=[];coverage.push({table,complete:false,error:stopped||'budget',message:'Not read: this scan stopped before this source.'});continue;}
    try{const result=await read(api,{table,branch,period,force,cap:Math.min(TABLES[table].cap,remaining)});remaining-=result.readCount;data[table]=result.rows;coverage.push({...result,rows:undefined});}
    catch(error){data[table]=[];coverage.push({table,complete:false,error:error.code||'unknown',message:error.message});if(STOP_CODES.has(error.code)||error.code==='stale')stopped=error.code;}
   }
   return {branch,period,data,coverage,complete:coverage.every(source=>source.complete),stopped,readCount:maxReportReads-remaining,loadedAt:now()};
  }};
}
