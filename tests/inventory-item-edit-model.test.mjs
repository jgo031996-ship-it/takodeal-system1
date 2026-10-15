import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInventoryItemEditPlan, inventoryItemEditDraft, inventoryItemIdentity, assertInventoryEditUnchanged, canonicalDraft} from '../takodeal-manager/inventory-item-edit-model.js';

const row = (id, branch, extra = {}) => ({id, branch, name: '4Pcs Paper Bowl', category: 'Packaging', purchaseUom: 'Pack', baseUom: 'piece',
    conversionRate: 50, purchaseCost: 100, baseCost: 2, currentStock: 200, maintainingStock: 250, lowStockAlert: 50,
    restockCycle: 'Monthly', showInPrep: false, allowRequest: true, ...extra});
function fixture() {
    const original = row('maa', 'Maa');
    const items = [row('office', 'Main Office', {maintainingStock: 2000, purchaseCost: 125, baseCost: 2.5}), original,
        row('cab', 'Cabantian', {maintainingStock: 100, purchaseCost: 90, baseCost: 1.8}),
        row('agdao', 'Agdao', {maintainingStock: 0, currentStock: 0}), row('foreign', 'Other franchise', {maintainingStock: 750})];
    return {original, items, permittedBranches: ['Main Office', 'Maa', 'Cabantian', 'Agdao']};
}
const patchFor = (plan, id) => plan.updates.find(update => update.id === id)?.patch;

test('opening and saving unchanged full canonical fields creates no writes or alias normalization', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, draft: inventoryItemEditDraft(f.original)});
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.changedFields, []);
});

test('Main Office target, zero alert and restock-cycle edits stay exclusively in Main Office', () => {
    const f = fixture(); f.original = f.items[0];
    const plan = buildInventoryItemEditPlan({...f, draft: {maintainingPurchaseQty: '30', maintainingBaseQty: '5', lowStockPurchaseQty: '0', restockCycle: 'Weekly'}});
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(patchFor(plan, 'office'), {lowStockAlert: 0, reorderLevel: 0, maintainingStock: 1505, restockCycle: 'Weekly'});
    assert.deepEqual(plan.copiedBranches, []);
    assert.equal(plan.scope, 'main-office-only');
});

test('non-HQ target save copies only changed settings to exact item identities in permitted branches including franchise', () => {
    const f = fixture(), before = structuredClone(f.items);
    const plan = buildInventoryItemEditPlan({...f, draft: {...inventoryItemEditDraft(f.original), maintainingPurchaseQty: '8', maintainingBaseQty: '3'}});
    assert.deepEqual(plan.copiedBranches, ['Agdao', 'Cabantian']);
    for (const id of ['maa', 'cab', 'agdao']) assert.deepEqual(patchFor(plan, id), {maintainingStock: 403});
    assert.equal(patchFor(plan, 'office'), undefined);
    assert.equal(patchFor(plan, 'foreign'), undefined);
    assert.deepEqual(f.items, before);
});

test('a cycle-only save does not copy the selected branch target, alert, cost or physical quantity', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, draft: {restockCycle: 'weekly'}});
    for (const update of plan.updates) assert.deepEqual(update.patch, {restockCycle: 'Weekly'});
});

test('explicit zero alert is retained and never replaced by a default low-stock threshold', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, draft: {lowStockPurchaseQty: 0}});
    for (const update of plan.updates) assert.deepEqual(update.patch, {lowStockAlert: 0, reorderLevel: 0});
    assert.equal(inventoryItemEditDraft(row('zero', 'Maa', {lowStockAlert: 0, reorderLevel: 200})).lowStockPurchaseQty, 0);
});

test('partial target boxes preserve the omitted component and blank explicitly means zero', () => {
    const f = fixture(); f.original = row('maa', 'Maa', {maintainingStock: 258});
    let plan = buildInventoryItemEditPlan({...f, draft: {maintainingPurchaseQty: ''}});
    assert.deepEqual(patchFor(plan, 'maa'), {maintainingStock: 8});
    plan = buildInventoryItemEditPlan({...f, draft: {maintainingBaseQty: ''}});
    assert.deepEqual(patchFor(plan, 'maa'), {maintainingStock: 250});
});

