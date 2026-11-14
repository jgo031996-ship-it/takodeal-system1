import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {swapCandidates,SWAP_PENDING_STATUS,SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION} from '../takodeal-staff/schedule-swap-model.js';
import * as requests from '../takodeal-staff/staff-swap-request.js';
import {monthKey,scheduleDateKey,createScheduleRevision} from '../takodeal-staff/schedule-history.js';
import {loadScheduleMonthView} from '../takodeal-staff/schedule-sync.js';

const at='2026-11-12T04:00:00Z',copy=value=>structuredClone(value),tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
async function waitFor(predicate){for(let i=0;i<40&&!predicate();i++)await tick();assert.ok(predicate());}
class Clock extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return Date.parse(at);}}
const person=(staffId,cashierName,branch)=>({staffId,cashierName,scheduleNickname:cashierName,branch,status:'Active'});
function schedule(){return {currentYear:2026,currentMonth:11,scheduleRevisionId:'frozen-schedule',employees:[person('self','Fictional Crew','Citygate'),person('other','Fictional Coworker','Maa')],branchConfig:Object.fromEntries(['Citygate','Maa'].map(branch=>[branch,[{id:'open',name:'Opening shift',startTime:'10:00',endTime:'19:00',active:true,days:[0,1,2,3,4,5,6]}]])),currentSchedule:Object.fromEntries([11,12,13].map(day=>[day,{Citygate:{scheduled:{open:'Fictional Crew'}},Maa:{scheduled:{open:'Fictional Coworker'}}}])),unavailability:{},holidays:{}};}
const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
function harness(product=source){
 const nodes=new Map(),storage=new Map([['takodeal_staff_id','self'],['takodeal_staff_name','Fictional Crew'],['takodeal_device_id','fictional-device']]);
 class Element{constructor(tag='div'){this.tagName=tag;this.style={display:'none'};this.children=[];this.value='';this.disabled=false;this.textContent='';}appendChild(child){this.children.push(child);}replaceChildren(...children){this.children=children;}get options(){return this.children.flatMap(child=>child.tagName==='optgroup'?child.children:[child]);}}
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};node('staffMonthPicker').value='2026-11';
 const h={node,storage,snapshot:schedule(),profile:person('self','Fictional Crew','Citygate'),dialogs:[],updates:[],writes:[],calls:0,opens:[],loading:[]};let popup=null,dialogResult=null;
 const Swal={fire(...args){h.dialogs.push(args);popup={};const current=popup;if(args[0]?.didOpen){if(h.delayOpen)h.opens.push(()=>args[0].didOpen(current));else args[0].didOpen(current);}if(args[0]?.showCancelButton){dialogResult=deferred();return dialogResult.promise;}return Promise.resolve({});},getPopup:()=>popup,update:options=>h.updates.push(options),showLoading(){h.loading.push(popup);},close(){popup=null;dialogResult?.resolve({dismiss:'close'});dialogResult=null;}};
 const api={db:{},auth:{currentUser:{uid:'fictional-uid'}},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async ref=>{if(h.profileRead)await h.profileRead(ref);return {exists:()=>true,data:()=>copy(h.profile),metadata:{fromCache:false,hasPendingWrites:false}};}};
 const view=()=>{const value=copy(h.snapshot);return {hasSavedSchedule:true,snapshot:value,daySnapshots:{11:value,12:value,13:value},dayRevisions:{12:value.scheduleRevisionId}};};h.view=view;
 const readMonth=async()=>h.monthRead?h.monthRead():view(),window={...api};
 const context={window,staffPrimaryAuth:api.auth,document:{getElementById:node,createElement:tag=>new Element(tag)},localStorage:{getItem:key=>storage.get(key)||null},Date:Clock,monthKey,scheduleDateKey,swapCandidates,SWAP_PENDING_STATUS,SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION,...requests,loadStaffSwapContext:(api,options)=>requests.loadStaffSwapContext(api,{...options,readMonth}),db:api.db,collection:(_db,table)=>table,addDoc:async(table,data)=>{h.calls++;if(h.beforeWrite)await h.beforeWrite();h.writes.push({table,data:copy(data)});if(h.afterWrite)await h.afterWrite();},serverTimestamp:()=>at,Swal,console:{error(){}}};
 const start=product.indexOf('window.cancelSwapRequest ='),end=product.indexOf('window.listenToIncomingSwaps =',start);assert.ok(start>0&&end>start);vm.runInNewContext(product.slice(start,end),context);
 h.window=window;h.open=()=>window.initiateSwapRequest(12,'2026-11-12','Citygate','open','Opening shift');h.choose=()=>{node('swapCandidateSelect').value='0';};h.cancelProgress=()=>dialogResult.resolve({dismiss:'cancel'});return h;
}

