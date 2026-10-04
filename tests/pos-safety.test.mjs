import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSaleEngine, collectDeductions, saleIdentity, SALE_VERSION } from '../Takodeal-POS/pos-safety.js';

import { firestoreHarness } from './helpers/firestore-harness.mjs';
const bom = [
    { menuItem: '6 Pcs Takoyaki', ingredientName: 'Batter', qty: 6 },
    { menuItem: '6 Pcs Takoyaki', ingredientName: 'Box', qty: 1 }
];
function setup() {
    const harness = firestoreHarness();
    for (const branch of ['Cabantian', 'Maa']) for (const name of ['Batter', 'Box', 'Cheese']) {
        harness.put(`inventory/${branch}-${name}`, { name, branch, currentStock: 100, uom: 'units' });
    }
    const engine = createSaleEngine(harness.api);
    const payload = { saleVersion: SALE_VERSION, saleId: 'sale-test', receiptId: 'TEST-0001', branch: 'Cabantian',
        cashier: 'Cashier', netTotal: 50, localTimestamp: '2026-10-03T01:00:00Z', orderType: 'Dine-In',
        auditDeferred: false, cart: [{ name: '6 Pcs Takoyaki', qty: 2,
            addons: { cheese: { qty: 1, linkedIngredient: 'Cheese', deductQty: 3 } } }] };
    return { h: harness, engine, payload };
}
const tableCount = (h, table) => [...h.docs.keys()].filter(k => k.startsWith(table + '/')).length;

