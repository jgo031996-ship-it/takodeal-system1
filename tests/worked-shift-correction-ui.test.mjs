import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createWorkedShiftCorrectionService} from '../takodeal-manager/worked-shift-correction-service.js';
import {createScheduleHistoryStore,createScheduleRevision,resolveScheduleForDate} from '../takodeal-manager/schedule-history.js';
import {captureAttendanceSchedule,resolveAttendanceShift,payrollReliefHoursVerified} from '../takodeal-manager/payroll-safety.js';
import {ordinaryPayrollId} from '../takodeal-manager/payroll-settlement.js';
import {emergencyShiftSourceFingerprint} from '../takodeal-manager/emergency-shift-model.js';

const owner='jgo031996@gmail.com',branch='Fictional Branch',name='Fictional Crew',staffId='fictional-crew',metadata={fromCache:false,hasPendingWrites:false};
const at=(time,day=17)=>new Date('2026-10-'+String(day).padStart(2,'0')+'T'+time+':00+08:00');
const rule=(id,startTime,endTime,shiftType)=>({id,name:id,startTime,endTime,shiftType,active:true,days:[0,1,2,3,4,5,6]});
function fixture({rules=[rule('morning','09:00','17:30','morning'),rule('night','17:30','02:00','night')],extraDay={},missingHistory=false}={}){
 const h=firestoreHarness(),profile={cashierName:name,nickname:'CREW',branch,hourlyRate:450,nightDiffRate:50,active:true},snapshot={currentYear:2026,currentMonth:10,branchConfig:{[branch]:rules},employees:[{staffId,name,nickname:'CREW',branch}],currentSchedule:{17:{[branch]:{scheduled:{morning:'CREW',...Object.fromEntries(rules.filter(row=>row.id!=='morning').map(row=>[row.id,'UNFILLED']))},rest:[],unavailable:[],swaps:{morning:'Original colleague'},...extraDay}}},unavailability:{},holidays:{}};
 const revision=createScheduleRevision(snapshot,{revisionId:'original-october',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:at('00:00',1)}),history={...snapshot,historyMonths:{'2026-10':{month:'2026-10',revisions:[revision]}}};
 const start={id:'fictional-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:at('17:11'),lateMinutes:37,lateExempted:false,lateDecision:'Saved decision',scheduleSnapshot:captureAttendanceSchedule(at('17:11'),branch,name,history,{[name]:{...profile,staffId}})},out={id:'fictional-out',staffId,staffName:name,branch,type:'TIME OUT',timestamp:at('02:06',18),timeInLogId:start.id,timeInAt:start.timestamp};
 h.put('cashiers/'+staffId,profile);h.put('hq_managers/fictional-owner',{email:owner,cashierName:'Fictional Owner',role:'Owner',permissions:['all'],allowedBranches:['All'],pin:'3333',active:true});
 h.put('settings/global_schedule',{currentYear:2026,currentMonth:11,branchConfig:{[branch]:[rule('new-night','19:30','04:00','night')]},currentSchedule:{},scheduleRevisionId:'november-head',payrollHistoryEnforcedFrom:'2026-10-01'});h.put('settings/schedule_history_policy',{schemaVersion:1,payrollHistoryEnforcedFrom:'2026-10-01'});
 if(!missingHistory){h.put('settings/schedule_revision_original-october',revision);h.put('settings/schedule_month_2026_10',{schemaVersion:1,kind:'schedule-month',month:'2026-10',revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId,updatedAt:revision.savedAt,payrollHistoryEnforcedFrom:'2026-10-01'});}
 h.put('attendance_logs/'+start.id,start);h.put('attendance_logs/'+out.id,out);h.put('cash_accounts/fictional',{balance:5000});
 const calls={reads:[],writes:[],queries:[]},base=h.api,api={...base,crypto:webcrypto,auth:{currentUser:{uid:'fictional-owner',email:owner,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'fictional-owner',email:owner,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,limit:count=>({limit:count})};
 api.getDocFromServer=async reference=>{calls.reads.push(reference.path);const row=h.get(reference.path);return {id:reference.id,metadata,exists:()=>row!==undefined,data:()=>structuredClone(row)};};
 api.getDocsFromServer=async query=>{calls.queries.push(query);const result=await base.getDocsFromServer(query);return {metadata,docs:result.docs.map(row=>({...row,metadata}))};};
 api.runTransaction=(db,callback)=>base.runTransaction(db,tx=>callback({...tx,get:async reference=>({...await tx.get(reference),metadata}),set:(reference,value)=>{calls.writes.push(reference.path);tx.set(reference,value);}}));
 let counter=0;const service=createWorkedShiftCorrectionService(api,{crypto:webcrypto,now:()=>new Date('2026-11-05T12:00:00+08:00'),makeId:()=> 'operation-'+String(++counter),readAttendance:async()=>[...h.docs].filter(([path])=>path.startsWith('attendance_logs/')).map(([path,row])=>({...structuredClone(row),id:path.slice('attendance_logs/'.length)}))});
 const context={attendanceLogId:start.id,staffId,branch,from:'2026-10-16',to:'2026-10-31'};
 return {...h,api,service,context,profile,snapshot,revision,start,out,calls};
}
function enterHours(f,{date='2026-10-17',name='Night kitchen',kind='night',start='17:30',end='02:00'}={}){
 for(const [field,value] of Object.entries({date,name,kind,start,end})){
  const input=f.node('[data-manual-'+field+']');input.value=value;input.emit('input');
 }
}
const inspect=f=>f.service.inspect(f.context);
const apply=async f=>{const view=await inspect(f);return f.service.apply(f.service.propose(view));};
const revisions=f=>[...f.docs.keys()].filter(path=>path.startsWith('settings/schedule_revision_worked-'));

import {ReviewDocument,ReviewElement,drain,deferred} from './helpers/review-dom.mjs';
import {installWorkedShiftCorrectionUI,workedShiftActionHint} from '../takodeal-manager/worked-shift-correction-ui.js';
import {openPayslipWorkedShifts} from '../takodeal-manager/payslip-worked-shifts.js';
Object.defineProperty(ReviewElement.prototype,'style',{configurable:true,get(){return this._style ||= {};}});
ReviewElement.prototype.remove=function(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;};
function uiFixture(options={}){const f=fixture(options),document=new ReviewDocument(),messages=[],events=[],applied=[];Object.assign(f.api,{ManagerUI:{notify:message=>messages.push(message)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)});const ui=installWorkedShiftCorrectionUI(f.api,document,{service:f.service}),user=f.api.auth.currentUser,session=f.api.sessionUser;return {...f,ui,document,messages,events,applied,node:selector=>document.querySelector(selector),assertCurrent:()=>{if(f.api.auth.currentUser!==user||f.api.sessionUser!==session)throw Error('Fictional Owner account changed.');},onApplied:result=>applied.push(result)};}

test('a unique matching shift is suggested and saved only after confirmation',async()=>{const f=uiFixture(),before=structuredClone([...f.docs]);await f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied});assert.equal(revisions(f).length,0);await f.node('[data-apply]').onclick();const result=f.applied[0];assert.equal(result.workDate,'2026-10-17');assert.equal(result.alreadySaved,false);assert.equal(f.node('dialog'),null);assert.equal(f.applied.length,1);assert.equal(f.events.length,1);assert.equal(f.events[0].type,'worked-shift-corrected');assert.equal(f.events[0].detail.staffId,staffId);assert.equal(revisions(f).length,1);for(const [path,row]of before)if(path!=='settings/schedule_month_2026_10')assert.deepEqual(f.get(path),row,path);assert.match(f.messages.at(-1),/Worked shift confirmed/);});
test('ambiguous saved shifts open a compact exact-hour chooser and cannot write before an explicit choice',async()=>{const f=uiFixture({rules:[rule('morning','09:00','17:30','morning'),rule('night1','17:30','02:00','night'),rule('night2','17:30','02:00','night')]}),view=await f.service.inspect(f.context);await f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied});assert.equal(f.node('dialog').open,true);assert.equal(revisions(f).length,0);assert.equal(f.events.length,0);assert.match(f.node('dialog').textContent,/Recorded:/);assert.match(f.node('dialog').textContent,/night2/);assert.equal(f.node('[data-apply]').disabled,true);f.node('dialog').querySelectorAll('[data-choice]')[1].onchange();await f.node('[data-apply]').onclick();assert.equal(revisions(f).length,1);const saved=f.get('settings/schedule_revision_'+f.applied[0].revisionId);assert.equal(saved.snapshot.currentSchedule[17][branch].scheduled.night2,'CREW');assert.equal(saved.snapshot.currentSchedule[17][branch].scheduled.night1,'UNFILLED');assert.equal(f.node('dialog'),null);});
test('record ambiguity selects the exact dated Time In while still honoring another completed duty blocker',async()=>{const f=uiFixture();f.put('attendance_logs/earlier-in',{...f.start,id:'earlier-in',timestamp:at('09:00')});f.put('attendance_logs/earlier-out',{...f.out,id:'earlier-out',timestamp:at('15:00'),timeInLogId:'earlier-in',timeInAt:at('09:00')});await f.ui.open({staffId,branch,workDate:'2026-10-17'},{assertCurrent:f.assertCurrent,onApplied:f.onApplied});assert.ok(f.node('[data-record]'));assert.equal(revisions(f).length,0);f.node('[data-record]').value=f.start.id;await f.node('[data-apply]').onclick();assert.equal(revisions(f).length,0);assert.equal(f.applied.length,0);assert.equal(f.node('[data-apply]').disabled,true);assert.match(f.node('dialog').textContent,/5:11 PM/);assert.match(f.node('dialog').textContent,/Another completed duty exists/);});
test('a paid date is blocked in the actual service and the chooser cannot auto-apply or rewrite its snapshot',async()=>{const f=uiFixture(),paid={staffId,staffName:name,startDate:'2026-10-16',endDate:'2026-10-31',finalNetPay:450,frozenData:{basicPay:450,isPaid:true}};f.put('payroll_records/paid',paid);await f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied});assert.equal(f.node('[data-apply]').disabled,true);f.node('[data-apply]').click();await drain();assert.equal(revisions(f).length,0);assert.deepEqual(f.get('payroll_records/paid'),paid);assert.match(f.node('dialog').textContent,/paid payslip/);assert.equal(f.events.length,0);});
test('a rejected real commit reports the failure, leaves money untouched and permits the exact action to retry',async()=>{const f=uiFixture();f.failNextCommit();await f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied});await f.node('[data-apply]').onclick();assert.equal(revisions(f).length,0);assert.match(f.node('[data-status]').textContent,/Commit rejected/);await f.node('[data-apply]').onclick();assert.equal(revisions(f).length,1);assert.equal(f.get('cash_accounts/fictional').balance,5000);assert.equal(f.events.length,1);});
test('concurrent one-click calls share one physical inspection and application',async()=>{const f=uiFixture(),gate=deferred(),real=f.service.inspect;let reads=0;f.service.inspect=async context=>{reads++;await gate.promise;return real(context);};const first=f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied});assert.equal(await f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied}),false);assert.equal(reads,1);gate.resolve();await first;assert.equal(revisions(f).length,0);await f.node('[data-apply]').onclick();assert.equal(revisions(f).length,1);assert.equal(f.events.length,1);});
test('a changed Owner while source inspection is waiting cannot apply, refresh or emit a successful event',async()=>{
 const f=uiFixture(),gate=deferred(),inspected=deferred(),real=f.service.inspect,before=structuredClone([...f.docs]);
 f.service.inspect=async context=>{try{const view=await real(context);inspected.resolve();await gate.promise;return view;}catch(error){inspected.reject(error);throw error;}};
 const first=f.ui.open(f.context,{assertCurrent:f.assertCurrent,onApplied:f.onApplied});
 // Switch at the intended UI checkpoint, after the real service has finished
 // validating the original account. Timed draining can instead race its own
 // earlier scope guard, which correctly reports a different safe message.
 await inspected.promise;f.api.auth.currentUser={...f.api.auth.currentUser,uid:'different-owner'};gate.resolve();
 assert.equal(await first,false);assert.equal(revisions(f).length,0);assert.deepEqual(f.calls.writes,[]);assert.deepEqual([...f.docs],before);
 assert.equal(f.applied.length+f.events.length,0);assert.match(f.messages.at(-1),/account changed/);
});
test('a chooser closed without applying has no settings, payment or callback side effects',async()=>{const f=uiFixture({rules:[rule('morning','09:00','17:30','morning'),rule('night1','17:30','02:00','night'),rule('night2','17:30','02:00','night')]}),before=structuredClone([...f.docs]);await f.ui.open(f.context);f.node('[data-close]').click();assert.equal(f.node('dialog'),null);assert.deepEqual([...f.docs],before);assert.equal(f.applied.length+f.events.length,0);});
test('worked-shift hint is limited to the exact unpaid actual work record and suppresses frozen, missed and already-corrected rows',()=>{const f=uiFixture(),data={staffId,branch,start:f.context.from,end:f.context.to},log={attendanceLogId:f.start.id,branch,timeInAt:at('17:11').toISOString(),timeOutAt:at('02:06',18).toISOString(),expectedStartAt:at('09:00').toISOString(),expectedEndAt:at('17:30').toISOString(),out:'02:06 AM'};const hint=workedShiftActionHint(f.api,data,log);assert.equal(hint.label,'Apply worked shift');assert.deepEqual(hint.context,f.context);assert.equal(workedShiftActionHint(f.api,{...data,isPaid:true},log),null);assert.equal(workedShiftActionHint(f.api,data,{...log,out:'MISSED'}),null);assert.equal(workedShiftActionHint(f.api,data,{...log,workedShiftCorrectionId:'saved'}),null);f.api.paidPayrollSnapshots=new WeakSet([data]);assert.equal(workedShiftActionHint(f.api,data,log),null);});

