import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';

// Run the production cart builder and submit handler with fictional local data.
// Every write rejects undefined values, as the browser Firestore SDK does.
const main = readFileSync(new URL('../Takodeal-POS/main.js', import.meta.url), 'utf8');
const start = main.indexOf('window.expenseCart = []');
const end = main.indexOf('// --- LIVE CLOCK ENGINE ---', start);
assert.ok(start >= 0 && end > start, 'production expense handlers must be present');
const source = main.slice(start, end);
const branch = 'Fictional Expense Branch';
const cashier = 'Fictional Expense Cashier';
const stockId = 'fictional-ice';
const shiftId = 'fictional-expense-shift';
const held = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
};
function validateWrite(value, path = 'data') {
    if (value === undefined) throw Error('Unsupported field value: undefined at ' + path);
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) validateWrite(child, path + '.' + key);
    }
}
function fixture({fundSource = 'Drawer', photo = false, photoFailure = false} = {}) {
    const h = firestoreHarness();
    h.put('inventory/' + stockId, {branch, name: 'Ice Cubes', uom: 'Kilogram', currentStock: 10, cost: 8});
    h.put('inventory/fictional-cups', {branch, name: 'Cups', uom: 'unit', currentStock: 5, cost: 2});
    h.put('shifts/' + shiftId, {branch, cashier, cashierName: cashier, active: true, expenses: 20, cashOut: 20});
    const memory = new Map([['takodeal_device_branch', branch], ['cashierName', cashier]]);
    const elements = {
        expSearchInput: {value: ''}, expQtyInput: {value: ''}, expAmtInput: {value: ''},
        expUomSelect: {value: 'base'}, expUomContainer: {style: {}},
        expFundSource: {value: fundSource}, btnSubmitExpenseCart: {innerText: 'Submit All Expenses', disabled: false},
        expenseReceiptPhoto: {files: photo ? [{name: 'fictional-receipt.jpg',type:'image/jpeg',size:1234}] : []},
        expenseModal: {style: {display: 'flex'}}, expenseCartBody: {innerHTML: ''}, expenseCartTotal: {innerText: ''}
    };
    const alerts = [], errors = [], reads = [], stagedWrites = [], directWrites = [], uploads = [];
    let ids = 0, transactions = 0, hook = async () => {}, afterCommit = () => {}, refreshed = 0;
    const snapshot = reference => ({id: reference.id, ref: reference,
        exists: () => h.docs.has(reference.path), data: () => structuredClone(h.get(reference.path))});
    const api = {
        ...h.api,
        doc: (dbOrCollection, tableOrId, id) => id === undefined
            ? h.ref(dbOrCollection.table, tableOrId || 'fictional-auto-' + (++ids))
            : h.ref(tableOrId, id),
        getDoc: async reference => snapshot(reference),
        getDocFromServer: async reference => snapshot(reference),
        addDoc: async (reference, data) => {
            validateWrite(data); directWrites.push(reference.table);
            const ref = h.ref(reference.table, 'fictional-auto-' + (++ids)); h.put(ref.path, data); return ref;
        },
        updateDoc: async (reference, data) => {
            validateWrite(data); directWrites.push(reference.path); h.put(reference.path, {...h.get(reference.path), ...data});
        },
        runTransaction: (db, callback) => {
            transactions++;
            return h.api.runTransaction(db, transaction => callback({
                ...transaction,
                get: async reference => { reads.push(reference.path); await hook(reference); return transaction.get(reference); },
                set: (reference, data, options) => {
                    validateWrite(data); stagedWrites.push({path: reference.path, data: structuredClone(data)});
                    return transaction.set(reference, data, options);
                },
                update: (reference, data) => {
                    validateWrite(data); stagedWrites.push({path: reference.path, data: structuredClone(data)});
                    return transaction.update(reference, data);
                }
            })).then(result => { afterCommit(); return result; });
        }
    };
    const window = {...api, storage: {},auth:{currentUser:{uid:'synthetic-approved-device'}},sessionUser:{staffId:'synthetic-staff',cashierName:cashier,branch}};
    const context = {
        ...api, window, document: {getElementById: id => elements[id] || null},
        localStorage: {getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key)},
        activeShiftDetails: {logId: shiftId, branch, cashier},
        crypto: {randomUUID: () => 'fictional-expense-token-' + (++ids)},
        alert: value => alerts.push(String(value)), console: {error: (...args) => errors.push(args.map(String).join(' ')), warn() {}},
        ref: (_storage, path) => ({path}),
        uploadBytes: async (reference, file, metadata) => {
            uploads.push({reference, file, metadata});assert.match(reference.path,/^staff_requests\/synthetic-approved-device\/synthetic-staff\/expense_/);assert.deepEqual(JSON.parse(JSON.stringify(metadata)),{contentType:'image/jpeg',customMetadata:{staffUploadUid:'synthetic-approved-device',staffId:'synthetic-staff'}});
            if (photoFailure) throw Error('Fictional optional photo failure');
            return {ref: reference};
        },
        getDownloadURL: async () => 'https://example.test/fictional-receipt.jpg',
        checkCurrentShift: () => { refreshed++; }, setTimeout, clearTimeout
    };
    vm.runInNewContext(source, context);
    function add({id = stockId, name = 'Ice Cubes', uom = 'Kilogram', quantity = 30, amount = 300, purchaseUom, conversionRate, purchase = false, general = false} = {}) {
        window.selectedExpenseItem = general ? null : {id, name, uom, purchaseUom, conversionRate};
        elements.expSearchInput.value = general ? name : 'Restock: ' + name;
        elements.expQtyInput.value = String(quantity); elements.expAmtInput.value = String(amount);
        elements.expUomSelect.value = purchase ? 'purch' : 'base';
        window.addExpenseToCart();
    }
    return {h, window, context, elements, memory, alerts, errors, reads, stagedWrites, directWrites, uploads, add,
        run: () => window.submitExpenseCart(), setHook: value => { hook = value; }, setAfterCommit: value => { afterCommit = value; },
        transactions: () => transactions, generatedIds: () => ids, refreshed: () => refreshed};
}
const rows = (f, table) => [...f.h.docs].filter(([path]) => path.startsWith(table + '/')).map(([path, data]) => ({path, ...data}));
const before = f => structuredClone([...f.h.docs]);
function assertSaved(f, {amount = 300, quantity = 30, count = 1, drawer = true} = {}) {
    assert.equal(rows(f, 'expenses').length, count);
    assert.equal(rows(f, 'expenses').reduce((sum, row) => sum + row.amount, 0), amount);
    assert.equal(f.h.get('inventory/' + stockId).currentStock, 10 + quantity);
    assert.equal(rows(f, 'stock_logs').length, count);
    assert.ok(rows(f, 'stock_logs').every(row => row.inventoryId === stockId));
    const shift = f.h.get('shifts/' + shiftId);
    assert.equal(shift.expenses, drawer ? 20 + amount : 20);
    assert.equal(shift.cashOut, drawer ? 20 + amount : 20);
    assert.equal(f.elements.expenseModal.style.display, 'none');
    assert.equal(f.window.expenseCart.length, 0);
    assert.equal(f.window.expenseCartAttempt, null);
    assert.equal(f.elements.btnSubmitExpenseCart.disabled, false);
    assert.equal(f.directWrites.length, 0, 'all related records must commit in the same transaction');
}

