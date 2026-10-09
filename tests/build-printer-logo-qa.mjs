import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','Takodeal-POS'),work=path.resolve(source,'..','..');
const options=new Map(),argumentsList=process.argv.slice(2);
for(let index=0;index<argumentsList.length;index+=2){const flag=argumentsList[index],value=argumentsList[index+1];if(!['--output','--mirror'].includes(flag)||!value||value.startsWith('--'))throw Error('Use --output <QA directory> and --mirror <served QA directory>.');options.set(flag,value);}
function output(flag,fallback){const target=path.resolve(options.get(flag)||fallback),relative=path.relative(work,target),insideSource=path.relative(path.dirname(source),target);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!insideSource.startsWith('..'))throw Error('QA output must stay in work outside the source checkout.');return target;}
const targets=[output('--output',path.join(work,'receipt-logo-sizing-qa')),output('--mirror',path.join(work,'tablet-attendance-stock-qa','printer-logo-sizing'))];
const workspace=await readFile(path.join(source,'cashier-workspace.js'),'utf8'),page=await readFile(path.join(source,'index.html'),'utf8');
function section(start,end){const at=workspace.indexOf(start),stop=workspace.indexOf(end,at);if(at<0||stop<=at)throw Error('Actual fixture section unavailable: '+start);return workspace.slice(at,stop);}
const pageHelper=section('function page(id,title,description)','\nfunction mountLegacy(');
let hub=section('function installPrinterHub(){','\nlet labelQueue=[];');
const labelAt=hub.indexOf('  const label='),openAt=hub.indexOf('  window.openPrinterManager=');
if(labelAt<0||openAt<labelAt)throw Error('Could not safely isolate actual receipt/prep controls from drink-label printing.');
hub=hub.slice(0,labelAt)+hub.slice(openAt).replaceAll('paintLabel();','');
const refresh=section('function refreshPrinters(){','\nfunction decorateInventory(){');
const blocks=[...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]);
const styles=[blocks[0],...await Promise.all(['cashier-pos-base.css','cashier-theme.css','cashier-tablet.css'].map(name=>readFile(path.join(source,name),'utf8'))),...blocks.slice(1)].join('\n').replace(/@import[^;]+;/g,'');
const app=String.raw`
const el=id=>document.getElementById(id),saved=new Map(),calls={connect:0,text:0,logo:0,logoJobs:0,sales:0,cutters:0,drawers:0,cloudWrites:0};
let printingMode='ble',logoMode='compatible',storageBlocked=false;
const state=Object.fromEntries(['main','kitchen','bar'].map(role=>[role,{mode:'ble',connected:false,status:'not-connected',name:'',result:null,logoResult:null}]));
const notice=message=>{document.getElementById('qaPrinterStatus').textContent=message;document.getElementById('qaPrinterLedger').textContent=JSON.stringify({savedLogoMode:logoMode,storageBlocked,...calls},null,2);};
const localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{if(storageBlocked)throw Error('Local sample: device storage unavailable.');saved.set(key,value);}};
window.Swal={fire:(title,message)=>{notice(title+': '+message);return Promise.resolve({isConfirmed:false});}};
window.getReceiptLogoMode=()=>logoMode;
window.setReceiptLogoMode=value=>{if(storageBlocked)throw Error('Local sample: device storage unavailable.');if(!['compatible','raster','none'].includes(value))throw Error('Choose a known logo mode.');logoMode=value;document.dispatchEvent(new Event('cashier-printer-state'));notice('Saved the sample logo preference only. No print was requested.');};
window.getPrinterDiagnostics=role=>({...state[role],mode:printingMode});
window.setPrinterMode=value=>{printingMode=value;document.dispatchEvent(new Event('cashier-printer-state'));notice('Sample transport preference changed. No Bluetooth or Android printer app was contacted.');};
window.connectSpecificPrinter=async(role,options)=>{calls.connect++;state[role]={...state[role],connected:true,status:'ready',name:'SYNTHETIC 58mm printer',service:'LOCAL QA ONLY',endpoint:'No hardware channel'};document.dispatchEvent(new Event('cashier-printer-state'));notice('Simulated '+(options?.replace?'replacement search':'connection')+' for '+role+'. No hardware connection.');};
window.testPrint=async(role,event)=>{calls.text++;state[role].result={status:'sent',message:'Synthetic text test recorded. Paper output is not confirmed.'};document.dispatchEvent(new Event('cashier-printer-result'));notice('Explicit text-test click on '+role+' ('+event.currentTarget.textContent+'). No bytes sent.');};
window.testPrinterLogo=async(role,event)=>{calls.logo++;if(logoMode!=='none')calls.logoJobs++;state[role].logoResult={status:logoMode==='none'?'skipped':'sent',message:logoMode==='none'?'Text only is selected. No logo test data was sent.':'Synthetic '+logoMode+' logo test recorded. Paper output is not confirmed.',bytes:logoMode==='none'?0:128};document.dispatchEvent(new Event('cashier-printer-result'));notice('Explicit main logo-test click ('+event.currentTarget.textContent+'). No bytes sent and no sale created.');};
window.switchView=id=>document.getElementById('view-'+id).classList.add('active');
`+pageHelper+'\n'+hub+'\n'+refresh+String.raw`
installPrinterHub();window.openPrinterManager();
const controls=document.createElement('details');controls.className='cashier-panel qa-printer-controls';controls.innerHTML='<summary>Local sample controls · no printer or live data</summary><p>These are the actual receipt/preparation Printer Hub controls. Their APIs are mocked, all network connections are blocked, and drink-label printing is omitted. Reload resets the sample.</p><div class="cashier-actions"><button type="button" id="qaPrinterStorage">Simulate blocked device storage</button><button type="button" id="qaPrinterConfirmed">Simulate confirmed logo on paper</button><button type="button" id="qaPrinterNoPaper">Simulate no logo on paper</button></div><p id="qaPrinterStatus" role="status"></p><pre id="qaPrinterLedger"></pre>';
document.querySelector('#view-printer .cashier-page-heading').after(controls);
el('qaPrinterStorage').onclick=()=>{storageBlocked=!storageBlocked;el('qaPrinterStorage').textContent=storageBlocked?'Restore sample device storage':'Simulate blocked device storage';notice('Device storage simulation changed; saved logo mode remains '+logoMode+'.');};
el('qaPrinterConfirmed').onclick=()=>{state.main.logoResult={status:'paper-confirmed',message:'Synthetic cashier confirmed the logo on paper. This is sample status only.'};document.dispatchEvent(new Event('cashier-printer-result'));notice('Sample confirmation set explicitly; no paper or hardware was used.');};
el('qaPrinterNoPaper').onclick=()=>{state.main.logoResult={status:'no-paper',message:'Synthetic cashier reports no logo on paper. Try another mode before receipt printing.'};document.dispatchEvent(new Event('cashier-printer-result'));notice('Sample no-paper result set explicitly; no print was replayed.');};
document.addEventListener('click',event=>{if(event.target.closest('a[href]')){event.preventDefault();notice('External setup link blocked in this local preview.');}});
notice('No printer actions have run. The initial preference is Compatible logo for 58mm. Use matching Width Scale and Height Scale in the Owner app to enlarge it.');
`;
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>LOCAL SAMPLE · Printer logo controls</title><link rel="stylesheet" href="actual-cashier-styles.css"><style>body{display:block}.content-area{width:100%;height:100dvh}.qa-printer-controls{padding:14px;margin-bottom:16px}.qa-printer-controls summary{cursor:pointer;min-height:44px;font-size:13px;font-weight:600;color:#68452d}.qa-printer-controls p{font-size:12px;line-height:1.6;margin:10px 0}.qa-printer-controls pre{font-size:12px;white-space:pre-wrap;padding:12px;background:#f8f4ec;border-radius:8px}.qa-printer-controls .cashier-actions{padding:8px 0}.view-container{display:none}.view-container.active{display:block}#nav-printer{font-size:12px;border:1px solid #eadfd2;border-radius:8px;background:white;padding:10px;min-height:44px}</style></head><body class="cashier-orange tk-ui-v2 tk-photo-pos"><main class="content-area"><header class="top-bar"><div class="top-title">Printer Hub · local sample</div><button type="button" id="nav-printer">Refresh Printer Hub</button></header></main><script type="module" src="sample-printer.js"></script></body></html>';
const sha=value=>createHash('sha256').update(value).digest('hex');
const manifest={generatedAt:new Date().toISOString(),workspaceSHA256:sha(workspace),indexSHA256:sha(page),tabletCSSSHA256:sha(await readFile(path.join(source,'cashier-tablet.css'))),isolation:'Actual Printer Hub receipt/prep DOM and handlers; all transport/test APIs local mocks; drink-label print section excluded; connect-src none'};
for(const target of targets){await mkdir(target,{recursive:true});await Promise.all([writeFile(path.join(target,'index.html'),html),writeFile(path.join(target,'sample-printer.js'),app),writeFile(path.join(target,'actual-cashier-styles.css'),styles),writeFile(path.join(target,'source-manifest.json'),JSON.stringify(manifest,null,2))]);}
console.log(JSON.stringify({targets,workspaceSHA256:manifest.workspaceSHA256},null,2));
