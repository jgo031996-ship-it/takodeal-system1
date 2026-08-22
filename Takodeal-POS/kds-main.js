import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc, serverTimestamp, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4",
    authDomain: "takodeal-pos.firebaseapp.com",
    projectId: "takodeal-pos",
    storageBucket: "takodeal-pos.firebasestorage.app",
    messagingSenderId: "248826111383",
    appId: "1:248826111383:web:48bf1e2c172298079bd0d2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.branchName = localStorage.getItem('takodeal_kds_branch');
window.staffName = localStorage.getItem('takodeal_kds_staff') || 'Kitchen Staff';

window.kdsCart = [];
window.consCart = [];
window.kdsInventoryCache = [];
window.kdsActiveOrders = [];
window.kdsHistoryOrders = [];
window.kdsCurrentOrderTab = 'active';
window.ordersUnsubscribe = null;

window.kdsPrepCats = ["prepared batch"];
window.kdsConsCats = ["consumables", "cleaning supplies", "packaging"];
window.kdsAllowedPrep = [];

// --- INITIALIZATION & DYNAMIC BRANCH FETCHER ---
window.fetchKDSBranches = async function() {
    let branchDropdown = document.getElementById('kdsBranch');
    if (!branchDropdown) return;
    try {
        branchDropdown.innerHTML = '<option value="">⏳ Fetching live branches...</option>';
        const snap = await getDocs(query(collection(db, "branches")));
        let html = '<option value="" disabled selected>-- Select Branch --</option>';
        let branches = [];
        snap.forEach(doc => { let name = doc.data().name; if (name) branches.push(name); });
        branches.sort((a, b) => a.localeCompare(b)).forEach(b => { html += `<option value="${b}">${b}</option>`; });
        branchDropdown.innerHTML = html;
    } catch (e) {
        branchDropdown.innerHTML = '<option value="">❌ Database Error. Check Wi-Fi.</option>';
    }
};

document.addEventListener("DOMContentLoaded", () => {
    if (!window.branchName) {
        document.getElementById('setupOverlay').style.display = 'flex';
        fetchKDSBranches();
    } else {
        document.getElementById('setupOverlay').style.display = 'none';
        document.getElementById('displayBranch').innerText = `📍 ${window.branchName} | 👤 ${window.staffName}`;
        startOrdersListener();
        loadAllInventory();
    }
    setInterval(() => {
        document.getElementById('clockDisplay').innerText = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
});

window.lockKDS = function() {
    let b = document.getElementById('kdsBranch').value;
    let s = document.getElementById('kdsStaff').value.trim();
    if (!b || !s) { alert("Please enter branch and name."); return; }
    localStorage.setItem('takodeal_kds_branch', b);
    localStorage.setItem('takodeal_kds_staff', s);
    location.reload();
};

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.classList.remove('active-orders'); });
    document.querySelectorAll('.content-area').forEach(c => c.classList.remove('active'));
    
    let activeBtn = document.getElementById('btn-' + tab);
    if(tab === 'orders') activeBtn.classList.add('active-orders');
    else activeBtn.classList.add('active');
    
    document.getElementById('view-' + tab).classList.add('active');
};

// ========================================================
// 🧾 1. LIVE ORDERS ENGINE (POS ONLY)
// ========================================================
function startOrdersListener() {
    let startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const q = query(collection(db, "transactions"), where("branch", "==", window.branchName), where("timestamp", ">=", startOfDay));
    
    window.ordersUnsubscribe = onSnapshot(q, (snap) => {
        window.kdsActiveOrders = [];
        window.kdsHistoryOrders = [];
        
        snap.forEach(docSnap => {
            let tx = docSnap.data();
            
            // 🛑 GRAB & FOODPANDA BLOCKER: Only allow standard POS orders into the KDS!
            let pm = (tx.paymentMethod || '').toLowerCase();
            if (pm.includes('grab') || pm.includes('foodpanda') || pm.includes('panda')) return;
            
            if (tx.status !== 'Voided' && tx.status !== 'Parked') {
                if (tx.kdsStatus === 'Completed') {
                    window.kdsHistoryOrders.push({ id: docSnap.id, ...tx });
                } else {
                    window.kdsActiveOrders.push({ id: docSnap.id, ...tx });
                }
            }
        });
        
        window.kdsActiveOrders.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis()); // Oldest first
        window.kdsHistoryOrders.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis()); // Newest first
        
        let badge = document.getElementById('kdsOrderBadge');
        if (window.kdsActiveOrders.length > 0) {
            badge.innerText = window.kdsActiveOrders.length;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }

        renderOrders();
        playPingIfNew(window.kdsActiveOrders.length);
    });
}

