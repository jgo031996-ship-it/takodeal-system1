import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';

const workerSource=readFileSync(new URL('../takodeal-manager/sw.js',import.meta.url),'utf8');
const origin='https://owner.example',href=origin+'/sw.js';
function harness({failCore=false}={}) {
  const listeners={},batches=[],removed=[];let skipped=0,claimed=0;
  const context={URL,Request,Response,AbortController,setTimeout,clearTimeout,
    self:{location:{origin,href},addEventListener:(name,handler)=>listeners[name]=handler,
      skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}},
    caches:{
      open:async name=>({
        addAll:async assets=>{
          const urls=Array.from(assets,asset=>new URL(typeof asset==='string'?asset:asset.url,href).href);
          // Cache.addAll rejects a batch containing the same request twice.
          if(new Set(urls).size!==urls.length)throw new DOMException('Duplicate request','InvalidStateError');
          if(failCore)throw new TypeError('Required app file unavailable');
          batches.push({name,urls});
        },add:async()=>{},match:async()=>null,put:async()=>{}
      }),
      keys:async()=>['takodeal-manager-core-old','takodeal-manager-vendors-v1','takodeal-manager-images-v1','paid-sales-outbox'],
      delete:async name=>removed.push(name)
    },fetch:async()=>new Response('',{status:404}),DOMException
  };
  vm.runInNewContext(workerSource,context);
  async function fire(type){let pending;listeners[type]({waitUntil:value=>pending=value});await pending;}
  return {fire,batches,removed,skipped:()=>skipped,claimed:()=>claimed};
}
test('Owner update installs each required URL once and includes the online sales controls',async()=>{
  const worker=harness();await worker.fire('install');assert.equal(worker.skipped(),1);
  assert.equal(worker.batches.length,1);const urls=worker.batches[0].urls;
  for(const asset of ['index.html','main.js','online-refunds.js','online-refunds-ui.js','online-refunds.css','dispatch-request-draft.js']){
    assert.equal(urls.filter(url=>url===origin+'/'+asset).length,1,asset);
  }
});
test('all required Owner shell assets exist in the release',async()=>{
  const worker=harness();await worker.fire('install');
  for(const url of worker.batches[0].urls){
    const file=decodeURIComponent(new URL(url).pathname).slice(1)||'index.html';
    assert.ok(existsSync(new URL('../takodeal-manager/'+file,import.meta.url)),file);
  }
});
test('a failed required file prevents activation instead of promoting a partial app',async()=>{
  const worker=harness({failCore:true});await assert.rejects(worker.fire('install'),/Required app file/);
  assert.equal(worker.skipped(),0);
});
test('activation replaces old Owner shell caches and preserves outbox and shared asset caches',async()=>{
  const worker=harness();await worker.fire('activate');
  assert.deepEqual(worker.removed,['takodeal-manager-core-old']);assert.equal(worker.claimed(),1);
});
