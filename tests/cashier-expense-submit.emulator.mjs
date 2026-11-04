// The real Cashier handler and Firebase SDK against unchanged compiled Rules.
// Every database endpoint is a fresh loopback-only demo emulator; Storage is stubbed.
import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import vm from 'node:vm';

const host = '127.0.0.1', port = 8874, projectId = 'demo-cashier-expense-submit';
const endpoint = host + ':' + port;
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== endpoint) {
    throw Error('Refusing a non-test Firestore endpoint.');
}
process.env.FIRESTORE_EMULATOR_HOST = endpoint;
const root = fileURLToPath(new URL('../', import.meta.url));
const tools = resolve(root, '../staff-nextlevel-tools');
const req = createRequire(resolve(tools, 'package.json'));
const {initializeTestEnvironment} = req('@firebase/rules-unit-testing');
const sdk = req('firebase/firestore');
sdk.setLogLevel('silent');
const {doc, setDoc, getDocFromServer, getDocsFromServer, collection} = sdk;
const java = JSON.parse(readFileSync(resolve(tools, 'runtime.json'))).java;
const jar = resolve(tools, 'emulators/cloud-firestore-emulator-v1.22.0.jar');
if (!existsSync(java) || !existsSync(jar)) throw Error('Local emulator runtime missing.');
let env, child, output = '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reachable = () => new Promise(resolve => {
    const socket = createConnection({host, port});
    socket.setTimeout(250);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
before(async () => {
    if (await reachable()) throw Error('Refusing an occupied emulator port.');
    child = spawn(java, ['-jar', jar, '--host', host, '--port', String(port), '--project_id', projectId], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', value => output = (output + value).slice(-16000));
    }
    const until = Date.now() + 30000;
    while (!await reachable()) {
        if (child.exitCode !== null || Date.now() > until) throw Error('Local emulator did not start: ' + output);
        await pause(100);
    }
    env = await initializeTestEnvironment({projectId, firestore: {
        host, port, rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8')
    }});
}, {timeout: 45000});
after(async () => {
    await env?.cleanup();
    if (child && child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, 'exit'), pause(3000)]);
    }
});
beforeEach(async () => { await env.clearFirestore(); });

const BRANCH = 'SAMPLE Expense Branch', SHIFT = 'sample-expense-shift', INVENTORY = 'sample-ice-30kg';
const PHOTO = 'https://example.invalid/sample-expense-receipt.png';
const shift = {
    branch: BRANCH, active: true, startTime: new Date('2026-11-04T00:00:00Z'), startingCash: 1000,
    expenses: 20, cashOut: 20, cashReconciliationVersion: 4, cashRemittanceRevision: 1,
    manualRemittanceCashOut: 0, lastCashRemittanceId: 'sample-previous-remittance'
};
const inventory = {branch: BRANCH, name: 'Ice Cubes30kg', currentStock: 100, cost: 2, uom: 'kg'};
const item = () => ({
    description: 'Restock: Ice Cubes30kg', cost: 150, displayQty: 1, baseQty: 30,
    displayUom: '30kg bag', isRestock: true, dbId: INVENTORY, dbName: 'Ice Cubes30kg', uom: 'kg'
});
const admin = callback => env.withSecurityRulesDisabled(context => callback(context.firestore()));
async function seed({missingInventory = false} = {}) {
    await admin(async db => {
        await setDoc(doc(db, 'shifts', SHIFT), shift);
        if (!missingInventory) await setDoc(doc(db, 'inventory', INVENTORY), inventory);
    });
}
async function financialState() {
    let state;
    await admin(async db => {
        const rows = async table => (await getDocsFromServer(collection(db, table))).docs
            .map(snap => ({id: snap.id, ...snap.data()})).sort((a, b) => a.id.localeCompare(b.id));
        state = {expenses: await rows('expenses'), logs: await rows('stock_logs'),
            inventory: await rows('inventory'), shifts: await rows('shifts')};
    });
    return state;
}

