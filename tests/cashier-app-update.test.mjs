import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCashierUpdateController,installCashierUpdates,cashierWorkflowBlocker} from '../Takodeal-POS/cashier-app-update.js';
import {updateBlocker} from '../Takodeal-POS/cashier-data.js';

const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class Events {
  handlers=new Map();
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  emit(type,detail){for(const fn of [...(this.handlers.get(type)||[])])fn({type,detail});}
}
class Clock {
  time=0;serial=0;timers=new Map();
  set=(fn,delay)=>{const id=++this.serial;this.timers.set(id,{at:this.time+delay,fn});return id;};
  clear=id=>this.timers.delete(id);
  async advance(ms){const end=this.time+ms;await flush();for(;;){const next=[...this.timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.time=next[1].at;this.timers.delete(next[0]);next[1].fn();await flush();}this.time=end;await flush();}
}
const worker=(state='installing')=>Object.assign(new Events(),{state,messages:[],postMessage(message){this.messages.push(message);},move(next){this.state=next;this.emit('statechange');}});
function setup({lookup,update,online=true,work={},timeouts={}}={}){
  const clock=new Clock(),views=[],old=worker('activated'),sw=Object.assign(new Events(),{controller:old});let lookups=0,updates=0,reloads=0;
  const registration=Object.assign(new Events(),{waiting:null,installing:null,update:()=>{updates++;return update?.(registration) || Promise.resolve();}});
  sw.getRegistration=()=>{lookups++;return lookup?lookup(registration):Promise.resolve(registration);};
  const controller=createCashierUpdateController({serviceWorker:sw,online:()=>online,blocker:()=>updateBlocker(work),
    render:view=>views.push(view),reload:()=>reloads++,now:()=>clock.time,setTimer:clock.set,clearTimer:clock.clear,
    timeouts:{lookup:100,check:200,download:300,opening:200,slow:50,...timeouts}});
  const install=w=>{registration.installing=w;registration.emit('updatefound');};
  const control=w=>{sw.controller=w;sw.emit('controllerchange');};
  return{controller,clock,views,sw,registration,work,install,control,lookups:()=>lookups,updates:()=>updates,reloads:()=>reloads};
}

test('a completed no-update check reports current and duplicate clicks share one physical check',async()=>{
  const pending=deferred(),app=setup({update:()=>pending.promise});
  const first=app.controller.check(),second=app.controller.check();assert.equal(first,second);await flush();
  assert.equal(app.updates(),1);assert.equal(app.controller.state.phase,'checking');assert.equal(app.controller.state.busy,true);
  pending.resolve();await first;assert.equal(app.controller.state.phase,'current');assert.equal(app.controller.state.busy,false);app.controller.dispose();
});

test('offline and every existing checkout/stock/attendance/printing blocker prevent update work',async()=>{
  const offline=setup({online:false});await offline.controller.check();assert.equal(offline.lookups(),0);assert.equal(offline.controller.state.phase,'offline');offline.controller.dispose();
  for(const work of [{cart:[{}]},{platformCarts:{Grab:[{}]}},{prepCart:[{}]},{kitchenPrepCart:[{}]},{consumablesCart:[{}]},{wasteCart:[{}]},{expenseCart:[{}]},
    {isProcessingOrder:true},{isSubmittingOrder:true},{isSubmittingWasteCart:true},{isProcessingAttendance:true},{cashierRemitSubmitting:true},{cashierCashCountActive:true},{cashierShiftOpening:true},{isBluetoothPrinting:true},{bluetoothPrintQueue:[{}]}]){
    const app=setup({work});await app.controller.check();assert.equal(app.lookups(),0);assert.equal(app.updates(),0);assert.equal(app.controller.state.phase,'blocked');app.controller.dispose();
  }
});

test('stalled registration lookup has a bounded retry and retains the unresolved physical lookup',async()=>{
  const pending=deferred(),app=setup({lookup:()=>pending.promise});let done=false;
  const first=app.controller.check().then(()=>done=true);await app.clock.advance(100);await first;
  assert.equal(done,true);assert.equal(app.controller.state.phase,'error');assert.match(app.controller.state.title,/lookup/);
  const retry=app.controller.check();await flush();assert.equal(app.lookups(),1);
  pending.resolve(app.registration);await retry;assert.equal(app.controller.state.phase,'current');assert.equal(app.updates(),1);app.controller.dispose();
});

test('a late lookup result cannot turn a timed-out check into success without another action',async()=>{
  const pending=deferred(),app=setup({lookup:()=>pending.promise});const first=app.controller.check();await app.clock.advance(100);await first;
  pending.resolve(app.registration);await flush();assert.equal(app.controller.state.phase,'error');assert.equal(app.updates(),0);assert.equal(app.reloads(),0);app.controller.dispose();
});

test('stalled browser update has a bounded retry, no duplicate update, and no stale success',async()=>{
  const pending=deferred(),app=setup({update:()=>pending.promise});const first=app.controller.check();await app.clock.advance(200);await first;
  assert.equal(app.controller.state.phase,'error');assert.match(app.controller.state.title,/check/);assert.equal(app.controller.state.busy,false);
  const retry=app.controller.check();await flush();assert.equal(app.updates(),1);await app.clock.advance(200);await retry;
  pending.resolve();await flush();assert.equal(app.controller.state.phase,'error');assert.equal(app.reloads(),0);app.controller.dispose();
});

test('update() finishing does not claim current while required app files are still installing',async()=>{
  const app=setup({update:reg=>{reg.installing=worker();reg.emit('updatefound');}});const check=app.controller.check();await flush();
  assert.equal(app.controller.state.phase,'downloading');assert.equal(app.controller.state.busy,true);assert.equal(app.updates(),1);
  const second=app.controller.check();assert.equal(check,second);assert.equal(app.updates(),1);
  const next=app.registration.installing;next.move('installed');app.registration.waiting=next;app.registration.installing=null;await check;
  assert.equal(app.controller.state.phase,'ready');assert.equal(app.controller.state.busy,false);assert.equal(next.messages.length,0);assert.equal(app.reloads(),0);app.controller.dispose();
});

test('stalled installation offers retry; a late complete installation only exposes explicit ready action',async()=>{
  const app=setup({update:reg=>{reg.installing=worker();reg.emit('updatefound');}});const check=app.controller.check();await app.clock.advance(300);await check;
  assert.equal(app.controller.state.phase,'error');assert.match(app.controller.state.title,/download/);
  const next=app.registration.installing;app.registration.waiting=next;app.registration.installing=null;next.move('installed');await flush();
  assert.equal(app.controller.state.phase,'ready');assert.equal(next.messages.length,0);assert.equal(app.reloads(),0);app.controller.dispose();
});

test('a failed worker install never reports an up-to-date app',async()=>{
  const app=setup({update:reg=>{reg.installing=worker();reg.emit('updatefound');}});const check=app.controller.check();await flush();
  app.registration.installing.move('redundant');await check;assert.equal(app.controller.state.phase,'error');app.controller.dispose();
});

test('a failure between updatefound and update completion is retained even after installing is cleared',async()=>{
  const app=setup({update:reg=>{const next=worker();reg.installing=next;reg.emit('updatefound');next.move('redundant');reg.installing=null;}});
  await app.controller.check();assert.equal(app.controller.state.phase,'error');app.controller.dispose();
});

test('a waiting update requires an explicit open and exact activated controller before reload',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;
  await app.controller.check();assert.equal(app.controller.state.phase,'ready');assert.equal(app.updates(),0);assert.equal(next.messages.length,0);
  const open=app.controller.open();await flush();assert.equal(app.controller.state.phase,'opening');assert.equal(next.messages.length,1);
  next.move('activating');app.control(next);await flush();assert.equal(app.reloads(),0);
  next.move('activated');await open;assert.equal(app.reloads(),1);app.controller.dispose();
});

