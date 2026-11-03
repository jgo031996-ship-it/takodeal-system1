import {inventoryHistoryAccess,historyScopeAllows} from './inventory-history-services.js';
import {historyMillis,historyNumber} from './inventory-history-model.js';
import {isWasteReport,wasteReportLines,wasteUnitKey} from './waste-report-model.js';
import {resolveHQAccount} from './hq-account-model.js';
import {createWorkspaceSession,canOpenInventoryTab} from './workspace-access-model.js';
import {recipeFingerprint} from './recipe-changes.js';
export const wasteReviewActorKey=api=>JSON.stringify([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.allowedBranches,api.sessionUser?.permissions]);
const identity=wasteReviewActorKey;
const snapshotData=snap=>snap.exists()?{...snap.data(),id:snap.id}:null;
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=250&&!id.includes('/');
export async function previewWasteReport(api,id){
 if(!validId(id))throw Error('Open a saved waste report.');const context=await inventoryHistoryAccess(api,'Waste'),stamp=identity(api);
 const snap=await api.getDocFromServer(api.doc(api.db,'staff_requests',id));if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to HQ to review this saved report.');
 const request=snapshotData(snap);if(!request||!isWasteReport(request)||!historyScopeAllows(context,request.branch)||identity(api)!==stamp)throw Error('This waste report is unavailable or outside your saved access.');
 return {request,sourceFingerprint:recipeFingerprint(request),actorKey:stamp,canReview:canOpenInventoryTab(context.session,'Waste')};
}
export async function reviewWasteReport(api,preview,{decision,reply=''}={}){
 if(!['Approved','Rejected'].includes(decision)||!validId(preview?.request?.id)||typeof preview.sourceFingerprint!=='string')throw Error('Review the saved waste report before deciding.');
 const context=await inventoryHistoryAccess(api,'Waste'),stamp=identity(api);if(stamp!==preview.actorKey)throw Error('Your signed-in account changed. Reopen the report.');
 const note=String(reply).trim();if(note.length>4000)throw Error('Keep the review note within 4,000 characters.');
 const ref=(table,id)=>api.doc(api.db,table,id),id=preview.request.id;
 return api.runTransaction(api.db,async tx=>{
  const guard=()=>{if(identity(api)!==stamp)throw Error('Your signed-in account changed. Reopen the report.');};guard();
  const accounts=[];for(const account of context.records){const snap=await tx.get(ref('hq_managers',account.id));if(snap.exists())accounts.push({id:snap.id,data:snap.data()});}
  const account=resolveHQAccount(accounts),session=createWorkspaceSession(context.actor,account),fresh={actor:context.actor,session};
  const request=snapshotData(await tx.get(ref('staff_requests',id)));guard();
  if(account.blocked===true||!canOpenInventoryTab(session,'Waste')||!request||!isWasteReport(request)||!historyScopeAllows(fresh,request.branch))throw Error('Your saved inventory access or this report changed. Reopen it.');
  if(request.status!=='Pending'){
   if(request.status===decision&&request.wasteReview?.version===1&&request.wasteReview.sourceFingerprint===preview.sourceFingerprint)return {status:'already-applied',decision};
   throw Error('This report was already reviewed. Its decision and stock history were kept; refresh inventory history.');
  }
  if(recipeFingerprint(request)!==preview.sourceFingerprint)throw Error('The report changed after you opened it. Refresh its details before deciding.');
  const logs=[],stock=new Map();
  if(decision==='Approved'){
   const lines=wasteReportLines(request),at=historyMillis(request.timestamp);if(at===null)throw Error('The original report date needs review before stock can be deducted.');
   for(const itemId of [...new Set(lines.map(line=>line.id))]){const snap=await tx.get(ref('inventory',itemId));if(!snap.exists())throw Error('A reported inventory item no longer exists. No stock was changed.');stock.set(itemId,{...snap.data()});}
   for(let index=0;index<lines.length;index++){const logId='waste_report_'+encodeURIComponent(id)+'_'+index;if((await tx.get(ref('stock_logs',logId))).exists())throw Error('An audit already exists for this pending report. Review it before changing stock.');logs.push({id:logId,line:lines[index]});}
   for(const log of logs){const item=log.line,saved=stock.get(item.id),oldQty=historyNumber(saved.currentStock),unit=saved.baseUom||saved.uom;
    if(saved.branch!==request.branch||saved.name!==item.name||wasteUnitKey(unit)!==wasteUnitKey(item.unit))throw Error('A reported item, branch or unit changed. Review its original details before approval.');
    const delta=oldQty===null?null:oldQty-item.quantity,tolerance=Math.max(1,Math.abs(oldQty||0),item.quantity)*Number.EPSILON*8,newQty=delta!==null&&Math.abs(delta)<=tolerance?0:delta;
    if(oldQty===null||oldQty<0||oldQty>Number.MAX_SAFE_INTEGER||newQty===null||!Number.isFinite(newQty)||newQty<0)throw Error('The saved stock cannot cover this reported loss. Review the branch count first; no stock was changed.');
    saved.currentStock=newQty;const cost=historyNumber(saved.baseCost),value=cost!==null&&cost>=0&&Number.isFinite(cost*item.quantity)?cost*item.quantity:null;
    log.data={branch:request.branch,inventoryId:item.id,item:item.name,uom:unit,oldQty,newQty,variance:-item.quantity,qtyWasted:item.quantity,type:'Waste / Spoilage (HQ Approved)',note:item.reason,user:request.staffName||'Staff not recorded',timestamp:new Date(at),photoUrl:item.proof,requestId:id,sourceWasteReportId:id,valueLost:value,costSnapshot:{baseUnitCost:cost!==null&&cost>=0?cost:null},approvedAt:api.serverTimestamp(),approvedBy:context.actor.email,approvedByUid:context.actor.uid};
   }
  }
  guard();const reviewedAt=api.serverTimestamp();
  for(const [itemId,saved]of stock)tx.update(ref('inventory',itemId),{currentStock:saved.currentStock});
  for(const log of logs)tx.set(ref('stock_logs',log.id),log.data);
  tx.update(ref('staff_requests',id),{status:decision,managerReply:note,processedAt:reviewedAt,processedBy:session.cashierName||context.actor.email,processedByUid:context.actor.uid,wasteReview:{version:1,sourceFingerprint:preview.sourceFingerprint,decision,stockApplied:decision==='Approved',logIds:logs.map(log=>log.id)}});
  return {status:'saved',decision,stockLines:logs.length};
 });
}
