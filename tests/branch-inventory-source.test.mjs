import {restoreCommissary,isCommissaryModule} from './helpers/commissary-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {branchInventorySetupProof as proof,branchInventorySetupSha as sha,restoreBranchInventorySetup} from './helpers/branch-inventory-setup-inverse.mjs';
import {OWNER_DOCUMENT_RELEASE} from '../takodeal-manager/owner-update-notice.js';
const root=new URL('../',import.meta.url),read=file=>restoreCommissary(readFileSync(new URL(file,root),'utf8'),file);
test('branch catalog setup changes only exact reviewed Owner files and preserves all other live app, backend and policy bytes',()=>{
 const scope=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules'];
 const changed=execFileSync('git',['diff','--name-only',proof.base,'--',...scope],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).sort();
 // Newly added modules can be untracked while this local check is running.
 const fresh=execFileSync('git',['ls-files','--others','--exclude-standard','--',...scope],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...changed,...fresh])].filter(file=>!isCommissaryModule(file)).sort(),[...Object.keys(proof.files),...Object.keys(proof.newFiles)].sort());
 for(const [file,row]of Object.entries(proof.files)){
  const source=read(file),baseline=execFileSync('git',['show',proof.base+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4e6});
  assert.equal(sha(source),row.candidateSha256);assert.equal(restoreBranchInventorySetup(source,file),baseline);assert.notEqual(restoreBranchInventorySetup(source+'\n// unknown mutation',file),baseline);
 }
 for(const [file,expected]of Object.entries(proof.newFiles))assert.equal(sha(read(file)),expected);
});
test('the new catalog modules and all release entry labels are available in the same Owner app generation',()=>{
 const release='branch-inventory-20261115-r1',worker=read('takodeal-manager/sw.js');assert.equal(OWNER_DOCUMENT_RELEASE,'takodeal-manager-core-v156-commissary-20261115-r1');assert.ok(worker.includes('takodeal-manager-core-v155-'+release));assert.ok(readFileSync(new URL('takodeal-manager/sw.js',root),'utf8').includes(OWNER_DOCUMENT_RELEASE));assert.ok(read('takodeal-manager/auth.js').includes('main.js?v='+release));assert.ok(read('takodeal-manager/index.html').includes('auth.js?v='+release));
 for(const path of Object.keys(proof.newFiles))assert.ok(worker.includes("'./"+path.split('/').pop()+"'"),path);
});
