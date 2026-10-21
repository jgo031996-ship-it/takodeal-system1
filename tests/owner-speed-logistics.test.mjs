import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLogisticsFeed} from '../takodeal-manager/logistics-feed.js';
function fixture(){
 let account='sample-owner',visible=false;const calls=[],events=[],state={orders:[],deliveries:[]};let sorts=0,renders=0,resets=0;
 const subscribe=kind=>(next,error)=>{const row={kind,next,error,stopped:false};calls.push(row);return ()=>row.stopped=true;};
 const feed=createLogisticsFeed({scope:()=>account,isActive:()=>visible,orders:subscribe('orders'),deliveries:subscribe('deliveries'),onOrders:(snapshot,initial)=>{state.orders=snapshot;events.push({initial});},onDeliveries:snapshot=>{sorts++;state.deliveries=[...snapshot].sort();renders++;},onReset:()=>{resets++;state.orders=[];state.deliveries=[];}});
 return {feed,calls,events,state,get sorts(){return sorts;},get renders(){return renders;},get resets(){return resets;},show:value=>visible=value,account:value=>account=value};
}
test('hidden Dispatch keeps exactly one live badge subscription and never reads, sorts or renders delivery payloads',()=>{
 const f=fixture();f.feed.start();f.feed.start();f.feed.syncVisibility();assert.deepEqual(f.calls.map(row=>row.kind),['orders']);f.calls[0].next(['pending request']);assert.deepEqual(f.state.orders,['pending request']);assert.equal(f.sorts,0);assert.equal(f.renders,0);
 f.show(true);f.feed.syncVisibility();assert.deepEqual(f.calls.map(row=>row.kind),['orders','deliveries']);const delivery=f.calls[1];delivery.next(['b','a']);assert.deepEqual(f.state.deliveries,['a','b']);assert.equal(f.sorts,1);assert.equal(f.renders,1);
 f.show(false);f.feed.syncVisibility();assert.equal(delivery.stopped,true);assert.equal(f.calls[0].stopped,false);const poisoned={ [Symbol.iterator](){throw Error('Hidden delivery payload must not be touched.');}};delivery.next(poisoned);assert.equal(f.sorts,1);assert.equal(f.renders,1);f.calls[0].next(['new pending request']);assert.equal(f.events.length,2);assert.equal(f.events[1].initial,false);assert.equal(f.calls.length,2);
});
test('reentering Dispatch reads fresh untruncated delivery history while the badge never reconnects',()=>{
 const f=fixture();f.feed.start();f.show(true);f.feed.start();f.feed.start();const old=f.calls[1];f.show(false);f.feed.syncVisibility();f.show(true);f.feed.syncVisibility();f.feed.syncVisibility();assert.deepEqual(f.calls.map(row=>row.kind),['orders','deliveries','deliveries']);assert.equal(old.stopped,true);assert.equal(f.calls[0].stopped,false);const full=Array.from({length:6000},(_,i)=>String(i));f.calls[2].next(full);assert.equal(f.state.deliveries.length,6000);old.next(['stale']);assert.equal(f.state.deliveries.length,6000);f.feed.stop();assert.ok(f.calls.every(row=>row.stopped));
});
test('account changes and sign-out clear cached logistics state and late callbacks cannot revive it',()=>{
 const f=fixture();f.show(true);f.feed.start();const order=f.calls[0],delivery=f.calls[1];order.next(['old order']);delivery.next(['old delivery']);f.account('another-owner');f.feed.start();assert.ok(f.calls.slice(0,2).every(row=>row.stopped));assert.deepEqual(f.state,{orders:[],deliveries:[]});order.next(['stale']);delivery.next(['stale']);assert.deepEqual(f.state,{orders:[],deliveries:[]});f.calls[2].next(['current']);f.account('');f.calls[2].next(['signed out']);assert.deepEqual(f.state,{orders:[],deliveries:[]});assert.ok(f.calls.every(row=>row.stopped));assert.equal(f.feed.start(),false);assert.equal(f.resets,2);
});
test('a delivery callback arriving just after leaving Dispatch detaches itself before inspecting history',()=>{
 const f=fixture();f.show(true);f.feed.start();const old=f.calls[1];f.show(false);old.next({[Symbol.iterator](){throw Error('Do not sort hidden payload');}});assert.equal(old.stopped,true);assert.equal(f.sorts,0);assert.equal(f.renders,0);assert.equal(f.calls[0].stopped,false);
});
test('actual POS Config and Equipment sidebar handlers invoke each owned loader once',()=>{
 const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),html=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8'),start=source.indexOf('window.switchView = function (viewId)'),end=source.indexOf('\n};',start)+3,calls={};
 const context={document:{querySelectorAll:()=>[],getElementById:()=>null},historyLive:{stop(){}},sessionUser:{isFranchisee:false}};context.window=context;
 for(const name of ['loadPosConfigHub','loadPosLayout','loadSidebarLayout','loadEquipmentDashboard'])context[name]=()=>calls[name]=(calls[name]||0)+1;
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 for(const id of ['nav-posconfig','nav-equipment']){const handler=html.match(new RegExp('id="'+id+'"[^>]*onclick="([^"]+)"'))?.[1];assert.ok(handler);vm.runInContext(handler,context);}
 assert.deepEqual(calls,{loadPosConfigHub:1,loadPosLayout:1,loadSidebarLayout:1,loadEquipmentDashboard:1});
});
