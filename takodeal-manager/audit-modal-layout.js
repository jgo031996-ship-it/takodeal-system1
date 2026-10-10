const layouts = new WeakMap();

// Open-audit presentation only. Values, counts and database actions stay untouched.
export function installAuditModalLayout(doc = document, win = window) {
    if (layouts.has(doc)) return layouts.get(doc);
    const modal = doc.getElementById('generalAuditModal');
    if (!modal) return {refresh() {}, dispose() {}};
    const viewport = win.visualViewport, listeners = [], activePointers = new Set();
    let disposed = false, frame = null, revealSuppressedFor = null;
    const keys = ['--general-audit-viewport-height', '--general-audit-viewport-top'];
    const listen = (target, type, fn, options) => {
        if (!target?.addEventListener) return;
        target.addEventListener(type, fn, options);
        listeners.push(() => target.removeEventListener(type, fn, options));
    };
    const set = (key, value) => {
        if (modal.style.getPropertyValue(key) !== value) modal.style.setProperty(key, value);
    };
    const clear = () => {
        for (const key of keys) if (modal.style.getPropertyValue(key)) modal.style.removeProperty(key);
    };
    const isOpen = () => modal.style.display !== 'none' && (!win.getComputedStyle || win.getComputedStyle(modal).display !== 'none');
    const refresh = () => {
        if (disposed) return;
        if (!isOpen()) { clear(); activePointers.clear(); revealSuppressedFor = null; return; }
        // Let the browser handle intentional pinch zoom and panning.
        if (viewport && Math.abs(Number(viewport.scale || 1) - 1) > .05) { clear(); return; }
        const height = Number(viewport?.height || win.innerHeight), top = Math.max(0, Number(viewport?.offsetTop || 0));
        if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(top)) return;
        set(keys[0], height + 'px'); set(keys[1], top + 'px');
        const input = doc.activeElement;
        // Do not move Cancel/Close underneath a pointer or reveal an old field
        // after a button tap in a browser that keeps that field focused.
        if (activePointers.size || input === revealSuppressedFor) return;
        if (!input?.matches?.('input:not([type="hidden"]),textarea,select') || input.disabled || input.readOnly || !modal.contains(input)) return;
        const scroller = input.closest('.general-audit-scroll');
        if (!scroller || !modal.contains(scroller)) return;
        const bounds = scroller.getBoundingClientRect(), field = input.getBoundingClientRect();
        const visibleTop = Math.max(top, bounds.top) + 12, visibleBottom = Math.min(top + height, bounds.bottom) - 12;
        if (visibleBottom <= visibleTop) return;
        const delta = field.bottom > visibleBottom ? field.bottom - visibleBottom : field.top < visibleTop ? field.top - visibleTop : 0;
        if (delta) scroller.scrollTop = Math.max(0, Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), scroller.scrollTop + delta));
    };
    const requestFrame = win.requestAnimationFrame?.bind(win) || (fn => win.setTimeout(fn, 0));
    const cancelFrame = win.cancelAnimationFrame?.bind(win) || win.clearTimeout?.bind(win);
    const schedule = () => {
        if (disposed || frame !== null) return;
        frame = requestFrame(() => { frame = null; refresh(); });
    };
    listen(doc, 'pointerdown', event => {
        if (!isOpen() || !modal.contains(event.target)) return;
        activePointers.add(event.pointerId ?? 'pointer');
        revealSuppressedFor = event.target?.closest?.('input,textarea,select') ? null : doc.activeElement;
    }, true);
    const finishPointer = event => { activePointers.delete(event.pointerId ?? 'pointer'); schedule(); };
    listen(doc, 'pointerup', finishPointer, true); listen(doc, 'pointercancel', finishPointer, true);
    listen(win, 'blur', () => { activePointers.clear(); schedule(); });
    listen(doc, 'focusin', event => { if (modal.contains(event.target)) { revealSuppressedFor = null; schedule(); } });
    listen(doc, 'focusout', event => { if (modal.contains(event.target)) schedule(); });
    listen(doc, 'click', event => { if (modal.contains(event.target)) schedule(); }, true);
    listen(win, 'resize', schedule); listen(viewport, 'resize', schedule); listen(viewport, 'scroll', schedule);
    const observer = win.MutationObserver ? new win.MutationObserver(schedule) : null;
    observer?.observe(modal, {attributes: true, attributeFilter: ['style', 'class']});
    const layout = {refresh, dispose() {
        disposed = true; listeners.forEach(remove => remove()); observer?.disconnect();
        if (frame !== null) cancelFrame?.(frame);
        clear(); layouts.delete(doc);
    }};
    layouts.set(doc, layout); refresh(); return layout;
}
