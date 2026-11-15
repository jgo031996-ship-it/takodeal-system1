import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {largeDeliveryProof} from './helpers/large-delivery-status-inverse.mjs';
import {cashierOwnerEntryProof,restoreCashierOwnerEntry} from './helpers/cashier-owner-entry-inverse.mjs';
import {liveBranchDirectoryProof as proof,restoreLiveBranchDirectory,liveBranchSha as sha} from './helpers/live-branch-directory-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
test('automatic branch discovery restores every exact prior product byte and adds only the pinned public reader',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).trim().split(/\r?\n/)].filter(Boolean));
    assert.equal(cashierOwnerEntryProof.base,'dfa305e3ed9267eb41c1ade0ab2c613b10b2821e');assert.equal(Object.keys(cashierOwnerEntryProof.files).length,4);assert.equal(Object.values(cashierOwnerEntryProof.files).reduce((n,row)=>n+row.edits.length,0),4);
    const historical=[...changed].filter(file=>{if(!cashierOwnerEntryProof.files[file])return true;const source=read(file),restored=restoreCashierOwnerEntry(source,file);assert.equal(restored,git('show',cashierOwnerEntryProof.base+':'+file));assert.throws(()=>restoreCashierOwnerEntry(source+'\n// unreviewed startup change',file));return restored!==git('show',proof.base+':'+file);});
    assert.deepEqual(historical.sort(),[...new Set([...Object.keys(proof.files),...Object.keys(proof.newFiles),...Object.keys(largeDeliveryProof.files)])].sort());
    for(const file of Object.keys(proof.files)) {const source=read(file);assert.equal(restoreLiveBranchDirectory(source,file),git('show',proof.base+':'+file),file);assert.throws(()=>restoreLiveBranchDirectory(source+'\n// extra mutation',file));}
    const hashes=new Set();for(const[file,pin]of Object.entries(proof.newFiles)){assert.equal(sha(read(file)),pin,file);hashes.add(pin);}assert.equal(hashes.size,1,'Every standalone app ships the same reader');
});
