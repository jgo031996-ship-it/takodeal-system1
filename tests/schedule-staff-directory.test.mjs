import test from 'node:test';
import assert from 'node:assert/strict';
import {toScheduleEmployee,upsertScheduleEmployee,mergeScheduleEmployeeAliases,availableSchedulePoolStaff} from '../takodeal-manager/schedule-staff-directory.js';

const profile=(name,branch='Maa',extra={})=>({cashierName:name+' Full',scheduleNickname:name,branch,active:true,status:'Active',...extra});
const person=(id,name,branch='Maa',extra={})=>toScheduleEmployee(profile(name,branch,extra),id);
const clone=value=>structuredClone(value);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const emptyDay=()=>({scheduled:{morning:'UNFILLED'},rest:[],unavailable:[],swaps:{}});
const ids=value=>value.map(row=>row.staffId);

test('profile projection uses the document ID and exposes only scheduling metadata',()=>{
    const source=profile('  New   Hire ', ' Maa ',{staffId:'forged-id',id:'another-forged-id',pin:'SAMPLE-PRIVATE-48319',hourlyRate:480,phone:'PRIVATE PHONE',email:'private@example.test',bankAccount:'PRIVATE BANK',salaryRateTimeline:{secret:1},dateHired:'2030-12-01'});
    const projected=toScheduleEmployee(source,'actual-doc');
    assert.equal(projected.staffId,'actual-doc');assert.equal(projected.name,'New   Hire');assert.equal(projected.branch,'Maa');assert.equal(projected.dateHired,'2030-12-01');assert.equal(projected.scheduleEligible,true);
    for(const field of ['pin','hourlyRate','phone','email','bankAccount','salaryRateTimeline','id'])assert.equal(Object.hasOwn(projected,field),false);
    assert.doesNotMatch(JSON.stringify(projected),/PRIVATE|forged/);assert.equal(toScheduleEmployee(source,''),null);assert.equal(toScheduleEmployee(source,'bad/path'),null);
});

test('canonical names use a nonblank nickname then schedule name then full name',()=>{
    assert.equal(toScheduleEmployee({scheduleNickname:' ',scheduleName:' Saved  Alias ',cashierName:'Full Name',branch:'Maa'},'a').name,'Saved  Alias');
    assert.equal(toScheduleEmployee({cashierName:' Full  Name ',branch:'Maa'},'a').name,'Full  Name');
    assert.equal(toScheduleEmployee({cashierName:' ',branch:'Maa'},'a'),null);
});

test('display and saved names retain internal spaces and Unicode while comparisons normalize safely',()=>{
    const projected=toScheduleEmployee({cashierName:'  Ｊｏａｎａ  Mae ',name:'Former Alias',branch:'Maa'},'joana@example.test');
    assert.equal(projected.name,'Ｊｏａｎａ  Mae');assert.equal(projected.fullName,'Ｊｏａｎａ  Mae');assert.ok(projected.scheduleAliases.includes('Former Alias'));
    assert.deepEqual(availableSchedulePoolStaff({employees:[projected],branch:'Maa',dayData:{scheduled:{shift:'Joana Mae'}}}),[]);
});

test('valid Firestore IDs with dots, email syntax, spaces and Unicode are preserved exactly',()=>{
    for(const staffId of ['staff@example.test','staff.with.dots',' staff with spaces ','é'.repeat(750)])assert.equal(toScheduleEmployee(profile('Sample'),staffId).staffId,staffId);
    for(const staffId of ['', '.', '..', 'bad/path', 'bad\0id', 'é'.repeat(751)])assert.equal(toScheduleEmployee(profile('Sample'),staffId),null);
});

test('inactive evidence is projected without retaining PINs and survives another projection',()=>{
    for(const extra of [{active:false},{blocked:true},{archived:true},{status:' resigned '},{status:'Terminated'},{status:'REVOKED'},{pin:'REVOKED'},{pin:' blocked '}]){
        const projected=toScheduleEmployee(profile('Former','Maa',extra),'former');assert.equal(projected.scheduleEligible,false);assert.equal(Object.hasOwn(projected,'pin'),false);
        assert.equal(toScheduleEmployee(projected,'former').scheduleEligible,false);
        assert.deepEqual(availableSchedulePoolStaff({employees:[projected],branch:'Maa',dayData:emptyDay()}),[]);
    }
});

test('upsert replaces by stable ID across rename and home-branch transfer without duplicate rows',()=>{
    const old=[person('a','Old Nick'),person('a','Old Nick'),person('b','Other')],previous=profile('Old Nick');
    const result=upsertScheduleEmployee(freeze(old),freeze(profile('New Nick','Citygate')),'a',{previousProfile:freeze(previous)});
    assert.equal(result.filter(row=>row.staffId==='a').length,1);const changed=result.find(row=>row.staffId==='a');
    assert.equal(changed.branch,'Citygate');assert.equal(changed.name,'New Nick');assert.ok(changed.scheduleAliases.includes('Old Nick'));assert.equal(result.find(row=>row.staffId==='b').name,'Other');
    assert.equal(old[0].name,'Old Nick');assert.equal(old[0].branch,'Maa');
});

