import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ReviewDocument,ReviewElement} from './helpers/review-dom.mjs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {amendmentFixture} from './helpers/attendance-amendment-fixture.mjs';
import {confirmAttendanceAmendmentReview} from '../takodeal-manager/attendance-amendment-review.js';
import {createScheduleRevision,assembleScheduleHistory,createScheduleHistoryStore,scheduleDateKey} from '../takodeal-manager/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift,isLatenessRequest,requestLateMinutes,legacyAttendanceCandidates,staffProfileForWork,staffRateForDate,latePay,loadStaffSalaryTimeline} from '../takodeal-manager/payroll-safety.js';
import {savedShiftChoices,makeSavedShiftProposal,inspectStaffShiftProposal,staffShiftProposalHTML} from '../takodeal-manager/saved-shift-proposal.js';
import {emergencyShiftBounds,emergencyShiftSourceFingerprint,resolveEmergencyShift} from '../takodeal-manager/emergency-shift-model.js';
import {lateRequestSummary,lateRequestSummaryHTML} from '../takodeal-manager/late-request-summary.js';
import {lateRequestResolutionFingerprint} from '../takodeal-manager/late-request-resolution.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';

// Execute the deployed handlers rather than mirroring their proposal decision.
const main=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function handler(name){const start=main.indexOf('\nwindow.'+name+' = '),end=main.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,'actual '+name+' handler exists');return main.slice(start+1,end+3);}
const requestEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function install(api){
 const document=new ReviewDocument(),warnings=[];
 document.body.insertAdjacentHTML=(_position,html)=>{const box=document.createElement('div');box.innerHTML=html;for(const child of [...box.children])document.body.append(child);};
 ReviewElement.prototype.remove ||= function(){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);};
 const context=vm.createContext({window:api,document,console,Date,Symbol,OWNER_EMAIL,requestEscape,
  resolveAttendanceShift,isLatenessRequest,requestLateMinutes,legacyAttendanceCandidates,staffProfileForWork,staffRateForDate,latePay,loadStaffSalaryTimeline,
  inspectStaffShiftProposal,staffShiftProposalHTML,resolveEmergencyShift,lateRequestSummary,lateRequestSummaryHTML,lateRequestResolutionFingerprint,scheduleDateKey,
  tkOwnerDoc:ref=>api.getDocFromServer(ref),tkOwnerDocs:q=>api.getDocsFromServer(q),Swal:{fire:(...args)=>warnings.push(args)}});
 vm.runInContext(handler('updateLateRequestPreview')+'\n'+handler('handleRequest'),context);
 return {api,document,warnings,button:()=>document.getElementById('btnSubmitReply'),calculation:()=>document.getElementById('replyLateCalculation'),
  choose(value,reply=''){document.getElementById('replyStaffShiftDecision').value=value;document.getElementById('replyMessage').value=reply;api.updateLateRequestPreview();}};
}
async function fixture({originalValid=true,proposal=true}={}){
 const h=firestoreHarness(),staffId='fictional-staff',name='Fictional Crew',branch='Fictional Branch',attendanceId='fictional-time-in',requestId='fictional-letter',at=new Date('2026-11-04T10:05:00+08:00');
 const profile={cashierName:name,branch,active:true,hourlyRate:450},rules=[{id:'m1',name:'Morning 1',shiftType:'morning',startTime:'09:00',endTime:'17:30'}, {id:'m2',name:'Morning 2',shiftType:'morning',startTime:'10:00',endTime:'18:30'}];
 const plan={currentYear:2026,currentMonth:11,employees:[{id:staffId,name,branch}],branchConfig:{[branch]:rules},currentSchedule:{4:{[branch]:{scheduled:{m1:name,m2:'Other Fictional Crew'},rest:[],unavailable:[],swaps:{}}}}};
 const revision=createScheduleRevision(plan,{revisionId:'fictional-roster-v1',effectiveFrom:'2026-11-01',effectiveTo:'2026-11-30',savedAt:new Date('2026-11-01T00:00:00+08:00')});
 const history=assembleScheduleHistory(plan,[{month:'2026-11',revisions:[revision]}],{enforcedFrom:'2026-11-01'});
 const start={id:attendanceId,type:'TIME IN',staffId,staffName:name,branch,timestamp:at,lateMinutes:65,scheduleSnapshot:captureAttendanceSchedule(at,branch,name,history,{[name]:{...profile,staffId}})};
 if(!originalValid){start.scheduleSnapshot.needsScheduleReview=true;start.scheduleSnapshot.wasScheduled=false;}
 const row={type:'Reason Letter',status:'Pending',staffId,staffName:name,branch,attendanceLogId:attendanceId,timestamp:at,lateMinutes:65,explanationCause:'Tardiness / Late Arrival',explanationMessage:'Clocked in 65 minutes late. Reason: Please check the plotted Morning 2 shift.'};
 if(proposal){const choice=savedShiftChoices(history,{start,staffId,staffName:name}).find(row=>row.shiftId==='m2');row.staffShiftProposal=makeSavedShiftProposal(history,{start,staffId,staffName:name},choice);}
 h.put('staff_requests/'+requestId,row);h.put('cashiers/'+staffId,profile);h.put('attendance_logs/'+attendanceId,start);
 h.put('settings/global_schedule',plan);h.put('settings/schedule_history_policy',{payrollHistoryEnforcedFrom:'2026-11-01'});
 h.put('settings/schedule_month_2026_11',{month:'2026-11',revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId,shiftAmendments:[]});h.put('settings/schedule_revision_'+revision.revisionId,revision);
 const reads=[];h.api.getDocFromServer=async ref=>{reads.push(ref.path);return {id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path)),metadata:{fromCache:false,hasPendingWrites:false}};};
 Object.assign(h.api,{auth:{currentUser:{uid:'fictional-owner',email:OWNER_EMAIL,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'fictional-owner',email:OWNER_EMAIL,isOwner:true,isFranchisee:false},isBranchAllowed:value=>value===branch});
 h.api.loadPayrollScheduleHistory=(from,to)=>createScheduleHistoryStore(h.api).loadRange(from,to);
 const ui=install(h.api),before=structuredClone([...h.docs]);
 return {...h,...ui,staffId,name,branch,attendanceId,requestId,start,row,reads,before,
  open:()=>h.api.handleRequest(requestId,'Approved','Untrusted caller type',999,'Untrusted caller name'),
  confirmHead(){const bounds=emergencyShiftBounds({workDate:'2026-11-04',startTime:'10:00',endTime:'18:30',reason:'The branch assignment has been independently reviewed.',shiftName:'Morning 2'},start);
   const head={schemaVersion:1,status:'Confirmed',revisionId:'fictional-reviewed-shift',version:1,staffId,staffName:name,branch,timeInLogId:attendanceId,timeInAt:at,...bounds,sourceFingerprint:emergencyShiftSourceFingerprint(start),reviewedByUid:'fictional-owner',reviewedByEmail:OWNER_EMAIL,reviewedAt:new Date('2026-11-04T12:00:00+08:00')};delete head.reason;
   h.put('attendance_shift_confirmations/'+attendanceId,head);return head;}};
}
const unchanged=f=>assert.deepEqual([...f.docs],f.before,'opening/previewing must not change attendance, schedule, payroll or requests');

