import {escapeHtml} from './staff-privacy.js';
export function onlineRefundReviewHTML(rows,staffId){
    const own=rows.filter(row=>row.type==='Online Order Refund'&&row.staffId===staffId&&['Pending Review','Dismissed'].includes(row.status));
    if(!own.length)return '';
    return `<section style="margin-top:15px;padding:15px;border:1px solid #e9d7aa;background:#fffaf0;border-radius:12px"><h3 style="margin:0 0 12px;font-size:14px">Online Order Refunds</h3><p style="font-size:12px;color:#64756d">Pending incidents are shown for review. Salary charge: ₱0.00. Contact the Owner to give your response or dispute the incident.</p>${own.map(row=>`<div style="padding:10px 0;border-bottom:1px solid #eee4d2;font-size:13px;overflow-wrap:anywhere"><strong>${escapeHtml(row.sourcePlatform)} · ${escapeHtml(row.sourceReceiptId)}</strong><br>${escapeHtml(row.status)} · Reported refund: ₱${Number(row.proposedAmount||0).toFixed(2)}<br><small>${escapeHtml(row.remarks||'')}${row.responseRecorded?' · Your response has been recorded.':''}</small></div>`).join('')}</section>`;
}
