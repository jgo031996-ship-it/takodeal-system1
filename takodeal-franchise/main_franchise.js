// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS 
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, enableNetwork, disableNetwork } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4",
  authDomain: "takodeal-pos.firebaseapp.com",
  projectId: "takodeal-pos",
  storageBucket: "takodeal-pos.firebasestorage.app",
  messagingSenderId: "248826111383",
  appId: "1:248826111383:web:48bf1e2c172298079bd0d2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const storage = getStorage(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache(), experimentalAutoDetectLongPolling: true });

window.db = db; window.storage = storage;
window.auth = auth; window.provider = provider; 
window.query = query; window.where = where; window.collection = collection;
window.getDocs = getDocs; window.getDoc = getDoc; window.addDoc = addDoc;
window.updateDoc = updateDoc; window.deleteDoc = deleteDoc; window.doc = doc;
window.serverTimestamp = serverTimestamp; window.orderBy = orderBy; window.limit = limit;
window.enableNetwork = enableNetwork; 
window.disableNetwork = disableNetwork;

// =======================================================
// 🧠 GLOBAL RAM CACHE ENGINE
// =======================================================
window.TK_CACHE = {
    inventory: null,
    lastInventory: 0,
    ttl: 5 * 60 * 1000 // 5 Minute Memory (Perfect for Franchisees)
};

window.fetchCachedInventory = async function(branch) {
    let now = Date.now();
    if (window.TK_CACHE.inventory && (now - window.TK_CACHE.lastInventory < window.TK_CACHE.ttl)) {
        console.log(`📦 Loaded INVENTORY from RAM (0 Firebase Reads)`);
        return window.TK_CACHE.inventory;
    }
    console.log(`☁️ Fetching INVENTORY from Firebase...`);
    const snap = await window.getDocs(window.query(window.collection(window.db, "inventory"), window.where("branch", "==", branch)));
    let data = [];
    snap.forEach(doc => data.push({id: doc.id, ...doc.data()}));
    
    window.TK_CACHE.inventory = data;
    window.TK_CACHE.lastInventory = now;
    return data;
};

console.log("🚀 TAKODEÁL Franchisee Walled Garden ACTIVE!");

// --- HELPER: FORMAT CURRENCY ---
window.formatMoney = (amount) => '₱' + parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ========================================================
// 🧭 3. NAVIGATION & GLOBAL ROUTER
// ========================================================
window.switchView = function(viewId) {
    document.querySelectorAll('.nav-item, .nav-subitem').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
    
    let viewEl = document.getElementById('view-' + viewId);
    if (viewEl) viewEl.classList.add('active');
    
    // Highlight the sidebar item
    if (['payroll', 'schedule', 'inbox', 'sanctions'].includes(viewId)) {
        document.getElementById('nav-hr').classList.add('active');
    } else if (viewId.startsWith('inv-')) {
        document.getElementById('nav-inventory').classList.add('active');
    } else {
        let navEl = document.getElementById('nav-' + viewId);
        if (navEl) navEl.classList.add('active');
    }

    // Set Date Controls correctly
    let todayStr = new Date().toISOString().split('T')[0];
    let startEl = document.getElementById('globalStartDate');
    let endEl = document.getElementById('globalEndDate');
    if (!startEl.value) startEl.value = todayStr;
    if (!endEl.value) endEl.value = todayStr;

    // Trigger the engines
    if (viewId === 'dashboard') window.loadDashboard();
    if (viewId === 'accounts') window.loadAccountsView();
    if (viewId === 'hq-billing') window.loadHQBilling();
    if (viewId === 'b2b') window.loadB2BSupply();
    if (viewId === 'payroll') window.loadPayrollGenerator();
    if (viewId === 'history') window.loadSalesHistory();
    if (viewId === 'inv-overview') window.loadLiveInventory();
    if (viewId === 'inv-audits') window.loadInventoryAudits(); // 👈 ADD THIS
    if (viewId === 'inv-waste') window.loadInventoryWaste();   // 👈 ADD THIS
};

window.refreshActiveData = function() {
    // COST SAVER: Wipe RAM caches to force a fresh pull from Firebase
    if (window.TK_CACHE) window.TK_CACHE.lastInventory = 0;
    if (window.DASH_CACHE) window.DASH_CACHE.lastFetch = 0;
    
    let activeView = document.querySelector('.view-container.active');
    if (activeView) {
        let id = activeView.id.replace('view-', '');
        window.switchView(id);
    }
    
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Data Synced', showConfirmButton: false, timer: 1000});
};

window.logoutManager = function() {
    Swal.fire({
        title: 'Sign Out?',
        text: 'Are you sure you want to lock the portal?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: 'Yes, Sign Out'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await signOut(auth);
            window.location.reload();
        }
    });
};

// ========================================================
// 📊 MERGED DASHBOARD ENGINE (COST-OPTIMIZED CACHE)
// ========================================================
window.dashboardTrendChart = null;
window.dashboardPieChart = null;
window.DASH_CACHE = { data: null, lastFetch: 0, start: '', end: '', ttl: 5 * 60 * 1000 }; // 5 Minute Memory

window.loadDashboard = async function() {
    let startVal = document.getElementById('globalStartDate').value;
    let endVal = document.getElementById('globalEndDate').value;
    let startOfDay = new Date(startVal + 'T00:00:00');
    let endOfDay = new Date(endVal + 'T23:59:59');

    // 🔥 COST SAVER: Check RAM Cache First
    let now = Date.now();
    if (window.DASH_CACHE.data && window.DASH_CACHE.start === startVal && window.DASH_CACHE.end === endVal && (now - window.DASH_CACHE.lastFetch < window.DASH_CACHE.ttl)) {
        console.log("⚡ Loaded Dashboard from RAM (0 Firebase Reads)");
        window.applyDashboardUI(window.DASH_CACHE.data);
        return;
    }

    document.getElementById('dashTotalBalls').innerText = 'Loading...';
    document.getElementById('dashGrossSales').innerText = '...';

    try {
        let gross = 0, net = 0, totalBalls = 0;
        let productMix = {};
        let rollingTrend = {};
        
        for(let i=6; i>=0; i--) {
            let d = new Date(); d.setDate(d.getDate() - i);
            rollingTrend[d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})] = 0;
        }

        // 1. Fetch Transactions
        const txQuery = window.query(window.collection(window.db, "transactions"), 
            window.where("branch", "==", window.sessionUser.branch),
            window.where("timestamp", ">=", startOfDay),
            window.where("timestamp", "<=", endOfDay)
        );
        const txSnap = await window.getDocs(txQuery);
        
        txSnap.forEach(doc => {
            let tx = doc.data();
            if(tx.status !== 'Voided') {
                gross += parseFloat(tx.subtotal || tx.netTotal || 0);
                net += parseFloat(tx.netTotal || 0);
                
                let itemsList = tx.items || tx.cart || [];
                itemsList.forEach(item => {
                    let qty = parseFloat(item.qty || 1);
                    let name = item.name || item.itemName || 'Unknown';
                    
                    let ballsInItem = 0;
                    if (name.toLowerCase().includes('4pcs')) ballsInItem = 4 * qty;
                    else if (name.toLowerCase().includes('8pcs')) ballsInItem = 8 * qty;
                    else if (name.toLowerCase().includes('12pcs')) ballsInItem = 12 * qty;
                    else if (name.toLowerCase().includes('takoyaki')) ballsInItem = 4 * qty; 
                    totalBalls += ballsInItem;

                    if(!productMix[name]) productMix[name] = 0;
                    productMix[name] += qty;
                });
            }
        });

        // 2. Fetch 7-Day Trend (Aggregated from Closed Shifts to save reads)
        let sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0,0,0,0);
        let todayEnd = new Date(); todayEnd.setHours(23,59,59,999);

        const trendQuery = window.query(window.collection(window.db, "shifts"), 
            window.where("branch", "==", window.sessionUser.branch),
            window.where("startTime", ">=", sevenDaysAgo),
            window.where("startTime", "<=", todayEnd)
        );
        const trendSnap = await window.getDocs(trendQuery);
        
        trendSnap.forEach(docSnap => {
            let shift = docSnap.data();
            if (shift.startTime && shift.status === "Closed") {
                let d = shift.startTime.toDate ? shift.startTime.toDate() : new Date(shift.startTime);
                let dateStr = d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
                if (rollingTrend[dateStr] !== undefined && dateStr !== new Date().toLocaleDateString('en-US', {month: 'short', day: 'numeric'})) {
                    rollingTrend[dateStr] += (parseFloat(shift.totalCashSales) || 0) + (parseFloat(shift.totalDigitalSales) || 0);
                }
            }
        });
        
        // Inject today's live data
        rollingTrend[new Date().toLocaleDateString('en-US', {month: 'short', day: 'numeric'})] = gross;

        // 3. Fetch Expenses
        let expTotal = 0;
        const expQuery = window.query(window.collection(window.db, "expenses"), 
            window.where("branch", "==", window.sessionUser.branch),
            window.where("timestamp", ">=", startOfDay),
            window.where("timestamp", "<=", endOfDay)
        );
        const expSnap = await window.getDocs(expQuery);
        expSnap.forEach(doc => { expTotal += parseFloat(doc.data().amount || 0); });

        // 4. Save to RAM Cache
        window.DASH_CACHE = {
            data: { gross, net, totalBalls, expTotal, productMix, rollingTrend },
            lastFetch: Date.now(), start: startVal, end: endVal, ttl: window.DASH_CACHE.ttl
        };

        window.applyDashboardUI(window.DASH_CACHE.data);
        
        // 5. Fetch Live Staff (Not cached, since it needs to be live)
        const staffContainer = document.getElementById('dashLiveStaff');
        staffContainer.innerHTML = '';
        const staffQuery = window.query(window.collection(window.db, "shifts"), window.where("branch", "==", window.sessionUser.branch), window.where("active", "==", true));
        const staffSnap = await window.getDocs(staffQuery);
        
        if(staffSnap.empty) {
            staffContainer.innerHTML = '<div style="color: #94a3b8; font-style: italic; font-size: 13px;">No staff currently clocked in.</div>';
        } else {
            staffSnap.forEach(doc => {
                let s = doc.data();
                let timeStr = s.startTime ? s.startTime.toDate().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : '';
                staffContainer.innerHTML += `
                    <div style="display: flex; align-items: center; gap: 8px; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 15px; border-radius: 20px;">
                        <div style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981;"></div>
                        <span style="font-size: 13px; font-weight: 800; color: #166534;">${s.cashier || 'Active Staff'} (In @ ${timeStr})</span>
                    </div>`;
            });
        }
    } catch(e) { console.error("Dashboard Error:", e); }
};

window.applyDashboardUI = function(data) {
    document.getElementById('dashTotalBalls').innerText = data.totalBalls.toLocaleString() + ' Balls Sold!';
    document.getElementById('dashGrossSales').innerText = window.formatMoney(data.gross);
    document.getElementById('dashNetSales').innerText = window.formatMoney(data.net);
    document.getElementById('dashExpenses').innerText = window.formatMoney(data.expTotal);
    window.drawDashboardCharts(data.productMix, data.rollingTrend);
};

window.drawDashboardCharts = function(productMix, dailyTrend) {
    // ---- Sales Mix Donut Chart ----
    const pieCtx = document.getElementById('chartPie');
    if (pieCtx) {
        if (window.dashboardPieChart) window.dashboardPieChart.destroy();
        
        let labels = Object.keys(productMix);
        let data = Object.values(productMix);
        let colors = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#f43f5e'];
        
        window.dashboardPieChart = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: labels.length ? labels : ['No Data'],
                datasets: [{
                    data: data.length ? data : [1],
                    backgroundColor: data.length ? colors : ['#f1f5f9'],
                    borderWidth: 0, hoverOffset: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: {size: 11, weight: 'bold'} } } } }
        });
    }

    // ---- Gross Revenue Trend Chart ----
    const trendCtx = document.getElementById('chartTrend');
    if (trendCtx) {
        if (window.dashboardTrendChart) window.dashboardTrendChart.destroy();
        
        let gradient = trendCtx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

        let labels = Object.keys(dailyTrend);
        let data = Object.values(dailyTrend);
        if (labels.length === 0) { labels = ['No Data']; data = [0]; } // Fallback

        window.dashboardTrendChart = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Gross Sales', data: data, borderColor: '#3b82f6', backgroundColor: gradient, borderWidth: 3, tension: 0.4, fill: true, pointBackgroundColor: '#ffffff', pointBorderColor: '#3b82f6', pointBorderWidth: 2, pointRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5], color: '#f1f5f9' }, ticks: {font:{size:10}} }, x: { grid: { display: false }, ticks: {font:{size:10}} } } }
        });
    }
};

window.trendChartInst = null;
window.pieChartInst = null;

window.renderFranchiseCharts = function(dailyTrend, catSales) {
    if (window.trendChartInst) window.trendChartInst.destroy();
    if (window.pieChartInst) window.pieChartInst.destroy();

    const trendCtx = document.getElementById('chartTrend').getContext('2d');
    window.trendChartInst = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: Object.keys(dailyTrend),
            datasets: [{ label: 'Gross Sales', data: Object.values(dailyTrend), borderColor: '#0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.1)', borderWidth: 3, fill: true, tension: 0.4 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    const pieCtx = document.getElementById('chartPie').getContext('2d');
    let sortedCats = Object.keys(catSales).map(k => ({name: k, val: catSales[k]})).sort((a,b) => b.val - a.val).slice(0,5);
    
    window.pieChartInst = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: sortedCats.map(c => c.name),
            datasets: [{ data: sortedCats.map(c => c.val), backgroundColor: ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444'], borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right' } } }
    });
};

