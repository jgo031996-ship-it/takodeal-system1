import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { firestoreHarness } from './helpers/firestore-harness.mjs';
import { mallCashPlan, mallOpeningCash, mallFinalShiftHint, stockRequestDue, autoRequestId, businessClock, archiveableShift } from '../takodeal-manager/branch-operations.js';
import { closeShiftAtomic, readMallOpeningCash, approveRemittanceAtomic } from '../takodeal-manager/cash-settlement.js';
import { confirmMallDailyClose } from '../takodeal-manager/shift-close-ui.js';
import { commitDispatch, transitionDispatch, receiveDispatch } from '../takodeal-manager/dispatch-safety.js';
import { createCollectionCache } from '../takodeal-manager/collection-cache.js';
import { reconcileOrder, renderFinancialFlow } from '../takodeal-manager/manager-workspace.js';
import { menuCsv, validateMenuCsv, parseCsv } from '../takodeal-manager/menu-bulk.js';

test('earlier mall shifts carry all counted cash; only the final daily close remits accumulated cash',async()=> {
    const h=environment();await closeShiftAtomic(h.api,{...closing,isFinalShiftOfDay:false});
    const first=h.get('shifts/one');assert.equal(first.retainedCash,7500);assert.equal(first.remittedCash,0);assert.equal(first.isFinalShiftOfDay,false);assert.equal(h.get('remittances/mall-one'),undefined);
    h.put('shifts/two',{branch:'Citygate',active:true,startingCash:mallOpeningCash(first),isMallBranch:true});
    await closeShiftAtomic(h.api,{...closing,shiftId:'two',declaredCash:8500,totalCashSales:1000,totalDigitalSales:0,digitalBreakdown:{},businessDay:'2026-10-04'});
    assert.equal(h.get('shifts/two').expectedCash,8500);assert.equal(h.get('shifts/two').retainedCash,2000);assert.equal(h.get('remittances/mall-two').amount,6500);assert.equal(h.get('remittances/mall-two').dateStr,'2026-10-04');
    assert.equal(mallOpeningCash(h.get('shifts/two')),2000);assert.equal(h.get('cash_accounts/cash').balance,10000);
});

test('opening cash preserves interim actual counts; a final close resets the next opening',()=> {
    assert.equal(mallOpeningCash(),2000);assert.equal(mallOpeningCash({declaredCash:7500,isFinalShiftOfDay:false}),7500);
    assert.equal(mallOpeningCash({declaredCash:7500,retainedCash:2000}),2000);
    assert.equal(mallOpeningCash({declaredCash:1200,isFinalShiftOfDay:false}),1200);
    assert.equal(mallOpeningCash({declaredCash:8500,retainedCash:2000,isFinalShiftOfDay:true}),2000);
});

const mallSchedule={branchConfig:{Citygate:[{id:'morning',startTime:'10:00',endTime:'19:00',days:[0,1,2,3,4,5,6]},{id:'night',startTime:'12:00',endTime:'21:00',days:[0,1,2,3,4,5,6]}]}};

test('mall opening reads the latest server handover and does not reset an earlier shift to petty cash',async()=> {
    let fetched;
    const api={db:{},collection:(db,table)=>table,where:(...parts)=>parts,orderBy:(...parts)=>parts,limit:value=>value,query:(...parts)=>parts,getDocsFromServer:async query=>{fetched=query;return {docs:[{data:()=>({declaredCash:7500,isFinalShiftOfDay:false})}]};}};
    assert.equal(await readMallOpeningCash(api,'Citygate'),7500);assert.equal(fetched[0],'shifts');assert.deepEqual(fetched[3],['endTime','desc']);assert.equal(fetched[4],1);
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8'),start=source.indexOf('window.openNewShift ='),end=source.indexOf('\n};',start)+3;
    let created;const window={db:{},collection:()=>({}),serverTimestamp:()=>1,addDoc:async(ref,data)=>{created=data;return {id:'new'};}};
    vm.runInNewContext(source.slice(start,end),{window,MALL_FLOAT:2000,readBranchPolicy:async()=>({isMallBranch:true}),readMallOpeningCash:async()=>7500,Number,localStorage:{getItem:()=>null},console});
    await window.openNewShift('Citygate','Test',2000);assert.equal(created.startingCash,7500);assert.equal(created.isMallBranch,true);
});

