import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const pin=JSON.parse(readFileSync(new URL('fixtures/worked-review-release.json',import.meta.url),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4e6}).trim();
const scope=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules'];
test('the current product changes exactly match the reviewed release and its production parent',()=>{
 const paths=[git('diff','--name-only',pin.parent,'--',...scope),git('ls-files','--others','--exclude-standard','--',...scope)].flatMap(list=>list.split(/\r?\n/)).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(pin.files).sort());
 for(const [file,row] of Object.entries(pin.files)){
  assert.equal(git('rev-parse',pin.parent+':'+file),row.before,file+' original');
  assert.equal(git('hash-object','--no-filters',file),row.after,file+' candidate');
 }
});

