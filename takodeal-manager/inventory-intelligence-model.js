import {inventoryOverviewRow} from './inventory-overview.js';
import {millis,dateRange,phDay,wasteRows} from './operations-model.js';
import {saleIsPaid} from './dashboard-data.js';

const number=value=>!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value);
const text=value=>String(value??'').trim();
const sameUnit=(a,b)=>text(a).toLowerCase()===text(b).toLowerCase();
// A zero total is meaningful only when the evidence supports it. This small
// coverage policy keeps unavailable measurements separate from measured zero.
export function inventoryAmountEvidence({records,knownRecords,total,complete}){
 if(knownRecords===0&&records>0)return {state:'not-recorded',amount:null};
 if(knownRecords===0&&!complete)return {state:'unavailable',amount:null};
 return {state:knownRecords<records||!complete?'partial':'complete',amount:total};
}
export function inventoryAnalysisPeriod(from,to){const period=dateRange(from,to),days=(+period.end-+period.start)/86400000;if(days>31)throw Error('Choose up to 31 days for one inventory analysis.');return {...period,from,to,days};}
export function defaultInventoryAnalysisPeriod(now=Date.now(),days=7){const to=phDay(now),from=phDay(Date.parse(to+'T00:00:00+08:00')-(days-1)*86400000);return inventoryAnalysisPeriod(from,to);}
export function inventoryEvidenceRows(rows,{branch,start,end,field='timestamp'}){return rows.filter(row=>row.branch===branch&&millis(row[field])!==null&&millis(row[field])>=+start&&millis(row[field])<+end);}
export function distinctInventoryReceipts(rows){const seen=new Set();return rows.filter(row=>{const id=row.saleId||row.receiptId||row.id;if(!id)return false;const key=row.branch+'\0'+id;if(seen.has(key))return false;seen.add(key);return true;});}
export function inventoryQuantityLabel(baseQuantity,item){
 const value=number(baseQuantity),conversion=number(item.conversionRate??item.conversion??1),base=text(item.baseUom||item.uom),purchase=text(item.purchaseUom||item.purchUom||base);
 if(value===null)return 'Not recorded';const label=value.toLocaleString('en-PH',{maximumFractionDigits:3});
 if(!base)return label+' · unit not set';
 if(conversion===null||conversion<=0||!purchase)return label+' '+base+' · conversion needs review';
 return purchase.toLowerCase()!==base.toLowerCase()&&conversion!==1?(value/conversion).toLocaleString('en-PH',{maximumFractionDigits:3})+' '+purchase+' · '+label+' '+base:label+' '+base;
}

/** Historical receipt movements are authoritative; today's editable BOM is
 * never used to fabricate past consumption. Audit/count adjustments are not
 * sales demand. Legacy sale deduction logs are not added a second time. */
export function inventoryConsumption({inventory=[],transactions=[],stockLogs=[],complete=true,period}){
 const byId=new Map(inventory.map(item=>[item.id,item])),byName=new Map(),totals=new Map(),invalid=new Set();
 for(const item of inventory){const key=item.branch+'\0'+item.name;if(!byName.has(key))byName.set(key,[]);byName.get(key).push(item);}
 let legacyReceipts=0,reviewReceipts=0,appliedReceipts=0;
 const add=(item,qty)=>{totals.set(item.id,(totals.get(item.id)||0)+qty);};
 for(const sale of distinctInventoryReceipts(transactions)){
  const voided=String(sale.status||'').toLowerCase()==='voided';if(voided&&sale.preparedCancellation?.prepared!==true)continue;
  if(sale.cancelledFoodSourceId)continue;
  if(sale.inventoryState==='deferred'||sale.inventoryReviewRequired===true||sale.inventoryIssues?.length)reviewReceipts++;
  if(!Array.isArray(sale.inventoryMovements)){legacyReceipts++;continue;}
  if(sale.inventoryState!=='applied')continue;
  appliedReceipts++;
  for(const movement of sale.inventoryMovements){
   const candidates=byName.get(sale.branch+'\0'+movement.ingredientName)||[],candidate=movement.inventoryId?byId.get(movement.inventoryId):candidates.length===1?candidates[0]:null;
   const qty=number(movement.quantity);
   if(!candidate||candidate.branch!==sale.branch||candidate.name!==movement.ingredientName||candidates.length!==1||qty===null||qty<=0){if(candidate)invalid.add(candidate.id);continue;}
   add(candidate,qty);
  }
 }
 for(const log of stockLogs){
  const type=text(log.type).toLowerCase(),variance=number(log.variance);
  // Preparation ingredients and explicit store use are operational use. Sales,
  // transfers, waste, reversals and physical-count corrections are separate.
  if(variance===null||variance>=0||!/prep.*deduct|ingredient.*prep|store use|internal consumption/.test(type)||/revert|reversal|void|waste|audit|adjust|penalty/.test(type))continue;
  const candidates=byName.get(log.branch+'\0'+(log.item||log.itemName))||[];
  if(candidates.length!==1)continue;const item=candidates[0];
  if(!log.uom||!sameUnit(log.uom,item.baseUom||item.uom)){invalid.add(item.id);continue;}add(item,-variance);
 }
 return {totals,invalid,complete:complete&&legacyReceipts===0&&reviewReceipts===0,legacyReceipts,reviewReceipts,appliedReceipts,days:period.days};
}

