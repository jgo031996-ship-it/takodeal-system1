import {resolveHQAccount} from './hq-account-model.js';
import {OWNER_EMAIL,createWorkspaceSession,canOpenInventoryTab} from './workspace-access-model.js';
import {readRecipeRevision,recipePlan,saveRecipePlan,recipeFingerprint,operationFor} from './recipe-changes.js';
import {buildInventoryCreate,buildHqRestock,buildKitchenPrep,stockFormFail} from './inventory-stock-form-model.js';

const same=(a,b)=>recipeFingerprint(a)===recipeFingerprint(b);
const rows=snap=>snap.docs.map(doc=>({...doc.data(),id:doc.id}));
const actorNow=api=>{const user=api.auth?.currentUser,s=api.sessionUser;if(!user?.uid||!user.email||!s||s.email?.toLowerCase()!==user.email.toLowerCase()||s.uid&&s.uid!==user.uid)stockFormFail('Sign in with your approved account before changing inventory.','account');return {uid:user.uid,email:user.email.toLowerCase()};};
const allowed=(context,branch)=>context.actor.email===OWNER_EMAIL||context.session.allowedBranches.some(value=>value.toLowerCase()==='all'||value===branch);
async function access(api,kind){
 const actor=actorNow(api),snapshot=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email))),records=snapshot.docs.map(row=>({id:row.id,data:row.data()}));
 const account=resolveHQAccount(records);if(account.blocked)stockFormFail('This account is blocked. Ask the Owner to review access.','account');
 const session=createWorkspaceSession(actor,account),tab=kind==='prep'?'Prep':'Overview';
 if(!canOpenInventoryTab(session,tab))stockFormFail('Your saved permissions do not allow this inventory operation.','account');
 if(!same(actor,actorNow(api)))stockFormFail('The signed-in account changed. Reopen this form.','account');
 return {actor,records,session};
}
const active=branch=>branch.active!==false&&branch.isActive!==false&&!['closed','inactive','disabled','archived'].includes(String(branch.status||'').toLowerCase());
const readFlights=new WeakMap();
/** A deadline ends the screen wait, never the underlying SDK read/backoff. */
export function runInventoryStockFormRead(api,key,work,{timeoutMs=20000}={}){
 let flights=readFlights.get(api);if(!flights){flights=new Map();readFlights.set(api,flights);}
 const scope=recipeFingerprint([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.sessionUser?.allowedBranches,api.sessionUser?.permissions,key]),existing=flights.get(scope);
 if(existing)return existing.timedOut?Promise.reject(Error('The previous inventory read is still pending or backing off. No additional read was started. Reopen this form after it finishes.')):existing.deadline;
 let timer;const flight={timedOut:false,promise:Promise.resolve().then(work)};flights.set(scope,flight);
 const cleanup=()=>{if(flights.get(scope)===flight)flights.delete(scope);};flight.promise.then(cleanup,cleanup);
 flight.deadline=Promise.race([flight.promise,new Promise((_,reject)=>{timer=(api.setTimeout||setTimeout)(()=>{flight.timedOut=true;reject(Error('Inventory is taking too long to load. The server read is still pending; no stock was changed. Try again after it finishes.'));},timeoutMs);})]).finally(()=>(api.clearTimeout||clearTimeout)(timer));
 return flight.deadline;
}
export function loadInventoryStockFormState(api,kind,{branch=null}={}){return runInventoryStockFormRead(api,'load-'+kind+':'+(branch||'default'),()=>readInventoryStockFormState(api,kind,branch));}
async function readInventoryStockFormState(api,kind,requestedBranch){
 if(!['add','prep','restock'].includes(kind))stockFormFail('Choose a supported inventory form.');
 const context=await access(api,kind),before=await readRecipeRevision(api),limited=n=>api.limit?[api.limit(n)]:[];
 const directory=await api.getDocsFromServer(api.query(api.collection(api.db,'branches'),...limited(251)));
 if(directory.docs.length>250)stockFormFail('More than 250 branches are recorded. Narrow the branch directory before using this form.');
 const branchNames=[...new Set(rows(directory).filter(active).map(row=>row.name).filter(value=>typeof value==='string'&&value))];
 branchNames.push('Main Office');
 const branches=[...new Set(branchNames)].filter(branch=>typeof branch==='string'&&branch&&allowed(context,branch)).sort();
 if(kind==='restock'&&!branches.includes('Main Office'))stockFormFail('Your approved branch access does not allow Main Office restocking.','branch');
 const branch=kind==='restock'?'Main Office':requestedBranch||(branches.includes('Main Office')?'Main Office':branches[0]);
 if(kind==='prep'&&!branches.includes(branch))stockFormFail('Choose an approved active branch kitchen.','batchBranch');
 const inventory=await api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),...(kind==='add'?[]:[api.where('branch','==',branch)]),...limited(kind==='add'?2001:501)));
 if(inventory.docs.length>(kind==='add'?2000:500))stockFormFail('Too many inventory records for one safe form. Review duplicate items before opening it.');
 const items=rows(inventory).filter(row=>allowed(context,row.branch));let bomDocs=[];
 if(kind==='prep'){
  const prepared=[...new Set(items.filter(item=>item.category==='Prepared Batch').map(item=>item.name))];
  if(prepared.length>100)stockFormFail('More than 100 prepared items are recorded in this branch. Review the prepared-item catalogue first.');
  const settled=await Promise.allSettled(prepared.map(name=>api.getDocsFromServer(api.query(api.collection(api.db,'bom'),api.where('menuItem','==',name),...limited(201)))));
  const failed=settled.find(row=>row.status==='rejected');if(failed)throw failed.reason;const recipes=settled.map(row=>row.value);
  if(recipes.some(snap=>snap.docs.length>200))stockFormFail('A prepared-item recipe has too many rows. Review its BOM before preparing.');bomDocs=recipes.flatMap(snapshot=>snapshot.docs);
 }
 const after=await readRecipeRevision(api);if(!same(before,after)||!same(context.actor,actorNow(api)))stockFormFail('Inventory changed while opening this form. Open it again.');
 return {kind,previewId:crypto.randomUUID(),actor:context.actor,revision:after,branches,branch,items,bom:bomDocs.map(row=>({...row.data(),id:row.id})),
  documents:{inventory:Object.fromEntries(inventory.docs.map(row=>[row.id,row.data()])),branches:Object.fromEntries(directory.docs.map(row=>[row.id,row.data()])),...(kind==='prep'?{bom:Object.fromEntries(bomDocs.map(row=>[row.id,row.data()]))}:{})}};
}
async function checked(api,state,kind,branch){
 if(state?.kind!==kind||!state.previewId||!state.documents?.inventory)stockFormFail('Reopen this inventory form before saving.');
 const context=await access(api,kind);if(!same(state.actor,context.actor))stockFormFail('The signed-in account changed. Reopen this form.','account');
 if(branch&&(!state.branches.includes(branch)||!allowed(context,branch)))stockFormFail('Choose a branch within your saved access.','branch');
 for(const row of state.items){const {id,...data}=row,{id:storedId,...opened}=state.documents.inventory[id]||{};if(!same(data,opened))stockFormFail('The inventory preview changed. Reopen this form.');}
 return context;
}
function guard(plan,context,state){
 for(const {id,data} of context.records)plan.expected.push({table:'hq_managers',id,exists:true,data});
 for(const [id,data] of Object.entries(state.documents.branches||{}))plan.expected.push({table:'branches',id,exists:true,data});
}
function operation(api,state,kind,intent,supplied){
 if(supplied!==undefined&&(typeof supplied!=='string'||!supplied.trim()||supplied.length>180))stockFormFail('Reopen the operation before saving.');
 return supplied||operationFor(api,'stock-form:'+kind+':'+state.previewId,intent);
}
const identityFields=['name','branch','category','purchaseUom','purchUom','baseUom','uom','conversionRate','conversion','currentStock','baseCost','purchaseCost','purchCost','cost'];
const effect=item=>Object.fromEntries(identityFields.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]));
const user=(api,context)=>api.sessionUser?.cashierName||context.actor.email;
function log(api,context,operationId,item,{oldQty,newQty,type,note,...extra}){
 return {branch:item.branch,item:item.name,inventoryId:item.id,uom:item.baseUom||item.uom,oldQty,newQty,variance:newQty-oldQty,type,note,user:user(api,context),actorUid:context.actor.uid,actorEmail:context.actor.email,operationId,timestamp:api.serverTimestamp(),...extra};
}
async function save(api,state,context,writes,intent,kind,operationId){
 const plan=recipePlan(state,writes,{label:{add:'Create inventory item',prep:'Prepare kitchen batch',restock:'Receive Main Office stock'}[kind],intent});guard(plan,context,state);
 // Stock changes guard the exact quantities, conversion and costs shown on opening.
 for(const expected of plan.expected)if(expected.table==='inventory'&&expected.exists)expected.fields=identityFields;
 return saveRecipePlan(api,plan,{operationId,route:'inventory'});
}
export async function saveInventoryCreate(api,state,draft,{operationId}={}){
 const context=await checked(api,state,'add',draft.branch),branches=state.branches.filter(branch=>allowed(context,branch)),result=buildInventoryCreate(draft,{items:state.items,branches});
 const intent={kind:'inventory-create',previewId:state.previewId,draft,created:result.created},id=operation(api,state,'add',intent,operationId),writes=[];
 for(const row of result.created){
  if(!allowed(context,row.data.branch))stockFormFail('This broadcast includes an unapproved branch.','newInvBroadcastAll');
  writes.push({table:'inventory',id:row.id,mode:'set',data:row.data});
  // A starting balance is a stock movement and must have its own immutable audit.
  if(row.data.currentStock!==0)writes.push({table:'stock_logs',id:'inventory_initial_'+encodeURIComponent(id)+'_'+row.id,mode:'set',data:log(api,context,id,{id:row.id,...row.data},{oldQty:0,newQty:row.data.currentStock,type:'Initial Inventory Stock',note:'Starting balance on item creation',purchaseQty:result.initialQty,conversionRate:result.conversion,purchaseUom:result.purchaseUom})});
 }
 const saved=await save(api,state,context,writes,intent,'add',id);return {...saved,...result};
}
export async function saveHqRestock(api,state,{cart,supplier='',operationId}={}){
 const context=await checked(api,state,'restock','Main Office');if(typeof supplier!=='string'||supplier.length>240)stockFormFail('Use a supplier or receipt reference up to 240 characters.','restockSupplierInput');
 const result=buildHqRestock(state.items,cart),intent={kind:'hq-restock',previewId:state.previewId,cart,supplier:supplier.trim()},id=operation(api,state,'restock',intent,operationId),invoiceId='hq_restock_'+encodeURIComponent(id),writes=[];
 for(const {item,line,oldQty,newQty,patch} of result.updates){
  writes.push({table:'inventory',id:item.id,mode:'update',data:patch});
  writes.push({table:'stock_logs',id:'hq_restock_'+encodeURIComponent(id)+'_'+item.id,mode:'set',data:log(api,context,id,item,{oldQty,newQty,type:'HQ Delivery Restock',note:'Supplier: '+(supplier.trim()||'HQ Restock')+(oldQty<0?'. Negative starting balance retained; review stock audit.':''),invoiceId,purchaseQty:line.purchQty,conversionRate:line.conversionRate,purchaseUom:line.purchUom,subtotal:line.subtotal,unitCost:line.unitCost})});
 }
 const inventoryEffects=result.updates.map(({item,patch})=>({inventoryId:item.id,before:effect(item),after:effect({...item,...patch})}));
 writes.push({table:'hq_restocks',id:invoiceId,mode:'set',data:{version:2,branch:'Main Office',supplier:supplier.trim()||'HQ Restock',totalCost:result.totalCost,items:result.updates.map(row=>row.line),inventoryEffects,user:user(api,context),actorUid:context.actor.uid,actorEmail:context.actor.email,operationId:id,timestamp:api.serverTimestamp()}});
 const saved=await save(api,state,context,writes,intent,'restock',id);return {...saved,totalCost:result.totalCost,invoiceId,negativeBalances:result.updates.filter(row=>row.oldQty<0).map(row=>row.item.name)};
}
export async function saveKitchenPrep(api,state,input,{operationId}={}){
 const context=await checked(api,state,'prep',input.branch),result=buildKitchenPrep(state.items,state.bom,input),intent={kind:'kitchen-prep',previewId:state.previewId,...input},id=operation(api,state,'prep',intent,operationId),writes=[];
 for(const requirement of result.requirements){
  const {item,newQty,needed}=requirement;writes.push({table:'inventory',id:item.id,mode:'update',data:{currentStock:newQty}});
  writes.push({table:'stock_logs',id:'kitchen_ingredient_'+encodeURIComponent(id)+'_'+item.id,mode:'set',data:log(api,context,id,item,{oldQty:Number(item.currentStock),newQty,type:'Manager Prep Ingredient Deduction',note:'Used for '+result.target.name,preparedInventoryId:result.target.id,requiredQty:needed})});
 }
 writes.push({table:'inventory',id:result.target.id,mode:'update',data:{currentStock:result.newQty}});
 writes.push({table:'stock_logs',id:'kitchen_output_'+encodeURIComponent(id),mode:'set',data:log(api,context,id,result.target,{oldQty:result.oldQty,newQty:result.newQty,type:'Manager Prep Batch',note:'Prepared '+result.quantity+' '+result.purchaseUom,version:2,purchaseQty:result.quantity,purchaseUom:result.purchaseUom,conversionRate:result.conversion,ingredients:result.requirements.map(row=>({inventoryId:row.item.id,name:row.item.name,qty:row.needed,uom:row.baseUom,oldQty:Number(row.item.currentStock),newQty:row.newQty}))})});
 const plan=recipePlan(state,writes,{label:'Prepare kitchen batch',intent});guard(plan,context,state);
 for(const expected of plan.expected)if(expected.table==='inventory'&&expected.exists)expected.fields=identityFields;
 // Guard every scanned recipe row; shared revision prevents coordinated insertion/removal.
 for(const [bomId,data] of Object.entries(state.documents.bom||{}))if(data.menuItem===result.target.name)plan.expected.push({table:'bom',id:bomId,exists:true,data});
 const saved=await saveRecipePlan(api,plan,{operationId:id,route:'inventory'});return {...saved,...result};
}
