// Shared promises prevent overlapping views from reading the same collection.
export function createCollectionCache(read, { now = Date.now, ttl = name => ['inventory','branches'].includes(name) ? 60000 : 900000, storage = null, scope = () => '' } = {}) {
    const entries = new Map(), writes = new Map();
    const keyFor = (user, name) => user + '/' + name;
    const queue = (key, action) => {
        const next = (writes.get(key) || Promise.resolve()).catch(() => {}).then(action).catch(() => {});
        writes.set(key, next); next.finally(() => { if (writes.get(key) === next) writes.delete(key); }); return next;
    };
    return {
        async get(name) {
            const user = scope(), key = keyFor(user, name);
            let entry = entries.get(key);
            if (entry?.pending) return entry.pending;
            if (entry?.rows && now() - entry.at < ttl(name)) return entry.rows;
            entry = { at: 0, rows: null };
            entries.set(key, entry);
            entry.pending = Promise.resolve().then(async () => {
                if (storage && user) {
                    await writes.get(key);
                    const saved = await storage.get(user, name).catch(() => null);
                    if (entries.get(key) === entry && Array.isArray(saved?.rows) && saved.at <= now() && now() - saved.at < ttl(name)) {
                        entry.at = saved.at; return saved.rows;
                    }
                }
                const rows = await read(name); entry.at = now();
                if (storage && user && entries.get(key) === entry) await queue(key, () => storage.put(user, name, { rows, at: entry.at }));
                return rows;
            }).then(rows => {
                entry.rows = rows; return rows;
            }).finally(() => { entry.pending = null; });
            return entry.pending;
        },
        invalidate(name) {
            const user = scope(), key = keyFor(user, name);
            entries.delete(key);
            if (storage && user) return queue(key, () => storage.remove(user, name));
        },
        clearMemory() { entries.clear(); }
    };
}
