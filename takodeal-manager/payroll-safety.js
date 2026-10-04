// Shared attendance math for Manager payroll and the Staff estimate.
// Times in Schedule Manager are Philippine wall-clock times, independent of device timezone.
const minute = 60000;
const day = 1440 * minute;
const nameKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function asDate(value) {
    if (value?.toDate) return value.toDate();
    if (value?.seconds !== undefined) return new Date(value.seconds * 1000);
    return new Date(value);
}
function parts(value) {
    const date = asDate(value);
    if (!Number.isFinite(date.getTime())) return null;
    const data = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).map(p => [p.type, p.value]));
    return { year: +data.year, month: +data.month, date: +data.day,
        midnight: Date.UTC(+data.year, +data.month - 1, +data.day) - 8 * 60 * minute };
}
export function timeMinutes(value) {
    const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    const match = text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|nn)?$/);
    if (!match) return null;
    let hour = +match[1], mins = +(match[2] || 0);
    if (mins > 59 || hour > (match[3] ? 12 : 23)) return null;
    if (match[3]) {
        if (hour < 1) return null;
        hour %= 12;
        if (match[3] !== 'am') hour += 12;
    }
    return hour * 60 + mins;
}
export function shiftTimes(shift) {
    const label = String(shift.name || '').match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))/i);
    return { start: timeMinutes(shift.startTime) ?? timeMinutes(label?.[1]),
        end: timeMinutes(shift.endTime) ?? timeMinutes(label?.[2]) };
}
export function bonusShift(shift) {
    if (!shift) return false;
    if (['morning', 'mid', 'night', 'other'].includes(shift.shiftType)) return ['mid', 'night'].includes(shift.shiftType);
    if (typeof shift.nightBonusEligible === 'boolean') return shift.nightBonusEligible;
    return /\b(mid|midshift|mid-shift|night)\b/i.test(String(shift.name || ''))
        || /^(mid\w*|n\d+)$/i.test(String(shift.id || ''));
}
export function shiftType(shift) {
    if (['morning', 'mid', 'night', 'other'].includes(shift.shiftType)) return shift.shiftType;
    if (/\b(mid|midshift|mid-shift)\b/i.test(shift.name || '') || /^mid/i.test(shift.id || '')) return 'mid';
    if (/\bnight\b/i.test(shift.name || '') || /^n\d+/i.test(shift.id || '')) return 'night';
    if (/\bmorning\b/i.test(shift.name || '') || /^m\d+/i.test(shift.id || '')) return 'morning';
    return 'other';
}
export function validateShiftConfig(shift) {
    if (shift.active === false) return;
    const { start, end } = shiftTimes(shift);
    if (start === null || end === null) throw new Error(`${shift.name || 'Shift'}: set both Time In and Time Out.`);
    const duration = (end - start + 1440) % 1440;
    if (duration < 60 || duration > 18 * 60) throw new Error(`${shift.name || 'Shift'}: check AM/PM. A shift must last between 1 and 18 hours.`);
}
export function resolveScheduledShift(logDate, branch, staffName, schedule, profiles = {}) {
    const actual = asDate(logDate), local = parts(actual);
    const configs = schedule?.branchConfig?.[branch];
    if (!local || !Array.isArray(configs)) return null;
    const profile = profiles[staffName] || {};
    const names = new Set([staffName, profile.cashierName, profile.scheduleNickname, profile.nickname].filter(Boolean).map(nameKey));
    const assigned = [], fallback = [];
    for (const offset of [-1, 0, 1]) {
        const midnight = local.midnight + offset * day;
        const date = parts(new Date(midnight));
        const weekday = new Date(midnight + 8 * 60 * minute).getUTCDay();
        const assignments = +schedule.currentYear === date.year && +schedule.currentMonth === date.month
            ? schedule.currentSchedule?.[date.date]?.[branch]?.scheduled || {} : {};
        for (const shift of configs) {
            const { start, end } = shiftTimes(shift);
            if (start === null) continue;
            const startAt = new Date(midnight + start * minute);
            const endAt = end === null ? null : new Date(midnight + (end + (end <= start ? 1440 : 0)) * minute);
            const diff = (actual - startAt) / minute;
            const result = { shiftId: shift.id, shiftName: shift.name, shiftType: shiftType(shift), expectedStartHour: start / 60,
                expectedStartAt: startAt, expectedEndAt: endAt, isNightShift: bonusShift(shift),
                lateMinutes: Math.max(0, Math.floor(diff)), wasScheduled: false, distance: Math.abs(diff) };
            if (names.has(nameKey(assignments[shift.id])) && diff >= -90 && diff < 18 * 60) {
                assigned.push({ ...result, wasScheduled: true });
            }
            if (shift.active !== false && (!Array.isArray(shift.days) || shift.days.includes(weekday))
                && diff >= -90 && diff < 240) fallback.push(result);
        }
    }
    const matches = (assigned.length ? assigned : fallback).sort((a, b) => a.distance - b.distance);
    // Multiple staff slots may share one rule (e.g. Night 1, 2 and 3).
    // For older cutoffs with no saved assignment, infer only a common time/category;
    // never pick an employee slot or resolve genuinely conflicting configurations.
    if (!assigned.length && matches[1]?.distance === matches[0]?.distance) {
        const nearest = matches.filter(match => match.distance === matches[0].distance);
        const first = nearest[0];
        const sameRule = nearest.every(match => match.expectedStartAt.getTime() === first.expectedStartAt.getTime()
            && match.expectedEndAt?.getTime() === first.expectedEndAt?.getTime()
            && match.shiftType === first.shiftType && match.isNightShift === first.isNightShift);
        if (!sameRule) return null;
        return { ...first, shiftId: null, matchingShiftIds: nearest.map(match => match.shiftId),
            shiftName: `${first.shiftType[0].toUpperCase() + first.shiftType.slice(1)} shift` };
    }
    return matches[0] || null;
}
export function calculateLateMinutes(...args) {
    return resolveScheduledShift(...args) || { lateMinutes: 0, expectedStartHour: null, wasScheduled: false };
}
export function scheduledShiftForDate(date, branch, staffName, schedule, profiles = {}) {
    const local = parts(date), profile = profiles[staffName] || {};
    if (!local || +schedule?.currentYear !== local.year || +schedule?.currentMonth !== local.month) return null;
    const names = new Set([staffName, profile.cashierName, profile.scheduleNickname, profile.nickname].filter(Boolean).map(nameKey));
    const assignments = schedule.currentSchedule?.[local.date]?.[branch]?.scheduled || {};
    const configs = (schedule.branchConfig?.[branch] || []).filter(shift => names.has(nameKey(assignments[shift.id])));
    if (configs.length !== 1) return null;
    const start = shiftTimes(configs[0]).start;
    return start === null ? null : resolveScheduledShift(new Date(local.midnight + start * minute), branch, staffName, schedule, profiles);
}
export function nightRate(profile = {}) {
    const amount = profile.nightDiffRate !== undefined ? Number(profile.nightDiffRate)
        : profile.eligibleNightDiff !== false ? 50 : 0;
    return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}