test('Ice Cubes +30 Kilogram saves the expense, weighted stock cost, exact inventory ID and drawer totals together', async () => {
    const f = fixture(); f.add();
    assert.equal(f.window.expenseCart[0].dbId, stockId);
    assert.equal(f.window.expenseCart[0].id, undefined, 'production cart stores dbId, not id');
    await f.run(); assertSaved(f);
    assert.equal(f.h.get('inventory/' + stockId).cost, 9.5);
    assert.equal(rows(f, 'stock_logs')[0].variance, 30);
    assert.equal(rows(f, 'expenses')[0].shiftId, shiftId);
    assert.deepEqual(f.errors, []); assert.equal(f.transactions(), 1);
});

test('Manager Fund restock saves inventory and expense without deducting drawer totals', async () => {
    const f = fixture({fundSource: 'Manager Fund'}); f.add(); await f.run();
    assertSaved(f, {drawer: false});
    assert.equal(rows(f, 'expenses')[0].paidFrom, 'Manager Fund');
    assert.equal(rows(f, 'expenses')[0].shiftId, 'Manager_Fund');
});

test('two purchases of the same inventory item accumulate stock and weighted value in one transaction', async () => {
    const f = fixture(); f.add({quantity: 10, amount: 100}); f.add({quantity: 20, amount: 240});
    await f.run(); assertSaved(f, {amount: 340, quantity: 30, count: 2});
    assert.equal(f.h.get('inventory/' + stockId).cost, 10.5);
    assert.equal(rows(f, 'stock_logs').reduce((sum, row) => sum + row.variance, 0), 30);
    assert.equal(f.transactions(), 1);
});

