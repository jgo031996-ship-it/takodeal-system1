import test from 'node:test';
import {strict as assert} from 'node:assert';
import {resolveAttendanceShift,latePay} from '../takodeal-staff/payroll-safety.js';
test('confirmed equivalent hours match the amounts on the original linked request',()=>{
const staffName='QA Crew',profile={cashierName:staffName,staffId:'qa',hourlyRate:450},record={id:'qa-in',type:'TIME IN',staffName,staffId:'qa',branch:'QA',timestamp:new Date('2026-11-14T09:24:00Z'),lateDecision:'Rejected',lateExempted:false,lateReviewRequestId:'qa-letter',reviewedLateMinutes:118};
for(const [hours,amount] of [[0,0],[0.5,28.13],[1,56.25],[1.5,84.38],[2,112.50]]){
 const marker={kind:'equivalent-hours',minutes:118,hours,attendanceId:record.id,requestId:'qa-letter'};
 const shift=resolveAttendanceShift({...record,lateReviewHistory:[marker]}, {}, {[staffName]:profile});
 assert.deepEqual(latePay(118,profile,shift),{hours,amount,ratePerHour:56.25});
}
const mismatch=resolveAttendanceShift({...record,lateReviewHistory:[{kind:'equivalent-hours',minutes:118,hours:.5,attendanceId:'other-punch',requestId:'qa-letter'}]},{},{[staffName]:profile});assert.equal(latePay(118,profile,mismatch).amount,112.50);
});
