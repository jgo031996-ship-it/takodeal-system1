import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyRemittanceDuplicates, rejectLegacyDuplicateAtomic} from '../takodeal-manager/remittance-review.js';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {canOpenWorkspacePage} from '../takodeal-manager/workspace-access-model.js';
const original = {id:'manual', branch:'Maa', cashier:'John Lester Garcia', channel:'Cash', amount:24000,
    salesPeriodStart:'2026-09-29', salesPeriodEnd:'2026-10-05', status:'Pending', timestamp:new Date('2026-10-05T10:03:00Z')};
const duplicate = {id:'auto', branch:'Maa', cashierName:'Auto-Logged (Shift Start)', amount:24000,
    type:'Cash Collection', channel:'Owner Collection', timestamp:new Date('2026-10-05T10:06:00Z')};
test('legacy shift-opening collection near one manual remittance is a review candidate', () => {
    assert.equal(legacyRemittanceDuplicates([duplicate,original]).get('auto').id,'manual');
});
test('different amounts, branches, distant collections, multiple candidates and new transfers are not guessed as duplicates', () => {
    for(const changed of [{amount:24001},{branch:'Cabantian'},{timestamp:new Date('2026-10-05T11:03:00Z')},{expenseId:'expense'},{remittanceVersion:3},{status:'Received'}])
        assert.equal(legacyRemittanceDuplicates([{...duplicate,...changed},original]).size,0);
    assert.equal(legacyRemittanceDuplicates([duplicate,original,{...original,id:'second'}]).size,0);
});
test('confirmed legacy rejection preserves original, cash balances and expenses, with one audit record on retry', async () => {
    const h=firestoreHarness();h.put('remittances/manual',original);h.put('remittances/auto',duplicate);
    h.put('cash_accounts/hq',{balance:50000});h.put('expenses/remit-manual',{amount:24000});
    h.loseNextAck();await assert.rejects(rejectLegacyDuplicateAtomic(h.api,'auto','manual','Owner'),/Connection lost/);
    assert.equal(await rejectLegacyDuplicateAtomic(h.api,'auto','manual','Owner'),'already-reviewed');
    assert.equal(h.get('remittances/auto').status,'Rejected');assert.equal(h.get('remittances/auto').duplicateOf,'manual');
    assert.deepEqual(h.get('remittances/manual'),original);assert.equal(h.get('cash_accounts/hq').balance,50000);
    assert.equal(h.get('expenses/remit-manual').amount,24000);assert.equal([...h.docs.keys()].filter(key=>key.startsWith('manager_alerts/')).length,1);
});
test('received or changed duplicate cannot be rejected through this recovery action', async () => {
    const h=firestoreHarness();h.put('remittances/manual',original);h.put('remittances/auto',{...duplicate,status:'Received'});
    await assert.rejects(rejectLegacyDuplicateAtomic(h.api,'auto','manual','Owner'),/no longer match/);
    assert.equal(h.get('remittances/auto').status,'Received');assert.equal(h.docs.size,2);
});

test('transaction checks the reviewer authorization before updating status or creating an audit record',async()=>{
    const h=firestoreHarness();h.put('remittances/manual',original);h.put('remittances/auto',duplicate);
    await assert.rejects(rejectLegacyDuplicateAtomic(h.api,'auto','manual','Owner',branch=>{assert.equal(branch,'Maa');throw Error('Permission revoked');}),/Permission revoked/);
    assert.equal(h.get('remittances/auto').status,undefined);assert.equal(h.docs.size,2);
});

test('stored document id fields cannot replace the real transfer paths during duplicate rejection',async()=>{
    const h=firestoreHarness();h.put('remittances/manual',{...original,id:'malicious-auto'});h.put('remittances/auto',{...duplicate,id:'manual'});
    await rejectLegacyDuplicateAtomic(h.api,'auto','manual','Owner');
    assert.equal(h.get('remittances/auto').duplicateOf,'manual');assert.equal(h.get('remittances/manual').status,'Pending');
});

function dispatchFixture(available=true){
 const calls=[],w={cashRemittanceReviewUI:available?{open:async(...args)=>{calls.push(args);return true;}}:null};
 const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.reviewDuplicateRemittance = async function('),end=source.indexOf('\n};',start)+3;
 vm.runInNewContext(source.slice(start,end),{window:w});return{w,calls};
}
test('legacy duplicate action opens the protected review and never directly changes money or records',async()=>{
 const f=dispatchFixture();await f.w.reviewDuplicateRemittance('sample-duplicate','sample-original');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'sample-duplicate');assert.equal(f.calls[0][1].focus,'reject');assert.equal(f.calls[0][1].possibleOriginalId,'sample-original');
});
test('duplicate action fails closed if protected review is unavailable or the supplied record ID is malformed',async()=>{
 const missing=dispatchFixture(false);await assert.rejects(missing.w.reviewDuplicateRemittance('sample','original'),/Update the Owner app/);assert.equal(missing.calls.length,0);const bad=dispatchFixture();await assert.rejects(bad.w.reviewDuplicateRemittance('%broken','original'),/URI malformed/);assert.equal(bad.calls.length,0);
});
