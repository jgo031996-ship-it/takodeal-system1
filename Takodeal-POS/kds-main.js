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
window.ordersUnsubscribe = null;

// --- INITIALIZATION ---
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

async function fetchKDSBranches() {
    let drop = document.getElementById('kdsBranch');
    try {
        const snap = await getDocs(collection(db, "branches"));
        let html = '<option value="" disabled selected>-- Select Branch --</option>';
        snap.forEach(doc => { if (doc.data().name) html += `<option value="${doc.data().name}">${doc.data().name}</option>`; });
        drop.innerHTML = html;
    } catch(e) { drop.innerHTML = '<option>Error loading branches</option>'; }
}

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
// 🧾 1. LIVE ORDERS ENGINE
// ========================================================
function startOrdersListener() {
    let startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const q = query(collection(db, "transactions"), where("branch", "==", window.branchName), where("timestamp", ">=", startOfDay));
    
    window.ordersUnsubscribe = onSnapshot(q, (snap) => {
        let activeOrders = [];
        snap.forEach(docSnap => {
            let tx = docSnap.data();
            // Show Paid orders that the kitchen hasn't marked 'Completed' yet
            if (tx.status !== 'Voided' && tx.status !== 'Parked' && tx.kdsStatus !== 'Completed') {
                activeOrders.push({ id: docSnap.id, ...tx });
            }
        });
        
        activeOrders.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis()); // Oldest first
        
        let badge = document.getElementById('kdsOrderBadge');
        if (activeOrders.length > 0) {
            badge.innerText = activeOrders.length;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }

        renderOrders(activeOrders);
        playPingIfNew(activeOrders.length);
    });
}

let lastOrderCount = 0;
function playPingIfNew(currentCount) {
    if (currentCount > lastOrderCount) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'bell'; osc.frequency.setValueAtTime(880, ctx.currentTime); 
            gain.gain.setValueAtTime(1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start(); osc.stop(ctx.currentTime + 0.5);
        } catch(e) {}
    }
    lastOrderCount = currentCount;
}