export function latePay(minutesLate, profile = {}, shift, exempt = false) {
    const minutes = Math.max(0, Number(minutesLate) || 0);
    const hours = Math.ceil(minutes / 60);
    const daily = Math.max(0, Number(profile.hourlyRate) || 0);
    const ratePerHour = (daily + (shift?.isNightShift ? nightRate(profile) : 0)) / 8;
    return { hours, ratePerHour, amount: exempt ? 0 : Math.round(hours * ratePerHour * 100) / 100 };
}
export function earnedNightBonus(profile, shift, timeOut) {
    return shift?.isNightShift && shift.expectedEndAt && asDate(timeOut) >= shift.expectedEndAt ? nightRate(profile) : 0;
}
export function attendanceLateMinutes(log, calculated = 0) {
    const saved = log.reviewedLateMinutes ?? log.lateMinutes;
    return Math.max(0, Number(saved ?? calculated) || 0);
}
export function isLatenessRequest(request) {
    return request?.type === 'Reason Letter' && /tardiness|late arrival|lateness/i.test(request.explanationCause || '');
}
export function requestLateMinutes(request, attendance) {
    const textMinutes = String(request.explanationMessage || '').match(/clocked in\s+(\d+)\s+minutes?\s+late/i)?.[1];
    const value = request.lateMinutes ?? textMinutes ?? attendance?.lateMinutes;
    if (value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error('This letter has no recorded late minutes. Check its clock-in before reviewing it.');
    }
    return Math.floor(Number(value));
}
export function legacyAttendanceCandidates(request, logs) {
    const at = asDate(request.timestamp).getTime();
    if (!Number.isFinite(at)) return [];
    return logs.filter(log => nameKey(log.staffName) === nameKey(request.staffName)
        && log.branch === request.branch && String(log.type).toUpperCase() === 'TIME IN'
        && asDate(log.timestamp).getTime() >= at - 5 * minute
        && asDate(log.timestamp).getTime() <= at + 120 * minute);
}
// No monetary ledger row is created: the attendance record is payroll's single deduction source.
export async function reviewLateRequest(api, { requestId, attendanceId, action, reply, actor }) {
    if (!['Approved', 'Rejected'].includes(action)) throw new Error('Invalid request decision.');
    if (!attendanceId) throw new Error('Select the clock-in for this letter first.');
    const reqRef = api.doc(api.db, 'staff_requests', requestId);
    const attRef = api.doc(api.db, 'attendance_logs', attendanceId);
    return api.runTransaction(api.db, async tx => {
        const reqSnap = await tx.get(reqRef), attSnap = await tx.get(attRef);
        if (!reqSnap.exists() || !attSnap.exists()) throw new Error('The letter or clock-in no longer exists.');
        const req = reqSnap.data(), att = attSnap.data();
        if (!isLatenessRequest(req)) throw new Error('This is not a lateness letter.');
        if (req.attendanceLogId && req.attendanceLogId !== attendanceId) throw new Error('This letter belongs to a different clock-in.');
        if (att.lateReasonRequestId && att.lateReasonRequestId !== requestId) throw new Error('This clock-in belongs to a different letter.');
        if (att.lateReviewRequestId && att.lateReviewRequestId !== requestId) throw new Error('Another letter already reviewed this clock-in.');
        if (nameKey(att.staffName) !== nameKey(req.staffName) || att.branch !== req.branch
            || String(att.type).toUpperCase() !== 'TIME IN') throw new Error('The selected clock-in does not match this staff member and branch.');
        if (!req.attendanceLogId && !legacyAttendanceCandidates(req, [{ id: attendanceId, ...att }]).length) {
            throw new Error('The selected clock-in is outside this letter’s attendance window.');
        }
        if (req.status !== 'Pending') {
            if (req.status === action && req.payrollReviewVersion === 1 && req.attendanceLogId === attendanceId) return { repeated: true };
            throw new Error('This request was already reviewed. Refresh the inbox before proceeding.');
        }
        const minutes = requestLateMinutes(req, att), stamp = api.serverTimestamp();
        tx.update(attRef, { lateExempted: action === 'Approved', reviewedLateMinutes: minutes,
            lateReviewRequestId: requestId, lateDecision: action, lateReviewedAt: stamp, lateReviewedBy: actor });
        tx.update(reqRef, { status: action, managerReply: reply, processedAt: stamp, processedBy: actor,
            attendanceLogId: attendanceId, lateMinutes: minutes, lateDeductionHours: Math.ceil(minutes / 60),
            payrollEffect: action === 'Approved' ? 'exempt' : 'attendance_deduction', payrollReviewVersion: 1,
            penaltyCharged: 0 });
        return { minutes, hours: Math.ceil(minutes / 60), exempt: action === 'Approved' };
    });
}
