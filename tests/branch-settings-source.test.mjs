import {ownerDeliveryProof} from './helpers/owner-delivery-upgrade-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {branchSettingsSaveProof as proof,restoreBranchSettingsSave} from './helpers/branch-settings-save-inverse.mjs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const git=(...args)=>execFileSync('git',args,{cwd:new URL('../',import.meta.url),encoding:'utf8',maxBuffer:5e6});
test('only six Owner product files differ from the exact deployed branch-settings baseline',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-staff','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/).filter(Boolean).filter(file=>file!=='takodeal-manager/live-branch-directory.js').filter(file=>!Object.hasOwn(ownerDeliveryProof.files,file)||Object.hasOwn(proof.files,file));
    assert.deepEqual(changed.sort(),Object.keys(proof.files).sort());assert.equal(changed.length,6);
    for(const file of changed) {
        const source=read(file),baseline=git('show',proof.base+':'+file);
        assert.equal(restoreBranchSettingsSave(file,source),baseline,file);
        assert.equal(restoreBranchSettingsSave(file,baseline),baseline,file+' inverse is idempotent');
        assert.throws(()=>restoreBranchSettingsSave(file,source+'\n// extra mutation'),file+' rejects unrelated edits');
    }
});
