export const MALL_FLOAT = 2000;
export function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Enter a valid amount of zero or more.');
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function mallCashPlan(declared, float = MALL_FLOAT) {
    const cash = money(declared), pettyCash = money(float);
    return { startingCash: pettyCash, retainedCash: Math.min(cash, pettyCash), remittedCash: money(Math.max(0, cash - pettyCash)), floatShortage: money(Math.max(0, pettyCash - cash)) };
}
export function businessClock(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    return { day, weekday: new Date(`${day}T12:00:00+08:00`).getUTCDay(), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
export function stockRequestDue(settings = {}, date = new Date()) {
    const clock = businessClock(date), time = settings.requestTime ?? '18:00';
    const day = Number(settings.requestDay ?? 4);
    if (settings.requestEnabled === false || !Number.isInteger(day) || day < 0 || day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
    const [hour, minute] = time.split(':').map(Number);
    return clock.weekday === day && clock.minutes >= hour * 60 + minute;
}
export function autoRequestId(branch, date = new Date()) { return `auto-${encodeURIComponent(branch)}-${businessClock(date).day}`; }
export function archiveableShift(shift, { today = businessClock().day, latestId } = {}) {
    if (!shift.endTime && !shift.endTimeMs) return false;
    const end = shift.endTime?.toDate ? shift.endTime.toDate() : new Date(shift.endTimeMs ?? shift.endTime);
    return shift.active === false && shift.status === 'Closed' && Number.isFinite(end.getTime()) && businessClock(end).day < today && shift.id !== latestId;
}

export function mallOpeningCash(previous) {
    if (!previous || previous.isFinalShiftOfDay === true) return MALL_FLOAT;
    return money(previous.retainedCash ?? previous.declaredCash ?? previous.actualCash ?? MALL_FLOAT);
}
function scheduleMinutes(value) {
    const match = String(value || '').trim().replace(/\s+/g,'').match(/^(\d{1,2})(?::(\d{2}))?(am|pm|nn)?$/i);
    if (!match) return null;
    let hour=Number(match[1]), minute=Number(match[2] || 0);
    if (minute>59 || hour>(match[3] ? 12 : 23) || (match[3] && hour<1)) return null;
    if (match[3]) { hour %= 12; if (match[3].toLowerCase()!=='am') hour += 12; }
    return hour*60+minute;
}
export function mallFinalShiftHint(schedule, branch, started, now = new Date()) {
    const startDate = started?.toDate ? started.toDate() : started?.seconds !== undefined ? new Date(started.seconds*1000) : new Date(started);
    if (!Number.isFinite(startDate.getTime())) return { final:false, closingTime:null, businessDay:businessClock(now).day };
    const clock=businessClock(startDate), [year,month,date]=clock.day.split('-').map(Number);
    const assignments=Number(schedule?.currentYear)===year && Number(schedule?.currentMonth)===month ? schedule.currentSchedule?.[date]?.[branch]?.scheduled || {} : {};
    const configs=(schedule?.branchConfig?.[branch] || []).filter(shift=>shift.active!==false && (!Array.isArray(shift.days) || shift.days.includes(clock.weekday)));
    const assigned=configs.filter(shift=>String(assignments[shift.id] || '').trim());
    const closingTimes=(assigned.length ? assigned : configs).map(shift=> {
        const label=String(shift.name || '').match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))/i);
        const start=scheduleMinutes(shift.startTime) ?? scheduleMinutes(label?.[1]), end=scheduleMinutes(shift.endTime) ?? scheduleMinutes(label?.[2]);
        return start===null || end===null ? null : end+(end<=start ? 1440 : 0);
    }).filter(value=>value!==null);
    if (!closingTimes.length) return { final:false, closingTime:null, businessDay:clock.day };
    const latest=Math.max(...closingTimes), midnight=new Date(clock.day+'T00:00:00+08:00').getTime();
    const totalMinutes=(now.getTime()-midnight)/60000;
    const wall=latest%1440, closingTime=String(Math.floor(wall/60)).padStart(2,'0')+':'+String(wall%60).padStart(2,'0')+(latest>=1440 ? ' next day' : '');
    return { final:totalMinutes>=latest, closingTime, businessDay:clock.day };
}
