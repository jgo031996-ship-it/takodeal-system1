import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {swapCandidates,SWAP_PENDING_STATUS,SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION} from '../takodeal-staff/schedule-swap-model.js';
import * as requests from '../takodeal-staff/staff-swap-request.js';
import {monthKey,scheduleDateKey} from '../takodeal-staff/schedule-history.js';

const copy=value=>structuredClone(value),at='2026-11-07T12:00:00+08:00';
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return Date.parse(at);}}
const person=(id,name,branch)=>({staffId:id,name,cashierName:name,scheduleNickname:name,branch,status:'Active',active:true,scheduleEligible:true});
function snapshot(){return {currentYear:2026,currentMonth:11,scheduleRevisionId:'revision-one',employees:[person('self','Sample Self','Citygate'),person('maa','Maa Sample','Maa'),person('cab','Cabantian Sample','Cabantian'),person('agdao','Standby Sample','Agdao')],branchConfig:Object.fromEntries(['Citygate','Maa','Cabantian','Agdao'].map(branch=>[branch,[{id:'open',name:'Opener',startTime:'10:00',endTime:'19:00',days:[0,1,2,3,4,5,6],active:true}]])),currentSchedule:{7:{Citygate:{scheduled:{open:'Sample Self'},rest:[],unavailable:[]},Maa:{scheduled:{open:'Maa Sample'},rest:[],unavailable:[]},Cabantian:{scheduled:{open:'Cabantian Sample'},rest:[],unavailable:[]},Agdao:{scheduled:{},rest:['Standby Sample'],unavailable:[]}}},unavailability:{},holidays:{}};}
function harness(){
 const nodes=new Map(),storage=new Map([['takodeal_staff_id','self'],['takodeal_staff_name','Sample Self']]),writes=[],reads=[],dialogs=[];
 class Element{constructor(tag){this.tagName=tag;this.children=[];this.style={display:'none'};this.value='';this.disabled=false;this.textContent='';}appendChild(child){this.children.push(child);}replaceChildren(...children){this.children=children;}get options(){return this.children.flatMap(child=>child.tagName==='optgroup'?child.children:[child]);}}
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Element('div'));return nodes.get(id);};
 node('staffMonthPicker').value='2026-11';
 const h={snapshot:snapshot(),profile:{cashierName:'Sample Self',scheduleNickname:'Sample Self',branch:'Citygate',pin:'PRIVATE TEST PIN',salary:12345,status:'Active'},writes,reads,dialogs,node,storage,readMonth:null};
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async ref=>{reads.push(ref);return {exists:()=>true,data:()=>copy(h.profile),metadata:{fromCache:false,hasPendingWrites:false}};}};
 const readMonth=async(_api,{month})=>{if(h.readMonth)return h.readMonth(month);const value=copy(h.snapshot);return {hasSavedSchedule:true,snapshot:value,daySnapshots:{7:value},dayRevisions:{7:value.scheduleRevisionId}};};
 const window={...api},context={window,document:{getElementById:node,createElement:tag=>new Element(tag)},localStorage:{getItem:key=>storage.get(key)||null},Date:FixedDate,monthKey,scheduleDateKey,swapCandidates,SWAP_PENDING_STATUS,SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION,...requests,loadStaffSwapContext:(api,options)=>requests.loadStaffSwapContext(api,{...options,readMonth}),db:api.db,collection:(_db,table)=>table,addDoc:async(table,data)=>{writes.push({table,data:copy(data)});},serverTimestamp:()=>at,Swal:{fire:(...args)=>{dialogs.push(args);},close(){},showLoading(){}},console:{error(){}}};
 const source=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8'),start=source.indexOf('window.cancelSwapRequest ='),end=source.indexOf('window.listenToIncomingSwaps =',start);
 assert.ok(start>=0&&end>start);vm.runInNewContext(source.slice(start,end),context);
 h.window=window;return h;
}

test('actual swap picker lists labelled candidates across all saved branches without a staff-directory query',async()=>{
 const h=harness();await h.window.initiateSwapRequest(7,'2026-11-07','Citygate','open','Opener');
 const labels=h.node('swapCandidateSelect').options.map(option=>option.textContent);
 assert.ok(labels.some(label=>label.includes('Maa Sample — Maa')));assert.ok(labels.some(label=>label.includes('Cabantian Sample — Cabantian')));assert.ok(labels.some(label=>label.includes('Standby Sample — Agdao')));assert.equal(labels.some(label=>label.startsWith('Sample Self')),false);
 assert.deepEqual(h.reads,['cashiers/self']);assert.equal(h.writes.length,0);assert.equal(h.node('swapRequestModal').style.display,'flex');
});

