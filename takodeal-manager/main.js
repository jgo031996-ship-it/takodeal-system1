import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
// 🖼️ NEW: Storage Imports for Menu Pictures!
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

console.log("HEARTBEAT 1: File started reading!");
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
const storage = getStorage(app); // Ignite the Storage Engine!

window.storage = storage; // Make it global so the upload function can use it
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

window.loginWithGoogle = async function() {
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
window.loadAdminDashboard = async function() {
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
window.loadGlobalDashboard = async function() {
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
        tableHtml += `<tr><td><strong style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="openBranchDetails('${branch}')">${branch} </strong></td><td><span class="badge badge-closed"><span class="status-dot gray"></span> No Data</span></td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td><td class="text-center">-</td></tr>`;
        continue;
      }

      let shiftBadge = isActive
        ? '<span class="badge badge-active"><span class="status-dot green"></span> Active</span>'
        : (isClosed ? '<span class="badge badge-closed"><span class="status-dot gray"></span> Closed</span>' : '<span class="badge badge-closed">No Shift</span>');

      // Grab the starting cash safely
      let displayStartingCash = (isActive || isClosed) ? formatMoney(shiftData.startingCash || 0) : '-';

      tableHtml += `
        <tr>
          <td><strong style="cursor:pointer; color:var(--primary); text-decoration:underline;" onclick="openBranchDetails('${branch}')">${branch} </strong></td>
          <td>${shiftBadge}</td>
          <td>${displayCashier}</td>
          <td style="color: #64748b; font-weight: 500;">${displayStartingCash}</td>
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

  // 🐙 THE TAKOYAKI MILESTONE TRACKER
    try {
        const statsSnap = await getDoc(doc(db, "settings", "global_stats"));
        if (statsSnap.exists()) {
            let totalBalls = statsSnap.data().totalTakoyakiBalls || 0;
            let milestoneDiv = document.getElementById('milestoneCounter');
            if (milestoneDiv) milestoneDiv.innerText = `${totalBalls.toLocaleString()} Balls Sold!`;
        }
    } catch(e) { console.log("Tracker still waiting for first sale."); }

    // 🔥 FIX: WAKE UP THE GRAB ENGINE WHEN DASHBOARD LOADS!
    if (typeof window.calculateGrabFinancials === 'function') {
        window.calculateGrabFinancials();
    }

    // 🔥 NEW: WAKE UP THE PRODUCT ANALYTICS ENGINE!
    if (typeof window.loadProductAnalytics === 'function') {
        window.loadProductAnalytics(startOfDay, endOfDay);
    }
};

// --- WIRING THE BUTTONS ---
// Run the radar the moment the page loads
document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.setDefaultCutoffDates === 'function') { try { window.setDefaultCutoffDates(); } catch(e) {} }
});

  // Wire up the Refresh Button
  const refreshBtn = document.getElementById('btnRefreshData');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.innerText = "Scanning Cloud...";
      refreshBtn.style.opacity = "0.7";
      await window.loadGlobalDashboard();
      refreshBtn.innerText = "🔄 Refresh Live Data";
      refreshBtn.style.opacity = "1";
    });
  }

// --- THE HR & SECURITY ENGINE (ENTERPRISE UPGRADE) ---
window.loadHRModule = async function() {
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
      // Store globally so the modal can read it easily
      window.globalStaffData = {};

      snap.forEach(docSnap => {
        let data = docSnap.data();
        window.globalStaffData[docSnap.id] = data; // Cache data

        // 🔐 PIN LOGIC: Real PIN for Owner, Stars for Managers
        let pinDisplay = isOwner ? (data.pin || '0000') : '****';
        let rateDisplay = data.hourlyRate ? `₱${data.hourlyRate}/day` : `<span style="color:#ef4444; font-size:11px;">Rate Missing</span>`;

        html += `
          <tr>
            <td>
                <strong style="font-size: 15px; color: var(--primary);">👤 ${data.cashierName || 'Unknown'}</strong><br>
                <span style="font-size: 11px; color: var(--text-muted);">${data.phone || 'No Phone'}</span>
            </td>
            <td>📍 ${data.branch || 'Unassigned'}</td>
            <td>
                <span class="badge badge-active">${data.role || 'Crew'}</span><br>
                <span style="font-size: 12px; font-weight: bold; color: #16a34a; margin-top: 4px; display: inline-block;">${rateDisplay}</span>
            </td>
            <td style="font-family: monospace; font-size: 18px; letter-spacing: 2px; color: var(--danger); font-weight: bold;">
              ${pinDisplay}
            </td>
            <td>
              <button class="btn-refresh" style="background: white; border: 1px solid var(--primary); color: var(--primary); padding: 8px 12px; font-weight: bold; border-radius: 6px;" onclick="openEmployeeProfile('${docSnap.id}')">📂 Open Profile</button>
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
};

window.addNewStaff = function() {
    // Clear the modal for a fresh entry
    document.getElementById('empProfileId').value = '';
    document.getElementById('empFullName').value = '';
    document.getElementById('empBranchAssign').value = 'Cabantian';
    document.getElementById('empRole').value = 'Crew';
    document.getElementById('empDateHired').value = '';
    document.getElementById('empHourlyRate').value = '';
    document.getElementById('empPin').value = '';
    document.getElementById('empPhone').value = '';
    document.getElementById('empAddress').value = '';
    document.getElementById('empGcashName').value = '';
    document.getElementById('empGcashNum').value = '';
    document.getElementById('empGotymeName').value = '';
    document.getElementById('empGotymeNum').value = '';
    document.getElementById('empSSS').value = '';
    document.getElementById('empPhilhealth').value = '';
    document.getElementById('empPagibig').value = '';
    document.getElementById('empScheduleName').value = '';
    document.getElementById('employeeProfileModal').style.display = 'flex';
};

window.openEmployeeProfile = function(docId) {
    let data = window.globalStaffData[docId];
    if (!data) return;

    document.getElementById('empProfileId').value = docId;
    document.getElementById('empFullName').value = data.cashierName || '';
    document.getElementById('empBranchAssign').value = data.branch || 'Cabantian';
    document.getElementById('empRole').value = data.role || 'Crew';
    document.getElementById('empDateHired').value = data.dateHired || '';
    document.getElementById('empHourlyRate').value = data.hourlyRate || '';
    document.getElementById('empPin').value = data.pin || '';
    document.getElementById('empPhone').value = data.phone || '';
    document.getElementById('empAddress').value = data.address || '';
    document.getElementById('empGcashName').value = data.gcashName || '';
    document.getElementById('empGcashNum').value = data.gcashNum || '';
    document.getElementById('empGotymeName').value = data.gotymeName || '';
    document.getElementById('empGotymeNum').value = data.gotymeNum || '';
    document.getElementById('empSSS').value = data.sss || '';
    document.getElementById('empPhilhealth').value = data.philhealth || '';
    document.getElementById('empPagibig').value = data.pagibig || '';
    document.getElementById('empScheduleName').value = data.scheduleName || '';
    document.getElementById('employeeProfileModal').style.display = 'flex';
};

window.saveEmployeeProfile = async function() {
    let docId = document.getElementById('empProfileId').value;
    
    // Core validation
    let name = document.getElementById('empFullName').value.trim();
    let branch = document.getElementById('empBranchAssign').value;
    let rate = parseFloat(document.getElementById('empHourlyRate').value);
    let pin = document.getElementById('empPin').value.trim();

    if (!name || isNaN(rate) || !pin || pin.length !== 4) {
        alert("❌ Error: Name, Hourly Rate, and a 4-Digit PIN are strictly required!");
        return;
    }

    let payload = {
        cashierName: name,
        branch: branch,
        role: document.getElementById('empRole').value.trim(),
        dateHired: document.getElementById('empDateHired').value,
        hourlyRate: rate,
        pin: pin,
        phone: document.getElementById('empPhone').value.trim(),
        address: document.getElementById('empAddress').value.trim(),
        gcashName: document.getElementById('empGcashName').value.trim(),
        gcashNum: document.getElementById('empGcashNum').value.trim(),
        gotymeName: document.getElementById('empGotymeName').value.trim(),
        gotymeNum: document.getElementById('empGotymeNum').value.trim(),
        sss: document.getElementById('empSSS').value.trim(),
        philhealth: document.getElementById('empPhilhealth').value.trim(),
        pagibig: document.getElementById('empPagibig').value.trim(),
        scheduleName: document.getElementById('empScheduleName').value.trim(),
      
    };

    let btn = document.getElementById('btnSaveEmpProfile');
    btn.innerText = "⏳ Saving to Cloud..."; btn.disabled = true;

    try {
        if (docId) {
            // Update existing
            await updateDoc(doc(db, "cashiers", docId), payload);
            alert(`✅ ${name}'s profile has been updated.`);
        } else {
            // Create new
            await addDoc(collection(db, "cashiers"), payload);
            alert(`✅ ${name} has been added to the database.`);
        }
        
        document.getElementById('employeeProfileModal').style.display = 'none';
        window.loadHRModule(); // Refresh the table

    } catch (e) {
        console.error(e);
        alert("❌ Failed to save employee data.");
    } finally {
        btn.innerText = "💾 Save Employee Data"; btn.disabled = false;
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

    // Refresh the table to show the update
    window.loadHRModule();
    
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
  if (viewId === 'ledger') title = "Staff Loans & Ledger";
  if (viewId === 'payables') title = "Supplier Payables & Terms";
  if (viewId === 'receipt') title = "Thermal Printer Setup";
  if (viewId === 'schedule') {
        title = "Schedule & Shift Manager";
        loadFromCloud(); // Wakes up your new imported engine!
    }
  document.getElementById('pageTitle').innerText = title;

  // Trigger the engine for that specific page
  if (viewId === 'dashboard') window.loadGlobalDashboard();
  if (viewId === 'branches') window.loadHRModule();
  if (viewId === 'menu') window.loadMenuEditor();
  if (viewId === 'inventory') window.loadInventoryData();
  if (viewId === 'accounts') window.loadAccountsAndBudget();
  if (viewId === 'payroll') window.loadPayrollDashboard();
  if (viewId === 'inbox') window.loadInbox();
  if (viewId === 'products') window.loadMenuCosting();
  if (viewId === 'purchases') window.loadPurchasesAndAlerts();
  if (viewId === 'dispatch') window.loadDispatchDashboard();
  if (viewId === 'zreadings') window.loadZReadingReports();
  if (viewId === 'expenses') window.loadExpenseLogs();
  if (viewId === 'ledger') window.loadLedger();
  if (viewId === 'admin') window.loadAdminDashboard();
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

  const filterElement = document.getElementById('branchAlertFilter');
  let branchFilter = filterElement ? filterElement.value : "All Branches";

  try {
    const snap = await getDocs(collection(db, "inventory"));
    let html = '';
    window.globalInventoryList = []; 

    snap.forEach(docSnap => {
      let data = docSnap.data();
      data.id = docSnap.id;
      window.globalInventoryList.push(data); 

      if (branchFilter !== "All Branches" && data.branch !== branchFilter) return; 

      let stock = parseFloat(data.currentStock) || 0;
      let reorder = parseFloat(data.reorderLevel) || 0;

      if (stock <= reorder) {
        let suggested = (reorder * 2) - stock; 
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

  } catch (error) {
    console.error("Error loading alerts:", error);
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red;">Failed to scan inventory.</td></tr>';
  }
};
// ALIAS FOR THE HTML ONCLICK
window.loadAlerts = window.loadPurchasesAndAlerts;

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
    if (document.getElementById('view-purchases').classList.contains('active')) window.loadPurchasesAndAlerts();
    if (document.getElementById('view-inventory').classList.contains('active')) window.loadInventoryData();

  } catch (e) {
    console.error(e); alert("Failed to process restock.");
  } finally {
    btn.innerText = "Confirm Restock"; btn.disabled = false;
  }
};

// --- THE DISPATCH & LOGISTICS ENGINE ---
let dispatchCart = [];
let dispatchInventoryList = [];

window.loadDispatchDashboard = async function() {
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
  await window.loadDispatchInventory();
  await loadDispatchLogs();
};

// ========================================================
// 🧠 PHASE 5: SMART BURN RATE & SUPPLY CHAIN ENGINE
// ========================================================
window.latestSupplyChainData = []; // Add this to track the AI's math

window.loadSmartSupplyChain = async function() {
    let branch = document.getElementById('burnRateBranch').value;
    let tbody = document.getElementById('burnRateTableBody');

    if (!branch) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px; font-weight: bold; color: #8b5cf6;">⏳ Crunching 7 days of sales & recipes...</td></tr>';

    window.latestSupplyChainData = []; // Clear old memory on every new calculation

    try {
        let endDate = new Date();
        let startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);

        const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startDate));
        const txSnap = await getDocs(txQ);

        let itemSalesCount = {};
        let rawBurnData = {};

        txSnap.forEach(doc => {
            let tx = doc.data();
            if (tx.status !== 'Voided' && tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let name = item.name || item.itemName;
                    if (!name) return;
                    
                    let qtySold = item.qty || 1;
                    itemSalesCount[name] = (itemSalesCount[name] || 0) + qtySold;

                    if (item.addons) {
                        for (let key in item.addons) {
                            let addon = item.addons[key];
                            if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                                let addonBurn = addon.deductQty * addon.qty * qtySold;
                                rawBurnData[addon.linkedIngredient] = (rawBurnData[addon.linkedIngredient] || 0) + addonBurn;
                            }
                        }
                    }
                });
            }
        });

        const bomSnap = await getDocs(collection(db, "bom"));
        bomSnap.forEach(doc => {
            let recipe = doc.data();
            if (recipe.menuItem && recipe.ingredientName && itemSalesCount[recipe.menuItem]) {
                let amountBurned = (recipe.qty || 0) * itemSalesCount[recipe.menuItem];
                rawBurnData[recipe.ingredientName] = (rawBurnData[recipe.ingredientName] || 0) + amountBurned;
            }
        });

        const invQ = query(collection(db, "inventory"), where("branch", "==", branch));
        const invSnap = await getDocs(invQ);
        
        let html = '';
        let itemsAnalyzed = 0;

        let sortedInventory = [];
        invSnap.forEach(doc => sortedInventory.push(doc.data()));
        sortedInventory.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        sortedInventory.forEach(invItem => {
            let itemName = invItem.name;
            if (!itemName) return; 
            
            let currentStock = parseFloat(invItem.currentStock) || 0;
            let uom = invItem.uom || 'units';
            // THIS is the variable that caused the crash. It is now only declared once!
            let totalBurn7Days = rawBurnData[itemName] || 0;
            
            itemsAnalyzed++;
            
            let dailyBurn = totalBurn7Days / 7;
            let daysLeft = dailyBurn > 0 ? (currentStock / dailyBurn) : 999;
            
            let daysColor = "#16a34a"; 
            let daysText = Math.floor(daysLeft) + " days";
            
            if (currentStock <= 0) { daysColor = "#dc2626"; daysText = "OUT OF STOCK!"; }
            else if (daysLeft < 3) { daysColor = "#ea580c"; daysText = Math.floor(daysLeft) + " days (CRITICAL)"; }
            else if (daysLeft === 999) { daysColor = "#94a3b8"; daysText = "No Burn Data"; }

            let suggestedRestock = Math.ceil(totalBurn7Days); 
            
            window.latestSupplyChainData.push({
                itemName: itemName,
                suggestedRestock: suggestedRestock,
                currentStock: currentStock,
                uom: uom
            });

            html += `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="font-weight: bold; color: #334155;">${itemName}</td>
                    <td style="font-weight: bold; font-size: 15px;">${currentStock.toFixed(1)} <span style="font-size:11px; color:#64748b; font-weight:normal;">${uom}</span></td>
                    <td>${totalBurn7Days.toFixed(1)} ${uom}</td>
                    <td style="color: #ea580c; font-weight: bold;">${dailyBurn.toFixed(2)} ${uom}/day</td>
                    <td style="color: ${daysColor}; font-weight: bold; font-size: 15px;">${daysText}</td>
                    <td>
                        <button onclick="document.getElementById('dispItem').value='${itemName}'; window.updateDispatchUomLabel(); window.scrollTo(0,0);" 
                            style="background: white; border: 1px solid #8b5cf6; color: #8b5cf6; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer;">
                            📦 Send Stock
                        </button>
                    </td>
                </tr>
            `;
        });

        if (itemsAnalyzed === 0) {
            html = '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No inventory items found in this branch yet. Add items first!</td></tr>';
        }

        tbody.innerHTML = html;

    } catch (e) {
        console.error("Supply Chain Engine Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red; padding: 20px; font-weight: bold;">⚠️ Error fetching data. Open F12 Console to see if a Firebase Index is missing.</td></tr>';
    }
};

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
    // 🟢 NEW: Trigger the label update so it defaults to the correct units!
    window.updateDispatchUomLabel();
  } catch (e) { console.error(e); drop.innerHTML = '<option value="">Error loading stock</option>'; }
};

// 🟢 NEW: Updates the dropdown to show "Packs" vs "grams" based on the item
window.updateDispatchUomLabel = function() {
    let itemName = document.getElementById('dispItem').value;
    let uomDrop = document.getElementById('dispUomSelect');
    
    if (!itemName) {
        uomDrop.innerHTML = '<option value="base">Units</option>';
        return;
    }

    let invItem = dispatchInventoryList.find(i => i.name === itemName);
    if (invItem) {
        let baseUom = invItem.uom || 'units';
        let purchUom = invItem.purchaseUom || 'Bulk';
        
        uomDrop.innerHTML = `
            <option value="purch">${purchUom}</option>
            <option value="base">${baseUom}</option>
        `;
    }
};

