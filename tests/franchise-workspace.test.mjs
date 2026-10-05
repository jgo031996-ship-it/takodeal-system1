import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as data from '../takodeal-franchise/franchise-data.js';
import {logExpense,adjustInventory,reviewRequest,loadBranchSchedule,saveBranchSchedule,scheduleBranch} from '../takodeal-franchise/franchise-actions.js';
import {createScheduleHistoryStore} from '../takodeal-franchise/schedule-history.js';
import {createUnlockGate} from '../takodeal-franchise/unlock-gate.js';
import {resolveHQAccount} from '../takodeal-franchise/hq-account-model.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {receiveDispatch} from '../takodeal-franchise/dispatch-safety.js';
const branch='Sample Branch',actor='Sample Owner';
const scheduleNow=new Date('2026-10-06T10:00:00+08:00');
function scheduleHarness(month=10) {
 const h=firestoreHarness();let id=0;
 h.api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 h.store=createScheduleHistoryStore(h.api,{now:()=>scheduleNow,makeId:()=>`franchise_${++id}`});
 h.base={currentYear:2026,currentMonth:month,branchConfig:{[branch]:[{id:'m',name:'Morning',startTime:'09:00',endTime:'17:00',active:true}],Other:[{id:'m',name:'Morning',startTime:'10:00',endTime:'18:00',active:true}]},currentSchedule:{1:{[branch]:{scheduled:{m:'OLD'}},Other:{scheduled:{m:'OTHER'}}},6:{[branch]:{scheduled:{m:'OLD'}},Other:{scheduled:{m:'OTHER'}}}}};h.put('settings/global_schedule',h.base);return h;
}
const scheduleSave=(h,changes={})=>saveBranchSchedule(h.api,{branch,year:2026,month:10,days:{6:{scheduled:{m:'NEW'}}},original:scheduleBranch(h.base,branch,2026,10),actor,now:scheduleNow,store:h.store,...changes});
test('all 18 sidebar routes have exactly one page and loading engine',()=>{
 const html=readFileSync(new URL('../takodeal-franchise/index.html',import.meta.url),'utf8'),script=readFileSync(new URL('../takodeal-franchise/main_franchise.js',import.meta.url),'utf8');
 assert.equal(Object.keys(data.ROUTES).length,18);
 for(const route of Object.keys(data.ROUTES)){assert.equal(html.split(`id="view-${route}"`).length-1,1,route);assert.equal(html.split(`data-route="${route}"`).length-1,1,route);assert.equal(html.split(`id="body-${route}"`).length-1,1,route);}
 assert.doesNotMatch(script,/origFranchiseeSwitchView|window\.switchView\s*=/);
});
test('Google identity selects the saved PIN; two accounts can share a PIN',async()=>{
 const accounts={owner:[{id:'o',data:{pin:'5678',role:'Owner'}}],co:[{id:'c',data:{pin:'5678',role:'Co-Owner'}}]},opened=[];
 const gate=createUnlockGate({verify:async u=>resolveHQAccount(accounts[u.email]),verifyOnUnlock:true,load:async a=>opened.push(a.user.email)});
 await gate.identify({email:'co'});assert.equal(await gate.unlock('5678'),true);assert.deepEqual(opened,['co']);
 gate.reset();await gate.identify({email:'owner'});assert.equal(await gate.unlock('5678'),true);assert.deepEqual(opened,['co','owner']);
});
test('no default PIN or bypass remains in franchise sign-in',()=>{
 const auth=readFileSync(new URL('../takodeal-franchise/auth.js',import.meta.url),'utf8');assert.doesNotMatch(auth,/0319|1234|0000|addDoc|updateDoc/);assert.match(auth,/verifyOnUnlock:true/);assert.match(auth,/data:d\.data\(\)/);
});
test('branch rights do not default to Main Office or All for franchise owners',()=>{
 assert.deepEqual(data.branchScope({role:'Franchisee',assignedBranch:'Maa, Ecoland'},'sample@test'),['Maa','Ecoland']);
 assert.deepEqual(data.branchScope({role:'Franchisee',assignedBranch:'All',permissions:['all']},'sample@test',['Maa']),[]);
 assert.deepEqual(data.branchScope({role:'Manager'},'sample@test'),[]);
 assert.deepEqual(data.branchScope({role:'Co-Owner',assignedBranch:'All',permissions:['all']},'sample@test',['Maa','Main Office']),['Maa','Main Office']);
});
test('limited managers cannot visit unavailable modules or an unassigned branch',()=>{
 const s={branch,allowedBranches:[branch],permissions:['dashboard','inventory']};assert.equal(data.canVisit(s,'inv-prep'),true);assert.equal(data.canVisit(s,'payroll'),false);assert.equal(data.canVisit({...s,branch:'Other'},'dashboard'),false);assert.equal(data.canVisit(null,'dashboard'),false);
});
test('Philippine business-day cutoff works before midnight UTC and overnight',()=>{
 assert.equal(data.businessDay('2026-10-05T07:00:00+08:00'),'2026-10-04');assert.equal(data.businessDay('2026-10-05T08:30:00+08:00'),'2026-10-05');
 const r=data.range('2026-10-05','2026-10-05');assert.equal(r.start.toISOString(),'2026-10-05T00:30:00.000Z');assert.equal(+r.end-+r.start,86400000);assert.throws(()=>data.range('2026-10-06','2026-10-05'));assert.throws(()=>data.range('2026-02-31','2026-03-01'));
});
test('paid sales math reads current fields, retains zero and excludes voids/pending',()=>{
 const paid={status:'Paid',netTotal:80,subTotalBeforeDiscount:100,cart:[{name:'6 Pcs Takoyaki',qty:2}]};
 const sum=data.summarizeSales([paid,{...paid,status:'Voided'},{...paid,status:'pending'},{...paid,netTotal:0,subTotalBeforeDiscount:0,ballsCounted:0}]);
 assert.equal(sum.gross,100);assert.equal(sum.net,80);assert.equal(sum.orders,2);assert.equal(sum.balls,12);assert.equal(sum.discount,20);
});
test('packaging and extra sauce never count as takoyaki balls',()=>assert.equal(data.countBalls([{name:'12 Pcs Takoyaki',qty:2},{name:'6 Pcs Box',category:'Takoyaki',qty:4},{name:'Extra Takoyaki Sauce',qty:3}]),24));
test('Z readings normalize actual Cashier closing fields including cash and zero values',()=>{
 const row=data.shiftReport({status:'Closed',endTime:{seconds:1},expectedCash:2000,declaredCash:1990,totalCashSales:500,totalDigitalSales:600,cashActual:99});assert.equal(row.net,1100);assert.equal(row.variance,-10);assert.equal(row.declared,1990);assert.ok(data.closedShift(row));assert.equal(data.shiftReport({expectedCash:0,cashExpected:900}).expected,0);
});
test('stock zero and negative debt are preserved; saved zero reorder level wins',()=>{
 assert.equal(data.stockQty({currentStock:0,quantity:80}),0);assert.equal(data.stockQty({currentStock:-5,quantity:80}),-5);assert.equal(data.lowStock({currentStock:1,reorderLevel:0,lowStockAlert:10}),false);
});
test('HQ ledger shows debit/credit aliases and running balances',()=>{
 const rows=data.ledgerRows([{id:'2',type:'Credit',amount:30,timestamp:{seconds:2}},{id:'1',type:'Debit',amount:100,timestamp:{seconds:1}}]);assert.equal(rows[0].charge,100);assert.equal(rows[1].payment,30);assert.equal(rows[1].balance,70);
});
const expenseInput={id:'exp',branch,accountId:'cash',amount:100.25,category:'Water',description:'Sample payment',actor};
function accountHarness(){const h=firestoreHarness();h.put('cash_accounts/cash',{branch,name:'Cash',balance:1000});return h;}
test('concurrent expense posting deducts once and shares Manager account logs',async()=>{
 const h=accountHarness();await Promise.all(Array.from({length:10},()=>logExpense(h.api,expenseInput)));assert.equal(h.get('cash_accounts/cash').balance,899.75);assert.equal(h.get('expenses/exp').amount,100.25);assert.equal(h.get('account_logs/exp').newBalance,899.75);
});
test('two different expenses retain both deductions under contention',async()=>{const h=accountHarness();await Promise.all([logExpense(h.api,expenseInput),logExpense(h.api,{...expenseInput,id:'two',amount:200})]);assert.equal(h.get('cash_accounts/cash').balance,699.75);});
test('failed expense commit leaves account and expense history untouched',async()=>{const h=accountHarness();h.failNextCommit();await assert.rejects(logExpense(h.api,expenseInput),/Commit rejected/);assert.equal(h.get('cash_accounts/cash').balance,1000);assert.equal(h.get('expenses/exp'),undefined);});
test('retry after lost acknowledgment never deducts a second time',async()=>{const h=accountHarness();h.loseNextAck();await assert.rejects(logExpense(h.api,expenseInput));assert.equal(await logExpense(h.api,expenseInput),'already-saved');assert.equal(h.get('cash_accounts/cash').balance,899.75);});
test('expense branch mismatch and reused references are rejected',async()=>{const h=accountHarness();await assert.rejects(logExpense(h.api,{...expenseInput,branch:'Other'}));await logExpense(h.api,expenseInput);await assert.rejects(logExpense(h.api,{...expenseInput,amount:200}));});
test('legacy franchise cash accounts remain independently usable',async()=>{const h=firestoreHarness();h.put('franchise_accounts/old',{branch,accountName:'Legacy',balance:500});await logExpense(h.api,{...expenseInput,accountId:'old',accountTable:'franchise_accounts'});assert.equal(h.get('franchise_accounts/old').balance,399.75);assert.equal(h.get('cash_accounts/old'),undefined);assert.ok(h.get('franchise_account_logs/exp'));});
const stockInput={id:'stock',branch,itemId:'item',type:'Audit',quantity:0,observedStock:10,actor};
function stockHarness(){const h=firestoreHarness();h.put('inventory/item',{branch,name:'Batter',uom:'grams',currentStock:10,quantity:999});return h;}
test('audit synchronizes both stock fields and writes a traceable movement once',async()=>{const h=stockHarness();await Promise.all(Array.from({length:10},()=>adjustInventory(h.api,stockInput)));assert.equal(h.get('inventory/item').quantity,0);assert.equal(h.get('inventory/item').currentStock,0);assert.equal(h.get('stock_logs/stock').variance,-10);});
test('stock changes during a physical count require review before overwriting',async()=>{const h=stockHarness();await assert.rejects(adjustInventory(h.api,{...stockInput,observedStock:20}),/Stock changed/);assert.equal(h.get('inventory/item').currentStock,10);});
test('waste uses current stock and rejects overdrawn quantity',async()=>{const h=stockHarness();const waste={...stockInput,type:'Waste',quantity:3,reason:'Spillage'};await adjustInventory(h.api,waste);assert.equal(h.get('inventory/item').currentStock,7);await assert.rejects(adjustInventory(h.api,{...waste,id:'over',quantity:8}),/exceeds/);});
test('stock write failure cannot leave a movement without its adjustment',async()=>{const h=stockHarness();h.failNextCommit();await assert.rejects(adjustInventory(h.api,stockInput));assert.equal(h.get('inventory/item').currentStock,10);assert.equal(h.get('inventory_logs/stock'),undefined);});
test('duplicate request approval charges a staff member only once',async()=>{const h=firestoreHarness();h.put('staff_requests/r',{branch,status:'Pending',staffName:'Sample Staff',type:'Cash Advance',amount:200});await Promise.all(Array.from({length:10},()=>reviewRequest(h.api,{id:'r',branch,action:'Approved',actor})));assert.equal(h.get('staff_requests/r').status,'Approved');assert.equal(h.get('staff_deductions/request-r').amount,200);await assert.rejects(reviewRequest(h.api,{id:'r',branch,action:'Rejected',actor}));});
test('request decisions cannot cross branch boundaries',async()=>{const h=firestoreHarness();h.put('staff_requests/r',{branch:'Other',status:'Pending'});await assert.rejects(reviewRequest(h.api,{id:'r',branch,action:'Approved',actor}));});
test('schedule save archives changes, preserves another branch and rejects a stale edit',async()=>{
 const h=scheduleHarness();await scheduleSave(h);assert.equal(h.get('settings/global_schedule').currentSchedule[6].Other.scheduled.m,'OTHER');assert.equal(h.get('settings/global_schedule').currentSchedule[1][branch].scheduled.m,'OLD');assert.equal(h.get('settings/global_schedule').currentSchedule[6][branch].scheduled.m,'NEW');const saved=await h.store.loadMonth('2026-10');assert.equal(saved.revisions.length,2);assert.equal(saved.latestRevision.source,'franchise-save');await assert.rejects(scheduleSave(h),/changed/);
});
test('future month plan is archived without erasing the month active for other branches',async()=>{
 const h=scheduleHarness(9),before=structuredClone(h.base);await scheduleSave(h,{month:11,original:{},days:{1:{scheduled:{m:'NEW'}}}});assert.deepEqual(h.get('settings/global_schedule').currentSchedule,before.currentSchedule);assert.equal(h.get('settings/global_schedule').currentMonth,9);assert.equal((await h.store.loadMonth('2026-11')).latestRevision.snapshot.currentSchedule[1][branch].scheduled.m,'NEW');assert.equal(h.get('settings/schedule_history_policy').payrollHistoryEnforcedFrom,'2026-10-06');
});
test('month navigation is read-only and returns archived dates with the shift times used then',async()=>{
 const h=scheduleHarness();await h.store.save(h.base,{actor,revisionId:'first',effectiveFrom:'2026-10-06'});const later=structuredClone(h.base);later.branchConfig[branch][0].startTime='11:00';later.currentSchedule[6][branch].scheduled.m='LATER';await h.store.save(later,{actor,revisionId:'later',effectiveFrom:'2026-10-20'});const before=structuredClone([...h.docs]);const editor=await loadBranchSchedule(h.api,{branch,year:2026,month:10,now:scheduleNow,store:h.store});assert.equal(editor.effectiveFrom,'2026-10-20');assert.equal(editor.days[6].scheduled.m,'OLD');assert.equal(editor.dayShifts[6][0].startTime,'09:00');assert.equal(editor.dayShifts[20][0].startTime,'11:00');assert.deepEqual([...h.docs],before);assert.equal(h.get('settings/global_schedule').branchConfig[branch][0].startTime,'09:00');
});
test('an older app changing today’s head cannot erase another branch’s separately saved future plan',async()=>{
 const h=scheduleHarness();await h.store.save(h.base,{actor,revisionId:'today',effectiveFrom:'2026-10-06'});const planned=structuredClone(h.base);planned.currentSchedule[20]={Other:{scheduled:{m:'PLANNED OTHER'}},[branch]:{scheduled:{m:'PLANNED'}}};await h.store.save(planned,{actor,revisionId:'later-plan',effectiveFrom:'2026-10-20'});const live=structuredClone(h.get('settings/global_schedule'));live.currentSchedule[6].Other.scheduled.m='LEGACY TODAY';h.put('settings/global_schedule',live);const editor=await loadBranchSchedule(h.api,{branch,year:2026,month:10,now:scheduleNow,store:h.store});await scheduleSave(h,{original:editor.original,expectedRevisionId:editor.expectedRevisionId,effectiveFrom:'2026-10-20',days:{20:{scheduled:{m:'NEW PLAN'}}}});const archive=await h.store.loadMonth('2026-10');assert.equal(archive.latestRevision.snapshot.currentSchedule[20].Other.scheduled.m,'PLANNED OTHER');assert.equal(h.get('settings/global_schedule').currentSchedule[6].Other.scheduled.m,'LEGACY TODAY');
});
test('past month saves and past day edits cannot rewrite attendance schedule evidence',async()=>{
 const h=scheduleHarness();await h.store.captureCurrent({actor});const monthBefore=structuredClone((await h.store.loadMonth('2026-10')).revisions);await assert.rejects(scheduleSave(h,{month:9,original:{},days:{30:{scheduled:{m:'NEW'}}}}),/read-only/);await scheduleSave(h,{days:{1:{scheduled:{m:'CHANGED PAST'}},6:{scheduled:{m:'NEW'}}}});const archive=await h.store.loadMonth('2026-10');assert.deepEqual(archive.revisions[0],monthBefore[0]);assert.equal(archive.latestRevision.snapshot.currentSchedule[1][branch].scheduled.m,'OLD');assert.equal(archive.latestRevision.daySnapshots['2026-10-01'],undefined);
});
test('future month editing preserves assignments already saved for another branch',async()=>{
 const h=scheduleHarness(),future={...structuredClone(h.base),currentMonth:11};await h.store.save(future,{actor,revisionId:'november',effectiveFrom:'2026-11-01'});const editor=await loadBranchSchedule(h.api,{branch,year:2026,month:11,now:scheduleNow,store:h.store});await scheduleSave(h,{month:11,original:editor.original,expectedRevisionId:editor.expectedRevisionId,days:{6:{scheduled:{m:'NEW'}}}});assert.equal((await h.store.loadMonth('2026-11')).latestRevision.snapshot.currentSchedule[6].Other.scheduled.m,'OTHER');assert.equal(h.get('settings/global_schedule').currentMonth,10);
});
test('failed or unacknowledged schedule commits cannot produce an unarchived head or a duplicate revision',async()=>{
 const h=scheduleHarness();h.failNextCommit();await assert.rejects(scheduleSave(h,{revisionId:'save-one'}),/Commit rejected/);assert.deepEqual(h.get('settings/global_schedule'),h.base);assert.equal(h.get('settings/schedule_month_2026_10'),undefined);h.loseNextAck();await assert.rejects(scheduleSave(h,{revisionId:'save-one'}),/lost/);const before=[...h.docs.keys()];assert.equal((await scheduleSave(h,{revisionId:'save-one'})).alreadySaved,true);assert.deepEqual([...h.docs.keys()],before);await assert.rejects(scheduleSave(h,{revisionId:'save-one',days:{6:{scheduled:{m:'DIFFERENT'}}}}),/already used/);
});
test('permission or Google identity changes block Franchise schedule writes',async()=>{
 const h=scheduleHarness();h.api.sessionUser={branch,allowedBranches:[branch],permissions:['inventory'],email:'owner@example.test'};await assert.rejects(scheduleSave(h),/access/);h.api.sessionUser.permissions=['schedule'];await assert.rejects(scheduleSave(h),/identity/);let allowed=true;const transaction=h.api.runTransaction;h.api.runTransaction=async (...args)=>{allowed=false;return transaction(...args);};await assert.rejects(scheduleSave(h,{actor:h.api.sessionUser.email,authorize:()=>allowed}),/access/);assert.deepEqual(h.get('settings/global_schedule'),h.base);
});
test('HQ changes between editor read and atomic save cannot be overwritten by Franchise assignments',async()=>{
 const h=scheduleHarness(),transaction=h.api.runTransaction;h.api.runTransaction=async (...args)=>{const changed=structuredClone(h.base);changed.currentSchedule[6].Other.scheduled.m='HQ CHANGE';h.put('settings/global_schedule',changed);return transaction(...args);};await assert.rejects(scheduleSave(h),/HQ changed/);assert.equal(h.get('settings/global_schedule').currentSchedule[6].Other.scheduled.m,'HQ CHANGE');assert.equal(h.get('settings/global_schedule').currentSchedule[6][branch].scheduled.m,'OLD');
});
test('duplicate assignments and invalid days are rejected before any schedule write',async()=>{
 const h=scheduleHarness();await assert.rejects(scheduleSave(h,{days:{32:{scheduled:{m:'NEW'}}}}),/does not belong/);await assert.rejects(scheduleSave(h,{days:{6:{scheduled:{m:'NEW',n:'NEW'}}}}),/two shifts/);assert.deepEqual(h.get('settings/global_schedule'),h.base);
});
test('attendance estimates use actual punches and saved daily rate, with meals and loans',()=>{
 const at=time=>new Date('2026-10-05T'+time+':00+08:00'),profiles=[{cashierName:'Sample Staff',hourlyRate:500,branch}];
 const rows=data.attendanceEstimate({logs:[{branch,staffName:'Sample Staff',type:'TIME IN',timestamp:at('09:00')},{branch,staffName:'Sample Staff',type:'TIME OUT',timestamp:at('17:00')}],profiles,deductions:[{staffName:'Sample Staff',type:'Co-Owner Meal',amount:20,status:'Unpaid',dateAdded:at('12:00')}],ledgers:[{staffName:'Sample Staff',totalLoaned:1000,totalPaid:0,cutoffDeduction:100}],start:'2026-10-05',end:'2026-10-05',branch});assert.equal(rows[0].hours,8);assert.equal(rows[0].gross,500);assert.equal(rows[0].meals,20);assert.equal(rows[0].loan,100);assert.equal(rows[0].net,380);
});
test('missing punches are flagged without invented salary',()=>{const rows=data.attendanceEstimate({logs:[{branch,staffName:'Sample Staff',type:'TIME IN',timestamp:'2026-10-05T09:00:00+08:00'}],profiles:[{branch,cashierName:'Sample Staff',hourlyRate:500}],start:'2026-10-05',end:'2026-10-05',branch});assert.equal(rows[0].review,1);assert.equal(rows[0].gross,0);});
test('delivery receipt preserves negative stock and is idempotent',async()=>{
 const h=stockHarness();h.api.getDocFromServer=async ref=>({id:ref.id,ref,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});h.put('inventory/item',{branch,name:'Batter',currentStock:-5,uom:'gram'});h.put('dispatch_logs/d',{toBranch:branch,status:'Arrived',item:'Batter',qty:10,convRate:1,uom:'gram'});
 const input={branch,actor,items:[{id:'d',actualDisplayQty:10}]};await receiveDispatch(h.api,input);assert.equal(h.get('inventory/item').currentStock,5);await receiveDispatch(h.api,input);assert.equal(h.get('inventory/item').currentStock,5);
});
test('service worker uses actual PNG app icons and only caches static files',()=>{const manifest=JSON.parse(readFileSync(new URL('../takodeal-franchise/manifest.json',import.meta.url),'utf8')),sw=readFileSync(new URL('../takodeal-franchise/sw.js',import.meta.url),'utf8');assert.deepEqual(manifest.icons.map(i=>i.src),['icon-192.png','icon-512.png']);for(const size of [192,512]){const icon=readFileSync(new URL(`../takodeal-franchise/icon-${size}.png`,import.meta.url));assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(icon.readUInt32BE(16),size);assert.equal(icon.readUInt32BE(20),size);}assert.match(sw,/!CORE\.includes\(file\)/);assert.doesNotMatch(sw,/firebase|skipWaiting\(\).*install/);});
