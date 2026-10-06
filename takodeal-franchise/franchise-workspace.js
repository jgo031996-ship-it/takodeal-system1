import { ROUTES, RELEASE, n, money, esc, ms, calendarDay, businessDay, addDays, range, dateText, stockQty, itemName, lowStock, isPaid, summarizeSales, closedShift, shiftReport, canVisit, ledgerRows, attendanceEstimate } from './franchise-data.js';
import { logExpense, adjustInventory, reviewRequest, loadBranchSchedule, saveBranchSchedule } from './franchise-actions.js';
import { receiveDispatch } from './dispatch-safety.js';
import { isLatenessRequest, legacyAttendanceCandidates, reviewLateRequest } from './payroll-safety.js';
import { createScheduleHistoryStore } from './schedule-history.js';
import { createFranchiseReads } from './franchise-reads.js';

export function installFranchiseWorkspace(api) {
 const $=id=>document.getElementById(id),state={route:'dashboard',generation:0,loaded:new Map(),inventory:new Map(),cart:[],cartBranch:'',pending:0,schedule:null,charts:[]};
 const session=()=>{const s=api.sessionUser;if (!s || !s.allowedBranches?.includes(s.branch)) throw new Error('Sign in and select an assigned branch.');return s;};
 const accountScope=()=>{const s=session();return JSON.stringify([api.auth?.currentUser?.uid,s.email,s.branch,s.cashierName,s.allowedBranches,s.permissions]);};
 const reader=createFranchiseReads(api,{scope:accountScope});
 api.clearFranchiseReadRequests=()=>reader.reset();
 const selectedRange=()=>range($('globalStartDate').value,$('globalEndDate').value);
 const element=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls || '';if(text!=null)el.textContent=text;return el;};
 function button(text,action,cls='secondary-button') {const el=element('button',cls,text);el.type='button';el.addEventListener('click',()=>Promise.resolve(action()).catch(showActionError));return el;}
 function showActionError(error) { if (globalThis.Swal) Swal.fire({title:'Could not save',text:error.message,icon:'error'});else $('workspaceMessage').textContent=error.message; }
 function badge(text,kind='') {return `<span class="badge ${kind}">${esc(text)}</span>`;}
 const cell=value=>`<td>${value}</td>`,number=value=>`<td class="number">${money(value)}</td>`;
 const empty=(cols,text)=>`<tr><td class="empty" colspan="${cols}">${esc(text)}</td></tr>`;
 function card(root,title,subtitle='') {const c=element('div','card'),head=element('div','card-head'),copy=element('div');copy.append(element('h2','',title));if(subtitle)copy.append(element('p','',subtitle));head.append(copy);c.append(head);root.append(c);return {card:c,head};}
 function table(root,title,columns,subtitle='') {const c=card(root,title,subtitle),wrap=element('div','table-wrap'),table=element('table','data-table');table.innerHTML='<thead><tr>'+columns.map(t=>`<th>${esc(t)}</th>`).join('')+'</tr></thead><tbody></tbody>';wrap.append(table);c.card.append(wrap);return {...c,wrap,body:table.tBodies[0],columns};}
 function tools(c,route,rows,renderRow,{search=true,category=false,status=false}={}) {
  const bar=element('div','tools'),searchInput=element('input');searchInput.type='search';searchInput.placeholder='Search records…';let categoryInput,statusInput;
  if(search){const label=element('label','search','Search');label.append(searchInput);bar.append(label);}
  const dropdown=(text,values)=>{const label=element('label','',text),input=element('select');input.append(new Option('All '+text.toLowerCase(),'All'));for(const value of values)input.append(new Option(value,value));label.append(input);bar.append(label);return input;};
  if(category)categoryInput=dropdown('Categories',[...new Set(rows.map(r=>r.category || 'Uncategorized'))].sort());
  if(status)statusInput=dropdown('Statuses',[...new Set(rows.map(r=>r.status || 'Recorded'))].sort());
  c.card.insertBefore(bar,c.wrap);
  const pager=element('div','pager'),summary=element('span'),actions=element('div','button-row');let page=0,filtered=rows;
  const prev=button('Previous',()=>{page--;draw();}),next=button('Next',()=>{page++;draw();});actions.append(prev,next);pager.append(summary,actions);c.card.append(pager);
  function draw() {const query=searchInput.value.trim().toLowerCase();filtered=rows.filter(r=>(!query || Object.entries(r).filter(([k,v])=>!['pin','securityPin','password','signature'].includes(k) && typeof v!=='object').map(([,v])=>String(v)).join(' ').toLowerCase().includes(query)) && (!categoryInput || categoryInput.value==='All' || (r.category || 'Uncategorized')===categoryInput.value) && (!statusInput || statusInput.value==='All' || (r.status || 'Recorded')===statusInput.value));page=Math.max(0,Math.min(page,Math.ceil(filtered.length/50)-1));c.body.innerHTML=filtered.slice(page*50,(page+1)*50).map(renderRow).join('') || empty(c.columns.length,'No matching records for this branch and period.');summary.textContent=filtered.length?`${page*50+1}–${Math.min((page+1)*50,filtered.length)} of ${filtered.length} records`:'0 records';prev.disabled=page===0;next.disabled=(page+1)*50>=filtered.length;state.loaded.set(route,{rows:filtered,columns:c.columns});}
  for(const input of [searchInput,categoryInput,statusInput].filter(Boolean))input.addEventListener('input',()=>{page=0;draw();});draw();
  c.head.append(button('Export CSV',()=>exportCSV(route,filtered)));
 }
 function exportCSV(route,rows) {
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r).filter(k=>!['pin','securityPin','password','signature','photoBase64','proofImageUrl'].includes(k) && (typeof r[k]!=='object' || ['timestamp','startTime','endTime','dateAdded'].includes(k)))))];
  const csvValue=value=>{let text=String(value ?? '');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const content='\uFEFF'+[keys.map(csvValue).join(','),...rows.map(r=>keys.map(k=>csvValue(['timestamp','startTime','endTime','dateAdded'].includes(k)?dateText(r[k]):r[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=element('a');a.href=url;a.download=`takodeal-${route}-${session().branch}-${$('globalStartDate').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function read(tableName,{branch=session().branch,time=null,start=null,end=null,filters=[]}={}) {
  return reader.read(tableName,{branch,time,start,end,filters});
 }
 const globalRead=reader.globalRead;
 async function accountsForBranch() {const [modern,legacy]=await Promise.all([read('cash_accounts'),read('franchise_accounts')]);return [...modern.map(a=>({...a,accountName:a.name || a.accountName,table:'cash_accounts'})),...legacy.map(a=>({...a,table:'franchise_accounts'}))];}
 async function budgetsForBranch() {const [modern,legacy]=await Promise.all([read('budgets'),read('franchise_budgets')]);return [...modern.map(a=>({...a,table:'budgets'})),...legacy.map(a=>({...a,table:'franchise_budgets'}))];}
 async function staffRows(tableName,profiles,filters=[]) {
  const names=[...new Set(profiles.map(p=>p.cashierName).filter(Boolean))],rows=[];
  for(let i=0;i<names.length;i+=30)rows.push(...await globalRead(tableName,['staffName','in',names.slice(i,i+30)],...filters));
  return rows.filter(r=>!r.branch || r.branch===session().branch);
 }
 async function inventory(force=false) {const branch=session().branch,scope=accountScope(),version=reader.version(),cache=state.inventory.get(branch);if(!force && cache?.scope===scope && Date.now()-cache.at<60000)return cache.rows;const rows=await read('inventory',{branch});if(api.sessionUser && scope===accountScope() && version===reader.version())state.inventory.set(branch,{rows,scope,at:Date.now()});return rows;}
 api.fetchCachedInventory=async branch=>{if(branch!==session().branch)throw new Error('Inventory branch is outside the selected workspace.');return inventory();};
 function root(route) {return $('body-'+route);}
 function errorMessage(error) {if(error.code==='permission-denied')return 'Your account cannot read these records. Ask HQ to review your branch access.';if(!navigator.onLine)return 'You are offline. Reconnect and choose Retry to load current records.';return error.message || 'The records could not load. Check your connection and retry.';}
 async function load(route,loader) {
  if(!canVisit(api.sessionUser,route))throw new Error('This page is outside your assigned access.');
  const current=++state.generation,branch=session().branch,scope=accountScope(),r=root(route);r.replaceChildren(element('div','loading','Loading current branch records…'));$('syncDataBtn').disabled=true;
  const detached=element('div');
  try {await loader(detached);if(current!==state.generation || branch!==api.sessionUser?.branch || scope!==accountScope())return;r.replaceChildren(...detached.childNodes);r.dataset.loaded='true';$('workspaceMessage').hidden=true;}
  catch(error) {if(current!==state.generation || branch!==api.sessionUser?.branch || scope!==accountScope())return;r.replaceChildren();const box=element('div','page-error');box.append(element('p','',errorMessage(error)),button('Retry',()=>api.switchView(route)));r.append(box);r.dataset.loaded='error';}
  finally {if(current===state.generation)$('syncDataBtn').disabled=false;}
 }
 const define=(route,fn)=>{api[ROUTES[route][2]]=()=>load(route,fn);};
 api.switchView=async route=>{
  if(!ROUTES[route])throw new Error('This page is unavailable.');if(!canVisit(api.sessionUser,route))throw new Error('This page is outside your assigned access.');
  if(state.schedule?.dirty && route!=='schedule' && state.route==='schedule') {const answer=await Swal.fire({title:'Keep unsaved schedule?',text:'Stay here to save your changes, or leave without saving.',showCancelButton:true,confirmButtonText:'Stay and save',cancelButtonText:'Leave without saving'});if(answer.isConfirmed)return;state.schedule=null;}
  state.route=route;
  for(const [key,meta] of Object.entries(ROUTES)){$('view-'+key).classList.toggle('active',key===route);const nav=$('nav-'+key);nav.classList.toggle('active',key===route);nav.setAttribute('aria-current',key===route?'page':'false');}
  for(const group of ['hr','inventory']) {const active=ROUTES[route][4]===group;$('nav-'+group).classList.toggle('active',active);if(active){$('sidebar').classList.remove('collapsed');$(group+'Submenu').classList.add('open');$('nav-'+group).setAttribute('aria-expanded','true');}}
  $('pageTitle').textContent=ROUTES[route][0];$('pageDescription').textContent=ROUTES[route][1];$('headingBranch').textContent='/ '+session().branch;$('globalDateControls').hidden=!ROUTES[route][3];
  $('sidebar').classList.remove('show-mobile');$('drawerBackdrop').hidden=true;
  await api[ROUTES[route][2]]();
 };
 api.refreshActiveData=async()=>{
  if(state.route==='schedule' && state.schedule?.dirty){const answer=await Swal.fire({title:'Reload schedule?',text:'Reloading will discard your unsaved changes.',showCancelButton:true,confirmButtonText:'Discard and reload'});if(!answer.isConfirmed)return;state.schedule.dirty=false;}
  reader.reset();state.inventory.clear();await api.switchView(state.route);
 };
 api.changeFranchiseBranch=async()=>{
  const next=$('franchiseBranchSelect').value,previous=session().branch;
  if(!session().allowedBranches.includes(next))throw new Error('This branch is outside your assigned access.');
  if(state.cart.length || state.schedule?.dirty) {const answer=await Swal.fire({title:'Switch branch?',text:'Unsaved supply requests and schedule changes belong to the current branch. Save them first, or discard them to switch.',showCancelButton:true,confirmButtonText:'Discard and switch'});if(!answer.isConfirmed){$('franchiseBranchSelect').value=previous;return;}}
  reader.reset();state.generation++;api.sessionUser.branch=next;state.cart=[];state.cartBranch=next;state.inventory.clear();state.loaded.clear();state.schedule=null;
  for(const key of Object.keys(ROUTES))root(key).replaceChildren();
  await api.switchView(state.route);
 };
 api.applyPermissions=()=>{
  for(const route of Object.keys(ROUTES))$('nav-'+route).hidden=!canVisit(api.sessionUser,route);
  for(const group of ['hr','inventory'])$('nav-'+group).hidden=!Object.keys(ROUTES).some(k=>ROUTES[k][4]===group && canVisit(api.sessionUser,k));
  const branches=session().allowedBranches,select=$('franchiseBranchSelect');select.replaceChildren(...branches.map(b=>new Option(b,b)));select.disabled=branches.length<2;select.value=session().branch;
  $('sidebarProfileName').textContent=session().cashierName;$('sidebarProfileRole').textContent=session().role || 'Franchise owner';
 };
 for(const route of Object.keys(ROUTES))$('nav-'+route).addEventListener('click',()=>api.switchView(route).catch(showActionError));
 for(const group of ['hr','inventory'])$('nav-'+group).addEventListener('click',()=>{if($('sidebar').classList.contains('collapsed'))$('sidebar').classList.remove('collapsed');const open=$(group+'Submenu').classList.toggle('open');$('nav-'+group).setAttribute('aria-expanded',String(open));});
 $('sidebarToggle').addEventListener('click',()=>{if(innerWidth<=900){$('sidebar').classList.remove('show-mobile');$('drawerBackdrop').hidden=true;}else $('sidebar').classList.toggle('collapsed');});
 $('mobileMenuBtn').addEventListener('click',()=>{$('sidebar').classList.add('show-mobile');$('drawerBackdrop').hidden=false;});$('drawerBackdrop').addEventListener('click',()=>{$('sidebar').classList.remove('show-mobile');$('drawerBackdrop').hidden=true;});
 $('franchiseBranchSelect').addEventListener('change',()=>api.changeFranchiseBranch().catch(showActionError));$('syncDataBtn').addEventListener('click',()=>api.refreshActiveData().catch(showActionError));
 for(const id of ['globalStartDate','globalEndDate']) {$(id).value=businessDay();$(id).addEventListener('change',()=>api.refreshActiveData().catch(showActionError));}
 function connection() {const online=navigator.onLine;$('connectionStatus').textContent=online?'Online':'Offline';$('connectionStatus').classList.toggle('offline',!online);$('loginConnection').textContent=online?'Secure Google sign-in + PIN':'Offline · reconnect to verify your account';}
 addEventListener('online',connection);addEventListener('offline',connection);connection();

 define('dashboard',async r=>{
  const dates=selectedRange(),endDay=$('globalEndDate').value,trendStart=range(addDays(endDay,-6),endDay).start;
  const [transactions,expenses,attendance]=await Promise.all([read('transactions',{time:'timestamp',start:new Date(Math.min(+dates.start,+trendStart)),end:dates.end}),read('expenses',{time:'timestamp',...dates}),read('attendance_logs')]);
  const selected=transactions.filter(t=>ms(t.timestamp)>=+dates.start && ms(t.timestamp)<+dates.end),summary=summarizeSales(selected),expenseTotal=expenses.filter(e=>e.type!=='Manager_Fund').reduce((s,e)=>s+n(e.amount),0);
  const hero=element('div','hero');hero.innerHTML=`<div><div class="eyebrow">BRANCH PERFORMANCE</div><h2>${esc(session().branch)} at a glance</h2><p>${esc($('globalStartDate').value)} to ${esc(endDay)} · Philippine business days</p></div><div><strong>${summary.balls.toLocaleString()}</strong><small>Takoyaki balls sold in this period</small></div>`;r.append(hero);
  const stats=element('div','stats');stats.innerHTML=[['Gross sales',summary.gross,'Before discounts'],['Net sales',summary.net,summary.orders+' paid orders'],['Cash out',expenseTotal,'Recorded expenses']].map(([title,value,caption])=>`<div class="stat"><label>${title}</label><strong>${money(value)}</strong><small>${caption}</small></div>`).join('');r.append(stats);
  const charts=element('div','dashboard-charts');r.append(charts);const trend=card(charts,'7-day net sales','Seven business days ending on your selected end date.'),mix=card(charts,'Product mix','Paid orders in your selected period.');
  for(const chart of state.charts)chart.destroy();state.charts=[];
  const labels=Array.from({length:7},(_,i)=>addDays(endDay,i-6)),values=labels.map(day=>summarizeSales(transactions.filter(t=>businessDay(t.timestamp)===day)).net);
  for(const [c,id] of [[trend,'chartTrend'],[mix,'chartPie']]){const box=element('div','card-body chart-box'),canvas=element('canvas');canvas.id=id;box.append(canvas);c.card.append(box);}
  // Canvas must be attached before Chart is initialized.
  requestAnimationFrame(()=>{if(state.route!=='dashboard' || !document.getElementById('chartTrend'))return;if(!globalThis.Chart){trend.card.append(element('p','notice','Charts are unavailable. Your sales figures above are current.'));return;}
   state.charts.push(new Chart($('chartTrend'),{type:'line',data:{labels,datasets:[{label:'Net sales',data:values,borderColor:'#14634e',backgroundColor:'#14634e16',fill:true,tension:.25,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}}));
   const products=Object.entries(summary.mix).sort((a,b)=>b[1]-a[1]);if(products.length>6){const others=products.splice(5);products.push(['Other products',others.reduce((s,p)=>s+p[1],0)]);}
   if(products.length)state.charts.push(new Chart($('chartPie'),{type:'doughnut',data:{labels:products.map(p=>p[0]),datasets:[{data:products.map(p=>p[1]),backgroundColor:['#14634e','#8eb39c','#d6b066','#668f86','#bfd3c0','#a4b8a4'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}}}));else $('chartPie').parentElement.replaceChildren(element('div','empty','No paid orders in this period.'));
  });
  const duty=card(r,'Staff on duty','Latest attendance punches, separate from cashier shift sessions.'),grid=element('div','card-body duty-grid'),latest=new Map();
  for(const log of [...attendance].sort((a,b)=>ms(a.timestamp)-ms(b.timestamp)))if(log.staffName)latest.set(log.staffName,log);
  const active=[...latest.values()].filter(a=>String(a.type).toUpperCase()==='TIME IN');for(const log of active){const chip=element('div','duty-chip');chip.innerHTML=`<strong>${esc(log.staffName)}</strong><small>${esc(dateText(log.timestamp))}${Date.now()-ms(log.timestamp)>16*3600000?' · Attendance needs review':''}</small>`;grid.append(chip);}if(!active.length)grid.append(element('div','empty','No staff currently clocked in.'));duty.card.append(grid);
 });
 define('history',async r=>{
  const rows=(await read('transactions',{time:'timestamp',...selectedRange()})).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)),c=table(r,'Sales history',['Receipt / ID','Date & time','Cashier','Payment','Status','Net total']);
  tools(c,'history',rows,t=>'<tr>'+cell(`<strong>${esc(t.receiptId || t.orNumber || t.id)}</strong>`)+cell(esc(dateText(t.timestamp)))+cell(esc(t.cashier || t.cashierName))+cell(esc(t.paymentMethod || 'Unavailable'))+cell(badge(t.status || 'Recorded',isPaid(t)?'':/void/i.test(t.status)?'danger':'warning'))+number(t.netTotal)+'</tr>',{status:true});
  c.body.addEventListener('click',e=>{const row=e.target.closest('tr');if(row && !row.querySelector('.empty')){const id=row.cells[0].textContent,tx=rows.find(t=>(t.receiptId || t.orNumber || t.id)===id);if(tx)showDetails('Receipt '+id,[['Cashier',tx.cashier || tx.cashierName],['Payment',tx.paymentMethod],['Status',tx.status],['Net total',money(tx.netTotal)]],(tx.cart || tx.items || []).map(i=>`${n(i.qty ?? 1)} × ${itemName(i)}`).join('\n'));}});
 });
 define('zreadings',async r=>{
  const dates=selectedRange(),rows=(await read('shifts')).filter(closedShift).map(shiftReport).filter(s=>ms(s.closedAt)>=+dates.start && ms(s.closedAt)<+dates.end).sort((a,b)=>ms(b.closedAt)-ms(a.closedAt));
  const totals=element('div','stats');totals.innerHTML=[['Closed shifts',rows.length,false],['Net sales',rows.reduce((s,r)=>s+r.net,0),true],['Cash variance',rows.reduce((s,r)=>s+r.variance,0),true]].map(([title,v,cash])=>`<div class="stat"><label>${title}</label><strong>${cash?money(v):v}</strong></div>`).join('');r.append(totals);
  const c=table(r,'Closed shift reports',['Closed at','Cashier','Net sales','Expected cash','Counted cash','Variance','Report'],'Reports come from the same shift records saved by the Cashier app.');
  tools(c,'zreadings',rows,s=>'<tr>'+cell(esc(dateText(s.closedAt)))+cell(esc(s.cashier || s.cashierName))+number(s.net)+number(s.expected)+number(s.declared)+cell(`<span class="${s.variance<0?'negative':s.variance>0?'positive':''}">${money(s.variance)}</span>`)+cell(`<button class="table-action" data-shift="${esc(s.id)}">View details</button>` )+'</tr>');
  c.body.addEventListener('click',e=>{const id=e.target.closest('[data-shift]')?.dataset.shift;if(id)api.viewZReadingDetails(id).catch(showActionError);});
 });
 api.viewZReadingDetails=async id=>{
  const snap=await api.getDocFromServer(api.doc(api.db,'shifts',id));if(!snap.exists() || snap.data().branch!==session().branch)throw new Error('This report is outside your branch.');
  const s=shiftReport(snap.data());if(!closedShift(s))throw new Error('This shift is still open.');
  const stock=s.physicalStockCount || s.closingStockCount || {},counts=s.cashDenominations || s.cashBreakdown || s.denominationCounts || {};
  const describe=(key,value)=>typeof value==='object' && value!==null ? `${itemName({...value,name:value.name || value.itemName || key})}: ${value.actualCount ?? value.actualQty ?? value.count ?? value.qty ?? 'Unavailable'} ${value.uom || value.unit || ''}${value.systemQty!=null?' · System count '+value.systemQty:''}` : `${key}: ${value}`;
  const list=value=>Array.isArray(value)?value.map((v,i)=>describe(String(i+1),v)).join('\n'):Object.entries(value).map(([k,v])=>describe(k,v)).join('\n');
  showDetails('Z-Reading · '+id,[['Branch',s.branch],['Cashier',s.cashier || s.cashierName],['Opened',dateText(s.startTime)],['Closed',dateText(s.closedAt)],['Cash sales',money(s.cash)],['Digital sales',money(s.digital)],['Expected cash',money(s.expected)],['Counted cash',money(s.declared)],['Variance',money(s.variance)]],(list(s.digitalBreakdown || {})?'Digital payments\n'+list(s.digitalBreakdown)+'\n\n':'')+(list(counts)?'Cash denominations\n'+list(counts)+'\n\n':'')+(list(stock)?'Closing stock count\n'+list(stock):''));
 };
 define('expenses',async r=>{
  const rows=(await read('expenses',{time:'timestamp',...selectedRange()})).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)),total=rows.filter(e=>e.type!=='Manager_Fund').reduce((s,e)=>s+n(e.amount),0);
  const hero=element('div','hero');hero.innerHTML=`<div><div class="eyebrow">BRANCH EXPENSES</div><h2>${money(total)}</h2><p>Recorded cash out for the selected business days.</p></div><div><strong>${rows.length}</strong><small>expense records</small></div>`;r.append(hero);
  const c=table(r,'Expense logs',['Date & time','Category','Description','Account','Logged by','Amount']);c.head.append(button('Log expense',()=>api.openLogExpenseModal(),'primary-button'));
  tools(c,'expenses',rows,e=>'<tr>'+cell(esc(dateText(e.timestamp)))+cell(esc(e.category || e.type || 'Uncategorized'))+cell(esc(e.description || e.note || e.item || 'Expense'))+cell(esc(e.accountName || e.paymentMethod || 'Cash drawer'))+cell(esc(e.loggedBy || e.user || e.cashier || 'Unavailable'))+number(e.amount)+'</tr>',{category:true});
 });
 define('accounts',async r=>{
  const branch=session().branch,month=calendarDay().slice(0,7),start=new Date(month+'-01T00:00:00+08:00'),next=addDays(month+'-01',32).slice(0,7)+'-01',end=new Date(next+'T00:00:00+08:00');
  const [accounts,budgets,expenses]=await Promise.all([accountsForBranch(),budgetsForBranch(),read('expenses',{time:'timestamp',start,end})]);api.activeAccounts=accounts.map(a=>({id:a.id,name:a.accountName,balance:a.balance,branch,table:a.table}));api.activeBudgetCategories=budgets.map(b=>b.category);
  const columns=element('div','two-columns');r.append(columns);const c=table(columns,'Store cash accounts',['Account','Current balance'],'Shared HQ accounts and preserved legacy franchise accounts.');c.head.append(button('Add account',()=>api.openAddAccountModal(),'primary-button'));c.body.innerHTML=accounts.map(a=>'<tr>'+cell(`<strong>${esc(a.accountName)}</strong><small>${a.table==='cash_accounts'?'Shared with HQ':'Legacy franchise account'}</small>`)+number(a.balance)+'</tr>').join('') || empty(2,'No cash accounts. Add an account to start.');
  const b=card(columns,'Monthly budget',month+' · Calendar month spending'),body=element('div','card-body'),actions=element('div','button-row');actions.append(button('Add budget',()=>api.openAddBudgetModal()),button('Log expense',()=>api.openLogExpenseModal(),'primary-button'));b.head.append(actions);
  for(const budget of budgets){const spent=expenses.filter(e=>e.category===budget.category && e.type!=='Manager_Fund').reduce((s,e)=>s+n(e.amount),0),row=element('div','budget-row');row.innerHTML=`<div><strong>${esc(budget.category)}</strong><span>${money(spent)} / ${money(budget.limit)}</span></div><progress max="${Math.max(n(budget.limit),1)}" value="${Math.max(spent,0)}"></progress>`;row.append(button('Edit budget',()=>api.openAddBudgetModal(budget)));body.append(row);}if(!budgets.length)body.append(element('div','empty','No monthly budgets yet.'));b.card.append(body);
 });
 define('hq-billing',async r=>{
  const rows=ledgerRows(await read('franchise_ledger')),balance=rows.at(-1)?.balance || 0,hero=element('div','hero');hero.innerHTML=`<div><div class="eyebrow">STATEMENT OF ACCOUNT</div><h2>${money(balance)}</h2><p>${balance>0?'Outstanding balance owed to HQ':balance<0?'Credit balance with HQ':'No outstanding balance'}</p></div><div><small>All recorded charges and payments</small></div>`;r.append(hero);
  const c=table(r,'HQ ledger',['Date','Category','Description','Charge','Payment','Balance']);tools(c,'hq-billing',[...rows].reverse(),e=>'<tr>'+cell(esc(dateText(e.timestamp)))+cell(esc(e.category || e.type))+cell(esc(e.description))+number(e.charge)+number(e.payment)+number(e.balance)+'</tr>');
 });
 define('inv-overview',async r=>{
  const rows=(await inventory()).sort((a,b)=>itemName(a).localeCompare(itemName(b))),c=table(r,'Live stock levels',['Item','Category','Current stock','Status']);
  tools(c,'inv-overview',rows,i=>'<tr>'+cell(`<strong>${esc(itemName(i))}</strong>`)+cell(esc(i.category || 'Uncategorized'))+cell(`<strong class="${stockQty(i)<0?'negative':''}">${stockQty(i).toLocaleString('en-PH',{maximumFractionDigits:3})}</strong> ${esc(i.uom || 'units')}`)+cell(badge(lowStock(i)?'Low stock':'In stock',lowStock(i)?'warning':''))+'</tr>',{category:true});
 });
 for(const [route,type] of [['inv-audits','Audit'],['inv-waste','Waste']])define(route,async r=>{
  const rows=(await read('inventory_logs',{time:'timestamp',...selectedRange()})).filter(e=>e.type===type).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp));
  const c=table(r,type==='Audit'?'Physical stock audits':'Waste records',type==='Audit'?['Date','Item','System count','Actual count','Variance','Audited by']:['Date','Item','Quantity wasted','Reason','Logged by']);c.head.append(button(type==='Audit'?'Perform audit':'Log waste',()=>type==='Audit'?api.openAuditModal():api.openWasteModal(), 'primary-button'));
  tools(c,route,rows,e=>'<tr>'+cell(esc(dateText(e.timestamp)))+cell(esc(e.itemName))+ (type==='Audit'?cell(esc(e.systemQty)+' '+esc(e.unit))+cell(esc(e.actualQty)+' '+esc(e.unit))+cell(esc(e.variance)):cell(esc(e.qtyWasted)+' '+esc(e.unit))+cell(esc(e.reason)))+cell(esc(e.loggedBy))+'</tr>');
 });
 for(const route of ['inv-prep','inv-logs'])define(route,async r=>{
  let rows=await read('stock_logs',{time:'timestamp',...selectedRange()});if(route==='inv-prep')rows=rows.filter(e=>/prep|prepared|production/i.test(e.type || ''));rows.sort((a,b)=>ms(b.timestamp)-ms(a.timestamp));
  const c=table(r,route==='inv-prep'?'Kitchen production history':'Stock movement history',['Date & time','Item','Movement','Previous stock','New stock','Change','Logged by']);
  tools(c,route,rows,e=>'<tr>'+cell(esc(dateText(e.timestamp)))+cell(esc(e.item || e.itemName))+cell(esc(e.type || 'Adjustment'))+cell(esc(e.oldQty ?? '—'))+cell(esc(e.newQty ?? '—'))+cell(esc(e.variance ?? e.qty ?? '—')+' '+esc(e.uom || 'units'))+cell(esc(e.user || e.cashier || e.loggedBy || 'Unavailable'))+'</tr>');
 });
 define('inv-alerts',async r=>{
  const rows=(await inventory()).filter(lowStock).sort((a,b)=>stockQty(a)-stockQty(b)),c=table(r,'Items needing restock',['Item','Category','Current stock','Reorder level','Action']);
  tools(c,'inv-alerts',rows,i=>'<tr>'+cell(`<strong>${esc(itemName(i))}</strong>`)+cell(esc(i.category))+cell(`${stockQty(i)} ${esc(i.uom || 'units')}`)+cell(`${n(i.reorderLevel ?? i.lowStockAlert)} ${esc(i.uom || 'units')}`)+cell(canVisit(api.sessionUser,'b2b')?`<button class="table-action" data-restock="${esc(itemName(i))}">Request supplies</button>`:'Ask an authorized account to request supplies')+'</tr>',{category:true});
  c.body.addEventListener('click',e=>{const name=e.target.closest('[data-restock]')?.dataset.restock;if(!name)return;Promise.resolve().then(async()=>{await api.switchView('b2b');$('b2bSearch').value=name;api.updateB2bUom();}).catch(showActionError);});
 });
 function showDetails(title,fields,text='') {return Swal.fire({titleText:title,html:'<dl class="details-list">'+fields.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v ?? 'Unavailable')}</dd></div>`).join('')+'</dl>'+`<div class="memo-content">${esc(text)}</div>`,width:720,showCloseButton:true,confirmButtonText:'Close'});}
 function uniqueId(prefix) {return prefix+'-'+crypto.randomUUID();}
 async function form(title,html,save,{confirm='Save',didOpen}={}) {
  const branch=session().branch;
  return Swal.fire({titleText:title,html:`<div class="form-grid">${html}</div>`,showCancelButton:true,confirmButtonText:confirm,showLoaderOnConfirm:true,allowOutsideClick:()=>!Swal.isLoading(),didOpen,preConfirm:async()=>{
   if(session().branch!==branch){Swal.showValidationMessage('The branch changed. Reopen the form.');return false;}
   state.pending++;
   try{const result=await save(branch);reader.reset();return result;}catch(error){Swal.showValidationMessage(error.message);return false;}finally{state.pending--;}
  }});
 }
 const field=(name,label,type='text',value='',extra='')=>`<label>${esc(label)}<input id="form-${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
 const selectField=(name,label,options)=>`<label>${esc(label)}<select id="form-${name}">${options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>`;
 api.openAddAccountModal=async()=>{
  const id=uniqueId('franchise-account'),result=await form('Add branch cash account',field('name','Account name')+field('balance','Opening balance (₱)','number','0','step="0.01"'),async branch=>{
   const name=$('form-name').value.trim(),balance=Number($('form-balance').value);if(!name || !Number.isFinite(balance))throw new Error('Enter a name and valid opening balance.');
   const ref=api.doc(api.db,'cash_accounts',id);await api.runTransaction(api.db,async tx=>{const snap=await tx.get(ref);if(snap.exists())return;tx.set(ref,{branch,name,balance:Math.round(balance*100)/100,createdBy:session().cashierName,createdAt:api.serverTimestamp()});});return true;
  });if(result.isConfirmed)await api.loadAccountsView();
 };
 api.openAddBudgetModal=async existing=>{
  const id=existing?.id || uniqueId('franchise-budget'),result=await form(existing?'Edit monthly budget':'Add monthly budget',field('category','Category','text',existing?.category || '')+field('limit','Monthly limit (₱)','number',existing?.limit ?? '0','min="0" step="0.01"'),async branch=>{
   const category=$('form-category').value.trim(),limit=Number($('form-limit').value);if(!category || !Number.isFinite(limit) || limit<0)throw new Error('Enter a category and a nonnegative monthly limit.');
   const ref=api.doc(api.db,existing?.table || 'franchise_budgets',id);await api.runTransaction(api.db,async tx=>{const snap=await tx.get(ref);if(snap.exists() && snap.data().branch!==branch)throw new Error('This budget is outside your branch.');tx.set(ref,{...(snap.exists()?snap.data():{}),branch,category,limit:Math.round(limit*100)/100,updatedAt:api.serverTimestamp()});});return true;
  });if(result.isConfirmed)await api.loadAccountsView();
 };
 api.openLogExpenseModal=async()=>{
  const [accounts,budgets]=await Promise.all([accountsForBranch(),budgetsForBranch()]);if(!accounts.length)return Swal.fire({title:'Add a cash account',text:'Open Cash & Budget and add an account before logging an expense.',icon:'info'});
  const id=uniqueId('franchise-expense'),result=await form('Log branch expense',selectField('account','Cash account',accounts.map(a=>[a.table+'/'+a.id,a.accountName+' · '+money(a.balance)+(a.table==='franchise_accounts'?' · Legacy':'')]))+selectField('category','Category',[...new Set(['Uncategorized',...budgets.map(b=>b.category)])].map(c=>[c,c]))+field('amount','Amount (₱)','number','','min="0.01" step="0.01"')+field('description','Description'),async branch=>{const account=accounts.find(a=>a.table+'/'+a.id===$('form-account').value);if(!account)throw new Error('Choose a valid branch account.');await logExpense(api,{id,branch,accountId:account.id,accountTable:account.table,category:$('form-category').value,amount:$('form-amount').value,description:$('form-description').value,actor:session().cashierName});return true;});if(result.isConfirmed)await api.refreshActiveData();
 };
 async function stockForm(type) {
  const rows=await inventory(true);if(!rows.length)return Swal.fire({title:'No inventory',text:'No stock items are registered for this branch.',icon:'info'});
  const id=uniqueId('franchise-stock'),result=await form(type==='Audit'?'Physical stock audit':'Log waste / spoilage',selectField('item','Inventory item',rows.map(i=>[i.id,itemName(i)+' · '+stockQty(i)+' '+(i.uom || 'units')]))+field('qty',type==='Audit'?'Actual counted quantity':'Quantity wasted','number','','min="0" step="0.001"')+(type==='Waste'?field('reason','Reason'):''),async branch=>{const item=rows.find(i=>i.id===$('form-item').value);if(!$('form-qty').value.trim())throw new Error('Enter the quantity.');await adjustInventory(api,{id,branch,itemId:item.id,type,quantity:Number($('form-qty').value),reason:$('form-reason')?.value || '',observedStock:stockQty(item),actor:session().cashierName});state.inventory.delete(branch);return true;});if(result.isConfirmed)await api.refreshActiveData();
 }
 api.openAuditModal=()=>stockForm('Audit');api.openWasteModal=()=>stockForm('Waste');

 define('b2b',async r=>{
  const branch=session().branch;if(state.cartBranch!==branch){state.cart=[];state.cartBranch=branch;}
  const [catalog,deliveries,requests]=await Promise.all([globalRead('inventory',['branch','==','Main Office'],['allowRequest','==',true]),globalRead('dispatch_logs',['toBranch','==',branch]),read('purchase_orders')]);
  api.hqInventoryCache=catalog.filter(i=>i.branch==='Main Office' && i.allowRequest===true);
  const cols=element('div','two-columns');r.append(cols);const order=card(cols,'Request supplies','Only items approved for branch ordering are listed.'),body=element('div','card-body');body.innerHTML=`<div class="form-grid"><label class="full">Item<input id="b2bSearch" list="b2bDatalist" placeholder="Choose an approved HQ item"><datalist id="b2bDatalist">${api.hqInventoryCache.map(i=>`<option value="${esc(itemName(i))}"></option>`).join('')}</datalist></label><label>Quantity<input type="number" min="0.001" step="0.001" id="b2bQty"></label><label>Unit<select id="b2bUom"><option value="base">Choose an item first</option></select></label></div>`;body.append(button('Add to request',()=>api.addB2bToCart(),'primary-button'));const cart=element('div','',null);cart.id='b2bCartList';body.append(cart,button('Send request to HQ',()=>api.submitB2bRequest(),'primary-button'));order.card.append(body);
  const incoming=card(cols,'Incoming deliveries','Confirm actual quantities after the driver marks the delivery arrived.'),deliveryBody=element('div','card-body');deliveryBody.id='b2bDeliveriesContainer';incoming.card.append(deliveryBody);
  const active=deliveries.filter(d=>d.toBranch===branch && ['In Transit','Arrived'].includes(d.status));const groups=new Map();for(const d of active){const key=d.dispatchId || d.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(d);}for(const [id,items] of groups){const shipment=element('div','budget-row');shipment.innerHTML=`<div><strong>${esc(items[0].driver || 'HQ delivery')}</strong>${badge(items.every(i=>i.status==='Arrived')?'Arrived':'In transit','warning')}</div><p class="notice">${items.map(i=>`${esc(i.displayQty ?? (n(i.qty)/Math.max(n(i.convRate),1)))} ${esc(i.displayUom || i.uom)} · ${esc(i.item)}`).join('<br>')}</p>`;if(items.every(i=>i.status==='Arrived'))shipment.append(button('Verify & receive stock',()=>api.receiveHQDelivery(id,items),'primary-button'));deliveryBody.append(shipment);}if(!active.length)deliveryBody.append(element('div','empty','No incoming deliveries.'));
  const c=table(r,'Supply request history',['Requested','Requested by','Items','Status']);tools(c,'b2b',requests.sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)),p=>'<tr>'+cell(esc(dateText(p.timestamp)))+cell(esc(p.requestedBy))+cell((p.items || []).map(i=>`${esc(i.displayQty ?? i.qty)} ${esc(i.displayUom || i.uom || '')} · ${esc(itemName(i))}`).join('<br>'))+cell(badge(p.status || 'Pending',p.status==='Pending'?'warning':''))+'</tr>',{status:true});
  requestAnimationFrame(()=>{if(state.route!=='b2b' || !document.getElementById('b2bSearch'))return;$('b2bSearch').addEventListener('input',api.updateB2bUom);api.renderB2bCart();});
 });
 api.updateB2bUom=()=>{const item=api.hqInventoryCache?.find(i=>itemName(i)===$('b2bSearch')?.value.trim()),drop=$('b2bUom');if(!drop)return;drop.replaceChildren();if(!item){drop.append(new Option('Choose an approved item','base'));return;}const base=item.uom || 'units',purchase=item.purchaseUom || item.purchUom,rate=n(item.conversionRate ?? item.convRate) || 1;if(purchase && purchase!==base && rate>1){const option=new Option(purchase,'purch');option.dataset.rate=rate;drop.append(option);}const option=new Option(base,'base');option.dataset.rate='1';drop.append(option);};
 api.addB2bToCart=()=>{const name=$('b2bSearch').value.trim(),item=api.hqInventoryCache.find(i=>itemName(i)===name),qty=Number($('b2bQty').value),option=$('b2bUom').selectedOptions[0];if(!item || !Number.isFinite(qty) || qty<=0)throw new Error('Choose an approved item and enter a positive quantity.');const rate=n(option.dataset.rate) || 1;state.cart.push({itemName:name,name,rawQty:qty,displayQty:qty,displayUom:option.text,qty:qty*rate,convRate:rate,requestType:'Franchise Restock Order'});state.requestId=null;$('b2bSearch').value='';$('b2bQty').value='';api.renderB2bCart();};
 api.renderB2bCart=()=>{const root=$('b2bCartList');if(!root)return;root.replaceChildren();root.className='card-body';for(const [index,item] of state.cart.entries()){const row=element('div','budget-row');row.append(element('p','',`${item.displayQty} ${item.displayUom} · ${item.name}`),button('Remove',()=>{state.cart.splice(index,1);state.requestId=null;api.renderB2bCart();}));root.append(row);}if(!state.cart.length)root.append(element('p','notice','Your request cart is empty.'));};
 api.submitB2bRequest=async()=>{if(!state.cart.length)throw new Error('Add supplies to the request first.');if(state.pending)return;const branch=session().branch,items=structuredClone(state.cart),id=state.requestId ||= uniqueId('franchise-order');const confirmed=await Swal.fire({title:'Send supply request?',text:'HQ will receive '+items.length+' requested items for '+branch+'.',showCancelButton:true,confirmButtonText:'Send request'});if(!confirmed.isConfirmed)return;state.pending++;try {await api.runTransaction(api.db,async tx=>{const ref=api.doc(api.db,'purchase_orders',id),snap=await tx.get(ref);if(snap.exists())return;tx.set(ref,{branch,items,status:'Pending',type:'Franchise Order',requestedBy:session().cashierName,timestamp:api.serverTimestamp()});});reader.reset();state.cart=[];state.requestId=null;await api.loadB2BSupply();}finally{state.pending--;}};
 api.receiveHQDelivery=async(id,items)=>{const branch=session().branch;const html=items.map((i,index)=>field('received-'+index,i.item+' · '+(i.displayUom || i.uom),'number',i.displayQty ?? (n(i.qty)/(n(i.convRate) || 1)),'min="0" step="0.001"')).join('')+field('remarks','Receiving remarks');const result=await form('Verify received stock',html,async b=>{const received=items.map((i,index)=>({id:i.id,actualDisplayQty:Number($('form-received-'+index).value),remarks:$('form-remarks').value}));if(received.some((i,index)=>!$('form-received-'+index).value.trim()))throw new Error('Enter the received quantity for every item.');await receiveDispatch(api,{branch:b,actor:session().cashierName,items:received});state.inventory.delete(b);return true;},{confirm:'Confirm receipt'});if(result.isConfirmed && session().branch===branch)await api.loadB2BSupply();};

 define('inbox',async r=>{
  const rows=(await read('staff_requests')).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp));const pending=table(r,'Pending staff requests',['Submitted','Staff','Type','Details','Actions']),resolved=table(r,'Resolved request history',['Submitted','Staff','Type','Status','Manager reply']);
  tools(pending,'inbox',rows.filter(a=>a.status==='Pending'),a=>'<tr>'+cell(esc(dateText(a.timestamp)))+cell(esc(a.staffName))+cell(esc(a.type))+cell(esc(a.explanationMessage || a.reason || a.item || a.details || '')+`<small>${n(a.amount)?money(a.amount):''}</small>`)+cell(`<div class="button-row"><button class="table-action" data-request="${esc(a.id)}" data-decision="Approved">Approve</button><button class="danger-button" data-request="${esc(a.id)}" data-decision="Rejected">Reject</button></div>`)+'</tr>');
  tools(resolved,'inbox-resolved',rows.filter(a=>a.status!=='Pending'),a=>'<tr>'+cell(esc(dateText(a.timestamp)))+cell(esc(a.staffName))+cell(esc(a.type))+cell(badge(a.status || 'Recorded',a.status==='Rejected'?'danger':''))+cell(esc(a.managerReply || a.processedBy || ''))+'</tr>',{status:true});
  pending.body.addEventListener('click',e=>{const btn=e.target.closest('[data-request]');if(btn)api.handleRequest(btn.dataset.request,btn.dataset.decision).catch(showActionError);});
 });
 api.handleRequest=async(id,action)=>{
  const snapshot=await api.getDocFromServer(api.doc(api.db,'staff_requests',id));if(!snapshot.exists() || snapshot.data().branch!==session().branch)throw new Error('This request is outside your branch.');
  const request=snapshot.data(),late=isLatenessRequest(request);let candidates=[];
  if(late){if(request.attendanceLogId){const punch=await api.getDocFromServer(api.doc(api.db,'attendance_logs',request.attendanceLogId));if(punch.exists() && punch.data().branch===session().branch)candidates=[{...punch.data(),id:punch.id}];}else candidates=legacyAttendanceCandidates(request,await read('attendance_logs'));}
  const html=field('reply','Message to staff')+(late?selectField('attendance','Clock-in linked to this letter',candidates.map(a=>[a.id,a.staffName+' · '+dateText(a.timestamp)])):'');
  const result=await form(action==='Approved'?'Approve staff request':'Reject staff request',html,async branch=>{
   if(late){if(!candidates.length)throw new Error('No matching clock-in was found. Ask HQ to review the attendance record.');await reviewLateRequest(api,{requestId:id,attendanceId:$('form-attendance').value,action,reply:$('form-reply').value,actor:session().cashierName});}
   else await reviewRequest(api,{id,branch,action,reply:$('form-reply').value,actor:session().cashierName});return true;
  },{confirm:action==='Approved'?'Approve':'Reject'});if(result.isConfirmed)await api.loadInbox();
 };
 define('payroll',async r=>{
  const dates=selectedRange(),profiles=await read('cashiers'),[logs,deductions,bonuses,ledgers,schedule]=await Promise.all([read('attendance_logs',{time:'timestamp',start:dates.start,end:new Date(+dates.end+18*3600000)}),staffRows('staff_deductions',profiles),staffRows('staff_bonuses',profiles),staffRows('staff_ledger',profiles),createScheduleHistoryStore(api).loadRange(calendarDay(new Date(+dates.start-86400000)),calendarDay(dates.end))]);
  const holidays=schedule.holidays || {},rows=attendanceEstimate({logs,profiles,deductions,bonuses,ledgers,schedule,holidays,start:$('globalStartDate').value,end:$('globalEndDate').value,branch:session().branch});
  const c=table(r,'Attendance & payroll estimates',['Staff','Hours','Shifts','Gross estimate','Deductions','Net estimate','Attendance']);c.card.append(element('p','notice','Estimates use saved employee rates, attendance, unpaid deductions and the Manager bonus rules. Review missing or invalid punches before payroll approval. This page does not issue payroll payments.'));
  tools(c,'payroll',rows,p=>'<tr>'+cell(`<strong>${esc(p.name)}</strong>`)+cell(p.hours.toFixed(1))+cell(p.shifts)+number(p.gross)+number(p.totalDeductions)+number(p.net)+cell(`<button class="table-action" data-payroll="${esc(p.name)}">${p.review?'Review '+p.review+' punch(es)':'View details'}</button>`)+'</tr>');c.body.addEventListener('click',e=>{const name=e.target.closest('[data-payroll]')?.dataset.payroll,p=rows.find(p=>p.name===name);if(p)showDetails('Payroll estimate · '+name,[['Basic pay',money(p.basic)],['Bonuses',money(p.bonus)],['Lateness / penalties',money(p.late)],['Meals',money(p.meals)],['Advances',money(p.advances)],['Loan deduction',money(p.loan)],['Saved statutory / custom deductions',money(p.fixed)],['Net estimate',money(p.net)]],p.logs.map(l=>dateText(l.in)+' → '+(l.out?dateText(l.out):'Missing time out')+' · '+l.remark).join('\n'));});
 });
 define('schedule',async r=>{
  const branch=session().branch,identity=session().email,month=calendarDay().slice(0,7),c=card(r,'Branch staff schedule','Saved work dates retain their own shift times. Changes update only your branch.'),control=element('div','button-row'),input=element('input'),effective=element('input'),save=button('Save schedule',()=>api.saveScheduleToCloud(),'primary-button');input.type='month';input.id='scheduleMonthSelector';input.value=state.schedule?.branch===branch?state.schedule.month:month;effective.type='date';effective.id='scheduleEffectiveFrom';effective.setAttribute('aria-label','Changes apply from');const dateLabel=element('label','','Changes apply from');dateLabel.append(effective);control.append(input,dateLabel,save);c.head.append(control);
  const [year,monthNumber]=input.value.split('-').map(Number),authorize=b=>session().branch===b && session().email===identity && canVisit(session(),'schedule');
  const [editor,profiles]=await Promise.all([loadBranchSchedule(api,{branch,year,month:monthNumber,authorize}),read('cashiers',{branch})]);if(!authorize(branch))throw new Error('Your branch access changed. Reload the schedule.');
  const {days,shifts}=editor,employees=profiles.filter(p=>!['Resigned','Inactive'].includes(p.status)).map(p=>({name:p.scheduleNickname || p.cashierName,fullName:p.cashierName}));
  state.schedule={...editor,employees,identity,dirty:false,saving:false,saveId:null};effective.value=editor.effectiveFrom;effective.min=editor.effectiveFrom;effective.max=input.value+'-'+String(new Date(year,monthNumber,0).getDate()).padStart(2,'0');effective.disabled=editor.readOnly;save.disabled=editor.readOnly;
  if(editor.readOnly)c.card.append(element('p','notice','Historical month — read only. Viewing this month does not change attendance or payroll.'));
  if(editor.unverifiedDays.length)c.card.append(element('p','notice','Some earlier dates have no preserved schedule version. Their displayed legacy assignments are unverified; no past records are changed.'));
  const container=element('div','table-wrap');container.id='franchiseScheduleContainer';c.card.append(container);
  function draw(){const count=new Date(year,monthNumber,0).getDate(),active=[...new Map([...shifts,...Object.values(editor.dayShifts).flat()].filter(s=>s.active!==false).map(s=>[s.id,s])).values()],t=element('table','data-table');t.innerHTML='<thead><tr><th>Date</th>'+active.map(s=>`<th>${esc(s.name)}</th>`).join('')+'<th>Standby / off</th></tr></thead><tbody></tbody>';for(let day=1;day<=count;day++){const dateKey=input.value+'-'+String(day).padStart(2,'0'),locked=editor.readOnly || dateKey<effective.value;if(!locked)days[day] ||= {scheduled:{},rest:employees.map(p=>p.name),unavailable:[],swaps:{}};const d=days[day],tr=element('tr'),date=element('td','',new Date(dateKey+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric'}));if(editor.unverifiedDays.includes(day))date.append(element('small','','Unverified history'));tr.append(date);for(const shift of active){const cell=element('td','schedule-cell'),rule=(editor.dayShifts[day] || []).find(s=>s.id===shift.id && s.active!==false);if(rule)cell.append(element('small','',`${rule.startTime || ''}–${rule.endTime || ''}`));if(locked || !rule){cell.append(element('span','',d?.scheduled?.[shift.id] || (rule?'Not recorded':'—')));}else{const select=element('select');select.setAttribute('aria-label',`${day} ${shift.name}`);select.append(new Option('Unfilled','UNFILLED'),new Option('Not applicable','N/A'));for(const p of employees)select.append(new Option(p.name,p.name));const assigned=d.scheduled?.[shift.id] || 'UNFILLED';if(![...select.options].some(o=>o.value===assigned))select.append(new Option(assigned,assigned));select.value=assigned;select.addEventListener('change',()=>{const already=Object.entries(d.scheduled || {}).find(([id,name])=>id!==shift.id && name===select.value && !['UNFILLED','N/A'].includes(name));if(already){select.value=d.scheduled[shift.id] || 'UNFILLED';showActionError(new Error('This staff member is already assigned to another shift on that day.'));return;}if((d.unavailable || []).some(p=>(typeof p==='string'?p:p.name)===select.value)){select.value=d.scheduled[shift.id] || 'UNFILLED';showActionError(new Error('This staff member is unavailable on that date.'));return;}d.scheduled ||= {};d.scheduled[shift.id]=select.value;d.rest=employees.map(p=>p.name).filter(name=>!Object.values(d.scheduled).includes(name) && !(d.unavailable || []).some(p=>(typeof p==='string'?p:p.name)===name));state.schedule.dirty=true;state.schedule.saveId=null;draw();});cell.append(select);}tr.append(cell);}tr.append(element('td','',d?.rest?.join(', ') || '—'));t.tBodies[0].append(tr);}container.replaceChildren(t);}
  if(!shifts.some(s=>s.active!==false) && !editor.readOnly)c.card.append(element('p','notice','HQ has not configured active shift times for this branch. Ask HQ to add the branch shifts in Schedule Manager.'));
  draw();effective.addEventListener('change',()=>{if(effective.value<editor.effectiveFrom || effective.value>effective.max){effective.value=state.schedule.effectiveFrom;return;}state.schedule.effectiveFrom=effective.value;state.schedule.saveId=null;draw();});input.addEventListener('change',async()=>{try{if(!/^\d{4}-\d{2}$/.test(input.value)){input.value=state.schedule.month;throw new Error('Choose a valid schedule month.');}if(state.schedule.dirty || state.schedule.saving){input.value=state.schedule.month;throw new Error('Save or reload your current changes before selecting another month.');}state.schedule.month=input.value;await api.loadScheduleFromCloud();}catch(error){showActionError(error);}});
 });
 api.saveScheduleToCloud=async()=>{const s=state.schedule;if(!s || s.branch!==session().branch || s.identity!==session().email || !canVisit(session(),'schedule'))throw new Error('Reload the branch schedule first.');if(s.readOnly)throw new Error('Historical months are read-only.');if(!s.shifts.some(shift=>shift.active!==false))throw new Error('HQ must configure this branch’s shift times first.');if(s.saving)return;s.saving=true;state.pending++;try{const result=await saveBranchSchedule(api,{branch:s.branch,year:s.year,month:s.monthNumber,days:s.days,original:s.original,actor:s.identity,effectiveFrom:s.effectiveFrom,expectedRevisionId:s.expectedRevisionId,revisionId:s.saveId ||= uniqueId('franchise-schedule'),authorize:b=>session().branch===b && session().email===s.identity && canVisit(session(),'schedule')});s.dirty=false;await api.loadScheduleFromCloud();await Swal.fire({title:'Schedule saved',text:result.publishedCurrent?'Your branch assignments are now available to staff.':'Your future plan is saved. Today’s live shift settings remain in effect.',icon:'success'});}finally{s.saving=false;state.pending--;}};
 define('sanctions',async r=>{
  const rows=(await read('hr_sanctions')).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)),c=table(r,'Notices & staff replies',['Issued','Staff','Incident','Severity','Status','Actions']);c.head.append(button('Issue notice',()=>api.openIssueSanctionModal(),'primary-button'));
  tools(c,'sanctions',rows,s=>'<tr>'+cell(esc(dateText(s.timestamp)))+cell(esc(s.staffName))+cell(esc(s.type))+cell(esc(s.severity))+cell(badge(s.status || 'Pending Reply',s.status==='Resolved'?'':'warning'))+cell(`<button class="table-action" data-notice="${esc(s.id)}">View & review</button>`)+'</tr>',{status:true});c.body.addEventListener('click',e=>{const id=e.target.closest('[data-notice]')?.dataset.notice;if(id)api.viewSanction(id).catch(showActionError);});
 });
 api.openIssueSanctionModal=async()=>{
  const profiles=(await read('cashiers')).filter(p=>p.status!=='Resigned'),id=uniqueId('notice');if(!profiles.length)throw new Error('No staff are registered for this branch.');
  const result=await form('Issue a staff notice',selectField('staff','Staff member',profiles.map(p=>[p.cashierName,p.cashierName]))+field('type','Incident type')+field('severity','Severity / notice level')+'<label class="full">Incident details<textarea id="form-details" placeholder="Describe the incident and the response required."></textarea></label>',async branch=>{const staffName=$('form-staff').value,details=$('form-details').value.trim(),type=$('form-type').value.trim(),severity=$('form-severity').value.trim();if(!details || !type || !severity)throw new Error('Complete the incident, severity and details.');await api.runTransaction(api.db,async tx=>{const ref=api.doc(api.db,'hr_sanctions',id),snap=await tx.get(ref);if(snap.exists())return;tx.set(ref,{branch,staffName,type,severity,details,status:'Pending Reply',issuedBy:session().cashierName,timestamp:api.serverTimestamp()});});return true;},{confirm:'Issue notice'});if(result.isConfirmed)await api.loadSanctionsDashboard();
 };
 api.viewSanction=async id=>{
  const ref=api.doc(api.db,'hr_sanctions',id),snap=await api.getDocFromServer(ref);if(!snap.exists() || snap.data().branch!==session().branch)throw new Error('This notice is outside your branch.');const d=snap.data();
  const answer=await Swal.fire({titleText:d.type || 'Staff notice',html:`<dl class="details-list"><div><dt>Staff</dt><dd>${esc(d.staffName)}</dd></div><div><dt>Status</dt><dd>${esc(d.status)}</dd></div></dl><div class="memo-content">${esc(d.details)}\n\nStaff reply:\n${esc(d.staffReply || d.reply || d.response || 'No reply yet.')}</div>`,showCancelButton:true,confirmButtonText:d.status==='Resolved'?'Close':'Mark resolved',cancelButtonText:'Close'});
  if(answer.isConfirmed && d.status!=='Resolved')await api.runTransaction(api.db,async tx=>{const current=await tx.get(ref);if(!current.exists() || current.data().branch!==session().branch)throw new Error('This notice changed. Reload it.');tx.update(ref,{status:'Resolved',resolvedBy:session().cashierName,resolvedAt:api.serverTimestamp()});});reader.reset();await api.loadSanctionsDashboard();
 };
 define('bulletin',async r=>{
  const notices=await globalRead('announcements',['active','==',true]),acks=await globalRead('acknowledgments',['staffName','==',session().cashierName]),target=notices.filter(a=>!a.targetType || a.targetType==='All' || a.targetType==='Branch' && a.targetBranch===session().branch || a.targetType==='Individual' && a.targetStaff===session().cashierName).sort((a,b)=>ms(b.timestamp)-ms(a.timestamp)),grid=element('div','announcement-grid');r.append(grid);
  for(const notice of target){const ack=acks.find(a=>a.announcementId===notice.id && (!a.branch || a.branch===session().branch)),item=element('div','announcement');item.append(element('h3','',notice.title || 'HQ notice'),element('small','',dateText(notice.timestamp)),element('p','',String(notice.message || '').slice(0,180)));const status=element('span','badge'+(ack?'':' warning'),ack?'Acknowledged':'Signature required');item.append(status,button('Read announcement',()=>api.viewAnnouncement(notice,ack)));grid.append(item);}if(!target.length)grid.append(element('div','empty','No active announcements for this branch.'));
 });
 api.viewAnnouncement=async(notice,ack)=>{
  const safeImage=url=>typeof url==='string' && (/^https:\/\//.test(url) || /^data:image\/(png|jpeg|webp);base64,/.test(url));
  const images=(notice.images || []).filter(safeImage).map(url=>`<img src="${esc(url)}" alt="Announcement attachment">`).join('');
  await Swal.fire({titleText:notice.title || 'HQ announcement',html:`<div class="memo-content">${esc(notice.subHeadline || '')}\n\n${esc(notice.message || '')}\n\n${esc(notice.footerMessage || '')}</div><div class="memo-images">${images}</div>${ack?'<p class="notice">Acknowledged '+esc(dateText(ack.timestamp))+'</p>':'<p class="notice">Sign below to acknowledge that you have read this notice.</p><canvas id="sigCanvas" width="600" height="300" aria-label="Draw your signature"></canvas><div class="button-row"><button type="button" id="clearSignature" class="secondary-button">Clear signature</button></div>'}`,width:760,showCancelButton:!ack,confirmButtonText:ack?'Close':'Save acknowledgment',showLoaderOnConfirm:true,allowOutsideClick:()=>!Swal.isLoading(),didOpen:()=>{
   if(ack)return;const canvas=$('sigCanvas'),ctx=canvas.getContext('2d');ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle='#173e32';let drawing=false;api.isSignatureBlank=true;const position=e=>{const box=canvas.getBoundingClientRect();return [(e.clientX-box.left)*canvas.width/box.width,(e.clientY-box.top)*canvas.height/box.height];};canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...position(e));});canvas.addEventListener('pointermove',e=>{if(!drawing)return;ctx.lineTo(...position(e));ctx.stroke();api.isSignatureBlank=false;});canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);$('clearSignature').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);api.isSignatureBlank=true;});
  },preConfirm:async()=>{
   if(ack)return true;if(api.isSignatureBlank){Swal.showValidationMessage('Draw your signature before saving.');return false;}
   const branch=session().branch,id='ack-'+encodeURIComponent(notice.id+'--'+session().email+'--'+branch),signature=$('sigCanvas').toDataURL('image/png');state.pending++;
   try{await api.runTransaction(api.db,async tx=>{const noticeRef=api.doc(api.db,'announcements',notice.id),ref=api.doc(api.db,'acknowledgments',id),[fresh,saved]=await Promise.all([tx.get(noticeRef),tx.get(ref)]);if(!fresh.exists() || fresh.data().active!==true)throw new Error('This notice is no longer active.');const a=fresh.data();if(a.targetType==='Branch' && a.targetBranch!==branch || a.targetType==='Individual' && a.targetStaff!==session().cashierName)throw new Error('This announcement is outside your audience.');if(saved.exists())return;tx.set(ref,{announcementId:notice.id,branch,email:session().email,staffName:session().cashierName,signature,timestamp:api.serverTimestamp()});});reader.reset();return true;}catch(error){Swal.showValidationMessage(error.message);return false;}finally{state.pending--;}
  }});if(state.route==='bulletin')await api.loadAnnouncements();
 };
 addEventListener('beforeunload',event=>{if(state.pending || state.schedule?.dirty || state.cart.length){event.preventDefault();event.returnValue='';}});
 api.franchiseState=state;
 installAppUpdates(state);
}

function installAppUpdates(state) {
 const $=id=>document.getElementById(id);let registration,reloading=false,requestedUpdate=false;
 const show=()=>{if(registration?.waiting)$('appUpdateCard').hidden=false;};
 async function check() {if(!('serviceWorker' in navigator))return;registration ||= await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});await registration.update();show();}
 $('checkAppUpdates').addEventListener('click',async()=>{try{await check();if(!registration?.waiting && globalThis.Swal)await Swal.fire({title:'App checked',text:'This device has the latest available Franchisee workspace.',icon:'success'});}catch(error){$('loginStatus').textContent='The update check could not connect. Check your connection and retry.';}});
 $('dismissUpdate').addEventListener('click',()=>$('appUpdateCard').hidden=true);
 $('applyAppUpdate').addEventListener('click',async()=>{if(state.pending || state.schedule?.dirty || state.cart.length){if(globalThis.Swal)await Swal.fire({title:'Save your work first',text:'Save the schedule and send or clear your supply request before updating.',icon:'info'});return;}requestedUpdate=true;registration?.waiting?.postMessage({type:'SKIP_WAITING'});});
 if(!('serviceWorker' in navigator))return;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading || !requestedUpdate)return;reloading=true;location.reload();});
 check().then(()=>{registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed' && navigator.serviceWorker.controller)show();});});}).catch(()=>{});
}
