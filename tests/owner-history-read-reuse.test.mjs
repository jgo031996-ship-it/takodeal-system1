import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDashboard} from '../takodeal-manager/dashboard.js';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';

const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const first=main.indexOf('window.loadSalesHistoryTab = async function()');
const historySource=main.slice(first,main.indexOf('\nwindow.',first+1));
const start=new Date('2026-10-20T00:00:00+08:00'),end=new Date('2026-10-20T23:59:59+08:00');
const sale=(id,patch={})=>({id,branch:'Maa',status:'Paid',netTotal:80,paymentMethod:'Cash',timestamp:new Date('2026-10-20T12:00:00+08:00'),cart:[{name:'Sample drink',qty:1,price:100}],...patch});
const inventory=[{id:'ice',name:'Ice Cubes',branch:'Maa',baseCost:.015}];
const bom=[{id:'recipe',menuItem:'Sample drink',ingredientName:'Ice Cubes',qty:170}];
const snapshot=data=>({docs:data.map(row=>({id:row.id,data:()=>row})),forEach(fn){this.docs.forEach(fn);}});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};

function fixture({branch='Maa',archive='LIVE',tx=[sale('paid')],extra={},manualTimers=false}={}){
 const nodes=new Map(),reads=[],references=[],analytics=[],errors=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',innerText:'',textContent:'',style:{},value:''});return nodes.get(id);};
 for(const [id,value] of Object.entries({histStartDate:'2026-10-20',histEndDate:'2026-10-20',histBranchFilter:branch,histArchiveSelect:archive}))get(id).value=value;
 const data={inventory,bom,menu:[{id:'menu',name:'Sample drink',category:'Drinks'}],shifts:[],incoming_orders:[sale('rejected',{status:'rejected'})],parked_orders:[sale('parked',{status:'Parked'})],transactions:tx,...extra};
 const w={db:{},auth:{currentUser:{uid:'owner'}},sessionUser:{uid:'owner',email:'owner@example.test',permissions:['all'],allowedBranches:['All']},isBranchAllowed:b=>b==='Maa',collection:(_db,table)=>({table}),where:(field,op,value)=>({field,op,value}),orderBy:(field,order)=>({field,order}),query:(ref,...clauses)=>({...ref,clauses}),getDocs:async ref=>{reads.push(ref);return snapshot(data[ref.table]||[]);},fetchCachedCollection:async name=>{references.push(name);return data[name];}};
 const d={getElementById:get},dashboard=createDashboard(w,d);
 const timers=new Map();let timerId=0;w.setTimeout=manualTimers?(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;}:setTimeout;w.clearTimeout=manualTimers?id=>timers.delete(id):clearTimeout;
 w.loadProductAnalytics=(...args)=>{analytics.push(args);return dashboard.historyProducts(...args);};
 let liveRender,alive=true,watches=0,generation=0;
 const historyLive={start(){alive=true;const current=++generation;return{active:()=>alive&&current===generation,watch(_query,render){watches++;liveRender=render;}};}};
 const context={window:w,document:d,historyLive,console:{error:error=>errors.push(error)},fetch:async()=>({json:async()=>tx}),Date};
 vm.createContext(context);vm.runInContext(historySource,context);
 return{w,d,dashboard,nodes,get,reads,references,analytics,errors,data,timers,load:()=>w.loadSalesHistoryTab(),emit:(rows,update=false)=>liveRender(snapshot(rows),update),stop:()=>{alive=false;},watches:()=>watches};
}

test('live product report reuses captured transactions and costs without a Firestore read, keeping paid/branch/date/discount rules',async()=>{
 const f=fixture(),tx=[sale('paid'),sale('void',{status:'Voided'}),sale('foreign',{branch:'Cabantian'}),sale('old',{timestamp:new Date('2026-10-19T12:00:00+08:00')})],saved=structuredClone({tx,inventory,bom});
 await f.dashboard.historyProducts(start,end,'Maa',{transactions:tx,inventory,bom,isCurrent:()=>true});
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.references,[]);
 const html=f.get('historyProductAnalyticsBody').innerHTML;
 assert.match(html,/Sample drink/);assert.match(html,/₱80\.00/);assert.match(html,/₱2\.55/);assert.match(html,/₱77\.45/);
 assert.deepEqual({tx,inventory,bom},saved,'reusing a report must not alter receipt or catalog rows');
});

