import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {allowedFranchiseTabs,installFranchiseWorkspace} from '../takodeal-manager/franchise-workspace.js';
import {billToday,billSchedule,billDueDate,billPeriods,billsForPeriod,billAmount,saveBillAmount,recordBillPayment} from '../takodeal-manager/monthly-bills.js';
import {renderBillForecast} from '../takodeal-manager/monthly-bills-ui.js';
import {tableHeadingOffset} from '../takodeal-manager/manager-scroll.js';

test('merged workspace keeps management and simulator permissions independent',()=>{
    assert.deepEqual(allowedFranchiseTabs({isOwner:true}),['Performance','Ledger','Chat','Leads','Simulator']);
    assert.deepEqual(allowedFranchiseTabs({permissions:['franchise']}),['Simulator']);
    assert.deepEqual(allowedFranchiseTabs({permissions:['franchise-hub']}),['Performance','Ledger','Chat','Leads']);
    assert.deepEqual(allowedFranchiseTabs({isFranchisee:true,permissions:['all']}),['Ledger','Chat','Leads']);
    assert.deepEqual(allowedFranchiseTabs(null),[]);
});
function workspace(user,fn) {
    const originals={window:globalThis.window,document:globalThis.document};
    const nodes=new Map(),loads=[],views=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},attrs:{},hidden:false,tabIndex:0,value:'',setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this[k]=fn;},focus(){this.focused=true;}});return nodes.get(id);};
    const window={sessionUser:user,addEventListener(){},switchView:view=>views.push(view),loadFranPerformance:()=>loads.push('Performance'),loadFranLedger:()=>loads.push('Ledger'),loadFranChat:()=>loads.push('Chat'),loadFranchiseLeads:()=>loads.push('Leads')};
    const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=main.indexOf('window.switchFranTab =');
    vm.runInNewContext(main.slice(start,main.indexOf('\n};',start)+3),{window,document:{getElementById:node}});
    globalThis.window=window;globalThis.document={getElementById:node};
    try{installFranchiseWorkspace();fn({window,node,loads,views});}finally{globalThis.window=originals.window;globalThis.document=originals.document;}
}
test('actual existing hub loaders work with merged tabs, preserve proposal inputs and clean chat subscriptions',()=>workspace({isOwner:true},f=>{
    f.window.switchView('franchise');assert.deepEqual(f.views,['franchise-hub']);assert.deepEqual(f.loads,[]);
    f.node('simFranFee').value='325000';f.node('proposalContainer').value='Generated document';
    f.window.switchFranTab('Ledger');f.window.switchFranTab('Chat');let stopped=0;f.window.franChatUnsubscribe=()=>stopped++;
    f.window.switchFranTab('Simulator');assert.equal(stopped,1);assert.deepEqual(f.loads,['Ledger','Chat']);
    assert.equal(f.node('simFranFee').value,'325000');assert.equal(f.node('proposalContainer').value,'Generated document');
    assert.equal(f.node('franSecLedger').hidden,true);assert.equal(f.node('franSecSimulator').hidden,false);
    assert.equal(f.node('tabFranSimulator').attrs['aria-selected'],'true');
    f.window.switchView('dashboard');f.window.switchView('franchise-hub');assert.equal(f.node('franSecSimulator').hidden,false);
}));
test('simulator-only and franchisee navigation never invoke restricted analytics',()=>{
    workspace({permissions:['franchise']},f=>{f.window.switchView('franchise-hub');assert.deepEqual(f.loads,[]);assert.equal(f.window.switchFranTab('Performance'),false);assert.equal(f.node('tabFranPerf').hidden,true);});
    workspace({isFranchisee:true},f=>{f.window.switchView('franchise-hub');assert.deepEqual(f.loads,['Ledger']);assert.equal(f.window.switchFranTab('Simulator'),false);assert.equal(f.node('tabFranSimulator').hidden,true);});
});
test('tab keyboard navigation skips restricted tabs and keeps correct selected/focus state',()=>workspace({permissions:['franchise-hub']},f=>{
    f.window.switchView('franchise-hub');let prevented=false;
    f.node('franchiseWorkspaceTabs').keydown({key:'End',preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(f.node('tabFranLeads').focused,true);assert.equal(f.node('tabFranLeads').tabIndex,0);assert.equal(f.node('tabFranPerf').tabIndex,-1);
}));
test('every monthly bill requires a real due date, reminder offset and time',()=>{
    for(const dueDate of ['',undefined,'2026-02-30','2026-13-01'])assert.throws(()=>billSchedule({dueDate,reminderDays:3,reminderTime:'09:00'}));
    for(const reminderDays of [-1,31,1.2])assert.throws(()=>billSchedule({dueDate:'2026-10-05',reminderDays,reminderTime:'09:00'}));
    assert.throws(()=>billSchedule({dueDate:'2026-10-05',reminderDays:3,reminderTime:'25:00'}));
});
const schedule=billSchedule({dueDate:'2026-01-31',reminderDays:3,reminderTime:'09:00'});
test('month-end bills clamp short months and use Philippine alarm time',()=>{
    assert.equal(billDueDate(schedule,'2026-02'),'2026-02-28');assert.equal(billDueDate(schedule,'2028-02'),'2028-02-29');assert.equal(billDueDate(schedule,'2026-04'),'2026-04-30');
    const before=billPeriods(schedule,new Date('2026-01-28T00:59:59Z'))[0],at=billPeriods(schedule,new Date('2026-01-28T01:00:00Z'))[0];
    assert.equal(before.state,'upcoming');assert.equal(at.state,'due');assert.equal(billToday(new Date('2026-10-03T16:01:00Z')),'2026-10-04');
});
test('overdue months survive rollover and a paid month does not hide earlier unpaid bills',()=>{
    const bill={...schedule,billPayments:{'2026-03':{amount:100,paymentDate:'2026-03-31'}}};
    const periods=billPeriods(bill,new Date('2026-04-15T04:00:00Z'));
    assert.deepEqual(periods.map(p=>p.state),['overdue','overdue','paid','upcoming']);
    const forecast=billsForPeriod([{id:'rent',branch:'Maa',limit:100,...bill},{id:'net',branch:'Cabantian',limit:50,...schedule}],'Maa',new Date('2026-03-01T00:00:00+08:00'),new Date('2026-04-30T23:59:59+08:00'));
    assert.equal(forecast.length,2);assert.equal(forecast[0].payment.amount,100);
    const html=renderBillForecast([{id:'rent',branch:'Maa',limit:100,...bill}],'Maa',new Date('2026-03-01T00:00:00+08:00'),new Date('2026-04-30T23:59:59+08:00'));
    assert.match(html,/1 unpaid bill/);assert.match(html,/₱100.00 planned/);
});
function paymentEnv(){
    const h=firestoreHarness();h.put('budgets/rent',{branch:'Maa',category:'Rent',limit:100,spent:0,currentMonth:'2026-10',...billSchedule({dueDate:'2026-10-03',reminderDays:3,reminderTime:'09:00'})});h.put('cash_accounts/hq',{branch:'Main Office',name:'Bank',balance:1000});
    return h;
}
const payment={billId:'rent',month:'2026-10',accountId:'hq',amount:100,paymentDate:'2026-10-04',actor:'manager-uid',allowedBranch:()=>true,note:'October rent'};
test('concurrent bill payments and repeated saves create one expense and one cash deduction',async()=>{
    const h=paymentEnv();await Promise.all([recordBillPayment(h.api,payment),recordBillPayment(h.api,payment)]);
    assert.equal(h.get('cash_accounts/hq').balance,900);assert.equal(h.get('budgets/rent').spent,100);
    const expense=h.get('expenses/bill-rent-2026-10');assert.equal(expense.branch,'Maa');assert.equal(expense.category,'Rent');assert.equal(expense.amount,100);assert.equal(expense.timestamp.toISOString(),'2026-10-04T04:00:00.000Z');
    assert.equal(h.get('account_logs/bill-rent-2026-10').newBalance,900);assert.ok(h.retries()>0);
    assert.equal((await recordBillPayment(h.api,payment)).alreadyPaid,true);
});
test('a lost acknowledgement can be retried without deducting cash again; rejected commit leaves all records unchanged',async()=>{
    const h=paymentEnv();h.loseNextAck();await assert.rejects(recordBillPayment(h.api,payment),/Connection lost/);await recordBillPayment(h.api,payment);assert.equal(h.get('cash_accounts/hq').balance,900);
    const failed=paymentEnv();failed.failNextCommit();await assert.rejects(recordBillPayment(failed.api,payment),/Commit rejected/);assert.equal(failed.get('cash_accounts/hq').balance,1000);assert.equal(failed.get('expenses/bill-rent-2026-10'),undefined);assert.equal(failed.get('budgets/rent').billPayments,undefined);
});
test('bill payment refuses missing schedule, insufficient funds, denied branch and conflicting duplicate',async()=>{
    const h=paymentEnv();await assert.rejects(recordBillPayment(h.api,{...payment,amount:1500}),/insufficient/);await assert.rejects(recordBillPayment(h.api,{...payment,allowedBranch:branch=>branch==='Maa'}),/outside/);
    h.put('budgets/rent',{branch:'Maa',category:'Rent'});await assert.rejects(recordBillPayment(h.api,payment),/schedule/);assert.equal(h.get('cash_accounts/hq').balance,1000);
    const paid=paymentEnv();await recordBillPayment(paid.api,payment);await assert.rejects(recordBillPayment(paid.api,{...payment,amount:120}),/already paid/);assert.equal(paid.get('cash_accounts/hq').balance,900);
});
test('late bill payment records actual payment month for Financial Flow and preserves original due month',async()=>{
    const h=paymentEnv();h.put('budgets/rent',{branch:'Maa',category:'Rent',limit:100,spent:30,currentMonth:'2026-09',...billSchedule({dueDate:'2026-09-03',reminderDays:3,reminderTime:'09:00'})});
    await recordBillPayment(h.api,{...payment,month:'2026-09'});const b=h.get('budgets/rent'),exp=h.get('expenses/bill-rent-2026-09');assert.equal(b.spent,100);assert.equal(b.currentMonth,'2026-10');assert.equal(exp.billingMonth,'2026-09');assert.equal(exp.paymentDate,'2026-10-04');assert.equal(exp.billDueDate,'2026-09-03');
});

test('one variable bill month changes the forecast without touching other months, cash, or reminders',async()=>{
    const h=paymentEnv(),original=h.get('budgets/rent');
    await saveBillAmount(h.api,{billId:'rent',month:'2026-10',amount:145.25,schedule:original,actor:'manager',allowedBranch:()=>true});
    const b=h.get('budgets/rent');assert.equal(billAmount(b,'2026-10'),145.25);assert.equal(billAmount(b,'2026-11'),100);assert.equal(b.limit,100);assert.equal(b.billStartDate,original.billStartDate);assert.equal(b.billReminderTime,original.billReminderTime);
    assert.equal(h.get('cash_accounts/hq').balance,1000);assert.equal(h.get('expenses/bill-rent-2026-10'),undefined);
    const rows=billsForPeriod([{id:'rent',...b}],'Maa',new Date('2026-10-01T00:00:00+08:00'),new Date('2026-11-30T23:59:00+08:00'));
    assert.deepEqual(rows.map(r=>r.amount),[145.25,100]);
});
test('changing the default preserves earlier bills and existing future overrides',async()=>{
    const h=paymentEnv(),b={...h.get('budgets/rent'),...billSchedule({dueDate:'2026-08-03',reminderDays:3,reminderTime:'09:00'}),billAmounts:{'2026-09':115,'2026-12':180}};h.put('budgets/rent',b);
    await saveBillAmount(h.api,{billId:'rent',month:'2026-10',amount:140,schedule:b,useAsDefault:true,actor:'manager',allowedBranch:()=>true});
    const saved=h.get('budgets/rent');assert.deepEqual(['2026-08','2026-09','2026-10','2026-11','2026-12'].map(m=>billAmount(saved,m)),[100,115,140,140,180]);
});
test('concurrent edits of different billing months preserve both amounts',async()=>{
    const h=paymentEnv(),b=h.get('budgets/rent'),base={billId:'rent',schedule:b,actor:'manager',allowedBranch:()=>true};
    await Promise.all([saveBillAmount(h.api,{...base,month:'2026-10',amount:123}),saveBillAmount(h.api,{...base,month:'2026-11',amount:156})]);
    assert.deepEqual(h.get('budgets/rent').billAmounts,{'2026-10':123,'2026-11':156});assert.ok(h.retries()>0);
});
test('paid utility bills retain the actual paid amount and cannot be edited into another amount',async()=>{
    const h=paymentEnv(),b=h.get('budgets/rent');await recordBillPayment(h.api,{...payment,amount:120});
    assert.equal(billAmount(h.get('budgets/rent'),'2026-10'),120);
    await assert.rejects(saveBillAmount(h.api,{billId:'rent',month:'2026-10',amount:130,schedule:b,actor:'manager',allowedBranch:()=>true}),/already paid/);
    await saveBillAmount(h.api,{billId:'rent',month:'2026-10',amount:120,schedule:b,actor:'manager',allowedBranch:()=>true});
    assert.equal(h.get('expenses/bill-rent-2026-10').amount,120);assert.equal(h.get('cash_accounts/hq').balance,880);
});
test('variable bill edits reject invalid amounts, months, first-date changes and unauthorized branches',async()=>{
    const h=paymentEnv(),b=h.get('budgets/rent'),base={billId:'rent',month:'2026-10',amount:120,schedule:b,actor:'manager',allowedBranch:()=>true};
    for(const amount of [0,-1,Infinity,'bad'])await assert.rejects(saveBillAmount(h.api,{...base,amount}));
    await assert.rejects(saveBillAmount(h.api,{...base,month:'2026-09'}),/first due date/);
    await assert.rejects(saveBillAmount(h.api,{...base,schedule:{...b,billStartDate:'2026-10-04'}}),/first due date/);
    await assert.rejects(saveBillAmount(h.api,{...base,allowedBranch:()=>false}),/outside/);
    assert.equal(h.get('budgets/rent').billAmounts,undefined);
});
test('failed amount edit commits preserve all earlier bill values',async()=>{
    const h=paymentEnv(),b=h.get('budgets/rent');h.failNextCommit();
    await assert.rejects(saveBillAmount(h.api,{billId:'rent',month:'2026-10',amount:125,schedule:b,actor:'manager',allowedBranch:()=>true}),/Commit rejected/);
    assert.deepEqual(h.get('budgets/rent'),b);
});
test('frozen column headings remain inside their table and release at its last row',()=>{
    assert.equal(tableHeadingOffset({naturalTop:300,tableBottom:1200,headingHeight:40,pinnedTop:128}),0);
    assert.equal(tableHeadingOffset({naturalTop:-500,tableBottom:700,headingHeight:40,pinnedTop:128}),628);
    assert.equal(tableHeadingOffset({naturalTop:-500,tableBottom:140,headingHeight:40,pinnedTop:128}),600);
    assert.equal(tableHeadingOffset({naturalTop:-500,tableBottom:100,headingHeight:40,pinnedTop:128}),560);
});
test('nested report scrollers and multi-row headings use their visible edge and full heading height',()=>{
    assert.equal(tableHeadingOffset({naturalTop:-100,tableBottom:800,headingHeight:80,pinnedTop:200}),300);
    assert.equal(tableHeadingOffset({naturalTop:100,tableBottom:140,headingHeight:80,pinnedTop:200}),0);
    assert.equal(tableHeadingOffset({naturalTop:NaN,tableBottom:800,headingHeight:80,pinnedTop:200}),0);
});
