const DAY = 86400000;
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
    const match = String(row?.severity || '').match(/(\d+)\s*(days?|weeks?)\s+suspension/i);
    if (!match) return [];
    let start;
    try { start = effectiveDay(row) || phDay(row.timestamp || row.issuedAt); } catch { return []; }
    const days = Math.min(366, Number(match[1]) * (/week/i.test(match[2]) ? 7 : 1));
    return Array.from({length:days},(_,index)=>new Date(+new Date(start+'T00:00:00Z') + index * DAY).toISOString().slice(0,10));
}
export function clockInRestriction(rows, now = new Date()) {
    const notice = pendingDueNotices(rows,now)[0];
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
