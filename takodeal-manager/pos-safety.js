// The local outbox and the Firestore sale are separate durable transactions.
// A lost acknowledgement leaves the same saleId in the outbox for a safe retry.
export const SALE_VERSION = 2;
// Owner-confirmed replacement for the deleted ingredient. This also repairs
// queued recipe snapshots; receipt identities and recipe quantities stay intact.
const INGREDIENT_REPLACEMENTS = Object.freeze({ 'T.Reg.Sauce': 'Takoyaki Sauce Regular' });
export const safeId = value => encodeURIComponent(String(value)).replace(/\./g, '%2E');
export function saleFingerprint(payload) {
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return JSON.stringify(canonical({ branch: payload.branch, receiptId: payload.receiptId,
        netTotal: Number(payload.netTotal ?? 0), cart: payload.cart || [] }));
}

export function saleIdentity(payload, cryptoApi = globalThis.crypto) {
    if (payload.mobileOrderCode) {
        return 'mobile-' + safeId(JSON.stringify([payload.branch, payload.mobileOrderCode]));
    }
    if (!cryptoApi?.getRandomValues) throw new Error('Secure sale IDs are unavailable.');
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return 'sale-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function collectDeductions(payload, bom) {
    if (!Array.isArray(payload.cart) || !payload.cart.length) throw new Error('The sale cart is empty.');
    if (!Array.isArray(bom) || !bom.length) throw new Error('Recipes are unavailable. Sale remains queued.');
    const amounts = new Map();
    const add = (name, amount) => {
        if (!name || !Number.isFinite(amount) || amount < 0) throw new Error('Invalid ingredient deduction.');
        if (amount > 0) amounts.set(name, (amounts.get(name) || 0) + amount);
    };
    for (const item of payload.cart) {
        const qty = Number(item.qty ?? 1);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid sale quantity.');
        const name = item.name || item.itemName;
        const type = String(item.orderType || payload.orderType || 'Dine-In').toLowerCase();
        for (const recipe of bom.filter(r => r.menuItem === name)) {
            let amount = Number(recipe.qty) * qty;
            if (String(recipe.ingredientName).toLowerCase().includes('box') && type.includes('dine-in')) amount /= 2;
            add(recipe.ingredientName, amount);
        }
        for (const addon of Object.values(item.addons || {})) {
            if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                add(addon.linkedIngredient, Number(addon.deductQty) * Number(addon.qty) * qty);
            }
        }
    }
    return [...amounts].map(([ingredientName, quantity]) => ({ ingredientName, quantity }));
}

export function countBalls(cart = []) {
    return cart.reduce((sum, item) => {
        const name = [item.realName, item.name, item.itemName].filter(Boolean).join(' ');
        const category = String(item.category || '');
        // Packaging and add-on sauces may contain "6 Pcs" but are not takoyaki sales.
        if (!/takoyaki/i.test(name + ' ' + category) || /extra|sauce|take\s*out|packaging|box/i.test(name)) return sum;
        const pack = (name + ' ' + (item.variantName || '')).match(/(\d+)\s*(?:pcs|pieces)\b/i);
        const qty = Number(item.qty ?? 1);
        if (!pack || !Number.isFinite(qty) || qty <= 0) return sum;
        return sum + Number(pack[1]) * qty;
    }, 0);
}

