// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS 
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
window.query = query; window.where = where; window.collection = collection;
window.getDocs = getDocs; window.getDoc = getDoc; window.addDoc = addDoc;
window.updateDoc = updateDoc; window.deleteDoc = deleteDoc; window.doc = doc;
window.serverTimestamp = serverTimestamp; window.orderBy = orderBy; window.limit = limit;

console.log("🚀 TAKODEÁL Franchisee Walled Garden ACTIVE!");

// --- HELPER: FORMAT CURRENCY ---
window.formatMoney = (amount) => '₱' + parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ========================================================
// 🔐 2. SECURE AUTHENTICATION (FRANCHISEE LOCK)
// ========================================================
window.tempAuthUser = null;
window.tempAuthData = null;
window.sessionUser = null;

onAuthStateChanged(auth, async (user) => {
    const loginOverlay = document.getElementById('loginOverlay');
    const stage1 = document.getElementById('loginStage1');
    const stage2 = document.getElementById('loginStage2');
    
    if (user) {
        try {
            // STRICT QUERY: Must be in hq_managers AND have the Franchisee role!
            const q = query(collection(db, "hq_managers"), where("email", "==", user.email), where("role", "==", "Franchisee"));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                let userData = snap.docs[0].data();
                window.tempAuthUser = user;
                window.tempAuthData = userData;
                window.tempAuthData.docId = snap.docs[0].id;

                document.getElementById('authWelcomeName').innerText = `Welcome, ${userData.fullName || 'Partner'}`;
                stage1.style.display = 'none';
                stage2.style.display = 'block';
                loginOverlay.style.display = 'flex';
                setTimeout(() => { document.getElementById('managerPinInput').focus(); }, 300);
            } else {
                await signOut(auth);
                Swal.fire('Access Denied', 'This Google Account is not registered as a Franchise Owner.', 'error');
                loginOverlay.style.display = 'flex'; stage1.style.display = 'block'; stage2.style.display = 'none';
            }
        } catch (e) { console.error(e); }
    } else {
        if (loginOverlay) { loginOverlay.style.display = 'flex'; stage1.style.display = 'block'; stage2.style.display = 'none'; }
    }
});

window.loginWithGoogle = async function() {
    try {
        let btn = document.querySelector('#loginStage1 button');
        btn.innerHTML = '⏳ Securely connecting...'; btn.disabled = true;
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(auth, provider);
    } catch (error) {
        let btn = document.querySelector('#loginStage1 button');
        if (btn) { btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 22px; height: 22px;"> Sign in with Google'; btn.disabled = false; }
        if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            Swal.fire("Login failed", error.message, "error");
        }
    }
};

window.checkManagerPin = function() {
    let pinInput = document.getElementById('managerPinInput');
    let pinVal = pinInput.value.trim();
    let err = document.getElementById('pinErrorMsg');
    
    if (pinVal === String(window.tempAuthData.pin)) {
        // 🔥 ESTABLISH THE SESSION LOCK
        let assignedBranchStr = window.tempAuthData.assignedBranch || '';
        let allowedArr = assignedBranchStr.split(',').map(b => b.trim());
        
        window.sessionUser = {
            email: window.tempAuthUser.email,
            branch: allowedArr[0], // Defaults to their first branch in the list
            allowedBranches: allowedArr,
            cashierName: window.tempAuthData.fullName || 'Franchise Owner',
            isFranchisee: true
        };

        // 🔥 UI UPGRADE: Check for Multi-Branch Ownership
        let selectDrop = document.getElementById('franchiseBranchSelect');
        let singleText = document.getElementById('singleBranchText');
        
        if (allowedArr.length > 1) {
            // They own multiple branches! Build the dropdown.
            selectDrop.style.display = 'block';
            singleText.style.display = 'none';
            
            selectDrop.innerHTML = ''; // Clear old options
            allowedArr.forEach(b => {
                let opt = document.createElement('option');
                opt.value = b;
                opt.innerText = b.toUpperCase();
                selectDrop.appendChild(opt);
            });
            selectDrop.value = window.sessionUser.branch; // Set active dropdown value
        } else {
            // Single branch owner
            selectDrop.style.display = 'none';
            singleText.style.display = 'block';
            singleText.innerText = window.sessionUser.branch.toUpperCase();
        }
        
        document.getElementById('loginOverlay').style.display = 'none';
        window.switchView('dashboard');
        
    } else {
        err.style.display = 'block';
        pinInput.value = '';
        pinInput.style.borderColor = '#ef4444';
        pinInput.focus();
    }
};

// 🔥 NEW FUNCTION: Securely switch branches on the fly
window.changeFranchiseBranch = function() {
    let selectDrop = document.getElementById('franchiseBranchSelect');
    if (selectDrop) {
        let newBranch = selectDrop.value;
        
        // ULTIMATE SECURITY: Ensure they actually own the branch they selected!
        if (!window.sessionUser.allowedBranches.includes(newBranch)) {
            Swal.fire('Error', 'Unauthorized branch selection.', 'error');
            return;
        }
        
        window.sessionUser.branch = newBranch;
        
        // Trigger the magic: Instantly pull the new branch's data
        window.refreshActiveData();
        
        Swal.fire({ 
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Switched to ' + newBranch, showConfirmButton: false, timer: 1500 
        });
    }
};

