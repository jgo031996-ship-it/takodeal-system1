import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requestHistory, historyTime } from '../takodeal-manager/request-history.js';
import * as payroll from '../takodeal-manager/payroll-safety.js';
import { firestoreHarness } from './helpers/firestore-harness.mjs';

const profile = { cashierName: 'Test Staff', scheduleNickname: 'TEST', branch: 'Test Branch', hourlyRate: 450, nightDiffRate: 50 };
test('manual and POS meal labels share one Foods category, excluding other deductions', () => {
    for (const type of ['Staff Meal','Staff Meal (POS Auto)','Manager Meal','Manager Meal (POS Auto)',' staff meal (pos auto) ']) {
        assert.equal(payroll.isMealDeduction(type), true, type);
    }
    for (const type of ['Cash Advance','Company Loan Payment','Missing Stock Penalty','Staff Meal Refund','Meal Allowance',null]) {
        assert.equal(payroll.isMealDeduction(type), false, String(type));
    }
});
const at = time => new Date(`2026-10-03T${time}:00+08:00`);
function schedule(end = '23:30', type = 'mid') {
    return { currentYear: 2026, currentMonth: 10, currentSchedule: { 3: { 'Test Branch': { scheduled: { mid: 'TEST' } } } },
        branchConfig: { 'Test Branch': [{ id: 'mid', name: 'Evening service', shiftType: type,
            startTime: '15:30', endTime: end, active: true, days: [0,1,2,3,4,5,6] }] } };
}
const match = (s = schedule(), time = at('15:41')) => payroll.resolveScheduledShift(time, 'Test Branch', 'Test Staff', s, { 'Test Staff': profile });

