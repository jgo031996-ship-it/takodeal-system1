import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {adminMemory} from './helpers/admin-memory.mjs';
import {gcashActor as actor,gcashSettings as settings,gcashRow as row,gcashSale as sale,gcashHQ as hq,gcashSeed as seed,gcashBody as body} from './helpers/gcash-reconciliation-fixture.mjs';
import {createGCashReconciliationStore} from '../functions/cash-remittance-review/gcash-reconciliation-store.mjs';
import {createGCashReconciliationHandler} from '../functions/cash-remittance-review/gcash-reconciliation-handler.mjs';
const fixture=options=>{const h=adminMemory();seed(h.put,options);return{...h,store:createGCashReconciliationStore(h.db,{serverTimestamp:h.serverTimestamp})};};
const business=h=>({bank:h.get('cash_accounts/private-bank'),payroll:h.get('payroll_records/paid')});

test('malformed shared request counters fail closed instead of resetting a corrupt quota to zero',async()=>{
 for(const count of [NaN,-1,'0',0.5]){
  const h=fixture(),id='gcash-reconciliation-'+createHash('sha256').update(actor.uid+'|0').digest('hex');h.put('cash_remittance_attempts/'+id,{count});
  const service=createGCashReconciliationStore(h.db,{serverTimestamp:h.serverTimestamp,now:()=>0});await assert.rejects(service.rate(actor.uid),error=>error.status===429);assert.equal(h.writes.length,0);
 }
});

