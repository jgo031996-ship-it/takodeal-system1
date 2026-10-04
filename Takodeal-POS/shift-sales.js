// Financial upload is required for close; unresolved stock links are retained
// on uploaded receipts and reviewed separately in HQ.
export async function ensureShiftSalesUploaded(w, { branch, shiftId, startTime }) {
    if (!w.getPendingSales || !w.syncOfflineQueue) throw new Error('Sale upload is not ready. Reopen the app and retry.');
    const start = +(startTime?.toDate?.() || new Date(startTime));
    const forShift = row => {
        if (row.branch && row.branch !== branch) return false;
        if (row.shiftId && row.shiftId !== 'UNKNOWN') return row.shiftId === shiftId;
        const time = +new Date(row.localTimestamp);
        // Unknown legacy records cannot be silently excluded from this drawer.
        return !Number.isFinite(time) || !Number.isFinite(start) || time >= start;
    };
    let pending = (await w.getPendingSales()).filter(forShift);
    for (let attempt = 0; attempt < 2 && (pending.length || w.isSyncing); attempt++) {
        await w.syncOfflineQueue();
        pending = (await w.getPendingSales()).filter(forShift);
    }
    if (pending.length) {
        const details = pending.slice(0, 3).map(row => `${row.receiptId || row.saleId || 'Saved sale'}: ` +
            (row.needsReconciliation ? 'older sale requires Manager review' : row.syncError?.message || 'waiting for connection')).join('\n');
        const error = new Error(`${pending.length} sale(s) still awaiting upload.\n${details}\nKeep the app connected, then retry. View them in Shift Sales or Settings → Sales awaiting upload.`);
        error.code = 'sales-pending';
        throw error;
    }
}

export function createShiftSalesFeed(api, onChange, onError = console.warn) {
    let scope, unsubscribe, generation = 0;
    return {
        start(branch, startTime, shiftId) {
            const start = startTime?.toDate?.() || new Date(startTime);
            if (!branch || !shiftId || !Number.isFinite(+start)) { this.stop(); return; }
            const key = JSON.stringify([branch, +start, shiftId]);
            if (scope === key) return;
            this.stop(); scope = key;
            const current = generation;
            const q = api.query(api.collection(api.db, 'transactions'), api.where('branch', '==', branch), api.where('timestamp', '>=', start));
            unsubscribe = api.onSnapshot(q, snapshot => {
                if (current !== generation || scope !== key) return;
                const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(row =>
                    row.branch === branch && (!row.shiftId || row.shiftId === 'UNKNOWN' || row.shiftId === shiftId));
                Promise.resolve(onChange(rows)).catch(onError);
            }, error => {
                if (current !== generation) return;
                // Let Refresh retry a failed listener for the same shift.
                scope = null;
                onError(error);
            });
        },
        stop() { generation++; unsubscribe?.(); unsubscribe = null; scope = null; }
    };
}