test('owner-reviewed mall settlement preserves interim cash and only final closure creates a guarded pending remittance',async()=> {
    const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('  async function settleClearance('),end=source.indexOf('  async function refresh()',start);
    for (const final of [false,true]) {
        let committed;
        const snapshot=(path,data)=>({id:path.split('/').at(-1),ref:{path},exists:()=>data!==undefined,data:()=>data});
        const docs=new Map([['shifts/one',{branch:'Citygate',active:true,isMallBranch:true,startingCash:2000,startTime:new Date('2026-10-04T02:00:00Z')}],['cashier_presence/device',{pendingSales:0,pendingOperations:0,accepting:false}],['pos_operation_commits/review',{state:'owner_review'}]]);
        const window={db:{},auth:{currentUser:{email:'owner@example.com'}},collection:(db,table)=>({table}),where:(key,op,value)=>({key,value}),query:(query)=>query,Swal:{fire:async()=>({isConfirmed:true})}};
        const context={window,doc:path=>({path}),tkOwnerDoc:async ref=>snapshot(ref.path,docs.get(ref.path)),tkOwnerDocs:async query=>{
            const rows=query.table==='pos_bindings'?[snapshot('pos_bindings/device',{})]:query.table==='branches'?[snapshot('branches/city',{isMallBranch:true})]:query.table==='expenses'?[snapshot('expenses/fund',{amount:100,paidFrom:'Manager Fund'})]:[];
            return {docs:rows,empty:!rows.length,size:rows.length};
        },fresh:()=>true,tkEncode:value=>value,tkFingerprint:async()=> 'fingerprint',tkCommitOperation:async record=>{committed=record;},adapter:{},mallCashPlan,businessClock,confirmMallDailyClose:async()=>({isFinalShiftOfDay:final,businessDay:'2026-10-04'}),Date,Number,Object,Math};
        vm.runInNewContext(source.slice(start,end)+'\nwindow.testSettle=settleClearance;',context);
        await window.testSettle({id:'review',branch:'Citygate',evidence:{shiftId:'one',declaredCash:7500},acceptedAt:{toDate:()=>new Date('2026-10-04T13:00:00Z')}},'Checked');
        const shift=committed.writes.find(write=>write.path==='shifts/one').data,remit=committed.writes.find(write=>write.path==='remittances/mall-one');
        assert.equal(shift.cashOut,0);assert.equal(shift.isFinalShiftOfDay,final);assert.equal(shift.retainedCash,final?2000:7500);
        if (final) { assert.equal(remit.data.amount,5500);assert.equal(remit.data.status,'Pending');assert.equal(committed.guards.find(guard=>guard.path==='remittances/mall-one').exists,false); } else assert.equal(remit,undefined);
    }
});
test('final daily close follows branch configuration times, active days and saved assignments',()=> {
    const started=new Date('2026-10-04T02:00:00Z');
    assert.equal(mallFinalShiftHint(mallSchedule,'Citygate',started,new Date('2026-10-04T11:00:00Z')).final,false);
    assert.equal(mallFinalShiftHint(mallSchedule,'Citygate',started,new Date('2026-10-04T13:00:00Z')).final,true);
    const changed=structuredClone(mallSchedule);changed.branchConfig.Citygate[1].endTime='23:30';
    assert.equal(mallFinalShiftHint(changed,'Citygate',started,new Date('2026-10-04T13:00:00Z')).final,false);
    assert.equal(mallFinalShiftHint(changed,'Citygate',started,new Date('2026-10-04T15:30:00Z')).final,true);
    changed.branchConfig.Citygate[1].active=false;assert.equal(mallFinalShiftHint(changed,'Citygate',started,new Date('2026-10-04T11:00:00Z')).final,true);
    changed.branchConfig.Citygate[1].active=true;changed.branchConfig.Citygate[1].days=[1];assert.equal(mallFinalShiftHint(changed,'Citygate',started,new Date('2026-10-04T11:00:00Z')).final,true);
    const assigned={...mallSchedule,currentYear:2026,currentMonth:10,currentSchedule:{4:{Citygate:{scheduled:{morning:'Test'}}}}};
    assert.equal(mallFinalShiftHint(assigned,'Citygate',started,new Date('2026-10-04T11:00:00Z')).final,true);
    assert.equal(mallFinalShiftHint(mallSchedule,'Unknown',started).closingTime,null);
});

