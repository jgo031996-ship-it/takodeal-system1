import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as directory from '../takodeal-manager/schedule-staff-directory.js';
import {availableScheduleReliefStaff} from '../takodeal-manager/schedule-relief-staff.js';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';
import {leaveStatus} from '../takodeal-manager/leave-model.js';
import {scheduleShiftHours} from '../takodeal-manager/schedule-layout.js';

const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,name+' source exists');return source.slice(start+1,end+3);};
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const hold=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const employee=(id,name,branch='Maa',extra={})=>directory.toScheduleEmployee({cashierName:'Sample '+name,scheduleNickname:name,branch,active:true,...extra},id);
const day=(scheduled={},rest=[],unavailable=[])=>({scheduled,rest,unavailable,swaps:{}});
function fixture(options={}){
 const nodes=new Map(),calls={dialogs:[],notices:[],saves:[],drafts:[],renders:0,leaveReviews:[]};let context;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,innerHTML:'',style:{}});return nodes.get(id);};
 const staff=options.staff||[employee('existing','Existing'),employee('standby','Standby'),employee('anj@example.test','Anj'),employee('Joana ID','Joana'),employee('other','Other','Cabantian')];
 const schedule=options.schedule||{28:{Maa:day({m1:'Existing',m2:'UNFILLED'},['Standby']),Cabantian:day({m1:'Other',m2:'UNFILLED'})},29:{Maa:day({m1:'Existing',m2:'UNFILLED'},['Standby']),Cabantian:day({m1:'Other',m2:'UNFILLED'})}};
 const w={db:{},doc:(_db,table,id)=>({table,id}),getDocFromServer:async reference=>{if(options.readProfile)return options.readProfile(reference);const profile=staff.find(row=>row.staffId===reference.id);return {exists:()=>!!profile,data:()=>({...profile}),metadata:{fromCache:false,hasPendingWrites:false}};},auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',isOwner:true,isFranchisee:false,role:'Owner',permissions:['all'],allowedBranches:['All']},employees:staff,scheduleDirectoryProfiles:staff,scheduleMemoryReadOnly:!!options.readonly,
  isBranchAllowed:branch=>!(options.deniedBranches||[]).includes(branch),ManagerUI:{notify:message=>calls.notices.push(message)},renderConfigUI(){},updateHolidayList(){},renderTables(){calls.renders++;},switchTab(){},updateStaffDisplay(){},updateAvailDropdown(){},updateUnavailabilityList(){},
  reviewOwnedScheduleLeave(date,name){calls.leaveReviews.push({date,name});return options.ownedLeave===name;},
  markScheduleDraftEdited:()=>calls.drafts.push(clone(context.currentSchedule)),
  saveToCloud:async()=>{calls.saves.push(clone(context.currentSchedule));return options.save?options.save():true;}};
 const Swal={fire:async(...args)=>{calls.dialogs.push(args);if(args[0]?.title==='Remove Staff?'&&options.poolConfirm)return {isConfirmed:true};if(args[0]?.title==='➕ Pull Staff to Branch'&&options.poolConfirm)return {isConfirmed:true,value:options.poolConfirm};if(args[0]?.title==='🔄 Reassign / Swap Shift'&&options.autoConfirm)return {isConfirmed:true,value:options.autoConfirm};return {isConfirmed:false};},showValidationMessage:message=>calls.notices.push(message)};
 context=vm.createContext({...directory,scheduleShiftHours,activeStaffProfile,availableScheduleReliefStaff,canOpenWorkspacePage,leaveStatus,escapeHtml:esc,window:w,document:{getElementById:node},Swal,employees:staff,currentSchedule:schedule,unavailability:options.unavailability||{},currentYear:2026,currentMonth:10,currentActiveTab:'Maa',branchConfig:{Maa:[{id:'m1',name:'Morning one'},{id:'m2',name:'Morning two'}],Cabantian:[{id:'m1',name:'Morning one'},{id:'m2',name:'Morning two'}]},swapData:null,monthKey:value=>value.currentYear+'-'+String(value.currentMonth).padStart(2,'0'),console});
 for(const name of ['applyScheduleMemorySnapshot','findEmployeeProfile','confirmActiveScheduleStaff','openSwapModal','executeSwap','removeStaffFromBranchPool','addStaffToBranchPool'])vm.runInContext(extract(name),context);
 const html=()=>calls.dialogs.filter(args=>args[0]?.title==='🔄 Reassign / Swap Shift').at(-1)?.[0].html||'';
 const optionsFor=()=>[...html().matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(row=>({value:row[1],label:row[2]}));
 return {w,ctx:context,calls,node,html,optionsFor,async open(branch='Maa',shift='m1'){await w.openSwapModal(28,branch,shift);},option(name){return optionsFor().find(row=>row.label.startsWith(name+' '));}};
}
const successful=f=>f.calls.dialogs.some(args=>args[0]?.icon==='success');

