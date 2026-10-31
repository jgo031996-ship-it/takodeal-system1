import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonthlyScheduleController,readMonthlyScheduleEvidence} from '../takodeal-manager/monthly-schedule-integration.js';
import {buildMonthlySchedulePlan} from '../takodeal-manager/monthly-schedule-model.js';
import {toScheduleEmployee} from '../takodeal-manager/schedule-staff-directory.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ReviewDocument} from './helpers/review-dom.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const person=(id='staff-a',name='Ann')=>toScheduleEmployee({cashierName:'Sample '+name,scheduleNickname:name,branch:'Maa',active:true},id);
const evidence=()=>({staffProfiles:[person()],approvedLeaves:[],sanctions:[]});
const day=(scheduled={})=>({scheduled,rest:[],unavailable:[],swaps:{}});
function saved(){return {currentYear:2026,currentMonth:11,branchConfig:{Maa:[{id:'morning-1',name:'Morning 1',active:true,days:[0,1,2,3,4,5,6],startTime:'09:00',endTime:'17:30'}],Cabantian:[{id:'morning-2',name:'Morning 2',active:true,days:[0,1,2,3,4,5,6],startTime:'10:00',endTime:'18:30'}]},employees:[person()],currentSchedule:{1:{Maa:day({'morning-1':'Ann'}),Cabantian:day({'morning-2':'Saved other branch'})}},unavailability:{},holidays:{}};}
function snapshot(rows,extra={}){return {docs:rows.map(row=>({id:row.id,data:()=>row,metadata:{fromCache:false,hasPendingWrites:false}})),metadata:{fromCache:false,hasPendingWrites:false},...extra};}
function fixture(options={}){
 const calls={reads:[],applied:[],dirty:0,backups:0,uiOpen:0,uiClose:0,notices:[],businessWrites:0};
 const state={snapshot:saved(),month:'2026-11',branch:'Maa',effectiveFrom:'2026-11-01',loaded:true,saving:false,baselineMonth:'2026-11',evidence:evidence(),allow:true};
 const button={disabled:false,textContent:'Create Monthly Schedule'};let hooks;
 const forbidden=()=>{calls.businessWrites++;assert.fail('Monthly preparation must not write to a business collection or save HQ.');};
 const w={db:{},auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All'],role:'Owner'},scheduleMemoryReadOnly:false,scheduleDirectoryProfiles:[person()],isBranchAllowed:()=>state.allow,ManagerUI:{notify:message=>calls.notices.push(message)},saveToCloud:forbidden,saveManualSchedule:forbidden,runTransaction:forbidden,setDoc:forbidden,updateDoc:forbidden,deleteDoc:forbidden,
  collection:(_db,table)=>({table}),where:(field,op,value)=>({field,op,value}),query:(ref,...filters)=>({...ref,filters}),getDocsFromServer:async ref=>options.defaultRead?.(ref)||snapshot(ref.table==='cashiers'?[{id:'staff-a',cashierName:'Sample Ann',scheduleNickname:'Ann',branch:'Maa',active:true}]:[])};
 const sync={isLoaded:()=>state.loaded,isSaving:()=>state.saving,baseline:()=>({month:state.baselineMonth}),markDirty:()=>calls.dirty++,preserveDraft:async()=>{calls.backups++;if(options.backupThrows)throw Error('Synthetic backup failure');return options.backupConfirmed!==false;}};
 const readEvidence=async captured=>{calls.reads.push(copy(captured));return options.readEvidence?options.readEvidence(captured,calls.reads.length):copy(state.evidence);};
 const controller=createMonthlyScheduleController(w,{getElementById:id=>id==='btnCreateMonthlySchedule'?button:null},{getSnapshot:()=>state.snapshot,captureEditor:()=>copy(state.snapshot),applySnapshot:async value=>{calls.applied.push(copy(value));state.snapshot=copy(value);if(options.apply)await options.apply(value);},getBranch:()=>state.branch,getMonth:()=>state.month,getEffectiveFrom:()=>state.effectiveFrom,getSync:()=>sync,now:()=>new Date('2026-10-30T04:00:00Z'),timeoutMs:options.timeoutMs||25000,installUI:(_w,_d,value)=>{hooks=value;return {open(){calls.uiOpen++;return {sampleDialog:true};},close(){calls.uiClose++;}};},...(options.useDefaultRead?{}:{readEvidence})});
 return {controller,state,w,sync,calls,button,get hooks(){return hooks;},proposal(mode='prepare'){const captured=hooks.getContext();return {captured,plan:buildMonthlySchedulePlan({...captured,mode})};}};
}

