import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as payroll from '../takodeal-manager/payroll-safety.js';
import { firestoreHarness } from './helpers/firestore-harness.mjs';

const profile = { cashierName: 'Test Staff', scheduleNickname: 'TEST', branch: 'Test Branch', hourlyRate: 450, nightDiffRate: 50 };
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
    const s=schedule(); s.currentSchedule={}; s.branchConfig['Test Branch'].push({...s.branchConfig['Test Branch'][0],id:'mid2'});
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
function payrollUi({exempt=false,end='23:30',type='mid',frozen=null}={}) {
    const elements={payrollStart:{value:'2026-10-03'},payrollEnd:{value:'2026-10-03'},payrollGeneratorBody:{innerHTML:''}};
    const errors=[];
    const stamp=date=>({toDate:()=>date});
    const data={cashiers:[profile],staff_ledger:[],payroll_records:frozen?[{staffName:'Test Staff',frozenData:frozen}]:[],
        attendance_logs:[{staffName:'Test Staff',branch:'Test Branch',type:'TIME IN',timestamp:stamp(at('15:41')),lateExempted:exempt,reviewedLateMinutes:11},
            {staffName:'Test Staff',branch:'Test Branch',type:'TIME OUT',timestamp:stamp(at(end))}],staff_deductions:[],staff_bonuses:[]};
    const api={db:{},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),query:ref=>ref,where:()=>({}),orderBy:()=>({}),
        getDoc:async()=>({exists:()=>true,data:()=>schedule(end,type)}),
        getDocs:async q=>{const docs=(data[q.table]||[]).map((row,i)=>({id:String(i),data:()=>row}));return {docs,forEach:fn=>docs.forEach(fn)};}};
    const window={...api,globalPayrollCache:{},isBranchAllowed:()=>true};
    const context=vm.createContext({...api,...payroll,window,Date,document:{getElementById:id=>elements[id]||null},
        alert:message=>errors.push(message),console:{error:(...message)=>errors.push(message),log:()=>{}}});
    return {context,window,elements,errors};
}
for(const name of ['loadPayrollGenerator','generateAutoPayslips']) {
    test(`${name}: real UI calculation includes one Mid bonus and one rounded late deduction`,async()=>{
        const h=payrollUi();vm.runInContext(extract(name),h.context);await h.window[name]();
        assert.deepEqual(h.errors,[]);const row=h.window.globalPayrollCache['Test Staff'];
        assert.equal(row.nightBonus,50);assert.equal(row.lateDeduction,62.5);assert.equal(row.basicPay,450);
        assert.equal(row.logs.length,1);
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
test('Manager and Staff serve identical shared math; source links new letters to attendance atomically',()=>{
    assert.equal(readFileSync(new URL('../takodeal-staff/payroll-safety.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/payroll-safety.js',import.meta.url),'utf8'));
    const staff=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');
    assert.match(staff,/attendanceLogId: attendanceRef.id/);assert.match(staff,/attendance.lateReasonRequestId = lateRequestRef.id/);
    assert.match(staff,/batch.set\(lateRequestRef, pendingLateRequest\)/);assert.match(staff,/batch.set\(attendanceRef, attendance\)/);
    assert.doesNotMatch(source,/if \(outHour >= 0 && outHour <= 4\)/);
});
