const text = value => typeof value === 'string' ? value.trim() : '';
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const withdrawn = row => ['cancelled', 'canceled', 'deleted'].includes(text(row?.status).toLowerCase());
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

const defaultLevels = [
    ['verbal-warning', 'Verbal warning', 0],
    ['written-warning', 'Written warning', 0],
    ['suspension-1', '1 day suspension', 1],
    ['suspension-3', '3 days suspension', 3],
    ['suspension-7', '7 days suspension', 7],
    ['suspension-14', '14 days suspension', 14],
    ['hr-review', 'Further HR review', 0]
].map(([id, label, suspensionDays]) => Object.freeze({id, label, suspensionDays}));

export const DEFAULT_DISCIPLINE_POLICY = Object.freeze({version:1, revision:0, levels:Object.freeze(defaultLevels)});

// A policy is a future choice catalogue. Saved actions retain their own copy.
export function normalizeDisciplinePolicy(value) {
    const source = value == null ? DEFAULT_DISCIPLINE_POLICY : value;
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.version !== 1 || !safeInteger(source.revision)) {
        throw Error('The saved discipline policy needs an Owner review.');
    }
    if (!Array.isArray(source.levels) || source.levels.length < 1 || source.levels.length > 20) {
        throw Error('Configure between 1 and 20 discipline levels.');
    }
    const ids = new Set();
    const levels = source.levels.map(level => {
        if (!level || typeof level !== 'object' || Array.isArray(level) || typeof level.id !== 'string' || !idPattern.test(level.id) || ids.has(level.id)) {
            throw Error('Each discipline level needs a unique, stable ID.');
        }
        const label = text(level.label);
        if (!label || [...label].length > 120 || /[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(label)) {
            throw Error('Use a plain-text discipline label of 1 to 120 characters.');
        }
        if (!safeInteger(level.suspensionDays) || level.suspensionDays > 366) {
            throw Error('Suspension days must be a whole number from 0 to 366.');
        }
        ids.add(level.id);
        return {id:level.id, label, suspensionDays:level.suspensionDays};
    });
    return {version:1, revision:source.revision, levels};
}

function staffIdentity(staff) {
    if (!staff || typeof staff !== 'object') return null;
    const ids = [...new Set([text(staff.id), text(staff.staffId)].filter(Boolean))];
    const names = [...new Set([text(staff.name), text(staff.cashierName), text(staff.staffName)].filter(Boolean))];
    if (ids.length !== 1 || names.length > 1) return null;
    return {id:ids[0], name:names[0] || '', branch:text(staff.branch), legacyNameVerified:staff.legacyNameVerified !== false};
}

export function sameCaseStaff(row, staff) {
    const person = staffIdentity(staff);
    if (!person || !row || typeof row !== 'object') return false;
    // An explicit ID never falls back to a similar or identical name.
    if (row.staffId != null) return typeof row.staffId === 'string' && !!text(row.staffId) && text(row.staffId) === person.id;
    return person.legacyNameVerified && !!person.name && !!person.branch && text(row.staffName) === person.name && text(row.branch) === person.branch;
}

function timestampMillis(value) {
    try {
        if (value instanceof Date) return Number.isFinite(+value) ? +value : null;
        if (value && typeof value.toMillis === 'function') {
            const milliseconds = value.toMillis();
            return typeof milliseconds === 'number' && Number.isFinite(+new Date(milliseconds)) ? milliseconds : null;
        }
        if (value && typeof value.toDate === 'function') return timestampMillis(value.toDate());
        if (value && typeof value === 'object' && Number.isSafeInteger(value.seconds) && (value.nanoseconds == null || safeInteger(value.nanoseconds) && value.nanoseconds < 1e9)) {
            const milliseconds = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
            return Number.isFinite(+new Date(milliseconds)) ? milliseconds : null;
        }
        if (typeof value === 'number') return Number.isFinite(+new Date(value)) ? value : null;
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
            if (new Date(value.slice(0,10) + 'T00:00:00Z').toISOString().slice(0,10) !== value.slice(0,10) || Number(value.slice(11,13)) > 23) return null;
            const milliseconds = Date.parse(value);
            return Number.isFinite(milliseconds) ? milliseconds : null;
        }
    } catch {}
    return null;
}

