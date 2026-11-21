import {activeLeaveDates, leaveNameKey, proposedLeaveDates} from './leave-model.js';

export function uniqueLeaveOwner(request, directory, staffId) {
    const name = leaveNameKey(request.staffName);
    if (!name) return false;
    const matches = directory.filter(person => [
        person.cashierName, person.fullName, person.scheduleName, person.nickname,
        person.scheduleNickname, ...(Array.isArray(person.scheduleAliases) ? person.scheduleAliases : [])
    ].some(alias => alias && leaveNameKey(alias) === name));
    return matches.length === 1 && matches[0].id === staffId &&
        (!request.branch || request.branch === matches[0].branch);
}

// Only a single verified, dated letter can be changed by this decision.
export function reviewableWorkedLeave(rows, claim, staffId, date, legacyIds) {
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (row.pendingLeaveChangeId || (row.staffId ? row.staffId !== staffId : !legacyIds.has(row.id))) return null;
    if (claim && (claim.requestId !== row.id || (claim.staffId && claim.staffId !== staffId))) return null;
    try {
        if (!activeLeaveDates(row).includes(date)) return null;
    } catch { return null; }
    return {requestId: row.id, workDate: date, type: String(row.leaveType || 'Leave'),
        start: row.startDate || date, end: row.endDate || date};
}

export function workedLeaveChanges(ref, get, review, revision, today, staffId) {
    const {requestId, workDate} = review;
    const parent = get('staff_requests', requestId);
    const plan = proposedLeaveDates(parent, {kind: 'Cancel', cancelDates: [workDate]}, today, {historical: true});
    const marker = revision.historicalWorkedShiftReview;
    const at = revision.savedAt;
    const decision = {
        id: revision.revisionId, kind: 'Cancel', requestId, at,
        actor: {uid: marker.reviewedByUid, email: marker.reviewedByEmail},
        reply: 'Owner confirmed completed work on this leave date.',
        changedDates: [workDate], historicalDates: [workDate], lateReviewConfirmed: true,
        dateChanges: plan, revisionIds: [revision.revisionId], timeInLogId: marker.timeInLogId,
        timeOutLogId: marker.timeOutLogId, workedBranch: marker.branch
    };
    const updated = {...parent, staffId, activeLeaveDates: plan.after, leaveVersion: Number(parent.leaveVersion || 0) + 1,
        leaveState: !plan.after.length ? 'Cancelled' : plan.after.some(date => date >= today) ? 'Partially cancelled' : 'Completed',
        leaveActions: [...(parent.leaveActions || []), decision], staffAcknowledged: false};
    if (parent.leaveScheduleSync) {
        const sync = {...parent.leaveScheduleSync, activeDates: plan.after, updatedAt: at};
        for (const field of ['skippedHistoricalDates', 'preservedConflictDates']) {
            if (Array.isArray(sync[field])) sync[field] = sync[field].filter(date => date !== workDate);
        }
        sync.revisionIds = [...new Set([...(sync.revisionIds || []), revision.revisionId])];
        updated.leaveScheduleSync = sync;
    }
    const changes = [{ref: ref('staff_requests', requestId), value: updated}];
    const key = 'schedule_leave_staff_' + staffId;
    const claims = get('settings', key);
    if (claims?.dates?.[workDate]) {
        const dates = {...claims.dates};
        delete dates[workDate];
        changes.push({ref: ref('settings', key), value: {...claims, dates, updatedAt: at}});
    }
    return changes;
}
