import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { businessDay, calendarDay, dayStart, addDays, dateRange, scopedSales, salesSummary, productReport,
    onDuty, branchPerformance, ballAudit } from '../takodeal-manager/dashboard-data.js';
import { countBalls, createSaleEngine, SALE_VERSION } from '../Takodeal-POS/pos-safety.js';
import { createDashboard } from '../takodeal-manager/dashboard.js';
import { firestoreHarness } from './helpers/firestore-harness.mjs';
const now = Date.parse('2026-10-03T19:00:00+08:00');
const sale = (extra = {}) => ({ branch:'Cabantian', netTotal:125, paymentMethod:'Cash', timestamp:dayStart('2026-10-03'), status:'Paid', cart:[{name:'Bonito Takoyaki 6 Pcs',qty:1,lineTotalFinal:125}], ...extra });

test('Philippine dates and 08:30 cutoff do not depend on the computer timezone', () => {
    assert.equal(calendarDay('2026-10-02T19:00:00Z'),'2026-10-03');
    assert.equal(businessDay('2026-10-03T08:29:59+08:00'),'2026-10-02');
    assert.equal(businessDay('2026-10-03T08:30:00+08:00'),'2026-10-03');
    const r=dateRange('2026-10-03','2026-10-03');
    assert.equal(+r.end-+r.start,86400000);
    assert.equal(scopedSales([sale({timestamp:'2026-10-04T05:00:00+08:00'})],['Cabantian'],r.start,r.end).length,1);
    assert.throws(()=>dateRange('2026-10-04','2026-10-03'));
    assert.throws(()=>dateRange('2024-01-01','2026-10-03'));
    assert.equal(addDays('2026-12-31',1),'2027-01-01');
});
test('KPIs exclude voids, pending/unpaid sales, other branches, and the end boundary', () => {
    const r=dateRange('2026-10-03','2026-10-03');
    const txs=[sale(),sale({status:'Voided'}),sale({status:'Pending Sync'}),sale({paymentStatus:'unpaid'}),sale({branch:'Maa'}),sale({timestamp:r.end})];
    const s=salesSummary(scopedSales(txs,['Cabantian'],r.start,r.end));
    assert.deepEqual([s.net,s.orders,s.average],[125,1,125]);
});
test('split cash and digital payments are counted once and digital fees stay separate', () => {
    const s=salesSummary([sale({splitDetails:[{method:'Cash',amount:25},{method:'Grab',amount:100}]})]);
    assert.equal(s.net,125);assert.equal(s.payments.cash,25);assert.equal(s.payments.grab,100);
});
test('product revenue allocates receipt discounts and costs use branch-specific stock', () => {
    const tx=sale({netTotal:90,cart:[{name:'A',qty:2,lineTotalFinal:60},{name:'B',qty:1,lineTotalFinal:40}]});
    const recipes=[{menuItem:'A',ingredientName:'Sauce',qty:2},{menuItem:'B',ingredientName:'Sauce',qty:1}];
    const inv=[{name:'Sauce',branch:'Cabantian',baseCost:3},{name:'Sauce',branch:'Maa',baseCost:20},{name:'Sauce',branch:'Main Office',baseCost:5}];
    const report=productReport([tx],inv,recipes);
    assert.equal(report[0].sales,54); assert.equal(report[1].sales,36);
    assert.equal(report[0].cogs,12); assert.equal(report[0].margin,42);
    assert.equal(report.reduce((n,p)=>n+p.sales,0),90);
});
test('missing or duplicate ingredients and recipes cannot appear as zero-cost profits', () => {
    const recipe=[{menuItem:'Bonito Takoyaki 6 Pcs',ingredientName:'Sauce',qty:1}];
    for (const inv of [[],[{name:'Sauce',branch:'Cabantian',baseCost:2},{name:'Sauce',branch:'Cabantian',baseCost:3}],[{name:'Sauce',branch:'Cabantian'}]]) {
        const row=productReport([sale()],inv,recipe)[0];
        assert.equal(row.margin,null);assert.equal(row.cogs,null);assert.ok(row.problems.length);
    }
    const row=productReport([sale()],[{name:'Sauce',branch:'Main Office',baseCost:2}],[...recipe,...recipe])[0];
    assert.equal(row.margin,null);assert.match(row.problems.join(' '),/Duplicate recipe/);
    assert.equal(productReport([sale()],[],[])[0].margin,null);
});
test('HQ fallback, harmless stock whitespace, valid zero cost, and add-on quantities are respected', () => {
    const tx=sale({cart:[{name:'A',qty:2,lineTotalFinal:125,addons:{c:{qty:2,deductQty:3,linkedIngredient:'Cheese'}}}]});
    const inv=[{name:'Sauce ',branch:'Cabantian',baseCost:0},{name:'Cheese',branch:'Main Office',baseCost:1}];
    const row=productReport([tx],inv,[{menuItem:'A',ingredientName:'Sauce',qty:2}])[0];
    assert.equal(row.cogs,12);assert.equal(row.problems.length,0);
});
test('latest time-out removes staff, including legacy logs without staff IDs; overdue punches need review', () => {
    const logs=[{id:'1',staffName:'A',staffId:'a',branch:'Cabantian',type:'TIME IN',timestamp:now-3600000},
        {id:'2',staffName:'A',branch:'Cabantian',type:'TIME OUT',timestamp:now},
        {id:'3',staffName:'B',branch:'Maa',type:'TIME IN',timestamp:now-17*3600000}];
    assert.equal(onDuty(logs,['Cabantian'],now).length,0);
    assert.equal(onDuty(logs,['Maa'],now)[0].needsReview,true);
});
test('active drawer totals include split cash and only the matching shift expenses; closed totals stay frozen', () => {
    const shift={id:'s1',branch:'Cabantian',startTime:dayStart('2026-10-03'),startingCash:100,active:true};
    const expenses=[{branch:'Cabantian',shiftId:'s1',amount:10},{branch:'Cabantian',shiftId:'Manager_Fund',amount:50},{branch:'Cabantian',shiftId:'older',amount:30}];
    const p=branchPerformance('Cabantian',[shift],[sale({splitDetails:[{method:'Cash',amount:25},{method:'GCash',amount:100}]}),sale({status:'Voided'})],expenses,'2026-10-03',now);
    assert.deepEqual([p.net,p.expenses,p.expected],[125,10,115]);
    const closed=branchPerformance('Cabantian',[{...shift,active:false,status:'Closed',netSales:500,expenses:30,expectedCash:400}],[],[],'2026-10-03',now);
    assert.deepEqual([closed.net,closed.expenses,closed.expected],[500,30,400]);
});
test('counter supports every explicit pack size and excludes packaging, drinks, sauces and invalid quantities', () => {
    assert.equal(countBalls([6,10,15,20].map(n=>({name:`Bonito Takoyaki ${n} Pcs`,qty:2}))),102);
    assert.equal(countBalls([{name:'Original',category:'Takoyaki',variantName:'15 Pcs',qty:1}]),15);
    assert.equal(countBalls([{name:'TAKE OUT (6pcs)',qty:4},{name:'Milk Tea 6 Pcs',qty:2},{name:'Extra Takoyaki Sauce 6 Pcs',qty:1}]),0);
    assert.equal(countBalls([{name:'Takoyaki 6 Pcs',qty:0},{name:'Takoyaki 6 Pcs',qty:-1},{name:'Takoyaki 6 Pcs',qty:'bad'}]),0);
});
test('counter audit identifies unknown sizes and cannot invent a missing historical base', () => {
    const audit=ballAudit([sale(),sale({status:'Voided'}),sale({cart:[{name:'Takoyaki Standard',qty:1}]})],{totalTakoyakiBalls:100},countBalls,['Cabantian']);
    assert.equal(audit.calculated,6);assert.equal(audit.unknown,1);assert.equal(audit.historical,null);assert.equal(audit.expected,null);
});
test('counter increments and frozen legacy counter reversals remain idempotent', async () => {
    const h=firestoreHarness(); h.put('inventory/batter',{name:'Batter',branch:'Cabantian',currentStock:100});
    const e=createSaleEngine(h.api); const payload={saleVersion:SALE_VERSION,saleId:'pack',receiptId:'pack',branch:'Cabantian',netTotal:100,ballsCounted:999,localTimestamp:'2026-10-03T01:00:00Z',cart:[{name:'Takoyaki 15 Pcs',qty:1},{name:'TAKE OUT 15 Pcs',qty:1}]};
    const plan=await e.prepare(payload,[{menuItem:'Takoyaki 15 Pcs',ingredientName:'Batter',qty:15}]);
    await e.commit(plan); await e.commit(plan);
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls,15);
    // A legacy committed receipt must reverse its frozen value, even if today's formula differs.
    h.put('transactions/pack',{...h.get('transactions/pack'),ballsCounted:30});
    h.put('settings/global_stats',{totalTakoyakiBalls:30,balls_Cabantian:30});
    await e.voidSale('pack','Test','Cabantian');await e.voidSale('pack','Test','Cabantian');
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls,0);
});

