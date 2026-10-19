import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatePayrollLoad,mapPayrollReads,loadPayrollPreviewInputs,loadPayrollSalaryProfiles,scopePayrollInputs,payrollLoadingScope} from '../takodeal-manager/payroll-loading.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const snap=rows=>({metadata:{fromCache:false,hasPendingWrites:false},docs:rows.map((data,index)=>({id:data.id||String(index),data:()=>data})),forEach(fn){this.docs.forEach(fn);}});
function fixture(){
 const calls=[],api={db:{},auth:{currentUser:{uid:'owner',email:'jgo031996@gmail.com',emailVerified:true}},sessionUser:{uid:'owner',email:'jgo031996@gmail.com',permissions:['payroll'],allowedBranches:['All']},doc:(_,table,id)=>({table,id}),collection:(_,table)=>({table}),where:(field,op,value)=>({field,op,value}),query:(ref,...filters)=>({...ref,filters}),orderBy:(...order)=>order,getDocsFromServer:async ref=>{calls.push(ref.table);return snap([]);},loadPayrollScheduleHistory:async()=>{calls.push('schedule');return {historyMonths:{}};}};
 return {api,calls};
}
const options={start:'2030-01-16',end:'2030-01-31',fetchStartDate:new Date('2030-01-16T00:00:00+08:00'),trueStartDate:new Date('2030-01-16T00:00:00+08:00'),fetchEndDate:new Date('2030-02-01T12:00:00+08:00')};

test('identical concurrent Generate requests share one run, but a completed refresh always runs again',async()=>{
 const {api}=fixture(),gate=deferred();let calls=0;const config={kind:'generate',start:'2030-01-16',end:'2030-01-31'},work=()=>{calls++;return gate.promise;};
 const pending=Array.from({length:20},()=>coordinatePayrollLoad(api,config,work));assert.equal(calls,1);assert.ok(pending.every(value=>value===pending[0]));gate.resolve('ready');assert.deepEqual(await Promise.all(pending),Array(20).fill('ready'));
 assert.equal(await coordinatePayrollLoad(api,config,()=>++calls),2,'a completed result is never treated as fresh server data');
});

test('only the latest changed cutoff waits behind the current physical run and returning to the first cutoff schedules a fresh run',async()=>{
 const {api}=fixture(),gate=deferred();let dates={start:'2030-01-01',end:'2030-01-15'},invalidations=0;const seen=[];
 const config=()=>({kind:'generate',getDates:()=>dates,invalidate:()=>invalidations++});
 const first=coordinatePayrollLoad(api,config(),()=>{seen.push('first');return gate.promise;});dates={start:'2030-01-16',end:'2030-01-31'};
 const superseded=coordinatePayrollLoad(api,config(),()=>seen.push('superseded'));dates={start:'2030-01-01',end:'2030-01-15'};
 const latest=coordinatePayrollLoad(api,config(),()=>seen.push('latest'));assert.deepEqual(seen,['first']);assert.equal(await superseded,false);gate.resolve();await first;await latest;assert.deepEqual(seen,['first','latest']);assert.equal(invalidations,2);
});

test('a queued run cannot dispatch under another account or a different current cutoff',async()=>{
 for(const change of ['account','cutoff']){const {api}=fixture(),gate=deferred();let dates={start:'2030-01-01',end:'2030-01-15'},queued=0;const config=()=>({kind:'generate',getDates:()=>dates});const first=coordinatePayrollLoad(api,config(),()=>gate.promise);dates={start:'2030-01-16',end:'2030-01-31'};const second=coordinatePayrollLoad(api,config(),()=>queued++);if(change==='account')api.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true};else dates={start:'2030-02-01',end:'2030-02-15'};gate.resolve();await first;assert.equal(await second,false);assert.equal(queued,0);}
});

test('bounded reads start a full independent wave before any response and preserve result ordering',async()=>{
 const gates=Array.from({length:7},deferred),started=[];let active=0,maxActive=0;
 const pending=mapPayrollReads(gates.map((gate,index)=>async()=>{started.push(index);active++;maxActive=Math.max(maxActive,active);await gate.promise;active--;return index;}),{concurrency:3});
 assert.deepEqual(started,[0,1,2]);gates.slice(0,3).forEach(gate=>gate.resolve());await tick();assert.deepEqual(started,[0,1,2,3,4,5]);gates.slice(3,6).forEach(gate=>gate.resolve());await tick();assert.deepEqual(started,[0,1,2,3,4,5,6]);gates[6].resolve();assert.deepEqual(await pending,[0,1,2,3,4,5,6]);assert.equal(maxActive,3);
});

