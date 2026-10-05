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

function reviewFixture({branchAllowed=true,permissions=['transfers'],answer=true,onConfirm=()=>{}}={}) {
    const h=firestoreHarness();h.put('remittances/manual',original);h.put('remittances/auto',duplicate);
    h.put('cash_accounts/hq',{balance:50000});h.put('expenses/remit-manual',{amount:24000});
    const dialogs=[],notices=[],user={email:'owner-preview@example.test',uid:'preview-owner',cashierName:'Owner',permissions};
    const window={...h.api,sessionUser:user,auth:{currentUser:{email:user.email,uid:user.uid}},isBranchAllowed:()=>branchAllowed,ManagerUI:{notify:message=>notices.push(message)},getDocFromServer:async ref=>({exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.docs.get(ref.path))}),openBranchTransferHistory:()=>{},loadUnremittedCashDashboard:()=>{},loadCashFlowHub:()=>{}};
    const Swal={fire:async (...args)=>{dialogs.push(args);if(typeof args[0]==='object'){onConfirm(window);return {isConfirmed:answer};}return {isConfirmed:true};}};
    const source=readFileSync(new URL('../takodeal-manager/main.js',import.meta.url),'utf8'),start=source.indexOf('window.reviewDuplicateRemittance = async function('),end=source.indexOf('\n};',start)+3;
    vm.runInNewContext(source.slice(start,end),{window,Swal,canOpenWorkspacePage,rejectLegacyDuplicateAtomic,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,'_')});
    return {h,window,dialogs,notices};
}

test('actual review handler denies branch access and missing remittance permissions before any write',async()=>{
    for(const options of [{branchAllowed:false},{permissions:['dashboard']}]){
        const f=reviewFixture(options);await f.window.reviewDuplicateRemittance('auto','manual');
        assert.equal(f.h.get('remittances/auto').status,undefined);assert.equal(f.h.docs.size,4);
        assert.equal(f.dialogs.some(args=>typeof args[0]==='object'),false);
    }
});

test('actual review handler cancels cleanly and preserves both pending source records',async()=>{
    const f=reviewFixture({answer:false});await f.window.reviewDuplicateRemittance('auto','manual');
    assert.equal(f.h.get('remittances/auto').status,undefined);assert.equal(f.h.docs.size,4);
    assert.equal(f.h.get('cash_accounts/hq').balance,50000);assert.equal(f.h.get('expenses/remit-manual').amount,24000);
});

test('actual review handler rejects Google-account identity changes and revoked permissions after confirmation',async()=>{
    for(const change of [window=>{window.sessionUser={...window.sessionUser,email:'other@example.test',uid:'other-uid'};},window=>{window.sessionUser.permissions=[];}]){
        const f=reviewFixture({onConfirm:change});await f.window.reviewDuplicateRemittance('auto','manual');
        assert.equal(f.h.get('remittances/auto').status,undefined);assert.equal(f.h.docs.size,4);
        assert.equal(f.dialogs.at(-1)[0],'Could not review duplicate');
    }
});

test('actual confirmed review keeps the original pending while rejecting one automatic copy with the signed-in account in its audit',async()=>{
    const f=reviewFixture();await f.window.reviewDuplicateRemittance('auto','manual');
    assert.equal(f.h.get('remittances/auto').status,'Rejected');assert.equal(f.h.get('remittances/manual').status,'Pending');
    assert.equal(f.h.get('remittances/auto').rejectedBy,'owner-preview@example.test');
    assert.equal(f.h.get('cash_accounts/hq').balance,50000);assert.equal(f.h.get('expenses/remit-manual').amount,24000);
    assert.equal([...f.h.docs.keys()].filter(key=>key.startsWith('manager_alerts/')).length,1);
});

test('actual review handler reports malformed encoded IDs without throwing outside its error handler',async()=>{
    const f=reviewFixture();await f.window.reviewDuplicateRemittance('%broken','manual');
    assert.equal(f.h.docs.size,4);assert.equal(f.dialogs[0][0],'Could not review duplicate');
});