test('different names, units or package conversion are never guessed as equivalent', () => {
    const f = fixture();
    f.items = [f.original, row('other-name', 'Citygate', {name: '4 Pcs Paper Bowl'}), row('different-conv', 'Cabantian', {conversionRate: 100}), row('different-uom', 'Agdao', {baseUom: 'gram'})];
    const plan = buildInventoryItemEditPlan({...f, permittedBranches: ['All'], draft: {maintainingPurchaseQty: '10'}});
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(plan.skippedPeers.map(item => item.id).sort(), ['different-conv', 'different-uom']);
    assert.notEqual(inventoryItemIdentity(f.original), inventoryItemIdentity(f.items[1]));
});

test('an ambiguous matching destination is blocked rather than merged, while unrelated HQ duplicates cannot block a local HQ target save', () => {
    const f = fixture(); f.items.push(row('cab-duplicate', 'Cabantian', {conversionRate: 100}));
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {maintainingPurchaseQty: 10}}), /More than one matching item exists in Cabantian/);
    f.original = f.items[0];
    assert.doesNotThrow(() => buildInventoryItemEditPlan({...f, draft: {maintainingPurchaseQty: 10}}));
});

test('local item details and cost edits do not propagate without an explicit metadata choice', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, draft: {category: 'Consumables', purchaseCost: '150', name: 'Bowl revised', showInPrep: true}});
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(patchFor(plan, 'maa'), {name: 'Bowl revised', category: 'Consumables', showInPrep: true, purchaseCost: 150, purchCost: 150, cost: 150, baseCost: 3});
});

test('even explicitly copied item details never copy cost or valuation and never edit HQ', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, copyMetadata: true, draft: {category: 'Consumables', purchaseCost: 150, allowRequest: false}});
    assert.deepEqual(patchFor(plan, 'cab'), {category: 'Consumables', allowRequest: false});
    assert.equal(patchFor(plan, 'office'), undefined);
    assert.equal(patchFor(plan, 'foreign'), undefined);
    for (const update of plan.updates.filter(update => update.id !== f.original.id)) {
        assert.ok(!Object.hasOwn(update.patch, 'currentStock'));
        assert.ok(!Object.hasOwn(update.patch, 'baseCost'));
        assert.ok(!Object.hasOwn(update.patch, 'purchaseCost'));
    }
});

test('branch and record identity are immutable and a selected item outside approved access is refused', () => {
    const f = fixture();
    for (const draft of [{branch: 'Main Office'}, {branch: ''}, {id: 'office'}])
        assert.throws(() => buildInventoryItemEditPlan({...f, draft}), /branch cannot be changed/);
    assert.throws(() => buildInventoryItemEditPlan({...f, permittedBranches: ['Agdao'], draft: {restockCycle: 'Weekly'}}), /approved branch access/);
});

test('malformed, negative and nonfinite numerical inputs do not silently reset values', () => {
    const f = fixture();
    for (const [key, values] of Object.entries({conversionRate: [0, -1, '', '50abc', NaN, Infinity, true], purchaseCost: [-1, '', '100abc', Infinity, null],
        maintainingPurchaseQty: [-1, 'nope', Infinity], maintainingBaseQty: [-1, '5 pieces'], lowStockPurchaseQty: [-1, '1 pack', Infinity]})) {
        for (const value of values) assert.throws(() => buildInventoryItemEditPlan({...f, draft: {[key]: value}}), error => error.field === key);
    }
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {restockCycle: 'Daily'}}), /Weekly or Monthly/);
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {maintainingPurchaseQty: Number.MAX_SAFE_INTEGER}}), /too large/);
});

test('the settings save cannot accept a physical-count field or direct base cost', () => {
    const f = fixture();
    for (const field of ['currentStock', 'newQty', 'physicalCount', 'baseCost'])
        assert.throws(() => buildInventoryItemEditPlan({...f, draft: {[field]: 0}}), /separate stock correction/);
});

