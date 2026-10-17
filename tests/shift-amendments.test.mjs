import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createScheduleRevision,createScheduleHistoryStore,resolveScheduleForDate,shiftAmendmentFingerprint} from '../takodeal-manager/schedule-history.js';
import {normalizeShiftAmendment,amendmentsForDate,applyShiftAmendments} from '../takodeal-manager/shift-amendments.js';
import {projectScheduleMonth} from '../takodeal-manager/schedule-sync.js';

const now=new Date('2026-06-18T04:00:00Z'),month='2026-06',branch='Sample Branch',other='Other Branch';
const actor={uid:'sample-owner',email:'owner@example.test'},copy=value=>structuredClone(value);
const indexPath='settings/schedule_month_2026_06',durablePath='settings/schedule_shift_amendments_2026_06',headPath='settings/global_schedule';
function snapshot(){
 const branchConfig={[branch]:[{id:'mid',name:'Mid counter (2pm-9:30pm)',startTime:'13:00',endTime:'20:30',active:true,days:[0,1,2,3,4,5,6]},{id:'night',name:'Night kitchen',startTime:'18:30',endTime:'03:00',active:true,days:[0,1,2,3,4,5,6]}],[other]:[{id:'morning',name:'Morning',startTime:'09:00',endTime:'17:30',active:true}]};
 const currentSchedule=Object.fromEntries(Array.from({length:30},(_,i)=>[i+1,{[branch]:{scheduled:{mid:'Sample Counter',night:'Sample Kitchen'},rest:['Sample Rest'],unavailable:[],swaps:{}},[other]:{scheduled:{morning:'Other Staff'},rest:[],unavailable:[],swaps:{}}}]));
 return {currentYear:2026,currentMonth:6,branchConfig,currentSchedule,employees:[{id:'counter',name:'Sample Counter',branch},{id:'kitchen',name:'Sample Kitchen',branch},{id:'other',name:'Other Staff',branch:other}],unavailability:{},holidays:{'2026-06-20':'Special'}};
}
function payload(extra={}){return {id:'correction-one',branch,effectiveFrom:'2026-06-17',effectiveTo:'2026-06-30',sourceRevisionId:'original',reason:'Correct the recorded start and end times.',changes:[{shiftId:'mid',beforeStart:'13:00',beforeEnd:'20:30',startTime:'14:00',endTime:'21:30'},{shiftId:'night',beforeStart:'18:30',beforeEnd:'03:00',startTime:'19:30',endTime:'04:00'}],...extra};}
function setup(){
 const h=firestoreHarness(),original=createScheduleRevision(snapshot(),{revisionId:'original',effectiveFrom:'2026-06-16',savedAt:'2026-06-16T01:00:00Z'});original.sequence=1;
 h.put('settings/schedule_revision_original',original);h.put(indexPath,{schemaVersion:1,kind:'schedule-month',month,revisionIds:['original'],latestRevisionId:'original',updatedAt:original.savedAt,payrollHistoryEnforcedFrom:'2026-06-16'});
 h.put(headPath,{...copy(original.snapshot),scheduleRevisionId:'original',scheduleEffectiveFrom:'2026-06-16',payrollHistoryEnforcedFrom:'2026-06-16'});h.put('settings/schedule_history_policy',{schemaVersion:1,payrollHistoryEnforcedFrom:'2026-06-16'});
 h.api.auth={currentUser:copy(actor)};h.api.sessionUser={...copy(actor),isOwner:true,isFranchisee:false,role:'Owner',permissions:['schedule'],allowedBranches:[branch,other]};
 h.api.getDocFromServer=async reference=>({exists:()=>h.docs.has(reference.path),data:()=>copy(h.get(reference.path))});
 let generated=0;const store=createScheduleHistoryStore(h.api,{now:()=>now,makeId:()=>`normal-${++generated}`});
 return {...h,store,original,async options(){const archive=await store.loadMonth(month);return {expectedRevisionId:archive.latestRevisionId,expectedHeadFingerprint:shiftAmendmentFingerprint(h.get(headPath)),expectedIndexFingerprint:archive.indexFingerprint,actor,authorize:()=>true};},async amend(input=payload()){return store.amendShiftTimes(input,await this.options());}};
}
const times=dated=>dated.branchConfig[branch].map(row=>[row.startTime,row.endTime]);

