// Reference data only. Account permissions and PINs never enter this store.
export function createDeviceStore(indexedDB = globalThis.indexedDB) {
    let opening;
    async function open() {
        if (!indexedDB) return null;
        if (!opening) opening = new Promise(resolve => {
            let settled = false;
            const finish = value => { if (settled) { value?.close(); return; } settled = true; clearTimeout(timer); resolve(value); };
            const timer = setTimeout(() => finish(null), 1500);
            let request;
            try { request = indexedDB.open('takodeal-manager-device', 1); } catch { finish(null); return; }
            request.onupgradeneeded = () => request.result.createObjectStore('references');
            request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; finish(request.result); };
            request.onerror = request.onblocked = () => finish(null);
        });
        return opening;
    }
    async function transaction(mode, operation) {
        const database = await open(); if (!database) return null;
        return new Promise(resolve => {
            let value = null, completed = false;
            const done = result => { if (!completed) { completed = true; clearTimeout(timer); resolve(result); } };
            const timer = setTimeout(() => done(null), 1500);
            try {
                const tx = database.transaction('references', mode);
                const request = operation(tx.objectStore('references'));
                request.onsuccess = () => { value = request.result ?? null; };
                tx.oncomplete = () => done(value);
                tx.onabort = tx.onerror = () => done(null);
            } catch { done(null); }
        });
    }
    const allowed = name => name === 'menu' || name === 'bom';
    return {
        async get(scope, name) { return scope && allowed(name) ? transaction('readonly', store => store.get(scope + '/' + name)) : null; },
        async put(scope, name, entry) { return scope && allowed(name) ? transaction('readwrite', store => store.put(entry, scope + '/' + name)) : null; },
        async remove(scope, name) { return scope && allowed(name) ? transaction('readwrite', store => store.delete(scope + '/' + name)) : null; }
    };
}
