const installations = new WeakMap();
const TABLES_PER_FRAME = 64;

/** Keep app tables scrollable without rescanning every hidden table on each UI update. */
export function installManagerTableWrapper(w, d) {
    if (!d?.body) return null;
    if (installations.has(d)) return installations.get(d);

    const pending = new Set();
    const requestFrame = typeof w.requestAnimationFrame === 'function'
        ? callback => w.requestAnimationFrame(callback)
        : callback => w.setTimeout(callback, 16);
    const cancelFrame = typeof w.requestAnimationFrame === 'function'
        ? id => w.cancelAnimationFrame?.(id)
        : id => w.clearTimeout(id);
    let frame = null;
    let stopped = false;

    function wrap(table) {
        if (table.isConnected === false || !table.parentElement) return;
        // Compact print documents and request reviews retain their existing layout.
        if (table.closest('#printablePayslip,.stock-request-review-popup,#remitAuditModal,#branchTransferHistoryModal')) return;
        if (table.parentElement.classList.contains('mobile-table-wrapper') || table.closest('.mobile-table-wrapper')) return;
        const wrapper = d.createElement('div');
        wrapper.className = 'mobile-table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
        table.style.minWidth = '800px';
        table.style.width = '100%';
    }

    function flush() {
        frame = null;
        if (stopped) return;
        let count = 0;
        for (const table of pending) {
            pending.delete(table);
            wrap(table);
            if (++count >= TABLES_PER_FRAME) break;
        }
        if (pending.size) frame = requestFrame(flush);
    }

    function collect(node) {
        if (node.nodeType !== 1) return;
        if (node.tagName?.toUpperCase() === 'TABLE') pending.add(node);
        for (const table of node.querySelectorAll('table')) pending.add(table);
    }

    // One full pass also covers tables in panels that are currently hidden.
    for (const table of d.querySelectorAll('table')) wrap(table);
    const observer = new w.MutationObserver(records => {
        if (stopped) return;
        for (const record of records) {
            for (const node of record.addedNodes) collect(node);
        }
        if (pending.size && frame === null) frame = requestFrame(flush);
    });
    observer.observe(d.body, { childList: true, subtree: true });

    const controller = {
        stop() {
            if (stopped) return;
            stopped = true;
            observer.disconnect();
            if (frame !== null) cancelFrame(frame);
            frame = null;
            pending.clear();
            installations.delete(d);
        }
    };
    installations.set(d, controller);
    return controller;
}
