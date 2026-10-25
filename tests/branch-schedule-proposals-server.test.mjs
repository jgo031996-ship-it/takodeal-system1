import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createBranchScheduleProposals,PRODUCTION_ORIGINS,MAX_REQUEST_BYTES} from '../functions/branch-schedule-proposals/service.mjs';
import {createScheduleRevision,shiftAmendmentFingerprint} from '../takodeal-manager/schedule-history.js';
import {projectScheduleMonth} from '../takodeal-manager/schedule-sync.js';
import {scheduleProposalContext} from '../takodeal-manager/schedule-proposal-model.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Only synthetic identities and a local optimistic transaction harness. These
// tests exercise the real pure model/projector, not live Firebase or Rules.
const TOKEN='fixture_firebase_token_1234567890',PIN='SAMPLE-PIN-4815';
const NOW=Date.parse('2026-10-25T04:00:00Z'),MONTH='2026-10',UID='sample_pos_uid';
const clone=structuredClone,digest=value=>createHash('sha256').update(value).digest('hex');
const actor=uid=>({uid,firebase:{sign_in_provider:'anonymous'}});
const baseStaff={cashierName:'Sample Alpha',scheduleNickname:'Alpha',branch:'Maa',active:true,status:'Active',role:'Staff',pin:PIN};
const staffRows={staff_one:baseStaff,staff_two:{...baseStaff,cashierName:'Sample Beta',scheduleNickname:'Beta',pin:'SAMPLE-PIN-8732'},staff_four:{...baseStaff,cashierName:'Sample Gamma',scheduleNickname:'Gamma',pin:'SAMPLE-PIN-6159'},staff_three:{...baseStaff,cashierName:'Sample Other',scheduleNickname:'Other',branch:'Citygate',pin:'SAMPLE-PIN-1193'}};
function roster(){
 const shifts=[{id:'morning',name:'Morning 1',startTime:'09:00',endTime:'17:30',active:true,days:[0,1,2,3,4,5,6]},
  {id:'night',name:'Night',startTime:'17:30',endTime:'02:00',active:true,days:[0,1,2,3,4,5,6]}];
 const currentSchedule={};for(let day=25;day<=31;day++)currentSchedule[day]={Maa:{scheduled:{morning:'Alpha',night:'Beta'},rest:['Gamma'],unavailable:[],swaps:{}},Citygate:{scheduled:{morning:'Other'},rest:[],unavailable:[],swaps:{}}};
 return {currentYear:2026,currentMonth:10,branchConfig:{Maa:shifts,Citygate:[shifts[0]]},currentSchedule,unavailability:{},holidays:{},
  employees:Object.entries(staffRows).map(([staffId,row])=>({staffId,name:row.cashierName,scheduleNickname:row.scheduleNickname,branch:row.branch}))};
}
function fixture(){
 const h=firestoreHarness(),snapshot=roster(),revision=createScheduleRevision(snapshot,{revisionId:'sample_base_revision',effectiveFrom:'2026-10-25',savedAt:new Date(NOW),actor:'sample-hq@example.invalid'});revision.sequence=1;
 const index={schemaVersion:1,kind:'schedule-month',month:MONTH,revisionIds:[revision.revisionId],latestRevisionId:revision.revisionId,payrollHistoryEnforcedFrom:'2026-10-25'};
 const head={...clone(revision.snapshot),scheduleRevisionId:revision.revisionId,scheduleEffectiveFrom:'2026-10-25'};
 h.put('settings/global_schedule',head);h.put('settings/schedule_month_2026_10',index);h.put('settings/schedule_revision_'+revision.revisionId,revision);
 for(const [id,person]of Object.entries(staffRows))h.put('cashiers/'+id,person);
 h.put('pos_bindings/'+UID,{uid:UID,status:'Active',branch:'Maa',deviceId:'DEV-SAMPLE-TABLET',legacyDeviceDocId:'fleet_auto_document',deviceName:'Sample Maa tablet'});
 h.put('pos_devices/fleet_auto_document',{status:'Active',branch:'Maa',deviceId:'DEV-SAMPLE-TABLET',appType:'POS',deviceName:'Sample Maa tablet'});
 const archive={month:MONTH,latestRevisionId:revision.revisionId,revisions:[revision],latestRevision:revision,payrollHistoryEnforcedFrom:'2026-10-25',shiftAmendments:[],indexFingerprint:shiftAmendmentFingerprint({index,durable:null})};
 const view=projectScheduleMonth({month:MONTH,current:head,archive,now:new Date(NOW),branch:'Maa'}),people=Object.entries(staffRows).map(([staffId,row])=>({staffId,name:row.cashierName,scheduleName:row.scheduleNickname,branch:row.branch,active:true}));
 const context=scheduleProposalContext({monthView:view,staff:people,branch:'Maa',from:'2026-10-26',to:'2026-10-27',today:'2026-10-25'});
 const proposal={version:1,id:'sample_proposal_one',branch:'Maa',month:MONTH,from:context.from,to:context.to,reason:'Emergency shift cover for a sick colleague.',baseRevisionId:context.baseRevisionId,baseBranchFingerprint:context.baseBranchFingerprint,
  days:context.days.map(day=>({date:day.date,scheduled:[{shiftId:'morning',staffId:'staff_two'},{shiftId:'night',staffId:'staff_one'}],standbyStaffIds:[],offStaffIds:['staff_four']}))};
 const state={...h,actor:actor(UID),time:NOW,ip:'203.0.113.20',verifications:[],reads:[],commits:[],hooks:{},loseProposalAck:false};
 const service=createBranchScheduleProposals({now:()=>state.time,verifyToken:async(value,revoked)=>{state.verifications.push([value,revoked]);if(value!==TOKEN||state.revoked)throw Error('PRIVATE-AUTH-'+PIN);return clone(state.actor);},
  store:{async transaction(callback){let committed=[];const result=await h.api.runTransaction({},async raw=>{const writes=[];const result=await callback({async get(path){state.reads.push(path);await state.hooks.beforeRead?.(path);const snap=await raw.get({path,id:path.split('/').at(-1)});return snap.exists()?snap.data():null;},set(path,data){writes.push(path);raw.set({path,id:path.split('/').at(-1)},data);}});await state.hooks.beforeCommit?.(writes);committed=writes;return result;});if(committed.length)state.commits.push(committed);if(state.loseProposalAck&&committed.some(path=>path.startsWith('branch_schedule_proposals/'))){state.loseProposalAck=false;throw Error('PRIVATE-LOST-ACK-'+PIN);}return result;}}
 });
 state.body={staffId:'staff_one',pin:PIN,operationId:'sample_operation_one',proposal};state.view=view;
 state.request=(body=state.body,options={})=>service({method:'POST',path:'/submit',query:{},origin:PRODUCTION_ORIGINS[0],contentType:'application/json',authorization:'Bearer '+TOKEN,rawSize:Buffer.byteLength(JSON.stringify(body)),body:clone(body),trustedIP:state.ip,...options});
 state.proposalWrites=()=>state.commits.flat().filter(path=>path.startsWith('branch_schedule_proposals/'));
 state.settingSnapshot=()=>JSON.stringify([...state.docs].filter(([path])=>path.startsWith('settings/')));
 return state;
}
async function accepted(f=fixture()){const result=await f.request();assert.equal(result.status,200,JSON.stringify(result.body));return {f,result,row:f.get('branch_schedule_proposals/'+f.body.proposal.id)};}

