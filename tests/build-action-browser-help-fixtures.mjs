// Local UI review only. Production modules/styles are copied verbatim; receipt,
// clipboard and identity changes operate on mock data with no Firebase imports.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]||resolve(root,'../staff-nextlevel-qa'));
mkdirSync(output,{recursive:true});
const read=name=>readFileSync(resolve(root,name),'utf8');
for(const [from,to] of [
 ['Takodeal-POS/sales-actions.js','sales-actions.fixture.js'],
 ['Takodeal-POS/sales-actions.css','sales-actions.fixture.css'],
 ['Customer/customer-browser-help.js','customer-browser-help.fixture.js'],
 ['Customer/customer-browser-help.css','customer-browser-help.fixture.css']
])writeFileSync(resolve(output,to),read(from));
const page=read('Takodeal-POS/index.html');
const actionBase=page.split('\n').filter(line=>/^\s*\.(dot-menu|action-dropdown|action-item)(?:[ .{])/.test(line)).join('\n');
const shared=`*{box-sizing:border-box;}body{margin:0;font-family:Inter,'Segoe UI',sans-serif;background:#fbf6ef;color:#49372b;}button{font:inherit;cursor:pointer;border:1px solid #eadfd2;border-radius:8px;min-height:40px;padding:8px 12px;background:white;color:inherit;}button:focus-visible{outline:3px solid #c65c24;outline-offset:2px;}h1{font-size:20px;margin:0;}p{font-size:13px;line-height:1.5;} .qa-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#8b7868;} .qa-status{border:1px solid #eadfd2;background:white;padding:10px 14px;border-radius:9px;font-size:13px;}`;
const sales=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt Action menu · local QA</title><style>${shared}
${actionBase}
body{height:100dvh;display:flex;flex-direction:column;overflow:hidden;}header{padding:12px 16px;background:#fffaf3;border-bottom:1px solid #eadfd2;flex:none;}header p{margin:6px 0 0;}
.qa-controls{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;flex:none;} .qa-controls button{font-size:12px;}
#view-sales{flex:1;min-height:0;padding:10px 12px;overflow:hidden;} .qa-clipped-card{height:100%;min-height:0;border:2px dashed #c6a587;background:white;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
.qa-card-title{padding:10px 12px;flex:none;font-size:13px;border-bottom:1px solid #eadfd2;} .table-responsive{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y;}
table{width:100%;min-width:580px;border-collapse:collapse;font-size:13px;}th,td{padding:12px;border-bottom:1px solid #eadfd2;text-align:left;}th{position:sticky;top:0;background:#fff6eb;z-index:1;}tbody tr:nth-child(even){background:#fffdfa;}td:last-child{width:110px;}
#view-other{display:none;flex:1;min-height:0;overflow:auto;padding:16px;} .qa-status{margin:0 12px 10px;flex:none;min-height:42px;}@media(max-height:420px){header p{display:none;}.qa-controls{padding:6px 12px;}header{padding:8px 16px;}th,td{padding:9px 12px;}}
</style><link rel="stylesheet" href="sales-actions.fixture.css"></head><body>
<header><div class="qa-label">Local UI review · mock sales</div><h1>Receipt Action menu</h1><p>Scroll to the last receipt. Its Action menu should stay inside the screen, above the dashed clipping panel when needed.</p></header>
<div class="qa-controls"><button id="rerender">Refresh rows</button><button id="delayed-rerender">Refresh in 3 seconds</button><button id="view-toggle">Change view</button><button id="branch-toggle">Branch: Maa</button><button id="shift-toggle">Shift: Sample A</button><button id="last-row">Show last receipt</button></div>
<section id="view-sales" class="view-container active"><div class="qa-clipped-card"><div class="qa-card-title">Shift Sales · sample receipts only</div><div class="table-responsive" id="receiptScroller"><table><thead><tr><th>Receipt</th><th>Customer</th><th>Payment</th><th>Amount</th><th>Action</th></tr></thead><tbody id="tbTransBody"></tbody></table></div></div></section>
<section id="view-other" class="view-container"><h2>Sample alternate view</h2><p>Receipt menus should close when you leave Shift Sales. Use Change view to return.</p></section>
<div id="sampleActionStatus" class="qa-status" role="status">No receipt action selected. No stock or financial data is connected.</div>
<script type="module">
import {installSalesActions} from './sales-actions.fixture.js';
window.sessionUser={branch:'Maa'};window.currentShift={shiftId:'sample-A'};
const status=document.getElementById('sampleActionStatus');let generation=1;
window.viewReceiptDetails=id=>{status.textContent='Sample receipt details selected: '+id+'. No live receipt was read.';};
window.reprintDashboardReceipt=id=>{status.textContent='Sample print selected: '+id+'. No printer job was sent.';};
window.voidTx=id=>{status.textContent='Sample void selected: '+id+'. No transaction was changed.';};
function render(){document.getElementById('tbTransBody').replaceChildren(...Array.from({length:12},(_,i)=>{
 const id='QA-'+generation+'-'+String(i+1).padStart(2,'0');
 const row=document.createElement('tr');row.innerHTML='<td>'+id+'</td><td>Sample customer '+(i+1)+'</td><td>Cash</td><td>₱120.00</td>';
 const cell=document.createElement('td'),wrap=document.createElement('div'),button=document.createElement('button'),menu=document.createElement('div');
 wrap.style.position='relative';button.className='dot-menu';button.textContent='⚙ Action ▼';button.style.cssText='background:white;border:1px solid #cbd5e1;padding:6px 12px;border-radius:6px;font-size:11px;';
 menu.className='action-dropdown';menu.id='txMenu-'+i;menu.style.cssText='right:0;top:100%;margin-top:5px;width:160px;';button.onclick=()=>window.cashierSalesActions.toggle(menu.id);
 for(const [label,handler,danger] of [['🔍 View Details',window.viewReceiptDetails,false],['🖨 Print Receipt',window.reprintDashboardReceipt,false],['🗑 Void Transaction',window.voidTx,true]]){
  const item=document.createElement('div');item.className='action-item'+(danger?' danger':'');item.textContent=label;item.onclick=()=>handler(id);menu.append(item);
 }
 wrap.append(button,menu);cell.append(wrap);row.append(cell);return row;
 }));}
render();installSalesActions();
document.getElementById('rerender').onclick=()=>{generation++;render();status.textContent='Rows refreshed with new sample receipt IDs.';};
document.getElementById('delayed-rerender').onclick=()=>{status.textContent='Open an Action menu now. Rows refresh in 3 seconds.';setTimeout(()=>{generation++;render();status.textContent='Rows refreshed. The previous receipt menu should be closed.';},3000);};
document.getElementById('view-toggle').onclick=()=>{const sales=document.getElementById('view-sales'),other=document.getElementById('view-other'),active=sales.classList.toggle('active');sales.style.display=active?'block':'none';other.classList.toggle('active',!active);other.style.display=active?'none':'block';status.textContent=active?'Returned to Shift Sales.':'Changed view. The receipt menu should be closed.';};
document.getElementById('branch-toggle').onclick=event=>{window.sessionUser.branch=window.sessionUser.branch==='Maa'?'Cabantian':'Maa';event.target.textContent='Branch: '+window.sessionUser.branch;status.textContent='Mock branch changed. No live account or branch settings changed.';};
document.getElementById('shift-toggle').onclick=event=>{window.currentShift.shiftId=window.currentShift.shiftId==='sample-A'?'sample-B':'sample-A';event.target.textContent='Shift: '+(window.currentShift.shiftId==='sample-A'?'Sample A':'Sample B');status.textContent='Mock shift changed. No shift records changed.';};
document.getElementById('last-row').onclick=()=>{const panel=document.getElementById('receiptScroller');panel.scrollTop=panel.scrollHeight;panel.scrollLeft=panel.scrollWidth;};
</script></body></html>`;
writeFileSync(resolve(output,'sales-actions.html'),sales);
const customer=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer browser help · local QA</title><style>${shared}
body{background:#f4f7f2;color:#173f35;} .qa-shell{max-width:900px;margin:16px auto;padding:0 16px;} .qa-brand{padding:16px;border-radius:12px;background:#173f35;color:white;} .qa-controls{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0;} .qa-example{padding:16px;background:white;border:1px solid #dce6df;border-radius:12px;} .qa-example p{margin-bottom:0;}
</style><link rel="stylesheet" href="customer-browser-help.fixture.css"></head><body>
<main class="qa-shell"><header class="qa-brand"><div class="qa-label" style="color:#dcc68a;">Local UI review · mocked iPhone Messenger</div><h1>TAKODEÁL ordering</h1></header><div class="qa-controls"><button id="clipboard-mode">Mock copy: succeeds</button><button id="reset-help">Show browser help again</button><button id="normal-browser">Use regular Safari</button></div>
<div id="copyResult" class="qa-status" role="status">Clipboard is mocked. Copying will only display the sanitized sample link here.</div>
<section class="qa-example" style="margin-top:16px;"><h2 style="font-size:18px;">Sample ordering page</h2><p>Expand “How to open in Safari” above. The shown link must have no customer, login, tracking, branch or order query information.</p><p>The input URL uses fake details on <strong>ordering.example.test</strong>; no external website is opened.</p></section></main>
<script type="module">
import {installBrowserHelp} from './customer-browser-help.fixture.js';
const memory=new Map();let failCopy=false,regularBrowser=false;
const mockWindow={navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/MessengerForiOS;FBAV/500.0]',maxTouchPoints:5,clipboard:{writeText:async text=>{if(failCopy)throw Error('Mock clipboard unavailable');document.getElementById('copyResult').textContent='Mock copied link: '+text;}}},location:{href:'https://ordering.example.test/?fbclid=sample-tracking&branch=Maa&customer=sample-customer&code=sample-login#order=sample-private'},sessionStorage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)}};
function show(){document.getElementById('customerBrowserHelp')?.remove();memory.clear();mockWindow.navigator.userAgent=regularBrowser?'Mozilla/5.0 iPhone Safari/605.1.15':'Mozilla/5.0 iPhone [FBAN/MessengerForiOS;FBAV/500.0]';installBrowserHelp(mockWindow,document);}
show();
document.getElementById('clipboard-mode').onclick=event=>{failCopy=!failCopy;event.target.textContent='Mock copy: '+(failCopy?'fails (manual selection)':'succeeds');document.getElementById('copyResult').textContent=failCopy?'Copy will fail safely and select the clean link for manual copying.':'Clipboard is mocked. No system clipboard writes.';};
document.getElementById('reset-help').onclick=()=>{regularBrowser=false;document.getElementById('normal-browser').textContent='Use regular Safari';show();};
document.getElementById('normal-browser').onclick=event=>{regularBrowser=!regularBrowser;event.target.textContent=regularBrowser?'Use Messenger again':'Use regular Safari';show();document.getElementById('copyResult').textContent=regularBrowser?'Regular Safari: browser guidance should be absent.':'Mock Messenger: Safari guidance is shown again.';};
</script></body></html>`;
writeFileSync(resolve(output,'customer-browser-help.html'),customer);
console.log(resolve(output,'sales-actions.html'));console.log(resolve(output,'customer-browser-help.html'));
