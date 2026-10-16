const PH_OFFSET=28800000,DAY=86400000;
const text=value=>typeof value==='string'?value.trim():'';
export const historyNumber=value=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number.isFinite(Number(value))?Number(value):null:null;
const nonnegative=value=>{const n=historyNumber(value);return n!==null&&n>=0?n:null;};
export function historyMillis(value){
 try{let n;if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){if(new Date(value).toISOString().slice(0,10)!==value)return null;n=Date.parse(value+'T00:00:00+08:00');}
 else n=value instanceof Date?value.getTime():typeof value?.toMillis==='function'?value.toMillis():typeof value?.toDate==='function'?value.toDate().getTime():typeof value?.seconds==='number'?value.seconds*1000+(Number(value.nanoseconds)||0)/1e6:typeof value==='number'?value:typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)?Date.parse(value):NaN;
 return Number.isFinite(n)?n:null;}catch{return null;}
}
export const historyDay=(now=Date.now())=>new Date(now+PH_OFFSET).toISOString().slice(0,10);
export function historyPeriod(from,to){
 for(const value of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||historyMillis(value)===null)throw Error('Choose valid start and end dates.');
 const start=historyMillis(from),end=historyMillis(to)+DAY;
 if(start>=end||end-start>367*DAY)throw Error('Choose dates in order, within one year.');
 return {from,to,start:new Date(start),end:new Date(end)};
}
export function historyDateLabel(value){const ms=historyMillis(value);if(ms===null)return 'Date / time not recorded';if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(ms).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'})+' · time not recorded';return new Date(ms).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+' (PH)';}
export function historyInPeriod(row,period){const ms=historyMillis(row.timestamp??row.createdAt??row.date);return ms!==null&&ms>=+period.start&&ms<+period.end;}
export function safeHistoryProof(value){if(typeof value!=='string')return '';if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<=7e6)return value;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function historyBranch(row){return text(row.branch)||null;}
const firstNumber=(row,keys,valid=historyNumber)=>{for(const key of keys)if(row[key]!==undefined&&row[key]!==null&&row[key]!=='')return valid(row[key]);return null;};
const firstText=(row,keys,fallback)=>keys.map(key=>text(row[key])).find(Boolean)||fallback;
const timestamp=row=>row.timestamp??row.createdAt??row.date;
function wasteValue(row,quantity){
 const saved=firstNumber(row,['valueLost','wasteCost'],nonnegative);if(saved!==null)return {recordedValue:saved,estimatedValue:null,valueBasis:'Recorded waste value'};
 const cost=nonnegative(row.costSnapshot?.baseUnitCost??row.costSnapshot?.baseCost);
 const estimate=quantity!==null&&cost!==null?quantity*cost:null;
 return {recordedValue:null,estimatedValue:Number.isFinite(estimate)?estimate:null,valueBasis:estimate===null?'Value not recorded':'Estimate from saved unit-cost snapshot'};
}
export function normalizeInventoryHistory(kind,sources){
 const stock=sources.stock_logs||[],legacy=sources.inventory_logs||[],linkedLegacy=new Set(stock.flatMap(row=>[row.inventoryLogId,row.sourceInventoryLogId].filter(Boolean))),stockIds=new Set(stock.map(row=>row.id));
 let inputs=kind==='Invoices'?(sources.hq_restocks||[]).map(row=>({...row,source:'hq_restocks'})):[...stock.map(row=>({...row,source:'stock_logs'})),...(kind==='Waste'?legacy.filter(row=>!linkedLegacy.has(row.id)&&!stockIds.has(row.stockLogId||row.sourceStockLogId)).map(row=>({...row,source:'inventory_logs'})):[])];
 if(kind==='Waste')inputs=inputs.filter(row=>/waste|spoilage/i.test(row.type||''));
 const seen=new Set();const normalized=inputs.filter(row=>{const key=row.source+'/'+row.id;if(seen.has(key))return false;seen.add(key);return true;}).map(row=>{
  const common={id:row.id,key:row.source+'/'+row.id,source:row.source,branch:historyBranch(row),timestamp:timestamp(row),time:historyMillis(timestamp(row)),actor:firstText(row,['user','loggedBy','cashier','actorEmail'],'Staff not recorded'),reason:firstText(row,['note','reason'],''),proof:safeHistoryProof(row.photoUrl||row.proofImageUrl||row.photoBase64),raw:row};
  if(kind==='Invoices'){
   const auto=row.dispatchAutoRestock===true||!!text(row.dispatchBatchId),reverted=/^reverted$/i.test(row.status||''),items=(Array.isArray(row.items)?row.items:[]).filter(item=>item&&typeof item==='object').map(item=>({name:firstText(item,['name','itemName'],'Item not recorded'),quantity:firstNumber(item,['purchQty','qty','purchaseQty','restockQty'],nonnegative),unit:firstText(item,['purchUom','purchaseUom','baseUom'],'unit not recorded'),value:firstNumber(item,['subtotal','estimatedSubtotal'],nonnegative)}));
   const total=nonnegative(row.totalCost),estimatedItems=items.map(item=>item.value),knownEstimate=estimatedItems.reduce((sum,value)=>sum+(value??0),0),completeEstimate=auto&&total!==null&&items.length>0&&estimatedItems.every(value=>value!==null)&&Math.abs(knownEstimate-total)<=.011;
   return {...common,name:firstText(row,['supplier'],'Reference not recorded'),type:auto?'Dispatch restock estimate':reverted?'Reverted invoice':'Supplier restock',items,reverted,automatic:auto,recordedValue:!auto&&!reverted?total:null,estimatedValue:auto&&!reverted&&completeEstimate?total:null,partialEstimate:auto&&!reverted&&!completeEstimate?knownEstimate:null,valueBasis:reverted?'Reverted · excluded from active totals':auto?'Last-price estimate; not a supplier payment':total===null?'Invoice value not recorded':'Recorded invoice cost',destination:text(row.toBranch),dispatchBatchId:text(row.dispatchBatchId)};
  }
  const quantity=kind==='Waste'?(()=>{const value=firstNumber(row,['qtyWasted','variance','quantity','qty']);return value===null?null:Math.abs(value);})():firstNumber(row,['variance']);
  return {...common,name:firstText(row,['item','itemName'],'Item not recorded'),type:text(row.type)||'Movement type not recorded',quantity,unit:firstText(row,['uom','unit','baseUom'],'unit not recorded'),oldQty:historyNumber(row.oldQty),newQty:historyNumber(row.newQty),...(kind==='Waste'?wasteValue(row,quantity):{recordedValue:null,estimatedValue:null,valueBasis:'Movement quantities are not a purchase cost'})};
 });
 // A committed dispatch is one operation even if an older client copied its
 // estimate document. Conflicting copies stay visible as one unpriced record.
 const dispatches=new Map(),result=[];
 for(const row of normalized){
  if(kind!=='Invoices'||!row.automatic||!row.dispatchBatchId){result.push(row);continue;}
  const key=(row.branch||'')+'\0'+row.dispatchBatchId,previous=dispatches.get(key);
  if(!previous){dispatches.set(key,row);result.push(row);continue;}
  previous.duplicateCount=(previous.duplicateCount||0)+1;
  const comparable=value=>JSON.stringify({branch:value.branch,time:value.time,destination:value.destination,items:value.items,reverted:value.reverted,recordedValue:value.recordedValue,estimatedValue:value.estimatedValue,partialEstimate:value.partialEstimate});
  if(previous.duplicateConflict||comparable(previous)!==comparable(row)){previous.duplicateConflict=true;previous.estimatedValue=null;previous.partialEstimate=0;previous.valueBasis='Conflicting copies of this dispatch estimate; review original delivery.';}
 }
 return result.sort((a,b)=>(b.time??-Infinity)-(a.time??-Infinity)||a.key.localeCompare(b.key));
}
export function historyMatches(row,search){const query=text(search).toLowerCase();return !query||[row.name,row.branch,row.actor,row.reason,row.type,row.id,...(row.items||[]).map(item=>item.name)].join(' ').toLowerCase().includes(query);}
export function summarizeInventoryHistory(rows,branches,{kind='StockLogs'}={}){
 const names=[...new Set([...branches,...rows.map(row=>row.branch)])].sort((a,b)=>a===null?1:b===null?-1:a.localeCompare(b));
 return names.map(branch=>{const records=rows.filter(row=>row.branch===branch),active=records.filter(row=>!row.reverted),known=active.filter(row=>row.recordedValue!==null),estimated=active.filter(row=>row.estimatedValue!==null),names=new Set(records.flatMap(row=>row.items?row.items.map(item=>item.name):[row.name]));
 const total=values=>{const value=values.reduce((sum,value)=>sum+value,0);return Number.isFinite(value)?value:null;};
 return {branch,records:records.length,activeRecords:active.length,revertedRecords:records.length-active.length,itemCount:names.size,latest:records.find(row=>row.time!==null)?.timestamp??null,recordedCount:known.length,recordedValue:total(known.map(row=>row.recordedValue)),estimatedCount:estimated.length,estimatedValue:total(estimated.map(row=>row.estimatedValue)),partialEstimate:total(active.map(row=>row.partialEstimate??0)),unknownValues:kind==='StockLogs'?0:active.filter(row=>row.recordedValue===null&&row.estimatedValue===null).length,unknownQuantities:records.filter(row=>!row.items&&row.quantity===null).length,types:[...new Map(records.reduce((entries,row)=>{const key=row.type||'Other',entry=entries.find(([type])=>type===key);if(entry)entry[1]++;else entries.push([key,1]);return entries;},[])).entries()]};});
}
export function restockReversalPlan(invoice,currentRows){
 if(invoice?.version!==2||!Array.isArray(invoice.inventoryEffects)||!invoice.inventoryEffects.length)throw Error('This older invoice has no before-and-after cost snapshots. Revert & Edit is unavailable to prevent changing stock or average costs incorrectly. Review its ledger and make a documented correction instead.');
 if(invoice.inventoryEffects.length>180)throw Error('This invoice is too large for one guarded reversal. Review it with the Owner.');
 if(invoice.dispatchAutoRestock===true||text(invoice.dispatchBatchId))throw Error('A delivery-linked restock estimate cannot be reverted here. Review the original delivery.');
 if(invoice.branch!=='Main Office')throw Error('Revert & Edit is limited to recorded Main Office restocks.');
 if(/reverted/i.test(invoice.status||''))throw Error('This invoice was already reverted.');
 const fields=new Set(['currentStock','baseCost','purchaseCost','purchCost','cost','name','branch','category','uom','baseUom','purchaseUom','purchUom','conversionRate','conversion']),map=new Map(currentRows.map(row=>[row.id,row])),seen=new Set();
 return invoice.inventoryEffects.map(effect=>{
  const id=effect?.inventoryId;if(typeof id!=='string'||!id||id.includes('/')||seen.has(id))throw Error('This invoice has missing or duplicate stock effects. Review the original record.');seen.add(id);
  if(!effect.before||!effect.after||typeof effect.before!=='object'||typeof effect.after!=='object'||Array.isArray(effect.before)||Array.isArray(effect.after))throw Error('The saved cost snapshots are incomplete.');
  const row=map.get(id);if(!row||row.branch!=='Main Office'||effect.before.branch!=='Main Office'||effect.after.branch!=='Main Office')throw Error('An invoice stock item is missing or belongs to another branch.');
  if(!text(effect.before.name)||effect.before.name!==effect.after.name)throw Error('The saved item identity changed within this invoice. Review the original record.');
  const keys=[...new Set([...Object.keys(effect.before),...Object.keys(effect.after)])];if(keys.some(key=>!fields.has(key)))throw Error('This invoice snapshot contains unsupported stock fields. Review the original record.');
  if(historyNumber(effect.before.currentStock)===null||historyNumber(effect.after.currentStock)===null||nonnegative(effect.before.baseCost)===null||nonnegative(effect.after.baseCost)===null)throw Error('The saved quantity or cost snapshots are invalid.');
  if(historyNumber(effect.after.currentStock)<=historyNumber(effect.before.currentStock))throw Error('This invoice does not contain a positive recorded stock addition.');
  for(const key of keys){if(Object.hasOwn(effect.after,key)!==Object.hasOwn(row,key)||Object.hasOwn(row,key)&&row[key]!==effect.after[key])throw Error('Stock, units or costs changed after this invoice. Revert & Edit is held to protect later activity.');if(['baseCost','purchaseCost','purchCost','cost','conversionRate','conversion'].includes(key)&&Object.hasOwn(effect.before,key)&&nonnegative(effect.before[key])===null)throw Error('A prior cost or conversion is invalid. Review this invoice.');}
  const {id:ignore,...restored}=row;for(const key of keys){if(Object.hasOwn(effect.before,key))restored[key]=effect.before[key];else delete restored[key];}
  return {id,before:row,restored,removedFields:keys.filter(key=>!Object.hasOwn(effect.before,key)),quantity:historyNumber(row.currentStock)-historyNumber(restored.currentStock),name:row.name||'Item not recorded',unit:row.baseUom||row.uom||'base units'};
 });
}
