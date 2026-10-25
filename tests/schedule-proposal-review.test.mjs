import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createScheduleProposalReview} from '../takodeal-manager/schedule-proposal-review.js';
import {createScheduleHistoryStore,createScheduleRevision,shiftAmendmentFingerprint} from '../takodeal-manager/schedule-history.js';
import {projectScheduleMonth} from '../takodeal-manager/schedule-sync.js';
import {scheduleProposalContext} from '../takodeal-manager/schedule-proposal-model.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Real Owner review + history store + projector/model through an optimistic local
// transaction seam. Security Rules are covered separately in emulator tests.
const NOW='2026-10-25T04:00:00Z',OWNER='jgo031996@gmail.com',clone=structuredClone;
const people=[{staffId:'staff_a',name:'Sample Ana',scheduleName:'Ana',branch:'Maa',active:true},
 {staffId:'staff_b',name:'Sample Bea',scheduleName:'Bea',branch:'Maa',active:true},
 {staffId:'staff_c',name:'Sample Cora',scheduleName:'Cora',branch:'Maa',active:true}];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture({from='2026-10-25',to='2026-10-26'}={}){
 const h=firestoreHarness(),shifts=[{id:'morning',name:'Morning 1',startTime:'09:00',endTime:'17:30',active:true,days:[0,1,2,3,4,5,6]},
  {id:'night',name:'Night',startTime:'18:00',endTime:'02:00',active:true,days:[0,1,2,3,4,5,6]}];
 const snapshot={currentYear:2026,currentMonth:10,branchConfig:{Maa:shifts,Agdao:clone(shifts)},employees:[...people.map(p=>({staffId:p.staffId,name:p.scheduleName,branch:p.branch})),{staffId:'other_staff',name:'Other',branch:'Agdao'}],
  holidays:{'2026-10-25':'Regular'},unavailability:{},currentSchedule:{}};
 for(let day=25;day<=31;day++)snapshot.currentSchedule[day]={Maa:{scheduled:{morning:'Ana',night:'Bea'},rest:['Cora'],unavailable:[],swaps:{night:{originalStaff:'Earlier'}}},Agdao:{scheduled:{morning:'Other',night:'UNFILLED'},rest:[],unavailable:[],swaps:{}}};
 const revision=createScheduleRevision(snapshot,{revisionId:'base',effectiveFrom:'2026-10-25',savedAt:new Date(NOW)});revision.sequence=1;
 const index={schemaVersion:1,kind:'schedule-month',month:'2026-10',revisionIds:['base'],latestRevisionId:'base',payrollHistoryEnforcedFrom:'2026-10-25'},head={...clone(revision.snapshot),scheduleRevisionId:'base',scheduleEffectiveFrom:'2026-10-25',payrollHistoryEnforcedFrom:'2026-10-25'};
 h.put('settings/global_schedule',head);h.put('settings/schedule_month_2026_10',index);h.put('settings/schedule_revision_base',revision);h.put('settings/schedule_history_policy',{schemaVersion:1,payrollHistoryEnforcedFrom:'2026-10-25'});
 for(const person of people)h.put('cashiers/'+person.staffId,{cashierName:person.name,scheduleNickname:person.scheduleName,branch:person.branch,active:true,status:'Active',role:'Staff',pin:'SAMPLE-ONLY-4321'});
 h.put('attendance_logs/sample_punch',{staffId:'staff_a',timeIn:'2026-10-25T00:50:00Z',timeOut:'2026-10-25T10:00:00Z',hours:8.5});
 h.put('payroll_records/sample_paid',{staffId:'staff_a',paid:true,netPay:1234,cutoffStart:'2026-10-01',cutoffEnd:'2026-10-15'});
 const archive={month:'2026-10',revisions:[revision],latestRevision:revision,latestRevisionId:'base',shiftAmendments:[],indexFingerprint:shiftAmendmentFingerprint({index,durable:null})};
 const view=projectScheduleMonth({month:'2026-10',current:head,archive,now:new Date(NOW)}),context=scheduleProposalContext({monthView:view,staff:people,branch:'Maa',from,to,today:'2026-10-25'});
 const proposal={version:1,id:'sample_proposal',branch:'Maa',month:'2026-10',from,to,reason:'Emergency cover after a sick call.',baseRevisionId:context.baseRevisionId,baseBranchFingerprint:context.baseBranchFingerprint,
  days:context.days.map(day=>({date:day.date,scheduled:[{shiftId:'morning',staffId:'staff_c'},{shiftId:'night',staffId:'staff_b'}],standbyStaffIds:[],offStaffIds:['staff_a']}))};
 const intent=createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),row={schemaVersion:1,proposal,intent,status:'Pending',submittedAt:'2026-10-25T03:00:00Z',submittedBy:{staffId:'staff_a',staffName:'Sample Ana',uid:'sample_pos',deviceId:'DEV-SAMPLE',deviceName:'Sample tablet',branch:'Maa'},staffSnapshot:clone(people),shiftSnapshot:[],reviewedAt:null,reviewedByUid:null,reviewedByEmail:null,reviewNote:'',revisionId:null};
 h.put('branch_schedule_proposals/'+proposal.id,row);
 const state={...h,row,time:new Date(NOW),reads:[],queries:[],writes:[],physicalSaves:0,physicalTransactions:0,hooks:{},metadata:{},gate:null};
 const api={...h.api,auth:{currentUser:{uid:'sample_owner',email:OWNER,emailVerified:true}},sessionUser:{uid:'sample_owner',email:OWNER,isOwner:true,isFranchisee:false,role:'Owner'},
  limit:count=>({limit:count}),startAfter:snapshot=>({startAfter:snapshot.id}),
  async getDocFromServer(reference){state.reads.push(reference.path);await state.hooks.beforeRead?.(reference.path);const data=clone(h.get(reference.path));return{id:reference.id,ref:reference,exists:()=>data!==undefined,data:()=>clone(data),metadata:{fromCache:false,hasPendingWrites:false,...state.metadata[reference.path]}};},
  async getDocsFromServer(q){state.queries.push(q);await state.hooks.beforeQuery?.(q);const filters=q.filters.filter(f=>f.key),count=q.filters.find(f=>f.limit)?.limit??Infinity,cursor=q.filters.find(f=>f.startAfter)?.startAfter;
   const paths=[...h.docs.keys()].filter(path=>path.startsWith(q.table+'/')&&filters.every(f=>f.key.split('.').reduce((value,key)=>value?.[key],h.get(path))===f.value)&&(!cursor||path.slice(q.table.length+1)>cursor)).sort().slice(0,count);
   return{metadata:{fromCache:false,hasPendingWrites:false},docs:paths.map(path=>{const data=clone(h.get(path));return{id:path.slice(q.table.length+1),ref:{path},data:()=>clone(data),metadata:{fromCache:false,hasPendingWrites:false,...state.metadata[path]}};})};},
  async runTransaction(db,callback){state.physicalTransactions++;if(state.gate)await state.gate.promise;return h.api.runTransaction(db,async tx=>{const writes=[];const value=await callback({get:async reference=>{state.reads.push(reference.path);const snap=await tx.get(reference);await state.hooks.afterTxRead?.(reference.path);return{...snap,metadata:{fromCache:false,hasPendingWrites:false,...state.metadata[reference.path]}};},set:(reference,data)=>{writes.push(reference.path);tx.set(reference,data);}});await state.hooks.beforeCommit?.(writes);state.writes.push(writes);return value;});}
 };
 let sequence=0;const history=createScheduleHistoryStore(api,{now:()=>state.time,makeId:()=> 'sample_auto_revision_'+(++sequence)});
 api.getScheduleHistoryStore=()=>({async save(snapshot,options){state.physicalSaves++;await state.hooks.beforeSave?.(snapshot,options);return history.save(snapshot,options);}});
 state.api=api;state.history=history;state.service=createScheduleProposalReview(api,{now:()=>state.time});
 state.decision=(decision='Approved',reason='Verified the branch cover arrangement.')=>({id:proposal.id,decision,reason,expectedIntent:intent});
 state.settings=()=>clone([...h.docs].filter(([path])=>path.startsWith('settings/')));
 state.protectedRecords=()=>clone([...h.docs].filter(([path])=>/^(attendance_logs|payroll_records)\//.test(path)));
 return state;
}

test('preparation reads current full month and branch staff but never changes a record',async()=>{
 const f=fixture(),before=clone([...f.docs]),prepared=await f.service.prepare(f.row.proposal.id);assert.equal(prepared.row.status,'Pending');assert.equal(prepared.snapshot.currentSchedule[25].Maa.scheduled.morning,'Cora');assert.ok(prepared.view.daySnapshots[25].branchConfig.Agdao);assert.deepEqual([...f.docs],before);assert.equal(f.physicalTransactions,0);assert.equal(f.physicalSaves,0);
});

test('approval atomically saves a stable dated revision and decision with proposer/reviewer audit',async()=>{
 const f=fixture(),protectedBefore=f.protectedRecords(),result=await f.service.decide(f.decision());assert.equal(result.row.status,'Approved');assert.equal(result.row.revisionId,'proposal-sample_proposal');assert.equal(result.alreadySaved,false);
 const revision=f.get('settings/schedule_revision_proposal-sample_proposal');assert.equal(revision.source,'cashier-schedule-proposal');assert.equal(revision.effectiveFrom,'2026-10-25');assert.equal(revision.effectiveTo,'2026-10-26');assert.equal(revision.branchScheduleProposalId,f.row.proposal.id);
 assert.deepEqual(revision.branchScheduleProposalAudit.submittedBy,f.row.submittedBy);assert.equal(revision.branchScheduleProposalAudit.reviewedByUid,'sample_owner');assert.equal(revision.branchScheduleProposalAudit.reviewedByEmail,OWNER);
 assert.ok(f.writes.some(paths=>paths.includes('settings/schedule_revision_proposal-sample_proposal')&&paths.includes('branch_schedule_proposals/sample_proposal')));
 assert.equal(f.get('settings/global_schedule').currentSchedule[25].Maa.scheduled.morning,'Cora');assert.deepEqual(f.protectedRecords(),protectedBefore);
 assert.deepEqual(result.row.staffSnapshot,f.row.staffSnapshot);assert.deepEqual(result.row.shiftSnapshot,f.row.shiftSnapshot);
});

test('approval preserves other branches, HQ rule times, untouched dates, holidays, existing swaps and paid payroll',async()=>{
 const f=fixture(),before=clone(f.get('settings/global_schedule')),paid=f.protectedRecords();await f.service.decide(f.decision());const after=f.get('settings/global_schedule');
 assert.deepEqual(after.branchConfig,before.branchConfig);assert.deepEqual(after.holidays,before.holidays);assert.deepEqual(after.currentSchedule[25].Agdao,before.currentSchedule[25].Agdao);assert.deepEqual(after.currentSchedule[27],before.currentSchedule[27]);
 assert.deepEqual(after.currentSchedule[25].Maa.swaps,{night:{originalStaff:'Earlier'}});assert.deepEqual(after.currentSchedule[25].Maa.unavailable,[{name:'Ana',status:'Day Off',staffId:'staff_a'}]);assert.equal(after.unavailability['2026-10-25'].Ana,'Day Off');assert.deepEqual(f.protectedRecords(),paid);
});

test('a future proposal saves its future range without replacing the current month head',async()=>{
 const f=fixture({from:'2026-10-26',to:'2026-10-27'}),head=clone(f.get('settings/global_schedule'));await f.service.decide(f.decision());assert.deepEqual(f.get('settings/global_schedule'),head);assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal').effectiveFrom,'2026-10-26');
});

test('rejection writes only the decision and keeps all canonical schedule history unchanged',async()=>{
 const f=fixture(),settings=f.settings(),protectedBefore=f.protectedRecords(),result=await f.service.decide(f.decision('Rejected','Please refresh the branch roster and resubmit.'));assert.equal(result.row.status,'Rejected');assert.equal(result.row.revisionId,null);assert.deepEqual(f.settings(),settings);assert.deepEqual(f.protectedRecords(),protectedBefore);assert.equal(f.physicalSaves,0);assert.deepEqual(f.writes.flat(),['branch_schedule_proposals/sample_proposal']);
});

test('late approval cannot silently apply a proposal whose start date has passed, but rejection remains available',async()=>{
 const f=fixture();f.time=new Date('2026-10-26T04:00:00Z');const settings=f.settings();await assert.rejects(f.service.decide(f.decision()),/today or future/);assert.deepEqual(f.settings(),settings);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');assert.equal((await f.service.decide(f.decision('Rejected','Dates passed; submit a new future plan.'))).row.status,'Rejected');
});

for(const [name,change]of Object.entries({
 'unverified email':f=>{f.api.auth.currentUser.emailVerified=false;},'different email':f=>{f.api.auth.currentUser.email='other@example.invalid';},
 'locked Owner':f=>{f.api.sessionUser.isOwner=false;},'session UID mismatch':f=>{f.api.sessionUser.uid='different';},
 'session email mismatch':f=>{f.api.sessionUser.email='different@example.invalid';},'franchisee session':f=>{f.api.sessionUser.isFranchisee=true;}
}))test(`${name} cannot read or review branch proposals`,async()=>{
 const f=fixture();change(f);await assert.rejects(f.service.load(f.row.proposal.id),/verified Owner/);assert.throws(()=>f.service.decide(f.decision()),/verified Owner/);assert.equal(f.reads.length,0);assert.equal(f.physicalTransactions,0);
});

test('an account change while the proposal read is pending prevents context or a decision',async()=>{
 const f=fixture(),gate=deferred();f.hooks.beforeRead=async path=>{if(path.startsWith('branch_schedule_proposals/'))await gate.promise;};const pending=f.service.decide(f.decision());f.api.auth.currentUser={uid:'different',email:OWNER,emailVerified:true};gate.resolve();await assert.rejects(pending,/Owner|account changed/);assert.equal(f.physicalSaves,0);assert.equal(f.writes.length,0);
});

test('an account change before transaction execution cannot publish a prepared decision',async()=>{
 const f=fixture();f.hooks.beforeSave=()=>{f.api.sessionUser.isOwner=false;};await assert.rejects(f.service.decide(f.decision()),/Owner/);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal'),undefined);
});

test('cached or locally pending proposal, roster and profile reads cannot be presented as verified preparation',async()=>{
 for(const path of ['branch_schedule_proposals/sample_proposal','settings/global_schedule','settings/schedule_revision_base','cashiers/staff_a'])for(const flag of ['fromCache','hasPendingWrites']){const f=fixture();f.metadata[path]={[flag]:true};await assert.rejects(f.service.prepare(f.row.proposal.id),/Connect to HQ|saved schedule/);assert.equal(f.physicalSaves,0);assert.equal(f.writes.length,0);}
});

for(const [name,patch]of Object.entries({'resigned with whitespace':{status:' Resigned '},'revoked PIN':{pin:' REVOKED '},'blocked account':{blocked:true},'inactive account':{active:false},'foreign branch':{branch:'Agdao'},'nonstaff role':{role:'Owner'}}))test(`${name} in a current assigned profile blocks approval`,async()=>{
 const f=fixture(),path='cashiers/staff_c';f.put(path,{...f.get(path),...patch});const before=f.settings();await assert.rejects(f.service.decide(f.decision()),/active|inactive|branch|saved/);assert.deepEqual(f.settings(),before);assert.equal(f.writes.length,0);
});

test('a saved source revision or proposal intent change requires a fresh review',async()=>{
 for(const variant of ['revision','intent']){const f=fixture();if(variant==='revision')f.put('settings/schedule_month_2026_10',{...f.get('settings/schedule_month_2026_10'),latestRevisionId:'missing'});else f.put('branch_schedule_proposals/sample_proposal',{...f.row,intent:'changed-intent'});const before=f.settings();await assert.rejects(f.service.decide(f.decision()),/changed|incomplete|Reload/);assert.deepEqual(f.settings(),before);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');}
});

test('staff schedule-name and branch changes between preparation and the transaction cannot publish stale assignments',async()=>{
 for(const patch of [{scheduleNickname:'New alias'},{branch:'Agdao'},{status:'Resigned'}]){const f=fixture();f.hooks.beforeSave=()=>f.put('cashiers/staff_c',{...f.get('cashiers/staff_c'),...patch});await assert.rejects(f.service.decide(f.decision()),/changed|active|inactive|branch/);assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal'),undefined);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');}
});

test('a canonical revision change between preparation and save cannot overwrite the newer month',async()=>{
 const f=fixture();f.hooks.beforeSave=()=>f.put('settings/schedule_month_2026_10',{...f.get('settings/schedule_month_2026_10'),latestRevisionId:'newer_revision'});await assert.rejects(f.service.decide(f.decision()),/changed in another session/);assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal'),undefined);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');
});

