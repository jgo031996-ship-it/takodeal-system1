// Read-only explanations of submitted physical counts. These calculations never
// apply inventory movements, establish staff responsibility or authorize payroll.
export const STOCK_AUDIT_VERSION=3;
export const STOCK_AUDIT_CYCLES=['Weekly','Monthly','Daily','As Needed'];
const DAY=86400000,PH=8*3600000;
export const stockAuditNumber=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))?Number(value):null;
export function stockAuditMillis(value){if(value==null||typeof value==='boolean')return null;const ms=value?.toMillis?.()??value?.toDate?.()?.getTime?.()??value?.getTime?.()??(typeof value==='object'&&typeof value.seconds==='number'?value.seconds*1000+(value.nanoseconds||0)/1e6:typeof value==='number'?value:Date.parse(value));return Number.isFinite(ms)?ms:null;}
export function stockAuditDay(value=Date.now()){const ms=stockAuditMillis(value);if(ms===null)throw Error('A valid Philippine report date is required.');return new Date(ms+PH).toISOString().slice(0,10);}
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose valid report dates.');const ms=Date.parse(value+'T00:00:00+08:00');if(!Number.isFinite(ms)||stockAuditDay(ms)!==value)throw Error('Choose valid report dates.');return ms;};
export function stockAuditRange(from,to){const start=date(from),end=date(to)+DAY;if(end<=start||end-start>32*DAY)throw Error('Choose report dates in order, within one month.');return{from,to,start:new Date(start),end:new Date(end)};}
export function stockAuditPeriod(cycle='Weekly',now=Date.now()){
 if(!STOCK_AUDIT_CYCLES.includes(cycle))throw Error('Choose Weekly, Monthly, Daily or As Needed.');const today=stockAuditDay(now),day=date(today),parts=today.split('-').map(Number);let start=day,end=day;
 if(cycle==='Weekly'){const weekday=new Date(day+PH).getUTCDay();start=day-((weekday+6)%7)*DAY;end=start+6*DAY;}
 else if(cycle==='Monthly'){start=Date.UTC(parts[0],parts[1]-1,1)-PH;end=Date.UTC(parts[0],parts[1],0)-PH;}
 return{cycle,from:stockAuditDay(start),to:stockAuditDay(end)};
}
const same=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-9;
const text=value=>typeof value==='string'?value.trim():'';
export function normalizeStockAuditReport(source,{legacy=false}={}){
 const report={...source,legacy:legacy||source.version!==STOCK_AUDIT_VERSION},issues=[],seen=new Set();
 report.time=stockAuditMillis(source.cutoff??source.timestamp);if(report.time===null)issues.push('The submission time is not recorded.');
 report.counts=(Array.isArray(source.counts)?source.counts:[]).map((row,index)=>{
  const physicalQty=stockAuditNumber(row.physicalQty??row.actualQty),systemQty=stockAuditNumber(row.systemQty),cost=stockAuditNumber(row.cost),id=text(row.itemId),unit=text(row.countSnapshot?.baseUom||row.uom),variance=physicalQty!==null&&systemQty!==null?physicalQty-systemQty:null,warnings=[];
  if(!id)warnings.push('The saved inventory ID is missing.');else if(seen.has(id))warnings.push('This inventory ID appears more than once.');seen.add(id);
  if(physicalQty===null||physicalQty<0)warnings.push('The actual count needs review.');if(systemQty===null)warnings.push('The expected system quantity was not saved.');if(!unit)warnings.push('The base unit was not saved.');
  if(row.variance!=null&&(stockAuditNumber(row.variance)===null||variance!==null&&!same(Number(row.variance),variance)))warnings.push('The saved variance does not match its quantities.');
  const saved=row.countSnapshot;if(saved&&(saved.version!==1||stockAuditNumber(saved.conversionRate)===null||Number(saved.conversionRate)<=0||!same(Number(saved.purchaseCount)*Number(saved.conversionRate)+Number(saved.baseCount),physicalQty)))warnings.push('The saved count units are inconsistent.');
  return{...row,itemId:id||null,index,name:text(row.name)||'Item not recorded',physicalQty,systemQty,variance,cost:cost!==null&&cost>=0?cost:null,uom:unit||null,cycle:row.targetSnapshot?.cycle||source.selectedCycle||'Not recorded',warnings,value:variance!==null&&cost!==null&&cost>=0?Math.abs(variance)*cost:null,state:warnings.length?'Needs review':same(variance,0)?'Matches saved system':variance<0?'Below saved system':'Above saved system'};
 });
 if(!report.counts.length)issues.push('No counted items were retained.');if(report.legacy)issues.push(source.version===STOCK_AUDIT_VERSION?'The immutable report link was not loaded; review the source count.':'Older submitted count; immutable report and full item history were not retained.');
 report.issues=issues;report.shortageValue=report.counts.reduce((sum,row)=>sum+(row.variance<0&&row.value!==null?row.value:0),0);report.unknownCosts=report.counts.filter(row=>row.variance<0&&row.cost===null).length;return report;
}
const eventTime=row=>stockAuditMillis(row.timestamp??row.createdAt);
const rowItem=row=>text(row.inventoryId||row.itemId);
const isCount=row=>/audit|physical count|cycle count|manual count/i.test(text(row.type));
const isSaleLog=row=>/sales? deduction|sale ingredient|transaction voided/i.test(text(row.type));
const nameOf=row=>text(row.item||row.itemName||row.name);
/** Frozen systemQty already includes applied sales. Ledger reconstruction is an
 * explanation alongside it, never another subtraction from that saved balance. */