test('opening and cancelling only reads fresh evidence and never mutates the editor or saves HQ',async()=>{
 const f=fixture(),before=copy(f.state.snapshot),directory=copy(f.w.scheduleDirectoryProfiles);assert.deepEqual(await f.controller.open(),{sampleDialog:true});assert.equal(f.calls.reads.length,1);assert.equal(f.calls.uiOpen,1);assert.deepEqual(f.state.snapshot,before);assert.deepEqual(f.w.scheduleDirectoryProfiles,directory);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.dirty,0);assert.equal(f.calls.backups,0);f.controller.close();assert.equal(f.calls.uiClose,1);assert.deepEqual(f.state.snapshot,before);assert.equal(f.calls.businessWrites,0);
});
test('explicit confirmation rechecks fresh records and applies only the reviewed local draft, never an HQ save',async()=>{
 const f=fixture();await f.controller.open();const before=copy(f.state.snapshot),{captured,plan}=f.proposal();const result=await f.hooks.commit(plan,captured);assert.deepEqual(result,{prepared:true,backupConfirmed:true});assert.equal(f.calls.reads.length,2);assert.equal(f.calls.applied.length,1);assert.deepEqual(f.calls.applied[0],plan.snapshot);assert.equal(f.calls.dirty,1);assert.equal(f.calls.backups,1);assert.equal(f.calls.businessWrites,0);assert.deepEqual(f.state.snapshot.currentSchedule[1].Cabantian,before.currentSchedule[1].Cabantian);assert.equal(f.state.snapshot.currentSchedule[1].Maa.scheduled['morning-1'],'Ann');assert.equal(f.state.snapshot.currentSchedule[2].Maa.scheduled['morning-1'],'UNFILLED');
});
for(const backup of ['false','throws'])test('an unconfirmed '+backup+' recovery backup is reported separately from a prepared draft and never claims an HQ save',async()=>{
 const f=fixture({backupConfirmed:backup!=='false',backupThrows:backup==='throws'});await f.controller.open();const {captured,plan}=f.proposal();assert.deepEqual(await f.hooks.commit(plan,captured),{prepared:true,backupConfirmed:false});assert.equal(f.calls.applied.length,1);assert.equal(f.calls.businessWrites,0);assert.equal(f.calls.dirty,1);assert.equal(f.controller.isApplying(),false);
});
for(const changed of ['branch','month','actor','effective date','snapshot','read-only','permission','branch access','saving'])test('a '+changed+' change while final evidence is pending cannot apply an old proposal',async()=>{
 const pending=gate(),f=fixture({readEvidence:(_context,count)=>count===1?evidence():pending.promise});await f.controller.open();const {captured,plan}=f.proposal(),saving=f.hooks.commit(plan,captured);await tick();
 if(changed==='branch')f.state.branch='Cabantian';if(changed==='month'){f.state.month='2026-12';f.state.baselineMonth='2026-12';f.state.snapshot.currentMonth=12;f.state.effectiveFrom='2026-12-01';}if(changed==='actor')f.w.auth.currentUser.uid='different';if(changed==='effective date')f.state.effectiveFrom='2026-11-02';if(changed==='snapshot')f.state.snapshot.currentSchedule[1].Maa.rest.push('New local edit');if(changed==='read-only')f.w.scheduleMemoryReadOnly=true;if(changed==='permission')f.w.sessionUser.permissions=[];if(changed==='branch access')f.state.allow=false;if(changed==='saving')f.state.saving=true;
 const before=copy(f.state.snapshot);pending.resolve(evidence());await assert.rejects(saving);assert.deepEqual(f.state.snapshot,before);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.dirty,0);assert.equal(f.calls.businessWrites,0);assert.equal(f.controller.isApplying(),false);
});
for(const changed of ['staff','leave','suspension'])test('fresh '+changed+' changes reject the old review without applying it',async()=>{
 const f=fixture();await f.controller.open();const {captured,plan}=f.proposal('auto'),before=copy(f.state.snapshot);
 if(changed==='staff')f.state.evidence.staffProfiles[0].scheduleEligible=false;
 if(changed==='leave')f.state.evidence.approvedLeaves.push({id:'leave-1',type:'Leave',status:'Approved',staffId:'staff-a',staffName:'Sample Ann',branch:'Maa',startDate:'2026-11-01',endDate:'2026-11-01'});
 if(changed==='suspension')f.state.evidence.sanctions.push({id:'notice-1',staffId:'staff-a',staffName:'Sample Ann',branch:'Maa',status:'Replied',severity:'2 Days Suspension',effectiveDate:'2026-11-01'});
 await assert.rejects(f.hooks.commit(plan,captured),/changed/);assert.deepEqual(f.state.snapshot,before);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.businessWrites,0);
});
test('a modified plan cannot be substituted for the reviewed proposal even when the editor and evidence are unchanged',async()=>{
 const f=fixture();await f.controller.open();const {captured,plan}=f.proposal(),forged=copy(plan);forged.snapshot.currentSchedule[2].Maa.scheduled['morning-1']='Forged staff';await assert.rejects(f.hooks.commit(forged,captured),/proposal changed/);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.businessWrites,0);
});
test('duplicate final confirmations share no second read or local application while the first confirmation is pending',async()=>{
 const pending=gate(),f=fixture({readEvidence:(_context,count)=>count===1?evidence():pending.promise});await f.controller.open();const {captured,plan}=f.proposal(),saving=f.hooks.commit(plan,captured);await tick();await assert.rejects(f.hooks.commit(plan,captured),/already being prepared/);assert.equal(f.calls.reads.length,2);pending.resolve(evidence());assert.equal((await saving).prepared,true);assert.equal(f.calls.applied.length,1);assert.equal(f.calls.backups,1);
});
test('closing the reviewed UI during its final HQ check cancels local application without any HQ save',async()=>{
 const pending=gate(),f=fixture({readEvidence:(_context,count)=>count===1?evidence():pending.promise});await f.controller.open();const {captured,plan}=f.proposal();let current=true;const saving=f.hooks.commit(plan,captured,{isCurrent:()=>current});await tick();current=false;pending.resolve(evidence());await assert.rejects(saving);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.dirty,0);assert.equal(f.calls.backups,0);assert.equal(f.calls.businessWrites,0);
});
test('controller close invalidates a pending final check even if the caller omits a UI-current callback',async()=>{
 const pending=gate(),f=fixture({readEvidence:(_context,count)=>count===1?evidence():pending.promise});await f.controller.open();const {captured,plan}=f.proposal(),saving=f.hooks.commit(plan,captured);await tick();f.controller.close();pending.resolve(evidence());await assert.rejects(saving);assert.equal(f.calls.uiClose,1);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.dirty,0);assert.equal(f.calls.backups,0);assert.equal(f.calls.businessWrites,0);
});
test('an account switch during an injected asynchronous local apply cannot dirty or back up the new account editor',async()=>{
 const pending=gate(),f=fixture({apply:()=>pending.promise});await f.controller.open();const {captured,plan}=f.proposal(),saving=f.hooks.commit(plan,captured);await tick();assert.equal(f.calls.applied.length,1);f.w.auth.currentUser={uid:'new-account',email:'jgo031996@gmail.com',emailVerified:true};f.w.sessionUser={...f.w.sessionUser,uid:'new-account'};pending.resolve();assert.deepEqual(await saving,{prepared:true,backupConfirmed:false});assert.equal(f.calls.dirty,0);assert.equal(f.calls.backups,0);assert.equal(f.calls.businessWrites,0);assert.equal(f.controller.isApplying(),false);
});
test('a failed local apply restores the prior directory and never claims a prepared or saved draft',async()=>{
 const f=fixture({apply:async()=>{throw Error('Synthetic local apply failure');}});await f.controller.open();const oldDirectory=f.w.scheduleDirectoryProfiles,{captured,plan}=f.proposal();await assert.rejects(f.hooks.commit(plan,captured),/Synthetic local apply/);assert.equal(f.w.scheduleDirectoryProfiles,oldDirectory);assert.equal(f.calls.dirty,0);assert.equal(f.calls.backups,0);assert.equal(f.calls.businessWrites,0);assert.equal(f.controller.isApplying(),false);
});
test('a late failed apply from an old account cannot overwrite the new account directory',async()=>{
 const pending=gate(),f=fixture({apply:()=>pending.promise});await f.controller.open();const {captured,plan}=f.proposal(),saving=f.hooks.commit(plan,captured);await tick();assert.equal(f.calls.applied.length,1);f.w.auth.currentUser={uid:'new-account',email:'jgo031996@gmail.com',emailVerified:true};f.w.sessionUser={...f.w.sessionUser,uid:'new-account'};const newDirectory=[person('new-staff','New Account Staff')];f.w.scheduleDirectoryProfiles=newDirectory;pending.reject(Error('Synthetic old apply failure'));await assert.rejects(saving,/Synthetic old apply/);assert.equal(f.w.scheduleDirectoryProfiles,newDirectory);assert.equal(f.calls.dirty,0);assert.equal(f.calls.backups,0);assert.equal(f.calls.businessWrites,0);
});
for(const changed of ['branch','month','actor','effective date','snapshot'])test('opening rejects a stale '+changed+' after its initial fresh read without installing a dialog',async()=>{
 const pending=gate(),f=fixture({readEvidence:()=>pending.promise}),opening=f.controller.open();await tick();
 if(changed==='branch')f.state.branch='Cabantian';if(changed==='month'){f.state.month='2026-12';f.state.baselineMonth='2026-12';f.state.snapshot.currentMonth=12;f.state.effectiveFrom='2026-12-01';}if(changed==='actor')f.w.auth.currentUser.uid='other';if(changed==='effective date')f.state.effectiveFrom='2026-11-02';if(changed==='snapshot')f.state.snapshot.currentSchedule[1].Maa.rest.push('Fresh edit');
 pending.resolve(evidence());assert.equal(await opening,false);assert.equal(f.calls.uiOpen,0);assert.equal(f.calls.applied.length,0);assert.equal(f.button.disabled,false);assert.ok(f.calls.notices.length);assert.equal(f.calls.businessWrites,0);
});
for(const failure of ['failed','cached collection','pending collection','cached document','pending document'])test('the default '+failure+' evidence read refuses to open or prepare a draft',async()=>{
 const f=fixture({useDefaultRead:true,defaultRead:ref=>{if(ref.table!=='cashiers')return snapshot([]);if(failure==='failed')throw Error('Synthetic denied HQ read');const row=snapshot([{id:'staff-a',cashierName:'Sample Ann',scheduleNickname:'Ann',branch:'Maa'}]);if(failure==='cached collection')row.metadata.fromCache=true;if(failure==='pending collection')row.metadata.hasPendingWrites=true;if(failure==='cached document')row.docs[0].metadata.fromCache=true;if(failure==='pending document')row.docs[0].metadata.hasPendingWrites=true;return row;}});
 const before=copy(f.state.snapshot);assert.equal(await f.controller.open(),false);assert.equal(f.calls.uiOpen,0);assert.equal(f.calls.applied.length,0);assert.deepEqual(f.state.snapshot,before);assert.equal(f.calls.businessWrites,0);assert.equal(f.button.disabled,false);assert.ok(f.calls.notices.length);
});
test('default evidence returns only scheduling metadata with authoritative profile IDs and excludes unapproved leave',async()=>{
 const f=fixture({useDefaultRead:true,defaultRead:ref=>snapshot(ref.table==='cashiers'?[{id:'correct-document-id',staffId:'forged-stored-id',cashierName:'Sample Ann',scheduleNickname:'Ann',branch:'Maa',pin:'PRIVATE',salary:999,bank:'PRIVATE'}]:ref.table==='staff_requests'?[{id:'approved',type:'Leave',status:'Approved',staffId:'correct-document-id',startDate:'2026-11-01',endDate:'2026-11-01',signature:'PRIVATE'},{id:'pending',type:'Leave',status:'Pending'}]:[{id:'notice',staffId:'correct-document-id',status:'Replied',severity:'Warning',signature:'PRIVATE',staffReply:'PRIVATE'}])});
 const result=await readMonthlyScheduleEvidence(f.w);assert.equal(result.staffProfiles[0].staffId,'correct-document-id');for(const key of ['pin','salary','bank'])assert.equal(result.staffProfiles[0][key],undefined);assert.deepEqual(result.approvedLeaves.map(row=>row.id),['approved']);assert.equal(result.approvedLeaves[0].signature,undefined);assert.equal(result.sanctions[0].staffReply,undefined);assert.equal(result.sanctions[0].signature,undefined);assert.equal(f.calls.businessWrites,0);
});
test('initial HQ checks are deduplicated through a soft deadline until the physical read settles, then an explicit retry reads afresh',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const pending=gate(),f=fixture({timeoutMs:5,readEvidence:(_context,count)=>count===1?pending.promise:evidence()});const first=f.controller.open();assert.equal(f.controller.open(),first);await tick();assert.equal(f.calls.reads.length,1);t.mock.timers.tick(5);assert.equal(await first,false);assert.equal(await f.controller.open(),false);assert.equal(f.calls.reads.length,1);assert.equal(f.calls.uiOpen,0);pending.resolve(evidence());await tick();assert.deepEqual(await f.controller.open(),{sampleDialog:true});assert.equal(f.calls.reads.length,2);assert.equal(f.calls.uiOpen,1);assert.equal(f.calls.businessWrites,0);
});
test('a timed-out physical read is never shared with a different account scope or allowed to open an old account dialog',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const pending=gate(),f=fixture({timeoutMs:5,readEvidence:(_context,count)=>count===1?pending.promise:evidence()}),first=f.controller.open();await tick();t.mock.timers.tick(5);assert.equal(await first,false);f.w.auth.currentUser={uid:'owner-2',email:'jgo031996@gmail.com',emailVerified:true};f.w.sessionUser={...f.w.sessionUser,uid:'owner-2'};assert.equal(await f.controller.open(),false);assert.match(f.calls.notices.at(-1),/Another month check/);assert.equal(f.calls.reads.length,1);pending.resolve(evidence());await tick();assert.equal(f.calls.uiOpen,0);await f.controller.open();assert.equal(f.calls.reads.length,2);assert.notEqual(f.calls.reads[0].actorKey,f.calls.reads[1].actorKey);assert.equal(f.calls.uiOpen,1);assert.equal(f.calls.businessWrites,0);
});
for(const blocked of ['not loaded','wrong baseline','saving','read only','denied branch','past month'])test(blocked+' prevents even starting an HQ evidence read',async()=>{
 const f=fixture();if(blocked==='not loaded')f.state.loaded=false;if(blocked==='wrong baseline')f.state.baselineMonth='2026-10';if(blocked==='saving')f.state.saving=true;if(blocked==='read only')f.w.scheduleMemoryReadOnly=true;if(blocked==='denied branch')f.state.allow=false;if(blocked==='past month'){f.state.month='2026-09';f.state.baselineMonth='2026-09';f.state.snapshot.currentMonth=9;f.state.effectiveFrom='2026-09-01';}assert.equal(await f.controller.open(),false);assert.equal(f.calls.reads.length,0);assert.equal(f.calls.uiOpen,0);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.businessWrites,0);
});

