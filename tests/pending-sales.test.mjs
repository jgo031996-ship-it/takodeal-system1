import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePendingSales } from '../Takodeal-POS/pos-checkout.js';

const start = new Date('2026-10-03T05:00:00Z');
const pending = { saleId: 'sale-1', receiptId: 'R1', branch: 'Main Office', shiftId: 'shift-1',
    netTotal: 125, localTimestamp: '2026-10-03T05:48:00Z', cart: [{ name: '6 Pcs', qty: 1 }],
    syncError: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } };
test('new durable-outbox sale appears in its branch shift with its upload error', () => {
    const rows = mergePendingSales([], [pending], 'Main Office', start, 'shift-1');
    assert.equal(rows.length, 1); assert.equal(rows[0].receiptId, 'R1');
    assert.equal(rows[0].isPendingSync, true); assert.equal(rows[0].status, 'Pending Sync');
    assert.equal(rows[0].syncError.code, 'permission-denied');
});
test('a server receipt and a lost acknowledgement display one server row', () => {
    const paid = { ...pending, id: 'sale-1', status: 'Paid' };
    const rows = mergePendingSales([paid], [pending], 'Main Office', start, 'shift-1');
    assert.deepEqual(rows, [paid]); assert.equal(rows[0].isPendingSync, undefined);
});
test('pending rows cannot cross branch, shift or start-time boundaries', () => {
    assert.equal(mergePendingSales([], [pending], 'Cabantian', start, 'shift-1').length, 0);
    assert.equal(mergePendingSales([], [pending], 'Main Office', start, 'shift-2').length, 0);
    assert.equal(mergePendingSales([], [pending], 'Main Office', new Date('2026-10-04'), 'shift-1').length, 0);
});
test('preserved legacy rows stay marked for reconciliation and deduplicate by receipt', () => {
    const legacy = { ...pending, saleId: undefined, shiftId: 'UNKNOWN', needsReconciliation: true };
    const rows = mergePendingSales([], [legacy, legacy], 'Main Office', start, 'shift-1');
    assert.equal(rows.length, 1); assert.equal(rows[0].needsReconciliation, true);
    assert.equal(mergePendingSales([{ receiptId: 'R1', branch: 'Main Office' }], [legacy], 'Main Office', start).length, 1);
});
