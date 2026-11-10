// Transaction/event fault injection only. Native browser coverage is separate.
export function outboxIndexedDB() {
    const f = { records: new Map(), connections: [], transactions: [], preTxErrors: [], abortErrors: [], holdNext: null, blocked: false, lateOpen: false, opens: [], deletes: 0 };
    const clone = value => structuredClone(value);
    const invalid = () => Object.assign(Error('Synthetic connection is closing.'), { name: 'InvalidStateError' });
    f.open = (name, version) => {
        if (name !== 'takodeal_sale_outbox_v2' || version !== 1) throw Error('Schema changed.');
        const db = { closed: false, close() { db.closed = true; }, createObjectStore() {}, transaction(table) {
            if (db.closed) throw invalid(); if (f.preTxErrors.length) throw f.preTxErrors.shift();
            if (table !== 'sales') throw Error('Unexpected store');
            const staged = new Map(f.records), forcedAbort = f.abortErrors.shift(), hold = f.holdNext; f.holdNext = null;
            let pending = 0, retired = false, committed = false;
            const apply = () => { if (committed) return; committed = true; f.records.clear(); for (const [key, value] of staged) f.records.set(key, clone(value)); };
            const tx = { ready: false, error: null, abort() { if (committed) throw invalid(); if (retired) return; retired = true; queueMicrotask(() => tx.onabort?.()); }, complete() { if (retired) return; retired = true; apply(); tx.oncomplete?.(); }, objectStore() {
                const request = work => { pending++; const result = {}; queueMicrotask(() => { if (retired) return; try { result.result = work(); result.onsuccess?.(); } catch (error) { result.error = error; result.onerror?.(); tx.error = error; tx.onerror?.({ target: result }); tx.abort(); } finally { pending--; setImmediate(() => { if (retired || pending) return; tx.ready = true; if (forcedAbort) { tx.error = forcedAbort; tx.abort(); } else if (hold === 'committing') apply(); else if (!hold) tx.complete(); }); } }); return result; };
                return { get: key => request(() => clone(staged.get(key))), getAll: () => request(() => [...staged.values()].map(clone)), add: value => request(() => { if (staged.has(value.saleId)) throw Object.assign(Error('Duplicate'), { name: 'ConstraintError' }); staged.set(value.saleId, clone(value)); }), put: value => request(() => staged.set(value.saleId, clone(value))), delete: key => request(() => { f.deletes++; staged.delete(key); }) };
            } };
            f.transactions.push(tx); return tx;
        } };
        const request = { result: db };
        f.connections.push(db); f.opens.push(request);
        queueMicrotask(() => { if (f.blocked) request.onblocked?.(); else if (!f.lateOpen) request.onsuccess?.(); });
        return request;
    };
    return f;
}
