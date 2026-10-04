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
    const day = Number(settings.requestDay ?? 5);
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