window.cancelLoginAndSignOut = async function() {
    await signOut(auth);
    window.tempAuthUser = null; window.tempAuthData = null;
    let pinBox = document.getElementById('managerPinInput');
    if (pinBox) { pinBox.value = ''; pinBox.style.borderColor = '#cbd5e1'; }
    document.getElementById('pinErrorMsg').style.display = 'none';
};

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
    if (viewId === 'hq-billing') window.loadHQBilling();
    if (viewId === 'b2b') window.loadB2BSupply();
    if (viewId === 'payroll') window.loadPayrollGenerator();
    if (viewId === 'history') window.loadSalesHistory();
    if (viewId === 'inv-overview') window.loadLiveInventory();
};

window.refreshActiveData = function() {
    let activeView = document.querySelector('.view-container.active');
    if (activeView) {
        let id = activeView.id.replace('view-', '');
        window.switchView(id);
    }
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
// 📊 4. DASHBOARD ENGINE (STRICTLY THEIR BRANCH)
// ========================================================
window.loadDashboard = async function() {
    let startVal = document.getElementById('globalStartDate').value;
    let endVal = document.getElementById('globalEndDate').value;
    let startOfDay = new Date(startVal + 'T00:00:00');
    let endOfDay = new Date(endVal + 'T23:59:59');

    try {
        // 1. Fetch Sales
        const txQ = query(collection(db, "transactions"), 
            where("branch", "==", window.sessionUser.branch), 
            where("timestamp", ">=", startOfDay), 
            where("timestamp", "<=", endOfDay)
        );
        const txSnap = await getDocs(txQ);
        
        let netSales = 0; let txCount = 0; let catSales = {};
        let dailyTrend = {};

        txSnap.forEach(doc => {
            let tx = doc.data();
            if (tx.status !== "Voided") {
                netSales += (parseFloat(tx.netTotal) || 0);
                txCount++;
                
                let dateStr = tx.timestamp.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
                if (!dailyTrend[dateStr]) dailyTrend[dateStr] = 0;
                dailyTrend[dateStr] += (parseFloat(tx.netTotal) || 0);

                if (tx.cart) {
                    tx.cart.forEach(item => {
                        let cat = item.category || "Uncategorized";
                        let lineTotal = item.lineTotalFinal !== undefined ? item.lineTotalFinal : ((item.variantPrice || item.basePrice || 0) * (item.qty || 1));
                        if (!catSales[cat]) catSales[cat] = 0;
                        catSales[cat] += lineTotal;
                    });
                }
            }
        });

        document.getElementById('dashNetSales').innerText = formatMoney(netSales);
        document.getElementById('dashTxCount').innerText = txCount;

        // 2. Fetch Expenses
        const expQ = query(collection(db, "expenses"), 
            where("branch", "==", window.sessionUser.branch), 
            where("timestamp", ">=", startOfDay), 
            where("timestamp", "<=", endOfDay)
        );
        const expSnap = await getDocs(expQ);
        let totalExp = 0;
        expSnap.forEach(doc => totalExp += (parseFloat(doc.data().amount) || 0));
        document.getElementById('dashExpenses').innerText = formatMoney(totalExp);

        // 3. Render Charts
        window.renderFranchiseCharts(dailyTrend, catSales);

        // 4. Fetch Live Staff (Active Shifts)
        const shiftQ = query(collection(db, "shifts"), where("branch", "==", window.sessionUser.branch), where("active", "==", true));
        const shiftSnap = await getDocs(shiftQ);
        let staffHtml = '';
        shiftSnap.forEach(doc => {
            let s = doc.data();
            let timeStr = s.startTime.toDate().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
            staffHtml += `
                <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px dashed #e2e8f0;">
                    <span style="font-weight:bold; color:#1e293b;">👤 ${s.cashier}</span>
                    <span style="color:#16a34a; font-size:12px; font-weight:bold; background:#dcfce7; padding:4px 8px; border-radius:6px;">In @ ${timeStr}</span>
                </div>
            `;
        });
        document.getElementById('dashLiveStaff').innerHTML = staffHtml || '<div style="color:#64748b; font-style:italic;">No staff currently clocked in.</div>';

    } catch (e) {
        console.error("Dashboard Error:", e);
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
// 📦 6. B2B SUPPLY ORDERS (REQUEST STOCK)
// ========================================================
window.b2bCart = [];
window.hqInventoryCache = [];

window.updateB2bUom = async function() {
    let itemName = document.getElementById('b2bSearch').value.trim();
    if (!itemName) return;

    if (window.hqInventoryCache.length === 0) {
        const q = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
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
// 📈 8. SALES HISTORY ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadSalesHistory = async function() {
    const tbody = document.getElementById('salesHistoryBody');
    if (!tbody) return; // Safety check if HTML isn't built yet
    
    let startVal = document.getElementById('globalStartDate').value;
    let endVal = document.getElementById('globalEndDate').value;
    let startOfDay = new Date(startVal + 'T00:00:00');
    let endOfDay = new Date(endVal + 'T23:59:59');

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">⏳ Loading history...</td></tr>';

    try {
        // STRICT WALLED GARDEN QUERY
        const q = query(collection(db, "transactions"), 
            where("branch", "==", window.sessionUser.branch),
            where("timestamp", ">=", startOfDay),
            where("timestamp", "<=", endOfDay)
        );
        
        const snap = await getDocs(q);
        
        // Sort by newest first in Javascript to avoid Firebase Index requirements
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
        
        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center; padding: 30px; color:#64748b;">No transactions found for this date range.</td></tr>';
    } catch (e) {
        console.error("History Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red; padding: 20px;">Failed to load sales history.</td></tr>';
    }
};

// ========================================================
// 📦 10. LIVE INVENTORY ENGINE (FRANCHISEE LOCKED)
// ========================================================
window.loadLiveInventory = async function() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">⏳ Checking stock levels...</td></tr>';

    try {
        // WALLED GARDEN: Only fetch items belonging to this specific franchise!
        const q = query(collection(db, "inventory"), 
            where("branch", "==", window.sessionUser.branch)
        );
        
        const snap = await getDocs(q);
        
        let html = '';
        
        if (snap.empty) {
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
            snap.forEach(doc => {
                let item = doc.data();
                let currentQty = parseFloat(item.quantity || 0);
                let threshold = parseFloat(item.lowStockThreshold || 10);
                
                // Turn text red if they are running low
                let isLow = currentQty <= threshold;
                let stockStyle = isLow ? 'color:#dc2626; font-weight:bold;' : 'color:#10b981; font-weight:bold;';
                let statusBadge = isLow ? '<span class="nav-badge" style="margin:0;">LOW STOCK</span>' : '<span style="background:#10b981; color:white; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:bold;">GOOD</span>';

                html += `
                    <tr>
                        <td style="font-weight: 600; color: #1e293b;">${item.itemName || 'Unknown Item'}</td>
                        <td>${item.category || 'Uncategorized'}</td>
                        <td><span style="${stockStyle}">${currentQty} ${item.unit || 'pcs'}</span></td>
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

    // 2. Fetch Incoming Deliveries (Walled Garden Lock)
    const container = document.getElementById('b2bDeliveriesContainer');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">⏳ Checking for deliveries...</div>';

    try {
        const q = query(collection(db, "purchase_orders"), 
            where("branch", "==", window.sessionUser.branch),
            orderBy("timestamp", "desc"),
            limit(20)
        );
        
        const snap = await getDocs(q);
        if (snap.empty) {
            container.innerHTML = '<div style="text-align:center; padding:40px 20px; color:#64748b;"><div style="font-size: 30px; margin-bottom:10px;">📭</div>No recent requests or incoming deliveries.</div>';
            return;
        }

        let html = '';
        snap.forEach(docSnap => {
            let order = docSnap.data();
            let docId = docSnap.id;
            let dateStr = order.timestamp ? order.timestamp.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'Just now';
            let status = order.status || 'Pending';
            
            // Generate Visual Status Badges
            let statusBadge = '';
            if (status === 'Pending') statusBadge = `<span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:900; letter-spacing: 0.5px;">⏳ PENDING</span>`;
            else if (status === 'Dispatched') statusBadge = `<span style="background:#dbeafe; color:#2563eb; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:900; letter-spacing: 0.5px;">🚚 DISPATCHED</span>`;
            else if (status === 'Completed' || status === 'Received') statusBadge = `<span style="background:#dcfce7; color:#16a34a; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:900; letter-spacing: 0.5px;">✅ RECEIVED</span>`;
            else statusBadge = `<span style="background:#f1f5f9; color:#475569; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:900; letter-spacing: 0.5px;">${status.toUpperCase()}</span>`;

            // Build Item List
            let itemsHtml = '';
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach(item => {
                    itemsHtml += `<div style="font-size:13px; color:#475569; margin-top:6px; padding-left: 10px; border-left: 2px solid #cbd5e1;"><strong>${item.displayQty || item.rawQty || item.qty} ${item.displayUom || item.uom || 'units'}</strong> - ${item.name || item.itemName}</div>`;
                });
            }

            // Compile the Delivery Card
            html += `
                <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 15px; background: #f8fafc; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; margin-bottom: 10px;">
                        <div style="font-size: 11px; font-weight: 900; color: #94a3b8; letter-spacing: 1px;">ORDER ID: ${docId.substring(0,8).toUpperCase()}</div>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 13px; font-weight: bold; color: #1e293b; margin-bottom: 10px;">📅 Requested: ${dateStr}</div>
                    ${itemsHtml}
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (e) {
        console.error("Delivery Load Error:", e);
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#dc2626; font-weight:bold;">Error loading deliveries. Check console.</div>';
    }
};
