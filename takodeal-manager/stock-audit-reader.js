import {stockAuditRange,stockAuditMillis,normalizeStockAuditReport,explainStockAudit} from './stock-audit-model.js';
const DAY=86400000;
const owner='jgo031996@gmail.com';
const legacyAudit=row=>({...row,id:'legacy-inventory-'+row.id,sourceRecordId:row.id,version:1,cashier:row.loggedBy,counts:[{itemId:row.itemId||row.inventoryId,name:row.itemName,systemQty:row.systemQty,physicalQty:row.actualQty,variance:row.variance,uom:row.unit,cost:null}]});
const identity=api=>JSON.stringify([api.auth?.currentUser?.uid,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.branch,api.sessionUser?.permissions,api.sessionUser?.allowedBranches]);
function defaultAccess(api,branch){const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||!session||session.uid&&session.uid!==user.uid)return false;if(user.email?.toLowerCase()===owner&&session.isOwner===true)return true;if(session.isFranchisee===true)return session.branch===branch;return session.allowedBranches?.some(value=>value==='All'||value===branch)&&session.permissions?.some(value=>['all','inventory','inv-audits','audits'].includes(String(value).toLowerCase()));}
export function createStockAuditReader(api,{scope=()=>identity(api),authorize=branch=>defaultAccess(api,branch),timeoutMs=15000,ttlMs=60000,now=Date.now,limit=100,evidenceLimit=300}={}){
 const cache=new Map(),flights=new Map(),details=new Map();let epoch=0;
 const check=(key,branch)=>{if(key!==scope()||!authorize(branch))throw Error('The account or selected branch changed. Reopen this inventory report.');};
 const capture=branch=>{const key=scope(),user=api.auth?.currentUser,session=api.sessionUser;return()=>{check(key,branch);if(api.auth?.currentUser!==user||api.sessionUser!==session)throw Error('The account or workspace was replaced. Reopen this inventory report.');};};
 async function queryRows(table,branch,start,end,{cap=limit,field='timestamp',refresh=false,cursor=null,filters=[]}={}){
  if(!branch||branch==='All'||!authorize(branch))throw Error('Choose a branch in your saved inventory access.');const actor=scope(),user=api.auth?.currentUser,session=api.sessionUser,assertCurrent=capture(branch),generation=epoch,key=JSON.stringify([actor,table,branch,+start,+end,cap,field,cursor?.id||'',filters]);assertCurrent();if(cursor&&typeof api.startAfter!=='function')throw Error('Evidence pagination is unavailable. Update this app before loading more.');
  const saved=cache.get(key);if(!refresh&&saved&&saved.user===user&&saved.session===session&&now()-saved.at<ttlMs)return saved.result;
  let flight=flights.get(key);if(flight?.expired)throw Error('The earlier inventory read is still pending. No extra read was started; retry after it finishes.');
  if(flight&&(flight.user!==user||flight.session!==session))throw Error('The earlier evidence belongs to a replaced workspace. Retry after it finishes.');
  if(!flight){flight={expired:false,user,session,promise:Promise.resolve().then(()=>{assertCurrent();return api.getDocsFromServer(api.query(api.collection(api.db,table),api.where('branch','==',branch),...filters.map(([field,op,value])=>api.where(field,op,value)),api.where(field,'>=',start),api.where(field,'<',end),api.orderBy(field,'desc'),...(cursor?[api.startAfter(cursor)]:[]),api.limit(cap+1)));})};flights.set(key,flight);const cleanup=()=>{if(flights.get(key)===flight)flights.delete(key);};flight.promise.then(cleanup,cleanup);}
  let timer,snapshot;try{snapshot=await Promise.race([flight.promise,new Promise((_,reject)=>{timer=setTimeout(()=>{flight.expired=true;reject(Error('The inventory evidence took too long. Reconnect and retry manually.'));},timeoutMs);})]);}finally{clearTimeout(timer);}
  assertCurrent();if(generation!==epoch)throw Error('The inventory report was refreshed while evidence loaded. Reopen it.');if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Only confirmed server evidence can be used for this report.');
  const all=snapshot.docs;if(all.some(doc=>doc.metadata?.fromCache||doc.metadata?.hasPendingWrites))throw Error('An inventory evidence record is still pending.');
  const page=all.slice(0,cap),result={rows:page.map(doc=>({...doc.data(),id:doc.id})).filter(row=>row.branch===branch&&stockAuditMillis(row[field])!==null&&stockAuditMillis(row[field])>=+start&&stockAuditMillis(row[field])<+end),complete:all.length<=cap,more:all.length>cap,cursor:page.at(-1)||cursor,readCount:all.length,table,limit:cap,loadedAt:now()};cache.set(key,{at:now(),user,session,result});return result;
 }
 return{
  invalidate(){epoch++;cache.clear();details.clear();},
  async list({branch,from,to,cycle,refresh=false}){
   const period=stockAuditRange(from,to),assertCurrent=capture(branch),tables=['inventory_audit_reports','stock_counts','inventory_logs'],results=await Promise.allSettled(tables.map(table=>queryRows(table,branch,period.start,period.end,{refresh,...(table==='inventory_logs'?{filters:[['type','==','Audit']]}:{})})));assertCurrent();
   const warnings=[],sources=new Map(),coverage=[];for(let index=0;index<results.length;index++){const result=results[index],table=tables[index];if(result.status==='rejected'){warnings.push(table+': '+result.reason.message);coverage.push({table,complete:false});continue;}coverage.push({table,complete:result.value.complete,limit:result.value.limit});if(!result.value.complete)warnings.push('More '+table+' exist than this bounded page can show. Narrow the dates.');for(let row of result.value.rows){if(table==='inventory_logs')row=legacyAudit(row);if(table==='inventory_audit_reports'||!sources.has(row.id))sources.set(row.id,normalizeStockAuditReport(row,{legacy:table!=='inventory_audit_reports'}));}}
   if(results.every(result=>result.status==='rejected'))throw results[0].reason;
   const rows=[...sources.values()].filter(row=>!cycle||cycle==='All'||row.selectedCycle===cycle||row.counts.some(item=>item.cycle===cycle)).sort((a,b)=>(b.time??0)-(a.time??0));return{branch,period,rows,warnings,coverage,complete:coverage.every(row=>row.complete)};
  },
  async detail(source,{refresh=false,more=false}={}){
   const report=normalizeStockAuditReport(source),key=scope(),user=api.auth?.currentUser,session=api.sessionUser,assertCurrent=capture(report.branch);assertCurrent();if(report.time===null)return explainStockAudit(source,{complete:false,coverage:[{table:'all',complete:false,error:'The report cutoff is not recorded.'}]});
   const stateKey=JSON.stringify([key,report.branch,report.id,report.time]);let state=details.get(stateKey);if(refresh||!state||state.user!==user||state.session!==session||now()-state.at>ttlMs&&!state.pending){state={at:now(),user,session,raw:source,report,baseline:null,sources:null,readCount:0,pending:null};details.set(stateKey,state);while(details.size>6)details.delete(details.keys().next().value);}
   if(state.result&&!more&&!refresh)return state.result;if(state.pending)return state.pending;
   state.pending=(async()=>{
    const end=new Date(report.time+1);if(!state.baseline){
     const lookback=new Date(report.time-62*DAY),read=await Promise.allSettled([queryRows('stock_counts',report.branch,lookback,end,{cap:200,refresh}),queryRows('inventory_logs',report.branch,lookback,end,{cap:200,refresh,filters:[['type','==','Audit']]})]);assertCurrent();
     const baseline={rows:[],complete:true,readCount:0,errors:[]};read.forEach((result,index)=>{if(result.status==='rejected'){baseline.complete=false;baseline.errors.push(['stock_counts','inventory_logs'][index]+': '+result.reason.message);return;}baseline.rows.push(...result.value.rows.map(row=>index?legacyAudit(row):row));baseline.readCount+=result.value.readCount;baseline.complete&&=result.value.complete;});state.baseline=baseline;state.readCount+=baseline.readCount;
     const prior=baseline.rows.filter(row=>row.id!==report.id&&stockAuditMillis(row.cutoff??row.timestamp)<report.time).map(row=>normalizeStockAuditReport(row)),starts=[];
     for(const item of report.counts){const previous=prior.filter(row=>row.counts.some(count=>count.itemId===item.itemId&&count.uom===item.uom&&count.physicalQty!==null&&count.physicalQty>=0)).sort((a,b)=>b.time-a.time)[0];if(previous)starts.push(previous.time);}
     const fallback=Date.parse((report.periodStart||new Date(report.time+8*3600000).toISOString().slice(0,10))+'T00:00:00+08:00'),earliest=starts.length?Math.min(...starts):Number.isFinite(fallback)?fallback:report.time-DAY;state.start=new Date(Math.max(report.time-62*DAY,earliest));
     state.sources=[['transactions','inventoryAppliedAt',5000],['transactions','voidTime',5000],['transactions','timestamp',5000],['stock_logs','timestamp',2000],['inventory_logs','timestamp',2000]].map(([table,field,cap])=>({table,field,cap,rows:new Map(),cursor:null,more:true,error:null}));
    }
    // Each explicit request loads at most one bounded page per source. A
    // visible Load more button continues those exact cursors, with hard caps.
    const union=()=>new Map(state.sources.filter(row=>row.table==='transactions').flatMap(row=>[...row.rows].map(([id,data])=>[id,data]))),receiptLimit=5000,readLimit=12000,pageSize=Math.min(250,evidenceLimit);
    for(const entry of state.sources){
     if(!entry.more)continue;if(entry.rows.size>=entry.cap||entry.table==='transactions'&&union().size>=receiptLimit||state.readCount>=readLimit-1){entry.limited=true;continue;}
     try{const page=await queryRows(entry.table,report.branch,state.start,end,{field:entry.field,cap:Math.min(pageSize,entry.cap-entry.rows.size,readLimit-state.readCount-1,...(entry.table==='transactions'?[receiptLimit-union().size]:[])),cursor:entry.cursor,refresh});assertCurrent();state.readCount+=page.readCount;entry.cursor=page.cursor;entry.more=page.more;entry.error=null;for(const row of page.rows)entry.rows.set(row.id,row);}
     catch(error){assertCurrent();entry.error=error.message;}
    }
    if(union().size>=receiptLimit||state.readCount>=readLimit-1)for(const entry of state.sources)if(entry.more)entry.limited=true;
    assertCurrent();const coverage=[{table:'stock_counts / inventory_logs · baseline lookup',complete:state.baseline.complete,records:state.baseline.rows.length,limit:400,...(state.baseline.errors.length?{error:state.baseline.errors.join(' ')}:{})},...state.sources.map(entry=>({table:entry.table+' · '+entry.field,complete:!entry.more&&!entry.error&&!entry.limited,records:entry.rows.size,limit:entry.cap,...(entry.error?{error:entry.error}:entry.limited?{error:'The report evidence hard limit was reached. Narrow the reporting interval or request an HQ review.'}:entry.more?{error:'More saved evidence is available. Choose Load more to continue this bounded report.'}:{})}))];
    const result=explainStockAudit(source,{baselines:state.baseline.rows,transactions:[...union().values()],stockLogs:[...state.sources.find(entry=>entry.table==='stock_logs').rows.values()],inventoryLogs:[...state.sources.find(entry=>entry.table==='inventory_logs').rows.values()],complete:coverage.every(row=>row.complete),coverage});result.canLoadMore=state.sources.some(entry=>entry.more&&!entry.limited)&&state.readCount<readLimit&&union().size<receiptLimit;result.window={from:state.start.toISOString(),to:end.toISOString(),receipts:union().size,receiptLimit,physicalReads:state.readCount,readLimit};state.at=now();state.result=result;return result;
   })().finally(()=>{state.pending=null;});return state.pending;
  }
 };
}
