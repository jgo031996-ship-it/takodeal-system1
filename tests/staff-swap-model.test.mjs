import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {swapCandidates,applyScheduleSwap,swapEvidenceDates,SWAP_PENDING_STATUS,SWAP_REVIEW_STATUS,SWAP_REQUEST_VERSION} from '../takodeal-staff/schedule-swap-model.js';

const rule=(id='morning',startTime='09:00',endTime='17:00')=>({id,name:id,startTime,endTime,active:true,days:[0,1,2,3,4,5,6]});
const row=(scheduled={},rest=[])=>({scheduled,rest,unavailable:[],swaps:{},savedNote:'keep'});
function fixture(){return {currentYear:2026,currentMonth:10,branchConfig:{Maa:[rule()],Cabantian:[rule('morning','12:00','20:00')],Citygate:[rule()]},employees:[{staffId:'ana',cashierName:'Ana Example',name:'Ana',scheduleNickname:'Ana',branch:'Maa'},{staffId:'bea',cashierName:'Bea',name:'Bea',branch:'Cabantian'},{staffId:'cam',cashierName:'Cam',name:'Cam',branch:'Citygate'}],currentSchedule:{5:{},6:{Maa:row({morning:'Ana'}),Cabantian:row({morning:'Bea'}),Citygate:row({},['Cam'])},7:{}},unavailability:{}};}
const input=snapshot=>({snapshot,workDate:'2026-10-06',requesterBranch:'Maa',requesterShiftId:'morning',requesterAliases:['Ana Example','Ana'],requesterStaffId:'ana'});
const request=(extra={})=>({branch:'Maa',targetBranch:'Cabantian',workDate:'2026-10-06',requesterShiftId:'morning',targetShiftId:'morning',requesterAssignedName:'Ana',targetAssignedName:'Bea',requesterStaffId:'ana',targetStaffId:'bea',...extra});