window.addToDispatchCart = function () {
  let itemName = document.getElementById('dispItem').value;
  let rawQty = parseFloat(document.getElementById('dispQty').value);
  let selectedUomType = document.getElementById('dispUomSelect').value;

  if (!itemName || isNaN(rawQty) || rawQty <= 0) { alert("Please select an item and valid quantity."); return; }

  let invItem = dispatchInventoryList.find(i => i.name === itemName);
  if (!invItem) return;

  // 🟢 NEW: THE CONVERSION MAGIC!
  let finalBaseQty = rawQty;
  let displayMsg = `${rawQty} ${invItem.uom}`;

  if (selectedUomType === 'purch') {
      let convRate = parseFloat(invItem.conversionRate) || 1;
      finalBaseQty = rawQty * convRate; // Multiply 1 Pack x 2000 grams!
      displayMsg = `${rawQty} ${invItem.purchaseUom} <span style="font-size:11px; color:var(--text-muted);">(${finalBaseQty} ${invItem.uom})</span>`;
  }

  // Prevent sending more than we have
  if (finalBaseQty > invItem.currentStock) { 
      alert(`❌ Not enough stock!\n\nYou are trying to send ${finalBaseQty} ${invItem.uom}, but you only have ${invItem.currentStock} ${invItem.uom} available.`); 
      return; 
  }

  let existing = dispatchCart.find(i => i.itemName === itemName);
  if (existing) { 
      existing.qty += finalBaseQty; 
      existing.displayMsg = `${existing.qty} ${invItem.uom}`; // Updates text if added twice
  } else { 
      dispatchCart.push({ 
          itemName: itemName, 
          qty: finalBaseQty, 
          uom: invItem.uom, 
          sourceId: invItem.id,
          displayMsg: displayMsg // Store the beautiful breakdown for the table
      }); 
  }

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
    let qtyText = item.displayMsg || `${item.qty} ${item.uom}`;
    
    html += `<tr>
      <td><strong>${item.itemName}</strong></td>
      <td style="font-size:14px; font-weight:bold; color:var(--primary);">${qtyText}</td>
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
    window.loadDispatchInventory();
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
window.loadMenuEditor = async function() {
  const tbody = document.getElementById('menuTableBody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Fetching global menu...</td></tr>';

  // Grab the selected filter category
  let catFilterEl = document.getElementById('menuEditorCatFilter');
  let selectedCat = catFilterEl ? catFilterEl.value : 'All';

  try {
    const snap = await getDocs(collection(db, "menu"));
    let html = '';

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">Menu is empty. Click "Add Menu Item" to start.</td></tr>';
      return;
    } 
    
    let items = [];
    let uniqueCategories = new Set();

    // Collect all items and dynamically find all categories
    snap.forEach(doc => {
        let data = doc.data();
        items.push({ id: doc.id, ...data });
        if (data.category) uniqueCategories.add(data.category.trim());
    });

    // Populate the dropdown with the categories found in the database
    if (catFilterEl) {
        let optionsHtml = '<option value="All">All Categories</option>';
        Array.from(uniqueCategories).sort().forEach(cat => {
            let isSelected = (cat === selectedCat) ? 'selected' : '';
            optionsHtml += `<option value="${cat}" ${isSelected}>${cat}</option>`;
        });
        catFilterEl.innerHTML = optionsHtml;
    }

    // Sort items alphabetically
    items.sort((a, b) => a.name.localeCompare(b.name));

    let count = 0;
    items.forEach(data => {
      let cat = data.category || 'Uncategorized';
      
      // 🔥 THE FILTER: Skip items that don't match the selected category
      if (selectedCat !== 'All' && cat !== selectedCat) return;
      
      count++;
      let safePrice = parseFloat(data.price) || 0;
      
      // 🖼️ Generate Thumbnail or Placeholder
      let imgHtml = data.image 
          ? `<img src="${data.image}" style="width:40px; height:40px; border-radius:6px; object-fit:cover; display:inline-block; vertical-align:middle; margin-right:10px; border:1px solid #e2e8f0;">` 
          : `<div style="width:40px; height:40px; border-radius:6px; background:#f1f5f9; display:inline-flex; align-items:center; justify-content:center; font-size:18px; vertical-align:middle; margin-right:10px; border:1px solid #e2e8f0;">🍲</div>`;

      html += `
        <tr>
          <td>${imgHtml}<strong> ${data.name}</strong></td>
          <td><span class="badge badge-closed">${cat}</span></td>
          <td style="font-weight: 600; color: var(--primary);">${formatMoney(safePrice)}</td>
          <td style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn-refresh" onclick="editMenuItem('${data.id}', '${data.name}', ${safePrice}); setTimeout(function(){ if(window.loadCloneDropdown) window.loadCloneDropdown(); }, 200);">✏️ Edit Price</button>
            
            <label style="cursor: pointer; background: #f0fdf4; border: 1px solid #16a34a; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin: 0; display: inline-flex; align-items: center;">
                📷 Upload Pic
                <input type="file" accept="image/jpeg, image/png, image/webp" style="display:none;" onchange="window.uploadMenuImage(event, '${data.id}')">
            </label>

            <button class="btn-refresh" style="color: var(--danger); border-color: var(--danger);" onclick="deleteMenuItem('${data.id}', '${data.name}')">🗑️ Delete</button>
          </td>
        </tr>
      `;
    });
    
    tbody.innerHTML = count > 0 ? html : `<tr><td colspan="4" class="text-center">No items found in category: ${selectedCat}.</td></tr>`;
  } catch (error) {
    console.error("Menu Engine Error:", error);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: red;">Error loading menu.</td></tr>';
  }
};

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
    window.loadMenuEditor();
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
    window.loadMenuEditor();
  } catch (error) {
    console.error(error); alert("❌ Failed to update price.");
  }
  // Wake up the cloning dropdown!
    if (typeof window.loadCloneDropdown === "function") {
        window.loadCloneDropdown();
    }
  // The automatic Wake-Up trigger for the clone dropdown
    setTimeout(() => {
        if (typeof window.loadCloneDropdown === "function") {
            window.loadCloneDropdown();
        }
    }, 200);
  };

// --- 🖼️ IMAGE UPLOAD ENGINE ---
window.uploadMenuImage = async function(event, docId) {
    const file = event.target.files[0];
    if (!file) return;

    // Strict Size Limit (2MB max) to ensure Customer App loads fast
    if (file.size > 2 * 1024 * 1024) {
        alert("⚠️ Image is too large! Please choose a picture under 2MB.");
        return;
    }

    // Give visual feedback on the button
    const label = event.target.parentElement;
    const originalHTML = label.innerHTML;
    label.innerText = "⏳ Uploading...";
    label.style.opacity = "0.7";

    try {
        // 1. Create a clean, unique file name
        const fileExt = file.name.split('.').pop();
        const fileName = `menu_images/${docId}_${Date.now()}.${fileExt}`;
        const storageReference = ref(window.storage, fileName);

        // 2. Upload physical file to Firebase Storage
        const snapshot = await uploadBytes(storageReference, file);
        
        // 3. Get the live, public URL of the uploaded image
        const downloadURL = await getDownloadURL(snapshot.ref);

        // 4. Update the Firestore Database so the Customer App sees it
        await updateDoc(doc(db, "menu", docId), {
            image: downloadURL
        });

        alert("✅ Image uploaded and linked successfully!");
        window.loadMenuEditor(); // Refresh table to show the new thumbnail
        
    } catch (e) {
        console.error("Upload error:", e);
        alert("❌ Failed to upload image. Ensure Firebase Storage is fully activated.");
        label.innerHTML = originalHTML;
        label.style.opacity = "1";
    }
};

// --- DETAILED BRANCH ANALYTICS ENGINE (UPGRADED WITH TRUE COGS) ---
window.openBranchDetails = async function (branch) {
  document.getElementById('analyticsModal').style.display = 'flex';
  document.getElementById('modalBranchName').innerText = `📊 ${branch} Analytics`;

  // Read both dates
  const startDateInput = document.getElementById('dashStartDate');
  const endDateInput = document.getElementById('dashEndDate');
  const startDay = new Date(startDateInput.value);
  const endDay = new Date(endDateInput.value);

  // Display the range in the modal
  document.getElementById('modalDateDisplay').innerText = `${startDay.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} - ${endDay.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  document.getElementById('mdlNet').innerText = "Loading...";
  document.getElementById('tbCatBody').innerHTML = '<tr><td colspan="5" class="text-center">Calculating Margins...</td></tr>';

  const startOfDay = new Date(startDay.setHours(0, 0, 0, 0));
  const endOfDay = new Date(endDay.setHours(23, 59, 59, 999));

  try {
    // 1. Fetch transactions for this branch and date
    const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
    const txSnap = await getDocs(txQ);

    let netSales = 0; let totalItems = 0; let transCount = 0; let voidCount = 0;
    let categories = {}; // To track Best Sellers and Margins
    let payments = {};   // To track Cash vs GCash
    let transHtml = '';

    // Sort transactions by time (newest first)
    let allTx = [];
    txSnap.forEach(doc => allTx.push(doc.data()));
    allTx.sort((a, b) => b.timestamp - a.timestamp);

    // 🔥 NEW: Fetch Inventory Base Costs
    const invSnap = await getDocs(collection(db, "inventory"));
    let inventoryCosts = {};
    invSnap.forEach(doc => {
        let data = doc.data();
        inventoryCosts[data.name] = parseFloat(data.baseCost) || 0;
    });

    // 🔥 NEW: Fetch Recipes to calculate standard COGS
    const bomSnap = await getDocs(collection(db, "bom"));
    let recipeCosts = {};
    bomSnap.forEach(doc => {
        let data = doc.data();
        if (!recipeCosts[data.menuItem]) recipeCosts[data.menuItem] = 0;
        let ingCost = inventoryCosts[data.ingredientName] || 0;
        recipeCosts[data.menuItem] += (ingCost * (data.qty || 1));
    });

    // 🔥 NEW: Fetch Menu for True Categories
    const menuSnap = await getDocs(collection(db, "menu"));
    let menuCategories = {};
    menuSnap.forEach(doc => {
        menuCategories[doc.data().name] = doc.data().category || 'Uncategorized';
    });

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

        // 🔥 NEW: Track True Categories, Sales, and Advanced COGS
        if (tx.cart && Array.isArray(tx.cart)) {
          tx.cart.forEach(item => {
            let qty = item.qty || 1;
            totalItems += qty;

            let itemName = item.name || item.itemName;
            let cat = menuCategories[itemName] || item.category || 'Uncategorized';
            
            if (!categories[cat]) categories[cat] = { qty: 0, sales: 0, cogs: 0 };

            categories[cat].qty += qty;
            
            // Calculate Sales (Fallback to base price if lineTotalFinal is missing)
            let lineRevenue = item.lineTotalFinal !== undefined ? item.lineTotalFinal : ((item.variantPrice || item.basePrice || 0) * qty);
            categories[cat].sales += lineRevenue;

            // Calculate Base Recipe COGS
            let baseCogs = (recipeCosts[itemName] || 0) * qty;
            let addonCogs = 0;
            
            // Calculate Add-on COGS exactly based on the ingredients used!
            if (item.addons) {
                for (let key in item.addons) {
                    let addon = item.addons[key];
                    if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                        let aCost = inventoryCosts[addon.linkedIngredient] || 0;
                        addonCogs += (aCost * addon.deductQty * addon.qty * qty);
                    }
                }
            }
            
            categories[cat].cogs += (baseCogs + addonCogs);
          });
        }

        transHtml += `<tr><td>${timeStr}</td><td><strong>${tx.receiptId}</strong></td><td>${payMethod}</td><td><span class="badge badge-active"><span class="status-dot green"></span> PAID</span></td><td style="font-weight: 600; color: var(--primary);">${formatMoney(tx.netTotal)}</td></tr>`;
      }
    });

    // --- DRAWER CASH & AUDIT ENGINE ---
    const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
    const expSnap = await getDocs(expQ);
    let dateExpenses = 0;
    expSnap.forEach(doc => dateExpenses += (doc.data().amount || 0));

    const shiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true));
    const shiftSnap = await getDocs(shiftQ);

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

    // --- INJECT KPIs ---
    document.getElementById('mdlNet').innerText = formatMoney(netSales);
    document.getElementById('mdlItems').innerText = totalItems;
    document.getElementById('mdlTrans').innerText = transCount;
    document.getElementById('mdlVoids').innerText = voidCount;

    // --- INJECT ADVANCED CATEGORIES WITH MARGINS ---
    let catHtml = '';
    let sortedCats = Object.keys(categories).sort((a, b) => categories[b].sales - categories[a].sales);

    sortedCats.forEach(cat => {
        let data = categories[cat];
        let profit = data.sales - data.cogs;
        let margin = data.sales > 0 ? (profit / data.sales) * 100 : 0;
        let marginColor = margin > 50 ? '#16a34a' : (margin > 30 ? '#f59e0b' : '#dc2626');

        catHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="font-weight: bold; color: #334155; padding: 10px;">${cat}</td>
                <td style="padding: 10px;">${data.qty} items</td>
                <td style="font-weight: bold; color: #d97706; padding: 10px;">${formatMoney(data.sales)}</td>
                <td style="font-weight: bold; color: #ef4444; padding: 10px;">${formatMoney(data.cogs)}</td>
                <td style="font-weight: 900; color: ${marginColor}; padding: 10px;">${margin.toFixed(1)}%</td>
            </tr>
        `;
    });

    // Dynamically update the table headers so you don't have to edit the HTML!
    let catTableHead = document.getElementById('tbCatBody').previousElementSibling.querySelector('tr');
    if (catTableHead) {
        catTableHead.innerHTML = '<th style="text-align:left; padding:10px;">Category</th><th style="text-align:left; padding:10px;">Sold</th><th style="text-align:left; padding:10px;">Gross</th><th style="text-align:left; padding:10px;">Est. COGS</th><th style="text-align:left; padding:10px;">Margin</th>';
    }

    document.getElementById('tbCatBody').innerHTML = catHtml || '<tr><td colspan="5" class="text-center">No items sold.</td></tr>';

    // --- INJECT PAYMENTS ---
    let payHtml = '';
    for (let p in payments) {
      payHtml += `<tr><td style="padding: 10px;"><strong>${p}</strong></td><td style="color: var(--success); font-weight: 600; padding: 10px;">${formatMoney(payments[p])}</td></tr>`;
    }
    document.getElementById('tbPayBody').innerHTML = payHtml || '<tr><td colspan="2" class="text-center">No payments logged.</td></tr>';

    // --- INJECT TRANSACTIONS ---
    document.getElementById('tbTransBody').innerHTML = transHtml || '<tr><td colspan="5" class="text-center">No transactions on this date.</td></tr>';

  } catch (error) {
    console.error("Analytics Error:", error);
    document.getElementById('tbCatBody').innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error loading analytics.</td></tr>';
  }
};

// --- THE LIVE INVENTORY ENGINE (UPGRADED WITH FILTERING) ---
window.loadInventoryData = async function() {
  // Force the UI back to the Live Tab when this is called (e.g., from sidebar)
  let liveTab = document.getElementById('invTabLiveContent');
  let logsTab = document.getElementById('invTabLogsContent');
  if (liveTab) liveTab.style.display = 'block';
  if (logsTab) logsTab.style.display = 'none';

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
            <button class="btn-refresh" style="background: white; color: var(--text-main); border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px;" onclick="window.openEditInv('${editData}')">✏️ Edit</button> 
            <button onclick="window.deleteInventoryItem('${data.id}', '${data.name}')" style="color: #ef4444; border: 1px solid #ef4444; background: transparent; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 5px;">🗑️ Delete</button>
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
};

window.openInventoryLogs = function() {
  let liveTab = document.getElementById('invTabLiveContent');
  let logsTab = document.getElementById('invTabLogsContent');
  if (liveTab) liveTab.style.display = 'none';
  if (logsTab) logsTab.style.display = 'block';
  
  if (typeof window.loadStockLogs === 'function') {
    window.loadStockLogs();
  }
};

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
        const duplicateQuery = query(collection(db, "inventory"), where("name", "==", name));
        const duplicateSnap = await getDocs(duplicateQuery);
        
        if (!duplicateSnap.empty) {
            alert(`❌ Blocked: "${name}" already exists in your inventory! Please use Multi-Restock to add more quantity.`);
            return; // Stops the code dead in its tracks!
        }
    } catch (err) {
        console.error("Error checking for duplicates:", err);
        alert("Database connection error while verifying item.");
        return;
    }
  
  try {
    await addDoc(collection(db, "inventory"), { branch: branch, name: name, category: category, uom: uom, baseCost: cost, currentStock: initStock, reorderLevel: 5 });
    alert(`✅ Success! ${name} added to ${branch} warehouse.`);
    window.loadInventoryData();
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
    window.loadInventoryData();
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
    const q = query(
      collection(db, "inventory"),
      where("branch", "==", branch), // <--- Just use the word "branch" here!
      where("category", "==", "Prepared Batch") // <--- THIS IS THE MAGIC FILTER
    );
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
    window.loadInventoryData(); // Refresh the table

  } catch (error) {
    console.error(error); alert("Failed to prepare batch.");
  } finally {
    btn.innerText = "🚀 Mix & Deduct Ingredients"; btn.disabled = false;
  }
};

window.loadAccountsAndBudget = async function() {
    // ==========================================
    // 🏦 PART 1: THE COLLAPSIBLE CASH LEDGER
    // ==========================================
    try {
        const tbody = document.getElementById('accTableBody');
        if (tbody) {
            const snap = await getDocs(collection(db, "cash_accounts"));
            let accountsByBranch = {};
            let totalCash = 0;
            
            // 🔥 FIX: Reset the global memory so transfers and expenses work!
            window.liveAccounts = []; 

            snap.forEach(docSnap => {
                let data = docSnap.data();
                data.id = docSnap.id;
                let branch = data.branch || "Unassigned";

                window.liveAccounts.push(data); // Save to memory

                if (!accountsByBranch[branch]) accountsByBranch[branch] = [];
                accountsByBranch[branch].push(data);
                totalCash += (data.balance || 0);
            });

            if(document.getElementById('accTotalCash')) {
                document.getElementById('accTotalCash').innerText = `₱${totalCash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            }

            let html = '';
            for (let branch in accountsByBranch) {
                let branchTotal = accountsByBranch[branch].reduce((sum, acc) => sum + (acc.balance || 0), 0);
                let safeBranchId = branch.replace(/\s+/g, ''); 

                html += `
                    <tr style="background: #f8fafc; cursor: pointer; border-bottom: 2px solid #cbd5e1;" 
                        onclick="window.toggleBranchAccounts('${safeBranchId}')">
                        <td colspan="2" style="font-weight: 900; color: #0f766e; font-size: 16px; padding: 15px;">
                            <span id="icon_${safeBranchId}" style="display:inline-block; width:20px; color:#94a3b8;">▼</span> 🏢 ${branch}
                        </td>
                        <td style="font-weight: 900; color: #16a34a; font-size: 16px; padding: 15px;">
                            ₱${branchTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}
                        </td>
                        <td style="text-align: right; padding: 15px;">
                            <span style="font-size: 12px; color: #64748b; background: #e2e8f0; padding: 4px 8px; border-radius: 12px; font-weight: bold;">
                                ${accountsByBranch[branch].length} Accounts
                            </span>
                        </td>
                    </tr>
                `;

                accountsByBranch[branch].forEach(acc => {
                    html += `
                        <tr class="branch-row-${safeBranchId}" style="display: none; background: white; border-bottom: 1px dashed #e2e8f0;">
                            <td style="padding-left: 45px; color: #94a3b8; font-size: 18px;">↳</td>
                            <td style="font-weight: bold; color: #334155;">${acc.name}</td>
                            <td style="font-weight: bold; color: #059669;">₱${(acc.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td>
                                <button onclick="window.editCashAccount('${acc.id}', '${acc.name}', ${acc.balance || 0})" style="background: #fffbeb; color: #d97706; border: 1px solid #fde68a; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; margin-right: 5px;">✏️ Edit</button>
                                <button onclick="window.deleteCashAccount('${acc.id}', '${acc.name}')" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">🗑️</button>
                            </td>
                        </tr>
                    `;
                });
            }
            tbody.innerHTML = html;
        }
    } catch (e) {
        console.error("Error loading accounts:", e);
    }

    // ==========================================
    // 💸 PART 2: THE MONTHLY BUDGET TRACKER 
    // ==========================================
    try {
        const budgetBody = document.getElementById('budgetListBody');
        if (!budgetBody) return;

        const budgetSnap = await getDocs(collection(db, "budgets"));
        let bHtml = '';
        let totalB = 0;
        let totalS = 0;
        
        // 🔥 FIX: Reset the budget memory so the Expense logger works!
        window.liveBudgets = []; 

        let budgetItems = [];
        budgetSnap.forEach(doc => { budgetItems.push({id: doc.id, ...doc.data()}) });
        budgetItems.sort((a, b) => (a.branch || "Unassigned").localeCompare(b.branch || "Unassigned"));

        if (budgetItems.length === 0) {
            bHtml = '<div class="text-center" style="color: #64748b; padding: 20px;">No budget categories found. Click "+ Category" to start tracking.</div>';
        } else {
            budgetItems.forEach(b => {
                window.liveBudgets.push(b); // Save to memory

                let limit = parseFloat(b.limit || b.amount || 0);
                let spent = parseFloat(b.spent || 0);
                let branchName = b.branch || "Unassigned";
                
                totalB += limit;
                totalS += spent;

                let pct = limit > 0 ? (spent / limit) * 100 : 0;
                let barColor = pct >= 90 ? '#ef4444' : (pct >= 75 ? '#f59e0b' : '#10b981');
                
                let branchBadge = `<span style="background: #ede9fe; color: #8b5cf6; padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-right: 10px; border: 1px solid #ddd6fe; font-weight: bold;">📍 ${branchName}</span>`;

                bHtml += `
                    <div style="margin-bottom: 20px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <div style="display: flex; align-items: center;">
                                ${branchBadge}
                                <span style="color: #334155; font-size: 14px; font-weight: bold;">${b.category || b.name || 'Category'}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <span style="color: ${barColor}; font-weight: bold; font-size: 13px;">₱${spent.toLocaleString(undefined, {minimumFractionDigits: 2})} / ₱${limit.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                
                                <button onclick="window.editBudgetCategory('${b.id}', '${b.category || b.name}', ${limit})" style="background: white; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;" title="Edit Limit">✏️ Edit</button>
                                <button onclick="window.deleteBudgetCategory('${b.id}', '${b.category || b.name}')" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;" title="Delete">🗑️ Delete</button>
                            </div>
                        </div>
                        <div style="background: #cbd5e1; height: 10px; border-radius: 5px; overflow: hidden;">
                            <div style="width: ${Math.min(pct, 100)}%; height: 100%; background: ${barColor}; transition: width 0.5s;"></div>
                        </div>
                    </div>
                `;
            });
        }
        
        budgetBody.innerHTML = bHtml;
        if (document.getElementById('accTotalBudget')) document.getElementById('accTotalBudget').innerText = `₱${totalB.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (document.getElementById('accTotalSpent')) document.getElementById('accTotalSpent').innerText = `₱${totalS.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    } catch (e) {
        console.error("Budget Error:", e);
        const budgetBody = document.getElementById('budgetListBody');
        if (budgetBody) budgetBody.innerHTML = '<div class="text-center" style="color: red; padding: 20px;">Error loading budgets.</div>';
    }
};

// Toggle Engine for the Accordion Ledger
window.toggleBranchAccounts = function(branchId) {
    let rows = document.querySelectorAll('.branch-row-' + branchId);
    let icon = document.getElementById('icon_' + branchId);
    if(rows.length === 0) return;
    
    let isHidden = rows[0].style.display === 'none';
    rows.forEach(row => {
        row.style.display = isHidden ? 'table-row' : 'none';
    });
    
    if (icon) {
        icon.innerText = isHidden ? '▲' : '▼';
        icon.style.color = isHidden ? '#0f766e' : '#94a3b8';
    }
};

// Toggle Engine for the Accordion
window.toggleBranchAccounts = function(branchId) {
    let rows = document.querySelectorAll('.branch-row-' + branchId);
    let icon = document.getElementById('icon_' + branchId);
    if(rows.length === 0) return;
    
    let isHidden = rows[0].style.display === 'none';
    rows.forEach(row => {
        row.style.display = isHidden ? 'table-row' : 'none';
    });
    
    if (icon) {
        icon.innerText = isHidden ? '▲' : '▼';
        icon.style.color = isHidden ? '#0f766e' : '#94a3b8';
    }
};

// --- CASH ACCOUNT EDIT & DELETE ACTIONS ---
window.editCashAccount = function(docId, accName, currentBal) {
    // Fill the beautiful UI Modal instead of using an ugly prompt!
    document.getElementById('editAccId').value = docId;
    document.getElementById('editAccOldBalance').value = currentBal || 0;
    document.getElementById('editAccName').value = accName;
    document.getElementById('editAccBalance').value = currentBal || 0;
    document.getElementById('editAccReason').value = '';
    document.getElementById('editAccountModal').style.display = 'flex';
};

window.saveAccountEdit = async function() {
    let docId = document.getElementById('editAccId').value;
    let oldBal = parseFloat(document.getElementById('editAccOldBalance').value) || 0;
    let newName = document.getElementById('editAccName').value.trim();
    let newBal = parseFloat(document.getElementById('editAccBalance').value);
    let reason = document.getElementById('editAccReason').value.trim();

    if (!newName) { alert("❌ Account name cannot be blank."); return; }
    if (isNaN(newBal)) { alert("❌ Invalid balance amount."); return; }
    if (oldBal !== newBal && !reason) { alert("⚠️ SECURITY ALERT: You are changing the balance. You MUST provide a Reason for Update!"); return; }

    try {
        // 1. Update the Account
        await updateDoc(doc(db, "cash_accounts", docId), { name: newName, balance: newBal });
        
        // 2. Log the Action if the money changed!
        let difference = newBal - oldBal;
        if (difference !== 0) {
            await addDoc(collection(db, "account_logs"), {
                accountId: docId,
                accountName: newName,
                action: "Manager Manual Adjustment",
                amount: difference,
                newBalance: newBal,
                user: window.sessionUser ? window.sessionUser.cashierName : 'Owner',
                timestamp: serverTimestamp(),
                note: reason
            });
        }

        alert(`✅ Account successfully updated!`);
        document.getElementById('editAccountModal').style.display = 'none';
        window.loadAccountsAndBudget();
    } catch(e) { console.error(e); alert("Failed to update account."); }
};

window.deleteCashAccount = async function(docId, accName) {
    if (!confirm(`⚠️ ARE YOU SURE?\n\nDelete cash account: ${accName}?\nThis cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, "cash_accounts", docId));
        alert(`🗑️ ${accName} deleted.`);
        window.loadAccountsAndBudget();
    } catch(e) { console.error(e); alert("Failed to delete account."); }
};

// --- BUDGET CATEGORY EDIT & DELETE ACTIONS ---
window.editBudgetCategory = async function(docId, catName, currentLimit) {
    let newLimitStr = prompt(`Update monthly limit for ${catName} (₱):`, currentLimit);
    if (newLimitStr === null) return;
    let newLimit = parseFloat(newLimitStr);
    if (isNaN(newLimit) || newLimit < 0) { alert("❌ Invalid limit amount."); return; }

    try {
        await updateDoc(doc(db, "budgets", docId), { limit: newLimit });
        alert(`✅ ${catName} limit successfully updated to ₱${newLimit.toLocaleString()}!`);
        window.loadAccountsAndBudget();
    } catch(e) { console.error(e); alert("Failed to update budget limit."); }
};

window.deleteBudgetCategory = async function(docId, catName) {
    if (!confirm(`⚠️ ARE YOU SURE?\n\nDelete budget category: ${catName}?\nThis cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, "budgets", docId));
        alert(`🗑️ ${catName} budget category deleted.`);
        window.loadAccountsAndBudget();
    } catch(e) { console.error(e); alert("Failed to delete budget."); }
};