test('actual assignment review names the branch, work date and exact target hours rather than only its Morning category',async()=>{
 const f=fixture(),slots=f.ctx.branchConfig.Maa;Object.assign(slots[0],{startTime:'09:00',endTime:'17:30'});Object.assign(slots[1],{startTime:'10:00',endTime:'18:30'});const before=clone(f.ctx.currentSchedule);await f.open('Maa','m2');
 assert.match(f.html(),/Maa · 2026-10-28 \(PH\) · Morning two · 10:00 AM – 6:30 PM/);assert.match(f.html(),/Morning one · 9:00 AM – 5:30 PM/);assert.match(f.html(),/exact hours/);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);
});

test('actual swap opening offers new same-branch Anj and Joana by stable ID without changing any saved day',async()=>{
 const f=fixture(),before=clone({schedule:f.ctx.currentSchedule,unavailability:f.ctx.unavailability,staff:f.w.employees});await f.open();
 assert.equal(f.option('Anj').value,'pool_'+encodeURIComponent('anj@example.test'));assert.equal(f.option('Joana').value,'pool_'+encodeURIComponent('Joana ID'));assert.match(f.html(),/Available Maa Staff/);assert.equal(f.calls.saves.length,0);assert.deepEqual(clone({schedule:f.ctx.currentSchedule,unavailability:f.ctx.unavailability,staff:f.w.employees}),before);
});
test('actual stable-ID pool assignment drafts only the intended slot and preserves other dates and branch records',async()=>{
 const f=fixture(),before=clone(f.ctx.currentSchedule);await f.open();assert.equal(await f.w.executeSwap(f.option('Anj').value,false),true);
 assert.equal(f.ctx.currentSchedule[28].Maa.scheduled.m1,'Anj');assert.equal(f.ctx.currentSchedule[28].Maa.scheduled.m2,'UNFILLED');assert.deepEqual(clone(f.ctx.currentSchedule[28].Maa.rest),['Standby','Existing']);assert.deepEqual(clone(f.ctx.currentSchedule[28].Cabantian),before[28].Cabantian);assert.deepEqual(clone(f.ctx.currentSchedule[29]),before[29]);assert.equal(f.calls.saves.length,0);assert.equal(f.calls.drafts.length,1);assert.equal(successful(f),true);
});
test('the actual modal confirmation awaits its stable-ID assignment and sets only the requested swap badge',async()=>{
 const f=fixture({autoConfirm:{target:'pool_'+encodeURIComponent('Joana ID'),markSwap:true}});await f.open();assert.equal(f.ctx.currentSchedule[28].Maa.scheduled.m1,'Joana');assert.deepEqual(clone(f.ctx.currentSchedule[28].Maa.swaps),{m1:'Existing'});assert.equal(f.calls.saves.length,0);assert.equal(f.calls.drafts.length,1);assert.equal(successful(f),true);
});
test('UNFILLED displacement never adds a placeholder to standby and cannot recruit a forged ID or name',async()=>{
 const f=fixture();await f.open('Maa','m2');assert.equal(await f.w.executeSwap('pool_'+encodeURIComponent('Sample Anj'),false),false);assert.equal(f.calls.saves.length,0);assert.equal(await f.w.executeSwap(f.option('Anj').value,false),true);assert.deepEqual(clone(f.ctx.currentSchedule[28].Maa.rest),['Standby']);
});
test('same-day assignments or unavailable rows in any branch and global flags exclude newly derived pool staff',async()=>{
 for(const kind of ['assigned','rest','unavailable','global']){
  const f=fixture();if(kind==='assigned')f.ctx.currentSchedule[28].Cabantian.scheduled.m2='Anj';if(kind==='rest')f.ctx.currentSchedule[28].Cabantian.rest=['Anj'];if(kind==='unavailable')f.ctx.currentSchedule[28].Cabantian.unavailable=[{name:'Anj',staffId:'anj@example.test',status:'Leave'}];if(kind==='global')f.ctx.unavailability['2026-10-28']={Anj:'Day Off'};
  await f.open();assert.equal(f.optionsFor().some(row=>row.value==='pool_'+encodeURIComponent('anj@example.test')),false,kind);assert.equal(f.calls.saves.length,0);
 }
});
test('day-only unavailable staff remain visible for explicit review while owned leave cannot be erased by reassignment',async()=>{
 const f=fixture({ownedLeave:'Anj'});f.ctx.currentSchedule[28].Maa.unavailable=[{name:'Anj',staffId:'anj@example.test',leaveRequestId:'saved-leave',status:'Leave'}];const before=clone(f.ctx.currentSchedule);await f.open();assert.match(f.html(),/unavail_Anj/);await f.w.executeSwap('unavail_Anj',false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);assert.equal(f.calls.leaveReviews.at(-1).name,'Anj');
});
for(const changed of ['actor','permission','month','day','profile-branch','profile-name','profile-inactive','global-flag'])test('actual assignment rejects stale '+changed+' evidence before saving or mutating a day',async()=>{
 const f=fixture();await f.open();const target=f.option('Anj').value;
 if(changed==='actor')f.w.auth.currentUser.uid='different-owner';if(changed==='permission')f.w.sessionUser.permissions=['inbox'];if(changed==='month')f.ctx.currentMonth=11;if(changed==='day')f.ctx.currentSchedule[28].Cabantian.rest.push('Unrelated change');
 const staff=f.w.employees.find(row=>row.staffId==='anj@example.test');if(changed==='profile-branch')staff.branch='Citygate';if(changed==='profile-name')staff.name=staff.scheduleNickname='Changed Nick';if(changed==='profile-inactive')staff.scheduleEligible=false;if(changed==='global-flag')f.ctx.unavailability['2026-10-28']={Anj:'Day Off'};
 const before=clone(f.ctx.currentSchedule);assert.equal(await f.w.executeSwap(target,false),false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);assert.equal(successful(f),false);
});
test('assignment stays local even when a cloud save would fail, and duplicate confirmation cannot save the draft',async()=>{
 const f=fixture({save:()=>assert.fail('Assignment must wait for explicit Save Edits')});await f.open();const target=f.option('Anj').value;
 assert.equal(await f.w.executeSwap(target,false),true);assert.equal(f.ctx.currentSchedule[28].Maa.scheduled.m1,'Anj');assert.equal(f.calls.saves.length,0);assert.equal(f.calls.drafts.length,1);
 assert.equal(await f.w.executeSwap(target,false),false);assert.equal(f.calls.drafts.length,1);assert.match(f.calls.dialogs.find(args=>args[0]?.icon==='success')[0].title,/local draft.*Save Edits/);
});
test('actual snapshot application joins fresh directory aliases without importing saved membership or editing the roster',async()=>{
 const f=fixture(),saved={currentYear:2026,currentMonth:10,branchConfig:f.ctx.branchConfig,employees:[{staffId:'anj@example.test',name:'Old Anj',branch:'Cabantian'},{staffId:'ghost',name:'Removed Ghost',branch:'Maa'}],currentSchedule:{28:{Maa:day({m1:'Old Anj',m2:'UNFILLED'})}},unavailability:{}};
 await f.w.applyScheduleMemorySnapshot(saved);assert.ok(f.w.employees.some(row=>row.staffId==='Joana ID'));assert.equal(f.w.employees.some(row=>row.staffId==='ghost'),false);assert.equal(f.w.employees.find(row=>row.staffId==='anj@example.test').branch,'Maa');assert.equal(f.ctx.currentSchedule[28].Maa.scheduled.m1,'Old Anj');assert.equal(f.calls.saves.length,0);await f.open('Maa','m2');assert.equal(f.optionsFor().some(row=>row.value==='pool_'+encodeURIComponent('anj@example.test')),false);assert.equal(f.option('Joana').value,'pool_'+encodeURIComponent('Joana ID'));
});
test('relief cannot silently recruit a staff member already scheduled or unavailable elsewhere that day',async()=>{
 for(const kind of ['scheduled','unavailable','global']){const f=fixture();if(kind==='scheduled')f.ctx.currentSchedule[28].Maa.scheduled.m2='Anj';if(kind==='unavailable')f.ctx.currentSchedule[28].Maa.unavailable=[{name:'Anj',status:'Leave'}];if(kind==='global')f.ctx.unavailability['2026-10-28']={Anj:'Day Off'};await f.open('Cabantian','m2');assert.equal(f.optionsFor().some(row=>row.label.startsWith('Anj ')&&row.value.startsWith('relief_')),false,kind);assert.equal(f.optionsFor().some(row=>row.value==='global_Anj'),false,kind);const before=clone(f.ctx.currentSchedule);assert.equal(await f.w.executeSwap('global_Anj',false),false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);}
});
test('authorized cross-branch standby relief removes only the inspected source and preserves every other roster record',async()=>{
 const f=fixture();f.ctx.currentSchedule[28].Maa.rest.push('Anj');const before=clone(f.ctx.currentSchedule);await f.open('Cabantian','m2');const target=f.option('Anj');assert.ok(target?.value.startsWith('relief_'));assert.equal(await f.w.executeSwap(target.value,false),true);assert.equal(f.ctx.currentSchedule[28].Cabantian.scheduled.m2,'Anj');assert.deepEqual(clone(f.ctx.currentSchedule[28].Maa.rest),['Standby']);assert.deepEqual(clone(f.ctx.currentSchedule[28].Maa.scheduled),before[28].Maa.scheduled);assert.deepEqual(clone(f.ctx.currentSchedule[29]),before[29]);assert.equal(f.calls.saves.length,0);assert.equal(f.calls.drafts.length,1);
});
test('relief source permission revocation or changed standby provenance rejects the old selection',async()=>{
 for(const changed of ['permission','standby','directory']){const denied=[],f=fixture({deniedBranches:denied});f.ctx.currentSchedule[28].Maa.rest.push('Anj');await f.open('Cabantian','m2');const target=f.option('Anj').value;if(changed==='permission')denied.push('Maa');if(changed==='standby')f.ctx.currentSchedule[28].Maa.rest.push('Anj');if(changed==='directory')f.w.employees.find(row=>row.staffId==='anj@example.test').branch='Citygate';const before=clone(f.ctx.currentSchedule);assert.equal(await f.w.executeSwap(target,false),false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);}
});
test('former and unknown dated roster names are preserved but never offered as active scheduled or standby choices',async()=>{
 const f=fixture();f.w.scheduleDirectoryProfiles.push(employee('former','Former','Maa',{status:'Offboarded'}));f.ctx.currentSchedule[28].Maa.scheduled.m2='Former';f.ctx.currentSchedule[28].Maa.rest.push('Unknown Legacy');const before=clone(f.ctx.currentSchedule);await f.open();assert.equal(f.optionsFor().some(row=>/Former|Unknown Legacy/.test(row.label)),false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);assert.equal(f.w.findEmployeeProfile('Exis'),null,'prefix guessing is disabled');
});

