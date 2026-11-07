// Read-only recovery planning. The caller publishes a confirmed local cart;
// the ordinary Send transaction remains responsible for stock and request writes.
import {captureDispatchAuthority,assertDispatchRequestAvailable} from './dispatch-safety.js';
import {canonicalDispatchIntent} from './dispatch-restock-model.js';

const text=value=>typeof value==='string'?value.trim():'';
const unit=value=>text(value).toLowerCase();
const number=value=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;
const close=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!value.includes('/');
const active=row=>row?.active!==false&&!/^(inactive|disabled|blocked|deleted|closed)$/i.test(text(row?.status));
const requestName=row=>row?.itemName||row?.name;
function validateCopy(copy,uid){
 // Full branch references also retain zero-quantity rows. The ordinary Send
 // transaction limits its actual positive-item writes when delivery is chosen.
 if(!copy||copy.version!==1||copy.actorUid!==uid||!Array.isArray(copy.items)||!copy.items.length||!Array.isArray(copy.purchaseOrderIds)||copy.purchaseOrderIds.some(id=>!validId(id)))throw Error('This saved quantity reference needs review. Keep it and reopen the correct stock request.');
 if(copy.recovery?.loadedAt)throw Error('These saved quantities were already loaded into a cart. Review that draft or its saved delivery; the reference is kept for viewing.');
 if(!text(copy.source)||!text(copy.destination)||copy.source===copy.destination||copy.source!==text(copy.source)||copy.destination!==text(copy.destination))throw Error('The saved quantity reference has an unclear route.');
}
function compatibleRequest(row,copy){
 assertDispatchRequestAvailable(row,{id:row.id,source:copy.source,destination:copy.destination});
 if((row.sourceBranch??'Main Office')!==copy.source||row.quoteVersion===2)throw Error('Review the current request and its protected pricing instead of reloading this reference.');
 if(!Array.isArray(row.items)||!row.items.length)throw Error('The stock request has no valid item list.');
 const names=new Set(row.items.map(requestName));
 const savedNames=new Set(copy.items.map(requestName));if(copy.items.some(item=>!names.has(requestName(item)))||[...names].some(name=>!savedNames.has(name)))throw Error('This stock request has a different item list. Review all its items through the normal stock request screen.');
 return row;
}
const requestEvidence=row=>({id:row.id,status:row.status||'',branch:row.branch||'',sourceBranch:row.sourceBranch??'Main Office',destinationBranch:row.destinationBranch??null,quoteVersion:row.quoteVersion??null,dispatchBatchId:row.dispatchBatchId||'',completed:!!row.completedAt,mergedInto:row.mergedInto||'',items:(Array.isArray(row.items)?row.items:[]).map(item=>({name:requestName(item)||'',qty:item.qty??null,baseUom:item.baseUom||item.uom||'',purchaseUom:item.purchaseUom||'',conversionRate:item.conversionRate??item.convRate??null}))});
function recoveryItems(copy,stocks,requests){
 const used=new Set();
 const items=copy.items.map(saved=>{
  const name=requestName(saved);if(typeof name!=='string'||!name.trim()||used.has(name)||saved.purchaseOrderId)throw Error('The saved items are duplicated or belong to a priced order. Review the stock request instead.');used.add(name);
  const matching=stocks.filter(row=>row.name===name&&row.branch===copy.source);
  if(matching.length!==1||!active(matching[0]))throw Error('Missing, inactive or duplicate source inventory item: '+name+'. Review Inventory before loading these quantities.');
  const stock=matching[0],base=text(stock.uom||stock.baseUom),purchase=text(stock.purchaseUom||stock.purchUom)||base,conversion=stock.conversionRate??stock.conversion??(unit(base)===unit(purchase)?1:NaN),rate=number(conversion);
  const raw=number(saved.rawQty),qty=number(saved.qty),savedRate=number(saved.convRate),savedBase=saved.baseUom||saved.uom,display=saved.friendlyUom||(saved.selectedUom==='purch'?saved.purchaseUom:savedBase);
  if(!base||!purchase||!Number.isFinite(rate)||rate<=0||unit(base)===unit(purchase)&&!close(rate,1)||!Number.isFinite(raw)||raw<0||!Number.isFinite(qty)||qty<0||!Number.isFinite(savedRate)||savedRate<=0||!close(raw*savedRate,qty))throw Error('The saved quantity or source conversion for '+name+' needs review.');
  const currentRate=unit(display)===unit(base)?1:unit(display)===unit(purchase)?rate:NaN;
  if(unit(savedBase)!==unit(base)||!close(savedRate,currentRate)||saved.conversionRate!=null&&!close(number(saved.conversionRate),rate)||saved.sourceId&&saved.sourceId!==stock.id)throw Error('Units or package conversion changed for '+name+'. The saved quantities were kept; review the current stock request before entering them again.');
  let original=qty;
  if(requests.length){original=0;for(const request of requests)for(const entry of request.items)if(requestName(entry)===name){const requested=number(entry.qty);if(!Number.isFinite(requested)||requested<0||((entry.baseUom||entry.uom)&&unit(entry.baseUom||entry.uom)!==unit(base)))throw Error('The current request units or quantities for '+name+' need review.');original+=requested;}}
  if(!Number.isFinite(original)||!Number.isFinite(number(stock.currentStock)))throw Error('The current quantity for '+name+' needs Inventory review.');
  const item={name,itemName:name,sourceId:stock.id,qty,rawQty:raw,origBaseQty:original,origRawQty:original/savedRate,convRate:savedRate,conversionRate:rate,baseUom:base,uom:base,purchaseUom:purchase,friendlyUom:currentRate===1&&unit(display)===unit(base)?base:purchase,selectedUom:unit(display)===unit(base)?'base':'purch',hqStock:number(stock.currentStock),category:stock.category||'Uncategorized'};
  const cost=number(stock.baseCost);if(Number.isFinite(cost)&&cost>=0){item.cost=cost;item.baseCost=cost;}
  return item;
 });
 if(!items.some(item=>item.qty>0))throw Error('The saved reference has no positive quantities to load.');return items;
}
async function checkSavedAttempts(api,copy,guard){
 for(const [kind,table,prefix]of [['dispatch','settings','dispatch_commit_'],['setAside','purchase_orders','']]){
  const raw=copy.attempts?.[kind];if(!raw)continue;let pending;try{pending=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('The saved reference includes an unclear save attempt. Review the delivery feed before reloading it.');}
  if(!validId(pending?.id))throw Error('The saved reference includes an invalid save attempt. Review the delivery feed.');
  const saved=await api.getDocFromServer(api.doc(api.db,table,prefix+pending.id));guard();
  const delivery=kind==='dispatch'?await api.getDocFromServer(api.doc(api.db,'dispatch_logs',pending.id+'-0')):null;guard();
  if(saved.exists()||delivery?.exists())throw Error('A delivery or set-aside copy from this saved reference was already recorded. Review it before preparing another cart.');
  throw Error('An earlier delivery or set-aside save attempt in this reference is still unconfirmed. Review the original operation before loading these quantities; the saved reference is kept.');
 }
}
export async function readDispatchRecoveryPlan(api,copy,{requestId,assertCurrent=()=>{}}={}){
 const identity=captureDispatchAuthority(api,{source:copy?.source,destination:copy?.destination});validateCopy(copy,identity.uid);
 if(identity.session.isFranchisee)throw Error('HQ must review and reload these saved quantities.');
 const guard=()=>{assertCurrent();const current=captureDispatchAuthority(api,{source:copy.source,destination:copy.destination});if(current.session!==identity.session||current.uid!==identity.uid||current.email!==identity.email)throw Error('Your account or Dispatch access changed. Reopen the saved reference.');};guard();
 await checkSavedAttempts(api,copy,guard);
 const [branchSnap,stockSnap]=await Promise.all([api.getDocsFromServer(api.collection(api.db,'branches')),api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==',copy.source)))]);guard();
 const branches=branchSnap.docs.map(row=>({...row.data(),id:row.id})),stocks=stockSnap.docs.map(row=>({...row.data(),id:row.id}));
 for(const name of [copy.source,copy.destination])if(branches.filter(row=>row.name===name&&active(row)).length!==1||branches.filter(row=>row.name===name).length!==1)throw Error('The saved source or destination is missing, inactive or duplicated. Review Branch Management.');
 recoveryItems(copy,stocks,[]);
 const originalIds=[...new Set(copy.purchaseOrderIds)],originals=await Promise.all(originalIds.map(async id=>{const saved=await api.getDocFromServer(api.doc(api.db,'purchase_orders',id));guard();return saved.exists()?{...saved.data(),id}:{id,status:'Missing'};}));
 let selected=[];
 if(requestId){if(!validId(requestId))throw Error('Choose an existing stock request.');const saved=await api.getDocFromServer(api.doc(api.db,'purchase_orders',requestId));guard();if(!saved.exists())throw Error('That stock request was removed. Reopen the saved reference.');selected=[compatibleRequest({...saved.data(),id:requestId},copy)];}
 else if(originals.length){try{for(const row of originals)assertDispatchRequestAvailable(row,{id:row.id,source:copy.source,destination:copy.destination});const names=new Set(originals.flatMap(row=>Array.isArray(row.items)?row.items.map(requestName):[])),savedNames=new Set(copy.items.map(requestName));if(originals.some(row=>row.quoteVersion===2||(row.sourceBranch??'Main Office')!==copy.source)||copy.items.some(item=>!names.has(requestName(item)))||[...names].some(name=>!savedNames.has(name)))throw Error('Original requests need replacement.');selected=originals;}catch{/* A closed original link must never be reopened. */}}
 if(!selected.length){
  const result=await api.getDocsFromServer(api.query(api.collection(api.db,'purchase_orders'),api.where('branch','==',copy.destination),api.where('status','in',['Pending','Drafting','Delayed','Approved']),api.limit(101)));guard();
  if(result.docs.length>100)throw Error('More than 100 open stock requests need review for this branch. Open or consolidate the correct request in Dispatch first; your saved quantities are kept.');
  const candidates=result.docs.map(row=>({...row.data(),id:row.id})).filter(row=>{try{compatibleRequest(row,copy);recoveryItems(copy,stocks,[row]);return true;}catch{return false;}}).sort((a,b)=>a.id.localeCompare(b.id));
  if(!candidates.length)throw Error('No compatible open stock request is available for these saved items. Open or create the correct stock request, then return here. Your saved quantities are kept.');
  return {needsRequest:true,candidates:candidates.map(row=>({id:row.id,label:row.id+' · '+(row.requestedBy||row.type||row.status)}))};
 }
 const plan={source:copy.source,destination:copy.destination,items:recoveryItems(copy,stocks,selected),purchaseOrderIds:selected.map(row=>row.id).sort(),removedRequestIds:originalIds.filter(id=>!selected.some(row=>row.id===id)),originalRequests:originals.map(requestEvidence),requests:selected.map(requestEvidence)};guard();
 return {...plan,fingerprint:canonicalDispatchIntent(plan)};
}
