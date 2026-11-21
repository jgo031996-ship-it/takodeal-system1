import {installWorkedShiftCorrectionUI} from '../takodeal-manager/worked-shift-correction-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {owner,branch,name,staffId,metadata,at,rule,fixture} from './helpers/worked-shift-fixture.mjs';
import {createScheduleRevision,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift,payrollReliefHoursVerified,attendanceLateMinutes} from '../takodeal-manager/payroll-safety.js';
import {ordinaryPayrollId} from '../takodeal-manager/payroll-settlement.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';
import {emergencyShiftSourceFingerprint} from '../takodeal-manager/emergency-shift-model.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as payrollFunctions from '../takodeal-manager/payroll-safety.js';
import * as lateSummaries from '../takodeal-manager/late-request-summary.js';
import * as lateResolution from '../takodeal-manager/late-request-resolution.js';
import * as proposals from '../takodeal-manager/saved-shift-proposal.js';
import {resolveEmergencyShift} from '../takodeal-manager/emergency-shift-model.js';
import {createScheduleHistoryStore,scheduleDateKey} from '../takodeal-manager/schedule-history.js';
import {attendanceMillis} from '../takodeal-manager/attendance-reconcile.js';
import {reviewLateRequestWorkedShift,reviewLateRequestDatedAttendance} from '../takodeal-manager/late-request-worked-shift-ui.js';
import {clockInDeclarationIdentity} from '../takodeal-staff/attendance-shift-declaration.js';
import {attendanceScheduleIdentity} from '../takodeal-staff/attendance-schedule-preview.js';
import {installOwnerRequestDialog} from '../takodeal-manager/owner-request-dialog.js';
import {installScheduleDeclarationReview} from '../takodeal-manager/attendance-swap-declaration.js';
import {ReviewDocument,ReviewElement} from './helpers/review-dom.mjs';

const inspect=f=>f.service.inspect(f.context);
const apply=async f=>{const view=await inspect(f);return f.service.apply(f.service.propose(view));};
const revisions=f=>[...f.docs.keys()].filter(path=>path.startsWith('settings/schedule_revision_worked-'));

test('one actual saved Night correction appends its exact dated roster and audit while preserving the old version, global head, punches and money',async()=>{
 const f=fixture(),before=structuredClone([...f.docs]),view=await inspect(f);assert.equal(view.recommendedKey,view.choices.find(row=>row.shiftId==='night').key);assert.equal(f.calls.writes.length,0);const proposal=f.service.propose(view),result=await f.service.apply(proposal),saved=f.get('settings/schedule_revision_'+result.revisionId);
 assert.equal(result.alreadySaved,false);assert.equal(saved.effectiveFrom,'2026-10-17');assert.equal(saved.effectiveTo,'2026-10-17');assert.deepEqual(saved.snapshot.currentSchedule[17][branch].scheduled,{morning:'UNFILLED',night:'CREW'});assert.equal(saved.snapshot.currentSchedule[17][branch].swaps.morning,undefined);assert.deepEqual(Object.keys(saved.snapshot.currentSchedule),['17']);
 const marker=saved.snapshot.workedShiftCorrections[f.start.id];assert.equal(marker.shiftId,'night');assert.equal(marker.expectedStartAt,at('17:30').toISOString());assert.equal(marker.expectedEndAt,at('02:00',18).toISOString());assert.equal(marker.timeInAt,at('17:11').toISOString());assert.equal(marker.timeOutAt,at('02:06',18).toISOString());assert.equal(marker.preservedLateness.lateMinutes,37);assert.equal(marker.preservedLateness.exempt,false);assert.equal(marker.reviewedByEmail,owner);assert.deepEqual(saved.historicalWorkedShiftReview,marker);
 const index=f.get('settings/schedule_month_2026_10');assert.equal(index.latestRevisionId,'original-october');assert.equal(index.revisionIds.length,2);const projected=resolveScheduleForDate({historyMonths:{'2026-10':{revisions:[f.revision,saved]}}},'2026-10-17');assert.equal(projected.scheduleRevisionId,result.revisionId);assert.equal(projected.currentSchedule[17][branch].scheduled.night,'CREW');
 for(const [path,row]of before)if(path!=='settings/schedule_month_2026_10')assert.deepEqual(f.get(path),row,path);assert.deepEqual(f.calls.writes,['settings/schedule_revision_'+result.revisionId,'settings/schedule_month_2026_10']);assert.equal(f.get('cash_accounts/fictional').balance,5000);
});
test('a readonly historical roster cell can identify one exact saved Time In by staff, branch and Philippine work date',async()=>{const f=fixture(),view=await f.service.inspect({staffId,branch,workDate:'2026-10-17'});assert.equal(view.status,'ready');assert.equal(view.attendanceLogId,f.start.id);assert.equal(view.timeOutLogId,f.out.id);assert.equal(view.recommendedKey,view.choices.find(row=>row.shiftId==='night').key);assert.equal(f.calls.writes.length,0);});
test('multiple saved Time Ins on one work date return compact exact-record choices instead of guessing',async()=>{const f=fixture();f.put('attendance_logs/earlier-in',{...f.start,id:'earlier-in',timestamp:at('09:00')});const view=await f.service.inspect({staffId,branch,workDate:'2026-10-17'});assert.equal(view.status,'choose-record');assert.equal(view.recordChoices.length,2);assert.equal(view.recommendedKey,null);assert.throws(()=>f.service.propose(view),/Inspect/);assert.equal(f.calls.writes.length,0);});
test('a missing dated roster accepts explicit Owner confirmation for one punch and keeps the dated roster absent',async()=>{
 const f=fixture({missingHistory:true}),view=await inspect(f),choice=view.choices.find(c=>!c.blockers.length);
 assert.equal(view.status,'ready');assert.ok(choice.standalone);assert.equal(view.recommendedKey,null);
 assert.throws(()=>f.service.propose(view));const head=structuredClone(f.get('settings/global_schedule'));
 const proposal=f.service.propose(view,choice.key),result=await f.service.apply(proposal);
 const store=createScheduleHistoryStore(f.api),history=await store.loadRange(f.start.timestamp,f.out.timestamp);
 const saved=resolveAttendanceShift(f.start,history,{[name]:{...f.profile,staffId}},name);
 assert.equal(saved.workedShiftCorrectionId,result.revisionId);assert.equal(saved.shiftId,choice.shiftId);
 assert.equal(resolveScheduleForDate(history,choice.workDate),null);assert.deepEqual(f.get('settings/global_schedule'),head);
 assert.equal(resolveAttendanceShift({...f.start,id:'other-punch'},history,{[name]:{...f.profile,staffId}},name).workedShiftCorrectionId,undefined);
 const second=await inspect(f);assert.equal((await f.service.apply(f.service.propose(second,choice.key))).alreadySaved,true);assert.equal(revisions(f).length,1);
});
test('a cross-branch cover can be confirmed against the original stable ID after an employee rename',async()=>{
 const f=fixture(),cover={branch,homeBranch:'Home Branch',version:1,requiresReview:true};
 f.put('attendance_logs/'+f.start.id,{...f.start,emergencyRelief:cover});f.put('attendance_logs/'+f.out.id,{...f.out,emergencyRelief:cover,reliefRequestId:'cover-request'});
 f.put('cashiers/'+staffId,{...f.profile,branch:'Home Branch',cashierName:'New name',scheduleAliases:[name]});
 const before=structuredClone(f.get('settings/global_schedule')),view=await inspect(f);
 const selected=view.choices.find(c=>c.shiftId==='night');assert.equal(selected.attendanceOnly,true);
 await f.service.apply(f.service.propose(view,selected.key));
 const history=await createScheduleHistoryStore(f.api).loadRange(f.start.timestamp,f.out.timestamp);
 const actual=resolveAttendanceShift(f.get('attendance_logs/'+f.start.id),history,{'New name':{...f.profile,cashierName:'New name',staffId}},'New name');
 assert.equal(actual.shiftId,'night');assert.ok(payrollReliefHoursVerified(actual,f.out));assert.equal(payrollReliefHoursVerified(actual,{...f.out,id:'different-out'}),false);assert.equal(actual.reliefNeedsReview,undefined);assert.deepEqual(f.get('settings/global_schedule'),before);
});