// ========================================================
// 💳 5. HQ BILLING & ROYALTIES
// ========================================================
window.loadHQBilling = async function() {
    const tbody = document.getElementById('hqLedgerBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 30px; color: #0ea5e9; font-weight:bold;">Calculating your ledger...</td></tr>';

    try {
        const q = query(collection(db, "franchise_ledger"), where("branch", "==", window.sessionUser.branch), orderBy("timestamp", "asc"));
        const snap = await getDocs(q);

        let runningBalance = 0; // Positive = Franchisee owes HQ
        let html = '';
        let logs = [];

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let amt = parseFloat(data.amount) || 0;
            
            if (data.type === 'Charge' || data.type === 'Debit') {
                runningBalance += amt;
            } else if (data.type === 'Payment' || data.type === 'Credit') {
                runningBalance -= amt;
            }
            logs.push({ ...data, runningBalance: runningBalance });
        });

        logs.reverse().forEach(log => {
            let dateStr = log.timestamp ? log.timestamp.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unknown';
            let chargeTxt = (log.type === 'Charge') ? `<span style="color:#dc2626; font-weight:bold;">₱${log.amount.toLocaleString()}</span>` : '-';
            let payTxt = (log.type === 'Payment') ? `<span style="color:#16a34a; font-weight:bold;">₱${log.amount.toLocaleString()}</span>` : '-';
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="color:#64748b;">${dateStr}</td>
                    <td><strong>${log.category}</strong><br><span style="font-size:11px; color:#64748b;">${log.description}</span></td>
                    <td style="text-align:right;">${chargeTxt}</td>
                    <td style="text-align:right;">${payTxt}</td>
                    <td style="text-align:right; font-weight:900; color:#334155;">₱${log.runningBalance.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align: center; padding: 30px; color:#64748b;">No billing history found.</td></tr>';
        
        let balColor = runningBalance > 0 ? '#dc2626' : (runningBalance < 0 ? '#16a34a' : '#334155');
        document.getElementById('hqTotalBalance').innerText = `₱${runningBalance.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('hqTotalBalance').style.color = balColor;

    } catch (e) {
        console.error("Ledger Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error loading ledger.</td></tr>';
    }
};

// ========================================================
// 📦 6. B2B SUPPLY ORDERS (SECURE BLIND ORDERING)
// ========================================================
window.b2bCart = [];
window.hqInventoryCache = [];

window.updateB2bUom = async function() {
    let itemName = document.getElementById('b2bSearch').value.trim();
    if (!itemName) return;

    // 🔥 THE SECRET RECIPE LOCK: Only fetch items HQ allows branches to see!
    if (window.hqInventoryCache.length === 0) {
        const q = query(
            collection(db, "inventory"), 
            where("branch", "==", "Main Office"),
            where("allowRequest", "==", true) // 👈 This filters out raw ingredients!
        );
        const snap = await getDocs(q);
        snap.forEach(d => window.hqInventoryCache.push(d.data()));
        
        let datalist = document.getElementById('b2bDatalist');
        let dlHtml = '';
        window.hqInventoryCache.forEach(i => dlHtml += `<option value="${i.name}">`);
        datalist.innerHTML = dlHtml;
    }

    let item = window.hqInventoryCache.find(i => i.name === itemName);
    if (item) {
        let uomDrop = document.getElementById('b2bUom');
        let bUom = item.uom || 'units';
        let pUom = item.purchaseUom || item.purchUom || 'Bulk';
        let conv = parseFloat(item.conversionRate) || 1;

        if (bUom.toLowerCase() !== pUom.toLowerCase() && conv !== 1) {
            uomDrop.innerHTML = `<option value="purch" data-conv="${conv}">${pUom}</option><option value="base" data-conv="1">${bUom}</option>`;
        } else {
            uomDrop.innerHTML = `<option value="base" data-conv="1">${bUom}</option>`;
        }
    }
};

window.addB2bToCart = function() {
    let itemName = document.getElementById('b2bSearch').value.trim();
    let rawQty = parseFloat(document.getElementById('b2bQty').value);
    
    if (!itemName || isNaN(rawQty) || rawQty <= 0) {
        return Swal.fire('Error', 'Please enter a valid item and quantity.', 'error');
    }

    let uomDrop = document.getElementById('b2bUom');
    let selOpt = uomDrop.options[uomDrop.selectedIndex];
    let convRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
    let displayUom = selOpt.text;
    
    let baseQty = rawQty * convRate;

    window.b2bCart.push({
        itemName: itemName, name: itemName, 
        rawQty: rawQty, displayQty: rawQty, 
        displayUom: displayUom,
        qty: baseQty,
        convRate: convRate,
        requestType: 'Franchise Restock Order'
    });

    document.getElementById('b2bSearch').value = '';
    document.getElementById('b2bQty').value = '';
    window.renderB2bCart();
};

window.renderB2bCart = function() {
    let list = document.getElementById('b2bCartList');
    if (window.b2bCart.length === 0) {
        list.innerHTML = 'Cart is empty.'; return;
    }

    let html = '';
    window.b2bCart.forEach((item, idx) => {
        html += `
            <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed #cbd5e1;">
                <strong>${item.name}</strong>
                <div style="display:flex; gap:10px; align-items:center;">
                    <span style="color:#0ea5e9; font-weight:bold;">${item.rawQty} ${item.displayUom}</span>
                    <button onclick="window.b2bCart.splice(${idx},1); window.renderB2bCart()" style="background:#fef2f2; color:#dc2626; border:1px solid #fca5a5; border-radius:4px; cursor:pointer;">✖</button>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
};

window.submitB2bRequest = async function() {
    if (window.b2bCart.length === 0) return Swal.fire('Empty', 'Add items to request first.', 'warning');
    
    Swal.fire({title: 'Sending to HQ...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        await addDoc(collection(db, "purchase_orders"), {
            branch: window.sessionUser.branch,
            items: window.b2bCart,
            status: "Pending",
            type: "Franchise Order",
            requestedBy: window.sessionUser.cashierName,
            timestamp: serverTimestamp()
        });

        window.b2bCart = [];
        window.renderB2bCart();
        Swal.fire('✅ Sent!', 'Order has been submitted to HQ Logistics.', 'success');
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to send request.', 'error');
    }
};

// ========================================================
// 🧑‍💼 7. HUMAN RESOURCES (PAYROLL & SANCTIONS)
// ========================================================
window.loadPayrollGenerator = async function() {
    const tbody = document.getElementById('payrollBody');
    if (!tbody) return;

    let startVal = document.getElementById('globalStartDate').value;
    let endVal = document.getElementById('globalEndDate').value;
    let startTimestamp = new Date(startVal + 'T00:00:00');
    let endTimestamp = new Date(endVal + 'T23:59:59');

    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:30px;">⏳ Calculating...</td></tr>';

    try {
        const staffSnap = await getDocs(query(collection(db, "cashiers"), where("branch", "==", window.sessionUser.branch)));
        let staffDict = {};
        staffSnap.forEach(d => staffDict[d.data().cashierName] = d.data());

        const shiftSnap = await getDocs(query(collection(db, "shifts"), where("branch", "==", window.sessionUser.branch), where("startTime", ">=", startTimestamp), where("startTime", "<=", endTimestamp)));
        
        let payrollData = {};

        shiftSnap.forEach(docSnap => {
            let shift = docSnap.data();
            if (!shift.endTime) return; 
            let name = shift.cashier;
            if (name.toLowerCase().startsWith("team ")) return;
            
            if (!payrollData[name]) payrollData[name] = { hours: 0, shiftsWorked: 0, deductions: 0 };

            let diffMs = shift.endTime.toDate() - shift.startTime.toDate();
            let hrs = diffMs / (1000 * 60 * 60);
            payrollData[name].hours += hrs;
            
            // If they worked more than an hour, count as a shift for base pay multiplication
            if (hrs > 1) payrollData[name].shiftsWorked += 1;
        });

        let html = '';
        for (let name in payrollData) {
            let p = payrollData[name];
            let rate = staffDict[name] ? (parseFloat(staffDict[name].hourlyRate) || 0) : 0;
            // Assumes Takodeal uses Daily Rate stored in hourlyRate field
            let gross = p.shiftsWorked * rate; 
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td><strong>👤 ${name}</strong></td>
                    <td style="color:#0ea5e9; font-weight:bold;">${p.hours.toFixed(1)} hrs</td>
                    <td style="color:#dc2626; font-weight:bold;">₱${p.deductions.toFixed(2)}</td>
                    <td><button style="background:#16a34a; color:white; border:none; padding:6px 12px; border-radius:6px; font-weight:bold;" onclick="Swal.fire('Payslip', 'Gross Pay: ₱${gross.toFixed(2)}', 'info')">View Details</button></td>
                </tr>
            `;
        }

        tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding:30px; color:#64748b;">No shifts logged in this period.</td></tr>';
    } catch(e) { console.error(e); }
};

// ========================================================
// 📈 8. SALES HISTORY ENGINE (HARD-CAPPED TO SAVE READS)
// ========================================================
window.loadSalesHistory = async function() {
    const tbody = document.getElementById('salesHistoryBody');
    if (!tbody) return; 
    
    let startVal = document.getElementById('globalStartDate').value;
    let endVal = document.getElementById('globalEndDate').value;
    let startOfDay = new Date(startVal + 'T00:00:00');
    let endOfDay = new Date(endVal + 'T23:59:59');

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">⏳ Loading history...</td></tr>';

    try {
        // 🔥 COST SAVER: Hard limit of 150 documents to prevent accidental massive queries
        const q = window.query(window.collection(window.db, "transactions"), 
            window.where("branch", "==", window.sessionUser.branch),
            window.where("timestamp", ">=", startOfDay),
            window.where("timestamp", "<=", endOfDay),
            window.limit(150) 
        );
        
        const snap = await window.getDocs(q);
        
        let docs = [];
        snap.forEach(d => docs.push({id: d.id, ...d.data()}));
        docs.sort((a, b) => b.timestamp - a.timestamp);

        let html = '';
        docs.forEach(tx => {
            let timeStr = tx.timestamp ? tx.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';
            let statusStyle = tx.status === 'Voided' ? 'color:#dc2626; text-decoration:line-through; background:#fef2f2;' : 'color:#334155;';
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; ${statusStyle}">
                    <td>${tx.receiptNumber || tx.id.substring(0,8)}</td>
                    <td>${timeStr}</td>
                    <td>${tx.cashier || 'Unknown'}</td>
                    <td>${tx.paymentMethod || 'Cash'}</td>
                    <td style="font-weight:bold; text-align:right;">₱${parseFloat(tx.netTotal || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
            `;
        });
        
        let warningRow = docs.length === 150 ? '<tr><td colspan="5" style="text-align:center; padding: 15px; background: #fffbeb; color: #d97706; font-weight: bold; font-size: 12px;">Showing latest 150 transactions for performance. Narrow your date range to see older records.</td></tr>' : '';
        tbody.innerHTML = html + warningRow || '<tr><td colspan="5" style="text-align:center; padding: 30px; color:#64748b;">No transactions found for this date range.</td></tr>';
    } catch (e) { console.error("History Error:", e); }
};

// ========================================================
// 📦 10. LIVE INVENTORY ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadLiveInventory = async function() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">⏳ Checking stock levels...</td></tr>';

    try {
        // 🔥 ZERO-COST CACHE ENGINE 🔥
        let items = await window.fetchCachedInventory(window.sessionUser.branch);
        let html = '';
        
        if (items.length === 0) {
            // AUTOMATIC ZERO: If HQ hasn't delivered anything yet, show this empty state.
            html = `
                <tr>
                    <td colspan="4" style="text-align:center; padding: 40px; color:#64748b;">
                        <div style="font-size: 40px; margin-bottom: 10px;">📦</div>
                        <h3 style="margin: 0; color: #1e293b;">Awaiting HQ Delivery</h3>
                        <p style="margin-top: 5px;">Your stock is currently zero. Please place a B2B order with HQ.</p>
                    </td>
                </tr>
            `;
        } else {
            // Render their actual stock if deliveries have arrived
            items.forEach(item => {
                let currentQty = parseFloat(item.quantity || item.currentStock || 0);
                let threshold = parseFloat(item.lowStockThreshold || item.reorderLevel || 10);
                
                // Turn text red if they are running low
                let isLow = currentQty <= threshold;
                let stockStyle = isLow ? 'color:#dc2626; font-weight:bold;' : 'color:#10b981; font-weight:bold;';
                let statusBadge = isLow ? '<span class="nav-badge" style="margin:0;">LOW STOCK</span>' : '<span style="background:#10b981; color:white; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:bold;">GOOD</span>';

                html += `
                    <tr>
                        <td style="font-weight: 600; color: #1e293b;">${item.itemName || item.name || 'Unknown Item'}</td>
                        <td>${item.category || 'Uncategorized'}</td>
                        <td><span style="${stockStyle}">${currentQty.toFixed(1)} ${item.unit || item.uom || 'pcs'}</span></td>
                        <td>${statusBadge}</td>
                    </tr>
                `;
            });
        }
        
        tbody.innerHTML = html;
    } catch (e) {
        console.error("Inventory Error:", e);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red; padding: 20px;">Failed to load inventory data.</td></tr>';
    }
};

// ========================================================
// 📦 9. B2B SUPPLY INITIALIZER & DELIVERY TRACKER
// ========================================================
window.loadB2BSupply = async function() {
    // 1. Reset the Request Cart
    window.b2bCart = [];
    if(typeof window.renderB2bCart === 'function') window.renderB2bCart();
    
    let searchBox = document.getElementById('b2bSearch');
    let qtyBox = document.getElementById('b2bQty');
    if (searchBox) searchBox.value = '';
    if (qtyBox) qtyBox.value = '';

    // 2. Fetch Incoming Deliveries from HQ DISPATCH LOGS!
    const container = document.getElementById('b2bDeliveriesContainer');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">⏳ Checking for deliveries from HQ...</div>';

    try {
        // 🔥 Listening to the Truck, not the Drafts!
        const q = query(collection(db, "dispatch_logs"), 
            where("toBranch", "==", window.sessionUser.branch),
            where("status", "in", ["In Transit", "Arrived"]),
            orderBy("timestamp", "desc")
        );
        
        const snap = await getDocs(q);
        if (snap.empty) {
            container.innerHTML = '<div style="text-align:center; padding:40px 20px; color:#64748b;"><div style="font-size: 30px; margin-bottom:10px;">📭</div>No incoming deliveries.</div>';
            return;
        }

        let dispatchGroups = {};
        snap.forEach(docSnap => {
            let d = docSnap.data();
            let docId = docSnap.id;
            let groupKey = d.dispatchId || `${d.date}_${d.driver}`;
            
            if (!dispatchGroups[groupKey]) {
                dispatchGroups[groupKey] = {
                    dispatchId: groupKey, date: d.date, time: d.time, driver: d.driver, status: d.status, items: []
                };
            }
            dispatchGroups[groupKey].items.push({ id: docId, ...d });
        });

        let html = '';
        for (let key in dispatchGroups) {
            let group = dispatchGroups[key];
            let s = group.status.toLowerCase();
            let statusBadge = '';
            let actionBtn = '';
            
            if (s === 'in transit') {
                statusBadge = `<span style="background:#dbeafe; color:#2563eb; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:900; letter-spacing: 0.5px;">🚚 IN TRANSIT</span>`;
                actionBtn = `<div style="font-size: 11px; color: #64748b; font-style: italic; margin-top: 10px; text-align: center;">Waiting for Driver to arrive...</div>`;
            } else if (s === 'arrived') {
                statusBadge = `<span style="background:#dcfce7; color:#16a34a; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:900; letter-spacing: 0.5px;">📍 ARRIVED AT BRANCH</span>`;
                let safeItems = encodeURIComponent(JSON.stringify(group.items));
                actionBtn = `<button onclick="window.receiveHQDelivery('${key}', '${safeItems}')" style="width: 100%; margin-top: 15px; background: #16a34a; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 6px rgba(22, 163, 74, 0.3); font-size: 14px; transition: 0.2s;">✅ Verify & Receive Stock</button>`;
            }

            let itemsHtml = '';
            group.items.forEach(item => {
                let qty = item.displayQty || item.qty;
                let uom = item.displayUom || item.uom || 'units';
                itemsHtml += `<div style="font-size:13px; color:#475569; margin-top:6px; padding-left: 10px; border-left: 2px solid #cbd5e1;"><strong>${qty} ${uom}</strong> - ${item.item}</div>`;
            });

            html += `
                <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 15px; background: #f8fafc; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; margin-bottom: 10px;">
                        <div style="font-size: 11px; font-weight: 900; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase;">DRIVER: ${group.driver}</div>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 13px; font-weight: bold; color: #1e293b; margin-bottom: 10px;">📅 Dispatched: ${group.date} @ ${group.time}</div>
                    ${itemsHtml}
                    ${actionBtn}
                </div>
            `;
        }
        container.innerHTML = html;
    } catch (e) {
        console.error("Delivery Load Error:", e);
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#dc2626; font-weight:bold;">Error loading deliveries. Check console.</div>';
    }
};

function drawDashboardCharts(productMix) {
    // ---- Sales Mix Donut Chart ----
    const pieCtx = document.getElementById('chartPie');
    if (pieCtx) {
        if (window.dashboardPieChart) window.dashboardPieChart.destroy();
        
        let labels = Object.keys(productMix);
        let data = Object.values(productMix);
        let colors = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#f43f5e'];
        
        window.dashboardPieChart = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: labels.length ? labels : ['No Data'],
                datasets: [{
                    data: data.length ? data : [1],
                    backgroundColor: data.length ? colors : ['#f1f5f9'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '70%',
                plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: {size: 11, weight: 'bold'} } } }
            }
        });
    }

    // ---- 7-Day Trend Chart (Visual Style Setup) ----
    const trendCtx = document.getElementById('chartTrend');
    if (trendCtx) {
        if (window.dashboardTrendChart) window.dashboardTrendChart.destroy();
        
        // Creating a smooth gradient fill for the chart area
        let gradient = trendCtx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

        window.dashboardTrendChart = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Today'],
                datasets: [{
                    label: 'Gross Sales',
                    data: [0, 0, 0, 0, 0, 0, 0], // Placeholder data until a 7-day query is active
                    borderColor: '#3b82f6',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    tension: 0.4, // Makes the line beautifully curved
                    fill: true,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#3b82f6',
                    pointBorderWidth: 2,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { borderDash: [5, 5], color: '#f1f5f9' }, ticks: {font:{size:10}} },
                    x: { grid: { display: false }, ticks: {font:{size:10}} }
                }
            }
        });
    }
}

