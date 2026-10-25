import {assembleScheduleHistory, createScheduleHistoryStore, monthKey, resolveScheduleForDate, scheduleDateKey,shiftAmendmentFingerprint,amendmentsForDate,applyShiftAmendments} from './schedule-history.js';

const copy = value => JSON.parse(JSON.stringify(value));
const snapshotKeys = ['branchConfig','employees','unavailability','currentSchedule','currentYear','currentMonth','holidays'];
function signature(value) {
    if (Array.isArray(value)) return '[' + value.map(signature).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + signature(value[key])).join(',') + '}';
    return JSON.stringify(value);
}
const scheduleSignature = value => signature(Object.fromEntries(snapshotKeys.filter(key => value?.[key] !== undefined).map(key => [key,value[key]])));
const isMonth = (value, selected) => {
    try { return monthKey(value) === selected; } catch { return false; }
};
function scopeSnapshot(value, allowed) {
    const result = copy(value);
    result.branchConfig = Object.fromEntries(Object.entries(result.branchConfig || {}).filter(([branch]) => allowed(branch)));
    result.currentSchedule = Object.fromEntries(Object.entries(result.currentSchedule || {}).map(([day, branches]) => [day,
        Object.fromEntries(Object.entries(branches || {}).filter(([branch]) => allowed(branch)))]));
    if (Array.isArray(result.employees)) result.employees = result.employees.filter(employee => allowed(employee.branch));
    if(Array.isArray(result.scheduleAmendments))result.scheduleAmendments=result.scheduleAmendments.filter(event=>allowed(event.branch));
    return result;
}

// Pure read projection. The editor keeps the whole saved document to preserve
// unrelated branches on a later save. Readers receive separately scoped days.
export function projectScheduleMonth({month, current = null, archive = null, now = new Date(), branch = null, allowed = () => true}) {
    const selected = monthKey(month), today = scheduleDateKey(now);
    const [year, monthNumber] = selected.split('-').map(Number);
    if (branch !== null && (typeof branch !== 'string' || !branch.trim() || !allowed(branch))) throw new Error('This schedule branch is outside your access.');
    const visible = name => allowed(name) && (branch === null || name === branch);
    const sameHeadMonth = current && isMonth(current, selected);
    const revisions = (archive?.revisions || []).filter(revision => revision?.month === selected && revision.snapshot);
    const latest = archive?.latestRevision?.month === selected ? archive.latestRevision
        : revisions.find(revision => revision.revisionId === archive?.latestRevisionId) || null;
    if (archive?.month && archive.month !== selected || archive?.latestRevisionId && (!latest || !isMonth(latest.snapshot,selected))) {
        throw new Error('The saved schedule version is incomplete. Refresh this month before using it.');
    }
    const headPreserved = sameHeadMonth && revisions.some(revision => revision.revisionId === current.scheduleRevisionId
        && scheduleSignature(revision.snapshot) === scheduleSignature(current));
    // Old clients may still save an unarchived current head. Respect that head
    // unless a future plan was explicitly saved for this selected month.
    const useUnarchivedHead = sameHeadMonth && !headPreserved && !(latest?.effectiveFrom > today);
    const source = useUnarchivedHead ? 'live-unarchived' : latest ? 'saved-month' : sameHeadMonth ? 'live-head' : 'missing-month';
    const base = useUnarchivedHead ? current : latest?.snapshot || (sameHeadMonth ? current : null);
    const empty = {...copy(current || {}), currentYear:year, currentMonth:monthNumber, currentSchedule:{}, holidays:{}, unavailability:{}};
    delete empty.scheduleRevisionId; delete empty.scheduleEffectiveFrom;
    let editorSnapshot = copy(base || empty);
    editorSnapshot.currentYear = year; editorSnapshot.currentMonth = monthNumber;
    editorSnapshot.currentSchedule ||= {};
    const history = assembleScheduleHistory(current, [{...archive,month:selected, revisions}]);
    const monthEnd=selected+'-'+String(new Date(Date.UTC(year,monthNumber,0)).getUTCDate()).padStart(2,'0');
    const editorDate=selected===today.slice(0,7)?[today,latest?.effectiveFrom||''].sort().at(-1):selected<today.slice(0,7)?monthEnd:latest?.effectiveFrom||selected+'-01';
    const editorAmendments=amendmentsForDate(history,editorDate);
    if(base&&editorAmendments.length)editorSnapshot=applyShiftAmendments({...editorSnapshot,scheduleRevisionId:useUnarchivedHead?'':latest?.revisionId||current?.scheduleRevisionId||''},editorAmendments,editorDate);
    const snapshot = copy(editorSnapshot), daySnapshots = {}, dayRevisions = {}, unverifiedDays = [];
    snapshot.currentSchedule = {};
    if (base) {
        const count = new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
        for (let day = 1; day <= count; day++) {
            const date = selected + '-' + String(day).padStart(2,'0');
            const dated = resolveScheduleForDate(history,date);
            // Immutable earlier work dates win over later whole-month plans.
            // Unarchived current/future edits are visible but never called an archive.
            const headOverride = useUnarchivedHead && date >= today;
            let daySource = !headOverride && dated ? dated : null;
            if (!daySource) {
                const fallback = !headOverride && latest?.effectiveFrom > date && sameHeadMonth ? current : editorSnapshot;
                daySource = {...copy(fallback), currentYear:year, currentMonth:monthNumber,
                    currentSchedule:{[day]:copy(fallback.currentSchedule?.[day] || {})}, snapshotDate:date,
                    scheduleRevisionId:'', scheduleSource:'unverified'};
                unverifiedDays.push(day);
            } else dayRevisions[day] = daySource.scheduleRevisionId;
            const scoped = scopeSnapshot(daySource,visible);
            daySnapshots[day] = scoped;
            snapshot.currentSchedule[day] = copy(scoped.currentSchedule[day] || {});
        }
    }
    return {month:selected, year, monthNumber, editorSnapshot, snapshot:scopeSnapshot(snapshot,visible), daySnapshots,
        dayRevisions, expectedRevisionId:archive?.latestRevisionId || null, source, hasSavedSchedule:Boolean(base),
        unverifiedDays,headFingerprint:shiftAmendmentFingerprint(current), archive:archive ? copy(archive) : {month:selected,revisions:[],latestRevision:null,latestRevisionId:null,shiftAmendments:[],indexFingerprint:shiftAmendmentFingerprint(null)}};
}