const managerSource=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function actualManagerFunction(name){const start=managerSource.indexOf('window.'+name+' = ');assert.notEqual(start,-1,'actual main.js exposes '+name);const end=managerSource.indexOf('\n};',start);assert.notEqual(end,-1,'actual '+name+' has a complete function boundary');return managerSource.slice(start,end+4);}
test('the actual visible Create Monthly Schedule button and legacy generator route the selected editor to the same draft-only controller',async()=>{
 const html=readFileSync(new URL('../takodeal-manager/index.html',import.meta.url),'utf8'),markup=html.match(/<button\b[^>]*id="btnCreateMonthlySchedule"[^>]*>[\s\S]*?<\/button>/)?.[0];assert.ok(markup);assert.match(markup,/>Create Monthly Schedule<\/button>/);assert.doesNotMatch(markup,/\bhidden\b|display\s*:\s*none|\bdisabled\b/);
 const document=new ReviewDocument(),host=document.createElement('div');document.body.append(host);host.innerHTML=markup;const button=document.getElementById('btnCreateMonthlySchedule'),month={value:'2026-11'},calls={factory:0,opened:0,captured:0,saves:0},editor=saved(),sync={draftOnly:true};let options;
 const w={getScheduleMemorySnapshot:()=>editor,applyScheduleMemorySnapshot:()=>assert.fail('Opening must not apply a draft'),captureTempShiftConfig:()=>calls.captured++,getOwnerScheduleSync:()=>sync,saveToCloud:()=>{calls.saves++;assert.fail('Opening must not save HQ');}};
 const context=vm.createContext({window:w,document:{getElementById:id=>id==='monthSelector'?month:null},currentActiveTab:'Maa',scheduleMemoryUI:{effectiveFrom:()=> '2026-11-01'},createMonthlyScheduleController:(api,doc,configuration)=>{assert.equal(api,w);assert.ok(doc);calls.factory++;options=configuration;return {open(){calls.opened++;return 'fiction-draft-review';}};}});
 vm.runInContext(actualManagerFunction('openMonthlySchedule')+'\n'+actualManagerFunction('generateSchedule'),context);assert.equal(vm.runInContext(button.attributes.onclick,context),'fiction-draft-review');assert.equal(options.getBranch(),'Maa');assert.equal(options.getMonth(),'2026-11');assert.equal(options.getEffectiveFrom(),'2026-11-01');assert.equal(options.captureEditor(),editor);assert.equal(calls.captured,1);assert.equal(options.getSync(),sync);assert.equal(await w.generateSchedule(),'fiction-draft-review');assert.equal(calls.factory,1);assert.equal(calls.opened,2);assert.equal(calls.saves,0);
});
function actualRoster({year=2026,month=11,weekday=true,readOnly=false}={}){
 const document=new ReviewDocument(),container=document.createElement('div');container.id='scheduleContainer';document.body.append(container);const sourceDay={scheduled:{},rest:[],unavailable:[],swaps:{}},schedule={1:{Maa:sourceDay}},before=copy(schedule),calls={opened:0,saves:0};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00+08:00']));}static now(){return +new Date('2026-10-30T12:00:00+08:00');}}
 const rules={Maa:[{id:'morning-1',name:'Morning 1',active:true,days:weekday?[0,1,2,3,4,5,6]:[],startTime:'09:00',endTime:'17:30'},{id:'disabled',name:'Disabled shift',active:false,days:[0,1,2,3,4,5,6],startTime:'10:00',endTime:'18:30'}]},w={scheduleMemoryReadOnly:readOnly,isBranchAllowed:()=>true,employees:[],openMonthlySchedule:()=>calls.opened++,saveToCloud:()=>{calls.saves++;assert.fail('Rendering or opening a planner cannot save HQ');}};
 const context=vm.createContext({window:w,document,currentSchedule:schedule,branchConfig:rules,currentActiveTab:'Maa',currentYear:year,currentMonth:month,Date:FixedDate,scheduleShiftHours:()=> '9:00 AM – 5:30 PM',enhanceScheduleLayout:()=>{}});vm.runInContext(actualManagerFunction('renderTables'),context);w.renderTables();const html=document.getElementById('content-Maa').innerHTML;assert.deepEqual(schedule,before);return {w,context,html,calls};
}
test('actual blank active future roster cells open the planner for review without assigning or saving',()=>{const f=actualRoster();assert.match(f.html,/>Prepare roster<\/span>/);assert.doesNotMatch(f.html,/Disabled shift/);const action=/onclick="([^"]+)"[^>]*>Prepare roster<\/span>/.exec(f.html)?.[1];assert.equal(action,'window.openMonthlySchedule()');vm.runInContext(action,f.context);assert.equal(f.calls.opened,1);assert.equal(f.calls.saves,0);});
test('actual blank past, disabled-weekday and saved-history roster cells expose no monthly creation action',()=>{for(const options of [{year:2026,month:10},{weekday:false},{readOnly:true}]){const f=actualRoster(options);assert.doesNotMatch(f.html,/Prepare roster|window\.openMonthlySchedule\(\)/);assert.match(f.html,options.weekday===false?/No shift this weekday/:/Not assigned/);assert.equal(f.calls.opened,0);assert.equal(f.calls.saves,0);}});

