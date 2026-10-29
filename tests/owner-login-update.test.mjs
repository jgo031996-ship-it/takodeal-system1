import test from 'node:test';
import assert from 'node:assert/strict';
import {installOwnerLoginUpdate} from '../takodeal-manager/login-update.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness({online=true,worker=true,getRegistration,waitForUpdate,stage='google',defaultLookup=false}={}){
 const listeners=new Set(),attributes=new Map(),classes=new Set(),timers=new Map(),calls={reloads:0,lookups:0,waits:[],cleared:[],noticeChecks:0,denied:[]};let timerId=0;
 const button={disabled:false,textContent:'Update Owner App',setAttribute:(name,value)=>attributes.set(name,String(value)),removeAttribute:name=>attributes.delete(name),addEventListener:(type,callback)=>{assert.equal(type,'click');listeners.add(callback);},removeEventListener:(type,callback)=>{assert.equal(type,'click');listeners.delete(callback);}};
 const status={textContent:'',classList:{toggle:(name,value)=>value?classes.add(name):classes.delete(name)}},overlay={hidden:false,style:{display:'flex'}},registration={id:'fictional-owner-worker'},serviceWorker={};
 const deny=(object,key)=>Object.defineProperty(object,key,{get(){calls.denied.push(key);throw Error('App-file maintenance must not access '+key);},set(){calls.denied.push(key);throw Error('App-file maintenance must not change '+key);}});
 const w={isLoggingIn:false,location:{reload:()=>calls.reloads++},ownerUpdateNotice:{check:()=>calls.noticeChecks++},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>{calls.cleared.push(id);timers.delete(id);}};
 for(const key of ['auth','sessionUser','localStorage','sessionStorage','indexedDB','managerPin','ManagerLogin'])deny(w,key);
 const nav={onLine:online,...(worker?{serviceWorker}: {})};for(const key of ['storage','credentials'])deny(nav,key);
 const nodes={loginUpdateButton:button,loginUpdateStatus:status,loginOverlay:overlay,loginStage1:{hidden:stage!=='google'},loginStage2:{hidden:stage!=='pin'}};
 const d={getElementById:id=>{assert.ok(Object.hasOwn(nodes,id),'Only app-update controls may be read.');assert.notEqual(id,'loginStage1');assert.notEqual(id,'loginStage2');return nodes[id];}};
 const lookup=()=>{calls.lookups++;return getRegistration?getRegistration():Promise.resolve(registration);};serviceWorker.getRegistration=lookup;
 const installation=installOwnerLoginUpdate(w,d,nav,{...(defaultLookup?{}:{getRegistration:lookup}),waitForUpdate:async(...args)=>{calls.waits.push(args);return waitForUpdate?.(...args);}});
 return {w,d,nav,button,status,overlay,registration,serviceWorker,calls,timers,attributes,classes,listeners,installation,
  click:()=>Promise.all([...listeners].map(callback=>callback())),deadline:()=>{assert.equal(timers.size,1,'One bounded UI deadline is active.');const [id,timer]=[...timers][0];timers.delete(id);timer.fn();return timer;}};
}

