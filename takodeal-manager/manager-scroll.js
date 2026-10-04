// Screen-only presentation. Keep the real table headings (including controls)
// aligned with their columns, even inside the legacy horizontal scroll wrappers.
export function tableHeadingOffset({ naturalTop, tableBottom, headingHeight, pinnedTop }) {
    if (![naturalTop, tableBottom, headingHeight, pinnedTop].every(Number.isFinite) || headingHeight <= 0) return 0;
    return Math.max(0, Math.min(pinnedTop - naturalTop, tableBottom - naturalTop - headingHeight));
}

export function initManagerScroll({ document: d = document, window: w = window } = {}) {
    const main = d.querySelector('.main-content'), title = main?.querySelector(':scope > .topbar');
    if (!main || !title) return { schedule() {}, stop() {} };
    d.body.dataset.managerScrolling = 'manager-headings-20261004-r1';
    const tracked = new Map();
    let frame = 0, stopped = false, titleHeight = -1;
    const excluded = '.modal,.overlay,dialog,[role="dialog"],[id$="Modal"],#proposalContainer,#printablePayslip,[data-no-sticky-head]';

    function update() {
        frame = 0;
        if (stopped) return;
        const active = main.querySelector(':scope > .view.active');
        const rootRect = main.getBoundingClientRect(), titleRect = title.getBoundingClientRect();
        const changes = [], live = new Set();
        if (active) for (const table of active.querySelectorAll('table')) {
            const head = table.tHead;
            if (!head || table.closest(excluded)) continue;
            const rect = table.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            let pinnedTop = Math.max(rootRect.top + main.clientTop, titleRect.bottom);
            // Nested tables such as Dashboard reports may also scroll vertically.
            // Respect their visible edge without removing any overflow wrappers.
            let fixed = false;
            for (let parent = table.parentElement; parent && parent !== main; parent = parent.parentElement) {
                const style = w.getComputedStyle(parent);
                if (style.position === 'fixed') { fixed = true; break; }
                if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
                    pinnedTop = Math.max(pinnedTop, parent.getBoundingClientRect().top + parent.clientTop);
                }
            }
            if (fixed) continue;
            const prior = tracked.get(head) || { offset: 0, table };
            const headRect = head.getBoundingClientRect();
            const offset = tableHeadingOffset({ naturalTop: headRect.top - prior.offset,
                tableBottom: rect.bottom, headingHeight: headRect.height, pinnedTop });
            live.add(head);
            changes.push({ head, table, offset, prior });
        }
        // Perform all layout reads above before paint-only writes below.
        const height = Math.ceil(titleRect.height);
        if (height !== titleHeight) {
            titleHeight = height;
            main.style.setProperty('--manager-title-height', `${height}px`);
        }
        for (const [head, state] of tracked) if (!live.has(head)) {
            head.style.removeProperty('--manager-heading-offset');
            state.table.classList.remove('manager-sticky-table');
            tracked.delete(head);
        }
        for (const { head, table, offset, prior } of changes) {
            table.classList.add('manager-sticky-table');
            if (!tracked.has(head) || Math.abs(offset - prior.offset) > 0.1) {
                head.style.setProperty('--manager-heading-offset', `${offset}px`);
                tracked.set(head, { offset, table });
            }
        }
    }
    function schedule() { if (!stopped && !frame) frame = w.requestAnimationFrame(update); }
    // Capture covers both the main page and horizontal / nested table scrollers.
    main.addEventListener('scroll', schedule, { capture: true, passive: true });
    main.addEventListener('animationend', schedule);
    w.addEventListener('resize', schedule, { passive: true });
    w.addEventListener('pageshow', schedule);
    const resize = w.ResizeObserver ? new w.ResizeObserver(schedule) : null;
    resize?.observe(title);
    resize?.observe(main);
    d.fonts?.ready?.then(schedule);
    schedule();
    return { schedule, stop() {
        stopped = true;
        if (frame) w.cancelAnimationFrame(frame);
        main.removeEventListener('scroll', schedule, true);
        main.removeEventListener('animationend', schedule);
        w.removeEventListener('resize', schedule);
        w.removeEventListener('pageshow', schedule);
        resize?.disconnect();
        for (const [head, state] of tracked) {
            head.style.removeProperty('--manager-heading-offset');
            state.table.classList.remove('manager-sticky-table');
        }
        tracked.clear();
        main.style.removeProperty('--manager-title-height');
    } };
}
