import {proof as personalProof,restoreStaffPersonalVault} from './helpers/staff-personal-vault-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {staffPhoneHelpProof} from './helpers/staff-phone-help-inverse.mjs';
import {liveBranchDirectoryProof as proof,restoreLiveBranchDirectory,liveBranchSha as sha} from './helpers/live-branch-directory-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
test('automatic branch discovery restores every exact prior product byte and adds only the pinned public reader',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=new Set([...git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).trim().split(/\r?\n/)].filter(Boolean));
    assert.deepEqual([...changed].sort(),[...new Set([...Object.keys(proof.files),...Object.keys(proof.newFiles),...Object.keys(staffPhoneHelpProof.files),...Object.keys(personalProof.files),...Object.keys(personalProof.newFiles)])].sort());
    for(const file of Object.keys(proof.files)) {const source=read(file);assert.equal(restoreLiveBranchDirectory(source,file),git('show',proof.base+':'+file),file);assert.throws(()=>restoreLiveBranchDirectory(source+'\n// extra mutation',file));}
    const hashes=new Set();for(const[file,pin]of Object.entries(proof.newFiles)){assert.equal(sha(read(file)),pin,file);hashes.add(pin);}assert.equal(hashes.size,1,'Every standalone app ships the same reader');
});