test('overnight and legacy closing times remain attached to the starting business day',()=> {
    const schedule={branchConfig:{Maa:[{id:'night',name:'Night (8pm-2am)'}]}},started=new Date('2026-10-04T12:00:00Z');
    assert.deepEqual(mallFinalShiftHint(schedule,'Maa',started,new Date('2026-10-04T17:59:00Z')),{final:false,closingTime:'02:00 next day',businessDay:'2026-10-04'});
    assert.equal(mallFinalShiftHint(schedule,'Maa',started,new Date('2026-10-04T18:00:00Z')).final,true);
});

test('daily-close dialog reads live schedule, honors the selected closing stage, and cancellation stops',async()=> {
    let options;const api={db:{},doc:()=>({path:'settings/global_schedule'}),getDocFromServer:async()=>({exists:()=>true,data:()=>mallSchedule}),document:{getElementById:()=>({value:'earlier'})},Swal:{fire:async value=>{options=value;return {isConfirmed:true,value:value.preConfirm()};}}};
    const input={branch:'Citygate',started:new Date('2026-10-04T02:00:00Z'),declaredCash:7500};
    assert.equal((await confirmMallDailyClose(api,input)).isFinalShiftOfDay,false);assert.match(options.html,/21:00/);assert.match(options.html,/₱5,500.00/);
    api.document.getElementById=()=>({value:'final'});assert.equal((await confirmMallDailyClose(api,input)).isFinalShiftOfDay,true);
    api.Swal.fire=async()=>({isConfirmed:false});assert.equal(await confirmMallDailyClose(api,input),null);
    api.getDocFromServer=async()=>{throw Error('offline')};await assert.rejects(confirmMallDailyClose(api,input),/offline/);
});

test('delivery-date broadcasts preserve editable request day, time and enabled settings',async()=> {
    const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.broadcastDeliveryDate ='),end=source.indexOf('\n};',start)+3;
    let settings={requestDay:4,requestTime:'17:30',requestEnabled:false};
    const window={sessionUser:{cashierName:'Test'}},button={innerText:'Broadcast',disabled:false};
    vm.runInNewContext(source.slice(start,end),{window,db:{},doc:()=>({}),setDoc:async(ref,data,options)=>{settings=options?.merge?{...settings,...data}:data;},serverTimestamp:()=>1,document:{getElementById:id=>id==='fcTargetDate'?{value:'2026-10-08'}:button},Swal:{fire:()=>{}},console});
    await window.broadcastDeliveryDate();assert.equal(settings.requestDay,4);assert.equal(settings.requestTime,'17:30');assert.equal(settings.requestEnabled,false);assert.equal(settings.nextDeliveryDate,'2026-10-08');
});

