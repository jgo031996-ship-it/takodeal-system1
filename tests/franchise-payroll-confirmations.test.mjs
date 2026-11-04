import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {loadFranchisePayrollShiftConfirmations} from '../takodeal-franchise/franchise-payroll-confirmations.js';
import {buildFranchisePayslip} from '../takodeal-franchise/franchise-payroll-model.js';
import {canVisit,addDays} from '../takodeal-franchise/franchise-data.js';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-franchise/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift,loadStaffSalaryTimeline} from '../takodeal-franchise/payroll-safety.js';
import {emergencyShiftSourceFingerprint} from '../takodeal-franchise/emergency-shift-model.js';
const branch='Fictional Franchise',start='2026-10-16',end='2026-10-31',staffId='fictional-franchise-crew',name='Fictional Crew',at=value=>new Date('2026-10-'+value+'+08:00');
function fixture({timeIn=at('23T16:00:00'),timeOut=at('24T00:30:00'),approvedEnd=at('24T00:30:00'),head=true}={}){
 const staff={id:staffId,cashierName:name,branch,active:true,hourlyRate:450,nightDiffRate:50},plan={currentYear:2026,currentMonth:10,employees:[{id:staffId,name,branch}],branchConfig:{[branch]:[{id:'mid',name:'Mid',shiftType:'mid',startTime:'16:00',endTime:'00:30'},{id:'straight',name:'Owner straight reference',shiftType:'other',startTime:'16:00',endTime:'08:30'}]},currentSchedule:{23:{[branch]:{scheduled:{mid:'Other Fictional Crew',straight:'Other Fictional Crew'},rest:[],unavailable:[],swaps:{}}}}};
 const revision=createScheduleRevision(plan,{revisionId:'fictional-franchise-source',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:at('01T00:00:00')}),schedule=assembleScheduleHistory(plan,[{month:'2026-10',revisions:[revision]}],{enforcedFrom:'2026-10-01'});
 const source={id:'fictional-franchise-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:timeIn,lateMinutes:0,scheduleSnapshot:captureAttendanceSchedule(timeIn,branch,name,schedule,{[name]:staff})};
 const departure={id:'fictional-franchise-out',staffId,staffName:name,branch,type:'TIME OUT',timeInLogId:source.id,timeInAt:timeIn,timestamp:timeOut};
 const confirmation={schemaVersion:1,status:'Confirmed',revisionId:'fictional-franchise-confirmed-v1',version:1,staffId,staffName:name,branch,timeInLogId:source.id,timeInAt:timeIn,workDate:'2026-10-23',expectedStartAt:at('23T16:00:00'),expectedEndAt:approvedEnd,shiftName:'Assigned hours checked by Owner',sourceFingerprint:emergencyShiftSourceFingerprint(source),reviewedByUid:'fictional-owner',reviewedByEmail:'jgo031996@gmail.com',reviewedAt:new Date('2026-11-04T14:00:00+08:00')};
 const documents=new Map(head?[[source.id,confirmation]]:[]),reads=[],api={db:{},doc:(_db,table,id)=>({table,id,path:table+'/'+id}),getDocFromServer:async ref=>{reads.push(ref);return{id:ref.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>documents.has(ref.id),data:()=>structuredClone(documents.get(ref.id))};}};
 const input={schedule,profiles:[staff],logs:[source,departure],payrollRecords:[],branch,start,end},hydrate=extra=>loadFranchisePayrollShiftConfirmations(api,{...input,...extra});
 const build=savedSchedule=>buildFranchisePayslip({...input,staff,schedule:savedSchedule});
 return{staff,source,departure,confirmation,documents,api,reads,input,schedule,hydrate,build};
}

test('Franchise actual payroll uses the same fresh Owner hours and preserves original unassigned punch evidence',async()=>{
 const f=fixture(),before=structuredClone(f.input.logs);assert.equal(f.build(f.schedule).kind,'held');const schedule=await f.hydrate(),model=f.build(schedule);
 assert.equal(model.kind,'estimate',JSON.stringify(model.reviewReasons));assert.equal(model.totals.basic,450);assert.equal(model.totals.bonus,50);assert.equal(model.totals.net,500);
 const shift=resolveAttendanceShift(f.source,schedule,{[name]:f.staff});assert.equal(shift.payrollHoursConfirmed,true);assert.equal(shift.expectedStartAt.toISOString(),'2026-10-23T08:00:00.000Z');assert.deepEqual(f.input.logs,before);
 assert.deepEqual(f.reads.map(row=>row.path),['attendance_shift_confirmations/'+f.source.id]);
});
for(const [finish,bonus,short]of [['23T20:00:00',0,true],['23T23:59:00',0,true],['24T00:00:00',50,false],['24T05:30:00',50,false],['24T08:00:00',50,false],['24T08:01:00',50,false]])test('Franchise '+finish+' follows full daily/8h bonus/strict over16 approval policy',async()=>{
 const f=fixture({timeOut:at(finish)}),model=f.build(await f.hydrate());assert.equal(model.kind,'estimate',JSON.stringify(model.reviewReasons));assert.equal(model.totals.basic,450);assert.equal(model.totals.bonus,bonus);assert.equal(model.shifts,1);
 if(short)assert.match(model.attendanceRows[0].remark,/Short duty.*full daily pay retained/);
 if(finish==='24T08:01:00')assert.match(model.attendanceRows[0].remark,/Owner straight-duty review pending/);
});
test('Franchise over16 actual hours need a protected Owner span before two daily units, straight50 and qualifying night50 apply',async()=>{
 const f=fixture({timeOut:at('24T08:01:00'),approvedEnd:at('24T08:30:00')}),model=f.build(await f.hydrate());assert.equal(model.kind,'estimate',JSON.stringify(model.reviewReasons));assert.equal(model.shifts,2);assert.equal(model.totals.basic,900);assert.equal(model.totals.bonus,100);assert.equal(model.totals.net,1000);
});
test('a foreign branch/profile from a legacy broad source cannot trigger cross-branch head reads',async()=>{
 const f=fixture(),foreign={...f.staff,id:'foreign-staff',cashierName:'Foreign Crew',branch:'Foreign Branch'},logs=[...f.input.logs,{...f.source,id:'foreign-in',staffId:foreign.id,staffName:foreign.cashierName,branch:foreign.branch},{...f.source,id:'foreign-id-in',staffId:foreign.id}];
 const schedule=await f.hydrate({profiles:[f.staff,foreign],logs});assert.deepEqual(f.reads.map(row=>row.id),[f.source.id]);assert.deepEqual(Object.keys(schedule.payrollShiftConfirmations),[f.source.id]);
});
test('a saved paid Franchise snapshot stays frozen and needs no assigned-hours lookup',async()=>{
 const f=fixture(),saved={id:'fictional-paid',staffId,staffName:name,branch,startDate:start,endDate:end,finalNetPay:1000,frozenData:{staffId,name,branch,start,end,isPaid:true,basicPay:1000,finalNetPay:1000}},before=structuredClone(saved);
 const schedule=await f.hydrate({payrollRecords:[saved]}),model=buildFranchisePayslip({...f.input,staff:f.staff,schedule,payrollRecords:[saved]});assert.equal(model.kind,'paid');assert.equal(model.totals.net,1000);assert.deepEqual(f.reads,[]);assert.deepEqual(saved,before);
});
test('a branch or cutoff change while hydration is pending cannot expose the previous scope',async()=>{
 const f=fixture();let current=true;const read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const value=await read(ref);current=false;return value;};await assert.rejects(f.hydrate({assertCurrent:()=>{if(!current)throw Error('Franchise scope changed');}}),/Franchise scope changed/);
});

