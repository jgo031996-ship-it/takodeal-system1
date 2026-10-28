import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {loadStaffDirectory,staffDirectoryActorKey} from '../takodeal-manager/staff-directory-reader.js';
import {loadStaffSalaryTimeline,staffRateForDate} from '../takodeal-manager/staff-rate-model.js';
import {nightRate,scheduledShiftForDate} from '../takodeal-manager/payroll-safety.js';
import {activeStaffProfile} from '../takodeal-manager/staff-lifecycle-model.js';
const hold=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForReads(f,count){const deadline=performance.now()+2000;while(f.reads.length<count){assert.ok(performance.now()<deadline,'The actual handler must reach its expected directory reads');await new Promise(resolve=>setImmediate(resolve));}}
function fixture({count=12,delay=0,manager=false}={}){
 const h=firestoreHarness(),reads=[],profileReads=[];let active=0,max=0,ended=0;
 const email=manager?'sample-manager@example.test':'jgo031996@gmail.com';h.api.auth={currentUser:{uid:'sample-user',email,emailVerified:true}};h.api.sessionUser={uid:'sample-user',email,role:manager?'Manager':'Owner',isOwner:!manager,permissions:['branches','payroll'],allowedBranches:manager?['Maa']:['All']};
 for(let index=0;index<count;index++){const id='staff-'+index,branch=index%2?'Maa':'Cabantian',revision='rate-'+index;h.put('cashiers/'+id,{id:'untrusted-profile-id',staffId:'untrusted-staff-id',cashierName:'Sample '+index,branch,hourlyRate:450,salaryRateVersion:1,salaryRateRevision:revision});h.put('staff_salary_rates/'+id,{version:1,staffId:id,branch,revision:1,revisionId:revision,baselineDailyRate:400,rates:{[revision]:{effectiveDate:'2026-10-01',dailyRate:450,sequence:1}}});}
 const original=h.api.getDocsFromServer;h.api.getDocsFromServer=async reference=>{profileReads.push(reference);const snapshot=await original(reference);return {...snapshot,metadata:{fromCache:false,hasPendingWrites:false}};};
 h.api.getDocFromServer=async reference=>{reads.push(reference.path);active++;max=Math.max(max,active);try{if(delay)await wait(delay);return {id:reference.id,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.docs.has(reference.path),data:()=>structuredClone(h.get(reference.path))};}finally{active--;ended++;}};
 return {h,api:h.api,reads,profileReads,active:()=>active,max:()=>max,ended:()=>ended};
}

for(const latency of [100,200])test('fresh private salary reads retain all results while bounded concurrency removes serial '+latency+'ms network waves',async t=>{
 const serial=fixture({delay:latency}),parallel=fixture({delay:latency}),read=await serial.api.getDocsFromServer(serial.api.collection(serial.api.db,'cashiers'));let start=performance.now();const before=[];for(const row of read.docs)before.push(await loadStaffSalaryTimeline(serial.api,{...row.data(),id:row.id,staffId:row.id}));const serialMs=performance.now()-start;
 start=performance.now();const after=await loadStaffDirectory(parallel.api);const parallelMs=performance.now()-start;
 assert.equal(before.length,12);assert.equal(after.length,12);assert.deepEqual(after.map(profile=>staffRateForDate(profile,'2026-10-21')),before.map(profile=>staffRateForDate(profile,'2026-10-21')));assert.equal(serial.reads.length,12);assert.equal(parallel.reads.length,12);assert.equal(serial.max(),1);assert.equal(parallel.max(),4);assert.equal(parallel.active(),0);assert.equal(parallel.profileReads.length,1);
 t.diagnostic(JSON.stringify({documentLatencyMs:latency,staffDocuments:12,directoryQueries:1,serialSalaryWaves:12,parallelSalaryWaves:3,serialObservedMs:Math.round(serialMs),parallelObservedMs:Math.round(parallelMs),parallelMaxInFlight:parallel.max()}));
});

