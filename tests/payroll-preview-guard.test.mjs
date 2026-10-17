import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayrollPreviewGuard,readPayrollSnapshot} from '../takodeal-manager/payroll-preview-guard.js';

function fixture(){
 let context={accountKey:'approved-account-and-scope',start:'2030-01-01',end:'2030-01-15'};
 const states=[],guard=createPayrollPreviewGuard({getContext:()=>context,onState:state=>states.push(state)});
 return {guard,states,get context(){return context;},set context(value){context=value;}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('only a completed current account and cutoff run can open a payroll preview',()=>{
 const h=fixture();assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);
 const token=h.guard.begin();assert.equal(h.states.at(-1).status,'loading');assert.equal(h.guard.assertCurrent(token),token);assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);
 assert.equal(h.guard.complete(token),token);assert.equal(h.states.at(-1).status,'ready');assert.equal(h.guard.requireReady(),token);
 const count=h.states.length;h.guard.complete(token);assert.equal(h.states.length,count,'duplicate ready notification is suppressed');
});

test('date or account/scope changes revoke readiness and reject a pending result',()=>{
 for(const change of [{start:'2030-01-02'},{end:'2030-01-16'},{accountKey:'another-account'},{accountKey:'same-account-revoked-scope'}]){
  const h=fixture(),token=h.guard.begin();h.context={...h.context,...change};assert.throws(()=>h.guard.assertCurrent(token),/Connect to HQ/);assert.equal(h.states.at(-1).status,'stale');assert.throws(()=>h.guard.complete(token),/Connect to HQ/);assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);
 }
 const h=fixture(),token=h.guard.begin();h.guard.complete(token);h.context={...h.context,accountKey:''};assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);assert.equal(h.states.at(-1).status,'stale');
});

test('invalid cutoff or signed-out begin revokes an earlier completed result',()=>{
 for(const change of [{accountKey:''},{start:''},{start:'2030-02-30'},{start:'2030-01-16',end:'2030-01-15'}]){
  const h=fixture(),token=h.guard.begin();h.guard.complete(token);h.context={...h.context,...change};assert.throws(()=>h.guard.begin(),/HQ/);assert.equal(h.states.at(-1).status,'error');assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);assert.throws(()=>h.guard.complete(token),/Connect to HQ/);
 }
});

test('explicit invalidation blocks stale previews even after the selected dates return to their old values',()=>{
 const h=fixture(),token=h.guard.begin();h.guard.complete(token);h.guard.invalidate('The selected dates changed. Refresh payroll from HQ.');
 assert.equal(h.states.at(-1).status,'stale');assert.match(h.states.at(-1).message,/selected dates/);assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);assert.throws(()=>h.guard.complete(token),/Connect to HQ/);
 const next=h.guard.begin();assert.notEqual(next,token);h.guard.complete(next);assert.equal(h.guard.requireReady(),next);
});

test('older asynchronous completions and failures cannot replace a newer run',async()=>{
 const h=fixture(),oldRead=deferred(),newRead=deferred(),old=h.guard.begin();
 const first=oldRead.promise.then(()=>h.guard.complete(old)).catch(error=>h.guard.fail(old,error));
 const next=h.guard.begin(),second=newRead.promise.then(()=>h.guard.complete(next));newRead.resolve();await second;
 const ready=structuredClone(h.states);oldRead.resolve();await first;assert.deepEqual(h.states,ready);assert.equal(h.guard.requireReady(),next);assert.equal(h.guard.fail(old,Error('Old connection failed')),false);
 const third=h.guard.begin();assert.equal(h.guard.fail(next,Error('Earlier request failed')),false);assert.equal(h.states.at(-1).status,'loading');h.guard.complete(third);assert.equal(h.guard.requireReady(),third);
});

test('a current failure never marks ready or exposes technical error details',()=>{
 const h=fixture(),token=h.guard.begin();assert.equal(h.guard.fail(token,Error('resource-exhausted: internal-account-value')),true);assert.equal(h.states.at(-1).status,'error');assert.match(h.states.at(-1).message,/Connect to HQ/);assert.doesNotMatch(h.states.at(-1).message,/resource-exhausted|internal-account-value/);assert.throws(()=>h.guard.complete(token),/Connect to HQ/);assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);
});

test('an unreadable account context fails closed without exposing internal details',()=>{
 const states=[],guard=createPayrollPreviewGuard({getContext:()=>{throw Error('internal-session-detail');},onState:state=>states.push(state)});
 assert.throws(()=>guard.begin(),/Connect to HQ/);assert.equal(states.at(-1).status,'error');assert.doesNotMatch(states.at(-1).message,/internal-session-detail/);assert.throws(()=>guard.requireReady(),/Connect to HQ/);
});

test('a failing request under changed dates only marks the current context stale',()=>{
 const h=fixture(),token=h.guard.begin();h.context={...h.context,end:'2030-01-31'};assert.equal(h.guard.fail(token,Error('offline')),false);assert.equal(h.states.at(-1).status,'stale');assert.throws(()=>h.guard.requireReady(),/HQ/);
});

