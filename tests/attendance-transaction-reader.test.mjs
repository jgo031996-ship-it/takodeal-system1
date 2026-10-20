import test from 'node:test';
import assert from 'node:assert/strict';
import {memoizedAttendanceTransaction} from '../takodeal-manager/attendance-transaction-reader.js';
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