window.switchOrderTab = function(tab) {
    window.kdsCurrentOrderTab = tab;
    document.getElementById('kdsTabActive').style.background = tab === 'active' ? 'var(--accent)' : '#334155';
    document.getElementById('kdsTabActive').style.boxShadow = tab === 'active' ? '0 4px 6px rgba(0,0,0,0.2)' : 'none';
    document.getElementById('kdsTabHistory').style.background = tab === 'history' ? 'var(--accent)' : '#334155';
    document.getElementById('kdsTabHistory').style.boxShadow = tab === 'history' ? '0 4px 6px rgba(0,0,0,0.2)' : 'none';
    renderOrders();
};

let lastOrderCount = 0;
function playPingIfNew(currentCount) {
    if (currentCount > lastOrderCount) {
        try {
            // 🔥 HARSH ALARM TONE ENGINE (Wakes up the kitchen!)
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            let playBeep = (freq, time, duration) => {
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = 'square'; // Square wave for a harsh buzzer sound
                osc.frequency.setValueAtTime(freq, time); 
                gain.gain.setValueAtTime(1, time);
                gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
                osc.start(time); osc.stop(time + duration);
            };
            
            let now = ctx.currentTime;
            playBeep(900, now, 0.15);
            playBeep(900, now + 0.25, 0.15);
            playBeep(1200, now + 0.5, 0.4); // High pitched finish
        } catch(e) {}
    }
    lastOrderCount = currentCount;
}