const workspace=readFileSync(new URL('../takodeal-franchise/franchise-workspace.js',import.meta.url),'utf8');
const handlerStart=workspace.indexOf(" define('payroll',async r=>{")+" define('payroll',async r=>{".length,handlerEnd=workspace.indexOf('  state.payrollScope=scope;',handlerStart);
assert.ok(handlerStart>0&&handlerEnd>handlerStart,'actual Franchise payroll loader is exercised');
async function actualLoader(f,{changed=false}={}){
 let scope='current';const session={branch,allowedBranches:[branch],permissions:['all'],isOwner:false},foreign={...f.staff,id:'foreign-staff',branch:'Foreign Branch'};
 if(changed){const read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const value=await read(ref);scope='changed';return value;};}
 const context={api:f.api,session:()=>session,payrollContext:()=>scope,payrollControls:{getRange:()=>({start,end}),queryRange:()=>({startDate:new Date(start+'T00:00:00+08:00'),endDate:new Date('2026-11-01T12:00:00+08:00')})},read:async table=>table==='cashiers'?[f.staff,foreign]:table==='attendance_logs'?[...f.input.logs,{...f.source,id:'foreign-in',staffId:foreign.id,branch:foreign.branch}]:[],staffRows:async()=>[],payrollRows:async()=>[],loadStaffSalaryTimeline,createScheduleHistoryStore:()=>({loadRange:async()=>f.schedule}),addDays,canVisit,loadFranchisePayrollShiftConfirmations,buildFranchisePayslip,Date};
 return vm.runInNewContext('(async()=>{'+workspace.slice(handlerStart,handlerEnd)+'return rows;})()',context);
}
test('the actual Franchise loader filters profiles, hydrates current branch heads and builds the corrected preview',async()=>{
 const f=fixture(),rows=await actualLoader(f);assert.equal(rows.length,1);assert.equal(rows[0].staffId,staffId);assert.equal(rows[0].kind,'estimate');assert.equal(rows[0].totals.net,500);assert.deepEqual(f.reads.map(row=>row.id),[f.source.id]);
});
test('the actual Franchise loader cannot publish a corrected preview after the branch/cutoff identity changes',async()=>{
 const f=fixture();await assert.rejects(actualLoader(f,{changed:true}),/account, branch or cutoff changed/);
});
