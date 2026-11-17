import test from 'node:test';
import assert from 'node:assert/strict';
import {protectStaffEdits,sharedProfileValues,watchEmployeeProfile} from '../takodeal-manager/employee-profile-sync.js';
import {OWNER_EMAIL} from '../takodeal-manager/workspace-access-model.js';
test('an open Owner form follows only its selected employee, masks PIN state and retains local edits',()=>{
 const id='s1',record={branch:'Test',phone:'old',email:'old@example.test',gcashNumber:'legacy',loginPinVersion:1},nodes=new Map();
 const node=k=>{if(!nodes.has(k))nodes.set(k,{value:'',style:{display:'flex'},textContent:''});return nodes.get(k);};
 const d={hidden:false,getElementById:node};node('empProfileId').value=id;
 let next,stopped=0;const api={auth:{currentUser:{uid:'owner',email:OWNER_EMAIL,emailVerified:true}},sessionUser:{uid:'owner',email:OWNER_EMAIL,role:'Owner',isOwner:true,allowedBranches:['All'],permissions:['branches']},
  globalStaffData:{[id]:record},staffProfileBaseline:{id},doc:(_,table,key)=>{assert.equal(table,'cashiers');assert.equal(key,id);return key;},onSnapshot:(_ref,_opts,notify)=>{next=notify;return()=>stopped++;}};
 watchEmployeeProfile(api,d,id);assert.equal(node('empGcashNum').value,'legacy');
 node('empEmail').value='draft@example.test';
 next({exists:()=>true,data:()=>({...record,phone:'new',email:'staff@example.test',pin:'synthetic',payslipPinManaged:true,loginPinVersion:2})});
 assert.equal(node('empPhone').value,'new');assert.equal(node('empEmail').value,'draft@example.test');assert.equal(node('empPin').value,'');
 assert.equal(api.staffProfileBaseline.pinVersion,2);assert.match(node('employeeLiveProfileStatus').textContent,/field you are editing/);
 api.stopEmployeeProfileSync();next({exists:()=>true,data:()=>({...record,phone:'too late'})});assert.equal(stopped,1);assert.equal(node('empPhone').value,'new');
});
test('an older Owner form cannot undo newer Staff details when saving another field',()=>{
 const original={phone:'old',gcashNum:'account',email:'old@example.test'},latest={...original,phone:'new',gcashNum:'updated'};
 assert.deepEqual(protectStaffEdits({...original,role:'Crew'},sharedProfileValues(original),latest),{role:'Crew'});
 assert.throws(()=>protectStaffEdits({phone:'other'},sharedProfileValues(original),latest),/also edited/);
 assert.deepEqual(protectStaffEdits({email:'new@example.test'},sharedProfileValues(original),latest),{email:'new@example.test'});
});
