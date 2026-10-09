import {CASHIER_RELEASE,businessDate,dayWindow,attendanceRows,imageFor,updateBlocker,labelSettings,drinkLabels,parkedOrderDetails} from './cashier-data.js';
import {installCartLayout} from './cart-layout.js';
import {installSalesActions} from './sales-actions.js';
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
    if(window.cashierRemitSubmitting)return;
    try {dayWindow(start);dayWindow(end);if(start>end)throw new Error('The sales period end must be on or after its start.');}
    catch(error){window.alert(error.message);return;}
    await submit();el('remitPinCode').value='';};
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
      row.innerHTML=`<td>${escape(dateTime(d.timestamp))}</td><td>${escape(d.cashier || d.cashierName || d.remittedBy || 'Not recorded')}</td><td class="cashier-money">${money(d.amount)}</td><td>${escape(d.recipient || 'Not recorded')}<small>${escape(d.channel)}</small></td><td>${escape(d.salesPeriodStart || '—')} → ${escape(d.salesPeriodEnd || '—')}<small>${escape(d.referenceNumber || 'No reference')}</small></td><td><span class="cashier-badge">${escape(d.status || 'Pending')}</span></td>`;body.append(row);});
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
  const help=document.createElement('section');help.className='cashier-panel cashier-printer-setup';
  help.innerHTML='<div><h2>GOOJPRT JP-58H · 58mm receipts</h2><p class="cashier-help">Turn the printer on and load paper. Start with a text-only test. Branch receipt content, logo and paper size come from Access & branch management in the Owner app.</p></div><label for="cashierPrinterMode">Print using<select id="cashierPrinterMode"><option value="ble">Direct Bluetooth</option><option value="rawbt">Android printer app (RawBT)</option></select></label><p id="cashierPrinterModeHelp" class="cashier-help"></p><a id="cashierPrinterBridgeSetup" class="cashier-button" href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter" target="_blank" rel="noopener" hidden>Get RawBT for Android ↗</a>';
  view.append(help);
  el('cashierPrinterMode').onchange=()=>{try{window.setPrinterMode(el('cashierPrinterMode').value);refreshPrinters();}catch(error){window.Swal.fire('Printer setup',error.message,'info');refreshPrinters();}};
  const devices=document.createElement('div');devices.className='cashier-printer-grid';view.append(devices);
  [['main','Receipt printer','Customer receipts and cash drawer'],['kitchen','Kitchen printer','Food preparation tickets'],['bar','Bar printer','Drink preparation tickets']].forEach(([role,name,help])=>{
    const logo=role==='main'?'<div class="cashier-printer-logo"><label for="cashierReceiptLogoMode">Logo on receipts<select id="cashierReceiptLogoMode" aria-describedby="cashierReceiptLogoHelp cashierPrinterLogoSafety"><option value="compatible">Small compatible logo</option><option value="raster">Raster logo</option><option value="none">Text only (no logo)</option></select></label><p id="cashierReceiptLogoHelp" class="cashier-help"></p><p id="cashierPrinterLogoSafety" class="cashier-help">Saved on this device. Test text and Test logo do not create a sale, cut paper or open the cash drawer. Check the printed paper before using a logo on receipts.</p><p id="printerLogoResult-main" class="cashier-help" role="status">Last logo test: No test yet. Paper output is not confirmed.</p></div>':'';
    const card=document.createElement('section');card.className='cashier-panel cashier-printer-card';card.innerHTML=`<div class="cashier-printer-symbol" aria-hidden="true">🖨️</div><div class="cashier-panel-heading"><h2>${name}</h2></div><span class="cashier-badge" id="printerState-${role}">Not connected</span><p>${help}</p><p id="printerResult-${role}" class="cashier-help" role="status">No test yet. Use Test text to check paper output.</p><details class="cashier-printer-details"><summary>Connection details</summary><p id="printerDetails-${role}"></p></details>${logo}<div class="cashier-actions"><button type="button" class="cashier-button primary">Connect printer</button><button type="button" class="cashier-button">Test text</button><button type="button" class="cashier-button" id="printerSearch-${role}">Search again</button>${role==='main'?'<button type="button" class="cashier-button" id="printerLogoTest-main">Test logo</button>':''}</div>`;
    const buttons=card.querySelectorAll('button');buttons[0].onclick=()=>window.connectSpecificPrinter(role);buttons[1].onclick=event=>window.testPrint(role,event);buttons[2].onclick=()=>window.connectSpecificPrinter(role,{replace:true});devices.append(card);});
  el('cashierReceiptLogoMode').onchange=()=>{try{if(typeof window.setReceiptLogoMode!=='function')throw Error('The logo setting is unavailable. Update the app and reopen Printer Hub.');window.setReceiptLogoMode(el('cashierReceiptLogoMode').value);}catch(error){window.Swal.fire('Logo setting',error.message,'info');}finally{refreshPrinters();}};
  el('printerLogoTest-main').onclick=event=>{if(typeof window.testPrinterLogo!=='function')return window.Swal.fire('Logo test','The logo test is unavailable. Update the app and reopen Printer Hub.','info');return window.testPrinterLogo('main',event);};
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
  refreshPrinters();
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
function refreshPrinters(){for(const role of ['main','kitchen','bar']){
  const badge=el('printerState-'+role);if(!badge)continue;
  const state=window.getPrinterDiagnostics?.(role) || window.getPrinterState?.(role) || {connected:false,status:'not-connected',mode:'ble'};
  const bridge=state.mode==='rawbt';
  if(el('cashierPrinterMode'))el('cashierPrinterMode').value=bridge?'rawbt':'ble';
  if(el('cashierPrinterModeHelp'))el('cashierPrinterModeHelp').textContent=bridge?'Pair JP-58H in Android Bluetooth settings, select it in RawBT, and use ESC/POS with 58mm paper. Return here to test. The printer app opens for each print job.':'Direct Bluetooth needs a compatible printer data channel. If JP-58H is missing or sends no paper, choose Android printer app (RawBT) on your tablet.';
  if(el('cashierPrinterBridgeSetup'))el('cashierPrinterBridgeSetup').hidden=!bridge;
  badge.textContent=bridge?'Android printer app selected':state.connected?'Data channel ready':({'connecting':'Connecting…','reconnecting':'Reconnecting automatically','saved':'Pairing saved · waiting for printer','error':'Connection needs attention','unsupported':'Connection needs attention'})[state.status] || 'Not connected';
  badge.classList.toggle('is-connected',state.connected);badge.setAttribute('role','status');
  const button=badge.closest('.cashier-printer-card').querySelector('button');
  button.disabled=state.status==='connecting';button.textContent=bridge?'Setup instructions':state.connected?'Check connection':'Connect printer';
  if(el('printerSearch-'+role))el('printerSearch-'+role).hidden=bridge;
  const result=el('printerResult-'+role);if(result){result.textContent=state.error || state.result?.message || 'No test yet. Use Test text to check paper output.';result.dataset.state=state.error?'error':state.result?.status || 'idle';}
  if(role==='main'){
    const selected=window.getReceiptLogoMode?.() || 'compatible',mode=['compatible','raster','none'].includes(selected)?selected:'compatible';
    const logoSelect=el('cashierReceiptLogoMode');if(logoSelect && logoSelect.value!==mode)logoSelect.value=mode;
    const logoHelp=el('cashierReceiptLogoHelp'),explanation=({compatible:'Recommended for 58mm printers. Uses a small monochrome logo. Test it before printing receipts.',raster:'For printers that support raster images. If text prints but this logo does not, select Small compatible logo or Text only.',none:'Receipts on this device print without a logo. Select a logo mode before running a logo test.'})[mode];
    if(logoHelp && logoHelp.textContent!==explanation)logoHelp.textContent=explanation;
    const lastLogo=el('printerLogoResult-main'),logoResult=state.logoResult;
    if(lastLogo){const message='Last logo test: '+(logoResult?.message || 'No test yet. Paper output is not confirmed.');if(lastLogo.textContent!==message)lastLogo.textContent=message;lastLogo.dataset.state=logoResult?.status || 'idle';}
  }
  const details=el('printerDetails-'+role);if(details)details.textContent=[state.name && 'Printer: '+state.name, state.service && 'Service: '+state.service, state.endpoint && 'Data channel: '+state.endpoint, state.result?.bytes && 'Last job: '+state.result.bytes+' bytes', state.error && 'Connection: '+state.error].filter(Boolean).join('\n') || 'No printer selected on this device.';
}}
document.addEventListener('cashier-printer-state',refreshPrinters);
document.addEventListener('cashier-printer-result',refreshPrinters);

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
    const icon=nav.querySelector('.nav-icon-wrapper > span:first-child') || nav.querySelector(':scope > span');if(icon && !icon.id){icon.textContent=({'nav-pos':'🖥️','nav-sales':'🧾','nav-remit':'💸','nav-staffreq':'📝','nav-sop':'📋','nav-prep':'🔪','nav-consumables':'🧹','nav-mobilehub':'📱','nav-stockreq':'📦','nav-waste':'🗑️','nav-timeclock':'📸','nav-schedule':'📅','nav-grab':'🟢','nav-bulletin':'📢','nav-printer':'🖨️','nav-deliveries':'🚚'})[nav.id] || icon.textContent;icon.classList.add('cashier-nav-icon');icon.setAttribute('aria-hidden','true');}
  });
  const banner=el('unverifiedWarningBanner');banner.setAttribute('role','status');banner.classList.add('cashier-payment-notice');
  document.querySelector('.top-bar').after(banner);
  banner.querySelector('span:first-child').textContent='!';
  const count=el('unverifiedCountText');count.parentElement.replaceChildren(document.createTextNode('Payment review pending · '),count,document.createTextNode(' payments'));
  banner.querySelector(':scope > div > div:last-child').textContent='A manager must verify these digital payments in HQ before the shift can close.';
  const login=el('loginOverlay'), card=login.querySelector(':scope > div:last-child');card.classList.add('cashier-login-card');
  const brand=document.createElement('header');brand.className='cashier-login-brand';
  const identity=document.createElement('div');identity.className='cashier-login-identity';
  const logo=card.firstElementChild, heading=card.querySelector('h2'), branch=el('loginBranchDisplay');
  brand.append(logo,identity);identity.append(heading);heading.insertAdjacentHTML('afterend','<p class="cashier-login-subtitle">Cashier workspace</p>');identity.append(branch);card.prepend(brand);
  const update=card.querySelector('[onclick="window.manualHardUpdate()"]');if(update){update.classList.add('cashier-login-update');update.setAttribute('role','button');update.tabIndex=0;update.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();update.click();}});}
  const loginActions=document.createElement('div');loginActions.className='cashier-login-actions';if(update)loginActions.append(update);loginActions.append(el('ownerAccessBtnContainer'));card.append(loginActions);el('ownerAccessBtnContainer').style.position='static';
  const ranking=el('loginRankingWidget'), aside=document.createElement('aside'), details=document.createElement('details'), summary=document.createElement('summary');
  aside.className='cashier-login-ranking';aside.setAttribute('aria-label','Daily branch ranking');summary.textContent="Today's branch ranking";details.append(summary,ranking);aside.append(details);login.append(aside);
  const rankingMedia=matchMedia('(min-width:850px) and (min-height:520px)');const rankingLayout=()=>{details.open=rankingMedia.matches;};rankingMedia.addEventListener('change',rankingLayout);rankingLayout();
  const rankingVisibility=()=>{aside.hidden=ranking.style.display==='none';};new MutationObserver(rankingVisibility).observe(ranking,{attributes:true,attributeFilter:['style']});rankingVisibility();
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
function showCashierUpdateNotice(state,title,message){
  const banner=el('updateAppBanner');banner.dataset.updateState=state;
  el('cashierUpdateTitle').textContent=title;el('cashierUpdateText').textContent=message;
  el('cashierUpdateSymbol').textContent=['current','updated'].includes(state)?'✓':'↻';
  el('cashierUpdateNow').textContent=state==='ready'?'Update app':'Check again';
  el('cashierUpdateNow').disabled=state==='checking';
  banner.style.display='flex';
}
function installUpdates(){
  const banner=el('updateAppBanner');banner.removeAttribute('onclick');banner.className='cashier-update-notice';
  document.body.append(banner);banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
  banner.innerHTML='<div class="cashier-update-symbol" id="cashierUpdateSymbol" aria-hidden="true">↻</div><div class="cashier-update-copy"><strong id="cashierUpdateTitle">Check for a Cashier update</strong><span id="cashierUpdateText">Finish or park your order before updating.</span></div><button id="cashierUpdateClose" aria-label="Dismiss update notice">×</button><div class="cashier-update-actions"><button class="cashier-button" id="cashierUpdateDismiss">Dismiss</button><button class="cashier-button primary" id="cashierUpdateNow">Check for update</button></div>';
  el('cashierUpdateDismiss').onclick=()=>{banner.style.display='none';};
  el('cashierUpdateClose').onclick=el('cashierUpdateDismiss').onclick;
  window.showCashierUpdateNotice=showCashierUpdateNotice;
  window.checkCashierUpdate=async function(){
    const blocked=updateBlocker(window);if(blocked){showCashierUpdateNotice('blocked','Finish your current work',blocked);return;}
    if(!navigator.onLine){showCashierUpdateNotice('offline','Waiting for a connection','Connect to the internet to check for an update. Saved offline sales stay on this device.');return;}
    showCashierUpdateNotice('checking','Checking for updates','Please wait while we check the latest Cashier app.');
    try{
      releaseRegistration ||= await navigator.serviceWorker?.getRegistration();
      if(!releaseRegistration){showCashierUpdateNotice('error','App setup is incomplete','Reopen the app when online to finish installation.');return;}
      await releaseRegistration.update();
      const changed=updateBlocker(window);if(changed){showCashierUpdateNotice('blocked','Finish your current work',changed);return;}
      if(releaseRegistration.waiting){activateRequested=true;releaseRegistration.waiting.postMessage({type:'TK_ACTIVATE_UPDATE'});showCashierUpdateNotice('checking','Opening the updated app','Your saved offline sales and printer settings are retained.');}
      else if(releaseRegistration.installing)showCashierUpdateNotice('downloading','Update downloading','Keep the app open. We will let you know when it is ready.');
      else {window.CASHIER_UPDATE_WAITING=false;showCashierUpdateNotice('current','Your Cashier app is up to date','This device has the latest version. You are ready to continue.');}
    }catch(error){showCashierUpdateNotice('error','Could not check for updates','Check your connection and try again. Your saved data is retained.');console.error(error);}
  };
  el('cashierUpdateNow').onclick=()=>window.checkCashierUpdate();
  window.forceAppUpdate=window.manualHardUpdate=window.executeCacheWipe=()=>window.checkCashierUpdate();
  const ready=registration=>{releaseRegistration=registration;const show=()=>{window.CASHIER_UPDATE_WAITING=true;showCashierUpdateNotice('ready','Cashier update ready','Finish or park your order, then update. Saved offline sales and printer settings are retained.');};
    if(registration.waiting)show();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed' && navigator.serviceWorker.controller)show();});});};
  navigator.serviceWorker?.getRegistration().then(reg=>{if(reg)ready(reg);});
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(activateRequested && !updateBlocker(window)){if(window.TARGET_UPDATE_VERSION)localStorage.setItem('takodeal_local_version',String(window.TARGET_UPDATE_VERSION));location.reload();}});
  window.addEventListener('cashier-worker-ready',event=>ready(event.detail));
  window.setInterval(()=>{if(document.visibilityState==='visible' && navigator.onLine)releaseRegistration?.update().catch(()=>{});},15*60*1000);
  if(localStorage.getItem('takodeal_cashier_seen_release')!==CASHIER_RELEASE){showCashierUpdateNotice('updated','Cashier workspace updated','New clock-ins preserve their scheduled start and end times for later payroll review. Attendance also records its source app and device. Temporary inventory skips still require HQ review.');localStorage.setItem('takodeal_cashier_seen_release',CASHIER_RELEASE);}
}
function install(){installTheme();installRemittance();installClock();installPrinterHub();installTabletControls();installParkedOrders();installUpdates();installSalesActions();}
if(document.readyState==='complete')install();else window.addEventListener('load',install,{once:true});

