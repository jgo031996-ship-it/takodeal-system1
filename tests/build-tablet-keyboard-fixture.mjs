// Local QA only. Actual stock markup, styles and count-draft/viewport handlers;
// synthetic inventory and safe navigation/submission. No Firebase SDK or writes.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const read=name=>readFileSync(new URL('../Takodeal-POS/'+name,import.meta.url),'utf8');
const page=read('index.html'),main=read('main.js'),workspace=read('cashier-workspace.js');
function section(source,start,end){const at=source.indexOf(start),stop=source.indexOf(end,at);if(at<0||stop<at)throw Error('Missing fixture section '+start);return source.slice(at,stop);}
const blocks=[...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
const styles=[blocks[0],...['cashier-pos-base.css','cashier-theme.css','cashier-tablet.css'].map(read),...blocks.slice(1)];
const stock=section(page,'    <div class="view-container" id="view-stockreq"','    <div class="view-container" id="view-waste"').replace('class="view-container"','class="view-container active"');
const actualFooter=section(page,'    <div class="sidebar-footer">','  <div class="content-area">').replace(/Loading\.\.\./g,'QA employee with a longer full name').replace('id="displayBranchText">QA employee with a longer full name','id="displayBranchText">Maa · sample branch');
const helper=section(workspace,'export function installCashierViewport(','\nfunction installParkedOrders(').replace('export function','function');
const count=section(main,'window.stockCountMemory = JSON.parse','// 🛡️ ANTI-SLEEP');
const quantityModel=read('stock-report-units.js').replace(/\bexport (const|function)\b/g,'$1');
const reportedItems=section(main,'window.viewStockRequestItems = function','window.stockReqPoUnsubscribe = null');
const navNames=['Point of Sale','Shift Sales','Mobile Hub','Stock Report','Kitchen Prep','Consumables','Log Waste','Branch Schedule','Remit Cash to HQ','Printer Hub','Time Clock','Delivery Log','Announcements','Training'];
const nav=navNames.map((name,index)=>`<button class="nav-item${index===3?' active':''}" id="nav-${index===3?'stockreq':'fixture-'+index}" onclick="fixtureView('${index===3?'stockreq':'pos'}')"><span class="cashier-nav-icon">${['🖥️','🧾','📱','📦','🍳','🧹','♻️','📅','💵','🖨️','⏱️','🚚','📣','📋'][index]}</span><span class="nav-item-text">${name}</span></button>`).join('');
const script=`
const fixtureMemory=new Map([['takodeal_device_branch','Maa']]);
const localStorage={getItem:key=>fixtureMemory.get(key)||null,setItem:(key,value)=>fixtureMemory.set(key,value)};
const currentShift={id:'QA'},status=document.getElementById('fixtureStatus');
window.sessionUser={branch:'Maa',name:'QA employee'};
window.fetchCachedInventory=async()=>Array.from({length:75},(_,i)=>({id:'qa-'+i,name:'Sample item '+String(i+1).padStart(2,'0'),category:['Ingredients','Packaging'][i%2],restockCycle:['Weekly','Monthly','Daily'][i%3],currentStock:30+i,uom:'piece',purchaseUom:'pack',conversionRate:10}));
${quantityModel}
${count}
const Swal={close(){document.querySelector('.fixture-reported-overlay')?.remove();document.body.classList.remove('swal2-shown');},fire(options){
 Swal.close();const overlay=document.createElement('div');overlay.className='swal2-container fixture-reported-overlay';
 const popup=document.createElement('section');popup.className='swal2-popup '+(options.customClass?.popup||'');popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','true');popup.setAttribute('aria-label','Sample Reported Items');popup.style.width=options.width+'px';popup.style.padding=options.padding||'1.25em';popup.innerHTML=options.html;overlay.append(popup);document.body.append(overlay);document.body.classList.add('swal2-shown');popup.querySelector('button')?.focus();
}};
${reportedItems}
const fixtureReportedOrder={status:'Pending',items:[
 {name:'Chicken Powder · legacy saved units',qty:1000,rawQty:1,physicalStock:1000,uom:'g',displayUom:'Pack'},
 {name:'Chicken Powder · new count snapshot',qty:1000,rawQty:1,physicalStock:1000,uom:'g',displayUom:'Pack',countSnapshot:createCountSnapshot({baseUom:'g',purchaseUom:'Pack',conversionRate:1000,purchaseCount:1,baseCount:0,totalBaseQty:1000})}
]};
window.fixtureReportedItems=()=>window.viewStockRequestItems(encodeURIComponent(JSON.stringify(fixtureReportedOrder)));
window.submitAllManualCounts=()=>{status.textContent='QA Submit reached. No inventory or financial changes.';};
window.openDeliveryHistoryModal=()=>{status.textContent='History is mocked in this keyboard fixture.';};
window.loadStockRequestHistory=()=>{document.getElementById('stockReqHistoryBody').innerHTML=Array.from({length:25},(_,i)=>'<tr><td>Sample date '+(i+1)+'</td><td>QA employee</td><td>Completed sample</td><td>Mock items</td></tr>').join('');};
window.logoutCashier=()=>{status.textContent='QA Sign Out reached. No real account was signed out.';};
const sidebar=document.getElementById('mainSidebar'),toggle=document.getElementById('cashierSidebarToggle');
function reflect(){const expanded=window.matchMedia('(max-width:768px)').matches?sidebar.classList.contains('tk-mobile-menu-open'):!sidebar.classList.contains('collapsed');sidebar.classList.toggle('cashier-sidebar-expanded',expanded);toggle.setAttribute('aria-expanded',String(expanded));}
if(window.matchMedia('(min-width:769px) and (max-width:1180px)').matches)sidebar.classList.add('collapsed');
toggle.onclick=()=>{sidebar.classList.toggle(window.matchMedia('(max-width:768px)').matches?'tk-mobile-menu-open':'collapsed');reflect();};window.addEventListener('resize',reflect);reflect();
window.fixtureView=view=>{document.getElementById('view-stockreq').classList.toggle('active',view==='stockreq');document.getElementById('view-pos').classList.toggle('active',view==='pos');status.textContent=view==='stockreq'?'Mock counts · typed drafts retained':'Mock POS · return to Stock Report to check the draft';};
${helper}
let preview=false,lastInput=null;
const actualViewport=window.visualViewport;
class PreviewViewport extends EventTarget {get height(){const actual=actualViewport?.height||window.innerHeight;return preview?Math.max(170,actual-260):actual;}get offsetTop(){return actualViewport?.offsetTop||0;}get scale(){return actualViewport?.scale||1;}}
const viewport=new PreviewViewport();
const environment={visualViewport:viewport,get innerHeight(){return window.innerHeight;},matchMedia:query=>window.matchMedia(query),getComputedStyle:node=>window.getComputedStyle(node),requestAnimationFrame:fn=>window.requestAnimationFrame(fn),cancelAnimationFrame:id=>window.cancelAnimationFrame(id),MutationObserver:window.MutationObserver,addEventListener:(...args)=>window.addEventListener(...args),removeEventListener:(...args)=>window.removeEventListener(...args)};
const layout=installCashierViewport(document,environment);
actualViewport?.addEventListener('resize',()=>viewport.dispatchEvent(new Event('resize')));actualViewport?.addEventListener('scroll',()=>viewport.dispatchEvent(new Event('scroll')));
document.addEventListener('focusin',event=>{if(/^count(?:Base|Purch)_/.test(event.target.id))lastInput=event.target;});
document.getElementById('fixtureKeyboard').onclick=()=>{preview=!preview;const keyboard=document.getElementById('fixtureKeyboardCover');keyboard.hidden=!preview;keyboard.style.height=(window.innerHeight-viewport.height)+'px';document.getElementById('fixtureKeyboard').textContent=preview?'Hide keyboard':'Keyboard preview';lastInput?.focus({preventScroll:true});viewport.dispatchEvent(new Event('resize'));};
document.getElementById('fixtureKeyboardClose').onclick=()=>document.getElementById('fixtureKeyboard').click();
window.fixtureKeyboardLayout=layout;
const reportedButton=document.createElement('button');reportedButton.type='button';reportedButton.id='fixtureReportedItems';reportedButton.textContent='Sample Reported Items';reportedButton.onclick=window.fixtureReportedItems;document.querySelector('.cashier-stock-tabs').append(reportedButton);
window.loadStockRequestUI();
`;
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tablet stock keyboard and sidebar · local QA</title><style>${styles.join('\n')}
.fixture-keyboard{position:fixed;left:0;right:0;bottom:0;background:#dce1e6f5;z-index:1000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;font:16px 'Segoe UI',sans-serif;pointer-events:none;}.fixture-keyboard[hidden]{display:none;}.fixture-keyboard button{pointer-events:auto;min-height:44px;padding:10px 16px;}.fixture-note{padding:18px;font-size:14px;}.fixture-note button{min-height:44px;padding:10px;}
.fixture-reported-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;background:#0006;box-sizing:border-box;}.fixture-reported-overlay .swal2-popup{background:white;max-width:100%;box-sizing:border-box;border-radius:16px;}.fixture-reported-overlay button{min-height:36px;}.cashier-stock-tabs #fixtureReportedItems{padding:10px 14px;border:1px solid #eadfd2;background:#fff7eb;color:#8d4a23;border-radius:6px;font-weight:600;}
</style></head><body class="cashier-orange tk-ui-v2 tk-photo-pos"><div style="position:fixed;top:0;left:0;right:0;height:28px;padding:0 10px;box-sizing:border-box;display:flex;align-items:center;background:#49372b;color:white;z-index:9999;font:11px 'Segoe UI',sans-serif;"><span id="fixtureStatus">LOCAL QA · synthetic items only · no Firebase connection</span></div>
<aside class="sidebar" id="mainSidebar"><div class="sidebar-header"><div class="sidebar-header"><span class="brand-text">TAKODEÁL · QA</span></div></div><nav class="nav-menu">${nav}</nav>${actualFooter.replace(/\s*<\/div>\s*$/,'')}</aside>
<main class="content-area"><header class="top-bar"><button type="button" class="cashier-button" id="cashierSidebarToggle" aria-label="Toggle navigation" aria-controls="mainSidebar">☰</button><div class="top-title" id="topBarTitle">Stock Reports</div><div class="top-bar-right"><button id="fixtureKeyboard" type="button">Keyboard preview</button><button type="button" onclick="fixtureView('stockreq')">Counts</button></div></header>
<div class="cashier-payment-notice cashier-live-payment-notice" style="display:flex;"><div><strong>Payment review pending · sample</strong><div>Local preview only</div></div><button type="button" onclick="this.parentElement.remove()" aria-label="Dismiss sample notice">×</button></div>${stock}
<section class="view-container" id="view-pos"><div class="fixture-note"><p>Mock POS. The production POS was not loaded and no sales can be submitted.</p><button type="button" onclick="fixtureView('stockreq')">Return to Stock Report</button></div></section></main>
<section id="fixtureKeyboardCover" class="fixture-keyboard" hidden><strong>Keyboard coverage preview</strong><span>Focus a sample count, type a value, then show/hide this cover.</span><button id="fixtureKeyboardClose" type="button">Hide keyboard cover</button></section>
<script>${script.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const output=resolve(process.argv[2]||'../tablet-attendance-stock-qa/keyboard-sidebar.html');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);console.log(output);
