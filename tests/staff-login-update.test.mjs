import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installStaffAppUpdate,installStaffPhone} from '../takodeal-staff/staff-phone.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function worker(state='installing'){
    const listeners=new Set();return {state,listeners,addEventListener(name,fn){assert.equal(name,'statechange');listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);},change(next){this.state=next;for(const fn of [...listeners])fn();}};
}
function harness({lookup,update,sw=true,online=true,dialog=true}={}){
    const buttons=Array.from({length:3},()=>({disabled:false,textContent:'Check for app updates',attributes:new Map(),setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);}}));
    const statuses=Array.from({length:3},()=>({textContent:'',hidden:true}));
    const records=new Map([['device','synthetic-approved'],['staff','synthetic-staff'],['pinCooldown','synthetic-cooldown'],['offlineAttendance','synthetic-unsent']]);
    const baseline=[...records],calls={lookup:0,updates:0,register:[],reload:0,dialogs:[],storageWrites:0,authWrites:0,businessWrites:0};
    const registration={active:{state:'activated'},async update(){calls.updates++;if(update)return update();}};
    const serviceWorker={async getRegistration(){calls.lookup++;return lookup?lookup():registration;},async register(...args){calls.register.push(args);return registration;}};
    const nav={onLine:online,...(sw?{serviceWorker}:{})};
    const w={location:{reload(){calls.reload++;}},localStorage:{getItem:key=>records.get(key),setItem(key,value){calls.storageWrites++;records.set(key,value);},removeItem(key){calls.storageWrites++;records.delete(key);},clear(){calls.storageWrites++;records.clear();}},auth:{currentUser:{uid:'synthetic-auth'},signOut(){calls.authWrites++;}},db:{write(){calls.businessWrites++;}}};
    if(dialog)w.Swal={async fire(...args){calls.dialogs.push(args);return {};}};
    const d={querySelectorAll:selector=>selector==='[data-staff-update]'?buttons:selector==='[data-staff-update-status]'?statuses:[]};
    const check=installStaffAppUpdate(w,d,nav);
    return {w,d,nav,buttons,statuses,calls,registration,serviceWorker,records,check,
        intact(){assert.deepEqual([...records],baseline);assert.equal(calls.storageWrites,0);assert.equal(calls.authWrites,0);assert.equal(calls.businessWrites,0);assert.equal(w.auth.currentUser.uid,'synthetic-auth');},
        restored(){for(const button of buttons){assert.equal(button.disabled,false);assert.equal(button.textContent,'Check for app updates');assert.equal(button.attributes.has('aria-busy'),false);}}};
}
async function withGlobals(values,body){
    const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    try{return await body();}finally{for(const [key,descriptor] of previous)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];}
}
async function timers(body){
    const pending=new Map();let next=0;
    return withGlobals({setTimeout(fn,delay){const id=++next;pending.set(id,{fn,delay});return id;},clearTimeout(id){pending.delete(id);}},()=>body({pending,expire(delay){const found=[...pending].find(([,timer])=>timer.delay===delay);assert.ok(found,`A ${delay}ms deadline must exist.`);pending.delete(found[0]);found[1].fn();}}));
}