function installTabletControls(){
  installCartLayout(document,window);
  installCashierViewport(document,window);
  const sidebar=el('mainSidebar'), top=document.querySelector('.top-bar');
  const toggle=document.createElement('button');toggle.id='cashierSidebarToggle';toggle.type='button';toggle.className='cashier-button';toggle.textContent='☰';toggle.setAttribute('aria-label','Toggle navigation');toggle.setAttribute('aria-controls','mainSidebar');top.prepend(toggle);
  if(matchMedia('(min-width:769px) and (max-width:1180px)').matches)sidebar.classList.add('collapsed');
  const reflect=()=>{const expanded=matchMedia('(max-width:768px)').matches?sidebar.classList.contains('tk-mobile-menu-open'):!sidebar.classList.contains('collapsed');if(sidebar.classList.contains('cashier-sidebar-expanded')!==expanded)sidebar.classList.toggle('cashier-sidebar-expanded',expanded);toggle.setAttribute('aria-expanded',String(expanded));};
  toggle.onclick=()=>{if(matchMedia('(max-width:768px)').matches)sidebar.classList.toggle('tk-mobile-menu-open');else sidebar.classList.toggle('collapsed');reflect();};
  new MutationObserver(reflect).observe(sidebar,{attributes:true,attributeFilter:['class']});reflect();
  window.addEventListener('resize',reflect);
  sidebar.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.classList.contains('tk-mobile-menu-open')){sidebar.classList.remove('tk-mobile-menu-open');reflect();toggle.focus();}});
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
  const closeModal=window.closeModal;
  window.closeModal=function(id){if(id==='endShiftModal')window.saveCurrentShiftCloseDraft?.();return closeModal(id);};
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

