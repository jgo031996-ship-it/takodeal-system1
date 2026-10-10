// Read-only reporting. These estimates never create expenses, change cash or
// alter Financial Flow's calculated profit. Old negative stock is a separate
// stock correction, not an additional purchase.
const text = value => typeof value === 'string' ? value.trim() : '';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
function millis(value) {
    try {
        const result = value instanceof Date ? value.getTime()
            : typeof value?.toMillis === 'function' ? value.toMillis()
            : typeof value?.toDate === 'function' ? value.toDate().getTime()
            : typeof value?.seconds === 'number' ? value.seconds * 1000 + (Number(value.nanoseconds) || 0) / 1e6
            : typeof value === 'number' ? value
            : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
        return Number.isFinite(result) ? result : null;
    } catch { return null; }
}
function boundary(value, label) {
    if (value === undefined || value === null) return null;
    const result = millis(value);
    if (result === null) throw new RangeError('Use a valid ' + label + ' date for the restock estimate period.');
    return result;
}
function normalRecord(source) {
    const items = (Array.isArray(source.items) ? source.items : []).map(value => {
        const item = value && typeof value === 'object' ? value : {};
        return {name:text(item.name) || 'Unnamed item', restockQty:amount(item.restockQty), baseUom:text(item.baseUom) || 'base units',
            purchaseQty:amount(item.purchaseQty), purchaseUom:text(item.purchaseUom), estimatedSubtotal:amount(item.estimatedSubtotal), correctionQty:amount(item.correctionQty)};
    });
    const knownEstimatedCost = roundMoney(items.reduce((sum, item) => sum + (item.estimatedSubtotal ?? 0), 0));
    const suppliedTotal = amount(source.totalCost);
    const complete = source.costStatus === 'Estimated' && suppliedTotal !== null && items.length > 0
        && items.every(item => item.estimatedSubtotal !== null && item.restockQty !== null && item.restockQty > 0)
        && Math.abs(suppliedTotal - knownEstimatedCost) <= 0.011;
    return {dispatchBatchId:text(source.dispatchBatchId), timestamp:millis(source.timestamp), toBranch:text(source.toBranch) || 'Destination not recorded',
        items, costStatus:complete ? 'Estimated' : 'Needs price review', estimatedCost:complete ? roundMoney(suppliedTotal) : null,
        knownEstimatedCost, hasDuplicateConflict:false};
}

export function collectDispatchRestockEstimates(rows, {start, end, branch = 'All'} = {}) {
    const from = boundary(start, 'start'), through = boundary(end, 'end');
    if (from !== null && through !== null && from > through) throw new RangeError('The restock estimate period ends before it starts.');
    const selectedBranch = text(branch) || 'All', unique = new Map();
    let duplicateCount = 0;
    for (const source of Array.isArray(rows) ? rows : []) {
        if (!source || source.dispatchAutoRestock !== true || !text(source.dispatchBatchId)) continue;
        const row = normalRecord(source), previous = unique.get(row.dispatchBatchId);
        if (!previous) { unique.set(row.dispatchBatchId, row); continue; }
        duplicateCount++;
        // Identical copies count once. Conflicting invoices for one committed
        // dispatch cannot silently choose a price based on collection order.
        if (JSON.stringify({...previous, hasDuplicateConflict:false}) !== JSON.stringify(row)) {
            previous.hasDuplicateConflict = true;
            previous.costStatus = 'Needs price review';
            previous.estimatedCost = null;
            previous.knownEstimatedCost = 0;
        }
    }
    const records = [...unique.values()].filter(row => row.timestamp !== null && (from === null || row.timestamp >= from)
        && (through === null || row.timestamp <= through)
        && (selectedBranch === 'All' || selectedBranch === 'Main Office' || row.toBranch === selectedBranch))
        .sort((a, b) => b.timestamp - a.timestamp || a.dispatchBatchId.localeCompare(b.dispatchBatchId));
    const needsPriceReviewCount = records.filter(row => row.estimatedCost === null).length;
    const knownEstimatedTotal = roundMoney(records.reduce((sum, row) => sum + row.knownEstimatedCost, 0));
    const totalEstimatedCost = needsPriceReviewCount ? null : roundMoney(records.reduce((sum, row) => sum + row.estimatedCost, 0));
    return {records, recordCount:records.length, itemCount:records.reduce((sum, row) => sum + row.items.length, 0),
        pricedRecordCount:records.length - needsPriceReviewCount, needsPriceReviewCount, knownEstimatedTotal,
        totalEstimatedCost, hasUnknownCosts:needsPriceReviewCount > 0, duplicateCount};
}