test('broker matching model exactly preserves the existing browser behavior before its request-only validators',()=>{
 const browser=readFileSync(new URL('../takodeal-manager/payment-reconciliation-model.js',import.meta.url),'utf8'),server=readFileSync(new URL('../functions/cash-remittance-review/gcash-reconciliation-model.mjs',import.meta.url),'utf8');assert.equal(server.slice(0,browser.length),browser);
});
test('exact statement match atomically saves reciprocal claims and only verification fields, and retry makes no further writes',async()=>{
 const h=fixture(),input=await body(),source=h.get('transactions/tx-a'),before=business(h),result=await h.store.verify(input,actor);
 assert.equal(result.verified,1);const saved=h.get('transactions/tx-a');assert.deepEqual(Object.keys(saved).filter(key=>JSON.stringify(saved[key])!==JSON.stringify(source[key])).sort(),['paymentReconciliationFile','paymentReconciliationId','paymentReconciliationVersion','paymentVerified','verifiedAt','verifiedBy'].sort());
 assert.deepEqual(h.get('payment_reconciliation_rows/'+input.matches[0].claimId),h.get('payment_reconciliation_receipts/tx-a'));assert.deepEqual(business(h),before);
 const count=h.writes.length,replay=await h.store.verify(input,actor);assert.equal(replay.alreadyVerified,1);assert.equal(replay.verified,0);assert.equal(h.writes.length,count);
});
test('settings revisions and a lost save acknowledgment are idempotent, while old revisions cannot overwrite new settings',async()=>{
 const h=fixture(),desired={...settings(),revision:2};desired.providers.GCash.timeToleranceMinutes=5;
 await h.store.saveSettings({settings:desired,expectedRevision:1},actor);const count=h.writes.length;assert.deepEqual(await h.store.saveSettings({settings:desired,expectedRevision:1},actor),{schemaVersion:1,settings:desired});assert.equal(h.writes.length,count);
 await assert.rejects(h.store.saveSettings({settings:{...desired,branchAliases:[]},expectedRevision:1},actor),error=>error.status===409);
});
for(const kind of ['bridge-revoked','bridge-permissions','index-stale','source-revoked','source-duplicate','not-owner','duplicate-branch'])test('fresh authority holds without verification writes: '+kind,async()=>{
 const h=fixture(),input=await body();
 if(kind==='bridge-revoked')h.put('hq_email_access/'+actor.email,{active:false,role:'Owner',permissions:['all'],allowedBranches:['All']});
 if(kind==='bridge-permissions')h.put('hq_email_access/'+actor.email,{active:true,role:'Owner',permissions:[],allowedBranches:['All']});
 if(kind==='index-stale')h.put('hq_account_index/'+actor.email,{...h.get('hq_account_index/'+actor.email),sourceAccess:{}});
 if(kind==='source-revoked')h.put('hq_managers/owner',{...hq(),isArchived:true});
 if(kind==='source-duplicate')h.put('hq_managers/duplicate',hq());
 if(kind==='duplicate-branch')h.put('branches/other',{name:'Maa',active:true});
 const before=structuredClone([...h.rows]),caller=kind==='not-owner'?{...actor,email:'manager@example.test'}:actor;
 await assert.rejects(h.store.verify(input,caller),error=>error.status===403);assert.equal(h.writes.length,0);assert.deepEqual([...h.rows],before);
});
test('historical receipts remain reconcilable for an exact registered closed branch without widening saved scope',async()=>{
 const h=fixture();h.put('branches/maa',{name:'Maa',status:'Closed',active:false,archived:true});const result=await h.store.verify(await body(),actor);assert.equal(result.verified,1);assert.equal(h.get('transactions/tx-a').netTotal,100);
});
test('saved branch intersection permits only its exact branch and requires global scope for global matching settings',async()=>{
 const h=fixture({profile:hq({assignedBranch:['Maa']})});await h.store.verify(await body(),actor);
 const foreignSale=sale({branch:'Cabantian'}),foreign=await body({rows:[row({merchantAlias:'CAB STORE'})],sales:[foreignSale]}),other=fixture({profile:hq({assignedBranch:['Maa']}),sales:[foreignSale]});
 await assert.rejects(other.store.verify(foreign,actor),error=>error.status===403);assert.equal(other.writes.length,0);
 await assert.rejects(h.store.saveSettings({settings:{...settings(),revision:2},expectedRevision:1},actor),error=>error.status===403);
});
for(const patch of [{netTotal:101},{status:'Voided'},{splitDetails:[{method:'GCash',amount:100}]},{paymentReference:'different'},{timestamp:new Date('2026-10-31T03:00:00Z')},{refunded:true}])test('changed saved receipt cannot use an old browser-eligible preview: '+Object.keys(patch)[0],async()=>{
 const h=fixture(),input=await body();h.put('transactions/tx-a',{...h.get('transactions/tx-a'),...patch});await assert.rejects(h.store.verify(input,actor),error=>error.status===409);assert.equal(h.writes.length,0);
});
test('server rematching detects new exact-reference ambiguity, refund cases and duplicate statement references',async()=>{
 for(const kind of ['duplicate-receipt','refund','duplicate-row']){
  const h=fixture(),input=await body();if(kind==='duplicate-receipt')h.put('transactions/second',{...sale(),paymentReference:'00001234'});
  if(kind==='refund')h.put('online_order_incidents/online-refund-tx-a',{status:'Pending Review'});
  if(kind==='duplicate-row')input.rows.push(row({rowId:'second'}));
  await assert.rejects(h.store.verify(input,actor),error=>error.status===409);assert.equal(h.writes.length,0);
 }
});
test('automatic mode rederives explicit-reference eligibility rather than trusting a client flag',async()=>{
 const h=fixture(),input=await body({automatic:true}),result=await h.store.verify(input,actor);assert.equal(result.verified,0);assert.equal(result.held.length,1);assert.equal(h.writes.length,0);
 const explicit=sale({paymentReference:'00001234'}),yes=fixture({sales:[explicit]}),approved=await yes.store.verify(await body({sales:[explicit],automatic:true}),actor);assert.equal(approved.verified,1);
});
test('changed original receipt or incomplete reciprocal claims fail closed during retry',async()=>{
 for(const kind of ['amount','flag','missing-claim','actor','audit-time']){
  const h=fixture(),input=await body();await h.store.verify(input,actor);
  const previous=h.get('transactions/tx-a');if(kind==='missing-claim')h.rows.delete('payment_reconciliation_receipts/tx-a');else h.put('transactions/tx-a',{...previous,...(kind==='amount'?{netTotal:200}:kind==='actor'?{verifiedBy:'other@example.test'}:kind==='audit-time'?{verifiedAt:{...previous.verifiedAt,nanoseconds:previous.verifiedAt.nanoseconds+1}}:{paymentVerified:false})});
  const before=structuredClone([...h.rows]);await assert.rejects(h.store.verify(input,actor),error=>error.status===409);assert.deepEqual([...h.rows],before);
 }
});
test('invalid identity, body, route, CORS and forged token never reach financial storage; failures hide source details',async()=>{
 const input=await body(),calls=[],store={saveSettings:async()=>{},verify:async()=>{calls.push('verify');throw Error('PRIVATE_RAW_SOURCE');},rate:async()=>calls.push('rate')};
 const handler=createGCashReconciliationHandler({verifyToken:async(_token,revoked)=>{assert.equal(revoked,true);return actor;},store}),request={origin:'https://takodeal-owner.vercel.app',path:'/gcash-reconciliation/verify',method:'POST',query:{},contentType:'application/json',authorization:'Bearer SYNTHETIC_VERIFIED_TOKEN_123456789',rawSize:JSON.stringify(input).length,body:input};
 for(const patch of [{origin:'https://evil.example'},{path:'/gcash-reconciliation/delete'},{method:'GET'},{query:{branch:'Maa'}},{body:{...input,eligible:true}},{rawSize:2*1024*1024+1},{authorization:''}]){const response=await handler({...request,...patch});assert.ok(response.status>=400);assert.deepEqual(calls,[]);}
 const forged=createGCashReconciliationHandler({verifyToken:async()=>{throw Error('PRIVATE_TOKEN');},store});assert.equal((await forged(request)).status,401);assert.deepEqual(calls,[]);
 const failure=await handler(request);assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(failure),/PRIVATE_/);
 const preflight=await handler({...request,method:'OPTIONS',preflightMethod:'POST',preflightHeaders:'authorization,content-type'});assert.equal(preflight.status,204);assert.equal(preflight.headers['Access-Control-Allow-Origin'],request.origin);
});
