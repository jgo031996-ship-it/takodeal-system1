import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createScheduleRevision,assembleScheduleHistory} from '../takodeal-staff/schedule-history.js';
import {savedShiftChoices,makeSavedShiftProposal,validateSavedShiftProposal,loadSavedShiftChoices,inspectStaffShiftProposal,savedShiftChoicesHTML,selectedSavedShiftChoice} from '../takodeal-staff/saved-shift-proposal.js';
import {createEarlyTimeOutService} from '../takodeal-staff/early-time-out-actions.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

const branch='Fictional Branch',staffId='fictional-staff',staffName='Fictional Crew';
const rules=[{id:'m1',name:'Morning 1',shiftType:'morning',startTime:'09:00',endTime:'17:00'},
 {id:'m2',name:'Morning 2',shiftType:'morning',startTime:'10:00',endTime:'18:00'},
 {id:'mid',name:'Mid',shiftType:'mid',startTime:'13:00',endTime:'21:00'},
 {id:'night',name:'Night',shiftType:'night',startTime:'19:00',endTime:'04:00'}];
const at=value=>new Date('2026-11-'+value+'+08:00');
function roster(){
 const currentSchedule={};for(let date=1;date<=30;date++)currentSchedule[date]={[branch]:{scheduled:Object.fromEntries(rules.map(row=>[row.id,'Other Fictional Crew'])),rest:[],unavailable:[],swaps:{}}};
 const snapshot={currentYear:2026,currentMonth:11,branchConfig:{[branch]:structuredClone(rules),'Other Fictional Branch':[{id:'foreign',name:'Foreign',startTime:'08:00',endTime:'16:00'}]},currentSchedule};
 const revision=createScheduleRevision(snapshot,{revisionId:'fictional-roster-v1',effectiveFrom:'2026-11-01',effectiveTo:'2026-11-30',savedAt:at('01T00:00:00'),cutover:'2026-11-01'});
 const archive={month:'2026-11',revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId,revisions:[revision],shiftAmendments:[]};
 return {snapshot,revision,history:assembleScheduleHistory(snapshot,[archive]),archive};
}
function source(timestamp=at('04T10:05:00')){return {id:'fictional-time-in',type:'TIME IN',staffId,staffName,branch,timestamp,scheduleSnapshot:{version:1,source:'clock-in',branch,staffName,wasScheduled:false,needsScheduleReview:true},lateMinutes:65};}
const input=start=>({start,staffId,staffName});
function pick(history,start,id='m2'){const row=savedShiftChoices(history,input(start)).find(row=>row.shiftId===id);assert.ok(row);return {key:row.key,sourceFingerprint:row.sourceFingerprint};}
function fixture(){
 const h=firestoreHarness(),r=roster(),start=source(),person={cashierName:staffName,branch,active:true,pin:'fictional-pin'};
 h.put('settings/global_schedule',r.snapshot);h.put('settings/schedule_history_policy',{payrollHistoryEnforcedFrom:'2026-11-01'});
 h.put('settings/schedule_month_2026_11',{month:'2026-11',revisionIds:[r.revision.revisionId],latestRevisionId:r.revision.revisionId,shiftAmendments:[]});
 h.put('settings/schedule_revision_'+r.revision.revisionId,r.revision);
 h.put('attendance_logs/'+start.id,start);h.put('cashiers/'+staffId,person);
 const reads=[];
 h.api.getDocFromServer=async ref=>{reads.push(ref.path);return {id:ref.id,ref,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}};};
 h.api.auth={currentUser:{uid:'fictional-owner',email:'owner@example.test'}};h.api.sessionUser={uid:'fictional-owner',email:'owner@example.test',isOwner:true};
 const service=createEarlyTimeOutService(h.api,{now:()=>at('04T15:00:00'),makeToken:()=> 'fictional-request-token-001'});
 const request={...input(start),pin:'fictional-pin',reason:'Please check the branch instruction for this saved shift.'};
 const reviewer={uid:'fictional-owner',email:'owner@example.test'};
 const inspect=requestId=>service.inspectRequest({requestId,reviewer,assertReviewAccess:()=>true});
 const confirm=async(requestId,extra={})=>{const p=await inspect(requestId);return service.confirmShiftRequest({requestId,reviewer,assertReviewAccess:()=>true,operationId:'fictional-confirmation-001',expectedRequestVersion:p.request.requestVersion,expectedRequestToken:p.request.requestToken,expectedScheduleFingerprint:p.scheduleFingerprint,expectedConfirmationVersion:p.emergencyShiftVersion,expectedSourceFingerprint:p.emergencyShiftSourceFingerprint,workDate:'2026-11-04',startTime:'10:00',endTime:'18:00',shiftName:'Morning 2',reason:'Assigned hours independently checked with the branch.',staffShiftProposalDecision:'Use proposed shift',staffShiftProposalFingerprint:p.staffShiftProposal?.sourceFingerprint||'',...extra});};
 return {h,...r,start,person,reads,service,request,inspect,confirm,selection:pick(r.history,start)};
}
const table=(h,name)=>[...h.docs].filter(([path])=>path.startsWith(name+'/'));

