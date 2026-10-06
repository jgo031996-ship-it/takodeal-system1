import { SALE_VERSION, saleIdentity, safeId, createOutbox, createSaleEngine } from './pos-safety.js';

// Sale uploads retry frequently. Inventory recovery has its own cadence and
// scope so an idle tablet does not repeatedly read other branches' receipts.
export function createAuditRecovery({recover,now=Date.now,online=()=>true,paused=()=>false,intervalMs=5*60*1000}) {
    const states=new Map();
    function run(branch,{force=false,allowPaused=false}={}) {
        if (typeof branch!=='string' || !branch.trim() || !online() || (!allowPaused && paused(branch))) return Promise.resolve({skipped:true});
        let state=states.get(branch);if(!state){state={lastAttempt:null,flight:null,after:null};states.set(branch,state);}
        if(state.flight){
            if((force&&!state.forced)||(allowPaused&&!state.allowPaused)){
                state.afterAllowPaused ||= allowPaused;
                state.after ||= state.flight.catch(()=>{}).then(()=>{const reviewPaused=state.afterAllowPaused;state.afterAllowPaused=false;state.after=null;return run(branch,{force:true,allowPaused:reviewPaused});});
                return state.after;
            }
            return state.flight;
        }
        const clock=now(),elapsed=clock-state.lastAttempt;
        if(!force && state.lastAttempt!==null && elapsed>=0 && elapsed<intervalMs) return Promise.resolve({skipped:true});
        state.lastAttempt=clock;state.forced=force;state.allowPaused=allowPaused;
        state.flight=Promise.resolve().then(()=>recover(branch)).finally(()=>{state.flight=null;state.forced=false;state.allowPaused=false;});
        return state.flight;
    }
    return {run};
}

