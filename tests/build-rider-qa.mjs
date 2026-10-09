import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Local review only: this generator copies actual app modules and replaces only
// the Firebase transport and browser device surfaces. It never contacts Firebase.
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','takodeal-delivery');
const work=path.resolve(source,'..','..');
const targets=[path.join(work,'rider-mobile-qa'),path.join(work,'tablet-attendance-stock-qa','rider')];
const sha=value=>createHash('sha256').update(value).digest('hex');
const sdk=String.raw`
const records=new Map(),listeners=new Set(),blobs=new Map(),events=[];
const counters={reads:0,transactions:0,writes:0,uploads:0,walletDebits:0,ackLosses:0};
const auth={currentUser:null},authListeners=new Set();
let queue=Promise.resolve(),loseClaimAck=false;
const clone=value=>value===undefined?undefined:structuredClone(value);
const stamp=()=>({seconds:Math.floor(Date.now()/1000),nanoseconds:0});
const riderId='qa-pending-rider';
records.set('riders/'+riderId,{name:'Sample Rider — no personal data',phone:'09000000000',pin:'1234',vehicle:'Sample motorcycle',plateNumber:'QA-ONLY',status:'pending_approval',walletBalance:1000,rating:5,totalDeliveries:0,fleetType:'Main Office',franchiseAccess:true,isAcceptingOrders:false,allowedBranches:['Sample Branch'],joinedAt:stamp()});
records.set('incoming_orders/qa-ready-cash',{branch:'Sample Branch',orderCode:'QA-001',orderType:'Delivery',status:'ready',customerName:'Sample customer',deliveryAddress:'Synthetic drop-off — no actual address',contactNumber:'09000000001',totalAmount:250,deliveryFee:40,paymentMode:'Cash',customerLat:0,customerLng:0});
const notice=()=>window.dispatchEvent(new CustomEvent('qa-data-updated'));
const snapshot=reference=>({id:reference.id,ref:reference,metadata:{fromCache:false},exists:()=>records.has(reference.path),data:()=>clone(records.get(reference.path))});
function result(target){
 if(target.kind==='doc')return snapshot(target);
 const docs=[...records.keys()].filter(key=>key.startsWith(target.path+'/')&&key.slice(target.path.length+1).indexOf('/')<0).map(key=>snapshot(doc({},key)));
 const filtered=docs.filter(row=>(target.filters||[]).every(filter=>{const actual=filter.field.split('.').reduce((value,key)=>value?.[key],row.data());return filter.op==='in'?filter.value.includes(actual):filter.op==='=='?actual===filter.value:filter.op==='array-contains'?Array.isArray(actual)&&actual.includes(filter.value):false;}));
 return {docs:filtered,metadata:{fromCache:false},forEach:fn=>filtered.forEach(fn),docChanges:()=>filtered.map(row=>({type:'added',doc:row}))};
}
function signature(value){return value.docs?JSON.stringify(value.docs.map(row=>[row.id,row.data()])):JSON.stringify(value.data());}
function deliver(listener,first=false){if(!listener.active)return;try{const current=result(listener.target),nextSignature=signature(current);if(!first&&nextSignature===listener.signature)return;listener.signature=nextSignature;
 if(current.docs){const previous=listener.previous||new Map(),next=new Map(current.docs.map(row=>[row.id,row]));current.docChanges=()=>[...current.docs.map(row=>({type:previous.has(row.id)?'modified':'added',doc:row})),...[...previous.values()].filter(row=>!next.has(row.id)).map(row=>({type:'removed',doc:row}))];listener.previous=next;}
 listener.next(current);}catch(error){listener.error?.(error);}}
function publish(){notice();for(const listener of listeners)queueMicrotask(()=>deliver(listener));}
export const initializeApp=()=>({name:'local-qa-only'}),getFirestore=()=>({localQA:true}),getStorage=()=>({localQA:true}),getAuth=()=>auth;
export async function signInAnonymously(){auth.currentUser={uid:'qa-anonymous-session'};for(const fn of authListeners)queueMicrotask(()=>fn(auth.currentUser));return {user:auth.currentUser};}
export function onAuthStateChanged(_auth,fn){authListeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return ()=>authListeners.delete(fn);}
export const collection=(_db,...parts)=>({kind:'collection',path:parts.join('/'),filters:[]});
export const doc=(_db,...parts)=>{const value=parts.join('/');return {kind:'doc',path:value,id:value.split('/').pop()};};
export const where=(field,op,value)=>({field,op,value});
export const query=(reference,...filters)=>({...reference,filters:[...(reference.filters||[]),...filters]});
export async function getDoc(reference){counters.reads++;return snapshot(reference);}
export const getDocFromServer=getDoc;
export async function getDocs(reference){counters.reads++;return result(reference);}
export const getDocsFromServer=getDocs;
export const serverTimestamp=stamp;
export const arrayUnion=(...values)=>({__qaArrayUnion:values});
function applyPatch(old,patch){const value={...clone(old)};for(const [key,next] of Object.entries(patch)){if(next?.__qaArrayUnion)value[key]=[...new Set([...(value[key]||[]),...next.__qaArrayUnion])];else value[key]=clone(next);}return value;}
export function runTransaction(_db,handler){const pending=queue.then(async()=>{counters.transactions++;const writes=[];let writing=false;
 const tx={get:async reference=>{if(writing)throw Error('QA transaction: all reads must precede writes.');counters.reads++;return snapshot(reference);},set:(reference,value,options)=>{writing=true;writes.push({reference,value,merge:options?.merge===true});},update:(reference,value)=>{if(!records.has(reference.path))throw Error('QA record missing: '+reference.path);writing=true;writes.push({reference,value,merge:true});}};
 const answer=await handler(tx);for(const {reference,value,merge} of writes){const old=records.get(reference.path),next=merge?applyPatch(old,value):clone(value);if(reference.path.startsWith('riders/')&&typeof value.walletBalance==='number'&&Number(old?.walletBalance)>value.walletBalance)counters.walletDebits++;records.set(reference.path,next);counters.writes++;events.push({path:reference.path,fields:Object.keys(value),at:new Date().toISOString()});}
 publish();if(loseClaimAck&&writes.some(write=>write.value.riderClaim)){loseClaimAck=false;counters.ackLosses++;const error=Error('LOCAL QA: save committed, but its acknowledgement was deliberately lost. Retry the same sample claim.');error.code='unavailable';throw error;}return answer;});queue=pending.catch(()=>{});return pending;}
export const updateDoc=(reference,value)=>runTransaction({},async tx=>{await tx.get(reference);tx.update(reference,value);});
export function onSnapshot(target,...args){const next=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2],listener={target,next,error,active:true};listeners.add(listener);queueMicrotask(()=>deliver(listener,true));return ()=>{listener.active=false;listeners.delete(listener);};}
export const ref=(_storage,value)=>({fullPath:value});
export async function uploadBytes(reference,file){if(!file?.name?.startsWith('qa-synthetic-')||!file.size)throw Error('LOCAL QA only accepts its generated synthetic photo. Use the sample-photo button.');blobs.set(reference.fullPath,file);counters.uploads++;notice();return {ref:reference};}
export async function getDownloadURL(reference){if(!blobs.has(reference.fullPath))throw Error('No local synthetic upload found.');return 'https://sample.invalid/'+reference.fullPath.split('/').map(encodeURIComponent).join('/');}
export const qa={riderId,counters,events,records,async status(status){const id=window.currentRider?.id||riderId;await updateDoc(doc({},'riders',id),{status,isAcceptingOrders:false,statusReviewedAt:stamp(),statusReviewedBy:'fake-manager@example.invalid'});},loseAck(){loseClaimAck=true;notice();},summary(){const current=records.get('riders/'+(window.currentRider?.id||riderId));return {riderStatus:current?.status,wallet:current?.walletBalance,availability:current?.isAcceptingOrders,order:records.get('incoming_orders/qa-ready-cash')?.status,claim:records.get('incoming_orders/qa-ready-cash')?.riderClaim?.operationId||null,...counters,activeListeners:listeners.size,network:'Disabled by CSP; local SDK only'};}};
window.qa=qa;
`;
const prelude=String.raw`
// Device surfaces are local fakes. No real location permission is requested.
const memory=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key),clear:()=>memory.clear()}});
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){queueMicrotask(()=>success({coords:{latitude:0,longitude:0,accuracy:1},timestamp:Date.now()}));},watchPosition(){throw Error('Real GPS is disabled in this fixture.');},clearWatch(){}}});
window.Audio=class{play(){return Promise.resolve();}pause(){}};
document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link&&/^https?:|^tel:/i.test(link.getAttribute('href'))){event.preventDefault();document.getElementById('qaOutcome').textContent='External navigation blocked: this is a local sample.';}});
window.addEventListener('error',event=>{const output=document.getElementById('qaOutcome');if(output)output.textContent='Runtime error: '+event.message;});
window.addEventListener('unhandledrejection',event=>{const output=document.getElementById('qaOutcome');if(output)output.textContent='Runtime rejection: '+(event.reason?.message||String(event.reason));});
`;
const ui=String.raw`
import {qa} from './qa-sdk.js';
const byId=id=>document.getElementById(id);
const sampleFile=()=>new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;const ctx=canvas.getContext('2d');ctx.fillStyle='#14332d';ctx.fillRect(0,0,640,320);ctx.fillStyle='#fff';ctx.font='bold 26px sans-serif';ctx.fillText('SYSTEM VERIFICATION',36,120);ctx.fillText('NO PERSONAL / STAFF DATA',36,165);ctx.font='18px sans-serif';ctx.fillText('LOCAL SAMPLE — NOT A REAL ID OR DELIVERY',36,212);canvas.toBlob(blob=>resolve(new File([blob],'qa-synthetic-verification.jpg',{type:'image/jpeg',lastModified:1})), 'image/jpeg',.8);});
function assignFile(input,file){const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
let popup=null,loading=false,resolvePopup=null;
window.Swal={fire:async options=>{if(popup)throw Error('Finish the current local dialog first.');const dialog=document.createElement('dialog');dialog.className='swal2-popup qa-dialog';dialog.innerHTML='<h2></h2><p class="qa-dialog-text"></p><div class="qa-dialog-html"></div><div class="qa-dialog-input"></div><p class="qa-dialog-validation" role="status"></p><div class="qa-dialog-actions"></div>';dialog.querySelector('h2').textContent=options.title||'Sample action';dialog.querySelector('.qa-dialog-text').textContent=options.text||'';dialog.querySelector('.qa-dialog-html').innerHTML=options.html||'';
 if(options.input==='file'){const input=document.createElement('input');input.type='file';input.className='swal2-file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('aria-label','Synthetic proof photo');dialog.querySelector('.qa-dialog-input').append(input);}
 const inputs=[...dialog.querySelectorAll('input[type=file]')];if(inputs.length){const button=document.createElement('button');button.textContent='Use synthetic verification photo';button.className='rider-button secondary';button.onclick=async()=>{const file=await sampleFile();inputs.forEach(input=>assignFile(input,file));};dialog.querySelector('.qa-dialog-input').append(button);}
 const action=dialog.querySelector('.qa-dialog-actions'),confirm=document.createElement('button');confirm.className='rider-button';confirm.textContent=options.confirmButtonText||'OK';const finish=value=>{dialog.close();dialog.remove();popup=null;loading=false;resolvePopup?.(value);resolvePopup=null;};confirm.onclick=async()=>{if(loading)return;loading=true;confirm.disabled=true;dialog.querySelector('.qa-dialog-validation').textContent='';try{let value=options.input==='file'?dialog.querySelector('input[type=file]').files[0]:true;if(options.inputValidator){const error=await options.inputValidator(value);if(error){Swal.showValidationMessage(error);return;}}if(options.preConfirm)value=await options.preConfirm();if(value===false)return;finish({isConfirmed:true,value});}catch(error){Swal.showValidationMessage(error.message);}finally{loading=false;confirm.disabled=false;}};action.append(confirm);
 if(options.showCancelButton){const cancel=document.createElement('button');cancel.className='rider-button secondary';cancel.textContent='Cancel';cancel.onclick=()=>finish({isConfirmed:false});action.append(cancel);}
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(!loading)finish({isConfirmed:false});});document.body.append(dialog);popup=dialog;dialog.showModal();options.didOpen?.();return new Promise(resolve=>{resolvePopup=resolve;});},showValidationMessage(message){popup?.querySelector('.qa-dialog-validation').replaceChildren(document.createTextNode(String(message)));},isLoading:()=>loading,close(){if(popup){popup.close();popup.remove();popup=null;resolvePopup?.({isConfirmed:false});resolvePopup=null;}}};
const render=()=>{byId('qaLedger').textContent=JSON.stringify(qa.summary(),null,2);byId('qaLog').textContent=qa.events.slice(-8).map(event=>event.path+' ← '+event.fields.join(', ')).join('\n')||'No local writes yet.';};
window.addEventListener('qa-data-updated',render);
const action=(id,fn)=>byId(id).addEventListener('click',async()=>{try{if(window.isRiderOperationBusy?.()){byId('qaOutcome').textContent='Finish the current Rider action first.';return;}await fn();byId('qaOutcome').textContent='Local sample action completed.';}catch(error){byId('qaOutcome').textContent=error.message;}finally{render();}});
action('qaFillLogin',()=>{byId('loginPhone').value='09000000000';byId('loginPin').value='1234';window.showRiderAuthView('login');});
action('qaApprove',()=>qa.status('active'));action('qaReject',()=>qa.status('rejected'));action('qaSuspend',()=>qa.status('banned'));action('qaPending',()=>qa.status('pending_approval'));
action('qaLoseAck',()=>qa.loseAck());action('qaRetryClaim',()=>window.claimDelivery('qa-ready-cash'));
action('qaRegistration',async()=>{window.showRiderAuthView('register');for(const [id,value] of Object.entries({regName:'Synthetic Registration Sample',regPhone:'09000000002',regVehicle:'Sample motorcycle',regPlate:'QA-REG-ONLY',regPin:'1234',regPinConfirm:'1234'}))byId(id).value=value;const file=await sampleFile();['regLicense','regORCR','regSelfie'].forEach(id=>assignFile(byId(id),file));});
byId('qaPanelToggle').addEventListener('click',()=>{const panel=byId('qaPanel');panel.hidden=!panel.hidden;byId('qaPanelToggle').setAttribute('aria-expanded',String(!panel.hidden));});
render();
`;
const controls=String.raw`
<button id="qaPanelToggle" type="button" aria-expanded="false">Local sample controls</button><aside id="qaPanel" hidden aria-label="Local sample review controls"><h2>LOCAL REVIEW · no live data</h2><p>The actual Rider account, delivery and layout modules run against an in-memory SDK. Firebase, real GPS, network uploads and service workers are disabled. The dialog is a labelled local SweetAlert-compatible shim. Reload resets every sample record.</p><p>Sample sign-in: <strong>09000000000 / 1234</strong>. Wallet starts at ₱1,000; the cash sample reserves ₱250 once.</p><div class="qa-buttons"><button id="qaFillLogin">Fill sample sign-in</button><button id="qaRegistration">Fill synthetic registration + photos</button><button id="qaApprove">Sample Manager: approve</button><button id="qaReject">Sample Manager: reject</button><button id="qaSuspend">Sample Manager: suspend</button><button id="qaPending">Sample Manager: pending</button><button id="qaLoseAck">Lose next claim acknowledgement</button><button id="qaRetryClaim">Retry same sample claim</button></div><p id="qaOutcome" role="status">No actions run automatically.</p><details open><summary>Local ledger and counters</summary><pre id="qaLedger"></pre><pre id="qaLog"></pre></details><p>Review path: sign in → pending status → sample approval → Go online → accept QA-001 → wallet ₱750, debit count 1 → proof dialog’s synthetic photo → complete. Suspend while open to confirm deliveries are blocked. For a lost-acknowledgement check, arm it before accepting, then retry using the same-claim button; debit count must stay 1.</p></aside>
`;
const css=String.raw`
#qaPanelToggle{position:fixed;z-index:200;right:8px;bottom:8px;min-height:44px;background:#edf5f2;color:#173f34;border:2px solid #7da798;border-radius:10px;padding:8px 14px;font:600 14px system-ui}#qaPanel{position:fixed;z-index:210;inset:8px;max-width:760px;max-height:calc(100dvh - 16px);margin:auto;padding:20px;overflow:auto;background:#0d211f;border:2px solid #78bba8;border-radius:16px;color:#f0f5f2;font:15px/1.45 system-ui;box-shadow:0 20px 100px #000b}#qaPanel[hidden]{display:none}#qaPanel h2{font-size:19px}#qaPanel p{color:#dae5df}.qa-buttons{display:flex;flex-wrap:wrap;gap:8px}.qa-buttons button{min-height:44px;border:1px solid #678b7e;background:#20433a;color:white;border-radius:8px;padding:8px 12px;font:inherit}#qaPanel pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;background:#071815;padding:12px;border-radius:8px}#qaPanelToggle{z-index:220}.qa-dialog{background:#182533;color:#eef5fb;border:1px solid #829aaa;border-radius:16px;width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:22px;font:16px/1.45 system-ui}.qa-dialog::backdrop{background:#000b}.qa-dialog h2{margin-top:0}.qa-dialog label{display:block;margin:14px 0 4px}.qa-dialog input{width:100%;min-height:44px;padding:8px;font:16px system-ui}.qa-dialog-input{display:grid;gap:12px}.qa-dialog-actions{display:flex;gap:10px;margin-top:18px}.qa-dialog-validation{color:#ffc0b5}.qa-dialog-text{color:#ccd9e4}
`;

