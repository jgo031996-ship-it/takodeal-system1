import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import * as roster from '../takodeal-manager/payroll-roster-model.js';
import * as rosterUI from '../takodeal-manager/payroll-balance-review.js';
import * as scheduleFreshness from '../takodeal-manager/payroll-schedule-freshness.js';
import * as previewFreshness from '../takodeal-manager/payroll-preview-guard.js';
import * as payrollLoading from '../takodeal-manager/payroll-loading.js';
import * as payrollCompletion from '../takodeal-manager/payroll-completion.js';
import {isOwnerDeduction} from '../takodeal-manager/owner-deduction-model.js';
import {readPayrollOwnerDeductions,ownerDeductionDisplayRows} from '../takodeal-manager/owner-deduction-payroll.js';
import {finalizeOrdinaryPayroll} from '../takodeal-manager/payroll-settlement.js';
import {canOpenWorkspacePage,OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-manager/payroll-safety.js';
import * as staffPayroll from '../takodeal-staff/payroll-safety.js';
import * as franchisePayroll from '../takodeal-franchise/payroll-safety.js';
import * as posPayroll from '../Takodeal-POS/payroll-safety.js';
import * as sanctions from '../takodeal-manager/sanction-schedule.js';
import { planPayrollAttendance } from '../takodeal-manager/payroll-attendance.js';
import { attendanceMillis } from '../takodeal-manager/attendance-reconcile.js';
import { assembleScheduleHistory, resolveScheduleForDate } from '../takodeal-manager/schedule-history.js';
import { closeShiftAtomic } from '../Takodeal-POS/cash-settlement.js';
import { escapeHtml } from '../takodeal-manager/manager-workspace.js';
import { firestoreHarness } from './helpers/firestore-harness.mjs';

const roots = ['takodeal-manager','takodeal-staff','takodeal-franchise','Takodeal-POS'];
const models = [payroll,staffPayroll,franchisePayroll,posPayroll];
for (let index=0;index<models.length;index++) {
    test(roots[index]+': only exact cancelled-food purchase and existing meals enter Foods',()=>{
        for(const type of ['Cancelled Food Purchase',' cancelled food purchase ','Staff Meal','Staff Meal (POS Auto)','Manager Meal','Manager Meal (POS Auto)']) {
            assert.equal(models[index].isMealDeduction(type),true,type);
        }
        for(const type of ['Cancelled Food Purchase Refund','Cancelled Food Purchase Penalty','Cancelled Food Purchase (POS Auto)','Cancelled Platform Food','Food Allowance','Meal Allowance','Missing Food Penalty','Staff Meal Refund','Cash Advance','Company Loan Issued',null,undefined]) {
            assert.equal(models[index].isMealDeduction(type),false,String(type));
        }
    });
}
test('all four shared payroll models remain byte-identical',()=>{
    const sources=roots.map(root=>readFileSync(new URL('../'+root+'/payroll-safety.js',import.meta.url)));
    for(const source of sources.slice(1))assert.deepEqual(source,sources[0]);
});

const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function extract(name) {
    const start=source.indexOf('\nwindow.'+name+' = ');
    assert.notEqual(start,-1,'actual Manager handler '+name+' exists');
    const end=source.indexOf('\n};',start+1);
    assert.notEqual(end,-1);
    return source.slice(start+1,end+3);
}
const stamp=day=>({toDate:()=>new Date(2026,9,day,12)});
const purchase=(id,amount,day=11,status='Unpaid',type='Cancelled Food Purchase')=>({
    id,staffId:'sample-staff',staffName:'Sample Staff',branch:'Maa',type,category:'Foods',amount,status,dateAdded:stamp(day),
    purchaseId:id,sourceSaleId:'sample-platform-sale',sourcePlatform:'Grab'
});
function payrollFixture({deductions=[],frozen=null}={}) {
    const profile={id:'sample-staff',cashierName:'Sample Staff',scheduleNickname:'SAMPLE',branch:'Maa',hourlyRate:450};
    const elements={payrollStart:{value:'2026-10-01'},payrollEnd:{value:'2026-10-15'},payrollGeneratorBody:{innerHTML:''},payrollGrandTotalContainer:{style:{}},payrollGrandTotalAmount:{}};
    const errors=[],writes=[];
    const data={cashiers:[profile],staff_ledger:[],payroll_records:frozen?[{staffName:'Sample Staff',frozenData:frozen}]:[],attendance_logs:[],staff_deductions:deductions,staff_bonuses:[]};
    const schedule={currentYear:2026,currentMonth:10,currentSchedule:{},branchConfig:{}};
    const api={db:{},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),query:ref=>ref,where:()=>({}),orderBy:()=>({}),
        getDoc:async()=>({exists:()=>true,data:()=>schedule}),
        getDocs:async q=>{const docs=(data[q.table]||[]).filter(row=>q.table!=='staff_deductions'||row.status==='Unpaid').map((row,i)=>({id:row.id||String(i),data:()=>row}));return {docs,forEach:fn=>docs.forEach(fn)};},
        setDoc:async()=>{writes.push('set');throw Error('Preview must not write');},updateDoc:async()=>{writes.push('update');throw Error('Preview must not write');},addDoc:async()=>{writes.push('add');throw Error('Preview must not write');}};
    api.getDocsFromServer=api.getDocs;
    api.getDocs=async()=>{throw Error('Payroll preview must read confirmed server records.');};
    api.auth={currentUser:{uid:'sample-payroll-owner',email:OWNER_EMAIL,emailVerified:true}};
    api.sessionUser={uid:'sample-payroll-owner',email:OWNER_EMAIL,isOwner:true,permissions:['all'],allowedBranches:['All']};
    const window={...api,globalPayrollCache:{},isBranchAllowed:()=>true,loadPayrollScheduleHistory:async()=>assembleScheduleHistory(schedule),ManagerUI:{notify:message=>errors.push(message)}};
    const context=vm.createContext({activeStaffProfile,...roster,...rosterUI,...api,...payroll,...scheduleFreshness,...previewFreshness,...payrollLoading,...payrollCompletion,isOwnerDeduction,readPayrollOwnerDeductions,ownerDeductionDisplayRows,canOpenWorkspacePage,...sanctions,planPayrollAttendance,attendanceMillis,resolveScheduleForDate,window,Date,
        escapeHtml:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
        document:{getElementById:id=>id==='payrollBalanceReview'?null:elements[id]||null},alert:message=>errors.push(message),console:{error:(...message)=>errors.push(message),log:()=>{}}});
    vm.runInContext(extract('getPayrollPreviewGuard')+'\n'+extract('requirePayrollPreview'),context);
    return {window,context,elements,errors,writes};
}
for(const name of ['loadPayrollGenerator','generateAutoPayslips']) {
    test(name+': unpaid purchases carry into Foods once; paid, future and unrelated rows are excluded',async()=>{
        const deductions=[purchase('first',120.5,3),purchase('carried',44,0),purchase('regular',10.25,4,'Unpaid','Staff Meal (POS Auto)'),
            purchase('paid',999,3,'Paid'),purchase('future',999,16),purchase('refund',500,3,'Unpaid','Cancelled Food Purchase Refund'),
            purchase('penalty',700,3,'Unpaid','Missing Food Penalty'),purchase('advance',30,3,'Unpaid','Cash Advance')];
        const original=deductions.map(row=>({...row}));
        const h=payrollFixture({deductions});vm.runInContext(extract(name),h.context);
        await h.window[name]();
        assert.deepEqual(h.errors,[]);
        assert.equal(h.window.globalPayrollCache['Sample Staff'].meals,174.75);
        assert.equal(h.window.globalPayrollCache['Sample Staff'].advances,30);
        assert.match(h.elements.payrollGeneratorBody.innerHTML,/-₱174\.75 \(Meals\)/);
        await h.window[name]();
        assert.equal(h.window.globalPayrollCache['Sample Staff'].meals,174.75);
        assert.deepEqual(deductions,original);assert.deepEqual(h.writes,[]);
    });
    test(name+': purchases never rewrite an already-paid frozen cutoff',async()=>{
        const frozen={name:'Sample Staff',branch:'Maa',basicPay:450,hours:8,meals:7.5,lateDeduction:11,logs:[{remark:'Saved original payroll'}],isPaid:true};
        const before=structuredClone(frozen),h=payrollFixture({frozen,deductions:[purchase('new',120.5)]});
        vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);assert.deepEqual(h.window.globalPayrollCache['Sample Staff'],before);
        assert.equal(h.window.paidPayrollSnapshots.has(frozen),true);
        assert.deepEqual(frozen,before);assert.deepEqual(h.writes,[]);
    });
}
test('actual payslip calculation subtracts cancelled-food Foods amount from net pay',()=>{
    const ids=['psBasicPay','psOvertime','psStraightBonus','psHoliday','psPerfBonus','psLate','psSSS','psPhil','psPagibig','psAdvance','psLoans','psFoods','psGross','psTotalDeduct','psNetPay'];
    const elements=Object.fromEntries(ids.map(id=>[id,{tagName:'INPUT',value:'0',innerText:''}]));
    elements.psBasicPay.value='450';elements.psFoods.value='174.75';
    const window={};vm.runInNewContext(extract('recalcPayslip'),{window,document:{getElementById:id=>id==='payrollBalanceReview'?null:elements[id],querySelectorAll:()=>[]}});
    window.recalcPayslip();assert.equal(elements.psTotalDeduct.innerText,'174.75');assert.equal(elements.psNetPay.innerText,'275.25');
});

