import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installScheduleViewSync} from '../takodeal-staff/schedule-view-sync.js';
import {scheduleDateKey, monthKey} from '../takodeal-staff/schedule-history.js';
import {projectScheduleMonth} from '../takodeal-staff/schedule-sync.js';

const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function lifecycle() {
 const win=new EventTarget(),doc=new EventTarget();doc.hidden=false;doc.visibilityState='visible';doc.body={};
 let selected={identity:'staff-id',branch:'Maa',month:'2026-10'},dirty=false,refreshes=0,notices=0,held=null;
 const listeners=[],applied=[],errors=[];
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,onSnapshot(ref,_options,next,error){const entry={ref,next,error,stopped:false};listeners.push(entry);return ()=>entry.stopped=true;}};
 let controller,load;
 controller=installScheduleViewSync(api,{window:win,document:doc,scope:()=>selected,
  refresh:()=>load(),dirty:()=>dirty,pending:()=>notices++,error:e=>errors.push(e)});
 load=controller.wrap(async()=>{refreshes++;const token=controller.token(),value=selected.identity+'/'+selected.branch+'/'+selected.month;await held?.promise;if(controller.current(token))applied.push(value);});
 return {win,doc,controller,listeners,applied,errors,get calls(){return refreshes;},get notices(){return notices;},load,
  select(value){selected=value;controller.sync();},set dirty(value){dirty=value;},hold(){return held=deferred();},
  snapshot(index,value,metadata={}){listeners[index].next({exists:()=>true,data:()=>value,metadata});},
  hide(){doc.hidden=true;doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));},
  show(){doc.hidden=false;doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));}};
}
test('schedule watches exist only while visible and selected; foreground reconnect fetches fresh once',async()=>{
 const h=lifecycle();await tick();assert.equal(h.calls,1);assert.equal(h.listeners.length,2);
 h.hide();assert.ok(h.listeners.every(row=>row.stopped));h.win.dispatchEvent(new Event('online'));await tick();assert.equal(h.calls,1);
 h.show();h.win.dispatchEvent(new Event('focus'));h.win.dispatchEvent(new Event('online'));await tick();assert.equal(h.calls,2);assert.equal(h.listeners.length,4);
 h.select(null);assert.ok(h.listeners.every(row=>row.stopped));h.controller.dispose();
});
test('saved month changes during a held read coalesce; only the current identity branch and month may apply',async()=>{
 const h=lifecycle(),old=h.hold();await tick();assert.equal(h.calls,1);h.snapshot(0,{revision:'old'});h.snapshot(1,{latestRevisionId:'old'});
 h.snapshot(1,{latestRevisionId:'new'});h.snapshot(1,{latestRevisionId:'newer'});assert.equal(h.calls,1);
 h.select({identity:'another',branch:'Agdao',month:'2026-11'});await tick();assert.equal(h.calls,2);
 old.resolve();await tick();await tick();assert.deepEqual(h.applied,['another/Agdao/2026-11']);assert.equal(h.calls,2);
 h.controller.dispose();
});
test('one new server revision while a read runs causes one fresh follow-up; cached echoes do not reload',async()=>{
 const h=lifecycle(),held=h.hold();await tick();h.snapshot(0,{revision:'v1'});h.snapshot(1,{latestRevisionId:'v1'});
 h.snapshot(1,{latestRevisionId:'cached'}, {fromCache:true});assert.equal(h.calls,1);
 h.snapshot(1,{latestRevisionId:'v2'});h.snapshot(1,{latestRevisionId:'v2'});held.resolve();await tick();await tick();assert.equal(h.calls,2);
 assert.deepEqual(h.applied,['staff-id/Maa/2026-10','staff-id/Maa/2026-10']);h.controller.dispose();
});
test('first server snapshot newer than an already-started read cannot leave the older month displayed',async()=>{
 const h=lifecycle(),held=h.hold();await tick();assert.equal(h.calls,1);
 // There is no earlier onSnapshot baseline: the save happened while v1 was loading.
 h.snapshot(0,{revision:'v2'});h.snapshot(1,{latestRevisionId:'v2'});held.resolve();await tick();await tick();
 assert.equal(h.calls,2,'both initial confirmations coalesce into one fresh follow-up');
 h.snapshot(0,{revision:'v2'});h.snapshot(1,{latestRevisionId:'v2'});await tick();assert.equal(h.calls,2);
 h.controller.dispose();
});
test('Franchise unsaved or saving changes survive server updates and foreground refreshes',async()=>{
 const h=lifecycle();await tick();h.snapshot(0,{revision:'v1'});h.snapshot(1,{latestRevisionId:'v1'});h.dirty=true;
 h.snapshot(1,{latestRevisionId:'v2'});h.hide();h.show();await tick();assert.equal(h.calls,1);assert.ok(h.notices>=1);
 h.dirty=false;h.controller.refresh();await tick();assert.equal(h.calls,2);h.controller.dispose();
});
test('listener errors do not automatically retry or expose a detached previous account',async()=>{
 const h=lifecycle();await tick();h.listeners[0].error(Error('offline'));await tick();assert.equal(h.calls,1);assert.equal(h.errors.length,1);
 h.select(null);h.listeners[0].error(Error('late failure'));assert.equal(h.errors.length,1);h.controller.dispose();
});

