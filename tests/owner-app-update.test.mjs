import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForAppUpdate} from '../takodeal-manager/owner-app-update.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function events(properties={}){
    const handlers=new Map(),counts={added:0,removed:0};
    return Object.assign({counts,addEventListener(type,handler){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(handler);counts.added++;},
        removeEventListener(type,handler){handlers.get(type)?.delete(handler);counts.removed++;},
        emit(type){for(const handler of [...handlers.get(type)||[]])handler();},
        listeners(){return [...handlers.values()].reduce((total,list)=>total+list.size,0);}},properties);
}
function fixture({state='installing',container=false,update}={}){
    const worker=events({state}),old=events({state:'activated'}),sw=events({controller:old}),registration=events({active:state==='activating'||state==='activated'?worker:old,update:update||(async()=>{})});
    if(state==='installing')registration.installing=worker;
    if(state==='installed')registration.waiting=worker;
    if(state==='redundant')registration.installing=worker;
    let expire,cleared=0;
    const options={delay(fn,ms){assert.equal(ms,30000);expire=fn;return 7;},cancelDelay(){cleared++;},...(container?{serviceWorker:sw}:{})};
    const promise=waitForAppUpdate(registration,options);
    return {worker,old,sw,registration,options,promise,expire:()=>expire(),cleared:()=>cleared,
        state(value){worker.state=value;worker.emit('statechange');},control(value=worker){sw.controller=value;sw.emit('controllerchange');},
        clean(){assert.equal(registration.listeners(),0);assert.equal(sw.listeners(),0);assert.equal(worker.listeners(),0);assert.equal(old.listeners(),0);assert.equal(cleared,1);}};
}

test('no registration stays a compatible no-op without scheduling a deadline',async()=>{
    await waitForAppUpdate(undefined,{delay(){assert.fail('No registration needs no timer');}});
});

test('activation-only callers remain supported and never finish at installed',async()=>{
    const f=fixture();let done=false;f.promise.then(()=>done=true);await tick();assert.equal(done,false);
    f.state('installed');await tick();assert.equal(done,false);f.state('activating');await tick();assert.equal(done,false);
    f.state('activated');await f.promise;assert.equal(done,true);f.clean();
});

test('a new active worker still activating cannot produce the old premature success',async()=>{
    const f=fixture({state:'activating'});let done=false;f.promise.then(()=>done=true);await tick();assert.equal(done,false);
    f.state('activated');await f.promise;f.clean();
});

test('an installed waiting worker stays pending until it actually activates',async()=>{
    const f=fixture({state:'installed'});let done=false;f.promise.then(()=>done=true);await tick();assert.equal(done,false);
    f.registration.waiting=null;f.registration.active=f.worker;f.state('activating');await tick();assert.equal(done,false);
    f.state('activated');await f.promise;f.clean();
});

test('with a container, activation must be followed by ownership of this document',async()=>{
    const f=fixture({container:true});let done=false;f.promise.then(()=>done=true);await tick();
    f.registration.installing=null;f.registration.active=f.worker;f.state('activated');await tick();assert.equal(done,false);
    f.control();await f.promise;assert.equal(done,true);f.clean();
});

test('controllerchange before activation is not enough to finish the update',async()=>{
    const f=fixture({state:'activating',container:true});let done=false;f.promise.then(()=>done=true);await tick();
    f.control();await tick();assert.equal(done,false);f.state('activated');await f.promise;f.clean();
});

test('an already activated worker still waits while another worker controls this page',async()=>{
    const f=fixture({state:'activated',container:true});let done=false;f.promise.then(()=>done=true);await tick();assert.equal(done,false);
    f.control();await f.promise;f.clean();
});

test('an unchanged active controller resolves after its update check, without any reload or storage access',async()=>{
    const hold=deferred(),f=fixture({state:'activated',container:true,update:()=>hold.promise});f.control();let done=false;f.promise.then(()=>done=true);await tick();assert.equal(done,false);
    hold.resolve();await f.promise;assert.equal(done,true);f.clean();
});

