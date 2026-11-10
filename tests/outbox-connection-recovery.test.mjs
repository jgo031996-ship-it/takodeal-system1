import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createOutbox } from '../Takodeal-POS/pos-safety.js';
import { restoreCashierUnitSnapshots } from './helpers/cashier-unit-snapshot-inverse.mjs';
import { outboxIndexedDB } from './helpers/outbox-indexeddb.mjs';
const sale = (id = 'same-receipt-id') => ({ saleVersion: 2, saleId: id, receiptId: 'SAVED-1', branch: 'Fictional branch', cashier: 'Fictional Cashier', cart: [{ name: 'Synthetic food', qty: 2 }], netTotal: 50, inventoryMovements: [{ inventoryId: 'ingredient', quantity: 4 }] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 2000; while (!predicate()) { if (Date.now() > end) throw Error('Synthetic transaction barrier did not arrive.'); await new Promise(resolve => setImmediate(resolve)); } }
test('closed cached handle reopens once before a transaction; exact queued receipt/recipe/claim/error fields survive', async () => {
    const f = outboxIndexedDB(), outbox = createOutbox(f), payload = sale(); await outbox.enqueue(payload); await outbox.claim(payload.saleId, 'owner'); await outbox.noteError(payload.saleId, 'owner', Error('SAVED-ERROR')); const saved = structuredClone(f.records.get(payload.saleId));
    f.connections[0].close(); assert.deepEqual(await outbox.list(), [saved]); assert.equal(f.opens.length, 2); assert.equal(f.deletes, 0);
    assert.deepEqual(await outbox.enqueue(payload), payload); assert.equal(f.records.size, 1);
});
test('onclose/versionchange retire only their own generation; a stale close event cannot invalidate the new handle', async () => {
    const f = outboxIndexedDB(), outbox = createOutbox(f); await outbox.enqueue(sale()); const old = f.connections[0]; old.onversionchange(); await outbox.list(); const next = f.connections[1]; old.onclose(); await outbox.list(); assert.equal(f.opens.length, 2); assert.equal(next.closed, false);
    next.onclose(); assert.equal((await outbox.list()).length, 1); assert.equal(f.opens.length, 3);
});
test('confirmed connection abort retries the same operation once; a second connection failure holds and never deletes data', async () => {
    const f = outboxIndexedDB(), outbox = createOutbox(f); f.abortErrors.push(Object.assign(Error('Connection aborted'), { name: 'AbortError' })); assert.deepEqual(await outbox.enqueue(sale()), sale()); assert.equal(f.transactions.length, 2); assert.equal(f.records.size, 1); assert.equal(f.opens.length, 2);
    f.preTxErrors.push(...[1, 2].map(() => Object.assign(Error('Closing'), { name: 'InvalidStateError' })));
    await assert.rejects(outbox.list(), /closed/); assert.equal(f.records.size, 1); assert.equal(f.deletes, 0);
    assert.equal((await outbox.list()).length, 1);
});
test('business identity conflicts, schema failures, constraint failures and quota aborts never auto-retry', async () => {
    const f = outboxIndexedDB(), outbox = createOutbox(f); await outbox.enqueue(sale()); const count = f.transactions.length;
    await assert.rejects(outbox.enqueue({ ...sale(), netTotal: 1 }), /identity conflict/); assert.equal(f.transactions.length, count + 1);
    for (const name of ['NotFoundError', 'ConstraintError', 'QuotaExceededError']) {
        const before = f.transactions.length; f.abortErrors.push(Object.assign(Error(name), { name })); await assert.rejects(outbox.list(), new RegExp(name)); assert.equal(f.transactions.length, before + 1); assert.equal(f.records.size, 1);
    }
});
test('bounded open/blocked failures preserve existing rows; late open closes only its own connection and permits a fresh try', async () => {
    const f = outboxIndexedDB(); f.records.set(sale().saleId, { saleId: sale().saleId, payload: sale(), owner: null, leaseUntil: 0 }); f.lateOpen = true; const outbox = createOutbox(f, { openTimeoutMs: 10 });
    await assert.rejects(outbox.list(), /did not open/); f.lateOpen = false; assert.equal((await outbox.list()).length, 1); f.opens[0].onsuccess(); assert.equal(f.connections[0].closed, true); assert.equal(f.connections[1].closed, false);
    const blocked = outboxIndexedDB(); blocked.blocked = true; await assert.rejects(createOutbox(blocked).list(), /another tab/); assert.equal(blocked.deletes, 0);
});
test('transaction deadline requests abort and waits for a confirmed failure without retrying or pretending success', async () => {
    const f = outboxIndexedDB(), outbox = createOutbox(f, { transactionTimeoutMs: 15 }); f.holdNext = 'active'; const pending = outbox.enqueue(sale());
    await assert.rejects(pending); assert.equal(f.records.size, 0); assert.equal(f.transactions.length, 1);
    assert.deepEqual(await outbox.enqueue(sale()), sale()); assert.equal(f.records.size, 1);
});
test('uncertain commit acknowledgment keeps the exact physical operation pending after deadline and accepts one late commit', async () => {
    const f = outboxIndexedDB(), outbox = createOutbox(f, { transactionTimeoutMs: 15 }); f.holdNext = 'committing'; let settled = false;
    const pending = outbox.enqueue(sale()).then(value => { settled = true; return value; }); await until(() => f.transactions[0]?.ready); await pause(25);
    assert.equal(settled, false); assert.equal(f.records.size, 1); assert.equal(f.transactions.length, 1); assert.equal(f.opens.length, 1);
    f.transactions[0].complete(); assert.deepEqual(await pending, sale()); assert.equal(settled, true); assert.equal(f.records.size, 1);
});
test('only createOutbox changed and the shared receipt engine remains byte-identical', () => {
    const base = execFileSync('git', ['show', '3ebd23df0651a3b89aca9769c1375122a71a167a:Takodeal-POS/pos-safety.js'], { encoding: 'utf8' }), current = readFileSync(new URL('../Takodeal-POS/pos-safety.js', import.meta.url), 'utf8');
    const reviewedCurrent=restoreCashierUnitSnapshots(current);
    const before = source => source.slice(0, source.indexOf('export function createOutbox(')), after = source => source.slice(source.indexOf('\nexport function createSaleEngine('));
    assert.equal(before(reviewedCurrent), before(base)); assert.equal(after(reviewedCurrent), after(base)); assert.equal(current, readFileSync(new URL('../takodeal-manager/pos-safety.js', import.meta.url), 'utf8'));
    assert.doesNotMatch(current.slice(current.indexOf('export function createOutbox('), current.indexOf('\nexport function createSaleEngine(')), /deleteDatabase|\.clear\(|location\.reload|localStorage|sessionStorage/);
});