test('standalone analytics retains its existing one transaction query and reference reads with identical figures',async()=>{
 const f=fixture();await f.dashboard.historyProducts(start,end,'Maa');
 assert.deepEqual(f.reads.map(row=>row.table),['transactions']);assert.deepEqual(f.references,['inventory','bom']);
 assert.deepEqual(f.reads[0].clauses.map(row=>[row.field,row.op]),[['branch','=='],['timestamp','>='],['timestamp','<=']]);
 const fallback=f.get('historyProductAnalyticsBody').innerHTML;
 await f.dashboard.historyProducts(start,end,'Maa',{transactions:f.data.transactions,inventory,bom,isCurrent:()=>true});
 assert.equal(f.get('historyProductAnalyticsBody').innerHTML,fallback);assert.equal(f.reads.length,1);
});

test('invalid or missing recipe inputs fail visibly without launching replacement queries or claiming a zero cost',async()=>{
 const f=fixture();await f.dashboard.historyProducts(start,end,'Maa',{transactions:f.data.transactions,inventory:[],bom,isCurrent:()=>true});
 assert.match(f.get('historyProductAnalyticsBody').innerHTML,/Missing ingredient/);assert.match(f.get('historyProductAnalyticsBody').innerHTML,/Check recipe/);assert.doesNotMatch(f.get('historyProductAnalyticsBody').innerHTML,/₱0\.00/);
 await f.dashboard.historyProducts(start,end,'Maa',{transactions:f.data.transactions,inventory,isCurrent:()=>true});
 assert.match(f.get('historyProductAnalyticsBody').innerHTML,/inputs are incomplete/);assert.deepEqual(f.reads,[]);assert.deepEqual(f.references,[]);
});

test('superseded reuse and delayed standalone reads cannot paint after account or report changes',async()=>{
 const f=fixture(),node=f.get('historyProductAnalyticsBody');node.innerHTML='Keep current report';
 await f.dashboard.historyProducts(start,end,'Maa',{transactions:f.data.transactions,inventory,bom,isCurrent:()=>false});assert.equal(node.innerHTML,'Keep current report');
 const wait=deferred();f.w.getDocs=()=>wait.promise;
 const pending=f.dashboard.historyProducts(start,end,'Maa');f.w.auth.currentUser.uid='another-account';node.innerHTML='New account report';wait.resolve(snapshot(f.data.transactions));await pending;assert.equal(node.innerHTML,'New account report');
});

test('actual live History reads six inputs once and updates analytics from raw receipt snapshots, excluding parked and rejected references',async()=>{
 const f=fixture();await f.load();assert.equal(f.watches(),1);
 assert.deepEqual(f.reads.map(row=>row.table),['inventory','bom','menu','shifts','incoming_orders','parked_orders']);
 await f.emit([sale('first')]);assert.equal(f.analytics.length,1);assert.deepEqual(Array.from(f.analytics[0][3].transactions,row=>row.id),['first']);
 assert.equal(f.analytics[0][3].inventory[0].baseCost,.015);assert.equal(f.analytics[0][3].bom[0].qty,170);assert.match(f.get('historyProductAnalyticsBody').innerHTML,/₱80\.00/);
 await f.emit([sale('first',{netTotal:60})],true);assert.equal(f.analytics.length,2);assert.match(f.get('historyProductAnalyticsBody').innerHTML,/₱60\.00/);
 assert.equal(f.reads.length,6,'live updates must not repeat transaction or catalog reads');assert.deepEqual(f.references,[]);assert.deepEqual(f.errors,[]);
 f.stop();const before=f.get('historyProductAnalyticsBody').innerHTML;await f.emit([sale('stale',{netTotal:999})],true);assert.equal(f.get('historyProductAnalyticsBody').innerHTML,before);assert.equal(f.analytics.length,2);
});

test('actual History account changes discard loaded inputs before subscription or late rendering',async()=>{
 const f=fixture(),wait=deferred(),read=f.w.getDocs;f.w.getDocs=ref=>ref.table==='menu'?wait.promise:read(ref);
 const pending=f.load();await Promise.resolve();f.w.sessionUser.allowedBranches=['Cabantian'];wait.resolve(snapshot(f.data.menu));await pending;assert.equal(f.watches(),0);assert.equal(f.analytics.length,0);
 const g=fixture();await g.load();g.w.auth.currentUser.uid='changed';await g.emit([sale('stale')]);assert.equal(g.analytics.length,0);assert.deepEqual(g.errors,[]);
});