test('actual main opens an unreviewed proposal from fresh saved records, blocks approval and makes no exemption claim',async()=>{
 const f=await fixture();await f.open();assert.deepEqual(f.warnings,[]);assert.equal(f.api.lateRequestContext.proposalHoursReviewed,false);
 assert.equal(f.api.lateRequestContext.proposalActualTimeInAt,'2026-11-04T02:05:00.000Z');assert.equal(f.api.lateRequestContext.selectedLatePreview,null);
 assert.equal(f.button().disabled,true);assert.match(f.button().innerText,/Review proposed hours first/);assert.match(f.calculation().innerHTML,/separate|confirm the assigned hours/);
 assert.doesNotMatch(f.calculation().innerHTML,/exempted from the late deduction/);assert.equal(f.document.getElementById('replyStaffShiftDecision').value,'');
 assert.ok(f.reads.filter(path=>path==='attendance_logs/'+f.attendanceId).length>=2,'fresh proposal inspection rereads the exact Time In');
 assert.ok(f.reads.includes('attendance_shift_confirmations/'+f.attendanceId));assert.equal(f.api.currentRequestReply.staffName,f.name);assert.equal(f.api.currentRequestReply.amount,0);unchanged(f);
});

test('actual main accepts a freshly protected, source-linked confirmation head before offering the ordinary explanation review',async()=>{
 const f=await fixture();f.confirmHead();f.before=structuredClone([...f.docs]);await f.open();assert.deepEqual(f.warnings,[]);
 assert.equal(f.api.lateRequestContext.proposalHoursReviewed,true);assert.equal(f.api.lateRequestContext.proposalReferenceError,'');assert.equal(f.button().disabled,false);
 assert.equal(f.api.lateRequestContext.selectedLatePreview.corrected,false);assert.match(f.calculation().innerHTML,/65 minutes reported — exempted/);unchanged(f);
});

