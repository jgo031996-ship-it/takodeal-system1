import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installCashierOwnerRegister,ownerSalesTotals} from '../Takodeal-POS/cashier-owner-register.js';
import {CASHIER_OWNER_WORKSPACE} from '../Takodeal-POS/cashier-owner-workspace.js';
const start=new Date('2026-11-15T02:00:00Z');
function fixture(){
 const callbacks=[],events=new Map(),nodes=new Map(),writes=[],intervals=new Set();
 const node=()=>({textContent:'Register is Closed',innerHTML:'original',style:{background:'white',color:'black'},disabled:true,onclick:null,classList:{contains:()=>true},addEventListener(type,fn){this[type]=fn;}});
 for(const id of ['btnTopShift','lockoutQuote','btnMainPlaceOrder','view-sales','tbTransBody'])nodes.set(id,node());
 const parts={h2:node(),p:node(),button:node()},lock={querySelector:key=>parts[key]};nodes.set('globalShiftLockout',lock);
 const d={getElementById:id=>nodes.get(id)||null},primaryDb={kind:'physical'},db={kind:'owner'},user={uid:'verified'},auth={currentUser:user},session=Object.freeze({workspaceKind:CASHIER_OWNER_WORKSPACE,branch:'Agdao'});
 let valid=true;
 const context={db,auth,user,session,branch:'Agdao',assertCurrent(){if(!valid||w.sessionUser!==session||auth.currentUser!==user)throw Error('changed');}};
 const w={db:primaryDb,sessionUser:session,navigator:{onLine:true},currentShift:null,cart:[{name:'kept'}],offlineQueue:[{saleId:'kept'}],shiftStatusGeneration:4,
  getCashierOwnerWorkspaceContext:()=>w.sessionUser===session?context:null,isCashierOwnerToolsMode:()=>w.sessionUser?.workspaceKind===CASHIER_OWNER_WORKSPACE,
  collection:(db,table)=>({db,table}),where:(field,op,value)=>({field,op,value}),limit:count=>({count}),orderBy:(field,direction)=>({field,direction}),query:(ref,...filters)=>({...ref,filters}),
  addEventListener:(type,fn)=>events.set(type,fn),stopShiftSalesFeed(){},Swal:{fire:args=>writes.push(args)},switchView(view){assert.equal(view,'sales');},
  getPendingSales(){assert.fail('Owner monitoring must not consume this device’s pending sales');},updateDoc(){assert.fail('Read-only');},runTransaction(){assert.fail('Read-only');}};
 const monitor=installCashierOwnerRegister(w,d,{subscribe(query,next,error){assert.equal(query.db,db);const call={query,next,error,stopped:false};callbacks.push(call);return()=>{call.stopped=true;};},setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);}});w.cashierOwnerRegister=monitor;
 const emit=(call,rows,metadata={fromCache:false,hasPendingWrites:false})=>call.next({metadata,docs:rows.map(({id,...row})=>({id,metadata:{fromCache:false,hasPendingWrites:false},data:()=>row}))});
 const open=(id='drawer-A')=>emit(callbacks[0],[{id,branch:'Agdao',active:true,startTime:{toDate:()=>start},cashier:'Real Crew'}]);
 return{w,d,nodes,parts,monitor,callbacks,events,intervals,emit,open,writes,context,session,invalidate(){valid=false;}};
}
const sale=(id,extra={})=>({id,receiptId:'R-'+id,branch:'Agdao',shiftId:'drawer-A',timestamp:new Date(+start+1000),netTotal:100,paymentMethod:'Cash',status:'Paid',...extra});
test('verified Owner gets the real open drawer and uploaded sales through its own connection',()=>{
 const f=fixture(),cart=f.w.cart,queue=f.w.offlineQueue;f.monitor.start();assert.equal(f.monitor.state().phase,'loading');assert.equal(f.callbacks[0].query.table,'shifts');assert.deepEqual(f.callbacks[0].query.filters.map(x=>[x.field,x.value,x.count]),[['branch','Agdao',undefined],['active',true,undefined],[undefined,undefined,2]]);
 f.open();assert.equal(f.monitor.state().phase,'sales-loading');assert.match(f.nodes.get('btnTopShift').textContent,/register open/);assert.equal(f.callbacks[1].query.table,'transactions');f.emit(f.callbacks[1],[sale('one'),sale('two',{paymentMethod:'GCash',netTotal:200})]);
 assert.equal(f.monitor.state().phase,'ready');const html=f.nodes.get('tbTransBody').innerHTML;assert.match(html,/Total sales ₱300.00/);assert.match(html,/Cash: ₱100.00/);assert.match(html,/R-one/);assert.match(html,/Real Crew/);assert.doesNotMatch(html,/data-owner-void=/);assert.match(html,/data-owner-receipt="one"/);assert.doesNotMatch(html,/₱\*\*\*/);assert.equal(f.w.currentShift,null);assert.equal(f.w.db.kind,'physical');assert.equal(f.w.cart,cart);assert.equal(f.w.offlineQueue,queue);assert.equal(f.w.shiftStatusGeneration,5);
});
test('only matching branch, shift and dates enter owner totals; legacy UNKNOWN and missing ids remain visible',()=>{
 const f=fixture();f.monitor.start();f.open();f.emit(f.callbacks[1],[sale('good'),sale('legacy',{shiftId:'UNKNOWN'}),sale('missing',{shiftId:undefined}),sale('other-branch',{branch:'Maa'}),sale('other-drawer',{shiftId:'other'}),sale('old',{timestamp:new Date(+start-1)}),sale('bad',{timestamp:null})]);assert.deepEqual(f.monitor.state().rows.map(row=>row.id).sort(),['good','legacy','missing']);assert.match(f.nodes.get('tbTransBody').innerHTML,/Total sales ₱300.00/);
});
test('a cached empty drawer cannot become a closed register and pending sales cannot become verified totals',()=>{
 const f=fixture();f.monitor.start();f.emit(f.callbacks[0],[],{fromCache:true});assert.equal(f.monitor.state().phase,'sales-loading');assert.doesNotMatch(f.nodes.get('btnTopShift').textContent,/closed/);f.open();f.emit(f.callbacks[2],[sale('pending')],{hasPendingWrites:true});assert.equal(f.monitor.state().phase,'sales-loading');assert.doesNotMatch(f.nodes.get('tbTransBody').innerHTML,/R-pending|Total sales/);f.emit(f.callbacks[2],[sale('live')]);assert.match(f.nodes.get('tbTransBody').innerHTML,/R-live/);
});
test('missing synced register still loads history; a later open/close cannot hide uploaded receipts',()=>{
 const f=fixture();f.monitor.start();f.emit(f.callbacks[0],[]);assert.equal(f.monitor.state().phase,'sales-loading');assert.doesNotMatch(f.nodes.get('btnTopShift').textContent,/closed/);assert.equal(f.callbacks[1].query.table,'transactions');f.emit(f.callbacks[1],[sale('history')]);assert.match(f.nodes.get('tbTransBody').innerHTML,/R-history/);f.open();assert.equal(f.callbacks[1].stopped,true);f.emit(f.callbacks[2],[sale('current')]);f.emit(f.callbacks[0],[]);assert.equal(f.callbacks[2].stopped,true);f.emit(f.callbacks[2],[sale('late')]);assert.doesNotMatch(f.nodes.get('tbTransBody').innerHTML,/R-late/);f.emit(f.callbacks[3],[sale('history')]);assert.equal(f.monitor.state().phase,'ready');assert.match(f.monitor.state().message,/No open register is synced/);assert.match(f.nodes.get('tbTransBody').innerHTML,/R-history/);
});
test('failed or duplicate register status remains unconfirmed while the independent history query can succeed',()=>{
 for(const duplicate of [false,true]){const f=fixture();f.monitor.start();if(duplicate)f.emit(f.callbacks[0],[{id:'a',branch:'Agdao',active:true,startTime:start},{id:'b',branch:'Agdao',active:true,startTime:start}]);else f.callbacks[0].error(Error('permission-denied'));assert.equal(f.callbacks[1].query.table,'transactions');f.emit(f.callbacks[1],[sale('history')]);assert.equal(f.monitor.state().phase,'ready');assert.doesNotMatch(f.nodes.get('btnTopShift').textContent,/closed/);assert.match(f.nodes.get('tbTransBody').innerHTML,/unconfirmed|could not be confirmed/);assert.match(f.nodes.get('tbTransBody').innerHTML,/R-history/);f.monitor.refresh();assert.equal(f.callbacks[0].stopped,true);assert.equal(f.callbacks[1].stopped,true);}
});
test('sales listener failures preserve known register-open status without showing empty or zero sales',()=>{
 const f=fixture();f.monitor.start();f.open();f.callbacks[1].error(Error('permission-denied'));assert.equal(f.monitor.state().phase,'sales-error');assert.match(f.nodes.get('btnTopShift').textContent,/register open/);assert.match(f.nodes.get('tbTransBody').innerHTML,/could not be loaded/);assert.doesNotMatch(f.nodes.get('tbTransBody').innerHTML,/No uploaded|Total sales/);f.monitor.refresh();assert.equal(f.callbacks[0].stopped,true);assert.equal(f.callbacks[1].stopped,true);
});
for(const change of ['logout','account','authority'])test('late callbacks cannot restore sales after '+change,()=>{
 const f=fixture();f.monitor.start();f.open();const old=f.callbacks[1];f.emit(old,[sale('first')]);if(change==='logout')f.w.sessionUser=null;if(change==='account')f.context.auth.currentUser={uid:'other'};if(change==='authority')f.invalidate();for(const tick of f.intervals)tick();f.emit(old,[sale('late')]);assert.doesNotMatch(f.nodes.get('tbTransBody').innerHTML,/R-first|R-late/);assert.equal(old.stopped,true);assert.notEqual(f.monitor.state().phase,'ready');
});
test('Owner view restores original register UI and clears its table on sign out',()=>{
 const f=fixture();f.monitor.start();f.open();f.emit(f.callbacks[1],[sale('one')]);assert.equal(f.parts.h2.textContent,'Loading branch menu');f.w.sessionUser=null;f.events.get('cashier-workspace-changed')();assert.equal(f.parts.h2.textContent,'Register is Closed');assert.equal(f.nodes.get('btnTopShift').innerHTML,'original');assert.equal(f.nodes.get('btnTopShift').style.background,'white');assert.equal(f.intervals.size,0);assert.equal(f.monitor.state().phase,'signed-out');assert.equal(f.nodes.get('tbTransBody').textContent,'Sign in to view branch sales.');
});
test('offline is unconfirmed and online retries against the Owner database',()=>{
 const f=fixture();f.monitor.start();f.open();f.events.get('offline')();assert.equal(f.callbacks[0].stopped,true);assert.equal(f.monitor.state().phase,'loading');assert.match(f.monitor.state().message,/Connection unavailable/);f.events.get('online')();assert.equal(f.callbacks[2].query.table,'shifts');
});
test('receipt content and branch labels are escaped; details are read-only saved rows',()=>{
 const f=fixture();f.monitor.start();f.open();f.emit(f.callbacks[1],[sale('one',{customerName:'<img onerror=evil()>',cart:[{name:'<script>evil()</script>',qty:2}]})]);assert.doesNotMatch(f.nodes.get('tbTransBody').innerHTML,/<img/);f.nodes.get('tbTransBody').click({target:{closest:()=>({dataset:{ownerReceipt:'one'}})}});assert.match(f.writes[0].html,/&lt;script&gt;/);assert.doesNotMatch(f.writes[0].html,/<script>/);assert.equal(f.w.currentShift,null);
});
test('split payments reconcile to the net total and voided or unpaid orders do not inflate sales',()=>{
 const result=ownerSalesTotals([sale('cash'),sale('split',{netTotal:150,splitDetails:[{method:'Cash',amount:50},{method:'GCash',amount:100}]}),sale('bank',{paymentMethod:'Bank',netTotal:200}),sale('void',{status:'Voided',netTotal:999}),sale('unpaid',{status:'Parked',netTotal:999})]);assert.equal(result.total,450);assert.equal(result.Cash,150);assert.equal(result.GCash,100);assert.equal(result.Other,200);assert.equal(result.count,3);
});
test('the actual entry and Sales UI route Owner to live monitoring while ordinary staff retain their engine',async()=>{
 const page=readFileSync(new URL('../Takodeal-POS/index.html',import.meta.url),'utf8');
 const check=page.slice(page.indexOf('    async function checkCurrentShift()'),page.indexOf('    function updateShiftUI(status)'));
 const dashboard=page.slice(page.indexOf('window.loadSalesDashboard = async function'),page.indexOf('    function toggleTxMenu(id)'));
 const f=fixture();let ordinary=0;f.w.checkShiftStatus=async()=>{ordinary++;return{active:true};};const box=vm.createContext({window:f.w,document:f.d,console,updateShiftUI(){ordinary++;},systemReady:false});vm.runInContext(check+dashboard,box);
 await vm.runInContext('checkCurrentShift()',box);assert.equal(f.callbacks.length,1);await f.w.loadSalesDashboard();assert.equal(f.callbacks[0].stopped,true);assert.equal(f.callbacks[1].query.table,'shifts');assert.equal(ordinary,0);
 f.w.sessionUser={branch:'Maa'};await vm.runInContext('checkCurrentShift()',box);assert.equal(ordinary,2);
});

