import {OWNER_EMAIL,canOpenInventoryTab,canOpenWorkspacePage} from './workspace-access-model.js';
import {timestampLabel,phDay} from './operations-model.js';
import {buildInventoryBrief,buildInventoryForecast,inventoryAnalysisPeriod,defaultInventoryAnalysisPeriod,inventoryQuantityLabel,inventoryAmountEvidence} from './inventory-intelligence-model.js';
import {createInventoryIntelligenceReader} from './inventory-intelligence-reader.js';

const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const SOURCE_NAMES={inventory:'Stock records',transactions:'Receipts',stock_logs:'Stock movements',inventory_logs:'Legacy movements',shifts:'Shifts'};
export function installInventoryIntelligence(w=window,d=document){
 if(!d.getElementById('inventoryIntelligenceStyle')){const link=d.createElement('link');link.id='inventoryIntelligenceStyle';link.rel='stylesheet';link.href='./inventory-intelligence.css';d.head.append(link);}
 if(w.inventoryIntelligenceInstalled)return w.inventoryIntelligenceInstalled;
 const reader=createInventoryIntelligenceReader(),panels={},el=id=>d.getElementById(id),identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.sessionUser?.uid,w.sessionUser?.email,w.sessionUser?.permissions,w.sessionUser?.allowedBranches]);
 const allowed=branch=>!!w.sessionUser&&(w.sessionUser.email?.toLowerCase()===OWNER_EMAIL||w.sessionUser.allowedBranches?.some(value=>value==='All'||value===branch));
 const permitted=kind=>!!w.auth?.currentUser?.uid&&!!w.sessionUser&&(!w.sessionUser.uid||w.sessionUser.uid===w.auth.currentUser.uid)
  &&(canOpenInventoryTab(w.sessionUser,kind==='brief'?'AIBrief':kind==='forecast'?'Forecaster':'Alerts')||kind==='alerts'&&canOpenWorkspacePage(w.sessionUser,'purchases'));
 const create=(tag,content='',className='')=>{const node=d.createElement(tag);if(content!=='')node.textContent=String(content);if(className)node.className=className;return node;};
 const button=(label,handler,secondary=false)=>{const node=create('button',label,'inventory-workspace-button'+(secondary?' inventory-workspace-button-secondary':''));node.type='button';node.addEventListener('click',handler);return node;};
 const field=(label,node)=>{const wrapper=create('label','','inventory-workspace-field');wrapper.append(create('span',label),node);return wrapper;};
 const input=(id,type,value='')=>{const node=create('input');node.id=id;node.type=type;node.value=value;return node;};
 const status=(panel,message,error=false)=>{panel.status.textContent=message;panel.status.className='inventory-workspace-status'+(error?' inventory-workspace-status-error':'');};
 const empty=(panel,message)=>panel.results.replaceChildren(create('p',message,'inventory-workspace-empty'));
 const options=(select,values,all=false)=>{const current=select.value,nodes=[];if(all){const option=create('option','All permitted branches');option.value='All Branches';nodes.push(option);}for(const value of values){const option=create('option',value);option.value=value;nodes.push(option);}select.replaceChildren(...nodes);select.value=values.includes(current)||all&&current==='All Branches'?current:all?'All Branches':values[0]||'';};
 const metric=(label,value,note='')=>{const node=create('article','','inventory-workspace-kpi');node.append(create('span',label),create('strong',value));if(note)node.append(create('small',note));return node;};
 const currentReport=panel=>!panel.loading&&!!panel.model&&!!panel.report&&permitted(panel.kind)&&panel.reportIdentity===identity()
  &&panel.report.branch===panel.branch.value&&(panel.kind==='alerts'||panel.report.period.from===panel.from.value&&panel.report.period.to===panel.to.value);
 const holdStaleReport=panel=>{if(panel.kind==='forecast'){w.globalForecasterData=[];panel.generate.disabled=true;}if(!panel.loading){empty(panel,'The selection or account changed. Refresh this report before using its results.');status(panel,'Refresh to load evidence for the current selection.');}};
 const coverage=(report)=>{const details=create('details','','inventory-intelligence-coverage');details.append(create('summary',report.complete?'Data coverage · bounded sources complete':'Data coverage · partial or unavailable'));const list=create('ul');for(const source of report.coverage){const state=source.error?source.message:source.partial?source.basis+' · '+source.readCount+' records read, limit '+source.limit+'; totals may be incomplete':source.readCount+' records · complete within query limits';list.append(create('li',(SOURCE_NAMES[source.table]||source.table)+(source.branch?' · '+source.branch:'')+': '+state));}details.append(list,create('p','Loaded '+timestampLabel(report.loadedAt)+'. A limit reached or shared dated sample is never treated as a complete forecast.'));return details;};
 const card=(row,forecast)=>{
  const node=create('article','','inventory-workspace-card inventory-intelligence-item');node.append(create('h3',row.name),create('small',row.branch+' · '+row.category));
  const pairs=create('dl'),pair=(label,value)=>pairs.append(create('dt',label),create('dd',value));
  pair('Current stock',inventoryQuantityLabel(row.stock,row));pair('Maintaining target',row.maintainingStock===null?'Not configured':inventoryQuantityLabel(row.maintainingStock,row));
  pair('Needed to target',row.blockedReason?'Held for review':row.targetGap===null?'Set a maintaining target':inventoryQuantityLabel(row.targetGap,row));
  if(forecast){pair('Recorded use in period',inventoryQuantityLabel(row.recordedUse,row));pair('Daily use estimate',row.dailyUse===null?'Not available':inventoryQuantityLabel(row.dailyUse,row)+' / day');pair('Run-out estimate',row.predictionLabel);}
  else pair('Low-stock alert',row.threshold===null?'Not configured':inventoryQuantityLabel(row.threshold,row));
  node.append(pairs,create('p',row.blockedReason||(forecast?row.predictionLabel:row.targetGap>0?'Below maintaining target':row.status),row.blockedReason?'inventory-workspace-status inventory-workspace-status-error':'inventory-workspace-status'));
  if(canOpenInventoryTab(w.sessionUser,'Overview'))node.append(button('Review item',()=>{if(permitted(forecast?'forecast':'alerts')&&allowed(row.branch))w.openEditInvModal?.(row.id);},true));
  if(!forecast&&!row.blockedReason&&row.branch==='Main Office')node.append(button('Restock HQ item',()=>{if(permitted('alerts')&&allowed(row.branch))w.openMultiRestockModal?.(row.id);},true));
  return node;
 };
 const filters=panel=>{const search=panel.search?.value.trim().toLowerCase()||'',category=panel.category?.value||'All';return panel.model.rows.filter(row=>(!search||row.name.toLowerCase().includes(search))&&(category==='All'||row.category===category));};
 function drawForecast(panel){
  if(!currentReport(panel)){holdStaleReport(panel);return;}panel.results.replaceChildren();
  const report=panel.report,rows=filters(panel),summary=create('div','','inventory-workspace-kpis');summary.append(metric('Stock records',panel.model.rows.length),metric('Held for review',panel.model.blockedCount),metric('Usage coverage',panel.model.usage.complete?'Available':'Incomplete',report.period.from+' to '+report.period.to+' · PH calendar dates'));panel.results.append(summary);
  if(!report.complete)panel.results.append(create('p','This is a partial scan. Run-out predictions and stock-request generation are unavailable. Narrow the period or resolve the source error, then retry.','inventory-workspace-status inventory-workspace-status-error'));
  if(panel.model.usage.legacyReceipts||panel.model.usage.reviewReceipts)panel.results.append(create('p',panel.model.usage.legacyReceipts+' receipts have no saved ingredient movements; '+panel.model.usage.reviewReceipts+' receipts need stock review. Today’s recipes are not used to reconstruct them.','inventory-workspace-status'));
  const list=create('div','','inventory-intelligence-cards');for(const row of rows)list.append(card(row,true));if(!rows.length)list.append(create('p','No stock records match these filters.','inventory-workspace-empty'));panel.results.append(list,coverage(report));
  panel.generate.disabled=!!panel.actionBusy||!report.complete||!panel.model.rows.some(row=>row.actionable);
  // Compatibility data contains only trustworthy rows. Legacy request logic
  // remains an explicit user action and cannot include a negative audit deficit.
  w.globalForecasterData=panel.model.rows.filter(row=>row.actionable).map(row=>({...row,currentStock:row.stock,conversionRate:row.conversion,conversion:row.conversion,dailyBurn:row.dailyUse||0,maintainingStock:row.maintainingStock||0}));
 }
 function drawBrief(panel){
  if(!currentReport(panel)){holdStaleReport(panel);return;}
  const report=panel.report,model=panel.model;panel.results.replaceChildren();const summary=create('div','','inventory-workspace-kpis');
  const completeSource=table=>report.coverage.some(source=>source.table===table&&source.complete===true);
  const sales=inventoryAmountEvidence({records:model.salesCount,knownRecords:model.validSalesCount,total:model.salesTotal,complete:completeSource('transactions')});
  const waste=inventoryAmountEvidence({records:model.waste.length,knownRecords:model.valuedWasteCount,total:model.wasteTotal,complete:completeSource('stock_logs')&&completeSource('inventory_logs')});
  const value=inventoryAmountEvidence({records:model.stockRecordsCount,knownRecords:model.valuedStockCount,total:model.assetValue,complete:completeSource('inventory')});
  const shortages=inventoryAmountEvidence({records:model.closedShifts,knownRecords:model.knownShiftDifferenceCount,total:model.cashShortage,complete:completeSource('shifts')});
  const shown=(evidence,missing)=>evidence.state==='not-recorded'?missing:evidence.amount===null?'Unavailable':money(evidence.amount),known=(evidence,label)=>evidence.state==='partial'?'Known '+label.toLowerCase():label;
  summary.append(metric(known(sales,'Recorded sales'),shown(sales,'Amount not recorded'),model.salesCount+' receipts · '+model.unvaluedSales+' missing amounts'),metric(known(waste,'Waste value'),shown(waste,'Cost not recorded'),model.unknownWasteCosts+' missing costs; '+model.estimatedWasteRows+' current-cost estimates'),metric(known(value,'Stock value'),shown(value,'Cost not recorded'),(model.stockRecordsCount-model.valuedStockCount)+' records excluded from valuation'),metric(known(shortages,'Cash shortages'),shown(shortages,'Difference not recorded'),model.closedShifts+' closed shifts; '+model.unknownShiftDifferences+' missing differences'));
  panel.results.append(summary);
  if(!report.complete)panel.results.append(create('p','Partial evidence: these are known returned records, not complete branch totals. Missing sources are listed below.','inventory-workspace-status inventory-workspace-status-error'));
  const observations=create('section','','inventory-workspace-card');observations.append(create('h3','What the records show'));const list=create('ul');for(const value of model.observations)list.append(create('li',value));observations.append(list);
  if(model.largest)observations.append(create('p','Largest recorded stock holding: '+model.largest.name+' · '+money(model.largest.value)+'. Value alone does not establish slow turnover or cash-flow risk.'));
  observations.append(create('p','Audit differences are review evidence. This report does not assign fault or apply deductions.','inventory-workspace-help'));panel.results.append(observations,coverage(report));
 }
 function drawAlerts(panel){
  if(!currentReport(panel)){holdStaleReport(panel);return;}
  const report=panel.report;panel.results.replaceChildren();const rows=filters(panel).filter(row=>row.blockedReason||row.stock===0||row.threshold!==null&&row.stock<=row.threshold||row.targetGap!==null&&row.targetGap>0);
  const summary=create('div','','inventory-workspace-kpis');summary.append(metric('Records needing attention',rows.length),metric('Audit or settings review',rows.filter(row=>row.blockedReason).length),metric('Scope',panel.branch.value==='All Branches'?'All permitted branches':panel.branch.value));panel.results.append(summary);
  if(!report.complete)panel.results.append(create('p','Partial stock coverage. More alerts may exist; select one branch or refresh after resolving the read limit.','inventory-workspace-status inventory-workspace-status-error'));
  const list=create('div','','inventory-intelligence-cards');for(const row of rows)list.append(card(row,false));if(!rows.length)list.append(create('p',report.complete?'No low-stock or maintaining-target alerts in the loaded records.':'No alerts in this partial sample. This does not establish that all stock levels are sufficient.','inventory-workspace-empty'));panel.results.append(list,coverage(report));
 }
 async function run(kind,{force=false}={}){
  const panel=panels[kind];if(!panel)return;const token=++panel.revision,user=identity();
  panel.loading=true;panel.model=null;panel.report=null;panel.reportIdentity=null;
  if(kind==='forecast'){w.globalForecasterData=[];panel.generate.disabled=true;}
  if(!permitted(kind)){panel.loading=false;panel.run.disabled=false;if(kind==='forecast')w.isForecasterLoading=false;empty(panel,'This inventory report is outside your saved access.');status(panel,'This report is outside your saved access.',true);return;}
  panel.run.disabled=true;status(panel,'Loading a bounded stock report…');empty(panel,'Loading…');if(kind==='forecast'){w.globalForecasterData=[];w.isForecasterLoading=true;panel.generate.disabled=true;}
  try{
   const period=kind==='alerts'?defaultInventoryAnalysisPeriod():inventoryAnalysisPeriod(panel.from.value,panel.to.value);
   const directory=await reader.read(w,{table:'branches',branch:'Directory',force});
   if(token!==panel.revision||user!==identity())return;
   const branches=[...new Set(directory.rows.map(row=>row.name).filter(name=>name&&allowed(name)))].sort((a,b)=>a==='Main Office'?-1:b==='Main Office'?1:a.localeCompare(b));
   options(panel.branch,branches,kind==='alerts');if(!branches.length)throw Error('No permitted branches are available.');
   const branch=panel.branch.value,selection=JSON.stringify([branch,panel.from?.value,panel.to?.value]);let report;
   if(kind==='alerts'&&branch==='All Branches'){
    const data=[],sources=[];let remaining=1000,stop=false;
    for(const name of branches.slice(0,8)){
     if(stop||remaining<1){sources.push({table:'inventory',branch:name,complete:false,error:'budget',message:'Not read after the scan stopped.'});continue;}
     try{const source=await reader.read(w,{table:'inventory',branch:name,cap:Math.min(400,remaining),force});remaining-=source.readCount;data.push(...source.rows);sources.push({...source,rows:undefined});}
     catch(error){sources.push({table:'inventory',branch:name,complete:false,error:error.code,message:error.message});stop=true;}
    }
    if(branches.length>8)sources.push({table:'inventory',complete:false,error:'scope-limit',message:'Choose one branch to inspect branches beyond the first eight.'});
    report={branch,period,data:{inventory:data},coverage:sources,complete:directory.complete&&sources.every(source=>source.complete),loadedAt:Date.now()};
   }else report=await reader.report(w,{branch,period,kind,force});
   if(token!==panel.revision||user!==identity()||selection!==JSON.stringify([panel.branch.value,panel.from?.value,panel.to?.value])||!permitted(kind))return;
   if(!directory.complete){report.complete=false;report.coverage.unshift({table:'branches',complete:false,error:'partial-directory',message:'Branch directory reached its read limit.'});}
   panel.report=report;panel.reportIdentity=user;const values={inventory:report.data.inventory||[],transactions:report.data.transactions||[],stockLogs:report.data.stock_logs||[],inventoryLogs:report.data.inventory_logs||[],shifts:report.data.shifts||[],period,complete:report.complete};
   panel.model=kind==='brief'?buildInventoryBrief(values):buildInventoryForecast(values);
   panel.loading=false;
   if(panel.category){const categories=[...new Set(panel.model.rows.map(row=>row.category))].sort(),current=panel.category.value;options(panel.category,categories);const all=create('option','All categories');all.value='All';panel.category.prepend(all);panel.category.value=categories.includes(current)?current:'All';}
   if(kind==='brief')drawBrief(panel);else if(kind==='forecast')drawForecast(panel);else{w.globalInventoryList=values.inventory;drawAlerts(panel);}
   status(panel,(report.complete?'Report ready':'Partial report')+' · '+timestampLabel(report.loadedAt)+'. Refresh is manual; reopening shares recent results.');
  }catch(error){if(token!==panel.revision||user!==identity())return;panel.model=null;panel.report=null;empty(panel,error.message||'The report could not load.');status(panel,'Scan stopped. Use Retry / refresh when ready.',true);if(kind==='forecast')w.globalForecasterData=[];}
  finally{if(token===panel.revision){panel.loading=false;panel.run.disabled=false;if(kind==='forecast')w.isForecasterLoading=false;}}
 }
 function mount(kind,id,title,branchId){
  const matching=[...d.querySelectorAll('#'+id)],section=matching.shift();if(!section)return;for(const extra of matching)extra.remove();
  const display=section.style.display;section.removeAttribute('style');section.style.display=display||'none';section.className='inventory-workspace-panel inventory-intelligence';section.replaceChildren();
  const heading=create('header','','inventory-workspace-header');heading.append(create('h2',title),create('p',kind==='brief'?'Evidence from your saved sales, waste and audit records. No external AI service.':kind==='forecast'?'Review saved targets and recorded use before creating a stock request.':'Current counts, saved maintaining targets and audit exceptions.'));
  const controls=create('div','','inventory-workspace-controls'),branch=create('select');branch.id=branchId;const fallback=[...new Set([...(w.globalActiveBranches||[]),...(w.sessionUser?.allowedBranches||[])].filter(name=>name&&name!=='All'&&allowed(name)))];options(branch,fallback,kind==='alerts');controls.append(field('Branch',branch));
  const panel={kind,section,branch,revision:0,loading:false,model:null,report:null,reportIdentity:null};
  if(kind!=='alerts'){const period=defaultInventoryAnalysisPeriod();panel.from=input('inventory'+kind+'From','date',period.from);panel.to=input('inventory'+kind+'To','date',period.to);controls.append(field('From · PH',panel.from),field('To · PH',panel.to));panel.from.addEventListener('change',()=>run(kind));panel.to.addEventListener('change',()=>run(kind));}
  panel.run=button('Retry / refresh',()=>run(kind,{force:true}));controls.append(panel.run);branch.addEventListener('change',()=>run(kind));
  panel.status=create('p','','inventory-workspace-status');panel.status.setAttribute('role','status');panel.status.setAttribute('aria-live','polite');panel.results=create('div','','inventory-intelligence-results');section.append(heading,controls,panel.status);
  if(kind!=='brief'){
   const search=create('div','','inventory-workspace-controls');panel.search=input(kind==='forecast'?'fcSearch':'alertSearchInput','search');panel.search.placeholder='Search item';panel.category=create('select');panel.category.id=kind==='forecast'?'fcCategory':'intelligenceAlertCategory';options(panel.category,[]);search.append(field('Search item',panel.search),field('Category',panel.category));
   const filter=()=>{if(!panel.loading&&panel.model)kind==='forecast'?drawForecast(panel):drawAlerts(panel);};panel.search.addEventListener('input',filter);panel.category.addEventListener('change',filter);section.append(search);
  }
  if(kind==='forecast'){
   const actions=create('details','','inventory-workspace-card');actions.append(create('summary','Plan a delivery request'));
   const fields=create('div','','inventory-workspace-controls'),target=input('fcTargetDate','date',phDay(Date.now()+86400000)),buffer=input('fcBuffer','number','2');buffer.min='0';buffer.max='31';fields.append(field('Next delivery date',target),field('Buffer days',buffer));
   panel.generate=button('Create stock request',async()=>{if(panel.actionBusy||!currentReport(panel)||!panel.report.complete)return;const days=(Date.parse(target.value+'T00:00:00+08:00')-Date.parse(phDay()+'T00:00:00+08:00'))/86400000,bufferDays=Number(buffer.value);if(!Number.isInteger(days)||days<0||days>31||!Number.isInteger(bufferDays)||bufferDays<0||bufferDays>31){status(panel,'Choose a delivery date within the next 31 days and buffer days from 0 to 31.',true);return;}drawForecast(panel);if(panel.generate.disabled)return;panel.actionBusy=true;panel.generate.disabled=true;try{await w.generateAiDispatchList?.();}catch(error){status(panel,error.message,true);}finally{panel.actionBusy=false;panel.generate.disabled=!currentReport(panel)||!panel.model.rows.some(row=>row.actionable);}});panel.generate.disabled=true;
   const mayBroadcast=()=>w.sessionUser?.email?.toLowerCase()===OWNER_EMAIL||w.sessionUser?.allowedBranches?.includes('All');
   const alert=button('Alert all branches',()=>{if(permitted('forecast')&&mayBroadcast())w.broadcastDeliveryDate?.();},true);alert.id='btnBroadcastDate';alert.disabled=!mayBroadcast();fields.append(panel.generate,alert);actions.append(fields,create('p','Stock requests use the selected branch. The delivery-date alert updates the existing schedule for all branches. Review the date first.','inventory-workspace-help'));section.append(actions);
  }
  section.append(panel.results);panels[kind]=panel;
 }
 mount('brief','invSectionAIBrief','Chief Executive Brief','aiBranchSelect');
 mount('forecast','invSectionForecaster','Stock Forecaster','forecasterBranchSelect');
 mount('alerts','invSectionAlerts','Low Stock Alerts','branchAlertFilter');
 const invalidate=w.invalidateCache;if(typeof invalidate==='function')w.invalidateCache=function(table,...args){if(['inventory','branches','transactions','stock_logs','inventory_logs','shifts'].includes(table)){reader.invalidate();for(const panel of Object.values(panels)){++panel.revision;panel.loading=false;panel.model=null;panel.report=null;panel.reportIdentity=null;panel.run.disabled=false;if(panel.generate)panel.generate.disabled=true;empty(panel,'Records changed. Refresh to load the latest evidence.');status(panel,'Records changed. Refresh this report to load the latest evidence.');}w.globalForecasterData=[];w.isForecasterLoading=false;}return invalidate.call(this,table,...args);};
 w.generateAIReport=options=>run('brief',{force:options?.refresh===true});w.loadForecasterEngine=options=>run('forecast',{force:options?.refresh===true});
 w.loadPurchasesAndAlerts=options=>{
  // The old purchases route has no standalone view in this Owner entry file.
  // Keep its explicit loader useful without changing unrelated active tabs.
  const current=d.querySelector('.view.active');
  if(permitted('alerts')&&panels.alerts&&(!current||current.id==='view-purchases')){
   d.querySelectorAll('.view').forEach(view=>view.classList.remove('active'));el('view-inventory')?.classList.add('active');
   for(const id of ['invTabLiveContent','invSectionAudits','invSectionWaste','invSectionPrepLogs','invTabLogsContent','invSectionForecaster','invSectionAIBrief','invSectionYield','invSectionInvoices'])if(el(id))el(id).style.display='none';
   panels.alerts.section.style.display='block';w.activeInvTab='Alerts';
  }
  return run('alerts',{force:options?.refresh===true});
 };w.loadAlerts=w.loadPurchasesAndAlerts;
 w.filterForecaster=()=>{if(panels.forecast?.model&&!panels.forecast.loading)drawForecast(panels.forecast);};w.filterAlertsTable=()=>{if(panels.alerts?.model&&!panels.alerts.loading)drawAlerts(panels.alerts);};
 return w.inventoryIntelligenceInstalled={reader,panels,run};
}