test('scheduled Mid at 11:30 PM earns employee bonus without crossing midnight', () => {
    const shift = match();
    assert.equal(shift.lateMinutes, 11);
    assert.equal(shift.wasScheduled, true);
    assert.equal(payroll.earnedNightBonus(profile, shift, at('23:29')), 0);
    assert.equal(payroll.earnedNightBonus(profile, shift, at('23:30')), 50);
    assert.deepEqual(payroll.latePay(11, profile, shift), { hours: 1, ratePerHour: 62.5, amount: 62.5 });
});
test('changing the saved branch time changes the qualification, including overnight shifts', () => {
    assert.equal(payroll.earnedNightBonus(profile, match(schedule('23:00')), at('23:00')), 50);
    assert.equal(payroll.earnedNightBonus(profile, match(schedule('23:30')), at('23:00')), 0);
    const overnight = match(schedule('02:00'));
    assert.equal(overnight.expectedEndAt.toISOString(), '2026-10-03T18:00:00.000Z');
    assert.equal(payroll.earnedNightBonus(profile, overnight, new Date('2026-10-04T02:00:00+08:00')), 50);
});
test('each branch and each Mid slot retains its own times and assignments', () => {
    const s = schedule();
    s.branchConfig['Other Branch'] = [{ id:'mid2', name:'Mid 2', shiftType:'mid', startTime:'17:00', endTime:'23:00', active:true }];
    s.currentSchedule[3]['Other Branch'] = { scheduled: { mid2:'OTHER' } };
    const other = payroll.resolveScheduledShift(at('17:00'), 'Other Branch','Other Staff',s,{ 'Other Staff': {scheduleNickname:'OTHER'} });
    assert.equal(other.shiftId,'mid2');
    assert.equal(payroll.earnedNightBonus(profile, other,at('23:00')),50);
    assert.equal(payroll.earnedNightBonus(profile,match(s),at('23:00')),0);
});
test('Morning/Other cannot earn a Mid bonus just because time-out crosses midnight', () => {
    assert.equal(payroll.earnedNightBonus(profile, match(schedule('02:00','morning')),new Date('2026-10-04T02:00:00+08:00')),0);
    assert.equal(payroll.bonusShift({id:'mid',name:'Mid',shiftType:'other'}),false);
    assert.equal(payroll.bonusShift({id:'x',name:'Renamed',shiftType:'night'}),true);
});
test('zero bonus is respected and legacy labels parse AM/PM correctly', () => {
    assert.equal(payroll.earnedNightBonus({...profile,nightDiffRate:0},match(),at('23:30')),0);
    assert.deepEqual(payroll.shiftTimes({name:'Mid (4:30pm-12:30am)'}),{start:990,end:30});
    assert.equal(payroll.timeMinutes('12:30'),750);
    assert.equal(payroll.timeMinutes('12nn'),720);
    assert.equal(payroll.timeMinutes('24:99'),null);
    assert.throws(()=>payroll.validateShiftConfig({name:'Mid',startTime:'16:30',endTime:'12:30',active:true}),/AM\/PM/);
});
test('new active shifts require valid times; inactive slots remain available for later setup', () => {
    assert.throws(()=>payroll.validateShiftConfig({name:'Mid 2',active:true}),/both/);
    assert.doesNotThrow(()=>payroll.validateShiftConfig({name:'Mid 2',active:false}));
    assert.doesNotThrow(()=>payroll.validateShiftConfig({name:'Night',startTime:'18:30',endTime:'03:00'}));
});
test('hour rounding and exemptions follow the owner policy', () => {
    for (const [mins,hours] of [[0,0],[1,1],[11,1],[60,1],[61,2],[121,3]]) {
        assert.equal(payroll.latePay(mins,profile,null).hours,hours);
    }
    assert.equal(payroll.latePay(11,profile,null).amount,56.25);
    assert.equal(payroll.latePay(61,profile,match(),true).amount,0);
    assert.equal(payroll.attendanceLateMinutes({reviewedLateMinutes:11,lateMinutes:25},80),11);
});
test('a post-midnight time-in matches the previous scheduled business day', () => {
    const s = schedule('03:00'); s.branchConfig['Test Branch'][0].startTime='23:30';
    const shift=match(s,new Date('2026-10-04T00:11:00+08:00'));
    assert.equal(shift.wasScheduled,true); assert.equal(shift.lateMinutes,41);
    assert.equal(shift.expectedStartAt.toISOString(),'2026-10-03T15:30:00.000Z');
});
test('early arrival never becomes late and ambiguous fallback does not invent a shift', () => {
    assert.equal(match(schedule(),at('15:00')).lateMinutes,0);
    const s=schedule(); s.currentSchedule={}; s.branchConfig['Test Branch'].push({...s.branchConfig['Test Branch'][0],id:'mid2',endTime:'23:45'});
    assert.equal(match(s),null);
});
function decisionFixture() {
    const h=firestoreHarness();
    const stamp={seconds:Math.floor(at('15:41').getTime()/1000)};
    h.put('staff_requests/letter',{type:'Reason Letter',explanationCause:'Tardiness / Late Arrival',
        explanationMessage:'Clocked in 11 minutes late. Reason: test',staffName:'Test Staff',branch:'Test Branch',
        status:'Pending',timestamp:stamp});
    h.put('attendance_logs/punch',{staffName:'Test Staff',branch:'Test Branch',type:'TIME IN',timestamp:stamp});
    return h;
}
const decide=(h,action='Rejected',attendanceId='punch')=>payroll.reviewLateRequest(h.api,{requestId:'letter',attendanceId,action,reply:'Test decision',actor:'Test Manager'});
test('Reject updates the matching attendance once, without a second ledger charge',async()=>{
    const h=decisionFixture(); await Promise.all(Array.from({length:15},()=>decide(h)));
    assert.equal(h.get('attendance_logs/punch').lateExempted,false);
    assert.equal(h.get('attendance_logs/punch').reviewedLateMinutes,11);
    assert.equal(h.get('staff_requests/letter').lateDeductionHours,1);
    assert.equal([...h.docs.keys()].some(path=>path.startsWith('staff_deductions/')),false);
});
test('Approve atomically exempts attendance; a lost response can be retried safely',async()=>{
    const h=decisionFixture();h.loseNextAck();await assert.rejects(decide(h,'Approved'),/lost after/);
    assert.equal(h.get('attendance_logs/punch').lateExempted,true);
    assert.deepEqual(await decide(h,'Approved'),{repeated:true});
    await assert.rejects(decide(h,'Rejected'),/already reviewed/);
});
test('failed transaction leaves both the letter and the clock-in unchanged',async()=>{
    const h=decisionFixture();h.failNextCommit();await assert.rejects(decide(h,'Approved'));
    assert.equal(h.get('staff_requests/letter').status,'Pending');
    assert.equal(h.get('attendance_logs/punch').lateExempted,undefined);
});
test('a letter cannot change another staff member, branch, punch type, or linked entry',async()=>{
    for (const change of [{staffName:'Other Staff'},{branch:'Other Branch'},{type:'TIME OUT'},{lateReasonRequestId:'other-letter'}]) {
        const h=decisionFixture();h.put('attendance_logs/punch',{...h.get('attendance_logs/punch'),...change});
        await assert.rejects(decide(h));assert.equal(h.get('staff_requests/letter').status,'Pending');
    }
    const h=decisionFixture();h.put('staff_requests/letter',{...h.get('staff_requests/letter'),attendanceLogId:'other-punch'});
    await assert.rejects(decide(h),/different clock-in/);
});
test('legacy matching keeps ambiguous entries separate and filters unrelated attendance',()=>{
    const h=decisionFixture(),req=h.get('staff_requests/letter'),p=h.get('attendance_logs/punch');
    const rows=[{...p,id:'a'},{...p,id:'b'},{...p,id:'wrong',branch:'Other Branch'},
        {...p,id:'old',timestamp:{seconds:p.timestamp.seconds-3600}}];
    assert.deepEqual(payroll.legacyAttendanceCandidates(req,rows).map(x=>x.id),['a','b']);
    assert.throws(()=>payroll.requestLateMinutes({...req,explanationMessage:'no minutes'},{}),/no recorded/);
});
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function extract(name) {
    const start=source.indexOf(`
window.${name} = `) + 1;
    assert.ok(start>=0);
    return source.slice(start,source.indexOf('\n};',start)+3);
}
function payrollUi({exempt=false,end='23:30',type='mid',frozen=null,logs=null,scheduleData=null,startDate='2026-10-03',endDate='2026-10-03',deductions=[]}={}) {
    const elements={payrollStart:{value:startDate},payrollEnd:{value:endDate},payrollGeneratorBody:{innerHTML:''},payrollGrandTotalContainer:{style:{}},payrollGrandTotalAmount:{}};
    const errors=[];
    const stamp=date=>({toDate:()=>date});
    const data={cashiers:[profile],staff_ledger:[],payroll_records:frozen?[{staffName:'Test Staff',frozenData:frozen}]:[],
        attendance_logs:logs || [{staffName:'Test Staff',branch:'Test Branch',type:'TIME IN',timestamp:stamp(at('15:41')),lateExempted:exempt,reviewedLateMinutes:11},
            {staffName:'Test Staff',branch:'Test Branch',type:'TIME OUT',timestamp:stamp(at(end))}],staff_deductions:deductions,staff_bonuses:[]};
    const api={db:{},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),query:ref=>ref,where:()=>({}),orderBy:()=>({}),
        getDoc:async()=>({exists:()=>true,data:()=>scheduleData || schedule(end,type)}),
        getDocs:async q=>{const docs=(data[q.table]||[]).filter(row=>q.table!=='staff_deductions' || row.status==='Unpaid').map((row,i)=>({id:String(i),data:()=>row}));return {docs,forEach:fn=>docs.forEach(fn)};}};
    const window={...api,globalPayrollCache:{},isBranchAllowed:()=>true};
    const context=vm.createContext({...api,...payroll,window,Date,document:{getElementById:id=>elements[id]||null},
        alert:message=>errors.push(message),console:{error:(...message)=>errors.push(message),log:()=>{}}});
    return {context,window,elements,errors};
}
for(const name of ['loadPayrollGenerator','generateAutoPayslips']) {
    test(`${name}: POS meals of 224 and 106.25 reach Foods and reduce net pay once`,async()=>{
        const deduct=(amount,day,type='Staff Meal (POS Auto)',status='Unpaid')=>({staffName:'Test Staff',type,amount,status,dateAdded:{toDate:()=>new Date(`2026-${day}T12:00:00+08:00`)}});
        const deductions=[deduct(224,'09-23'),deduct(106.25,'09-28'),deduct(0,'09-18','Staff Meal'),
            deduct(136,'09-09','Staff Meal','Paid'),deduct(50,'10-01'),deduct(500,'09-23','Cash Advance'),deduct(1500,'09-25','Company Loan Issued')];
        const h=payrollUi({logs:[],startDate:'2026-09-16',endDate:'2026-09-30',deductions});
        vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);const row=h.window.globalPayrollCache['Test Staff'];
        assert.equal(row.meals,330.25);assert.equal(row.advances,500);
        assert.match(h.elements.payrollGeneratorBody.innerHTML,/-₱330\.25 \(Meals\)/);
        // Re-generating an unpaid preview must not accumulate the same meal twice.
        await h.window[name]();assert.equal(h.window.globalPayrollCache['Test Staff'].meals,330.25);
    });
    test(`${name}: unpaid manual/manager meals carry forward, while a paid snapshot stays frozen`,async()=>{
        const deductions=['Staff Meal','Manager Meal','Manager Meal (POS Auto)'].map(type=>({staffName:'Test Staff',type,amount:10,status:'Unpaid',dateAdded:{toDate:()=>new Date('2026-09-10T12:00:00+08:00')}}));
        const h=payrollUi({exempt:true,deductions});vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);assert.equal(h.window.globalPayrollCache['Test Staff'].meals,30);
        assert.equal(h.elements.payrollGrandTotalAmount.innerText,'₱470.00');
        const frozen={name:'Test Staff',branch:'Test Branch',basicPay:450,meals:7.5,logs:[],isPaid:true};
        const paid=payrollUi({frozen,deductions});vm.runInContext(extract(name),paid.context);await paid.window[name]();
        assert.deepEqual(paid.errors,[]);assert.deepEqual(paid.window.globalPayrollCache['Test Staff'],frozen);
    });
    test(`${name}: real UI calculation includes one Mid bonus and one rounded late deduction`,async()=>{
        const h=payrollUi();vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);const row=h.window.globalPayrollCache['Test Staff'];
        assert.equal(row.nightBonus,50);assert.equal(row.lateDeduction,62.5);assert.equal(row.basicPay,450);
        assert.equal(row.logs.length,1);
        assert.equal(h.elements.payrollGrandTotalAmount.innerText,'₱437.50');
    });
    test(`${name}: approved attendance is exempt and frozen paid payroll remains unchanged`,async()=>{
        const h=payrollUi({exempt:true});vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);assert.equal(h.window.globalPayrollCache['Test Staff'].lateDeduction,0);
        const frozen={name:'Test Staff',branch:'Test Branch',hours:8,lateDeduction:123,nightBonus:77,basicPay:456,logs:[]};
        const paid=payrollUi({frozen});vm.runInContext(extract(name),paid.context);await paid.window[name]();
        assert.deepEqual(paid.errors,[]);assert.deepEqual(paid.window.globalPayrollCache['Test Staff'],frozen);
    });
}
test('manual OT uses selected shift category and the employee bonus rate',()=>{
    const elements={manOtStaff:{value:'Test Staff'},manOtDate:{value:'2026-10-03'},manOtHours:{value:'1'},manOtCalcAmount:{},manOtRateInfo:{}};
    const window={otCache:{staff:{'Test Staff':profile},schedule:schedule()}};
    const context=vm.createContext({...payroll,window,document:{getElementById:id=>elements[id]}});
    vm.runInContext(extract('calcAutoOvertime'),context);window.calcAutoOvertime();
    assert.equal(window.currentCalculatedOtAmount,62.5);
    window.otCache.schedule=schedule('23:30','morning');window.calcAutoOvertime();assert.equal(window.currentCalculatedOtAmount,56.25);
});
test('the generated Foods deduction is subtracted from the payslip total and net pay',()=>{
    const elements=Object.fromEntries(['psBasicPay','psOvertime','psStraightBonus','psHoliday','psPerfBonus','psLate','psSSS','psPhil','psPagibig','psAdvance','psLoans','psFoods','psGross','psTotalDeduct','psNetPay'].map(id=>[id,{tagName:'INPUT',value:'0',innerText:''}]));
    Object.assign(elements.psBasicPay,{value:'5830'});elements.psAdvance.value='500';elements.psLoans.value='250';elements.psFoods.value='330.25';
    const context={window:{},document:{getElementById:id=>elements[id],querySelectorAll:()=>[{value:'50'}]}};
    vm.runInNewContext(extract('recalcPayslip'),context);context.window.recalcPayslip();
    assert.equal(elements.psTotalDeduct.innerText,'1,130.25');assert.equal(elements.psNetPay.innerText,'4,699.75');
});
function paymentFixture(food=330.25) {
    const stamp=day=>({toDate:()=>new Date(`2026-${day}T12:00:00+08:00`)});
    const rows=[
        {id:'paid',staffName:'Test Staff',type:'Staff Meal',amount:136,status:'Paid',dateAdded:stamp('09-09')},
        {id:'pos-1',staffName:'Test Staff',type:'Staff Meal (POS Auto)',amount:224,status:'Unpaid',dateAdded:stamp('09-23')},
        {id:'pos-2',staffName:'Test Staff',type:'Staff Meal (POS Auto)',amount:106.25,status:'Unpaid',dateAdded:stamp('09-28')},
        {id:'future',staffName:'Test Staff',type:'Manager Meal (POS Auto)',amount:100,status:'Unpaid',dateAdded:stamp('10-04')}
    ];
    const changes=[],records=[],errors=[];
    const elements=new Map();const node=id=>{if(!elements.has(id))elements.set(id,{tagName:'INPUT',value:'0',innerText:'',style:{}});return elements.get(id);};
    node('psFoods').value=String(food);node('psNetPay').innerText='500.00';
    const api={db:{},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),query:ref=>ref,where:()=>({}),
        serverTimestamp:()=>stamp('10-04'),getDocs:async()=>({forEach:fn=>rows.forEach(row=>fn({id:row.id,data:()=>({...row})}))}),
        updateDoc:async(ref,change)=>{changes.push({ref,change});const row=rows.find(r=>ref.table==='staff_deductions'&&r.id===ref.id);if(row)Object.assign(row,change);},
        addDoc:async(ref,row)=>{records.push({table:ref.table,...row});return {id:'sample'};}};
    const window={...api,currentPayslipData:{name:'Test Staff',branch:'Test',start:'2026-09-16',end:'2026-09-30'},
        liveAccounts:[{id:'sample-account',name:'Sample account',balance:5000}],downloadPayslipImage(){},ManagerUI:{notify:text=>errors.push(text)}};
    const context={...api,...payroll,window,document:{getElementById:node},Date,Swal:{fire:async()=>({value:'0',isConfirmed:true})},console:{error:e=>errors.push(e)}};
    vm.runInNewContext(extract('finalizePayslip'),context);
    return {window,rows,changes,records,errors};
}
test('payroll clears POS meals already deducted, leaving paid and future-cutoff meals untouched',async()=>{
    const h=paymentFixture();await h.window.finalizePayslip();assert.deepEqual(h.errors,[]);
    assert.equal(h.rows.find(r=>r.id==='pos-1').status,'Paid');assert.equal(h.rows.find(r=>r.id==='pos-2').status,'Paid');
    assert.equal(h.rows.find(r=>r.id==='future').status,'Unpaid');
    assert.equal(h.changes.some(r=>r.ref.id==='paid'||r.ref.id==='future'),false);
    const saved=h.records.find(r=>r.table==='payroll_records');assert.equal(saved.frozenData.meals,330.25);
});
test('an edited partial Foods amount leaves only its undeducted balance for the next payroll',async()=>{
    const h=paymentFixture(250);await h.window.finalizePayslip();assert.deepEqual(h.errors,[]);
    assert.equal(h.rows.find(r=>r.id==='pos-1').status,'Paid');
    assert.equal(h.rows.find(r=>r.id==='pos-2').status,'Unpaid');assert.equal(h.rows.find(r=>r.id==='pos-2').amount,80.25);
});
test('Manager and Staff serve identical shared math; source links new letters to attendance atomically',()=>{
    assert.equal(readFileSync(new URL('../takodeal-staff/payroll-safety.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/payroll-safety.js',import.meta.url),'utf8'));
    const staff=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
    assert.match(staff,/attendanceLogId: attendanceRef.id/);assert.match(staff,/attendance.lateReasonRequestId = lateRequestRef.id/);
    assert.match(staff,/batch.set\(lateRequestRef, pendingLateRequest\)/);assert.match(staff,/batch.set\(attendanceRef, attendance\)/);
    assert.doesNotMatch(source,/if \(outHour >= 0 && outHour <= 4\)/);
});


