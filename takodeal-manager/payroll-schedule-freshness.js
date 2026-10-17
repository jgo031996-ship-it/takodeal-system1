// An unpaid preview must be rebuilt when its dated schedule evidence changes.
// Paid payslips keep their frozen figures; this check never writes payroll data.
import {canOpenWorkspacePage} from './workspace-access-model.js';
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function payrollScheduleStamp(schedule) {
    if (!schedule || !schedule.historyMonths) throw Error('Load saved schedule history before generating payroll.');
    const months = Object.fromEntries(Object.entries(schedule.historyMonths).map(([month, archive]) => [month, {
        latestRevisionId: archive.latestRevisionId || '',
        revisions: (archive.revisions || []).map(row => [row.revisionId, row.sequence || 0, row.savedAt || '']),
        amendments: (archive.shiftAmendments || []).map(row => [row.id, row.sequence || 0, row.recordedAt || '', row.intentFingerprint || ''])
    }]));
    return JSON.stringify(canonical({months, payrollHistoryEnforcedFrom: schedule.payrollHistoryEnforcedFrom || ''}));
}
export async function assertPayrollScheduleFresh(api, data) {
    if (data?.isPaid || api.paidPayrollSnapshots?.has(data)) return;
    if (!data?.scheduleEvidenceStamp || !data.start || !data.end || typeof api.loadPayrollScheduleHistory !== 'function')
        throw Error('Regenerate this unpaid payslip from the saved schedule before payment.');
    const identity = () => {
        const actor = api.auth?.currentUser, session = api.sessionUser;
        if (!actor?.uid || !actor.email || session?.uid !== actor.uid
            || String(session.email || '').toLowerCase() !== actor.email.toLowerCase()
            || session.isFranchisee === true || !canOpenWorkspacePage(session, 'payroll')
            || api.isBranchAllowed?.(data.branch) === false)
            throw Error('Sign in with your authorized payroll account and regenerate this unpaid payslip.');
        return JSON.stringify([actor.uid, actor.email, session.permissions, session.allowedBranches, session.isOwner]);
    };
    const actor = identity();
    const schedule = await api.loadPayrollScheduleHistory(data.start, data.end);
    if (actor !== identity() || payrollScheduleStamp(schedule) !== data.scheduleEvidenceStamp)
        throw Error('The saved shift times changed. Regenerate this unpaid payslip and reopen it before payment.');
}
