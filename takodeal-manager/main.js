import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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

// 🔥 THE NEW ENTERPRISE OFFLINE ENGINE 🔥
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

window.storage = storage;
window.db = db;

console.log("🚀 TAKODEÁL Manager Offline Storage is ACTIVE!");

// Your secure Master Key
const MASTER_EMAIL = "jgo031996@gmail.com";

// --- HELPER: FORMAT CURRENCY (THIS WAS MISSING!) ---
window.formatMoney = (amount) => '₱' + parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = window.formatMoney;

window.applyPermissions = function() {
    if (!window.sessionUser) return;
    
    // If they are the Master Owner or have 'all' permissions, show everything!
    if (window.sessionUser.isOwner || window.sessionUser.permissions.includes('all')) {
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'block');
        return;
    }
    
    // 1. Hide ALL tabs first
    document.querySelectorAll('.nav-item').forEach(el => {
        if (el.id !== 'nav-dashboard') el.style.display = 'none';
    });
    
    // 2. Show only the tabs they were granted
    window.sessionUser.permissions.forEach(tabName => {
        let el = document.getElementById('nav-' + tabName);
        if (el) el.style.display = 'block';
    });

    // 3. STRICT LOCK: Never let non-owners see the Admin Security tab
    document.getElementById('nav-admin').style.display = 'none'; 
};

// --- PERSISTENT LOGIN LISTENER ---
auth.onAuthStateChanged(async (user) => {
  const loginScreen = document.getElementById('loginOverlay');
  if (user) {
    let isAuthorized = false;
    let userPerms = ['all'];

    try {
        if (user.email === MASTER_EMAIL) {
            isAuthorized = true;
            userPerms = ['all'];
        } else {
            // 🔥 FIX: Defined 'snap' inside the try block so it is always available
            const q = query(collection(db, "hq_managers"), where("email", "==", user.email));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                isAuthorized = true;
                userPerms = snap.docs[0].data().permissions || ['all'];
            } else {
                const checkAny = await getDocs(query(collection(db, "hq_managers"), limit(1)));
                if (checkAny.empty) {
                    await addDoc(collection(db, "hq_managers"), {
                        email: user.email, 
                        role: 'Owner', 
                        permissions: ['all']
                    });
                    isAuthorized = true;
                    userPerms = ['all'];
                }
            }
        }
    } catch (error) {
        console.error("Auth Database Error:", error);
    }

    if (isAuthorized) {
      window.sessionUser = {
        email: user.email,
        branch: 'Main Office',
        cashierName: user.displayName || 'Manager',
        isOwner: (user.email === MASTER_EMAIL || userPerms.includes('all')), 
        permissions: userPerms
      };
      
      window.applyPermissions(); // Run the tab hider!

      let brDisp = document.getElementById('displayBranch');
      if (brDisp) brDisp.innerText = "📍 " + window.sessionUser.branch;
      let caDisp = document.getElementById('displayCashier');
      if (caDisp) caDisp.innerText = "👤 " + window.sessionUser.cashierName;

      if (loginScreen) loginScreen.style.display = 'none';
      if (typeof window.switchView === 'function') window.switchView('dashboard');
      if (typeof loadGlobalDashboard === 'function') loadGlobalDashboard();
      
    } else {
      await signOut(auth);
      alert(`Access Denied.\n\n${user.email} is not authorized in the HQ Access Control list.`);
      if (loginScreen) loginScreen.style.display = 'flex';
    }
  } else {
    if (loginScreen) loginScreen.style.display = 'flex';
  }
});