test('a race changing a staff profile after transaction reads retries and rejects the stale proposal',async()=>{
 const f=fixture();let changed=false;f.hooks.beforeCommit=paths=>{if(!changed&&paths.includes('branch_schedule_proposals/sample_proposal')){changed=true;f.put('cashiers/staff_c',{...f.get('cashiers/staff_c'),status:'Resigned'});}};await assert.rejects(f.service.decide(f.decision()),/active|inactive|saved/);assert.ok(f.retries()>0);assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal'),undefined);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');
});

test('an atomic commit failure leaves neither an approved proposal nor its revision',async()=>{
 const f=fixture(),before=f.settings();f.failNextCommit();await assert.rejects(f.service.decide(f.decision()),/Commit rejected/);assert.deepEqual(f.settings(),before);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal'),undefined);
});

test('lost acknowledgment retry confirms the already saved approval without another history save',async()=>{
 const f=fixture();f.loseNextAck();await assert.rejects(f.service.decide(f.decision()),/Connection lost/);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Approved');const settings=f.settings(),physical=f.physicalSaves;
 const retry=await f.service.decide(f.decision());assert.equal(retry.alreadySaved,true);assert.equal(retry.row.revisionId,'proposal-sample_proposal');assert.deepEqual(f.settings(),settings);assert.equal(f.physicalSaves,physical);assert.deepEqual(f.get('settings/schedule_month_2026_10').revisionIds,['base','proposal-sample_proposal']);
});

