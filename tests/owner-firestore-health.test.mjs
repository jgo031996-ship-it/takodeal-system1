import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createFirestoreHealth,guardFirestoreOperations,installFirestoreHealth,isFatalFirestoreError,
    FIRESTORE_RECOVERY_CODE,FIRESTORE_RECOVERY_MESSAGE} from '../takodeal-manager/firestore-health.js';

const fatal = () => new Error('FIRESTORE (13.1.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) PRIVATE-CONTEXT');
const failed = error => error.code === FIRESTORE_RECOVERY_CODE && error.message === FIRESTORE_RECOVERY_MESSAGE;
function browser() {
    const listeners=new Map(),events=[],effects=[];
    const w={CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
        addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
        dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);return true;},
        location:{reload(){effects.push('reload');}},localStorage:{clear(){effects.push('clear');},removeItem(){effects.push('remove');}},
        indexedDB:{deleteDatabase(){effects.push('deleteDatabase');}}};
    return {w,events,effects,listeners};
}

test('recognizes old/new Firestore assertions from errors, logger messages and browser events only',()=>{
    for(const error of [fatal(), 'FIRESTORE (10.8.1) INTERNAL ASSERTION FAILED: Unexpected state',
        {message:'@firebase/firestore: Firestore (13.1.0): INTERNAL ASSERTION FAILED: Unexpected state'},
        {reason:fatal()},{error:fatal()},{args:['@firebase/firestore:',fatal()]}]) assert.equal(isFatalFirestoreError(error),true);
    for(const error of [null,undefined,{},new Error('permission-denied'),new Error('unavailable'),
        {code:'internal',message:'Server temporarily unavailable'},'INTERNAL ASSERTION FAILED in another library',
        'WebChannel transport errored','FIRESTORE: client is offline','auth/user-token-expired'])assert.equal(isFatalFirestoreError(error),false);
    const cycle={};cycle.error=cycle;assert.equal(isFatalFirestoreError(cycle),false);
    const getter={get message(){throw Error('untrusted');},reason:fatal()};assert.equal(isFatalFirestoreError(getter),true);
});

test('latches once, exposes a sanitized notice and never resets or hides the original error',()=>{
    const notices=[],health=createFirestoreHealth({notify:notice=>notices.push(notice)});
    assert.equal(health.isFailed(),false);assert.equal(health.report(Error('unavailable')),false);
    assert.equal(health.report(fatal()),true);assert.equal(health.report(fatal()),true);
    assert.equal(health.isFailed(),true);assert.deepEqual(notices,[{code:FIRESTORE_RECOVERY_CODE,message:FIRESTORE_RECOVERY_MESSAGE}]);
    assert.throws(()=>health.assertReady(),failed);assert.doesNotMatch(JSON.stringify(notices),/PRIVATE-CONTEXT|ca9|stack/);
    assert.equal(Object.isFrozen(health),true);
});

test('a notification exception cannot escape the Firebase logging callback',()=>{
    const health=createFirestoreHealth({notify(){throw Error('UI unavailable');}});
    assert.doesNotThrow(()=>health.report(fatal()));assert.equal(health.isFailed(),true);
});

test('browser/logger installation is idempotent and leaves default error handling intact',()=>{
    const f=browser(),logs=[];const onLog=(fn,options)=>logs.push({fn,options});
    const health=installFirestoreHealth(f.w,{onLog});assert.equal(installFirestoreHealth(f.w,{onLog}),health);
    assert.equal(f.w.managerCloudHealth,health);assert.equal(logs.length,1);assert.deepEqual(logs[0].options,{level:'error'});
    assert.equal(f.listeners.get('error').length,1);assert.equal(f.listeners.get('unhandledrejection').length,1);
    let prevented=0;f.w.dispatchEvent({type:'error',error:Error('permission-denied'),preventDefault(){prevented++;}});
    assert.equal(health.isFailed(),false);
    logs[0].fn({message:fatal().message});
    f.w.dispatchEvent({type:'unhandledrejection',reason:fatal(),preventDefault(){prevented++;}});
    f.w.dispatchEvent({type:'error',error:fatal(),preventDefault(){prevented++;}});
    assert.equal(f.events.filter(event=>event.type==='managercloudfailure').length,1);
    assert.equal(prevented,0);assert.deepEqual(f.effects,[]);
});