test('choices come from the original branch and dated plotted slots; closest start never assigns the slot or waives lateness',()=>{
 const r=roster(),start=source(),before=structuredClone(start),choices=savedShiftChoices(r.history,input(start));
 assert.equal(choices.length,4);assert.equal(choices[0].shiftId,'m2');assert.equal(choices.filter(row=>row.recommended).length,1);
 assert.ok(choices.every(row=>row.branch===branch&&row.workDate==='2026-11-04'&&row.sourceRevisionId==='fictional-roster-v1'));
 assert.deepEqual(start,before);assert.equal(start.lateMinutes,65);assert.equal(start.scheduleSnapshot.needsScheduleReview,true);
 const proposal=makeSavedShiftProposal(r.history,input(start),pick(r.history,start));assert.equal(proposal.referenceOnly,true);
 assert.equal(proposal.expectedStartAt,'2026-11-04T02:00:00.000Z');assert.equal(proposal.expectedEndAt,'2026-11-04T10:00:00.000Z');
 assert.equal(Object.hasOwn(proposal,'lateMinutes'),false);assert.equal(Object.hasOwn(proposal,'wasScheduled'),false);
});

test('an after-midnight Time In can propose the prior saved Night shift with its full next-day finish',()=>{
 const r=roster(),start=source(at('05T00:15:00')),choices=savedShiftChoices(r.history,input(start));
 const night=choices.find(row=>row.workDate==='2026-11-04'&&row.shiftId==='night');assert.ok(night);
 assert.equal(night.expectedStartAt,'2026-11-04T11:00:00.000Z');assert.equal(night.expectedEndAt,'2026-11-04T20:00:00.000Z');
 assert.equal(choices.some(row=>row.workDate==='2026-11-04'&&row.shiftId==='m1'),false);
 assert.equal(choices[0].key,night.key);
});

test('missing dated history cannot manufacture a choice from the current or a foreign branch configuration',()=>{
 const r=roster();assert.deepEqual(savedShiftChoices({...r.snapshot,historyMonths:{}},input(source())),[]);
 const changed=structuredClone(r.history);delete changed.historyMonths['2026-11'].revisions[0].daySnapshots['2026-11-04'].daySchedule[branch];
 assert.deepEqual(savedShiftChoices(changed,input(source())),[]);
});

test('unplotted, inactive and duplicated IDs are excluded without substituting a shift name',()=>{
 const r=roster(),revision=r.history.historyMonths['2026-11'].revisions[0];
 revision.snapshot.branchConfig[branch].push({...rules[1]});revision.snapshot.branchConfig[branch][0].active=false;
 delete revision.daySnapshots['2026-11-04'].daySchedule[branch].scheduled.mid;
 const choices=savedShiftChoices(r.history,input(source()));assert.deepEqual(choices.map(row=>row.shiftId),['night']);
});

for(const changed of ['ID','hours','revision','branch','authority','extra field'])test('fresh validation rejects changed proposal '+changed,()=>{
 const r=roster(),start=source(),proposal=makeSavedShiftProposal(r.history,input(start),pick(r.history,start));
 const bad=structuredClone(proposal);
 if(changed==='ID')bad.shiftId='not-saved';if(changed==='hours')bad.expectedEndAt='2026-11-04T11:00:00.000Z';
 if(changed==='revision')bad.sourceRevisionId='not-saved';if(changed==='branch')bad.branch='Other Fictional Branch';
 if(changed==='authority')bad.referenceOnly=false;if(changed==='extra field')bad.lateExempted=true;
 assert.throws(()=>validateSavedShiftProposal(r.history,input(start),bad));
});

