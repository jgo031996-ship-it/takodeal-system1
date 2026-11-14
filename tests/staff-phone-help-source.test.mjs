import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {staffPhoneHelpProof as proof,staffPhoneHelpSha as sha,restoreStaffPhoneHelp} from './helpers/staff-phone-help-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('Staff phone help changes only five reviewed client files; every backend, policy and other app stays exact',()=>{
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
    const scopes=['takodeal-staff','takodeal-manager','Takodeal-POS','takodeal-franchise','Customer','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/).filter(Boolean);
    assert.deepEqual(changed.sort(),Object.keys(proof.files).sort());
    for(const [file,pin]of Object.entries(proof.files)){
        assert.equal(sha(read(file)),pin.candidateSha256,file);assert.equal(restoreStaffPhoneHelp(read(file),file),git('show',proof.base+':'+file));
    }
});