// IndexedDB read/write transactions serialize across tabs; array replacement in
// localStorage cannot provide that guarantee. Resolve only after oncomplete.
export function createOutbox(indexedDB = globalThis.indexedDB) {
    let dbPromise;
    const open = () => dbPromise ||= new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error('Local sale storage is unavailable.'));
        const request = indexedDB.open('takodeal_sale_outbox_v2', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('sales', { keyPath: 'saleId' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    async function transact(mode, action) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sales', mode);
            let result, failure;
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Could not save the sale locally.'));
            const store = tx.objectStore('sales');
            const request = action(store, value => { result = value; }, error => { failure = error; tx.abort(); });
            if (request) request.onerror = () => { failure = request.error; };
        });
    }
    return {
        enqueue: payload => transact('readwrite', (store, done, fail) => {
            const request = store.get(payload.saleId);
            request.onsuccess = () => {
                const existing = request.result;
                if (existing) {
                    if (saleFingerprint(existing.payload) !== saleFingerprint(payload)) {
                        return fail(new Error('Sale identity conflict.'));
                    }
                    return done(existing.payload);
                }
                store.add({ saleId: payload.saleId, payload, owner: null, leaseUntil: 0 });
                done(payload);
            };
            return request;
        }),
        list: () => transact('readonly', (store, done) => {
            const request = store.getAll();
            request.onsuccess = () => done(request.result);
            return request;
        }),
        claim: (saleId, owner, now = Date.now()) => transact('readwrite', (store, done) => {
            const request = store.get(saleId);
            request.onsuccess = () => {
                const row = request.result;
                if (!row || (row.owner && row.owner !== owner && row.leaseUntil > now)) return done(null);
                row.owner = owner;
                row.leaseUntil = now + 60000;
                store.put(row);
                done(row.payload);
            };
            return request;
        }),
        saveClaim: (payload, owner) => transact('readwrite', (store, done, fail) => {
            const request = store.get(payload.saleId);
            request.onsuccess = () => {
                const row = request.result;
                if (!row || row.owner !== owner) return fail(new Error('Sale claim changed. Retry safely.'));
                store.put({ ...row, payload });
                done(payload);
            };
            return request;
        }),
        acknowledge: saleId => transact('readwrite', store => store.delete(saleId)),
        noteError: (saleId, owner, error) => transact('readwrite', store => {
            const request = store.get(saleId);
            request.onsuccess = () => {
                const row = request.result;
                if (row?.owner === owner) store.put({ ...row,
                    syncError: { code: String(error?.code || ''), message: String(error?.message || error), at: new Date().toISOString() } });
            };
            return request;
        }),
        release: (saleId, owner) => transact('readwrite', store => {
            const request = store.get(saleId);
            request.onsuccess = () => {
                const row = request.result;
                if (row?.owner === owner) store.put({ ...row, owner: null, leaseUntil: 0 });
            };
            return request;
        })
    };
}