test('correction commits only four settings documents, preserves original evidence and publishes a coherent new head',async()=>{
 const h=setup(),before=copy([...h.docs]),result=await h.amend();
 assert.equal(result.latestRevisionId,'correction-one-current');assert.equal(result.alreadySaved,false);assert.equal(result.amendment.reconcileSavedAssignments,false);
 const changed=[...h.docs].filter(([path,value])=>JSON.stringify(value)!==JSON.stringify(new Map(before).get(path))).map(([path])=>path).sort();
 assert.deepEqual(changed,[headPath,indexPath,durablePath,'settings/schedule_revision_correction-one-current'].sort());
 assert.deepEqual(h.get('settings/schedule_revision_original'),h.original);assert.deepEqual(h.get(headPath).currentSchedule,h.original.snapshot.currentSchedule);assert.deepEqual(h.get(headPath).employees,h.original.snapshot.employees);assert.deepEqual(h.get(headPath).branchConfig[other],h.original.snapshot.branchConfig[other]);
 assert.deepEqual(times(h.get(headPath)),[['14:00','21:30'],['19:30','04:00']]);
 const current=h.get('settings/schedule_revision_correction-one-current');assert.deepEqual(current.snapshot.branchConfig,h.get(headPath).branchConfig);assert.equal(current.effectiveFrom,'2026-06-18');assert.equal(current.source,'owner-shift-time-amendment');
 assert.equal(result.amendment.sourceDates['2026-06-17'],'original');assert.equal(result.amendment.actor.uid,actor.uid);assert.equal(result.amendment.actor.email,actor.email);
});

test('dated reads overlay corrected times inclusively without changing earlier dates, assignments or raw archive access',async()=>{
 const h=setup();await h.amend();const history=await h.store.loadRange('2026-06-16','2026-06-30');
 assert.deepEqual(times(resolveScheduleForDate(history,'2026-06-16')),[['13:00','20:30'],['18:30','03:00']]);
 for(const date of ['2026-06-17','2026-06-18','2026-06-30']){const dated=resolveScheduleForDate(history,date);assert.deepEqual(times(dated),[['14:00','21:30'],['19:30','04:00']]);assert.equal(dated.scheduleAmendments[0].id,'correction-one');assert.equal(dated.currentSchedule[Number(date.slice(-2))][branch].scheduled.night,'Sample Kitchen');}
 assert.deepEqual(times(resolveScheduleForDate(history,'2026-06-17',{amendments:false})),[['13:00','20:30'],['18:30','03:00']]);assert.equal(resolveScheduleForDate(history,'2026-06-15'),null);
});

test('the month projection uses amended editor and dated snapshots, preserving other branches in the editor only',async()=>{
 const h=setup();await h.amend();const archive=await h.store.loadMonth(month),current=h.get(headPath),view=projectScheduleMonth({month,current,archive,now,branch,allowed:()=>true});
 assert.deepEqual(times(view.editorSnapshot),[['14:00','21:30'],['19:30','04:00']]);assert.equal(view.editorSnapshot.branchConfig[other][0].startTime,'09:00');assert.equal(view.snapshot.branchConfig[other],undefined);
 assert.equal(view.daySnapshots[16].branchConfig[branch][0].startTime,'13:00');assert.equal(view.daySnapshots[17].branchConfig[branch][0].startTime,'14:00');assert.equal(view.expectedRevisionId,'correction-one-current');assert.equal(view.archive.shiftAmendments.length,1);assert.equal(view.headFingerprint,shiftAmendmentFingerprint(current));
});

test('existing future plans and later normal rules take precedence, even if their times equal the original before values',async()=>{
 const h=setup(),future=snapshot();future.currentSchedule[21][branch].scheduled.mid='Planned Staff';const plan=await h.store.save(future,{revisionId:'planned',effectiveFrom:'2026-06-21',expectedRevisionId:'original'});assert.equal(plan.publishedCurrent,false);
 const input=payload({sourceRevisionId:'planned'}),result=await h.amend(input),history=await h.store.loadRange('2026-06-17','2026-06-30');
 assert.equal(result.amendment.sourceDates['2026-06-21'],undefined);assert.equal(resolveScheduleForDate(history,'2026-06-20').branchConfig[branch][0].startTime,'14:00');assert.equal(resolveScheduleForDate(history,'2026-06-21').branchConfig[branch][0].startTime,'13:00');assert.equal(h.get(headPath).currentSchedule[21][branch].scheduled.mid,'Planned Staff');
 await h.store.save(snapshot(),{revisionId:'later-normal',effectiveFrom:'2026-06-19',expectedRevisionId:result.latestRevisionId});const later=await h.store.loadRange('2026-06-17','2026-06-30');assert.equal(resolveScheduleForDate(later,'2026-06-19').branchConfig[branch][0].startTime,'13:00');assert.equal(resolveScheduleForDate(later,'2026-06-17').branchConfig[branch][0].startTime,'14:00');
});

