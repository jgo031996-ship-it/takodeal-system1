import test from 'node:test';
import assert from 'node:assert/strict';
import {canExportSopBranch,loadSopChecklistExport} from '../takodeal-manager/sop-checklist-export-service.js';

const branch='Sample Branch',other='Other Branch';
const saved={roles:{'Night Kitchen':['Clean preparation station','Check stock\nRecord remaining portions'],'Opening Cashier':['Count float','Check receipt paper'],'Empty role':[]}};
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};
function fixture({roles=saved.roles,permissions=['sop'],allowedBranches=[branch],franchise=false,email='manager@example.test',metadata={fromCache:false,hasPendingWrites:false},exists=true}={}){
 let current={roles:structuredClone(roles)},writes=0;const reads=[];
 const api={db:{},auth:{currentUser:{uid:'sample-hq',email,emailVerified:true}},sessionUser:{uid:'sample-hq',email,permissions,allowedBranches,isFranchisee:franchise,isOwner:permissions.includes('all')},globalSopData:{'Old cached role':['Old task']},isBranchAllowed:()=>true,
  doc:(_db,table,id)=>({table,id}),getDocFromServer:async reference=>{reads.push(reference);assert.deepEqual(reference,{table:'settings',id:'sop_'+branch},'Read only the selected saved checklist, never business records.');return{exists:()=>exists,data:()=>structuredClone(current),metadata};},
  getDoc:()=>{throw Error('A cache-capable read must never be used for this reference export.');}};
 for(const method of ['setDoc','updateDoc','addDoc','deleteDoc','runTransaction','writeBatch'])api[method]=()=>{writes++;throw Error('Reference export must never write business data.');};
 return{api,reads,set roles(value){current={roles:structuredClone(value)};},get writes(){return writes;}};
}

test('export reads the latest saved server checklist, preserves task order and includes every requested role without cache globals',async()=>{
 const h=fixture();h.roles={...saved.roles,'Updated role':['Newly saved first','Newly saved second']};const result=await loadSopChecklistExport(h.api,{branch,scope:'branch'});assert.equal(result.branch,branch);assert.deepEqual(new Set(result.roles.map(row=>row.name)),new Set([...Object.keys(saved.roles),'Updated role']));assert.deepEqual(result.roles.find(row=>row.name==='Updated role').tasks,['Newly saved first','Newly saved second']);assert.deepEqual(result.roles.find(row=>row.name==='Night Kitchen').tasks,saved.roles['Night Kitchen']);assert.deepEqual(result.roles.find(row=>row.name==='Empty role').tasks,[]);assert.equal(result.roles.some(row=>row.name==='Old cached role'),false);assert.ok(Number.isFinite(Date.parse(result.generatedAt)));assert.equal(h.reads.length,1);assert.equal(h.writes,0);
});

test('selected role exports only that exact saved role, with no inferred fallback to other duties',async()=>{
 const h=fixture(),result=await loadSopChecklistExport(h.api,{branch,role:'Opening Cashier',scope:'selected'});assert.deepEqual(result.roles,[{name:'Opening Cashier',tasks:['Count float','Check receipt paper']}]);await assert.rejects(loadSopChecklistExport(h.api,{branch,role:'Removed role',scope:'selected'}),/role|saved|available/i);assert.equal(h.writes,0);
});

test('SOP export honors exact granted branch even when legacy isBranchAllowed incorrectly permits every branch',async()=>{
 const h=fixture();assert.equal(canExportSopBranch(h.api,branch),true);assert.equal(canExportSopBranch(h.api,other),false);await assert.rejects(loadSopChecklistExport(h.api,{branch:other,scope:'branch'}),/access|branch|assigned|allowed/i);assert.equal(h.reads.length,0);assert.equal(h.writes,0);
});

