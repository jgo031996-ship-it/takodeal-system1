import {resolveHQAccount} from './hq-account-model.js';
import {OWNER_EMAIL,createWorkspaceSession,canOpenInventoryTab} from './workspace-access-model.js';
import {ingredientUses} from './recipe-integrity.js';
import {readRecipeRevision,recipePlan,saveRecipePlan,recipeFingerprint,operationFor} from './recipe-changes.js';
import {buildInventoryItemEditPlan,InventoryItemEditError} from './inventory-item-edit-model.js';

const HQ='Main Office';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const rows=snap=>snap.docs.map(row=>({...row.data(),id:row.id}));
const documents=list=>Object.fromEntries(list.map(({id,...data})=>[id,data]));
const same=(a,b)=>recipeFingerprint(a)===recipeFingerprint(b);
const fail=(message,field='')=>{throw new InventoryItemEditError(message,field);};
const ref=(api,table,id)=>api.doc(api.db,table,id);
function identity(api){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||!user.email||!session||session.email?.toLowerCase()!==user.email.toLowerCase()||session.uid&&session.uid!==user.uid)fail('Sign in with your approved Google account before editing inventory.','account');
 return {uid:user.uid,email:user.email.toLowerCase()};
}
async function access(api){
 const actor=identity(api),snap=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email)));
 const records=snap.docs.map(row=>({id:row.id,data:row.data()})),account=resolveHQAccount(records);
 if(account.blocked===true)fail('This account is blocked. Ask the Owner to review access.','account');
 const session=createWorkspaceSession(actor,account);
 if(!canOpenInventoryTab(session,'Overview'))fail('Your saved permissions do not allow Live Stocks changes.','account');
 if(!same(identity(api),actor))fail('The signed-in account changed. Reopen the item.','account');
 return {actor,session,records};
}
const allowed=(context,branch)=>context.actor.email===OWNER_EMAIL||context.session.allowedBranches.some(name=>name.toLowerCase()==='all'||name===branch);
function checkState(api,state,context){
 if(!state?.original?.id||!state.documents?.inventory?.[state.original.id])fail('Reopen the stock item before saving.','item');
 if(typeof state.previewId!=='string'||!state.previewId)fail('Reopen the stock item to start a fresh edit preview.','item');
 const {id,...opened}=state.original;
 if(!same(opened,state.documents.inventory[id]))fail('The opened item baseline changed. Reopen the item before saving.','item');
 if(!same(state.actor,context.actor)||!same(identity(api),context.actor))fail('The signed-in account changed. Reopen the item.','account');
 if(!allowed(context,state.original.branch))fail('Your approved branch access does not allow this item.','branch');
}
function addExpected(plan,table,id,data,fields){
 const value={table,id,exists:data!=null,data:data??null,...(fields?{fields}:{} )};
 const index=plan.expected.findIndex(row=>row.table===table&&row.id===id);
 if(index<0)plan.expected.push(value);else plan.expected[index]=value;
}
function guardAccess(plan,context){for(const record of context.records)addExpected(plan,'hq_managers',record.id,record.data);}
function operation(api,key,intent,operationId){
 if(operationId!==undefined&&(typeof operationId!=='string'||!operationId.trim()||operationId.length>180))fail('Reopen this operation before saving.','operation');
 return operationId||operationFor(api,key,intent);
}