function fixture() {
    const ids=[...readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
    const nodes=new Map(ids.map(id=>[id,{id,value:'',innerHTML:'',textContent:'',hidden:false,style:{},classList:{contains:()=>true},
        querySelector:()=>({}),querySelectorAll:()=>[],setAttribute(){}}]));
    nodes.set('dashBranchFilter',{...nodes.get('dashStartDate'),id:'dashBranchFilter',value:'All',onchange:null});
    const d={getElementById:id=>nodes.get(id),body:{classList:{add(){}}}};
    const source={branches:[{name:'Cabantian'},{name:'Maa'}],inventory:[],bom:[],menu:[]};
    const snapshot=data=>({docs:data.map((data,i)=>({id:String(i),data:()=>data})),exists:()=>data.length>0,data:()=>data[0],metadata:{fromCache:false}});
    const listeners=[];let reads=0;
    const w={sessionUser:{email:'test',isOwner:true},db:{},isBranchAllowed:()=>true,
        collection:(_,table)=>({table}),doc:(_,table,id)=>({table:table+'/'+id}),where:(field,op,value)=>({field,op,value}),query:(ref,...filters)=>({...ref,filters}),
        getDocs:async ref=>{reads++;return snapshot(source[ref.table]||[])},
        onSnapshot:(ref,_,next,error)=>{const listener={ref,next,error,stopped:false};listeners.push(listener);return ()=>listener.stopped=true},
        Swal:{fire:async()=>{}},openBranchDetails:()=>{}};
    const controller=createDashboard(w,d);
    const emit=(table,data,cached=false)=>{const l=listeners.filter(l=>!l.stopped&&l.ref.table===table).at(-1);l.next({...snapshot(data),metadata:{fromCache:cached}})};
    return {controller,w,d,nodes,listeners,emit,reads:()=>reads};
}
test('repeated dashboard loading reuses listeners; filter refresh and view exit invalidate old snapshots', async () => {
    const f=fixture();await f.controller.load();const reads=f.reads();await f.controller.load();
    assert.equal(f.listeners.length,6);assert.equal(f.reads(),reads);
    const first=f.listeners[0];f.nodes.get('dashBranchFilter').value='Maa';await f.controller.load();
    assert.equal(f.listeners.length,12);assert.ok(f.listeners.slice(0,6).every(l=>l.stopped));
    f.emit('transactions',[]);const net=f.nodes.get('dashNetSales').textContent;
    first.next({docs:[{id:'late',data:()=>sale()}],metadata:{fromCache:false}});
    assert.equal(f.nodes.get('dashNetSales').textContent,net);
    f.controller.stop();assert.ok(f.listeners.every(l=>l.stopped));
});
test('listener failures show actionable errors instead of hanging; cache metadata stays visible', async () => {
    const f=fixture();await f.controller.load();f.emit('transactions',[],true);
    assert.match(f.nodes.get('dashDataStatus').textContent,/Cached/);
    f.listeners[0].error(new Error('Missing permissions'));
    assert.match(f.nodes.get('dashDataMessage').textContent,/Missing permissions/);
    assert.match(f.nodes.get('dashProductAnalyticsBody').innerHTML,/Refresh/);
    f.controller.stop();
});
test('franchise All sums only permitted branches and never displays the global counter or target', async () => {
    const f=fixture();f.w.sessionUser={email:'franchise',isFranchisee:true,allowedBranches:['Maa']};f.w.isBranchAllowed=b=>b==='Maa';
    await f.controller.load();
    f.emit('transactions',[sale(),sale({branch:'Maa'})]);
    f.emit('settings/global_stats',[{totalTakoyakiBalls:999999,balls_Cabantian:900000,balls_Maa:99}]);
    f.emit('settings/sales_target',[{amount:1000000,Cabantian:500000,Maa:10000}]);
    assert.equal(f.nodes.get('milestoneCounter').textContent,'99');
    assert.equal(f.nodes.get('targetGoalAmount').textContent,'₱10,000.00');
    assert.equal(f.nodes.get('dashNetSales').textContent,'₱125.00');
    f.controller.stop();
});
test('dashboard markup has unique report IDs and no retired panels or floating installers', () => {
    const html=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8');
    const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
    assert.equal((html.match(/id="dashProductAnalyticsBody"/g)||[]).length,1);
    assert.equal((html.match(/id="historyProductAnalyticsBody"/g)||[]).length,1);
    assert.doesNotMatch(html,/id="(?:automatedMetricsContainer|liveStaffGrid|productAnalyticsBody)"/);
    assert.doesNotMatch(main,/tk03OwnerDevicesButton|tkOwnerReviewButton|tkCashierStatusButton|startAutomatedMetricsListener/);
    assert.equal((main.match(/window\.renderDashboardCharts =/g)||[]).length,1);
    assert.match(main,/view !== 'dashboard'/);
});