test('an installation made before the logger is available attaches the logger once later',()=>{
    const f=browser(),health=installFirestoreHealth(f.w);let logs=0;
    assert.equal(installFirestoreHealth(f.w,{onLog(){logs++;}}),health);
    installFirestoreHealth(f.w,{onLog(){logs++;}});assert.equal(logs,1);
});

test('guard preserves arguments, receiver and ordinary return values',()=>{
    const health=createFirestoreHealth(),receiver={value:4,run:health.guard(function(a,b){return this.value+a+b;})};
    assert.equal(receiver.run(2,3),9);assert.equal(health.isFailed(),false);
});

test('guard rethrows original synchronous and async errors, latching only fatal errors',async()=>{
    for(const async of [false,true])for(const isFatal of [false,true]){
        const health=createFirestoreHealth(),error=isFatal?fatal():Error('permission-denied');let calls=0;
        const operation=health.guard(()=>{calls++;if(async)return Promise.reject(error);throw error;});
        if(async)await assert.rejects(operation(),actual=>actual===error);else assert.throws(operation,actual=>actual===error);
        assert.equal(health.isFailed(),isFatal);assert.equal(calls,1);
        if(isFatal){assert.throws(operation,failed);assert.equal(calls,1);}
    }
});

for(const name of ['getDoc','getDocs','getDocFromServer','getDocsFromServer','addDoc','setDoc','updateDoc','deleteDoc','enableNetwork','disableNetwork']){
    test(`${name} never reaches the SDK after a fatal queue failure`,async()=>{
        const health=createFirestoreHealth();let calls=0;const sdk=guardFirestoreOperations(health,{[name](){calls++;return Promise.resolve('result');}});
        assert.equal(await sdk[name]('reference'),'result');health.report(fatal());assert.throws(()=>sdk[name]('reference'),failed);assert.equal(calls,1);
    });
}

test('batch methods preserve chaining and guard commits of batches created before failure',async()=>{
    const health=createFirestoreHealth(),calls=[];const batch={set(...a){calls.push(['set',...a]);},update(...a){calls.push(['update',...a]);},delete(...a){calls.push(['delete',...a]);},async commit(){calls.push(['commit']);return 'saved';}};
    const sdk=guardFirestoreOperations(health,{writeBatch(db){calls.push(['batch',db]);return batch;}}),b=sdk.writeBatch('db');
    assert.equal(b.set('one',{}).update('two',{}).delete('three'),b);assert.equal(await b.commit(),'saved');
    health.report(fatal());for(const method of ['set','update','delete','commit'])assert.throws(()=>b[method]('x',{}),failed);
    assert.throws(()=>sdk.writeBatch('db'),failed);assert.equal(calls.length,5);
});

test('batch commit reports a fatal rejection without converting its uncertain result to success',async()=>{
    const health=createFirestoreHealth(),error=fatal();const sdk=guardFirestoreOperations(health,{writeBatch:()=>({async commit(){throw error;}})});
    await assert.rejects(sdk.writeBatch({}).commit(),actual=>actual===error);assert.equal(health.isFailed(),true);
});

