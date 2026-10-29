import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createOwnerScheduleSync,installOwnerScheduleSync} from '../takodeal-manager/owner-schedule-sync.js';
import {installScheduleMemoryUI} from '../takodeal-manager/schedule-memory-ui.js';
import {validateShiftConfig} from '../takodeal-manager/payroll-safety.js';

const copy=structuredClone, tick=()=>new Promise(resolve=>setImmediate(resolve));
const held=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function memoryDrafts(){const rows=new Map();return {write:async record=>{rows.set(record.key,copy(record));return copy(record);},list:async(scope,month)=>[...rows.values()].filter(row=>row.ownerUid===scope.ownerUid&&row.scopeHash===scope.scopeHash&&row.month===month).map(copy),remove:async key=>{rows.delete(key);}};}
function schedule(name='Ana',month='2026-10'){
 const [currentYear,currentMonth]=month.split('-').map(Number);
 return {currentYear,currentMonth,branchConfig:{Maa:[{id:'n1',name:'Night (7:30pm-4am)',startTime:'18:30',endTime:'03:00',active:true,days:[0,1,2,3,4,5,6]}],Closed:[{id:'m1',name:'Morning',startTime:'09:00',endTime:'17:30',active:true,days:[1,2,3]}]},employees:[{name:'Ana',branch:'Maa'}],currentSchedule:{16:{Maa:{scheduled:{n1:name},rest:['Former Full Name'],unavailable:[{name:'Unknown Staff',status:'Leave'}],swaps:{n1:'Old Full Name'}},Closed:{scheduled:{m1:'Closed Branch Name'}}}},unavailability:{},holidays:{}};
}
function server(){
 let value=schedule(),revision='v1';const subscribers=new Set();
 return {get snapshot(){return copy(value);},get revision(){return revision;},set snapshot(next){value=copy(next);},
  async view(month){return {month,editorSnapshot:copy(value),expectedRevisionId:revision,hasSavedSchedule:true,source:'saved-month',archive:{month,revisions:[]}};},
  subscribe(month,change){const row={month,change};subscribers.add(row);return ()=>subscribers.delete(row);},
  emit(event={kind:'month',revisionId:revision}){for(const row of subscribers)row.change(event);},
  remote(next,id='v2'){value=copy(next);revision=id;this.emit();},
  async save(next,options){assert.equal(options.expectedRevisionId,revision,'save uses applied view revision');value=copy(next);revision=options.revisionId;const result={latestRevisionId:revision,revision:{revisionId:revision,month:'2026-10',snapshot:copy(value)}};this.emit();return result;}
 };
}
function device(db,extra={}){
 let snapshot=schedule(),month='2026-10',actor='owner-1',expected,active=true,protect=false,confirmed=false,reads=0,saves=0;const messages=[];
 const api={draftStore:memoryDrafts(),readView:async selected=>{reads++;return db.view(selected);},applyView:view=>snapshot=copy(view.editorSnapshot),getSnapshot:()=>snapshot,getMonth:()=>month,getIdentity:()=>actor,getExpectedRevision:()=>expected,setExpectedRevision:value=>expected=value,getEffectiveFrom:()=>month+'-16',saveSnapshot:async(next,options)=>{saves++;return db.save(next,options);},isActive:()=>active,isProtected:()=>protect,confirmDiscard:async()=>confirmed,subscribe:(selected,change)=>db.subscribe(selected,change),onStatus:(message,error)=>messages.push({message,error}),makeId:()=>String(saves+1),...extra};
 const controller=createOwnerScheduleSync(api);
 return {controller,messages,api,get snapshot(){return snapshot;},set snapshot(value){snapshot=value;},get expected(){return expected;},get reads(){return reads;},get saves(){return saves;},set month(value){month=value;},set actor(value){actor=value;},set active(value){active=value;},set protected(value){protect=value;},set confirmed(value){confirmed=value;}};
}