function renderOrders() {
    let container = document.getElementById('kdsOrdersContainer');
    let orders = window.kdsCurrentOrderTab === 'active' ? window.kdsActiveOrders : window.kdsHistoryOrders;
    
    if (orders.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 50px; font-size: 18px;">${window.kdsCurrentOrderTab === 'active' ? '✅ Kitchen is Clear!' : 'No history yet today.'}</div>`;
        return;
    }
    
    let html = '';
    orders.forEach(o => {
        let itemsHtml = (o.cart || []).map(i => {
            let addons = '';
            if (i.addons) {
                for (let key in i.addons) { if (i.addons[key].qty > 0) addons += `<div style="color: #0ea5e9; font-size: 13px; font-weight: bold; margin-left: 10px;">+ ${i.addons[key].qty}x ${key}</div>`; }
            }
            let notes = i.notes ? `<div style="color: #ef4444; font-size: 13px; font-style: italic; font-weight: 900; margin-left: 10px; background: #fee2e2; padding: 2px 6px; border-radius: 4px; display: inline-block;">✎ NOTE: ${i.notes}</div>` : '';
            return `<div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0;">
                <span style="color: #b91c1c; font-size: 18px; font-weight: 900;">${i.qty}x</span> <span style="color: #0f172a; font-size: 16px;">${i.name}</span><br>
                ${addons}${notes}
            </div>`;
        }).join('');

        let timeStr = o.timestamp ? o.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        let typeColor = o.orderType.toUpperCase().includes('DINE') ? '#16a34a' : '#d97706';

        // 🔥 THE TWO-STEP KITCHEN BUTTONS
        let actionHtml = '';
        if (window.kdsCurrentOrderTab === 'active') {
            if (o.kdsStatus !== 'Preparing') {
                actionHtml = `<button onclick="window.updateKdsStatus('${o.id}', 'Preparing')" style="background: var(--warning); color: white; border: none; padding: 15px; font-size: 16px; font-weight: 900; cursor: pointer; width: 100%;">👨‍🍳 Start Preparing</button>`;
            } else {
                actionHtml = `
                <div style="display:flex;">
                    <div style="background: #e2e8f0; color: #475569; padding: 15px; font-size: 14px; font-weight: 900; width: 40%; text-align: center; display: flex; align-items: center; justify-content: center;"><span style="animation: pulse 1.5s infinite;">🔥 Cooking...</span></div>
                    <button onclick="window.updateKdsStatus('${o.id}', 'Completed')" style="background: var(--success); color: white; border: none; padding: 15px; font-size: 16px; font-weight: 900; cursor: pointer; width: 60%;">✅ Mark Done</button>
                </div>`;
            }
        } else {
            actionHtml = `<div style="background: #334155; color: var(--success); padding: 15px; text-align: center; font-weight: 900; font-size: 16px;">✅ Completed</div>`;
        }

        html += `
            <div class="kds-ticket">
                <div class="ticket-head">
                    <span style="font-size: 18px;">${o.receiptId}</span>
                    <span style="background: ${typeColor}; color: white; padding: 4px 8px; border-radius: 6px; font-size: 12px;">${o.orderType.toUpperCase()}</span>
                </div>
                <div style="padding: 10px 15px; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; font-size: 12px; color: #475569; display: flex; justify-content: space-between;">
                    <span>👤 ${o.customerName || 'Guest'}</span> <span>⏰ ${timeStr}</span>
                </div>
                <div class="ticket-body">${itemsHtml}</div>
                ${actionHtml}
            </div>
        `;
    });
    container.innerHTML = html;
}

window.updateKdsStatus = async function(docId, status) {
    try { await updateDoc(doc(db, "transactions", docId), { kdsStatus: status }); }
    catch(e) { console.error("Error updating KDS status", e); }
};

// ========================================================
// 📦 2. UNIVERSAL INVENTORY FETCHER (WITH FILTERS)
// ========================================================
async function loadAllInventory() {
    try {
        // 🔥 SYNC FILTERS FROM MANAGER APP
        const configSnap = await getDoc(doc(db, "settings", "global_pos_config"));
        if (configSnap.exists()) {
            let d = configSnap.data();
            if (d.kitchenPrepCats) window.kdsPrepCats = d.kitchenPrepCats.map(c => c.trim().toLowerCase());
            if (d.consumableCats) window.kdsConsCats = d.consumableCats.map(c => c.trim().toLowerCase());
        }

        const bQ = query(collection(db, "branches"), where("name", "==", window.branchName));
        const bSnap = await getDocs(bQ);
        if (!bSnap.empty && bSnap.docs[0].data().allowedPrepItems) {
            window.kdsAllowedPrep = bSnap.docs[0].data().allowedPrepItems;
        }

        const q = query(collection(db, "inventory"), where("branch", "==", window.branchName));
        const snap = await getDocs(q);
        
        window.kdsInventoryCache = [];
        snap.forEach(docSnap => window.kdsInventoryCache.push({ id: docSnap.id, ...docSnap.data() }));
        window.kdsInventoryCache.sort((a,b) => a.name.localeCompare(b.name));
        
        buildPrepUI();
        buildConsumablesUI();
        buildWasteUI();
    } catch(e) { console.error("Inventory Fetch Error", e); }
}

