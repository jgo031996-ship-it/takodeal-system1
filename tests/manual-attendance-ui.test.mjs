import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateManualAttendance,saveManualAttendance} from '../takodeal-manager/attendance-audit.js';
import {prepareManualTimeOut} from '../takodeal-manager/manual-attendance-review.js';
import {captureAttendanceSchedule,resolveAttendanceShift,earnedNightBonus} from '../takodeal-manager/payroll-safety.js';
import {scheduleDateKey,createScheduleRevision,assembleScheduleHistory} from '../takodeal-manager/schedule-history.js';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const start=source.indexOf('window.openManualAttendanceModal ='),end=source.indexOf('window.otCache =',start);
function harness({allowed=true,branchAllowed=true,confirmed=true,fail=false,history={},profile={},attendance=[],timeOutClient}={}){
 const nodes=new Map(),messages=[],records=new Map();let confirmations=0,writes=0,refreshes=0;
 const values={manAttStaff:'Sample Staff',manAttBranch:'Maa',manAttType:'TIME IN',manAttDateTime:'2026-10-06T09:00',manAttRemarks:'Verified missing punch'};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:values[id]||'',style:{}});return nodes.get(id);};
 node('manualAttendanceModal').style.display='flex';
 const person={cashierName:'Sample Staff',branch:'Maa',...profile},staffSnapshot=()=>({docs:[{id:'sample-staff',data:()=>person}],forEach:fn=>fn({id:'sample-staff',data:()=>person})});
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-06T12:00:00+08:00']));}}
 const api={db:{},auth:{currentUser:{uid:'sample-owner',email:'owner@example.test'}},sessionUser:{cashierName:'Sample Owner'},
  isBranchAllowed:()=>branchAllowed,ManagerUI:{notify:value=>messages.push(value)},getDocsFromServer:async()=>staffSnapshot(),
  collection:(_,name)=>name,query:ref=>ref,where:()=>null,doc:(_,name,id)=>name+'/'+id,serverTimestamp:()=>new Date('2026-10-06T04:00:00Z'),
  runTransaction:async(_,fn)=>{const staged=new Map();const result=await fn({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),set:(ref,data)=>staged.set(ref,data)});if(fail)throw Error('offline');for(const entry of staged){records.set(...entry);writes++;}return result;},
  loadPayrollScheduleHistory:async()=>history,loadAttendanceLogs:()=>refreshes++,refreshPayrollAfterAttendanceCorrection:async options=>{options.assertCurrent();refreshes++;},invalidateCache(){}};
 let uuid=122;
 const context={activeStaffProfile,window:api,document:{getElementById:node},Date:FixedDate,crypto:{randomUUID:()=> 'sample-operation-'+(++uuid)},
  canOpenWorkspacePage:()=>allowed,validateManualAttendance:(input,options)=>validateManualAttendance(input,{...options,now:new FixedDate()}),saveManualAttendance:(api,payload,options)=>saveManualAttendance(api,payload,{...options,now:new FixedDate()}),
  scheduleDateKey,captureAttendanceSchedule,attendanceMillis:value=>value instanceof Date?+value:new Date(value).getTime(),
  prepareManualTimeOut:(api,payload,options)=>prepareManualTimeOut(api,payload,{...options,readAttendance:async()=>attendance,client:timeOutClient}),
  escapeHtml:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  Swal:{fire:async()=>{confirmations++;return{isConfirmed:confirmed};}},console:{error(){}}};
 vm.runInNewContext(source.slice(start,end),context);return{api,nodes,node,messages,records,person,staffSnapshot,writes:()=>writes,confirmations:()=>confirmations,refreshes:()=>refreshes};
}
test('the actual Owner handler cannot save without attendance permission or branch access',async()=>{
 for(const options of [{allowed:false},{branchAllowed:false}]){const h=harness(options);await h.api.submitManualAttendance();assert.equal(h.writes(),0);assert.equal(h.confirmations(),0);assert.equal(h.node('btnSaveManualAtt').disabled,false);}
});
test('cancelling the actual confirmation leaves every attendance record unchanged',async()=>{
 const h=harness({confirmed:false});await h.api.submitManualAttendance();assert.equal(h.confirmations(),1);assert.equal(h.writes(),0);assert.equal(h.refreshes(),0);
});
test('repeated taps in the actual handler confirm once and save one attributed correction',async()=>{
 const h=harness();await Promise.all([h.api.submitManualAttendance(),h.api.submitManualAttendance()]);assert.equal(h.confirmations(),1);assert.equal(h.writes(),1);assert.equal(h.records.size,1);
 const [row]=h.records.values();assert.equal(row.actorEmail,'owner@example.test');assert.equal(row.loggedBy,'owner@example.test');assert.equal(row.staffId,'sample-staff');assert.equal(row.source,'manager-correction');assert.equal(h.node('manualAttendanceModal').style.display,'none');
});
test('recorded corrections retain the same operation reference on acknowledgement retry',async()=>{
 const h=harness();await h.api.submitManualAttendance();await h.api.submitManualAttendance();assert.equal(h.records.size,1);assert.equal(h.writes(),1);assert.equal(h.api.manualAttendanceOperationId,'sample-operation-123');
});

