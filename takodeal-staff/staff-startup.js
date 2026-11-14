/* Independent Staff startup recovery. No module, account or database dependency. */
(function (w, d, nav) {
    'use strict';
    var release = 'staff-phone-location-help-20261114-r1';
    var key = Symbol.for('takodeal.staff.appUpdate');
    if (w.staffStartup) return;
    var ready = false, updating = false, run = null, banner, bannerText;
    var timers = [], earlyStatus = 'Staff app is opening. Please wait; your device registration is kept.';
    var releasedStyles = [];
    function nodes(selector) { return d.querySelectorAll ? Array.from(d.querySelectorAll(selector)) : []; }
    function releasePendingStyles() {
        if (ready) return;
        nodes('link[rel~="stylesheet"]').forEach(function (link) {
            try {
                if (link.sheet !== null || link.disabled || releasedStyles.indexOf(link) !== -1) return;
                var href = link.getAttribute('href'), media = link.getAttribute('media'), value = String(media || '').trim().toLowerCase();
                if (!href || ['', 'all', 'screen'].indexOf(value) === -1) return;
                var base = new URL('./', w.location.href), url = new URL(href, w.location.href);
                if (url.origin !== base.origin || url.pathname.indexOf(base.pathname) !== 0) return;
                var marker = 'data-staff-startup-style-release';
                if (link.hasAttribute(marker)) return;
                function restore() {
                    link.removeEventListener('load', restore); link.removeEventListener('error', restore);
                    if (link.getAttribute(marker) !== release) return;
                    if (link.getAttribute('media') === 'not all') {
                        if (media === null) link.removeAttribute('media'); else link.setAttribute('media', media);
                    }
                    link.removeAttribute(marker);
                }
                link.addEventListener('load', restore); link.addEventListener('error', restore);
                releasedStyles.push(link); link.setAttribute(marker, release); link.setAttribute('media', 'not all');
            } catch (_) { /* Unknown stylesheet state stays untouched. */ }
        });
    }
    function status(text) {
        nodes('[data-staff-update-status]').forEach(function (node) { node.textContent = text; node.hidden = !text; });
    }
    function show(text) {
        releasePendingStyles();
        if (!banner && d.body) {
            banner = d.createElement('section'); banner.id = 'staffStartupRecovery';
            banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
            banner.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;max-width:560px;margin:auto;padding:16px;border:2px solid #c65c24;border-radius:14px;background:#fffaf4;color:#243b36;z-index:1000001;box-shadow:0 4px 24px #0003;font:15px/1.5 system-ui,sans-serif';
            var heading = d.createElement('strong'); heading.textContent = 'Staff app connection';
            bannerText = d.createElement('p'); bannerText.style.margin = '8px 0';
            var button = d.createElement('button'); button.type = 'button'; button.textContent = 'Repair and reopen';
            button.setAttribute('data-staff-repair', ''); button.style.cssText = 'padding:10px 16px;border:0;border-radius:8px;background:#173f35;color:white;font:600 15px system-ui,sans-serif';
            button.addEventListener('click', function () { check(); });
            banner.appendChild(heading); banner.appendChild(bannerText); banner.appendChild(button); d.body.appendChild(banner);
        }
        if (banner) { banner.hidden = false; bannerText.textContent = text; }
        status(text);
    }
    function progress() {
        var target = d.getElementById && d.getElementById('deviceRegistrationStatus');
        if (target) { target.textContent = earlyStatus; target.setAttribute('data-staff-startup-status', ''); }
        show(earlyStatus + ' If this does not finish, use Repair and reopen. No new device approval is requested by repair.');
        return false;
    }
    ['requestDeviceAccess', 'retryDeviceRegistration', 'loginStaff'].forEach(function (name) {
        if (typeof w[name] !== 'function') w[name] = progress;
    });
    d.addEventListener('click', function (event) {
        if (ready) return;
        var target = event.target;
        while (target && target !== d && String(target.tagName || '').toLowerCase() !== 'button') target = target.parentElement;
        if (!target || target === d) return;
        var ids = ['usePersonalSetupCode', 'usePersonalSetupCodePending', 'usePersonalSetupCodeLogin', 'cancelPersonalSetup', 'setupStaffReload', 'deviceRetryButton'];
        var action = target.getAttribute && target.getAttribute('onclick') || '';
        if (ids.indexOf(target.id) !== -1 || /window\.(?:requestDeviceAccess|retryDeviceRegistration|loginStaff)\(/.test(action)) {
            event.preventDefault(); event.stopImmediatePropagation(); progress();
        }
    }, true);
    function protectedWork() {
        if (w.staffSelfRepair && typeof w.staffSelfRepair.blockReason === 'function') { var repairBlock = w.staffSelfRepair.blockReason({filesOnly: true}); if (repairBlock) return repairBlock; }
        if (w.staffPunchBusy) return 'Attendance is saving. Wait for it to finish before repairing the app.';
        if (w.staffSwapWritePending || w.pendingSwapData && w.pendingSwapData.sendUnconfirmed) return 'Your swap request is sending or its result is not confirmed. Check its result with your co-worker or Owner before repairing the app.';
        if (w.staffDeviceRegistrationBusy) return 'Your device request is sending. Wait for its result before repairing the app.';
        var draft = w.staffLateProofDraft;
        if (draft && (draft.file || typeof draft.reason === 'string' && draft.reason.trim())) return 'Your unsent Time In reason and screenshot are kept. Finish or cancel that Time In before repairing the app.';
        var reason = d.getElementById && d.getElementById('lateReason');
        if (reason && typeof reason.value === 'string' && reason.value.trim()) return 'Your unsent Time In reason is kept. Finish or cancel that Time In before repairing the app.';
        if (nodes('input[type="file"]').some(function (input) { return input.files && input.files.length; })) return 'A selected file is still on this page. Finish its upload or remove the selection before repairing the app.';
        return '';
    }
    if (nav.serviceWorker && nav.serviceWorker.addEventListener) nav.serviceWorker.addEventListener('message', function (event) {
        if (!event.data || event.data.type !== 'TAKODEAL_STAFF_CAN_UPDATE' || !event.ports || !event.ports[0]) return;
        var safe = false; try { var base = new URL('./', w.location.href); safe = Object.keys(event.data).length === 1 && event.ports.length === 1 && event.origin === base.origin && validWorker(event.source, base) && (ready || updating && run && !run.cancelled) && !protectedWork(); } catch (_) { /* Unknown work must hold activation. */ }
        event.ports[0].postMessage({safe: safe});
    });
    function current(operation) {
        if (run !== operation || operation.cancelled) throw Error('The repair check ended. Keep this page open and try again.');
    }
    function deadline(promise, ms, text, operation) {
        return new Promise(function (resolve, reject) {
            var timer = w.setTimeout(function () { reject(Error(text)); }, ms);
            operation.cleanup.push(function () { w.clearTimeout(timer); });
            Promise.resolve(promise).then(function (value) { w.clearTimeout(timer); resolve(value); }, function (error) { w.clearTimeout(timer); reject(error); });
        });
    }
    function waitState(worker, states, operation) {
        return new Promise(function (resolve, reject) {
            function changed() {
                if (worker.state === 'redundant') { remove(); reject(Error('The app update did not finish. Keep this page open and retry.')); }
                else if (states.indexOf(worker.state) !== -1) { remove(); resolve(worker); }
            }
            function remove() { worker.removeEventListener('statechange', changed); }
            worker.addEventListener('statechange', changed); operation.cleanup.push(remove); changed();
        });
    }
    function message(worker, type, operation, expected) {
        if (typeof w.MessageChannel !== 'function') return Promise.reject(Error('This browser cannot safely confirm an app repair. Keep your saved data and try an updated browser.'));
        return deadline(new Promise(function (resolve, reject) {
            var channel = new w.MessageChannel(), finished = false;
            function close() { if (finished) return; finished = true; channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); }
            operation.cleanup.push(close);
            channel.port1.onmessage = function (event) { if (finished) return; var value = event.data; close(); resolve(value); };
            try { worker.postMessage(expected ? {type: type, release: expected.release, cohortHash: expected.cohortHash} : {type: type}, [channel.port2]); } catch (error) { close(); reject(error); }
        }), 4000, 'The app update could not be confirmed. Close other Staff windows, check your connection and retry.', operation);
    }
    function validWorker(worker, base) {
        if (!worker || typeof worker.scriptURL !== 'string') return false;
        var url = new URL(worker.scriptURL, base);
        return url.origin === base.origin && url.pathname === new URL('sw.js', base).pathname && !url.search && !url.hash;
    }
    function validCohort(state) {
        return state && Object.keys(state).sort().join(',') === 'cohortHash,release' && typeof state.release === 'string' && /^[a-z][a-z0-9-]{1,119}$/.test(state.release) && typeof state.cohortHash === 'string' && /^[a-f0-9]{64}$/.test(state.cohortHash);
    }
    var watchedRegistration = null, updateNotice = false;
    function offerUpdate(registration) {
        var worker=registration && registration.waiting, base=new URL('./',w.location.href);
        if(!ready || updating || !worker || worker.state!=='installed' || !validWorker(worker,base))return;
        updateNotice=true;
        show('New Staff app files are ready. Tap Repair and reopen to use the latest branch pins and phone checks. Your sign-in and saved records are kept.');
    }
    function watchUpdates() {
        if(!ready || updating || protectedWork() || nav.onLine===false || !nav.serviceWorker || typeof nav.serviceWorker.getRegistration!=='function')return;
        Promise.resolve(nav.serviceWorker.getRegistration(new URL('./',w.location.href).href)).then(function(registration){
            if(!registration || new URL(registration.scope).href!==new URL('./',w.location.href).href)return;
            offerUpdate(registration);
            if(watchedRegistration===registration || typeof registration.addEventListener!=='function')return;
            watchedRegistration=registration;
            registration.addEventListener('updatefound',function(){
                var worker=registration.installing;if(!worker || !validWorker(worker,new URL('./',w.location.href)))return;
                worker.addEventListener('statechange',function(){offerUpdate(registration);});
            });
        }).catch(function(){/* A notice never changes phone access or interrupts current work. */});
    }
    w.addEventListener('focus',watchUpdates);
    d.addEventListener('visibilitychange',function(){if(!d.hidden)watchUpdates();});
    async function update(operation) {
        var base = new URL('./', w.location.href), registration = await deadline(nav.serviceWorker.getRegistration(base.href), 15000, 'Finding the app update took too long. Check your connection and retry.', operation);
        current(operation);
        var fresh = false;
        if (!registration) { if (typeof nav.serviceWorker.register !== 'function') throw Error('This browser cannot prepare an app repair. Keep your saved data and reconnect.'); registration = await deadline(nav.serviceWorker.register(new URL('sw.js', base).href, {scope: base.href, updateViaCache: 'none'}), 15000, 'Preparing the app update took too long. Reconnect and retry.', operation); fresh = true; }
        current(operation);
        if (!registration || new URL(registration.scope).href !== base.href) throw Error('The Staff app update scope could not be confirmed. Keep this page open and retry.');
        if (!fresh) await deadline(registration.update(), 120000, 'Downloading the Staff app took too long. Check your connection and retry.', operation);
        current(operation);
        var worker = registration.installing || registration.waiting, incoming = null;
        if (worker) {
            if (!validWorker(worker, base)) throw Error('The Staff update identity could not be confirmed.');
            await deadline(waitState(worker, ['installed', 'activated'], operation), 120000, 'Installing the Staff app took too long. Keep this page open and retry.', operation);
            current(operation);
            if (worker.state !== 'activated') {
                incoming = await message(worker, 'TAKODEAL_STAFF_STATUS', operation); current(operation);
                if (!validCohort(incoming)) throw Error('The incoming Staff app files could not be confirmed. Keep your saved data and retry.');
                var blocked = protectedWork(); if (blocked) throw Error(blocked);
                var approval = await message(worker, 'TAKODEAL_STAFF_ACTIVATE', operation, incoming); current(operation);
                if (!approval || approval.ok !== true) throw Error('Finish attendance and uploads, then close other Staff windows before repairing this one. No saved data was removed.');
                await deadline(waitState(worker, ['activated'], operation), 15000, 'The new Staff app has not activated yet. Close other Staff windows and retry.', operation);
                current(operation);
            }
        } else worker = registration.active;
        if (!validWorker(worker, base) || worker.state !== 'activated') throw Error('No active Staff update could be confirmed. Keep this page open and retry.');
        var state = await message(worker, 'TAKODEAL_STAFF_STATUS', operation); current(operation);
        if (!validCohort(state) || incoming && (state.release !== incoming.release || state.cohortHash !== incoming.cohortHash)) throw Error('The latest Staff app files could not be confirmed. Check your connection and retry; your device data is kept.');
        var work = protectedWork(); if (work) throw Error(work);
        if (nav.onLine === false) throw Error('The connection was lost. Reconnect and try the repair again.');
        status('Reopening the Staff app. Your device registration and saved data stay here.');
        w.location.reload(); return true;
    }
    async function check() {
        if (updating) return false;
        var blocked = protectedWork(); if (blocked) { show(blocked); return false; }
        if (nav.onLine === false) { show('Connect to the internet to repair the Staff app. Your saved device data is kept.'); return false; }
        if (!nav.serviceWorker || typeof nav.serviceWorker.getRegistration !== 'function') { show('This browser cannot check app updates. Reopen the Staff app online; do not clear its saved data.'); return false; }
        updating = true; var operation = {cancelled: false, cleanup: []}; run = operation;
        var buttons = nodes('[data-staff-update], [data-staff-repair]'), previous = buttons.map(function (button) { return {button: button, disabled: button.disabled, text: button.textContent}; });
        previous.forEach(function (row) { row.button.disabled = true; row.button.textContent = 'Checking app files…'; row.button.setAttribute('aria-busy', 'true'); });
        status('Checking app files. No device approval, attendance or saved data will be reset.');
        try { return await deadline(update(operation), 180000, 'The repair check took too long. Keep this page open, close other Staff windows and retry.', operation); }
        catch (error) { show(error && error.message || 'The app repair could not be confirmed. Check your connection and retry.'); return false; }
        finally { operation.cancelled = true; operation.cleanup.forEach(function (cleanup) { cleanup(); }); if (run === operation) run = null; updating = false; previous.forEach(function (row) { row.button.disabled = row.disabled; row.button.textContent = row.text; row.button.removeAttribute('aria-busy'); }); }
    }
    Object.defineProperty(w, key, {value: check, configurable: true});
    // An older optional module may assign its former update action. Keep every
    // button on this independent, data-preserving implementation on this page.
    Object.defineProperty(w, 'forceUpdateApp', {get: function () { return check; }, set: function () {}, configurable: true});
    w.staffStartup = {ready: function () { ready = true; timers.forEach(function (timer) { w.clearTimeout(timer); }); if (banner && !updateNotice) banner.hidden = true; var node = d.getElementById && d.getElementById('deviceRegistrationStatus'); if (node && node.hasAttribute('data-staff-startup-status')) { node.textContent = ''; node.removeAttribute('data-staff-startup-status'); } Promise.resolve().then(watchUpdates); }};
    timers.push(w.setTimeout(function () { if (!ready) { earlyStatus = 'The Staff app is still opening. Your phone has not been reset.'; show(earlyStatus + ' If it stays here, use Repair and reopen.'); } }, 15000));
    timers.push(w.setTimeout(function () { if (!ready) { earlyStatus = 'The Staff app could not finish opening. Your device registration and saved data are kept.'; show(earlyStatus + ' Use Repair and reopen while connected.'); } }, 30000));
    w.addEventListener('error', function (event) {
        if (ready) return;
        var target = event.target, source = target && String(target.tagName || '').toLowerCase() === 'script' ? target.src : event.filename;
        try { var url = new URL(source, w.location.href); if (!source || url.origin !== w.location.origin || !/\.js$/.test(url.pathname)) return; }
        catch (_) { return; }
        earlyStatus = 'Some Staff app files could not open. Your device registration and saved data are kept.'; show(earlyStatus + ' Use Repair and reopen while connected.');
    }, true);
}(window, document, navigator));