test('purchase units use the cart builder conversion before stock and average-cost updates', async () => {
    const f = fixture(); f.add({quantity: 3, amount: 300, purchase: true, purchaseUom: 'Bag', conversionRate: 10});
    assert.equal(f.window.expenseCart[0].baseQty, 30);
    await f.run(); assertSaved(f); assert.equal(f.h.get('inventory/' + stockId).cost, 9.5);
});

test('general expense saves without changing inventory or creating a stock log', async () => {
    const f = fixture(), stock = structuredClone(f.h.get('inventory/' + stockId));
    f.add({general: true, name: 'Fictional transport', quantity: 1, amount: 90}); await f.run();
    assert.equal(rows(f, 'expenses').length, 1); assert.equal(rows(f, 'expenses')[0].amount, 90);
    assert.equal(rows(f, 'stock_logs').length, 0); assert.deepEqual(f.h.get('inventory/' + stockId), stock);
    assert.equal(f.h.get('shifts/' + shiftId).expenses, 110); assert.equal(f.h.get('shifts/' + shiftId).cashOut, 110);
    assert.equal(f.directWrites.length, 0); assert.deepEqual(f.errors, []);
});

for (const condition of ['missing inventory', 'foreign inventory', 'missing shift', 'foreign shift', 'closed shift']) {
    test(condition + ' rejects the whole submission without any partial records', async () => {
        const f = fixture(); f.add();
        if (condition === 'missing inventory') f.h.docs.delete('inventory/' + stockId);
        if (condition === 'foreign inventory') f.h.put('inventory/' + stockId, {...f.h.get('inventory/' + stockId), branch: 'Other Fictional Branch'});
        if (condition === 'missing shift') f.h.docs.delete('shifts/' + shiftId);
        if (condition === 'foreign shift') f.h.put('shifts/' + shiftId, {...f.h.get('shifts/' + shiftId), branch: 'Other Fictional Branch'});
        if (condition === 'closed shift') f.h.put('shifts/' + shiftId, {...f.h.get('shifts/' + shiftId), active: false});
        const original = before(f); await f.run(); assert.deepEqual([...f.h.docs], original);
        assert.equal(f.window.expenseCart.length, 1); assert.equal(f.elements.btnSubmitExpenseCart.disabled, false);
    });
}

test('rejected commit leaves every record unchanged and an explicit retry saves once', async () => {
    const f = fixture(); f.add(); const original = before(f); f.h.failNextCommit();
    await f.run(); assert.deepEqual([...f.h.docs], original); assert.equal(f.window.expenseCart.length, 1);
    const attempt = structuredClone(f.window.expenseCartAttempt); assert.ok(attempt?.id);
    await f.run(); assertSaved(f); assert.equal(f.transactions(), 2);
    assert.ok(rows(f, 'expenses')[0].path.includes(attempt.id));
});

test('lost commit acknowledgment reuses expense IDs and does not duplicate stock, cash or logs on retry', async () => {
    const f = fixture(); f.add(); f.h.loseNextAck(); await f.run();
    assert.equal(rows(f, 'expenses').length, 1); assert.equal(rows(f, 'stock_logs').length, 1);
    assert.equal(f.h.get('inventory/' + stockId).currentStock, 40); assert.equal(f.h.get('shifts/' + shiftId).expenses, 320);
    assert.equal(f.window.expenseCart.length, 1); const committed = before(f), writes = f.stagedWrites.length;
    await f.run(); assertSaved(f); assert.deepEqual([...f.h.docs], committed);
    assert.equal(f.stagedWrites.length, writes, 'already-saved retry must not stage new writes');
});

