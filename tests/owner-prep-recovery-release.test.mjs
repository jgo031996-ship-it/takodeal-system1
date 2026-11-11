import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ownerPrepRecoveryReleaseProof as proof,restoreOwnerPrepRecoveryRelease} from './helpers/owner-prep-recovery-release-inverse.mjs';
import {restorePrivatePrepRelease} from './helpers/private-prep-release-inverse.mjs';
import {OWNER_DOCUMENT_RELEASE} from '../takodeal-manager/owner-update-notice.js';
const root=fileURLToPath(new URL('../',import.meta.url)),read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8'),sha=value=>createHash('sha256').update(value).digest('hex');
const git=(commit,path)=>execFileSync('git',['show',commit+':'+path],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});

test('only six release substitutions in four existing files restore every exact live Owner byte',()=>{
 assert.equal(proof.base,'2834ba0452201e3fa5f052b9daef49d2e77dd7df');assert.equal(Object.keys(proof.files).length,4);assert.equal(Object.values(proof.files).reduce((n,row)=>n+row.edits.length,0),6);
 for(const file of Object.keys(proof.files))assert.deepEqual(Buffer.from(restoreOwnerPrepRecoveryRelease(file,read(file))),git(proof.base,file),file);
 assert.deepEqual(Buffer.from(read('takodeal-manager/main.js')),git(proof.base,'takodeal-manager/main.js'),'main business logic is byte-identical');
});

test('historical private prep source pins stay unchanged and release layering still restores d70 exactly',()=>{
 const old='tests/fixtures/private-prep-release-inverse.json';assert.equal(sha(read(old)),'6b5d43bd55f4af3b5f27ec74a59ccca598a9b5211efdcfae07e6d6d8013305e1');assert.equal(proof.historicalProofSha256,sha(read(old)));
 const historical=JSON.parse(read(old));for(const file of Object.keys(historical.files))assert.deepEqual(Buffer.from(restorePrivatePrepRelease(file,read(file))),git(historical.base,file),file);
});

test('source inverses reject extra edits rather than silently normalizing unreviewed behavior',()=>{
 for(const file of Object.keys(proof.files)){
  assert.throws(()=>restoreOwnerPrepRecoveryRelease(file,read(file)+'\n/* extra change */'));
  const edit=proof.files[file].edits[0];assert.throws(()=>restoreOwnerPrepRecoveryRelease(file,read(file).replace(edit.after,edit.before)));
 }
 assert.equal(restoreOwnerPrepRecoveryRelease('takodeal-manager/main.js','unchanged'),'unchanged');
});

test('the page, stylesheet, auth import, cache and update notice identify the same recovery release',()=>{
 assert.equal(proof.release,'prep-recovery-20261111-r1');assert.equal(OWNER_DOCUMENT_RELEASE,'takodeal-manager-core-v142-'+proof.release);
 const html=read('takodeal-manager/index.html');for(const value of ['content="'+proof.release+'"','private-prep-reviews.css?v='+proof.release,'auth.js?v='+proof.release])assert.ok(html.includes(value));
 assert.ok(read('takodeal-manager/auth.js').includes("main.js?v="+proof.release));assert.ok(read('takodeal-manager/sw.js').includes("const CACHE_NAME = '"+OWNER_DOCUMENT_RELEASE+"';"));
 const oldWorker=git(proof.base,'takodeal-manager/sw.js').toString();assert.equal(restoreOwnerPrepRecoveryRelease('takodeal-manager/sw.js',read('takodeal-manager/sw.js')),oldWorker,'all cache/storage/worker behavior remains identical');
});