test('a durable correction survives an old client stripping inline metadata and the next normal save restores it',async()=>{
 const h=setup();await h.amend();const durable=copy(h.get(durablePath)),old=copy(h.get(indexPath));delete old.shiftAmendments;h.put(indexPath,old);
 const history=await h.store.loadRange('2026-06-16','2026-06-30');assert.equal(resolveScheduleForDate(history,'2026-06-17').branchConfig[branch][0].startTime,'14:00');assert.equal(history.historyMonths[month].shiftAmendments.length,1);
 await h.store.save(h.get(headPath),{revisionId:'normal-after-old-client',expectedRevisionId:old.latestRevisionId});assert.deepEqual(h.get(indexPath).shiftAmendments,durable.shiftAmendments);assert.deepEqual(h.get(durablePath),durable);
 await assert.rejects(h.store.save(snapshot(),{effectiveFrom:'2026-06-17'}),/Past dates/);
});

test('durable and inline correction mismatches or malformed source history fail closed',async()=>{
 for(const corrupt of [h=>{h.get(indexPath).shiftAmendments[0].reason='Altered inline reason';},h=>{delete h.get(durablePath).shiftAmendments;},h=>{h.get(durablePath).month='2026-07';},h=>{h.docs.delete('settings/schedule_revision_original');},h=>{for(const path of [indexPath,durablePath])h.get(path).shiftAmendments[0].sourceDates['2026-06-17']='missing';},h=>{delete h.get('settings/schedule_revision_original').daySnapshots['2026-06-17'];}]){const h=setup();await h.amend();corrupt(h);await assert.rejects(h.store.loadMonth(month),/inconsistent|incomplete/);}
});

test('lost acknowledgement is retryable with the same immutable intent and does not duplicate a correction',async()=>{
 const h=setup(),options=await h.options(),input=payload({reconcileSavedAssignments:true});h.loseNextAck();await assert.rejects(h.store.amendShiftTimes(input,options),/lost after commit/);const saved=copy([...h.docs]);
 const result=await h.store.amendShiftTimes(input,options);assert.equal(result.alreadySaved,true);assert.equal(result.amendment.reconcileSavedAssignments,true);assert.deepEqual([...h.docs],saved);assert.equal(h.get(durablePath).shiftAmendments.length,1);
 await assert.rejects(h.store.amendShiftTimes({...input,reason:'A different saved reason'},options),/different details/);await assert.rejects(h.store.amendShiftTimes({...input,reconcileSavedAssignments:false},options),/different details/);
 h.docs.delete('settings/schedule_revision_correction-one-current');await assert.rejects(h.store.amendShiftTimes(input,options),/correction revision is incomplete/);
});

test('commit rejection leaves all originals, head and amendment documents unchanged',async()=>{
 const h=setup(),before=copy([...h.docs]);h.failNextCommit();await assert.rejects(h.amend(),/Commit rejected/);assert.deepEqual([...h.docs],before);
});