function paymentFixture(food) {
    const rows=[purchase('prior-paid',90,2,'Paid'),purchase('first',100,3),purchase('second',25,4),
        purchase('future',80,16),purchase('refund',99,3,'Unpaid','Cancelled Food Purchase Refund')];
    const errors=[],h=firestoreHarness(),elements=new Map();
    const node=id=>{if(!elements.has(id))elements.set(id,{tagName:'INPUT',value:'0',innerText:'',style:{},querySelectorAll:()=>[]});return elements.get(id);};
    node('psFoods').value=String(food);node('psNetPay').value='500.00';node('psNetPay').innerText='500.00';node('psBasicPay').value=String(500+food);
    node('payrollStart').value='2026-10-01';node('payrollEnd').value='2026-10-15';
    const staffProfile={staffId:'sample-staff',cashierName:'Sample Staff',branch:'Maa',hourlyRate:450};
    h.put('cashiers/'+staffProfile.staffId,staffProfile);
    h.put('cash_accounts/sample-account',{name:'Sample account',branch:'Main Office',balance:5000});
    h.put('hq_managers/sample-owner',{email:'owner@example.test',role:'Owner',active:true,pin:'sample-pin',permissions:['all'],assignedBranch:'All'});
    h.put('hq_email_access/owner@example.test',{active:true,permissions:['all'],allowedBranches:['All']});
    for(const row of rows)h.put('staff_deductions/'+row.id,{...row,dateAdded:{seconds:Math.floor(row.dateAdded.toDate().getTime()/1000)}});
    const before=structuredClone(h.docs),reads=[],api={...h.api};
    api.getDocsFromServer=async ref=>{reads.push(ref.table);return h.api.getDocsFromServer(ref);};
    api.getDocFromServer=async ref=>{const data=structuredClone(h.get(ref.path));return {ref,id:ref.id,exists:()=>data!==undefined,data:()=>structuredClone(data),metadata:{fromCache:false,hasPendingWrites:false}};};
    api.getDocs=async()=>{throw Error('Payment must confirm server records.');};
    const paymentHistory={historyMonths:{}};
    api.auth={currentUser:{uid:'sample-payroll-owner',email:'owner@example.test',emailVerified:true,providerData:[{providerId:'google.com'}]}};api.sessionUser={uid:'sample-payroll-owner',email:'owner@example.test',role:'Owner',isOwner:true,permissions:['all'],allowedBranches:['All']};
    const window={...api,loadPayrollScheduleHistory:async()=>paymentHistory,currentPayslipData:{name:'Sample Staff',staffId:staffProfile.staffId,profile:{...staffProfile},branch:'Maa',start:'2026-10-01',end:'2026-10-15',basicPay:500+food,meals:food},
        openPayslipModal(){},downloadPayslipImage(){},ManagerUI:{notify:text=>errors.push(text)}};
    window.currentPayslipData.scheduleEvidenceStamp=scheduleFreshness.payrollScheduleStamp(paymentHistory,window.currentPayslipData);
    const context=vm.createContext({activeStaffProfile,...roster,...rosterUI,...api,...payroll,...scheduleFreshness,...previewFreshness,...payrollCompletion,finalizeOrdinaryPayroll,canOpenWorkspacePage,escapeHtml:String,window,document:{getElementById:id=>id==='payrollBalanceReview'?null:node(id),querySelectorAll:()=>[]},Date,
        Swal:{fire:async()=>({value:'0',isConfirmed:true})},console:{error:error=>errors.push(error)}});
    vm.runInContext(extract('getPayrollPreviewGuard')+'\n'+extract('requirePayrollPreview')+'\n'+extract('finalizePayslip'),context);
    const preview=window.currentPayslipData,guard=window.getPayrollPreviewGuard(),token=guard.begin();
    window.globalPayrollCache={[preview.name]:preview};window.currentPayslipData=preview;guard.complete(token);
    // Assertions below inspect committed transaction outcomes, not mocked SDK writes.
    return {window,errors,h,reads,
        get rows(){return rows.map(row=>h.get('staff_deductions/'+row.id));},
        get changes(){return [...h.docs].filter(([path,data])=>before.has(path)&&JSON.stringify(data)!==JSON.stringify(before.get(path))).map(([path,change])=>({ref:{table:path.split('/')[0],id:path.split('/')[1]},change}));},
        get records(){return [...h.docs].filter(([path])=>!before.has(path)).map(([path,row])=>({table:path.split('/')[0],...row}));}};
}
test('actual payslip finalization clears only cancelled purchases already included in Foods',async()=>{
    const h=paymentFixture(125);await h.window.finalizePayslip();assert.deepEqual(h.errors,[]);
    assert.equal(h.rows.find(row=>row.id==='first').status,'Paid');assert.equal(h.rows.find(row=>row.id==='second').status,'Paid');
    assert.equal(h.rows.find(row=>row.id==='future').status,'Unpaid');assert.equal(h.rows.find(row=>row.id==='refund').status,'Unpaid');
    assert.equal(h.changes.some(row=>['prior-paid','future','refund'].includes(row.ref.id)),false);
    assert.equal(h.records.find(row=>row.table==='payroll_records').frozenData.meals,125);
    assert.equal(h.h.get('cash_accounts/sample-account').balance,4500);assert.ok(h.reads.includes('cash_accounts'));
    assert.equal(h.records.filter(row=>row.table==='payroll_records').length,1);assert.equal(h.records.find(row=>row.table==='payroll_records').finalNetPay,500);
    assert.equal(h.window.currentPayslipData.isPaid,true);assert.equal(h.window.paidPayrollSnapshots.has(h.window.currentPayslipData),true);
});
test('an edited partial Foods payment retains the exact unpaid purchase remainder',async()=>{
    const h=paymentFixture(110);await h.window.finalizePayslip();assert.deepEqual(h.errors,[]);
    assert.equal(h.rows.find(row=>row.id==='first').status,'Paid');
    assert.equal(h.rows.find(row=>row.id==='second').status,'Unpaid');assert.equal(h.rows.find(row=>row.id==='second').amount,15);
    assert.equal(h.records.find(row=>row.table==='payroll_records').frozenData.meals,110);
});