test('transaction callbacks, retries and retained transaction methods stop after failure',async()=>{
    const health=createFirestoreHealth(),calls=[];let retry,held;
    const raw={get:async ref=>{calls.push(['get',ref]);return 'snapshot';},set:ref=>calls.push(['set',ref]),update:ref=>calls.push(['update',ref]),delete:ref=>calls.push(['delete',ref])};
    const sdk=guardFirestoreOperations(health,{runTransaction(db,fn,options){calls.push(['transaction',db,options]);retry=()=>fn(raw);return retry();}});
    assert.equal(await sdk.runTransaction('db',async tx=>{held=tx;assert.equal(await tx.get('one'),'snapshot');assert.equal(tx.set('two',{}).update('three',{}).delete('four'),tx);return 'saved';},{maxAttempts:2}),'saved');
    health.report(fatal());for(const method of ['get','set','update','delete'])assert.throws(()=>held[method]('five',{}),failed);
    assert.throws(retry,failed);assert.throws(()=>sdk.runTransaction('db',()=>{}),failed);assert.equal(calls.length,5);
});

for(const options of [false,true])test(`snapshot positional error callback preserves errors and cleanup (options=${options})`,()=>{
    const health=createFirestoreHealth();let args,stops=0,received;
    const sdk=guardFirestoreOperations(health,{onSnapshot(...a){args=a;return()=>{stops++;};}});
    const input=['ref',...(options?[{includeMetadataChanges:true}]:[]),()=>{},error=>{received=error;}],stop=sdk.onSnapshot(...input);
    const normal=Error('permission-denied');args[options?3:2](normal);assert.equal(received,normal);assert.equal(health.isFailed(),false);
    stop();stop();assert.equal(stops,1);
    const stop2=sdk.onSnapshot(...input),error=fatal();args[options?3:2](error);assert.equal(received,error);assert.equal(health.isFailed(),true);
    stop2();stop2();assert.equal(stops,1);assert.throws(()=>sdk.onSnapshot(...input),failed);
});

test('snapshot observer retains its receiver and omitted error callbacks remain omitted',()=>{
    const health=createFirestoreHealth();let args;const sdk=guardFirestoreOperations(health,{onSnapshot(...a){args=a;return()=>{};}});
    const observer={seen:[],next(value){this.seen.push(value);},error(error){this.seen.push(error);},complete(){this.seen.push('done');}};
    sdk.onSnapshot('ref',{includeMetadataChanges:true},observer);args[2].next('value');args[2].complete();const error=Error('unavailable');args[2].error(error);
    assert.deepEqual(observer.seen,['value','done',error]);assert.equal(health.isFailed(),false);
    const next=()=>{};sdk.onSnapshot('ref',next);assert.equal(args.length,2);assert.equal(args[1],next);
});

test('snapshot synchronous assertion is reported; cleanup assertions latch once without cascading',()=>{
    const health=createFirestoreHealth(),error=fatal();const sdk=guardFirestoreOperations(health,{onSnapshot(){throw error;}});
    assert.throws(()=>sdk.onSnapshot('ref',()=>{}),actual=>actual===error);assert.equal(health.isFailed(),true);
    const second=createFirestoreHealth();let stops=0;
    const stop=guardFirestoreOperations(second,{onSnapshot:()=>()=>{stops++;throw fatal();}}).onSnapshot('ref',()=>{});
    assert.doesNotThrow(stop);assert.doesNotThrow(stop);assert.equal(second.isFailed(),true);assert.equal(stops,1);
    const ordinary=Error('cleanup failed');const normalStop=guardFirestoreOperations(createFirestoreHealth(),{onSnapshot:()=>()=>{throw ordinary;}}).onSnapshot('ref',()=>{});
    assert.throws(normalStop,actual=>actual===ordinary);
});