test('equivalent saved Night slots require a compact explicit choice and never fill both slots',async()=>{const f=fixture({rules:[rule('morning','09:00','17:30','morning'),rule('night1','17:30','02:00','night'),rule('night2','17:30','02:00','night')]}),view=await inspect(f);assert.equal(view.recommendedKey,null);assert.throws(()=>f.service.propose(view),/Choose/);const result=await f.service.apply(f.service.propose(view,view.choices.find(row=>row.shiftId==='night2').key)),saved=f.get('settings/schedule_revision_'+result.revisionId);assert.equal(saved.snapshot.currentSchedule[17][branch].scheduled.night1,'UNFILLED');assert.equal(saved.snapshot.currentSchedule[17][branch].scheduled.night2,'CREW');});
test('an occupied overnight slot can be explicitly confirmed without changing its plotted employee',async()=>{
 const f=fixture({extraDay:{scheduled:{morning:'CREW',night:'Other colleague'}}});
 const leave={type:'Leave',status:'Approved',staffId,staffName:name};
 f.put('staff_requests/undated-leave',leave);
 const view=await inspect(f),night=view.choices.find(row=>row.shiftId==='night');
 assert.equal(view.recommendedKey,null);assert.equal(night.attendanceOnly,true);assert.deepEqual(night.undatedLeaveIds,['undated-leave']);assert.deepEqual(night.blockers,[]);
 const saved=await f.service.apply(f.service.propose(view,night.key)),revision=f.get('settings/schedule_revision_'+saved.revisionId);
 assert.deepEqual(revision.snapshot.currentSchedule[17][branch],f.snapshot.currentSchedule[17][branch]);
 assert.deepEqual(f.get('staff_requests/undated-leave'),leave);
 const history=await createScheduleHistoryStore(f.api).loadRange('2026-10-17','2026-10-18');
 const shift=payrollFunctions.resolveAttendanceShift(f.start,history,{[name]:{...f.profile,staffId}});
 assert.equal(shift.workedShiftCorrectionId,saved.revisionId);assert.equal(shift.shiftId,'night');
 const repeat=await inspect(f),choice=repeat.choices.find(row=>row.shiftId==='night');
 assert.equal((await f.service.apply(f.service.propose(repeat,choice.key))).alreadySaved,true);
});
test('a verified leave needs explicit consent for the selected date; unrelated history is ignored',async()=>{
 const f=fixture(),letter={type:'Leave',status:'Approved',staffId,staffName:name};
 f.put('staff_requests/old',{...letter,endDate:'2026-10-10'});
 let row=(await inspect(f)).choices.find(row=>row.shiftId==='night');assert.deepEqual(row.blockers,[]);assert.equal(row.attendanceOnly,false);
 f.put('staff_requests/active',{...letter,startDate:'2026-10-17',endDate:'2026-10-18'});
 const view=await inspect(f);row=view.choices.find(row=>row.shiftId==='night');assert.equal(row.leaveReview.requestId,'active');assert.throws(()=>f.service.propose(view,row.key),/approved leave/i);
});
for(const source of ['claim','approved-leave','suspension','unknown-leave','unknown-sanction'])test(source+' keeps a verified Owner from overriding an independent HR record',async()=>{
 const f=fixture({extraDay:{unavailable:['CREW']}}),day='2026-10-17';
 if(source==='claim')f.put('settings/schedule_leave_staff_'+staffId,{dates:{[day]:{requestId:'leave-source'}}});
 if(source==='approved-leave')f.put('cashiers/namesake',{...f.profile,cashierName:'Different employee'});
 if(source==='approved-leave')f.put('staff_requests/leave-source',{staffName:'CREW',type:'Leave',status:'Approved',startDate:day,endDate:day});
 if(source==='suspension')f.put('hr_sanctions/sanction-source',{staffId,staffName:name,severity:'1 day suspension',effectiveDate:day});
 if(source.startsWith('unknown-'))f.get('settings/schedule_revision_original-october').daySnapshots[day].daySchedule[branch].unavailable.push({name:'CREW',[source==='unknown-leave'?'leaveRequestId':'sanctionId']:'missing-source'});
 const view=await inspect(f),night=view.choices.find(row=>row.shiftId==='night');
 assert.ok(night.blockers.length);assert.equal(view.recommendedKey,null);assert.throws(()=>f.service.propose(view,night.key));assert.equal(f.calls.writes.length,0);
});
test('a known paid cutoff is frozen and cannot receive this roster correction',async()=>{const f=fixture();f.put('payroll_records/old-paid',{staffId,staffName:name,startDate:'2026-10-16',endDate:'2026-10-31',frozenData:{basicPay:450},finalNetPay:400});const view=await inspect(f),night=view.choices.find(row=>row.shiftId==='night');assert.match(night.blockers.join(' '),/paid payslip/);assert.throws(()=>f.service.propose(view,night.key),/paid payslip/);assert.equal(f.calls.writes.length,0);});
test('a payment appearing after inspection is caught by the absent ordinary/refund sentinel inside the transaction',async()=>{for(const prefix of ['','refund-']){const f=fixture(),view=await inspect(f),proposal=f.service.propose(view),id=prefix+ordinaryPayrollId(staffId,'2026-10-16','2026-10-31');f.put('payroll_records/'+id,{staffId,startDate:'2026-10-16',endDate:'2026-10-31',finalNetPay:450,frozenData:{basicPay:450}});await assert.rejects(f.service.apply(proposal),/payment or leave changed/);assert.equal(revisions(f).length,0);}});
test('a concurrent roster or punch edit rejects the prepared correction before either settings write',async()=>{for(const source of ['index','punch','profile','leave-claim']){const f=fixture(),view=await inspect(f),proposal=f.service.propose(view);if(source==='index')f.put('settings/schedule_month_2026_10',{...f.get('settings/schedule_month_2026_10'),revisionIds:['original-october','new-revision']});else if(source==='punch')f.put('attendance_logs/'+f.out.id,{...f.out,timestamp:at('02:07',18)});else if(source==='profile')f.put('cashiers/'+staffId,{...f.profile,active:false});else f.put('settings/schedule_leave_staff_'+staffId,{dates:{'2026-10-17':{requestId:'new-leave'}}});await assert.rejects(f.service.apply(proposal),/changed|incomplete|active staff/);assert.equal(revisions(f).length,0);assert.equal(f.calls.writes.length,0);}});
test('an unrelated current-head edit does not replace or block the one-day historical source',async()=>{const f=fixture(),view=await inspect(f),proposal=f.service.propose(view),head={...f.get('settings/global_schedule'),scheduleRevisionId:'new-future-head'};f.put('settings/global_schedule',head);await f.service.apply(proposal);assert.deepEqual(f.get('settings/global_schedule'),head);assert.equal(revisions(f).length,1);});
test('commit rejection leaves both settings documents unchanged and the same prepared action can retry',async()=>{const f=fixture(),view=await inspect(f),proposal=f.service.propose(view),index=structuredClone(f.get('settings/schedule_month_2026_10'));f.failNextCommit();await assert.rejects(f.service.apply(proposal),/Commit rejected/);assert.equal(revisions(f).length,0);assert.deepEqual(f.get('settings/schedule_month_2026_10'),index);await f.service.apply(proposal);assert.equal(revisions(f).length,1);});
test('lost acknowledgement and repeated clicks recover one saved correction without another revision',async()=>{const f=fixture(),view=await inspect(f),proposal=f.service.propose(view);assert.equal(f.service.propose(view),proposal);f.loseNextAck();await assert.rejects(f.service.apply(proposal),/Connection lost/);assert.equal(revisions(f).length,1);const result=await f.service.apply(proposal);assert.equal(result.alreadySaved,true);assert.equal(revisions(f).length,1);assert.equal(f.get('settings/schedule_month_2026_10').revisionIds.length,2);});
test('a forged proposal, changed Owner session or missing Google verification cannot apply a roster correction',async()=>{const f=fixture(),view=await inspect(f),proposal=f.service.propose(view);await assert.rejects(f.service.apply({...proposal}),/original inspected/);f.api.auth.currentUser={...f.api.auth.currentUser};await assert.rejects(f.service.apply(proposal),/account/);f.api.auth.currentUser.providerData=[];await assert.rejects(inspect(f),/verified Owner/);assert.equal(revisions(f).length,0);});
test('synthetic Time Out, duplicate closures and overlapping Time In stay in exact attendance review',async()=>{for(const source of ['auto','duplicate','overlap']){const f=fixture();if(source==='auto')f.put('attendance_logs/'+f.out.id,{...f.out,type:'TIME OUT (AUTO)'});else if(source==='duplicate')f.put('attendance_logs/duplicate',{...f.out,id:'duplicate'});else f.put('attendance_logs/overlap',{...f.start,id:'overlap',timestamp:at('18:00')});await assert.rejects(inspect(f),/actual Time In|More than one|overlaps/);assert.equal(f.calls.writes.length,0);}});
function savedHead(f,extra={}){return {schemaVersion:1,status:'Confirmed',revisionId:'owner-head-001',version:1,staffId,staffName:name,branch,timeInLogId:f.start.id,timeInAt:f.start.timestamp,expectedStartAt:at('17:30'),expectedEndAt:at('02:00',18),workDate:'2026-10-17',shiftName:'Owner confirmed Night',sourceFingerprint:emergencyShiftSourceFingerprint(f.start),reviewedByUid:'fictional-owner',reviewedByEmail:owner,reviewedAt:at('18:00'),...extra};}
test('a fresh protected Owner head is read and never silently replaced by conflicting roster hours',async()=>{const f=fixture();f.put('attendance_shift_confirmations/'+f.start.id,savedHead(f,{expectedStartAt:at('09:00'),expectedEndAt:at('17:30'),shiftName:'Confirmed Morning'}));const view=await inspect(f),night=view.choices.find(row=>row.shiftId==='night');assert.match(night.blockers.join(' '),/Owner-confirmed hours differ/);assert.equal(view.recommendedKey,null);assert.throws(()=>f.service.propose(view,night.key),/Owner-confirmed/);assert.equal(f.calls.writes.length,0);});
test('a matching protected Owner head allows the dated roster while its saved head and event remain unchanged',async()=>{const f=fixture(),head=savedHead(f);f.put('attendance_shift_confirmations/'+f.start.id,head);const result=await apply(f);assert.equal(result.alreadySaved,false);assert.deepEqual(f.get('attendance_shift_confirmations/'+f.start.id),head);assert.ok(f.calls.reads.includes('attendance_shift_confirmations/'+f.start.id));assert.ok(f.calls.writes.every(path=>path.startsWith('settings/')));});
test('malformed or foreign protected heads hold the one-click action instead of being ignored',async()=>{for(const patch of [{reviewedByEmail:'manager@example.test'},{sourceFingerprint:'changed'},{staffId:'foreign-staff'}]){const f=fixture();f.put('attendance_shift_confirmations/'+f.start.id,savedHead(f,patch));await assert.rejects(inspect(f),/Owner attendance review/);assert.equal(f.calls.writes.length,0);}});
test('a prior completed duty overlapping the selected shift is held even when its Time In precedes this pair',async()=>{const f=fixture();f.put('attendance_logs/prior-in',{...f.start,id:'prior-in',timestamp:at('16:00')});f.put('attendance_logs/prior-out',{...f.out,id:'prior-out',timeInLogId:'prior-in',timeInAt:at('16:00'),timestamp:at('18:00')});await assert.rejects(inspect(f),/saved duty overlaps/);assert.equal(f.calls.writes.length,0);});
test('a newly inserted historical punch or custom-cutoff payment is detected again immediately before apply',async()=>{for(const source of ['new-punch','custom-payment']){const f=fixture(),view=await inspect(f),proposal=f.service.propose(view);if(source==='new-punch')f.put('attendance_logs/late-created-punch',{...f.start,id:'late-created-punch',timestamp:at('18:00')});else f.put('payroll_records/custom-paid',{staffId,staffName:name,startDate:'2026-10-10',endDate:'2026-10-20',finalNetPay:450,frozenData:{basicPay:450}});await assert.rejects(f.service.apply(proposal),/changed|overlaps/);assert.equal(revisions(f).length,0);assert.equal(f.calls.writes.length,0);}});
test('an acknowledged action releases its local attempt so a later independent reviewed correction can be prepared',async()=>{const f=fixture();await apply(f);const view=await inspect(f),proposal=f.service.propose(view,view.choices.find(row=>row.shiftId==='night').key);assert.equal(proposal.operationId,'operation-2');assert.equal(revisions(f).length,1);});
test('historical records far outside this exact duty do not consume transaction source slots or block the work date',async()=>{const f=fixture();for(let i=0;i<600;i++)f.put('attendance_logs/old-'+i,{...f.start,id:'old-'+i,timestamp:new Date('2024-01-01T00:00:00Z')});const view=await inspect(f);assert.ok(view.recommendedKey);assert.equal(f.calls.writes.length,0);});
for(const change of [{shiftType:'invented-night'},{days:'all'},{days:[7]},{startTime:'25:00'},{active:'true'}])test('malformed saved shift metadata '+JSON.stringify(change)+' cannot become an automatic plotted correction',async()=>{const f=fixture();Object.assign(f.get('settings/schedule_revision_original-october').snapshot.branchConfig[branch][1],change);const view=await inspect(f);assert.equal(view.status,'blocked');assert.equal(view.recommendedKey,null);assert.match(view.blockers.join(' '),/incomplete or conflicting/);assert.throws(()=>f.service.propose(view));assert.equal(f.calls.writes.length,0);});
test('a sub-hour misclick and future alleged actual departure cannot establish a worked roster',async()=>{const short=fixture();short.put('attendance_logs/'+short.out.id,{...short.out,timestamp:at('17:40')});await assert.rejects(inspect(short),/sub-hour misclick/);const future=fixture({clockNow:at('18:00')});await assert.rejects(inspect(future),/attendance is in the future/);assert.equal(short.calls.writes.length+future.calls.writes.length,0);});
test('blocked staff, revoked saved Owner access and non-server sources remain non-mutating holds',async()=>{const blocked=fixture();blocked.put('cashiers/'+staffId,{...blocked.profile,blocked:true});await assert.rejects(inspect(blocked),/active staff profile/);const revoked=fixture();revoked.put('hq_managers/fictional-owner',{...revoked.get('hq_managers/fictional-owner'),active:false});await assert.rejects(inspect(revoked),/saved Owner account is inactive/);const cached=fixture(),read=cached.api.getDocFromServer;cached.api.getDocFromServer=async reference=>({...await read(reference),metadata:{fromCache:true,hasPendingWrites:false}});await assert.rejects(inspect(cached),/Reconnect to HQ/);assert.equal(blocked.calls.writes.length+revoked.calls.writes.length+cached.calls.writes.length,0);});
test('a separately completed same-day duty is retained',async()=>{const separate=fixture();separate.put('attendance_logs/day-in',{...separate.start,id:'day-in',timestamp:at('09:00')});separate.put('attendance_logs/day-out',{...separate.out,id:'day-out',timestamp:at('17:00'),timeInLogId:'day-in',timeInAt:at('09:00')});const second=await inspect(separate),night=second.choices.find(row=>row.shiftId==='night');assert.match(night.blockers.join(' '),/Another completed duty/);assert.throws(()=>separate.service.propose(second,night.key));assert.equal(separate.calls.writes.length,0);});
test('a fresh app session recognizes the same already-audited actual pair instead of appending a duplicate correction',async()=>{const f=fixture();await apply(f);const before=f.calls.writes.length,another=f.makeService(),view=await another.inspect(f.context),choice=view.choices.find(row=>row.shiftId==='night');assert.equal(choice.alreadyCorrected,true);const result=await another.apply(another.propose(view));assert.equal(result.alreadySaved,true);assert.equal(result.revisionId,'worked-operation-1');assert.equal(f.calls.writes.length,before);assert.equal(revisions(f).length,1);});
const windowQueries=f=>f.calls.queries.filter(query=>query.table==='attendance_logs'&&query.filters.some(filter=>filter.key==='timestamp'));