/** Read the document snapshots once; settings saves must retain this open baseline. */
export async function loadInventoryEditorState(api,id){
 if(typeof id!=='string'||!id||id.includes('/'))fail('Choose a stock item to edit.','item');
 const context=await access(api),before=await readRecipeRevision(api),item=await api.getDocFromServer(ref(api,'inventory',id));
 if(!item.exists())fail('This stock item no longer exists. Refresh Live Stocks.','item');
 const original={...item.data(),id};
 if(!allowed(context,original.branch))fail('Your approved branch access does not allow this item.','branch');
 const [matching,directory]=await Promise.all([
  api.getDocsFromServer(api.query(api.collection(api.db,'inventory'),api.where('name','==',original.name))),
  api.getDocsFromServer(api.collection(api.db,'branches'))
 ]);
 const after=await readRecipeRevision(api);
 if(!same(before,after)||!same(identity(api),context.actor))fail('Inventory links changed while opening this item. Reopen it.','item');
 const allItems=rows(matching);
 // Keep the explicitly read target if a legacy query omits it; its snapshot is authoritative.
 const index=allItems.findIndex(row=>row.id===id);if(index<0)allItems.push(original);else allItems[index]=original;
 const permittedBranches=[...new Set([...rows(directory).map(row=>row.name),...allItems.map(row=>row.branch)].filter(branch=>typeof branch==='string'&&branch&&allowed(context,branch)))].sort();
 return {previewId:crypto.randomUUID(),actor:context.actor,original,items:allItems.filter(row=>allowed(context,row.branch)),allItems,permittedBranches,revision:after,
  documents:{inventory:documents(allItems)}};
}

async function linkState(api){
 const [bom,menu,addons,mix]=await Promise.all([
  api.getDocsFromServer(api.collection(api.db,'bom')),api.getDocsFromServer(api.collection(api.db,'menu')),
  api.getDocsFromServer(api.collection(api.db,'global_addons')),api.getDocFromServer(ref(api,'settings','global_mixmatch'))
 ]);
 return {bom:rows(bom),menu:rows(menu),global_addons:rows(addons),mix:mix.exists()?mix.data():null};
}
function guardedLinks(plan,links){
 for(const table of ['bom','menu','global_addons'])for(const row of links[table]){const {id,...data}=row;addExpected(plan,table,id,data);}
 addExpected(plan,'settings','global_mixmatch',links.mix);
}

export async function saveInventoryEditorSettings(api,state,draft,{copyMetadata=true,syncStoreCost=false,renameLinked=false,operationId}={}){
 const context=await access(api);checkState(api,state,context);
 if(typeof renameLinked!=='boolean')fail('Choose whether linked item names should be updated.','name');
 const permittedBranches=state.permittedBranches.filter(branch=>allowed(context,branch));
 const edit=buildInventoryItemEditPlan({original:state.original,draft,items:state.items,permittedBranches,copyMetadata,syncStoreCost});
 if(!edit.updates.length)return {status:'unchanged',copiedBranches:edit.copiedBranches,copiedCostBranches:edit.copiedCostBranches,sharedFields:edit.sharedFields,changes:edit.changes,changedFields:edit.changedFields,skippedPeers:edit.skippedPeers};
 const rename=own(edit.changes,'name');
 if(rename)fail('Linked item names require a separate recipe-link review; use recipe replacement rather than renaming here.','name');
 const updates=new Map(edit.updates.map(row=>[row.id,{...row,patch:{...row.patch}}]));
 let links=null;
 if(own(edit.changes,'baseUom')){
  links=await linkState(api);
  const names=new Set([state.original.name]);
  const uses=ingredientUses(names,links.bom,links.menu,links.global_addons,links.mix?.mappings||[]);
  if(uses.length)fail('This ingredient is linked to recipes or add-ons. Review their quantities before changing its base unit.','baseUom');
 }
 for(const update of updates.values())if(!allowed(context,update.branch))fail('Your approved branch access does not allow every affected item.','branch');
 const writes=[...updates.values()].map(row=>({table:'inventory',id:row.id,mode:'update',data:row.patch}));
 const intent={kind:'inventory-settings',previewId:state.previewId,id:state.original.id,changes:edit.changes,copyMetadata,syncStoreCost,renameLinked};
 const baseline={revision:state.revision,documents:{...state.documents,...(links?{bom:documents(links.bom),menu:documents(links.menu),global_addons:documents(links.global_addons)}:{})}};
 const plan=recipePlan(baseline,writes,{label:'Inventory item settings',intent});
 for(const row of updates.values())addExpected(plan,'inventory',row.id,row.expected.data,row.expected.fields);
 if(links)guardedLinks(plan,links);guardAccess(plan,context);
 const result=await saveRecipePlan(api,plan,{operationId:operation(api,'inventory-settings:'+state.original.id+':'+state.previewId,intent,operationId),route:'inventory'});
 return {...result,copiedBranches:edit.copiedBranches,copiedCostBranches:edit.copiedCostBranches,sharedFields:edit.sharedFields,changes:edit.changes,changedFields:edit.changedFields,skippedPeers:edit.skippedPeers};
}

