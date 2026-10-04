import { isMealDeduction } from './payroll-safety.js';

export function historyTime(value) {
    const date = value?.toDate?.() || (value?.seconds != null ? new Date(value.seconds * 1000) : new Date(value));
    return Number.isFinite(date?.getTime?.()) ? date.getTime() : 0;
}
const nameKey = value => String(value || '').trim().toLowerCase();
const automaticMeal = row => isMealDeduction(row.type) && /\(\s*pos\s+auto\s*\)/i.test(row.type);
function sameMeal(request, deduction) {
    if (deduction.requestId) return request.id === deduction.requestId;
    if (request.deductionId) return request.deductionId === deduction.id;
    if (!isMealDeduction(request.type) || nameKey(request.staffName) !== nameKey(deduction.staffName)) return false;
    if (request.branch && deduction.branch && request.branch !== deduction.branch) return false;
    if (request.receiptId && deduction.receiptId) return request.receiptId === deduction.receiptId;
    const time = historyTime(request.timestamp);
    return time > 0 && Math.floor(time / 1000) === Math.floor(historyTime(deduction.dateAdded) / 1000)
        && Number(request.amount) === Number(deduction.amount)
        && /^manager/i.test(request.type) === /^manager/i.test(deduction.type);
}

// Read-only union: older POS meals exist only in the deduction ledger.
// Pair individual rows, never collapse two meals simply because their amounts match.
export function requestHistory(requests, deductions, branch = null) {
    const rows = requests.filter(row => !branch || row.branch === branch).map(row => ({ ...row }));
    const paired = new Set();
    for (const deduction of deductions) {
        if (!automaticMeal(deduction) || (branch && deduction.branch !== branch)) continue;
        const match = rows.find(row => row.status !== 'Pending' && !paired.has(row)
            && row.historySource !== 'deduction' && sameMeal(row, deduction));
        if (match) {
            paired.add(match);
            match.deductionStatus = deduction.status || 'Unpaid';
        } else {
            rows.push({ ...deduction, historySource: 'deduction', status: 'Recorded',
                deductionStatus: deduction.status || 'Unpaid', timestamp: deduction.dateAdded || deduction.timestamp });
        }
    }
    return rows.sort((a, b) => historyTime(b.timestamp) - historyTime(a.timestamp));
}
