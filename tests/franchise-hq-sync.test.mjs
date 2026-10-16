import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { firestoreHarness } from './helpers/firestore-harness.mjs';
import { summarizeFranchiseLedger, conversationAudience, conversationVisible, fullHQScope } from '../takodeal-manager/franchise-hq-model.js';
import { createFranchiseConversations, createFranchiseLedgerEntry } from '../takodeal-manager/franchise-hq-actions.js';

const franchise = { uid: 'franchise-user', email: 'partner@example.test', cashierName: 'Sample Partner', branch: 'Agdao', allowedBranches: ['Agdao'], permissions: ['franchise-hub'], isFranchisee: true };
const owner = { uid: 'hq-user', email: 'hq@example.test', cashierName: 'Sample HQ', branch: 'All', allowedBranches: ['All'], permissions: ['all'], isOwner: true };
function setup(user = franchise, hq = false) {
    const h = firestoreHarness();
    h.api.sessionUser = structuredClone(user); h.api.auth = { currentUser: { uid: user.uid, email: user.email } };
    h.api.getDocFromServer = async ref => ({ id: ref.id, exists: () => h.docs.has(ref.path), data: () => structuredClone(h.get(ref.path)) });
    const assertAccess = s => s.permissions?.some(p => ['all', 'franchise-hub'].includes(p));
    const actions = createFranchiseConversations(h.api, { assertAccess, hq });
    return { ...h, actions, assertAccess };
}
const thread = (branch = 'Agdao') => ({ audience: 'branch', targetBranch: branch, branch, title: 'Sample request', message: 'Sample details', replies: [], timestamp: { seconds: 10 } });