test('all-tab and isOwner flags cannot bypass branch scope; only the verified master Owner has the existing global exception',()=>{
 const limited=fixture({permissions:['all']});assert.equal(limited.api.sessionUser.isOwner,true);assert.equal(canExportSopBranch(limited.api,other),false);
 const manager=fixture({permissions:['sop'],allowedBranches:['All']});assert.equal(canExportSopBranch(manager.api,other),true);
 const franchise=fixture({permissions:['all'],allowedBranches:['All'],franchise:true});assert.equal(canExportSopBranch(franchise.api,other),false);
 const owner=fixture({email:'jgo031996@gmail.com',permissions:[],allowedBranches:[]});assert.equal(canExportSopBranch(owner.api,other),true);owner.api.auth.currentUser.emailVerified=false;assert.equal(canExportSopBranch(owner.api,other),false);
});

test('missing SOP permission, unverified sign-in or mismatched unlocked identity fails before any server read',async()=>{
 for(const mutate of [api=>api.sessionUser.permissions=['payroll','inventory','admin'],api=>api.auth.currentUser.emailVerified=false,api=>api.sessionUser.uid='different',api=>api.sessionUser.email='other@example.test',api=>api.auth.currentUser=null]){const h=fixture();mutate(h.api);assert.equal(canExportSopBranch(h.api,branch),false);await assert.rejects(loadSopChecklistExport(h.api,{branch,scope:'branch'}));assert.equal(h.reads.length,0);assert.equal(h.writes,0);}
});

test('unconfirmed cache or pending writes, missing checklist and malformed saved tasks never become a reference PDF payload',async()=>{
 for(const options of [{metadata:{fromCache:true}},{metadata:{hasPendingWrites:true}},{exists:false},{roles:{Broken:{task:'not an ordered array'}}},{roles:{Broken:['Valid task',null]}}]){const h=fixture(options);await assert.rejects(loadSopChecklistExport(h.api,{branch,scope:'branch'}));assert.equal(h.writes,0);}
});

test('unsaved task changes block export while equivalent trimmed editor rows match the saved selected role',async()=>{
 const h=fixture();const exact=await loadSopChecklistExport(h.api,{branch,role:'Opening Cashier',scope:'selected',draftTasks:['  Count float  ','',' Check receipt paper ']});assert.equal(exact.roles[0].tasks.length,2);await assert.rejects(loadSopChecklistExport(h.api,{branch,role:'Opening Cashier',scope:'branch',draftTasks:['Count float','A new unsaved checklist task']}),/save|reload|unsaved|changed/i);assert.equal(h.writes,0);
});

test('all-role export refuses a removed selected role when its displayed draft would otherwise be silently omitted',async()=>{
 const h=fixture();await assert.rejects(loadSopChecklistExport(h.api,{branch,role:'Removed role',scope:'branch',draftTasks:['This task is still visible in the builder']}),/role.*no longer saved|reload/i);assert.equal(h.writes,0);
});

test('a held server response cannot export after account, branch scope or permission changes',async()=>{
 for(const mutate of [api=>api.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true},api=>api.sessionUser.allowedBranches=[other],api=>api.sessionUser.permissions=[]]){const h=fixture(),gate=deferred(),read=h.api.getDocFromServer;h.api.getDocFromServer=async reference=>{await gate.promise;return read(reference);};const pending=loadSopChecklistExport(h.api,{branch,scope:'branch'});await Promise.resolve();mutate(h.api);gate.resolve();await assert.rejects(pending,/changed|access|sign|permission|account|branch/i);assert.equal(h.writes,0);}
});

test('the UI current-selection guard runs before querying and again before publishing the saved reference',async()=>{
 const before=fixture();await assert.rejects(loadSopChecklistExport(before.api,{branch,scope:'branch',assertCurrent(){throw Error('Selection changed');}}),/Selection changed/);assert.equal(before.reads.length,0);
 const h=fixture(),gate=deferred(),read=h.api.getDocFromServer;let current=true;h.api.getDocFromServer=async reference=>{await gate.promise;return read(reference);};const pending=loadSopChecklistExport(h.api,{branch,scope:'branch',assertCurrent(){if(!current)throw Error('Selection changed');}});await Promise.resolve();current=false;gate.resolve();await assert.rejects(pending,/Selection changed/);assert.equal(h.writes,0);
});

