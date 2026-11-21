import {activeLeaveDates, leaveDate} from './leave-model.js';

// Older leave letters can have only one boundary. An unknown date is never
// sufficient evidence to remove a day from the approved letter.
export function leaveOnWorkDate(row, date) {
    if (row.activeLeaveDates === undefined && /^cancelled$|^canceled$/i.test(String(row.leaveState || '').trim())) return false;
    try { return activeLeaveDates(row).includes(date); } catch {
        const valid = value => { try { return leaveDate(value); } catch { return null; } };
        if (Array.isArray(row.activeLeaveDates) && row.activeLeaveDates.some(value => valid(value) === date)) return true;
        const from = valid(row.startDate), to = valid(row.endDate);
        if (from && to && from > to) return null;
        if (from && to && from <= date && date <= to) return true;
        if (from && date < from || to && date > to) return false;
        return null;
    }
}

export function reviewWorkedLeave(rows, claims, date, staffId, legacyOwners) {
    const active = rows.filter(row => leaveOnWorkDate(row, date) === true);
    const claim = claims?.dates?.[date];
    if (!active.length && !claim) return {};
    const [row] = active;
    if (active.length !== 1 || claim && (claim.requestId !== row.id || claim.staffId && claim.staffId !== staffId) ||
        claims?.staffId && claims.staffId !== staffId)
        return {blocker:'The leave claim and approved letters for this date need HR review.'};
    if (row.pendingLeaveChangeId || (!row.staffId && legacyOwners.get(row.staffName) !== staffId))
        return {blocker:'An approved leave covers this date. Confirm its employee identity or pending leave change in HR.'};
    try {
        const dates = activeLeaveDates(row);
        if (!dates.includes(date)) throw Error();
        return {leave:{requestId:row.id, date, type:String(row.leaveType || 'Leave'), dates}};
    } catch {
        return {blocker:'The approved leave has incomplete dates. Review the original letter in HR.'};
    }
}

export function workedLeaveUpdates(parent, claims, marker, leave) {
    const date = marker.workDate, before = activeLeaveDates(parent), after = before.filter(day => day !== date);
    if (before.length === after.length || parent.status !== 'Approved' || parent.pendingLeaveChangeId ||
        parent.staffId && parent.staffId !== marker.staffId)
        throw Error('The linked leave changed. Reopen this work date.');
    const revisionId = marker.correctionId, at = marker.reviewedAt;
    const decision = {
        id:revisionId, kind:'Worked shift', requestId:leave.requestId, at,
        actor:{uid:marker.reviewedByUid,email:marker.reviewedByEmail},
        reply:'Owner confirmed completed work for this date and removed the date from active leave.',
        changedDates:[date], historicalDates:[date], revisionIds:[revisionId],
        timeInLogId:marker.timeInLogId, timeOutLogId:marker.timeOutLogId,
        branch:marker.branch, dateChanges:{before,after,added:[],removed:[date]}
    };
    const update = {
        activeLeaveDates:after, leaveState:after.length ? 'Partially cancelled' : 'Cancelled',
        leaveVersion:(parent.leaveVersion || 0) + 1,
        leaveActions:[...(parent.leaveActions || []),decision], staffAcknowledged:false
    };
    if (!Number.isSafeInteger(update.leaveVersion) || update.leaveVersion < 1) throw Error('Review the saved leave version.');
    if (parent.leaveScheduleSync?.version === 1) {
        const sync = parent.leaveScheduleSync;
        update.leaveScheduleSync = {...sync,activeDates:after,updatedAt:at,
            revisionIds:[...new Set([...(sync.revisionIds || []),revisionId])],
            skippedHistoricalDates:(sync.skippedHistoricalDates || []).filter(day => day !== date),
            preservedConflictDates:(sync.preservedConflictDates || []).filter(day => day !== date)};
    }
    let claimUpdate = null;
    if (claims?.dates?.[date]) {
        if (claims.dates[date].requestId !== leave.requestId) throw Error('The leave claim changed. Reopen this work date.');
        const dates = {...claims.dates};
        delete dates[date];
        claimUpdate = {dates,updatedAt:at};
    }
    return {update,claimUpdate};
}
