import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayrollRosterResolver,classifyPayrollRosterEntry,payrollProfileState,buildPayrollLedgerReview} from '../takodeal-manager/payroll-roster-model.js';

const person=(extra={})=>({staffId:'sample-person',cashierName:'Sample Person',branch:'Sample Branch',status:'Active',pin:'1234',...extra});
const balance={branch:'Sample Branch',totalHours:0,shiftsWorked:0,foodDeductions:120,cashAdvances:300,logs:[]};
const classify=(profile,data=balance,extra={})=>classifyPayrollRosterEntry({name:profile?.cashierName||'Unmatched Sample',profile,data,...extra});

test('active employees with genuine balances remain in the main payroll list',()=>{
 const row=classify(person());assert.equal(row.section,'payroll');assert.equal(row.category,'current');assert.equal(row.holdPayment,false);
 assert.equal(balance.foodDeductions,120);assert.equal(balance.cashAdvances,300);
});
test('offboarded staff with no cutoff work move to review without losing source data',()=>{
 const source=Object.freeze({...balance,sourceIds:Object.freeze(['meal-one','advance-one'])});
 const row=classify(person({status:'Resigned',pin:'REVOKED',dateResigned:'2030-01-10'}),source);
 assert.equal(row.section,'review');assert.equal(row.category,'former-balance');assert.equal(row.holdPayment,true);assert.deepEqual(source.sourceIds,['meal-one','advance-one']);assert.equal(source.foodDeductions,120);
});
test('revoked and archived states are recognized consistently despite casing',()=>{
 for(const change of [{pin:'revoked'},{pin:'BLOCKED'},{status:' Resigned '},{status:'terminated'},{status:'ARCHIVED'},{status:'Disabled'},{status:'Deleted'},{status:'Offboarded'},{active:false},{isActive:false},{archived:true},{isArchived:true},{deleted:true},{isDeleted:true},{blocked:true},{revoked:true}]){
  assert.equal(payrollProfileState(person(change)).active,false,JSON.stringify(change));assert.equal(classify(person(change)).section,'review');
 }
 assert.equal(payrollProfileState(person({status:'On Leave'})).active,true);
});
test('unmatched balances never become a zero-hour payable staff profile',()=>{
 const row=classify(null);assert.equal(row.section,'review');assert.equal(row.category,'unmatched-balance');assert.equal(row.holdPayment,true);assert.equal(row.staffId,'');
});
test('former employees retain selected-cutoff work and final-pay adjustments',()=>{
 for(const activity of [{totalHours:8},{hours:4},{shiftsWorked:1},{basicPay:450},{perfBonusTotal:150},{nightBonusTotal:100},{straightDutyBonusTotal:50}]){
  const row=classify(person({status:'Resigned'}),{...balance,...activity});assert.equal(row.section,'payroll',JSON.stringify(activity));assert.equal(row.category,'former-cutoff-work');
 }
});
test('missing punches stay visible for attendance review after offboarding',()=>{
 for(const data of [{...balance,attendanceReviewRequired:true},{...balance,logs:[{in:'09:00 AM',out:'MISSED',hrs:'0.00'}]},{...balance,logs:[{needsAttendanceReview:true,attendanceLogIds:['in-one']}]}])assert.equal(classify(person({pin:'REVOKED'}),data).section,'payroll');
});
test('unmatched cutoff work remains visible but cannot be paid before identity review',()=>{
 const row=classify(null,{...balance,totalHours:8,basicPay:450});assert.equal(row.section,'payroll');assert.equal(row.category,'identity-review');assert.equal(row.holdPayment,true);
});
test('paid snapshots survive missing, revoked or ambiguous current profiles unchanged',()=>{
 const snapshot=Object.freeze({name:'Historical Sample',branch:'Former Branch',basicPay:333,finalNetPay:123,isPaid:true,logs:Object.freeze([])});
 const before=JSON.stringify(snapshot);
 for(const profile of [null,person({status:'Resigned'})]){
  const row=classifyPayrollRosterEntry({name:snapshot.name,profile,data:snapshot,identity:{status:'ambiguous',reason:'Sample duplicate'}});assert.equal(row.section,'payroll');assert.equal(row.category,'paid');assert.equal(row.holdPayment,false);
 }
 assert.equal(JSON.stringify(snapshot),before);
});
test('manual balance labels do not pretend to be cutoff attendance',()=>{
 const data={...balance,logs:[{in:'---',out:'---',hrs:'0.00',remark:'Outstanding meal balance'},{in:'10:00 AM',out:'---',hrs:'0.00',remark:'Manual balance penalty'}]};
 assert.equal(classify(person({status:'Resigned'}),data).section,'review');
});
test('explicit selected-cutoff evidence is supported without modifying arithmetic',()=>{
 assert.equal(classify(person({status:'Resigned'}),balance,{hasCutoffActivity:true}).section,'payroll');
 assert.equal(classify(person({status:'Resigned'}),{...balance,totalHours:8},{hasCutoffActivity:false}).section,'review');
});
test('financial names resolve through unique exact saved names or aliases without typo guessing',()=>{
 const profile=person({scheduleNickname:'Sample P'}),resolve=createPayrollRosterResolver([profile]);
 for(const name of ['Sample Person','  sample   PERSON ','Sample P']){const match=resolve(name);assert.equal(match.status,'matched');assert.equal(match.profile,profile);assert.equal(match.staffId,profile.staffId);}
 assert.equal(resolve('Sampel Person').status,'missing');assert.equal(resolve('Sample Person Jr').status,'missing');
});
test('explicit missing or conflicting staff IDs never fall back to a matching name',()=>{
 const other=person({staffId:'other-person',cashierName:'Other Person'}),resolve=createPayrollRosterResolver([person(),other]);
 assert.equal(resolve({staffId:'deleted-person',staffName:'Sample Person'}).status,'missing');
 assert.equal(resolve({staffId:'sample-person',staffName:'Other Person'}).status,'conflict');
 assert.equal(resolve({staffId:'sample-person',staffName:'Sample Person',frozenData:{staffId:'other-person'}}).status,'conflict');
 assert.equal(resolve({staffId:42,staffName:'Sample Person'}).status,'conflict');
});
test('stable IDs preserve renamed employees without merging them into a different current profile',()=>{
 const profile=person({cashierName:'Current Sample Name'}),resolve=createPayrollRosterResolver([profile]);
 const match=resolve({staffId:profile.staffId,staffName:'Previous Sample Name',branch:'Previous Branch'});
 assert.equal(match.status,'matched');assert.equal(match.name,profile.cashierName);assert.equal(match.nameChanged,true);assert.equal(match.staffId,profile.staffId);
});
test('ambiguous aliases and duplicate profile IDs fail closed',()=>{
 const a=person(),b=person({staffId:'second-person',cashierName:'Second Person',scheduleNickname:'Sample Person'});
 assert.equal(createPayrollRosterResolver([a,b])('Sample Person').status,'ambiguous');
 assert.equal(createPayrollRosterResolver([a,{...a,cashierName:'Duplicate Profile'}])({staffId:a.staffId}).status,'ambiguous');
 const match=createPayrollRosterResolver([a,person({staffId:'second-person'})])({staffId:a.staffId,staffName:a.cashierName});
 assert.equal(match.status,'matched');assert.equal(match.nameCollision,true);assert.equal(classify(a,balance,{identity:match}).section,'review');
});
test('name-only records from another branch require review while stable-ID transfers remain traceable',()=>{
 const profile=person(),resolve=createPayrollRosterResolver([profile]);
 assert.equal(resolve({staffName:profile.cashierName,branch:'Another Branch'}).status,'conflict');
 assert.equal(resolve({staffId:profile.staffId,staffName:profile.cashierName,branch:'Another Branch'}).status,'matched');
});
test('unresolved identity cannot be overridden by a caller-supplied active profile',()=>{
 const row=classify(person(),balance,{identity:{status:'missing',reason:'Missing saved staff ID'}});
 assert.equal(row.section,'review');assert.equal(row.holdPayment,true);assert.equal(row.reason,'Missing saved staff ID');
});

