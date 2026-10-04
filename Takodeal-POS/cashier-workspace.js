import {CASHIER_RELEASE,businessDate,dayWindow,attendanceRows,imageFor,updateBlocker,labelSettings,drinkLabels,parkedOrderDetails} from './cashier-data.js';
const el = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value)||0);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateTime = value => { const date = value?.toDate?.() || new Date(value); return Number.isFinite(+date) ? date.toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}) : 'Awaiting sync'; };
const titles = {pos:'Point of Sale',sales:'Shift Sales',mobilehub:'Mobile Hub',stockreq:'Stock Reports',prep:'Kitchen Prep',consumables:'Consumables',waste:'Log Waste',schedule:'Branch Schedule',bulletin:'Bulletin Board',remit:'Cash Remittance',printer:'Printer Hub',timeclock:'Time Clock',sop:'Daily SOPs'};
let attendanceStop = null, attendanceLogs = [], attendanceGeneration = 0, remitCursor = null, remitBranch = '', remitBusy = false;
let releaseRegistration, activateRequested = false;

function page(id,title,description) {
  const section = document.createElement('section'); section.id='view-'+id; section.className='view-container cashier-page';
  const header = document.createElement('header'); header.className='cashier-page-heading';
  const h = document.createElement('h1');h.textContent=title;
  const p = document.createElement('p');p.textContent=description;header.append(h,p);section.append(header);
  document.querySelector('.content-area').append(section); return section;
}
function mountLegacy(id,view,heading) {
  const root=el(id); root.classList.add('cashier-inline-panel'); root.style.display='block';
  view.append(root); const card=root.firstElementChild; card.classList.add('cashier-panel');
  const head=card.firstElementChild; head.classList.add('cashier-panel-heading');
  head.querySelector('h2').textContent=heading; head.querySelector('span[onclick]')?.remove();
}
function tableMessage(body,text,colspan=6) {body.innerHTML=`<tr><td colspan="${colspan}" class="cashier-empty">${escape(text)}</td></tr>`;}