test('the exact live baseline hides send errors behind z10005; the actual repaired handler targets the current request modal',async()=>{
 const baseline=execFileSync('git',['show','b576555caa29b571706ba8d0fc0ebaae414869bf:takodeal-staff/app.js'],{encoding:'utf8',maxBuffer:2e6});
 assert.equal(createHash('sha256').update(baseline).digest('hex'),'85a65569ecaac998e97c59f1a78a814b0b6329ff55c58300332e5730589dcc68');
 for(const [product,legacy]of [[baseline,true],[source,false]]){
  const h=harness(product);await h.open();h.choose();h.snapshot.currentSchedule[12].Maa.scheduled.open='Changed Crew';await h.window.submitSwapRequest();
  assert.equal(h.writes.length,0);assert.equal(h.node('swapRequestModal').style.display,'flex');
  const error=h.dialogs.at(-1);if(legacy){assert.equal(error[0],'Could not send request');assert.equal(error[0]?.target,undefined);}else{assert.equal(error[0].titleText,'Could not send request');assert.equal(error[0].target,h.node('swapRequestModal'));assert.match(error[0].text,/No request was sent/);}
 }
 assert.match(readFileSync(new URL('../takodeal-staff/index.html',import.meta.url),'utf8'),/id="swapRequestModal"[^>]*z-index:\s*10005/);
});

test('opening can be cancelled during either fresh read and late results cannot revive a modal or request',async()=>{
 for(const phase of ['profile','month']){
  const h=harness(),held=deferred();if(phase==='profile')h.profileRead=()=>held.promise;else h.monthRead=()=>held.promise;
  const opening=h.open();await waitFor(()=>h.dialogs.some(row=>row[0]?.showCancelButton));h.cancelProgress();await tick();
  assert.equal(h.window.pendingSwapData,null);held.resolve(h.view());await opening;
  assert.notEqual(h.node('swapRequestModal').style.display,'flex');assert.equal(h.writes.length,0);assert.equal(h.window.staffSwapWorkflow,null);
 }
});

test('a slow send preflight remains visibly cancellable and never dispatches after cancellation',async()=>{
 const h=harness();await h.open();h.choose();const held=deferred();h.monthRead=()=>held.promise;
 const sending=h.window.submitSwapRequest();await waitFor(()=>h.window.staffSwapWorkflow?.phase==='checking');
 assert.equal(h.node('btnCancelSwap').disabled,false);assert.equal(h.dialogs.at(-1)[0].target,h.node('swapRequestModal'));
 h.window.cancelSwapRequest();held.resolve(h.view());await sending;
 assert.equal(h.calls,0);assert.equal(h.writes.length,0);assert.equal(h.window.pendingSwapData,null);assert.equal(h.node('btnSendSwap').disabled,false);
});

test('current month, primary identity or physical device drift while opening cannot produce usable stale choices',async()=>{
 for(const change of ['month','auth','device']){
  const h=harness(),held=deferred();h.monthRead=()=>held.promise;const opening=h.open();await waitFor(()=>h.window.staffSwapWorkflow?.phase==='checking');
  if(change==='month')h.node('staffMonthPicker').value='2026-12';if(change==='auth')h.window.auth.currentUser={uid:'fictional-uid'};if(change==='device')h.storage.set('takodeal_device_id','other-device');
  held.resolve(h.view());await opening;assert.equal(h.window.pendingSwapData,null);assert.equal(h.writes.length,0);assert.notEqual(h.node('swapRequestModal').style.display,'flex');
 }
});

test('once the actual send starts it has no cancellation, write timeout or second dispatch until acknowledgement',async()=>{
 const h=harness();await h.open();h.choose();const held=deferred();h.beforeWrite=()=>held.promise;
 const sending=h.window.submitSwapRequest();await waitFor(()=>h.calls===1);h.window.cancelSwapRequest();await h.window.submitSwapRequest();
 assert.equal(h.window.staffSwapWritePending,true);assert.equal(h.node('btnCancelSwap').disabled,true);assert.equal(h.calls,1);assert.equal(h.writes.length,0);assert.equal(h.node('swapRequestModal').style.display,'flex');
 held.resolve();await sending;assert.equal(h.writes.length,1);assert.equal(h.window.staffSwapWritePending,false);assert.equal(h.window.pendingSwapData,null);
 assert.equal(h.writes[0].data.status,'Pending Staff Acceptance');assert.equal(h.writes[0].data.requestVersion,2);
});
test('a delayed progress didOpen cannot turn the newer terminal success dialog into a loading spinner',async()=>{
 const h=harness();h.delayOpen=true;await h.open();h.choose();await h.window.submitSwapRequest();assert.equal(h.writes.length,1);assert.equal(h.dialogs.at(-1)[0].titleText,'Request sent');assert.equal(h.window.staffSwapWorkflow,null);assert.equal(h.opens.length,2);
 h.opens.forEach(open=>open());assert.equal(h.loading.length,0);assert.equal(h.dialogs.at(-1)[0].titleText,'Request sent');assert.equal(h.node('btnSendSwap').disabled,false);
});

