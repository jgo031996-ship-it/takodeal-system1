import {simpleVoidProof,legacyVoidSource,simpleVoidOnlyChange} from './helpers/cashier-simple-void-inverse.mjs';
import {cashierOwnerRegisterProof,excludeCashierOwnerRegisterLeaf} from './helpers/cashier-owner-register-inverse.mjs';
import {normalizeCashierReceivingProgress} from './helpers/cashier-receiving-progress-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {largeDeliveryProof} from './helpers/large-delivery-status-inverse.mjs';
import {cashierOwnerEntryProof,restoreCashierOwnerEntry} from './helpers/cashier-owner-entry-inverse.mjs';
import {cashierOwnerWorkspaceProof,restoreCashierOwnerWorkspace} from './helpers/cashier-owner-workspace-inverse.mjs';
import {liveBranchDirectoryProof as proof,restoreLiveBranchDirectory,liveBranchSha as sha} from './helpers/live-branch-directory-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>normalizeCashierReceivingProgress(readFileSync(new URL(file,root),'utf8'),file),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
test('automatic branch discovery restores every exact prior product byte and adds only the pinned public reader',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).trim().split(/\r?\n/)].filter(Boolean));for(const file of [...changed])if(simpleVoidOnlyChange(file,read,()=>git('show',proof.base+':'+file)))changed.delete(file);
    assert.equal(cashierOwnerEntryProof.base,'dfa305e3ed9267eb41c1ade0ab2c613b10b2821e');assert.equal(Object.keys(cashierOwnerEntryProof.files).length,5);assert.equal(Object.values(cashierOwnerEntryProof.files).reduce((n,row)=>n+row.edits.length,0),6);
    assert.equal(cashierOwnerWorkspaceProof.base,'af0dbe1cc854a87c439de2520e58d9a34e851a5f');assert.equal(Object.keys(cashierOwnerWorkspaceProof.files).length,5);assert.equal(Object.keys(cashierOwnerWorkspaceProof.newFiles).length,2);
    const historical=[...changed].filter(file=>{if(excludeCashierOwnerRegisterLeaf(file,read))return false;if(cashierOwnerWorkspaceProof.newFiles[file]){assert.equal(sha(read(file)),cashierOwnerWorkspaceProof.newFiles[file]);return false;}if(!cashierOwnerEntryProof.files[file]&&!cashierOwnerWorkspaceProof.files[file])return true;const source=read(file),workspace=restoreCashierOwnerWorkspace(source,file),restored=restoreCashierOwnerEntry(workspace,file);if(cashierOwnerWorkspaceProof.files[file]){assert.equal(workspace,git('show',cashierOwnerWorkspaceProof.base+':'+file));assert.throws(()=>restoreCashierOwnerWorkspace(source+'\n// unreviewed workspace change',file));}assert.equal(restored,git('show',cashierOwnerEntryProof.base+':'+file));if(cashierOwnerEntryProof.files[file])assert.throws(()=>restoreCashierOwnerEntry(source+'\n// unreviewed startup change',file));return restored!==git('show',proof.base+':'+file);});
    assert.deepEqual(historical.sort(),[...new Set([...Object.keys(proof.files),...Object.keys(proof.newFiles),...Object.keys(largeDeliveryProof.files)])].sort());
    for(const file of Object.keys(proof.files)) {const source=read(file);assert.equal(restoreLiveBranchDirectory(source,file),git('show',proof.base+':'+file),file);assert.throws(()=>restoreLiveBranchDirectory(source+'\n// extra mutation',file));}
    const hashes=new Set();for(const[file,pin]of Object.entries(proof.newFiles)){assert.equal(sha(read(file)),pin,file);hashes.add(pin);}assert.equal(hashes.size,1,'Every standalone app ships the same reader');
});