test('latest and Philippine-date history query the selected branch, preserve voids and distinguish totals',()=>{
 const f=fixture();f.monitor.start();f.open();f.monitor.setRange('latest');const latest=f.callbacks.at(-1);assert.equal(latest.query.filters.find(v=>v.count).count,101);f.emit(latest,[sale('old',{timestamp:new Date(+start-86400000)}),sale('void',{status:'Voided',netTotal:999})]);assert.equal(f.monitor.state().rows.length,2);assert.match(f.nodes.get('tbTransBody').innerHTML,/Total sales ₱100.00/);f.monitor.setRange('date','2026-11-16');const dated=f.callbacks.at(-1);assert.equal(dated.query.filters.find(v=>v.op==='>=').value.toISOString(),'2026-11-15T16:00:00.000Z');assert.equal(dated.query.filters.find(v=>v.op==='<').value.toISOString(),'2026-11-16T16:00:00.000Z');f.emit(dated,[sale('day',{timestamp:new Date('2026-11-16T01:00:00Z')}),sale('previous'),sale('tomorrow',{timestamp:new Date('2026-11-16T16:00:00Z')})]);assert.deepEqual(f.monitor.state().rows.map(v=>v.id),['day']);assert.throws(()=>f.monitor.setRange('date','2026-02-31'),/valid sales date/);
});
test('Owner controls expose history and switching without adopting a drawer or writing a sale',()=>{
 const f=fixture();f.monitor.start();f.emit(f.callbacks[0],[]);f.emit(f.callbacks[1],[sale('history')]);const html=f.nodes.get('tbTransBody').innerHTML;for(const value of ['data-owner-range','data-owner-sales-date','data-owner-switch','data-owner-refresh'])assert.ok(html.includes(value));assert.equal(f.w.currentShift,null);
});
