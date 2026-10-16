import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryAnalysisPeriod,defaultInventoryAnalysisPeriod,inventoryQuantityLabel,buildInventoryForecast,buildInventoryBrief,inventoryAmountEvidence} from '../takodeal-manager/inventory-intelligence-model.js';
import {createInventoryIntelligenceReader} from '../takodeal-manager/inventory-intelligence-reader.js';
const period=inventoryAnalysisPeriod('2026-10-01','2026-10-07');
const stock=overrides=>({id:'sauce',name:'Sauce',branch:'Maa',currentStock:140,baseUom:'gram',uom:'gram',purchaseUom:'Pack',conversionRate:100,baseCost:1,maintainingStock:500,reorderLevel:0,lowStockAlert:0,...overrides});
const sale=overrides=>({id:'sale1',saleId:'s1',branch:'Maa',status:'Paid',netTotal:100,timestamp:new Date('2026-10-03T00:00:00+08:00'),inventoryState:'applied',inventoryMovements:[{inventoryId:'sauce',ingredientName:'Sauce',quantity:70}],...overrides});

test('analysis dates use inclusive Philippine calendar days and reject broad scans',()=>{
 assert.equal(period.days,7);assert.equal(period.start.toISOString(),'2026-09-30T16:00:00.000Z');assert.equal(period.end.toISOString(),'2026-10-07T16:00:00.000Z');
 assert.equal(defaultInventoryAnalysisPeriod(Date.parse('2026-10-15T23:00:00Z')).to,'2026-10-16');
 assert.throws(()=>inventoryAnalysisPeriod('2026-01-01','2026-02-02'),/31 days/);assert.throws(()=>inventoryAnalysisPeriod('2026-02-30','2026-03-01'),/valid/);
});
test('negative balances require an audit and never create negative days or inflated restock gaps',()=>{
 const report=buildInventoryForecast({inventory:[stock({currentStock:-100000})],transactions:[sale()],period});
 assert.equal(report.rows[0].stock,-100000);assert.equal(report.rows[0].daysLeft,null);assert.equal(report.rows[0].targetGap,null);assert.equal(report.rows[0].actionable,false);assert.match(report.rows[0].blockedReason,/Negative balance/);
 const zero=buildInventoryForecast({inventory:[stock({currentStock:0})],transactions:[sale()],period}).rows[0];assert.equal(zero.daysLeft,0);assert.equal(zero.targetGap,500);assert.equal(zero.threshold,0);
});
test('duplicate names, invalid conversions and conflicting alert aliases hold predictions',()=>{
 for(const inventory of [[stock(),stock({id:'duplicate',baseUom:'ml'})],[stock({conversionRate:0})],[stock({reorderLevel:3,lowStockAlert:7})]]){
  const report=buildInventoryForecast({inventory,transactions:[sale()],period});assert.ok(report.rows.every(row=>row.blockedReason&&row.daysLeft===null&&row.targetGap===null));
 }
});
test('recorded receipt movements and explicit consumption count once; audits, reversals and waste are not demand',()=>{
 const transactions=[sale(),sale({id:'duplicate'}),sale({id:'void',saleId:'void',status:'Voided'}),sale({id:'prepared',saleId:'prepared',status:'Voided',preparedCancellation:{prepared:true},inventoryMovements:[{ingredientName:'Sauce',inventoryId:'sauce',quantity:14}]}),sale({id:'staff',saleId:'staff',cancelledFoodSourceId:'prepared'})];
 const logs=[{branch:'Maa',item:'Sauce',uom:'gram',variance:-999,type:'Manual Adjustment'},{branch:'Maa',item:'Sauce',uom:'gram',variance:-999,type:'Waste / Spoilage'},{branch:'Maa',item:'Sauce',uom:'gram',variance:-7,type:'Store Use'},{branch:'Maa',item:'Sauce',uom:'gram',variance:-999,type:'Kitchen Prep Undone'}];
 const row=buildInventoryForecast({inventory:[stock()],transactions,stockLogs:logs,period}).rows[0];assert.equal(row.recordedUse,91);assert.equal(row.dailyUse,13);assert.equal(row.targetGap,360);
 assert.equal(inventoryQuantityLabel(row.targetGap,row),'3.6 Pack · 360 gram');
});
test('legacy or deferred receipt coverage and truncated sources withhold run-out estimates',()=>{
 for(const input of [{transactions:[sale({inventoryMovements:undefined})]},{transactions:[sale({inventoryState:'deferred'})]},{transactions:[sale()],complete:false}]){
  const row=buildInventoryForecast({inventory:[stock()],period,...input}).rows[0];assert.equal(row.dailyUse,null);assert.equal(row.daysLeft,null);assert.match(row.predictionLabel,/incomplete/);
 }
});
test('brief uses saved sales and waste evidence and does not invent staff-accuracy or insolvency scores',()=>{
 const report=buildInventoryBrief({inventory:[stock()],transactions:[sale(),sale({id:'void',saleId:'void',status:'Voided',netTotal:999})],stockLogs:[{id:'w',branch:'Maa',item:'Sauce',type:'Waste / Spoilage',variance:-2,valueLost:0,timestamp:new Date('2026-10-03')},{id:'audit',branch:'Maa',item:'Sauce',type:'Manager General Audit',variance:-5}],shifts:[{status:'Closed',difference:-20},{status:'Closed'}],period});
 assert.equal(report.salesTotal,100);assert.equal(report.wasteTotal,0);assert.equal(report.cashShortage,20);assert.equal(report.unknownShiftDifferences,1);assert.equal(report.auditShortages,1);
 assert.equal(report.accuracyScore,undefined);assert.ok(report.observations.some(value=>value.includes('before deciding the cause')));assert.equal(report.assetValue,140);
});
test('missing measurements never become a zero total; measured zero and mixed evidence stay distinct',()=>{
 const unknown=inventoryAmountEvidence({records:6,knownRecords:0,total:0,complete:true});assert.deepEqual(unknown,{state:'not-recorded',amount:null});
 assert.deepEqual(inventoryAmountEvidence({records:0,knownRecords:0,total:0,complete:false}),{state:'unavailable',amount:null});
 assert.deepEqual(inventoryAmountEvidence({records:0,knownRecords:0,total:0,complete:true}),{state:'complete',amount:0});
 assert.deepEqual(inventoryAmountEvidence({records:1,knownRecords:1,total:0,complete:true}),{state:'complete',amount:0});
 assert.deepEqual(inventoryAmountEvidence({records:6,knownRecords:2,total:120,complete:true}),{state:'partial',amount:120});
 const report=buildInventoryBrief({inventory:[stock({baseCost:undefined,purchaseCost:undefined})],transactions:[sale({netTotal:undefined})],stockLogs:[{id:'w',branch:'Maa',item:'Sauce',type:'Waste / Spoilage',variance:-2}],shifts:[{status:'Closed'}],period});
 assert.equal(report.validSalesCount,0);assert.equal(report.valuedStockCount,0);assert.equal(report.valuedWasteCount,0);assert.equal(report.knownShiftDifferenceCount,0);
});