test('Manager directory queries and salary documents stay within saved branch scope and document IDs win over stored id fields',async()=>{
 const f=fixture({manager:true}),rows=await loadStaffDirectory(f.api);assert.equal(rows.length,6);assert.equal(f.profileReads.length,1);assert.deepEqual(f.profileReads[0].filters,[{key:'branch',value:'Maa'}]);assert.equal(f.reads.length,6);assert.ok(rows.every(row=>row.branch==='Maa'&&row.id===row.staffId&&row.id!=='untrusted-profile-id'));assert.ok(f.reads.every(path=>Number(path.split('-').at(-1))%2===1));
 const selected=fixture();assert.equal((await loadStaffDirectory(selected.api,{selectedBranch:'Maa'})).length,6);assert.equal(selected.profileReads.length,1);assert.deepEqual(selected.profileReads[0].filters,[{key:'branch',value:'Maa'}]);
});

test('each later visit reads current server profiles and salary history again without a wage or permission cache',async()=>{
 const f=fixture({count:1});assert.equal(staffRateForDate((await loadStaffDirectory(f.api))[0],'2026-10-21'),450);f.h.put('cashiers/staff-0',{...f.h.get('cashiers/staff-0'),salaryRateRevision:'new-revision'});f.h.put('staff_salary_rates/staff-0',{...f.h.get('staff_salary_rates/staff-0'),revision:2,revisionId:'new-revision',rates:{updated:{effectiveDate:'2026-10-01',dailyRate:480,sequence:2}}});assert.equal(staffRateForDate((await loadStaffDirectory(f.api))[0],'2026-10-21'),480);assert.equal(f.profileReads.length,2);assert.equal(f.reads.length,2);
});

test('hidden archived rates and filtered inactive OT profiles perform no unnecessary private reads',async()=>{
 const f=fixture({count:4});f.h.put('cashiers/staff-1',{...f.h.get('cashiers/staff-1'),status:'Resigned'});f.h.put('cashiers/staff-2',{...f.h.get('cashiers/staff-2'),pin:'REVOKED'});f.h.put('cashiers/staff-3',{...f.h.get('cashiers/staff-3'),salaryRateVersion:0});
 const hr=await loadStaffDirectory(f.api,{readRates:profile=>profile.status!=='Resigned'});assert.equal(hr.length,4);assert.deepEqual(f.reads.sort(),['staff_salary_rates/staff-0','staff_salary_rates/staff-2']);f.reads.length=0;
 const overtime=await loadStaffDirectory(f.api,{page:'payroll',profileFilter:profile=>profile.status!=='Resigned'&&profile.pin!=='REVOKED'});assert.deepEqual(overtime.map(row=>row.id),['staff-0','staff-3']);assert.deepEqual(f.reads,['staff_salary_rates/staff-0']);
});

test('a private rate failure can be labelled unavailable for the directory but cannot supply an invented wage to overtime',async()=>{
 for(const failure of ['denied','cache','missing','revision']){const f=fixture({count:1}),read=f.api.getDocFromServer;f.api.getDocFromServer=async reference=>{if(failure==='denied')throw Error('Permission denied');const snapshot=await read(reference);if(failure==='cache')snapshot.metadata.fromCache=true;if(failure==='missing')snapshot.exists=()=>false;if(failure==='revision')snapshot.data=()=>({...f.h.get(reference.path),revisionId:'different'});return snapshot;};const row=(await loadStaffDirectory(f.api,{allowPartialRates:true}))[0];assert.equal(row.salaryRateUnavailable,true);assert.equal(row.salaryRateTimeline,undefined);await assert.rejects(loadStaffDirectory(f.api,{page:'payroll'}),/Permission|history|dates changed/);}
});

