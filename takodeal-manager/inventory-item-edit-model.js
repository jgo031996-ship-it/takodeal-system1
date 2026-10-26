// Pure planning for the Owner item editor. No stock movement or database write
// happens here. Every expected value comes from the snapshot the user opened.
const HQ = 'Main Office';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const IDENTITY_FIELDS = ['name', 'branch', 'purchaseUom', 'purchUom', 'baseUom', 'uom', 'conversionRate', 'conversion'];
const META_FIELDS = ['name', 'category', 'purchaseUom', 'baseUom', 'conversionRate', 'showInPrep', 'allowRequest', 'image'];
const COPYABLE_METADATA_FIELDS = ['category', 'showInPrep', 'allowRequest', 'image'];
const SETTING_FIELDS = ['maintainingStock', 'lowStockAlert', 'restockCycle'];
const DRAFT_FIELDS = new Set(['id', 'branch', 'name', 'category', 'purchaseUom', 'baseUom', 'conversionRate', 'purchaseCost', 'lowStockPurchaseQty', 'repairLowStockAlert', 'maintainingPurchaseQty', 'maintainingBaseQty', 'restockCycle', 'showInPrep', 'allowRequest', 'image']);
const STOCK_FIELDS = new Set(['currentStock', 'baseCost', 'newQty', 'oldQty', 'physicalCount', 'newPhysicalCount']);

