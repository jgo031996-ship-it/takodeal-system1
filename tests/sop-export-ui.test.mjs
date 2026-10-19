import test from 'node:test';
import assert from 'node:assert/strict';
import {installSopChecklistExport} from '../takodeal-manager/sop-checklist-export-ui.js';
import {loadSopChecklistExport} from '../takodeal-manager/sop-checklist-export-service.js';

// Minimal DOM with native-dialog lifecycle and user events. The export service
// and UI are the real modules; only the final file writer is replaced here.
const unescape = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
class Element {
    constructor(tag, document) {this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.style = {}; this.attributes = {}; this.listeners = {}; this.disabled = false; this.open = false; this._text = '';}
    append(...nodes) {for (const node of nodes) {node.remove?.(); node.parentElement = this; this.children.push(node);}}
    prepend(node) {node.remove(); node.parentElement = this; this.children.unshift(node);}
    remove() {if (this.parentElement) {this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null;}}
    set textContent(value) {this._text = String(value); this.children = [];}
    get textContent() {return this._text + this.children.map(node => node.textContent).join('');}
    set value(value) {this._value = String(value);}
    get value() {return this._value ?? (this.tagName === 'SELECT' ? this.children.find(node => node.tagName === 'OPTION')?.value : undefined) ?? '';}
    setAttribute(name, value) {this.attributes[name] = String(value); if (['id', 'class', 'value'].includes(name)) this[name === 'class' ? 'className' : name] = String(value);}
    getAttribute(name) {return this.attributes[name] ?? null;}
    addEventListener(type, callback) {(this.listeners[type] ||= []).push(callback);}
    emit(type) {const event = {target: this, defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}}; for (const callback of this.listeners[type] || []) callback(event); return event;}
    showModal() {this.open = true;}
    close() {if (this.open) {this.open = false; this.emit('close');}}
    matches(selector) {
        if (selector[0] === '[') return Object.hasOwn(this.attributes, selector.slice(1, -1));
        if (selector[0] === '#') return this.id === selector.slice(1);
        if (selector[0] === '.') return (this.className || '').split(/\s+/).includes(selector.slice(1));
        return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {const result = []; const walk = parent => {for (const node of parent.children) {if (node.matches(selector)) result.push(node); walk(node);}}; walk(this); return result;}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    set innerHTML(html) {
        this.children = []; this._text = ''; const stack = [this];
        for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
            if (token.startsWith('</')) {stack.pop(); continue;}
            if (!token.startsWith('<')) {stack.at(-1)._text += unescape(token); continue;}
            const tag = /^<([\w-]+)/.exec(token)?.[1]; if (!tag) continue;
            const node = new Element(tag, this.ownerDocument);
            const attributes = token.slice(tag.length + 1, -1);
            for (const match of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(match[1], unescape(match[2] ?? ''));
            stack.at(-1).append(node);
            if (!['input', 'br', 'img', 'hr', 'meta', 'link'].includes(tag)) stack.push(node);
        }
    }
}
class Document {
    constructor() {this.head = new Element('head', this); this.body = new Element('body', this);}
    createElement(tag) {return new Element(tag, this);}
    getElementById(id) {return [this.head, this.body].flatMap(root => [root, ...root.querySelectorAll('#' + id)]).find(node => node.id === id) || null;}
    querySelectorAll(selector) {
        const parts = selector.split(' ');
        if (parts.length === 2 && parts[0][0] === '#') return this.getElementById(parts[0].slice(1))?.querySelectorAll(parts[1]) || [];
        return [...this.head.querySelectorAll(selector), ...this.body.querySelectorAll(selector)];
    }
}
function fixture({branch = 'Sample Branch', role = 'Morning Kitchen'} = {}) {
    const document = new Document(), create = (tag, id, parent = document.body) => {const element = document.createElement(tag); element.id = id; parent.append(element); return element;};
    const builder = create('section', 'sopTabBuilder'), branchSelect = create('select', 'sopBuilderBranch', builder), roleSelect = create('select', 'sopBuilderRole', builder);
    branchSelect.value = branch; roleSelect.value = role;
    const taskContainer = create('div', 'sopTasksContainer', builder); taskContainer.style.display = 'block';
    const taskList = create('div', 'sopTasksList', taskContainer);
    const saved = {'Morning Kitchen': ['Wash hands.', 'Prepare the station.'], 'Evening Service': ['Review handover notes.'], 'Empty role': []};
    const inputs = saved['Morning Kitchen'].map(text => {const input = create('input', '', taskList); input.className = 'sop-task-input'; input.value = text; return input;});
    let reads = 0, authChanged, loader = async () => ({exists: () => true, data: () => ({roles: structuredClone(saved)}), metadata: {fromCache: false, hasPendingWrites: false}});
    const downloads = [], window = {auth: {currentUser: {uid: 'sample-owner', email: 'jgo031996@gmail.com', emailVerified: true}},
        sessionUser: {uid: 'sample-owner', email: 'jgo031996@gmail.com', permissions: ['all'], allowedBranches: ['All']},
        db: {}, doc: (_db, ...parts) => ({path: parts.join('/')}),
        getDocFromServer: async reference => {reads++; assert.equal(reference.path, 'settings/sop_' + branch); return loader();},
        onAuthStateChanged: (_auth, callback) => {authChanged = callback;}};
    const download = async (_window, _document, options) => {options.assertCurrent(); downloads.push({branch: options.branch, roles: structuredClone(options.roles)}); options.assertCurrent(); return new Blob(['synthetic PDF']);};
    const installed = installSopChecklistExport(window, document, {load: loadSopChecklistExport, download});
    return {document, window, saved, inputs, downloads, installed, branchSelect, roleSelect,
        get reads() {return reads;}, setLoader: value => {loader = value;}, changeAuth: () => authChanged(),
        open() {window.downloadSopA4Checklist(); return document.getElementById('sopA4ExportDialog');}};
}
const downloadButton = dialog => dialog.querySelector('[data-download]');
const status = dialog => dialog.querySelector('[data-status]');