test('cancelled navigation leaves an enabled explicit reopen action instead of a frozen spinner',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;await app.controller.check();
  const open=app.controller.open();await flush();next.move('activated');app.control(next);await open;
  assert.equal(app.controller.state.phase,'ready');assert.equal(app.controller.state.busy,false);assert.equal(app.controller.state.action,'Open updated app');
  await app.controller.open();assert.equal(app.reloads(),2);assert.equal(next.messages.length,1);app.controller.dispose();
});

test('activation timeout never reloads late; reopening the now activated update requires a fresh action',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;await app.controller.check();
  const open=app.controller.open();await app.clock.advance(200);await open;assert.equal(app.controller.state.phase,'error');assert.match(app.controller.state.title,/not opened/);
  next.move('activated');app.registration.waiting=null;app.control(next);await flush();assert.equal(app.reloads(),0);assert.equal(app.controller.state.phase,'ready');
  await app.controller.open();assert.equal(app.reloads(),1);assert.equal(next.messages.length,1);app.controller.dispose();
});

test('a different controller cannot complete the chosen update activation',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;await app.controller.check();
  const open=app.controller.open();await flush();next.move('activated');app.control(worker('activated'));await app.clock.advance(200);await open;
  assert.equal(app.reloads(),0);assert.equal(app.controller.state.phase,'error');app.controller.dispose();
});