const reviewRecorded = row => ['Reviewed','Archived'].includes(row.status) && !!text(row.reviewedByUid) && !!text(row.reviewedByEmail) && text(row.reviewReason).length >= 8 && text(row.reviewReason).length <= 1500 && Number.isSafeInteger(row.decisionRevision) && row.decisionRevision > 0 && timestampMillis(row.reviewedAt) != null;
const validCaseNumber = row => Number.isSafeInteger(row.caseNumber) && row.caseNumber > 0;
function reviewedActionRecorded(action) {
    try {
        if (!action || typeof action.effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(action.effectiveDate) || new Date(action.effectiveDate + 'T00:00:00Z').toISOString().slice(0,10) !== action.effectiveDate) return false;
        normalizeDisciplinePolicy({version:1,revision:action.policyRevision,levels:[action]});
        return true;
    } catch { return false; }
}

export function caseHistory(records, staff) {
    if (!Array.isArray(records)) throw Error('The saved case history is incomplete. Refresh before reviewing.');
    const person = staffIdentity(staff);
    if (!person) throw Error('Select one exact staff profile before reviewing case history.');
    const seen = new Map();
    const selected = records.filter(row => sameCaseStaff(row, staff)).filter(row => {
        const id = text(row.id);
        if (!id) return true;
        const signature = JSON.stringify([row.staffId, row.staffName, row.branch, row.caseVersion, row.caseKey, row.caseNumber, row.type, row.status, row.finding, row.proposedSeverity, row.reviewedAction, row.reviewedByUid, row.reviewedByEmail, timestampMillis(row.reviewedAt), row.reviewReason, row.decisionRevision]);
        if (seen.has(id)) {
            if (seen.get(id) !== signature) throw Error('Conflicting copies of a saved case need a refresh.');
            return false;
        }
        seen.set(id, signature);
        return true;
    });
    const rows = selected.map((row, index) => {
        const legacy = row.caseVersion !== 2;
        const hasReview = !legacy && row.staffId === person.id && row.caseKey === person.id && validCaseNumber(row) && reviewRecorded(row);
        const hasConfirmedFinding = hasReview && row.finding === 'Confirmed' && reviewedActionRecorded(row.reviewedAction) && !withdrawn(row);
        const findingLabel = legacy ? 'Finding not recorded'
            : withdrawn(row) ? 'Withdrawn'
            : row.finding === 'Pending' ? 'Pending — not a finding'
            : hasReview && row.finding === 'Not established' ? 'Not established'
            : hasConfirmedFinding ? 'Confirmed'
            : 'Finding not recorded';
        return {...row, findingLabel, hasConfirmedFinding, legacy, withdrawn:withdrawn(row), archived:text(row.status).toLowerCase() === 'archived', recordedAtMillis:timestampMillis(row.issuedAt ?? row.timestamp), _historyOrder:index};
    }).sort((a,b) => (a.recordedAtMillis ?? Infinity) - (b.recordedAtMillis ?? Infinity) || (validCaseNumber(a) && validCaseNumber(b) ? a.caseNumber - b.caseNumber : 0) || a._historyOrder - b._historyOrder)
        .map(({_historyOrder, ...row}) => row);
    const maximum = rows.reduce((max, row) => validCaseNumber(row) ? Math.max(max, row.caseNumber) : max, rows.length);
    if (maximum >= Number.MAX_SAFE_INTEGER) throw Error('The case sequence needs an Owner review before another notice is issued.');
    const confirmedRows = rows.filter(row => row.hasConfirmedFinding);
    return {
        rows,
        confirmedRows,
        legacyRows:rows.filter(row => row.legacy),
        pendingRows:rows.filter(row => row.caseVersion === 2 && row.finding === 'Pending' && !row.withdrawn),
        cancelledRows:rows.filter(row => row.withdrawn),
        totalCases:rows.length,
        confirmedCount:confirmedRows.length,
        nextCaseNumber:maximum + 1,
        relatedConfirmedCount:type => confirmedRows.filter(row => text(row.type) === text(type) && !!text(type)).length
    };
}
