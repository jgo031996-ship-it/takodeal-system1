import test from 'node:test';
import assert from 'node:assert/strict';
import {installMobileHubUpgrade} from '../Takodeal-POS/mobile-hub-upgrade.js';
import {captureMobileOperationalContext} from '../Takodeal-POS/mobile-hub-protected-api.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const h=firestoreHarness(),nodes=new Map(),listeners=[],events=new Map(),timers=new Map();let timerId=0,checks=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',style:{},options:[{value:'Delivery'},{value:'Take-Out'}],innerHTML:'',textContent:'',append(){},before(){},setAttribute(){},addEventListener(){},dispatchEvent(){}});return nodes.get(id);};
 for(const id of ['mobileHubListContainer','mobileHubHistoryContainer','mobileHistoryResults','mobileHistoryLoad','mainOrderType'])node(id);
 const storage=new Map([['takodeal_device_id','device-one'],['takodeal_device_branch','Agdao']]);
 const w={sessionUser:{staffId:'crew-one',staffLoginSessionId:'sample-session-0123456789',staffLoginExpiresAt:new Date(Date.now()+3600000).toISOString(),cashierName:'Sample Crew',branch:'Agdao'},auth:{currentUser:{uid:'primary-different'}},localStorage:{getItem:key=>storage.get(key)},cart:[],Audio:class{addEventListener(){}pause(){}play(){return Promise.resolve();}},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval(){},addEventListener:(name,fn)=>events.set(name,fn),Swal:{fire:async()=>({isConfirmed:false})}};
 const api={...h.api,db:{name:'approved-device-db'},auth:{currentUser:{uid:'approved-device-uid'}},requireStaffLogin:true,sessionUser:w.sessionUser,localStorage:w.localStorage,assertStaffOperationalCurrent(){if(w.sessionUser!==api.sessionUser)throw Error('staff changed');},readStaffSessionProfile:async({assertCurrent})=>{checks++;if(f.checkWait)await f.checkWait;assertCurrent();},limit:value=>({limit:value}),orderBy:(key,dir)=>({orderBy:key,dir}),onSnapshot:(q,options,next,error)=>{const sub={q,options,next,error,stopped:false};listeners.push(sub);return ()=>sub.stopped=true;},getDocFromServer:async ref=>({exists:()=>h.docs.has(ref.path),data:()=>h.get(ref.path)}),getDocsFromServer:async q=>{f.queries.push(q);if(f.queryWait)await f.queryWait;return {docs:[]};}};
 w.resolveCashierOperationalApi=async()=>api;
 h.put('cashier_leases/Agdao',{uid:'approved-device-uid',seenAt:new Date()});
 const f={w,api,h,node,nodes,listeners,events,timers,queries:[],checks:()=>checks,storage};
 installMobileHubUpgrade(w,{getElementById:id=>nodes.get(id)||null,createElement:()=>({}),head:{append(){}}});return f;
}
const snap=(data,metadata={})=>({metadata,docs:data.map(([id,row])=>({id,data:()=>row}))});
test('live branch orders and history use the approved device SDK with no primary fallback',async()=>{
 const f=fixture();await f.w.startMobileOrdersListener('Agdao');assert.ok(f.listeners.length);const sub=f.listeners.at(-1);assert.equal(sub.q.table,'incoming_orders');assert.deepEqual(sub.q.filters[0],{key:'branch',value:'Agdao'});
 sub.next(snap([['real-id',{id:'forged',branch:'Agdao',status:'preparing',items:[null],customerName:'<script>unsafe</script>'}],['foreign',{branch:'Maa',status:'ready'}]]));assert.equal(f.w.mobileOrdersList.length,1);assert.equal(f.w.mobileOrdersList[0].id,'real-id');assert.match(f.node('mobileHubListContainer').innerHTML,/&lt;script&gt;/);
 await f.w.loadMobileHistory();const q=f.queries.at(-1);assert.equal(q.table,'incoming_orders');assert.equal(q.filters[0].value,'Agdao');assert.deepEqual(q.filters.at(-1),{limit:501});assert.ok(f.checks()>=2);
 delete f.w.resolveCashierOperationalApi;assert.equal(await f.w.startMobileOrdersListener('Agdao'),false);assert.match(f.node('mobileHubListContainer').textContent,/Secure Cashier approval/);
});
test('cache-only rows never enable alerts and pagehide unsubscribes and clears private rows',async()=>{
 const f=fixture();await f.w.startMobileOrdersListener('Agdao');const sub=f.listeners.at(-1);sub.next(snap([['order',{branch:'Agdao',status:'mobile_queue',items:[]}]],{fromCache:true}));assert.deepEqual(f.w.mobileOrdersList,[]);assert.match(f.node('mobileHubListContainer').textContent,/confirmed/);f.events.get('pagehide')();assert.equal(sub.stopped,true);sub.next(snap([['late',{branch:'Agdao',status:'ready',items:[]}]]));assert.deepEqual(f.w.mobileOrdersList,[]);
});
test('account and branch changes while approved profile is held cannot create listeners or expose history',async()=>{
 const f=fixture(),held=deferred();f.checkWait=held.promise;const p=f.w.startMobileOrdersListener('Agdao');await Promise.resolve();f.w.sessionUser={...f.w.sessionUser,staffId:'other'};held.resolve();assert.equal(await p,false);assert.equal(f.listeners.length,0);
 const g=fixture(),query=deferred();g.queryWait=query.promise;const history=g.w.loadMobileHistory();await new Promise(setImmediate);g.storage.set('takodeal_device_branch','Maa');query.resolve();await history;assert.equal(g.node('mobileHistoryResults').innerHTML,'');
});
test('protected context rejects a local-only login and expired, replaced or revoked selected staff',async()=>{
 const f=fixture();await captureMobileOperationalContext(f.w).resolve();f.api.requireStaffLogin=false;await assert.rejects(captureMobileOperationalContext(f.w).resolve(),/protected staff/);f.api.requireStaffLogin=true;f.api.readStaffSessionProfile=async()=>{throw Error('revoked');};await assert.rejects(captureMobileOperationalContext(f.w).resolve(),/revoked/);f.w.sessionUser.staffLoginExpiresAt='2020-01-01';await assert.rejects(captureMobileOperationalContext(f.w).resolve(),/expired/);
});
test('status actions preserve cart on cancellation and cannot write after a selection change',async()=>{
 const f=fixture();f.h.put('incoming_orders/order',{branch:'Agdao',status:'preparing',items:[]});f.w.cart=[{name:'Unsaved',qty:1}];await f.w.markMobileOrderReady('order');assert.equal(f.h.get('incoming_orders/order').status,'preparing');assert.equal(f.w.cart[0].name,'Unsaved');
 const gate=deferred();f.w.Swal.fire=async options=>options.showCancelButton?gate.promise:{};const p=f.w.markMobileOrderReady('order');await new Promise(setImmediate);f.w.sessionUser={...f.w.sessionUser,staffId:'other'};gate.resolve({isConfirmed:true});await p;assert.equal(f.h.get('incoming_orders/order').status,'preparing');
});
test('loading an accepted order rechecks fresh payment state and never overwrites a cart edited during protected reads',async()=>{
 for(const scenario of ['paid','cart']){const f=fixture();await f.w.startMobileOrdersListener('Agdao');f.h.put('incoming_orders/order',{branch:'Agdao',status:'preparing',orderType:'Delivery',items:[{name:'Sample',quantity:1,price:100}]});f.w.cart=[{name:'Unsaved',qty:1}];f.w.Swal.fire=async options=>({isConfirmed:true});let reads=0;const original=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{if(++reads===2){if(scenario==='paid')f.h.put(ref.path,{...f.h.get(ref.path),paymentStatus:'paid',receiptId:'SAVED'});else f.w.cart.push({name:'New edit',qty:1});}return original(ref);};await f.w.loadAcceptedMobileOrder('order');assert.equal(f.w.cart[0].name,'Unsaved');assert.equal(f.w.cart.length,scenario==='cart'?2:1);assert.equal(f.w.activeMobileOrderId,undefined);}
});
