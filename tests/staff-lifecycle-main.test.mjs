import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
import {upsertScheduleEmployee,toScheduleEmployee} from '../takodeal-manager/schedule-staff-directory.js';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';
const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf('\nwindow.'+name+' = '),end=source.indexOf('\n};',start+1);assert.ok(start>=0&&end>start);return source.slice(start+1,end+3);};
const person=(id,status='Active',extra={})=>({id,cashierName:'Sample '+id,branch:'Maa',status,...extra});
function fixture(profiles=[person('current'),person('former','Offboarded'),person('revoked','Active',{pin:' revoked '}),person('flagged','Active',{isActive:false})]){
 const nodes=new Map(),calls={writes:[],deleted:0,notices:[],dialogs:[]},node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',innerText:'',style:{}});return nodes.get(id);};
 const user={uid:'owner',email:'jgo031996@gmail.com',emailVerified:true},session={uid:'owner',email:user.email,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']};
 const records=new Map(profiles.map(profile=>[profile.id,structuredClone(profile)]));
 const w={db:{},auth:{currentUser:user},sessionUser:session,showArchivedStaff:false,isBranchAllowed:()=>true,globalStaffData:{},ManagerUI:{notify:value=>calls.notices.push(value)},doc:(_db,table,id)=>({table,id}),serverTimestamp:()=> 'SAVED_SERVER_TIME',runTransaction:async(_db,work)=>work({get:async ref=>({exists:()=>records.has(ref.id),data:()=>structuredClone(records.get(ref.id))}),update:(ref,patch)=>{calls.writes.push({ref,patch});records.set(ref.id,{...records.get(ref.id),...patch});}}),updateStaffDisplay(){},updateAvailDropdown(){}};
 const Swal={fire:async(...args)=>{calls.dialogs.push(args);return {isConfirmed:true,value:'Archived after management review'};}};
 const ctx=vm.createContext({window:w,document:{getElementById:node},activeStaffProfile,upsertScheduleEmployee,canOpenWorkspacePage,staffDirectoryActorKey:()=>JSON.stringify([w.auth.currentUser?.uid,w.sessionUser.allowedBranches]),loadStaffDirectory:async()=>profiles.map(profile=>structuredClone(profile)),staffRateForDate:()=>450,Swal,employees:[],console});
 for(const name of ['loadHRModule','deleteCurrentStaff'])vm.runInContext(extract(name),ctx);
 return {w,ctx,node,calls,records,profiles};
}
test('the real Staff & Security directory archives every former state and excludes it from active counts and salary totals',async()=>{
 const f=fixture();await f.w.loadHRModule();assert.match(f.node('staffTableBody').innerHTML,/Sample current/);assert.doesNotMatch(f.node('staffTableBody').innerHTML,/Sample former|Sample revoked|Sample flagged/);assert.equal(f.node('hrActiveStaffCount').innerText,1);assert.equal(f.node('hrArchivedStaffCount').innerText,3);assert.equal(f.node('hrTotalDailyRate').innerText,'₱450.00');
 f.w.showArchivedStaff=true;await f.w.loadHRModule();assert.doesNotMatch(f.node('staffTableBody').innerHTML,/Sample current/);assert.match(f.node('staffTableBody').innerHTML,/Sample former/);assert.match(f.node('staffTableBody').innerHTML,/Sample revoked/);assert.match(f.node('staffTableBody').innerHTML,/Sample flagged/);assert.equal(Object.keys(f.w.globalStaffData).length,3);
});
test('legacy Delete Staff action archives one exact saved account without deleting or touching financial history',async()=>{
 const f=fixture([person('crew')]),profile=f.profiles[0];f.node('empProfileId').value='crew';f.node('empFullName').value=profile.cashierName;f.w.loadHRModule=async()=>{};f.w.employees=[toScheduleEmployee(profile,'crew')];f.w.scheduleDirectoryProfiles=[toScheduleEmployee(profile,'crew')];f.w.globalStaffData.crew=profile;
 await f.w.deleteCurrentStaff();assert.equal(f.calls.writes.length,1);assert.equal(f.calls.writes[0].ref.table,'cashiers');assert.equal(f.records.get('crew').status,'Archived');assert.equal(f.records.get('crew').pin,'REVOKED');assert.equal(f.w.employees.length,0);assert.equal(f.w.scheduleDirectoryProfiles[0].scheduleEligible,false);assert.match(f.calls.dialogs[0][0].text,/paid payslips, deductions and case history stay on file/);assert.equal('active' in f.calls.writes[0].patch,false,'no new sticky access flag is introduced');assert.doesNotMatch(extract('deleteCurrentStaff'),/deleteDoc\s*\(/);
});
test('archive action rejects a changed employee name or branch before writing',async()=>{
 for(const kind of ['name','branch']){const f=fixture([person('crew')]);f.node('empProfileId').value='crew';f.node('empFullName').value='Sample crew';if(kind==='name')f.records.get('crew').cashierName='Another saved person';else f.w.isBranchAllowed=()=>false;await f.w.deleteCurrentStaff();assert.equal(f.calls.writes.length,0);assert.match(f.calls.dialogs.at(-1)[1],/identity or branch changed/);}
});