async function workedLetterIntegration(boundary=false,occupied=false,quick){
 const nightSlots=occupied?{rules:[rule('morning','09:00','17:30','morning'),rule('night','17:30','02:00','night'),rule('night2','17:30','02:00','night')],extraDay:{scheduled:{morning:'CREW',night:'Crew A',night2:'Crew B'}}}:{};
 const f=fixture(nightSlots),requestId='worked-letter',start=f.get('attendance_logs/'+f.start.id);start.lateMinutes=88;delete start.lateDecision;
 if(occupied)f.put('staff_requests/undated',{type:'Leave',status:'Approved',staffId,staffName:name});
 if(boundary){const snapshot=structuredClone(f.snapshot);snapshot.currentSchedule={31:snapshot.currentSchedule[17]};const revision=createScheduleRevision(snapshot,{revisionId:'original-october',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:at('00:00',1)});f.put('settings/schedule_revision_original-october',revision);start.timestamp=new Date('2026-11-01T00:05:00+08:00');start.scheduleSnapshot=captureAttendanceSchedule(start.timestamp,branch,name,{historyMonths:{'2026-10':{month:'2026-10',revisions:[revision]}}},{[name]:{...f.profile,staffId}});f.put('attendance_logs/'+f.out.id,{...f.out,timestamp:new Date('2026-11-01T02:06:00+08:00'),timeInAt:start.timestamp});}
 const history=await createScheduleHistoryStore(f.api).loadRange(boundary?'2026-10-31':'2026-10-16',boundary?'2026-11-02':'2026-10-18'),source={start:{...start,id:f.start.id},staffId,staffName:name},choice=proposals.savedShiftChoices(history,source).find(row=>row.shiftId==='night');
 f.put('staff_requests/'+requestId,{type:'Reason Letter',status:'Pending',staffId,staffName:name,branch,attendanceLogId:f.start.id,timestamp:start.timestamp,lateMinutes:88,explanationCause:'Tardiness / Late Arrival',explanationMessage:'Swapped and approved; please review Night.',staffShiftProposal:proposals.makeSavedShiftProposal(history,source,choice)});
 const document=new ReviewDocument();const makeElement=document.createElement.bind(document);document.createElement=tag=>Object.assign(makeElement(tag),{style:{}});ReviewElement.prototype.remove||=function(){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);};document.body.insertAdjacentHTML=(_where,html)=>{const box=document.createElement('div');box.innerHTML=html;for(const child of [...box.children])document.body.append(child);};
 const alerts=[],api=f.api;Object.assign(api,{loadPayrollScheduleHistory:(from,to)=>createScheduleHistoryStore(api).loadRange(from,to),loadInbox:async()=>{},ManagerUI:{notify:message=>alerts.push(message)}});
 const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),handler=name=>{const begin=main.indexOf('\nwindow.'+name+' = '),end=main.indexOf('\n};',begin+1);return main.slice(begin+1,end+3);};
 const context=vm.createContext({...payrollFunctions,...lateSummaries,...lateResolution,...proposals,reviewLateRequestWorkedShift,reviewLateRequestDatedAttendance,resolveEmergencyShift,attendanceMillis,scheduleDateKey,OWNER_EMAIL:owner,requestEscape:value=>String(value??''),window:api,document,Date,console,tkOwnerDoc:ref=>api.getDocFromServer(ref),tkOwnerDocs:q=>api.getDocsFromServer(q),Swal:{fire:(...args)=>alerts.push(args)}});
 for(const name of ['updateLateRequestPreview','openLateRequestAttendance','handleRequest','submitCurrentRequestReply','submitRequestReply'])vm.runInContext(handler(name),context);
 if(quick){
  api.workedShiftCorrectionUI=installWorkedShiftCorrectionUI(api,document,{service:f.service});
  api.ownerRequestDialog=installOwnerRequestDialog(api,document,{makeService:()=>f.service});
  const reqPath='staff_requests/'+requestId,attendancePath='attendance_logs/'+start.id,original=f.get(reqPath);
  if(quick.startsWith('declaration')){
   const p=original.staffShiftProposal;
   const declaration={schemaVersion:1,kind:'unrequested-swap',referenceOnly:true,staffId,staffName:name,attendanceBranch:branch,
    coworkerStaffId:'crew-a',coworkerName:'Crew A',coworkerHomeBranch:branch,targetBranch:branch,workDate:p.workDate,targetShiftId:p.shiftId,
    targetShiftName:p.shiftName,targetAssignedName:'Crew A',targetStartAt:p.expectedStartAt,targetEndAt:p.expectedEndAt,
    declaredAt:start.timestamp.toISOString(),sourceRevisionId:p.sourceRevisionId,sourceFingerprint:'reference',originalScheduleFingerprint:'punch',explanation:'Reported night duty.'};
   const keys=['coworkerStaffId','coworkerName','coworkerHomeBranch','workDate','targetBranch','targetShiftId','targetShiftName','targetAssignedName','targetStartAt','targetEndAt','sourceRevisionId'];
   declaration.sourceFingerprint=clockInDeclarationIdentity({...Object.fromEntries(keys.map(k=>[k,declaration[k]])),shiftType:'night',amendmentIds:[]});
   declaration.originalScheduleFingerprint=attendanceScheduleIdentity(start.scheduleSnapshot);
   f.put(reqPath,{...original,type:'Schedule Declaration',scheduleDeclaration:declaration});
   f.put(attendancePath,{...f.get(attendancePath),scheduleDeclaration:declaration,scheduleDeclarationRequestId:requestId});
  }
  if(quick==='paid')f.put('payroll_records/paid-test',{staffId,staffName:name,startDate:'2026-10-16',endDate:'2026-10-31',isPaid:true});
  if(quick==='source'){const altered={...original.staffShiftProposal,sourceFingerprint:'wrong'};f.put(reqPath,{...original,staffShiftProposal:altered});}
  if(quick==='active')f.docs.delete('attendance_logs/'+f.out.id);
  let opened;
  api.openAttendanceRecovery=args=>{opened=args;};
  const initial=structuredClone([...f.docs]);
  if(quick.startsWith('declaration'))await installScheduleDeclarationReview(api,document).open(requestId);
  else await api.handleRequest(requestId,'Approved','Reason Letter',0,name);
  const node=document.querySelector('[data-request-kind]');assert.ok(node,JSON.stringify(alerts));
  const button=node.querySelector('[data-save]'),alt=node.querySelector('[data-alt]'),status=node.querySelector('[data-status]');
  assert.deepEqual([...f.docs],initial);assert.equal(button.disabled,false);
  if(quick==='keep'){await alt.onclick();assert.equal(document.getElementById('replyStaffShiftDecision').value,'Keep original assigned hours');assert.deepEqual([...f.docs],initial);return;}
  if(['active','paid','source'].includes(quick)){assert.equal(button.textContent,'Open linked attendance');await button.onclick();assert.equal(opened.attendanceLogId,start.id);assert.deepEqual([...f.docs],initial);return;}
  if(quick==='declaration-only'){await alt.onclick();assert.equal(f.get(reqPath).status,'Reviewed');assert.equal(revisions(f).length,0);return;}
  if(quick==='stale')f.put(reqPath,{...original,explanationMessage:'A different explanation.'});
  if(quick==='failure')f.failNextCommit();
  if(quick==='lost')f.loseNextAck();
  await Promise.all([button.onclick(),button.onclick()]);
  if(quick==='stale'){assert.equal(revisions(f).length,0);assert.equal(f.get(reqPath).status,'Pending');return;}
  if(quick==='failure'){assert.deepEqual([...f.docs],initial);assert.equal(button.disabled,false);await button.onclick();}
  if(quick==='lost'){assert.equal(revisions(f).length,1);await button.onclick();}
  const saved=f.get(reqPath),isDecl=quick.startsWith('declaration');
  assert.equal(saved.status,isDecl?'Reviewed':'Approved',status.textContent+' '+JSON.stringify(alerts));
  assert.equal(saved.ownerShiftResolution.revisionId,'worked-operation-1');assert.equal(revisions(f).length,1);
  assert.equal(f.get(attendancePath).lateExempted,!isDecl);assert.equal(f.get(attendancePath).lateMinutes,88);
  if(occupied)assert.deepEqual(f.get('settings/schedule_revision_worked-operation-1').snapshot.currentSchedule[17][branch],f.snapshot.currentSchedule[17][branch]);
  return;
 }
 await api.handleRequest(requestId,'Approved','Reason Letter',0,name);assert.equal(document.getElementById('btnSubmitReply').disabled,true);document.getElementById('replyMessage').value='Swapped and approved; exact Night hours checked.';
 api.workedShiftCorrectionUI=installWorkedShiftCorrectionUI(api,document,{service:f.service});
 const dialog=await api.openLateRequestAttendance();assert.ok(dialog?.querySelector,JSON.stringify(alerts));const confirm=dialog.querySelector('[data-apply]');
 const radios=dialog.querySelectorAll('[data-choice]');
 assert.equal(radios.length,occupied?2:1);
 if(occupied){assert.equal(confirm.disabled,true);assert.match(dialog.textContent,/incomplete dates/);}
 radios[0].onchange();assert.equal(confirm.disabled,false);await confirm.onclick();
 if(occupied){const revision=f.get('settings/schedule_revision_worked-operation-1');assert.deepEqual(revision.snapshot.currentSchedule[17][branch],f.snapshot.currentSchedule[17][branch]);}
 assert.equal(api.lateRequestContext.proposalHoursReviewed,true,JSON.stringify(alerts));assert.equal(api.lateRequestContext.proposalReferenceError,'');assert.equal(document.getElementById('btnSubmitReply').disabled,false);assert.match(document.getElementById('replyMessage').value,/exact Night hours/);assert.match(document.getElementById('replyLateCalculation').innerHTML,/88 minutes reported/);
 const before=structuredClone(f.get('attendance_logs/'+f.start.id));await api.submitCurrentRequestReply();const saved=f.get('staff_requests/'+requestId);
 assert.equal(saved.status,'Approved',JSON.stringify(alerts));assert.equal(saved.staffShiftProposalReview.decision,'Worked shift reviewed separately');assert.ok(saved.staffShiftProposalReview.workedShiftCorrectionId);assert.equal(f.get('attendance_logs/'+f.start.id).lateMinutes,88);assert.equal(f.get('attendance_logs/'+f.start.id).reviewedLateMinutes,88);assert.equal(f.get('attendance_logs/'+f.start.id).lateExempted,true);assert.deepEqual(f.get('attendance_logs/'+f.start.id).timestamp,before.timestamp);assert.equal(saved.currentReviewedLateMinutes,undefined,'no fabricated dated-zero resolution');
}
test('real worked-shift correction returns to a freshly enabled proposal letter and its explicit atomic approval preserves original lateness',()=>workedLetterIntegration());
test('two occupied nights and an undated leave permit the requested Night to be confirmed and then the letter approved',()=>workedLetterIntegration(false,true));
test('a next-month clock-in proposing the previous month overnight slot returns to a freshly approved exact-date letter',()=>workedLetterIntegration(true));
test('proposal letter approval rejects altered saved references even after a genuine worked-shift correction',async()=>{
 for(const defect of ['fingerprint','source','hours']){
  const f=fixture(),requestId='protected-worked-letter',history=await createScheduleHistoryStore(f.api).loadRange('2026-10-16','2026-10-18'),input={start:f.start,staffId,staffName:name},choice=proposals.savedShiftChoices(history,input).find(row=>row.shiftId==='night'),proposal=proposals.makeSavedShiftProposal(history,input,choice);
  f.put('staff_requests/'+requestId,{type:'Reason Letter',status:'Pending',staffId,staffName:name,branch,attendanceLogId:f.start.id,timestamp:f.start.timestamp,lateMinutes:37,explanationCause:'Tardiness / Late Arrival',staffShiftProposal:proposal});
  await apply(f);const saved=f.get('staff_requests/'+requestId);if(defect==='fingerprint')saved.staffShiftProposal.sourceFingerprint='forged';if(defect==='source')saved.staffShiftProposal.sourceRevisionId='missing-source';if(defect==='hours')saved.staffShiftProposal.expectedStartAt=at('18:00').toISOString();
  const before=structuredClone([...f.docs]);await assert.rejects(lateResolution.reviewOriginalLateRequest(f.api,{requestId,attendanceId:f.start.id,profileId:staffId,action:'Approved',reply:'Owner reviewed the exact proposal.',actor:'Fictional Owner'}),/plotted shift|proposal/);assert.deepEqual([...f.docs],before);
 }
});
test('an in-progress proposed shift cannot create a correction before its actual Time Out',async()=>{
 const f=fixture();f.docs.delete('attendance_logs/'+f.out.id);const before=structuredClone([...f.docs]);await assert.rejects(inspect(f),/complete.*actual Time In and Time Out/);assert.deepEqual([...f.docs],before);assert.equal(f.calls.writes.length,0);
});
test('the actual default attendance reader uses one bounded timestamp-only window and excludes old and foreign staff from transaction guards',async()=>{
 const f=fixture({defaultReader:true});for(let i=0;i<2500;i++)f.put('attendance_logs/old-'+i,{...f.start,id:'old-'+i,timestamp:new Date('2020-01-01T00:00:00Z')});for(let i=0;i<200;i++)f.put('attendance_logs/foreign-'+i,{...f.start,id:'foreign-'+i,staffId:'different-staff',staffName:name});
 const view=await inspect(f),queries=windowQueries(f);assert.equal(queries.length,1);assert.ok(view.recommendedKey);const range=queries[0].filters.filter(filter=>filter.key);assert.deepEqual(range.map(filter=>[filter.key,filter.op]),[['timestamp','>='],['timestamp','<']]);assert.equal(+range[0].value,+f.start.timestamp-2*86400000);assert.equal(+range[1].value,+f.start.timestamp+2*86400000);assert.equal(queries[0].filters.find(filter=>filter.limit).limit,2001);assert.equal(f.calls.queries.filter(query=>query.table==='attendance_logs'&&query.filters.some(filter=>filter.key==='timeInLogId')).length,1);
 await f.service.apply(f.service.propose(view));assert.equal(windowQueries(f).length,2,'one range query per initial/final fresh inspection');assert.ok(f.calls.transactionReads.some(path=>path==='attendance_logs/'+f.out.id));assert.equal(f.calls.transactionReads.some(path=>/attendance_logs\/(foreign-|old-)/.test(path)),false);assert.equal(revisions(f).length,1);
});
test('the default readonly-date reader centers its bounded window on the requested Philippine work date',async()=>{const f=fixture({defaultReader:true}),view=await f.service.inspect({staffId,branch,workDate:'2026-10-17'}),query=windowQueries(f)[0],bounds=query.filters.filter(filter=>filter.key==='timestamp');assert.equal(view.attendanceLogId,f.start.id);assert.equal(+bounds[0].value,+at('00:00')-2*86400000);assert.equal(+bounds[1].value,+at('00:00')+2*86400000);assert.equal(windowQueries(f).length,1);assert.equal(f.calls.writes.length,0);});
test('a held default window response cannot cross a replaced Owner account or branch scope',async()=>{
 let arrive,release;const entered=new Promise(resolve=>arrive=resolve),gate=new Promise(resolve=>release=resolve),f=fixture({defaultReader:true}),read=f.api.getDocsFromServer;
 f.api.getDocsFromServer=async query=>{if(query.table==='attendance_logs'&&query.filters.some(filter=>filter.key==='timestamp')){arrive();await gate;}return read(query);};const pending=inspect(f);await entered;f.api.auth.currentUser={...f.api.auth.currentUser};release();await assert.rejects(pending,/Owner account/);assert.equal(f.calls.writes.length,0);assert.equal(f.calls.transactionReads.length,0);
});
test('the bounded default reader rejects an overfull or unconfirmed window before selecting any source',async()=>{for(const mode of ['overfull','cached']){const f=fixture({defaultReader:true});if(mode==='overfull')for(let i=0;i<2000;i++)f.put('attendance_logs/foreign-'+i,{...f.start,id:'foreign-'+i,staffId:'different-staff'});else{const read=f.api.getDocsFromServer;f.api.getDocsFromServer=async query=>{const snapshot=await read(query);return query.table==='attendance_logs'&&query.filters.some(filter=>filter.key==='timestamp')?{...snapshot,metadata:{fromCache:true,hasPendingWrites:false}}:snapshot;};}await assert.rejects(inspect(f),/Too many attendance records|Reconnect to HQ/);assert.equal(f.calls.writes.length,0);}});

