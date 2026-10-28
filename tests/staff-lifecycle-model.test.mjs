import test from 'node:test';
import assert from 'node:assert/strict';
import {staffLifecycleState,activeStaffProfile,createStaffHistoryResolver,staffHistoryView} from '../takodeal-manager/staff-lifecycle-model.js';
import {classifyPayrollRosterEntry} from '../takodeal-manager/payroll-roster-model.js';
const person=(id,name='Sample Crew',extra={})=>({id,cashierName:name,branch:'Maa',status:'Active',...extra});
for(const field of ['status','employmentStatus'])for(const state of ['Resigned',' rEvOkEd ','OFFBOARDED','Archived','Terminated','blocked','Deleted'])test('inactive '+field+' '+state+' overrides active hints',()=>{assert.equal(activeStaffProfile(person('a','Sample',{active:true,[field]:state})),false);});
test('all saved inactivity flags and revoked PIN variants are recognized',()=>{
 for(const extra of [{active:false},{isActive:false},{archived:true},{isArchived:true},{deleted:true},{isDeleted:true},{revoked:true},{offboarded:true},{blocked:true},{disabled:true},{pin:' revoked '},{pin:'BLOCKED'}])assert.equal(activeStaffProfile(person('a','Sample',extra)),false,JSON.stringify(extra));
 assert.equal(staffLifecycleState(null).missing,true);
});
test('contract expiry or renewal alone never offboards an active employee',()=>{
 for(const contractStatus of ['Expired','Finished contract','Contract ended','Pending Renewal','Pending Initial Contract','Signed'])assert.equal(activeStaffProfile(person('a','Sample',{contractStatus,contractEnd:'2020-01-01'})),true,contractStatus);
 for(const contractStatus of ['Resigned','Offboarded','Revoked','Terminated'])assert.equal(activeStaffProfile(person('a','Sample',{contractStatus})),false);
});
test('explicit account ID wins over a colliding former employee name',()=>{
 const current=person('new'),old=person('old','Sample Crew',{status:'Revoked'}),resolve=createStaffHistoryResolver([old,current]);
 assert.equal(resolve({staffId:'new',staffName:'Sample Crew',branch:'Maa'}).status,'active');
 assert.equal(resolve({staffId:'old',staffName:'Sample Crew',branch:'Maa'}).status,'archived');
 assert.equal(resolve({staffName:'Sample Crew',branch:'Maa'}).status,'identity-review');
});
test('missing or conflicting IDs never fall back to another matching active name',()=>{
 const resolve=createStaffHistoryResolver([person('a'),person('b','Different Crew')]);
 for(const row of [{staffId:'gone',staffName:'Sample Crew'},{staffId:'bad/path',staffName:'Sample Crew'},{staffId:'b',staffName:'Sample Crew'}])assert.equal(resolve(row).status,'identity-review');
});
test('unique exact saved aliases bind, prefix and fuzzy names never do',()=>{
 const resolve=createStaffHistoryResolver([person('a','Sample Crew',{scheduleNickname:'Sam',scheduleAliases:['Earlier Sample']})]);
 for(const staffName of ['Sam','  Ｓａｍ  ','Earlier Sample'])assert.equal(resolve({staffName,branch:'Maa'}).staffId,'a');
 for(const staffName of ['Samp','Sample Creu','Sample'])assert.equal(resolve({staffName,branch:'Maa'}).status,'identity-review');
 assert.equal(resolve({staffName:'Sam',branch:'Cabantian'}).status,'identity-review');
});
test('duplicate IDs and alias collisions stay separately reviewable',()=>{
 const duplicate=createStaffHistoryResolver([person('a'),person('a')]);assert.equal(duplicate({staffId:'a'}).status,'identity-review');
 const resolve=createStaffHistoryResolver([person('a','First',{scheduleNickname:'Same'}),person('b','Second',{scheduleNickname:'Same',status:'Resigned'})]);
 assert.equal(resolve('Same').status,'identity-review');assert.equal(resolve({staffId:'a',staffName:'Same'}).status,'active');
});

test('an explicit ID with a blank saved display name remains identity review',()=>{
 const resolve=createStaffHistoryResolver([{id:'blank',cashierName:' ',fullName:'',name:'',branch:'Maa',active:true}]);
 assert.equal(resolve({staffId:'blank',staffName:'Old recorded name',branch:'Maa'}).status,'identity-review');
});
test('active/archive/all views preserve every source object and balance',()=>{
 const profiles=[person('active'),person('former','Former Crew',{pin:'REVOKED'})],rows=[{id:'r1',staffId:'active',staffName:'Sample Crew',amount:25},{id:'r2',staffId:'former',staffName:'Former Crew',amount:100},{id:'r3',staffId:'missing',staffName:'Unknown',amount:70}],before=structuredClone(rows);
 assert.deepEqual(staffHistoryView(rows,profiles).map(entry=>entry.row.id),['r1']);
 assert.deepEqual(staffHistoryView(rows,profiles,{view:'archived'}).map(entry=>entry.row.id),['r2','r3']);
 assert.equal(staffHistoryView(rows,profiles,{view:'all'}).length,3);assert.equal(staffHistoryView(rows,profiles,{view:'all'})[0].row,rows[0]);assert.deepEqual(rows,before);
});
test('former employee paid payroll and final cutoff earnings remain eligible history',()=>{
 const profile=person('former','Former Crew',{employmentStatus:'Offboarded'});
 assert.equal(classifyPayrollRosterEntry({profile,isPaid:true}).category,'paid');
 assert.equal(classifyPayrollRosterEntry({profile,data:{totalHours:8}}).category,'former-cutoff-work');
 assert.equal(classifyPayrollRosterEntry({profile,data:{foodDeductions:100}}).category,'former-balance');
 assert.equal(classifyPayrollRosterEntry({profile,data:{totalHours:8}}).holdPayment,false);
});
