const ROLES = ['main', 'kitchen', 'bar'];
const SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000ae30-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455'];

export function createPrinterConnections({bluetooth, storage, onState = () => {}, visible = () => true, schedule = setTimeout, cancel = clearTimeout}) {
    const devices = new Map(), characters = new Map(), pending = new Map(), listeners = new WeakSet();
    const states = new Map(), failures = new Map();
    let retryTimer = null, stopped = false;
    const savedId = role => { try { return storage.getItem(`takodeal_printer_${role}_id`); } catch { return null; } };
    const mode = () => { try { return storage.getItem('takodeal_printer_mode') || 'ble'; } catch { return 'ble'; } };
    const enabled = () => !stopped && mode() === 'ble';
    function state(role, status, error = '') {
        states.set(role, {status, name: devices.get(role)?.name || '', error});
        onState(role, {...states.get(role), character: characters.get(role) || null});
    }
    function ready(role) {
        const device = devices.get(role), character = characters.get(role);
        return device?.gatt?.connected && character?.service?.device === device ? character : null;
    }
    function retry() {
        if (retryTimer !== null || !enabled() || !visible()) return;
        const roles = ROLES.filter(role => (savedId(role) || devices.has(role)) && !ready(role));
        if (!roles.length) return;
        const attempts = Math.max(...roles.map(role => failures.get(role) || 0));
        const delay = Math.min(30000, 2000 * 2 ** Math.min(attempts, 4));
        retryTimer = schedule(() => { retryTimer = null; reconnect(); }, delay);
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
    async function establish(role, device) {
        devices.set(role, device);
        listen(device);
        if (ready(role)) return ready(role);
        state(role, 'connecting');
        // Serialize GATT service discovery even when two roles use the same hardware.
        let link = pending.get(device);
        if (!link) {
            link = (async () => {
                if (!device.gatt) throw new Error('This printer does not provide a Bluetooth printing connection.');
                const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
                for (const service of await server.getPrimaryServices()) {
                    const list = await service.getCharacteristics();
                    const writable = list.find(character => character.properties.write || character.properties.writeWithoutResponse);
                    if (writable) return writable;
                }
                throw new Error('No supported receipt-printing connection was found.');
            })();
            pending.set(device, link);
        }
        try {
            const character = await link;
            if (devices.get(role) !== device || !device.gatt.connected) throw new Error('The printer disconnected while connecting.');
            characters.set(role, character);
            failures.set(role, 0);
            try { storage.setItem(`takodeal_printer_${role}_id`, device.id); } catch { /* Keep the authorized device for this session. */ }
            state(role, 'connected');
            return character;
        } finally { if (pending.get(device) === link) pending.delete(device); }
    }
    const rolePending = new Map();
    function connect(role, {choose = false} = {}) {
        if (!ROLES.includes(role)) return Promise.reject(new Error('Unknown printer role.'));
        if (rolePending.has(role)) return rolePending.get(role);
        const attempt = (async () => {
            if (!enabled()) throw new Error('Direct Bluetooth printing is not enabled.');
            if (ready(role)) return ready(role);
            let device = devices.get(role);
            if (!device && savedId(role) && bluetooth?.getDevices) {
                const allowed = await bluetooth.getDevices();
                device = allowed.find(candidate => candidate.id === savedId(role));
            }
            // Background recovery never opens the browser's pairing chooser.
            if (!device && choose && bluetooth?.requestDevice) device = await bluetooth.requestDevice({acceptAllDevices: true, optionalServices: SERVICES});
            if (!device) throw new Error(savedId(role) ? 'Tap Connect printer to restore permission for the saved printer.' : 'Connect this printer once in Printer Hub.');
            return await establish(role, device);
        })().catch(error => {
            characters.delete(role);
            failures.set(role, (failures.get(role) || 0) + 1);
            state(role, savedId(role) || devices.has(role) ? 'reconnecting' : 'not-connected', error.message);
            retry();
            throw error;
        }).finally(() => rolePending.delete(role));
        rolePending.set(role, attempt);
        return attempt;
    }
    async function reconnect() {
        if (!enabled() || !visible()) return;
        if (retryTimer !== null) { cancel(retryTimer); retryTimer = null; }
        // Sequential role attempts also suit inexpensive tablet Bluetooth adapters.
        for (const role of ROLES) if ((savedId(role) || devices.has(role)) && !ready(role)) {
            try { await connect(role); } catch { /* Retain pairing and retry with backoff. */ }
        }
        retry();
    }
    return {
        connect, reconnect, ready,
        snapshot(role) { return {...(states.get(role) || {status: savedId(role) ? 'saved' : 'not-connected'}), connected: !!ready(role)}; },
        invalidate(role) { characters.delete(role); state(role, 'reconnecting'); retry(); },
        stop() { stopped = true; if (retryTimer !== null) cancel(retryTimer); retryTimer = null; },
        pause() { if (retryTimer !== null) cancel(retryTimer); retryTimer = null; }
    };
}

export function createPrinterWriter(connections, {wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))} = {}) {
    let queue = Promise.resolve();
    function send(data, role = 'main') {
        const buffer = new Uint8Array(data);
        const job = queue.then(async () => {
            let character;
            try { character = await connections.connect(role); }
            catch (error) {
                if (role === 'main') throw error;
                character = await connections.connect('main');
                role = 'main';
            }
            let bytesWritten = 0;
            try {
                for (let offset = 0; offset < buffer.length; offset += 100) {
                    const chunk = buffer.slice(offset, offset + 100);
                    if (character.properties.writeWithoutResponse) await character.writeValueWithoutResponse(chunk);
                    else await character.writeValue(chunk);
                    bytesWritten += chunk.length;
                    await wait(30);
                }
                await wait(100);
                return true;
            } catch (error) {
                connections.invalidate(role);
                error.bytesWritten = bytesWritten;
                // A partial receipt must be inspected and reprinted by the cashier.
                // Replaying automatically could duplicate a receipt or cash-drawer command.
                throw error;
            }
        });
        queue = job.catch(() => {});
        return job;
    }
    return {send};
}
