import { SALE_VERSION, saleIdentity, safeId, createOutbox, createSaleEngine } from './pos-safety.js';

export function installSaleSafety(api, environment = globalThis) {
    const w = environment.window || environment;
    const ls = environment.localStorage;
    const outbox = createOutbox(environment.indexedDB || null);
    const engine = createSaleEngine(api);
    const owner = saleIdentity({}, environment.crypto);
    w.saleOutbox = outbox;
    w.isSyncing = false;
    w.isProcessingOrder = false;
    w.offlineQueue = [];
    w.isAuditModeActive = ls.getItem('takodeal_audit_mode') === 'true';
    const legacyAuditBranch = ls.getItem('takodeal_device_branch');
    let watchedAuditBranch, stopAuditWatch;
    const localAuditMode = branch => {
        const saved = ls.getItem('takodeal_audit_mode:' + safeId(branch));
        return saved === 'true' || (saved === null && branch === legacyAuditBranch && ls.getItem('takodeal_audit_mode') === 'true');
    };
    function watchAuditBranch() {
        const branch = ls.getItem('takodeal_device_branch');
        if (!branch || branch === watchedAuditBranch) return;
        stopAuditWatch?.(); watchedAuditBranch = branch;
        w.isAuditModeActive = localAuditMode(branch);
        if (api.onSnapshot) stopAuditWatch = api.onSnapshot(api.doc(api.db, 'settings', 'audit_' + safeId(branch)), snapshot => {
            if (!snapshot.exists() || branch !== ls.getItem('takodeal_device_branch')) return;
            w.isAuditModeActive = snapshot.data().active === true;
            try {
                ls.setItem('takodeal_audit_mode:' + safeId(branch), String(w.isAuditModeActive));
                ls.setItem('takodeal_audit_mode', String(w.isAuditModeActive));
                updateAuditButton();
            } catch (error) { console.warn('Could not cache audit status:', error); }
        }, error => console.warn('Audit status is awaiting connection:', error));
    }

    function legacySales() {
        // The previous engine allowed partial commits. Preserve this source
        // unchanged: replaying even a receipt with no sale document is unsafe.
        try {
            const queue = JSON.parse(ls.getItem('takodeal_offline_queue') || '[]');
            if (!Array.isArray(queue)) throw new Error('Invalid legacy queue.');
            return queue.map(p => ({ ...p, needsReconciliation: true }));
        } catch (error) {
            console.error('Legacy sale queue needs reconciliation:', error);
            return [{ needsReconciliation: true, receiptId: 'Unreadable legacy queue' }];
        }
    }
    function hasLegacyAudit() {
        const value = ls.getItem('takodeal_audit_queue');
        return value && value !== '{}' && value !== 'null';
    }
    async function refreshQueue() {
        w.offlineQueue = [...(await outbox.list()).map(row => row.payload), ...legacySales()];
        return w.offlineQueue;
    }
    function updateBadge(error) {
        const badge = environment.document.getElementById('liveClock')?.nextElementSibling;
        if (!badge) return;
        if (w.offlineQueue.length) {
            const review = w.offlineQueue.filter(p => p.needsReconciliation).length;
            badge.innerHTML = `<span style="background:#eab308;color:white;padding:2px 8px;border-radius:12px;font-weight:bold;font-size:10px;">⏳ SAVED LOCALLY (${w.offlineQueue.length})${review ? ' · REVIEW REQUIRED (' + review + ')' : ''}</span>`;
            badge.title = error?.message || (review ? 'Older sales need inventory reconciliation before replay.' : 'Waiting for safe database synchronization.');
        } else if (typeof w.updateNetworkStatusUI === 'function') w.updateNetworkStatusUI();
    }
    w.processCheckout = async function(payload) {
        if (w.isProcessingOrder) return { status: 'failed', error: 'Checkout is already processing.' };
        w.isProcessingOrder = true;
        let saved;
        try {
            watchAuditBranch();
            if (!payload.branch || !Array.isArray(payload.cart) || !payload.cart.length || !Number.isFinite(Number(payload.netTotal)) || Number(payload.netTotal) < 0) {
                throw new Error('Invalid order. The cart has not been saved.');
            }
            payload.cashier = w.sessionUser?.cashierName || ls.getItem('cashierName') || 'Unknown';
            const split = environment.document.getElementById('splitPaymentContainer');
            if (split && split.style.display !== 'none') {
                const m1 = environment.document.getElementById('splitMethod1').value;
                const m2 = environment.document.getElementById('splitMethod2').value;
                const a1 = Number(environment.document.getElementById('splitAmount1').value) || 0;
                const a2 = Number(environment.document.getElementById('splitAmount2').value) || 0;
                if (a1 < 0 || a2 < 0 || Math.abs(a1 + a2 - payload.netTotal) > 0.01) throw new Error('Split payments must match the order total.');
                payload.paymentMethod = `Split (${m1} & ${m2})`;
                payload.splitDetails = [{ method: m1, amount: a1 }, { method: m2, amount: a2 }];
            }
            payload.paymentVerified = String(payload.paymentMethod || 'Cash').toLowerCase() === 'cash';
            if (!payload.saleId) {
                payload.saleId = saleIdentity(payload, environment.crypto);
                const d = new Date();
                const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
                const counter = (Number(ls.getItem('takodeal_offline_rcpt_count')) || 0) + 1;
                ls.setItem('takodeal_offline_rcpt_count', String(counter));
                payload.receiptId = payload.mobileOrderCode || `${date}-${String(counter).padStart(4, '0')}-${payload.saleId.slice(-8).toUpperCase()}`;
                payload.localTimestamp = d.toISOString();
                payload.saleVersion = SALE_VERSION;
                payload.auditDeferred = payload.branch === watchedAuditBranch ? w.isAuditModeActive : localAuditMode(payload.branch);
                const bom = w.masterPOSData?.bom;
                payload.recipeSnapshot = Array.isArray(bom) && bom.length ? bom.map(r => ({ menuItem: r.menuItem, ingredientName: r.ingredientName, qty: r.qty })) : null;
            }
            // JSON clone also catches unserializable input before local commit.
            saved = await outbox.enqueue(JSON.parse(JSON.stringify(payload)));
        } catch (error) {
            console.error('Checkout was not saved:', error);
            return { status: 'failed', error: error.message };
        } finally {
            w.isProcessingOrder = false;
        }
        // Once locally committed, optional UI/background work cannot turn a
        // safely queued sale into a failure and invite a second checkout.
        try {
            const split = environment.document.getElementById('splitPaymentContainer');
            if (split) split.style.display = 'none';
            await refreshQueue();
            updateBadge();
        } catch (error) { console.warn('Sale is saved; queue display could not refresh:', error); }
        w.syncOfflineQueue().catch(error => console.warn('Sale is saved; sync will retry:', error));
        return { status: 'queued', receiptId: saved.receiptId, saleId: saved.saleId, payload: saved };
    };

    w.syncOfflineQueue = async function() {
        watchAuditBranch();
        if (w.isSyncing || environment.navigator?.onLine === false) return;
        w.isSyncing = true;
        let syncError;
        const sync = async () => {
            const rows = await outbox.list();
            for (const row of rows) {
                const payload = await outbox.claim(row.saleId, owner);
                if (!payload) continue;
                try {
                    if (!await engine.alreadyCommitted(payload)) {
                        let bom = payload.recipeSnapshot;
                        if (!bom && !payload.inventoryMovements) {
                            const snap = await api.getDocsFromServer(api.collection(api.db, 'bom'));
                            bom = snap.docs.map(d => d.data());
                        }
                        const prepared = await engine.prepare(payload, bom);
                        await outbox.saveClaim(prepared, owner);
                        await engine.commit(prepared);
                    }
                    // Deletes only this ID. Concurrent new checkouts survive.
                    await outbox.acknowledge(payload.saleId);
                } catch (error) {
                    syncError = error;
                    console.warn('Sale safely queued; synchronization pending:', payload.receiptId, error);
                } finally { await outbox.release(payload.saleId, owner); }
            }
            await engine.resumeAvailableAudits(localAuditMode);
        };
        try {
            if (environment.navigator?.locks) await environment.navigator.locks.request('takodeal-sale-sync-v2', { ifAvailable: true }, lock => lock ? sync() : undefined);
            else await sync(); // IndexedDB claims still serialize each sale.
        } catch (error) {
            syncError = error;
            console.warn('Safe synchronization paused:', error);
        } finally {
            w.isSyncing = false;
            try { await refreshQueue(); updateBadge(syncError); } catch (error) { console.error('Outbox unavailable:', error); }
        }
    };
    w.voidTransaction = (receiptId, cashier, branch) => engine.voidSale(receiptId, cashier, branch);
    w.discardParkedOrder = (id, cashier, branch, shiftId) => engine.discardParked(id, cashier, branch, shiftId);
    w.processAuditQueue = async function() {
        try {
            if (environment.navigator?.onLine === false) throw new Error('Resume requires a connection. Deductions remain safely pending.');
            await w.syncOfflineQueue();
            const result = await engine.resumeAudit(ls.getItem('takodeal_device_branch'));
            if (result.paused) throw new Error('Inventory is still paused for this branch. Another device may have restarted the audit.');
            if (hasLegacyAudit()) {
                w.Swal.fire('Inventory review required', 'The older audit queue has been preserved. Its previous deductions must be reconciled before applying it. New sale deductions resume safely.', 'warning');
            } else {
                w.Swal.fire({ title: 'Live deductions resumed', text: 'Saved deductions are applied once. Any sales still awaiting synchronization remain saved locally.', icon: 'success' });
            }
        } catch (error) { w.Swal.fire('Deductions pending', error.message, 'error'); }
    };
    w.toggleAuditMode = async function() {
        if (w.isTogglingAudit) return;
        w.isTogglingAudit = true;
        const dropdown = environment.document.getElementById('posSettingsDropdown');
        if (dropdown) dropdown.style.display = 'none';
        try {
            const branch = ls.getItem('takodeal_device_branch');
            if (!branch) throw new Error('Select a branch first.');
            const active = !w.isAuditModeActive;
            await engine.setAuditMode(branch, active, ls.getItem('cashierName') || 'Staff');
            w.isAuditModeActive = active;
            updateAuditButton();
            try {
                ls.setItem('takodeal_audit_mode:' + safeId(branch), String(active));
                ls.setItem('takodeal_audit_mode', String(active));
            } catch (error) { console.warn('Audit mode changed; local status cache unavailable:', error); }
            if (active) w.Swal.fire({ title: '⏸️ Inventory Paused', text: 'Customer orders continue. Their deductions are recorded by sale for safe resumption.', icon: 'info' });
            else await w.processAuditQueue();
        } catch (error) { w.Swal.fire('Audit mode unchanged', error.message, 'error'); }
        finally { w.isTogglingAudit = false; }
    };
    function updateAuditButton() {
        const btn = environment.document.getElementById('btnAuditModeToggle');
        if (btn) {
            btn.innerHTML = w.isAuditModeActive ? '▶️ Resume Live Deductions' : '⏸️ Pause Inventory (Audit Mode)';
            btn.style.background = w.isAuditModeActive ? '#f59e0b' : '#334155';
        }
    }
    w.addEventListener('storage', event => {
        if (event.key === 'takodeal_audit_mode') {
            w.isAuditModeActive = event.newValue === 'true';
            updateAuditButton();
        }
        if (event.key === 'takodeal_device_branch') watchAuditBranch();
    });
    w.addEventListener('online', () => { w.isAppOnline = true; w.syncOfflineQueue(); });
    environment.document.addEventListener('DOMContentLoaded', updateAuditButton);
    environment.setTimeout(() => { updateAuditButton(); w.syncOfflineQueue(); }, 5000);
    environment.setInterval(() => w.syncOfflineQueue(), 15000);
    refreshQueue().then(() => updateBadge()).catch(error => console.error('Local checkout storage unavailable:', error));
    watchAuditBranch();
}
