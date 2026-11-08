import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as details from '../Customer/customer-order-details.js';
const source=readFileSync(new URL('../Customer/index.html',import.meta.url),'utf8');
const section=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from,'Actual Customer section: '+start);return source.slice(from,to);};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const snapshot=rows=>({empty:rows.length===0,docs:rows.map(({docId,...row})=>({id:docId||row.id,data:()=>row})),forEach(callback){this.docs.forEach(callback);}});
const user=(key='a')=>({uid:key,email:key+'@example.invalid',displayName:'Customer '+key});
const order=(patch={})=>({docId:'order-a',orderCode:'SAMPLE-A',customerEmail:user().email,branch:'Sample Branch',status:'mobile_queue',orderType:'Takeout',timestamp:new Date('2026-11-08T10:00:00+08:00'),totalAmount:190,items:[{name:'Sample Takoyaki 6 Pcs',quantity:2,price:80,lineTotalFinal:190,variantName:'Standard',addons:{Cheese:{name:'Cheese',qty:1,price:15,linkedIngredient:'PRIVATE RECIPE LINK',deductQty:5}},notes:'Sample less sauce'}],...patch});
function harness(){
 const nodes=new Map(),subscriptions=[],reads=[],writes=[],intervals=new Map(),timeouts=new Map();let sequence=0,authChanged;
 const node=id=>{
  if(!nodes.has(id)){const classes=new Set(['hidden']);let html='',text='';nodes.set(id,{id,value:'',dataset:{},style:{},disabled:false,open:false,src:'',
   get innerHTML(){return html;},set innerHTML(value){html=String(value);text='';},get textContent(){return text||html;},set textContent(value){text=String(value);html='';},get innerText(){return text||html;},set innerText(value){text=String(value);html='';},
   classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),contains:value=>classes.has(value),toggle(value,force){if(force===true||force===undefined&&!classes.has(value)){classes.add(value);return true;}classes.delete(value);return false;}},
   setAttribute(name,value){this[name]=String(value);},removeAttribute(name){delete this[name];},addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}});}
  return nodes.get(id);
 };
 const document={getElementById:node,querySelectorAll:()=>[],createElement:tag=>node('generated-'+tag+'-'+(++sequence))};
 const api={db:{},auth:{},collection:(_db,table)=>({table}),query:(ref,...filters)=>({...ref,filters}),where:(field,op,value)=>({field,op,value}),
  onSnapshot:(query,next,error)=>{const sub={query,next,error,stops:0};subscriptions.push(sub);return()=>sub.stops++;},
  getDocs:async query=>{reads.push(query);return h.read?await h.read(query):snapshot(query.table==='incoming_orders'?h.historyRows:[]);},
  updateDoc:async(...args)=>writes.push(args),addDoc:async(...args)=>writes.push(args),serverTimestamp:()=>new Date(),
  onAuthStateChanged:(_auth,callback)=>{authChanged=callback;},
  setInterval:(callback,delay)=>{const id=++sequence;intervals.set(id,{callback,delay});return id;},clearInterval:id=>intervals.delete(id),
  setTimeout:(callback,delay)=>{const id=++sequence;timeouts.set(id,{callback,delay});return id;},clearTimeout:id=>timeouts.delete(id)};
 const window={currentUser:null,addEventListener(){},promptReview(){},playReadyAlert(){}};
 const context=vm.createContext({...api,...details,window,document,Date,console:{error(){},warn(){},log(){}},Swal:{getPopup:()=>null,close(){},fire:async()=>({})}});
 const h={window,document,node,nodes,subscriptions,reads,writes,intervals,timeouts,historyRows:[],read:null,auth:value=>authChanged(value),emit:(sub,rows)=>sub.next(snapshot(rows)),allText:()=>[...nodes.values()].map(row=>row.innerHTML+' '+row.innerText).join('\n')};
 vm.runInContext(section('window.customerTrackerEpoch = 0;','window.rawMenuCache = []'),context);
 vm.runInContext(section('window.startOrderTracker = function(email)','window.promptReview = function'),context);
 vm.runInContext(section('window.renderUserProfile = async function','window.logoutCustomer = async function'),context);
 return h;
}
test('actual live tracker renders saved current-order details and refreshes snapshot quantities without extra reads or writes',()=>{
 const h=harness();h.auth(user());const sub=h.subscriptions[0];assert.equal(sub.query.filters[0].field,'customerEmail');assert.equal(sub.query.filters[0].value,user().email);
 h.emit(sub,[order()]);assert.match(h.allText(),/Sample Takoyaki 6 Pcs/);assert.match(h.allText(),/Cheese/);assert.match(h.allText(),/less sauce/);assert.match(h.allText(),/190\.00/);assert.doesNotMatch(h.allText(),/PRIVATE RECIPE LINK|deductQty/);
 h.emit(sub,[order({items:[{name:'Updated saved meal',quantity:1,price:90,lineTotalFinal:90,addons:{}}],totalAmount:90})]);assert.match(h.allText(),/Updated saved meal/);assert.doesNotMatch(h.allText(),/Sample Takoyaki 6 Pcs|less sauce/);assert.equal(h.reads.length,0);assert.equal(h.writes.length,0);assert.equal(h.subscriptions.length,1);
});
test('empty, completed and rejected snapshots clear previously rendered details and active order identity',()=>{
 for(const rows of [[],[order({status:'completed',reviewPrompted:true})],[order({status:'rejected'})]]){const h=harness();h.auth(user());const sub=h.subscriptions[0];h.emit(sub,[order()]);h.emit(sub,rows);assert.doesNotMatch(h.allText(),/Sample Takoyaki 6 Pcs|less sauce/);assert.equal(h.window.activeTrackedOrderId,null);assert.equal(h.reads.length+h.writes.length,0);}
});
test('sign-out and a different-account switch clear details and reject stale snapshot and countdown callbacks',()=>{
 for(const next of [null,user('b')]){const h=harness();h.auth(user());const old=h.subscriptions[0];h.emit(old,[order({status:'preparing',acceptedAt:new Date(),prepTime:10})]);const callbacks=[...h.intervals.values(),...h.timeouts.values()].map(row=>row.callback);h.auth(next);assert.doesNotMatch(h.allText(),/Sample Takoyaki 6 Pcs|less sauce/);assert.equal(old.stops,1);callbacks.forEach(callback=>callback());h.emit(old,[order()]);assert.doesNotMatch(h.allText(),/Sample Takoyaki 6 Pcs|less sauce/);assert.equal(h.window.activeTrackedOrderId,null);assert.equal(h.reads.length+h.writes.length,0);}
});
test('a replaced same-email account with a different UID cannot reuse old details or listener callbacks',()=>{
 const h=harness();h.auth(user());const old=h.subscriptions[0];h.emit(old,[order()]);h.auth({...user(),uid:'different-uid'});h.emit(old,[order({items:[{name:'Stale private item',quantity:1,price:5,lineTotalFinal:5}]})]);assert.doesNotMatch(h.allText(),/Stale private item|Sample Takoyaki 6 Pcs/);assert.equal(old.stops,1);assert.equal(h.subscriptions.length,2);
});
test('tracker filters exact current customer ownership and keeps the canonical Firestore document identity',()=>{
 const h=harness();h.auth(user());h.emit(h.subscriptions[0],[order({docId:'canonical-order',id:'forged-id'}),order({docId:'other-customer',customerEmail:user('b').email,timestamp:new Date('2026-11-09T10:00:00+08:00'),items:[{name:'Other private meal',quantity:1,price:1,lineTotalFinal:1}]})]);assert.equal(h.window.activeTrackedOrderId,'canonical-order');assert.match(h.allText(),/Sample Takoyaki 6 Pcs/);assert.doesNotMatch(h.allText(),/Other private meal/);assert.equal(h.reads.length+h.writes.length,0);
});
test('a live subscription error clears current details instead of leaving a stale order summary',()=>{
 const h=harness();h.auth(user());const sub=h.subscriptions[0];h.emit(sub,[order()]);sub.error(Error('Synthetic read denied'));assert.doesNotMatch(h.allText(),/Sample Takoyaki 6 Pcs|less sauce/);assert.equal(h.window.activeTrackedOrderId,null);assert.equal(sub.stops,1);assert.equal(h.reads.length+h.writes.length,0);
});
test('actual profile history shows own saved delivery details and totals while excluding payment references, contact and recipe internals',async()=>{
 const h=harness();h.auth(user());h.historyRows=[order({status:'completed',deliveryFee:39,totalAmount:229,orderType:'Delivery',paymentReference:'PRIVATE PAYMENT',contactNumber:'PRIVATE PHONE',deliveryAddress:'Own saved delivery address'})];await h.window.renderUserProfile();const html=h.node('orderHistoryList').innerHTML;assert.match(html,/Sample Takoyaki 6 Pcs/);assert.match(html,/Cheese/);assert.match(html,/less sauce/);assert.match(html,/Own saved delivery address/);assert.match(html,/229\.00/);assert.doesNotMatch(html,/PRIVATE PAYMENT|PRIVATE PHONE|PRIVATE RECIPE LINK|a@example\.invalid/);assert.deepEqual(h.reads.map(row=>row.table),['incoming_orders','reviews']);assert.equal(h.writes.length,0);
});
test('pickup history does not show an irrelevant saved delivery address or delivery fee',async()=>{
 const h=harness();h.auth(user());h.historyRows=[order({deliveryAddress:'Old unused delivery address',deliveryFee:39})];await h.window.renderUserProfile();const html=h.node('orderHistoryList').innerHTML;assert.match(html,/Takeout/);assert.doesNotMatch(html,/Old unused delivery address|Delivery fee/);assert.equal(h.writes.length,0);
});
test('profile history excludes foreign rows and escapes hostile saved item and order text',async()=>{
 const h=harness();h.auth(user());h.historyRows=[order({orderCode:'<img onerror=bad()>',items:[{name:'<svg onload=bad()>',quantity:1,price:1,lineTotalFinal:1,addons:{},notes:'<script>private()</script>'}]}),order({docId:'foreign',customerEmail:user('b').email,items:[{name:'Other private history',quantity:1,price:2,lineTotalFinal:2}]})];await h.window.renderUserProfile();const html=h.node('orderHistoryList').innerHTML;assert.doesNotMatch(html,/<img|<svg|<script|Other private history/);assert.match(html,/&lt;svg/);assert.match(html,/&lt;img/);assert.equal(h.writes.length,0);
});
test('a delayed history read cannot render previous-account details after sign-out or account replacement',async()=>{
 for(const next of [null,user('b')]){const h=harness(),gate=deferred();h.auth(user());h.read=query=>query.table==='incoming_orders'?gate.promise:Promise.resolve(snapshot([]));const pending=h.window.renderUserProfile();h.auth(next);gate.resolve(snapshot([order()]));await pending;assert.doesNotMatch(h.node('orderHistoryList').innerHTML,/Sample Takoyaki|less sauce/);assert.equal(h.writes.length,0);}
});
test('a delayed loyalty read cannot reveal already fetched old order details after an account switch',async()=>{
 const h=harness(),gate=deferred();h.auth(user());h.read=query=>query.table==='reviews'?gate.promise:Promise.resolve(snapshot([order()]));const pending=h.window.renderUserProfile();await Promise.resolve();h.auth(user('b'));gate.resolve(snapshot([]));await pending;assert.doesNotMatch(h.node('orderHistoryList').innerHTML,/Sample Takoyaki|less sauce/);assert.equal(h.writes.length,0);
});
test('a current-order refresh keeps its details open while a different saved order starts collapsed',()=>{
 const h=harness();h.auth(user());const sub=h.subscriptions[0];h.emit(sub,[order()]);h.node('trackerDetails').open=true;h.emit(sub,[order({totalAmount:200})]);assert.equal(h.node('trackerDetails').open,true);h.emit(sub,[order({docId:'new-order',orderCode:'SAMPLE-NEW'})]);assert.equal(h.node('trackerDetails').open,false);assert.equal(h.node('trackerOrderSummary').dataset.orderId,'new-order');assert.equal(h.reads.length+h.writes.length,0);
});
test('actual history and current tracker show unavailable malformed amounts rather than invented zeroes',async()=>{
 const bad=order({totalAmount:'190oops',items:[{name:'Malformed amount sample',quantity:false,price:null,lineTotalFinal:'Infinity',addons:{}}]}),h=harness();h.auth(user());h.emit(h.subscriptions[0],[bad]);const current=h.node('trackerOrderSummary').innerHTML;assert.match(current,/Not available/);assert.doesNotMatch(current,/₱0\.00|NaN|Infinity/);h.historyRows=[bad];await h.window.renderUserProfile();const history=h.node('orderHistoryList').innerHTML;assert.match(history,/Not available/);assert.doesNotMatch(history,/₱0\.00|NaN|Infinity/);h.emit(h.subscriptions[0],[order({totalAmount:0,items:[{name:'Free saved sample',quantity:1,price:0,lineTotalFinal:0}]})]);assert.match(h.node('trackerOrderSummary').innerHTML,/₱0\.00/);assert.equal(h.writes.length,0);
});