function midHistory(){
 const data={currentYear:2026,currentMonth:10,employees:[{id:'sample-staff',name:'Sample Staff',nickname:'SAMPLE'}],branchConfig:{Maa:[{id:'mid',name:'Saved Mid',shiftType:'mid',startTime:'16:00',endTime:'00:30',active:true,days:[0,1,2,3,4,5,6]}]},currentSchedule:{4:{Maa:{scheduled:{mid:'SAMPLE'}}}}};
 const revision=createScheduleRevision(data,{revisionId:'sample-mid-revision',effectiveFrom:'2026-10-01',savedAt:new Date('2026-10-01T00:00:00+08:00')});
 return assembleScheduleHistory(data,[{month:'2026-10',revisions:[revision]}]);
}
test('actual manual Time In retains the document ID and exact archived Mid reference instead of creating a false alias identity conflict',async()=>{
 const history=midHistory(),profile={scheduleNickname:'SAMPLE',nightDiffRate:50},h=harness({history,profile});h.node('manAttDateTime').value='2026-10-04T15:42';
 const missingId=captureAttendanceSchedule(new Date('2026-10-04T15:42:00+08:00'),'Maa','Sample Staff',history,{'Sample Staff':h.person});assert.equal(missingId.scheduleReviewReason,'dated-staff-identity-conflict');
 await h.api.submitManualAttendance();assert.equal(h.writes(),1);const [saved]=h.records.values();assert.equal(saved.staffId,'sample-staff');assert.equal(saved.scheduleSnapshot.needsScheduleReview,false);assert.equal(saved.scheduleSnapshot.wasScheduled,true);assert.equal(saved.scheduleSnapshot.shiftType,'mid');assert.equal(saved.scheduleSnapshot.expectedEndAt,'2026-10-04T16:30:00.000Z');
 const person={...h.person,id:'sample-staff',staffId:'sample-staff'},shift=resolveAttendanceShift(saved,history,{'Sample Staff':person});assert.equal(earnedNightBonus(person,shift,new Date('2026-10-05T00:44:00+08:00'),saved.timestamp),50);assert.equal(earnedNightBonus({...person,nightDiffRate:0},shift,new Date('2026-10-05T00:44:00+08:00'),saved.timestamp),0);assert.equal(h.refreshes(),1);
});
test('manual Time In without a dated archive records the real punch but cannot infer a payable shift from the current schedule',async()=>{
 const history={...midHistory(),historyMonths:{}},h=harness({history,profile:{scheduleNickname:'SAMPLE'}});h.node('manAttDateTime').value='2026-10-04T15:42';await h.api.submitManualAttendance();const [saved]=h.records.values();assert.equal(saved.scheduleSnapshot.needsScheduleReview,true);assert.equal(saved.scheduleSnapshot.wasScheduled,false);assert.equal(saved.scheduleSnapshot.expectedEndAt,'');assert.equal(saved.timestamp.toISOString(),'2026-10-04T07:42:00.000Z');
});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
test('editing the actual form while staff is loading preserves the new draft and prevents a stale confirmation or write',async()=>{
 const h=harness(),gate=deferred();h.api.getDocsFromServer=()=>gate.promise;const saving=h.api.submitManualAttendance();h.node('manAttRemarks').value='A newer verified correction draft';gate.resolve(h.staffSnapshot());await saving;assert.equal(h.writes(),0);assert.equal(h.confirmations(),0);assert.equal(h.node('manAttRemarks').value,'A newer verified correction draft');assert.match(h.messages[0],/details changed/);
});
test('a different account suppresses a late manual result without writing or notifying the new account',async()=>{
 const h=harness(),gate=deferred();h.api.getDocsFromServer=()=>gate.promise;const saving=h.api.submitManualAttendance();h.api.auth.currentUser={uid:'another-owner',email:'another@example.test'};gate.resolve(h.staffSnapshot());await saving;assert.equal(h.writes(),0);assert.equal(h.messages.length,0);assert.equal(h.refreshes(),0);
});
test('an acknowledged save keeps edits made while the commit was returning and refreshes payroll without a second attendance write',async()=>{
 const h=harness(),committed=deferred(),release=deferred(),run=h.api.runTransaction;h.api.runTransaction=async(...args)=>{const result=await run(...args);committed.resolve();await release.promise;return result;};const saving=h.api.submitManualAttendance();await committed.promise;h.node('manAttRemarks').value='Newer unsaved attendance correction';release.resolve();await saving;assert.equal(h.writes(),1);assert.equal(h.node('manualAttendanceModal').style.display,'flex');assert.equal(h.node('manAttRemarks').value,'Newer unsaved attendance correction');assert.equal([...h.records.values()][0].remarks,'Verified missing punch');assert.equal(h.refreshes(),1);assert.match(h.messages[0],/newer form entries were kept/);
});
test('a payroll refresh failure after the manual commit reports the saved correction accurately and never retries the write',async()=>{
 const h=harness();h.api.refreshPayrollAfterAttendanceCorrection=async()=>{throw Error('Synthetic refresh failure');};await h.api.submitManualAttendance();assert.equal(h.writes(),1);assert.match(h.messages[0],/correction saved/);assert.match(h.messages[0],/refresh was not confirmed/);assert.doesNotMatch(h.messages[0],/correction was not saved/);await h.api.submitManualAttendance();assert.equal(h.writes(),1);
});
test('actual manual Time Out uses one formal confirmation and the existing exact-original service with the entered departure and reason',async()=>{
 const original={id:'sample-original-in',staffId:'sample-staff',staffName:'Sample Staff',branch:'Maa',type:'TIME IN',timestamp:new Date('2026-10-06T01:00:00+08:00')},requests=[];
 const client={inspect:async context=>({context,staffId:'sample-staff',branch:'Maa',timeInAt:original.timestamp.toISOString(),canSave:true,paidCutoffs:[],expectedFingerprint:'f'.repeat(64)}),save:async request=>{requests.push(request);return{saved:true};}};
 const h=harness({attendance:[original],timeOutClient:client});h.node('manAttType').value='TIME OUT';await h.api.submitManualAttendance();assert.equal(h.confirmations(),1);assert.equal(h.writes(),0);assert.equal(requests.length,1);assert.equal(requests[0].context.attendanceLogId,original.id);assert.equal(requests[0].dateTimeRaw,'2026-10-06T09:00:00');assert.equal(requests[0].reason,'Verified missing punch');assert.equal(h.refreshes(),1);
});
test('a stale staff-directory response cannot replace a reopened manual form or discard a newly entered draft',async()=>{
 const h=harness(),first=deferred(),second=deferred();let reads=0;h.api.getDocsFromServer=()=>++reads===1?first.promise:second.promise;
 const older=h.api.openManualAttendanceModal(),newer=h.api.openManualAttendanceModal();h.node('manAttRemarks').value='New form notes remain unsaved';h.node('manAttDateTime').value='2026-10-04T15:42';first.resolve(h.staffSnapshot());await older;assert.equal(h.node('manAttStaff').innerHTML,'<option value="">Loading Staff...</option>');
 second.resolve(h.staffSnapshot());await newer;assert.match(h.node('manAttStaff').innerHTML,/Sample Staff/);assert.equal(h.node('manAttRemarks').value,'New form notes remain unsaved');assert.equal(h.node('manAttDateTime').value,'2026-10-04T15:42');assert.equal(h.writes(),0);
});
test('closing manual attendance during a directory check keeps it closed and cannot populate a stale form',async()=>{
 const h=harness(),gate=deferred();h.api.getDocsFromServer=()=>gate.promise;const opening=h.api.openManualAttendanceModal();h.node('manualAttendanceModal').style.display='none';gate.resolve(h.staffSnapshot());await opening;assert.equal(h.node('manualAttendanceModal').style.display,'none');assert.equal(h.node('manAttStaff').innerHTML,'<option value="">Loading Staff...</option>');assert.equal(h.messages.length,0);
});
