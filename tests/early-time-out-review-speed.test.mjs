import test from 'node:test';
import assert from 'node:assert/strict';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {createEarlyTimeOutService} from '../takodeal-manager/early-time-out-actions.js';
import {createEarlyTimeOutReviewService} from '../takodeal-manager/early-time-out-review.js';
const clock=new Date('2030-01-10T15:00:00+08:00'),branch='Sample Branch',staffId='sample-staff',name='Sample Crew',email='manager@example.test',fresh={fromCache:false,hasPendingWrites:false},tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function fixture(){
 const h=firestoreHarness(),sdkQuery=h.api.getDocsFromServer;h.api.auth={currentUser:{uid:'sample-manager',email,emailVerified:true}};h.api.sessionUser={uid:'sample-manager',email,role:'Manager',permissions:['inbox'],allowedBranches:[branch]};h.api.serverTimestamp=()=>new Date(clock);
 h.api.getDocsFromServer=async q=>{const snapshot=await sdkQuery(q);return {...snapshot,metadata:{...fresh},docs:snapshot.docs.map(row=>({...row,metadata:{...fresh}}))};};h.api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.get(ref.path)!==undefined,data:()=>structuredClone(h.get(ref.path)),metadata:{...fresh}});
 h.put('hq_managers/sample-manager',{email,role:'Manager',permissions:['inbox'],assignedBranch:branch,pin:'4829',active:true});h.put('hq_email_access/'+email,{active:true,permissions:['inbox'],allowedBranches:[branch]});h.put('cashiers/'+staffId,{cashierName:name,branch,pin:'7281',active:true});
 const at=new Date('2030-01-10T09:00:00+08:00'),end=new Date('2030-01-10T17:00:00+08:00'),start={id:'sample-in',staffId,staffName:name,branch,type:'TIME IN',timestamp:at,scheduleSnapshot:{version:1,source:'clock-in',branch,staffName:name,clockInAt:at.toISOString(),expectedStartAt:at.toISOString(),expectedEndAt:end.toISOString(),shiftId:'day',wasScheduled:true,needsScheduleReview:false}};
 h.put('attendance_logs/'+start.id,start);const staff=createEarlyTimeOutService(h.api,{now:()=>clock,makeToken:()=> 'sample-request-token'}),request=await staff.request({staffId,staffName:name,start,reason:'Medical appointment',pin:'7281'});h.put('payroll_records/paid',{status:'Paid',frozenData:{paidHours:80,netPay:4500}});
 return {...h,start,request,review:createEarlyTimeOutReviewService(h.api,{now:()=>clock})};
}
// Each stage models one equal-latency remote round trip. Independent reads in
// that stage finish together; sequential dependencies consume another stage.
// Unlike a wall-time threshold this remains deterministic on a busy CI host.
export function stagedReads(api){
 const jobs=[],trace=[],originalDoc=api.getDocFromServer,originalQuery=api.getDocsFromServer,originalTransaction=api.runTransaction;let stage=0,transactions=0;
 const later=(kind,path,work)=>new Promise((resolve,reject)=>{trace.push({kind,path,stage});jobs.push(async()=>{try{resolve(await work());}catch(error){reject(error);}});});
 api.getDocFromServer=ref=>later('doc',ref.path,()=>originalDoc(ref));api.getDocsFromServer=q=>later('query',q.table,()=>originalQuery(q));api.runTransaction=(db,callback)=>{transactions++;return originalTransaction(db,tx=>callback({...tx,get:ref=>later('transaction',ref.path,()=>tx.get(ref))}));};
 // Native crypto may complete after many empty event-loop turns on a busy CI
 // runner. Bound the harness by a real deadline, not an arbitrary turn count;
 // remote-stage assertions below still measure dependency depth exactly.
 return {trace,get stages(){return stage;},get transactions(){return transactions;},async finish(promise){let settled=false,value,failure;const deadline=Date.now()+10000;promise.then(result=>{value=result;settled=true;},error=>{failure=error;settled=true;});while(!settled&&Date.now()<deadline){await tick();await tick();if(jobs.length){stage++;await Promise.all(jobs.splice(0).map(work=>work()));}else if(!settled)await new Promise(resolve=>setTimeout(resolve,1));}if(!settled)throw Error('Synthetic network operation did not settle');if(failure)throw failure;return value;}};
}

test('a complete fresh preview shares exact request/source reads, performs no SDK transaction and finishes within three remote stages',async()=>{
 const f=await fixture(),before=structuredClone([...f.docs]),network=stagedReads(f.api),observed=[];const checked=await network.finish(f.review.inspect({requestId:f.request.id,onVerifiedRequest:row=>observed.push(row)}));
 assert.equal(checked.early,true);assert.equal(checked.unknown,false);assert.equal(checked.request.id,f.request.id);assert.equal(observed.length,1);assert.equal(observed[0].requestToken,'sample-request-token');assert.equal(network.transactions,0);assert.ok(network.stages<=3,'fresh common snapshot needs only three dependent network stages');
 assert.equal(network.trace.filter(row=>row.kind==='query'&&row.path==='hq_managers').length,1);const docs=network.trace.filter(row=>row.kind==='doc');assert.equal(docs.filter(row=>row.path==='staff_requests/'+f.request.id).length,1);assert.equal(docs.filter(row=>row.path==='attendance_logs/'+f.start.id).length,1);assert.equal(docs.some(row=>row.path==='hq_managers/sample-manager'),false);assert.equal(new Set(docs.map(row=>row.path)).size,docs.length);assert.deepEqual([...f.docs],before);
});