function fixture({fundSource = 'Drawer', photo = true, loseAck = false, invalidWrite = false, changeIdentityAfterCommit = false} = {}) {
    const source = readFileSync(resolve(root, 'Takodeal-POS/main.js'), 'utf8');
    const start = source.indexOf('window.submitExpenseCart = ');
    const end = source.indexOf('// --- LIVE CLOCK ENGINE ---', start);
    assert.ok(start >= 0 && end > start, 'extract the actual production submit handler');
    const db = env.authenticatedContext('sample-expense-tablet', {
        firebase: {sign_in_provider: 'anonymous'}
    }).firestore();
    const nodes = new Map(Object.entries({
        btnSubmitExpenseCart: {innerText: 'Submit All Expenses', disabled: false},
        expenseReceiptPhoto: {files: photo ? [{name: 'sample-expense-receipt.png', size: 100, type: 'image/png'}] : [], value: ''},
        expFundSource: {value: fundSource}, expenseModal: {style: {display: 'flex'}},
        expenseCartBody: {innerHTML: ''}, expenseCartTotal: {innerText: ''}
    }));
    const alerts = [], errors = [], uploads = [], transactions = [];
    const values = new Map([['takodeal_device_branch', BRANCH], ['cashierName', 'Sample Cashier']]);
    const localStorage = {
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key)
    };
    const window = {
        db, storage: {sample: true}, localStorage, expenseCart: [item()],
        renderExpenseCart() {}, crypto: globalThis.crypto
    };
    const context = {
        ...sdk, db, window, localStorage, document: {getElementById: id => nodes.get(id) ?? null},
        activeShiftDetails: {logId: SHIFT, branch: BRANCH},
        alert: message => alerts.push(String(message)),
        console: {error: (...args) => errors.push(args), warn() {}, log() {}},
        checkCurrentShift() {}, crypto: globalThis.crypto, structuredClone,
        ref: (_storage, path) => ({path}),
        uploadBytes: async (reference, file) => { uploads.push({reference, file}); return {ref: reference}; },
        getDownloadURL: async () => PHOTO,
        runTransaction: async (database, callback, options) => {
            let pendingWrites = [];
            const result = await sdk.runTransaction(database, async tx => {
                pendingWrites = [];
                const wrapped = {
                    get: tx.get.bind(tx),
                    set(reference, data, ...rest) {
                        pendingWrites.push(reference.path);
                        tx.set(reference, invalidWrite && reference.path.startsWith('stock_logs/')
                            ? {...data, invalidSampleValue: undefined} : data, ...rest);
                        return wrapped;
                    },
                    update(reference, ...rest) { pendingWrites.push(reference.path); tx.update(reference, ...rest); return wrapped; },
                    delete(reference) { pendingWrites.push(reference.path); tx.delete(reference); return wrapped; }
                };
                return callback(wrapped);
            }, options);
            transactions.push(pendingWrites);
            if (changeIdentityAfterCommit) {
                changeIdentityAfterCommit = false;
                values.set('takodeal_device_branch', 'SAMPLE Other Branch');
            }
            if (loseAck) { loseAck = false; throw Error('Synthetic acknowledgement lost after local emulator commit'); }
            return result;
        }
    };
    // Keep the handler and SDK in one JavaScript realm: the real SDK correctly
    // rejects plain objects from foreign VM realms as custom objects.
    vm.compileFunction(source.slice(start, end), Object.keys(context), {
        filename: 'actual-cashier-expense-handler.js'
    })(...Object.values(context));
    return {window, nodes, alerts, errors, uploads, transactions,
        submit: () => window.submitExpenseCart(), clearInvalidWrite: () => { invalidWrite = false; },
        restoreIdentity: () => { values.set('takodeal_device_branch', BRANCH); }};
}

function assertRestock(state, {fundSource = 'Drawer', photo = true} = {}) {
    assert.equal(state.expenses.length, 1, 'one expense document');
    assert.equal(state.logs.length, 1, 'one matching stock log');
    assert.equal(state.expenses[0].amount, 150);
    assert.equal(state.expenses[0].branch, BRANCH);
    assert.equal(state.expenses[0].paidFrom, fundSource);
    assert.equal(state.expenses[0].shiftId, fundSource === 'Drawer' ? SHIFT : 'Manager_Fund');
    assert.equal(state.expenses[0].receiptPhoto, photo ? PHOTO : null);
    assert.equal(state.logs[0].inventoryId, INVENTORY, 'cart dbId is used by the persisted log');
    assert.equal(state.logs[0].oldQty, 100);
    assert.equal(state.logs[0].newQty, 130);
    assert.equal(state.logs[0].variance, 30);
    assert.equal(state.inventory[0].currentStock, 130);
    assert.ok(Math.abs(state.inventory[0].cost - 350 / 130) < 1e-10);
    assert.equal(state.shifts[0].expenses, fundSource === 'Drawer' ? 170 : 20);
    assert.equal(state.shifts[0].cashOut, fundSource === 'Drawer' ? 170 : 20);
    assert.equal(state.shifts[0].cashRemittanceRevision, 1, 'service checkpoint is preserved');
}

