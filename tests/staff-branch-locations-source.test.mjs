import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {staffBranchLocationsProof as proof,restoreStaffBranchLocations} from './helpers/staff-branch-locations-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:5e6});
test('five exact Staff GPS/release changes preserve all other apps, attendance writes, private identity and rules',()=>{
    const scopes=['takodeal-staff','takodeal-manager','Takodeal-POS','Customer','takodeal-franchise','takodeal-delivery','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const changed=git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/).filter(Boolean).filter(file=>file!=='takodeal-staff/live-branch-directory.js');
    assert.equal(changed.length,5);assert.deepEqual(changed.sort(),Object.keys(proof.files).sort());
    for(const file of changed) {
        const source=read(file),baseline=git('show',proof.base+':'+file);assert.equal(restoreStaffBranchLocations(source,file),baseline,file);
        assert.equal(restoreStaffBranchLocations(baseline,file),baseline);assert.throws(()=>restoreStaffBranchLocations(source+'\n// extra change',file));
    }
    const punch=source=>{const start=source.indexOf('window.punchTime = async function');return source.slice(start,source.indexOf('// 📥 STAFF REQUESTS & INBOX ENGINE',start));};
    assert.equal(punch(read('takodeal-staff/app.js')),punch(git('show',proof.base+':takodeal-staff/app.js')));
});
