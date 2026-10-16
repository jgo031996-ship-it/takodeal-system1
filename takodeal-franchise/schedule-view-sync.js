// Read-only lifecycle for saved schedule screens. No attendance or schedule writes.
export function installScheduleViewSync(api, {window: win = globalThis.window, document: doc = globalThis.document,
    scope, refresh, dirty = () => false, pending = () => {}, error = () => {}}) {
    let active = null, epoch = 0, stops = [], disposed = false, queued = false, followUp = false;
    const flights = new Map();
    const selected = () => {
        if (disposed || doc.hidden || doc.visibilityState === 'hidden') return null;
        try { const value = scope(); return value?.month && value?.identity ? {...value, key: JSON.stringify(value)} : null; }
        catch { return null; }
    };
    function detach() { epoch++; stops.splice(0).forEach(stop => { try { stop(); } catch {} }); active = null; followUp = false; queued = false; }
    function token() { return active ? {key: active.key, epoch} : null; }
    function current(stamp) { return Boolean(stamp && active && stamp.epoch === epoch && stamp.key === active.key && selected()?.key === stamp.key); }
    function request() {
        reconcile(false);
        if (!active || queued) return;
        if (dirty()) { pending(); return; }
        const stamp = token();
        if (flights.has(stamp.key + '/' + stamp.epoch)) { followUp = true; return; }
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (!current(stamp)) return;
            if (dirty()) { pending(); return; }
            Promise.resolve().then(refresh).catch(cause => { if (current(stamp)) error(cause); });
        });
    }
    function reconcile(reload = false) {
        const next = selected();
        if (!next) { if (active) detach(); return; }
        const changed = active?.key !== next.key;
        if (changed) {
            detach(); active = next;
            if (typeof api.onSnapshot === 'function') {
                const stamp = token();
                for (const id of ['global_schedule', 'schedule_month_' + next.month.replace('-', '_')]) {
                    let seen = false, signature = '';
                    try {
                        const off = api.onSnapshot(api.doc(api.db, 'settings', id), {includeMetadataChanges: true}, snap => {
                            if (!current(stamp) || snap.metadata?.fromCache || snap.metadata?.hasPendingWrites) return;
                            const value = JSON.stringify(snap.exists() ? snap.data() : null);
                            // The first confirmed server value can be newer than a
                            // read already in flight (or arrive after network wake).
                            // Queue one shared follow-up instead of dropping it.
                            if (!seen) { seen = true; signature = value; request(); return; }
                            if (signature !== value) { signature = value; request(); }
                        }, cause => { if (current(stamp)) error(cause); });
                        stops.push(off);
                    } catch (cause) { if (current(stamp)) error(cause); }
                }
            }
        }
        if (reload || changed) request();
    }
    function wrap(loader) {
        return function (...args) {
            reconcile(false);
            if (!active) return Promise.resolve();
            const stamp = token(), key = stamp.key + '/' + stamp.epoch;
            if (flights.has(key)) return flights.get(key);
            const promise = Promise.resolve().then(() => current(stamp) ? loader.apply(this, args) : undefined)
                .finally(() => {
                    if (flights.get(key) === promise) flights.delete(key);
                    if (current(stamp) && followUp) { followUp = false; request(); }
                });
            flights.set(key, promise);
            return promise;
        };
    }
    const events = [];
    const listen = (target, type, fn) => { target?.addEventListener?.(type, fn); events.push(() => target?.removeEventListener?.(type, fn)); };
    const resume = () => reconcile(true);
    listen(doc, 'visibilitychange', resume);
    for (const name of ['pageshow', 'focus', 'online']) listen(win, name, resume);
    listen(win, 'pagehide', detach);
    listen(win, 'storage', () => reconcile(false));
    listen(doc, 'change', () => reconcile(false));
    const observer = win?.MutationObserver ? new win.MutationObserver(() => reconcile(false)) : null;
    observer?.observe(doc.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']});
    const controller = {wrap, token, current, refresh: request, sync: () => reconcile(false),
        stop: detach, dispose() { disposed = true; detach(); observer?.disconnect(); events.splice(0).forEach(off => off()); }};
    queueMicrotask(() => reconcile(false));
    return controller;
}