test('a failed or stale read stops queued SDK dispatch and never returns a partial bundle',async()=>{
 for(const stale of [false,true]){const gates=[deferred(),deferred()],started=[];let current=true;const pending=mapPayrollReads(Array.from({length:5},(_,index)=>async()=>{started.push(index);if(index<2)await gates[index].promise;return index;}),{concurrency:2,assertCurrent:()=>{if(!current)throw Error('Changed account');}});if(stale){current=false;gates[0].resolve();}else gates[0].reject(Error('Server failed'));await tick();gates[1].resolve();await assert.rejects(pending,/Changed account|Server failed/);assert.deepEqual(started,[0,1]);}
});

test('all six collections and schedule dispatch together instead of waiting for each previous snapshot',async()=>{
 const {api}=fixture(),gates=[],started=[];api.getDocsFromServer=ref=>{started.push(ref.table);const gate=deferred();gates.push(gate);return gate.promise;};api.loadPayrollScheduleHistory=()=>{started.push('schedule');const gate=deferred();gates.push(gate);return gate.promise;};
 const pending=loadPayrollPreviewInputs(api,options);assert.equal(started.length,7);assert.deepEqual(new Set(started),new Set(['schedule','payroll_records','cashiers','staff_ledger','attendance_logs','staff_deductions','staff_bonuses']));gates.forEach((gate,index)=>gate.resolve(index? snap([]):{historyMonths:{}}));assert.ok((await pending).scheduleData.historyMonths);
});

test('deadline retries cannot stack another physical same-scope SDK read while the first response is pending',async()=>{
 const {api}=fixture(),gates=[];let calls=0;api.getDocsFromServer=()=>{calls++;const gate=deferred();gates.push(gate);return gate.promise;};api.loadPayrollScheduleHistory=()=>{calls++;const gate=deferred();gates.push(gate);return gate.promise;};
 await assert.rejects(loadPayrollPreviewInputs(api,{...options,timeoutMs:5}),/too long/);assert.equal(calls,7);await assert.rejects(loadPayrollPreviewInputs(api,{...options,timeoutMs:5}),/too long/);assert.equal(calls,7);
 gates.forEach((gate,index)=>gate.resolve(index?snap([]):{historyMonths:{}}));await tick();api.getDocsFromServer=async()=>{calls++;return snap([]);};api.loadPayrollScheduleHistory=async()=>{calls++;return {historyMonths:{}};};await loadPayrollPreviewInputs(api,options);assert.equal(calls,14,'a new completed refresh reads all sources again');
});

test('scope filtering excludes foreign records and ambiguous nameless branch rows before salary reads, retaining Owner legacy records',()=>{
 const {api}=fixture(),staff=[{id:'a',cashierName:'Ann',branch:'Maa'},{id:'b',cashierName:'Beth',branch:'Cabantian'},{id:'c',cashierName:'Shared',branch:'Maa'},{id:'d',cashierName:'Shared',branch:'Cabantian'}],rows=[{id:'mine',staffName:'Ann'},{id:'foreign',staffName:'Beth'},{id:'ambiguous',staffName:'Shared'},{id:'wrong-id',staffId:'b',staffName:'Ann',branch:'Maa'},{id:'unknown',staffName:'Deleted legacy employee'},{id:'frozen',staffName:'Ann',frozenData:{branch:'Maa'}},{id:'other-frozen',staffName:'Beth',frozenData:{branch:'Cabantian'}}];
 const input={scheduleData:{},staffSnap:snap(staff),prSnap:snap(rows),ledgerSnap:snap(rows),attSnap:snap(rows),deductSnap:snap(rows),bonusSnap:snap(rows)};assert.equal(scopePayrollInputs(api,input),input,'the actual Owner retains even unknown legacy records');
 api.auth.currentUser.email='hr@example.test';api.sessionUser={uid:'owner',email:'hr@example.test',permissions:['payroll'],allowedBranches:['Maa'],isOwner:true};const result=scopePayrollInputs(api,input);
 assert.deepEqual(result.staffSnap.docs.map(row=>row.id),['a','c']);for(const key of ['prSnap','ledgerSnap','attSnap','deductSnap','bonusSnap'])assert.deepEqual(result[key].docs.map(row=>row.id),['mine','frozen']);assert.equal(input.staffSnap.docs.length,4);assert.equal(payrollLoadingScope(api).allows('Cabantian'),false);
});

