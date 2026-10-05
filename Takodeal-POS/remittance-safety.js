import { money } from './branch-operations.js';

const dateOf = value => value?.toDate?.() || (value?.seconds !== undefined ? new Date(value.seconds * 1000) : new Date(value));
const reference = (api, table, id) => api.doc(api.db, table, id);
const serverRead = (api, request) => {
    if (!api.getDocsFromServer) throw new Error('Connect to the internet before sending branch cash.');
    return api.getDocsFromServer(request);
};
const rowsOf = snapshot => snapshot.docs || [];
const nonDrawerExpense = expense => [expense.paidFrom, expense.sourceAccount, expense.paymentSource].includes('Manager Fund');
const validDay = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
};
export function remittanceIntent(input) {
    const fields = ['branch', 'cashier', 'channel', 'recipient', 'referenceNumber', 'salesPeriodStart', 'salesPeriodEnd', 'sourceShiftId'];
    const result = Object.fromEntries(fields.map(key => [key, String(input[key] ?? '').trim()]));
    result.amount = money(input.amount);
    if (!result.amount || ['branch', 'cashier', 'channel', 'recipient', 'sourceShiftId'].some(key => !result[key] || result[key] === 'Unknown')) throw new Error('Enter the amount, transfer method and recipient, then verify your staff PIN.');
    if (fields.some(key => result[key].length > 500)) throw new Error('A remittance field is too long.');
    if (!validDay(result.salesPeriodStart) || !validDay(result.salesPeriodEnd) || result.salesPeriodEnd < result.salesPeriodStart) throw new Error('Enter a valid sales period.');
    return result;
}

// Persist before writing to Firebase so a reload or lost acknowledgement retries
// the same transfer. PINs are never stored in this draft.
export function createRemittanceAttemptStore(storage, makeId = () => crypto.randomUUID()) {
    const key = branch => 'takodeal_remittance_attempt_v1:' + encodeURIComponent(branch);
    const pending = branch => {
        const value = storage.getItem(key(branch));
        if (!value) return null;
        try {
            const saved = JSON.parse(value);
            if (!saved.id || !saved.intent || saved.intent.branch !== branch) throw new Error();
            return saved;
        } catch { throw new Error('The saved transfer needs review. Do not submit another copy; ask the owner to check it.'); }
    };
    return {
        pending,
        prepare(input) {
            const intent = remittanceIntent(input), fingerprint = JSON.stringify(intent), previous = pending(intent.branch);
            if (previous) {
                if (previous.fingerprint !== fingerprint) throw new Error('A previous transfer is awaiting confirmation. Keep its original amount and details, then retry it before sending another transfer.');
                return previous;
            }
            const saved = { id: 'manual-' + makeId(), intent, fingerprint, createdAt: Date.now() };
            storage.setItem(key(intent.branch), JSON.stringify(saved));
            return saved;
        },
        complete(branch, id) {
            if (pending(branch)?.id === id) storage.removeItem(key(branch));
        }
    };
}

async function closedCashCarrySnapshot(api, branch, shiftId, shift) {
    if (shift.branch !== branch || shift.active === true || shift.status !== 'Closed') throw new Error('The previous drawer is no longer closed. Reload this branch.');
    const closing = dateOf(shift.endTime);
    if (!Number.isFinite(+closing)) throw new Error('The previous drawer has no valid close time. Ask the owner to review.');
    const snapshot = await serverRead(api, api.query(api.collection(api.db, 'expenses'), api.where('branch', '==', branch), api.where('timestamp', '>=', closing)));
    let postedAfterClose = 0;
    const applied = new Set(Array.isArray(shift.legacyCarryExpenseIds) ? shift.legacyCarryExpenseIds : []);
    for (const row of rowsOf(snapshot)) {
        const expense = row.data();
        if (applied.has(row.id)) continue;
        if (expense.branch !== branch || nonDrawerExpense(expense) || expense.carryAlreadyAdjusted === true) continue;
        if (expense.cashSourceShiftId && expense.cashSourceShiftId !== shiftId) continue;
        if (expense.shiftId !== 'Accumulated_Floating' && expense.cashSourceShiftId !== shiftId) continue;
        // Old manual transfers wrote an expense against Accumulated_Floating,
        // but left declaredCash unchanged. That cash has already left the drawer.
        if (expense.remittanceId || /^\[REMITTANCE TO HQ\]/.test(expense.description || '')) { postedAfterClose += money(expense.amount); applied.add(row.id); }
    }
    const available = money(shift.retainedCash ?? shift.declaredCash ?? shift.actualCash ?? 0) - money(postedAfterClose);
    if (available < -0.05) throw new Error('Recorded transfers exceed the previous drawer cash. Ask the owner to review these records before opening another shift.');
    return { available: money(Math.max(0, available)), legacyCarryExpenseIds: [...applied] };
}
export async function readClosedCashCarry(api, branch, shiftId, shift) { return (await closedCashCarrySnapshot(api, branch, shiftId, shift)).available; }