for(const defect of ['not Owner','wrong Google account','franchisee','unverified original','seven character reason'])test('Keep original cannot enable approval with '+defect,async()=>{
 const f=await fixture({originalValid:defect!=='unverified original'});
 if(defect==='not Owner')f.api.sessionUser.isOwner=false;if(defect==='wrong Google account')f.api.auth.currentUser.email='manager@example.invalid';if(defect==='franchisee')f.api.sessionUser.isFranchisee=true;
 await f.open();f.choose('Keep original assigned hours',defect==='seven character reason'?'1234567':'Original assigned hours have been checked.');
 assert.equal(f.button().disabled,true);assert.equal(f.api.lateRequestContext.selectedLatePreview,null);assert.doesNotMatch(f.calculation().innerHTML,/exempted from the late deduction/);unchanged(f);
});

test('verified Owner can explicitly keep valid original hours with an eight-character reason, without changing the saved assignment',async()=>{
 const f=await fixture();await f.open();f.choose('Keep original assigned hours','12345678');assert.equal(f.button().disabled,false);
 assert.match(f.button().innerText,/Confirm Approved/);assert.equal(f.api.lateRequestContext.selectedLatePreview.corrected,false);unchanged(f);
 f.choose('Keep original assigned hours','       1234567     ');assert.equal(f.button().disabled,true,'trimmed reason must still have eight characters');
});

for(const marker of ['unprotected log flags','malformed confirmation','different punch fingerprint','cached confirmation','pending local confirmation'])test(marker+' cannot impersonate a protected reviewed shift',async()=>{
 const f=await fixture();if(marker==='unprotected log flags'){Object.assign(f.get('attendance_logs/'+f.attendanceId),{emergencyShiftConfirmed:true,reliefReviewVerified:true,staffShiftProposalReview:{decision:'Use proposed shift'}});}
 else if(marker==='malformed confirmation')f.put('attendance_shift_confirmations/'+f.attendanceId,{emergencyShiftConfirmed:true,status:'Confirmed'});
 else if(marker==='different punch fingerprint')f.confirmHead().sourceFingerprint='changed';
 else{f.confirmHead();const read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const snap=await read(ref);if(ref.path==='attendance_shift_confirmations/'+f.attendanceId)snap.metadata=marker==='cached confirmation'?{fromCache:true}:{hasPendingWrites:true};return snap;};}
 f.before=structuredClone([...f.docs]);await f.open();assert.equal(f.api.lateRequestContext.proposalHoursReviewed,false);assert.equal(f.button().disabled,true);
 assert.doesNotMatch(f.calculation().innerHTML,/exempted from the late deduction/);if(marker!=='unprotected log flags')assert.ok(f.api.lateRequestContext.proposalReferenceError);unchanged(f);
});

