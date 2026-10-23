import {franchiseCostedItem} from './franchise-cost-model.js';
import {canVisit} from './franchise-data.js';
import {franchiseSupplyQuote} from './operations-model.js';
import {resolveHQAccount} from './hq-account-model.js';
import {createWorkspaceSession} from './workspace-access-model.js';
import {MAX_SUPPLY_LINES,cleanSupplyItem,supplyDispatchItems,priceOnlySupplyQuote,supplyTotals,supplyFingerprint,supplyOrderView,supplyOrderDisplay,validateSupplyDispatchInvoice,deliveryReceiptVerification,validateSupplySignature} from './franchise-supply-model.js';
const identities=new WeakMap(),same=(a,b)=>supplyFingerprint(a)===supplyFingerprint(b);
const ref=(api,table,id)=>api.doc(api.db,table,id);
const requesterName=session=>typeof session?.cashierName==='string'&&session.cashierName.trim()&&!session.cashierName.includes('@')?session.cashierName.trim():'Franchise requester';
function actor(api){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||user.emailVerified!==true||session?.uid!==user.uid||session?.email?.toLowerCase()!==user.email?.toLowerCase()||!canVisit(session,'b2b'))throw Error('Sign in with approved supply-order access.');
 const identity={uid:user.uid,email:user.email.toLowerCase(),branch:session.branch,name:requesterName(session)};identities.set(identity,{user,session});return identity;
}
function live(api,identity){
 const bound=identities.get(identity),user=api.auth?.currentUser,session=api.sessionUser;
 if(!bound||bound.user!==user||bound.session!==session||!user||user.emailVerified!==true||user.uid!==identity.uid||user.email?.toLowerCase()!==identity.email||session.branch!==identity.branch||requesterName(session)!==identity.name||!canVisit(session,'b2b'))throw Error('The account or branch changed. Reopen your request.');
}
const revision=data=>({version:Number.isSafeInteger(data?.version)?data.version:0,revisionId:data?.revisionId||''});
function quoteItem(data,item,inventory=[],recipes=[]){
 if(data.branch!=='Main Office'||data.allowRequest!==true||data.name!==(item.name??item.itemName))throw Error('This HQ item is no longer available. Refresh the catalog.');
 if(typeof item.displayQty!=='number'||!Number.isFinite(item.displayQty)||item.displayQty<=0)throw Error('Enter a positive supply quantity.');
 const purchase=data.purchaseUom||data.purchUom,rate=item.displayUom===(data.uom||'units')?1:item.displayUom===purchase?Number(data.conversionRate??data.conversion??data.convRate):NaN;
 if(!Number.isFinite(rate)||rate<=0)throw Error('This item’s unit conversion changed. Re-add it to your request.');
 let supplyQuote=null;
 if(data.franchiseMarkupPercent!=null){
  const costed=franchiseCostedItem(data,inventory,recipes),derived=franchiseSupplyQuote(costed.item,{quantity:item.displayQty,conversionRate:rate});
  supplyQuote=priceOnlySupplyQuote({version:2,unitPrice:derived.unitPrice,quantity:item.displayQty,conversionRate:rate},{quantity:item.displayQty,conversionRate:rate,unit:item.displayUom});
 }
 return cleanSupplyItem({hqItemId:item.hqItemId,name:data.name,displayQty:item.displayQty,displayUom:item.displayUom,baseUom:data.uom,convRate:rate,supplyQuote});
}
async function accessRows(api,identity){const snapshot=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',identity.email)));live(api,identity);return snapshot.docs;}
async function checkFreshAccess(api,tx,identity,rows){
 const records=[];for(const row of rows){const snap=await tx.get(ref(api,'hq_managers',row.id));if(snap.exists())records.push({id:row.id,data:snap.data()});}
 const account=resolveHQAccount(records);if(account.blocked===true||account.archived===true)throw Error('This account is blocked.');
 const fresh=createWorkspaceSession(api.auth.currentUser,account);if(fresh.allowedBranches.includes('All'))fresh.allowedBranches=[identity.branch];fresh.branch=identity.branch;
 if(!canVisit(fresh,'b2b'))throw Error('Your saved supply-order access changed.');
 if(identity.email!=='jgo031996@gmail.com'){
  const snap=await tx.get(ref(api,'hq_email_access',identity.email)),access=snap.exists()?snap.data():{};
  if(access.active!==true||!Array.isArray(access.allowedBranches)||!access.allowedBranches.some(branch=>branch==='All'||branch===identity.branch)||!Array.isArray(access.permissions)||!access.permissions.some(permission=>['all','b2b','dispatch'].includes(permission)))throw Error('Your approved branch supply access changed. Ask HQ to review access.');
 }
 live(api,identity);
}
export async function previewSupplyRequest(api,items,{now=Date.now}={}){
 const identity=actor(api);if(!Array.isArray(items)||!items.length||items.length>MAX_SUPPLY_LINES)throw Error('Add 1–80 supply lines first.');
 const before=await api.getDocFromServer(ref(api,'settings','recipe_revision'));
 const [invSnap,bomSnap]=await Promise.all([api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('branch','==','Main Office'))),api.getDocsFromServer(api.collection(api.db,'bom'))]);
 const inventory=invSnap.docs.map(row=>({...row.data(),id:row.id})),recipes=bomSnap.docs.map(row=>({...row.data(),id:row.id})),usedInventory=new Set(),usedRecipes=new Set(),result=[];
 for(const item of items){
  if(typeof item.hqItemId!=='string'||!item.hqItemId||item.hqItemId.includes('/'))throw Error('Refresh the catalog and re-add this item.');
  const snap=await api.getDocFromServer(ref(api,'inventory',item.hqItemId));if(!snap.exists())throw Error('An HQ item no longer exists.');const data={...snap.data(),id:snap.id||item.hqItemId};usedInventory.add(data.id);
  if(data.franchiseMarkupPercent!=null){const context=franchiseCostedItem(data,inventory,recipes);context.inventoryDependencies.forEach(row=>usedInventory.add(row.id));context.recipeDependencies.forEach(row=>usedRecipes.add(row.id));}
  result.push(quoteItem(data,item,inventory,recipes));
 }
 const after=await api.getDocFromServer(ref(api,'settings','recipe_revision')),recipeRevision=revision(before.exists()?before.data():null);
 if(!same(recipeRevision,revision(after.exists()?after.data():null)))throw Error('HQ recipe pricing changed. Review a fresh quote.');
 live(api,identity);return {identity,items:result,totals:supplyTotals(result),inventoryIds:[...usedInventory],recipeIds:[...usedRecipes],recipeRevision,previewedAt:now()};
}
export async function submitSupplyRequest(api,preview,id,{now=Date.now}={}){
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('Reopen your request.');live(api,preview.identity);const identity=preview.identity,access=await accessRows(api,identity),totals=supplyTotals(preview.items),dispatchItems=supplyDispatchItems(preview.items);
 if(!same(totals,preview.totals))throw Error('The supply totals changed. Review a fresh quote.');
 return api.runTransaction(api.db,async tx=>{
  live(api,identity);await checkFreshAccess(api,tx,identity,access);
  const orderRef=ref(api,'franchise_supply_orders',id),stubRef=ref(api,'purchase_orders',id),[saved,stub]=await Promise.all([tx.get(orderRef),tx.get(stubRef)]);
  if(saved.exists()||stub.exists()){const prior=saved.exists()?saved.data():{},logistics=stub.exists()?stub.data():{};if(prior.quoteVersion!==2||prior.branch!==identity.branch||prior.requestedByUid!==identity.uid||!same(prior.items,preview.items)||!same(prior.dispatchItems,dispatchItems)||!same(prior.supplyInvoice,totals)||logistics.quoteVersion!==2||logistics.branch!==identity.branch||logistics.type!=='Franchise Order'||logistics.requestedBy!==identity.name||!same(logistics.items,dispatchItems))throw Error('This request reference has different or incomplete saved details. Refresh history.');return {alreadySaved:true,id};}
  if(!Number.isFinite(preview.previewedAt)||now()<preview.previewedAt||now()-preview.previewedAt>300000)throw Error('This quotation expired. Review the current HQ prices before sending.');
  const revisionSnap=await tx.get(ref(api,'settings','recipe_revision'));if(!same(revision(revisionSnap.exists()?revisionSnap.data():null),preview.recipeRevision))throw Error('HQ recipe pricing changed. Review a fresh quote.');
  const inventory=[],recipes=[];for(const itemId of preview.inventoryIds){const row=await tx.get(ref(api,'inventory',itemId));if(row.exists())inventory.push({...row.data(),id:itemId});}for(const recipeId of preview.recipeIds){const row=await tx.get(ref(api,'bom',recipeId));if(row.exists())recipes.push({...row.data(),id:recipeId});}
  for(const item of preview.items){const snap=await tx.get(ref(api,'inventory',item.hqItemId));if(!snap.exists()||!same(quoteItem({...snap.data(),id:snap.id||item.hqItemId},item,inventory,recipes),item))throw Error('HQ prices or item settings changed. Review a fresh quote before sending.');}
  live(api,identity);tx.set(orderRef,{branch:identity.branch,items:preview.items,dispatchItems,status:'Pending',type:'Franchise Order',requestedBy:identity.name,requestedByUid:identity.uid,requestedByEmail:identity.email,quoteVersion:2,supplyInvoice:totals,quoteRecordedAt:api.serverTimestamp(),timestamp:api.serverTimestamp()});tx.set(stubRef,{quoteVersion:2,branch:identity.branch,status:'Pending',type:'Franchise Order',requestedBy:identity.name,timestamp:api.serverTimestamp(),items:dispatchItems});return {saved:true,id};
 });
}
export async function signSupplyDeliveryReceipt(api,{orderId,signaturePng}){
 if(typeof orderId!=='string'||!orderId||orderId.length>180||orderId.includes('/'))throw Error('Reopen a saved supply order.');validateSupplySignature(signaturePng);
 const identity=actor(api),access=await accessRows(api,identity);
 return api.runTransaction(api.db,async tx=>{
  live(api,identity);await checkFreshAccess(api,tx,identity,access);
  const orderRef=ref(api,'franchise_supply_orders',orderId),saved=await tx.get(orderRef);if(!saved.exists()||saved.data().branch!==identity.branch)throw Error('This order is missing or belongs to another branch.');const order={...saved.data(),id:orderId};
  if(order.deliveryReceipt){const prior=order.deliveryReceipt;if(prior.receivedByUid===identity.uid&&prior.receivedByEmail===identity.email&&prior.signaturePng===signaturePng)return {alreadySigned:true,id:orderId};throw Error('This delivery receipt is already signed. Open its saved copy; signatures cannot be replaced.');}
  if(!Array.isArray(order.dispatchLogIds)||!order.dispatchLogIds.length||order.dispatchLogIds.length>MAX_SUPPLY_LINES)throw Error('HQ must issue and link the final delivery invoice before it can be signed.');
  const rows=[];for(const id of order.dispatchLogIds){if(typeof id!=='string'||!id||id.includes('/'))throw Error('The saved delivery link needs HQ review.');const row=await tx.get(ref(api,'dispatch_logs',id));if(!row.exists())throw Error('A delivery line is missing. Ask HQ to review this shipment.');rows.push({...row.data(),id});}
  const verification=deliveryReceiptVerification(order,rows);live(api,identity);
  tx.update(orderRef,{deliveryReceipt:{version:1,branch:identity.branch,dispatchBatchId:order.dispatchBatchId,dispatchLogIds:[...order.dispatchLogIds],receivedByUid:identity.uid,receivedByEmail:identity.email,receivedByName:identity.name,signaturePng,verification,recordedAt:api.serverTimestamp()}});return {signed:true,id:orderId};
 });
}
export async function readSupplyOrder(api,orderId,{verifyDelivery=false}={}){
 if(typeof orderId!=='string'||!orderId||orderId.length>180||orderId.includes('/'))throw Error('Reopen a saved supply order.');
 const identity=actor(api),access=await accessRows(api,identity);
 return api.runTransaction(api.db,async tx=>{
  await checkFreshAccess(api,tx,identity,access);let snap=await tx.get(ref(api,'franchise_supply_orders',orderId));if(!snap.exists()){snap=await tx.get(ref(api,'purchase_orders',orderId));if(snap.exists()&&snap.data().quoteVersion===2)throw Error('This supply order’s private document is missing. Ask HQ to review its saved link.');}if(!snap.exists()||snap.data().branch!==identity.branch)throw Error('This supply order is missing or belongs to another branch.');let order={...snap.data(),id:orderId};supplyOrderView(order);if(order.dispatchInvoice)validateSupplyDispatchInvoice(order);else if(order.quoteVersion===2&&!order.deliveryReceipt){const stub=await tx.get(ref(api,'purchase_orders',orderId));order=supplyOrderDisplay(order,stub.exists()?{...stub.data(),id:orderId}:null);}
  const deliveries=[];if(verifyDelivery){if(!Array.isArray(order.dispatchLogIds)||!order.dispatchLogIds.length||order.dispatchLogIds.length>MAX_SUPPLY_LINES)throw Error('HQ must issue the final delivery invoice before signing.');for(const id of order.dispatchLogIds){if(typeof id!=='string'||!id||id.includes('/'))throw Error('The saved delivery link needs HQ review.');const row=await tx.get(ref(api,'dispatch_logs',id));if(!row.exists())throw Error('A delivery line is missing. Ask HQ to review this shipment.');deliveries.push({...row.data(),id});}deliveryReceiptVerification(order,deliveries);}
  live(api,identity);return {order,deliveries};
 });
}
export const previewSupplyCatalogItem=quoteItem;
