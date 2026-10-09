const ROLES = ['main', 'kitchen', 'bar'];
const uuid16 = value => `0000${value}-0000-1000-8000-00805f9b34fb`;
// Receipt data endpoints, rather than the first writable setting or status channel.
const PROFILES = [
    {service: uuid16('18f0'), write: [uuid16('2af1')]},
    {service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', write: ['bef8d6c9-9c21-4c9e-b632-bd58c1009f9f']},
    {service: uuid16('ae30'), write: [uuid16('ae01')]},
    {service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', write: ['49535343-8841-43f4-a8d4-ecbe34729bb3']},
    {service: uuid16('fff0'), write: [uuid16('fff2')]},
    {service: uuid16('ff00'), write: [uuid16('ff02')]},
    {service: uuid16('ffe0'), write: [uuid16('ffe1')]},
    {service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: ['6e400002-b5a3-f393-e0a9-e50e24dcca9e']}
];
const SERVICES = PROFILES.map(profile => profile.service);
const canWrite = character => !!character && (
    (character.properties?.write && (typeof character.writeValueWithResponse === 'function' || typeof character.writeValue === 'function')) ||
    (character.properties?.writeWithoutResponse && typeof character.writeValueWithoutResponse === 'function')
);

export function printerMode(storage) {
    try { return storage.getItem('takodeal_printer_mode') === 'rawbt' ? 'rawbt' : 'ble'; } catch { return 'ble'; }
}

export function rawBtIntent(data, encode = value => btoa(value)) {
    const bytes = new Uint8Array(data);
    if (!bytes.length || bytes.length > 131072) throw new Error('This print job is too large for the Android print bridge. Reduce the receipt logo size.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 4096) binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
    return `intent:base64,${encode(binary)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

export function receiptLogoDimensions({width, height, scaleWidth = 1, scaleHeight = 1, paperSize = '58mm'}) {
    if (!(width > 0 && height > 0)) throw new Error('The receipt logo has no usable dimensions.');
    const maxWidth = paperSize === '80mm' ? 576 : 384;
    const x = Math.max(0.25, Math.min(3, Number(scaleWidth) || 1));
    const y = Math.max(0.25, Math.min(3, Number(scaleHeight) || 1));
    const targetWidth = Math.max(8, Math.floor(Math.min(maxWidth, 200 * x) / 8) * 8);
    // Keep large uploaded logos from overflowing inexpensive 58mm printer buffers.
    const targetHeight = Math.max(1, Math.min(576, Math.round(height / width * targetWidth * y)));
    return {width: targetWidth, height: targetHeight};
}

export function createPrinterConnections({bluetooth, storage, onState = () => {}, visible = () => true, schedule = setTimeout, cancel = clearTimeout, connectionTimeout = 16000}) {
    const devices = new Map(), characters = new Map(), pending = new Map(), listeners = new WeakSet();
    const states = new Map(), failures = new Map(), generations = new Map(), rolePending = new Map();
    let retryTimer = null, stopped = false;
    const savedId = role => { try { return storage.getItem(`takodeal_printer_${role}_id`); } catch { return null; } };
    const enabled = () => !stopped && printerMode(storage) === 'ble';
    function state(role, status, error = '') {
        const character = characters.get(role);
        states.set(role, {status, name: devices.get(role)?.name || '', error, service: character?.service?.uuid || '', endpoint: character?.uuid || ''});
        onState(role, {...states.get(role), character: character || null});
    }
    function ready(role) {
        const device = devices.get(role), character = characters.get(role);
        return device?.gatt?.connected && character?.service?.device === device && canWrite(character) ? character : null;
    }
    function bounded(promise, message) {
        return new Promise((resolve, reject) => {
            const timer = schedule(() => { const error = new Error(message); error.code = 'printer-timeout'; reject(error); }, connectionTimeout);
            Promise.resolve(promise).then(resolve, reject).finally(() => cancel(timer));
        });
    }
    function retry() {
        if (retryTimer !== null || !enabled() || !visible()) return;
        const roles = ROLES.filter(role => (savedId(role) || devices.has(role)) && !ready(role) && states.get(role)?.status !== 'unsupported');
        if (!roles.length) return;
        const attempts = Math.max(...roles.map(role => failures.get(role) || 0));
        const delay = Math.min(30000, 2000 * 2 ** Math.min(attempts, 4));
        retryTimer = schedule(() => { retryTimer = null; return reconnect(); }, delay);
    }
    function listen(device) {
        if (listeners.has(device)) return;
        listeners.add(device);
        device.addEventListener('gattserverdisconnected', () => {
            for (const role of ROLES) if (devices.get(role) === device) {
                characters.delete(role);
                state(role, 'reconnecting');
            }
            retry();
        });
    }
    async function discover(device) {
        if (!device.gatt) throw unsupported('This printer does not expose a browser Bluetooth connection. For a JP-58H using Classic Bluetooth, select Android print bridge in Printer Hub.');
        const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
        let services;
        try { services = await server.getPrimaryServices(); }
        catch (error) {
            if (error.name === 'SecurityError') throw unsupported('Printer service permission is missing. Use Search again to select the printer with the updated connection settings.');
            throw error;
        }
        const candidates = [];
        for (const service of services) {
            const profile = PROFILES.find(candidate => candidate.service === String(service.uuid || '').toLowerCase());
            if (!profile) continue;
            const list = await service.getCharacteristics();
            const recognized = list.find(character => profile.write.includes(String(character.uuid || '').toLowerCase()) && canWrite(character));
            if (recognized) return recognized;
            const writable = list.filter(canWrite);
            // A single writer on a recognized printer service can be a firmware variant.
            // Ambiguous channels need a supported endpoint; do not silently send to settings.
            if (writable.length === 1) candidates.push(writable[0]);
        }
        if (candidates.length === 1) return candidates[0];
        throw unsupported('No supported receipt data channel was found. Use Search again, or Android print bridge for a Classic Bluetooth JP-58H.');
    }
    function unsupported(message) { const error = new Error(message); error.code = 'printer-unsupported'; return error; }
    async function establish(role, device, generation) {
        devices.set(role, device);
        listen(device);
        if (ready(role)) return ready(role);
        state(role, 'connecting');
        let link = pending.get(device);
        if (!link) {
            link = bounded(discover(device), 'Printer connection timed out. Keep it powered on, close other printing apps, then use Search again.');
            pending.set(device, link);
        }
        try {
            const character = await link;
            if (generations.get(role) !== generation || devices.get(role) !== device || !device.gatt.connected) throw new Error('The printer connection changed while connecting. Try again.');
            characters.set(role, character);
            failures.set(role, 0);
            try { storage.setItem(`takodeal_printer_${role}_id`, device.id); } catch { /* Keep the authorized device for this session. */ }
            state(role, 'connected');
            return character;
        } finally { if (pending.get(device) === link) pending.delete(device); }
    }
    function connect(role, {choose = false, replace = false} = {}) {
        if (!ROLES.includes(role)) return Promise.reject(new Error('Unknown printer role.'));
        if (rolePending.has(role)) return rolePending.get(role);
        const generation = (generations.get(role) || 0) + 1;
        generations.set(role, generation);
        const attempt = (async () => {
            if (!enabled()) throw new Error('Direct Bluetooth printing is not enabled.');
            if (!bluetooth) throw unsupported('This browser does not support direct Bluetooth. On Android, select Android print bridge in Printer Hub.');
            if (!replace && ready(role)) return ready(role);
            let device = replace ? null : devices.get(role);
            // Explicit replacement opens the chooser immediately in the button gesture.
            if (replace && choose && bluetooth.requestDevice) device = await bluetooth.requestDevice({acceptAllDevices: true, optionalServices: SERVICES});
            if (!device && !replace && savedId(role) && bluetooth.getDevices) {
                const allowed = await bounded(bluetooth.getDevices(), 'Reading the saved printer timed out. Use Search again.');
                device = allowed.find(candidate => candidate.id === savedId(role));
            }
            // Background recovery never opens the browser's pairing chooser.
            if (!device && choose && bluetooth.requestDevice) device = await bluetooth.requestDevice({acceptAllDevices: true, optionalServices: SERVICES});
            if (!device) throw new Error(savedId(role) ? 'Tap Search again to restore permission for the saved printer.' : 'Connect this printer once in Printer Hub.');
            return await establish(role, device, generation);
        })().catch(error => {
            characters.delete(role);
            failures.set(role, (failures.get(role) || 0) + 1);
            state(role, error.code === 'printer-unsupported' ? 'unsupported' : savedId(role) || devices.has(role) ? 'reconnecting' : 'not-connected', error.message);
            retry();
            throw error;
        }).finally(() => rolePending.delete(role));
        rolePending.set(role, attempt);
        return attempt;
    }
    async function reconnect() {
        if (!enabled() || !visible()) return;
        if (retryTimer !== null) { cancel(retryTimer); retryTimer = null; }
        for (const role of ROLES) if ((savedId(role) || devices.has(role)) && !ready(role) && states.get(role)?.status !== 'unsupported') {
            try { await connect(role); } catch { /* Retain pairing and retry with backoff. */ }
        }
        retry();
    }
    return {
        connect, reconnect, ready,
        snapshot(role) { return {...(states.get(role) || {status: savedId(role) ? 'saved' : 'not-connected'}), connected: !!ready(role)}; },
        invalidate(role, {disconnect = false} = {}) {
            const device = devices.get(role);
            for (const linked of ROLES) if (linked === role || device && devices.get(linked) === device) { characters.delete(linked); state(linked, 'reconnecting'); }
            if (disconnect) { try { device?.gatt?.disconnect?.(); } catch { /* Keep the failed connection visible for manual recovery. */ } }
            retry();
        },
        stop() { stopped = true; if (retryTimer !== null) cancel(retryTimer); retryTimer = null; },
        pause() { if (retryTimer !== null) cancel(retryTimer); retryTimer = null; }
    };
}

export function createPrinterWriter(connections, {wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), schedule = setTimeout, cancel = clearTimeout, writeTimeout = 6000} = {}) {
    let queue = Promise.resolve();
    function boundedWrite(promise) {
        return new Promise((resolve, reject) => {
            const timer = schedule(() => { const error = new Error('The printer did not finish accepting data. Check the paper before reprinting.'); error.code = 'printer-write-timeout'; reject(error); }, writeTimeout);
            Promise.resolve(promise).then(resolve, reject).finally(() => cancel(timer));
        });
    }
    function send(data, role = 'main', {fallback = true, pauseAfterBytes = [], bandDelay = 120} = {}) {
        const buffer = new Uint8Array(data);
        // These are encoder-supplied packet ends, not command bytes inferred from image data.
        // Copy them when enqueuing so another job cannot change the pending receipt's pacing.
        const boundaries = Array.isArray(pauseAfterBytes) && pauseAfterBytes.length <= 256 ? Array.from(pauseAfterBytes) : null;
        if (!boundaries
            || !Number.isSafeInteger(bandDelay) || bandDelay < 0 || bandDelay > 500
            || boundaries.some((offset, index) => !Number.isSafeInteger(offset) || offset <= 0
                || offset > buffer.length || (index > 0 && offset <= boundaries[index - 1]))) {
            const error = new Error('The receipt logo pacing settings are invalid. No printer data was sent.');
            error.code = 'printer-pacing-invalid';
            return Promise.reject(error);
        }
        const job = queue.then(async () => {
            let character;
            try { character = await connections.connect(role); }
            catch (error) {
                if (role === 'main' || !fallback) throw error;
                character = await connections.connect('main');
                role = 'main';
            }
            let bytesWritten = 0, bytesAttempted = 0, boundaryIndex = 0;
            try {
                for (let offset = 0; offset < buffer.length;) {
                    if (!connections.ready(role)) throw new Error('The printer disconnected while printing.');
                    const nextBoundary = boundaries[boundaryIndex];
                    const end = Math.min(offset + 20, nextBoundary ?? buffer.length, buffer.length);
                    const chunk = buffer.slice(offset, end);
                    bytesAttempted += chunk.length;
                    // Prefer acknowledged writes where the endpoint supports them.
                    const method = character.properties.write && typeof character.writeValueWithResponse === 'function'
                        ? 'writeValueWithResponse' : character.properties.write && typeof character.writeValue === 'function'
                            ? 'writeValue' : 'writeValueWithoutResponse';
                    await boundedWrite(character[method](chunk));
                    bytesWritten += chunk.length;
                    offset = end;
                    await wait(method === 'writeValueWithoutResponse' ? 25 : 5);
                    if (offset === nextBoundary) {
                        boundaryIndex++;
                        if (bandDelay > 0) await wait(bandDelay);
                    }
                }
                await wait(120);
                return true;
            } catch (error) {
                connections.invalidate(role, {disconnect: error.code === 'printer-write-timeout'});
                error.bytesWritten = bytesWritten;
                error.bytesAttempted = bytesAttempted;
                // A timed-out write may have reached the printer even without acknowledgement.
                // Never replay automatically: a receipt or drawer pulse could be duplicated.
                throw error;
            }
        });
        queue = job.catch(() => {});
        return job;
    }
    return {send};
}