export async function readRemittanceDrawer(api, branch) {
    const [active, closed] = await Promise.all([
        serverRead(api, api.query(api.collection(api.db, 'shifts'), api.where('branch', '==', branch), api.where('active', '==', true), api.limit(2))),
        serverRead(api, api.query(api.collection(api.db, 'shifts'), api.where('branch', '==', branch), api.where('status', '==', 'Closed'), api.orderBy('endTime', 'desc'), api.limit(1)))
    ]);
    if (rowsOf(active).length > 1) throw new Error('More than one active drawer exists. Ask the owner to review this branch.');
    const source = rowsOf(active)[0] || rowsOf(closed)[0];
    if (!source) throw new Error('No drawer is recorded for this branch. Open a shift before sending branch cash.');
    const shift = source.data();
    if (shift.branch !== branch) throw new Error('The drawer belongs to another branch.');
    let available, legacyCarryExpenseIds = [];
    if (shift.active === true) {
        const started = dateOf(shift.startTime);
        if (!Number.isFinite(+started)) throw new Error('The drawer start time is missing. Ask the owner to review.');
        const [sales, expenses] = await Promise.all([
            serverRead(api, api.query(api.collection(api.db, 'transactions'), api.where('branch', '==', branch), api.where('timestamp', '>=', started))),
            serverRead(api, api.query(api.collection(api.db, 'expenses'), api.where('shiftId', '==', source.id)))
        ]);
        let cashIn = 0, cashOut = 0;
        for (const row of rowsOf(sales)) {
            const sale = row.data();
            if (sale.branch !== branch || sale.status === 'Voided' || sale.shiftId && !['UNKNOWN', source.id].includes(sale.shiftId)) continue;
            if (Array.isArray(sale.splitDetails)) cashIn += sale.splitDetails.filter(split => String(split.method).toLowerCase() === 'cash').reduce((sum, split) => sum + money(split.amount), 0);
            else if (!sale.paymentMethod || String(sale.paymentMethod).toLowerCase() === 'cash') cashIn += money(sale.netTotal ?? 0);
        }
        for (const row of rowsOf(expenses)) {
            const expense = row.data();
            if (expense.branch === branch && !nonDrawerExpense(expense)) cashOut += money(expense.amount);
        }
        available = Math.max(0, money(shift.startingCash ?? 0) + cashIn - cashOut);
    } else ({available, legacyCarryExpenseIds} = await closedCashCarrySnapshot(api, branch, source.id, shift));
    return { sourceShiftId: source.id, active: shift.active === true, available: money(available), observedManualCashOut: money(shift.manualRemittanceCashOut ?? 0), observedShiftCashOut: money(shift.cashOut ?? 0), legacyCarryExpenseIds };
}