const readers = new WeakMap();
function accountScope(api) {
    const user = api.sessionUser;
    return signature([api.auth?.currentUser?.uid, user?.uid, user?.email, user?.branch, user?.isOwner, user?.isFranchisee,
        user?.allowedBranches, user?.permissions, api.localStorage?.getItem?.('takodeal_staff_id'), api.localStorage?.getItem?.('takodeal_staff_name')]);
}
function branchAllowed(api, branch) {
    if (typeof api.isBranchAllowed === 'function') return api.isBranchAllowed(branch) !== false;
    const user = api.sessionUser;
    return !user?.isFranchisee || (user.allowedBranches || [user.branch]).includes(branch);
}

// Only simultaneous reads are shared. No settled roster is cached, and a UI
// deadline does not release a still-pending Firestore read into duplicate retries.
export function createScheduleMonthReader(api, {store = createScheduleHistoryStore(api), timeoutMs = 15000} = {}) {
    const pending = new Map();
    async function load(month, {branch = null, now = new Date()} = {}) {
        const selected = monthKey(month), identity = accountScope(api), key = identity + '/' + selected;
        if (branch !== null && !branchAllowed(api,branch)) throw new Error('This schedule branch is outside your access.');
        let entry = pending.get(key);
        if (!entry) {
            const read = api.getDocFromServer;
            if (typeof read !== 'function') throw new Error('Schedule sync needs a server read API.');
            entry = {};
            const physical = Promise.resolve().then(() => Promise.all([
                read(api.doc(api.db,'settings','global_schedule')).then(snap => snap?.exists?.() ? snap.data() : null),
                store.loadMonth(selected)
            ])).finally(() => { if (pending.get(key) === entry) pending.delete(key); });
            let timer;
            entry.result = Promise.race([physical, new Promise((_,reject) => {
                timer = setTimeout(() => reject(new Error('The saved schedule could not be confirmed. Check your connection and refresh.')),timeoutMs);
            })]).finally(() => clearTimeout(timer));
            pending.set(key,entry);
        }
        const [current,archive] = await entry.result;
        if (identity !== accountScope(api)) throw new Error('Your schedule access changed. Reload this month.');
        return projectScheduleMonth({month:selected,current,archive,now,branch,allowed:name => branchAllowed(api,name)});
    }
    return {load};
}

export function loadScheduleMonthView(api, {month, branch = null, store, now = new Date(), timeoutMs} = {}) {
    let byStore = readers.get(api);
    if (!byStore) { byStore = new Map(); readers.set(api,byStore); }
    const key = store || 'default';
    let reader = byStore.get(key);
    if (!reader) {
        reader = createScheduleMonthReader(api,{...(store ? {store} : {}), ...(timeoutMs !== undefined ? {timeoutMs} : {})});
        byStore.set(key,reader);
    }
    return reader.load(month,{branch,now});
}