export function createSaleEngine(api) {
    const { db, doc, collection, query, where, getDocsFromServer, runTransaction, increment, serverTimestamp } = api;
    const ref = (table, id) => doc(db, table, id);
    const queryDocs = (table, filters) => getDocsFromServer(query(collection(db, table), ...filters.map(([key, value]) => where(key, '==', value))));
    const transactionRef = saleId => ref('transactions', saleId);
    const markerRef = saleId => ref('pos_sale_commits', saleId);
    function validateMovement(movement, branch, snapshot) {
        if (!Number.isFinite(movement.quantity) || movement.quantity <= 0 || !snapshot.exists() ||
            snapshot.data().branch !== branch || snapshot.data().name !== movement.ingredientName) {
            throw new Error('Inventory changed or is missing. Sale remains pending for review.');
        }
        const stock = Number(snapshot.data().currentStock ?? 0);
        if (!Number.isFinite(stock)) throw new Error('Invalid inventory stock.');
        return stock;
    }
    async function readMovements(tx, movements, branch) {
        const rows = [];
        for (const movement of movements) {
            const inventoryRef = ref('inventory', movement.inventoryId);
            const snapshot = await tx.get(inventoryRef);
            rows.push({ movement, inventoryRef, snapshot, stock: validateMovement(movement, branch, snapshot) });
        }
        return rows;
    }
    function stats(tx, payload, direction) {
        const balls = payload.ballsCounted ?? countBalls(payload.cart);
        if (balls > 0) tx.set(ref('settings', 'global_stats'), {
            totalTakoyakiBalls: increment(direction * balls),
            ['balls_' + payload.branch]: increment(direction * balls),
            lastSaleId: payload.saleId, lastSaleBranch: payload.branch, lastSaleDirection: direction
        }, { merge: true });
    }
    function assertSale(existing, payload) {
        if (existing.branch !== payload.branch || existing.receiptId !== payload.receiptId || existing.saleId !== payload.saleId ||
            (existing.fingerprint || saleFingerprint(existing)) !== saleFingerprint(payload)) {
            throw new Error('Sale identity conflict. Do not resubmit this order.');
        }
    }
    return {
        async prepare(payload, bom) {
            if (!payload.saleId || payload.saleVersion !== SALE_VERSION) throw new Error('Legacy sale requires reconciliation.');
            if (payload.inventoryMovements) return payload;
            const movements = collectDeductions(payload, payload.recipeSnapshot || bom);
            const resolved = new Map();
            const normalizedName = name => String(name ?? '').trim().replace(/\s+/g, ' ');
            let branchInventory;
            async function findIngredient(name) {
                const exact = await queryDocs('inventory', [['branch', payload.branch], ['name', name]]);
                if (exact.docs.length) return exact.docs;
                // Firestore compares spaces exactly. Only a unique whitespace
                // match in this branch is safe; never guess another ingredient.
                branchInventory ||= await queryDocs('inventory', [['branch', payload.branch]]);
                return branchInventory.docs.filter(row => normalizedName(row.data().name) === normalizedName(name));
            }
            for (const movement of movements) {
                let ingredientName = movement.ingredientName;
                let matches = await findIngredient(ingredientName);
                // Never use a replacement to hide duplicate stock records.
                if (!matches.length && INGREDIENT_REPLACEMENTS[ingredientName]) {
                    ingredientName = INGREDIENT_REPLACEMENTS[ingredientName];
                    matches = await findIngredient(ingredientName);
                }
                if (matches.length !== 1) throw new Error('Missing or duplicate inventory item: ' + ingredientName +
                    ' (branch: ' + payload.branch + ', matches: ' + matches.length + ')');
                const inventoryId = matches[0].id;
                // Keep the actual stored spelling for strict transaction-time
                // validation and later audit/void inventory movements.
                ingredientName = matches[0].data().name;
                const previous = resolved.get(inventoryId);
                const quantity = (previous?.quantity || 0) + movement.quantity;
                if (!Number.isFinite(quantity)) throw new Error('Invalid ingredient deduction.');
                resolved.set(inventoryId, { ingredientName, quantity, inventoryId });
            }
            return { ...payload, inventoryMovements: [...resolved.values()] };
        },
        // Used before preparation, so a committed retry can be acknowledged even
        // if recipes or inventory configuration have subsequently changed.
        async alreadyCommitted(payload) {
            return runTransaction(db, async tx => {
                const marker = await tx.get(markerRef(payload.saleId));
                if (marker.exists()) { assertSale(marker.data(), payload); return true; }
                const snapshot = await tx.get(transactionRef(payload.saleId));
                if (!snapshot.exists()) return false;
                assertSale(snapshot.data(), payload);
                return true;
            });
        },
        async commit(payload) {
            if (!payload.branch || !payload.receiptId || payload.saleVersion !== SALE_VERSION || !Array.isArray(payload.inventoryMovements)) {
                throw new Error('Sale is not prepared.');
            }
            const movements = payload.inventoryMovements;
            if (movements.length > 200) throw new Error('Sale contains too many inventory items.');
            return runTransaction(db, async tx => {
                const saleRef = transactionRef(payload.saleId);
                const marker = await tx.get(markerRef(payload.saleId));
                if (marker.exists()) { assertSale(marker.data(), payload); return 'already-committed'; }
                const existing = await tx.get(saleRef);
                if (existing.exists()) { assertSale(existing.data(), payload); return 'already-committed'; }
                let mobileRef;
                if (payload.mobileOrderId) {
                    mobileRef = ref('incoming_orders', payload.mobileOrderId);
                    const mobile = await tx.get(mobileRef);
                    if (!mobile.exists() || mobile.data().branch !== payload.branch) throw new Error('Mobile order is missing or belongs to another branch.');
                    if (mobile.data().paymentStatus === 'paid') throw new Error('Mobile order is already paid. Review its existing receipt.');
                }
                const audit = await tx.get(ref('settings', 'audit_' + safeId(payload.branch)));
                const deferred = payload.auditDeferred || (audit.exists() && audit.data().active === true);
                const rows = await readMovements(tx, movements, payload.branch);
                // All reads precede writes. Firestore retries this entire callback
                // on contention; no local mutations or notifications live here.
                if (!deferred) for (const row of rows) {
                    tx.update(row.inventoryRef, { currentStock: increment(-row.movement.quantity) });
                }
                const { recipeSnapshot, ...sale } = payload;
                const ballsCounted = countBalls(payload.cart);
                tx.set(saleRef, {
                    ...sale, timestamp: new Date(payload.localTimestamp),
                    inventoryState: deferred ? 'deferred' : 'applied',
                    ballsCounted, statsApplied: true
                });
                // Retain this marker even when receipt history is archived.
                tx.set(markerRef(payload.saleId), { saleId: payload.saleId, branch: payload.branch,
                    receiptId: payload.receiptId, fingerprint: saleFingerprint(payload), committedAt: serverTimestamp() });
                stats(tx, { ...payload, ballsCounted }, 1);
                if (mobileRef) tx.update(mobileRef, { paymentStatus: 'paid', receiptId: payload.receiptId, encodedAt: serverTimestamp() });
                else if (payload.orderType === 'Delivery') tx.set(ref('incoming_orders', 'delivery-' + payload.saleId), {
                    branch: payload.branch, customerName: payload.customerName || 'Delivery Customer',
                    contactNumber: payload.contactNumber || '', deliveryAddress: payload.deliveryAddress || '',
                    totalAmount: payload.netTotal, items: payload.cart, status: 'preparing',
                    orderCode: payload.receiptId, paymentMethod: payload.paymentMethod || 'Cash', timestamp: serverTimestamp()
                });
                if (payload.globalDiscountType && payload.globalDiscountType !== 'none') tx.set(ref('manager_alerts', 'discount-' + payload.saleId), {
                    type: 'DISCOUNT_APPLIED', branch: payload.branch, cashier: payload.cashier,
                    message: `Discount [${payload.globalDiscountType}] applied to Order #${payload.receiptId} for ${payload.customerName || 'Guest'}.`,
                    timestamp: serverTimestamp(), isRead: false
                });
                if (payload.mealStaffName) tx.set(ref('staff_requests', 'meal-' + payload.saleId), {
                    type: `${payload.globalDiscountType === 'manager_meal' ? 'Manager Meal' : 'Staff Meal'} (POS Auto)`,
                    branch: payload.branch, staffName: payload.mealStaffName, amount: payload.netTotal,
                    item: payload.cart.map(i => `${i.qty}x ${i.name || i.itemName}`).join(', ') + ' | OR#: ' + payload.receiptId,
                    receiptId: payload.receiptId, status: 'Pending', staffAcknowledged: false, timestamp: serverTimestamp()
                });
                return 'committed';
            });
        },
        async setAuditMode(branch, active, cashier) {
            await runTransaction(db, async tx => {
                tx.set(ref('settings', 'audit_' + safeId(branch)), { active, branch, updatedBy: cashier, updatedAt: serverTimestamp() });
            });
        },
        async resumeAvailableAudits(skipBranch = () => false) {
            const snap = await queryDocs('transactions', [['inventoryState', 'deferred']]);
            for (const branch of new Set(snap.docs.map(d => d.data().branch))) if (!skipBranch(branch)) await this.resumeAudit(branch);
        },
        async resumeAudit(branch) {
            let paused = false, applied = 0;
            const active = await runTransaction(db, async tx => {
                const audit = await tx.get(ref('settings', 'audit_' + safeId(branch)));
                return audit.exists() && audit.data().active === true;
            });
            if (active) return { paused: true, applied: 0 };
            const snap = await queryDocs('transactions', [['branch', branch], ['inventoryState', 'deferred']]);
            for (const sale of snap.docs.filter(d => d.data().inventoryState === 'deferred')) {
                const result = await runTransaction(db, async tx => {
                    const current = await tx.get(sale.ref);
                    if (!current.exists()) return;
                    const data = current.data();
                    if (data.branch !== branch || data.inventoryState !== 'deferred') return;
                    const audit = await tx.get(ref('settings', 'audit_' + safeId(branch)));
                    if (audit.exists() && audit.data().active === true) return 'paused';
                    if (data.status === 'Voided') {
                        tx.update(sale.ref, { inventoryState: 'cancelled' });
                        return;
                    }
                    const rows = await readMovements(tx, data.inventoryMovements, branch);
                    for (const row of rows) tx.update(row.inventoryRef, { currentStock: increment(-row.movement.quantity) });
                    tx.update(sale.ref, { inventoryState: 'applied', inventoryAppliedAt: serverTimestamp() });
                    return 'applied';
                });
                if (result === 'paused') paused = true;
                if (result === 'applied') applied++;
            }
            return { paused, applied };
        },
        async voidSale(receiptId, cashier, branch) {
            const snap = await queryDocs('transactions', [['receiptId', receiptId], ['branch', branch]]);
            if (snap.docs.length !== 1) throw new Error('Receipt is missing or duplicated. Reconcile it before voiding.');
            const saleRef = snap.docs[0].ref;
            return runTransaction(db, async tx => {
                const sale = await tx.get(saleRef);
                if (!sale.exists()) throw new Error('Receipt not found.');
                const data = sale.data();
                if (data.branch !== branch) throw new Error('Receipt belongs to another branch.');
                if (data.status === 'Voided') return false;
                if (data.saleVersion !== SALE_VERSION || !Array.isArray(data.inventoryMovements) ||
                    !['applied', 'deferred'].includes(data.inventoryState)) {
                    throw new Error('This older receipt has no verified deduction record. Reconcile its inventory before voiding.');
                }
                const rows = data.inventoryState === 'applied' ? await readMovements(tx, data.inventoryMovements, branch) : [];
                for (const row of rows) {
                    tx.update(row.inventoryRef, { currentStock: increment(row.movement.quantity) });
                    tx.set(ref('stock_logs', safeId(saleRef.id + '-void-' + row.movement.inventoryId)), {
                        branch, item: row.movement.ingredientName, uom: row.snapshot.data().uom || 'units',
                        oldQty: row.stock, newQty: row.stock + row.movement.quantity, variance: row.movement.quantity,
                        type: 'Transaction Voided', note: `Receipt ${receiptId} voided by ${cashier}`,
                        user: cashier, timestamp: serverTimestamp()
                    });
                }
                tx.update(saleRef, { status: 'Voided', voidedBy: cashier, voidTime: serverTimestamp(),
                    inventoryState: data.inventoryState === 'applied' ? 'reversed' : 'cancelled' });
                if (data.statsApplied) stats(tx, data, -1);
                tx.set(ref('manager_alerts', 'void-' + saleRef.id), {
                    type: 'VOID_ALERT', branch, cashier, receiptId,
                    message: `Cashier ${cashier} voided Receipt ${receiptId}. ${rows.length ? 'Recorded inventory deductions were returned.' : 'Paused inventory deductions were cancelled.'}`,
                    timestamp: serverTimestamp(), isRead: false
                });
                return true;
            });
        },
        async discardParked(parkedId, cashier, branch, shiftId) {
            const parkedRef = ref('parked_orders', parkedId);
            const id = 'parked-delete-' + safeId(parkedId);
            return runTransaction(db, async tx => {
                const parked = await tx.get(parkedRef);
                if (!parked.exists()) return false;
                const order = parked.data();
                if (order.branch !== branch) throw new Error('Parked order belongs to another branch.');
                tx.set(ref('transactions', id), {
                    branch, cashier, shiftId, parkedOrderId: parkedId, receiptId: 'PRK-VOID-' + parkedId, netTotal: order.total || order.netTotal || 0,
                    status: 'Voided', orderType: (order.orderType || 'Dine-In') + ' (PARKED)',
                    paymentMethod: 'Unpaid / Deleted', customerName: order.name || order.customerName || 'Guest',
                    cart: order.items || order.cart || [], inventoryState: 'none', inventoryMovements: [], timestamp: serverTimestamp()
                });
                tx.set(ref('manager_alerts', id), {
                    type: 'PARKED_VOID_ALERT', branch, cashier,
                    message: `Unpaid parked order for ${order.name || order.customerName || 'Guest'} was deleted. Inventory was unchanged.`,
                    timestamp: serverTimestamp(), isRead: false
                });
                tx.delete(parkedRef);
                return true;
            });
        }
    };
}
