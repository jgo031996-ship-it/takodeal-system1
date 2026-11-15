// Native Chrome, actual Cashier HTML and client modules, fictional broker data.
// No cloud account, real receipts or production database is used.
import {createServer} from 'node:http';import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';import {resolve,extname} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {simpleVoidFixture} from './helpers/simple-void-service-fixture.mjs';
const root=new URL('../Takodeal-POS/',import.meta.url),page=readFileSync(new URL('index.html',root),'utf8');
const ui=page.slice(page.indexOf('    function switchView(viewName)'),page.indexOf('    function closeModal(id)'));
const fixtures=new Map();for(const size of ['desktop','mobile'])for(const reason of ['OrderCancelled','WrongPunched'])fixtures.set(size+'-'+reason,await simpleVoidFixture(reason));
const script=`
import {installCashierVoid} from './cashier-void.js';import {createCashierVoidAccess} from './cashier-void-access.js';
const proof=document.getElementById('simple-void-proof'),scenario=new URL(location.href).searchParams.get('case'),wrong=scenario.endsWith('WrongPunched');
try{
 const config=await (await fetch('/config?case='+encodeURIComponent(scenario))).json();
 const user={uid:config.uid,isAnonymous:true,getIdToken:async()=> 'SYNTHETIC_TOKEN_01234567890123456789'},app={name:'FICTIONAL_APPROVED_DEVICE'},api={auth:{app,currentUser:user},db:{app}},primary={uid:'fictional-primary'};
 localStorage.setItem('takodeal_device_branch',config.branch);localStorage.setItem('takodeal_device_id',config.deviceId);
 Object.assign(window,{auth:{currentUser:primary},sessionUser:{staffId:config.staffId,cashierName:'Sample Cashier',branch:config.branch},currentShift:{active:true,shiftId:config.shiftId},cart:[],posPlatform:'Standard',platformCarts:{Standard:[],Grab:[],Foodpanda:[]},renderCart(){document.getElementById('simple-void-cart').textContent=JSON.stringify(window.cart);},stopShiftSalesFeed(){},loadSalesDashboard(){},systemReady:true});
 const dialogs=[];window.Swal={fire:async options=>{dialogs.push(options);if(options.title==='Why are you voiding this order?')return wrong?{isDenied:true}:{isConfirmed:true};if(options.input==='password')return {isConfirmed:true,value:'1234'};return {};}};
 const fetcher=async(url,options)=>{const path=new URL(url).pathname.replace('/cashRemittanceReview',''),response=await fetch('/api/'+scenario+path,options);return {ok:response.ok,status:response.status,url,redirected:false,type:'basic',text:()=>response.text()};};
 const access=createCashierVoidAccess(window,{resolveDevice:async({assertCurrent})=>{assertCurrent();return {api,actorUid:user.uid};},fetcher,now:()=>config.now});
 const controller=installCashierVoid(window,document,{access,fetcher,now:()=>config.now});
 for(const id of ['loginOverlay','pinOverlay','ownerAccessBtnContainer']){const node=document.getElementById(id);if(node)node.style.display='none';}
 const result=await controller.start(config.saleId,config.receiptId);if(!result.saved)throw Error(JSON.stringify(result));
 if(wrong){if(!result.restored||window.cart[0].name!=='6 Pcs Takoyaki'||!document.getElementById('view-pos').classList.contains('active'))throw Error('Wrong punch did not return to the actual POS cart view');window.cart[0].qty=2;window.renderCart();}
 else if(window.cart.length)throw Error('Cancelled receipt changed the current cart');
 if(dialogs.some(row=>row.title==='Receipt correction needs attention'||row.title==='Void and correct this order?'||row.title==='Cancel this saved order?'))throw Error('Routine void still requires a review screen');
 const recovery=document.getElementById('cashierVoidRecovery');if(!recovery.hidden||getComputedStyle(recovery).display!=='none')throw Error('An empty/manual verification panel remains visible');
 const saved=await (await fetch('/result?case='+encodeURIComponent(scenario))).json();if(saved.stock!==100||saved.status!=='Voided'||saved.alerts!==1)throw Error(JSON.stringify(saved));
 proof.textContent='PASS: '+scenario+' · direct void, security alert, one stock return and correct cart';
}catch(error){proof.textContent='FAIL: '+error.message;}
`;
const html=page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<output id="simple-void-proof">PENDING</output><output id="simple-void-cart"></output><script>'+ui+'</script><script type="module">'+script+'</script></body>');
const server=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,'http://127.0.0.1'),scenario=url.searchParams.get('case');response.setHeader('Content-Security-Policy',"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
  if(url.pathname==='/'){response.setHeader('Content-Type','text/html');response.end(html);return;}
  if(url.pathname==='/config'){const f=fixtures.get(scenario);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({...f.server.body,uid:f.backend.uid,now:f.backend.now()}));return;}
  if(url.pathname==='/result'){const f=fixtures.get(scenario);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({stock:f.h.get('inventory/sample-ingredient').currentStock,status:f.h.get('transactions/'+f.server.body.saleId).status,alerts:f.alerts().length}));return;}
  if(url.pathname.startsWith('/api/')){const [,name,...parts]=url.pathname.slice(1).split('/'),f=fixtures.get(name);let raw='';for await(const chunk of request)raw+=chunk;const result=await f.backend.request('/'+parts.join('/'),JSON.parse(raw));response.writeHead(result.status,{'Content-Type':'application/json'}).end(JSON.stringify(result.body));return;}
  const file=new URL('.'+url.pathname,root);if(!file.href.startsWith(root.href))throw Error('outside');response.setHeader('Content-Type',extname(file.pathname)==='.js'?'text/javascript':extname(file.pathname)==='.css'?'text/css':'application/octet-stream');response.end(readFileSync(file));
 }catch(error){response.writeHead(500).end(error.message);}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=process.env.POS_BROWSER_EXECUTABLE||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);assert.ok(executable,'Native Chrome required');
try{for(const [size,viewport]of [['desktop','1280,900'],['mobile','412,915']])for(const reason of ['OrderCancelled','WrongPunched']){
 const profile=mkdtempSync(resolve(tmpdir(),'simple-void-browser-'));let out='',errors='';
 try{const child=spawn(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--user-data-dir='+profile,'--window-size='+viewport,'--virtual-time-budget=8000','--dump-dom','http://127.0.0.1:'+server.address().port+'/?case='+size+'-'+reason]);child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>errors=(errors+value).slice(-4000));const timer=setTimeout(()=>child.kill(),25000),code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);assert.equal(code,0,errors);assert.match(out,/<output id="simple-void-proof">PASS:/,out.match(/<output id="simple-void-proof">[^<]*/)?.[0]);console.log(viewport+' '+reason+': actual Cashier DOM and broker passed');}finally{rmSync(profile,{recursive:true,force:true});}
}}finally{await new Promise(resolve=>server.close(resolve));}