export function explainStockAudit(source,{baselines=[],transactions=[],stockLogs=[],inventoryLogs=[],complete=true,coverage=[]}={}){
 const report=normalizeStockAuditReport(source),globalWarnings=[...report.issues];if(!complete)globalWarnings.push('Some evidence is missing, unavailable or outside the read limit.');
 const sales=new Map();for(const sale of transactions){const id=sale.saleId||sale.id;if(!id){globalWarnings.push('A receipt has no stable saved reference.');continue;}if(sales.has(id)&&JSON.stringify(sales.get(id))!==JSON.stringify(sale))globalWarnings.push('Conflicting copies of a receipt need review.');else sales.set(id,sale);}
 const baselineReports=baselines.map(row=>normalizeStockAuditReport(row,{legacy:row.version!==3})).filter(row=>row.branch===report.branch&&row.id!==report.id&&row.time!==null&&report.time!==null&&row.time<report.time);
 const rows=report.counts.map(item=>{
  const warnings=[...item.warnings],prior=baselineReports.flatMap(row=>row.counts.filter(count=>count.itemId&&count.itemId===item.itemId&&count.uom===item.uom&&count.physicalQty!==null&&count.physicalQty>=0).map(count=>({report:row,count}))).sort((a,b)=>b.report.time-a.report.time)[0];
  const buckets={received:0,transferred:0,prepared:0,sold:0,wasted:0,consumed:0,corrections:0},references=[],referenceStats={count:0},legacyApplication=new Set(),from=prior?.report.time;
  const remember=reference=>{referenceStats.count++;if(references.length<25)references.push(reference);};
  if(!prior)warnings.push('A prior physical count with this exact inventory ID and unit was not found.');
  else if(prior.report.legacy)warnings.push('The prior physical baseline is an older mutable record; HQ should confirm its history.');
  const inside=time=>from!==undefined&&time!==null&&time>from&&report.time!==null&&time<=report.time;
  for(const sale of sales.values()){
   if(sale.branch!==report.branch||sale.cancelledFoodSourceId)continue;const soldAt=eventTime(sale),confirmedAppliedAt=stockAuditMillis(sale.inventoryAppliedAt),appliedAt=confirmedAppliedAt??soldAt,voidAt=stockAuditMillis(sale.voidTime),prepared= sale.preparedCancellation?.prepared===true;
   if(!inside(soldAt)&&!inside(appliedAt)&&!inside(voidAt))continue;
   if(sale.recipeIssues?.length)warnings.push('An original recipe is unavailable for receipt '+text(sale.receiptId||sale.id)+'.');
   if((sale.inventoryIssues||[]).some(issue=>issue.ingredientName===item.name||issue.lookupName===item.name))warnings.push('Receipt '+text(sale.receiptId||sale.id)+' skipped a missing or duplicate ingredient link.');
   if(!Array.isArray(sale.inventoryMovements)){warnings.push('Receipt '+text(sale.receiptId||sale.id)+' has no historical ingredient movements.');continue;}
   const movements=sale.inventoryMovements.filter(movement=>movement.inventoryId===item.itemId);
   if(sale.inventoryMovements.some(movement=>!movement.inventoryId&&movement.ingredientName===item.name))warnings.push('A receipt movement has only an ingredient name; its identity cannot be verified.');
   if(!movements.length)continue;
   if(confirmedAppliedAt===null)legacyApplication.add(sale.id||sale.saleId);else if(confirmedAppliedAt>report.time)warnings.push('Receipt '+text(sale.receiptId||sale.id)+' was not applied until after this count cutoff.');
   if(['deferred','audit_pending'].includes(sale.inventoryState)){warnings.push('A saved ingredient deduction is still deferred for receipt '+text(sale.receiptId||sale.id)+'.');continue;}
   if(!['applied','reversed','cancelled'].includes(sale.inventoryState)){warnings.push('A receipt inventory state is not confirmed.');continue;}
   for(const movement of movements){const qty=stockAuditNumber(movement.quantity);if(qty===null||qty<=0||movement.ingredientName!==item.name){warnings.push('A receipt ingredient quantity or identity changed.');continue;}
    // A prepared cancellation consumes its original food once. A normal void
    // restores it at voidTime; historical reports keep the original event dates.
    if(sale.inventoryState==='cancelled'&&!prepared)continue;
    if(inside(appliedAt)){buckets.sold+=qty;remember({source:'transactions',id:sale.id||sale.saleId,kind:'Sold ingredients',quantity:-qty});}
    if(!prepared&&sale.inventoryState==='reversed'){if(voidAt===null)warnings.push('A reversed receipt has no saved reversal time.');else if(inside(voidAt)){buckets.corrections+=qty;remember({source:'transactions',id:sale.id||sale.saleId,kind:'Ordinary sale reversal',quantity:qty});}}
   }
  }
  const logs=new Map();for(const log of stockLogs){if(log.branch!==report.branch||!inside(eventTime(log)))continue;const id=log.id;if(!id){warnings.push('A stock movement is missing its record reference.');continue;}logs.set('stock_logs/'+id,{...log,source:'stock_logs'});}
  for(const log of inventoryLogs){
   if(log.branch!==report.branch||!inside(eventTime(log)))continue;
   const mirror=logs.get('stock_logs/'+log.id)||[...logs.values()].find(other=>other.inventoryLogId===log.id||other.sourceInventoryLogId===log.id);
   if(mirror){
    const a=stockAuditNumber(mirror.variance),b=stockAuditNumber(log.variance),unitA=text(mirror.uom||mirror.unit),unitB=text(log.uom||log.unit),agrees=nameOf(mirror)===nameOf(log)&&a!==null&&b!==null&&same(a,b)&&unitA===unitB&&eventTime(mirror)===eventTime(log);
    // Franchise writes these two documents under the same immutable operation
    // ID. Its inventory log retained the inventory ID before stock_logs did.
    if(agrees&&!rowItem(mirror)&&rowItem(log))mirror.inventoryId=rowItem(log);
    else if(!agrees&&(rowItem(log)===item.itemId||rowItem(mirror)===item.itemId||nameOf(log)===item.name))warnings.push('Mirrored stock history conflicts; review its original operation.');
    continue;
   }
   logs.set('inventory_logs/'+log.id,{...log,source:'inventory_logs'});
  }
  for(const log of logs.values()){
   if(/incoming dispatch/i.test(text(log.type)))continue;
   if(rowItem(log)!==item.itemId){if(!rowItem(log)&&nameOf(log)===item.name)warnings.push('A name-only stock movement could not be tied to this inventory record.');continue;}
   const unit=text(log.uom||log.unit||log.baseUom),qty=stockAuditNumber(log.variance),type=text(log.type);
   if(unit!==item.uom||qty===null){warnings.push('A stock movement has missing quantities or different units.');continue;}
   if(isCount(log)||isSaleLog(log)||/incoming dispatch/i.test(type))continue;
   let kind;if(/revert|undone|negative balance correction|manual adjustment/i.test(type))kind='corrections';else if(/delivery received|hq delivery restock|hq auto restock|initial inventory|store restock/i.test(type))kind='received';else if(/dispatch|backload|transfer/i.test(type))kind='transferred';else if(/prep.*ingredient|ingredient.*prep/i.test(type))kind='consumed';else if(/prep|batch|production/i.test(type))kind='prepared';else if(/waste|spoil/i.test(type))kind='wasted';else if(/store use|internal consumption/i.test(type))kind='consumed';else{warnings.push('An unclassified stock change needs review: '+(type||'Type not recorded')+'.');kind='corrections';}
   buckets[kind]+=kind==='wasted'||kind==='consumed'?-qty:qty;remember({source:log.source,id:log.id,kind:type,quantity:qty});
  }
  const reconstructed=prior?prior.count.physicalQty+buckets.received+buckets.transferred+buckets.prepared-buckets.sold-buckets.wasted-buckets.consumed+buckets.corrections:null;
  if(reconstructed!==null&&item.systemQty!==null&&!same(reconstructed,item.systemQty))warnings.push('The available movement explanation does not equal the saved expected balance.');
  if(legacyApplication.size)warnings.push('Some receipts have no saved inventory application time; delayed or offline posting needs a separate HQ check.');
  return{...item,baseline:prior?{id:prior.report.id,time:prior.report.time,quantity:prior.count.physicalQty}:null,buckets,references,referenceCount:referenceStats.count,reconstructed,warnings:[...new Set(warnings)],explanationComplete:complete&&globalWarnings.length===0&&warnings.length===0};
 });return{report,rows,coverage,warnings:[...new Set(globalWarnings)],complete:complete&&globalWarnings.length===0&&rows.every(row=>row.explanationComplete)};
}
