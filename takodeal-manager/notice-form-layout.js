const layouts = new WeakMap();

// Presentation only: no input replacement, formatting, validation or HR writes.
export function installNoticeFormLayout(doc = document, win = window) {
    if (layouts.has(doc)) return layouts.get(doc);
    const modal = doc.getElementById('issueSanctionModal');
    if (!modal) return {refresh() {}, dispose() {}};
    const panel = modal.querySelector('.notice-form-dialog');
    const viewport = win.visualViewport, listeners = [], pointers = new Set();
    const keys = ['--notice-viewport-height', '--notice-viewport-top', '--notice-viewport-width', '--notice-viewport-left'];
    let disposed = false, opened = false, frame = null, returnFocus = null, openerCandidate = null, revealSuppressedFor = null;
    const listen = (target, type, fn, options) => {
        if (!target?.addEventListener) return;
        target.addEventListener(type, fn, options);
        listeners.push(() => target.removeEventListener(type, fn, options));
    };
    const focus = node => {
        if (!node?.focus || node.isConnected === false) return;
        try { node.focus({preventScroll: true}); } catch { node.focus(); }
    };
    const shown = () => !modal.hidden && modal.style.display !== 'none' && (!win.getComputedStyle || win.getComputedStyle(modal).display !== 'none');
    const visible = node => node && !node.disabled && !node.hidden && node.getAttribute?.('aria-hidden') !== 'true' && node.isConnected !== false && (!node.getClientRects || node.getClientRects().length > 0);
    const nestedDialog = () => Boolean(win.Swal?.isVisible?.());
    const clear = () => {
        for (const key of keys) if (modal.style.getPropertyValue(key)) modal.style.removeProperty(key);
    };
    function closed() {
        clear(); pointers.clear(); revealSuppressedFor = null;
        if (!opened) return;
        opened = false;
        const active = doc.activeElement, prior = returnFocus;
        returnFocus = null; openerCandidate = null;
        // A success/error popup or another workflow may already own focus.
        if (!nestedDialog() && (modal.contains(active) || active === doc.body || !active) && visible(prior)) focus(prior);
    }
    function refresh() {
        if (disposed) return;
        if (!shown()) { closed(); return; }
        if (!opened) {
            opened = true;
            const prior = visible(openerCandidate) ? openerCandidate : doc.activeElement;
            returnFocus = prior !== doc.body && !modal.contains(prior) ? prior : null;
            openerCandidate = null;
            // Announce the dialog without opening a date/phone keyboard.
            if (!modal.contains(doc.activeElement) && !nestedDialog()) focus(panel);
        }
        // Keep intentional browser zoom/panning under the user's control.
        if (viewport && Math.abs(Number(viewport.scale || 1) - 1) > .05) { clear(); return; }
        const height = Number(viewport?.height || win.innerHeight), width = Number(viewport?.width || win.innerWidth);
        const top = Math.max(0, Number(viewport?.offsetTop || 0)), left = Math.max(0, Number(viewport?.offsetLeft || 0));
        if (![height,width,top,left].every(Number.isFinite) || height <= 0 || width <= 0) return;
        [height,top,width,left].forEach((value,index) => {const text=value+'px';if (modal.style.getPropertyValue(keys[index]) !== text) modal.style.setProperty(keys[index],text);});
        const input = doc.activeElement;
        if (pointers.size || input === revealSuppressedFor || nestedDialog() || !modal.contains(input) || !input?.matches?.('input:not([type="hidden"]),textarea,select') || input.disabled || input.readOnly) return;
        const scroller = input.closest('.notice-form-scroll');
        if (!scroller || !modal.contains(scroller)) return;
        const bounds = scroller.getBoundingClientRect(), field = input.getBoundingClientRect();
        const visibleTop = Math.max(top,bounds.top)+12, visibleBottom = Math.min(top+height,bounds.bottom)-12;
        if (visibleBottom <= visibleTop) return;
        const delta = field.bottom > visibleBottom ? field.bottom-visibleBottom : field.top < visibleTop ? field.top-visibleTop : 0;
        if (Number.isFinite(delta) && delta) scroller.scrollTop = Math.max(0,Math.min(Math.max(0,scroller.scrollHeight-scroller.clientHeight),scroller.scrollTop+delta));
    }
    const requestFrame = win.requestAnimationFrame?.bind(win) || (fn => win.setTimeout(fn,0));
    const cancelFrame = win.cancelAnimationFrame?.bind(win) || win.clearTimeout?.bind(win);
    const schedule = () => {if (!disposed && frame === null) frame=requestFrame(() => {frame=null;refresh();});};
    listen(doc,'pointerdown',event => {
        if (!shown()) {openerCandidate=event.target?.closest?.('button,a,input,select,textarea,[tabindex]') || null;return;}
        if (!modal.contains(event.target)) return;
        pointers.add(event.pointerId ?? 'pointer');
        revealSuppressedFor = event.target?.closest?.('input,textarea,select') ? null : doc.activeElement;
    },true);
    const finishPointer = event => {pointers.delete(event.pointerId ?? 'pointer');schedule();};
    listen(doc,'pointerup',finishPointer,true);listen(doc,'pointercancel',finishPointer,true);
    listen(doc,'focusin',event => {
        if (!shown()) {if (!modal.contains(event.target)) openerCandidate=event.target;return;}
        if (modal.contains(event.target)) {revealSuppressedFor=null;schedule();}
    });
    listen(doc,'focusout',event => {if (modal.contains(event.target)) schedule();});
    listen(doc,'click',schedule,true);listen(win,'resize',schedule);
    listen(win,'blur',() => {pointers.clear();schedule();});
    listen(viewport,'resize',schedule);listen(viewport,'scroll',schedule);
    listen(doc,'keydown',event => {
        if (!shown() || nestedDialog()) return;
        if (event.key === 'Escape') {
            if (modal.getAttribute?.('aria-busy') === 'true' || doc.getElementById('btnSaveSanction')?.disabled) return;
            const close=modal.querySelector('[data-notice-close]');
            if (!visible(close) || !close.click) return;
            event.preventDefault();event.stopPropagation();close.click();refresh();
        } else if (event.key === 'Tab') {
            const nodes=[...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node => visible(node) && node.tabIndex !== -1);
            const first=nodes[0],last=nodes[nodes.length-1],active=doc.activeElement;
            if (!first) {event.preventDefault();focus(panel);return;}
            if (event.shiftKey && (active === first || active === panel || !modal.contains(active))) {event.preventDefault();focus(last);}
            else if (!event.shiftKey && (active === last || active === panel || !modal.contains(active))) {event.preventDefault();focus(first);}
        }
    },true);
    const observer = win.MutationObserver ? new win.MutationObserver(schedule) : null;
    observer?.observe(modal,{attributes:true,attributeFilter:['style','class','hidden']});
    const layout={refresh,dispose() {
        disposed=true;listeners.forEach(remove=>remove());observer?.disconnect();
        if (frame !== null) cancelFrame?.(frame);
        clear();pointers.clear();returnFocus=null;openerCandidate=null;layouts.delete(doc);
    }};
    layouts.set(doc,layout);refresh();return layout;
}