test('actual Cashier restock plus receipt photo commits expense, correct stock log, stock and drawer atomically', async () => {
    await seed();
    const f = fixture();
    await f.submit();
    assert.equal(f.errors.length, 0, f.errors.flat().map(value => value?.message || String(value)).join('\n'));
    assertRestock(await financialState());
    assert.equal(f.uploads.length, 1);
    assert.equal(f.nodes.get('expenseModal').style.display, 'none');
    assert.equal(f.transactions.length, 1);
    assert.equal(f.transactions[0].length, 4, 'all four affected documents use one transaction');
    assert.equal(f.window.expenseCart.length, 0, 'successful cart is cleared');
    assert.equal(f.nodes.get('btnSubmitExpenseCart').disabled, false);
});

test('actual Manager Fund restock commits inventory and expense while leaving the drawer unchanged', async () => {
    await seed();
    const f = fixture({fundSource: 'Manager Fund', photo: false});
    await f.submit();
    assertRestock(await financialState(), {fundSource: 'Manager Fund', photo: false});
    assert.equal(f.uploads.length, 0);
    assert.equal(f.transactions.length, 1);
    assert.equal(f.transactions[0].some(path => path.startsWith('shifts/')), false);
});

test('retry after a lost real commit acknowledgement creates no duplicate expense, stock or drawer movement', async () => {
    await seed();
    const f = fixture({loseAck: true});
    await f.submit();
    const committed = await financialState();
    assertRestock(committed);
    assert.equal(f.window.expenseCart.length, 1, 'failed acknowledgement keeps the retryable cart');
    await f.submit();
    assert.deepEqual(await financialState(), committed, 'retry recognizes the committed operation');
    assert.equal(f.uploads.length, 1, 'retry retains the confirmed photo');
    assert.equal(f.window.expenseCart.length, 0);
});

test('identity changing after the real commit retains its retry identity and cannot duplicate a restored cart', async () => {
    await seed();
    const f = fixture({changeIdentityAfterCommit: true});
    await f.submit();
    const committed = await financialState();
    assertRestock(committed);
    assert.equal(f.window.expenseCart.length, 1);
    f.restoreIdentity();
    await f.submit();
    assert.deepEqual(await financialState(), committed);
    assert.equal(f.uploads.length, 1);
    assert.equal(f.window.expenseCart.length, 0);
});

test('validation of an edited uncertain cart preserves its committed retry identity when the original cart is restored', async () => {
    await seed();
    const f = fixture({loseAck: true});
    await f.submit();
    const committed = await financialState();
    assertRestock(committed);
    f.window.expenseCart[0].cost = 151;
    await f.submit();
    assert.deepEqual(await financialState(), committed, 'edited uncertain cart cannot post another operation');
    f.window.expenseCart[0].cost = 150;
    await f.submit();
    assert.deepEqual(await financialState(), committed, 'restored original cart recognizes its saved operation');
    assert.equal(f.uploads.length, 1);
    assert.equal(f.window.expenseCart.length, 0);
});

test('real SDK rejects an invalid staged stock log without leaving a partial expense or inventory movement', async () => {
    await seed();
    const before = await financialState();
    const f = fixture({invalidWrite: true});
    await f.submit();
    assert.deepEqual(await financialState(), before);
    assert.equal(f.window.expenseCart.length, 1);
    assert.equal(f.nodes.get('btnSubmitExpenseCart').disabled, false);
    assert.ok(f.errors.some(args => args.some(error => error?.code === 'invalid-argument')));
    f.clearInvalidWrite();
    await f.submit();
    assertRestock(await financialState());
});

test('a missing inventory record rejects the actual restock before any expense, drawer or log is saved', async () => {
    await seed({missingInventory: true});
    const before = await financialState();
    const f = fixture();
    await f.submit();
    assert.deepEqual(await financialState(), before);
    assert.equal(f.window.expenseCart.length, 1);
    assert.equal(f.errors.length, 1);
    assert.equal(f.nodes.get('btnSubmitExpenseCart').disabled, false);
});
