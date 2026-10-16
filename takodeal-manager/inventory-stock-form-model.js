const HQ = 'Main Office';
const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {}, k);
export class InventoryStockFormError extends Error { constructor(message,field=''){super(message);this.name='InventoryStockFormError';this.field=field;} }
export const stockFormFail=(message,field='')=>{throw new InventoryStockFormError(message,field);};
export const stockFormNumber=(value,label,field,{positive=false,blankZero=false}={})=>{
 if(blankZero && (value===''||value==null))return 0;
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())stockFormFail('Enter '+label+'.',field);
 const n=Number(value);if(!Number.isFinite(n)||n<0||positive&&n===0||n>Number.MAX_SAFE_INTEGER)stockFormFail('Enter a valid '+label+(positive?' greater than zero.':' of zero or more.'),field);return n;
};
const text=(value,label,field,max=120)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)stockFormFail('Enter '+label+' (up to '+max+' characters).',field);return value.trim();};
const key=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
export const inventoryCreateId=(branch,name)=>'stock_'+encodeURIComponent(JSON.stringify([key(branch),key(name)]));
export function stockFormUnits(item){
 const conversion=stockFormNumber(item.conversionRate??item.conversion??1,'the saved purchase conversion','item',{positive:true});
 const purchaseUom=text(item.purchaseUom||item.purchUom||item.baseUom||item.uom,'the purchase unit','item',40);
 const baseUom=text(item.baseUom||item.uom,'the base unit','item',40);
 return {conversion,purchaseUom,baseUom};
}
export function stockFormCost(item){
 for(const field of ['purchaseCost','purchCost','cost'])if(own(item,field)&&item[field]!=null)return stockFormNumber(item[field],'the recorded purchase cost','item');
 if(item.baseCost!=null)return stockFormNumber(item.baseCost,'the recorded base cost','item')*stockFormUnits(item).conversion;
 return null;
}
export function buildInventoryCreate(draft,{items=[],branches=[]}={}){
 const branch=text(draft.branch,'the branch','newInvBranch'),name=text(draft.name,'an item name','newInvName');
 if(!branches.includes(branch))stockFormFail('Choose an approved active branch.','newInvBranch');
 const category=text(draft.category,'a category','newInvCat',60),purchaseUom=text(draft.purchaseUom,'the purchase unit','newInvPurchUom',40),baseUom=text(draft.baseUom,'the base unit','newInvBaseUom',40);
 const conversion=stockFormNumber(draft.conversion,'the number of base units in one purchase unit','newInvConv',{positive:true});
 const cost=stockFormNumber(draft.cost,'the cost per purchase unit','newInvCost');
 const initial=stockFormNumber(draft.initialQty,'the starting quantity','newInvInitQty',{blankZero:true});
 const target=stockFormNumber(draft.targetPurchase,'the branch target','newInvMaintainPurch',{blankZero:true})*conversion+stockFormNumber(draft.targetBase,'the loose branch target','newInvMaintainBase',{blankZero:true});
 const alert=stockFormNumber(draft.alertPurchase,'the branch low stock alert','newInvBranchReorder',{blankZero:true})*conversion;
 if(!['Weekly','Monthly'].includes(draft.cycle))stockFormFail('Choose Weekly or Monthly.','newInvCycle');
 const broadcast=draft.broadcast===true,targets=broadcast?[branch,...branches.filter(b=>b!==branch)]:[branch];
 if(items.some(item=>key(item.name)===key(name)&&item.branch===branch))stockFormFail('This item already exists in '+branch+'. Use restock to add stock.','newInvName');
 const created=[],skipped=[];
 for(const destination of targets){
  if(items.some(item=>key(item.name)===key(name)&&item.branch===destination)){skipped.push(destination);continue;}
  const selected=destination===branch;
  // New copies have no starting stock; HQ targets never become store targets.
  const data={branch:destination,name,category,purchaseUom,baseUom,uom:baseUom,conversionRate:conversion,conversion,purchaseCost:cost,purchCost:cost,cost,baseCost:cost/conversion,currentStock:selected?initial*conversion:0,
   maintainingStock:selected?target:0,lowStockAlert:selected?alert:0,reorderLevel:selected?alert:0,restockCycle:draft.cycle,
   allowRequest:draft.allowRequest===true,showInPrep:draft.showInPrep===true,showToCashier:true};
  if(draft.image)data.image=draft.image;
  for(const value of [data.currentStock,target,alert,data.baseCost])if(!Number.isFinite(value)||value>Number.MAX_SAFE_INTEGER)stockFormFail('These quantities or costs are too large.','newInvConv');
  created.push({id:inventoryCreateId(destination,name),data});
  if(created.at(-1).id.length>1400)stockFormFail('The item and branch names are too long for one stock record.','newInvName');
 }
 return {created,skipped,branch,name,initialQty:initial,baseStock:initial*conversion,purchaseUom,baseUom,conversion,cost};
}
export function restockLine(item,{quantity,unitCost,subtotal}={}){
 if(!item?.id||item.branch!==HQ)stockFormFail('Choose a Main Office item.','restockItemSelect');
 const {conversion,purchaseUom,baseUom}=stockFormUnits(item),qty=stockFormNumber(quantity,'the purchase quantity','restockQtyInput',{positive:true});
 const cost=stockFormNumber(unitCost,'the cost per purchase unit','restockUnitCost');
 const total=subtotal==null||subtotal===''?qty*cost:stockFormNumber(subtotal,'the line total','restockSubtotal');
 if(!Number.isFinite(qty*conversion)||qty*conversion>Number.MAX_SAFE_INTEGER||!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)stockFormFail('This restock quantity or total is too large.','restockQtyInput');
 return {id:item.id,name:item.name,branch:HQ,purchQty:qty,qty,conversionRate:conversion,purchUom:purchaseUom,baseQtyToAdd:qty*conversion,baseUom,unitCost:total/qty,subtotal:total};
}
export function mergeRestockLine(cart,line){
 const rows=cart.map(row=>({...row})),existing=rows.find(row=>row.id===line.id);
 if(!existing)return [...rows,line];
 if(existing.conversionRate!==line.conversionRate||existing.purchUom!==line.purchUom||existing.baseUom!==line.baseUom)stockFormFail('This item’s units changed. Reopen the restock.','restockItemSelect');
 for(const field of ['purchQty','qty','baseQtyToAdd','subtotal'])existing[field]+=line[field];existing.unitCost=existing.subtotal/existing.purchQty;return rows;
}
export function buildHqRestock(items,cart){
 if(!Array.isArray(cart)||!cart.length)stockFormFail('Add at least one item to the restock cart.','restockItemSelect');
 if(cart.length>100||new Set(cart.map(row=>row.id)).size!==cart.length)stockFormFail('Use up to 100 different items per invoice.','restockItemSelect');
 const updates=[];let totalCost=0;
 for(const line of cart){
  const item=items.find(item=>item.id===line.id);if(!item)stockFormFail('An item no longer exists. Reopen the restock.','restockItemSelect');
  const verified=restockLine(item,{quantity:line.purchQty,unitCost:line.unitCost,subtotal:line.subtotal});
  for(const field of ['name','branch','conversionRate','purchUom','baseUom','baseQtyToAdd','qty'])if(verified[field]!==line[field])stockFormFail('An item’s name or units changed. Reopen the restock.','restockItemSelect');
  const oldQty=Number(item.currentStock);if(!['number','string'].includes(typeof item.currentStock)||typeof item.currentStock==='string'&&!item.currentStock.trim()||!Number.isFinite(oldQty))stockFormFail('Review the missing or invalid stock balance for '+item.name+'.','restockItemSelect');
  const oldPurchaseCost=stockFormCost(item),oldBaseCost=item.baseCost!=null?stockFormNumber(item.baseCost,'the recorded base cost','restockItemSelect'):oldPurchaseCost==null?null:oldPurchaseCost/verified.conversionRate;
  if(oldQty>0&&oldBaseCost==null)stockFormFail('Set the existing cost for '+item.name+' before averaging its stock.','restockItemSelect');
  const positiveStock=Math.max(0,oldQty),newQty=oldQty+verified.baseQtyToAdd;
  // Negative stock remains visible. Cost averaging values real receipts, never a fabricated debt reset.
  const baseCost=(positiveStock*(oldBaseCost??0)+verified.subtotal)/(positiveStock+verified.baseQtyToAdd);
  if(!Number.isFinite(newQty)||Math.abs(newQty)>Number.MAX_SAFE_INTEGER||!Number.isFinite(baseCost))stockFormFail('This restock would exceed the supported balance.','restockQtyInput');
  const purchaseCost=baseCost*verified.conversionRate;
  updates.push({item,line:verified,oldQty,newQty,oldBaseCost,patch:{currentStock:newQty,baseCost,purchaseCost,purchCost:purchaseCost,cost:purchaseCost}});totalCost+=verified.subtotal;
 }
 if(!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER)stockFormFail('The invoice total is too large.','restockCostInput');
 return {updates,totalCost};
}
export function buildKitchenPrep(items,bom,{branch,itemId,quantity}={}){
 const target=items.find(item=>item.id===itemId&&item.branch===branch);if(!target||target.category!=='Prepared Batch')stockFormFail('Choose a prepared item in this branch.','batchItem');
 if(items.filter(item=>item.branch===branch&&item.name===target.name).length!==1)stockFormFail('This prepared item has duplicate stock records. Resolve them before preparing.','batchItem');
 const {conversion,purchaseUom,baseUom}=stockFormUnits(target),qty=stockFormNumber(quantity,'the quantity to produce','batchQty',{positive:true});
 const recipe=bom.filter(row=>row.menuItem===target.name);if(!recipe.length)stockFormFail('No saved recipe exists for this prepared item. Set its BOM first.','batchItem');
 const requirements=[],seen=new Set();
 for(const ingredient of recipe){
  const name=text(ingredient.ingredientName,'the recipe ingredient name','batchItem');
  if(seen.has(name))stockFormFail('The recipe repeats '+name+'. Correct the BOM before preparing.','batchItem');seen.add(name);
  if(name===target.name)stockFormFail('A prepared item cannot use itself as an ingredient.','batchItem');
  const matches=items.filter(item=>item.branch===branch&&item.name===name);if(matches.length!==1)stockFormFail(name+' needs exactly one inventory record in '+branch+'.','batchItem');
  const item=matches[0],unit=stockFormUnits(item),need=stockFormNumber(ingredient.qty,'the saved recipe quantity for '+name,'batchItem',{positive:true})*qty;
  const stock=Number(item.currentStock);if(item.currentStock==null||!['number','string'].includes(typeof item.currentStock)||typeof item.currentStock==='string'&&!item.currentStock.trim()||!Number.isFinite(stock))stockFormFail('Review the stock balance for '+name+'.','batchItem');
  if(!Number.isFinite(need)||need>Number.MAX_SAFE_INTEGER)stockFormFail('The recipe quantity is too large.','batchQty');
  if(stock<need)stockFormFail('Not enough '+name+': need '+need+' '+unit.baseUom+', available '+stock+'.','batchQty');
  requirements.push({item,needed:need,newQty:stock-need,baseUom:unit.baseUom});
 }
 const oldQty=Number(target.currentStock),added=qty*conversion,newQty=oldQty+added;
 if(target.currentStock==null||!['number','string'].includes(typeof target.currentStock)||typeof target.currentStock==='string'&&!target.currentStock.trim()||!Number.isFinite(oldQty)||!Number.isFinite(newQty)||Math.abs(newQty)>Number.MAX_SAFE_INTEGER)stockFormFail('Review the prepared item’s stock balance or quantity.','batchQty');
 if(requirements.length>100)stockFormFail('This recipe has too many ingredients for one safe preparation.','batchItem');
 return {target,requirements,oldQty,newQty,added,quantity:qty,conversion,purchaseUom,baseUom};
}