for(const state of ['Rejected','missing'])test('a stale marker source becoming active after review invalidates the proposal: '+state,async()=>{
 const f=fixture(),marker={name:'Ann',status:'Leave',staffId:'staff-a',leaveRequestId:'synthetic-source'};f.state.snapshot.currentSchedule[2]={Maa:{...day(),unavailable:[marker]}};
 f.state.evidence.leaveSources=[{id:'synthetic-source',record:state==='missing'?null:{type:'Leave',status:state,staffId:'staff-a',staffName:'Sample Ann'}}];
 await f.controller.open();const {captured,plan}=f.proposal(),before=copy(f.state.snapshot);assert.equal(plan.releasedLeaveMarkers.length,1);
 f.state.evidence.leaveSources[0].record={type:'Leave',status:'Approved',staffId:'staff-a',staffName:'Sample Ann',startDate:'2026-11-02',endDate:'2026-11-02'};
 await assert.rejects(f.hooks.commit(plan,captured),/changed/);assert.deepEqual(f.state.snapshot,before);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.businessWrites,0);
});
test('default evidence confirms exact linked source IDs freshly, including rejected and deleted requests, without reading private fields',async()=>{
 const f=fixture({useDefaultRead:true}),marker={name:'Ann',status:'Leave',staffId:'staff-a',leaveRequestId:'rejected-source'},reads=[];
 f.state.snapshot.currentSchedule[2]={Maa:{...day(),unavailable:[marker,{...marker,leaveRequestId:'missing-source'}]}};
 f.w.doc=(_db,table,id)=>({table,id});f.w.getDocFromServer=async ref=>{reads.push(ref);return {exists:()=>ref.id!=='missing-source',data:()=>({type:'Leave',status:'Rejected',staffId:'staff-a',staffName:'Sample Ann',reason:'PRIVATE'}),metadata:{fromCache:false,hasPendingWrites:false}};};
 const result=await readMonthlyScheduleEvidence(f.w,{snapshot:f.state.snapshot,branch:'Maa',month:'2026-11',effectiveFrom:'2026-11-01'});
 assert.deepEqual(reads.map(row=>row.id),['missing-source','rejected-source']);assert.equal(result.leaveSources.find(row=>row.id==='missing-source').record,null);assert.equal(result.leaveSources.find(row=>row.id==='rejected-source').record.reason,undefined);assert.equal(f.calls.businessWrites,0);
 f.w.getDocFromServer=async()=>({exists:()=>false,metadata:{fromCache:true}});assert.equal(await f.controller.open(),false);assert.equal(f.calls.uiOpen,0);assert.equal(f.calls.applied.length,0);
});

