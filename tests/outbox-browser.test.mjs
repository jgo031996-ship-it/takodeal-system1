import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let server, browser, first, second;
before(async () => {
    server = http.createServer((req, res) => {
        if (req.url === '/') return res.end('<!doctype html><div id="liveClock"></div><div></div>');
        const file = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
        try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/plain'); res.end(readFileSync(file)); }
        catch { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, ...(process.env.POS_BROWSER_EXECUTABLE ? { executablePath: process.env.POS_BROWSER_EXECUTABLE } : {}) });
    const context = await browser.newContext();
    first = await context.newPage(); second = await context.newPage();
    for (const page of [first, second]) {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async () => { window.outbox = (await import('/Takodeal-POS/pos-safety.js')).createOutbox(); });
    }
});
after(async () => { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); });
test('two real browser tabs enqueue concurrently without losing sales', async () => {
    await Promise.all([first, second].map((page, tab) => page.evaluate(async tab => {
        await Promise.all(Array.from({ length: 12 }, (_, n) => outbox.enqueue({ saleId: `tab${tab}-${n}`, receiptId: `R${tab}-${n}`, branch: 'Cabantian' })));
    }, tab)));
    assert.equal(await first.evaluate(async () => (await outbox.list()).length), 24);
});
test('two real browser tabs claim the same sale only once', async () => {
    const claims = await Promise.all([first.evaluate(() => outbox.claim('tab0-0', 'A', 1000)), second.evaluate(() => outbox.claim('tab0-0', 'B', 1000))]);
    assert.equal(claims.filter(Boolean).length, 1);
});
test('an expired claim recovers after a crashed tab; old owner cannot release it', async () => {
    assert.ok(await second.evaluate(() => outbox.claim('tab0-0', 'B', 70000)));
    await first.evaluate(() => outbox.release('tab0-0', 'A'));
    assert.equal(await first.evaluate(async () => (await outbox.list()).find(r => r.saleId === 'tab0-0').owner), 'B');
});
test('acknowledging a sale preserves a concurrently appended sale', async () => {
    await Promise.all([first.evaluate(() => outbox.acknowledge('tab0-1')), second.evaluate(() => outbox.enqueue({ saleId: 'new-sale', receiptId: 'NEW', branch: 'Maa' }))]);
    const rows = await first.evaluate(() => outbox.list());
    assert.ok(rows.some(r => r.saleId === 'new-sale')); assert.ok(!rows.some(r => r.saleId === 'tab0-1'));
});
test('pending sales survive an actual page reload', async () => {
    await first.reload();
    assert.equal(await first.evaluate(async () => (await (await import('/Takodeal-POS/pos-safety.js')).createOutbox().list()).length), 24);
});
async function checkout(page, mode) {
    return page.evaluate(async mode => {
        const { installSaleSafety } = await import('/Takodeal-POS/pos-checkout.js');
        const values = new Map([['takodeal_device_branch', 'Cabantian'], ['cashierName', 'Cashier']]);
        if (mode === 'legacy') {
            values.set('takodeal_offline_queue', '[{"receiptId":"OLD-SALE","cart":[]}]');
            values.set('takodeal_audit_queue', '{"Batter":12}');
        }
        const w = { addEventListener() {}, cart: [{ name: '6 Pcs Takoyaki', qty: 1 }], masterPOSData: { bom: [{ menuItem: '6 Pcs Takoyaki', ingredientName: 'Batter', qty: 6 }] } };
        const environment = { window: w, crypto, navigator: { onLine: false },
            localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
            indexedDB: mode === 'unavailable' ? undefined : mode === 'quota' ? { open() { throw new Error('Quota exceeded'); } } : indexedDB,
            document, setTimeout() {}, setInterval() {} };
        installSaleSafety({}, environment);
        const input = { branch: 'Cabantian', cart: w.cart, netTotal: mode === 'zero' ? 0 : 50, paymentMethod: 'Cash' };
        if (mode === 'ui-error') {
            const original = document.getElementById.bind(document); let calls = 0;
            environment.document = { addEventListener() {}, getElementById(id) { if (++calls > 1) throw new Error('UI unavailable'); return original(id); } };
        }
        const result = await w.processCheckout(input);
        const rows = result.status === 'queued' ? await w.saleOutbox.list() : [];
        if (mode === 'freeze') w.cart[0].qty = 999;
        return { status: result.status, receiptId: result.receiptId, cartSize: w.cart.length, error: result.error,
            saved: rows.find(r => r.saleId === result.saleId)?.payload,
            legacyQueue: values.get('takodeal_offline_queue'), legacyAudit: values.get('takodeal_audit_queue'),
            needsReview: w.offlineQueue.some(p => p.needsReconciliation) };
    }, mode);
}
test('unavailable storage fails without an invented receipt or cleared cart', async () => {
    const r = await checkout(second, 'unavailable');
    assert.equal(r.status, 'failed'); assert.equal(r.receiptId, undefined); assert.equal(r.cartSize, 1);
});
test('storage quota failure fails without an invented receipt', async () => {
    const r = await checkout(second, 'quota');
    assert.equal(r.status, 'failed'); assert.equal(r.receiptId, undefined); assert.match(r.error, /Quota/);
});
test('offline checkout reports queued only after saving in real IndexedDB', async () => {
    const r = await checkout(second, 'offline');
    assert.equal(r.status, 'queued'); assert.equal(r.saved.receiptId, r.receiptId);
});
test('optional UI failure after local commit still reports safely queued', async () => {
    const r = await checkout(second, 'ui-error');
    assert.equal(r.status, 'queued'); assert.equal(r.saved.receiptId, r.receiptId);
});
test('old sale and audit queues remain unchanged and visible for reconciliation', async () => {
    const r = await checkout(second, 'legacy');
    assert.equal(r.legacyQueue, '[{"receiptId":"OLD-SALE","cart":[]}]');
    assert.equal(r.legacyAudit, '{"Batter":12}'); assert.equal(r.needsReview, true);
});
test('cart changes after queuing cannot change the saved quantities or recipe', async () => {
    const r = await checkout(second, 'freeze');
    assert.equal(r.saved.cart[0].qty, 1); assert.equal(r.saved.recipeSnapshot[0].qty, 6);
});
test('zero total checkout remains zero and queues safely', async () => {
    const r = await checkout(second, 'zero');
    assert.equal(r.status, 'queued'); assert.equal(r.saved.netTotal, 0);
});
test('existing checkout UI retains failed carts and shows receipts for safely queued sales', async () => {
    const html = readFileSync(resolve(root, 'Takodeal-POS/index.html'), 'utf8');
    const start = html.indexOf('    window.submitFinalOrder = async function()');
    const end = /^    };\r?$/m.exec(html.slice(start));
    assert.ok(start >= 0 && end);
    const fn = html.slice(start, start + end.index + end[0].length);
    for (const status of ['failed', 'queued']) {
        const result = await second.evaluate(async ({ fn, status }) => {
            document.body.innerHTML = '<button id="btnSubmitFinal"></button><select id="checkoutDiscountType"><option value="none">None</option></select><input id="finalCustomerName" value="Guest"><input id="mainOrderType" value="Dine-In"><input id="checkoutDiscountValue"><input id="checkoutDiscountReason"><div id="receiptModal" style="display:none"></div>' +
                ['rcptId', 'rcptDate', 'rcptTime', 'rcptTotal', 'rcptPaid', 'rcptChange'].map(id => `<div id="${id}"></div>`).join('');
            window.cart = [{ name: '6 Pcs Takoyaki', qty: 1 }];
            window.sessionUser = { branch: 'Cabantian', cashierName: 'Cashier' };
            window.currentGrandTotal = 50; window.finalCheckoutAmount = 50;
            window.amountReceivedStr = '100'; window.selectedPaymentMethod = 'Cash';
            window.isSubmittingOrder = false; window.renderCart = () => {}; window.closeModal = () => {};
            window.updateReceiptSyncStatus = () => {};
            window.processCheckout = async payload => ({ status, receiptId: status === 'queued' ? 'SAVED-123' : undefined, payload, error: 'Local save failed' });
            window.alert = text => { window.lastAlert = text; };
            (0, eval)(fn);
            await window.submitFinalOrder();
            return { cartSize: window.cart.length, receiptVisible: document.getElementById('receiptModal').style.display === 'flex', locked: window.isSubmittingOrder, receiptId: document.getElementById('rcptId').innerText };
        }, { fn, status });
        assert.equal(result.cartSize, status === 'failed' ? 1 : 0);
        assert.equal(result.receiptVisible, status === 'queued');
        assert.equal(result.locked, false);
        if (status === 'queued') assert.ok(result.receiptId.includes('SAVED-123'));
    }
});
test('universal signature pad still supports receipt, sanction and bulletin canvases', async () => {
    const main = readFileSync(resolve(root, 'Takodeal-POS/main.js'), 'utf8');
    const block = name => {
        const start = main.indexOf('window.' + name + ' = function');
        const end = /^};\r?$/m.exec(main.slice(start));
        return main.slice(start, start + end.index + end[0].length);
    };
    for (const canvasId of ['sigCanvas', 'signatureCanvas', 'bulletinCanvas']) {
        const result = await second.evaluate(({ init, clear, canvasId }) => {
            document.body.innerHTML = `<canvas id="${canvasId}" style="width:300px;height:150px"></canvas>`;
            (0, eval)(init); (0, eval)(clear);
            window.initSignaturePad();
            const canvas = document.getElementById(canvasId);
            canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 20 }));
            canvas.dispatchEvent(new MouseEvent('mouseup'));
            const signed = canvasId === 'signatureCanvas' ? window.hasSignedNTE : window.hasSignedBulletin;
            window.clearSignature();
            return { signed, cleared: !window.hasSignedNTE && !window.hasSignedBulletin && window.isSignatureBlank };
        }, { init: block('initSignaturePad'), clear: block('clearSignature'), canvasId });
        assert.equal(result.signed, true); assert.equal(result.cleared, true);
    }
});

