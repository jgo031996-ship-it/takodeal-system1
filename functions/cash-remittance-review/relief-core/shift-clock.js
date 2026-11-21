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
