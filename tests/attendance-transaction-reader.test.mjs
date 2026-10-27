import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memoizedAttendanceTransaction} from '../takodeal-manager/attendance-transaction-reader.js';
import {createFirestoreHealth,guardFirestoreOperations,FIRESTORE_RECOVERY_CODE} from '../takodeal-manager/firestore-health.js';
test('same transaction document is physically read once across repeated and concurrent references',async()=>{
 let reads=0;const tx={get:async ref=>{reads++;return {path:ref.path,value:7};}},memo=memoizedAttendanceTransaction(tx);
 const first=memo.get({path:'attendance_logs/punch'}),second=memo.get({path:'attendance_logs/punch'});assert.equal(first,second);assert.deepEqual(await Promise.all([first,second]),[{path:'attendance_logs/punch',value:7},{path:'attendance_logs/punch',value:7}]);
 assert.equal((await memo.get({path:'attendance_logs/punch'})).value,7);assert.equal(reads,1);
});
test('different documents and Firestore instances never share a cached response',async()=>{
 let reads=0;const tx={get:async()=>++reads},memo=memoizedAttendanceTransaction(tx),db1={},db2={};
 assert.equal(await memo.get({path:'settings/month',firestore:db1}),1);assert.equal(await memo.get({path:'settings/other',firestore:db1}),2);assert.equal(await memo.get({path:'settings/month',firestore:db2}),3);assert.equal(reads,3);
});
test('a new transaction attempt rechecks documents instead of reusing prior data',async()=>{
 let value=1,reads=0;const tx={get:async()=>{reads++;return value;}};
 assert.equal(await memoizedAttendanceTransaction(tx).get({path:'cashiers/staff'}),1);value=2;assert.equal(await memoizedAttendanceTransaction(tx).get({path:'cashiers/staff'}),2);assert.equal(reads,2);
});
test('one rejected physical read stays rejected throughout its attempt',async()=>{
 let reads=0;const tx={get:async()=>{reads++;throw Error('unavailable');}},memo=memoizedAttendanceTransaction(tx);
 await assert.rejects(memo.get({path:'settings/month'}),/unavailable/);await assert.rejects(memo.get({path:'settings/month'}),/unavailable/);assert.equal(reads,1);
});
test('SDK method binding and the reads-before-writes invariant remain intact',async()=>{
 class SDK{#writes=[];get writes(){return this.#writes;}async get(ref){return ref.path;}set(ref,row){this.#writes.push([ref,row]);return this;}}
 const tx=new SDK(),memo=memoizedAttendanceTransaction(tx);assert.equal(await memo.get({path:'staff_requests/request'}),'staff_requests/request');memo.set({path:'staff_requests/request'},{status:'Approved'});assert.equal(tx.writes.length,1);
 await assert.rejects(memo.get({path:'staff_requests/request'}),/before writes/);await assert.rejects(memo.get({path:'staff_requests/other'}),/before writes/);
});
test('a frozen SDK facade can be memoized without contradicting its nonconfigurable get method',async()=>{
 let reads=0;const writes=[],transaction=Object.freeze({get:async ref=>{reads++;return ref.path;},set(ref,row){writes.push([ref,row]);return transaction;}});
 assert.equal(Object.getOwnPropertyDescriptor(transaction,'get').configurable,false);assert.equal(Object.getOwnPropertyDescriptor(transaction,'get').writable,false);
 const memo=memoizedAttendanceTransaction(transaction);assert.equal(await memo.get({path:'attendance_logs/start'}),'attendance_logs/start');assert.equal(await memo.get({path:'attendance_logs/start'}),'attendance_logs/start');assert.equal(reads,1);
 assert.equal(memo.set({path:'attendance_shift_confirmations/start'},{version:1}),memo);await assert.rejects(memo.get({path:'attendance_logs/start'}),/before writes/);assert.equal(writes.length,1);
});
test('chained writes on a frozen facade cannot escape the reads-before-writes check',async()=>{
 const writes=[];let physicalReads=0;const transaction=Object.freeze({get:async()=>++physicalReads,set(){writes.push('set');return transaction;},update(){writes.push('update');return transaction;},delete(){writes.push('delete');return transaction;}}),memo=memoizedAttendanceTransaction(transaction);
 assert.equal(memo.set('one',{}).update('two',{}).delete('three'),memo);await assert.rejects(memo.get({path:'after-write'}),/before writes/);assert.equal(physicalReads,0);assert.deepEqual(writes,['set','update','delete']);
});
test('health-guarded transaction reads retain memoization, receiver and fatal queue guards',async()=>{
 const health=createFirestoreHealth();let physicalReads=0,physicalWrites=0,held;
 class Transaction{#marker='bound';get marker(){return this.#marker;}async get(ref){assert.equal(this.#marker,'bound');physicalReads++;return ref.path;}set(){assert.equal(this.#marker,'bound');physicalWrites++;return this;}}
 const raw=new Transaction(),sdk=guardFirestoreOperations(health,{runTransaction:async(_db,handler)=>handler(raw)});
 await sdk.runTransaction({},async guarded=>{assert.equal(Object.isFrozen(guarded),true);held=memoizedAttendanceTransaction(guarded);assert.equal(await held.get({path:'settings/month'}),'settings/month');assert.equal(await held.get({path:'settings/month'}),'settings/month');});assert.equal(physicalReads,1);
 health.report(Error('FIRESTORE (13.1.0) INTERNAL ASSERTION FAILED: Synthetic test only'));
 await assert.rejects(held.get({path:'settings/new'}),error=>error.code===FIRESTORE_RECOVERY_CODE);assert.throws(()=>held.set('write',{}),error=>error.code===FIRESTORE_RECOVERY_CODE);assert.equal(physicalReads,1);assert.equal(physicalWrites,0);
 const direct=memoizedAttendanceTransaction(Object.freeze(raw));assert.equal(direct.marker,'bound');
});
test('Owner Staff and Cashier use the same frozen-facade compatible transaction reader',()=>{
 const expected=readFileSync(new URL('../takodeal-manager/attendance-transaction-reader.js',import.meta.url));for(const app of ['takodeal-staff','Takodeal-POS'])assert.deepEqual(readFileSync(new URL('../'+app+'/attendance-transaction-reader.js',import.meta.url)),expected);
});