test('lost acknowledgment retry confirms a rejection without another physical transaction',async()=>{
 const f=fixture();f.loseNextAck();await assert.rejects(f.service.decide(f.decision('Rejected','Refresh the saved branch roster first.')),/Connection lost/);const count=f.physicalTransactions;assert.equal((await f.service.decide(f.decision('Rejected','Refresh the saved branch roster first.'))).alreadySaved,true);assert.equal(f.physicalTransactions,count);
});

test('same pending decision shares one promise; changed intent cannot start a new physical save after a UI deadline',async()=>{
 const f=fixture();f.gate=deferred();const decision=f.decision(),pending=f.service.decide(decision);assert.equal(f.service.decide(decision),pending);await new Promise(setImmediate);assert.equal(f.physicalSaves,1);assert.equal(f.physicalTransactions,1);
 assert.equal(await Promise.race([pending,Promise.resolve('UI deadline only')]),'UI deadline only');
 assert.throws(()=>f.service.decide(f.decision('Rejected','Reject instead while approval is still pending.')),/still awaiting confirmation/);assert.throws(()=>f.service.decide(f.decision('Approved','A changed approval note.')),/still awaiting confirmation/);assert.equal(f.physicalSaves,1);assert.equal(f.physicalTransactions,1);
 f.gate.resolve();assert.equal((await pending).row.status,'Approved');
});