const source={staff:readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),cashier:readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8')};
function actual(name,loadMonth) {
 const nodes=new Map(),values=new Map([['takodeal_staff_id','staff-id'],['takodeal_staff_name','Sample Staff'],['cashierName','Cashier A'],['takodeal_device_branch','Maa']]);
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',style:{}});return nodes.get(id);};node('staffMonthPicker').value='2026-10';
 const reads=[],window={getDocFromServer:async ref=>{reads.push(ref);return {exists:()=>true,data:()=>({cashierName:'Sample Staff',scheduleNickname:'Sample',branch:'Maa'})};},doc:(_db,table,id)=>table+'/'+id,db:{}};
 class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-10-16T19:00:00+08:00']));}static now(){return +new Date('2026-10-16T19:00:00+08:00');}}
 const context={window,localStorage:{getItem:key=>values.get(key)||null},document:{getElementById:node},loadScheduleMonthView:loadMonth,
  scheduleDateKey,monthKey,structuredClone,Date:FixedDate,console:{error(){}},setTimeout(){}};
 const fn=name==='staff'?'loadStaffSchedule':'loadBranchSchedule',text=source[name],start=text.indexOf(`window.${fn} = async function()`);
 assert.ok(start>0);vm.runInNewContext(text.slice(start,text.indexOf('\n};',start)+3),context);
 return {window,nodes,values,reads,node,load:()=>window[fn]()};
}
function view(branch='Maa') {
 const current={currentYear:2026,currentMonth:10,branchConfig:{[branch]:[{id:'night',name:'Night',startTime:'19:30',endTime:'04:00',active:true}]},
  currentSchedule:{16:{[branch]:{scheduled:{night:'Sample'},rest:[],unavailable:[],swaps:{}}}},holidays:{}};
 return projectScheduleMonth({month:'2026-10',current,now:new Date('2026-10-16T19:00:00+08:00'),branch});
}
test('actual Staff viewer reads staff by server ID and marks the Philippine date as TODAY',async()=>{
 const h=actual('staff',async()=>view());await h.load();assert.deepEqual(h.reads,['cashiers/staff-id']);
 assert.match(h.node('scheduleContainer').innerHTML,/TODAY/);assert.match(h.node('scheduleContainer').innerHTML,/7:30 PM to 4:00 AM/);
 assert.equal(h.window.cachedSchedData.currentMonth,10);
});
test('actual Staff held month read cannot populate a different account or selected month',async()=>{
 for(const change of ['account','month']) {const held=deferred(),h=actual('staff',()=>held.promise),pending=h.load();await tick();
  if(change==='account')h.values.set('takodeal_staff_id','other');else h.node('staffMonthPicker').value='2026-11';
  held.resolve(view());await pending;assert.doesNotMatch(h.node('scheduleContainer').innerHTML,/7:30 PM/);assert.equal(h.window.cachedSchedData,null);
 }
});
test('actual Cashier uses a dated month projection and rejects held reads after branch/account changes',async()=>{
 const h=actual('cashier',async(_api,scope)=>{assert.equal(scope.branch,'Maa');assert.equal(scope.month,'2026-10');return view();});await h.load();
 assert.match(h.node('cashierScheduleContainer').innerHTML,/TODAY/);assert.match(h.node('cashierScheduleContainer').innerHTML,/19:30 - 04:00/);
 for(const change of ['takodeal_device_branch','cashierName']) {const held=deferred(),app=actual('cashier',()=>held.promise),pending=app.load();app.values.set(change,'Other');held.resolve(view());await pending;assert.doesNotMatch(app.node('cashierScheduleContainer').innerHTML,/19:30 - 04:00/);}
});
