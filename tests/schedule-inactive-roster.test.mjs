import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {toScheduleEmployee,createScheduleRosterView,scheduleIdentityDirectory,resolveScheduleEmployeeReference} from '../takodeal-manager/schedule-staff-directory.js';
import {scheduleDateKey} from '../takodeal-manager/schedule-history.js';
import {scheduleShiftHours} from '../takodeal-manager/schedule-layout.js';
import {leaveStatus} from '../takodeal-manager/leave-model.js';
const person=(id,name,extra={})=>toScheduleEmployee({cashierName:name,scheduleNickname:name,branch:'Maa',...extra},id);
const row=()=>({scheduled:{m1:'Former',m2:'Active'},rest:['Former','Active','Unknown'],unavailable:[{name:'Former',staffId:'former',status:'Leave',leaveRequestId:'original-leave'},{name:'Active',staffId:'active',status:'Day Off'}],swaps:{m1:'Former',m2:'Active'}});
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start);return source.slice(start+1,end+3);};
class TestDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-15T12:00:00+08:00']));}}

for(const status of [{status:'Archived'},{status:'Offboarded'},{status:'Resigned'},{active:false},{isActive:false},{archived:true},{isArchived:true},{offboarded:true},{pin:'REVOKED'},{employmentStatus:'Terminated'},{contractStatus:'Offboarded'}])test('current roster excludes exact inactive identity '+JSON.stringify(status)+' without mutating history',()=>{
 const directory=[person('former','Former',status),person('active','Active')],saved=row(),before=structuredClone(saved),view=createScheduleRosterView(directory),active=view.day(saved);
 assert.equal(active.scheduled.m1,'UNFILLED');assert.equal(active.scheduled.m2,'Active');assert.deepEqual(active.rest,['Active','Unknown']);assert.equal(active.unavailable.length,1);assert.deepEqual(active.swaps,{m2:'Active'});assert.deepEqual(saved,before);assert.deepEqual(view.day(saved,{historical:true}),before);
});
test('missing, ambiguous and conflicting name/ID evidence remains visible rather than removing the wrong employee',()=>{
 const view=createScheduleRosterView([person('former','Shared',{status:'Archived'}),person('current','Shared')]);
 assert.equal(view.inactive('Shared'),false);assert.equal(view.inactive('Missing'),false);assert.equal(view.inactive({staffId:'current',name:'Shared'}),false);assert.equal(view.inactive({staffId:'former',name:'Shared'}),true);
});
test('saved aliases identify former staff across renames without importing stale active membership',()=>{
 const directory=scheduleIdentityDirectory([person('former','New Name',{status:'Archived'})],[person('former','Old Name')]);
 assert.equal(createScheduleRosterView(directory).inactive('Old Name'),true);
});

function fixture(readonly=false){
 const directory=[person('former','Former',{status:'Archived'}),person('active','Active')],schedule={14:{Maa:row()},15:{Maa:row()},16:{Maa:row()}},container={children:[],appendChild(node){this.children.push(node);}},list={children:[],appendChild(node){this.children.push(node);}},create=()=>({style:{},children:[],appendChild(node){this.children.push(node);}});
 const document={getElementById:id=>id==='scheduleContainer'?container:id==='unavailabilityList'?list:null,createElement:create};
 const window={employees:[directory[1]],scheduleDirectoryProfiles:directory,currentActiveTab:'Maa',scheduleMemoryReadOnly:readonly,isBranchAllowed:()=>true,findEmployeeProfile:name=>resolveScheduleEmployeeReference(name,directory)};
 const ctx=vm.createContext({window,document,Date:TestDate,scheduleDateKey,scheduleIdentityDirectory,createScheduleRosterView,scheduleShiftHours,leaveStatus,escapeHtml:String,enhanceScheduleLayout(){},employees:window.employees,currentSchedule:schedule,currentYear:2026,currentMonth:11,currentActiveTab:'Maa',branchConfig:{Maa:[{id:'m1',name:'Morning 1',active:true},{id:'m2',name:'Morning 2',active:true}]},unavailability:{'2026-11-14':{Former:'Leave'},'2026-11-15':{Former:'Leave'},'2026-11-16':{Former:'Leave'}}});
 for(const name of ['renderTables','updateUnavailabilityList'])vm.runInContext(extract(name),ctx);
 return {window,schedule,container,list};
}
test('real current/future roster cells and standby/leave/swap labels omit former staff while past rows and source data remain exact',()=>{
 const f=fixture(),before=structuredClone(f.schedule);f.window.renderTables();const html=f.container.children[1].children[0].innerHTML;
 const rows=[...html.matchAll(/<tr data-schedule-date-label=.*?<\/tr>/gs)].map(match=>match[0]);assert.equal(rows.length,3);assert.match(rows[0],/Former/);
 for(const text of rows.slice(1)){assert.doesNotMatch(text,/Former/);assert.match(text,/Needs Staff/);assert.match(text,/Active/);}
 assert.deepEqual(f.schedule,before);
});
test('explicit saved History views retain the former names on every original work date',()=>{
 const f=fixture(true);f.window.renderTables();const rows=[...f.container.children[1].children[0].innerHTML.matchAll(/<tr data-schedule-date-label=.*?<\/tr>/gs)];for(const [html]of rows)assert.match(html,/Former/);
});
test('real current/future time-off list omits inactive staff but preserves their past saved leave',()=>{
 const f=fixture();f.window.updateUnavailabilityList();assert.equal(f.list.children.length,1);assert.match(f.list.children[0].innerHTML,/2026-11-14/);assert.match(f.list.children[0].innerHTML,/Former/);
});
