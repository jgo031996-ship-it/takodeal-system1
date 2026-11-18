import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {staffCohort} from '../tools/build-staff-cohort.mjs';
const root=new URL('../takodeal-staff/',import.meta.url);
function worker(tamper=''){
 const handlers={},rows=new Map([['previous-working-release',new Map([['keep','safe']])]]),requests=[];
 const caches={has:async k=>rows.has(k),delete:async k=>rows.delete(k),open:async k=>{if(!rows.has(k))rows.set(k,new Map());const map=rows.get(k);return{put:async(k,v)=>map.set(k,v.clone()),match:async k=>map.get(k)?.clone()};}};
 const context={URL,Request,Response,AbortController,crypto:webcrypto,setTimeout,clearTimeout,console,caches,self:{location:{href:'https://staff.test/sw.js'},addEventListener:(n,f)=>handlers[n]=f},fetch:async request=>{const path=new URL(request.url).pathname;requests.push(path);return new Response(path===tamper?'wrong release':readFileSync(new URL(path==='/'?'index.html':path.slice(1),root)));}};
 vm.runInNewContext(readFileSync(new URL('sw.js',root),'utf8'),context);
 return{rows,requests,install:()=>{let promise;handlers.install({waitUntil:p=>promise=p});return promise;},fetch:(path,mode)=>{let response;handlers.fetch({request:{method:'GET',url:'https://staff.test'+path,mode},respondWith:p=>response=p});return response;}};
}
test('published release manifest includes exact bytes of every shell asset',()=>{const cohort=staffCohort();assert.equal(cohort.source,cohort.output,'Run node tools/build-staff-cohort.mjs');assert.ok(Object.keys(cohort.integrity).length>100);});
test('real worker install verifies and caches the full release without deleting the previous cache',async()=>{const w=worker();await w.install();assert.equal(w.requests.length,Object.keys(staffCohort().integrity).length);assert.equal(w.rows.get('previous-working-release').get('keep'),'safe');const html=await(await w.fetch('/?signup=complete','navigate')).text();assert.match(html,/staff-profile-photo-contract-20261118-r3/);assert.equal(w.fetch('/signup.html','navigate'),undefined);assert.equal(w.fetch('/another-page.html','navigate'),undefined);});
test('a mismatched module rejects installation and removes only the incomplete new cache',async()=>{const w=worker('/app.js');await assert.rejects(w.install(),/different release/);assert.deepEqual([...w.rows.keys()],['previous-working-release']);});