test('a newer controller claiming immediately after the chosen worker resolves cannot reload',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;await app.controller.check();
  const open=app.controller.open();await flush();next.move('activated');app.control(next);app.control(worker('activated'));await open;
  assert.equal(app.reloads(),0);assert.equal(app.controller.state.phase,'error');assert.match(app.controller.state.title,/changed/);app.controller.dispose();
});

test('an activated install awaiting controller confirmation never falls through to current',async()=>{
  const app=setup({update:reg=>{reg.installing=worker('activated');reg.emit('updatefound');}});const check=app.controller.check();await flush();
  assert.equal(app.controller.state.phase,'downloading');assert.match(app.controller.state.title,/Finishing/);assert.equal(app.controller.state.busy,true);
  app.control(app.registration.installing);await check;assert.equal(app.controller.state.phase,'ready');assert.equal(app.reloads(),0);app.controller.dispose();
});

test('new work after checking or during activation prevents activation/reload and can be safely retried',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;await app.controller.check();
  app.work.cart=[{}];await app.controller.open();assert.equal(next.messages.length,0);assert.equal(app.controller.state.phase,'blocked');
  app.work.cart=[];const open=app.controller.open();await flush();assert.equal(next.messages.length,1);
  app.work.isBluetoothPrinting=true;next.move('activated');app.control(next);await open;assert.equal(app.reloads(),0);assert.equal(app.controller.state.phase,'blocked');
  app.work.isBluetoothPrinting=false;await app.controller.open();assert.equal(app.reloads(),1);app.controller.dispose();
});

test('work started during an update service request prevents exposing a ready activation action',async()=>{
  const pending=deferred(),app=setup({update:()=>pending.promise}),next=worker('installed');const check=app.controller.check();await flush();
  app.work.isBluetoothPrinting=true;app.registration.waiting=next;pending.resolve();await check;
  assert.equal(app.controller.state.phase,'blocked');assert.equal(next.messages.length,0);assert.equal(app.reloads(),0);app.controller.dispose();
});

test('progress is indeterminate, includes elapsed/slow status, and stops all screen timers on disposal',async()=>{
  const pending=deferred(),app=setup({lookup:()=>pending.promise,timeouts:{lookup:5000,slow:500}});const check=app.controller.check();await app.clock.advance(1000);
  assert.equal(app.controller.state.busy,true);assert.equal(app.controller.state.elapsed,1);assert.match(app.controller.state.message,/longer than usual/);assert.equal(app.controller.state.percent,undefined);
  const count=app.views.length;app.controller.dispose();await check;assert.equal(app.clock.timers.size,0);
  pending.resolve(app.registration);await flush();await app.clock.advance(6000);assert.equal(app.views.length,count);assert.equal(app.reloads(),0);
});

test('dispose during activation prevents a late reload',async()=>{
  const app=setup(),next=worker('installed');app.registration.waiting=next;await app.controller.check();const open=app.controller.open();await flush();
  app.controller.dispose();next.move('activated');app.control(next);await open;assert.equal(app.reloads(),0);assert.equal(app.clock.timers.size,0);
});