function installRemittance() {
  const view=page('remit','Cash remittance','Send branch cash to HQ and review every transfer with its remitter, date and reference.');
  mountLegacy('remittanceModal',view,'New remittance');
  ['tabRemitForm','tabRemitHistory'].forEach(id=>{el(id).setAttribute('role','button');el(id).tabIndex=0;el(id).addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();el(id).click();}});});
  const history=el('remitHistorySection'); history.classList.add('cashier-table-scroll');
  history.querySelector('table').insertAdjacentHTML('afterbegin','<thead><tr><th>Sent at</th><th>Remitted by</th><th>Amount</th><th>Recipient / method</th><th>Sales period / reference</th><th>Status</th></tr></thead>');
  const more=document.createElement('button');more.id='remitLoadMore';more.type='button';more.className='cashier-button';more.textContent='Load older transfers';more.hidden=true;more.onclick=()=>loadRemittances(false);history.append(more);
  const open=window.openRemittanceModal;
  window.openRemittanceModal=async function(){window.switchView('remit');await open();el('remittanceModal').style.display='block';};
  window.loadRemittanceHistory=()=>loadRemittances(true);
  const switchTab=window.switchRemittanceTab;
  window.switchRemittanceTab=function(tab){const result=switchTab(tab);['Form','History'].forEach(name=>el('tabRemit'+name).setAttribute('aria-pressed',String((name==='Form')===(tab==='form'))));return result;};
  // The existing submit routine still verifies the PIN and audits the drawer.
  const submit=window.submitRemittance;
  window.submitRemittance=async function(){const start=el('remitStartDate').value,end=el('remitEndDate').value;
    try {dayWindow(start);dayWindow(end);if(start>end)throw new Error('The sales period end must be on or after its start.');}
    catch(error){window.alert(error.message);return;}
    window.cashierRemitSubmitting=true;
    try {await submit();el('remitPinCode').value='';}finally{window.cashierRemitSubmitting=false;}};
}
async function loadRemittances(reset) {
  if(remitBusy)return; remitBusy=true;
  const body=el('remitHistoryTableBody'), more=el('remitLoadMore');
  const branch=localStorage.getItem('takodeal_device_branch');
  if(reset || branch!==remitBranch){remitCursor=null;remitBranch=branch;tableMessage(body,'Loading transfer history…');}
  more.disabled=true;
  try {
    if(!branch)throw new Error('Choose a registered branch before viewing transfers.');
    const filters=[window.where('branch','==',branch),window.orderBy('timestamp','desc'),window.limit(50)];
    if(remitCursor)filters.push(window.startAfter(remitCursor));
    const snapshot=await window.getDocs(window.query(window.collection(window.db,'remittances'),...filters));
    if(branch!==localStorage.getItem('takodeal_device_branch'))return;
    if(reset || !remitCursor)body.replaceChildren();
    snapshot.forEach(docSnap=>{const d=docSnap.data();if(d.branch!==branch)return;const row=document.createElement('tr');
      row.innerHTML=`<td>${escape(dateTime(d.timestamp))}</td><td>${escape(d.cashier || d.remittedBy || 'Not recorded')}</td><td class="cashier-money">${money(d.amount)}</td><td>${escape(d.recipient || 'Not recorded')}<small>${escape(d.channel)}</small></td><td>${escape(d.salesPeriodStart || '—')} → ${escape(d.salesPeriodEnd || '—')}<small>${escape(d.referenceNumber || 'No reference')}</small></td><td><span class="cashier-badge">${escape(d.status || 'Pending')}</span></td>`;body.append(row);});
    remitCursor=snapshot.docs.at(-1) || remitCursor;more.hidden=snapshot.docs.length<50;
    if(!body.children.length)tableMessage(body,'No transfers recorded for this branch yet.');
  }catch(error){if(reset)tableMessage(body,'Transfer history could not be loaded. Check your connection and try again.');window.console.error('Remittance history:',error);more.hidden=false;more.textContent='Retry loading history';}
  finally{remitBusy=false;more.disabled=false;}
}
function installClock() {
  const view=page('timeclock','Time clock & attendance','Clock in securely and see today’s attendance across all branches. Times use Philippine local time.');
  const layout=document.createElement('div');layout.className='cashier-clock-layout';view.append(layout);
  mountLegacy('timeClockModal',layout,'Record your attendance');
  el('timeClockModal').style.display='none';
  const clockSection=document.createElement('section');clockSection.className='cashier-panel cashier-attendance';
  clockSection.innerHTML='<div class="cashier-panel-heading"><div><h2>Staff attendance</h2><p id="cashierDutyCount" aria-live="polite">Choose a day to see attendance.</p></div><button class="cashier-button" id="clockRefresh">Refresh</button></div><div class="cashier-filters"><label for="cashierAttendanceDay">Date<input type="date" id="cashierAttendanceDay"></label><label for="cashierAttendanceBranch">Branch<select id="cashierAttendanceBranch"><option value="All">All branches</option></select></label></div><div class="cashier-table-scroll"><table><thead><tr><th>Staff / branch</th><th>Time in</th><th>Time out</th><th>Status</th></tr></thead><tbody id="cashierAttendanceBody"></tbody></table></div><p class="cashier-help">Overnight shifts include the previous day’s clock-in. An unmatched punch is shown for review.</p>';
  layout.append(clockSection);el('cashierAttendanceDay').value=businessDate();
  el('cashierAttendanceDay').onchange=startAttendance;el('clockRefresh').onclick=startAttendance;el('cashierAttendanceBranch').onchange=paintAttendance;
  const open=window.openTimeClockModal;
  window.openTimeClockModal=async function(){window.switchView('timeclock');el('timeClockModal').style.display='block';startAttendance();await open();if(el('view-timeclock').classList.contains('active'))el('timeClockModal').style.display='block';else close();};
  // After a successful punch the original close stops the camera; the daily log stays visible.
  const close=window.closeTimeClock;
  window.closeTimeClock=function(){close();if(el('view-timeclock').classList.contains('active')){el('timeClockModal').style.display='block';el('clockVideo').srcObject=null;el('faceAiStatus').textContent='Camera paused. Restart it before your next clock-in.';}};
  const restart=document.createElement('button');restart.className='cashier-button';restart.textContent='Start camera';restart.onclick=()=>window.openTimeClockModal();el('faceAiStatus').after(restart);
}
function stopAttendance(){attendanceGeneration++;attendanceStop?.();attendanceStop=null;}
function startAttendance(){
  stopAttendance();const generation=attendanceGeneration, body=el('cashierAttendanceBody');tableMessage(body,'Loading attendance…',4);
  try {
    const {start,end}=dayWindow(el('cashierAttendanceDay').value);
    const q=window.query(window.collection(window.db,'attendance_logs'),window.where('timestamp','>=',new Date(start-86400000)),window.where('timestamp','<',new Date(end+20*3600000)));
    attendanceStop=window.onSnapshot(q,snap=>{if(generation!==attendanceGeneration)return;attendanceLogs=snap.docs.map(d=>({id:d.id,...d.data()}));
      const filter=el('cashierAttendanceBranch'),selected=filter.value;
      const branches=[...new Set(attendanceLogs.map(d=>d.branch).filter(Boolean))].sort();filter.replaceChildren(new Option('All branches','All'),...branches.map(b=>new Option(b,b)));filter.value=branches.includes(selected)?selected:'All';paintAttendance();
    },error=>{if(generation!==attendanceGeneration)return;tableMessage(body,'Attendance is unavailable. Check your connection and tap Refresh.',4);el('cashierDutyCount').textContent='Attendance could not be loaded';console.error('Attendance feed:',error);});
  }catch(error){tableMessage(body,error.message,4);}
}
function paintAttendance(){
  const day=el('cashierAttendanceDay').value, rows=attendanceRows(attendanceLogs,day,el('cashierAttendanceBranch').value), body=el('cashierAttendanceBody');
  body.replaceChildren();el('cashierDutyCount').textContent=`${rows.filter(r=>r.status==='On duty').length} on duty · ${rows.length} attendance records`;
  const time=value=>value==null?'—':new Date(value).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'});
  rows.forEach(row=>{const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${escape(row.name)}</strong><small>${escape(row.branch)}</small></td><td>${escape(time(row.in))}${row.carryIn?'<small>Previous day</small>':''}</td><td>${escape(time(row.out))}${row.out && businessDate(new Date(row.out))>day?'<small>Next day</small>':''}</td><td><span class="cashier-badge ${row.status==='On duty'?'is-duty':''}">${escape(row.status)}</span></td>`;body.append(tr);});
  if(!rows.length)tableMessage(body,'No attendance records for this date and branch.',4);
}
function installPrinterHub(){
  const view=page('printer','Printer hub','Manage receipt and preparation printers, plus a dedicated label workspace for drinks.');
  const devices=document.createElement('div');devices.className='cashier-printer-grid';view.append(devices);
  [['main','Receipt printer','Customer receipts and cash drawer'],['kitchen','Kitchen printer','Food preparation tickets'],['bar','Bar printer','Drink preparation tickets']].forEach(([role,name,help])=>{
    const card=document.createElement('section');card.className='cashier-panel cashier-printer-card';card.innerHTML=`<div class="cashier-printer-symbol" aria-hidden="true">▤</div><div class="cashier-panel-heading"><h2>${name}</h2></div><span class="cashier-badge" id="printerState-${role}">Not connected</span><p>${help}</p><div class="cashier-actions"><button class="cashier-button primary">Connect printer</button><button class="cashier-button">Test print</button></div>`;
    const buttons=card.querySelectorAll('button');buttons[0].onclick=()=>window.connectSpecificPrinter(role);buttons[1].onclick=event=>window.testPrint(role,event);devices.append(card);});
  const label= document.createElement('section');label.className='cashier-panel cashier-label-panel';
  label.innerHTML='<div class="cashier-panel-heading"><div><h2>Drink labels</h2><p>Clabel CT221B · 203 dpi</p></div><span class="cashier-badge">Dedicated label output</span></div><p class="cashier-help">Pair your CT221B in Clabel trade for Bluetooth printing. Export the label image below and import it into Clabel trade. On a computer with the Clabel driver installed, choose the CT221B in the print dialog. This label output is separate from receipt printers.</p><div class="cashier-label-layout"><div><div class="cashier-filters"><label for="labelWidth">Width (mm)<input id="labelWidth" type="number" min="25" max="54" value="50"></label><label for="labelHeight">Height (mm)<input id="labelHeight" type="number" min="20" max="100" value="30"></label></div><label for="labelDrink">Drink<input id="labelDrink" placeholder="e.g. Spanish Latte"></label><label for="labelCustomer">Customer / order<input id="labelCustomer" placeholder="e.g. Maya · OR 1042"></label><label for="labelDetail">Size / customizations<textarea id="labelDetail" rows="2" placeholder="Large · Less ice"></textarea></label><label for="labelQuantity">Copies<input id="labelQuantity" type="number" min="1" max="30" value="1"></label><div class="cashier-actions"><button id="saveLabelSettings" class="cashier-button">Save label size</button><button id="latestDrinkLabels" class="cashier-button">Use last receipt</button><a class="cashier-button" href="https://global.ctaiot.com/app/" target="_blank" rel="noopener">Clabel setup ↗</a></div></div><div><canvas id="drinkLabelPreview" aria-label="Drink label preview"></canvas><p id="labelPrintStatus" class="cashier-help" role="status">Preview updates as you type.</p><div class="cashier-actions"><button id="downloadDrinkLabel" class="cashier-button primary">Download label image</button><button id="printDrinkLabel" class="cashier-button">Print labels</button></div></div></div>';
  view.append(label);
  try{const saved=labelSettings(JSON.parse(localStorage.getItem('takodeal_drink_label_settings')||'{}'));el('labelWidth').value=saved.width;el('labelHeight').value=saved.height;}catch{/* Defaults stay usable when a saved size is invalid. */}
  for(const id of ['labelWidth','labelHeight','labelDrink','labelCustomer','labelDetail'])el(id).oninput=paintLabel;
  el('saveLabelSettings').onclick=()=>{try{localStorage.setItem('takodeal_drink_label_settings',JSON.stringify(currentLabelSettings()));el('labelPrintStatus').textContent='Label size saved for this device.';}catch(e){el('labelPrintStatus').textContent=e.message;}};
  el('latestDrinkLabels').onclick=()=>{const receipt=window.lastTransactionData, labels=drinkLabels(receipt,[],window.masterPOSData?.items || []);if(!labels.length){el('labelPrintStatus').textContent='No drink in the last receipt. Enter the drink details above.';return;}labelQueue=labels;showLabel(labels[0]);el('labelQuantity').value=1;el('labelPrintStatus').textContent=`${labels.length} drink labels prepared. Print labels to print this receipt’s drinks.`;};
  el('downloadDrinkLabel').onclick=()=>{if(!paintLabel())return;const link=document.createElement('a');link.download='takodeal-drink-label.png';link.href=el('drinkLabelPreview').toDataURL('image/png');link.click();};
  el('printDrinkLabel').onclick=printLabels;
  window.openPrinterManager=()=>{window.switchView('printer');refreshPrinters();paintLabel();};
  el('nav-printer').onclick=()=>window.openPrinterManager();
  window.setInterval(()=>{if(view.classList.contains('active'))refreshPrinters();},3000);
  paintLabel();
}
let labelQueue=[];
function currentLabelSettings(){return labelSettings({width:el('labelWidth').value,height:el('labelHeight').value});}
function currentLabel(){return {title:el('labelDrink').value.trim() || 'Your drink',customer:el('labelCustomer').value.trim(),detail:el('labelDetail').value.trim(),order:'',copy:''};}
function showLabel(label){el('labelDrink').value=label.title;el('labelCustomer').value=[label.customer,label.order].filter(Boolean).join(' · ');el('labelDetail').value=label.detail;paintLabel(false);}
function paintLabel(clear=true){
  if(clear)labelQueue=[];
  try{const {width,height,dpi}=currentLabelSettings(), canvas=el('drinkLabelPreview');canvas.width=Math.round(width/25.4*dpi);canvas.height=Math.round(height/25.4*dpi);renderLabel(canvas,currentLabel());return true;}
  catch(e){el('labelPrintStatus').textContent=e.message;return false;}
}
function renderLabel(canvas,label){
  const ctx=canvas.getContext('2d'),pad=16,w=canvas.width-32;
  ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';
  const font=Math.max(13,Math.min(24,canvas.height/10));let y=pad+font;
  const line=(text,size,bold=false,maxLines=2)=>{ctx.font=`${bold?'700':'400'} ${size}px Arial`;let words=String(text||'').split(/\s+/),current='',count=0;
    for(const word of words){if(ctx.measureText(current+' '+word).width>w && current){ctx.fillText(current,pad,y,w);y+=size+4;count++;current=word;if(count>=maxLines)return;}else current=(current+' '+word).trim();}
    if(current && y<canvas.height-12){ctx.fillText(current,pad,y,w);y+=size+4;}};
  line('TAKODEÁL',font,true,1);y+=4;line(label.title,font+2,true,2);line(label.detail,font*.8,false,2);line([label.customer,label.order,label.copy].filter(Boolean).join(' · '),font*.75,false,1);
}
function printLabels(){
  if(!paintLabel(false))return;
  const copies=Number(el('labelQuantity').value);if(!Number.isInteger(copies)||copies<1||copies>30){el('labelPrintStatus').textContent='Use 1–30 copies.';return;}
  const labels=labelQueue.length?labelQueue:Array.from({length:copies},()=>currentLabel()), {width,height,dpi}=currentLabelSettings();
  if(labels.length>100){el('labelPrintStatus').textContent='Print at most 100 labels in one batch.';return;}
  const frame=document.createElement('iframe');frame.className='cashier-print-frame';frame.title='Drink label print document';document.body.append(frame);
  const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><html><head><title>TAKODEÁL drink labels</title><style>@page{size:${width}mm ${height}mm;margin:0}body{margin:0}img{width:${width}mm;height:${height}mm;display:block;break-after:page}img:last-child{break-after:auto}</style></head><body></body></html>`);doc.close();
  labels.forEach(label=>{const canvas=document.createElement('canvas');canvas.width=Math.round(width/25.4*dpi);canvas.height=Math.round(height/25.4*dpi);renderLabel(canvas,label);const image=doc.createElement('img');image.src=canvas.toDataURL();doc.body.append(image);});
  Promise.all([...doc.images].map(img=>img.decode())).then(()=>{frame.contentWindow.focus();frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow.print();el('labelPrintStatus').textContent='Choose CT221B, actual size (100%), and your saved label dimensions in the print dialog.';}).catch(()=>{frame.remove();el('labelPrintStatus').textContent='Could not prepare the print sheet. Download the label image instead.';});
}
function refreshPrinters(){for(const role of ['main','kitchen','bar']){const state=el('printerState-'+role),connected=!!window[role+'PrinterChar'];state.textContent=connected?'Connected':'Not connected';state.classList.toggle('is-connected',connected);}}

function decorateInventory(){
  const catalogue=[...(window.masterPOSData?.items||[]),...Object.values(window.TK_CACHE?.inventoryByBranch||{}).flat()];
  document.querySelectorAll('.cons-ultra-card').forEach(card=>{
    const label=card.querySelector('.item-name-overlay'), name=label?.firstChild?.textContent?.trim(), item=(window.consumablesData||[]).find(i=>i.name===name);
    const media=card.querySelector('.item-card-bg');if(!item||!media)return;
    const image=imageFor(item,catalogue);media.style.backgroundImage=image?`url(${JSON.stringify(image)})`:'';
    let fallback=media.querySelector('.cashier-image-fallback');if(!fallback){fallback=document.createElement('span');fallback.className='cashier-image-fallback';media.append(fallback);}fallback.textContent=name?.slice(0,2).toUpperCase() || 'TK';fallback.hidden=!!image;
    card.setAttribute('role','button');card.tabIndex=0;
    if(!card.dataset.cashierKeyboard){card.dataset.cashierKeyboard='true';card.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();card.click();}});}
  });
}
function installTheme(){
  document.body.classList.add('cashier-orange');
  document.querySelectorAll('.nav-item').forEach(nav=>{nav.setAttribute('role','button');nav.tabIndex=0;nav.title=nav.querySelector('.nav-item-text')?.textContent.trim()||'';nav.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();nav.click();}});
    const icon=nav.querySelector('.nav-icon-wrapper > span:first-child') || nav.querySelector(':scope > span');if(icon && !icon.id){icon.textContent=({'nav-pos':'PS','nav-sales':'SL','nav-remit':'RM','nav-staffreq':'RQ','nav-sop':'SP','nav-prep':'KP','nav-consumables':'SU','nav-mobilehub':'MO','nav-stockreq':'ST','nav-waste':'WS','nav-timeclock':'TC','nav-schedule':'SC','nav-grab':'GR','nav-bulletin':'BB','nav-printer':'PR'})[nav.id] || nav.title.slice(0,2).toUpperCase();icon.setAttribute('aria-hidden','true');}
  });
  const banner=el('unverifiedWarningBanner');banner.setAttribute('role','status');banner.classList.add('cashier-payment-notice');
  document.querySelector('.top-bar').after(banner);
  banner.querySelector('span:first-child').textContent='!';
  const count=el('unverifiedCountText');count.parentElement.replaceChildren(document.createTextNode('Payment review pending · '),count,document.createTextNode(' payments'));
  banner.querySelector(':scope > div > div:last-child').textContent='A manager must verify these digital payments in HQ before the shift can close.';
  const login=el('loginOverlay'), card=login.querySelector(':scope > div:last-child');card.classList.add('cashier-login-card');
  card.querySelector('h2').insertAdjacentHTML('afterend','<p class="cashier-login-subtitle">Cashier workspace</p>');
  login.append(el('ownerAccessBtnContainer'));el('ownerAccessBtnContainer').style.position='static';
  el('loginPasswordInput').setAttribute('aria-label','Security PIN or password');
  el('btnSubmitPin').textContent='Sign in securely';
  const printerNav=el('nav-printer')?.querySelector('.nav-item-text');if(printerNav)printerNav.textContent='Printer Hub';
  const settings=document.querySelector('.top-bar-right button');if(settings)settings.childNodes.forEach(n=>{if(n.nodeType===3)n.textContent=n.textContent.replace('⚙️','');});
  const original=window.switchView;
  window.switchView=function(view){
    if(!titles[view])return original(view);
    if(view!=='timeclock'){stopAttendance();window.closeTimeClock?.();el('timeClockModal').style.display='none';}
    const result=original(view);el('topBarTitle').textContent=titles[view];document.querySelectorAll('.nav-item').forEach(n=>n.setAttribute('aria-current',String(n.id==='nav-'+view)));
    return result;
  };
  for(const name of ['loadConsumablesView','loadKitchenPrep']){const old=window[name];if(typeof old==='function')window[name]=async function(...args){const result=await old.apply(this,args);decorateInventory();return result;};}
  document.addEventListener('keydown',e=>{if(e.key==='Escape')el('posSettingsDropdown').style.display='none';});
  el('topBarTitle').textContent=titles.pos;
}
function installUpdates(){
  const banner=el('updateAppBanner');banner.removeAttribute('onclick');banner.className='cashier-update-notice';
  document.querySelector('.top-bar').after(banner);
  banner.innerHTML='<div><strong id="cashierUpdateTitle">Cashier update available</strong><span id="cashierUpdateText">Finish or park the current order, then update this app.</span></div><button class="cashier-button primary" id="cashierUpdateNow">Check & update</button><button class="cashier-button" id="cashierUpdateDismiss" aria-label="Dismiss update notice">×</button>';
  el('cashierUpdateDismiss').onclick=()=>{banner.style.display='none';};
  window.checkCashierUpdate=async function(){
    const blocked=updateBlocker(window);if(blocked){banner.style.display='flex';el('cashierUpdateText').textContent=blocked;return;}
    if(!navigator.onLine){banner.style.display='flex';el('cashierUpdateText').textContent='Connect to the internet to download the update. Saved offline sales stay on this device.';return;}
    try{
      releaseRegistration ||= await navigator.serviceWorker?.getRegistration();
      if(!releaseRegistration){el('cashierUpdateText').textContent='No installed worker yet. Reopen the app when online to complete installation.';banner.style.display='flex';return;}
      await releaseRegistration.update();
      if(releaseRegistration.waiting){activateRequested=true;releaseRegistration.waiting.postMessage({type:'TK_ACTIVATE_UPDATE'});}
      else {el('cashierUpdateText').textContent=releaseRegistration.installing?'The update is downloading. Tap Check & update once it is ready.':'This device has the latest Cashier app.';banner.style.display='flex';}
    }catch(error){el('cashierUpdateText').textContent='Update could not download. Check the connection and try again. Your saved data is retained.';banner.style.display='flex';console.error(error);}
  };
  el('cashierUpdateNow').onclick=()=>window.checkCashierUpdate();
  window.forceAppUpdate=window.manualHardUpdate=window.executeCacheWipe=()=>window.checkCashierUpdate();
  const ready=registration=>{releaseRegistration=registration;const show=()=>{window.CASHIER_UPDATE_WAITING=true;el('cashierUpdateTitle').textContent='Cashier update ready';el('cashierUpdateText').textContent='Finish or park the current order, then update this app. Saved offline sales and printer settings are retained.';banner.style.display='flex';};
    if(registration.waiting)show();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed' && navigator.serviceWorker.controller)show();});});};
  navigator.serviceWorker?.getRegistration().then(reg=>{if(reg)ready(reg);});
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(activateRequested && !updateBlocker(window)){if(window.TARGET_UPDATE_VERSION)localStorage.setItem('takodeal_local_version',String(window.TARGET_UPDATE_VERSION));location.reload();}});
  window.addEventListener('cashier-worker-ready',event=>ready(event.detail));
  window.setInterval(()=>{if(document.visibilityState==='visible' && navigator.onLine)releaseRegistration?.update().catch(()=>{});},15*60*1000);
  if(localStorage.getItem('takodeal_cashier_seen_release')!==CASHIER_RELEASE){el('cashierUpdateTitle').textContent='Cashier workspace updated';el('cashierUpdateText').textContent='Tablet spacing, parked-order details, shift windows and delivery-platform colors are updated.';banner.style.display='flex';localStorage.setItem('takodeal_cashier_seen_release',CASHIER_RELEASE);}
}
function install(){installTheme();installRemittance();installClock();installPrinterHub();installTabletControls();installParkedOrders();installUpdates();}
if(document.readyState==='complete')install();else window.addEventListener('load',install,{once:true});

