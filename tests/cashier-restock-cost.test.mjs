import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {businessClock,stockRequestDue,autoRequestId} from '../Takodeal-POS/branch-operations.js';

// Execute the actual production handlers against synthetic memory-only data.
const main=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8');
function section(start){const at=main.indexOf(start);assert.ok(at>=0,start);const end=main.indexOf('\n};',at);assert.ok(end>at);return main.slice(at,end+3);}
const velocitySource=section('window.calculateBranchVelocity ='),restockSource=section('window.runAutonomousRestockAI =');
const at=new Date('2026-10-30T10:00:00Z');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[+at]));}static now(){return +at;}}
const held=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const snapshot=(h,table,id)=>({ref:h.ref(table,id),id,exists:()=>h.docs.has(table+'/'+id),data:()=>structuredClone(h.get(table+'/'+id))});
function fixture({h=firestoreHarness(),branch='Citygate',clock=at,seed=true}={}){
 if(seed){
  h.put('settings/global_delivery_schedule',{requestDay:5,requestTime:'18:00',requestEnabled:true});
  h.put('inventory/city-stock',{branch:'Citygate',name:'Sauce',currentStock:0,maintainingStock:10,conversionRate:1,purchaseUom:'pack',uom:'pack'});
  h.put('inventory/foreign-stock',{branch:'Maa',name:'Sauce',currentStock:-40,maintainingStock:100,conversionRate:1,uom:'pack'});
  for(let index=0;index<40;index++)h.put('stock_logs/burn-'+index,{branch:'Citygate',item:'Sauce',variance:-1,type:'Sales Deduction',timestamp:new Date('2026-10-29T12:00:00Z')});
 }
 const memory=new Map([['takodeal_device_branch',branch]]),reads=[],alerts=[],errors=[];let hook=async()=>{},manualId=0,transactions=0,transactionReads=0;
 const window={...h.api,restockSchedule:{requestDay:5,requestTime:'18:00',requestEnabled:true},itemVelocityCache:{},
  where:(key,op,value)=>({key,op,value}),limit:n=>({limit:n}),query:(ref,...filters)=>({...ref,filters}),
  getDoc:async ref=>{reads.push({kind:'doc',path:ref.path,returned:1});await hook({table:ref.path.split('/')[0],id:ref.id});return snapshot(h,...ref.path.split('/'));},
  getDocs:async q=>{const entry={kind:'query',table:q.table,filters:q.filters,returned:0};reads.push(entry);await hook(q);
   const filters=q.filters.filter(filter=>filter.key),cap=q.filters.find(filter=>filter.limit)?.limit??Infinity;
   const entries=[...h.docs].filter(([path,row])=>path.startsWith(q.table+'/')&&filters.every(filter=>filter.op==='in'?filter.value.includes(row[filter.key]):filter.op==='>='?row[filter.key]>=filter.value:row[filter.key]===filter.value)).slice(0,cap);
   entry.returned=entries.length;const docs=entries.map(([path])=>snapshot(h,q.table,path.slice(q.table.length+1)));return{docs,empty:!docs.length,forEach:callback=>docs.forEach(callback)};
  },
  runTransaction:(db,callback)=>{transactions++;return h.api.runTransaction(db,tx=>callback({...tx,get:ref=>{transactionReads++;return tx.get(ref);}}));}
 };
 const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},context={window,document:{getElementById:()=>null},localStorage:storage,Date:FixedDate,Math,Number,parseFloat,Promise,
  crypto:{randomUUID:()=>{manualId++;return 'sample-manual-'+manualId;}},businessClock:()=>businessClock(clock),stockRequestDue:settings=>stockRequestDue(settings,clock),autoRequestId:branch=>autoRequestId(branch,clock),
  console:{error:(...args)=>errors.push(args.map(String).join(' '))},Swal:{fire:(...args)=>{alerts.push(args);return Promise.resolve({});}}
 };
 vm.runInNewContext(velocitySource+'\n'+restockSource,context);
 return{h,window,reads,alerts,errors,memory,run:window.runAutonomousRestockAI,setHook:value=>{hook=value;},transactions:()=>transactions,transactionReads:()=>transactionReads,manualIds:()=>manualId};
}
const pending=(h,status='Pending',id='existing',branch='Citygate')=>h.put('purchase_orders/'+id,{branch,status,items:[{name:'Existing request',qty:99}]});
const queries=(f,table)=>f.reads.filter(row=>row.kind==='query'&&row.table===table);
const orders=h=>[...h.docs].filter(([path])=>path.startsWith('purchase_orders/'));