test('permission failure persists two receipts; recovery uploads them once with exact stock', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const source = readFileSync(resolve(root, 'tests/pos-safety.test.mjs'), 'utf8');
        const harness = source.slice(source.indexOf('export function firestoreHarness()'), source.indexOf('\nconst bom =')).replace('export function', 'function');
        const result = await page.evaluate(async harness => {
            const assert = { equal(a, b, message) { if (a !== b) throw new Error(message || `${a} !== ${b}`); } };
            const h = eval(`(${harness})`)();
            let denied = true;
            const transaction = h.api.runTransaction;
            h.api.runTransaction = async (...args) => {
                if (denied) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
                return transaction(...args);
            };
            h.put('inventory/batter', { branch: 'Main Office', name: 'Batter', currentStock: 100 });
            const values = new Map([['takodeal_device_branch', 'Main Office'], ['cashierName', 'Cashier']]);
            const w = { addEventListener() {}, masterPOSData: { bom: [{ menuItem: '6 Pcs Takoyaki', ingredientName: 'Batter', qty: 6 }] } };
            const { installSaleSafety } = await import('/Takodeal-POS/pos-checkout.js');
            installSaleSafety(h.api, { window: w, crypto, indexedDB, navigator: { onLine: true }, document,
                localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
                setTimeout() {}, setInterval() {} });
            const idle = async () => {
                for (let n = 0; w.isSyncing && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 10));
                if (w.isSyncing) throw new Error('Sync did not finish');
            };
            const ids = [];
            for (let n = 0; n < 2; n++) {
                const saved = await w.processCheckout({ branch: 'Main Office', shiftId: 'S1', paymentMethod: 'Cash',
                    cart: [{ name: '6 Pcs Takoyaki', qty: 1 }], netTotal: 125 });
                ids.push(saved.saleId); await idle();
            }
            const held = await w.saleOutbox.list();
            const heldStock = h.get('inventory/batter').currentStock;
            denied = false;
            await w.syncOfflineQueue(); await w.syncOfflineQueue();
            const after = await w.saleOutbox.list();
            return { held: held.length, errors: held.map(r => r.syncError?.code), heldStock,
                uploaded: ids.map(id => h.get('transactions/' + id)?.receiptId), after: after.length,
                stock: h.get('inventory/batter').currentStock, count: h.get('settings/global_stats').totalTakoyakiBalls,
                statsSale: h.get('settings/global_stats').lastSaleId, ids };
        }, harness);
        assert.equal(result.held, 2); assert.deepEqual(result.errors, ['permission-denied', 'permission-denied']);
        assert.equal(result.heldStock, 100); assert.equal(result.after, 0);
        assert.equal(new Set(result.uploaded).size, 2); assert.ok(result.uploaded.every(Boolean));
        assert.equal(result.stock, 88); assert.equal(result.count, 12); assert.ok(result.ids.includes(result.statsSale));
    } finally { await page.close(); }
});

