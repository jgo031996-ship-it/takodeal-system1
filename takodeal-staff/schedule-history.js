// Schedule history is keyed by the Philippine work date, not the month currently open in the editor.
const SNAPSHOT_KEYS = ['branchConfig', 'employees', 'unavailability', 'currentSchedule', 'currentYear', 'currentMonth', 'holidays'];
const clone = value => JSON.parse(JSON.stringify(value));
const pad = value => String(value).padStart(2, '0');
const monthId = month => `schedule_month_${month.replace('-', '_')}`;
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
export function createScheduleRevision(input, {revisionId, effectiveFrom, effectiveTo, savedAt = new Date(), actor = '', source = 'manager-save', cutover} = {}) {
    if (typeof revisionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(revisionId)) throw new Error('A valid schedule revision ID is required.');
    const legacy = source === 'legacy-capture', snapshot = snapshotData(input, {legacy}), month = monthKey(snapshot);
    const from = scheduleDateKey(effectiveFrom || defaultScheduleEffectiveFrom(snapshot, savedAt));
    const to = scheduleDateKey(effectiveTo || monthEnd(month)), today = scheduleDateKey(savedAt);
    if (!legacy && (from.slice(0, 7) !== month || to.slice(0, 7) !== month || from > to)) throw new Error('The effective dates must belong to the selected schedule month.');
    if (!legacy && from < today) throw new Error('Schedule history starts with future changes. Past dates cannot be reconstructed from the current shift rules.');
    const daySnapshots = {};
    for (let date = from > `${month}-01` ? from : `${month}-01`; date <= to && date.slice(0, 7) === month; date = nextDate(date)) {
        const day = String(Number(date.slice(-2)));
        daySnapshots[date] = {configRevisionId: revisionId, daySchedule: clone(snapshot.currentSchedule[day] || {})};
    }
    const revision = {schemaVersion: 1, kind: 'schedule-revision', month, revisionId, effectiveFrom: from, effectiveTo: to,
        savedAt: instant(savedAt).toISOString(), actor: String(actor || ''), source,
        payrollHistoryEnforcedFrom: scheduleDateKey(cutover || savedAt), snapshot, daySnapshots};
    if (new TextEncoder().encode(JSON.stringify(revision)).length > 950000) throw new Error('This schedule month is too large to archive safely. Reduce the schedule size before saving.');
    return revision;
}
export function resolveScheduleForDate(history, value) {
    let date;
    try { date = scheduleDateKey(value); } catch { return null; }
    const month = date.slice(0, 7), archive = history?.historyMonths?.[month];
    const revisions = Array.isArray(archive) ? archive : archive?.revisions || (history?.month === month && Array.isArray(history?.revisions) ? history.revisions : []);
    const matching = revisions.filter(revision => revision?.month === month && revision.effectiveFrom <= date && revision.effectiveTo >= date && revision.daySnapshots?.[date]?.configRevisionId === revision.revisionId && revision.snapshot)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || (Number(b.sequence) || 0) - (Number(a.sequence) || 0) || b.savedAt.localeCompare(a.savedAt) || b.revisionId.localeCompare(a.revisionId));
    if (!matching.length) return null;
    const revision = matching[0], result = clone(revision.snapshot), day = String(Number(date.slice(-2))), selected = revision.daySnapshots[date];
    result.branchConfig = clone(revision.snapshot.branchConfig); result.currentSchedule = {[day]: clone(selected.daySchedule)};
    return {...result, snapshotDate: date, scheduleRevisionId: revision.revisionId, scheduleSource: revision.source,
        scheduleEffectiveFrom: revision.effectiveFrom, scheduleEffectiveTo: revision.effectiveTo,
        payrollHistoryEnforcedFrom: history?.payrollHistoryEnforcedFrom || revision.payrollHistoryEnforcedFrom};
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
function addRevision(index, revision) {
    return {schemaVersion: 1, kind: 'schedule-month', month: revision.month,
        revisionIds: [...new Set([...(index?.revisionIds || []), revision.revisionId])], latestRevisionId: revision.revisionId,
        updatedAt: revision.savedAt, payrollHistoryEnforcedFrom: index?.payrollHistoryEnforcedFrom || revision.payrollHistoryEnforcedFrom};
}
// Flat settings documents use the existing settings access policy. No live data is touched until save/captureCurrent is called.
export function createScheduleHistoryStore(api, {now = () => new Date(), makeId = () => crypto.randomUUID()} = {}) {
    const ref = id => api.doc(api.db, 'settings', id), read = api.getDocFromServer || api.getDoc;
    if (typeof read !== 'function') throw new Error('Schedule history needs a server read API.');
    async function loadMonth(value) {
        const month = monthKey(value), index = snapData(await read(ref(monthId(month))));
        const ids = [...new Set(index?.revisionIds || [])];
        const revisions = (await Promise.all(ids.map(async id => snapData(await read(ref(revisionDocId(id))))))).filter(revision => revision?.month === month);
        revisions.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || a.savedAt.localeCompare(b.savedAt) || a.revisionId.localeCompare(b.revisionId));
        return {month, latestRevisionId: index?.latestRevisionId || null, revisions, latestRevision: revisions.find(revision => revision.revisionId === index?.latestRevisionId) || null,
            payrollHistoryEnforcedFrom: index?.payrollHistoryEnforcedFrom || null};
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
            const index = await get(monthId(month));
            const currentIndex = currentMonth ? await get(monthId(currentMonth)) : null;
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
    return {loadMonth, loadRange, save: (snapshot, options) => commit(snapshot, options), captureCurrent: options => commit(null, options, true)};
}