function environment() {
    const h=firestoreHarness();h.api.getDocs=h.api.getDocsFromServer;
    h.put('branches/mall',{name:'Citygate',isMallBranch:true});
    h.put('shifts/one',{branch:'Citygate',active:true,startingCash:2000,isMallBranch:true});
    h.put('cash_accounts/cash',{branch:'Main Office',name:'Cash',balance:10000});
    h.put('cash_accounts/grab',{branch:'Main Office',name:'Grab',balance:100});
    return h;
}
const closing = {isFinalShiftOfDay:true,shiftId:'one',branch:'Citygate',cashier:'Test',declaredCash:7500,totalCashSales:5500,totalDigitalSales:400,digitalBreakdown:{Grab:400},physicalStockCount:[],shiftIngredientBurn:{Sauce:50},variance:0,cashOut:0,closing:{physicalStockCount:[],cashBreakdown:{}}};
test('mall float retains only actual cash and reports float shortage without inventing money',()=> {
    assert.deepEqual(mallCashPlan(7500),{startingCash:2000,retainedCash:2000,remittedCash:5500,floatShortage:0});
    assert.deepEqual(mallCashPlan(1200),{startingCash:2000,retainedCash:1200,remittedCash:0,floatShortage:800});
    assert.throws(()=>mallCashPlan(-1));assert.throws(()=>mallCashPlan(NaN));
});
test('scheduled requests use Philippine day/time and do not run early, disabled, or on another day',()=> {
    const before=new Date('2026-10-08T09:59:00Z'),due=new Date('2026-10-08T10:00:00Z');
    assert.equal(stockRequestDue({},before),false);assert.equal(stockRequestDue({},due),true);
    assert.equal(stockRequestDue({requestEnabled:false},due),false);
    assert.equal(stockRequestDue({requestDay:1,requestTime:'11:30'},new Date('2026-10-12T03:30:00Z')),true);
    assert.equal(stockRequestDue({requestTime:'25:00'},due),false);
    assert.equal(businessClock(new Date('2026-10-08T17:00:00Z')).day,'2026-10-09');
    assert.equal(autoRequestId('Citygate',due),autoRequestId('Citygate',new Date('2026-10-08T14:00:00Z')));
    assert.notEqual(autoRequestId('Citygate',due),autoRequestId('Maa',due));
});
test('20 concurrent mall closures produce one pending remittance, one sweep, and one burn log',async()=> {
    const h=environment();await Promise.all(Array.from({length:20},()=>closeShiftAtomic(h.api,closing)));
    assert.equal(h.get('shifts/one').status,'Closed');assert.equal(h.get('shifts/one').expectedCash,7500);
    assert.equal(h.get('shifts/one').retainedCash,2000);assert.equal(h.get('remittances/mall-one').amount,5500);
    assert.equal(h.get('remittances/mall-one').status,'Pending');assert.equal(h.get('cash_accounts/cash').balance,10000);
    assert.equal(h.get('cash_accounts/grab').balance,500);
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('stock_logs/')).length,1);
    assert.equal([...h.docs.keys()].filter(k=>k.includes('Manager Fund')).length,0);
});
test('failed settlement leaves the shift, balances, and remittance unchanged; lost acknowledgement can retry',async()=> {
    const h=environment();h.failNextCommit();await assert.rejects(closeShiftAtomic(h.api,closing),/rejected/);
    assert.equal(h.get('shifts/one').active,true);assert.equal(h.get('cash_accounts/grab').balance,100);assert.equal(h.get('remittances/mall-one'),undefined);
    h.loseNextAck();await assert.rejects(closeShiftAtomic(h.api,closing),/lost/);await closeShiftAtomic(h.api,closing);
    assert.equal(h.get('cash_accounts/grab').balance,500);
});
test('ordinary branches preserve carry cash and create no mall remittance',async()=> {
    const h=environment();h.put('branches/mall',{name:'Citygate',isMallBranch:false});h.put('shifts/one',{branch:'Citygate',active:true,startingCash:2000,isMallBranch:false});
    await closeShiftAtomic(h.api,closing);assert.equal(h.get('remittances/mall-one'),undefined);assert.equal(h.get('shifts/one').retainedCash,undefined);
});
test('duplicate platform accounts prevent all settlement writes',async()=> {
    const h=environment();h.put('cash_accounts/grab-copy',{branch:'Main Office',name:'Grab',balance:1});
    await assert.rejects(closeShiftAtomic(h.api,closing),/Duplicate/);assert.equal(h.get('shifts/one').active,true);
});
test('remittance reception credits once through contention and acknowledgement loss',async()=> {
    const h=environment();await closeShiftAtomic(h.api,closing);h.loseNextAck();
    await assert.rejects(approveRemittanceAtomic(h.api,'mall-one',h.ref('cash_accounts','cash'),'Owner'),/lost/);
    await Promise.all(Array.from({length:20},()=>approveRemittanceAtomic(h.api,'mall-one',h.ref('cash_accounts','cash'),'Owner')));
    assert.equal(h.get('cash_accounts/cash').balance,15500);assert.equal(h.get('remittances/mall-one').status,'Received');
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('account_logs/remittance-')).length,1);
});
function deliveryEnvironment() {
    const h=environment();h.put('inventory/hq',{branch:'Main Office',name:'Fork',currentStock:100,uom:'piece'});h.put('inventory/city',{branch:'Citygate',name:'Fork',currentStock:7,uom:'piece'});
    h.put('purchase_orders/request',{branch:'Citygate',status:'Pending',items:[{name:'Fork',qty:30}]});return h;
}
const delivery={id:'batch-one',source:'Main Office',destination:'Citygate',driver:'Test',actor:'Owner',items:[{name:'Fork',qty:20,rawQty:20,physicalStock:0}],purchaseOrderIds:['request']};
test('dispatch is atomic and idempotent; forecasts cannot reset destination stock or add salary deductions',async()=> {
    const h=deliveryEnvironment();await Promise.all(Array.from({length:15},()=>commitDispatch(h.api,delivery)));
    assert.equal(h.get('inventory/hq').currentStock,80);assert.equal(h.get('inventory/city').currentStock,7);
    assert.equal(h.get('dispatch_logs/batch-one-0').status,'In Transit');assert.equal(h.get('purchase_orders/request').status,'Completed');
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('staff_deductions/')).length,0);
});
test('source duplicate, insufficient aggregated stock, and stale requests fail before any writes',async()=> {
    const h=deliveryEnvironment();h.put('inventory/copy',{branch:'Main Office',name:'Fork',currentStock:1});
    await assert.rejects(commitDispatch(h.api,delivery),/duplicate/);h.docs.delete('inventory/copy');
    await assert.rejects(commitDispatch(h.api,{...delivery,items:[{name:'Fork',qty:60},{name:'Fork',qty:60}]}),/Not enough/);
    h.put('purchase_orders/request',{branch:'Citygate',status:'Completed'});
    await assert.rejects(commitDispatch(h.api,delivery),/already processed/);assert.equal(h.get('inventory/hq').currentStock,100);
});
test('partial dispatch preserves remaining quantities and original request marker',async()=> {
    const h=deliveryEnvironment();await commitDispatch(h.api,{...delivery,skipped:[{name:'Fork',qty:10,rawQty:10}]});
    assert.equal(h.get('purchase_orders/delayed-batch-one').items[0].qty,10);assert.equal(h.get('purchase_orders/request').status,'Completed');
});
test('dispatch rejection writes nothing; lost acknowledgement does not send twice',async()=> {
    const h=deliveryEnvironment();h.failNextCommit();await assert.rejects(commitDispatch(h.api,delivery));assert.equal(h.get('inventory/hq').currentStock,100);
    h.loseNextAck();await assert.rejects(commitDispatch(h.api,delivery));await commitDispatch(h.api,delivery);assert.equal(h.get('inventory/hq').currentStock,80);
});
test('collection cache shares simultaneous reads, retains menu for 15 minutes, and invalidation forces a fresh read',async()=> {
    let reads=0,now=0;const cache=createCollectionCache(async()=>{reads++;return [{read:reads}]},{now:()=>now});
    const rows=await Promise.all(Array.from({length:30},()=>cache.get('menu')));assert.equal(reads,1);assert.equal(rows[0],rows[29]);
    now=120000;await cache.get('menu');assert.equal(reads,1);cache.invalidate('menu');await cache.get('menu');assert.equal(reads,2);
    now=1200000;await cache.get('menu');assert.equal(reads,3);
});
test('failed reads retry and invalidation during a read cannot reinsert stale data',async()=> {
    let fail=true,release;const cache=createCollectionCache(async()=>{if(fail)throw Error('offline');return 1;});
    await assert.rejects(cache.get('menu'));fail=false;assert.equal(await cache.get('menu'),1);
    let reads=0;const pending=createCollectionCache(()=>new Promise(resolve=>{reads++;release=resolve;}));const first=pending.get('menu');await Promise.resolve();pending.invalidate('menu');release(1);await first;const second=pending.get('menu');await Promise.resolve();release(2);assert.equal(await second,2);assert.equal(reads,2);
});
test('archive eligibility retains active shifts, today, invalid dates, and latest handovers',()=> {
    const shift={id:'old',status:'Closed',active:false,endTime:new Date('2026-10-01T12:00:00Z')}, options={today:'2026-10-04',latestId:'latest'};
    assert.equal(archiveableShift(shift,options),true);
    for(const changed of [{active:true},{status:'Open'},{id:'latest'},{endTime:new Date('2026-10-04T00:00:00Z')},{endTime:null}])assert.equal(archiveableShift({...shift,...changed},options),false);
});
test('sidebar ordering reconciles removed tabs and new tabs without duplicates; financial values remain readable and rounded',()=> {
    assert.deepEqual(reconcileOrder(['menu','old','menu','accounts'],['dashboard','accounts','menu']),['menu','accounts','dashboard']);
    const html=renderFinancialFlow({totalRevenue:133000,totalCOGS:38933.396,totalPayroll:0,totalOpEx:3820,netProfit:90246.604,expenseBreakdown:{'<script>':3820}});
    assert.match(html,/₱90,246\.60/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('independently hosted apps share identical cash policies and settlement modules',()=> {
    for(const name of ['branch-operations.js','cash-settlement.js','shift-close-ui.js','dispatch-safety.js'])assert.equal(readFileSync(new URL('../Takodeal-POS/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n'),readFileSync(new URL('../takodeal-manager/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
});
test('bulk menu export uses actual BOM rows and round-trips comma/quote/newline names with platform prices',()=> {
    const menu=[{id:'one',name:'Sauce, "special"\nlarge',category:'Takoyaki',price:90,grabPrice:110,foodpandaPrice:115,addons:[]}];
    const bom=[{menuItem:menu[0].name,ingredientName:'Sauce',qty:25}];
    const csv=menuCsv(menu,bom), rows=validateMenuCsv(csv,new Set(['Sauce']));
    assert.equal(rows[0].name,menu[0].name);assert.equal(rows[0].grabPrice,110);assert.equal(rows[0].foodpandaPrice,115);assert.equal(rows[0].recipe[0].qty,25);
    assert.throws(()=>parseCsv('"unclosed'),/quote/);
});
test('bulk imports reject duplicates, missing ingredients and invalid prices before writing',()=> {
    const item={id:'one',name:'A',category:'Food',price:90,addons:[]}, bom=[{menuItem:'A',ingredientName:'Deleted',qty:2}];
    assert.throws(()=>validateMenuCsv(menuCsv([item],bom),new Set()),/Missing ingredient/);
    assert.throws(()=>validateMenuCsv(menuCsv([item,item],[]),new Set()),/duplicate/);
    assert.throws(()=>validateMenuCsv(menuCsv([{...item,price:-1}],[]),new Set()),/prices/);
});
test('franchise supplies are billed once in the same dispatch transaction',async()=> {
    const h=deliveryEnvironment();h.put('branches/mall',{name:'Citygate',isFranchise:true});
    await Promise.all(Array.from({length:8},()=>commitDispatch(h.api,{...delivery,items:[{name:'Fork',qty:20,cost:2}]})));
    assert.equal(h.get('franchise_ledger/supply-batch-one').amount,40);
    assert.equal([...h.docs.keys()].filter(k=>k.startsWith('franchise_ledger/')).length,1);
});
function stockRequestClient(h, clock) {
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8'),start=source.indexOf('window.runAutonomousRestockAI ='),end=source.indexOf('\n};',start)+3;
    const memory=new Map([['takodeal_device_branch','Citygate']]);let reads=0;
    const snapshot=(reference)=>({ref:reference,id:reference.id,exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))});
    const window={...h.api,restockSchedule:{requestDay:5,requestTime:'18:00'},itemVelocityCache:{},calculateBranchVelocity:async()=>{},getDoc:async reference=>{reads++;return snapshot(reference);},getDocs:async query=>{
        reads++;const docs=[...h.docs.keys()].filter(path=>path.startsWith(query.table+'/') && (query.filters || []).every(filter=>Array.isArray(filter.value)?filter.value.includes(h.get(path)[filter.key]):h.get(path)[filter.key]===filter.value)).map(path=>snapshot(h.ref(query.table,path.slice(query.table.length+1))));
        return {docs,empty:docs.length===0,forEach:callback=>docs.forEach(callback)};
    }};
    vm.runInNewContext(source.slice(start,end),{window,Date,Math,Number,parseFloat,crypto:globalThis.crypto,console:{error(){}},document:{getElementById:()=>null},localStorage:{getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},businessClock:()=>businessClock(clock),stockRequestDue:settings=>stockRequestDue(settings,clock),autoRequestId:branch=>autoRequestId(branch,clock)});
    return {run:window.runAutonomousRestockAI,reads:()=>reads};
}
test('actual Cashier scheduler makes no early reads and uses a shared daily lock across tablets and request deletion',async()=> {
    const h=environment();h.put('inventory/city',{branch:'Citygate',name:'Fork',currentStock:0,maintainingStock:10,conversionRate:1,uom:'piece'});
    const early=stockRequestClient(h,new Date('2026-10-09T09:59:00Z'));await early.run();assert.equal(early.reads(),0);
    const a=stockRequestClient(h,new Date('2026-10-09T10:00:00Z')),b=stockRequestClient(h,new Date('2026-10-09T10:00:00Z'));await Promise.all([a.run(),b.run()]);
    assert.equal([...h.docs.keys()].filter(key=>key.startsWith('purchase_orders/')).length,1);
    const requestId=autoRequestId('Citygate',new Date('2026-10-09T10:00:00Z'));assert.equal(h.get('purchase_orders/'+requestId).items[0].physicalStock,undefined);
    h.docs.delete('purchase_orders/'+requestId);const another=stockRequestClient(h,new Date('2026-10-09T11:00:00Z'));await another.run();assert.equal(h.get('purchase_orders/'+requestId),undefined);
});


function receivingEnvironment() {
    const h=deliveryEnvironment();
    h.api.getDocFromServer=async reference=>({exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))});return h;
}
test('delivery returns credit only their original source once, including franchise credit and lost acknowledgments',async()=>{
    const h=receivingEnvironment();h.put('branches/mall',{name:'Citygate',isFranchise:true});
    await commitDispatch(h.api,{id:'return-one',source:'Main Office',destination:'Citygate',driver:'Test',actor:'Test',items:[{name:'Fork',qty:30,cost:2}]});
    h.loseNextAck();await assert.rejects(transitionDispatch(h.api,{ids:['return-one-0'],mode:'return',actor:'Test'}),/lost/);
    await Promise.all(Array.from({length:15},()=>transitionDispatch(h.api,{ids:['return-one-0'],mode:'return',actor:'Test'})));
    assert.equal(h.get('inventory/hq').currentStock,100);assert.equal(h.get('inventory/city').currentStock,7);
    assert.equal(h.get('franchise_ledger/supply-return-return-one-0').amount,60);assert.equal(h.get('dispatch_logs/return-one-0').status,'Backloaded');
    h.docs.delete('dispatch_logs/return-one-0');await commitDispatch(h.api,{id:'return-one',source:'Main Office',destination:'Citygate',driver:'Test',actor:'Test',items:[{name:'Fork',qty:30,cost:2}]});assert.equal(h.get('inventory/hq').currentStock,100);
});
test('arrival and cashier receipt retain existing negative stock, create one receipt, and cannot be returned afterward',async()=>{
    const h=receivingEnvironment();h.put('inventory/city',{branch:'Citygate',name:'Fork',currentStock:-5,uom:'piece'});
    await commitDispatch(h.api,{id:'receipt',source:'Main Office',destination:'Citygate',driver:'Test',actor:'Test',items:[{name:'Fork',qty:30}]});
    await transitionDispatch(h.api,{ids:['receipt-0'],mode:'arrive',actor:'Test'});
    const input={branch:'Citygate',actor:'Cashier',items:[{id:'receipt-0',actualDisplayQty:30,isMissing:false}]};
    h.loseNextAck();await assert.rejects(receiveDispatch(h.api,input),/lost/);await Promise.all(Array.from({length:15},()=>receiveDispatch(h.api,input)));
    assert.equal(h.get('inventory/city').currentStock,25);assert.equal(h.get('dispatch_logs/receipt-0').status,'Received');
    await assert.rejects(transitionDispatch(h.api,{ids:['receipt-0'],mode:'return',actor:'Test'}),/cashier/);assert.equal(h.get('inventory/hq').currentStock,70);
});
test('return and receipt contention cannot create stock at both locations; failures and duplicate stock roll back',async()=>{
    const h=receivingEnvironment();await commitDispatch(h.api,{id:'race',source:'Main Office',destination:'Citygate',driver:'Test',actor:'Test',items:[{name:'Fork',qty:30}]});await transitionDispatch(h.api,{ids:['race-0'],mode:'arrive',actor:'Test'});
    const input={branch:'Citygate',actor:'Cashier',items:[{id:'race-0',actualDisplayQty:30,isMissing:false}]};
    h.failNextCommit();await assert.rejects(receiveDispatch(h.api,input),/rejected/);assert.equal(h.get('inventory/city').currentStock,7);
    h.put('inventory/city-copy',{branch:'Citygate',name:'Fork',currentStock:2});await assert.rejects(receiveDispatch(h.api,input),/Duplicate/);h.docs.delete('inventory/city-copy');
    const results=await Promise.allSettled([receiveDispatch(h.api,input),transitionDispatch(h.api,{ids:['race-0'],mode:'return',actor:'Test'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(h.get('inventory/hq').currentStock+h.get('inventory/city').currentStock,107);
});
test('first delivery to a new branch item clones its source metadata once across tablets',async()=>{
    const h=receivingEnvironment();h.docs.delete('inventory/city');h.put('inventory/hq',{branch:'Main Office',name:'Fork',currentStock:100,uom:'piece',image:'sample.png',baseCost:2});
    await commitDispatch(h.api,{id:'new-stock',source:'Main Office',destination:'Citygate',driver:'Test',actor:'Test',items:[{name:'Fork',qty:30}]});await transitionDispatch(h.api,{ids:['new-stock-0'],mode:'arrive',actor:'Test'});
    await Promise.all(Array.from({length:15},()=>receiveDispatch(h.api,{branch:'Citygate',actor:'Cashier',items:[{id:'new-stock-0',actualDisplayQty:30,isMissing:false}]})));
    const created=[...h.docs.values()].filter(x=>x.branch==='Citygate'&&x.name==='Fork');assert.equal(created.length,1);assert.equal(created[0].currentStock,30);assert.equal(created[0].image,'sample.png');
});
test('Cashier exposes each server and transaction API required by the imported cash and delivery workflows',()=>{
    const source=readFileSync(new URL('../Takodeal-POS/main.js',import.meta.url),'utf8'),context={window:{}};
    for(const name of ['getDocsFromServer','getDocFromServer','runTransaction','serverTimestamp']){
        context[name]=()=>name;const bridge=source.match(new RegExp('window\\.'+name+' = '+name+';'))?.[0];assert.ok(bridge,'Missing workflow API '+name);vm.runInNewContext(bridge,context);assert.equal(context.window[name],context[name]);
    }
});
