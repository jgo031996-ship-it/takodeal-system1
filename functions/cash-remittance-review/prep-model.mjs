export const PREP_VERSION=1,PREP_KIND='owner-prep',PREP_MAX_INGREDIENTS=30;
export const prepCanonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const prepId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=(value,max=160)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const savedName=(value,max=160)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const quantity=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12;
const signedStock=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12;
const unit=value=>String(value||'').trim().toLowerCase();
const normalizedName=value=>value.trim().replace(/\s+/g,' ');
export class PrepModelError extends Error{
 constructor(issueCode,message,{skippable=true,details={}}={}){super(message);this.name='PrepModelError';this.issueCode=issueCode;this.skippable=skippable;this.details=details;}
}
const fail=(issueCode,message,options)=>{throw new PrepModelError(issueCode,message,options);};
export function prepTimestampToken(value){
 if(typeof value==='string'&&/^-?\d{1,12}:\d{9}$/.test(value))return value;
 const seconds=value?.seconds??value?._seconds,nanoseconds=value?.nanoseconds??value?._nanoseconds;
 return Number.isSafeInteger(seconds)&&Number.isSafeInteger(nanoseconds)&&nanoseconds>=0&&nanoseconds<1e9?seconds+':'+String(nanoseconds).padStart(9,'0'):null;
}
function savedUnit(row,keys,label){const values=keys.filter(key=>row[key]!=null).map(key=>row[key]);if(!values.length||values.some(value=>!text(value,40))||new Set(values.map(unit)).size!==1)fail('invalid-stock-unit','Review the saved '+label+' units before preparing this item.');return values[0];}
function stock(row,branch,{role='ingredient',signedIngredients=false}={}){
 if(!row||!prepId(row.id)||row.branch!==branch||!savedName(row.name)||!prepTimestampToken(row.updateTime)||row.active===false||row.blocked===true||row.archived===true||row.deleted===true||/^(inactive|disabled|archived|deleted|blocked)$/i.test(row.status||''))fail('stock-item-unavailable','A stock item is missing, inactive, ambiguous or has an invalid saved quantity. Refresh inventory first.',{details:{inventoryId:prepId(row?.id)?row.id:null,role}});
 if(!(role==='output'||signedIngredients?signedStock(row.currentStock):quantity(row.currentStock)))fail('invalid-stock-quantity',role==='output'?'The prepared item '+row.name+' has an invalid saved stock balance. Ask HQ to review it.':signedIngredients?'The raw ingredient '+row.name+' has an invalid saved stock balance. Ask HQ to review it.':'The raw ingredient '+row.name+' has an invalid or negative saved quantity. Ask HQ to review it before preparing stock.',{details:{inventoryId:row.id,itemName:row.name,role,...(typeof row.currentStock==='number'&&Number.isFinite(row.currentStock)?{recordedStock:row.currentStock}:{})}});
 return {id:row.id,name:row.name,branch,unit:savedUnit(row,['baseUom','uom'],'base'),beforeStock:row.currentStock,beforeUpdateTime:prepTimestampToken(row.updateTime)};
}
export function planPrepBatch(input){return planBatch(input,false);}
export function planActualPrepBatch(input){return planBatch(input,true);}
function planBatch({output,ingredients,recipes,qty,recipeName=output?.name},actual){
 if(typeof qty!=='number'||!Number.isFinite(qty)||qty<=0||qty>1e6)fail('invalid-quantity','Enter a number of batches greater than zero and no more than one million.',{skippable:false});
 const branch=output?.branch;if(!text(branch,128)||/^all$/i.test(branch))fail('invalid-branch','Choose one saved active branch.',{skippable:false});
 const target=stock(output,branch,{role:'output'});if(unit(output.category)!=='prepared batch')fail('invalid-output-category','Choose an item saved in the Prepared Batch category.');
 if(!savedName(recipeName)||normalizedName(recipeName)!==normalizedName(output.name))fail('invalid-recipe','The saved recipe name does not match this prepared item. Review its exact recipe before preparing stock.');
 const purchaseUnit=savedUnit(output,['purchaseUom','purchUom'],'purchase'),conversions=['conversionRate','conversion'].filter(key=>output[key]!=null).map(key=>output[key]);
 if(!conversions.length||conversions.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9)||new Set(conversions).size!==1||unit(purchaseUnit)===unit(target.unit)&&conversions[0]!==1)fail('invalid-output-conversion','Review the prepared item’s saved purchase-to-base conversion.');
 if(!Array.isArray(recipes)||!recipes.length||recipes.length>PREP_MAX_INGREDIENTS||!Array.isArray(ingredients))fail('recipe-unavailable','This prep needs 1–30 exact, saved recipe ingredients. Review its recipe first.');
 const seenRecipe=new Set(),seenIngredient=new Set(),byName=new Map(),recipe=[];
 for(const row of ingredients){if(!row||!savedName(row.name))fail('stock-item-unavailable','A saved ingredient needs review.');if(byName.has(row.name))fail('duplicate-ingredient','Duplicate ingredient records exist in this branch. Review them before preparing stock.');byName.set(row.name,row);}
 const outputQuantity=qty*conversions[0];if(!quantity(outputQuantity)||outputQuantity<=0||!signedStock(target.beforeStock+outputQuantity)||target.beforeStock+outputQuantity===target.beforeStock)fail('quantity-out-of-range','The prepared quantity is too large or too small for this saved stock.');
 const effects=[{...target,delta:outputQuantity,afterStock:target.beforeStock+outputQuantity,role:'output'}];
 for(const row of [...recipes].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))){
  if(!row||!prepId(row.id)||row.menuItem!==recipeName||!savedName(row.ingredientName)||typeof row.qty!=='number'||!Number.isFinite(row.qty)||row.qty<=0||row.qty>1e12||!prepTimestampToken(row.updateTime)||row.branch!=null&&row.branch!==branch||row.active===false||row.archived===true||row.deleted===true)fail('invalid-recipe','The saved recipe is incomplete, duplicated or belongs to a different item.');
  if(seenRecipe.has(row.id))fail('duplicate-recipe','The saved recipe repeats the same source row. Review it before preparing stock.');
  seenRecipe.add(row.id);const source=byName.get(row.ingredientName),item=stock(source,branch,{signedIngredients:actual});
  if(item.id===target.id)fail('self-consuming-recipe','A recipe cannot consume itself. Review its saved rows.');if(seenIngredient.has(item.id))fail('duplicate-ingredient','A recipe cannot repeat the same ingredient. Review its saved rows.');seenIngredient.add(item.id);
  const explicit=['baseUom','uom','unit'].filter(key=>row[key]!=null).map(key=>row[key]);if(explicit.some(value=>!text(value,40)||unit(value)!==unit(item.unit)))fail('recipe-unit-mismatch','A recipe quantity uses a different unit from its ingredient’s saved base unit.');
  // Existing BOM qty is measured in the ingredient's base units. A declared
  // unit must agree; no purchase-unit or current-recipe guess is made on undo.
  const used=row.qty*qty,after=item.beforeStock-used;if(!quantity(used)||used<=0||after===item.beforeStock||actual&&!signedStock(after))fail('quantity-out-of-range','The captured ingredient quantity is too large or too small for this saved stock.');if(!actual&&!quantity(after))fail('insufficient-stock','There is not enough '+item.name+' in this branch to prepare this quantity.',{details:{inventoryId:item.id,role:'ingredient'}});
  effects.push({...item,delta:-used,afterStock:after,role:'ingredient'});recipe.push({id:row.id,updateTime:prepTimestampToken(row.updateTime),inventoryId:item.id,quantityPerBatch:row.qty,unit:item.unit});
 }
 if(ingredients.length!==seenIngredient.size)fail('ingredient-lookup-incomplete','The ingredient lookup is incomplete or contains unrelated records.');
 return {version:actual?2:PREP_VERSION,kind:actual?'actual-prep':PREP_KIND,branch,outputInventoryId:target.id,outputName:target.name,qty,purchaseUnit,outputBaseQuantity:outputQuantity,effects,recipe:recipe.sort((a,b)=>a.id.localeCompare(b.id))};
}
export function planPrepReversal(operation,currentRows){return planReversal(operation,currentRows,false);}
export function planActualPrepReversal(operation,currentRows){return planReversal(operation,currentRows,true);}
function planReversal(operation,currentRows,actual){
 if(operation?.kind!==(actual?'actual-prep':PREP_KIND)||operation.version!==(actual?2:PREP_VERSION)||!prepId(operation.operationId)||!text(operation.branch,128)||!prepId(operation.outputInventoryId)||!Array.isArray(operation.effects)||operation.effects.length<2||operation.effects.length>PREP_MAX_INGREDIENTS+1||!prepTimestampToken(operation.createTime)||operation.updateTime!==undefined&&prepTimestampToken(operation.updateTime)!==prepTimestampToken(operation.createTime))fail('reversal-source-invalid','This older prep has no trusted, complete ingredient movement record. Automatic reversal is unavailable; ask HQ to review a documented stock correction.',{skippable:false});
 if(!Array.isArray(currentRows)||currentRows.length!==operation.effects.length)fail('reversal-source-incomplete','The original stock items are incomplete. Reversal is held.',{skippable:false});
 // The immutable operation is created atomically with every stock update.
 // Snapshot createTime is the original commit token, not a client field or a
 // millisecond-precision REQUEST_TIME transform.
 const rows=new Map(currentRows.map(row=>[row?.id,row])),seen=new Set(),committed=prepTimestampToken(operation.createTime),restored=[];
 for(const effect of operation.effects){
  if(!effect||!prepId(effect.id)||seen.has(effect.id)||effect.branch!==operation.branch||!savedName(effect.name)||!text(effect.unit,40)||!(effect.role==='output'||actual?signedStock(effect.beforeStock)&&signedStock(effect.afterStock):quantity(effect.beforeStock)&&quantity(effect.afterStock))||typeof effect.delta!=='number'||!Number.isFinite(effect.delta)||Math.abs(effect.delta)>1e12||effect.afterStock-effect.beforeStock!==effect.delta&&Math.abs((effect.afterStock-effect.beforeStock)-effect.delta)>Math.max(1,Math.abs(effect.delta))*Number.EPSILON*8||effect.role!==(effect.id===operation.outputInventoryId?'output':'ingredient')||effect.role==='output'&&effect.delta<=0||effect.role==='ingredient'&&effect.delta>=0)fail('reversal-movement-invalid','The saved prep movement record needs review.',{skippable:false});
  seen.add(effect.id);const source=rows.get(effect.id);let current;try{current=stock(source,operation.branch,{role:effect.role,signedIngredients:actual});}catch{fail('reversal-source-invalid','The original stock item or unit is unavailable. Reversal is held for HQ review.',{skippable:false});}
  if(current.name!==effect.name||unit(current.unit)!==unit(effect.unit)||current.beforeStock!==effect.afterStock||prepTimestampToken(source.updateTime)!==committed)fail('reversal-source-changed','Stock or item details changed after this prep. Reversal is held to protect later activity, even if the quantity was later restored.',{skippable:false});
  restored.push({id:effect.id,name:effect.name,branch:effect.branch,unit:effect.unit,role:effect.role,beforeStock:effect.afterStock,afterStock:effect.beforeStock,delta:-effect.delta,beforeUpdateTime:committed});
 }
 if(!seen.has(operation.outputInventoryId)||restored.filter(row=>row.role==='output').length!==1)fail('reversal-output-missing','The original prepared item is missing. Reversal is held.',{skippable:false});
 return {version:actual?2:PREP_VERSION,kind:actual?'actual-prep-reversal':'owner-prep-reversal',operationId:operation.operationId,branch:operation.branch,outputInventoryId:operation.outputInventoryId,outputName:operation.outputName,committedAt:committed,effects:restored};
}
