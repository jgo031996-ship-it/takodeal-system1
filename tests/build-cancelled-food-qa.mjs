
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.dirname(checkout);
const options=new Map();for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];if(!['--output','--mirror'].includes(key)||!value||value.startsWith('--'))throw Error('Use --output <QA directory> and --mirror <served QA directory>.');options.set(key,value);}
function target(key,fallback){const output=path.resolve(options.get(key)||fallback),relative=path.relative(work,output),inside=path.relative(checkout,output);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!inside.startsWith('..'))throw Error('QA output must remain inside work and outside the product source.');return output;}
const targets=[target('--output',path.join(work,'cancelled-food-qa')),target('--mirror',path.join(work,'tablet-attendance-stock-qa','cancelled-food-review'))];
const files=new Map(),sources=new Map(),hash=value=>createHash('sha256').update(value).digest('hex');
async function graph(app,name){
    const key=app+'/'+name;if(sources.has(key))return;
    if(!['Takodeal-POS','takodeal-manager'].includes(app)||!/^[\w-]+\.js$/.test(name)||['main.js','auth.js','firebase-core.js'].includes(name))throw Error('Unsafe sample dependency: '+key);
    const text=await readFile(path.join(checkout,app,name),'utf8');sources.set(key,text);files.set('modules/'+key,text);
    for(const match of text.matchAll(/\bimport\s+(?:(?:[^;]*?)\s+from\s+)?['"]([^'"]+)['"]\s*;/g)){
        if(!/^\.\/[\w-]+\.js$/.test(match[1]))throw Error('External application import is forbidden: '+match[1]);
        await graph(app,match[1].slice(2));
    }
}
await graph('Takodeal-POS','cancelled-orders-ui.js');await graph('Takodeal-POS','sales-actions.js');
await graph('takodeal-manager','pos-config-workspace.js');await graph('takodeal-manager','dashboard-data.js');
const [posHTML,posMain,managerMain,harness]=await Promise.all(['Takodeal-POS/index.html','Takodeal-POS/main.js','takodeal-manager/main.js','tests/helpers/firestore-harness.mjs'].map(name=>readFile(path.join(checkout,name),'utf8')));
function section(source,start,end){const at=source.indexOf(start),stop=source.indexOf(end,at);if(at<0||stop<=at)throw Error('Actual source section changed: '+start);return source.slice(at,stop);}
function element(source,id){
    const at=source.indexOf('id="'+id+'"'),start=source.lastIndexOf('<',at),tag=source.slice(start).match(/^<([a-z][a-z\d-]*)\b/i)?.[1];if(at<0||!tag)throw Error('Actual sample markup unavailable: '+id);
    const masked=source.replace(/<!--[\s\S]*?-->/g,value=>' '.repeat(value.length)),pattern=new RegExp('<\\/?'+tag+'\\b[^>]*>','gi');pattern.lastIndex=start;let depth=0,match;
    while((match=pattern.exec(masked))){depth+=match[0].startsWith('</')?-1:1;if(!depth)return source.slice(start,pattern.lastIndex);}throw Error('Unclosed sample element: '+id);
}
const actualSales=section(posHTML,'window.loadSalesDashboard = async function','    function toggleTxMenu');
const actualReceipt=section(posMain,'window.viewReceiptDetails = async function','const denominations =');
files.set('modules/actual-sales.js','export function installActualSales(api,{document}){const window=api;\n'+actualSales+'\n'+actualReceipt+'\n}\n');
const observerArea=section(managerMain,'// 📱 RESPONSIVE MOBILE ENGINE & TABLE AUTO-WRAPPER','// 📦 MAIN OFFICE AI SUPPLIER PURCHASE ORDER ENGINE');
const observerStart=observerArea.indexOf('runManagerDomReady(() => {');if(observerStart<0)throw Error('Actual table observer changed.');
files.set('modules/manager-table-observer.js','const runManagerDomReady=callback=>callback();\n'+observerArea.slice(observerStart));
const assertion="import assert from 'node:assert/strict';";if(!harness.startsWith(assertion))throw Error('Review the actual transaction harness before adapting it.');
files.set('modules/firestore-harness.js',harness.replace(assertion,"const assert={equal(actual,expected,message){if(actual!==expected)throw Error(message||'Sample transaction assertion failed');}};"));
const cleanCSS=value=>value.replace(/@import[^;]+;/g,'');
const posCSS=[...posHTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');files.set('actual-pos.css',cleanCSS(posCSS));
for(const [source,destination] of [['Takodeal-POS/cancelled-orders.css','cancelled-orders.css'],['Takodeal-POS/sales-actions.css','sales-actions.css'],['takodeal-manager/pos-config-workspace.css','pos-config-workspace.css'],['takodeal-manager/manager-mobile.css','manager-mobile.css']])files.set(destination,cleanCSS(await readFile(path.join(checkout,source),'utf8')));
const swal='https://cdn.jsdelivr.net/npm/sweetalert2@11.10.6/dist/sweetalert2.all.min.js';
const csp="default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-inline' "+swal+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const qaCSS=`html,body{position:static!important;height:auto!important;min-height:100%;max-width:100%;overflow:auto!important;display:block!important;overscroll-behavior-y:auto;padding:0;margin:0;background:#fbf7f0;color:#49372b;font:15px/1.5 system-ui,sans-serif}*{box-sizing:border-box}.qa-main{max-width:1200px;margin:auto;padding:16px;min-width:0}.qa-card{background:white;border:1px solid #eadfd2;border-radius:14px;padding:16px;margin-bottom:16px;min-width:0;overflow-wrap:anywhere}.qa-notice{background:#fff0d4}.qa-card h1{font-size:25px;margin:0 0 8px}.qa-card h2{font-size:19px;margin:0 0 10px}.qa-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.qa-controls button,.qa-controls select,.qa-controls a{min-height:44px;font:inherit;padding:10px 12px;border:1px solid #d9cbb9;background:white;color:#49372b;border-radius:8px}.qa-controls label{display:flex;align-items:center;gap:8px;min-height:44px}.qa-controls input[type=checkbox]{width:20px;height:20px}.qa-controls button:disabled{opacity:.55}.qa-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.qa-metrics>div{padding:12px;background:#faf3e8;border-radius:10px;min-width:0}.qa-metrics span,.qa-metrics strong{display:block;overflow-wrap:anywhere}.qa-metrics span{font-size:12px}.qa-metrics strong{font-size:19px}.qa-ledger{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}.qa-state{min-height:22px}.qa-phone{width:390px;max-width:100%;height:844px;border:1px solid #d9cbb9;border-radius:12px;margin-top:16px}.qa-main #view-sales{display:block!important;padding:0!important}.qa-main #view-sales>div>div{min-height:0!important}.qa-main #view-sales .table-responsive{max-height:360px;min-height:160px}.qa-main #view-posconfig{padding:0!important;max-width:100%}.qa-main #section-master{margin:0}.qa-main .action-dropdown{display:none;flex-direction:column}.qa-main .status-badge{padding:4px 8px;border-radius:9px;display:inline-block}.qa-main .status-out{background:#fff1e8;color:#a24a20}.qa-main .status-good{background:#edf8ee;color:#276539}.cashier-sales-actions{flex-direction:column}.qa-note{font-size:13px;color:#7b6b5a}@media(max-width:620px){.qa-main{padding:10px}.qa-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.qa-controls{align-items:stretch}.qa-controls>button,.qa-controls>select{max-width:100%}}`;
files.set('qa.css',qaCSS);
function page(title,body,script,styles=[],classes=''){
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><title>LOCAL SAMPLE · '+title+'</title>'+styles.map(name=>'<link rel="stylesheet" href="'+name+'">').join('')+'<link rel="stylesheet" href="qa.css"></head><body class="'+classes+'">'+body+'<script src="'+swal+'"></script><script type="module" src="'+script+'"></script></body></html>';
}
const salesMarkup=element(posHTML,'view-sales').replace('class="view-container"','class="view-container active"');
files.set('index.html',page('Cancelled prepared order','<main class="qa-main"><section class="qa-card qa-notice"><h1>Cancelled platform food · local sample</h1><p>Actual Cashier sales rendering, Action menu, cancellation dialogs, sale engine and Foods classifier run against synthetic memory-only Firestore. No Firebase SDK, real staff, payment, salary, printer, refund or business network connection is used.</p><p class="qa-note">Prepared sample order: ₱100.00. Sample Staff PIN: <strong>5678</strong>. Ingredient stock starts at100 and the actual source sale deducts6 once.</p><div class="qa-controls"><select id="qaPlatform" aria-label="Sample platform"><option>Grab</option><option>Foodpanda</option></select><button id="qaReset" type="button">Reset sample</button><button id="qaReplay" type="button">Repeat original cancellation dialog</button><label><input id="qaLoseAck" type="checkbox">Lose next mock write acknowledgement</label><label><input id="qaClosed" type="checkbox">Current shift closed</label><button id="qaRefresh" type="button">Refresh outcome</button><a href="manager.html">Actual Manager settings editor</a><a href="phone.html">Phone preview</a></div><p id="qaState" class="qa-state" role="status" aria-live="polite"></p></section><section class="qa-card"><h2>Mock transaction outcome</h2><div class="qa-metrics"><div><span>Original platform receipt</span><strong id="qaSource">—</strong></div><div><span>Platform revenue</span><strong id="qaPlatformRevenue">—</strong></div><div><span>Staff purchase receipts / amount</span><strong id="qaPurchase">—</strong></div><div><span>Unpaid Foods deductions</span><strong id="qaFoods">—</strong></div><div><span>Ingredient stock / uses</span><strong id="qaStock">—</strong></div><div><span>Cash movement</span><strong id="qaCash">—</strong></div><div><span>All counted sales revenue</span><strong id="qaRevenue">—</strong></div><div><span>Daily meal allowance requests</span><strong id="qaDailyMeal">—</strong></div><div><span>Source / linked stock movements</span><strong id="qaMovements">—</strong></div></div><details><summary>Read-only sample ledger and classification</summary><pre id="qaLedger" class="qa-ledger"></pre></details></section><section class="qa-card"><h2>Actual Shift Sales view</h2><p class="qa-note">Swipe the real table to its Action column. Choose Cancelled order, select customer or rider, then choose Staff purchase if wanted. The actual consent checkbox and Staff PIN authorize the displayed Foods deduction. After a lost purchase acknowledgement, re-enter5678 in the same dialog to retry.</p>'+salesMarkup+'</section></main>','sample.js',['actual-pos.css','sales-actions.css','cancelled-orders.css']));
files.set('manager.html',page('Manager cancelled-food settings','<main class="qa-main"><section class="qa-card qa-notice"><h1>Manager POS Config · local sample</h1><p>The actual configuration installer and revision-checked Save operate only on a separate synthetic settings document. Opening the editor does not save defaults. No Firebase SDK or business data is used.</p><div class="qa-controls"><button id="qaManagerReset" type="button">Reset missing policy defaults</button><button id="qaManagerStale" type="button">Simulate another Manager save</button><button id="qaManagerRefresh" type="button">Refresh sample ledger</button><a href="index.html">Cashier sample</a><a href="phone.html?view=manager">Phone preview</a></div><p class="qa-note">Find Cancelled prepared orders, change20% to15%, then click the actual Save POS configuration button. Daily meal rates remain independent. Simulate another Manager save to verify the stale editor cannot overwrite it.</p><pre id="qaManagerLedger" class="qa-ledger"></pre></section><div class="main-content"><section class="view active" id="view-posconfig"><div id="section-master"></div></section></div></main>','manager-sample.js',['pos-config-workspace.css','manager-mobile.css'],'manager-theme'));
files.set('phone.html',page('Cancelled-food phone review','<main class="qa-main"><section class="qa-card"><h1>Phone / tablet preview</h1><p>The same actual dialogs and local-only sample run inside this frame.</p><div class="qa-controls"><button data-width="320">320 px</button><button data-width="390">390 px</button><button data-width="768">768 px</button><button id="qaCashierPage">Cashier</button><button id="qaManagerPage">Manager</button><a href="index.html">Open directly</a></div><iframe id="qaPhone" class="qa-phone" title="Cancelled-food review" src="index.html"></iframe></section></main>','phone.js'));
files.set('phone.js',"const frame=document.getElementById('qaPhone');document.querySelectorAll('[data-width]').forEach(button=>button.onclick=()=>frame.style.width=button.dataset.width+'px');document.getElementById('qaCashierPage').onclick=()=>frame.src='index.html';document.getElementById('qaManagerPage').onclick=()=>frame.src='manager.html';if(new URL(location.href).searchParams.get('view')==='manager')frame.src='manager.html';");
files.set('sample.js',String.raw`
import {firestoreHarness} from './modules/firestore-harness.js';
import {installActualSales} from './modules/actual-sales.js';
import {installCancelledOrders} from './modules/Takodeal-POS/cancelled-orders-ui.js';
import {installSalesActions} from './modules/Takodeal-POS/sales-actions.js';
import {createSaleEngine,SALE_VERSION,receiptIngredientBurn,safeId} from './modules/Takodeal-POS/pos-safety.js';
import {isMealDeduction} from './modules/takodeal-manager/payroll-safety.js';
import {salesSummary,saleIsPaid} from './modules/takodeal-manager/dashboard-data.js';
window.fetch=()=>Promise.reject(Error('Business requests are disabled in this local-only sample.'));
const el=id=>document.getElementById(id),sourceId='sample-platform-sale',staffName='Sample Rider Staff',shiftId='sample-open-shift',branch='Maa',at=new Date('2026-10-11T11:00:00+08:00');
let h,api,w,sales,busy=false;
const table=key=>[...h.docs].filter(([path])=>path.startsWith(key+'/')).map(([path,value])=>({...structuredClone(value),id:path.slice(key.length+1)}));
const cash=()=>h.get('cash_accounts/sample-hq').balance-30000+h.get('cash_accounts/sample-branch').balance-2000;
const money=number=>'₱'+Number(number).toFixed(2);
function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function controls(){for(const id of ['qaReset','qaReplay','qaRefresh','qaPlatform','qaClosed','qaLoseAck'])el(id).disabled=busy||(id==='qaReplay'&&!w?.currentShift?.active);}
async function outcome(){
    const source=h.get('transactions/'+sourceId),transactions=table('transactions'),purchases=transactions.filter(row=>row.cancelledFoodSourceId===sourceId),deductions=table('staff_deductions'),foods=deductions.filter(row=>isMealDeduction(row.type)&&row.status==='Unpaid');
    el('qaSource').textContent=source.preparedCancellation?'Voided · prepared kept':source.status;
    el('qaPlatformRevenue').textContent=money(salesSummary(transactions.filter(row=>saleIsPaid(row)&&['Grab','Foodpanda'].includes(row.paymentMethod))).net);
    el('qaPurchase').textContent=purchases.length+' / '+money(purchases.reduce((sum,row)=>sum+row.netTotal,0));
    el('qaFoods').textContent=foods.length+' / '+money(foods.reduce((sum,row)=>sum+row.amount,0));
    el('qaStock').textContent=h.get('inventory/sample-batter').currentStock+' Gram / '+table('stock_logs').length+' stock logs';
    el('qaCash').textContent=money(cash());el('qaRevenue').textContent=money(salesSummary(transactions.filter(saleIsPaid)).net);el('qaDailyMeal').textContent=table('staff_requests').length;
    el('qaMovements').textContent=JSON.stringify(receiptIngredientBurn(source))+' / '+JSON.stringify(purchases[0]?receiptIngredientBurn(purchases[0]):{});
    el('qaLedger').textContent=JSON.stringify({sampleOnly:true,productionAPICalls:0,cloudWrites:0,source:structuredClone(source),staffPurchases:purchases,deductions:deductions.map(row=>({...row,payrollFoods:isMealDeduction(row.type)})),
        inventory:table('inventory'),cashAccounts:table('cash_accounts'),dailyMealRequests:table('staff_requests'),managerAlerts:table('manager_alerts'),commitMarkers:table('pos_sale_commits'),sourceShift:h.get('shifts/'+shiftId),stats:h.get('settings/global_stats')},null,2);
    controls();
}
async function refreshSales(){await w.loadSalesDashboard();await outcome();}
async function action(operation,{loseAck=false}={}){if(busy)return;busy=true;controls();try{if(loseAck&&el('qaLoseAck').checked){el('qaLoseAck').checked=false;h.loseNextAck();}await operation();}catch(error){await window.Swal.fire({titleText:'Local sample needs attention',text:error.message,icon:'warning'});}finally{await refreshSales();busy=false;controls();}}
async function seed(){
    w?.cashierSalesActions?.close();h=firestoreHarness();api=h.api;api.getDocs=api.getDocsFromServer;api.auth={currentUser:{uid:'synthetic-approved-device'}};api.serverTimestamp=()=>new Date(at);
    h.put('inventory/sample-batter',{branch,name:'Batter',currentStock:100,uom:'Gram'});h.put('cash_accounts/sample-hq',{branch:'Main Office',balance:30000});h.put('cash_accounts/sample-branch',{branch,balance:2000});
    h.put('shifts/'+shiftId,{branch,active:true,status:'Open',cashier:'Synthetic Cashier',startingCash:2000,salesRevision:0});h.put('cashiers/sample-staff',{cashierName:staffName,fullName:'Old sample profile name',branch,role:'Staff',status:'Active',pin:'5678'});h.put('settings/global_pos_config',{});
    sales=createSaleEngine(api);await sales.commit(await sales.prepare({saleVersion:SALE_VERSION,saleId:sourceId,receiptId:'SAMPLE-PLATFORM-001',branch,shiftId,cashier:'Synthetic Cashier',status:'Paid',paymentMethod:el('qaPlatform').value,orderType:el('qaPlatform').value,
        netTotal:100,subTotalBeforeDiscount:100,amountReceived:0,localTimestamp:at.toISOString(),customerName:'SAMPLE PLATFORM ORDER',cart:[{name:'6 Pcs Takoyaki',qty:1,lineTotalFinal:100}]},[{menuItem:'6 Pcs Takoyaki',ingredientName:'Batter',qty:6}]));
    w={isKdsEnabled:true,sessionUser:{branch,cashierName:'Synthetic Cashier'},currentShift:{shiftId,active:true,startTime:new Date('2026-10-11T09:00:00+08:00')},localStorage:memoryStorage(),Swal:window.Swal,
        getComputedStyle:node=>window.getComputedStyle(node),addEventListener:(...args)=>window.addEventListener(...args),visualViewport:window.visualViewport,
        get innerWidth(){return window.innerWidth;},get innerHeight(){return window.innerHeight;},getSalesDashboardData:async()=>table('transactions'),getParkedShiftSales:async()=>[],mergeParkedShiftSales:rows=>rows,getPendingSales:async()=>[],mergePendingSales:rows=>rows,
        startShiftSalesFeed(){},stopShiftSalesFeed(){},getReceiptDetails:async id=>table('transactions').find(row=>row.receiptId===id),refreshVisibleShiftSales:()=>refreshSales()};
    installActualSales(w,{document});installCancelledOrders(api,{window:w,document});
    // The portal installs once; its context/geometry getters follow current w.
    if(!window.SampleSalesPortal){const live={get sessionUser(){return w.sessionUser;},get currentShift(){return w.currentShift;},getComputedStyle:node=>window.getComputedStyle(node),addEventListener:(...args)=>window.addEventListener(...args),visualViewport:window.visualViewport,get innerWidth(){return window.innerWidth;},get innerHeight(){return window.innerHeight;}};window.SampleSalesPortal=installSalesActions(live,document);}
    w.cashierSalesActions=window.SampleSalesPortal;
    el('qaClosed').checked=false;el('qaLoseAck').checked=false;el('qaState').textContent='Synthetic source sale saved. Batter is94Gram. Use its actual Action menu to record the prepared cancellation.';
    await refreshSales();
}
window.toggleTxMenu=id=>w.cashierSalesActions.toggle(id);
window.cancelPreparedOrder=value=>action(()=>w.cancelPreparedOrder(value),{loseAck:true});
window.purchaseCancelledFood=value=>action(()=>w.purchaseCancelledFood(value),{loseAck:true});
window.viewReceiptDetails=id=>w.viewReceiptDetails(id);
window.reprintDashboardReceipt=()=>window.Swal.fire({titleText:'Sample only',text:'Printing is disabled. No printer connection is loaded.',icon:'info'});
window.voidTx=receiptId=>action(async()=>{const result=await window.Swal.fire({titleText:'Sample ordinary void',text:'This separate existing action returns recorded stock. Use Cancelled order for prepared platform cancellations.',showCancelButton:true});if(result.isConfirmed)await sales.voidSale(receiptId,'Synthetic Cashier',branch);});
window.loadSalesDashboard=()=>action(refreshSales);
el('qaReset').onclick=()=>action(seed);el('qaPlatform').onchange=()=>action(seed);el('qaRefresh').onclick=()=>action(refreshSales);
el('qaReplay').onclick=()=>window.cancelPreparedOrder(encodeURIComponent(sourceId));
el('qaClosed').onchange=()=>action(async()=>{const active=!el('qaClosed').checked;w.currentShift.active=active;h.put('shifts/'+shiftId,{...h.get('shifts/'+shiftId),active,status:active?'Open':'Closed'});el('qaState').textContent=active?'Current synthetic shift reopened.':'Current synthetic shift closed. The actual sales view and cancellation guard require an active shift.';});
if(window.Swal)await action(seed);else{el('qaState').textContent='Load the pinned SweetAlert presentation script before reviewing. No business requests are allowed.';busy=true;controls();}
window.CancelledFoodSample=Object.freeze({snapshot:()=>structuredClone([...h.docs]),sourceId,purchaseId:'cancelled-food-'+safeId(sourceId)});
`);
files.set('manager-sample.js',String.raw`
import {firestoreHarness} from './modules/firestore-harness.js';
import {initPosConfigWorkspace} from './modules/takodeal-manager/pos-config-workspace.js';
import {cancelledFoodPolicy} from './modules/takodeal-manager/pos-config-model.js';
import './modules/manager-table-observer.js';
window.fetch=()=>Promise.reject(Error('Business requests are disabled in this local-only sample.'));
const h=firestoreHarness(),api={...h.api,auth:{currentUser:{uid:'synthetic-hq-config',email:'sample-hq@example.invalid',emailVerified:true}},sessionUser:{isOwner:true,cashierName:'Synthetic HQ'},crypto:window.crypto};let saveCalls=0;
const el=id=>document.getElementById(id),run=api.runTransaction;
function ledger(){const settings=h.get('settings/global_pos_config')||{};el('qaManagerLedger').textContent=JSON.stringify({sampleOnly:true,cloudWrites:0,explicitMockSaveCalls:saveCalls,savedSettings:settings,effectivePolicy:cancelledFoodPolicy(settings),examplePrice:100,exampleFoodsAmount:100*(1-cancelledFoodPolicy(settings).cancelledFoodDiscountPct/100)},null,2);}
api.getDocFromServer=async ref=>({exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});api.serverTimestamp=()=>new Date('2026-10-11T11:00:00+08:00');
api.runTransaction=async(...args)=>{saveCalls++;try{return await run(...args);}finally{ledger();}};
const editor=initPosConfigWorkspace({window:api,document});
el('qaManagerReset').onclick=async()=>{h.put('settings/global_pos_config',{});saveCalls=0;await editor.load();ledger();};
el('qaManagerStale').onclick=()=>{const prior=h.get('settings/global_pos_config')||{};h.put('settings/global_pos_config',{...prior,configEditorRevision:(Number(prior.configEditorRevision)||0)+1,cancelledFoodPurchaseEnabled:false,cancelledFoodDiscountPct:7});ledger();};
el('qaManagerRefresh').onclick=ledger;
h.put('settings/global_pos_config',{});await editor.load();ledger();
`);
const manifest={sampleOnly:true,generatedAt:new Date().toISOString(),sources:Object.fromEntries([...sources].map(([name,text])=>[name,hash(text)])),actualSalesHash:hash(actualSales),actualReceiptHash:hash(actualReceipt),actualTableObserverHash:hash(observerArea),actualSalesMarkupHash:hash(salesMarkup),transactionHarnessHash:hash(harness),sweetAlertScript:swal,
    isolation:'Actual app modules, sales rendering, dialogs, config editor and payroll Foods classifier. All Firestore reads/writes use the synthetic optimistic memory harness. No Firebase SDK, real identity, geolocation, printer, service worker or business endpoint. CSP connect-src none; fetch refuses. Fake auth is a local model only, not production authorization evidence.',
    limitations:'Generation/syntax checks do not prove browser geometry, live Rules, real staff PINs, platform cancellation/refund, real payroll posting or hardware. Cashier and Manager pages have separate synthetic databases.'};
files.set('source-manifest.json',JSON.stringify(manifest,null,2));
for(const output of targets){for(const [name,text] of files){const destination=path.join(output,name);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,text);}}
console.log(JSON.stringify({targets,fileCount:files.size,moduleCount:sources.size,actualSalesHash:manifest.actualSalesHash,sources:manifest.sources},null,2));