// ========================================================
// 💰 ACCOUNTS & BUDGET ENGINE
// ========================================================
window.loadAccountsView = async function() {
    const accBody = document.getElementById('accTableBody');
    const budBody = document.getElementById('budgetListBody');
    
    accBody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px;">Loading accounts...</td></tr>';
    budBody.innerHTML = '<div style="text-align:center; color:#64748b; padding:20px;">Loading budgets...</div>';

    try {
        // 1. Fetch Cash Accounts
        const accQ = query(collection(db, "franchise_accounts"), where("branch", "==", window.sessionUser.branch));
        const accSnap = await getDocs(accQ);
        let accHtml = '';
        window.activeAccounts = []; // Stored for the expense dropdown

        if (accSnap.empty) {
            accHtml = '<tr><td colspan="2" style="text-align:center; color:#64748b; padding:20px;">No cash accounts set up yet.</td></tr>';
        } else {
            accSnap.forEach(docSnap => {
                let acc = docSnap.data();
                window.activeAccounts.push({ id: docSnap.id, name: acc.accountName, balance: acc.balance });
                accHtml += `
                    <tr>
                        <td><strong>${acc.accountName}</strong></td>
                        <td style="text-align: right; font-weight: bold; color: ${acc.balance >= 0 ? '#10b981' : '#ef4444'};">
                            ${window.formatMoney(acc.balance)}
                        </td>
                    </tr>
                `;
            });
        }
        accBody.innerHTML = accHtml;

        // 2. Fetch Expenses to Calculate Budget Usage
        let currentMonth = new Date().toISOString().slice(0, 7); // Gets YYYY-MM
        let startOfMonth = new Date(currentMonth + '-01T00:00:00');
        
        const expQ = query(collection(db, "expenses"), 
            where("branch", "==", window.sessionUser.branch),
            where("timestamp", ">=", startOfMonth)
        );
        const expSnap = await getDocs(expQ);
        
        let spentByCategory = {};
        expSnap.forEach(docSnap => {
            let exp = docSnap.data();
            let cat = exp.category || 'Uncategorized';
            if (!spentByCategory[cat]) spentByCategory[cat] = 0;
            spentByCategory[cat] += parseFloat(exp.amount || 0);
        });

        // 3. Fetch Budgets & Render Progress Bars
        const budQ = query(collection(db, "franchise_budgets"), where("branch", "==", window.sessionUser.branch));
        const budSnap = await getDocs(budQ);
        let budHtml = '';
        window.activeBudgetCategories = []; // Stored for the expense dropdown

        if (budSnap.empty) {
            budHtml = '<div style="text-align:center; color:#64748b; padding: 20px;">No budgets set up yet.</div>';
        } else {
            budSnap.forEach(docSnap => {
                let b = docSnap.data();
                window.activeBudgetCategories.push(b.category);
                
                let limit = parseFloat(b.limit || 0);
                let spent = spentByCategory[b.category] || 0;
                let percentage = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
                
                // Color changes to red if they hit 90% of their budget
                let barColor = percentage > 90 ? '#ef4444' : (percentage > 75 ? '#f59e0b' : '#10b981');

                budHtml += `
                    <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; background: #f8fafc;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <strong style="color: #1e293b;">${b.category}</strong>
                            <span style="font-size: 13px; font-weight: bold; color: #64748b;">${window.formatMoney(spent)} / ${window.formatMoney(limit)}</span>
                        </div>
                        <div style="width: 100%; background: #e2e8f0; border-radius: 4px; height: 8px; overflow: hidden;">
                            <div style="width: ${percentage}%; background: ${barColor}; height: 100%; transition: width 0.3s;"></div>
                        </div>
                    </div>
                `;
            });
        }
        budBody.innerHTML = budHtml;

    } catch (e) {
        console.error("Accounts Load Error:", e);
    }
};

// --- MODALS FOR ACCOUNTS & BUDGETS ---

