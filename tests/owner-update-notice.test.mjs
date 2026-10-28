import test from 'node:test';
import assert from 'node:assert/strict';
import {installOwnerUpdateNotice,OWNER_DOCUMENT_RELEASE} from '../takodeal-manager/owner-update-notice.js';

class Events{
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 emit(type,event={}){return Promise.all([...this.listeners.get(type)||[]].map(fn=>fn({target:this,...event})));}
}
class Element extends Events{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.style={};this.textContent='';this.hidden=false;this.open=false;this.disabled=false;this.id='';}
 setAttribute(name,value){this.attributes[name]=String(value);}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 closest(selector){return selector==='#loginOverlay'?(this.id==='loginOverlay'?this:this.parent?.closest(selector)||null):null;}
 getClientRects(){return this.hidden||this.style.display==='none'?[]:[{}];}
}
class Document extends Events{
 constructor(){super();this.body=new Element('body');this.dialogs=[];}
 createElement(tag){return new Element(tag);}
 querySelectorAll(selector){
  const nodes=new Set(this.dialogs),walk=node=>{for(const child of node.children){nodes.add(child);walk(child);}};walk(this.body);
  return [...nodes].filter(node=>selector.split(',').some(part=>{
   const rule=part.trim();if(rule==='dialog[open]')return node.tagName==='DIALOG'&&node.open;
   if(rule==='[role="dialog"]')return node.attributes.role==='dialog';
   if(rule==='[id$="Modal"]')return node.id.endsWith('Modal');
   return rule.startsWith('.')&&(node.className||'').split(/\s+/).includes(rule.slice(1));
  }));
 }
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const hold=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const nextRelease='takodeal-manager-core-v101-future-fix-20261029';
function fixture(options={}){
 const d=new Document(),serviceWorker=new Events(),registration=new Events(),calls={messages:[],wait:[],reload:0,channels:[],timers:0};
 class Channel{
  constructor(){const a={closed:false,start(){},close(){this.closed=true;}},b={closed:false,close(){this.closed=true;},postMessage(data){queueMicrotask(()=>{if(!a.closed)a.onmessage?.({data});});}};this.port1=a;this.port2=b;calls.channels.push(this);}
 }
 const worker=(release=nextRelease,reply=true)=>Object.assign(new Events(),{state:'activated',postMessage(message,ports){calls.messages.push({worker:this,message,ports});if(reply)ports[0].postMessage({type:'OWNER_RELEASE',release});}});
 serviceWorker.controller=worker(Object.hasOwn(options,'release')?options.release:nextRelease,options.reply!==false);registration.active=serviceWorker.controller;
 const w={MessageChannel:Channel,setTimeout(fn,ms){calls.timers++;return setTimeout(fn,ms);},clearTimeout,getComputedStyle:node=>({display:node.style.display||'block',visibility:node.style.visibility||'visible'}),location:{reload(){calls.reload++;}}};
 const waitForUpdate=async(...args)=>{calls.wait.push(args);return options.wait?options.wait(...args):undefined;};
 const ui=installOwnerUpdateNotice(w,d,{serviceWorker},registration,{timeoutMs:options.timeoutMs??100,waitForUpdate,...options.install});
 const banner=()=>d.body.children.find(node=>Object.hasOwn(node.attributes,'data-owner-update-notice'))||null;
 return{w,d,serviceWorker,registration,calls,ui,worker,banner,button:()=>banner()?.children[1],message:()=>banner()?.children[0].textContent};
}

test('a new active generation shows a persistent notice and never reloads automatically',async()=>{
 const f=fixture();await tick();assert.ok(f.banner());assert.match(f.message(),/App update ready\. Save open edits/);assert.equal(f.button().textContent,'Reload updated app');assert.equal(f.calls.reload,0);assert.equal(f.calls.wait.length,0);
 assert.deepEqual(f.calls.messages[0].message,{type:'OWNER_RELEASE_CHECK'});assert.equal(f.calls.messages[0].ports.length,1);assert.equal(f.calls.channels.every(c=>c.port1.closed&&c.port2.closed),true);
 await f.serviceWorker.emit('controllerchange');await tick();assert.ok(f.banner());assert.equal(f.calls.reload,0);f.ui.dispose();
});

test('matching or malformed worker replies do not claim an update, and window messages cannot spoof one',async()=>{
 for(const release of [OWNER_DOCUMENT_RELEASE,'wrong-app-v101',null,'<script>alert(1)</script>']){
  const f=fixture({release});await tick();assert.equal(f.banner(),null);assert.equal(f.calls.reload,0);f.ui.dispose();
 }
 const f=fixture({reply:false});await f.serviceWorker.emit('message',{data:{type:'OWNER_RELEASE',release:nextRelease}});assert.equal(f.banner(),null);f.ui.dispose();
});

test('a late reply from a replaced controller is ignored and only the current controller can show an update',async()=>{
 const f=fixture({reply:false});const old=f.calls.messages[0];f.serviceWorker.controller=f.worker(OWNER_DOCUMENT_RELEASE);old.ports[0].postMessage({type:'OWNER_RELEASE',release:nextRelease});await tick();assert.equal(f.banner(),null);
 await f.serviceWorker.emit('controllerchange');await tick();assert.equal(f.banner(),null);f.serviceWorker.controller=f.worker(nextRelease);await f.serviceWorker.emit('controllerchange');await tick();assert.ok(f.banner());assert.equal(f.calls.reload,0);f.ui.dispose();
});

test('an unanswered handshake expires and closes its ports without retry polling or an automatic reload',async()=>{
 const f=fixture({reply:false,timeoutMs:8});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.banner(),null);assert.equal(f.calls.messages.length,1);assert.equal(f.calls.channels[0].port1.closed,true);assert.equal(f.calls.channels[0].port2.closed,true);assert.equal(f.calls.reload,0);f.ui.dispose();
});