// ========================================================
// 🥣 3. KITCHEN PREP ENGINE
// ========================================================
function buildPrepUI() {
    let grid = document.getElementById('prepGrid');
    
    // Apply exact POS filters!
    let prepItems = window.kdsInventoryCache.filter(i => {
        let cat = (i.category || "").trim().toLowerCase();
        let isInCat = window.kdsPrepCats.includes(cat);
        let isAllowed = window.kdsAllowedPrep.length === 0 || window.kdsAllowedPrep.includes(i.name);
        return isInCat && isAllowed && i.showInPrep !== false;
    });
    
    let html = '';
    prepItems.forEach(d => {
        let bUom = d.uom || 'units'; let pUom = d.purchaseUom || d.purchUom || 'Batch';
        let imgCircle = d.image ? `<div style="width: 70px; height: 70px; border-radius: 50%; margin: 0 auto 12px auto; background-image: url('${d.image}'); background-size: cover; background-position: center; border: 3px solid #0ea5e9; box-shadow: 0 4px 10px rgba(0,0,0,0.4);"></div>` : `<div style="width: 70px; height: 70px; border-radius: 50%; margin: 0 auto 12px auto; background-color: #0f172a; border: 3px solid #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);">🥣</div>`;
        html += `
            <div class="prep-card" onclick="window.addToPrep('${d.id}', '${d.name.replace(/'/g, "\\'")}', '${pUom}', '${bUom}')">
                ${imgCircle}
                <h3 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 900; color: white; line-height: 1.2;">${d.name}</h3>
                <span style="background: #0f172a; color: #38bdf8; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #334155;">Shelf: ${(parseFloat(d.currentStock)||0).toFixed(1)} ${bUom}</span>
            </div>
        `;
    });
    grid.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 50px;">No prep items setup for this branch.</div>';
}

window.addToPrep = async function(id, name, pUom, bUom) {
    const { value: qty } = await Swal.fire({ title: 'Log Batch', html: `<div style="color: white;">How many <b>${pUom}s</b> of <b>${name}</b>?</div>`, input: 'number', inputAttributes: { min: 0.1, step: 'any' }, background: '#1e293b', color: '#fff', confirmButtonColor: '#0ea5e9', customClass: { popup: 'rounded-2xl' } });
    if (!qty) return;
    let existing = window.kdsCart.find(i => i.id === id);
    if (existing) existing.purchQty += parseFloat(qty);
    else window.kdsCart.push({ id: id, name: name, purchQty: parseFloat(qty), purchUom: pUom, baseUom: bUom });
    renderPrepCart();
};

