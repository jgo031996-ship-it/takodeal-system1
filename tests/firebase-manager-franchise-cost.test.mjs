import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createLogisticsFeed } from '../takodeal-manager/logistics-feed.js';
import { canOpenWorkspacePage } from '../takodeal-manager/workspace-access-model.js';
import { createCollectionCache } from '../takodeal-manager/collection-cache.js';
import { createDashboard } from '../takodeal-manager/dashboard.js';
import { createFranchiseReads } from '../takodeal-franchise/franchise-reads.js';
import { installFranchiseWorkspace } from '../takodeal-franchise/franchise-workspace.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = rows => ({ docs:rows.map((data,i) => ({id:'doc-'+i,data:()=>data})), metadata:{fromCache:false},
    forEach(fn) { this.docs.forEach(fn); }, docChanges:() => rows.map(data=>({type:'added',doc:{data:()=>data}})) });

function logisticsFixture() {
    const main = readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
    const block = main.slice(main.indexOf('const logisticsFeed = createLogisticsFeed('), main.indexOf('window.switchLogisticsBranch ='));
    const listeners=[],events={},badge={style:{}},w={sessionUser:{email:'owner@test',uid:'owner',permissions:['all']},
        auth:{currentUser:{uid:'owner'}},logisticsState:{requests:[],deliveries:[]},
        onSnapshot(ref,next,error) { const listener={ref,next,error,stopped:false};listeners.push(listener);return ()=>{listener.stopped=true;}; },
        addEventListener:(name,fn)=>events[name]=fn,renderLogisticsUI(){},playManagerPing(){w.pings++;},pings:0};
    const d={visibilityState:'visible',getElementById:()=>badge,addEventListener:(name,fn)=>events[name]=fn};
    vm.runInNewContext(block,{window:w,document:d,createLogisticsFeed,canOpenWorkspacePage,db:{},
        collection:(_,table)=>({table}),where:(...args)=>args,query:(ref,...filters)=>({...ref,filters}),
        Swal:{fire(){}},console});
    return {w,d,listeners,events,badge};
}

test('actual logistics starter owns exactly two subscriptions across repeated calls',()=>{
    const f=logisticsFixture();f.w.startPOListener();f.w.startPOListener();f.w.startPOListener();
    assert.deepEqual(f.listeners.map(l=>l.ref.table),['purchase_orders','dispatch_logs']);
    assert.equal(f.listeners.filter(l=>!l.stopped).length,2);
    f.listeners[0].next(snapshot([{status:'Pending',branch:'Maa',timestamp:1},{status:'Delayed',timestamp:2}]));
    assert.equal(f.badge.innerText,1);assert.equal(f.w.logisticsState.requests.length,2);assert.equal(f.w.pings,0);
    f.listeners[0].next(snapshot([{status:'Pending',timestamp:3}]));assert.equal(f.w.pings,1);
    f.listeners[1].next(snapshot([{timestamp:1,branch:'Maa'},{timestamp:2,branch:'Other'}]));
    assert.equal(f.w.logisticsState.deliveries.length,2,'delivery history is not limited');
    f.w.stopPOListener();assert.ok(f.listeners.every(l=>l.stopped));
});

test('background alerts remain live without reconnect churn; page exit stops both feeds and stale callbacks',()=>{
    const f=logisticsFixture();f.w.startPOListener();const old=f.listeners[0];
    f.d.visibilityState='hidden';f.events.visibilitychange();assert.ok(f.listeners.every(l=>!l.stopped));
    old.next(snapshot([{status:'Pending',timestamp:1}]));assert.equal(f.w.logisticsState.requests.length,1);assert.equal(f.badge.innerText,1);
    old.next(snapshot([{status:'Pending',timestamp:2}]));assert.equal(f.w.pings,1,'new-order notifications still arrive in the background');
    f.d.visibilityState='visible';f.events.visibilitychange();f.events.pageshow();assert.equal(f.listeners.length,2);
    f.events.pagehide();assert.ok(f.listeners.every(l=>l.stopped));
    old.next(snapshot([{status:'Pending',timestamp:99}]));assert.equal(f.w.logisticsState.requests[0].timestamp,2);
    f.events.pageshow();f.events.visibilitychange();assert.equal(f.listeners.length,4);
    f.w.stopPOListener();
});