test('Owner and Franchise share exactly the same ledger/conversation contracts', () => {
    for (const file of ['franchise-hq-model.js', 'franchise-hq-actions.js']) assert.equal(fs.readFileSync(new URL('../takodeal-manager/' + file, import.meta.url), 'utf8'), fs.readFileSync(new URL('../takodeal-franchise/' + file, import.meta.url), 'utf8'));
});
test('both ledgers calculate charges/payments in cents with stable chronological balances', () => {
    const result = summarizeFranchiseLedger([{ id: 'c', type: 'credit', amount: .3, timestamp: { seconds: 3 } }, { id: 'b', type: 'Debit', amount: .2, timestamp: { seconds: 2 } }, { id: 'a', type: 'Charge', amount: .1, timestamp: { seconds: 1 } }]);
    assert.equal(result.balance, 0); assert.equal(result.invalidCount, 0);
    assert.deepEqual(result.rows.map(r => r.balance), [.1, .3, 0]); assert.equal(result.charges, .3); assert.equal(result.payments, .3);
});
test('incomplete or unknown ledger entries cannot display a false zero or confirmed balance', () => {
    for (const row of [{ type: 'Other', amount: 100 }, { type: 'Charge', amount: '' }, { type: 'Payment', amount: -5 }, { type: 'Charge', amount: 'not a cost' }]) {
        const summary = summarizeFranchiseLedger([{ id: 'a', type: 'Charge', amount: 100, timestamp: 1 }, { id: 'b', ...row, timestamp: 2 }, { id: 'c', type: 'Payment', amount: 100, timestamp: 3 }]);
        assert.equal(summary.balance, null); assert.equal(summary.invalidCount, 1); assert.equal(summary.rows[1].balance, null); assert.equal(summary.rows[2].balance, null);
    }
});
test('conversation recipients are explicit; legacy threads are identified and unknown recipients hidden', () => {
    assert.deepEqual(conversationAudience(thread()), { kind: 'branch', branch: 'Agdao', legacy: false });
    assert.equal(conversationVisible(franchise, thread()), true);
    assert.equal(conversationVisible(franchise, thread('Maa')), false);
    assert.equal(conversationVisible(franchise, { branch: 'HQ Main Office' }), false);
    assert.equal(conversationVisible(franchise, { branch: 'HQ Main Office', type: 'Announcement' }), true);
    assert.equal(conversationAudience({ branch: 'HQ Main Office' }).legacy, true);
    assert.equal(conversationVisible(franchise, { audience: 'branch', branch: 'Agdao', targetBranch: 'Maa' }), false);
    assert.equal(conversationVisible(franchise, { message: 'No recipient' }), false);
    assert.equal(fullHQScope({ ...franchise, permissions: ['all'] }), false);
});
test('Franchise lists its branch and network conversations without other branch threads', async () => {
    const h = setup();
    h.put('franchise_comms/own', thread()); h.put('franchise_comms/other', thread('Maa'));
    h.put('franchise_comms/global', { audience: 'network', branch: 'All', targetBranch: '' });
    h.put('franchise_comms/legacy', { branch: 'HQ Main Office', type: 'Announcement' }); h.put('franchise_comms/malformed', { branch: 'HQ Main Office', audience: 'branch', targetBranch: 'Maa' });
    assert.deepEqual((await h.actions.list('Agdao')).map(r => r.id).sort(), ['global', 'legacy', 'own']);
    assert.equal((await h.actions.get('own', 'Agdao')).id, 'own');
    await assert.rejects(h.actions.get('other', 'Agdao'), /unavailable/);
    await assert.rejects(h.actions.list('Maa'), /assigned access/);
});
test('concurrent refreshes share physical reads without caching settled records', async () => {
    const h = setup(); let calls = 0; const original = h.api.getDocsFromServer;
    h.api.getDocsFromServer = async q => { calls++; await Promise.resolve(); return original(q); };
    await Promise.all([h.actions.list('Agdao'), h.actions.list('Agdao')]); assert.equal(calls, 4);
    h.put('franchise_comms/later', thread());
    assert.equal((await h.actions.list('Agdao')).length, 1); assert.equal(calls, 8);
});
test('a response for a previous account or branch cannot be used', async () => {
    const h = setup(); const original = h.api.getDocsFromServer;
    h.api.getDocsFromServer = async q => { await Promise.resolve(); h.api.sessionUser = { ...h.api.sessionUser, branch: 'Maa' }; return original(q); };
    await assert.rejects(h.actions.list('Agdao'), /account or branch changed/);
});
test('posting a branch conversation is idempotent after lost acknowledgment', async () => {
    const h = setup(), request = { id: 'thread-request-1', branch: 'Agdao', title: 'Supply question', message: 'Sample question', type: 'Help' };
    h.loseNextAck(); await assert.rejects(h.actions.create(request), /Connection lost/);
    await h.actions.create(request); assert.equal(h.docs.size, 1);
    const saved = h.get('franchise_comms/' + request.id);
    assert.equal(saved.branch, 'Agdao'); assert.equal(saved.targetBranch, 'Agdao'); assert.equal(saved.authorEmail, franchise.email); assert.equal(saved.authorBranch, 'Agdao');
    await assert.rejects(h.actions.create({ ...request, message: 'Changed content' }), /already used/);
});
test('Franchise cannot post to another branch, the network, or without a saved grant', async () => {
    const h = setup(), data = { id: 'thread-request-2', branch: 'Agdao', title: 'Question', message: 'Sample' };
    await assert.rejects(h.actions.create({ ...data, branch: 'Maa' }), /assigned access/);
    await assert.rejects(h.actions.create({ ...data, audience: 'network' }), /recipient/);
    h.api.sessionUser.permissions = ['dashboard'];
    await assert.rejects(h.actions.create(data), /approved HQ access/); assert.equal(h.docs.size, 0);
});
test('HQ can target a franchise or explicitly choose the network', async () => {
    const h = setup(owner, true);
    await h.actions.create({ id: 'hq-network-thread', audience: 'network', type: 'Announcement', title: 'Sample memo', message: 'Network sample' });
    await h.actions.create({ id: 'hq-agdao-thread', branch: 'Agdao', title: 'Sample question', message: 'Branch sample' });
    assert.equal(h.get('franchise_comms/hq-network-thread').branch, 'All');
    assert.equal(h.get('franchise_comms/hq-agdao-thread').authorBranch, 'HQ Main Office');
    assert.equal((await h.actions.list()).length, 2);
});
test('atomic concurrent replies preserve both messages and retry creates no duplicate', async () => {
    const h = setup(); h.put('franchise_comms/old', thread());
    const a = { id: 'old', branch: 'Agdao', message: 'First sample reply', replyId: 'sample-reply-one' }, b = { ...a, message: 'Second sample reply', replyId: 'sample-reply-two' };
    await Promise.all([h.actions.reply(a), h.actions.reply(b)]);
    assert.equal(h.get('franchise_comms/old').replies.length, 2); assert.ok(h.retries() > 0);
    await h.actions.reply(a); assert.equal(h.get('franchise_comms/old').replies.length, 2);
    await assert.rejects(h.actions.reply({ ...a, message: 'Reused differently' }), /already used/);
});
test('legacy/other-branch thread replies are blocked without altering the old record', async () => {
    const h = setup(); h.put('franchise_comms/legacy', { branch: 'HQ Main Office', replies: [] }); h.put('franchise_comms/other', thread('Maa'));
    for (const id of ['legacy', 'other']) await assert.rejects(h.actions.reply({ id, branch: 'Agdao', message: 'Sample', replyId: 'sample-reply-id' }));
    assert.equal(h.get('franchise_comms/legacy').replies.length, 0); assert.equal(h.get('franchise_comms/other').replies.length, 0);
});
test('confirmed HQ ledger payments use one idempotent write and preserve account scope', async () => {
    const h = setup(owner, true), data = { id: 'ledger-payment-1', branch: 'Agdao', type: 'Payment', amount: 125.5, description: 'Sample bank reference', assertAccess: h.assertAccess };
    h.loseNextAck(); await assert.rejects(createFranchiseLedgerEntry(h.api, data), /Connection lost/);
    await createFranchiseLedgerEntry(h.api, data); assert.equal(h.docs.size, 1); assert.equal(h.get('franchise_ledger/ledger-payment-1').amount, 125.5);
    await assert.rejects(createFranchiseLedgerEntry(h.api, { ...data, amount: 50 }), /already used/);
    const partner = setup(); await assert.rejects(createFranchiseLedgerEntry(partner.api, { ...data, assertAccess: partner.assertAccess }), /Only HQ/);
});

