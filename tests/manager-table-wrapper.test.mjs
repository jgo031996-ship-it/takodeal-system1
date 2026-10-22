import test from 'node:test';
import assert from 'node:assert/strict';
import { installManagerTableWrapper } from '../takodeal-manager/manager-table-wrapper.js';

class Element {
    constructor(tag, stats) {
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.stats = stats;
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.className = '';
        this.id = '';
        this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this.tagName === 'BODY' || Boolean(this.parentNode?.isConnected); }
    appendChild(node) {
        node.remove();
        this.children.push(node);
        node.parentNode = this;
        return node;
    }
    insertBefore(node, before) {
        node.remove();
        const index = this.children.indexOf(before);
        assert.notEqual(index, -1);
        this.children.splice(index, 0, node);
        node.parentNode = this;
    }
    remove() {
        if (!this.parentNode) return;
        this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
        this.parentNode = null;
    }
    querySelectorAll(selector) {
        assert.equal(selector, 'table');
        return this.children.flatMap(child => [...(child.tagName === 'TABLE' ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    closest(selector) {
        if (this.tagName === 'TABLE') this.stats.tableChecks++;
        for (let node = this; node; node = node.parentNode) {
            for (const part of selector.split(',')) {
                if (part[0] === '#' && node.id === part.slice(1)) return node;
                if (part[0] === '.' && node.classList.contains(part.slice(1))) return node;
            }
        }
        return null;
    }
}

function fixture(initialCount = 0) {
    const stats = { documentTableQueries: 0, tableChecks: 0 }, body = new Element('body', stats);
    const tables = Array.from({ length: initialCount }, () => body.appendChild(new Element('table', stats)));
    const frames = new Map(), observers = [];
    let nextFrame = 0;
    const d = {
        body,
        createElement: tag => new Element(tag, stats),
        querySelectorAll(selector) { stats.documentTableQueries++; return body.querySelectorAll(selector); }
    };
    const w = {
        requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
            observe(target, options) { this.target = target; this.options = options; }
            disconnect() { this.disconnected = true; }
        }
    };
    return {
        w, d, body, tables, stats, frames, observers,
        element: tag => new Element(tag, stats),
        install: () => installManagerTableWrapper(w, d),
        mutate: (...nodes) => observers[0].callback([{ addedNodes: nodes }]),
        frame() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); }
    };
}

test('one initial pass preserves all 76 hidden or visible table layouts and observes child additions', () => {
    const h = fixture(76);
    h.tables[0].style.display = 'none';
    h.install();
    assert.equal(h.stats.documentTableQueries, 1);
    assert.equal(h.observers.length, 1);
    assert.equal(h.observers[0].target, h.body);
    assert.deepEqual(h.observers[0].options, { childList: true, subtree: true });
    for (const table of h.tables) {
        assert.equal(table.parentElement.className, 'mobile-table-wrapper');
        assert.equal(table.style.minWidth, '800px');
        assert.equal(table.style.width, '100%');
    }
    assert.equal(h.tables[0].style.display, 'none');
});

test('payroll status and row mutations do zero global scans or checks of the 76 existing tables', () => {
    const h = fixture(76);
    h.install();
    h.stats.documentTableQueries = 0;
    h.stats.tableChecks = 0;
    const status = h.element('span'), row = h.element('tr');
    row.appendChild(h.element('td'));
    h.body.appendChild(status);
    h.tables[0].appendChild(row);
    h.mutate({ nodeType: 3, textContent: 'Loading payroll' }, status);
    h.mutate(row);
    assert.deepEqual(h.stats, { documentTableQueries: 0, tableChecks: 0 });
    assert.equal(h.frames.size, 0);
});

test('direct tables and nested added subtrees are deduplicated and wrapped in the next frame', () => {
    const h = fixture();
    h.install();
    const direct = h.body.appendChild(h.element('table')), panel = h.body.appendChild(h.element('section'));
    const nested = panel.appendChild(h.element('div')).appendChild(h.element('table'));
    h.mutate(direct, panel, nested);
    h.mutate(panel);
    assert.equal(h.frames.size, 1);
    assert.equal(direct.parentElement, h.body);
    h.frame();
    assert.equal(direct.parentElement.className, 'mobile-table-wrapper');
    assert.equal(nested.parentElement.className, 'mobile-table-wrapper');
    assert.equal(h.stats.documentTableQueries, 1);
    assert.equal(h.frames.size, 0);
    // The observer can see its own wrapper insertion without creating another wrapper.
    const wrapper = direct.parentElement;
    h.mutate(wrapper, direct);
    h.frame();
    assert.equal(direct.parentElement, wrapper);
    assert.equal(wrapper.parentElement, h.body);
});

test('print payslips, stock request reviews, remittance dialogs and existing wrappers retain their original styles', () => {
    const h = fixture(), excluded = [];
    for (const kind of ['payslip', 'review', 'remit-audit', 'remit-history', 'wrapped', 'nested-wrapper']) {
        const panel = h.body.appendChild(h.element('div'));
        if (kind === 'payslip') panel.id = 'printablePayslip';
        else if (kind === 'review') panel.className = 'stock-request-review-popup';
        else if (kind === 'remit-audit') panel.id = 'remitAuditModal';
        else if (kind === 'remit-history') panel.id = 'branchTransferHistoryModal';
        else panel.className = 'mobile-table-wrapper';
        const parent = kind === 'nested-wrapper' ? panel.appendChild(h.element('div')) : panel;
        const table = parent.appendChild(h.element('table'));
        table.style.minWidth = '320px'; table.style.width = '90%';
        excluded.push({ table, parent });
    }
    h.install();
    for (const { table, parent } of excluded) {
        assert.equal(table.parentElement, parent);
        assert.deepEqual(table.style, { minWidth: '320px', width: '90%' });
    }
    const review = h.body.appendChild(h.element('div')); review.className = 'stock-request-review-popup';
    const added = review.appendChild(h.element('table'));
    h.mutate(review); h.frame();
    assert.equal(added.parentElement, review);
    assert.deepEqual(added.style, {});
});

test('large insertion batches process at most 64 queued tables per animation frame', () => {
    const h = fixture(); h.install();
    const panel = h.body.appendChild(h.element('section'));
    const tables = Array.from({ length: 130 }, () => panel.appendChild(h.element('table')));
    h.mutate(panel);
    const wrapped = () => tables.filter(table => table.parentElement.className === 'mobile-table-wrapper').length;
    h.frame(); assert.equal(wrapped(), 64); assert.equal(h.frames.size, 1);
    h.frame(); assert.equal(wrapped(), 128); assert.equal(h.frames.size, 1);
    h.frame(); assert.equal(wrapped(), 130); assert.equal(h.frames.size, 0);
    assert.equal(h.stats.documentTableQueries, 1);
});

test('removed additions stay untouched and stopping cancels work without duplicate installations', () => {
    const h = fixture(), controller = h.install();
    assert.equal(h.install(), controller);
    assert.equal(h.observers.length, 1);
    const detached = h.body.appendChild(h.element('table'));
    h.mutate(detached); detached.remove(); h.frame();
    assert.deepEqual(detached.style, {});
    const pending = h.body.appendChild(h.element('table'));
    h.mutate(pending); controller.stop(); controller.stop();
    assert.equal(h.frames.size, 0);
    assert.equal(h.observers[0].disconnected, true);
    h.mutate(pending);
    assert.equal(h.frames.size, 0);
    assert.equal(pending.parentElement, h.body);
    const fresh = h.install();
    assert.notEqual(fresh, controller);
    assert.equal(pending.parentElement.className, 'mobile-table-wrapper');
});
