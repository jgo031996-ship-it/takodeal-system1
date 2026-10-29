import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {OWNER_DOCUMENT_RELEASE} from '../takodeal-manager/owner-update-notice.js';

const read=file=>readFileSync(new URL('../takodeal-manager/'+file,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const executable=source=>source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const clone=value=>JSON.parse(JSON.stringify(value));

test('the actual login entry installs the notice before a pending service-worker ready promise',async()=>{
    const ready=deferred(),calls=[],nodes=new Map(),registration={update:async()=>{calls.push('update');}},installation={check(){}};
    const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{toggle(){}},querySelectorAll(){return[];}});return nodes.get(id);};
    const w={addEventListener(){}},d={getElementById:node,addEventListener(){}},nav={onLine:true,serviceWorker:{ready:ready.promise,register:async(...args)=>{calls.push(['register',...args]);return registration;}}};
    let loginUpdate;
    const context={window:w,document:d,navigator:nav,matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout(){},
        installOwnerLoginUpdate(...args){assert.equal(args[0],w);assert.equal(args[1],d);assert.equal(args[2],nav);loginUpdate=args[3];},
        installOwnerUpdateNotice(...args){assert.equal(args[0],w);assert.equal(args[1],d);assert.equal(args[2],nav);assert.equal(args[3],registration);calls.push('install-notice');return installation;}};
    assert.match(read('login-ui.js'),/import\s*\{installOwnerUpdateNotice\}\s*from\s*'\.\/owner-update-notice\.js'/);
    assert.match(read('login-ui.js'),/import\s*\{installOwnerLoginUpdate\}\s*from\s*'\.\/login-update\.js'/);
    vm.runInNewContext(executable(read('login-ui.js')),context);await tick();
    assert.deepEqual(clone(calls),[['register','./sw.js',{updateViaCache:'none'}],'install-notice']);assert.equal(w.ownerUpdateNotice,installation);assert.equal(await loginUpdate.getRegistration(),registration,'Login update uses the same registration without awaiting serviceWorker.ready.');
    ready.resolve(registration);await tick();assert.equal(calls.at(-1),'update');
});
test('the actual login entry retries a failed shell registration from its explicit update callback without account reads',async()=>{
    const first=deferred(),ready=deferred(),calls=[],nodes=new Map(),registration={update:async()=>{calls.push('update');}};let loginUpdate;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{toggle(){}},querySelectorAll(){return[];}});return nodes.get(id);};
    const w={addEventListener(){}},d={getElementById:node,addEventListener(){}},nav={onLine:true,serviceWorker:{ready:ready.promise,register(...args){calls.push(['register',...args]);return calls.filter(row=>Array.isArray(row)).length===1?first.promise:Promise.resolve(registration);}}};
    for(const field of ['auth','sessionUser','localStorage','sessionStorage'])Object.defineProperty(w,field,{get(){assert.fail('App-shell retry cannot read '+field);}});
    const installation={check(){}};
    vm.runInNewContext(executable(read('login-ui.js')),{window:w,document:d,navigator:nav,matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout(){},
        installOwnerLoginUpdate(...args){loginUpdate=args[3];},installOwnerUpdateNotice(...args){assert.equal(args[3],registration);calls.push('install-notice');return installation;}});
    assert.equal(calls.length,1);first.reject(Error('Synthetic first shell registration failed.'));await tick();assert.match(node('loginDeviceDescription').textContent,/Device cache is unavailable/);
    const retry=loginUpdate.getRegistration(),duplicate=loginUpdate.getRegistration();assert.equal(retry,duplicate,'Concurrent explicit retry callbacks share the same registration promise.');assert.equal(await retry,registration);await tick();
    assert.deepEqual(clone(calls),[['register','./sw.js',{updateViaCache:'none'}],['register','./sw.js',{updateViaCache:'none'}],'install-notice']);assert.equal(w.ownerUpdateNotice,installation);
    assert.equal(await loginUpdate.getRegistration(),registration);assert.equal(calls.filter(row=>Array.isArray(row)).length,2,'A successful retry remains the current shell registration.');
    ready.resolve(registration);await tick();assert.equal(calls.at(-1),'update');
});

