// An unpaid preview must be rebuilt when its dated schedule evidence changes.
// Paid payslips keep their frozen figures; this check never writes payroll data.
import {canOpenWorkspacePage} from './workspace-access-model.js';
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value instanceof Date ? value.toISOString()
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const dayMilliseconds=86400000;
function workDate(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Regenerate this unpaid payslip with valid cutoff dates.');
    const date=new Date(value+'T00:00:00Z');
    if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value||+value.slice(0,4)<2000||+value.slice(0,4)>2199)throw Error('Regenerate this unpaid payslip with valid cutoff dates.');
    return value;
}
function cutoffRange({start,end}={}) {
    start=workDate(start);end=workDate(end);
    if(start>end||+new Date(end+'T00:00:00Z')-+new Date(start+'T00:00:00Z')>732*dayMilliseconds)throw Error('Regenerate this unpaid payslip with a valid cutoff range.');
    // The older generator reads punches from the preceding date, and shift
    // matching can look one more work date back. Its extended end read reaches
    // only noon on the following date, whose shift evidence is also protected.
    const offset=(date,days)=>new Date(+new Date(date+'T00:00:00Z')+days*dayMilliseconds).toISOString().slice(0,10);
    return {start,end,first:offset(start,-2),last:offset(end,1)};
}
function savedInstant(value) {
    if(value==null||value==='')return '';
    let seconds,nanoseconds;
    if(value&&typeof value==='object'&&Number.isFinite(value.seconds)) {
        seconds=value.seconds;nanoseconds=value.nanoseconds??0;
    } else {
        const milliseconds=value instanceof Date?+value:typeof value?.toMillis==='function'?value.toMillis():typeof value==='number'?value:Date.parse(value);
        if(!Number.isFinite(milliseconds))throw Error('The saved schedule timestamp could not be verified. Reload its history.');
        seconds=Math.floor(milliseconds/1000);nanoseconds=Math.round((milliseconds-seconds*1000)*1e6);
        // ISO strings and Firestore timestamps can retain more than Date's
        // millisecond precision. Equal stored instants must produce one stamp.
        const fraction=typeof value==='string'&&value.match(/\.(\d{1,9})(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1];
        if(fraction)nanoseconds=Number(fraction.padEnd(9,'0'));
    }
    if(!Number.isSafeInteger(seconds)||!Number.isSafeInteger(nanoseconds)||nanoseconds<0||nanoseconds>=1e9)throw Error('The saved schedule timestamp could not be verified. Reload its history.');
    return {seconds,nanoseconds};
}
function datedEntries(object,range) {
    return Object.fromEntries(Object.entries(object||{}).filter(([date])=>date>=range.first&&date<=range.last));
}
function overlapping(row,range) {
    if(!row||workDate(row.effectiveFrom)>workDate(row.effectiveTo))throw Error('The saved schedule dates could not be verified. Reload its history.');
    return row.effectiveFrom<=range.last&&row.effectiveTo>=range.first;
}
function resolverTimestamp(value) {
    if(typeof value==='string')return value;
    const instant=savedInstant(value);
    if(!instant)return '';
    return new Date(instant.seconds*1000).toISOString().slice(0,19)+'.'+String(instant.nanoseconds).padStart(9,'0')+'Z';
}
function selectedVersions(revisions,month,range) {
    const dates=new Map();
    for(const row of revisions)for(const [date,day]of Object.entries(row.daySnapshots||{})) {
        if(row.month!==month||date.slice(0,7)!==month||date<range.first||date>range.last||row.effectiveFrom>date||row.effectiveTo<date||day?.configRevisionId!==row.revisionId||!row.snapshot)continue;
        const candidates=dates.get(date)||[];candidates.push(row);dates.set(date,candidates);
    }
    // Keep the exact winning reference used by resolveScheduleForDate. Older
    // rows can have equal/missing sequences; its textual timestamp tiebreak
    // must remain protected even when the stored instants normalize equally.
    return Object.fromEntries([...dates].map(([date,rows])=>[date,rows.sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||(Number(b.sequence)||0)-(Number(a.sequence)||0)||resolverTimestamp(b.savedAt).localeCompare(resolverTimestamp(a.savedAt))||b.revisionId.localeCompare(a.revisionId))[0].revisionId]));
}
export function payrollScheduleStamp(schedule,dates) {
    if (!schedule || !schedule.historyMonths) throw Error('Load saved schedule history before generating payroll.');
    const range=cutoffRange(dates),months={};
    for(const [month,archive]of Object.entries(schedule.historyMonths)) {
        if(month<range.first.slice(0,7)||month>range.last.slice(0,7))continue;
        const revisions=Array.isArray(archive)?archive:archive?.revisions||[],amendments=archive?.shiftAmendments||[];
        if(!Array.isArray(revisions)||!Array.isArray(amendments))throw Error('The saved schedule history could not be verified. Reload it.');
        const ids=new Set();
        const relevantRevisions=revisions.filter(row=>overlapping(row,range)),relevantAmendments=amendments.filter(row=>overlapping(row,range));
        months[month]={selectedVersions:selectedVersions(relevantRevisions,month,range),revisions:relevantRevisions.map(row=>{
            if(!row.revisionId||ids.has(row.revisionId))throw Error('The saved schedule versions could not be verified. Reload them.');
            ids.add(row.revisionId);const snapshot=row.snapshot||{};
            return {revisionId:row.revisionId,sequence:row.sequence||0,savedAt:savedInstant(row.savedAt),source:row.source||'',effectiveFrom:row.effectiveFrom,effectiveTo:row.effectiveTo,payrollHistoryEnforcedFrom:row.payrollHistoryEnforcedFrom||'',
                currentYear:snapshot.currentYear,currentMonth:snapshot.currentMonth,branchConfig:snapshot.branchConfig||{},holidays:datedEntries(snapshot.holidays,range),daySnapshots:datedEntries(row.daySnapshots,range)};
        }).sort((a,b)=>a.revisionId.localeCompare(b.revisionId)),amendments:relevantAmendments.map(row=>({...row,recordedAt:savedInstant(row.recordedAt),sourceRevisionIds:Array.isArray(row.sourceRevisionIds)?[...row.sourceRevisionIds].sort():row.sourceRevisionIds,sourceDates:datedEntries(row.sourceDates,range)})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),amendmentOrder:[...relevantAmendments].sort((a,b)=>(Number(a.sequence)||0)-(Number(b.sequence)||0)||resolverTimestamp(a.recordedAt).localeCompare(resolverTimestamp(b.recordedAt))||String(a.id).localeCompare(String(b.id))).map(row=>row.id)};
        // An empty added month or a new current head outside the cutoff has no
        // input to these earnings. The latestRevisionId alone is not evidence
        // that the dates used by this unpaid preview changed.
        if(!months[month].revisions.length&&!months[month].amendments.length)delete months[month];
    }
    const cutover=schedule.payrollHistoryEnforcedFrom||'';
    if(cutover)workDate(cutover);
    const legacyDays={};
    for(const [day,value]of Object.entries(schedule.currentSchedule||{})) {
        const date=String(schedule.currentYear)+'-'+String(schedule.currentMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
        // An actual punch just before the preservation cutover may match a
        // shift starting on the cutover date, up to 90 minutes after midnight.
        if(date>=range.first&&date<=range.last&&(!cutover||date<=cutover))legacyDays[day]=value;
    }
    // Pre-history punches can still use the current legacy shift fallback.
    // Keep its rules and relevant dated roster protected; ignore future days.
    const legacy=(!cutover||range.first<cutover)?{currentYear:schedule.currentYear,currentMonth:schedule.currentMonth,branchConfig:schedule.branchConfig||{},currentSchedule:legacyDays}:null;
    return JSON.stringify(canonical({version:2,start:range.start,end:range.end,months,legacy,holidays:datedEntries(schedule.holidays,range),payrollHistoryEnforcedFrom:cutover}));
}
export async function assertPayrollScheduleFresh(api, data) {
    if (data?.isPaid || api.paidPayrollSnapshots?.has(data)) return;
    if (!data?.scheduleEvidenceStamp || !data.start || !data.end || typeof api.loadPayrollScheduleHistory !== 'function')
        throw Error('Regenerate this unpaid payslip from the saved schedule before payment.');
    let stamp;
    try{stamp=JSON.parse(data.scheduleEvidenceStamp);}catch{}
    if(stamp?.version!==2||stamp.start!==data.start||stamp.end!==data.end)
        throw Error('Regenerate this unpaid payslip once to load its cutoff-specific schedule check before payment.');
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
    if (actor !== identity() || payrollScheduleStamp(schedule,{start:data.start,end:data.end}) !== data.scheduleEvidenceStamp)
        throw Error('The saved shift times changed. Regenerate this unpaid payslip and reopen it before payment.');
}