window.openAddAccountModal = async function() {
    const { value: formValues } = await Swal.fire({
        title: 'Add Cash Account',
        html: `
            <input id="swal-acc-name" class="swal2-input" placeholder="Account Name (e.g., Petty Cash, BDO)">
            <input id="swal-acc-bal" type="number" step="0.01" class="swal2-input" placeholder="Initial Balance (₱)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#0ea5e9',
        confirmButtonText: 'Save Account',
        preConfirm: () => {
            let name = document.getElementById('swal-acc-name').value.trim();
            let bal = parseFloat(document.getElementById('swal-acc-bal').value);
            if (!name || isNaN(bal)) { Swal.showValidationMessage('Please enter a valid name and balance'); return false; }
            return { name, bal };
        }
    });

    if (formValues) {
        Swal.fire({title: 'Saving...', didOpen: () => Swal.showLoading()});
        try {
            await addDoc(collection(db, "franchise_accounts"), {
                branch: window.sessionUser.branch,
                accountName: formValues.name,
                balance: formValues.bal,
                timestamp: serverTimestamp()
            });
            Swal.fire('Saved!', 'Account has been created.', 'success');
            window.loadAccountsView();
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
    }
};

window.openAddBudgetModal = async function() {
    const { value: formValues } = await Swal.fire({
        title: 'Set Monthly Budget',
        html: `
            <input id="swal-bud-cat" class="swal2-input" placeholder="Category (e.g., Marketing, Utilities)">
            <input id="swal-bud-limit" type="number" step="0.01" class="swal2-input" placeholder="Monthly Limit (₱)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        confirmButtonText: 'Set Budget',
        preConfirm: () => {
            let cat = document.getElementById('swal-bud-cat').value.trim();
            let limit = parseFloat(document.getElementById('swal-bud-limit').value);
            if (!cat || isNaN(limit)) { Swal.showValidationMessage('Please enter a valid category and limit'); return false; }
            return { cat, limit };
        }
    });

    if (formValues) {
        Swal.fire({title: 'Saving...', didOpen: () => Swal.showLoading()});
        try {
            await addDoc(collection(db, "franchise_budgets"), {
                branch: window.sessionUser.branch,
                category: formValues.cat,
                limit: formValues.limit,
                timestamp: serverTimestamp()
            });
            Swal.fire('Saved!', 'Budget category added.', 'success');
            window.loadAccountsView();
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
    }
};

window.openLogExpenseModal = async function() {
    if (!window.activeAccounts || window.activeAccounts.length === 0) {
        return Swal.fire('Action Required', 'Please add a Cash Account first before logging an expense.', 'warning');
    }

    let accOptions = window.activeAccounts.map(a => `<option value="${a.id}" data-bal="${a.balance}">${a.name} (Bal: ₱${a.balance})</option>`).join('');
    let catOptions = (window.activeBudgetCategories && window.activeBudgetCategories.length > 0) 
        ? window.activeBudgetCategories.map(c => `<option value="${c}">${c}</option>`).join('')
        : `<option value="Uncategorized">Uncategorized</option>`;

    const { value: formValues } = await Swal.fire({
        title: 'Log Expense',
        html: `
            <select id="swal-exp-acc" class="swal2-select" style="width: 80%; font-size: 14px; margin-bottom: 10px;">${accOptions}</select>
            <select id="swal-exp-cat" class="swal2-select" style="width: 80%; font-size: 14px; margin-bottom: 10px;">${catOptions}</select>
            <input id="swal-exp-amt" type="number" step="0.01" class="swal2-input" placeholder="Amount (₱)" style="width: 80%;">
            <input id="swal-exp-desc" class="swal2-input" placeholder="Brief Description" style="width: 80%;">
        `,
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Log Expense',
        preConfirm: () => {
            let accSelect = document.getElementById('swal-exp-acc');
            let accountId = accSelect.value;
            let accountName = accSelect.options[accSelect.selectedIndex].text.split(' (')[0];
            let currentBal = parseFloat(accSelect.options[accSelect.selectedIndex].getAttribute('data-bal'));
            let category = document.getElementById('swal-exp-cat').value;
            let amount = parseFloat(document.getElementById('swal-exp-amt').value);
            let description = document.getElementById('swal-exp-desc').value.trim();

            if (isNaN(amount) || amount <= 0 || !description) {
                Swal.showValidationMessage('Please enter a valid amount and description.');
                return false;
            }
            return { accountId, accountName, currentBal, category, amount, description };
        }
    });

    if (formValues) {
        Swal.fire({title: 'Processing...', didOpen: () => Swal.showLoading()});
        try {
            // 1. Log the expense in the database
            await addDoc(collection(db, "expenses"), {
                branch: window.sessionUser.branch,
                accountName: formValues.accountName,
                category: formValues.category,
                amount: formValues.amount,
                description: formValues.description,
                timestamp: serverTimestamp()
            });

            // 2. Safely deduct the money from the chosen cash account
            let newBal = formValues.currentBal - formValues.amount;
            await updateDoc(doc(db, "franchise_accounts", formValues.accountId), {
                balance: newBal
            });

            Swal.fire('Success', 'Expense logged successfully!', 'success');
            window.loadAccountsView();
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
    }
};

// ========================================================
// ⚖️ INVENTORY AUDITS & WASTE ENGINE
// ========================================================

window.loadInventoryAudits = async function() {
    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px;">Loading audits...</td></tr>';
    
    try {
        const q = query(collection(db, "inventory_logs"), 
            where("branch", "==", window.sessionUser.branch), 
            where("type", "==", "Audit"), 
            orderBy("timestamp", "desc"), limit(50));
            
        const snap = await getDocs(q);
        let html = '';
        
        snap.forEach(docSnap => {
            let log = docSnap.data();
            let dateStr = log.timestamp ? log.timestamp.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'Just now';
            let varStyle = log.variance < 0 ? 'color: #dc2626; font-weight: bold;' : (log.variance > 0 ? 'color: #10b981; font-weight: bold;' : 'color: #64748b;');
            
            html += `
                <tr>
                    <td>${dateStr}</td>
                    <td><strong>${log.itemName}</strong></td>
                    <td>${log.systemQty} ${log.unit || ''}</td>
                    <td>${log.actualQty} ${log.unit || ''}</td>
                    <td style="${varStyle}">${log.variance > 0 ? '+' : ''}${log.variance}</td>
                    <td>${log.loggedBy}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding: 30px; color: #64748b;">No recent audits found.</td></tr>';
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: red;">Error loading audits.</td></tr>'; }
};

window.loadInventoryWaste = async function() {
    const tbody = document.getElementById('wasteTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">Loading waste logs...</td></tr>';
    
    try {
        const q = query(collection(db, "inventory_logs"), 
            where("branch", "==", window.sessionUser.branch), 
            where("type", "==", "Waste"), 
            orderBy("timestamp", "desc"), limit(50));
            
        const snap = await getDocs(q);
        let html = '';
        
        snap.forEach(docSnap => {
            let log = docSnap.data();
            let dateStr = log.timestamp ? log.timestamp.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'Just now';
            
            html += `
                <tr>
                    <td>${dateStr}</td>
                    <td><strong>${log.itemName}</strong></td>
                    <td style="color: #dc2626; font-weight: bold;">-${log.qtyWasted} ${log.unit || ''}</td>
                    <td><span style="background: #fef2f2; color: #b91c1c; padding: 4px 8px; border-radius: 6px; font-size: 12px;">${log.reason}</span></td>
                    <td>${log.loggedBy}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center; padding: 30px; color: #64748b;">No waste logged recently.</td></tr>';
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: red;">Error loading waste logs.</td></tr>'; }
};

// --- MODALS FOR AUDITS & WASTE ---

window.getBranchInventoryOptions = async function() {
    // 🔥 ZERO-COST CACHE ENGINE 🔥
    let items = await window.fetchCachedInventory(window.sessionUser.branch);
    let options = '';
    items.forEach(item => {
        let qty = item.quantity || item.currentStock || 0;
        let unit = item.unit || item.uom || 'pcs';
        options += `<option value="${item.id}" data-name="${item.itemName || item.name}" data-qty="${qty}" data-unit="${unit}">${item.itemName || item.name} (Current: ${parseFloat(qty).toFixed(1)} ${unit})</option>`;
    });
    return options;
};

window.openAuditModal = async function() {
    Swal.fire({title: 'Loading Items...', didOpen: () => Swal.showLoading()});
    let options = await window.getBranchInventoryOptions();
    if (!options) return Swal.fire('No Inventory', 'No active inventory items found for this branch.', 'info');

    const { value: formValues } = await Swal.fire({
        title: 'Perform Stock Audit',
        html: `
            <select id="swal-audit-item" class="swal2-select" style="width: 85%; font-size: 14px; margin-bottom: 15px;">${options}</select>
            <input id="swal-audit-qty" type="number" step="0.1" class="swal2-input" placeholder="Enter Actual Counted Qty" style="width: 85%;">
        `,
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        confirmButtonText: 'Save Audit',
        preConfirm: () => {
            let select = document.getElementById('swal-audit-item');
            let docId = select.value;
            let itemName = select.options[select.selectedIndex].getAttribute('data-name');
            let systemQty = parseFloat(select.options[select.selectedIndex].getAttribute('data-qty'));
            let unit = select.options[select.selectedIndex].getAttribute('data-unit');
            let actualQty = parseFloat(document.getElementById('swal-audit-qty').value);

            if (isNaN(actualQty) || actualQty < 0) { Swal.showValidationMessage('Enter a valid physical count.'); return false; }
            return { docId, itemName, systemQty, actualQty, unit, variance: actualQty - systemQty };
        }
    });

    if (formValues) {
        Swal.fire({title: 'Updating...', didOpen: () => Swal.showLoading()});
        try {
            await updateDoc(doc(db, "inventory", formValues.docId), { quantity: formValues.actualQty });
            await addDoc(collection(db, "inventory_logs"), {
                branch: window.sessionUser.branch,
                type: "Audit",
                itemName: formValues.itemName,
                systemQty: formValues.systemQty,
                actualQty: formValues.actualQty,
                variance: formValues.variance,
                unit: formValues.unit,
                loggedBy: window.sessionUser.cashierName,
                timestamp: serverTimestamp()
            });
            Swal.fire('Audit Complete', `Stock adjusted. Variance: ${formValues.variance > 0 ? '+' : ''}${formValues.variance}`, 'success');
            window.loadInventoryAudits();
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
    }
};

window.openWasteModal = async function() {
    Swal.fire({title: 'Loading Items...', didOpen: () => Swal.showLoading()});
    let options = await window.getBranchInventoryOptions();
    if (!options) return Swal.fire('No Inventory', 'No active inventory items found for this branch.', 'info');

    const { value: formValues } = await Swal.fire({
        title: 'Log Waste or Spoilage',
        html: `
            <select id="swal-waste-item" class="swal2-select" style="width: 85%; font-size: 14px; margin-bottom: 10px;">${options}</select>
            <input id="swal-waste-qty" type="number" step="0.1" class="swal2-input" placeholder="Qty Wasted" style="width: 85%; margin-bottom: 10px;">
            <input id="swal-waste-reason" class="swal2-input" placeholder="Reason (e.g., Dropped, Expired)" style="width: 85%;">
        `,
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Log Spoilage',
        preConfirm: () => {
            let select = document.getElementById('swal-waste-item');
            let docId = select.value;
            let itemName = select.options[select.selectedIndex].getAttribute('data-name');
            let systemQty = parseFloat(select.options[select.selectedIndex].getAttribute('data-qty'));
            let unit = select.options[select.selectedIndex].getAttribute('data-unit');
            let qtyWasted = parseFloat(document.getElementById('swal-waste-qty').value);
            let reason = document.getElementById('swal-waste-reason').value.trim();

            if (isNaN(qtyWasted) || qtyWasted <= 0 || !reason) { Swal.showValidationMessage('Enter a valid quantity and reason.'); return false; }
            if (qtyWasted > systemQty) { Swal.showValidationMessage(`Cannot waste more than current stock (${systemQty}).`); return false; }
            return { docId, itemName, systemQty, qtyWasted, reason, unit };
        }
    });

    if (formValues) {
        Swal.fire({title: 'Updating...', didOpen: () => Swal.showLoading()});
        try {
            await updateDoc(doc(db, "inventory", formValues.docId), { quantity: formValues.systemQty - formValues.qtyWasted });
            await addDoc(collection(db, "inventory_logs"), {
                branch: window.sessionUser.branch,
                type: "Waste",
                itemName: formValues.itemName,
                qtyWasted: formValues.qtyWasted,
                reason: formValues.reason,
                unit: formValues.unit,
                loggedBy: window.sessionUser.cashierName,
                timestamp: serverTimestamp()
            });
            Swal.fire('Logged', 'Spoilage recorded and stock deducted.', 'success');
            window.loadInventoryWaste();
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
    }
};

window.receiveHQDelivery = async function(groupKey, encodedItems) {
    let items = JSON.parse(decodeURIComponent(encodedItems));
    
    let confirm = await Swal.fire({
        title: 'Confirm Receipt?',
        text: 'This will add all these items directly to your live inventory.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#16a34a',
        confirmButtonText: 'Yes, I received them!'
    });

    if (!confirm.isConfirmed) return;

    Swal.fire({title: 'Updating Inventory...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        for (let item of items) {
            // 1. Tell HQ the truck was unloaded successfully
            await updateDoc(doc(db, "dispatch_logs", item.id), {
                status: "Received",
                receivedAt: serverTimestamp(),
                receivedBy: window.sessionUser.cashierName
            });

            // 2. Add the items into the Franchisee's Walled Garden
            let baseQtyToAdd = parseFloat(item.qty) || 0;
            let itemName = item.item || item.itemName;
            
            const invQ = query(collection(db, "inventory"), where("branch", "==", window.sessionUser.branch), where("name", "==", itemName));
            const invSnap = await getDocs(invQ);
            
            let oldStock = 0;
            let newStock = baseQtyToAdd;

            if (!invSnap.empty) {
                let docRef = invSnap.docs[0].ref;
                oldStock = parseFloat(invSnap.docs[0].data().currentStock || invSnap.docs[0].data().quantity || 0);
                
                // Wipe any ghost debt before adding new stock
                let baseStockMath = oldStock < 0 ? 0 : oldStock;
                newStock = baseStockMath + baseQtyToAdd;
                
                await updateDoc(docRef, { currentStock: newStock, quantity: newStock });
            } else {
                // If it's their very first time receiving this item, create a new shelf for it!
                await addDoc(collection(db, "inventory"), {
                    branch: window.sessionUser.branch,
                    name: itemName,
                    itemName: itemName,
                    currentStock: newStock,
                    quantity: newStock,
                    category: item.category || "Ingredients",
                    uom: item.baseUom || item.uom || 'units'
                });
            }

            // 3. Write a permanent log so the Franchisee can trace their history
            await addDoc(collection(db, "stock_logs"), {
                branch: window.sessionUser.branch,
                item: itemName,
                type: "HQ Delivery Received",
                oldQty: oldStock,
                newQty: newStock,
                variance: baseQtyToAdd,
                uom: item.baseUom || item.uom || 'units',
                user: window.sessionUser.cashierName,
                timestamp: serverTimestamp()
            });
        }

        Swal.fire({
            title: '✅ Success!', 
            text: 'Inventory has been successfully restocked.', 
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
        
        window.loadB2BSupply();
        if (typeof window.loadLiveInventory === 'function') window.loadLiveInventory();
        
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to receive delivery.', 'error');
    }
};

// =======================================================
// 🧟 ZOMBIE LISTENER KILLER (BATTERY & READ SAVER)
// =======================================================
document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
        console.log("🛑 Franchisee App hidden. Pausing network to save data and database reads...");
        try { if (window.disableNetwork && window.db) await window.disableNetwork(window.db); } catch(e) {}
    } else {
        console.log("🟢 Franchisee App visible. Waking up Firebase...");
        try { if (window.enableNetwork && window.db) await window.enableNetwork(window.db); } catch(e) {}
    }
});

// ==========================================
// 📢 HQ BULLETIN BOARD (FRANCHISEE LOCKED)
// ==========================================
window.hasAutoShownBulletin = false;

// 🔥 Hook into your router so it actually loads when clicked!
const originalSwitchView = window.switchView;
window.switchView = function(viewId) {
    if (typeof originalSwitchView === 'function') originalSwitchView(viewId);
    if (viewId === 'bulletin') window.loadAnnouncements();
};

window.loadAnnouncements = async function() {
    let container = document.getElementById('bulletinList');
    if (!container) return;

    try {
        let franchiseBranch = window.sessionUser.branch;
        let franchiseName = window.sessionUser.cashierName;

        const q = window.query(window.collection(window.db, "announcements"), window.where("active", "==", true));
        const snap = await window.getDocs(q);

        const ackQ = window.query(window.collection(window.db, "acknowledgments"), window.where("staffName", "==", franchiseName));
        const ackSnap = await window.getDocs(ackQ);

        let signatures = {};
        ackSnap.forEach(doc => { let d = doc.data(); signatures[d.announcementId] = d; });

        let announcementsArray = [];
        snap.forEach(docSnap => announcementsArray.push({id: docSnap.id, ...docSnap.data()}));
        announcementsArray.sort((a,b) => b.timestamp - a.timestamp); 

        let html = '';
        let unreadAnnouncements = [];

        announcementsArray.forEach(ann => {
            // 🔥 THE GATEKEEPER: Route specifically to this Franchisee
            let isTarget = false;
            if (!ann.targetType || ann.targetType === 'All') isTarget = true;
            else if (ann.targetType === 'Branch' && ann.targetBranch === franchiseBranch) isTarget = true;
            
            // Note: We skip 'Individual' here unless the Manager explicitly targeted the Franchise Owner's name.
            else if (ann.targetType === 'Individual' && ann.targetStaff === franchiseName) isTarget = true;

            if (!isTarget) return; 

            let dateStr = ann.timestamp ? ann.timestamp.toDate().toLocaleDateString() : 'Recent';
            let sigData = signatures[ann.id];
            let shortMsg = ann.message ? ann.message.substring(0, 100) + (ann.message.length > 100 ? '...' : '') : '';

            let statusBadge = sigData
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #bbf7d0;">✅ Acknowledged</span>`
                : `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #fecaca; animation: pulse 2s infinite;">❌ Requires Signature</span>`;

            let targetBadge = '';
            if (ann.targetType === 'Branch') targetBadge = `<span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; border: 1px solid #bae6fd; margin-top: 4px; display: inline-block;">🏢 Branch Notice</span>`;

            let sigDateStr = sigData && sigData.timestamp ? sigData.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';

            let safeData = encodeURIComponent(JSON.stringify({
                id: ann.id, title: ann.title || 'Announcement', subHeadline: ann.subHeadline || '',
                message: ann.message || '', footerMessage: ann.footerMessage || '', images: ann.images || [],
                dateStr: dateStr, hasSignature: !!sigData, signatureImg: sigData ? sigData.signature : '',
                signatureDate: sigDateStr
            }));

            if (!sigData) unreadAnnouncements.push(safeData);

            html += `
                <div onclick="window.viewAnnouncement('${safeData}')" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; cursor: pointer; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.02);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 6px rgba(0,0,0,0.05)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.02)'">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                        <h3 style="margin:0; color:#0f172a; font-size: 15px; flex: 1;">${ann.title}</h3>
                        <div style="margin-left: 10px; text-align: right;">${statusBadge}<br>${targetBadge}</div>
                    </div>
                    ${ann.subHeadline ? `<div style="font-size:12px; font-weight:bold; color:#0ea5e9; margin-bottom:6px;">${ann.subHeadline}</div>` : ''}
                    <div style="font-size:11px; color:#64748b; margin-bottom:10px;">📅 Published: ${dateStr}</div>
                    <p style="font-size:13px; color:#334155; margin:0 0 10px 0; line-height: 1.4;">${shortMsg}</p>
                </div>
            `;
        });
        
        container.innerHTML = html || '<div style="grid-column: 1 / -1; text-align:center; padding: 40px; color: #94a3b8;">No announcements from HQ.</div>';

        if (unreadAnnouncements.length > 0 && !window.hasAutoShownBulletin) {
            window.hasAutoShownBulletin = true;
            setTimeout(() => { window.viewAnnouncement(unreadAnnouncements[0]); }, 1000); 
        }
    } catch (e) { 
        console.error(e); 
        container.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding: 40px; color: #dc2626;">Error loading announcements.</div>';
    }
};

window.viewAnnouncement = function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    
    let imagesHtml = '';
    if (data.images && data.images.length > 0) {
        imagesHtml = `<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">`;
        data.images.forEach(img => {
            imagesHtml += `<img src="${img}" style="width: 100%; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">`;
        });
        imagesHtml += `</div>`;
    }

    let sigHtml = data.hasSignature 
        ? `<div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1; text-align: center; background: #f8fafc; border-radius: 8px; padding: 15px; border: 1px solid #bbf7d0;">
            <span style="font-size: 12px; color: #16a34a; font-weight: bold; display: block; margin-bottom: 10px;">✅ You acknowledged this on ${data.signatureDate}</span>
            <img src="${data.signatureImg}" style="height: 60px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px;">
           </div>`
        : `<div style="margin-top: 25px; padding: 20px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 12px;">
            <h4 style="margin: 0 0 5px 0; color: #b45309; text-align: center; font-size: 15px;">Mandatory Acknowledgment</h4>
            <p style="font-size: 11px; color: #92400e; text-align: center; margin-bottom: 15px;">Please sign your name below to confirm you have read this HQ memo.</p>
            <div style="background: white; border: 2px dashed #d97706; border-radius: 8px; overflow: hidden; touch-action: none; position: relative;">
                <canvas id="sigCanvas" width="300" height="150" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none;"></canvas>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <button onclick="const c = document.getElementById('sigCanvas'); c.getContext('2d').clearRect(0,0,c.width,c.height); window.isSignatureBlank = true;" style="flex: 1; background: white; color: #64748b; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">Clear</button>
                <button onclick="window.submitBulletinSignature('${data.id}')" id="btnSubmitSig" style="flex: 2; background: #0f766e; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">Submit Signature</button>
            </div>
           </div>`;

    Swal.fire({
        title: `<div style="text-align:left; font-size: 20px; font-weight: 900; color: #0f172a; text-transform: uppercase;">${data.title}</div>`,
        html: `<div style="text-align: left; max-height: 70vh; overflow-y: auto; padding-right: 5px;">
                <div style="font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 15px; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">📅 Published: ${data.dateStr}</div>
                ${data.subHeadline ? `<div style="font-size: 15px; font-weight: 900; color: #0ea5e9; margin-bottom: 15px;">${data.subHeadline}</div>` : ''}
                <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${data.message}</div>
                ${imagesHtml}
                ${sigHtml}
               </div>`,
        showCloseButton: true, showConfirmButton: false, allowOutsideClick: data.hasSignature,
        customClass: { popup: 'rounded-2xl p-4' },
        didOpen: () => {
            if (!data.hasSignature) {
                const canvas = document.getElementById('sigCanvas');
                const ctx = canvas.getContext('2d');
                ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
                let drawing = false; window.isSignatureBlank = true;
                const getPos = (e) => {
                    const rect = canvas.getBoundingClientRect();
                    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
                };
                const startDraw = (e) => { drawing = true; window.isSignatureBlank = false; ctx.beginPath(); ctx.moveTo(getPos(e).x, getPos(e).y); e.preventDefault(); };
                const draw = (e) => { if (!drawing) return; ctx.lineTo(getPos(e).x, getPos(e).y); ctx.stroke(); e.preventDefault(); };
                const stopDraw = () => { drawing = false; ctx.closePath(); };
                canvas.addEventListener('touchstart', startDraw, {passive: false}); canvas.addEventListener('touchmove', draw, {passive: false}); canvas.addEventListener('touchend', stopDraw);
                canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', draw); canvas.addEventListener('mouseup', stopDraw); canvas.addEventListener('mouseout', stopDraw);
            }
        }
    });
};

window.submitBulletinSignature = async function(announcementId) {
    if (window.isSignatureBlank) return Swal.showValidationMessage("Please draw your signature.");
    
    let btn = document.getElementById('btnSubmitSig');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        const canvas = document.getElementById('sigCanvas');
        await window.addDoc(window.collection(window.db, "acknowledgments"), {
            announcementId: announcementId,
            staffName: window.sessionUser.cashierName,
            signature: canvas.toDataURL("image/png"),
            timestamp: window.serverTimestamp()
        });
        Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Acknowledged.', showConfirmButton: false, timer: 2000});
        window.loadAnnouncements();
    } catch (e) {
        console.error(e); Swal.showValidationMessage("Failed to save signature."); btn.innerText = "Submit Signature"; btn.disabled = false;
    }
};

// ========================================================
// 📥 THE REQUEST INBOX ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadInbox = async function() {
    const pendingBody = document.getElementById('inboxTableBody');
    const resolvedBody = document.getElementById('resolvedRequestsBody');
    if (!pendingBody) return;

    pendingBody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px;">Loading requests...</td></tr>';

    try {
        // FRANCHISEE LOCK: Only pull requests for their specific branch!
        const q = window.query(window.collection(window.db, "staff_requests"), window.where("branch", "==", window.sessionUser.branch), window.orderBy("timestamp", "desc"));
        const snap = await window.getDocs(q);

        let pendingHtml = '';
        let pendingCount = 0;
        let resolvedByStaff = {}; 

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Unknown';
            let safeName = d.staffName ? d.staffName.replace(/'/g, "\\'") : 'Unknown';

            let detailsStr = "";
            if (d.type === "Leave") {
                detailsStr = `<strong style="color: #1e293b;">${d.leaveType || 'Leave'}</strong><br><span style="font-size:11px; font-weight:bold; color:#0ea5e9;">${d.startDate || '?'} to ${d.endDate || '?'}</span><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.reason || 'No reason'}"</span>`;
            } else if (d.type === "Cash Advance") {
                detailsStr = `<strong style="color:#dc2626; font-size:15px;">₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</strong><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.reason || 'No reason'}"</span>`;
            } else if (d.type === "Reason Letter") {
                detailsStr = `<strong style="color: #1e293b;">Cause: ${d.explanationCause || 'Variance'}</strong><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.explanationMessage || 'No explanation'}"</span>`;
            } else if (d.type.includes("Meal")) {
                let itemsList = d.item ? d.item.replace(/ \| /g, '<br><span style="color:#64748b; font-size:11px; font-family:monospace;">') + '</span>' : 'Food Item';
                detailsStr = `🍔 ${itemsList}<br><span style="color:#dc2626; font-size:12px; font-weight:900;">Deduct: ₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>`;
            } else {
                detailsStr = d.amount ? `₱${d.amount.toLocaleString(undefined, {minimumFractionDigits:2})}` : (d.item || d.reason || 'N/A');
            }

            let attachedImage = d.photoBase64 || d.proofImageUrl || d.imageUrl || d.image;
            if (attachedImage) {
                detailsStr += `<br><button onclick="Swal.fire({imageUrl: '${attachedImage}', imageAlt: 'Proof', width: 'auto', customClass: {popup: 'rounded-2xl'}})" style="margin-top: 8px; background: #f0f9ff; border: 1px solid #bae6fd; color: #0284c7; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">📷 View Photo</button>`;
            }

            if (d.status === "Pending") {
                pendingCount++;
                pendingHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 12px; color: #64748b;">${dateStr}</td>
                        <td style="padding: 12px; font-weight: bold; color: #334155;">${safeName}</td>
                        <td style="padding: 12px;"><span style="font-weight: bold; color: #0ea5e9; font-size: 14px;">${d.type}</span></td>
                        <td style="padding: 12px; max-width: 250px; white-space: normal;">${detailsStr}</td>
                        <td style="padding: 12px; text-align: right;">
                            <button onclick="window.handleRequest('${docSnap.id}', 'Approved', '${d.type}', ${d.amount || 0}, '${safeName}')" style="background: #16a34a; color: white; padding: 6px 12px; border:none; border-radius:4px; margin-right:5px; cursor:pointer; font-weight:bold;">Approve</button>
                            <button onclick="window.handleRequest('${docSnap.id}', 'Rejected', '${d.type}', ${d.amount || 0}, '${safeName}')" style="background: #ef4444; color: white; padding: 6px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Reject</button>
                        </td>
                    </tr>
                `;
            } else {
                if (!resolvedByStaff[safeName]) resolvedByStaff[safeName] = [];
                d.dateStr = dateStr; d.detailsStr = detailsStr;
                resolvedByStaff[safeName].push(d);
            }
        });

        let resolvedHtml = '';
        for (let staff in resolvedByStaff) {
            let reqs = resolvedByStaff[staff];
            let safeStaffId = staff.replace(/[^a-zA-Z0-9]/g, ''); 
            
            resolvedHtml += `
                <tr style="background: #f8fafc; cursor: pointer; border-bottom: 1px solid #e2e8f0;" onclick="document.querySelectorAll('.res-row-${safeStaffId}').forEach(r => r.style.display = r.style.display === 'none' ? 'table-row' : 'none')">
                    <td colspan="4" style="font-weight: 900; color: #334155; font-size: 15px; padding: 15px;">
                        <span style="display:inline-block; width:20px; color:#94a3b8;">▼</span> 👤 ${staff}
                    </td>
                    <td style="text-align: right; padding: 15px;">
                        <span style="font-size: 11px; color: white; background: #0ea5e9; padding: 4px 10px; border-radius: 12px; font-weight: bold;">🔍 ${reqs.length} Records</span>
                    </td>
                </tr>
            `;
            
            reqs.forEach(d => {
                let statusColor = d.status === "Approved" ? "#16a34a" : "#dc2626";
                let statusBg = d.status === "Approved" ? "#dcfce7" : "#fef2f2";
                resolvedHtml += `
                    <tr class="res-row-${safeStaffId}" style="display: none; background: white; border-bottom: 1px dashed #cbd5e1;">
                        <td style="padding: 12px; padding-left: 35px; color: #64748b;">${d.dateStr}</td>
                        <td style="padding: 12px; font-weight: bold; color: #0ea5e9;">${d.type}</td>
                        <td colspan="2" style="padding: 12px; max-width: 250px; white-space: normal;">${d.detailsStr}</td>
                        <td style="padding: 12px; text-align:right;"><span style="background: ${statusBg}; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${d.status}</span></td>
                    </tr>
                `;
            });
        }

        pendingBody.innerHTML = pendingHtml || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #16a34a; font-weight: bold;">No pending requests! 🎉</td></tr>';
        if (resolvedBody) resolvedBody.innerHTML = resolvedHtml || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #64748b;">No resolved history yet.</td></tr>';

        let badge = document.getElementById('inboxBadge');
        if (badge) {
            badge.innerText = pendingCount;
            badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }
    } catch(e) { console.error(e); pendingBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Error loading inbox.</td></tr>'; }
};

window.handleRequest = async function(docId, action, type, amount, staffName) {
    let reason = prompt(`Optional: Enter a message to ${staffName} regarding this decision:`);
    if (reason === null) return; // Cancelled

    Swal.fire({title: 'Processing...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        await window.updateDoc(window.doc(window.db, "staff_requests", docId), {
            status: action,
            managerReply: reason || '',
            processedAt: window.serverTimestamp(),
            processedBy: window.sessionUser.cashierName
        });

        if (action === "Approved" && (type === "Cash Advance" || type.includes("Meal"))) {
            await window.addDoc(window.collection(window.db, "staff_deductions"), {
                staffName: staffName,
                type: type,
                amount: amount,
                dateAdded: window.serverTimestamp(),
                status: "Unpaid" 
            });
        }

        Swal.fire('✅ Processed', `Request has been ${action}.`, 'success');
        window.loadInbox();
    } catch (e) { console.error(e); Swal.fire('Error', 'Failed to process.', 'error'); }
};

window.loadSanctionsDashboard = async function() {
    const tbody = document.getElementById('sanctionsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px;">Loading disciplinary records...</td></tr>';

    try {
        const q = window.query(window.collection(window.db, "hr_sanctions"), window.where("branch", "==", window.sessionUser.branch), window.orderBy("timestamp", "desc"));
        const snap = await window.getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
            let statusBadge = ''; let actionBtn = '';

            if (d.status === 'Pending Reply') {
                statusBadge = `<span style="background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Awaiting Staff Reply</span>`;
                actionBtn = `<button onclick="window.deleteSanction('${docSnap.id}')" style="background: white; color: #dc2626; border: 1px solid #fecaca; padding: 4px 8px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">🗑️ Cancel Notice</button>`;
            } else if (d.status === 'Replied' || d.status === 'Resolved') {
                statusBadge = `<span style="background: ${d.status === 'Resolved' ? '#dcfce7' : '#e0f2fe'}; color: ${d.status === 'Resolved' ? '#16a34a' : '#0284c7'}; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${d.status === 'Resolved' ? '✅ Resolved' : '📩 Staff Replied'}</span>
                               <div style="font-size: 11px; color: #334155; font-style: italic; border-left: 2px solid ${d.status === 'Resolved' ? '#16a34a' : '#0ea5e9'}; padding-left: 8px; margin-top: 4px; max-width: 250px;">"${d.staffReply}"</div>`;
                
                if (d.status === 'Replied') {
                    actionBtn = `<button onclick="window.resolveSanction('${docSnap.id}', '${d.staffName}')" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">Accept & Resolve</button>`;
                } else {
                    let safeDocStr = encodeURIComponent(JSON.stringify({id: docSnap.id, ...d}));
                    actionBtn = `<button onclick="window.printFormalNTE('${safeDocStr}')" style="background: #f8fafc; color: #0f172a; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">📄 Print Record</button>`;
                }
            }

            let severityColor = d.severity.includes('Warning') ? '#ea580c' : '#dc2626';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; color: #64748b; font-size: 12px;">${dateStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #0f172a;">👤 ${d.staffName}</td>
                    <td style="padding: 12px;"><strong style="color: #334155;">${d.type}</strong><br><span style="font-size: 11px; color: #64748b; font-style: italic;">"${d.details}"</span></td>
                    <td style="padding: 12px;"><strong style="color: ${severityColor};">${d.severity}</strong></td>
                    <td style="padding: 12px;">${statusBadge}</td>
                    <td style="padding: 12px; text-align: right;">${actionBtn}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #64748b;">No disciplinary records found.</td></tr>';
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading data.</td></tr>'; }
};

window.openIssueSanctionModal = async function() {
    document.getElementById('issueSanctionModal').style.display = 'flex';
    document.getElementById('sanctionDetails').value = '';
    
    let select = document.getElementById('sanctionStaffSelect');
    select.innerHTML = '<option value="">Loading staff...</option>';
    
    try {
        const snap = await window.getDocs(window.query(window.collection(window.db, "cashiers"), window.where("branch", "==", window.sessionUser.branch)));
        let html = '<option value="">-- Select Staff Member --</option>';
        let staffList = [];
        
        snap.forEach(doc => {
            if (doc.data().status !== 'Resigned') staffList.push(doc.data().cashierName);
        });
        
        staffList.sort().forEach(s => html += `<option value="${s}">${s}</option>`);
        select.innerHTML = html;
    } catch (e) { console.error(e); select.innerHTML = '<option value="">Error loading staff.</option>'; }
};

window.generateAiNteLetter = function() {
    let staffName = document.getElementById('sanctionStaffSelect').value;
    let incidentType = document.getElementById('sanctionType').value;
    let severity = document.getElementById('sanctionSeverity').value;
    let detailsArea = document.getElementById('sanctionDetails');
    let roughDetails = detailsArea.value.trim();

    if (!staffName || !roughDetails) return Swal.fire('Wait', 'Select a staff member and type a short description first.', 'warning');

    let dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    
    let formalLetter = `Subject: Violation of Store Policies\n\nDear ${staffName},\n\nThis letter serves as a formal notice regarding a non-compliance issue observed on ${dateStr}.\n\nINCIDENT SUMMARY:\n${roughDetails}\n\nSEVERITY LEVEL & RESOLUTION:\nThis incident has been recorded as a: ${severity}. We have discussed the critical importance of maintaining strict compliance with store protocols. You are expected to correct this behavior immediately.\n\nPlease be reminded that strict adherence to our policies is essential to ensuring quality operations. Future non-compliance may result in further disciplinary action.\n\nSincerely,\n${window.sessionUser.cashierName}\nManagement, ${window.sessionUser.branch}`;

    detailsArea.value = formalLetter;
    detailsArea.style.height = '250px';
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Letter drafted!', showConfirmButton: false, timer: 1500});
};

window.submitNewSanction = async function() {
    let staffName = document.getElementById('sanctionStaffSelect').value;
    let type = document.getElementById('sanctionType').value;
    let severity = document.getElementById('sanctionSeverity').value;
    let details = document.getElementById('sanctionDetails').value.trim();

    if (!staffName || !details) return Swal.fire('Missing Data', 'Please fill out all fields.', 'warning');

    let btn = document.getElementById('btnSaveSanction');
    btn.innerText = "⏳ Issuing..."; btn.disabled = true;

    try {
        await window.addDoc(window.collection(window.db, "hr_sanctions"), {
            staffName: staffName,
            branch: window.sessionUser.branch,
            type: type,
            severity: severity,
            details: details,
            status: "Pending Reply", 
            issuedBy: window.sessionUser.cashierName,
            timestamp: window.serverTimestamp()
        });

        Swal.fire('✅ Success!', `Notice issued to ${staffName}. Their POS is locked until they reply.`, 'success');
        document.getElementById('issueSanctionModal').style.display = 'none';
        window.loadSanctionsDashboard();
    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to issue notice.', 'error');
    } finally { btn.innerText = "🚀 Issue Digital Notice"; btn.disabled = false; }
};

window.resolveSanction = async function(docId, staffName) {
    if (!confirm(`Mark this issue as resolved for ${staffName}?`)) return;
    try {
        await window.updateDoc(window.doc(window.db, "hr_sanctions", docId), { status: "Resolved", resolvedAt: window.serverTimestamp() });
        window.loadSanctionsDashboard();
    } catch (e) { alert("Failed to resolve."); }
};

window.deleteSanction = async function(docId) {
    if (!confirm(`Cancel and delete this notice?`)) return;
    try {
        await window.deleteDoc(window.doc(window.db, "hr_sanctions", docId));
        window.loadSanctionsDashboard();
    } catch (e) { alert("Failed to delete."); }
};

window.printFormalNTE = function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    let issueDate = d.timestamp ? new Date(d.timestamp.seconds * 1000).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown Date';
    let safeDetails = d.details ? d.details.replace(/\n/g, '<br>') : 'No details provided.';
    let safeReply = d.staffReply ? d.staffReply.replace(/\n/g, '<br>') : 'No reply provided.';

    let printWindow = window.open('', '', 'width=800,height=900');
    let html = `
        <html><head><title>Official Record - ${d.staffName}</title>
        <style>body { font-family: 'Times New Roman', serif; margin: 40px; color: #000; line-height: 1.6; } .box { border: 1px solid #000; padding: 15px; margin-bottom: 25px; min-height: 80px; } @media print { button { display: none; } }</style>
        </head><body>
            <h2 style="text-align: center;">OFFICIAL DISCIPLINARY RECORD</h2>
            <p><b>Date:</b> ${issueDate}<br><b>To:</b> ${d.staffName}<br><b>Violation:</b> ${d.type}<br><b>Severity:</b> ${d.severity}</p>
            <p><b>I. INCIDENT REPORT</b></p><div class="box">${safeDetails}</div>
            <p><b>II. EMPLOYEE EXPLANATION</b></p><div class="box">${safeReply}</div>
            <div style="margin-top: 40px;">
                <img src="${d.signatureBase64 || ''}" style="height: 60px; display: block; margin-bottom: -10px;">
                <div style="border-top: 1px solid #000; width: 200px; padding-top: 5px; font-weight: bold;">${d.staffName} (Employee Signature)</div>
            </div>
            <script>window.onload = function() { setTimeout(function(){ window.print(); }, 500); }</script>
        </body></html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
};

window.currentSchedule = {};
window.branchConfig = {};
window.employees = [];

window.loadScheduleFromCloud = async function() {
    let monthInput = document.getElementById("scheduleMonthSelector").value;
    if (!monthInput) {
        let today = new Date();
        monthInput = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById("scheduleMonthSelector").value = monthInput;
    }
    
    let [year, month] = monthInput.split('-').map(Number);
    window.currentYear = year;
    window.currentMonth = month;
    let daysInMonth = new Date(year, month, 0).getDate();

    try {
        const staffSnap = await window.getDocs(window.query(window.collection(window.db, "cashiers"), window.where("branch", "==", window.sessionUser.branch)));
        window.employees = [];
        staffSnap.forEach(d => {
            if (d.data().status !== 'Resigned') {
                window.employees.push({ name: d.data().scheduleNickname || d.data().cashierName, fullName: d.data().cashierName, branch: d.data().branch });
            }
        });

        const schedSnap = await window.getDoc(window.doc(window.db, "settings", "global_schedule"));
        
        if (schedSnap.exists()) {
            let appData = schedSnap.data();
            
            window.branchConfig = appData.branchConfig && appData.branchConfig[window.sessionUser.branch] 
                ? appData.branchConfig[window.sessionUser.branch] 
                : [
                    { id: 'm1', name: 'Morning', active: true, days: [0,1,2,3,4,5,6], startTime: '09:00', endTime: '18:00' },
                    { id: 'n1', name: 'Night', active: true, days: [0,1,2,3,4,5,6], startTime: '18:00', endTime: '03:00' }
                  ];

            if (appData.currentYear === year && appData.currentMonth === month && appData.currentSchedule) {
                window.currentSchedule = appData.currentSchedule;
            } else {
                window.currentSchedule = {};
            }
        }

        for (let day = 1; day <= daysInMonth; day++) {
            if (!window.currentSchedule[day]) window.currentSchedule[day] = {};
            if (!window.currentSchedule[day][window.sessionUser.branch]) {
                window.currentSchedule[day][window.sessionUser.branch] = { scheduled: {}, rest: [], unavailable: [], swaps: {} };
                
                window.branchConfig.filter(s => s.active).forEach(shift => {
                    window.currentSchedule[day][window.sessionUser.branch].scheduled[shift.id] = "UNFILLED";
                });
                window.currentSchedule[day][window.sessionUser.branch].rest = window.employees.map(e => e.name);
            }
        }

        window.renderScheduleUI();

    } catch(e) { console.error("Schedule Load Error:", e); }
};

window.renderScheduleUI = function() {
    const container = document.getElementById("franchiseScheduleContainer");
    if(!container) return;

    let branch = window.sessionUser.branch;
    let daysInMonth = new Date(window.currentYear, window.currentMonth, 0).getDate();
    let activeShifts = window.branchConfig.filter(s => s.active);

    let html = `<table class="data-table" style="width: 100%; border-collapse: collapse; text-align: left;">
                  <thead style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                    <tr><th style="padding: 12px; font-size: 11px; color: #475569; text-transform: uppercase;">Date</th>`;
    
    activeShifts.forEach(s => html += `<th style="padding: 12px; font-size: 11px; color: #475569; text-transform: uppercase; text-align: center;">${s.name}</th>`);
    html += `<th style="padding: 12px; font-size: 11px; color: #d97706; text-transform: uppercase; background: #fffbeb; text-align: center;">Standby / Off</th></tr></thead><tbody>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const dStr = new Date(window.currentYear, window.currentMonth - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        html += `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 12px; font-weight: bold; color: #334155; white-space: nowrap;">${dStr}</td>`;

        let dayData = window.currentSchedule[day][branch] || { scheduled: {}, rest: [] };

        activeShifts.forEach(s => {
            let val = dayData.scheduled[s.id] || "UNFILLED";
            let cellHtml = val === "UNFILLED" || val === "N/A"
                ? `<span onclick="window.openSwapModal(${day}, '${s.id}')" style="color: #ef4444; background: #fef2f2; border: 1px dashed #fca5a5; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; cursor: pointer;">Needs Staff</span>`
                : `<span onclick="window.openSwapModal(${day}, '${s.id}')" style="color: #0ea5e9; background: #e0f2fe; border: 1px solid #bae6fd; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; cursor: pointer;">${val}</span>`;
            
            html += `<td style="padding: 12px; text-align: center;">${cellHtml}</td>`;
        });

        let restHtml = (dayData.rest || []).map(r => `<span style="color: #d97706; font-size: 11px; font-weight: bold; background: #fffbeb; border: 1px solid #fcd34d; padding: 2px 6px; border-radius: 4px; margin: 2px; display: inline-block;">${r}</span>`).join('');
        html += `<td style="padding: 12px; text-align: center;">${restHtml || '-'}</td></tr>`;
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
};

window.openSwapModal = function(day, shiftId) {
    let branch = window.sessionUser.branch;
    let dayData = window.currentSchedule[day][branch];
    let curStaff = dayData.scheduled[shiftId];
    window.swapData = { day, shiftId, curStaff }; 

    let optionsHtml = '<option value="">-- Choose Staff --</option>';
    
    optionsHtml += '<optgroup label="🔄 Swap with Scheduled Staff">';
    for (let sId in dayData.scheduled) {
        if (sId !== shiftId && dayData.scheduled[sId] !== "UNFILLED" && dayData.scheduled[sId] !== "N/A") {
            let shiftName = window.branchConfig.find(s => s.id === sId)?.name || sId;
            optionsHtml += `<option value="shift_${sId}">${dayData.scheduled[sId]} (from ${shiftName})</option>`;
        }
    }
    optionsHtml += '</optgroup>';

    if (dayData.rest && dayData.rest.length > 0) {
        optionsHtml += '<optgroup label="☕ Assign from Standby">';
        dayData.rest.forEach((rStaff, index) => {
            optionsHtml += `<option value="rest_${index}">${rStaff}</option>`;
        });
        optionsHtml += '</optgroup>';
    }

    let displayCurrent = curStaff === "UNFILLED" ? "No one assigned yet" : curStaff;

    document.getElementById('swapMessage').innerText = `Currently Assigned: ${displayCurrent}`;
    document.getElementById('swapTarget').innerHTML = optionsHtml;
    document.getElementById('swapModal').style.display = 'flex';
};

window.executeSwap = function() {
    let target = document.getElementById('swapTarget').value;
    if (!target) return alert("Please select a staff member.");

    const { day, shiftId, curStaff } = window.swapData; 
    let branch = window.sessionUser.branch;
    let dayData = window.currentSchedule[day][branch];

    if (target.startsWith('shift_')) {
        const tSId = target.replace('shift_', '');
        let newStaff = dayData.scheduled[tSId];
        dayData.scheduled[shiftId] = newStaff;
        dayData.scheduled[tSId] = curStaff;
    } else if (target.startsWith('rest_')) {
        const rIdx = parseInt(target.replace('rest_', ''));
        let newStaff = dayData.rest[rIdx];
        dayData.scheduled[shiftId] = newStaff;
        
        if (curStaff !== "UNFILLED" && curStaff !== "N/A") {
            dayData.rest[rIdx] = curStaff;
        } else {
            dayData.rest.splice(rIdx, 1);
        }
    }

    document.getElementById('swapModal').style.display = 'none';
    window.renderScheduleUI();
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Shift Reassigned!', showConfirmButton: false, timer: 1500});
};

window.saveScheduleToCloud = async function() {
    Swal.fire({title: 'Saving...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        const schedRef = window.doc(window.db, "settings", "global_schedule");
        const snap = await window.getDoc(schedRef);
        let globalData = snap.exists() ? snap.data() : { branchConfig: {}, currentSchedule: {} };

        globalData.currentYear = window.currentYear;
        globalData.currentMonth = window.currentMonth;
        
        for (let day in window.currentSchedule) {
            if (!globalData.currentSchedule[day]) globalData.currentSchedule[day] = {};
            globalData.currentSchedule[day][window.sessionUser.branch] = window.currentSchedule[day][window.sessionUser.branch];
        }

        await window.setDoc(schedRef, globalData, { merge: true });
        Swal.fire('Saved!', 'Your branch schedule has been synced.', 'success');
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to save schedule.', 'error');
    }
};

const origFranchiseeSwitchView = window.switchView;
window.switchView = function(viewId) {
    if (typeof origFranchiseeSwitchView === 'function') origFranchiseeSwitchView(viewId);
    
    if (viewId === 'inbox') window.loadInbox();
    if (viewId === 'schedule') window.loadScheduleFromCloud();
    if (viewId === 'sanctions') window.loadSanctionsDashboard();
};// ========================================================
// 📥 THE REQUEST INBOX ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadInbox = async function() {
    const pendingBody = document.getElementById('inboxTableBody');
    const resolvedBody = document.getElementById('resolvedRequestsBody');
    if (!pendingBody) return;

    pendingBody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px;">Loading requests...</td></tr>';

    try {
        // FRANCHISEE LOCK: Only pull requests for their specific branch!
        const q = window.query(window.collection(window.db, "staff_requests"), window.where("branch", "==", window.sessionUser.branch), window.orderBy("timestamp", "desc"));
        const snap = await window.getDocs(q);

        let pendingHtml = '';
        let pendingCount = 0;
        let resolvedByStaff = {}; 

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Unknown';
            let safeName = d.staffName ? d.staffName.replace(/'/g, "\\'") : 'Unknown';

            let detailsStr = "";
            if (d.type === "Leave") {
                detailsStr = `<strong style="color: #1e293b;">${d.leaveType || 'Leave'}</strong><br><span style="font-size:11px; font-weight:bold; color:#0ea5e9;">${d.startDate || '?'} to ${d.endDate || '?'}</span><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.reason || 'No reason'}"</span>`;
            } else if (d.type === "Cash Advance") {
                detailsStr = `<strong style="color:#dc2626; font-size:15px;">₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</strong><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.reason || 'No reason'}"</span>`;
            } else if (d.type === "Reason Letter") {
                detailsStr = `<strong style="color: #1e293b;">Cause: ${d.explanationCause || 'Variance'}</strong><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.explanationMessage || 'No explanation'}"</span>`;
            } else if (d.type.includes("Meal")) {
                let itemsList = d.item ? d.item.replace(/ \| /g, '<br><span style="color:#64748b; font-size:11px; font-family:monospace;">') + '</span>' : 'Food Item';
                detailsStr = `🍔 ${itemsList}<br><span style="color:#dc2626; font-size:12px; font-weight:900;">Deduct: ₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>`;
            } else {
                detailsStr = d.amount ? `₱${d.amount.toLocaleString(undefined, {minimumFractionDigits:2})}` : (d.item || d.reason || 'N/A');
            }

            let attachedImage = d.photoBase64 || d.proofImageUrl || d.imageUrl || d.image;
            if (attachedImage) {
                detailsStr += `<br><button onclick="Swal.fire({imageUrl: '${attachedImage}', imageAlt: 'Proof', width: 'auto', customClass: {popup: 'rounded-2xl'}})" style="margin-top: 8px; background: #f0f9ff; border: 1px solid #bae6fd; color: #0284c7; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">📷 View Photo</button>`;
            }

            if (d.status === "Pending") {
                pendingCount++;
                pendingHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 12px; color: #64748b;">${dateStr}</td>
                        <td style="padding: 12px; font-weight: bold; color: #334155;">${safeName}</td>
                        <td style="padding: 12px;"><span style="font-weight: bold; color: #0ea5e9; font-size: 14px;">${d.type}</span></td>
                        <td style="padding: 12px; max-width: 250px; white-space: normal;">${detailsStr}</td>
                        <td style="padding: 12px; text-align: right;">
                            <button onclick="window.handleRequest('${docSnap.id}', 'Approved', '${d.type}', ${d.amount || 0}, '${safeName}')" style="background: #16a34a; color: white; padding: 6px 12px; border:none; border-radius:4px; margin-right:5px; cursor:pointer; font-weight:bold;">Approve</button>
                            <button onclick="window.handleRequest('${docSnap.id}', 'Rejected', '${d.type}', ${d.amount || 0}, '${safeName}')" style="background: #ef4444; color: white; padding: 6px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Reject</button>
                        </td>
                    </tr>
                `;
            } else {
                if (!resolvedByStaff[safeName]) resolvedByStaff[safeName] = [];
                d.dateStr = dateStr; d.detailsStr = detailsStr;
                resolvedByStaff[safeName].push(d);
            }
        });

        let resolvedHtml = '';
        for (let staff in resolvedByStaff) {
            let reqs = resolvedByStaff[staff];
            let safeStaffId = staff.replace(/[^a-zA-Z0-9]/g, ''); 
            
            resolvedHtml += `
                <tr style="background: #f8fafc; cursor: pointer; border-bottom: 1px solid #e2e8f0;" onclick="document.querySelectorAll('.res-row-${safeStaffId}').forEach(r => r.style.display = r.style.display === 'none' ? 'table-row' : 'none')">
                    <td colspan="4" style="font-weight: 900; color: #334155; font-size: 15px; padding: 15px;">
                        <span style="display:inline-block; width:20px; color:#94a3b8;">▼</span> 👤 ${staff}
                    </td>
                    <td style="text-align: right; padding: 15px;">
                        <span style="font-size: 11px; color: white; background: #0ea5e9; padding: 4px 10px; border-radius: 12px; font-weight: bold;">🔍 ${reqs.length} Records</span>
                    </td>
                </tr>
            `;
            
            reqs.forEach(d => {
                let statusColor = d.status === "Approved" ? "#16a34a" : "#dc2626";
                let statusBg = d.status === "Approved" ? "#dcfce7" : "#fef2f2";
                resolvedHtml += `
                    <tr class="res-row-${safeStaffId}" style="display: none; background: white; border-bottom: 1px dashed #cbd5e1;">
                        <td style="padding: 12px; padding-left: 35px; color: #64748b;">${d.dateStr}</td>
                        <td style="padding: 12px; font-weight: bold; color: #0ea5e9;">${d.type}</td>
                        <td colspan="2" style="padding: 12px; max-width: 250px; white-space: normal;">${d.detailsStr}</td>
                        <td style="padding: 12px; text-align:right;"><span style="background: ${statusBg}; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${d.status}</span></td>
                    </tr>
                `;
            });
        }

        pendingBody.innerHTML = pendingHtml || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #16a34a; font-weight: bold;">No pending requests! 🎉</td></tr>';
        if (resolvedBody) resolvedBody.innerHTML = resolvedHtml || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #64748b;">No resolved history yet.</td></tr>';

        let badge = document.getElementById('inboxBadge');
        if (badge) {
            badge.innerText = pendingCount;
            badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }
    } catch(e) { console.error(e); pendingBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Error loading inbox.</td></tr>'; }
};

window.handleRequest = async function(docId, action, type, amount, staffName) {
    let reason = prompt(`Optional: Enter a message to ${staffName} regarding this decision:`);
    if (reason === null) return; // Cancelled

    Swal.fire({title: 'Processing...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        await window.updateDoc(window.doc(window.db, "staff_requests", docId), {
            status: action,
            managerReply: reason || '',
            processedAt: window.serverTimestamp(),
            processedBy: window.sessionUser.cashierName
        });

        if (action === "Approved" && (type === "Cash Advance" || type.includes("Meal"))) {
            await window.addDoc(window.collection(window.db, "staff_deductions"), {
                staffName: staffName,
                type: type,
                amount: amount,
                dateAdded: window.serverTimestamp(),
                status: "Unpaid" 
            });
        }

        Swal.fire('✅ Processed', `Request has been ${action}.`, 'success');
        window.loadInbox();
    } catch (e) { console.error(e); Swal.fire('Error', 'Failed to process.', 'error'); }
};

window.loadSanctionsDashboard = async function() {
    const tbody = document.getElementById('sanctionsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px;">Loading disciplinary records...</td></tr>';

    try {
        const q = window.query(window.collection(window.db, "hr_sanctions"), window.where("branch", "==", window.sessionUser.branch), window.orderBy("timestamp", "desc"));
        const snap = await window.getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
            let statusBadge = ''; let actionBtn = '';

            if (d.status === 'Pending Reply') {
                statusBadge = `<span style="background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Awaiting Staff Reply</span>`;
                actionBtn = `<button onclick="window.deleteSanction('${docSnap.id}')" style="background: white; color: #dc2626; border: 1px solid #fecaca; padding: 4px 8px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">🗑️ Cancel Notice</button>`;
            } else if (d.status === 'Replied' || d.status === 'Resolved') {
                statusBadge = `<span style="background: ${d.status === 'Resolved' ? '#dcfce7' : '#e0f2fe'}; color: ${d.status === 'Resolved' ? '#16a34a' : '#0284c7'}; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${d.status === 'Resolved' ? '✅ Resolved' : '📩 Staff Replied'}</span>
                               <div style="font-size: 11px; color: #334155; font-style: italic; border-left: 2px solid ${d.status === 'Resolved' ? '#16a34a' : '#0ea5e9'}; padding-left: 8px; margin-top: 4px; max-width: 250px;">"${d.staffReply}"</div>`;
                
                if (d.status === 'Replied') {
                    actionBtn = `<button onclick="window.resolveSanction('${docSnap.id}', '${d.staffName}')" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">Accept & Resolve</button>`;
                } else {
                    let safeDocStr = encodeURIComponent(JSON.stringify({id: docSnap.id, ...d}));
                    actionBtn = `<button onclick="window.printFormalNTE('${safeDocStr}')" style="background: #f8fafc; color: #0f172a; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">📄 Print Record</button>`;
                }
            }

            let severityColor = d.severity.includes('Warning') ? '#ea580c' : '#dc2626';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; color: #64748b; font-size: 12px;">${dateStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #0f172a;">👤 ${d.staffName}</td>
                    <td style="padding: 12px;"><strong style="color: #334155;">${d.type}</strong><br><span style="font-size: 11px; color: #64748b; font-style: italic;">"${d.details}"</span></td>
                    <td style="padding: 12px;"><strong style="color: ${severityColor};">${d.severity}</strong></td>
                    <td style="padding: 12px;">${statusBadge}</td>
                    <td style="padding: 12px; text-align: right;">${actionBtn}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #64748b;">No disciplinary records found.</td></tr>';
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading data.</td></tr>'; }
};

window.openIssueSanctionModal = async function() {
    document.getElementById('issueSanctionModal').style.display = 'flex';
    document.getElementById('sanctionDetails').value = '';
    
    let select = document.getElementById('sanctionStaffSelect');
    select.innerHTML = '<option value="">Loading staff...</option>';
    
    try {
        const snap = await window.getDocs(window.query(window.collection(window.db, "cashiers"), window.where("branch", "==", window.sessionUser.branch)));
        let html = '<option value="">-- Select Staff Member --</option>';
        let staffList = [];
        
        snap.forEach(doc => {
            if (doc.data().status !== 'Resigned') staffList.push(doc.data().cashierName);
        });
        
        staffList.sort().forEach(s => html += `<option value="${s}">${s}</option>`);
        select.innerHTML = html;
    } catch (e) { console.error(e); select.innerHTML = '<option value="">Error loading staff.</option>'; }
};

window.generateAiNteLetter = function() {
    let staffName = document.getElementById('sanctionStaffSelect').value;
    let incidentType = document.getElementById('sanctionType').value;
    let severity = document.getElementById('sanctionSeverity').value;
    let detailsArea = document.getElementById('sanctionDetails');
    let roughDetails = detailsArea.value.trim();

    if (!staffName || !roughDetails) return Swal.fire('Wait', 'Select a staff member and type a short description first.', 'warning');

    let dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    
    let formalLetter = `Subject: Violation of Store Policies\n\nDear ${staffName},\n\nThis letter serves as a formal notice regarding a non-compliance issue observed on ${dateStr}.\n\nINCIDENT SUMMARY:\n${roughDetails}\n\nSEVERITY LEVEL & RESOLUTION:\nThis incident has been recorded as a: ${severity}. We have discussed the critical importance of maintaining strict compliance with store protocols. You are expected to correct this behavior immediately.\n\nPlease be reminded that strict adherence to our policies is essential to ensuring quality operations. Future non-compliance may result in further disciplinary action.\n\nSincerely,\n${window.sessionUser.cashierName}\nManagement, ${window.sessionUser.branch}`;

    detailsArea.value = formalLetter;
    detailsArea.style.height = '250px';
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Letter drafted!', showConfirmButton: false, timer: 1500});
};

window.submitNewSanction = async function() {
    let staffName = document.getElementById('sanctionStaffSelect').value;
    let type = document.getElementById('sanctionType').value;
    let severity = document.getElementById('sanctionSeverity').value;
    let details = document.getElementById('sanctionDetails').value.trim();

    if (!staffName || !details) return Swal.fire('Missing Data', 'Please fill out all fields.', 'warning');

    let btn = document.getElementById('btnSaveSanction');
    btn.innerText = "⏳ Issuing..."; btn.disabled = true;

    try {
        await window.addDoc(window.collection(window.db, "hr_sanctions"), {
            staffName: staffName,
            branch: window.sessionUser.branch,
            type: type,
            severity: severity,
            details: details,
            status: "Pending Reply", 
            issuedBy: window.sessionUser.cashierName,
            timestamp: window.serverTimestamp()
        });

        Swal.fire('✅ Success!', `Notice issued to ${staffName}. Their POS is locked until they reply.`, 'success');
        document.getElementById('issueSanctionModal').style.display = 'none';
        window.loadSanctionsDashboard();
    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to issue notice.', 'error');
    } finally { btn.innerText = "🚀 Issue Digital Notice"; btn.disabled = false; }
};

window.resolveSanction = async function(docId, staffName) {
    if (!confirm(`Mark this issue as resolved for ${staffName}?`)) return;
    try {
        await window.updateDoc(window.doc(window.db, "hr_sanctions", docId), { status: "Resolved", resolvedAt: window.serverTimestamp() });
        window.loadSanctionsDashboard();
    } catch (e) { alert("Failed to resolve."); }
};

window.deleteSanction = async function(docId) {
    if (!confirm(`Cancel and delete this notice?`)) return;
    try {
        await window.deleteDoc(window.doc(window.db, "hr_sanctions", docId));
        window.loadSanctionsDashboard();
    } catch (e) { alert("Failed to delete."); }
};

window.printFormalNTE = function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    let issueDate = d.timestamp ? new Date(d.timestamp.seconds * 1000).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown Date';
    let safeDetails = d.details ? d.details.replace(/\n/g, '<br>') : 'No details provided.';
    let safeReply = d.staffReply ? d.staffReply.replace(/\n/g, '<br>') : 'No reply provided.';

    let printWindow = window.open('', '', 'width=800,height=900');
    let html = `
        <html><head><title>Official Record - ${d.staffName}</title>
        <style>body { font-family: 'Times New Roman', serif; margin: 40px; color: #000; line-height: 1.6; } .box { border: 1px solid #000; padding: 15px; margin-bottom: 25px; min-height: 80px; } @media print { button { display: none; } }</style>
        </head><body>
            <h2 style="text-align: center;">OFFICIAL DISCIPLINARY RECORD</h2>
            <p><b>Date:</b> ${issueDate}<br><b>To:</b> ${d.staffName}<br><b>Violation:</b> ${d.type}<br><b>Severity:</b> ${d.severity}</p>
            <p><b>I. INCIDENT REPORT</b></p><div class="box">${safeDetails}</div>
            <p><b>II. EMPLOYEE EXPLANATION</b></p><div class="box">${safeReply}</div>
            <div style="margin-top: 40px;">
                <img src="${d.signatureBase64 || ''}" style="height: 60px; display: block; margin-bottom: -10px;">
                <div style="border-top: 1px solid #000; width: 200px; padding-top: 5px; font-weight: bold;">${d.staffName} (Employee Signature)</div>
            </div>
            <script>window.onload = function() { setTimeout(function(){ window.print(); }, 500); }</script>
        </body></html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
};

window.currentSchedule = {};
window.branchConfig = {};
window.employees = [];

window.loadScheduleFromCloud = async function() {
    let monthInput = document.getElementById("scheduleMonthSelector").value;
    if (!monthInput) {
        let today = new Date();
        monthInput = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        document.getElementById("scheduleMonthSelector").value = monthInput;
    }
    
    let [year, month] = monthInput.split('-').map(Number);
    window.currentYear = year;
    window.currentMonth = month;
    let daysInMonth = new Date(year, month, 0).getDate();

    try {
        const staffSnap = await window.getDocs(window.query(window.collection(window.db, "cashiers"), window.where("branch", "==", window.sessionUser.branch)));
        window.employees = [];
        staffSnap.forEach(d => {
            if (d.data().status !== 'Resigned') {
                window.employees.push({ name: d.data().scheduleNickname || d.data().cashierName, fullName: d.data().cashierName, branch: d.data().branch });
            }
        });

        const schedSnap = await window.getDoc(window.doc(window.db, "settings", "global_schedule"));
        
        if (schedSnap.exists()) {
            let appData = schedSnap.data();
            
            window.branchConfig = appData.branchConfig && appData.branchConfig[window.sessionUser.branch] 
                ? appData.branchConfig[window.sessionUser.branch] 
                : [
                    { id: 'm1', name: 'Morning', active: true, days: [0,1,2,3,4,5,6], startTime: '09:00', endTime: '18:00' },
                    { id: 'n1', name: 'Night', active: true, days: [0,1,2,3,4,5,6], startTime: '18:00', endTime: '03:00' }
                  ];

            if (appData.currentYear === year && appData.currentMonth === month && appData.currentSchedule) {
                window.currentSchedule = appData.currentSchedule;
            } else {
                window.currentSchedule = {};
            }
        }

        for (let day = 1; day <= daysInMonth; day++) {
            if (!window.currentSchedule[day]) window.currentSchedule[day] = {};
            if (!window.currentSchedule[day][window.sessionUser.branch]) {
                window.currentSchedule[day][window.sessionUser.branch] = { scheduled: {}, rest: [], unavailable: [], swaps: {} };
                
                window.branchConfig.filter(s => s.active).forEach(shift => {
                    window.currentSchedule[day][window.sessionUser.branch].scheduled[shift.id] = "UNFILLED";
                });
                window.currentSchedule[day][window.sessionUser.branch].rest = window.employees.map(e => e.name);
            }
        }

        window.renderScheduleUI();

    } catch(e) { console.error("Schedule Load Error:", e); }
};

window.renderScheduleUI = function() {
    const container = document.getElementById("franchiseScheduleContainer");
    if(!container) return;

    let branch = window.sessionUser.branch;
    let daysInMonth = new Date(window.currentYear, window.currentMonth, 0).getDate();
    let activeShifts = window.branchConfig.filter(s => s.active);

    let html = `<table class="data-table" style="width: 100%; border-collapse: collapse; text-align: left;">
                  <thead style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                    <tr><th style="padding: 12px; font-size: 11px; color: #475569; text-transform: uppercase;">Date</th>`;
    
    activeShifts.forEach(s => html += `<th style="padding: 12px; font-size: 11px; color: #475569; text-transform: uppercase; text-align: center;">${s.name}</th>`);
    html += `<th style="padding: 12px; font-size: 11px; color: #d97706; text-transform: uppercase; background: #fffbeb; text-align: center;">Standby / Off</th></tr></thead><tbody>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const dStr = new Date(window.currentYear, window.currentMonth - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        html += `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 12px; font-weight: bold; color: #334155; white-space: nowrap;">${dStr}</td>`;

        let dayData = window.currentSchedule[day][branch] || { scheduled: {}, rest: [] };

        activeShifts.forEach(s => {
            let val = dayData.scheduled[s.id] || "UNFILLED";
            let cellHtml = val === "UNFILLED" || val === "N/A"
                ? `<span onclick="window.openSwapModal(${day}, '${s.id}')" style="color: #ef4444; background: #fef2f2; border: 1px dashed #fca5a5; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; cursor: pointer;">Needs Staff</span>`
                : `<span onclick="window.openSwapModal(${day}, '${s.id}')" style="color: #0ea5e9; background: #e0f2fe; border: 1px solid #bae6fd; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; cursor: pointer;">${val}</span>`;
            
            html += `<td style="padding: 12px; text-align: center;">${cellHtml}</td>`;
        });

        let restHtml = (dayData.rest || []).map(r => `<span style="color: #d97706; font-size: 11px; font-weight: bold; background: #fffbeb; border: 1px solid #fcd34d; padding: 2px 6px; border-radius: 4px; margin: 2px; display: inline-block;">${r}</span>`).join('');
        html += `<td style="padding: 12px; text-align: center;">${restHtml || '-'}</td></tr>`;
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
};

window.openSwapModal = function(day, shiftId) {
    let branch = window.sessionUser.branch;
    let dayData = window.currentSchedule[day][branch];
    let curStaff = dayData.scheduled[shiftId];
    window.swapData = { day, shiftId, curStaff }; 

    let optionsHtml = '<option value="">-- Choose Staff --</option>';
    
    optionsHtml += '<optgroup label="🔄 Swap with Scheduled Staff">';
    for (let sId in dayData.scheduled) {
        if (sId !== shiftId && dayData.scheduled[sId] !== "UNFILLED" && dayData.scheduled[sId] !== "N/A") {
            let shiftName = window.branchConfig.find(s => s.id === sId)?.name || sId;
            optionsHtml += `<option value="shift_${sId}">${dayData.scheduled[sId]} (from ${shiftName})</option>`;
        }
    }
    optionsHtml += '</optgroup>';

    if (dayData.rest && dayData.rest.length > 0) {
        optionsHtml += '<optgroup label="☕ Assign from Standby">';
        dayData.rest.forEach((rStaff, index) => {
            optionsHtml += `<option value="rest_${index}">${rStaff}</option>`;
        });
        optionsHtml += '</optgroup>';
    }

    let displayCurrent = curStaff === "UNFILLED" ? "No one assigned yet" : curStaff;

    document.getElementById('swapMessage').innerText = `Currently Assigned: ${displayCurrent}`;
    document.getElementById('swapTarget').innerHTML = optionsHtml;
    document.getElementById('swapModal').style.display = 'flex';
};

window.executeSwap = function() {
    let target = document.getElementById('swapTarget').value;
    if (!target) return alert("Please select a staff member.");

    const { day, shiftId, curStaff } = window.swapData; 
    let branch = window.sessionUser.branch;
    let dayData = window.currentSchedule[day][branch];

    if (target.startsWith('shift_')) {
        const tSId = target.replace('shift_', '');
        let newStaff = dayData.scheduled[tSId];
        dayData.scheduled[shiftId] = newStaff;
        dayData.scheduled[tSId] = curStaff;
    } else if (target.startsWith('rest_')) {
        const rIdx = parseInt(target.replace('rest_', ''));
        let newStaff = dayData.rest[rIdx];
        dayData.scheduled[shiftId] = newStaff;
        
        if (curStaff !== "UNFILLED" && curStaff !== "N/A") {
            dayData.rest[rIdx] = curStaff;
        } else {
            dayData.rest.splice(rIdx, 1);
        }
    }

    document.getElementById('swapModal').style.display = 'none';
    window.renderScheduleUI();
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Shift Reassigned!', showConfirmButton: false, timer: 1500});
};

window.saveScheduleToCloud = async function() {
    Swal.fire({title: 'Saving...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        const schedRef = window.doc(window.db, "settings", "global_schedule");
        const snap = await window.getDoc(schedRef);
        let globalData = snap.exists() ? snap.data() : { branchConfig: {}, currentSchedule: {} };

        globalData.currentYear = window.currentYear;
        globalData.currentMonth = window.currentMonth;
        
        for (let day in window.currentSchedule) {
            if (!globalData.currentSchedule[day]) globalData.currentSchedule[day] = {};
            globalData.currentSchedule[day][window.sessionUser.branch] = window.currentSchedule[day][window.sessionUser.branch];
        }

        await window.setDoc(schedRef, globalData, { merge: true });
        Swal.fire('Saved!', 'Your branch schedule has been synced.', 'success');
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to save schedule.', 'error');
    }
};

// ========================================================
// 🧭 HOOKING IT ALL INTO THE ROUTER (CRASH-PROOF)
// ========================================================
if (typeof window.origFranchiseeSwitchView === 'undefined') {
    window.origFranchiseeSwitchView = window.switchView;
}

window.switchView = function(viewId) {
    // Run original view switcher if it exists
    if (typeof window.origFranchiseeSwitchView === 'function') {
        window.origFranchiseeSwitchView(viewId);
    }
    
    // Automatically load data when specific tabs are clicked!
    if (viewId === 'inbox' && typeof window.loadInbox === 'function') window.loadInbox();
    if (viewId === 'schedule' && typeof window.loadScheduleFromCloud === 'function') window.loadScheduleFromCloud();
    if (viewId === 'sanctions' && typeof window.loadSanctionsDashboard === 'function') window.loadSanctionsDashboard();
    
    // NEW ADDITIONS
    if (viewId === 'zreadings' && typeof window.loadZReadings === 'function') window.loadZReadings();
    if (viewId === 'expenses' && typeof window.loadExpenses === 'function') window.loadExpenses();
};

// ========================================================
// 🧾 Z-READING REPORTS ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadZReadings = async function() {
    // Support multiple common table IDs depending on how you ported the HTML
    const tbody = document.getElementById('zreadingsTableBody') || document.getElementById('zreadingsBody');
    if (!tbody) return;
    
    // Hide the multi-branch dropdown (Franchisees don't need it)
    let branchSelect = document.getElementById('zreadingBranchFilter');
    if (branchSelect) branchSelect.style.display = 'none';

    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 40px; color: #0ea5e9; font-weight: bold;">⚡ Loading branch end-of-day reports...</td></tr>';

    try {
        let branch = window.sessionUser.branch; // 🔒 Strict Franchise Lock
        
        const q = window.query(
            window.collection(window.db, "z_readings"), 
            window.where("branch", "==", branch), 
            window.orderBy("timestamp", "desc"),
            window.limit(30)
        );
        const snap = await window.getDocs(q);
        let html = '';

        snap.forEach(doc => {
            let d = doc.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            let totalSales = parseFloat(d.grossSales || d.totalSales || 0);
            let cashExpected = parseFloat(d.cashExpected || 0);
            let cashActual = parseFloat(d.cashActual || d.actualCash || 0);
            let variance = parseFloat(d.variance || 0);
            
            let varColor = variance < 0 ? '#dc2626' : (variance > 0 ? '#16a34a' : '#64748b');
            let varText = variance < 0 ? `₱${variance.toFixed(2)}` : (variance > 0 ? `+₱${variance.toFixed(2)}` : `Matched`);

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 15px; font-size: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 15px; font-weight: bold; color: #334155;">👤 ${d.cashierName || d.cashier || 'System'}</td>
                    <td style="padding: 15px; font-weight: 900; color: #0f172a;">₱${totalSales.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding: 15px; color: #475569;">₱${cashExpected.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding: 15px; font-weight: bold; color: #0284c7;">₱${cashActual.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding: 15px; font-weight: 900; color: ${varColor};">${varText}</td>
                    <td style="padding: 15px; text-align: right;">
                        <button onclick="window.viewZReadingDetails('${doc.id}')" style="background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.1);">📄 View Details</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="8" class="text-center" style="padding: 40px; color: #64748b; font-weight: bold;">No Z-Readings found for your branch yet.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: #dc2626; padding: 40px; font-weight: bold;">❌ Error loading Z-Readings.</td></tr>';
    }
};

window.viewZReadingDetails = async function(docId) {
    if (typeof Swal === 'undefined') return alert("Loading details...");
    Swal.fire({title: 'Loading Data...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    
    try {
        const snap = await window.getDoc(window.doc(window.db, "z_readings", docId));
        if(!snap.exists()) return Swal.fire('Error', 'Data not found.', 'error');
        let d = snap.data();
        let safeHtml = `
            <div style="text-align: left; font-size: 14px; line-height: 1.8; background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #cbd5e1;">
                <b>📅 Date:</b> ${d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH') : 'Unknown'}<br>
                <b>👤 Cashier:</b> ${d.cashierName}<br>
                <hr style="border: 0; border-top: 1px dashed #cbd5e1; margin: 10px 0;">
                <b style="color: #0f172a;">Gross Sales:</b> ₱${parseFloat(d.grossSales||0).toFixed(2)}<br>
                <b style="color: #0f172a;">Net Sales:</b> ₱${parseFloat(d.netSales||0).toFixed(2)}<br>
                <b style="color: #ea580c;">Discounts:</b> ₱${parseFloat(d.totalDiscounts||0).toFixed(2)}<br>
                <b style="color: #dc2626;">Expenses Paid:</b> ₱${parseFloat(d.totalExpenses||0).toFixed(2)}<br>
                <hr style="border: 0; border-top: 1px dashed #cbd5e1; margin: 10px 0;">
                <b style="color: #475569;">System Expected Cash:</b> ₱${parseFloat(d.cashExpected||0).toFixed(2)}<br>
                <b style="color: #0284c7; font-size: 16px;">Actual Cash Count:</b> ₱${parseFloat(d.cashActual||0).toFixed(2)}<br>
                <div style="margin-top: 10px; padding: 10px; background: ${d.variance < 0 ? '#fef2f2' : (d.variance > 0 ? '#f0fdf4' : '#f8fafc')}; border-radius: 8px; border: 1px solid ${d.variance < 0 ? '#fecaca' : (d.variance > 0 ? '#bbf7d0' : '#e2e8f0')}; text-align: center;">
                    <b>Variance:</b> <span style="font-size: 18px; font-weight: 900; color:${d.variance < 0 ? '#dc2626' : (d.variance > 0 ? '#16a34a' : '#64748b')}">₱${parseFloat(d.variance||0).toFixed(2)}</span>
                </div>
            </div>
        `;
        Swal.fire({ title: 'Z-Reading Breakdown', html: safeHtml, icon: 'info', confirmButtonColor: '#0ea5e9' });
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to load details.', 'error'); }
};

// ========================================================
// 💸 EXPENSE LOGS ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadExpenses = async function() {
    const tbody = document.getElementById('expensesTableBody') || document.getElementById('expenseLogsBody') || document.getElementById('expensesBody');
    if (!tbody) return;

    // Hide branch selector if exists
    let branchSelect = document.getElementById('expenseBranchFilter');
    if (branchSelect) branchSelect.style.display = 'none';

    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #f59e0b; font-weight: bold;">⚡ Loading branch expenses...</td></tr>';

    try {
        let branch = window.sessionUser.branch; // 🔒 Strict Franchise Lock
        
        const q = window.query(
            window.collection(window.db, "expenses"), 
            window.where("branch", "==", branch), 
            window.orderBy("timestamp", "desc"),
            window.limit(30)
        );
        const snap = await window.getDocs(q);
        let html = '';

        snap.forEach(doc => {
            let d = doc.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            let amount = parseFloat(d.amount || 0);

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: 0.2s;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 15px; font-size: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 15px; font-weight: bold; color: #334155;">👤 ${d.addedBy || d.cashier || 'System'}</td>
                    <td style="padding: 15px;"><span style="background: #f1f5f9; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #475569; border: 1px solid #e2e8f0;">${d.category || 'General'}</span></td>
                    <td style="padding: 15px; color: #1e293b;">${d.description || d.particulars || 'No description provided'}</td>
                    <td style="padding: 15px; font-weight: 900; color: #dc2626;">₱${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #64748b; font-weight: bold;">No expenses logged for your branch yet.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: #dc2626; padding: 40px; font-weight: bold;">❌ Error loading expenses.</td></tr>';
    }
};

// ========================================================
// 📦 INVENTORY SUB-ROUTING ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.activeInvTab = 'Overview';

window.switchInvTab = function(tabName) {
    window.activeInvTab = tabName; 
    
    // 1. Ensure the main Inventory view is visible
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    let targetView = document.getElementById('view-inventory');
    if (targetView) targetView.classList.add('active');
    
    // 2. Highlight the correct sidebar sub-item
    document.querySelectorAll('.nav-subitem').forEach(el => el.classList.remove('active'));
    let activeSub = document.getElementById('subnav-' + tabName);
    if (activeSub) activeSub.classList.add('active');

    // 3. Hide all internal inventory sections
    let sections = {
        'Overview': 'invTabLiveContent',
        'Audits': 'invSectionAudits',
        'Waste': 'invSectionWaste',
        'Prep': 'invSectionPrepLogs',
        'StockLogs': 'invTabLogsContent',
        'Alerts': 'invSectionAlerts'
    };

    Object.values(sections).forEach(secId => {
        let el = document.getElementById(secId);
        if (el) el.style.display = 'none';
    });

    // 4. Show the selected section
    if (sections[tabName]) {
        let activeEl = document.getElementById(sections[tabName]);
        if (activeEl) activeEl.style.display = 'block';
    }

    // 5. Trigger the correct data loader
    window.refreshActiveInventoryTab();
};

window.refreshActiveInventoryTab = function() {
    let tab = window.activeInvTab || 'Overview';
    
    if (tab === 'Overview' && typeof window.loadInventoryData === 'function') window.loadInventoryData();
    else if (tab === 'Audits' && typeof window.loadInventoryAudits === 'function') window.loadInventoryAudits();
    else if (tab === 'Waste' && typeof window.loadWasteTabLogs === 'function') window.loadWasteTabLogs();
    else if (tab === 'Prep') window.loadPrepBatchLogs();
    else if (tab === 'StockLogs') window.loadStockLogs();
    else if (tab === 'Alerts') window.loadPurchasesAndAlerts(); 
};

// ========================================================
// 🥣 1. PREP BATCH LOGS ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadPrepBatchLogs = async function() {
    const tbody = document.getElementById('prepBatchLogsBody');
    if (!tbody) return;
    
    // Hide the multi-branch tab selector (Franchisees don't need it)
    let tabContainer = document.getElementById('prepBranchTabs');
    if (tabContainer) tabContainer.style.display = 'none';

    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #8b5cf6; font-weight: bold;">Loading prep history...</td></tr>';
    
    try {
        let branch = window.sessionUser.branch; // 🔒 Strict Franchise Lock
        
        const q = window.query(
            window.collection(window.db, "stock_logs"), 
            window.where("branch", "==", branch),
            window.where("type", "in", ["Manager Prep Batch", "End-of-Shift Kitchen Prep"]), 
            window.orderBy("timestamp", "desc"), 
            window.limit(50)
        );

        const snap = await window.getDocs(q);
        let html = '';

        snap.forEach(doc => {
            let log = doc.data();
            let timeObj = log.timestamp ? log.timestamp.toDate() : new Date();
            let timeStr = timeObj.toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'});
            let dateStr = timeObj.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
            let pUom = log.purchUom || 'Batch';
            let pQty = log.purchQty ? log.purchQty : '-';
            let purchDisplay = log.purchQty ? `(${pQty} ${pUom}s)` : '';
            let staffName = log.user || log.cashier || 'System';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px 15px; color: #64748b; font-size: 12px;">${dateStr} <br> ${timeStr}</td>
                    <td style="padding: 12px 15px;"><span class="badge badge-open">${log.branch}</span></td>
                    <td style="padding: 12px 15px; font-weight: bold; color: #334155;">👤 ${staffName}</td>
                    <td style="padding: 12px 15px; font-weight: bold; color: #8b5cf6;">${log.item}</td>
                    <td style="padding: 12px 15px;">
                        <strong style="color: #10b981; font-size: 15px;">+${log.variance} ${log.uom}</strong><br>
                        <span style="color: #0ea5e9; font-size: 11px; font-weight: bold;">${purchDisplay}</span>
                    </td>
                    <td style="padding: 12px 15px;">
                        <span style="color: #16a34a; font-weight: bold; font-size: 11px; background: #dcfce7; padding: 4px 8px; border-radius: 4px; border: 1px solid #bbf7d0;">✅ Processed</span>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding: 40px; color: #94a3b8; font-weight: bold;">No prep batches logged for your branch yet.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: #dc2626; padding: 40px; font-weight: bold;">❌ Error loading history.</td></tr>';
    }
};

// ========================================================
// 📜 2. STOCK HISTORY LOGS ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.lastStockLogDoc = null;
window.cachedStockLogsHTML = '';

window.loadStockLogs = async function(isLoadMore = false) {
    const tbody = document.getElementById('stockLogsBody');
    if (!tbody) return;
    
    // Hide multi-branch tabs
    let tabContainer = document.getElementById('stockLogBranchTabs');
    if (tabContainer) tabContainer.style.display = 'none';

    if (!isLoadMore) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 40px; color: #0ea5e9; font-weight: bold;">⚡ Loading recent history...</td></tr>';
        window.lastStockLogDoc = null;
        window.cachedStockLogsHTML = '';
    } else {
        let btn = document.getElementById('btnLoadMoreStock');
        if (btn) { btn.innerText = "⏳ Fetching next batch..."; btn.disabled = true; }
    }

    try {
        let branch = window.sessionUser.branch; // 🔒 Strict Franchise Lock
        
        let qLogs = window.query(
            window.collection(window.db, "stock_logs"), 
            window.where("branch", "==", branch), 
            window.orderBy("timestamp", "desc"), 
            window.limit(20) // Cap to keep the app fast
        );
        
        if (isLoadMore && window.lastStockLogDoc) {
            qLogs = window.query(
                window.collection(window.db, "stock_logs"), 
                window.where("branch", "==", branch), 
                window.orderBy("timestamp", "desc"), 
                window.startAfter(window.lastStockLogDoc), 
                window.limit(20)
            );
        }

        const snap = await window.getDocs(qLogs);
        
        if (snap.empty) {
            if (isLoadMore) {
                let btn = document.getElementById('btnLoadMoreStock');
                if (btn) { btn.innerText = "✅ End of History"; btn.disabled = true; }
                return;
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 40px; color: #64748b; font-weight: bold;">No stock history found.</td></tr>';
                return;
            }
        }

        window.lastStockLogDoc = snap.docs[snap.docs.length - 1];
        let html = '';

        snap.forEach(doc => {
            let data = doc.data();
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
            let user = data.user || data.cashier || "System";
            let uom = data.uom || "";
            let oldQty = data.oldQty !== undefined ? data.oldQty : "-";
            let newQty = data.newQty !== undefined ? data.newQty : "-";
            let logType = data.type || "System Update";

            let varHtml = '';
            if (data.variance > 0) {
                varHtml = `<span style="color: #16a34a; font-weight: 900; font-size: 15px;">+${data.variance} ${uom} <br><span style="font-size:10px; color:#64748b; font-weight: bold;">(${logType})</span></span>`;
            } else if (data.variance < 0) {
                varHtml = `<span style="color: #dc2626; font-weight: 900; font-size: 15px;">${data.variance} ${uom} <br><span style="font-size:10px; color:#64748b; font-weight: bold;">(${logType})</span></span>`;
            } else {
                varHtml = `<span style="color: #94a3b8; font-weight: bold; font-size: 13px;">No Change <br><span style="font-size:10px; color:#64748b;">(${logType})</span></span>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="font-size: 12px; color: #64748b; padding: 15px 20px;">${dateStr}</td>
                    <td style="padding: 15px 20px;"><span class="badge badge-open">${data.branch || 'Unknown'}</span></td>
                    <td style="font-weight: bold; color: #334155; padding: 15px 20px;">👤 ${user}</td>
                    <td style="font-weight: 900; color: #0f172a; padding: 15px 20px;">${data.item || 'Unknown Item'}</td>
                    <td style="color: #64748b; padding: 15px 20px; font-weight: bold;">${oldQty} <span style="font-size:11px; font-weight:normal;">${uom}</span></td>
                    <td style="font-weight: 900; color: #0284c7; padding: 15px 20px;">${newQty} <span style="font-size:11px; font-weight:normal;">${uom}</span></td>
                    <td style="padding: 15px 20px;">${varHtml}</td>
                </tr>
            `;
        });

        window.cachedStockLogsHTML += html;

        let loadMoreRow = `
            <tr id="loadMoreRow_Stock">
                <td colspan="7" style="text-align: center; padding: 20px; background: #f8fafc; border-top: 2px dashed #cbd5e1;">
                    <button id="btnLoadMoreStock" onclick="window.loadStockLogs(true)" style="background: white; border: 1px solid #0ea5e9; color: #0ea5e9; padding: 10px 20px; border-radius: 8px; font-weight: 900; cursor: pointer; box-shadow: 0 2px 4px rgba(14,165,233,0.1); transition: 0.2s;">
                        ⬇️ Load Older Logs
                    </button>
                </td>
            </tr>
        `;

        tbody.innerHTML = window.cachedStockLogsHTML + loadMoreRow;

    } catch (e) { 
        console.error("Stock Logs Error:", e); 
        if (!isLoadMore) tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red; padding: 40px; font-weight: bold;">❌ Error loading logs.</td></tr>'; 
    }
};

// ========================================================
// 🚨 3. LOW STOCK ALERTS ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadPurchasesAndAlerts = async function () {
    const tbody = document.getElementById('alertsPurchasesBody');
    if (!tbody) return;
    
    // Hide the multi-branch dropdown
    let branchFilterEl = document.getElementById('branchAlertFilter');
    if (branchFilterEl) branchFilterEl.style.display = 'none';

    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 40px; color: #0ea5e9; font-weight: bold;">⚡ Scanning branch inventory levels...</td></tr>';

    try {
        let branch = window.sessionUser.branch; // 🔒 Strict Franchise Lock
        const q = window.query(window.collection(window.db, "inventory"), window.where("branch", "==", branch));
        const snap = await window.getDocs(q);
        
        let html = '';

        snap.forEach(docSnap => {
            let data = docSnap.data();
            data.id = docSnap.id;

            let stock = parseFloat(data.currentStock) || 0;
            // Handle both legacy and modern reorder level variables securely
            let reorder = parseFloat(data.reorderLevel) || parseFloat(data.lowStockAlert) || 0;

            // Engine Trigger: Only list items if they are currently at or below the reorder point
            if (stock <= reorder) {
                let suggested = (reorder * 2) - stock; 
                if (suggested <= 0) suggested = reorder;

                html += `
                    <tr style="border-bottom: 1px solid #f1f5f9; transition: 0.2s;" onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">
                        <td style="padding: 15px 25px;"><strong>${data.branch}</strong></td>
                        <td style="padding: 15px 25px;"><span class="badge badge-closed">${data.category || '-'}</span></td>
                        <td style="font-weight: 900; color: #1e293b; padding: 15px 25px; font-size: 14px;">${data.name}</td>
                        <td style="color: #dc2626; font-weight: 900; font-size: 16px; padding: 15px 25px;">${stock.toFixed(1)} <span style="font-size:12px; color:#64748b; font-weight:normal;">${data.uom}</span></td>
                        <td style="font-weight: bold; color: #475569; padding: 15px 25px;">${reorder.toFixed(1)} <span style="font-size:12px; color:#64748b; font-weight:normal;">${data.uom}</span></td>
                        <td style="color: #0ea5e9; font-weight: 900; padding: 15px 25px; font-size: 15px;">${suggested.toFixed(1)} <span style="font-size:12px; color:#64748b; font-weight:normal;">${data.uom}</span></td>
                        <td style="padding: 15px 25px; text-align: center;">
                            <button style="background: #fef3c7; color: #d97706; border: 1px solid #fcd34d; padding: 8px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; box-shadow: 0 2px 4px rgba(217, 119, 6, 0.1);" onclick="window.switchView('dispatch')">📝 Request HQ</button>
                        </td>
                    </tr>
                `;
            }
        });

        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="color: #16a34a; font-weight: bold; padding: 40px; font-size: 15px;">✅ All inventory levels are optimal. No alerts.</td></tr>';

    } catch (error) {
        console.error("Error loading alerts:", error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red; padding: 40px; font-weight: bold;">❌ Failed to scan inventory. Check your connection.</td></tr>';
    }
};

// =======================================================
// 🧟 ZOMBIE LISTENER KILLER (OPTIMIZED DEBOUNCE)
// =======================================================
window.zombieTimeout = null;
document.addEventListener("visibilitychange", async () => {
    clearTimeout(window.zombieTimeout);
    
    if (document.hidden) {
        // Wait 10 seconds before pausing to prevent rapid alt-tab spam
        window.zombieTimeout = setTimeout(async () => {
            console.log("🛑 App hidden for 10s. Pausing Firebase to save reads...");
            try { if (window.disableNetwork && window.db) await window.disableNetwork(window.db); } catch(e) {}
        }, 10000);
    } else {
        console.log("🟢 App visible. Waking up Firebase...");
        try { if (window.enableNetwork && window.db) await window.enableNetwork(window.db); } catch(e) {}
    }
});