test('logistics respects saved access and rebuilds its existing branch query on identity changes',()=>{
    const f=logisticsFixture();f.w.sessionUser.permissions=['dashboard'];f.w.startPOListener();assert.equal(f.listeners.length,0);
    Object.assign(f.w.sessionUser,{permissions:['dispatch'],isFranchisee:true,branch:'Maa',allowedBranches:['Maa']});f.w.startPOListener();
    assert.deepEqual(Array.from(f.listeners[0].ref.filters[0]),['branch','==','Maa']);
    const old=f.listeners[0];f.w.auth.currentUser.uid='second';f.w.sessionUser.uid='second';f.w.startPOListener();
    assert.ok(f.listeners.slice(0,2).every(l=>l.stopped));assert.equal(f.listeners.length,4);
    old.next(snapshot([{status:'Pending'}]));assert.equal(f.w.logisticsState.requests.length,0);
    f.w.sessionUser=null;f.listeners[2].next(snapshot([{status:'Pending'}]));assert.equal(f.w.logisticsState.requests.length,0);
    assert.ok(f.listeners.every(l=>l.stopped),'session-ending callbacks release both subscriptions');
    f.w.startPOListener();assert.ok(f.listeners.every(l=>l.stopped));
});

test('subscription failures close the partner and permit one clean retry',()=>{
    const created=[],errors=[];
    const subscribe=(next,error)=>{const l={next,error,stopped:false};created.push(l);return ()=>l.stopped=true;};
    const feed=createLogisticsFeed({scope:()=> 'owner',orders:subscribe,deliveries:subscribe,onOrders(){},onDeliveries(){},onError:error=>errors.push(error)});
    feed.start();created[1].error(new Error('permission-denied'));assert.ok(created.every(l=>l.stopped));assert.equal(errors.length,1);
    feed.start();feed.start();assert.equal(created.length,4);feed.stop();
    let synchronousStop=0;
    const failed=createLogisticsFeed({scope:()=> 'owner',orders:(_,error)=>{error(new Error('Failed immediately'));return ()=>synchronousStop++;},
        deliveries:()=>{throw Error('Should not subscribe');},onOrders(){},onDeliveries(){}});
    assert.equal(failed.start(),false);assert.equal(synchronousStop,1);
});