test('applied saved snapshot and its expected revision move together; directory enrichment starts clean',async()=>{
 const db=server();let current=schedule(),expected;const controller=createOwnerScheduleSync({readView:()=>db.view('2026-10'),applyView:view=>{current=copy(view.editorSnapshot);current.employees=[{name:'Current alias',fullName:'Ana Full Name',staffId:'saved-id',branch:'Maa'}];},getSnapshot:()=>current,getMonth:()=> '2026-10',getIdentity:()=> 'owner',getExpectedRevision:()=>expected,setExpectedRevision:value=>expected=value,getEffectiveFrom:()=> '2026-10-16',saveSnapshot:db.save.bind(db)});
 await controller.load();assert.equal(expected,'v1');assert.equal(controller.isDirty(),false);assert.equal(current.branchConfig.Maa[0].startTime,'18:30');assert.equal(current.branchConfig.Maa[0].name,'Night (7:30pm-4am)');assert.ok(current.branchConfig.Closed);controller.stop();
});
test('two devices refresh a clean editor after an acknowledged save and keep an unsaved phone draft',async()=>{
 const db=server(),a=device(db),b=device(db);await a.controller.load();await b.controller.load();
 a.snapshot.currentSchedule[16].Maa.scheduled.n1='New Full Name';assert.equal(await a.controller.save(),true);await tick();await tick();
 assert.equal(b.snapshot.currentSchedule[16].Maa.scheduled.n1,'New Full Name');assert.equal(b.expected,db.revision);
 b.snapshot.currentSchedule[16].Maa.scheduled.n1='Unsaved phone edit';db.remote(schedule('Remote Name'),'v3');await tick();
 assert.equal(b.snapshot.currentSchedule[16].Maa.scheduled.n1,'Unsaved phone edit');assert.match(b.messages.at(-1).message,/Finish your current edits/);
 assert.equal(await b.controller.load({manual:true}),false);assert.equal(b.snapshot.currentSchedule[16].Maa.scheduled.n1,'Unsaved phone edit');b.confirmed=true;await b.controller.load({manual:true});assert.equal(b.snapshot.currentSchedule[16].Maa.scheduled.n1,'Remote Name');a.controller.stop();b.controller.stop();
});
test('a newer event during a held resume read triggers one fresh follow-up instead of applying stale data forever',async()=>{
 const db=server(),gate=held();let block=false;const phone=device(db,{readView:async()=>{const old=await db.view('2026-10');return block?gate.promise.then(()=>old):old;}});await phone.controller.load();
 block=true;const resumed=phone.controller.load({reason:'resume'});await tick();db.remote(schedule('Latest server assignment'),'v2');db.emit();db.emit();block=false;gate.resolve();await resumed;await tick();await tick();
 assert.equal(phone.expected,'v2');assert.equal(phone.snapshot.currentSchedule[16].Maa.scheduled.n1,'Latest server assignment');phone.controller.stop();
});
test('first authoritative global event refreshes a newer head; unchanged repeated events do not fan out',async()=>{
 const db=server(),phone=device(db);await phone.controller.load();db.snapshot=schedule('Legacy head edit');db.emit({kind:'head',stamp:'new-server-head'});await tick();await tick();assert.equal(phone.snapshot.currentSchedule[16].Maa.scheduled.n1,'Legacy head edit');const reads=phone.reads;
 for(let n=0;n<5;n++)db.emit({kind:'head',stamp:'new-server-head'});await tick();assert.equal(phone.reads,reads);phone.controller.stop();
});
test('resume protects history, swap dialogs, hidden routes and newer account/month contexts',async()=>{
 const db=server(),phone=device(db);await phone.controller.load();phone.controller.setHistory(true);db.remote(schedule('Remote'),'v2');await tick();assert.equal(phone.snapshot.currentSchedule[16].Maa.scheduled.n1,'Ana');phone.controller.setHistory(false);phone.protected=true;assert.equal(await phone.controller.load({reason:'resume'}),false);assert.equal(await phone.controller.load({manual:true}),false);
 phone.protected=false;phone.active=false;assert.equal(await phone.controller.load({reason:'resume'}),false);phone.active=true;phone.actor='owner-2';assert.equal(await phone.controller.save(),false);await phone.controller.load();phone.month='2026-11';assert.equal(await phone.controller.save(),false);phone.controller.stop();
});
test('an old pending read cannot replace a changed account or selected month',async()=>{
 const db=server(),gate=held(),phone=device(db,{readView:()=>gate.promise});const pending=phone.controller.load();phone.actor='owner-2';gate.resolve(await db.view('2026-10'));assert.equal(await pending,false);assert.equal(phone.expected,undefined);
 const gate2=held(),other=device(db,{readView:()=>gate2.promise});const p2=other.controller.load();other.month='2026-11';gate2.resolve(await db.view('2026-10'));assert.equal(await p2,false);assert.equal(other.expected,undefined);
});
test('a timed-out physical read stays deduped until it actually settles',async()=>{
 const db=server(),gate=held();let reads=0;const phone=device(db,{timeoutMs:5,readView:()=>{reads++;return gate.promise;}});assert.equal(await phone.controller.load(),false);assert.equal(await phone.controller.load(),false);assert.equal(reads,1);assert.match(phone.messages.at(-1).message,/previous schedule read is still pending/);gate.resolve(await db.view('2026-10'));await tick();await phone.controller.load();assert.equal(reads,2);phone.controller.stop();
});
test('pending saves dedupe and retain a newer draft; lost acknowledgement retries the same revision ID',async()=>{
 const db=server(),gate=held(),attempts=[];let fail=true;const phone=device(db,{saveSnapshot:async(value,options)=>{attempts.push({value:copy(value),options:copy(options)});if(attempts.length===1)await gate.promise;if(fail)throw Error('lost acknowledgement');return db.save(value,options);}});await phone.controller.load();phone.snapshot.currentSchedule[16].Maa.scheduled.n1='First';const one=phone.controller.save(),same=phone.controller.save();assert.equal(one,same);gate.resolve();assert.equal(await one,false);fail=false;assert.equal(await phone.controller.save(),true);assert.equal(attempts[0].options.revisionId,attempts[1].options.revisionId);phone.controller.stop();
});
test('a newer edit queued behind an active save is saved afterward with the acknowledged revision',async()=>{
 const db=server(),gate=held(),saved=[];let first=true;const phone=device(db,{saveSnapshot:async(value,options)=>{if(first){first=false;await gate.promise;}saved.push(copy(value));return db.save(value,options);},makeId:()=>String(saved.length+1)});await phone.controller.load();phone.snapshot.currentSchedule[16].Maa.scheduled.n1='First';const p1=phone.controller.save();phone.snapshot.currentSchedule[16].Maa.scheduled.n1='Second';const p2=phone.controller.save();gate.resolve();await p1;assert.equal(await p2,true);assert.deepEqual(saved.map(value=>value.currentSchedule[16].Maa.scheduled.n1),['First','Second']);assert.equal(phone.controller.isDirty(),false);phone.controller.stop();
});
test('a remote commit arriving during own save completion is refreshed after the save settles',async()=>{
 const db=server(),gate=held(),entered=held();const phone=device(db,{onSaved:()=>{entered.resolve();return gate.promise;}});await phone.controller.load();phone.snapshot.currentSchedule[16].Maa.scheduled.n1='Own saved change';const saving=phone.controller.save();await entered.promise;db.remote(schedule('Other device saved later'),'v2');gate.resolve();assert.equal(await saving,true);await tick();await tick();assert.equal(phone.expected,'v2');assert.equal(phone.snapshot.currentSchedule[16].Maa.scheduled.n1,'Other device saved later');phone.controller.stop();
});
test('a save acknowledgement for another selected month cannot advance that month edit marker',async()=>{
 const db=server(),gate=held(),entered=held();const phone=device(db,{saveSnapshot:async(value,options)=>{entered.resolve();await gate.promise;return db.save(value,options);}});await phone.controller.load();phone.snapshot.currentSchedule[16].Maa.scheduled.n1='Own change';const saving=phone.controller.save();await entered.promise;phone.month='2026-11';gate.resolve();assert.equal(await saving,true);assert.equal(phone.expected,'v1');assert.equal(await phone.controller.save(),false);phone.controller.stop();
});