test('a lost send reply retains the chosen request, reports uncertainty above the modal and cannot immediately resend',async()=>{
 const h=harness();await h.open();h.choose();h.afterWrite=()=>{throw Error('Fictional lost reply');};await h.window.submitSwapRequest();
 const previous=h.window.pendingSwapData;assert.equal(h.writes.length,1);assert.equal(previous.sendUnconfirmed,true);assert.equal(h.window.staffSwapWritePending,true);assert.equal(h.node('btnSendSwap').disabled,true);
 assert.equal(h.dialogs.at(-1)[0].titleText,'Send not confirmed');assert.equal(h.dialogs.at(-1)[0].target,h.node('swapRequestModal'));assert.match(h.dialogs.at(-1)[0].text,/may already be saved/);
 await h.window.submitSwapRequest();h.window.cancelSwapRequest();await h.open();assert.equal(h.calls,1);assert.equal(h.window.pendingSwapData,previous);
 h.window.pendingSwapData=null;assert.equal(h.window.staffSwapWritePending,true,'Account/listener cleanup cannot discard the independent unknown-send hold.');await h.open();assert.equal(h.calls,1);assert.equal(h.window.pendingSwapData,null);
});

test('a bounded fresh-profile timeout retains its physical read so repeated checks cannot pile up requests',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:new Date(at)});const held=deferred();let reads=0;
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:()=>{reads++;return held.promise;}};
 const options={staffId:'self',staffName:'Fictional Crew',workDate:'2026-11-12',timeoutMs:1000,readMonth:async()=>({hasSavedSchedule:true,snapshot:schedule(),daySnapshots:{12:schedule()}})};
 const first=requests.loadStaffSwapContext(api,options),firstFailure=assert.rejects(first,/No request was sent/);await tick();t.mock.timers.tick(1001);await firstFailure;
 const second=requests.loadStaffSwapContext(api,options),secondFailure=assert.rejects(second,/No request was sent/);await tick();assert.equal(reads,1);t.mock.timers.tick(1001);await secondFailure;
 held.resolve({exists:()=>true,data:()=>person('self','Fictional Crew','Citygate'),metadata:{fromCache:false,hasPendingWrites:false}});await tick();
});

function slowRevisionRead(){
 const value=schedule(),held=deferred(),records=new Map([['cashiers/self',person('self','Fictional Crew','Citygate')],['settings/global_schedule',value]]),reads=[];
 const ids=Array.from({length:37},(_,i)=>'fictional-revision-'+String(i).padStart(2,'0'));
 for(const [i,id]of ids.entries()){const row=createScheduleRevision(value,{revisionId:id,effectiveFrom:'2026-11-01',savedAt:new Date(Date.parse('2026-11-01T00:00:00Z')+i)});row.sequence=i+1;records.set('settings/schedule_revision_'+id,row);}
 records.set('settings/schedule_month_2026_11',{month:'2026-11',revisionIds:ids,latestRevisionId:ids.at(-1)});
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async ref=>{reads.push(ref);if(ref.startsWith('settings/schedule_revision_'))await held.promise;return {exists:()=>records.has(ref),data:()=>copy(records.get(ref)),metadata:{fromCache:false,hasPendingWrites:false}};}};
 return {api,reads,held};
}
test('the existing default15second month reader really rejects a 20second37revision formal check',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:new Date(at)});const {api,reads,held}=slowRevisionRead();
 const pending=requests.loadStaffSwapContext(api,{staffId:'self',staffName:'Fictional Crew',workDate:'2026-11-12',readMonth:loadScheduleMonthView}),failed=assert.rejects(pending,/saved schedule could not be confirmed/);
 await waitFor(()=>reads.filter(ref=>ref.startsWith('settings/schedule_revision_')).length===37);t.mock.timers.tick(20000);await failed;held.resolve();await tick();assert.equal(reads.length,41);
});
test('the actual formal reader accepts a fresh 37-revision read taking20seconds without using the15second schedule-page deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:new Date(at)});const {api,reads,held}=slowRevisionRead();
 let settled=false;const pending=requests.loadStaffSwapContext(api,{staffId:'self',staffName:'Fictional Crew',workDate:'2026-11-12'});pending.then(()=>{settled=true;},()=>{settled=true;});
 await waitFor(()=>reads.filter(ref=>ref.startsWith('settings/schedule_revision_')).length===37);t.mock.timers.tick(20000);await tick();assert.equal(settled,false);
 held.resolve();const context=await pending;
 assert.ok(swapCandidates({snapshot:context.snapshot,daySnapshots:context.daySnapshots,workDate:context.workDate,requesterBranch:'Citygate',requesterShiftId:'open',requesterAliases:context.requesterAliases,requesterStaffId:'self'}).some(row=>row.targetBranch==='Maa'));
 assert.equal(reads.length,41);assert.equal(new Set(reads).size,41);assert.equal(context.requesterStaffId,'self');
});
