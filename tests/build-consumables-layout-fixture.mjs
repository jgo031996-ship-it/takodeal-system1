// Local QA only: actual markup/styles and read-only/draft handlers, with no Firebase SDK.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const read=name=>readFileSync(new URL('../Takodeal-POS/'+name,import.meta.url),'utf8');
const page=read('index.html'),main=read('main.js');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const head=page.slice(0,page.indexOf('</head>'));
const styles=[...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]);
styles.push(...['cashier-pos-base.css','cashier-theme.css','cashier-tablet.css'].map(read));
const markup=section(page,'    <div class="view-container" id="view-consumables">','    <div class="view-container" id="view-deliveries"').replace('class="view-container"','class="view-container active"');
const draftHandlers=section(main,'window.loadConsumablesView = async function','window.submitConsumablesCart = async function')+section(main,'window.switchConsumablesTab = function','window.loadConsumablesHistory = async function');
const switchView=section(page,'    function switchView(viewName)','    function closeModal(id)');
const script=`
const localStorage={getItem:key=>key==='takodeal_device_branch'?'Maa':null},currentShift={id:'QA'},imageFor=()=>'';
window.consumableCategories=['Consumables','Cleaning Supplies','Packaging'];window.consumablesCart=[];
window.fixtureItems=Array.from({length:65},(_,i)=>({id:'supply-'+i,name:'Supply '+String(i+1).padStart(2,'0')+(i%9===0?' · Long name with extra packaging details':''),category:['Consumables','Cleaning Supplies','Packaging'][i%3],currentStock:30+i,uom:'piece',purchaseUom:'pack',conversionRate:10}));
window.db={};window.doc=(_db,table,id)=>({table,id});window.getDoc=async()=>({exists:()=>true,data:()=>({consumableCats:window.consumableCategories})});
window.fetchCachedInventory=async branch=>{if(branch!=='Maa')throw Error('Unexpected QA branch');return window.fixtureItems;};
window.fixtureWrites=0;window.fixtureHistoryReads=0;window.stopShiftSalesFeed=()=>{};
const Swal={fire:async()=>({value:{rawQty:1,displayUom:'piece',baseQty:1,bUom:'piece'}})};
${draftHandlers}
window.loadConsumablesHistory=()=>{window.fixtureHistoryReads++;document.getElementById('consumablesHistoryBody').innerHTML=Array.from({length:35},(_,i)=>'<tr><td>09:'+String(i).padStart(2,'0')+'</td><td>QA cashier</td><td>Supply '+(i+1)+' · 1 piece</td></tr>').join('');};
window.submitConsumablesCart=()=>{document.getElementById('fixtureState').textContent='QA only. No stock or financial data was changed.';};
${switchView}
window.switchView=switchView;
window.loadConsumablesView();window.renderConsumablesCart();
`;
const html=`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Consumables local QA</title><style>${styles.join('\n')}</style></head>
<body class="cashier-orange tk-ui-v2 tk-photo-pos"><div id="tkSystemBar" style="position:fixed;top:0;left:0;right:0;height:28px;color:white;display:flex;align-items:center;padding:0 12px;box-sizing:border-box;font-size:11px;">LOCAL QA · mock supplies only <span id="fixtureState" style="margin-left:auto;">No Firebase connection</span></div>
<aside class="sidebar"><div class="sidebar-header">TAKODEÁL</div><div class="nav-menu"><button class="nav-item" id="nav-pos" onclick="switchView('pos')">🖥️ <span class="nav-item-text">Point of Sale</span></button><button class="nav-item active" id="nav-consumables" onclick="switchView('consumables')">🧹 <span class="nav-item-text">Consumables</span></button></div></aside>
<main class="content-area"><header class="top-bar"><div class="top-title" id="topBarTitle">Consumables</div><div class="top-bar-right"><button onclick="switchView(document.getElementById('view-consumables').classList.contains('active')?'pos':'consumables')">Switch view</button><button>Active shift</button></div></header><div class="cashier-live-payment-notice" style="flex-shrink:0;"><div><strong>Payment review pending · 30 payments</strong><small>Manager review in HQ</small></div><button onclick="this.parentElement.remove()">×</button></div>
${markup}<section class="view-container" id="view-pos"><div class="tk-pos-shell" style="display:flex;height:100%;width:100%;"><section class="tk-menu-shell" style="flex:1;overflow:hidden;"><div class="item-grid-container" id="fixturePOSList">${Array.from({length:60},(_,i)=>'<p>POS item '+(i+1)+'</p>').join('')}</div></section><aside class="tk-cart-shell">Original POS layout</aside></div></section></main><script>${script.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
const output=resolve(process.argv[2]||'../transaction-upgrades-qa/consumables.html');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);console.log(output);