const loan=(extra={})=>({id:'sample-loan',staffId:'sample-person',staffName:'Sample Person',branch:'Sample Branch',totalLoaned:1000,totalPaid:250,cutoffDeduction:100,dateAdded:'2030-01-01',...extra});
test('a unique exact active loan keeps its original settlement metadata and amount',()=>{
 const source=Object.freeze(loan()),result=buildPayrollLedgerReview([source],createPayrollRosterResolver([person()]));
 assert.equal(result.ledgerDict['Sample Person'],source);assert.deepEqual(result.reviewRows,[]);assert.deepEqual(result.holds,[]);assert.equal(source.totalLoaned,1000);assert.equal(source.totalPaid,250);
});
test('legacy exact-name loans without staff ID or branch remain compatible',()=>{
 const source=loan();delete source.staffId;delete source.branch;
 assert.equal(buildPayrollLedgerReview([source],createPayrollRosterResolver([person()])).ledgerDict['Sample Person'],source);
});
test('loan ID conflicts, missing IDs and branch conflicts are review-only and hold the affected name',()=>{
 const other=person({staffId:'second-person',cashierName:'Second Person'}),resolver=createPayrollRosterResolver([person(),other]);
 for(const change of [{staffId:'second-person'},{staffId:'missing-person'},{branch:'Different Branch'},{id:''}]){
  const source=loan(change),result=buildPayrollLedgerReview([source],resolver);assert.equal(Object.keys(result.ledgerDict).length,0);assert.equal(result.reviewRows.length,1);assert.ok(result.holds.some(row=>row.name==='Sample Person'));assert.equal(result.reviewRows[0].sourceRecords[0],source);
 }
});
test('stable-ID renames, nicknames and case changes never reassign a strict-name loan settlement',()=>{
 const profile=person({cashierName:'Current Person Name',scheduleNickname:'Sample Person'}),resolver=createPayrollRosterResolver([profile]);
 for(const name of ['Previous Person Name','Sample Person','current person name',' Current Person Name ']){
  const source=loan({staffName:name}),result=buildPayrollLedgerReview([source],resolver);assert.equal(Object.keys(result.ledgerDict).length,0,name);assert.equal(result.reviewRows.length,1);assert.equal(result.holds[0].name,profile.cashierName);
 }
});
test('duplicate positive ledgers cannot choose a last-write winner or combine loan deductions',()=>{
 const rows=[loan(),loan({id:'second-loan',totalLoaned:800,totalPaid:50,cutoffDeduction:80})],before=JSON.stringify(rows),result=buildPayrollLedgerReview(rows,createPayrollRosterResolver([person()]));
 assert.equal(Object.keys(result.ledgerDict).length,0);assert.equal(result.reviewRows.length,2);assert.equal(result.holds.length,1);assert.equal(JSON.stringify(rows),before);assert.deepEqual(result.reviewRows.map(row=>row.records[0].id),['sample-loan','second-loan']);
});
test('a conflicting source prevents another valid loan for the same display name from silently applying',()=>{
 const result=buildPayrollLedgerReview([loan(),loan({id:'bad-loan',staffId:'missing-person'})],createPayrollRosterResolver([person()]));
 assert.equal(Object.keys(result.ledgerDict).length,0);assert.equal(result.reviewRows.length,2);assert.equal(result.holds.length,1);
});
test('former loan-only balances remain reviewable without creating a fake payroll employee',()=>{
 const profile=person({status:'Resigned',pin:'REVOKED'}),source=loan(),result=buildPayrollLedgerReview([source],createPayrollRosterResolver([profile]));
 assert.equal(result.reviewRows.length,1);assert.equal(result.reviewRows[0].reviewIfNoCutoffWork,true);assert.equal(result.reviewRows[0].records[0].amount,750);
 assert.equal(result.ledgerDict[profile.cashierName],source,'genuine final-pay work can still use its unchanged valid loan');assert.deepEqual(result.holds,[]);
});
test('unmatched orphan loans retain their source reference and outstanding balance only for review',()=>{
 const source=loan({staffId:'deleted-person',staffName:'Former Unmatched Person'}),result=buildPayrollLedgerReview([source],createPayrollRosterResolver([person()]));
 assert.equal(Object.keys(result.ledgerDict).length,0);assert.equal(result.reviewRows[0].records[0].amount,750);assert.equal(result.reviewRows[0].records[0].id,source.id);assert.equal(result.reviewRows[0].sourceRecords[0],source);assert.equal(result.reviewRows[0].reviewIfNoCutoffWork,false);
});
test('settled ledgers do not obstruct a later valid positive loan or create review debt',()=>{
 const source=loan(),result=buildPayrollLedgerReview([loan({id:'settled-loan',totalPaid:1000}),source],createPayrollRosterResolver([person()]));
 assert.equal(result.ledgerDict['Sample Person'],source);assert.deepEqual(result.reviewRows,[]);assert.deepEqual(result.holds,[]);
});
test('malformed loan amounts fail closed without parseFloat truncation or invented zero balances',()=>{
 for(const change of [{totalLoaned:'1000oops'},{totalPaid:NaN},{totalLoaned:Infinity},{totalLoaned:-1},{cutoffDeduction:'100oops'}]){
  const result=buildPayrollLedgerReview([loan(change)],createPayrollRosterResolver([person()]));assert.equal(Object.keys(result.ledgerDict).length,0);assert.equal(result.reviewRows.length,1);assert.equal(result.holds.length,1);
 }
 const result=buildPayrollLedgerReview([loan({totalLoaned:'1000.50',totalPaid:'250.25',cutoffDeduction:'100.00'})],createPayrollRosterResolver([person()]));assert.equal(result.ledgerDict['Sample Person'].totalLoaned,'1000.50');
});