function count(value,label){
 if(value==='')return 0;
 if(!['string','number'].includes(typeof value)||typeof value==='string'&&!value.trim())fail('Enter a valid '+label+'.','stockCount');
 const result=Number(value);if(!Number.isFinite(result)||result<0||result>Number.MAX_SAFE_INTEGER)fail('The physical count must be zero or more.','stockCount');return result;
}
export async function saveInventoryStockCorrection(api,state,{purchaseQty='',baseQty='',note='',operationId}={}){
 const context=await access(api);checkState(api,state,context);
 if(purchaseQty===''&&baseQty==='')fail('Enter the counted quantity before saving a stock correction.','stockCount');
 if(typeof note!=='string'||!note.trim())fail('Enter a reason for this stock correction.','note');
 const item=state.original,rawConversion=item.conversionRate??item.conversion??1,conversion=Number(rawConversion);
 if(!['number','string'].includes(typeof rawConversion)||typeof rawConversion==='string'&&!rawConversion.trim()||!Number.isFinite(conversion)||conversion<=0)fail('Correct this item’s purchase-unit conversion before counting stock.','conversionRate');
 const purchase=count(purchaseQty,'purchase count'),base=count(baseQty,'loose count'),newQty=purchase*conversion+base;
 if(item.currentStock==null)fail('This item has no recorded stock balance. Review its starting balance before correcting stock.','stockCount');
 const oldQty=Number(item.currentStock);
 if(!['string','number'].includes(typeof item.currentStock)||typeof item.currentStock==='string'&&!item.currentStock.trim()||!Number.isFinite(oldQty)||!Number.isFinite(newQty)||newQty>Number.MAX_SAFE_INTEGER)fail('The saved or counted stock quantity is invalid. Reopen the item.','stockCount');
 const intent={kind:'inventory-stock-correction',previewId:state.previewId,id:item.id,purchaseQty:purchase,baseQty:base,note:note.trim(),conversionRate:conversion,oldQty,newQty};
 const id=operation(api,'inventory-stock-correction:'+item.id+':'+state.previewId,intent,operationId),logId='inventory_correction_'+encodeURIComponent(id);
 const purchaseUom=item.purchaseUom||item.purchUom||item.baseUom||item.uom||'unit',baseUom=item.baseUom||item.uom||'unit';
 const writes=[{table:'inventory',id:item.id,mode:'update',data:{currentStock:newQty}},{table:'stock_logs',id:logId,mode:'set',data:{
  branch:item.branch,item:item.name,inventoryId:item.id,oldQty,newQty,variance:newQty-oldQty,uom:baseUom,type:'Manual Adjustment',
  note:note.trim(),purchaseQty:purchase,looseBaseQty:base,purchaseUom,conversionRate:conversion,
  user:api.sessionUser?.cashierName||context.actor.email,actorUid:context.actor.uid,actorEmail:context.actor.email,timestamp:api.serverTimestamp()
 }}];
 const plan=recipePlan(state,writes,{label:'Inventory physical stock correction',intent});
 addExpected(plan,'inventory',item.id,state.documents.inventory[item.id],['name','branch','purchaseUom','purchUom','baseUom','uom','conversionRate','conversion','currentStock']);
 guardAccess(plan,context);
 const result=await saveRecipePlan(api,plan,{operationId:id,route:'inventory'});
 return {...result,oldQty,newQty,variance:newQty-oldQty,copiedBranches:[]};
}