test('a unique exact legacy full name can bind to a current profile but prefixes cannot',()=>{
    const legacy=[{name:'Old Nick',fullName:'Exact Full Name',branch:'Cabantian'}];
    const result=upsertScheduleEmployee(freeze(legacy),{cashierName:'Exact Full Name',scheduleNickname:'New Nick',branch:'Maa'},'a');
    assert.equal(result.length,1);assert.equal(result[0].staffId,'a');assert.ok(result[0].scheduleAliases.includes('Old Nick'));
    const different=upsertScheduleEmployee([{name:'Joana',branch:'Maa'}],{cashierName:'Jo',branch:'Maa'},'jo');
    assert.equal(different.length,2);assert.equal(different[0].name,'Joana');assert.equal(different[0].staffId,undefined);
});

test('legacy alias fallback never takes over a differently linked account',()=>{
    const original=[{name:'Shared',fullName:'Exact Full',branch:'Maa'},person('foreign','Shared')];
    const result=upsertScheduleEmployee(original,{cashierName:'Exact Full',scheduleNickname:'Fresh',branch:'Maa'},'new',{previousProfile:{cashierName:'Exact Full',scheduleNickname:'Shared',branch:'Maa'}});
    assert.equal(result.find(row=>row.staffId==='foreign').name,'Shared');assert.ok(result.some(row=>!row.staffId&&row.name==='Shared'));
    assert.equal(result.find(row=>row.staffId==='new').scheduleAliases.includes('Shared'),false);
});

test('an inactive update removes only its stable account and does not expose private source data',()=>{
    const original=freeze([person('a','One'),person('b','Two')]);
    const result=upsertScheduleEmployee(original,profile('One','Maa',{pin:'REVOKED'}),'a');
    assert.deepEqual(ids(result),['b']);assert.equal(original.length,2);assert.doesNotMatch(JSON.stringify(result),/REVOKED|pin/);
});

test('a previous profile linked to another ID cannot contribute historical aliases',()=>{
    const result=upsertScheduleEmployee([],profile('Current'),'a',{previousProfile:{staffId:'foreign',cashierName:'Foreign Old Name',scheduleNickname:'Foreign'}});
    assert.equal(result[0].scheduleAliases.includes('Foreign'),false);assert.equal(result[0].scheduleAliases.includes('Foreign Old Name'),false);
});

test('saved snapshots enrich aliases only; current directory controls membership, branch and activity',()=>{
    const directory=freeze([person('a','Current','Maa'),person('inactive','Inactive','Maa',{active:false})]);
    const saved=freeze([{staffId:'a',name:'Old Nick',branch:'Cabantian',status:'Resigned'},{staffId:'ghost',name:'Old Ghost',branch:'Maa'}]);
    const result=mergeScheduleEmployeeAliases(directory,saved);assert.deepEqual(ids(result),['a']);assert.equal(result[0].branch,'Maa');assert.equal(result[0].scheduleEligible,true);assert.ok(result[0].scheduleAliases.includes('Old Nick'));
    assert.equal(result[0].name,'Current');assert.equal(directory[0].scheduleAliases.includes('Old Nick'),false);
});

test('snapshot aliases may match a unique unlinked full name, but a foreign ID cannot donate names',()=>{
    const directory=[toScheduleEmployee({cashierName:'Exact Full',scheduleNickname:'New',branch:'Maa'},'a')];
    const matched=mergeScheduleEmployeeAliases(directory,[{name:'Old',fullName:'Exact Full',branch:'Maa'}]);assert.ok(matched[0].scheduleAliases.includes('Old'));
    const foreign=mergeScheduleEmployeeAliases(directory,[{staffId:'other',name:'Foreign Old',fullName:'Exact Full',branch:'Maa'}]);assert.equal(foreign[0].scheduleAliases.includes('Foreign Old'),false);
});

test('historical aliases claimed by another current account are not copied into a rename',()=>{
    const directory=[person('a','New'),person('b','Old')],saved=[{staffId:'a',name:'Old',branch:'Maa'}];
    const result=mergeScheduleEmployeeAliases(directory,saved);assert.equal(result.find(row=>row.staffId==='a').scheduleAliases.includes('Old'),false);
});

