const millis = value => value?.toMillis?.() ?? (value?.seconds != null ? value.seconds * 1000 : +new Date(value));
const cents = value => Math.round(Number(value) * 100);
const pending = row => row.status === 'Pending' || row.status == null;
const legacyCollection = row => row.type === 'Cash Collection' && row.channel === 'Owner Collection' && !row.expenseId && !row.remittanceVersion;
function matchingOriginal(duplicate, original) {
    const gap = millis(duplicate.timestamp) - millis(original.timestamp);
    return duplicate.id !== original.id && legacyCollection(duplicate) && pending(duplicate) &&
        original.branch === duplicate.branch && Number.isFinite(cents(original.amount)) && cents(original.amount) > 0 &&
        cents(original.amount) === cents(duplicate.amount) && gap >= 0 && gap <= 15 * 60 * 1000 &&
        ['Pending', 'Received', 'Approved'].includes(original.status) && original.channel !== 'Owner Collection' &&
        Boolean(original.cashier || original.cashierName || original.remittedBy) &&
        /^\d{4}-\d{2}-\d{2}$/.test(original.salesPeriodStart || '') && /^\d{4}-\d{2}-\d{2}$/.test(original.salesPeriodEnd || '');
}
// A warning identifies a review candidate, never proof that cash changed hands once.
export function legacyRemittanceDuplicates(rows) {
    const matches = new Map();
    for (const duplicate of rows) {
        const candidates = rows.filter(original => matchingOriginal(duplicate, original));
        if (candidates.length === 1) matches.set(duplicate.id, candidates[0]);
    }
    return matches;
}
export async function rejectLegacyDuplicateAtomic(api, duplicateId, originalId, actor, authorize = () => {}) {
    if (!duplicateId || !originalId || duplicateId === originalId || !String(actor || '').trim()) throw Error('Choose two separate records and an authorized reviewer.');
    return api.runTransaction(api.db, async tx => {
        const duplicateRef = api.doc(api.db, 'remittances', duplicateId), originalRef = api.doc(api.db, 'remittances', originalId);
        const duplicate = await tx.get(duplicateRef), original = await tx.get(originalRef);
        if (!duplicate.exists() || !original.exists()) throw Error('A transfer record is missing. Refresh the history.');
        const copy = {...duplicate.data(), id: duplicateId}, kept = {...original.data(), id: originalId};
        authorize(copy.branch);
        if (copy.status === 'Rejected' && copy.duplicateOf === originalId) return 'already-reviewed';
        if (!matchingOriginal(copy, kept)) throw Error('These records changed or no longer match the legacy duplicate pattern. Review them individually.');
        tx.update(duplicateRef, {status: 'Rejected', duplicateOf: originalId,
            rejectedReason: 'Owner confirmed one physical transfer. Legacy shift-opening collection duplicated the original remittance.',
            rejectedBy: actor, rejectedAt: api.serverTimestamp()});
        tx.set(api.doc(api.db, 'manager_alerts', 'remittance-duplicate-' + duplicateId), {
            type: 'REMITTANCE_REVIEW', branch: copy.branch, remittanceId: duplicateId, originalRemittanceId: originalId,
            amount: copy.amount, message: 'Legacy duplicate remittance rejected after owner review. Original transfer and cash balances retained.',
            reviewStatus: 'Resolved', reviewedBy: actor, timestamp: api.serverTimestamp(), isRead: true});
        return 'reviewed';
    });
}
