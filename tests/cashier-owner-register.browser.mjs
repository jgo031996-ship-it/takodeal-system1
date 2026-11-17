// Actual Cashier HTML and entry functions in native headless Chrome; fictional
// SDK callbacks only. The separate emulator test verifies real database reads.
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=new URL('../Takodeal-POS/',import.meta.url),page=readFileSync(new URL('index.html',root),'utf8');
const extract=(from,to)=>page.slice(page.indexOf(from),page.indexOf(to));
const ui=extract('    function switchView(viewName)','    function closeModal(id)')+extract('    async function checkCurrentShift()','    function updateShiftUI(status)')+extract('window.loadSalesDashboard = async function','    function toggleTxMenu(id)');
const main=readFileSync(new URL('main.js',root),'utf8');
const mobileTabs=main.slice(main.indexOf('window.switchMobileTab = function'),main.indexOf('window.loadMobileHistory = async'));
const menu=extract('    window.renderMenuItems = function()', '    // --- 4. SHIFT & EXPENSE SYSTEM');
const script=`
import {installCashierOwnerRegister} from './cashier-owner-register.js';
const report=document.getElementById('owner-register-proof');
try{
 const setup=document.getElementById('deviceSetupOverlay');setup.style.display='flex';const setupOwner=setup.querySelector('[data-owner-access-portable]');if(!setupOwner)throw Error('Unregistered device hides Owner Access');setupOwner.disabled=false;window.ownerBypassLogin=()=>{window.fixtureSetupAccess=true;setup.style.display='none';};setupOwner.click();if(!window.fixtureSetupAccess||setup.style.display!=='none')throw Error('Setup Owner button failed');
 const db={},user={uid:'fictional'},auth={currentUser:user},session=Object.freeze({branch:'Agdao',workspaceKind:'verified-owner-workspace-v1'}),reads=[];
 const owner={db,user,auth,session,branch:'Agdao',assertCurrent(){if(window.sessionUser!==session)throw Error('changed');}};
 Object.assign(window,{sessionUser:session,currentShift:null,isCashierOwnerToolsMode:()=>window.sessionUser===session,getCashierOwnerWorkspaceContext:()=>owner,collection:(db,table)=>({db,table}),where:(field,op,value)=>({field,op,value}),limit:count=>({count}),orderBy:(field,direction)=>({field,direction}),query:(q,...filters)=>({...q,filters}),stopShiftSalesFeed(){},Swal:{fire:options=>{window.fixtureDetails=options;}}});
 window.cashierOwnerRegister=installCashierOwnerRegister(window,document,{setInterval:()=>1,clearInterval(){},subscribe(query,next){if(query.db!==db)throw Error('Wrong database');reads.push({query,next});return()=>{};}});
 for(const id of ['loginOverlay','pinOverlay','ownerAccessBtnContainer']){const n=document.getElementById(id);if(n)n.style.display='none';}
 window.switchView('sales');
 const emit=(index,rows)=>reads[index].next({metadata:{fromCache:false,hasPendingWrites:false},docs:rows.map(({id,...row})=>({id,data:()=>row,metadata:{fromCache:false}}))});
 const shift={id:'fictional-drawer',branch:'Agdao',active:true,startTime:new Date('2026-11-15T01:00:00Z'),cashier:'Fictional Crew'};
 emit(0,[shift]);emit(1,[{id:'fictional-sale',receiptId:'FICTIONAL-001',branch:'Agdao',shiftId:shift.id,timestamp:new Date('2026-11-15T03:00:00Z'),netTotal:240,paymentMethod:'Cash',cart:[{name:'Takoyaki',qty:2}]}]);
 const table=document.getElementById('tbTransBody');
 if(!table.textContent.includes('Total sales ₱240.00')||!document.getElementById('btnTopShift').textContent.includes('register open'))throw Error('Missing actual open status or sales totals');
 table.querySelector('[data-owner-receipt]').click();if(!window.fixtureDetails?.html.includes('FICTIONAL-001'))throw Error('Details click failed');
 let requested=null;window.cashierOwnerPOS={isReady:()=>true,hasPending:()=>false,changeReceipt:(id,receipt)=>{requested=[id,receipt];}};
 table.querySelector('[data-owner-void]').click();if(requested?.join('/')!=='fictional-sale/FICTIONAL-001')throw Error('Receipt action did not identify the displayed branch sale');
 window.loadMenuManager=async()=>{};
 const ticket={id:'customer-order',data:()=>({orderCode:'TEST-QUEUE',branch:'Agdao',status:'preparing',items:[],timestamp:new Date()})};
 window.getDocs=async()=>({docs:[]});window.getDocsFromServer=async q=>{if(q.db!==db)throw Error('Wrong order history account');return {docs:[ticket]};};
 window.onSnapshot=(query,next)=>{if(query.db!==db||query.table!=='incoming_orders'||!query.filters.some(f=>f.field==='branch'&&f.value==='Agdao'))throw Error('Wrong order queue');next({docs:[ticket]});return ()=>{};};
 const {installMobileHubUpgrade}=await import('./mobile-hub-upgrade.js');installMobileHubUpgrade(window,document);
 window.filterMenu=()=>{};window.renderCart=()=>{};window.cart=[];window.masterPOSData={items:[{id:'food',name:'Fictional takoyaki',category:'Food',price:65}],categories:['Food']};
 window.systemReady=false;window.posPlatform='Standard';window.currentGrandTotal=0;
 window.openAddOrderModal=(name,price)=>{window.cart.push({name,price});};
 await new Promise((ok,fail)=>{const script=document.createElement('script');script.onload=ok;script.onerror=fail;script.src='./cashier-pos-ui.js';document.body.append(script);});
 if(!document.getElementById('tkMobileDock'))window.dispatchEvent(new Event('load'));
 const dockClick=target=>{document.body.classList.add('tk-dock-visible');const button=document.querySelector('#tkMobileDock [data-target="'+target+'"]');if(!button)throw Error('Missing dock '+target);button.click();};
 dockClick('mobilehub');
 if(!document.getElementById('mobileHubListContainer').textContent.includes('TEST-QUEUE')||!document.getElementById('view-mobilehub').classList.contains('active')||document.getElementById('globalShiftLockout').style.display!=='none'||document.getElementById('topBarTitle').textContent!=='Orders')throw Error('Orders dock could not open the live branch');
 document.getElementById('btnMobHist').click();await new Promise(ok=>setTimeout(ok,0));
 if(!document.getElementById('mobileHubHistoryContainer').textContent.includes('TEST-QUEUE'))throw Error('Owner cannot open the selected branch order history');
 dockClick('pos');document.querySelector('#menuGrid .item-card')?.click();
 if(window.cart[0]?.name!=='Fictional takoyaki')throw Error('Owner cannot punch actual menu card without staff sign-in');
 if(document.getElementById('globalShiftLockout').style.display!=='none'||document.getElementById('btnMainPlaceOrder').disabled)throw Error('Verified Owner cannot use the actual POS');
 document.getElementById('btnTopShift').click();if(reads.length!==3)throw Error('View branch sales did not refresh the verified Owner connection');
 emit(2,[]);emit(3,[{id:'past-sale',receiptId:'PAST-001',branch:'Agdao',timestamp:new Date('2026-11-14T03:00:00Z'),netTotal:80}]);if(!table.textContent.includes('No open register is synced')||!table.textContent.includes('PAST-001'))throw Error('Missing-register history failed');window.fixtureSwitches=0;window.ownerBypassLogin=()=>window.fixtureSwitches++;table.querySelector('[data-owner-switch]').click();if(window.fixtureSwitches!==1)throw Error('Branch switch control failed');table.querySelector('[data-owner-range=latest]').click();table.querySelector('[data-owner-sales-date]').value='2026-11-15';table.querySelector('[data-owner-show-date]').click();if(reads.at(-1).query.filters.find(v=>v.op==='>=').value.toISOString()!=='2026-11-14T16:00:00.000Z')throw Error('Philippine sales-date range failed');
 window.sessionUser=null;window.dispatchEvent(new Event('cashier-workspace-changed'));if(table.textContent!=='Sign in to view branch sales.')throw Error('Logout retained branch sales');
 report.textContent='PASS: actual HTML, open register, cash totals, receipt details, Owner checkout and receipt action, remote close and logout';
}catch(error){report.textContent='FAIL: '+error.message;}
`;
const html=page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<output id="owner-register-proof">PENDING</output><script>const hiddenCategories=[];'+menu+mobileTabs+ui+'</script><script type="module">'+script+'</script></body>');
const server=createServer((request,response)=>{
 const path=new URL(request.url,'http://127.0.0.1').pathname;
 response.setHeader('Content-Security-Policy',"default-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
 if(path==='/'){response.setHeader('Content-Type','text/html');response.end(html);return;}
 try{const url=new URL('.'+path,root);if(!url.href.startsWith(root.href))throw Error('outside');const data=readFileSync(url);response.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'application/octet-stream');response.end(data);}catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=process.env.POS_BROWSER_EXECUTABLE||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);assert.ok(executable,'Native Chrome required');
try{for(const size of ['1280,900','412,915']){
 const profile=mkdtempSync(resolve(tmpdir(),'owner-register-browser-'));let out='',errors='';
 try{
  const child=spawn(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--user-data-dir='+profile,'--window-size='+size,'--virtual-time-budget=5000','--dump-dom','http://127.0.0.1:'+server.address().port]);
  child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>errors=(errors+data).slice(-4000));
  const timer=setTimeout(()=>child.kill(),20000);const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);assert.equal(code,0,errors);assert.match(out.match(/<output id="owner-register-proof">[^<]*/)?.[0]||errors,/<output id="owner-register-proof">PASS:/);console.log(size+': passed actual Cashier DOM and Owner entry/actions');
 }finally{rmSync(profile,{recursive:true,force:true});}
}}finally{await new Promise(resolve=>server.close(resolve));}