function installTabletControls(){
  const sidebar=el('mainSidebar'), top=document.querySelector('.top-bar');
  const toggle=document.createElement('button');toggle.id='cashierSidebarToggle';toggle.type='button';toggle.className='cashier-button';toggle.textContent='☰';toggle.setAttribute('aria-label','Toggle navigation');toggle.setAttribute('aria-controls','mainSidebar');top.prepend(toggle);
  if(matchMedia('(min-width:769px) and (max-width:1180px)').matches)sidebar.classList.add('collapsed');
  const reflect=()=>{const expanded=matchMedia('(max-width:768px)').matches?sidebar.classList.contains('tk-mobile-menu-open'):!sidebar.classList.contains('collapsed');if(sidebar.classList.contains('cashier-sidebar-expanded')!==expanded)sidebar.classList.toggle('cashier-sidebar-expanded',expanded);toggle.setAttribute('aria-expanded',String(expanded));};
  toggle.onclick=()=>{if(matchMedia('(max-width:768px)').matches)sidebar.classList.toggle('tk-mobile-menu-open');else sidebar.classList.toggle('collapsed');reflect();};
  new MutationObserver(reflect).observe(sidebar,{attributes:true,attributeFilter:['class']});reflect();
  const platform=el('posPlatformSelect');const tint=()=>{document.body.dataset.cashierPlatform=platform.value;};platform.addEventListener('change',tint);
  const switchPlatform=window.switchPosPlatform;
  if(typeof switchPlatform==='function')window.switchPosPlatform=function(...args){const result=switchPlatform.apply(this,args);tint();return result;};tint();
  const shift=el('btnTopShift');const showShift=()=>{const active=/active shift/i.test(shift.textContent);const text=shift.textContent.replace(/[🟢🔴🟠]/gu,'').trim();if(text!==shift.textContent)shift.textContent=text;shift.dataset.shiftState=active?'active':'closed';};new MutationObserver(showShift).observe(shift,{childList:true,subtree:true});showShift();
  for(const id of ['shiftModal','endShiftModal','expenseModal','checkoutModal','parkedModal']){
    const root=el(id);root.classList.add('cashier-dialog');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
    const card=root.firstElementChild;card.classList.add('cashier-dialog-card');
    card.firstElementChild.classList.add('cashier-dialog-heading');
    const title=card.firstElementChild.firstElementChild;if(title){title.id ||= 'cashier-'+id+'-title';root.setAttribute('aria-labelledby',title.id);}
    if(id!=='parkedModal')card.lastElementChild.classList.add('cashier-dialog-footer');
    root.querySelectorAll('.close-modal,span[onclick*="style.display"],span[onclick*="closeModal("]').forEach(close=>{close.setAttribute('role','button');close.setAttribute('aria-label','Close window');close.tabIndex=0;close.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();close.click();}});});
  }
  el('endShiftModal').querySelector('.modal-body').classList.add('cashier-clearance-grid');
  el('endShiftModal').querySelectorAll('.modal-body > div').forEach((card,i)=>{card.classList.add('cashier-clearance-card');card.querySelector('h3').textContent=['1. Cash drawer count','2. Kitchen preparation','3. Required stock count'][i];});
  el('expenseModal').firstElementChild.children[1].classList.add('cashier-expense-body');
  el('expenseModal').firstElementChild.firstElementChild.firstElementChild.textContent='Branch expenses';
  el('btnCloseShiftSubmit').textContent='Begin Z-Reading';
  el('shiftViewClose').querySelector('button[onclick="openExpenseModal()"]').textContent='Record expense';
  el('endShiftModal').querySelector('button[onclick*="MASTER_CloseShift"]').textContent='Confirm & end shift';
  for(const id of ['expSearchInput','expQtyInput','expAmtInput','expUomSelect','expenseReceiptPhoto']){
    const input=el(id),label=input.previousElementSibling?.tagName==='LABEL'?input.previousElementSibling:input.parentElement.querySelector(':scope > label');if(label)label.htmlFor=id;
  }
}
function installParkedOrders(){
  const root=el('parkedModal'),list=el('parkedListContainer');let generation=0;
  root.firstElementChild.firstElementChild.firstElementChild.textContent='Parked orders';
  window.showParkedOrders=async function(){
    const run=++generation,branch=localStorage.getItem('takodeal_device_branch')||'Unknown';root.style.display='flex';list.textContent='Loading parked orders…';
    try{
      const orders=await window.getParkedOrders(branch);if(run!==generation)return;window.currentParkedOrdersList=orders;list.replaceChildren();
      const summary=document.createElement('p');summary.className='cashier-park-summary';summary.textContent=`${orders.length} unpaid orders · ${branch}`;list.append(summary);
      if(!orders.length){summary.textContent='No parked orders for this branch.';return;}
      orders.forEach(order=>{const d=parkedOrderDetails(order),card=document.createElement('article');card.className='cashier-park-card';card.dataset.platform=order.platform||'Standard';
        card.innerHTML=`<header><strong>${escape(d.name)}</strong><strong>${money(d.total)}</strong></header><div class="cashier-park-meta"><span>Parked ${escape(d.parkedAt)}</span><span>By ${escape(d.cashier)} · ${escape(d.platform)} · ${escape(d.type)}</span></div>`;
        const items=document.createElement('div');items.className='cashier-park-items';
        d.items.forEach(item=>{const row=document.createElement('div');row.className='cashier-park-item';row.innerHTML=`<div><strong>${item.qty}× ${escape(item.name)}</strong><small>${escape([item.variant,...item.addons].filter(Boolean).join(' · '))}</small>${item.notes?`<p>${escape(item.notes)}</p>`:''}</div><strong>${money(item.total)}</strong>`;items.append(row);});card.append(items);
        const actions=document.createElement('footer');actions.className='cashier-actions';
        [['Reprint',()=>window.printParkedReceipt(order.id),''],['Resume & pay',()=>window.resumeOrder(order.id),'primary'],['Remove',()=>window.deleteParkedOrderManually(order.id),'danger']].forEach(([text,handler,style])=>{const button=document.createElement('button');button.type='button';button.className='cashier-button '+style;button.textContent=text;button.onclick=handler;actions.append(button);});card.append(actions);list.append(card);
      });
    }catch(error){if(run===generation){list.textContent='Parked orders could not load. Check the connection and try again.';const button=document.createElement('button');button.className='cashier-button';button.textContent='Retry';button.onclick=()=>window.showParkedOrders();list.append(button);}console.error('Parked orders:',error);}
  };
}