export function buildInventoryForecast({inventory=[],transactions=[],stockLogs=[],period,complete=true}){
 const usage=inventoryConsumption({inventory,transactions,stockLogs,period,complete});
 const groups=new Map();for(const item of inventory){const key=item.branch+'\0'+item.name;groups.set(key,(groups.get(key)||0)+1);}
 const rows=inventory.map(item=>{
  const base=inventoryOverviewRow(item),target=number(item.maintainingStock),duplicate=groups.get(item.branch+'\0'+item.name)>1;
  let blockedReason='';
  if(duplicate)blockedReason='Duplicate item records need review';
  else if(base.stock===null)blockedReason='A physical stock count is required';
  else if(base.stock<0)blockedReason='Negative balance: audit stock before planning';
  else if(!text(item.baseUom||item.uom)||base.conversion===null||!text(item.purchaseUom||item.purchUom||item.baseUom||item.uom))blockedReason='Unit conversion needs review';
  else if(base.thresholdConflict||base.status==='Settings need review'||target!==null&&target<0)blockedReason='Restock settings need review';
  else if(usage.invalid.has(item.id))blockedReason='Recorded usage does not match this item’s units';
  const recordedUse=usage.totals.get(item.id)||0,rateAllowed=!blockedReason&&usage.complete,dailyUse=rateAllowed&&recordedUse>0?recordedUse/period.days:null;
  const daysLeft=dailyUse!==null?Math.max(0,base.stock/dailyUse):null;
  const targetGap=!blockedReason&&target!==null&&target>=0?Math.max(0,target-base.stock):null;
  return {...base,maintainingStock:target,recordedUse,dailyUse,daysLeft,targetGap,blockedReason,forecastComplete:rateAllowed,
   predictionLabel:blockedReason||(!usage.complete?'History incomplete: prediction unavailable':dailyUse===null?'No recorded use in this period':daysLeft===0?'Out of stock':daysLeft.toFixed(1)+' estimated days'),
   actionable:!blockedReason&&complete&&(targetGap!==null||dailyUse!==null)};
 }).sort((a,b)=>Number(!!b.blockedReason)-Number(!!a.blockedReason)||(a.daysLeft??Infinity)-(b.daysLeft??Infinity)||a.name.localeCompare(b.name));
 return {rows,usage,complete,period,blockedCount:rows.filter(row=>row.blockedReason).length};
}

export function buildInventoryBrief({inventory=[],transactions=[],stockLogs=[],inventoryLogs=[],shifts=[],period,complete=true}){
 const forecast=buildInventoryForecast({inventory,transactions,stockLogs,period,complete}),sales=distinctInventoryReceipts(transactions).filter(saleIsPaid);
 const validSales=sales.filter(row=>number(row.netTotal)!==null),salesTotal=validSales.reduce((sum,row)=>sum+Number(row.netTotal),0);
 const waste=wasteRows(stockLogs,inventoryLogs,inventory),audit=stockLogs.filter(row=>/audit|manual adjustment/i.test(row.type||'')&&number(row.variance)!==null),closed=shifts.filter(row=>text(row.status).toLowerCase()==='closed');
 const knownWaste=waste.filter(row=>row.value!==null),closedWithDifference=closed.filter(row=>number(row.difference)!==null);
 const assets=forecast.rows.filter(row=>row.value!==null).reduce((sum,row)=>sum+row.value,0),largest=forecast.rows.filter(row=>row.value!==null&&row.value>0).sort((a,b)=>b.value-a.value)[0]||null;
 return {period,complete,forecast,salesCount:sales.length,validSalesCount:validSales.length,salesTotal,unvaluedSales:sales.length-validSales.length,waste,wasteTotal:knownWaste.reduce((sum,row)=>sum+row.value,0),valuedWasteCount:knownWaste.length,unknownWasteCosts:waste.length-knownWaste.length,
  estimatedWasteRows:waste.filter(row=>row.costBasis==='Estimate using current unit cost').length,assetValue:assets,missingItemCosts:forecast.rows.filter(row=>row.baseCost===null).length,largest,
  stockRecordsCount:forecast.rows.length,valuedStockCount:forecast.rows.filter(row=>row.value!==null).length,
  audits:audit,auditShortages:audit.filter(row=>Number(row.variance)<0).length,closedShifts:closed.length,knownShiftDifferenceCount:closedWithDifference.length,unknownShiftDifferences:closed.length-closedWithDifference.length,
  cashShortage:closedWithDifference.reduce((sum,row)=>sum+Math.max(0,-Number(row.difference)),0),
  // An audit shortage is evidence to investigate. It does not establish theft,
  // staff fault, a payroll charge or insolvency.
  observations:[...(forecast.blockedCount?[forecast.blockedCount+' stock records need an audit or settings review before forecasting.']:[]),
   ...(waste.length?[waste.length+' waste/spoilage records in the selected period.']:['No waste/spoilage records were returned for this period.']),
   ...(audit.some(row=>Number(row.variance)<0)?['Audit shortages were recorded. Review the original count and stock movements before deciding the cause.']:[]),
   ...(!forecast.usage.complete?['Usage coverage is incomplete. Daily-use and run-out predictions are withheld.']:[])]};
}