function browserFixture(){
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{id,dataset:{},style:{},attributes:{},textContent:'',setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];}});return nodes.get(id);};
  const document={getElementById:node,body:{append(){}},visibilityState:'visible'},data=new Map([['outbox','saved sale'],['takodeal_device_branch','Maa'],['printer','saved printer']]);
  const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const registration=Object.assign(new Events(),{waiting:null,installing:null,update:async()=>{}}),serviceWorker=Object.assign(new Events(),{controller:worker('activated'),getRegistration:async()=>registration});
  const window=Object.assign(new Events(),{document,localStorage:storage,navigator:{onLine:true,serviceWorker},setInterval:()=>1,clearInterval(){},location:{reload(){}}});
  return{window,document,storage,data,node,registration};
}
test('actual installer renders an accessible retry/status panel and preserves saved sales/device/printer data',async()=>{
  const app=browserFixture(),controller=installCashierUpdates({...app,release:'test-release'});assert.equal(installCashierUpdates(app),controller);
  await app.window.manualHardUpdate();assert.equal(app.node('updateAppBanner').dataset.updateState,'current');assert.equal(app.node('cashierUpdateNow').disabled,false);
  assert.match(app.node('updateAppBanner').innerHTML,/role="status" aria-live="polite"/);assert.match(app.node('updateAppBanner').innerHTML,/role="progressbar"/);assert.doesNotMatch(app.node('updateAppBanner').innerHTML,/aria-valuenow/);
  assert.deepEqual([...app.data].filter(([key])=>key!=='takodeal_cashier_seen_release'),[['outbox','saved sale'],['takodeal_device_branch','Maa'],['printer','saved printer']]);
  controller.dispose();
});

test('visible work dialogs block updates without reading form values or blocking ordinary sign-in',()=>{
  for(const id of ['checkoutModal','endShiftModal','expenseModal','shiftModal','remittanceModal']){
    const node={style:{display:'flex'},get value(){throw Error('Do not inspect private fields');}};
    const document={getElementById:key=>key===id?node:null};assert.match(cashierWorkflowBlocker({},document),/open checkout/);
    node.style.display='none';assert.equal(cashierWorkflowBlocker({},document),'');
    node.style.display='block';node.getClientRects=()=>[];assert.equal(cashierWorkflowBlocker({},document),'','a form inside a hidden page is not visibly active');
  }
  assert.equal(cashierWorkflowBlocker({},{getElementById:key=>key==='loginOverlay'?{style:{display:'flex'}}:null}),'');
});

test('actual installer protects a pending shift close even after its form closes, and releases the guard on failure',async()=>{
  const app=browserFixture(),pending=deferred(),next=worker('installed');let calls=0;
  const original=()=>{calls++;return pending.promise;};app.window.MASTER_CloseShift=original;app.registration.waiting=next;
  const controller=installCashierUpdates(app);await controller.check();const close=app.window.MASTER_CloseShift();
  app.node('endShiftModal').style.display='none';await controller.open();assert.equal(controller.state.phase,'blocked');assert.equal(next.messages.length,0);assert.equal(calls,1);
  pending.reject(Error('Fictional close failed'));await assert.rejects(close,/Fictional close failed/);
  await controller.check();assert.equal(controller.state.phase,'ready');controller.dispose();assert.equal(app.window.MASTER_CloseShift,original);
});

test('opening an expense dialog during real installer activation prevents reload after the worker takes control',async()=>{
  const app=browserFixture(),next=worker('installed');let reloads=0;app.window.location.reload=()=>reloads++;app.registration.waiting=next;
  const controller=installCashierUpdates(app);await controller.check();const open=controller.open();await flush();
  app.node('expenseModal').style.display='flex';next.move('activated');app.window.navigator.serviceWorker.controller=next;app.window.navigator.serviceWorker.emit('controllerchange');await open;
  assert.equal(reloads,0);assert.equal(controller.state.phase,'blocked');controller.dispose();
});

test('Cashier release caches the extracted updater and keeps progress visible above sign-in on small screens',()=>{
  const sw=readFileSync(new URL('../Takodeal-POS/sw.js',import.meta.url),'utf8'),css=readFileSync(new URL('../Takodeal-POS/cashier-theme.css',import.meta.url),'utf8');
  assert.match(sw,/core-cashier-auto-branches-20261113-r1/);assert.match(sw,/'\.\/cashier-app-update\.js'/);assert.match(sw,/const PHOTOS = 'takodeal-pos-photos-offline02'/);
  assert.match(css,/z-index:1000001!important/);assert.match(css,/prefers-reduced-motion:reduce/);assert.doesNotMatch(css,/cashier-update-notice span\{display:none/);
});
