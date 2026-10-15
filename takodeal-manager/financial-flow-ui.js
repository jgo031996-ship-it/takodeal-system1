import {financialPeriod,buildFinancialReport,mentorFindings,cash,esc,finite} from './financial-flow-model.js';
import {canOpenWorkspacePage} from './workspace-access-model.js';
import {collectDispatchRestockEstimates,renderDispatchRestockEstimates} from './dispatch-restock-finance.js';
const percent=n=>n===null?'—':n.toFixed(1)+'%';
const rows=snapshot=>snapshot.docs?snapshot.docs.map(r=>({...r.data(),id:r.id})):(()=>{const result=[];snapshot.forEach(r=>result.push({...r.data(),id:r.id}));return result;})();
const sorted=values=>[...values].sort((a,b)=>Number(b.timestamp?.toMillis?.()||new Date(b.timestamp))-Number(a.timestamp?.toMillis?.()||new Date(a.timestamp)));
const routes={menu:'Review recipes',expenses:'Review payments',accounts:'Review bills & budgets',transfers:'Review HQ transfers',history:'Review sales',payroll:'Review payroll'};
// Keep only one authorized period in tab memory. Filters can reuse the same
// snapshots; retries join an unfinished read instead of downloading it again.
export function createFinancialPeriodReader({now=Date.now,ttl=60000}={}){
 let entry=null;
 return (key,read,refresh=false)=>{
  if(entry?.key===key){
   if(entry.pending)return entry.pending;
   if(!refresh&&entry.data&&now()-entry.at<ttl)return Promise.resolve({data:entry.data,loadedAt:entry.at});
  }
  const next={key,data:null,at:0,pending:null};entry=next;
  next.pending=Promise.resolve().then(read).then(data=>{next.data=data;next.at=now();return {data,loadedAt:next.at};}).catch(error=>{if(entry===next)entry=null;throw error;}).finally(()=>{next.pending=null;});
  return next.pending;
 };
}
export function renderFinancialReview(r){
 const action=(label,group)=>`<button type="button" data-financial-trace="${esc(group)}">${label} →</button>`;
 const metric=(label,value,detail,group)=>`<article class="finance-metric"><span>${label}</span><strong>${cash(value)}</strong><small>${detail}</small>${group?action('View records',group):''}</article>`;
 return `<section class="financial-review" aria-label="Financial report"><header class="finance-heading"><div><span class="finance-eyebrow">${esc(r.branch==='All'?'All accessible branches':r.branch)} · ${esc(r.period.label)}</span><h2>Recorded sales and costs</h2><p>${r.period.active?'Period in progress · ':r.period.future?'Future period · ':''}${esc(r.period.dateBasis)}</p></div><button type="button" data-financial-refresh>Refresh report ↻</button></header>
 <div class="finance-sales"><span>Recorded net sales</span><strong>${cash(r.revenue)}</strong><p>${r.orders.toLocaleString()} paid orders · Average order ${r.average===null?'—':cash(r.average)}</p><small>Receipt sales are not proof of bank settlement. Unrecorded platform fees and other costs are not included.</small></div>
 <div class="finance-metrics">${metric('Estimated recipe usage',r.cogs,`${r.costs.complete} of ${r.costs.lines} item lines fully costed · current recipes / prices`,'cogs')}${metric('Payroll cash paid',r.paidPayroll,'Recorded net payments; not total earned labor cost','payroll')}${metric('Operating cash costs',r.operating,'Includes unclassified payments pending review','operating')}</div>
 <div class="finance-result ${r.result<0?'finance-negative':''}"><div><span>Result estimate after known costs</span><strong>${cash(r.result)}</strong><small>${r.partial?'Review required · source records or costs are incomplete':'Based on current recipe estimates and recorded payments'} · This is not available cash or a finalized P&L.</small></div><div><b>${percent(r.margin)}</b><small>Estimated margin</small></div></div>
 <details class="finance-basis"><summary>How this result is calculated</summary><p>Recorded net sales ${cash(r.revenue)} − current recipe estimate ${cash(r.cogs)} − payroll cash paid ${cash(r.paidPayroll)} − operating cash costs ${cash(r.operating)} = ${cash(r.result)}.</p><p>Income and payment dates can differ. Historical recipe costs, earned but unpaid salaries, taxes, platform settlement charges and unrecorded bills may be missing. Prepared cancellations keep their ingredient estimate; a linked staff purchase does not count those ingredients again.</p></details>
 <div class="finance-metrics finance-separate">${metric('Internal cash transfers',r.transfers,'Excluded from operating costs; funds move between locations','transfer')}${metric('Matched ingredient purchases',r.purchases,'Purchase cash shown separately; recipe usage counted once','purchase')}${metric('Unpaid scheduled bills',r.unpaidBillAmount,`${r.unpaidBills.length} unpaid bills · ${r.overdueBills.length} overdue`,null)}</div>
 ${r.royalties?`<div class="finance-notice">Royalty payments: ${cash(r.royalties)}. Kept separate using the previous report treatment; review how they belong in the reporting business. ${action('View royalty records','royalty')}</div>`:''}
 <section class="finance-comparison"><h3>Recorded sales comparison</h3><div><span>${esc(r.period.comparisonLabel)}</span><strong>${cash(r.priorRevenue)}</strong><span>${r.priorOrders} paid orders</span><b>${r.revenueChange===null?'No percentage comparison':(r.revenueChange>=0?'+':'')+r.revenueChange.toFixed(1)+'%'}</b></div><p>Current period: ${r.period.start.toLocaleDateString('en-PH',{timeZone:'Asia/Manila'})} to ${r.period.through.toLocaleDateString('en-PH',{timeZone:'Asia/Manila'})}. Comparison ends ${r.period.priorThrough.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}. No forecast is implied.</p></section>
 <h3>Operating cost breakdown</h3><div class="finance-categories">${Object.entries(r.breakdown).sort((a,b)=>b[1]-a[1]).map(([category,amount])=>`<button type="button" data-financial-category="${esc(category)}"><span>${esc(category)}</span><strong>${cash(amount)}</strong><small>View records →</small></button>`).join('')||'<p>No operating payments in this period.</p>'}</div>
 <p class="finance-footer">Updated ${r.period.asOf.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})} · Recipes and unit costs are current reference data, not historical cost snapshots.</p></section>`;
}
export function renderMentor(r,targets={},allowed=()=>true){
 const findings=mentorFindings(r,targets),cards=findings.map(f=>`<article class="finance-finding finance-${f.priority}"><span>${f.priority==='review'?'REVIEW REQUIRED':f.priority==='plan'?'PLAN NEXT':'RECORD CHECK'}</span><h4>${esc(f.title)}</h4><p>${esc(f.evidence)}</p><p class="finance-action">${esc(f.action)}</p>${f.route&&allowed(f.route)?`<button type="button" data-financial-route="${f.route}">${routes[f.route]} →</button>`:''}</article>`);
 return `<section class="financial-mentor"><div class="finance-mentor-intro"><span class="finance-eyebrow">FACTS → DATA CHECKS → NEXT ACTIONS</span><h3>${r.partial?'Review the source records before relying on the result':'Review the estimate and upcoming obligations'}</h3><p>Calculated analysis from your saved records. No external AI connection and no automatic financial actions.</p></div><div class="finance-findings">${cards.slice(0,6).join('')||'<p>No additional findings for these records.</p>'}</div>${cards.length>6?`<details><summary>${cards.length-6} more findings</summary><div class="finance-findings">${cards.slice(6).join('')}</div></details>`:''}
 <details class="finance-targets"><summary>Your planning targets (optional)</summary><p>Use your own targets. A percentage alone does not establish waste, excess staffing or the cause of a cost increase. Saved only in this browser for this signed-in account.</p><div>${[['food','Recipe cost %'],['payroll','Payroll paid %'],['operating','Operating cost %']].map(([id,label])=>`<label>${label}<input type="number" min="0" max="100" step="0.1" data-financial-target="${id}" value="${esc(targets[id]??'')}" placeholder="No target"></label>`).join('')}</div><p id="financialTargetStatus" role="status"></p></details></section>`;
}
export function createFinancialFlow(w=window,d=document){
 let revision=0,report=null,identity='',targets={};const periodReader=createFinancialPeriodReader(),el=id=>d.getElementById(id),allowed=b=>typeof w.isBranchAllowed==='function'?w.isBranchAllowed(b):!!w.sessionUser?.isOwner;
 const sessionKey=()=>JSON.stringify([w.auth?.currentUser?.uid,w.sessionUser?.email,w.sessionUser?.permissions,w.sessionUser?.allowedBranches,w.sessionUser?.isFranchisee]);
 const controlsKey=()=>JSON.stringify(['flowBranchFilter','flowTimeFilter','flowMonthPicker','flowYearPicker'].map(id=>el(id)?.value));
 const can=route=>canOpenWorkspacePage(w.sessionUser,route);
 const read=ref=>(w.getDocsFromServer||w.getDocs)(ref);
 const collection=name=>w.collection(w.db,name);
 const range=(name,start,end,branch)=>w.query(collection(name),...(w.sessionUser?.isFranchisee?[w.where('branch','==',branch)]:[]),w.where('timestamp','>=',start),w.where('timestamp','<',end));
 const targetKey=()=>`takodeal.finance-targets.v1/${w.auth?.currentUser?.uid||''}`;
 function readTargets(){const id=sessionKey();if(id===identity)return;identity=id;targets={};try{const data=JSON.parse(w.localStorage?.getItem(targetKey())||'{}');for(const k of ['food','payroll','operating'])if(finite(data[k])&&Number(data[k])>=0&&Number(data[k])<=100)targets[k]=Number(data[k]);}catch{}}
 function mentor(preserveInputs=false){
  if(!report)return;const container=el('financialAiMentorContent'),html=renderMentor(report,targets,can);
  const panel=preserveInputs?container.querySelector('.financial-mentor'):null,target=panel?.querySelector('.finance-targets');
  if(!target){container.innerHTML=html;return;}
  // Keep the actual inputs and their open panel in place while updating advice.
  // Replacing the inputs on change disrupted typing and keyboard navigation.
  const template=d.createElement('div');template.innerHTML=html;
  for(const child of [...panel.children])if(child!==target)child.remove();
  for(const child of [...template.firstElementChild.children])if(!child.matches('.finance-targets'))panel.insertBefore(child,target);
 }
 function charts(r){
  for(const name of ['flowSpendChartInstance','flowBudgetChartInstance']){w[name]?.destroy?.();w[name]=null;}
  if(typeof w.Chart!=='function')return;
  try{
   const parts=[['Recipe estimate',r.cogs],['Payroll paid',r.paidPayroll],...Object.entries(r.breakdown)].filter(([,value])=>value>0);
   w.flowSpendChartInstance=new w.Chart(el('flowSpendChart').getContext('2d'),{type:'doughnut',data:{labels:parts.map(p=>p[0]),datasets:[{data:parts.map(p=>p[1]),backgroundColor:['#17644f','#bd6b24','#829581','#aac2a7','#dfc8a7','#516975'],borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});
   const labels=[...new Set([...Object.keys(r.breakdown),...Object.keys(r.budgetLimits)])].filter(category=>!['cashremittance','royalty','dailyfranchiseroyalty','payroll'].includes(category.toLowerCase().replace(/[^a-z0-9]/g,'')));
   w.flowBudgetChartInstance=new w.Chart(el('flowBudgetChart').getContext('2d'),{type:'bar',data:{labels,datasets:[{label:'Operating cash paid',data:labels.map(c=>r.breakdown[c]||0),backgroundColor:'#17644f'},{label:r.period.type==='year'?'Monthly budget × 12':'Recorded monthly budget',data:labels.map(c=>r.budgetLimits[c]??null),backgroundColor:'#ddc6a3'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}}}});
  }catch(error){w.console?.warn?.('Financial charts unavailable',error);}
 }
 async function trace(group,category){
  if(!report||!can('financial-flow')||identity!==sessionKey())return;const captured=report;
  let title=category||({cogs:'Current recipe usage estimates',payroll:'Payroll cash paid',operating:'Operating cash costs',transfer:'Internal cash transfers',purchase:'Matched ingredient purchase payments',royalty:'Royalty payments · review'}[group]);
  const list=category?report.trace[category]||[]:report.groups[group]||[];
  let html;
  if(group==='cogs')html=`<p>Current recipes and unit costs; not historical cost snapshots. Known cost is shown for incomplete items.</p><div class="finance-trace-table"><table><thead><tr><th>Item</th><th>Qty</th><th>Estimate</th></tr></thead><tbody>${Object.entries(report.costs.breakdown).map(([name,row])=>`<tr><td>${esc(name)}</td><td>${row.qty}</td><td>${cash(row.cogs)}</td></tr>`).join('')}</tbody></table></div>${report.costs.issues.length?`<details><summary>${report.costs.issues.length} cost checks</summary>${report.costs.issues.slice(0,100).map(i=>`<p><strong>${esc(i.item)} · ${esc(i.branch)}</strong><br>${esc(i.problems.join('; '))}</p>`).join('')}</details>`:''}`;
  else html=`<p>${list.length} saved records · Total ${cash(list.reduce((n,r)=>n+Number(r.amount),0))}. Viewing does not change any record.</p><div class="finance-trace-table"><table><thead><tr><th>Details</th><th>Date / branch</th><th>Amount</th></tr></thead><tbody>${sorted(list).slice(0,200).map(row=>`<tr><td>${esc(row.description||row.note||row.category||'No description')}<small>${esc(row.classificationReason||'')}</small></td><td>${esc(row.timestamp?.toDate?row.timestamp.toDate().toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}):new Date(row.timestamp).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}))}<small>${esc(row.branch)} · ${esc(row.account||row.paidFrom||'Account not tagged')}</small></td><td>${cash(row.amount)}</td></tr>`).join('')}</tbody></table></div>${list.length>200?'<p>First 200 records shown. Review the full period in Expense & Restock Feed.</p>':''}`;
  if(captured!==report)return;
  await w.Swal.fire({title,html,width:900,showCloseButton:true,confirmButtonText:'Close',customClass:{popup:'finance-trace-popup'}});
 }
 async function load({refresh=false}={}){
  const container=el('financialFlowchartContainer'),mentorContent=el('financialAiMentorContent'),view=el('view-financial-flow');
  if(!container||!w.sessionUser||!w.auth?.currentUser?.uid||!can('financial-flow')){report=null;return;}
  const generation=++revision,account=sessionKey();readTargets();report=null;
  let branch=el('flowBranchFilter').value||'All';
  if(w.sessionUser.isFranchisee){const options=[...el('flowBranchFilter').options].map(o=>o.value).filter(allowed);branch=allowed(branch)?branch:options[0]||w.sessionUser.branch;if(!branch||branch==='All'||!allowed(branch)){container.textContent='Choose a branch within your access.';mentorContent.textContent='Analysis unavailable.';return;}el('flowBranchFilter').value=branch;}
  if(branch!=='All'&&!allowed(branch)){container.textContent='This branch is outside your access.';mentorContent.textContent='Analysis unavailable.';return;}
  if(!el('flowMonthPicker').value)el('flowMonthPicker').value=new Date(Date.now()+8*3600000).toISOString().slice(0,7);
  const controls=controlsKey(),current=()=>generation===revision&&account===sessionKey()&&controls===controlsKey()&&can('financial-flow')&&(!view?.classList||view.classList.contains('active'));
  container.innerHTML='<p role="status">Loading recorded sales, costs and comparison…</p>';mentorContent.textContent='Checking source records…';
  let period;
  try{
   period=financialPeriod({type:el('flowTimeFilter').value,month:el('flowMonthPicker').value,year:el('flowYearPicker').value});
   const reference=async name=>typeof w.fetchCachedCollection==='function'?w.fetchCachedCollection(name):rows(await read(collection(name)));
   const key=JSON.stringify([account,+period.priorStart,+period.start,+period.end,w.sessionUser.isFranchisee?branch:'accessible-branches']);
   let timer;const slow=w.setTimeout(()=>{if(current())container.innerHTML='<p role="status">Still loading the selected period. Larger reports can take up to a minute; keep this tab open.</p>';},15000);
   const timeout=new Promise((_,reject)=>{timer=w.setTimeout(()=>reject(Error('The report took too long to load. Check your connection and try again.')),60000);});
   const {data,loadedAt}=await Promise.race([periodReader(key,()=>Promise.all([read(range('transactions',period.priorStart,period.end,branch)),read(range('expenses',period.start,period.end,branch)),reference('inventory'),reference('bom'),read(collection('budgets'))]),refresh),timeout]).finally(()=>{w.clearTimeout(timer);w.clearTimeout(slow);});
   if(!current())return;
   const referenceAllowed=values=>values.filter(row=>allowed(row.branch));
   report=buildFinancialReport({transactions:rows(data[0]),expenses:rows(data[1]),inventory:referenceAllowed(data[2]),bom:data[3],budgets:referenceAllowed(rows(data[4])),branch,period,allowedBranch:allowed});
   w.tempCogsBreakdown=report.costs.breakdown;w.tempOpExBreakdown=report.trace;
   container.innerHTML=renderFinancialReview(report)+(w.renderBillForecast?.(rows(data[4]).filter(row=>allowed(row.branch)),branch,period.start,new Date(+period.end-1))||'');
   container.insertAdjacentHTML('afterbegin',`<p class="finance-footer" role="status">Records loaded ${new Date(loadedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}. Branch changes reuse this period for up to one minute. Refresh report requests fresh records.</p>`);mentor();charts(report);
   if(data[0].metadata?.fromCache||data[1].metadata?.fromCache)container.insertAdjacentHTML('afterbegin','<p class="finance-notice" role="status">Cached sales or payments · reconnect and refresh before relying on these totals.</p>');
   if(!w.sessionUser.isFranchisee){
    try{const restocks=await read(w.query(collection('hq_restocks'),w.where('timestamp','>=',period.start),w.where('timestamp','<',period.end)));if(current())container.insertAdjacentHTML('beforeend',renderDispatchRestockEstimates(collectDispatchRestockEstimates(rows(restocks).filter(row=>!row.toBranch||allowed(row.toBranch)),{start:period.start,end:new Date(+period.end-1),branch})));}
    catch{if(current())container.insertAdjacentHTML('beforeend','<p role="status">Dispatch restock estimates could not load. The recorded-cost report above is retained.</p>');}
   }
  }catch(error){if(!current())return;report=null;container.innerHTML=`<p class="finance-notice" role="alert">Report unavailable. ${esc(error.message)} <button type="button" data-financial-refresh>Try again</button></p>`;mentorContent.textContent='Analysis unavailable until the selected report loads successfully.';for(const n of ['flowSpendChartInstance','flowBudgetChartInstance']){w[n]?.destroy?.();w[n]=null;}}
 }
 function install(){
  const view=el('view-financial-flow');if(!view||view.dataset.financialReviewInstalled)return;view.dataset.financialReviewInstalled='true';
  if(!el('financialFlowStyles')){const link=d.createElement('link');link.id='financialFlowStyles';link.rel='stylesheet';link.href='./financial-flow.css';d.head.append(link);}
  const chartGrid=el('flowSpendChart')?.parentElement?.parentElement?.parentElement;chartGrid?.classList.add('finance-chart-grid');
  const mentorPanel=el('financialAiMentorContent')?.parentElement;mentorPanel?.classList.add('finance-mentor-panel');const heading=mentorPanel?.querySelector('h3');if(heading)heading.textContent='Financial mentor · record-based analysis';
  const spendTitle=el('flowSpendChart')?.parentElement?.parentElement?.querySelector('h3');if(spendTitle)spendTitle.textContent='Recorded cost breakdown';
  const budgetTitle=el('flowBudgetChart')?.parentElement?.parentElement?.querySelector('h3');if(budgetTitle)budgetTitle.textContent='Operating costs vs. recorded budget';
  w.loadFinancialFlow=load;
  view.addEventListener('click',event=>{
   const node=event.target.closest?.('button');if(!node)return;
   if(node.hasAttribute('data-financial-refresh'))return void load({refresh:true});
   if(node.dataset.financialTrace)return void trace(node.dataset.financialTrace);
   if(node.dataset.financialCategory)return void trace('operating',node.dataset.financialCategory);
   if(node.dataset.financialRoute&&can(node.dataset.financialRoute))w.switchView(node.dataset.financialRoute);
  });
  view.addEventListener('change',event=>{
   const metric=event.target.dataset?.financialTarget;if(!['food','payroll','operating'].includes(metric)||!report||identity!==sessionKey())return;
   const value=event.target.value;if(value!==''&&(!finite(value)||Number(value)<0||Number(value)>100)){el('financialTargetStatus').textContent='Enter a target from 0 to 100, or leave it blank.';return;}
   if(value==='')delete targets[metric];else targets[metric]=Number(value);let saved=true;
   try{w.localStorage.setItem(targetKey(),JSON.stringify(targets));}catch{saved=false;}mentor(true);el('financialTargetStatus').textContent=saved?'Planning target saved on this browser.':'Target applied in this tab; browser storage is unavailable.';
  });
  if(view.classList.contains('active'))void load();
 }
 return {load,install,getReport:()=>report};
}
export function scheduleFinancialFlow(w=window,d=document,defer=callback=>w.setTimeout(callback,0)){
 const flow=createFinancialFlow(w,d),afterRuntime=()=>defer(()=>flow.install());
 // Owner imports main.js only after PIN unlock. This dependency must finish
 // evaluating before main.js defines legacy loaders and the access wrappers.
 // Attach on the next task so those startup definitions cannot replace ours.
 if(d.readyState==='complete')afterRuntime();else w.addEventListener('load',afterRuntime,{once:true});
 return flow;
}
if(typeof window!=='undefined'&&typeof document!=='undefined')scheduleFinancialFlow();