test('all branches offer exact linked working and standby assignments, including equal shift IDs',()=>{
 const snapshot=fixture(),before=structuredClone(snapshot),candidates=swapCandidates(input(snapshot));
 assert.deepEqual(candidates.map(row=>[row.targetBranch,row.targetStaffId,row.kind]),[['Cabantian','bea','scheduled'],['Citygate','cam','standby']]);assert.deepEqual(snapshot,before);
});
test('cross-branch trade changes only its two exact slots and swap notes',()=>{
 const snapshot=fixture(),updated=applyScheduleSwap(snapshot,request());
 assert.equal(updated.currentSchedule[6].Maa.scheduled.morning,'Bea');assert.equal(updated.currentSchedule[6].Cabantian.scheduled.morning,'Ana');
 assert.deepEqual(updated.currentSchedule[6].Maa.swaps,{morning:'Ana'});assert.deepEqual(updated.currentSchedule[6].Cabantian.swaps,{morning:'Bea'});
 assert.deepEqual(updated.currentSchedule[6].Citygate,snapshot.currentSchedule[6].Citygate);assert.deepEqual(updated.currentSchedule[5],snapshot.currentSchedule[5]);assert.deepEqual(updated.employees,snapshot.employees);assert.deepEqual(updated.branchConfig,snapshot.branchConfig);
});
test('cross-branch standby moves requester to rest in the requester branch and keeps unrelated rest rows',()=>{
 const snapshot=fixture();snapshot.currentSchedule[6].Cabantian.rest=['Cam'];snapshot.currentSchedule[6].Citygate.rest.push('Other');
 const updated=applyScheduleSwap(snapshot,request({targetBranch:'Citygate',targetShiftId:'STANDBY',targetAssignedName:'Cam',targetStaffId:'cam'}));
 assert.deepEqual(updated.currentSchedule[6].Maa.rest,['Ana']);assert.deepEqual(updated.currentSchedule[6].Citygate.rest,['Other']);assert.deepEqual(updated.currentSchedule[6].Cabantian.rest,['Cam']);assert.equal(updated.currentSchedule[6].Maa.scheduled.morning,'Cam');
});
test('self aliases and ambiguous roster names never become candidates',()=>{
 const snapshot=fixture();snapshot.currentSchedule[6].Citygate.rest.push('Ana Example');snapshot.employees.push({staffId:'other-bea',name:'Bea',branch:'Other'});
 assert.deepEqual(swapCandidates(input(snapshot)).map(row=>row.targetName),['Cam']);
});
test('known inactive, blocked and scheduling-ineligible roster accounts are excluded',()=>{
 for(const flags of [{status:'Resigned'},{blocked:true},{pin:'BLOCKED'},{active:false},{scheduleEligible:false}]){const snapshot=fixture();Object.assign(snapshot.employees[1],flags);assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetStaffId==='bea'));}
});
test('standby staff working anywhere and duplicate working assignments are excluded globally',()=>{
 const snapshot=fixture();snapshot.currentSchedule[6].Citygate.rest.push('Bea');snapshot.currentSchedule[6].Citygate.scheduled.morning='Cam';
 assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetName==='Cam'&&row.kind==='standby'));assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetName==='Bea'&&row.kind==='standby'));
 snapshot.currentSchedule[6].Citygate.scheduled.morning='Bea';assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetName==='Bea'));
});
test('unavailability on any branch or global dated flags blocks the linked account',()=>{
 for(const flag of ['branch','global']){const snapshot=fixture();if(flag==='branch')snapshot.currentSchedule[6].Citygate.unavailable=[{name:'Bea',status:'Leave'}];else snapshot.unavailability['2026-10-06']={'Bea':{status:'Suspended',staffId:'bea'}};assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetStaffId==='bea'));assert.throws(()=>applyScheduleSwap(snapshot,request()),/unavailable/);}
});
test('inactive weekday rules and missing hours are rejected',()=>{
 for(const change of [rule=>rule.active=false,rule=>rule.days=[0],rule=>rule.startTime='']){const snapshot=fixture();change(snapshot.branchConfig.Cabantian[0]);assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetStaffId==='bea'));assert.throws(()=>applyScheduleSwap(snapshot,request()),/active|hours/);}
});
test('previous overnight and following assignments prevent a newly overlapping shift',()=>{
 const previous=fixture();previous.branchConfig.Cabantian.push(rule('night','22:00','10:00'));previous.currentSchedule[5].Cabantian=row({night:'Bea'});assert.ok(!swapCandidates(input(previous)).some(row=>row.targetStaffId==='bea'));assert.throws(()=>applyScheduleSwap(previous,request()),/overlaps/);
 const next=fixture();next.branchConfig.Cabantian[0]=rule('morning','22:00','07:00');next.branchConfig.Maa.push(rule('early','06:00','14:00'));next.currentSchedule[7].Maa=row({early:'Ana'});assert.throws(()=>applyScheduleSwap(next,request()),/overlaps/);
});
test('dated neighbor snapshots and ID-bound old aliases win over monthly fallback',()=>{
 const snapshot=fixture(),prior=structuredClone(snapshot);prior.branchConfig.Cabantian.push(rule('night','22:00','10:00'));prior.currentSchedule[5].Cabantian=row({night:'Bea Old'});prior.employees[1].scheduleAliases=['Bea Old'];
 assert.ok(!swapCandidates({...input(snapshot),daySnapshots:{5:prior}}).some(row=>row.targetStaffId==='bea'));
});
test('a selected dated snapshot freezes its inspected shift rules in the approved revision',()=>{
 const snapshot=fixture(),dated=structuredClone(snapshot);dated.branchConfig.Cabantian[0].startTime='11:00';
 const updated=applyScheduleSwap(snapshot,request(),{daySnapshots:{6:dated}});assert.equal(updated.branchConfig.Cabantian[0].startTime,'11:00');assert.equal(snapshot.branchConfig.Cabantian[0].startTime,'12:00');
});
test('month boundary requires explicit adjacent saved snapshot and checks its overnight assignments',()=>{
 const snapshot=fixture();snapshot.currentMonth=11;snapshot.currentSchedule={1:snapshot.currentSchedule[6],2:{}};const args={...input(snapshot),workDate:'2026-11-01'};
 assert.deepEqual(swapCandidates(args),[]);assert.throws(()=>applyScheduleSwap(snapshot,request({workDate:'2026-11-01'})),/adjacent/);
 const previous=fixture();previous.currentSchedule={31:{}};assert.equal(swapCandidates({...args,daySnapshots:{'2026-10-31':previous}}).length,2);
 previous.branchConfig.Cabantian.push(rule('night','22:00','10:00'));previous.currentSchedule[31].Cabantian=row({night:'Bea'});assert.ok(!swapCandidates({...args,daySnapshots:{'2026-10-31':previous}}).some(row=>row.targetStaffId==='bea'));
});
test('month-end daytime and exact-midnight swaps work without an unpublished following month',()=>{
 const snapshot=fixture();snapshot.currentMonth=11;snapshot.currentSchedule={29:{},30:snapshot.currentSchedule[6]};const args={...input(snapshot),workDate:'2026-11-30'},trade=request({workDate:'2026-11-30'});
 assert.equal(swapCandidates(args).length,2);assert.equal(applyScheduleSwap(snapshot,trade).currentSchedule[30].Maa.scheduled.morning,'Bea');assert.deepEqual(swapEvidenceDates(snapshot,trade),['2026-11-29','2026-11-30']);
 Object.assign(snapshot.branchConfig.Cabantian[0],{startTime:'16:00',endTime:'00:00'});assert.ok(swapCandidates(args).some(row=>row.targetStaffId==='bea'));assert.equal(applyScheduleSwap(snapshot,trade).currentSchedule[30].Cabantian.scheduled.morning,'Ana');assert.deepEqual(swapEvidenceDates(snapshot,trade),['2026-11-29','2026-11-30']);
 Object.assign(snapshot.branchConfig.Cabantian[0],{startTime:'18:00',endTime:'01:00'});assert.ok(!swapCandidates(args).some(row=>row.targetStaffId==='bea'));assert.ok(swapCandidates(args).some(row=>row.targetStaffId==='cam'));assert.throws(()=>applyScheduleSwap(snapshot,trade),/adjacent/);assert.deepEqual(swapEvidenceDates(snapshot,trade),['2026-11-29','2026-11-30','2026-12-01']);
 Object.assign(snapshot.branchConfig.Maa[0],{startTime:'18:00',endTime:'01:00'});assert.equal(swapCandidates(args).length,0);
});
test('cross-branch legacy unlinked names require an HQ roster identity repair',()=>{
 const snapshot=fixture();delete snapshot.employees[1].staffId;assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetName==='Bea'));assert.throws(()=>applyScheduleSwap(snapshot,request({targetStaffId:'foreign-id'})),/exact staff account links/);
});
test('cross-branch target linkage must be explicit and match the original roster account',()=>{
 for(const targetStaffId of [undefined,'foreign-id']){const snapshot=fixture();assert.throws(()=>applyScheduleSwap(snapshot,request({targetStaffId})),/exact staff account links/);}
});
test('cross-branch requester linkage cannot be manufactured by live aliases or a supplied account ID',()=>{
 for(const change of [snapshot=>delete snapshot.employees[0].staffId,snapshot=>snapshot.employees.shift(),snapshot=>{snapshot.employees[0].name='Different';snapshot.employees[0].cashierName='Different';delete snapshot.employees[0].scheduleNickname;}]){const snapshot=fixture();change(snapshot);assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetBranch!=='Maa'));assert.throws(()=>applyScheduleSwap(snapshot,request()),/exact staff account links/);}
});
test('repeated standby accounts appear once, preferring requester branch then a stable branch order',()=>{
 const snapshot=fixture();snapshot.currentSchedule[6].Cabantian.rest=['Cam'];let before=structuredClone(snapshot),candidates=swapCandidates(input(snapshot)).filter(row=>row.targetStaffId==='cam');assert.equal(candidates.length,1);assert.equal(candidates[0].targetBranch,'Cabantian');assert.deepEqual(snapshot,before);
 snapshot.currentSchedule[6].Maa.rest=['Cam'];before=structuredClone(snapshot);candidates=swapCandidates(input(snapshot)).filter(row=>row.targetStaffId==='cam');assert.equal(candidates.length,1);assert.equal(candidates[0].targetBranch,'Maa');assert.deepEqual(snapshot,before);
});
test('zero, full-day, too-short and over-18-hour shift rules are excluded',()=>{
 for(const [start,end]of [['09:00','09:00'],['00:00','00:00'],['09:00','09:30'],['09:00','04:00']]){const snapshot=fixture();Object.assign(snapshot.branchConfig.Cabantian[0],{startTime:start,endTime:end});assert.ok(!swapCandidates(input(snapshot)).some(row=>row.targetStaffId==='bea'));assert.throws(()=>applyScheduleSwap(snapshot,request()),/between 1 and 18/);}
 const snapshot=fixture();Object.assign(snapshot.branchConfig.Cabantian[0],{startTime:'09:00',endTime:'03:00'});assert.ok(swapCandidates(input(snapshot)).some(row=>row.targetStaffId==='bea'));
});
test('same-branch legacy requests retain fallback while exact assignments are required',()=>{
 const snapshot=fixture();snapshot.branchConfig.Maa.push(rule('late','18:00','23:00'));snapshot.currentSchedule[6].Maa.scheduled.late='Bea';delete snapshot.currentSchedule[6].Cabantian.scheduled.morning;
 const updated=applyScheduleSwap(snapshot,request({targetBranch:undefined,targetShiftId:'late'}));assert.equal(updated.currentSchedule[6].Maa.scheduled.late,'Ana');
 assert.throws(()=>applyScheduleSwap(snapshot,request({targetBranch:undefined,targetShiftId:'late',targetAssignedName:'Bea Example'})),/exact shift/);
});
test('staff and HQ use byte-identical swap models',()=>{
 assert.equal(readFileSync(new URL('../takodeal-staff/schedule-swap-model.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/schedule-swap-model.js',import.meta.url),'utf8'));
});
test('versioned swap statuses keep old staff and owner tabs outside the new review flow',()=>{
 assert.equal(SWAP_PENDING_STATUS,'Pending Staff Acceptance');assert.equal(SWAP_REVIEW_STATUS,'Awaiting HQ Review');assert.equal(SWAP_REQUEST_VERSION,2);assert.notEqual(SWAP_PENDING_STATUS,'Pending');assert.notEqual(SWAP_REVIEW_STATUS,'Awaiting HQ Approval');
});