test('actual submission refreshes evidence and persists exact cross-branch links, not profile secrets',async()=>{
 const h=harness();await h.window.initiateSwapRequest(7,'2026-11-07','Citygate','open','Opener');
 const option=h.node('swapCandidateSelect').options.find(option=>option.textContent.includes('Cabantian Sample'));
 h.node('swapCandidateSelect').value=option.value;await h.window.submitSwapRequest();
 assert.equal(h.writes.length,1);const saved=h.writes[0];assert.equal(saved.table,'shift_swaps');assert.equal(saved.data.branch,'Citygate');assert.equal(saved.data.targetBranch,'Cabantian');assert.equal(saved.data.targetStaffId,'cab');assert.equal(saved.data.requesterStaffId,'self');assert.equal(saved.data.requesterShiftId,saved.data.targetShiftId);assert.equal(saved.data.status,SWAP_PENDING_STATUS);assert.equal(saved.data.requestVersion,2);
 assert.doesNotMatch(JSON.stringify(saved.data),/PRIVATE TEST PIN|salary|12345/);assert.deepEqual(h.reads,['cashiers/self','cashiers/self']);assert.equal(h.node('swapRequestModal').style.display,'none');
});

test('changed assignments or an inactive requester block submission before any request write',async()=>{
 for(const kind of ['schedule','profile']){
  const h=harness();await h.window.initiateSwapRequest(7,'2026-11-07','Citygate','open','Opener');h.node('swapCandidateSelect').value='0';
  if(kind==='schedule')h.snapshot.currentSchedule[7].Maa.scheduled.open='Another Sample';else h.profile.blocked=true;
  await h.window.submitSwapRequest();assert.equal(h.writes.length,0);assert.equal(h.node('btnSendSwap').disabled,false);
 }
});

test('an account switch or cancellation during a held read cannot open a stale modal or send a request',async()=>{
 const h=harness();let release;h.readMonth=()=>new Promise(resolve=>{release=resolve;});
 const pending=h.window.initiateSwapRequest(7,'2026-11-07','Citygate','open','Opener');while(!release)await new Promise(resolve=>setImmediate(resolve));
 h.storage.set('takodeal_staff_id','different');h.window.cancelSwapRequest();const value=snapshot();release({hasSavedSchedule:true,snapshot:value,daySnapshots:{7:value},dayRevisions:{7:'revision-one'}});await pending;
 assert.notEqual(h.node('swapRequestModal').style.display,'flex');assert.equal(h.window.pendingSwapData,null);assert.equal(h.writes.length,0);
});

test('month-boundary loader obtains explicit adjacent-month evidence without reading coworker profiles',async()=>{
 const reads=[],months=[],base=snapshot();let active=true;
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async ref=>{reads.push(ref);return {exists:()=>true,data:()=>({cashierName:'Sample Self',status:'Active'})};}};
 const result=await requests.loadStaffSwapContext(api,{staffId:'self',staffName:'Sample Self',workDate:'2026-11-01',assertCurrent:()=>assert.equal(active,true),readMonth:async(_api,{month})=>{months.push(month);const [year,number]=month.split('-').map(Number),value={...copy(base),currentYear:year,currentMonth:number};return {hasSavedSchedule:true,snapshot:value,daySnapshots:{},dayRevisions:{}};}});
 assert.deepEqual(months,['2026-11','2026-10']);assert.ok(result.daySnapshots['2026-10-31']);assert.deepEqual(reads,['cashiers/self']);
 await assert.rejects(()=>requests.loadStaffSwapContext(api,{staffId:'self',workDate:'2026-11-01',readMonth:async(_api,{month})=>({hasSavedSchedule:month==='2026-11',snapshot:base,daySnapshots:{}})}),/neighboring month/);
});

test('incoming cross-branch explanations name both workplaces and escape record text',()=>{
 const html=requests.incomingSwapDetailsHTML({requesterName:'<img src=x>',branch:'Maa & North',targetBranch:'Cabantian',requesterShiftName:'Opener',targetShiftName:'Closer',workDate:'2026-11-07'});
 assert.match(html,/Maa &amp; North/);assert.match(html,/Cabantian/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/HQ approval/);
});

test('unpublished next month does not prevent preparing a daytime month-end swap',async()=>{
 const value=snapshot();value.currentSchedule[30]=copy(value.currentSchedule[7]);delete value.currentSchedule[7];
 const api={db:{},doc:(_db,table,id)=>table+'/'+id,getDocFromServer:async()=>({exists:()=>true,data:()=>({cashierName:'Sample Self',status:'Active'})})};
 const context=await requests.loadStaffSwapContext(api,{staffId:'self',staffName:'Sample Self',workDate:'2026-11-30',readMonth:async(_api,{month})=>({hasSavedSchedule:month==='2026-11',snapshot:value,daySnapshots:{30:value},dayRevisions:{30:'revision-one'}})});
 assert.equal(context.daySnapshots['2026-12-01'],undefined);
 assert.ok(swapCandidates({snapshot:context.snapshot,daySnapshots:context.daySnapshots,workDate:context.workDate,requesterBranch:'Citygate',requesterShiftId:'open',requesterAliases:context.requesterAliases,requesterStaffId:'self'}).some(row=>row.targetBranch==='Cabantian'));
});
