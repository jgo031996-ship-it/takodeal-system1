export const PREP_VERSION=1,PREP_KIND='owner-prep',PREP_MAX_INGREDIENTS=30;
export const prepCanonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const prepId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=(value,max=160)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const quantity=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12;
const unit=value=>String(value||'').trim().toLowerCase();
const fail=message=>{throw Error(message);};
export function prepTimestampToken(value){
 if(typeof value==='string'&&/^-?\d{1,12}:\d{9}$/.test(value))return value;
 const seconds=value?.seconds??value?._seconds,nanoseconds=value?.nanoseconds??value?._nanoseconds;
 return Number.isSafeInteger(seconds)&&Number.isSafeInteger(nanoseconds)&&nanoseconds>=0&&nanoseconds<1e9?seconds+':'+String(nanoseconds).padStart(9,'0'):null;
}
function savedUnit(row,keys,label){const values=keys.filter(key=>row[key]!=null).map(key=>row[key]);if(!values.length||values.some(value=>!text(value,40))||new Set(values.map(unit)).size!==1)fail('Review the saved '+label+' units before preparing this item.');return values[0];}
function stock(row,branch){
 if(!row||!prepId(row.id)||row.branch!==branch||!text(row.name)||!quantity(row.currentStock)||!prepTimestampToken(row.updateTime)||row.active===false||row.blocked===true||row.archived===true||row.deleted===true||/^(inactive|disabled|archived|deleted|blocked)$/i.test(row.status||''))fail('A stock item is missing, inactive, ambiguous or has an invalid saved quantity. Refresh inventory first.');
 return {id:row.id,name:row.name,branch,unit:savedUnit(row,['baseUom','uom'],'base'),beforeStock:row.currentStock,beforeUpdateTime:prepTimestampToken(row.updateTime)};
}
export function planPrepBatch({output,ingredients,recipes,qty}){
 if(typeof qty!=='number'||!Number.isFinite(qty)||qty<=0||qty>1e6)fail('Enter a number of batches greater than zero and no more than one million.');
 const branch=output?.branch;if(!text(branch,128)||/^all$/i.test(branch))fail('Choose one saved active branch.');
 const target=stock(output,branch);if(unit(output.category)!=='prepared batch')fail('Choose an item saved in the Prepared Batch category.');
 const purchaseUnit=savedUnit(output,['purchaseUom','purchUom'],'purchase'),conversions=['conversionRate','conversion'].filter(key=>output[key]!=null).map(key=>output[key]);
 if(!conversions.length||conversions.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9)||new Set(conversions).size!==1||unit(purchaseUnit)===unit(target.unit)&&conversions[0]!==1)fail('Review the prepared item’s saved purchase-to-base conversion.');
 if(!Array.isArray(recipes)||!recipes.length||recipes.length>PREP_MAX_INGREDIENTS||!Array.isArray(ingredients))fail('This prep needs 1–30 exact, saved recipe ingredients. Review its recipe first.');
 const seenRecipe=new Set(),seenIngredient=new Set(),byName=new Map(),recipe=[];
 for(const row of ingredients){if(!row||!text(row.name))fail('A saved ingredient needs review.');if(byName.has(row.name))fail('Duplicate ingredient records exist in this branch. Review them before preparing stock.');byName.set(row.name,row);}
 const outputQuantity=qty*conversions[0];if(!quantity(outputQuantity)||outputQuantity<=0||!quantity(target.beforeStock+outputQuantity)||target.beforeStock+outputQuantity===target.beforeStock)fail('The prepared quantity is too large or too small for this saved stock.');
 const effects=[{...target,delta:outputQuantity,afterStock:target.beforeStock+outputQuantity,role:'output'}];
 for(const row of [...recipes].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))){
  if(!row||!prepId(row.id)||seenRecipe.has(row.id)||row.menuItem!==output.name||!text(row.ingredientName)||typeof row.qty!=='number'||!Number.isFinite(row.qty)||row.qty<=0||row.qty>1e12||!prepTimestampToken(row.updateTime)||row.branch!=null&&row.branch!==branch||row.active===false||row.archived===true||row.deleted===true)fail('The saved recipe is incomplete, duplicated or belongs to a different item.');
  seenRecipe.add(row.id);const source=byName.get(row.ingredientName),item=stock(source,branch);
  if(item.id===target.id||seenIngredient.has(item.id))fail('A recipe cannot consume itself or repeat the same ingredient. Review its saved rows.');seenIngredient.add(item.id);
  const explicit=['baseUom','uom','unit'].filter(key=>row[key]!=null).map(key=>row[key]);if(explicit.some(value=>!text(value,40)||unit(value)!==unit(item.unit)))fail('A recipe quantity uses a different unit from its ingredient’s saved base unit.');
  // Existing BOM qty is measured in the ingredient's base units. A declared
  // unit must agree; no purchase-unit or current-recipe guess is made on undo.
  const used=row.qty*qty,after=item.beforeStock-used;if(!quantity(used)||used<=0||!quantity(after)||after===item.beforeStock)fail('There is not enough '+item.name+' in this branch, or the quantity needs review.');
  effects.push({...item,delta:-used,afterStock:after,role:'ingredient'});recipe.push({id:row.id,updateTime:prepTimestampToken(row.updateTime),inventoryId:item.id,quantityPerBatch:row.qty,unit:item.unit});
 }
 if(ingredients.length!==seenIngredient.size)fail('The ingredient lookup is incomplete or contains unrelated records.');
 return {version:PREP_VERSION,kind:PREP_KIND,branch,outputInventoryId:target.id,outputName:target.name,qty,purchaseUnit,outputBaseQuantity:outputQuantity,effects,recipe:recipe.sort((a,b)=>a.id.localeCompare(b.id))};
}
export function planPrepReversal(operation,currentRows){
 if(operation?.kind!==PREP_KIND||operation.version!==PREP_VERSION||!prepId(operation.operationId)||!text(operation.branch,128)||!prepId(operation.outputInventoryId)||!Array.isArray(operation.effects)||operation.effects.length<2||operation.effects.length>PREP_MAX_INGREDIENTS+1||!prepTimestampToken(operation.createTime))fail('This older prep has no trusted, complete ingredient movement record. Automatic reversal is unavailable; ask HQ to review a documented stock correction.');
 if(!Array.isArray(currentRows)||currentRows.length!==operation.effects.length)fail('The original stock items are incomplete. Reversal is held.');
 // The immutable operation is created atomically with every stock update.
 // Snapshot createTime is the original commit token, not a client field or a
 // millisecond-precision REQUEST_TIME transform.
 const rows=new Map(currentRows.map(row=>[row?.id,row])),seen=new Set(),committed=prepTimestampToken(operation.createTime),restored=[];
 for(const effect of operation.effects){
  if(!effect||!prepId(effect.id)||seen.has(effect.id)||effect.branch!==operation.branch||!text(effect.name)||!text(effect.unit,40)||!quantity(effect.beforeStock)||!quantity(effect.afterStock)||typeof effect.delta!=='number'||!Number.isFinite(effect.delta)||effect.afterStock-effect.beforeStock!==effect.delta&&Math.abs((effect.afterStock-effect.beforeStock)-effect.delta)>Math.max(1,Math.abs(effect.delta))*Number.EPSILON*8||effect.role!==(effect.id===operation.outputInventoryId?'output':'ingredient')||effect.role==='output'&&effect.delta<=0||effect.role==='ingredient'&&effect.delta>=0)fail('The saved prep movement record needs review.');
  seen.add(effect.id);const source=rows.get(effect.id),current=stock(source,operation.branch);
  if(current.name!==effect.name||unit(current.unit)!==unit(effect.unit)||current.beforeStock!==effect.afterStock||prepTimestampToken(source.updateTime)!==committed)fail('Stock or item details changed after this prep. Reversal is held to protect later activity, even if the quantity was later restored.');
  restored.push({id:effect.id,name:effect.name,branch:effect.branch,unit:effect.unit,role:effect.role,beforeStock:effect.afterStock,afterStock:effect.beforeStock,delta:-effect.delta,beforeUpdateTime:committed});
 }
 if(!seen.has(operation.outputInventoryId)||restored.filter(row=>row.role==='output').length!==1)fail('The original prepared item is missing. Reversal is held.');
 return {version:PREP_VERSION,kind:'owner-prep-reversal',operationId:operation.operationId,branch:operation.branch,outputInventoryId:operation.outputInventoryId,outputName:operation.outputName,committedAt:committed,effects:restored};
}