export async function submitRemittanceAtomic(api, attempt, drawer) {
    const intent = remittanceIntent(attempt.intent), fingerprint = JSON.stringify(intent);
    if (!/^manual-[A-Za-z0-9-]{8,100}$/.test(attempt.id) || attempt.fingerprint !== fingerprint) throw new Error('The saved transfer identity is invalid. Ask the owner to review.');
    return api.runTransaction(api.db, async tx => {
        const remitRef = reference(api, 'remittances', attempt.id), expenseRef = reference(api, 'expenses', 'remittance-' + attempt.id);
        const remit = await tx.get(remitRef), expense = await tx.get(expenseRef);
        if (remit.exists()) {
            if (remit.data().intentFingerprint !== fingerprint || !expense.exists() || expense.data().remittanceId !== attempt.id || expense.data().amount !== intent.amount) throw new Error('The transfer is recorded but its drawer entry needs owner review. Do not submit another copy.');
            return { status: 'already-submitted', id: attempt.id };
        }
        if (expense.exists()) throw new Error('This drawer entry already exists without its transfer. Ask the owner to review.');
        if (!drawer) return { status: 'not-submitted', id: attempt.id };
        if (drawer.sourceShiftId !== intent.sourceShiftId) throw new Error('The source drawer changed. Retry the original transfer before sending another.');
        const shiftRef = reference(api, 'shifts', intent.sourceShiftId), source = await tx.get(shiftRef);
        if (!source.exists() || source.data().branch !== intent.branch) throw new Error('The source drawer is missing or belongs to another branch.');
        const shift = source.data();
        if ((shift.active === true) !== drawer.active || !drawer.active && shift.status !== 'Closed') throw new Error('The drawer changed while sending cash. Reload the original transfer and retry.');
        const currentOut = money(shift.manualRemittanceCashOut ?? 0), observedOut = money(drawer.observedManualCashOut);
        const otherCashOut = Math.max(0, money(shift.cashOut ?? 0) - money(drawer.observedShiftCashOut));
        const available = money(drawer.available) - Math.max(0, currentOut - observedOut) - otherCashOut;
        if (intent.amount > available + 0.005) throw new Error(`Only ₱${Math.max(0, available).toFixed(2)} is recorded in this drawer. The transfer amount exceeds available cash.`);
        const at = api.serverTimestamp();
        tx.set(remitRef, { ...intent, cashierName: intent.cashier, remittedBy: intent.cashier, shiftId: intent.sourceShiftId, status: 'Pending', type: 'Manual Remittance', timestamp: at, intentFingerprint: fingerprint, cashPolicyVersion: 3 });
        tx.set(expenseRef, { branch: intent.branch, shiftId: drawer.active ? intent.sourceShiftId : 'Accumulated_Floating', cashSourceShiftId: intent.sourceShiftId, cashier: intent.cashier, loggedBy: intent.cashier, amount: intent.amount, category: 'Cash Remittance', paidFrom: 'Drawer', cashMovement: 'Remittance', remittanceId: attempt.id, carryAlreadyAdjusted: !drawer.active, description: `[REMITTANCE TO HQ] - ${intent.channel} to ${intent.recipient}`, timestamp: at });
        tx.update(shiftRef, { manualRemittanceCashOut: money(currentOut + intent.amount), ...(!drawer.active ? { retainedCash: money(Math.max(0, available - intent.amount)), legacyCarryExpenseIds: [...new Set([...(shift.legacyCarryExpenseIds || []), ...(drawer.legacyCarryExpenseIds || [])])] } : {}) });
        return { status: 'submitted', id: attempt.id };
    });
}

// A lower starting count is a discrepancy report, not proof of a second cash
// handover. Actual transfers are submitted through the remittance form.
export async function recordOpeningCashReview(api, input) {
    const expected = money(input.expectedCash), counted = money(input.startingCash);
    if (!input.previousShiftId || expected <= counted) return null;
    const id = 'opening-cash-' + encodeURIComponent(input.previousShiftId) + '-' + Math.round(counted * 100);
    return api.runTransaction(api.db, async tx => {
        const alertRef = reference(api, 'manager_alerts', id), existing = await tx.get(alertRef);
        if (existing.exists()) return id;
        const previous = await tx.get(reference(api, 'shifts', input.previousShiftId));
        if (!previous.exists() || previous.data().branch !== input.branch) throw new Error('The previous drawer could not be verified.');
        tx.set(alertRef, { type: 'OPENING_CASH_REVIEW', branch: input.branch, cashier: input.cashier, previousShiftId: input.previousShiftId, expectedCash: expected, startingCash: counted, varianceAmount: counted - expected, reportedReason: input.reason, reviewStatus: 'Pending', message: `Opening drawer differs by ₱${money(expected - counted).toFixed(2)}. Staff reported: ${input.reason}. Review existing remittances before recording any further cash collection.`, timestamp: api.serverTimestamp(), isRead: false });
        return id;
    });
}