test('separate Owner instances racing opposite decisions can commit only one valid decision',async()=>{
 const f=fixture(),second=createScheduleProposalReview(f.api,{now:()=>f.time}),results=await Promise.allSettled([f.service.decide(f.decision()),second.decide(f.decision('Rejected','Another Owner review decided to reject.'))]);
 const saved=f.get('branch_schedule_proposals/sample_proposal');assert.ok(['Approved','Rejected'].includes(saved.status));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);if(saved.status==='Approved')assert.ok(f.get('settings/schedule_revision_proposal-sample_proposal'));else assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal'),undefined);
});

test('an existing matching revision without an approved proposal cannot short-circuit readback into false success',async()=>{
 const f=fixture(),prepared=await f.service.prepare(f.row.proposal.id);f.hooks.beforeSave=async(snapshot,options)=>{delete f.hooks.beforeSave;await f.history.save(snapshot,{expectedRevisionId:options.expectedRevisionId,effectiveFrom:options.effectiveFrom,effectiveTo:options.effectiveTo,revisionId:options.revisionId,source:options.source,actor:OWNER});};
 await assert.rejects(f.service.decide(f.decision()),/not confirmed/);assert.equal(f.get('branch_schedule_proposals/sample_proposal').status,'Pending');assert.equal(f.get('settings/schedule_revision_proposal-sample_proposal').source,'cashier-schedule-proposal');assert.equal(prepared.row.status,'Pending');
});