export function mergePendingSales(transactions, queue, branch, shiftStartTime, shiftId) {
    const start = shiftStartTime?.toDate?.() || new Date(shiftStartTime);
    const result = [...transactions];
    if (!Number.isFinite(start.getTime())) return result;
    const ids = new Set(transactions.flatMap(p => [p.id, p.saleId, p.receiptId].filter(Boolean)));
    for (const sale of queue) {
        const time = new Date(sale.localTimestamp);
        if (sale.branch !== branch || !Number.isFinite(time.getTime()) || time < start ||
            (shiftId && sale.shiftId && sale.shiftId !== 'UNKNOWN' && sale.shiftId !== shiftId) ||
            [sale.saleId, sale.receiptId].some(id => id && ids.has(id))) continue;
        result.push({ ...sale, id: 'LOCAL-' + (sale.saleId || sale.receiptId), timestamp: time,
            isPendingSync: true, status: 'Pending Sync' });
        for (const id of [sale.saleId, sale.receiptId].filter(Boolean)) ids.add(id);
    }
    return result;
}

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
    const auditRecovery=createAuditRecovery({recover:branch=>engine.resumeAudit(branch),paused:localAuditMode,
        online:()=>environment.navigator?.onLine!==false,now:()=>environment.Date?.now?.() ?? Date.now()});
    function recoverInBackground(branch,options) {
        return auditRecovery.run(branch,options).catch(error=>console.warn('Inventory deductions remain pending; recovery will retry:',error));
    }
    function watchAuditBranch() {
        const branch = ls.getItem('takodeal_device_branch');
        if (!branch || branch === watchedAuditBranch) return;
        stopAuditWatch?.(); watchedAuditBranch = branch;
        w.isAuditModeActive = localAuditMode(branch);
        if (api.onSnapshot) stopAuditWatch = api.onSnapshot(api.doc(api.db, 'settings', 'audit_' + safeId(branch)), snapshot => {
            if (!snapshot.exists() || branch !== ls.getItem('takodeal_device_branch')) return;
            const wasPaused=localAuditMode(branch);
            w.isAuditModeActive = snapshot.data().active === true;
            try {
                ls.setItem('takodeal_audit_mode:' + safeId(branch), String(w.isAuditModeActive));
                ls.setItem('takodeal_audit_mode', String(w.isAuditModeActive));
                updateAuditButton();
            } catch (error) { console.warn('Could not cache audit status:', error); }
            if(wasPaused&&!w.isAuditModeActive) recoverInBackground(branch,{force:true});
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
        w.offlineQueue = [...(await outbox.list()).map(row => ({ ...row.payload, syncError: row.syncError })), ...legacySales()];
        return w.offlineQueue;
    }
    w.getPendingSales = refreshQueue;
    w.mergePendingSales = mergePendingSales;
    w.showPendingSales = async function() {
        await refreshQueue();
        const rows = w.offlineQueue;
        const result = await w.Swal?.fire({ title: rows.length ? 'Sales awaiting upload' : 'All sales uploaded',
            html: pendingSalesMarkup(rows), width: 740, showCancelButton: !!rows.length,
            confirmButtonText: rows.length ? 'Retry upload' : 'Done', cancelButtonText: 'Close',
            confirmButtonColor: '#c65c24', customClass: { popup: 'cashier-sync-dialog' } });
        if (rows.length && result?.isConfirmed) {
            await w.syncOfflineQueue();
            await refreshQueue(); updateBadge();
            await w.Swal?.fire({title: w.offlineQueue.length ? 'Some sales still need attention' : 'All sales uploaded',
                html: pendingSalesMarkup(w.offlineQueue), width:740,confirmButtonText:'Done',confirmButtonColor:'#c65c24',customClass:{popup:'cashier-sync-dialog'}});
        }
    };
    function updateBadge(error) {
        const badge = environment.document.getElementById('liveClock')?.nextElementSibling;
        if (badge) {
            badge.onclick = null; badge.style.cursor = ''; badge.title = '';
            if (typeof w.updateNetworkStatusUI === 'function') w.updateNetworkStatusUI();
        }
        const last = w.lastTransactionData;
        if (last?.saleId) {
            const pending = w.offlineQueue.find(p => p.saleId === last.saleId);
            w.updateReceiptSyncStatus?.(pending ? 'queued' : 'committed', pending?.syncError?.message);
        }
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

    let syncFlight;
    // Shift closure must await a sync already in progress, not read an old
    // offlineQueue while that same receipt is being uploaded.
    w.syncOfflineQueue = function() {
        if (syncFlight) return syncFlight;
        syncFlight = synchronize().finally(() => { syncFlight = null; });
        return syncFlight;
    };
    async function synchronize() {
        watchAuditBranch();
        if (environment.navigator?.onLine === false) return;
        w.isSyncing = true;
        let syncError;
        let queueChanged = false;
        const uploadedBranches=new Map();
        const sync = async () => {
            const rows = await outbox.list();
            queueChanged = rows.length > 0;
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
                    uploadedBranches.set(payload.branch,uploadedBranches.get(payload.branch)||payload.auditDeferred===true);
                } catch (error) {
                    syncError = error;
                    await outbox.noteError(payload.saleId, owner, error).catch(storageError => console.warn('Could not retain upload diagnostics:', storageError));
                    console.warn('Sale safely queued; synchronization pending:', payload.receiptId, error);
                } finally { await outbox.release(payload.saleId, owner); }
            }
        };
        try {
            if (environment.navigator?.locks) await environment.navigator.locks.request('takodeal-sale-sync-v2', sync);
            else await sync(); // IndexedDB claims still serialize each sale.
        } catch (error) {
            syncError = error;
            console.warn('Safe synchronization paused:', error);
        } finally {
            w.isSyncing = false;
            try { await refreshQueue(); updateBadge(syncError); } catch (error) { console.error('Outbox unavailable:', error); }
            // Pending rows become uploaded rows immediately in the visible view.
            if (queueChanged) w.refreshVisibleShiftSales?.();
            for(const [branch,force] of uploadedBranches) recoverInBackground(branch,{force});
        }
    }
    w.voidTransaction = (receiptId, cashier, branch) => engine.voidSale(receiptId, cashier, branch);
    w.discardParkedOrder = (id, cashier, branch, shiftId) => engine.discardParked(id, cashier, branch, shiftId);
    w.processAuditQueue = async function() {
        try {
            if (environment.navigator?.onLine === false) throw new Error('Resume requires a connection. Deductions remain safely pending.');
            const branch=ls.getItem('takodeal_device_branch');
            if(!branch)throw new Error('Select a branch before resuming inventory.');
            await w.syncOfflineQueue();
            const result = await auditRecovery.run(branch,{force:true,allowPaused:true});
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
            if(!w.isAuditModeActive)recoverInBackground(ls.getItem('takodeal_device_branch'),{force:true});
        }
        if (event.key === 'takodeal_device_branch') {watchAuditBranch();recoverInBackground(ls.getItem('takodeal_device_branch'),{force:true});}
    });
    w.addEventListener('online', () => { w.isAppOnline = true; w.syncOfflineQueue();recoverInBackground(ls.getItem('takodeal_device_branch'),{force:true}); });
    environment.document.addEventListener('DOMContentLoaded', updateAuditButton);
    environment.setTimeout(() => { updateAuditButton(); w.syncOfflineQueue();recoverInBackground(ls.getItem('takodeal_device_branch'),{force:true}); }, 5000);
    environment.setInterval(() => w.syncOfflineQueue(), 15000);
    environment.setInterval(()=>recoverInBackground(ls.getItem('takodeal_device_branch')),5*60*1000);
    refreshQueue().then(() => updateBadge()).catch(error => console.error('Local checkout storage unavailable:', error));
    watchAuditBranch();
}

export function pendingSalesMarkup(rows) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    if (!rows.length) return '<p class="cashier-sync-help">All saved sales have been confirmed by the server.</p>';
    return '<p class="cashier-sync-help">These sales are saved on this device. Keep the app connected to upload them.</p><div class="cashier-sync-list">'+rows.map(p=>{
        const time = p.localTimestamp == null ? NaN : +new Date(p.localTimestamp);
        const date = Number.isFinite(time) ? new Date(time).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}) : 'Time not recorded';
        return `<article><strong>${escape(p.receiptId || p.saleId || 'Saved sale')}</strong><small>${escape(date)} · ${escape(p.branch || 'Branch not recorded')}</small><p>${escape(p.needsReconciliation ? 'Older sale requires manager reconciliation before it can be replayed.' : p.syncError?.message || 'Waiting for upload.')}</p></article>`;
    }).join('')+'</div>';
}