function fleet(waiter){
    const calls={reloads:0,waits:[],lookups:0},status={textContent:''},registration={},serviceWorker={getRegistration:async()=>{calls.lookups++;return registration;}};
    const w={location:{reload(){calls.reloads++;}},addEventListener(){},switchView(){}},nav={onLine:true,serviceWorker};
    const context={window:w,document:{getElementById:()=>status,addEventListener(){}},navigator:nav,clearTimeout(){},
        waitForAppUpdate(...args){calls.waits.push(args);return waiter(...args);}};
    const source=read('device-fleet.js');assert.match(source,/import\s*\{waitForAppUpdate\}\s*from\s*'\.\/owner-app-update\.js'/);
    vm.runInNewContext(executable(source)+'\ninstallDeviceFleet();',context);
    return {calls,w,status,registration,serviceWorker};
}

test('the actual Device Fleet update passes its container and cannot reload before the waiter finishes',async()=>{
    const hold=deferred(),f=fleet(()=>hold.promise),pending=f.w.checkManagerAppUpdate();await tick();
    assert.equal(f.calls.waits.length,1);assert.equal(f.calls.waits[0][0],f.registration);assert.equal(f.calls.waits[0][1].serviceWorker,f.serviceWorker);assert.equal(f.calls.reloads,0);
    await f.w.checkManagerAppUpdate();assert.equal(f.calls.lookups,1);hold.resolve();await pending;assert.equal(f.calls.reloads,1);
});

test('the actual Device Fleet failure keeps the page open, reports the error and permits a later retry',async()=>{
    let failing=true;const f=fleet(async()=>{if(failing)throw Error('Synthetic activation failed');});
    await f.w.checkManagerAppUpdate();assert.equal(f.calls.reloads,0);assert.equal(f.status.textContent,'Synthetic activation failed');
    failing=false;await f.w.checkManagerAppUpdate();assert.equal(f.calls.waits.length,2);assert.equal(f.calls.reloads,1);
});

function worker(){
    const handlers=new Map(),context={URL,self:{location:{origin:'https://owner.example',href:'https://owner.example/sw.js'},addEventListener:(name,fn)=>handlers.set(name,fn)}};
    for(const name of ['caches','indexedDB','localStorage','fetch'])Object.defineProperty(context,name,{get(){assert.fail('Release discovery must not access '+name);}});
    vm.runInNewContext(read('sw.js')+'\nthis.cachedAssets=CORE_ASSETS;this.release=CACHE_NAME;',context);
    return {handlers,context};
}

test('the actual worker answers only the typed release handshake with its exact generation and touches no storage',()=>{
    const f=worker(),messages=[],port={postMessage:value=>messages.push(clone(value))},message=f.handlers.get('message');assert.equal(typeof message,'function');
    for(const data of [undefined,{},'OWNER_RELEASE_CHECK',{type:'another-message'}])message({data,ports:[port]});assert.deepEqual(messages,[]);
    message({data:{type:'OWNER_RELEASE_CHECK'},ports:[port]});assert.deepEqual(messages,[{type:'OWNER_RELEASE',release:f.context.release}]);assert.equal(f.context.release,OWNER_DOCUMENT_RELEASE);
    assert.doesNotThrow(()=>message({data:{type:'OWNER_RELEASE_CHECK'}}));assert.doesNotThrow(()=>message({data:{type:'OWNER_RELEASE_CHECK'},ports:[{postMessage(){throw Error('Closed port');}}]}));
});

test('the current worker caches both update modules and every declared Owner dependency exists',()=>{
    const f=worker(),assets=Array.from(f.context.cachedAssets),required=['./owner-app-update.js','./owner-update-notice.js','./login-ui.js','./login-update.js','./device-fleet.js'];
    for(const file of required)assert.equal(assets.filter(asset=>asset===file).length,1,file);
    for(const file of new Set(assets))assert.equal(existsSync(new URL('../takodeal-manager/'+file.replace(/^\.\//,''),import.meta.url)),true,file);
    for(const file of ['owner-update-notice.js','device-fleet.js','login-update.js'])assert.match(read(file),/from\s*'\.\/owner-app-update\.js'/);
});
