import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Your secure database keys
const firebaseConfig = {
  apiKey: "AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4",
  authDomain: "takodeal-pos.firebaseapp.com",
  projectId: "takodeal-pos",
  storageBucket: "takodeal-pos.firebasestorage.app",
  messagingSenderId: "248826111383",
  appId: "1:248826111383:web:48bf1e2c172298079bd0d2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
export const db = getFirestore(app);

console.log("🔥 Manager Control Center is LIVE!");

// --- HELPER: FORMAT CURRENCY ---
const formatMoney = (amount) => '₱' + parseFloat(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// --- THE SECURITY BOUNCER (UPGRADED) ---
// This is your un-deletable Master Key. You will ALWAYS be able to log in.
const MASTER_EMAIL = "jgo031996@gmail.com";
// --- PERSISTENT LOGIN LISTENER (THE MEMORY) ---
auth.onAuthStateChanged(async (user) => {
  const loginScreen = document.getElementById('loginOverlay');

  if (user) {
    // Google remembers them! But we must double-check the VIP list just in case you fired them yesterday.
    let isAuthorized = false;
    if (user.email === MASTER_EMAIL) {
      isAuthorized = true;
    } else {
      const q = query(collection(db, "hq_managers"), where("email", "==", user.email));
      const snap = await getDocs(q);
      if (!snap.empty) isAuthorized = true;
    }

    if (isAuthorized) {
      // Still authorized! Let them straight in.
      window.sessionUser = {
        email: user.email,
        branch: 'Main Office',
        cashierName: user.displayName || 'Manager',
        isOwner: (user.email === MASTER_EMAIL)
      };

      let brDisp = document.getElementById('displayBranch');
      if (brDisp) brDisp.innerText = "📍 " + sessionUser.branch;
      let caDisp = document.getElementById('displayCashier');
      if (caDisp) caDisp.innerText = "👤 " + sessionUser.cashierName;

      if (loginScreen) loginScreen.style.display = 'none';
      window.switchView('dashboard');
      loadGlobalDashboard();
    } else {
      // They are logged into Google, but their HQ access was revoked! Kick them out.
      await signOut(auth);
      if (loginScreen) loginScreen.style.display = 'flex';
    }
  } else {
    // Nobody is logged in. Ensure the bouncer screen is visible.
    if (loginScreen) loginScreen.style.display = 'flex';
  }
});

window.loginWithGoogle = async function () {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    let isAuthorized = false;

    // 1. Check if it's the Master Owner
    if (user.email === MASTER_EMAIL) {
      isAuthorized = true;
    } else {
      // 2. If not the owner, check the Firebase VIP List
      const q = query(collection(db, "hq_managers"), where("email", "==", user.email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        isAuthorized = true;
      }
    }

    if (isAuthorized) {
      // SUCCESS! Open the gates.
      window.sessionUser = {
        email: user.email,
        branch: 'Main Office',
        cashierName: user.displayName || 'Manager',
        isOwner: (user.email === MASTER_EMAIL)
      };

      let brDisp = document.getElementById('displayBranch');
      if (brDisp) brDisp.innerText = "📍 " + sessionUser.branch;
      let caDisp = document.getElementById('displayCashier');
      if (caDisp) caDisp.innerText = "👤 " + sessionUser.cashierName;

      document.getElementById('loginOverlay').style.display = 'none';
      window.switchView('dashboard');
      loadGlobalDashboard();

    } else {
      // INTRUDER!
      await signOut(auth);
      alert(`Access Denied.\n\n${user.email} is not on the VIP list.`);
    }
  } catch (error) {
    console.error(error);
    alert("Login failed: " + error.message);
  }
};

// --- ACCESS CONTROL ENGINE ---
async function loadAdminDashboard() {
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="text-center">Loading personnel...</td></tr>';

  try {
    const snap = await getDocs(collection(db, "hq_managers"));
    let html = `
      <tr>
        <td><strong>${MASTER_EMAIL}</strong></td>
        <td><span class="badge badge-open">System Architect (Master Key)</span></td>
        <td style="color: var(--text-muted); font-size: 12px;">Cannot be removed</td>
      </tr>
    `;

    snap.forEach(docSnap => {
      let data = docSnap.data();
      html += `
        <tr>
          <td><strong>${data.email}</strong></td>
          <td><span class="badge badge-closed">Appointed Manager</span></td>
          <td><button class="btn-refresh" style="color:var(--danger); border-color:var(--danger); padding:4px 8px; font-size:11px;" onclick="removeHqManager('${docSnap.id}', '${data.email}')">✖ Revoke Access</button></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:red;">Error loading VIP list.</td></tr>';
  }
}

window.addHqManager = async function () {
  let emailInput = document.getElementById('newManagerEmail');
  let email = emailInput.value.trim().toLowerCase();

  if (!email || !email.includes('@')) { alert("Please enter a valid email address."); return; }
  if (email === MASTER_EMAIL) { alert("That is the Master Key email. It already has permanent access."); emailInput.value = ''; return; }

  try {
    // Check if they are already on the list
    const q = query(collection(db, "hq_managers"), where("email", "==", email));
    const snap = await getDocs(q);
    if (!snap.empty) {
      alert("This email is already on the VIP list!");
      emailInput.value = ''; return;
    }

    await addDoc(collection(db, "hq_managers"), {
      email: email,
      addedAt: new Date()
    });

    alert(`✅ Success! ${email} has been granted access to the HQ.`);
    emailInput.value = '';
    loadAdminDashboard();
  } catch (e) {
    console.error(e); alert("Failed to add manager.");
  }
};

window.removeHqManager = async function (docId, email) {
  if (!confirm(`Are you sure you want to REVOKE access for ${email}? They will be immediately locked out.`)) return;
  try {
    await deleteDoc(doc(db, "hq_managers", docId));
    loadAdminDashboard();
  } catch (e) { console.error(e); alert("Failed to remove manager."); }
};

// --- THE GLOBAL RADAR ENGINE (TRANSACTION-FIRST UPGRADE) ---
async function loadGlobalDashboard() {
  const startDateInput = document.getElementById('dashStartDate');
  const endDateInput = document.getElementById('dashEndDate');

  if (!startDateInput.value) startDateInput.valueAsDate = new Date();
  if (!endDateInput.value) endDateInput.valueAsDate = new Date();

  const startOfDay = new Date(startDateInput.value);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(endDateInput.value);
  endOfDay.setHours(23, 59, 59, 999);

  let globalGross = 0; let globalNet = 0; let globalExp = 0;
  const branches = ['Cabantian', 'Citygate', 'Maa'];
  let tableHtml = '';

  try {
    for (let branch of branches) {
      // 1. Fetch Sales & Expenses (Same as before)
      const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
      const txSnap = await getDocs(txQ);
      let branchGross = 0; let branchNet = 0; let branchCashIn = 0;

      txSnap.forEach(tDoc => {
        let tx = tDoc.data();
        if (tx.status !== "Voided") {
          branchNet += (tx.netTotal || 0);
          let txGross = 0;
          if (tx.cart) { tx.cart.forEach(item => { txGross += ((item.variantPrice || 0) * (item.qty || 1)); }); } else { txGross = tx.netTotal; }
          branchGross += txGross;
          if (tx.paymentMethod === 'Cash') branchCashIn += (tx.netTotal || 0);
        }
      });

      const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
      const expSnap = await getDocs(expQ);
      let branchExp = 0;
      expSnap.forEach(eDoc => { branchExp += (eDoc.data().amount || 0); });

      // 2. FETCH SHIFT DATA (The missing link)
      const shiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("startTime", ">=", startOfDay), orderBy("startTime", "desc"), limit(1));
      const shiftSnap = await getDocs(shiftQ);

      let shiftData = !shiftSnap.empty ? shiftSnap.docs[0].data() : null;
      let isActive = shiftData && shiftData.active === true;
      let isClosed = shiftData && shiftData.status === "Closed";

      let displayCashier = shiftData ? (shiftData.cashier || '-') : '-';

      // Calculate Live Expected Cash for Active shifts
      let expectedCash = 0;
      if (isActive) {
        expectedCash = (shiftData.startingCash || 0) + branchCashIn - branchExp;
      } else if (isClosed) {
        expectedCash = shiftData.expectedCash || 0;
      }

      // Calculate Variance (Short/Over)
      let varianceHtml = '<span style="color: var(--text-muted);">-</span>';
            if (isClosed) {
          // Instead of doing math on zeros, tell the manager exactly where the money went!
          varianceHtml = `<span style="color: #10b981; font-weight: bold; font-style: italic;">Saved to Z-Reading ✓</span>`;
      } else if (isActive) {
          // Keep the normal text for active shifts
          varianceHtml = `<span style="color: #64748b; font-style: italic;">Shift in progress...</span>`;
      }

      globalGross += branchGross; globalNet += branchNet; globalExp += branchExp;

      if (txSnap.empty && expSnap.empty && !shiftData) {
        tableHtml += `<tr><td><strong style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="openBranchDetails('${branch}')">${branch} </strong></td><td><span class="badge badge-closed"><span class="status-dot gray"></span> No Data</span></td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td></tr>`;
        continue;
      }

      let shiftBadge = isActive
        ? '<span class="badge badge-active"><span class="status-dot green"></span> Active</span>'
        : (isClosed ? '<span class="badge badge-closed"><span class="status-dot gray"></span> Closed</span>' : '<span class="badge badge-closed">No Shift</span>');

      tableHtml += `
        <tr>
          <td><strong style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="openBranchDetails('${branch}')">${branch} </strong></td>
          <td>${shiftBadge}</td>
          <td>${displayCashier}</td>
          <td style="font-weight: 600; color: var(--primary);">${formatMoney(branchNet)}</td>
          <td style="color: var(--danger);">${formatMoney(branchExp)}</td>
          <td style="font-weight: 700;">${(isActive || isClosed) ? formatMoney(expectedCash) : '-'}</td>
          <td>${varianceHtml}</td>
        </tr>
      `;
    }

    document.getElementById('globalGross').innerText = formatMoney(globalGross);
    document.getElementById('globalNet').innerText = formatMoney(globalNet);
    document.getElementById('globalExpenses').innerText = formatMoney(globalExp);
    document.getElementById('branchTableBody').innerHTML = tableHtml;

  } catch (error) {
    console.error("Radar Engine Error:", error);
    document.getElementById('branchTableBody').innerHTML = '<tr><td colspan="7" class="text-center" style="color: red;">Error connecting to Cloud Database.</td></tr>';
  }
}

// --- WIRING THE BUTTONS ---
// Run the radar the moment the page loads
document.addEventListener("DOMContentLoaded", () => {
  loadGlobalDashboard();

  // Wire up the Refresh Button
  const refreshBtn = document.getElementById('btnRefreshData');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.innerText = "Scanning Cloud...";
      refreshBtn.style.opacity = "0.7";
      await loadGlobalDashboard();
      refreshBtn.innerText = "🔄 Refresh Live Data";
      refreshBtn.style.opacity = "1";
    });
  }
});

// --- THE HR & SECURITY ENGINE ---
async function loadHRModule() {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Fetching secure staff records...</td></tr>';

  try {
    const snap = await getDocs(collection(db, "cashiers"));
    let html = '';

    // 🛡️ THE GATEKEEPER: Check if the logged-in person is the Master Owner
    const isOwner = window.sessionUser && window.sessionUser.isOwner;

    if (snap.empty) {
      html = '<tr><td colspan="5" class="text-center">No staff found. Click "Add New Staff" to create one.</td></tr>';
    } else {
      snap.forEach(docSnap => {
        let data = docSnap.data();

        // 🔐 PIN LOGIC: Real PIN for Owner, Stars for Managers
        let pinDisplay = isOwner ? (data.pin || '0000') : '****';

        html += `
          <tr>
            <td><strong style="font-size: 15px;">👤 ${data.cashierName || 'Unknown'}</strong></td>
            <td>📍 ${data.branch || 'Unassigned'}</td>
            <td><span class="badge badge-active">${data.role || 'Cashier'}</span></td>
            <td style="font-family: monospace; font-size: 18px; letter-spacing: 2px; color: var(--danger); font-weight: bold;">
              ${pinDisplay}
            </td>
            <td>
              <button class="btn-refresh" style="background: white; border: 1px solid var(--primary); color: var(--primary); padding: 5px 10px; margin-right: 5px;" onclick="openEditStaff('${docSnap.id}', '${data.cashierName}', '${data.branch}')">✏️ Edit</button>
              <button class="btn-refresh" style="background: white; border: 1px solid #666; color: #666; padding: 5px 10px;" onclick="resetStaffPin('${docSnap.id}', '${data.cashierName}')">🔑 Reset PIN</button>
            </td>
          </tr>
        `;
      });
    }
    tbody.innerHTML = html;
  } catch (error) {
    console.error("HR Engine Error:", error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error loading staff records.</td></tr>';
  }
}

window.openEditStaff = function (id, name, currentBranch) {
  document.getElementById('editStaffId').value = id;
  document.getElementById('editStaffName').value = name;
  document.getElementById('editStaffBranch').value = currentBranch;
  document.getElementById('editStaffModal').style.display = 'flex';
};

window.saveStaffEdit = async function () {
  let btn = document.getElementById('btnSaveStaffEdit');
  btn.innerText = "⏳ Saving..."; btn.disabled = true;

  let id = document.getElementById('editStaffId').value;
  let newBranch = document.getElementById('editStaffBranch').value;

  try {
    await updateDoc(doc(db, "users", id), { branch: newBranch });
    document.getElementById('editStaffModal').style.display = 'none';
    loadHRModule(); // Refresh the table
    alert(`✅ Staff reassigned to ${newBranch}.`);
  } catch (e) {
    console.error(e); alert("Failed to reassign staff.");
  } finally {
    btn.innerText = "💾 Save Assignment"; btn.disabled = false;
  }
};

window.addNewStaff = async function () {
  let name = prompt("Enter new staff name:");
  if (!name) return;

  let branch = prompt("Enter Branch (Cabantian, Citygate, Maa):");
  if (!branch) return;

  let pin = prompt("Create a 4-digit PIN for them:");
  if (!pin || pin.length !== 4 || isNaN(pin)) {
    alert("❌ Error: PIN must be exactly 4 numbers."); return;
  }

  try {
    await addDoc(collection(db, "cashiers"), {
      cashierName: name,
      branch: branch,
      pin: pin,
      role: "Cashier"
    });
    alert(`✅ Success! ${name} added to ${branch}.`);
    loadHRModule();
  } catch (error) {
    alert("❌ Failed to add staff.");
  }
};

// ========================================================
// 🔐 STAFF PIN RESET ENGINE
// ========================================================
window.resetStaffPin = async function (staffId, staffName) {
  // 1. Ask the manager for the new PIN
  let newPin = prompt(`Enter a new 4-digit PIN for ${staffName}:`);

  // If they click Cancel or leave it blank, do nothing
  if (!newPin) return;

  // 2. Strict Security: Make sure it is exactly 4 numbers
  if (!/^\d{4}$/.test(newPin.trim())) {
    alert("❌ Invalid format. The PIN must be exactly 4 digits (e.g., 1234).");
    return;
  }

  // 3. Send it to the Cloud Database
  try {
    // NOTE: Change "staff" to whatever your database folder is actually called!
    await updateDoc(doc(db, "cashiers", staffId), {
      pin: newPin.trim()
    });

    alert(`✅ Security PIN for ${staffName} has been successfully updated!`);

    // Refresh the table to show the update (change this to your actual load function name if it's different)
    if (typeof loadStaffManagement === 'function') {
      loadHRModule();
    }
  } catch (error) {
    console.error("PIN Reset Error:", error);
    alert("❌ Failed to update the PIN in the database.");
  }
};

// --- THE LIVE SECURITY FEED ENGINE ---

// We start listening the moment the app opens, no matter what tab you are on!
onSnapshot(query(collection(db, "manager_alerts"), orderBy("timestamp", "desc")), (snapshot) => {
  let html = '';
  let unreadCount = 0;

  if (snapshot.empty) {
    html = '<tr><td colspan="4" class="text-center" style="padding: 40px; color: var(--success); font-weight: bold;">🛡️ No security alerts. Your empire is safe.</td></tr>';
  } else {
    snapshot.forEach(docSnap => {
      let data = docSnap.data();
      if (!data.isRead) unreadCount++;

      let timeStr = "Just now";
      if (data.timestamp && data.timestamp.toDate) {
        timeStr = data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      // Unread alerts have a red background, read alerts are faded out
      html += `
              <tr style="${data.isRead ? 'opacity: 0.5; background: transparent;' : 'background: var(--danger-light);'}">
                <td style="font-size: 12px; color: var(--text-muted); font-family: monospace;">${timeStr}</td>
                <td><strong>📍 ${data.branch}</strong></td>
                <td><span style="color: ${data.isRead ? 'var(--text-muted)' : 'var(--danger)'}; font-weight: ${data.isRead ? 'normal' : 'bold'};">⚠️ ${data.message}</span></td>
                <td>
                  ${!data.isRead
          ? `<button class="btn-refresh" style="color: var(--success); border-color: var(--success); background: white;" onclick="dismissAlert('${docSnap.id}')">✓ Mark Resolved</button>`
          : '<span style="color: var(--success); font-weight: bold; font-size: 13px;">✓ Resolved</span>'}
                </td>
              </tr>
            `;
    });
  }

  // Inject into the table
  const tbody = document.getElementById('alertsTableBody');
  if (tbody) tbody.innerHTML = html;

  // THE MAGIC: Update the Sidebar Notification Badge anywhere in the app!
  const navAlerts = document.getElementById('nav-alerts');
  if (navAlerts) {
    if (unreadCount > 0) {
      navAlerts.innerHTML = `🚨 Security Alerts <span style="background: var(--danger); color: white; padding: 2px 8px; border-radius: 20px; font-size: 11px; margin-left: 10px; font-weight: bold; box-shadow: 0 0 8px rgba(239, 68, 68, 0.6); animation: pulse 2s infinite;">${unreadCount} New</span>`;
    } else {
      navAlerts.innerHTML = `🚨 Security Alerts`;
    }
  }
});

window.dismissAlert = async function (docId) {
  try {
    // When you click Mark Resolved, it instantly updates the cloud
    await updateDoc(doc(db, "manager_alerts", docId), { isRead: true });
  } catch (e) {
    console.error(e); alert("Failed to dismiss alert. Check connection.");
  }
};

// --- NAVIGATION SYSTEM ---
window.switchView = function (viewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  // Remove highlight from all sidebar items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // --- SMART DATE CONTROLS ---
  // Only show the date pickers on specific tabs
  const dateControls = document.getElementById('globalDateControls');
  if (dateControls) {
    const allowedViews = ['dashboard', 'accounts', 'payroll', 'dispatch'];
    if (allowedViews.includes(viewId)) {
      dateControls.style.display = 'flex';
    } else {
      dateControls.style.display = 'none';
    }
  }
  // Show the requested view
  document.getElementById('view-' + viewId).classList.add('active');
  // Highlight the requested sidebar item
  document.getElementById('nav-' + viewId).classList.add('active');

  // Change the top title
  let title = "Global Dashboard";
  if (viewId === 'transfers') title = "Cash Transfers Explorer";
  if (viewId === 'devices') title = "Device Fleet Management";
  if (viewId === 'branches') title = "Staff & Security Management";
  if (viewId === 'menu') title = "Central Menu Editor";
  if (viewId === 'alerts') title = "Security Alerts";
  if (viewId === 'inventory') title = "Live Inventory Dashboard";
  if (viewId === 'accounts') title = "Financial Control Center";
  if (viewId === 'payroll') title = "Payroll Engine & HR Logs";
  if (viewId === 'products') title = "Menu Costing & BOM";
  if (viewId === 'purchases') title = "Purchases & Alerts";
  if (viewId === 'dispatch') title = "Logistics & Dispatch";
  if (viewId === 'zreading') title = "Z-Reading Reports";
  if (viewId === 'expenses') title = "Expense & Restock Feed";
  if (viewId === 'admin') title = "HQ Access Control";
  if (viewId === 'receipt') title = "Thermal Printer Setup";
  if (viewId === 'schedule') {
        title = "Schedule & Shift Manager";
        loadFromCloud(); // Wakes up your new imported engine!
    }
  document.getElementById('pageTitle').innerText = title;

  // Trigger the engine for that specific page
  if (viewId === 'dashboard') loadGlobalDashboard();
  if (viewId === 'branches') loadHRModule();
  if (viewId === 'menu') loadMenuEditor();
  if (viewId === 'inventory') loadInventoryData();
  if (viewId === 'accounts') loadAccountsAndBudget();
  if (viewId === 'payroll') loadPayrollDashboard();
  if (viewId === 'products') loadMenuCosting();
  if (viewId === 'purchases') loadPurchasesAndAlerts();
  if (viewId === 'dispatch') loadDispatchDashboard();
  if (viewId === 'zreading') loadZReadingReports();
  if (viewId === 'expenses') loadExpenseLogs();
  if (viewId === 'admin') loadAdminDashboard();
};

window.switchInvTab = function (tab) {
  // 1. Change the Tab Colors
  document.getElementById('tab-inv-live').style.color = (tab === 'live') ? 'var(--primary)' : 'var(--text-muted)';
  document.getElementById('tab-inv-live').style.borderBottom = (tab === 'live') ? '3px solid var(--primary)' : 'none';

  document.getElementById('tab-inv-logs').style.color = (tab === 'logs') ? 'var(--primary)' : 'var(--text-muted)';
  document.getElementById('tab-inv-logs').style.borderBottom = (tab === 'logs') ? '3px solid var(--primary)' : 'none';

  // 2. Hide/Show the correct screens
  document.getElementById('invTabLiveContent').style.display = (tab === 'live') ? 'block' : 'none';
  document.getElementById('invTabLogsContent').style.display = (tab === 'logs') ? 'block' : 'none';

  // 🔥 3. THE FIX: If they click the Logs tab, wake up the engine and fetch the data!
  if (tab === 'logs') {
    loadStockLogs();
  }
};

window.refreshInventoryView = function () {
  loadInventoryData();
  loadStockLogs();
};

// ========================================================
// 🔥 PURCHASES & ALERTS + MULTI-RESTOCK ENGINE 🔥
// ========================================================
window.globalInventoryList = []; // Memory cache for the restock dropdown
let restockCart = [];

window.loadPurchasesAndAlerts = async function () {
  const tbody = document.getElementById('alertsPurchasesBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center">Scanning inventory levels...</td></tr>';

  let branchFilter = document.getElementById('alertBranchFilter').value;

  try {
    const snap = await getDocs(collection(db, "inventory"));
    let html = '';
    window.globalInventoryList = []; // Reset memory

    snap.forEach(docSnap => {
      let data = docSnap.data();
      data.id = docSnap.id;
      window.globalInventoryList.push(data); // Save for the restock modal

      if (branchFilter !== "All" && data.branch !== branchFilter) return; // Filter

      let stock = parseFloat(data.currentStock) || 0;
      let reorder = parseFloat(data.reorderLevel) || 0;

      // If stock is below or equal to the safe line, Trigger Alert!
      if (stock <= reorder) {
        let suggested = (reorder * 2) - stock; // Basic logic: Buy enough to double the safe line
        if (suggested <= 0) suggested = reorder;

        html += `
          <tr>
            <td><strong>${data.branch}</strong></td>
            <td><span class="badge badge-closed">${data.category || '-'}</span></td>
            <td style="font-weight: bold;">${data.name}</td>
            <td style="color: var(--danger); font-weight: bold;">${stock} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${data.uom}</span></td>
            <td>${reorder} <span style="font-size:12px; color:var(--text-muted);">${data.uom}</span></td>
            <td style="color: var(--primary); font-weight: bold;">${suggested} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${data.uom}</span></td>
            <td><button class="btn-refresh" style="background: white; color: var(--primary); border: 1px solid var(--primary);" onclick="openMultiRestockModal('${data.id}')">📦 Restock</button></td>
          </tr>
        `;
      }
    });

    tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="color: var(--success); font-weight: bold; padding: 40px;">✅ All inventory levels are optimal. No alerts.</td></tr>';
  } catch (e) {
    console.error(e); tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Error loading alerts.</td></tr>';
  }
};

// --- THE RESTOCK MODAL LOGIC ---
window.openMultiRestockModal = async function (preSelectId = null) {
  document.getElementById('restockModal').style.display = 'flex';
  restockCart = [];
  renderRestockCart();

  // If the global list is empty (because they clicked from Inventory instead of Alerts), fetch it
  if (window.globalInventoryList.length === 0) {
    const snap = await getDocs(collection(db, "inventory"));
    snap.forEach(d => { let obj = d.data(); obj.id = d.id; window.globalInventoryList.push(obj); });
  }

  let drop = document.getElementById('restockItemSelect');
  drop.innerHTML = '<option value="">-- Select Item --</option>';

  // Sort alphabetically so it is easy to find
  let sortedList = [...window.globalInventoryList].sort((a, b) => a.name.localeCompare(b.name));

  sortedList.forEach(item => {
    let selected = (preSelectId === item.id) ? "selected" : "";
    let stockDisplay = `${parseFloat(item.currentStock || 0).toFixed(0)} ${item.uom}`;
    drop.innerHTML += `<option value="${item.id}" ${selected}>${item.name} (${item.branch}) - Stock: ${stockDisplay}</option>`;
  });

  updateRestockUomLabel();
};

window.updateRestockUomLabel = function () {
  let itemId = document.getElementById('restockItemSelect').value;
  let label = document.getElementById('restockQtyLabel');
  if (!itemId) { label.innerText = "No. of packs"; return; }

  let item = window.globalInventoryList.find(i => i.id === itemId);
  if (item) {
    label.innerText = `No. of ${item.purchaseUom || 'units'}s`;
  }
};

window.addRestockToCart = function () {
  let itemId = document.getElementById('restockItemSelect').value;
  let purchQty = parseFloat(document.getElementById('restockQtyInput').value);

  if (!itemId || isNaN(purchQty) || purchQty <= 0) { alert("Select an item and enter a valid quantity."); return; }

  let item = window.globalInventoryList.find(i => i.id === itemId);
  let convRate = parseFloat(item.conversionRate) || 1;
  let baseQtyToAdd = purchQty * convRate; // MATH MAGiC!

  restockCart.push({
    id: item.id,
    name: item.name,
    branch: item.branch,
    purchQty: purchQty,
    purchUom: item.purchaseUom || 'units',
    baseQtyToAdd: baseQtyToAdd,
    baseUom: item.uom
  });

  document.getElementById('restockQtyInput').value = '';
  renderRestockCart();
};

window.removeRestockItem = function (index) {
  restockCart.splice(index, 1);
  renderRestockCart();
};

window.renderRestockCart = function () {
  let tbody = document.getElementById('restockCartBody');
  if (restockCart.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:var(--text-muted);">Cart is empty.</td></tr>'; return; }

  let html = '';
  restockCart.forEach((cartItem, idx) => {
    html += `
      <tr>
        <td>
          <strong style="font-size: 15px;">${cartItem.name}</strong> <span style="font-size:11px; color:var(--text-muted);">(${cartItem.branch})</span><br>
          <span style="font-size:12px; color:var(--success); font-weight:bold;">(+${cartItem.baseQtyToAdd.toLocaleString()} ${cartItem.baseUom} to stock)</span>
        </td>
        <td style="font-weight:bold; font-size: 16px;">${cartItem.purchQty} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${cartItem.purchUom}s</span></td>
        <td><button onclick="removeRestockItem(${idx})" style="color:var(--danger); border:1px solid var(--danger); background:white; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">✖</button></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
};

window.confirmMultiRestock = async function () {
  if (restockCart.length === 0) { alert("Cart is empty!"); return; }

  let btn = document.getElementById('btnConfirmRestock');
  btn.innerText = "⏳ Processing..."; btn.disabled = true;

  try {
    for (let cartItem of restockCart) {
      let itemRef = doc(db, "inventory", cartItem.id);
      let memoryItem = window.globalInventoryList.find(i => i.id === cartItem.id);
      let currentStock = parseFloat(memoryItem.currentStock) || 0;
      let newStock = currentStock + cartItem.baseQtyToAdd;

      await updateDoc(itemRef, { currentStock: newStock });

      // 🔥 FIRE INTO THE LOG BOOK
      await addDoc(collection(db, "stock_logs"), {
        branch: cartItem.branch,
        item: cartItem.name,
        uom: cartItem.baseUom,
        oldQty: currentStock,
        newQty: newStock,
        variance: cartItem.baseQtyToAdd,
        type: "Restock",
        user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
        timestamp: new Date()
      });
    }

    alert(`✅ Successfully restocked ${restockCart.length} items!`);
    document.getElementById('restockModal').style.display = 'none';

    // Refresh whatever screen they are currently looking at!
    if (document.getElementById('view-purchases').classList.contains('active')) loadPurchasesAndAlerts();
    if (document.getElementById('view-inventory').classList.contains('active')) loadInventoryData();

  } catch (e) {
    console.error(e); alert("Failed to process restock.");
  } finally {
    btn.innerText = "Confirm Restock"; btn.disabled = false;
  }
};

// --- THE DISPATCH & LOGISTICS ENGINE ---
let dispatchCart = [];
let dispatchInventoryList = [];

async function loadDispatchDashboard() {
  const branches = ["Main Office", "Cabantian", "Citygate", "Maa"];
  let fromHtml = '<option value="">-- Select Source --</option>';
  let toHtml = '<option value="">-- Select Destination --</option>';

  branches.forEach(b => {
    fromHtml += `<option value="${b}">${b}</option>`;
    toHtml += `<option value="${b}">${b}</option>`;
  });

  // Set defaults
  document.getElementById('dispFrom').innerHTML = fromHtml;
  document.getElementById('dispFrom').value = "Main Office";
  document.getElementById('dispTo').innerHTML = toHtml;

  dispatchCart = [];
  renderDispatchCart();
  await loadDispatchInventory();
  await loadDispatchLogs();
}

window.loadDispatchInventory = async function () {
  let fromBranch = document.getElementById('dispFrom').value;
  let drop = document.getElementById('dispItem');
  if (!fromBranch) { drop.innerHTML = '<option value="">Select source branch first</option>'; return; }

  drop.innerHTML = '<option value="">Scanning warehouse...</option>';
  dispatchInventoryList = [];

  try {
    const q = query(collection(db, "inventory"), where("branch", "==", fromBranch));
    const snap = await getDocs(q);
    let html = '<option value="">-- Select Item to Send --</option>';

    snap.forEach(docSnap => {
      let data = docSnap.data();
      if (data.currentStock > 0) {
        dispatchInventoryList.push({ id: docSnap.id, ...data });
        html += `<option value="${data.name}">${data.name} (Available: ${data.currentStock} ${data.uom})</option>`;
      }
    });

    drop.innerHTML = html || '<option value="">No available stock</option>';
  } catch (e) { console.error(e); drop.innerHTML = '<option value="">Error loading stock</option>'; }
};

window.addToDispatchCart = function () {
  let itemName = document.getElementById('dispItem').value;
  let qty = parseFloat(document.getElementById('dispQty').value);

  if (!itemName || isNaN(qty) || qty <= 0) { alert("Please select an item and valid quantity."); return; }

  // Prevent sending more than we have
  let invItem = dispatchInventoryList.find(i => i.name === itemName);
  if (invItem && qty > invItem.currentStock) { alert(`❌ Not enough stock! Only ${invItem.currentStock} available.`); return; }

  let existing = dispatchCart.find(i => i.itemName === itemName);
  if (existing) { existing.qty += qty; }
  else { dispatchCart.push({ itemName, qty, uom: invItem.uom, sourceId: invItem.id }); }

  document.getElementById('dispQty').value = '';
  renderDispatchCart();
};

window.removeFromDispatchCart = function (index) {
  dispatchCart.splice(index, 1);
  renderDispatchCart();
};

function renderDispatchCart() {
  const tbody = document.getElementById('dispatchCartBody');
  if (dispatchCart.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="text-center">Cart is empty.</td></tr>'; return; }

  let html = '';
  dispatchCart.forEach((item, idx) => {
    html += `<tr>
      <td><strong>${item.itemName}</strong></td>
      <td style="font-size:16px; font-weight:bold;">${item.qty} <span style="font-size:12px; color:var(--text-muted);">${item.uom}</span></td>
      <td><button class="btn-refresh" style="color:var(--danger); border-color:var(--danger); padding:4px 8px; font-size:11px;" onclick="removeFromDispatchCart(${idx})">✖ Remove</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

window.submitMultiDispatch = async function () {
  let fromBranch = document.getElementById('dispFrom').value;
  let toBranch = document.getElementById('dispTo').value;

  if (!fromBranch || !toBranch) { alert("Please select Source and Destination branches."); return; }
  if (fromBranch === toBranch) { alert("Source and Destination cannot be the same."); return; }
  if (dispatchCart.length === 0) { alert("Cart is empty."); return; }

  let btn = document.getElementById('btnSubmitDispatch');
  btn.innerText = "🚀 Processing Delivery..."; btn.disabled = true;

  try {
    for (let item of dispatchCart) {
      // 1. Deduct from Source
      let sourceRef = doc(db, "inventory", item.sourceId);
      let invItem = dispatchInventoryList.find(i => i.id === item.sourceId);
      await updateDoc(sourceRef, { currentStock: invItem.currentStock - item.qty });

      // 2. Add to Destination (Find it or Create it)
      const targetQ = query(collection(db, "inventory"), where("branch", "==", toBranch), where("name", "==", item.itemName));
      const targetSnap = await getDocs(targetQ);

      if (targetSnap.empty) {
        // Create new item in target branch
        await addDoc(collection(db, "inventory"), {
          branch: toBranch, name: item.itemName, category: invItem.category, uom: invItem.uom, baseCost: invItem.baseCost, currentStock: item.qty, reorderLevel: 5
        });
      } else {
        // Update existing item
        let tRef = targetSnap.docs[0].ref;
        let tStock = targetSnap.docs[0].data().currentStock || 0;
        await updateDoc(tRef, { currentStock: tStock + item.qty });
      }

      // 3. Log the dispatch
      await addDoc(collection(db, "dispatch_logs"), {
        date: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
        timestamp: new Date(),
        item: item.itemName,
        qty: item.qty,
        uom: item.uom,
        details: `${fromBranch} ➡️ ${toBranch}`
      });
    }

    alert(`✅ Success! Dispatched ${dispatchCart.length} items to ${toBranch}.`);
    dispatchCart = [];
    renderDispatchCart();
    loadDispatchInventory();
    loadDispatchLogs();
    btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false;

  } catch (e) { console.error(e); alert("Dispatch failed."); btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false; }
};

async function loadDispatchLogs() {
  const tbody = document.getElementById('dispatchLogBody');
  tbody.innerHTML = '<tr><td class="text-center">Loading logs...</td></tr>';
  try {
    // Only fetch the 20 most recent deliveries to keep it lightning fast
    const qLogs = query(collection(db, "dispatch_logs"), orderBy("timestamp", "desc"));
    const snap = await getDocs(qLogs);
    let html = '';
    if (snap.empty) { html = '<tr><td class="text-center">No recent deliveries.</td></tr>'; }
    else {
      snap.forEach(doc => {
        let d = doc.data();
        html += `<tr><td>
          <div style="font-weight:bold; color:var(--primary); font-size:14px;">${d.item} <span style="color:var(--text-main);">(${d.qty} ${d.uom})</span></div>
          <div style="font-size:12px; color:var(--text-muted);">${d.details} | ${d.date} ${d.time}</div>
        </td></tr>`;
      });
    }
    tbody.innerHTML = html;
  } catch (e) { console.error(e); tbody.innerHTML = '<tr><td class="text-center" style="color:red;">Error loading logs</td></tr>'; }
}

// --- THE MENU EDITOR ENGINE ---
async function loadMenuEditor() {
  const tbody = document.getElementById('menuTableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Fetching global menu...</td></tr>';

  try {
    // We pull from the exact same "menu" collection the POS uses!
    const snap = await getDocs(collection(db, "menu"));
    let html = '';

    if (snap.empty) {
      html = '<tr><td colspan="4" class="text-center">Menu is empty. Click "Add Menu Item" to start.</td></tr>';
    } else {
      // Let's sort them alphabetically so it looks clean
      let items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      items.sort((a, b) => a.name.localeCompare(b.name));

      items.forEach(data => {
        let safePrice = parseFloat(data.price) || 0;
        html += `
          <tr>
            <td><strong> ${data.name}</strong></td>
            <td><span class="badge badge-closed">${data.category || 'Uncategorized'}</span></td>
            <td style="font-weight: 600; color: var(--primary);">${formatMoney(safePrice)}</td>
            <td style="display: flex; gap: 10px;">
              <button class="btn-refresh" onclick="editMenuItem('${data.id}', '${data.name}', ${safePrice})">✏️ Edit Price</button>
              <button class="btn-refresh" style="color: var(--danger); border-color: var(--danger);" onclick="deleteMenuItem('${data.id}', '${data.name}')">🗑️ Delete</button>
            </td>
          </tr>
        `;
      });
    }
    tbody.innerHTML = html;
  } catch (error) {
    console.error("Menu Engine Error:", error);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: red;">Error loading menu.</td></tr>';
  }
}

window.addMenuItem = async function () {
  let name = prompt("Enter new item name (e.g., Spicy Takoyaki):");
  if (!name) return;

  let category = prompt("Enter Category (e.g., Takoyaki, Milk Tea, Coffee):");
  if (!category) return;

  let priceStr = prompt(`Enter Base Price for ${name} (₱):`);
  if (!priceStr) return;

  let price = parseFloat(priceStr);
  if (isNaN(price) || price < 0) { alert("❌ Error: Invalid price."); return; }

  try {
    // Saves it directly to the cloud!
    await addDoc(collection(db, "menu"), { name: name, category: category, price: price });
    alert(`✅ Success! ${name} added to the global menu.`);
    loadMenuEditor();
  } catch (error) {
    console.error(error); alert("❌ Failed to add item.");
  }
};

window.editMenuItem = async function (docId, name, currentPrice) {
  let newPriceStr = prompt(`Enter new price for ${name}:`, currentPrice);
  if (!newPriceStr) return;

  let newPrice = parseFloat(newPriceStr);
  if (isNaN(newPrice) || newPrice < 0) { alert("❌ Error: Invalid price."); return; }

  try {
    await updateDoc(doc(db, "menu", docId), { price: newPrice });
    alert(`✅ Success! ${name} is now ₱${newPrice.toFixed(2)}.`);
    loadMenuEditor();
  } catch (error) {
    console.error(error); alert("❌ Failed to update price.");
  }
};

window.deleteMenuItem = async function (docId, name) {
  if (!confirm(`⚠️ ARE YOU SURE?\n\nThis will permanently delete ${name} from the menu at ALL branches.`)) return;

  try {
    await deleteDoc(doc(db, "menu", docId));
    alert(`🗑️ ${name} has been deleted.`);
    loadMenuEditor();
  } catch (error) {
    console.error(error); alert("❌ Failed to delete item.");
  }
};

// --- DETAILED BRANCH ANALYTICS ENGINE ---
window.openBranchDetails = async function (branch) {
  document.getElementById('analyticsModal').style.display = 'flex';
  document.getElementById('modalBranchName').innerText = `📊 ${branch} Analytics`;

  // Read both dates!
  const startDateInput = document.getElementById('dashStartDate');
  const endDateInput = document.getElementById('dashEndDate');
  const startDay = new Date(startDateInput.value);
  const endDay = new Date(endDateInput.value);

  // Display the range in the modal
  document.getElementById('modalDateDisplay').innerText = `${startDay.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} - ${endDay.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  document.getElementById('mdlNet').innerText = "Loading...";
  document.getElementById('tbCatBody').innerHTML = '<tr><td colspan="3" class="text-center">Calculating...</td></tr>';

  const startOfDay = new Date(startDay.setHours(0, 0, 0, 0));
  const endOfDay = new Date(endDay.setHours(23, 59, 59, 999));

  try {
    // 2. Fetch all transactions for this specific branch and date
    const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
    const txSnap = await getDocs(txQ);

    let netSales = 0; let totalItems = 0; let transCount = 0; let voidCount = 0;
    let categories = {}; // To track Best Sellers
    let payments = {};   // To track Cash vs GCash
    let transHtml = '';

    // Sort transactions by time (newest first)
    let allTx = [];
    txSnap.forEach(doc => allTx.push(doc.data()));
    allTx.sort((a, b) => b.timestamp - a.timestamp);

    allTx.forEach(tx => {
      let timeStr = tx.timestamp ? tx.timestamp.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : 'Unknown';

      if (tx.status === "Voided") {
        voidCount++;
        transHtml += `<tr style="opacity: 0.5;"><td>${timeStr}</td><td>${tx.receiptId}</td><td>-</td><td><span class="badge badge-closed"><span class="status-dot red"></span> VOID</span></td><td style="text-decoration: line-through;">${formatMoney(tx.netTotal)}</td></tr>`;
      } else {
        transCount++;
        netSales += (tx.netTotal || 0);

        // Track Payments
        let payMethod = tx.paymentMethod || "Unknown";
        if (!payments[payMethod]) payments[payMethod] = 0;
        payments[payMethod] += (tx.netTotal || 0);

        // Track Categories & Items
        if (tx.cart && Array.isArray(tx.cart)) {
          tx.cart.forEach(item => {
            let qty = item.qty || 1;
            totalItems += qty;

            // Assume category is passed from POS. If missing, label 'Uncategorized'
            let cat = item.category || 'Food/Drink';
            if (!categories[cat]) categories[cat] = { qty: 0, sales: 0 };

            categories[cat].qty += qty;
            categories[cat].sales += ((item.variantPrice || 0) * qty);
          });
        }

        transHtml += `<tr><td>${timeStr}</td><td><strong>${tx.receiptId}</strong></td><td>${payMethod}</td><td><span class="badge badge-active"><span class="status-dot green"></span> PAID</span></td><td style="font-weight: 600; color: var(--primary);">${formatMoney(tx.netTotal)}</td></tr>`;
      }
    });

    // ... (Your existing transaction loop finishes here) ...

    // --- UPGRADED DRAWER CASH & AUDIT ENGINE ---

    // 1. Fetch Expenses for today
    const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
    const expSnap = await getDocs(expQ);
    let dateExpenses = 0;
    expSnap.forEach(doc => dateExpenses += (doc.data().amount || 0));

    // 2. Fetch the Active Shift
    const shiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true));
    const shiftSnap = await getDocs(shiftQ);

    // 3. FETCH THE PREVIOUS CLOSED SHIFT (The Audit Trail)
    const prevShiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("status", "==", "Closed"), orderBy("endTime", "desc"), limit(1));
    const prevShiftSnap = await getDocs(prevShiftQ);
    let lastClosingCash = prevShiftSnap.empty ? 0 : (prevShiftSnap.docs[0].data().declaredCash || 0);

    let startingCash = 0;
    let isActive = !shiftSnap.empty;

    if (isActive) {
      startingCash = shiftSnap.docs[0].data().startingCash || 0;
      let cashSales = payments['Cash'] || 0;
      let expectedDrawerCash = startingCash + cashSales - dateExpenses;

      document.getElementById('mdlDrawerCash').innerText = formatMoney(expectedDrawerCash);
      document.getElementById('mdlDrawerMath').innerHTML = `
        <b>Entered Float:</b> ${formatMoney(startingCash)}<br>
        <b>Expenses Paid:</b> ${formatMoney(dateExpenses)}
      `;

      // 🚨 THE VALIDATION LOGIC
      const auditEl = document.getElementById('mdlAuditAlert');
      if (startingCash === lastClosingCash) {
        auditEl.innerHTML = `<span style="color: #16a34a;">✅ Matches Last Closing (₱${lastClosingCash})</span>`;
      } else {
        let diff = startingCash - lastClosingCash;
        let sign = diff > 0 ? "+" : "";
        auditEl.innerHTML = `<span style="color: #dc2626;">⚠️ DISCREPANCY: ${sign}${diff} vs Last Close</span>`;
      }

    } else {
      document.getElementById('mdlDrawerCash').innerText = "No Active Shift";
      document.getElementById('mdlDrawerMath').innerText = "Register is currently closed.";
      document.getElementById('mdlAuditAlert').innerText = "";
    }

    // 3. Inject KPIs
    document.getElementById('mdlNet').innerText = formatMoney(netSales);
    document.getElementById('mdlItems').innerText = totalItems;
    document.getElementById('mdlTrans').innerText = transCount;
    document.getElementById('mdlVoids').innerText = voidCount;

    // 4. Inject Categories
    let catHtml = '';
    for (let cat in categories) {
      catHtml += `<tr><td><strong>${cat}</strong></td><td>${categories[cat].qty} items</td><td style="color: var(--primary); font-weight: 600;">${formatMoney(categories[cat].sales)}</td></tr>`;
    }
    document.getElementById('tbCatBody').innerHTML = catHtml || '<tr><td colspan="3" class="text-center">No items sold.</td></tr>';

    // 5. Inject Payments
    let payHtml = '';
    for (let p in payments) {
      payHtml += `<tr><td><strong>${p}</strong></td><td style="color: var(--success); font-weight: 600;">${formatMoney(payments[p])}</td></tr>`;
    }
    document.getElementById('tbPayBody').innerHTML = payHtml || '<tr><td colspan="2" class="text-center">No payments logged.</td></tr>';

    // 6. Inject Transactions
    document.getElementById('tbTransBody').innerHTML = transHtml || '<tr><td colspan="5" class="text-center">No transactions on this date.</td></tr>';

  } catch (error) {
    console.error("Analytics Error:", error);
    document.getElementById('tbCatBody').innerHTML = '<tr><td colspan="3" class="text-center" style="color: red;">Error loading analytics.</td></tr>';
  }
};

// --- THE LIVE INVENTORY ENGINE (UPGRADED WITH FILTERING) ---
async function loadInventoryData() {
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="text-center">Scanning warehouse...</td></tr>';

  let branchFilter = document.getElementById('invBranchFilter').value;

  // THE FIX: Check if search element exists before trying to read .value
  const searchEl = document.getElementById('liveInvSearch');
  let searchQuery = searchEl ? searchEl.value.toLowerCase() : '';

  try {
    const snap = await getDocs(collection(db, "inventory"));
    let html = '';
    let totalItems = 0;
    let totalValue = 0;

    let items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    items.sort((a, b) => a.name.localeCompare(b.name));

    items.forEach(data => {
      // 1. Filter by Branch
      if (branchFilter !== "All" && data.branch !== branchFilter) return;

      // 2. Filter by Search (Only if search bar is added back later, otherwise ignored)
      if (searchQuery && !data.name.toLowerCase().includes(searchQuery)) return;

      totalItems++;
      let stock = parseFloat(data.currentStock) || 0;
      let cost = parseFloat(data.baseCost) || 0;
      totalValue += (stock * cost);

      let statusBadge = '<span class="badge" style="background:#e8f5e9; color:#15803d;">In Stock</span>';
      if (stock <= 0) statusBadge = '<span class="badge" style="background:#fef2f2; color:#b91c1c;">Out of Stock</span>';
      else if (stock <= (data.reorderLevel || 5)) statusBadge = '<span class="badge" style="background:#fffbeb; color:#b45309;">Low Stock</span>';

      let editData = encodeURIComponent(JSON.stringify({ id: data.id, name: data.name, branch: data.branch, stock: stock, uom: data.uom }));

      html += `
        <tr>
          <td><strong style="color: var(--text-muted);">${data.branch}</strong></td>
          <td style="font-weight: 700; font-size: 15px;">${data.name}</td>
          <td style="color: var(--text-muted);">${data.category || '-'}</td>
          <td style="font-size: 15px;"><strong>${stock.toLocaleString()}</strong> <span style="font-size: 12px; color: var(--text-muted);">${data.uom || ''}</span></td>
          <td style="color: var(--danger); font-weight: bold;">0 <span style="font-size: 11px; font-weight: normal; color: var(--text-muted);">(--)</span></td>
          <td>${statusBadge}</td>
          <td>${formatMoney(cost)}</td>
          <td>
            <button class="btn-refresh" style="background: white; color: var(--text-main); border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px;" onclick="openEditInv('${editData}')">✏️ Edit</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="8" class="text-center">No items found for this branch.</td></tr>';
    document.getElementById('invTotalItems').innerText = totalItems;
    document.getElementById('invTotalValue').innerText = formatMoney(totalValue);

  } catch (error) {
    console.error("Inventory Error:", error);
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: red;">Error loading inventory.</td></tr>';
  }
}

window.addNewInventoryItem = async function () {
  let branch = prompt("Enter Branch (Main Office, Cabantian, Citygate, Maa):", "Main Office");
  if (!branch) return;
  let name = prompt("Enter Raw Material Name (e.g., Flour, Takoyaki Sauce):");
  if (!name) return;
  let category = prompt("Enter Category (Ingredients, Packaging, Beverage):", "Ingredients");
  if (!category) return;
  let uom = prompt("Enter Unit of Measurement (e.g., kg, grams, pcs):", "kg");
  if (!uom) return;
  let costStr = prompt(`Enter Cost per ${uom} (₱):`);
  let cost = parseFloat(costStr);
  if (isNaN(cost)) { alert("❌ Invalid cost."); return; }

  let initStockStr = prompt(`Enter Initial Stock Level (in ${uom}):`, "0");
  let initStock = parseFloat(initStockStr) || 0;

  try {
    await addDoc(collection(db, "inventory"), { branch: branch, name: name, category: category, uom: uom, baseCost: cost, currentStock: initStock, reorderLevel: 5 });
    alert(`✅ Success! ${name} added to ${branch} warehouse.`);
    loadInventoryData();
  } catch (error) {
    console.error(error); alert("❌ Failed to add item.");
  }
};

window.restockItem = async function () {
  let itemName = prompt("Enter the EXACT name of the item you received a delivery for:");
  if (!itemName) return;
  let addedStockStr = prompt(`How many units did you receive?`);
  let addedStock = parseFloat(addedStockStr);
  if (isNaN(addedStock) || addedStock <= 0) { alert("❌ Invalid quantity."); return; }

  try {
    // Find the item first
    const q = query(collection(db, "inventory"), where("name", "==", itemName));
    const snap = await getDocs(q);

    if (snap.empty) { alert("❌ Item not found. Check the spelling exactly as it appears in the table."); return; }

    // Update the stock!
    let docRef = snap.docs[0].ref;
    let currentData = snap.docs[0].data();
    let newStock = (parseFloat(currentData.currentStock) || 0) + addedStock;

    await updateDoc(docRef, { currentStock: newStock });
    alert(`📦 Success! Added ${addedStock} to ${itemName}. New total: ${newStock}.`);
    loadInventoryData();
  } catch (error) {
    console.error(error); alert("❌ Failed to restock.");
  }
};

// ========================================================
// 🔥 THE KITCHEN BATCH PREP ENGINE 🔥
// ========================================================

window.openBatchModal = function () {
  document.getElementById('batchModal').style.display = 'flex';
  document.getElementById('batchBranch').value = '';
  document.getElementById('batchItem').innerHTML = '<option value="">Select branch first...</option>';
  document.getElementById('batchQty').value = '';
};

window.loadBatchItemsDropdown = async function () {
  let branch = document.getElementById('batchBranch').value;
  let drop = document.getElementById('batchItem');
  if (!branch) { drop.innerHTML = '<option value="">Select branch first...</option>'; return; }

  drop.innerHTML = '<option value="">Scanning inventory...</option>';

  try {
    // Fetch all inventory items in this branch
    const q = query(collection(db, "inventory"), where("branch", "==", branch));
    const snap = await getDocs(q);

    let html = '<option value="">-- Select Prepared Item --</option>';
    let itemsFound = false;

    snap.forEach(docSnap => {
      let data = docSnap.data();
      // We assume items that are prepared in-house have a category like "Prepared" or "Intermediate", 
      // but to be safe, we list everything that could possibly have a recipe.
      html += `<option value="${data.name}">${data.name} (Current: ${data.currentStock} ${data.uom})</option>`;
      itemsFound = true;
    });

    drop.innerHTML = itemsFound ? html : '<option value="">No items found in this branch.</option>';
  } catch (e) {
    console.error(e); drop.innerHTML = '<option value="">Error loading items</option>';
  }
};

window.executeBatchPrep = async function () {
  let branch = document.getElementById('batchBranch').value;
  let targetItem = document.getElementById('batchItem').value;
  let prepQty = parseFloat(document.getElementById('batchQty').value);

  if (!branch || !targetItem || isNaN(prepQty) || prepQty <= 0) {
    alert("Please fill all fields correctly."); return;
  }

  let btn = document.getElementById('btnExecuteBatch');
  btn.innerText = "⏳ Checking Raw Materials..."; btn.disabled = true;

  try {
    // 1. Get the Recipe (BOM) for the item they want to make
    const bomQ = query(collection(db, "bom"), where("menuItem", "==", targetItem));
    const bomSnap = await getDocs(bomQ);

    if (bomSnap.empty) {
      alert(`❌ Missing Recipe!\n\nYou haven't set up a recipe for "${targetItem}" in the Menu Costing & BOM tab yet.`);
      btn.innerText = "🚀 Mix & Deduct Ingredients"; btn.disabled = false;
      return;
    }

    // 2. Build the exact requirement list and CHECK STOCK FIRST
    let requirements = [];
    for (let docSnap of bomSnap.docs) {
      let recipeIngredient = docSnap.data();
      let totalNeeded = recipeIngredient.qty * prepQty;

      // Find this ingredient in the selected branch's inventory
      const invQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", recipeIngredient.ingredientName));
      const invSnap = await getDocs(invQ);

      if (invSnap.empty) {
        alert(`❌ Missing Inventory Item!\n\nYour recipe requires "${recipeIngredient.ingredientName}", but it doesn't exist in the ${branch} warehouse.`);
        btn.innerText = "🚀 Mix & Deduct Ingredients"; btn.disabled = false;
        return;
      }

      let invRef = invSnap.docs[0].ref;
      let currentStock = invSnap.docs[0].data().currentStock || 0;

      // ANTI-FRAUD: Check if they actually have enough raw materials to make this batch!
      if (currentStock < totalNeeded) {
        alert(`❌ Insufficient Raw Materials!\n\nYou need ${totalNeeded} of ${recipeIngredient.ingredientName} to make this batch, but you only have ${currentStock} in stock at ${branch}.`);
        btn.innerText = "🚀 Mix & Deduct Ingredients"; btn.disabled = false;
        return;
      }

      // Save the calculation for the actual deduction phase
      requirements.push({ ref: invRef, newStock: currentStock - totalNeeded });
    }

    // 3. IF WE MADE IT HERE, WE HAVE ENOUGH OF EVERYTHING! LETS DEDUCT.
    btn.innerText = "⏳ Mixing Batch...";
    for (let req of requirements) {
      await updateDoc(req.ref, { currentStock: req.newStock });
    }

    // 4. ADD the new prepared batch to the inventory
    const targetQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", targetItem));
    const targetSnap = await getDocs(targetQ);
    let targetRef = targetSnap.docs[0].ref;
    let targetStock = targetSnap.docs[0].data().currentStock || 0;

    await updateDoc(targetRef, { currentStock: targetStock + prepQty });

    // Success!
    alert(`🥣 Kitchen Success!\n\nPrepared ${prepQty} units of ${targetItem}.\nAll raw ingredients were automatically deducted from ${branch}.`);
    document.getElementById('batchModal').style.display = 'none';
    loadInventoryData(); // Refresh the table

  } catch (error) {
    console.error(error); alert("Failed to prepare batch.");
  } finally {
    btn.innerText = "🚀 Mix & Deduct Ingredients"; btn.disabled = false;
  }
};

// --- THE CASH ACCOUNTS & BUDGET ENGINE ---
async function loadAccountsAndBudget() {
  const accBody = document.getElementById('accTableBody');
  const budBody = document.getElementById('budgetListBody');
  if (!accBody || !budBody) return;

  try {
    // 1. Fetch Cash Accounts
    const accSnap = await getDocs(collection(db, "cash_accounts"));
    let accHtml = ''; let totalCash = 0;
    window.liveAccounts = []; // We save this in memory for the Transfer Dropdowns

    accSnap.forEach(doc => {
      let data = doc.data();
      totalCash += (data.balance || 0);
      window.liveAccounts.push({ id: doc.id, ...data });
      accHtml += `<tr><td><span class="badge badge-closed">${data.branch}</span></td><td><strong>${data.name}</strong></td><td style="font-weight: 700; color: var(--success); font-size: 15px;">${formatMoney(data.balance || 0)}</td></tr>`;
    });
    accBody.innerHTML = accHtml || '<tr><td colspan="3" class="text-center">No accounts found.</td></tr>';
    document.getElementById('accTotalCash').innerText = formatMoney(totalCash);

    // 2. Fetch Budgets
    const budSnap = await getDocs(collection(db, "budgets"));
    let budHtml = ''; let totalBud = 0; let totalSpent = 0;
    window.liveBudgets = []; // We save this in memory for the Expense Dropdowns

    budSnap.forEach(doc => {
      let data = doc.data();
      totalBud += (data.limit || 0);
      totalSpent += (data.spent || 0);
      window.liveBudgets.push({ id: doc.id, ...data });

      let pct = data.limit > 0 ? (data.spent / data.limit) * 100 : 0;
      let barColor = pct >= 90 ? 'var(--danger)' : (pct >= 75 ? '#f59e0b' : 'var(--primary)');
      if (pct > 100) pct = 100;

      budHtml += `
        <div style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
            <strong>${data.category} <span style="color: var(--text-muted); font-weight: normal;">(${data.branch})</span></strong>
            <span style="color: var(--text-muted); font-weight: 600;">${formatMoney(data.spent)} / ${formatMoney(data.limit)}</span>
          </div>
          <div style="background: var(--bg-color); height: 10px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border);">
            <div style="background: ${barColor}; height: 100%; width: ${pct}%; transition: 0.3s ease;"></div>
          </div>
        </div>
      `;
    });
    budBody.innerHTML = budHtml || '<div class="text-center" style="color: var(--text-muted);">No budget categories found.</div>';
    document.getElementById('accTotalBudget').innerText = formatMoney(totalBud);
    document.getElementById('accTotalSpent').innerText = formatMoney(totalSpent);

  } catch (error) {
    console.error("Finance Engine Error:", error);
    accBody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:red;">Error loading data.</td></tr>';
  }
}

window.addCashAccount = async function () {
  let branch = prompt("Enter Branch (Main Office, Cabantian, Citygate, Maa):", "Main Office");
  if (!branch) return;
  let name = prompt("Account Name (e.g., Petty Cash, BDO, GCash):");
  if (!name) return;
  let bal = parseFloat(prompt("Initial Balance (₱):", "0")) || 0;

  try {
    await addDoc(collection(db, "cash_accounts"), { branch, name, balance: bal });
    loadAccountsAndBudget();
  } catch (e) { console.error(e); alert("Failed to add account."); }
};

window.transferCash = async function () {
  if (!window.liveAccounts || window.liveAccounts.length < 2) { alert("You need at least 2 accounts to make a transfer."); return; }

  // Create a simple text menu for selecting accounts
  let accList = window.liveAccounts.map((a, i) => `[${i}] ${a.name} (${a.branch}) - Bal: ₱${a.balance}`).join('\n');

  let fromIdx = parseInt(prompt("TRANSFER FROM (Enter the Number):\n\n" + accList));
  if (isNaN(fromIdx) || !window.liveAccounts[fromIdx]) return;

  let toIdx = parseInt(prompt("TRANSFER TO (Enter the Number):\n\n" + accList));
  if (isNaN(toIdx) || !window.liveAccounts[toIdx] || fromIdx === toIdx) return;

  let amt = parseFloat(prompt("Amount to Transfer (₱):"));
  if (isNaN(amt) || amt <= 0) return;

  let fromAcc = window.liveAccounts[fromIdx];
  let toAcc = window.liveAccounts[toIdx];

  if (fromAcc.balance < amt) { alert("❌ Insufficient funds in " + fromAcc.name); return; }

  try {
    await updateDoc(doc(db, "cash_accounts", fromAcc.id), { balance: fromAcc.balance - amt });
    await updateDoc(doc(db, "cash_accounts", toAcc.id), { balance: toAcc.balance + amt });
    alert(`✅ Successfully transferred ₱${amt} from ${fromAcc.name} to ${toAcc.name}.`);
    loadAccountsAndBudget();
  } catch (e) { console.error(e); alert("Transfer failed."); }
};

window.addBudgetCategory = async function () {
  let branch = prompt("Branch (Cabantian, Citygate, Maa):", "Cabantian");
  if (!branch) return;
  let category = prompt("Budget Category (e.g., Rent, Electric, Packaging):");
  if (!category) return;
  let limit = parseFloat(prompt("Monthly Budget Limit (₱):", "0")) || 0;

  try {
    await addDoc(collection(db, "budgets"), { branch, category, limit, spent: 0 });
    loadAccountsAndBudget();
  } catch (e) { console.error(e); alert("Failed to add category."); }
};

window.logExpense = async function () {
  if (!window.liveBudgets || window.liveBudgets.length === 0) { alert("Add a Budget Category first."); return; }
  if (!window.liveAccounts || window.liveAccounts.length === 0) { alert("Add a Cash Account first."); return; }

  let catList = window.liveBudgets.map((b, i) => `[${i}] ${b.category} (${b.branch})`).join('\n');
  let catIdx = parseInt(prompt("SELECT BUDGET CATEGORY (Enter Number):\n\n" + catList));
  if (isNaN(catIdx) || !window.liveBudgets[catIdx]) return;

  let accList = window.liveAccounts.map((a, i) => `[${i}] ${a.name} (${a.branch})`).join('\n');
  let accIdx = parseInt(prompt("DEDUCT FROM ACCOUNT (Enter Number):\n\n" + accList));
  if (isNaN(accIdx) || !window.liveAccounts[accIdx]) return;

  let amt = parseFloat(prompt("Expense Amount (₱):"));
  if (isNaN(amt) || amt <= 0) return;

  let note = prompt("Notes/Description (e.g., August Rent):", "");

  let selBud = window.liveBudgets[catIdx];
  let selAcc = window.liveAccounts[accIdx];

  if (selAcc.balance < amt) {
    if (!confirm(`⚠️ WARNING: ${selAcc.name} only has ₱${selAcc.balance}. Deducting this will make the account negative. Continue?`)) return;
  }

  try {
    // 1. Deduct from Cash Account
    await updateDoc(doc(db, "cash_accounts", selAcc.id), { balance: selAcc.balance - amt });
    // 2. Add to Budget Spent
    await updateDoc(doc(db, "budgets", selBud.id), { spent: selBud.spent + amt });

    // 3. THE MAGIC LINK: Log to Global "expenses" collection so the Dashboard Radar catches it!
    // We set the date to today, so it impacts today's drawer cash!
    const selectedDate = new Date(); // To match dashboard logic, we use current date
    await addDoc(collection(db, "expenses"), {
      branch: selBud.branch,
      amount: amt,
      category: selBud.category,
      account: selAcc.name,
      note: note,
      timestamp: selectedDate
    });

    alert(`🧾✅ Expense Logged! ₱${amt} deducted from ${selAcc.name}.`);
    loadAccountsAndBudget();
  } catch (e) { console.error(e); alert("Failed to log expense."); }
};

// --- THE PAYROLL & HR ENGINE ---
async function loadPayrollDashboard() {
  const tbody = document.getElementById('hrTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Scanning employee timesheets...</td></tr>';

  try {
    // Fetch all shifts
    const snap = await getDocs(collection(db, "shifts"));
    let shifts = [];
    snap.forEach(doc => shifts.push({ id: doc.id, ...doc.data() }));

    // Sort newest shifts first
    shifts.sort((a, b) => {
      let timeA = a.startTime ? a.startTime.toDate().getTime() : 0;
      let timeB = b.startTime ? b.startTime.toDate().getTime() : 0;
      return timeB - timeA;
    });

    let html = ''; let activeCount = 0; let totalHours = 0; let estPayroll = 0;

    // NOTE: This is an estimated default rate (₱65/hr). 
    // In a future update, we can pull exact rates from the Cashier's profile!
    const HOURLY_RATE = 65;

    if (shifts.length === 0) {
      html = '<tr><td colspan="6" class="text-center">No shifts logged yet.</td></tr>';
    } else {
      shifts.forEach(shift => {
        let start = shift.startTime ? shift.startTime.toDate() : new Date();
        let end = shift.endTime ? shift.endTime.toDate() : null;
        let dateStr = start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        let timeIn = start.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        let timeOut = end ? end.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '<span class="status-dot green"></span> Active';

        let hoursStr = `<span style="color: var(--text-muted);">Pending</span>`;
        let payHtml = `<span style="color: var(--text-muted);">Calculating...</span>`;

        if (shift.active) activeCount++;

        // Only calculate pay if the shift is finished
        if (end) {
          let diffMs = end - start;
          let hrs = diffMs / (1000 * 60 * 60); // Convert milliseconds to hours
          totalHours += hrs;
          let basePay = hrs * HOURLY_RATE;

          let bonus = shift.payrollBonus || 0;
          let deduct = shift.payrollDeduct || 0;
          let finalPay = basePay + bonus - deduct;
          estPayroll += finalPay;

          hoursStr = `<strong>${hrs.toFixed(2)} hrs</strong>`;
          payHtml = `
            <div style="display: flex; gap: 10px; align-items: center;">
              <span style="font-weight: 700; color: var(--success); font-size: 15px;">${formatMoney(finalPay)}</span>
              <button class="btn-refresh" style="padding: 4px 10px; font-size: 11px;" onclick="adjustPayroll('${shift.id}', '${shift.cashier}', ${basePay})">✏️ Adjust</button>
            </div>
            ${(bonus > 0 || deduct > 0) ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">(Base: ${formatMoney(basePay)} | +${formatMoney(bonus)} | -${formatMoney(deduct)})</div>` : ''}
          `;
        }

        html += `
          <tr>
            <td style="color: var(--text-muted); font-weight: 600;">${dateStr}</td>
            <td><strong>👤 ${shift.cashier}</strong></td>
            <td><span class="badge badge-closed">${shift.branch}</span></td>
            <td style="font-family: monospace; font-size: 13px;">${timeIn} -> ${timeOut}</td>
            <td>${hoursStr}</td>
            <td>${payHtml}</td>
          </tr>
        `;
      });
    }

    tbody.innerHTML = html;
    document.getElementById('hrActiveStaff').innerText = activeCount;
    document.getElementById('hrTotalHours').innerText = totalHours.toFixed(1);
    document.getElementById('hrTotalPayroll').innerText = formatMoney(estPayroll);

  } catch (error) {
    console.error("HR Engine Error:", error);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading shifts.</td></tr>';
  }
}

window.adjustPayroll = async function (shiftId, name, basePay) {
  let bonus = parseFloat(prompt(`Adding BONUS for ${name}.\nBase Pay is ${formatMoney(basePay)}.\n\nEnter bonus amount (₱):`, "0")) || 0;
  let deduct = parseFloat(prompt(`Adding DEDUCTION for ${name}.\n\nEnter deduction amount (₱):`, "0")) || 0;

  if (bonus === 0 && deduct === 0) return;

  try {
    await updateDoc(doc(db, "shifts", shiftId), { payrollBonus: bonus, payrollDeduct: deduct });
    alert(`✅ Success! Payroll recalculated for ${name}.`);
    loadPayrollDashboard();
  } catch (e) {
    console.error(e); alert("Failed to adjust payroll.");
  }
};

// --- MENU COSTING & BOM ENGINE ---
let globalInventoryCosts = {};
let currentEditingMenuItem = "";

// ========================================================
// 🔥 TABBED MENU COSTING & SEARCH ENGINE 🔥
// ========================================================
window.activeCostingTab = 'All';

window.switchCostingTab = function (element, tabName) {
  window.activeCostingTab = tabName;

  // Reset all tabs
  document.querySelectorAll('.costing-tab').forEach(el => {
    el.style.color = 'var(--text-muted)';
    el.style.borderBottom = 'none';
  });

  // Highlight the clicked tab
  element.style.color = 'var(--primary)';
  element.style.borderBottom = '3px solid var(--primary)';

  // Reload the table
  loadMenuCosting();
};

// ========================================================
// 🔥 DYNAMIC TABBED MENU COSTING & SEARCH ENGINE 🔥
// ========================================================
window.activeCostingTab = 'All';

window.switchCostingTab = function (element, tabName) {
  window.activeCostingTab = tabName;
  loadMenuCosting(); // This redraws the table AND the tabs to highlight the right one!
};

async function loadMenuCosting() {
  const tbody = document.getElementById('bomTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Calculating margins...</td></tr>';

  let searchQuery = document.getElementById('costingSearch') ? document.getElementById('costingSearch').value.toLowerCase() : '';

  try {
    // 1. Get Live Inventory Costs
    const invSnap = await getDocs(collection(db, "inventory"));
    globalInventoryCosts = {};
    invSnap.forEach(doc => {
      let data = doc.data();
      globalInventoryCosts[data.name] = { cost: parseFloat(data.baseCost) || 0, uom: data.uom };
    });

    // 2. Get Recipes
    const bomSnap = await getDocs(collection(db, "bom"));
    let recipes = {};
    bomSnap.forEach(doc => {
      let data = doc.data();
      if (!recipes[data.menuItem]) recipes[data.menuItem] = [];
      recipes[data.menuItem].push({ id: doc.id, ...data });
    });

    // 3. Get Menu & Collect Unique Categories!
    const menuSnap = await getDocs(collection(db, "menu"));
    let html = '';
    let totalMarginPct = 0; let menuCount = 0; let missingBomCount = 0;

    let items = [];
    let uniqueCategories = new Set(); // 🔥 This collects every unique category you type!

    menuSnap.forEach(doc => {
      let d = doc.data();
      items.push({ id: doc.id, ...d });
      if (d.category) uniqueCategories.add(d.category.trim());
    });

    // 🔥 GENERATE THE DYNAMIC TABS
    let tabsHtml = `<div class="costing-tab" style="padding-bottom: 10px; font-weight: bold; cursor: pointer; ${window.activeCostingTab === 'All' ? 'color: var(--primary); border-bottom: 3px solid var(--primary);' : 'color: var(--text-muted); border-bottom: none;'}" onclick="switchCostingTab(this, 'All')">All Items</div>`;

    let sortedCats = Array.from(uniqueCategories).sort();
    sortedCats.forEach(cat => {
      let isActive = (window.activeCostingTab === cat);
      let style = isActive ? 'color: var(--primary); border-bottom: 3px solid var(--primary);' : 'color: var(--text-muted); border-bottom: none;';
      tabsHtml += `<div class="costing-tab" style="padding-bottom: 10px; font-weight: bold; cursor: pointer; ${style}" onclick="switchCostingTab(this, '${cat}')">${cat}</div>`;
    });

    // Inject the new tabs into the HTML
    let tabContainer = document.getElementById('costingTabsContainer');
    if (tabContainer) tabContainer.innerHTML = tabsHtml;

    // 4. Sort and Filter the Table
    items.sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''));

    items.forEach(item => {
      // TAB FILTER
      if (window.activeCostingTab !== 'All' && item.category !== window.activeCostingTab) return;
      // SEARCH FILTER
      if (searchQuery && !(item.name || '').toLowerCase().includes(searchQuery) && !(item.category || '').toLowerCase().includes(searchQuery)) return;

      let price = parseFloat(item.price) || 0;
      let recipe = recipes[item.name] || [];

      let cogs = 0;
      recipe.forEach(ing => {
        let currentCost = globalInventoryCosts[ing.ingredientName] ? globalInventoryCosts[ing.ingredientName].cost : 0;
        cogs += (currentCost * ing.qty);
      });

      let margin = price - cogs;
      let marginPct = price > 0 ? (margin / price) * 100 : 0;

      if (recipe.length === 0) missingBomCount++;
      else { totalMarginPct += marginPct; menuCount++; }

      let cogsDisplay = recipe.length > 0 ? formatMoney(cogs) : '<span style="color:var(--text-muted); font-size:12px;">No Recipe Setup</span>';
      let marginColor = margin > 0 ? 'var(--success)' : 'var(--danger)';

      html += `
        <tr>
          <td><span class="badge badge-closed">${item.category || 'Uncategorized'}</span></td>
          <td><strong>${item.name}</strong></td>
          <td style="font-weight: 600;">${formatMoney(price)}</td>
          <td style="color: var(--danger); font-weight: 600;">${cogsDisplay}</td>
          <td style="color: ${marginColor}; font-weight: 700;">${recipe.length > 0 ? formatMoney(margin) + ` <span style="font-size:11px; color:var(--text-muted);">(${marginPct.toFixed(0)}%)</span>` : '-'}</td>
          <td><button class="btn-refresh" style="background: white; border: 1px solid var(--primary); color: var(--primary); padding: 6px 12px; font-size: 12px;" onclick="openBomEditor('${item.name}')">✏️ Update</button></td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="6" class="text-center" style="padding: 40px; color: var(--text-muted);">No items found in "${window.activeCostingTab}".</td></tr>`;

    let avgMargin = menuCount > 0 ? (totalMarginPct / menuCount) : 0;
    document.getElementById('bomAvgMargin').innerText = avgMargin.toFixed(1) + '%';
    document.getElementById('bomMissing').innerText = missingBomCount;

  } catch (error) {
    console.error("Costing Engine Error:", error);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error connecting to Cloud Database.</td></tr>';
  }
}

window.openNewProductModal = function () {
  document.getElementById('advancedProductModal').style.display = 'flex';

  document.getElementById('advProdId').value = '';
  document.getElementById('advProdName').value = '';
  document.getElementById('advProdName').readOnly = false;

  // Auto-fill category if they are in a specific tab
  document.getElementById('advProdCat').value = window.activeCostingTab !== 'All' ? window.activeCostingTab : '';
  document.getElementById('advProdPrice').value = 0;

  window.currentAdvRecipe = [];
  renderAdvRecipeTable();
};

window.openNewProductModal = function () {
  document.getElementById('advancedProductModal').style.display = 'flex';

  // Clear the form
  document.getElementById('advProdId').value = '';
  document.getElementById('advProdName').value = '';
  document.getElementById('advProdName').readOnly = false; // Allow typing for new items!

  // Auto-fill the category based on whatever tab they are looking at!
  document.getElementById('advProdCat').value = window.activeCostingTab !== 'All' ? window.activeCostingTab : 'Main Menu';
  document.getElementById('advProdPrice').value = 0;

  window.currentAdvRecipe = [];
  renderAdvRecipeTable();
};

// --- ADVANCED INVENTORY ADDER ---
window.openAddInventoryModal = function () {
  document.getElementById('addInvModal').style.display = 'flex';
  // Clear old inputs
  document.getElementById('newInvName').value = '';
  document.getElementById('newInvPurchUom').value = '';
  document.getElementById('newInvBaseUom').value = '';
  document.getElementById('newInvConv').value = '';
  document.getElementById('newInvCost').value = '';
  document.getElementById('newInvInitQty').value = '';
  document.getElementById('newInvReorder').value = '';
  updateInvSummary();
};

window.updateInvSummary = function () {
  let pUom = document.getElementById('newInvPurchUom').value || '[Purch UOM]';
  let bUom = document.getElementById('newInvBaseUom').value || '[Base UOM]';
  let conv = parseFloat(document.getElementById('newInvConv').value) || 0;
  let cost = parseFloat(document.getElementById('newInvCost').value) || 0;
  let qty = parseFloat(document.getElementById('newInvInitQty').value) || 0;

  let totalBaseUnits = conv * qty;
  let costPerBaseUnit = conv > 0 ? (cost / conv) : 0;

  document.getElementById('newInvSummary').innerHTML =
    `<strong>Summary:</strong> You are adding <strong>${totalBaseUnits.toLocaleString()} ${bUom}</strong> to the cloud.<br>
     The system will calculate the recipe cost at <strong>₱${costPerBaseUnit.toFixed(4)} per ${bUom}</strong>.`;
};

window.saveAdvancedInventoryItem = async function () {
  let branch = document.getElementById('newInvBranch').value;
  let category = document.getElementById('newInvCat').value;
  let name = document.getElementById('newInvName').value.trim();
  let purchUom = document.getElementById('newInvPurchUom').value.trim();
  let baseUom = document.getElementById('newInvBaseUom').value.trim();

  let conv = parseFloat(document.getElementById('newInvConv').value);
  let cost = parseFloat(document.getElementById('newInvCost').value);
  let initQty = parseFloat(document.getElementById('newInvInitQty').value);
  let reorder = parseFloat(document.getElementById('newInvReorder').value) || 5000;

  if (!name || !purchUom || !baseUom || isNaN(conv) || isNaN(cost) || isNaN(initQty)) {
    alert("❌ Error: Please fill out all required fields with valid numbers."); return;
  }

  let btn = document.getElementById('btnSaveInv');
  btn.innerText = "⏳ Saving..."; btn.disabled = true;

  try {
    // Math Time!
    let totalBaseStock = conv * initQty;
    let baseCost = cost / conv; // This is the micro-cost used for Menu Costing!

    await addDoc(collection(db, "inventory"), {
      branch: branch,
      name: name,
      category: category,

      // We save both so the system remembers how you bought it
      purchaseUom: purchUom,
      uom: baseUom, // This is the Base UOM used everywhere else in the app
      conversionRate: conv,
      purchaseCost: cost,

      baseCost: baseCost, // What 1 gram costs
      currentStock: totalBaseStock, // We store 25000 grams, not 1 Sack
      reorderLevel: reorder
    });

    alert(`✅ Success! Added ${name} to ${branch}.`);
    document.getElementById('addInvModal').style.display = 'none';
    loadInventoryData();
  } catch (error) {
    console.error(error); alert("❌ Failed to add item.");
  } finally {
    btn.innerText = "💾 Save Item to Cloud"; btn.disabled = false;
  }
};

// ========================================================
// 🔥 ENTERPRISE PRODUCT & RECIPE EDITOR ENGINE 🔥
// ========================================================
window.currentAdvRecipe = []; // Stores the live rows in the modal

window.openBomEditor = async function (menuItemName) {
  // Overriding the old function call!
  document.getElementById('advancedProductModal').style.display = 'flex';
  document.getElementById('advProdName').value = menuItemName;
  document.getElementById('advRecipeBody').innerHTML = '<tr><td colspan="5" class="text-center">Loading product details...</td></tr>';

  try {
    // 1. Get the Menu Item Details
    const menuQ = query(collection(db, "menu"), where("name", "==", menuItemName));
    const menuSnap = await getDocs(menuQ);
    if (!menuSnap.empty) {
      let mData = menuSnap.docs[0].data();
      document.getElementById('advProdId').value = menuSnap.docs[0].id;
      document.getElementById('advProdCat').value = mData.category || '';
      document.getElementById('advProdPrice').value = mData.price || 0;
    }

    // 2. Get the existing Recipe (BOM)
    const bomQ = query(collection(db, "bom"), where("menuItem", "==", menuItemName));
    const bomSnap = await getDocs(bomQ);

    window.currentAdvRecipe = [];
    bomSnap.forEach(docSnap => {
      let data = docSnap.data();
      data.docId = docSnap.id; // Store Firebase ID so we can delete if needed
      window.currentAdvRecipe.push(data);
    });

    renderAdvRecipeTable();
  } catch (e) {
    console.error(e); alert("Failed to load product details.");
  }
};

window.renderAdvRecipeTable = function () {
  const tbody = document.getElementById('advRecipeBody');
  let html = '';
  let totalCost = 0;

  // Build the inventory dropdown options once to reuse
  let invOptions = '<option value="">-- Select Raw Ingredient --</option>';
  for (let invName in globalInventoryCosts) {
    invOptions += `<option value="${invName}">${invName}</option>`;
  }

  if (window.currentAdvRecipe.length === 0) {
    html = '<tr><td colspan="5" class="text-center" style="padding: 20px; color: var(--text-muted);">No ingredients added yet.</td></tr>';
  } else {
    window.currentAdvRecipe.forEach((item, index) => {
      let invData = globalInventoryCosts[item.ingredientName];
      let unitCost = invData ? invData.cost : 0;
      let uom = invData ? invData.uom : '-';
      let lineCost = unitCost * (item.qty || 0);
      totalCost += lineCost;

      // We use a select box if it's a new row, otherwise plain text
      let nameField = item.isNew
        ? `<select style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px;" onchange="updateAdvRecipeName(${index}, this.value)">
             ${invOptions.replace(`value="${item.ingredientName}"`, `value="${item.ingredientName}" selected`)}
           </select>`
        : `<input type="text" value="${item.ingredientName}" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; background: #f9fafb;" readonly>`;

      html += `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 5px;">${nameField}</td>
          <td style="padding: 10px 5px;"><input type="number" value="${item.qty || 0}" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px;" onkeyup="updateAdvRecipeQty(${index}, this.value)" onchange="updateAdvRecipeQty(${index}, this.value)"></td>
          <td style="padding: 10px 5px; color: #6b7280; font-size: 13px;">${uom}</td>
          <td style="padding: 10px 5px; font-weight: bold; color: #4b5563;">${formatMoney(lineCost)}</td>
          <td style="padding: 10px 5px; text-align: center;"><button onclick="removeAdvRecipeRow(${index})" style="background: none; border: none; cursor: pointer; color: #ef4444; font-size: 16px;">🗑️</button></td>
        </tr>
      `;
    });
  }

  tbody.innerHTML = html;
  document.getElementById('advTotalCost').innerText = formatMoney(totalCost);
  calcAdvProfit(totalCost);
};

window.addAdvRecipeRow = function () {
  window.currentAdvRecipe.push({ ingredientName: "", qty: 0, isNew: true });
  renderAdvRecipeTable();
};

window.updateAdvRecipeName = function (index, newName) {
  window.currentAdvRecipe[index].ingredientName = newName;
  renderAdvRecipeTable(); // Re-render to update UOM and Costs
};

window.updateAdvRecipeQty = function (index, newQty) {
  window.currentAdvRecipe[index].qty = parseFloat(newQty) || 0;
  // Calculate total immediately
  let totalCost = 0;
  window.currentAdvRecipe.forEach(item => {
    let invData = globalInventoryCosts[item.ingredientName];
    let unitCost = invData ? invData.cost : 0;
    totalCost += (unitCost * item.qty);
  });
  document.getElementById('advTotalCost').innerText = formatMoney(totalCost);
  calcAdvProfit(totalCost);
};

window.removeAdvRecipeRow = function (index) {
  // If it came from the database, we flag it for deletion upon saving
  if (window.currentAdvRecipe[index].docId) {
    if (!window.deletedAdvRecipes) window.deletedAdvRecipes = [];
    window.deletedAdvRecipes.push(window.currentAdvRecipe[index].docId);
  }
  window.currentAdvRecipe.splice(index, 1);
  renderAdvRecipeTable();
};

window.calcAdvProfit = function (forceCogs = null) {
  let sellPrice = parseFloat(document.getElementById('advProdPrice').value) || 0;

  let cogs = forceCogs;
  if (cogs === null) {
    cogs = 0;
    window.currentAdvRecipe.forEach(item => {
      let invData = globalInventoryCosts[item.ingredientName];
      cogs += ((invData ? invData.cost : 0) * (item.qty || 0));
    });
  }

  let margin = sellPrice - cogs;
  let marginPct = sellPrice > 0 ? (cogs / sellPrice) * 100 : 0;

  document.getElementById('profSellPrice').innerText = formatMoney(sellPrice);
  document.getElementById('profProdCost').innerText = formatMoney(cogs);
  document.getElementById('profMargin').innerText = formatMoney(margin);
  document.getElementById('profMargin').style.color = margin >= 0 ? '#15803d' : '#b91c1c';
  document.getElementById('profMarginPct').innerText = marginPct.toFixed(2) + '%';
  document.getElementById('profMarginPct').style.color = marginPct >= 50 ? '#b91c1c' : '#111827'; // Red if food cost is over 50%
};

window.saveAdvancedProduct = async function () {
  let btn = document.getElementById('btnSaveAdvProd');
  btn.innerText = "⏳ Saving..."; btn.disabled = true;

  let menuId = document.getElementById('advProdId').value;
  let prodName = document.getElementById('advProdName').value.trim();
  let category = document.getElementById('advProdCat').value.trim();
  let price = parseFloat(document.getElementById('advProdPrice').value) || 0;

  // Anti-Blank Name Shield
  if (!prodName) {
    alert("❌ Error: Product name is required.");
    btn.innerText = "Save Changes"; btn.disabled = false;
    return;
  }

  try {
    // 1. Save Menu Details (Update OR Create New)
    if (menuId) {
      await updateDoc(doc(db, "menu", menuId), { name: prodName, category: category, price: price });
    } else {
      // 🔥 THIS IS THE MISSING PIECE! Create the new product in the database.
      let newMenuRef = await addDoc(collection(db, "menu"), { name: prodName, category: category, price: price });
      document.getElementById('advProdId').value = newMenuRef.id; // Save the new ID
    }

    // 2. Delete removed recipe rows
    if (window.deletedAdvRecipes && window.deletedAdvRecipes.length > 0) {
      for (let delId of window.deletedAdvRecipes) {
        await deleteDoc(doc(db, "bom", delId));
      }
      window.deletedAdvRecipes = [];
    }

    // 3. Save / Update Recipe Rows
    for (let item of window.currentAdvRecipe) {
      if (!item.ingredientName || item.qty <= 0) continue; // Skip invalid rows

      if (item.docId && !item.isNew) {
        // Update existing ingredient row
        await updateDoc(doc(db, "bom", item.docId), { qty: item.qty });
      } else {
        // Add new ingredient row
        await addDoc(collection(db, "bom"), {
          menuItem: prodName, // Connects the recipe to the Product Name
          ingredientName: item.ingredientName,
          qty: item.qty
        });
      }
    }

    alert("✅ Product and Recipe saved successfully!");
    document.getElementById('advancedProductModal').style.display = 'none';
    loadMenuCosting(); // Refresh the main table to see the new item!
  } catch (error) {
    console.error(error); alert("Failed to save product.");
  } finally {
    btn.innerText = "Save Changes"; btn.disabled = false;
  }
};


// ========================================================
// 🔥 BULK CSV RECIPE UPLOADER ENGINE 🔥
// ========================================================
window.processRecipeCsvUpload = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const text = e.target.result;

    // Smart CSV Parser
    function parseCSV(str) {
      let arr = []; let quote = false; let row = 0; let col = 0;
      for (let c = 0; c < str.length; c++) {
        let cc = str[c], nc = str[c + 1];
        arr[row] = arr[row] || [];
        arr[row][col] = arr[row][col] || '';
        if (cc == '"' && quote && nc == '"') { arr[row][col] += cc; ++c; continue; }
        if (cc == '"') { quote = !quote; continue; }
        if (cc == ',' && !quote) { ++col; continue; }
        if (cc == '\r' && nc == '\n' && !quote) { ++row; col = 0; ++c; continue; }
        if (cc == '\n' && !quote) { ++row; col = 0; continue; }
        arr[row][col] += cc;
      }
      return arr;
    }

    const rows = parseCSV(text);
    let successCount = 0; let errorCount = 0;
    const uploadBtn = document.querySelector('button[onclick*="csvRecipeInput"]');
    uploadBtn.innerText = "⏳ Uploading Recipes..."; uploadBtn.disabled = true;

    try {
      // Expected CSV Format: Menu Item, Ingredient Name, Qty
      for (let i = 1; i < rows.length; i++) {
        let cols = rows[i];
        if (cols.length === 1 && cols[0].trim() === "") continue;
        if (cols.length < 3) { errorCount++; continue; }

        let menuItem = cols[0].trim();
        let ingredientName = cols[1].trim();
        let qty = parseFloat(cols[2].toString().replace(/[₱, ]/g, ''));

        if (!menuItem || !ingredientName || isNaN(qty)) {
          errorCount++; continue;
        }

        // We assume you are appending/creating recipes. 
        // Note: If you upload the same file twice, it will duplicate ingredients!
        await addDoc(collection(db, "bom"), {
          menuItem: menuItem,
          ingredientName: ingredientName,
          qty: qty
        });

        successCount++;
      }
      alert(`✅ Recipes Uploaded!\n\nAdded ${successCount} ingredient links.\nErrors: ${errorCount}`);
      loadMenuCosting();
    } catch (error) {
      console.error(error); alert("❌ Fatal Error.");
    } finally {
      uploadBtn.innerText = "📂 Upload CSV Recipes"; uploadBtn.disabled = false; event.target.value = '';
    }
  };
  reader.readAsText(file);
};

// ========================================================
// 🔥 BULK CSV UPLOADER (AUTO-CLEANING VERSION) 🔥
// ========================================================
window.processCsvUpload = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const text = e.target.result;

    function parseCSV(str) {
      let arr = []; let quote = false; let row = 0; let col = 0;
      for (let c = 0; c < str.length; c++) {
        let cc = str[c], nc = str[c + 1];
        arr[row] = arr[row] || [];
        arr[row][col] = arr[row][col] || '';
        if (cc == '"' && quote && nc == '"') { arr[row][col] += cc; ++c; continue; }
        if (cc == '"') { quote = !quote; continue; }
        if (cc == ',' && !quote) { ++col; continue; }
        if (cc == '\r' && nc == '\n' && !quote) { ++row; col = 0; ++c; continue; }
        if (cc == '\n' && !quote) { ++row; col = 0; continue; }
        arr[row][col] += cc;
      }
      return arr;
    }

    const rows = parseCSV(text);
    let successCount = 0; let errorCount = 0;
    const uploadBtn = document.querySelector('button[onclick*="csvFileInput"]');
    uploadBtn.innerText = "⏳ Cleaning & Uploading..."; uploadBtn.disabled = true;

    try {
      for (let i = 1; i < rows.length; i++) {
        let cols = rows[i];
        if (cols.length === 1 && cols[0].trim() === "") continue;
        if (cols.length < 9) { errorCount++; continue; }

        let name = cols[2].trim();

        // ✨ THE AUTO-CLEANER: Removes ₱, commas, and spaces from numbers
        const cleanNum = (val) => parseFloat(val.replace(/[₱, ]/g, ''));

        let conv = cleanNum(cols[5]);
        let cost = cleanNum(cols[6]);
        let initQty = cleanNum(cols[7]);
        let reorder = cleanNum(cols[8]);

        if (!name || isNaN(conv) || isNaN(cost)) {
          console.warn(`Row ${i + 1} failed validation:`, cols);
          errorCount++; continue;
        }

        await addDoc(collection(db, "inventory"), {
          branch: cols[0].trim(),
          category: cols[1].trim(),
          name: name,
          purchaseUom: cols[3].trim(),
          uom: cols[4].trim(),
          conversionRate: conv,
          purchaseCost: cost,
          baseCost: cost / conv,
          currentStock: conv * initQty,
          reorderLevel: reorder
        });
        successCount++;
      }
      alert(`✅ Mission Accomplished!\n\nAdded: ${successCount}\nErrors: ${errorCount}`);
      loadInventoryData();
    } catch (error) {
      console.error(error); alert("❌ Fatal Error.");
    } finally {
      uploadBtn.innerText = "📂 Bulk Upload CSV"; uploadBtn.disabled = false;
    }
  };
  reader.readAsText(file);
};

// ========================================================
// 🔥 STOCK HISTORY & LOGGING ENGINE 🔥
// ========================================================
async function loadStockLogs() {
  const tbody = document.getElementById('stockLogsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading history...</td></tr>';

  let branchFilter = document.getElementById('invBranchFilter').value;

  try {
    const qLogs = query(collection(db, "stock_logs"), orderBy("timestamp", "desc"));
    const snap = await getDocs(qLogs);
    let html = '';

    snap.forEach(doc => {
      let data = doc.data();
      if (branchFilter !== "All" && data.branch !== branchFilter) return;

      let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';

      let varHtml = '';
      if (data.type === "Restock") varHtml = `<span style="color: var(--success); font-weight: bold;">+${data.variance} ${data.uom} (Restock)</span>`;
      else if (data.variance > 0) varHtml = `<span style="color: var(--success); font-weight: bold;">+${data.variance} ${data.uom} (Manual)</span>`;
      else if (data.variance < 0) varHtml = `<span style="color: var(--danger); font-weight: bold;">${data.variance} ${data.uom} (Manual)</span>`;
      else varHtml = `<span style="color: var(--text-muted);">No Change</span>`;

      html += `
        <tr>
          <td style="font-size: 12px; color: var(--text-muted); font-family: monospace;">${dateStr}</td>
          <td><strong>${data.branch}</strong></td>
          <td>👤 ${data.user}</td>
          <td style="font-weight: 600;">${data.item}</td>
          <td>${data.oldQty} <span style="font-size:11px;">${data.uom}</span></td>
          <td><strong>${data.newQty} <span style="font-size:11px;">${data.uom}</span></strong></td>
          <td>${varHtml}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">No logs found.</td></tr>';
  } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Error loading logs.</td></tr>'; }
}

window.openEditInv = function (encodedData) {
  let data = JSON.parse(decodeURIComponent(encodedData));
  document.getElementById('editInvId').value = data.id;
  document.getElementById('editInvOldQty').value = data.stock;
  document.getElementById('editInvName').innerText = data.name;
  document.getElementById('editInvBranch').innerText = data.branch;
  document.getElementById('editInvUom').innerText = data.uom;
  document.getElementById('editInvNewQty').value = data.stock;
  document.getElementById('editInvModal').style.display = 'flex';
};

window.saveInventoryEdit = async function () {
  let id = document.getElementById('editInvId').value;
  let name = document.getElementById('editInvName').innerText;
  let branch = document.getElementById('editInvBranch').innerText;
  let uom = document.getElementById('editInvUom').innerText;
  let oldQty = parseFloat(document.getElementById('editInvOldQty').value);
  let newQty = parseFloat(document.getElementById('editInvNewQty').value);

  if (isNaN(newQty)) { alert("Invalid quantity"); return; }
  let variance = newQty - oldQty;
  if (variance === 0) { document.getElementById('editInvModal').style.display = 'none'; return; }

  let btn = document.getElementById('btnSaveInvEdit');
  btn.innerText = "⏳ Saving..."; btn.disabled = true;

  try {
    // 1. Update Inventory
    await updateDoc(doc(db, "inventory", id), { currentStock: newQty });

    // 2. Write to Permanent Log
    await addDoc(collection(db, "stock_logs"), {
      branch: branch,
      item: name,
      uom: uom,
      oldQty: oldQty,
      newQty: newQty,
      variance: variance,
      type: "Manual Update",
      user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
      timestamp: new Date()
    });

    document.getElementById('editInvModal').style.display = 'none';
    refreshInventoryView();
  } catch (e) { console.error(e); alert("Failed to save."); }
  finally { btn.innerText = "💾 Save & Log Variance"; btn.disabled = false; }
};

// ========================================================
// 🧹 CLEAN SLATE PROTOCOL (FACTORY RESET) 🧹
// ========================================================
window.wipeTestData = async function () {
  // 1. The Ultimate Security Check
  let confirmWord = prompt(
    "⚠️ DANGER ZONE ⚠️\n\n" +
    "This will permanently delete ALL:\n" +
    "- Transactions / Sales\n" +
    "- Stock History Logs\n" +
    "- Dispatch Deliveries\n" +
    "- Shifts\n" +
    "- Expenses\n\n" +
    "Your Menu, Inventory Items, and Staff will NOT be deleted.\n\n" +
    "To proceed, type exactly: CLEAN SLATE"
  );

  if (confirmWord !== "CLEAN SLATE") {
    alert("❌ Operation cancelled. Your data is safe.");
    return; // Stops the function immediately
  }

  // 2. Start the Incinerator
  let btn = document.getElementById('btnWipeData');
  btn.innerText = "⏳ Wiping Database...";
  btn.disabled = true;

  try {
    // List of the specific database folders we want to empty
    const collectionsToWipe = ["transactions", "stock_logs", "dispatch", "shifts", "expenses"];

    for (let colName of collectionsToWipe) {
      const snap = await getDocs(collection(db, colName));
      // Loop through every document inside the folder and delete it
      for (let docSnap of snap.docs) {
        await deleteDoc(doc(db, colName, docSnap.id));
      }
    }

    // Optional: Reset all current Live Inventory stock levels back to 0
    let resetStock = confirm("Data wiped! Do you also want to reset all current Live Inventory stock levels back to 0?");
    if (resetStock) {
      const invSnap = await getDocs(collection(db, "inventory"));
      for (let iDoc of invSnap.docs) {
        await updateDoc(doc(db, "inventory", iDoc.id), { currentStock: 0 });
      }
    }

    alert("✅ Clean Slate Protocol Complete!\n\nYour system is now completely blank and ready for the LIVE LAUNCH.");
    location.reload(); // Refresh the page to show the empty dashboard

  } catch (error) {
    console.error("Incinerator Error:", error);
    alert("❌ An error occurred while wiping the data.");
  } finally {
    btn.innerText = "🧹 Factory Reset";
    btn.disabled = false;
  }
};

// ==========================================
// REMITTANCE & CASH TRANSFER EXPLORER
// ==========================================
window.loadCashExplorer = async function() {
    const tbody = document.getElementById('transferLogBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px;">Fetching remittances...</td></tr>';

    // 1. Grab the current filters from the top of the page
    const branchFilter = document.getElementById('transferBranchFilter') ? document.getElementById('transferBranchFilter').value : 'All';
    
    // Grab dates safely!
    const today = new Date().toISOString().split('T')[0];
    const startInput = document.getElementById('transferStartDate');
    const endInput = document.getElementById('transferEndDate');
    
    // If the input exists AND is not blank, use it. Otherwise, default to today!
    const startDateRaw = (startInput && startInput.value) ? startInput.value : today;
    const endDateRaw = (endInput && endInput.value) ? endInput.value : today;

    // Convert string dates to actual Date objects for Firebase comparison
    const startTimestamp = new Date(startDateRaw + 'T00:00:00');
    const endTimestamp = new Date(endDateRaw + 'T23:59:59');

    try {
        let q;
        if (branchFilter === 'All') {
            q = query(collection(db, "remittances"), 
                where("timestamp", ">=", startTimestamp),
                where("timestamp", "<=", endTimestamp),
                orderBy("timestamp", "desc")
            );
        } else {
            q = query(collection(db, "remittances"), 
                where("branch", "==", branchFilter),
                where("timestamp", ">=", startTimestamp),
                where("timestamp", "<=", endTimestamp),
                orderBy("timestamp", "desc")
            );
        }

        const snap = await getDocs(q);

        let html = '';
        let totalCash = 0;
        let pendingCount = 0;

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';
            
            // The Boss Security Check!
            let status = data.status || "Pending"; 
            if (status === "Pending") pendingCount++;
            if (status === "Received") totalCash += (data.amount || 0); // Only count money safely in your hands!

            let statusBadge = status === "Received"
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">✅ Received</span>`
                : `<span style="background: #fef9c3; color: #ca8a04; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Pending</span>`;

            let actionBtn = status === "Pending"
                ? `<button onclick="approveRemittance('${docSnap.id}')" style="background: var(--primary); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; width: 100%;">Approve</button>`
                : `<span style="color: #94a3b8; font-size: 12px; display: block; text-align: center;">Locked</span>`;

            html += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 15px 20px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 15px 20px;">
                        <strong style="color: var(--primary); font-size: 15px;">${data.branch}</strong><br>
                        <span style="font-size: 12px; color: #64748b;">By: ${data.cashier}</span><br>
                        <span style="font-size: 11px; color: #94a3b8;">Sales: ${data.salesPeriodStart} to ${data.salesPeriodEnd}</span>
                    </td>
                    <td style="padding: 15px 20px;">
                        <strong style="font-size: 13px;">${data.channel}</strong> ➡️ ${data.recipient}<br>
                        <span style="font-size: 12px; font-family: monospace; color: #0284c7;">Ref: ${data.referenceNumber || 'N/A'}</span>
                    </td>
                    <td style="padding: 15px 20px; text-align: center;">${statusBadge}</td>
                    <td style="padding: 15px 20px; text-align: right; font-size: 16px; font-weight: bold; color: #16a34a;">
                        ₱${data.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </td>
                    <td style="padding: 15px 20px;">${actionBtn}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No remittances found for this filter.</td></tr>';
        
        if (document.getElementById('totalTransfersVal')) document.getElementById('totalTransfersVal').innerText = `₱${totalCash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (document.getElementById('pendingTransfersVal')) {
            document.getElementById('pendingTransfersVal').innerText = pendingCount;
            document.getElementById('pendingTransfersVal').previousElementSibling.innerText = "PENDING TRANSFERS";
        }

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px; color: red;">Error fetching data. (Check Firebase Console for Index links)</td></tr>';
    }
};

// --- THE NEW SMART DEPOSIT APPROVAL BUTTON ---
window.approveRemittance = async function (docId) {
    if (!confirm("✅ Mark this remittance as safely received and deposit it into your Cash Accounts?")) return;
    
    try {
        // 1. Fetch the exact remittance document to see how much money is coming in
        const remitRef = doc(db, "remittances", docId);
        const remitSnap = await getDoc(remitRef);
        if (!remitSnap.exists()) return;

        const data = remitSnap.data();
        const amountToDeposit = parseFloat(data.amount) || 0;
        const channelUsed = data.channel; // e.g., "GCash" or "Physical Handover"

        // 2. Map the channel to your actual Manager Account names
        // If cashier selected "Physical Handover", we deposit to "Cash". Otherwise, look for an exact match (like GCash, BDO, etc.)
        let targetAccountName = channelUsed;
        if (channelUsed === "Physical Handover") {
            targetAccountName = "Cash"; 
        }

        // 3. Find that matching account in your Master Cash & Budget database
        const accQuery = query(collection(db, "cash_accounts"), where("name", "==", targetAccountName));
        const accSnap = await getDocs(accQuery);

        if (accSnap.empty) {
            // SAFETY LOCK: If they remitted to "BDO" but you haven't created a "BDO" account yet!
            alert(`⚠️ Routing Error: No cash account named "${targetAccountName}" found in your Cash & Budget tab!\n\nPlease go to Cash & Budget, click "+ Add" to create an account named "${targetAccountName}", and try approving this again.`);
            return; 
        }

        // 4. Deposit the money!
        const targetAccDoc = accSnap.docs[0];
        const currentBalance = parseFloat(targetAccDoc.data().balance) || 0;
        const newBalance = currentBalance + amountToDeposit;
        
        await updateDoc(doc(db, "cash_accounts", targetAccDoc.id), { balance: newBalance });

        // 5. Finally, mark the remittance as safely Received
        await updateDoc(remitRef, { status: "Received" });

        alert(`✅ Success! ₱${amountToDeposit.toLocaleString()} has been officially deposited into your [${targetAccountName}] account.`);
        
        // Refresh the screens
        loadCashExplorer(); 
        if (typeof loadAccountsAndBudget === 'function') loadAccountsAndBudget();

    } catch (e) {
        console.error("Deposit Error:", e); 
        alert("❌ Failed to approve and route the remittance.");
    }
};

// ========================================================
// 📊 INVENTORY SMART CSV ENGINE (EXPORT & UPSERT) 📊
// ========================================================

// 1. DRAFTS AND DOWNLOADS THE CSV
window.exportInventoryCSV = async function () {
  try {
    const snap = await getDocs(collection(db, "inventory"));

    // The Header Row (Notice FirebaseID is the very first column!)
    let csvContent = "FirebaseID,Branch,Category,ItemName,UOM,BaseCost,CurrentStock\n";

    snap.forEach(docSnap => {
      let d = docSnap.data();
      // We clean the text to make sure commas in names don't break the Excel columns
      let cleanName = (d.name || '').replace(/,/g, '');
      let cleanCat = (d.category || '').replace(/,/g, '');
      let branch = d.branch || 'Main Office';

      csvContent += `${docSnap.id},${branch},${cleanCat},${cleanName},${d.uom || ''},${d.baseCost || 0},${d.currentStock || 0}\n`;
    });

    // Magic trick to force the browser to download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Takodeal_Inventory_Master.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

  } catch (e) {
    console.error(e); alert("Failed to export CSV.");
  }
};


// 2. READS AND UPDATES THE DATABASE WITHOUT DUPLICATING
window.smartImportCSV = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const text = e.target.result;
    const rows = text.split('\n');

    let updatedCount = 0;
    let addedCount = 0;
    const btn = document.querySelector('button[onclick*="csvInvUpload"]');
    btn.innerText = "⏳ Syncing..."; btn.disabled = true;

    try {
      // Loop through every row (Skip row 0 because it's the header)
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue; // Skip blank lines
        let cols = rows[i].split(',');

        let docId = cols[0] ? cols[0].trim() : "";
        let branch = cols[1] ? cols[1].trim() : "";
        let category = cols[2] ? cols[2].trim() : "";
        let name = cols[3] ? cols[3].trim() : "";
        let uom = cols[4] ? cols[4].trim() : "";
        let baseCost = parseFloat(cols[5]) || 0;
        let currentStock = parseFloat(cols[6]) || 0;

        if (!name) continue; // If there is no item name, ignore the row

        if (docId !== "") {
          // 🔥 MAGIC: If it has an ID, UPDATE the existing item!
          await updateDoc(doc(db, "inventory", docId), {
            branch: branch, category: category, name: name, uom: uom, baseCost: baseCost, currentStock: currentStock
          });
          updatedCount++;
        } else {
          // 🔥 If the ID is blank, it's a new row you added in Excel. CREATE IT!
          await addDoc(collection(db, "inventory"), {
            branch: branch, category: category, name: name, uom: uom, baseCost: baseCost, currentStock: currentStock
          });
          addedCount++;
        }
      }

      alert(`✅ Smart Sync Complete!\n\nUpdated: ${updatedCount} existing items.\nAdded: ${addedCount} brand new items.`);

      // Refresh your Live Inventory table so you can see the changes!
      if (typeof loadLiveInventory === 'function') loadLiveInventory();
      else location.reload();

    } catch (error) {
      console.error(error); alert("❌ Fatal Error syncing CSV data.");
    } finally {
      btn.innerText = "📥 Smart Sync Upload"; btn.disabled = false;
      event.target.value = ''; // Reset the file input
    }
  };
  reader.readAsText(file);
};

// ========================================================
// 💻 DEVICE FLEET MANAGER ENGINE 💻
// ========================================================
window.loadDeviceFleet = async function () {
  const tbody = document.getElementById('deviceFleetBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Scanning cloud for registered devices...</td></tr>';

  try {
    const snap = await getDocs(collection(db, "pos_devices"));
    let html = '';

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 30px; color: var(--text-muted);">No devices are currently registered in the cloud.</td></tr>';
      return;
    }

    snap.forEach(docSnap => {
      let d = docSnap.data();
      let statusBadge = d.status === 'Blocked'
        ? `<span class="badge" style="background: var(--danger); color: white;">🚫 Blocked</span>`
        : `<span class="badge badge-active">✅ Active</span>`;

      let dateStr = d.registeredAt ? d.registeredAt.toDate().toLocaleDateString() : 'Unknown';

      html += `
        <tr>
          <td><strong>${d.deviceName || 'Unnamed Tablet'}</strong><br><span style="font-size: 11px; color: gray;">ID: ${docSnap.id}</span></td>
          <td>📍 ${d.branch}</td>
          <td>${dateStr}</td>
          <td>${statusBadge}</td>
          <td>
            ${d.status !== 'Blocked' ? `<button class="btn-refresh" style="background: #fef2f2; border: 1px solid var(--danger); color: var(--danger); padding: 5px 10px; margin-right: 5px;" onclick="toggleDeviceStatus('${docSnap.id}', 'Blocked')">🚫 Block</button>` : `<button class="btn-refresh" style="background: #f0fdf4; border: 1px solid var(--success); color: var(--success); padding: 5px 10px; margin-right: 5px;" onclick="toggleDeviceStatus('${docSnap.id}', 'Active')">✅ Unblock</button>`}
            <button class="btn-refresh" style="background: white; border: 1px solid var(--text-muted); color: var(--text-muted); padding: 5px 10px;" onclick="deleteDevice('${docSnap.id}')">🗑️ Delete</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (error) {
    console.error("Device Fleet Error:", error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error connecting to Firebase.</td></tr>';
  }
};

window.toggleDeviceStatus = async function (deviceId, newStatus) {
  if (!confirm(`Are you sure you want to change this device to ${newStatus}?`)) return;
  try {
    await updateDoc(doc(db, "pos_devices", deviceId), { status: newStatus });
    loadDeviceFleet();
  } catch (e) { alert("Failed to update status."); }
};

window.deleteDevice = async function (deviceId) {
  if (!confirm("Are you sure you want to permanently delete this device? It will log out the tablet.")) return;
  try {
    await deleteDoc(doc(db, "pos_devices", deviceId));
    loadDeviceFleet();
  } catch (e) { alert("Failed to delete device."); }
};


// ========================================================
// 🔍 THE BEAUTIFUL VARIANCE & BREAKDOWN MODAL
// ========================================================
window.viewZReadingDetails = async function (breakdownStr, stockStr, cashierName, branchName, declaredCash) {
  // 1. Open the UI
  document.getElementById('breakdownModal').style.display = 'flex';
  document.getElementById('bdTitle').innerText = `Z-Reading: ${cashierName.toUpperCase()} (${branchName})`;
  document.getElementById('bdTotalCash').innerText = `Declared Total: ₱${parseFloat(declaredCash).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  let breakdown = JSON.parse(decodeURIComponent(breakdownStr));
  let physicalStock = JSON.parse(decodeURIComponent(stockStr));

  // 2. Build Cash Breakdown Grid
  let cashHtml = '';
  for (const [bill, qty] of Object.entries(breakdown)) {
    if (qty > 0) {
      let total = parseInt(bill.replace('₱', '')) * qty;
      cashHtml += `<div style="display: flex; justify-content: space-between; padding: 4px; border-bottom: 1px solid #f1f5f9;">
                            <span style="color: #64748b;">${bill} x <strong style="color:#000;">${qty} pcs</strong></span>
                            <span style="font-weight: bold;">₱${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                         </div>`;
    }
  }
  document.getElementById('bdCashContent').innerHTML = cashHtml || '<i>No cash breakdown logged.</i>';

  // 3. The Variance Engine (Compare Physical vs Live DB)
  const tbody = document.getElementById('bdStockContent');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px; color: #888;">⏳ Fetching Live DB stock for comparison...</td></tr>';

  try {
    // Query the live inventory specifically for THIS branch
    const q = query(collection(db, "inventory"), where("branch", "==", branchName));
    const snap = await getDocs(q);

    // Save the live DB items into a dictionary
    let liveStockDb = {};
    snap.forEach(doc => {
      let item = doc.data();
      let itemName = item.name || item.itemName || item.item;
      let qty = item.currentStock || item.stock || item.quantity || 0;
      if (itemName) liveStockDb[itemName] = qty;
    });

    // Compare Cashier's count against the Live DB
    let stockHtml = '';
    for (const [itemName, cashierQty] of Object.entries(physicalStock)) {
      let expectedQty = liveStockDb[itemName];

      let varianceHtml = '';
      if (expectedQty === undefined) {
        expectedQty = '<span title="Item spelling might not match DB">Not Found ⚠️</span>';
        varianceHtml = '<span style="color: #94a3b8;">N/A</span>';
      } else {
        let variance = cashierQty - expectedQty;
        if (variance === 0) {
          varianceHtml = `<span style="color: #16a34a; font-weight: bold;">Perfect ✔️</span>`;
        } else if (variance < 0) {
          varianceHtml = `<span style="color: #dc2626; font-weight: bold;">${variance} (Short) 🔻</span>`;
        } else {
          varianceHtml = `<span style="color: #ea580c; font-weight: bold;">+${variance} (Over) 🔺</span>`;
        }
      }

      stockHtml += `
                <tr style="border-bottom: 1px solid #f8fafc;">
                    <td style="padding: 10px 5px; font-weight: bold; color: #334155;">${itemName}</td>
                    <td style="padding: 10px 5px; color: #64748b;">${expectedQty}</td>
                    <td style="padding: 10px 5px; font-weight: bold; color: #0284c7;">${cashierQty}</td>
                    <td style="padding: 10px 5px;">${varianceHtml}</td>
                </tr>
            `;
    }
    tbody.innerHTML = stockHtml;

  } catch (e) {
    console.error("Error fetching live inventory:", e);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#dc2626; padding:15px;">❌ Failed to fetch live inventory for variance check.</td></tr>';
  }
};

// ========================================================
// 🍟 ADD-ON & BOM MODIFIER ENGINE (MANAGER APP)
// ========================================================

// Keep a global memory of inventory items so the dropdowns load instantly
let cachedInventoryOptions = '<option value="">-- Select Raw Ingredient --</option>';

// Call this once when the page loads, or when the modal opens
window.preloadInventoryForAddons = async function () {
  try {
    const snap = await getDocs(collection(db, "inventory"));
    let options = '<option value="">-- Select Raw Ingredient --</option>';
    snap.forEach(docSnap => {
      let item = docSnap.data();
      let itemName = item.name || item.itemName || "Unknown Item";
      options += `<option value="${itemName}">${itemName} (Live Stock: ${item.currentStock || item.stock || 0})</option>`;
    });
    cachedInventoryOptions = options;
  } catch (e) {
    console.error("Error loading inventory for addons:", e);
  }
};

// Adds a new row to the Add-on Table
window.addAddonRow = function (name = '', price = '', ingredient = '', qty = '') {
  const tbody = document.getElementById('addonTableBody');
  const tr = document.createElement('tr');
  tr.style.borderBottom = "1px solid #e2e8f0";

  // Make sure we have the inventory options loaded
  if (cachedInventoryOptions === '<option value="">-- Select Raw Ingredient --</option>') {
    preloadInventoryForAddons(); // Just in case it wasn't preloaded
  }

  tr.innerHTML = `
        <td style="padding: 8px 5px;">
            <input type="text" class="addon-name input-box" placeholder="e.g. Extra Cheese" value="${name}" style="width: 100%; padding: 6px; font-size: 12px;">
        </td>
        <td style="padding: 8px 5px;">
            <input type="number" class="addon-price input-box" placeholder="15" value="${price}" style="width: 100%; padding: 6px; font-size: 12px; color: #16a34a; font-weight: bold;">
        </td>
        <td style="padding: 8px 5px;">
            <select class="addon-ingredient input-box" style="width: 100%; padding: 6px; font-size: 12px;">
                ${cachedInventoryOptions}
            </select>
        </td>
        <td style="padding: 8px 5px;">
            <input type="number" class="addon-qty input-box" placeholder="e.g. 1" value="${qty}" style="width: 100%; padding: 6px; font-size: 12px;">
        </td>
        <td style="padding: 8px 5px; text-align: center;">
            <button type="button" onclick="this.closest('tr').remove()" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">🗑️</button>
        </td>
    `;

  tbody.appendChild(tr);

  // If we passed an ingredient in (like when editing an existing product), set the dropdown to match it
  if (ingredient) {
    let select = tr.querySelector('.addon-ingredient');
    select.value = ingredient;
  }
};

// ========================================================
// 🍔 MASTER RECIPE & ADD-ON SAVER (MANAGER)
// ========================================================
window.saveBomRecipe = async function (productId) {
  // 1. Grab the basic details (You might need to adjust these IDs to match your actual inputs)
  let sellingPrice = parseFloat(document.getElementById('bomSellingPrice')?.value) || 0;

  // 2. 🍟 GATHER ALL ADD-ONS
  let addonsArray = [];
  document.querySelectorAll('#addonTableBody tr').forEach(row => {
    let name = row.querySelector('.addon-name').value;
    let price = parseFloat(row.querySelector('.addon-price').value) || 0;
    let ingredient = row.querySelector('.addon-ingredient').value;
    let qty = parseFloat(row.querySelector('.addon-qty').value) || 0;

    if (name && price >= 0) { // Only save if it has a valid name
      addonsArray.push({
        name: name,
        price: price,
        linkedIngredient: ingredient,
        deductQty: qty
      });
    }
  });

  // 3. Save to Firebase
  try {
    const productRef = doc(db, "menu", productId);

    await updateDoc(productRef, {
      price: sellingPrice,
      addons: addonsArray,
      lastUpdated: serverTimestamp()
    });

    alert("✅ Recipe and Add-ons successfully updated!");

    // Close the modal (Adjust ID if your modal is named differently)
    let modal = document.getElementById('updateProductModal');
    if (modal) modal.style.display = 'none';

  } catch (error) {
    console.error("Error saving BOM:", error);
    alert("❌ Failed to save recipe. Check console.");
  }
};

// ========================================================
// 📊 EXPORT TO EXCEL / CSV ENGINE (MENU COSTING)
// ========================================================
window.downloadMenuCSV = function () {
  // 1. Find the Menu Costing table on the screen
  let tables = document.querySelectorAll('table');
  let targetTable = null;

  // Look for the table that has 'MENU ITEM' and 'RECIPE COST' in it
  tables.forEach(tbl => {
    if (tbl.innerText.includes('MENU ITEM') && tbl.innerText.includes('RECIPE COST')) {
      targetTable = tbl;
    }
  });

  if (!targetTable) {
    alert("❌ Could not find the table data to download.");
    return;
  }

  // 2. Extract the data row by row
  let csv = [];
  let rows = targetTable.querySelectorAll('tr');

  for (let i = 0; i < rows.length; i++) {
    let row = [], cols = rows[i].querySelectorAll('td, th');

    for (let j = 0; j < cols.length; j++) {
      // Clean up the text (remove newlines, peso signs, and commas so Excel doesn't break)
      let data = cols[j].innerText.replace(/(\r\n|\n|\r)/gm, " ").replace(/,/g, "").replace(/₱/g, "");

      // Skip the "ACTION" column (the update buttons)
      if (data === 'ACTION') continue;
      if (j === cols.length - 1 && data.includes('Update')) continue;

      row.push(data);
    }
    csv.push(row.join(","));
  }

  // 3. Build the file and force the browser to download it
  let csvFile = new Blob([csv.join("\n")], { type: "text/csv" });
  let downloadLink = document.createElement("a");

  // Name the file with today's date
  let dateStr = new Date().toISOString().split('T')[0];
  downloadLink.download = `Takodeal_Menu_Costing_${dateStr}.csv`;

  downloadLink.href = window.URL.createObjectURL(csvFile);
  downloadLink.style.display = "none";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
};

// ========================================================
// 🚀 TWO-WAY BULK EDITING ENGINE (RECIPES & ADD-ONS)
// ========================================================

// --- 1. DOWNLOAD THE EXCEL TEMPLATE ---
window.downloadRecipeTemplate = async function () {
  try {
    const snap = await getDocs(collection(db, "menu"));
    // The exact strict headers the uploader needs to read
    let csv = "ProductID,ProductName,Category,SellingPrice,BaseRecipe(Item:Qty|Item:Qty),Addons(Name:Price:Item:Qty)\n";

    snap.forEach(docSnap => {
      let data = docSnap.data();
      let id = docSnap.id;
      let name = (data.name || data.productName || "").replace(/,/g, "");
      let cat = (data.category || "").replace(/,/g, "");
      let price = data.price || data.sellingPrice || 0;

      // Compress Recipe Array into a single Excel cell (Cabbage:0.5|Flour:0.2)
      let recipeStr = "";
      if (data.recipe && Array.isArray(data.recipe)) {
        recipeStr = data.recipe.map(r => `${r.item || r.ingredient}:${r.qty}`).join("|");
      }

      // Compress Addons Array into a single Excel cell (Extra Cheese:15:Cheese Block:0.05)
      let addonStr = "";
      if (data.addons && Array.isArray(data.addons)) {
        addonStr = data.addons.map(a => `${a.name}:${a.price}:${a.linkedIngredient || a.ingredient}:${a.deductQty || a.qty}`).join("|");
      }

      csv += `${id},${name},${cat},${price},${recipeStr},${addonStr}\n`;
    });

    // Trigger the download
    let csvFile = new Blob([csv], { type: "text/csv" });
    let downloadLink = document.createElement("a");
    downloadLink.download = `Takodeal_Bulk_Editor_${new Date().toISOString().split('T')[0]}.csv`;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

  } catch (e) {
    console.error(e);
    alert("❌ Error generating bulk template. Check console.");
  }
};

// --- 2. UPLOAD & SYNC EDITS TO FIREBASE ---
window.processBulkUpload = function (event) {
  let file = event.target.files[0];
  if (!file) return;

  let reader = new FileReader();
  reader.onload = async function (e) {
    let text = e.target.result;
    let rows = text.split("\n");

    if (!confirm(`⚠️ WARNING: You are about to mass-update ${rows.length - 2} menu items in your live database. This cannot be undone. Proceed?`)) {
      event.target.value = ''; // Reset the input if they cancel
      return;
    }

    let successCount = 0;

    for (let i = 1; i < rows.length; i++) {
      let row = rows[i].trim();
      if (!row) continue;

      let cols = row.split(",");
      if (cols.length < 6) continue;

      let id = cols[0];
      let name = cols[1];
      let cat = cols[2];
      let price = parseFloat(cols[3]) || 0;
      let recipeStr = cols[4];
      let addonStr = cols[5];

      // Decompress the Excel cell back into a Firebase Recipe Array
      let recipeArray = [];
      if (recipeStr) {
        recipeStr.split("|").forEach(item => {
          let parts = item.split(":");
          if (parts.length >= 2) recipeArray.push({ item: parts[0], qty: parseFloat(parts[1]) });
        });
      }

      // Decompress the Excel cell back into a Firebase Add-on Array
      let addonArray = [];
      if (addonStr) {
        addonStr.split("|").forEach(item => {
          let parts = item.split(":");
          if (parts.length >= 4) {
            addonArray.push({ name: parts[0], price: parseFloat(parts[1]), linkedIngredient: parts[2], deductQty: parseFloat(parts[3]) });
          }
        });
      }

      // Blast the update to Firebase
      try {
        await updateDoc(doc(db, "menu", id), {
          name: name,
          category: cat,
          price: price,
          recipe: recipeArray,
          addons: addonArray,
          lastUpdated: serverTimestamp()
        });
        successCount++;
      } catch (err) {
        console.error("Failed to update ID:", id, err);
      }
    }

    alert(`✅ Bulk Upload Complete! Successfully updated ${successCount} menu items.`);
    location.reload(); // Refresh the page to show the massive update
  };
  reader.readAsText(file);
};

// ========================================================
// 📊 Z-READING REPORTS ENGINE (FULL PAGE UPGRADE)
// ========================================================
window.loadZReadingReports = async function () {
  const tbody = document.getElementById('zReadingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading reports from cloud...</td></tr>';

  try {
    const q = query(collection(db, "shifts"), where("status", "==", "Closed"), orderBy("endTime", "desc"));
    const snap = await getDocs(q);

    let html = '';
    snap.forEach(docSnap => {
      let data = docSnap.data();
      let dateStr = data.endTime ? data.endTime.toDate().toLocaleString() : 'Unknown Date';
      let declared = data.declaredCash || 0;
      let declaredFormatted = `₱${declared.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

      let breakdownStr = encodeURIComponent(JSON.stringify(data.cashBreakdown || {}));
      let stockStr = encodeURIComponent(JSON.stringify(data.physicalStockCount || {}));
      let safeCashier = data.cashier ? data.cashier.replace(/'/g, "\\'") : 'Unknown';
      let safeBranch = data.branch ? data.branch.replace(/'/g, "\\'") : 'Unknown';

      html += `
        <tr>
          <td>${dateStr}</td>
          <td><strong>${safeCashier}</strong></td>
          <td><span class="badge badge-closed">${safeBranch}</span></td>
          <td style="color: var(--success); font-weight: bold;">${declaredFormatted}</td>
          <td>
            <button onclick="viewZReadingDetails('${breakdownStr}', '${stockStr}', '${safeCashier}', '${safeBranch}', ${declared})" class="btn-refresh" style="background: #0ea5e9; color: white; border: none; padding: 6px 12px;">🔍 View Details</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="5" class="text-center">No closed shifts found.</td></tr>';
  } catch (error) {
    console.error("Error loading Z-Readings:", error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error loading reports. Check console.</td></tr>';
  }
};

// ========================================================
// 💸 EXPENSE & RESTOCK FEED ENGINE (FULL PAGE UPGRADE)
// ========================================================
window.loadExpenseLogs = async function () {
  const tbody = document.getElementById('expenseLogsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">⏳ Fetching live expense logs from all branches...</td></tr>';

  try {
    const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"), limit(50));
    const snap = await getDocs(q);

    let html = '';
    snap.forEach(docSnap => {
      let data = docSnap.data();
      let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';
      let amountStr = data.amount ? `₱${data.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '₱0.00';

      let descHtml = data.description || '';
      if (descHtml.includes("RESTOCK")) {
        descHtml = `<span style="color: #059669; font-weight: bold; background: #d1fae5; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 5px;">📦 RESTOCK</span> ` + descHtml.replace("RESTOCK", "");
      }

      html += `
        <tr>
          <td style="font-size: 13px; color: var(--text-muted);">${dateStr}</td>
          <td><strong>${data.branch || 'Unknown'}</strong></td>
          <td>👤 ${data.cashier || 'Unknown'}</td>
          <td>${descHtml}</td>
          <td style="text-align: right; font-weight: bold; color: var(--danger);">${amountStr}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="5" class="text-center">No expenses logged yet.</td></tr>';

  } catch (error) {
    console.error("Error loading expense logs:", error);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: var(--danger);">❌ Error loading logs.</td></tr>';
  }
};

// ==========================================
// RECEIPT BUILDER ENGINE
// ==========================================

// --- LOGO UPLOAD & CONVERT ENGINE ---
window.processLogoUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64String = e.target.result;
        // 1. Save it to the hidden input for Firebase
        document.getElementById('logoBase64Val').value = base64String;
        // 2. Show the live preview on the screen
        const preview = document.getElementById('logoPreview');
        preview.src = base64String;
        preview.style.display = 'inline-block';
    };
    // This physically converts the image into text data!
    reader.readAsDataURL(file);
};

// 1. Live Typing Preview
function updateReceiptPreview() {
    document.getElementById('prevName').innerText = document.getElementById('rcptName').value || 'TAKODEÁL';
    document.getElementById('prevAddress').innerText = document.getElementById('rcptAddress').value || '';
    document.getElementById('prevContact').innerText = document.getElementById('rcptContact').value || '';
    document.getElementById('prevFooter').innerText = document.getElementById('rcptFooter').value || '';
}

// 2. Save to Cloud
async function saveReceiptSettings() {
    const rSettings = {
        logoBase64: document.getElementById('logoBase64Val').value,
        storeName: document.getElementById('rcptName').value,
        address: document.getElementById('rcptAddress').value,
        contact: document.getElementById('rcptContact').value,
        footerMessage: document.getElementById('rcptFooter').value,
        updatedAt: serverTimestamp()
    };
    
    try {
        // We use setDoc with {merge: true} to safely create or update the global settings file
        await setDoc(doc(db, "settings", "global_receipt"), rSettings, { merge: true });
        alert("✅ Receipt Layout Saved to Cloud!");
    } catch (error) {
        console.error("Error saving receipt:", error);
        alert("Failed to save layout.");
    }
}

window.loadAttendanceLogs = async function () {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">Fetching logs...</td></tr>';

    try {
        const q = query(collection(db, "attendance_logs"), orderBy("timestamp", "desc"), limit(30));
        const snap = await getDocs(q);

        let html = '';
        snap.forEach(doc => {
            let data = doc.data();
            let timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';
            let badgeColor = data.type === "TIME IN" ? "#dcfce7" : "#fee2e2";
            let textColor = data.type === "TIME IN" ? "#16a34a" : "#b91c1c";
            
            // Map Link generator if GPS exists!
            let locationText = `📍 ${data.branch}`;
            if (data.locationLat && data.locationLat !== "Unknown") {
                locationText += `<br><a href="https://www.google.com/maps/search/?api=1&query=${data.locationLat},${data.locationLng}" target="_blank" style="font-size: 10px; color: #3b82f6; text-decoration: none;">🗺️ View on Map</a>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; font-size: 13px; color: #64748b;">${timeStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #334155;">${data.staffName}</td>
                    <td style="padding: 12px; color: #64748b;">${locationText}</td>
                    <td style="padding: 12px;">
                        <span style="background: ${badgeColor}; color: ${textColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${data.type}</span>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <button onclick="viewSelfie('${data.photoBase64}', '${data.staffName} - ${data.type}')" style="background: none; border: 1px solid #cbd5e1; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 16px;">📷</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No logs found.</td></tr>';
    } catch (error) {
        console.error("Error loading attendance:", error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error! Press F12 to check Firebase Index.</td></tr>';
    }
};

window.viewSelfie = function(base64Data, detailsText) {
    if (!base64Data || base64Data === 'undefined') { alert("No photo attached."); return; }
    document.getElementById('viewedSelfie').src = base64Data;
    document.getElementById('selfieDetails').innerText = detailsText;
    document.getElementById('photoViewerModal').style.display = 'flex';
};

// ==========================================
// 📅 TAKODEÁL CLOUD AUTO-SCHEDULER ENGINE
// ==========================================

const defaultSchedConfig = {
    Cabantian: [
        { id: 'm1', name: 'Morning (9am-6pm)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'm2', name: 'Morning (10am-7pm)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'mid', name: 'Mid (4pm-2am)', active: true, days: [0,1,5,6] }, 
        { id: 'n1', name: 'Night 1 (7pm-3am)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'n2', name: 'Night 2 (7pm-3am)', active: true, days: [0,1,2,3,4,5,6] }
    ],
    Maa: [
        { id: 'm1', name: 'Morning (9am-6pm)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'm2', name: 'Morning (10am-7pm)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'mid', name: 'Mid (4pm-2am)', active: true, days: [0,1,5,6] },
        { id: 'n1', name: 'Night 1 (6pm-2am)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'n2', name: 'Night 2 (6pm-2am)', active: true, days: [0,1,2,3,4,5,6] }
    ],
    Citygate: [
        { id: 'open', name: 'Opener (10am-7pm)', active: true, days: [0,1,2,3,4,5,6] },
        { id: 'close', name: 'Closer (12nn-9pm)', active: true, days: [0,1,2,3,4,5,6] }
    ]
};

let branchConfig = JSON.parse(JSON.stringify(defaultSchedConfig));
let employees = [];
let unavailability = {}; 
let currentSchedule = {}; 
let currentYear, currentMonth;
let swapData = null; 
let currentActiveTab = 'Cabantian'; // Your tab memory!

// 🔥 FIREBASE SAVE/LOAD (Replaces localStorage)
window.saveToCloud = async function() {
    try {
        const appData = { branchConfig, employees, unavailability, currentSchedule, currentYear, currentMonth };
        await setDoc(doc(db, "settings", "global_schedule"), appData);
    } catch(e) { console.error("Cloud Save Error:", e); }
};

window.loadFromCloud = async function() {
    try {
        const snap = await getDoc(doc(db, "settings", "global_schedule"));
        if (snap.exists()) {
            const appData = snap.data();
            branchConfig = appData.branchConfig || JSON.parse(JSON.stringify(defaultSchedConfig));
            employees = appData.employees || [];
            unavailability = appData.unavailability || {};
            currentSchedule = appData.currentSchedule || {};
            currentYear = appData.currentYear;
            currentMonth = appData.currentMonth;
            if (currentYear && currentMonth) {
                const mm = currentMonth < 10 ? '0' + currentMonth : currentMonth;
                document.getElementById("monthSelector").value = `${currentYear}-${mm}`;
            }
        } else {
            const today = new Date();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            document.getElementById("monthSelector").value = `${today.getFullYear()}-${mm}`;
        }
        renderConfigUI(); updateStaffDisplay(); updateAvailDropdown(); updateUnavailabilityList(); renderTables();
    } catch(e) { console.error("Cloud Load Error:", e); }
};

// --- CORE UI FUNCTIONS ---
window.renderConfigUI = function() {
    const container = document.getElementById("shiftConfigGrid");
    if(!container) return;
    container.innerHTML = "";
    const dayNames = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];
    for (const branch in branchConfig) {
        const box = document.createElement("div"); box.className = "shift-config-box";
        box.innerHTML = `<h4 style="margin:0 0 10px 0; color:#334155;">${branch}</h4>`;
        branchConfig[branch].forEach((shift, index) => {
            const row = document.createElement("div"); row.className = "shift-row";
            row.innerHTML = `<input type="checkbox" ${shift.active ? 'checked' : ''} id="chk_${branch}_${index}">
                             <input type="text" value="${shift.name}" id="inp_${branch}_${index}">`;
            box.appendChild(row);
            const daysDiv = document.createElement("div"); daysDiv.className = "shift-days";
            dayNames.forEach((name, i) => {
                daysDiv.innerHTML += `<label><input type="checkbox" value="${i}" class="day-chk-${branch}-${index}" ${shift.days.includes(i) ? 'checked' : ''}>${name}</label>`;
            });
            box.appendChild(daysDiv);
        });
        container.appendChild(box);
    }
};

window.saveShiftConfigChanges = function() {
    for (const branch in branchConfig) {
        branchConfig[branch].forEach((shift, index) => {
            shift.active = document.getElementById(`chk_${branch}_${index}`).checked;
            shift.name = document.getElementById(`inp_${branch}_${index}`).value.trim();
            const dChks = document.querySelectorAll(`.day-chk-${branch}-${index}`);
            shift.days = Array.from(dChks).filter(c => c.checked).map(c => parseInt(c.value));
        });
    }
    if (currentSchedule[1]) {
        for (let day in currentSchedule) {
            const dayOfWeek = new Date(currentYear, currentMonth - 1, day).getDay();
            for (const branch in branchConfig) {
                let bData = currentSchedule[day][branch]; let newSch = {};
                branchConfig[branch].filter(s => s.active).forEach(s => {
                    if (!s.days.includes(dayOfWeek)) {
                        newSch[s.id] = "N/A";
                        let old = bData.scheduled[s.id];
                        if (old && old !== "N/A" && old !== "UNFILLED" && !bData.rest.includes(old)) bData.rest.push(old);
                    } else { newSch[s.id] = bData.scheduled[s.id] || "UNFILLED"; }
                });
                bData.scheduled = newSch;
            }
        }
        renderTables();
    }
    saveToCloud();
    const msg = document.getElementById("configSaveMsg");
    msg.style.display = "inline"; setTimeout(() => msg.style.display = "none", 2000);
};

window.addEmployee = function() {
    const name = document.getElementById('empName').value.trim();
    const branch = document.getElementById('empBranch').value;
    if (!name) return alert("Enter name.");
    if (employees.some(e => e.name === name)) return alert("Exists.");
    employees.push({ name, branch });
    document.getElementById('empName').value = '';
    
    if (currentSchedule[1]) {
        for (let day in currentSchedule) {
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (unavailability[dateStr] && unavailability[dateStr][name]) {
                currentSchedule[day][branch].unavailable.push({ name, status: unavailability[dateStr][name] });
            } else {
                currentSchedule[day][branch].rest.push(name);
            }
        }
    }
    updateStaffDisplay(); updateAvailDropdown(); renderTables(); saveToCloud();
};

window.removeEmployee = function(name) {
    if(!confirm(`Delete ${name}?`)) return;
    employees = employees.filter(e => e.name !== name);
    if (currentSchedule[1]) {
        for (let day in currentSchedule) {
            for (const branch in currentSchedule[day]) {
                let bData = currentSchedule[day][branch];
                for (let sId in bData.scheduled) { if (bData.scheduled[sId] === name) bData.scheduled[sId] = "UNFILLED"; }
                bData.rest = bData.rest.filter(n => n !== name);
                bData.unavailable = bData.unavailable.filter(u => u.name !== name);
            }
        }
    }
    for (let date in unavailability) { if (unavailability[date][name]) delete unavailability[date][name]; if (Object.keys(unavailability[date]).length === 0) delete unavailability[date]; }
    updateStaffDisplay(); updateAvailDropdown(); updateUnavailabilityList(); renderTables(); saveToCloud();
};

window.updateStaffDisplay = function() {
    const wrapper = document.getElementById('staffListWrapper'); if(!wrapper) return;
    wrapper.innerHTML = "";
    employees.forEach(e => {
        const chip = document.createElement('div'); chip.className = 'staff-chip';
        chip.innerHTML = `${e.name} (${e.branch}) <span class="remove-staff" onclick="removeEmployee('${e.name}')">×</span>`;
        wrapper.appendChild(chip);
    });
};

window.updateAvailDropdown = function() {
    const select = document.getElementById('availEmp'); if(!select) return;
    select.innerHTML = '<option value="">-- Select Staff --</option>';
    employees.forEach(e => {
        const opt = document.createElement('option'); opt.value = e.name; opt.innerText = `${e.name} (${e.branch})`;
        select.appendChild(opt);
    });
};

window.markUnavailable = function() {
    const emp = document.getElementById('availEmp').value;
    const date = document.getElementById('availDate').value;
    const status = document.getElementById('availStatus').value;
    if (!emp || !date) return alert("Select staff and date.");
    if (!unavailability[date]) unavailability[date] = {};
    unavailability[date][emp] = status;
    updateUnavailabilityList();
    if (currentSchedule[1]) {
        const [y, m, d] = date.split('-').map(Number);
        if (y === currentYear && m === currentMonth) {
            for (const branch in currentSchedule[d]) {
                let bData = currentSchedule[d][branch];
                for (let sId in bData.scheduled) { if (bData.scheduled[sId] === emp) bData.scheduled[sId] = "UNFILLED"; }
                bData.rest = bData.rest.filter(n => n !== emp);
                if (!bData.unavailable.some(u => u.name === emp)) {
                    const eObj = employees.find(e => e.name === emp);
                    if (eObj && eObj.branch === branch) bData.unavailable.push({ name: emp, status });
                }
            }
            renderTables();
        }
    }
    saveToCloud();
};

window.removeUnavailable = function(date, emp) {
    if (!confirm(`Remove ${emp} leave?`)) return;
    delete unavailability[date][emp];
    if (Object.keys(unavailability[date]).length === 0) delete unavailability[date];
    updateUnavailabilityList();
    if (currentSchedule[1]) {
        const [y, m, d] = date.split('-').map(Number);
        if (y === currentYear && m === currentMonth) {
            for (const branch in currentSchedule[d]) {
                let bData = currentSchedule[d][branch];
                bData.unavailable = bData.unavailable.filter(u => u.name !== emp);
                const eObj = employees.find(e => e.name === emp);
                if (eObj && eObj.branch === branch && !bData.rest.includes(emp)) bData.rest.push(emp);
            }
            renderTables();
        }
    }
    saveToCloud();
};

window.updateUnavailabilityList = function() {
    const list = document.getElementById('unavailabilityList'); if(!list) return;
    list.innerHTML = '';
    const dates = Object.keys(unavailability).sort();
    if (dates.length === 0) { list.innerHTML = '<span style="color:#aaa;">No leaves recorded.</span>'; return; }
    dates.forEach(date => {
        for (const emp in unavailability[date]) {
            const div = document.createElement('div'); div.style.cssText = 'display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #eee;';
            div.innerHTML = `<span><strong>${date}</strong>: ${emp} [${unavailability[date][emp]}]</span><span style="color:red;cursor:pointer;" onclick="removeUnavailable('${date}', '${emp}')">❌</span>`;
            list.appendChild(div);
        }
    });
};

window.generateSchedule = function() {
    const monthVal = document.getElementById("monthSelector").value;
    if (!monthVal) return alert("Select month.");
    [currentYear, currentMonth] = monthVal.split('-').map(Number);
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    currentSchedule = {};
    
    for (let day = 1; day <= daysInMonth; day++) {
        currentSchedule[day] = {};
        const dStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dOfWeek = new Date(currentYear, currentMonth - 1, day).getDay();
        
        for (const branch in branchConfig) {
            currentSchedule[day][branch] = { scheduled: {}, rest: [], unavailable: [] };
            let pool = employees.filter(e => e.branch === branch).map(e => e.name);
            let available = [];
            
            pool.forEach(name => {
                if (unavailability[dStr] && unavailability[dStr][name]) currentSchedule[day][branch].unavailable.push({ name, status: unavailability[dStr][name] });
                else available.push(name);
            });
            
            let shuffled = available.sort(() => 0.5 - Math.random());
            branchConfig[branch].filter(s => s.active).forEach(shift => {
                if (!shift.days.includes(dOfWeek)) currentSchedule[day][branch].scheduled[shift.id] = "N/A";
                else currentSchedule[day][branch].scheduled[shift.id] = shuffled.length > 0 ? shuffled.pop() : "UNFILLED";
            });
            currentSchedule[day][branch].rest = shuffled;
        }
    }
    renderTables(); saveToCloud();
};

window.openSwapModal = function(day, branch, shiftId) {
    swapData = { day, branch, shiftId };
    const cur = currentSchedule[day][branch].scheduled[shiftId];
    document.getElementById('swapMessage').innerText = cur === "UNFILLED" ? "Assigning empty shift:" : `Swapping: ${cur}`;
    const select = document.getElementById('swapTarget');
    select.innerHTML = '<option value="">-- Choose Staff --</option>';
    
    for (let sId in currentSchedule[day][branch].scheduled) {
        if (sId !== shiftId && currentSchedule[day][branch].scheduled[sId] !== "N/A" && currentSchedule[day][branch].scheduled[sId] !== "UNFILLED") {
            const sName = branchConfig[branch].find(s => s.id === sId).name;
            select.innerHTML += `<option value="shift_${sId}">${currentSchedule[day][branch].scheduled[sId]} (from ${sName})</option>`;
        }
    }
    currentSchedule[day][branch].rest.forEach((name, i) => select.innerHTML += `<option value="rest_${i}">${name} (from Standby)</option>`);
    document.getElementById('swapModal').style.display = 'flex';
};

window.closeModal = function() { document.getElementById('swapModal').style.display = 'none'; swapData = null; };

window.executeSwap = function() {
    const target = document.getElementById('swapTarget').value;
    if (!target) return alert("Select someone.");
    const { day, branch, shiftId } = swapData;
    const curStaff = currentSchedule[day][branch].scheduled[shiftId];
    
    if (target.startsWith('shift_')) {
        const tSId = target.replace('shift_', '');
        currentSchedule[day][branch].scheduled[shiftId] = currentSchedule[day][branch].scheduled[tSId];
        currentSchedule[day][branch].scheduled[tSId] = curStaff;
    } else {
        const rIdx = parseInt(target.replace('rest_', ''));
        const tStaff = currentSchedule[day][branch].rest[rIdx];
        currentSchedule[day][branch].scheduled[shiftId] = tStaff;
        if (curStaff !== "UNFILLED") currentSchedule[day][branch].rest[rIdx] = curStaff;
        else currentSchedule[day][branch].rest.splice(rIdx, 1);
    }
    closeModal(); renderTables(); saveToCloud();
};

// 🔥 TAB MEMORY ENGINE
window.switchTab = function(branch) {
    currentActiveTab = branch; // Remembers your active tab!
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.id === `btn-${branch}`));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `content-${branch}`));
};

window.renderTables = function() {
    const container = document.getElementById("scheduleContainer"); if(!container) return;
    container.innerHTML = "";
    if (Object.keys(currentSchedule).length === 0) return;
    
    const tabBox = document.createElement("div"); tabBox.className = "tab-container";
    const contentWrap = document.createElement("div");
    container.appendChild(tabBox); container.appendChild(contentWrap);

    for (const branch in branchConfig) {
        const isAct = (branch === currentActiveTab); // Check memory!
        const btn = document.createElement("button");
        btn.className = `tab-btn ${isAct ? 'active' : ''}`; btn.innerText = `${branch} Schedule`; btn.id = `btn-${branch}`;
        btn.onclick = () => switchTab(branch); tabBox.appendChild(btn);

        const cBox = document.createElement("div");
        cBox.className = `tab-content ${isAct ? 'active' : ''}`; cBox.id = `content-${branch}`;
        const activeShifts = branchConfig[branch].filter(s => s.active);
        let tableHTML = `<table class="sched-table"><thead><tr><th class="date-col">Date</th>`;
        activeShifts.forEach(s => tableHTML += `<th>${s.name}</th>`);
        tableHTML += `<th>Standby</th><th>Off / Leave</th></tr></thead><tbody>`;

        for (let day in currentSchedule) {
            const dStr = new Date(currentYear, currentMonth - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            tableHTML += `<tr><td class="date-col">${dStr}</td>`;
            activeShifts.forEach(s => {
                const val = currentSchedule[day][branch].scheduled[s.id];
                if (val === "N/A") tableHTML += `<td style="background:#f1f5f9; color:#94a3b8;">-</td>`;
                else if (val === "UNFILLED") tableHTML += `<td><span class="empty-shift" onclick="openSwapModal(${day}, '${branch}', '${s.id}')">Needs Staff</span></td>`;
                else tableHTML += `<td><span class="clickable" onclick="openSwapModal(${day}, '${branch}', '${s.id}')">${val}</span></td>`;
            });
            tableHTML += `<td class="rest-day">${currentSchedule[day][branch].rest.join(", ") || "-"}</td>`;
            const un = currentSchedule[day][branch].unavailable.map(u => `${u.name} (${u.status})`).join("<br>");
            tableHTML += `<td>${un || "-"}</td></tr>`;
        }
        cBox.innerHTML = tableHTML + `</tbody></table>`;
        contentWrap.appendChild(cBox);
    }
};