test('manual hours stay in the open dialog through validation and a failed write, then save the overnight shift once',async()=>{
 const f=uiFixture({rules:[],missingHistory:true}),dialog=await f.ui.open({...f.context,allowManual:true},{onApplied:f.onApplied});
 const confirm=f.node('[data-apply]');
 enterHours(f,{start:'17:30',end:'17:30'});await confirm.onclick();
 assert.equal(f.node('dialog'),dialog);assert.match(f.node('[data-status]').textContent,/must be different/);
 enterHours(f);assert.equal(confirm.textContent,'Confirm assigned hours');assert.equal(confirm.hidden,false);
 f.failNextCommit();await confirm.onclick();assert.equal(f.node('dialog'),dialog);assert.equal(f.node('[data-manual-name]').value,'Night kitchen');
 assert.match(f.node('[data-status]').textContent,/Commit rejected/);
 await Promise.all([confirm.onclick(),confirm.onclick()]);assert.equal(f.node('dialog'),null);assert.equal(f.applied.length,1);assert.equal(revisions(f).length,1);
 const record=f.get(revisions(f)[0]).historicalWorkedShiftReview;
 assert.equal(record.expectedEndAt,at('02:00',18).toISOString());assert.equal(record.timeOutLogId,f.out.id);
});

test('one confirmation at the punched branch saves an availability exception and refreshes the open cutoff once',async()=>{
 const f=uiFixture({extraDay:{unavailable:['CREW']}}),date='2026-10-17';
 const roster=f.get('settings/schedule_revision_original-october').daySnapshots[date].daySchedule;
 roster.Citygate={scheduled:{mid:'CREW'},rest:[],unavailable:[]};
 for(const [id,value] of [['payrollStart',f.context.from],['payrollEnd',f.context.to]]){
  const field=f.document.createElement('input');field.setAttribute('id',id);field.value=value;f.document.body.append(field);
 }
 let reloads=0;f.api.refreshPayrollAfterAttendanceCorrection=async()=>{reloads++;assert.equal(revisions(f).length,1);};
 await f.ui.open(f.context,{onApplied:f.onApplied,refreshCutoff:true});
 enterHours(f,{name:'Mid',kind:'mid',start:'16:00',end:'00:30'});
 const status=f.node('[data-status]').textContent;
 assert.ok(status.includes(branch));assert.ok(status.includes('Citygate'));assert.ok(status.includes('unavailable'));
 const button=f.node('[data-apply]');await Promise.all([button.onclick(),button.onclick()]);
 assert.equal(reloads,1);assert.equal(f.applied.length,1);assert.equal(f.node('dialog'),null);
 const marker=f.get(revisions(f)[0]).historicalWorkedShiftReview;
 assert.equal(marker.branch,branch);assert.equal(marker.shiftType,'mid');assert.equal(marker.workDate,date);
});
test('the payslip saves two overnight duties through the real chooser and transaction before refreshing once',async()=>{
 const f=uiFixture({rules:[],missingHistory:true}),w=f.api,d=f.document;
 const nextIn={...f.start,id:'second-in',timestamp:at('17:14',19)},nextOut={...f.out,id:'second-out',timeInLogId:nextIn.id,timeInAt:nextIn.timestamp,timestamp:at('02:10',20)};
 f.put('attendance_logs/'+nextIn.id,nextIn);f.put('attendance_logs/'+nextOut.id,nextOut);
 const logs=[[f.start,f.out],[nextIn,nextOut]].map(([a,b])=>({attendanceLogId:a.id,branch,timeInAt:a.timestamp,timeOutAt:b.timestamp,bonusReviewRequired:true}));
 const data={name,staffId,start:f.context.from,end:f.context.to,logs},fresh={...data,logs:[]};
 let refreshes=0,opens=0,inspection;
 const chooser={open(...args){inspection=f.ui.open(...args);return inspection;}};
 const guard={invalidate(){w.currentPayslipData=null;w.globalPayrollCache={};},requireReady(){assert.equal(w.globalPayrollCache[name],fresh);}};
 Object.assign(w,{currentPayslipData:data,globalPayrollCache:{[name]:data},requirePayrollPreview:v=>assert.equal(v,w.currentPayslipData),getPayrollPreviewGuard:()=>guard,
  refreshPayrollAfterAttendanceCorrection:()=>assert.fail('early payroll refresh'),generateAutoPayslips:async()=>{refreshes++;w.globalPayrollCache={[name]:fresh};},openPayslipModal:async()=>{opens++;w.currentPayslipData=fresh;}});
 for(const [id,value] of [['payrollStart',data.start],['payrollEnd',data.end]]){const el=d.createElement('input');el.setAttribute('id',id);el.value=value;d.body.append(el);}
 const batch=openPayslipWorkedShifts(w,d,data,logs[0],chooser);
 const dates=batch.querySelector('[data-dates]').querySelectorAll('button');
 for(const [index,date] of ['2026-10-17','2026-10-19'].entries()){
  if(index)dates[index].click();
  const child=await inspection;assert.ok(child.open);enterHours(f,{date});
  await child.querySelector('[data-apply]').onclick();
  assert.equal(child.open,false,child.querySelector('[data-status]').textContent);
  assert.equal(dates[index].textContent,'Saved');assert.equal(refreshes,0);
 }
 const duties=revisions(f).map(path=>f.get(path).historicalWorkedShiftReview);
 assert.deepEqual(duties.map(row=>row.timeInLogId).sort(),[f.start.id,nextIn.id].sort());
 await batch.querySelector('[data-finish]').onclick();
 assert.equal(refreshes,1);assert.equal(opens,1);assert.equal(w.currentPayslipData,fresh);assert.equal(batch.open,false);
});
test('a renamed employee can explicitly update a conflicting prior approval; payroll uses the new assignment until a later approval',async()=>{
 const f=uiFixture(),profile={...f.profile,cashierName:'Current Crew Name',staffId};
 f.put('cashiers/'+staffId,profile);
 const head={schemaVersion:1,status:'Confirmed',revisionId:'original-hours-01',version:1,staffId,staffName:name,branch,timeInLogId:f.start.id,timeInAt:f.start.timestamp,expectedStartAt:at('09:00'),expectedEndAt:at('17:30'),workDate:'2026-10-17',shiftName:'Original duty',sourceFingerprint:emergencyShiftSourceFingerprint(f.start),reviewedByUid:'fictional-owner',reviewedByEmail:owner,reviewedAt:at('18:00')};
 f.put('attendance_shift_confirmations/'+f.start.id,head);
 const node=await f.ui.open({...f.context,allowManual:true},{onApplied:f.onApplied}),confirm=f.node('[data-apply]');
 assert.equal(f.node('[data-manual-start]').value,'09:00');enterHours(f);
 await confirm.onclick();assert.equal(f.node('dialog'),node);assert.equal(confirm.textContent,'Confirm updated hours');assert.equal(revisions(f).length,0);
 assert.match(f.node('[data-status]').textContent,/the next day/);await confirm.onclick();assert.equal(f.applied.length,1);
 const history=await createScheduleHistoryStore(f.api).loadRange(f.start.timestamp,f.out.timestamp);
 history.payrollShiftConfirmations={[f.start.id]:head};
 const resolve=()=>resolveAttendanceShift(f.start,history,{[profile.cashierName]:profile},profile.cashierName);
 const shift=resolve();assert.equal(+shift.expectedStartAt,+at('17:30'));assert.equal(shift.shiftType,'night');assert.equal(shift.lateMinutes,0);assert.equal(payrollReliefHoursVerified(shift,f.out),true);
 assert.deepEqual(f.get('attendance_shift_confirmations/'+f.start.id),head);assert.deepEqual(f.get('attendance_logs/'+f.start.id),f.start);
 history.payrollShiftConfirmations[f.start.id]={...head,version:2,revisionId:'later-hours-0002'};
 assert.equal(+resolve().expectedStartAt,+head.expectedStartAt);
});
test('a lost save acknowledgement retries the same overnight correction and reports a refresh failure as saved',async()=>{
 const f=uiFixture({missingHistory:true});
 const node=await f.ui.open({...f.context,allowManual:true},{onApplied:async()=>{throw Error('Refresh timed out');}});
 enterHours(f);f.loseNextAck();const confirm=f.node('[data-apply]');
 await confirm.onclick();assert.equal(revisions(f).length,1);assert.equal(f.node('dialog'),node);
 await confirm.onclick();assert.equal(revisions(f).length,1);assert.equal(f.node('dialog'),null);
 assert.equal(f.events.length,1);assert.match(f.messages.at(-1),/Hours saved.*Generate List/);
});

