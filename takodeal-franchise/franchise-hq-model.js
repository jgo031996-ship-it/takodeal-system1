// Shared by the Owner and Franchisee apps. Keep both copies byte-for-byte equal.
const text = value => String(value ?? '').trim();
const ms = value => value?.toMillis ? value.toMillis() : value?.seconds != null ? value.seconds * 1000 : +new Date(value || 0) || 0;
export const fullHQScope = session => !!session && session.isFranchisee !== true && (session.isOwner === true || session.permissions?.includes('all') || branchesOf(session).some(branch => branch.toLowerCase() === 'all'));
export function branchesOf(session) {
    const value = session?.allowedBranches ?? session?.assignedBranch ?? session?.branch ?? [];
    return [...new Set((Array.isArray(value) ? value : String(value).split(',')).map(text).filter(Boolean))];
}
export function canUseHQBranch(session, branch, { hq = false } = {}) {
    branch = text(branch);
    if (!session || !branch || ['all', 'hq main office'].includes(branch.toLowerCase())) return false;
    return hq ? fullHQScope(session) || branchesOf(session).includes(branch)
        : session.branch === branch && branchesOf(session).includes(branch);
}
export function summarizeFranchiseLedger(records) {
    let cents = 0, charges = 0, payments = 0, invalidCount = 0;
    const rows = [...records].sort((a, b) => ms(a.timestamp) - ms(b.timestamp) || text(a.id).localeCompare(text(b.id))).map(record => {
        const type = text(record.type).toLowerCase(), amount = Number(record.amount);
        const payment = ['payment', 'credit'].includes(type), charge = ['charge', 'debit'].includes(type);
        let valid = (payment || charge) && ['number', 'string'].includes(typeof record.amount) && text(record.amount) !== '' && Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100));
        const value = valid ? Math.round(amount * 100) : 0;
        if (valid && (!Number.isSafeInteger(cents + (charge ? value : -value)) || !Number.isSafeInteger(charges + (charge ? value : 0)) || !Number.isSafeInteger(payments + (payment ? value : 0)))) valid = false;
        if (!valid) invalidCount++;
        if (valid) {
            if (charge) charges += value;
            if (payment) payments += value;
            cents += charge ? value : -value;
        }
        return { ...record, charge: valid ? charge ? value / 100 : 0 : null, payment: valid ? payment ? value / 100 : 0 : null,
            invalid: !valid, balance: invalidCount ? null : cents / 100 };
    });
    return { rows, balance: invalidCount ? null : cents / 100, invalidCount, charges: charges / 100, payments: payments / 100 };
}
export function conversationAudience(row) {
    if (row?.audience === 'network' && row.branch === 'All' && !text(row.targetBranch)) return { kind: 'network', branch: '', legacy: false };
    if (row?.audience === 'branch' && text(row.targetBranch) && row.branch === row.targetBranch)
        return { kind: 'branch', branch: text(row.targetBranch), legacy: false };
    if (row?.audience != null || row?.targetBranch != null) return { kind: 'unknown', branch: '', legacy: false };
    const branch = text(row?.branch);
    if (['HQ Main Office', 'Main Office', 'All'].includes(branch)) return { kind: text(row.type).toLowerCase() === 'announcement' ? 'network' : 'unknown', branch: '', legacy: true };
    return branch ? { kind: 'branch', branch, legacy: true } : { kind: 'unknown', branch: '', legacy: true };
}
export function conversationVisible(session, row, { hq = false, branch = '' } = {}) {
    const audience = conversationAudience(row);
    if (!session) return false;
    if (audience.kind === 'unknown') return hq && fullHQScope(session) && !branch;
    if (branch && !canUseHQBranch(session, branch, { hq })) return false;
    if (!hq && !canUseHQBranch(session, session.branch)) return false;
    if (audience.kind === 'network') return true;
    return (!branch || audience.branch === branch) && canUseHQBranch(session, audience.branch, { hq });
}