window.loginWithGoogle = async function() {
  try {
    await signInWithPopup(auth, provider);
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
      let perms = data.permissions ? data.permissions.join(', ') : 'all';
      
      html += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td>
            <strong>${data.email}</strong><br>
            <span style="font-size: 11px; color: #64748b;">Access: [${perms}]</span>
          </td>
          <td><span class="badge badge-closed">Appointed Manager</span></td>
          <td style="display: flex; gap: 5px;">
            <button class="btn-refresh" style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; padding:4px 8px; font-size:11px;" onclick="window.editManagerPermissions('${docSnap.id}', '${data.email}')">⚙️ Edit Permissions</button>
            <button class="btn-refresh" style="background: #fef2f2; color:var(--danger); border: 1px solid #fecaca; padding:4px 8px; font-size:11px;" onclick="removeHqManager('${docSnap.id}', '${data.email}')">✖ Revoke</button>
          </td>
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
  const branches = window.globalActiveBranches ? window.globalActiveBranches.filter(b => b !== "Main Office") : ['Cabantian', 'Citygate', 'Maa'];
  let tableHtml = '';

  try {
    for (let branch of branches) {
      // 1. FETCH SHIFT DATA FIRST (True Shift Logic)
      const shiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("startTime", ">=", startOfDay), orderBy("startTime", "desc"), limit(1));
      const shiftSnap = await getDocs(shiftQ);

      let shiftData = !shiftSnap.empty ? shiftSnap.docs[0].data() : null;
      let isActive = shiftData && shiftData.active === true;
      let isClosed = shiftData && shiftData.status === "Closed";

      let displayCashier = shiftData ? (shiftData.cashier || '-') : '-';
      let branchGross = 0; let branchNet = 0; let branchCashIn = 0; let branchExp = 0;

      // 2. ONLY FETCH SALES IF A SHIFT EXISTS
      if (shiftData) {
          // Grab the exact millisecond the shift started
          let shiftStart = shiftData.startTime.toDate();
          // If active, calculate up to right NOW. If closed, calculate up to when they clocked out.
          let shiftEnd = isActive ? new Date() : shiftData.endTime.toDate();

          const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", shiftStart), where("timestamp", "<=", shiftEnd));
          const txSnap = await getDocs(txQ);

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

          const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", shiftStart), where("timestamp", "<=", shiftEnd));
          const expSnap = await getDocs(expQ);
          expSnap.forEach(eDoc => { branchExp += (eDoc.data().amount || 0); });
      }

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

      if (branchGross === 0 && branchExp === 0 && !shiftData) {
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
  
    // 📈 WAKE UP THE ADVANCED CHARTS!
    if (typeof window.renderDashboardCharts === 'function') {
        window.renderDashboardCharts();
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
    
    // 🔥 NEW: Set toggle to checked by default for new staff
    if (document.getElementById('empNightDiff')) document.getElementById('empNightDiff').checked = true;

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
    
    // 🔥 NEW: Load the saved toggle state (defaults to true if not set)
    if (document.getElementById('empNightDiff')) document.getElementById('empNightDiff').checked = (data.eligibleNightDiff !== false);

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
    
    // Fetch History
    const tbody = document.getElementById('empProfileHistoryBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 15px;">Loading...</td></tr>';
        getDocs(query(collection(db, "staff_deductions"), where("staffName", "==", data.cashierName), orderBy("dateAdded", "desc"), limit(30)))
        .then(snap => {
            let histHtml = '';
            snap.forEach(dDoc => {
                let d = dDoc.data();
                let dateStr = d.dateAdded ? d.dateAdded.toDate().toLocaleDateString() : '';
                let color = d.status === 'Paid' ? '#16a34a' : '#dc2626';
                histHtml += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding:8px; color: #64748b;">${dateStr}</td>
                    <td style="padding:8px; font-weight: bold; color: #334155;">${d.type}</td>
                    <td style="padding:8px; font-weight:bold;">₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding:8px; color:${color}; font-weight:bold;">${d.status}</td>
                </tr>`;
            });
            tbody.innerHTML = histHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">No deduction history.</td></tr>';
        }).catch(e => { console.error(e); tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:red;">Error loading history</td></tr>'; });
    }
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
        
        // 🔥 NEW: Save the toggle state to the cloud!
        eligibleNightDiff: document.getElementById('empNightDiff') ? document.getElementById('empNightDiff').checked : true,
        
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
// 🔐 STAFF PASSWORD RESET ENGINE
// ========================================================
window.resetStaffPin = async function (staffId, staffName) {
  // 1. Ask the manager for the new Password
  let newPin = prompt(`Enter a new Login Password for ${staffName} (Min 4 characters):`);

  // If they click Cancel or leave it blank, do nothing
  if (!newPin) return;

  // 2. Strict Security: Make sure it is at least 4 characters long (letters or numbers!)
  if (newPin.trim().length < 4) {
    alert("❌ Invalid format. The password must be at least 4 characters long.");
    return;
  }

  // 3. Send it to the Cloud Database
  try {
    await updateDoc(doc(db, "cashiers", staffId), {
      pin: newPin.trim()
    });

    alert(`✅ Security Password for ${staffName} has been successfully updated!`);

    // Refresh the table to show the update
    window.loadHRModule();
    
  } catch (error) {
    console.error("Password Reset Error:", error);
    alert("❌ Failed to update the password in the database.");
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
  if (viewId === 'addons') title = "Global Add-Ons Hub";
  if (viewId === 'alerts') title = "Security Alerts";
  if (viewId === 'inventory') title = "Live Inventory Dashboard";
  if (viewId === 'accounts') title = "Financial Control Center";
  if (viewId === 'payroll') title = "Payroll Engine & HR Logs";
  if (viewId === 'products') title = "Menu Costing & BOM";
  if (viewId === 'purchases') title = "Purchases & Alerts";
  if (viewId === 'dispatch') title = "Logistics & Dispatch";
  if (viewId === 'zreadings') title = "Z-Reading Reports";
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
  if (viewId === 'addons') window.loadGlobalAddons();
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
  if (viewId === 'posconfig') { window.loadPosConfigHub(); window.loadPosLayout(); }
  if (viewId === 'admin') { window.loadAdminDashboard(); window.loadBranchManager(); }
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
          <tr style="cursor: pointer; transition: background 0.2s;" 
              onmouseover="this.style.background='#f1f5f9'" 
              onmouseout="this.style.background='transparent'" 
              onclick="document.getElementById('nav-inventory').click(); setTimeout(() => { document.getElementById('invBranchFilter').value = '${data.branch}'; if(typeof window.loadLiveInventory === 'function') window.loadLiveInventory(); }, 300);">
            <td><strong>${data.branch}</strong></td>
            <td><span class="badge badge-closed">${data.category || '-'}</span></td>
            <td style="font-weight: bold;">${data.name}</td>
            <td style="color: var(--danger); font-weight: bold;">${stock} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${data.uom}</span></td>
            <td>${reorder} <span style="font-size:12px; color:var(--text-muted);">${data.uom}</span></td>
            <td style="color: var(--primary); font-weight: bold;">${suggested} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${data.uom}</span></td>
            <td>
                <button class="btn-refresh" style="background: white; color: var(--primary); border: 1px solid var(--primary); position: relative; z-index: 10;" 
                        onclick="event.stopPropagation(); openMultiRestockModal('${data.id}')">📦 Restock</button>
            </td>
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
window.loadAlerts = window.loadPurchasesAndAlerts;

// --- THE RESTOCK MODAL LOGIC ---
window.openMultiRestockModal = async function (preSelectId = null) {
  document.getElementById('restockModal').style.display = 'flex';
  restockCart = [];
  window.renderRestockCart();

  if (window.globalInventoryList.length === 0) {
    const snap = await getDocs(collection(db, "inventory"));
    snap.forEach(d => { let obj = d.data(); obj.id = d.id; window.globalInventoryList.push(obj); });
  }

  // 🔥 THE FIX: Transform the Dropdown into a Smart Search Bar
  let itemInput = document.getElementById('restockItemSelect');
  if (itemInput.tagName === 'SELECT') {
      let newInput = document.createElement('input');
      newInput.id = 'restockItemSelect';
      newInput.setAttribute('list', 'restockDatalist');
      newInput.placeholder = "Type to search Main Office item...";
      newInput.style.cssText = "padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; width: 100%; box-sizing: border-box; font-weight: bold; color: #0f172a;";
      newInput.onchange = window.updateRestockUomLabel;
      itemInput.parentNode.replaceChild(newInput, itemInput);
      itemInput = newInput;
  }
  itemInput.value = '';

  let hqList = window.globalInventoryList.filter(i => i.branch === "Main Office");
  let sortedList = hqList.sort((a, b) => a.name.localeCompare(b.name));

  // Build the invisible datalist for the search bar
  let datalistHtml = '<datalist id="restockDatalist">';
  sortedList.forEach(item => {
    let stockDisplay = `${parseFloat(item.currentStock || 0).toFixed(1)} ${item.uom}`;
    datalistHtml += `<option value="${item.name}">Current Stock: ${stockDisplay}</option>`;
  });
  datalistHtml += '</datalist>';

  if (!document.getElementById('restockDatalist')) {
      document.body.insertAdjacentHTML('beforeend', datalistHtml);
  } else {
      document.getElementById('restockDatalist').innerHTML = datalistHtml.replace('<datalist id="restockDatalist">', '').replace('</datalist>', '');
  }

  // If a preSelectId was passed from an alert button, auto-fill the search bar
  if (preSelectId) {
      let preItem = window.globalInventoryList.find(i => i.id === preSelectId);
      if (preItem) itemInput.value = preItem.name;
  }

  window.updateRestockUomLabel();
};

window.updateRestockUomLabel = function () {
  let itemName = document.getElementById('restockItemSelect').value.trim();
  let label = document.getElementById('restockQtyLabel');
  
  // 🔥 THE FIX: Injecting the Cost Input next to the Qty Input!
  let costContainer = document.getElementById('restockCostContainer');
  if (!costContainer) {
      let qtyInputParent = document.getElementById('restockQtyInput').parentElement;
      qtyInputParent.insertAdjacentHTML('afterend', `
        <div id="restockCostContainer" style="margin-top: 10px;">
            <label style="font-size:12px; font-weight:bold; color:#64748b;">Total Cost of Purchase (₱)</label>
            <input type="number" id="restockCostInput" class="input-box" placeholder="e.g. 1500" style="border: 2px solid #cbd5e1;">
        </div>
      `);
  }

  if (!itemName) { label.innerText = "No. of packs"; return; }

  let item = window.globalInventoryList.find(i => i.name === itemName && i.branch === "Main Office");
  if (item) {
    label.innerHTML = `No. of <span style="color:#0ea5e9;">${item.purchaseUom || 'units'}s</span> <br><span style="font-size:10px; color:#94a3b8;">(1 ${item.purchaseUom || 'unit'} = ${item.conversionRate || 1} ${item.uom})</span>`;
  }
};

window.addRestockToCart = function () {
  let itemName = document.getElementById('restockItemSelect').value.trim();
  let purchQty = parseFloat(document.getElementById('restockQtyInput').value);
  let totalCost = parseFloat(document.getElementById('restockCostInput') ? document.getElementById('restockCostInput').value : 0); 
  let supplierName = document.getElementById('restockSupplierInput') ? document.getElementById('restockSupplierInput').value.trim() : "Walk-in/Supplier";

  if (!itemName || isNaN(purchQty) || purchQty <= 0) { alert("Select an item and enter a valid quantity."); return; }

  let item = window.globalInventoryList.find(i => i.name === itemName && i.branch === "Main Office");
  if (!item) { alert("Item not found in Main Office."); return; }

  let convRate = parseFloat(item.conversionRate) || 1;
  let baseQtyToAdd = purchQty * convRate;

  let existing = restockCart.find(i => i.id === item.id);
  if (existing) {
      existing.purchQty += purchQty;
      existing.baseQtyToAdd += baseQtyToAdd;
      existing.totalCost += (totalCost || 0);
  } else {
      restockCart.push({
        id: item.id, name: item.name, branch: item.branch, purchQty: purchQty, purchUom: item.purchaseUom || 'units',
        baseQtyToAdd: baseQtyToAdd, baseUom: item.uom, totalCost: totalCost || 0, supplier: supplierName 
      });
  }

  document.getElementById('restockQtyInput').value = '';
  document.getElementById('restockItemSelect').value = ''; 
  if(document.getElementById('restockCostInput')) document.getElementById('restockCostInput').value = '';
  window.renderRestockCart();
};

window.removeRestockItem = function (index) {
  restockCart.splice(index, 1);
  window.renderRestockCart();
};

window.renderRestockCart = function () {
  let tbody = document.getElementById('restockCartBody');
  
  // 🔥 THE FIX: Inject a scrollable container around the table!
  let table = tbody.closest('table');
  if (table && !table.parentElement.classList.contains('table-scroll-wrapper')) {
      let wrapper = document.createElement('div');
      wrapper.className = 'table-scroll-wrapper';
      wrapper.style.maxHeight = '220px';
      wrapper.style.overflowY = 'auto';
      wrapper.style.borderBottom = '1px solid #e2e8f0';
      wrapper.style.marginBottom = '10px';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
  }

  if (restockCart.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:var(--text-muted); padding:15px;">Cart is empty.</td></tr>'; return; }

  let html = '';
  restockCart.forEach((cartItem, idx) => {
    html += `
      <tr>
        <td style="padding: 10px;">
          <strong style="font-size: 15px; color:#0f172a;">${cartItem.name}</strong> <span style="font-size:11px; color:var(--text-muted);">(${cartItem.branch})</span><br>
          <span style="font-size:12px; color:var(--success); font-weight:bold;">(+${cartItem.baseQtyToAdd.toLocaleString()} ${cartItem.baseUom} to stock)</span>
        </td>
        <td style="font-weight:bold; font-size: 16px; padding: 10px; color:#0f766e;">${cartItem.purchQty} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">${cartItem.purchUom}s</span></td>
        <td style="padding: 10px; text-align:right;"><button onclick="window.removeRestockItem(${idx})" style="color:var(--danger); border:1px solid var(--danger); background:#fef2f2; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">✖ Remove</button></td>
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

      // 🔥 OPTIONAL PRICING ENGINE: Only alter Base Cost if they actually paid money for this!
      if (cartItem.totalCost > 0) {
          let currentAvgCost = parseFloat(memoryItem.baseCost) || parseFloat(memoryItem.cost) || 0;
          let newTotalValue = (currentStock * currentAvgCost) + cartItem.totalCost;
          let newAverageCost = newStock > 0 ? (newTotalValue / newStock) : (cartItem.totalCost / cartItem.baseQtyToAdd);
          
          await updateDoc(itemRef, { currentStock: newStock, baseCost: newAverageCost, cost: newAverageCost, purchaseCost: (newAverageCost * (parseFloat(memoryItem.conversionRate)||1)) });
      } else {
          // They didn't type a cost, just add the stock safely!
          await updateDoc(itemRef, { currentStock: newStock });
      }

      await addDoc(collection(db, "stock_logs"), {
        branch: cartItem.branch, item: cartItem.name, uom: cartItem.baseUom, oldQty: currentStock, newQty: newStock, variance: cartItem.baseQtyToAdd,
        type: "HQ Delivery Restock", note: `Supplier/Receipt: ${cartItem.supplier || 'N/A'}${cartItem.totalCost > 0 ? ` | Cost: ₱${cartItem.totalCost}` : ''}`,
        user: window.sessionUser ? window.sessionUser.cashierName : "Manager", timestamp: new Date()
      });
    }

    alert(`✅ Successfully restocked ${restockCart.length} items!`);
    document.getElementById('restockModal').style.display = 'none';

    if (typeof window.loadPurchasesAndAlerts === 'function') window.loadPurchasesAndAlerts(); // Update Alerts tab
    if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
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

  document.getElementById('dispFrom').innerHTML = fromHtml;
  document.getElementById('dispFrom').value = "Main Office";
  document.getElementById('dispTo').innerHTML = toHtml;

  dispatchCart = [];
  window.renderDispatchCart();
  await window.loadDispatchInventory();
  await window.loadDispatchLogs();
};

window.loadDispatchInventory = async function () {
  let fromBranch = document.getElementById('dispFrom').value;
  let itemInput = document.getElementById('dispItem');

  // 🔥 Transform the old <select> into a Smart Search <input> automatically!
  if (itemInput.tagName === 'SELECT') {
      let newInput = document.createElement('input');
      newInput.id = 'dispItem';
      newInput.setAttribute('list', 'dispatchDatalist');
      newInput.placeholder = "Type to search item to send...";
      newInput.style.cssText = "width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; outline: none; box-sizing: border-box; font-size: 14px; font-weight: bold; color: #334155;";
      
      // Bind the updating functions to typing and clicking
      newInput.onchange = window.updateDispatchUomLabel;
      newInput.onkeyup = window.updateDispatchUomLabel; 
      
      itemInput.parentNode.replaceChild(newInput, itemInput);
      itemInput = newInput;
  }

  if (!fromBranch) { 
      itemInput.placeholder = 'Select source branch first...'; 
      itemInput.disabled = true; 
      itemInput.value = '';
      return; 
  }
  
  itemInput.disabled = false; 
  itemInput.placeholder = 'Scanning warehouse...'; 
  itemInput.value = '';
  dispatchInventoryList = [];

  try {
    const q = query(collection(db, "inventory"), where("branch", "==", fromBranch));
    const snap = await getDocs(q);
    
    // Build the invisible datalist for the search bar
    let datalistHtml = '<datalist id="dispatchDatalist">';
    
    let sortedStock = [];
    snap.forEach(docSnap => {
        let data = docSnap.data();
        if (data.currentStock > 0) {
            sortedStock.push({ id: docSnap.id, ...data });
        }
    });
    
    // Alphabetical sort so it's easy to browse
    sortedStock.sort((a, b) => a.name.localeCompare(b.name));

    sortedStock.forEach(data => {
        dispatchInventoryList.push(data);
        let safeStock = parseFloat(data.currentStock).toFixed(1);
        datalistHtml += `<option value="${data.name}">Available: ${safeStock} ${data.uom}</option>`;
    });
    
    datalistHtml += '</datalist>';

    // Inject the datalist into the HTML body
    let existingList = document.getElementById('dispatchDatalist');
    if (existingList) existingList.remove();
    document.body.insertAdjacentHTML('beforeend', datalistHtml);

    itemInput.placeholder = 'Type to search item...';
    window.updateDispatchUomLabel();
  } catch (e) { 
    console.error(e); 
    itemInput.placeholder = 'Error loading stock'; 
  }
};

window.updateDispatchUomLabel = function() {
    let itemName = document.getElementById('dispItem').value.trim();
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
  let itemName = document.getElementById('dispItem').value.trim();
  let rawQty = parseFloat(document.getElementById('dispQty').value);
  let uomSelect = document.getElementById('dispUomSelect');
  let selectedUomType = uomSelect.value; 

  if (!itemName || isNaN(rawQty) || rawQty <= 0) { alert("Please select an item and valid quantity."); return; }

  let invItem = dispatchInventoryList.find(i => i.name === itemName);
  if (!invItem) { alert("Item not found."); return; }

  let finalBaseQty = rawQty;
  let displayMsg = `${rawQty} ${invItem.uom}`;
  let convRate = 1;
  let friendlyUom = invItem.uom;

  if (selectedUomType === 'purch') {
      convRate = parseFloat(invItem.conversionRate) || 1;
      finalBaseQty = rawQty * convRate; 
      friendlyUom = invItem.purchaseUom || "Bulk";
      displayMsg = `${rawQty} ${friendlyUom} <span style="font-size:11px; color:var(--text-muted);">(${finalBaseQty} ${invItem.uom})</span>`;
  }

  if (finalBaseQty > invItem.currentStock) { 
      let stockInPurch = invItem.currentStock / convRate;
      alert(`❌ Not enough stock!\n\nYou are trying to send ${rawQty} ${friendlyUom} (${finalBaseQty} ${invItem.uom}), but the Main Office only has ${stockInPurch.toFixed(2)} ${friendlyUom} (${invItem.currentStock} ${invItem.uom}) available in the database.`); 
      return; 
  }

  // 🔥 THE FIX: Accumulates quantities if item already exists in the dispatch cart
  let existing = dispatchCart.find(i => i.itemName === itemName);
  if (existing) { 
      existing.qty += finalBaseQty; 
      existing.rawQty += rawQty;
      existing.displayMsg = `${existing.rawQty} ${friendlyUom} <span style="font-size:11px; color:var(--text-muted);">(${existing.qty} ${invItem.uom})</span>`;
  } else { 
      dispatchCart.push({ 
          itemName: itemName, 
          qty: finalBaseQty, 
          uom: invItem.uom, 
          sourceId: invItem.id,
          displayMsg: displayMsg,
          rawQty: rawQty,            
          friendlyUom: friendlyUom, 
          convRate: convRate,
          category: invItem.category || "Ingredients",
          purchaseUom: invItem.purchaseUom || invItem.uom,
          cost: invItem.cost || 0,
          reorderLevel: invItem.reorderLevel || 10
      });
  }

  document.getElementById('dispQty').value = '';
  document.getElementById('dispItem').value = ''; // Auto-clear search for next item
  window.renderDispatchCart();
};

window.submitMultiDispatch = async function () {
  let fromBranch = document.getElementById('dispFrom').value;
  let toBranch = document.getElementById('dispTo').value;

  if (!fromBranch || !toBranch) { alert("Please select Source and Destination branches."); return; }
  if (fromBranch === toBranch) { alert("Source and Destination cannot be the same."); return; }
  if (dispatchCart.length === 0) { alert("Cart is empty."); return; }

  let btn = document.getElementById('btnSubmitDispatch');
  btn.innerText = "🚀 Processing Delivery..."; btn.disabled = true;

  try {
    let driverName = prompt("Enter the name of the Delivery Driver/Person in charge:");
    if (!driverName) {
        btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false;
        return; 
    }

    for (let item of dispatchCart) {
      let sourceRef = doc(db, "inventory", item.sourceId);
      let invItem = dispatchInventoryList.find(i => i.id === item.sourceId);
      await updateDoc(sourceRef, { currentStock: invItem.currentStock - item.qty });

      await addDoc(collection(db, "dispatch_logs"), {
        date: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
        timestamp: new Date(),
        item: item.itemName,
        qty: item.qty, 
        uom: item.uom, 
        details: `${fromBranch} ➡️ ${toBranch}`,
        toBranch: toBranch,
        driver: driverName,
        status: "In Transit",
        displayQty: item.rawQty || item.qty,      
        displayUom: item.friendlyUom || item.uom, 
        convRate: item.convRate || 1,
        category: item.category,
        purchaseUom: item.purchaseUom,
        cost: item.cost,
        reorderLevel: item.reorderLevel
      });
    }

    alert(`🚚 Success! ${dispatchCart.length} items are now In Transit to ${toBranch} via ${driverName}.`);
    dispatchCart = []; window.renderDispatchCart(); window.loadDispatchInventory(); 
    if (typeof window.loadDispatchLogs === 'function') window.loadDispatchLogs();
    btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false;
  } catch (e) { 
      console.error(e); alert("Dispatch failed."); 
      btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false; 
  }
};

window.removeFromDispatchCart = function (index) {
  dispatchCart.splice(index, 1);
  window.renderDispatchCart();
};

window.renderDispatchCart = function() {
  const tbody = document.getElementById('dispatchCartBody');
  
  // 🔥 THE FIX: Inject a scrollable container around the table!
  let table = tbody.closest('table');
  if (table && !table.parentElement.classList.contains('table-scroll-wrapper')) {
      let wrapper = document.createElement('div');
      wrapper.className = 'table-scroll-wrapper';
      wrapper.style.maxHeight = '250px';
      wrapper.style.overflowY = 'auto';
      wrapper.style.borderBottom = '1px solid #e2e8f0';
      wrapper.style.marginBottom = '10px';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
  }

  if (dispatchCart.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="padding:15px; color:var(--text-muted);">Cart is empty.</td></tr>'; return; }

  let html = '';
  dispatchCart.forEach((item, idx) => {
    let qtyText = item.displayMsg || `${item.qty} ${item.uom}`;
    
    html += `<tr>
      <td style="padding:10px;"><strong>${item.itemName}</strong></td>
      <td style="font-size:14px; font-weight:bold; color:var(--primary); padding:10px;">${qtyText}</td>
      <td style="text-align:right; padding:10px;"><button class="btn-refresh" style="color:var(--danger); border:1px solid var(--danger); background:#fef2f2; padding:4px 8px; font-size:11px; font-weight:bold;" onclick="window.removeFromDispatchCart(${idx})">✖ Remove</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;
};

window.loadDispatchLogs = async function() {
  const tbody = document.getElementById('dispatchLogBody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td class="text-center" style="padding: 20px;">Loading deliveries...</td></tr>';
  
  try {
    const qLogs = query(collection(db, "dispatch_logs"), orderBy("timestamp", "desc"));
    const snap = await getDocs(qLogs);
    
    let deliveries = {};
    
    snap.forEach(doc => {
        let d = doc.data();
        d.id = doc.id;
        
        // Group individual items into a single "Delivery Run"
        let groupKey = `${d.date}_${d.toBranch}_${d.driver || 'Unknown'}`;
        if(!deliveries[groupKey]) {
            deliveries[groupKey] = {
                date: d.date,
                time: d.time,
                toBranch: d.toBranch,
                driver: d.driver || 'Unknown',
                items: [],
                status: 'In Transit',
                timestamp: d.timestamp
            };
        }
        deliveries[groupKey].items.push(d);
        
        // Auto-update status if any items are flagged
        if(d.status === "Received") deliveries[groupKey].status = "Received";
        if(d.status === "Variance") deliveries[groupKey].status = "Variance Detected";
    });

    let html = '';
    let sortedKeys = Object.keys(deliveries).sort((a,b) => deliveries[b].timestamp - deliveries[a].timestamp);

    if (sortedKeys.length === 0) { 
        html = '<tr><td class="text-center" style="padding: 20px;">No recent deliveries.</td></tr>'; 
    } else {
      sortedKeys.slice(0, 20).forEach(key => {
        let del = deliveries[key];
        let badgeColor = del.status === 'Received' ? '#16a34a' : (del.status === 'Variance Detected' ? '#dc2626' : '#f59e0b');
        
        let safeItemsJson = encodeURIComponent(JSON.stringify(del.items));

        html += `<tr style="border-bottom:1px solid #e2e8f0; background: white;">
          <td style="padding:15px;">
            <div style="font-weight:bold; color:#0f172a; font-size:14px;">📍 To: ${del.toBranch}</div>
            <div style="font-size:12px; color:#64748b; margin-top: 4px;">🚚 Driver: ${del.driver}</div>
            <div style="font-size:11px; color:#94a3b8; margin-top:4px;">📅 ${del.date} at ${del.time}</div>
          </td>
          <td style="padding:15px; text-align:center;">
              <span style="background:${badgeColor}; color:white; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold;">${del.status}</span>
          </td>
          <td style="padding:15px; text-align:right;">
              <button onclick="window.viewDispatchDetails('${safeItemsJson}', '${del.toBranch}', '${del.driver}', '${del.date}')" style="background: white; color: #ea580c; border: 1px solid #ea580c; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 Full Details</button>
          </td>
        </tr>`;
      });
    }
    tbody.innerHTML = html;
  } catch (e) { console.error(e); tbody.innerHTML = '<tr><td class="text-center" style="color:red; padding: 20px;">Error loading logs</td></tr>'; }
};

// Opens the Modal and renders the Variance Table
window.viewDispatchDetails = function(encodedItems, branch, driver, date) {
    let items = JSON.parse(decodeURIComponent(encodedItems));
    let header = document.getElementById('dispatchDetailsHeader');
    let tbody = document.getElementById('dispatchDetailsBody');
    
    header.innerHTML = `<strong>📍 Destination:</strong> ${branch} <br><br> <strong>🚚 Driver:</strong> ${driver} &nbsp;|&nbsp; <strong>📅 Date:</strong> ${date}`;
    
    let html = '';
    items.forEach(item => {
        let sent = parseFloat(item.displayQty || item.qty);
        let received = item.receivedQty !== undefined ? parseFloat(item.receivedQty) : '-';
        let variance = item.varianceQty !== undefined ? parseFloat(item.varianceQty) : '-';
        let status = item.status || 'In Transit';
        let uom = item.displayUom || item.uom;
        
        let varColor = variance < 0 ? '#dc2626' : (variance > 0 ? '#16a34a' : '#475569');
        let varText = variance !== '-' ? (variance > 0 ? `+${variance}` : variance) + ' ' + uom : '-';

        html += `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:12px; font-weight:bold; color:#334155;">${item.item}</td>
            <td style="padding:12px; font-weight: bold;">${sent} ${uom}</td>
            <td style="padding:12px; color:#0284c7; font-weight:bold;">${received !== '-' ? received + ' ' + uom : 'Pending'}</td>
            <td style="padding:12px; color:${varColor}; font-weight:bold;">${varText}</td>
            <td style="padding:12px;">${status}</td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
    document.getElementById('dispatchDetailsModal').style.display = 'flex';
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
            
            // 🔥 NEW: Category Filter for Consumables & Packaging!
            let catFilter = document.getElementById('burnRateCategory') ? document.getElementById('burnRateCategory').value : "All";
            let itemCat = invItem.category || "Ingredients";
            
            if (catFilter === "Packaging" && itemCat !== "Packaging" && itemCat !== "Consumables") return;
            if (catFilter === "Ingredients" && (itemCat === "Packaging" || itemCat === "Consumables")) return;
            
            let currentStock = parseFloat(invItem.currentStock) || 0;
            let uom = invItem.uom || 'units';
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
                    <td style="font-weight: bold; color: #334155;">${itemName} <br><span style="font-size:10px; color:#94a3b8;">(${itemCat})</span></td>
                    <td style="font-weight: bold; font-size: 15px;">${currentStock.toFixed(1)} <span style="font-size:11px; color:#64748b; font-weight:normal;">${uom}</span></td>
                    <td>${totalBurn7Days.toFixed(1)} ${uom}</td>
                    <td style="color: #ea580c; font-weight: bold;">${dailyBurn.toFixed(2)} ${uom}/day</td>
                    <td style="color: ${daysColor}; font-weight: bold; font-size: 15px;">${daysText}</td>
                    <td>
                        <button onclick="let sel=document.getElementById('dispItem'); sel.value='${itemName}'; if(sel.value===''){alert('❌ Out of Stock at Main Office! You cannot dispatch this yet.');}else{window.updateDispatchUomLabel(); document.getElementById('dispQty').focus(); document.getElementById('dispQty').style.border='2px solid #8b5cf6';}" style="background: white; border: 1px solid #8b5cf6; color: #8b5cf6; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer;">📦 Send Stock</button>
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
  let uomSelect = document.getElementById('dispUomSelect');
  let selectedUomType = uomSelect.value; 

  if (!itemName || isNaN(rawQty) || rawQty <= 0) { alert("Please select an item and valid quantity."); return; }

  let invItem = dispatchInventoryList.find(i => i.name === itemName);
  if (!invItem) return;

  let finalBaseQty = rawQty;
  let displayMsg = `${rawQty} ${invItem.uom}`;
  let convRate = 1;
  let friendlyUom = invItem.uom;

  // 🟢 CONVERSION MAGIC
  if (selectedUomType === 'purch') {
      convRate = parseFloat(invItem.conversionRate) || 1;
      finalBaseQty = rawQty * convRate; 
      friendlyUom = invItem.purchaseUom || "Bulk";
      displayMsg = `${rawQty} ${friendlyUom} <span style="font-size:11px; color:var(--text-muted);">(${finalBaseQty} ${invItem.uom})</span>`;
  }

  // Prevent sending more than we have
  if (finalBaseQty > invItem.currentStock) { 
      let stockInPurch = invItem.currentStock / convRate;
      alert(`❌ Not enough stock!\n\nYou are trying to send ${rawQty} ${friendlyUom} (${finalBaseQty} ${invItem.uom}), but the Main Office only has ${stockInPurch.toFixed(2)} ${friendlyUom} (${invItem.currentStock} ${invItem.uom}) available in the database.\n\n(Note: If this math looks wrong, check your inventory settings! Your Base UOM might be set up incorrectly.)`); 
      return; 
  }

  let existing = dispatchCart.find(i => i.itemName === itemName);
  if (existing) { 
      existing.qty += finalBaseQty; 
      existing.rawQty += rawQty;
      existing.displayMsg = `${existing.rawQty} ${friendlyUom} <span style="font-size:11px; color:var(--text-muted);">(${existing.qty} ${invItem.uom})</span>`;
  } else { 
      dispatchCart.push({ 
          itemName: itemName, 
          qty: finalBaseQty, 
          uom: invItem.uom, 
          sourceId: invItem.id,
          displayMsg: displayMsg,
          rawQty: rawQty,           
          friendlyUom: friendlyUom, 
          convRate: convRate,
          // 🔥 NEW: Grab the DNA for the Perfect Clone!
          category: invItem.category || "Ingredients",
          purchaseUom: invItem.purchaseUom || invItem.uom,
          cost: invItem.cost || 0,
          reorderLevel: invItem.reorderLevel || 10
      });
  }

  document.getElementById('dispQty').value = '';
  renderDispatchCart();
};

window.submitMultiDispatch = async function () {
  let fromBranch = document.getElementById('dispFrom').value;
  let toBranch = document.getElementById('dispTo').value;

  if (!fromBranch || !toBranch) { alert("Please select Source and Destination branches."); return; }
  if (fromBranch === toBranch) { alert("Source and Destination cannot be the same."); return; }
  if (dispatchCart.length === 0) { alert("Cart is empty."); return; }

  let btn = document.getElementById('btnSubmitDispatch');
  btn.innerText = "🚀 Processing Delivery..."; btn.disabled = true;

  try {
    let driverName = prompt("Enter the name of the Delivery Driver/Person in charge:");
    if (!driverName) {
        btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false;
        return; 
    }

    for (let item of dispatchCart) {
      // 1. Deduct from Main Office
      let sourceRef = doc(db, "inventory", item.sourceId);
      let invItem = dispatchInventoryList.find(i => i.id === item.sourceId);
      await updateDoc(sourceRef, { currentStock: invItem.currentStock - item.qty });

      // 2. Log it as "In Transit"!
      await addDoc(collection(db, "dispatch_logs"), {
        date: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
        timestamp: new Date(),
        item: item.itemName,
        qty: item.qty, 
        uom: item.uom, 
        details: `${fromBranch} ➡️ ${toBranch}`,
        toBranch: toBranch,
        driver: driverName,
        status: "In Transit",
        displayQty: item.rawQty || item.qty,      
        displayUom: item.friendlyUom || item.uom, 
        convRate: item.convRate || 1,
        // 🔥 NEW: Pass the DNA to the Cashier!
        category: item.category,
        purchaseUom: item.purchaseUom,
        cost: item.cost,
        reorderLevel: item.reorderLevel
      });
    }

    alert(`🚚 Success! ${dispatchCart.length} items are now In Transit to ${toBranch} via ${driverName}.`);
    dispatchCart = []; renderDispatchCart(); window.loadDispatchInventory(); 
    if (typeof loadDispatchLogs === 'function') loadDispatchLogs();
    btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false;
  } catch (e) { 
      console.error(e); alert("Dispatch failed."); 
      btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false; 
  }
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
    // 1. FETCH SHIFT FIRST (True Shift Logic)
    const shiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("startTime", ">=", startOfDay), orderBy("startTime", "desc"), limit(1));
    const shiftSnap = await getDocs(shiftQ);

    if (shiftSnap.empty) {
        document.getElementById('tbCatBody').innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #64748b;">No shift found for this date.</td></tr>';
        document.getElementById('modalDateDisplay').innerText = "No Active Shift";
        return; // Stop running if there's no shift to look at!
    }

    let shiftData = shiftSnap.docs[0].data();
    let sTime = shiftData.startTime.toDate();
    let eTime = shiftData.active ? new Date() : shiftData.endTime.toDate();

    // Update the subtitle to show the EXACT shift hours!
    document.getElementById('modalDateDisplay').innerText = `Shift: ${sTime.toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'})} to ${shiftData.active ? 'Present' : eTime.toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'})}`;

    // 2. Fetch transactions for THIS EXACT SHIFT
    const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", sTime), where("timestamp", "<=", eTime));
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
      
      // 🔥 NEW: Grab customer name and encode the cart data for the modal!
      let safeCustomer = tx.customerName ? tx.customerName.replace(/'/g, "\\'") : 'Guest';
      let safeCart = encodeURIComponent(JSON.stringify(tx.cart || []));

      if (tx.status === "Voided") {
        voidCount++;
        transHtml += `<tr style="opacity: 0.5;"><td>${timeStr}</td><td>${tx.receiptId}</td><td>${safeCustomer}</td><td>-</td><td><span class="badge badge-closed"><span class="status-dot red"></span> VOID</span></td><td style="text-decoration: line-through;">${formatMoney(tx.netTotal)}</td><td></td></tr>`;
      } else {
        transCount++;
        netSales += (tx.netTotal || 0);

        // Track Payments
        let payMethod = tx.paymentMethod || "Unknown";
        if (!payments[payMethod]) payments[payMethod] = 0;
        payments[payMethod] += (tx.netTotal || 0);

        // Track True Categories, Sales, and Advanced COGS
        if (tx.cart && Array.isArray(tx.cart)) {
          tx.cart.forEach(item => {
            let qty = item.qty || 1;
            totalItems += qty;

            let itemName = item.name || item.itemName;
            let cat = menuCategories[itemName] || item.category || 'Uncategorized';
            
            if (!categories[cat]) categories[cat] = { qty: 0, sales: 0, cogs: 0 };

            categories[cat].qty += qty;
            
            // Calculate Sales
            let lineRevenue = item.lineTotalFinal !== undefined ? item.lineTotalFinal : ((item.variantPrice || item.basePrice || 0) * qty);
            categories[cat].sales += lineRevenue;

            // Calculate Base Recipe COGS
            let baseCogs = (recipeCosts[itemName] || 0) * qty;
            let addonCogs = 0;
            
            // Calculate Add-on COGS
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

        // 🔥 UPGRADED ROW WITH CUSTOMER NAME AND VIEW BUTTON
        transHtml += `<tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px;">${timeStr}</td>
            <td style="padding: 10px;"><strong>${tx.receiptId}</strong></td>
            <td style="padding: 10px; color: #475569; font-weight: bold;">${safeCustomer}</td>
            <td style="padding: 10px;">${payMethod}</td>
            <td style="padding: 10px;"><span class="badge badge-active"><span class="status-dot green"></span> PAID</span></td>
            <td style="font-weight: 600; color: var(--primary); padding: 10px;">${formatMoney(tx.netTotal)}</td>
            <td style="padding: 10px; text-align: center;">
                <button onclick="window.viewReceiptDetails('${tx.receiptId}', '${safeCustomer}', '${timeStr}', '${payMethod}', ${tx.netTotal}, '${safeCart}')" style="background: white; border: 1px solid #cbd5e1; color: #334155; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 View</button>
            </td>
        </tr>`;
      }
    });

    // --- DRAWER CASH & AUDIT ENGINE ---
    const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", sTime), where("timestamp", "<=", eTime));
    const expSnap = await getDocs(expQ);
    let dateExpenses = 0;
    expSnap.forEach(doc => dateExpenses += (doc.data().amount || 0));

    // 🔥 THE FIX: Renamed to activeShiftQ to avoid clashing with the top variable!
    const activeShiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true));
    const activeShiftSnap = await getDocs(activeShiftQ);

    const prevShiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("status", "==", "Closed"), orderBy("endTime", "desc"), limit(1));
    const prevShiftSnap = await getDocs(prevShiftQ);
    let lastClosingCash = prevShiftSnap.empty ? 0 : (prevShiftSnap.docs[0].data().declaredCash || 0);

    let startingCash = 0;
    let isActive = !activeShiftSnap.empty;

    if (isActive) {
      startingCash = activeShiftSnap.docs[0].data().startingCash || 0;
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
    // Dynamically update the headers to include Customer and Action!
    let transTableHead = document.getElementById('tbTransBody').previousElementSibling.querySelector('tr');
    if (transTableHead) {
        transTableHead.innerHTML = '<th style="text-align:left; padding:10px;">Time</th><th style="text-align:left; padding:10px;">Receipt ID</th><th style="text-align:left; padding:10px; color: #0284c7;">Customer</th><th style="text-align:left; padding:10px;">Payment</th><th style="text-align:left; padding:10px;">Status</th><th style="text-align:left; padding:10px;">Total</th><th style="text-align:center; padding:10px;">Action</th>';
    }
    
    document.getElementById('tbTransBody').innerHTML = transHtml || '<tr><td colspan="7" class="text-center">No transactions on this date.</td></tr>';

  } catch (error) {
    console.error("Analytics Error:", error);
    document.getElementById('tbCatBody').innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error loading analytics.</td></tr>';
  }
};

// --- THE LIVE INVENTORY ENGINE (UPGRADED WITH FILTERING) ---
window.refreshInventoryView = function() { window.loadInventoryData(); };

window.loadInventoryData = async function() {
    let branchFilter = document.getElementById('invBranchFilter').value;
    let catFilter = document.getElementById('invCategoryFilter') ? document.getElementById('invCategoryFilter').value : "All";
    let search = document.getElementById('liveInvSearch').value.toLowerCase();
    
    let tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 20px;">Loading inventory...</td></tr>';
    
    try {
        let q = branchFilter === "All" ? query(collection(db, "inventory")) : query(collection(db, "inventory"), where("branch", "==", branchFilter));
        const snap = await getDocs(q);
        
        let html = '';
        let totalItems = 0;
        let totalValue = 0;

        // 🔥 THE FIX: Sort the array BEFORE we loop through it!
        let docsArray = snap.docs.map(d => ({id: d.id, ...d.data()}));
        docsArray.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        docsArray.forEach(d => {
            let itemName = (d.name || "").toLowerCase();
            let itemCat = d.category || "Uncategorized";
            
            // 🔥 THE SMART CATEGORY & SEARCH FILTER LOGIC
            if (catFilter !== "All" && itemCat !== catFilter) return; 
            if (search && !itemName.includes(search)) return; 
            
            totalItems++;
            let cost = parseFloat(d.cost || d.purchCost || d.unitCost || 0);
            let stock = parseFloat(d.currentStock || 0);
            let conv = parseFloat(d.conversion || d.conversionRate || 1);
            
            let baseCost = cost / conv;
            if (stock > 0 && !isNaN(baseCost)) totalValue += (baseCost * stock);
            
            let isLow = stock <= parseFloat(d.reorderLevel || d.lowStockAlert || 5);
            let statusHtml = isLow ? `<span style="color:#ef4444; background:#fef2f2; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px;">Low Stock</span>` : `<span style="color:#16a34a; font-weight:bold; font-size:11px;">In Stock</span>`;
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 12px; text-align: center;">
                        <input type="checkbox" class="inv-bulk-checkbox" value="${d.id}" data-name="${d.name}" style="cursor: pointer; width: 16px; height: 16px;">
                    </td>
                    <td style="padding: 12px; font-weight:bold; color:#64748b; font-size:12px;">${d.branch}</td>
                    <td style="padding: 12px; font-weight:900; color:#1e293b;">${d.name}</td>
                    <td style="padding: 12px; font-size:12px; font-weight:bold; color:var(--primary);">${itemCat}</td>
                    <td style="padding: 12px; font-weight:900; color:${isLow ? '#ef4444' : '#334155'}; font-size:15px;">${stock.toFixed(1)} <span style="font-size:11px; font-weight:normal; color:#64748b;">${d.baseUom || ''}</span></td>
                    <td style="padding: 12px;">${statusHtml}</td>
                    <td style="padding: 12px; font-weight:bold; color:#64748b;">₱${baseCost.toFixed(2)}</td>
                    <td style="padding: 12px; display:flex; gap:5px;">
                        <button onclick="window.openEditInvModal('${d.id}')" style="background:#fffbeb; color:#d97706; border:1px solid #fcd34d; padding:6px 12px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✏️ Edit</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="8" class="text-center" style="padding: 30px; color: #64748b; font-weight: bold;">No items match your filters.</td></tr>';
        
        let tItemsEl = document.getElementById('invTotalItems');
        let tValEl = document.getElementById('invTotalValue');
        if (tItemsEl) tItemsEl.innerText = totalItems;
        if (tValEl) tValEl.innerText = '₱' + totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        // Update Command Center KPIs
        if(typeof window.calculateInventoryKPIs === 'function') window.calculateInventoryKPIs(docsArray.filter(i => {
            let bMatch = branchFilter === "All" || i.branch === branchFilter;
            let cMatch = catFilter === "All" || i.category === catFilter;
            return bMatch && cMatch;
        }));

    } catch (e) {
        console.error("Inventory Load Error: ", e);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:red; padding:20px;">Error loading inventory. Check connection.</td></tr>';
    }
};

// ========================================================
// 📊 COMMAND CENTER DASHBOARD LOGIC
// ========================================================
window.switchInvTab = function(tab) {
    window.activeInvTab = tab; 
    let overviewTab = document.getElementById('tabInvOverview'); let auditsTab = document.getElementById('tabInvAudits'); let wasteTab = document.getElementById('tabInvWaste'); let prepTab = document.getElementById('tabInvPrep'); let logsTab = document.getElementById('tabInvStockLogs'); let forecasterTab = document.getElementById('tabInvForecaster'); let alertsTab = document.getElementById('tabInvAlerts');
    
    let liveSec = document.getElementById('invTabLiveContent'); let auditsSec = document.getElementById('invSectionAudits'); let wasteSec = document.getElementById('invSectionWaste'); let prepSec = document.getElementById('invSectionPrepLogs'); let logsSec = document.getElementById('invTabLogsContent'); let forecasterSec = document.getElementById('invSectionForecaster'); let alertsSec = document.getElementById('invSectionAlerts');

    [overviewTab, auditsTab, wasteTab, prepTab, logsTab, forecasterTab, alertsTab].forEach(t => { if(t) { t.style.color = '#64748b'; t.style.borderBottomColor = 'transparent'; }});
    [liveSec, auditsSec, wasteSec, prepSec, logsSec, forecasterSec, alertsSec].forEach(s => { if(s) s.style.display = 'none'; });

    if (tab === 'Overview') { if(overviewTab) { overviewTab.style.color = '#0f766e'; overviewTab.style.borderBottomColor = '#0f766e'; } if(liveSec) liveSec.style.display = 'block'; } 
    else if (tab === 'Audits') { if(auditsTab) { auditsTab.style.color = '#0f766e'; auditsTab.style.borderBottomColor = '#0f766e'; } if(auditsSec) auditsSec.style.display = 'block'; } 
    else if (tab === 'Waste') { if(wasteTab) { wasteTab.style.color = '#0f766e'; wasteTab.style.borderBottomColor = '#0f766e'; } if(wasteSec) wasteSec.style.display = 'block'; } 
    else if (tab === 'Prep') { if(prepTab) { prepTab.style.color = '#0f766e'; prepTab.style.borderBottomColor = '#0f766e'; } if(prepSec) prepSec.style.display = 'block'; } 
    else if (tab === 'StockLogs') { if(logsTab) { logsTab.style.color = '#0f766e'; logsTab.style.borderBottomColor = '#0f766e'; } if(logsSec) logsSec.style.display = 'block'; } 
    else if (tab === 'Forecaster') { if(forecasterTab) { forecasterTab.style.color = '#0f766e'; forecasterTab.style.borderBottomColor = '#0f766e'; } if(forecasterSec) forecasterSec.style.display = 'block'; }
    else if (tab === 'Alerts') { if(alertsTab) { alertsTab.style.color = '#ef4444'; alertsTab.style.borderBottomColor = '#ef4444'; } if(alertsSec) alertsSec.style.display = 'block'; }

    window.refreshActiveInventoryTab();
};

window.refreshActiveInventoryTab = function() {
    let tab = window.activeInvTab || 'Overview';
    if (tab === 'Overview') window.loadInventoryData();
    else if (tab === 'Audits') window.loadInventoryAudits();
    else if (tab === 'Waste') window.loadWasteTabLogs();
    else if (tab === 'Prep') window.loadPrepBatchLogs();
    else if (tab === 'StockLogs') window.loadStockLogs();
    else if (tab === 'Forecaster') window.loadForecasterEngine(); 
    else if (tab === 'Alerts') window.loadPurchasesAndAlerts(); 
};

window.openInventoryLogs = function() { window.switchInvTab('StockLogs'); };

window.loadPrepBatchLogs = async function() {
    const tbody = document.getElementById('prepBatchLogsBody');
    if (!tbody) return;
    let branchFilter = document.getElementById('invBranchFilter').value;
    try {
        const q = query(collection(db, "stock_logs"), where("type", "in", ["Manager Prep Batch", "End-of-Shift Kitchen Prep"]), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
            if (branchFilter !== "All" && d.branch !== branchFilter) return;
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px; color: #64748b; font-size: 12px;">${dateStr}</td>
                <td style="padding: 12px;"><span class="badge badge-open">${d.branch}</span></td>
                <td style="padding: 12px; font-weight: bold; color: #334155;">${d.user || 'System'}</td>
                <td style="padding: 12px; font-weight: bold; color: #8b5cf6;">${d.item}</td>
                <td style="padding: 12px; font-weight: 900; color: #10b981; font-size: 14px;">+${d.variance} <span style="font-size:11px; font-weight:normal; color:#64748b;">${d.uom}</span></td>
                <td style="padding: 12px;"><span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold;">Completed</span></td>
            </tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No prep batches logged.</td></tr>';
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:red;">Error loading logs.</td></tr>'; }
};

window.openInventoryLogs = function() {
    let overviewTab = document.getElementById('tabInvOverview');
    let auditsTab = document.getElementById('tabInvAudits');
    if (overviewTab) { overviewTab.style.color = '#64748b'; overviewTab.style.borderBottomColor = 'transparent'; }
    if (auditsTab) { auditsTab.style.color = '#64748b'; auditsTab.style.borderBottomColor = 'transparent'; }

    let liveTab = document.getElementById('invTabLiveContent');
    let logsTab = document.getElementById('invTabLogsContent');
    let auditsSec = document.getElementById('invSectionAudits');
    
    if (liveTab) liveTab.style.display = 'none';
    if (auditsSec) auditsSec.style.display = 'none';
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
    let targetData = targetSnap.docs[0].data(); // Grab data to get UOM
    let targetStock = targetData.currentStock || 0;

    await updateDoc(targetRef, { currentStock: targetStock + prepQty });

    // 🔥 5. NEW: LOG TO HISTORY SO IT SHOWS IN THE DASHBOARD!
    await addDoc(collection(db, "stock_logs"), {
        branch: branch,
        item: targetItem,
        uom: targetData.uom || "units",
        oldQty: targetStock,
        newQty: targetStock + prepQty,
        variance: prepQty,
        type: "Manager Prep Batch",
        note: `Prepared via Manager HQ`,
        user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
        timestamp: new Date()
    });

    // Success!
    alert(`🥣 Kitchen Success!\n\nPrepared ${prepQty} units of ${targetItem}.\nAll raw ingredients were automatically deducted from ${branch}.`);
    document.getElementById('batchModal').style.display = 'none';
    
    // Refresh the view you are currently on
    if (document.getElementById('view-inventory') && document.getElementById('view-inventory').classList.contains('active')) {
        if(typeof window.loadLiveInventory === 'function') window.loadLiveInventory();
    }

  } catch (error) {
    console.error(error); alert("Failed to prepare batch.");
  } finally {
    btn.innerText = "🚀 Mix & Deduct Ingredients"; btn.disabled = false;
  }
};

// ==========================================
// 🏦 MASTER CASH & BUDGET ENGINE
// ==========================================
window.loadAccountsAndBudget = async function() {
    // ==========================================
    // 🏦 PART 1: THE SLEEK CASH LEDGER
    // ==========================================
    try {
        const tbody = document.getElementById('accTableBody');
        if (tbody) {
            const snap = await getDocs(collection(db, "cash_accounts"));
            let accountsByBranch = {};
            let totalCash = 0;
            
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
                
                html += `
                    <tr style="background: white; cursor: pointer; border-bottom: 1px solid #e2e8f0; transition: background 0.2s;" 
                        onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'"
                        onclick="window.openBranchAccountsModal('${branch}')">
                        <td colspan="2" style="font-weight: 900; color: #0f766e; font-size: 16px; padding: 18px;">
                            🏢 ${branch}
                        </td>
                        <td style="font-weight: 900; color: #16a34a; font-size: 16px; padding: 18px;">
                            ₱${branchTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}
                        </td>
                        <td style="text-align: right; padding: 18px;">
                            <span style="font-size: 12px; color: white; background: var(--primary); padding: 6px 12px; border-radius: 20px; font-weight: bold; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(15, 118, 110, 0.3);">
                                🔍 View ${accountsByBranch[branch].length} Accounts
                            </span>
                        </td>
                    </tr>
                `;
            }
            tbody.innerHTML = html;
        }
    } catch (e) {
        console.error("Error loading accounts:", e);
    }

    // ==========================================
    // 💸 PART 2: THE MONTHLY BUDGET TRACKER (GROUPED BY BRANCH)
    // ==========================================
    try {
        const budgetBody = document.getElementById('budgetListBody');
        if (!budgetBody) return;

        const budgetSnap = await getDocs(collection(db, "budgets"));
        let bHtml = '';
        let totalB = 0;
        let totalS = 0;
        
        window.liveBudgets = []; 

        let today = new Date();
        let currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        let displayMonth = `${monthNames[today.getMonth()]} ${today.getFullYear()}`;

        let budgetItems = [];
        budgetSnap.forEach(doc => { budgetItems.push({id: doc.id, ...doc.data()}) });

        let budgetsByBranch = {};

        if (budgetItems.length === 0) {
            bHtml = '<div class="text-center" style="color: #64748b; padding: 20px;">No budget categories found. Click "+ Category" to start tracking.</div>';
        } else {
            // Group items into branches
            budgetItems.forEach(b => {
                let branchName = b.branch || "Unassigned";
                if (!budgetsByBranch[branchName]) budgetsByBranch[branchName] = [];

                let limit = parseFloat(b.limit || b.amount || 0);
                let spent = parseFloat(b.spent || 0);
                let budgetMonth = b.currentMonth || "";

                if (budgetMonth !== currentMonthStr) {
                    spent = 0; 
                    updateDoc(doc(db, "budgets", b.id), { spent: 0, currentMonth: currentMonthStr });
                }

                window.liveBudgets.push({ ...b, spent: spent, limit: limit });
                totalB += limit;
                totalS += spent;
                
                budgetsByBranch[branchName].push({ ...b, spent: spent, limit: limit });
            });

            // Build the HTML Grouped by Branch
            for (let branch in budgetsByBranch) {
                let branchLimit = 0;
                let branchSpent = 0;
                let branchItemsHtml = '';

                budgetsByBranch[branch].forEach(b => {
                    branchLimit += b.limit;
                    branchSpent += b.spent;

                    let pct = b.limit > 0 ? (b.spent / b.limit) * 100 : 0;
                    let barColor = pct >= 90 ? '#ef4444' : (pct >= 75 ? '#f59e0b' : '#10b981');

                    branchItemsHtml += `
                        <div style="margin-bottom: 12px; background: white; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <div style="color: #334155; font-size: 14px; font-weight: bold;">
                                    ${b.category || b.name || 'Category'} 
                                    <span style="font-size:10px; color:#94a3b8; font-weight:normal; margin-left:5px;">(${displayMonth})</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <span style="color: ${barColor}; font-weight: bold; font-size: 13px;">₱${b.spent.toLocaleString(undefined, {minimumFractionDigits: 2})} / ₱${b.limit.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                    <button onclick="window.openEditBudgetModal('${b.id}', '${b.category || b.name}', ${b.limit}, '${branch}')" style="background: white; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;" title="Edit Limit">✏️ Edit</button>
                                    <button onclick="window.deleteBudgetCategory('${b.id}', '${b.category || b.name}')" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;" title="Delete">🗑️</button>
                                </div>
                            </div>
                            <div style="background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden;">
                                <div style="width: ${Math.min(pct, 100)}%; height: 100%; background: ${barColor}; transition: width 0.5s;"></div>
                            </div>
                        </div>
                    `;
                });

                bHtml += `
                    <div style="margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #cbd5e1;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
                            <h3 style="margin: 0; color: #0f766e; font-size: 16px;">🏢 ${branch}</h3>
                            <span style="font-weight: bold; color: #475569; font-size: 13px;">Total: ₱${branchSpent.toLocaleString(undefined, {minimumFractionDigits: 2})} / ₱${branchLimit.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                        ${branchItemsHtml}
                    </div>
                `;
            }
        }
        
        budgetBody.innerHTML = bHtml;
        if (document.getElementById('accTotalBudget')) document.getElementById('accTotalBudget').innerText = `₱${totalB.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if (document.getElementById('accTotalSpent')) document.getElementById('accTotalSpent').innerText = `₱${totalS.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    } catch (e) {
        console.error("Budget Error:", e);
        const budgetBody = document.getElementById('budgetListBody');
        if (budgetBody) budgetBody.innerHTML = '<div class="text-center" style="color: red; padding: 20px;">Error loading budgets.</div>';
    }
}; // <-- THIS IS THE MAGIC BRACKET THAT WAS MISSING!

// ==========================================
// 🏢 NEW: BRANCH ACCOUNTS MODAL ENGINE
// ==========================================
window.openBranchAccountsModal = function(branch) {
    let branchAccounts = window.liveAccounts.filter(acc => acc.branch === branch);
    let branchTotal = branchAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
    
    document.getElementById('branchAccModalTitle').innerHTML = `🏢 ${branch} Ledger`;
    document.getElementById('branchAccModalTotal').innerText = `Total: ₱${branchTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    let html = '';
    if (branchAccounts.length === 0) {
        html = '<tr><td colspan="3" class="text-center" style="padding: 20px; color: #64748b;">No accounts found for this branch.</td></tr>';
    } else {
        // Sort by balance (highest first)
        branchAccounts.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        
        branchAccounts.forEach(acc => {
            html += `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="font-weight: bold; color: #334155; font-size: 15px; padding: 12px;">${acc.name}</td>
                    <td style="font-weight: 900; color: #059669; font-size: 15px; padding: 12px;">₱${(acc.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="text-align: right; padding: 12px;">
                        <button onclick="window.editCashAccount('${acc.id}', '${acc.name}', ${acc.balance || 0})" style="background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; margin-right: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✏️ Edit</button>
                        <button onclick="window.deleteCashAccount('${acc.id}', '${acc.name}'); document.getElementById('branchAccountsModal').style.display='none';" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🗑️</button>
                    </td>
                </tr>
            `;
        });
    }
    
    document.getElementById('branchAccModalBody').innerHTML = html;
    document.getElementById('branchAccountsModal').style.display = 'flex';
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

// ==========================================
// ➕ NEW: ADD ACCOUNT MODAL CONTROLLER
// ==========================================
window.addCashAccount = function() {
    document.getElementById('newAccBranch').value = 'Main Office';
    document.getElementById('newAccName').value = '';
    document.getElementById('newAccBalance').value = '';
    document.getElementById('addAccountModal').style.display = 'flex';
};

window.saveNewCashAccount = async function() {
    let branch = document.getElementById('newAccBranch').value;
    let name = document.getElementById('newAccName').value.trim();
    let bal = parseFloat(document.getElementById('newAccBalance').value) || 0;

    if (!name) { alert("Please enter an Account Name."); return; }

    let btn = document.getElementById('btnSaveNewAcc');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "cash_accounts"), { branch, name, balance: bal });
        alert(`✅ ${name} Account successfully created for ${branch}!`);
        document.getElementById('addAccountModal').style.display = 'none';
        window.loadAccountsAndBudget();
    } catch (e) { 
        console.error(e); 
        alert("Failed to add account."); 
    } finally {
        btn.innerText = "💾 Save Account"; btn.disabled = false;
    }
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
// 🛠️ BUDGET MANAGEMENT (MODAL CONTROL)
// ==========================================

window.openAddBudgetModal = function() {
    document.getElementById('addBudgetModal').style.display = 'flex';
    document.getElementById('newBudgetBranch').value = 'Main Office';
    document.getElementById('newBudgetCategory').value = '';
    document.getElementById('newBudgetLimit').value = '';
};

window.submitNewBudget = async function() {
    let branch = document.getElementById('newBudgetBranch').value;
    let category = document.getElementById('newBudgetCategory').value.trim();
    let limit = parseFloat(document.getElementById('newBudgetLimit').value);

    if (!category || isNaN(limit) || limit < 0) {
        alert("Please provide a valid category name and limit amount."); return;
    }

    let btn = document.getElementById('btnSubmitNewBudget');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    let today = new Date();
    let currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    try {
        await addDoc(collection(db, "budgets"), {
            branch: branch,
            category: category,
            limit: limit,
            spent: 0,
            currentMonth: currentMonthStr,
            createdAt: serverTimestamp()
        });
        alert(`✅ Success! Budget added for ${branch}.`);
        document.getElementById('addBudgetModal').style.display = 'none';
        window.loadAccountsAndBudget();
    } catch (e) {
        console.error("Error adding budget:", e);
        alert("Failed to add category.");
    } finally {
        btn.innerText = "💾 Save Category"; btn.disabled = false;
    }
};

window.openEditBudgetModal = function(id, name, currentLimit, branch) {
    document.getElementById('editBudgetId').value = id;
    document.getElementById('editBudgetTitle').innerText = `Updating Limit for: ${branch} - ${name}`;
    document.getElementById('editBudgetLimit').value = currentLimit;
    document.getElementById('editBudgetModal').style.display = 'flex';
};

window.submitEditBudget = async function() {
    let id = document.getElementById('editBudgetId').value;
    let newLimit = parseFloat(document.getElementById('editBudgetLimit').value);

    if (isNaN(newLimit) || newLimit < 0) {
        alert("❌ Invalid amount entered."); return;
    }

    let btn = document.getElementById('btnSubmitEditBudget');
    btn.innerText = "⏳ Updating..."; btn.disabled = true;

    try {
        await updateDoc(doc(db, "budgets", id), {
            limit: newLimit,
            amount: newLimit // Legacy fallback just in case
        });
        document.getElementById('editBudgetModal').style.display = 'none';
        window.loadAccountsAndBudget(); // Instantly refresh UI
    } catch (e) {
        console.error(e); alert("❌ Failed to update budget.");
    } finally {
        btn.innerText = "💾 Update Limit"; btn.disabled = false;
    }
};

window.deleteBudgetCategory = async function(docId, catName) {
    if (!confirm(`⚠️ ARE YOU SURE?\n\nDelete budget category: ${catName}?\nThis cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, "budgets", docId));
        alert(`🗑️ ${catName} budget category deleted.`);
        window.loadAccountsAndBudget();
    } catch(e) { console.error(e); alert("Failed to delete budget."); }
};

window.openLogExpenseModal = function() {
    if (!window.liveBudgets || window.liveBudgets.length === 0) { alert("Add a Budget Category first."); return; }
    if (!window.liveAccounts || window.liveAccounts.length === 0) { alert("Add a Cash Account first."); return; }

    let budgetSelect = document.getElementById('logExpBudgetSelect');
    let accSelect = document.getElementById('logExpAccSelect');

    budgetSelect.innerHTML = '<option value="">-- Select Budget Category --</option>';
    window.liveBudgets.forEach(b => {
        let avail = b.limit - b.spent;
        budgetSelect.innerHTML += `<option value="${b.id}">${b.category} (${b.branch}) - Avail: ₱${avail.toLocaleString()}</option>`;
    });

    accSelect.innerHTML = '<option value="">-- Select Cash Account --</option>';
    window.liveAccounts.forEach(a => {
        // 🔥 STRICT FILTER: Only show Main Office accounts!
        if (a.branch === "Main Office") {
            // I also removed the (Branch) text since it will always be Main Office now!
            accSelect.innerHTML += `<option value="${a.id}">${a.name} - Bal: ₱${a.balance.toLocaleString()}</option>`;
        }
    });

    document.getElementById('logExpAmount').value = '';
    document.getElementById('logExpNote').value = '';
    let now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('logExpDate').value = now.toISOString().split('T')[0];
    document.getElementById('logExpenseModal').style.display = 'flex';
};

window.submitLogExpense = async function() {
    let budId = document.getElementById('logExpBudgetSelect').value;
    let accId = document.getElementById('logExpAccSelect').value;
    let amt = parseFloat(document.getElementById('logExpAmount').value);
    let note = document.getElementById('logExpNote').value.trim();
    let expDateVal = document.getElementById('logExpDate').value;
    let finalDate = expDateVal ? new Date(expDateVal + 'T12:00:00') : new Date();

    if (!budId || !accId) { alert("Please select a budget and a cash account."); return; }
    if (isNaN(amt) || amt <= 0) { alert("Please enter a valid amount."); return; }

    let selBud = window.liveBudgets.find(b => b.id === budId);
    let selAcc = window.liveAccounts.find(a => a.id === accId);

    if (selAcc.balance < amt) {
        if (!confirm(`⚠️ WARNING: ${selAcc.name} only has ₱${selAcc.balance}. Deducting this will make the account negative. Continue?`)) return;
    }

    let btn = document.getElementById('btnSubmitLogExpense');
    btn.innerText = "⏳ Processing..."; btn.disabled = true;

    try {
        // 1. Deduct from Cash Account
        await updateDoc(doc(db, "cash_accounts", selAcc.id), { balance: selAcc.balance - amt });
        
        // 2. Add to Budget Spent
        await updateDoc(doc(db, "budgets", selBud.id), { spent: selBud.spent + amt });

        // 3. Log to Global "expenses" collection
        await addDoc(collection(db, "expenses"), {
            branch: selBud.branch,
            amount: amt,
            category: selBud.category,
            account: selAcc.name,
            note: note,
            timestamp: finalDate // 🔥 SAVES THE EXACT DATE YOU CHOSE
        });

        alert(`🧾✅ Expense Logged! ₱${amt.toLocaleString()} deducted from ${selAcc.name}.`);
        document.getElementById('logExpenseModal').style.display = 'none';
        window.loadAccountsAndBudget();
    } catch (e) {
        console.error(e); alert("Failed to log expense.");
    } finally {
        btn.innerText = "💸 Confirm & Deduct"; btn.disabled = false;
    }
};

window.openBudgetLogsModal = async function() {
    document.getElementById('budgetLogsModal').style.display = 'flex';
    const tbody = document.getElementById('budgetLogsBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px;">⏳ Fetching recent budget expenses...</td></tr>';

    try {
        // Grab the 30 most recent expenses (ignoring Payroll to keep it clean)
        const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            if (d.category === "Payroll" || d.category === "Supplier Payment") return; // Keep it focused on Budgets

            let timeStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            
            html += `
            <tr style="border-bottom: 1px dashed #e2e8f0;">
                <td style="padding: 12px 10px; color: #64748b; font-size: 12px;">${timeStr}</td>
                <td style="padding: 12px 10px; font-weight: bold; color: #334155;">📍 ${d.branch || 'Unknown'}</td>
                <td style="padding: 12px 10px;">
                    <strong style="color: #0f766e;">${d.category || 'Expense'}</strong><br>
                    <span style="font-size: 11px; color: #64748b; font-style: italic;">${d.note || '-'}</span>
                </td>
                <td style="padding: 12px 10px; font-weight: bold; color: #b45309;">${d.account || 'Unknown'}</td>
                <td style="padding: 12px 10px; font-weight: bold; color: #dc2626; text-align: right; font-size: 15px;">
                    -₱${(d.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
                </td>
            </tr>`;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 20px;">No recent budget logs found.</td></tr>';
    } catch(e) {
        console.error("Log Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red; padding: 20px;">Failed to fetch logs.</td></tr>';
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
    document.querySelectorAll('#costingTabsContainer .costing-tab, #tabGlobalAddons').forEach(el => {
        el.style.color = 'var(--text-muted)'; el.style.borderBottomColor = 'transparent';
    });
    if (element) {
        element.style.color = tabName === 'GlobalAddons' ? '#d97706' : 'var(--primary)';
        element.style.borderBottomColor = tabName === 'GlobalAddons' ? '#d97706' : 'var(--primary)';
    }

    let menuSec = document.getElementById('menuCostingSection');
    let addonSec = document.getElementById('globalAddonsSection');

    if (tabName === 'GlobalAddons') {
        if (menuSec) menuSec.style.display = 'none';
        if (addonSec) addonSec.style.display = 'block';
        if (typeof window.loadGlobalAddons === 'function') window.loadGlobalAddons();
    } else {
        if (addonSec) addonSec.style.display = 'none';
        if (menuSec) menuSec.style.display = 'block';
        window.activeCostingTab = tabName;
        if (typeof window.loadMenuCosting === 'function') window.loadMenuCosting(); 
    }
};

window.loadMenuCosting = async function() {
  const tbody = document.getElementById('bomTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Calculating margins...</td></tr>';

  let searchQuery = document.getElementById('costingSearch') ? document.getElementById('costingSearch').value.toLowerCase() : '';

  try {
      // 1. Get Live Inventory Costs (WITH SMART MULTI-BRANCH FILTER)
      const invSnap = await getDocs(collection(db, "inventory"));
      globalInventoryCosts = {};
        
      invSnap.forEach(doc => {
          let data = doc.data();
          let currentCost = parseFloat(data.baseCost) || 0;
            
          // 🔥 THE FIX: If an item exists in multiple branches, ALWAYS grab the highest/updated cost to protect margins!
          if (!globalInventoryCosts[data.name] || currentCost > globalInventoryCosts[data.name].cost) {
              globalInventoryCosts[data.name] = { cost: currentCost, uom: data.uom };
          }
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
        let totalBaseStock = conv * initQty;
        let baseCost = cost / conv; 
        
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
          showToCashier: showCashier, // 🔥 THIS COMMA WAS MISSING!
          showInPrep: document.getElementById('newInvShowPrep') ? document.getElementById('newInvShowPrep').checked : true
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
// 🔥 STOCK HISTORY & LOGGING ENGINE (UPGRADED)
// ========================================================
window.loadStockLogs = async function() {
  const tbody = document.getElementById('stockLogsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 20px;">Loading history...</td></tr>';

  let branchFilter = document.getElementById('invBranchFilter').value;

  try {
    // Added limit(150) so your app doesn't crash trying to load 10,000 logs at once!
    const qLogs = query(collection(db, "stock_logs"), orderBy("timestamp", "desc"), limit(150));
    const snap = await getDocs(qLogs);
    let html = '';

    snap.forEach(doc => {
      let data = doc.data();
      if (branchFilter !== "All" && data.branch !== branchFilter) return;

      let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';

      // 🔥 THE CLEANUP FIX: Safely intercept missing data from the Cashier App!
      let user = data.user || data.cashier || "System Auto-Deduct";
      let uom = data.uom || "";
      let oldQty = data.oldQty !== undefined ? data.oldQty : "-";
      let newQty = data.newQty !== undefined ? data.newQty : "-";
      let logType = data.type || "System Update";

      let varHtml = '';
      if (data.variance > 0) {
          varHtml = `<span style="color: var(--success); font-weight: bold;">+${data.variance} ${uom} <br><span style="font-size:10px; color:#64748b;">(${logType})</span></span>`;
      } else if (data.variance < 0) {
          varHtml = `<span style="color: var(--danger); font-weight: bold;">${data.variance} ${uom} <br><span style="font-size:10px; color:#64748b;">(${logType})</span></span>`;
      } else {
          varHtml = `<span style="color: var(--text-muted);">No Change <br><span style="font-size:10px; color:#64748b;">(${logType})</span></span>`;
      }

      html += `
        <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
          <td style="font-size: 12px; color: var(--text-muted); font-family: monospace; padding: 12px;">${dateStr}</td>
          <td style="padding: 12px;"><span class="badge badge-open">${data.branch || 'Unknown'}</span></td>
          <td style="font-weight: bold; color: #334155; padding: 12px;">👤 ${user}</td>
          <td style="font-weight: 600; color: #0f172a; padding: 12px;">${data.item || 'Unknown Item'}</td>
          <td style="color: #64748b; padding: 12px;">${oldQty} <span style="font-size:11px;">${uom}</span></td>
          <td style="font-weight: bold; color: #0284c7; padding: 12px;">${newQty} <span style="font-size:11px;">${uom}</span></td>
          <td style="padding: 12px;">${varHtml}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="padding: 30px; color: #64748b;">No stock history found.</td></tr>';
  } catch (e) { 
    console.error("Stock Logs Error:", e); 
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red; padding: 20px;">Error loading logs. Check console.</td></tr>'; 
  }
};

// ==========================================
// ✏️ UPGRADED INVENTORY EDIT ENGINE
// ==========================================
window.openEditInvModal = async function(docId) {
    try {
        const docSnap = await getDoc(doc(db, "inventory", docId));
        if (!docSnap.exists()) { alert("Item not found!"); return; }
        
        let d = docSnap.data();
        console.log("Loading item data:", d); // 🔥 Helps you see if data is actually coming from Firebase

        // 1. Fill ID and Branch
        document.getElementById('editInvId').value = docId;
        document.getElementById('editInvBranch').value = d.branch || "Main Office";
        
        // 2. Safely set Category
        let catSelect = document.getElementById('editInvCat');
        if (catSelect) {
            // This handles the "Prepared" vs "Prepared Batch" issue we just fixed!
            catSelect.value = d.category || "Ingredients";
        }

        // 3. Fill Text/Number fields with safety fallback
        document.getElementById('editInvName').value = d.name || "";
        document.getElementById('editInvPurchUom').value = d.purchaseUom || d.uom || "";
        document.getElementById('editInvBaseUom').value = d.uom || "";
        
        // Use d.conversion or d.conversionRate, fallback to 1
        document.getElementById('editInvConversion').value = d.conversion || d.conversionRate || 1;
        document.getElementById('editInvPurchCost').value = d.purchaseCost || d.baseCost || 0;
        document.getElementById('editInvLowStock').value = d.reorderLevel || d.lowStockAlert || 0;
        document.getElementById('editInvOldQty').value = d.currentStock || 0;
        
        // Handle checkbox
        document.getElementById('editInvShowPrep').checked = (d.showInPrep !== false);
        
        // 4. Reset Variance fields
        document.getElementById('editInvNewQty').value = ""; 
        document.getElementById('editInvNote').value = ""; 
        document.getElementById('editInvVariance').innerText = "0";

        // 5. Trigger calculations
        window.calcEditCost();
        
        // Show the modal
        document.getElementById('editInvModal').style.display = 'flex';
        
    } catch (e) {
        console.error("Error opening edit modal:", e);
        alert("Failed to load item details: " + e.message);
    }
};

window.calcEditCost = function() {
    let cost = parseFloat(document.getElementById('editInvPurchCost').value) || 0;
    let conv = parseFloat(document.getElementById('editInvConversion').value) || 1;
    let baseCost = cost / conv;
    let baseUom = document.getElementById('editInvBaseUom').value || 'unit';
    let summaryEl = document.getElementById('editInvCostSummary');
    if (summaryEl) summaryEl.innerText = `Calculated Base Cost: ₱${baseCost.toFixed(4)} per ${baseUom}`;
};

window.calcEditVariance = function() {
    let oldQ = parseFloat(document.getElementById('editInvOldQty').value) || 0;
    let newQ = document.getElementById('editInvNewQty').value;
    let varianceEl = document.getElementById('editInvVariance');
    
    if (newQ === "") {
        varianceEl.innerText = "0";
        varianceEl.style.color = "#d97706";
        return;
    }
    
    let diff = parseFloat(newQ) - oldQ;
    varianceEl.innerText = (diff > 0 ? "+" : "") + diff;
    varianceEl.style.color = diff < 0 ? "#ef4444" : "#16a34a";
};

window.saveInventoryEdit = async function() {
    let docId = document.getElementById('editInvId').value;
    let branch = document.getElementById('editInvBranch').value;
    let category = document.getElementById('editInvCat').value;
    let name = document.getElementById('editInvName').value.trim();
    let purchUom = document.getElementById('editInvPurchUom').value.trim();
    let baseUom = document.getElementById('editInvBaseUom').value.trim();
    let conversion = parseFloat(document.getElementById('editInvConversion').value) || 1;
    let purchCost = parseFloat(document.getElementById('editInvPurchCost').value) || 0;
    let lowStock = parseFloat(document.getElementById('editInvLowStock').value) || 0;
    
    let oldQty = parseFloat(document.getElementById('editInvOldQty').value) || 0;
    let newQtyRaw = document.getElementById('editInvNewQty').value;
    let note = document.getElementById('editInvNote').value.trim();

    if (!name) { alert("Item name is required!"); return; }

    let finalQty = oldQty;
    let isAdjusting = false;

    if (newQtyRaw !== "") {
        finalQty = parseFloat(newQtyRaw);
        isAdjusting = true;
        if (!note) { alert("You must provide an Adjustment Note/Reason if you are changing the stock quantity."); return; }
    }

    let btn = document.getElementById('btnSaveInvEdit');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        // 🔥 THE FIX: We added 'baseCost' and 'baseUom' so the Recipe Engine reads the exact math!
        await updateDoc(doc(db, "inventory", docId), {
            branch: branch,
            category: category,
            name: name,
            purchaseUom: purchUom,
            purchUom: purchUom,
            baseUom: baseUom,
            uom: baseUom, 
            conversion: conversion,
            conversionRate: conversion, 
            purchaseCost: purchCost,
            purchCost: purchCost,
            cost: purchCost, 
            baseCost: (purchCost / conversion), // <--- THE MAGIC FIX
            lowStockAlert: lowStock,
            reorderLevel: lowStock, 
            currentStock: finalQty, 
            showInPrep: document.getElementById('editInvShowPrep') ? document.getElementById('editInvShowPrep').checked : true
        });

        // Log the manual edit if they physically changed the quantity!
        if (isAdjusting && finalQty !== oldQty) {
            let variance = finalQty - oldQty;
            let safeCashierName = window.sessionUser ? window.sessionUser.cashierName : 'Manager';
            await addDoc(collection(db, "stock_logs"), {
                branch: branch,
                item: name,
                oldQty: oldQty,
                newQty: finalQty,
                variance: variance,
                type: "Manual Adjustment",
                note: note,
                user: safeCashierName,
                timestamp: serverTimestamp()
            });
        }

        alert("✅ Item updated successfully!");
        document.getElementById('editInvModal').style.display = 'none';
        window.loadInventoryData();
    } catch (e) {
        console.error(e); alert("Failed to save changes.");
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

        logSnap.forEach(docSnap => {
            let data = docSnap.data();
            if (data.status === "Received") {
                totalCash += (data.amount || 0);
            }
            uniqueTransfers.set(docSnap.id, data);
        });

        pendingSnap.forEach(docSnap => {
            let data = docSnap.data();
            pendingCount++;
            uniqueTransfers.set(docSnap.id, data); 
        });

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
                : (status === "Rejected" 
                    ? `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">❌ Rejected</span>`
                    : `<span style="background: #fef9c3; color: #ca8a04; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Pending</span>`);

            let actionBtn = status === "Pending"
                ? `<div style="display:flex; gap:5px;">
                    <button onclick="window.viewRemittanceAudit('${data.id}', '${data.branch}', '${data.salesPeriodStart || 'N/A'}', '${data.salesPeriodEnd || 'N/A'}', ${data.amount}, '${data.channel}')" style="background: #0ea5e9; color: white; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; flex:1;">🔍 Audit</button>
                    <button onclick="approveRemittance('${data.id}', ${data.amount}, '${data.branch}', '${data.channel}')" style="background: #16a34a; color: white; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; flex:1;">Approve</button>
                    <button onclick="window.rejectRemittance('${data.id}', '${data.branch}')" style="background: #dc2626; color: white; border: none; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; flex:1;">Reject</button>
                   </div>`
                : `<span style="color: #94a3b8; font-size: 12px; display: block; text-align: center;">Locked</span>`;

            html += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 15px 20px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 15px 20px;">
                        <strong style="color: var(--primary); font-size: 15px;">${data.branch}</strong><br>
                        <span style="font-size: 12px; color: #64748b;">By: ${data.cashier}</span><br>
                        <span style="font-size: 11px; color: #94a3b8;">Sales: ${data.salesPeriodStart || 'N/A'} to ${data.salesPeriodEnd || 'N/A'}</span>
                    </td>
                    <td style="padding: 15px 20px;">
                        <strong style="font-size: 13px;">${data.channel}</strong> ➡️ ${data.recipient}<br>
                        <span style="font-size: 12px; font-family: monospace; color: #0284c7;">Ref: ${data.referenceNumber || 'N/A'}</span>
                    </td>
                    <td style="padding: 15px 20px; text-align: center;">${statusBadge}</td>
                    <td style="padding: 15px 20px; text-align: right; font-size: 16px; font-weight: bold; color: #16a34a;">
                        ₱${data.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </td>
                    <td style="padding: 15px 20px; width: 180px;">${actionBtn}</td>
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

window.rejectRemittance = async function(docId, branchName) {
    let reason = prompt(`WARNING: You are about to reject a remittance from ${branchName}.\n\nPlease enter the reason for rejection (this will be saved in the logs):`);
    
    // If they click cancel or leave it blank, abort the rejection.
    if (reason === null || reason.trim() === "") {
        return; 
    }
    
    if (confirm(`Final Confirmation: Reject this remittance?`)) {
        try {
            await updateDoc(doc(db, "remittances", docId), {
                status: "Rejected",
                rejectedReason: reason,
                rejectedAt: serverTimestamp(),
                rejectedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager"
            });
            
            alert("❌ Remittance has been rejected and locked.");
            window.loadCashExplorer(); // Refresh the table instantly
            
            // If you have a dashboard refresher, this triggers it so the floating cash updates
            if (typeof window.loadUnremittedCashDashboard === 'function') window.loadUnremittedCashDashboard();
            if (typeof window.loadDashboard === 'function') window.loadDashboard();
            
        } catch (e) {
            console.error("Error rejecting remittance:", e);
            alert("Failed to reject remittance. Please check your connection.");
        }
    }
};

// ========================================================
// 🔍 REMITTANCE AUDIT ENGINE
// ========================================================
window.viewRemittanceAudit = async function(remitId, branch, startStr, endStr, amount, channel) {
    if (!document.getElementById('remitAuditModal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overlay" id="remitAuditModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;">
                <div style="background:white; width:500px; border-radius:12px; overflow:hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <div style="background:#0f172a; color:white; padding:15px 20px; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:16px;">🔍 Financial Audit</h3>
                        <span onclick="document.getElementById('remitAuditModal').style.display='none'" style="cursor:pointer; font-size:24px;">✖</span>
                    </div>
                    <div id="remitAuditBody" style="padding:20px; background:#f8fafc;">Loading financial data...</div>
                </div>
            </div>
        `);
    }

    document.getElementById('remitAuditModal').style.display = 'flex';
    let body = document.getElementById('remitAuditBody');
    body.innerHTML = `<div style="text-align:center; padding: 40px; color: #64748b;">⏳ Crunching transactions from<br><strong>${startStr}</strong> to <strong>${endStr}</strong>...</div>`;

    try {
        let startObj = new Date(startStr); startObj.setHours(0,0,0,0);
        let endObj = new Date(endStr); endObj.setHours(23,59,59,999);

        if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
            body.innerHTML = `<div style="color:red; text-align:center; padding: 20px;">Invalid date range provided by cashier. Cannot run audit.</div>`;
            return;
        }

        // 1. Calculate Total Cash Sales in Period
        let cashSales = 0;
        const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startObj), where("timestamp", "<=", endObj));
        const txSnap = await getDocs(txQ);
        txSnap.forEach(d => {
            let tx = d.data();
            if (tx.status !== 'Voided') {
                if (tx.splitDetails) {
                    let cashSplit = tx.splitDetails.find(s => s.method === "Cash");
                    if (cashSplit) cashSales += cashSplit.amount;
                } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                    cashSales += (tx.netTotal || 0);
                }
            }
        });

        // 2. Calculate Total Expenses in Period
        let cashExpenses = 0;
        const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", startObj), where("timestamp", "<=", endObj));
        const expSnap = await getDocs(expQ);
        expSnap.forEach(d => {
            let exp = d.data();
            if (!exp.description.includes("[REMITTANCE")) {
                cashExpenses += (parseFloat(exp.amount) || 0);
            }
        });

        let netCashGenerated = cashSales - cashExpenses;
        let diff = amount - netCashGenerated;
        let diffColor = diff === 0 ? '#16a34a' : (diff < 0 ? '#dc2626' : '#ea580c');
        let diffNote = diff === 0 ? "Perfect Match ✔️" : (diff < 0 ? "Shorting Detected 🔻" : "Over Remitted 🔺");

        body.innerHTML = `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                <div style="font-size:12px; color:#64748b; font-weight:bold; margin-bottom:5px;">AUDIT PERIOD</div>
                <div style="font-size:14px; font-weight:bold; color:#0f172a;">${branch} (${startStr} to ${endStr})</div>
            </div>
            
            <table style="width:100%; border-collapse: collapse; font-size: 14px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; color:#475569;">Total Cash Sales</td>
                    <td style="padding: 12px; text-align:right; font-weight:bold; color:#16a34a;">+ ₱${cashSales.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; color:#475569;">Total Cash Expenses</td>
                    <td style="padding: 12px; text-align:right; font-weight:bold; color:#dc2626;">- ₱${cashExpenses.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                    <td style="padding: 12px; font-weight:bold; color:#0f172a;">Net Cash Generated</td>
                    <td style="padding: 12px; text-align:right; font-weight:900; color:#0f172a;">₱${netCashGenerated.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                    <td style="padding: 12px; font-weight:bold; color:#0ea5e9;">Cashier Remitted</td>
                    <td style="padding: 12px; text-align:right; font-weight:900; color:#0ea5e9;">₱${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
            </table>

            <div style="margin-top: 15px; text-align: center; padding: 15px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 8px;">
                <div style="font-size: 12px; font-weight: bold; color: #b45309;">VARIANCE ANALYSIS</div>
                <div style="font-size: 18px; font-weight: 900; color: ${diffColor}; margin-top: 5px;">${diffNote} (₱${Math.abs(diff).toLocaleString(undefined, {minimumFractionDigits:2})})</div>
                <div style="font-size: 11px; color: #92400e; margin-top: 5px; font-style: italic;">*Note: Floating cash from days prior to ${startStr} are not included in this isolated period check.</div>
            </div>
            
            <button onclick="window.approveRemittance('${remitId}', ${amount}, '${branch}', '${channel}'); document.getElementById('remitAuditModal').style.display='none';" style="width:100%; margin-top:15px; padding:15px; background:#16a34a; color:white; font-weight:bold; border:none; border-radius:8px; cursor:pointer; font-size:16px;">Approve ₱${amount.toLocaleString()} Remittance</button>
        `;

    } catch(e) {
        console.error(e);
        body.innerHTML = `<div style="color:red; text-align:center; padding: 20px;">Failed to run audit.</div>`;
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
        // 🔥 FIX: We MUST specify "Main Office" so it doesn't accidentally deposit into a branch's account!
        const accQuery = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", targetAccountName));
        const accSnap = await getDocs(accQuery);

        if (accSnap.empty) {
            // SAFETY LOCK: If they remitted to "BDO" but you haven't created a "BDO" account yet!
            alert(`⚠️ Routing Error: No cash account named "${targetAccountName}" found in the Main Office!\n\nPlease go to Cash & Budget, click "+ Add" to create an account named "${targetAccountName}" for the Main Office, and try approving this again.`);
            return; 
        }

        // 4. Deposit the money!
        const targetAccDoc = accSnap.docs[0];
        const currentBalance = parseFloat(targetAccDoc.data().balance) || 0;
        const newBalance = currentBalance + amountToDeposit;
        
        await updateDoc(doc(db, "cash_accounts", targetAccDoc.id), { balance: newBalance });

        // 🔥 FIX: Create the Audit Log so it shows up in your history!
        await addDoc(collection(db, "account_logs"), {
            accountId: targetAccDoc.id,
            accountName: targetAccountName,
            branch: "Main Office",
            action: "Remittance Received",
            amount: amountToDeposit,
            newBalance: newBalance,
            user: window.sessionUser ? window.sessionUser.cashierName : 'Owner',
            timestamp: serverTimestamp(),
            note: `Remitted by ${data.cashier} from ${data.branch}`
        });

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
    // 🔥 Export ALL exact columns required for the math engine!
    let csvContent = "\uFEFFFirebaseID,Branch,Category,ItemName,PurchaseUOM,BaseUOM,ConversionRate,PurchaseCost,BaseCost,CurrentStock,ReorderLevel\n";

    snap.forEach(docSnap => {
      let d = docSnap.data();
      let cleanName = (d.name || '').replace(/"/g, '""');
      let cleanCat = (d.category || '').replace(/"/g, '""');
      
      csvContent += `"${docSnap.id}","${d.branch || 'Main Office'}","${cleanCat}","${cleanName}","${d.purchaseUom || d.uom || ''}","${d.uom || d.baseUom || ''}","${d.conversionRate || d.conversion || 1}","${d.purchaseCost || d.purchCost || 0}","${d.baseCost || 0}","${d.currentStock || 0}","${d.reorderLevel || 0}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Takodeal_Inventory_Master.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  } catch (e) { console.error(e); alert("Failed to export CSV."); }
};


// ========================================================
// 2. READS AND UPDATES THE DATABASE WITHOUT DUPLICATING
// ========================================================
window.smartImportCSV = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  
  // 🔥 GRAB THE LABEL SAFELY
  const uploadLabel = event.target.parentElement;
  const originalText = uploadLabel.innerHTML;
  uploadLabel.innerHTML = "⏳ Syncing..."; 
  uploadLabel.style.pointerEvents = "none"; // Disable clicking safely

  reader.onload = async function (e) {
    const text = e.target.result;
    const rows = text.split('\n');

    let updatedCount = 0;
    let addedCount = 0;

    try {
      // Loop through every row (Skip row 0 because it's the header)
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        let cols = rows[i].split(',');

        let docId = cols[0] ? cols[0].trim() : "";
        let branch = cols[1] ? cols[1].trim() : "";
        let category = cols[2] ? cols[2].trim() : "";
        let name = cols[3] ? cols[3].trim() : "";
        let pUom = cols[4] ? cols[4].trim() : "";
        let bUom = cols[5] ? cols[5].trim() : "";
        let conv = parseFloat(cols[6]) || 1;
        let pCost = parseFloat(cols[7]) || 0;
        let bCost = parseFloat(cols[8]) || 0;
        let currentStock = parseFloat(cols[9]) || 0;
        let reorder = parseFloat(cols[10]) || 0;

        if (!name) continue;

        let payload = {
            branch: branch, category: category, name: name, 
            purchaseUom: pUom, uom: bUom, baseUom: bUom,
            conversionRate: conv, conversion: conv,
            purchaseCost: pCost, baseCost: bCost, 
            currentStock: currentStock, reorderLevel: reorder
        };

        if (docId !== "") await updateDoc(doc(db, "inventory", docId), payload);
        else await addDoc(collection(db, "inventory"), payload);
      }

      alert(`✅ Smart Sync Complete!\n\nUpdated: ${updatedCount} existing items.\nAdded: ${addedCount} brand new items.`);
      if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
      else location.reload();

    } catch (error) {
      console.error(error); alert("❌ Fatal Error syncing CSV data.");
    } finally {
      event.target.value = ''; // Reset the file input
      uploadLabel.innerHTML = originalText; // Restore original button text
      uploadLabel.style.pointerEvents = "auto";
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

    // Sort in memory so we don't need to create a complex Firebase Index!
    let devices = [];
    snap.forEach(doc => devices.push({ id: doc.id, ...doc.data() }));
    devices.sort((a, b) => (b.registeredAt?.toDate() || 0) - (a.registeredAt?.toDate() || 0));

    devices.forEach(d => {
      let statusBadge = '';
      if (d.status === 'Blocked') {
          statusBadge = `<span class="badge" style="background: var(--danger); color: white; padding: 4px 8px; border-radius: 6px;">🚫 Blocked</span>`;
      } else if (d.status === 'Pending') {
          statusBadge = `<span class="badge" style="background: #f59e0b; color: white; padding: 4px 8px; border-radius: 6px; animation: pulse 2s infinite;">⏳ Pending Approval</span>`;
      } else {
          statusBadge = `<span class="badge badge-active" style="padding: 4px 8px; border-radius: 6px;">✅ Active</span>`;
      }

      let dateStr = d.registeredAt ? d.registeredAt.toDate().toLocaleDateString() : 'Unknown';

      // Build the dynamic action buttons!
      let actionsHtml = '';
      if (d.status === 'Pending') {
          actionsHtml += `<button class="btn-refresh" style="background: #10b981; color: white; border: none; padding: 5px 10px; margin-right: 5px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="toggleDeviceStatus('${d.id}', 'Active')">✅ Approve</button>`;
          actionsHtml += `<button class="btn-refresh" style="background: #ef4444; color: white; border: none; padding: 5px 10px; margin-right: 5px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="toggleDeviceStatus('${d.id}', 'Blocked')">🚫 Reject</button>`;
      } else if (d.status === 'Active') {
          actionsHtml += `<button class="btn-refresh" style="background: #fef2f2; border: 1px solid var(--danger); color: var(--danger); padding: 5px 10px; margin-right: 5px; border-radius: 4px; cursor: pointer;" onclick="toggleDeviceStatus('${d.id}', 'Blocked')">🚫 Block</button>`;
      } else {
          actionsHtml += `<button class="btn-refresh" style="background: #f0fdf4; border: 1px solid var(--success); color: var(--success); padding: 5px 10px; margin-right: 5px; border-radius: 4px; cursor: pointer;" onclick="toggleDeviceStatus('${d.id}', 'Active')">✅ Unblock</button>`;
      }
      actionsHtml += `<button class="btn-refresh" style="background: white; border: 1px solid var(--text-muted); color: var(--text-muted); padding: 5px 10px; border-radius: 4px; cursor: pointer;" onclick="deleteDevice('${d.id}')">🗑️ Delete</button>`;

      html += `
        <tr style="${d.status === 'Pending' ? 'background: #fffbeb;' : ''}">
          <td><strong>${d.deviceName || 'Unnamed Tablet'}</strong><br><span style="font-size: 11px; color: gray;">ID: ${d.id}</span></td>
          <td>📍 ${d.branch}</td>
          <td>${dateStr}</td>
          <td>${statusBadge}</td>
          <td>${actionsHtml}</td>
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

window.loadZReadingArchive = async function() {
    let tbody = document.getElementById('zReadingBody');
    if (!tbody) return;
    
    // Build the UI header with Branch and Date Filters!
    let filterUI = `
        <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 20px; display: flex; gap: 15px; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="flex: 1;">
                <label style="font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 5px; display: block;">Filter by Branch:</label>
                <select id="zBranchFilter" onchange="window.fetchZReadings()" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #94a3b8; font-weight: bold; outline: none;">
                    <option value="All">All Branches</option>
                    <option value="Cabantian">Cabantian</option>
                    <option value="Citygate">Citygate</option>
                    <option value="Maa">Maa</option>
                    <option value="Main Office">Main Office</option>
                </select>
            </div>
            <div style="flex: 1;">
                <label style="font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 5px; display: block;">Filter by Date:</label>
                <input type="date" id="zDateFilter" onchange="window.fetchZReadings()" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #94a3b8; font-weight: bold; outline: none;">
            </div>
            <button onclick="document.getElementById('zDateFilter').value=''; document.getElementById('zBranchFilter').value='All'; window.fetchZReadings();" style="margin-top: 20px; padding: 10px 15px; background: #e2e8f0; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; color: #475569;">Clear Filters</button>
        </div>
    `;

    // Inject the filter UI ABOVE the table if it doesn't exist yet
    let tableElement = tbody.closest('table');
    let parentDiv = tableElement.parentElement;
    if (!document.getElementById('zBranchFilter')) {
        let filterDiv = document.createElement('div');
        filterDiv.innerHTML = filterUI;
        parentDiv.insertBefore(filterDiv, tableElement);
    }

    // Load initial data
    window.fetchZReadings();
};

window.fetchZReadings = async function() {
    let tbody = document.getElementById('zReadingBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 20px;">Fetching Z-Readings...</td></tr>';

    let selectedBranch = document.getElementById('zBranchFilter').value;
    let selectedDate = document.getElementById('zDateFilter').value;

    try {
        // 🔥 THE INDEX-FREE QUERY 🔥
        // We only ask Firebase for one simple thing: "Give me the closed shifts."
        // Firebase does not need a custom index for a single requirement!
        let q = query(collection(db, "shifts"), where("status", "==", "Closed"));
        const snap = await getDocs(q);

        // Put them in a Javascript array so we can sort them manually
        let allShifts = [];
        snap.forEach(doc => allShifts.push({ id: doc.id, ...doc.data() }));

        // 🧠 JAVASCRIPT SORTING: Sort by newest first
        allShifts.sort((a, b) => {
            let timeA = a.endTime ? a.endTime.toDate().getTime() : 0;
            let timeB = b.endTime ? b.endTime.toDate().getTime() : 0;
            return timeB - timeA;
        });

        let html = '';
        let displayCount = 0;

        // 🧠 JAVASCRIPT FILTERING: We loop through them and hide what we don't want!
        allShifts.forEach(s => {
            if (displayCount >= 50) return; // Only show 50 to keep the app fast

            // If the manager selected a specific branch, skip the others!
            if (selectedBranch !== "All" && s.branch !== selectedBranch) return;

            // If the manager selected a specific date, skip the others!
            if (selectedDate && s.endTime) {
                let shiftDate = s.endTime.toDate().toISOString().split('T')[0];
                if (shiftDate !== selectedDate) return; 
            }

            // If it survived the filters, build the HTML!
            displayCount++;
            let startStr = s.startTime ? s.startTime.toDate().toLocaleString() : 'N/A';
            let endStr = s.endTime ? s.endTime.toDate().toLocaleString() : 'N/A';
            let varColor = s.difference < 0 ? 'red' : (s.difference > 0 ? 'green' : '#333');
            
            let digitalTotal = s.totalDigitalSales || 0;
            let cSales = s.totalCashSales !== undefined ? s.totalCashSales : s.grossSales;
            let diffText = s.difference !== undefined ? `<span style="color:${varColor}; font-weight:bold;">₱${s.difference.toFixed(2)}</span>` : '-';
            
            // Safe JSON strings for the View button
            let breakdownStr = encodeURIComponent(JSON.stringify(s.cashBreakdown || {}));
            let stockStr = encodeURIComponent(JSON.stringify(s.physicalStockCount || {}));
            let safeCashier = s.cashier ? s.cashier.replace(/'/g, "\\'") : 'Unknown';
            let safeBranch = s.branch ? s.branch.replace(/'/g, "\\'") : 'Unknown';

            html += `<tr>
                <td style="font-weight:bold; color:var(--primary);">${s.id.slice(0,6).toUpperCase()}</td>
                <td><strong style="font-size: 14px;">${safeBranch}</strong><br><span style="font-size:11px; color:#666;">${safeCashier}</span></td>
                <td style="font-size:12px; color:#555;">${startStr} <br> ${endStr}</td>
                <td style="font-weight:bold;">₱${(cSales || 0).toLocaleString()} <br> <span style="font-size:11px; color:var(--primary);">+₱${digitalTotal.toLocaleString()} Digital</span></td>
                <td style="font-weight:bold; color:#dc3545;">-₱${(s.cashOut || s.expenses || 0).toLocaleString()}</td>
                <td>
                    <div style="font-size:12px;">Sys Expected: <strong>₱${(s.expectedCash || 0).toLocaleString()}</strong></div>
                    <div style="font-size:12px;">Phys Declared: <strong>₱${(s.declaredCash || 0).toLocaleString()}</strong></div>
                    <div style="font-size:12px; border-top:1px dashed #ccc; margin-top:2px;">Diff: ${diffText}</div>
                </td>
                <td><button class="btn-refresh" style="background:#fef3c7; border:1px solid #fcd34d; color:#b45309;" onclick="window.viewZReadingDetails('${s.id}', '${breakdownStr}', '${stockStr}', '${safeCashier}', '${safeBranch}', ${s.declaredCash || 0})">🔍 View</button></td>
            </tr>`;
        });
        
        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="padding: 20px;">No Z-Readings match this filter.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:red; padding: 20px;">Error loading logs.</td></tr>';
    }
};

// ========================================================
// 🔍 THE BEAUTIFUL VARIANCE & BREAKDOWN MODAL
// ========================================================
window.viewZReadingDetails = async function (shiftId, breakdownStr, stockStr, cashierName, branchName, declaredCash) {
  // 1. Open the UI
  document.getElementById('breakdownModal').style.display = 'flex';
  document.getElementById('bdTitle').innerText = `Z-Reading: ${cashierName.toUpperCase()} (${branchName})`;
  document.getElementById('bdTotalCash').innerText = `Declared Total: ₱${parseFloat(declaredCash).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  // --- 🚀 NEW: THE ENTERPRISE SALES MATH ENGINE ---
  document.getElementById('bdNetSalesTotal').innerText = "⏳ Loading...";
  document.getElementById('bdPaymentBreakdown').innerHTML = "Loading...";
  document.getElementById('bdOrderTypeBreakdown').innerHTML = "Loading...";

  try {
      // 1. Get the exact start and end time of this specific shift
      const shiftSnap = await getDoc(doc(db, "shifts", shiftId));
      if (shiftSnap.exists()) {
          let sTime = shiftSnap.data().startTime.toDate();
          let eTime = shiftSnap.data().endTime.toDate();

          // 2. Query ALL transactions that happened exactly within that time block
          const txQ = query(collection(db, "transactions"), 
              where("branch", "==", branchName), 
              where("timestamp", ">=", sTime), 
              where("timestamp", "<=", eTime)
          );
          const txSnap = await getDocs(txQ);

          let totalNet = 0;
          let payments = {};
          let orderTypes = {};

          // 3. Crunch the numbers!
          txSnap.forEach(tDoc => {
              let tx = tDoc.data();
              if (tx.status !== "Voided") {
                  totalNet += (tx.netTotal || 0);

                  let payMeth = tx.paymentMethod || "Cash";
                  payments[payMeth] = (payments[payMeth] || 0) + (tx.netTotal || 0);

                  let oType = tx.orderType || "Dine-In";
                  orderTypes[oType] = (orderTypes[oType] || 0) + (tx.netTotal || 0);
              }
          });

          // 4. Inject the data into your beautiful new UI
          document.getElementById('bdNetSalesTotal').innerText = "₱" + totalNet.toLocaleString(undefined, {minimumFractionDigits: 2});

          let payHtml = '';
          for (let p in payments) {
              let amountVal = payments[p];
              payHtml += `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed #cbd5e1; padding:4px 0;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0; font-size:13px; color:#334155;">
                        <input type="checkbox" class="pay-toggle-chk" value="${amountVal}" checked onchange="window.recalcModalNetSales()" style="width:16px; height:16px; cursor:pointer;">
                        ${p}
                    </label>
                    <strong style="color:#0f766e;">₱${amountVal.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
                </div>`;
          }
          document.getElementById('bdPaymentBreakdown').innerHTML = payHtml || "<i style='color:#94a3b8;'>No sales</i>";

          let typeHtml = '';
          for (let t in orderTypes) {
              typeHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #cbd5e1; padding:4px 0;"><span>${t}</span><strong style="color:#0f766e;">₱${orderTypes[t].toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>`;
          }
          document.getElementById('bdOrderTypeBreakdown').innerHTML = typeHtml || "<i style='color:#94a3b8;'>No sales</i>";
      }
  } catch(e) {
      console.error("Sales Math Error:", e);
  }
  // --- END OF SALES MATH ENGINE ---

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
  let branchFilter = document.getElementById('zReadingBranchFilter') ? document.getElementById('zReadingBranchFilter').value : "All";

  try {
    let q = query(collection(db, "shifts"), where("status", "==", "Closed"), orderBy("endTime", "desc"));
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

      if (branchFilter !== "All") {
          q = query(collection(db, "shifts"), where("branch", "==", branchFilter), where("status", "==", "Closed"), orderBy("endTime", "desc"));
      }
        
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
          <td style="font-size: 13px;">
              <span style="color: #64748b;">Start: ${formatMoney(data.startingCash || 0)}</span><br>
              Exp: ${formatMoney(data.expectedCash)}<br>
              Dec: <span style="color:${(data.declaredCash - data.expectedCash) < 0 ? '#dc2626' : '#16a34a'}; font-weight:bold;">${formatMoney(data.declaredCash)}</span>
          </td>
          <td>${varText}</td>
          <td>
            <button onclick="viewZReadingDetails('${docSnap.id}', '${breakdownStr}', '${stockStr}', '${safeCashier}', '${safeBranch}', ${declared})" class="btn-refresh" style="background: #0f172a; color: white; border: none; padding: 6px 12px; border-radius: 6px;">🔍 Full Audit</button>
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

    let dateFilter = document.getElementById('attendanceDateFilter') ? document.getElementById('attendanceDateFilter').value : "";
    let sortBy = document.getElementById('attendanceSort') ? document.getElementById('attendanceSort').value : "time";

    // Auto-set the date picker to TODAY if it is blank
    if (!dateFilter) {
        let today = new Date();
        today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
        dateFilter = today.toISOString().split('T')[0];
        if(document.getElementById('attendanceDateFilter')) document.getElementById('attendanceDateFilter').value = dateFilter;
    }

    let startOfDay = new Date(dateFilter + 'T00:00:00');
    let endOfDay = new Date(dateFilter + 'T23:59:59');

    try {
        // Only grab logs for the specific day selected
        const q = query(collection(db, "attendance_logs"), 
            where("timestamp", ">=", startOfDay), 
            where("timestamp", "<=", endOfDay)
        );
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

        let logsArray = [];
        snap.forEach(docSnap => { logsArray.push({ id: docSnap.id, ...docSnap.data() }); });

        // 🧠 SMART IN-MEMORY SORTING
        if (sortBy === 'name') {
            logsArray.sort((a, b) => {
                let nameA = a.staffName || "";
                let nameB = b.staffName || "";
                if (nameA === nameB) return b.timestamp - a.timestamp; // Sort punches by time
                return nameA.localeCompare(nameB); // Sort alphabetically
            });
        } else {
            logsArray.sort((a, b) => b.timestamp - a.timestamp);
        }

        let html = '';
        logsArray.forEach(data => {
            let timeStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH') : 'Just now';
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

            let actionHtml = `
                <div style="display: flex; gap: 5px; justify-content: center;">
                    <button onclick="window.viewSelfie('${data.photoBase64}', '${data.staffName} - ${data.type}')" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="View Selfie">📷</button>
                    <button onclick="window.deleteAttendanceLog('${data.id}', '${data.staffName}')" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="Delete Log">🗑️</button>
                </div>
            `;
            
            if (data.isManual) {
                locationText = `📍 ${data.branch} <br><span style="color:#d97706; font-size:11px; font-weight:bold;">⚠️ Manual Edit: ${data.remarks}</span>`;
                actionHtml = `
                <div style="display: flex; gap: 5px; justify-content: center; align-items: center;">
                    <span style="font-size: 10px; color: #64748b; font-weight: bold; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px dashed #cbd5e1;">Manual</span>
                    <button onclick="window.deleteAttendanceLog('${data.id}', '${data.staffName}')" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="Delete Log">🗑️</button>
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

        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No logs found for this date.</td></tr>';
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

window.scheduleHolidays = {}; // Memory for holidays

// 🔥 FIREBASE SAVE/LOAD (Upgraded with Holidays)
window.saveToCloud = async function() {
    try {
        const appData = { branchConfig, employees, unavailability, currentSchedule, currentYear, currentMonth, holidays: window.scheduleHolidays };
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
            window.scheduleHolidays = appData.holidays || {}; // Load Holidays!
            
            if (currentYear && currentMonth) {
                const mm = currentMonth < 10 ? '0' + currentMonth : currentMonth;
                document.getElementById("monthSelector").value = `${currentYear}-${mm}`;
            }
        } else {
            const today = new Date();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            document.getElementById("monthSelector").value = `${today.getFullYear()}-${mm}`;
        }
        window.renderConfigUI(); window.updateStaffDisplay(); window.updateAvailDropdown(); window.updateUnavailabilityList(); window.updateHolidayList(); window.renderTables();
    } catch(e) { console.error("Cloud Load Error:", e); }
};

// 🏖️ HOLIDAY UI FUNCTIONS
window.addHoliday = function() {
    const date = document.getElementById('holidayDate').value;
    const type = document.getElementById('holidayType').value;
    if (!date) return alert("Select a date.");
    window.scheduleHolidays[date] = type;
    window.updateHolidayList();
    window.saveToCloud(); // Auto-save to Firebase
};

window.removeHoliday = function(date) {
    if (!confirm(`Remove holiday on ${date}?`)) return;
    delete window.scheduleHolidays[date];
    window.updateHolidayList();
    window.saveToCloud();
};

window.updateHolidayList = function() {
    const list = document.getElementById('holidayList');
    if(!list) return;
    list.innerHTML = '';
    const dates = Object.keys(window.scheduleHolidays).sort();
    if (dates.length === 0) { list.innerHTML = '<span style="color:#aaa;">No holidays set.</span>'; return; }
    
    dates.forEach(date => {
        let type = window.scheduleHolidays[date];
        let color = type === 'Regular' ? '#dc2626' : '#ea580c';
        const div = document.createElement('div'); 
        div.style.cssText = 'display:flex; justify-content:space-between; padding:5px; border-bottom:1px dashed #cbd5e1; margin-bottom: 5px;';
        div.innerHTML = `<span><strong>${date}</strong>: <span style="background: ${type === 'Regular' ? '#fee2e2' : '#fef3c7'}; color:${color}; padding: 2px 6px; border-radius: 4px; font-weight:bold; font-size: 11px;">${type} (+${type === 'Regular' ? '50' : '10'}%)</span></span><span style="color:#ef4444;cursor:pointer;font-weight:bold;" onclick="window.removeHoliday('${date}')">✖</span>`;
        list.appendChild(div);
    });
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
    // 🔥 THE FIX: "\uFEFF" forces Excel to read the Peso signs perfectly!
    let csvFile = new Blob(["\uFEFF" + csv.join("\n")], {type: "text/csv;charset=utf-8;"});
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
        let pendingCount = 0;
        let resolvedByStaff = {}; // 🔥 NEW: Grouping object for the Accordion!

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Unknown';
            let safeName = d.staffName ? d.staffName.replace(/'/g, "\\'") : 'Unknown';

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

            let attachedImage = d.photoBase64 || d.proofImageUrl || d.imageUrl || d.image;
            if (attachedImage) {
                detailsStr += `<br><button onclick="window.viewSelfie('${attachedImage}', 'Attached Photo from ${safeName}')" style="margin-top: 8px; background: #f0f9ff; border: 1px solid #bae6fd; color: #0284c7; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">📷 View Photo</button>`;
            }

            if (d.status === "Pending") {
                pendingCount++;
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
                // 🔥 NEW: Store resolved items into the group memory
                if (!resolvedByStaff[safeName]) resolvedByStaff[safeName] = [];
                d.dateStr = dateStr;
                d.detailsStr = detailsStr;
                resolvedByStaff[safeName].push(d);
            }
        });

        // 🔥 NEW: Build the Accordion UI for Resolved Items!
        let resolvedHtml = '';
        for (let staff in resolvedByStaff) {
            let reqs = resolvedByStaff[staff];
            let safeStaffId = staff.replace(/[^a-zA-Z0-9]/g, ''); // Removes spaces for HTML IDs
            
            resolvedHtml += `
                <tr style="background: white; cursor: pointer; border-bottom: 1px solid #e2e8f0; transition: background 0.2s;" 
                    onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'"
                    onclick="window.toggleResolvedStaff('${safeStaffId}')">
                    <td colspan="4" style="font-weight: 900; color: #334155; font-size: 15px; padding: 18px;">
                        <span id="icon_res_${safeStaffId}" style="display:inline-block; width:20px; color:#94a3b8;">▼</span> 👤 ${staff}
                    </td>
                    <td style="text-align: right; padding: 18px;">
                        <span style="font-size: 12px; color: white; background: var(--primary); padding: 6px 12px; border-radius: 20px; font-weight: bold; display: inline-flex; align-items: center; box-shadow: 0 2px 4px rgba(15, 118, 110, 0.3);">
                            🔍 View ${reqs.length} Records
                        </span>
                    </td>
                </tr>
            `;
            
            reqs.forEach(d => {
                let statusColor = d.status === "Approved" ? "#16a34a" : "#dc2626";
                let statusBg = d.status === "Approved" ? "#dcfce7" : "#fef2f2";
                resolvedHtml += `
                    <tr class="res-row-${safeStaffId}" style="display: none; background: #f8fafc; border-bottom: 1px dashed #cbd5e1;">
                        <td style="padding: 12px; padding-left: 45px; color: #64748b;">${d.dateStr}</td>
                        <td style="padding: 12px;"><span style="font-size:11px; color:#64748b; font-weight:bold;">📍 ${d.branch || 'Unknown'}</span></td>
                        <td style="padding: 12px;"><span style="font-weight: bold; color: var(--primary);">${d.type}</span></td>
                        <td style="padding: 12px; max-width: 250px; white-space: normal;">${d.detailsStr}</td>
                        <td style="padding: 12px; text-align:right;"><span style="background: ${statusBg}; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${d.status}</span></td>
                    </tr>
                `;
            });
        }

        pendingBody.innerHTML = pendingHtml || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #16a34a; font-weight: bold;">No pending requests! 🎉</td></tr>';
        if (resolvedBody) resolvedBody.innerHTML = resolvedHtml || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #64748b;">No resolved history yet.</td></tr>';

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

// 🔥 NEW: Toggle Function for the Resolved Accordion
window.toggleResolvedStaff = function(staffId) {
    let rows = document.querySelectorAll('.res-row-' + staffId);
    let icon = document.getElementById('icon_res_' + staffId);
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
// 💸 AUTO-PAYSLIP GENERATOR ENGINE (WITH NIGHT SHIFT SUPPORT)
// ==========================================

window.setDefaultCutoffDates = function() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');

    let startDate, endDate;

    // 🔥 SMART CUTOFF FOR 5TH/20TH PAY CYCLE!
    if (today.getDate() <= 15) {
        // It's the first half of the month (1st to 15th)
        startDate = `${yyyy}-${mm}-01`;
        endDate = `${yyyy}-${mm}-15`;
    } else {
        // It's the second half of the month (16th to End of Month)
        startDate = `${yyyy}-${mm}-16`;
        let lastDay = new Date(yyyy, today.getMonth() + 1, 0).getDate();
        endDate = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
    }

    const startEl = document.getElementById('payrollStart');
    const endEl = document.getElementById('payrollEnd');
    if (startEl) startEl.value = startDate;
    if (endEl) endEl.value = endDate;
};

// Safe trigger that waits for the HTML to finish loading!
document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.setDefaultCutoffDates === 'function') {
        try { window.setDefaultCutoffDates(); } catch(e) {}
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

        // 2. Fetch Shifts & Unpaid Deductions
        const shiftQ = query(collection(db, "shifts"), where("startTime", ">=", startTimestamp), where("startTime", "<=", endTimestamp));
        const shiftSnap = await getDocs(shiftQ);
        
        // 🔥 THE FIX: Strictly target the actual Deductions Ledger
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

        // 🔥 THE FIX: Aggregate Vales & Meals (With Strict Date Logic!)
        deductSnap.forEach(docSnap => {
            let deduct = docSnap.data();
            let name = deduct.staffName;
            if (!payrollData[name]) return; 

            // SAFETY LOCK: Ignore any Vales taken AFTER the cutoff end date!
            let dDate = deduct.dateAdded ? deduct.dateAdded.toDate() : new Date();
            if (dDate > endTimestamp) return;

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
            
            let loanData = ledgerDict[name];
            let autoLoanDeduction = 0;
            let ledgerId = null;

            if (loanData) {
                let currentBalance = loanData.totalLoaned - loanData.totalPaid;
                if (currentBalance > 0) {
                    let setRate = loanData.cutoffDeduction || 0;
                    autoLoanDeduction = Math.min(setRate, currentBalance);
                    ledgerId = loanData.id;
                }
            }

            data.loans = autoLoanDeduction;
            data.ledgerId = ledgerId;
            data.deductions += autoLoanDeduction; 

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

// ========================================================
// 🛡️ ABSOLUTE OVERRIDE: CRASH-PROOF PAYSLIP ENGINE
// ========================================================
window.openPayslipModal = async function(staffName) {
    let data = window.globalPayrollCache ? window.globalPayrollCache[staffName] : null;
    if (!data) return;

    window.currentPayslipData = data; 
    
    let finalizeBtn = document.getElementById('btnFinalizePayslip');
    if (finalizeBtn) {
        if (data.isPaid) {
            finalizeBtn.innerText = "✅ Paid & Done!";
            finalizeBtn.disabled = true;
            finalizeBtn.style.background = "#16a34a"; 
            finalizeBtn.style.cursor = "not-allowed";
        } else {
            finalizeBtn.innerText = "✅ Mark Paid & Auto-Deduct";
            finalizeBtn.disabled = false;
            finalizeBtn.style.background = "#3b82f6"; 
            finalizeBtn.style.cursor = "pointer";
        }
    }

    const safeSetText = (id, val) => { let el = document.getElementById(id); if (el) el.innerText = val; };
    const safeSetVal = (id, val) => { let el = document.getElementById(id); if (el) el.value = val; };

    safeSetText('psName', data.name || "Unknown");
    safeSetText('psBranch', data.branch || "Unassigned");
    safeSetText('psStart', data.start || "");
    safeSetText('psEnd', data.end || "");
    
    let safeBasicPay = parseFloat(data.basicPay) || 0;
    safeSetText('psBasicPay', safeBasicPay.toLocaleString(undefined, {minimumFractionDigits: 2}));
    
    safeSetText('psDaysWorked', data.shiftsWorked || 0);
    safeSetText('psDateHired', (data.profile && data.profile.dateHired) ? data.profile.dateHired : "---");
    
    let today = new Date();
    safeSetText('psPayDistributed', today.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }));

    safeSetVal('psOvertime', data.nightBonus || 0);
    safeSetVal('psHoliday', data.holidayPayTotal || 0);
    safeSetVal('psLate', data.lateDeduction || 0);
    safeSetVal('psSSS', data.sss || 0);
    safeSetVal('psPhil', data.philhealth || 0);
    safeSetVal('psPagibig', data.pagibig || 0);
    safeSetVal('psAdvance', data.advances || 0);
    safeSetVal('psLoans', data.loans || 0);
    safeSetVal('psFoods', data.meals || 0);
    
    let wifiBox = document.getElementById('psWifi');
    if(wifiBox) wifiBox.value = 0;

    let attHtml = '';
    if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
            // 🔥 FIX: Added 'text-align: center;' to beautifully align your table columns!
            attHtml += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px; text-align: center;">${log.date || ''}</td>
                <td style="padding: 8px; font-weight: bold; color: #16a34a; text-align: center;">${log.in || ''}</td>
                <td style="padding: 8px; font-weight: bold; color: #dc2626; text-align: center;">${log.out || ''}</td>
                <td style="padding: 8px; font-weight: bold; text-align: center;">${log.hrs || 0}h</td>
                <td style="padding: 8px; font-size:11px; text-align: center;">${log.remark || ''}</td>
            </tr>`;
        });
    } else {
        attHtml = '<tr><td colspan="5" style="text-align:center; padding: 15px; color: #94a3b8;">No attendance logs found.</td></tr>';
    }
    let attBody = document.getElementById('psAttendanceBody');
    if (attBody) attBody.innerHTML = attHtml;

    if (typeof window.recalcPayslip === 'function') window.recalcPayslip();
    
    let modal = document.getElementById('payslipModal');
    if(modal) modal.style.display = 'flex';
};

window.recalcPayslip = function() {
    const getVal = (id) => { let el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; };
    const safeSetText = (id, val) => { let el = document.getElementById(id); if (el) el.innerText = val; };

    let basicEl = document.getElementById('psBasicPay');
    let basic = 0;
    if (basicEl) {
        basic = parseFloat(basicEl.innerText.replace(/,/g, '')) || 0;
    }

    let overtime = getVal('psOvertime');
    let holiday = getVal('psHoliday');
    let late = getVal('psLate');
    let sss = getVal('psSSS');
    let phil = getVal('psPhil');
    let pagibig = getVal('psPagibig');
    let advance = getVal('psAdvance');
    let loans = getVal('psLoans');
    let foods = getVal('psFoods');
    let wifi = getVal('psWifi');

    let gross = basic + overtime + holiday;
    let deductions = late + sss + phil + pagibig + advance + loans + foods + wifi;
    let net = gross - deductions;

    // 🔥 FIX: Targets 'psGross' specifically to match your native HTML
    safeSetText('psGross', gross.toLocaleString(undefined, {minimumFractionDigits: 2}));
    safeSetText('psTotalDeduct', deductions.toLocaleString(undefined, {minimumFractionDigits: 2}));
    safeSetText('psNetPay', net.toLocaleString(undefined, {minimumFractionDigits: 2}));
};

// ========================================================
// 💸 ABSOLUTE OVERRIDE: SMART PAYSLIP ENGINE
// ========================================================
window.finalizePayslip = async function() {
    let data = window.currentPayslipData;
    if (!data) return;
    
    // Grab the final net pay from the UI
    let netPayStr = document.getElementById('psNetPay').innerText.replace(/,/g, '');
    let finalNetPay = parseFloat(netPayStr) || 0;

    // 🔥 GRAB THE EXACT NUMBERS TYPED IN THE OVERRIDE BOXES
    let actualLoanDeducted = parseFloat(document.getElementById('psLoans').value) || 0;
    let actualValeDeducted = parseFloat(document.getElementById('psAdvance').value) || 0;
    let actualFoodDeducted = parseFloat(document.getElementById('psFoods').value) || 0;

    if (!window.liveAccounts || window.liveAccounts.length === 0) {
        if(typeof window.loadAccountsAndBudget === 'function') await window.loadAccountsAndBudget();
    }

    let accList = window.liveAccounts.map((a, i) => `[${i}] ${a.name} (Bal: ₱${a.balance.toLocaleString()})`).join('\n');
    let accIdx = prompt(`DISBURSE PAYROLL\nNet Pay: ₱${finalNetPay.toLocaleString()}\n\nSelect Account to deduct this payment from (Enter Number):\n\n${accList}`);

    if (accIdx === null || accIdx === "") return; // Cancelled
    let selAcc = window.liveAccounts[parseInt(accIdx)];
    if (!selAcc) { alert("❌ Invalid account selected."); return; }

    if (selAcc.balance < finalNetPay) {
        if(!confirm(`⚠️ WARNING: ${selAcc.name} only has ₱${selAcc.balance.toLocaleString()}. Deducting this will make it negative. Continue?`)) return;
    }

    let btn = document.getElementById('btnFinalizePayslip');
    btn.innerText = "⏳ Processing..."; btn.disabled = true;
    
    try {
        // 1. Deduct money from Selected Cash Account
        await updateDoc(doc(db, "cash_accounts", selAcc.id), { balance: selAcc.balance - finalNetPay });

        // 2. Log it as an official Expense in your dashboard feed
        await addDoc(collection(db, "expenses"), {
            branch: data.branch, amount: finalNetPay, category: "Payroll",
            account: selAcc.name, note: `Payslip for ${data.name} (${data.start} to ${data.end})`, timestamp: serverTimestamp()
        });

        // 3. Deduct exactly what you typed for the LOAN in the ledger
        if (actualLoanDeducted > 0 && data.ledgerId) {
            const ledgerRef = doc(db, "staff_ledger", data.ledgerId);
            const ledgerSnap = await getDoc(ledgerRef);
            if (ledgerSnap.exists()) {
                let currentPaid = ledgerSnap.data().totalPaid || 0;
                await updateDoc(ledgerRef, { totalPaid: currentPaid + actualLoanDeducted });
            }
        }
        
        // 4. 🔥 SMART VALE & MEAL CLEARER (INDEX-FREE PARTIAL PAYMENTS)
        let remainingValeToClear = actualValeDeducted;
        let remainingFoodToClear = actualFoodDeducted;

        if (remainingValeToClear > 0 || remainingFoodToClear > 0) {
            const deductQ = query(collection(db, "staff_deductions"), where("staffName", "==", data.name));
            const deductSnap = await getDocs(deductQ);
            
            let pendingDeductions = [];
            deductSnap.forEach(d => {
                if (d.data().status === "Unpaid") pendingDeductions.push({ id: d.id, ...d.data() });
            });

            // Sort oldest first so we pay off old debts first!
            pendingDeductions.sort((a, b) => (a.dateAdded?.toDate() || 0) - (b.dateAdded?.toDate() || 0));

            for (let dData of pendingDeductions) {
                let dAmt = parseFloat(dData.amount) || 0;
                let dRef = doc(db, "staff_deductions", dData.id);

                if (dData.type === "Cash Advance" && remainingValeToClear > 0) {
                    if (remainingValeToClear >= dAmt) {
                        await updateDoc(dRef, { status: "Paid", paidAt: serverTimestamp() });
                        remainingValeToClear -= dAmt;
                    } else {
                        await updateDoc(dRef, { amount: dAmt - remainingValeToClear });
                        remainingValeToClear = 0; // Partial payment applied!
                    }
                }
                else if (dData.type === "Staff Meal" && remainingFoodToClear > 0) {
                    if (remainingFoodToClear >= dAmt) {
                        await updateDoc(dRef, { status: "Paid", paidAt: serverTimestamp() });
                        remainingFoodToClear -= dAmt;
                    } else {
                        await updateDoc(dRef, { amount: dAmt - remainingFoodToClear });
                        remainingFoodToClear = 0; // Partial payment applied!
                    }
                }
            }
        }

        // 5. 🔥 FREEZE THE PAYSLIP DATA WITH YOUR EDITED NUMBERS 🔥
        data.isPaid = true; 
        data.loans = actualLoanDeducted;
        data.advances = actualValeDeducted;
        data.meals = actualFoodDeducted;
        
        await addDoc(collection(db, "payroll_records"), {
            staffName: data.name, startDate: data.start, endDate: data.end,
            frozenData: data, finalNetPay: finalNetPay, processedAt: serverTimestamp()
        });

        alert(`✅ Payroll Disbursed! ₱${finalNetPay.toLocaleString()} was deducted from ${selAcc.name}.\nAll Vales and Loans have been accurately updated.`);
        
        if (btn) {
            btn.innerText = "✅ Paid & Done!";
            btn.style.background = "#16a34a";
            btn.style.cursor = "not-allowed";
            btn.disabled = true;
        }
        
        document.getElementById('payslipModal').style.display = 'none';
        window.downloadPayslipImage();
        
        window.loadLedger(); 
        window.generateAutoPayslips(); 
        window.loadAccountsAndBudget();
    } catch (e) {
        console.error(e); alert("❌ Failed to finalize payslip.");
        if (btn) { btn.innerText = "✅ Mark Paid & Auto-Deduct"; btn.disabled = false; }
    } 
};

// ==========================================
// 📸 PAYSLIP IMAGE DOWNLOADER
// ==========================================
window.downloadPayslipImage = function() {
    const payslipElement = document.getElementById('printablePayslip');
    const btn = document.getElementById('btnDownloadPayslip');
    let originalText = btn.innerText;
    
    btn.innerText = "⏳ Generating Image...";
    btn.disabled = true;

    // Use html2canvas to take a high-quality screenshot of the div
    html2canvas(payslipElement, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
        let imgData = canvas.toDataURL("image/png");
        let link = document.createElement('a');
        
        // Name the file beautifully: "Payslip_Dianne_2026-05-15.png"
        let staffName = document.getElementById('psName').innerText.replace(/\s+/g, '_');
        let endDate = document.getElementById('psEnd').innerText;
        link.download = `Payslip_${staffName}_${endDate}.png`;
        
        link.href = imgData;
        link.click();

        btn.innerText = originalText;
        btn.disabled = false;
    }).catch(err => {
        console.error("Error generating image:", err);
        alert("❌ Failed to generate image. Please try again.");
        btn.innerText = originalText;
        btn.disabled = false;
    });
};

// ==========================================
// 📘 STAFF LOANS & LEDGER ENGINE (WITH AUTO-DEDUCT)
// ==========================================
window.loadLedger = async function() {
    const tbody = document.getElementById('ledgerTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">⏳ Calculating running balances...</td></tr>';

    try {
        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        
        const deductSnap = await getDocs(query(collection(db, "staff_deductions"), where("status", "==", "Unpaid")));
        let valesData = {};
        deductSnap.forEach(doc => {
            let d = doc.data();
            if (!valesData[d.staffName]) valesData[d.staffName] = 0;
            valesData[d.staffName] += (parseFloat(d.amount) || 0);
        });

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
            let unpaidVales = valesData[name] || 0;

            let balColor = balance > 0 ? 'var(--danger)' : 'var(--text-muted)';
            let balWeight = balance > 0 ? 'bold' : 'normal';
            let valeColor = unpaidVales > 0 ? '#ea580c' : 'var(--text-muted)';

            // 🔥 THE FIX: Passed docSnap.id into adjustStaffLoan so Firebase knows exactly which profile to update!
            html += `
                <tr>
                    <td><strong style="color: var(--primary);">👤 ${name}</strong></td>
                    <td><span class="badge badge-closed">${staff.branch}</span></td>
                    <td style="font-weight: bold; color: #0284c7;">₱${record.totalLoaned.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: bold; color: #16a34a;">₱${record.totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: ${balWeight}; color: ${balColor}; font-size: 15px;">₱${balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: bold; color: ${valeColor};">₱${unpaidVales.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="font-weight: bold; color: #8b5cf6;">₱${cutoffDed.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td>
                        <button class="btn-refresh" style="background: #f3e8ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 12px; border-radius: 4px; font-size: 11px; margin-right: 5px; font-weight: bold;" onclick="window.setAutoDeduct('${record.id}', '${name}', ${cutoffDed}, ${balance})">⚙️ Set Deduct</button>
                        <button style="background: #f8fafc; border: 1px solid #cbd5e1; color: #475569; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;" onclick="window.adjustStaffLoan('${docSnap.id}', '${name}', ${record.totalLoaned || 0}, ${record.totalPaid || 0})">✏️ Adjust</button>
                        <button class="btn-refresh" style="background: #e0f2fe; color: #0284c7; border: 1px solid #0284c7; padding: 6px 12px; border-radius: 4px; font-size: 11px; margin-right: 5px; font-weight: bold;" onclick="window.viewLedgerHistory('${name}')">📜 History</button>
                        <button class="btn-refresh" style="background: #fef3c7; color: #d97706; border: 1px solid #d97706; padding: 6px 12px; border-radius: 4px; font-size: 11px; margin-right: 5px; font-weight: bold;" onclick="window.issueLoan('${record.id}', '${name}', ${record.totalLoaned})">➕ Loan</button>
                        <button class="btn-refresh" style="background: #dcfce7; color: #15803d; border: 1px solid #15803d; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold;" onclick="window.logLoanPayment('${record.id}', '${name}', ${record.totalPaid}, ${balance}, ${unpaidVales})">💸 Pay</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="8" class="text-center">No staff found.</td></tr>';

    } catch (e) {
        console.error("Ledger Error:", e);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: red;">Error loading ledger.</td></tr>';
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

window.logLoanPayment = async function(docId, staffName, currentPaid, currentBalance, unpaidVales) {
    // 1. Check if they owe ANYTHING at all
    if (currentBalance <= 0 && unpaidVales <= 0) { 
        alert("✅ This employee has no outstanding balance or unpaid vales."); 
        return; 
    }

    // 2. Build a clear prompt showing exactly what they owe
    let totalOwed = currentBalance + unpaidVales;
    let promptMsg = `${staffName} owes a total of ₱${totalOwed.toLocaleString()}.\n`;
    if (currentBalance > 0) promptMsg += `- Company Loan: ₱${currentBalance.toLocaleString()}\n`;
    if (unpaidVales > 0) promptMsg += `- Unpaid Vales/Meals: ₱${unpaidVales.toLocaleString()}\n`;
    promptMsg += `\nHow much cash did they hand you to pay this off? (₱)`;

    let amountStr = prompt(promptMsg);
    if (amountStr === null || amountStr.trim() === "") return;
    
    let amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return;
    if (amount > totalOwed) { 
        alert(`❌ They only owe ₱${totalOwed.toLocaleString()}. You cannot log a payment higher than what they owe.`); 
        return; 
    }

    let remainingPayment = amount;

    try {
        // 3. SMART LOGIC: Pay off Vales/Meals first (because they are short-term debts)
        if (unpaidVales > 0 && remainingPayment > 0) {
            const deductQ = query(collection(db, "staff_deductions"), where("staffName", "==", staffName), where("status", "==", "Unpaid"));
            const deductSnap = await getDocs(deductQ);
            
            let pending = [];
            deductSnap.forEach(d => pending.push({ id: d.id, ...d.data() }));
            
            // Sort oldest first so old debts die first!
            pending.sort((a, b) => (a.dateAdded?.toDate() || 0) - (b.dateAdded?.toDate() || 0));

            for (let dData of pending) {
                if (remainingPayment <= 0) break;
                
                let dAmt = parseFloat(dData.amount) || 0;
                let dRef = doc(db, "staff_deductions", dData.id);

                if (remainingPayment >= dAmt) {
                    await updateDoc(dRef, { status: "Paid", paidAt: serverTimestamp() });
                    remainingPayment -= dAmt;
                } else {
                    // Partial Payment!
                    await updateDoc(dRef, { amount: dAmt - remainingPayment });
                    remainingPayment = 0; 
                }
            }
        }

        // 4. SMART LOGIC: If there's money left over, apply it to the Long-Term Company Loan!
        if (currentBalance > 0 && remainingPayment > 0) {
            if (docId && docId !== 'undefined') {
                await updateDoc(doc(db, "staff_ledger", docId), { totalPaid: currentPaid + remainingPayment });
            }
        }

        alert(`✅ Payment of ₱${amount.toLocaleString()} successfully logged for ${staffName}!`);
        window.loadLedger();
    } catch (e) { 
        console.error(e); 
        alert("❌ Failed to log manual payment. Check console."); 
    }
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

// 2. The Master Pairing Engine (UPGRADED WITH STRICT LEDGER MATH)
window.generateAutoPayslips = async function() {
    let startInput = document.getElementById('payrollStart').value;
    let endInput = document.getElementById('payrollEnd').value;
    let tableBody = document.getElementById('payrollGeneratorBody'); 

    if (!tableBody) return;
    if (!startInput || !endInput) {
        alert("Please select both Cutoff Start and End dates."); return;
    }

    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; font-weight:bold; color: #d97706;">⚙️ Crunching Payroll Data & Ledgers...</td></tr>`;

    let sParts = startInput.split('-');
    let eParts = endInput.split('-');

    let trueStartDate = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0);
    let trueEndDate = new Date(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999);

    let fetchEndDate = new Date(trueEndDate);
    fetchEndDate.setHours(fetchEndDate.getHours() + 12);

    try {
        const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
        let holidaysObj = schedSnap.exists() ? (schedSnap.data().holidays || {}) : {};

        const prQ = query(collection(db, "payroll_records"), where("startDate", "==", startInput), where("endDate", "==", endInput));
        const prSnap = await getDocs(prQ);
        let paidRecords = {};
        prSnap.forEach(docSnap => { 
            let d = docSnap.data(); 
            paidRecords[d.staffName] = d.frozenData; 
        });

        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        
        let staffDict = {};
        staffSnap.forEach(docSnap => { staffDict[docSnap.data().cashierName] = docSnap.data(); });
        
        let ledgerDict = {};
        ledgerSnap.forEach(docSnap => { ledgerDict[docSnap.data().staffName] = { id: docSnap.id, ...docSnap.data() }; });

        const attQ = query(collection(db, "attendance_logs"), 
            where("timestamp", ">=", trueStartDate), where("timestamp", "<=", fetchEndDate), orderBy("timestamp", "asc")
        );
        const attSnap = await getDocs(attQ);

        // 🔥 THE FIX: Completely ignore "staff_requests", only read the verified Unpaid Ledger!
        const deductQ = query(collection(db, "staff_deductions"), where("status", "==", "Unpaid"));
        const deductSnap = await getDocs(deductQ);
        const bonusQ = query(collection(db, "staff_bonuses"), where("dateAdded", ">=", trueStartDate), where("dateAdded", "<=", fetchEndDate));
        const bonusSnap = await getDocs(bonusQ);

        let staffData = {}; 
        let activeShifts = {}; 

        attSnap.forEach(docSnap => {
            let log = docSnap.data();
            let name = log.staffName;
            
            if (!staffData[name]) {
                staffData[name] = { 
                    branch: log.branch, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, holidayPayTotal: 0,
                    foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, logs: [] 
                };
            }

            if (log.type === "TIME IN") {
                if (log.timestamp.toDate() <= trueEndDate) {
                    // 🔥 THE FIX: Did they forget to time out of their last shift or misclick?
                    if (activeShifts[name]) {
                        let missedIn = activeShifts[name];
                        staffData[name].logs.push({
                            date: missedIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
                            in: missedIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                            out: "MISSED",
                            hrs: "0.00",
                            remark: `<span style="color:#ef4444; font-weight:bold;">Missed Time Out (Misclick)</span>`
                        });
                    }
                    activeShifts[name] = log.timestamp.toDate();
                }
            } else if (log.type === "TIME OUT" && activeShifts[name]) {
                let timeIn = activeShifts[name];
                let timeOut = log.timestamp.toDate();
                
                let hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                
                // 🔥 THE FIX: 16+ Hour Invalid Shift Blocker
                if (hoursWorked > 16) {
                    staffData[name].logs.push({
                        date: timeIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
                        in: timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                        out: timeOut.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                        hrs: hoursWorked.toFixed(2),
                        remark: `<span style="color:#ef4444; font-weight:bold;">INVALID (${hoursWorked.toFixed(1)}h) - Use Manual Log</span>`
                    });
                    delete activeShifts[name];
                    return; // Skip adding this to payroll totals!
                }

                let remark = `<span style="color:#10b981; font-weight:bold;">Complete</span>`;
                let shiftMultiplier = 1;

                if (hoursWorked >= 13.5) {
                    shiftMultiplier = 2;
                    remark = `<span style="color:#8b5cf6; font-weight:bold;">Straight Duty (2 Shifts)</span>`;
                } else if (hoursWorked < 8) {
                    let missingHours = (8 - hoursWorked).toFixed(1);
                    remark = `<span style="color:#ef4444; font-weight:bold;">Short (${missingHours}h)</span>`;
                }

                // 1. Calculate Night Diff FIRST
                let outHour = timeOut.getHours();
                let isNightEligible = staffDict[name] ? (staffDict[name].eligibleNightDiff !== false) : true;
                let thisShiftNightBonus = 0;

                if (outHour >= 0 && outHour <= 4) {
                    staffData[name].nightShifts += 1;
                    // Strict Lock: Only grant the ₱50 if their profile allows it!
                    if (isNightEligible) {
                        thisShiftNightBonus = 50;
                        staffData[name].nightBonusTotal += thisShiftNightBonus; 
                    }
                }

                // 2. Calculate Holiday Pay SECOND (Including Night Diff in the base math!)
                let logDateStr = `${timeIn.getFullYear()}-${String(timeIn.getMonth()+1).padStart(2,'0')}-${String(timeIn.getDate()).padStart(2,'0')}`;
                let hType = holidaysObj[logDateStr];
                let dailyRate = staffDict[name] ? (staffDict[name].hourlyRate || 0) : 0;
                let hBonus = 0;

                // The Magic Formula: (Daily Rate * Shifts) + Night Bonus
                let baseForHoliday = (dailyRate * shiftMultiplier) + thisShiftNightBonus;

                if (hType === 'Regular') {
                    hBonus = baseForHoliday * 0.50; 
                    remark += ` <span style="color:#ea580c; font-weight:bold;">(Reg Holiday: +₱${hBonus.toFixed(2)})</span>`;
                } else if (hType === 'Special') {
                    hBonus = baseForHoliday * 0.10; 
                    remark += ` <span style="color:#ea580c; font-weight:bold;">(Spl Holiday: +₱${hBonus.toFixed(2)})</span>`;
                }

                staffData[name].logs.push({
                    date: timeIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
                    in: timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                    out: timeOut.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
                    hrs: hoursWorked.toFixed(2),
                    remark: remark
                });

                staffData[name].totalHours += hoursWorked;
                staffData[name].shiftsWorked += shiftMultiplier; 
                staffData[name].holidayPayTotal += hBonus;

                delete activeShifts[name];
            }
        });

        // 🔥 THE FIX: Inject Unpaid Ledger Values safely
        deductSnap.forEach(docSnap => {
            let deduct = docSnap.data();
            let name = deduct.staffName;

            // Strict Filter: Ignore vales taken AFTER this cutoff date!
            let dDate = deduct.dateAdded ? deduct.dateAdded.toDate() : new Date();
            if (dDate > trueEndDate) return;

            if (!staffData[name]) {
                let branchName = staffDict[name] ? staffDict[name].branch : "Unknown";
                staffData[name] = { branch: branchName, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, holidayPayTotal: 0, foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, logs: [] };
            }

            let amt = parseFloat(deduct.amount) || 0;
            if (deduct.type === "Staff Meal") staffData[name].foodDeductions += amt;
            else if (deduct.type === "Cash Advance") staffData[name].cashAdvances += amt;
        });

        // 🔥 INJECT MANUAL OVERTIME BONUSES
        bonusSnap.forEach(docSnap => {
            let b = docSnap.data();
            let name = b.staffName;
            
            // If they didn't have any shifts, create an empty profile for them
            if (!staffData[name]) {
                let branchName = staffDict[name] ? staffDict[name].branch : "Unknown";
                staffData[name] = { branch: branchName, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, holidayPayTotal: 0, foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, logs: [] };
            }
            
            let amt = parseFloat(b.amount) || 0;
            // Pushes the money into the Overtime / Night Diff box!
            staffData[name].nightBonusTotal += amt; 
            
            // Creates a beautiful visual log at the bottom of their Payslip so they know they got it!
            let bDate = b.dateAdded ? b.dateAdded.toDate() : new Date();
            staffData[name].logs.push({
                date: bDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
                in: "---",
                out: "---",
                hrs: "0.00",
                remark: `<span style="color:#ea580c; font-weight:bold;">+₱${amt.toFixed(2)} (Manual OT: ${b.remarks || 'Bonus'})</span>`
            });
        });
      
        let html = '';
        let allStaffNames = new Set([...Object.keys(staffData), ...Object.keys(paidRecords)]);

        if (allStaffNames.size === 0) {
            html = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #64748b;">No shifts or deductions found for this cutoff.</td></tr>`;
        } else {
            for (let name of allStaffNames) {
                let d;
                let isPaid = false;

                if (paidRecords[name]) {
                    d = paidRecords[name];
                    isPaid = true;
                    window.globalPayrollCache[name] = d; 
                } else {
                    d = staffData[name];
                    let profile = staffDict[name] || {};
                    let dailyRate = profile.hourlyRate || 0; 
                    
                    d.basicPay = d.shiftsWorked * dailyRate;

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

                    window.globalPayrollCache[name] = {
                        name: name, branch: d.branch, hours: d.totalHours, nightBonus: d.nightBonusTotal, holidayPayTotal: d.holidayPayTotal,
                        advances: d.cashAdvances, meals: d.foodDeductions, loans: d.loans, ledgerId: d.ledgerId,
                        sss: d.sss, pagibig: d.pagibig, philhealth: d.philhealth, lateDeduction: d.lateDeduction,
                        shiftsWorked: d.shiftsWorked, basicPay: d.basicPay, rate: dailyRate,
                        start: startInput, end: endInput, profile: profile, logs: d.logs, isPaid: false
                    };
                    d = window.globalPayrollCache[name]; 
                }

                let totalDeduct = (d.meals || 0) + (d.advances || 0) + (d.loans || 0) + (d.sss || 0) + (d.pagibig || 0) + (d.philhealth || 0) + (d.lateDeduction || 0);

                let bonusLabel = d.nightBonus > 0 ? `<br><span style="font-size:11px; color:#f59e0b; font-weight:bold;">+₱${d.nightBonus} Night Bonus</span>` : '';
                let holLabel = d.holidayPayTotal > 0 ? `<br><span style="font-size:11px; color:#ea580c; font-weight:bold;">+₱${d.holidayPayTotal.toFixed(2)} Holiday Pay</span>` : '';
                let foodLabel = d.meals > 0 ? `<br><span style="font-size:11px; color:#ef4444;">-₱${d.meals.toFixed(2)} (Meals)</span>` : '';
                let valeLabel = d.advances > 0 ? `<br><span style="font-size:11px; color:#ef4444;">-₱${d.advances.toFixed(2)} (Vale)</span>` : '';
                let loanLabel = d.loans > 0 ? `<br><span style="font-size:11px; color:#ef4444; font-weight:bold;">-₱${d.loans.toFixed(2)} (Ledger)</span>` : '';
                let lateLabel = d.lateDeduction > 0 ? `<br><span style="font-size:11px; color:#ef4444; font-weight:bold;">-₱${d.lateDeduction.toFixed(2)} (Late)</span>` : '';
                let govTotal = (d.sss || 0) + (d.pagibig || 0) + (d.philhealth || 0);
                let govLabel = govTotal > 0 ? `<br><span style="font-size:11px; color:#64748b;">-₱${govTotal.toFixed(2)} (Gov)</span>` : '';

                let buttonHtml = isPaid 
                    ? `<button onclick="window.openPayslipModal('${name}')" style="background:#475569; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size: 12px; font-weight: bold; width: 100%;">✅ View Paid Payslip</button>`
                    : `<button onclick="window.openPayslipModal('${name}')" style="background:#047857; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size: 12px; font-weight: bold; width: 100%;">🧾 Generate Payslip</button>`;

                let rowStyle = isPaid ? "background: #f8fafc; opacity: 0.85;" : "";

                html += `
                    <tr style="border-bottom: 1px dashed #e2e8f0; ${rowStyle}">
                        <td style="padding: 12px; font-weight: bold; color: #1e293b;">${name}</td>
                        <td style="padding: 12px; color: #64748b;">${d.branch}</td>
                        <td style="padding: 12px; font-weight: bold;">${(d.hours || 0).toFixed(2)} hrs ${bonusLabel} ${holLabel}</td>
                        <td style="padding: 12px; font-weight: bold;">
                            Total: ₱${totalDeduct.toFixed(2)}
                            ${foodLabel} ${valeLabel} ${loanLabel} ${lateLabel} ${govLabel}
                        </td>
                        <td style="padding: 12px;">
                            ${buttonHtml}
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

window.openPayslipModal = async function(staffName) {
    let data = window.globalPayrollCache[staffName];
    if (!data) return;

    window.currentPayslipData = data; 
    
    let finalizeBtn = document.getElementById('btnFinalizePayslip');
    if (finalizeBtn) {
        if (data.isPaid) {
            finalizeBtn.innerText = "✅ Paid & Done!";
            finalizeBtn.disabled = true;
            finalizeBtn.style.background = "#16a34a"; 
            finalizeBtn.style.cursor = "not-allowed";
        } else {
            finalizeBtn.innerText = "✅ Mark Paid & Auto-Deduct";
            finalizeBtn.disabled = false;
            finalizeBtn.style.background = "#3b82f6"; 
            finalizeBtn.style.cursor = "pointer";
        }
    }

    // 🛡️ CRASH-PROOF ENGINE: Safely ignores missing HTML IDs
    const safeSetText = (id, val) => { let el = document.getElementById(id); if (el) el.innerText = val; };
    const safeSetVal = (id, val) => { let el = document.getElementById(id); if (el) el.value = val; };

    safeSetText('psName', data.name || "Unknown");
    safeSetText('psBranch', data.branch || "Unassigned");
    safeSetText('psStart', data.start || "");
    safeSetText('psEnd', data.end || "");
    safeSetText('psBasicPay', (data.basicPay || 0).toLocaleString(undefined, {minimumFractionDigits: 2}));
    
    // 🔥 NEW HR DATA
    safeSetText('psDaysWorked', data.shiftsWorked || 0);
    safeSetText('psDateHired', (data.profile && data.profile.dateHired) ? data.profile.dateHired : "---");
    
    let today = new Date();
    safeSetText('psPayDistributed', today.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }));

    safeSetVal('psOvertime', data.nightBonus || 0);
    safeSetVal('psHoliday', data.holidayPayTotal || 0);
    safeSetVal('psLate', data.lateDeduction || 0);
    safeSetVal('psSSS', data.sss || 0);
    safeSetVal('psPhil', data.philhealth || 0);
    safeSetVal('psPagibig', data.pagibig || 0);
    
    // 🔥 THE FIX: Explicitly route the separated deduction types!
    safeSetVal('psAdvance', data.advances || 0);
    safeSetVal('psLoans', data.loans || 0);
    safeSetVal('psFoods', data.meals || 0);
    
    let wifiBox = document.getElementById('psWifi');
    if(wifiBox) wifiBox.value = 0;

    let attHtml = '';
    if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
            attHtml += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px;">${log.date}</td>
                <td style="padding: 8px; font-weight: bold; color: #16a34a;">${log.in}</td>
                <td style="padding: 8px; font-weight: bold; color: #dc2626;">${log.out}</td>
                <td style="padding: 8px; font-weight: bold;">${log.hrs}h</td>
                <td style="padding: 8px; font-size:11px;">${log.remark}</td>
            </tr>`;
        });
    } else {
        attHtml = '<tr><td colspan="5" style="text-align:center; padding: 15px; color: #94a3b8;">No attendance logs found.</td></tr>';
    }
    let attBody = document.getElementById('psAttendanceBody');
    if (attBody) attBody.innerHTML = attHtml;

    if (typeof window.recalcPayslip === 'function') window.recalcPayslip();
    document.getElementById('payslipModal').style.display = 'flex';
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
window.loadCashFlowHub = async function() {
    try {
        let safeCash = 0;
        const accSnap = await getDocs(collection(db, "cash_accounts"));
        accSnap.forEach(doc => { safeCash += (doc.data().balance || 0); });

        let branchFloating = {};
        if (window.globalActiveBranches) {
            window.globalActiveBranches.forEach(b => { if (b !== "Main Office") branchFloating[b] = 0; });
        }
        let pendingVerifications = 0;
        let totalFloating = 0;

        const shiftSnap = await getDocs(query(collection(db, "shifts"), where("status", "==", "Closed")));
        shiftSnap.forEach(doc => {
            let data = doc.data();
            let branch = data.branch;
            
            // 🔥 NEW: Only track the PHYSICAL cash they took out of the drawer to remit!
            // (What they counted) MINUS (What they left in the drawer for tomorrow)
            let physicalCashToRemit = (data.declaredCash || 0) - (data.startingCash || 0);
            
            if (physicalCashToRemit > 0 && branchFloating[branch] !== undefined) {
                branchFloating[branch] += physicalCashToRemit;
            }
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
    const tbody = document.getElementById('payablesTableBody'); if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Scanning payables...</td></tr>';
    try {
        const q = query(collection(db, "payables"), where("status", "==", "Unpaid"), orderBy("dueDate", "asc"));
        const snap = await getDocs(q);

        let html = ''; let totalUnpaid = 0; let overdueCount = 0; let dueSoonCount = 0;
        let now = new Date(); now.setHours(0,0,0,0);

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let amount = parseFloat(data.amount) || 0; totalUnpaid += amount;
            let deliveryDate = data.deliveryDate ? data.deliveryDate.toDate() : new Date();
            let dueDate = data.dueDate ? data.dueDate.toDate() : new Date();
            
            let diffTime = dueDate.getTime() - now.getTime(); let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            let statusHtml = ''; let dateColor = '#334155';

            if (diffDays < 0) { overdueCount++; statusHtml = `<span style="background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⚠️ OVERDUE</span>`; dateColor = '#dc2626'; } 
            else if (diffDays === 0) { dueSoonCount++; statusHtml = `<span style="background: #fef3c7; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🚨 DUE TODAY</span>`; dateColor = '#d97706'; } 
            else if (diffDays <= 7) { dueSoonCount++; statusHtml = `<span style="background: #fef9c3; color: #ca8a04; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Due in ${diffDays} Days</span>`; } 
            else { statusHtml = `<span style="background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">Safe (${diffDays} Days)</span>`; }

            let itemsHtml = '';
            if (data.linkedItems && data.linkedItems.length > 0) {
                itemsHtml = `<div style="margin-top: 6px; padding: 6px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; font-size: 11px; color: #475569;">`;
                data.linkedItems.forEach(i => { itemsHtml += `📦 <strong>${i.purchQty} ${i.purchUom}</strong> ${i.name}<br>`; });
                itemsHtml += `</div>`;
            } else if (data.hasLinkedItems) {
                // THE FIX: Clean gray text!
                itemsHtml = `<div style="margin-top: 6px; font-size: 11px; color: #64748b; font-style: italic;">📦 General Restock (No itemized list)</div>`;
            }

            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td><strong style="color: var(--primary); font-size: 15px;">${data.supplier}</strong>${itemsHtml}</td>
                    <td style="font-family: monospace; color: #64748b;">${data.invoiceNum || 'N/A'}</td>
                    <td style="font-size: 13px;">${deliveryDate.toLocaleDateString()}</td>
                    <td style="font-weight: bold; color: ${dateColor};">${dueDate.toLocaleDateString()}</td>
                    <td style="font-weight: bold; font-size: 15px; color: #1e293b;">₱${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td>${statusHtml}</td>
                    <td><button onclick="window.openSettlePayable('${docSnap.id}', '${data.supplier}', ${amount}, '${data.invoiceNum}')" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">💸 Pay Now</button></td>
                </tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="color: #64748b; padding: 30px;">All payables are cleared! No outstanding debts.</td></tr>';
        document.getElementById('payTotalUnpaid').innerText = `₱${totalUnpaid.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('payTotalOverdue').innerText = overdueCount;
        document.getElementById('payDueSoon').innerText = dueSoonCount;
    } catch (e) { console.error("Payables Error:", e); tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: red;">Error fetching payables.</td></tr>'; }
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

window.openAddPayableModal = async function() {
    document.getElementById('addPayableModal').style.display = 'flex';
    document.getElementById('paySupplierName').value = '';
    document.getElementById('payInvoiceNum').value = '';
    document.getElementById('payAmount').value = '';
    window.payableItemsCart = [];
    window.renderPayableItems();

    let itemInput = document.getElementById('payItemSelect');
    
    // Transform select into a datalist search
    if (itemInput.tagName === 'SELECT') {
        let newInput = document.createElement('input');
        newInput.id = 'payItemSelect';
        newInput.setAttribute('list', 'payableDatalist');
        newInput.placeholder = "Type to search Main Office item...";
        newInput.style.cssText = "flex: 1; min-width: 0; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; outline: none; box-sizing: border-box;";
        itemInput.parentNode.replaceChild(newInput, itemInput);
        itemInput = newInput;
    }
    itemInput.value = '';

    try {
        const q = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
        const snap = await getDocs(q);
        
        window.payableInventoryOptions = [];
        let datalistHtml = '<datalist id="payableDatalist">';
        
        snap.forEach(docSnap => {
            let data = docSnap.data();
            window.payableInventoryOptions.push({ id: docSnap.id, ...data });
            datalistHtml += `<option value="${data.name}">${data.name} (${data.purchaseUom || data.uom})</option>`;
        });
        datalistHtml += '</datalist>';

        let existingList = document.getElementById('payableDatalist');
        if (existingList) existingList.remove();
        document.body.insertAdjacentHTML('beforeend', datalistHtml);
    } catch (e) { console.error(e); }
};

// 2. Adds Items to the Temporary Delivery Cart
window.addPayableItem = function() {
    let itemName = document.getElementById('payItemSelect').value;
    let qty = parseFloat(document.getElementById('payItemQty').value);
    if (!itemName || isNaN(qty) || qty <= 0) return;
    let itemData = window.payableInventoryOptions.find(i => i.name === itemName);
    if (!itemData) return;

    let convRate = parseFloat(itemData.conversionRate) || 1;
    let baseQtyToAdd = qty * convRate;

    window.payableItemsCart.push({
        id: itemData.id, name: itemData.name, purchQty: qty,
        purchUom: itemData.purchaseUom || itemData.uom, baseQtyToAdd: baseQtyToAdd, baseUom: itemData.uom
    });

    document.getElementById('payItemQty').value = ''; document.getElementById('payItemSelect').value = '';
    window.renderPayableItems();
};

window.removePayableItem = function(index) { window.payableItemsCart.splice(index, 1); window.renderPayableItems(); };

window.renderPayableItems = function() {
    let container = document.getElementById('payItemsList');
    if (window.payableItemsCart.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 10px; font-style: italic;">No physical items linked. This will just log the cash payable.</div>'; return;
    }
    let html = '';
    window.payableItemsCart.forEach((item, index) => {
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 5px; border-bottom: 1px dashed #cbd5e1; background: white; border-radius: 4px; margin-bottom: 4px;">
                <span><strong style="color: #0f766e;">${item.purchQty} ${item.purchUom}</strong> ${item.name} <br><span style="font-size:10px; color:#64748b;">(Adds +${item.baseQtyToAdd} ${item.baseUom} to stock)</span></span>
                <button onclick="window.removePayableItem(${index})" style="color: #ef4444; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-weight: bold;">✖</button>
            </div>`;
    });
    container.innerHTML = html;
};

// 3. The Grand Double-Save (Updates Payables AND Live Inventory)
window.saveNewPayable = async function() {
    let pendingItem = document.getElementById('payItemSelect').value;
    if (pendingItem && document.getElementById('payItemQty').value) window.addPayableItem(); 

    let supplier = document.getElementById('paySupplierName').value.trim();
    let invoice = document.getElementById('payInvoiceNum').value.trim();
    let amount = parseFloat(document.getElementById('payAmount').value);
    let terms = parseInt(document.getElementById('payTerms').value);

    if (!supplier || isNaN(amount) || amount <= 0) { alert("Please enter Supplier Name and a valid Amount."); return; }

    let btn = document.getElementById('btnSavePayable');
    btn.innerText = "⏳ Saving & Updating Inventory..."; btn.disabled = true;

    try {
        let deliveryDate = new Date(); let dueDate = new Date(); dueDate.setDate(deliveryDate.getDate() + terms);
        await addDoc(collection(db, "payables"), {
            supplier: supplier, invoiceNum: invoice, amount: amount, termsDays: terms, deliveryDate: deliveryDate, dueDate: dueDate, status: "Unpaid",
            hasLinkedItems: window.payableItemsCart.length > 0, linkedItems: window.payableItemsCart,
            loggedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager", timestamp: serverTimestamp()
        });

        if (window.payableItemsCart.length > 0) {
            for (let item of window.payableItemsCart) {
                let invRef = doc(db, "inventory", item.id);
                let invData = window.payableInventoryOptions.find(i => i.id === item.id);
                let currentStock = parseFloat(invData.currentStock) || 0;
                let newStock = currentStock + item.baseQtyToAdd;
                
                await updateDoc(invRef, { currentStock: newStock });
                await addDoc(collection(db, "stock_logs"), {
                    branch: "Main Office", item: item.name, uom: item.baseUom, oldQty: currentStock, newQty: newStock, variance: item.baseQtyToAdd,
                    type: "Supplier Delivery", note: `Linked to Invoice: ${invoice || 'N/A'}, Supplier: ${supplier}`,
                    user: window.sessionUser ? window.sessionUser.cashierName : "Manager", timestamp: new Date()
                });
            }
        }

        alert(`✅ Success! Invoice logged and inventory added to Main Office.`);
        document.getElementById('addPayableModal').style.display = 'none';
        window.loadPayablesDashboard();
        if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
    } catch (e) { alert(`❌ Failed to save. Error: ${e.message}`); } finally { btn.innerText = "💾 Log Delivery & Track Deadline"; btn.disabled = false; }
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
            
            // 🔥 STRICT FILTER: Only show Main Office accounts for paying suppliers!
            if (acc.branch === "Main Office") {
                html += `<option value="${docSnap.id}">${acc.name} - Bal: ₱${acc.balance.toLocaleString()}</option>`;
            }
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
    let fee = parseFloat(document.getElementById('settlePayFee').value) || 0; // 🔥 Grab the fee

    if (!accountId) { alert("Please select a Cash Account to deduct funds from."); return; }

    let totalDeduction = amount + fee; // 🔥 Total money leaving the bank
    let accData = window.livePayableAccounts[accountId];

    if (accData.balance < totalDeduction) {
        if(!confirm(`⚠️ WARNING: ${accData.name} only has ₱${accData.balance.toLocaleString()}.\nDeducting ₱${totalDeduction.toLocaleString()} (Invoice + Fee) will make it negative. Continue anyway?`)) return;
    }

    let btn = document.getElementById('btnConfirmSettle');
    btn.innerText = "⏳ Processing Payment..."; btn.disabled = true;

    try {
        // 1. Deduct Invoice + Fee from Cash Account
        await updateDoc(doc(db, "cash_accounts", accountId), {
            balance: accData.balance - totalDeduction
        });

        // 2. Mark Payable as Paid
        await updateDoc(doc(db, "payables", payId), {
            status: "Paid",
            datePaid: serverTimestamp(),
            paidFromAccount: accData.name,
            transactionFee: fee
        });

        // 3. Log the Invoice Payment
        await addDoc(collection(db, "expenses"), {
            branch: "Main Office", amount: amount, category: "Supplier Payment",
            account: accData.name, note: `Settled Invoice for ${supplier}`, timestamp: serverTimestamp()
        });

        // 4. 🔥 Log the Bank Fee Separately if it exists!
        if (fee > 0) {
            await addDoc(collection(db, "expenses"), {
                branch: "Main Office", amount: fee, category: "Bank Charges",
                account: accData.name, note: `Transfer Fee for ${supplier} payment`, timestamp: serverTimestamp()
            });
        }

        alert(`✅ Payment complete! ₱${totalDeduction.toLocaleString()} was deducted from ${accData.name}.`);
        document.getElementById('settlePayableModal').style.display = 'none';
        document.getElementById('settlePayFee').value = ''; // Reset fee
        
        window.loadPayablesDashboard();
        if (typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();
    } catch (e) {
        console.error("Error settling payment:", e); alert("Payment failed. Check connection.");
    } finally {
        btn.innerText = "✅ Confirm Payment"; btn.disabled = false;
    }
};

window.exportTransactionsCSV = async function() {
    let select = document.getElementById('histShiftSelect');
    
    if (!select || select.selectedIndex <= 0) { 
        alert("Please select a specific shift to export."); 
        return; 
    }

    let selectedOption = select.options[select.selectedIndex];
    let startOfDay = new Date(selectedOption.getAttribute('data-start'));
    let endOfDay = new Date(selectedOption.getAttribute('data-end'));
    let shiftBranch = selectedOption.getAttribute('data-branch');
    let safeName = selectedOption.innerText.replace(/[^a-zA-Z0-9]/g, '_'); // Makes a safe file name

    let btn = document.getElementById('btnExportSales') || document.querySelector('button[onclick*="exportTransactionsCSV"]');
    let oldText = btn ? btn.innerText : "Export Excel";
    if (btn) { btn.innerText = "⏳ Exporting..."; btn.disabled = true; }

    try {
        const q = query(collection(db, "transactions"), where("branch", "==", shiftBranch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
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
        let csvFile = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        let downloadLink = document.createElement("a");
        downloadLink.download = `Takodeal_Sales_${safeName}.csv`;
        downloadLink.href = window.URL.createObjectURL(csvFile);
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

    } catch (e) {
        console.error("Export Error:", e);
        alert("Failed to export sales data.");
    } finally {
        if (btn) { btn.innerText = oldText; btn.disabled = false; }
    }
};

// ========================================================
// 📈 PRODUCT OPTIMIZATION & ANALYTICS ENGINE
// ========================================================
window.loadProductAnalytics = async function(startOfDay, endOfDay, branchFilter) {
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

                // Tally Add-on COGS
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

window.openManualOvertimeModal = async function() {
    document.getElementById('manualOvertimeModal').style.display = 'flex';
    let select = document.getElementById('manOtStaff');
    select.innerHTML = '<option value="">Loading Staff...</option>';
    
    // Auto-set date to today
    let now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('manOtDate').value = now.toISOString().split('T')[0];
    
    document.getElementById('manOtAmount').value = '';
    document.getElementById('manOtRemarks').value = '';

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

window.submitManualOvertime = async function() {
    let staffName = document.getElementById('manOtStaff').value;
    let dateRaw = document.getElementById('manOtDate').value;
    let amount = parseFloat(document.getElementById('manOtAmount').value);
    let remarks = document.getElementById('manOtRemarks').value.trim();

    if (!staffName || !dateRaw || isNaN(amount) || amount <= 0 || !remarks) {
        alert("❌ Please fill out all fields correctly (Amount must be greater than 0).");
        return;
    }

    let btn = document.getElementById('btnSaveManualOt');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        // Set the date to midday so it safely falls within payroll cutoff ranges!
        let otDate = new Date(dateRaw + 'T12:00:00');

        await addDoc(collection(db, "staff_bonuses"), {
            staffName: staffName,
            amount: amount,
            dateAdded: otDate,
            type: "Overtime",
            remarks: remarks,
            loggedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp()
        });

        alert(`✅ Success! ₱${amount.toLocaleString()} Overtime Bonus added for ${staffName}.`);
        document.getElementById('manualOvertimeModal').style.display = 'none';
        
        alert("Reminder: If you are calculating payroll, click 'Generate List' again to apply this new bonus.");

    } catch (error) {
        console.error("OT Log Error:", error);
        alert("❌ Failed to save overtime bonus.");
    } finally {
        btn.innerText = "💾 Save Overtime Bonus"; btn.disabled = false;
    }
};

// ========================================================
// 📈 ADVANCED CHART.JS ANALYTICS ENGINE (BRANCH WARS)
// ========================================================
window.revenueChartInstance = null;
window.categoryChartInstance = null;

window.renderDashboardCharts = async function() {
    try {
        // 1. Setup Dates for the 7-Day Trend
        let today = new Date();
        today.setHours(23, 59, 59, 999);
        let sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 6); // Look back 6 days + today
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const txQ = query(collection(db, "transactions"), where("timestamp", ">=", sevenDaysAgo), where("timestamp", "<=", today));
        const txSnap = await getDocs(txQ);

        // 2. Setup Date Labels for the X-Axis
        let dateLabels = [];
        for(let i = 6; i >= 0; i--) {
            let d = new Date(today);
            d.setDate(today.getDate() - i);
            dateLabels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }
        let todayString = dateLabels[6]; // The last one in the array is today

        // --- DATA BUCKETS ---
        let branchDailyTrend = {}; // Tracks 7 days of sales per branch
        let todayBranchMix = {};   // Tracks today's pie chart split

        // 3. Crunch the numbers dynamically
        txSnap.forEach(doc => {
            let tx = doc.data();
            if (tx.status === "Voided") return;

            let txDate = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateLabel = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            let branch = tx.branch || "Unknown";

            // Calculate transaction gross
            let grossTx = 0;
            if (tx.cart) { 
                tx.cart.forEach(item => { grossTx += ((item.variantPrice || item.basePrice || 0) * (item.qty || 1)); }); 
            } else { 
                grossTx = tx.netTotal || 0; 
            }

            // A. Populate the Line Chart Data (Initialize the branch array with 7 zeros if it's new)
            if (!branchDailyTrend[branch]) {
                branchDailyTrend[branch] = [0, 0, 0, 0, 0, 0, 0]; 
            }
            let dayIndex = dateLabels.indexOf(dateLabel);
            if (dayIndex !== -1) {
                branchDailyTrend[branch][dayIndex] += grossTx;
            }

            // B. Populate the Doughnut Chart Data (Only if the transaction happened TODAY)
            if (dateLabel === todayString) {
                if (!todayBranchMix[branch]) todayBranchMix[branch] = 0;
                todayBranchMix[branch] += grossTx;
            }
        });

        // 🎨 Beautiful Auto-Assigned Colors for the Branches
        const themeColors = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#f43f5e', '#64748b'];

        // ==========================================
        // 📉 DRAW THE 7-DAY LINE CHART (BRANCH WARS)
        // ==========================================
        const revCtx = document.getElementById('revenueTrendChart');
        if (window.revenueChartInstance) window.revenueChartInstance.destroy(); // Prevent ghosting!

        let lineDatasets = [];
        let colorIndex = 0;
        
        for (let branch in branchDailyTrend) {
            let c = themeColors[colorIndex % themeColors.length];
            lineDatasets.push({
                label: branch,
                data: branchDailyTrend[branch],
                borderColor: c,
                backgroundColor: c, 
                borderWidth: 3,
                pointBackgroundColor: 'white',
                pointBorderColor: c,
                pointBorderWidth: 2,
                pointRadius: 4,
                fill: false,
                tension: 0.4 // Smooth curves
            });
            colorIndex++;
        }

        window.revenueChartInstance = new Chart(revCtx, {
            type: 'line',
            data: { labels: dateLabels, datasets: lineDatasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { 
                    legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, weight: 'bold' } } } 
                },
                scales: { 
                    y: { beginAtZero: true, grid: { color: '#f8fafc' } },
                    x: { grid: { display: false } }
                },
                interaction: { mode: 'index', intersect: false } // Shows tooltip for all branches on hover!
            }
        });

        // ==========================================
        // 🐙 Today's Branch Mix CHART (BY BRANCH)
        // ==========================================
        const catCtx = document.getElementById('categoryMixChart');
        if (window.categoryChartInstance) window.categoryChartInstance.destroy();

        let mixLabels = Object.keys(todayBranchMix);
        let mixData = Object.values(todayBranchMix);
        
        // Failsafe if there are no sales today
        let doughnutColors = themeColors.slice(0, mixLabels.length);
        if (mixLabels.length === 0) { 
            mixLabels = ["No Sales Yet"]; 
            mixData = [1]; 
            doughnutColors = ['#e2e8f0']; 
        }

        window.categoryChartInstance = new Chart(catCtx, {
            type: 'doughnut',
            data: {
                labels: mixLabels,
                datasets: [{
                    data: mixData,
                    backgroundColor: doughnutColors,
                    borderWidth: 2,
                    borderColor: 'white',
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '75%', // Sleek thin ring
                plugins: {
                    legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, weight: 'bold' } } }
                }
            }
        });

    } catch (e) {
        console.error("Chart Rendering Error:", e);
    }
};

// ==========================================
// 🧮 MODAL NET SALES RECALCULATOR
// ==========================================
window.recalcModalNetSales = function() {
    let checkboxes = document.querySelectorAll('.pay-toggle-chk');
    let newTotal = 0;
    
    checkboxes.forEach(chk => {
        if (chk.checked) {
            newTotal += parseFloat(chk.value) || 0;
        }
    });
    
    document.getElementById('bdNetSalesTotal').innerText = "₱" + newTotal.toLocaleString(undefined, {minimumFractionDigits: 2});
};

// ==========================================
// 🧾 DYNAMIC DIGITAL RECEIPT VIEWER
// ==========================================
window.viewReceiptDetails = function(receiptId, customer, time, payment, total, cartEncoded) {
    // 🔥 FIRST NAME EXTRACTOR
    let safeCashierName = "Cashier";
    try {
        let fullCashierName = window.globalShiftReports && Object.values(window.globalShiftReports).find(s => s.transactions && s.transactions.some(t => t.receiptId === receiptId))?.cashier || 'System';
        safeCashierName = fullCashierName.split(' ')[0]; // Grabs just the first name!
    } catch(e) {}
    let cart = JSON.parse(decodeURIComponent(cartEncoded));
    let itemsHtml = '';

    cart.forEach(item => {
        // 🔥 UPGRADE: Safely catch both POS (qty/variantPrice) AND Mobile App (quantity/price) data formats!
        let qty = item.qty || item.quantity || 1;
        let price = parseFloat(item.variantPrice || item.basePrice || item.price) || 0;
        
        let lineTotal = parseFloat(item.lineTotalFinal);
        if (isNaN(lineTotal)) lineTotal = (qty * price);
        
        // Unpack Add-ons if they exist
        let addonsHtml = '';
        if (item.addons) {
            for (let key in item.addons) {
                let addon = item.addons[key];
                if (addon.qty > 0) {
                    addonsHtml += `<div style="font-size: 11px; color: #64748b; margin-left: 10px;">+ ${addon.name} (₱${addon.price} x ${addon.qty})</div>`;
                }
            }
        }

        itemsHtml += `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding: 8px 0;">
                <div>
                    <strong style="color: #334155; font-size: 13px;">${qty}x ${item.name || item.itemName}</strong>
                    ${addonsHtml}
                </div>
                <strong style="color: #0f766e; font-size: 13px;">₱${lineTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
            </div>
        `;
    });

    const modalHtml = `
        <div id="dynamicReceiptModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 10001; backdrop-filter: blur(4px);">
            <div style="background: white; padding: 25px; border-radius: 12px; width: 400px; max-width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.5); max-height: 80vh; display: flex; flex-direction: column;">
                
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; margin-bottom: 15px;">
                    <div>
                        <h3 style="margin: 0; color: #0f172a; font-size: 18px;">🧾 Receipt Details</h3>
                        <div style="font-size: 11px; color: #64748b; margin-top: 4px; font-family: monospace;">${receiptId}</div>
                    </div>
                    <button onclick="document.getElementById('dynamicReceiptModal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8;">&times;</button>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <div>
                        <div style="font-size: 10px; color: #64748b; font-weight: bold; text-transform: uppercase;">Customer</div>
                        <div style="font-size: 13px; font-weight: bold; color: #0284c7;">${customer}</div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: #64748b; font-weight: bold; text-transform: uppercase;">Time & Payment</div>
                        <div style="font-size: 13px; font-weight: bold; color: #334155;">${time} • ${payment}</div>
                    </div>
                </div>

                <div style="flex: 1; overflow-y: auto; margin-bottom: 15px; padding-right: 5px;">
                    <div style="font-size: 11px; font-weight: bold; color: #94a3b8; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 5px;">ORDER ITEMS</div>
                    ${itemsHtml || '<i style="color: #94a3b8; font-size: 12px;">No items recorded.</i>'}
                </div>

                <div style="border-top: 2px dashed #cbd5e1; padding-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 14px; font-weight: bold; color: #334155;">TOTAL PAID</span>
                    <span style="font-size: 22px; font-weight: 900; color: #16a34a;">₱${total.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                </div>
                
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

// ==========================================
// 🧾 MASTER SALES HISTORY & FINANCIAL ENGINE (UPGRADED TABS)
// ==========================================
window.switchHistoryTab = function(tabName) {
    let txTab = document.getElementById('tabHistTx');
    let shiftsTab = document.getElementById('tabHistShifts'); // Added!
    let dailyTab = document.getElementById('tabHistDaily');
    let monthlyTab = document.getElementById('tabHistMonthly');
    let repTab = document.getElementById('tabHistReports');
    
    document.getElementById('histSecTx').style.display = 'none';
    document.getElementById('histSecShifts').style.display = 'none'; // Added!
    document.getElementById('histSecDaily').style.display = 'none';
    document.getElementById('histSecMonthly').style.display = 'none';
    document.getElementById('histSecReports').style.display = 'none';

    [txTab, shiftsTab, dailyTab, monthlyTab, repTab].forEach(t => { if(t) { t.style.color = '#64748b'; t.style.borderBottomColor = 'transparent'; }});

    if (tabName === 'Tx') {
        if(txTab) { txTab.style.color = '#0f766e'; txTab.style.borderBottomColor = '#0f766e'; }
        document.getElementById('histSecTx').style.display = 'block';
    } else if (tabName === 'Shifts') {
        if(shiftsTab) { shiftsTab.style.color = '#0f766e'; shiftsTab.style.borderBottomColor = '#0f766e'; }
        document.getElementById('histSecShifts').style.display = 'block';
    } else if (tabName === 'Daily') {
        if(dailyTab) { dailyTab.style.color = '#0f766e'; dailyTab.style.borderBottomColor = '#0f766e'; }
        document.getElementById('histSecDaily').style.display = 'block';
    } else if (tabName === 'Monthly') {
        if(monthlyTab) { monthlyTab.style.color = '#0f766e'; monthlyTab.style.borderBottomColor = '#0f766e'; }
        document.getElementById('histSecMonthly').style.display = 'block';
    } else if (tabName === 'Reports') {
        if(repTab) { repTab.style.color = '#0f766e'; repTab.style.borderBottomColor = '#0f766e'; }
        document.getElementById('histSecReports').style.display = 'block';
    }
};

// 🔥 FIX: The Missing Run Report Engine!
window.runProductReport = function() {
    let startDateRaw = document.getElementById('histStartDate').value;
    let endDateRaw = document.getElementById('histEndDate').value;
    let branchFilter = document.getElementById('histBranchFilter').value;
    
    if (!startDateRaw || !endDateRaw) {
        alert("Please select a Start and End date.");
        return;
    }
    
    let startOfDay = new Date(startDateRaw + 'T00:00:00');
    let endOfDay = new Date(endDateRaw + 'T23:59:59');
    
    if (typeof window.loadProductAnalytics === 'function') {
        window.loadProductAnalytics(startOfDay, endOfDay, branchFilter);
    } else {
        alert("Analytics Engine is still loading. Please try again in a moment.");
    }
};

// ========================================================
// 🧾 MASTER SALES HISTORY & FINANCIAL ENGINE
// ========================================================
window.loadSalesHistoryTab = async function() {
    const tbodyTx = document.getElementById('historyTableBody');
    const tbodyShifts = document.getElementById('historyShiftsBody');
    const tbodyDaily = document.getElementById('historyDailyBody');
    const tbodyMonthly = document.getElementById('historyMonthlyBody');
    
    let branchFilter = document.getElementById('histBranchFilter').value;
    let startDateRaw = document.getElementById('histStartDate').value;
    let endDateRaw = document.getElementById('histEndDate').value;

    if (!startDateRaw || !endDateRaw) {
        let today = new Date();
        today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
        let todayStr = today.toISOString().split('T')[0];
        document.getElementById('histStartDate').value = todayStr;
        document.getElementById('histEndDate').value = todayStr;
        startDateRaw = todayStr;
        endDateRaw = todayStr;
    }

    let startOfDay = new Date(startDateRaw + 'T00:00:00');
    let endOfDay = new Date(endDateRaw + 'T23:59:59');

    if(tbodyTx) tbodyTx.innerHTML = '<tr><td colspan="10" class="text-center" style="padding: 30px;">⏳ Loading data...</td></tr>';
    if(tbodyShifts) tbodyShifts.innerHTML = '<tr><td colspan="9" class="text-center" style="padding: 30px;">⏳ Calculating shift aggregates...</td></tr>';
    
    try {
        // 1. FETCH COSTS & MENU CATEGORIES
        const invSnap = await getDocs(collection(db, "inventory"));
        let inventoryCosts = {};
        invSnap.forEach(doc => { inventoryCosts[doc.data().name] = parseFloat(doc.data().baseCost) || 0; });

        const bomSnap = await getDocs(collection(db, "bom"));
        let recipeCosts = {};
        bomSnap.forEach(doc => {
            let data = doc.data();
            if (!recipeCosts[data.menuItem]) recipeCosts[data.menuItem] = 0;
            recipeCosts[data.menuItem] += ((inventoryCosts[data.ingredientName] || 0) * (data.qty || 1));
        });

        const menuSnap = await getDocs(collection(db, "menu"));
        let menuCats = {};
        menuSnap.forEach(d => { menuCats[d.data().name] = d.data().category || "Uncategorized"; });

        // 2. FETCH ACTUAL SHIFTS
        const shiftQ = query(collection(db, "shifts"), where("startTime", ">=", startOfDay), orderBy("startTime", "desc"));
        const shiftSnap = await getDocs(shiftQ);
        window.globalShiftReports = {}; // Reset Memory
        
        shiftSnap.forEach(doc => {
            let s = doc.data();
            if (branchFilter !== "All" && s.branch !== branchFilter) return;
            
            let sTime = s.startTime ? s.startTime.toDate() : new Date();
            let eTime = s.active ? new Date() : (s.endTime ? s.endTime.toDate() : new Date());
            
            let sTimeStr = sTime.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
            let eTimeStr = s.active ? "Present" : eTime.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
            let dateStr = sTime.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' });

            window.globalShiftReports[doc.id] = {
                id: doc.id,
                branch: s.branch,
                cashier: s.cashier,
                dateStr: dateStr,
                timeLabel: `${sTimeStr} - ${eTimeStr}`,
                timestamp: sTime,
                sales: 0, cogs: 0, voids: 0, txCount: 0,
                categorySales: {}, itemSales: {}, transactions: [] // 🔥 REQUIRED: Array to hold the receipts!
            };
        });

        // 3. FETCH TRANSACTIONS & REJECTED MOBILE ORDERS
        const q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        const snap = await getDocs(q);

        const rejectedQ = query(collection(db, "incoming_orders"), where("status", "in", ["rejected", "rejected_by_customer"]), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        const rejectedSnap = await getDocs(rejectedQ);

        // 4. COMBINE AND SORT
        let allTxArray = [];
        snap.forEach(doc => allTxArray.push({id: doc.id, ...doc.data()}));
        rejectedSnap.forEach(doc => allTxArray.push({id: doc.id, isMobileRejected: true, ...doc.data()}));
        allTxArray.sort((a,b) => b.timestamp - a.timestamp);

        let txHtml = '';
        let tNet = 0; let tCogs = 0; let tGrab = 0;
        let dailyAggregates = {}; let monthlyAggregates = {}; 
        let distOrderType = {}; let distPayment = {}; let distTotalSales = 0;

        // 5. PROCESS EVERYTHING
        allTxArray.forEach(tx => {
            if (branchFilter !== "All" && tx.branch !== branchFilter) return;

            let dDate = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateStr = dDate.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' }); 
            let monthStr = dDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' }); 
            let timeStr = dDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
            let safeCustomer = tx.customerName ? tx.customerName.replace(/'/g, "\\'") : 'Guest';
            let safeCashier = tx.cashier || 'Unknown';
            let safeCart = encodeURIComponent(JSON.stringify(tx.cart || tx.items || [])); 

            let isMobile = !!tx.isMobileRejected || (tx.notes && tx.notes.includes("Mobile App Order")) || (tx.cart && tx.cart.some(i => i.notes && i.notes.includes("Mobile App Order")));
            let mobileIcon = isMobile ? '📱 ' : '';

            if (tx.isMobileRejected) {
                let reasonStr = tx.status === "rejected_by_customer" ? "Cancelled by Cust" : "Rejected by Store";
                txHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9; background: #fff1f2;">
                        <td style="padding: 12px 10px; font-family: monospace; font-weight: bold; color: #ef4444;">MOBILE-REJ</td>
                        <td style="padding: 12px 10px;"><span class="badge badge-open">${tx.branch}</span></td>
                        <td style="padding: 12px 10px; font-weight: 500;">-</td>
                        <td style="padding: 12px 10px; font-weight: bold; color: #ef4444;">${mobileIcon}${safeCustomer}</td>
                        <td style="padding: 12px 10px; color: #ef4444; font-weight: bold; text-decoration: line-through;">₱${(tx.totalAmount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td style="padding: 12px 10px; color: #475569;">${tx.paymentMode || 'Unknown'}</td>
                        <td style="padding: 12px 10px;"><span style="background:#fef2f2; color:#b91c1c; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:bold;">${reasonStr}</span></td>
                        <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${dateStr}</td>
                        <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${timeStr}</td>
                        <td style="padding: 12px 10px; text-align: center;">
                            <button onclick="window.viewReceiptDetails('${tx.id}', '${safeCustomer}', '${timeStr}', '${tx.paymentMode}', ${tx.totalAmount}, '${safeCart}')" style="background: white; border: 1px solid #ef4444; color: #ef4444; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">🔍 View</button>
                        </td>
                    </tr>
                `;
                return; 
            }

            let isVoid = tx.status === "Voided";
            let txNet = (tx.netTotal || 0);
            
            let sId = tx.shiftId;
            if (!sId || !window.globalShiftReports[sId]) {
                sId = `fallback_${tx.branch}_${dateStr}`;
                if (!window.globalShiftReports[sId]) {
                    window.globalShiftReports[sId] = {
                        id: sId, branch: tx.branch, cashier: safeCashier,
                        dateStr: dateStr, timeLabel: "General Sales (No Shift Linked)", timestamp: dDate,
                        sales: 0, cogs: 0, voids: 0, txCount: 0, categorySales: {}, itemSales: {}, transactions: [], isFallback: true
                    };
                }
            }
            let shiftRef = window.globalShiftReports[sId];

            let dailyKey = `${tx.branch}_${dateStr}`;
            let monthlyKey = `${tx.branch}_${monthStr}`;

            let txCogs = 0;
            if (tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let qty = item.qty || 1;
                    let itemName = item.name || item.itemName;
                    let itemCat = item.category || menuCats[itemName] || "Uncategorized";
                    
                    let baseCogs = (recipeCosts[itemName] || 0) * qty;
                    let addonCogs = 0;
                    if (item.addons) {
                        for (let key in item.addons) {
                            let addon = item.addons[key];
                            if (addon.qty > 0 && addon.linkedIngredient) {
                                addonCogs += ((inventoryCosts[addon.linkedIngredient] || 0) * addon.deductQty * addon.qty * qty);
                            }
                        }
                    }
                    let itemTotalCogs = baseCogs + addonCogs;
                    let itemTotalSales = item.lineTotalFinal !== undefined ? item.lineTotalFinal : ((item.variantPrice || item.basePrice || 0) * qty);

                    txCogs += itemTotalCogs;

                    if (!isVoid) {
                        if (!shiftRef.categorySales[itemCat]) shiftRef.categorySales[itemCat] = { sales: 0, qty: 0 };
                        shiftRef.categorySales[itemCat].sales += itemTotalSales;
                        shiftRef.categorySales[itemCat].qty += qty;
                    }
                });
            }
            
            // 🔥 REQUIRED: Save the actual receipt details to the shift memory for the modal!
            shiftRef.transactions.push({
                time: timeStr,
                receiptId: tx.receiptId,
                customer: safeCustomer,
                status: tx.status || "Paid",
                netTotal: txNet,
                cogs: txCogs,
                paymentMethod: tx.paymentMethod || 'Unknown',
                cartEncoded: safeCart,
                isVoid: isVoid
            });

            if (!isVoid) {
                tNet += txNet;
                tCogs += txCogs;
                shiftRef.sales += txNet;
                shiftRef.cogs += txCogs;
                shiftRef.txCount += 1;

                if (tx.paymentMethod === "Grab" || tx.orderType === "Grab") tGrab += txNet;

                let oType = tx.orderType || "Take-out";
                let pMeth = tx.paymentMethod || "Cash";
                
                distTotalSales += txNet;
                if (!distOrderType[oType]) distOrderType[oType] = { sales: 0, count: 0 };
                if (!distPayment[pMeth]) distPayment[pMeth] = { sales: 0, count: 0 };
                
                distOrderType[oType].sales += txNet; distOrderType[oType].count++;
                distPayment[pMeth].sales += txNet; distPayment[pMeth].count++;
            } else {
                shiftRef.voids += txNet;
            }

            // 🔥 FIX: Daily Logic Columns (Date first, then Branch)
            if (!dailyAggregates[dailyKey]) dailyAggregates[dailyKey] = { branch: tx.branch, date: dateStr, sales: 0, cogs: 0, txCount: 0, voids: 0 };
            if (isVoid) { dailyAggregates[dailyKey].voids += txNet; } 
            else { dailyAggregates[dailyKey].sales += txNet; dailyAggregates[dailyKey].cogs += txCogs; dailyAggregates[dailyKey].txCount += 1; }

            // 🔥 FIX: Monthly Logic Columns (Month first, then Branch)
            if (!monthlyAggregates[monthlyKey]) monthlyAggregates[monthlyKey] = { branch: tx.branch, month: monthStr, sales: 0, cogs: 0, txCount: 0, voids: 0, dateObj: new Date(dDate.getFullYear(), dDate.getMonth(), 1) };
            if (isVoid) { monthlyAggregates[monthlyKey].voids += txNet; }
            else { monthlyAggregates[monthlyKey].sales += txNet; monthlyAggregates[monthlyKey].cogs += txCogs; monthlyAggregates[monthlyKey].txCount += 1; }

            let statusStyle = isVoid ? "opacity: 0.5; text-decoration: line-through; color: #ef4444;" : "font-weight: bold; color: var(--primary);";
            let statusBadge = isVoid ? `<span style="background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:12px; font-size:11px;">Voided</span>` : `<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:12px; font-size:11px;">Paid</span>`;

            txHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px 10px; font-family: monospace; font-weight: bold; color: #334155;">${tx.receiptId}</td>
                    <td style="padding: 12px 10px;"><span class="badge badge-open">${tx.branch}</span></td>
                    <td style="padding: 12px 10px; font-weight: 500;">${safeCashier}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #0284c7;">${mobileIcon}${safeCustomer}</td>
                    <td style="padding: 12px 10px; ${statusStyle}">₱${txNet.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px 10px; color: #475569;">${tx.paymentMethod || 'Unknown'}</td>
                    <td style="padding: 12px 10px;">${statusBadge}</td>
                    <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${timeStr}</td>
                    <td style="padding: 12px 10px; text-align: center;">
                        <button onclick="window.viewReceiptDetails('${tx.receiptId}', '${safeCustomer}', '${timeStr}', '${tx.paymentMethod}', ${txNet}, '${safeCart}')" style="background: white; border: 1px solid #cbd5e1; color: #334155; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">🔍 View</button>
                    </td>
                </tr>
            `;
        });

        if(tbodyTx) tbodyTx.innerHTML = txHtml || '<tr><td colspan="10" class="text-center" style="padding: 30px; color: #64748b;">No transactions found.</td></tr>';

        // BUILD SHIFTS HTML WITH VIEW BUTTON
        let shiftsHtml = '';
        Object.values(window.globalShiftReports).sort((a,b) => b.timestamp - a.timestamp).forEach(s => {
            if (s.sales === 0 && s.voids === 0) return; 
            let sMargin = s.sales - s.cogs;
            shiftsHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 15px 10px; font-weight: bold; color: #334155;">
                        ${s.dateStr} <br><span style="font-size: 11px; color: #64748b; font-weight: normal;">${s.timeLabel}</span>
                    </td>
                    <td style="padding: 15px 10px;"><span class="badge badge-open">${s.branch}</span></td>
                    <td style="padding: 15px 10px; font-weight: bold; color: #0f766e;">👤 ${s.cashier}</td>
                    <td style="padding: 15px 10px; font-weight: bold; color: #16a34a; font-size: 15px;">₱${s.sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #dc2626; font-weight: 500;">₱${s.cogs.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #0ea5e9; font-weight: bold;">₱${sMargin.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #ef4444; font-weight: bold;">₱${s.voids.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; font-weight: bold; color: #475569;">${s.txCount}</td>
                    <td style="padding: 15px 10px; text-align: center;">
                        <button onclick="window.viewShiftReportModal('${s.id}')" style="background: #0f172a; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">📊 Full Details</button>
                    </td>
                </tr>`;
        });
        if(tbodyShifts) tbodyShifts.innerHTML = shiftsHtml || '<tr><td colspan="9" class="text-center" style="padding: 30px; color: #64748b;">No shift aggregates available.</td></tr>';

        // 🔥 FIX: BUILD DAILY HTML (Date first, then Branch)
        let dailyHtml = '';
        Object.values(dailyAggregates).sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(d => {
            let dMargin = d.sales - d.cogs;
            let dAvg = d.txCount > 0 ? d.sales / d.txCount : 0;
            dailyHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 15px 10px; font-weight: bold; color: #334155;">${d.date}</td>
                    <td style="padding: 15px 10px;"><span class="badge badge-open">${d.branch}</span></td>
                    <td style="padding: 15px 10px; font-weight: bold; color: #0f172a; font-size: 15px;">₱${d.sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #dc2626; font-weight: 500;">₱${d.cogs.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #16a34a; font-weight: bold;">₱${dMargin.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; font-weight: bold; color: #475569;">${d.txCount}</td>
                    <td style="padding: 15px 10px; color: #64748b;">₱${dAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                </tr>`;
        });
        if(tbodyDaily) tbodyDaily.innerHTML = dailyHtml || '<tr><td colspan="7" class="text-center" style="padding: 30px; color: #64748b;">No daily aggregates available.</td></tr>';

        // 🔥 FIX: BUILD MONTHLY HTML (Month first, then Branch)
        let monthlyHtml = '';
        Object.values(monthlyAggregates).sort((a,b) => b.dateObj - a.dateObj).forEach(m => {
            let mMargin = m.sales - m.cogs;
            let mAvg = m.txCount > 0 ? m.sales / m.txCount : 0;
            monthlyHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9; background: #f8fafc;">
                    <td style="padding: 15px 10px; font-weight: 900; color: #0f766e; font-size: 14px;">📅 ${m.month}</td>
                    <td style="padding: 15px 10px;"><span class="badge badge-open">${m.branch}</span></td>
                    <td style="padding: 15px 10px; font-weight: 900; color: #0f172a; font-size: 15px;">₱${m.sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #dc2626; font-weight: bold;">₱${m.cogs.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; color: #16a34a; font-weight: 900;">₱${mMargin.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 10px; font-weight: bold; color: #475569;">${m.txCount}</td>
                    <td style="padding: 15px 10px; color: #64748b;">₱${mAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                </tr>`;
        });
        if(tbodyMonthly) tbodyMonthly.innerHTML = monthlyHtml || '<tr><td colspan="7" class="text-center" style="padding: 30px; color: #64748b;">No monthly aggregates available.</td></tr>';

        // UPDATE KPI CARDS
        document.getElementById('histSumNet').innerText = `₱${tNet.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('histSumCogs').innerText = `₱${tCogs.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('histSumMargin').innerText = `₱${(tNet - tCogs).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('histSumGrab').innerText = `₱${tGrab.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        let cogsCirc = document.getElementById('histCogsPct');
        if (cogsCirc) { let cPct = tNet>0 ? (tCogs/tNet)*100 : 0; cogsCirc.innerText = `${cPct.toFixed(0)}%`; cogsCirc.style.borderColor = cPct>50?'#ef4444':'#10b981'; cogsCirc.style.color = cPct>50?'#ef4444':'#10b981'; }

        let marginCirc = document.getElementById('histMarginPct');
        if (marginCirc) { let mPct = tNet>0 ? ((tNet-tCogs)/tNet)*100 : 0; marginCirc.innerText = `${mPct.toFixed(0)}%`; marginCirc.style.borderColor = mPct<30?'#ef4444':'#0ea5e9'; marginCirc.style.color = mPct<30?'#ef4444':'#0ea5e9'; }

        // UPDATE SALES DISTRIBUTION
        let buildDistHtml = (distObj) => {
            let html = '';
            let sortedKeys = Object.keys(distObj).sort((a,b) => distObj[b].sales - distObj[a].sales);
            sortedKeys.forEach(k => {
                let d = distObj[k];
                let pct = distTotalSales > 0 ? (d.sales / distTotalSales) * 100 : 0;
                html += `
                    <div style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">
                            <span>${k} <span style="color:#94a3b8; font-weight:normal; font-size:11px;">(${d.count} tx)</span></span>
                            <span>₱${d.sales.toLocaleString(undefined, {minimumFractionDigits: 2})} <span style="color:#10b981; font-weight:900;">${pct.toFixed(1)}%</span></span>
                        </div>
                        <div style="background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden;">
                            <div style="background: #10b981; height: 100%; width: ${pct}%;"></div>
                        </div>
                    </div>
                `;
            });
            return html || '<div style="color:#94a3b8; font-size:12px;">No data.</div>';
        };

        if(document.getElementById('distOrderTypeBody')) document.getElementById('distOrderTypeBody').innerHTML = buildDistHtml(distOrderType);
        if(document.getElementById('distPaymentBody')) document.getElementById('distPaymentBody').innerHTML = buildDistHtml(distPayment);

        if (typeof window.loadProductAnalytics === 'function') window.loadProductAnalytics(startOfDay, endOfDay, branchFilter);

    } catch (e) {
        console.error("History Error:", e);
        if(tbodyTx) tbodyTx.innerHTML = '<tr><td colspan="10" class="text-center" style="padding: 30px; color: red;">Failed to fetch history.</td></tr>';
    }
};

// ========================================================
// 📊 VIEW SHIFT DETAILS MODAL ENGINE
// ========================================================
window.globalShiftReports = {}; 

window.viewShiftReportModal = function(shiftId) {
    let s = window.globalShiftReports[shiftId];
    if (!s) return;

    // 1. Build the Category Breakdown HTML
    let catHtml = '';
    let sortedCats = Object.keys(s.categorySales).sort((a,b) => s.categorySales[b].sales - s.categorySales[a].sales);
    sortedCats.forEach(c => {
        catHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #cbd5e1; padding:6px 0; font-size: 14px;">
            <span><strong style="color:#334155;">${c}</strong> <span style="color:#94a3b8; font-size:12px;">(${s.categorySales[c].qty} items)</span></span>
            <strong style="color:#0f766e;">₱${s.categorySales[c].sales.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
        </div>`;
    });

    // 🔥 2. NEW: Build the Transactions List HTML (Replaces the old Products list!)
    let txHtml = '';
    
    if (s.transactions && s.transactions.length > 0) {
        // Sort the transactions newest first
        s.transactions.sort((a, b) => new Date('1970/01/01 ' + b.time) - new Date('1970/01/01 ' + a.time));
        
        s.transactions.forEach(tx => {
            let statusBadge = tx.isVoid ? `<span style="background:#fee2e2; color:#b91c1c; padding:2px 8px; border-radius:12px; font-size:11px;">Voided</span>` : `<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:12px; font-size:11px;">Paid</span>`;
            let rowStyle = tx.isVoid ? "opacity: 0.6; text-decoration: line-through; color: #ef4444;" : "font-weight: bold; color: #16a34a;";

            // If it's voided, COGS and Margin are zeroed out for visual clarity
            let cogsDisplay = tx.isVoid ? '₱0.00' : `₱${(tx.cogs || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            let marginDisplay = tx.isVoid ? '₱0.00' : `₱${((tx.netTotal || 0) - (tx.cogs || 0)).toLocaleString(undefined, {minimumFractionDigits: 2})}`;

            txHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px; font-family: monospace; font-weight: bold; color: #334155;">${tx.receiptId}</td>
                    <td style="padding: 10px; color: #64748b;">${tx.time}</td>
                    <td style="padding: 10px; color: #0284c7; font-weight: bold;">${tx.customer}</td>
                    <td style="padding: 10px; ${rowStyle}">₱${(tx.netTotal || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 10px; color: #dc2626; font-weight: 500;">${cogsDisplay}</td>
                    <td style="padding: 10px; color: #0ea5e9; font-weight: 900;">${marginDisplay}</td>
                    <td style="padding: 10px; color: #475569;">${tx.paymentMethod}</td>
                    <td style="padding: 10px;">${statusBadge}</td>
                    <td style="padding: 10px; text-align: center;">
                        <button onclick="window.viewReceiptDetails('${tx.receiptId}', '${(tx.customer || 'Guest').replace(/'/g, "\\'")}', '${tx.time}', '${tx.paymentMethod}', ${tx.netTotal}, '${tx.cartEncoded}')" style="background: white; border: 1px solid #cbd5e1; color: #334155; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 View</button>
                    </td>
                </tr>
            `;
        });
    }

    // 3. Inject the Popup Modal dynamically into the screen
    let modalHtml = `
        <div id="dynamicShiftReportModal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 10001; backdrop-filter: blur(4px);">
            <div style="background: white; padding: 25px; border-radius: 12px; width: 1050px; max-width: 95%; box-shadow: 0 25px 50px rgba(0,0,0,0.5); max-height: 90vh; display: flex; flex-direction: column;">
                
                <!-- 🔥 NEW: BEAUTIFUL GRADIENT BANNER 🔥 -->
                <div style="background: linear-gradient(135deg, #0f172a, #1e293b); color: white; padding: 20px; border-radius: 12px 12px 0 0; display: flex; justify-content: space-between; align-items: center; margin: -25px -25px 20px -25px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <div style="width: 50px; height: 50px; background: white; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">🧑‍🍳</div>
                        <div>
                            <h3 style="margin: 0; color: white; font-size: 22px;">📊 Comprehensive Shift Report</h3>
                            <div style="font-size: 13px; color: #94a3b8; margin-top: 6px; font-weight: bold;">
                                <span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px;">👤 ${s.cashier}</span> &nbsp;
                                <span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px;">📍 ${s.branch}</span> &nbsp;
                                <span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px;">⏰ ${s.dateStr} (${s.timeLabel})</span>
                            </div>
                        </div>
                    </div>
                    <button onclick="document.getElementById('dynamicShiftReportModal').remove()" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); width: 36px; height: 36px; border-radius: 8px; font-size: 20px; cursor: pointer; color: white; display: flex; align-items: center; justify-content: center; transition: 0.2s;">×</button>
                </div>

                <div style="flex: 1; overflow-y: auto; padding-right: 5px;">
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                        <div style="background: #f8fafc; padding: 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                            <h4 style="margin-top: 0; color: #334155; border-bottom: 2px solid #cbd5e1; padding-bottom: 8px; font-size: 15px;">💰 Shift Financials</h4>
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size: 15px;"><span>Gross Sales:</span><strong style="color:#16a34a;">₱${(s.sales || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size: 15px;"><span>Est. COGS:</span><strong style="color:#dc2626;">₱${(s.cogs || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size: 15px;"><span>Net Margin:</span><strong style="color:#0ea5e9;">₱${((s.sales || 0) - (s.cogs || 0)).toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
                            <div style="display:flex; justify-content:space-between; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 15px;"><span>Total Voided:</span><strong style="color:#ef4444;">₱${(s.voids || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
                        </div>
                        
                        <div style="background: #f8fafc; padding: 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                            <h4 style="margin-top: 0; color: #334155; border-bottom: 2px solid #cbd5e1; padding-bottom: 8px; font-size: 15px;">📦 Category Breakdown</h4>
                            <div style="max-height: 120px; overflow-y: auto;">
                                ${catHtml || '<i style="color:#94a3b8;">No category data.</i>'}
                            </div>
                        </div>
                    </div>

                    <h4 style="margin-top: 0; color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; font-size: 16px;">🧾 Shift Transactions</h4>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                        <thead style="background: #f1f5f9;">
                            <tr>
                                <th style="padding: 12px 10px; color: #475569;">OR#</th>
                                <th style="padding: 12px 10px; color: #475569;">Time</th>
                                <th style="padding: 12px 10px; color: #475569;">Customer</th>
                                <th style="padding: 12px 10px; color: #475569;">Amount</th>
                                <th style="padding: 12px 10px; color: #475569;">Est. COGS</th>
                                <th style="padding: 12px 10px; color: #475569;">Net Margin</th>
                                <th style="padding: 12px 10px; color: #475569;">Payment</th>
                                <th style="padding: 12px 10px; color: #475569;">Status</th>
                                <th style="padding: 12px 10px; text-align: center; color: #475569;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${txHtml || '<tr><td colspan="9" class="text-center" style="padding:20px; color:#64748b;">No transactions recorded. (Please click "Update Report" to refresh data).</td></tr>'}
                        </tbody>
                    </table>

                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

// ==========================================
// 🍟 GLOBAL ADD-ONS CRUD ENGINE
// ==========================================
window.loadGlobalAddons = async function() {
    const tbody = document.getElementById('globalAddonsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Fetching Add-Ons...</td></tr>';
    try {
        const snap = await getDocs(collection(db, "global_addons"));
        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="font-weight: bold; color: #1e293b; padding: 12px;">${d.name}</td>
                    <td style="font-weight: bold; color: #16a34a; padding: 12px;">₱${d.price}</td>
                    <td style="color: #64748b; padding: 12px;">${d.linkedIngredient || 'None'} <span style="font-size:11px;">(Deducts: ${d.deductQty || 0})</span></td>
                    <td style="padding: 12px;"><span class="badge badge-open">${d.category || 'All'}</span></td>
                    <td style="padding: 12px; display:flex; gap: 5px;">
                        <button onclick="window.deleteGlobalAddon('${doc.id}', '${d.name}')" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:6px 12px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center">No Global Add-Ons setup yet.</td></tr>';
    } catch(e) { console.error(e); }
};

window.openGlobalAddonModal = async function() {
    document.getElementById('gaId').value = '';
    document.getElementById('gaName').value = '';
    document.getElementById('gaPrice').value = '0';
    document.getElementById('gaQty').value = '0';
    document.getElementById('globalAddonModal').style.display = 'flex';
    
    let select = document.getElementById('gaIngredient');
    select.innerHTML = '<option value="">Scanning inventory...</option>';
    try {
        const snap = await getDocs(collection(db, "inventory"));
        let html = '<option value="">-- No Linked Ingredient --</option>';
        snap.forEach(d => { html += `<option value="${d.data().name}">${d.data().name}</option>`; });
        select.innerHTML = html;
    } catch(e) { console.error(e); }
};

window.saveGlobalAddon = async function() {
    let name = document.getElementById('gaName').value.trim();
    let price = parseFloat(document.getElementById('gaPrice').value) || 0;
    let qty = parseFloat(document.getElementById('gaQty').value) || 0;
    let ing = document.getElementById('gaIngredient').value;
    let cat = document.getElementById('gaCategory').value;

    if (!name) { alert("Add-on name is required!"); return; }
    
    let btn = document.getElementById('btnSaveGA');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "global_addons"), {
            name: name, price: price, deductQty: qty, linkedIngredient: ing, category: cat
        });
        alert(`✅ Success! ${name} added globally.`);
        document.getElementById('globalAddonModal').style.display = 'none';
        window.loadGlobalAddons();
    } catch(e) { console.error(e); alert("Failed to save."); } 
    finally { btn.innerText = "💾 Save Add-On"; btn.disabled = false; }
};

window.deleteGlobalAddon = async function(id, name) {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return;
    try {
        await deleteDoc(doc(db, "global_addons", id));
        window.loadGlobalAddons();
    } catch(e) { console.error(e); alert("Failed to delete."); }
};

// 🔥 FIX THE PESO SIGN EXCEL BUG! The \uFEFF code forces Excel to read it as UTF-8!
window.exportTransactionsCSV = async function() {
    let select = document.getElementById('histShiftSelect');
    if (!select || select.selectedIndex <= 0) { 
        alert("Please select a specific shift to export."); 
        return; 
    }

    let selectedOption = select.options[select.selectedIndex];
    let startOfDay = new Date(selectedOption.getAttribute('data-start'));
    let endOfDay = new Date(selectedOption.getAttribute('data-end'));
    let shiftBranch = selectedOption.getAttribute('data-branch');
    let safeName = selectedOption.innerText.replace(/[^a-zA-Z0-9]/g, '_'); 

    let btn = document.getElementById('btnExportSales') || document.querySelector('button[onclick*="exportTransactionsCSV"]');
    let oldText = btn ? btn.innerText : "Export Excel";
    if (btn) { btn.innerText = "⏳ Exporting..."; btn.disabled = true; }

    try {
        const q = query(collection(db, "transactions"), where("branch", "==", shiftBranch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);

        let csv = "Receipt ID,Date,Time,Branch,Cashier,Customer,Items Ordered,Payment Method,Status,Net Total\n";

        snap.forEach(docSnap => {
            let tx = docSnap.data();
            let d = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateStr = d.toLocaleDateString('en-PH');
            let timeStr = d.toLocaleTimeString('en-PH');
            
            let itemsArr = [];
            if (tx.cart) { tx.cart.forEach(item => { itemsArr.push(`${item.qty}x ${item.name || item.itemName}`); }); }
            let itemsJoined = itemsArr.join(" | ").replace(/"/g, '""'); 
            
            // Note: We leave out the Peso sign in the raw data so Excel can sum the column mathematically!
            csv += `"${tx.receiptId}","${dateStr}","${timeStr}","${tx.branch}","${tx.cashier}","${tx.customerName || 'Guest'}","${itemsJoined}","${tx.paymentMethod}","${tx.status || 'Paid'}","${tx.netTotal}"\n`;
        });

        // 🔥 THE MAGIC UTF-8 BOM: "\uFEFF" forces Excel to read symbols correctly!
        let csvFile = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        let downloadLink = document.createElement("a");
        downloadLink.download = `Takodeal_Sales_${safeName}.csv`;
        downloadLink.href = window.URL.createObjectURL(csvFile);
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink); downloadLink.click(); document.body.removeChild(downloadLink);
    } catch (e) {
        console.error("Export Error:", e); alert("Failed to export sales data.");
    } finally {
        if (btn) { btn.innerText = oldText; btn.disabled = false; }
    }
};

window.downloadExcel = function(tbodyId, fileName) {
    let tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    let table = tbody.closest('table');
    let rows = table.querySelectorAll('tr');
    let csv = [];

    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll('td, th');
        let colCount = cols.length;
        if ((tbodyId === 'historyTableBody' || tbodyId === 'zReadingTableBody') && i > 0) colCount -= 1; 

        for (let j = 0; j < colCount; j++) {
            let text = cols[j].innerText.replace(/"/g, '""').replace(/₱/g, '₱'); 
            row.push('"' + text + '"'); // Protects against commas!
        }
        csv.push(row.join(","));
    }

    // 🔥 THE MAGIC UTF-8 BOM: "\uFEFF" fixes the Peso sign glitch in Excel!
    let csvFile = new Blob(["\uFEFF" + csv.join("\n")], {type: "text/csv;charset=utf-8;"});
    let tempLink = document.createElement("a");
    let dateTag = new Date().toISOString().split('T')[0];
    
    tempLink.download = `${fileName}_${dateTag}.csv`;
    tempLink.href = window.URL.createObjectURL(csvFile);
    tempLink.style.display = "none";
    document.body.appendChild(tempLink); tempLink.click(); document.body.removeChild(tempLink);
};

// Auto-Load the dates when the page boots up
document.addEventListener("DOMContentLoaded", () => {
    let today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    let todayStr = today.toISOString().split('T')[0];
    if (document.getElementById('histStartDate')) document.getElementById('histStartDate').value = todayStr;
    if (document.getElementById('histEndDate')) document.getElementById('histEndDate').value = todayStr;
});

// ==========================================
// 📱 MOBILE SIDEBAR SLIDE ENGINE
// ==========================================
window.toggleManagerSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('mobileSidebarOverlay');
    
    // Check if the sidebar is currently open
    if (sidebar.classList.contains('show-mobile')) {
        // Close it
        sidebar.classList.remove('show-mobile');
        if (overlay) overlay.style.display = 'none';
    } else {
        // Open it
        sidebar.classList.add('show-mobile');
        if (overlay) overlay.style.display = 'block';
    }
};

// ==========================================
// 📜 ACCOUNT AUDIT LOGS ENGINE
// ==========================================
window.openAccountHistory = async function() {
    document.getElementById('accountHistoryModal').style.display = 'flex';
    const tbody = document.getElementById('accHistoryTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px;">⏳ Fetching secure audit logs...</td></tr>';

    try {
        // Fetch the 50 most recent account logs
        const q = query(collection(db, "account_logs"), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let timeStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            
            // Color code the actions! (Green for money IN, Red for money OUT, Blue for Transfers)
            let actionColor = (d.action.includes('Deposit') || d.action.includes('Received') || d.action.includes('Remittance')) ? '#16a34a' : '#dc2626';
            if(d.action.includes('Transfer') || d.action.includes('Sweep')) actionColor = '#2563eb';

            html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 12px 10px; color: #64748b; font-size: 13px;">${timeStr}</td>
                <td style="padding: 12px 10px; font-weight: bold; color: #334155;">${d.user || 'System'}</td>
                <td style="padding: 12px 10px; color: ${actionColor}; font-weight: bold;">
                    ${d.action} <br>
                    <span style="font-size: 11px; color: #64748b;">Amount: ₱${(d.amount || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                </td>
                <td style="padding: 12px 10px; font-weight: bold; color: #0284c7;">
                    ${d.accountName} <br>
                    <span style="font-size: 10px; color: #94a3b8; font-weight: normal;">📍 ${d.branch}</span>
                </td>
                <td style="padding: 12px 10px; font-size: 12px; color: #475569;">
                    ${d.note || '-'} <br>
                    <strong style="color: #0f766e; font-size: 13px;">New Bal: ₱${(d.newBalance || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</strong>
                </td>
            </tr>`;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 20px;">No account logs found.</td></tr>';
    } catch(e) {
        console.error("Audit Log Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red; padding: 20px;">Failed to fetch logs. Check console.</td></tr>';
    }
};

// ==========================================
// 🕒 SMART SHIFT FINDER ENGINE
// ==========================================
window.loadHistoryShiftDropdown = async function() {
    let branchFilter = document.getElementById('histBranchFilter');
    let select = document.getElementById('histShiftSelect');
    if (!select || !branchFilter) return;

    select.innerHTML = '<option value="">⏳ Scanning for shifts...</option>';

    try {
        // Fetch the 50 most recent shifts for this branch
        let q = query(collection(db, "shifts"), orderBy("startTime", "desc"), limit(50));
        if (branchFilter.value !== "All") {
            q = query(collection(db, "shifts"), where("branch", "==", branchFilter.value), orderBy("startTime", "desc"), limit(50));
        }
        
        const snap = await getDocs(q);
        let html = '<option value="">-- Select a Specific Shift --</option>';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.startTime ? d.startTime.toDate().toLocaleDateString('en-PH', {month: 'short', day: 'numeric'}) : 'Unknown';
            let sTime = d.startTime ? d.startTime.toDate().toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'}) : '';
            let eTime = d.active ? 'Present' : (d.endTime ? d.endTime.toDate().toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'}) : 'Active');
            
            let label = `${dateStr} | ${d.cashier} (${sTime} to ${eTime})`;
            
            // We secretly store the exact millisecond timestamps inside the HTML option!
            let startISO = d.startTime ? d.startTime.toDate().toISOString() : '';
            let endISO = d.active ? new Date().toISOString() : (d.endTime ? d.endTime.toDate().toISOString() : new Date().toISOString());

            html += `<option value="${docSnap.id}" data-start="${startISO}" data-end="${endISO}" data-branch="${d.branch}">${label}</option>`;
        });

        select.innerHTML = html;
    } catch(e) {
        console.error(e);
        select.innerHTML = '<option value="">❌ Error loading shifts</option>';
    }
};

// Wake it up automatically when the dashboard loads!
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { if (document.getElementById('histShiftSelect')) window.loadHistoryShiftDropdown(); }, 1500);
});

// ========================================================
// ⚙️ MASTER POS CONFIGURATION ENGINE
// ========================================================

window.loadPosConfigHub = async function() {
    let btn = document.querySelector("#view-posconfig .btn-refresh");
    let originalText = btn ? btn.innerText : "💾 Save Changes to Cloud";
    if (btn) btn.innerText = "⏳ Loading Data...";

    try {
        const docRef = doc(db, "settings", "global_pos_config");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            let data = docSnap.data();
            
            // Join the cloud arrays into comma-separated strings for the text boxes
            document.getElementById('configPayMethods').value = (data.paymentMethods || []).join(', ');
            document.getElementById('configOrderTypes').value = (data.orderTypes || []).join(', ');
            document.getElementById('configPosTabs').value = (data.posTabs || []).join(', ');
            document.getElementById('configKitchenPrep').value = (data.kitchenPrepCats || ["Prepared Batch"]).join(', ');
            document.getElementById('configAuditList').value = (data.auditItems || []).join(', ');
        } else {
            // Default Takodeal Values if empty
            document.getElementById('configPayMethods').value = "Cash, GCash, Bank, Grab";
            document.getElementById('configOrderTypes').value = "Dine-In, Take-Out, Delivery, Grab";
            document.getElementById('configPosTabs').value = "Takoyaki, Milk Tea, Coffee, Add-ons";
            document.getElementById('configKitchenPrep').value = "Prepared Batch";
            document.getElementById('configAuditList').value = "320cc Paper Bowl, 520cc Paper Bowl, LB1 Box, Burger Box";
        }
    } catch (error) {
        console.error("Error loading config:", error);
        alert("Failed to load POS Configuration.");
    } finally {
        if (btn) btn.innerText = originalText;
    }
};

window.saveGlobalPosConfig = async function() {
    let btn = document.querySelector("#view-posconfig .btn-refresh");
    btn.innerText = "⏳ Saving...";
    btn.disabled = true;

    try {
        // Grab the text, split by commas, and trim any accidental extra spaces
        let payMethods = document.getElementById('configPayMethods').value.split(',').map(s => s.trim()).filter(Boolean);
        let orderTypes = document.getElementById('configOrderTypes').value.split(',').map(s => s.trim()).filter(Boolean);
        let posTabs = document.getElementById('configPosTabs').value.split(',').map(s => s.trim()).filter(Boolean);
        let prepCats = document.getElementById('configKitchenPrep').value.split(',').map(s => s.trim()).filter(Boolean);
        let auditList = document.getElementById('configAuditList').value.split(',').map(s => s.trim()).filter(Boolean);

        // Blast it to the Cloud Vault!
        await setDoc(doc(db, "settings", "global_pos_config"), {
            paymentMethods: payMethods,
            orderTypes: orderTypes,
            posTabs: posTabs,
            kitchenPrepCats: prepCats,
            auditItems: auditList,
            lastUpdatedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp()
        }, { merge: true });

        alert("✅ Success! The POS configurations have been updated globally. All Cashier tablets will update on their next refresh.");
        
    } catch (error) {
        console.error("Error saving config:", error);
        alert("❌ Failed to save. Check your connection.");
    } finally {
        btn.innerText = "💾 Save Changes to Cloud";
        btn.disabled = false;
    }
};

window.editManagerPermissions = async function(docId, email) {
    let currentPerms = prompt(`Edit permissions for ${email}.\n\nType the EXACT names of the tabs they can see, separated by commas (no spaces).\n\nAvailable Options:\naccounts, transfers, payables, devices, payroll, inbox, ledger, schedule, products, purchases, dispatch, zreadings, history, expenses, branches, menu, receipt, inventory, alerts\n\nType 'all' to grant full access.`, "all");
    
    if (!currentPerms) return;
    
    // Clean up their typing
    let permArray = currentPerms.split(',').map(t => t.trim().toLowerCase());
    
    try {
        await updateDoc(doc(db, "hq_managers", docId), { permissions: permArray });
        alert(`✅ Permissions updated for ${email}! They must refresh their app for changes to take effect.`);
        window.loadAdminDashboard();
    } catch (e) {
        console.error(e); alert("Failed to update permissions.");
    }
};

// ========================================================
// 🕵️‍♂️ INVENTORY AUDIT & RECONCILIATION ENGINE
// ========================================================
window.loadInventoryAudits = async function() {
    const tbody = document.getElementById('auditLogsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px;">Fetching audit logs...</td></tr>';

    // 🔥 THE FIX: Safely check if the filters exist before reading their values!
    let durationFilterEl = document.getElementById('auditDurationFilter');
    let exactDateFilterEl = document.getElementById('auditExactDate');
    
    let durationFilter = durationFilterEl ? durationFilterEl.value : 'all';
    let exactDateFilter = exactDateFilterEl ? exactDateFilterEl.value : '';
    
    let startDate = new Date();
    startDate.setHours(0,0,0,0);
    
    if (exactDateFilter) {
        startDate = new Date(exactDateFilter + 'T00:00:00');
    } else if (durationFilter === '7days') {
        startDate.setDate(startDate.getDate() - 7);
    } else if (durationFilter === '30days') {
        startDate.setDate(startDate.getDate() - 30);
    } else if (durationFilter === 'all') {
        startDate = new Date('2020-01-01');
    }

    try {
        const q = query(collection(db, "stock_counts"), where("timestamp", ">=", startDate), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        
        const invSnap = await getDocs(collection(db, "inventory"));
        let invDb = {};
        invSnap.forEach(d => {
            let item = d.data();
            invDb[`${item.branch}_${item.name}`] = parseFloat(item.baseCost) || 0;
        });

        let html = '';
        let globalLoss = 0;
        let globalPerfectItems = 0;
        let globalTotalItems = 0;

        snap.forEach(docSnap => {
            let data = docSnap.data();
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            let safeBranch = data.branch ? data.branch.replace(/'/g, "\\'") : 'Unknown';
            let safeCashier = data.cashier ? data.cashier.replace(/'/g, "\\'") : 'Unknown';
            let counts = data.counts || [];
            
            let rowLoss = 0;
            let rowPerfect = 0;

            counts.forEach(c => {
                let cost = invDb[`${data.branch}_${c.name}`] || 0;
                let variance = (parseFloat(c.physicalQty) || 0) - (parseFloat(c.systemQty) || 0);
                
                if (variance < 0) rowLoss += (Math.abs(variance) * cost);
                if (variance === 0) rowPerfect++;
                
                globalTotalItems++;
            });
            
            globalLoss += rowLoss;
            globalPerfectItems += rowPerfect;

            let countsEncoded = encodeURIComponent(JSON.stringify(counts));

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #0f766e;">${safeBranch}</td>
                    <td style="padding: 12px; font-weight: bold; color: #334155;">${safeCashier}</td>
                    <td style="padding: 12px;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">${counts.length} Items</span></td>
                    <td style="padding: 12px; font-weight: bold; color: #dc2626;">${rowLoss > 0 ? `₱${rowLoss.toFixed(2)}` : '₱0.00'}</td>
                    <td style="padding: 12px;">
                        <button onclick="window.viewAuditDetails('${dateStr}', '${safeBranch}', '${safeCashier}', '${countsEncoded}')" style="background: white; border: 1px solid #0f766e; color: #0f766e; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 View Details</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No stock counts submitted in this period.</td></tr>';

        let accuracy = globalTotalItems > 0 ? (globalPerfectItems / globalTotalItems) * 100 : 100;
        
        // Safely update KPIs
        if (document.getElementById('auditKpiAccuracy')) document.getElementById('auditKpiAccuracy').innerText = `${accuracy.toFixed(1)}%`;
        if (document.getElementById('auditKpiLoss')) document.getElementById('auditKpiLoss').innerText = `₱${globalLoss.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        // Smart Re-Audit Engine
        let nextAuditDateStr = "Awaiting Data";
        let nextAuditSubStr = "Need more audit logs";
        
        if (snap.size > 0) {
            let latestAuditDoc = snap.docs[0].data();
            let latestDate = latestAuditDoc.timestamp ? latestAuditDoc.timestamp.toDate() : new Date();
            let targetDate = new Date(latestDate);
            
            if (accuracy < 95 || globalLoss > 500) {
                targetDate.setDate(targetDate.getDate() + 1); 
                nextAuditSubStr = "High Variance: Audit Tomorrow";
                if (document.getElementById('auditKpiNext')) document.getElementById('auditKpiNext').style.color = "#dc2626";
            } else if (accuracy < 98) {
                targetDate.setDate(targetDate.getDate() + 3); 
                nextAuditSubStr = "Moderate Variance: 3-Day Cycle";
                if (document.getElementById('auditKpiNext')) document.getElementById('auditKpiNext').style.color = "#d97706";
            } else {
                targetDate.setDate(targetDate.getDate() + 7); 
                nextAuditSubStr = "Stable: Weekly Cycle";
                if (document.getElementById('auditKpiNext')) document.getElementById('auditKpiNext').style.color = "#16a34a";
            }
            
            let today = new Date();
            today.setHours(0,0,0,0);
            if (targetDate <= today) {
                nextAuditDateStr = "OVERDUE (Do Today)";
                if (document.getElementById('auditKpiNext')) document.getElementById('auditKpiNext').style.color = "#dc2626";
            } else {
                nextAuditDateStr = targetDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
            }
        }
        
        if(document.getElementById('auditKpiNext')) document.getElementById('auditKpiNext').innerText = nextAuditDateStr;
        if(document.getElementById('auditKpiNextSub')) document.getElementById('auditKpiNextSub').innerText = nextAuditSubStr;

    } catch (e) {
        console.error("Audit Engine Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px; color: red;">Failed to load audits.</td></tr>';
    }
};

window.viewAuditDetails = async function(dateStr, branch, cashier, countsEncoded) {
    document.getElementById('auditDetailsModal').style.display = 'flex';
    document.getElementById('auditModalSubtitle').innerText = `${dateStr} | ${branch} | By: ${cashier}`;
    
    const tbody = document.getElementById('auditDetailsBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px;">Fetching Live DB stock for comparison...</td></tr>';
    
    let counts = JSON.parse(decodeURIComponent(countsEncoded));
    
    try {
        // Fetch live inventory for this branch to get System Expected and Cost
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        
        let liveStockDb = {};
        snap.forEach(docSnap => {
            let item = docSnap.data();
            liveStockDb[item.name] = {
                qty: parseFloat(item.currentStock) || 0,
                cost: parseFloat(item.baseCost) || 0,
                uom: item.uom || ''
            };
        });

        let html = '';
        let totalLoss = 0;
        let totalItemsCounted = 0;
        let perfectItems = 0;

        // Compare Cashier's count to the Live Database!
        counts.forEach(countObj => {
            let name = countObj.name;
            let physQty = parseFloat(countObj.physicalQty) || 0;
            let dbItem = liveStockDb[name] || { qty: 0, cost: 0, uom: '' };
            
            let sysQty = dbItem.qty;
            let variance = physQty - sysQty;
            let loss = variance < 0 ? Math.abs(variance) * dbItem.cost : 0;
            
            totalLoss += loss;
            totalItemsCounted++;
            if (variance === 0) perfectItems++;

            let varColor = variance < 0 ? '#dc2626' : (variance > 0 ? '#16a34a' : '#64748b');
            let varText = variance === 0 ? 'Perfect' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)} ${dbItem.uom}`;

            html += `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 10px; font-weight: bold; color: #334155;">${name}</td>
                    <td style="padding: 10px; color: #64748b;">${sysQty.toFixed(1)} ${dbItem.uom}</td>
                    <td style="padding: 10px; font-weight: bold; color: #0284c7;">${physQty.toFixed(1)} ${dbItem.uom}</td>
                    <td style="padding: 10px; font-weight: bold; color: ${varColor};">${varText}</td>
                    <td style="padding: 10px; text-align: right; color: #dc2626; font-weight: bold;">${loss > 0 ? `₱${loss.toFixed(2)}` : '-'}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 20px;">No items recorded in this audit.</td></tr>';

        let accuracy = totalItemsCounted > 0 ? (perfectItems / totalItemsCounted) * 100 : 0;
        
        document.getElementById('auditModalAccuracy').innerText = `${accuracy.toFixed(1)}%`;
        document.getElementById('auditModalLoss').innerText = `₱${totalLoss.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

        // Update the Top KPIs on the Dashboard!
        if (document.getElementById('auditAccuracy')) document.getElementById('auditAccuracy').innerText = `${accuracy.toFixed(1)}%`;
        if (document.getElementById('auditVariance')) document.getElementById('auditVariance').innerText = `₱${totalLoss.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    } catch (e) {
        console.error("Audit Details Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px; color: red;">Failed to fetch live database for comparison.</td></tr>';
    }
};

// ========================================================
// 🗑️ INVENTORY BULK DELETE ENGINE
// ========================================================
window.toggleAllInvCheckboxes = function(source) {
    let checkboxes = document.querySelectorAll('.inv-bulk-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
};

window.bulkDeleteInventory = async function() {
    let checkboxes = document.querySelectorAll('.inv-bulk-checkbox:checked');
    if (checkboxes.length === 0) {
        alert("Please select at least one item to delete.");
        return;
    }

    if (!confirm(`⚠️ WARNING: You are about to permanently delete ${checkboxes.length} items from this branch. This cannot be undone. Proceed?`)) {
        return;
    }

    try {
        for (let cb of checkboxes) {
            let docId = cb.value;
            await deleteDoc(doc(db, "inventory", docId));
        }
        alert(`✅ Successfully deleted ${checkboxes.length} items!`);
        document.getElementById('selectAllInv').checked = false; // Reset master checkbox
        window.loadInventoryData();
    } catch (error) {
        console.error("Bulk Delete Error:", error);
        alert("❌ Error deleting items. Check F12 console.");
    }
};

// ==========================================
// 📸 UPGRADED SCHEDULE DOWNLOADER ENGINE
// ==========================================
window.downloadScheduleImage = function() {
    const schedElement = document.getElementById('scheduleContainer');
    if (!schedElement || schedElement.innerHTML.trim() === '') {
        alert("No schedule has been generated yet!"); return;
    }
    
    let btn = document.getElementById('btnDownloadSched');
    let origText = btn ? btn.innerText : "📸 Download as Image";
    if (btn) {
        btn.innerText = "⏳ Building Mobile Document...";
        btn.disabled = true;
    }

    // 1. Get the beautifully formatted month name
    let monthVal = document.getElementById('monthSelector').value || '';
    let niceMonth = "Upcoming Schedule";
    if (monthVal) {
        let parts = monthVal.split('-');
        let dateObj = new Date(parts[0], parts[1] - 1);
        niceMonth = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    // 2. Identify the currently active branch to print on the header
    let activeBranch = window.currentActiveTab || 'All Branches';

    // 3. Create a hidden "Print Canvas" optimized for mobile screens
    const printWrapper = document.createElement('div');
    printWrapper.style.padding = '30px';
    printWrapper.style.background = '#ffffff';
    printWrapper.style.width = '800px'; // Mobile-friendly width!
    printWrapper.style.position = 'absolute';
    printWrapper.style.left = '-9999px'; 
    printWrapper.style.top = '0';
    printWrapper.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

    // 4. Inject strict CSS to force large, readable text and hide tab buttons
    printWrapper.innerHTML = `
        <style>
            .tab-btn { display: none !important; } /* Hide the buttons */
            .tab-content { display: none !important; } /* Hide background branches */
            .tab-content.active { display: block !important; } /* Show ONLY the active branch */
            table { width: 100% !important; border-collapse: collapse !important; margin-top: 15px !important; }
            th { background: #0f766e !important; color: white !important; padding: 14px 8px !important; font-size: 15px !important; text-align: center !important; border: 1px solid #0d9488 !important; }
            td { padding: 14px 8px !important; border: 1px solid #cbd5e1 !important; text-align: center !important; font-size: 15px !important; font-weight: bold !important; color: #334155 !important; }
            .date-col { text-align: left !important; background: #f8fafc !important; width: 120px !important; font-size: 14px !important; }
        </style>
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 3px solid #0f766e; padding-bottom: 15px;">
            <h1 style="margin: 0; color: #0f172a; font-size: 34px; font-weight: 900; letter-spacing: 2px;">TAKODEÁL</h1>
            <h2 style="margin: 5px 0 0 0; color: #0f766e; font-size: 20px; text-transform: uppercase;">Staff Schedule - ${activeBranch}</h2>
            <div style="margin-top: 8px; color: #64748b; font-weight: bold; font-size: 16px;">${niceMonth}</div>
        </div>
    `;

    // 5. Clone the schedule grid into the wrapper
    const clonedSched = schedElement.cloneNode(true);
    clonedSched.style.overflow = 'visible'; 
    clonedSched.style.maxHeight = 'none';
    printWrapper.appendChild(clonedSched);

    // 6. Inject the Official Footer
    const footer = document.createElement('div');
    footer.innerHTML = `
        <div style="text-align: center; margin-top: 25px; padding-top: 12px; border-top: 1px dashed #cbd5e1; color: #94a3b8; font-size: 13px; font-weight: bold;">
            Generated securely by Takodeal OS • ${new Date().toLocaleString('en-PH')}
        </div>
    `;
    printWrapper.appendChild(footer);

    document.body.appendChild(printWrapper);

    // 7. Take the Ultra-HD screenshot (Scale: 3 makes it incredibly crisp for zooming)
    html2canvas(printWrapper, { scale: 3, backgroundColor: "#ffffff" }).then(canvas => {
        let link = document.createElement('a');
        let safeBranchName = activeBranch.replace(/[^a-zA-Z0-9]/g, '_');
        link.download = `Takodeal_Schedule_${safeBranchName}_${monthVal || 'Export'}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        document.body.removeChild(printWrapper);
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    }).catch(err => {
        console.error("Canvas Error:", err);
        alert("❌ Failed to capture schedule.");
        document.body.removeChild(printWrapper);
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    });
};

// ==========================================
// 📘 LEDGER & VALES HISTORY VIEWER
// ==========================================
window.viewLedgerHistory = async function(staffName) {
    document.getElementById('ledgerHistoryModal').style.display = 'flex';
    document.getElementById('ledgerHistorySubtitle').innerText = staffName;
    const tbody = document.getElementById('ledgerHistoryBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px;">⏳ Fetching records...</td></tr>';

    try {
        const q = query(collection(db, "staff_deductions"), where("staffName", "==", staffName), orderBy("dateAdded", "desc"));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(docSnap => {
            let data = docSnap.data();
            let dateStr = data.dateAdded ? data.dateAdded.toDate().toLocaleString('en-PH') : 'Unknown';
            let statusBadge = data.status === "Paid" 
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">Paid</span>`
                : `<span style="background: #fef2f2; color: #dc2626; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">Unpaid</span>`;
            
            // 🔥 NEW: MANUAL OVERRIDE BUTTON FOR STUCK VALES
            let overrideBtn = data.status === "Unpaid"
                ? `<button onclick="window.forceMarkDeductionPaid('${docSnap.id}', '${staffName}')" style="background:#16a34a; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Mark Paid</button>`
                : `<span style="font-size:11px; color:#94a3b8;">Cleared</span>`;

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; color: #64748b; font-size: 12px;">${dateStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #334155;">${data.type}</td>
                    <td style="padding: 12px; font-style: italic; color: #475569;">System Deduction</td>
                    <td style="padding: 12px;">${statusBadge}</td>
                    <td style="padding: 12px; text-align: right; font-weight: bold; color: #ea580c;">₱${(data.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px; text-align: center;">${overrideBtn}</td>
                </tr>
            `;
        });

        // Inject a 6th column header dynamically
        let headerRow = tbody.previousElementSibling.querySelector('tr');
        if (headerRow.children.length === 5) {
            let th = document.createElement('th');
            th.style.cssText = "padding: 12px 10px; color: #475569; text-align: center;";
            th.innerText = "Action";
            headerRow.appendChild(th);
        }

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No vales or meals on record.</td></tr>';
    } catch (e) {
        console.error("Ledger History Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px; color: red;">Failed to fetch history.</td></tr>';
    }
};

window.forceMarkDeductionPaid = async function(docId, staffName) {
    if (!confirm(`⚠️ Are you sure you want to manually mark this Vale/Meal as PAID?\n\nThis will instantly remove it from ${staffName}'s outstanding balance.`)) return;
    try {
        await updateDoc(doc(db, "staff_deductions", docId), {
            status: "Paid",
            paidAt: serverTimestamp(),
            manualOverride: true
        });
        alert("✅ Deduction successfully marked as Paid!");
        window.viewLedgerHistory(staffName); // Refresh modal
        if (typeof window.loadLedger === 'function') window.loadLedger(); // Refresh background table
    } catch (e) {
        console.error(e);
        alert("❌ Failed to update deduction status.");
    }
};

// ========================================================
// 🗑️ MANAGER APP WASTE LOG DASHBOARD
// ========================================================
window.loadWasteTabLogs = async function() {
    const tbody = document.getElementById('wasteTabBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px;">Fetching waste logs...</td></tr>';
    
    let branchFilter = document.getElementById('invBranchFilter').value;
    
    try {
        // Fetch inventory base costs to calculate waste value
        const invSnap = await getDocs(collection(db, "inventory"));
        let invCosts = {};
        invSnap.forEach(d => {
            let item = d.data();
            invCosts[`${item.branch}_${item.name}`] = parseFloat(item.baseCost) || 0;
        });
        
        const q = query(collection(db, "stock_logs"), where("type", "==", "Waste / Spoilage"), orderBy("timestamp", "desc"), limit(100));
        const snap = await getDocs(q);
        
        let html = '';
        let totalWasteCount = 0;
        let totalValueLost = 0;
        
        snap.forEach(docSnap => {
            let data = docSnap.data();
            if (branchFilter !== "All" && data.branch !== branchFilter) return;
            
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            let qtyLost = Math.abs(data.variance || 0);
            
            // Calculate Financial Impact!
            let unitCost = invCosts[`${data.branch}_${data.item}`] || 0;
            let valueLost = qtyLost * unitCost;
            
            totalWasteCount++;
            totalValueLost += valueLost;
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 12px;"><span class="badge badge-open">${data.branch}</span></td>
                    <td style="padding: 12px; font-weight: bold; color: #334155;">${data.user || 'System'}</td>
                    <td style="padding: 12px; font-weight: bold; color: #b91c1c;">${data.item}</td>
                    <td style="padding: 12px; font-weight: 900; color: #ef4444; font-size: 15px;">-${qtyLost} <span style="font-size: 11px; font-weight: normal; color: #94a3b8;">${data.uom || ''}</span><br><span style="font-size: 10px; color: #64748b;">(₱${valueLost.toFixed(2)})</span></td>
                    <td style="padding: 12px; color: #475569; font-style: italic;">${data.note || 'No reason provided'}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No waste records found for this branch.</td></tr>';
        
        if(document.getElementById('wasteTotalCount')) document.getElementById('wasteTotalCount').innerText = totalWasteCount;
        if(document.getElementById('wasteTotalValue')) document.getElementById('wasteTotalValue').innerText = `₱${totalValueLost.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        
    } catch (e) {
        console.error("Waste Tab Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px; color: red;">Failed to load waste logs. Check console.</td></tr>';
    }
};

window.editSalesTarget = async function() {
    let newTarget = prompt("Enter new Monthly Sales Target (₱):");
    if (!newTarget || isNaN(newTarget)) return;
    
    await setDoc(doc(db, "settings", "sales_target"), {
        amount: parseFloat(newTarget),
        updatedAt: serverTimestamp()
    });
    window.loadMonthlyTarget();
};

window.loadMonthlyTarget = async function() {
    try {
        const snap = await getDoc(doc(db, "settings", "sales_target"));
        let targetAmount = snap.exists() ? (parseFloat(snap.data().amount) || 0) : 0;
        
        let now = new Date();
        let firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        let lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        let daysInMonth = lastDay.getDate();
        let currentDay = now.getDate();
        let daysLeft = daysInMonth - currentDay + 1; // +1 includes today
        
        const q = query(collection(db, "transactions"), where("timestamp", ">=", firstDay));
        const txSnap = await getDocs(q);
        
        let mtdSales = 0;
        txSnap.forEach(d => {
            let tx = d.data();
            if (tx.status !== 'Voided') {
                // 🔥 THE NEW NET REVENUE ENGINE
                // Scans every payment method. If it's Grab, it automatically deducts 18% Commission!
                if (tx.splitDetails && tx.splitDetails.length > 0) {
                    tx.splitDetails.forEach(split => {
                        let amount = parseFloat(split.amount) || 0;
                        if (split.method === 'Grab') {
                            mtdSales += (amount * 0.82); // Removes 18%
                        } else {
                            mtdSales += amount;
                        }
                    });
                } else {
                    let amount = parseFloat(tx.netTotal) || 0;
                    if (tx.paymentMethod === 'Grab') {
                        mtdSales += (amount * 0.82); // Removes 18%
                    } else {
                        mtdSales += amount;
                    }
                }
            }
        });
        
        let percent = targetAmount > 0 ? (mtdSales / targetAmount) * 100 : 0;
        if (percent > 100) percent = 100;
        
        let expectedPace = targetAmount > 0 ? (targetAmount / daysInMonth) * currentDay : 0;
        let isBehind = mtdSales < expectedPace;
        
        let remainingToTarget = targetAmount - mtdSales;
        let requiredDaily = remainingToTarget > 0 ? remainingToTarget / daysLeft : 0;
        
        document.getElementById('targetGoalAmount').innerText = `₱${targetAmount.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('targetMtdSales').innerText = `MTD Sales (Net 18%): ₱${mtdSales.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('targetProgressBar').style.width = `${percent}%`;
        document.getElementById('targetProgressText').innerText = `${percent.toFixed(1)}% Completed`;
        
        document.getElementById('targetDaysLeft').innerText = `${daysLeft} days left`;
        document.getElementById('targetRequiredDaily').innerText = `₱${requiredDaily.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        
        let statusEl = document.getElementById('targetStatusText');
        let paceEl = document.getElementById('targetPaceText');
        
        if (targetAmount === 0) {
            statusEl.innerText = "Target Not Set";
            statusEl.style.color = "#94a3b8";
            paceEl.innerText = "Click Edit Target to begin";
            paceEl.style.color = "#94a3b8";
        } else if (remainingToTarget <= 0) {
            statusEl.innerText = "🏆 Target Hit!";
            statusEl.style.color = "#10b981";
            paceEl.innerText = "Goal achieved!";
            paceEl.style.color = "#10b981";
        } else if (isBehind) {
            statusEl.innerText = "Behind Target";
            statusEl.style.color = "#ef4444";
            paceEl.innerText = `₱${(expectedPace - mtdSales).toLocaleString(undefined, {minimumFractionDigits:2})} below pace`;
            paceEl.style.color = "#ef4444";
        } else {
            statusEl.innerText = "🔥 On Pace";
            statusEl.style.color = "#10b981";
            paceEl.innerText = `₱${(mtdSales - expectedPace).toLocaleString(undefined, {minimumFractionDigits:2})} ahead of pace`;
            paceEl.style.color = "#10b981";
        }
        
    } catch(e) {
        console.error("Dashboard Target Error:", e);
    }
};

// 🔥 THE BULLETPROOF AUTO-LOADER
window.hasLoadedSalesTarget = false;

// 1. Hook into your standard tab switching
if (typeof window.switchManagerTab === 'function') {
    const originalSwitchTab = window.switchManagerTab;
    window.switchManagerTab = function(tabName) {
        originalSwitchTab(tabName);
        window.loadMonthlyTarget(); 
    };
}

// 2. Watchdog: Checks every 2 seconds if the widget loaded properly
setInterval(() => {
    let targetUI = document.getElementById('targetGoalAmount');
    // If the widget is on the screen, but hasn't loaded data yet, force a fetch!
    if (targetUI && !window.hasLoadedSalesTarget) {
        window.loadMonthlyTarget();
        window.hasLoadedSalesTarget = true; 
    }
}, 2000);

// Reset the watchdog if they edit the target
const originalEditTarget = window.editSalesTarget;
window.editSalesTarget = async function() {
    window.hasLoadedSalesTarget = false; 
    await originalEditTarget();
};

// ========================================================
// 🧠 TAKODEÁL CEO AI ORACLE ENGINE (INDEX-FREE)
// ========================================================

window.generateAIReport = async function() {
    let branch = document.getElementById('aiBranchSelect').value;
    let days = parseInt(document.getElementById('aiDaysSelect').value);
    
    document.getElementById('aiStatsGrid').style.display = 'none';
    document.getElementById('aiReportContainer').style.display = 'none';
    document.getElementById('aiLoadingUI').style.display = 'block';

    let startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0,0,0,0);

    try {
        // 1. GATHER DATA SOURCES (THE INDEX-FREE WAY)
        // We only ask Firebase to filter by Date. We do everything else locally!
        const qWaste = query(collection(db, "stock_logs"), where("timestamp", ">=", startDate));
        const qShifts = query(collection(db, "shifts"), where("startTime", ">=", startDate));
        const qInventory = query(collection(db, "inventory"), where("branch", "==", branch));

        const [wasteSnap, shiftSnap, invSnap] = await Promise.all([getDocs(qWaste), getDocs(qShifts), getDocs(qInventory)]);

        let branchInv = {};
        invSnap.forEach(doc => { branchInv[doc.data().name] = parseFloat(doc.data().baseCost) || 0; });

        // 2. CRUNCH WASTE DATA
        let totalWasteValue = 0;
        let itemWasteMap = {};
        let missingInventoryEvents = 0;

        wasteSnap.forEach(doc => {
            let data = doc.data();
            
            // 🛑 JAVASCRIPT FILTERING: Skip items that don't belong to this branch or aren't waste!
            if (data.branch !== branch) return;
            if (data.type !== "Waste / Spoilage" && data.type !== "Shift Close Variance") return;

            let qtyLost = Math.abs(data.variance || 0);
            let itemName = data.item;
            
            let costPerUnit = branchInv[itemName] || 0;
            let valueLost = qtyLost * costPerUnit;

            totalWasteValue += valueLost;

            if (!itemWasteMap[itemName]) itemWasteMap[itemName] = { qty: 0, value: 0 };
            itemWasteMap[itemName].qty += qtyLost;
            itemWasteMap[itemName].value += valueLost;

            if (data.type === "Shift Close Variance") missingInventoryEvents++;
        });

        let topWastedItem = "None";
        let maxWasteValue = 0;
        for (let item in itemWasteMap) {
            if (itemWasteMap[item].value > maxWasteValue) {
                maxWasteValue = itemWasteMap[item].value;
                topWastedItem = item;
            }
        }

        // 3. CRUNCH SHIFT AUDIT DATA
        let totalShifts = 0;
        let shiftsWithCashVariance = 0;
        let totalCashShortage = 0;
        let totalSales = 0;

        shiftSnap.forEach(doc => {
            let data = doc.data();
            
            // 🛑 JAVASCRIPT FILTERING: Skip if wrong branch or not closed
            if (data.branch !== branch) return;
            if (data.status !== "Closed") return;

            totalShifts++;
            let cSales = data.totalCashSales !== undefined ? data.totalCashSales : (data.grossSales || 0);
            totalSales += cSales + (data.totalDigitalSales || 0);
            
            if (data.difference && Math.abs(data.difference) > 5) { // Allowance of 5 pesos
                shiftsWithCashVariance++;
                if (data.difference < 0) totalCashShortage += Math.abs(data.difference);
            }
        });

        // 4. CALCULATE HEALTH SCORES
        let errorEvents = shiftsWithCashVariance + missingInventoryEvents;
        let accuracyScore = totalShifts > 0 ? Math.max(0, 100 - ((errorEvents / (totalShifts * 2)) * 100)) : 100;
        let avgSalesPerDay = days > 0 ? totalSales / days : 0;

        // 5. UPDATE UI CARDS
        document.getElementById('aiStatWaste').innerText = `₱${totalWasteValue.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('aiStatAccuracy').innerText = `${accuracyScore.toFixed(0)}%`;
        document.getElementById('aiStatAccuracy').style.color = accuracyScore > 85 ? "#16a34a" : "#dc2626";
        document.getElementById('aiStatTopWaste').innerText = topWastedItem === "None" ? "Looking Good!" : `${topWastedItem}\n(₱${maxWasteValue.toFixed(2)} lost)`;
        document.getElementById('aiStatShortage').innerText = `₱${totalCashShortage.toLocaleString(undefined, {minimumFractionDigits:2})}`;

        // 6. 🧠 THE AI TEXT GENERATION ENGINE
        let reportHTML = `<p><strong>Analysis Period:</strong> Last ${days} days at ${branch}.</p>`;

        // A. Sales & Performance
        reportHTML += `<p><strong>📈 Financial Overview:</strong> Over the last ${days} days, this branch generated <strong>₱${totalSales.toLocaleString()}</strong> in gross revenue, averaging ₱${avgSalesPerDay.toLocaleString(undefined, {maximumFractionDigits:0})} per day. `;
        if (avgSalesPerDay > 5000) reportHTML += `Volume is extremely healthy, indicating strong local demand. Keep pushing up-selling at the counter.`;
        else reportHTML += `Sales pacing is somewhat moderate. Consider launching localized promotions or checking if "Sold Out" statuses are hurting your ticket averages.`;
        reportHTML += `</p>`;

        // B. Waste & Spoilage
        reportHTML += `<p><strong>🗑️ Waste & Optimization:</strong> The system tracked <strong>₱${totalWasteValue.toLocaleString(undefined, {minimumFractionDigits:2})}</strong> in lost ingredients/materials. `;
        if (totalWasteValue > 500) {
            reportHTML += `This is a direct hit to your net margin. The primary culprit is <strong>${topWastedItem}</strong>. <span style="color:#dc2626; font-weight:bold;">Action Required:</span> Immediately review portion control and storage protocols for ${topWastedItem} with the kitchen staff.`;
        } else {
            reportHTML += `<span style="color:#16a34a; font-weight:bold;">Great job!</span> Spoilage is being kept to an absolute minimum, protecting your COGS.`;
        }
        reportHTML += `</p>`;

        // C. Staff Accountability
        reportHTML += `<p><strong>⚖️ Staff Integrity & Accuracy:</strong> Based on the Z-Readings and Blind Inventory counts, your staff's operational accuracy is rated at <strong>${accuracyScore.toFixed(0)}%</strong>. `;
        if (accuracyScore < 85) {
            reportHTML += `<span style="color:#dc2626; font-weight:bold;">Critical Alert:</span> There were ${missingInventoryEvents} instances of missing physical stock and ₱${totalCashShortage.toLocaleString()} in missing drawer cash. You must confront the specific cashiers on duty during these shortages and mandate the use of Reason Letters.`;
        } else if (accuracyScore < 95) {
            reportHTML += `Accuracy is acceptable, but minor variances in stock and cash were detected. Remind cashiers to double-check their change and carefully input waste records before closing.`;
        } else {
            reportHTML += `<span style="color:#16a34a; font-weight:bold;">Excellent.</span> Drawer counts and stock audits are perfectly aligned. Your staff is executing the end-of-shift SOP flawlessly.`;
        }
        reportHTML += `</p>`;

        // D. Final Strategic Verdict
        reportHTML += `<div style="background:#f8fafc; padding:15px; border-left:4px solid #8b5cf6; margin-top:20px; border-radius:4px;">
            <strong style="color:#4c1d95;">👑 CEO Action Plan:</strong><br>`;
        
        if (accuracyScore < 85) {
            reportHTML += `Halt expansion efforts at this branch temporarily and focus on <strong>Internal Audit</strong>. Fix the leak before pouring more marketing money into this location.`;
        } else if (totalWasteValue > 1000) {
            reportHTML += `Focus entirely on <strong>Kitchen Retraining</strong>. Your sales are fine, but you are throwing profits in the trash. Print the kitchen recipes and enforce strict adherence to the BOM.`;
        } else {
            reportHTML += `Operations are stable and highly profitable. Your focus here should shift to <strong>Scaling & Marketing</strong>. Push your staff to up-sell addons to increase the average ticket size.`;
        }
        reportHTML += `</div>`;

        document.getElementById('aiReportText').innerHTML = reportHTML;
        
        // Hide loading, show UI
        document.getElementById('aiLoadingUI').style.display = 'none';
        document.getElementById('aiStatsGrid').style.display = 'grid';
        document.getElementById('aiReportContainer').style.display = 'block';

    } catch(e) {
        console.error("AI Report Error:", e);
        document.getElementById('aiLoadingUI').innerHTML = `<span style="color:red; font-size:18px;">❌ Critical Error: Could not compile data.</span>`;
    }
};

// Hook the AI tab into the existing navigation
const originalSwitchView = window.switchView;
window.switchView = function (viewId) {
    originalSwitchView(viewId);
    if (viewId === 'reports') {
        document.getElementById('pageTitle').innerText = "🧠 AI Oracle & Insights";
        window.generateAIReport(); // Auto-runs when clicked!
    }
};

// ========================================================
// 🧠 TAKODEAL FORECASTER ENGINE
// ========================================================
window.loadForecasterEngine = async function() {
    let container = document.getElementById('forecasterGrid');
    let branch = document.getElementById('forecasterBranchSelect').value;
    
    if (!container) return;
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #0f766e; font-size: 18px; font-weight: bold;">⏳ Scanning 14 days of data... Please wait.</div>';

    try {
        // 📸 FETCH MENU IMAGES FOR THE CARDS!
        const menuSnap = await getDocs(collection(db, "menu"));
        let itemImages = {};
        menuSnap.forEach(doc => { 
            let d = doc.data();
            if (d.image) itemImages[d.name] = d.image; 
        });

        const invQ = query(collection(db, "inventory"), where("branch", "==", branch));
        const invSnap = await getDocs(invQ);
        let inventory = [];
        invSnap.forEach(doc => inventory.push({ id: doc.id, ...doc.data() }));

        let daysToScan = 14;
        let pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - daysToScan);
        pastDate.setHours(0,0,0,0);

        const logsQ = query(collection(db, "stock_logs"), where("branch", "==", branch), where("timestamp", ">=", pastDate));
        const logsSnap = await getDocs(logsQ);

        let burnData = {}; 
        logsSnap.forEach(docSnap => {
            let log = docSnap.data();
            if (log.variance < 0 && (log.type.includes("Auto-Deduct") || log.type.includes("Waste") || log.type.includes("Spoilage") || log.type.includes("Prep"))) {
                if (!burnData[log.item]) burnData[log.item] = 0;
                burnData[log.item] += Math.abs(log.variance);
            }
        });

        let html = '';
        let today = new Date();

        inventory.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
            let totalBurned = burnData[item.name] || 0;
            let avgDailyBurn = totalBurned / daysToScan;
            let currentStock = parseFloat(item.currentStock) || 0;
            let uom = item.uom || 'units';

            let daysLeft = Infinity;
            if (avgDailyBurn > 0) daysLeft = currentStock / avgDailyBurn;

            let statusColor = "#16a34a"; let statusBg = "#f0fdf4"; let warningIcon = "✅";
            let dLeftStr = daysLeft === Infinity ? "∞" : daysLeft.toFixed(1);
            let avgDailyStr = avgDailyBurn === 0 ? "0.0" : avgDailyBurn.toFixed(1);
            let runOutDateStr = "Sufficient Stock";

            // 📉 STRICT HANDLING OF NEGATIVE INVENTORY
            if (currentStock < 0) {
                statusColor = "#dc2626"; statusBg = "#fef2f2"; warningIcon = "🚨"; 
                dLeftStr = "0.0";
                runOutDateStr = "NEGATIVE STOCK (Audit Needed)";
            } else if (daysLeft <= 0 || currentStock === 0) {
                statusColor = "#dc2626"; statusBg = "#fef2f2"; warningIcon = "🚨"; 
                dLeftStr = "0.0";
                runOutDateStr = "Out of Stock Now";
            } else if (daysLeft <= 3) {
                statusColor = "#dc2626"; statusBg = "#fef2f2"; warningIcon = "⚠️";
            } else if (daysLeft <= 7) {
                statusColor = "#ea580c"; statusBg = "#fff7ed"; warningIcon = "⚡";
            }

            if (currentStock > 0 && daysLeft !== Infinity && daysLeft > 0) {
                let runOutDate = new Date();
                runOutDate.setDate(today.getDate() + daysLeft);
                runOutDateStr = runOutDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }

            // 📸 PHOTOS INJECTION
            let photoHtml = itemImages[item.name] 
                ? `<img src="${itemImages[item.name]}" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">` 
                : `<div style="width: 40px; height: 40px; border-radius: 8px; background: #f8fafc; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 1px solid #e2e8f0;">📦</div>`;

            html += `
                <div style="background: white; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.03); overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column;">
                    <div style="padding: 15px 20px; border-bottom: 1px solid #f1f5f9; display: flex; gap: 15px; align-items: center;">
                        ${photoHtml}
                        <div>
                            <h3 style="margin: 0; font-size: 15px; color: #0f172a;">${item.name}</h3>
                            <span style="font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">${branch}</span>
                        </div>
                    </div>
                    <div style="padding: 20px; display: flex; align-items: center; justify-content: space-between; background: #fdfdfd; flex: 1;">
                        <div style="font-size: 13px; color: #475569; line-height: 1.8;">
                            <span style="color: #64748b;">Current Stock:</span> <strong style="color: ${currentStock < 0 ? '#dc2626' : '#0f172a'}; font-size: 14px;">${currentStock.toLocaleString()} ${uom}</strong><br>
                            <span style="color: #64748b;">Daily Burn Rate:</span> <strong style="color: ${statusColor}; font-size: 14px;">${avgDailyStr} ${uom} / day</strong>
                        </div>
                        <div style="text-align: center; background: ${statusBg}; padding: 12px; border-radius: 12px; border: 1px dashed ${statusColor}; min-width: 80px;">
                            <div style="font-size: 24px; font-weight: 900; color: ${statusColor};">${dLeftStr}</div>
                            <div style="font-size: 10px; font-weight: bold; color: ${statusColor}; text-transform: uppercase;">Days Left</div>
                        </div>
                    </div>
                    <div style="background: ${statusBg}; padding: 12px 20px; font-size: 12px; color: ${statusColor}; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9;">
                        <span>${warningIcon} Run-Out Date:</span><span>${runOutDateStr}</span>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #94a3b8;">No inventory found.</div>';
    } catch (error) {
        console.error("Forecaster Error:", error);
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #ef4444; font-weight: bold;">❌ Failed to run Forecast. Check connection.</div>';
    }
};

// ========================================================
// 📝 MASTER GENERAL AUDIT ENGINE (WITH SMART SYNC)
// ========================================================
window.globalAuditItems = [];

window.openGeneralAuditModal = function() {
    document.getElementById('generalAuditModal').style.display = 'flex';
    document.getElementById('auditModalBranch').value = '';
    document.getElementById('auditModalSearch').value = '';
    document.getElementById('auditModalBody').innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 40px; color:#94a3b8; font-weight: bold;">Select a branch above to begin the audit...</td></tr>';
};

window.loadAuditModalItems = async function() {
    let branch = document.getElementById('auditModalBranch').value;
    let tbody = document.getElementById('auditModalBody');
    
    if (!branch) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 40px; color:#94a3b8; font-weight: bold;">Select a branch above to begin the audit...</td></tr>';
        return;
    }

    tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 40px; color: #ea580c; font-weight: bold;">⏳ Loading inventory for ${branch}...</td></tr>`;
    window.globalAuditItems = [];

    try {
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        
        snap.forEach(docSnap => {
            let data = docSnap.data();
            window.globalAuditItems.push({
                id: docSnap.id,
                name: data.name || 'Unnamed Item',
                category: data.category || 'Uncategorized',
                systemQty: parseFloat(data.currentStock) || 0,
                uom: data.uom || 'units',
                tempValue: undefined // Memory for search filtering
            });
        });

        window.globalAuditItems.sort((a,b) => a.name.localeCompare(b.name));
        window.renderAuditModalItems();

    } catch (e) {
        console.error("Audit Modal Load Error:", e);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:red; padding: 40px;">Failed to fetch inventory from cloud.</td></tr>';
    }
};

window.renderAuditModalItems = function() {
    let search = document.getElementById('auditModalSearch').value.toLowerCase();
    let tbody = document.getElementById('auditModalBody');
    let html = '';

    window.globalAuditItems.forEach((item, index) => {
        // Search Filter
        if (search && !item.name.toLowerCase().includes(search) && !item.category.toLowerCase().includes(search)) return;

        // Restore value from memory if they previously typed it
        let displayValue = item.tempValue !== undefined ? item.tempValue : '';

        html += `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px; font-weight: bold; color: #1e293b; font-size: 14px;">${item.name}</td>
                <td style="padding: 12px; text-align: center;"><span class="badge badge-closed">${item.category}</span></td>
                <td style="padding: 12px; text-align: center; font-weight: bold; color: #64748b; font-size: 15px;">${item.systemQty.toFixed(1)} <span style="font-size:11px; font-weight:normal;">${item.uom}</span></td>
                <td style="padding: 12px; text-align: center; border-left: 2px dashed #e2e8f0; background: #fffcf0;">
                    <input type="number" onchange="window.globalAuditItems[${index}].tempValue = parseFloat(this.value)" value="${displayValue}" placeholder="${item.systemQty.toFixed(1)}" style="width: 100%; max-width: 120px; padding: 10px; border: 2px solid #fdba74; border-radius: 6px; text-align: center; font-weight: 900; color: #ea580c; font-size: 16px; outline: none;">
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding: 40px; color:#94a3b8; font-weight: bold;">No items match your search.</td></tr>';
};

window.submitGeneralAudit = async function() {
    let branch = document.getElementById('auditModalBranch').value;
    if (!branch) { alert("Please select a branch first."); return; }

    if (!confirm(`⚠️ CRITICAL ACTION: Are you sure you want to finalize this audit for ${branch}?\n\nThis will force-sync the live database to match your physical counts.`)) return;

    let btn = document.getElementById('btnSubmitGeneralAudit');
    btn.innerText = "⏳ Syncing Database..."; btn.disabled = true;

    try {
        let auditCounts = [];

        // 1. Process all items
        for (let i = 0; i < window.globalAuditItems.length; i++) {
            let item = window.globalAuditItems[i];
            
            // If they didn't type anything, assume the count is perfect
            let physicalQty = item.tempValue !== undefined && !isNaN(item.tempValue) ? item.tempValue : item.systemQty;

            // If a variance is detected, push it to the database
            if (physicalQty !== item.systemQty) {
                let variance = physicalQty - item.systemQty;
                
                // Update Live Inventory
                await updateDoc(doc(db, "inventory", item.id), { currentStock: physicalQty });

                // Write to History Logs so the CEO AI can track it
                await addDoc(collection(db, "stock_logs"), {
                    branch: branch,
                    item: item.name,
                    uom: item.uom,
                    oldQty: item.systemQty,
                    newQty: physicalQty,
                    variance: variance,
                    type: "Manager General Audit",
                    note: "Live Sync via Audit Tool",
                    user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
                    timestamp: serverTimestamp()
                });
            }

            // Always add to the Master Audit Record
            auditCounts.push({
                name: item.name,
                systemQty: item.systemQty,
                physicalQty: physicalQty
            });
        }

        // 2. Save the overarching Audit Record to stock_counts
        await addDoc(collection(db, "stock_counts"), {
            branch: branch,
            cashier: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp(),
            counts: auditCounts
        });

        alert(`✅ Audit Complete! Live inventory for ${branch} has been strictly synchronized.`);
        document.getElementById('generalAuditModal').style.display = 'none';
        
        // Refresh the UI
        window.loadInventoryAudits(); 
        if (typeof window.loadInventoryData === 'function') window.loadInventoryData();

    } catch (e) {
        console.error("Audit Sync Error:", e);
        alert("❌ Failed to sync audit. Check F12 console.");
    } finally {
        btn.innerText = "💾 Sync & Finalize Audit"; btn.disabled = false;
    }
};

// ========================================================
// 🏢 MULTI-TENANT BRANCH EXPANSION ENGINE (WITH MAP & SETTINGS)
// ========================================================
window.globalActiveBranches = ["Main Office", "Cabantian", "Citygate", "Maa"]; 
window.branchMapInstance = null;
window.branchMarker = null;

window.loadBranchManager = async function() {
    const tbody = document.getElementById('branchManagerListBody');
    if(!tbody) return;
    
    try {
        const q = query(collection(db, "branches"), orderBy("createdAt", "asc"));
        const snap = await getDocs(q);
        
        let html = '';
        let branches = [];
        window.globalBranchData = {}; // Memory cache for settings
        
        snap.forEach(docSnap => {
            let d = docSnap.data();
            branches.push(d.name);
            window.globalBranchData[docSnap.id] = d;

            let dateStr = d.createdAt ? d.createdAt.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Core System';
            
            let delBtn = d.isCore 
                ? `<span style="color:#94a3b8; font-size: 11px; font-style: italic;">Protected</span>` 
                : `<button onclick="window.deleteBranch('${docSnap.id}', '${d.name}')" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>`;

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; font-weight: bold; color: #4c1d95; font-size: 15px;">📍 ${d.name}</td>
                    <td style="padding: 12px;"><span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">Online</span></td>
                    <td style="padding: 12px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 12px; display: flex; gap: 5px;">
                        <button onclick="window.openBranchSettings('${docSnap.id}')" style="background:#f8fafc; color:#334155; border:1px solid #cbd5e1; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">⚙️ Settings</button>
                        ${delBtn}
                    </td>
                </tr>
            `;
        });
        
        if (snap.empty) {
            await window.initializeCoreBranches();
            return;
        }

        tbody.innerHTML = html;
        window.globalActiveBranches = branches;
        window.injectDynamicBranchDropdowns(); 
        
    } catch (e) {
        console.error("Branch Manager Error:", e);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:red;">Error loading branches.</td></tr>';
    }
};

window.initializeCoreBranches = async function() {
    let core = ["Main Office", "Cabantian", "Citygate", "Maa"];
    for (let b of core) {
        await addDoc(collection(db, "branches"), { name: b, isCore: true, createdAt: serverTimestamp() });
    }
    window.loadBranchManager();
};

window.openAddBranchModal = function() {
    document.getElementById('addBranchModal').style.display = 'flex';
    document.getElementById('newBranchName').value = '';
    
    // 🗺️ LAUNCH THE LEAFLET MAP ENGINE
    setTimeout(() => {
        if (!window.branchMapInstance) {
            // Default center perfectly over Davao City
            window.branchMapInstance = L.map('branchMap').setView([7.1907, 125.4553], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(window.branchMapInstance);
            
            window.branchMarker = L.marker([7.1907, 125.4553], {draggable: true}).addTo(window.branchMapInstance);
            
            // Listen for dragging the pin to save exact coordinates
            window.branchMarker.on('dragend', function(event) {
                var position = window.branchMarker.getLatLng();
                document.getElementById('newBranchLat').value = position.lat;
                document.getElementById('newBranchLng').value = position.lng;
            });

            // Set default hidden values immediately
            document.getElementById('newBranchLat').value = 7.1907;
            document.getElementById('newBranchLng').value = 125.4553;
        }
        window.branchMapInstance.invalidateSize(); // Fixes rendering glitch inside hidden modals
    }, 300);
};

window.saveNewBranch = async function() {
    let name = document.getElementById('newBranchName').value.trim();
    let lat = document.getElementById('newBranchLat').value;
    let lng = document.getElementById('newBranchLng').value;

    if (!name) return alert("Branch name is required!");
    if (window.globalActiveBranches.includes(name)) return alert("A branch with this name already exists!");

    let btn = document.getElementById('btnSaveNewBranch');
    btn.innerText = "⏳ Provisioning..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "branches"), { 
            name: name, 
            isCore: false, 
            latitude: lat,
            longitude: lng,
            printerSize: "58mm", // Default settings for the new cashier app
            createdAt: serverTimestamp() 
        });
        alert(`🎉 Congratulations! ${name} is now online and mapped at [${lat}, ${lng}].`);
        document.getElementById('addBranchModal').style.display = 'none';
        window.loadBranchManager();
    } catch (e) {
        console.error(e); alert("Failed to add branch.");
    } finally {
        btn.innerText = "🚀 Launch Branch"; btn.disabled = false;
    }
};

window.deleteBranch = async function(docId, name) {
    if (!confirm(`⚠️ CRITICAL WARNING!\n\nAre you sure you want to delete the branch: ${name}?`)) return;
    let confirmText = prompt(`Type DELETE to confirm removal of ${name}:`);
    if (confirmText !== "DELETE") return;

    try {
        await deleteDoc(doc(db, "branches", docId));
        alert(`🗑️ ${name} has been taken offline.`);
        window.loadBranchManager();
    } catch (e) { console.error(e); alert("Failed to delete branch."); }
};

// ⚙️ CENTRAL SETTINGS CONTROLLER
window.openBranchSettings = function(docId) {
    let d = window.globalBranchData[docId];
    if (!d) return;

    document.getElementById('settingBranchId').value = docId;
    document.getElementById('branchSettingsTitle').innerText = `⚙️ ${d.name} Settings`;
    document.getElementById('settingAddress').value = d.address || '';
    document.getElementById('settingContact').value = d.contact || '';
    document.getElementById('settingWifi').value = d.wifi || '';
    document.getElementById('settingPrinterSize').value = d.printerSize || '58mm';

    document.getElementById('branchSettingsModal').style.display = 'flex';
};

window.saveBranchSettings = async function() {
    let docId = document.getElementById('settingBranchId').value;
    let payload = {
        address: document.getElementById('settingAddress').value.trim(),
        contact: document.getElementById('settingContact').value.trim(),
        wifi: document.getElementById('settingWifi').value.trim(),
        printerSize: document.getElementById('settingPrinterSize').value
    };

    try {
        await updateDoc(doc(db, "branches", docId), payload);
        alert(`✅ Settings pushed globally! The Cashier App at this branch will update automatically.`);
        document.getElementById('branchSettingsModal').style.display = 'none';
        window.loadBranchManager();
    } catch (e) { console.error(e); alert("Failed to push settings."); }
};

// 💉 THE DOM INJECTOR
window.injectDynamicBranchDropdowns = function() {
    const standardSelects = ['empBranchAssign', 'manAttBranch', 'newAccBranch', 'newBudgetBranch', 'newInvBranch', 'editInvBranch', 'batchBranch', 'dispFrom', 'dispTo'];
    const filterSelects = ['invBranchFilter', 'zReadingBranchFilter', 'transferBranchFilter', 'branchAlertFilter', 'histBranchFilter', 'burnRateBranch', 'auditModalBranch', 'forecasterBranchSelect', 'aiBranchSelect'];
    
    let stdHtml = '';
    let filterHtml = '<option value="All">🌐 All Branches</option>';
    let plainFilterHtml = '<option value="">-- Choose Branch --</option>'; 

    window.globalActiveBranches.forEach(b => {
        let icon = b === "Main Office" ? "🏢" : "📍";
        let label = `${icon} ${b}`;
        
        stdHtml += `<option value="${b}">${b}</option>`;
        filterHtml += `<option value="${b}">${label}</option>`;
        plainFilterHtml += `<option value="${b}">${b}</option>`;
    });

    standardSelects.forEach(id => {
        let el = document.getElementById(id);
        if (el) { let oldVal = el.value; el.innerHTML = stdHtml; if (oldVal) el.value = oldVal; }
    });

    filterSelects.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            let oldVal = el.value;
            if (id === 'burnRateBranch' || id === 'auditModalBranch' || id === 'forecasterBranchSelect') el.innerHTML = plainFilterHtml;
            else el.innerHTML = filterHtml;
            if (oldVal) el.value = oldVal;
        }
    });

    if (typeof branchConfig !== 'undefined') {
        window.globalActiveBranches.forEach(b => {
            if (b !== "Main Office" && !branchConfig[b]) {
                branchConfig[b] = JSON.parse(JSON.stringify(defaultSchedConfig["Cabantian"] || [])); 
            }
        });
    }
};

// Fire the engine up as soon as the app loads!
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { 
        if (typeof window.loadBranchManager === 'function') window.loadBranchManager(); 
    }, 1500); 
});

window.initializeCoreBranches = async function() {
    let core = ["Main Office", "Cabantian", "Citygate", "Maa"];
    for (let b of core) {
        await addDoc(collection(db, "branches"), { name: b, isCore: true, createdAt: serverTimestamp() });
    }
    window.loadBranchManager();
};

window.openAddBranchModal = function() {
    document.getElementById('addBranchModal').style.display = 'flex';
    document.getElementById('newBranchName').value = '';
};

window.saveNewBranch = async function() {
    let name = document.getElementById('newBranchName').value.trim();
    if (!name) return alert("Branch name is required!");
    
    if (window.globalActiveBranches.includes(name)) {
        return alert("A branch with this name already exists!");
    }

    let btn = document.getElementById('btnSaveNewBranch');
    btn.innerText = "⏳ Provisioning..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "branches"), { name: name, isCore: false, createdAt: serverTimestamp() });
        alert(`🎉 Congratulations! ${name} is now online and integrated into the system!`);
        document.getElementById('addBranchModal').style.display = 'none';
        window.loadBranchManager();
    } catch (e) {
        console.error(e); alert("Failed to add branch.");
    } finally {
        btn.innerText = "🚀 Launch Branch"; btn.disabled = false;
    }
};

window.deleteBranch = async function(docId, name) {
    if (!confirm(`⚠️ CRITICAL WARNING!\n\nAre you sure you want to delete the branch: ${name}?\n\nThis will remove it from all dropdowns. Existing data (sales, inventory) will still exist but might be orphaned.`)) return;
    
    let confirmText = prompt(`Type DELETE to confirm removal of ${name}:`);
    if (confirmText !== "DELETE") return;

    try {
        await deleteDoc(doc(db, "branches", docId));
        alert(`🗑️ ${name} has been taken offline.`);
        window.loadBranchManager();
    } catch (e) { console.error(e); alert("Failed to delete branch."); }
};

// 💉 THE DOM INJECTOR
window.injectDynamicBranchDropdowns = function() {
    // 1. Lists where it just needs the branch names
    const standardSelects = ['empBranchAssign', 'manAttBranch', 'newAccBranch', 'newBudgetBranch', 'newInvBranch', 'editInvBranch', 'batchBranch', 'dispFrom', 'dispTo'];
    
    // 2. Lists where it needs an "All Branches" option at the top
    const filterSelects = ['invBranchFilter', 'zReadingBranchFilter', 'transferBranchFilter', 'branchAlertFilter', 'histBranchFilter', 'burnRateBranch', 'auditModalBranch', 'forecasterBranchSelect', 'aiBranchSelect'];
    
    let stdHtml = '';
    let filterHtml = '<option value="All">🌐 All Branches</option>';
    let plainFilterHtml = '<option value="">-- Choose Branch --</option>'; // For inputs that need a blank start

    window.globalActiveBranches.forEach(b => {
        let icon = b === "Main Office" ? "🏢" : "📍";
        let label = `${icon} ${b}`;
        
        stdHtml += `<option value="${b}">${b}</option>`;
        filterHtml += `<option value="${b}">${label}</option>`;
        plainFilterHtml += `<option value="${b}">${b}</option>`;
    });

    standardSelects.forEach(id => {
        let el = document.getElementById(id);
        if (el) { let oldVal = el.value; el.innerHTML = stdHtml; if (oldVal) el.value = oldVal; }
    });

    filterSelects.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            let oldVal = el.value;
            if (id === 'burnRateBranch' || id === 'auditModalBranch' || id === 'forecasterBranchSelect') el.innerHTML = plainFilterHtml;
            else el.innerHTML = filterHtml;
            if (oldVal) el.value = oldVal;
        }
    });

    // Append to Scheduler config dynamically
    if (typeof branchConfig !== 'undefined') {
        window.globalActiveBranches.forEach(b => {
            if (b !== "Main Office" && !branchConfig[b]) {
                branchConfig[b] = JSON.parse(JSON.stringify(defaultSchedConfig["Cabantian"] || [])); 
            }
        });
    }
};

// Hook the Branch Manager to open when you visit the "Staff & Security" tab
const origSwitchViewBranches = window.switchView;
window.switchView = function (viewId) {
    origSwitchViewBranches(viewId);
    if (viewId === 'branches') {
        if (typeof window.loadBranchManager === 'function') window.loadBranchManager(); 
    }
};

// Fire the engine up as soon as the app loads!
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { 
        if (typeof window.loadBranchManager === 'function') window.loadBranchManager(); 
    }, 1500); // 1.5s delay gives Firebase time to auth
});

// ========================================================
// 📐 CENTRALIZED POS LAYOUT MANAGER
// ========================================================
window.currentLayout = [];

window.loadPosLayout = async function() {
    const listDiv = document.getElementById('posCategoryArrangementList');
    if (!listDiv) return;
    listDiv.innerHTML = '<div style="color: #64748b; text-align: center; padding: 20px;">Loading live menu categories...</div>';
    
    try {
        // 1. Fetch all unique categories currently in the database
        const menuSnap = await getDocs(collection(db, "menu"));
        let categories = new Set();
        menuSnap.forEach(d => {
            let cat = d.data().category;
            if (cat) categories.add(cat.trim());
        });
        
        // 2. Fetch the saved arrangement order from Settings
        const layoutSnap = await getDoc(doc(db, "settings", "pos_layout"));
        let layout = layoutSnap.exists() ? layoutSnap.data().categories || [] : Array.from(categories);

        // 3. Smart Merge: Add new categories that aren't in the saved layout yet
        categories.forEach(c => { 
            if (!layout.includes(c)) layout.push(c); 
        });

        // 4. Cleanup: Remove old categories that no longer exist in the menu
        layout = layout.filter(c => categories.has(c));

        window.currentLayout = layout;
        window.renderLayoutEditor();
    } catch(e) { 
        console.error("Layout Load Error:", e); 
        listDiv.innerHTML = '<div style="color: red; text-align: center;">Error loading layout data.</div>';
    }
};

window.moveLayout = function(index, direction) {
    let i = parseInt(index);
    let newIndex = i + direction;
    // Stop it from moving out of bounds
    if (newIndex < 0 || newIndex >= window.currentLayout.length) return;
    
    // Swap the array items
    let temp = window.currentLayout[i];
    window.currentLayout[i] = window.currentLayout[newIndex];
    window.currentLayout[newIndex] = temp;
    
    window.renderLayoutEditor();
};

window.renderLayoutEditor = function() {
    let listDiv = document.getElementById('posCategoryArrangementList');
    let html = '';
    window.currentLayout.forEach((cat, index) => {
        html += `
            <div style="display: flex; align-items: center; gap: 15px; background: #f8fafc; padding: 12px 15px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <button onclick="window.moveLayout('${index}', -1)" style="background: white; border: 1px solid #94a3b8; color: #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">▲ UP</button>
                    <button onclick="window.moveLayout('${index}', 1)" style="background: white; border: 1px solid #94a3b8; color: #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">▼ DOWN</button>
                </div>
                <div style="font-weight: 900; color: #1e293b; font-size: 16px; flex-grow: 1;">${cat}</div>
                <div style="font-weight: bold; font-size: 12px; color: #94a3b8;">Pos: ${index + 1}</div>
            </div>`;
    });
    listDiv.innerHTML = html;
};

window.savePosLayout = async function() {
    try {
        await setDoc(doc(db, "settings", "pos_layout"), { categories: window.currentLayout }, { merge: true });
        alert("✅ Tab arrangement saved successfully!\n\nAll Cashier Apps will reflect this exact order immediately upon refresh.");
    } catch(e) { 
        console.error(e);
        alert("❌ Failed to save layout to cloud."); 
    }
};