function dashboardFixture() {
    const ids=[...readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
    const nodes=new Map(ids.map(id=>[id,{id,value:'',innerHTML:'',textContent:'',hidden:false,style:{},classList:{contains:()=>true},querySelector:()=>({}),querySelectorAll:()=>[],setAttribute(){}}]));
    nodes.set('dashBranchFilter',{...nodes.get('dashStartDate'),id:'dashBranchFilter',value:'All'});
    nodes.get('dashStartDate').value=nodes.get('dashEndDate').value='2026-10-03';
    const reads=[],invalidated=[],listeners=[],source={branches:[{name:'Maa'}],inventory:[],bom:[],menu:[]};
    const w={sessionUser:{email:'owner@test',permissions:['all']},auth:{currentUser:{uid:'owner'}},db:{},isBranchAllowed:()=>true,
        collection:(_,table)=>({table}),doc:(_,table,id)=>({table:table+'/'+id}),where:(...args)=>args,query:(ref,...filters)=>({...ref,filters}),
        getDocs:async ref=>{reads.push(ref.table);return snapshot(source[ref.table] || []);},
        onSnapshot:(ref,_,next,error)=>{const l={ref,next,error,stopped:false};listeners.push(l);return ()=>l.stopped=true;}};
    const cache=createCollectionCache(async name=>{reads.push(name);return source[name] || [];},{scope:()=>w.auth.currentUser.uid});
    w.fetchCachedCollection=name=>cache.get(name);w.invalidateCache=name=>{invalidated.push(name);return cache.invalidate(name);};
    const controller=createDashboard(w,{getElementById:id=>nodes.get(id),body:{classList:{add(){}}}});
    return {w,cache,controller,nodes,reads,invalidated,listeners};
}

test('Dashboard reuses Menu/Inventory reference reads and explicit Refresh reloads all references',async()=>{
    const f=dashboardFixture();await Promise.all(['inventory','bom','menu'].map(name=>f.cache.get(name)));
    await f.controller.load();assert.deepEqual(f.reads,['inventory','bom','menu','branches']);assert.equal(f.listeners.length,8);
    await f.controller.load();assert.equal(f.reads.length,4);
    await f.controller.load({force:true});assert.equal(f.reads.length,8);
    assert.deepEqual(f.invalidated,['branches','inventory','bom','menu']);
    assert.equal(f.listeners.filter(l=>!l.stopped).length,8);f.controller.stop();
});

test('Dashboard cannot reuse another identity’s reference cache or old live callbacks',async()=>{
    const f=dashboardFixture();await f.controller.load();const old=f.listeners[0];
    f.w.auth.currentUser.uid='other';f.w.sessionUser={email:'other@test',permissions:['all']};await f.controller.load();
    assert.equal(f.reads.length,8);assert.ok(f.listeners.slice(0,8).every(l=>l.stopped));
    const before=f.nodes.get('dashNetSales').textContent;old.next(snapshot([{netTotal:999,status:'Paid',branch:'Maa'}]));
    assert.equal(f.nodes.get('dashNetSales').textContent,before);f.controller.stop();
});

test('shared branch references retain the Dashboard’s original one-minute freshness',async()=>{
    let now=0;const reads=[],cache=createCollectionCache(async name=>{reads.push(name);return [];},{now:()=>now});
    await Promise.all([cache.get('branches'),cache.get('menu')]);now=59000;
    await Promise.all([cache.get('branches'),cache.get('menu')]);assert.equal(reads.length,2);
    now=60000;await Promise.all([cache.get('branches'),cache.get('menu')]);assert.deepEqual(reads,['branches','menu','branches']);
});

function franchiseReaderFixture() {
    let identity='uid/owner/Maa/all';const calls=[];
    const api={db:{},collection:(_,table)=>({table}),where:(...args)=>args,query:(ref,...filters)=>({...ref,filters}),
        getDocsFromServer:query=>{const d=deferred();calls.push({query,...d});return d.promise;}};
    const reader=createFranchiseReads(api,{scope:()=>identity});
    return {reader,calls,api,setScope:value=>identity=value};
}
const period={branch:'Maa',time:'timestamp',start:new Date('2026-10-03T08:30:00+08:00'),end:new Date('2026-10-04T08:30:00+08:00')};

test('Franchise concurrent equal branch/date reads use one server query; every settled refresh stays fresh',async()=>{
    const f=franchiseReaderFixture(),a=f.reader.read('transactions',period),b=f.reader.read('transactions',{...period,start:new Date(+period.start)});await tick();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].query.filters.length,3);
    f.calls[0].resolve(snapshot([{id:'forged',branch:'Maa',timestamp:period.start,netTotal:0}]));
    const [one,two]=await Promise.all([a,b]);assert.equal(one[0].id,'doc-0');assert.equal(one[0].netTotal,0);assert.notEqual(one,two);assert.notEqual(one[0],two[0]);
    const next=f.reader.read('transactions',period);await tick();assert.equal(f.calls.length,2);f.calls[1].resolve(snapshot([]));await next;
});

