import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAttendanceSchedule,resolveAttendanceShift,calculateShiftEarnings,latePay} from '../takodeal-manager/payroll-safety.js';
import {createScheduleRevision,assembleScheduleHistory,createScheduleHistoryStore} from '../takodeal-manager/schedule-history.js';
import {createPayrollBonusHistoryStore,publishedPayrollTemplates} from '../takodeal-manager/payroll-bonus-templates.js';
import {emergencyShiftSourceFingerprint} from '../takodeal-manager/emergency-shift-model.js';
import {reliefScheduleSourceFingerprint} from '../takodeal-manager/relief-schedule-review-model.js';
import {planPayrollAttendance} from '../takodeal-manager/payroll-attendance.js';

const branch='Fictional Branch',name='Fictional Crew',staffId='fictional-staff',owner='jgo031996@gmail.com';
const at=(time,day=17)=>new Date('2026-10-'+String(day).padStart(2,'0')+'T'+time+':00+08:00');
const profile={staffId,id:staffId,cashierName:name,branch,hourlyRate:450,nightDiffRate:50};
const rule=(id,startTime,endTime,shiftType,extra={})=>({id,name:id,startTime,endTime,shiftType,active:true,days:[0,1,2,3,4,5,6],...extra});
const usual=()=>[rule('morning','09:30','18:00','morning'),rule('mid','16:00','00:30','mid'),rule('night','17:30','02:00','night')];
function plan(rules=usual(),assigned='morning',month=10){return {currentYear:2026,currentMonth:month,employees:[{id:staffId,name,branch}],branchConfig:{[branch]:rules},currentSchedule:{17:{[branch]:{scheduled:{[assigned]:name},rest:[],unavailable:[],swaps:{}}}}};}
function revision(rules=usual(),assigned='morning'){return createScheduleRevision(plan(rules,assigned),{revisionId:'fictional-october-rules',effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',savedAt:at('00:00',1)});}
function history(rules=usual(),assigned='morning'){const saved=revision(rules,assigned);return assembleScheduleHistory(plan(rules,assigned),[{month:'2026-10',revisions:[saved]}]);}
function punch(time=at('17:11'),source=history(),extra={}){return {id:'fictional-oct17-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:time,scheduleSnapshot:captureAttendanceSchedule(time,branch,name,source,{[name]:profile}),lateMinutes:37,penaltyAmount:25,...extra};}
const resolve=(log,schedule,p=profile)=>resolveAttendanceShift(log,schedule,{[name]:p});
const earnings=(log,schedule,out=at('02:06',18),p=profile,options)=>calculateShiftEarnings(p,resolve(log,schedule,p),log.timestamp,out,options);
function head(log,extra={}){return {schemaVersion:1,status:'Confirmed',revisionId:'fictional-owner-swap',version:1,staffId,staffName:name,branch,timeInLogId:log.id,timeInAt:log.timestamp,workDate:'2026-10-17',expectedStartAt:at('17:30'),expectedEndAt:at('02:00',18),shiftName:'Owner confirmed Night cover',sourceFingerprint:emergencyShiftSourceFingerprint(log),reviewedByUid:'fictional-owner',reviewedByEmail:owner,reviewedAt:at('18:00'),...extra};}
function relief(log,shiftType='night',{start=at('09:30'),end=at('18:00')}={}){return {...log,reliefScheduleReview:{version:1,revision:1,auditId:'relief-'+log.id+'-1',sourceFingerprint:reliefScheduleSourceFingerprint(log),workDate:'2026-10-17',expectedStartAt:start,expectedEndAt:end,shiftName:'Explicit reviewed duty category',shiftType,isNightShift:['mid','night'].includes(shiftType),lateMinutes:37,exempt:false,actorUid:'fictional-owner',actorEmail:owner,reviewedAt:at('18:00')}};}
async function loadedCurrent(rules=usual(),{metadata={fromCache:false,hasPendingWrites:false},dated,foreign=false,storeFactory=createPayrollBonusHistoryStore}={}){
 const current=plan(rules,'morning',11);current.scheduleRevisionId='fictional-current-published';if(foreign){current.branchConfig={'Foreign Branch':rules};}
 const docs=new Map([['global_schedule',current]]);if(dated){docs.set('schedule_month_2026_10',{revisionIds:[dated.revisionId],latestRevisionId:dated.revisionId});docs.set('schedule_revision_'+dated.revisionId,dated);}
 const reads=[],api={db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:async ref=>{reads.push(ref);return {id:ref.id,exists:()=>docs.has(ref.id),data:()=>structuredClone(docs.get(ref.id)),metadata:ref.id==='global_schedule'?metadata:{fromCache:false,hasPendingWrites:false}};}};
 return {schedule:await storeFactory(api).loadRange('2026-10-17','2026-10-18'),reads,docs};
}

test('the confirmed emergency-cover example uses 8h55m actual punches for one Night bonus despite its stale Morning reference',()=>{
 const schedule=history(),log=punch(),before=structuredClone({log,schedule}),shift=resolve(log,schedule),late=latePay(log.lateMinutes,profile,shift),result=calculateShiftEarnings(profile,shift,log.timestamp,at('02:06',18));
 assert.equal(shift.shiftType,'morning');assert.equal(result.hoursWorked,535/60);assert.equal(result.basicPay,450);assert.equal(result.nightBonus,50);assert.equal(result.bonusShiftType,'night');assert.equal(result.straightBonus,0);assert.equal(result.shiftMultiplier,1);assert.equal(result.bonusReviewRequired,false);
 assert.equal(result.bonusBasis.source,'actual-punches');assert.equal(result.bonusBasis.templateSource,'dated');assert.equal(result.bonusBasis.status,'qualified');assert.equal(result.bonusBasis.workDate,'2026-10-17');assert.equal(result.bonusBasis.actualStartAt,log.timestamp.toISOString());assert.equal(result.bonusBasis.actualEndAt,at('02:06',18).toISOString());assert.deepEqual(result.bonusBasis.matchingShiftIds,['night']);assert.equal(result.bonusBasis.overlapHours,8.5);
 assert.equal(shift.lateMinutes,37);assert.deepEqual(latePay(log.lateMinutes,profile,shift),late);assert.deepEqual({log,schedule},before);
});
test('a stale saved Night category does not award a bonus when the actual completed work is mostly Morning',()=>{
 const source=history([rule('old-night','00:30','09:00','night')],'old-night'),log=punch(at('08:30'),source),result=earnings(log,history(),at('17:00'));
 assert.equal(log.scheduleSnapshot.isNightShift,true);assert.equal(result.hoursWorked,8.5);assert.equal(result.nightBonus,0);assert.equal(result.bonusBasis.shiftType,'morning');assert.equal(result.bonusBasis.status,'not-qualified');assert.equal(result.bonusReviewRequired,false);
});
for(const duration of [8*3600000-1,8*3600000])test('actual duration '+duration+'ms keeps the eight-hour boundary exact without rounded early qualification',()=>{
 const log=punch(at('17:30')),out=new Date(+log.timestamp+duration),result=earnings(log,history(),out);assert.equal(result.nightBonus,duration<8*3600000?0:50);assert.equal(result.basicPay,450);assert.equal(result.shiftMultiplier,1);
});
test('equal Morning and bonus windows are held instead of selecting an arbitrary eligible category',()=>{
 const schedule=history([rule('morning','17:30','02:00','morning'),rule('night','17:30','02:00','night')]),result=earnings(punch(),schedule);
 assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);assert.equal(result.bonusBasis.status,'review');assert.ok(result.bonusReviewReason);assert.equal(result.basicPay,450);
});
test('equally best Mid and Night windows earn one generic Mid/Night amount, never one amount for every matching slot',()=>{
 const schedule=history([rule('morning','09:30','18:00','morning'),rule('mid-a','17:30','02:00','mid'),rule('night-a','17:30','02:00','night'),rule('night-b','17:30','02:00','night')]),result=earnings(punch(),schedule);
 assert.equal(result.nightBonus,50);assert.equal(result.bonusShiftType,'mid-night');assert.equal(result.bonusReviewRequired,false);assert.deepEqual([...result.bonusBasis.matchingShiftIds].sort(),['mid-a','night-a','night-b']);assert.equal(result.bonusBasis.overlapHours,8.5);
});
test('duplicate Morning slots do not add their overlapping hours together to outvote a longer actual Night window',()=>{
 const rules=usual();for(let index=0;index<5;index++)rules.push(rule('morning-copy-'+index,'09:30','18:00','morning'));const result=earnings(punch(),history(rules));assert.equal(result.nightBonus,50);assert.equal(result.bonusShiftType,'night');
});
test('exactly half of an actual duty is not a majority; absent majority produces an explicit review',()=>{
 const log=punch(at('12:00')),result=earnings(log,history([rule('morning','09:30','16:00','morning'),rule('night','16:00','23:00','night')]),at('20:00'));
 assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);assert.equal(result.bonusBasis.status,'review');
});
test('disabled and wrong-weekday templates cannot influence actual-duty bonus classification',()=>{
 const rules=[rule('morning','09:30','18:00','morning'),rule('disabled','17:30','02:00','night',{active:false}),rule('wrong-day','17:30','02:00','night',{days:[0]})],result=earnings(punch(),history(rules));assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
test('same-clock windows from another branch do not qualify the recorded work branch',()=>{
 const schedule=history([rule('morning','09:30','18:00','morning')]);schedule.historyMonths['2026-10'].revisions[0].snapshot.branchConfig['Foreign Branch']=[rule('foreign-night','17:30','02:00','night')];const result=earnings(punch(),schedule);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
for(const type of ['night','morning','other'])test('a protected explicit Owner '+type+' review remains authoritative over automatic timing classification',()=>{
 const log=relief(punch(at('09:30')),type),result=earnings(log,history(),at('18:00'));assert.equal(result.nightBonus,type==='night'?50:0);assert.equal(result.bonusBasis.source,'owner-review');assert.equal(result.bonusBasis.templateSource,'owner-review');assert.equal(result.bonusBasis.shiftType,type);assert.equal(result.bonusReviewRequired,false);assert.equal(log.lateMinutes,37);
});
test('an earlier Owner Morning span that barely overlaps a replacement actual Night duty does not suppress its one Night bonus',()=>{
 const log=relief(punch(),'morning'),shift=resolve(log,history()),result=calculateShiftEarnings(profile,shift,log.timestamp,at('02:06',18));assert.equal(shift.reliefReviewVerified,true);assert.equal(result.nightBonus,50);assert.equal(result.bonusBasis.source,'actual-punches');assert.equal(result.bonusShiftType,'night');assert.equal(shift.lateMinutes,37);assert.equal(log.penaltyAmount,25);
});
test('an earlier Owner Night span cannot add a Night amount to a mostly Morning replacement duty',()=>{
 const source=history([rule('old-night','00:30','09:00','night')],'old-night'),log=relief(punch(at('08:30'),source),'night',{start:at('00:30'),end:at('09:00')}),shift=resolve(log,history()),result=calculateShiftEarnings(profile,shift,log.timestamp,at('17:00'));assert.equal(shift.reliefReviewVerified,true);assert.equal(result.nightBonus,0);assert.equal(result.bonusBasis.source,'actual-punches');assert.equal(result.bonusBasis.shiftType,'morning');assert.equal(shift.lateMinutes,37);
});
for(const patch of [{reviewedByEmail:'manager@example.test'},{staffId:'foreign-staff'},{branch:'Foreign Branch'},{sourceFingerprint:'wrong'},{timeInAt:at('17:12')}])test('invalid protected head '+JSON.stringify(patch)+' cannot be bypassed by a matching actual Night window',()=>{
 const log=punch(),schedule={...history(),payrollShiftConfirmations:{[log.id]:head(log,patch)}},result=earnings(log,schedule);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);assert.equal(result.basicPay,450);
});
test('explicit protected-head read failure stays a review even when actual times match a clear Night window',()=>{
 const log=punch(),result=earnings(log,{...history(),payrollShiftConfirmationErrors:{[log.id]:'Reconnect to confirm this exact Owner review.'}});assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
test('a valid Owner swap with different old Night-rule boundaries can earn its actual worked bonus without another exact-bound correction',()=>{
 const log=punch(),schedule={...history([rule('morning','09:30','18:00','morning'),rule('old-night','19:30','04:00','night')]),payrollShiftConfirmations:{[log.id]:head(log)}},shift=resolve(log,schedule),result=calculateShiftEarnings(profile,shift,log.timestamp,at('02:06',18));assert.equal(shift.payrollHoursConfirmed,true);assert.equal(shift.bonusCategoryVerified,false);assert.equal(result.nightBonus,50);assert.equal(result.bonusBasis.source,'actual-punches');assert.equal(result.bonusShiftType,'night');assert.equal(result.bonusReviewRequired,false);assert.equal(shift.lateMinutes,37);
});
test('an inclusive 530 daily rate with zero extra allowance stays exactly 530 on the new actual Night path',()=>{
 const p={...profile,hourlyRate:530,nightDiffRate:0,eligibleNightDiff:false},result=earnings(punch(),history(),at('02:06',18),p);assert.equal(result.basicPay,530);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,false);assert.equal(result.shiftMultiplier,1);
});
test('synthetic auto Time Out cannot newly infer a Night bonus from a stale Morning reference',()=>{
 const result=earnings(punch(),history(),at('02:06',18),profile,{autoClosed:true});assert.equal(result.nightBonus,0);assert.equal(result.bonusBasis,null);assert.equal(result.basicPay,450);
});
test('more than sixteen hours keeps the existing separate straight-duty approval path instead of ordinary actual inference',()=>{
 const log=punch(at('09:30')),result=earnings(log,history(),at('02:06',18));assert.equal(result.shiftMultiplier,1);assert.equal(result.straightBonus,0);assert.equal(result.straightApprovalRequired,true);assert.equal(result.bonusBasis,null);
});
test('a copied resolved object and raw approval booleans do not manufacture the bound calculation proof',()=>{
 const log=punch(),shift=resolve(log,history()),result=calculateShiftEarnings(profile,{...shift,payrollHoursConfirmed:true,reliefReviewVerified:true},log.timestamp,at('02:06',18));assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
test('a bound shift proof cannot be reused with a different actual Time In or another employee profile',()=>{
 const log=punch(),shift=resolve(log,history());for(const [person,time]of [[profile,new Date(+log.timestamp+60000)],[{...profile,id:'foreign-staff',staffId:'foreign-staff'},log.timestamp]]){const result=calculateShiftEarnings(person,shift,time,at('02:06',18));assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);}
});
test('a legacy salary projection without an explicit ID still earns its configured amount rather than a hardcoded fifty',()=>{
 const log=punch(),shift=resolve(log,history()),person={...profile,nightDiffRate:75};delete person.id;delete person.staffId;const result=calculateShiftEarnings(person,shift,log.timestamp,at('02:06',18));assert.equal(result.nightBonus,75);assert.equal(result.basicPay,450);assert.equal(result.bonusReviewRequired,false);
});
test('ordinary inference retains existing explicit-link overlap and foreign-staff holds before any pay consumer uses it',()=>{
 const log=punch(),out={id:'fictional-out',staffId,staffName:name,branch,type:'TIME OUT',timestamp:at('02:06',18),timeInLogId:log.id};for(const records of [[log,{...out,staffId:'foreign-staff'}],[log,{...log,id:'overlap',timestamp:at('18:00')},out]]){const planned=planPayrollAttendance(records);assert.equal(planned.heldNames.has(name),true);assert.equal(planned.logs.length,0);}
});

test('actual loadRange enables clearly labelled current-published fallback when this historical date has no archived rules',async()=>{
 const {schedule,reads}=await loadedCurrent(),result=earnings(punch(),schedule);assert.equal(result.nightBonus,50);assert.equal(result.bonusBasis.templateSource,'current-published');assert.equal(result.bonusBasis.workDate,'2026-10-17');assert.ok(reads.some(row=>row.id==='global_schedule'));assert.ok(result.bonusReviewReason=== ''||typeof result.bonusReviewReason==='string');
});
test('the ordinary history store does not mint payroll fallback proof and the payroll wrapper adds no HQ queries',async()=>{
 const bare=await loadedCurrent(usual(),{storeFactory:createScheduleHistoryStore}),wrapped=await loadedCurrent();
 assert.equal(publishedPayrollTemplates(bare.schedule,branch),null);assert.equal(earnings(punch(),bare.schedule).nightBonus,0);assert.equal(earnings(punch(),bare.schedule).bonusReviewRequired,true);
 assert.deepEqual(wrapped.reads.map(ref=>ref.table+'/'+ref.id).sort(),bare.reads.map(ref=>ref.table+'/'+ref.id).sort());assert.equal(wrapped.reads.filter(ref=>ref.id==='global_schedule').length,1);assert.equal(earnings(punch(),wrapped.schedule).nightBonus,50);
});
test('parallel payroll history reads keep each captured fresh global source isolated even when the second read completes first',async()=>{
 const pending=[],reads=[],snapshot=(ref,value)=>({id:ref.id,exists:()=>value!==undefined,data:()=>structuredClone(value),metadata:{fromCache:false,hasPendingWrites:false}});
 const api={db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:ref=>{reads.push(ref);return ref.id==='global_schedule'?new Promise(resolve=>pending.push(value=>resolve(snapshot(ref,value)))):Promise.resolve(snapshot(ref));}};
 const store=createPayrollBonusHistoryStore(api),first=store.loadRange('2026-10-17','2026-10-18'),second=store.loadRange('2026-10-17','2026-10-18');
 assert.equal(pending.length,2);
 const next={...plan([rule('second-night','17:30','02:00','night')],'second-night',11),scheduleRevisionId:'second-published'};pending[1](next);const secondResult=await second;
 const earlier={...plan([rule('first-morning','17:30','02:00','morning')],'first-morning',11),scheduleRevisionId:'first-published'};pending[0](earlier);const firstResult=await first;
 assert.equal(publishedPayrollTemplates(firstResult,branch).scheduleRevisionId,'first-published');assert.equal(publishedPayrollTemplates(secondResult,branch).scheduleRevisionId,'second-published');assert.equal(earnings(punch(),firstResult).nightBonus,0);assert.equal(earnings(punch(),secondResult).nightBonus,50);
 const baseline=await loadedCurrent();const counts=rows=>Object.fromEntries([...new Set(rows.map(ref=>ref.table+'/'+ref.id))].sort().map(key=>[key,rows.filter(ref=>ref.table+'/'+ref.id===key).length]));assert.deepEqual(counts(reads),Object.fromEntries(Object.entries(counts(baseline.reads)).map(([key,count])=>[key,count*2])));
});
test('trusted current templates survive a normal loader spread while editor mutations cannot replace the captured published rules',async()=>{
 const {schedule}=await loadedCurrent(),before=publishedPayrollTemplates(schedule,branch);schedule.branchConfig[branch]=[rule('fake-morning','17:30','02:00','morning')];const spread={...schedule,branchConfig:{[branch]:[rule('draft-other','17:30','02:00','other')]}};
 assert.deepEqual(publishedPayrollTemplates(spread,branch),before);assert.equal(earnings(punch(),spread).nightBonus,50);assert.throws(()=>{before.rules[0].startTime='01:00';},TypeError);assert.equal(publishedPayrollTemplates(schedule,'Foreign Branch'),null);
});
for(const mode of ['plain assemble','JSON round trip','structured clone','fake marker'])test(mode+' cannot manufacture a fresh current-published fallback',async()=>{
 const {schedule}=await loadedCurrent();const untrusted=mode==='plain assemble'?assembleScheduleHistory(plan(),[]):mode==='JSON round trip'?JSON.parse(JSON.stringify(schedule)):mode==='structured clone'?structuredClone(schedule):{...plan(),publishedPayrollTemplates:true,currentPublished:true};assert.equal(publishedPayrollTemplates(untrusted,branch),null);const result=earnings(punch(),untrusted);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);
});
for(const metadata of [undefined,{fromCache:true,hasPendingWrites:false},{fromCache:false,hasPendingWrites:true}])test('unconfirmed global metadata '+JSON.stringify(metadata)+' cannot supply current fallback',async()=>{
 const result=await loadedCurrent(usual(),{metadata:metadata??null});assert.equal(publishedPayrollTemplates(result.schedule,branch),null);assert.equal(earnings(punch(),result.schedule).nightBonus,0);
});
test('foreign current-published templates cannot substitute for absent work-branch templates',async()=>{
 const {schedule}=await loadedCurrent(usual(),{foreign:true}),result=earnings(punch(),schedule);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);assert.equal(publishedPayrollTemplates(schedule,branch),null);
});
test('dated workday templates outrank a contradictory current-published category',async()=>{
 const dated=revision([rule('morning','17:30','02:00','morning')]),{schedule}=await loadedCurrent(usual(),{dated}),result=earnings(punch(),schedule);assert.equal(result.nightBonus,0);assert.equal(result.bonusBasis.templateSource,'dated');assert.equal(result.bonusBasis.shiftType,'morning');
});
test('a dated workday with no majority cannot quietly borrow the more favorable current-published Night window',async()=>{
 const dated=revision([rule('morning','09:30','18:00','morning')]),{schedule}=await loadedCurrent(usual(),{dated}),result=earnings(punch(),schedule);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);assert.notEqual(result.bonusBasis.templateSource,'current-published');
});
test('an adjacent date missing history cannot outvote a majority-covered dated Morning with a broader current-published Night template',async()=>{
 const rules=[rule('morning','09:00','17:30','morning')],dated=createScheduleRevision(plan(rules),{revisionId:'fictional-one-dated-day',effectiveFrom:'2026-10-17',effectiveTo:'2026-10-17',savedAt:at('00:00',1)}),{schedule}=await loadedCurrent([rule('broad-night','23:00','17:00','night')],{dated}),log=punch(at('08:00')),result=earnings(log,schedule,at('16:00'));assert.equal(result.nightBonus,0);assert.equal(result.bonusBasis.templateSource,'dated');assert.equal(result.bonusBasis.shiftType,'morning');assert.equal(result.bonusBasis.overlapHours,7);
});
test('malformed dated templates are held rather than replaced by an attractive current-published fallback',async()=>{
 const dated=revision([rule('broken-night','17:30','02:00','night')]);
 // Simulate a malformed legacy document read from HQ; the current writer itself
 // already rejects this invalid hour before a revision can be saved.
 dated.snapshot.branchConfig[branch][0].startTime='25:00';
 const {schedule}=await loadedCurrent(usual(),{dated}),result=earnings(punch(),schedule);assert.equal(result.nightBonus,0);assert.equal(result.bonusReviewRequired,true);assert.equal(result.bonusBasis.status,'review');
});
