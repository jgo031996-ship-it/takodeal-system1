import test from 'node:test';
import assert from 'node:assert/strict';
import {installAuditModalLayout} from '../takodeal-manager/audit-modal-layout.js';

function events() {
    const listeners = new Map();
    return {addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, emit(type, event = {}) { listeners.get(type)?.forEach(fn => fn({type, ...event})); }, count() { return [...listeners.values()].reduce((sum, items) => sum + items.size, 0); }};
}
function harness({visualViewport = true, observer = true} = {}) {
    let next = 0, callback = null, disconnected = false;
    const frames = new Map(), properties = new Map(), modal = {style: {display: 'none', getPropertyValue: key => properties.get(key) || '', setProperty(key, value) { properties.set(key, value); callback?.(); }, removeProperty(key) { properties.delete(key); callback?.(); }}, contains: node => node?.inside === true};
    const doc = Object.assign(events(), {activeElement: null, getElementById: () => modal});
    const viewport = Object.assign(events(), {height: 700, offsetTop: 0, scale: 1});
    const win = Object.assign(events(), {innerHeight: 700, getComputedStyle: node => ({display: node.style.display}), requestAnimationFrame: fn => { frames.set(++next, fn); return next; }, cancelAnimationFrame: id => frames.delete(id)});
    if (visualViewport) win.visualViewport = viewport;
    if (observer) win.MutationObserver = class {constructor(fn) { callback = fn; } observe() {} disconnect() { callback = null; disconnected = true; }};
    const scroller = {inside: true, scrollTop: 400, scrollHeight: 2000, get clientHeight() { return parseFloat(properties.get('--general-audit-viewport-height') || '700') - 150; }, getBoundingClientRect() { return {top: 60 + Number(viewport.offsetTop), bottom: 60 + Number(viewport.offsetTop) + this.clientHeight}; }};
    const input = {inside: true, value: '0', disabled: false, readOnly: false, matches: () => true, closest: () => scroller, getBoundingClientRect: () => ({top: 60 + 950 - scroller.scrollTop, bottom: 108 + 950 - scroller.scrollTop})};
    const button = {inside: true, closest: () => null};
    function flush() { let ticks = 0; while (frames.size) { assert.ok(++ticks <= 4, 'MutationObserver and style writes must settle'); const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); } }
    const layout = installAuditModalLayout(doc, win);
    function open() { modal.style.display = 'flex'; callback?.(); layout.refresh(); flush(); }
    return {doc, win, modal, viewport, scroller, input, button, layout, properties, flush, open, get disconnected() { return disconnected; }};
}

test('Keyboard resizing reveals the exact focused count and preserves explicit zero and input identity', () => {
    const h = harness(); h.open(); h.doc.activeElement = h.input;
    h.viewport.height = 320; h.viewport.offsetTop = 30; h.viewport.emit('resize'); h.flush();
    assert.equal(h.properties.get('--general-audit-viewport-height'), '320px');
    assert.equal(h.properties.get('--general-audit-viewport-top'), '30px');
    assert.ok(h.input.getBoundingClientRect().bottom <= h.scroller.getBoundingClientRect().bottom - 12);
    assert.equal(h.input.value, '0'); assert.equal(h.doc.activeElement, h.input); h.layout.dispose();
});

test('Cancel pointer cannot be moved by a queued keyboard reveal or a lingering old count focus', () => {
    const h = harness(); h.open(); h.doc.activeElement = h.input; const before = h.scroller.scrollTop;
    h.viewport.height = 320; h.viewport.emit('resize'); h.doc.emit('pointerdown', {pointerId: 1, target: h.button}); h.flush();
    assert.equal(h.scroller.scrollTop, before); assert.equal(h.properties.get('--general-audit-viewport-height'), '320px');
    h.doc.emit('pointerup', {pointerId: 1, target: h.button}); h.flush(); assert.equal(h.scroller.scrollTop, before);
    h.doc.emit('focusin', {target: h.input}); h.flush(); assert.ok(h.scroller.scrollTop > before); h.layout.dispose();
});

test('A closed audit clears viewport presentation and never scrolls unrelated fields', () => {
    const h = harness(); h.open(); h.doc.activeElement = h.input; const before = h.scroller.scrollTop;
    h.modal.style.display = 'none'; h.viewport.emit('resize'); h.flush();
    assert.equal(h.properties.size, 0); assert.equal(h.scroller.scrollTop, before);
    h.doc.activeElement = {...h.input, inside: false}; h.open(); h.viewport.height = 320; h.viewport.emit('resize'); h.flush();
    assert.equal(h.scroller.scrollTop, before); h.layout.dispose();
});

test('Intentional pinch zoom retains browser panning without refitting or moving the count', () => {
    const h = harness(); h.open(); h.doc.activeElement = h.input; const before = h.scroller.scrollTop;
    h.viewport.scale = 1.5; h.viewport.height = 320; h.viewport.emit('scroll'); h.flush();
    assert.equal(h.properties.size, 0); assert.equal(h.scroller.scrollTop, before); h.layout.dispose();
});

test('Without visualViewport or observers, click and window resizing use a guarded innerHeight fallback', () => {
    const h = harness({visualViewport: false, observer: false}); h.open(); h.win.innerHeight = 400;
    h.win.emit('resize'); h.flush(); assert.equal(h.properties.get('--general-audit-viewport-height'), '400px');
    h.modal.style.display = 'none'; h.doc.emit('click', {target: h.button}); h.flush(); assert.equal(h.properties.size, 0); h.layout.dispose();
});

test('Duplicate installation is inert and disposal disconnects presentation listeners', () => {
    const h = harness(); assert.equal(installAuditModalLayout(h.doc, h.win), h.layout); h.open();
    h.viewport.emit('resize'); h.layout.dispose(); h.flush();
    assert.equal(h.properties.size, 0); assert.equal(h.doc.count() + h.win.count() + h.viewport.count(), 0); assert.equal(h.disconnected, true);
    h.win.emit('resize'); h.flush(); assert.equal(h.properties.size, 0);
});
