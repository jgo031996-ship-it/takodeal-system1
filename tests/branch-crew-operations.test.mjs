import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCoinStash} from '../functions/cash-remittance-review/coin-stash.mjs';
import {createDutyReview} from '../functions/cash-remittance-review/duty-review.mjs';
import {trainingHourlyRate} from '../takodeal-manager/staff-rate-model.js';
const owner={email:'jgo031996@gmail.com',uid:'demo-owner',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const now=()=>Date.parse('2030-11-02T16:32:00Z'),serverTimestamp=()=>new Date(now());
function database(seed){
 const data=new Map(Object.entries(structuredClone(seed)));
 const doc=path=>({path,id:path.split('/').pop()});
 const snapshot=path=>({id:doc(path).id,exists:data.has(path),data:()=>structuredClone(data.get(path)),updateTime:{seconds:7,nanoseconds:2}});
 const db={doc,data,collection:table=>({where:(field,op,value)=>({table,field,value,limit(){return this;},select(){return this;}})}),
  async runTransaction(work){const staged=[];const tx={get:async ref=>{assert.equal(staged.length,0,'all reads precede writes');if(ref.path)return snapshot(ref.path);const docs=[...data.keys()].filter(k=>k.startsWith(ref.table+'/')&&data.get(k)[ref.field]===ref.value).map(snapshot);return {docs,size:docs.length};},create:(ref,v)=>{assert.ok(!data.has(ref.path));staged.push([ref.path,v]);},set:(ref,v)=>staged.push([ref.path,v]),update:(ref,v)=>{assert.ok(data.has(ref.path));staged.push([ref.path,{...data.get(ref.path),...v}]);}};
   const result=await work(tx);if(db.interrupt){db.interrupt=false;throw Error('interrupted');}for(const [k,v]of staged)data.set(k,structuredClone(v));return result;
  }};return db;
}
test('Coins Stash links one branch account and replays credits and store purchases once',async()=>{
 const staff={uid:'tablet',firebase:{sign_in_provider:'anonymous'}},branch='Demo East',deviceId='DEV-SAMPLE01',sessionId='a'.repeat(32),shiftId='open1';
 const db=database({'cash_accounts/test':{branch,name:'Training drawer',balance:20},'cashiers/crew1':{cashierName:'Fictional Crew',branch},'staff_login_sessions/tablet':{schemaVersion:1,uid:'tablet',app:'cashier',branch,sessionId,deviceId,staffId:'crew1',profileRevision:'7|2',expiresAt:new Date(now()+60000)},'pos_bindings/tablet':{uid:'tablet',status:'Active',branch,deviceId,legacyDeviceDocId:'demoDevice'},'pos_devices/demoDevice':{status:'Active',branch,deviceId,appType:'cashier'},'shifts/open1':{branch,active:true}});
 const stash=createCoinStash(db,{now,serverTimestamp}),context={branch,deviceId,sessionId,shiftId};
 await stash('configure',{branch,accountId:'test',revision:0,note:'Use for small purchases',operationId:'configure-demo-0001'},owner,true);
 const credit={branch,accountId:'test',note:'Coins added',cents:500,operationId:'credit-demo-00001'};await stash('fund',credit,owner,true);await stash('fund',credit,owner,true);
 const details={...context,accountId:'test',cents:325,note:'Paper cups',operationId:'purchase-demo-00001'};db.interrupt=true;
 await assert.rejects(stash('spend',details,staff,false),/interrupted/);assert.equal(db.data.get('cash_accounts/test').balance,25);
 await stash('spend',details,staff,false);await stash('spend',details,staff,false);const state=await stash('read',context,staff,false);
 assert.equal(state.balance,21.75);assert.equal(state.history.length,2);assert.equal(state.note,'Use for small purchases');
 const expenses=[...db.data].filter(([p])=>p.startsWith('expenses/'));assert.equal(expenses.length,1);assert.equal(expenses[0][1].shiftId,undefined);assert.equal(expenses[0][1].date,'2030-11-03');
 await assert.rejects(stash('spend',{...details,cents:650},staff,false));await assert.rejects(stash('spend',{...details,cents:30000,operationId:'purchase-too-large'},staff,false));await assert.rejects(stash('read',{...context,branch:'Demo West'},staff,false));
});
function dutyFixture({punch=true,paid=false}={}){
 const start=new Date('2030-11-03T10:02:00Z'),end=new Date('2030-11-03T19:04:00Z'),person={staffId:'crew1',staffName:'Fictional Crew',branch:'Demo East'},hash=createHash('sha256').update(JSON.stringify(['crew1','start'])).digest('hex'),requestId='early-'+hash,outId='time-out-'+hash;
 const src={type:'TIME IN',...person,timestamp:start},out={type:'TIME OUT',...person,timeInLogId:'start',timeInAt:start,timestamp:end},request={schemaVersion:1,type:'Early Time Out',...person,timeInLogId:'start',timeInAt:start,status:'Pending',requestVersion:1,requestToken:'token-demo1',reason:'Rain closure'};
 const db=database({'cashiers/crew1':{cashierName:person.staffName,branch:'Demo West'},'attendance_logs/start':src,...(punch?{['attendance_logs/'+outId]:out}:{}),['staff_requests/'+requestId]:request,'hq_managers/owner':{email:owner.email,role:'Owner',active:true,permissions:['all']},...(paid?{'payroll_records/payroll-crew1-2030-11-01-2030-11-15':{staffId:'crew1',isPaid:true,startDate:'2030-11-01',endDate:'2030-11-15'}}:{})});
 return {db,src,out,outId,requestId,duty:createDutyReview(db,{serverTimestamp})};
}
const selection={mode:'custom',workDate:'2030-11-03',startTime:'18:30',endTime:'03:00',shiftName:'Night duty',shiftType:'night',reason:'Closed early for heavy rain'};
test('overnight cover keeps both source punches and closes the request once, after interrupted save',async()=>{
 const {db,src,out,outId,requestId,duty}=dutyFixture(),view=await duty('read',{requestId},owner);
 assert.equal(view.timeOutAt,out.timestamp.toISOString());assert.equal(view.branch,'Demo East');const details={requestId,expected:view.expected,selection,operationId:'review-test-00001'};
 db.interrupt=true;await assert.rejects(duty('save',details,owner),/interrupted/);assert.equal(db.data.get('staff_requests/'+requestId).status,'Pending');
 await duty('save',details,owner);assert.equal((await duty('save',details,owner)).alreadySaved,true);
 assert.deepEqual(db.data.get('attendance_logs/start'),src);assert.deepEqual(db.data.get('attendance_logs/'+outId),out);assert.equal(db.data.get('staff_requests/'+requestId).actualTimeOutAt.toISOString(),out.timestamp.toISOString());assert.equal(db.data.get('attendance_shift_confirmations/start').expectedEndAt.toISOString(),'2030-11-03T19:00:00.000Z');
});
test('a request without departure stays open and paid cutoffs refuse a duty change',async()=>{
 for(const paid of [false,true]){const {db,requestId,duty}=dutyFixture({punch:false,paid});const view=await duty('read',{requestId},owner);assert.equal(view.timeOutAt,null);const attempt=duty('save',{requestId,expected:view.expected,selection,operationId:'missing-test-00001'},owner);if(paid)await assert.rejects(attempt,/completed payslip/);else assert.equal((await attempt).recorded,false);assert.equal(db.data.get('staff_requests/'+requestId).status,'Pending');assert.equal([...db.data.keys()].filter(k=>k.startsWith('attendance_logs/')).length,1);}
});
test('five and seven training days include hire date and end on the correct work date',()=>{for(const days of [5,7]){const profile={trainingPay:{version:1,start:'2030-11-01',days,hourlyCents:4580}};assert.equal(trainingHourlyRate(profile,'2030-10-31'),null);assert.equal(trainingHourlyRate(profile,'2030-11-0'+days),45.8);assert.equal(trainingHourlyRate(profile,'2030-11-0'+(days+1)),null);}assert.equal(trainingHourlyRate({},'2030-11-01'),null);});