test('actual Owner bootstrap installs logger before Firestore and uses guards for bridge/cache operations',async()=>{
    const source=readFileSync(new URL('../takodeal-manager/firebase-core.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
    const f=browser(),calls=[],raw={};let load;
    for(const name of ['query','where','collection','getDocs','getDoc','addDoc','getDocsFromServer','getDocFromServer','updateDoc','deleteDoc','doc','setDoc','serverTimestamp','increment','orderBy','limit','ref','uploadBytes','getDownloadURL','writeBatch','onSnapshot','startAfter','runTransaction','enableNetwork','disableNetwork'])raw[name]=(...args)=>{calls.push(name);return name==='getDocs'?Promise.resolve({docs:[]}):args;};
    vm.runInNewContext(source,{...raw,window:f.w,installFirestoreHealth,guardFirestoreOperations,initializeApp:()=>({}),
        onLog:()=>calls.push('logger'),initializeFirestore:()=>{calls.push('initializeFirestore');return{};},
        persistentLocalCache:value=>value,persistentMultipleTabManager:()=>({}),getAuth:()=>({currentUser:{uid:'sample'}}),GoogleAuthProvider:class{},getStorage:()=>({}),
        createHQAccountReader:()=>()=>{},createDeviceStore:()=>({}),createCollectionCache:loader=>{load=loader;return{get:loader,invalidate(){},clearMemory(){}};}});
    assert.ok(calls.indexOf('logger')<calls.indexOf('initializeFirestore'));assert.equal(f.w.managerCloudHealth.isFailed(),false);
    await load('sample');assert.equal(calls.filter(name=>name==='getDocs').length,1);
    f.w.managerCloudHealth.report(fatal());assert.throws(()=>f.w.setDoc('sample',{}),failed);await assert.rejects(load('sample'),failed);
    assert.equal(calls.filter(name=>name==='getDocs').length,1);assert.equal(calls.includes('setDoc'),false);assert.deepEqual(f.effects,[]);
});

test('HQ document adapter reuses the primary Firestore instance and guards its operations',async()=>{
    let source=readFileSync(new URL('../takodeal-manager/staff-document-firebase.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
    const health=createFirestoreHealth();let reads=0,signins=0,config;
    const create=vm.runInNewContext(source+'\ncreateStaffDocumentFirebase;',{
        window:{managerCloudHealth:health},guardFirestoreOperations,getApp:()=>({name:'default'}),initializeApp(){assert.fail('HQ cannot initialize another app');},
        getAuth:()=>({currentUser:{uid:'sample'}}),getFirestore:app=>app,signInAnonymously(){signins++;},
        doc:()=>{},getDocFromServer:async()=>{reads++;return 'record';},runTransaction:()=>{},serverTimestamp:()=>{},query:()=>{},where:()=>{},collection:()=>{},getDocsFromServer:async()=>[],onAuthStateChanged:()=>{},
        createDocumentStore:args=>{config=args;return{};}});
    const result=await create({},()=> 'sample',{isHQ:true});assert.equal(result.db.name,'default');assert.equal(signins,0);assert.equal(result.sdk,config.sdk);
    assert.equal(await result.sdk.getDocFromServer('sample'),'record');health.report(fatal());assert.throws(()=>result.sdk.getDocFromServer('sample'),failed);assert.equal(reads,1);
});

test('all Owner Firebase imports use 13.1.0 without changing other apps or deleting local data',()=>{
    for(const name of ['firebase-core.js','auth.js','staff-document-firebase.js']){
        const source=readFileSync(new URL('../takodeal-manager/'+name,import.meta.url),'utf8'),versions=[...source.matchAll(/firebasejs\/([^/]+)\//g)].map(match=>match[1]);
        assert.ok(versions.length>0);assert.ok(versions.every(version=>version==='13.1.0'),name);
    }
    const staff=readFileSync(new URL('../takodeal-staff/staff-document-firebase.js',import.meta.url),'utf8');assert.match(staff,/firebasejs\/10\.8\.1\//);assert.doesNotMatch(staff,/firestore-health/);
    const health=readFileSync(new URL('../takodeal-manager/firestore-health.js',import.meta.url),'utf8');
    assert.doesNotMatch(health,/preventDefault\s*\(|location\.reload|deleteDatabase\s*\(|clearIndexedDbPersistence\s*\(|localStorage\.clear\s*\(/);
});