window.addCashAccount = async function () {
  let branch = prompt("Enter Branch (Main Office, Cabantian, Citygate, Maa):", "Main Office");
  if (!branch) return;
  let name = prompt("Account Name (e.g., Petty Cash, BDO, GCash):");
  if (!name) return;
  let bal = parseFloat(prompt("Initial Balance (₱):", "0")) || 0;

  try {
    await addDoc(collection(db, "cash_accounts"), { branch, name, balance: bal });
    window.loadAccountsAndBudget();
  } catch (e) { console.error(e); alert("Failed to add account."); }
};

// ==========================================
// 🔄 UPGRADED CASH TRANSFER ENGINE
// ==========================================
window.transferCash = function () {
  if (!window.liveAccounts || window.liveAccounts.length < 2) { 
      alert("You need at least 2 accounts to make a transfer."); 
      return; 
  }

  // Build the beautiful dropdown options
  let optionsHtml = '<option value="">-- Select Account --</option>';
  window.liveAccounts.forEach(acc => {
      optionsHtml += `<option value="${acc.id}">${acc.name} (${acc.branch}) - Bal: ₱${acc.balance.toLocaleString()}</option>`;
  });

  // Inject them into the new Modal
  document.getElementById('transferFromAcc').innerHTML = optionsHtml;
  document.getElementById('transferToAcc').innerHTML = optionsHtml;
  document.getElementById('transferAmount').value = '';

  // Pop open the modal!
  document.getElementById('transferModal').style.display = 'flex';
};

window.submitCashTransfer = async function() {
    let fromId = document.getElementById('transferFromAcc').value;
    let toId = document.getElementById('transferToAcc').value;
    let amt = parseFloat(document.getElementById('transferAmount').value);

    if (!fromId || !toId) { alert("Please select both accounts."); return; }
    if (fromId === toId) { alert("Cannot transfer to the same account."); return; }
    if (isNaN(amt) || amt <= 0) { alert("Please enter a valid amount."); return; }

    let fromAcc = window.liveAccounts.find(a => a.id === fromId);
    let toAcc = window.liveAccounts.find(a => a.id === toId);

    if (fromAcc.balance < amt) { 
        alert(`❌ Insufficient funds in ${fromAcc.name}.\nAvailable balance: ₱${fromAcc.balance.toLocaleString()}`); 
        return; 
    }

    let btn = document.getElementById('btnSubmitTransfer');
    btn.innerText = "⏳ Transferring..."; btn.disabled = true;

    try {
        // 1. Update both balances
        await updateDoc(doc(db, "cash_accounts", fromAcc.id), { balance: fromAcc.balance - amt });
        await updateDoc(doc(db, "cash_accounts", toAcc.id), { balance: toAcc.balance + amt });
        
        // 2. Write the Audit Trail!
        let currentUser = window.sessionUser ? window.sessionUser.cashierName : 'Owner';
        
        // Log the Deduction
        await addDoc(collection(db, "account_logs"), {
            accountId: fromAcc.id, accountName: fromAcc.name, branch: fromAcc.branch,
            action: "Fund Transfer (Out)", amount: -amt, newBalance: fromAcc.balance - amt,
            user: currentUser, timestamp: serverTimestamp(), note: `Transferred to ${toAcc.name}`
        });

        // Log the Deposit
        await addDoc(collection(db, "account_logs"), {
            accountId: toAcc.id, accountName: toAcc.name, branch: toAcc.branch,
            action: "Fund Transfer (In)", amount: amt, newBalance: toAcc.balance + amt,
            user: currentUser, timestamp: serverTimestamp(), note: `Received from ${fromAcc.name}`
        });

        alert(`✅ Successfully transferred ₱${amt.toLocaleString()} from ${fromAcc.name} to ${toAcc.name}.`);
        document.getElementById('transferModal').style.display = 'none';
        window.loadAccountsAndBudget();
    } catch (e) { 
        console.error(e); 
        alert("Transfer failed. Check console."); 
    } finally {
        btn.innerText = "Confirm Transfer"; btn.disabled = false;
    }
};

