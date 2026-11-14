import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {proof,sha,restoreOwnerProfileMobile} from './helpers/owner-profile-mobile-inverse.mjs';
const root=new URL('../',import.meta.url);
test('employee phone layout retains every other product and backend byte',()=>{
 const changed=execFileSync('git',['diff','--name-only',proof.base,'--','takodeal-manager','takodeal-staff','functions','Takodeal-POS','Customer','takodeal-franchise','takodeal-delivery','firestore.rules','storage.rules'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
 assert.deepEqual(changed.sort(),Object.keys(proof.files).sort());
 for(const [file,row]of Object.entries(proof.files)){const source=readFileSync(new URL(file,root),'utf8');assert.equal(sha(source),row.candidateSha256);assert.equal(restoreOwnerProfileMobile(source,file),execFileSync('git',['show',proof.base+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4e6}));}
});
