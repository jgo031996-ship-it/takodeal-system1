import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const pin=JSON.parse(readFileSync(new URL('fixtures/worked-review-release.json',import.meta.url),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4e6}).trim();
const scope=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules'];
const linked=JSON.parse(readFileSync(new URL('fixtures/staff-employee-release.json',import.meta.url),'utf8'));
const contact=JSON.parse(readFileSync(new URL('fixtures/staff-contact-release.json',import.meta.url),'utf8'));
test('prior worked-shift release matches its immutable product parent and complete scope',()=>{
 const paths=git('diff','--name-only',pin.parent,linked.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(pin.files).sort());
 for(const [file,row] of Object.entries(pin.files)){
  assert.equal(git('rev-parse',pin.parent+':'+file),row.before,file+' original');
  assert.equal(git('rev-parse',linked.parent+':'+file),row.after,file+' worked-shift release');
 }
});
test('Staff employee portal changes exactly match the reviewed release and its production parent',()=>{
 const paths=git('diff','--name-only',linked.parent,contact.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(linked.files).sort());
 for(const [file,row] of Object.entries(linked.files)){
  const original=git('ls-tree',linked.parent,'--',file).split(/\s+/)[2]||null;
  assert.equal(original,row.before,file+' original');
  assert.equal(git('rev-parse',contact.parent+':'+file),row.after,file+' employee release');
 }
});
test('contact and Vault release matches the reviewed files and live Staff parent',()=>{
 const paths=[git('diff','--name-only',contact.parent,'--',...scope),git('ls-files','--others','--exclude-standard','--',...scope)].flatMap(list=>list.split(/\r?\n/)).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(contact.files).sort());
 for(const [file,row] of Object.entries(contact.files)){
  assert.equal(git('rev-parse',contact.parent+':'+file),row.before,file+' original');
  assert.equal(git('hash-object','--no-filters',file),row.after,file+' candidate');
 }
});
