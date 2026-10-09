import {stockReportQuantities,formatStockQuantity} from './stock-report-units.js';

// Presentation only. Saved requests, live inventory and dispatch-cart quantities
// are never modified here; reported counts use the request's retained units.
const text=value=>String(value ?? '').trim();
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const own=(map,key)=>map && Object.hasOwn(map,key);
const number=value=>{if(typeof value!=='number' && typeof value!=='string' || typeof value==='string' && !value.trim())return null;const result=Number(value);return Number.isFinite(result)?result:null;};
const itemsOf=po=>Array.isArray(po?.items)?po.items:[];
const millis=value=>{try {const result=value?.toMillis?.() ?? value?.toDate?.()?.getTime?.() ?? (value?.seconds!=null?Number(value.seconds)*1000:value instanceof Date?value.getTime():Date.parse(value || ''));return Number.isFinite(result)?result:null;}catch{return null;}};
function submittedAt(value){const at=millis(value);return at===null?'Date not recorded':new Date(at).toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}

export function stockRequestReviewSummary(po={}) {
    return {branch:text(po.branch)||'Branch not recorded',requestedBy:text(po.requestedBy)||'Not recorded',submittedAt:submittedAt(po.timestamp),
        itemCount:itemsOf(po).length,status:text(po.status)||'Status not recorded',type:text(po.type)||'Stock request',originalRequestDate:text(po.originalRequestDate)};
}

export function stockRequestReviewRows(po={},hqStock={},hqDetails={}) {
    return itemsOf(po).map((source,index)=>{
        const item=source && typeof source==='object'?source:{},lookupName=String(item.itemName || item.name || ''),itemName=text(lookupName)||'Unnamed item';
        const details=own(hqDetails,lookupName) && hqDetails[lookupName] && typeof hqDetails[lookupName]==='object'?hqDetails[lookupName]:{};
        const quantities=stockReportQuantities(item),reported=quantities.reported,requested=quantities.requested;
        // displayQty can be a restock deficit. It is never a physical count.
        const hasReported=Object.hasOwn(item,'physicalStock'),isForecast=item.isForecast===true || po.isForecast===true;
        let status=text(item.requestType)||'Request';
        if(status==='Delayed / Backlogged' && hasReported && reported)status=reported.baseQuantity<=0?'Out of Stock':'Low Stock';
        const lower=status.toLowerCase(),tone=lower.includes('lost in transit')?'lost':lower.includes('out of stock')?'out':lower.includes('low stock')?'low':'info';
        const baseUnit=text(details.uom || details.baseUom || quantities.baseUom)||'base units (unit not recorded)';
        const hqQuantity=lookupName && own(hqStock,lookupName)?number(hqStock[lookupName]):null,warnings=[...quantities.warnings];
        let system=quantities.system;
        const systemBase=number(item.systemStock);
        if(systemBase!==null && systemBase<0){
            const recordedUnit=quantities.baseUom || 'base units (unit not recorded)',savedText=`${formatStockQuantity(systemBase)} ${recordedUnit}`;
            system={text:savedText,baseText:savedText,baseQuantity:systemBase,unit:quantities.baseUom};
            warnings.push('Recorded branch stock is negative and needs review.');
        }
        if(hasReported && !reported)warnings.push('Reported count was not recorded clearly.');
        if(hqQuantity!==null && hqQuantity<0)warnings.push('HQ stock is negative and needs review.');
        return {index,itemName,status,tone,isForecast,hasReported,reported,requested,system,
            hqQuantity,hqUnit:baseUnit,hqText:hqQuantity===null?'Unknown':`${formatStockQuantity(hqQuantity)} ${baseUnit}`,
            warnings:[...new Set(warnings)]};
    });
}