test('a new paid cutoff while the owner fills the form preserves the draft and prevents a write',async()=>{
 const f=uiFixture({missingHistory:true}),node=await f.ui.open({...f.context,allowManual:true},{onApplied:f.onApplied});
 enterHours(f);f.put('payroll_records/paid',{staffId,staffName:name,startDate:'2026-10-16',endDate:'2026-10-31',isPaid:true,frozenData:{basicPay:450}});
 await f.node('[data-apply]').onclick();assert.equal(f.node('dialog'),node);assert.equal(f.node('[data-manual-start]').value,'17:30');
 assert.match(f.node('[data-status]').textContent,/paid payslip/);assert.equal(revisions(f).length,0);assert.equal(f.applied.length,0);
});
test('a dated leave stays active until the Owner expressly confirms full work for that one date',async()=>{
 const f=uiFixture(),date='2026-10-17',leave={staffId,staffName:name,type:'Leave',status:'Approved',startDate:date,endDate:'2026-10-18'};
 f.put('staff_requests/qa-approved',leave);
 const open=async()=>{const dialog=await f.ui.open(f.context,{onApplied:f.onApplied});dialog.querySelectorAll('[data-choice]').at(-1).onchange();return dialog;};
 let dialog=await open();await f.node('[data-apply]').onclick();
 assert.match(f.node('[data-status]').textContent,/qa-approved/);
 assert.match(f.node('[data-status]').textContent,/partial leave/i);assert.equal(revisions(f).length,0);
 dialog.querySelector('[data-close]').click();assert.deepEqual(f.get('staff_requests/qa-approved'),leave);
 dialog=await open();const confirm=f.node('[data-apply]');await confirm.onclick();
 assert.match(confirm.textContent,/remove this leave date/i);await Promise.all([confirm.onclick(),confirm.onclick()]);
 assert.equal(revisions(f).length,1);assert.deepEqual(f.get('staff_requests/qa-approved').activeLeaveDates,['2026-10-18']);
 assert.equal(f.get('staff_requests/qa-approved').leaveActions.length,1);
});