test('installer is idle and idempotent; account or branch access controls the visible export button', () => {
    const f = fixture();
    assert.equal(f.reads, 0); assert.equal(f.downloads.length, 0);
    assert.equal(f.document.getElementById('btnDownloadSopA4').disabled, false);
    assert.equal(installSopChecklistExport(f.window, f.document), f.installed);
    assert.equal(f.document.querySelectorAll('#btnDownloadSopA4').length, 1);
    f.window.auth.currentUser.emailVerified = false; f.installed.mount();
    assert.equal(f.document.getElementById('btnDownloadSopA4').disabled, true);
    assert.equal(f.open(), null);
    const missingBranch = fixture({branch: ''}); assert.equal(missingBranch.document.getElementById('btnDownloadSopA4').disabled, true);
});

test('selected-role download uses a fresh saved snapshot and preserves the original SOP', async () => {
    const f = fixture(), before = structuredClone(f.saved), dialog = f.open();
    assert.equal(dialog.open, true); assert.equal(f.reads, 0);
    await downloadButton(dialog).onclick();
    assert.equal(f.reads, 1); assert.deepEqual(f.downloads, [{branch: 'Sample Branch', roles: [{name: 'Morning Kitchen', tasks: before['Morning Kitchen']}]}]);
    assert.deepEqual(f.saved, before); assert.match(status(dialog).textContent, /download is ready/);
    assert.equal(downloadButton(dialog).disabled, false);
});

test('unsaved task edits block export before file creation and recover after the displayed draft is restored', async () => {
    const f = fixture(), dialog = f.open();
    f.inputs[0].value = 'An unsaved edited task.';
    await downloadButton(dialog).onclick();
    assert.equal(f.downloads.length, 0); assert.match(status(dialog).textContent, /differs from the latest saved SOP/);
    assert.equal(status(dialog).getAttribute('role'), 'alert'); assert.equal(downloadButton(dialog).disabled, false);
    f.inputs[0].value = f.saved['Morning Kitchen'][0];
    await downloadButton(dialog).onclick();
    assert.equal(f.downloads.length, 1); assert.match(status(dialog).textContent, /download is ready/);
});

test('all-role download retains a second and empty role from the saved snapshot', async () => {
    const f = fixture(), dialog = f.open(); dialog.querySelector('select').value = 'branch';
    await downloadButton(dialog).onclick();
    assert.deepEqual(f.downloads[0].roles, Object.entries(f.saved).map(([name, tasks]) => ({name, tasks})));
    assert.equal(f.downloads[0].roles.at(-1).tasks.length, 0);
});

test('server failure leaves the dialog retryable without calling the file writer', async () => {
    const f = fixture(), dialog = f.open();
    f.setLoader(async () => {throw Error('Synthetic disconnected server');});
    await downloadButton(dialog).onclick();
    assert.match(status(dialog).textContent, /disconnected server/); assert.equal(f.downloads.length, 0);
    for (const button of dialog.querySelectorAll('button')) assert.equal(button.disabled, false);
    f.setLoader(async () => ({exists: () => true, data: () => ({roles: f.saved}), metadata: {fromCache: false, hasPendingWrites: false}}));
    await downloadButton(dialog).onclick(); assert.equal(f.downloads.length, 1);
});

test('account change while a saved read is pending closes the stale dialog and prevents a file', async () => {
    const f = fixture(), dialog = f.open(); let resolveRead;
    f.setLoader(() => new Promise(resolve => {resolveRead = resolve;}));
    const pending = downloadButton(dialog).onclick();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(downloadButton(dialog).disabled, true);
    assert.equal(dialog.emit('cancel').defaultPrevented, true);
    f.window.auth.currentUser = {uid: 'other-user', email: 'other@example.test', emailVerified: true}; f.changeAuth();
    resolveRead({exists: () => true, data: () => ({roles: f.saved}), metadata: {fromCache: false, hasPendingWrites: false}});
    await pending;
    assert.equal(f.downloads.length, 0); assert.equal(dialog.open, false);
    assert.equal(f.document.getElementById('btnDownloadSopA4').disabled, true);
});

test('a programmatic branch change invalidates an in-flight export and the cancel control remains usable', async () => {
    const f = fixture(), dialog = f.open(); let resolveRead;
    f.setLoader(() => new Promise(resolve => {resolveRead = resolve;}));
    const pending = downloadButton(dialog).onclick(); await Promise.resolve(); await Promise.resolve();
    f.branchSelect.value = 'Other Branch'; f.branchSelect.emit('change');
    resolveRead({exists: () => true, data: () => ({roles: f.saved}), metadata: {fromCache: false, hasPendingWrites: false}});
    await pending;
    assert.equal(f.downloads.length, 0);
    assert.equal(dialog.querySelector('[data-cancel]').disabled, false);
    dialog.querySelector('[data-cancel]').onclick(); assert.equal(dialog.open, false);
});