test('simultaneous stale previews cannot both overwrite a schedule, while same intent can safely deduplicate',async()=>{
 const h=setup(),options=await h.options(),results=await Promise.allSettled([h.store.amendShiftTimes(payload(),options),h.store.amendShiftTimes(payload({id:'correction-two'}),options)]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.match(results.find(row=>row.status==='rejected').reason.message,/changed after/);assert.equal(h.get(durablePath).shiftAmendments.length,1);assert.ok(h.retries()>0);
 const same=setup(),fresh=await same.options(),done=await Promise.all([same.store.amendShiftTimes(payload(),fresh),same.store.amendShiftTimes(payload(),fresh)]);assert.equal(done.filter(row=>row.alreadySaved).length,1);assert.equal(same.get(durablePath).shiftAmendments.length,1);
});

test('Owner identity, franchise aliases, permission revocation and account changes are guarded inside the transaction',async()=>{
 for(const change of [h=>{h.api.sessionUser.isOwner=false;},h=>{h.api.sessionUser.isFranchisee=true;},h=>{h.api.sessionUser.role='Franchise owner';},h=>{h.api.auth.currentUser.uid='other-owner';},h=>{h.api.auth.currentUser.email='other@example.test';},h=>{h.api.sessionUser.uid='other-owner';}]){const h=setup(),before=copy([...h.docs]),options=await h.options();change(h);await assert.rejects(h.store.amendShiftTimes(payload(),options),/signed-in Owner/);assert.deepEqual([...h.docs],before);}
 const h=setup(),options=await h.options(),txRun=h.api.runTransaction;h.api.runTransaction=async(...args)=>{h.api.sessionUser.permissions=[];return txRun(...args);};await assert.rejects(h.store.amendShiftTimes(payload(),options),/signed-in Owner/);
 const revoked=setup(),fresh=await revoked.options();await assert.rejects(revoked.store.amendShiftTimes(payload(),{...fresh,authorize:()=>false}),/signed-in Owner/);
});

test('fresh preview fingerprints, exact before times and complete dated evidence are mandatory',async()=>{
 for(const [modify,pattern] of [[h=>{h.get(headPath).holidays.extra='Changed';},/changed after/],[h=>{h.get(indexPath).updatedAt='Changed';},/changed after/],[h=>{h.get('settings/schedule_revision_original').daySnapshots['2026-06-17']=undefined;},/Dated schedule evidence/]]){const h=setup(),options=await h.options();modify(h);const before=copy([...h.docs]);await assert.rejects(h.store.amendShiftTimes(payload(),options),pattern);assert.deepEqual([...h.docs],before);}
 const h=setup(),options=await h.options();await assert.rejects(h.store.amendShiftTimes(payload(),{...options,expectedHeadFingerprint:undefined}),/fresh schedule/);await assert.rejects(h.store.amendShiftTimes(payload({sourceRevisionId:'missing-source'}),options),/source is incomplete/);
 const wrong=payload();wrong.changes[0].beforeStart='12:00';await assert.rejects(h.store.amendShiftTimes(wrong,options),/changed after/);
 const unarchived=setup();unarchived.get(headPath).branchConfig[branch][0].startTime='12:00';await assert.rejects(unarchived.amend(),/unarchived/);
});

test('invalid date scope, duplicate or unknown slots, invalid durations and no-op requests never write',async()=>{
 const cases=[payload({effectiveFrom:'2026-06-19'}),payload({effectiveTo:'2026-06-29'}),payload({effectiveFrom:'2026-05-17',effectiveTo:'2026-05-31'}),payload({effectiveFrom:'2026-06-31'}),payload({effectiveTo:'2026-07-01'}),payload({reconcileSavedAssignments:'yes'})];
 const duplicate=payload();duplicate.changes.push(copy(duplicate.changes[0]));cases.push(duplicate);const unknown=payload();unknown.changes[0].shiftId='missing';cases.push(unknown);const duration=payload();duration.changes[0].endTime='14:00';cases.push(duration);const noOp=payload();noOp.changes=noOp.changes.map(row=>({...row,startTime:row.beforeStart,endTime:row.beforeEnd}));cases.push(noOp);
 for(const input of cases){const h=setup(),before=copy([...h.docs]);await assert.rejects(h.amend(input));assert.deepEqual([...h.docs],before);}
 assert.equal(normalizeShiftAmendment(payload()).reconcileSavedAssignments,false);
});

test('chained corrections preserve the original before evidence and resolve chronological transitions without mutation',async()=>{
 const h=setup();await h.amend();const changes=[{shiftId:'mid',beforeStart:'14:00',beforeEnd:'21:30',startTime:'15:00',endTime:'22:30'}],second=payload({id:'correction-two',sourceRevisionId:'correction-one-current',changes});await h.amend(second);
 const history=await h.store.loadRange('2026-06-16','2026-06-30'),saved=copy(history);assert.equal(resolveScheduleForDate(history,'2026-06-17').branchConfig[branch][0].startTime,'15:00');assert.equal(resolveScheduleForDate(history,'2026-06-18').branchConfig[branch][0].startTime,'15:00');assert.equal(resolveScheduleForDate(history,'2026-06-16').branchConfig[branch][0].startTime,'13:00');assert.equal(h.get('settings/schedule_revision_original').snapshot.branchConfig[branch][0].startTime,'13:00');assert.deepEqual(history,saved);
 assert.equal(amendmentsForDate(history,'2026-06-17').length,2);const raw=resolveScheduleForDate(history,'2026-06-17',{amendments:false}),rawCopy=copy(raw);applyShiftAmendments(raw,amendmentsForDate(history,'2026-06-17'),'2026-06-17');assert.deepEqual(raw,rawCopy);
});
