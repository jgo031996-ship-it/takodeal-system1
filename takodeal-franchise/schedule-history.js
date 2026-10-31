import {normalizeShiftAmendment,shiftAmendmentFingerprint,shiftAmendmentRuleTimes,amendmentsForDate,applyShiftAmendments} from './shift-amendments.js';
export {shiftAmendmentFingerprint,amendmentsForDate,applyShiftAmendments} from './shift-amendments.js';
// Schedule history is keyed by the Philippine work date, not the month currently open in the editor.
const SNAPSHOT_KEYS = ['branchConfig', 'employees', 'unavailability', 'currentSchedule', 'currentYear', 'currentMonth', 'holidays'];
const clone = value => JSON.parse(JSON.stringify(value));
const pad = value => String(value).padStart(2, '0');
const monthId = month => `schedule_month_${month.replace('-', '_')}`;
const amendmentsDocId=month=>`schedule_shift_amendments_${month.replace('-','_')}`;
const revisionDocId = id => `schedule_revision_${id}`;
function signature(value) {
    if (Array.isArray(value)) return '[' + value.map(signature).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + signature(value[key])).join(',') + '}';
    return JSON.stringify(value);
}

function instant(value) {
    const date = value?.toDate ? value.toDate() : value?.seconds !== undefined ? new Date(value.seconds * 1000) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Use a valid schedule date.');
    return date;
}
export function scheduleDateKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number), check = new Date(Date.UTC(year, month - 1, day));
        if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw new Error('Use a valid schedule date.');
        return value;
    }
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(instant(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
export function monthKey(value) {
    if (value && typeof value === 'object' && value.currentYear !== undefined) {
        const year = Number(value.currentYear), month = Number(value.currentMonth);
        if (!Number.isInteger(year) || year < 2000 || year > 2199 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Select a valid schedule month.');
        return `${year}-${pad(month)}`;
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) {
        const [year, month] = value.split('-').map(Number);
        return monthKey({currentYear: year, currentMonth: month});
    }
    return monthKey(scheduleDateKey(value).slice(0, 7));
}
function monthEnd(month) {
    const [year, number] = month.split('-').map(Number);
    return `${month}-${pad(new Date(Date.UTC(year, number, 0)).getUTCDate())}`;
}
function nextDate(date) { const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10); }
export function defaultScheduleEffectiveFrom(snapshot, now = new Date()) {
    const start = `${monthKey(snapshot)}-01`, today = scheduleDateKey(now);
    return start > today ? start : today;
}
function wallTime(value) {
    const match = String(value || '').trim().replace(/\s+/g, '').toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(am|pm|nn)?$/);
    if (!match) return null;
    let hour = Number(match[1]), minute = Number(match[2] || 0);
    if (minute > 59 || hour > (match[3] ? 12 : 23) || match[3] && hour < 1) return null;
    if (match[3]) { hour %= 12; if (match[3] !== 'am') hour += 12; }
    return `${pad(hour)}:${pad(minute)}`;
}
function snapshotData(input, {legacy = false} = {}) {
    const month = monthKey(input), output = {};
    for (const key of SNAPSHOT_KEYS) if (input[key] !== undefined) output[key] = clone(input[key]);
    output.currentYear = Number(month.slice(0, 4)); output.currentMonth = Number(month.slice(5));
    output.branchConfig ||= {}; output.currentSchedule ||= {};
    if (Array.isArray(output.branchConfig) || !output.branchConfig || typeof output.branchConfig !== 'object' || Array.isArray(output.currentSchedule) || typeof output.currentSchedule !== 'object') throw new Error('The schedule snapshot is incomplete.');
    for (const [branch, shifts] of Object.entries(output.branchConfig)) {
        if (!Array.isArray(shifts)) throw new Error(`${branch}: the saved shift list is invalid.`);
        const ids = new Set();
        for (const shift of shifts) {
            const label = String(shift.name || '').match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))/i);
            const start = wallTime(shift.startTime) ?? wallTime(label?.[1]), end = wallTime(shift.endTime) ?? wallTime(label?.[2]);
            if (!legacy && (!shift.id || ids.has(shift.id))) throw new Error(`${branch}: each shift needs a unique ID.`);
            ids.add(shift.id);
            if (!legacy && shift.active !== false && (!start || !end)) throw new Error(`${branch}: set both Time In and Time Out for ${shift.name || 'each shift'}.`);
            if (start) shift.startTime = start; if (end) shift.endTime = end;
        }
    }
    for (const day of Object.keys(output.currentSchedule)) if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > Number(monthEnd(month).slice(-2))) {
        if (!legacy) throw new Error('A schedule day does not belong to the selected month.');
    }
    return output;
}
function historicalLeaveAudit(snapshot, {review, revisionId, from, to, savedAt, actor, source, today}) {
    const fail = () => { throw new Error('Historical leave requires a reviewed one-day saved schedule source. No past shift rules were reconstructed.'); };
    const validId = (value, maximum = 120) => typeof value === 'string' && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value);
    const nameKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!review || typeof review !== 'object' || Array.isArray(review) || source !== 'approved-leave' || from !== to || from >= today
        || !validId(review.staffId) || !validId(review.requestId) || !validId(review.operationId, 80)
        || typeof review.reason !== 'string' || review.reason.trim().length < 3 || review.reason.trim().length > 1500
        || typeof actor !== 'string' || !actor.trim() || actor.length > 320
        || !Array.isArray(review.staffNames) || !review.staffNames.length || review.staffNames.length > 20
        || review.staffNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)
        || new Set(review.staffNames.map(nameKey)).size !== review.staffNames.length) fail();
    const staffNames = new Set(review.staffNames.map(nameKey)), isStaffName = name => typeof name === 'string' && staffNames.has(nameKey(name));
    const basis = review.basis;
    if (!basis || typeof basis !== 'object' || basis.snapshotDate !== from || !validId(basis.scheduleRevisionId, 100)
        || basis.scheduleRevisionId === revisionId || typeof basis.scheduleSource !== 'string' || !basis.scheduleSource.trim()
        || basis.scheduleSource.trim().toLowerCase() === 'unverified' || !basis.scheduleEffectiveFrom || !basis.scheduleEffectiveTo) fail();
    const basisFrom = scheduleDateKey(basis.scheduleEffectiveFrom), basisTo = scheduleDateKey(basis.scheduleEffectiveTo);
    if (basisFrom > from || basisTo < from || basisFrom.slice(0, 7) !== from.slice(0, 7) || basisTo.slice(0, 7) !== from.slice(0, 7)
        || monthKey(basis) !== from.slice(0, 7) || instant(savedAt) < instant(from + 'T00:00:00+08:00')) fail();
    const original = snapshotData(basis), day = String(Number(from.slice(-2)));
    if (signature(Object.keys(original.currentSchedule).sort()) !== signature([day])
        || signature(Object.keys(snapshot.currentSchedule).sort()) !== signature([day])) fail();
    // Historical leave changes availability only. The real dated source keeps
    // every shift rule, employee, holiday and other configuration unchanged.
    for (const key of SNAPSHOT_KEYS.filter(key => !['currentSchedule', 'unavailability'].includes(key))) {
        if (signature(original[key]) !== signature(snapshot[key])) fail();
    }
    const owns = row => row && typeof row === 'object' && row.staffId === review.staffId && row.leaveRequestId === review.requestId;
    const flags = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const oldFlags = flags(original.unavailability?.[from]), newFlags = flags(snapshot.unavailability?.[from]);
    if ([...Object.entries(oldFlags), ...Object.entries(newFlags)].some(([name, row]) => owns(row) && !isStaffName(name))) fail();
    if (signature(Object.fromEntries(Object.entries(original.unavailability || {}).filter(([date]) => date !== from)))
        !== signature(Object.fromEntries(Object.entries(snapshot.unavailability || {}).filter(([date]) => date !== from)))) fail();
    if (signature(Object.fromEntries(Object.entries(oldFlags).filter(([, row]) => !owns(row))))
        !== signature(Object.fromEntries(Object.entries(newFlags).filter(([, row]) => !owns(row))))) fail();
    const before = original.currentSchedule?.[day] || {}, after = snapshot.currentSchedule?.[day] || {};
    if (Object.keys(before).some(branch => !Object.hasOwn(after, branch))) fail();
    for (const [branch, next] of Object.entries(after)) {
        const previous = before[branch] || {scheduled: {}, rest: [], unavailable: [], swaps: {}};
        if (!before[branch] && !Object.hasOwn(original.branchConfig, branch)) fail();
        if (!next || typeof next !== 'object' || Array.isArray(next)) fail();
        const other = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['scheduled', 'rest', 'unavailable', 'swaps'].includes(key)));
        if (signature(other(previous)) !== signature(other(next))) fail();
        const oldScheduled = previous.scheduled || {}, newScheduled = next.scheduled || {};
        if (signature(Object.keys(oldScheduled).sort()) !== signature(Object.keys(newScheduled).sort())) fail();
        const released = new Set();
        for (const [shiftId, name] of Object.entries(oldScheduled)) {
            if (signature(name) === signature(newScheduled[shiftId])) continue;
            if (!isStaffName(name) || newScheduled[shiftId] !== 'UNFILLED') fail();
            released.add(shiftId);
        }
        const oldRows = previous.unavailable || [], newRows = next.unavailable || [], oldRest = previous.rest || [], newRest = next.rest || [];
        if (![oldRows, newRows, oldRest, newRest].every(Array.isArray)
            || signature(oldRows.filter(row => !owns(row))) !== signature(newRows.filter(row => !owns(row)))) fail();
        const ownedRows = [...oldRows, ...newRows].filter(owns);
        if (ownedRows.some(row => !isStaffName(row.name)) || oldRest.some(name => !newRest.includes(name) && !isStaffName(name))) fail();
        const addedRest = newRest.filter(name => !oldRest.includes(name));
        if (addedRest.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)
            || addedRest.some(name => !isStaffName(name))) fail();
        const oldSwaps = previous.swaps || {}, newSwaps = next.swaps || {};
        if (Object.entries(newSwaps).some(([shiftId, value]) => !Object.hasOwn(oldSwaps, shiftId) || signature(value) !== signature(oldSwaps[shiftId]))
            || Object.keys(oldSwaps).some(shiftId => !Object.hasOwn(newSwaps, shiftId) && !released.has(shiftId))) fail();
        if (!ownedRows.length && signature(previous) !== signature(next)) fail();
    }
    const amendments = basis.scheduleAmendments || [];
    if (!Array.isArray(amendments) || amendments.some(row => !validId(row?.id, 100))) fail();
    return {schemaVersion: 1, workDate: from, recordedAt: instant(savedAt).toISOString(), basisRevisionId: basis.scheduleRevisionId,
        basisSource: basis.scheduleSource, staffId: review.staffId, requestId: review.requestId, operationId: review.operationId,
        reason: review.reason.trim(), ...(amendments.length ? {basisAmendmentIds: [...new Set(amendments.map(row => row.id))]} : {})};
}
export function createScheduleRevision(input, {revisionId, effectiveFrom, effectiveTo, savedAt = new Date(), actor = '', source = 'manager-save', cutover, historicalLeaveReview} = {}) {
    if (typeof revisionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(revisionId)) throw new Error('A valid schedule revision ID is required.');
    const legacy = source === 'legacy-capture', snapshot = snapshotData(input, {legacy}), month = monthKey(snapshot);
    const from = scheduleDateKey(effectiveFrom || defaultScheduleEffectiveFrom(snapshot, savedAt));
    const to = scheduleDateKey(effectiveTo || monthEnd(month)), today = scheduleDateKey(savedAt);
    if (!legacy && (from.slice(0, 7) !== month || to.slice(0, 7) !== month || from > to)) throw new Error('The effective dates must belong to the selected schedule month.');
    const leaveAudit = historicalLeaveReview === undefined ? null : historicalLeaveAudit(snapshot, {review: historicalLeaveReview, revisionId, from, to, savedAt, actor, source, today});
    if (!legacy && from < today && !leaveAudit) throw new Error('Schedule history starts with future changes. Past dates cannot be reconstructed from the current shift rules.');
    const daySnapshots = {};
    for (let date = from > `${month}-01` ? from : `${month}-01`; date <= to && date.slice(0, 7) === month; date = nextDate(date)) {
        const day = String(Number(date.slice(-2)));
        daySnapshots[date] = {configRevisionId: revisionId, daySchedule: clone(snapshot.currentSchedule[day] || {})};
    }
    const revision = {schemaVersion: 1, kind: 'schedule-revision', month, revisionId, effectiveFrom: from, effectiveTo: to,
        savedAt: instant(savedAt).toISOString(), actor: String(actor || ''), source,
        payrollHistoryEnforcedFrom: scheduleDateKey(cutover || savedAt), snapshot, daySnapshots,
        ...(leaveAudit ? {historicalLeaveReview: leaveAudit} : {})};
    if (new TextEncoder().encode(JSON.stringify(revision)).length > 950000) throw new Error('This schedule month is too large to archive safely. Reduce the schedule size before saving.');
    return revision;
}
export function resolveScheduleForDate(history, value, {amendments=true} = {}) {
    let date;
    try { date = scheduleDateKey(value); } catch { return null; }
    const month = date.slice(0, 7), archive = history?.historyMonths?.[month];
    const revisions = Array.isArray(archive) ? archive : archive?.revisions || (history?.month === month && Array.isArray(history?.revisions) ? history.revisions : []);
    const matching = revisions.filter(revision => revision?.month === month && revision.effectiveFrom <= date && revision.effectiveTo >= date && revision.daySnapshots?.[date]?.configRevisionId === revision.revisionId && revision.snapshot)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || (Number(b.sequence) || 0) - (Number(a.sequence) || 0) || b.savedAt.localeCompare(a.savedAt) || b.revisionId.localeCompare(a.revisionId));
    if (!matching.length) return null;
    const revision = matching[0], result = clone(revision.snapshot), day = String(Number(date.slice(-2))), selected = revision.daySnapshots[date];
    result.branchConfig = clone(revision.snapshot.branchConfig); result.currentSchedule = {[day]: clone(selected.daySchedule)};
    const saved = {...result, snapshotDate: date, scheduleRevisionId: revision.revisionId, scheduleSource: revision.source,
        scheduleEffectiveFrom: revision.effectiveFrom, scheduleEffectiveTo: revision.effectiveTo,
        payrollHistoryEnforcedFrom: history?.payrollHistoryEnforcedFrom || revision.payrollHistoryEnforcedFrom};
    return amendments ? applyShiftAmendments(saved,amendmentsForDate(history,date),date) : saved;
}
export function assembleScheduleHistory(current, archives = [], {enforcedFrom} = {}) {
    const result = clone(current || {}), months = {}, cutovers = [];
    for (const archive of Array.isArray(archives) ? archives : Object.values(archives || {})) {
        if (!archive?.month) continue;
        months[archive.month] = archive;
        for (const revision of archive.revisions || []) if (revision.payrollHistoryEnforcedFrom) cutovers.push(revision.payrollHistoryEnforcedFrom);
    }
    const cutover = enforcedFrom || current?.payrollHistoryEnforcedFrom || cutovers.sort()[0];
    return {...result, historyMonths: clone(months), ...(cutover ? {payrollHistoryEnforcedFrom: scheduleDateKey(cutover)} : {})};
}
function snapData(snapshot) { return snapshot?.exists?.() ? snapshot.data() : null; }
function savedAmendments(index,durable,month){
    const inline=index?.shiftAmendments||[],events=durable?.shiftAmendments??inline;
    if(!Array.isArray(inline)||!Array.isArray(events)||durable&&(!Array.isArray(durable.shiftAmendments)||durable.month!==month)||durable&&inline.some((event,i)=>shiftAmendmentFingerprint(event)!==shiftAmendmentFingerprint(events[i])))throw Error('The saved shift correction history is inconsistent. Reload for an HQ review.');
    amendmentsForDate({month,shiftAmendments:events},month+'-01');return clone(events);
}
function addRevision(index, revision) {
    return {...clone(index || {}),schemaVersion: 1, kind: 'schedule-month', month: revision.month,
        revisionIds: [...new Set([...(index?.revisionIds || []), revision.revisionId])], latestRevisionId: revision.revisionId,
        updatedAt: revision.savedAt, payrollHistoryEnforcedFrom: index?.payrollHistoryEnforcedFrom || revision.payrollHistoryEnforcedFrom};
}
// Flat settings documents use the existing settings access policy. No live data is touched until save/captureCurrent is called.
export function createScheduleHistoryStore(api, {now = () => new Date(), makeId = () => crypto.randomUUID()} = {}) {
    const ref = id => api.doc(api.db, 'settings', id), read = api.getDocFromServer || api.getDoc;
    if (typeof read !== 'function') throw new Error('Schedule history needs a server read API.');
    async function loadMonth(value) {
        const month = monthKey(value),[index,durable]=await Promise.all([read(ref(monthId(month))).then(snapData),read(ref(amendmentsDocId(month))).then(snapData)]);
        if(index?.revisionIds != null && !Array.isArray(index.revisionIds))throw Error('The saved schedule version index is incomplete.');
        const ids = [...new Set(index?.revisionIds || [])];
        const revisions = await Promise.all(ids.map(async id => {if(typeof id!=='string'||!id||id.length>100||id.includes('/'))throw Error('The saved schedule version index is incomplete.');const revision=snapData(await read(ref(revisionDocId(id))));if(!revision||revision.revisionId!==id||revision.month!==month||!revision.snapshot||monthKey(revision.snapshot)!==month)throw Error('The saved schedule version is incomplete.');return revision;}));
        if(index?.latestRevisionId&&!ids.includes(index.latestRevisionId))throw Error('The latest saved schedule version is incomplete.');
        const shiftAmendments=savedAmendments(index,durable,month);
        for(const event of shiftAmendments){
            if(!ids.includes(event.sourceRevisionId)||!event.canonicalRevisionId||!ids.includes(event.canonicalRevisionId)||!Array.isArray(event.sourceRevisionIds)||!event.sourceRevisionIds.length||event.sourceRevisionIds.some(id=>!ids.includes(id))||!event.sourceDates||Array.isArray(event.sourceDates)||!Object.keys(event.sourceDates).length)throw Error('The saved shift correction source is incomplete.');
            for(const [date,id]of Object.entries(event.sourceDates)){
                const source=revisions.find(row=>row.revisionId===id);
                if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<event.effectiveFrom||date>event.effectiveTo||!event.sourceRevisionIds.includes(id)||!source||source.daySnapshots?.[date]?.configRevisionId!==id||source.effectiveFrom>date||source.effectiveTo<date)throw Error('The dated shift correction source is incomplete.');
            }
        }
        revisions.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.savedAt.localeCompare(b.savedAt) || a.revisionId.localeCompare(b.revisionId));
        return {month, latestRevisionId: index?.latestRevisionId || null, revisions, latestRevision: revisions.find(revision => revision.revisionId === index?.latestRevisionId) || null,
            payrollHistoryEnforcedFrom: index?.payrollHistoryEnforcedFrom || null,shiftAmendments,indexFingerprint:shiftAmendmentFingerprint({index,durable})};
    }
    async function loadRange(from, to) {
        const start = monthKey(from), end = monthKey(to);
        if (start > end) throw new Error('The payroll date range is reversed.');
        const months = [];
        for (let month = start; month <= end;) {
            months.push(month); if (months.length > 24) throw new Error('Load at most 24 schedule months at once.');
            let [year, number] = month.split('-').map(Number); if (++number > 12) { year++; number = 1; } month = `${year}-${pad(number)}`;
        }
        const [current, policy, archives] = await Promise.all([read(ref('global_schedule')).then(snapData), read(ref('schedule_history_policy')).then(snapData), Promise.all(months.map(loadMonth))]);
        return assembleScheduleHistory(current, archives, {enforcedFrom: policy?.payrollHistoryEnforcedFrom});
    }
    async function amendShiftTimes(input,{expectedRevisionId,expectedHeadFingerprint,expectedIndexFingerprint,actor,authorize}={}) {
        const payload=normalizeShiftAmendment(input),recordedAt=instant(now()).toISOString(),today=scheduleDateKey(recordedAt),canonicalRevisionId=payload.id+'-current';
        const reviewer={uid:String(actor?.uid||'').trim(),email:String(actor?.email||'').trim().toLowerCase()};
        const sessionIdentity=()=>shiftAmendmentFingerprint([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.isOwner,api.sessionUser?.isFranchisee,api.sessionUser?.role,api.sessionUser?.permissions,api.sessionUser?.allowedBranches]);
        const capturedIdentity=sessionIdentity();
        const guard=()=>{const user=api.auth?.currentUser,session=api.sessionUser,role=String(session?.role||'').trim().toLowerCase();
            if(!reviewer.uid||!reviewer.email||!user?.uid||user.uid!==reviewer.uid||String(user.email||'').trim().toLowerCase()!==reviewer.email||session?.uid!==reviewer.uid||String(session.email||'').trim().toLowerCase()!==reviewer.email||session.isOwner!==true||session.isFranchisee===true||['franchisee','franchise owner'].includes(role)||sessionIdentity()!==capturedIdentity||typeof authorize!=='function'||authorize(payload.branch,payload)!==true)throw Error('Only the signed-in Owner can confirm this shift-time correction.');};
        guard();
        if(expectedRevisionId===undefined||typeof expectedHeadFingerprint!=='string'||typeof expectedIndexFingerprint!=='string')throw Error('Load a fresh schedule preview before confirming a correction.');
        if(payload.month!==today.slice(0,7)||payload.effectiveFrom>today||payload.effectiveTo!==monthEnd(payload.month))throw Error('This correction must start on or before today and continue through the current month end. Use normal schedule planning for other dates.');
        const intentFingerprint=shiftAmendmentFingerprint({...payload,actor:reviewer});
        return api.runTransaction(api.db,async tx=>{
            guard();const [index,current,policy,durable]=await Promise.all([tx.get(ref(monthId(payload.month))).then(snapData),tx.get(ref('global_schedule')).then(snapData),tx.get(ref('schedule_history_policy')).then(snapData),tx.get(ref(amendmentsDocId(payload.month))).then(snapData)]);guard();
            if(!index||!Array.isArray(index.revisionIds)||!Array.isArray(index.shiftAmendments||[])||!current||monthKey(current)!==payload.month)throw Error('This saved month or its current head is incomplete. Reload before correcting shift times.');
            const previous=savedAmendments(index,durable,payload.month),saved=previous.find(row=>row.id===payload.id);
            if(saved){
                if(saved.intentFingerprint!==intentFingerprint)throw Error('This correction reference was already used with different details.');
                if(!saved.canonicalRevisionId||!index.revisionIds.includes(saved.canonicalRevisionId))throw Error('The saved correction revision is incomplete. Reload for an HQ history review.');
                const proof=snapData(await tx.get(ref(revisionDocId(saved.canonicalRevisionId))));guard();
                if(!proof||proof.revisionId!==saved.canonicalRevisionId||proof.month!==payload.month||!proof.snapshot)throw Error('The saved correction revision is incomplete. Reload for an HQ history review.');
                return {amendment:clone(saved),month:payload.month,latestRevisionId:index.latestRevisionId||null,alreadySaved:true};
            }
            if((index.latestRevisionId||null)!==expectedRevisionId||shiftAmendmentFingerprint({index,durable})!==expectedIndexFingerprint||shiftAmendmentFingerprint(current)!==expectedHeadFingerprint)throw Error('The saved schedule changed after this preview. Reload before confirming the correction.');
            const ids=[...new Set(index.revisionIds)];if(!ids.length||!ids.includes(index.latestRevisionId)||!ids.includes(payload.sourceRevisionId)||!ids.includes(current.scheduleRevisionId)||previous.length>=100)throw Error('The saved shift correction source is incomplete or needs an HQ history review.');
            const revisions=await Promise.all(ids.map(async id=>{if(typeof id!=='string'||!id||id.length>100||id.includes('/'))throw Error('The saved schedule source is incomplete.');const revision=snapData(await tx.get(ref(revisionDocId(id))));if(!revision||revision.revisionId!==id||revision.month!==payload.month||!revision.snapshot||monthKey(revision.snapshot)!==payload.month)throw Error('The saved schedule source is incomplete.');return revision;}));
            const collision=snapData(await tx.get(ref(revisionDocId(canonicalRevisionId))));if(collision)throw Error('The correction revision reference already exists. Reload before trying again.');guard();
            const source=revisions.find(row=>row.revisionId===payload.sourceRevisionId),head=revisions.find(row=>row.revisionId===current.scheduleRevisionId);
            if(signature(head.snapshot)!==signature(snapshotData(current,{legacy:true})))throw Error('The current schedule head has unarchived edits. Save and reload them before correcting historical shift times.');
            const archive={month:payload.month,revisions,latestRevisionId:index.latestRevisionId,latestRevision:revisions.find(row=>row.revisionId===index.latestRevisionId),shiftAmendments:previous},history=assembleScheduleHistory(current,[archive]);
            amendmentsForDate(history,today);
            const sourceNow=applyShiftAmendments({...clone(source.snapshot),scheduleRevisionId:source.revisionId},amendmentsForDate(history,today),today);
            const checkedShift=(snapshot,change)=>{const matches=snapshot.branchConfig?.[payload.branch]?.filter(shift=>shift.id===change.shiftId)||[];if(matches.length!==1)throw Error('A selected shift ID is missing or duplicated in the saved source.');return matches[0];};
            for(const change of payload.changes){for(const snapshot of [sourceNow,current]){const times=shiftAmendmentRuleTimes(checkedShift(snapshot,change));if(times.startTime!==change.beforeStart||times.endTime!==change.beforeEnd)throw Error('A selected shift time changed after this preview. Reload its exact saved Time In and Time Out.');}}
            const sourceDates={},sourceRevisionIds=new Set(),canonicalSnapshot=snapshotData(current,{legacy:true});
            for(let date=payload.effectiveFrom;date<=payload.effectiveTo;date=nextDate(date)){
                const original=resolveScheduleForDate(history,date,{amendments:false});if(!original)throw Error('Dated schedule evidence is missing for '+date+'. No shift times were changed.');
                const originalRevision=revisions.find(row=>row.revisionId===original.scheduleRevisionId),dated=applyShiftAmendments(original,amendmentsForDate(history,date),date);
                // Existing future plans keep their deliberate rule choices. A later
                // normal save also has a different revision ID and is never overlaid.
                if(originalRevision.effectiveFrom<=today){
                    for(const change of payload.changes){const times=shiftAmendmentRuleTimes(checkedShift(dated,change)),before=times.startTime===change.beforeStart&&times.endTime===change.beforeEnd,after=times.startTime===change.startTime&&times.endTime===change.endTime;if(!before&&!after)throw Error('The selected shift has different dated rules on '+date+'. Review that date before correcting it.');}
                    sourceDates[date]=original.scheduleRevisionId;sourceRevisionIds.add(original.scheduleRevisionId);
                }
                if(date>=today)canonicalSnapshot.currentSchedule[Number(date.slice(-2))]=clone(original.currentSchedule[Number(date.slice(-2))]||{});
            }
            if(!sourceRevisionIds.size)throw Error('No confirmed dated shift source matches this correction.');
            for(const change of payload.changes){const shift=checkedShift(canonicalSnapshot,change);shift.startTime=change.startTime;shift.endTime=change.endTime;}
            const event={...payload,schemaVersion:1,kind:'shift-time-amendment',source:'owner-shift-time-correction',sequence:previous.length+1,recordedAt,actor:reviewer,canonicalRevisionId,canonicalSourceRevisionId:current.scheduleRevisionId,sourceRevisionIds:[...sourceRevisionIds],sourceDates,intentFingerprint,
                sourceHeadFingerprint:shiftAmendmentFingerprint({revisionId:current.scheduleRevisionId,branch:payload.branch,rules:payload.changes.map(change=>({shiftId:change.shiftId,...shiftAmendmentRuleTimes(checkedShift(current,change))}))}),sourceIndexFingerprint:shiftAmendmentFingerprint({month:payload.month,latestRevisionId:index.latestRevisionId,revisionIds:ids,amendmentIds:previous.map(row=>row.id)})};
            const revision=createScheduleRevision(canonicalSnapshot,{revisionId:canonicalRevisionId,effectiveFrom:today,effectiveTo:payload.effectiveTo,savedAt:recordedAt,actor:reviewer.email,source:'owner-shift-time-amendment',cutover:policy?.payrollHistoryEnforcedFrom||current.payrollHistoryEnforcedFrom||today});revision.sequence=ids.length+1;
            const next={...addRevision(index,revision),shiftAmendments:[...clone(previous),event]};if(new TextEncoder().encode(JSON.stringify(next)).length>950000)throw Error('This month’s correction history is too large to save safely.');guard();
            tx.set(ref(revisionDocId(canonicalRevisionId)),revision);tx.set(ref(monthId(payload.month)),next);tx.set(ref(amendmentsDocId(payload.month)),{schemaVersion:1,kind:'schedule-shift-amendments',month:payload.month,shiftAmendments:next.shiftAmendments,updatedAt:recordedAt});tx.set(ref('global_schedule'),{...revision.snapshot,scheduleRevisionId:revision.revisionId,scheduleEffectiveFrom:revision.effectiveFrom,payrollHistoryEnforcedFrom:revision.payrollHistoryEnforcedFrom});
            return {amendment:clone(event),month:payload.month,latestRevisionId:revision.revisionId,alreadySaved:false};
        });
    }
    async function commit(input, options = {}, captureOnly = false) {
        if (typeof api.runTransaction !== 'function') throw new Error('Schedule history needs an atomic save API.');
        const savedAt = now(), today = scheduleDateKey(savedAt), id = options.revisionId || makeId(), baselineId = makeId();
        return api.runTransaction(api.db, async transaction => {
            const reads = new Map();
            async function get(id) { if (!reads.has(id)) reads.set(id, transaction.get(ref(id)).then(snapData)); return reads.get(id); }
            const [current, policy] = await Promise.all([get('global_schedule'), get('schedule_history_policy')]);
            const cutover = policy?.payrollHistoryEnforcedFrom || current?.payrollHistoryEnforcedFrom || today;
            const month = input ? monthKey(input) : current ? monthKey(current) : null;
            if (!month) return {revision: null, latestRevisionId: null, publishedCurrent: false};
            const currentMonth = current ? monthKey(current) : null;
            let index = await get(monthId(month));
            let currentIndex = currentMonth ? await get(monthId(currentMonth)) : null;
            const selectedDurable=await get(amendmentsDocId(month)),currentDurable=currentMonth?await get(amendmentsDocId(currentMonth)):null;
            const selectedEvents=savedAmendments(index,selectedDurable,month),currentEvents=currentMonth?savedAmendments(currentIndex,currentDurable,currentMonth):[];
            if(selectedEvents.length)index={...index,shiftAmendments:selectedEvents};
            if(currentEvents.length)currentIndex={...currentIndex,shiftAmendments:currentEvents};
            const currentRevision = current?.scheduleRevisionId ? await get(revisionDocId(current.scheduleRevisionId)) : null;
            let baseline = null;
            // If an old app modified the head without its archived revision, preserve what is on the server from today only.
            if (current && (!currentRevision || signature(currentRevision.snapshot) !== signature(snapshotData(current, {legacy: true})))) {
                baseline = createScheduleRevision(current, {revisionId: baselineId, effectiveFrom: today, savedAt, actor: options.actor, source: 'legacy-capture', cutover});
                if (await get(revisionDocId(baselineId))) throw new Error('Schedule revision ID already exists. Retry the save.');
            }
            let revision = null;
            if (!captureOnly) {
                revision = createScheduleRevision(input, {revisionId: id, effectiveFrom: options.effectiveFrom, effectiveTo: options.effectiveTo, savedAt, actor: options.actor, source: options.source || 'manager-save', cutover});
                const existing = await get(revisionDocId(id));
                if (existing) {
                    if (signature(existing.snapshot) !== signature(revision.snapshot) || existing.effectiveFrom !== revision.effectiveFrom || existing.effectiveTo !== revision.effectiveTo || existing.source !== revision.source) throw new Error('Schedule revision ID already exists with different data. Reload before saving.');
                    return {revision: existing, latestRevisionId: index?.latestRevisionId || existing.revisionId, publishedCurrent: current?.scheduleRevisionId === existing.revisionId, alreadySaved: true};
                }
                if (options.expectedRevisionId !== undefined && (index?.latestRevisionId || null) !== options.expectedRevisionId) throw new Error('This schedule changed in another session. Reload its month before saving.');
            }
            if (baseline) baseline.sequence = (currentIndex?.revisionIds?.length || 0) + 1;
            if (revision) revision.sequence = (index?.revisionIds?.length || 0) + (baseline?.month === revision.month ? 1 : 0) + 1;
            const extra = options.readExtra ? await options.readExtra(transaction, {current, selectedIndex: index, revision}) : undefined;
            // All transaction reads are complete before the first write.
            const indices = new Map();
            if (baseline) { transaction.set(ref(revisionDocId(baseline.revisionId)), baseline); indices.set(baseline.month, addRevision(currentIndex, baseline)); }
            if (revision) { transaction.set(ref(revisionDocId(revision.revisionId)), revision); indices.set(revision.month, addRevision(indices.get(revision.month) || index, revision)); }
            for (const [key, value] of indices) transaction.set(ref(monthId(key)), value);
            transaction.set(ref('schedule_history_policy'), {schemaVersion: 1, payrollHistoryEnforcedFrom: cutover});
            const publishedCurrent = !!revision && options.publishCurrent !== false && revision.month === monthKey(savedAt) && revision.effectiveFrom <= today;
            if (publishedCurrent) transaction.set(ref('global_schedule'), {...revision.snapshot, scheduleRevisionId: revision.revisionId, scheduleEffectiveFrom: revision.effectiveFrom, payrollHistoryEnforcedFrom: cutover});
            else if (baseline) transaction.set(ref('global_schedule'), {...baseline.snapshot, scheduleRevisionId: baseline.revisionId, scheduleEffectiveFrom: baseline.effectiveFrom, payrollHistoryEnforcedFrom: cutover});
            else if (current && !current.payrollHistoryEnforcedFrom) transaction.set(ref('global_schedule'), {...current, payrollHistoryEnforcedFrom: cutover});
            if (options.writeExtra) await options.writeExtra(transaction, extra);
            return {revision: revision || baseline, latestRevisionId: revision?.revisionId || baseline?.revisionId || current?.scheduleRevisionId || index?.latestRevisionId || null, publishedCurrent};
        });
    }
    return {loadMonth, loadRange,amendShiftTimes, save: (snapshot, options) => commit(snapshot, options), captureCurrent: options => commit(null, options, true)};
}