function repeatedNightSchedule() {
    return { currentYear:2026,currentMonth:10,currentSchedule:{},branchConfig:{'Test Branch':[
        {id:'m1',name:'Morning',shiftType:'morning',startTime:'10:00',endTime:'18:30',active:true},
        {id:'mid',name:'Mid',shiftType:'mid',startTime:'13:00',endTime:'20:30',active:true},
        ...['n1','n2','n3'].map(id=>({id,name:'Night '+id,shiftType:'night',startTime:'18:30',endTime:'03:00',active:true}))
    ]}};
}
test('identical Night staff slots resolve a common rule without assigning an arbitrary employee slot',()=>{
    const s=repeatedNightSchedule();
    const shift=payroll.resolveScheduledShift(new Date('2026-09-17T18:30:00+08:00'),'Test Branch','Test Staff',s,{'Test Staff':profile});
    assert.ok(shift);assert.equal(shift.shiftId,null);assert.equal(shift.shiftType,'night');
    assert.deepEqual(shift.matchingShiftIds,['n1','n2','n3']);assert.equal(shift.wasScheduled,false);
    assert.equal(payroll.earnedNightBonus(profile,shift,new Date('2026-09-18T03:18:00+08:00')),50);
    assert.equal(payroll.earnedNightBonus(profile,shift,new Date('2026-09-18T02:59:00+08:00')),0);
});
test('conflicting staff slots still need an assignment and cannot silently earn a bonus',()=>{
    for(const change of [{endTime:'04:00'},{shiftType:'mid'},{shiftType:'morning'}]) {
        const s=repeatedNightSchedule();Object.assign(s.branchConfig['Test Branch'][2],change);
        assert.equal(payroll.resolveScheduledShift(new Date('2026-09-17T18:30:00+08:00'),'Test Branch','Test Staff',s,{'Test Staff':profile}),null);
    }
    const s=repeatedNightSchedule();s.currentMonth=9;s.currentSchedule={17:{'Test Branch':{scheduled:{n1:'TEST'}}}};
    s.branchConfig['Test Branch'][2].endTime='04:00';
    const shift=payroll.resolveScheduledShift(new Date('2026-09-17T18:30:00+08:00'),'Test Branch','Test Staff',s,{'Test Staff':profile});
    assert.equal(shift.shiftId,'n1');assert.equal(shift.wasScheduled,true);
    assert.equal(payroll.earnedNightBonus(profile,shift,new Date('2026-09-18T03:18:00+08:00')),0);
});
for(const name of ['loadPayrollGenerator','generateAutoPayslips']) {
    test(`${name}: prior cutoff with eight Night and four Mid shifts earns all twelve bonuses once`,async()=>{
        const logs=[],stamp=date=>({toDate:()=>new Date(date)});
        const punch=(day,start,end,overnight=false)=>{
            logs.push({staffName:'Test Staff',branch:'Test Branch',type:'TIME IN',timestamp:stamp(`2026-09-${day}T${start}:00+08:00`)});
            logs.push({staffName:'Test Staff',branch:'Test Branch',type:'TIME OUT',timestamp:stamp(`2026-09-${overnight?day+1:day}T${end}:00+08:00`)});
        };
        for(const day of [17,18,19,20,21,22,28,29])punch(day,'18:30','03:18',true);
        for(const day of [24,25,26,30])punch(day,'13:00','21:30');
        punch(27,'10:00','18:40');
        logs.sort((a,b)=>a.timestamp.toDate()-b.timestamp.toDate());
        const h=payrollUi({logs,scheduleData:repeatedNightSchedule(),startDate:'2026-09-16',endDate:'2026-09-30'});
        vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);const row=h.window.globalPayrollCache['Test Staff'];
        assert.equal(row.nightBonus,600);assert.equal(row.basicPay,5850);assert.equal(row.logs.length,13);
        assert.equal(row.logs.filter(log=>/Night bonus: \+₱50.00/.test(log.remark)).length,8);
        assert.equal(row.logs.filter(log=>/Mid bonus: \+₱50.00/.test(log.remark)).length,4);
        assert.equal(h.elements.payrollGrandTotalAmount.innerText,'₱6,450.00');
    });
}