const {scheduleShiftHours}=await import('../takodeal-manager/schedule-layout.js');
const source=await readFile(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
test('actual Save Edits captures edited shift controls before validation and saving; unrelated branches and assignments survive',async()=>{
 const branchConfig=copy(schedule().branchConfig),currentSchedule=copy(schedule().currentSchedule),alerts=[],saved=[];
 const nodes={chk_Maa_0:{checked:true},inp_Maa_0:{value:'Night cashier revised',closest:()=>({querySelectorAll:()=>[{checked:true,value:'1'},{checked:false,value:'2'}]})},start_Maa_0:{value:'19:30'},end_Maa_0:{value:'04:00'},kind_Maa_0:{value:'night'}};
 const window={globalActiveBranches:['Maa'],isBranchAllowed:branch=>branch==='Maa',getScheduleMemorySnapshot:()=>({branchConfig,currentSchedule}),saveToCloud:async()=>{saved.push(copy({branchConfig,currentSchedule}));return true;}};
 const Swal={fire:async options=>alerts.push(options),showLoading(){}};const context=vm.createContext({window,branchConfig,document:{getElementById:id=>nodes[id]},Swal,validateShiftConfig});
 vm.runInContext(block('window.captureTempShiftConfig = function() {','// 🔥 NEW: Instantly adds'),context);vm.runInContext(block('window.saveManualSchedule = async function() {','\nwindow.addEmployee ='),context);
 assert.equal(await window.saveManualSchedule(),true);assert.equal(saved[0].branchConfig.Maa[0].startTime,'19:30');assert.equal(saved[0].branchConfig.Maa[0].endTime,'04:00');assert.equal(saved[0].branchConfig.Maa[0].name,'Night cashier revised');assert.deepEqual([...saved[0].branchConfig.Maa[0].days],[1]);assert.deepEqual(saved[0].branchConfig.Closed,schedule().branchConfig.Closed);assert.deepEqual(saved[0].currentSchedule,schedule().currentSchedule);assert.equal(alerts.at(-1).icon,'success');
});
test('actual Save Edits rejects invalid controls and never announces success after a failed save',async()=>{
 const branchConfig=copy(schedule().branchConfig),alerts=[];let writes=0;
 const nodes={start_Maa_0:{value:'18:30'},end_Maa_0:{value:'18:30'},ownerScheduleSyncStatus:{textContent:'Schedule not saved: offline'}};
 const window={globalActiveBranches:['Maa'],isBranchAllowed:branch=>branch==='Maa',getScheduleMemorySnapshot:()=>({branchConfig}),saveToCloud:async()=>{writes++;return false;}};
 const context=vm.createContext({window,branchConfig,document:{getElementById:id=>nodes[id]},Swal:{fire:async value=>alerts.push(value),showLoading(){}},validateShiftConfig});vm.runInContext(block('window.captureTempShiftConfig = function() {','// 🔥 NEW: Instantly adds'),context);vm.runInContext(block('window.saveManualSchedule = async function() {','\nwindow.addEmployee ='),context);
 assert.equal(await window.saveManualSchedule(),false);assert.equal(writes,0);assert.equal(alerts.at(-1).icon,'warning');assert.match(alerts.at(-1).title,/not confirmed|Reconnect/);nodes.end_Maa_0.value='03:00';assert.equal(await window.saveManualSchedule(),false);assert.equal(writes,1);assert.equal(alerts.some(row=>row.icon==='success'),false);assert.match(alerts.at(-1).text,/offline/);
});
test('actual calendar render is read-only for full names, unknown profiles, historical branches and swaps',()=>{
 const branchConfig=copy(schedule().branchConfig),currentSchedule=copy(schedule().currentSchedule),before=copy(currentSchedule);
 function element(){return {children:[],innerHTML:'',appendChild(child){this.children.push(child);}};}const container=element();
 const context=vm.createContext({scheduleShiftHours,window:{globalActiveBranches:['Maa'],isBranchAllowed:()=>true,employees:[]},branchConfig,currentSchedule,currentYear:2026,currentMonth:10,currentActiveTab:'Maa',document:{getElementById:()=>container,createElement:element},enhanceScheduleLayout(){}});vm.runInContext(block('window.renderTables = function() {','// 🖱️ MANAGE STANDBY STAFF ENGINE'),context);context.window.renderTables();assert.deepEqual(currentSchedule,before);const html=container.children[1].children.map(row=>row.innerHTML).join('');assert.match(html,/Former Full Name/);assert.match(html,/Unknown Staff/);assert.match(html,/Old Full Name/);assert.match(html,/Closed Branch Name/);assert.match(html,/Ana/);
});

function fakeDom(){
 const all=new Map(),listeners=new Map();
 class Element{constructor(id=''){this.id=id;this.style={display:'none'};this.dataset={};this.value='';this.children=[];this.events={};this.classList={contains:name=>name==='active',toggle(){}};this.isConnected=true;}setAttribute(){}append(...children){this.children.push(...children);for(const child of children)if(child.id)all.set(child.id,child);}appendChild(child){this.append(child);}after(){}closest(){return {after(){}};}replaceChildren(...children){this.children=children;}addEventListener(name,fn){this.events[name]=fn;}querySelector(selector){const id=selector.slice(1);if(!all.has(id))all.set(id,new Element(id));return all.get(id);}set innerHTML(_value){for(const id of ['scheduleEffectiveFrom','scheduleMemoryVersions','scheduleMemoryStatus','scheduleMemoryLatest'])if(!all.has(id))all.set(id,new Element(id));}get innerHTML(){return '';}}
 const document={hidden:false,getElementById:id=>all.get(id)||null,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn)};
 for(const id of ['monthSelector','view-schedule'])all.set(id,new Element(id));all.get('monthSelector').value='2026-10';
 return {document,all,listeners,Element};
}
test('version-list refresh never advances the edit revision; selecting a history view protects dirty edits',async()=>{
 const dom=fakeDom(),archive={month:'2026-10',latestRevisionId:'v2',revisions:[{revisionId:'v2',effectiveFrom:'2026-10-16',savedAt:'2026-10-16T01:00:00Z',snapshot:schedule('Archived')}]};archive.latestRevision=archive.revisions[0];let current=schedule(),expected='v1',applies=0;
 const previous=globalThis.Option;globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 try{const ui=installScheduleMemoryUI({document:dom.document,store:{loadMonth:async()=>archive},getSnapshot:()=>current,applySnapshot:value=>{current=copy(value);applies++;},setExpectedRevision:value=>expected=value,setReadOnly(){},confirmVersionChange:async()=>false});await ui.refresh();assert.equal(expected,'v1');assert.equal(applies,0);dom.all.get('scheduleMemoryVersions').value='v2';await dom.all.get('scheduleMemoryVersions').onchange();assert.equal(applies,0);assert.equal(ui.isViewingHistory(),false);ui.bindView({month:'2026-10',archive,editorSnapshot:current,expectedRevisionId:'v2'});assert.equal(expected,'v1');}finally{globalThis.Option=previous;}
});
test('mobile visibility resumes clean data once, ignores cached snapshots and stops listeners on hide',async()=>{
 const db=server(),dom=fakeDom(),subscribed=[],events=new Map();let current=schedule(),expected,network=0,reads=0,stops=0;
 const w={addEventListener:(name,fn)=>events.set(name,fn),ManagerUI:{confirm:async()=>false},Swal:{isVisible:()=>false},db:{},doc:(_db,_collection,id)=>id,onSnapshot:(id,options,fn)=>{assert.equal(options.includeMetadataChanges,true);subscribed.push({id,fn});return ()=>stops++;},enableNetwork:async()=>network++};
 const controller=installOwnerScheduleSync(w,dom.document,{readView:async()=>{reads++;return db.view('2026-10');},applyView:view=>current=copy(view.editorSnapshot),getSnapshot:()=>current,getMonth:()=> '2026-10',getIdentity:()=> 'owner',getExpectedRevision:()=>expected,setExpectedRevision:value=>expected=value,getEffectiveFrom:()=> '2026-10-16',saveSnapshot:db.save.bind(db)});await controller.load();assert.equal(subscribed.length,2);
 const head=subscribed.find(row=>row.id==='global_schedule'),snap=(fromCache,hasPendingWrites=false)=>({exists:()=>true,data:()=>db.snapshot,metadata:{fromCache,hasPendingWrites}});head.fn(snap(true));head.fn(snap(false,true));await tick();assert.equal(reads,1);
 dom.document.hidden=true;dom.listeners.get('visibilitychange')();assert.equal(stops,2);db.remote(schedule('After phone wakes'),'v2');dom.document.hidden=false;dom.listeners.get('visibilitychange')();events.get('pageshow')();events.get('online')();await tick();await tick();assert.equal(network,0);assert.equal(reads,2);assert.equal(current.currentSchedule[16].Maa.scheduled.n1,'After phone wakes');controller.stop();
});