test('switching account, session, role, permissions or branch access stops queued reads and returns no stale directory',async()=>{
 for(const change of ['account','session','role','permissions','branches']){const f=fixture({count:8}),gate=hold(),read=f.api.getDocFromServer;f.api.getDocFromServer=async reference=>{const snapshot=await read(reference);await gate.promise;return snapshot;};const work=loadStaffDirectory(f.api,{allowPartialRates:true});await waitForReads(f,4);if(change==='account')f.api.auth.currentUser={...f.api.auth.currentUser,uid:'new'};if(change==='session')f.api.sessionUser={...f.api.sessionUser};if(change==='role')f.api.sessionUser.role='Changed';if(change==='permissions')f.api.sessionUser.permissions=[];if(change==='branches')f.api.sessionUser.allowedBranches=['Another'];gate.resolve();await assert.rejects(work,/account|access|approved/);assert.equal(f.reads.length,4);assert.equal(f.active(),0);}
});

test('navigation cancellation is checked before dispatch and after fresh reads, even in the partial-rate directory mode',async()=>{
 const f=fixture({count:8}),gate=hold(),read=f.api.getDocFromServer;let current=true;f.api.getDocFromServer=async reference=>{const snapshot=await read(reference);await gate.promise;return snapshot;};const work=loadStaffDirectory(f.api,{allowPartialRates:true,assertCurrent:()=>{if(!current)throw Error('Different view selected');}});await waitForReads(f,4);current=false;gate.resolve();await assert.rejects(work,/Different view/);assert.equal(f.reads.length,4);
 const g=fixture();await assert.rejects(loadStaffDirectory(g.api,{assertCurrent:()=>{throw Error('Cancelled view');}}),/Cancelled/);assert.equal(g.profileReads.length,0);
});

test('directory cache metadata, malformed scope and unavailable authorization cannot dispatch private reads',async()=>{
 for(const change of ['cache','pending-row','no-branches','wrong-branch','unverified','no-session','permission']){const f=fixture({manager:true}),read=f.api.getDocsFromServer;let options={};if(change==='cache'||change==='pending-row')f.api.getDocsFromServer=async ref=>{const snapshot=await read(ref);if(change==='cache')snapshot.metadata.fromCache=true;else snapshot.docs[0].metadata={hasPendingWrites:true};return snapshot;};if(change==='no-branches')f.api.sessionUser.allowedBranches=[];if(change==='wrong-branch')options.selectedBranch='Cabantian';if(change==='unverified')f.api.auth.currentUser.emailVerified=false;if(change==='no-session')f.api.sessionUser=null;if(change==='permission')f.api.sessionUser.permissions=[];await assert.rejects(loadStaffDirectory(f.api,options));assert.equal(f.reads.length,0);}
});

test('a timed-out directory cannot publish late wages or continue launching the remaining staff reads',async()=>{
 const f=fixture({count:12}),gate=hold(),read=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const result=await read(ref);await gate.promise;return result;};const work=loadStaffDirectory(f.api,{timeoutMs:5,allowPartialRates:true});await assert.rejects(work,/too long/);assert.equal(f.reads.length,4);gate.resolve();await wait(0);assert.equal(f.reads.length,4);assert.equal(f.active(),0);
});

test('actor key distinguishes replaced sessions even when every visible permission field stays equal',()=>{const f=fixture();const first=staffDirectoryActorKey(f.api);f.api.sessionUser={...f.api.sessionUser};assert.notEqual(staffDirectoryActorKey(f.api),first);});

