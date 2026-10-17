// A payroll preview belongs to one authorized account, cutoff and completed run.
// This helper changes UI readiness only; it never writes payroll or attendance.
const readyMessage = 'Payroll records confirmed with HQ for the selected dates.';
const refreshMessage = 'Connect to HQ and refresh payroll for the selected dates before opening or paying a payslip.';
const readMessage = 'Connect to HQ and refresh payroll. The current records could not be confirmed.';
function previewError(message = refreshMessage, cause) {
    const error = new Error(message, cause ? {cause} : undefined);
    error.code = 'payroll-preview-unconfirmed';
    return error;
}
function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value+'T00:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0,10) === value;
}
export function createPayrollPreviewGuard({getContext, onState = () => {}} = {}) {
    if (typeof getContext !== 'function') throw new TypeError('A payroll context reader is required.');
    let active = null, state = null;
    function contextKey() {
        const context = getContext();
        if (!context || typeof context.accountKey !== 'string' || !context.accountKey.trim())
            throw previewError('Sign in to your approved account, then connect to HQ and refresh payroll.');
        if (!validDate(context.start) || !validDate(context.end) || context.start > context.end)
            throw previewError('Select valid cutoff dates, then connect to HQ and refresh payroll.');
        return JSON.stringify([context.accountKey, context.start, context.end]);
    }
    function emit(status, message) {
        if (state?.status === status && state.message === message) return;
        state = {status, message};
        onState({...state});
    }
    function invalidate(message = refreshMessage) {
        active = null;
        emit('stale', String(message || refreshMessage));
    }
    function begin() {
        // Revoke the old preview even if the newly selected account/dates fail.
        active = null;
        let key;
        try { key = contextKey(); }
        catch (error) {
            const safe = error?.code === 'payroll-preview-unconfirmed' ? error : previewError(refreshMessage, error);
            emit('error', safe.message); throw safe;
        }
        const token = Object.freeze({});
        active = {token, key};
        emit('loading', 'Connecting to HQ and checking payroll records…');
        return token;
    }
    function assertCurrent(token) {
        // An old callback cannot invalidate a newer run, even on its failure path.
        if (!active || active.token !== token) throw previewError();
        let key;
        try { key = contextKey(); }
        catch { invalidate(); throw previewError(); }
        if (key !== active.key) { invalidate(); throw previewError(); }
        if (state?.status !== 'loading' && state?.status !== 'ready') throw previewError();
        return token;
    }
    function complete(token) {
        assertCurrent(token);
        emit('ready', readyMessage);
        return token;
    }
    function fail(token, error) {
        if (!active || active.token !== token) return false;
        try {
            if (contextKey() !== active.key) { invalidate(); return false; }
        } catch { invalidate(); return false; }
        // Database errors can contain technical or account details. Keep the
        // user-facing status plain; the caller retains the original error.
        emit('error', readMessage);
        return true;
    }
    function requireReady() {
        if (!active || state?.status !== 'ready') throw previewError();
        return assertCurrent(active.token);
    }
    return {begin, assertCurrent, complete, fail, invalidate, requireReady};
}

const pendingReads = new WeakMap();
export async function readPayrollSnapshot(api, reference, {timeoutMs = 25000} = {}) {
    if (typeof api?.getDocsFromServer !== 'function') throw previewError(readMessage);
    const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 25000;
    let reads = pendingReads.get(api);
    if (!reads) { reads = new Map(); pendingReads.set(api, reads); }
    let entry = reads.get(reference);
    if (!entry) {
        entry = {};
        let timer;
        // Share only the exact same reference while its actual server read is
        // pending. Other queries stay independent, including after a deadline.
        let physical;
        // Dispatch in the caller's current turn, immediately after its identity
        // check; a queued account change must not start this query for that user.
        try { physical = Promise.resolve(api.getDocsFromServer(reference)); }
        catch (error) { physical = Promise.reject(error); }
        entry.result = Promise.race([physical, new Promise((_, reject) => {
            timer = setTimeout(() => reject(previewError('Connect to HQ and refresh payroll. The records check took too long; no payroll was confirmed.')), deadlineMs);
        })]).finally(() => clearTimeout(timer));
        reads.set(reference, entry);
        const release = () => { if (reads.get(reference) === entry) reads.delete(reference); clearTimeout(timer); };
        physical.then(release, release);
    }
    let snapshot;
    try { snapshot = await entry.result; }
    catch (error) { throw error?.code === 'payroll-preview-unconfirmed' ? error : previewError(readMessage, error); }
    if (!snapshot || snapshot.metadata?.fromCache === true || snapshot.metadata?.hasPendingWrites === true)
        throw previewError(readMessage);
    const documents = [];
    if (Array.isArray(snapshot.docs)) documents.push(...snapshot.docs);
    else if (typeof snapshot.forEach === 'function') snapshot.forEach(document => documents.push(document));
    else throw previewError(readMessage);
    if (documents.some(document => document?.metadata?.hasPendingWrites === true || document?.metadata?.fromCache === true))
        throw previewError(readMessage);
    return snapshot;
}