test('a saved time change or a replacement dated revision invalidates the old stable selection',()=>{
 for(const change of ['times','revision']){const r=roster(),start=source(),selection=pick(r.history,start),revision=r.history.historyMonths['2026-11'].revisions[0];
  if(change==='times')revision.snapshot.branchConfig[branch][1].endTime='18:30';
  else{revision.revisionId='fictional-roster-v2';for(const day of Object.values(revision.daySnapshots))day.configRevisionId=revision.revisionId;}
  assert.throws(()=>makeSavedShiftProposal(r.history,input(start),selection),/changed|no longer/);
 }
});

test('the rendered dropdown keeps selection optional, escapes saved labels and labels the recommendation as a reference',()=>{
 const r=roster(),choices=savedShiftChoices(r.history,input(source()));choices[0].shiftName='<img onerror=bad()>';
 const html=savedShiftChoicesHTML(choices);assert.match(html,/closest to Time In/);assert.match(html,/recommendation only/);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<option[^>]*\sselected(?:\s|>)/);assert.equal(selectedSavedShiftChoice(choices,''),null);
 assert.throws(()=>selectedSavedShiftChoice(choices,'forged value'));assert.match(savedShiftChoicesHTML([]),/No dated plotted shifts/);
});

test('fresh reader rejects cached schedule responses and rechecks original Time In linkage for Owner display',async()=>{
 const f=fixture(),loaded=await loadSavedShiftChoices(f.h.api,input(f.start));assert.equal(loaded.choices.length,4);
 const row={staffId,staffName,branch,attendanceLogId:f.start.id,staffShiftProposal:makeSavedShiftProposal(f.history,input(f.start),f.selection)};
 const shown=await inspectStaffShiftProposal(f.h.api,row);assert.equal(shown.actualTimeInAt,'2026-11-04T02:05:00.000Z');assert.equal(shown.referenceOnly,true);
 await assert.rejects(inspectStaffShiftProposal(f.h.api,{...row,branch:'Other Fictional Branch'}),/different attendance branch/);
 const read=f.h.api.getDocFromServer;await assert.rejects(loadSavedShiftChoices(f.h.api,input(f.start),{read:async ref=>({...await read(ref),metadata:{fromCache:true}})}),/not confirmed/);
});

test('actual request service saves only the proposal alongside the reason and leaves the original punch/schedule unchanged',async()=>{
 const f=fixture(),before=structuredClone(f.h.get('attendance_logs/'+f.start.id)),schedule=structuredClone(f.h.get('settings/global_schedule'));
 const result=await f.service.request({...f.request,staffShiftChoice:f.selection}),row=f.h.get('staff_requests/'+result.id);
 assert.equal(row.staffShiftProposal.shiftId,'m2');assert.equal(row.status,'Pending');assert.equal(row.requiresScheduleReview,true);
 assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),before);assert.deepEqual(f.h.get('settings/global_schedule'),schedule);
 assert.equal(table(f.h,'attendance_shift_confirmations').length,0);assert.equal(table(f.h,'attendance_time_out_approvals').length,0);
 const shown=await f.inspect(result.id);assert.equal(shown.staffShiftProposal.shiftId,'m2');assert.equal(shown.staffShiftProposalError,'');assert.equal(shown.actualTimeInAt,'2026-11-04T02:05:00.000Z');
});

test('a stale submitted saved-slot selection fails atomically before a request is written',async()=>{
 const f=fixture();const revision=structuredClone(f.h.get('settings/schedule_revision_fictional-roster-v1'));revision.snapshot.branchConfig[branch][1].endTime='18:30';f.h.put('settings/schedule_revision_fictional-roster-v1',revision);
 await assert.rejects(f.service.request({...f.request,staffShiftChoice:f.selection}),/changed|no longer/);assert.equal(table(f.h,'staff_requests').length,0);
});