test('a current employee newly revoked on the server cannot be assigned from a stale open chooser',async()=>{
 const f=fixture({readProfile:async reference=>({exists:()=>true,data:()=>({cashierName:'Sample Anj',scheduleNickname:'Anj',branch:'Maa',pin:'REVOKED'}),metadata:{fromCache:false,hasPendingWrites:false}})});await f.open();const before=clone(f.ctx.currentSchedule);assert.equal(await f.w.executeSwap(f.option('Anj').value,false),false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);
});

test('a roster or account change during the fresh employee read cannot mutate any day',async()=>{
 for(const change of ['day','account']){const gate=hold(),f=fixture({readProfile:()=>gate.promise});await f.open();const saving=f.w.executeSwap(f.option('Anj').value,false);if(change==='day')f.ctx.currentSchedule[28].Maa.rest.push('Owner draft change');else f.w.auth.currentUser={...f.w.auth.currentUser,uid:'another-owner'};const before=clone(f.ctx.currentSchedule);gate.resolve({exists:()=>true,data:()=>({cashierName:'Sample Anj',scheduleNickname:'Anj',branch:'Maa'}),metadata:{fromCache:false,hasPendingWrites:false}});assert.equal(await saving,false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);}
});

test('an offboarded current assignee can be replaced but cannot be swapped into another shift',async()=>{
 const f=fixture();f.ctx.currentSchedule[28].Maa.scheduled.m2='Standby';f.w.scheduleDirectoryProfiles.find(row=>row.staffId==='existing').active=false;await f.open();assert.equal(f.optionsFor().some(row=>row.value==='shift_m2'),false);const before=clone(f.ctx.currentSchedule);assert.equal(await f.w.executeSwap('shift_m2',false),false);assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);
});

