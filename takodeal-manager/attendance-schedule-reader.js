import {createScheduleHistoryStore,assembleScheduleHistory,monthKey,scheduleDateKey,amendmentsForDate,shiftAmendmentFingerprint} from './schedule-history.js';
import {resolveClockOutShift} from './clock-out-schedule.js';
import {attendanceMillis} from './attendance-reconcile.js';
import {timeMinutes} from './payroll-safety.js';

const day=86400000,minute=60000;
const data=snapshot=>snapshot?.exists?.()?snapshot.data():null;
const validRevision=id=>typeof id==='string'&&id.length>0&&id.length<=100&&!id.includes('/');
function monthHeaders(month,index,durable){
    if(index?.revisionIds!=null&&!Array.isArray(index.revisionIds))throw Error('The saved schedule version index is incomplete.');
    const ids=[...new Set(index?.revisionIds||[])];
    if(ids.some(id=>!validRevision(id))||index?.latestRevisionId&&!ids.includes(index.latestRevisionId))throw Error('The saved schedule version index is incomplete.');
    const inline=index?.shiftAmendments||[],events=durable?.shiftAmendments??inline;
    if(!Array.isArray(inline)||!Array.isArray(events)||durable&&(!Array.isArray(durable.shiftAmendments)||durable.month!==month)||durable&&inline.some((event,i)=>shiftAmendmentFingerprint(event)!==shiftAmendmentFingerprint(events[i])))throw Error('The saved shift correction history is inconsistent. Reload for an HQ review.');
    // Validate every event before deciding that none can affect the preserved
    // clock-in. An unrelated invalid correction must not become a cache hit.
    amendmentsForDate({month,shiftAmendments:events},month+'-01');
    for(const event of events){
        if(!ids.includes(event.sourceRevisionId)||!event.canonicalRevisionId||!ids.includes(event.canonicalRevisionId)||!Array.isArray(event.sourceRevisionIds)||!event.sourceRevisionIds.length||event.sourceRevisionIds.some(id=>!ids.includes(id))||!event.sourceDates||Array.isArray(event.sourceDates)||!Object.keys(event.sourceDates).length)throw Error('The saved shift correction source is incomplete.');
        for(const [date,id]of Object.entries(event.sourceDates))if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<event.effectiveFrom||date>event.effectiveTo||!event.sourceRevisionIds.includes(id))throw Error('The dated shift correction source is incomplete.');
    }
    return {month,latestRevisionId:index?.latestRevisionId||null,revisions:[],latestRevision:null,payrollHistoryEnforcedFrom:index?.payrollHistoryEnforcedFrom||null,shiftAmendments:events};
}
function mayAmendSnapshot(shift,start,history){
    if(!shift.shiftId)return false;
    const expected=attendanceMillis(shift.expectedStartAt),ending=attendanceMillis(shift.expectedEndAt),workDate=scheduleDateKey(new Date(expected)),midnight=Date.parse(workDate+'T00:00:00+08:00');
    // Both ordinary amendment replay and saved-assignment reconciliation must
    // first match the original slot's exact BEFORE times. No such pair means
    // the immutable clock-in remains authoritative, even after a correction
    // already reflected in that clock-in or a later unrelated roster edit.
    return amendmentsForDate(history,workDate).some(event=>event.branch===start.branch&&event.changes.some(change=>{
        if(change.shiftId!==shift.shiftId)return false;
        const begin=timeMinutes(change.beforeStart),end=timeMinutes(change.beforeEnd);
        return begin!==null&&end!==null&&expected===midnight+begin*minute&&ending===midnight+(end+(end<=begin?1440:0))*minute;
    }));
}

// `read` is a fresh transaction/server reader, never an offline or settled disk
// cache. This operation memoizes only its own reads, including the full fallback.
// Return a minimal history solely when no dated correction can alter a trusted
// saved punch. Unknown/unassigned/recoverable punches retain the full resolver.
export async function loadClockOutSchedule(api,start,person,{read=api.getDocFromServer||api.getDoc,assertCurrent=()=>{}}={}){
    if(typeof read!=='function')throw Error('Clock-out schedule verification needs a server read API.');
    assertCurrent();
    const reads=new Map(),ref=id=>api.doc(api.db,'settings',id);
    const fresh=reference=>{
        assertCurrent();
        const key=reference?.path||reference;
        if(!reads.has(key))reads.set(key,Promise.resolve().then(()=>read(reference)).then(snapshot=>{
            assertCurrent();
            if(!snapshot||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache===true||snapshot.metadata?.hasPendingWrites===true)throw Error('The saved clock-out schedule has not been confirmed by HQ. Check the connection and retry.');
            return snapshot;
        }));
        return reads.get(key);
    };
    const actual=attendanceMillis(start?.timestamp);
    if(!Number.isFinite(actual))throw Error('The active Time In needs management review.');
    const from=new Date(actual-day),to=new Date(actual+day),first=monthKey(from),last=monthKey(to),months=[first];
    if(last!==first)months.push(last);
    const [current,policy,archives]=await Promise.all([
        fresh(ref('global_schedule')).then(data),fresh(ref('schedule_history_policy')).then(data),
        Promise.all(months.map(async month=>{
            const suffix=month.replace('-','_'),[index,durable]=await Promise.all([fresh(ref('schedule_month_'+suffix)).then(data),fresh(ref('schedule_shift_amendments_'+suffix)).then(data)]);
            return monthHeaders(month,index,durable);
        }))
    ]);
    assertCurrent();
    const history=assembleScheduleHistory(current,archives,{enforcedFrom:policy?.payrollHistoryEnforcedFrom});
    const profiles={[start.staffName]:{...person,id:start.staffId,staffId:start.staffId}};
    const preserved=start.scheduleSnapshot&&resolveClockOutShift(start,null,profiles);
    if(preserved?.wasScheduled===true&&preserved.needsScheduleReview!==true&&preserved.amendmentNeedsReview!==true&&!mayAmendSnapshot(preserved,start,history))return history;
    const complete=await createScheduleHistoryStore({...api,getDocFromServer:fresh,getDoc:fresh}).loadRange(from,to);
    assertCurrent();
    return complete;
}