export class InventoryItemEditError extends Error {
    constructor(message, field = '') { super(message); this.name = 'InventoryItemEditError'; this.field = field; }
}
function fail(message, field) { throw new InventoryItemEditError(message, field); }
const first = (row, fields, fallback) => {
    for (const key of fields) if (row?.[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    return fallback;
};
const text = value => String(value ?? '').trim();
const unit = value => text(value).toLowerCase();
const sameNumber = (a, b) => a === b || Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;
const sameQuantityInput = (value, opened) => value === opened || opened !== '' &&
    (typeof value === 'number' || typeof value === 'string') && sameNumber(Number(value), Number(opened));
const sameSnapshotValue = (a, b) => Object.is(a, b) || a !== null && b !== null &&
    typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
const recordNumber = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') &&
    Number.isFinite(Number(value)) ? Number(value) : NaN;
function conflictingAlertAliases(row) {
    const alert = first(row, ['lowStockAlert'], undefined), reorder = first(row, ['reorderLevel'], undefined);
    if (alert === undefined || reorder === undefined) return false;
    const a = recordNumber(alert), b = recordNumber(reorder);
    return !Number.isFinite(a) || !Number.isFinite(b) || a !== b;
}
function number(value, label, field, {positive = false, blankZero = false} = {}) {
    if (typeof value !== 'number' && typeof value !== 'string') fail(label + ' must be a number.', field);
    if (typeof value === 'string' && !value.trim()) {
        if (blankZero) return 0;
        fail('Enter ' + label.toLowerCase() + '.', field);
    }
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0 || result > Number.MAX_SAFE_INTEGER || positive && result === 0)
        fail(label + (positive ? ' must be greater than zero.' : ' must be zero or more.'), field);
    return result;
}
function required(value, label, field) {
    if (typeof value !== 'string' || !value.trim()) fail('Enter ' + label.toLowerCase() + '.', field);
    return value.trim();
}
function cycle(value) {
    const result = text(value).toLowerCase();
    if (result !== 'weekly' && result !== 'monthly') fail('Choose Weekly or Monthly for the restock cycle.', 'restockCycle');
    return result === 'weekly' ? 'Weekly' : 'Monthly';
}
function flag(value, field) {
    if (typeof value !== 'boolean') fail('Choose whether this item is enabled.', field);
    return value;
}
function source(row) {
    const name = required(row?.name, 'item name', 'name');
    const branch = required(row?.branch, 'branch', 'branch');
    const baseUom = text(first(row, ['baseUom', 'uom'], 'unit'));
    const purchaseUom = text(first(row, ['purchaseUom', 'purchUom'], baseUom));
    // Legacy values are shown honestly and preserved by an unrelated edit.
    // Only a changed input or arithmetic depending on it is validated.
    const conversionRate = recordNumber(first(row, ['conversionRate', 'conversion'], 1));
    const rawCost = first(row, ['purchaseCost', 'purchCost', 'cost'], undefined);
    // A missing purchase-cost alias can be displayed from the saved base cost.
    // It is never written unless the Owner explicitly changes cost/conversion.
    const recordedBaseCost = recordNumber(first(row, ['baseCost'], undefined));
    const purchaseCost = rawCost === undefined ? recordedBaseCost * conversionRate : recordNumber(rawCost);
    const lowStockAlert = recordNumber(first(row, ['lowStockAlert', 'reorderLevel'], 0));
    const maintainingStock = recordNumber(first(row, ['maintainingStock'], undefined));
    return {name, branch, category: text(row?.category || 'Uncategorized'), purchaseUom, baseUom, conversionRate,
        purchaseCost, lowStockAlert, maintainingStock, restockCycle: ['weekly', 'monthly'].includes(text(row?.restockCycle).toLowerCase())
            ? text(row.restockCycle).toLowerCase() === 'weekly' ? 'Weekly' : 'Monthly' : text(row?.restockCycle || 'Monthly'),
        showInPrep: row?.showInPrep !== false, allowRequest: row?.allowRequest !== false, image: text(row?.image || '')};
}

export function inventoryItemIdentity(row) {
    const item = source(row);
    const savedBase = first(row, ['baseUom', 'uom'], '');
    const savedPurchase = first(row, ['purchaseUom', 'purchUom'], '');
    for (const aliases of [['baseUom', 'uom'], ['purchaseUom', 'purchUom']]) {
        const values = aliases.filter(field => row?.[field] != null && text(row[field]) !== '').map(field => unit(row[field]));
        if (new Set(values).size > 1) return null;
    }
    const conversions = ['conversionRate', 'conversion'].filter(field => row?.[field] != null && text(row[field]) !== '').map(field => recordNumber(row[field]));
    if (conversions.some(value => !Number.isFinite(value) || value <= 0) || new Set(conversions).size > 1) return null;
    if (!text(savedBase) || !text(savedPurchase) && item.conversionRate !== 1 || !Number.isFinite(item.conversionRate) || item.conversionRate <= 0)
        return null;
    // Deliberately no fuzzy item-name matching. Equal unit labels may differ
    // only in letter case; gallon, litre, pack and piece are never conflated.
    return JSON.stringify([item.name, unit(item.purchaseUom), unit(item.baseUom), item.conversionRate]);
}

export function inventoryItemEditDraft(original) {
    const item = source(original);
    const validConversion = Number.isFinite(item.conversionRate) && item.conversionRate > 0;
    const validTarget = Number.isFinite(item.maintainingStock) && item.maintainingStock >= 0;
    const split = validConversion && item.conversionRate !== 1;
    const whole = !validTarget ? '' : split ? Math.trunc(item.maintainingStock / item.conversionRate) : item.maintainingStock;
    const remainder = !validTarget ? '' : split ? item.maintainingStock - whole * item.conversionRate : 0;
    return {branch: item.branch, name: item.name, category: item.category, purchaseUom: item.purchaseUom, baseUom: item.baseUom,
        conversionRate: Number.isFinite(item.conversionRate) ? item.conversionRate : '', purchaseCost: Number.isFinite(item.purchaseCost) ? item.purchaseCost : '',
        lowStockPurchaseQty: validConversion && Number.isFinite(item.lowStockAlert) ? item.lowStockAlert / item.conversionRate : '',
        maintainingPurchaseQty: whole, maintainingBaseQty: typeof remainder === 'number' ? Math.abs(remainder) < 1e-9 ? 0 : remainder : '',
        restockCycle: item.restockCycle, showInPrep: item.showInPrep, allowRequest: item.allowRequest, image: item.image};
}
export const canonicalDraft = inventoryItemEditDraft;

function guard(row, patch, extraFields = []) {
    const fields = [...new Set([...IDENTITY_FIELDS, ...Object.keys(patch), ...extraFields])];
    return {fields, data: Object.fromEntries(fields.map(field => [field, row[field] ?? null]))};
}
export function assertInventoryEditUnchanged(live, expected) {
    if (!live || !expected?.fields || !expected.data) fail('This item no longer exists. Reopen Live Stocks.', 'item');
    const changed = expected.fields.filter(field => !sameSnapshotValue(live[field] ?? null, expected.data[field] ?? null));
    if (changed.length) fail('This item changed after you opened it. Reopen it before saving.', changed[0]);
    return true;
}
const patchKeys = {
    name: value => ({name: value}), category: value => ({category: value}),
    purchaseUom: value => ({purchaseUom: value, purchUom: value}),
    baseUom: value => ({baseUom: value, uom: value}),
    conversionRate: value => ({conversionRate: value, conversion: value}),
    lowStockAlert: value => ({lowStockAlert: value, reorderLevel: value}),
    maintainingStock: value => ({maintainingStock: value}), restockCycle: value => ({restockCycle: value}),
    showInPrep: value => ({showInPrep: value}), allowRequest: value => ({allowRequest: value}), image: value => ({image: value})
};

/**
 * draft is a partial canonicalDraft(original), using purchase/base target boxes.
 * items MUST be the branch snapshots loaded for the open edit preview. The
 * caller must transactionally check each update.expected and fresh access.
 * Store item details share by default; copyMetadata:false keeps those local.
 * A changed store purchase cost always shares with compatible store items.
 * syncStoreCost explicitly reapplies an unchanged source cost to repair peers.
 */
export function buildInventoryItemEditPlan({original, draft = {}, items = [], permittedBranches = [], copyMetadata = true, syncStoreCost = false} = {}) {
    if (!original?.id) fail('Reopen the stock item before saving.', 'id');
    if (!draft || Array.isArray(draft) || typeof draft !== 'object') fail('The item edits are invalid.', 'item');
    for (const key of Object.keys(draft)) {
        if (STOCK_FIELDS.has(key)) fail('Use a separate stock correction for physical counts. This save cannot change stock or a direct base cost.', key);
        if (!DRAFT_FIELDS.has(key)) fail('The item edit contains an unsupported field: ' + key + '.', key);
    }
    if (typeof copyMetadata !== 'boolean') fail('Choose whether to copy item details.', 'copyMetadata');
    if (typeof syncStoreCost !== 'boolean') fail('Choose whether to synchronize the store cost.', 'syncStoreCost');
    if (own(draft, 'repairLowStockAlert') && draft.repairLowStockAlert !== true)
        fail('Confirm the saved low-stock alert repair explicitly.', 'lowStockPurchaseQty');
    if (draft.repairLowStockAlert && !own(draft, 'lowStockPurchaseQty'))
        fail('Choose the low-stock alert value to use for this repair.', 'lowStockPurchaseQty');
    if (!Array.isArray(items) || !Array.isArray(permittedBranches)) fail('Refresh the approved branch item list before saving.', 'item');
    const before = source(original), identity = inventoryItemIdentity(original), opened = inventoryItemEditDraft(original), changes = {};
    const permitted = new Set(permittedBranches.map(text));
    const allowed = branch => permitted.has('All') || permitted.has(branch);
    if (!allowed(before.branch)) fail('Your approved branch access does not allow this item.', 'branch');
    if (syncStoreCost && before.branch === HQ) fail('Main Office costs stay separate. Open a store item to synchronize its store cost.', 'syncStoreCost');
    if (own(draft, 'id') && draft.id !== original.id || own(draft, 'branch') && text(draft.branch) !== before.branch)
        fail('The branch cannot be changed here. Open the item in the branch you want to edit.', 'branch');
    const after = {...before};
    for (const key of ['name', 'category', 'purchaseUom', 'baseUom']) if (own(draft, key)) {
        const value = required(draft[key], key === 'name' ? 'item name' : key === 'category' ? 'category' : 'unit label', key);
        const equal = key.endsWith('Uom') ? unit(value) === unit(before[key]) : value === before[key];
        if (!equal) changes[key] = after[key] = value;
    }
    for (const key of ['conversionRate', 'purchaseCost']) if (own(draft, key)) {
        if (draft[key] === opened[key] || typeof draft[key] === 'string' && draft[key].trim() && sameNumber(Number(draft[key]), before[key])) continue;
        const value = number(draft[key], key === 'conversionRate' ? 'Units per purchase unit' : 'Purchase cost', key, {positive: key === 'conversionRate'});
        if (!sameNumber(value, before[key])) changes[key] = after[key] = value;
    }
    if (syncStoreCost) changes.purchaseCost = after.purchaseCost = number(after.purchaseCost, 'Purchase cost', 'purchaseCost');
    if (own(draft, 'restockCycle') && draft.restockCycle !== opened.restockCycle) {
        const value = cycle(draft.restockCycle);
        if (value !== before.restockCycle) changes.restockCycle = after.restockCycle = value;
    }
    for (const key of ['showInPrep', 'allowRequest']) if (own(draft, key)) {
        const value = flag(draft[key], key);
        if (value !== before[key]) changes[key] = after[key] = value;
    }
    if (own(draft, 'image')) {
        if (typeof draft.image !== 'string') fail('Choose a valid item photo.', 'image');
        const value = draft.image.trim();
        if (value !== before.image) {
            if (value && !/^https:\/\//i.test(value)) fail('Choose a valid uploaded item photo.', 'image');
            changes.image = after.image = value;
        }
    }
    if (own(draft, 'lowStockPurchaseQty') && (draft.lowStockPurchaseQty !== opened.lowStockPurchaseQty || draft.repairLowStockAlert)) {
        const qty = number(draft.lowStockPurchaseQty, 'Low-stock alert', 'lowStockPurchaseQty', {blankZero: true});
        if (!sameNumber(qty, opened.lowStockPurchaseQty) || draft.repairLowStockAlert && conflictingAlertAliases(original)) {
            const conv = qty === 0 ? 1 : number(after.conversionRate, 'Units per purchase unit', 'conversionRate', {positive: true});
            const value = qty * conv;
            if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) fail('The low-stock quantity is too large.', 'lowStockPurchaseQty');
            if (!sameNumber(value, before.lowStockAlert) || draft.repairLowStockAlert && conflictingAlertAliases(original))
                changes.lowStockAlert = after.lowStockAlert = value;
        }
    }
    if (own(draft, 'maintainingPurchaseQty') || own(draft, 'maintainingBaseQty')) {
        const purchaseRaw = own(draft, 'maintainingPurchaseQty') ? draft.maintainingPurchaseQty : opened.maintainingPurchaseQty;
        const baseRaw = own(draft, 'maintainingBaseQty') ? draft.maintainingBaseQty : opened.maintainingBaseQty;
        if (!sameQuantityInput(purchaseRaw, opened.maintainingPurchaseQty) || !sameQuantityInput(baseRaw, opened.maintainingBaseQty)) {
            const purchase = number(purchaseRaw, 'Maintaining purchase quantity', 'maintainingPurchaseQty', {blankZero: true});
            const base = number(baseRaw, 'Maintaining loose quantity', 'maintainingBaseQty', {blankZero: true});
            const conv = purchase === 0 ? 1 : number(after.conversionRate, 'Units per purchase unit', 'conversionRate', {positive: true});
            const value = purchase * conv + base;
            if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) fail('The maintaining quantity is too large.', 'maintainingPurchaseQty');
            if (!sameNumber(value, before.maintainingStock)) changes.maintainingStock = after.maintainingStock = value;
        }
    }
    const changedFields = Object.keys(changes);
    const settingFields = changedFields.filter(field => SETTING_FIELDS.includes(field));
    const metadataFields = changedFields.filter(field => META_FIELDS.includes(field));
    if (settingFields.length && (own(changes, 'conversionRate') || own(changes, 'baseUom')))
        fail('Save unit or conversion changes first, then reopen the item to change its restock settings.', own(changes, 'conversionRate') ? 'conversionRate' : 'baseUom');
    const shareCost = before.branch !== HQ && own(changes, 'purchaseCost');
    if (shareCost && ['purchaseUom', 'baseUom', 'conversionRate'].some(field => own(changes, field)))
        fail('Save and review unit or conversion changes separately, then reopen the item before sharing its cost.', 'purchaseCost');
    if (shareCost && identity === null)
        fail('Review the saved purchase unit, base unit and conversion aliases before sharing this store cost.', 'conversionRate');
    const settingsToCopy = before.branch === HQ ? [] : settingFields;
    // Linked names and unit/conversion edits need their own review. Main Office
    // never broadcasts its editor changes to stores, even with copyMetadata.
    const metadataToCopy = before.branch !== HQ && copyMetadata ? metadataFields.filter(field => COPYABLE_METADATA_FIELDS.includes(field)) : [];
    const peerFields = [...new Set([...settingsToCopy, ...metadataToCopy])];
    const selectedPatch = {};
    for (const [field, value] of Object.entries(changes)) if (field !== 'purchaseCost') Object.assign(selectedPatch, patchKeys[field](value));
    if (own(changes, 'purchaseCost') || own(changes, 'conversionRate')) {
        const cost = number(after.purchaseCost, 'Purchase cost', 'purchaseCost');
        const conversion = number(after.conversionRate, 'Units per purchase unit', 'conversionRate', {positive: true});
        const baseCost = number(cost / conversion, 'Base-unit cost', 'purchaseCost');
        Object.assign(selectedPatch, {purchaseCost: cost, purchCost: cost, cost, baseCost});
    }
    const selectedExtraGuards = [];
    if (own(changes, 'baseUom')) {
        if (Number(original.currentStock) !== 0) fail('A base-unit change needs a reviewed stock conversion while this branch has stock.', 'baseUom');
        selectedExtraGuards.push('currentStock');
    }
    const updates = Object.keys(selectedPatch).length ? [{id: original.id, branch: before.branch, patch: selectedPatch, expected: guard(original, selectedPatch, selectedExtraGuards)}] : [];
    const skippedPeers = [], copiedBranches = [], copiedCostBranches = [], peerCandidates = [];
    if (peerFields.length || shareCost) {
        const eligible = items.filter(row => row?.id !== original.id && text(row?.branch) !== HQ && allowed(text(row?.branch)) && text(row?.name) === before.name);
        const byBranch = new Map();
        for (const row of eligible) {
            const branch = text(row.branch);
            if (!row.id) fail('A matching branch item has no record ID. Refresh inventory.', 'item');
            if (branch === before.branch || byBranch.has(branch)) fail('More than one matching item exists in ' + branch + '. Resolve the duplicate before copying settings.', 'item');
            byBranch.set(branch, row);
        }
        for (const [branch, row] of byBranch) {
            let matches = false;
            try { matches = identity !== null && inventoryItemIdentity(row) === identity; } catch { /* Invalid legacy units must not be guessed. */ }
            if (!matches) { skippedPeers.push({id: row.id, branch, reason: 'Different units or conversion'}); continue; }
            peerCandidates.push(row);
        }
    }
    for (const row of peerCandidates) {
        const peerBefore = source(row), patch = {};
        for (const field of peerFields) {
            const equal = typeof changes[field] === 'number' ? sameNumber(changes[field], peerBefore[field]) : changes[field] === peerBefore[field];
            const repairingAlert = field === 'lowStockAlert' && draft.repairLowStockAlert && conflictingAlertAliases(row);
            if (!equal || repairingAlert) Object.assign(patch, patchKeys[field](changes[field]));
        }
        if (shareCost) {
            const costPatch = Object.fromEntries(['purchaseCost', 'purchCost', 'cost', 'baseCost'].map(field => [field, selectedPatch[field]]));
            // Include even an already-equal peer: its cost and unit baseline
            // must still hold when the whole store group is saved atomically.
            // This also repairs aliases hidden by the preferred display value.
            Object.assign(patch, costPatch);
            copiedCostBranches.push(peerBefore.branch);
        }
        if (!Object.keys(patch).length) continue;
        const extra = [];
        if (own(patch, 'baseUom')) {
            if (Number(row.currentStock) !== 0) fail('A base-unit change needs a reviewed stock conversion in ' + row.branch + '.', 'baseUom');
            extra.push('currentStock');
        }
        // Physical quantities, including negative balances, are never copied.
        updates.push({id: row.id, branch: peerBefore.branch, patch, expected: guard(row, patch, extra)});
        copiedBranches.push(peerBefore.branch);
    }
    return {identity, updates, changes, changedFields, settingFields, metadataFields,
        copiedBranches: copiedBranches.sort(), copiedCostBranches: copiedCostBranches.sort(),
        sharedFields: [...peerFields, ...(shareCost ? ['purchaseCost'] : [])], skippedPeers, selectedBranch: before.branch,
        scope: before.branch === HQ ? 'main-office-only' : 'matching-non-hq-branches'};
}
