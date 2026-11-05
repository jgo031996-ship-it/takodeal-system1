import {resolveReliefScheduleReview} from './relief-schedule-review-model.js';
import {validEmergencyReliefMarker} from './relief-attendance-model.js';
// Shared attendance math for Manager payroll and the Staff estimate.
// Times in Schedule Manager are Philippine wall-clock times, independent of device timezone.
import { resolveScheduleForDate, amendmentsForDate } from './schedule-history.js';
import {publishedPayrollTemplates} from './payroll-bonus-templates.js';
import {staffRateForDate} from './staff-rate-model.js';
import {applyAttendanceAmendmentReview} from './attendance-amendment-review-model.js';
import {resolveEmergencyShift} from './emergency-shift-model.js';
import {attendanceMillis} from './attendance-reconcile.js';
const payrollOwnerEmail='jgo031996@gmail.com';
export {staffRateDate,staffRateWorkDate,staffProfileForWork,loadStaffSalaryTimeline,staffRateForDate,payrollSalaryProfile,assertPayrollSalaryFresh} from './staff-rate-model.js';
const minute = 60000;
const day = 1440 * minute;
// Meals and cancelled-food purchases belong in the Foods deduction.
// Keep the source label for the history; ignore unrelated penalties/loan entries.
export function isMealDeduction(type) {
    return /^(?:cancelled food purchase|(?:staff|manager)\s+meal(?:\s*\(\s*pos\s+auto\s*\))?)$/i.test(String(type || '').trim());
}

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
    if (!assigned.length && matches.length > 1 && matches[1].distance === matches[0].distance) {
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

const dateKey = local => `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.date).padStart(2, '0')}`;
function emptyAttendanceShift(log, source, review = true) {
    return { shiftId: null, shiftName: '', shiftType: 'other', expectedStartHour: null,
        expectedStartAt: null, expectedEndAt: null, isNightShift: false, wasScheduled: false,
        lateMinutes: attendanceLateMinutes(log, 0), needsScheduleReview: review,
        scheduleSource: source, scheduleRevisionId: '' };
}
function closestTrustedShift(logDate, branch, staffName, schedule, profiles = {}, allowCurrent = false, amendments = true) {
    const actual = asDate(logDate), local = parts(actual);
    if (!local) return null;
    const profile = profiles[staffName] || {};
    const names = new Set([staffName, profile.cashierName, profile.scheduleNickname, profile.nickname].filter(Boolean).map(nameKey));
    const assigned = [], fallback = [];
    for (const offset of [-1, 0, 1]) {
        const midnight = local.midnight + offset * day, workDay = parts(new Date(midnight));
        const key = dateKey(workDay);
        const archived = schedule?.historyMonths ? resolveScheduleForDate(schedule, key, {amendments}) : null;
        // A fresh punch can capture the current month's live rule even before
        // its first archive exists. Historic re-evaluation never takes this path.
        const saved = archived || (allowCurrent && +schedule?.currentYear === workDay.year && +schedule?.currentMonth === workDay.month ? schedule : null);
        if (!saved || +saved.currentYear !== workDay.year || +saved.currentMonth !== workDay.month) continue;
        const configs = saved.branchConfig?.[branch];
        if (!Array.isArray(configs)) continue;
        const assignments = saved.currentSchedule?.[workDay.date]?.[branch]?.scheduled || {};
        const weekday = new Date(midnight + 8 * 60 * minute).getUTCDay();
        for (const shift of configs) {
            const { start, end } = shiftTimes(shift);
            if (start === null) continue;
            const startAt = new Date(midnight + start * minute);
            const endAt = end === null ? null : new Date(midnight + (end + (end <= start ? 1440 : 0)) * minute);
            const diff = (actual - startAt) / minute;
            const result = { shiftId: shift.id ?? null, shiftName: shift.name || '', shiftType: shiftType(shift), expectedStartHour: start / 60,
                expectedStartAt: startAt, expectedEndAt: endAt, isNightShift: bonusShift(shift),
                lateMinutes: Math.max(0, Math.floor(diff)), wasScheduled: false, distance: Math.abs(diff),
                needsScheduleReview: end === null, scheduleSource: saved.scheduleSource || 'history', scheduleRevisionId: saved.scheduleRevisionId || saved.revisionId || '' };
            if (names.has(nameKey(assignments[shift.id])) && diff >= -90 && diff < 18 * 60) assigned.push({ ...result, wasScheduled: true });
            if (shift.active !== false && (!Array.isArray(shift.days) || shift.days.includes(weekday)) && diff >= -90 && diff < 240) fallback.push(result);
        }
    }
    const candidates = (assigned.length ? assigned : fallback).sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return null;
    const nearest = candidates.filter(item => item.distance === candidates[0].distance), first = nearest[0];
    if (nearest.length > 1) {
        const same = nearest.every(item => +item.expectedStartAt === +first.expectedStartAt && +item.expectedEndAt === +first.expectedEndAt
            && item.shiftType === first.shiftType && item.isNightShift === first.isNightShift);
        if (!same) return null;
        return { ...first, shiftId: null, matchingShiftIds: nearest.map(item => item.shiftId), shiftName: `${first.shiftType[0].toUpperCase() + first.shiftType.slice(1)} shift` };
    }
    return first;
}
function clockInSnapshotShift(log, staffName) {
    const snapshot = log.scheduleSnapshot || (log.expectedStartAt ? log : null);
    if (!snapshot) return null;
    const result = emptyAttendanceShift(log, 'clock-in');
    const actual = asDate(log.timestamp), expected = snapshot.expectedStartAt ? asDate(snapshot.expectedStartAt) : null;
    const ending = snapshot.expectedEndAt ? asDate(snapshot.expectedEndAt) : null;
    if (snapshot.needsScheduleReview === true || snapshot.branch && snapshot.branch !== log.branch
        || snapshot.staffName && nameKey(snapshot.staffName) !== nameKey(staffName)
        || !expected || !Number.isFinite(+expected) || !Number.isFinite(+actual)) return result;
    const distance = (actual - expected) / minute;
    if (distance < -90 || distance >= 18 * 60) return result;
    const validEnd = ending && Number.isFinite(+ending) && ending > expected && ending - expected <= 18 * 60 * minute;
    return { ...result, shiftId: snapshot.shiftId ?? null, shiftName: snapshot.shiftName || '', shiftType: snapshot.shiftType || 'other',
        expectedStartHour: (expected - parts(expected).midnight) / (60 * minute), expectedStartAt: expected,
        expectedEndAt: validEnd ? ending : null, isNightShift: snapshot.isNightShift === true && Boolean(validEnd),
        wasScheduled: snapshot.wasScheduled === true, lateMinutes: attendanceLateMinutes(log, Math.max(0, Math.floor(distance))),
        needsScheduleReview: !validEnd, scheduleRevisionId: snapshot.scheduleRevisionId || '' };
}
// A saved amendment is a separate, dated correction. It never rewrites the
// original punch snapshot, assignment, or a manager's lateness review.
export function resolveAttendanceAmendment(log, schedule, profiles = {}, staffName = log?.staffName) {
    if (!log || !staffName || log.type && String(log.type).toUpperCase() !== 'TIME IN') return null;
    const snapshot = clockInSnapshotShift(log, staffName);
    const original = snapshot || closestTrustedShift(log.timestamp, log.branch, staffName, schedule, profiles, false, false);
    if (!original || original.needsScheduleReview || !original.shiftId || !original.expectedStartAt || !original.expectedEndAt) return null;
    const work = parts(original.expectedStartAt), workDate = work && dateKey(work), archive = workDate && schedule?.historyMonths?.[workDate.slice(0,7)];
    const events = archive?.shiftAmendments;
    if (!Array.isArray(events) || !events.length) return null;
    const dated = resolveScheduleForDate(schedule, workDate, {amendments:false});
    const configs = dated?.branchConfig?.[log.branch], profile = profiles[staffName];
    if (!dated || !Array.isArray(configs) || !profile?.cashierName) return null;
    const names = new Set([staffName,profile.cashierName,profile.scheduleNickname,profile.nickname].filter(Boolean).map(nameKey));
    if (!names.has(nameKey(log.staffName))) return null;
    const profileId = profile.staffId || profile.id;
    if (log.staffId && (!profileId || String(log.staffId) !== String(profileId))) return null;
    const assignments = dated.currentSchedule?.[work.date]?.[log.branch]?.scheduled || {};
    const slots = configs.filter(shift => names.has(nameKey(assignments[shift.id])));
    if (slots.length !== 1) return null;
    const target=slots[0],targetShiftId=target.id,reconcile=original.wasScheduled!==true||targetShiftId!==original.shiftId;
    if(reconcile&&!snapshot)return null;
    const revisions = Array.isArray(archive) ? archive : archive.revisions || [], applied = [];
    let ordered;try{ordered=amendmentsForDate(schedule,workDate);}catch{return null;}
    const applicable = ordered.filter(event => event?.id && event.branch === log.branch && /^\d{4}-\d{2}-\d{2}$/.test(event.effectiveFrom||'') && /^\d{4}-\d{2}-\d{2}$/.test(event.effectiveTo||'')
        && event.effectiveFrom.slice(0,7) === workDate.slice(0,7) && event.effectiveTo.slice(0,7) === workDate.slice(0,7)
        && event.effectiveFrom <= workDate && event.effectiveTo >= workDate && revisions.some(revision => revision.revisionId === event.sourceRevisionId && revision.month === workDate.slice(0,7)));
    // Canonical amendment revisions link back to their immutable dated source.
    // A later ordinary schedule revision is outside this ancestry and stays authoritative.
    const basis = new Set([dated.scheduleRevisionId]);
    const sourceId = event => event.sourceDates?.[workDate] || event.sourceRevisionId;
    for (let pass=0;pass<=applicable.length;pass++)for(const event of applicable) {
        const source=sourceId(event),canonical=event.canonicalRevisionId;
        if(basis.has(source)||canonical&&basis.has(canonical)){basis.add(source);if(canonical)basis.add(canonical);}
    }
    const active = applicable.filter(event=>basis.has(sourceId(event))||event.canonicalRevisionId&&basis.has(event.canonicalRevisionId));
    let reconciler=null;
    if(reconcile) {
        const evidence=active.filter(event=>{
            const changes=event.changes||[],old=changes.filter(change=>change.shiftId===original.shiftId),assigned=changes.filter(change=>change.shiftId===targetShiftId);
            if(old.length!==1||assigned.length!==1)return false;
            const start=timeMinutes(old[0].beforeStart),end=timeMinutes(old[0].beforeEnd);
            if(start===null||end===null||+original.expectedStartAt!==work.midnight+start*minute||+original.expectedEndAt!==work.midnight+(end+(end<=start?1440:0))*minute)return false;
            const source=revisions.find(revision=>revision.revisionId===sourceId(event)),day=source?.daySnapshots?.[workDate];
            const oldRules=source?.snapshot?.branchConfig?.[log.branch]?.filter(rule=>rule.id===original.shiftId)||[],savedAssignments=day?.daySchedule?.[log.branch]?.scheduled;
            const assignedRules=source?.snapshot?.branchConfig?.[log.branch]?.filter(rule=>names.has(nameKey(savedAssignments?.[rule.id])))||[];
            const times=oldRules.length===1?shiftTimes(oldRules[0]):{};
            return day?.configRevisionId===source?.revisionId&&assignedRules.length===1&&assignedRules[0].id===targetShiftId&&times.start===start&&times.end===end;
        });
        reconciler=evidence.find(event=>event.reconcileSavedAssignments===true);
        if(!reconciler)return evidence.length?{...original,amendmentNeedsReview:true,needsScheduleReview:true,assignmentReconciliationRequired:true,attendanceCorrectionVerified:false,originalShiftId:original.shiftId,targetShiftId,workDate,scheduleSource:'shift-amendment-review'}:null;
    }
    let start=null,end=null,snapshotMatched=!snapshot||reconcile;
    for (const event of reconcile?active.slice(active.indexOf(reconciler)):active) {
        const revision = revisions.find(row=>row.revisionId===sourceId(event)), savedDay=revision?.daySnapshots?.[workDate];
        const sourceConfigs=revision?.snapshot?.branchConfig?.[log.branch],sourceAssignments=savedDay?.configRevisionId===revision?.revisionId?savedDay.daySchedule?.[log.branch]?.scheduled:null;
        const own = Array.isArray(sourceConfigs)&&sourceAssignments?sourceConfigs.filter(shift=>names.has(nameKey(sourceAssignments[shift.id]))):[];
        if(own.length!==1||own[0].id!==targetShiftId)continue;
        const before=shiftTimes(own[0]);
        if(before.start===null||before.end===null)continue;
        if(start===null) {
            start=before.start;end=before.end;
        }
        const changes = (Array.isArray(event.changes)?event.changes:[]).filter(change => change.shiftId === targetShiftId);
        if (changes.length !== 1) continue;
        const change = changes[0], beforeStart = timeMinutes(change.beforeStart), beforeEnd = timeMinutes(change.beforeEnd), nextStart = timeMinutes(change.startTime), nextEnd = timeMinutes(change.endTime);
        const duration = nextStart === null || nextEnd === null ? 0 : (nextEnd-nextStart+1440)%1440;
        if (beforeStart !== start || beforeEnd !== end || nextStart === null || nextEnd === null || duration < 60 || duration > 18*60) continue;
        if(snapshot&&!snapshotMatched&&+original.expectedStartAt===work.midnight+start*minute&&+original.expectedEndAt===work.midnight+(end+(end<=start?1440:0))*minute)snapshotMatched=true;
        start = nextStart; end = nextEnd;if(snapshotMatched)applied.push(event.id);
    }
    if (!applied.length) return null;
    const expectedStartAt = new Date(work.midnight + start * minute), expectedEndAt = new Date(work.midnight + (end + (end <= start ? 1440 : 0)) * minute);
    const distance = (asDate(log.timestamp) - expectedStartAt) / minute;
    if (!Number.isFinite(distance) || distance < -90 || distance >= 18*60) return null;
    const correctedLateMinutes = Math.max(0,Math.floor(distance));
    const manual = manualLatenessReview(log);
    const corrected = {...original,shiftId:targetShiftId,shiftName:reconcile?target.name||original.shiftName:original.shiftName,shiftType:reconcile?shiftType(target):original.shiftType,isNightShift:reconcile?bonusShift(target):original.isNightShift,wasScheduled:true,expectedStartAt,expectedEndAt,expectedStartHour:start/60,correctedLateMinutes,
        lateMinutes:manual?attendanceLateMinutes(log,original.lateMinutes):correctedLateMinutes,
        attendanceCorrectionVerified:true,amendmentNeedsReview:manual,needsScheduleReview:manual,
        scheduleSource:'shift-amendment',scheduleAmendmentId:applied.at(-1),scheduleAmendmentIds:applied,workDate,
        originalShiftId:original.shiftId,targetShiftId,assignmentReconciled:reconcile,amendmentReason:reconciler?.reason||active.find(event=>event.id===applied.at(-1))?.reason||'',
        originalExpectedStartAt:original.expectedStartAt,originalExpectedEndAt:original.expectedEndAt};
    return manual ? applyAttendanceAmendmentReview(log,corrected) : corrected;
}
function manualLatenessReview(log) {
    return log.reviewedLateMinutes != null || log.lateExempted === true || !!(log.lateReviewRequestId || log.lateDecision || log.lateReviewedAt || log.lateReviewedBy);
}
// Before the preservation rollout, keep the legacy unpaid calculation and label
// its missing evidence. Future clock-ins use their saved snapshot or the exact
// work-date revision, never another month's current rules.
export function resolveAttendanceShift(log, schedule, profiles = {}, staffNameOverride = log?.staffName) {
    if (!log || !staffNameOverride) return emptyAttendanceShift(log || {}, 'missing-history');
    const finish=shift=>rememberPayrollShift(shift,log,schedule,profiles,staffNameOverride);
    const relief = resolveReliefScheduleReview(log, profiles[staffNameOverride], staffNameOverride);
    const unreviewedRelief=validEmergencyReliefMarker(log.emergencyRelief,log.branch);
    const amended = resolveAttendanceAmendment(log, schedule, profiles, staffNameOverride);
    const priorReview=relief||amended;
    const snapshot = clockInSnapshotShift(log, staffNameOverride);
    const actual = asDate(log.timestamp), cutoff = schedule?.payrollHistoryEnforcedFrom;
    const enforced = cutoff ? asDate(typeof cutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? cutoff + 'T00:00:00+08:00' : cutoff) : null;
    const strict = enforced && Number.isFinite(+enforced) && Number.isFinite(+actual) && actual >= enforced;
    const trusted = closestTrustedShift(log.timestamp, log.branch, staffNameOverride, schedule, profiles);
    const legacy = resolveScheduledShift(log.timestamp, log.branch, staffNameOverride, schedule, profiles);
    const original=priorReview || snapshot || (trusted ? {...trusted,lateMinutes:attendanceLateMinutes(log,trusted.lateMinutes)} : strict ? emptyAttendanceShift(log,'missing-history') : legacy ? {...legacy,lateMinutes:attendanceLateMinutes(log,legacy.lateMinutes),needsScheduleReview:true,scheduleSource:'legacy-unverified',scheduleRevisionId:''} : emptyAttendanceShift(log,'legacy-unverified'));
    const error=schedule?.payrollShiftConfirmationErrors?.[log.id];
    if(error)return {...emptyAttendanceShift(log,'owner-shift-review'),payrollShiftConfirmationError:String(error)};
    const heads=schedule?.payrollShiftConfirmations;
    if(log.id&&heads&&Object.hasOwn(heads,log.id)){
        try{
            const head=heads[log.id],confirmed=resolveEmergencyShift(log,profiles[staffNameOverride],head);
            if(!confirmed||head.reviewedByEmail!==payrollOwnerEmail)throw Error('The saved assigned-hours review is not a verified Owner confirmation.');
            assertPayrollConfirmationOrder(log,schedule,priorReview,head);
            const sameBounds=+confirmed.expectedStartAt===+priorReview?.expectedStartAt&&+confirmed.expectedEndAt===+priorReview?.expectedEndAt;
            const category=sameBounds&&relief?{shiftType:relief.shiftType,isNightShift:relief.isNightShift,bonusCategoryVerified:true}:datedRuleCategory(schedule,log.branch,confirmed.expectedStartAt,confirmed.expectedEndAt);
            const lateMinutes=original.reliefReviewVerified||original.amendmentReviewVerified?original.lateMinutes:attendanceLateMinutes(log,original);
            return finish({...original,...confirmed,...category,lateMinutes,payrollHoursConfirmed:true,payrollConfirmationRevisionId:head.revisionId,payrollConfirmationVersion:head.version,amendmentNeedsReview:original.amendmentNeedsReview===true,needsScheduleReview:original.amendmentNeedsReview===true,bonusCategoryVerified:category.bonusCategoryVerified,originalExpectedStartAt:original.expectedStartAt,originalExpectedEndAt:original.expectedEndAt});
        }catch(error){return {...emptyAttendanceShift(log,'owner-shift-review'),payrollShiftConfirmationError:error.message||'The saved Owner hours need a fresh review.'};}
    }
    if(priorReview)return finish(priorReview);
    if(unreviewedRelief)return {...emptyAttendanceShift(log,'emergency-relief-review'),reliefNeedsReview:true,needsScheduleReview:true,lateMinutes:0};
    return finish(original);
}
function assertPayrollConfirmationOrder(log,schedule,review,head){
    if(!review||+review.expectedStartAt===attendanceMillis(head.expectedStartAt)&&+review.expectedEndAt===attendanceMillis(head.expectedEndAt))return;
    let recorded=[];
    if(review.reliefReviewVerified)recorded=[attendanceMillis(log.reliefScheduleReview?.reviewedAt)];
    else if(review.attendanceCorrectionVerified){const ids=new Set(review.scheduleAmendmentIds||[]);recorded=Object.values(schedule?.historyMonths||{}).flatMap(month=>month?.shiftAmendments||[]).filter(event=>ids.has(event.id)).map(event=>attendanceMillis(event.recordedAt));if(recorded.length!==ids.size)recorded.push(NaN);}
    const at=attendanceMillis(head.reviewedAt);
    if(!recorded.length||recorded.some(value=>!Number.isFinite(value)||value>=at))throw Error('The Owner hours conflict with a later or undated assigned-shift review. Reopen these exact attendance records before payroll.');
}

// An approval is tied to this freshly resolved object, never to a saved log's
// similarly named boolean or to a caller-supplied shift label.
const payrollShiftProofs=new WeakMap();
export const payrollOwnerHoursApproved=shift=>payrollShiftProofs.get(shift)?.owner===true;
function datedRules(schedule,branch,at){
    const local=parts(at);if(!local)return [];
    const workDate=dateKey(local),saved=resolveScheduleForDate(schedule,workDate),rules=saved?.branchConfig?.[branch];
    if(!saved?.scheduleRevisionId||!Array.isArray(rules))return [];
    const weekday=new Date(local.midnight+8*60*minute).getUTCDay();
    return rules.filter(rule=>rule.active!==false&&(!Array.isArray(rule.days)||rule.days.includes(weekday))).flatMap(rule=>{
        const times=shiftTimes(rule),duration=times.start===null||times.end===null?0:(times.end-times.start+1440)%1440;
        return duration<60||duration>1080?[]:[{rule,workDate,saved,start:new Date(local.midnight+times.start*minute),end:new Date(local.midnight+(times.start+duration)*minute)}];
    });
}
function datedRuleCategory(schedule,branch,start,end){
    const matches=datedRules(schedule,branch,start).filter(row=>+row.start===+start&&+row.end===+end),first=matches[0];
    if(!first||matches.some(row=>shiftType(row.rule)!==shiftType(first.rule)||bonusShift(row.rule)!==bonusShift(first.rule)))return {shiftType:'other',isNightShift:false,bonusCategoryVerified:false};
    return {shiftType:shiftType(first.rule),isNightShift:bonusShift(first.rule),bonusCategoryVerified:true,matchingShiftIds:matches.map(row=>row.rule.id)};
}
function rememberPayrollShift(shift,log,schedule,profiles,name){
    const begin=attendanceMillis(shift?.expectedStartAt),end=attendanceMillis(shift?.expectedEndAt),valid=Number.isFinite(begin)&&Number.isFinite(end)&&end>begin&&end-begin<=18*3600000&&!shift.needsScheduleReview&&!shift.amendmentNeedsReview;
    const owner=valid&&(shift.reliefReviewVerified===true||shift.payrollHoursConfirmed===true),person=profiles[name]||{},personId=person.staffId||person.id;
    const names=new Set([name,person.cashierName,person.scheduleNickname,person.nickname].filter(Boolean).map(nameKey));
    const assigned=valid&&(!log.staffId||String(log.staffId)===String(personId))&&datedRules(schedule,log.branch,new Date(begin)).some(row=>+row.start===begin&&+row.end===end&&names.has(nameKey(row.saved.currentSchedule?.[Number(row.workDate.slice(-2))]?.[log.branch]?.scheduled?.[row.rule.id])));
    const approved=valid&&(owner||assigned),spanHours=valid?(end-begin)/3600000:0;
    const identityValid=(log.staffId?personId&&String(log.staffId)===String(personId):names.has(nameKey(log.staffName)))&&typeof log.branch==='string'&&Boolean(log.branch.trim());
    const proof={approved,owner,identityValid,sourceStaffId:log.staffId||personId||null,categoryOverride:owner&&shift.bonusCategoryVerified!==false,straightApproved:owner&&spanHours>=16,spanHours,start:begin,end,nightCategoryApproved:valid&&shift.isNightShift===true&&(approved||shift.wasScheduled===true)&&shift.bonusCategoryVerified!==false,coverageContext:{schedule,branch:log.branch,actualStart:attendanceMillis(log.timestamp)},candidateNightCoverage:null,source:owner?shift.scheduleSource:assigned?'dated-assignment':'saved-clock-in',revisionId:shift.payrollConfirmationRevisionId||shift.scheduleRevisionId||''};
    payrollShiftProofs.set(shift,proof);return shift;
}
function payrollNightCoverage(proof){
    if(!proof)return [];
    if(proof.candidateNightCoverage)return proof.candidateNightCoverage;
    const {schedule,branch,actualStart}=proof.coverageContext,rows=[];
    for(const offset of [-1,0,1])for(const row of datedRules(schedule,branch,new Date(actualStart+offset*day)))if(bonusShift(row.rule))rows.push({shiftId:row.rule.id,shiftType:shiftType(row.rule),start:+row.start,end:+row.end,workDate:row.workDate,revisionId:row.saved.scheduleRevisionId});
    proof.candidateNightCoverage=rows;return rows;
}

// This category is for the flat worked-shift bonus only. The saved assignment
// remains authoritative for wage dates, lateness and separate Owner reviews.
function actualWorkBonus(profile,shift,proof,start,end){
    const workedHours=(end-start)/3600000;
    const basis={version:1,status:'review',source:'actual-punches',templateSource:null,shiftType:null,actualStartAt:new Date(start).toISOString(),actualEndAt:new Date(end).toISOString(),workedHours,overlapHours:null,workDate:null,scheduleRevisionId:null,matchingShiftIds:[]};
    const review=reason=>({eligible:false,basis,reason});
    if(shift?.payrollShiftConfirmationError||shift?.reliefNeedsReview||shift?.amendmentNeedsReview||shift?.assignmentReconciliationRequired)return review('The saved Owner attendance review must be confirmed before calculating this bonus.');
    const profileId=profile?.staffId??profile?.id;
    if(!proof?.identityValid||proof.coverageContext.actualStart!==start||profileId!=null&&proof.sourceStaffId!=null&&String(profileId)!==String(proof.sourceStaffId))return review('The actual punch identity and its saved branch source need payroll review.');
    const ownerOverlap=Math.max(0,Math.min(end,proof.end)-Math.max(start,proof.start));
    if(proof.categoryOverride&&ownerOverlap>(end-start)/2){
        const eligible=proof.nightCategoryApproved===true;
        return {eligible,reason:'',basis:{...basis,status:eligible?'qualified':'not-qualified',source:'owner-review',templateSource:'owner-review',shiftType:shiftType(shift),overlapHours:ownerOverlap/3600000,workDate:dateKey(parts(shift.expectedStartAt)),scheduleRevisionId:proof.revisionId||null,matchingShiftIds:typeof shift.shiftId==='string'?[shift.shiftId.slice(0,100)]:[]}};
    }
    const {schedule,branch}=proof.coverageContext,local=parts(new Date(start)),published=publishedPayrollTemplates(schedule,branch),candidates=[];
    let malformed=false;
    for(const offset of [-1,0,1]){
        const midnight=local.midnight+offset*day,workDate=dateKey(parts(new Date(midnight))),saved=resolveScheduleForDate(schedule,workDate);
        const dated=saved?.branchConfig?.[branch],rules=Array.isArray(dated)?dated:published?.rules,templateSource=Array.isArray(dated)?'dated':published?'current-published':null;
        if(!Array.isArray(rules))continue;
        const weekday=new Date(midnight+8*60*minute).getUTCDay(),ids=new Set();
        for(const rule of rules){
            if(rule?.active===false)continue;
            const times=rule&&typeof rule==='object'&&!Array.isArray(rule)?shiftTimes(rule):{},duration=times.start==null||times.end==null?0:(times.end-times.start+1440)%1440;
            if(!rule||typeof rule.id!=='string'||!rule.id||rule.id.length>100||ids.has(rule.id)||rule.active!==undefined&&rule.active!==true||rule.shiftType!==undefined&&!['morning','mid','night','other'].includes(rule.shiftType)||rule.days!==undefined&&(!Array.isArray(rule.days)||rule.days.some(value=>!Number.isInteger(value)||value<0||value>6))||duration<60||duration>1080){malformed=true;continue;}
            ids.add(rule.id);
            if(Array.isArray(rule.days)&&!rule.days.includes(weekday))continue;
            const begin=midnight+times.start*minute,finish=begin+duration*minute,overlap=Math.max(0,Math.min(end,finish)-Math.max(start,begin));
            if(overlap)candidates.push({id:rule.id,shiftType:shiftType(rule),eligible:bonusShift(rule),overlap,workDate,templateSource,scheduleRevisionId:templateSource==='dated'?saved.scheduleRevisionId||null:published.scheduleRevisionId});
        }
    }
    if(malformed)return review('A saved branch shift window is incomplete or conflicting. Review the actual-work bonus category.');
    if(!candidates.length)return review('No saved branch shift window covers these actual punches. Review the actual-work bonus category.');
    const datedCandidates=candidates.filter(row=>row.templateSource==='dated'),preferred=datedCandidates.some(row=>row.overlap>(end-start)/2)?datedCandidates:candidates;
    const best=Math.max(...preferred.map(row=>row.overlap)),winners=preferred.filter(row=>row.overlap===best);
    const first=winners[0],revisions=[...new Set(winners.map(row=>row.scheduleRevisionId))];
    Object.assign(basis,{overlapHours:best/3600000,templateSource:winners.some(row=>row.templateSource==='current-published')?'current-published':'dated',workDate:first.workDate,scheduleRevisionId:revisions.length===1?revisions[0]:null,matchingShiftIds:[...new Set(winners.map(row=>row.id))].sort().slice(0,20)});
    if(best<=(end-start)/2)return review('No saved shift window covers a majority of the actual worked hours. Review the actual-work bonus category.');
    const eligible=winners.every(row=>row.eligible),ineligible=winners.every(row=>!row.eligible);
    if(!eligible&&!ineligible)return review('Morning/Other and Mid/Night windows equally match these actual hours. Owner review is required for the bonus category.');
    const types=[...new Set(winners.map(row=>row.shiftType))];
    return {eligible,reason:'',basis:{...basis,status:eligible?'qualified':'not-qualified',shiftType:types.length===1?types[0]:eligible?'mid-night':'other'}};
}

export function calculateShiftEarnings(profile,shift,timeIn,timeOut,{autoClosed=false}={}){
    const start=attendanceMillis(timeIn),end=attendanceMillis(timeOut),hoursWorked=(end-start)/3600000;
    if(!Number.isFinite(hoursWorked)||hoursWorked<0||hoursWorked>18)throw Error('Confirm the linked actual Time In and Time Out before calculating pay.');
    const ignored=hoursWorked===0||hoursWorked<1&&!autoClosed,proof=payrollShiftProofs.get(shift),over16=hoursWorked>16;
    const approvedStraight=!ignored&&over16&&proof?.straightApproved===true,shiftMultiplier=ignored?0:approvedStraight?2:1;
    let rate=null,salaryReviewReason='';
    try{rate=staffRateForDate(profile,shift?.expectedStartAt||profile?.salaryWorkDate||timeIn);if(rate===null)salaryReviewReason='No confirmed daily wage is available for this work date.';}
    catch(error){salaryReviewReason=error.message||'The salary history needs review.';}
    const basicPay=rate===null?null:Math.round(Math.max(0,Number(rate))*shiftMultiplier*100)/100;
    const coverage=over16?payrollNightCoverage(proof):[],covered=approvedStraight&&coverage.find(row=>row.start>=proof.start&&row.end<=proof.end&&start<=row.start&&end>=row.end);
    let nightEligible=hoursWorked>=8&&(proof?.nightCategoryApproved===true||!!covered),bonusBasis=null,bonusReviewReason='';
    const configuredNightRate=nightRate(profile);
    let bonusReviewRequired=!ignored&&hoursWorked>=8&&configuredNightRate>0&&(!proof||shift?.needsScheduleReview===true||shift?.amendmentNeedsReview===true||shift?.bonusCategoryVerified===false||shift?.isNightShift===true&&!proof.nightCategoryApproved)&&!covered;
    if(!ignored&&!autoClosed&&hoursWorked>=8&&!over16){
        const actual=actualWorkBonus(profile,shift,proof,start,end);nightEligible=actual.eligible;bonusBasis=actual.basis;bonusReviewReason=actual.reason;bonusReviewRequired=configuredNightRate>0&&Boolean(actual.reason);
    }
    const nightBonus=!ignored&&nightEligible?configuredNightRate:0;
    const candidate=over16&&!ignored&&coverage.find(row=>start<=row.start&&end>=row.end);
    const straightApprovalRequired=!ignored&&over16&&!approvedStraight;
    return {hoursWorked,shiftMultiplier,basicPay,salaryReviewRequired:rate===null,salaryReviewReason,straightBonus:approvedStraight?50:0,nightBonus,bonusShiftType:nightBonus>0?(bonusBasis?.shiftType||covered?.shiftType||shift?.shiftType||'night'):null,shortHours:!ignored&&hoursWorked<8?8-hoursWorked:0,straightApprovalRequired,pendingStraightReview:straightApprovalRequired,bonusReviewRequired,bonusReviewReason,bonusBasis,ignored,approvalSource:approvedStraight?proof.source:null,approvalRevisionId:approvedStraight?proof.revisionId:null,nightCoverage:covered||null,straightReviewNightBonus:candidate?configuredNightRate:0,straightReviewNightCoverage:candidate||null};
}
// Capture once when recording TIME IN. The serialized expected timestamps and
// category keep future schedule edits from changing that attendance's pay math.
// New punches require an exact dated assignment. The legacy nearest-rule
// calculator above is retained for preserved records; it is not proof that a
// newly clocking-in employee was assigned to that rule.
const captureNameKey = value => nameKey(value).normalize('NFKC');
const captureProfileId = profile => {
    const value = profile?.staffId || profile?.id;
    return typeof value === 'string' && value.trim() && !/[\/\0]/.test(value) ? value.trim() : '';
};
const captureAliases = profile => [profile?.name, profile?.fullName, profile?.cashierName,
    profile?.scheduleNickname, profile?.scheduleName, profile?.nickname,
    ...(Array.isArray(profile?.scheduleAliases) ? profile.scheduleAliases : [])].filter(value => typeof value === 'string' && value.trim());
function exactClockInAssignment(actual, branch, staffName, schedule, profiles) {
    const local = parts(actual), profile = profiles[staffName] || {}, staffId = captureProfileId(profile);
    if (!local) return {reason:'missing-schedule-history'};
    const currentNames = [staffName, profile.cashierName, profile.scheduleNickname, profile.scheduleName, profile.nickname].filter(Boolean);
    const candidates = [], issues = []; let sawSavedDay = false;
    for (const offset of [-1, 0, 1]) {
        const midnight = local.midnight + offset * day, workDay = parts(new Date(midnight)), workDate = dateKey(workDay);
        const archived = schedule?.historyMonths ? resolveScheduleForDate(schedule, workDate) : null;
        const saved = archived || (+schedule?.currentYear === workDay.year && +schedule?.currentMonth === workDay.month ? schedule : null);
        if (!saved || +saved.currentYear !== workDay.year || +saved.currentMonth !== workDay.month) continue;
        sawSavedDay = true;
        const rules = saved.branchConfig?.[branch], assignments = saved.currentSchedule?.[workDay.date]?.[branch]?.scheduled;
        if (!Array.isArray(rules) || !assignments || typeof assignments !== 'object' || Array.isArray(assignments)) continue;
        const savedPeople = Array.isArray(saved.employees) ? saved.employees : [];
        // Only an explicit same-account link may add an older saved alias.
        const bound = staffId ? savedPeople.filter(person => captureProfileId(person) === staffId) : [];
        const names = new Set([...currentNames, ...bound.flatMap(captureAliases)].map(captureNameKey));
        const own = Object.entries(assignments).filter(([, assigned]) => typeof assigned === 'string' && names.has(captureNameKey(assigned)));
        if (!own.length) continue;
        const weekday = new Date(midnight + 8 * 60 * minute).getUTCDay();
        const slots = own.map(([shiftId, assigned]) => {
            const matches = rules.filter(rule => String(rule.id) === shiftId), rule = matches.length === 1 ? matches[0] : null;
            const times = rule ? shiftTimes(rule) : {start:null, end:null};
            const duration = times.start === null || times.end === null ? 0 : (times.end - times.start + 1440) % 1440;
            const startAt = times.start === null ? null : new Date(midnight + times.start * minute);
            const endAt = startAt && duration ? new Date(+startAt + duration * minute) : null;
            const diff = startAt ? (actual - startAt) / minute : null;
            const plausible = diff !== null && diff >= -90 && diff < 18 * 60 && (!endAt || actual <= endAt);
            const conflict = [...savedPeople, ...Object.values(profiles)].some(person => {
                const otherId = captureProfileId(person);
                return otherId && (!staffId || otherId !== staffId)
                    && captureAliases(person).some(alias => captureNameKey(alias) === captureNameKey(assigned));
            });
            const reason = conflict ? 'dated-staff-identity-conflict' : !rule || typeof rule.id !== 'string' || !rule.id.trim() || /[\/\0]/.test(rule.id) || duration < 60 || duration > 18 * 60 ? 'invalid-dated-shift'
                : rule.active === false ? 'inactive-dated-shift' : Array.isArray(rule.days) && !rule.days.includes(weekday) ? 'dated-assignment-disabled-day' : '';
            return {rule, startAt, endAt, diff, plausible, reason};
        });
        // An older completed overnight assignment must not override today's
        // morning assignment. A second distinct slot on the same plausible
        // workday, however, must be reviewed rather than selected by proximity.
        if (!slots.some(slot => slot.plausible) && !(offset === 0 && slots.some(slot => !slot.startAt))) continue;
        if (slots.some(slot => slot.reason)) { issues.push(slots.find(slot => slot.reason).reason); continue; }
        const first = slots[0];
        const same = slots.every(slot => +slot.startAt === +first.startAt && +slot.endAt === +first.endAt
            && shiftType(slot.rule) === shiftType(first.rule) && bonusShift(slot.rule) === bonusShift(first.rule));
        if (!same) { issues.push('conflicting-dated-assignment'); continue; }
        if (!first.plausible) continue;
        candidates.push({shiftId:slots.length === 1 ? first.rule.id : null,
            shiftName:slots.length === 1 ? first.rule.name || '' : `${shiftType(first.rule)[0].toUpperCase() + shiftType(first.rule).slice(1)} shift`,
            shiftType:shiftType(first.rule), expectedStartAt:first.startAt, expectedEndAt:first.endAt,
            isNightShift:bonusShift(first.rule), lateMinutes:Math.max(0, Math.floor(first.diff)), wasScheduled:true,
            needsScheduleReview:false, scheduleRevisionId:saved.scheduleRevisionId || saved.revisionId || ''});
    }
    if (issues.length) return {reason:issues[0]};
    if (candidates.length > 1) return {reason:'conflicting-dated-assignment'};
    return candidates.length ? {matched:candidates[0], reason:''} : {reason:sawSavedDay ? 'missing-dated-assignment' : 'missing-schedule-history'};
}
export function captureAttendanceSchedule(logDate, branch, staffName, schedule, profiles = {}) {
    const actual = asDate(logDate), exact = exactClockInAssignment(actual, branch, staffName, schedule, profiles);
    // Retain inferred timestamps only as evidence for management or a separately
    // checked completion bound. They cannot establish assignment or lateness.
    const matched = exact.matched || closestTrustedShift(actual, branch, staffName, schedule, profiles, true);
    const review = !exact.matched || exact.matched.needsScheduleReview === true;
    const clockInAt = Number.isFinite(+actual) ? actual.toISOString() : '';
    return { version: 1, source: 'clock-in', branch: String(branch || ''), staffName: String(staffName || ''), clockInAt,
        capturedAt: clockInAt, expectedStartAt: matched?.expectedStartAt?.toISOString() || '', expectedEndAt: matched?.expectedEndAt?.toISOString() || '',
        shiftId: matched?.shiftId ?? null, shiftName: matched?.shiftName || '', shiftType: matched?.shiftType || 'other',
        isNightShift: matched?.isNightShift === true, wasScheduled: !review && matched?.wasScheduled === true,
        lateMinutes: review ? 0 : matched?.lateMinutes ?? 0, needsScheduleReview: review, scheduleReviewReason:exact.reason,
        scheduleRevisionId: matched?.scheduleRevisionId || '' };
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
    if(shift?.reliefNeedsReview===true)return {hours:0,ratePerHour:0,amount:0};
    if(shift?.reliefReviewVerified===true)exempt=shift.reliefLateExempted===true;
    else if(shift?.amendmentReviewVerified===true)exempt=shift.amendmentLateExempted===true;
    const minutes = Math.max(0, Number(minutesLate) || 0);
    const hours = Math.ceil(minutes / 60);
    const daily = Math.max(0, Number(staffRateForDate(profile,shift?.expectedStartAt || profile.salaryWorkDate || new Date())) || 0);
    const ratePerHour = (daily + (shift?.isNightShift ? nightRate(profile) : 0)) / 8;
    return { hours, ratePerHour, amount: exempt ? 0 : Math.round(hours * ratePerHour * 100) / 100 };
}
export function earnedNightBonus(profile, shift, timeOut, timeIn) {
    if(timeIn!==undefined)return calculateShiftEarnings(profile,shift,timeIn,timeOut).nightBonus;
    return shift?.isNightShift && shift.expectedEndAt && asDate(timeOut) >= shift.expectedEndAt ? nightRate(profile) : 0;
}
export function attendanceLateMinutes(log, calculated = 0) {
    if (calculated && typeof calculated === 'object') {
        if(calculated.reliefNeedsReview===true)return 0;
        if(calculated.reliefReviewVerified===true)return Math.max(0,Number(calculated.lateMinutes)||0);
        if(calculated.amendmentReviewVerified===true)return Math.max(0,Number(calculated.lateMinutes)||0);
        if (calculated.attendanceCorrectionVerified === true && !calculated.amendmentNeedsReview
            && !manualLatenessReview(log)) return Math.max(0,Number(calculated.correctedLateMinutes)||0);
        calculated = calculated.lateMinutes ?? 0;
    }
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