function apiFixture(tables={}){
 const calls=[],api={db:{},auth:{currentUser:{uid:'u'}},sessionUser:{uid:'u',email:'owner@example.test',allowedBranches:['All'],permissions:['inventory']},
  collection:(_,table)=>({table}),where:(field,op,value)=>({kind:'where',field,op,value}),orderBy:(field,direction)=>({kind:'order',field,direction}),limit:value=>({kind:'limit',value}),query:(ref,...filters)=>({...ref,filters})};
 api.getDocsFromServer=async query=>{
  calls.push(query);let values=(tables[query.table]||[]).map(row=>structuredClone(row));
  for(const filter of query.filters||[])if(filter.kind==='where')values=values.filter(row=>filter.op==='=='?row[filter.field]===filter.value:filter.op==='>='?+new Date(row[filter.field])>=+filter.value:+new Date(row[filter.field])<+filter.value);
  const ordered=query.filters?.find(filter=>filter.kind==='order');if(ordered)values.sort((a,b)=>+new Date(b[ordered.field])-+new Date(a[ordered.field]));
  values=values.slice(0,query.filters?.find(filter=>filter.kind==='limit')?.value??values.length);
  return {docs:values.map((row,index)=>({id:row.id||String(index),data:()=>row}))};
 };
 return {api,calls,tables};
}
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