for(const status of ['Pending','Drafting','Delayed'])test(status+' request needs one bounded existence query and skips all forecasting data and writes',async()=>{
 const f=fixture();for(let index=0;index<25;index++)pending(f.h,status,'pending-'+index);const before=structuredClone([...f.h.docs]);
 await f.run();assert.equal(f.reads.length,1);assert.equal(f.reads[0].table,'purchase_orders');assert.equal(f.reads[0].returned,1);assert.equal(f.reads[0].filters.find(filter=>filter.limit)?.limit,1);
 assert.equal(queries(f,'stock_logs').length,0);assert.equal(queries(f,'inventory').length,0);assert.equal(f.transactions(),0);assert.deepEqual([...f.h.docs],before);assert.equal(f.window.restockRequestRunning,false);
 assert.equal(f.memory.has('takodeal_ai_restock_Citygate'),false,'an existing PO must not fabricate the daily creation lock');assert.deepEqual(f.errors,[]);
});

test('manual suppression preserves the Queue Full message and never downloads unused logs or inventory',async()=>{
 const f=fixture();pending(f.h);await f.run(true);assert.equal(f.reads.length,1);assert.equal(f.alerts.length,1);assert.equal(f.alerts[0][0],'Queue Full');assert.equal(f.transactions(),0);
});

test('another branch or a completed request does not suppress a fresh forecast and the final pending check remains bounded',async()=>{
 const f=fixture();pending(f.h,'Pending','maa','Maa');pending(f.h,'Received','finished');const stock=structuredClone(f.h.get('inventory/city-stock'));
 await f.run();assert.deepEqual(f.reads.map(row=>row.table||row.path),['purchase_orders','stock_logs','inventory','settings/global_delivery_schedule','purchase_orders']);
 assert.equal(queries(f,'purchase_orders').length,2);assert.ok(queries(f,'purchase_orders').every(row=>row.filters.find(filter=>filter.limit)?.limit===1));
 const saved=f.h.get('purchase_orders/'+autoRequestId('Citygate',at));assert.equal(saved.type,'AI Weekly Auto Forecast');assert.equal(saved.items[0].rawQty,10);assert.equal(saved.items[0].qty,10);assert.equal(saved.items[0].dailyBurnPurch,(40/14).toFixed(2));assert.equal(saved.requestDay,businessClock(at).day);
 assert.deepEqual(f.h.get('inventory/city-stock'),stock);assert.equal(f.h.get('inventory/foreign-stock').currentStock,-40);assert.equal(f.transactions(),1);assert.equal(f.transactionReads(),2);assert.equal(f.memory.get('takodeal_ai_restock_Citygate'),businessClock(at).day);
});

test('automatic timing, disabled configuration, local daily lock and Main Office still cause no network reads',async()=>{
 const early=fixture({clock:new Date('2026-10-30T09:59:00Z')});await early.run();assert.equal(early.reads.length,0);
 const disabled=fixture();disabled.window.restockSchedule.requestEnabled=false;await disabled.run();assert.equal(disabled.reads.length,0);
 const locked=fixture();locked.memory.set('takodeal_ai_restock_Citygate',businessClock(at).day);await locked.run();assert.equal(locked.reads.length,0);
 const hq=fixture({branch:'Main Office'});await hq.run(true);assert.equal(hq.reads.length,0);
});

test('concurrent timer calls share one physical suppression query and all callers await the same evaluation',async()=>{
 const f=fixture(),gate=held();pending(f.h);f.setHook(q=>q.table==='purchase_orders'?gate.promise:Promise.resolve());
 const first=f.run(),others=Array.from({length:15},()=>f.run());assert.ok(others.every(work=>work===first));assert.equal(f.window.restockRequestRunning,true);
 await Promise.resolve();assert.equal(f.reads.length,1);gate.resolve();await Promise.all([first,...others]);assert.equal(f.reads.length,1);assert.equal(f.transactions(),0);assert.equal(f.window.restockRequestFlight,null);
});

test('concurrent manual callers share one force run while automatic calls do not add a second forecast',async()=>{
 const f=fixture(),gate=held();f.setHook(q=>q.table==='purchase_orders'&&queries(f,'purchase_orders').length===1?gate.promise:Promise.resolve());
 const first=f.run(true),other=f.run(true),automatic=f.run();assert.equal(first,other);assert.equal(first,automatic);gate.resolve();await Promise.all([first,other,automatic]);
 assert.equal(orders(f.h).length,1);assert.equal(orders(f.h)[0][1].type,'Manual Forecast');assert.equal(f.manualIds(),1);assert.equal(queries(f,'stock_logs').length,1);assert.equal(queries(f,'inventory').length,1);assert.equal(f.transactions(),1);
});

