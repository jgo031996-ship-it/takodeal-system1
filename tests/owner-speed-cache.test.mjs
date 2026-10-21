import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionCache} from '../takodeal-manager/collection-cache.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('confirmed reference rows resolve once before a pending optional disk write',async()=>{
 const write=deferred(),rows=[{id:'sample-menu'}];let reads=0,puts=0;const cache=createCollectionCache(async()=>{reads++;return rows;},{scope:()=> 'sample-owner',storage:{get:async()=>null,put:async()=>{puts++;await write.promise;}}});
 const [first,second]=await Promise.all([cache.get('menu'),cache.get('menu')]);assert.equal(first,rows);assert.equal(second,rows);assert.equal(reads,1);assert.equal(puts,1);assert.equal(await cache.get('menu'),rows);write.resolve();await tick();
});
test('a failed disk write cannot reject confirmed reference rows or poison the memory cache',async()=>{
 const write=deferred();let reads=0;const cache=createCollectionCache(async()=>[{id:'read-'+(++reads)}],{scope:()=> 'sample-owner',storage:{get:async()=>null,put:()=>write.promise}});const rows=await cache.get('bom');write.reject(Error('Sample quota exhausted'));await tick();assert.equal(await cache.get('bom'),rows);assert.equal(reads,1);
});
test('invalidation stays queued after a pending write and a replacement read cannot hydrate that stale write',async()=>{
 const gate=deferred(),records=new Map(),events=[];let reads=0,puts=0;const storage={get:async(uid,name)=>{events.push('get');return structuredClone(records.get(uid+'/'+name));},put:async(uid,name,entry)=>{const n=++puts;events.push('put'+n+' begin');if(n===1)await gate.promise;records.set(uid+'/'+name,structuredClone(entry));events.push('put'+n+' finish');},remove:async(uid,name)=>{events.push('remove');records.delete(uid+'/'+name);}};const cache=createCollectionCache(async()=>[{id:'read-'+(++reads)}],{scope:()=> 'sample-owner',storage});
 assert.equal((await cache.get('menu'))[0].id,'read-1');let removed=false;const invalidated=cache.invalidate('menu').then(()=>removed=true);const replacement=cache.get('menu');await tick();assert.equal(reads,1);assert.equal(removed,false);gate.resolve();await invalidated;assert.equal((await replacement)[0].id,'read-2');await tick();assert.equal(records.get('sample-owner/menu').rows[0].id,'read-2');assert.deepEqual(events,['get','put1 begin','put1 finish','remove','get','put2 begin','put2 finish']);
});
test('an invalidated or cleared in-flight server read cannot enqueue a stale disk overwrite',async()=>{
 for(const reset of ['invalidate','clearMemory']){const old=deferred(),writes=[];let reads=0;const cache=createCollectionCache(async()=>++reads===1?old.promise:[{id:'new'}],{scope:()=> 'sample-owner',storage:{get:async()=>null,put:async(uid,name,entry)=>writes.push(entry.rows[0].id),remove:async()=>{}}});const pending=cache.get('menu');await tick();if(reset==='invalidate')await cache.invalidate('menu');else cache.clearMemory();assert.equal((await cache.get('menu'))[0].id,'new');old.resolve([{id:'old'}]);assert.equal((await pending)[0].id,'old');await tick();assert.deepEqual(writes,['new']);assert.equal((await cache.get('menu'))[0].id,'new');}
});
test('a later UID and memory clear do not wait on another UID’s pending write or receive its rows',async()=>{
 const gate=deferred(),records=new Map(),events=[];let uid='owner-one',reads=0;const cache=createCollectionCache(async()=>[{id:uid+'-'+(++reads)}],{scope:()=>uid,storage:{get:async(user,name)=>structuredClone(records.get(user+'/'+name)),put:async(user,name,entry)=>{events.push(user);if(user==='owner-one')await gate.promise;records.set(user+'/'+name,structuredClone(entry));}}});assert.equal((await cache.get('menu'))[0].id,'owner-one-1');uid='owner-two';cache.clearMemory();assert.equal((await cache.get('menu'))[0].id,'owner-two-2');await tick();assert.equal(records.get('owner-two/menu').rows[0].id,'owner-two-2');gate.resolve();await tick();assert.equal(records.get('owner-one/menu').rows[0].id,'owner-one-1');assert.equal((await cache.get('menu'))[0].id,'owner-two-2');assert.deepEqual(events,['owner-one','owner-two']);
});
