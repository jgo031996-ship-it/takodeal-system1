import {resolveHQAccount} from './hq-account-model.js';
import {OWNER_EMAIL,createWorkspaceSession,canOpenInventoryTab} from './workspace-access-model.js';
import {historyPeriod,historyInPeriod,historyBranch,normalizeInventoryHistory,restockReversalPlan,historyNumber,safeHistoryProof} from './inventory-history-model.js';
import {recipeFingerprint} from './recipe-changes.js';
const cacheByApi=new WeakMap(),PAGE_SIZE=500,TTL=60000;
const same=(a,b)=>recipeFingerprint(a)===recipeFingerprint(b),rows=snap=>snap.docs.map(row=>({...row.data(),id:row.id}));
const sessionIdentity=api=>{const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||!user.email||!session||user.email.toLowerCase()!==session.email?.toLowerCase()||session.uid&&session.uid!==user.uid)throw Error('Sign in with your approved account to review inventory history.');return {uid:user.uid,email:user.email.toLowerCase()};};
export const historyScopeAllows=(context,branch)=>!!branch&&(context.actor.email===OWNER_EMAIL||context.session.allowedBranches.some(name=>name.toLowerCase()==='all'||name===branch));
const allBranches=context=>context.actor.email===OWNER_EMAIL||context.session.allowedBranches.some(name=>name.toLowerCase()==='all');
function withDeadline(api,promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=(api.setTimeout||setTimeout)(()=>reject(Error('History is taking longer than expected. Try a shorter date range after the connection recovers.')),25000);})]).finally(()=>(api.clearTimeout||clearTimeout)(timer));}
function serverRead(api,key,read){
 const cache=getCache(api),existing=cache.inflight.get(key);
 if(existing)return withDeadline(api,existing);
 if(cache.quotaUntil>Date.now())return Promise.reject(Object.assign(Error('Database quota is temporarily unavailable. Retry later.'),{code:'resource-exhausted'}));
 // A UI deadline cannot cancel a Firestore SDK request. Keep the actual promise
 // registered until it settles, so Refresh never stacks requests on SDK backoff.
 const pending=Promise.resolve().then(read);cache.inflight.set(key,pending);
 pending.then(()=>{if(cache.inflight.get(key)===pending)cache.inflight.delete(key);},error=>{if(/resource-exhausted|quota/i.test(String(error?.code)+' '+error?.message))cache.quotaUntil=Date.now()+TTL;if(cache.inflight.get(key)===pending)cache.inflight.delete(key);});
 return withDeadline(api,pending);
}
export async function inventoryHistoryAccess(api,kind){
 if(!['Waste','StockLogs','Invoices'].includes(kind))throw Error('Choose a supported inventory report.');
 const actor=sessionIdentity(api),snap=await serverRead(api,'access:'+actor.uid+':'+actor.email,()=>api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email))));
 const records=snap.docs.map(row=>({id:row.id,data:row.data()})),account=resolveHQAccount(records),session=createWorkspaceSession(actor,account);
 if(account.blocked===true||!canOpenInventoryTab(session,kind))throw Error('Your current saved permissions do not allow this inventory report.');
 if(!same(actor,sessionIdentity(api)))throw Error('The signed-in account changed. Open this report again.');
 return {actor,records,session};
}
function getCache(api){if(!cacheByApi.has(api))cacheByApi.set(api,{reports:new Map(),directories:new Map(),inflight:new Map(),quotaUntil:0});return cacheByApi.get(api);}
export function clearInventoryHistoryCache(api){const cache=getCache(api);cache.reports.clear();cache.directories.clear();}
export async function readInventoryHistory(api,{kind,from,to,branch='All',refresh=false,more=false,legacy=false}={}){
 const period=historyPeriod(from,to),context=await inventoryHistoryAccess(api,kind),identity=recipeFingerprint([context.actor,context.session]);
 if(branch!=='All'&&!historyScopeAllows(context,branch))throw Error('Choose a branch in your approved access.');
 const cache=getCache(api),now=Date.now(),directoryKey=identity;
 let directory=cache.directories.get(directoryKey);
 if(refresh||!directory||now-directory.at>TTL){
  const snap=await serverRead(api,'branches:'+identity,()=>api.getDocsFromServer(api.query(api.collection(api.db,'branches'),api.limit(251))));
  directory={at:now,names:rows(snap).map(row=>row.name).filter(name=>typeof name==='string'&&name.trim()&&historyScopeAllows(context,name)),partial:snap.docs.length>250};
  cache.directories.clear();cache.directories.set(directoryKey,directory);
 }
 const names=[...new Set([...directory.names,...(!allBranches(context)?context.session.allowedBranches:[]),'Main Office'].filter(name=>historyScopeAllows(context,name)))].sort();
 const scopes=branch!=='All'?[branch]:allBranches(context)?[null]:names;
 if(!scopes.length)throw Error('No branch is assigned to this account. Ask the Owner to review access.');
 const key=recipeFingerprint({identity,kind,from,to,scopes,legacy});let state=cache.reports.get(key);
 if(refresh||!state||now-state.at>TTL&&!more){
  const tables=kind==='Invoices'?['hq_restocks']:kind==='Waste'?['stock_logs','inventory_logs']:['stock_logs'];
  state={at:now,loadedAt:null,sources:tables.flatMap(table=>scopes.map(scope=>({table,scope,docs:[],cursor:null,more:true,error:null}))),pending:null,legacy};cache.reports.set(key,state);
  while(cache.reports.size>6)cache.reports.delete(cache.reports.keys().next().value);
 }
 const shouldRead=state.loadedAt===null||more;
 if(shouldRead&&!state.pending){state.pending=(async()=>{
  const tasks=state.sources.filter(source=>source.more).map(async source=>{
   try{
    const constraints=[...(source.scope?[api.where('branch','==',source.scope)]:[]),...(!legacy?[api.where('timestamp','>=',period.start),api.where('timestamp','<',period.end),api.orderBy('timestamp','desc')]:[]),...(source.cursor?[api.startAfter(source.cursor)]:[]),api.limit(PAGE_SIZE+1)];
    const pageKey=key+':'+source.table+':'+source.scope+':'+(source.cursor?.id||'first');
    const snap=await serverRead(api,pageKey,()=>api.getDocsFromServer(api.query(api.collection(api.db,source.table),...constraints))),page=snap.docs.slice(0,PAGE_SIZE);
    source.docs.push(...page);source.cursor=page.at(-1)||source.cursor;source.more=snap.docs.length>PAGE_SIZE;source.error=null;
   }catch(error){source.error=error;}
  });
  await Promise.allSettled(tasks);state.loadedAt=Date.now();state.at=state.loadedAt;
 })().finally(()=>{state.pending=null;});}
 if(state.pending)await state.pending;
 if(!same(context.actor,sessionIdentity(api)))throw Error('The signed-in account changed. Open this report again.');
 const modern=legacy?cache.reports.get(recipeFingerprint({identity,kind,from,to,scopes,legacy:false})):null;
 const sources={};for(const source of [...(modern?.sources||[]),...state.sources]){sources[source.table]||=[];sources[source.table].push(...source.docs.map(doc=>({...doc.data(),id:doc.id})));}
 for(const table of Object.keys(sources))sources[table]=[...new Map(sources[table].map(row=>[row.id,row])).values()].filter(row=>historyInPeriod(row,period)&&(historyBranch(row)?historyScopeAllows(context,historyBranch(row)):allBranches(context))&&(branch==='All'||historyBranch(row)===branch));
 const errors=state.sources.filter(source=>source.error).map(source=>({table:source.table,branch:source.scope,error:source.error}));
 if(errors.length===state.sources.length&&state.sources.every(source=>!source.docs.length))throw errors[0].error;
 const normalized=normalizeInventoryHistory(kind,sources),branches=[...new Set([...names,...normalized.map(row=>row.branch).filter(Boolean)])].filter(name=>historyScopeAllows(context,name));
 return {kind,period,rows:normalized,branches,loadedAt:state.loadedAt,partial:state.sources.some(source=>source.more)||errors.length>0||directory.partial,hasMore:state.sources.some(source=>source.more),errors,legacy};
}
export function historyReadError(error){
 const code=String(error?.code||'');if(/resource-exhausted|quota/i.test(code+' '+error?.message))return 'The database read quota is exhausted. This report cannot finish until quota is available again. Your records are unchanged; no automatic retry loop is running.';
 if(/permission-denied|unauthenticated/.test(code))return 'The database did not allow this history query. Refresh your approved account access before retrying.';
 if(/failed-precondition/.test(code)&&/index/i.test(error?.message||''))return 'This branch history query needs a database index. Try All permitted branches if your access allows it, or ask the Owner to review the query index.';
 return error?.message||'History could not load. Check the connection and try again.';
}
export async function previewRestockReversal(api,id){
 if(typeof id!=='string'||!id||id.includes('/'))throw Error('Choose a saved invoice.');
 const context=await inventoryHistoryAccess(api,'Invoices');if(!canOpenInventoryTab(context.session,'Overview')||!historyScopeAllows(context,'Main Office'))throw Error('Your saved permissions do not allow Main Office stock changes.');
 const snapshot=await serverRead(api,'invoice:'+context.actor.uid+':'+id,()=>api.getDocFromServer(api.doc(api.db,'hq_restocks',id)));if(!snapshot.exists())throw Error('This restock invoice no longer exists. Refresh the report.');
 const invoice={...snapshot.data(),id};restockReversalPlan(invoice,invoice.inventoryEffects?.map(effect=>({...effect.after,id:effect.inventoryId}))||[]);
 const effects=await Promise.all(invoice.inventoryEffects.map(effect=>serverRead(api,'inventory:'+context.actor.uid+':'+effect.inventoryId,()=>api.getDocFromServer(api.doc(api.db,'inventory',effect.inventoryId)))));
 const current=effects.filter(row=>row.exists()).map(row=>({...row.data(),id:row.id})),plan=restockReversalPlan(invoice,current);
 return {context:{actor:context.actor,session:context.session},invoice,current,plan};
}
export async function restockReversalWasApplied(api,preview){
 const context=await inventoryHistoryAccess(api,'Invoices');
 if(!preview?.invoice?.id||!same(context.actor,preview.context?.actor)||!historyScopeAllows(context,'Main Office'))return false;
 const key='inventory_restock_reversal_'+encodeURIComponent(preview.invoice.id),snapshot=await serverRead(api,'reversal-receipt:'+context.actor.uid+':'+key,()=>api.getDocFromServer(api.doc(api.db,'settings',key)));
 return snapshot.exists()&&snapshot.data().invoiceId===preview.invoice.id&&snapshot.data().actorUid===context.actor.uid;
}
export async function commitRestockReversal(api,preview){
 const id=preview?.invoice?.id;if(!id)throw Error('Open the invoice reversal preview first.');
 const context=await inventoryHistoryAccess(api,'Invoices');if(!canOpenInventoryTab(context.session,'Overview')||!historyScopeAllows(context,'Main Office')||!same(context.actor,preview.context?.actor))throw Error('Your saved permissions or signed-in account changed. Reopen this invoice.');
 const ref=(table,key)=>api.doc(api.db,table,key),markerRef=ref('settings','inventory_restock_reversal_'+encodeURIComponent(id));
 return api.runTransaction(api.db,async tx=>{
  const freshRecords=[];for(const record of context.records){const snap=await tx.get(ref('hq_managers',record.id));if(snap.exists())freshRecords.push({id:snap.id,data:snap.data()});}
  const account=resolveHQAccount(freshRecords),session=createWorkspaceSession(context.actor,account),freshContext={actor:context.actor,session};
  if(account.blocked===true||!canOpenInventoryTab(session,'Invoices')||!canOpenInventoryTab(session,'Overview')||!historyScopeAllows(freshContext,'Main Office')||!same(context.actor,sessionIdentity(api)))throw Error('Your saved access changed. Reopen this invoice.');
  const marker=await tx.get(markerRef);if(marker.exists()){if(marker.data().actorUid!==context.actor.uid)throw Error('Another authorized account already reverted this invoice. Refresh its history.');return {status:'already-applied',invoiceId:id};}
  const invoiceSnap=await tx.get(ref('hq_restocks',id));if(!invoiceSnap.exists()||!same(invoiceSnap.data(),(({id:ignore,...data})=>data)(preview.invoice)))throw Error('The invoice changed after the preview. Reopen it before reverting.');
  const current=[],savedDocuments=new Map();for(const effect of preview.invoice.inventoryEffects){const snap=await tx.get(ref('inventory',effect.inventoryId));if(snap.exists()){current.push({...snap.data(),id:snap.id});savedDocuments.set(snap.id,snap.data());}}
  const plan=restockReversalPlan(preview.invoice,current);if(!same(plan,preview.plan))throw Error('The affected stock changed after the preview. Reopen this invoice.');
  const logRefs=plan.map((effect,index)=>ref('stock_logs','restock_reversal_'+encodeURIComponent(id)+'_'+index));
  for(const logRef of logRefs){const snap=await tx.get(logRef);if(snap.exists())throw Error('An audit record already exists for this invoice. Refresh its history.');}
  for(const [index,effect] of plan.entries()){
   const restored={...savedDocuments.get(effect.id),...effect.restored};for(const key of effect.removedFields)delete restored[key];tx.set(ref('inventory',effect.id),restored);
   tx.set(logRefs[index],{branch:'Main Office',inventoryId:effect.id,item:effect.name,oldQty:effect.before.currentStock,newQty:effect.restored.currentStock,variance:effect.restored.currentStock-effect.before.currentStock,uom:effect.unit,type:'HQ Restock Reverted',note:'Invoice '+id+' reverted with its recorded cost snapshots.',invoiceId:id,user:session.cashierName||context.actor.email,actorUid:context.actor.uid,timestamp:api.serverTimestamp()});
  }
  tx.update(ref('hq_restocks',id),{status:'Reverted',revertedAt:api.serverTimestamp(),revertedBy:context.actor.email,revertedByUid:context.actor.uid});
  tx.set(markerRef,{invoiceId:id,actorUid:context.actor.uid,actorEmail:context.actor.email,timestamp:api.serverTimestamp()});
  return {status:'saved',invoiceId:id};
 });
}
export async function directWasteDirectory(api){
 const context=await inventoryHistoryAccess(api,'Waste'),snap=await serverRead(api,'waste-directory:'+context.actor.uid,()=>api.getDocsFromServer(api.query(api.collection(api.db,'branches'),api.limit(251))));
 if(snap.docs.length>250)throw Error('The branch list is too large. Ask the Owner to review its directory.');
 const branches=[...new Set([...rows(snap).map(row=>row.name),...context.session.allowedBranches.filter(name=>name.toLowerCase()!=='all'),'Main Office'].filter(name=>typeof name==='string'&&historyScopeAllows(context,name)))].sort();
 return {context,branches};
}
export async function directWasteInventory(api,branch){
 const context=await inventoryHistoryAccess(api,'Waste');if(!historyScopeAllows(context,branch))throw Error('Choose a branch in your saved access.');
 const snap=await serverRead(api,'waste-inventory:'+context.actor.uid+':'+branch,()=>api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==',branch),api.limit(1001))));
 if(snap.docs.length>1000)throw Error('This branch has too many items to load in one picker. Review its inventory directory.');
 return rows(snap).filter(row=>row.branch===branch).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
}
export function directWasteUnits(item){
 const baseUom=typeof (item.baseUom||item.uom)==='string'?(item.baseUom||item.uom).trim():'',purchaseUom=typeof (item.purchaseUom||item.purchUom||baseUom)==='string'?(item.purchaseUom||item.purchUom||baseUom).trim():'',saved=item.conversionRate??item.conversion;
 const conversionRate=saved==null&&baseUom.toLowerCase()===purchaseUom.toLowerCase()?1:historyNumber(saved);
 if(!baseUom||!purchaseUom||conversionRate===null||conversionRate<=0)throw Error('The saved units or package conversion need review before logging waste.');
 return {baseUom,purchaseUom,conversionRate};
}
export async function commitDirectWasteCart(api,cart,{operationId}={}){
 if(!Array.isArray(cart)||!cart.length||cart.length>150||typeof operationId!=='string'||!operationId||operationId.length>180)throw Error('Choose 1–150 waste lines and a valid save attempt.');
 const context=await inventoryHistoryAccess(api,'Waste'),intent=cart.map(item=>{
  if(typeof item.id!=='string'||!item.id||item.id.includes('/')||typeof item.name!=='string'||!item.name.trim()||!historyScopeAllows(context,item.branch))throw Error('A waste item is missing or outside your saved branch access.');
  const rawQty=historyNumber(item.rawQty);if(rawQty===null||rawQty<=0||rawQty>Number.MAX_SAFE_INTEGER||!['base','purchase'].includes(item.unitKind))throw Error('Enter a positive waste quantity with a valid stock unit.');
  if(typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>4000)throw Error('Record a reason for every waste line.');
  const proof=safeHistoryProof(item.photoUrl||'');if(item.photoUrl&&!proof)throw Error('A waste proof link is invalid.');
  return {id:item.id,name:item.name,branch:item.branch,rawQty,unitKind:item.unitKind,conversionRate:item.conversionRate,baseUom:item.baseUom,purchaseUom:item.purchaseUom,reason:item.reason.trim(),photoUrl:proof};
 }),fingerprint=recipeFingerprint(intent),ref=(table,id)=>api.doc(api.db,table,id),markerRef=ref('settings','inventory_waste_'+encodeURIComponent(operationId));
 return api.runTransaction(api.db,async tx=>{
  const records=[];for(const record of context.records){const snap=await tx.get(ref('hq_managers',record.id));if(snap.exists())records.push({id:snap.id,data:snap.data()});}
  const account=resolveHQAccount(records),session=createWorkspaceSession(context.actor,account),fresh={actor:context.actor,session};
  if(account.blocked===true||!canOpenInventoryTab(session,'Waste')||!same(context.actor,sessionIdentity(api))||intent.some(item=>!historyScopeAllows(fresh,item.branch)))throw Error('Your saved access changed. Reopen the waste log.');
  const marker=await tx.get(markerRef);if(marker.exists()){if(marker.data().actorUid!==context.actor.uid||marker.data().fingerprint!==fingerprint)throw Error('This save attempt belongs to different waste details. Reopen the waste log.');return {status:'already-applied',records:marker.data().records};}
  const stock=new Map();for(const id of [...new Set(intent.map(item=>item.id))]){const snap=await tx.get(ref('inventory',id));if(!snap.exists())throw Error('A waste item no longer exists. Reopen the log.');stock.set(id,{...snap.data()});}
  const logs=intent.map((item,index)=>{
   const saved=stock.get(item.id),units=directWasteUnits(saved),oldQty=historyNumber(saved.currentStock);
   if(saved.name!==item.name||saved.branch!==item.branch||units.baseUom!==item.baseUom||units.purchaseUom!==item.purchaseUom||units.conversionRate!==item.conversionRate)throw Error('A waste item or its units changed. Reopen the log.');
   const quantity=item.rawQty*(item.unitKind==='purchase'?units.conversionRate:1),difference=oldQty===null?null:oldQty-quantity,tolerance=Math.max(1,Math.abs(oldQty||0),Math.abs(quantity))*Number.EPSILON*8,newQty=difference!==null&&Math.abs(difference)<=tolerance?0:difference;
   if(oldQty===null||oldQty<0||oldQty>Number.MAX_SAFE_INTEGER||!Number.isFinite(quantity)||quantity>Number.MAX_SAFE_INTEGER||newQty===null||!Number.isFinite(newQty)||newQty<0)throw Error('Recorded stock cannot cover this waste quantity. Review the branch count before logging it; no balance was changed.');
   saved.currentStock=newQty;const cost=historyNumber(saved.baseCost),knownCost=cost!==null&&cost>=0&&Number.isFinite(cost*quantity),valueLost=knownCost?cost*quantity:null;
   return {id:'manager_waste_'+encodeURIComponent(operationId)+'_'+index,data:{branch:item.branch,inventoryId:item.id,item:item.name,uom:units.baseUom,oldQty,newQty,variance:-quantity,qtyWasted:quantity,rawQty:item.rawQty,purchaseUom:units.purchaseUom,conversionRate:units.conversionRate,unitKind:item.unitKind,type:'Waste / Spoilage',note:item.reason,user:session.cashierName||context.actor.email,actorUid:context.actor.uid,actorEmail:context.actor.email,operationId,photoUrl:item.photoUrl,valueLost,costSnapshot:knownCost?{baseUnitCost:cost}:null,timestamp:api.serverTimestamp()}};
  });
  for(const log of logs){const snapshot=await tx.get(ref('stock_logs',log.id));if(snapshot.exists())throw Error('An audit already exists for this waste save. Refresh its branch history.');}
  if(!same(context.actor,sessionIdentity(api)))throw Error('The signed-in account changed. Reopen the waste log.');
  for(const [id,saved] of stock)tx.update(ref('inventory',id),{currentStock:saved.currentStock});for(const log of logs)tx.set(ref('stock_logs',log.id),log.data);
  tx.set(markerRef,{actorUid:context.actor.uid,actorEmail:context.actor.email,fingerprint,records:logs.length,timestamp:api.serverTimestamp()});return {status:'saved',records:logs.length};
 });
}