test('an approved/rejected saved decision is viewable without revalidating renamed historical staff',async()=>{
 const f=fixture();await f.service.decide(f.decision());f.put('cashiers/staff_a',{...f.get('cashiers/staff_a'),status:'Resigned'});f.time=new Date('2026-11-01T04:00:00Z');const result=await f.service.prepare(f.row.proposal.id);assert.equal(result.row.status,'Approved');assert.equal(result.view,undefined);assert.deepEqual(result.row.staffSnapshot,f.row.staffSnapshot);
});

test('invalid review fields and a contrary saved decision cannot trigger a new canonical save',async()=>{
 const f=fixture();for(const patch of [{id:'../bad'},{decision:'AutoApproved'},{reason:'x'},{reason:'x'.repeat(1501)}])assert.throws(()=>f.service.decide({...f.decision(),...patch}),/proposal|review note/);
 await f.service.decide(f.decision('Rejected','Please submit a new proposal.'));const saves=f.physicalSaves;await assert.rejects(f.service.decide(f.decision()),/already decided/);assert.equal(f.physicalSaves,saves);
});

test('bounded physical pagination has no omissions or duplicates despite sorting each page by submitted date',async()=>{
 const f=fixture();for(let i=0;i<136;i++){const id='page_'+String(i).padStart(3,'0');f.put('branch_schedule_proposals/'+id,{...clone(f.row),proposal:{...clone(f.row.proposal),id},submittedAt:new Date(Date.parse(NOW)+i*60000).toISOString()});}
 f.put('branch_schedule_proposals/excluded_other_month',{...clone(f.row),proposal:{...clone(f.row.proposal),id:'excluded_other_month',month:'2026-11'},status:'Rejected'});
 const first=await f.service.list({status:'Pending'});assert.equal(first.length,100);assert.equal(first.nextCursor,'page_099');assert.equal(first[0].id,'page_099');assert.equal(first.at(-1).id,'page_000');assert.equal(Object.getOwnPropertyDescriptor(first,'nextCursor').enumerable,false);assert.equal(JSON.stringify(first).includes('nextCursor'),false);
 const second=await f.service.list({status:'Pending',cursor:first.nextCursor});assert.equal(second.length,37);assert.equal(second.nextCursor,null);
 const ids=[...first,...second].map(row=>row.id);assert.equal(new Set(ids).size,137);assert.deepEqual([...ids].sort(),[...f.docs.keys()].filter(path=>path.startsWith('branch_schedule_proposals/')&&f.get(path).status==='Pending').map(path=>path.split('/')[1]).sort());
 assert.ok(f.queries.every(query=>query.filters.some(filter=>filter.limit===101)));assert.ok(f.queries.every(query=>!query.filters.some(filter=>filter.orderBy)));assert.equal(f.writes.length,0);
});

