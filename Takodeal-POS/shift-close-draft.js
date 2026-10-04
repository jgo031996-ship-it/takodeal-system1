const PREFIX = 'takodeal_shift_close_draft_v1:';

export function countValue(value, integer = false) {
    const text = String(value ?? '').trim();
    if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return '';
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 && (!integer || Number.isSafeInteger(number)) ? text : '';
}

function cleanCounts(values, integer) {
    return Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [key, countValue(value, integer)]));
}

// A closing draft never becomes a cash balance or an inventory count by itself.
export function createShiftCloseDraftStore(storage, now = Date.now) {
    const memory = new Map();
    const keyFor = scope => scope?.branch && scope?.shiftId ? PREFIX + JSON.stringify([scope.branch, scope.shiftId]) : null;
    function valid(draft, scope) {
        return draft?.version === 1 && draft.branch === scope.branch && draft.shiftId === scope.shiftId;
    }
    return {
        load(scope) {
            const key = keyFor(scope);
            if (!key) return null;
            let draft = memory.get(key);
            try {
                const stored = JSON.parse(storage.getItem(key) || 'null');
                if (valid(stored, scope)) draft = stored;
            } catch { /* In-memory drafts remain usable when device storage is blocked. */ }
            if (!valid(draft, scope)) return null;
            return {...draft, cash: cleanCounts(draft.cash, true), stock: cleanCounts(draft.stock, false)};
        },
        save(scope, cash, stock) {
            const key = keyFor(scope);
            if (!key) return {persistent: false, saved: false};
            const draft = {version: 1, ...scope, cash: cleanCounts(cash, true), stock: cleanCounts(stock, false), savedAt: now()};
            memory.set(key, draft);
            try { storage.setItem(key, JSON.stringify(draft)); return {persistent: true, saved: true}; }
            catch { return {persistent: false, saved: true}; }
        },
        clear(scope) {
            const key = keyFor(scope);
            if (!key) return;
            memory.delete(key);
            try { storage.removeItem(key); } catch { /* The UI can still finish closing the shift. */ }
        }
    };
}