function metric(label,quantity,{required=false}={}) {
    if(!quantity && !required)return '';
    const detail=quantity?.baseText && quantity.baseText!==quantity.text?`<span class="stock-request-review__muted">${esc(quantity.baseText)} in base units</span>`:'';
    return `<div class="stock-request-review__metric"><span class="stock-request-review__muted">${esc(label)}</span><strong class="stock-request-review__number">${esc(quantity?.text || 'Not recorded')}</strong>${detail}</div>`;
}
function actionArgument(poId) {
    if(typeof poId!=='string' || !poId || poId.includes('/'))return null;
    try{return encodeURIComponent(poId).replace(/'/g,'%27');}catch{return null;}
}

export function renderStockRequestReview(po={}, {poId,hqStock={},hqDetails={}}={}) {
    const summary=stockRequestReviewSummary(po),rows=stockRequestReviewRows(po,hqStock,hqDetails);
    const titleText=po.type==='Internal Request'?`Stock issue report · ${summary.branch}`:`Stock request · ${summary.branch}`;
    const metadata=[['Destination',summary.branch],['Requested by',summary.requestedBy],['Submitted',summary.submittedAt],['Request status',summary.status]];
    if(summary.originalRequestDate)metadata.push(['Originally requested',summary.originalRequestDate]);
    const body=rows.map(row=>{
        const quantity=row.hasReported?metric('Reported count',row.reported,{required:true})+metric('Restock requested',row.requested):metric(row.isForecast?'Restock requested':'Requested',row.requested,{required:true});
        const branchStock=metric('Recorded branch stock',row.system);
        const warnings=row.warnings.length?`<ul class="stock-request-review__warnings">${row.warnings.map(warning=>`<li>${esc(warning)}</li>`).join('')}</ul>`:'';
        return `<tr role="row"><td role="cell" class="stock-request-review__item" data-label="Item"><strong>${esc(row.itemName)}</strong>${row.isForecast?'<span class="stock-request-review__muted">Forecast request</span>':''}</td><td role="cell" class="stock-request-review__quantity" data-label="Requested / counted">${quantity}${branchStock}</td><td role="cell" class="stock-request-review__stock" data-label="HQ stock"><strong class="stock-request-review__number">${esc(row.hqText)}</strong>${row.hqQuantity===null?'<span class="stock-request-review__muted">No usable HQ quantity on record</span>':row.hqQuantity<0?'<span class="stock-request-review__muted">Needs review</span>':''}</td><td role="cell" class="stock-request-review__status" data-label="Status / reason"><span class="stock-request-review__badge is-${row.tone}">${esc(row.status)}</span>${warnings}</td></tr>`;
    }).join('');
    const argument=actionArgument(poId);
    const actions=argument===null?'':`<details class="stock-request-review__actions"><summary>More actions</summary><p class="stock-request-review__muted">Use these controls only when this request should not proceed.</p><div><button type="button" class="stock-request-review__action stock-request-review__action--reject" onclick="window.processRejectRequest(decodeURIComponent('${argument}'))">Reject and notify branch</button><button type="button" class="stock-request-review__action stock-request-review__action--delete" onclick="window.deleteStockRequest(decodeURIComponent('${argument}'))">Delete request permanently</button></div></details>`;
    const list=rows.length?`<div class="stock-request-review__list"><table role="table" class="stock-request-review__table"><caption class="stock-request-review__sr-only">Requested items, reported branch counts, HQ stock and reasons</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Item</th><th scope="col" role="columnheader">Requested / counted</th><th scope="col" role="columnheader">HQ stock</th><th scope="col" role="columnheader">Status / reason</th></tr></thead><tbody role="rowgroup">${body}</tbody></table></div>`:'<div class="stock-request-review__empty">No items were recorded in this request. Close it and verify the request with the branch.</div>';
    const html=`<section class="stock-request-review" aria-label="Stock request details"><dl class="stock-request-review__summary">${metadata.map(([label,value])=>`<div class="stock-request-review__summary-item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="stock-request-review__heading"><h3>Items to review</h3><span>${summary.itemCount} ${summary.itemCount===1?'item':'items'}</span></div>${list}<p class="stock-request-review__footer">Adding a request to the dispatch draft does not send stock. HQ must choose amounts for reported-count items and confirm the quantities before dispatch.</p>${actions}</section>`;
    return {html,titleText,summary,rows};
}