test('an explicitly granted Franchise owner keeps its own-branch directory and payroll access without All, foreign branches or inactive accounts',async()=>{
 for(const page of ['branches','payroll']){const f=fixture({manager:true});Object.assign(f.api.sessionUser,{role:'Franchise owner',isFranchisee:true,branch:'Maa'});const rows=await loadStaffDirectory(f.api,{page});assert.equal(rows.length,6);assert.ok(rows.every(row=>row.branch==='Maa'));assert.equal(f.profileReads[0].filters[0].value,'Maa');assert.equal(f.reads.length,6);}
 for(const patch of [{allowedBranches:['All']},{allowedBranches:['Maa','Cabantian']},{branch:'Cabantian'},{allowedBranches:[]},{active:false},{blocked:true},{status:'Revoked'},{permissions:[]}]){const f=fixture({manager:true});Object.assign(f.api.sessionUser,{role:'Franchise owner',isFranchisee:true,branch:'Maa'},patch);await assert.rejects(loadStaffDirectory(f.api));assert.equal(f.profileReads.length,0);assert.equal(f.reads.length,0);}
 const f=fixture({manager:true});Object.assign(f.api.sessionUser,{role:'Franchise owner',isFranchisee:true,branch:'Maa'});await assert.rejects(loadStaffDirectory(f.api,{selectedBranch:'Cabantian'}),/outside/);assert.equal(f.profileReads.length,0);
});

const actualMain=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8');
function mainFunction(name){const start=actualMain.indexOf('\nwindow.'+name+' = '),end=actualMain.indexOf('\n};',start+1);assert.ok(start>=0&&end>start,'Actual main handler '+name);return actualMain.slice(start+1,end+3);}
function actualHandlers(f,{scheduleRead=async()=>({exists:()=>true,data:()=>({currentYear:2026,currentMonth:10,branchConfig:{},currentSchedule:{}})})}={}){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},value:'',innerText:'',innerHTML:'',textContent:''});return nodes.get(id);},document={getElementById:node};
 Object.assign(f.api,{showArchivedStaff:false,globalStaffData:{},otCache:{staff:{},schedule:null},isBranchAllowed:branch=>f.api.sessionUser.allowedBranches.includes('All')||f.api.sessionUser.allowedBranches.includes(branch)});
 for(const action of ['updateDoc','addDoc','setDoc','writeBatch'])f.api[action]=()=>assert.fail('Directory navigation cannot change wages, attendance or financial data');
 const context=vm.createContext({window:f.api,document,loadStaffDirectory,staffDirectoryActorKey,staffRateForDate,nightRate,scheduledShiftForDate,activeStaffProfile,db:f.api.db,doc:f.api.doc,getDoc:scheduleRead,Date,console:{error(){}}});for(const name of ['loadHRModule','openManualOvertimeModal','calcAutoOvertime'])vm.runInContext(mainFunction(name),context);
 return {node,document,context};
}

test('actual Staff & Security handler renders scoped current staff, IDs, counts and unchanged daily rates using the parallel fresh reader',async()=>{
 const f=fixture({count:8,delay:1}),ui=actualHandlers(f);f.h.put('cashiers/staff-7',{...f.h.get('cashiers/staff-7'),status:'Resigned'});await f.api.loadHRModule();assert.match(ui.node('staffTableBody').innerHTML,/Sample 0/);assert.doesNotMatch(ui.node('staffTableBody').innerHTML,/Sample 7/);assert.equal(ui.node('hrActiveStaffCount').innerText,7);assert.equal(ui.node('hrArchivedStaffCount').innerText,1);assert.equal(ui.node('hrTotalDailyRate').innerText,'₱3,150.00');assert.equal(Object.keys(f.api.globalStaffData).length,7);assert.equal(f.api.globalStaffData['staff-0'].staffId,'staff-0');assert.equal(f.reads.length,7);assert.equal(f.max(),4);
 f.api.showArchivedStaff=true;await f.api.loadHRModule();assert.match(ui.node('staffTableBody').innerHTML,/Sample 7/);assert.doesNotMatch(ui.node('staffTableBody').innerHTML,/Sample 0/);assert.equal(Object.keys(f.api.globalStaffData).length,1);assert.equal(f.profileReads.length,2);assert.equal(f.reads.length,15);
 const own=fixture({manager:true}),ownUI=actualHandlers(own);Object.assign(own.api.sessionUser,{role:'Franchise owner',isFranchisee:true,branch:'Maa'});await own.api.loadHRModule();assert.equal(Object.keys(own.api.globalStaffData).length,6);assert.ok(Object.values(own.api.globalStaffData).every(profile=>profile.branch==='Maa'));assert.doesNotMatch(ownUI.node('staffTableBody').innerHTML,/Cabantian/);assert.equal(own.profileReads[0].filters[0].value,'Maa');
});