test('updatefound follows the new worker lifecycle and controller changes recheck without a network poll',async()=>{
 const f=fixture({release:OWNER_DOCUMENT_RELEASE});await tick();const installing=f.worker(nextRelease);installing.state='installing';f.registration.installing=installing;await f.registration.emit('updatefound');await tick();assert.equal(f.banner(),null);
 installing.state='activated';f.serviceWorker.controller=installing;await installing.emit('statechange');await tick();assert.ok(f.banner());assert.equal(f.calls.wait.length,0);assert.equal(f.calls.reload,0);f.ui.dispose();
});

test('the explicit reload action waits for the Owner update and verifies the current release before reloading',async()=>{
 const waiting=hold(),f=fixture({wait:()=>waiting.promise});await tick();const first=f.button().emit('click');await tick();assert.equal(f.button().disabled,true);await f.button().emit('click');assert.equal(f.calls.wait.length,1);assert.equal(f.calls.reload,0);
 assert.equal(f.calls.wait[0][0],f.registration);assert.equal(f.calls.wait[0][1].serviceWorker,f.serviceWorker);waiting.resolve();await first;assert.equal(f.calls.reload,1);f.ui.dispose();
});

test('a visible dialog requires a separate explicit saved-edits confirmation and is never closed by the notice',async()=>{
 const f=fixture();await tick();const dialog=new Element('dialog');dialog.open=true;f.d.dialogs.push(dialog);await f.button().emit('click');assert.equal(f.calls.wait.length,0);assert.equal(f.calls.reload,0);assert.match(f.button().textContent,/I saved my edits/);assert.equal(dialog.open,true);
 await f.button().emit('click');assert.equal(f.calls.wait.length,1);assert.equal(f.calls.reload,1);assert.equal(dialog.open,true);f.ui.dispose();
});

test('the real Invoice/Ref field name is treated as an edit even without a visible dialog',async()=>{
 const f=fixture();await tick();const invoice=new Element('input');invoice.id='suppInvoice';invoice.type='text';Object.defineProperty(invoice,'value',{get(){throw Error('Invoice contents must not be read.');}});
 await f.d.emit('input',{target:invoice});await f.button().emit('click');assert.equal(f.calls.wait.length,0);assert.equal(f.calls.reload,0);assert.match(f.button().textContent,/I saved my edits/);f.ui.dispose();
});

test('the actual ID-only payable modal requires confirmation, while a hidden ID-only modal does not',async()=>{
 for(const hidden of [false,true]){
  const f=fixture();await tick();const modal=new Element('div');modal.id='addPayableModal';modal.style.display=hidden?'none':'flex';f.d.body.append(modal);
  assert.equal(modal.className,undefined);assert.equal(modal.attributes.role,undefined);await f.button().emit('click');
  assert.equal(f.calls.reload,hidden?1:0);assert.equal(f.calls.wait.length,hidden?1:0);if(!hidden){assert.match(f.button().textContent,/I saved my edits/);assert.equal(modal.style.display,'flex');}
  f.ui.dispose();
 }
});

