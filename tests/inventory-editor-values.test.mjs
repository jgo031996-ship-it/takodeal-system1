import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryEditorValues} from '../takodeal-manager/inventory-editor.js';
import {buildInventoryItemEditPlan, canonicalDraft} from '../takodeal-manager/inventory-item-edit-model.js';

const item = extra => ({id: 'sample', branch: 'Main Office', name: 'Supply', category: 'Packaging',
    purchaseUom: 'Pack', baseUom: 'piece', conversionRate: 50, purchaseCost: 63.39153615461514,
    baseCost: 1.2678307230923028, currentStock: 2050, maintainingStock: 257.25,
    lowStockAlert: 50, restockCycle: 'Monthly', ...extra});

test('same-label package units initialize and edit through the same model conversion convention', () => {
    const original = item({purchaseUom: 'piece', baseUom: 'piece', maintainingStock: 250});
    const shown = inventoryEditorValues(original), model = canonicalDraft(original);
    assert.equal(shown.maintainingPurchaseQty, '5');
    assert.equal(shown.maintainingBaseQty, '0');
    assert.equal(Number(shown.maintainingPurchaseQty), model.maintainingPurchaseQty);
    const plan = buildInventoryItemEditPlan({original, draft: {maintainingPurchaseQty: '50'}, permittedBranches: ['Main Office']});
    assert.deepEqual(plan.updates[0].patch, {maintainingStock: 2500});
});

test('one-to-one fractional targets have no hidden loose quantity added on the next edit', () => {
    const original = item({conversionRate: 1, purchaseUom: 'Batch', baseUom: 'gram', maintainingStock: .5});
    const shown = inventoryEditorValues(original), model = canonicalDraft(original);
    assert.equal(shown.maintainingPurchaseQty, '0.5');
    assert.equal(shown.maintainingBaseQty, '0');
    assert.equal(Number(shown.maintainingPurchaseQty), model.maintainingPurchaseQty);
    const plan = buildInventoryItemEditPlan({original, draft: {maintainingPurchaseQty: '1'}, permittedBranches: ['Main Office']});
    assert.deepEqual(plan.updates[0].patch, {maintainingStock: 1});
});

test('editing the purchase component retains the actual loose quantity in the opened item', () => {
    const original = item(), shown = inventoryEditorValues(original);
    assert.equal(shown.maintainingPurchaseQty, '5');
    assert.equal(shown.maintainingBaseQty, '7.25');
    const plan = buildInventoryItemEditPlan({original, draft: {maintainingPurchaseQty: '6'}, permittedBranches: ['Main Office']});
    assert.deepEqual(plan.updates[0].patch, {maintainingStock: 307.25});
});

test('restock edits preserve saved full-precision cost even though the display is rounded', () => {
    const original = item(), shown = inventoryEditorValues(original);
    assert.equal(shown.purchaseCost, '63.3915');
    const plan = buildInventoryItemEditPlan({original, draft: {restockCycle: 'Weekly'}, permittedBranches: ['Main Office']});
    assert.deepEqual(plan.updates[0].patch, {restockCycle: 'Weekly'});
    assert.equal(original.purchaseCost, 63.39153615461514);
    assert.ok(!plan.updates[0].expected.fields.includes('purchaseCost'));
});

test('explicit zero cost and alert remain visible as zero rather than falling through to other aliases', () => {
    const shown = inventoryEditorValues(item({purchaseCost: 0, purchCost: 20, lowStockAlert: 0, reorderLevel: 10}));
    assert.equal(shown.purchaseCost, '0');
    assert.equal(shown.lowStockPurchaseQty, '0');
});

test('UI target components conserve fractional base quantities for sub-unit conversions', () => {
    const original = item({conversionRate: .5, purchaseUom: 'Small pack', baseUom: 'gram', maintainingStock: .6});
    const shown = inventoryEditorValues(original);
    assert.equal(shown.maintainingPurchaseQty, '1');
    assert.ok(Math.abs(Number(shown.maintainingBaseQty) - .1) < 1e-9);
    const plan = buildInventoryItemEditPlan({original, draft: {maintainingPurchaseQty: '2'}, permittedBranches: ['Main Office']});
    assert.ok(Math.abs(plan.updates[0].patch.maintainingStock - 1.1) < 1e-9);
});
