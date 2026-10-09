// Read-only dashboard calculations. Dates use the existing 08:30 Philippine business-day cutoff.
import { resolveScheduledShift, attendanceLateMinutes } from './payroll-safety.js';
import { attendanceKind, latestAttendance } from './attendance-reconcile.js';
export const money = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function milliseconds(value) {
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    if (value?.seconds != null) return value.seconds * 1000;
    return value == null ? 0 : new Date(value).getTime() || 0;
}
export const calendarDay = (now = Date.now()) => new Date(milliseconds(now) + 8 * 3600000).toISOString().slice(0, 10);
export const businessDay = value => calendarDay(milliseconds(value) - 8.5 * 3600000);
export const dayStart = day => new Date(day + 'T08:30:00+08:00');
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export function dateRange(start, end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
        throw new Error('Choose a valid start and end date.');
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw new Error('Choose a period of one year or less.');
    return { start: dayStart(start), end: dayStart(addDays(end, 1)) };
}
export function saleIsPaid(tx) {
    const state = String(tx.status || '').toLowerCase();
    return !['voided','void','cancelled','canceled','pending','pending sync','parked','mobile_queue'].includes(state)
        && String(tx.paymentStatus || '').toLowerCase() !== 'unpaid' && tx.isPendingSync !== true
        && (tx.netTotal != null || state === 'paid');
}
export function paymentParts(tx) {
    const parts = tx.splitDetails?.length ? tx.splitDetails : [{ method: tx.paymentMethod || 'Cash', amount: tx.netTotal }];
    return parts.map(p => ({ method: String(p.method || '').toLowerCase(), amount: number(p.amount) }));
}
export function scopedSales(txs, branches, start, end) {
    const allowed = new Set(branches);
    return txs.filter(tx => allowed.has(tx.branch) && saleIsPaid(tx) && milliseconds(tx.timestamp) >= +start && milliseconds(tx.timestamp) < +end);
}
export function salesSummary(txs) {
    const payments = { cash: 0, gcash: 0, grab: 0, foodpanda: 0, other: 0 };
    let net = 0;
    for (const tx of txs) {
        net += number(tx.netTotal);
        for (const p of paymentParts(tx)) payments[p.method in payments ? p.method : 'other'] += p.amount;
    }
    return { net, orders: txs.length, average: txs.length ? net / txs.length : 0, payments };
}
export function onDuty(logs, branches, now = Date.now()) {
    const ordered = [...logs].sort((a,b) => milliseconds(a.timestamp) - milliseconds(b.timestamp) || String(a.id).localeCompare(String(b.id)));
    const idsByName = new Map(), groups = new Map();
    for (const log of ordered) {
        if (log.staffName && log.staffId) {
            if (!idsByName.has(log.staffName)) idsByName.set(log.staffName, new Set());
            idsByName.get(log.staffName).add(log.staffId);
        }
    }
    for (const log of ordered) {
        const namedIds = idsByName.get(log.staffName);
        const id = log.staffId || (namedIds?.size === 1 ? [...namedIds][0] : null);
        const key = id ? 'id:' + id : log.staffName ? 'name:' + log.staffName : null;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { id, logs: [] });
        groups.get(key).logs.push(log);
    }
    const duty = [];
    for (const group of groups.values()) {
        let selected = group.logs.at(-1), review = false;
        const linked = group.logs.some(log => log.timeInLogId);
        if (linked) {
            const originals = new Map();
            const records = group.logs.map(log => {
                // An exact, uniquely observed name can attach a legacy row to its ID for this read only.
                const row = { ...log, type: log.type || log.action, staffId: log.staffId || group.id || undefined };
                originals.set(row, log); return row;
            });
            try { selected = latestAttendance(records, group.id || '', selected.staffName, now); }
            catch {
                // Unconfirmed timestamps must not break other branches or count as verified on duty.
                selected = records.filter(log => attendanceKind(log) === 'TIME IN').at(-1); review = true;
            }
            selected = originals.get(selected) || selected;
        }
        const isIn = linked ? attendanceKind({ ...selected, type: selected?.type || selected?.action }) === 'TIME IN'
            : String(selected?.type || selected?.action || '').toUpperCase() === 'TIME IN';
        if (selected && branches.includes(selected.branch) && isIn)
            duty.push({ ...selected, needsReview: review || now - milliseconds(selected.timestamp) > 16 * 3600000,
                ...(review ? { reviewReason:'Attendance time needs HQ review' } : {}) });
    }
    return duty;
}
export function dutyAttendance(log, schedule, profiles = {}) {
    const at = milliseconds(log.timestamp);
    const validTime = Number.isFinite(at) && at > 0;
    const shift = validTime ? resolveScheduledShift(new Date(at), log.branch, log.staffName, schedule, profiles) : null;
    const recorded = log.reviewedLateMinutes ?? log.lateMinutes;
    const hasRecorded = recorded != null && recorded !== '' && Number.isFinite(Number(recorded)) && Number(recorded) >= 0;
    const minutes = hasRecorded ? attendanceLateMinutes(log) : shift?.lateMinutes ?? null;
    return {
        clockIn: validTime ? new Date(at).toLocaleTimeString('en-PH', { timeZone:'Asia/Manila', hour:'2-digit', minute:'2-digit', hour12:true }) : 'Time unavailable',
        dateTime: validTime ? new Date(at).toISOString() : null,
        date: validTime ? new Date(at).toLocaleDateString('en-PH', { timeZone:'Asia/Manila', month:'short', day:'numeric', year:'numeric' }) : '',
        lateMinutes: minutes,
        lateExempted: log.lateExempted === true,
        scheduledStart: shift?.expectedStartAt.toLocaleTimeString('en-PH', { timeZone:'Asia/Manila', hour:'2-digit', minute:'2-digit', hour12:true }) || ''
    };
}
export function branchPerformance(branch, shifts, txs, expenses, today, now = Date.now()) {
    const shift = shifts.filter(s => s.branch === branch).sort((a,b) => milliseconds(b.startTime) - milliseconds(a.startTime))[0];
    if (!shift) return { branch, state: 'No shift', net: null, expenses: null, expected: null };
    const active = shift.active === true && shift.status !== 'Closed';
    const shiftSales = scopedSales(txs, [branch], milliseconds(shift.startTime), now + 1);
    const sums = salesSummary(shiftSales);
    const out = expenses.filter(e => e.branch === branch && e.shiftId === shift.id && e.type !== 'Manager_Fund').reduce((n,e) => n + number(e.amount), 0);
    return { branch, shift, state: active ? 'Active' : 'Closed',
        net: active ? sums.net : number(shift.netSales), expenses: active ? out : number(shift.expenses ?? shift.cashOut),
        expected: active ? number(shift.startingCash) + sums.payments.cash - out : number(shift.expectedCash),
        stale: active && businessDay(shift.startTime) !== today };
}
export function productReport(txs, inventory, recipes) {
    const result = new Map();
    const recipeIndex = new Map(), exactIndex = new Map(), trimmedIndex = new Map(), costs = new Map();
    const push = (index, key, value) => { if (!index.has(key)) index.set(key, []); index.get(key).push(value); };
    for (const r of recipes) push(recipeIndex, r.menuItem, r);
    for (const i of inventory) {
        push(exactIndex, i.branch + '\0' + i.name, i);
        push(trimmedIndex, i.branch + '\0' + String(i.name || '').trim(), i);
    }
    const costOf = (ingredient, branch) => {
        const cacheKey = branch + '\0' + ingredient;
        if (costs.has(cacheKey)) return costs.get(cacheKey);
        const find = b => {
            return exactIndex.get(b + '\0' + ingredient) || trimmedIndex.get(b + '\0' + String(ingredient || '').trim()) || [];
        };
        let matches = find(branch);
        if (!matches.length) matches = find('Main Office');
        const save = value => { costs.set(cacheKey, value); return value; };
        if (matches.length !== 1) return save({ problem: (matches.length ? 'Duplicate' : 'Missing') + ' ingredient: ' + ingredient });
        const cost = matches[0].baseCost;
        if (cost == null || cost === '' || !Number.isFinite(Number(cost)) || Number(cost) < 0) return save({ problem: 'Missing unit cost: ' + ingredient });
        return save({ cost: Number(cost) });
    };
    for (const tx of txs.filter(saleIsPaid)) {
        const items = tx.cart || tx.items || [];
        const raw = items.map(i => number(i.lineTotalFinal ?? i.total ?? ((i.variantPrice ?? i.basePrice ?? i.price) * number(i.qty ?? 1))));
        const totalRaw = raw.reduce((a,b) => a+b, 0);
        items.forEach((item, idx) => {
            const name = item.realName || item.name || item.itemName;
            const qty = number(item.qty ?? 1);
            if (!name || qty <= 0) return;
            const row = result.get(name) || { name, qty: 0, sales: 0, cogs: 0, problems: new Set() };
            row.qty += qty;
            // Allocate receipt discounts proportionally; do not claim pre-discount revenue as profit.
            row.sales += totalRaw > 0 ? raw[idx] / totalRaw * number(tx.netTotal) : 0;
            const recipe = recipeIndex.get(name) || [];
            if (!recipe.length) row.problems.add('No recipe linked');
            let unitCost = 0;
            const seen = new Set();
            for (const r of recipe) {
                if (seen.has(r.ingredientName)) row.problems.add('Duplicate recipe ingredient: ' + r.ingredientName);
                seen.add(r.ingredientName);
                const cost = costOf(r.ingredientName, tx.branch);
                if (cost.problem) row.problems.add(cost.problem);
                if (!Number.isFinite(Number(r.qty)) || Number(r.qty) <= 0) row.problems.add('Invalid recipe quantity');
                const type = String(item.orderType || tx.orderType || 'Dine-In').toLowerCase();
                const quantity = /box/i.test(r.ingredientName) && type.includes('dine-in') ? number(r.qty) / 2 : number(r.qty);
                unitCost += number(cost.cost) * quantity;
            }
            for (const addon of Object.values(item.addons || {})) {
                if (number(addon.qty) > 0 && addon.linkedIngredient && number(addon.deductQty) > 0) {
                    const cost = costOf(addon.linkedIngredient, tx.branch);
                    if (cost.problem) row.problems.add(cost.problem);
                    unitCost += number(cost.cost) * number(addon.qty) * number(addon.deductQty);
                }
            }
            row.cogs += unitCost * qty;
            result.set(name, row);
        });
    }
    return [...result.values()].sort((a,b) => b.sales - a.sales).map(r => ({ ...r, problems: [...r.problems],
        cogs: r.problems.size ? null : r.cogs, margin: r.problems.size ? null : r.sales - r.cogs,
        costPercent: r.problems.size || r.sales <= 0 ? null : r.cogs / r.sales * 100 }));
}
export function ballAudit(txs, stats, countBalls, branches) {
    const sales = txs.filter(tx => branches.includes(tx.branch) && saleIsPaid(tx));
    let recorded = 0, calculated = 0, unknown = 0;
    for (const tx of sales) {
        const cart = tx.cart || tx.items || [];
        const count = countBalls(cart);
        calculated += count;
        recorded += Number.isFinite(Number(tx.ballsCounted)) ? Number(tx.ballsCounted) : count;
        unknown += cart.filter(i => /takoyaki/i.test([i.realName,i.name,i.itemName,i.category].join(' '))
            && !/extra|sauce|take\s*out|packaging/i.test([i.realName,i.name,i.itemName].join(' '))
            && countBalls([i]) === 0 && number(i.qty ?? 1) > 0).length;
    }
    const historical = Number.isFinite(Number(stats.historicalBalls)) && stats.historicalBalls != null ? Number(stats.historicalBalls) : null;
    return { recorded, calculated, unknown, historical, expected: historical == null ? null : historical + calculated,
        stored: number(stats.totalTakoyakiBalls), receipts: sales.length };
}
