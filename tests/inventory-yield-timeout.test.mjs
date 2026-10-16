import test from 'node:test';
import assert from 'node:assert/strict';
import {runYieldOperation} from '../takodeal-manager/inventory-yield.js';
test('yield UI timeout retains the pending database operation and prevents duplicate retries',async()=>{
 const timers=new Map();let next=0,calls=0,finish;
 const api={setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);}};
 const start=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 const first=runYieldOperation(api,'same-read',start);await Promise.resolve();
 [...timers.values()][0]();await assert.rejects(first,/not replied/);
 const retry=runYieldOperation(api,'same-read',start);await Promise.resolve();assert.equal(calls,1);
 finish('loaded');assert.equal(await retry,'loaded');
 assert.equal(await runYieldOperation(api,'same-read',()=>{calls++;return 'fresh';}),'fresh');assert.equal(calls,2);
});