for(const mode of ['confirm','declaration','declaration-only','failure','lost','stale','active','paid','source','keep']){
 test('Owner Inbox linked action through its actual dialog: '+mode,()=>workedLetterIntegration(false,mode.startsWith('declaration')||mode==='confirm',mode));
}

test('manually entered overnight duty uses the selected hours for this employee without an archived roster',async()=>{
 const f=fixture({missingHistory:true}),manualDuty={name:'Night 1',shiftType:'night',startTime:'17:30',endTime:'02:00'},context={...f.context,workDate:'2026-10-17',manualDuty};
 const view=await f.service.inspect(context),choice=view.choices.find(c=>!c.blockers.length);assert.ok(choice.ownerEntered);assert.equal(view.recommendedKey,null);
 await f.service.apply(f.service.propose(view,choice.key));
 const history=await createScheduleHistoryStore(f.api).loadRange(f.start.timestamp,f.out.timestamp);
 const shift=resolveAttendanceShift(f.start,history,{[name]:{...f.profile,staffId}},name);
 assert.equal(shift.shiftName,'Night 1');assert.equal(attendanceLateMinutes(f.start,shift),0);
 assert.equal(resolveScheduleForDate(history,context.workDate),null);
});

for(const manual of [false,true])for(const emergency of [false,true]){
 test('confirming '+(manual?'entered':'selected')+' cross-branch hours uses the Time In location '+(emergency?'with':'without')+' an emergency marker',async()=>{
  const day='2026-10-17',f=fixture({rules:[rule('mid','16:00','00:30','mid')],extraDay:{unavailable:['CREW']}}),other='Other Branch';
  const saved=f.get('settings/schedule_revision_original-october'),roster=saved.daySnapshots[day].daySchedule;
  roster[other]={scheduled:{mid:'CREW'},rest:[],unavailable:[]};
  const original=structuredClone(roster);
  const relief=emergency?{emergencyRelief:{version:1,homeBranch:other,branch,requiresReview:true}}:{};
  const start={...f.start,...relief,timestamp:at('15:41'),lateMinutes:472};
  const out={...f.out,...relief,...(emergency?{reliefRequestId:'fictional-cover'}:{}),timestamp:at('00:31',18),timeInAt:start.timestamp};
  f.put('attendance_logs/'+start.id,start);f.put('attendance_logs/'+out.id,out);
  const profile={...f.profile,branch:other};f.put('cashiers/'+staffId,profile);
  const manualDuty={name:'Mid kitchen',shiftType:'mid',startTime:'16:00',endTime:'00:30'};
  const context={...f.context,workDate:day,...(manual?{manualDuty}:{})};
  const view=await f.service.inspect(context),choice=view.choices.find(row=>manual?row.ownerEntered:row.shiftId==='mid');
  assert.deepEqual(choice.blockers,[]);assert.equal(choice.attendanceOnly,true);assert.deepEqual(choice.rosterException.otherBranches,[other]);
  const receipt=await f.service.apply(f.service.propose(view,choice.key)),revision=f.get('settings/schedule_revision_'+receipt.revisionId);
  const audit=revision.historicalWorkedShiftReview;
  assert.equal(audit.branch,branch);assert.equal(audit.timeOutLogId,out.id);assert.deepEqual(audit.rosterException.unavailableBranches,[branch]);
  assert.deepEqual(f.get('attendance_logs/'+start.id),start);assert.deepEqual(f.get('attendance_logs/'+out.id),out);assert.deepEqual(f.get('cashiers/'+staffId),profile);
  const history=await createScheduleHistoryStore(f.api).loadRange(start.timestamp,out.timestamp);
  assert.deepEqual(resolveScheduleForDate(history,day).currentSchedule[17],original);
  const shift=resolveAttendanceShift(start,history,{[name]:{...profile,staffId}},name);
  assert.equal(shift.workedShiftCorrectionId,receipt.revisionId);assert.equal(shift.shiftType,'mid');assert.equal(shift.workDate,day);
  assert.equal(+shift.expectedEndAt,+at('00:30',18));assert.equal(attendanceLateMinutes(start,shift),0);
  if(emergency)assert.equal(payrollReliefHoursVerified(shift,out),true);
  const payroll=planPayrollAttendance([start,out],{resolveShift:()=>shift});
  assert.deepEqual(payroll.reviews,[]);assert.deepEqual(payroll.logs.map(log=>log.branch),[branch,branch]);
  const again=await f.service.inspect(context),same=again.choices.find(row=>row.key===choice.key||row.shiftId===choice.shiftId);
  assert.equal((await f.service.apply(f.service.propose(again,same.key))).alreadySaved,true);
 });
}
test('legacy date flags and roster names apply only to this employee and work date',async()=>{
 const f=fixture({extraDay:{unavailable:[{name:'CREW',staffId:'another-id',status:'Leave'}]}}),day='2026-10-17';
 const source=f.get('settings/schedule_revision_original-october');
 assert.equal((await inspect(f)).choices.find(row=>row.shiftId==='night').rosterException,null);
 source.snapshot.unavailability={[day]:{CREW:'Day Off'}};
 const view=await inspect(f),night=view.choices.find(row=>row.shiftId==='night');
 assert.equal(night.rosterException.dateRestriction,true);assert.deepEqual(night.rosterException.unavailableBranches,[]);assert.deepEqual(night.blockers,[]);
 const proposed=f.service.propose(view,night.key);
 f.put('settings/schedule_leave_staff_'+staffId,{dates:{[day]:{requestId:'new-leave'}}});
 await assert.rejects(f.service.apply(proposed),/changed/);assert.equal(f.calls.writes.length,0);
});
test('a real dated assignment at the cover branch can confirm hours without a staff request decision',async()=>{
 const f=fixture(),profile={...f.profile,staffId,branch:'Home Branch'},marker={version:1,requiresReview:true,homeBranch:'Home Branch',branch};
 const start={...f.start,emergencyRelief:marker,timestamp:at('08:55')},out={...f.out,timestamp:at('17:25')};
 const history=await createScheduleHistoryStore(f.api).loadRange(start.timestamp,out.timestamp);
 const result=resolveAttendanceShift(start,history,{[name]:profile},name);
 assert.ok(payrollReliefHoursVerified(result,out));assert.equal(result.reliefNeedsReview,undefined);
 assert.equal(payrollReliefHoursVerified(result,{...out,timestamp:at('02:00',18)}),false);
 const unmatched=resolveAttendanceShift({...start,staffName:'Unassigned',staffId:'different'},history,{'Unassigned':{staffId:'different',cashierName:'Unassigned'}},'Unassigned');
 assert.ok(unmatched.reliefNeedsReview);assert.equal(payrollReliefHoursVerified(unmatched,out),false);
});