test('simultaneous previews coalesce only their pending physical reads and every later preview is fresh',async()=>{
 const f=await fixture(),network=stagedReads(f.api),first=[],second=[];const results=await network.finish(Promise.all([f.review.inspect({requestId:f.request.id,onVerifiedRequest:r=>first.push(r)}),f.review.inspect({requestId:f.request.id,onVerifiedRequest:r=>second.push(r)})]));assert.deepEqual(results[0],results[1]);assert.equal(first.length,1);assert.equal(second.length,1);assert.equal(network.trace.filter(row=>row.path==='staff_requests/'+f.request.id).length,1);const count=network.trace.length;
 f.put('hq_email_access/'+email,{active:false,permissions:['inbox'],allowedBranches:[branch]});await assert.rejects(network.finish(f.review.inspect({requestId:f.request.id})),/not granted/);assert.ok(network.trace.length>count);assert.equal(f.get('staff_requests/'+f.request.id).status,'Pending');
});

test('a fast preview never reuses permission or schedule evidence to authorize a later decision',async()=>{
 const f=await fixture(),preview=await f.review.inspect({requestId:f.request.id});assert.equal(preview.early,true);f.put('hq_email_access/'+email,{active:false,permissions:['inbox'],allowedBranches:[branch]});await assert.rejects(f.review.review({requestId:f.request.id,decision:'Approved',expectedRequestVersion:preview.request.requestVersion,expectedRequestToken:preview.request.requestToken,expectedScheduleFingerprint:preview.scheduleFingerprint}),/not granted/);assert.equal(f.get('attendance_time_out_approvals/'+f.request.id),undefined);assert.equal(f.get('staff_requests/'+f.request.id).status,'Pending');
});

test('missing, cached or pending server metadata never produces a verified preview or request callback',async()=>{
 for(const table of ['request','query','query-row','schedule'])for(const bad of [undefined,{fromCache:true,hasPendingWrites:false},{fromCache:false,hasPendingWrites:true}]){const f=await fixture(),get=f.api.getDocFromServer,query=f.api.getDocsFromServer;f.api.getDocFromServer=async ref=>{const snapshot=await get(ref);if(table==='request'&&ref.path==='staff_requests/'+f.request.id||table==='schedule'&&ref.path==='settings/global_schedule')snapshot.metadata=bad;return snapshot;};f.api.getDocsFromServer=async ref=>{const snapshot=await query(ref);if(table==='query')snapshot.metadata=bad;if(table==='query-row')snapshot.docs[0].metadata=bad;return snapshot;};const seen=[];await assert.rejects(f.review.inspect({requestId:f.request.id,onVerifiedRequest:row=>seen.push(row)}),/confirm|HQ/i);if(table!=='schedule')assert.equal(seen.length,0);assert.equal(f.get('staff_requests/'+f.request.id).status,'Pending');}
});

test('a changed account or saved foreign branch cannot expose a verified request callback',async()=>{
 for(const kind of ['identity','scope']){const f=await fixture(),query=f.api.getDocsFromServer,seen=[];f.api.getDocsFromServer=async ref=>{const result=await query(ref);if(kind==='identity')f.api.auth.currentUser.uid='changed';else f.get('staff_requests/'+f.request.id).branch='Other Branch';return result;};await assert.rejects(f.review.inspect({requestId:f.request.id,onVerifiedRequest:row=>seen.push(row)}));assert.equal(seen.length,0);}
});

test('the whole preview deadline covers a hung schedule read and repeated retry does not launch another physical operation',async()=>{
 const f=await fixture(),gate=deferred(),get=f.api.getDocFromServer;let reads=0,lateCallbacks=0;f.api.getDocFromServer=async ref=>{reads++;return ref.path==='settings/global_schedule'?gate.promise:get(ref);};const review=createEarlyTimeOutReviewService(f.api,{now:()=>clock,timeoutMs:15});await assert.rejects(review.inspect({requestId:f.request.id,onVerifiedRequest:()=>lateCallbacks++}),/not confirmed/);const count=reads;await new Promise(resolve=>setTimeout(resolve,40));await assert.rejects(review.inspect({requestId:f.request.id}),/not confirmed/);assert.equal(reads,count);gate.resolve(await get(f.ref('settings','global_schedule')));await tick();await tick();assert.equal(lateCallbacks,1);assert.equal(f.get('staff_requests/'+f.request.id).status,'Pending');await review.inspect({requestId:f.request.id});assert.ok(reads>count);
});

test('the whole write deadline prevents a delayed transaction from making a decision after timeout',async()=>{
 const f=await fixture(),gate=deferred(),run=f.api.runTransaction;f.api.runTransaction=async(...args)=>{await gate.promise;return run(...args);};const review=createEarlyTimeOutReviewService(f.api,{now:()=>clock,timeoutMs:15});await assert.rejects(review.review({requestId:f.request.id,decision:'Approved'}),/not confirmed/);gate.resolve();await tick();await tick();assert.equal(f.get('staff_requests/'+f.request.id).status,'Pending');assert.equal(f.get('attendance_time_out_approvals/'+f.request.id),undefined);
});