test('approved POS staff may submit a reviewed assignment proposal without changing any canonical setting',async()=>{
 const f=fixture(),before=f.settingSnapshot(),{row,result}=await accepted(f);
 assert.deepEqual(Object.keys(result.body).sort(),['id','status','submittedAt','submittedBy']);assert.equal(result.body.status,'Pending');
 assert.deepEqual(row.proposal,f.body.proposal);assert.equal(row.submittedBy.staffId,'staff_one');assert.equal(row.submittedBy.uid,UID);assert.equal(row.submittedBy.deviceId,'DEV-SAMPLE-TABLET');
 assert.equal(f.settingSnapshot(),before);assert.equal(f.proposalWrites().length,1);assert.ok(f.commits.flat().every(path=>/^(branch_schedule_proposal_attempts|branch_schedule_proposals|branch_schedule_proposal_operations)\//.test(path)));
 assert.ok(f.verifications.every(([value,revoked])=>value===TOKEN&&revoked===true));
});

test('submission uses legacyDeviceDocId, never a guessed deviceId document path',async()=>{
 const f=fixture();f.put('pos_devices/DEV-SAMPLE-TABLET',{status:'Blocked',branch:'Maa',deviceId:'WRONG'});await accepted(f);
 assert.ok(f.reads.includes('pos_devices/fleet_auto_document'));assert.equal(f.reads.includes('pos_devices/DEV-SAMPLE-TABLET'),false);
});

test('immutable history snapshots contain only names, staff IDs, branch and dated HQ shift times',async()=>{
 const {f,row}=await accepted();assert.deepEqual(row.staffSnapshot.map(p=>p.staffId).sort(),['staff_four','staff_one','staff_two']);
 for(const person of row.staffSnapshot)assert.deepEqual(Object.keys(person).sort(),['branch','name','scheduleName','staffId']);
 assert.deepEqual(row.shiftSnapshot,[...f.body.proposal.days].map(day=>({date:day.date,shifts:[{id:'morning',name:'Morning 1',startTime:'09:00',endTime:'17:30'},{id:'night',name:'Night',startTime:'17:30',endTime:'02:00'}]})));
 assert.equal(JSON.stringify([...f.docs].filter(([path])=>path.startsWith('branch_schedule_'))).includes(PIN),false);
 const saved=clone(row);f.put('cashiers/staff_two',{...staffRows.staff_two,cashierName:'Renamed Later',status:'Resigned',active:false});assert.deepEqual(f.get('branch_schedule_proposals/'+row.proposal.id),saved);
});

test('any active staff member on the approved branch may identify themselves with their own PIN',async()=>{
 const f=fixture();const result=await f.request({...f.body,staffId:'staff_two',pin:staffRows.staff_two.pin});assert.equal(result.status,200);assert.equal(result.body.submittedBy.staffId,'staff_two');assert.equal(result.body.submittedBy.staffName,'Sample Beta');
});

for(const [name,mutate]of Object.entries({
 'wrong anonymous UID':f=>{f.actor=actor('unapproved_uid');},
 'binding uid mismatch':f=>f.put('pos_bindings/'+UID,{...f.get('pos_bindings/'+UID),uid:'another_uid'}),
 'pending binding':f=>f.put('pos_bindings/'+UID,{...f.get('pos_bindings/'+UID),status:'Pending'}),
 'blocked binding':f=>f.put('pos_bindings/'+UID,{...f.get('pos_bindings/'+UID),status:'Blocked'}),
 'missing binding':f=>f.put('pos_bindings/'+UID,null),
 'revoked staff PIN':f=>f.put('cashiers/staff_one',{...baseStaff,pin:'REVOKED'}),
 'inactive staff':f=>f.put('cashiers/staff_one',{...baseStaff,active:false}),
 'resigned staff':f=>f.put('cashiers/staff_one',{...baseStaff,status:'Resigned'}),
 'archived staff':f=>f.put('cashiers/staff_one',{...baseStaff,archived:true}),
 'blocked staff':f=>f.put('cashiers/staff_one',{...baseStaff,blocked:true}),
 'foreign staff branch':f=>f.put('cashiers/staff_one',{...baseStaff,branch:'Citygate'}),
 'nonstaff account role':f=>f.put('cashiers/staff_one',{...baseStaff,role:'Owner'}),
 'blocked fleet mirror':f=>f.put('pos_devices/fleet_auto_document',{...f.get('pos_devices/fleet_auto_document'),status:'Blocked'}),
 'missing fleet mirror':f=>f.put('pos_devices/fleet_auto_document',null),
 'foreign fleet branch':f=>f.put('pos_devices/fleet_auto_document',{...f.get('pos_devices/fleet_auto_document'),branch:'Citygate'}),
 'different fleet device':f=>f.put('pos_devices/fleet_auto_document',{...f.get('pos_devices/fleet_auto_document'),deviceId:'DEV-OTHER'}),
 'Staff app device':f=>f.put('pos_devices/fleet_auto_document',{...f.get('pos_devices/fleet_auto_document'),appType:'Staff'}),
 'wrong PIN':f=>{f.body.pin='WRONG-PIN';}
}))test(`${name} cannot submit a proposal`,async()=>{
 const f=fixture(),before=f.settingSnapshot();mutate(f);const result=await f.request();assert.equal(result.status,403,JSON.stringify(result.body));assert.equal(result.body.code,'staff-unavailable');assert.equal(f.proposalWrites().length,0);assert.equal(f.settingSnapshot(),before);assert.equal(JSON.stringify(result).includes(PIN),false);
});

test('revoked Firebase tokens and nonanonymous auth cannot reach private profile/PIN reads',async()=>{
 for(const variant of ['revoked','google','missing-uid']){const f=fixture();if(variant==='revoked')f.revoked=true;else if(variant==='google')f.actor.firebase.sign_in_provider='google.com';else delete f.actor.uid;
 const result=await f.request();assert.equal(result.status,variant==='revoked'?401:403);assert.equal(f.reads.length,0);assert.equal(JSON.stringify(result).includes(PIN),false);}
});

test('numeric legacy PINs remain compatible without saving or echoing the submitted PIN',async()=>{
 const f=fixture();f.put('cashiers/staff_one',{...baseStaff,pin:4815});const result=await f.request({...f.body,pin:'004815'});assert.equal(result.status,200);assert.equal(JSON.stringify(result).includes('004815'),false);
});

for(const [name,mutate]of Object.entries({
 'forged proposer':body=>{body.submittedBy={uid:'hq_uid',staffName:'Owner'};},
 'forged approval':body=>{body.proposal.status='Approved';},
 'other branch field':body=>{body.proposal.branch='Citygate';},
 'changed shift ID':body=>{body.proposal.days[0].scheduled[0].shiftId='new_shift';},
 'changed shift time':body=>{body.proposal.days[0].scheduled[0].endTime='12:00';},
 'foreign staff assignment':body=>{body.proposal.days[0].scheduled[0].staffId='staff_three';},
 'unknown staff assignment':body=>{body.proposal.days[0].scheduled[0].staffId='missing_staff';},
 'duplicated staff assignment':body=>{body.proposal.days[0].scheduled[1].staffId='staff_two';},
 'dropped saved staff':body=>{body.proposal.days[0].offStaffIds=[];},
 'forged source revision':body=>{body.proposal.baseRevisionId='different_revision';},
 'forged source fingerprint':body=>{body.proposal.baseBranchFingerprint='forged';},
 'missing proposal date':body=>{body.proposal.days.pop();},
 'inverted dates':body=>{body.proposal.from='2026-10-28';},
 'past date':body=>{body.proposal.from='2026-10-24';},
 'cross-month range':body=>{body.proposal.to='2026-11-01';}
}))test(`${name} cannot change canonical schedules or create a proposal`,async()=>{
 const f=fixture(),before=f.settingSnapshot(),body=clone(f.body);mutate(body);const result=await f.request(body);assert.ok([400,403,409].includes(result.status),JSON.stringify(result.body));assert.equal(f.proposalWrites().length,0);assert.equal(f.settingSnapshot(),before);
});

test('a fresh source edit rejects a stale proposal fingerprint',async()=>{
 const f=fixture(),path='settings/schedule_revision_sample_base_revision',revision=clone(f.get(path));revision.snapshot.branchConfig.Maa[0].endTime='18:00';f.put(path,revision);
 const result=await f.request();assert.equal(result.status,409);assert.equal(result.body.code,'schedule-changed');assert.equal(f.proposalWrites().length,0);
});

test('a source edit during submission retries atomically and cannot commit a stale proposal',async()=>{
 const f=fixture();let changed=false;f.hooks.beforeCommit=writes=>{if(!changed&&writes.includes('branch_schedule_proposals/'+f.body.proposal.id)){changed=true;const path='settings/schedule_revision_sample_base_revision',revision=clone(f.get(path));revision.snapshot.branchConfig.Maa[0].endTime='18:00';f.put(path,revision);}};
 const result=await f.request();assert.equal(result.status,409);assert.ok(f.retries()>0);assert.equal(f.proposalWrites().length,0);assert.equal(f.get('branch_schedule_proposals/'+f.body.proposal.id),undefined);
});

test('lost acknowledgment retry uses the same immutable proposal without duplicate writes',async()=>{
 const f=fixture();f.loseProposalAck=true;const first=await f.request();assert.equal(first.status,503);const saved=clone(f.get('branch_schedule_proposals/'+f.body.proposal.id));assert.ok(saved);
 const retry=await f.request();assert.equal(retry.status,200);assert.equal(retry.body.status,'Pending');assert.equal(f.proposalWrites().length,1);assert.deepEqual(f.get('branch_schedule_proposals/'+f.body.proposal.id),saved);
 assert.equal(JSON.stringify(first).includes(PIN),false);assert.equal(JSON.stringify([...f.docs].filter(([path])=>path.startsWith('branch_schedule_'))).includes(PIN),false);
});

test('concurrent duplicate submissions converge on one immutable proposal',async()=>{
 const f=fixture(),[a,b]=await Promise.all([f.request(),f.request()]);assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.body,b.body);assert.equal(f.proposalWrites().length,1);assert.ok(f.retries()>0);
});

test('same operation or proposal ID cannot be reused for altered contents or another proposer',async()=>{
 const {f}=await accepted();for(const body of [{...f.body,proposal:{...f.body.proposal,reason:'A different reason.'}},{...f.body,staffId:'staff_two',pin:staffRows.staff_two.pin},{...f.body,proposal:{...f.body.proposal,id:'different_proposal'}}]){const result=await f.request(body);assert.equal(result.status,409);}
 assert.equal(f.proposalWrites().length,1);
});

test('a new operation acknowledging an existing proposal is reserved against later altered reuse',async()=>{
 const {f}=await accepted(),body={...f.body,operationId:'sample_operation_retry_new'};assert.equal((await f.request(body)).status,200);
 const operation=f.get('branch_schedule_proposal_operations/'+digest(UID+'|'+body.operationId));assert.equal(operation.proposalId,f.body.proposal.id);
 assert.equal((await f.request({...body,proposal:{...body.proposal,id:'new_proposal_for_reused_operation'}})).status,409);assert.equal(f.proposalWrites().length,1);
});

test('operation replay still requires the current PIN, active account and approved tablet',async()=>{
 for(const variant of ['pin','staff','tablet']){const {f}=await accepted();if(variant==='pin')f.body.pin='WRONG';else if(variant==='staff')f.put('cashiers/staff_one',{...baseStaff,status:'Resigned'});else f.put('pos_bindings/'+UID,{...f.get('pos_bindings/'+UID),status:'Blocked'});assert.equal((await f.request()).status,403);assert.equal(f.proposalWrites().length,1);}
});

test('a historical approval status may be read by replay but submission service never applies it or saves settings',async()=>{
 const {f,row}=await accepted(),path='branch_schedule_proposals/'+row.proposal.id,before=f.settingSnapshot();f.put(path,{...row,status:'Approved',reviewedAt:'2026-10-29T00:00:00Z',reviewedByUid:'sample_hq',reviewedByEmail:'sample-hq@example.invalid',reviewNote:'Sample decision',revisionId:'sample_review_revision'});f.time=Date.parse('2026-10-29T04:00:00Z');
 const result=await f.request();assert.equal(result.status,200);assert.equal(result.body.status,'Approved');assert.equal(f.settingSnapshot(),before);assert.equal(f.proposalWrites().length,1);
});

test('private operation tampering is detected and cannot overwrite the saved proposal',async()=>{
 const {f,row}=await accepted(),path='branch_schedule_proposal_operations/'+digest(UID+'|'+f.body.operationId),before=clone(row);f.put(path,{...f.get(path),uid:'someone_else'});
 assert.equal((await f.request()).status,409);assert.deepEqual(f.get('branch_schedule_proposals/'+row.proposal.id),before);assert.equal(f.proposalWrites().length,1);
});

test('UID rate limiting stops attempts before profile/PIN reads and resets in the next trusted time window',async()=>{
 const f=fixture();f.body.pin='WRONG';for(let i=0;i<12;i++)assert.equal((await f.request()).status,403);const reads=f.reads.filter(path=>path.startsWith('cashiers/')).length;
 assert.equal((await f.request()).status,429);assert.equal(f.reads.filter(path=>path.startsWith('cashiers/')).length,reads);f.time+=900000;assert.equal((await f.request()).status,403);
});

test('peer and global limits cannot be bypassed by changing anonymous UID or the supplied client IP header',async()=>{
 for(const [kind,limit]of [['peer',80],['global',500]]){const f=fixture();f.body.pin='WRONG';for(let i=0;i<limit;i++){f.actor=actor('sample_uid_'+i);if(kind==='global')f.ip='203.0.113.'+i;assert.equal((await f.request(f.body,{forwardedFor:'spoofed-client-'+i})).status,403);}
 const reads=f.reads.filter(path=>path.startsWith('cashiers/')).length;f.actor=actor('sample_uid_exhausted');if(kind==='global')f.ip='new-peer';assert.equal((await f.request()).status,429);assert.equal(f.reads.filter(path=>path.startsWith('cashiers/')).length,reads);}
});

test('malformed rate state fails closed without reading staff or creating proposals',async()=>{
 const f=fixture(),window=Math.floor(NOW/900000);f.put('branch_schedule_proposal_attempts/'+digest('uid|'+UID+'|'+window),{count:-1});assert.equal((await f.request()).status,503);assert.equal(f.reads.some(path=>path.startsWith('cashiers/')),false);assert.equal(f.proposalWrites().length,0);
});

test('CORS, token syntax, route, JSON size and exact request fields fail before private reads',async()=>{
 for(const options of [{origin:'https://attacker.example'},{origin:undefined},{method:'GET'},{path:'/approve'},{query:{branch:'Maa'}},{authorization:undefined},{authorization:'Bearer short'},{contentType:'text/plain'},{rawSize:MAX_REQUEST_BYTES+1}]){const f=fixture(),result=await f.request(f.body,options);assert.ok([400,401,403,404,413].includes(result.status));assert.equal(f.reads.length,0);assert.equal(result.headers['Cache-Control'],'no-store');if(options.origin!==undefined)assert.equal(result.headers['Access-Control-Allow-Origin'],options.origin===PRODUCTION_ORIGINS[0]?options.origin:undefined);}
 for(const mutate of [body=>{body.extra=true;},body=>{delete body.pin;},body=>{body.staffId='../other';},body=>{body.proposal.days=[null];},body=>{body.proposal.days[0].scheduled='forged';},body=>{body.proposal.days[0].scheduled=new Array(121).fill(null);},body=>{body.proposal.reason='x'.repeat(MAX_REQUEST_BYTES);}]){const f=fixture(),body=clone(f.body);mutate(body);const result=await f.request(body);assert.ok([400,413].includes(result.status));assert.equal(f.reads.length,0);assert.equal(f.verifications.length,0);}
});

test('only the exact approved Cashier origin receives a bounded POST preflight response',async()=>{
 const f=fixture(),good=await f.request({}, {method:'OPTIONS',preflightMethod:'POST',preflightHeaders:'authorization, content-type',authorization:undefined});assert.equal(good.status,204);assert.equal(good.body,null);assert.equal(good.headers['Access-Control-Allow-Origin'],PRODUCTION_ORIGINS[0]);assert.equal(good.headers['Access-Control-Allow-Methods'],'POST');
 for(const options of [{preflightMethod:'DELETE'},{preflightMethod:'POST',preflightHeaders:'x-forwarded-for'},{origin:'https://takodeal-owner.vercel.app',preflightMethod:'POST'}])assert.equal((await f.request({}, {method:'OPTIONS',...options})).status,403);
 assert.equal(f.verifications.length,0);assert.equal(f.reads.length,0);
});

test('function copies match the reviewed pure browser dependencies exactly',()=>{
 for(const name of ['schedule-sync.js','schedule-history.js','shift-amendments.js','schedule-proposal-model.js'])assert.equal(readFileSync(new URL('../functions/branch-schedule-proposals/'+name,import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/'+name,import.meta.url),'utf8'),name);
});

test('actual cloud adapter pins dedicated runtime, revoked checks, trusted socket peer and exact transactional reads',async()=>{
 const source=readFileSync(new URL('../functions/branch-schedule-proposals/index.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const ','const ');
 let options,handler,deps,requestData,verified;const reads=[],writes=[];const app={name:'branch-schedule-proposals'};
 const raw={get:async ref=>{reads.push(ref);return {exists:true,data:()=>({path:ref})};},set:(...args)=>writes.push(args)};
 const exported=vm.runInNewContext(source+'\nbranchScheduleProposals;',{
  getApps:()=>[],initializeApp:(config,name)=>{assert.equal(config.projectId,'takodeal-pos');assert.equal(name,app.name);return app;},getAuth:passed=>{assert.equal(passed,app);return{verifyIdToken:(token,revoked)=>{verified=[token,revoked];return{};}};},
  getFirestore:passed=>{assert.equal(passed,app);return{doc:path=>path,runTransaction:fn=>fn(raw)};},
  createBranchScheduleProposals:config=>{deps=config;return async request=>{requestData=request;return{status:200,headers:{'Cache-Control':'no-store'},body:{status:'Pending'}};};},
  onRequest:(config,fn)=>{options=config;handler=fn;return fn;}});
 assert.equal(exported,handler);assert.equal(options.serviceAccount,'branch-schedule-proposals@takodeal-pos.iam.gserviceaccount.com');assert.equal(options.region,'asia-southeast1');assert.equal(options.memory,'256MiB');assert.equal(options.cpu,1);assert.equal(options.concurrency,4);assert.equal(options.maxInstances,2);assert.equal(options.minInstances,0);assert.equal(options.timeoutSeconds,60);assert.equal(options.cors,false);
 await deps.verifyToken('sample-token',true);assert.deepEqual(verified,['sample-token',true]);
 await deps.store.transaction(async tx=>{const a=tx.get('settings/sample'),b=tx.get('settings/sample');assert.equal(a,b);assert.equal((await a).path,'settings/sample');tx.set('branch_schedule_proposals/sample',{});await assert.rejects(async()=>tx.get('settings/after-write'));});assert.deepEqual(reads,['settings/sample']);assert.equal(writes[0][0],'branch_schedule_proposals/sample');
 await assert.rejects(deps.store.transaction(async tx=>{for(let i=0;i<501;i++)await tx.get('settings/sample-'+i);}),/history review/);
 const response={status(code){assert.equal(code,200);return this;},set(headers){assert.equal(headers['Cache-Control'],'no-store');return this;},json(body){assert.equal(body.status,'Pending');},end(){assert.fail('JSON response expected');}};
 await handler({method:'POST',path:'/submit',query:{},rawBody:Buffer.from('{}'),body:{},socket:{remoteAddress:'trusted-socket-peer'},get:name=>({'Origin':PRODUCTION_ORIGINS[0],'Authorization':'Bearer token','Content-Type':'application/json','X-Forwarded-For':'spoofed-client'}[name])},response);
 assert.equal(requestData.trustedIP,'trusted-socket-peer');assert.equal(requestData.rawSize,2);
});