test('private salary reads use four slots, skip paid or out-of-scope profiles and leave input profiles unchanged',async()=>{
 const {api}=fixture();api.auth.currentUser.email='hr@example.test';api.sessionUser={uid:'owner',email:'hr@example.test',permissions:['payroll'],allowedBranches:['Maa']};const staff={},gates=[],calls=[];
 for(let index=0;index<7;index++)staff['Staff '+index]={staffId:'s'+index,cashierName:'Staff '+index,branch:index===6?'Cabantian':'Maa',salaryRateVersion:1,salaryRateRevision:'raise',hourlyRate:480};
 api.getDocFromServer=ref=>{calls.push(ref.id);const gate=deferred();gates.push({gate,ref});return gate.promise;};const pending=loadPayrollSalaryProfiles(api,staff,{'Staff 5':{isPaid:true}},{concurrency:4});assert.deepEqual(calls,['s0','s1','s2','s3']);
 const finish=({gate,ref})=>gate.resolve({exists:()=>true,data:()=>({version:1,staffId:ref.id,branch:'Maa',revision:1,baselineDailyRate:450,rates:{raise:{effectiveDate:'2030-01-20',dailyRate:480,sequence:1}}})});gates.slice(0,4).forEach(finish);await tick();assert.deepEqual(calls,['s0','s1','s2','s3','s4']);finish(gates[4]);const result=await pending;assert.equal(result['Staff 6'],undefined);assert.equal(result['Staff 5'],staff['Staff 5']);assert.equal(result['Staff 0'].salaryRateTimeline.baselineDailyRate,450);assert.equal(staff['Staff 0'].salaryRateTimeline,undefined);
});

test('scoped legacy names retain case and spacing matches, while a known foreign employee cannot borrow a permitted row branch',()=>{
 const {api}=fixture();api.auth.currentUser.email=api.sessionUser.email='hr@example.test';api.sessionUser.allowedBranches=['Maa'];const rows=snap([{id:'mine',staffName:'  ann  '},{id:'foreign',staffName:'BETH',branch:'Maa'}]),input={staffSnap:snap([{id:'a',cashierName:'Ann',branch:'Maa'},{id:'b',cashierName:'Beth',branch:'Cabantian'}]),prSnap:rows,ledgerSnap:rows,attSnap:rows,deductSnap:rows,bonusSnap:rows};
 const result=scopePayrollInputs(api,input);assert.deepEqual(result.attSnap.docs.map(row=>row.id),['mine']);assert.deepEqual(result.deductSnap.docs.map(row=>row.id),['mine']);
});

test('unverified, mismatched, franchise or revoked payroll scope cannot start any SDK reads',async()=>{
 for(const mutate of [api=>api.auth.currentUser.emailVerified=false,api=>api.sessionUser.uid='different',api=>api.sessionUser.permissions=[],api=>api.sessionUser.isFranchisee=true]){const {api,calls}=fixture();api.auth.currentUser.email=api.sessionUser.email='hr@example.test';mutate(api);await assert.rejects(loadPayrollPreviewInputs(api,options));assert.equal(calls.length,0);}
});

test('loader helpers reject a late result after identity or branch scope changes even without a caller guard',async()=>{
 const {api}=fixture(),gate=deferred();api.getDocsFromServer=async()=>{await gate.promise;return snap([]);};const pending=loadPayrollPreviewInputs(api,options);api.auth.currentUser={uid:'other',email:'other@example.test',emailVerified:true};api.sessionUser={uid:'other',email:'other@example.test',permissions:['payroll'],allowedBranches:['All']};gate.resolve();await assert.rejects(pending,/account or branch access changed/);
 const next=fixture(),salaryGate=deferred(),calls=[];next.api.getDocFromServer=async ref=>{calls.push(ref.id);await salaryGate.promise;return {exists:()=>true,data:()=>({version:1,staffId:ref.id,branch:'Maa',revision:1,baselineDailyRate:450,rates:{}})};};const profiles=Object.fromEntries(Array.from({length:7},(_,index)=>['Staff '+index,{staffId:'s'+index,branch:'Maa',salaryRateVersion:1}]));const salary=loadPayrollSalaryProfiles(next.api,profiles,{});assert.equal(calls.length,4);next.api.sessionUser.allowedBranches=['Cabantian'];salaryGate.resolve();await assert.rejects(salary,/account or branch access changed/);assert.equal(calls.length,4,'no queued private read starts under changed authority');
});