function settlementFixture() {
    const h=firestoreHarness();h.api.getDocs=h.api.getDocsFromServer;
    h.put('branches/maa',{name:'Maa',isMallBranch:false,royaltyPercent:5});
    h.put('shifts/sample',{branch:'Maa',active:true,status:'Open',startingCash:1000,salesRevision:0});
    h.put('cash_accounts/cash',{branch:'Main Office',name:'Cash',balance:100});
    return h;
}
const closing={expectedSalesRevision:0,shiftId:'sample',branch:'Maa',cashier:'Sample Staff',declaredCash:1000,totalCashSales:0,totalDigitalSales:125,
    digitalBreakdown:{'Salary Deduction':125},physicalStockCount:[],shiftIngredientBurn:{},variance:0,cashOut:0,closing:{}};
const paths=(h,table)=>[...h.docs.keys()].filter(path=>path.startsWith(table+'/'));
test('salary-deduction shift closure records revenue and royalty without inventing a cash deposit',async()=>{
    const h=settlementFixture(),before=structuredClone(h.get('cash_accounts/cash'));
    assert.equal(await closeShiftAtomic(h.api,closing),'closed');
    assert.deepEqual(h.get('cash_accounts/cash'),before);assert.equal(paths(h,'cash_accounts').length,1);
    assert.deepEqual(paths(h,'account_logs'),[]);assert.deepEqual(paths(h,'remittances'),[]);
    assert.equal(h.get('shifts/sample').totalDigitalSales,125);assert.deepEqual(h.get('shifts/sample').digitalBreakdown,{'Salary Deduction':125});
    assert.equal(h.get('shifts/sample').expectedCash,1000);assert.equal(h.get('franchise_ledger/royalty-sample').amount,6.25);
});
test('legitimate Grab sweep remains once under lost acknowledgement and concurrent salary closures',async()=>{
    const h=settlementFixture();h.put('cash_accounts/grab',{branch:'Main Office',name:'Grab',balance:50});
    const input={...closing,totalDigitalSales:525,digitalBreakdown:{Grab:400,'Salary Deduction':125}};
    h.loseNextAck();await assert.rejects(closeShiftAtomic(h.api,input),/lost after commit/);
    await Promise.all(Array.from({length:10},()=>closeShiftAtomic(h.api,input)));
    assert.equal(h.get('cash_accounts/grab').balance,450);assert.equal(paths(h,'cash_accounts').length,2);
    assert.deepEqual(paths(h,'account_logs'),['account_logs/shift-sample-Grab']);
    assert.equal(h.get('account_logs/shift-sample-Grab').amount,400);assert.equal(h.get('cash_accounts/cash').balance,100);
    assert.equal(h.get('shifts/sample').totalDigitalSales,525);assert.equal(h.get('franchise_ledger/royalty-sample').amount,26.25);
});
test('excluded salary/GCash methods cannot trip duplicate-account checks or receive swept money',async()=>{
    const h=settlementFixture();
    for(const id of ['one','two'])h.put('cash_accounts/salary-'+id,{branch:'Main Office',name:'Salary Deduction',balance:10});
    const before=[h.get('cash_accounts/salary-one'),h.get('cash_accounts/salary-two')].map(row=>structuredClone(row));
    await closeShiftAtomic(h.api,{...closing,totalDigitalSales:175,digitalBreakdown:{' salary deduction ':125,Gcash:50}});
    assert.deepEqual([h.get('cash_accounts/salary-one'),h.get('cash_accounts/salary-two')],before);
    assert.deepEqual(paths(h,'account_logs'),[]);assert.equal(paths(h,'cash_accounts').length,3);
});
test('duplicate genuine Grab accounts still reject settlement atomically',async()=>{
    const h=settlementFixture();
    for(const id of ['one','two'])h.put('cash_accounts/grab-'+id,{branch:'Main Office',name:'Grab',balance:10});
    await assert.rejects(closeShiftAtomic(h.api,{...closing,totalDigitalSales:525,digitalBreakdown:{Grab:400,'Salary Deduction':125}}),/Duplicate HQ cash account: Grab/);
    assert.equal(h.get('shifts/sample').active,true);assert.equal(h.get('cash_accounts/grab-one').balance,10);
    assert.deepEqual(paths(h,'account_logs'),[]);assert.deepEqual(paths(h,'franchise_ledger'),[]);
});

