import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {payrollScheduleStamp,assertPayrollScheduleFresh} from '../takodeal-manager/payroll-schedule-freshness.js';
const schedule={historyMonths:{'2030-01':{revisions:[],shiftAmendments:[]}}};
const preview=()=>({start:'2030-01-01',end:'2030-01-15',scheduleEvidenceStamp:payrollScheduleStamp(schedule)});
test('unpaid preview must use fresh dated schedule evidence',async()=>{
 const api={auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>structuredClone(schedule)};
 await assertPayrollScheduleFresh(api,preview());
 api.loadPayrollScheduleHistory=async()=>({...structuredClone(schedule),historyMonths:{'2030-01':{revisions:[],shiftAmendments:[{id:'correction'}]}}});
 await assert.rejects(assertPayrollScheduleFresh(api,preview()),/Regenerate/);
 await assert.rejects(assertPayrollScheduleFresh(api,{start:'2030-01-01'}),/Regenerate/);
});
test('paid figures are preserved and failed reads never authorize payment',async()=>{
 const paid={...preview(),isPaid:true,finalNetPay:150};const before=structuredClone(paid);
 await assertPayrollScheduleFresh({},paid);assert.deepEqual(paid,before);
 await assert.rejects(assertPayrollScheduleFresh({auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>{throw Error('offline');}},preview()),/offline/);
});
test('account change during read holds the unpaid preview',async()=>{
 const api={auth:{currentUser:{uid:'first',email:'owner@example.test'}},sessionUser:{uid:'first',email:'owner@example.test',isOwner:true,permissions:['payroll']},loadPayrollScheduleHistory:async()=>{api.auth.currentUser.uid='second';return schedule;}};
 await assert.rejects(assertPayrollScheduleFresh(api,preview()),/authorized payroll|Regenerate/);
});
test('both Owner generators stamp previews and use shared amendment-aware minutes',()=>{
 const source=fs.readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
 assert.equal((source.match(/scheduleEvidenceStamp:payrollScheduleStamp\(scheduleData\)/g)||[]).length,2);
 assert.equal((source.match(/attendanceLateMinutes\(log, matchedShift\)/g)||[]).length,2);
 assert.equal((source.match(/await assertPayrollScheduleFresh\(window,data\)/g)||[]).length,2);
 assert.ok(source.includes('attendanceLateMinutes(data, matchedShift)'));
});

test('matching evidence never authorizes a signed-out or out-of-scope account',async()=>{
 for(const api of [{},{auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'other',email:'owner@example.test',isOwner:true,permissions:['payroll']}},{auth:{currentUser:{uid:'owner',email:'owner@example.test'}},sessionUser:{uid:'owner',email:'owner@example.test',isOwner:true,permissions:['payroll'],isFranchisee:true}}])await assert.rejects(assertPayrollScheduleFresh({...api,loadPayrollScheduleHistory:async()=>schedule},preview()),/authorized payroll/);
});