test('Staff login entry installs the lean update action before Firebase and removes the employee-profile copy',()=>{
    const html=readFileSync(new URL('../takodeal-staff/index.html',import.meta.url),'utf8');
    const install=html.indexOf('installStaffAppUpdate()'),business=html.indexOf('src="app.js?');
    assert.ok(install>0 && install<business);assert.match(html,/import\s*\{\s*installStaffAppUpdate\s*\}\s*from\s*['"]\.\/staff-phone\.js['"]/);
    assert.equal((html.match(/data-staff-update(?:\s|>)/g)||[]).length,3);assert.equal((html.match(/onclick="window\.forceUpdateApp\(\)"/g)||[]).length,3);
    for(const stage of ['registration','pending','login'])assert.ok(html.includes(`staffUpdateHelp-${stage}`));
    const source=readFileSync(new URL('../takodeal-staff/staff-phone.js',import.meta.url),'utf8');
    assert.doesNotMatch(source,/^import .*from.*(?:firebase|gstatic)/im);assert.doesNotMatch(source,/\bsignOut\s*\(/);assert.equal((source.match(/^import /gm)||[]).length,1);
});

test('pre-login checks use one operation and keep its lock when the full Staff engine installs later',async()=>{
    const read=deferred(),h=harness({lookup:()=>read.promise}),pending=h.check();
    for(const button of h.buttons){assert.equal(button.disabled,true);assert.equal(button.attributes.get('aria-busy'),'true');}
    assert.equal(await h.check(),false);assert.equal(h.calls.lookup,1);
    await withGlobals({window:h.w,document:h.d,navigator:h.nav},async()=>{installStaffPhone();assert.equal(h.w.forceUpdateApp,h.check);assert.equal(await h.w.forceUpdateApp(),false);});
    read.resolve(h.registration);assert.equal(await pending,true);assert.equal(h.calls.updates,1);assert.equal(h.calls.reload,1);h.restored();h.intact();
});

test('the check waits through installation and installed states until the new shell activates',async()=>{
    const installing=worker(),h=harness();h.registration.installing=installing;h.registration.active=null;
    const pending=h.check();await flush();assert.equal(h.calls.reload,0);assert.equal(installing.listeners.size,1);
    installing.change('installed');await flush();assert.equal(h.calls.reload,0);
    installing.change('activated');assert.equal(await pending,true);assert.equal(h.calls.reload,1);assert.equal(installing.listeners.size,0);h.restored();h.intact();
});

test('offline and unsupported-browser failures do not pretend the app is current or reload saved data',async()=>{
    for(const config of [{online:false},{sw:false}]){
        const h=harness(config);assert.equal(await h.check(),false);assert.equal(h.calls.reload,0);assert.equal(h.calls.lookup,0);
        assert.ok(h.statuses.every(node=>!node.hidden));assert.match(h.statuses[0].textContent,/internet|cannot check/);assert.doesNotMatch(h.statuses[0].textContent,/up to date|updated successfully/i);h.intact();
    }
});

test('a registration that is not ready is installed explicitly rather than treated as a successful update',async()=>{
    const h=harness({lookup:async()=>undefined});assert.equal(await h.check(),true);
    assert.deepEqual(h.calls.register,[['./sw.js',{updateViaCache:'none'}]]);assert.equal(h.calls.updates,1);assert.equal(h.calls.reload,1);h.restored();h.intact();
    const missing=harness({lookup:async()=>undefined});delete missing.serviceWorker.register;
    assert.equal(await missing.check(),false);assert.equal(missing.calls.reload,0);assert.match(missing.statuses[0].textContent,/not ready/);missing.restored();missing.intact();
});

test('fresh registration readiness is bounded and a late ready result cannot reload or update after failure',async()=>{
    await timers(async clock=>{
        const ready=deferred(),h=harness({lookup:async()=>undefined});h.serviceWorker.register=async()=>({update:h.registration.update});h.serviceWorker.ready=ready.promise;
        const pending=h.check();await flush();clock.expire(15000);assert.equal(await pending,false);assert.equal(h.calls.reload,0);assert.equal(h.calls.updates,0);h.restored();
        ready.resolve(h.registration);await flush();assert.equal(h.calls.reload,0);assert.equal(h.calls.updates,0);assert.match(h.statuses[0].textContent,/took too long/);assert.equal(clock.pending.size,0);h.intact();
    });
});

test('a timed-out lookup can retry while its old result cannot register, update or reload a second time',async()=>{
    await timers(async clock=>{
        const old=deferred();let reads=0;const h=harness({lookup:()=>++reads===1?old.promise:h.registration});
        const pending=h.check();clock.expire(15000);assert.equal(await pending,false);h.restored();
        assert.equal(await h.check(),true);assert.equal(h.calls.updates,1);assert.equal(h.calls.reload,1);
        old.resolve(undefined);await flush();assert.equal(h.calls.register.length,0);assert.equal(h.calls.updates,1);assert.equal(h.calls.reload,1);assert.equal(clock.pending.size,0);h.intact();
    });
});

test('a network update error restores the controls and permits a successful retry',async()=>{
    let attempts=0;const h=harness({update:async()=>{if(++attempts===1)throw Error('Synthetic offline update failure.');}});
    assert.equal(await h.check(),false);assert.equal(h.calls.reload,0);assert.match(h.statuses[0].textContent,/offline update failure/);h.restored();h.intact();
    assert.equal(await h.check(),true);assert.equal(h.calls.updates,2);assert.equal(h.calls.reload,1);h.restored();h.intact();
});

test('redundant installation and activation timeouts remove listeners and never reload a failed shell',async()=>{
    for(const timeout of [false,true])await timers(async clock=>{
        const installing=worker(),h=harness();h.registration.installing=installing;h.registration.active=null;
        const pending=h.check();await flush();assert.equal(installing.listeners.size,1);
        if(timeout)clock.expire(30000);else installing.change('redundant');
        assert.equal(await pending,false);assert.equal(h.calls.reload,0);assert.equal(installing.listeners.size,0);assert.equal(clock.pending.size,0);h.restored();
        installing.change('activated');await flush();assert.equal(h.calls.reload,0);h.intact();
    });
});

test('attendance and device-request guards block before reads and are rechecked before reloading',async()=>{
    for(const flag of ['staffPunchBusy','staffDeviceRegistrationBusy']){
        const h=harness();h.w[flag]=true;assert.equal(await h.check(),false);assert.equal(h.calls.lookup,0);assert.equal(h.calls.reload,0);h.intact();
        h.w[flag]=false;const installing=worker();h.registration.installing=installing;h.registration.active=null;
        const pending=h.check();await flush();h.w[flag]=true;installing.change('activated');assert.equal(await pending,false);assert.equal(h.calls.reload,0);h.restored();h.intact();
        h.w[flag]=false;h.registration.installing=null;h.registration.active=installing;assert.equal(await h.check(),true);assert.equal(h.calls.reload,1);h.intact();
    }
});

test('a dropped connection during installation leaves the app open with a truthful retry message',async()=>{
    const installing=worker(),h=harness();h.registration.installing=installing;h.registration.active=null;
    const pending=h.check();await flush();h.nav.onLine=false;installing.change('activated');assert.equal(await pending,false);
    assert.equal(h.calls.reload,0);assert.match(h.statuses[0].textContent,/connection was lost/);h.restored();h.intact();
});

test('controls preserve their prior disabled state and early errors remain visible without dialog libraries',async()=>{
    const h=harness({dialog:false,update:async()=>{throw Error('Synthetic update refused.');}});h.buttons[1].disabled=true;
    assert.equal(await h.check(),false);assert.equal(h.buttons[0].disabled,false);assert.equal(h.buttons[1].disabled,true);assert.equal(h.buttons[2].disabled,false);
    assert.ok(h.statuses.every(node=>node.hidden===false && node.textContent==='Synthetic update refused.'));assert.equal(h.calls.reload,0);h.intact();
    const brokenDialog=harness({update:async()=>{throw Error('Synthetic update refused.');}});brokenDialog.w.Swal.fire=async()=>{throw Error('Dialog is unavailable.');};
    assert.equal(await brokenDialog.check(),false);assert.equal(brokenDialog.statuses[0].textContent,'Synthetic update refused.');assert.equal(brokenDialog.calls.reload,0);brokenDialog.restored();brokenDialog.intact();
});