for(const result of ['saved','failed','closed','changed'])test('calendar repair requires a preserved original and a current review: '+result,async()=>{
 const f=fixture(),raw={Maa:day({'morning-1':'Synthetic Extra Day'})};f.state.snapshot.currentSchedule[31]=raw;let backups=0;
 f.sync.preserveCalendarBackup=async()=>{backups++;if(result==='closed')f.controller.close();if(result==='changed')f.state.snapshot.currentSchedule[3]={Maa:day({'morning-1':'New edit'})};return result!=='failed';};
 await f.controller.open();const {captured,plan}=f.proposal(),before=copy(f.state.snapshot);assert.equal(plan.calendarRepair.excluded[0].key,'31');assert.deepEqual(f.state.snapshot,before);assert.equal(backups,0);
 if(result==='saved'){assert.equal((await f.hooks.commit(plan,captured)).prepared,true);assert.equal(f.state.snapshot.currentSchedule[31],undefined);assert.equal(backups,1);assert.equal(f.calls.applied.length,1);}
 else{await assert.rejects(f.hooks.commit(plan,captured));assert.equal(f.calls.applied.length,0);assert.deepEqual(f.state.snapshot.currentSchedule[31],raw);assert.equal(f.calls.dirty,0);}
 assert.equal(f.calls.businessWrites,0);
});
test('an authorized co-owner can review and apply a local roster without a separate Owner or HQ approval',async()=>{
 const f=fixture();f.w.auth.currentUser={uid:'synthetic-coowner',email:'coowner@example.test',emailVerified:true};f.w.sessionUser={uid:'synthetic-coowner',email:'coowner@example.test',role:'Co-Owner',isOwner:false,isFranchisee:false,permissions:['schedule'],allowedBranches:['Maa']};await f.controller.open();const {captured,plan}=f.proposal();assert.equal((await f.hooks.commit(plan,captured)).prepared,true);assert.equal(f.calls.applied.length,1);assert.equal(f.calls.businessWrites,0);
});
test('calendar repair cannot alter extra rows of a branch outside the current co-owner permissions',async()=>{
 const f=fixture();f.state.snapshot.currentSchedule[31]={Restricted:day()};f.w.isBranchAllowed=branch=>branch!=='Restricted';f.sync.preserveCalendarBackup=()=>assert.fail('No backup or repair should start for an unauthorized branch');await f.controller.open();const {captured,plan}=f.proposal();await assert.rejects(f.hooks.commit(plan,captured),/authorized owner/);assert.equal(f.calls.applied.length,0);assert.equal(f.calls.businessWrites,0);
});