test('new same-branch hires absent from a saved day are offered without editing the roster',()=>{
    const employees=freeze([person('existing','Existing'),person('new','New Hire','Maa',{dateHired:'2099-01-01'}),person('other','Other Branch','Citygate')]);
    const day=freeze({scheduled:{morning:'UNFILLED'},rest:['Existing'],unavailable:[],swaps:{}}),before=JSON.stringify(day);
    assert.deepEqual(ids(availableSchedulePoolStaff({employees,branch:'Maa',dayData:day})),['new']);assert.equal(JSON.stringify(day),before);
    assert.equal(employees[1].dateHired,'2099-01-01');
});

test('scheduled, standby and unavailable references anywhere in the saved day exclude the account',()=>{
    const employees=[person('a','Assigned'),person('b','Standby'),person('c','Off'),person('d','Available')];
    const dayBranches=freeze({Maa:emptyDay(),Citygate:{scheduled:{shift:'Assigned'},rest:[{staffId:'b',name:'Old Standby Name'}],unavailable:[{staffId:'c',name:'Old Off Name',status:'Leave',leaveRequestId:'leave-c'}]}});
    assert.deepEqual(ids(availableSchedulePoolStaff({employees,branch:'Maa',dayData:dayBranches.Maa,dayBranches})),['d']);
});

test('selected-date global leave/off markers block new hires even before the roster was regenerated',()=>{
    const employees=[person('a','Leave'),person('b','Day Off'),person('c','Clear')],flags=freeze({Leave:{status:'Leave',staffId:'a',leaveRequestId:'approved-leave'},'Day Off':'Day Off'});
    assert.deepEqual(ids(availableSchedulePoolStaff({employees,branch:'Maa',dayData:emptyDay(),unavailability:flags})),['c']);
    const released=availableSchedulePoolStaff({employees,branch:'Maa',dayData:emptyDay(),unavailability:{}});assert.deepEqual(new Set(ids(released)),new Set(['a','b','c']));assert.equal(flags.Leave.leaveRequestId,'approved-leave');
});

test('dated former nicknames still reserve their exact stable account',()=>{
    const employees=mergeScheduleEmployeeAliases([person('a','New'),person('b','Clear')],[{staffId:'a',name:'Former Alias',branch:'Maa'}]);
    const day={scheduled:{morning:'Former Alias'},rest:[],unavailable:[]};
    assert.deepEqual(ids(availableSchedulePoolStaff({employees,branch:'Maa',dayData:day})),['b']);
});

test('ambiguous canonical names and ambiguous dated aliases never choose a first match',()=>{
    const same=[person('a','Same'),person('b','Same')];assert.deepEqual(availableSchedulePoolStaff({employees:same,branch:'Maa',dayData:emptyDay()}),[]);
    const aliases=[{...person('a','Alpha'),scheduleAliases:['Shared Old']},{...person('b','Beta'),scheduleAliases:['Shared Old']},person('c','Clear')];
    assert.deepEqual(ids(availableSchedulePoolStaff({employees:aliases,branch:'Maa',dayData:{scheduled:{shift:'Shared Old'}}})),['c']);
});

test('exact IDs do not fall back to another person’s name and name prefixes do not match',()=>{
    const employees=[person('jo','Jo'),person('joana','Joana'),person('other','Other')];
    const out=availableSchedulePoolStaff({employees,branch:'Maa',dayData:{scheduled:{first:'Jo'},unavailable:[{staffId:'not-in-directory',name:'Joana'}]}});
    assert.deepEqual(new Set(ids(out)),new Set(['joana','other']));
    assert.deepEqual(ids(availableSchedulePoolStaff({employees,branch:'Maa',dayData:{rest:[{staffId:'joana',name:'Unrelated label'}]}})),['jo','other']);
});

test('conflicting repeated IDs are held rather than choosing a stale directory version',()=>{
    const employees=[person('a','One','Maa'),person('a','One','Citygate'),person('b','Clear')];
    assert.deepEqual(ids(availableSchedulePoolStaff({employees,branch:'Maa',dayData:emptyDay()})),['b']);
    assert.deepEqual(ids(mergeScheduleEmployeeAliases(employees,[])),['b']);
});

test('pure directory operations never autoassign, rewrite another date or change historical branches',()=>{
    const history=freeze({currentSchedule:{27:{Maa:{scheduled:{morning:'Old Alias'},rest:[],unavailable:[]}},28:{Maa:emptyDay()}},employees:[{staffId:'a',name:'Old Alias',branch:'Citygate'}]});
    const before=JSON.stringify(history),live=mergeScheduleEmployeeAliases([person('a','New','Maa')],history.employees);
    const moved=upsertScheduleEmployee(live,profile('New','Cabantian'),'a');availableSchedulePoolStaff({employees:moved,branch:'Cabantian',dayData:history.currentSchedule[28].Maa});
    assert.equal(JSON.stringify(history),before);assert.equal(history.currentSchedule[27].Maa.scheduled.morning,'Old Alias');assert.equal(history.employees[0].branch,'Citygate');
});
