import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scheduleShiftHours} from '../takodeal-manager/schedule-layout.js';
import {validateShiftConfig} from '../takodeal-manager/payroll-safety.js';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start);return source.slice(start+1,end+3);};
const clone=value=>JSON.parse(JSON.stringify(value));
const morning=(id,name,start='09:00',end='17:30')=>({id,name,startTime:start,endTime:end,shiftType:'morning',active:true,days:[0,1,2,3,4,5,6]});
test('exact canonical hours distinguish Morning 1 and Morning 2 even when their category or old label matches',()=>{
 assert.equal(scheduleShiftHours(morning('m1','Morning 1 Cashier')),'9:00 AM – 5:30 PM');
 assert.equal(scheduleShiftHours(morning('m2','Morning 1 (9am-5:30pm)','10:00','18:30')),'10:00 AM – 6:30 PM');
 assert.equal(scheduleShiftHours(morning('n1','Night','18:30','03:00')),'6:30 PM – 3:00 AM · next day');
 assert.equal(scheduleShiftHours(morning('empty','New Morning','','')),'Set start and finish');
});
function creationFixture({readonly=false,allowed=true}={}){
 const config={Cabantian:[morning('k','Morning 1 Kitchen'),morning('c','Morning 1 Cashier')]},roster={29:{Cabantian:{scheduled:{k:'Ari',c:'Mika'},rest:[]}}},calls={renders:0,captures:0,confirm:0,messages:[]};
 const w={scheduleMemoryReadOnly:readonly,isBranchAllowed:()=>allowed,captureTempShiftConfig(){calls.captures++;},renderConfigUI(){calls.renders++;},ManagerUI:{notify:text=>calls.messages.push(text),confirm:async()=>{calls.confirm++;return true;}}};
 const context=vm.createContext({window:w,branchConfig:config,currentSchedule:roster,crypto:{randomUUID:()=> 'fictional-id'}});
 vm.runInContext(extract('addNewShiftToBranch'),context);vm.runInContext(extract('removeShiftFromBranch'),context);return {w,config,roster,calls};
}
test('adding a second Morning requires explicit new hours and never copies or reassigns the existing staff',()=>{
 const f=creationFixture(),before=clone(f.roster);f.w.addNewShiftToBranch('Cabantian','morning');const added=f.config.Cabantian[2];
 assert.equal(added.name,'Morning 2');assert.equal(added.startTime,'');assert.equal(added.endTime,'');assert.notEqual(added.id,'k');assert.notEqual(added.id,'c');assert.deepEqual(f.roster,before);assert.throws(()=>validateShiftConfig(added),/set both Time In and Time Out/);assert.equal(f.calls.renders,1);assert.match(f.calls.messages[0],/exact start and finish/);
});
for(const mode of ['readonly','outside access'])test('shift creation cannot bypass '+mode,()=>{
 const f=creationFixture({readonly:mode==='readonly',allowed:mode!=='outside access'}),before=clone(f.config);f.w.addNewShiftToBranch('Cabantian','morning');assert.deepEqual(f.config,before);assert.equal(f.calls.captures,0);assert.equal(f.calls.renders,0);
});
test('removing a populated slot cannot discard its staff assignment or write a replacement roster',async()=>{
 const f=creationFixture(),before=clone({config:f.config,roster:f.roster});assert.equal(await f.w.removeShiftFromBranch('Cabantian',0),false);assert.deepEqual({config:f.config,roster:f.roster},before);assert.equal(f.calls.confirm,0);assert.equal(f.calls.renders,0);assert.match(f.calls.messages[0],/still has staff assignments/);
});
test('an unfilled slot can be removed from the draft after confirmation without touching the saved roster',async()=>{
 const f=creationFixture();f.config.Cabantian.push(morning('new','Morning 2','10:00','18:30'));f.roster[29].Cabantian.scheduled.new='UNFILLED';const before=clone(f.roster);assert.equal(await f.w.removeShiftFromBranch('Cabantian',2),true);assert.equal(f.calls.confirm,1);assert.equal(f.config.Cabantian.some(row=>row.id==='new'),false);assert.deepEqual(f.roster,before);
});
test('a slot assigned while its deletion confirmation is open is preserved',async()=>{
 const f=creationFixture();f.config.Cabantian.push(morning('new','Morning 2','10:00','18:30'));let confirm;
 f.w.ManagerUI.confirm=()=>new Promise(resolve=>{confirm=resolve;});const pending=f.w.removeShiftFromBranch('Cabantian',2);f.roster[29].Cabantian.scheduled.new='Ren';confirm(true);
 assert.equal(await pending,false);assert.equal(f.config.Cabantian.some(row=>row.id==='new'),true);assert.equal(f.roster[29].Cabantian.scheduled.new,'Ren');assert.equal(f.calls.renders,0);
});
test('actual roster presents distinct exact hours and warns which earlier dates require saved history',()=>{
 const config={Cabantian:[morning('m1','Morning 1'),morning('m2','Morning 2','10:00','18:30')]},roster={28:{Cabantian:{scheduled:{m1:'Ari',m2:'Mika'},rest:[],unavailable:[]}},29:{Cabantian:{scheduled:{m1:'Ari',m2:'Mika'},rest:[],unavailable:[]}}},before=clone(roster);
 function element(){return {children:[],innerHTML:'',appendChild(node){this.children.push(node);}};}const container=element(),w={globalActiveBranches:['Cabantian'],isBranchAllowed:()=>true,employees:[]};
 const context=vm.createContext({window:w,document:{getElementById:id=>id==='scheduleEffectiveFrom'?{value:'2026-10-29'}:container,createElement:element},branchConfig:config,currentSchedule:roster,currentYear:2026,currentMonth:10,currentActiveTab:'Cabantian',scheduleShiftHours,enhanceScheduleLayout(){}});
 vm.runInContext(extract('renderTables'),context);w.renderTables();const html=container.children[1].children[0].innerHTML;
 assert.match(html,/9:00 AM – 5:30 PM/);assert.match(html,/10:00 AM – 6:30 PM/);assert.match(html,/Earlier saved version: review History/);assert.match(html,/Editor hours · from 2026-10-29/);assert.deepEqual(roster,before);
});
function saveRulesFixture({day=1,unavailable=[],globalUnavailable={}}={}){
 const active=morning('active','Morning 1'),inactive={...morning('inactive','Morning 2','10:00','18:30'),active:false},disabled={...morning('weekday','Weekday'),days:[]};
 const branchConfig={Cabantian:[active,inactive,disabled],Other:[{...morning('other','Other morning'),active:false}]};
 const currentSchedule={[day]:{Cabantian:{scheduled:{active:'Bea',inactive:'Mika',weekday:'Ren',removed:'Ari',duplicate:'Bea'},rest:['Mika'],unavailable,swaps:{active:'Former'},customReview:{keep:true}},Other:{scheduled:{other:'Toni'},rest:[],unavailable:[],customReview:{keep:true}}}};
 let saved;const window={captureTempShiftConfig(){},isBranchAllowed:branch=>branch==='Cabantian',renderTables(){},saveToCloud:()=>assert.fail('Applying rules must wait for explicit Save Edits'),markScheduleDraftEdited:()=>{saved=clone(currentSchedule);}};
 const unavailability={[`2026-10-${String(day).padStart(2,'0')}`]:globalUnavailable};
 vm.runInNewContext(extract('saveShiftConfigChanges'),{window,branchConfig,currentSchedule,currentYear:2026,currentMonth:10,unavailability,validateShiftConfig,document:{getElementById:()=>null},setTimeout(){}});
 return {window,branchConfig,currentSchedule,saved:()=>saved};
}
test('saving rules preserves displaced inactive, removed and disabled-day staff on Standby once, without moving active staff',async()=>{
 const f=saveRulesFixture(),other=clone(f.currentSchedule[1].Other);assert.equal(await f.window.saveShiftConfigChanges(),true);const row=f.saved()[1].Cabantian;
 assert.deepEqual(row.scheduled,{active:'Bea',weekday:'N/A'});assert.deepEqual(row.rest,['Mika','Ren','Ari']);assert.equal(row.rest.includes('Bea'),false);assert.deepEqual(row.swaps,{active:'Former'});assert.deepEqual(row.customReview,{keep:true});assert.deepEqual(f.saved()[1].Other,other);
});
test('displaced staff on dated leave remain in their unavailable records and never acquire a Standby duplicate',async()=>{
 const f=saveRulesFixture({unavailable:[{name:'Ren',status:'Day Off'}],globalUnavailable:{Ari:'Approved Leave'}});assert.equal(await f.window.saveShiftConfigChanges(),true);const row=f.saved()[1].Cabantian;assert.deepEqual(row.rest,['Mika']);assert.deepEqual(row.unavailable,[{name:'Ren',status:'Day Off'}]);assert.equal(row.scheduled.active,'Bea');
});
test('a partial saved month is reconciled without requiring an unrelated first-day row',async()=>{
 const f=saveRulesFixture({day:29});assert.equal(await f.window.saveShiftConfigChanges(),true);assert.deepEqual(f.saved()[29].Cabantian.rest,['Mika','Ren','Ari']);assert.equal(Object.hasOwn(f.saved(),'1'),false);
});
