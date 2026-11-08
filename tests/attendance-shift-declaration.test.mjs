import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assembleScheduleHistory,createScheduleRevision} from '../takodeal-staff/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift} from '../takodeal-staff/payroll-safety.js';
import {clockInCoworkers,clockInSwapChoices,makeClockInScheduleDeclaration,revalidateClockInScheduleDeclaration,clockInDeclarationIdentity,clockInDeclarationSavedProposal,clockInDeclarationRequest} from '../takodeal-staff/attendance-shift-declaration.js';
import {chooseClockInSchedule} from '../takodeal-staff/attendance-shift-declaration-ui.js';
import {inspectScheduleDeclaration,scheduleDeclarationSourceFingerprint} from '../takodeal-manager/attendance-swap-declaration.js';
const at=new Date('2026-11-08T09:15:00+08:00'),staffId='crew-a',staffName='Synthetic Crew A',branch='Maa';
const profile={id:staffId,cashierName:staffName,name:'Crew A',branch};
function fixture(){
  const rule={id:'m1',name:'Morning',startTime:'09:00',endTime:'18:00',active:true};
  const plan={currentYear:2026,currentMonth:11,employees:[{staffId,...profile},{staffId:'crew-b',cashierName:'Synthetic Crew B',name:'Crew B',branch:'Maa'},
    {staffId:'crew-c',cashierName:'Synthetic Crew C',name:'Crew C',branch:'Citygate'},{staffId:'crew-d',cashierName:'Synthetic Crew D',name:'Crew D',branch:'Maa'}],
    branchConfig:{Maa:[rule,{...rule,id:'m2',name:'Later morning',startTime:'10:00',endTime:'18:30'}],Citygate:[rule]},
    currentSchedule:{8:{Maa:{scheduled:{m1:'Crew A',m2:'Crew B'},rest:['Crew D']},Citygate:{scheduled:{m1:'Crew C'}}}},unavailability:{},holidays:{}};
  const revision=createScheduleRevision(plan,{revisionId:'saved-nov',effectiveFrom:'2026-11-08',savedAt:new Date('2026-11-08T06:00:00+08:00')});
  const history=assembleScheduleHistory(plan,[{month:'2026-11',revisions:[revision],latestRevisionId:revision.revisionId}]);
  const input={at,staffId,staffName,branch,profile,snapshot:captureAttendanceSchedule(at,branch,staffName,history,{[staffName]:profile})};
  return{plan,revision,history,input};
}
const reason='Crew B agreed that I cover the saved later morning shift; please confirm with HQ.';
test('published stable-ID directory includes other branches, puts home branch first, and excludes self',()=>{
  const {history,input}=fixture();assert.deepEqual(clockInCoworkers(history,input).map(row=>row.staffId),['crew-b','crew-d','crew-c']);
  const choices=clockInSwapChoices(history,input);assert.deepEqual(choices.map(row=>[row.coworkerStaffId,row.targetBranch,row.targetShiftId]),[['crew-b','Maa','m2'],['crew-c','Citygate','m1']]);
});
test('inactive, duplicate-ID, ambiguous-name and unlinked roster identities never become selectable dated shifts',()=>{
  for(const mutate of [row=>row.active=false,row=>row.status='Resigned',row=>row.scheduleEligible=false,row=>{delete row.staffId;}]){
    const {history,input}=fixture();mutate(history.employees[1]);assert.equal(clockInSwapChoices(history,input).some(row=>row.coworkerStaffId==='crew-b'),false);
  }
  for(const duplicate of [{staffId:'crew-b',cashierName:'Other label',name:'Crew B',branch:'Maa'},{staffId:'other-account',cashierName:'Synthetic Crew B',name:'Crew B',branch:'Citygate'}]){
    const {history,input}=fixture();history.employees.push(duplicate);assert.equal(clockInSwapChoices(history,input).some(row=>row.coworkerStaffId==='crew-b'),false);
  }
  const {history,input}=fixture();history.historyMonths['2026-11'].revisions[0].snapshot.employees[1].staffId='foreign-account';assert.equal(clockInSwapChoices(history,input).some(row=>row.coworkerStaffId==='crew-b'),false);
});
test('a saved old alias may bind only to its exact still-active current account',()=>{
  const {history,input}=fixture();history.employees[1].name='New short name';assert.equal(clockInSwapChoices(history,input)[0].coworkerStaffId,'crew-b');
  history.employees.push({staffId:'another-crew',name:'Crew B',cashierName:'Other current owner',branch:'Maa'});assert.equal(clockInSwapChoices(history,input).some(row=>row.coworkerStaffId==='crew-b'),false);
});
test('inactive/day-disabled/duplicate/zero-hour/overlong shifts and unavailable coworkers are excluded',()=>{
  for(const mutate of [saved=>saved.branchConfig.Maa[1].active=false,saved=>saved.branchConfig.Maa[1].days=[1],saved=>saved.branchConfig.Maa.push({...saved.branchConfig.Maa[1]}),
    saved=>saved.branchConfig.Maa[1].endTime='10:00',saved=>saved.branchConfig.Maa[1].endTime='09:00',saved=>saved.currentSchedule[8].Maa.unavailable=[{name:'Crew B',status:'Leave'}],
    saved=>saved.unavailability['2026-11-08']=[{staffId:'crew-b'}]]){
    const {history,input}=fixture();mutate(history.historyMonths['2026-11'].revisions[0].snapshot);
    const revision=history.historyMonths['2026-11'].revisions[0];if(revision.snapshot.currentSchedule[8].Maa.unavailable)revision.daySnapshots['2026-11-08'].daySchedule.Maa.unavailable=revision.snapshot.currentSchedule[8].Maa.unavailable;
    assert.equal(clockInSwapChoices(history,input).some(row=>row.coworkerStaffId==='crew-b'),false);
  }
});
test('a declaration retains the original assigned lateness and cannot itself change the roster/payroll resolver',()=>{
  const {history,input}=fixture(),before=structuredClone({history,input}),selection=clockInSwapChoices(history,input)[0];
  const declaration=makeClockInScheduleDeclaration(history,input,selection,reason);
  assert.equal(declaration.referenceOnly,true);assert.equal(declaration.kind,'unrequested-swap');assert.equal(input.snapshot.lateMinutes,15);
  assert.equal(declaration.targetStartAt,'2026-11-08T02:00:00.000Z');assert.deepEqual({history,input},before);
  const resolved=resolveAttendanceShift({staffName,staffId,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:input.snapshot,scheduleDeclaration:declaration},history,{[staffName]:profile});
  assert.equal(resolved.lateMinutes,15);assert.equal(resolved.shiftId,'m1');
  assert.deepEqual(revalidateClockInScheduleDeclaration(history,{...input,at:new Date(+at+60000)},declaration),declaration);
});
test('fresh coworker, dated slot, original assignment, branch and account changes reject stale declarations',()=>{
  for(const mutate of [f=>f.history.employees[1].active=false,f=>f.history.employees[1].branch='Other home',f=>f.history.historyMonths['2026-11'].revisions[0].snapshot.branchConfig.Maa[1].startTime='10:15',
    f=>f.input.snapshot={...f.input.snapshot,scheduleRevisionId:'new-roster'},f=>f.input.branch='Citygate',f=>f.input.staffId='other-id']){
    const f=fixture(),declaration=makeClockInScheduleDeclaration(f.history,f.input,clockInSwapChoices(f.history,f.input)[0],reason);mutate(f);
    assert.throws(()=>revalidateClockInScheduleDeclaration(f.history,f.input,declaration),/changed|Review|Refresh/);
  }
});
test('previous-night and next-day choices use exact Philippine work dates without inventing absent month history',()=>{
  const f=fixture();f.history.historyMonths['2026-11'].revisions[0].snapshot.branchConfig.Citygate[0]={id:'m1',name:'Night',startTime:'18:30',endTime:'03:00'};
  const nightInput={...f.input,at:new Date('2026-11-09T00:10:00+08:00')};const row=clockInSwapChoices(f.history,nightInput).find(row=>row.coworkerStaffId==='crew-c');
  assert.equal(row.workDate,'2026-11-08');assert.equal(row.targetEndAt,'2026-11-08T19:00:00.000Z');
  assert.equal(clockInSwapChoices(f.history,{...f.input,at:new Date('2026-12-01T00:10:00+08:00')}).length,0);
});
test('same-branch proposal is a separate existing reference; cross-branch declaration cannot manufacture one',()=>{
  const {history,input}=fixture(),choices=clockInSwapChoices(history,input),ctx={start:{id:'original-in',staffId,staffName,branch,type:'TIME IN',timestamp:at},staffId,staffName};
  const same=makeClockInScheduleDeclaration(history,input,choices[0],reason),cross=makeClockInScheduleDeclaration(history,input,choices[1],reason);
  const proposal=clockInDeclarationSavedProposal(history,ctx,same);assert.equal(proposal.referenceOnly,true);assert.equal(proposal.shiftId,'m2');assert.equal(proposal.timeInLogId,'original-in');
  assert.equal(clockInDeclarationSavedProposal(history,ctx,cross),null);
});
test('one combined late request preserves its proof/reason, and a nonlate declaration stays outside financial reason letters',()=>{
  const {history,input}=fixture(),declaration=makeClockInScheduleDeclaration(history,input,clockInSwapChoices(history,input)[0],reason),timestamp=new Date(at);
  const lateRequest={type:'Reason Letter',proofImageUrl:'https://example.invalid/proof',explanationMessage:'Clocked in 15 minutes late. Bus delay.',staffShiftProposal:{referenceOnly:true}};
  const combined=clockInDeclarationRequest({declaration,attendanceLogId:'saved-in',lateRequest,lateMinutes:15,timestamp});assert.equal(combined.type,'Reason Letter');assert.match(combined.explanationCause,/Tardiness \/ Late Arrival/);assert.equal(combined.proofImageUrl,lateRequest.proofImageUrl);assert.equal(combined.lateMinutes,15);assert.equal(combined.status,'Pending');
  const normal=clockInDeclarationRequest({declaration,attendanceLogId:'saved-in',lateMinutes:2,timestamp});assert.equal(normal.type,'Schedule Declaration');assert.equal(normal.status,'Pending');assert.equal(normal.staffShiftProposal,undefined);assert.equal(normal.proofImageUrl,undefined);assert.equal(normal.scheduleDeclaration,declaration);
  assert.equal(clockInDeclarationIdentity({b:2,a:1}),clockInDeclarationIdentity({a:1,b:2}));
});
test('real generated alias-linked declarations, including an unknown home branch, bind to the Owner exact-source review',()=>{
  for(const blankHome of [false,true]){
    const {history,input}=fixture();if(blankHome)history.employees[1].branch='';
    const declaration=makeClockInScheduleDeclaration(history,input,clockInSwapChoices(history,input)[0],reason);
    assert.notEqual(declaration.targetAssignedName,declaration.coworkerName);
    const request={...clockInDeclarationRequest({declaration,attendanceLogId:'declaration-in',lateMinutes:2,timestamp:at}),id:'declaration-request'};
    const attendance={id:'declaration-in',staffId,staffName,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:input.snapshot,scheduleDeclaration:structuredClone(declaration),scheduleDeclarationRequestId:request.id};
    assert.deepEqual(inspectScheduleDeclaration(request,attendance),declaration);assert.ok(scheduleDeclarationSourceFingerprint(request,attendance));
    attendance.scheduleDeclaration.explanation='A different saved statement';assert.throws(()=>inspectScheduleDeclaration(request,attendance),/original linked Time In/);
  }
});
test('both apps ship byte-identical declaration model and UI without new private-profile query code',()=>{
  for(const file of ['attendance-shift-declaration.js','attendance-shift-declaration-ui.js'])assert.equal(readFileSync(new URL('../takodeal-staff/'+file,import.meta.url),'utf8'),readFileSync(new URL('../Takodeal-POS/'+file,import.meta.url),'utf8'));
  const model=readFileSync(new URL('../takodeal-staff/attendance-shift-declaration.js',import.meta.url),'utf8');assert.doesNotMatch(model,/getDocs|cashiers|salary|hourlyRate/);
});
function promptHarness(f,{mode='assigned',cancel=false,choiceIndex=0}={}){
  const nodes=new Map(),alerts=[],node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},disabled:false,textContent:'',innerHTML:''});return nodes.get(id);};
  const document={getElementById:node},Swal={async fire(options){alerts.push(options);if(options.input==='radio')return {isConfirmed:!cancel,value:mode};
    if(options.title==='Declare an unrequested shift swap'){
      options.didOpen();const choice=clockInSwapChoices(f.history,f.input)[choiceIndex];node('attendanceSwapCoworker').value=choice.coworkerStaffId;node('attendanceSwapCoworker').onchange();node('attendanceSwapShift').value=choice.key;node('attendanceSwapExplanation').value=reason;
      const value=options.preConfirm();return {isConfirmed:!!value,value};
    }return {isConfirmed:false};},showValidationMessage:message=>alerts.push({message})};
  return{nodes,node,alerts,document,Swal};
}
test('assigned/approved-swap path creates no declaration and cancel stops before any further choice',async()=>{
  for(const cancel of [false,true]){const f=fixture(),ui=promptHarness(f,{cancel}),result=await chooseClockInSchedule({...ui,...f.input,history:f.history});assert.equal(result.proceed,!cancel);assert.equal(result.declaration,null);assert.equal(ui.alerts.length,1);assert.match(ui.alerts[0].html,/already approved swap/);}
});
test('actual declaration modal requires exact coworker+dated slot and names cross-branch evidence honestly',async()=>{
  const f=fixture(),ui=promptHarness(f,{mode:'swap',choiceIndex:1}),result=await chooseClockInSchedule({...ui,...f.input,history:f.history});
  assert.equal(result.proceed,true);assert.equal(result.declaration.targetBranch,'Citygate');assert.equal(result.declaration.attendanceBranch,'Maa');assert.equal(result.declaration.referenceOnly,true);
  assert.match(ui.alerts[1].html,/does not approve a swap/);assert.match(ui.node('attendanceSwapShift').innerHTML,/Citygate/);assert.match(ui.node('attendanceSwapShift').innerHTML,/Nov 8/);
  ui.node('attendanceSwapShift').value='forged';assert.equal(ui.alerts[1].preConfirm(),false);assert.match(ui.alerts.at(-1).message,/Choose a coworker/);
});
test('changing account while the prompt is open aborts rather than attributing a declaration to the next user',async()=>{
  const f=fixture(),ui=promptHarness(f);let checks=0;await assert.rejects(chooseClockInSchedule({...ui,...f.input,history:f.history,assertCurrent:()=>{if(++checks>1)throw Error('Account changed');}}),/Account changed/);
});
