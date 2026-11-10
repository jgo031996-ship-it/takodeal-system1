import { createOutbox } from '/Takodeal-POS/pos-safety.js';
const databaseName = 'fictional-outbox-recovery-takodeal_sale_outbox_v2';
if (new URL(location.href).searchParams.has('child')) {
    const state = { handles: [], versions: [], forcedAborts: 0, holdAck: false, holdOpen: false, heldAcks: [], heldOpens: [], stall: false };
    let outbox;
    const wrapDb = db => new Proxy(db, {
        get(target, key) {
            if (key === 'transaction') return (...args) => {
                const tx = target.transaction(...args), abort = state.forcedAborts-- > 0, stall = state.stall; state.stall = false;
                if (abort) { const request = tx.objectStore('sales').get('__TEST__'); request.onsuccess = () => { target.dispatchEvent(new Event('close')); tx.abort(); }; }
                if (stall) { const keepAlive = () => { try { const request = tx.objectStore('sales').get('__KEEP_ALIVE__'); request.onsuccess = keepAlive; } catch {} }; keepAlive(); }
                return new Proxy(tx, {
                    get(value, prop) { const result = value[prop]; return typeof result === 'function' ? result.bind(value) : result; },
                    set(value, prop, callback) { if (prop === 'oncomplete') value[prop] = event => { if (state.holdAck) state.heldAcks.push(() => callback(event)); else callback(event); }; else value[prop] = callback; return true; }
                });
            };
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        }, set(target, key, value) { target[key] = value; return true; }
    });
    const adapter = { open(name, version) {
        if (name !== 'takodeal_sale_outbox_v2' || version !== 1) throw Error('Schema changed'); state.versions.push(version);
        const actual = indexedDB.open(databaseName, version); let proxy;
        return new Proxy(actual, {
            get(target, key) { if (key === 'result') { proxy ||= wrapDb(target.result); return proxy; } const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; },
            set(target, key, callback) { if (key === 'onsuccess') target[key] = event => { state.handles.push(target.result); if (state.holdOpen) state.heldOpens.push(() => callback(event)); else callback(event); }; else target[key] = callback; return true; }
        });
    } };
    outbox = createOutbox(adapter, { openTimeoutMs: 100, transactionTimeoutMs: 20 });
    addEventListener('message', async event => {
        if (event.origin !== location.origin || event.source !== parent) return;
        const { id, command, body } = event.data;
        try {
            let value;
            if (command === 'enqueue') value = await outbox.enqueue(body);
            else if (command === 'list') value = await outbox.list();
            else if (command === 'close') { state.handles.at(-1).close(); value = true; }
            else if (command === 'forceClose') { state.handles.at(-1).dispatchEvent(new Event('close')); value = true; }
            else if (command === 'abortNext') { state.forcedAborts = body; value = true; }
            else if (command === 'holdAck') { state.holdAck = body; value = true; }
            else if (command === 'releaseAck') { state.holdAck = false; for (const callback of state.heldAcks.splice(0)) callback(); value = true; }
            else if (command === 'stall') { state.stall = true; value = true; }
            else if (command === 'holdOpen') { state.holdOpen = body; if (body) { state.handles.at(-1)?.close(); outbox = createOutbox(adapter, { openTimeoutMs: 10, transactionTimeoutMs: 20 }); } value = true; }
            else if (command === 'releaseOpen') { state.holdOpen = false; for (const callback of state.heldOpens.splice(0)) callback(); value = true; }
            else if (command === 'stats') value = { opens: state.versions.length, versions: state.versions, heldAcks: state.heldAcks.length };
            else throw Error('Unknown synthetic command');
            parent.postMessage({ id, value }, location.origin);
        } catch (error) { parent.postMessage({ id, error: error.message, name: error.name }, location.origin); }
    });
    parent.postMessage({ ready: true, child: new URL(location.href).searchParams.get('child') }, location.origin);
} else {
    const checks = [], pending = new Map(), ready = new Map(); let sequence = 0;
    const assert = (value, name) => { if (!value) throw Error(name); checks.push(name); };
    addEventListener('message', event => { if (event.origin !== location.origin) return; if (event.data.ready) { ready.get(event.data.child)?.(); return; } const waiter = pending.get(event.data.id); if (!waiter) return; pending.delete(event.data.id); event.data.error ? waiter.reject(Object.assign(Error(event.data.error), { name: event.data.name })) : waiter.resolve(event.data.value); });
    const frame = async name => { const node = document.createElement('iframe'), loaded = new Promise(resolve => ready.set(name, resolve)); node.src = '/?child=' + name; document.body.append(node); await loaded; return node; };
    const call = (iframe, command, body) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); iframe.contentWindow.postMessage({ id, command, body }, location.origin); });
    const reject = async (work, test, label) => { try { await work; throw Error('Unexpected success'); } catch (error) { assert(test.test(error.name + ':' + error.message), label); } };
    const sale = id => ({ saleVersion: 2, saleId: id, receiptId: 'SAVED-' + id, branch: 'Fictional branch', cart: [{ name: 'Synthetic food', qty: 2 }], netTotal: 50, recipeSnapshot: [{ menuItem: 'Synthetic food', ingredientName: 'Synthetic ingredient', qty: 2 }], paymentMethod: 'Gcash', paymentVerified: false });
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        const [one, two] = await Promise.all([frame('one'), frame('two')]);
        await Promise.all([call(one, 'enqueue', sale('one')), call(two, 'enqueue', sale('two'))]);
        assert((await call(one, 'list')).length === 2, 'native concurrent connections preserve both exact sale IDs');
        const before = JSON.stringify(await call(one, 'list'));
        await call(one, 'close'); assert(JSON.stringify(await call(one, 'list')) === before, 'native closing handle reopens without changing queued receipts/recipes');
        await call(two, 'forceClose'); assert(JSON.stringify(await call(two, 'list')) === before, 'unexpected close event retires only its connection');
        await call(one, 'abortNext', 1); await call(one, 'enqueue', sale('three'));
        assert((await call(two, 'list')).filter(row => row.saleId === 'three').length === 1, 'confirmed native connection abort retries one immutable receipt once');
        await call(one, 'holdAck', true); let settled = false; const unknown = call(one, 'enqueue', sale('four')).then(result => { settled = true; return result; });
        const until = Date.now() + 2000; while (!(await call(one, 'stats')).heldAcks) { if (Date.now() > until) throw Error('Native commit ACK barrier missing'); await pause(5); }
        await pause(30); assert(settled === false, 'unknown native commit ACK remains physically held after deadline');
        assert((await call(two, 'list')).filter(row => row.saleId === 'four').length === 1, 'other native connection observes exactly one committed receipt while ACK is held');
        await call(one, 'releaseAck'); assert((await unknown).saleId === 'four', 'late actual commit completes the original receipt without replay');
        await call(one, 'stall'); await reject(call(one, 'enqueue', sale('aborted')), /AbortError|save.*locally/, 'deadline waits actual native abort and reports no success');
        assert(!(await call(two, 'list')).some(row => row.saleId === 'aborted'), 'confirmed deadline abort leaves no partial receipt');
        await call(one, 'holdOpen', true); await reject(call(one, 'list'), /did not open/, 'bounded open deadline does not reuse a stalled request');
        await call(one, 'releaseOpen'); assert((await call(one, 'list')).length === 4, 'late open closes its own handle and fresh open preserves all four receipts');
        await reject(call(two, 'enqueue', { ...sale('one'), netTotal: 1 }), /identity conflict/, 'business conflict remains a hold and never overwrites original receipt');
        assert((await call(two, 'stats')).versions.every(value => value === 1), 'production adapter requests only original schema version one');
        // Only this fictional test DB changes version to produce a real browser
        // versionchange event. The product never performs this upgrade.
        const upgraded = await new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('Product connections did not close on versionchange')); });
        const rows = await new Promise((resolve, reject) => { const tx = upgraded.transaction('sales', 'readonly'), request = tx.objectStore('sales').getAll(); request.onsuccess = () => resolve(request.result); tx.onerror = () => reject(tx.error); });
        assert(rows.length === 4, 'real native versionchange closes all cached product connections and retains receipts'); upgraded.close();
        await reject(call(one, 'list'), /VersionError/, 'unexpected external schema change holds without upgrade/delete/reset');
        await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passed: true, checks, nativeIndexedDB: true }) });
    } catch (error) { await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passed: false, checks, error: error.message }) }); }
}
