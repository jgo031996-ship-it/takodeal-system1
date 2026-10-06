import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createAuditRecovery,installSaleSafety,mergePendingSales} from '../Takodeal-POS/pos-checkout.js';
import {createShiftSalesFeed,createParkedOrdersFeed,mergeParkedOrders} from '../Takodeal-POS/shift-sales.js';
import {createSaleEngine,SALE_VERSION} from '../Takodeal-POS/pos-safety.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const recipe=[{menuItem:'Meal',ingredientName:'Batter',qty:2}];
const sale=(id,branch='Maa')=>({saleId:id,receiptId:id,saleVersion:SALE_VERSION,branch,cashier:'Cashier',netTotal:100,
    cart:[{name:'Meal',qty:1}],recipeSnapshot:recipe,localTimestamp:'2026-10-06T01:00:00Z',shiftId:'shift'});

// Requests and transaction completion remain asynchronous, like IndexedDB.
// Browser outbox tests separately cover tab locking and persistence.
function memoryIndexedDB(){
    const rows=new Map();
    const db={createObjectStore(){},transaction(){
        let pending=0,finished=false;const tx={objectStore:()=>store,abort(){finished=true;queueMicrotask(()=>tx.onabort?.());}};
        function request(action){const req={};pending++;queueMicrotask(()=>{
            if(finished)return;
            try{req.result=structuredClone(action());req.onsuccess?.();}catch(error){req.error=error;req.onerror?.();tx.abort();}
            pending--;queueMicrotask(()=>{if(!pending&&!finished){finished=true;tx.oncomplete?.();}});
        });return req;}
        const store={get:id=>request(()=>rows.get(id)),getAll:()=>request(()=>[...rows.values()]),
            add:row=>request(()=>{rows.set(row.saleId,structuredClone(row));}),put:row=>request(()=>{rows.set(row.saleId,structuredClone(row));}),delete:id=>request(()=>rows.delete(id))};
        return tx;
    }};
    return {open(){const request={result:db};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
}
function checkoutHarness(values={},configureApi){
    const h=firestoreHarness(),reads=[],watchers=[],events=new Map(),intervals=[],timeouts=[],alerts=[];
    let now=0;
    for(const branch of ['Maa','Cabantian'])h.put(`inventory/${branch}-Batter`,{branch,name:'Batter',currentStock:100});
    const queryRead=h.api.getDocsFromServer;
    h.api.getDocsFromServer=async query=>{reads.push(query);return queryRead(query);};
    h.api.onSnapshot=(query,callback)=>{watchers.push({query,callback});return ()=>{};};
    configureApi?.(h.api);
    const storage=new Map([['takodeal_device_branch','Maa'],...Object.entries(values)]);
    const window={addEventListener:(name,callback)=>events.set(name,callback),Swal:{fire:(...args)=>alerts.push(args)}};
    const environment={window,crypto:webcrypto,indexedDB:memoryIndexedDB(),navigator:{onLine:true},Date:{now:()=>now},
        document:{getElementById:()=>null,addEventListener(){}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},
        setTimeout:(fn,ms)=>timeouts.push({fn,ms}),setInterval:(fn,ms)=>intervals.push({fn,ms})};
    installSaleSafety(h.api,environment);
    return {h,window,environment,storage,reads,watchers,events,intervals,timeouts,alerts,set now(value){now=value;}};
}

test('empty fifteen-second upload retries make no audit queries; separate recovery reads only one branch every five minutes',async()=>{
    const app=checkoutHarness();await app.window.getPendingSales();
    const upload=app.intervals.find(timer=>timer.ms===15000),audit=app.intervals.find(timer=>timer.ms===300000);
    for(let n=0;n<20;n++)await upload.fn();assert.equal(app.reads.length,0);
    await audit.fn();await audit.fn();assert.equal(app.reads.length,1);
    assert.deepEqual(app.reads[0].filters,[{key:'branch',value:'Maa'},{key:'inventoryState',value:'deferred'}]);
    app.now=300000;await audit.fn();assert.equal(app.reads.length,2);
    assert.ok(app.reads.every(query=>query.filters.some(filter=>filter.key==='branch'&&filter.value==='Maa')));
});

test('a stalled audit query cannot block a new sale upload, its acknowledgment or shift-close upload waiting',async()=>{
    let release,finished=false;
    const app=checkoutHarness({},api=>{const normal=api.getDocsFromServer;api.getDocsFromServer=query=>
        query.table==='transactions'&&query.filters?.some(f=>f.key==='inventoryState')
            ?new Promise(resolve=>{release=()=>normal(query).then(resolve);}):normal(query);});
    const pendingAudit=app.intervals.find(timer=>timer.ms===300000).fn();pendingAudit.then(()=>finished=true);await flush();
    assert.equal(typeof release,'function');
    await app.window.saleOutbox.enqueue(sale('new-sale'));
    await app.window.syncOfflineQueue();
    assert.equal(app.h.get('transactions/new-sale').receiptId,'new-sale');
    assert.equal((await app.window.getPendingSales()).length,0);assert.equal(app.window.isSyncing,false);
    assert.equal(finished,false);
    release();await pendingAudit;
});

test('manual Resume bypasses throttling and recovers all dated or legacy deferred receipts for that branch once',async()=>{
    const app=checkoutHarness(),engine=createSaleEngine(app.h.api);
    await app.intervals.find(timer=>timer.ms===300000).fn();
    await engine.commit(await engine.prepare({...sale('local'),auditDeferred:true}));
    await engine.commit(await engine.prepare({...sale('other','Cabantian'),auditDeferred:true}));
    app.h.put('transactions/local',{...app.h.get('transactions/local'),timestamp:undefined});
    await app.window.processAuditQueue();await app.window.processAuditQueue();
    assert.equal(app.h.get('inventory/Maa-Batter').currentStock,98);
    assert.equal(app.h.get('transactions/local').inventoryState,'applied');
    assert.equal(app.h.get('inventory/Cabantian-Batter').currentStock,100);
    assert.equal(app.h.get('transactions/other').inventoryState,'deferred');
});

test('audit recovery skips paused/offline work, bounds error retries, and permits forced reconnect or manual recovery',async()=>{
    let now=0,online=true,paused=false,calls=0;
    const recovery=createAuditRecovery({now:()=>now,online:()=>online,paused:()=>paused,recover:async()=>{calls++;if(calls===1)throw Error('offline');return {applied:1};}});
    await assert.rejects(recovery.run('Maa'),/offline/);await recovery.run('Maa');assert.equal(calls,1);
    await recovery.run('Maa',{force:true});assert.equal(calls,2);
    online=false;await recovery.run('Maa',{force:true});online=true;paused=true;now=600000;
    await recovery.run('Maa',{force:true});assert.equal(calls,2);
    await recovery.run('Maa',{force:true,allowPaused:true});assert.equal(calls,3);
    await recovery.run('');assert.equal(calls,3);
});

test('manual recovery queues behind an older automatic flight and upgrades a queued forced retry',async()=>{
    let resolveFirst,calls=0,paused=false;
    const recovery=createAuditRecovery({paused:()=>paused,recover:()=>++calls===1?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve({applied:1})});
    const first=recovery.run('Maa');await flush();const background=recovery.run('Maa',{force:true});
    const manual=recovery.run('Maa',{force:true,allowPaused:true});assert.equal(manual,background);
    paused=true;resolveFirst({paused:true});await first;assert.equal((await manual).applied,1);assert.equal(calls,2);
});

test('server audit resume and online events recover promptly without global scans or touching preserved legacy queues',async()=>{
    const legacy='[{"receiptId":"OLD","branch":"Maa"}]',legacyAudit='{"Batter":4}';
    const app=checkoutHarness({'takodeal_audit_mode':'true','takodeal_offline_queue':legacy,'takodeal_audit_queue':legacyAudit});
    await app.window.getPendingSales();await app.intervals.find(timer=>timer.ms===300000).fn();assert.equal(app.reads.length,0);
    app.watchers[0].callback({exists:()=>true,data:()=>({active:false})});await flush();
    assert.equal(app.reads.length,1);app.events.get('online')();await flush();assert.equal(app.reads.length,2);
    assert.equal(app.storage.get('takodeal_offline_queue'),legacy);assert.equal(app.storage.get('takodeal_audit_queue'),legacyAudit);
});

function feedHarness(){
    const listeners=[],renders=[],errors=[];let stopped=0;
    const api={db:{},collection:(_,table)=>table,where:(key,op,value)=>({key,op,value}),query:(table,...filters)=>({table,filters}),
        onSnapshot:(query,callback,error)=>{listeners.push({query,callback,error});return ()=>stopped++;}};
    const snapshot=rows=>({docs:rows.map(({id,...data})=>({id,data:()=>data}))});
    return {api,listeners,renders,errors,snapshot,stopped:()=>stopped};
}
test('twenty Sales renders share one parked-order query, and parked additions/deletions refresh without a paid sale',async()=>{
    const h=feedHarness(),feed=createParkedOrdersFeed(h.api,rows=>h.renders.push(rows),error=>h.errors.push(error));
    const first=feed.start('Maa');h.listeners[0].callback(h.snapshot([{id:'parked',branch:'Maa'}]));await first;
    for(let n=0;n<20;n++)assert.equal((await feed.start('Maa')).length,1);
    assert.equal(h.listeners.length,1);assert.deepEqual(h.listeners[0].query.filters,[{key:'branch',op:'==',value:'Maa'}]);
    h.listeners[0].callback(h.snapshot([]));assert.equal(feed.rows('Maa').length,0);assert.equal(h.renders.length,2);
});
test('parked-order feed releases listeners and pending renders on navigation, ignores stale branch callbacks, and retries failures',async()=>{
    const h=feedHarness(),feed=createParkedOrdersFeed(h.api,rows=>h.renders.push(rows),error=>h.errors.push(error));
    const old=feed.start('Maa'),next=feed.start('Cabantian');assert.deepEqual(await old,[]);
    h.listeners[0].callback(h.snapshot([{id:'old',branch:'Maa'}]));assert.equal(h.renders.length,0);
    h.listeners[1].callback(h.snapshot([{id:'new',branch:'Cabantian'},{id:'foreign',branch:'Maa'}]));assert.equal((await next).length,1);
    feed.stop();h.listeners[1].callback(h.snapshot([]));assert.equal(h.renders.length,1);assert.equal(feed.rows('Cabantian'),null);
    const failed=feed.start('Maa');h.listeners[2].error(Error('temporarily unavailable'));await assert.rejects(failed,/unavailable/);
    const retry=feed.start('Maa');h.listeners[3].callback(h.snapshot([]));await retry;assert.equal(h.stopped(),3);
});
test('parked merges preserve undated and JSON timestamps, exclude known older/foreign rows and never duplicate paid or pending sales',()=>{
    const start='2026-10-06T01:00:00Z',paid={id:'paid',receiptId:'paid',branch:'Maa',timestamp:new Date(start)};
    const parked=[{id:'paid',branch:'Maa'},{id:'legacy',branch:'Maa',name:'Legacy guest'},
        {id:'json',branch:'Maa',timestamp:{seconds:Math.floor(+new Date(start)/1000)}},
        {id:'invalid',branch:'Maa',timestamp:'invalid'},{id:'old',branch:'Maa',timestamp:'2026-10-05T01:00:00Z'},{id:'foreign',branch:'Cabantian'}];
    const merged=mergeParkedOrders([paid],parked,'Maa',start);
    assert.deepEqual(merged.map(row=>row.id),['paid','legacy','json','invalid']);assert.equal(merged[2].timestamp.toISOString(),start.replace('Z','.000Z'));
    const all=mergePendingSales(merged,[sale('paid'),sale('queued')],'Maa',start,'shift');
    assert.equal(all.filter(row=>row.receiptId==='paid').length,1);assert.equal(all.filter(row=>row.receiptId==='queued').length,1);
});

test('actual Sales dashboard uses shared parked feed data, retains legacy rows and starts no feeds when hidden',async()=>{
    const source=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8'),start=source.indexOf('window.loadSalesDashboard = async function');
    const nodes={tbTransBody:{innerHTML:''},'view-sales':{classList:{contains:()=>visible}}};let visible=true,started=0,stopped=0,parkedCalls=0;
    const window={sessionUser:{branch:'Maa'},currentShift:{active:true,shiftId:'shift',startTime:'2026-10-06T01:00:00Z'},
        startShiftSalesFeed:()=>started++,stopShiftSalesFeed:()=>stopped++,
        getParkedShiftSales:async()=>{parkedCalls++;return [{id:'legacy',branch:'Maa',name:'Undated parked guest'}];},mergeParkedShiftSales:mergeParkedOrders,
        getPendingSales:async()=>[sale('queued')],mergePendingSales,getSalesDashboardData:async()=>{throw Error('A paid snapshot must not be reread');},
        getDocs:async()=>{throw Error('Parked orders must not be queried per render');}};
    vm.runInNewContext(source.slice(start,source.indexOf('function toggleTxMenu',start)),{window,document:{getElementById:id=>nodes[id]},Date,console});
    const paid={...sale('paid'),id:'paid',timestamp:new Date('2026-10-06T01:00:00Z')};
    await window.loadSalesDashboard([paid]);assert.match(nodes.tbTransBody.innerHTML,/Undated parked guest/);assert.match(nodes.tbTransBody.innerHTML,/Awaiting upload/);
    visible=false;await window.loadSalesDashboard([paid]);assert.equal(stopped,1);assert.equal(started,1);assert.equal(parkedCalls,1);
});

test('cached paid rows remain shift-scoped and become unavailable after leaving Sales',()=>{
    const h=feedHarness(),feed=createShiftSalesFeed(h.api,()=>{});feed.start('Maa','2026-10-06','shift');
    h.listeners[0].callback(h.snapshot([{...sale('one'),id:'one'},{...sale('other'),id:'other',shiftId:'other'}]));
    assert.equal(feed.rows('Maa','2026-10-06','shift').length,1);assert.equal(feed.rows('Cabantian','2026-10-06','shift'),null);
    feed.stop();assert.equal(feed.rows('Maa','2026-10-06','shift'),null);
});

test('actual Cashier bridges merge live paid and parked changes with exactly two listeners and no per-render queries',async()=>{
    const h=feedHarness(),html=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8'),main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
    let visible=true;const nodes={tbTransBody:{innerHTML:''},'view-sales':{classList:{contains:()=>visible}}};
    const window={sessionUser:{branch:'Maa'},currentShift:{active:true,shiftId:'shift',startTime:'2026-10-06T01:00:00Z'},
        getPendingSales:async()=>[],mergePendingSales,getSalesDashboardData:async()=>{throw Error('Live parked changes must use cached paid rows');}};
    const context={...h.api,window,createShiftSalesFeed,createParkedOrdersFeed,mergeParkedOrders,document:{getElementById:id=>nodes[id]},Date,console};
    const uiStart=html.indexOf('window.loadSalesDashboard = async function');
    vm.runInNewContext(html.slice(uiStart,html.indexOf('function toggleTxMenu',uiStart)),context);
    const bridgeStart=main.indexOf('const shiftSalesFeed = createShiftSalesFeed');
    vm.runInNewContext(main.slice(bridgeStart,main.indexOf('installMealCheckout();',bridgeStart)),context);
    const opening=window.loadSalesDashboard([]);await flush();assert.equal(h.listeners.length,2);
    const paidListener=h.listeners.find(entry=>entry.query.table==='transactions'),parkedListener=h.listeners.find(entry=>entry.query.table==='parked_orders');
    const paid={...sale('paid'),id:'paid',customerName:'Paid guest',timestamp:new Date('2026-10-06T01:00:00Z')};
    paidListener.callback(h.snapshot([paid]));parkedListener.callback(h.snapshot([{id:'legacy',branch:'Maa',name:'Parked guest'}]));await opening;await flush();
    assert.match(nodes.tbTransBody.innerHTML,/Paid guest/);assert.match(nodes.tbTransBody.innerHTML,/Parked guest/);
    for(let n=0;n<20;n++){paidListener.callback(h.snapshot([{...paid,customerName:'Paid guest '+n}]));await flush();}
    assert.equal(h.listeners.length,2);assert.match(nodes.tbTransBody.innerHTML,/Paid guest 19/);
    parkedListener.callback(h.snapshot([]));await flush();assert.doesNotMatch(nodes.tbTransBody.innerHTML,/Parked guest/);
    visible=false;await window.loadSalesDashboard([]);const before=nodes.tbTransBody.innerHTML;
    paidListener.callback(h.snapshot([]));parkedListener.callback(h.snapshot([{id:'stale',branch:'Maa',name:'Stale'}]));await flush();
    assert.equal(h.stopped(),2);assert.equal(nodes.tbTransBody.innerHTML,before);
});