test('accepting a staff proposal confirms only its freshly saved exact bounds and does not waive original lateness',async()=>{
 const f=fixture(),request=await f.service.request({...f.request,staffShiftChoice:f.selection}),before=structuredClone(f.h.get('attendance_logs/'+f.start.id));
 await assert.rejects(f.confirm(request.id,{endTime:'18:30'}),/exact staff-proposed/);assert.equal(table(f.h,'attendance_shift_confirmations').length,0);
 await f.confirm(request.id);assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),before);
 assert.equal(f.h.get('attendance_shift_confirmations/'+f.start.id).expectedEndAt.toISOString(),'2026-11-04T10:00:00.000Z');
 assert.equal(f.h.get('staff_requests/'+request.id).staffShiftProposalReview.decision,'Confirmed');
 assert.match(table(f.h,'attendance_shift_confirmation_events')[0][1].reason,/Owner accepted staff-proposed saved shift/);
 assert.equal(table(f.h,'attendance_time_out_approvals').length,0);
});

test('an explicit Owner override can reject the proposal and confirm different checked hours with immutable audit text',async()=>{
 const f=fixture(),request=await f.service.request({...f.request,staffShiftChoice:f.selection}),before=structuredClone(f.h.get('attendance_logs/'+f.start.id));
 await f.confirm(request.id,{staffShiftProposalDecision:'Owner-confirmed hours',startTime:'09:00',endTime:'17:00',shiftName:'Owner-verified original shift'});
 assert.deepEqual(f.h.get('attendance_logs/'+f.start.id),before);
 assert.equal(f.h.get('staff_requests/'+request.id).staffShiftProposal.shiftId,'m2');
 assert.equal(f.h.get('staff_requests/'+request.id).staffShiftProposalReview.decision,'Overridden');
 assert.match(table(f.h,'attendance_shift_confirmation_events')[0][1].reason,/Owner override of staff-proposed shift/);
 assert.equal(table(f.h,'attendance_time_out_approvals').length,0);
});

test('a non-Owner reviewer cannot use the explicit override and Staff input cannot create the override audit',async()=>{
 const f=fixture(),request=await f.service.request({...f.request,staffShiftChoice:f.selection,staffShiftProposalDecision:'Owner-confirmed hours'});
 assert.equal(f.h.get('staff_requests/'+request.id).staffShiftProposalReview,undefined);f.h.api.sessionUser.isOwner=false;
 await assert.rejects(f.confirm(request.id,{staffShiftProposalDecision:'Owner-confirmed hours'}),/Only the signed-in Owner/);
 assert.equal(table(f.h,'attendance_shift_confirmations').length,0);
});

for(const mode of ['Use proposed shift','Owner-confirmed hours'])test(mode+' retains one immutable confirmation and one audit after a lost acknowledgment',async()=>{
 const f=fixture(),request=await f.service.request({...f.request,staffShiftChoice:f.selection}),sent=[],actual=f.service.confirmShiftRequest;
 f.service.confirmShiftRequest=input=>{sent.push(input);return actual(input);};f.h.loseNextAck();
 await assert.rejects(f.confirm(request.id,{staffShiftProposalDecision:mode}),/lost after commit/);
 const saved=structuredClone([...f.h.docs]);assert.equal((await actual(sent[0])).alreadySaved,true);
 assert.deepEqual([...f.h.docs],saved);assert.equal(table(f.h,'attendance_shift_confirmation_events').length,1);
});

test('a stale proposal remains visible as a review error and cannot be accepted after saved hours change',async()=>{
 const f=fixture(),request=await f.service.request({...f.request,staffShiftChoice:f.selection});
 const revision=structuredClone(f.h.get('settings/schedule_revision_fictional-roster-v1'));revision.snapshot.branchConfig[branch][1].startTime='10:30';f.h.put('settings/schedule_revision_fictional-roster-v1',revision);
 const shown=await f.inspect(request.id);assert.equal(shown.staffShiftProposal,null);assert.match(shown.staffShiftProposalError,/changed|no longer/);
 await assert.rejects(f.confirm(request.id),/changed|no longer/);assert.equal(table(f.h,'attendance_shift_confirmations').length,0);
});

test('all deployment copies preserve the same proposal/request validation logic',()=>{
 for(const name of ['saved-shift-proposal.js','early-time-out-actions.js','early-time-out-ui.js']){
  const source=readFileSync(new URL('../takodeal-staff/'+name,import.meta.url),'utf8');for(const app of ['takodeal-manager','Takodeal-POS'])assert.equal(readFileSync(new URL('../'+app+'/'+name,import.meta.url),'utf8'),source);
 }
 const app=readFileSync(new URL('../takodeal-staff/app.js',import.meta.url),'utf8');assert.match(app,/pendingLateRequest\.staffShiftProposal=makeSavedShiftProposal\(punchScheduleData/);
});
