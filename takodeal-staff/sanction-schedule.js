const DAY = 86400000;
const caseWorkflow=row=>!!row&&Object.prototype.hasOwnProperty.call(row,'caseVersion');
const nonempty=value=>typeof value==='string'&&!!value.trim();
function reviewedCaseAction(row,{history=false}={}){
    const action=row?.reviewedAction,reason=row?.reviewReason;
    if(!nonempty(row?.staffId)||row.caseKey!==row.staffId||!nonempty(row.staffName)||!nonempty(row.branch)||!Number.isSafeInteger(row.caseNumber)||row.caseNumber<1)return null;
    if(row?.caseVersion!==2||row.status!=='Reviewed'&&!(history&&row.status==='Archived')||!['Confirmed','Not established'].includes(row.finding)||!Number.isSafeInteger(row.decisionRevision)||row.decisionRevision<1||!nonempty(row.reviewedByUid)||row.reviewedByUid.length>128||!nonempty(row.reviewedByEmail)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.reviewedByEmail)||!nonempty(reason)||reason.trim().length<8||reason.trim().length>1500||row.reviewedAt==null||!action||!nonempty(action.id)||!nonempty(action.label)||!Number.isSafeInteger(action.suspensionDays)||action.suspensionDays<0||action.suspensionDays>366||!Number.isSafeInteger(action.policyRevision)||action.policyRevision<0||typeof action.effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(action.effectiveDate))return null;
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(action.id)||action.label!==action.label.trim()||[...action.label].length>120||/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(action.label))return null;
    try{
        const stamp=row.reviewedAt;if(typeof stamp==='string'){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)||Number(stamp.slice(11,13))>23)return null;phDay(stamp.slice(0,10));}
        const seconds=stamp?.seconds,nanos=stamp?.nanoseconds,date=stamp?.toDate?.()||(Number.isSafeInteger(seconds)&&(nanos==null||Number.isSafeInteger(nanos)&&nanos>=0&&nanos<1e9)?new Date(seconds*1000):stamp instanceof Date?stamp:typeof stamp==='string'?new Date(stamp):null);
        if(!date||!Number.isFinite(+date))return null;phDay(action.effectiveDate);return action;
    }catch{return null;}
}
export function sanctionReviewSummary(row){
    if(!caseWorkflow(row))return {isCase:false,caseNumber:'',finding:'',actionHeading:'Penalty',actionLabel:row?.severity||'Warning',message:'A scheduled suspension follows its effective date until management resolves it.'};
    const action=reviewedCaseAction(row,{history:true}),reviewed=!!action,closed=['Archived','Cancelled','Canceled','Deleted','Closed'].includes(row.status);
    return {isCase:true,caseNumber:Number.isSafeInteger(row.caseNumber)&&row.caseNumber>0?'Case #'+row.caseNumber:nonempty(row.caseNumber)?row.caseNumber:'Case reference not recorded',finding:reviewed?row.finding:row.status==='Reviewed'?'Review needs verification':closed?'Closed without a management decision':'Pending management review',actionHeading:reviewed?'Reviewed action':'Proposed action (not a decision)',actionLabel:reviewed?(row.finding==='Not established'?'No action established':action.label):(nonempty(row.proposedSeverity?.label)?row.proposedSeverity.label:'Not specified'),message:row.status==='Archived'?'This case is archived. Its saved finding and reviewed action are kept in history; no suspension is active from this case.':reviewed?(row.finding==='Not established'?'Management did not establish the allegation.':action.suspensionDays>0?'Management confirmed '+action.suspensionDays+' day(s) of suspension from '+action.effectiveDate+'.':'Management recorded its reviewed action. No suspension dates were assigned.'):closed?'This case is closed without an effective reviewed action.':'This notice asks for your explanation. A proposed action is not a finding or an effective suspension; management must review the case separately.'};
}
export function phDay(value = new Date()) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(value + 'T00:00:00Z');
        if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== value) throw Error('Choose a valid calendar date.');
        return value;
    }
    const date = value?.toDate?.() || new Date(value?.seconds != null ? value.seconds * 1000 : value);
    if (!Number.isFinite(+date)) throw Error('The saved date is invalid.');
    return new Date(+date + 8 * 3600000).toISOString().slice(0,10);
}
export function futureEffectiveDate(value, now = new Date()) {
    const date = phDay(value);
    if (date < phDay(now)) throw Error('Choose today or a future date. Historical dates are not changed.');
    return date;
}
export function effectiveDay(row) {
    if (row?.effectiveDate == null || row.effectiveDate === '') return null;
    return phDay(row.effectiveDate);
}
export function noticeIsDue(row, now = new Date()) {
    if (['Archived','Cancelled','Canceled','Deleted'].includes(row?.status)) return false;
    try { const date = effectiveDay(row); return !date || date <= phDay(now); }
    catch { return true; } // A malformed date must not bypass a notice.
}
export function pendingDueNotices(rows, now = new Date()) {
    return rows.filter(row => row.status === 'Pending Reply' && noticeIsDue(row,now))
        .sort((a,b) => String(a.effectiveDate || '').localeCompare(String(b.effectiveDate || '')) || String(a.id || '').localeCompare(String(b.id || '')));
}
export function suspensionDates(row) {
    if (['Archived','Resolved','Closed','Cancelled','Canceled','Deleted'].includes(row?.status)) return [];
    if(caseWorkflow(row)){
        const action=reviewedCaseAction(row);if(!action||row.finding!=='Confirmed'||action.suspensionDays<1)return [];
        return Array.from({length:action.suspensionDays},(_,index)=>new Date(+new Date(action.effectiveDate+'T00:00:00Z')+index*DAY).toISOString().slice(0,10));
    }
    const match = String(row?.severity || '').match(/(\d+)\s*(days?|weeks?)\s+suspension/i);
    if (!match) return [];
    let start;
    try { start = effectiveDay(row) || phDay(row.timestamp || row.issuedAt); } catch { return []; }
    const days = Math.min(366, Number(match[1]) * (/week/i.test(match[2]) ? 7 : 1));
    return Array.from({length:days},(_,index)=>new Date(+new Date(start+'T00:00:00Z') + index * DAY).toISOString().slice(0,10));
}
export function clockInRestriction(rows, now = new Date()) {
    // Versioned cases invite an explanation. Only a separately confirmed
    // management decision can create a suspension or restrict a later Time In.
    const notice = pendingDueNotices(rows,now).find(row=>!caseWorkflow(row));
    if (notice) return {notice,replyRequired:true,message:'Reply to your due HR notice before recording Time In.'};
    const day = phDay(now), suspension = rows.find(row => suspensionDates(row).includes(day));
    return suspension ? {notice:suspension,replyRequired:false,message:'Your suspension is effective on '+day+'. Contact management before recording Time In.'} : null;
}
export function isPenaltyDeduction(row) {
    return !!row?.sanctionId || /penalt|sanction/i.test(String(row?.type || ''));
}
export function deductionIsDue(row, cutoff = new Date()) {
    if (row?.status !== 'Unpaid') return false;
    try {
        const date = effectiveDay(row) || phDay(row.dateAdded || row.timestamp || row.issuedAt);
        return date <= phDay(cutoff);
    } catch { return false; } // Do not charge an invalid monetary date automatically.
}
export function penaltySummary(rows, cutoff) {
    const due = rows.filter(row=>isPenaltyDeduction(row) && row.scheduleVersion===1 && deductionIsDue(row,cutoff));
    return {amount:due.reduce((sum,row)=>sum+(Number(row.amount)||0),0),rows:due.map(row=>({id:row.id,amount:Number(row.amount)||0,effectiveDate:effectiveDay(row),revision:Number(row.scheduleRevision)||0}))};
}
// A date becoming due needs no new cloud read. Re-evaluate the cached rows at
// Philippine midnight; callers cancel this timer when the staff identity changes.
export function startPhilippineDayTimer(changed, {now=()=>new Date(),schedule=setTimeout,cancel=clearTimeout}={}) {
    let timer, stopped=false;
    const arm=()=>{if(stopped)return;const at=now(),next=+new Date(phDay(at)+'T00:00:00+08:00')+DAY;timer=schedule(()=>{if(stopped)return;changed();arm();},Math.max(1,next-+at+50));};
    arm();return ()=>{stopped=true;if(timer!=null)cancel(timer);};
}
export async function acknowledgeSanction(api,input,{identity}={}) {
    const captured=identity?.();
    if(!input.id || input.id.includes('/') || !captured?.staffName || captured.staffName!==input.staffName || String(input.reply || '').trim().length<15 || !input.signature)throw Error('Sign in and complete the explanation and signature.');
    return api.runTransaction(api.db,async tx=>{
        const ref=api.doc(api.db,'hr_sanctions',input.id),snap=await tx.get(ref);if(!snap.exists())throw Error('This notice no longer exists.');const row=snap.data(),current=identity();
        if(current.staffName!==captured.staffName || current.staffId!==captured.staffId || row.staffName!==captured.staffName || captured.staffId && row.staffId && row.staffId!==captured.staffId)throw Error('Your staff identity changed. Open the correct notice again.');
        if(row.status==='Replied' && row.staffReply===input.reply && row.signatureBase64===input.signature)return {alreadySaved:true};
        if(row.status!=='Pending Reply')throw Error('Management has already finished or cancelled this notice. Refresh before replying.');
        tx.update(ref,{staffReply:input.reply,signatureBase64:input.signature,status:'Replied',repliedAt:api.serverTimestamp(),replyByStaffId:captured.staffId || row.staffId || '',replyScheduleRevision:Number(row.scheduleRevision)||0});return {status:'Replied'};
    });
}