test('updatefound tracks a newer installation and never falls back to the old active shell',async()=>{
    const hold=deferred(),f=fixture({state:'activated',container:true,update:()=>hold.promise}),next=events({state:'installing'});f.sw.controller=f.worker;
    f.registration.installing=next;f.registration.emit('updatefound');hold.resolve();await tick();
    let done=false;f.promise.then(()=>done=true);f.registration.installing=null;next.state='activating';next.emit('statechange');await tick();assert.equal(done,false);
    f.registration.active=next;next.state='activated';next.emit('statechange');await tick();assert.equal(done,false);
    f.control(next);await f.promise;assert.equal(next.listeners(),0);f.clean();
});

test('a worker that becomes active during update is observed even without an updatefound event',async()=>{
    const hold=deferred(),f=fixture({state:'activated',container:true,update:()=>hold.promise}),next=events({state:'activating'});f.sw.controller=f.worker;
    f.registration.active=next;hold.resolve();await tick();let done=false;f.promise.then(()=>done=true);await tick();assert.equal(done,false);
    next.state='activated';next.emit('statechange');f.control(next);await f.promise;assert.equal(next.listeners(),0);f.clean();
});

test('a failed obsolete installation cannot reject the different newly active controlling worker',async()=>{
    const hold=deferred(),f=fixture({container:true,update:()=>hold.promise}),replacement=events({state:'activated'});
    f.registration.installing=null;f.registration.active=replacement;f.sw.controller=replacement;
    f.state('redundant');hold.resolve();await f.promise;assert.equal(replacement.listeners(),0);f.clean();
});

test('redundant installation rejects instead of confirming the old still-active controller',async()=>{
    const f=fixture({container:true});await tick();f.registration.installing=null;f.state('redundant');await assert.rejects(f.promise,/did not finish/);f.clean();
});

test('activation failure during a stalled update rejects immediately and removes listeners',async()=>{
    const hold=deferred(),f=fixture({update:()=>hold.promise});f.state('redundant');await assert.rejects(f.promise,/did not finish/);f.clean();hold.resolve();await tick();f.clean();
});

for(const phase of ['update','activation','controller'])test(phase+' timeout is bounded and late events cannot complete the retired waiter',async()=>{
    const hold=deferred(),f=fixture({state:phase==='controller'?'activated':'installing',container:true,update:phase==='update'?()=>hold.promise:undefined});await tick();
    const pending=assert.rejects(f.promise,/too long/);f.expire();await pending;f.clean();
    hold.resolve();f.state('activated');f.control();f.registration.emit('updatefound');await tick();f.clean();
});

test('synchronous and asynchronous update failures both release every registered listener',async()=>{
    for(const update of [()=>{throw Error('Synthetic update failure');},async()=>{throw Error('Synthetic update failure');}]){
        const f=fixture({container:true,update});await assert.rejects(f.promise,/Synthetic update failure/);f.clean();
    }
});

test('cleanup failures cannot mask the original error or prevent other listener cleanup',async()=>{
    const f=fixture({container:true});await tick();let attempted=0;f.registration.removeEventListener=()=>{attempted++;throw Error('Synthetic listener failure');};
    const pending=assert.rejects(f.promise,/too long/);f.expire();await pending;assert.equal(attempted,1);assert.equal(f.worker.listeners(),0);assert.equal(f.sw.listeners(),0);assert.equal(f.cleared(),1);
});

test('a missing active worker cannot satisfy explicit controller convergence',async()=>{
    const registration=events({update:async()=>{}}),sw=events({controller:null});let cleared=0;
    await assert.rejects(waitForAppUpdate(registration,{serviceWorker:sw,delay:()=>1,cancelDelay(){cleared++;}}),/could not be confirmed/);
    assert.equal(registration.listeners(),0);assert.equal(sw.listeners(),0);assert.equal(cleared,1);
    await waitForAppUpdate({update:async()=>{}},{delay:()=>1,cancelDelay(){}});
});