test('global staff and HQ reads coalesce only equal filters and preserve legacy rows',async()=>{
    const f=franchiseReaderFixture();const a=f.reader.globalRead('staff_deductions',['staffName','in',['Alex']]);
    const b=f.reader.globalRead('staff_deductions',['staffName','in',['Alex']]);
    const c=f.reader.globalRead('staff_deductions',['staffName','in',['Other']]);await tick();assert.equal(f.calls.length,2);
    f.calls[0].resolve(snapshot([{staffName:'Alex',amount:20}]));f.calls[1].resolve(snapshot([{staffName:'Other',amount:10}]));
    assert.equal((await a)[0].amount,20);assert.equal((await b).length,1);assert.equal((await c)[0].amount,10);
});

test('failed shared reads retry once, without reusing a rejected promise or falling back on access errors',async()=>{
    const f=franchiseReaderFixture();const outcomes=Promise.allSettled([f.reader.read('expenses',period),f.reader.read('expenses',period)]);await tick();
    f.calls[0].reject(Object.assign(new Error('Denied'),{code:'permission-denied'}));assert.ok((await outcomes).every(r=>r.status==='rejected'));
    assert.equal(f.calls.length,1);const retry=f.reader.read('expenses',period);await tick();assert.equal(f.calls.length,2);f.calls[1].resolve(snapshot([]));await retry;
});

test('missing-index fallback is shared, reads the full branch, and retains exact period filtering',async()=>{
    const f=franchiseReaderFixture(),a=f.reader.read('expenses',period),b=f.reader.read('expenses',period);await tick();
    f.calls[0].reject(Object.assign(new Error('Index needed'),{code:'failed-precondition'}));await tick();assert.equal(f.calls.length,2);
    assert.deepEqual(f.calls[1].query.filters,[['branch','==','Maa']]);
    f.calls[1].resolve(snapshot([{branch:'Maa',timestamp:period.start,amount:0},{branch:'Maa',timestamp:period.end,amount:1},{branch:'Maa',timestamp:new Date(+period.start-1),amount:2},{branch:'Other',timestamp:period.start,amount:3}]));
    assert.equal((await a).length,1);assert.equal((await b)[0].amount,0);
    const history=f.reader.read('shifts',{branch:'Maa'});await tick();const oldRows=Array.from({length:1001},()=>({branch:'Maa',status:'Closed',startTime:new Date('2026-01-01')}));
    f.calls[2].resolve(snapshot(oldRows));assert.equal((await history).length,1001,'legacy shifts are not dropped by a limit or endTime constraint');
});

test('identity/access changes start separate reads and reject old results, including same branch accounts',async()=>{
    const f=franchiseReaderFixture(),old=f.reader.read('expenses',period),oldResult=assert.rejects(old,/account or data changed/);await tick();
    f.setScope('uid/other/Maa/expenses');const fresh=f.reader.read('expenses',period);await tick();assert.equal(f.calls.length,2);
    f.calls[0].resolve(snapshot([{branch:'Maa',timestamp:period.start,amount:100}]));await oldResult;
    f.calls[1].resolve(snapshot([{branch:'Maa',timestamp:period.start,amount:200}]));assert.equal((await fresh)[0].amount,200);
});

test('same-account reset rejects old branch/global results; old cleanup cannot remove a new pending request',async()=>{
    for (const global of [false,true]) {
        const f=franchiseReaderFixture(),read=()=>global?f.reader.globalRead('announcements',['active','==',true]):f.reader.read('expenses',period);
        const old=read(),rejected=assert.rejects(old,/account or data changed/);await tick();f.reader.reset();const next=read();await tick();
        assert.equal(f.calls.length,2);f.calls[0].resolve(snapshot([]));await rejected;
        const shared=read();await tick();assert.equal(f.calls.length,2,'old completion must not evict a newer in-flight read');
        f.calls[1].resolve(snapshot([]));await Promise.all([next,shared]);
    }
});