const cash = value => new Intl.NumberFormat('en-PH', {style:'currency', currency:'PHP', minimumFractionDigits:2, maximumFractionDigits:2}).format(value);
const quantity = (value, unit) => value === null ? 'Quantity not recorded' : new Intl.NumberFormat('en-PH', {maximumFractionDigits:6}).format(value) + ' ' + unit;
const date = value => new Date(value).toLocaleString('en-PH', {timeZone:'Asia/Manila', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'});

export function renderDispatchRestockEstimates(summary) {
    const records = Array.isArray(summary?.records) ? summary.records : [];
    const complete = summary?.totalEstimatedCost !== null && amount(summary?.totalEstimatedCost) !== null;
    const overview = records.length ? `<div class="dispatch-restock-estimates__totals"><div><span>${complete ? 'Last-price estimate' : 'Complete estimate unavailable'}</span><strong>${complete ? escape(cash(summary.totalEstimatedCost)) : 'Needs price review'}</strong></div>${complete ? '' : `<div><span>Known last-price estimates · partial subtotal</span><strong>${escape(cash(amount(summary?.knownEstimatedTotal) ?? 0))}</strong><small>Unpriced items are excluded; they are not valued at zero.</small></div>`}<div><span>Linked dispatches</span><strong>${records.length}</strong>${summary?.needsPriceReviewCount ? `<small>${escape(summary.needsPriceReviewCount)} need price review</small>` : ''}</div></div>` : '';
    const cards = records.map(record => {
        const items = record.items.map(item => {
            const purchased = item.purchaseQty !== null && item.purchaseUom ? `<span>${escape(quantity(item.purchaseQty, item.purchaseUom))} in purchase units</span>` : '';
            const correction = item.correctionQty !== null && item.correctionQty > 0 ? `<p class="dispatch-restock-estimates__correction"><strong>Old negative-stock correction:</strong> +${escape(quantity(item.correctionQty, item.baseUom))}. Separate from the restock quantity and its estimate.</p>` : '';
            return `<li><div><strong>${escape(item.name)}</strong><span>Restock added: ${escape(quantity(item.restockQty, item.baseUom))}</span>${purchased}${correction}</div><div class="dispatch-restock-estimates__item-price"><span>Last-price estimate</span><strong>${item.estimatedSubtotal === null || record.hasDuplicateConflict ? 'Needs price review' : escape(cash(item.estimatedSubtotal))}</strong></div></li>`;
        }).join('');
        return `<article class="dispatch-restock-estimates__card"><header><h4>HQ restock for ${escape(record.toBranch)}</h4><span class="dispatch-restock-estimates__badge${record.estimatedCost === null ? ' is-review' : ''}">${escape(record.costStatus)}</span></header><p>${escape(date(record.timestamp))}</p><p class="dispatch-restock-estimates__batch">Linked dispatch: ${escape(record.dispatchBatchId)}</p>${record.hasDuplicateConflict ? '<p class="dispatch-restock-estimates__correction">Conflicting records share this dispatch ID. Check the original records before using an estimate.</p>' : ''}<ul class="dispatch-restock-estimates__items">${items || '<li>No item quantities were recorded. Needs price review.</li>'}</ul><footer><span>Restock estimate</span><strong>${record.estimatedCost === null ? 'Needs price review' : escape(cash(record.estimatedCost))}</strong></footer></article>`;
    }).join('');
    return `<section class="dispatch-restock-estimates" aria-label="Dispatch restock estimates"><style>
    .dispatch-restock-estimates{min-width:0;margin-top:24px;padding:20px;border:1px solid #dce7df;border-radius:16px;background:#f7faf7;color:#183d32;overflow-wrap:anywhere;text-align:left;box-sizing:border-box}
    .dispatch-restock-estimates *{box-sizing:border-box;min-width:0}
    .dispatch-restock-estimates h3,.dispatch-restock-estimates h4,.dispatch-restock-estimates p{margin:0 0 10px}
    .dispatch-restock-estimates h3{font-size:19px}.dispatch-restock-estimates h4{font-size:16px;line-height:1.4}
    .dispatch-restock-estimates__notice{font-size:14px;line-height:1.6;color:#526b61}
    .dispatch-restock-estimates__totals,.dispatch-restock-estimates__cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:14px;margin-top:16px}
    .dispatch-restock-estimates__totals>div{padding:14px;border:1px solid #dce7df;border-radius:12px;background:white}
    .dispatch-restock-estimates__totals span,.dispatch-restock-estimates__totals strong,.dispatch-restock-estimates__totals small{display:block}
    .dispatch-restock-estimates__totals span,.dispatch-restock-estimates__totals small{font-size:13px;line-height:1.5;color:#526b61}.dispatch-restock-estimates__totals strong{margin:5px 0;font-size:20px}
    .dispatch-restock-estimates__card{padding:16px;border:1px solid #dce7df;border-radius:12px;background:white;font-size:14px;line-height:1.5}
    .dispatch-restock-estimates__card header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:8px}.dispatch-restock-estimates__card header h4{flex:1 1 12rem}
    .dispatch-restock-estimates__badge{padding:4px 8px;border-radius:8px;background:#e8f3ea;font-size:12px;font-weight:700}.dispatch-restock-estimates__badge.is-review{background:#fff2d8;color:#795416}
    .dispatch-restock-estimates__batch{color:#526b61;font-size:12px}.dispatch-restock-estimates__items{list-style:none;margin:14px 0;padding:0}
    .dispatch-restock-estimates__items li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,7.5rem);gap:10px;padding:12px 0;border-top:1px solid #e8eeea}
    .dispatch-restock-estimates__items li span{display:block;color:#526b61;font-size:13px}.dispatch-restock-estimates__item-price{text-align:right}
    .dispatch-restock-estimates__correction{margin:8px 0 0!important;padding:8px;background:#fff7e7;border-radius:8px;color:#75561d;font-size:12px;line-height:1.5}
    .dispatch-restock-estimates__card footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding-top:12px;border-top:1px solid #dce7df}
    @media(max-width:480px){.dispatch-restock-estimates{padding:14px}.dispatch-restock-estimates__items li{grid-template-columns:minmax(0,1fr)}.dispatch-restock-estimates__item-price{text-align:left}}
    </style><h3>Dispatch restock estimates</h3><p class="dispatch-restock-estimates__notice">Last known prices estimate the stock added for these dispatches. These are not confirmed supplier purchases or payments. They do not deduct cash, create an expense, or change the profit shown above. Old negative-stock corrections are shown separately and are not purchases.</p>${overview}${records.length ? `<div class="dispatch-restock-estimates__cards">${cards}</div>` : '<p class="dispatch-restock-estimates__notice">No linked automatic HQ restocks in the selected period and branch.</p>'}</section>`;
}