// The keyboard can cover a fixed app shell without resizing its layout viewport.
// Bound only the stock scroller and navigation; never resize or rerender the POS.
export function installCashierViewport(doc=document,win=window){
  const stock=doc.getElementById('view-stockreq'),sidebar=doc.getElementById('mainSidebar');
  const viewport=win.visualViewport,controls=stock?.querySelector('.cashier-stock-controls');
  let frame=null,disposed=false;
  const listeners=[];
  const stockClass=(name,enabled)=>{if(stock&&stock.classList.contains(name)!==enabled)stock.classList.toggle(name,enabled);};
  const listen=(target,type,handler)=>{if(target?.addEventListener){target.addEventListener(type,handler);listeners.push(()=>target.removeEventListener(type,handler));}};
  const clearStock=()=>{stock?.style.removeProperty('--cashier-stock-visible-height');stockClass('cashier-stock-viewport',false);stockClass('cashier-stock-compact-input',false);};
  const refresh=()=>{
    if(disposed)return;
    const height=Number(viewport?.height||win.innerHeight),offset=Math.max(0,Number(viewport?.offsetTop||0));
    if(!Number.isFinite(height)||height<=0)return;
    // Pinch zoom is deliberate navigation. Do not counteract its pan or scale.
    if(viewport&&Math.abs(Number(viewport.scale||1)-1)>.05){clearStock();return;}
    const bottom=offset+height;
    if(sidebar){
      const narrow=win.matchMedia('(max-width:768px)').matches;
      const topBar=doc.querySelector('.top-bar');
      let top=narrow?Math.max(offset+10,topBar?.getBoundingClientRect().bottom+8||offset+10):sidebar.getBoundingClientRect().top;
      if(narrow&&bottom-top<160)top=offset+10;
      sidebar.style.setProperty('--cashier-sidebar-top',top+'px');
      sidebar.style.setProperty('--cashier-sidebar-height',Math.max(0,bottom-top-(narrow?10:0))+'px');
    }
    if(!stock?.classList.contains('active')){clearStock();return;}
    const input=doc.activeElement;
    const editing=stock.contains(input)&&input?.matches('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]),textarea')&&!input.disabled&&!input.readOnly;
    const top=stock.getBoundingClientRect().top,available=Math.max(0,bottom-top);
    if(viewport){stock.style.setProperty('--cashier-stock-visible-height',available+'px');stockClass('cashier-stock-viewport',true);}
    else {stock.style.removeProperty('--cashier-stock-visible-height');stockClass('cashier-stock-viewport',false);}
    const quantity=editing&&/^count(?:Base|Purch)_/.test(input.id);
    const covered=bottom<Number(doc.documentElement?.clientHeight||win.innerHeight)-60;
    // On a short keyboard viewport the sticky controls would cover the count row.
    stockClass('cashier-stock-compact-input',Boolean(quantity&&(covered||available<280)));
    if(!editing)return;
    const bounds=stock.getBoundingClientRect(),field=input.getBoundingClientRect();
    let visibleTop=Math.max(offset,bounds.top)+10;
    const visibleBottom=Math.min(bottom,bounds.bottom)-12;
    if(controls&&!controls.contains(input)&&win.getComputedStyle(controls).position==='sticky')visibleTop=Math.max(visibleTop,controls.getBoundingClientRect().bottom+8);
    if(visibleBottom<=visibleTop)return;
    let delta=field.bottom>visibleBottom?field.bottom-visibleBottom:field.top<visibleTop?field.top-visibleTop:0;
    if(delta){
      const maximum=Math.max(0,stock.scrollHeight-stock.clientHeight);
      stock.scrollTop=Math.max(0,Math.min(maximum,stock.scrollTop+delta));
    }
  };
  const schedule=()=>{if(disposed||frame!==null)return;frame=win.requestAnimationFrame(()=>{frame=null;refresh();});};
  const describeFooter=()=>{
    const logout=sidebar?.querySelector('.logout-btn');
    if(logout){logout.setAttribute('aria-label','Sign out of Cashier workspace');logout.title='Sign Out';}
    for(const id of ['displayCashierContainer','displayBranchContainer']){
      const row=doc.getElementById(id),text=row?.querySelector('.f-text')?.textContent.trim();
      if(row&&text){row.title=text;row.setAttribute('aria-label',text);}
    }
    schedule();
  };
  if(sidebar){sidebar.setAttribute('role','navigation');sidebar.setAttribute('aria-label','Cashier navigation');describeFooter();}
  const observer=new win.MutationObserver(schedule);
  if(stock)observer.observe(stock,{attributes:true,attributeFilter:['class']});
  // Classes changed by this helper can schedule one extra frame; unchanged class
  // state is not rewritten, so observers settle without a polling loop.
  const footerObserver=new win.MutationObserver(describeFooter);
  const footer=sidebar?.querySelector('.sidebar-footer');
  if(footer)footerObserver.observe(footer,{childList:true,subtree:true,characterData:true});
  listen(doc,'focusin',schedule);listen(doc,'focusout',schedule);
  listen(win,'resize',schedule);listen(viewport,'resize',schedule);listen(viewport,'scroll',schedule);
  refresh();
  return {refresh,dispose(){disposed=true;if(frame!==null)win.cancelAnimationFrame(frame);listeners.forEach(remove=>remove());observer.disconnect();footerObserver.disconnect();clearStock();sidebar?.style.removeProperty('--cashier-sidebar-height');sidebar?.style.removeProperty('--cashier-sidebar-top');}};
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