test('edited fields require confirmation without inspecting or retaining their values; PIN inputs are ignored',async()=>{
 const f=fixture();await tick();const pin=new Element('input');pin.id='managerPinInput';pin.type='password';Object.defineProperty(pin,'value',{get(){throw Error('A PIN must never be read.');}});await f.d.emit('input',{target:pin});await f.button().emit('click');assert.equal(f.calls.reload,1);f.ui.dispose();
 const g=fixture();await tick();const input=new Element('textarea');Object.defineProperty(input,'value',{get(){throw Error('Business input values must not be retained.');}});await g.d.emit('input',{target:input});await g.button().emit('click');assert.equal(g.calls.reload,0);assert.match(g.message(),/Save your open edits first/);await g.button().emit('click');assert.equal(g.calls.reload,1);g.ui.dispose();
});

test('edits or a newly opened dialog while waiting cancel reload and preserve the open work',async()=>{
 for(const change of [f=>f.d.emit('change',{target:new Element('select')}),f=>{const dialog=new Element('dialog');dialog.open=true;f.d.dialogs.push(dialog);}]){
  const waiting=hold(),f=fixture({wait:()=>waiting.promise});await tick();const reload=f.button().emit('click');await tick();await change(f);waiting.resolve();await reload;assert.equal(f.calls.reload,0);assert.match(f.message(),/open work changed/);assert.equal(f.button().disabled,false);await f.button().emit('click');assert.match(f.button().textContent,/I saved my edits/);assert.equal(f.calls.wait.length,1);f.ui.dispose();
 }
});

test('update and release-check failures keep a retryable notice and never clear or close anything',async()=>{
 let attempt=0;const f=fixture({wait:async()=>{if(++attempt===1)throw Error('Synthetic connection unavailable.');}});await tick();await f.button().emit('click');assert.equal(f.calls.reload,0);assert.match(f.message(),/Synthetic connection/);assert.equal(f.button().disabled,false);await f.button().emit('click');assert.equal(f.calls.reload,1);f.ui.dispose();
 const g=fixture({timeoutMs:8,wait:async()=>{g.serviceWorker.controller=g.worker(nextRelease,false);}});await tick();await g.button().emit('click');assert.equal(g.calls.reload,0);assert.match(g.message(),/could not be confirmed/);g.ui.dispose();
});

test('a confirmed rollback to the document generation removes the stale notice without reloading',async()=>{
 const f=fixture();await tick();assert.ok(f.banner());f.serviceWorker.controller=f.worker(OWNER_DOCUMENT_RELEASE);await f.serviceWorker.emit('controllerchange');await tick();assert.equal(f.banner(),null);assert.equal(f.calls.reload,0);assert.equal(f.calls.wait.length,0);f.ui.dispose();
});

test('a matching generation confirmed during an update wait invalidates the pending reload',async()=>{
 for(const failed of [false,true]){
  const waiting=hold(),f=fixture({wait:()=>waiting.promise});await tick();const reload=f.button().emit('click');await tick();
  f.serviceWorker.controller=f.worker(OWNER_DOCUMENT_RELEASE);await f.serviceWorker.emit('controllerchange');await tick();assert.equal(f.banner(),null);
  if(failed)waiting.reject(Error('Old update check failed after rollback.'));else waiting.resolve();await reload;assert.equal(f.calls.reload,0);assert.equal(f.banner(),null);f.ui.dispose();
 }
});

test('the final release check refuses an unnecessary reload when the active generation now matches',async()=>{
 const f=fixture({wait:async()=>{f.serviceWorker.controller=f.worker(OWNER_DOCUMENT_RELEASE);}});await tick();await f.button().emit('click');assert.equal(f.calls.reload,0);assert.equal(f.banner(),null);f.ui.dispose();
});

test('installing twice shares one notice; disposal removes listeners and invalidates pending replies or reloads',async()=>{
 const f=fixture({reply:false});assert.equal(installOwnerUpdateNotice(f.w,f.d,{serviceWorker:f.serviceWorker},f.registration),f.ui);assert.equal(f.calls.messages.length,1);const old=f.calls.messages[0];f.ui.dispose();old.ports[0].postMessage({type:'OWNER_RELEASE',release:nextRelease});await tick();assert.equal(f.banner(),null);assert.equal([...f.serviceWorker.listeners.values()].every(set=>set.size===0),true);
 const waiting=hold(),g=fixture({wait:()=>waiting.promise});await tick();const reload=g.button().emit('click');await tick();g.ui.dispose();waiting.resolve();await reload;assert.equal(g.calls.reload,0);assert.equal(g.banner(),null);
});

test('unsupported service worker or MessageChannel leaves the normal app unchanged',async()=>{
 const d=new Document(),w={};const ui=installOwnerUpdateNotice(w,d,{},null);assert.equal(await ui.check(),null);assert.equal(d.body.children.length,0);ui.dispose();
});
