import {allocateFranchiseDispatchInvoices,supplyFingerprint,validateSupplyDispatchInvoice} from './franchise-supply-model.js';
import {franchiseCostedItem} from './franchise-cost-model.js';
import {franchiseSupplyQuote} from './operations-model.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {createWorkspaceSession,canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';

const quoteState=orders=>orders.map(row=>({id:row.id,branch:row.branch,quoteVersion:row.quoteVersion,items:row.items,supplyInvoice:row.supplyInvoice}));
export const franchiseDispatchFingerprint=orders=>supplyFingerprint(quoteState(orders));
export function planFranchiseDispatch(orders,items,{id,uid,email}={}) {
 if(!orders.some(row=>row.quoteVersion===2))return [];
 if(orders.some(row=>row.quoteVersion!==2))throw Error('Send priced franchise requests separately from older stock requests.');
 return allocateFranchiseDispatchInvoices(orders,items.map((item,index)=>{if(item.reference?.id&&item.hqItemId&&item.reference.id!==item.hqItemId)throw Error('The resolved stock does not match the priced HQ item. Reload the request.');return {...item,dispatchLogId:id+'-'+index,hqItemId:item.reference?.id||item.hqItemId,qty:item.quantity??item.qty};}),{dispatchBatchId:id,actorUid:uid,actorEmail:email});
}
export async function previewFranchiseDispatchPricing(api,draft) {
 if(!draft.purchaseOrderIds?.length)return null;
 const rows=await Promise.all(draft.purchaseOrderIds.map(async id=>{const snap=await api.getDocFromServer(api.doc(api.db,'purchase_orders',id));if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('A linked request could not be confirmed. Refresh Dispatch.');const stub={...snap.data(),id};if(stub.quoteVersion!==2)return stub;const full=await api.getDocFromServer(api.doc(api.db,'franchise_supply_orders',id));if(!full.exists()||full.metadata?.fromCache||full.metadata?.hasPendingWrites)throw Error('The protected supply order could not be confirmed.');const order={...full.data(),id};if(order.quoteVersion!==2||order.branch!==stub.branch||supplyFingerprint(order.dispatchItems)!==supplyFingerprint(stub.items))throw Error('The priced order and logistics request do not agree. Ask HQ to review them.');return order;}));
 if(!rows.some(row=>row.quoteVersion===2))return null;
 if(draft.source!=='Main Office'||rows.some(row=>row.branch!==draft.destination))throw Error('Review the source and destination of this priced request.');
 const plans=planFranchiseDispatch(rows,draft.items,{id:'preview',uid:api.auth.currentUser.uid,email:api.auth.currentUser.email});
 if(plans.some(plan=>plan.dispatchInvoice.unpricedItems))throw Error('Some sent items still need an HQ supply quote. Configure their supply price and request a fresh priced order before dispatch.');
 return {version:1,fingerprint:franchiseDispatchFingerprint(rows),orders:plans.map(plan=>({orderId:plan.orderId,lines:plan.dispatchInvoice.lines,total:plan.dispatchInvoice.grandTotal})),grandTotal:Math.round(plans.reduce((sum,plan)=>sum+plan.dispatchInvoice.grandTotal,0)*100)/100};
}
// A customer's submitted quote is not authority to set an HQ charge. Recheck
// the Owner's current saved pricing and every BOM dependency before invoicing.
export async function verifyFranchiseDispatchPricing(api,tx,{orders,plans,inventory,recipes,recipeRevision,identity,accountRows,destination}) {
 const accounts=[];for(const row of accountRows){const snap=await tx.get(api.doc(api.db,'hq_managers',row.id));if(snap.exists())accounts.push({id:row.id,data:snap.data()});}
 if(!accounts.length||accounts.some(row=>String(row.data.email).toLowerCase()!==identity.email))throw Error('Your saved HQ identity changed. Reopen Dispatch.');
 const account=resolveHQAccount(accounts),saved=createWorkspaceSession(api.auth.currentUser,account);
 if(account.blocked||account.active===false||account.archived===true||/^(REVOKED|BLOCKED)$/i.test(savedPin(account))||saved.isFranchisee||!canOpenWorkspacePage(saved,'dispatch')||!saved.isOwner&&!saved.allowedBranches.includes('All')&&(!saved.allowedBranches.includes('Main Office')||!saved.allowedBranches.includes(destination)))throw Error('Your saved HQ dispatch access changed. Ask the Owner to review access.');
 if(identity.email!==OWNER_EMAIL){const snap=await tx.get(api.doc(api.db,'hq_email_access',identity.email)),grant=snap.exists()?snap.data():{};if(grant.active!==true||!Array.isArray(grant.permissions)||!grant.permissions.some(value=>['all','b2b','dispatch'].includes(value))||!Array.isArray(grant.allowedBranches)||!grant.allowedBranches.includes('All')&&(!grant.allowedBranches.includes('Main Office')||!grant.allowedBranches.includes(destination)))throw Error('Your protected HQ dispatch access changed.');}
 for(const order of orders){
  if(order.sourceOrderId){
   const snap=await tx.get(api.doc(api.db,'franchise_supply_orders',order.sourceOrderId));if(!snap.exists())throw Error('The original partial order is missing. Ask HQ to review this balance.');const source={...snap.data(),id:order.sourceOrderId};
   const invoice=validateSupplyDispatchInvoice(source),prior=allocateFranchiseDispatchInvoices([source],invoice.lines.map(line=>({dispatchLogId:line.dispatchLogId,hqItemId:line.hqItemId,purchaseOrderId:source.id,purchaseOrderLineIndex:line.orderLineIndex,qty:line.baseQty})),{dispatchBatchId:invoice.dispatchBatchId,actorUid:invoice.approvedByUid,actorEmail:invoice.approvedByEmail})[0];
   if(source.branch!==order.branch||source.status!=='Completed'||supplyFingerprint(prior.residualItems)!==supplyFingerprint(order.items)||supplyFingerprint(prior.residualInvoice)!==supplyFingerprint(order.supplyInvoice))throw Error('The remaining supply quantities or cents do not match the original HQ invoice.');
  }else if(order.items.some(item=>(item.supplyQuote?.roundingAdjustmentCents??0)!==0))throw Error('An original supply quote cannot adjust the agreed line total. Request a fresh quote.');
 }
 const revision=await tx.get(api.doc(api.db,'settings','recipe_revision'));
 const value=revision.exists()?revision.data():{};
 if(supplyFingerprint({version:value.version??0,revisionId:value.revisionId||''})!==supplyFingerprint(recipeRevision))throw Error('HQ recipe pricing changed. Review Dispatch again.');
 const stock=new Map(inventory.map(row=>[row.id,row])),recipe=new Map(recipes.map(row=>[row.id,row])),usedStock=new Set(),usedRecipe=new Set();
 for(const plan of plans)for(const line of plan.dispatchInvoice.lines){
  const item=orders.find(row=>row.id===plan.orderId).items[line.orderLineIndex],saved=stock.get(line.hqItemId);
  if(!saved)throw Error('A priced HQ item is missing. Refresh Dispatch.');
  const context=franchiseCostedItem(saved,inventory,recipes);
  context.inventoryDependencies.forEach(row=>usedStock.add(row.id));context.recipeDependencies.forEach(row=>usedRecipe.add(row.id));
  if(!item.supplyQuote||line.total==null)throw Error('This item needs a saved HQ quote before an invoice can be issued.');
 }
 for(const id of usedStock){const snap=await tx.get(api.doc(api.db,'inventory',id));if(!snap.exists())throw Error('An HQ ingredient is missing. Refresh the supply price.');stock.set(id,{...snap.data(),id});}
 for(const id of usedRecipe){const snap=await tx.get(api.doc(api.db,'bom',id));if(!snap.exists())throw Error('An HQ recipe changed. Refresh the supply price.');recipe.set(id,{...snap.data(),id});}
 const currentInventory=[...stock.values()],currentRecipes=[...recipe.values()];
 for(const plan of plans)for(const line of plan.dispatchInvoice.lines){
  const item=orders.find(row=>row.id===plan.orderId).items[line.orderLineIndex],saved=stock.get(line.hqItemId);
  const rate=item.displayUom===saved.uom?1:item.displayUom===(saved.purchaseUom||saved.purchUom)?Number(saved.conversionRate??saved.conversion??saved.convRate):NaN;
  if(saved.branch!=='Main Office'||saved.allowRequest!==true||saved.name!==line.name||saved.uom!==line.baseUom||rate!==line.conversionRate)throw Error('The saved HQ item or units changed. Request a fresh supply quote before dispatch.');
  const context=franchiseCostedItem(saved,currentInventory,currentRecipes),quote=franchiseSupplyQuote(context.item,{quantity:item.displayQty,conversionRate:rate});
  if(quote.unitPrice!==line.unitPrice)throw Error('HQ supply prices changed since this order. Review a fresh priced request before dispatch; no delivery or charge was saved.');
 }
}