test('failed History inputs replace initial zeroes and Connecting with an explicit unavailable report',async()=>{
 const f=fixture(),read=f.w.getDocs;f.w.getDocs=ref=>ref.table==='menu'?Promise.reject(Error('Menu read denied')):read(ref);
 await f.load();assert.equal(f.watches(),0);assert.match(f.get('histLiveStatus').textContent,/Sales report unavailable/);assert.equal(f.get('histSumNet').innerText,'Unavailable');assert.equal(f.get('histSumCogs').innerText,'Unavailable');assert.match(f.get('historyTableBody').innerHTML,/use Update Report to retry/);assert.match(f.get('historyDailyBody').innerHTML,/Pending Verifications has its own/);assert.equal(f.errors.length,1);
});

test('History support-read deadlines retain physical work, suppress late subscriptions and share explicit retries',async()=>{
 const f=fixture({manualTimers:true,extra:{incoming_orders:[],parked_orders:[]}}),wait=deferred(),read=f.w.getDocs;f.w.getDocs=ref=>{const result=read(ref);return ref.table==='menu'?wait.promise.then(()=>result):result;};
 const first=f.load();await Promise.resolve();assert.equal(f.get('histSumNet').innerText,'—');assert.match(f.get('histLiveStatus').textContent,/Loading sales report/);assert.equal(f.reads.length,6);assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.ms,20000);timer.callback();await first;assert.equal(f.watches(),0);assert.equal(f.get('histSumNet').innerText,'Unavailable');
 const retry=f.load();await Promise.resolve();assert.equal(f.reads.length,6,'Retry must share still-running physical support reads.');wait.resolve();await retry;assert.equal(f.watches(),1);assert.equal(f.timers.size,0);await f.emit([sale('current')]);assert.match(f.get('histSumNet').innerText,/80\.00/);
});

test('filter, account-object and view changes suppress late History inputs and old report rendering',async()=>{
 for(const change of ['date','branch','archive','account','view']){
  const f=fixture(),wait=deferred(),read=f.w.getDocs;f.w.getDocs=ref=>ref.table==='menu'?wait.promise:read(ref);const loading=f.load();await Promise.resolve();
  if(change==='date')f.get('histStartDate').value='2026-10-19';if(change==='branch')f.get('histBranchFilter').value='Cabantian';if(change==='archive')f.get('histArchiveSelect').value='https://example.test/other.json';if(change==='account')f.w.auth.currentUser={...f.w.auth.currentUser};if(change==='view')f.stop();
  f.get('histSumNet').innerText='Current scope';f.get('histLiveStatus').textContent='Current scope';wait.resolve(snapshot(f.data.menu));await loading;assert.equal(f.watches(),0,change);assert.equal(f.get('histSumNet').innerText,'Current scope');assert.equal(f.get('histLiveStatus').textContent,'Current scope');
 }
});

test('entering Sales History invokes its report and shift loaders once only for a permitted signed-in account',()=>{
 const start=main.indexOf('const loginOriginalSwitchView = window.switchView;'),source=main.slice(start,main.indexOf('\n};',start)+3),calls=[];
 const w={auth:{currentUser:{uid:'owner'}},sessionUser:{uid:'owner',permissions:['history'],allowedBranches:['Maa']},switchView:view=>calls.push('view:'+view),loadHistoryShiftDropdown:()=>calls.push('shifts'),loadSalesHistoryTab:()=>calls.push('report')};
 vm.runInNewContext(source,{window:w,canOpenWorkspacePage,logisticsFeed:{syncVisibility(){}}});w.switchView('history');assert.deepEqual(calls,['view:history','shifts','report']);calls.length=0;w.switchView('dashboard');assert.deepEqual(calls,['view:dashboard']);calls.length=0;w.sessionUser.permissions=[];w.switchView('history');assert.deepEqual(calls,['view:history']);
});

test('actual archive History keeps the standalone analytics fallback and does not create a live subscription',async()=>{
 const f=fixture({archive:'https://example.test/archive.json'});await f.load();await Promise.resolve();
 assert.equal(f.watches(),0);assert.equal(f.analytics.length,1);assert.equal(f.analytics[0].length,3);
 assert.equal(f.reads.filter(row=>row.table==='transactions').length,1);assert.deepEqual(f.references,['inventory','bom']);assert.deepEqual(f.errors,[]);
});

test('main analytics bridge forwards the captured report without discarding its guard',()=>{
 const source=main.slice(main.indexOf('window.loadProductAnalytics ='),main.indexOf('\n',main.indexOf('window.loadProductAnalytics ='))),calls=[],window={},globalDashboard={historyProducts:(...args)=>calls.push(args)};
 const loaded={transactions:[],inventory:[],bom:[],isCurrent:()=>true};vm.runInNewContext(source,{window,globalDashboard});window.loadProductAnalytics(start,end,'Maa',loaded);assert.equal(calls[0][3],loaded);
});
