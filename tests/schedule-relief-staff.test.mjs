import test from 'node:test';
import assert from 'node:assert/strict';
import {availableScheduleReliefStaff} from '../takodeal-manager/schedule-relief-staff.js';
import {toScheduleEmployee} from '../takodeal-manager/schedule-staff-directory.js';
const person=(id,name,branch='Maa',extra={})=>toScheduleEmployee({cashierName:name+' Full',scheduleNickname:name,branch,active:true,...extra},id);
const day=(extra={})=>({scheduled:{morning:'UNFILLED'},rest:[],unavailable:[],swaps:{},...extra});
const choose=(employees,extra={})=>availableScheduleReliefStaff({employees,branch:'Cabantian',dayBranches:{Maa:day(),Cabantian:day()},unavailability:{},isBranchAllowed:()=>true,...extra});
test('available relief uses stable current identities and exposes only projected scheduling metadata',()=>{
 const rows=choose([{staffId:'staff@example.test',cashierName:'Sample Crew',scheduleNickname:'Sample',branch:'Maa',pin:'1234',bankAccount:'PRIVATE',email:'private@example.test',hourlyRate:450}]);assert.equal(rows.length,1);assert.equal(rows[0].staffId,'staff@example.test');assert.deepEqual(rows[0].standbySources,[]);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|bankAccount|hourlyRate|private@example/);
});
test('cross-branch standby remains selectable and exact source strings are preserved without mutation',()=>{
 const employees=[person('anj','Anj','Maa',{scheduleAliases:['Old Anj']})],dayBranches={Maa:day({rest:[' Old Anj ']}),Cabantian:day()},before=structuredClone({employees,dayBranches});
 const rows=choose(employees,{dayBranches});assert.equal(rows.length,1);assert.deepEqual(rows[0].standbySources,[{branch:'Maa',name:' Old Anj '}]);assert.deepEqual({employees,dayBranches},before);rows[0].standbySources[0].name='Changed';assert.equal(dayBranches.Maa.rest[0],' Old Anj ');
});
test('every same-day scheduled assignment blocks relief, including aliases and explicit identities',()=>{
 for(const ref of ['Anj','Anj Full','Old Anj',{staffId:'anj',name:'Earlier name'}])assert.deepEqual(choose([person('anj','Anj','Maa',{scheduleAliases:['Old Anj']})],{dayBranches:{Citygate:day({scheduled:{night:ref}})}}),[]);
});
test('global unavailable flags and any branch unavailable row block relief before the roster was regenerated',()=>{
 const employees=[person('anj','Anj','Maa',{scheduleAliases:['Old Anj']})];
 for(const unavailability of [{Anj:'Day Off'},{'Old Anj':{status:'Leave',leaveRequestId:'leave-one',staffId:'anj'}},{unrelated:{staffId:'anj',status:'Suspended'}},[{staffId:'anj',name:'Old',status:'Leave'}]])assert.deepEqual(choose(employees,{unavailability}),[]);
 assert.deepEqual(choose(employees,{dayBranches:{Citygate:day({unavailable:[{staffId:'anj',name:'Old',status:'Leave'}]})}}),[]);
});
test('home target and every standby source require an explicit allowed branch',()=>{
 const employee=person('anj','Anj'),dayBranches={Citygate:day({rest:['Anj']})};
 for(const denied of ['Maa','Cabantian','Citygate'])assert.deepEqual(choose([employee],{dayBranches,isBranchAllowed:branch=>branch!==denied}),[]);
 assert.deepEqual(choose([employee],{isBranchAllowed:undefined}),[]);
});
test('inactive blocked revoked and archived identities cannot be relief staff',()=>{
 for(const extra of [{active:false},{blocked:true},{archived:true},{status:' Resigned '},{status:'Terminated'},{pin:'REVOKED'},{scheduleEligible:false}])assert.deepEqual(choose([person('anj','Anj','Maa',extra)]),[]);
});
test('same-name identities and duplicate IDs are not guessed during relief selection',()=>{
 assert.deepEqual(choose([person('one','Shared'),person('two','Shared')]),[]);assert.deepEqual(choose([person('one','Anj'),person('one','Anj')]),[]);
 const rows=choose([person('one','Anj'),person('two','Joana','Maa',{scheduleAliases:['Anj']})],{dayBranches:{Maa:day({rest:['Anj']})}});assert.deepEqual(rows,[]);
});
test('duplicate standby entries and object-shaped standby do not authorize silent cleanup',()=>{
 const employees=[person('anj','Anj','Maa',{scheduleAliases:['Old Anj']})];
 for(const rest of [['Anj','Anj'],['Anj','Old Anj'],[{staffId:'anj',name:'Anj'}]])assert.deepEqual(choose(employees,{dayBranches:{Maa:day({rest})}}),[]);
});
test('a different explicit staff ID never blocks or recruits a similar name',()=>{
 const rows=choose([person('anj','Anj')],{dayBranches:{Maa:day({scheduled:{night:{staffId:'another',name:'Anj'}}})}});assert.equal(rows[0].staffId,'anj');
});
test('current-branch standby remains in its existing assignment category while home staff standing by elsewhere can return',()=>{
 assert.deepEqual(choose([person('anj','Anj')],{dayBranches:{Cabantian:day({rest:['Anj']})}}),[]);
 assert.deepEqual(choose([person('home','Home','Cabantian')]),[]);
 const rows=choose([person('home','Home','Cabantian')],{dayBranches:{Maa:day({rest:['Home']})}});assert.deepEqual(rows[0].standbySources,[{branch:'Maa',name:'Home'}]);
});
test('several authorized standby branches are returned precisely, without changing unrelated staff or flags',()=>{
 const employees=[person('anj','Anj')],dayBranches={Maa:day({rest:['Anj','Unrelated']}),Citygate:day({rest:['Anj'],unavailable:[{name:'Another Crew',status:'Leave'}]})},before=structuredClone(dayBranches);
 assert.deepEqual(choose(employees,{dayBranches})[0].standbySources,[{branch:'Citygate',name:'Anj'},{branch:'Maa',name:'Anj'}]);assert.deepEqual(dayBranches,before);
});
test('legacy records without stable IDs and ambiguous legacy names cannot become relief identities',()=>{
 assert.deepEqual(choose([{name:'Legacy',branch:'Maa'}]),[]);assert.deepEqual(choose([person('anj','Anj'),{name:'Anj',branch:'Maa'}]),[]);
});
