import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {saveStaffProfileAtomic,staffProfileOperation} from '../takodeal-manager/staff-rate-changes.js';
import {staffRateForDate,staffRateDate,staffRateWorkDate,staffProfileForWork,loadStaffSalaryTimeline,payrollSalaryProfile,assertPayrollSalaryFresh} from '../takodeal-manager/staff-rate-model.js';
import {latePay} from '../takodeal-manager/payroll-safety.js';
import {attendanceEstimate} from '../takodeal-franchise/franchise-data.js';
const at=value=>new Date(value+'T12:00:00+08:00');
function fixture(){
 const h=firestoreHarness();h.api.auth={currentUser:{uid:'hq',email:'hr@example.test',emailVerified:true}};h.api.sessionUser={uid:'hq',email:'hr@example.test',cashierName:'Sample HR'};
 h.api.getDocFromServer=async ref=>({exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
 h.put('hq_managers/hr',{email:'hr@example.test',pin:'1234',role:'Manager',permissions:['payroll'],assignedBranch:'All'});h.put('hq_email_access/hr@example.test',{active:true,permissions:['payroll'],allowedBranches:['All']});
 h.put('cashiers/staff',{cashierName:'Sample Staff',branch:'Maa',role:'Crew',hourlyRate:450,pin:'1111'});
 h.put('payroll_records/old',{staffName:'Sample Staff',status:'Paid',frozenData:{basicPay:4500,hourlyRate:450}});
 return h;
}
const payload=rate=>({cashierName:'Sample Staff',branch:'Maa',role:'Crew',hourlyRate:rate,pin:'1111'});
const save=(h,rate,date,id,options={})=>saveStaffProfileAtomic(h.api,'staff',payload(rate),{operationId:id,effectiveDate:date,now:()=>at('2026-10-19'),...options});
const loaded=h=>loadStaffSalaryTimeline(h.api,{...h.get('cashiers/staff'),staffId:'staff'});

test('first dated increase preserves legacy baseline before effective date and saved paid payroll',async()=>{
 const h=fixture(),paid=structuredClone(h.get('payroll_records/old'));
 await save(h,500,'2026-10-19','increase',{expectedRate:450,expectedRateRevision:null});const p=await loaded(h);
 assert.equal(staffRateForDate(p,'2026-10-18'),450);assert.equal(staffRateForDate(p,'2026-10-19'),500);assert.equal(staffRateForDate(p,'2025-01-01'),450);
 assert.equal(h.get('staff_rate_changes/increase').effectiveDate,'2026-10-19');assert.equal(h.get('staff_rate_changes/increase').version,2);
 assert.equal(h.get('cashiers/staff').hourlyRate,500);assert.equal(Object.hasOwn(h.get('cashiers/staff'),'salaryRateTimeline'),false);assert.deepEqual(h.get('payroll_records/old'),paid);
});

test('future increases leave current profile wage and congratulations unchanged while later dates resolve automatically',async()=>{
 const h=fixture(),saved=await save(h,500,'2026-11-01','future');
 assert.equal(saved.scheduled,true);assert.equal(h.get('cashiers/staff').hourlyRate,450);assert.equal(h.get('cashiers/staff').latestRateRaise,null);
 const p=await loaded(h);assert.equal(staffRateForDate(p,'2026-10-31'),450);assert.equal(staffRateForDate(p,'2026-11-01'),500);
 await save(h,600,'2026-12-01','later',{expectedRate:450,expectedRateRevision:'future'});
 const later=await loaded(h);assert.equal(staffRateForDate(later,'2026-11-15'),500);assert.equal(staffRateForDate(later,'2026-12-01'),600);
 assert.equal(h.get('cashiers/staff').hourlyRate,450);
});

test('same-day corrections are ordered privately, with an immutable audit per confirmed change',async()=>{
 const h=fixture();await save(h,500,'2026-10-19','one');await save(h,525,'2026-10-19','two',{expectedRate:500,expectedRateRevision:'one'});
 const p=await loaded(h);assert.equal(staffRateForDate(p,'2026-10-19'),525);assert.equal(staffRateForDate(p,'2026-10-18'),450);
 assert.equal(Object.keys(p.salaryRateTimeline.rates).length,2);assert.equal(h.get('staff_rate_changes/one').toDailyRate,500);
});

test('saving contact details after scheduling a future wage cannot cancel or apply it early',async()=>{
 const h=fixture();await save(h,500,'2026-11-01','future');
 await saveStaffProfileAtomic(h.api,'staff',{...payload(450),phone:'Sample contact'},{operationId:'contact',expectedRate:450,expectedRateRevision:'future',now:()=>at('2026-10-19')});
 const p=await loaded(h);assert.equal(p.hourlyRate,450);assert.equal(staffRateForDate(p,'2026-11-01'),500);assert.equal(Object.keys(p.salaryRateTimeline.rates).length,1);
});

test('an explicit replacement on a scheduled future date can keep today’s wage without an early notice',async()=>{
 const h=fixture();await save(h,500,'2026-11-01','future');await save(h,450,'2026-11-01','replace',{expectedRateRevision:'future'});
 const p=await loaded(h);assert.equal(staffRateForDate(p,'2026-11-01'),450);assert.equal(p.hourlyRate,450);assert.equal(p.latestRateRaise,null);
 assert.equal(h.get('staff_rate_changes/replace').eventType,'decrease');assert.equal(h.get('staff_rate_changes/replace').appliesNow,false);
});

test('effective date is required for a wage change but clearing it does not block unrelated profile edits',async()=>{
 const h=fixture();await assert.rejects(save(h,500,'','missing'),/effective date/);await save(h,450,'','same');assert.equal(h.get('cashiers/staff').hourlyRate,450);
 assert.equal(h.get('staff_salary_rates/staff'),undefined);
});

test('a stale schedule revision blocks another future edit even when currently effective wage did not change',async()=>{
 const h=fixture();await save(h,500,'2026-11-01','first',{expectedRate:450,expectedRateRevision:null});
 await assert.rejects(save(h,550,'2026-12-01','stale',{expectedRate:450,expectedRateRevision:null}),/changed after/);
 assert.equal(h.get('staff_rate_changes/stale'),undefined);
});

test('lost acknowledgments and concurrent retries produce one dated event and reject different reused content',async()=>{
 const h=fixture();h.loseNextAck();await assert.rejects(save(h,500,'2026-11-01','retry'),/Connection lost/);
 const responses=await Promise.all(Array.from({length:8},()=>save(h,500,'2026-11-01','retry',{expectedRate:450,expectedRateRevision:null})));
 assert.ok(responses.every(row=>row.alreadySaved));assert.equal(Object.keys(h.get('staff_salary_rates/staff').rates).length,1);
 await assert.rejects(save(h,500,'2026-12-01','retry'),/different staff edits/);
});

test('invalid dates, unknown wages, unavailable history and revoked payroll access never create guessed wages',async()=>{
 for(const date of ['', '2026-02-30','10/19/2026']){const h=fixture();await assert.rejects(save(h,500,date,'invalid'),/valid salary effective date/);assert.equal(h.get('staff_salary_rates/staff'),undefined);}
 const h=fixture();await save(h,500,'2026-11-01','future');h.docs.delete('staff_salary_rates/staff');await assert.rejects(loaded(h),/history could not be confirmed/);
 h.put('hq_email_access/hr@example.test',{active:false,permissions:['payroll'],allowedBranches:['All']});await assert.rejects(save(h,550,'2026-12-01','revoked'),/payroll access/);
});

test('PH calendar and an overnight shift use the scheduled work date, not device timezone or time-out date',()=>{
 const timeline={version:1,staffId:'staff',branch:'Maa',revision:1,rates:{raise:{effectiveDate:'2026-10-20',dailyRate:500,sequence:1}},baselineDailyRate:450};
 const p={hourlyRate:450,salaryRateVersion:1,salaryRateTimeline:timeline},shift={expectedStartAt:new Date('2026-10-19T23:00:00+08:00'),isNightShift:false};
 const log={timestamp:new Date('2026-10-20T00:15:00+08:00')};
 assert.equal(staffRateDate(new Date('2026-10-19T16:30:00Z')),'2026-10-20');assert.equal(staffRateWorkDate(log,shift),'2026-10-19');
 const worked=staffProfileForWork(p,log,shift);assert.equal(worked.hourlyRate,450);assert.equal(latePay(30,worked,shift).amount,56.25);
 assert.equal(staffProfileForWork(p,{timestamp:new Date('2026-10-20T09:00:00+08:00')},{}).hourlyRate,500);
});

test('Franchise mixed cutoff uses each shift wage for basic pay, holiday bonus and rounded lateness',()=>{
 const salaryRateTimeline={version:1,revision:1,baselineDailyRate:450,rates:{raise:{effectiveDate:'2026-10-20',dailyRate:500,sequence:1}}};
 const p={id:'staff',cashierName:'Sample Staff',branch:'Maa',hourlyRate:500,nightDiffRate:0,salaryRateVersion:1,salaryRateTimeline};
 const logs=[19,20].flatMap(day=>[{id:'in'+day,staffId:'staff',staffName:p.cashierName,branch:'Maa',type:'TIME IN',lateMinutes:30,timestamp:new Date('2026-10-'+day+'T09:30:00+08:00')},{id:'out'+day,staffId:'staff',staffName:p.cashierName,branch:'Maa',type:'TIME OUT',timestamp:new Date('2026-10-'+day+'T17:30:00+08:00')}]);
 const rows=attendanceEstimate({logs,profiles:[p],holidays:{'2026-10-20':'Regular'},start:'2026-10-19',end:'2026-10-20',branch:'Maa'});
 assert.equal(rows[0].basic,950);assert.equal(rows[0].late,118.75);assert.equal(rows[0].bonus,250);assert.equal(rows[0].net,1081.25);
});

test('frozen payroll profile excludes the private salary timeline and a new salary revision invalidates unpaid previews',async()=>{
 const h=fixture();await save(h,500,'2026-11-01','future');const p=await loaded(h),profile=payrollSalaryProfile(p,'2026-10-19');
 assert.equal(profile.hourlyRate,450);assert.equal(Object.hasOwn(profile,'salaryRateTimeline'),false);
 const d={staffId:'staff',profile};await assertPayrollSalaryFresh(h.api,d);await save(h,550,'2026-12-01','later',{expectedRateRevision:'future'});
 await assert.rejects(assertPayrollSalaryFresh(h.api,d),/Salary dates changed/);await assertPayrollSalaryFresh(h.api,{...d,isPaid:true});
});

test('operation identity includes the selected effective date',()=>{
 const api={};assert.notEqual(staffProfileOperation(api,payload(500),'staff',{effectiveDate:'2026-10-20'}),staffProfileOperation(api,payload(500),'staff',{effectiveDate:'2026-10-21'}));
});