test('reader uses capped branch/date queries, serial sources and no editable BOM scan',async()=>{
 const f=apiFixture({inventory:[stock()],transactions:[sale()],stock_logs:[],inventory_logs:[],shifts:[]}),reader=createInventoryIntelligenceReader();
 const report=await reader.report(f.api,{branch:'Maa',period});assert.equal(report.complete,true);assert.equal(f.calls.length,5);
 assert.ok(f.calls.every(query=>query.filters.some(filter=>filter.kind==='where'&&filter.field==='branch'&&filter.value==='Maa')&&query.filters.some(filter=>filter.kind==='limit')));
 for(const query of f.calls.filter(query=>query.table!=='inventory'))assert.ok(query.filters.some(filter=>filter.op==='>=')&&query.filters.some(filter=>filter.op==='<'));
 assert.equal(f.calls.some(query=>query.table==='bom'),false);
});
test('simultaneous reports share source reads and recent cached rows until an explicit refresh',async()=>{
 const f=apiFixture({inventory:[stock()]}),reader=createInventoryIntelligenceReader();
 const [a,b]=await Promise.all([reader.read(f.api,{table:'inventory',branch:'Maa',period}),reader.read(f.api,{table:'inventory',branch:'Maa',period})]);assert.equal(f.calls.length,1);assert.equal(a,b);
 await reader.read(f.api,{table:'inventory',branch:'Maa',period:inventoryAnalysisPeriod('2026-10-02','2026-10-03')});assert.equal(f.calls.length,1,'undated stock shares the same snapshot across date ranges');
 await reader.read(f.api,{table:'inventory',branch:'Maa',period,force:true});assert.equal(f.calls.length,2);
});
test('quota and permission errors stop the queue without fallback queries or automatic retries',async()=>{
 for(const code of ['resource-exhausted','permission-denied']){
  const f=apiFixture(),reader=createInventoryIntelligenceReader();let calls=0;f.api.getDocsFromServer=async()=>{calls++;throw Object.assign(Error(code),{code});};
  const report=await reader.report(f.api,{branch:'Maa',period});assert.equal(calls,1);assert.equal(report.complete,false);assert.ok(report.stopped);assert.equal(report.coverage.filter(source=>source.error).length,5);
  await reader.report(f.api,{branch:'Maa',period});assert.equal(calls,1,'navigation reuses the recent error rather than hammering quota');
 }
});
test('missing index fallback stays dated and capped, counts all-scope reads, and is always partial',async()=>{
 const f=apiFixture(),reader=createInventoryIntelligenceReader();let calls=0;
 f.api.getDocsFromServer=async query=>{f.calls.push(query);if(++calls===1)throw Object.assign(Error('An index is required'),{code:'failed-precondition'});return {docs:[sale(),sale({id:'other',branch:'Agdao'}),sale({id:'old',timestamp:new Date('2020-01-01')})].map(row=>({id:row.id,data:()=>row}))};};
 const result=await reader.read(f.api,{table:'transactions',branch:'Maa',period,cap:5});assert.equal(calls,2);assert.equal(result.partial,true);assert.equal(result.complete,false);assert.equal(result.readCount,3);assert.equal(result.rows.length,1);
 const fallback=f.calls[1];assert.equal(fallback.filters.some(filter=>filter.field==='branch'),false);assert.ok(fallback.filters.some(filter=>filter.op==='>=')&&fallback.filters.some(filter=>filter.op==='<')&&fallback.filters.some(filter=>filter.kind==='limit'&&filter.value===5));
});
test('hitting a per-source cap and report budget cannot masquerade as complete coverage',async()=>{
 const f=apiFixture({inventory:[stock(),stock({id:'two',name:'Other'})],transactions:[sale()]}),reader=createInventoryIntelligenceReader({maxReportReads:3});
 const report=await reader.report(f.api,{branch:'Maa',period});assert.equal(report.readCount,3);assert.equal(report.complete,false);assert.equal(f.calls.length,2);assert.equal(report.coverage.find(source=>source.table==='stock_logs').error,'budget');
});
test('UI timeout retains the underlying server flight so manual retry cannot pile up SDK reads',async()=>{
 const f=apiFixture(),pending=deferred(),reader=createInventoryIntelligenceReader({timeoutMs:5});let calls=0;
 f.api.getDocsFromServer=async()=>{calls++;return pending.promise;};
 await assert.rejects(reader.read(f.api,{table:'inventory',branch:'Maa',period}),error=>error.code==='timeout');
 await assert.rejects(reader.read(f.api,{table:'inventory',branch:'Maa',period,force:true}),error=>error.code==='pending');assert.equal(calls,1);
 pending.resolve({docs:[]});await new Promise(resolve=>setImmediate(resolve));
 await reader.read(f.api,{table:'inventory',branch:'Maa',period,force:true});assert.equal(calls,2);
});
test('an invalidated in-flight read is withheld and cannot be reused as a post-write snapshot',async()=>{
 const f=apiFixture(),pending=deferred(),reader=createInventoryIntelligenceReader();let calls=0;f.api.getDocsFromServer=async()=>{calls++;return pending.promise;};
 const initial=reader.read(f.api,{table:'inventory',branch:'Maa',period});await Promise.resolve();await Promise.resolve();reader.invalidate();
 await assert.rejects(reader.read(f.api,{table:'inventory',branch:'Maa',period,force:true}),error=>error.code==='pending');assert.equal(calls,1);
 pending.resolve({docs:[]});await assert.rejects(initial,error=>error.code==='stale');
});
test('saved scope and account changes prevent cross-branch reads and late private results',async()=>{
 const f=apiFixture(),reader=createInventoryIntelligenceReader(),pending=deferred();f.api.sessionUser.email='manager@example.test';f.api.sessionUser.allowedBranches=['Maa'];
 await assert.rejects(reader.read(f.api,{table:'inventory',branch:'Agdao',period}),error=>error.code==='permission');assert.equal(f.calls.length,0);
 f.api.getDocsFromServer=()=>pending.promise;const request=reader.read(f.api,{table:'inventory',branch:'Maa',period});f.api.sessionUser.allowedBranches=['Agdao'];pending.resolve({docs:[]});await assert.rejects(request,error=>error.code==='stale');
});
