import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createUnlockGate, bounded } from '../takodeal-manager/unlock-gate.js';
import { createCollectionCache } from '../takodeal-manager/collection-cache.js';
import { createDeviceStore } from '../takodeal-manager/device-store.js';
const source = name => readFileSync(new URL('../takodeal-manager/'+name,import.meta.url),'utf8');
const user = {uid:'sample-user',email:'sample@example.test',displayName:'Sample Manager'};
const profile = {pin:'6241',role:'Manager',permissions:['dashboard'],assignedBranch:'Sample Branch'};
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };

test('PIN gate verifies once; incorrect PIN cannot load tabs; double unlock loads once',async()=> {
    let checks=0,loads=0;const wait=deferred();
    const gate=createUnlockGate({verify:async()=>{checks++;return profile;},load:async()=>{loads++;await wait.promise;}});
    assert.equal(await gate.unlock(profile.pin),false);
    await gate.identify(user);assert.equal(checks,1);
    assert.equal(await gate.unlock('0000'),false);assert.equal(await gate.unlock(''),false);assert.equal(loads,0);
    const open=gate.unlock(profile.pin);assert.equal(await gate.unlock(profile.pin),false);assert.equal(loads,1);
    wait.resolve();assert.equal(await open,true);assert.equal(gate.state().phase,'open');assert.equal(checks,1);
});
test('late verification cannot restore an account after cancellation or a different account check',async()=> {
    const old=deferred(); const gate=createUnlockGate({verify:u=>u.uid===user.uid?old.promise:Promise.resolve(profile),load:async()=>{}});
    const first=gate.identify(user);gate.reset();old.resolve(profile);await first;assert.equal(gate.state().phase,'signed-out');
    const second=deferred();const other=createUnlockGate({verify:u=>u.uid===user.uid?second.promise:Promise.resolve({...profile,pin:'7392'}),load:async()=>{}});
    const stale=other.identify(user);await other.identify({...user,uid:'other'});second.resolve(profile);await stale;
    assert.equal(await other.unlock(profile.pin),false);assert.equal(await other.unlock('7392'),true);
});
test('offline, revoked access, and missing PIN never open a workspace or invent a default credential',async()=> {
    for(const verify of [async()=>{throw new Error('offline');},async()=>null,async()=>({role:'Owner'})]) {
        let loads=0;const gate=createUnlockGate({verify,load:async()=>{loads++;}});await gate.identify(user);
        assert.equal(gate.state().phase,'unavailable');assert.equal(await gate.unlock('1234'),false);assert.equal(loads,0);
    }
});
test('verification expires and must read current access before a later PIN attempt',async()=> {
    let clock=0,checks=0,loads=0;const gate=createUnlockGate({now:()=>clock,verify:async()=>{checks++;return profile;},load:async()=>{loads++;}});
    await gate.identify(user);clock=300001;assert.equal(await gate.unlock(profile.pin),false);assert.equal(checks,2);assert.equal(loads,0);
    assert.equal(await gate.unlock(profile.pin),true);assert.equal(loads,1);
});
test('a failed workspace load can retry and cancellation during loading cannot unlock',async()=> {
    let loads=0;const gate=createUnlockGate({verify:async()=>profile,load:async()=>{if(++loads===1)throw new Error('tool offline');}});
    await gate.identify(user);assert.equal(await gate.unlock(profile.pin),false);assert.equal(gate.state().phase,'pin');assert.equal(await gate.unlock(profile.pin),true);
    const wait=deferred();const cancelled=createUnlockGate({verify:async()=>profile,load:()=>wait.promise});await cancelled.identify(user);
    const pending=cancelled.unlock(profile.pin);cancelled.reset();wait.resolve();assert.equal(await pending,false);assert.equal(cancelled.state().phase,'signed-out');
});
test('slow account checks have a bounded timeout and late completion cannot escape that timeout',async()=> {
    const wait=deferred();await assert.rejects(bounded(wait.promise,5),/verification.*longer/);wait.resolve(profile);
    assert.deepEqual(await bounded(Promise.resolve(profile),20),profile);
});
function memoryStorage() {
    const records=new Map();return {records,async get(uid,name){return structuredClone(records.get(uid+'/'+name));},async put(uid,name,entry){records.set(uid+'/'+name,structuredClone(entry));},async remove(uid,name){records.delete(uid+'/'+name);}};
}
test('reference cache survives restart without another Firebase read; expiry uses the original timestamp',async()=> {
    const storage=memoryStorage();let clock=100,reads=0;
    const options={storage,scope:()=>user.uid,now:()=>clock};const read=async()=>{reads++;return [{id:'menu-item',name:'Sample'}];};
    await createCollectionCache(read,options).get('menu');clock=1000;
    assert.equal((await createCollectionCache(read,options).get('menu'))[0].name,'Sample');assert.equal(reads,1);
    clock=900101;await createCollectionCache(read,options).get('menu');assert.equal(reads,2);
});
test('different accounts cannot hydrate each other’s menu or recipe cache',async()=> {
    const storage=memoryStorage();const first=createCollectionCache(async()=>[{id:'one'}],{storage,scope:()=>user.uid});await first.get('menu');
    let reads=0;const second=createCollectionCache(async()=>{reads++;return [{id:'two'}];},{storage,scope:()=> 'other'});
    assert.equal((await second.get('menu'))[0].id,'two');assert.equal(reads,1);
});
test('edits invalidate memory and disk; an old in-flight read cannot restore deleted cached data',async()=> {
    const storage=memoryStorage(),old=deferred();let reads=0;
    const cache=createCollectionCache(async()=>++reads===1?old.promise:[{id:'new'}],{storage,scope:()=>user.uid});
    const stale=cache.get('menu');await new Promise(resolve=>setImmediate(resolve));await cache.invalidate('menu');
    old.resolve([{id:'old'}]);await stale;assert.equal(storage.records.size,0);
    assert.equal((await cache.get('menu'))[0].id,'new');assert.equal((await storage.get(user.uid,'menu')).rows[0].id,'new');
});
test('unavailable device storage gracefully falls back to a shared in-memory read',async()=> {
    const unavailable=createDeviceStore(null);assert.equal(await unavailable.get(user.uid,'menu'),null);
    let reads=0;const cache=createCollectionCache(async()=>{reads++;return [];},{storage:unavailable,scope:()=>user.uid});
    await Promise.all([cache.get('menu'),cache.get('menu')]);assert.equal(reads,1);
    const failed={get:async()=>{throw new Error('quota');},put:async()=>{throw new Error('quota');}};
    assert.deepEqual(await createCollectionCache(async()=>[{id:'safe'}],{storage:failed,scope:()=>user.uid}).get('bom'),[{id:'safe'}]);
});
test('device store never saves PINs, permissions, sales, or live inventory',async()=> {
    let opens=0;const store=createDeviceStore({open(){opens++;throw new Error('unexpected');}});
    for(const name of ['hq_managers','transactions','cash_accounts','inventory','auth']) assert.equal(await store.put(user.uid,name,{pin:'sample'}),null);
    assert.equal(opens,0);
});
test('actual auth controller checks server access before PIN and loads the dashboard once',async()=> {
    const nodes=new Map();const node=id=>nodes.get(id)||nodes.set(id,{id,hidden:false,disabled:false,value:'',textContent:'',style:{},focus(){}}).get(id);
    let identify,serverReads=0,workspaceLoads=0,dashboardLoads=0;
    const w={auth:{currentUser:user},provider:{},ManagerLogin:{show(){},status(){},error(){},busy(){}},
        query:(...args)=>args,collection:()=>({}),where:()=>({}),getDocsFromServer:async()=>{serverReads++;return {empty:false,docs:[{id:'approved',data:()=>profile}]};},
        dispatchEvent(){},loadWorkspaceTest:async()=>{workspaceLoads++;w.switchView=()=>dashboardLoads++;},applyFranchiseUIProtections(){}};
    const context={window:w,document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>({})},navigator:{onLine:true},location:{reload(){}},Event:class{},setTimeout,clearTimeout,createUnlockGate,bounded,loadManagerLibraries:async()=>{},prepareManagerTools:()=>{},signInWithPopup:async()=>{},signOut:async()=>{},onAuthStateChanged:(_,fn)=>identify=fn};
    const auth=source('auth.js').replace(/^import .*;\r?\n/gm,'').replace("await import('./main.js?v=manager-login-20261004')",'await window.loadWorkspaceTest()');
    vm.runInNewContext(auth,context);identify(user);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(serverReads,1);assert.equal(workspaceLoads,0);node('managerPinInput').value='0000';await w.checkManagerPin();assert.equal(workspaceLoads,0);
    node('managerPinInput').value=profile.pin;await w.checkManagerPin();assert.equal(workspaceLoads,1);assert.equal(dashboardLoads,1);assert.equal(node('loginOverlay').style.display,'none');assert.equal(w.tempAuthData,null);
});
function workerHarness() {
    const handlers={},stores=new Map();let network=0;
    const normal=x=>typeof x==='string'?x:x.url;
    const cacheFor=name=>{if(!stores.has(name))stores.set(name,new Map());const records=stores.get(name);return {async match(request,options={}){const key=normal(request);return [...records].find(([url])=>options.ignoreSearch?url.split('?')[0]===key.split('?')[0]:url===key)?.[1];},async put(request,response){records.set(normal(request),response);}};};
    vm.runInNewContext(source('sw.js'),{URL,Response,self:{location:{origin:'https://sample.test',href:'https://sample.test/sw.js'},addEventListener:(name,fn)=>handlers[name]=fn},caches:{open:async name=>cacheFor(name)},fetch:async()=>{network++;return new Response('network');}});
    async function request(url,extra={}) {let reply;handlers.fetch({request:{method:'GET',mode:'cors',destination:'script',url,...extra},respondWith:value=>reply=value});return reply ? await reply : null;}
    return {request,cacheFor,network:()=>network};
}
test('installed core cache serves repeat launches without fetching scripts or background refreshes',async()=> {
    const worker=workerHarness();await worker.request('https://sample.test/main.js?v=new');assert.equal(worker.network(),1);
    assert.equal(await (await worker.request('https://sample.test/main.js?v=another')).text(),'network');assert.equal(worker.network(),1);
    await worker.cacheFor('takodeal-manager-core-v13-login').put('https://sample.test/index.html',new Response('saved app'));
    assert.equal(await (await worker.request('https://sample.test/',{mode:'navigate'})).text(),'saved app');assert.equal(worker.network(),1);
});
test('worker never caches Firestore, authentication or business API responses',async()=> {
    const worker=workerHarness();for(const url of ['https://firestore.googleapis.com/v1/projects/test/documents:batchGet','https://identitytoolkit.googleapis.com/v1/accounts:lookup','https://sample.test/api/sales','https://securetoken.googleapis.com/v1/token']) assert.equal(await worker.request(url),null);
    assert.equal(await worker.request('https://sample.test/main.js',{method:'POST'}),null);assert.equal(worker.network(),0);
});
test('index does not start the heavy Manager or report libraries before unlock; late DOM setup runs once',async()=> {
    const html=source('index.html');assert.doesNotMatch(html,/<script[^>]+src="main\.js/);assert.doesNotMatch(html,/<script[^>]+src="https:\/\/[^\"]*(chart|xlsx|leaflet|html2pdf)/);
    const main=source('main.js');assert.doesNotMatch(main,/window\.(checkManagerPin|finalizeManagerLogin)\s*=/);
    assert.doesNotMatch(main,/setInterval\(function\(\).*?undefined:/s);assert.doesNotMatch(main,/STEP 3: Contacting Firebase/);
    for(const readyState of ['loading','complete']) {
        let registered,executed=0;const context={document:{readyState,addEventListener:(_,fn)=>registered=fn},queueMicrotask};
        vm.runInNewContext(main.split('\n')[0]+'\nrunManagerDomReady(()=>execute());',{...context,execute:()=>executed++});
        registered?.();await new Promise(resolve=>setImmediate(resolve));assert.equal(executed,1);
    }
});
import { loadManagerLibraries, prepareManagerTools } from '../takodeal-manager/manager-libraries.js';
test('first unlock only loads charts and dialogs; export and map libraries load on demand',async()=> {
    const loaded=[];const w={};const d={head:{appendChild:script=>{loaded.push(script.src);queueMicrotask(()=>script.onload?.());}},createElement:()=>({remove(){}}),getElementById:()=>null};
    await loadManagerLibraries(w,d);assert.equal(loaded.length,2);assert.ok(loaded.some(url=>url.includes('chart.js')));assert.ok(loaded.some(url=>url.includes('sweetalert2')));assert.ok(!loaded.some(url=>/xlsx|leaflet|html2pdf/.test(url)));
    let exports=0;w.Swal={fire:async()=>{}};w.openArchiveSalesModal=()=>exports++;prepareManagerTools(w,d);await w.openArchiveSalesModal();
    assert.equal(exports,1);assert.ok(loaded.at(-1).includes('xlsx'));
});
test('IndexedDB reference adapter commits writes, survives reopening, isolates users and deletes edited rows',async()=> {
    const records=new Map();let initialized=false;
    const database={createObjectStore(){initialized=true;},close(){},transaction(){const tx={objectStore(){const operation=fn=>{const request={};queueMicrotask(()=>{request.result=fn();request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return request;};return {get:key=>operation(()=>structuredClone(records.get(key))),put:(value,key)=>operation(()=>{records.set(key,structuredClone(value));return key;}),delete:key=>operation(()=>records.delete(key))};}};return tx;}};
    const indexedDB={open(){const request={result:database};queueMicrotask(()=>{if(!initialized)request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
    const entry={rows:[{id:'sample'}],at:123};await createDeviceStore(indexedDB).put(user.uid,'menu',entry);
    const reopened=createDeviceStore(indexedDB);assert.deepEqual(await reopened.get(user.uid,'menu'),entry);assert.equal(await reopened.get('other','menu'),null);
    await reopened.remove(user.uid,'menu');assert.equal(await reopened.get(user.uid,'menu'),null);
});
test('blocked IndexedDB does not hold the app open waiting for a database',async()=> {
    const blocked={open(){const request={};queueMicrotask(()=>request.onblocked());return request;}};
    assert.equal(await createDeviceStore(blocked).get(user.uid,'menu'),null);
});
