import {proof as personalProof,restoreStaffPersonalVault} from './helpers/staff-personal-vault-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {staffPhoneHelpProof as proof,staffPhoneHelpSha as sha,restoreStaffPhoneHelp} from './helpers/staff-phone-help-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('Staff phone help changes only five reviewed client files; every backend, policy and other app stays exact',()=>{
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
    const scopes=['takodeal-staff','takodeal-manager','Takodeal-POS','takodeal-franchise','Customer','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=[...new Set([...git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/),...git('ls-files','--others','--exclude-standard','--',...scopes).trim().split(/\r?\n/)].filter(Boolean))];
    assert.deepEqual(changed.sort(),[...new Set([...Object.keys(proof.files),...Object.keys(personalProof.files),...Object.keys(personalProof.newFiles)])].sort());
    for(const [file,pin]of Object.entries(proof.files)){
        assert.equal(sha(restoreStaffPersonalVault(read(file),file)),pin.candidateSha256,file);assert.equal(restoreStaffPhoneHelp(read(file),file),git('show',proof.base+':'+file));
    }
});
