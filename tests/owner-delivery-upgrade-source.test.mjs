import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ownerDeliveryProof as proof,ownerDeliverySha as sha,restoreOwnerDeliveryUpgrade} from './helpers/owner-delivery-upgrade-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
test('the delivery release changes only the reviewed reader, atomic dispatch budget, editor rules and release labels',()=>{
 const scopes=['takodeal-manager','Takodeal-POS','takodeal-franchise','takodeal-staff','takodeal-delivery','Customer','functions','firestore.rules','storage.rules'];
 const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).trim().split(/\r?\n/)].filter(Boolean));assert.deepEqual([...changed].sort(),[...Object.keys(proof.files),...Object.keys(proof.newFiles)].sort());
 for(const file of Object.keys(proof.files)){assert.equal(restoreOwnerDeliveryUpgrade(read(file),file),git('show',proof.base+':'+file));assert.throws(()=>restoreOwnerDeliveryUpgrade(read(file)+'\n// unrelated mutation',file));}
 for(const [file,pin]of Object.entries(proof.newFiles))assert.equal(sha(read(file)),pin);
 for(const file of ['tests/fixtures/live-branch-directory-inverse.json','tests/fixtures/branch-settings-save-inverse.json'])assert.equal(read(file),git('show',proof.base+':'+file));
});
