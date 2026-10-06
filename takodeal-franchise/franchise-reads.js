import { bounded } from './unlock-gate.js';
import { ms } from './franchise-data.js';

// Share only concurrent identical server requests. Settled results are never cached.
// Plain filter tuples keep keys independent of Firestore's private query internals.
export function createFranchiseReads(api, { scope }) {
    const pending = new Map();
    let generation = 0;
    const valueKey = value => value instanceof Date ? ['date', +value]
        : value?.toMillis ? ['date', value.toMillis()]
        : Array.isArray(value) ? value.map(valueKey)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, valueKey(value[k])])) : value;
    function reset() { generation++; pending.clear(); }
    function fetch(tableName, filters) {
        const current = generation, identity = scope(), key = JSON.stringify([current, identity, tableName, valueKey(filters)]);
        if (pending.has(key)) return pending.get(key);
        const promise = Promise.resolve().then(() => {
            if (current !== generation || scope() !== identity) throw new Error('The account or data changed. Reload the current branch.');
            return bounded(api.getDocsFromServer(api.query(
            api.collection(api.db, tableName), ...filters.map(filter => api.where(...filter))
            )), 20000);
        });
        pending.set(key, promise);
        const remove = () => { if (pending.get(key) === promise) pending.delete(key); };
        promise.then(remove, remove);
        return promise;
    }
    const rows = snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    async function read(tableName, { branch, time = null, start = null, end = null, filters = [] } = {}) {
        const identity = scope(), current = generation;
        const clauses = [['branch', '==', branch], ...filters];
        if (time && start) clauses.push([time, '>=', start]);
        if (time && end) clauses.push([time, '<', end]);
        let snap;
        try { snap = await fetch(tableName, clauses); }
        catch (error) {
            if (current !== generation || scope() !== identity) throw new Error('The account or data changed. Reload the current branch.');
            if (error.code !== 'failed-precondition') throw error;
            // Preserve the complete branch fallback for projects missing a composite index.
            snap = await fetch(tableName, [['branch', '==', branch]]);
        }
        if (current !== generation || scope() !== identity) throw new Error('The account or data changed. Reload the current branch.');
        let result = rows(snap);
        if (time) result = result.filter(row => (!start || ms(row[time]) >= +start) && (!end || ms(row[time]) < +end));
        return result.filter(row => row.branch === branch);
    }
    async function globalRead(tableName, ...filters) {
        const identity = scope(), current = generation, snap = await fetch(tableName, filters);
        if (current !== generation || scope() !== identity) throw new Error('The account or data changed. Reload the current branch.');
        return rows(snap);
    }
    return { read, globalRead, reset, version: () => generation };
}