for(const stage of ['google','pin'])test('the '+stage+' locked screen can update app files without touching authentication or credentials',async()=>{
 const f=harness({stage});await f.click();assert.equal(f.calls.reloads,1);assert.equal(f.calls.lookups,1);assert.equal(f.calls.waits.length,1);assert.equal(f.calls.waits[0][0],f.registration);assert.equal(f.calls.waits[0][1].serviceWorker,f.serviceWorker);assert.deepEqual(f.calls.denied,[]);assert.equal(f.timers.size,0);assert.equal(f.attributes.has('aria-busy'),false);
});
test('reload waits for the actual activation helper and duplicate clicks share one update attempt',async()=>{
 const activation=deferred(),f=harness({waitForUpdate:()=>activation.promise}),pending=f.click();await drain();assert.equal(f.button.disabled,true);assert.equal(f.attributes.get('aria-busy'),'true');assert.equal(f.calls.reloads,0);assert.equal(f.calls.waits.length,1);
 await f.click();assert.equal(f.calls.lookups,1);assert.equal(f.calls.waits.length,1);activation.resolve();await pending;assert.equal(f.calls.reloads,1);assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'Update Owner App');assert.equal(f.timers.size,0);
});
test('offline and unsupported-browser attempts do not contact a worker and remain retryable',async()=>{
 for(const problem of ['offline','unsupported']){
  const f=harness({online:problem!=='offline',worker:problem!=='unsupported'});await f.click();assert.equal(f.calls.lookups,0);assert.equal(f.calls.waits.length,0);assert.equal(f.calls.reloads,0);assert.equal(f.button.disabled,false);assert.equal(f.timers.size,0);assert.equal(f.classes.has('error'),true);
  if(problem==='offline'){assert.match(f.status.textContent,/Connect to the internet/);f.nav.onLine=true;}else{assert.match(f.status.textContent,/Edge or Chrome/);f.nav.serviceWorker=f.serviceWorker;}
  await f.click();assert.equal(f.calls.reloads,1);assert.equal(f.classes.has('error'),false);assert.deepEqual(f.calls.denied,[]);
 }
});
test('a stalled registration lookup reaches its deadline and an old late completion cannot reload a newer pending attempt',async()=>{
 const lookup=deferred(),oldActivation=deferred(),newActivation=deferred(),oldRegistration={id:'old'},newRegistration={id:'new'};let attempts=0;
 const f=harness({getRegistration:()=>++attempts===1?lookup.promise:Promise.resolve(newRegistration),waitForUpdate:registration=>registration===oldRegistration?oldActivation.promise:newActivation.promise});
 const first=f.click();assert.equal(f.deadline().delay,40000);await first;assert.equal(f.calls.reloads,0);assert.equal(f.button.disabled,false);assert.match(f.status.textContent,/Unable to confirm/);assert.equal(f.classes.has('error'),true);
 const retry=f.click();await drain();assert.equal(f.calls.lookups,2);assert.equal(f.calls.reloads,0);assert.equal(f.button.disabled,true);
 lookup.resolve(oldRegistration);await drain();oldActivation.resolve();await drain();assert.equal(f.calls.reloads,0,'The timed-out attempt has no reload continuation.');assert.equal(f.button.disabled,true,'The old completion cannot unlock the retry.');
 newActivation.resolve();await retry;assert.equal(f.calls.reloads,1);assert.equal(f.button.disabled,false);assert.equal(f.timers.size,0);
});
test('a helper failure and an absent registration report an error, then a new explicit attempt can succeed',async()=>{
 for(const mode of ['missing','activation-error']){let attempt=0;const f=harness({getRegistration:()=>mode==='missing'&&++attempt===1?null:Promise.resolve({id:'ready'}),waitForUpdate:async()=>{if(mode==='activation-error'&&++attempt===1)throw Error('Synthetic activation failed');}});
  await f.click();assert.equal(f.calls.reloads,0);assert.equal(f.button.disabled,false);assert.equal(f.timers.size,0);assert.match(f.status.textContent,/Unable to confirm/);await f.click();assert.equal(f.calls.reloads,1);
 }
});
test('the default browser lookup uses getRegistration and an absent worker registration remains a visible retry',async()=>{
 let count=0;const f=harness({defaultLookup:true,getRegistration:()=>++count===1?null:Promise.resolve({id:'new-registration'})});await f.click();assert.equal(f.calls.lookups,1);assert.equal(f.calls.waits.length,0);assert.equal(f.calls.reloads,0);assert.match(f.status.textContent,/Unable to confirm/);await f.click();assert.equal(f.calls.lookups,2);assert.equal(f.calls.waits[0][0].id,'new-registration');assert.equal(f.calls.reloads,1);
 const unsupported=harness({defaultLookup:true,worker:false});await unsupported.click();assert.equal(unsupported.calls.lookups,0);assert.equal(unsupported.calls.reloads,0);assert.match(unsupported.status.textContent,/Edge or Chrome/);
});
for(const change of ['unlocking','display-none','hidden'])test('an app update finishing after '+change+' cannot reload the opening workspace',async()=>{
 const activation=deferred(),f=harness({waitForUpdate:()=>activation.promise}),pending=f.click();await drain();
 if(change==='unlocking')f.w.isLoggingIn=true;else if(change==='hidden')f.overlay.hidden=true;else f.overlay.style.display='none';
 activation.resolve();await pending;assert.equal(f.calls.reloads,0);assert.equal(f.calls.noticeChecks,1);assert.match(f.status.textContent,/workspace is opening.*Save your work/);assert.equal(f.button.disabled,false);assert.deepEqual(f.calls.denied,[]);
});
test('an already opened workspace or active PIN unlock cannot start a login update',async()=>{
 for(const state of ['opening','open']){const f=harness();if(state==='opening')f.w.isLoggingIn=true;else f.overlay.style.display='none';await f.click();assert.equal(f.calls.lookups,0);assert.equal(f.calls.waits.length,0);assert.equal(f.calls.reloads,0);assert.equal(f.timers.size,0);}
});
test('losing connectivity during download keeps the current page open and offers an explicit retry',async()=>{
 const activation=deferred(),f=harness({waitForUpdate:()=>activation.promise}),pending=f.click();await drain();f.nav.onLine=false;activation.resolve();await pending;assert.equal(f.calls.reloads,0);assert.equal(f.button.disabled,false);assert.equal(f.classes.has('error'),true);assert.match(f.status.textContent,/Check your connection/);
});
test('disposing a pending update removes its listener and cannot reload or publish late status',async()=>{
 const activation=deferred(),f=harness({waitForUpdate:()=>activation.promise}),pending=f.click();await drain();const status=f.status.textContent;
 f.installation.dispose();assert.equal(f.listeners.size,0);activation.resolve();await pending;assert.equal(f.calls.reloads,0);assert.equal(f.status.textContent,status);assert.equal(f.timers.size,0);await f.click();assert.equal(f.calls.lookups,1);assert.deepEqual(f.calls.denied,[]);
});
test('missing login update controls are a safe no-op',()=>{
 let calls=0;const installation=installOwnerLoginUpdate({}, {getElementById:()=>null}, {},{getRegistration:()=>calls++});assert.doesNotThrow(()=>installation.dispose());assert.equal(calls,0);
});
