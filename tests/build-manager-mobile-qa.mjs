import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.resolve(checkout,'..');
const manager=path.join(checkout,'takodeal-manager'),staff=path.join(checkout,'takodeal-staff');
const options=new Map();
for(let index=2;index<process.argv.length;index+=2){const flag=process.argv[index],value=process.argv[index+1];if(!['--output','--mirror'].includes(flag)||!value||value.startsWith('--'))throw Error('Use --output <QA directory> and --mirror <served QA directory>.');options.set(flag,value);}
function target(flag,fallback){const value=path.resolve(options.get(flag)||fallback),relative=path.relative(work,value),inCheckout=path.relative(checkout,value);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!inCheckout.startsWith('..'))throw Error('QA output must remain within work and outside the source checkout.');return value;}
const targets=[target('--output',path.join(work,'manager-mobile-qa')),target('--mirror',path.join(work,'tablet-attendance-stock-qa','manager-mobile-review'))];
const [managerHTML,managerMain,staffHTML,staffPhone,appUpdate]=await Promise.all([
    readFile(path.join(manager,'index.html'),'utf8'),readFile(path.join(manager,'main.js'),'utf8'),
    readFile(path.join(staff,'index.html'),'utf8'),readFile(path.join(staff,'staff-phone.js'),'utf8'),readFile(path.join(staff,'app-update.js'),'utf8')
]);
function section(source,start,end){const at=source.indexOf(start),stop=source.indexOf(end,at);if(at<0||stop<=at)throw Error('Actual source section unavailable: '+start);return source.slice(at,stop);}
function element(source,id){
    const at=source.indexOf('id="'+id+'"');if(at<0)throw Error('Actual element unavailable: '+id);
    return outer(source,source.lastIndexOf('<',at));
}
function outer(source,start){
    const tag=source.slice(start).match(/^<([a-z][a-z\d-]*)\b/i)?.[1];if(start<0||!tag)throw Error('Unable to identify actual element.');
    const masked=source.replace(/<!--[\s\S]*?-->/g,comment=>' '.repeat(comment.length)),pattern=new RegExp('<\\/?'+tag+'\\b[^>]*>','gi');pattern.lastIndex=start;
    let depth=0,match;while((match=pattern.exec(masked))){depth+=match[0].startsWith('</')?-1:1;if(depth===0)return source.slice(start,pattern.lastIndex);}throw Error('Unclosed actual element: '+tag);
}
const auditMarkup=element(managerHTML,'generalAuditModal'),staffMarkup=['deviceAuthOverlay','loginOverlay','profileModal'].map(id=>element(staffHTML,id)).join('\n');
const auditEngine=section(managerMain,'window.globalAuditItems = [];','// 🏢 MULTI-TENANT BRANCH EXPANSION ENGINE');
const layout=await readFile(path.join(manager,'audit-modal-layout.js'),'utf8');
const auditCSS=await readFile(path.join(manager,'audit-modal.css'),'utf8');
const cleanCSS=text=>text.replace(/@import[^;]+;/g,'');
const [managerStyle,managerTheme,staffStyle,staffTheme]=await Promise.all([
    readFile(path.join(manager,'style.css'),'utf8'),readFile(path.join(manager,'manager-theme.css'),'utf8'),
    readFile(path.join(staff,'style.css'),'utf8'),readFile(path.join(staff,'staff-theme.css'),'utf8')
]);
const inlineStyles=source=>[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
const sampleStyle='*{box-sizing:border-box}.qa-controls{padding:16px;background:#fff;color:#173f32;font:14px/1.5 system-ui}.qa-controls button,.qa-controls a{min-height:44px;margin:4px;padding:10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#173f32}.qa-controls pre{white-space:pre-wrap}.qa-notice{position:fixed;bottom:2px;left:2px;z-index:11000;font:10px system-ui;color:#fff;background:#173f32;padding:3px 5px;pointer-events:none}.qa-confirm{max-width:min(420px,90vw);border:0;border-radius:14px;padding:20px}.qa-confirm::backdrop{background:#0008}.qa-confirm button{min-height:44px;margin:8px;padding:10px}';
const csp="default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self'";
const page=(title,body,script,styles)=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><title>LOCAL SAMPLE · '+title+'</title>'+styles.map(name=>'<link rel="stylesheet" href="'+name+'">').join('')+'<style>'+sampleStyle+'</style></head><body>'+body+'<script type="module" src="'+script+'"></script></body></html>';
const auditPage=page('Manager mobile audit','<main class="qa-controls"><h1>Local sample audit</h1><p>All inventory and writes below are synthetic. No Firebase SDK, network connection, production audit or printer is used.</p><button id="qaOpenAudit" type="button">Open actual audit form</button><a href="staff-login.html">Staff login sample</a><p id="qaAuditStatus" role="status"></p><pre id="qaAuditLedger"></pre></main>'+auditMarkup+'<div class="qa-notice">LOCAL SAMPLE · no live inventory</div><dialog id="qaConfirm" class="qa-confirm"><h2>Sample audit confirmation</h2><p id="qaConfirmText"></p><p>Only mock records are recorded in this preview.</p><button id="qaConfirmYes" type="button">Confirm sample audit</button><button id="qaConfirmNo" type="button">Cancel</button></dialog>','sample-audit.js',['actual-manager.css','audit-modal.css']);
const auditScript=String.raw`
const el=id=>document.getElementById(id),db=Object.freeze({sampleOnly:true}),writes=[];
const sampleInventory=[
 {id:'sample-chicken',name:'Sample Chicken Powder',category:'Ingredients',currentStock:1250,uom:'Gram',purchaseUom:'Pack',conversionRate:1000},
 {id:'sample-flour',name:'Sample F1 Flour',category:'Ingredients',currentStock:50000,uom:'Gram',purchaseUom:'Sack',conversionRate:25000},
 {id:'sample-milk',name:'Sample Milk',category:'Ingredients',currentStock:2400,uom:'Milliliter',purchaseUom:'Pack',conversionRate:1000},
 {id:'sample-bowl',name:'Sample Solo-Duo Paper Bowl',category:'Packaging',currentStock:200,uom:'Piece',purchaseUom:'Pack',conversionRate:50},
 {id:'sample-cup',name:'Sample Coffee Cup',category:'Packaging',currentStock:80,uom:'Piece',purchaseUom:'Pack',conversionRate:50},
 {id:'sample-lid',name:'Sample Coffee Lid',category:'Packaging',currentStock:65,uom:'Piece',purchaseUom:'Pack',conversionRate:50},
 {id:'sample-spoon',name:'Sample Spoon',category:'Packaging',currentStock:25,uom:'Piece',purchaseUom:'Piece',conversionRate:1},
 {id:'sample-tissue',name:'Sample Tissue',category:'Consumables',currentStock:25,uom:'Piece',purchaseUom:'Pack',conversionRate:100},
 {id:'sample-ice',name:'Sample Ice',category:'Consumables',currentStock:36000,uom:'Gram',purchaseUom:'Kilogram',conversionRate:1000}
];
const notify=message=>{el('qaAuditStatus').textContent=message;el('qaAuditLedger').textContent=JSON.stringify({sampleOnly:true,cloudRequests:0,productionWrites:0,mockWrites:writes},null,2);};
const collection=(_db,name)=>({name}),where=(...args)=>args,query=(collection,...filters)=>({collection,filters});
const getDocs=async()=>({forEach(callback){sampleInventory.forEach(item=>callback({id:item.id,data:()=>({...item})}));}});
Object.assign(window,{db,collection,query,where,getDocs,sessionUser:{cashierName:'Synthetic Reviewer'},
 doc:(_db,collection,id)=>({collection,id}),serverTimestamp:()=>({syntheticTimestamp:true}),
 updateDoc:async(ref,data)=>{writes.push({operation:'update',ref,data});notify('Actual audit handler recorded a mock stock update only.');},
 addDoc:async(collection,data)=>{writes.push({operation:'add',collection:collection.name,data});notify('Actual audit handler recorded a mock history/scorecard only.');},
 openAddInventoryModal:()=>notify('Adding inventory is unavailable in this sample; no records were created.'),
 ManagerUI:{notify,confirm(message){el('qaConfirmText').textContent=message;el('qaConfirm').showModal();return new Promise(resolve=>{const finish=value=>{el('qaConfirm').close();resolve(value);};el('qaConfirmYes').onclick=()=>finish(true);el('qaConfirmNo').onclick=()=>finish(false);el('qaConfirm').oncancel=()=>finish(false);});}},
 Swal:{fire:(title,text)=>{notify(String(title)+' '+String(text||''));return Promise.resolve({isConfirmed:false});}}
});
window.fetch=()=>Promise.reject(Error('All network requests are disabled in the local sample.'));
`+auditEngine+String.raw`
const layout=await import('./modules/audit-modal-layout.js');
if(typeof layout.installAuditModalLayout!=='function')throw Error('Actual audit viewport installer is unavailable.');
layout.installAuditModalLayout();
el('qaOpenAudit').onclick=async()=>{window.openGeneralAuditModal();el('auditModalBranch').value='Maa';await window.loadAuditModalItems();};
el('qaOpenAudit').click();notify('Type counts, filter and restore them, then submit if desired. Every write stays in this local sample.');
`;
const staffPage=page('Staff login and update','<div class="qa-controls" style="position:relative;z-index:30000"><details><summary>Local sample controls · no real PIN or device</summary><p>These are the actual Staff screens and update handler. The service-worker registration and reload are mocked.</p><button data-qa-stage="login" type="button">Show login</button><button data-qa-stage="register" type="button">Show device setup</button><button data-qa-stage="pending" type="button">Show pending device</button><button data-qa-stage="profile" type="button">Show profile</button><label><input id="qaOffline" type="checkbox"> Offline</label><label><input id="qaPunchBusy" type="checkbox"> Attendance saving</label><label><input id="qaUpdateFailure" type="checkbox"> Update failure</label><p id="qaStaffStatus" role="status"></p><pre id="qaStaffLedger"></pre><a href="audit.html">Manager audit sample</a></details></div>'+staffMarkup+'<div class="qa-notice">LOCAL SAMPLE · no live staff account</div>','sample-staff.js',['actual-staff.css']);
const staffActions=[...new Set([...staffMarkup.matchAll(/window\.([\w$]+)\s*\(/g)].map(match=>match[1]))].filter(name=>!['forceUpdateApp','loginStaff','requestDeviceAccess','retryDeviceRegistration','closeStaffProfile'].includes(name));
const staffScript=String.raw`
const el=id=>document.getElementById(id),state={updates:0,registrationReads:0,reloads:0,cloudRequests:0,productionWrites:0,deletedSavedData:0};
const notice=message=>{el('qaStaffStatus').textContent=message;el('qaStaffLedger').textContent=JSON.stringify(state,null,2);};
const registration={installing:null,waiting:null,async update(){state.updates++;if(el('qaUpdateFailure').checked)throw Error('Synthetic offline update failure');await new Promise(resolve=>setTimeout(resolve,100));notice('Actual update check finished against the mocked registration.');}};
globalThis.__qaNavigator={get onLine(){return !el('qaOffline').checked;},serviceWorker:{async getRegistration(){state.registrationReads++;return registration;}}};
globalThis.__qaWindow={get staffPunchBusy(){return el('qaPunchBusy').checked;},staffDeviceRegistrationBusy:false,
 location:{reload(){state.reloads++;notice('Actual handler requested a shell reload. This sample records it without reloading or deleting saved data.');}},
 Swal:{fire:(title,text)=>{notice(String(title)+': '+String(text||''));return Promise.resolve({isConfirmed:false});}}
};
window.fetch=()=>Promise.reject(Error('All network requests are disabled in the local sample.'));
const module=await import('./modules/staff-phone.js');module.installStaffAppUpdate(globalThis.__qaWindow,document,globalThis.__qaNavigator);
window.forceUpdateApp=(...args)=>globalThis.__qaWindow.forceUpdateApp(...args);
window.loginStaff=()=>notice('Secure Login is disabled in this sample. Do not enter a real PIN.');
window.requestDeviceAccess=window.retryDeviceRegistration=()=>notice('Device requests are disabled in this sample. No request was sent.');
window.closeStaffProfile=()=>{el('profileModal').style.display='none';el('loginOverlay').style.display='flex';};
document.addEventListener('click',event=>{if(event.target.closest('a[href="#"]'))event.preventDefault();});
function stage(name){el('deviceAuthOverlay').style.display=name==='register'||name==='pending'?'flex':'none';el('registerCard').style.display=name==='register'?'block':'none';el('pendingCard').style.display=name==='pending'?'block':'none';el('loginOverlay').style.display=name==='login'?'flex':'none';el('profileModal').style.display=name==='profile'?'flex':'none';notice('Actual '+name+' screen shown with no real account or PIN.');}
document.querySelectorAll('[data-qa-stage]').forEach(button=>button.onclick=()=>stage(button.dataset.qaStage));
stage('login');
`+'\nfor(const name of '+JSON.stringify(staffActions)+')window[name]=()=>notice("This action is disabled in the local sample. No staff records or private files were accessed.");\n';
const reviewPage=page('Mobile review','<main class="qa-controls"><h1>Actual mobile screens · local sample</h1><p>No Firebase connection, service worker, real audit, staff account or printer.</p><a href="audit.html">Open audit directly</a><a href="staff-login.html">Open Staff login directly</a><div><button data-size="320">320 px phone</button><button data-size="390">390 px phone</button><button data-size="768">768 px tablet</button><button data-height="820">Full viewport</button><button data-height="460">Short viewport (keyboard space)</button><button data-screen="audit.html">Audit form</button><button data-screen="staff-login.html">Staff login / update</button></div><iframe id="qaPhone" title="Actual phone-width sample" src="audit.html" style="display:block;width:390px;max-width:100%;height:820px;border:1px solid #cbd5e1;border-radius:12px;margin-top:12px"></iframe></main>','sample-review.js',[]);
const reviewScript="const frame=document.getElementById('qaPhone');document.querySelectorAll('[data-size]').forEach(button=>button.onclick=()=>frame.style.width=button.dataset.size+'px');document.querySelectorAll('[data-height]').forEach(button=>button.onclick=()=>frame.style.height=button.dataset.height+'px');document.querySelectorAll('[data-screen]').forEach(button=>button.onclick=()=>frame.src=button.dataset.screen);";
const sha=value=>createHash('sha256').update(value).digest('hex');

// Import the real presentation initializer and only its local module graph.
// No Firebase/core/auth/main entry is copied or imported into this preview.
const managerModules=new Map();
async function collectModule(name){
    if(managerModules.has(name))return;
    if(!/^[\w-]+\.js$/.test(name)||['main.js','auth.js','firebase-core.js','login-ui.js'].includes(name))throw Error('Unsafe Manager fixture module: '+name);
    const text=await readFile(path.join(manager,name),'utf8');managerModules.set(name,text);
    for(const match of text.matchAll(/\bimport\s+(?:(?:[^;]*?)\s+from\s+)?['"]([^'"]+)['"]\s*;/g)){
        if(!match[1].startsWith('./'))throw Error('Fixture imports must be local: '+match[1]);await collectModule(match[1].slice(2));
    }
}
await collectModule('manager-theme.js');
const managerCSSNames=(await readdir(manager)).filter(name=>name.endsWith('.css'));
const managerCSS=new Map(await Promise.all(managerCSSNames.map(async name=>[name,await readFile(path.join(manager,name),'utf8')])));
const actualHead=managerHTML.slice(0,managerHTML.indexOf('</head>'));
const managerHeadStyles=[...actualHead.matchAll(/<link\b[^>]*rel=['"]stylesheet['"][^>]*>/g)].map(match=>match[0].match(/href=['"]([^'"]+)['"]/)?.[1]?.split('?')[0]).filter(Boolean);
if(managerHeadStyles.some(name=>!managerCSS.has(name)))throw Error('All real Manager styles must be available locally.');
const managerMainMarkup=outer(managerHTML,managerHTML.indexOf('<main class="main-content"'));
const actualViews=[...managerMainMarkup.matchAll(/<(?:div|section)\b[^>]*id="(view-[\w-]+)"[^>]*>/g)].filter(match=>/class="[^"]*\bview\b/.test(match[0])).map(match=>match[1]);
const uniqueViews=[...new Set(actualViews)];if(!uniqueViews.length)throw Error('Actual Manager views are missing.');
const escapeAttribute=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function inertProductMarkup(markup){
    return markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/\s+on([a-z]+)\s*=\s*(["'])([\s\S]*?)\2/gi,(_all,event,_quote,handler)=>{
        if(event.toLowerCase()!=='click')return '';
        if(/(?:window\.)?toggleManagerSidebar\(\)/.test(handler))return ' data-qa-sidebar-toggle="true"';
        const route=handler.match(/(?:window\.)?switchView\(\s*['"]([^'"]+)['"]/);
        const tab=handler.match(/(?:window\.)?(switchInvTab|navToHr|switchHistoryTab|switchCustomerAppTab)\(\s*['"]([^'"]+)['"]/);
        return route?' data-qa-route="'+escapeAttribute(route[1])+'"':tab?' data-qa-tab-group="'+tab[1]+'" data-qa-tab="'+escapeAttribute(tab[2])+'"':'';
    });
}
const tabControls='<section id="qaManagerReviewBar" class="qa-controls"><details open><summary>LOCAL SAMPLE · actual Owner tabs</summary><p>Static controls and real presentation modules only. Dynamic feeds are empty; no populated report, permission, save or financial flow is verified here.</p><label for="qaManagerTab">View <select id="qaManagerTab"></select></label><button id="qaScanManagerTabs" type="button">Measure every static view</button><a href="audit.html">Audit sample</a><a href="staff-login.html">Staff login sample</a><p id="qaManagerTabStatus" role="status"></p><pre id="qaManagerTabReport" hidden></pre></details></section>';
const tabsMarkup=inertProductMarkup(element(managerHTML,'sidebar'))+inertProductMarkup(managerMainMarkup).replace(/^(<main[^>]*>)/,'$1'+tabControls);
const actualManagerStyleHead=[...actualHead.matchAll(/<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style>/gi)].map(match=>match[0]).filter(tag=>tag.startsWith('<style')||/rel=['"]stylesheet['"]/.test(tag)).map(tag=>tag.startsWith('<style')?tag:tag.replace(/href=(['"])([^'"]+)\1/,(_match,quote,value)=>'href='+quote+'styles/'+value.split('?')[0]+quote)).join('\n');
const managerTabsPage=page('All Owner tabs',tabsMarkup+'<div class="qa-notice">LOCAL SAMPLE · static tabs, no live data</div>','manager-tabs.js',[]).replace('<body>','<body class="manager-theme">').replace('<style>'+sampleStyle+'</style>',actualManagerStyleHead+'<style>'+inlineStyles(managerHTML.slice(managerHTML.indexOf('</head>')))+ '</style><style>'+sampleStyle+'</style>');
const responsiveEngine=section(managerMain,'// 📱 RESPONSIVE MOBILE ENGINE & TABLE AUTO-WRAPPER','// 📦 MAIN OFFICE AI SUPPLIER PURCHASE ORDER ENGINE');
const sidebarEngine=section(managerMain,'window.toggleManagerSidebar = function()','// 📜 ACCOUNT AUDIT LOGS ENGINE');
const dispatchRenderer=section(managerMain,'window.renderDispatchCart = function()','window.updateDispatchQty = function');
const managerTabsScript=String.raw`
const el=id=>document.getElementById(id),sampleNotice=text=>{el('qaManagerTabStatus').textContent=text;};
const snapshot=()=>({docs:[],empty:true,size:0,forEach(){}}),reference=(...parts)=>({path:parts.filter(value=>typeof value==='string').join('/')});
const blocked=async()=>{sampleNotice('Business action blocked. No production records were accessed or changed.');throw Error('All writes are disabled in the local sample.');};
const localDrafts=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:key=>localDrafts.get(String(key))??null,setItem:(key,value)=>localDrafts.set(String(key),String(value)),removeItem:key=>localDrafts.delete(String(key)),clear:()=>localDrafts.clear()},configurable:true});
Object.assign(window,{db:{sampleOnly:true},auth:{currentUser:{uid:'local-sample-owner',email:'jgo031996@gmail.com',emailVerified:true}},
 sessionUser:{uid:'local-sample-owner',email:'jgo031996@gmail.com',cashierName:'Synthetic Owner',role:'Owner',permissions:['all'],isOwner:true,allowedBranches:['All']},
 collection:reference,doc:reference,query:(...args)=>args,where:(...args)=>args,orderBy:(...args)=>args,limit:(...args)=>args,
 getDocs:async()=>snapshot(),getDocsFromServer:async()=>snapshot(),getDoc:async()=>({exists:()=>false,data:()=>({})}),getDocFromServer:async()=>({exists:()=>false,data:()=>({})}),
 addDoc:blocked,setDoc:blocked,updateDoc:blocked,deleteDoc:blocked,runTransaction:blocked,uploadBytes:blocked,getDownloadURL:blocked,
 serverTimestamp:()=>({sampleOnly:true}),ManagerUI:{notify:sampleNotice,confirm:async()=>false},
 Swal:{fire:async(...args)=>{sampleNotice('Sample-only message: '+String(args[0]?.title||args[0]||''));return {isConfirmed:false,isDismissed:true};},showLoading(){},close(){},isLoading:()=>false},
 isBranchAllowed:()=>true,loadAdminDashboard:async()=>{},loadBranchManager:async()=>{},loadPosConfigHub:async()=>{},
 switchView:name=>selectView('view-'+name)
});
window.fetch=()=>Promise.reject(Error('All network requests are disabled in this sample.'));
`+sidebarEngine+dispatchRenderer+String.raw`
window.dispatchInventoryList=[{id:'sample-dispatch-chicken',name:'Sample Chicken Powder',uom:'Gram',purchaseUom:'Pack',conversionRate:1000,currentStock:1250},{id:'sample-dispatch-bowl',name:'Sample Solo-Duo Paper Bowl',uom:'Piece',purchaseUom:'Pack',conversionRate:50,currentStock:500}];
window.dispatchCart=[{sourceId:'sample-dispatch-chicken',name:'Sample Chicken Powder',rawQty:2,qty:2000,selectedUom:'purch',convRate:1000,requestType:'Low Stock',physicalStock:500,systemStock:750},{sourceId:'sample-dispatch-bowl',name:'Sample Solo-Duo Paper Bowl',rawQty:2,qty:100,selectedUom:'purch',convRate:50}];
window.renderDispatchCart();
for(const node of el('dispatchCartBody').querySelectorAll('*'))for(const name of node.getAttributeNames())if(/^on/i.test(name))node.removeAttribute(name);
const knownViews=`+JSON.stringify(uniqueViews)+String.raw`;
const viewContainers=[...document.querySelectorAll('.main-content .view')],main=document.querySelector('.main-content');
function selectView(id){if(!knownViews.includes(id))return;for(const view of viewContainers)view.classList.toggle('active',view.id===id);el('qaManagerTab').value=id;main.scrollTop=0;if(id==='view-posconfig')window.loadPosConfigHub?.();sampleNotice('Actual '+id+' markup selected. Dispatch has a synthetic cart; other live feeds are intentionally unpopulated.');}
const module=await import('./modules/manager-theme.js');module.initManagerTheme({document,window});
const runManagerDomReady=callback=>callback();
`+responsiveEngine+String.raw`
for(const id of knownViews){const option=document.createElement('option');option.value=id;option.textContent=module.managerPageMeta(id.replace('view-','')).title+' ('+id+')';el('qaManagerTab').append(option);}
el('qaManagerTab').onchange=()=>selectView(el('qaManagerTab').value);
const inventoryPanels={Overview:'invTabLiveContent',AIBrief:'invSectionAIBrief',Yield:'invSectionYield',Audits:'invSectionAudits',Waste:'invSectionWaste',Prep:'invSectionPrepLogs',StockLogs:'invTabLogsContent',Invoices:'invSectionInvoices',Forecaster:'invSectionForecaster',Alerts:'invSectionAlerts'};
document.addEventListener('click',event=>{
 const control=event.target.closest('button,a,[data-qa-route],[data-qa-tab],[data-qa-sidebar-toggle]');if(!control)return;
 if(control.closest('#qaManagerReviewBar'))return;
 if(control.dataset.qaSidebarToggle){event.preventDefault();event.stopImmediatePropagation();window.toggleManagerSidebar();return;}
 if(control.dataset.qaRoute){event.preventDefault();event.stopImmediatePropagation();selectView('view-'+control.dataset.qaRoute);return;}
 if(control.dataset.qaTabGroup==='switchInvTab'){event.preventDefault();event.stopImmediatePropagation();selectView('view-inventory');for(const panel of Object.values(inventoryPanels)){const node=el(panel);if(node)node.style.display=panel===inventoryPanels[control.dataset.qaTab]?'block':'none';}return;}
 if(control.dataset.qaTabGroup==='navToHr'){event.preventDefault();event.stopImmediatePropagation();const key={Feed:'payroll',Schedule:'schedule',Ledger:'ledger',Inbox:'inbox',Sanctions:'payroll'}[control.dataset.qaTab];if(key)selectView('view-'+key);return;}
 if(control.closest('#nav-payroll,#nav-inventory')){event.preventDefault();event.stopImmediatePropagation();control.closest('#nav-payroll,#nav-inventory').parentElement.querySelector('.nav-submenu')?.classList.toggle('open');return;}
 // New workspaces' role=tab controls only switch presentation panels; business
 // action buttons and all stripped inline handlers remain blocked.
 if(control.getAttribute('role')==='tab')return;
 event.preventDefault();event.stopImmediatePropagation();sampleNotice('This business action is disabled in the static sample. No records were changed.');
},true);
function scrollContainer(node,root){for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement){const style=getComputedStyle(parent);if(/auto|scroll/.test(style.overflowX)&&parent.scrollWidth>parent.clientWidth+2)return parent;}return null;}
function measureView(id){const view=viewContainers.find(node=>node.id===id),width=document.documentElement.clientWidth,clips=[];
 for(const node of view.querySelectorAll('*')){if(!node.getClientRects().length||getComputedStyle(node).visibility==='hidden')continue;const rect=node.getBoundingClientRect();if(!rect.width||!rect.height||scrollContainer(node,view))continue;
  if(rect.left<-.5||rect.right>width+.5){clips.push({tag:node.tagName,id:node.id||'',className:String(node.className||'').slice(0,90),left:Math.round(rect.left),right:Math.round(rect.right),text:node.textContent.trim().slice(0,70)});if(clips.length>=25)break;}}
 const tables=[...view.querySelectorAll('table')].filter(node=>node.getClientRects().length).map(table=>({id:table.id||'',width:Math.round(table.getBoundingClientRect().width),containedHorizontalScroll:!!scrollContainer(table,view)}));
 return {id,viewportWidth:width,bodyScrollWidth:document.documentElement.scrollWidth,mainClientWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,bodyOverflow:document.documentElement.scrollWidth>width+2,clippedBoxes:clips,tables,dynamicData:id==='view-dispatch'?'Synthetic cart rendered with actual production function; no stock/posting verification':'Unpopulated; not verified'};
}
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
el('qaScanManagerTabs').onclick=async()=>{const previous=el('qaManagerTab').value,reports=[];for(const id of knownViews){selectView(id);await frame();reports.push(measureView(id));}selectView(previous);window.managerMobileSampleReport=reports;el('qaManagerTabReport').hidden=false;el('qaManagerTabReport').textContent=JSON.stringify(reports,null,2);sampleNotice('Measured '+knownViews.length+' unique actual views. Scrollable table internals are excluded from clipped boxes; duplicate Add-Ons markup remains unchanged.');};
window.ManagerMobileSample=Object.freeze({selectView,measureView,knownViews});
selectView('view-dashboard');document.body.append(document.createComment('Sample initial presentation mutation'));
`;
const managerTabModuleHashes=Object.fromEntries([...managerModules].map(([name,text])=>[name,sha(text)]));
const managerTabStyleHashes=Object.fromEntries([...managerCSS].map(([name,text])=>[name,sha(text)]));
const manifest={generatedAt:new Date().toISOString(),isolation:'Actual Manager audit markup/count/render/submit and viewport module; actual Staff login/setup/pending/profile markup and staff-phone/app-update modules. Mock inventory/writes and navigator/window update facades. No SDK/auth/production app/SW entry. CSP connect-src none + worker-src none.',sources:{managerIndex:sha(managerHTML),managerMain:sha(managerMain),auditCSS:sha(auditCSS),auditLayout:sha(layout),staffIndex:sha(staffHTML),staffPhone:sha(staffPhone),appUpdate:sha(appUpdate),staffTheme:sha(staffTheme)}};
manifest.managerStaticTabs={viewContainers:actualViews,uniqueViews,modules:managerTabModuleHashes,styles:managerTabStyleHashes,dispatchRenderer:sha(dispatchRenderer),sidebarEngine:sha(sidebarEngine),limitations:'Static view markup and real presentation initialization, synthetic Dispatch cart only, other empty mocked reads, all writes blocked, in-memory draft storage only; dynamic populated business flows are not verified.'};
for(const output of targets){
    await mkdir(path.join(output,'modules'),{recursive:true});
    await mkdir(path.join(output,'styles'),{recursive:true});
    await Promise.all([
        writeFile(path.join(output,'index.html'),reviewPage.replace('Audit form</button>','Audit form</button><button data-screen="manager-tabs.html">All Owner tabs</button>')),writeFile(path.join(output,'audit.html'),auditPage),writeFile(path.join(output,'staff-login.html'),staffPage),
        writeFile(path.join(output,'sample-audit.js'),auditScript),writeFile(path.join(output,'sample-staff.js'),staffScript),writeFile(path.join(output,'sample-review.js'),reviewScript),
        writeFile(path.join(output,'actual-manager.css'),cleanCSS(managerStyle+'\n'+inlineStyles(managerHTML)+'\n'+managerTheme)),
        writeFile(path.join(output,'actual-staff.css'),cleanCSS(staffStyle+'\n'+staffTheme+'\n'+inlineStyles(staffHTML))),writeFile(path.join(output,'audit-modal.css'),auditCSS),
        writeFile(path.join(output,'modules','audit-modal-layout.js'),layout),writeFile(path.join(output,'modules','app-update.js'),appUpdate),
        writeFile(path.join(output,'modules','staff-phone.js'),staffPhone),
        copyFile(path.join(staff,'logo.jpg'),path.join(output,'logo.jpg')),writeFile(path.join(output,'source-manifest.json'),JSON.stringify(manifest,null,2))
    ]);
    await Promise.all([
        writeFile(path.join(output,'manager-tabs.html'),managerTabsPage),writeFile(path.join(output,'manager-tabs.js'),managerTabsScript),
        ...[...managerModules].map(([name,text])=>writeFile(path.join(output,'modules',name),text)),
        ...[...managerCSS].flatMap(([name,text])=>[writeFile(path.join(output,'styles',name),text),writeFile(path.join(output,'modules',name),text),writeFile(path.join(output,name),text)])
    ]);
}
console.log(JSON.stringify({targets,sources:manifest.sources,uniqueManagerViews:uniqueViews.length,managerViewContainers:actualViews.length},null,2));