test('a manual request during an automatic evaluation gets one fresh force check afterward instead of being discarded or becoming an automatic request',async()=>{
 const f=fixture(),gate=held();f.h.put('settings/global_delivery_schedule',{requestDay:5,requestTime:'18:00',requestEnabled:false});
 f.setHook(q=>q.table==='purchase_orders'&&queries(f,'purchase_orders').length===1?gate.promise:Promise.resolve());
 const automatic=f.run(),manual=f.run(true),secondManual=f.run(true);assert.equal(manual,secondManual);assert.notEqual(manual,automatic);gate.resolve();await Promise.all([automatic,manual,secondManual]);
 assert.equal(orders(f.h).length,1);assert.equal(orders(f.h)[0][1].type,'Manual Forecast');assert.equal(queries(f,'stock_logs').length,2);assert.equal(f.manualIds(),1);assert.equal(f.transactions(),1);assert.deepEqual(f.errors,[]);
});

test('a queued manual request observes the PO just created by its automatic predecessor and reports Queue Full without rescanning stock',async()=>{
 const f=fixture(),gate=held();f.setHook(q=>q.table==='purchase_orders'&&queries(f,'purchase_orders').length===1?gate.promise:Promise.resolve());
 const automatic=f.run(),manual=f.run(true);gate.resolve();await Promise.all([automatic,manual]);assert.equal(orders(f.h).length,1);assert.equal(queries(f,'stock_logs').length,1);assert.equal(queries(f,'inventory').length,1);assert.equal(queries(f,'purchase_orders').length,3);assert.ok(f.alerts.some(args=>args[0]==='Queue Full'));assert.equal(f.manualIds(),0);
});

test('a queued manual request cannot silently move to another branch after the tablet setup changes',async()=>{
 const f=fixture(),gate=held();pending(f.h);f.setHook(q=>q.table==='purchase_orders'?gate.promise:Promise.resolve());
 const automatic=f.run(),manual=f.run(true);f.memory.set('takodeal_device_branch','Maa');gate.resolve();await Promise.all([automatic,manual]);assert.equal(f.reads.length,1);assert.equal(f.transactions(),0);assert.equal(f.manualIds(),0);
});

test('a pending PO that arrives while forecasting is still caught by the original final fresh check',async()=>{
 const f=fixture();f.setHook(async q=>{if(q.table==='inventory')pending(f.h,'Pending','another-tablet');});await f.run(true);
 assert.equal(queries(f,'purchase_orders').length,2);assert.equal(f.transactions(),0);assert.equal(orders(f.h).length,1);assert.equal(f.alerts[0][0],'Queue Full');
});

test('failed suppression reads do not authorize forecasting and a later explicit retry is fresh',async()=>{
 const f=fixture();f.setHook(async()=>{throw Error('Synthetic network failure');});await f.run();assert.equal(f.reads.length,1);assert.equal(f.transactions(),0);assert.equal(f.window.restockRequestRunning,false);assert.match(f.errors[0],/Synthetic network failure/);
 f.setHook(async()=>{});pending(f.h);await f.run();assert.equal(f.reads.length,2);assert.equal(queries(f,'stock_logs').length,0);assert.equal(f.window.restockRequestFlight,null);
});

test('a lost commit acknowledgment preserves one request and the next retry checks it without rereading stock history',async()=>{
 const f=fixture();f.h.loseNextAck();await f.run();assert.equal(orders(f.h).length,1);assert.equal(f.memory.has('takodeal_ai_restock_Citygate'),false);const count=f.reads.length;
 await f.run();assert.equal(f.reads.length,count+1);assert.equal(queries(f,'stock_logs').length,1);assert.equal(queries(f,'inventory').length,1);assert.equal(f.transactions(),1);assert.equal(orders(f.h).length,1);
});

test('the shared daily transaction lock still prevents recreation after request deletion or another tablet winning',async()=>{
 const f=fixture();f.h.put('settings/restock_request_Citygate',{branch:'Citygate',lastRequestDay:businessClock(at).day,requestId:'old-deleted-request'});await f.run();assert.equal(orders(f.h).length,0);assert.equal(f.transactions(),1);assert.equal(f.memory.get('takodeal_ai_restock_Citygate'),businessClock(at).day);
 const h=firestoreHarness(),first=fixture({h}),second=fixture({h,seed:false});await Promise.all([first.run(),second.run()]);assert.equal(orders(h).length,1);assert.equal(h.get('settings/restock_request_Citygate').lastRequestDay,businessClock(at).day);
});