test('a receipt arriving after preview prevents stale shift totals and all settlement writes',async()=>{
    const h=settlementFixture();h.put('shifts/sample',{...h.get('shifts/sample'),salesRevision:1});
    await assert.rejects(closeShiftAtomic(h.api,closing),/sales|receipt|changed|refresh|reload/i);
    assert.equal(h.get('shifts/sample').active,true);assert.equal(h.get('cash_accounts/cash').balance,100);
    assert.deepEqual(paths(h,'account_logs'),[]);assert.deepEqual(paths(h,'franchise_ledger'),[]);
});
test('a receipt racing the settlement transaction forces retry and refuses the old preview',async()=>{
    const h=settlementFixture(),run=h.api.runTransaction;let arrived=false;
    h.api.runTransaction=(db,callback)=>run(db,tx=>callback({...tx,get:async reference=>{
        if(!arrived&&reference.path==='branches/maa'){
            arrived=true;h.put('shifts/sample',{...h.get('shifts/sample'),salesRevision:1});
        }
        return tx.get(reference);
    }}));
    await assert.rejects(closeShiftAtomic(h.api,closing),/Sales changed/);
    assert.equal(h.retries(),1);assert.equal(h.get('shifts/sample').active,true);
    assert.equal(h.get('shifts/sample').salesRevision,1);assert.equal(h.get('cash_accounts/cash').balance,100);
    assert.deepEqual(paths(h,'account_logs'),[]);assert.deepEqual(paths(h,'franchise_ledger'),[]);
});
function reportingFixture({resale=true,crossMonth=false,ordinary=true,branch='Maa'}={}) {
    const date=(month,day)=>new Date(2026,month-1,day,12);
    const cart=[{name:'Sample food',qty:2,category:'Takoyaki',lineTotalFinal:240,addons:{sauce:{qty:1,linkedIngredient:'Sauce',deductQty:2}}}];
    const prepared={id:'source',receiptId:'SAMPLE-GRAB',branch:'Maa',cashier:'Sample Cashier',customerName:'Sample Customer',status:'Voided',paymentMethod:'Grab',netTotal:200,cart,
        preparedCancellation:{prepared:true,reason:'customer'},timestamp:crossMonth?date(9,30):date(10,11)};
    const records=[prepared,{id:'normal-void',branch:'Maa',status:'Voided',paymentMethod:'Grab',netTotal:700,cart,timestamp:date(10,11)}];
    if(resale)records.push({id:'resale',receiptId:'CF-SAMPLE-GRAB',branch:'Maa',customerName:'Sample Staff',status:'Paid',paymentMethod:'Salary Deduction',netTotal:192,cart,
        cancelledFoodSourceId:'source',timestamp:crossMonth?date(10,1):date(10,11)});
    if(ordinary)records.push({id:'ordinary',receiptId:'SAMPLE-PAID',branch:'Maa',status:'Paid',paymentMethod:'Grab',netTotal:100,cart:[{name:'Sample food',qty:1,lineTotalFinal:100}],timestamp:date(10,11)});
    const data={transactions:records,inventory:[{name:'Sauce',branch:'Maa',baseCost:2,currentStock:88}],bom:[{menuItem:'Sample food',ingredientName:'Sauce',qty:3}],
        menu:[{name:'Sample food',category:'Takoyaki'}],shifts:[],incoming_orders:[],parked_orders:[],expenses:[],budgets:[]};
    const baseline=structuredClone(data),nodes=new Map(),errors=[],rendered=[],writes=[];let renderPromise,modalHtml='';
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',innerText:'',style:{},options:[{},{}],getContext:()=>id,previousElementSibling:{querySelector:()=>({innerHTML:''})}});return nodes.get(id);};
    node('flowBranchFilter').value=branch;node('flowTimeFilter').value='month';node('flowMonthPicker').value='2026-10';node('flowYearPicker').value='2026';
    node('histBranchFilter').value=branch;node('histStartDate').value='2026-10-01';node('histEndDate').value='2026-10-31';node('histArchiveSelect').value='LIVE';
    const snapshot=rows=>({docs:rows.map((row,i)=>({id:row.id||String(i),data:()=>row})),empty:rows.length===0,size:rows.length,forEach:fn=>rows.forEach((row,i)=>fn({id:row.id||String(i),data:()=>row}))});
    const api={db:{},collection:(_,table)=>({table}),where:(field,operator,value)=>({field,operator,value}),orderBy:()=>({}),limit:()=>({}),query:(ref,...filters)=>({...ref,filters}),
        getDocs:async ref=>snapshot((data[ref.table]||[]).filter(row=>(ref.filters||[]).every(f=>!f.field||f.operator==='>='?(!f.field||row[f.field]>=f.value):f.operator==='<='?row[f.field]<=f.value:f.operator==='in'?f.value.includes(row[f.field]):row[f.field]===f.value))),
        setDoc:async()=>writes.push('set'),updateDoc:async()=>writes.push('update'),addDoc:async()=>writes.push('add')};
    const window={...api,sessionUser:{isOwner:true},isBranchAllowed:()=>true};
    const context=vm.createContext({activeStaffProfile,...roster,...rosterUI,...api,window,escapeHtml,formatMoney:value=>'₱'+Number(value).toFixed(2),document:{getElementById:id=>id==='payrollBalanceReview'?null:node(id),body:{insertAdjacentHTML:(_,html)=>{modalHtml=html;}}},
        cachedSnapshot:async table=>snapshot(data[table]||[]),renderFinancialFlow:totals=>{rendered.push(JSON.parse(JSON.stringify(totals)));return '<div>Mock report container</div>';},
        historyLive:{start:()=>({active:()=>true,watch:(query,callback)=>{renderPromise=api.getDocs(query).then(callback);}})},
        Chart:class{destroy(){}},console:{error:(...args)=>errors.push(args.map(String).join(' ')),log:()=>{}},Date});
    for(const name of ['loadFinancialFlow','loadSalesHistoryTab','viewShiftReportModal','openBranchDetails','generateAIReport'])vm.runInContext(extract(name),context);
    return {window,node,data,baseline,errors,rendered,writes,context,history:async()=>{await window.loadSalesHistoryTab();await renderPromise;},modalHtml:()=>modalHtml};
}
for(const resale of [false,true])test('Financial Flow keeps prepared food cost once with '+(resale?'a linked staff resale':'no buyer'),async()=>{
    const h=reportingFixture({resale});await h.window.loadFinancialFlow();
    assert.deepEqual(h.errors,[]);assert.equal(h.rendered[0].totalRevenue,resale?292:100);
    assert.equal(h.rendered[0].totalCOGS,26);assert.equal(h.rendered[0].netProfit,(resale?292:100)-26);
    await h.window.loadFinancialFlow();assert.equal(h.rendered[1].totalCOGS,26);
    assert.deepEqual(h.data,h.baseline);assert.deepEqual(h.writes,[]);
});
test('Financial Flow attributes consumed food to its original month and zero cost to a later resale',async()=>{
    const h=reportingFixture({crossMonth:true,ordinary:false});
    h.node('flowMonthPicker').value='2026-09';await h.window.loadFinancialFlow();
    assert.deepEqual(h.errors,[]);assert.equal(h.rendered[0].totalRevenue,0);assert.equal(h.rendered[0].totalCOGS,20);assert.equal(h.rendered[0].netProfit,-20);
    h.node('flowMonthPicker').value='2026-10';await h.window.loadFinancialFlow();
    assert.equal(h.rendered[1].totalRevenue,192);assert.equal(h.rendered[1].totalCOGS,0);assert.equal(h.rendered[1].netProfit,192);
    assert.deepEqual(h.data,h.baseline);assert.deepEqual(h.writes,[]);
});
for(const resale of [false,true])test('actual Sales History retains prepared-source cost in shift/day/month totals with '+(resale?'resale':'no resale'),async()=>{
    const h=reportingFixture({resale});await h.history();assert.deepEqual(h.errors,[]);
    assert.equal(h.node('histSumNet').innerText,'₱'+(resale?'292.00':'100.00'));assert.equal(h.node('histSumCogs').innerText,'₱26.00');
    const reports=Object.values(h.window.globalShiftReports);assert.equal(reports.reduce((sum,row)=>sum+row.cogs,0),26);
    const sourceReport=reports.find(row=>row.transactions.some(tx=>tx.receiptId==='SAMPLE-GRAB'));
    const prepared=sourceReport.transactions.find(tx=>tx.receiptId==='SAMPLE-GRAB');
    assert.equal(prepared.cogs,20);assert.equal(prepared.isVoid,true);assert.equal(prepared.preparedCancellation,true);
    if(resale)assert.equal(reports.flatMap(row=>row.transactions).find(tx=>tx.receiptId==='CF-SAMPLE-GRAB').cogs,0);
    assert.match(h.node('historyDailyBody').innerHTML,/₱26\.00/);assert.match(h.node('historyMonthlyBody').innerHTML,/₱26\.00/);
    assert.match(h.node('historyTableBody').innerHTML,/Cancelled · prepared/);assert.match(h.node('historyTableBody').innerHTML,/Prepared but customer cancelled/);
    assert.match(h.node('historyTableBody').innerHTML,/>Voided</);
    h.window.viewShiftReportModal(sourceReport.id);assert.match(h.modalHtml(),/₱20\.00/);assert.match(h.modalHtml(),/₱-20\.00/);
    assert.match(h.modalHtml(),/Cancelled · prepared/);assert.match(h.modalHtml(),/Prepared but customer cancelled/);
    await h.history();assert.equal(h.node('histSumCogs').innerText,'₱26.00');
    assert.deepEqual(h.data,h.baseline);assert.deepEqual(h.writes,[]);
});
test('Sales History keeps original-month cancellation cost separate from later staff-purchase revenue',async()=>{
    const h=reportingFixture({crossMonth:true,ordinary:false});
    h.node('histStartDate').value='2026-09-01';h.node('histEndDate').value='2026-09-30';await h.history();
    assert.deepEqual(h.errors,[]);assert.equal(h.node('histSumNet').innerText,'₱0.00');assert.equal(h.node('histSumCogs').innerText,'₱20.00');
    h.node('histStartDate').value='2026-10-01';h.node('histEndDate').value='2026-10-31';await h.history();
    assert.equal(h.node('histSumNet').innerText,'₱192.00');assert.equal(h.node('histSumCogs').innerText,'₱0.00');
    assert.deepEqual(h.data,h.baseline);assert.deepEqual(h.writes,[]);
});
test('prepared cancellation/resale reports keep the selected branch filter',async()=>{
    const h=reportingFixture({branch:'Cabantian'});await h.window.loadFinancialFlow();await h.history();
    assert.deepEqual(h.errors,[]);assert.equal(h.rendered[0].totalRevenue,0);assert.equal(h.rendered[0].totalCOGS,0);
    assert.equal(h.node('histSumNet').innerText,'₱0.00');assert.equal(h.node('histSumCogs').innerText,'₱0.00');
    assert.deepEqual(h.writes,[]);
});
for(const resale of [false,true])test('actual branch analytics retains prepared-food cost once with '+(resale?'staff resale':'no buyer'),async()=>{
    const h=reportingFixture({resale}),date=new Date(2026,9,11),finish=new Date(2026,9,12);
    const timestamp=value=>({toDate:()=>value,valueOf:()=>+value});
    h.data.shifts.push({id:'sample-shift',branch:'Maa',status:'Closed',active:false,startTime:timestamp(date),endTime:timestamp(finish),declaredCash:1000});
    h.node('dashStartDate').value='2026-10-11';h.node('dashEndDate').value='2026-10-12';
    await h.window.openBranchDetails('Maa');assert.deepEqual(h.errors,[]);
    assert.equal(h.node('mdlNet').innerText,resale?'₱292.00':'₱100.00');assert.match(h.node('tbCatBody').innerHTML,/₱26\.00/);
    assert.match(h.node('tbTransBody').innerHTML,/Cancelled · prepared/);assert.match(h.node('tbTransBody').innerHTML,/Prepared but customer cancelled/);
    assert.match(h.node('tbTransBody').innerHTML,/> VOID</);assert.deepEqual(h.writes,[]);
    assert.deepEqual(h.data.inventory,h.baseline.inventory);assert.deepEqual(h.data.transactions,h.baseline.transactions);
});
test('actual theoretical-yield report counts original prepared burn but not the resale cart again',async()=>{
    const h=reportingFixture(),fixed=new Date(2026,9,20,12).getTime();
    h.context.Date=class extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
    h.node('aiBranchSelect').value='Maa';h.node('aiDaysSelect').value='45';
    await h.window.generateAIReport();assert.deepEqual(h.errors,[]);
    // Original two orders use 6 recipe units + 4 addon units. The ordinary
    // order adds 3; neither the stock-returning void nor resale adds burn.
    assert.match(h.node('aiReportText').innerHTML,/13\.00 units/);assert.doesNotMatch(h.node('aiReportText').innerHTML,/23\.00 units/);
    assert.deepEqual(h.data,h.baseline);assert.deepEqual(h.writes,[]);
});
test('prepared cancellation reason is escaped in actual History and shift detail',async()=>{
    const h=reportingFixture();h.data.transactions[0].preparedCancellation.label='<img src=x onerror=alert(1)>';
    await h.history();assert.deepEqual(h.errors,[]);
    assert.match(h.node('historyTableBody').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(h.node('historyTableBody').innerHTML,/<img src=x/);
    const report=Object.values(h.window.globalShiftReports).find(row=>row.transactions.some(tx=>tx.receiptId==='SAMPLE-GRAB'));
    h.window.viewShiftReportModal(report.id);assert.match(h.modalHtml(),/&lt;img src=x/);assert.doesNotMatch(h.modalHtml(),/<img src=x/);
});
test('actual Owner-reviewed settlement sweeps Grab but never the Foods salary deduction',async()=>{
    const start=source.indexOf('  async function settleClearance('),end=source.indexOf('  async function refresh()',start);
    assert.ok(start>=0&&end>start);
    const h=firestoreHarness(),snapshot=(path,data)=>({id:path.split('/').at(-1),ref:{path},exists:()=>data!==undefined,data:()=>data});
    h.put('shifts/sample',{branch:'Maa',active:true,status:'Open',startingCash:1000,isMallBranch:false,salesRevision:2});
    h.put('pos_bindings/device',{branch:'Maa',status:'Active'});
    h.put('cashier_presence/device',{pendingSales:0,pendingOperations:0,accepting:false});
    h.put('pos_operation_commits/review',{state:'owner_review'});
    h.put('branches/maa',{name:'Maa',isMallBranch:false,royaltyPercent:5});
    h.put('cash_accounts/grab',{branch:'Main Office',name:'Grab',balance:50});
    h.put('transactions/prepared',{branch:'Maa',shiftId:'sample',status:'Voided',paymentMethod:'Grab',netTotal:200,inventoryState:'applied',preparedCancellation:{prepared:true}});
    h.put('transactions/purchase',{branch:'Maa',shiftId:'sample',status:'Paid',paymentMethod:'Salary Deduction',netTotal:125,inventoryState:'applied',cancelledFoodSourceId:'prepared'});
    h.put('transactions/grab',{branch:'Maa',shiftId:'sample',status:'Paid',paymentMethod:'Grab',netTotal:400,inventoryState:'applied'});
    const before=structuredClone([...h.docs]);let committed;
    const window={db:{},auth:{currentUser:{uid:'sample-owner',email:'owner@example.com'}},collection:(_,table)=>({table}),where:(key,op,value)=>({key,value}),query:(ref,...filters)=>({...ref,filters}),Swal:{fire:async()=>({isConfirmed:true})}};
    vm.runInNewContext(source.slice(start,end)+'\nwindow.testSettle=settleClearance;',{
        window,doc:path=>({path}),tkOwnerDoc:async ref=>snapshot(ref.path,h.get(ref.path)),
        tkOwnerDocs:async q=>{const docs=[...h.docs].filter(([path,row])=>path.startsWith(q.table+'/')&&(q.filters||[]).every(f=>row[f.key]===f.value)).map(([path,row])=>snapshot(path,row));return {docs,empty:!docs.length,size:docs.length};},
        fresh:()=>true,tkEncode:value=>value,tkFingerprint:async()=> 'sample-fingerprint',tkCommitOperation:async record=>{committed=record;},adapter:{},Date,Number,Object,Math
    });
    await window.testSettle({id:'review',branch:'Maa',cashier:'Sample Cashier',evidence:{shiftId:'sample',declaredCash:1000},acceptedAt:{toDate:()=>new Date(2026,9,11,23)}},'Synthetic review');
    assert.ok(committed);const closing=committed.writes.find(write=>write.path==='shifts/sample').data;
    assert.equal(closing.totalCashSales,0);assert.equal(closing.totalDigitalSales,525);assert.equal(closing.expectedCash,1000);
    const accountWrites=committed.writes.filter(write=>write.path.startsWith('cash_accounts/'));assert.equal(accountWrites.length,1);
    assert.equal(accountWrites[0].data.name,'Grab');assert.equal(accountWrites[0].data.balance.__tkIncrement,400);
    const logs=committed.writes.filter(write=>write.path.startsWith('account_logs/'));assert.equal(logs.length,1);assert.equal(logs[0].data.amount,400);
    assert.equal(committed.writes.find(write=>write.path.startsWith('franchise_ledger/')).data.amount,26.25);
    assert.ok(committed.guards.some(guard=>guard.path==='transactions/prepared'));
    assert.deepEqual([...h.docs],before,'The proposal fixture never writes actual cloud data.');
});
