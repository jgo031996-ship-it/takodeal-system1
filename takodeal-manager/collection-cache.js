// Shared promises prevent overlapping views from reading the same collection.
export function createCollectionCache(read, { now = Date.now, ttl = name => name === 'inventory' ? 60000 : 900000 } = {}) {
    const entries = new Map();
    return {
        async get(name) {
            let entry = entries.get(name);
            if (entry?.pending) return entry.pending;
            if (entry?.rows && now() - entry.at < ttl(name)) return entry.rows;
            entry = { at: 0, rows: null };
            entries.set(name, entry);
            entry.pending = Promise.resolve().then(() => read(name)).then(rows => {
                entry.rows = rows; entry.at = now(); return rows;
            }).finally(() => { entry.pending = null; });
            return entry.pending;
        },
        invalidate(name) { entries.delete(name); }
    };
}