function renderOrders(orders) {
    let container = document.getElementById('kdsOrdersContainer');
    if (orders.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 50px; font-size: 18px;">✅ Kitchen is Clear!</div>';
        return;
    }
    
    let html = '';
    orders.forEach(o => {
        let itemsHtml = (o.cart || []).map(i => {
            let addons = '';
            if (i.addons) {
                for (let key in i.addons) { if (i.addons[key].qty > 0) addons += `<div style="color: #0ea5e9; font-size: 12px; margin-left: 10px;">+ ${i.addons[key].qty}x ${key}</div>`; }
            }
            let notes = i.notes ? `<div style="color: #fca5a5; font-size: 12px; font-style: italic; margin-left: 10px;">✎ ${i.notes}</div>` : '';
            return `<div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;">
                <span style="color: #b91c1c; font-size: 16px;">${i.qty}x</span> <span style="color: #0f172a;">${i.name}</span>
                ${addons}${notes}
            </div>`;
        }).join('');

        let timeStr = o.timestamp ? o.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        let typeColor = o.orderType.toUpperCase().includes('DINE') ? '#16a34a' : '#d97706';

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
                <button onclick="window.markOrderDone('${o.id}')" style="background: #10b981; color: white; border: none; padding: 15px; font-size: 16px; font-weight: 900; cursor: pointer;">✅ Mark Done</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

window.markOrderDone = async function(docId) {
    try { await updateDoc(doc(db, "transactions", docId), { kdsStatus: "Completed" }); }
    catch(e) { console.error("Error marking done", e); }
};

// ========================================================
// 📦 2. UNIVERSAL INVENTORY FETCHER
// ========================================================
async function loadAllInventory() {
    try {
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
    let prepItems = window.kdsInventoryCache.filter(i => (i.category || "").toLowerCase().includes("prep") || (i.category || "").toLowerCase().includes("prepared"));
    
    let html = '';
    prepItems.forEach(d => {
        let bUom = d.uom || 'units'; let pUom = d.purchaseUom || d.purchUom || 'Batch';
        let imgCircle = d.image ? `<div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 10px auto; background-image: url('${d.image}'); background-size: cover; background-position: center; border: 2px solid #0ea5e9;"></div>` : `<div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 10px auto; background-color: #0f172a; border: 2px solid #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 26px;">🥣</div>`;
        html += `
            <div class="prep-card" onclick="window.addToPrep('${d.id}', '${d.name.replace(/'/g, "\\'")}', '${pUom}', '${bUom}')">
                ${imgCircle}
                <h3 style="margin: 0 0 5px 0; font-size: 13px; font-weight: 900; color: white;">${d.name}</h3>
                <span style="background: #0f172a; color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Shelf: ${(parseFloat(d.currentStock)||0).toFixed(1)} ${bUom}</span>
            </div>
        `;
    });
    grid.innerHTML = html;
}

window.addToPrep = async function(id, name, pUom, bUom) {
    const { value: qty } = await Swal.fire({ title: 'Log Batch', html: `<div style="color: white;">How many <b>${pUom}s</b> of <b>${name}</b>?</div>`, input: 'number', background: '#1e293b', color: '#fff', confirmButtonColor: '#0ea5e9' });
    if (!qty) return;
    let existing = window.kdsCart.find(i => i.id === id);
    if (existing) existing.purchQty += parseFloat(qty);
    else window.kdsCart.push({ id: id, name: name, purchQty: parseFloat(qty), purchUom: pUom, baseUom: bUom });
    renderPrepCart();
};

function renderPrepCart() {
    let c = document.getElementById('prepCart');
    if (window.kdsCart.length === 0) { c.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Cart empty.</div>'; return; }
    let html = '';
    window.kdsCart.forEach((item, index) => {
        html += `<div class="cart-item">
            <div><strong style="font-size: 14px; color: white;">${item.name}</strong><br><span style="color: var(--success); font-weight: 900; font-size: 14px;">+${item.purchQty} ${item.purchUom}</span></div>
            <button onclick="window.kdsCart.splice(${index}, 1); window.renderPrepCart();" style="background: #450a0a; color: #ef4444; border: 1px solid #7f1d1d; border-radius: 6px; padding: 6px 10px; font-weight: bold; cursor: pointer;">✖</button>
        </div>`;
    });
    c.innerHTML = html;
}
window.renderPrepCart = renderPrepCart;

window.submitKitchenPrep = async function() {
    if (window.kdsCart.length === 0) return;
    Swal.fire({ title: 'Logging...', background: '#1e293b', color: '#fff', didOpen: () => Swal.showLoading() });
    try {
        for (let item of window.kdsCart) {
            const invRef = doc(db, "inventory", item.id);
            const invSnap = await getDoc(invRef);
            if (!invSnap.exists()) continue;
            let d = invSnap.data();
            let cRate = parseFloat(d.conversionRate) || 1;
            let baseQty = item.purchQty * cRate;
            await updateDoc(invRef, { currentStock: (d.currentStock || 0) + baseQty });
            
            // Deduct BOM Raw Materials
            const bomQ = query(collection(db, "bom"), where("menuItem", "==", item.name));
            const bomSnap = await getDocs(bomQ);
            if (!bomSnap.empty) {
                for (let b of bomSnap.docs) {
                    let r = b.data();
                    let rawQ = query(collection(db, "inventory"), where("branch", "==", window.branchName), where("name", "==", r.ingredientName));
                    let rawSnap = await getDocs(rawQ);
                    if (!rawSnap.empty) await updateDoc(rawSnap.docs[0].ref, { currentStock: (rawSnap.docs[0].data().currentStock || 0) - (r.qty * item.purchQty) });
                }
            }
            await addDoc(collection(db, "stock_logs"), { branch: window.branchName, item: item.name, variance: baseQty, uom: item.baseUom, purchUom: item.purchUom, purchQty: item.purchQty, type: "KITCHEN KDS PREP", note: `Prepared by ${window.staffName}`, timestamp: serverTimestamp() });
        }
        Swal.fire({ title: 'Success!', icon: 'success', background: '#1e293b', color: '#fff' });
        window.kdsCart = []; renderPrepCart(); loadAllInventory();
    } catch (e) { Swal.fire({ title: 'Error', text: 'Failed to log.', icon: 'error', background: '#1e293b', color: '#fff' }); }
};

// ========================================================
// 🧹 4. CONSUMABLES ENGINE
// ========================================================
function buildConsumablesUI() {
    let grid = document.getElementById('consGrid');
    let consItems = window.kdsInventoryCache.filter(i => { let c = (i.category || "").toLowerCase(); return c.includes("consumable") || c.includes("cleaning") || c.includes("packaging"); });
    let html = '';
    consItems.forEach(d => {
        let bUom = d.uom || 'units';
        let imgCircle = d.image ? `<div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 10px auto; background-image: url('${d.image}'); background-size: cover; background-position: center; border: 2px solid #0ea5e9;"></div>` : `<div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 10px auto; background-color: #0f172a; border: 2px solid #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 26px;">📦</div>`;
        html += `
            <div class="prep-card" onclick="window.addToCons('${d.id}', '${d.name.replace(/'/g, "\\'")}', '${bUom}')">
                ${imgCircle}
                <h3 style="margin: 0 0 5px 0; font-size: 13px; font-weight: 900; color: white;">${d.name}</h3>
                <span style="background: #0f172a; color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Shelf: ${(parseFloat(d.currentStock)||0).toFixed(1)} ${bUom}</span>
            </div>
        `;
    });
    grid.innerHTML = html;
}

window.addToCons = async function(id, name, uom) {
    const { value: qty } = await Swal.fire({ title: 'Store Use', html: `<div style="color: white;">How many <b>${uom}</b> of <b>${name}</b> did you take?</div>`, input: 'number', background: '#1e293b', color: '#fff', confirmButtonColor: '#0ea5e9' });
    if (!qty) return;
    let existing = window.consCart.find(i => i.id === id);
    if (existing) existing.qty += parseFloat(qty);
    else window.consCart.push({ id: id, name: name, qty: parseFloat(qty), uom: uom });
    renderConsCart();
};

function renderConsCart() {
    let c = document.getElementById('consCart');
    if (window.consCart.length === 0) { c.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Cart empty.</div>'; return; }
    let html = '';
    window.consCart.forEach((item, index) => {
        html += `<div class="cart-item">
            <div><strong style="font-size: 14px; color: white;">${item.name}</strong><br><span style="color: var(--warning); font-weight: 900; font-size: 14px;">-${item.qty} ${item.uom}</span></div>
            <button onclick="window.consCart.splice(${index}, 1); window.renderConsCart();" style="background: #450a0a; color: #ef4444; border: 1px solid #7f1d1d; border-radius: 6px; padding: 6px 10px; font-weight: bold; cursor: pointer;">✖</button>
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
    let html = '<option value="">-- Choose Item --</option>';
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
        
        // Also send notice to Manager inbox
        await addDoc(collection(db, "staff_requests"), { type: "Waste Report", branch: window.branchName, staffName: window.staffName, items: [{name: d.name, qty: qty, reason: reason}], totalValueLost: qty * (d.baseCost || d.cost || 0), status: "Pending", timestamp: new Date() });

        Swal.fire({ title: 'Waste Logged!', text: `Deducted ${qty} ${d.uom} of ${d.name}`, icon: 'success', background: '#1e293b', color: '#fff' });
        document.getElementById('wasteQty').value = '';
        document.getElementById('wasteItemSelect').value = '';
        loadAllInventory();
    } catch (e) {
        console.error(e);
        Swal.fire({ title: 'Error', text: 'Failed to log waste.', icon: 'error', background: '#1e293b', color: '#fff' });
    }
};
