import {escapeHTML} from './customer-menu.js?v=customer-repair-20261004';

// Display the saved receipt, never today's menu prices or payment evidence.
const text = value => typeof value === 'string' ? value.trim() : '';
function amount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}
const money = value => amount(value) === null ? 'Not available' : `₱${amount(value).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const quantity = value => {
    const number = amount(value);
    return number !== null && number > 0 ? String(number) : '?';
};
function row(label, value) {
    return `<div class="customer-order-meta-row"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;
}
function itemsOf(order) {
    return Array.isArray(order?.items) ? order.items.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
}
function itemHTML(item) {
    const name = text(item.name) || text(item.itemName) || 'Item';
    const variant = text(item.variantName);
    const options = [];
    const addons = item.addons && typeof item.addons === 'object' ? Object.entries(item.addons) : [];
    for (const [key, addon] of addons) {
        if (!addon || typeof addon !== 'object' || !(amount(addon.qty) > 0)) continue;
        const name = text(addon.name) || (Array.isArray(item.addons) ? '' : key);
        if (name) options.push(`${quantity(addon.qty)} × ${name}`);
    }
    return `<li class="customer-order-item">
        <div class="customer-order-item-heading"><strong>${escapeHTML(quantity(item.quantity ?? item.qty))} × ${escapeHTML(name)}</strong><span>${money(item.lineTotalFinal)}</span></div>
        ${variant && variant.toLowerCase() !== 'standard' ? `<p>Option: ${escapeHTML(variant)}</p>` : ''}
        ${options.length ? `<p>Options per item: ${escapeHTML(options.join(', '))}</p>` : ''}
        ${text(item.notes) ? `<p class="customer-order-notes">Note: ${escapeHTML(text(item.notes))}</p>` : ''}
    </li>`;
}

export function renderOrderDetails(order = {}) {
    order = order && typeof order === 'object' ? order : {};
    const items = itemsOf(order);
    const delivery = /delivery/i.test(text(order.orderType));
    return `<section class="customer-order-summary" aria-label="Order summary">
        <h3>Order summary</h3>
        ${items.length ? `<ul class="customer-order-items">${items.map(itemHTML).join('')}</ul>` : '<p class="customer-order-empty">Item details are not available for this order.</p>'}
        <dl class="customer-order-meta">
            ${row('Branch', text(order.branch) || 'Not available')}
            ${text(order.orderType) ? row('Order type', text(order.orderType)) : ''}
            ${text(order.preferredTime) ? row('Preferred time', text(order.preferredTime)) : ''}
            ${delivery && text(order.deliveryAddress) ? row('Delivery address', text(order.deliveryAddress)) : ''}
            ${text(order.paymentMode) ? row('Payment method', text(order.paymentMode)) : ''}
            ${delivery && amount(order.deliveryFee) !== null ? row('Delivery fee (included)', money(order.deliveryFee)) : ''}
            ${row('Order total', money(order.totalAmount))}
        </dl>
    </section>`;
}

function orderDate(timestamp) {
    try {
        const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
        return timestamp && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-PH', {month:'short', day:'numeric', year:'numeric'}) : 'Recent';
    } catch { return 'Recent'; }
}
export function renderOrderHistoryCard(order = {}) {
    order = order && typeof order === 'object' ? order : {};
    const statuses = {mobile_queue:'Pending confirmation', preparing:'Preparing', ready:'Ready', out_for_delivery:'Out for delivery', rider_near:'Rider nearby', rider_arrived:'Rider arrived', completed:'Completed', rejected:'Rejected'};
    const status = Object.hasOwn(statuses, order.status) ? statuses[order.status] : 'Status unavailable';
    const preview = itemsOf(order).map(item => `${quantity(item.quantity ?? item.qty)} × ${text(item.name) || text(item.itemName) || 'Item'}`).join(' · ');
    return `<article class="customer-order-history-card">
        <div class="customer-order-history-heading"><div><h3>${escapeHTML(text(order.orderCode) || 'Order')}</h3><p>${escapeHTML(orderDate(order.timestamp))} · ${escapeHTML(text(order.branch))}</p></div><div><strong>${money(order.totalAmount)}</strong><p>${status}</p></div></div>
        ${preview ? `<p class="customer-order-preview">${escapeHTML(preview)}</p>` : ''}
        <details class="customer-order-history-details"><summary>View order details</summary>${renderOrderDetails(order)}</details>
    </article>`;
}

export function clearTrackedOrderDetails(document) {
    const summary = document.getElementById('trackerOrderSummary');
    if (summary) { summary.innerHTML = ''; delete summary.dataset.orderId; }
    const details = document.getElementById('trackerDetails');
    if (details) details.open = false;
}
export function updateTrackedOrderDetails(document, order) {
    const summary = document.getElementById('trackerOrderSummary');
    if (!summary) return;
    if (summary.dataset.orderId !== order.id) clearTrackedOrderDetails(document);
    summary.dataset.orderId = order.id;
    summary.innerHTML = renderOrderDetails(order);
}
