// LOCAL QA ONLY: actual production markup/styles and draft/read handlers.
// Mock branch data; no Firebase SDK, network business reads or submission writes.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const read=name=>readFileSync(new URL('../Takodeal-POS/'+name,import.meta.url),'utf8');
const page=read('index.html'),main=read('main.js');
function section(source,start,end){const at=source.indexOf(start),stop=source.indexOf(end,at);if(at<0||stop<at)throw Error('Missing fixture section '+start);return source.slice(at,stop);}
const styleBlocks=[...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
const styles=[styleBlocks[0],...['cashier-pos-base.css','cashier-theme.css','cashier-tablet.css'].map(read),...styleBlocks.slice(1)];
const stockMarkup=section(page,'    <div class="view-container" id="view-stockreq"','    <div class="view-container" id="view-waste"');
const consumablesMarkup=section(page,'    <div class="view-container" id="view-consumables">','    <div class="view-container" id="view-deliveries"').replace('class="view-container"','class="view-container active"');
const handlers=section(main,'window.loadConsumablesView = async function','window.submitConsumablesCart = async function')+
 section(main,'window.switchConsumablesTab = function','window.loadConsumablesHistory = async function')+
 section(main,'window.stockCountMemory = JSON.parse','// 🛡️ ANTI-SLEEP')+
 section(main,'window.openDeliveryHistoryModal = async function','// 🗑️ UPGRADED WASTE')+
 section(main,'window.loadStockRequestHistory = async function','window.viewStockRequestItems = function')+
 section(page,'    function switchView(viewName)','    function closeModal(id)');
const script=`
const fixtureMemory=new Map([['takodeal_device_branch','Maa']]);
const localStorage={getItem:key=>fixtureMemory.get(key)||null,setItem:(key,value)=>fixtureMemory.set(key,value)};
const currentShift={id:'QA'},imageFor=()=>'';
window.sessionUser={branch:'Maa',name:'QA cashier'};window.fixtureWrites=0;window.fixtureReads=[];
window.consumableCategories=['Consumables','Cleaning Supplies','Packaging'];window.consumablesCart=[];
window.fixtureItems=Array.from({length:75},(_,i)=>({id:'supply-'+i,name:'Supply '+String(i+1).padStart(2,'0')+(i%9===0?' · Long name with packaging details':''),category:i<65?['Consumables','Cleaning Supplies','Packaging'][i%3]:'Ingredients',restockCycle:['Weekly','Monthly','Daily'][i%3],currentStock:30+i,uom:'piece',baseUom:'piece',purchaseUom:'pack',conversionRate:10}));
window.db={};window.doc=(_db,table,id)=>({table,id});window.getDoc=async()=>({exists:()=>true,data:()=>({consumableCats:window.consumableCategories})});
window.fetchCachedInventory=async branch=>{if(branch!=='Maa')throw Error('Unexpected QA branch');window.fixtureReads.push('inventory');return window.fixtureItems;};
window.collection=(_db,table)=>({table});window.where=(...args)=>({where:args});window.orderBy=(...args)=>({orderBy:args});window.limit=(count)=>({limit:count});window.query=(...parts)=>parts;
window.getDocs=async q=>{const table=q[0].table;window.fixtureReads.push(table);const data=table==='dispatch_logs'?Array.from({length:35},(_,i)=>({id:'delivery-'+i,dispatchId:'batch-'+i,date:'Oct 7 · QA '+(i+1),driver:'QA driver',receivedBy:'QA cashier',receivedAt:{toDate:()=>new Date(2026,9,7,12,i)},item:'Delivery item '+(i+1),qty:2,uom:'pack',status:'Received'})):Array.from({length:20},(_,i)=>({id:'report-'+i,timestamp:{toDate:()=>new Date(2026,9,7,12,i)},requestedBy:'QA cashier '+(i+1),status:'Completed',items:[{name:'QA item',qty:1}],managerMessage:i%4===0?'Long HQ note for tablet wrapping and readability.':''}));return {forEach:fn=>data.forEach(d=>fn({id:d.id,data:()=>d}))};};
window.stopShiftSalesFeed=()=>{};
const Swal={showLoading(){},close(){document.querySelector('.swal2-container')?.remove();},fire:async options=>{
 if(options?.title==='Store Use')return {value:{rawQty:1,displayUom:'piece',baseQty:1,bUom:'piece'}};
 if(options?.customClass?.popup?.includes('cashier-stock-delivery-popup')){
  Swal.close();const overlay=document.createElement('div');overlay.className='swal2-container';
  overlay.innerHTML='<section class="swal2-popup '+options.customClass.popup+'" style="width:'+options.width+'px"><button class="swal2-close" aria-label="Close Delivery History" onclick="Swal.close()">×</button><h2 class="swal2-title">'+options.title+'</h2><div class="swal2-html-container">'+options.html+'</div></section>';document.body.append(overlay);
 }
 return {};
}};
${handlers}
window.switchView=switchView;
window.loadConsumablesHistory=()=>{window.fixtureReads.push('consumables history');document.getElementById('consumablesHistoryBody').innerHTML=Array.from({length:35},(_,i)=>'<tr><td>09:'+String(i).padStart(2,'0')+'</td><td>QA cashier</td><td>Supply '+(i+1)+' · 1 piece</td></tr>').join('');};
window.submitConsumablesCart=window.submitAllManualCounts=()=>{document.getElementById('fixtureState').textContent='QA only · no stock or financial changes';};
window.viewStockRequestItems=()=>{};
window.loadConsumablesView();window.renderConsumablesCart();window.loadStockRequestUI();
`;
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cashier inventory scrolling · local QA</title><style>${styles.join('\n')}
/* Mock SweetAlert shell only; content and scoped scroll rules are production. */
.swal2-container{position:fixed;inset:0;z-index:100000;background:#0006;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;}
.swal2-popup{position:relative;border-radius:12px;background:white;padding:0 0 12px;}
.swal2-close{position:absolute;right:8px;top:8px;z-index:3;font-size:24px;min-width:36px;min-height:36px;background:white;border:0;}
.swal2-html-container{text-align:left;}
</style></head><body class="cashier-orange tk-ui-v2 tk-photo-pos">
<div id="tkSystemBar" style="position:fixed;top:0;left:0;right:0;height:28px;display:flex;align-items:center;color:white;padding:0 12px;box-sizing:border-box;font-size:11px;">LOCAL QA <span id="fixtureState" style="margin-left:auto;">No Firebase connection</span></div>
<aside class="sidebar"><div class="sidebar-header">TAKODEÁL</div><nav class="nav-menu"><button class="nav-item" id="nav-pos" onclick="switchView('pos')">🖥️ <span class="nav-item-text">Point of Sale</span></button><button class="nav-item active" id="nav-consumables" onclick="switchView('consumables');window.loadConsumablesView()">🧹 <span class="nav-item-text">Consumables</span></button><button class="nav-item" id="nav-stockreq" onclick="switchView('stockreq');window.loadStockRequestUI()">📦 <span class="nav-item-text">Stock Report</span></button></nav></aside>
<main class="content-area"><header class="top-bar"><div id="topBarTitle" class="top-title">Consumables</div><div class="top-bar-right"><button onclick="switchView('consumables')">Supplies</button><button onclick="switchView('stockreq')">Counts</button><button>Active shift</button></div></header>
<div class="cashier-payment-notice cashier-live-payment-notice" style="display:flex;"><div><strong>Payment review pending · 30 payments</strong><div>A manager must verify these digital payments in HQ.</div></div><button onclick="this.parentElement.remove()" aria-label="Dismiss payment review notice">×</button></div>
${consumablesMarkup}${stockMarkup}<section class="view-container" id="view-pos"><div class="tk-pos-shell" style="display:flex;height:100%;width:100%;"><section class="tk-menu-shell" style="flex:1;overflow:hidden;"><div class="item-grid-container" id="fixturePOSList">${Array.from({length:60},(_,i)=>'<p>POS item '+(i+1)+'</p>').join('')}</div></section><aside class="tk-cart-shell">Original POS layout</aside></div></section></main>
<script>${script.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const output=resolve(process.argv[2]||'../staff-nextlevel-qa/cashier-scroll.html');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);console.log(output);