function renderPrepCart() {
    let c = document.getElementById('prepCart');
    if (window.kdsCart.length === 0) { c.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 50px; font-size: 14px;">Cart empty.<br>Tap a batch to start.</div>'; return; }
    let html = '';
    window.kdsCart.forEach((item, index) => {
        html += `<div class="cart-item">
            <div><strong style="font-size: 14px; color: white;">${item.name}</strong><br><span style="color: var(--success); font-weight: 900; font-size: 14px;">+${item.purchQty} ${item.purchUom}</span></div>
            <button onclick="window.kdsCart.splice(${index}, 1); window.renderPrepCart();" style="background: #450a0a; color: #ef4444; border: 1px solid #7f1d1d; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer;">✖</button>
        </div>`;
    });
    c.innerHTML = html;
}
window.renderPrepCart = renderPrepCart;

window.submitKitchenPrep = async function() {
    if (window.kdsCart.length === 0) return Swal.fire({title: 'Empty', text: 'Cart is empty.', icon: 'warning', background: '#1e293b', color: '#fff'});

    Swal.fire({ title: 'Logging to Vault...', background: '#1e293b', color: '#fff', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        let missingItems = [];

        for (let item of window.kdsCart) {
            const invRef = doc(db, "inventory", item.id);
            const invSnap = await getDoc(invRef);
            if (!invSnap.exists()) continue;
            let d = invSnap.data();
            let cRate = parseFloat(d.conversionRate) || 1;
            let baseQty = item.purchQty * cRate;
            await updateDoc(invRef, { currentStock: (d.currentStock || 0) + baseQty });
            
            const bomQ = query(collection(db, "bom"), where("menuItem", "==", item.name));
            const bomSnap = await getDocs(bomQ);
            if (!bomSnap.empty) {
                for (let b of bomSnap.docs) {
                    let r = b.data();
                    let rawQ = query(collection(db, "inventory"), where("branch", "==", window.branchName), where("name", "==", r.ingredientName));
                    let rawSnap = await getDocs(rawQ);
                    if (!rawSnap.empty) await updateDoc(rawSnap.docs[0].ref, { currentStock: (rawSnap.docs[0].data().currentStock || 0) - (r.qty * item.purchQty) });
                    else missingItems.push(r.ingredientName);
                }
            }
            await addDoc(collection(db, "stock_logs"), { branch: window.branchName, item: item.name, variance: baseQty, uom: item.baseUom, purchUom: item.purchUom, purchQty: item.purchQty, type: "KITCHEN KDS PREP", note: `Prepared by ${window.staffName}`, timestamp: serverTimestamp() });
        }

        let msg = `Logged ${window.kdsCart.length} batches to inventory.`;
        if (missingItems.length > 0) msg += `<br><br>⚠️ Missing Raw Ingredients: ${missingItems.join(', ')}`;
        Swal.fire({ title: 'Success!', html: msg, icon: 'success', background: '#1e293b', color: '#fff' });
        
        window.kdsCart = []; renderPrepCart(); loadAllInventory();
    } catch (e) { Swal.fire({ title: 'Error', text: 'Failed to log.', icon: 'error', background: '#1e293b', color: '#fff' }); }
};

// ========================================================
// 🧹 4. CONSUMABLES ENGINE
// ========================================================
function buildConsumablesUI() {
    let grid = document.getElementById('consGrid');
    let consItems = window.kdsInventoryCache.filter(i => window.kdsConsCats.includes((i.category || "").trim().toLowerCase()));
    
    let html = '';
    consItems.forEach(d => {
        let bUom = d.uom || 'units';
        let imgCircle = d.image ? `<div style="width: 70px; height: 70px; border-radius: 50%; margin: 0 auto 12px auto; background-image: url('${d.image}'); background-size: cover; background-position: center; border: 3px solid #0ea5e9; box-shadow: 0 4px 10px rgba(0,0,0,0.4);"></div>` : `<div style="width: 70px; height: 70px; border-radius: 50%; margin: 0 auto 12px auto; background-color: #0f172a; border: 3px solid #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);">📦</div>`;
        html += `
            <div class="prep-card" onclick="window.addToCons('${d.id}', '${d.name.replace(/'/g, "\\'")}', '${bUom}')">
                ${imgCircle}
                <h3 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 900; color: white; line-height: 1.2;">${d.name}</h3>
                <span style="background: #0f172a; color: #38bdf8; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #334155;">Shelf: ${(parseFloat(d.currentStock)||0).toFixed(1)} ${bUom}</span>
            </div>
        `;
    });
    grid.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 50px;">No consumables setup for this branch.</div>';
}

window.addToCons = async function(id, name, uom) {
    const { value: qty } = await Swal.fire({ title: 'Store Use', html: `<div style="color: white;">How many <b>${uom}</b> of <b>${name}</b> did you take?</div>`, input: 'number', inputAttributes: { min: 0.1, step: 'any' }, background: '#1e293b', color: '#fff', confirmButtonColor: '#0ea5e9', customClass: { popup: 'rounded-2xl' } });
    if (!qty) return;
    let existing = window.consCart.find(i => i.id === id);
    if (existing) existing.qty += parseFloat(qty);
    else window.consCart.push({ id: id, name: name, qty: parseFloat(qty), uom: uom });
    renderConsCart();
};

function renderConsCart() {
    let c = document.getElementById('consCart');
    if (window.consCart.length === 0) { c.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 50px; font-size: 14px;">Cart is empty.<br>Tap an item to start.</div>'; return; }
    let html = '';
    window.consCart.forEach((item, index) => {
        html += `<div class="cart-item">
            <div><strong style="font-size: 14px; color: white;">${item.name}</strong><br><span style="color: var(--warning); font-weight: 900; font-size: 14px;">-${item.qty} ${item.uom}</span></div>
            <button onclick="window.consCart.splice(${index}, 1); window.renderConsCart();" style="background: #450a0a; color: #ef4444; border: 1px solid #7f1d1d; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer;">✖</button>
        </div>`;
    });
    c.innerHTML = html;
}
window.renderConsCart = renderConsCart;

window.submitConsumables = async function() {
    if (window.consCart.length === 0) return;
    Swal.fire({ title: 'Logging...', background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        for (let item of window.consCart) {
            const invRef = doc(db, "inventory", item.id);
            const invSnap = await getDoc(invRef);
            if (!invSnap.exists()) continue;
            let stock = parseFloat(invSnap.data().currentStock) || 0;
            await updateDoc(invRef, { currentStock: stock - item.qty });
            await addDoc(collection(db, "stock_logs"), { branch: window.branchName, item: item.name, uom: item.uom, oldQty: stock, newQty: stock - item.qty, variance: -item.qty, type: "Store Use (KDS)", note: "KDS App Store Use", user: window.staffName, timestamp: new Date() });
        }
        Swal.fire({ title: 'Success!', icon: 'success', background: '#1e293b', color: '#fff' });
        window.consCart = []; renderConsCart(); loadAllInventory();
    } catch (e) { Swal.fire({ title: 'Error', text: 'Failed to log.', icon: 'error', background: '#1e293b', color: '#fff' }); }
};

// ========================================================
// 🗑️ 5. LOG WASTE ENGINE
// ========================================================
function buildWasteUI() {
    let sel = document.getElementById('wasteItemSelect');
    let html = '<option value="" disabled selected>-- Choose Item --</option>';
    window.kdsInventoryCache.forEach(d => { html += `<option value="${d.id}">${d.name} (Shelf: ${(parseFloat(d.currentStock)||0).toFixed(1)})</option>`; });
    sel.innerHTML = html;
}

window.submitWaste = async function() {
    let itemId = document.getElementById('wasteItemSelect').value;
    let qty = parseFloat(document.getElementById('wasteQty').value);
    let reason = document.getElementById('wasteReason').value;
    
    if (!itemId || isNaN(qty) || qty <= 0) return Swal.fire({title: 'Error', text: 'Select item and valid quantity.', icon: 'warning', background: '#1e293b', color: '#fff'});
    
    Swal.fire({ title: 'Logging Waste...', background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    
    try {
        const invRef = doc(db, "inventory", itemId);
        const invSnap = await getDoc(invRef);
        if (!invSnap.exists()) throw new Error("Item not found");
        let d = invSnap.data();
        let stock = parseFloat(d.currentStock) || 0;
        
        await updateDoc(invRef, { currentStock: stock - qty });
        await addDoc(collection(db, "stock_logs"), { branch: window.branchName, item: d.name, uom: d.uom || 'units', oldQty: stock, newQty: stock - qty, variance: -qty, type: "Waste / Spoilage", note: reason, user: window.staffName, timestamp: new Date() });
        
        // Send notice to Manager inbox
        await addDoc(collection(db, "staff_requests"), { type: "Waste Report", branch: window.branchName, staffName: window.staffName, items: [{name: d.name, qty: qty, reason: reason}], totalValueLost: qty * (d.baseCost || d.cost || 0), status: "Pending", timestamp: new Date() });

        Swal.fire({ title: 'Waste Logged!', text: `Deducted ${qty} ${d.uom} of ${d.name}`, icon: 'success', background: '#1e293b', color: '#fff', customClass: { popup: 'rounded-2xl' } });
        document.getElementById('wasteQty').value = '';
        document.getElementById('wasteItemSelect').value = '';
        loadAllInventory();
    } catch (e) {
        console.error(e);
        Swal.fire({ title: 'Error', text: 'Failed to log waste.', icon: 'error', background: '#1e293b', color: '#fff' });
    }
};