test('open-snapshot guards reject concurrent changes to edited settings but allow unrelated sales and valuation changes', () => {
    const f = fixture(), plan = buildInventoryItemEditPlan({...f, draft: {maintainingPurchaseQty: 10}});
    const selected = plan.updates.find(update => update.id === 'maa');
    assert.equal(assertInventoryEditUnchanged({...f.original, currentStock: 173, purchaseCost: 110, baseCost: 2.2}, selected.expected), true);
    assert.throws(() => assertInventoryEditUnchanged({...f.original, maintainingStock: 300}, selected.expected), /changed after you opened/);
    assert.throws(() => assertInventoryEditUnchanged({...f.original, branch: 'Agdao'}, selected.expected), /changed after you opened/);
    assert.throws(() => assertInventoryEditUnchanged({...f.original, conversionRate: 100}, selected.expected), /changed after you opened/);
    const peer = plan.updates.find(update => update.id === 'cab');
    assert.throws(() => assertInventoryEditUnchanged({...f.items[2], maintainingStock: 150}, peer.expected), /changed after you opened/);
});

test('explicit cost edits guard the opened cost aliases while retaining concurrent stock movements', () => {
    const f = fixture(), plan = buildInventoryItemEditPlan({...f, draft: {purchaseCost: 120}}), selected = plan.updates[0];
    assert.equal(assertInventoryEditUnchanged({...f.original, currentStock: 160}, selected.expected), true);
    assert.throws(() => assertInventoryEditUnchanged({...f.original, purchaseCost: 110}, selected.expected), /changed after you opened/);
});

test('legacy aliases and zero cost initialize honestly without changing stock or creating no-op writes', () => {
    const original = {id: 'legacy', branch: 'Maa', name: 'Flour', purchUom: 'Sack', uom: 'gram', conversion: '25000', purchCost: 0, reorderLevel: 0, maintainingStock: 25001};
    const draft = inventoryItemEditDraft(original);
    assert.equal(draft.purchaseCost, 0);
    assert.equal(draft.lowStockPurchaseQty, 0);
    assert.equal(draft.maintainingPurchaseQty, 1);
    assert.equal(draft.maintainingBaseQty, 1);
    assert.deepEqual(buildInventoryItemEditPlan({original, draft, permittedBranches: ['Maa']}).updates, []);
});

test('base-unit changes with a nonzero quantity are held for a reviewed conversion, and a zero-stock unit change guards concurrent deliveries', () => {
    const f = fixture();
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {baseUom: 'gram'}}), /reviewed stock conversion/);
    f.original = {...f.original, currentStock: 0};
    const plan = buildInventoryItemEditPlan({...f, draft: {baseUom: 'gram'}});
    assert.throws(() => assertInventoryEditUnchanged({...f.original, currentStock: 50}, plan.updates[0].expected), /changed after you opened/);
});

test('conversion-only metadata changes leave the opened target and alert unchanged even when the form supplies every input', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, draft: {...inventoryItemEditDraft(f.original), conversionRate: '100'}});
    assert.deepEqual(patchFor(plan, 'maa'), {conversionRate: 100, conversion: 100, purchaseCost: 100, purchCost: 100, cost: 100, baseCost: 1});
    assert.deepEqual(plan.copiedBranches, []);
    assert.ok(!plan.changedFields.includes('maintainingStock'));
    assert.ok(!plan.changedFields.includes('lowStockAlert'));
});

test('unrelated legacy cost, cycle and missing unit labels remain untouched by a local target edit', () => {
    const original = {id: 'legacy-bad', name: 'Legacy supply', branch: 'Main Office', purchaseCost: -15, conversionRate: 50,
        maintainingStock: 100, lowStockAlert: -10, restockCycle: 'As needed', currentStock: 300};
    const draft = {...inventoryItemEditDraft(original), maintainingPurchaseQty: 5};
    const plan = buildInventoryItemEditPlan({original, draft, permittedBranches: ['All']});
    assert.deepEqual(patchFor(plan, 'legacy-bad'), {maintainingStock: 250});
    assert.equal(plan.identity, null);
});

