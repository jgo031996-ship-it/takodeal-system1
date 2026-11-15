import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {largeDeliveryProof as proof,largeDeliverySha as sha,restoreLargeDeliveryStatus} from './helpers/large-delivery-status-inverse.mjs';
import {cashierOwnerEntryProof,restoreCashierOwnerEntry} from './helpers/cashier-owner-entry-inverse.mjs';
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
test('large shipment fix retains every other live product and backend byte',()=>{
    const scopes=['takodeal-manager','Takodeal-POS','takodeal-franchise','takodeal-staff','takodeal-delivery','Customer','functions','firestore.rules','firestore.policy.rules','storage.rules'];
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:6e6});
    const changed=git('diff','--name-only',proof.base,'--',...scopes).trim().split(/\r?\n/).filter(Boolean);
    assert.equal(cashierOwnerEntryProof.base,'dfa305e3ed9267eb41c1ade0ab2c613b10b2821e');assert.equal(Object.keys(cashierOwnerEntryProof.files).length,4);assert.equal(Object.values(cashierOwnerEntryProof.files).reduce((n,row)=>n+row.edits.length,0),4);
    const restoredEntry=new Map();
    for(const file of Object.keys(cashierOwnerEntryProof.files)){
        const source=read(file),restored=restoreCashierOwnerEntry(source,file);
        assert.equal(restored,git('show',cashierOwnerEntryProof.base+':'+file),'Only the exact Owner entry inverse may precede the historical scope check: '+file);
        assert.throws(()=>restoreCashierOwnerEntry(source+'\n// unreviewed change',file));restoredEntry.set(file,restored);
    }
    const historical=changed.filter(file=>!restoredEntry.has(file)||restoredEntry.get(file)!==git('show',proof.base+':'+file));
    assert.deepEqual(historical.sort(),Object.keys(proof.files).sort());
    for(const [file,pin]of Object.entries(proof.files)){
        const source=restoredEntry.get(file)??read(file);assert.equal(sha(source),pin.candidateSha256,file);
        assert.equal(restoreLargeDeliveryStatus(source,file),git('show',proof.base+':'+file));
    }
});