test('20 sale retries write one transaction and deduct each ingredient once', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare(payload, bom);
    for (let n = 0; n < 20; n++) await engine.commit(prepared);
    assert.equal(tableCount(h, 'transactions'), 1);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
    assert.equal(h.get('inventory/Cabantian-Box').currentStock, 99);
    assert.equal(h.get('inventory/Cabantian-Cheese').currentStock, 94);
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls, 12);
});
test('concurrent clients committing the same sale retry and do not double deduct', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare(payload, bom);
    await Promise.all([engine.commit(prepared), createSaleEngine(h.api).commit(prepared)]);
    assert.ok(h.retries() > 0);
    assert.equal(tableCount(h, 'transactions'), 1);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
});
test('commit failure leaves neither a sale nor any partial stock changes', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare(payload, bom);
    h.failNextCommit();
    await assert.rejects(engine.commit(prepared));
    assert.equal(tableCount(h, 'transactions'), 0);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    assert.equal(h.get('inventory/Cabantian-Cheese').currentStock, 100);
    await engine.commit(prepared);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
});
test('lost commit acknowledgement retries the permanent ID safely', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare(payload, bom);
    h.loseNextAck(); await assert.rejects(engine.commit(prepared));
    assert.equal(await engine.alreadyCommitted(payload), true);
    await engine.commit(prepared);
    assert.equal(tableCount(h, 'transactions'), 1);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
});
test('permanent commit marker prevents replay after receipt history is archived', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare(payload, bom);
    await engine.commit(prepared);
    h.docs.delete('transactions/sale-test');
    assert.equal(await engine.alreadyCommitted(payload), true);
    await engine.commit(prepared);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
    assert.equal(tableCount(h, 'transactions'), 0);
});
test('Firestore map key reordering does not change sale identity', async () => {
    const { engine, payload } = setup();
    await engine.commit(await engine.prepare(payload, bom));
    const reordered = { ...payload, cart: payload.cart.map(item => Object.fromEntries(Object.entries(item).reverse())) };
    assert.equal(await engine.alreadyCommitted(reordered), true);
    await assert.rejects(engine.alreadyCommitted({ ...payload, netTotal: 99 }), /identity conflict/);
});
test('inventory resolution is branch scoped and flags missing or duplicate items without guessing', async () => {
    const { h, engine, payload } = setup();
    await engine.commit(await engine.prepare({ ...payload, branch: 'Maa' }, bom));
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    assert.equal(h.get('inventory/Maa-Batter').currentStock, 88);
    h.put('inventory/duplicate', { name: 'Box', branch: 'Cabantian', currentStock: 100 });
    const duplicate = await engine.prepare(payload, bom);
    assert.equal(duplicate.inventoryIssues[0].ingredientName, 'Box');
    assert.equal(duplicate.inventoryIssues[0].reason, 'duplicate');
    assert.ok(!duplicate.inventoryMovements.some(row => row.ingredientName === 'Box'));
    h.docs.delete('inventory/Cabantian-Cheese');
    const missing = await engine.prepare(payload, bom);
    assert.equal(missing.inventoryIssues.find(row => row.ingredientName === 'Cheese').quantity, 6);
    assert.ok(!missing.inventoryMovements.some(row => row.ingredientName === 'Cheese'));
});
test('mixed order types, fractional packaging and addons retain exact quantities', () => {
    const cart = [{ name: '6 Pcs Takoyaki', qty: 1, orderType: 'Dine-In' },
        { name: '6 Pcs Takoyaki', qty: 2, orderType: 'Take-Out' }];
    const deductions = collectDeductions({ cart }, bom);
    assert.equal(deductions.find(d => d.ingredientName === 'Box').quantity, 2.5);
    assert.throws(() => collectDeductions({ cart: [{ name: 'X', qty: -1 }] }, bom));
});
test('Audit Mode sale retries defer one movement record without deducting stock', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare({ ...payload, auditDeferred: true }, bom);
    await engine.commit(prepared); await engine.commit(prepared);
    assert.equal(h.get('transactions/sale-test').inventoryState, 'deferred');
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    await engine.resumeAudit('Cabantian'); await engine.resumeAudit('Cabantian');
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
});
test('branch audit marker defers another device and blocks resume while counting', async () => {
    const { h, engine, payload } = setup();
    await engine.setAuditMode('Cabantian', true, 'Cashier');
    await engine.commit(await engine.prepare(payload, bom));
    await engine.resumeAudit('Cabantian');
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    await engine.setAuditMode('Cabantian', false, 'Cashier');
    await engine.resumeAvailableAudits();
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
});
test('failed audit resume and lost acknowledgement cannot partially replay a sale', async () => {
    const { h, engine, payload } = setup();
    await engine.commit(await engine.prepare({ ...payload, auditDeferred: true }, bom));
    h.failNextCommit(); await assert.rejects(engine.resumeAudit('Cabantian'));
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    assert.equal(h.get('transactions/sale-test').inventoryState, 'deferred');
    h.loseNextAck(); await assert.rejects(engine.resumeAudit('Cabantian'));
    await Promise.all([engine.resumeAudit('Cabantian'), engine.resumeAudit('Cabantian')]);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
    assert.equal(h.get('inventory/Cabantian-Cheese').currentStock, 94);
});
test('two voids return exact recorded deductions once and reverse both counters', async () => {
    const { h, engine, payload } = setup();
    await engine.commit(await engine.prepare(payload, bom));
    const results = await Promise.all([engine.voidSale(payload.receiptId, 'C1', payload.branch), engine.voidSale(payload.receiptId, 'C2', payload.branch)]);
    assert.deepEqual(results.sort(), [false, true]);
    for (const name of ['Batter', 'Box', 'Cheese']) assert.equal(h.get(`inventory/Cabantian-${name}`).currentStock, 100);
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls, 0);
    assert.equal(h.get('settings/global_stats').balls_Cabantian, 0);
    assert.equal(tableCount(h, 'stock_logs'), 3);
    assert.equal(tableCount(h, 'manager_alerts'), 1);
});
test('void failures roll back status, stock, logs and statistics together', async () => {
    const { h, engine, payload } = setup();
    await engine.commit(await engine.prepare(payload, bom));
    h.failNextCommit(); await assert.rejects(engine.voidSale(payload.receiptId, 'C1', payload.branch));
    assert.notEqual(h.get('transactions/sale-test').status, 'Voided');
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 88);
    assert.equal(tableCount(h, 'stock_logs'), 0);
    h.loseNextAck(); await assert.rejects(engine.voidSale(payload.receiptId, 'C1', payload.branch));
    assert.equal(await engine.voidSale(payload.receiptId, 'C1', payload.branch), false);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
});
test('void before audit resume cancels unperformed deductions and adds no stock', async () => {
    const { h, engine, payload } = setup();
    await engine.commit(await engine.prepare({ ...payload, auditDeferred: true }, bom));
    await engine.voidSale(payload.receiptId, 'C1', payload.branch);
    await engine.resumeAudit(payload.branch);
    assert.equal(h.get('transactions/sale-test').inventoryState, 'cancelled');
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    assert.equal(tableCount(h, 'stock_logs'), 0);
});
test('concurrent audit resume and void settle with original stock', async () => {
    const { h, engine, payload } = setup();
    await engine.commit(await engine.prepare({ ...payload, auditDeferred: true }, bom));
    await Promise.all([engine.resumeAudit(payload.branch), engine.voidSale(payload.receiptId, 'C1', payload.branch)]);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    assert.equal(h.get('settings/global_stats').totalTakoyakiBalls, 0);
});
test('deleting a parked order twice creates one void record and no inventory movement', async () => {
    const { h, engine, payload } = setup();
    h.put('parked_orders/parked1', { branch: payload.branch, total: 50, items: payload.cart });
    await Promise.all([engine.discardParked('parked1', 'C1', payload.branch, 'shift'), engine.discardParked('parked1', 'C1', payload.branch, 'shift')]);
    assert.equal(tableCount(h, 'transactions'), 1);
    assert.equal(tableCount(h, 'manager_alerts'), 1);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
    assert.equal(tableCount(h, 'parked_orders'), 0);
});
test('parked deletion failure keeps the order and creates no orphan logs', async () => {
    const { h, engine, payload } = setup();
    h.put('parked_orders/parked1', { branch: payload.branch, total: 50 });
    h.failNextCommit(); await assert.rejects(engine.discardParked('parked1', 'C1', payload.branch, 'shift'));
    assert.equal(tableCount(h, 'parked_orders'), 1);
    assert.equal(tableCount(h, 'transactions'), 0);
});
test('delivery, discount and meal records share the sale commit and stable IDs', async () => {
    const { h, engine, payload } = setup();
    const prepared = await engine.prepare({ ...payload, orderType: 'Delivery', globalDiscountType: 'staff_meal', mealStaffName: 'Staff' }, bom);
    await engine.commit(prepared); await engine.commit(prepared);
    assert.equal(tableCount(h, 'incoming_orders'), 1);
    assert.equal(tableCount(h, 'manager_alerts'), 1);
    assert.equal(tableCount(h, 'staff_requests'), 1);
});
test('mobile order identity is stable across devices and paid sources are rejected', async () => {
    const { h, engine, payload } = setup();
    const mobile = { ...payload, mobileOrderCode: 'MOB/123', mobileOrderId: 'incoming1' };
    mobile.saleId = saleIdentity(mobile);
    assert.equal(mobile.saleId, saleIdentity(mobile));
    h.put('incoming_orders/incoming1', { branch: mobile.branch, paymentStatus: 'paid' });
    await assert.rejects(engine.commit(await engine.prepare(mobile, bom)), /already paid/);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
});
test('ambiguous legacy sales and receipts fail closed without touching stock', async () => {
    const { h, engine, payload } = setup();
    await assert.rejects(engine.prepare({ ...payload, saleVersion: undefined }, bom), /reconciliation/);
    h.put('transactions/legacy', { receiptId: payload.receiptId, branch: payload.branch, cart: payload.cart });
    await assert.rejects(engine.voidSale(payload.receiptId, 'C1', payload.branch), /older receipt/);
    assert.equal(h.get('inventory/Cabantian-Batter').currentStock, 100);
});
test('no conflicting top-level functions remain and signature aliases target the universal implementation', () => {
    const source = readFileSync(new URL('../Takodeal-POS/main.js', import.meta.url), 'utf8');
    const names = [...source.matchAll(/^window\.(\w+)\s*=\s*(?:async\s+)?function\b/gm)].map(m => m[1]);
    assert.equal(new Set(names).size, names.length);
    assert.ok(source.includes('window.initBulletinSignaturePad = window.initSignaturePad;'));
    assert.ok(source.includes('window.clearBulletinSignature = window.clearSignature;'));
    const waste = source.slice(source.indexOf('window.submitWasteCart ='), source.indexOf('window.loadWasteHistory ='));
    assert.ok(waste.includes('staff_requests'));
    assert.ok(!waste.includes('currentStock:'));
    assert.ok(source.includes('window.showStandardAnnouncement(encodedData);'));
});
test('all inline cashier scripts still parse and checkout side effects left the UI', () => {
    const html = readFileSync(new URL('../Takodeal-POS/index.html', import.meta.url), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!match[1].includes('type="module"')) new vm.Script(match[2]);
    }
    const checkout = html.slice(html.indexOf('window.submitFinalOrder ='), html.indexOf('// ==========================================', html.indexOf('window.submitFinalOrder =')));
    assert.ok(!checkout.includes('global_stats'));
    assert.ok(!checkout.includes('window.addDoc'));
    assert.ok(checkout.includes("checkout.status === 'queued'"));
    assert.ok(checkout.includes('Your cart is unchanged'));
});
test('independent Manager deployment uses the identical sale safety module', () => {
    const pos = readFileSync(new URL('../Takodeal-POS/pos-safety.js', import.meta.url), 'utf8');
    const manager = readFileSync(new URL('../takodeal-manager/pos-safety.js', import.meta.url), 'utf8');
    assert.equal(manager, pos);
    const source = readFileSync(new URL('../takodeal-manager/main.js', import.meta.url), 'utf8');
    assert.ok(source.includes('await engine.voidSale('));
    assert.ok(source.includes("sale.inventoryState === 'audit_pending' || sale.inventoryState === 'deferred'"));
});
