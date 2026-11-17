import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const sync=JSON.parse(readFileSync(new URL('fixtures/employee-live-sync.json',import.meta.url),'utf8'));
const onboarding=JSON.parse(readFileSync(new URL('fixtures/staff-phone-onboarding.json',import.meta.url),'utf8'));
const stockReview=JSON.parse(readFileSync(new URL('fixtures/branch-item-sync-review.json',import.meta.url),'utf8'));
const root=new URL('../',import.meta.url);
const pin=JSON.parse(readFileSync(new URL('fixtures/worked-review-release.json',import.meta.url),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4e6}).trim();
const scope=['Takodeal-POS','takodeal-manager','takodeal-staff','takodeal-franchise','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules'];
const linked=JSON.parse(readFileSync(new URL('fixtures/owner-inbox-release.json',import.meta.url),'utf8'));
test('prior worked-shift release matches its immutable product parent and complete scope',()=>{
 const paths=git('diff','--name-only',pin.parent,linked.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(pin.files).sort());
 for(const [file,row] of Object.entries(pin.files)){
  assert.equal(git('rev-parse',pin.parent+':'+file),row.before,file+' original');
  assert.equal(git('rev-parse',linked.parent+':'+file),row.after,file+' worked-shift release');
 }
});
test('Owner Inbox changes exactly match the reviewed release and its production parent',()=>{
 const paths=git('diff','--name-only',linked.parent,sync.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(linked.files).sort());
 for(const [file,row] of Object.entries(linked.files)){
  const original=git('ls-tree',linked.parent,'--',file).split(/\s+/)[2]||null;
  assert.equal(original,row.before,file+' original');
  assert.equal(git('rev-parse',sync.parent+':'+file),row.after,file+' released');
 }
});

test('employee profile sync matches the reviewed scope and exact production parent',()=>{
 const paths=git('diff','--name-only',sync.parent,onboarding.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(sync.files).sort());
 for(const [file,row] of Object.entries(sync.files)){
  const original=git('ls-tree',sync.parent,'--',file).split(/\s+/)[2]||null;
  assert.equal(original,row.before,file+' original');
  assert.equal(git('rev-parse',onboarding.parent+':'+file),row.after,file+' released');
 }
});

test('staff phone onboarding matches the reviewed scope and exact production parent',()=>{
 const paths=git('diff','--name-only',onboarding.parent,stockReview.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(onboarding.files).sort());
 for(const [file,row] of Object.entries(onboarding.files)){
  const original=git('ls-tree',onboarding.parent,'--',file).split(/\s+/)[2]||null;
  assert.equal(original,row.before,file+' original');
  assert.equal(git('rev-parse',stockReview.parent+':'+file),row.after,file+' released');
 }
});

const staffPin=JSON.parse(readFileSync(new URL('fixtures/staff-pin-release.json',import.meta.url),'utf8'));
test('branch item sync preview matches the reviewed scope and exact production parent',()=>{
 const paths=git('diff','--name-only',stockReview.parent,staffPin.parent,'--',...scope).split(/\r?\n/).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(stockReview.files).sort());
 for(const [file,row] of Object.entries(stockReview.files)){
  const original=git('ls-tree',stockReview.parent,'--',file).split(/\s+/)[2]||null;
  assert.equal(original,row.before,file+' original');
  assert.equal(git('rev-parse',staffPin.parent+':'+file),row.after,file+' candidate');
 }
});

test('personal setup and daily PIN display matches the reviewed scope and exact production parent',()=>{
 const paths=[git('diff','--name-only',staffPin.parent,'--',...scope),git('ls-files','--others','--exclude-standard','--',...scope)].flatMap(list=>list.split(/\r?\n/)).filter(Boolean).sort();
 assert.deepEqual(paths,Object.keys(staffPin.files).sort());
 for(const [file,row] of Object.entries(staffPin.files)){
  const original=git('ls-tree',staffPin.parent,'--',file).split(/\s+/)[2]||null;
  assert.equal(original,row.before,file+' original');
  assert.equal(git('hash-object','--no-filters',file),row.after,file+' candidate');
 }
});