test('deadline retries retain one physical server read until it settles, then a subsequent download reads fresh data again',async()=>{
 const h=fixture(),gate=deferred(),read=h.api.getDocFromServer;let calls=0;h.api.getDocFromServer=async reference=>{calls++;await gate.promise;return read(reference);};
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(loadSopChecklistExport(h.api,{branch,scope:'branch'},{timeoutMs:5}),/could not be confirmed/);assert.equal(calls,1);gate.resolve();await new Promise(resolve=>setImmediate(resolve));h.roles={'Latest saved role':['A task saved after the earlier read settled']};const result=await loadSopChecklistExport(h.api,{branch,scope:'branch'});assert.equal(calls,2);assert.deepEqual(result.roles,[{name:'Latest saved role',tasks:['A task saved after the earlier read settled']}]);assert.equal(h.writes,0);
});

test('coalesced readers keep independent UI guards and a late failed read does not block a later retry',async()=>{
 const h=fixture(),gate=deferred(),read=h.api.getDocFromServer;let calls=0,firstCurrent=true;h.api.getDocFromServer=async reference=>{calls++;await gate.promise;return read(reference);};const first=loadSopChecklistExport(h.api,{branch,scope:'branch',assertCurrent(){if(!firstCurrent)throw Error('First selection changed');}}),second=loadSopChecklistExport(h.api,{branch,scope:'branch'});firstCurrent=false;gate.resolve();await assert.rejects(first,/First selection changed/);assert.equal((await second).roles.length,3);assert.equal(calls,1);
 const failing=fixture(),failedGate=deferred();failing.api.getDocFromServer=()=>failedGate.promise;await assert.rejects(loadSopChecklistExport(failing.api,{branch,scope:'branch'},{timeoutMs:5}),/could not be confirmed/);failedGate.reject(Error('Late cloud failure'));await new Promise(resolve=>setImmediate(resolve));failing.api.getDocFromServer=async()=>({exists:()=>true,data:()=>saved,metadata:{fromCache:false,hasPendingWrites:false}});assert.equal((await loadSopChecklistExport(failing.api,{branch,scope:'branch'})).roles.length,3);assert.equal(failing.writes,0);
});

test('different branches or a newly signed-in account never reuse another pending scope read',async()=>{
 const h=fixture({allowedBranches:[branch,other]}),requests=[];h.api.getDocFromServer=reference=>{const gate=deferred();requests.push({reference,uid:h.api.auth.currentUser.uid,gate});return gate.promise;};const first=loadSopChecklistExport(h.api,{branch,scope:'branch'}),second=loadSopChecklistExport(h.api,{branch:other,scope:'branch'});h.api.auth.currentUser={uid:'new-hq',email:'new@example.test',emailVerified:true};h.api.sessionUser={...h.api.sessionUser,uid:'new-hq',email:'new@example.test'};const third=loadSopChecklistExport(h.api,{branch,scope:'branch'});assert.equal(requests.length,3);assert.deepEqual(requests.map(row=>row.reference.id),['sop_'+branch,'sop_'+other,'sop_'+branch]);assert.deepEqual(requests.map(row=>row.uid),['sample-hq','sample-hq','new-hq']);const oldFirst=assert.rejects(first,/changed/),oldSecond=assert.rejects(second,/changed/);for(const request of requests)request.gate.resolve({exists:()=>true,data:()=>saved,metadata:{fromCache:false,hasPendingWrites:false}});await Promise.all([oldFirst,oldSecond]);assert.equal((await third).roles.length,3);assert.equal(h.writes,0);
});