test('no matching shift returns null for empty, inactive, invalid and out-of-window configurations',()=>{
    const cases = [
        {configs:[],time:'15:41'},
        {configs:[{id:'mid',startTime:'15:30',endTime:'23:30',active:false}],time:'15:41'},
        {configs:[{id:'mid',startTime:'invalid',endTime:'23:30'}],time:'15:41'},
        {configs:[{id:'mid',startTime:'15:30',endTime:'23:30',days:[0]}],time:'15:41'},
        {configs:[{id:'mid',startTime:'15:30',endTime:'23:30'}],time:'06:00'}
    ];
    for(const {configs,time} of cases) {
        const s=schedule();s.currentSchedule={};s.branchConfig['Test Branch']=configs;
        const shift=match(s,at(time));
        assert.equal(shift,null);
        assert.equal(payroll.earnedNightBonus(profile,shift,at('23:30')),0);
        assert.deepEqual(payroll.calculateLateMinutes(at(time),'Test Branch','Test Staff',s),
            {lateMinutes:0,expectedStartHour:null,wasScheduled:false});
    }
});
for(const name of ['loadPayrollGenerator','generateAutoPayslips']) {
    test(`${name}: unmatched clock-in keeps attendance and does not abort other eligible shifts`,async()=>{
        const stamp=date=>({toDate:()=>new Date(date)});
        const logs=[
            {staffName:'Test Staff',branch:'Test Branch',type:'TIME IN',timestamp:stamp('2026-09-17T06:00:00+08:00')},
            {staffName:'Test Staff',branch:'Test Branch',type:'TIME OUT',timestamp:stamp('2026-09-17T14:00:00+08:00')},
            {staffName:'Test Staff',branch:'Test Branch',type:'TIME IN',timestamp:stamp('2026-09-17T18:30:00+08:00')},
            {staffName:'Test Staff',branch:'Test Branch',type:'TIME OUT',timestamp:stamp('2026-09-18T03:00:00+08:00')}
        ];
        const h=payrollUi({logs,scheduleData:repeatedNightSchedule(),startDate:'2026-09-16',endDate:'2026-09-30'});
        vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);
        const row=h.window.globalPayrollCache['Test Staff'];
        assert.equal(row.basicPay,900);assert.equal(row.nightBonus,50);assert.equal(row.lateDeduction,0);
        assert.equal(row.logs.length,2);assert.equal(row.logs[0].hrs,'8.00');
        assert.doesNotMatch(row.logs[0].remark,/bonus|Late/);
        assert.match(row.logs[1].remark,/Night bonus: \+₱50.00/);
        assert.equal(h.elements.payrollGrandTotalAmount.innerText,'₱950.00');
    });
}