test('reset during an index failure never launches the old full-branch fallback',async()=>{
    const f=franchiseReaderFixture(),read=f.reader.read('expenses',period),rejected=assert.rejects(read,/account or data changed/);await tick();f.reader.reset();
    f.calls[0].reject(Object.assign(new Error('Index needed'),{code:'failed-precondition'}));await rejected;assert.equal(f.calls.length,1);
});

function fakeNode(tag='div') {
    const classes=new Set(),node={tagName:tag.toUpperCase(),childNodes:[],value:'',dataset:{},style:{},hidden:false,disabled:false,events:{},
        classList:{contains:c=>classes.has(c),add:(...cs)=>cs.forEach(c=>classes.add(c)),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),toggle(c,v){v ??= !classes.has(c);v?classes.add(c):classes.delete(c);return v;}},
        setAttribute(){},addEventListener(name,fn){this.events[name]=fn;},append(...children){if(this.tagName==='SELECT' && !this.childNodes.length)this.value=children[0]?.value || '';this.childNodes.push(...children);},insertBefore(child){this.childNodes.unshift(child);},replaceChildren(...children){this.childNodes=children;},querySelectorAll:()=>[],querySelector:()=>null};
    if(tag==='table')node.tBodies=[fakeNode('tbody')];return node;
}
function workspaceFixture() {
    const descriptors=new Map(),names=['document','navigator','addEventListener','innerWidth','Option','requestAnimationFrame'];
    names.forEach(name=>descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name)));
    const nodes=new Map([...readFileSync(new URL('../takodeal-franchise/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>[m[1],fakeNode()]));
    const globals={document:{getElementById:id=>nodes.get(id),createElement:tag=>fakeNode(tag)},navigator:{onLine:true},addEventListener(){},innerWidth:1024,
        Option:function(label,value){const n=fakeNode('option');n.textContent=label;n.value=value;return n;},requestAnimationFrame(){}};
    for(const [name,value] of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    const calls=[],api={sessionUser:{email:'owner@test',cashierName:'Owner',branch:'Maa',allowedBranches:['Maa','Other'],permissions:['all']},
        auth:{currentUser:{uid:'owner'}},db:{},collection:(_,table)=>({table}),query:(ref,...filters)=>({...ref,filters}),where:(...args)=>args,
        getDocsFromServer:query=>{const d=deferred();calls.push({query,...d});return d.promise;}};
    installFranchiseWorkspace(api);nodes.get('globalStartDate').value=nodes.get('globalEndDate').value='2026-10-03';
    const cleanup=()=>{for(const name of names){const descriptor=descriptors.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
    return {api,calls,nodes,cleanup};
}

test('actual Franchise expenses page shares overlapping loads; explicit Sync does not reuse an older response',async()=>{
    const f=workspaceFixture();try {
        const first=f.api.switchView('expenses'),second=f.api.switchView('expenses');await tick();assert.equal(f.calls.length,1);
        f.calls[0].resolve(snapshot([{branch:'Maa',timestamp:period.start,amount:10,category:'Water'}]));await Promise.all([first,second]);
        assert.equal(f.api.franchiseState.loaded.get('expenses').rows[0].amount,10);
        const old=f.api.switchView('expenses');await tick();const sync=f.api.refreshActiveData();await tick();assert.equal(f.calls.length,3);
        f.calls[1].resolve(snapshot([{branch:'Maa',timestamp:period.start,amount:20}]));await old;
        f.calls[2].resolve(snapshot([{branch:'Maa',timestamp:period.start,amount:30}]));await sync;
        assert.equal(f.api.franchiseState.loaded.get('expenses').rows[0].amount,30);
        f.api.sessionUser.permissions=['dashboard'];const count=f.calls.length;await assert.rejects(f.api.switchView('expenses'),/outside your assigned access/);assert.equal(f.calls.length,count);
    } finally {f.cleanup();}
});
