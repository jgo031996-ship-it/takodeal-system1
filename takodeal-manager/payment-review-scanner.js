import {OWNER_EMAIL} from './workspace-access-model.js';
const fields=['status','paymentMethod','paymentVerified','branch','timestamp'];
export function paymentScannerIdentity(api){const u=api.auth?.currentUser,s=api.sessionUser;if(!u?.uid||!u.email||u.emailVerified!==true||s?.uid!==u.uid||s.email?.toLowerCase()!==u.email.toLowerCase())return null;return JSON.stringify([u.uid,u.email,s.permissions,s.allowedBranches,s.isOwner,s.isFranchisee]);}
// The sidebar needs only a count, never receipt lines, images or payment proof.
// This read cannot approve payments; payment actions keep their existing checks.
export async function readPaymentReviewSummary(api,{since,signal,assertCurrent=()=>{}}){
 const key=paymentScannerIdentity(api),cfg=api.deviceFleetConnection;if(!key||!cfg?.projectId||!cfg.apiKey||!Number.isFinite(+since))throw Error('Unlock the workspace to check the payment-review count.');
 const current=()=>{assertCurrent();if(paymentScannerIdentity(api)!==key)throw Error('The payment-review account changed.');};current();
 const token=await api.auth.currentUser.getIdToken();current();const all=api.auth.currentUser.email.toLowerCase()===OWNER_EMAIL||api.sessionUser.allowedBranches?.includes('All'),branches=all?[null]:[...new Set((api.sessionUser.allowedBranches||[]).filter(v=>typeof v==='string'&&v&&v!=='All'))];if(!branches.length)throw Error('No payment-review branch is assigned.');
 const send=api.fetch?.bind(api)||globalThis.fetch,prefix='projects/'+cfg.projectId+'/databases/(default)/documents/transactions/',url='https://firestore.googleapis.com/v1/projects/'+cfg.projectId+'/databases/(default)/documents:runQuery?key='+encodeURIComponent(cfg.apiKey),rows=new Map();
 await Promise.all(branches.map(async branch=>{const after={fieldFilter:{field:{fieldPath:'timestamp'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:since.toISOString()}}},where=branch?{compositeFilter:{op:'AND',filters:[after,{fieldFilter:{field:{fieldPath:'branch'},op:'EQUAL',value:{stringValue:branch}}}]}}:after;const response=await send(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',signal,body:JSON.stringify({structuredQuery:{select:{fields:fields.map(fieldPath=>({fieldPath}))},from:[{collectionId:'transactions'}],where}})});current();const result=await response.json();if(!response.ok||!Array.isArray(result)||!result.length||result.some(row=>row?.error||!row||!row.document&&!row.readTime||row.skippedResults>0))throw Error('The payment-review count could not be confirmed.');for(const entry of result){if(!entry.document)continue;const doc=entry.document;if(!doc.name?.startsWith(prefix)||doc.name.slice(prefix.length).includes('/'))throw Error('The payment-review response is incomplete.');const f=doc.fields||{},row={status:f.status?.stringValue,paymentMethod:f.paymentMethod?.stringValue,paymentVerified:f.paymentVerified?.booleanValue,branch:f.branch?.stringValue,timestamp:new Date(f.timestamp?.timestampValue)};if(!Number.isFinite(+row.timestamp)||row.timestamp<since||branch&&row.branch!==branch)throw Error('The payment-review response is outside its scope.');rows.set(doc.name,row);}}));current();return [...rows.values()].filter(row=>row.status!=='Voided'&&!!row.paymentMethod&&row.paymentMethod.toLowerCase()!=='cash'&&row.paymentVerified!==true).length;
}
const aggregateKinds=['A','AB','AC','ABC','D','DB','DC','DBC'];
const cashVariants=Array.from({length:16},(_,mask)=>[...'cash'].map((letter,index)=>mask&(1<<index)?letter.toUpperCase():letter).join(''));
const unavailableAggregates=new WeakMap(),capabilityMs=5*60*1000;
const aggregateProblem=()=>Error('The payment-review count could not be confirmed.');
function aborted(signal){if(signal?.aborted)throw Error('The payment-review count was cancelled.');}
function bounded(promise,signal){
 if(signal.aborted)return Promise.reject(aggregateProblem());
 return new Promise((resolve,reject)=>{const stop=()=>{signal.removeEventListener('abort',stop);reject(aggregateProblem());};signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',stop);resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});});
}
function snapshotTime(value){
 if(typeof value!=='string')throw aggregateProblem();
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value),date=new Date(value);
 if(!match||!Number.isFinite(+date)||date.toISOString().slice(0,19)!==match[1]||/[1-9]/.test((match[2]||'').slice(6)))throw aggregateProblem();return value;
}
function aggregateResult(rows,expectedTime){
 if(!Array.isArray(rows)||!rows.length)throw aggregateProblem();let result=null;
 for(const row of rows){if(!row||typeof row!=='object'||row.error)throw aggregateProblem();const at=snapshotTime(row.readTime);if(expectedTime&&at!==expectedTime)throw aggregateProblem();if(!row.result)continue;
  const fields=row.result.aggregateFields,number=fields?.pendingCount;
  if(result||!fields||Object.keys(fields).join(',')!=='pendingCount'||!number||Object.keys(number).join(',')!=='integerValue'||typeof number.integerValue!=='string'||!/^(0|[1-9]\d*)$/.test(number.integerValue))throw aggregateProblem();
  result={count:BigInt(number.integerValue),readTime:at};
 }
 if(!result)throw aggregateProblem();return result;
}
function missingAggregateIndex(rows){
 const entries=Array.isArray(rows)?rows:[rows];let found=false;
 if(!entries.length)return false;
 for(const row of entries){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['error','readTime'].includes(key)))return false;
  if(row.readTime!==undefined){try{snapshotTime(row.readTime);}catch{return false;}}
  if(row.error!==undefined){const error=row.error;if(error?.status!=='FAILED_PRECONDITION'||typeof error.message!=='string'||!/index/i.test(error.message))return false;found=true;}
  else if(row.readTime===undefined)return false;
 }
 return found;
}
function aggregateQuery(kind,since,branch){
 const filter=(field,op,value)=>({fieldFilter:{field:{fieldPath:field},op,value}}),filters=[filter('timestamp','GREATER_THAN_OR_EQUAL',{timestampValue:since})];
 if(branch!==null)filters.push(filter('branch','EQUAL',{stringValue:branch}));
 if(kind.includes('A'))filters.push(filter('paymentMethod','GREATER_THAN',{stringValue:''}));
 if(kind.includes('D'))filters.push(filter('paymentMethod','IN',{arrayValue:{values:cashVariants.map(stringValue=>({stringValue}))}}));
 if(kind.includes('B'))filters.push(filter('paymentVerified','EQUAL',{booleanValue:true}));
 if(kind.includes('C'))filters.push(filter('status','EQUAL',{stringValue:'Voided'}));
 // The time window must lead the range ordering; ordering by the method first
 // can scan old receipts even though only the last four days are relevant.
 return {structuredQuery:{from:[{collectionId:'transactions'}],where:{compositeFilter:{op:'AND',filters}},orderBy:[{field:{fieldPath:'timestamp'},direction:'ASCENDING'},...(kind.includes('A')?[{field:{fieldPath:'paymentMethod'},direction:'ASCENDING'}]:[])]},aggregations:[{alias:'pendingCount',count:{}}]};
}
function eligibleAggregate(counts){
 const {A,AB,AC,ABC,D,DB,DC,DBC}=counts,noncash=A-D,verified=AB-DB,voided=AC-DC,both=ABC-DBC;
 // Every atom of the (Cash/non-Cash, verified, Voided) partition must be valid.
 // A malformed response must never turn an existing pending badge into zero.
 const atoms=[DBC,DB-DBC,DC-DBC,D-DB-DC+DBC,both,verified-both,voided-both,noncash-verified-voided+both];
 if(atoms.some(value=>value<0n))throw aggregateProblem();return atoms[7];
}
async function aggregateCount(scope,signal,evidence){
 const controller=new AbortController(),stop=()=>controller.abort();signal.addEventListener('abort',stop,{once:true});
 const send=scope.api.fetch?.bind(scope.api)||globalThis.fetch,url='https://firestore.googleapis.com/v1/projects/'+scope.projectId+'/databases/(default)/documents:runAggregationQuery?key='+encodeURIComponent(scope.apiKey);
 async function count(kind,branch,readTime){scope.current();aborted(controller.signal);evidence.aggregateRequestCount++;
  const response=await bounded(send(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+scope.token},cache:'no-store',credentials:'omit',signal:controller.signal,body:JSON.stringify({structuredAggregationQuery:aggregateQuery(kind,scope.since,branch),...(readTime?{readTime}:{})})}),controller.signal);scope.current();
  const rows=await bounded(response.json(),controller.signal);scope.current();
  const hasError=Array.isArray(rows)?rows.some(row=>row?.error!==undefined):rows?.error!==undefined;
  if(!response.ok||hasError){if(missingAggregateIndex(rows)){const missing=Error('Payment-review aggregation indexes are not ready.');missing.code='payment-review/missing-index';throw missing;}throw aggregateProblem();}
  return aggregateResult(rows,readTime);
 }
 try{
  const first=await count('A',scope.branches[0]),anchor=first.readTime,groups=scope.branches.map(()=>({}));groups[0].A=first.count;
  // Every branch and inclusion/exclusion term uses the first result's exact
  // microsecond timestamp, even if a payment is verified during this read.
  await Promise.all(scope.branches.slice(1).map(async(branch,index)=>{groups[index+1].A=(await count('A',branch,anchor)).count;}));
  const tasks=[];for(let i=0;i<groups.length;i++){if(groups[i].A===0n){for(const kind of aggregateKinds.slice(1))groups[i][kind]=0n;continue;}for(const kind of aggregateKinds.slice(1))tasks.push(async()=>{groups[i][kind]=(await count(kind,scope.branches[i],anchor)).count;});}
  let cursor=0;await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];await task();}}));scope.current();
  const total=groups.reduce((sum,group)=>sum+eligibleAggregate(group),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw aggregateProblem();
  return {count:Number(total),mode:'aggregation',evidence:{...evidence,readTime:anchor,branchCount:scope.branches.length,returnedDocuments:0,minimumAggregationReadUnits:evidence.aggregateRequestCount,actualReadUnits:null,requiresQueryExplain:true,readUnitEstimateBasis:'Each count costs at least one read; actual units depend on scanned index entries and applicable Rules reads.'}};
 }catch(error){controller.abort();throw error;}finally{signal.removeEventListener('abort',stop);}
}
// Counts only. A missing composite index retains the compatible five-field
// reader; authorization, malformed responses and snapshot failures never do.
export async function readPaymentReviewCount(api,{since,signal,assertCurrent=()=>{},now=Date.now,timeoutMs=6000}={}){
 const key=paymentScannerIdentity(api),cfg=api.deviceFleetConnection,user=api.auth?.currentUser,auth=api.auth,session=api.sessionUser;
 if(!key||!cfg?.projectId||!cfg.apiKey||!Number.isFinite(+since)||typeof since?.toISOString!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>6000)throw Error('Unlock the workspace to check the payment-review count.');
 const projectId=cfg.projectId,apiKey=cfg.apiKey,at=since.toISOString(),controller=new AbortController(),stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();const timer=setTimeout(stop,timeoutMs);
 const current=()=>{assertCurrent();aborted(controller.signal);if(paymentScannerIdentity(api)!==key||api.auth!==auth||api.auth.currentUser!==user||api.sessionUser!==session||api.deviceFleetConnection?.projectId!==projectId||api.deviceFleetConnection?.apiKey!==apiKey)throw Error('The payment-review account changed.');};
 try{
  current();const token=await bounded(user.getIdToken(),controller.signal);current();const all=user.email.toLowerCase()===OWNER_EMAIL||session.allowedBranches?.includes('All'),branches=all?[null]:[...new Set((session.allowedBranches||[]).filter(value=>typeof value==='string'&&value&&value!=='All'))];if(!branches.length)throw Error('No payment-review branch is assigned.');
  const scope={api,projectId,apiKey,token,since:at,branches,current},clock=now();if(!Number.isFinite(clock))throw aggregateProblem();const capabilityKey=JSON.stringify([projectId,apiKey,key,branches]);let memo=unavailableAggregates.get(api);if(!memo){memo=new Map();unavailableAggregates.set(api,memo);}for(const [entry,until]of memo)if(until<=clock)memo.delete(entry);
  const evidence={aggregateRequestCount:0};let fallbackReason='cached-missing-index';
  if(!memo.has(capabilityKey)){try{return await aggregateCount(scope,controller.signal,evidence);}catch(error){current();if(error.code!=='payment-review/missing-index')throw error;fallbackReason='missing-index';if(memo.size>=16)memo.delete(memo.keys().next().value);memo.set(capabilityKey,clock+capabilityMs);}}
  const count=await bounded(readPaymentReviewSummary(api,{since:new Date(at),signal:controller.signal,assertCurrent:current}),controller.signal);current();
  return {count,mode:'masked-rest',evidence:{...evidence,fallbackReason,branchCount:branches.length,readTime:null,actualReadUnits:null,requiresQueryExplain:true,readUnitEstimateBasis:'Compatibility mode returns the five summary fields for matching receipts; no measured read saving is claimed.'}};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
export function installPaymentReviewScanner(api=window,d=document,{read=readPaymentReviewCount,now=()=>new Date(),setIntervalFn=setInterval,clearIntervalFn=clearInterval,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}={}){
 let flight=null,interval=null,boot=null,epoch=0;
 const active=()=>d.visibilityState!=='hidden'&&!!paymentScannerIdentity(api),foreground=()=>!!d.querySelector?.('dialog[open]');
 function stop(){epoch++;if(interval!==null)clearIntervalFn(interval);if(boot!==null)clearTimeoutFn(boot);interval=boot=null;flight?.controller.abort();}
 async function scan({force=false}={}){if(!active()||!force&&foreground())return false;if(flight)return flight.promise;const key=paymentScannerIdentity(api),version=epoch,controller=new AbortController(),since=new Date(now());since.setDate(since.getDate()-4);const current=()=>{if(controller.signal.aborted||version!==epoch||key!==paymentScannerIdentity(api))throw Error('The background payment count was superseded.');},entry={controller};entry.promise=Promise.resolve().then(async()=>{const timer=setTimeoutFn(()=>controller.abort(),6000);try{const result=await read(api,{since,signal:controller.signal,assertCurrent:current}),count=typeof result==='number'?result:result?.count;current();if(!Number.isSafeInteger(count)||count<0)throw aggregateProblem();if(active()){if(result&&typeof result==='object')api.paymentReviewReadEvidence={mode:result.mode,...result.evidence};api.updateUnverifiedBadges(count);}return true;}catch{return false;}finally{clearTimeoutFn(timer);if(flight===entry)flight=null;}});flight=entry;return entry.promise;}
 function start(){if(interval!==null)return;boot=setTimeoutFn(()=>{boot=null;void scan();},3000);interval=setIntervalFn(()=>{void scan();},120000);}
 d.addEventListener?.('visibilitychange',()=>{if(d.visibilityState==='hidden'){epoch++;flight?.controller.abort();}else void scan();});api.addEventListener?.('pagehide',stop);api.addEventListener?.('pageshow',start);return {start,stop,scan};
}