test('selected-month pagination preserves the same query scope across pages and reports a null final cursor',async()=>{
 const f=fixture();for(let i=0;i<101;i++){const id='month_'+String(i).padStart(3,'0');f.put('branch_schedule_proposals/'+id,{...clone(f.row),status:i%2?'Approved':'Rejected',proposal:{...clone(f.row.proposal),id,month:'2026-11'}});}
 const first=await f.service.list({month:'2026-11'}),second=await f.service.list({month:'2026-11',cursor:first.nextCursor});assert.equal(first.length,100);assert.equal(second.length,1);assert.equal(second.nextCursor,null);assert.ok([...first,...second].every(row=>row.proposal.month==='2026-11'));assert.equal(new Set([...first,...second].map(row=>row.id)).size,101);
});

test('deleted, changed-scope, invalid or unverified cursors require a fresh list instead of silently skipping records',async()=>{
 for(const variant of ['deleted','status','month','pending','cached','invalid']){const f=fixture(),cursor='sample_proposal';if(variant==='deleted')f.docs.delete('branch_schedule_proposals/'+cursor);else if(variant==='status')f.put('branch_schedule_proposals/'+cursor,{...f.row,status:'Approved'});else if(variant==='month')f.put('branch_schedule_proposals/'+cursor,{...f.row,proposal:{...f.row.proposal,month:'2026-11'}});else if(variant==='pending')f.metadata['branch_schedule_proposals/'+cursor]={hasPendingWrites:true};else if(variant==='cached')f.metadata['branch_schedule_proposals/'+cursor]={fromCache:true};
  const options=variant==='month'?{month:'2026-10',cursor}:{status:'Pending',cursor:variant==='invalid'?'../invalid':cursor};await assert.rejects(f.service.list(options),/Refresh|refresh|Connect to HQ/);assert.equal(f.queries.length,0);assert.equal(f.writes.length,0);
 }
});

test('account identity is rechecked after both cursor lookup and page query',async()=>{
 for(const stage of ['cursor','query']){const f=fixture();if(stage==='cursor')f.hooks.beforeRead=()=>{f.api.sessionUser.isOwner=false;};else f.hooks.beforeQuery=()=>{f.api.sessionUser.isOwner=false;};await assert.rejects(f.service.list({cursor:stage==='cursor'?'sample_proposal':null}),/Owner|account changed/);assert.equal(f.writes.length,0);}
});
