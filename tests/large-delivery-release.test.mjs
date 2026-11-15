import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {largeDeliveryProof as proof,largeDeliverySha as sha,restoreLargeDeliveryStatus} from './helpers/large-delivery-status-inverse.mjs';
import {cashierOwnerEntryProof,restoreCashierOwnerEntry} from './helpers/cashier-owner-entry-inverse.mjs';
import {cashierOwnerWorkspaceProof,restoreCashierOwnerWorkspace} from './helpers/cashier-owner-workspace-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('large shipment fix retains every other live product and backend byte',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-franchise','takodeal-staff','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
    const changed=git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/).filter(Boolean);
    assert.equal(cashierOwnerEntryProof.base,'dfa305e3ed9267eb41c1ade0ab2c613b10b2821e');assert.equal(Object.keys(cashierOwnerEntryProof.files).length,5);assert.equal(Object.values(cashierOwnerEntryProof.files).reduce((n,row)=>n+row.edits.length,0),6);
    const restoredEntry=new Map();
    assert.equal(cashierOwnerWorkspaceProof.base,'af0dbe1cc854a87c439de2520e58d9a34e851a5f');assert.equal(Object.keys(cashierOwnerWorkspaceProof.files).length,5);assert.equal(Object.keys(cashierOwnerWorkspaceProof.newFiles).length,2);
    for(const file of new Set([...Object.keys(cashierOwnerEntryProof.files),...Object.keys(cashierOwnerWorkspaceProof.files)])){
        const source=read(file),workspace=restoreCashierOwnerWorkspace(source,file),restored=restoreCashierOwnerEntry(workspace,file);
        if(cashierOwnerWorkspaceProof.files[file]){assert.equal(workspace,git('show',cashierOwnerWorkspaceProof.base+':'+file));assert.throws(()=>restoreCashierOwnerWorkspace(source+'\n// unreviewed change',file));}
        assert.equal(restored,git('show',cashierOwnerEntryProof.base+':'+file),'Only the exact Owner entry inverse may precede the historical scope check: '+file);
        if(cashierOwnerEntryProof.files[file])assert.throws(()=>restoreCashierOwnerEntry(source+'\n// unreviewed change',file));restoredEntry.set(file,restored);
    }
    const historical=changed.filter(file=>{if(cashierOwnerWorkspaceProof.newFiles[file]){assert.equal(sha(read(file)),cashierOwnerWorkspaceProof.newFiles[file]);return false;}return !restoredEntry.has(file)||restoredEntry.get(file)!==git('show',proof.base+':'+file);});
    assert.deepEqual(historical.sort(),Object.keys(proof.files).sort());
    for(const [file,pin]of Object.entries(proof.files)){
        const source=restoredEntry.get(file)??read(file);assert.equal(sha(source),pin.candidateSha256,file);
        assert.equal(restoreLargeDeliveryStatus(source,file),git('show',proof.base+':'+file));
    }
});