test('a changed saved proposal is held even when a valid independent confirmation exists',async()=>{
 const f=await fixture();f.confirmHead();f.get('staff_requests/'+f.requestId).staffShiftProposal.expectedStartAt='2026-11-04T03:00:00.000Z';f.before=structuredClone([...f.docs]);
 await f.open();assert.equal(f.api.lateRequestContext.proposalHoursReviewed,false);assert.ok(f.api.lateRequestContext.proposalReferenceError);assert.equal(f.button().disabled,true);unchanged(f);
});

test('account replacement during fresh confirmation inspection cannot leave a usable approval modal',async()=>{
 const f=await fixture();f.confirmHead();f.before=structuredClone([...f.docs]);const read=f.api.getDocFromServer;
 f.api.getDocFromServer=async ref=>{const snap=await read(ref);if(ref.path==='attendance_shift_confirmations/'+f.attendanceId)f.api.auth.currentUser={...f.api.auth.currentUser};return snap;};
 await f.open();assert.equal(f.document.getElementById('dynamicReplyModal'),null);assert.match(f.warnings[0][1],/account changed/);unchanged(f);
});

test('a confirmed dated zero keeps its dedicated close-letter path instead of entering the ordinary exemption path',async()=>{
 const f=await amendmentFixture();await confirmAttendanceAmendmentReview(f.api,f.input());
 const log=f.withId(),row={id:'sample-letter',type:'Reason Letter',status:'Pending',staffId:f.staffId,staffName:f.name,branch:f.branch,attendanceLogId:f.attendanceId,timestamp:log.timestamp,lateMinutes:59,explanationCause:'Tardiness / Late Arrival',explanationMessage:'Clocked in 59 minutes late. Reason: Check the original plotted shift.'};
 const choice=savedShiftChoices(f.history,{start:log,staffId:f.staffId,staffName:f.name})[0];row.staffShiftProposal=makeSavedShiftProposal(f.history,{start:log,staffId:f.staffId,staffName:f.name},choice);
 const ui=install(f.api);ui.document.body.insertAdjacentHTML('beforeend','<select id="replyAttendanceLog"><option value="sample-in">Original Time In</option></select><select id="replyStaffShiftDecision"><option value="">Review first</option></select><textarea id="replyMessage"></textarea><div id="replyLateCalculation"></div><button id="btnSubmitReply"></button>');
 f.api.lateRequestContext={request:row,action:'Approved',logs:[log],profile:{...f.profile,staffId:f.staffId},schedule:f.history,proposalHoursReviewed:false};const before=structuredClone([...f.docs]);
 f.api.updateLateRequestPreview();assert.equal(ui.button().disabled,false);assert.equal(ui.button().innerText,'Close reviewed zero-lateness letter');assert.equal(f.api.lateRequestContext.selectedLatePreview.corrected,true);assert.equal(f.api.lateRequestContext.selectedLatePreview.zero,true);
 assert.equal(f.api.lateRequestContext.selectedLatePreview.fingerprint,lateRequestResolutionFingerprint(row,log,f.shift()));assert.doesNotMatch(ui.calculation().innerHTML,/exempted from the late deduction/);assert.deepEqual([...f.docs],before);
});

test('a letter without a proposed shift retains its original ordinary review behavior',async()=>{
 const f=await fixture({proposal:false});await f.open();assert.equal(f.button().disabled,false);assert.equal(f.document.getElementById('replyStaffShiftDecision'),null);
 assert.match(f.calculation().innerHTML,/65 minutes reported — exempted/);assert.equal(f.reads.some(path=>path.startsWith('attendance_shift_confirmations/')),false);unchanged(f);
});
