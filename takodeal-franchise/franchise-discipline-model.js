import {caseHistory} from './discipline-case-model.js';

export const disciplineEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const disciplineCaseName = row => row.caseVersion === 2 ? 'Case #' + row.caseNumber : 'Earlier notice · number not recorded';
export function disciplineFinding(row) {
    if (row.caseVersion !== 2) return 'Finding not recorded';
    try {
        const saved = caseHistory([row], {id:row.staffId,cashierName:row.staffName,branch:row.branch}).rows[0];
        return saved?.hasConfirmedFinding ? 'Violation confirmed' : saved?.findingLabel === 'Not established' ? 'Violation not established' : saved?.withdrawn ? 'Case withdrawn' : 'Awaiting management finding';
    } catch { return 'Finding needs review'; }
}
export function disciplineCaseSummary(row) {
    const action = row.caseVersion === 2 ? row.reviewedAction?.label || 'No final action recorded' : row.severity || 'Earlier notice';
    return {name:disciplineCaseName(row),finding:disciplineFinding(row),action,
        status:row.status || 'Status not recorded',canReview:row.caseVersion === 2 && row.status === 'Replied' && row.finding === 'Pending',
        canClose:row.caseVersion === 2 && ['Pending Reply','Replied','Reviewed'].includes(row.status)};
}
export function franchiseDisciplineHistoryHTML(context) {
    const esc = disciplineEscape, history = context.history;
    return '<div class="fd-history-summary"><strong>' + esc(history.totalCases) + ' case(s) visible in this branch</strong><span>' + esc(history.confirmedCount) + ' confirmed finding(s) · ' + esc(history.legacyRows.length) + ' earlier finding(s) not recorded</span></div>' +
        '<p class="fd-help">Case numbers continue across incident types. A notice or case number does not establish a violation or select a punishment. Cancelled cases remain in history.</p>' +
        (history.rows.length ? '<div class="fd-history">' + history.rows.map(row => '<article><strong>' + esc(disciplineCaseName(row)) + ' · ' + esc(row.type) + '</strong><span>' + esc(disciplineFinding(row)) + ' · ' + esc(row.status || 'Status not recorded') + '</span>' +
            (row.reviewedAction ? '<small>Saved action: ' + esc(row.reviewedAction.label) + ' · effective ' + esc(row.reviewedAction.effectiveDate) + '</small>' : '') + '</article>').join('') + '</div>' : '<p>No earlier cases found in this branch.</p>');
}
