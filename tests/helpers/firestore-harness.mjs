import assert from 'node:assert/strict';
// Optimistic transaction harness: records read versions, retries on contention,
// stages every write, rejects reads after writes and injects commit/ack failures.
// This exercises our callbacks without contacting production Firebase.
export function firestoreHarness() {
    const docs = new Map(), versions = new Map();
    const clone = value => structuredClone(value);
    const ref = (table, id) => ({ path: table + '/' + id, id });
    const snapshot = reference => ({ ref: reference, id: reference.id,
        exists: () => docs.has(reference.path), data: () => clone(docs.get(reference.path)) });
    let failBefore = false, loseAck = false, retries = 0;
    const api = {
        db: {}, doc: (_, table, id) => ref(table, id), collection: (_, table) => ({ table }),
        where: (key, op, value) => ({ key, value }), query: (table, ...filters) => ({ ...table, filters }),
        increment: n => ({ increment: n }), serverTimestamp: () => ({ seconds: 1 }),
        async getDocsFromServer(q) {
            const entries = [...docs.keys()].filter(path => path.startsWith(q.table + '/') &&
                (q.filters || []).every(f => docs.get(path)[f.key] === f.value));
            return { docs: entries.map(path => snapshot(ref(q.table, path.slice(q.table.length + 1)))) };
        },
        async runTransaction(_, callback) {
            for (let attempt = 0; attempt < 20; attempt++) {
                const reads = new Map(), writes = [];
                const tx = {
                    async get(reference) {
                        assert.equal(writes.length, 0, 'all transaction reads must precede writes');
                        reads.set(reference.path, versions.get(reference.path) || 0);
                        const data = clone(docs.get(reference.path));
                        await Promise.resolve();
                        return { ...snapshot(reference), exists: () => data !== undefined, data: () => clone(data) };
                    },
                    set: (reference, data, options) => writes.push({ reference, data, merge: options?.merge }),
                    update: (reference, data) => writes.push({ reference, data, merge: true, update: true }),
                    delete: reference => writes.push({ reference, remove: true })
                };
                const result = await callback(tx);
                if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) { retries++; continue; }
                if (failBefore && writes.length) { failBefore = false; throw new Error('Commit rejected'); }
                const staged = new Map(docs);
                for (const write of writes) {
                    const path = write.reference.path;
                    if (write.remove) { staged.delete(path); continue; }
                    if (write.update && !staged.has(path)) throw new Error('Missing document');
                    const data = write.merge ? clone(staged.get(path) || {}) : {};
                    for (const [key, value] of Object.entries(write.data)) {
                        data[key] = value?.increment !== undefined ? (Number(data[key]) || 0) + value.increment : clone(value);
                    }
                    staged.set(path, data);
                }
                docs.clear(); for (const [path, data] of staged) docs.set(path, data);
                for (const write of writes) versions.set(write.reference.path, (versions.get(write.reference.path) || 0) + 1);
                if (loseAck && writes.length) { loseAck = false; throw new Error('Connection lost after commit'); }
                return result;
            }
            throw new Error('Too much contention');
        }
    };
    return { api, docs, ref, get: path => docs.get(path), retries: () => retries,
        put: (path, data) => { docs.set(path, data); versions.set(path, (versions.get(path) || 0) + 1); },
        failNextCommit: () => { failBefore = true; }, loseNextAck: () => { loseAck = true; } };
}