// 🛠️ THE FIX FOR THE LOGS BUTTON ERROR 
// ==========================================
// 📜 ACCOUNT AUDIT LOGS ENGINE
// ==========================================
window.openAccountHistory = async function() {
    document.getElementById('accountHistoryModal').style.display = 'flex';
    const tbody = document.getElementById('accHistoryTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 30px;">⏳ Fetching secure audit logs...</td></tr>';

    try {
        // Fetch the 50 most recent logs to keep the app lightning fast!
        const q = query(collection(db, "account_logs"), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);

        let html = '';

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
            
            let amount = parseFloat(data.amount) || 0;
            let balance = parseFloat(data.newBalance) || 0;
            
            // Color code the money based on if it went UP or DOWN
            let actionColor = amount > 0 ? '#16a34a' : (amount < 0 ? '#dc2626' : '#64748b');
            let amountSign = amount > 0 ? '+' : '';

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: white;">
                    <td style="padding: 12px 10px; font-size: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #334155;">👤 ${data.user || 'System'}</td>
                    <td style="padding: 12px 10px;">
                        <span style="font-weight: bold; color: var(--primary);">${data.action || 'Manual Edit'}</span><br>
                        <span style="font-size: 12px; color: ${actionColor}; font-weight: bold;">${amountSign}₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </td>
                    <td style="padding: 12px 10px;">
                        <strong>${data.accountName || 'Unknown'}</strong><br>
                        <span style="font-size: 11px; color: #64748b;">New Bal: ₱${balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </td>
                    <td style="padding: 12px 10px; font-size: 12px; color: #475569; font-style: italic; max-width: 200px;">
                        ${data.note || data.reason || 'No notes provided.'}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = snap.empty ? '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #64748b;">No account logs found.</td></tr>' : html;

    } catch (e) {
        console.error("Audit Log Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red; padding: 30px;">❌ Error loading audit logs. Check connection.</td></tr>';
    }
};

// ==========================================
// 🛠️ BUDGET MANAGEMENT CONTROLS
// ==========================================

window.addBudgetCategory = async function() {
    let branch = prompt("Enter Branch for this budget (e.g., Cabantian, Citygate, Maa, Main Office):", "Main Office");
    if (!branch) return; // Cancelled
    
    let category = prompt(`Enter the new budget category name for ${branch} (e.g., Rent, Water, Marketing):`);
    if (!category) return;
    
    let limitStr = prompt(`Enter the monthly budget limit for ${branch} - ${category} (₱):`, "0");
    if (!limitStr) return;
    
    let limit = parseFloat(limitStr);
    if (isNaN(limit) || limit < 0) { alert("Invalid amount."); return; }

    try {
        await addDoc(collection(db, "budgets"), {
            branch: branch.trim(),
            category: category.trim(),
            limit: limit,
            spent: 0,
            createdAt: serverTimestamp()
        });
        alert(`✅ Success! Budget added for ${branch}.`);
        window.loadAccountsAndBudget();
    } catch (e) {
        console.error("Error adding budget:", e);
        alert("Failed to add category.");
    }
};

window.editBudget = async function(id, name, currentLimit, branch) {
    let newLimitStr = prompt(`Edit Monthly Budget Limit for ${branch} - ${name}:\n\nEnter new amount (₱):`, currentLimit);
    if (newLimitStr === null || newLimitStr === "") return;
    
    let newLimit = parseFloat(newLimitStr);
    if (isNaN(newLimit) || newLimit < 0) {
        alert("❌ Invalid amount entered.");
        return;
    }

    try {
        await updateDoc(doc(db, "budgets", id), {
            limit: newLimit,
            amount: newLimit // Legacy fallback just in case
        });
        window.loadAccountsAndBudget(); // Instantly refresh UI
    } catch (e) {
        console.error(e);
        alert("❌ Failed to update budget.");
    }
};

window.deleteBudget = async function(id) {
    if (!confirm("⚠️ Are you sure you want to permanently delete this budget category?")) return;
    
    try {
        await deleteDoc(doc(db, "budgets", id));
        window.loadAccountsAndBudget(); // Instantly refresh UI
    } catch (e) {
        console.error(e);
        alert("❌ Failed to delete budget.");
    }
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
    window.loadAccountsAndBudget();
  } catch (e) { console.error(e); alert("Failed to log expense."); }
};

// --- THE PAYROLL & HR ENGINE ---
window.loadPayrollDashboard = async function() {
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

    // NOTE: This is an estimated default rate (400/day). 
    // In a future update, we can pull exact rates from the Cashier's profile!
    const DAILY_RATE = 450;

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
          let basePay = DAILY_RATE;

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
};

window.adjustPayroll = async function (shiftId, name, basePay) {
  let bonus = parseFloat(prompt(`Adding BONUS for ${name}.\nBase Pay is ${formatMoney(basePay)}.\n\nEnter bonus amount (₱):`, "0")) || 0;
  let deduct = parseFloat(prompt(`Adding DEDUCTION for ${name}.\n\nEnter deduction amount (₱):`, "0")) || 0;

  if (bonus === 0 && deduct === 0) return;

  try {
    await updateDoc(doc(db, "shifts", shiftId), { payrollBonus: bonus, payrollDeduct: deduct });
    alert(`✅ Success! Payroll recalculated for ${name}.`);
    window.loadPayrollDashboard();
  } catch (e) {
    console.error(e); alert("Failed to adjust payroll.");
  }
};

// --- MENU COSTING & BOM ENGINE ---
let globalInventoryCosts = {};
let currentEditingMenuItem = "";

// ========================================================
// 🔥 DYNAMIC TABBED MENU COSTING & SEARCH ENGINE 🔥
// ========================================================
window.activeCostingTab = 'All';

window.switchCostingTab = function (element, tabName) {
  window.activeCostingTab = tabName;
  window.loadMenuCosting(); // This redraws the table AND the tabs to highlight the right one!
};

window.loadMenuCosting = async function() {
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
    // Inject the new tabs and PROTECT them from getting squished by Flexbox!
    document.querySelectorAll('#costingTabsContainer').forEach(container => {
        container.style.minHeight = "45px"; 
        container.style.flexShrink = "0";
        container.innerHTML = tabsHtml;
    });

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
          <td>
              <div style="display: flex; gap: 5px;">
                  <button class="btn-refresh" style="background: white; border: 1px solid var(--primary); color: var(--primary); padding: 6px 12px; font-size: 12px; border-radius: 4px; cursor: pointer;" onclick="openBomEditor('${item.name}')">✏️ Update</button>
                  <button style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 6px 12px; font-size: 12px; border-radius: 4px; cursor: pointer;" onclick="window.deleteMenuAndBom('${item.id}', '${item.name}')">🗑️</button>
              </div>
          </td>
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
};

window.openNewProductModal = async function () {
  document.getElementById('advancedProductModal').style.display = 'flex';
  document.getElementById('advProdId').value = '';
  document.getElementById('advProdName').value = '';
  document.getElementById('advProdName').readOnly = false; 
  document.getElementById('advProdCat').value = window.activeCostingTab !== 'All' ? window.activeCostingTab : 'Main Menu';
  document.getElementById('advProdPrice').value = 0;
  
  // 🛠️ FIX 2: Load Addon inventory
  await window.preloadInventoryForAddons();
  document.getElementById('addonTableBody').innerHTML = '';

  window.currentAdvRecipe = [];
  window.renderAdvRecipeTable();
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
  window.updateInvSummary();
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
        let baseCost = cost / conv; 
        
        // 🔥 THE FAIL-SAFE FIX: Check if the box exists before reading it!
        let checkboxEl = document.getElementById('newInvShowCashier');
        let showCashier = checkboxEl ? checkboxEl.checked : true; 

        await addDoc(collection(db, "inventory"), {
          branch: branch,
          name: name,
          category: category,
          purchaseUom: purchUom,
          uom: baseUom, 
          conversionRate: conv,
          purchaseCost: cost,
          baseCost: baseCost, 
          currentStock: totalBaseStock, 
          reorderLevel: reorder,
          showToCashier: showCashier
        });
    
    alert(`✅ Success! Added ${name} to ${branch}.`);
    document.getElementById('addInvModal').style.display = 'none';
    window.loadInventoryData();
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

// 🛠️ FIX 2: Pre-load the Add-ons BEFORE opening the modal!
window.openBomEditor = async function (menuItemName) {
  document.getElementById('advancedProductModal').style.display = 'flex';
  document.getElementById('advProdName').value = menuItemName;
  document.getElementById('advRecipeBody').innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';

  // WAIT for inventory to load so the Add-on dropdowns actually work!
  await window.preloadInventoryForAddons(); 

  try {
    const menuQ = query(collection(db, "menu"), where("name", "==", menuItemName));
    const menuSnap = await getDocs(menuQ);
    if (!menuSnap.empty) {
      let mData = menuSnap.docs[0].data();
      document.getElementById('addonTableBody').innerHTML = '';
      if (mData.addons && Array.isArray(mData.addons)) {
        mData.addons.forEach(addon => {
          window.addAddonRow(addon.name, addon.price, addon.linkedIngredient, addon.deductQty);
        });
      }
      document.getElementById('advProdId').value = menuSnap.docs[0].id;
      document.getElementById('advProdCat').value = mData.category || '';
      document.getElementById('advProdPrice').value = mData.price || 0;
    }

    const bomQ = query(collection(db, "bom"), where("menuItem", "==", menuItemName));
    const bomSnap = await getDocs(bomQ);
    window.currentAdvRecipe = [];
    bomSnap.forEach(docSnap => {
      let data = docSnap.data();
      data.docId = docSnap.id; 
      window.currentAdvRecipe.push(data);
    });
    window.renderAdvRecipeTable();
  } catch (e) {
    console.error(e); alert("Failed to load product details.");
  }
};

  // The automatic Wake-Up trigger for the clone dropdown
    setTimeout(() => {
        if (typeof window.loadCloneDropdown === "function") {
            window.loadCloneDropdown();
        }
    }, 200);

window.renderAdvRecipeTable = function () {
  const tbody = document.getElementById('advRecipeBody');
  let html = '';
  let totalCost = 0;

  // 1. Build the hidden "Smart Search" Datalist
  let datalistHtml = '<datalist id="inventoryDatalist">';
  for (let invName in globalInventoryCosts) {
    datalistHtml += `<option value="${invName}">`;
  }
  datalistHtml += '</datalist>';

  // Inject the datalist into the page if it's not there yet
  if (!document.getElementById('inventoryDatalist')) {
     document.body.insertAdjacentHTML('beforeend', datalistHtml);
  } else {
     document.getElementById('inventoryDatalist').innerHTML = datalistHtml.replace('<datalist id="inventoryDatalist">', '').replace('</datalist>', '');
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

      // 2. The Upgraded Searchable Input box
      let nameField = item.isNew
        ? `<input type="text" list="inventoryDatalist" value="${item.ingredientName}" placeholder="Type to search..." style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; outline: none; box-sizing: border-box; font-weight: bold; color: #0284c7;" onchange="updateAdvRecipeName(${index}, this.value)">`
        : `<input type="text" value="${item.ingredientName}" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; background: #f9fafb; outline: none; box-sizing: border-box;" readonly>`;

      html += `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 5px;">${nameField}</td>
          <td style="padding: 10px 5px;"><input type="number" value="${item.qty || 0}" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; outline: none; box-sizing: border-box;" onkeyup="updateAdvRecipeQty(${index}, this.value)" onchange="updateAdvRecipeQty(${index}, this.value)"></td>
          <td style="padding: 10px 5px; color: #6b7280; font-size: 13px;">${uom}</td>
          <td style="padding: 10px 5px; font-weight: bold; color: #4b5563;">${formatMoney(lineCost)}</td>
          <td style="padding: 10px 5px; text-align: center;"><button onclick="removeAdvRecipeRow(${index})" style="background: none; border: none; cursor: pointer; color: #ef4444; font-size: 16px;">🗑️</button></td>
        </tr>
      `;
    });
  }

  tbody.innerHTML = html;
  document.getElementById('advTotalCost').innerText = formatMoney(totalCost);
  window.calcAdvProfit(totalCost);
};

window.addAdvRecipeRow = function () {
  window.currentAdvRecipe.push({ ingredientName: "", qty: 0, isNew: true });
  window.renderAdvRecipeTable();
};

window.updateAdvRecipeName = function (index, newName) {
  window.currentAdvRecipe[index].ingredientName = newName;
  window.renderAdvRecipeTable(); // Re-render to update UOM and Costs
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
  window.calcAdvProfit(totalCost);
};

window.removeAdvRecipeRow = function (index) {
  // If it came from the database, we flag it for deletion upon saving
  if (window.currentAdvRecipe[index].docId) {
    if (!window.deletedAdvRecipes) window.deletedAdvRecipes = [];
    window.deletedAdvRecipes.push(window.currentAdvRecipe[index].docId);
  }
  window.currentAdvRecipe.splice(index, 1);
  window.renderAdvRecipeTable();
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
    // 🍟 NEW: GATHER ALL ADD-ONS BEFORE SAVING
    let addonsArray = [];
    document.querySelectorAll('#addonTableBody tr').forEach(row => {
      let nameInput = row.querySelector('.addon-name');
      
      // Only save if they actually typed an Add-on name
      if (nameInput && nameInput.value.trim() !== '') { 
        addonsArray.push({
          name: nameInput.value.trim(),
          price: parseFloat(row.querySelector('.addon-price').value) || 0,
          linkedIngredient: row.querySelector('.addon-ingredient').value,
          deductQty: parseFloat(row.querySelector('.addon-qty').value) || 0
        });
      }
    });

    // 1. Save Menu Details AND Add-ons (Update OR Create New)
    if (menuId) {
      await updateDoc(doc(db, "menu", menuId), { 
          name: prodName, 
          category: category, 
          price: price,
          addons: addonsArray // 👈 This glues the Add-ons to the product!
      });
    } else {
      let newMenuRef = await addDoc(collection(db, "menu"), { 
          name: prodName, 
          category: category, 
          price: price,
          addons: addonsArray // 👈 This glues the Add-ons to the product!
      });
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

    // 🔥 NEW: Updated Success Message!
    alert("✅ Product, Recipe, and Add-ons saved successfully!");
        
    // 1. Safely close the modal
    let modal = document.getElementById('advancedProductModal');
    if (modal) {
        modal.style.display = 'none';
    } else {
        console.warn("Could not find modal to close. Check your HTML ID!");
    }

    // 2. Refresh the table
    window.loadMenuCosting(); 

  } catch (error) {
    console.error("Save Error:", error); 
    alert("Failed to save product. Check Console for details.");
  } finally {
    // 3. Bulletproof Button Reset
    if (typeof btn !== 'undefined' && btn) {
        btn.innerText = "Save Changes"; 
        btn.disabled = false;
    } else {
        document.querySelectorAll('button').forEach(b => {
            if (b.innerText.includes("Saving")) {
                b.innerText = "Save Changes";
                b.disabled = false;
            }
        });
    }
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
    
    // ✅ THE BULLETPROOF FIX (TOP)
    if (uploadBtn) {
        uploadBtn.innerText = "⏳ Uploading Recipes..."; 
        uploadBtn.disabled = true;
    }

    try {
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

        await addDoc(collection(db, "bom"), {
          menuItem: menuItem,
          ingredientName: ingredientName,
          qty: qty
        });

        successCount++;
      }
      alert(`✅ Recipes Uploaded!\n\nAdded ${successCount} ingredient links.\nErrors: ${errorCount}`);
      window.loadMenuCosting();
    } catch (error) {
      console.error(error); alert("❌ Fatal Error.");
    } finally {
      // ✅ THE BULLETPROOF FIX (BOTTOM)
      if (uploadBtn) { 
          uploadBtn.innerText = "📂 Upload CSV Recipes"; 
          uploadBtn.disabled = false; 
      }
      event.target.value = '';
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
    
    // ✅ THE BULLETPROOF FIX (TOP)
    if (uploadBtn) {
        uploadBtn.innerText = "⏳ Cleaning & Uploading..."; 
        uploadBtn.disabled = true;
    }

    try {
      for (let i = 1; i < rows.length; i++) {
        let cols = rows[i];
        if (cols.length === 1 && cols[0].trim() === "") continue;
        if (cols.length < 9) { errorCount++; continue; }

        let name = cols[2].trim();
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
      window.loadInventoryData();
    } catch (error) {
      console.error(error); alert("❌ Fatal Error.");
    } finally {
      // ✅ THE BULLETPROOF FIX (BOTTOM)
      if (uploadBtn) { 
          uploadBtn.innerText = "📂 Bulk Upload CSV"; 
          uploadBtn.disabled = false; 
      }
    }
  };
  reader.readAsText(file);
};

// ========================================================
// 🔥 STOCK HISTORY & LOGGING ENGINE 🔥
// ========================================================
window.loadStockLogs = async function() {
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
};

// ==========================================
// ✏️ UPGRADED INVENTORY EDIT ENGINE
// ==========================================
window.calcEditCost = function() {
    let purchCost = parseFloat(document.getElementById('editInvPurchCost').value) || 0;
    let conversion = parseFloat(document.getElementById('editInvConversion').value) || 1;
    let baseUom = document.getElementById('editInvBaseUom').value || 'Unit';
    let baseCost = purchCost / conversion;
    let summaryEl = document.getElementById('editInvCostSummary');
    if(summaryEl) summaryEl.innerHTML = `Calculated Base Cost: <strong style="color:#d97706;">₱${baseCost.toFixed(4)}</strong> per ${baseUom}`;
};

window.calcEditVariance = function() {
    let oldQ = parseFloat(document.getElementById('editInvOldQty').value) || 0;
    let newQInput = document.getElementById('editInvNewQty').value;
    let varEl = document.getElementById('editInvVariance');

    if (newQInput === '') {
        varEl.innerText = '0';
        varEl.style.color = '#64748b';
        return;
    }

    let newQ = parseFloat(newQInput) || 0;
    let diff = newQ - oldQ;
    
    varEl.innerText = diff > 0 ? '+' + diff : diff;
    if (diff < 0) varEl.style.color = '#ef4444';
    else if (diff > 0) varEl.style.color = '#10b981';
    else varEl.style.color = '#64748b';
};

window.openEditInv = async function(encodedData) {
    let passedData = JSON.parse(decodeURIComponent(encodedData));
    let id = passedData.id;

    if (!id) {
        alert("❌ Error: Cannot find item ID.");
        return;
    }

    // Open the modal immediately so the user sees action
    document.getElementById('editInvModal').style.display = 'flex';
    
    // Show a loading indicator in the name field while it fetches from the cloud
    document.getElementById('editInvName').value = "⏳ Loading fresh data from Cloud...";

    try {
        // 🔥 DIRECT CLOUD FETCH: Grab the absolute newest data directly from Firebase!
        const docRef = doc(db, "inventory", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            let data = docSnap.data();

            // Fill all the detailed info directly from the Cloud!
            document.getElementById('editInvId').value = id;
            document.getElementById('editInvBranch').value = data.branch || passedData.branch || 'Main Office';
            document.getElementById('editInvName').value = data.name || '';
            document.getElementById('editInvCat').value = data.category || 'Ingredients';
            
            document.getElementById('editInvPurchUom').value = data.purchUom || '';
            document.getElementById('editInvBaseUom').value = data.uom || data.baseUom || '';
            document.getElementById('editInvConversion').value = data.conversion || 1;
            
            // Calculate the Purchase Cost if it's missing
            let purchCost = data.purchCost;
            if (purchCost === undefined) {
                purchCost = (data.costPerBaseUOM || data.cost || 0) * (data.conversion || 1);
            }
            document.getElementById('editInvPurchCost').value = purchCost.toFixed(2);
            
            document.getElementById('editInvLowStock').value = data.reorderLevel || 0;
            document.getElementById('editInvOldQty').value = data.currentStock || 0;
            // Safely check if the box exists before trying to tick it!
            let cashierCheck = document.getElementById('editInvShowCashier');
            if (cashierCheck) cashierCheck.checked = data.showToCashier !== false;
            
            // Reset Variance inputs
            document.getElementById('editInvNewQty').value = '';
            document.getElementById('editInvNote').value = '';
            document.getElementById('editInvVariance').innerText = '0';
            document.getElementById('editInvVariance').style.color = '#64748b';

            // Trigger the cost math visually
            window.calcEditCost();
        } else {
            alert("❌ Item not found in database.");
            document.getElementById('editInvModal').style.display = 'none';
        }
    } catch (e) {
        console.error("Error fetching item details:", e);
        alert("❌ Failed to load item details from cloud. Check your connection.");
        document.getElementById('editInvModal').style.display = 'none';
    }
};

window.saveInventoryEdit = async function () {
    let id = document.getElementById('editInvId').value;
    if (!id) { alert("❌ Error: Missing Document ID."); return; }

    let newName = document.getElementById('editInvName').value.trim();
    if (!newName) { alert("❌ Item Name cannot be empty."); return; }
    
    // Grab all the new form values
    let newCat = document.getElementById('editInvCat').value;
    let branch = document.getElementById('editInvBranch').value;
    let purchUom = document.getElementById('editInvPurchUom').value.trim();
    let baseUom = document.getElementById('editInvBaseUom').value.trim();
    let conversion = parseFloat(document.getElementById('editInvConversion').value) || 1;
    let purchCost = parseFloat(document.getElementById('editInvPurchCost').value) || 0;
    let reorderLevel = parseFloat(document.getElementById('editInvLowStock').value) || 0;
    
    // Calculate the mathematical Base Cost
    let newBaseCost = purchCost / conversion;

    let oldQty = parseFloat(document.getElementById('editInvOldQty').value) || 0;
    let newQtyInput = document.getElementById('editInvNewQty').value;
    let newQty = newQtyInput === '' ? oldQty : parseFloat(newQtyInput);
    let note = document.getElementById('editInvNote').value.trim();
    
    // 🔥 THE FAIL-SAFE FIX: Check if the box exists before reading it!
    let checkboxEl = document.getElementById('editInvShowCashier');
    let showCashier = checkboxEl ? checkboxEl.checked : true; 
    
    let variance = newQty - oldQty;
    if (variance !== 0 && !note) {
        alert("❌ VARIANCE DETECTED: You must provide an Adjustment Note/Reason.");
        return;
    }

    let btn = document.getElementById('btnSaveInvEdit');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        // 🔥 Save EVERYTHING with the Brute-Force Base Cost update!
        await updateDoc(doc(db, "inventory", id), { 
            name: newName,
            category: newCat,
            branch: branch,
            purchUom: purchUom,
            uom: baseUom,         // legacy compatibility
            baseUom: baseUom,     // modern variable
            conversion: conversion,
            purchCost: purchCost,
            reorderLevel: reorderLevel,
            costPerBaseUOM: newBaseCost,
            cost: newBaseCost,
            baseCost: newBaseCost,
            currentStock: newQty,       // <--- THE MISSING COMMA IS HERE!
            showToCashier: showCashier 
        });
        
        // Log Variance if physical stock was changed
        if (variance !== 0) {
            await addDoc(collection(db, "stock_logs"), {
                branch: branch, 
                item: newName, 
                uom: baseUom, 
                oldQty: oldQty, 
                newQty: newQty, 
                variance: variance, 
                type: "Manual Variance Adjustment",
                note: note,
                user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
                timestamp: new Date()
            });
        }
        
        alert(`✅ Item completely updated successfully!`);
        document.getElementById('editInvModal').style.display = 'none';
        window.loadInventoryData();
        
    } catch (e) { 
        console.error(e); alert("❌ Failed to save."); 
    } finally { 
        btn.innerText = "💾 Save All Changes"; btn.disabled = false; 
    }
};

// ========================================================
// 🧹 UPGRADED SELECTIVE RESET PROTOCOL 🧹
// ========================================================
window.openSelectiveResetModal = function() {
    // Uncheck everything by default to prevent accidental deletions
    document.querySelectorAll('#selectiveResetModal input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('wipeConfirmText').value = '';
    document.getElementById('selectiveResetModal').style.display = 'flex';
};

window.executeSelectiveWipe = async function() {
    let confirmWord = document.getElementById('wipeConfirmText').value.trim();
    if (confirmWord !== "CLEAN SLATE") {
        alert("❌ You must type CLEAN SLATE to confirm.");
        return;
    }

    let collectionsToWipe = [];
    if (document.getElementById('wipeTransactions').checked) collectionsToWipe.push("transactions");
    if (document.getElementById('wipeShifts').checked) collectionsToWipe.push("shifts");
    if (document.getElementById('wipeExpenses').checked) collectionsToWipe.push("expenses");
    if (document.getElementById('wipeStockLogs').checked) collectionsToWipe.push("stock_logs");
    if (document.getElementById('wipeDispatch').checked) collectionsToWipe.push("dispatch_logs");
    if (document.getElementById('wipeAttendance').checked) collectionsToWipe.push("attendance_logs");

    let resetInv = document.getElementById('wipeInventoryStock').checked;
    let resetMilestone = document.getElementById('wipeMilestone').checked;

    if (collectionsToWipe.length === 0 && !resetInv && !resetMilestone) {
        alert("⚠️ Please select at least one box to reset.");
        return;
    }

    let btn = document.getElementById('btnExecuteSelectiveWipe');
    btn.innerText = "⏳ Wiping Data...";
    btn.disabled = true;

    try {
        // 1. Wipe Selected Collections
        for (let colName of collectionsToWipe) {
            const snap = await getDocs(collection(db, colName));
            for (let docSnap of snap.docs) {
                await deleteDoc(doc(db, colName, docSnap.id));
            }
        }

        // 2. Reset Live Inventory Stock to 0
        if (resetInv) {
            const invSnap = await getDocs(collection(db, "inventory"));
            for (let iDoc of invSnap.docs) {
                await updateDoc(doc(db, "inventory", iDoc.id), { currentStock: 0 });
            }
        }

        // 3. Reset the TAKOYAKI MILESTONE TRACKER to 0
        if (resetMilestone) {
            await setDoc(doc(db, "settings", "global_stats"), { totalTakoyakiBalls: 0 });
        }

        alert("✅ Selective Reset Complete!\n\nYour selected databases have been cleared.");
        location.reload();

    } catch (error) {
        console.error("Incinerator Error:", error);
        alert("❌ An error occurred while wiping the data.");
    } finally {
        btn.innerText = "🗑️ Delete Selected";
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

    const branchFilter = document.getElementById('transferBranchFilter') ? document.getElementById('transferBranchFilter').value : 'All';
    
    const today = new Date().toISOString().split('T')[0];
    const startInput = document.getElementById('transferStartDate');
    const endInput = document.getElementById('transferEndDate');
    
    const startDateRaw = (startInput && startInput.value) ? startInput.value : today;
    const endDateRaw = (endInput && endInput.value) ? endInput.value : today;

    const startTimestamp = new Date(startDateRaw + 'T00:00:00');
    const endTimestamp = new Date(endDateRaw + 'T23:59:59');

    try {
        // 🔥 THE FIX: We fetch TWO things at the same time:
        // 1. ALL Pending Remittances (so they never get lost)
        // 2. The standard date-filtered log for your history
        
        let pendingQ;
        let logQ;

        if (branchFilter === 'All') {
            pendingQ = query(collection(db, "remittances"), where("status", "==", "Pending"));
            logQ = query(collection(db, "remittances"), where("timestamp", ">=", startTimestamp), where("timestamp", "<=", endTimestamp), orderBy("timestamp", "desc"));
        } else {
            pendingQ = query(collection(db, "remittances"), where("branch", "==", branchFilter), where("status", "==", "Pending"));
            logQ = query(collection(db, "remittances"), where("branch", "==", branchFilter), where("timestamp", ">=", startTimestamp), where("timestamp", "<=", endTimestamp), orderBy("timestamp", "desc"));
        }

        const [pendingSnap, logSnap] = await Promise.all([getDocs(pendingQ), getDocs(logQ)]);

        let uniqueTransfers = new Map();
        let totalCash = 0;
        let pendingCount = 0;

        // Process Log (Received/Completed within date range)
        logSnap.forEach(docSnap => {
            let data = docSnap.data();
            if (data.status === "Received") {
                totalCash += (data.amount || 0);
            }
            uniqueTransfers.set(docSnap.id, data);
        });

        // Process Pending (Always forces them into the table so you can approve them!)
        pendingSnap.forEach(docSnap => {
            let data = docSnap.data();
            pendingCount++;
            uniqueTransfers.set(docSnap.id, data); 
        });

        // Convert our list back to an array and sort it newest-first
        let sortedTransfers = Array.from(uniqueTransfers, ([id, data]) => ({ id, ...data }));
        sortedTransfers.sort((a, b) => {
            let timeA = a.timestamp ? a.timestamp.toMillis() : 0;
            let timeB = b.timestamp ? b.timestamp.toMillis() : 0;
            return timeB - timeA;
        });

        let html = '';

        sortedTransfers.forEach(data => {
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';
            let status = data.status || "Pending"; 
            
            let statusBadge = status === "Received"
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">✅ Received</span>`
                : `<span style="background: #fef9c3; color: #ca8a04; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Pending</span>`;

            let actionBtn = status === "Pending"
                ? `<button onclick="approveRemittance('${data.id}')" style="background: var(--primary); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; width: 100%;">Approve</button>`
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
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px; color: red;">Error fetching data. Check Console.</td></tr>';
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
        window.loadCashExplorer(); 
        if (typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();

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
      if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
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
    window.loadDeviceFleet();
  } catch (e) { alert("Failed to update status."); }
};

window.deleteDevice = async function (deviceId) {
  if (!confirm("Are you sure you want to permanently delete this device? It will log out the tablet.")) return;
  try {
    await deleteDoc(doc(db, "pos_devices", deviceId));
    window.loadDeviceFleet();
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
    window.preloadInventoryForAddons(); // Just in case it wasn't preloaded
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

window.cloneAddons = async function() {
    const selectDropdown = document.getElementById('addonCloneSelect');
    const sourceId = selectDropdown.value;
    const sourceName = selectDropdown.options[selectDropdown.selectedIndex].text;

    if (!sourceId) {
        alert("Please select a product to copy Add-ons from!");
        return;
    }

    if (!confirm(`Copy all Add-ons from ${sourceName}? This will add them to your current list.`)) {
        return;
    }

    try {
        console.log(`🔎 Fetching Add-ons from menu item: ${sourceName}`);
        
        // Since your save code uses the "menu" collection...
        const docRef = doc(db, "menu", sourceId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && docSnap.data().addons) {
            const copiedAddons = docSnap.data().addons;
            let count = 0;

            copiedAddons.forEach(item => {
                // We use your existing function to draw the rows!
                window.addAddonRow(
                    item.name, 
                    item.price, 
                    item.linkedIngredient, 
                    item.deductQty
                );
                count++;
            });

            alert(`✅ Successfully added ${count} Add-ons!`);
        } else {
            alert(`⚠️ No Add-ons found for "${sourceName}".`);
        }
    } catch (error) {
        console.error("🔴 Error cloning Add-ons:", error);
        alert("Failed to copy Add-ons.");
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
// 📊 Z-READING & VARIANCE AUDIT DASHBOARD
// ========================================================
window.loadZReadingReports = async function () {
  const tbody = document.getElementById('zReadingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading audit reports from cloud...</td></tr>';

  let dateFilter = document.getElementById('zReadingDateFilter') ? document.getElementById('zReadingDateFilter').value : "";

  try {
    const q = query(collection(db, "shifts"), where("status", "==", "Closed"), orderBy("endTime", "desc"));
    const snap = await getDocs(q);

    let html = '';
    let count = 0;
    
    let sumDeclared = 0;
    let sumExpected = 0;
    let sumVariance = 0;

    snap.forEach(docSnap => {
      let data = docSnap.data();
      if (!data.endTime || !data.startTime) return;
      
      let jsDate = data.startTime.toDate(); 
      
      if (dateFilter) {
          let yyyy = jsDate.getFullYear();
          let mm = String(jsDate.getMonth() + 1).padStart(2, '0');
          let dd = String(jsDate.getDate()).padStart(2, '0');
          let formattedDate = `${yyyy}-${mm}-${dd}`;
          if (formattedDate !== dateFilter) return; 
      }

      let dateStr = data.endTime.toDate().toLocaleString('en-PH');
      let declared = data.declaredCash || 0;
      let expected = data.expectedCash || 0;
      let variance = declared - expected;
      
      // Add to our running totals
      sumDeclared += declared;
      sumExpected += expected;
      sumVariance += variance;

      let expectedFormatted = `₱${expected.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      let declaredFormatted = `₱${declared.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      
      let varColor = variance < 0 ? "#dc2626" : (variance > 0 ? "#16a34a" : "#64748b");
      let varText = variance === 0 ? `<span style="color:#16a34a; font-weight:bold;">Perfect</span>` : `<span style="color:${varColor}; font-weight:bold;">${variance > 0 ? '+' : ''}₱${variance.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>`;

      // Safely encode the JSON strings so they don't break the HTML button
      let breakdownStr = encodeURIComponent(JSON.stringify(data.cashBreakdown || {}));
      let stockStr = encodeURIComponent(JSON.stringify(data.physicalStockCount || {}));
      let safeCashier = data.cashier ? data.cashier.replace(/'/g, "\\'") : 'Unknown';
      let safeBranch = data.branch ? data.branch.replace(/'/g, "\\'") : 'Unknown';

      html += `
        <tr>
          <td>${dateStr}</td>
          <td><span class="badge badge-closed">${safeBranch}</span></td>
          <td><strong>${safeCashier}</strong></td>
          <td style="font-size: 13px;">Exp: <strong>${expectedFormatted}</strong><br>Dec: <strong style="color:var(--primary);">${declaredFormatted}</strong></td>
          <td>${varText}</td>
          <td>
            <button onclick="viewZReadingDetails('${breakdownStr}', '${stockStr}', '${safeCashier}', '${safeBranch}', ${declared})" class="btn-refresh" style="background: #0f172a; color: white; border: none; padding: 6px 12px; border-radius: 6px;">🔍 Full Audit</button>
          </td>
        </tr>
      `;
      count++;
    });

    if (document.getElementById('zSumDeclared')) document.getElementById('zSumDeclared').innerText = `₱${sumDeclared.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    if (document.getElementById('zSumExpected')) document.getElementById('zSumExpected').innerText = `₱${sumExpected.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    let gVarColor = sumVariance < 0 ? "#dc2626" : (sumVariance > 0 ? "#16a34a" : "#0f172a");
    let gVarText = sumVariance === 0 ? "₱0.00 (Balanced)" : `${sumVariance > 0 ? '+' : ''}₱${sumVariance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    if (document.getElementById('zSumVariance')) {
        document.getElementById('zSumVariance').innerText = gVarText;
        document.getElementById('zSumVariance').style.color = gVarColor;
    }

    if (count === 0 && dateFilter) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No shifts started on ${dateFilter}.</td></tr>`;
    } else {
        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center">No closed shifts found.</td></tr>';
    }
  } catch (error) {
    console.error("Error loading Z-Readings:", error);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading reports. Check console.</td></tr>';
  }
};

// ========================================================
// 💸 EXPENSE & RESTOCK FEED ENGINE (DATE FILTER UPGRADE)
// ========================================================
window.loadExpenseLogs = async function() {
    const tbody = document.getElementById('expenseLogsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading logs...</td></tr>';

    let dateFilter = document.getElementById('expenseDateFilter') ? document.getElementById('expenseDateFilter').value : "";
    
    // 🔥 NEW: Variables to track the math!
    let totalExp = 0;
    let countExp = 0;

    try {
        const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let jsDate = data.timestamp ? data.timestamp.toDate() : new Date();
            
            // Filter by Date
            if (dateFilter) {
                let yyyy = jsDate.getFullYear();
                let mm = String(jsDate.getMonth() + 1).padStart(2, '0');
                let dd = String(jsDate.getDate()).padStart(2, '0');
                if (`${yyyy}-${mm}-${dd}` !== dateFilter) return;
            }

            let amount = parseFloat(data.amount) || 0;
            
            // 🔥 NEW: Add to our running totals!
            totalExp += amount;
            countExp++;

            let dateStr = jsDate.toLocaleString('en-PH');
            html += `
                <tr>
                    <td>${dateStr}</td>
                    <td><span class="badge badge-open">${data.branch || 'Unknown'}</span></td>
                    <td><strong>${data.cashier || 'System'}</strong></td>
                    <td>${data.description || data.note || data.category || 'Expense'}</td>
                    <td style="text-align: right; color: #dc2626; font-weight: bold;">₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center">No expenses found for this date.</td></tr>';
        
        // 🔥 NEW: Update the Dashboard Cards!
        if(document.getElementById('expSumTotal')) document.getElementById('expSumTotal').innerText = `₱${totalExp.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if(document.getElementById('expSumCount')) document.getElementById('expSumCount').innerText = countExp;

    } catch (error) {
        console.error("Expense Log Error:", error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:red;">Error loading logs.</td></tr>';
    }
};

// ==========================================
// RECEIPT BUILDER ENGINE
// ==========================================

// --- ✂️ SMART LOGO UPLOADER (WITH AUTO-CROP) ---
window.processLogoUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // 1. Draw original image to a hidden canvas to scan its pixels
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0);

            // 2. Scan every pixel to find where the actual logo is (ignore transparent space)
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imageData.data;
            let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0;
            let isTransparent = true;

            for (let y = 0; y < tempCanvas.height; y++) {
                for (let x = 0; x < tempCanvas.width; x++) {
                    const alpha = data[(y * tempCanvas.width + x) * 4 + 3]; // Get transparency
                    if (alpha > 10) { // If pixel is visible
                        isTransparent = false;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            // 3. Add a tiny 10px breathing room around the logo
            if (!isTransparent) {
                let pad = 10;
                minX = Math.max(0, minX - pad);
                minY = Math.max(0, minY - pad);
                maxX = Math.min(img.width, maxX + pad);
                maxY = Math.min(img.height, maxY + pad);
            } else {
                minX = 0; minY = 0; maxX = img.width; maxY = img.height;
            }

            const cropWidth = maxX - minX;
            const cropHeight = maxY - minY;

            // 4. Shrink the CROPPED image to perfectly fit the 384px Thermal Printer width
            const maxWidth = 384;
            const scaleSize = cropWidth > maxWidth ? maxWidth / cropWidth : 1;
            
            const finalCanvas = document.createElement("canvas");
            finalCanvas.width = cropWidth * scaleSize;
            finalCanvas.height = cropHeight * scaleSize;
            const finalCtx = finalCanvas.getContext("2d");
            
            // Paint the solid white background
            finalCtx.fillStyle = "white";
            finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
            
            // Draw ONLY the chopped, zoomed-in logo
            finalCtx.drawImage(
                tempCanvas, 
                minX, minY, cropWidth, cropHeight, 
                0, 0, finalCanvas.width, finalCanvas.height 
            );

            // 🔥 NEW: TRUE BLACK & WHITE CONVERTER FOR THERMAL PRINTERS 🔥
            const imgData = finalCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
            const pixels = imgData.data;
            for (let i = 0; i < pixels.length; i += 4) {
                let r = pixels[i];
                let g = pixels[i + 1];
                let b = pixels[i + 2];
                
                // Calculate brightness of the pixel
                let brightness = (r * 0.299 + g * 0.587 + b * 0.114);
                
                // Threshold: If it's darker than 140, make it pure black. Otherwise, pure white.
                let color = brightness > 140 ? 255 : 0;
                
                pixels[i] = color;       // Red
                pixels[i + 1] = color;   // Green
                pixels[i + 2] = color;   // Blue
                // pixels[i + 3] is Alpha, we leave it alone (it's already solid from the white background)
            }
            finalCtx.putImageData(imgData, 0, 0);

            // 5. Save and Display
            const tinyBase64 = finalCanvas.toDataURL('image/jpeg', 0.8);
            document.getElementById('logoBase64Val').value = tinyBase64;
            
            const preview = document.getElementById('logoPreview');
            preview.src = tinyBase64;
            preview.style.display = 'inline-block';
            preview.style.width = "100%"; 
            preview.style.objectFit = "contain";
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// 1. Live Typing Preview
window.updateReceiptPreview = function() {
    document.getElementById('prevName').innerText = document.getElementById('rcptName').value || 'TAKODEÁL';
    document.getElementById('prevAddress').innerText = document.getElementById('rcptAddress').value || '';
    document.getElementById('prevContact').innerText = document.getElementById('rcptContact').value || '';
    document.getElementById('prevFooter').innerText = document.getElementById('rcptFooter').value || '';
}

// 2. Save to Cloud
window.saveReceiptSettings = async function() {
    // 🔥 THE FIX: Safely check if the address box exists before reading it!
    let addressBox = document.getElementById('rcptAddress');
    
    const rSettings = {
        logoBase64: document.getElementById('logoBase64Val').value || '',
        storeName: document.getElementById('rcptName').value || '',
        address: addressBox ? addressBox.value : '', // No crash here anymore!
        contact: document.getElementById('rcptContact').value || '',
        footerMessage: document.getElementById('rcptFooter').value || '',
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

// ==========================================
// ⏱️ LIVE ATTENDANCE & SMART LATE DETECTOR
// ==========================================
window.loadAttendanceLogs = async function () {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">Fetching logs & checking schedules...</td></tr>';

    try {
        // 🔥 FIX 1: Removed ALL "window." prefixes from Firebase commands!
        const q = query(collection(db, "attendance_logs"), orderBy("timestamp", "desc"), limit(30));
        const snap = await getDocs(q);

        let scheduleData = null;
        try {
            const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
            if (schedSnap.exists()) scheduleData = schedSnap.data();
        } catch(e) { console.warn("No schedule data found."); }

        let staffProfiles = {};
        const staffSnap = await getDocs(collection(db, "cashiers"));
        staffSnap.forEach(docSnap => {
            let d = docSnap.data();
            staffProfiles[d.cashierName] = d.scheduleNickname || d.cashierName; 
        });

        const parseTimeStr = (timeStr) => {
            let t = timeStr.toLowerCase().replace(/\s/g, '');
            let isPM = t.includes('pm');
            let isNN = t.includes('nn');
            
            let timePart = t.replace(/(am|pm|nn)/, '');
            let parts = timePart.split(':');
            let hour = parseInt(parts[0]) || 0;
            let minute = parts.length > 1 ? parseInt(parts[1]) : 0;
            
            if ((isPM || isNN) && hour < 12) hour += 12;
            if (t.includes('am') && hour === 12) hour = 0;
            
            return hour + (minute / 60);
        };

        let html = '';
        snap.forEach(docSnap => {
            let data = docSnap.data();
            let timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Just now';
            let badgeColor = data.type === "TIME IN" ? "#dcfce7" : "#fee2e2";
            let textColor = data.type === "TIME IN" ? "#16a34a" : "#b91c1c";
            let logDate = data.timestamp ? data.timestamp.toDate() : new Date();
            
            let lateTag = '';

            if (data.type === "TIME IN" && scheduleData && scheduleData.currentSchedule) {
                let logDay = logDate.getDate();
                let logMonth = logDate.getMonth() + 1;
                let logYear = logDate.getFullYear();

                if (scheduleData.currentYear === logYear && scheduleData.currentMonth === logMonth) {
                    let branchSched = scheduleData.currentSchedule[logDay] ? scheduleData.currentSchedule[logDay][data.branch] : null;
                    
                    if (branchSched && branchSched.scheduled) {
                        let nickname = staffProfiles[data.staffName] || data.staffName;
                        let assignedShiftId = Object.keys(branchSched.scheduled).find(key => branchSched.scheduled[key] === nickname);
                        
                        if (assignedShiftId && scheduleData.branchConfig[data.branch]) {
                            let shiftConfig = scheduleData.branchConfig[data.branch].find(s => s.id === assignedShiftId);
                            
                            if (shiftConfig) {
                                let match = shiftConfig.name.match(/\((.*?)-/);
                                if (match && match[1]) {
                                    let expectedStartHour = parseTimeStr(match[1]); 
                                    
                                    if (expectedStartHour !== null) {
                                        let actualHour = logDate.getHours() + (logDate.getMinutes() / 60);
                                        let diffHours = actualHour - expectedStartHour;
                                        let lateMinutes = Math.floor(diffHours * 60);
                                        
                                        if (lateMinutes > 5) {
                                            lateTag = `<br><span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; display: inline-block; margin-top: 4px; box-shadow: 0 0 5px rgba(239, 68, 68, 0.5);">⏰ LATE (${lateMinutes} mins)</span>`;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let locationText = `📍 ${data.branch}`;
            if (data.locationLat && data.locationLat !== "Unknown") {
                locationText += `<br><a href="https://www.google.com/maps/search/?api=1&query=${data.locationLat},${data.locationLng}" target="_blank" style="font-size: 10px; color: #3b82f6; text-decoration: none;">🗺️ View on Map</a>`;
            }

            // 🔥 NEW: Beautiful side-by-side Action Buttons!
            let actionHtml = `
                <div style="display: flex; gap: 5px; justify-content: center;">
                    <button onclick="window.viewSelfie('${data.photoBase64}', '${data.staffName} - ${data.type}')" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="View Selfie">📷</button>
                    <button onclick="window.deleteAttendanceLog('${docSnap.id}', '${data.staffName}')" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="Delete Log">🗑️</button>
                </div>
            `;
            
            if (data.isManual) {
                locationText = `📍 ${data.branch} <br><span style="color:#d97706; font-size:11px; font-weight:bold;">⚠️ Manual Edit: ${data.remarks}</span>`;
                actionHtml = `
                <div style="display: flex; gap: 5px; justify-content: center; align-items: center;">
                    <span style="font-size: 10px; color: #64748b; font-weight: bold; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px dashed #cbd5e1;">Manual</span>
                    <button onclick="window.deleteAttendanceLog('${docSnap.id}', '${data.staffName}')" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="Delete Log">🗑️</button>
                </div>
                `;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; font-size: 13px; color: #64748b;">${timeStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #334155; vertical-align: middle;">${data.staffName} ${lateTag}</td>
                    <td style="padding: 12px; color: #64748b; vertical-align: middle;">${locationText}</td>
                    <td style="padding: 12px; vertical-align: middle;">
                        <span style="background: ${badgeColor}; color: ${textColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${data.type}</span>
                    </td>
                    <td style="padding: 12px; text-align: center; vertical-align: middle;">
                        ${actionHtml}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No logs found.</td></tr>';
    } catch (error) {
        console.error("Error loading attendance:", error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error processing feed. Check Console.</td></tr>';
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
        window.renderConfigUI(); window.updateStaffDisplay(); window.updateAvailDropdown(); window.updateUnavailabilityList(); window.renderTables();
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
        window.renderTables();
    }
    window.saveToCloud();
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
    window.updateStaffDisplay(); window.updateAvailDropdown(); window.renderTables(); window.saveToCloud();
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
    window.updateStaffDisplay(); window.updateAvailDropdown(); window.updateUnavailabilityList(); window.renderTables(); window.saveToCloud();
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
    window.updateUnavailabilityList();
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
            window.renderTables();
        }
    }
    window.saveToCloud();
};

window.removeUnavailable = function(date, emp) {
    if (!confirm(`Remove ${emp} leave?`)) return;
    delete unavailability[date][emp];
    if (Object.keys(unavailability[date]).length === 0) delete unavailability[date];
    window.updateUnavailabilityList();
    if (currentSchedule[1]) {
        const [y, m, d] = date.split('-').map(Number);
        if (y === currentYear && m === currentMonth) {
            for (const branch in currentSchedule[d]) {
                let bData = currentSchedule[d][branch];
                bData.unavailable = bData.unavailable.filter(u => u.name !== emp);
                const eObj = employees.find(e => e.name === emp);
                if (eObj && eObj.branch === branch && !bData.rest.includes(emp)) bData.rest.push(emp);
            }
            window.renderTables();
        }
    }
    window.saveToCloud();
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
    window.renderTables(); window.saveToCloud();
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
    window.closeModal(); window.renderTables(); window.saveToCloud();
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
        btn.onclick = () => window.switchTab(branch); tabBox.appendChild(btn);

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

// ==========================================
// 🧬 RECIPE CLONER ENGINE & INVENTORY TOOLS
// ==========================================

window.deleteInventoryItem = async function(docId, itemName) {
    // Make sure we have the right ID!
    if (!docId || docId === 'undefined') { alert("❌ Error: Invalid Item ID."); return; }
    if (confirm(`⚠️ Are you sure you want to completely delete "${itemName}"? This cannot be undone!`)) {
        try {
            await deleteDoc(doc(db, "inventory", docId)); 
            alert(`✅ "${itemName}" has been permanently deleted.`);
            window.loadInventoryData();
        } catch (error) {
            console.error("Error deleting item:", error);
            alert("❌ Failed to delete the ingredient. Check console.");
        }
    }
};

window.loadCloneDropdown = async function() {
    console.log("🟢 STEP 1: Dropdown function triggered!");
    
    // Find BOTH dropdowns on the screen
    let recipeDrop = document.getElementById('recipeCloneSelect');
    let addonDrop = document.getElementById('addonCloneSelect');

    // Only give up if BOTH are missing
    if (!recipeDrop && !addonDrop) {
        console.warn("🔴 STEP 2: No dropdown HTML elements found on screen!");
        return;
    }
    
    console.log("🟢 STEP 2: Found dropdown element(s) in the HTML!");

    try {
        console.log("🟢 STEP 3: Contacting Firebase...");
        const snap = await getDocs(collection(db, "menu"));
        console.log(`🟢 STEP 4: Firebase returned ${snap.size} items!`);
        
        // Setup the default top choices for BOTH
        let recipeOptions = '<option value="">-- Select an existing product to copy... --</option>';
        let addonOptions = '<option value="">-- Copy Add-ons From... --</option>';

        let items = [];
        snap.forEach(docSnap => {
            let data = docSnap.data();
            if (data.name) {
                items.push({ id: docSnap.id, name: data.name });
            }
        });

        // Sort them alphabetically so they are easy to find
        items.sort((a, b) => a.name.localeCompare(b.name));

        // Build the HTML list
        items.forEach(item => {
            let optionHtml = `<option value="${item.id}">${item.name}</option>`;
            recipeOptions += optionHtml;
            addonOptions += optionHtml;
        });

        // Inject the HTML ONLY into the dropdowns that actually exist on the screen!
        if (recipeDrop) recipeDrop.innerHTML = recipeOptions;
        if (addonDrop) addonDrop.innerHTML = addonOptions;

        console.log(`🟢 STEP 5: Successfully shoved ${items.length} options into the dropdowns!`);

    } catch (error) {
        console.error("🔴 FATAL ERROR loading cloning dropdowns:", error);
    }
};

window.cloneRecipe = async function() {
    const selectDropdown = document.getElementById('recipeCloneSelect');
    const sourceId = selectDropdown.value;
    
    // We need the ACTUAL NAME of the product, because the "bom" collection links by name!
    const sourceName = selectDropdown.options[selectDropdown.selectedIndex].text;

    if (!sourceId) {
        alert("Please select a product to copy from first!");
        return;
    }

    if (!confirm("Are you sure? This will overwrite your currently listed ingredients!")) {
        return;
    }

    try {
        console.log(`🟢 Searching BOM vault for: ${sourceName}`);
        
        // 1. Knock on the correct door (the "bom" collection)!
        const bomQ = query(collection(db, "bom"), where("menuItem", "==", sourceName));
        const bomSnap = await getDocs(bomQ);

        if (!bomSnap.empty) {
            // 2. Clear out the old ingredients on the screen
            window.currentAdvRecipe = [];

            // 3. Find the name of the NEW product we are pasting into
            const targetProductName = document.getElementById('advProdName').value; 

            // 4. Loop through the copied ingredients
            bomSnap.forEach(docSnap => {
                let data = docSnap.data();
                
                // CRITICAL: We change the "menuItem" label on the ingredient 
                // so it belongs to the NEW product instead of the old one!
                let clonedIngredient = {
                    ...data,
                    menuItem: targetProductName 
                };
                
                // Shove it into the live memory array
                window.currentAdvRecipe.push(clonedIngredient);
            });

            console.log(`🟢 Successfully copied ${window.currentAdvRecipe.length} ingredients!`);
            
            // 5. Tell the big modal to redraw the table with the new items!
            if (typeof window.renderAdvRecipeTable === "function") {
                window.renderAdvRecipeTable();
            }

            // 🧮 Nudge the calculator to update the Profitability boxes!
            if (typeof window.calcAdvProfit === "function") {
                window.calcAdvProfit(); 
            }
          
            alert(`✅ Recipe successfully cloned! Don't forget to click "Save Changes" at the bottom!`);

        } else {
            alert(`⚠️ "${sourceName}" doesn't have any ingredients saved in the BOM yet!`);
        }
    } catch (error) {
        console.error("🔴 Error cloning recipe:", error);
        alert("Failed to clone recipe.");
    }
};

window.filterAlertsTable = function() {
    const input = document.getElementById('alertSearchInput');
    const filter = input.value.toLowerCase();
    const table = document.querySelector('table'); // Targets your alerts table
    const tr = table.getElementsByTagName('tr');

    // Loop through all table rows (starting at index 1 to skip the header)
    for (let i = 1; i < tr.length; i++) {
        const categoryCell = tr[i].getElementsByTagName('td')[1]; // Category Column
        const nameCell = tr[i].getElementsByTagName('td')[2];     // Item Name Column
        
        if (nameCell || categoryCell) {
            const nameText = nameCell.textContent || nameCell.innerText;
            const catText = categoryCell.textContent || categoryCell.innerText;
            
            // If the search text matches the name OR the category, show it!
            if (nameText.toLowerCase().indexOf(filter) > -1 || catText.toLowerCase().indexOf(filter) > -1) {
                tr[i].style.display = "";
            } else {
                tr[i].style.display = "none";
            }
        }
    }
};

// ========================================================
// 📥 UNIVERSAL EXCEL / CSV EXPORTER
// ========================================================
window.downloadExcel = function(tbodyId, fileName) {
    let tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    
    // Find the actual table that wraps around this body
    let table = tbody.closest('table');
    let rows = table.querySelectorAll('tr');
    let csv = [];

    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll('td, th');
        
        // Loop through columns, but skip the "Action" column so buttons don't go into Excel!
        let colCount = cols.length;
        if (tbodyId === 'zReadingTableBody' && i > 0) colCount -= 1; 

        for (let j = 0; j < colCount; j++) {
            // Clean up the text so Excel reads it perfectly
            let text = cols[j].innerText.replace(/"/g, '""'); 
            row.push('"' + text + '"');
        }
        csv.push(row.join(","));
    }

    // Create the downloadable file
    let csvFile = new Blob([csv.join("\n")], {type: "text/csv"});
    let tempLink = document.createElement("a");
    let d = new Date();
    let dateTag = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    
    tempLink.download = `${fileName}_${dateTag}.csv`;
    tempLink.href = window.URL.createObjectURL(csvFile);
    tempLink.style.display = "none";
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
};

// ==========================================
// 🗑️ MASTER DELETE FUNCTIONS (ATTENDANCE & BOM)
// ==========================================
window.deleteAttendanceLog = async function(docId, staffName) {
    if(!confirm(`⚠️ Are you sure you want to permanently delete this time punch for ${staffName}?`)) return;
    try {
        await deleteDoc(doc(db, "attendance_logs", docId));
        window.loadAttendanceLogs(); // Refresh the table instantly!
    } catch(e) { console.error(e); alert("Failed to delete log."); }
};

window.deleteMenuAndBom = async function(docId, name) {
    if (!confirm(`⚠️ Are you absolutely sure you want to delete "${name}"?\n\nThis will remove it from the POS and delete its Recipe/BOM forever.`)) return;
    
    try {
        // 1. Delete the Menu Item
        await deleteDoc(doc(db, "menu", docId));
        
        // 2. Find and delete all Recipe items attached to it
        const bomQ = query(collection(db, "bom"), where("menuItem", "==", name));
        const bomSnap = await getDocs(bomQ);
        for (let b of bomSnap.docs) { 
            await deleteDoc(doc(db, "bom", b.id)); 
        }

        alert(`✅ "${name}" has been completely deleted.`);
        
        // 3. Smart Refresh: Reload whichever tab you are currently looking at!
        if (document.getElementById('view-menu') && document.getElementById('view-menu').classList.contains('active')) window.loadMenuEditor();
        if (document.getElementById('view-products') && document.getElementById('view-products').classList.contains('active')) window.loadMenuCosting();
        
    } catch(e) { 
        console.error("Delete Error:", e); 
        alert("❌ Failed to delete item."); 
    }
};

// Modals safety catch
window.closeTimeClock = function() {
    let modal = document.getElementById('timeClockModal');
    if (modal) modal.style.display = 'none';
};
window.submitAttendance = function(type) {
    alert("This module is logged via the Cashier POS app.");
};
window.submitReasonLetter = function() {
    alert("Reason letters are submitted from the Cashier POS app.");
};

console.log("HEARTBEAT 2: File finished reading!");

// ==========================================
// 📥 STAFF REQUEST INBOX ENGINE
// ==========================================

// Global listener to update the sidebar badge in real-time
onSnapshot(query(collection(db, "staff_requests"), where("status", "==", "Pending")), (snapshot) => {
    let badge = document.getElementById('inboxBadge');
    if (badge) {
        if (!snapshot.empty) {
            badge.innerText = snapshot.size;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
});

window.loadInbox = async function() {
    const pendingBody = document.getElementById('inboxTableBody');
    const resolvedBody = document.getElementById('resolvedRequestsBody');
    if (!pendingBody) return;

    pendingBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading requests...</td></tr>';

    try {
        const q = query(collection(db, "staff_requests"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);

        let pendingHtml = '';
        let resolvedHtml = '';
        let pendingCount = 0;

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Unknown';
            let safeName = d.staffName ? d.staffName.replace(/'/g, "\\'") : 'Unknown';

            // 🧠 THE UPGRADE: Smart details extractor!
            let detailsStr = "";
            if (d.type === "Leave") {
                detailsStr = `<strong style="color: #1e293b;">${d.leaveType || 'Leave'}</strong><br><span style="font-size:11px; font-weight:bold; color:var(--primary);">${d.startDate || '?'} to ${d.endDate || '?'}</span><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.reason || 'No reason provided'}"</span>`;
            } else if (d.type === "Cash Advance") {
                detailsStr = `<strong style="color:var(--danger); font-size:15px;">₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</strong><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.reason || 'No reason provided'}"</span>`;
            } else if (d.type === "Staff Meal") {
                detailsStr = `<strong style="color: #1e293b;">${d.item || 'Food Item'}</strong><br><span style="color:var(--danger); font-size:11px; font-weight:bold;">Deduct: ₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>`;
            } else if (d.type === "Reason Letter") {
                detailsStr = `<strong style="color: #1e293b;">Cause: ${d.explanationCause || 'Variance'}</strong><br><span style="font-size:11px; color:#64748b; font-style:italic;">"${d.explanationMessage || 'No explanation provided'}"</span>`;
            } else {
                detailsStr = d.amount ? `₱${d.amount.toLocaleString(undefined, {minimumFractionDigits:2})}` : (d.item || d.reason || 'N/A');
            }

            if (d.status === "Pending") {
                pendingCount++;
                // 🔥 PERFECTLY ALIGNED COLUMNS FOR PENDING
                pendingHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 12px; color: #64748b;">${dateStr}</td>
                        <td style="padding: 12px; font-weight: bold; color: #334155;">${safeName}</td>
                        <td style="padding: 12px;"><span class="badge badge-closed">${d.branch || 'Unknown'}</span></td>
                        <td style="padding: 12px;">
                            <span style="font-weight: bold; color: var(--primary); font-size: 14px;">${d.type}</span><br>
                            <span style="background: #fef9c3; color: #ca8a04; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-top: 4px; display: inline-block;">Pending Review</span>
                        </td>
                        <td style="padding: 12px; max-width: 250px; white-space: normal;">${detailsStr}</td>
                        <td style="padding: 12px;">
                            <button onclick="window.handleRequest('${docSnap.id}', 'Approved', '${d.type}', ${d.amount || 0}, '${safeName}')" style="background: #16a34a; color: white; padding: 6px 12px; border:none; border-radius:4px; margin-right:5px; margin-bottom:5px; cursor:pointer; font-weight:bold; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);">Approve</button>
                            <button onclick="window.handleRequest('${docSnap.id}', 'Rejected', '${d.type}', ${d.amount || 0}, '${safeName}')" style="background: #ef4444; color: white; padding: 6px 12px; border:none; border-radius:4px; cursor:pointer; font-weight:bold; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);">Reject</button>
                        </td>
                    </tr>
                `;
            } else {
                let statusColor = d.status === "Approved" ? "#16a34a" : "#dc2626";
                let statusBg = d.status === "Approved" ? "#dcfce7" : "#fef2f2";
                
                // 🔥 PERFECTLY ALIGNED COLUMNS FOR HISTORY
                resolvedHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 12px; color: #64748b;">${dateStr}</td>
                        <td style="padding: 12px;"><strong>${safeName}</strong><br><span style="font-size:11px; color:#64748b;">${d.branch || 'Unknown'}</span></td>
                        <td style="padding: 12px;"><span style="font-weight: bold; color: var(--primary);">${d.type}</span></td>
                        <td style="padding: 12px; max-width: 250px; white-space: normal;">${detailsStr}</td>
                        <td style="padding: 12px;"><span style="background: ${statusBg}; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${d.status}</span></td>
                    </tr>
                `;
            }
        });

        pendingBody.innerHTML = pendingHtml || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #16a34a; font-weight: bold;">No pending requests! 🎉</td></tr>';
        if (resolvedBody) resolvedBody.innerHTML = resolvedHtml || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #64748b;">No resolved history yet.</td></tr>';

        // Update the Notification Badge on the Sidebar!
        let badge = document.getElementById('inboxBadge');
        if (badge) {
            badge.innerText = pendingCount;
            badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }

    } catch(e) {
        console.error("Inbox Error:", e);
        pendingBody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:red; padding: 20px;">Error loading inbox. Check console.</td></tr>';
    }
};

window.handleRequest = function(docId, action, type, amount, staffName) {
    // 1. Build a beautiful popup modal dynamically (No HTML edits required!)
    const modalHtml = `
        <div id="dynamicReplyModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 9999;">
            <div style="background: white; padding: 25px; border-radius: 12px; width: 400px; max-width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #0f172a;">${action === 'Approved' ? '✅ Approve' : '❌ Reject'} Request</h3>
                <p style="font-size: 13px; color: #64748b; margin-bottom: 15px;">Send a message to <strong>${staffName}</strong> regarding this ${type}.</p>

                <label style="font-size: 12px; font-weight: bold; color: #334155;">Manager Reply / Reason:</label>
                <textarea id="replyMessage" placeholder="Type your explanation or instructions here..." style="width: 100%; height: 80px; padding: 10px; margin-top: 5px; margin-bottom: 15px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-family: inherit; resize: none;"></textarea>

                ${action === 'Approved' ? `
                <label style="font-size: 12px; font-weight: bold; color: #334155;">Proof of Payment (Screenshot):</label>
                <input type="file" id="replyProofImage" accept="image/jpeg, image/png, image/webp" style="width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 20px; border: 1px dashed #cbd5e1; border-radius: 6px; box-sizing: border-box;">
                ` : ''}

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                    <button onclick="document.getElementById('dynamicReplyModal').remove()" style="padding: 8px 15px; border: none; background: #e2e8f0; color: #475569; border-radius: 6px; cursor: pointer; font-weight: bold;">Cancel</button>
                    <button id="btnSubmitReply" onclick="window.submitRequestReply('${docId}', '${action}', '${type}', ${amount}, '${staffName}')" style="padding: 8px 15px; border: none; background: ${action === 'Approved' ? '#10b981' : '#ef4444'}; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">Confirm ${action}</button>
                </div>
            </div>
        </div>
    `;

    // 2. Inject the modal directly into the screen
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.submitRequestReply = async function(docId, action, type, amount, staffName) {
    const btn = document.getElementById('btnSubmitReply');
    const replyMsg = document.getElementById('replyMessage').value.trim();
    const fileInput = document.getElementById('replyProofImage');

    btn.innerText = "⏳ Processing...";
    btn.disabled = true;

    try {
        let proofUrl = "";

        // 3. If approved and you attached an image, upload it to Firebase Storage!
        if (action === 'Approved' && fileInput && fileInput.files.length > 0) {
            btn.innerText = "⏳ Uploading Proof...";
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `proofs/${docId}_${Date.now()}.${fileExt}`;
            
            const storageReference = ref(window.storage, fileName);
            const snapshot = await uploadBytes(storageReference, file);
            proofUrl = await getDownloadURL(snapshot.ref);
        }

        btn.innerText = "⏳ Saving to Database...";

        // 4. Update the request status and attach your reply/image
        await updateDoc(doc(db, "staff_requests", docId), {
            status: action,
            managerReply: replyMsg,
            proofImageUrl: proofUrl,
            processedAt: new Date(),
            processedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager"
        });

        // 5. Keep your existing Payroll Deduction Logic perfectly intact!
        if (action === "Approved" && (type === "Cash Advance" || type === "Staff Meal")) {
            await addDoc(collection(db, "staff_deductions"), {
                staffName: staffName,
                type: type,
                amount: amount,
                dateAdded: new Date(),
                status: "Unpaid" 
            });
        }

        alert(`✅ Request successfully ${action.toLowerCase()}!`);
        document.getElementById('dynamicReplyModal').remove();
        window.loadInbox();

    } catch (e) {
        console.error("Action Error:", e);
        alert("❌ Failed to process request. Check connection.");
        btn.innerText = `Confirm ${action}`;
        btn.disabled = false;
    }
};

// ==========================================
// 💸 AUTO-PAYSLIP GENERATOR ENGINE
// ==========================================

// Run this when the page loads to automatically set the Cutoff Dates
window.setDefaultCutoffDates = function() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    
    let startDate = `${yyyy}-${mm}-03`;
    let endDate = `${yyyy}-${mm}-17`;
    
    if (today.getDate() > 17) {
        startDate = `${yyyy}-${mm}-18`;
        let nextMonth = new Date(yyyy, today.getMonth() + 1, 2);
        endDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-02`;
    }

    // 🔥 FIX 1: Strict safety checks so it never crashes if the HTML is slow to load!
    const startEl = document.getElementById('payrollStart');
    const endEl = document.getElementById('payrollEnd');
    if (startEl) startEl.value = startDate;
    if (endEl) endEl.value = endDate;
};

// Safe trigger that waits for the HTML to finish loading!
document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.setDefaultCutoffDates === 'function') {
        try { 
            window.setDefaultCutoffDates(); 
        } catch(e) { 
            console.warn("Date setter skipped: UI not ready."); 
        }
    }
});

// ==========================================
// 💸 AUTO-PAYSLIP GENERATOR ENGINE (WITH AUTO-DEDUCT LOGIC)
// ==========================================

window.loadPayrollGenerator = async function() {
    const tbody = document.getElementById('payrollGeneratorBody');
    if (!tbody) return;

    let startDateRaw = document.getElementById('payrollStart').value;
    let endDateRaw = document.getElementById('payrollEnd').value;
    if (!startDateRaw || !endDateRaw) { alert("Please set both cutoff dates."); return; }

    tbody.innerHTML = '<tr><td colspan="5" class="text-center">⏳ Crunching payroll numbers & ledgers...</td></tr>';

    const startTimestamp = new Date(startDateRaw + 'T00:00:00');
    const endTimestamp = new Date(endDateRaw + 'T23:59:59');

    try {
        // 1. Fetch Staff Profiles & Ledger Balances
        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        
        let staffDict = {};
        staffSnap.forEach(docSnap => { staffDict[docSnap.data().cashierName] = docSnap.data(); });
        
        let ledgerDict = {};
        ledgerSnap.forEach(docSnap => { ledgerDict[docSnap.data().staffName] = { id: docSnap.id, ...docSnap.data() }; });

        // 2. Fetch Shifts & 1-Time Deductions
        const shiftQ = query(collection(db, "shifts"), where("startTime", ">=", startTimestamp), where("startTime", "<=", endTimestamp));
        const shiftSnap = await getDocs(shiftQ);
        
        const deductQ = query(collection(db, "staff_deductions"), where("status", "==", "Unpaid"));
        const deductSnap = await getDocs(deductQ);

        let payrollData = {};

        // Aggregate Hours
        shiftSnap.forEach(docSnap => {
            let shift = docSnap.data();
            if (!shift.endTime) return; 
            let name = shift.cashier;
            if (!payrollData[name]) payrollData[name] = { branch: shift.branch, hours: 0, deductions: 0, advances: 0, meals: 0 };

            let diffMs = shift.endTime.toDate() - shift.startTime.toDate();
            let hrs = diffMs / (1000 * 60 * 60);
            payrollData[name].hours += hrs;
        });

        // Aggregate Vales & Meals
        deductSnap.forEach(docSnap => {
            let deduct = docSnap.data();
            let name = deduct.staffName;
            if (!payrollData[name]) return; 
            let amt = parseFloat(deduct.amount) || 0;
            if (deduct.type === "Cash Advance") payrollData[name].advances += amt;
            else if (deduct.type === "Staff Meal") payrollData[name].meals += amt;
            payrollData[name].deductions += amt;
        });

        // Build Table & Apply Auto-Deductions!
        let html = '';
        for (let name in payrollData) {
            let data = payrollData[name];
            let rate = staffDict[name] ? (staffDict[name].hourlyRate || 0) : 0;
            
            // 🧠 The Auto-Deduct Math
            let loanData = ledgerDict[name];
            let autoLoanDeduction = 0;
            let ledgerId = null;

            if (loanData) {
                let currentBalance = loanData.totalLoaned - loanData.totalPaid;
                if (currentBalance > 0) {
                    let setRate = loanData.cutoffDeduction || 0;
                    // Ensure we don't deduct more than what they actually owe!
                    autoLoanDeduction = Math.min(setRate, currentBalance);
                    ledgerId = loanData.id;
                }
            }

            data.loans = autoLoanDeduction;
            data.ledgerId = ledgerId;
            data.deductions += autoLoanDeduction; // Add to total display

            let encodedData = encodeURIComponent(JSON.stringify({
                name: name, branch: data.branch, hours: data.hours,
                advances: data.advances, meals: data.meals, loans: data.loans,
                ledgerId: data.ledgerId, rate: rate, profile: staffDict[name] || {},
                start: startDateRaw, end: endDateRaw
            }));

            html += `
                <tr>
                    <td><strong>👤 ${name}</strong></td>
                    <td><span class="badge badge-closed">${data.branch}</span></td>
                    <td><strong style="color: var(--primary);">${data.hours.toFixed(2)} hrs</strong></td>
                    <td style="color: var(--danger); font-weight: bold;">₱${data.deductions.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td>
                        <button class="btn-refresh" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="window.openPayslipModal('${encodedData}')">🧾 Generate Payslip</button>
                    </td>
                </tr>
            `;
        }

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: var(--success); font-weight: bold;">No shifts found for this cutoff period.</td></tr>';

    } catch (e) {
        console.error("Payroll Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error generating payroll.</td></tr>';
    }
};

window.openPayslipModal = async function(staffName) {
    let data = window.globalPayrollCache[staffName];
    if (!data) return;
    
    window.currentPayslipData = data; 
    
    if (!data.rate || data.rate === 0) {
        alert(`⚠️ Warning: ${data.name} does not have a Daily Rate set in their profile!`);
    }

    try {
        const logoSnap = await getDoc(doc(db, "settings", "global_receipt"));
        if (logoSnap.exists() && logoSnap.data().logoBase64) {
            document.getElementById('psLogoImg').src = logoSnap.data().logoBase64;
            document.getElementById('psLogoImg').style.display = 'block';
            document.getElementById('psLogoText').style.display = 'none';
        }
    } catch(e) { console.warn("No logo found in settings."); }

    document.getElementById('psName').innerText = data.name;
    document.getElementById('psBranch').innerText = data.branch;
    document.getElementById('psStart').innerText = data.start;
    document.getElementById('psEnd').innerText = data.end;
    document.getElementById('psDist').innerText = new Date().toISOString().split('T')[0];
    document.getElementById('psHired').innerText = data.profile.dateHired || '---';
    document.getElementById('psDays').innerText = `${data.shiftsWorked || 0} days @ ₱${data.rate || 0}/day`;
    
    document.getElementById('psBasicPay').innerText = (data.basicPay || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
    
    // 🧠 USING .VALUE INJECTS IT DIRECTLY INTO THE EDITABLE BOXES
    document.getElementById('psLate').value = (data.lateDeduction || 0).toFixed(2);
    document.getElementById('psOvertime').value = (data.nightBonus || 0).toFixed(2);
    document.getElementById('psAdvance').value = (data.advances || 0).toFixed(2);
    document.getElementById('psFoods').value = (data.meals || 0).toFixed(2);
    document.getElementById('psLoans').value = (data.loans || 0).toFixed(2);
    document.getElementById('psSSS').value = (data.sss || 0).toFixed(2);
    document.getElementById('psPhil').value = (data.philhealth || 0).toFixed(2);
    document.getElementById('psPagibig').value = (data.pagibig || 0).toFixed(2);

    document.getElementById('psHoliday').value = "0.00";
    document.getElementById('psWifi').value = "0.00";

    let logsHtml = '';
    if (data.logs && data.logs.length > 0) {
        data.logs.forEach(l => {
            logsHtml += `<tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 6px 4px;">${l.date}</td>
                <td style="padding: 6px 4px;">${l.in}</td>
                <td style="padding: 6px 4px;">${l.out}</td>
                <td style="padding: 6px 4px; font-weight: bold;">${l.hrs} hrs</td>
                <td style="padding: 6px 4px; font-size: 10px;">${l.remark}</td>
            </tr>`;
        });
    } else {
        logsHtml = `<tr><td colspan="5" style="padding: 15px; color: #94a3b8; text-align:center;">No exact time logs found.</td></tr>`;
    }
    document.getElementById('psAttendanceBody').innerHTML = logsHtml;

    window.recalcPayslip();
    document.getElementById('payslipModal').style.display = 'flex';
};

// 🧮 LIVE MATH CALCULATOR FOR PAYSLIPS
window.recalcPayslip = function() {
    let basic = parseFloat(document.getElementById('psBasicPay').innerText.replace(/,/g, '')) || 0;
    let ot = parseFloat(document.getElementById('psOvertime').value) || 0;
    let holiday = parseFloat(document.getElementById('psHoliday').value) || 0;
    
    let gross = basic + ot + holiday;
    document.getElementById('psGross').innerText = gross.toLocaleString(undefined, {minimumFractionDigits: 2});

    let late = parseFloat(document.getElementById('psLate').value) || 0;
    let sss = parseFloat(document.getElementById('psSSS').value) || 0;
    let phil = parseFloat(document.getElementById('psPhil').value) || 0;
    let pagibig = parseFloat(document.getElementById('psPagibig').value) || 0;
    let adv = parseFloat(document.getElementById('psAdvance').value) || 0;
    let loans = parseFloat(document.getElementById('psLoans').value) || 0;
    let foods = parseFloat(document.getElementById('psFoods').value) || 0;
    let wifi = parseFloat(document.getElementById('psWifi').value) || 0;

    let totalDed = late + sss + phil + pagibig + adv + loans + foods + wifi;
    document.getElementById('psTotalDeduct').innerText = totalDed.toLocaleString(undefined, {minimumFractionDigits: 2});

    let net = gross - totalDed;
    document.getElementById('psNetPay').innerText = net.toLocaleString(undefined, {minimumFractionDigits: 2});
};

window.finalizePayslip = async function() {
    let data = window.currentPayslipData;
    if (!data) return;
    
    let confirmMsg = `Are you sure you want to mark ${data.name}'s payslip as PAID?\n\n`;
    if (data.loans > 0) {
        confirmMsg += `This will AUTOMATICALLY deduct ₱${data.loans} from their Ledger Balance!\n\n`;
    }
    confirmMsg += `⚠️ Only click this ONCE per cutoff when you physically hand them the cash!`;

    if (!confirm(confirmMsg)) return;
    
    let btn = document.getElementById('btnFinalizePayslip');
    btn.innerText = "⏳ Processing..."; btn.disabled = true;
    
    try {
        // Automatically deduct the loan in the ledger!
        if (data.loans > 0 && data.ledgerId) {
            const ledgerRef = doc(db, "staff_ledger", data.ledgerId);
            const ledgerSnap = await getDoc(ledgerRef);
            if (ledgerSnap.exists()) {
                let currentPaid = ledgerSnap.data().totalPaid || 0;
                await updateDoc(ledgerRef, { totalPaid: currentPaid + data.loans });
            }
        }
        
        alert(`✅ ${data.name}'s payslip finalized and ledger updated!`);
        document.getElementById('payslipModal').style.display = 'none';
        
        // Refresh screens so the new balances show instantly
        window.loadLedger(); 
        window.loadPayrollGenerator(); 
    } catch (e) {
        console.error(e); alert("❌ Failed to finalize payslip.");
    } finally {
        btn.innerText = "✅ Mark Paid & Auto-Deduct"; btn.disabled = false;
    }
};

window.printPayslip = function() {
    window.print(); 
};

// ==========================================
// 📘 STAFF LOANS & LEDGER ENGINE (WITH AUTO-DEDUCT)
// ==========================================

window.loadLedger = async function() {
    const tbody = document.getElementById('ledgerTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">⏳ Calculating running balances...</td></tr>';

    try {
        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        let ledgerData = {};

        ledgerSnap.forEach(doc => {
            let data = doc.data();
            ledgerData[data.staffName] = { id: doc.id, ...data };
        });

        let html = '';

        staffSnap.forEach(docSnap => {
            let staff = docSnap.data();
            let name = staff.cashierName;
            
            let record = ledgerData[name] || { totalLoaned: 0, totalPaid: 0, cutoffDeduction: 0 };
            let balance = record.totalLoaned - record.totalPaid;
            let cutoffDed = record.cutoffDeduction || 0;

            let balColor = balance > 0 ? 'var(--danger)' : 'var(--text-muted)';
            let balWeight = balance > 0 ? 'bold' : 'normal';

            html += `
                <tr>
                    <td><strong style="color: var(--primary);">👤 ${name}</strong></td>
                    <td><span class="badge badge-closed">${staff.branch}</span></td>
                    <td style="font-weight: bold; color: #0284c7;">₱${record.totalLoaned.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: bold; color: #16a34a;">₱${record.totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: ${balWeight}; color: ${balColor}; font-size: 15px;">₱${balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: bold; color: #8b5cf6;">₱${cutoffDed.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td>
                        <button class="btn-refresh" style="background: #f3e8ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 12px; border-radius: 4px; font-size: 11px; margin-right: 5px; font-weight: bold;" onclick="window.setAutoDeduct('${record.id}', '${name}', ${cutoffDed}, ${balance})">⚙️ Set Deduct</button>
                        <button style="background: #f8fafc; border: 1px solid #cbd5e1; color: #475569; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;" onclick="window.adjustStaffLoan('${staff.id}', '${staff.cashierName}', ${staff.totalLoaned || 0}, ${staff.totalPaid || 0})">✏️ Adjust</button>
                        <button class="btn-refresh" style="background: #fef3c7; color: #d97706; border: 1px solid #d97706; padding: 6px 12px; border-radius: 4px; font-size: 11px; margin-right: 5px; font-weight: bold;" onclick="window.issueLoan('${record.id}', '${name}', ${record.totalLoaned})">➕ Loan</button>
                        <button class="btn-refresh" style="background: #dcfce7; color: #15803d; border: 1px solid #15803d; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold;" onclick="window.logLoanPayment('${record.id}', '${name}', ${record.totalPaid}, ${balance})">💸 Pay</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">No staff found.</td></tr>';

    } catch (e) {
        console.error("Ledger Error:", e);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: red;">Error loading ledger.</td></tr>';
    }
};

window.setAutoDeduct = async function(docId, staffName, currentDed, balance) {
    if (balance <= 0) { alert("✅ This employee has no outstanding balance."); return; }
    
    let amtStr = prompt(`Set automatic per-cutoff deduction for ${staffName}.\nRemaining Balance: ₱${balance.toLocaleString()}\n\nEnter amount to deduct every payslip (₱):`, currentDed);
    if (amtStr === null) return;
    
    let amt = parseFloat(amtStr) || 0;
    if (amt < 0) return;
    if (amt > balance) { 
        alert(`⚠️ Warning: You set the deduction higher than their balance. We will cap it at ₱${balance.toLocaleString()}.`); 
        amt = balance; 
    }
    
    try {
        if (docId && docId !== 'undefined') {
            await updateDoc(doc(db, "staff_ledger", docId), { cutoffDeduction: amt });
            alert(`✅ ${staffName} will now be automatically deducted ₱${amt.toLocaleString()} every cutoff.`);
            window.loadLedger();
        } else {
            alert("❌ You must issue a loan first before setting a deduction rate.");
        }
    } catch (e) { alert("Error setting auto-deduct."); console.error(e); }
};

window.issueLoan = async function(docId, staffName, currentLoaned) {
    let amount = parseFloat(prompt(`How much are you loaning to ${staffName}? (₱)`));
    if (isNaN(amount) || amount <= 0) return;

    try {
        let newTotal = currentLoaned + amount;
        if (docId && docId !== 'undefined') {
            await updateDoc(doc(db, "staff_ledger", docId), { totalLoaned: newTotal });
        } else {
            await addDoc(collection(db, "staff_ledger"), {
                staffName: staffName,
                totalLoaned: amount,
                totalPaid: 0,
                cutoffDeduction: 0 // Initialize default
            });
        }
        alert(`✅ Success! ₱${amount.toLocaleString()} added to ${staffName}'s loan balance.`);
        window.loadLedger();
    } catch (e) { console.error(e); alert("Failed to issue loan."); }
};

window.logLoanPayment = async function(docId, staffName, currentPaid, currentBalance) {
    if (currentBalance <= 0) { alert("✅ This employee has no outstanding balance."); return; }
    let amount = parseFloat(prompt(`${staffName} currently owes ₱${currentBalance.toLocaleString()}.\n\nHow much did they pay back this cutoff? (₱)`));
    if (isNaN(amount) || amount <= 0) return;
    if (amount > currentBalance) { alert(`❌ They only owe ₱${currentBalance}. You cannot log a payment higher than the balance.`); return; }

    try {
        await updateDoc(doc(db, "staff_ledger", docId), { totalPaid: currentPaid + amount });
        alert(`✅ Payment of ₱${amount.toLocaleString()} successfully logged for ${staffName}!`);
        window.loadLedger();
    } catch (e) { console.error(e); alert("Failed to log payment."); }
};

// ==========================================
// 🧹 PRE-LAUNCH FACTORY RESET ENGINE
// ==========================================
window.resetAllInventoryToZero = async function() {
    if(!confirm("⚠️ WARNING: This will set ALL inventory items to exactly 0 stock! Are you 100% sure?")) return;
    
    console.log("Starting inventory reset...");
    let count = 0;
    try {
        const snap = await getDocs(collection(db, "inventory"));
        
        for (let document of snap.docs) {
            await updateDoc(doc(db, "inventory", document.id), {
                currentStock: 0
            });
            count++;
            console.log(`Resetting item ${count} of ${snap.size}...`);
        }
        alert(`✅ Grand Wipe Complete! ${count} items have been reset to 0 stock.`);
        window.loadInventoryData(); // Refresh the table
    } catch(e) {
        console.error(e);
        alert("❌ Error resetting inventory.");
    }
};

// Bridge for the Branch Dropdown
window.refreshInventoryView = function() {
    // Whenever the dropdown changes, just reload the main inventory table!
    if (typeof window.loadInventoryData === 'function') {
        window.loadInventoryData();
    } else {
        console.warn("loadInventoryData is missing!");
    }
};

// ==========================================
// ✏️ STAFF LOAN MASTER OVERRIDE ENGINE
// ==========================================
window.adjustStaffLoan = async function(staffId, staffName, currentLoan, currentPaid) {
    // 1. Ask the boss for the corrected numbers
    let newLoan = prompt(`[ADJUSTMENT] Enter the corrected TOTAL LOANED for ${staffName}:`, currentLoan);
    if (newLoan === null) return; // Cancelled

    let newPaid = prompt(`[ADJUSTMENT] Enter the corrected TOTAL PAID for ${staffName}:`, currentPaid);
    if (newPaid === null) return; // Cancelled

    // Convert them to safe numbers
    newLoan = parseFloat(newLoan) || 0;
    newPaid = parseFloat(newPaid) || 0;
    let newBalance = newLoan - newPaid;

    // 2. Final Confirmation Screen
    if (!confirm(`🚨 Confirm manual override for ${staffName}?\n\nTotal Loaned: ₱${newLoan.toFixed(2)}\nTotal Paid: ₱${newPaid.toFixed(2)}\nNew Remaining Balance: ₱${newBalance.toFixed(2)}`)) {
        return;
    }

    try {
        // 3. Update the exact staff document in Firebase (forces the new numbers)
        // Note: Change "cashiers" to "employees" or "staff" if your database collection is named differently
        await updateDoc(doc(db, "cashiers", staffId), {
            totalLoaned: newLoan,
            totalPaid: newPaid
        });

        // 4. Create an audit log so you remember you made this adjustment
        await addDoc(collection(db, "manager_alerts"), {
            type: "LOAN_ADJUSTMENT",
            branch: "Main Office",
            message: `Manual ledger override for ${staffName}. New Balance forced to ₱${newBalance.toFixed(2)}.`,
            timestamp: window.serverTimestamp(),
            isRead: true // Marks it read so it doesn't annoy you with notifications
        });

        alert("✅ Ledger successfully adjusted!");
        
        // 5. Instantly refresh the table! 
        // (Change this to whatever your table refresh function is called, e.g., loadStaffLedger())
        if (typeof window.refreshLedger === 'function') {
             window.refreshLedger();
        } else {
             location.reload(); 
        }

    } catch (error) {
        console.error("Error adjusting loan:", error);
        alert("❌ Failed to adjust database. Check F12 Console.");
    }
};

// ==========================================
// 🟢 GRAB PERFORMANCE & LOAN RECONCILIATION ENGINE
// ==========================================
window.calculateGrabFinancials = async function() {
    let grabCommissionPercent = 0.20; 
    let grabDailyDeductionAmount = 0; 
    let currentLoanBalance = 0;

    try {
        const grabSettingsDoc = await getDoc(doc(db, "settings", "grab_financials"));
        if (grabSettingsDoc.exists()) {
            let data = grabSettingsDoc.data();
            grabCommissionPercent = data.commissionRate !== undefined ? data.commissionRate : 0.20;
            grabDailyDeductionAmount = data.dailyLoanDeduction || 0; 
            currentLoanBalance = data.remainingLoanBalance || 0;
        }
    } catch (e) { console.warn("Could not load Grab settings", e); }

    if(document.getElementById('grabRemainingLoan')) document.getElementById('grabRemainingLoan').innerText = `₱${currentLoanBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    try {
        let startDateInput = document.getElementById('dashStartDate').value;
        let endDateInput = document.getElementById('dashEndDate').value;
        
        if (!startDateInput || !endDateInput) {
            let todayStr = new Date().toISOString().split('T')[0];
            startDateInput = todayStr; endDateInput = todayStr;
        }

        let startOfDay = new Date(startDateInput + 'T00:00:00');
        let endOfDay = new Date(endDateInput + 'T23:59:59');
        let daysDiff = Math.max(1, Math.ceil((endOfDay - startOfDay) / (1000 * 60 * 60 * 24)));

        // 1. Fetch Sales
        const q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        const snap = await getDocs(q);
        
        let branchData = {}; 
        let totalGrabGross = 0;

        snap.forEach(docSnap => {
            let tx = docSnap.data();
            if (tx.status !== 'Voided' && tx.paymentMethod === 'Grab') {
                let branch = tx.branch || "Unknown";
                let amount = tx.netTotal || 0;
                if(!branchData[branch]) branchData[branch] = 0;
                branchData[branch] += amount;
                totalGrabGross += amount;
            }
        });

        // 2. Fetch Actual Payouts Logged by Cashier
        const payoutQ = query(collection(db, "grab_payouts"), where("dateStr", ">=", startDateInput), where("dateStr", "<=", endDateInput));
        const payoutSnap = await getDocs(payoutQ);
        
        let actualGrabPayout = 0;
        let payoutLogsHtml = '';
        
        if (payoutSnap.empty) {
            payoutLogsHtml = '<div style="color:#94a3b8; font-size:12px; font-style:italic;">No manual Grab earnings logged by cashiers yet.</div>';
        } else {
            payoutSnap.forEach(docSnap => {
                let p = docSnap.data();
                actualGrabPayout += (p.amount || 0);
                payoutLogsHtml += `<div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px dashed #e2e8f0; padding:4px 0; color:#334155;"><span>📅 ${p.dateStr} (${p.branch})</span><span style="font-weight:bold; color:#00b14f;">₱${p.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>`;
            });
        }

        // 3. Build UI
        let breakdownHtml = `
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="border-bottom: 2px solid #e2e8f0; color: #64748b; text-align: left;">
                        <th style="padding: 8px 0;">Branch</th>
                        <th style="padding: 8px 0; text-align: right;">System Gross</th>
                        <th style="padding: 8px 0; text-align: right;">Comm (-${(grabCommissionPercent*100).toFixed(0)}%)</th>
                        <th style="padding: 8px 0; text-align: right; color: #00b14f;">Expected Net</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (Object.keys(branchData).length === 0) {
            breakdownHtml += `<tr><td colspan="4" style="padding: 10px 0; text-align: center; color: #94a3b8;">No Grab sales found.</td></tr>`;
        } else {
            for (let branch in branchData) {
                let gross = branchData[branch];
                let comm = gross * grabCommissionPercent;
                let net = gross - comm;
                breakdownHtml += `
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 8px 0; font-weight: 600; color: #334155;">${branch}</td>
                        <td style="padding: 8px 0; text-align: right;">₱${gross.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style="padding: 8px 0; text-align: right; color: #ef4444;">-₱${comm.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #00b14f;">₱${net.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    </tr>
                `;
            }
        }
        breakdownHtml += `</tbody></table>`;
        
        if(document.getElementById('grabBranchBreakdown')) document.getElementById('grabBranchBreakdown').innerHTML = breakdownHtml;

        // 4. Calculate Final Variances
        let globalCommission = totalGrabGross * grabCommissionPercent;
        let globalLoanCut = totalGrabGross > 0 ? (grabDailyDeductionAmount * daysDiff) : 0; 
        let finalExpectedPayout = totalGrabGross - globalCommission - globalLoanCut;
        
        let variance = actualGrabPayout - finalExpectedPayout;
        let varianceColor = variance < 0 ? '#dc2626' : (variance > 0 ? '#10b981' : '#475569');
        let varianceText = variance === 0 ? "Perfect Match" : `₱${variance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        // Inject data into the cards
        if (document.getElementById('grabTotalGross')) document.getElementById('grabTotalGross').innerText = `₱${totalGrabGross.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (document.getElementById('grabTotalLoanCut')) document.getElementById('grabTotalLoanCut').innerText = `- ₱${globalLoanCut.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        
        let netPayoutEl = document.getElementById('grabTotalNetPayout');
        if (netPayoutEl) {
            // We rewrite this entire bottom section to include the Reconciliation UI
            netPayoutEl.parentElement.innerHTML = `
                <div style="display: flex; flex-direction: column; width: 100%;">
                    <div style="display: flex; justify-content: space-between; padding-top: 8px; margin-bottom: 10px;">
                        <span style="font-weight: bold; color: #0f172a; font-size: 14px;">Calculated Expected Payout:</span>
                        <span style="font-weight: bold; color: #00b14f; font-size: 15px;">₱${finalExpectedPayout.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                    
                    <div style="background: #f1f5f9; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
                        <div style="font-size: 11px; font-weight: bold; color: #475569; margin-bottom: 5px;">ACTUAL PAYOUTS LOGGED BY CASHIER:</div>
                        ${payoutLogsHtml}
                        <div style="display: flex; justify-content: space-between; margin-top: 5px; padding-top: 5px; border-top: 1px solid #cbd5e1;">
                            <span style="font-weight: bold; font-size: 13px; color: #0f172a;">Total Actual Remittance:</span>
                            <span style="font-weight: bold; font-size: 14px; color: #0f172a;">₱${actualGrabPayout.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; background: ${variance < 0 ? '#fef2f2' : (variance > 0 ? '#f0fdf4' : '#f8fafc')}; padding: 10px; border-radius: 6px; border: 1px solid ${variance < 0 ? '#fecaca' : (variance > 0 ? '#bbf7d0' : '#e2e8f0')};">
                        <span style="font-weight: bold; color: ${varianceColor}; font-size: 15px;">RECONCILIATION VARIANCE:</span>
                        <span style="font-weight: 900; color: ${varianceColor}; font-size: 16px;">${varianceText}</span>
                    </div>
                </div>
            `;
        }

    } catch (error) {
        console.error("Error calculating Grab financials:", error);
    }
};

// ==========================================
// ⚙️ GRAB LOAN SETTINGS EDITOR
// ==========================================
window.editGrabLoanSettings = async function() {
    let newLoanAmount = prompt("Enter your current remaining GRAB LOAN BALANCE (₱):");
    if (newLoanAmount === null) return; 
    
    // CHANGED TO FLAT AMOUNT
    let newDeductionAmount = prompt("Enter the FIXED DAILY LOAN DEDUCTION AMOUNT (₱):", "500");
    if (newDeductionAmount === null) return; 

    let newCommissionRate = prompt("Enter Grab's STANDARD COMMISSION PERCENTAGE (e.g., 20 for 20%):", "20");
    if (newCommissionRate === null) return; 

    let loanNum = parseFloat(newLoanAmount) || 0;
    let dedAmountNum = parseFloat(newDeductionAmount) || 0; // Flat number
    let commRateNum = (parseFloat(newCommissionRate) || 0) / 100;

    try {
        await setDoc(doc(db, "settings", "grab_financials"), {
            remainingLoanBalance: loanNum,
            dailyLoanDeduction: dedAmountNum, // Saving the flat amount
            commissionRate: commRateNum,
            lastUpdated: window.serverTimestamp()
        }, { merge: true }); 

        alert(`✅ Grab Settings Successfully Updated!\n\nRemaining Loan: ₱${loanNum.toFixed(2)}\nFixed Daily Deduction: ₱${dedAmountNum.toFixed(2)}\nGrab Commission: ${commRateNum*100}%`);
        
        window.calculateGrabFinancials();

    } catch (error) {
        console.error("Error saving Grab settings:", error);
        alert("❌ Failed to save settings. Please ensure setDoc is initialized in your main.js.");
    }
};

window.globalPayrollCache = {};

// ==========================================
// 💸 AUTO-PAYSLIP GENERATOR ENGINE (WITH AUTO-DEDUCT LOGIC)
// ==========================================

// 2. The Master Pairing Engine
window.generateAutoPayslips = async function() {
    let startInput = document.getElementById('payrollStart').value;
    let endInput = document.getElementById('payrollEnd').value;
    let tableBody = document.getElementById('payrollGeneratorBody'); 

    if (!tableBody) {
        alert("Error: Cannot find the table. Make sure your tbody has the ID 'payrollGeneratorBody'.");
        return;
    }

    if (!startInput || !endInput) {
        alert("Please select both Cutoff Start and End dates.");
        return;
    }

    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; font-weight:bold; color: #d97706;">⚙️ Crunching Payroll Data & Ledgers...</td></tr>`;

    let startDate = new Date(startInput); startDate.setHours(0, 0, 0, 0);
    let endDate = new Date(endInput); endDate.setHours(23, 59, 59, 999);

    try {
        // 🔥 FIX 2: Removed "window." from the Firebase commands for the Manager App!
        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        
        let staffDict = {};
        staffSnap.forEach(docSnap => { staffDict[docSnap.data().cashierName] = docSnap.data(); });
        
        let ledgerDict = {};
        ledgerSnap.forEach(docSnap => { ledgerDict[docSnap.data().staffName] = { id: docSnap.id, ...docSnap.data() }; });

        // Removed "window." from query, collection, where, and orderBy
        const attQ = query(collection(db, "attendance_logs"), 
            where("timestamp", ">=", startDate), where("timestamp", "<=", endDate), orderBy("timestamp", "asc")
        );
        const attSnap = await getDocs(attQ);

        const reqQ = query(collection(db, "staff_requests"), 
            where("timestamp", ">=", startDate), where("timestamp", "<=", endDate)
        );
        const reqSnap = await getDocs(reqQ);

        let staffData = {}; 
        let activeShifts = {}; 

        // --- PART A: CALCULATE SHIFTS, HOURS & LOGS ---
        attSnap.forEach(docSnap => {
            let log = docSnap.data();
            let name = log.staffName;
            
            if (!staffData[name]) {
                staffData[name] = { 
                    branch: log.branch, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, 
                    foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0,
                    logs: [] // Array to hold their exact time punches
                };
            }

            if (log.type === "TIME IN") {
                activeShifts[name] = log.timestamp.toDate();
            } else if (log.type === "TIME OUT" && activeShifts[name]) {
                let timeIn = activeShifts[name];
                let timeOut = log.timestamp.toDate();
                let hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                
                // 🧠 AUTO-REMARKS ENGINE (UPDATED: Late/Short Only, No Overtime)
                let remark = `<span style="color:#10b981; font-weight:bold;">Complete</span>`;
                
                // Only flag if they worked LESS than 8 hours
                if (hoursWorked < 8) {
                    let missingHours = (8 - hoursWorked).toFixed(1);
                    remark = `<span style="color:#ef4444; font-weight:bold;">Late / Short (${missingHours}h)</span>`;
                }

                // ⏱️ Save the exact log for the payslip summary
                staffData[name].logs.push({
                    date: timeIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
                    in: timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                    out: timeOut.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                    hrs: hoursWorked.toFixed(2),
                    remark: remark
                });

                staffData[name].totalHours += hoursWorked;
                staffData[name].shiftsWorked += 1; 

                let outHour = timeOut.getHours();
                if (outHour >= 0 && outHour <= 3) {
                    staffData[name].nightShifts += 1;
                    staffData[name].nightBonusTotal += 50; 
                }
                delete activeShifts[name];
            }
        });

        // --- PART B: CALCULATE APPROVED DEDUCTIONS ---
        reqSnap.forEach(docSnap => {
            let req = docSnap.data();
            let name = req.staffName;

            if (req.status === "Approved") {
                if (!staffData[name]) staffData[name] = { branch: req.branch || "Unknown", totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, logs: [] };

                if (req.type === "Staff Meal") staffData[name].foodDeductions += (req.amount || 0);
                else if (req.type === "Cash Advance") staffData[name].cashAdvances += (req.amount || 0);
            }
        });

        // --- PART C: APPLY LEDGER AUTO-DEDUCTS & GOV BENEFITS ---
        let html = '';
        if (Object.keys(staffData).length === 0) {
            html = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #64748b;">No shifts or deductions found for this cutoff.</td></tr>`;
        } else {
            for (let name in staffData) {
                let d = staffData[name];
                let profile = staffDict[name] || {};
                let dailyRate = profile.hourlyRate || 0; 
                
                d.basicPay = d.shiftsWorked * dailyRate;

                // 🧠 AUTO-LATE / UNDERTIME MATH
                let expectedHours = d.shiftsWorked * 8;
                let hourlyEquivalent = dailyRate / 8;
                let lateDeduction = 0;
                
                if (d.totalHours < expectedHours) {
                    let missedHours = expectedHours - d.totalHours;
                    lateDeduction = missedHours * hourlyEquivalent;
                }
                d.lateDeduction = lateDeduction;

                let loanData = ledgerDict[name];
                let autoLoanDeduction = 0;
                if (loanData) {
                    let currentBalance = (loanData.totalLoaned || 0) - (loanData.totalPaid || 0);
                    if (currentBalance > 0) {
                        let setRate = loanData.cutoffDeduction || 0;
                        autoLoanDeduction = Math.min(setRate, currentBalance); 
                        d.ledgerId = loanData.id;
                    }
                }
                d.loans = autoLoanDeduction;
                d.sss = profile.sssDeduction || 0;
                d.pagibig = profile.pagibigDeduction || 0;
                d.philhealth = profile.philhealthDeduction || 0;

                let totalDeduct = d.foodDeductions + d.cashAdvances + d.loans + d.sss + d.pagibig + d.philhealth + d.lateDeduction;

                let bonusLabel = d.nightBonusTotal > 0 ? `<br><span style="font-size:11px; color:#f59e0b; font-weight:bold;">+₱${d.nightBonusTotal} Night Bonus</span>` : '';
                let foodLabel = d.foodDeductions > 0 ? `<br><span style="font-size:11px; color:#ef4444;">-₱${d.foodDeductions.toFixed(2)} (Meals)</span>` : '';
                let valeLabel = d.cashAdvances > 0 ? `<br><span style="font-size:11px; color:#ef4444;">-₱${d.cashAdvances.toFixed(2)} (Vale)</span>` : '';
                let loanLabel = d.loans > 0 ? `<br><span style="font-size:11px; color:#ef4444; font-weight:bold;">-₱${d.loans.toFixed(2)} (Ledger Auto-Deduct)</span>` : '';
                let lateLabel = d.lateDeduction > 0 ? `<br><span style="font-size:11px; color:#ef4444; font-weight:bold;">-₱${d.lateDeduction.toFixed(2)} (Auto-Late)</span>` : '';
                let govTotal = d.sss + d.pagibig + d.philhealth;
                let govLabel = govTotal > 0 ? `<br><span style="font-size:11px; color:#64748b;">-₱${govTotal.toFixed(2)} (Gov Benefits)</span>` : `<br><span style="font-size:10px; color:#64748b;">Gov Benefits: Not Set</span>`;

                // 💾 SAVE TO GLOBAL MEMORY
                window.globalPayrollCache[name] = {
                    name: name, branch: d.branch, hours: d.totalHours, nightBonus: d.nightBonusTotal,
                    advances: d.cashAdvances, meals: d.foodDeductions, loans: d.loans, ledgerId: d.ledgerId,
                    sss: d.sss, pagibig: d.pagibig, philhealth: d.philhealth, lateDeduction: d.lateDeduction,
                    shiftsWorked: d.shiftsWorked, basicPay: d.basicPay, rate: dailyRate,
                    start: startInput, end: endInput, profile: profile, logs: d.logs
                };

                html += `
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 12px; font-weight: bold; color: #1e293b;">${name}</td>
                        <td style="padding: 12px; color: #64748b;">${d.branch}</td>
                        <td style="padding: 12px; font-weight: bold;">${d.totalHours.toFixed(2)} hrs ${bonusLabel}</td>
                        <td style="padding: 12px; font-weight: bold;">
                            Total: ₱${totalDeduct.toFixed(2)}
                            ${foodLabel} ${valeLabel} ${loanLabel} ${lateLabel} ${govLabel}
                        </td>
                        <td style="padding: 12px;">
                            <button onclick="window.openPayslipModal('${name}')" style="background:#047857; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size: 12px; font-weight: bold;">
                                Generate PDF Payslip
                            </button>
                        </td>
                    </tr>
                `;
            }
        }
        tableBody.innerHTML = html;

    } catch (error) {
        console.error("Payroll Engine Error:", error);
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red; padding: 20px;">Failed to calculate payroll. Check Developer Console (F12).</td></tr>`;
    }
};

// Run the date setter when the dashboard loads!
window.setDefaultCutoffDates();

window.autoFill7DaySupply = function() {
    if (!window.latestSupplyChainData || window.latestSupplyChainData.length === 0) {
        alert("⚠️ Please click 'Calculate' first to run the AI engine for a branch."); 
        return;
    }

    // Ensure the manager has selected the destination branch
    let toBranch = document.getElementById('dispTo').value;
    let aiTargetBranch = document.getElementById('burnRateBranch').value;
    
    if (toBranch !== aiTargetBranch) {
        alert(`⚠️ Mismatch: The AI just calculated for ${aiTargetBranch}, but your Dispatch Destination is set to ${toBranch || "Nothing"}. Please match them up!`);
        return;
    }

    let itemsAdded = 0;
    let missingFromHQ = [];

    window.latestSupplyChainData.forEach(need => {
        // Only pack items that are actually burning down
        if (need.suggestedRestock > 0 && need.currentStock <= need.suggestedRestock) {
            
            // 1. Find the item in the Main Office Warehouse
            let hqItem = dispatchInventoryList.find(i => i.name === need.itemName);
            
            if (hqItem && hqItem.currentStock > 0) {
                // 2. Only send what the branch needs (or whatever HQ has left)
                let amountToSend = Math.min(need.suggestedRestock, hqItem.currentStock);
                
                // 3. Check if it's already in the cart, if so, update it
                let existing = dispatchCart.find(i => i.itemName === need.itemName);
                if (existing) {
                    existing.qty = amountToSend; 
                    existing.displayMsg = `${amountToSend} ${hqItem.uom} (AI Auto-Fill)`;
                } else {
                    dispatchCart.push({
                        itemName: hqItem.name,
                        qty: amountToSend,
                        uom: hqItem.uom,
                        sourceId: hqItem.id,
                        displayMsg: `${amountToSend} ${hqItem.uom} (AI Auto-Fill)`
                    });
                }
                itemsAdded++;
            } else {
                missingFromHQ.push(need.itemName);
            }
        }
    });
    
    renderDispatchCart();
    
    if (missingFromHQ.length > 0) {
        alert(`✅ Auto-filled ${itemsAdded} items.\n\n⚠️ Warning: The following required items are OUT OF STOCK at the Main Office and were skipped: ${missingFromHQ.join(", ")}`);
    } else {
        alert(`✅ Cart loaded! ${itemsAdded} items added based on the 7-Day Burn Rate.`);
    }
};

// ========================================================
// 🏦 PHASE 6: EOD CASH FLOW & FLOATING CASH ENGINE
// ========================================================
// ========================================================
// 🏦 PHASE 6: EOD CASH FLOW & FLOATING CASH ENGINE
// ========================================================
window.loadCashFlowHub = async function() {
    try {
        let safeCash = 0;
        const accSnap = await getDocs(collection(db, "cash_accounts"));
        accSnap.forEach(doc => { safeCash += (doc.data().balance || 0); });

        let branchFloating = { "Cabantian": 0, "Citygate": 0, "Maa": 0 };
        let pendingVerifications = 0;
        let totalFloating = 0;

        const shiftSnap = await getDocs(query(collection(db, "shifts"), where("status", "==", "Closed")));
        shiftSnap.forEach(doc => {
            let data = doc.data();
            let branch = data.branch;
            if (branchFloating[branch] !== undefined) branchFloating[branch] += (data.expectedCash || 0);
        });

        const remitSnap = await getDocs(collection(db, "remittances"));
        remitSnap.forEach(doc => {
            let data = doc.data();
            let branch = data.branch;
            
            if (data.status === "Pending") {
                pendingVerifications += (data.amount || 0);
            }

            if (branchFloating[branch] !== undefined) {
                if (data.status === "Received") branchFloating[branch] -= (data.amount || 0);
            }
        });

        let branchHtml = '';
        for (let branch in branchFloating) {
            let owed = branchFloating[branch] < 0 ? 0 : branchFloating[branch];
            totalFloating += owed;
            let alertColor = owed > 5000 ? "#dc2626" : "#475569"; 
            let alertBg = owed > 5000 ? "#fef2f2" : "#f8fafc";
            let alertBorder = owed > 5000 ? "#fecaca" : "#e2e8f0";
            
            branchHtml += `
                <div style="background: ${alertBg}; border: 1px solid ${alertBorder}; border-radius: 8px; padding: 15px; text-align: center;">
                    <div style="font-weight: bold; color: #334155; margin-bottom: 5px; font-size: 14px;">📍 ${branch}</div>
                    <div style="font-size: 20px; font-weight: 900; color: ${alertColor};">₱${owed.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                    <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Unremitted Cash</div>
                </div>
            `;
        }

        document.getElementById('hubSafeCash').innerText = `₱${safeCash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('hubFloatingCash').innerText = `₱${totalFloating.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('hubPendingCash').innerText = `₱${pendingVerifications.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('branchFloatingContainer').innerHTML = branchHtml;

    } catch (e) {
        console.error("Cash Flow Hub Error:", e);
        document.getElementById('branchFloatingContainer').innerHTML = `<div style="text-align: center; color: red; grid-column: 1/-1;">Error calculating cash flow: ${e.message}</div>`;
    }
};

// ========================================================
// 🚚 PHASE 7: SUPPLIER PAYABLES & CALENDAR ENGINE
// ========================================================

window.loadPayablesDashboard = async function() {
    const tbody = document.getElementById('payablesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Scanning payables...</td></tr>';

    try {
        // We only want to see Unpaid invoices
        const q = query(collection(db, "payables"), where("status", "==", "Unpaid"), orderBy("dueDate", "asc"));
        const snap = await getDocs(q);

        let html = '';
        let totalUnpaid = 0;
        let overdueCount = 0;
        let dueSoonCount = 0;
        
        let now = new Date();
        now.setHours(0,0,0,0);

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let amount = parseFloat(data.amount) || 0;
            totalUnpaid += amount;

            let deliveryDate = data.deliveryDate ? data.deliveryDate.toDate() : new Date();
            let dueDate = data.dueDate ? data.dueDate.toDate() : new Date();
            
            // Calculate days difference
            let diffTime = dueDate.getTime() - now.getTime();
            let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let statusHtml = '';
            let dateColor = '#334155';

            if (diffDays < 0) {
                overdueCount++;
                statusHtml = `<span style="background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⚠️ OVERDUE by ${Math.abs(diffDays)} Days</span>`;
                dateColor = '#dc2626';
            } else if (diffDays === 0) {
                dueSoonCount++;
                statusHtml = `<span style="background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🚨 DUE TODAY</span>`;
                dateColor = '#d97706';
            } else if (diffDays <= 7) {
                dueSoonCount++;
                statusHtml = `<span style="background: #fef9c3; color: #ca8a04; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Due in ${diffDays} Days</span>`;
            } else {
                statusHtml = `<span style="background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">Safe (${diffDays} Days)</span>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td><strong style="color: var(--primary); font-size: 15px;">${data.supplier}</strong></td>
                    <td style="font-family: monospace; color: #64748b;">${data.invoiceNum || 'N/A'}</td>
                    <td style="font-size: 13px;">${deliveryDate.toLocaleDateString()}</td>
                    <td style="font-weight: bold; color: ${dateColor};">${dueDate.toLocaleDateString()}</td>
                    <td style="font-weight: bold; font-size: 15px; color: #1e293b;">₱${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td>${statusHtml}</td>
                    <td>
                        <button onclick="window.openSettlePayable('${docSnap.id}', '${data.supplier}', ${amount}, '${data.invoiceNum}')" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">💸 Pay Now</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="color: #64748b; padding: 30px;">All payables are cleared! No outstanding debts.</td></tr>';

        // Update Stat Cards
        document.getElementById('payTotalUnpaid').innerText = `₱${totalUnpaid.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('payTotalOverdue').innerText = overdueCount;
        document.getElementById('payDueSoon').innerText = dueSoonCount;

        // Auto-Trigger Security Alert if there are Overdue invoices!
        if (overdueCount > 0) {
            triggerPayableAlert(overdueCount);
        }

    } catch (e) {
        console.error("Payables Error:", e);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: red;">Error fetching payables.</td></tr>';
    }
};

async function triggerPayableAlert(count) {
    // Only triggers an alert if we haven't already fired one today
    const q = query(collection(db, "manager_alerts"), where("type", "==", "PAYABLE_ALERT"), orderBy("timestamp", "desc"), limit(1));
    const snap = await getDocs(q);
    
    let fireAlert = true;
    if (!snap.empty) {
        let lastAlert = snap.docs[0].data().timestamp.toDate();
        let diffHours = (new Date() - lastAlert) / (1000 * 60 * 60);
        if (diffHours < 24) fireAlert = false; // Prevents spamming every time you open the tab
    }

    if (fireAlert) {
        await addDoc(collection(db, "manager_alerts"), {
            type: "PAYABLE_ALERT",
            branch: "Main Office",
            message: `URGENT: You have ${count} supplier invoice(s) that are strictly OVERDUE. Please check the Supplier Payables tab immediately.`,
            timestamp: serverTimestamp(),
            isRead: false
        });
    }
}

// ========================================================
// 📦 SMART RECEIVE & PAYABLES ENGINE
// ========================================================

window.payableItemsCart = [];
window.payableInventoryOptions = [];

// 1. Opens the Modal & Fetches Main Office Inventory
window.openAddPayableModal = async function() {
    document.getElementById('addPayableModal').style.display = 'flex';
    document.getElementById('paySupplierName').value = '';
    document.getElementById('payInvoiceNum').value = '';
    document.getElementById('payAmount').value = '';
    window.payableItemsCart = [];
    window.renderPayableItems();

    let select = document.getElementById('payItemSelect');
    select.innerHTML = '<option value="">Loading items...</option>';

    try {
        // Fetch ONLY Main Office inventory for receiving bulk deliveries
        const q = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
        const snap = await getDocs(q);
        
        window.payableInventoryOptions = [];
        let html = '<option value="">-- Select Item Received --</option>';
        
        snap.forEach(docSnap => {
            let data = docSnap.data();
            window.payableInventoryOptions.push({ id: docSnap.id, ...data });
            html += `<option value="${docSnap.id}">${data.name} (${data.purchaseUom || data.uom})</option>`;
        });
        
        select.innerHTML = html;
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error loading items</option>';
    }
};

// 2. Adds Items to the Temporary Delivery Cart
window.addPayableItem = function() {
    let select = document.getElementById('payItemSelect');
    let itemId = select.value;
    let qty = parseFloat(document.getElementById('payItemQty').value);

    if (!itemId || isNaN(qty) || qty <= 0) return;

    let itemData = window.payableInventoryOptions.find(i => i.id === itemId);
    if (!itemData) return;

    // Automatically calculate Base Units from Purchase Units!
    let convRate = parseFloat(itemData.conversionRate) || 1;
    let baseQtyToAdd = qty * convRate;

    window.payableItemsCart.push({
        id: itemData.id,
        name: itemData.name,
        purchQty: qty,
        purchUom: itemData.purchaseUom || itemData.uom,
        baseQtyToAdd: baseQtyToAdd,
        baseUom: itemData.uom
    });

    document.getElementById('payItemQty').value = '';
    window.renderPayableItems();
};

window.removePayableItem = function(index) {
    window.payableItemsCart.splice(index, 1);
    window.renderPayableItems();
};

window.renderPayableItems = function() {
    let container = document.getElementById('payItemsList');
    if (window.payableItemsCart.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 10px; font-style: italic;">No physical items linked. This will just log the cash payable.</div>';
        return;
    }

    let html = '';
    window.payableItemsCart.forEach((item, index) => {
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 5px; border-bottom: 1px dashed #cbd5e1; background: white; border-radius: 4px; margin-bottom: 4px;">
                <span><strong style="color: #0f766e;">${item.purchQty} ${item.purchUom}</strong> ${item.name} <br><span style="font-size:10px; color:#64748b;">(Adds +${item.baseQtyToAdd} ${item.baseUom} to stock)</span></span>
                <button onclick="window.removePayableItem(${index})" style="color: #ef4444; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-weight: bold;">✖</button>
            </div>
        `;
    });
    container.innerHTML = html;
};

// 3. The Grand Double-Save (Updates Payables AND Live Inventory)
window.saveNewPayable = async function() {
    // 🔥 AUTO-CATCH FEATURE
    let pendingItem = document.getElementById('payItemSelect').value;
    let pendingQty = document.getElementById('payItemQty').value;
    if (pendingItem && pendingQty) {
        window.addPayableItem(); 
    }

    let supplier = document.getElementById('paySupplierName').value.trim();
    let invoice = document.getElementById('payInvoiceNum').value.trim();
    let amount = parseFloat(document.getElementById('payAmount').value);
    let terms = parseInt(document.getElementById('payTerms').value);

    if (!supplier || isNaN(amount) || amount <= 0) {
        alert("Please enter Supplier Name and a valid Amount.");
        return;
    }

    let btn = document.getElementById('btnSavePayable');
    btn.innerText = "⏳ Saving & Updating Inventory..."; btn.disabled = true;

    try {
        let deliveryDate = new Date();
        let dueDate = new Date();
        dueDate.setDate(deliveryDate.getDate() + terms);

        // A. Save the Financial Payable Record (CORRECTED: Removed window. prefixes from Firebase calls)
        await addDoc(collection(db, "payables"), {
            supplier: supplier,
            invoiceNum: invoice,
            amount: amount,
            termsDays: terms,
            deliveryDate: deliveryDate,
            dueDate: dueDate,
            status: "Unpaid",
            hasLinkedItems: window.payableItemsCart.length > 0,
            loggedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp()
        });

        // B. Update Live Inventory & Stock Logs if items were attached
        if (window.payableItemsCart.length > 0) {
            for (let item of window.payableItemsCart) {
                let invRef = doc(db, "inventory", item.id);
                let invData = window.payableInventoryOptions.find(i => i.id === item.id);
                let currentStock = parseFloat(invData.currentStock) || 0;
                let newStock = currentStock + item.baseQtyToAdd;

                // Update the actual stock level
                await updateDoc(invRef, { currentStock: newStock });

                // Create a beautiful audit log so you know where it came from
                await addDoc(collection(db, "stock_logs"), {
                    branch: "Main Office",
                    item: item.name,
                    uom: item.baseUom,
                    oldQty: currentStock,
                    newQty: newStock,
                    variance: item.baseQtyToAdd,
                    type: "Supplier Delivery",
                    note: `Linked to Invoice: ${invoice || 'N/A'}, Supplier: ${supplier}`,
                    user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
                    timestamp: new Date()
                });
            }
        }

        alert(`✅ Success! Invoice logged and ${window.payableItemsCart.length} inventory items added to the Main Office.`);
        document.getElementById('addPayableModal').style.display = 'none';
        window.loadPayablesDashboard();
        
        // Refresh inventory if that tab happens to be loaded
        if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
        
    } catch (e) {
        console.error("Save Payable Error:", e);
        alert(`❌ Failed to save. Error: ${e.message}`);
    } finally {
        btn.innerText = "💾 Log Delivery & Track Deadline"; btn.disabled = false;
    }
};

window.openSettlePayable = async function(id, supplier, amount, invoice) {
    document.getElementById('settlePayId').value = id;
    document.getElementById('settlePaySupplier').value = supplier;
    document.getElementById('settlePayAmountRaw').value = amount;
    
    document.getElementById('settlePayTitle').innerText = `${supplier} (Inv: ${invoice || 'N/A'})`;
    document.getElementById('settlePayAmount').innerText = `₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    let accSelect = document.getElementById('settleCashAccount');
    accSelect.innerHTML = '<option value="">Loading accounts...</option>';

    try {
        // Fetch LIVE accounts so you can pick where the money is coming from
        const accSnap = await getDocs(collection(db, "cash_accounts"));
        let html = '<option value="">-- Select Cash Account --</option>';
        window.livePayableAccounts = {}; // Memory map

        accSnap.forEach(docSnap => {
            let acc = docSnap.data();
            window.livePayableAccounts[docSnap.id] = acc;
            html += `<option value="${docSnap.id}">${acc.name} (${acc.branch}) - Bal: ₱${acc.balance.toLocaleString()}</option>`;
        });
        accSelect.innerHTML = html;
        document.getElementById('settlePayableModal').style.display = 'flex';
    } catch (e) {
        console.error("Error loading accounts:", e);
        accSelect.innerHTML = '<option value="">Error loading accounts</option>';
    }
};

window.confirmPayableSettlement = async function() {
    let payId = document.getElementById('settlePayId').value;
    let supplier = document.getElementById('settlePaySupplier').value;
    let amount = parseFloat(document.getElementById('settlePayAmountRaw').value);
    let accountId = document.getElementById('settleCashAccount').value;

    if (!accountId) { alert("Please select a Cash Account to deduct funds from."); return; }

    let accData = window.livePayableAccounts[accountId];
    if (accData.balance < amount) {
        if(!confirm(`⚠️ WARNING: ${accData.name} only has ₱${accData.balance}. Deducting this will make the account negative. Continue anyway?`)) return;
    }

    let btn = document.getElementById('btnConfirmSettle');
    btn.innerText = "⏳ Processing Payment..."; btn.disabled = true;

    try {
        // 1. Deduct from Cash Account
        await updateDoc(doc(db, "cash_accounts", accountId), {
            balance: accData.balance - amount
        });

        // 2. Mark Payable as Paid
        await updateDoc(doc(db, "payables", payId), {
            status: "Paid",
            datePaid: serverTimestamp(),
            paidFromAccount: accData.name
        });

        // 3. Log to Global Expenses (so it shows up in your Expense Feed!)
        await addDoc(collection(db, "expenses"), {
            branch: "Main Office",
            amount: amount,
            category: "Supplier Payment",
            account: accData.name,
            note: `Settled Invoice for ${supplier}`,
            timestamp: serverTimestamp()
        });

        alert(`✅ Payment complete! ₱${amount.toLocaleString()} was deducted from ${accData.name}.`);
        document.getElementById('settlePayableModal').style.display = 'none';
        
        window.loadPayablesDashboard();
        // If the user happens to have the Accounts tab loaded in the background, refresh it too
        if (typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();

    } catch (e) {
        console.error("Error settling payment:", e);
        alert("Payment failed. Check connection.");
    } finally {
        btn.innerText = "✅ Confirm Payment"; btn.disabled = false;
    }
};

window.exportTransactionsCSV = async function() {
    let startDateInput = document.getElementById('dashStartDate').value;
    let endDateInput = document.getElementById('dashEndDate').value;
    
    if (!startDateInput || !endDateInput) { 
        alert("Please select a 'From' and 'To' date on the Dashboard first."); 
        return; 
    }

    let startOfDay = new Date(startDateInput + 'T00:00:00');
    let endOfDay = new Date(endDateInput + 'T23:59:59');

    let btn = document.getElementById('btnExportSales');
    let oldText = btn.innerText;
    btn.innerText = "⏳ Exporting..."; 
    btn.disabled = true;

    try {
        const q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);

        // Standard CSV Headers for Bookkeeping
        let csv = "Receipt ID,Date,Time,Branch,Cashier,Customer,Items Ordered,Payment Method,Status,Net Total\n";

        snap.forEach(docSnap => {
            let tx = docSnap.data();
            let d = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateStr = d.toLocaleDateString('en-PH');
            let timeStr = d.toLocaleTimeString('en-PH');
            
            // Compress all items into one column
            let itemsArr = [];
            if (tx.cart) {
                tx.cart.forEach(item => {
                    itemsArr.push(`${item.qty}x ${item.name || item.itemName}`);
                });
            }
            let itemsJoined = itemsArr.join(" | ").replace(/"/g, '""'); // Escape quotes for Excel
            
            csv += `"${tx.receiptId}","${dateStr}","${timeStr}","${tx.branch}","${tx.cashier}","${tx.customerName || 'Guest'}","${itemsJoined}","${tx.paymentMethod}","${tx.status || 'Paid'}","${tx.netTotal}"\n`;
        });

        // Trigger Download
        let csvFile = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        let downloadLink = document.createElement("a");
        downloadLink.download = `Takodeal_Sales_Log_${startDateInput}_to_${endDateInput}.csv`;
        downloadLink.href = window.URL.createObjectURL(csvFile);
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

    } catch (e) {
        console.error("Export Error:", e);
        alert("Failed to export sales data.");
    } finally {
        btn.innerText = oldText; 
        btn.disabled = false;
    }
};

// ========================================================
// 📈 PRODUCT OPTIMIZATION & ANALYTICS ENGINE
// ========================================================
window.loadProductAnalytics = async function(startOfDay, endOfDay) {
    const tbody = document.getElementById('productAnalyticsBody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 20px; color: #0ea5e9; font-weight: bold;">⏳ Crunching big data & COGS...</td></tr>';

    try {
        // 1. Fetch Latest Inventory Unit Costs
        const invSnap = await getDocs(collection(db, "inventory"));
        let invCosts = {};
        invSnap.forEach(d => invCosts[d.data().name] = parseFloat(d.data().baseCost) || 0);

        // 2. Fetch Recipes to calculate Base COGS
        const bomSnap = await getDocs(collection(db, "bom"));
        let recipeCosts = {};
        bomSnap.forEach(d => {
            let bom = d.data();
            if(!recipeCosts[bom.menuItem]) recipeCosts[bom.menuItem] = 0;
            recipeCosts[bom.menuItem] += (invCosts[bom.ingredientName] || 0) * (bom.qty || 1);
        });

        // 3. Fetch Transactions within the Date Range
        const txQ = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        const txSnap = await getDocs(txQ);

        let productStats = {};

        // 4. Rip through every transaction and build the stats
        txSnap.forEach(doc => {
            let tx = doc.data();
            if(tx.status === "Voided" || !tx.cart) return; // Ignore voided items

            tx.cart.forEach(item => {
                let name = item.name || item.itemName;
                if (!name) return;
                
                let qty = item.qty || 1;
                if (!productStats[name]) productStats[name] = { qty: 0, sales: 0, cogs: 0 };

                // Tally Quantity and Sales
                productStats[name].qty += qty;
                let revenue = item.lineTotalFinal !== undefined ? item.lineTotalFinal : ((item.variantPrice || item.basePrice || 0) * qty);
                productStats[name].sales += revenue;

                // Tally Base COGS
                let baseCogs = (recipeCosts[name] || 0) * qty;

                // Tally Add-on COGS (If they added extra cheese, we must track the cost of that cheese!)
                let addonCogs = 0;
                if (item.addons) {
                    for (let key in item.addons) {
                        let addon = item.addons[key];
                        if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                            addonCogs += (invCosts[addon.linkedIngredient] || 0) * addon.deductQty * addon.qty * qty;
                        }
                    }
                }

                productStats[name].cogs += (baseCogs + addonCogs);
            });
        });

        // 5. Render the Beautiful Table
        let html = '';
        // Sort by Highest Sales first
        let sortedProducts = Object.keys(productStats).sort((a, b) => productStats[b].sales - productStats[a].sales); 

        sortedProducts.forEach(name => {
            let stats = productStats[name];
            let margin = stats.sales - stats.cogs;
            let cogsPct = stats.sales > 0 ? (stats.cogs / stats.sales) * 100 : 0;

            // 🧠 The AI Health Tagger
            let statusBadge = '';
            if (cogsPct > 55) {
                statusBadge = '<span style="background:#fef2f2; color:#b91c1c; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">🚨 Bleeder (High Cost)</span>';
            } else if (cogsPct < 35 && stats.qty >= 5) {
                statusBadge = '<span style="background:#f0fdf4; color:#15803d; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">🏆 Top Performer</span>';
            } else {
                statusBadge = '<span style="background:#f8fafc; color:#475569; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">⚖️ Average</span>';
            }

            let cogsColor = cogsPct > 50 ? '#b91c1c' : (cogsPct < 35 ? '#15803d' : '#d97706');

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="font-weight: bold; color: #0f172a; font-size: 14px;">${name}</td>
                    <td style="font-weight: 900; color: #475569;">${stats.qty}</td>
                    <td style="font-weight: bold; color: var(--primary);">₱${stats.sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="color: var(--danger); font-weight: 500;">₱${stats.cogs.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: 900; color: ${cogsColor};">${cogsPct.toFixed(1)}%</td>
                    <td style="color: #15803d; font-weight: 900; font-size: 15px;">₱${margin.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="padding: 20px; color: #64748b;">No sales data available for this period.</td></tr>';

    } catch(e) {
        console.error("Product Analytics Error:", e);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red; padding: 20px;">Error loading analytics. Check console.</td></tr>';
    }
};

// ==========================================
// 📝 MANUAL ATTENDANCE OVERRIDE ENGINE
// ==========================================
window.openManualAttendanceModal = async function() {
    document.getElementById('manualAttendanceModal').style.display = 'flex';
    let select = document.getElementById('manAttStaff');
    select.innerHTML = '<option value="">Loading Staff...</option>';
    
    // Auto-set the datetime picker to right now to save time
    let now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('manAttDateTime').value = now.toISOString().slice(0,16);
    document.getElementById('manAttRemarks').value = '';

    try {
        const snap = await getDocs(collection(db, "cashiers"));
        let html = '<option value="">-- Select Staff --</option>';
        let staffList = [];
        snap.forEach(doc => staffList.push(doc.data().cashierName));
        staffList.sort().forEach(name => {
            html += `<option value="${name}">${name}</option>`;
        });
        select.innerHTML = html;
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error loading staff</option>';
    }
};

window.submitManualAttendance = async function() {
    let staffName = document.getElementById('manAttStaff').value;
    let branch = document.getElementById('manAttBranch').value;
    let type = document.getElementById('manAttType').value;
    let dateTimeRaw = document.getElementById('manAttDateTime').value;
    let remarks = document.getElementById('manAttRemarks').value.trim();

    if (!staffName || !dateTimeRaw || !remarks) {
        alert("❌ Please fill out Staff Name, Exact Time, and Manager Remarks.");
        return;
    }

    let btn = document.getElementById('btnSaveManualAtt');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        // Convert the HTML datetime-local input into a proper Javascript Date object
        let logDate = new Date(dateTimeRaw);

        await addDoc(collection(db, "attendance_logs"), {
            staffName: staffName,
            branch: branch,
            type: type,
            timestamp: logDate, // Saves it at the exact time you selected!
            isManual: true, // Flags it so the system knows there's no GPS/Selfie
            remarks: remarks,
            loggedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager"
        });

        alert(`✅ Success! Manual ${type} for ${staffName} has been recorded.`);
        document.getElementById('manualAttendanceModal').style.display = 'none';
        window.loadAttendanceLogs(); // Refresh the feed

        // If they had the Payroll tab open, this will nudge them to refresh it
        alert("Reminder: If you are calculating payroll, click 'Generate List' again to apply this new time punch.");

    } catch (error) {
        console.error("Manual Log Error:", error);
        alert("❌ Failed to save manual log.");
    } finally {
        btn.innerText = "💾 Save Override Log"; btn.disabled = false;
    }
};