test('a recovered draft cannot reintroduce revoked membership or erase its historical assignment',async()=>{
 const f=fixture();f.w.scheduleDirectoryProfiles.find(row=>row.staffId==='existing').active=false;const snapshot={currentYear:2026,currentMonth:10,branchConfig:f.ctx.branchConfig,employees:[employee('existing','Existing')],currentSchedule:clone(f.ctx.currentSchedule),unavailability:{}};await f.w.applyScheduleMemorySnapshot(snapshot,{preserveDraftEmployees:true});assert.equal(f.w.employees.some(row=>row.staffId==='existing'),false);assert.equal(f.ctx.currentSchedule[28].Maa.scheduled.m1,'Existing');assert.equal(f.calls.saves.length,0);
});

test('confirmed pool transfers use the chosen stable ID and refresh both scheduling directories without changing any roster',async()=>{
 const f=fixture({poolConfirm:encodeURIComponent('anj@example.test')}),writes=[],before=clone(f.ctx.currentSchedule);f.w.updateDoc=async(ref,fields)=>writes.push({ref,fields});
 await f.w.addStaffToBranchPool('Agdao');assert.equal(writes.length,1);assert.equal(writes[0].ref.id,'anj@example.test');assert.equal(writes[0].fields.branch,'Agdao');assert.equal(f.w.scheduleDirectoryProfiles.find(row=>row.staffId==='anj@example.test').branch,'Agdao');assert.deepEqual(clone(f.ctx.currentSchedule),before);assert.equal(f.calls.saves.length,0);
 await f.w.removeStaffFromBranchPool('Anj');assert.equal(writes.length,2);assert.equal(writes[1].ref.id,'anj@example.test');assert.equal(writes[1].fields.branch,'Unassigned');assert.equal(f.w.scheduleDirectoryProfiles.find(row=>row.staffId==='anj@example.test').branch,'Unassigned');assert.deepEqual(clone(f.ctx.currentSchedule),before);
});
test('ambiguous name removal and denied branch transfers never update a staff account',async()=>{
 for(const ambiguous of [true,false]){const f=fixture({poolConfirm:encodeURIComponent('anj@example.test'),deniedBranches:ambiguous?[]:['Agdao']});f.w.updateDoc=()=>assert.fail('No transfer is authorized');if(ambiguous){f.w.scheduleDirectoryProfiles.push(employee('namesake','Anj'));await f.w.removeStaffFromBranchPool('Anj');}else await f.w.addStaffToBranchPool('Agdao');assert.equal(f.calls.saves.length,0);assert.equal(f.calls.dialogs.at(-1)[0],'Staff transfer not confirmed');}
});