test('invalid legacy conversion cannot cause guessed peer matches, but unrelated local cycle edits can still be saved', () => {
    const original = row('legacy', 'Maa', {conversionRate: 0});
    const plan = buildInventoryItemEditPlan({original, items: [row('peer', 'Agdao', {conversionRate: 0})], permittedBranches: ['All'], draft: {restockCycle: 'Weekly'}});
    assert.deepEqual(patchFor(plan, 'legacy'), {restockCycle: 'Weekly'});
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.skippedPeers[0].id, 'peer');
    assert.throws(() => buildInventoryItemEditPlan({original, permittedBranches: ['All'], draft: {maintainingPurchaseQty: 10}}), error => error.field === 'conversionRate');
});

test('a second same-name record in the selected branch blocks ambiguous cross-branch copying', () => {
    const f = fixture(); f.items.push(row('duplicate-selected', 'Maa'));
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {restockCycle: 'Weekly'}}), /More than one matching item exists in Maa/);
});

test('an unchanged malformed legacy target never turns into a saved zero while editing other details', () => {
    const original = row('malformed', 'Main Office', {maintainingStock: 'unknown'});
    const draft = {...inventoryItemEditDraft(original), category: 'Consumables'};
    const plan = buildInventoryItemEditPlan({original, draft, permittedBranches: ['All']});
    assert.deepEqual(plan.updates[0].patch, {category: 'Consumables'});
});

test('a name edit never becomes a copied rename through the optional metadata flag', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, draft: {name: 'Reviewed new name'}, copyMetadata: true});
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(plan.updates[0].patch, {name: 'Reviewed new name'});
    assert.deepEqual(plan.copiedBranches, []);
});

test('a one-to-one fractional target uses one visible quantity without a hidden remainder', () => {
    const original = row('one-to-one', 'Maa', {purchaseUom: 'Batch', baseUom: 'gram', conversionRate: 1, maintainingStock: .5});
    const opened = inventoryItemEditDraft(original);
    assert.equal(opened.maintainingPurchaseQty, .5);
    assert.equal(opened.maintainingBaseQty, 0);
    const plan = buildInventoryItemEditPlan({original, permittedBranches: ['Maa'], draft: {maintainingPurchaseQty: 1}});
    assert.deepEqual(plan.updates[0].patch, {maintainingStock: 1});
});

test('equal purchase/base unit labels still use the saved conversion for both target boxes', () => {
    const original = row('same-labels', 'Maa', {purchaseUom: 'piece', baseUom: 'piece', conversionRate: 50, maintainingStock: 250});
    const opened = inventoryItemEditDraft(original);
    assert.equal(opened.maintainingPurchaseQty, 5);
    assert.equal(opened.maintainingBaseQty, 0);
    const plan = buildInventoryItemEditPlan({original, permittedBranches: ['Maa'], draft: {maintainingPurchaseQty: 50}});
    assert.deepEqual(plan.updates[0].patch, {maintainingStock: 2500});
});

test('explicit metadata copying cannot change peer units, conversions or any cost aliases', () => {
    const f = fixture();
    const plan = buildInventoryItemEditPlan({...f, copyMetadata: true, draft: {conversionRate: 100, purchaseUom: 'Bundle', category: 'Consumables'}});
    assert.deepEqual(patchFor(plan, 'cab'), {category: 'Consumables'});
    assert.deepEqual(patchFor(plan, 'agdao'), {category: 'Consumables'});
    assert.equal(patchFor(plan, 'office'), undefined);
    assert.equal(patchFor(plan, 'maa').conversionRate, 100);
    assert.equal(patchFor(plan, 'maa').baseCost, 1);
});