test('actual HR handler cannot replace a newer archive selection or another account after its network results arrive',async()=>{
 for(const change of ['archive','account']){const f=fixture({count:8}),gate=hold(),read=f.api.getDocFromServer,ui=actualHandlers(f);f.h.put('cashiers/staff-7',{...f.h.get('cashiers/staff-7'),status:'Resigned'});f.api.getDocFromServer=async ref=>{const result=await read(ref);await gate.promise;return result;};const first=f.api.loadHRModule();await waitForReads(f,4);let second;if(change==='archive'){f.api.showArchivedStaff=true;second=f.api.loadHRModule();}else{f.api.auth.currentUser={...f.api.auth.currentUser,uid:'new-user'};ui.node('staffTableBody').innerHTML='The new account owns this screen.';}gate.resolve();await first;await second;if(change==='archive'){assert.match(ui.node('staffTableBody').innerHTML,/Sample 7/);assert.doesNotMatch(ui.node('staffTableBody').innerHTML,/Sample 0/);assert.deepEqual(Object.keys(f.api.globalStaffData),['staff-7']);}else{assert.equal(ui.node('staffTableBody').innerHTML,'The new account owns this screen.');assert.deepEqual(Object.keys(f.api.globalStaffData),[]);}}
});

test('actual Manual OT starts staff reads while its independent schedule read waits, then calculates each dated wage without writes',async()=>{
 const f=fixture({count:4}),schedule=hold(),ui=actualHandlers(f,{scheduleRead:()=>schedule.promise});f.h.put('cashiers/staff-1',{...f.h.get('cashiers/staff-1'),status:'Resigned'});f.h.put('cashiers/staff-2',{...f.h.get('cashiers/staff-2'),pin:'REVOKED'});const opening=f.api.openManualOvertimeModal();await waitForReads(f,2);assert.equal(f.profileReads.length,1);assert.deepEqual(f.reads,['staff_salary_rates/staff-0','staff_salary_rates/staff-3']);assert.match(ui.node('manOtStaff').innerHTML,/Loading Staff/);schedule.resolve({exists:()=>true,data:()=>({branchConfig:{},currentSchedule:{}})});await opening;assert.match(ui.node('manOtStaff').innerHTML,/Sample 0/);assert.match(ui.node('manOtStaff').innerHTML,/Sample 3/);assert.doesNotMatch(ui.node('manOtStaff').innerHTML,/Sample 1|Sample 2/);ui.node('manOtStaff').value='Sample 0';ui.node('manOtHours').value='2';ui.node('manOtDate').value='2026-09-30';f.api.calcAutoOvertime();assert.equal(f.api.currentCalculatedOtAmount,100);ui.node('manOtDate').value='2026-10-01';f.api.calcAutoOvertime();assert.equal(f.api.currentCalculatedOtAmount,112.5);assert.match(ui.node('manOtCalcAmount').innerText,/112\.50/);
});

test('actual Manual OT refuses to populate a closed or replaced modal when the older parallel load completes',async()=>{
 for(const change of ['closed','account']){const f=fixture({count:4}),schedule=hold(),ui=actualHandlers(f,{scheduleRead:()=>schedule.promise}),opening=f.api.openManualOvertimeModal();await waitForReads(f,4);if(change==='closed')ui.node('manualOvertimeModal').style.display='none';else f.api.auth.currentUser={...f.api.auth.currentUser,uid:'new-user'};ui.node('manOtStaff').innerHTML='A newer selection is visible.';schedule.resolve({exists:()=>true,data:()=>({})});await opening;assert.equal(ui.node('manOtStaff').innerHTML,'A newer selection is visible.');assert.deepEqual(Object.keys(f.api.otCache.staff),[]);}
});