const historyStamp = day => ({toDate:()=>new Date(`2026-09-${String(day).padStart(2,'0')}T12:00:00+08:00`)});
const autoMeal = (id, amount=77, day=30, extra={}) => ({id,staffName:'Test Staff',type:'Staff Meal (POS Auto)',amount,
    dateAdded:historyStamp(day),status:'Unpaid',branch:'Test Branch',...extra});
test('resolved history includes orphan automatic meals, retaining Paid and Unpaid ledger states',()=>{
    const rows=requestHistory([{id:'manual',type:'Staff Meal',status:'Approved',timestamp:historyStamp(8),staffName:'Test Staff'}],
        [autoMeal('meal1'),autoMeal('meal2',77,30),autoMeal('paid',68,8,{status:'Paid'}),autoMeal('refund',1,9,{type:'Staff Meal Refund'})]);
    assert.equal(rows.length,4);assert.equal(rows.filter(row=>row.historySource==='deduction').length,3);
    assert.equal(rows.find(row=>row.id==='paid').deductionStatus,'Paid');assert.equal(rows[0].deductionStatus,'Unpaid');
    assert.equal(rows[0].status,'Recorded');assert.equal(rows.filter(row=>row.amount===77).length,2);
});
test('resolved history pairs request links and exact legacy records once without duplicating or mutating them',()=>{
    const request={id:'request',staffName:'Test Staff',type:'Staff Meal (POS Auto)',status:'Approved',amount:77,timestamp:historyStamp(30)};
    for(const ledger of [autoMeal('linked',30,28,{requestId:'request'}),autoMeal('legacy')]) {
        const rows=requestHistory([request],[ledger]);assert.equal(rows.length,1);assert.equal(rows[0].deductionStatus,'Unpaid');
        assert.equal(request.deductionStatus,undefined);
    }
    const two=requestHistory([request],[autoMeal('one'),autoMeal('two')]);assert.equal(two.length,2);
    const pending=requestHistory([{...request,status:'Pending'}],[autoMeal('one')]);
    assert.equal(pending.length,2);assert.equal(pending.filter(row=>row.status==='Pending').length,1);
});
test('history does not pair separate receipts or meals on different times; franchise rows stay in their branch',()=>{
    const request={id:'request',staffName:'Test Staff',type:'Staff Meal',status:'Approved',amount:77,timestamp:historyStamp(30),receiptId:'one',branch:'Test Branch'};
    assert.equal(requestHistory([request],[autoMeal('two',77,30,{receiptId:'two'})]).length,2);
    assert.equal(requestHistory([request],[autoMeal('old',77,29)]).length,2);
    const rows=requestHistory([request,{...request,id:'other',branch:'Other'}],[autoMeal('foreign',21,29,{branch:'Other'}),autoMeal('legacy',21,29,{branch:''}),autoMeal('own',21,29)],'Test Branch');
    assert.deepEqual(rows.map(row=>row.id),['request','own']);
    assert.equal(historyTime('bad date'),0);assert.equal(historyTime({seconds:123}),123000);
});
test('the real Inbox renders ledger-only POS meals without putting them in pending approvals or writing data',async()=>{
    const nodes=Object.fromEntries(['inboxTableBody','resolvedRequestsBody','inboxBadge'].map(id=>[id,{innerHTML:'',style:{}}]));
    const requests=[{id:'approved',staffName:'Test Staff',type:'Staff Meal',status:'Approved',amount:68,timestamp:historyStamp(8)}];
    const deductions=[autoMeal('one'),autoMeal('two',77,30),autoMeal('paid',68,8,{status:'Paid'})];
    const calls=[],errors=[];
    const window={sessionUser:{isFranchisee:false}};
    const context={window,requestHistory,historyTime,isMealDeduction:payroll.isMealDeduction,db:{},
        escapeHtml:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
        collection:(_,table)=>({table}),query:ref=>ref,orderBy:()=>({}),where:()=>({}),
        getDocs:async ref=>{calls.push(ref.table);return {forEach:fn=>(ref.table==='staff_requests'?requests:deductions).forEach(row=>fn({id:row.id,data:()=>row}))};},
        document:{getElementById:id=>nodes[id]},console:{error:e=>errors.push(e)}};
    vm.runInNewContext(extract('loadInbox'),context);await window.loadInbox();
    assert.deepEqual(errors,[]);assert.deepEqual(calls,['staff_requests','staff_deductions']);
    assert.match(nodes.resolvedRequestsBody.innerHTML,/View 3 Records/);
    assert.equal((nodes.resolvedRequestsBody.innerHTML.match(/Recorded automatically by POS/g)||[]).length,2);
    assert.match(nodes.resolvedRequestsBody.innerHTML,/>Paid<\/span>/);assert.match(nodes.resolvedRequestsBody.innerHTML,/>Unpaid<\/span>/);
    assert.match(nodes.inboxTableBody.innerHTML,/No pending requests/);assert.equal(nodes.inboxBadge.innerText,0);
});