test('missing costs remain blank while an explicitly saved zero cost remains zero', () => {
    const missing = row('unknown-cost', 'Main Office');
    delete missing.purchaseCost; delete missing.baseCost;
    assert.equal(canonicalDraft(missing).purchaseCost, '');
    assert.equal(canonicalDraft({...missing, baseCost: 0}).purchaseCost, 0);
    assert.equal(canonicalDraft({...missing, purchaseCost: 0}).purchaseCost, 0);
    const plan = buildInventoryItemEditPlan({original: missing, draft: {...canonicalDraft(missing), restockCycle: 'Weekly'}, permittedBranches: ['All']});
    assert.deepEqual(plan.updates[0].patch, {restockCycle: 'Weekly'});
    assert.throws(() => buildInventoryItemEditPlan({original: missing, draft: {conversionRate: 100}, permittedBranches: ['All']}), error => error.field === 'purchaseCost');
});

test('a missing or invalid target opens blank and unrelated changes preserve its original stored value', () => {
    for (const value of [undefined, null, '', 'unknown', NaN, Infinity, -1, false]) {
        const original = row('target-review', 'Main Office', {maintainingStock: value});
        const draft = canonicalDraft(original);
        assert.equal(draft.maintainingPurchaseQty, '');
        assert.equal(draft.maintainingBaseQty, '');
        const plan = buildInventoryItemEditPlan({original, draft: {...draft, category: 'Consumables'}, permittedBranches: ['All']});
        assert.deepEqual(plan.updates[0].patch, {category: 'Consumables'});
    }
    assert.equal(canonicalDraft(row('zero-target', 'Main Office', {maintainingStock: 0})).maintainingPurchaseQty, 0);
});

test('unit or conversion edits cannot share a save with changed restock settings', () => {
    const f = fixture();
    for (const draft of [{conversionRate: 100, maintainingPurchaseQty: 8}, {conversionRate: 100, lowStockPurchaseQty: 2},
        {conversionRate: 100, restockCycle: 'Weekly'}, {baseUom: 'gram', restockCycle: 'Weekly'}]) {
        assert.throws(() => buildInventoryItemEditPlan({...f, draft}), /Save unit or conversion changes first/);
    }
    assert.doesNotThrow(() => buildInventoryItemEditPlan({...f, draft: {...canonicalDraft(f.original), conversionRate: 100}}));
});

test('conflicting alert aliases remain untouched until an explicit alert repair is submitted', () => {
    const f = fixture(); f.original = {...f.items[0], lowStockAlert: 50, reorderLevel: 0};
    const opened = canonicalDraft(f.original);
    let plan = buildInventoryItemEditPlan({...f, draft: opened});
    assert.deepEqual(plan.updates, []);
    plan = buildInventoryItemEditPlan({...f, draft: {...opened, restockCycle: 'Weekly'}});
    assert.deepEqual(plan.updates[0].patch, {restockCycle: 'Weekly'});
    plan = buildInventoryItemEditPlan({...f, draft: {lowStockPurchaseQty: 1, repairLowStockAlert: true}});
    assert.deepEqual(plan.updates[0].patch, {lowStockAlert: 50, reorderLevel: 50});
    assert.ok(plan.updates[0].expected.fields.includes('lowStockAlert'));
    assert.ok(plan.updates[0].expected.fields.includes('reorderLevel'));
    assert.throws(() => assertInventoryEditUnchanged({...f.original, reorderLevel: 25}, plan.updates[0].expected), /changed after you opened/);
});

test('an explicit non-HQ alert repair also repairs conflicting matching peer aliases without copying HQ or costs', () => {
    const f = fixture(); f.original = {...f.original, lowStockAlert: 50, reorderLevel: 0};
    f.items = f.items.map(row => row.id === 'cab' ? {...row, lowStockAlert: 50, reorderLevel: 10} : row);
    const plan = buildInventoryItemEditPlan({...f, draft: {lowStockPurchaseQty: '1', repairLowStockAlert: true}});
    assert.deepEqual(patchFor(plan, 'maa'), {lowStockAlert: 50, reorderLevel: 50});
    assert.deepEqual(patchFor(plan, 'cab'), {lowStockAlert: 50, reorderLevel: 50});
    assert.equal(patchFor(plan, 'office'), undefined);
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {repairLowStockAlert: true}}), /Choose the low-stock alert value/);
    assert.throws(() => buildInventoryItemEditPlan({...f, draft: {repairLowStockAlert: false}}), /repair explicitly/);
});
