import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {proof,sha,restoreStaffPersonalVault} from './helpers/staff-personal-vault-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('personal Vault client changes only the reviewed Pay authority, recovery wording and shell release',()=>{
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4e6}),scopes=['takodeal-manager','takodeal-staff','functions','Takodeal-POS','Customer','takodeal-franchise','takodeal-delivery','firestore.rules','storage.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).trim().split(/\r?\n/)].filter(Boolean));
 assert.deepEqual([...changed].sort(),[...Object.keys(proof.files),...Object.keys(proof.newFiles)].sort());
 for(const [file,row]of Object.entries(proof.files)){assert.equal(sha(read(file)),row.candidateSha256);assert.equal(restoreStaffPersonalVault(read(file),file),git('show',proof.base+':'+file));}
 for(const [file,hash]of Object.entries(proof.newFiles))assert.equal(sha(read(file)),hash);
 const worker=read('takodeal-staff/sw.js'),html=read('takodeal-staff/index.html');assert.ok(worker.includes('takodeal-staff-v62-personal-vault-20261114-r1'));assert.ok(html.includes('staff-personal-vault-20261114-r1'));assert.ok(worker.includes("'./staff-pay-phone.js'"));
});