let html=await readFile(path.join(source,'index.html'),'utf8');
let main=await readFile(path.join(source,'main.js'),'utf8');
const imported=[];
main=main.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+['"];?\s*$/gm,(_whole,names)=>{imported.push(...names.split(',').map(name=>name.trim()));return '';});
if(imported.length<10||/https:\/\/www\.gstatic\.com\/firebasejs/.test(main))throw Error('The fixture did not replace all Firebase imports.');
main="import {"+[...new Set(imported)].join(',')+"} from './qa-sdk.js';\n"+main;
main=main.replace(/const firebaseConfig=\{[^;]+\};/,'const firebaseConfig={projectId:"LOCAL_QA_ONLY"};');
html=html.replace(/<link rel="manifest"[^>]*>/g,'').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/sweetalert2@11"><\/script>/,'');
html=html.replace(/<script>if\('serviceWorker' in navigator\)\{[\s\S]*?<\/script>/,'');
html=html.replace(/<script type="module" src="main\.js[^>]*><\/script>/,'<script src="qa-prelude.js"></script><script type="module" src="qa-ui.js"></script><script type="module" src="main.js"></script>');
html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; media-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">\n<link rel="stylesheet" href="qa.css">');
html=html.replace('<title>TAKODEÁL Rider</title>','<title>LOCAL SAMPLE · TAKODEÁL Rider review</title>').replace('</body>',controls+'\n</body>');
if(/serviceWorker\.register|https:\/\/www\.gstatic\.com|cdn\.jsdelivr/.test(html+main))throw Error('Unsafe external runtime remained in the sample.');
const modules=(await readdir(source)).filter(name=>/^rider-.*\.(js|css)$/.test(name));
const manifest={generatedAt:new Date().toISOString(),source:'work/rider-mobile-approval-20261009/takodeal-delivery',actualIndexSHA256:sha(await readFile(path.join(source,'index.html'))),actualMainSHA256:sha(await readFile(path.join(source,'main.js'))),transform:'Firebase imports replaced by local in-memory SDK; SW disabled; real GPS/audio replaced; connect-src none',modules:{}};
for(const name of modules)manifest.modules[name]=sha(await readFile(path.join(source,name)));
for(const target of targets){await mkdir(target,{recursive:true});for(const name of [...modules,'Delivery.jpg'])await copyFile(path.join(source,name),path.join(target,name));await Promise.all([writeFile(path.join(target,'index.html'),html),writeFile(path.join(target,'main.js'),main),writeFile(path.join(target,'qa-sdk.js'),sdk),writeFile(path.join(target,'qa-ui.js'),ui),writeFile(path.join(target,'qa-prelude.js'),prelude),writeFile(path.join(target,'qa.css'),css),writeFile(path.join(target,'source-manifest.json'),JSON.stringify(manifest,null,2))]);}
console.log(JSON.stringify({targets,modules:modules.length,sourceMainSHA256:manifest.actualMainSHA256},null,2));