test('Shift Sales renders durable pending receipts, escapes errors and excludes them from confirmed totals', async () => {
    const html = readFileSync(resolve(root, 'Takodeal-POS/index.html'), 'utf8');
    const start = html.indexOf('window.loadSalesDashboard = async function');
    const end = html.indexOf('\n};', start) + 3;
    const result = await second.evaluate(async fn => {
        const { mergePendingSales } = await import('/Takodeal-POS/pos-checkout.js');
        document.body.innerHTML = '<table><tbody id="tbTransBody"></tbody></table>';
        window.currentShift = { active: true, shiftId: 'S1', startTime: new Date('2026-10-03T00:00:00Z') };
        window.sessionUser = { branch: 'Main Office' };
        window.getSalesDashboardData = async () => [];
        window.query = (...args) => args; window.collection = (...args) => args; window.where = (...args) => args;
        window.getDocs = async () => ({ forEach() {} }); window.mergePendingSales = mergePendingSales;
        window.getPendingSales = async () => [{ saleId: 'sale-pending', receiptId: 'R-PENDING', branch: 'Main Office',
            shiftId: 'S1', localTimestamp: '2026-10-03T05:48:00Z', netTotal: 125, paymentMethod: 'GCash',
            syncError: { message: '<img src=x onerror="window.injected=true"> Missing permissions' } }];
        eval(fn); await window.loadSalesDashboard();
        return { text: document.body.textContent, markup: document.body.innerHTML,
            buttons: document.querySelectorAll('button.dot-menu').length, images: document.querySelectorAll('img').length };
    }, html.slice(start, end));
    assert.match(result.text, /R-PENDING/); assert.match(result.text, /Pending Sync/);
    assert.match(result.text, /Missing permissions/); assert.match(result.text, /GCash: ₱0.00/);
    assert.equal(result.images, 0); assert.equal(result.buttons, 0);
});

test('receipt distinguishes local acceptance from confirmed upload without rendering error HTML', async () => {
    const html = readFileSync(resolve(root, 'Takodeal-POS/index.html'), 'utf8');
    const start = html.indexOf('    window.updateReceiptSyncStatus = function');
    const end = html.indexOf('\n    };', start) + '\n    };'.length;
    const result = await second.evaluate(fn => {
        document.body.innerHTML = '<span id="receiptSyncHeading"></span><span id="receiptSyncStatus"></span><div id="receiptSyncExplanation"></div>';
        eval(fn);
        window.updateReceiptSyncStatus('queued', '<img src=x> Missing or insufficient permissions.');
        const queued = document.body.textContent;
        const images = document.querySelectorAll('img').length;
        window.updateReceiptSyncStatus('committed');
        return { queued, images, uploaded: document.body.textContent };
    }, html.slice(start, end));
    assert.match(result.queued, /Saved locally/); assert.match(result.queued, /Missing or insufficient permissions/);
    assert.equal(result.images, 0); assert.match(result.uploaded, /Payment Completed — Uploaded/);
});