test('a branch change immediately after commit preserves the saved attempt for a duplicate-free retry', async () => {
    const f = fixture(); f.add();
    f.setAfterCommit(() => f.memory.set('takodeal_device_branch', 'Other Fictional Branch'));
    await f.run();
    assert.equal(rows(f, 'expenses').length, 1); assert.equal(f.window.expenseCart.length, 1);
    assert.ok(f.window.expenseCartAttempt?.id, 'a committed cart awaiting confirmation must retain its retry ID');
    const committed = before(f), writes = f.stagedWrites.length;
    f.setAfterCommit(() => {}); f.memory.set('takodeal_device_branch', branch);
    await f.run(); assertSaved(f); assert.deepEqual([...f.h.docs], committed);
    assert.equal(f.stagedWrites.length, writes);
});

test('editing and restoring an unconfirmed cart cannot discard its saved retry ID', async () => {
    const f = fixture(); f.add(); f.h.loseNextAck(); await f.run();
    const attemptId = f.window.expenseCartAttempt.id, committed = before(f), writes = f.stagedWrites.length;
    f.window.expenseCart[0].cost = 301; await f.run();
    assert.deepEqual([...f.h.docs], committed);
    assert.equal(f.window.expenseCartAttempt?.id, attemptId, 'validation failures must preserve the existing unconfirmed attempt');
    f.window.expenseCart[0].cost = 300; await f.run(); assertSaved(f);
    assert.deepEqual([...f.h.docs], committed); assert.equal(f.stagedWrites.length, writes);
});

test('concurrent submit calls share one physical transaction and the same in-flight promise', async () => {
    const f = fixture(), gate = held(), entered = held(); f.add();
    f.setHook(async () => { entered.resolve(); await gate.promise; });
    const first = f.run(); await entered.promise;
    const second = f.run(), third = f.run(); assert.equal(second, first); assert.equal(third, first);
    assert.equal(f.transactions(), 1); gate.resolve(); await Promise.all([first, second, third]);
    assertSaved(f); assert.equal(f.transactions(), 1);
});

test('an in-flight submission uses its own captured items if the visible cart changes', async () => {
    const f = fixture(), gate = held(), entered = held(); f.add();
    f.setHook(async () => { entered.resolve(); await gate.promise; });
    const work = f.run(); await entered.promise;
    f.window.expenseCart[0].cost = 9999; f.window.expenseCart[0].baseQty = 9999;
    gate.resolve(); await work; assertSaved(f); assert.equal(f.h.get('inventory/' + stockId).cost, 9.5);
});

for (const changed of ['branch', 'cashier', 'shift']) {
    test('changing local ' + changed + ' during a pending read aborts without writing records', async () => {
        const f = fixture(); f.add(); const original = before(f); let applied = false;
        f.setHook(async () => {
            if (applied) return; applied = true;
            if (changed === 'branch') f.memory.set('takodeal_device_branch', 'Other Fictional Branch');
            if (changed === 'cashier') f.memory.set('cashierName', 'Other Fictional Cashier');
            if (changed === 'shift') f.context.activeShiftDetails = {logId: 'other-fictional-shift'};
        });
        await f.run(); assert.deepEqual([...f.h.docs], original); assert.equal(f.window.expenseCart.length, 1);
    });
}

for (const [field, value] of [['cost', NaN], ['cost', Infinity], ['cost', 0], ['baseQty', NaN], ['baseQty', Infinity], ['baseQty', -1], ['displayQty', Infinity]]) {
    test('invalid cart ' + field + '=' + String(value) + ' cannot write an expense or inventory movement', async () => {
        const f = fixture(); f.add(); f.window.expenseCart[0][field] = value;
        const original = before(f); await f.run(); assert.deepEqual([...f.h.docs], original);
        assert.equal(f.directWrites.length, 0); assert.equal(f.elements.btnSubmitExpenseCart.disabled, false);
    });
}

for (const photoFailure of [false, true]) {
    test('optional photo ' + (photoFailure ? 'failure' : 'success') + ' still allows a complete expense transaction', async () => {
        const f = fixture({photo: true, photoFailure}); f.add(); await f.run(); assertSaved(f);
        assert.equal(f.uploads.length, 1);
        assert.equal(rows(f, 'expenses')[0].receiptPhoto, photoFailure ? null : 'https://example.test/fictional-receipt.jpg');
    });
}
