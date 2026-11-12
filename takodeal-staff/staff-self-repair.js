/* Staff self-repair. Classic script: the file-repair option needs no app/SDK. */
(function (w, d, nav) {
    'use strict';
    if (w.staffSelfRepair) return;
    var JOURNAL = 'takodeal_staff_self_repair_v1', HISTORY = 'takodeal_staff_previous_device_v1';
    var ACCOUNT = ['takodeal_staff_id', 'takodeal_staff_name', 'takodeal_staff_pic', 'takodeal_staff_session_id'];
    var PHASES = ['activation-pending', 'activated', 'handoff-pending', 'complete'];
    var FIELDS = ['schemaVersion', 'phase', 'primaryUid', 'privateUid', 'staffId', 'deviceId', 'candidateUid', 'candidateDeviceId', 'operationId', 'createdAt'];
    var sdk = null, flight = null, panel = null, text = null, codeInput = null, consent = null, resetButton = null;
    var storage = null; try { storage = w.localStorage; } catch (_) { /* File-repair UI remains independent of browser account storage. */ }
    function exact(value, fields) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.slice().sort().join(','); }
    function id(value) { return typeof value === 'string' && /^[-A-Za-z0-9_]{1,128}$/.test(value); }
    function device(value) { return typeof value === 'string' && /^DEV-[A-Z0-9-]{6,50}$/.test(value); }
    function readJournal() {
        if (!storage) throw Error('Saved phone data is unavailable. Refresh app files; sign-in reset is held.');
        var raw = storage.getItem(JOURNAL); if (raw === null) return null;
        var row; try { row = JSON.parse(raw); } catch (_) { throw Error('The previous reset reference needs review. Keep this phone’s data and use Refresh app files.'); }
        if (!exact(row, FIELDS) || row.schemaVersion !== 1 || PHASES.indexOf(row.phase) === -1 || !id(row.primaryUid) || !(row.privateUid === null || id(row.privateUid)) || !id(row.staffId) || !device(row.deviceId) || !id(row.candidateUid) || !device(row.candidateDeviceId) || !id(row.operationId) || row.primaryUid === row.candidateUid || row.deviceId === row.candidateDeviceId || !Number.isSafeInteger(row.createdAt) || row.createdAt < 1) throw Error('The previous reset reference could not be confirmed. Keep this phone’s data and ask the Owner for help.');
        return row;
    }
    function save(row) {
        storage.setItem(JOURNAL, JSON.stringify(row));
        if (storage.getItem(JOURNAL) !== JSON.stringify(row)) throw Error('This browser could not save the reset reference. Your current sign-in has been kept.');
        notify(); return row;
    }
    function notify() { if (typeof w.CustomEvent === 'function' && w.dispatchEvent) w.dispatchEvent(new w.CustomEvent('takodeal-staff-repair-state')); }
    function requiresCode() {
        try { var row = readJournal(); return !!row && ['activated', 'handoff-pending'].indexOf(row.phase) !== -1; }
        catch (_) { return true; }
    }
    function nodes(selector) { return d.querySelectorAll ? Array.from(d.querySelectorAll(selector)) : []; }
    function visible(node) {
        for (var currentNode = node; currentNode && currentNode !== d; currentNode = currentNode.parentElement) {
            if (currentNode.hidden || currentNode.style && currentNode.style.display === 'none') return false;
            if (typeof w.getComputedStyle === 'function') { var style = w.getComputedStyle(currentNode); if (style.display === 'none' || style.visibility === 'hidden') return false; }
        }
        return true;
    }
    function blockReason(options) {
        if (w.staffPunchBusy) return 'Attendance is saving. Wait for a confirmed result before repairing or resetting.';
        if (w.staffSwapWritePending || w.pendingSwapData && w.pendingSwapData.sendUnconfirmed) return 'A swap send is pending or unconfirmed. Check its result with your co-worker or Owner. Its reference must be kept.';
        if (w.staffSwapSubmitting || w.staffSwapWorkflow && w.staffSwapWorkflow.phase === 'checking') return 'A swap check is running. Finish or cancel the check first.';
        if (w.pendingSwapData) return 'A swap draft is open. Send it or cancel the draft first.';
        if (w.staffDeviceRegistrationBusy) return 'Phone setup is sending. Wait for a confirmed result first.';
        var draft = w.staffLateProofDraft;
        if (draft && (draft.file || typeof draft.reason === 'string' && draft.reason.trim())) return 'Your unsent Time In reason or screenshot is kept. Finish or cancel that action first.';
        if (nodes('input[type="file"]').some(function (input) { return input.files && input.files.length; })) return 'An unsent file is selected. Finish its upload or remove that selection first.';
        if (nodes('textarea, [data-staff-unsent]').some(function (input) { return !insidePanel(input) && visible(input) && !input.disabled && !input.readOnly && typeof input.value === 'string' && input.value.trim(); })) return 'An unsent form is still on this page. Finish it or cancel the form first.';
        if (d.getElementById && ['reqAmount', 'reqMealReceiptCode', 'reqStart', 'reqEnd'].some(function (key) { var input = d.getElementById(key); return input && visible(input) && typeof input.value === 'string' && input.value.trim(); })) return 'An unsent request is still open. Finish it or cancel the form first.';
        // File refresh retains every stored operation and identity. Those
        // references prohibit identity replacement, not data-preserving repair.
        if (options && options.filesOnly === true) return '';
        try {
            if (storage.getItem('takodeal_staff_registration_draft') !== null || storage.getItem('takodeal_staff_setup_draft_v1') !== null) return 'An earlier phone setup reference is kept. Finish or recover that exact setup before resetting.';
            for (var at = 0; at < storage.length; at++) {
                var key = storage.key(at);
                if (key && (/^takodeal_staff_session_pending_v1:/.test(key) || /^takodeal_sop_draft_/.test(key) || /^takodeal_(?:staff_)?(?:outbox|pending_operation|operation_journal)/.test(key))) return 'Saved or unconfirmed work is still on this phone. Confirm it before resetting; its data has not been removed.';
            }
        } catch (_) { return 'Saved work could not be checked safely. Use Refresh app files; do not clear browser data.'; }
        return '';
    }
    function insidePanel(node) { while (node) { if (node === panel) return true; node = node.parentElement; } return false; }
    function message(value) { if (text) text.textContent = value; return value; }
    function needSDK() {
        if (!sdk) throw Error('The Staff app must finish opening before sign-in can be reset safely. Use Refresh app files first. Your current sign-in is kept.');
        return sdk;
    }
    function capture() {
        var row = needSDK().capture();
        if (!exact(row, ['primaryUid', 'privateUid', 'staffId', 'deviceId']) || !id(row.primaryUid) || !(row.privateUid === null || id(row.privateUid)) || !id(row.staffId) || !device(row.deviceId)) throw Error('Your current Staff phone and account could not be confirmed. Refresh app files first.');
        return row;
    }
    function sameContext(row) {
        var current = capture(), handed = row.phase === 'handoff-pending' || row.phase === 'complete';
        if (current.privateUid !== row.privateUid || current.primaryUid !== row.primaryUid && !(handed && current.primaryUid === row.candidateUid) || current.staffId !== row.staffId || current.deviceId !== row.deviceId && !(handed && current.deviceId === row.candidateDeviceId)) throw Error('The Staff account or phone changed. Keep the saved reset reference and reopen it under the original account.');
    }
    function current(row, operation) {
        if (flight !== operation || operation.cancelled) throw Error('This reset check ended. Reopen the saved reset reference.');
        var saved = readJournal();
        if (!saved || JSON.stringify(saved) !== JSON.stringify(row)) throw Error('Another Staff window changed the reset reference. Close other Staff windows and resume this exact reset.');
        sameContext(row);
        var blocked = blockReason(); if (blocked) throw Error(blocked);
        if (nav.onLine === false) throw Error('Reconnect before continuing. The original sign-in and reset reference are kept.');
    }
    function deadline(work, ms, operation, label) {
        return new Promise(function (resolve, reject) {
            var timer = w.setTimeout(function () { operation.cancelled = true; reject(Error(label)); }, ms);
            operation.timers.push(timer);
            Promise.resolve(work).then(function (value) { w.clearTimeout(timer); resolve(value); }, function (error) { w.clearTimeout(timer); reject(error); });
        });
    }
    async function awaitStep(method, input, operation) {
        var work = Promise.resolve().then(function () {
            if (operation.cancelled || flight !== operation) throw Error('The reset check ended. Resume its saved reference.');
            return needSDK()[method](input);
        });
        if (method === 'handoffPrimary') {
            // SDK account adoption has no abort API. Keep the physical promise
            // single-flight until its real terminal result, including after a
            // slow-operation notice; a UI timeout cannot make it safe to retry.
            var notice = w.setTimeout(function () { message('The phone sign-in switch is still finishing. Keep this screen open. Its exact reset reference is saved; do not start another reset.'); }, 15000);
            operation.timers.push(notice);
            return work.finally(function () { w.clearTimeout(notice); });
        }
        return deadline(work, method === 'activateCandidate' ? 25000 : 15000, operation, 'This check took too long. The saved reset reference is kept. Resume the same reset; do not start another phone setup.');
    }
    function verified(value, row) { return exact(value, ['active', 'uid', 'deviceId', 'staffId']) && value.active === true && value.uid === row.candidateUid && value.deviceId === row.candidateDeviceId && value.staffId === row.staffId; }
    function localHandoff(row) {
        // This is a recoverable account-selection handoff, never an Auth/DB wipe.
        storage.setItem(HISTORY, JSON.stringify({schemaVersion: 1, uid: row.primaryUid, deviceId: row.deviceId, replacedAt: Date.now()}));
        storage.setItem('takodeal_device_id', row.candidateDeviceId);
        ACCOUNT.forEach(function (key) { storage.removeItem(key); });
        if (storage.getItem('takodeal_device_id') !== row.candidateDeviceId || ACCOUNT.some(function (key) { return storage.getItem(key) !== null; })) throw Error('The new sign-in selection was not saved completely. Keep the reset reference and resume it.');
    }
    async function perform(code, confirmed, resumeOnly) {
        if (flight) return false;
        var operation = {cancelled: false, timers: []}, row, original;
        try {
            var blocked = blockReason(); if (blocked) throw Error(blocked);
            needSDK();
            if (nav.onLine === false) throw Error('Connect to the internet before using a personal setup code.');
            row = readJournal();
            if (row && row.phase === 'complete') {
                var completed = capture();
                if (completed.primaryUid !== row.candidateUid || completed.privateUid !== row.privateUid || completed.staffId !== row.staffId || completed.deviceId !== row.candidateDeviceId) throw Error('The completed reset belongs to another phone account. Ask the Owner to check it; no saved data was removed.');
                if (resumeOnly) { message('The confirmed phone activation is saved. Continue with your usual Staff login PIN.'); return true; }
                row = null;
            }
            if (!resumeOnly && (confirmed !== true || typeof code !== 'string' || !/^\d{10}$/.test(code.replace(/[ -]/g, '')))) throw Error('Confirm the reset information and enter your current 10-digit Owner-issued personal setup code. Your daily PIN is different.');
            original = capture(); flight = operation; if (resetButton) resetButton.disabled = true;
            if (!row) {
                if (resumeOnly) throw Error('There is no unfinished reset on this phone.');
                var guard = function () {
                    var value = capture();
                    if (operation.cancelled || flight !== operation || ['primaryUid', 'privateUid', 'staffId', 'deviceId'].some(function (key) { return value[key] !== original[key]; })) throw Error('Your Staff phone changed. Reopen reset from the original account.');
                    var reason = blockReason(); if (reason) throw Error(reason);
                };
                guard();
                await awaitStep('drainPendingWrites', {assertCurrent: guard}, operation); guard();
                if (await awaitStep('assertSingleWindow', {assertCurrent: guard}, operation) !== true) throw Error('Close every other Staff window before resetting sign-in.'); guard();
                var candidate = await awaitStep('createCandidate', {staffId: original.staffId, assertCurrent: guard}, operation); guard();
                if (!exact(candidate, ['uid', 'deviceId', 'operationId']) || !id(candidate.uid) || !device(candidate.deviceId) || !id(candidate.operationId) || candidate.uid === original.primaryUid || candidate.deviceId === original.deviceId) throw Error('The replacement phone identity could not be prepared. Your current sign-in is kept.');
                row = save({schemaVersion: 1, phase: 'activation-pending', primaryUid: original.primaryUid, privateUid: original.privateUid, staffId: original.staffId, deviceId: original.deviceId, candidateUid: candidate.uid, candidateDeviceId: candidate.deviceId, operationId: candidate.operationId, createdAt: Date.now()});
            }
            var check = function () { current(row, operation); };
            check(); message('Checking the saved personal-code activation. Your existing sign-in is still kept.');
            var result = await awaitStep('verifyCandidate', {journal: Object.assign({}, row), assertCurrent: check}, operation); check();
            if (!verified(result, row)) {
                if (row.phase !== 'activation-pending') throw Error('The confirmed replacement could not be verified. Keep the saved reset reference and ask the Owner for help.');
                if (resumeOnly) throw Error('Activation is not confirmed yet. Enter the same personal code to retry this exact reset. Your original sign-in is kept.');
                if (!exact(result, ['active', 'uid', 'deviceId', 'staffId']) || result.active !== false || result.uid !== row.candidateUid || result.deviceId !== row.candidateDeviceId || result.staffId !== row.staffId) throw Error('The replacement status could not be confirmed safely. Keep the same reset reference.');
                message('Confirming your personal code. An incorrect or disabled code does not erase your existing sign-in.');
                result = await awaitStep('activateCandidate', {journal: Object.assign({}, row), code: code.replace(/[ -]/g, ''), assertCurrent: check}, operation); check();
                if (!verified(result, row)) throw Error('Activation was not confirmed. Your existing sign-in is kept; resume this same reset.');
                result = await awaitStep('verifyCandidate', {journal: Object.assign({}, row), assertCurrent: check}, operation); check();
                if (!verified(result, row)) throw Error('HQ has not confirmed the replacement as Active. Your old sign-in is kept.');
            }
            if (row.phase === 'activation-pending') row = save(Object.assign({}, row, {phase: 'activated'}));
            check(); message('The code is confirmed. Checking saved work before safely switching this phone.');
            await awaitStep('drainPendingWrites', {assertCurrent: check}, operation); check();
            if (await awaitStep('assertSingleWindow', {assertCurrent: check}, operation) !== true) throw Error('Close every other Staff window before finishing this reset.'); check();
            if (row.phase !== 'handoff-pending') row = save(Object.assign({}, row, {phase: 'handoff-pending'}));
            check();
            await awaitStep('handoffPrimary', {journal: Object.assign({}, row), assertCurrent: check}, operation); check();
            if (capture().primaryUid !== row.candidateUid) throw Error('The new phone sign-in was not confirmed. Keep this reference and resume reset.');
            localHandoff(row);
            // After this point the adapter must capture selected staff from the
            // durable reset reference while the normal login selection is blank.
            row = save(Object.assign({}, row, {phase: 'complete'}));
            message('Staff sign-in was reset after the personal code was confirmed. Your private-document approval and saved work are kept. Continue with your usual Staff login PIN.');
            notify(); return true;
        } catch (error) { message(error && error.message || 'The reset was not confirmed. Keep this phone’s saved data and use Refresh app files.'); return false; }
        finally {
            code = ''; if (codeInput) codeInput.value = '';
            operation.cancelled = true; operation.timers.forEach(function (timer) { w.clearTimeout(timer); });
            if (flight === operation) flight = null; if (resetButton) resetButton.disabled = false;
        }
    }
    async function refreshFiles() {
        if (flight) { message('Finish or resume the current personal-code check first.'); return false; }
        var reason = blockReason({filesOnly: true}); if (reason) { message(reason); return false; }
        var updater = w[Symbol.for('takodeal.staff.appUpdate')];
        if (typeof updater !== 'function') { message('App-file repair is not available yet. Reopen the official Staff link online. No sign-in data was removed.'); return false; }
        message('Refreshing app files keeps phone approvals, sign-in and saved data.');
        try { return await updater(); } catch (_) { message('The app files could not be confirmed. Reconnect and try again; your saved data is kept.'); return false; }
    }
    function append(tag, value, parent) { var node = d.createElement(tag); if (value) node.textContent = value; (parent || panel).appendChild(node); return node; }
    function open() {
        if (!panel && d.body) {
            panel = d.createElement('section'); panel.id = 'staffSelfRepair'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Repair Staff app');
            panel.style.cssText = 'position:fixed;inset:12px;max-width:560px;max-height:90vh;overflow:auto;margin:auto;padding:20px;border:2px solid #174e3c;border-radius:16px;background:#fff;color:#193a30;z-index:1000010;box-shadow:0 8px 48px #0005;font:16px/1.5 system-ui,sans-serif';
            append('h2', 'Repair Staff app');
            append('p', 'Refresh app files keeps this phone’s sign-in, approvals and saved work. The app cannot uninstall itself. This is not a full privacy wipe.');
            var refresh = append('button', 'Refresh app files'); refresh.type = 'button'; refresh.addEventListener('click', refreshFiles);
            append('h3', 'Reset Staff sign-in with a personal code');
            append('p', 'For this same staff account only. Have your current Owner-issued personal setup code ready. If the code or phone-slot limit fails, your current sign-in stays here. The Owner may need to free an old phone slot; this action does not revoke it.');
            codeInput = append('input'); codeInput.type = 'password'; codeInput.inputMode = 'numeric'; codeInput.autocomplete = 'off'; codeInput.maxLength = 14; codeInput.setAttribute('aria-label', 'Personal setup code');
            var label = append('label'); consent = d.createElement('input'); consent.type = 'checkbox'; label.appendChild(consent); label.appendChild(d.createTextNode(' I understand: confirm my personal setup code first, then use my usual Staff login PIN. My private-document approval is kept.'));
            resetButton = append('button', 'Confirm code and reset Staff sign-in'); resetButton.type = 'button'; resetButton.addEventListener('click', function () { void perform(codeInput.value, consent.checked, false); });
            var resume = append('button', 'Check saved reset'); resume.type = 'button'; resume.addEventListener('click', function () { void perform('', false, true); });
            text = append('p', 'Choose Refresh app files if the Staff app has not finished opening.'); text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
            var close = append('button', 'Back to Staff app'); close.type = 'button'; close.addEventListener('click', function () { if (flight) return message('Wait for this check to finish. Its saved reference is kept.'); codeInput.value = ''; panel.hidden = true; });
            d.body.appendChild(panel);
        }
        if (panel) panel.hidden = false;
        return panel;
    }
    function configureSDK(adapter) {
        var names = ['capture', 'createCandidate', 'activateCandidate', 'verifyCandidate', 'drainPendingWrites', 'assertSingleWindow', 'handoffPrimary'];
        if (!adapter || names.some(function (name) { return typeof adapter[name] !== 'function'; })) throw Error('Staff reset support is incomplete.');
        if (flight) throw Error('Wait for the current reset check to finish.');
        sdk = adapter; notify(); return api;
    }
    var api = {open: open, refreshFiles: refreshFiles, startReset: function (input) { return perform(input && input.code, input && input.confirmed, false); }, resumeReset: function () { return perform('', false, true); }, blockReason: function (options) { return flight ? 'A personal-code reset is still finishing. Keep this screen open and its saved reference intact.' : blockReason(options); }, requiresCode: requiresCode, configureSDK: configureSDK};
    w.staffSelfRepair = Object.freeze(api);
    d.addEventListener('click', function (event) { var target = event.target; while (target && target !== d) { if (target.getAttribute && target.hasAttribute('data-staff-self-repair')) { event.preventDefault(); open(); return; } target = target.parentElement; } });
    w.addEventListener('storage', function (event) { if (event.key === JOURNAL) notify(); });
}(window, document, navigator));
