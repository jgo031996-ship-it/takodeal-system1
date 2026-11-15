import {legacyPlottedRead,normalizePlottedGitResult} from './helpers/plotted-release-inverse.mjs';
const readFileSync=(...args)=>legacyPlottedRead(_plottedRawFs(...args),args[0]);
const execFileSync=(...args)=>normalizePlottedGitResult(_plottedRawExec(...args),args[0],args[1]);
import {isHistoricalOwnerChange,restoreAttendanceOvertime} from './helpers/attendance-overtime-inverse.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync as _plottedRawFs} from 'node:fs';
import {execFileSync as _plottedRawExec} from 'node:child_process';
import {largeDeliveryProof as proof,largeDeliverySha as sha,restoreLargeDeliveryStatus} from './helpers/large-delivery-status-inverse.mjs';
import {restoreOwnerProfileMobile,proof as mobileProof} from './helpers/owner-profile-mobile-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('large shipment fix retains every other live product and backend byte',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-franchise','takodeal-staff','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
    const changed=git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/).filter(Boolean).filter(file=>isHistoricalOwnerChange(file,proof.base));
    assert.deepEqual(changed.sort(),[...new Set([...Object.keys(proof.files),...Object.keys(mobileProof.files)])].sort());
    for(const [file,pin]of Object.entries(proof.files)){
        assert.equal(sha(restoreOwnerProfileMobile(read(file),file)),pin.candidateSha256,file);
        assert.equal(restoreLargeDeliveryStatus(read(file),file),git('show',proof.base+':'+file));
    }
});