test('payroll reads use the server API exclusively and preserve a confirmed result',async()=>{
 const reference={table:'attendance_logs'},snapshot={metadata:{fromCache:false,hasPendingWrites:false},docs:[{metadata:{hasPendingWrites:false}}]};let calls=0;
 const api={getDocsFromServer:async received=>{calls++;assert.equal(received,reference);return snapshot;},getDocs:()=>assert.fail('cached fallback is forbidden')};
 assert.equal(await readPayrollSnapshot(api,reference),snapshot);assert.equal(calls,1);await assert.rejects(readPayrollSnapshot({getDocs:async()=>snapshot},reference),/Connect to HQ/);
});

test('cached partial results, pending query writes and pending document writes are rejected',async()=>{
 for(const snapshot of [null,{}, {metadata:{fromCache:true},docs:[{id:'only-cached-shift'}]}, {metadata:{hasPendingWrites:true},docs:[]},{metadata:{fromCache:false,hasPendingWrites:false},docs:[{metadata:{hasPendingWrites:true}}]},{metadata:{fromCache:false},docs:[{metadata:{fromCache:true}}]},{metadata:{fromCache:false},forEach:fn=>fn({metadata:{hasPendingWrites:true}})}]){
  await assert.rejects(readPayrollSnapshot({getDocsFromServer:async()=>snapshot},{}),/Connect to HQ/);
 }
});

test('server failures reject without falling back to old local payroll records',async()=>{
 const failure=Error('resource-exhausted'),api={getDocsFromServer:async()=>{throw failure;},getDocs:()=>assert.fail('No cached fallback')};
 await assert.rejects(readPayrollSnapshot(api,{}),error=>{assert.match(error.message,/Connect to HQ/);assert.equal(error.cause,failure);assert.doesNotMatch(error.message,/resource-exhausted/);return true;});
 api.getDocsFromServer=()=>{throw failure;};await assert.rejects(readPayrollSnapshot(api,{}),error=>error.cause===failure);
});

test('the SDK read dispatches synchronously before an account-change microtask and its stale result cannot publish',async()=>{
 const h=fixture(),pending=deferred(),accounts=[],token=h.guard.begin();
 const read=readPayrollSnapshot({getDocsFromServer:()=>{accounts.push(h.context.accountKey);return pending.promise;}},{},{timeoutMs:100});
 assert.deepEqual(accounts,['approved-account-and-scope']);
 queueMicrotask(()=>{h.context={...h.context,accountKey:'other-approved-account'};});await Promise.resolve();pending.resolve({metadata:{fromCache:false},docs:[]});
 await assert.rejects(async()=>{await read;h.guard.assertCurrent(token);h.guard.complete(token);},/Connect to HQ/);assert.equal(h.states.at(-1).status,'stale');assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);
});

test('a partial cached read cannot complete its payroll run or authorize an older preview',async()=>{
 const h=fixture(),old=h.guard.begin();h.guard.complete(old);const token=h.guard.begin();
 try{await readPayrollSnapshot({getDocsFromServer:async()=>({metadata:{fromCache:true},docs:[{id:'two-shifts'}]})},{});h.guard.complete(token);assert.fail('Partial cached records must reject');}catch(error){h.guard.fail(token,error);}
 assert.equal(h.states.at(-1).status,'error');assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);assert.throws(()=>h.guard.complete(old),/Connect to HQ/);
});

test('a stalled server read has a finite deadline and its late completion cannot ready a failed preview',async()=>{
 const h=fixture(),pending=deferred(),token=h.guard.begin();
 try{await readPayrollSnapshot({getDocsFromServer:()=>pending.promise},{},{timeoutMs:5});h.guard.complete(token);assert.fail('A stalled read must time out');}catch(error){assert.match(error.message,/Connect to HQ/);h.guard.fail(token,error);}
 assert.equal(h.states.at(-1).status,'error');pending.resolve({metadata:{fromCache:false},docs:[]});await new Promise(resolve=>setImmediate(resolve));assert.throws(()=>h.guard.requireReady(),/Connect to HQ/);assert.equal(h.states.at(-1).status,'error');
});

test('the exact same pending reference does not fan out after a deadline and can retry after physical completion',async()=>{
 const pending=deferred(),reference={},snapshot={metadata:{fromCache:false},docs:[]};let calls=0;const api={getDocsFromServer:()=>++calls===1?pending.promise:Promise.resolve(snapshot)};
 await assert.rejects(readPayrollSnapshot(api,reference,{timeoutMs:5}),/took too long/);await assert.rejects(readPayrollSnapshot(api,reference,{timeoutMs:5}),/took too long/);assert.equal(calls,1);
 pending.resolve(snapshot);await new Promise(resolve=>setImmediate(resolve));assert.equal(await readPayrollSnapshot(api,reference,{timeoutMs:50}),snapshot);assert.equal(calls,2);
});

test('a timed-out query does not block other references or normal independent concurrent queries',async()=>{
 const stalled={},pending=deferred(),snapshot={metadata:{fromCache:false},docs:[]},calls=[];const api={getDocsFromServer:ref=>{calls.push(ref);return ref===stalled?pending.promise:Promise.resolve(snapshot);}};
 await assert.rejects(readPayrollSnapshot(api,stalled,{timeoutMs:5}),/Connect to HQ/);
 const other={},another={};assert.deepEqual(await Promise.all([readPayrollSnapshot(api,other,{timeoutMs:50}),readPayrollSnapshot(api,another,{timeoutMs:50})]),[snapshot,snapshot]);assert.equal(calls.length,3);pending.resolve(snapshot);
});
