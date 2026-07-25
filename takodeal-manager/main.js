import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
window.onSnapshot = onSnapshot;

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

// --- PERSISTENT LOGIN & FRANCHISEE LISTENER ---
auth.onAuthStateChanged(async (user) => {
  const loginScreen = document.getElementById('loginOverlay');
  if (user) {
    let isAuthorized = false;
    let userPerms = ['all'];
    let assignedBranch = 'Main Office'; // Default for Master
    let isFranchisee = false;

    try {
        if (user.email === MASTER_EMAIL) {
            isAuthorized = true;
            userPerms = ['all'];
            assignedBranch = 'All'; // Master sees everything
        } else {
            const q = query(collection(db, "hq_managers"), where("email", "==", user.email));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                isAuthorized = true;
                let data = snap.docs[0].data();
                userPerms = data.permissions || ['all'];
                
                // 🔥 THE FRANCHISEE LOCK
                if (data.role === 'Franchisee' && data.assignedBranch) {
                    assignedBranch = data.assignedBranch;
                    isFranchisee = true;
                } else if (data.assignedBranch) {
                    assignedBranch = data.assignedBranch;
                }
            } else {
                const checkAny = await getDocs(query(collection(db, "hq_managers"), limit(1)));
                if (checkAny.empty) {
                    await addDoc(collection(db, "hq_managers"), {
                        email: user.email, 
                        role: 'Owner', 
                        permissions: ['all'],
                        assignedBranch: 'All'
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
        branch: assignedBranch, 
        isFranchisee: isFranchisee, // Tells the app to lock dropdowns!
        cashierName: user.displayName || 'Manager',
        isOwner: (user.email === MASTER_EMAIL || (!isFranchisee && userPerms.includes('all'))), 
        permissions: userPerms
      };
      
      window.applyPermissions(); // Run the tab hider!
      if (typeof window.startPOListener === 'function') window.startPOListener();

      // 🔥 UPDATE THE SIDEBAR LOGO TEXT!
      let brandNameEl = document.getElementById('sidebarBrandName');
      if (brandNameEl) {
          brandNameEl.innerText = isFranchisee ? assignedBranch.toUpperCase() : "MAIN OFFICE";
      }
      let brDisp = document.getElementById('displayBranch');
      if (brDisp) brDisp.innerText = isFranchisee ? `📍 Franchise: ${assignedBranch}` : `📍 HQ: ${assignedBranch}`;
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

// --- ACCESS CONTROL ENGINE (FRANCHISE PROFILES) ---
window.loadAdminDashboard = async function() {
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="text-center">Loading personnel...</td></tr>';

  try {
    const snap = await getDocs(collection(db, "hq_managers"));
    let html = `
      <tr>
        <td style="padding: 15px 10px;"><strong>${MASTER_EMAIL}</strong></td>
        <td style="padding: 15px 10px;"><span class="badge badge-open">System Architect (Master Key)</span></td>
        <td style="padding: 15px 10px; color: var(--text-muted); font-size: 12px;">Cannot be removed</td>
      </tr>
    `;

    snap.forEach(docSnap => {
      let data = docSnap.data();
      let perms = data.permissions ? data.permissions.join(', ') : 'all';
      
      // 🔥 BEAUTIFUL PROFILE INJECTION
      let nameStr = data.fullName ? `<br><span style="color:#0f766e; font-size:13px; font-weight:bold;">👤 ${data.fullName}</span>` : '';
      let phoneStr = data.phone ? `<br><span style="color:#64748b; font-size:11px;">📞 ${data.phone}</span>` : '';
      
      let roleBadge = data.role === 'Franchisee' 
          ? `<span style="background:#fef3c7; color:#d97706; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px;">Franchise Owner (${data.assignedBranch})</span>`
          : `<span class="badge badge-closed">Appointed Manager</span>`;
      
      // Pass safe strings for the edit buttons
      let safePerms = data.permissions ? data.permissions.join(',') : 'all';
      let safeName = data.fullName ? data.fullName.replace(/'/g, "\\'") : '';

      html += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 15px 10px;">
            <strong style="font-size: 14px; color: #1e293b;">${data.email}</strong>
            ${nameStr}
            ${phoneStr}
            <br><span style="font-size: 11px; color: #94a3b8; display:inline-block; margin-top:4px;">Access: [${perms}]</span>
          </td>
          <td style="padding: 15px 10px;">${roleBadge}</td>
          <td style="padding: 15px 10px;">
            <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                <button class="btn-refresh" style="background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; padding:6px 10px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;" onclick="window.editManagerProfile('${docSnap.id}', '${safeName}', '${data.phone || ''}', '${data.email}')">✏️ Profile</button>
                <button class="btn-refresh" style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; padding:6px 10px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;" onclick="window.editManagerPermissions('${docSnap.id}', '${data.email}', '${safePerms}')">🔐 Access</button>
                <button class="btn-refresh" style="background: #fef2f2; color:var(--danger); border: 1px solid #fecaca; padding:6px 10px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;" onclick="removeHqManager('${docSnap.id}', '${data.email}')">✖ Revoke</button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:red;">Error loading VIP list.</td></tr>';
  }
};

window.addHqManager = async function () {
    let emailInput = document.getElementById('newManagerEmail');
    let email = emailInput.value.trim().toLowerCase();

    if (!email || !email.includes('@')) { 
        return Swal.fire('Invalid Email', 'Please enter a valid email address.', 'error'); 
    }
    if (email === MASTER_EMAIL) { 
        emailInput.value = ''; 
        return Swal.fire('Master Key', 'That is the Master Key email. It already has permanent access.', 'info'); 
    }

    try {
        const q = query(collection(db, "hq_managers"), where("email", "==", email));
        const snap = await getDocs(q);
        if (!snap.empty) {
            emailInput.value = ''; 
            return Swal.fire('Exists', 'This email is already on the VIP list!', 'warning');
        }

        // Build branch dropdown options
        let branchOptions = '';
        let branchesToAssign = window.globalActiveBranches ? window.globalActiveBranches.filter(b => b !== "Main Office") : [];
        branchesToAssign.forEach(b => { branchOptions += `<option value="${b}">${b}</option>`; });

        // 🔥 UI UPGRADE: Full Franchisee Registration Profile Form
        const { value: formValues, isConfirmed } = await Swal.fire({
            title: 'Register Control Center Access',
            html: `
                <div style="text-align: left; margin-top: 10px;">
                    <label style="font-size: 12px; font-weight: bold; color: #475569;">Email Address:</label>
                    <input type="email" id="swal-email" class="input-box" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; background: #f8fafc; outline: none;" value="${email}" readonly>

                    <label style="font-size: 12px; font-weight: bold; color: #475569;">Full Name:</label>
                    <input type="text" id="swal-name" class="input-box" placeholder="e.g. Juan Dela Cruz" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">

                    <label style="font-size: 12px; font-weight: bold; color: #475569;">Contact Number:</label>
                    <input type="text" id="swal-phone" class="input-box" placeholder="09XX XXX XXXX" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">

                    <label style="font-size: 12px; font-weight: bold; color: #475569;">Select Role:</label>
                    <select id="swal-role" class="input-box" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 15px; outline: none;" onchange="document.getElementById('swal-branch-container').style.display = this.value === 'Franchisee' ? 'block' : 'none'">
                        <option value="Manager">Standard Manager (HQ Access)</option>
                        <option value="Franchisee">Franchise Owner</option>
                    </select>

                    <div id="swal-branch-container" style="display: none;">
                        <label style="font-size: 12px; font-weight: bold; color: #475569;">Assign to Branch:</label>
                        <select id="swal-branch" class="input-box" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none;">
                            ${branchOptions}
                        </select>
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonColor: '#0f766e',
            confirmButtonText: 'Grant Access',
            customClass: { popup: 'rounded-2xl shadow-xl' },
            preConfirm: () => {
                return { 
                    name: document.getElementById('swal-name').value,
                    phone: document.getElementById('swal-phone').value,
                    role: document.getElementById('swal-role').value, 
                    branch: document.getElementById('swal-branch').value 
                };
            }
        });

        if (!isConfirmed) return; 

        let roleStr = formValues.role;
        let branchStr = formValues.role === 'Franchisee' ? formValues.branch : 'All';
        
        // 🔥 GIVES FRANCHISEES ALL THE TABS THEY NEED TO RUN THEIR STORE!
        let permissions = formValues.role === 'Franchisee' 
            ? ['dashboard', 'inventory', 'purchases', 'zreadings', 'history', 'payroll', 'schedule', 'ledger', 'inbox', 'branches'] 
            : ['all'];

        await addDoc(collection(db, "hq_managers"), {
            email: email, 
            fullName: formValues.name,
            phone: formValues.phone,
            role: roleStr, 
            assignedBranch: branchStr, 
            permissions: permissions, 
            addedAt: new Date()
        });

        Swal.fire('✅ Success!', `${formValues.name || email} has been successfully registered as a ${roleStr} for ${branchStr}.`, 'success');
        emailInput.value = '';
        window.loadAdminDashboard();

    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to register account.', 'error');
    }
};

window.editManagerProfile = async function(docId, currentName, currentPhone, email) {
    const { value: formValues, isConfirmed } = await Swal.fire({
        title: '✏️ Edit Profile',
        html: `
            <div style="text-align: left; margin-top: 10px;">
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Email (Uneditable):</label>
                <input type="text" class="input-box" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; background: #f1f5f9; outline: none; color: #94a3b8;" value="${email}" readonly>

                <label style="font-size: 12px; font-weight: bold; color: #475569;">Full Name:</label>
                <input type="text" id="edit-profile-name" class="input-box" placeholder="e.g. Juan Dela Cruz" value="${currentName}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">

                <label style="font-size: 12px; font-weight: bold; color: #475569;">Contact Number:</label>
                <input type="text" id="edit-profile-phone" class="input-box" placeholder="09XX XXX XXXX" value="${currentPhone}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#0f766e',
        confirmButtonText: 'Save Profile',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        preConfirm: () => {
            return { 
                name: document.getElementById('edit-profile-name').value.trim(),
                phone: document.getElementById('edit-profile-phone').value.trim()
            };
        }
    });

    if (!isConfirmed) return;

    try {
        await updateDoc(doc(db, "hq_managers", docId), {
            fullName: formValues.name,
            phone: formValues.phone
        });
        Swal.fire({
            title: '✅ Profile Saved!',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false,
            customClass: { popup: 'rounded-2xl' }
        });
        window.loadAdminDashboard();
    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to update profile.', 'error');
    }
};

window.removeHqManager = async function (docId, email) {
  if (!confirm(`Are you sure you want to REVOKE access for ${email}? They will be immediately locked out.`)) return;
  try {
    await deleteDoc(doc(db, "hq_managers", docId));
    loadAdminDashboard();
  } catch (e) { console.error(e); alert("Failed to remove manager."); }
};

// --- THE GLOBAL RADAR ENGINE (FRANCHISE ISOLATION UPGRADE) ---
window.loadGlobalDashboard = async function() {
    const startDateInput = document.getElementById('dashStartDate');
    const endDateInput = document.getElementById('dashEndDate');

    if (!startDateInput.value) startDateInput.valueAsDate = new Date();
    if (!endDateInput.value) endDateInput.valueAsDate = new Date();

    const startOfDay = new Date(startDateInput.value);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(endDateInput.value);
    endOfDay.setHours(23, 59, 59, 999);

    // 🔥 INJECT THE BRANCH PICKER NEXT TO THE DATE CONTROLS
    let dashFilter = document.getElementById('dashBranchFilter');
    if (!dashFilter) {
        let dateControls = document.getElementById('globalDateControls');
        if (dateControls) {
            dateControls.insertAdjacentHTML('afterbegin', `
                <select id="dashBranchFilter" style="padding: 8px 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f766e; margin-right: 10px; background: white; outline: none; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" onchange="window.loadGlobalDashboard()">
                    <option value="All">🌐 All Branches</option>
                </select>
            `);
            dashFilter = document.getElementById('dashBranchFilter');
            if (typeof window.injectDynamicBranchDropdowns === 'function') window.injectDynamicBranchDropdowns();
        }
    }

    let selectedBranch = dashFilter ? dashFilter.value : "All";
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    
    // 🔒 FORCE LOCK FOR FRANCHISEES
    if (isFranchisee && dashFilter) {
        selectedBranch = window.sessionUser.branch;
        dashFilter.value = selectedBranch;
        dashFilter.disabled = true;
    }

    let globalGross = 0; let globalNet = 0; let globalExp = 0;
    
    // 🔥 SCAN ONLY THE SELECTED BRANCH (OR ALL)
    let branches = window.globalActiveBranches ? window.globalActiveBranches.filter(b => b !== "Main Office") : [];
    if (selectedBranch !== "All") {
        branches = [selectedBranch];
    }

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
        let dashFilter = document.getElementById('dashBranchFilter');
        let selectedBranch = dashFilter ? dashFilter.value : "All";
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
        if (isFranchisee) selectedBranch = window.sessionUser.branch;

        const statsSnap = await getDoc(doc(db, "settings", "global_stats"));
        if (statsSnap.exists()) {
            let data = statsSnap.data();
            let totalBalls = 0;
            
            // 🔒 Pull specific branch stats if filtered
            if (selectedBranch !== "All") {
                totalBalls = data[`balls_${selectedBranch}`] || 0;
            } else {
                totalBalls = data.totalTakoyakiBalls || 0;
            }
            
            let milestoneDiv = document.getElementById('milestoneCounter');
            
            // Change the text above the milestone to show the specific branch
            let titleDiv = milestoneDiv ? milestoneDiv.previousElementSibling : null; 
            if (titleDiv) {
                titleDiv.innerText = selectedBranch !== "All" 
                    ? `ROAD TO 1 MILLION TAKOYAKI BALLS - ${selectedBranch.toUpperCase()} 🐙` 
                    : `ROAD TO 1 MILLION TAKOYAKI BALLS 🐙`;
            }

            if (milestoneDiv) {
                if (totalBalls === 0 && selectedBranch !== "All") {
                    milestoneDiv.innerText = "Tracking Initial Sales...";
                } else {
                    milestoneDiv.innerText = `${totalBalls.toLocaleString()} Balls Sold!`;
                }
            }
        }
    } catch(e) { console.log("Tracker still waiting for first sale."); }

    // 🔥 FIX: WAKE UP THE GRAB ENGINE WHEN DASHBOARD LOADS!
    if (typeof window.calculateGrabFinancials === 'function') {
        window.calculateGrabFinancials();
    }

    // 🔥 NEW: WAKE UP THE PRODUCT ANALYTICS ENGINE!
    if (typeof window.loadProductAnalytics === 'function') {
        window.loadProductAnalytics(startOfDay, endOfDay, selectedBranch);
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

// --- THE HR & SECURITY ENGINE (ENTERPRISE FRANCHISE UPGRADE) ---
window.loadHRModule = async function() {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;

  // 🔥 THE ARCHIVE FIX: Safely tucked INSIDE the function where it belongs!
  window.showArchivedStaff = window.showArchivedStaff || false;
  let archiveBtnHtml = `
      <button onclick="window.showArchivedStaff = !window.showArchivedStaff; window.loadHRModule();" style="margin-bottom: 15px; background: ${window.showArchivedStaff ? '#0ea5e9' : '#f8fafc'}; color: ${window.showArchivedStaff ? 'white' : '#475569'}; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;">
          ${window.showArchivedStaff ? '📂 Hide Archived Staff' : '📁 View Archived / Resigned Staff'}
      </button>
  `;
  
  if (!document.getElementById('archiveToggleBtn')) {
      let btnWrapper = document.createElement('div');
      btnWrapper.id = 'archiveToggleBtn';
      btnWrapper.innerHTML = archiveBtnHtml;
      tbody.closest('table').parentNode.insertBefore(btnWrapper, tbody.closest('table'));
  } else {
      document.getElementById('archiveToggleBtn').innerHTML = archiveBtnHtml;
  }

  tbody.innerHTML = '<tr><td colspan="5" class="text-center">Fetching secure staff records...</td></tr>';

  try {
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    let myBranch = window.sessionUser ? window.sessionUser.branch : null;
    
    let q = collection(db, "cashiers");
    if (isFranchisee && myBranch) {
        q = query(collection(db, "cashiers"), where("branch", "==", myBranch));
    }
    
    const snap = await getDocs(q);
    let html = '';
    const isOwner = window.sessionUser && window.sessionUser.isOwner;

    if (snap.empty) {
      html = '<tr><td colspan="5" class="text-center">No staff found. Click "Add New Staff" to create one.</td></tr>';
    } else {
      window.globalStaffData = {};
      let staffList = [];
      snap.forEach(docSnap => { staffList.push({ id: docSnap.id, ...docSnap.data() }); });
      staffList.sort((a, b) => (a.cashierName || "").localeCompare(b.cashierName || ""));

      staffList.forEach(data => {
        // 🛑 THE ARCHIVE FILTER
        if (!window.showArchivedStaff && data.status === 'Resigned') return; 
        if (window.showArchivedStaff && data.status !== 'Resigned') return;  

        window.globalStaffData[data.id] = data; 
        let pinDisplay = isOwner ? (data.pin || '0000') : '****';
        if (data.pin === 'REVOKED') pinDisplay = 'REVOKED'; 
        
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
              <button class="btn-refresh" style="background: white; border: 1px solid var(--primary); color: var(--primary); padding: 8px 12px; font-weight: bold; border-radius: 6px;" onclick="window.openEmployeeProfile('${data.id}')">📂 Open Profile</button>
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
    
    // 🎓 STUDENT FIX: Uncheck the student status for new hires
    if (document.getElementById('staffWorkingStudent')) document.getElementById('staffWorkingStudent').checked = false;

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
    
    // 🎓 STUDENT FIX: Load the Working Student status!
    if (document.getElementById('staffWorkingStudent')) document.getElementById('staffWorkingStudent').checked = data.isWorkingStudent || false;

    document.getElementById('empPhone').value = data.phone || '';
    document.getElementById('empAddress').value = data.address || '';
    document.getElementById('empGcashName').value = data.gcashName || '';
    document.getElementById('empGcashNum').value = data.gcashNum || '';
    document.getElementById('empGotymeName').value = data.gotymeName || '';
    document.getElementById('empGotymeNum').value = data.gotymeNum || '';
    document.getElementById('empSSS').value = data.sss || '';
    document.getElementById('empPhilhealth').value = data.philhealth || '';
    document.getElementById('empPagibig').value = data.pagibig || '';
    
    // Load Dynamic Deductions
    document.getElementById('customDeductionsContainer').innerHTML = ''; 
    if (data.customDeductions && data.customDeductions.length > 0) {
        data.customDeductions.forEach(d => window.addCustomDeductionRow(d.name, d.amount));
    }
    
    document.getElementById('empSSSAmount').value = data.sssAmount || '';
    document.getElementById('empPhilAmount').value = data.philHealthAmount || '';
    document.getElementById('empPagibigAmount').value = data.pagibigAmount || '';
    document.getElementById('empEmergencyName').value = data.emergencyName || '';
    document.getElementById('empEmergencyPhone').value = data.emergencyPhone || '';
    document.getElementById('empEmail').value = data.email || '';
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
                
                let actionHtml = d.status === 'Unpaid' 
                    ? `<button onclick="window.forceMarkDeductionPaid('${dDoc.id}', '${data.cashierName}', '${docId}')" style="background:#16a34a; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">Mark Paid</button>` 
                    : `<span style="font-size:11px; color:#94a3b8; font-weight:bold;">Cleared</span>`;

                histHtml += `<tr style="border-bottom: 1px solid #f1f5f9; transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                    <td style="padding:10px 8px; color: #64748b;">${dateStr}</td>
                    <td style="padding:10px 8px; font-weight: bold; color: #334155;">${d.type}</td>
                    <td style="padding:10px 8px; font-weight:bold; color:#ea580c;">₱${(d.amount||0).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding:10px 8px; color:${color}; font-weight:bold;">
                        ${d.status}
                    </td>
                    <td style="padding:10px 8px; text-align: center;">
                        ${actionHtml}
                    </td>
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
    
    // 🎓 STUDENT FIX: Grab the checkbox value safely
    let isWorkingStudent = document.getElementById('staffWorkingStudent') ? document.getElementById('staffWorkingStudent').checked : false;
    
    let pin = document.getElementById('empPin').value.trim();

    if (!name || isNaN(rate) || !pin || pin.length < 4) {
        alert("❌ Error: Name, Hourly Rate, and a Password (minimum 4 characters) are strictly required!");
        return;
    }

      // Gather all dynamic deduction rows!
     let customDeductionsArray = [];
     document.querySelectorAll('.custom-deduct-row').forEach(row => {
         let n = row.querySelector('.cd-name').value.trim();
         let a = parseFloat(row.querySelector('.cd-amount').value) || 0;
         if (n && a > 0) customDeductionsArray.push({ name: n, amount: a });
     });
 
    let payload = {
        cashierName: name,
        branch: branch,
        role: document.getElementById('empRole').value.trim(),
        dateHired: document.getElementById('empDateHired').value,
        hourlyRate: rate,
        pin: pin,
        customDeductions: customDeductionsArray,
        
        // 🔥 NEW: Save the toggle state to the cloud!
        eligibleNightDiff: document.getElementById('empNightDiff') ? document.getElementById('empNightDiff').checked : true,
        isWorkingStudent: isWorkingStudent, // 🎓 STUDENT FIX: Added to Payload!
        
        phone: document.getElementById('empPhone').value.trim(),
        address: document.getElementById('empAddress').value.trim(),
        gcashName: document.getElementById('empGcashName').value.trim(),
        gcashNum: document.getElementById('empGcashNum').value.trim(),
        gotymeName: document.getElementById('empGotymeName').value.trim(),
        gotymeNum: document.getElementById('empGotymeNum').value.trim(),
        sss: document.getElementById('empSSS').value.trim(),
        philhealth: document.getElementById('empPhilhealth').value.trim(),
        pagibig: document.getElementById('empPagibig').value.trim(),
        sssAmount: parseFloat(document.getElementById('empSSSAmount').value) || 0,
        philHealthAmount: parseFloat(document.getElementById('empPhilAmount').value) || 0,
        pagibigAmount: parseFloat(document.getElementById('empPagibigAmount').value) || 0,
        emergencyName: document.getElementById('empEmergencyName').value.trim(),
        emergencyPhone: document.getElementById('empEmergencyPhone').value.trim(),
        email: document.getElementById('empEmail').value.trim(),
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
  let recentAlerts = new Set(); // 🔥 THE SPAM FILTER: Remembers alerts to prevent UI duplicates!

  if (snapshot.empty) {
    html = '<tr><td colspan="4" class="text-center" style="padding: 40px; color: var(--success); font-weight: bold;">🛡️ No security alerts. Your empire is safe.</td></tr>';
  } else {
    snapshot.forEach(docSnap => {
      let data = docSnap.data();
      let nowMs = Date.now();
      let alertMs = data.timestamp ? data.timestamp.toMillis() : nowMs;
      let ageInDays = (nowMs - alertMs) / (1000 * 60 * 60 * 24);

      // 🧹 7-DAY AUTO WIPE: If it is marked Resolved and is older than 7 days, delete it!
      if (data.isRead && ageInDays > 7) {
          deleteDoc(doc(db, "manager_alerts", docSnap.id)).catch(e => console.log(e));
          return; // Skip rendering it on the screen
      }

      let alertMsg = data.message || "Unknown Alert";
      
      // 🛡️ SPAM FILTER: If we already showed this exact message for this branch recently, hide the duplicate!
      let dupKey = `${data.branch}_${alertMsg}`;
      if (recentAlerts.has(dupKey)) return; 
      recentAlerts.add(dupKey);

      if (!data.isRead) unreadCount++;

      let timeStr = "Just now";
      if (data.timestamp && data.timestamp.toDate) {
        // Removed the seconds to make the UI look cleaner
        timeStr = data.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }

      // 🎨 THE COLOR CODER ENGINE
      let textColor = "var(--danger)";
      let rowBg = "var(--danger-light)";
      let icon = "⚠️";

      if (alertMsg.includes("CASH OVER") || alertMsg.includes("Over") || alertMsg.includes("Overage")) {
          textColor = "#10b981"; // Success Green
          rowBg = "#ecfdf5"; 
          icon = "📈";
      } else if (alertMsg.includes("CASH SHORT") || alertMsg.includes("Short") || alertMsg.includes("Shortage")) {
          textColor = "#ef4444"; // Danger Red
          rowBg = "#fef2f2"; 
          icon = "📉";
      }

      // If it is read, fade it out to gray
      if (data.isRead) {
          rowBg = "transparent";
          textColor = "var(--text-muted)";
      }

      html += `
              <tr style="background: ${rowBg}; opacity: ${data.isRead ? '0.6' : '1'}; transition: 0.2s;">
                <td style="font-size: 12px; color: var(--text-muted); font-family: monospace; padding: 12px;">${timeStr}</td>
                <td style="padding: 12px;"><strong>📍 ${data.branch}</strong></td>
                <td style="padding: 12px;"><span style="color: ${textColor}; font-weight: ${data.isRead ? 'normal' : 'bold'};">${icon} ${alertMsg}</span></td>
                <td style="padding: 12px; text-align: right;">
                  ${!data.isRead
          ? `<button class="btn-refresh" style="color: var(--success); border-color: var(--success); background: white; padding: 4px 10px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="dismissAlert('${docSnap.id}')">✓ Mark Resolved</button>`
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
  const dateControls = document.getElementById('globalDateControls');
  if (dateControls) {
    const allowedViews = ['dashboard', 'accounts', 'payroll', 'dispatch'];
    if (allowedViews.includes(viewId)) {
      dateControls.style.display = 'flex';
    } else {
      dateControls.style.display = 'none';
    }
  }

  // 🛡️ CRASH-PROOF HIGHLIGHTING: Only add 'active' if the element actually exists!
  let viewEl = document.getElementById('view-' + viewId);
  if (viewEl) viewEl.classList.add('active');

  // Special handling for the HR Hub so the main sidebar tab stays lit up
  if (viewId === 'payroll' || viewId === 'ledger' || viewId === 'schedule') {
      let hrNav = document.getElementById('nav-payroll');
      if (hrNav) hrNav.classList.add('active');
  } else {
      let navEl = document.getElementById('nav-' + viewId);
      if (navEl) navEl.classList.add('active');
  }

  // Change the top title safely using 'var'
  var title = "Global Dashboard";
  if (viewId === 'transfers') title = "Cash Transfers Explorer";
  if (viewId === 'devices') title = "Device Fleet Management";
  if (viewId === 'branches') title = "Staff & Security Management";
  if (viewId === 'menu') title = "Central Menu Editor";
  if (viewId === 'addons') title = "Global Add-Ons Hub";
  if (viewId === 'alerts') title = "Security Alerts";
  if (viewId === 'inventory') title = "Live Inventory Dashboard";
  if (viewId === 'accounts') title = "Financial Control Center";
  if (viewId === 'payroll') title = "Human Resources Hub";
  if (viewId === 'products') title = "Menu Costing & BOM";
  if (viewId === 'purchases') title = "Purchases & Alerts";
  if (viewId === 'dispatch') title = "Logistics & Dispatch";
  if (viewId === 'zreadings') title = "Z-Reading Reports";
  if (viewId === 'expenses') title = "Expense & Restock Feed";
  if (viewId === 'admin') title = "HQ Access Control";
  if (viewId === 'ledger') title = "Staff Loans & Ledger";
  if (viewId === 'payables') title = "Supplier Payables & Terms";
  if (viewId === 'equipment') title = "Assets & Equipment Tracker";
  if (viewId === 'schedule') {
      title = "Schedule & Shift Manager";
      if (typeof loadFromCloud === 'function') loadFromCloud(); 
  }
  
  let titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.innerText = title;

  // Trigger the engine for that specific page
  if (viewId === 'dashboard') window.loadGlobalDashboard();
  if (viewId === 'branches') window.loadHRModule();
  if (viewId === 'menu') window.loadMenuEditor();
  if (viewId === 'addons') window.loadGlobalAddons();
  if (viewId === 'inventory') window.loadInventoryData();
  if (viewId === 'accounts') window.loadAccountsAndBudget();
  if (viewId === 'inbox') window.loadInbox();
  if (viewId === 'products') window.loadMenuCosting();
  if (viewId === 'purchases') window.loadPurchasesAndAlerts();
  if (viewId === 'dispatch') window.loadDispatchDashboard();
  if (viewId === 'zreadings') window.loadZReadingReports();
  if (viewId === 'expenses') window.loadExpenseLogs();
  if (viewId === 'equipment') window.loadEquipmentDashboard();
  if (viewId === 'posconfig') { window.loadPosConfigHub(); window.loadPosLayout(); window.loadSidebarLayout(); }
  if (viewId === 'admin') { 
      window.loadAdminDashboard(); 
      if (typeof window.loadBranchManager === 'function') window.loadBranchManager(); 
  }
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
  
  // 🔥 THE FIX: Strictly bind this to the window so the Confirm button can see it!
  window.restockCart = [];
  window.renderRestockCart();

  if (window.globalInventoryList.length === 0) {
    const snap = await getDocs(collection(db, "inventory"));
    snap.forEach(d => { let obj = d.data(); obj.id = d.id; window.globalInventoryList.push(obj); });
  }

  // Transform the Dropdown into a Smart Search Bar
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

  if (preSelectId) {
      let preItem = window.globalInventoryList.find(i => i.id === preSelectId);
      if (preItem) itemInput.value = preItem.name;
  }

  window.updateRestockUomLabel();
};

window.updateRestockUomLabel = function () {
  let itemName = document.getElementById('restockItemSelect').value.trim();
  let label = document.getElementById('restockQtyLabel');
  
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

  // 🔥 THE FIX: Strictly use window.restockCart
  if (typeof window.restockCart === 'undefined') window.restockCart = [];
  
  let existing = window.restockCart.find(i => i.id === item.id);
  if (existing) {
      existing.purchQty += purchQty;
      existing.qty += purchQty; // Update the missing qty reference!
      existing.baseQtyToAdd += baseQtyToAdd;
      existing.totalCost += (totalCost || 0);
  } else {
      window.restockCart.push({
        id: item.id, 
        name: item.name, 
        branch: item.branch, 
        purchQty: purchQty, 
        qty: purchQty, // 🔥 THE FIX: Added so the Confirm math and Invoice Viewer work perfectly!
        conversionRate: convRate, // 🔥 THE FIX: Saves the exact conversion rate for reverting!
        purchUom: item.purchaseUom || 'units',
        baseQtyToAdd: baseQtyToAdd, 
        baseUom: item.uom, 
        totalCost: totalCost || 0, 
        supplier: supplierName 
      });
  }

  document.getElementById('restockQtyInput').value = '';
  document.getElementById('restockItemSelect').value = ''; 
  if(document.getElementById('restockCostInput')) document.getElementById('restockCostInput').value = '';
  window.renderRestockCart();
};

window.removeRestockItem = function (index) {
  window.restockCart.splice(index, 1);
  window.renderRestockCart();
};

window.renderRestockCart = function () {
  let tbody = document.getElementById('restockCartBody');
  
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

  // 🔥 THE FIX: Strictly use window.restockCart
  if (!window.restockCart || window.restockCart.length === 0) { 
      tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:var(--text-muted); padding:15px;">Cart is empty.</td></tr>'; 
      return; 
  }

  let html = '';
  window.restockCart.forEach((cartItem, idx) => {
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

window.confirmMultiRestock = async function() {
    let selectedItem = document.getElementById('restockItemSelect');
    let qtyInput = document.getElementById('restockQtyInput');
    
    if (selectedItem && selectedItem.value !== "" && qtyInput && qtyInput.value !== "" && parseFloat(qtyInput.value) > 0) {
        return Swal.fire({
            title: 'Hanging Item Detected!',
            text: 'You have an item selected but haven\'t clicked "Add". Please click the "➕ Add" button to put it in your cart, or clear the selection before confirming.',
            icon: 'warning',
            confirmButtonColor: '#f59e0b',
            customClass: { popup: 'rounded-2xl' }
        });
    }

    if (!window.restockCart || window.restockCart.length === 0) {
        return Swal.fire('Cart Empty', 'Please add items to the cart first.', 'warning');
    }

    let supplier = document.getElementById('restockSupplierInput').value || "HQ Restock";
    let totalCost = parseFloat(document.getElementById('restockCostInput').value) || 0;
    let cashier = localStorage.getItem('cashierName') || 'Manager';

    let btn = document.getElementById('btnConfirmRestock');
    let origText = btn.innerText;
    btn.innerText = "⏳ Processing..."; btn.disabled = true;

    try {
        // 1. Process each item mathematically into the inventory
        for (let item of window.restockCart) {
            let docRef = doc(db, "inventory", item.id);
            let snap = await getDoc(docRef);
            if (snap.exists()) {
                let data = snap.data();
                let oldQty = parseFloat(data.currentStock || 0);
                
                let convRate = parseFloat(item.conversionRate || data.conversionRate || data.conversion || 1);
                // 🔥 THE FIX: Now perfectly calculates using the newly mapped item.qty
                let addBaseQty = parseFloat(item.qty) * convRate; 
                
                let baseStockMath = oldQty < 0 ? 0 : oldQty;
                let newQty = baseStockMath + addBaseQty;

                await updateDoc(docRef, { currentStock: newQty });

                let wipeNote = oldQty < 0 ? ` (Wiped ${oldQty.toFixed(2)} negative ghost debt)` : '';

                await addDoc(collection(db, "stock_logs"), {
                    branch: data.branch || "Main Office",
                    item: data.name || item.name,
                    uom: data.uom || 'units',
                    oldQty: oldQty,
                    newQty: newQty,
                    variance: addBaseQty,
                    type: "HQ Delivery Restock",
                    note: `Supplier: ${supplier}${wipeNote}`,
                    user: cashier,
                    timestamp: new Date()
                });
            }
        }

        // 2. Save the Grouped "Invoice" Document
        await addDoc(collection(db, "hq_restocks"), {
            supplier: supplier,
            totalCost: totalCost,
            items: window.restockCart,
            user: cashier,
            timestamp: new Date(),
            branch: "Main Office" 
        });

        Swal.fire({title: '✅ Restock Complete!', text: 'Inventory updated and grouped invoice saved.', icon: 'success', customClass: { popup: 'rounded-2xl' }});
        
        document.getElementById('restockModal').style.display = 'none';
        window.restockCart = [];
        if (typeof window.renderRestockCart === 'function') window.renderRestockCart();
        document.getElementById('restockSupplierInput').value = '';
        document.getElementById('restockCostInput').value = '';

        if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
        if (typeof window.loadStockLogs === 'function') window.loadStockLogs();
        if (typeof window.updateLifetimeRestockCost === 'function') window.updateLifetimeRestockCost();

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to process restock. Check connection.', 'error');
    } finally {
        if(btn) { btn.innerText = origText; btn.disabled = false; }
    }
};

// ==========================================
// 📦 HQ RESTOCK INVOICE ENGINE (EDIT & REVERT)
// ==========================================
window.updateLifetimeRestockCost = async function() {
    try {
        const snap = await getDocs(collection(db, "hq_restocks"));
        let totalCost = 0;
        snap.forEach(doc => { totalCost += (parseFloat(doc.data().totalCost) || 0); });
        
        let costEl = document.getElementById('lifetimeRestockCost');
        if (costEl) costEl.innerText = '₱' + totalCost.toLocaleString(undefined, {minimumFractionDigits: 2});
    } catch(e) { console.error("Error calculating lifetime cost", e); }
};

window.openGroupedRestocks = async function() {
    Swal.fire({title: 'Loading Invoices...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        const q = query(collection(db, "hq_restocks"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        
        let html = `
        <div class="table-responsive" style="max-height: 50vh; overflow-y: auto;">
            <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px;">
                <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 10;">
                    <tr>
                        <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; color: #475569;">Date & User</th>
                        <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; color: #475569;">Supplier / Ref</th>
                        <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; color: #475569;">Total Cost</th>
                        <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; color: #475569;">Items</th>
                        <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; color: #475569; text-align: right;">Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (snap.empty) {
            html += `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #64748b;">No restock invoices found.</td></tr>`;
        } else {
            snap.forEach(docSnap => {
                let d = docSnap.data();
                let dateStr = d.timestamp?.toDate ? d.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';
                let cost = parseFloat(d.totalCost) || 0;

                let itemsList = (d.items || []).map(i => `<span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; margin:2px; display:inline-block; border:1px solid #e2e8f0;">${i.qty}x ${i.name}</span>`).join(' ');
                
                let encodedData = encodeURIComponent(JSON.stringify({id: docSnap.id, ...d}));

                html += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px;"><b>${dateStr}</b><br><span style="color:#64748b; font-size: 11px;">${d.user || 'Admin'}</span></td>
                        <td style="padding: 10px; font-weight: bold; color: #0ea5e9;">${d.supplier || 'N/A'}</td>
                        <td style="padding: 10px; font-weight: bold; color: #dc2626;">₱${cost.toLocaleString()}</td>
                        <td style="padding: 10px; font-size: 11px; color: #475569;">${itemsList}</td>
                        <td style="padding: 10px; text-align: right;">
                            <button onclick="window.revertAndEditRestock('${encodedData}')" style="background: white; color: #f59e0b; border: 1px solid #fcd34d; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; white-space: nowrap; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.1);">↩️ Revert & Edit</button>
                        </td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table></div>`;
        window.updateLifetimeRestockCost(); // Refresh cost in background

        Swal.fire({
            title: '📦 HQ Restock Invoices',
            html: html,
            width: 850,
            showConfirmButton: true,
            confirmButtonText: 'Close Window',
            confirmButtonColor: '#64748b',
            customClass: { popup: 'rounded-2xl shadow-2xl' }
        });

    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to load invoices', 'error');
    }
};

window.revertAndEditRestock = async function(encodedData) {
    let invoice = JSON.parse(decodeURIComponent(encodedData));

    let confirm = await Swal.fire({
        title: 'Revert & Edit?',
        text: 'This will undo the stock additions from this invoice and load the items back into your cart so you can fix them. Proceed?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Revert it!',
        customClass: { popup: 'rounded-2xl' }
    });

    if (!confirm.isConfirmed) return;

    Swal.fire({title: 'Reverting Stock...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        // 1. Subtract the stock mathematically back out of the system
        for (let item of invoice.items) {
            let docRef = window.doc(window.db, "inventory", item.id);
            let snap = await window.getDoc(docRef);
            if (snap.exists()) {
                let data = snap.data();
                let oldQty = parseFloat(data.currentStock || 0);
                
                let convRate = parseFloat(item.conversionRate || data.conversionRate || data.conversion || 1);
                let subBaseQty = parseFloat(item.qty) * convRate;
                let newQty = oldQty - subBaseQty;

                await window.updateDoc(docRef, { currentStock: newQty });

                // Log the Reversal
                await window.addDoc(window.collection(window.db, "stock_history"), {
                    itemId: item.id,
                    itemName: data.name || item.name,
                    branch: data.branch || "Main Office",
                    oldQty: oldQty,
                    newQty: newQty,
                    variance: `-${subBaseQty} ${data.uom || 'units'}`,
                    type: "HQ Restock Reverted (Edit)",
                    user: localStorage.getItem('cashierName') || 'Manager',
                    timestamp: new Date()
                });
            }
        }

        // 2. Delete the old invoice
        await window.deleteDoc(window.doc(window.db, "hq_restocks", invoice.id));

        // 3. Load items back into the local cart
        window.restockCart = invoice.items;
        document.getElementById('restockSupplierInput').value = invoice.supplier || '';
        document.getElementById('restockCostInput').value = invoice.totalCost || '';

        // 4. Open Modal & Render so they can edit
        Swal.close();
        document.getElementById('restockModal').style.display = 'flex';
        if (typeof window.renderRestockCart === 'function') window.renderRestockCart();
        if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
        if (typeof window.loadStockLogs === 'function') window.loadStockLogs();
        window.updateLifetimeRestockCost();

        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Restock Reverted! Edit your cart now.', 
            showConfirmButton: false, timer: 3000
        });

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to revert stock safely.', 'error');
    }
};

// Auto-load the lifetime cost when the page boots up
setTimeout(() => { window.updateLifetimeRestockCost(); }, 2000);

// ========================================================
// 🚚 THE DISPATCH & LOGISTICS ENGINE (SMART COMMAND CENTER)
// ========================================================
window.dispatchCart = [];
window.dispatchInventoryList = [];

window.loadDispatchDashboard = async function() {
  let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
  let myBranch = window.sessionUser ? window.sessionUser.branch : "Unknown";

  const branches = window.globalActiveBranches ? window.globalActiveBranches : ["Main Office", "Cabantian", "Citygate", "Maa", "SM Lanang"];
  
  let fromHtml = '<option value="">-- Select Source --</option>';
  let toHtml = '<option value="">-- Select Destination --</option>';
  let btn = document.getElementById('btnSubmitDispatch');

  if (isFranchisee) {
      fromHtml = `<option value="Main Office">Main Office (HQ)</option>`;
      toHtml = `<option value="${myBranch}">${myBranch}</option>`;
      if (btn) btn.innerText = "📝 Request Stock from HQ";
  } else {
      branches.forEach(b => {
        fromHtml += `<option value="${b}">${b}</option>`;
        toHtml += `<option value="${b}">${b}</option>`;
      });
      if (btn) btn.innerText = "🚀 Send Dispatch Delivery";
  }

  document.getElementById('dispFrom').innerHTML = fromHtml;
  document.getElementById('dispFrom').value = "Main Office";
  document.getElementById('dispTo').innerHTML = toHtml;

  // 💾 VAULT RECOVERY: Restore Cart if they accidentally refreshed!
  let savedCart = localStorage.getItem('takodeal_dispatch_cart');
  if (savedCart && !isFranchisee) {
      try { window.dispatchCart = JSON.parse(savedCart); } catch(e) { window.dispatchCart = []; }
      let savedTo = localStorage.getItem('takodeal_dispatch_to');
      if (savedTo) setTimeout(() => { document.getElementById('dispTo').value = savedTo; }, 100);
  } else {
      window.dispatchCart = [];
  }
  
  if (isFranchisee) document.getElementById('dispTo').value = myBranch;

  window.renderDispatchCart();
  await window.loadDispatchInventory();
  await window.loadDispatchLogs();
};

window.loadDispatchInventory = async function () {
    let fromBranch = document.getElementById('dispFrom').value;
    let itemInput = document.getElementById('dispItem');

    if (itemInput.tagName === 'SELECT') {
        let newInput = document.createElement('input');
        newInput.id = 'dispItem'; newInput.setAttribute('list', 'dispatchDatalist');
        newInput.placeholder = "Type to search item to send...";
        newInput.style.cssText = "width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; outline: none; box-sizing: border-box; font-size: 14px; font-weight: bold; color: #334155;";
        newInput.onchange = window.updateDispatchUomLabel; newInput.onkeyup = window.updateDispatchUomLabel; 
        itemInput.parentNode.replaceChild(newInput, itemInput); itemInput = newInput;
    }

    if (!fromBranch) { itemInput.placeholder = 'Select source branch first...'; itemInput.disabled = true; itemInput.value = ''; return; }
    
    itemInput.disabled = false; itemInput.placeholder = 'Scanning warehouse...'; itemInput.value = '';
    window.dispatchInventoryList = [];

    try {
        const q = query(collection(db, "inventory"), where("branch", "==", fromBranch));
        const snap = await getDocs(q);
        
        let datalistHtml = '<datalist id="dispatchDatalist">';
        let sortedStock = [];
        
        // 🔥 THE CRASH FIX: We NO LONGER hide items with 0 stock! This prevents the "Item Not Found" crash!
        snap.forEach(docSnap => { let data = docSnap.data(); sortedStock.push({ id: docSnap.id, ...data }); });
        
        sortedStock.sort((a, b) => a.name.localeCompare(b.name));
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;

        sortedStock.forEach(data => {
            window.dispatchInventoryList.push(data);
            let safeStock = parseFloat(data.currentStock).toFixed(1);
            if (isFranchisee) datalistHtml += `<option value="${data.name}">${data.name} (Request in ${data.uom})</option>`;
            else datalistHtml += `<option value="${data.name}">Available: ${safeStock} ${data.uom}</option>`;
        });
        datalistHtml += '</datalist>';

        let existingList = document.getElementById('dispatchDatalist');
        if (existingList) existingList.remove();
        document.body.insertAdjacentHTML('beforeend', datalistHtml);

        itemInput.placeholder = 'Type to search item...'; window.updateDispatchUomLabel();
        
        if (window.dispatchCart.length > 0) window.renderDispatchCart();
        
    } catch (e) { console.error(e); itemInput.placeholder = 'Error loading stock'; }
};

window.updateDispatchUomLabel = function() {
    let itemName = document.getElementById('dispItem').value.trim();
    let uomDrop = document.getElementById('dispUomSelect');
    if (!itemName) { uomDrop.innerHTML = '<option value="base">Units</option>'; return; }

    let invItem = window.dispatchInventoryList.find(i => i.name === itemName);
    if (invItem) {
        let baseUom = invItem.uom || 'units'; let purchUom = invItem.purchaseUom || 'Bulk';
        uomDrop.innerHTML = `<option value="purch">${purchUom}</option><option value="base">${baseUom}</option>`;
    }
};

window.addToDispatchCart = function () {
    let itemName = document.getElementById('dispItem').value;
    let rawQty = parseFloat(document.getElementById('dispQty').value);
    if (!itemName || isNaN(rawQty) || rawQty <= 0) { alert("Please select an item and valid quantity."); return; }

    let invItem = window.dispatchInventoryList.find(i => i.name === itemName);
    if (!invItem) return;

    let uomSelect = document.getElementById('dispUomSelect'); 
    let selectedUomType = uomSelect ? uomSelect.value : 'base'; 

    let masterConv = parseFloat(invItem.conversionRate) || parseFloat(invItem.conversion) || 1;
    let convRate = (selectedUomType === 'purch') ? masterConv : 1;
    let friendlyUom = (selectedUomType === 'purch') ? (invItem.purchaseUom || "Bulk") : invItem.uom;
    let finalBaseQty = rawQty * convRate;

    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    if (!isFranchisee && finalBaseQty > invItem.currentStock) { 
        let stockInPurch = invItem.currentStock / convRate;
        let msg = `You are trying to send <strong>${rawQty} ${friendlyUom}</strong> (${finalBaseQty} ${invItem.uom}), but HQ only has <strong>${stockInPurch.toFixed(2)} ${friendlyUom}</strong> available.<br><br>It will be added, but flagged in Red.`; 
        Swal.fire({ title: '⚠️ Low HQ Stock', html: msg, icon: 'warning', confirmButtonColor: '#f59e0b' });
    }

    let existing = window.dispatchCart.find(i => (i.itemName || i.name) === itemName);
    if (existing) { 
        existing.rawQty = (parseFloat(existing.rawQty) || 0) + rawQty;
        existing.qty = (parseFloat(existing.qty) || 0) + finalBaseQty; 
        existing.friendlyUom = friendlyUom; 
        existing.convRate = convRate;
        existing.selectedUom = selectedUomType;
        existing.conversionRate = masterConv; 
        existing.hqStock = parseFloat(invItem.currentStock) || 0; 
    } else {
        window.dispatchCart.push({ 
            itemName: itemName, name: itemName, qty: finalBaseQty, uom: invItem.uom, sourceId: invItem.id, rawQty: rawQty,            
            friendlyUom: friendlyUom, convRate: convRate, category: invItem.category || "Ingredients", 
            purchaseUom: invItem.purchaseUom || invItem.uom, selectedUom: selectedUomType,
            conversionRate: masterConv,
            baseUom: invItem.baseUom || invItem.uom,
            cost: invItem.cost || 0, reorderLevel: invItem.reorderLevel || 10,
            hqStock: parseFloat(invItem.currentStock) || 0 
        });
    }

    document.getElementById('dispQty').value = ''; document.getElementById('dispItem').value = ''; 
    localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));
    window.renderDispatchCart();
};

window.removeFromDispatchCart = function (index) { 
    window.dispatchCart.splice(index, 1); 
    localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));
    Object.keys(localStorage).forEach(key => { if(key.startsWith('takodeal_draft_qty_')) localStorage.removeItem(key); });
    window.renderDispatchCart(); 
};

// ==========================================
// 🚚 DISPATCH CART ENGINE (WITH LIVE HQ SYNC)
// ==========================================
window.renderDispatchCart = function() {
    let container = document.getElementById('dispatchItemsList') || document.getElementById('dispatchCartContainer') || document.getElementById('dispatchCartBody');
    
    if (!container) {
        let allTags = document.querySelectorAll('div, td, span, p');
        for(let i=0; i<allTags.length; i++) {
            if(allTags[i].innerText && allTags[i].innerText.trim() === 'Cart is empty.') {
                container = allTags[i];
                container.id = 'dispatchItemsList';
                break;
            }
        }
    }

    if (!container) {
        let btn = document.getElementById('btnSubmitDispatch') || document.querySelector('button[onclick*="submitMultiDispatch"]');
        if (btn) {
            container = btn.previousElementSibling;
            container.id = 'dispatchItemsList';
        }
    }

    if (!container) return;

    if (typeof window.dispatchCart === 'undefined') window.dispatchCart = [];
    if (window.dispatchCart.length === 0) {
        let emptyHtml = container.tagName.toLowerCase() === 'tbody' 
            ? '<tr><td colspan="3" style="padding:20px; text-align:center; color:#94a3b8; font-weight:bold;">Cart is empty.</td></tr>' 
            : '<div style="padding:20px; text-align:center; color:#94a3b8; font-weight:bold;">Cart is empty.</div>';
        container.innerHTML = emptyHtml;
        return;
    }
    
    let isTable = container.tagName.toLowerCase() === 'tbody';
    let html = '';

    window.dispatchCart.forEach((item, index) => {
        
        // 🔥 THE LIVE SYNC INJECTOR 🔥
        // Forces the cart item to instantly absorb any name or UOM changes made in the Live HQ Inventory!
        let hqItemObj = window.dispatchInventoryList ? window.dispatchInventoryList.find(i => i.id === item.sourceId || i.name === (item.name || item.itemName)) : null;
        
        if (hqItemObj) {
            item.name = hqItemObj.name;
            item.itemName = hqItemObj.name;
            item.baseUom = hqItemObj.uom || hqItemObj.baseUom || 'units';
            item.purchaseUom = hqItemObj.purchaseUom || hqItemObj.purchUom || item.baseUom;
            item.conversionRate = parseFloat(hqItemObj.conversionRate) || parseFloat(hqItemObj.conversion) || 1;
            item.hqStock = parseFloat(hqItemObj.currentStock) || 0;
            if (!item.selectedUom) item.selectedUom = 'base';
        }

        let pUom = item.purchaseUom || item.purchUom || item.uom || 'units';
        let bUom = item.baseUom || item.uom || 'units';
        let masterConv = parseFloat(item.conversionRate) || parseFloat(item.convRate) || parseFloat(item.conversion) || 1;
        
        if (!item.selectedUom) item.selectedUom = (item.friendlyUom === pUom && pUom.toLowerCase() !== bUom.toLowerCase()) ? 'purch' : 'base';
        
        let rawQty = parseFloat(item.rawQty) || 0;
        let baseQty = parseFloat(item.qty) || 0;

        let uomOptions = '';
        if (pUom.toLowerCase() !== bUom.toLowerCase()) {
            uomOptions += `<option value="purch" ${item.selectedUom === 'purch' ? 'selected' : ''}>${pUom}</option>`;
        }
        uomOptions += `<option value="base" ${item.selectedUom === 'base' ? 'selected' : ''}>${bUom}</option>`;

        let sysStock = item.systemStock || item.currentStock || 0;
        let physStock = item.physicalStock || 0;

        let hqStock = parseFloat(item.hqStock || 0);
        
        let hqColor = hqStock < baseQty ? '#dc2626' : '#16a34a';
        let hqBg = hqStock < baseQty ? '#fef2f2' : '#dcfce7';
        let hqBorder = hqStock < baseQty ? '#fca5a5' : '#bbf7d0';
        let hqWarningText = hqStock < baseQty ? '⚠️ LOW HQ STOCK' : '🟢 HQ Stock OK';

        if (isTable) {
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 15px 10px; width: 45%;">
                        <strong style="color: #0f172a; font-size: 14px;">${item.name || item.itemName}</strong><br>
                        ${item.requestType ? `<span style="font-size: 11px; color: #d97706; background: #fffbeb; border: 1px dashed #fcd34d; padding: 2px 4px; border-radius: 4px; display: inline-block; margin-top: 4px;">Branch Report (Phys: ${physStock} | Sys: ${sysStock})</span><br>` : ''}
                        
                        <span style="font-size: 11px; color: ${hqColor}; background: ${hqBg}; border: 1px dashed ${hqBorder}; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; font-weight: bold;">
                            🏢 HQ Avail: ${hqStock.toFixed(2)} ${bUom} (${hqWarningText})
                        </span><br>

                        <span id="dispatch_send_text_${index}" style="font-size: 11px; color: #059669; font-weight: bold; display: inline-block; margin-top: 4px;">Sending in ${bUom} (${baseQty.toFixed(2)} ${bUom})</span>
                    </td>
                    <td style="padding: 15px 10px; text-align: center; width: 35%;">
                        <div style="display:flex; justify-content:center; align-items:center; gap: 5px;">
                            <input type="number" step="any" id="cartQty_${index}" value="${rawQty || ''}" 
                                oninput="window.updateDispatchQty(${index}, this.value)" 
                                style="width: 70px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; outline: none; font-weight: bold; color: #d97706; font-size: 14px;">
                            
                            <select onchange="window.updateDispatchUom(${index}, this.value)" 
                                style="padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: #d97706; font-weight: bold; cursor: pointer; outline: none;">
                                ${uomOptions}
                            </select>
                        </div>
                    </td>
                    <td style="padding: 15px 10px; text-align: right; width: 20%;">
                        <button onclick="window.removeFromDispatchCart(${index})" 
                            style="background: #fef2f2; color: #ef4444; border: 1px solid #fca5a5; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">✖ Remove</button>
                    </td>
                </tr>
            `;
        } else {
            html += `
                <div style="display: grid; grid-template-columns: 2fr 1.5fr 1fr; align-items: center; padding: 15px 5px; border-bottom: 1px solid #f1f5f9; gap: 15px;">
                    <div>
                        <strong style="color: #0f172a; font-size: 14px;">${item.name || item.itemName}</strong><br>
                        ${item.requestType ? `<span style="font-size: 11px; color: #d97706; background: #fffbeb; border: 1px dashed #fcd34d; padding: 2px 4px; border-radius: 4px; display: inline-block; margin-top: 4px;">Branch Report (Phys: ${physStock} | Sys: ${sysStock})</span><br>` : ''}
                        
                        <span style="font-size: 11px; color: ${hqColor}; background: ${hqBg}; border: 1px dashed ${hqBorder}; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; font-weight: bold;">
                            🏢 HQ Avail: ${hqStock.toFixed(2)} ${bUom} (${hqWarningText})
                        </span><br>

                        <span id="dispatch_send_text_${index}" style="font-size: 11px; color: #059669; font-weight: bold; display: inline-block; margin-top: 4px;">Sending in ${bUom} (${baseQty.toFixed(2)} ${bUom})</span>
                    </div>
                    <div style="display:flex; justify-content:center; align-items:center; gap: 5px;">
                        <input type="number" step="any" value="${rawQty || ''}" 
                            oninput="window.updateDispatchQty(${index}, this.value)" 
                            style="width: 70px; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; outline: none; font-weight: bold; color: #d97706; font-size: 15px;">
                        
                        <select onchange="window.updateDispatchUom(${index}, this.value)" 
                            style="padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: #d97706; font-weight: bold; cursor: pointer; outline: none; max-width: 100px;">
                            ${uomOptions}
                        </select>
                    </div>
                    <div style="text-align: right;">
                        <button onclick="window.removeFromDispatchCart(${index})" 
                            style="background: #fef2f2; color: #ef4444; border: 1px solid #fca5a5; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">✖ Remove</button>
                    </div>
                </div>
            `;
        }
    });

    if (isTable) {
        html += `<tr><td colspan="3" style="padding: 15px; text-align: right; border-top: 2px dashed #e2e8f0;"><button onclick="window.clearDispatchCart()" style="background: #f8fafc; color: #475569; border: 1px dashed #cbd5e1; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🧹 Set Aside / Clear Cart</button></td></tr>`;
    } else {
        html += `<div style="margin-top: 15px; text-align: right; border-top: 2px dashed #e2e8f0; padding-top: 15px;"><button onclick="window.clearDispatchCart()" style="background: #f1f5f9; color: #475569; border: 1px dashed #cbd5e1; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🧹 Set Aside / Clear Cart</button></div>`;
    }

    container.innerHTML = html;
};

window.updateDispatchQty = function(index, val) {
    let item = window.dispatchCart[index];
    item.rawQty = parseFloat(val) || 0;
    
    let pUom = item.purchaseUom || item.purchUom || item.uom || 'units';
    let bUom = item.baseUom || item.uom || 'units';
    let masterConv = parseFloat(item.conversionRate) || parseFloat(item.convRate) || parseFloat(item.conversion) || 1;
    
    item.convRate = (item.selectedUom === 'purch') ? masterConv : 1;
    item.friendlyUom = (item.selectedUom === 'purch') ? pUom : bUom;
    item.qty = item.rawQty * item.convRate;
    
    let textSpan = document.getElementById(`dispatch_send_text_${index}`);
    if(textSpan) textSpan.innerText = `Sending in ${bUom} (${item.qty.toFixed(2)} ${bUom})`;

    localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));
};

window.updateDispatchUom = function(index, val) {
    let item = window.dispatchCart[index];
    item.selectedUom = val;
    
    let pUom = item.purchaseUom || item.purchUom || item.uom || 'units';
    let bUom = item.baseUom || item.uom || 'units';
    let masterConv = parseFloat(item.conversionRate) || parseFloat(item.convRate) || parseFloat(item.conversion) || 1;
    
    item.convRate = (item.selectedUom === 'purch') ? masterConv : 1;
    item.friendlyUom = (item.selectedUom === 'purch') ? pUom : bUom;
    item.qty = item.rawQty * item.convRate;
    
    localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));
    window.renderDispatchCart();
};

// ==========================================
// 🧹 DISPATCH CART CLEARER (BRUTE FORCE SWEEP)
// ==========================================
window.clearDispatchCart = async function() {
    if (!window.dispatchCart || window.dispatchCart.length === 0) {
        localStorage.removeItem('takodeal_dispatch_cart');
        localStorage.removeItem('takodeal_dispatch_to');
        localStorage.removeItem('takodeal_active_po');
        if (typeof window.renderDispatchCart === 'function') window.renderDispatchCart();
        return;
    }

    let branch = localStorage.getItem('takodeal_dispatch_to') || "Unknown Branch";

    Swal.fire({title: 'Consolidating...', text: 'Merging into a master request...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        // 1. Create ONE master combined request!
        await addDoc(collection(db, "purchase_orders"), {
            branch: branch,
            items: window.dispatchCart,
            status: "Pending",
            type: "Internal Request",
            requestedBy: "System (Merged / Set Aside)",
            timestamp: serverTimestamp()
        });

        // 2. 🔥 THE BRUTE FORCE FIX: 
        // Search Firebase for ANY request connected to this cart (status = "Drafting") and DELETE IT!
        const draftQ = query(collection(db, "purchase_orders"), where("branch", "==", branch), where("status", "==", "Drafting"));
        const draftSnap = await getDocs(draftQ);
        
        let deletePromises = [];
        draftSnap.forEach(d => {
            deletePromises.push(deleteDoc(doc(db, "purchase_orders", d.id)));
        });

        // Also sweep up any loose IDs stored in the local memory just in case!
        let activePos = localStorage.getItem('takodeal_active_po') || "";
        let poArray = activePos ? activePos.split(',') : [];
        for (let oldPoId of poArray) {
            if (oldPoId && oldPoId.trim() !== '') {
                deletePromises.push(deleteDoc(doc(db, "purchase_orders", oldPoId.trim())).catch(e => { /* Ignore if already deleted */ }));
            }
        }

        // Execute the mass deletion!
        await Promise.all(deletePromises);

        // 3. Clear Cart Memory completely
        window.dispatchCart = [];
        localStorage.removeItem('takodeal_dispatch_cart');
        localStorage.removeItem('takodeal_dispatch_to');
        localStorage.removeItem('takodeal_active_po');
        
        Object.keys(localStorage).forEach(key => { if(key.startsWith('takodeal_draft_qty_')) localStorage.removeItem(key); });

        if (typeof window.renderDispatchCart === 'function') window.renderDispatchCart();
        if (typeof window.loadDispatchLogs === 'function') window.loadDispatchLogs();

        Swal.fire({title: 'Merged!', text: 'Requests combined and old fragments permanently deleted.', icon: 'success', timer: 2000, showConfirmButton: false, customClass: { popup: 'rounded-2xl' }});

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Failed to consolidate requests.', 'error');
    }
};

// ==========================================
// 🚀 MASTER WORKFLOW: SEND ACTUAL DELIVERY & ACCOUNTABILITY ENGINE
// ==========================================
window.submitMultiDispatch = async function () {
    let fromBranch = document.getElementById('dispFrom').value;
    let toBranch = document.getElementById('dispTo').value;

    if (!fromBranch || !toBranch) { alert("Please select Source and Destination branches."); return; }
    if (fromBranch === toBranch) { alert("Source and Destination cannot be the same."); return; }

    let btn = document.getElementById('btnSubmitDispatch');
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;

    if (isFranchisee) {
        if (window.dispatchCart.length === 0) { alert("Cart is empty."); return; }
        btn.innerText = "⏳ Sending Request..."; btn.disabled = true;
        try {
            await addDoc(collection(db, "purchase_orders"), {
                branch: toBranch, items: window.dispatchCart, status: "Pending",
                requestedBy: window.sessionUser.cashierName, timestamp: serverTimestamp()
            });
            Swal.fire('📝 Purchase Order Sent!', `HQ has received your request.`, 'success');
            window.dispatchCart = []; window.renderDispatchCart(); window.loadDispatchLogs();
        } catch (e) { console.error(e); Swal.fire('Error', 'Failed to send Purchase Order.', 'error'); } 
        finally { btn.innerText = "📝 Request Stock from HQ"; btn.disabled = false; }
        return; 
    }

    for (let i = 0; i < window.dispatchCart.length; i++) {
        let inp = document.getElementById(`cartQty_${i}`);
        if (inp) {
            let val = parseFloat(inp.value) || 0;
            let conv = window.dispatchCart[i].convRate || 1;
            window.dispatchCart[i].rawQty = val; window.dispatchCart[i].qty = val * conv;
        }
    }

    let validCart = window.dispatchCart.filter(i => i.qty > 0);
    let skippedCart = window.dispatchCart.filter(i => i.qty <= 0); 

    if (validCart.length === 0) { 
        return Swal.fire('Empty Dispatch', 'You must set a quantity greater than 0 for the items you want to send.', 'warning'); 
    }

    btn.innerText = "🚀 Processing Delivery & Audits..."; btn.disabled = true;

    try {
        let driverName = prompt("Enter the name of the Delivery Driver/Person in charge:");
        if (!driverName) { btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false; return; }

        let totalPenaltiesIssued = 0;

        for (let item of validCart) {
            let itemNameToFind = item.itemName || item.name;
            let invItem = window.dispatchInventoryList.find(i => i.name === itemNameToFind);

            let sourceRef;
            let currentHqStock = 0;
            
            if (!invItem) {
                const newInvRef = await addDoc(collection(db, "inventory"), {
                    branch: fromBranch, name: itemNameToFind, uom: item.baseUom || 'units',
                    category: item.category || 'Ingredients', currentStock: 0, 
                    conversionRate: item.convRate || 1, purchaseUom: item.purchaseUom || 'units'
                });
                sourceRef = newInvRef;
                invItem = { id: newInvRef.id, uom: item.baseUom || 'units', category: item.category || "Ingredients", purchaseUom: item.purchaseUom || 'units', cost: item.cost || 0, reorderLevel: 10 };
            } else {
                sourceRef = doc(db, "inventory", invItem.id);
                // 🔥 THE FIX: Fetch Live Firebase Data to prevent simultaneous math collisions!
                let liveSnap = await getDoc(sourceRef);
                if (liveSnap.exists()) {
                    currentHqStock = parseFloat(liveSnap.data().currentStock) || 0;
                }
            }

            await updateDoc(sourceRef, { currentStock: currentHqStock - item.qty });

            // 1. Log Deduction to Source Branch (Main Office)
            await addDoc(collection(db, "stock_logs"), {
                branch: fromBranch, 
                item: itemNameToFind, 
                uom: item.baseUom || invItem.uom || 'units',
                oldQty: currentHqStock, 
                newQty: currentHqStock - item.qty, 
                variance: -item.qty,
                type: "Dispatch Delivery", 
                note: `Sent to ${toBranch} (Driver: ${driverName})`,
                user: window.sessionUser ? window.sessionUser.cashierName : "Manager", 
                timestamp: serverTimestamp()
            });

            // 🔥 THE FIX: Log "Incoming Dispatch" to Destination Branch so it traces immediately!
            await addDoc(collection(db, "stock_logs"), {
                branch: toBranch, 
                item: itemNameToFind, 
                uom: item.baseUom || invItem.uom || 'units',
                oldQty: 0, 
                newQty: 0, 
                variance: 0,
                type: "Incoming Dispatch", 
                note: `Dispatched from ${fromBranch} (Driver: ${driverName}). Awaiting receipt by cashier.`,
                user: "System (In Transit)", 
                timestamp: serverTimestamp()
            });

            // 2. THE ACCOUNTABILITY ENGINE (Penalty / Ghost Wipe Logic remains untouched)
            if (item.requestType === "Low Stock" || item.requestType === "Out of Stock") {
                const branchInvQ = query(collection(db, "inventory"), where("branch", "==", toBranch), where("name", "==", itemNameToFind));
                const branchInvSnap = await getDocs(branchInvQ);
                
                if (!branchInvSnap.empty) {
                    let bDoc = branchInvSnap.docs[0];
                    let bData = bDoc.data();
                    let sysStock = parseFloat(bData.currentStock) || 0;
                    let physStock = parseFloat(item.physicalStock) || 0;

                    if (sysStock > 0 && physStock < sysStock) {
                        let missingQty = sysStock - physStock;
                        let costPerUnit = parseFloat(bData.baseCost) || parseFloat(bData.cost) || parseFloat(item.cost) || 0;
                        let penaltyValue = missingQty * costPerUnit;

                        await updateDoc(bDoc.ref, { currentStock: physStock });
                        await addDoc(collection(db, "stock_logs"), {
                            branch: toBranch, item: itemNameToFind, uom: bData.uom || 'units',
                            oldQty: sysStock, newQty: physStock, variance: -missingQty,
                            type: "Audit Adjustment (Penalty)",
                            note: `System expected ${sysStock.toFixed(2)}, staff reported ${physStock.toFixed(2)}.`,
                            user: "System (HQ)", timestamp: serverTimestamp()
                        });

                        if (penaltyValue > 0) {
                            await addDoc(collection(db, "staff_deductions"), {
                                staffName: `Team ${toBranch}`, type: "Missing Stock Penalty",
                                amount: penaltyValue, dateAdded: new Date(), status: "Unpaid",
                                remarks: `Missing ${missingQty.toFixed(2)} ${bData.uom} of ${itemNameToFind} before restock.`
                            });
                            await addDoc(collection(db, "manager_alerts"), {
                                type: "STOCK_PENALTY_APPLIED", branch: toBranch, cashier: "Team",
                                message: `🚨 PENALTY APPLIED: ${itemNameToFind} baseline reset to ${physStock}. ₱${penaltyValue.toFixed(2)} penalty issued to Team ${toBranch} for missing ${missingQty.toFixed(2)} units.`,
                                timestamp: serverTimestamp(), isRead: false
                            });
                            totalPenaltiesIssued++;
                        }
                    } 
                    else if (sysStock <= 0) {
                        await updateDoc(bDoc.ref, { currentStock: physStock });
                        await addDoc(collection(db, "stock_logs"), {
                            branch: toBranch, item: itemNameToFind, uom: bData.uom || 'units',
                            oldQty: sysStock, newQty: physStock, variance: physStock - sysStock,
                            type: "Negative Stock Wipe", note: `Clean slate reset before restock.`,
                            user: "System (HQ)", timestamp: serverTimestamp()
                        });
                    }
                }
            }

            // 3. LOG THE DISPATCH
            await addDoc(collection(db, "dispatch_logs"), {
                date: new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
                time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), timestamp: new Date(),
                item: itemNameToFind, qty: item.qty || 0, uom: item.uom || invItem.uom || 'units', 
                details: `${fromBranch} ➡️ ${toBranch}`, toBranch: toBranch, driver: driverName, status: "In Transit", 
                displayQty: item.rawQty || item.qty || 0, displayUom: item.friendlyUom || item.uom || invItem.uom || 'units', 
                convRate: item.convRate || 1, category: item.category || invItem.category || "Uncategorized", 
                purchaseUom: item.purchaseUom || invItem.purchaseUom || invItem.uom || 'units', cost: item.cost || invItem.cost || 0, reorderLevel: item.reorderLevel || 10 
            });
        }

        // 🔥 THE POSTPONE CONSOLIDATOR FIX
        if (skippedCart.length > 0) {
            let safeSkippedCart = skippedCart.map(i => ({ ...i, category: i.category || "Uncategorized", purchaseUom: i.purchaseUom || i.uom || "units", requestType: i.requestType || 'Low Stock' }));
            let todayStr = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
            
            // Step 1: Check if this branch already has a pending "Postponed" ticket
            const pendingQ = query(collection(db, "purchase_orders"), where("branch", "==", toBranch), where("status", "==", "Delayed"));
            const pendingSnap = await getDocs(pendingQ);
            
            if (!pendingSnap.empty) {
                // Step 2: If they do, merge the leftovers into the existing ticket!
                let existingTicket = pendingSnap.docs[0];
                let existingItems = existingTicket.data().items || [];
                
                safeSkippedCart.forEach(skippedItem => {
                    let match = existingItems.find(i => (i.itemName || i.name) === (skippedItem.itemName || skippedItem.name));
                    if (match) {
                        match.qty = (parseFloat(match.qty) || 0) + (parseFloat(skippedItem.qty) || 0);
                        match.displayQty = match.qty; // Update UI qty
                    } else {
                        existingItems.push(skippedItem);
                    }
                });
                
                await updateDoc(existingTicket.ref, { 
                    items: existingItems,
                    timestamp: serverTimestamp() // Bumps it to the top of the feed!
                });
            } else {
                // Step 3: Only create a new ticket if they don't have one!
                await addDoc(collection(db, "purchase_orders"), {
                    branch: toBranch, items: safeSkippedCart, status: "Delayed", type: "Delayed Delivery",
                    originalRequestDate: todayStr, requestedBy: "System (Postponed / Set Aside)", timestamp: serverTimestamp()
                });
            }
        }

        window.dispatchCart = [];
        localStorage.removeItem('takodeal_dispatch_cart');
        localStorage.removeItem('takodeal_dispatch_to');
        Object.keys(localStorage).forEach(key => { if(key.startsWith('takodeal_draft_qty_')) localStorage.removeItem(key); });
        
        let activePoStr = localStorage.getItem('takodeal_active_po');
        if (activePoStr) {
            let poIds = activePoStr.split(',');
            for (let id of poIds) {
                if (id) {
                    try { 
                        let finalStatus = skippedCart.length > 0 ? "Partially Dispatched" : "Completed";
                        await updateDoc(doc(db, "purchase_orders", id), { 
                            status: finalStatus,
                            managerMessage: skippedCart.length > 0 ? "Some items were out of stock and pushed to a delayed request." : "All items shipped."
                        }); 
                    } catch(e){}
                }
            }
            localStorage.removeItem('takodeal_active_po');
        }

        let extraMessage = skippedCart.length > 0 ? `<br><br>(${skippedCart.length} item(s) with 0 qty were auto-set aside into the Stock Requests feed).` : '';
        let penaltyMessage = totalPenaltiesIssued > 0 ? `<br><br>🚨 <b>${totalPenaltiesIssued} Penalty Deduction(s)</b> automatically issued to Team ${toBranch} for missing stock!` : '';
        
        Swal.fire({
            title: '🚚 Dispatch Successful!',
            html: `${validCart.length} items are now In Transit to ${toBranch} via ${driverName}.${penaltyMessage}${extraMessage}`,
            icon: 'success',
            customClass: { popup: 'rounded-2xl shadow-xl' }
        });
        
        window.renderDispatchCart(); 
        if(typeof window.loadDispatchInventory === 'function') window.loadDispatchInventory(); 
        window.loadDispatchLogs();
    } catch (e) { 
        console.error("Dispatch Execution Error:", e); 
        Swal.fire('Dispatch Error', e.message || 'Check the console for details.', 'error');
    } 
    finally { btn.innerText = "🚀 Send Dispatch Delivery"; btn.disabled = false; }
};

window.activeLogisticsTab = 'Requests'; // Default tab memory

window.loadDispatchLogs = async function() {
    const tbody = document.getElementById('dispatchLogBody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="padding: 20px;">⏳ Loading logistics data...</td></tr>';
    
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    let myBranch = window.sessionUser ? window.sessionUser.branch : "Unknown";

    try {
        let poQuery = query(collection(db, "purchase_orders"), where("status", "in", ["Pending", "Drafting", "Delayed"]), orderBy("timestamp", "desc"));
        if (isFranchisee) poQuery = query(collection(db, "purchase_orders"), where("branch", "==", myBranch), where("status", "in", ["Pending", "Drafting", "Delayed"]), orderBy("timestamp", "desc"));
        const poSnap = await getDocs(poQuery);
        
        let poHtml = '';
        let poCount = 0;
        
        poSnap.forEach(docSnap => {
            let po = docSnap.data();
            poCount++;
            let dateStr = po.timestamp ? po.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
            
            let isDelayed = po.status === "Delayed" || (po.requestedBy && po.requestedBy.includes("Backlogged"));
            
            let statusBadge = '';
            let titleTxt = '';
            let delayMeta = '';

            if (isDelayed) {
                statusBadge = `<span style="background:#fef2f2; color:#b91c1c; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold;">⏳ Delayed (HQ Out of Stock)</span>`;
                titleTxt = `⏳ Postponed Delivery to ${po.branch}`;
                
                let origDate = po.originalRequestDate || dateStr.split(',')[0];
                delayMeta = `
                    <div style="margin-top: 8px; padding: 6px; background: #fff; border: 1px dashed #fca5a5; border-radius: 4px; display: inline-block;">
                        <span style="font-size:11px; color:#ef4444; font-weight:bold;">Originally Requested: ${origDate}</span><br>
                        <span style="font-size:10px; color:#64748b;">Set aside by system on: ${dateStr}</span>
                    </div>`;
            } else if (po.status === "Drafting") {
                statusBadge = `<span style="background:#bae6fd; color:#0369a1; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold;">Drafting in Cart</span>`;
                titleTxt = po.type === 'Internal Request' ? `📢 Stock Issue Report from ${po.branch}` : `📝 Purchase Order from ${po.branch}`;
            } else {
                statusBadge = `<span style="background:#fef3c7; color:#d97706; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold;">Pending</span>`;
                titleTxt = po.type === 'Internal Request' ? `📢 Stock Issue Report from ${po.branch}` : `📝 Purchase Order from ${po.branch}`;
            }

            let actionBtn = isFranchisee 
                ? `<span style="color:#ca8a04; font-weight:bold; font-size:11px;">⏳ Waiting for HQ</span>`
                : `<button onclick="window.reviewPurchaseOrder('${docSnap.id}')" style="background:#0ea5e9; color:white; border:none; padding:6px 12px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px; box-shadow: 0 2px 4px rgba(14,165,233,0.3);">🔍 Review Request</button>`;
            
            poHtml += `<tr style="background:#fffbeb; border-bottom:2px solid #fde68a;">
                <td style="padding:15px;">
                    <div style="font-weight:900; color:#d97706; font-size:15px;">${titleTxt}</div>
                    <div style="font-size:12px; color:#b45309; margin-top: 4px; font-weight:bold;">Requested by: ${po.requestedBy}</div>
                    <div style="font-size:11px; color:#d97706; margin-top:4px;">📅 ${dateStr} • <strong style="font-size:13px;">${po.items.length} items</strong></div>
                    ${delayMeta}
                </td>
                <td style="padding:15px; text-align:center;">${statusBadge}</td>
                <td style="padding:15px; text-align:right;">${actionBtn}</td>
            </tr>`;
        });

        let qLogs = query(collection(db, "dispatch_logs"), orderBy("timestamp", "desc"));
        if (isFranchisee) qLogs = query(collection(db, "dispatch_logs"), where("toBranch", "==", myBranch), orderBy("timestamp", "desc"));
        const snap = await getDocs(qLogs);
        
        let deliveries = {};
        snap.forEach(doc => {
            let d = doc.data(); d.id = doc.id;
            let groupKey = `${d.date}_${d.toBranch}_${d.driver || 'Unknown'}`;
            if(!deliveries[groupKey]) deliveries[groupKey] = { date: d.date, time: d.time, toBranch: d.toBranch, driver: d.driver || 'Unknown', items: [], status: 'In Transit', timestamp: d.timestamp };
            deliveries[groupKey].items.push(d);
            if(d.status === "Received") deliveries[groupKey].status = "Received";
            if(d.status === "Variance") deliveries[groupKey].status = "Variance Detected";
            if(d.status === "Backloaded") deliveries[groupKey].status = "Backloaded";
        });

        let deliveryHtml = '';
        let sortedKeys = Object.keys(deliveries).sort((a,b) => deliveries[b].timestamp - deliveries[a].timestamp);

        sortedKeys.slice(0, 20).forEach(key => {
            let del = deliveries[key];
            let badgeColor = del.status === 'Received' ? '#16a34a' : (del.status === 'Variance Detected' ? '#dc2626' : (del.status === 'Backloaded' ? '#475569' : '#f59e0b'));
            let safeItemsJson = encodeURIComponent(JSON.stringify(del.items));

            deliveryHtml += `<tr style="border-bottom:1px solid #e2e8f0; background: white; transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                <td style="padding:15px;">
                    <div style="font-weight:bold; color:#0f172a; font-size:14px;">📍 To: ${del.toBranch}</div>
                    <div style="font-size:12px; color:#64748b; margin-top: 4px;">🚚 Driver: ${del.driver}</div>
                    <div style="font-size:11px; color:#94a3b8; margin-top:4px;">📅 ${del.date} at ${del.time}</div>
                </td>
                <td style="padding:15px; text-align:center;"><span style="background:${badgeColor}; color:white; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold;">${del.status}</span></td>
                <td style="padding:15px; text-align:right;"><button onclick="window.viewDispatchDetails('${safeItemsJson}', '${del.toBranch}', '${del.driver}', '${del.date}', '${del.time}')" style="background: white; color: #0ea5e9; border: 1px solid #0ea5e9; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 Full Details</button></td>
            </tr>`;
        });

        window.globalPoHtml = poHtml;
        window.globalDeliveryHtml = deliveryHtml;
        window.globalPoCount = poCount;
        window.globalDeliveryCount = sortedKeys.length;

        if (poCount > 0 && window.activeLogisticsTab !== 'Deliveries') {
            window.activeLogisticsTab = 'Requests';
        }

        window.renderLogisticsFeed();

    } catch (e) { 
        console.error(e); 
        tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:red; padding: 20px;">Error loading logs</td></tr>'; 
    }
};

window.switchLogisticsTab = function(tab) {
    window.activeLogisticsTab = tab;
    window.renderLogisticsFeed();
};

window.renderLogisticsFeed = function() {
    const tbody = document.getElementById('dispatchLogBody');
    if (!tbody) return;
    
    let table = tbody.closest('table');
    
    // 🎨 Auto-rename the main card title!
    let cardHeaders = table.closest('.card')?.querySelectorAll('h1, h2, h3, h4, h5, h6, .card-header');
    if (cardHeaders) {
        cardHeaders.forEach(h => {
            if (h.innerText.includes('Recent Deliveries') || h.innerText.includes('Logistics Feed')) {
                h.innerHTML = '📜 Logistics Feed';
            }
        });
    }

    // 🎨 Inject the beautifully styled Tab UI above the table!
    if (!document.getElementById('logisticsTabContainer')) {
        let tabHtml = `
            <div id="logisticsTabContainer" style="display: flex; border-bottom: 2px solid #e2e8f0; margin-bottom: 0px; background: #f8fafc; border-radius: 8px 8px 0 0; overflow: hidden;">
                <button id="btnTabRequests" onclick="window.switchLogisticsTab('Requests')" style="flex: 1; padding: 14px; border: none; border-bottom: 3px solid transparent; background: transparent; font-weight: 900; color: #64748b; cursor: pointer; font-size: 13px; text-transform: uppercase; transition: 0.2s;">
                    📢 Stock Requests (<span id="tabCountReq">0</span>)
                </button>
                <button id="btnTabDeliveries" onclick="window.switchLogisticsTab('Deliveries')" style="flex: 1; padding: 14px; border: none; border-bottom: 3px solid transparent; background: transparent; font-weight: 900; color: #64748b; cursor: pointer; font-size: 13px; text-transform: uppercase; transition: 0.2s; border-left: 1px solid #e2e8f0;">
                    🚚 Deliveries (<span id="tabCountDel">0</span>)
                </button>
            </div>
        `;
        table.insertAdjacentHTML('beforebegin', tabHtml);
        table.style.marginTop = "0px";
    }

    // Update the live counters inside the tabs
    document.getElementById('tabCountReq').innerText = window.globalPoCount || 0;
    document.getElementById('tabCountDel').innerText = window.globalDeliveryCount || 0;

    let btnReq = document.getElementById('btnTabRequests');
    let btnDel = document.getElementById('btnTabDeliveries');

    // Toggle Colors and Content based on which tab is clicked
    if (window.activeLogisticsTab === 'Requests') {
        btnReq.style.color = '#0ea5e9'; btnReq.style.borderBottomColor = '#0ea5e9'; btnReq.style.background = '#f0f9ff';
        btnDel.style.color = '#64748b'; btnDel.style.borderBottomColor = 'transparent'; btnDel.style.background = '#f8fafc';
        tbody.innerHTML = window.globalPoHtml || '<tr><td colspan="3" class="text-center" style="padding:50px; color:#94a3b8; font-weight:bold;">No pending requests. You are all caught up! 🎉</td></tr>';
    } else {
        btnDel.style.color = '#0ea5e9'; btnDel.style.borderBottomColor = '#0ea5e9'; btnDel.style.background = '#f0f9ff';
        btnReq.style.color = '#64748b'; btnReq.style.borderBottomColor = 'transparent'; btnReq.style.background = '#f8fafc';
        tbody.innerHTML = window.globalDeliveryHtml || '<tr><td colspan="3" class="text-center" style="padding:50px; color:#94a3b8; font-weight:bold;">No recent deliveries on record.</td></tr>';
    }
};

// ==========================================
// 🔍 THE REVIEW REQUEST MODAL (DELETE AT TOP)
// ==========================================
window.reviewPurchaseOrder = async function(poId) {
    try {
        Swal.fire({ title: 'Cross-checking inventory...', didOpen: () => Swal.showLoading() });
        const poRef = doc(db, "purchase_orders", poId);
        const poSnap = await getDoc(poRef);
        if (!poSnap.exists()) return Swal.fire('Error', 'Request not found.', 'error');
        
        let po = poSnap.data();
        let dateStr = po.timestamp ? po.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';
        
        const hqSnap = await getDocs(query(collection(db, "inventory"), where("branch", "==", "Main Office")));
        let hqStock = {};
        let hqDetails = {}; 
        hqSnap.forEach(d => {
            hqStock[d.data().name] = parseFloat(d.data().currentStock || 0);
            hqDetails[d.data().name] = d.data(); 
        });

        // 🔥 THE FIX: The Delete button is now at the absolute TOP of the window!
        let html = `
            <div style="margin-bottom: 15px;">
                <button onclick="window.deleteStockRequest('${poId}')" style="width: 100%; padding: 14px; background: #fef2f2; border: 2px solid #fca5a5; color: #b91c1c; border-radius: 8px; font-weight: 900; cursor: pointer; font-size: 15px; box-shadow: 0 4px 6px rgba(220, 38, 38, 0.15); text-transform: uppercase;">
                    🗑️ Permanently Delete Request
                </button>
            </div>

            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px; text-align: left;">
                <div style="font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase;">Requested By</div>
                <div style="font-size: 15px; color: #0f172a; font-weight: 900; margin-bottom: 10px;">👤 ${po.requestedBy || 'Staff'}</div>
                <div style="font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase;">Date Submitted</div>
                <div style="font-size: 14px; color: #334155; font-weight: bold;">📅 ${dateStr}</div>
            </div>

            <div style="max-height: 35vh; overflow-y: auto; text-align: left; border: 1px solid #cbd5e1; border-radius: 8px; border-bottom: none;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead style="background: #0f172a; color: white; position: sticky; top: 0; z-index: 10;">
                    <tr>
                        <th style="padding: 10px; text-align: left;">Item Description</th>
                        <th style="padding: 10px; text-align: center;">Qty Requested</th>
                        <th style="padding: 10px; text-align: center;">Alert Type</th>
                    </tr>
                </thead>
                <tbody>`;
        
        po.items.forEach(item => {
            let alertColor = item.requestType === 'Out of Stock' ? '#dc2626' : (item.requestType === 'Low Stock' ? '#d97706' : (item.requestType === 'Lost in Transit' ? '#b91c1c' : '#0284c7'));
            let alertStyle = item.requestType === 'Lost in Transit' ? `color: white; background: ${alertColor}; border: 1px solid #7f1d1d;` : `color: ${alertColor}; background: white; border: 1px solid ${alertColor}50;`;
            let rowBg = item.requestType === 'Lost in Transit' ? '#fff1f2' : 'white';

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: ${rowBg};">
                    <td style="padding: 12px 10px; font-weight: bold; color: #334155;">
                        ${item.itemName}<br>
                        <span style="font-size:10px; color:#64748b; font-weight:normal;">HQ Stock: ${hqStock[item.itemName] || 0} ${item.uom}</span>
                    </td>
                    <td style="padding: 12px 10px; text-align: center; font-weight: 900; color: #0ea5e9;">${item.displayQty || item.qty} <span style="font-size: 10px; color: #64748b;">${item.displayUom || item.uom}</span></td>
                    <td style="padding: 12px 10px; text-align: center;"><span style="${alertStyle} padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${item.requestType || 'Request'}</span></td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
        
        let titleTxt = po.type === 'Internal Request' ? `📢 Issue Report: ${po.branch}` : `📦 Request from ${po.branch}`;
        
        Swal.fire({
            title: titleTxt, html: html, width: '600px',
            showCancelButton: true, showDenyButton: true,
            confirmButtonColor: '#16a34a', cancelButtonColor: '#64748b', denyButtonColor: '#dc2626',
            confirmButtonText: '🛒 Load to Dispatch Cart', denyButtonText: '✖ Postpone / Set Aside', cancelButtonText: 'Close Window',
            customClass: { popup: 'rounded-2xl shadow-xl' }
        }).then(async (result) => {
            if (result.isConfirmed) {
                
                if (typeof window.dispatchCart === 'undefined') window.dispatchCart = [];

                let storedDest = localStorage.getItem('takodeal_dispatch_to');
                if (window.dispatchCart.length > 0 && storedDest && storedDest !== po.branch) {
                    await window.clearDispatchCart(); 
                    Swal.fire({
                        toast: true, position: 'top-end', icon: 'info',
                        title: `Previous cart set aside. Loading ${po.branch}...`,
                        showConfirmButton: false, timer: 3000
                    });
                }

                if (window.dispatchCart.length === 0) {
                    Object.keys(localStorage).forEach(key => { if(key.startsWith('takodeal_draft_qty_')) localStorage.removeItem(key); });
                }

                po.items.forEach(newItem => {
                    let itemName = newItem.itemName || newItem.name;
                    let hqData = hqDetails[itemName] || {}; 

                    let pUom = hqData.purchaseUom || hqData.purchUom || newItem.purchaseUom || newItem.uom || 'units';
                    let bUom = hqData.uom || hqData.baseUom || newItem.uom || newItem.baseUom || 'units';
                    let cRate = parseFloat(hqData.conversionRate) || parseFloat(hqData.conversion) || parseFloat(newItem.convRate) || parseFloat(newItem.conversionRate) || 1;

                    let mappedItem = {
                        ...newItem, 
                        rawQty: parseFloat(newItem.displayQty || newItem.qty) || 0,
                        purchaseUom: pUom,
                        baseUom: bUom,
                        conversionRate: cRate,
                        selectedUom: (pUom.toLowerCase() !== bUom.toLowerCase()) ? 'purch' : 'base',
                        hqStock: parseFloat(hqData.currentStock) || 0
                    };

                    mappedItem.convRate = (mappedItem.selectedUom === 'purch') ? cRate : 1;
                    mappedItem.friendlyUom = (mappedItem.selectedUom === 'purch') ? pUom : bUom;
                    mappedItem.qty = mappedItem.rawQty * mappedItem.convRate;

                    let existing = window.dispatchCart.find(i => (i.itemName || i.name) === itemName);
                    
                    if (existing) {
                        existing.requestType = newItem.requestType;
                        existing.physicalStock = newItem.physicalStock;
                        existing.systemStock = newItem.systemStock;
                        existing.purchaseUom = mappedItem.purchaseUom;
                        existing.baseUom = mappedItem.baseUom;
                        existing.conversionRate = mappedItem.conversionRate;
                        existing.hqStock = mappedItem.hqStock;
                    } else {
                        window.dispatchCart.push(mappedItem);
                    }
                });

                document.getElementById('dispFrom').value = "Main Office"; 
                document.getElementById('dispTo').value = po.branch;
                
                let activePos = localStorage.getItem('takodeal_active_po') || "";
                let poArray = activePos ? activePos.split(',') : [];
                if (!poArray.includes(poId)) poArray.push(poId);
                
                localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));
                localStorage.setItem('takodeal_dispatch_to', po.branch);
                localStorage.setItem('takodeal_active_po', poArray.join(','));
                
                // 🔥 FLAG AS DRAFTING: This allows our new bulk-delete engine to find it!
                await updateDoc(poRef, { status: "Drafting" });
                
                window.renderDispatchCart(); 
                window.loadDispatchLogs();
                
                Swal.fire({title: 'Loaded to Cart! 🛒', text: `Items moved to Dispatch for ${po.branch}.`, icon: 'success', timer: 2000, showConfirmButton: false});
                
            } else if (result.isDenied) {
                const { value: rejectReason } = await Swal.fire({
                    title: 'Postpone Request',
                    input: 'text',
                    inputLabel: 'Reason for postponing',
                    inputPlaceholder: 'Out of stock at HQ...',
                    showCancelButton: true,
                    confirmButtonColor: '#dc2626',
                    confirmButtonText: 'Set Aside',
                    inputValidator: (value) => { if (!value) return 'You need to provide a reason!'; }
                });
                
                if (rejectReason) {
                    Swal.fire({title: 'Updating...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
                    await updateDoc(poRef, {
                        status: 'Delayed',
                        managerMessage: rejectReason,
                        processedAt: serverTimestamp()
                    });
                    Swal.fire('Postponed', 'The request was set aside.', 'info');
                    window.loadDispatchLogs(); 
                }
            }
        });
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to load details.', 'error'); }
};

// ==========================================
// 🗑️ DISPOSE / DELETE STOCK REQUEST ENGINE
// ==========================================
window.deleteStockRequest = async function(poId) {
    let confirmDelete = await Swal.fire({
        title: 'Dispose Request?',
        text: "Are you sure you want to permanently delete this request? This action cannot be undone.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, Delete it!',
        customClass: { popup: 'rounded-2xl shadow-xl' }
    });

    if (!confirmDelete.isConfirmed) return;

    Swal.fire({title: 'Deleting...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        await deleteDoc(doc(db, "purchase_orders", poId));
        Swal.fire({
            title: 'Deleted!', 
            text: 'The request has been permanently disposed.', 
            icon: 'success', 
            timer: 2000, 
            showConfirmButton: false,
            customClass: { popup: 'rounded-2xl' }
        });
        
        if (typeof window.loadDispatchLogs === 'function') window.loadDispatchLogs(); 
        Swal.close(); // Force the modal to close instantly
    } catch (e) {
        console.error("Delete Error:", e);
        Swal.fire('Error', 'Failed to delete the request.', 'error');
    }
};

window.approvePurchaseOrder = async function(poId) {
    try {
        const poRef = doc(db, "purchase_orders", poId);
        const poSnap = await getDoc(poRef);
        if (!poSnap.exists()) return;
        
        let po = poSnap.data();
        dispatchCart = po.items;
        document.getElementById('dispFrom').value = "Main Office";
        document.getElementById('dispTo').value = po.branch;
        await updateDoc(poRef, { status: "Approved" });
        
        if (typeof renderDispatchCart === 'function') renderDispatchCart(); else window.renderDispatchCart();
        window.loadDispatchLogs();
        
        Swal.fire({
            title: '✅ Purchase Order Loaded!',
            html: `${po.branch}'s request has been placed into your Dispatch Cart.<br><br><span style="font-size: 13px; color: #64748b;">You can now adjust quantities or remove out-of-stock items before clicking <b>Send Dispatch Delivery</b> to physically pack it.</span>`,
            icon: 'info', confirmButtonColor: '#0f766e', customClass: { popup: 'rounded-2xl' }
        });
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to load Purchase Order.', 'error'); }
};

// ========================================================
// 🚚 UPGRADED DISPATCH DETAILS MODAL (WITH VARIANCE & TIME)
// ========================================================
window.backloadDispatchItem = async function(logId, itemName, qtyToReturn, destinationBranch) {
    if (!confirm(`⚠️ BACKLOAD ITEM\n\nAre you sure you want to cancel the delivery of ${qtyToReturn} units of "${itemName}" to ${destinationBranch}?\n\nThis will mark the item as "Backloaded" and securely return the physical stock to the Main Office warehouse.`)) return;

    Swal.fire({ title: 'Processing Backload...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        // 1. Mark the dispatch log as Backloaded
        await updateDoc(doc(db, "dispatch_logs", logId), { 
            status: "Backloaded", 
            receivedDisplayQty: 0, 
            receivedQty: 0 
        });

        // 2. Refund the stock back to the Main Office
        const invQ = query(collection(db, "inventory"), where("branch", "==", "Main Office"), where("name", "==", itemName));
        const invSnap = await getDocs(invQ);
        
        if (!invSnap.empty) {
            let invDoc = invSnap.docs[0];
            let currentStock = parseFloat(invDoc.data().currentStock) || 0;
            let uom = invDoc.data().uom || 'units';
            
            await updateDoc(invDoc.ref, { currentStock: currentStock + qtyToReturn });

            // 3. Write an official Stock Log for the return
            await addDoc(collection(db, "stock_logs"), {
                branch: "Main Office", item: itemName, uom: uom,
                oldQty: currentStock, newQty: currentStock + qtyToReturn, variance: qtyToReturn,
                type: "Delivery Backload", note: `Cancelled transit to ${destinationBranch}. Stock returned.`,
                user: window.sessionUser ? window.sessionUser.cashierName : "Manager", timestamp: new Date()
            });
        }

        Swal.fire({
            title: '✅ Item Backloaded',
            text: `${itemName} has been successfully cancelled and returned to HQ inventory.`,
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
        
        // Refresh UI
        document.getElementById('dispatchDetailsModal').style.display = 'none';
        window.loadDispatchLogs();
        if(typeof window.loadInventoryData === 'function') window.loadInventoryData();
        
    } catch(e) {
        console.error("Backload Error:", e);
        Swal.fire('Error', 'Failed to backload item. Please check console.', 'error');
    }
};

window.viewDispatchDetails = function(encodedItems, branch, driver, date, time) {
    let items = JSON.parse(decodeURIComponent(encodedItems));
    let header = document.getElementById('dispatchDetailsHeader');
    let tbody = document.getElementById('dispatchDetailsBody');
    
    let receivedItem = items.find(i => i.receivedBy);
    let receiverName = receivedItem ? receivedItem.receivedBy : '<span style="color:#ef4444; font-style:italic;">Pending Receipt</span>';
    
    let receivedTimeStr = '<span style="color:#ef4444; font-style:italic;">Pending</span>';
    if (receivedItem && receivedItem.receivedAt) {
        let rDate = receivedItem.receivedAt.seconds ? new Date(receivedItem.receivedAt.seconds * 1000) : new Date(receivedItem.receivedAt);
        receivedTimeStr = rDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' + rDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    }

    let dispatchTime = time || items[0].time || 'Unknown';

    header.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div style="border-right: 1px dashed #cbd5e1; padding-right: 15px;">
                <div style="font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase;">Dispatch Info</div>
                <div style="margin-top: 5px;"><strong>📍 Destination:</strong> ${branch}</div>
                <div style="margin-top: 5px;"><strong>🚚 Driver:</strong> ${driver}</div>
                <div style="margin-top: 5px; color: #475569;"><strong>📅 Dispatched:</strong> ${date} at ${dispatchTime}</div>
            </div>
            <div>
                <div style="font-size: 11px; color: #0f766e; font-weight: bold; text-transform: uppercase;">Receiving Info</div>
                <div style="margin-top: 5px;"><strong>👤 Received By:</strong> <span style="color: #0f766e; font-weight: bold;">${receiverName}</span></div>
                <div style="margin-top: 5px; color: #475569;"><strong>⏰ Arrived:</strong> ${receivedTimeStr}</div>
            </div>
        </div>
    `;
    
    let html = '';
    items.forEach(item => {
        let sent = parseFloat(item.displayQty || item.qty);
        let baseQty = parseFloat(item.qty); // The raw background number used for refunds
        let received = item.receivedDisplayQty !== undefined ? parseFloat(item.receivedDisplayQty) : (item.receivedQty !== undefined ? parseFloat(item.receivedQty) : '-');
        let status = item.status || 'In Transit';
        let uom = item.displayUom || item.uom;
        
        let displayVariance = '-';
        if (received !== '-' && status !== 'Backloaded') {
            displayVariance = received - sent;
        }
        
        let varColor = displayVariance === '-' ? '#475569' : (displayVariance < 0 ? '#dc2626' : (displayVariance > 0 ? '#16a34a' : '#475569'));
        let varText = displayVariance === '-' ? '-' : (displayVariance > 0 ? `+${displayVariance}` : displayVariance) + ' ' + uom;

        // 🔥 THE FIX: Inject the Backload Button if it is still in transit!
        let cancelBtn = '';
        if (status === 'In Transit') {
            let safeItemName = (item.item || "").replace(/'/g, "\\'");
            let safeBranch = (branch || "").replace(/'/g, "\\'");
            cancelBtn = `<br><button onclick="window.backloadDispatchItem('${item.id}', '${safeItemName}', ${baseQty}, '${safeBranch}')" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; margin-top: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); width: 100%;">↩️ Backload / Cancel Item</button>`;
        }

        let bgRow = status === 'Backloaded' ? '#f8fafc' : 'white';
        let statusBg = received !== '-' ? '#dcfce7' : (status === 'Backloaded' ? '#e2e8f0' : '#fef9c3');
        let statusTextColor = received !== '-' ? '#16a34a' : (status === 'Backloaded' ? '#475569' : '#ca8a04');

        html += `<tr style="border-bottom:1px solid #f1f5f9; background: ${bgRow}; transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='${bgRow}'">
            <td style="padding:12px; font-weight:bold; color:${status === 'Backloaded' ? '#94a3b8' : '#334155'}; ${status === 'Backloaded' ? 'text-decoration: line-through;' : ''}">${item.item}</td>
            <td style="padding:12px; font-weight: bold;">${sent} ${uom}</td>
            <td style="padding:12px; color:#0284c7; font-weight:bold;">${received !== '-' ? received + ' ' + uom : (status === 'Backloaded' ? '-' : 'Pending')}</td>
            <td style="padding:12px; color:${varColor}; font-weight:900;">${varText}</td>
            <td style="padding:12px; text-align: center;">
                <span style="background: ${statusBg}; color: ${statusTextColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; display: inline-block;">${status}</span>
                ${cancelBtn}
            </td>
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

window.removeFromDispatchCart = function (index) {
  dispatchCart.splice(index, 1);
  renderDispatchCart();
};

// --- THE MENU EDITOR ENGINE (WITH CUSTOM ARRANGER) ---
window.globalMenuItemsCache = []; // Stores the menu in memory for arranging

window.loadMenuEditor = async function() {
  const tbody = document.getElementById('menuTableBody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="text-center">Fetching global menu...</td></tr>';

  let catFilterEl = document.getElementById('menuEditorCatFilter');
  let selectedCat = catFilterEl ? catFilterEl.value : 'All';

  // 🔥 INJECT THE SAVE LAYOUT BUTTON DYNAMICALLY
  let headerDiv = catFilterEl ? catFilterEl.closest('div') : null;
  if (headerDiv && !document.getElementById('btnSaveMenuOrder')) {
      let btnHtml = `<button id="btnSaveMenuOrder" class="btn-refresh" style="background: #8b5cf6; color: white; border: none; margin-left: 10px; box-shadow: 0 2px 4px rgba(139,92,246,0.3);" onclick="window.saveMenuItemLayout()">💾 Save Display Order</button>`;
      headerDiv.insertAdjacentHTML('beforeend', btnHtml);
  }

  try {
    const snap = await getDocs(collection(db, "menu"));
    
    // Fetch Custom Layout
    let layoutOrder = [];
    try {
        const layoutSnap = await getDoc(doc(db, "settings", "pos_item_layout"));
        if (layoutSnap.exists()) layoutOrder = layoutSnap.data().items || [];
    } catch(e) {}

    let items = [];
    let uniqueCategories = new Set();

    snap.forEach(doc => {
      let d = doc.data();
      items.push({ id: doc.id, ...d });
      if (d.category) uniqueCategories.add(d.category.trim());
    });

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">Menu is empty. Click "Add Menu Item" to start.</td></tr>';
      return;
    }

    if (catFilterEl) {
        let optionsHtml = '<option value="All">All Categories</option>';
        Array.from(uniqueCategories).sort().forEach(cat => {
            let isSelected = (cat === selectedCat) ? 'selected' : '';
            optionsHtml += `<option value="${cat}" ${isSelected}>${cat}</option>`;
        });
        catFilterEl.innerHTML = optionsHtml;
    }

    // 🔥 SORT BY CUSTOM LAYOUT FIRST, THEN ALPHABETICAL
    items.sort((a, b) => {
        let idxA = layoutOrder.indexOf(a.id);
        let idxB = layoutOrder.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    window.globalMenuItemsCache = items;
    window.renderMenuEditorUI();

  } catch (error) {
    console.error("Menu Engine Error:", error);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: red;">Error loading menu.</td></tr>';
  }
};

// ==========================================
// 🖱️ DRAG & DROP MENU ARRANGER ENGINE
// ==========================================
window.draggedMenuItemId = null;

window.handleMenuDragStart = function(e, id) {
    window.draggedMenuItemId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5'; // Makes the dragged item slightly transparent
};

window.handleMenuDragOver = function(e) {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
};

window.handleMenuDragEnter = function(e) {
    e.preventDefault();
    let tr = e.target.closest('tr');
    if (tr) tr.style.borderTop = "3px solid #8b5cf6"; // Show a purple drop-zone line!
};

window.handleMenuDragLeave = function(e) {
    let tr = e.target.closest('tr');
    if (tr) tr.style.borderTop = ""; // Remove the line when dragging away
};

window.handleMenuDrop = function(e, targetId) {
    e.stopPropagation();
    e.preventDefault();
    
    let tr = e.target.closest('tr');
    if (tr) tr.style.borderTop = "";
    
    // Stop if dropped on itself or outside
    if (!window.draggedMenuItemId || window.draggedMenuItemId === targetId) return;

    // Find the items in global memory
    let fromIdx = window.globalMenuItemsCache.findIndex(i => i.id === window.draggedMenuItemId);
    let toIdx = window.globalMenuItemsCache.findIndex(i => i.id === targetId);

    if (fromIdx >= 0 && toIdx >= 0) {
        // Cut the dragged item out of the array
        let item = window.globalMenuItemsCache.splice(fromIdx, 1)[0];
        // Paste it exactly at the new targeted location
        window.globalMenuItemsCache.splice(toIdx, 0, item);
        
        // Redraw the screen instantly!
        window.renderMenuEditorUI(); 
    }
};

window.handleMenuDragEnd = function(e) {
    e.target.style.opacity = '1';
    // Clean up any stuck purple lines just in case
    document.querySelectorAll('#menuTableBody tr').forEach(t => t.style.borderTop = "");
    window.draggedMenuItemId = null;
};

window.renderMenuEditorUI = function() {
    const tbody = document.getElementById('menuTableBody');
    let catFilterEl = document.getElementById('menuEditorCatFilter');
    let selectedCat = catFilterEl ? catFilterEl.value : 'All';
    let html = '';
    let count = 0;

    let visibleItems = window.globalMenuItemsCache.filter(item => {
        let cat = item.category || 'Uncategorized';
        return selectedCat === 'All' || cat === selectedCat;
    });

    visibleItems.forEach(data => {
      count++;
      let safePrice = parseFloat(data.price) || 0;
      let safeName = data.name ? data.name.replace(/'/g, "\\'") : 'Unnamed';
      let safeCat = (data.category || 'Uncategorized').replace(/'/g, "\\'");
      
      let imgHtml = data.image 
          ? `<img src="${data.image}" style="width:40px; height:40px; border-radius:6px; object-fit:cover; display:inline-block; vertical-align:middle; border:1px solid #e2e8f0;">` 
          : `<div style="width:40px; height:40px; border-radius:6px; background:#f1f5f9; display:inline-flex; align-items:center; justify-content:center; font-size:18px; vertical-align:middle; border:1px solid #e2e8f0;">🍲</div>`;

      // 🔥 THE BEAUTIFUL DRAG HANDLE
      let dragHandle = `<span style="color: #94a3b8; font-size: 18px; margin-right: 10px; cursor: grab;" title="Hold and drag to reorder">↕️</span>`;

      html += `
        <tr draggable="true"
            ondragstart="window.handleMenuDragStart(event, '${data.id}')"
            ondragover="window.handleMenuDragOver(event)"
            ondragenter="window.handleMenuDragEnter(event)"
            ondragleave="window.handleMenuDragLeave(event)"
            ondrop="window.handleMenuDrop(event, '${data.id}')"
            ondragend="window.handleMenuDragEnd(event)"
            style="border-bottom: 1px solid #f1f5f9; background: white; transition: background 0.2s;"
            onmouseover="this.style.background='#f8fafc'"
            onmouseout="this.style.background='white'">
          <td style="padding: 12px; display: flex; align-items: center;">${dragHandle}${imgHtml}<strong style="margin-left: 8px;"> ${data.name}</strong></td>
          <td style="padding: 12px;"><span class="badge badge-closed">${data.category || 'Uncategorized'}</span></td>
          <td style="padding: 12px; font-weight: 600; color: var(--primary);">${formatMoney(safePrice)}</td>
          <td style="padding: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn-refresh" style="background: white; border: 1px solid var(--primary); color: var(--primary); padding: 6px 12px; font-size: 12px; border-radius: 4px; cursor: pointer;" onclick="openBomEditor('${safeName}')">🍟 Recipe/Addons</button>
            <button class="btn-refresh" onclick="window.editMenuItem('${data.id}', '${safeName}', '${safeCat}', ${safePrice})">✏️ Edit</button>
            <label style="cursor: pointer; background: #f0fdf4; border: 1px solid #16a34a; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin: 0; display: inline-flex; align-items: center;">
                📷 Pic
                <input type="file" accept="image/jpeg, image/png, image/webp" style="display:none;" onchange="window.uploadMenuImage(event, '${data.id}')">
            </label>
            <button class="btn-refresh" style="color: var(--danger); border-color: var(--danger);" onclick="deleteMenuItem('${data.id}', '${safeName}')">🗑️</button>
          </td>
        </tr>
      `;
    });
    
    tbody.innerHTML = count > 0 ? html : `<tr><td colspan="4" class="text-center">No items found in category: ${selectedCat}.</td></tr>`;
};

window.saveMenuItemLayout = async function() {
    // Extracts the IDs in their exact new order
    let layoutIds = window.globalMenuItemsCache.map(i => i.id);
    
    let btn = document.getElementById('btnSaveMenuOrder');
    if (btn) btn.innerText = "⏳ Saving...";

    try {
        await setDoc(doc(db, "settings", "pos_item_layout"), { items: layoutIds }, { merge: true });
        Swal.fire({
            title: '✅ Layout Saved!',
            text: 'Menu item arrangement saved. Cashier apps will update instantly.',
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to save layout to cloud.', 'error');
    } finally {
        if (btn) btn.innerText = "💾 Save Display Order";
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
    await addDoc(collection(db, "menu"), { name: name, category: category, price: price });
    alert(`✅ Success! ${name} added to the global menu.`);
    window.loadMenuEditor();
  } catch (error) {
    console.error(error); alert("❌ Failed to add item.");
  }
};

// ==========================================
// ✏️ EDIT MENU ITEM (WITH AUTO-SYNC RECIPES)
// ==========================================
window.editMenuItem = async function (docId, currentName, currentCat, currentPrice) {
    const { value: formValues, isConfirmed } = await Swal.fire({
        title: '✏️ Edit Menu Item',
        html: `
            <div style="text-align: left; margin-top: 10px;">
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Item Name:</label>
                <input type="text" id="swal-menu-name" class="input-box" value="${currentName}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">

                <label style="font-size: 12px; font-weight: bold; color: #475569;">Category:</label>
                <input type="text" id="swal-menu-cat" class="input-box" value="${currentCat}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">

                <label style="font-size: 12px; font-weight: bold; color: #475569;">Base Price (₱):</label>
                <input type="number" id="swal-menu-price" class="input-box" value="${currentPrice}" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none;">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#0ea5e9',
        confirmButtonText: 'Save Changes',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        preConfirm: () => {
            return {
                name: document.getElementById('swal-menu-name').value.trim(),
                category: document.getElementById('swal-menu-cat').value.trim(),
                price: parseFloat(document.getElementById('swal-menu-price').value)
            };
        }
    });

    if (!isConfirmed || !formValues.name || isNaN(formValues.price)) return;

    Swal.fire({title: 'Syncing Database...', text: 'Updating menu and linked recipes...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        await updateDoc(doc(db, "menu", docId), { 
            name: formValues.name, 
            category: formValues.category, 
            price: formValues.price, 
            basePrice: formValues.price 
        });

        // 🔥 THE MAGIC FIX: CASCADE RENAME RECIPES SO INVENTORY KEEPS DEDUCTING!
        if (currentName !== formValues.name) {
            const bomQ = query(collection(db, "bom"), where("menuItem", "==", currentName));
            const bomSnap = await getDocs(bomQ);
            let updatePromises = [];
            bomSnap.forEach(bDoc => {
                updatePromises.push(updateDoc(doc(db, "bom", bDoc.id), { menuItem: formValues.name }));
            });
            await Promise.all(updatePromises);
            console.log(`✅ Synced recipes from ${currentName} to ${formValues.name}`);
        }
        
        Swal.fire({
            title: '✅ Saved!',
            text: `${formValues.name} has been successfully updated.`,
            icon: 'success',
            timer: 1500,
            showConfirmButton: false,
            customClass: { popup: 'rounded-2xl' }
        });
        
        window.loadMenuEditor();
    } catch (error) {
        console.error(error); Swal.fire('Error', 'Failed to update item.', 'error');
    }
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
    txSnap.forEach(doc => allTx.push({ id: doc.id, ...doc.data() }));
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

        // 🔥 SMART DIGITAL PAYMENT VERIFICATION UI 🔥
        let isDigital = payMethod.toLowerCase() !== "cash" && !payMethod.toLowerCase().includes("store use");
        let verifyBadge = "";
        let verifyBtn = "";
        
        if (isDigital) {
            if (tx.paymentVerified) {
                verifyBadge = `<br><span style="color: #16a34a; font-size: 10px; font-weight: bold;">✅ Verified by Manager</span>`;
            } else {
                verifyBadge = `<br><span style="color: #ea580c; font-size: 10px; font-weight: bold; animation: pulse 2s infinite;">⏳ Awaiting Verification</span>`;
                verifyBtn = `<button class="btn-bulk-verify" data-txid="${tx.id}" onclick="window.verifyDigitalPayment('${tx.id}', '${tx.receiptId}')" style="background: #16a34a; border: 1px solid #15803d; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">✅ Verify</button>`;
            }
        }

        // 🔥 THE ANTI-THEFT PREP TIMER ENGINE 🔥
        let txTimeMs = tx.timestamp ? (tx.timestamp.toDate ? tx.timestamp.toDate().getTime() : new Date(tx.timestamp).getTime()) : Date.now();
        let minutesElapsed = Math.floor((Date.now() - txTimeMs) / 60000);
        
        let statusDisplay = '';
        if (minutesElapsed < 10) {
            let timeLeft = 10 - minutesElapsed;
            statusDisplay = `<span class="live-prep-timer" data-time="${txTimeMs}" style="background: #fef08a; color: #b45309; border: 1px solid #fde047; padding: 4px 8px; border-radius: 6px; font-weight: 900; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 0 8px rgba(250, 204, 21, 0.6); animation: pulse 1.5s infinite;">🍳 COOKING (${timeLeft}m)</span>`;
        } else {
            statusDisplay = `<span class="badge badge-active"><span class="status-dot green"></span> PAID</span>`;
        }

        // 🔥 UPGRADED ROW WITH VERIFY BUTTON & TIMER
        transHtml += `<tr style="border-bottom: 1px solid #f1f5f9; ${isDigital && !tx.paymentVerified ? 'background: #fffbeb;' : ''}">
            <td style="padding: 10px;">${timeStr}</td>
            <td style="padding: 10px;"><strong>${tx.receiptId}</strong></td>
            <td style="padding: 10px; color: #475569; font-weight: bold;">${safeCustomer}</td>
            <td style="padding: 10px;">${payMethod}${verifyBadge}</td>
            <td style="padding: 10px;">${statusDisplay}</td>
            <td style="font-weight: 600; color: var(--primary); padding: 10px;">${formatMoney(tx.netTotal)}</td>
            <td style="padding: 10px; text-align: center; display: flex; gap: 5px; justify-content: center;">
                <button onclick="window.viewReceiptDetails('${tx.receiptId}', '${safeCustomer}', '${timeStr}', '${payMethod}', ${tx.netTotal}, '${safeCart}')" style="background: white; border: 1px solid #cbd5e1; color: #334155; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 View</button>
                ${verifyBtn}
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

// --- THE LIVE INVENTORY ENGINE (UPGRADED WITH TOTAL VALUE & ACTION DROPDOWNS) ---
window.refreshInventoryView = function() { window.loadInventoryData(); };

// 🔥 NEW: Dropdown Helper Functions
window.toggleActionMenu = function(menuId) {
    // Close all other open menus first
    document.querySelectorAll('.action-menu-content').forEach(menu => {
        if (menu.id !== menuId) menu.classList.remove('show-action-menu');
    });
    // Toggle the clicked one
    document.getElementById(menuId).classList.toggle('show-action-menu');
};

// Auto-close dropdowns when clicking anywhere else on the screen
window.addEventListener('click', function(e) {
    if (!e.target.matches('.action-menu-btn')) {
        document.querySelectorAll('.action-menu-content').forEach(menu => {
            if (menu.classList.contains('show-action-menu')) {
                menu.classList.remove('show-action-menu');
            }
        });
    }
});

window.loadInventoryData = async function() {
    let branchFilter = document.getElementById('invBranchFilter').value;
    let catFilter = document.getElementById('invCategoryFilter') ? document.getElementById('invCategoryFilter').value : "All";
    let search = document.getElementById('liveInvSearch').value.toLowerCase();
    
    let tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    
    // Updated colspan to 9 for the new Total Value column
    tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding: 20px;">Loading inventory...</td></tr>';
    
    try {
        let q = branchFilter === "All" ? query(collection(db, "inventory")) : query(collection(db, "inventory"), where("branch", "==", branchFilter));
        const snap = await getDocs(q);
        
        let html = '';
        let totalItems = 0;
        let totalValue = 0;

        let docsArray = snap.docs.map(d => ({id: d.id, ...d.data()}));
        docsArray.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        docsArray.forEach(d => {
            let itemName = (d.name || "").toLowerCase();
            let itemCat = d.category || "Uncategorized";
            
            if (catFilter !== "All" && itemCat !== catFilter) return; 
            if (search && !itemName.includes(search)) return; 
            
            totalItems++;
            let cost = parseFloat(d.cost) || parseFloat(d.purchCost) || parseFloat(d.unitCost) || 0;
            let stock = parseFloat(d.currentStock) || 0;
            let conv = parseFloat(d.conversionRate) || parseFloat(d.conversion) || 1;
            
            let baseCost = parseFloat(d.baseCost) || 0;
            if (baseCost === 0 && d.purchaseCost && d.conversionRate) {
                 baseCost = d.purchaseCost / d.conversionRate;
            }

            // 🔥 NEW: Calculate the specific row's total value (only if stock is positive)
            let rowTotalValue = 0;
            if (stock > 0 && !isNaN(baseCost)) {
                rowTotalValue = baseCost * stock;
                totalValue += rowTotalValue;
            }
            
            let isLow = stock <= parseFloat(d.reorderLevel || d.lowStockAlert || 5);
            let statusHtml = isLow ? `<span style="color:#ef4444; background:#fef2f2; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:11px;">Low Stock</span>` : `<span style="color:#16a34a; font-weight:bold; font-size:11px;">In Stock</span>`;
            
            let pUom = d.purchaseUom || d.purchUom || d.uom || 'units';
            let bUom = d.baseUom || d.uom || 'units';
            let purchStock = conv > 0 ? (stock / conv) : stock;
            
            let stockHtml = `
                <div style="font-weight: 900; color: ${isLow ? '#ef4444' : '#334155'}; font-size: 15px;">
                    ${stock.toFixed(1)} <span style="font-size: 11px; font-weight: normal; color: #64748b;">${bUom}</span>
                </div>
            `;
            if (conv !== 1 && pUom !== bUom) {
                stockHtml += `
                <div style="margin-top: 4px;">
                    <span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; border: 1px dashed #bae6fd; display: inline-block;">
                        ${purchStock.toFixed(2)} ${pUom}s
                    </span>
                </div>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 12px; text-align: center;">
                        <input type="checkbox" class="inv-bulk-checkbox" value="${d.id}" data-name="${d.name}" style="cursor: pointer; width: 16px; height: 16px;">
                    </td>
                    <td style="padding: 12px; font-weight:bold; color:#64748b; font-size:12px;">${d.branch}</td>
                    <td style="padding: 12px; font-weight:900; color:#1e293b;">${d.name}</td>
                    <td style="padding: 12px; font-size:12px; font-weight:bold; color:var(--primary);">${itemCat}</td>
                    <td style="padding: 12px;">${stockHtml}</td>
                    <td style="padding: 12px;">${statusHtml}</td>
                    <td style="padding: 12px; font-weight:bold; color:#64748b;">₱${baseCost.toFixed(2)}</td>
                    <td style="padding: 12px; font-weight:900; color:#0f766e; font-size: 14px;">₱${rowTotalValue.toFixed(2)}</td>
                    <td style="padding: 12px; text-align: center; position: relative;">
                        <!-- 🔥 NEW: Clean Action Dropdown -->
                        <div class="action-menu-container">
                            <button class="action-menu-btn" onclick="window.toggleActionMenu('menu_${d.id}')">⚙️ Actions ▼</button>
                            <div id="menu_${d.id}" class="action-menu-content">
                                ${d.branch === 'Main Office' ? `<button onclick="window.sellMainOfficeStock('${d.id}', '${d.name.replace(/'/g, "\\'")}', ${stock}, '${bUom}', ${baseCost})">💸 Sell Stock</button>` : ''}
                                <button onclick="window.openItemLedger('${d.branch}', '${d.name.replace(/'/g, "\\'")}')">🔍 Trace Ledger</button>
                                <button onclick="window.openEditInvModal('${d.id}')">✏️ Edit Item</button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });

        // Updated colspan to 9
        tbody.innerHTML = html || '<tr><td colspan="9" class="text-center" style="padding: 30px; color: #64748b; font-weight: bold;">No items match your filters.</td></tr>';
        
        let tItemsEl = document.getElementById('invTotalItems');
        let tValEl = document.getElementById('invTotalValue');
        if (tItemsEl) tItemsEl.innerText = totalItems;
        if (tValEl) tValEl.innerText = '₱' + totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

        if(typeof window.calculateInventoryKPIs === 'function') window.calculateInventoryKPIs(docsArray.filter(i => {
            let bMatch = branchFilter === "All" || i.branch === branchFilter;
            let cMatch = catFilter === "All" || i.category === catFilter;
            return bMatch && cMatch;
        }));

    } catch (e) {
        console.error("Inventory Load Error: ", e);
        // Updated colspan to 9
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:red; padding:20px;">Error loading inventory. Check connection.</td></tr>';
    }
};

// ========================================================
// 📊 COMMAND CENTER DASHBOARD LOGIC
// ========================================================
window.switchInvTab = function(tab) {
    window.activeInvTab = tab; 
    let overviewTab = document.getElementById('tabInvOverview'); let auditsTab = document.getElementById('tabInvAudits'); let wasteTab = document.getElementById('tabInvWaste'); let prepTab = document.getElementById('tabInvPrep'); let logsTab = document.getElementById('tabInvStockLogs'); let forecasterTab = document.getElementById('tabInvForecaster'); let alertsTab = document.getElementById('tabInvAlerts'); let aiBriefTab = document.getElementById('tabInvAIBrief');
    
    let liveSec = document.getElementById('invTabLiveContent'); let auditsSec = document.getElementById('invSectionAudits'); let wasteSec = document.getElementById('invSectionWaste'); let prepSec = document.getElementById('invSectionPrepLogs'); let logsSec = document.getElementById('invTabLogsContent'); let forecasterSec = document.getElementById('invSectionForecaster'); let alertsSec = document.getElementById('invSectionAlerts'); let aiBriefSec = document.getElementById('invSectionAIBrief');

    [overviewTab, auditsTab, wasteTab, prepTab, logsTab, forecasterTab, alertsTab, aiBriefTab].forEach(t => { if(t) { t.style.color = '#64748b'; t.style.borderBottomColor = 'transparent'; }});
    [liveSec, auditsSec, wasteSec, prepSec, logsSec, forecasterSec, alertsSec, aiBriefSec].forEach(s => { if(s) s.style.display = 'none'; });

    if (tab === 'Overview') { if(overviewTab) { overviewTab.style.color = '#0f766e'; overviewTab.style.borderBottomColor = '#0f766e'; } if(liveSec) liveSec.style.display = 'block'; } 
    else if (tab === 'Audits') { if(auditsTab) { auditsTab.style.color = '#0f766e'; auditsTab.style.borderBottomColor = '#0f766e'; } if(auditsSec) auditsSec.style.display = 'block'; } 
    else if (tab === 'Waste') { if(wasteTab) { wasteTab.style.color = '#0f766e'; wasteTab.style.borderBottomColor = '#0f766e'; } if(wasteSec) wasteSec.style.display = 'block'; } 
    else if (tab === 'Prep') { if(prepTab) { prepTab.style.color = '#0f766e'; prepTab.style.borderBottomColor = '#0f766e'; } if(prepSec) prepSec.style.display = 'block'; } 
    else if (tab === 'StockLogs') { if(logsTab) { logsTab.style.color = '#0f766e'; logsTab.style.borderBottomColor = '#0f766e'; } if(logsSec) logsSec.style.display = 'block'; } 
    else if (tab === 'Forecaster') { if(forecasterTab) { forecasterTab.style.color = '#0f766e'; forecasterTab.style.borderBottomColor = '#0f766e'; } if(forecasterSec) forecasterSec.style.display = 'block'; }
    else if (tab === 'Alerts') { if(alertsTab) { alertsTab.style.color = '#ef4444'; alertsTab.style.borderBottomColor = '#ef4444'; } if(alertsSec) alertsSec.style.display = 'block'; }
    else if (tab === 'AIBrief') { if(aiBriefTab) { aiBriefTab.style.color = '#8b5cf6'; aiBriefTab.style.borderBottomColor = '#8b5cf6'; } if(aiBriefSec) aiBriefSec.style.display = 'block'; }

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
    else if (tab === 'AIBrief') window.generateAIReport(); 
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

// ========================================================
// 🔥 THE KITCHEN BATCH PREP ENGINE (CONVERSION MATH FIX) 🔥
// ========================================================
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

        // 4. ADD the new prepared batch to the inventory (🔥 CONVERSION MATH FIX)
        const targetQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", targetItem));
        const targetSnap = await getDocs(targetQ);
        let targetRef = targetSnap.docs[0].ref;
        let targetData = targetSnap.docs[0].data(); 
        let targetStock = targetData.currentStock || 0;
        
        // 🔥 Multiply the batches they prepared by the base conversion rate!
        let convRate = parseFloat(targetData.conversionRate) || parseFloat(targetData.conversion) || 1;
        let baseQtyToAdd = prepQty * convRate;

        await updateDoc(targetRef, { currentStock: targetStock + baseQtyToAdd });

        // 5. LOG TO HISTORY WITH PROPER UOM
        let pUom = targetData.purchaseUom || "Batch";
        let bUom = targetData.baseUom || targetData.uom || "units";

        await addDoc(collection(db, "stock_logs"), {
            branch: branch,
            item: targetItem,
            uom: bUom,
            oldQty: targetStock,
            newQty: targetStock + baseQtyToAdd,
            variance: baseQtyToAdd,
            type: "Manager Prep Batch",
            note: `Prepared ${prepQty} ${pUom}(s) via Manager HQ`,
            user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: new Date()
        });

        // Success!
        alert(`🥣 Kitchen Success!\n\nPrepared ${prepQty} ${pUom}(s) of ${targetItem}.\n(Added +${baseQtyToAdd.toLocaleString()} ${bUom} to stock!)\n\nAll raw ingredients were automatically deducted from ${branch}.`);
        document.getElementById('batchModal').style.display = 'none';
        
        // Refresh the view you are currently on
        if (document.getElementById('view-inventory') && document.getElementById('view-inventory').classList.contains('active')) {
            if(typeof window.loadLiveInventory === 'function') window.loadLiveInventory();
            if(typeof window.loadInventoryData === 'function') window.loadInventoryData();
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
  // Clear the box for new items!
  let mixInput = document.getElementById('advProdMixMatch');
  if (mixInput) mixInput.value = '';
  
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
          showInPrep: document.getElementById('newInvShowPrep') ? document.getElementById('newInvShowPrep').checked : true,
          allowRequest: document.getElementById('newInvAllowRequest') ? document.getElementById('newInvAllowRequest').checked : true,
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
      
      // Load the Mix & Match flavors into the box!
      let mixInput = document.getElementById('advProdMixMatch');
      if (mixInput) {
          mixInput.value = mData.mixMatchFlavors ? mData.mixMatchFlavors.join(', ') : "";
          
          // 🔥 INJECT THE MAPPING CONTAINER DYNAMICALLY
          let mappingDiv = document.getElementById('mixMatchMappingContainer');
          if (!mappingDiv) {
              mappingDiv = document.createElement('div');
              mappingDiv.id = 'mixMatchMappingContainer';
              mappingDiv.style.marginTop = '15px';
              mixInput.parentNode.appendChild(mappingDiv);
          }
          
          // Attach live typing listener
          mixInput.oninput = window.renderMixMatchConfig;
          
          // Load existing memory
          window.currentMixMatchConfig = mData.mixMatchConfig || [];
          window.renderMixMatchConfig();
      }
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

    // 🔥 INJECT THE NEW "AUTO-LOAD CATEGORY ADD-ONS" BUTTON
    let cloneControls = document.getElementById('addonCloneSelect');
    if (cloneControls && !document.getElementById('btnAutoLoadAddons')) {
        let parentDiv = cloneControls.parentElement;
        let autoBtn = document.createElement('button');
        autoBtn.id = "btnAutoLoadAddons";
        autoBtn.className = "btn-refresh";
        autoBtn.innerHTML = "⚡ Auto-Load Category Add-Ons";
        autoBtn.style.cssText = "background: #f59e0b; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; margin-left: 10px; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3);";
        autoBtn.onclick = window.autoLoadCategoryAddons;
        parentDiv.appendChild(autoBtn);
    }

  } catch (e) {
    console.error(e); alert("Failed to load product details.");
  }
};

// ========================================================
// 🐙 MIX & MATCH INVENTORY LINKER ENGINE
// ========================================================
window.renderMixMatchConfig = function() {
    let container = document.getElementById('mixMatchMappingContainer');
    let mixInput = document.getElementById('advProdMixMatch');
    if (!container || !mixInput) return;
    
    let flavorsRaw = mixInput.value;
    let flavors = flavorsRaw.split(',').map(s => s.trim()).filter(Boolean);
    
    if (flavors.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = `<div style="font-size: 11px; font-weight: bold; color: #b91c1c; margin-bottom: 8px; border-top: 1px dashed #fca5a5; padding-top: 10px;">🔗 LINK FLAVORS TO INVENTORY (Qty to deduct per 1 piece)</div>`;
    
    flavors.forEach(flavor => {
        let existing = (window.currentMixMatchConfig || []).find(c => c.flavor === flavor) || {};
        
        // Re-use the pre-loaded inventory dropdown options from the Add-ons module
        let dropdownHtml = window.cachedInventoryOptions || '<option value="">-- Loading... --</option>';
        if (existing.linkedIngredient) {
            dropdownHtml = dropdownHtml.replace(`value="${existing.linkedIngredient}"`, `value="${existing.linkedIngredient}" selected`);
        }

        html += `
            <div class="mix-match-row" data-flavor="${flavor}" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; background: #fff1f2; padding: 8px; border-radius: 6px; border: 1px solid #fecaca;">
                <div style="flex: 1; font-weight: bold; color: #9f1239; font-size: 13px;">🐙 ${flavor}</div>
                <select class="mm-ingredient input-box" style="flex: 2; padding: 6px; font-size: 12px; border: 1px solid #fca5a5; outline: none; border-radius: 4px; background: white; color: #1e293b;">
                    ${dropdownHtml}
                </select>
                <input type="number" class="mm-qty input-box" placeholder="Qty deduct" value="${existing.deductQty || ''}" style="width: 80px; padding: 6px; font-size: 12px; border: 1px solid #fca5a5; outline: none; border-radius: 4px; text-align: center; font-weight: bold; color: #b91c1c;">
            </div>
        `;
    });
    
    container.innerHTML = html;
};

window.autoLoadCategoryAddons = async function() {
    let currentCat = document.getElementById('advProdCat').value;
    if (!currentCat) return Swal.fire('Error', 'Please ensure this product has a Category assigned first.', 'warning');

    let btn = document.getElementById('btnAutoLoadAddons');
    if (btn) { btn.innerText = "⏳ Fetching..."; btn.disabled = true; }

    try {
        const snap = await getDocs(collection(db, "global_addons"));
        let addedCount = 0;

        // Map out what is already in the table so we don't duplicate them!
        let existingAddons = [];
        document.querySelectorAll('#addonTableBody .addon-name').forEach(inp => {
            if(inp.value.trim()) existingAddons.push(inp.value.trim().toLowerCase());
        });

        snap.forEach(doc => {
            let d = doc.data();
            // Match the product's category OR grab universal "All" add-ons
            if (d.category === currentCat || d.category === "All" || !d.category) {
                if (!existingAddons.includes(d.name.toLowerCase())) {
                    window.addAddonRow(d.name, d.price, d.linkedIngredient, d.deductQty);
                    addedCount++;
                }
            }
        });

        if (addedCount > 0) {
            Swal.fire({ title: '✅ Success!', text: `Auto-loaded ${addedCount} add-ons for the "${currentCat}" category! Don't forget to hit Save.`, icon: 'success', timer: 2000, showConfirmButton: false, customClass: { popup: 'rounded-2xl' } });
        } else {
            Swal.fire('Up to Date', `No missing add-ons found for the "${currentCat}" category in the Global Hub.`, 'info');
        }
    } catch (e) {
        console.error("Error loading category addons:", e);
        Swal.fire('Error', 'Failed to load add-ons from cloud.', 'error');
    } finally {
        if (btn) { btn.innerText = "⚡ Auto-Load Category Add-Ons"; btn.disabled = false; }
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
  
  // Grab the Mix and Match flavors!
  let mixMatchRaw = document.getElementById('advProdMixMatch') ? document.getElementById('advProdMixMatch').value : "";
  let mixMatchArr = mixMatchRaw.split(',').map(s => s.trim()).filter(Boolean);

  // 🔥 GATHER THE MIX & MATCH INVENTORY CONFIGURATIONS
  let mixMatchConfigArray = [];
  document.querySelectorAll('.mix-match-row').forEach(row => {
      let flavor = row.getAttribute('data-flavor');
      let ingredient = row.querySelector('.mm-ingredient').value;
      let qty = parseFloat(row.querySelector('.mm-qty').value) || 0;
      
      if (ingredient && qty > 0) {
          mixMatchConfigArray.push({ flavor: flavor, linkedIngredient: ingredient, deductQty: qty });
      }
  });

  // Anti-Blank Name Shield
  if (!prodName) {
    alert("❌ Error: Product name is required.");
    btn.innerText = "Save Changes"; btn.disabled = false;
    return;
  }

  try {
    // 🍟 GATHER ALL ADD-ONS BEFORE SAVING
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

    // 1. Save Menu Details AND Add-ons AND MixMatch configs!
    if (menuId) {
      await updateDoc(doc(db, "menu", menuId), { 
          name: prodName, 
          category: category, 
          price: price,
          basePrice: price, 
          addons: addonsArray,
          mixMatchFlavors: mixMatchArr,
          mixMatchConfig: mixMatchConfigArray // 🔥 NEW!
      });
    } else {
      let newMenuRef = await addDoc(collection(db, "menu"), { 
          name: prodName, 
          category: category, 
          price: price,
          basePrice: price, 
          addons: addonsArray,
          mixMatchFlavors: mixMatchArr,
          mixMatchConfig: mixMatchConfigArray // 🔥 NEW!
      });
      document.getElementById('advProdId').value = newMenuRef.id;
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

    alert("✅ Product, Recipe, Add-ons, and Flavors saved successfully!");
        
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
window.openEditInvModal = async function(id) {
    try {
        const docRef = doc(db, "inventory", id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            let itemData = docSnap.data();
            
            document.getElementById('editInvId').value = id;
            document.getElementById('editInvBranch').value = itemData.branch || 'Main Office';
            document.getElementById('editInvCat').value = itemData.category || '';
            document.getElementById('editInvName').value = itemData.name || '';
            
            document.getElementById('editInvPurchUom').value = itemData.purchaseUom || itemData.purchUom || '';
            document.getElementById('editInvBaseUom').value = itemData.baseUom || itemData.uom || '';
            document.getElementById('editInvConversion').value = itemData.conversionRate || itemData.conversion || 1;
            document.getElementById('editInvPurchCost').value = itemData.purchaseCost || itemData.purchCost || itemData.cost || 0;
            document.getElementById('editInvLowStock').value = itemData.lowStockAlert || itemData.reorderLevel || 0;
            
            document.getElementById('editInvOldQty').value = itemData.currentStock || 0;
            
            // Clear the physical count box so they don't accidentally save an old number
            let newQtyEl = document.getElementById('editInvNewQty');
            if (newQtyEl) {
                newQtyEl.value = '';
                newQtyEl.onkeyup = window.calcEditVariance; // Updates math while typing
            }
            
            // Set the dropdown to default and attach the click listener
            let countTypeEl = document.getElementById('editInvCountType');
            if (countTypeEl) {
                countTypeEl.value = 'base';
                countTypeEl.onchange = window.calcEditVariance; // Updates math when switching UOMs!
            }
            
            document.getElementById('editInvNote').value = '';
            
            let varianceEl = document.getElementById('editInvVariance');
            if (varianceEl) {
                varianceEl.innerText = '0';
                varianceEl.style.color = '#d97706';
            }

            if (document.getElementById('editInvShowPrep')) {
                document.getElementById('editInvShowPrep').checked = itemData.showInPrep !== false;
            }
            if (document.getElementById('editInvAllowRequest')) {
                document.getElementById('editInvAllowRequest').checked = itemData.allowRequest !== false;
            }
            document.getElementById('editInvModal').style.display = 'flex';

            // 🔥 FORCE THE UI TO INJECT THE UOM NAMES INSTANTLY
            window.calcEditVariance();

        } else {
            alert("The requested inventory item could not be located in the central database.");
        }
    } catch (e) {
        console.error("Error opening edit modal:", e);
        alert("Failed to successfully load item details: " + e.message);
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
    let newQRaw = document.getElementById('editInvNewQty').value;
    let countTypeEl = document.getElementById('editInvCountType');
    let countType = countTypeEl ? countTypeEl.value : 'base';
    let conv = parseFloat(document.getElementById('editInvConversion').value) || 1;
    let varianceEl = document.getElementById('editInvVariance');

    // 🔥 DYNAMIC UI REDESIGN: Fetch the actual UOM names you typed!
    let pUom = document.getElementById('editInvPurchUom').value || 'Purchase UOM';
    let bUom = document.getElementById('editInvBaseUom').value || 'Base UOM';

    // 1. Inject the real names into the Dropdown Options instantly
    if (countTypeEl) {
        let currentSel = countTypeEl.value; // Remember what they clicked
        countTypeEl.innerHTML = `
            <option value="base">Count in ${bUom}</option>
            <option value="purch">Count in ${pUom}</option>
        `;
        countTypeEl.value = currentSel; // Put the selection back
    }

    // 2. Inject the real name into the Variance Label
    if (varianceEl && varianceEl.previousElementSibling) {
        varianceEl.previousElementSibling.innerText = `Calculated Variance (${bUom}): `;
    }

    // 3. Do the Math
    if (newQRaw === "") {
        if(varianceEl) {
            varianceEl.innerText = "0";
            varianceEl.style.color = "#d97706";
        }
        return;
    }

    // Convert to Base UOM if they are counting in Purchase UOM
    let parsedInput = parseFloat(newQRaw);
    let finalBaseQty = countType === 'purch' ? (parsedInput * conv) : parsedInput;
    
    let diff = finalBaseQty - oldQ;
    let sign = diff > 0 ? "+" : "";
    if (varianceEl) {
        varianceEl.innerText = `${sign}${diff.toFixed(2)}`; // Clean 2 decimal places
        varianceEl.style.color = diff < 0 ? "#ef4444" : "#16a34a";
    }
};

// ==========================================
// ✏️ UPGRADED INVENTORY EDIT ENGINE (GLOBAL SYNC & RENAME)
// ==========================================
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
    let countType = document.getElementById('editInvCountType') ? document.getElementById('editInvCountType').value : 'base';
    let note = document.getElementById('editInvNote').value.trim();

    if (!name) { alert("Item name is required!"); return; }

    let finalQty = oldQty;
    let isAdjusting = false;

    if (newQtyRaw !== "") {
        let parsedInput = parseFloat(newQtyRaw);
        finalQty = countType === 'purch' ? (parsedInput * conversion) : parsedInput;
        
        isAdjusting = true;
        if (!note) { alert("You must provide an Adjustment Note/Reason if you are changing the stock quantity."); return; }
    }

    let btn = document.getElementById('btnSaveInvEdit');
    btn.innerText = "⏳ Saving & Syncing Globally..."; btn.disabled = true;

    // 🔥 UPLOAD INVENTORY PHOTO TO STORAGE
    let photoUrl = undefined;
    let fileInput = document.getElementById('editInvPhoto');
    if (fileInput && fileInput.files.length > 0) {
        btn.innerText = "⏳ Uploading Photo...";
        const file = fileInput.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `inventory_images/${docId}_${Date.now()}.${fileExt}`;
        const storageReference = ref(window.storage, fileName);
        const snapshot = await uploadBytes(storageReference, file);
        photoUrl = await getDownloadURL(snapshot.ref);
    }

    try {
        let showPrepVal = document.getElementById('editInvShowPrep') ? document.getElementById('editInvShowPrep').checked : true;
        let allowReqVal = document.getElementById('editInvAllowRequest') ? document.getElementById('editInvAllowRequest').checked : true;

        // 🔥 THE SYNC FIX: Fetch the OLD name before we change it so we can find the siblings!
        const itemRef = doc(db, "inventory", docId);
        const itemSnap = await getDoc(itemRef);
        let oldName = itemSnap.exists() ? itemSnap.data().name : name;

        // 1. Prepare Main Payload
        let updatePayload = {
            branch: branch, category: category, name: name,
            purchaseUom: purchUom, purchUom: purchUom,
            baseUom: baseUom, uom: baseUom, 
            conversion: conversion, conversionRate: conversion, 
            purchaseCost: purchCost, purchCost: purchCost, cost: purchCost, 
            baseCost: (purchCost / conversion), 
            lowStockAlert: lowStock, reorderLevel: lowStock, 
            currentStock: finalQty, 
            showInPrep: showPrepVal,
            allowRequest: allowReqVal,
        };

        if (photoUrl !== undefined) {
            updatePayload.image = photoUrl;
        }

        // Update the Main Item you clicked on
        await updateDoc(itemRef, updatePayload);

        // 🔥 2. GLOBAL RENAME & UOM SYNC 🔥
        // Use the old name to search the other branches!
        const syncQ = query(collection(db, "inventory"), where("name", "==", oldName));
        const syncSnap = await getDocs(syncQ);
        let syncPromises = [];
        
        syncSnap.forEach(d => {
            if (d.id !== docId) {
                let syncPayload = {
                    name: name, // 🔥 INJECT THE NEW NAME!
                    category: category, 
                    purchaseUom: purchUom, purchUom: purchUom,
                    baseUom: baseUom, uom: baseUom, 
                    conversion: conversion, conversionRate: conversion,
                    purchaseCost: purchCost, purchCost: purchCost, cost: purchCost,
                    baseCost: (purchCost / conversion),
                    showInPrep: showPrepVal 
                };
                
                if (photoUrl !== undefined) {
                    syncPayload.image = photoUrl;
                }
                
                syncPromises.push(updateDoc(doc(db, "inventory", d.id), syncPayload));
            }
        });

        // 🔥 3. CASCADE RECIPE & ADD-ON RENAME PROTECTOR 🔥
        // If the name changed, we MUST update recipes or the POS costing will crash!
        if (oldName !== name) {
            const bomQ = query(collection(db, "bom"), where("ingredientName", "==", oldName));
            const bomSnap = await getDocs(bomQ);
            bomSnap.forEach(b => {
                syncPromises.push(updateDoc(doc(db, "bom", b.id), { ingredientName: name }));
            });

            const addonQ = query(collection(db, "global_addons"), where("linkedIngredient", "==", oldName));
            const addonSnap = await getDocs(addonQ);
            addonSnap.forEach(a => {
                syncPromises.push(updateDoc(doc(db, "global_addons", a.id), { linkedIngredient: name }));
            });
        }

        // Wait for all branch and recipe updates to finish
        await Promise.all(syncPromises);

        // 4. Log Physical Adjustments
        if (isAdjusting && finalQty !== oldQty) {
            let variance = finalQty - oldQty;
            let safeCashierName = window.sessionUser ? window.sessionUser.cashierName : 'Manager';
            let finalNote = countType === 'purch' ? `[Counted as ${newQtyRaw} ${purchUom}s] ${note}` : note;

            await addDoc(collection(db, "stock_logs"), {
                branch: branch, item: name, oldQty: oldQty, newQty: finalQty, variance: variance, uom: baseUom,
                type: "Manual Adjustment", note: finalNote, user: safeCashierName, timestamp: serverTimestamp()
            });
        }

        Swal.fire({
            title: '✅ Success!',
            text: 'Item updated, renamed, and synced across all branches & recipes successfully!',
            icon: 'success',
            confirmButtonColor: '#ea580c',
            customClass: { popup: 'rounded-2xl shadow-2xl' }
        });
        
        document.getElementById('editInvModal').style.display = 'none';
        window.loadInventoryData();
        if (typeof window.loadMenuCosting === 'function') window.loadMenuCosting();

    } catch (e) {
        console.error(e); alert("Failed to save changes.");
    } finally {
        btn.innerText = "💾 Save All Changes"; btn.disabled = false;
        if(document.getElementById('editInvCountType')) document.getElementById('editInvCountType').value = 'base';
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

// ========================================================
// 🏦 MASTER CASH FLOW & EXPLORER ENGINE
// ========================================================

window.loadCashExplorer = async function() {
    // 1. We calculate the "Pending Verifications" directly from Firebase!
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
        if (branchFilter === 'All') {
            pendingQ = query(collection(db, "remittances"), where("status", "==", "Pending"));
        } else {
            pendingQ = query(collection(db, "remittances"), where("branch", "==", branchFilter), where("status", "==", "Pending"));
        }

        const pendingSnap = await getDocs(pendingQ);
        let pendingTotal = 0;

        pendingSnap.forEach(docSnap => {
            pendingTotal += (parseFloat(docSnap.data().amount) || 0);
        });

        if (document.getElementById('hubPendingCash')) {
            document.getElementById('hubPendingCash').innerText = `₱${pendingTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        }
    } catch (error) {
        console.error("Cash Explorer Error:", error);
    }
};

window.loadCashFlowHub = async function() {
    try {
        let safeCash = 0;
        const accSnap = await getDocs(collection(db, "cash_accounts"));
        accSnap.forEach(doc => { safeCash += (parseFloat(doc.data().balance) || 0); });

        let branchHtml = '';
        let totalDrawerCash = 0;

        for (let branch of window.globalActiveBranches) {
            if (branch === "Main Office") continue;

            let drawerAmount = 0;
            let drawerStatus = "";
            let alertColor = "#0f766e";
            let alertBg = "#f0fdfa";
            let alertBorder = "#bbf7d0";

            const activeQ = query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true));
            const activeSnap = await getDocs(activeQ);

            if (!activeSnap.empty) {
                let sData = activeSnap.docs[0].data();
                let sTime = sData.startTime.toDate();
                drawerAmount = parseFloat(sData.startingCash) || 0;

                const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", sTime));
                const txSnap = await getDocs(txQ);
                txSnap.forEach(t => {
                    let tx = t.data();
                    if (tx.status !== 'Voided') {
                        if (tx.splitDetails) {
                            let cashSplit = tx.splitDetails.find(s => s.method === "Cash");
                            if (cashSplit) drawerAmount += cashSplit.amount;
                        } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                            drawerAmount += (parseFloat(tx.netTotal) || 0);
                        }
                    }
                });

                const expQ = query(collection(db, "expenses"), where("shiftId", "==", activeSnap.docs[0].id));
                const expSnap = await getDocs(expQ);
                expSnap.forEach(e => { drawerAmount -= (parseFloat(e.data().amount) || 0); });

                drawerStatus = '<span style="color:#16a34a; font-weight:bold; font-size:11px;">🟢 Register Open</span>';
            } else {
                const closedQ = query(collection(db, "shifts"), where("branch", "==", branch), where("status", "==", "Closed"), orderBy("endTime", "desc"), limit(1));
                const closedSnap = await getDocs(closedQ);
                if (!closedSnap.empty) {
                    drawerAmount = parseFloat(closedSnap.docs[0].data().declaredCash) || 0;
                    drawerStatus = '<span style="color:#64748b; font-weight:bold; font-size:11px;">⚪ Register Closed</span>';
                } else {
                    drawerStatus = '<span style="color:#94a3b8; font-weight:bold; font-size:11px;">No Data</span>';
                }
            }

            if (drawerAmount > 5000) {
                alertColor = "#dc2626"; alertBg = "#fef2f2"; alertBorder = "#fecaca";
            }

            totalDrawerCash += drawerAmount;

            // 🔥 HERE IS THE HARDCODED CLICK! IT WORKS INSTANTLY NOW.
            branchHtml += `
                <div onclick="window.openBranchTransferHistory('${branch}')" style="background: ${alertBg}; border: 1px solid ${alertBorder}; border-radius: 8px; padding: 15px; text-align: center; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 10px 15px rgba(0,0,0,0.1)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.05)';">
                    <div style="font-weight: bold; color: #334155; margin-bottom: 5px; font-size: 14px;">📍 ${branch}</div>
                    <div style="font-size: 20px; font-weight: 900; color: ${alertColor};">₱${drawerAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                    <div style="margin-top: 4px;">${drawerStatus}</div>
                </div>
            `;
        }

        document.getElementById('hubSafeCash').innerText = `₱${safeCash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('hubFloatingCash').innerText = `₱${totalDrawerCash.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        
        if (document.getElementById('lifetimeRemittanceTabs')) document.getElementById('lifetimeRemittanceTabs').style.display = 'none';
        
        document.querySelectorAll('div, span, h3').forEach(el => {
            if (el.innerText === "FLOATING CASH (AT BRANCHES)") el.innerText = "LIVE CASH IN DRAWERS";
            if (el.innerText === "Expected Z-Reading Cash not yet remitted") el.innerText = "Total physical cash sitting in branches right now";
        });

        document.getElementById('branchFloatingContainer').innerHTML = branchHtml;

    } catch (e) {
        console.error("Cash Flow Hub Error:", e);
        document.getElementById('branchFloatingContainer').innerHTML = `<div style="text-align: center; color: red; grid-column: 1/-1;">Error calculating cash flow.</div>`;
    }
};

window.openBranchTransferHistory = async function(branchName) {
    let modal = document.getElementById('branchTransferHistoryModal');
    if (!modal) {
        alert("Modal HTML not found! Make sure Step 2 from the previous prompt was pasted into your index.html.");
        return;
    }
    
    modal.style.display = 'flex';
    document.getElementById('bthModalTitle').innerText = `📜 Remittance History - ${branchName}`;
    let tbody = document.getElementById('bthModalBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px; font-weight: bold; color: #64748b;">⏳ Fetching branch logs...</td></tr>';

    try {
        let startDateStr = document.getElementById('transferStartDate')?.value;
        let endDateStr = document.getElementById('transferEndDate')?.value;
        
        let q;
        if (startDateStr && endDateStr) {
            let start = new Date(startDateStr); start.setHours(0,0,0,0);
            let end = new Date(endDateStr); end.setHours(23,59,59,999);
            q = query(collection(db, "remittances"), 
                where("branch", "==", branchName), 
                where("timestamp", ">=", start),
                where("timestamp", "<=", end),
                orderBy("timestamp", "desc")
            );
        } else {
            q = query(collection(db, "remittances"), 
                where("branch", "==", branchName), 
                orderBy("timestamp", "desc"), 
                limit(50)
            );
        }

        const snap = await getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let docId = docSnap.id;
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'N/A';

            let statusBadge = `<span style="background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⏳ Pending</span>`;
            if (d.status === "Received" || d.status === "Approved") statusBadge = `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">✅ Received</span>`;
            if (d.status === "Rejected") statusBadge = `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">❌ Rejected</span>`;

            let actionHtml = '';
            if (d.status === "Pending") {
                actionHtml = `
                    <div style="display: flex; gap: 5px; justify-content: center;">
                        <button onclick="window.viewRemittanceAudit('${docId}', '${branchName}', '${d.salesPeriodStart || ''}', '${d.salesPeriodEnd || ''}', ${d.amount}, '${d.channel}')" style="background: #0ea5e9; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;">🔍 Audit</button>
                        <button onclick="window.approveRemittance('${docId}')" style="background: #16a34a; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;">Approve</button>
                        <button onclick="window.rejectRemittance('${docId}', '${branchName}')" style="background: #dc2626; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;">Reject</button>
                    </div>
                `;
            } else {
                actionHtml = `<span style="color: #94a3b8; font-size: 11px; font-style: italic;">Locked</span>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                    <td style="padding: 15px 20px; font-size: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 15px 20px;">
                        <div style="font-weight: bold; color: #334155; font-size: 13px;">${d.cashier || d.cashierName || d.staffName || 'Staff'}</div>
                    </td>
                    <td style="padding: 15px 20px; font-size: 13px; color: #0f172a;">
                        <strong>${d.channel || 'Cash'}</strong><br>
                        <span style="color: #0284c7; font-size: 11px;">Ref: ${d.referenceNumber || d.ref || 'N/A'}</span>
                    </td>
                    <td style="padding: 15px 20px; text-align: center;">${statusBadge}</td>
                    <td style="padding: 15px 20px; text-align: right; font-weight: 900; color: #16a34a; font-size: 14px;">₱${parseFloat(d.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 20px; text-align: center;">${actionHtml}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #94a3b8; font-style: italic;">No transfer history found for this branch.</td></tr>';
    } catch (e) {
        console.error("Modal Fetch Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: #dc2626; padding: 30px; font-weight: bold;">❌ Error connecting to database. Check console.</td></tr>';
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
            Swal.fire({title: 'Rejecting...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

            await updateDoc(doc(db, "remittances", docId), {
                status: "Rejected",
                rejectedReason: reason,
                rejectedAt: serverTimestamp(),
                rejectedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager"
            });
            
            Swal.fire("Rejected", "Remittance has been rejected and locked.", "success");
            
            window.loadCashExplorer(); // Refresh the table instantly
            if (typeof window.loadUnremittedCashDashboard === 'function') window.loadUnremittedCashDashboard();
            if (typeof window.loadDashboard === 'function') window.loadDashboard();
            
            // 🔥 THE UI FIX: Refresh the Modal so the button disappears instantly!
            if (document.getElementById('branchTransferHistoryModal') && document.getElementById('branchTransferHistoryModal').style.display === 'flex') {
                window.openBranchTransferHistory(branchName);
            }
            
        } catch (e) {
            console.error("Error rejecting remittance:", e);
            Swal.fire("Error", "Failed to reject remittance. Please check your connection.", "error");
        }
    }
};

// --- THE NEW SMART DEPOSIT APPROVAL BUTTON ---
window.approveRemittance = async function (docId) {
    if (!confirm("✅ Mark this remittance as safely received and deposit it into your Cash Accounts?")) return;
    
    try {
        Swal.fire({title: 'Approving...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

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
        const accQuery = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", targetAccountName));
        const accSnap = await getDocs(accQuery);

        if (accSnap.empty) {
            Swal.fire('⚠️ Routing Error', `No cash account named "${targetAccountName}" found in the Main Office!\n\nPlease go to Cash & Budget, click "+ Add" to create an account named "${targetAccountName}" for the Main Office, and try approving this again.`, 'error');
            return; 
        }

        // 4. Deposit the money!
        const targetAccDoc = accSnap.docs[0];
        const currentBalance = parseFloat(targetAccDoc.data().balance) || 0;
        const newBalance = currentBalance + amountToDeposit;
        
        await updateDoc(doc(db, "cash_accounts", targetAccDoc.id), { balance: newBalance });

        await addDoc(collection(db, "account_logs"), {
            accountId: targetAccDoc.id,
            accountName: targetAccountName,
            branch: "Main Office",
            action: "Remittance Received",
            amount: amountToDeposit,
            newBalance: newBalance,
            user: window.sessionUser ? window.sessionUser.cashierName : 'Owner',
            timestamp: serverTimestamp(),
            note: `Remitted by ${data.cashier || data.staffName} from ${data.branch}`
        });

        // 5. Finally, mark the remittance as safely Received
        await updateDoc(remitRef, { status: "Received" });

        Swal.fire('✅ Success!', `₱${amountToDeposit.toLocaleString()} has been officially deposited into your [${targetAccountName}] account.`, 'success');
        
        // Refresh the screens
        window.loadCashExplorer(); 
        if (typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();

        // 🔥 THE UI FIX: Refresh the Modal so the button disappears instantly!
        if (document.getElementById('branchTransferHistoryModal') && document.getElementById('branchTransferHistoryModal').style.display === 'flex') {
            window.openBranchTransferHistory(data.branch);
        }

    } catch (e) {
        console.error("Deposit Error:", e); 
        Swal.fire("Error", "Failed to approve and route the remittance.", "error");
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
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 20px;">Fetching Z-Readings...</td></tr>';

    let branchFilterEl = document.getElementById('zBranchFilter');
    let dateFilterEl = document.getElementById('zDateFilter');

    let selectedBranch = branchFilterEl ? branchFilterEl.value : "All";
    let selectedDate = dateFilterEl ? dateFilterEl.value : "";

    // 🔒 FRANCHISE HARD LOCK
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    if (isFranchisee) {
        selectedBranch = window.sessionUser.branch; // Force it to their branch
        if (branchFilterEl) {
            branchFilterEl.value = selectedBranch;
            branchFilterEl.disabled = true;
        }
    }

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
        allShifts.forEach((s, index) => {
            if (displayCount >= 50) return;
            if (selectedBranch !== "All" && s.branch !== selectedBranch) return;
            if (selectedDate && s.endTime) {
                let shiftDate = s.endTime.toDate().toISOString().split('T')[0];
                if (shiftDate !== selectedDate) return; 
            }

            displayCount++;
            let startStr = s.startTime ? s.startTime.toDate().toLocaleString() : 'N/A';
            let endStr = s.endTime ? s.endTime.toDate().toLocaleString() : 'N/A';
            let varColor = s.difference < 0 ? 'red' : (s.difference > 0 ? 'green' : '#333');
            
            let digitalTotal = s.totalDigitalSales || 0;
            let cSales = s.totalCashSales !== undefined ? s.totalCashSales : s.grossSales;
            let diffText = s.difference !== undefined ? `<span style="color:${varColor}; font-weight:bold;">₱${s.difference.toFixed(2)}</span>` : '-';
            
            // 🚨 PREVIOUS SHIFT FLOAT CHECKER 🚨
            let securityWarning = '';
            if (index < allShifts.length - 1) {
                let prevShift = allShifts[index + 1]; 
                if (s.branch === prevShift.branch) {
                    let startCash = parseFloat(s.startingCash) || 0;
                    let prevEndCash = parseFloat(prevShift.declaredCash) || parseFloat(prevShift.actualCash) || 0;
                    
                    if (Math.abs(startCash - prevEndCash) > 5) { 
                        securityWarning = `<br><span style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; display: inline-flex; align-items: center; gap: 4px; margin-top: 5px;" title="Previous shift closed with ₱${prevEndCash}. This shift started with ₱${startCash}.">⚠️ Float Mismatch</span>`;
                    } else {
                        securityWarning = `<br><span style="color: #16a34a; font-size: 10px; font-weight: bold; display: inline-block; margin-top: 5px;">✅ Float Verified</span>`;
                    }
                }
            }

            let breakdownStr = encodeURIComponent(JSON.stringify(s.cashBreakdown || {}));
            let stockStr = encodeURIComponent(JSON.stringify(s.physicalStockCount || {}));
            let safeCashier = s.cashier ? s.cashier.replace(/'/g, "\\'") : 'Unknown';
            let safeBranch = s.branch ? s.branch.replace(/'/g, "\\'") : 'Unknown';

            html += `<tr>
                <td style="font-weight:bold; color:var(--primary);">${s.id.slice(0,6).toUpperCase()}</td>
                <td><strong style="font-size: 14px;">${safeBranch}</strong><br><span style="font-size:11px; color:#666;">${safeCashier}</span>${securityWarning}</td>
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
window.viewZReadingDetails = async function (shiftId, breakdownStr, stockStr, cashierName, branchName, declaredCash, variance) {
  document.getElementById('breakdownModal').style.display = 'flex';
  document.getElementById('bdTitle').innerText = `Z-Reading: ${cashierName.toUpperCase()} (${branchName})`;
  
  document.getElementById('bdNetSalesTotal').innerText = "⏳ Loading...";
  document.getElementById('bdPaymentBreakdown').innerHTML = "Loading...";
  document.getElementById('bdOrderTypeBreakdown').innerHTML = "Loading...";

  let sTime, eTime; // We need these to fetch the Prep Logs!

  try {
      const shiftSnap = await getDoc(doc(db, "shifts", shiftId));
      if (shiftSnap.exists()) {
          sTime = shiftSnap.data().startTime.toDate();
          eTime = shiftSnap.data().endTime.toDate();

          const txQ = query(collection(db, "transactions"), 
              where("branch", "==", branchName), 
              where("timestamp", ">=", sTime), 
              where("timestamp", "<=", eTime)
          );
          const txSnap = await getDocs(txQ);

          let totalNet = 0; let payments = {}; let orderTypes = {};

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

          document.getElementById('bdNetSalesTotal').innerText = "₱" + totalNet.toLocaleString(undefined, {minimumFractionDigits: 2});

          let payHtml = '';
          for (let p in payments) {
              payHtml += `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed #cbd5e1; padding:4px 0;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0; font-size:13px; color:#334155;">
                        <input type="checkbox" class="pay-toggle-chk" value="${payments[p]}" checked onchange="window.recalcModalNetSales()" style="width:16px; height:16px; cursor:pointer;">
                        ${p}
                    </label>
                    <strong style="color:#0f766e;">₱${payments[p].toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
                </div>`;
          }
          document.getElementById('bdPaymentBreakdown').innerHTML = payHtml || "<i style='color:#94a3b8;'>No sales</i>";

          let typeHtml = '';
          for (let t in orderTypes) {
              typeHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #cbd5e1; padding:4px 0;"><span>${t}</span><strong style="color:#0f766e;">₱${orderTypes[t].toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>`;
          }
          document.getElementById('bdOrderTypeBreakdown').innerHTML = typeHtml || "<i style='color:#94a3b8;'>No sales</i>";
      }
  } catch(e) { console.error("Sales Math Error:", e); }

  let breakdown = JSON.parse(decodeURIComponent(breakdownStr));

  // 1. Build Cash Breakdown Grid (STRICT ORDER: 1000 -> 1)
  let cashHtml = '';
  const billOrder = ['₱1000', '₱500', '₱200', '₱100', '₱50', '₱20', '₱10', '₱5', '₱1'];
  
  billOrder.forEach(bill => {
      let qty = breakdown[bill];
      if (qty > 0) {
          let total = parseInt(bill.replace('₱', '')) * qty;
          cashHtml += `<div style="display: flex; justify-content: space-between; padding: 4px; border-bottom: 1px solid #f1f5f9;">
                          <span style="color: #64748b;">${bill} x <strong style="color:#000;">${qty} pcs</strong></span>
                          <span style="font-weight: bold;">₱${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                       </div>`;
      }
  });

  // Catch any unexpected denominations safely
  for (const [bill, qty] of Object.entries(breakdown)) {
      if (qty > 0 && !billOrder.includes(bill)) {
          let val = parseFloat(bill.replace('₱', '')) || 0;
          let total = val * qty;
          cashHtml += `<div style="display: flex; justify-content: space-between; padding: 4px; border-bottom: 1px solid #f1f5f9;">
                          <span style="color: #64748b;">${bill} x <strong style="color:#000;">${qty} pcs</strong></span>
                          <span style="font-weight: bold;">₱${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                       </div>`;
      }
  }

  // 2. Position the Alert beautifully next to the Declared Total
  let varianceAlert = '';
  if (variance < -0.05) {
      varianceAlert = `<span style="border: 2px dashed #ef4444; color: #b91c1c; padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 13px;">🚨 CASH SHORTAGE: -₱${Math.abs(variance).toFixed(2)}</span>`;
  } else if (variance > 0.05) {
      varianceAlert = `<span style="border: 2px dashed #f59e0b; color: #b45309; padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 13px;">📈 CASH OVERAGE DETECTED: +₱${variance.toFixed(2)}</span>`;
  }

  document.getElementById('bdCashContent').innerHTML = cashHtml || '<i style="color:#94a3b8; grid-column: span 2;">No cash breakdown logged.</i>';

  // Safely inject the variance alert into the total bar without deleting the other HTML!
  let bdTotalCashEl = document.getElementById('bdTotalCash');
  if (bdTotalCashEl) {
      bdTotalCashEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="flex-grow: 1; text-align: left;">${varianceAlert}</div>
            <div>Declared Total: ₱${parseFloat(declaredCash).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
        </div>
      `;
  }

  // 3. FETCH KITCHEN PREP LOGS FOR THIS EXACT SHIFT
  const tbody = document.getElementById('bdStockContent');
  if (!tbody) return; // Failsafe if the HTML isn't updated yet

  // Dynamically change the table headers via Javascript to avoid breaking the old HTML structure!
  let tableHeader = tbody.previousElementSibling.querySelector('tr');
  if (tableHeader) {
      tableHeader.innerHTML = `
          <th style="padding: 8px 5px; color:#475569;">Time</th>
          <th style="padding: 8px 5px; color:#475569;">Item Prepared</th>
          <th style="padding: 8px 5px; text-align:right; color:#475569;">Yield Added</th>
      `;
      // Change the title above the table
      let titleHeader = tbody.closest('div').querySelector('h3');
      if (titleHeader) titleHeader.innerHTML = '🔪 Kitchen Prep Logs (During Shift)';
  }

  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:15px; color: #888;">⏳ Fetching Kitchen Prep logs...</td></tr>';

  try {
      if (!sTime || !eTime) throw new Error("Missing shift times");

      const prepQ = query(collection(db, "stock_logs"), 
          where("branch", "==", branchName), 
          where("timestamp", ">=", sTime), 
          where("timestamp", "<=", eTime)
      );
      const prepSnap = await getDocs(prepQ);

      let prepLogs = [];
      prepSnap.forEach(doc => {
          let d = doc.data();
          if (d.type && (d.type.toLowerCase().includes("prep") || d.type.toLowerCase().includes("batch"))) {
              prepLogs.push(d);
          }
      });

      let prepHtml = '';
      if (prepLogs.length > 0) {
          prepLogs.sort((a,b) => b.timestamp - a.timestamp).forEach(log => {
              let t = log.timestamp.toDate().toLocaleTimeString('en-PH', {hour:'2-digit', minute:'2-digit'});
              prepHtml += `
                  <tr style="border-bottom: 1px solid #f8fafc;">
                      <td style="padding: 10px 5px; color: #64748b; font-size:12px;">${t}</td>
                      <td style="padding: 10px 5px; font-weight: bold; color: #334155;">${log.item}</td>
                      <td style="padding: 10px 5px; font-weight: bold; color: #16a34a; text-align:right;">+${log.variance} ${log.uom}</td>
                  </tr>
              `;
          });
      } else {
          prepHtml = '<tr><td colspan="3" style="text-align:center; padding:15px; color: #94a3b8; font-style:italic;">No kitchen prep logged during this shift.</td></tr>';
      }
      
      tbody.innerHTML = prepHtml;

  } catch (e) {
      console.error("Error fetching prep logs:", e);
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#dc2626; padding:15px;">Failed to fetch prep logs.</td></tr>';
  }
};

// ========================================================
// 🍟 ADD-ON & BOM MODIFIER ENGINE (MANAGER APP)
// ========================================================

// Keep a global memory of inventory items so the dropdowns load instantly
window.cachedInventoryOptions = '<option value="">-- Select Raw Ingredient --</option>';

// Call this once when the page loads, or when the modal opens
window.preloadInventoryForAddons = async function () {
  try {
    // 🔥 THE FIX: Strictly search Main Office to prevent duplicate branches from cluttering the list!
    const snap = await getDocs(query(collection(db, "inventory"), where("branch", "==", "Main Office")));
    let options = '<option value="">-- Select Raw Ingredient --</option>';
    
    let items = [];
    snap.forEach(docSnap => items.push(docSnap.data()));
    items.sort((a,b) => (a.name || "").localeCompare(b.name || ""));

    items.forEach(item => {
      let itemName = item.name || item.itemName || "Unknown Item";
      options += `<option value="${itemName}">${itemName} (Live Stock: ${item.currentStock || item.stock || 0})</option>`;
    });
    
    // 🔥 THE FIX: Save it to the global window object so Mix & Match can see it!
    window.cachedInventoryOptions = options;
    
    // Force the Mix & Match box to redraw now that we have the data
    if (typeof window.renderMixMatchConfig === 'function') {
        window.renderMixMatchConfig();
    }
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
// 📊 Z-READING & VARIANCE AUDIT DASHBOARD (SECURED)
// ========================================================
window.loadZReadingReports = async function () {
  const tbody = document.getElementById('zReadingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading audit reports from cloud...</td></tr>';

  let dateFilterEl = document.getElementById('zReadingDateFilter');
  let branchFilterEl = document.getElementById('zReadingBranchFilter');
  
  let dateFilter = dateFilterEl ? dateFilterEl.value : "";
  let branchFilter = branchFilterEl ? branchFilterEl.value : "All";

  // 🔒 FRANCHISE HARD LOCK
  let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
  if (isFranchisee) {
      branchFilter = window.sessionUser.branch; // Force it to their branch
      if (branchFilterEl) {
          branchFilterEl.value = branchFilter;
          branchFilterEl.disabled = true;
      }
  }

  try {
    // 🔒 Enforce branch filter at the database level!
    let q = query(collection(db, "shifts"), where("status", "==", "Closed"), orderBy("endTime", "desc"));
    if (branchFilter !== "All") {
        q = query(collection(db, "shifts"), where("branch", "==", branchFilter), where("status", "==", "Closed"), orderBy("endTime", "desc"));
    }
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
            <button onclick="viewZReadingDetails('${docSnap.id}', '${breakdownStr}', '${stockStr}', '${safeCashier}', '${safeBranch}', ${declared}, ${data.declaredCash - data.expectedCash})" class="btn-refresh" style="background: #0f172a; color: white; border: none; padding: 6px 12px; border-radius: 6px; width: 100%;">🔍 Full Audit</button>
            ${Math.abs(data.declaredCash - data.expectedCash) > 0.05 ? `<br><button onclick="alert('Notify the staff via your Group Chat to submit a Reason Letter in their POS.')" style="margin-top: 5px; background: white; color: #dc2626; border: 1px solid #fca5a5; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%;">✉️ Require Letter</button>` : ''}
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
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px;">⏳ Loading logs...</td></tr>';

    // 🔥 DYNAMICALLY INJECT THE "ACTION" HEADER SO IT MATCHES THE NEW BUTTONS
    let headerRow = tbody.previousElementSibling;
    if (headerRow && headerRow.tagName === 'THEAD') {
        headerRow = headerRow.querySelector('tr');
    }
    if (headerRow && headerRow.children.length === 5) {
        let th = document.createElement('th');
        th.style.cssText = "text-align: center; padding: 12px 15px; color: #475569; font-size: 12px; text-transform: uppercase;";
        th.innerText = "ACTION";
        headerRow.appendChild(th);
    }

    let dateFilter = document.getElementById('expenseDateFilter') ? document.getElementById('expenseDateFilter').value : "";
    
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
            let desc = data.description || data.note || data.category || 'Expense';
            
            totalExp += amount;
            countExp++;

            let dateStr = jsDate.toLocaleString('en-PH');
            
            // Protect strings with apostrophes (e.g. "Manager's Meal") so they don't break the Edit button!
            let safeDesc = desc.replace(/'/g, "\\'").replace(/"/g, '&quot;');

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 15px 20px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 15px 20px;"><span class="badge badge-open">${data.branch || 'Unknown'}</span></td>
                    <td style="padding: 15px 20px;"><strong>${data.cashier || 'System'}</strong></td>
                    <td style="padding: 15px 20px; color: #475569;">${desc}</td>
                    <td style="padding: 15px 20px; text-align: right; color: #dc2626; font-weight: bold; font-size: 15px;">₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 15px 20px; text-align: center;">
                        <div style="display: flex; gap: 5px; justify-content: center;">
                            <button onclick="window.editExpenseLog('${docSnap.id}', ${amount}, '${safeDesc}')" style="background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;">✏️ Edit</button>
                            <button onclick="window.deleteExpenseLog('${docSnap.id}')" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;">🗑️ Delete</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #64748b;">No expenses found for this date.</td></tr>';
        
        if(document.getElementById('expSumTotal')) document.getElementById('expSumTotal').innerText = `₱${totalExp.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        if(document.getElementById('expSumCount')) document.getElementById('expSumCount').innerText = countExp;

    } catch (error) {
        console.error("Expense Log Error:", error);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:red; padding: 40px;">Error loading logs. Check Developer Console.</td></tr>';
    }
};

// ==========================================
// ✏️ EXPENSE EDIT & DELETE ENGINE
// ==========================================
window.editExpenseLog = async function(docId, currentAmount, currentDesc) {
    const { value: formValues, isConfirmed } = await Swal.fire({
        title: '✏️ Edit Expense Log',
        html: `
            <div style="text-align: left; margin-top: 10px;">
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Description / Note:</label>
                <input type="text" id="swal-exp-desc" class="input-box" value="${currentDesc}" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 15px; outline: none; box-sizing: border-box; font-weight: bold;">
                
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Amount Taken (₱):</label>
                <input type="number" id="swal-exp-amt" class="input-box" value="${currentAmount}" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; box-sizing: border-box; font-weight: 900; color: #dc2626; font-size: 16px;">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Save Changes',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#0ea5e9',
        cancelButtonColor: '#94a3b8',
        customClass: { popup: 'rounded-2xl shadow-2xl' },
        preConfirm: () => {
            return {
                desc: document.getElementById('swal-exp-desc').value.trim(),
                amt: parseFloat(document.getElementById('swal-exp-amt').value)
            }
        }
    });

    if (isConfirmed && formValues) {
        if (isNaN(formValues.amt) || !formValues.desc) {
            return Swal.fire('Error', 'Invalid amount or description provided.', 'error');
        }
        
        try {
            Swal.fire({ title: 'Saving...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});
            
            // Update the document in Firebase
            await updateDoc(doc(db, "expenses", docId), {
                amount: formValues.amt,
                description: formValues.desc,
                note: formValues.desc // Save to both just in case older components use 'note'
            });
            
            Swal.fire({ title: '✅ Updated!', text: 'The expense record has been successfully adjusted.', icon: 'success', timer: 1500, showConfirmButton: false, customClass: { popup: 'rounded-2xl' } });
            
            window.loadExpenseLogs(); // Instantly refresh the table!
            
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Failed to update expense record. Check your connection.', 'error');
        }
    }
};

window.deleteExpenseLog = async function(docId) {
    if (!confirm("⚠️ URGENT WARNING:\n\nAre you sure you want to permanently delete this expense record?\nThis action cannot be undone and will affect your total profit calculations.")) return;
    
    try {
        await deleteDoc(doc(db, "expenses", docId));
        window.loadExpenseLogs(); // Instantly refresh the table!
    } catch (e) {
        console.error(e);
        alert("❌ Failed to delete the record. Please try again.");
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

    if (!dateFilter) {
        let today = new Date();
        today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
        dateFilter = today.toISOString().split('T')[0];
        if(document.getElementById('attendanceDateFilter')) document.getElementById('attendanceDateFilter').value = dateFilter;
    }

    let startOfDay = new Date(dateFilter + 'T00:00:00');
    let endOfDay = new Date(dateFilter + 'T23:59:59');

    try {
        const q = query(collection(db, "attendance_logs"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
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
            let isPM = t.includes('pm'); let isNN = t.includes('nn');
            let parts = t.replace(/(am|pm|nn)/, '').split(':');
            let hour = parseInt(parts[0]) || 0;
            let minute = parts.length > 1 ? parseInt(parts[1]) : 0;
            if ((isPM || isNN) && hour < 12) hour += 12;
            if (t.includes('am') && hour === 12) hour = 0;
            return hour + (minute / 60);
        };

        let logsArray = [];
        snap.forEach(docSnap => { logsArray.push({ id: docSnap.id, ...docSnap.data() }); });

        if (sortBy === 'name') {
            logsArray.sort((a, b) => {
                let nameA = a.staffName || ""; let nameB = b.staffName || "";
                if (nameA === nameB) return b.timestamp - a.timestamp;
                return nameA.localeCompare(nameB);
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
            let lateMinutes = 0;

            if (data.type === "TIME IN" && scheduleData && scheduleData.currentSchedule) {
                let logDay = logDate.getDate(); let logMonth = logDate.getMonth() + 1; let logYear = logDate.getFullYear();

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
                                        
                                        // "ranging about 1 hr advance and 1 hr late..." 
                                        if (diffHours > -1.5 && diffHours < 4) {
                                            lateMinutes = Math.floor(diffHours * 60);
                                            // STRICT PENALTY TRIGGER: 1 minute late = >0
                                            if (lateMinutes > 0) {
                                                if (data.lateExempted) {
                                                    lateTag = `<br><span style="background: #f0fdf4; color: #16a34a; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; display: inline-block; margin-top: 4px; box-shadow: 0 0 5px rgba(22, 163, 74, 0.5);">✅ Late Exempted</span>`;
                                                } else {
                                                    lateTag = `<br><span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; display: inline-block; margin-top: 4px; box-shadow: 0 0 5px rgba(239, 68, 68, 0.5);">⏰ LATE (${lateMinutes} mins)</span>`;
                                                }
                                            }
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

            // 🔥 PENALTY BUTTON LOGIC
            let currentPenalty = parseFloat(data.penaltyAmount) || 0;
            let penaltyText = currentPenalty > 0 ? `-₱${currentPenalty}` : `💸 Penalty`;
            let penaltyStyle = currentPenalty > 0 ? `background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;` : `background: #fffbeb; color: #d97706; border: 1px solid #fcd34d;`;

            // The Action Buttons!
            let actionHtml = `
                <div style="display: flex; gap: 5px; justify-content: center; flex-wrap: wrap;">
                    <button onclick="window.viewSelfie('${data.photoBase64}', '${data.staffName} - ${data.type}')" style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="View Selfie">📷</button>
                    <button onclick="window.applyAttendancePenalty('${data.id}', '${data.staffName}', '${timeStr}', ${currentPenalty})" style="${penaltyStyle} padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;" title="Apply Late/Undertime Penalty">${penaltyText}</button>
                    <button onclick="window.deleteAttendanceLog('${data.id}', '${data.staffName}')" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="Delete Log">🗑️</button>
            `;
            
            // 🔥 THE FIX: Inject the EXEMPT button if they are officially late and not yet exempted!
            if (lateMinutes > 0 && !data.lateExempted && data.type === "TIME IN") {
                // Made the exempt button blue so it doesn't clash with the yellow/red penalty button
                actionHtml += `<button onclick="window.exemptLatePunch('${data.id}', '${data.staffName}')" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #2563eb; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; width: 100%; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" title="Exempt Late Penalty">⭐ Exempt Late</button>`;
            }
            actionHtml += `</div>`;

            if (data.isManual) {
                locationText = `📍 ${data.branch} <br><span style="color:#d97706; font-size:11px; font-weight:bold;">⚠️ Manual Edit: ${data.remarks}</span>`;
                actionHtml = `
                <div style="display: flex; gap: 5px; justify-content: center; align-items: center; flex-wrap: wrap;">
                    <span style="font-size: 10px; color: #64748b; font-weight: bold; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px dashed #cbd5e1;">Manual</span>
                    <button onclick="window.applyAttendancePenalty('${data.id}', '${data.staffName}', '${timeStr}', ${currentPenalty})" style="${penaltyStyle} padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;" title="Apply Late/Undertime Penalty">${penaltyText}</button>
                    <button onclick="window.deleteAttendanceLog('${data.id}', '${data.staffName}')" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 14px;" title="Delete Log">🗑️</button>
                </div>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; font-size: 13px; color: #64748b;">${timeStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #334155; vertical-align: middle;">${data.staffName} ${lateTag}</td>
                    <td style="padding: 12px; color: #64748b; vertical-align: middle;">${locationText}</td>
                    <td style="padding: 12px; vertical-align: middle;">
                        <span style="background: ${badgeColor}; color: ${textColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${data.type}</span>
                    </td>
                    <td style="padding: 12px; text-align: center; vertical-align: middle;">${actionHtml}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No logs found for this date.</td></tr>';
    } catch (error) {
        console.error("Error loading attendance:", error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error processing feed. Check Console.</td></tr>';
    }
};

window.exemptLatePunch = async function(docId, staffName) {
    if (!confirm(`Are you sure you want to EXEMPT ${staffName} from this late penalty?\n\nThe system will not deduct this from their next payslip.`)) return;
    try {
        await updateDoc(doc(db, "attendance_logs", docId), { lateExempted: true });
        window.loadAttendanceLogs(); 
        alert(`✅ ${staffName} is exempted! Generate the Payroll list again to apply the changes.`);
    } catch (e) {
        console.error(e);
        alert("Failed to exempt late penalty.");
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
        
        // 🔥 THE FAILSAFE: Always grab today's actual date as a backup!
        const today = new Date();
        let safeYear = today.getFullYear();
        let safeMonth = today.getMonth() + 1;

        if (snap.exists()) {
            const appData = snap.data();
            branchConfig = appData.branchConfig || JSON.parse(JSON.stringify(defaultSchedConfig));
            employees = appData.employees || [];
            unavailability = appData.unavailability || {};
            currentSchedule = appData.currentSchedule || {};
            
            // If the cloud has a date, use it. Otherwise, use the failsafe!
            currentYear = appData.currentYear || safeYear;
            currentMonth = appData.currentMonth || safeMonth;
            
            window.scheduleHolidays = appData.holidays || {}; 
        } else {
            // First time loading the app? Use the failsafe!
            currentYear = safeYear;
            currentMonth = safeMonth;
        }

        // Lock the date into the HTML Date Picker
        const mm = String(currentMonth).padStart(2, '0');
        const monthInput = document.getElementById("monthSelector");
        if (monthInput) monthInput.value = `${currentYear}-${mm}`;

        // Render the screen!
        window.renderConfigUI(); 
        window.updateStaffDisplay(); 
        window.updateAvailDropdown(); 
        window.updateUnavailabilityList(); 
        window.updateHolidayList(); 
        window.renderTables();
        
    } catch(e) { 
        console.error("Cloud Load Error:", e); 
    }
};

// 🔥 AUTO-BOOT ENGINE: Quietly loads the schedule data in the background as soon as the app turns on!
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { 
        if (typeof window.loadFromCloud === 'function') window.loadFromCloud(); 
    }, 2500); 
});

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
// 📥 UNIVERSAL EXCEL EXPORTER (WITH BULLETPROOF INTERCEPTOR)
// ========================================================
window.downloadExcel = async function(tbodyId, fileName) {
    let tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    
    let table = tbody.closest('table');
    if (!table) return;
    
    let headers = Array.from(table.querySelectorAll('th, td')).map(cell => cell.innerText.trim().toUpperCase());
    
    // 🔥 THE BULLETPROOF INTERCEPTOR: Checks if the table contains 'OR#' or if it's the Sales History table!
    if (headers.includes('OR#') || headers.includes('OR #') || tbodyId.toLowerCase().includes('history') || tbodyId.toLowerCase().includes('transaction')) {
        let btn = document.activeElement; 
        let oldText = btn && btn.tagName === 'BUTTON' ? btn.innerText : "Export Active Tab";
        if (btn && btn.tagName === 'BUTTON') { btn.innerText = "⏳ Fetching Items..."; btn.disabled = true; }

        try {
            // 1. Grab the exact Date Filters from the Sales History Page
            let startInput = document.getElementById('histStartDate') || document.querySelectorAll('input[type="date"]')[0];
            let endInput = document.getElementById('histEndDate') || document.querySelectorAll('input[type="date"]')[1];
            let branchSelect = document.getElementById('histBranchFilter') || document.querySelector('select');

            let startDateVal = startInput ? startInput.value : new Date().toISOString().split('T')[0];
            let endDateVal = endInput ? endInput.value : new Date().toISOString().split('T')[0];
            
            let branch = 'All';
            if (branchSelect) {
                branch = branchSelect.value;
                if (branch.includes("All")) branch = "All";
            }

            let startOfDay = new Date(startDateVal);
            startOfDay.setHours(0, 0, 0, 0);
            let endOfDay = new Date(endDateVal);
            endOfDay.setHours(23, 59, 59, 999);

            // 2. Fetch directly from Firebase to get the hidden Cart Items
            let q;
            if (branch === "All") {
                q = window.query(window.collection(window.db, "transactions"), window.where("timestamp", ">=", startOfDay), window.where("timestamp", "<=", endOfDay), window.orderBy("timestamp", "desc"));
            } else {
                q = window.query(window.collection(window.db, "transactions"), window.where("branch", "==", branch), window.where("timestamp", ">=", startOfDay), window.where("timestamp", "<=", endOfDay), window.orderBy("timestamp", "desc"));
            }

            const snap = await window.getDocs(q);

            if (snap.empty) {
                Swal.fire('No Data', 'No transactions found for this date range.', 'info');
                if (btn && btn.tagName === 'BUTTON') { btn.innerText = oldText; btn.disabled = false; }
                return;
            }

            // 3. Build CSV Header with 'Items Sold' included!
            let csv = "OR#,Branch,Cashier,Customer,Items Sold,Gross Amount,Discount,Net Amount,Payment Method,Status,Date,Time\n";

            snap.forEach(docSnap => {
                let tx = docSnap.data();
                let d = tx.timestamp ? (tx.timestamp.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp)) : new Date();
                let dateStr = d.toLocaleDateString('en-PH');
                let timeStr = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

                // 🍔 Extract the Cart Items and Add-ons cleanly!
                let itemsArr = [];
                if (tx.cart && Array.isArray(tx.cart)) {
                    tx.cart.forEach(item => {
                        let itemName = item.name || item.itemName;
                        let itemLine = `${item.qty}x ${itemName}`;
                        if (item.addons) {
                            for (let key in item.addons) {
                                if (item.addons[key].qty > 0) itemLine += ` (+${item.addons[key].qty} ${key})`;
                            }
                        }
                        itemsArr.push(itemLine);
                    });
                }
                let itemsJoined = itemsArr.join(" | ").replace(/"/g, '""');

                let gross = (tx.subTotalBeforeDiscount || tx.netTotal || 0).toFixed(2);
                let disc = (tx.globalDiscountAmount || 0).toFixed(2);
                let net = (tx.netTotal || 0).toFixed(2);
                let customer = (tx.customerName || 'Guest').replace(/"/g, '""');
                let cashier = (tx.cashier || 'Unknown').replace(/"/g, '""');
                
                // Format Split Payments properly if they exist
                let method = tx.paymentMethod || 'Cash';
                if (tx.splitDetails && Array.isArray(tx.splitDetails)) {
                    method = tx.splitDetails.map(s => `${s.method}`).join(' & ');
                }
                method = method.replace(/"/g, '""');
                
                let status = (tx.status || 'Paid').replace(/"/g, '""');

                // We add the Peso sign ₱ here so it formats beautifully as money in Excel!
                csv += `"${tx.receiptId || 'N/A'}","${tx.branch}","${cashier}","${customer}","${itemsJoined}","₱${gross}","₱${disc}","₱${net}","${method}","${status}","${dateStr}","${timeStr}"\n`;
            });

            // 4. Force UTF-8 encoding for Excel
            let csvFile = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
            let downloadLink = document.createElement("a");
            let safeBranchName = branch.replace(/[^a-zA-Z0-9]/g, '_');
            downloadLink.download = `Takodeal_${safeBranchName}_Transactions_${startDateVal}_to_${endDateVal}.csv`;
            downloadLink.href = window.URL.createObjectURL(csvFile);
            downloadLink.style.display = "none";
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

        } catch (error) {
            console.error("Export Error:", error);
            Swal.fire('Error', 'Failed to generate CSV. Please check your internet connection.', 'error');
        } finally {
            if (btn && btn.tagName === 'BUTTON') { btn.innerText = oldText; btn.disabled = false; }
        }
        
        return; // 🛑 CRITICAL: Stop here so it doesn't run the basic screen scraper!
    }

    // ==========================================
    // 📺 STANDARD SCREEN SCRAPER (For 'Daily Sales', 'Shifts Sales', etc)
    // ==========================================
    let rows = table.querySelectorAll('tr');
    let csv = [];
    let hideLastColExcel = false;

    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll('td, th');
        let colCount = cols.length;
        
        // 🔥 REMOVE THE ACTION COLUMN SO BUTTONS DON'T SHOW UP IN EXCEL!
        let lastColText = cols[colCount - 1] ? cols[colCount - 1].innerText.trim().toUpperCase() : '';
        if (i === 0 && (lastColText === 'ACTION' || lastColText === 'VIEW')) {
            hideLastColExcel = true;
        }

        if (hideLastColExcel) colCount -= 1; 

        for (let j = 0; j < colCount; j++) {
            let text = cols[j].innerText.replace(/"/g, '""').replace(/₱/g, '₱'); 
            row.push('"' + text + '"'); 
        }
        csv.push(row.join(","));
    }

    let csvFile = new Blob(["\uFEFF" + csv.join("\n")], {type: "text/csv;charset=utf-8;"});
    let tempLink = document.createElement("a");
    let dateTag = new Date().toISOString().split('T')[0];
    
    tempLink.download = `${fileName}_${dateTag}.csv`;
    tempLink.href = window.URL.createObjectURL(csvFile);
    tempLink.style.display = "none";
    document.body.appendChild(tempLink); tempLink.click(); document.body.removeChild(tempLink);
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
        // 🛡️ INBOX SECURITY WALL
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
        let q = query(collection(db, "staff_requests"), orderBy("timestamp", "desc"));
        
        if (isFranchisee && window.sessionUser.branch) {
            // Franchisees only download requests from their own staff
            q = query(collection(db, "staff_requests"), where("branch", "==", window.sessionUser.branch), orderBy("timestamp", "desc"));
        }
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

// ========================================================
// 📩 UPGRADED STAFF REQUEST HUB (WITH LEDGER INTEGRATION)
// ========================================================
window.handleRequest = function(docId, action, type, amount, staffName) {
    const isReasonLetter = type === "Reason Letter" || type === "Cash Shortage / Mishandling";

    const modalHtml = `
        <div id="dynamicReplyModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 9999;">
            <div style="background: white; padding: 25px; border-radius: 12px; width: 450px; max-width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #0f172a;">${action === 'Approved' ? '✅ Approve' : '❌ Reject'} Request</h3>
                <p style="font-size: 13px; color: #64748b; margin-bottom: 15px;">Send a message to <strong>${staffName}</strong> regarding this ${type}.</p>

                <label style="font-size: 12px; font-weight: bold; color: #334155;">Manager Reply / Reason:</label>
                <textarea id="replyMessage" placeholder="Type your explanation or instructions here..." style="width: 100%; height: 80px; padding: 10px; margin-top: 5px; margin-bottom: 15px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-family: inherit; resize: none;"></textarea>

                ${action === 'Approved' ? `
                <label style="font-size: 12px; font-weight: bold; color: #334155;">Proof of Payment (Screenshot):</label>
                <input type="file" id="replyProofImage" accept="image/jpeg, image/png, image/webp" style="width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 20px; border: 1px dashed #cbd5e1; border-radius: 6px; box-sizing: border-box;">
                ` : ''}

                <!-- 🔥 THE SHORTAGE PENALTY PIPELINE 🔥 -->
                ${isReasonLetter ? `
                <div style="background: #fff1f2; border: 1px dashed #fca5a5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <label style="font-size: 12px; font-weight: bold; color: #b91c1c; display: block; margin-bottom: 5px;">⚠️ Convert Shortage to Salary Deduction (₱)</label>
                    <div style="font-size: 11px; color: #ef4444; margin-bottom: 8px;">If you want to charge the missing cash to their payroll, enter the amount below.</div>
                    <input type="number" id="replyPenaltyAmt" placeholder="e.g. 150.00" style="width: 100%; padding: 10px; border: 1px solid #fca5a5; border-radius: 6px; box-sizing: border-box; font-weight: bold; color: #dc2626; outline: none;">
                </div>
                ` : ''}

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
                    <button onclick="document.getElementById('dynamicReplyModal').remove()" style="padding: 10px 15px; border: none; background: #e2e8f0; color: #475569; border-radius: 6px; cursor: pointer; font-weight: bold;">Cancel</button>
                    <button id="btnSubmitReply" onclick="window.submitRequestReply('${docId}', '${action}', '${type}', ${amount}, '${staffName}')" style="padding: 10px 15px; border: none; background: ${action === 'Approved' ? '#10b981' : '#ef4444'}; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">Confirm ${action}</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.submitRequestReply = async function(docId, action, type, amount, staffName) {
    const btn = document.getElementById('btnSubmitReply');
    const replyMsg = document.getElementById('replyMessage').value.trim();
    const fileInput = document.getElementById('replyProofImage');
    const penaltyInput = document.getElementById('replyPenaltyAmt');
    const penaltyAmt = penaltyInput ? parseFloat(penaltyInput.value) || 0 : 0;

    btn.innerText = "⏳ Processing...";
    btn.disabled = true;

    try {
        let proofUrl = "";

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

        await updateDoc(doc(db, "staff_requests", docId), {
            status: action,
            managerReply: replyMsg,
            proofImageUrl: proofUrl,
            processedAt: new Date(),
            processedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            penaltyCharged: penaltyAmt
        });

        // 🗑️ INVENTORY DEDUCTION (WASTE APPROVALS)
        if (action === "Approved" && type === "Waste Report") {
            const reqSnap = await getDoc(doc(db, "staff_requests", docId));
            if (reqSnap.exists() && reqSnap.data().items) {
                let reqData = reqSnap.data();
                
                // Process each wasted item
                for (let item of reqData.items) {
                    if (!item.id) continue;
                    const invRef = doc(db, "inventory", item.id);
                    const invSnap = await getDoc(invRef);
                    
                    if (invSnap.exists()) {
                        let currentStock = parseFloat(invSnap.data().currentStock) || 0;
                        let newStock = currentStock - item.qty;
                        
                        await updateDoc(invRef, { currentStock: newStock });
                        
                        await addDoc(collection(db, "stock_logs"), {
                            branch: reqData.branch, item: item.name, uom: item.uom,
                            oldQty: currentStock, newQty: newStock, variance: -item.qty,
                            type: "Waste / Spoilage (HQ Approved)", note: `Reason: ${item.reason} | Appv. by: ${window.sessionUser ? window.sessionUser.cashierName : 'HQ'}`,
                            user: reqData.staffName, timestamp: serverTimestamp()
                        });
                    }
                }
            }
        }
      
        // STANDARD DEDUCTIONS (Advances & Meals)
        if (action === "Approved" && (type === "Cash Advance" || type === "Staff Meal")) {
            await addDoc(collection(db, "staff_deductions"), {
                staffName: staffName,
                type: type,
                amount: amount,
                dateAdded: new Date(),
                status: "Unpaid" 
            });
        }

        // 🔥 THE NEW PENALTY/SHORTAGE LEDGER ROUTER 🔥
        if (penaltyAmt > 0) {
            await addDoc(collection(db, "staff_deductions"), {
                staffName: staffName,
                type: "Cash/Stock Shortage Penalty",
                amount: penaltyAmt,
                dateAdded: new Date(),
                status: "Unpaid",
                remarks: `Linked to Reason Letter (${action}): ${replyMsg}`
            });
        }

        Swal.fire({
            title: `✅ Request ${action}`, 
            text: penaltyAmt > 0 ? `Message sent and ₱${penaltyAmt} was added to ${staffName}'s deductions ledger.` : 'Message successfully sent to cashier.', 
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });

        document.getElementById('dynamicReplyModal').remove();
        window.loadInbox();
        if (typeof window.loadLedger === 'function') window.loadLedger();

    } catch (e) {
        console.error("Action Error:", e);
        Swal.fire('Error', 'Failed to process request. Check connection.', 'error');
        btn.innerText = `Confirm ${action}`;
        btn.disabled = false;
    }
};

// ========================================================
// 🕵️‍♂️ FORENSIC ITEM TRACE ENGINE
// ========================================================
window.openForecasterItemTrace = async function(itemName, branch) {
    document.getElementById('forecasterDetailsModal').style.display = 'flex';
    document.getElementById('forensicModalSubtitle').innerText = `${itemName} | ${branch}`;
    
    let tbody = document.getElementById('forecasterDetailsBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 30px; font-weight: bold; color: #64748b;">⏳ Compiling forensic database logs...</td></tr>';

    try {
        // Look back 30 days maximum to keep performance fast
        let pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 30);

        const q = query(collection(db, "stock_logs"), where("branch", "==", branch), where("item", "==", itemName), where("timestamp", ">=", pastDate));
        const snap = await getDocs(q);

        let logs = [];
        let tRestock = 0; let tSales = 0; let tWaste = 0; let tAudit = 0;

        snap.forEach(doc => {
            let d = doc.data();
            logs.push(d);
            
            let variance = parseFloat(d.variance) || 0;
            let type = d.type.toLowerCase();

            if (variance > 0 && (type.includes("restock") || type.includes("delivery") || type.includes("received"))) {
                tRestock += variance;
            } else if (variance < 0 && type.includes("sales")) {
                tSales += Math.abs(variance);
            } else if (variance < 0 && (type.includes("waste") || type.includes("spoilage"))) {
                tWaste += Math.abs(variance);
            } else if (type.includes("audit") || type.includes("adjustment") || type.includes("penalty")) {
                tAudit += variance; // Audits can be positive or negative
            }
        });

        // Update the 4 top boxes
        document.getElementById('fcTotalRestock').innerText = tRestock.toFixed(1);
        document.getElementById('fcTotalSales').innerText = tSales.toFixed(1);
        document.getElementById('fcTotalWaste').innerText = tWaste.toFixed(1);
        
        let tAuditEl = document.getElementById('fcTotalDiscrepancy');
        tAuditEl.innerText = tAudit > 0 ? `+${tAudit.toFixed(1)}` : tAudit.toFixed(1);
        tAuditEl.style.color = tAudit < 0 ? '#dc2626' : (tAudit > 0 ? '#16a34a' : '#d97706');

        // Sort dynamically (newest first)
        logs.sort((a,b) => {
            let tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime()) : 0;
            let tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime()) : 0;
            return tB - tA;
        });

        let html = '';
        logs.forEach(d => {
            let dateStr = d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate().toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : new Date(d.timestamp).toLocaleString()) : 'Unknown';
            let variance = parseFloat(d.variance) || 0;
            let varColor = variance > 0 ? '#16a34a' : (variance < 0 ? '#dc2626' : '#64748b');
            let varText = variance > 0 ? `+${variance}` : variance;
            
            // Format type badges cleanly
            let typeColor = '#f1f5f9'; let typeTextColor = '#475569';
            if (d.type.toLowerCase().includes("sales")) { typeColor = '#e0f2fe'; typeTextColor = '#0369a1'; }
            if (d.type.toLowerCase().includes("waste")) { typeColor = '#fee2e2'; typeTextColor = '#b91c1c'; }
            if (d.type.toLowerCase().includes("restock") || d.type.toLowerCase().includes("delivery")) { typeColor = '#dcfce7'; typeTextColor = '#15803d'; }
            if (d.type.toLowerCase().includes("audit")) { typeColor = '#fef3c7'; typeTextColor = '#b45309'; }

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: white; transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                    <td style="padding: 12px 10px; font-size: 11px; color: #64748b; white-space: nowrap;">${dateStr}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #334155;">👤 ${d.user || 'System'}</td>
                    <td style="padding: 12px 10px;"><span style="background: ${typeColor}; color: ${typeTextColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">${d.type}</span></td>
                    <td style="padding: 12px 10px; text-align: right; font-weight: 900; color: ${varColor}; font-size: 15px;">${varText}</td>
                    <td style="padding: 12px 10px; padding-left: 20px; font-size: 12px; color: #475569; font-style: italic; max-width: 250px; white-space: normal;">${d.note || '-'}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #94a3b8;">No activity logged for this item in the last 30 days.</td></tr>';

    } catch (e) {
        console.error("Forensic Trace Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 30px; color: #dc2626; font-weight: bold;">Failed to extract forensic data.</td></tr>';
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
// 💸 AUTO-PAYSLIP GENERATOR ENGINE (WITH NIGHT SHIFT PENALTY SYNC)
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
        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        const shiftSnap = await getDocs(query(collection(db, "shifts"), where("startTime", ">=", startTimestamp), where("startTime", "<=", endTimestamp)));
        const deductSnap = await getDocs(query(collection(db, "staff_deductions"), where("status", "==", "Unpaid")));
        
        // 🔥 THE FIX: Fetch Attendance Logs purely to grab the penalties!
        const attSnap = await getDocs(query(collection(db, "attendance_logs"), where("timestamp", ">=", startTimestamp), where("timestamp", "<=", endTimestamp)));
        
        let staffDict = {};
        staffSnap.forEach(docSnap => { staffDict[docSnap.data().cashierName] = docSnap.data(); });
        
        let ledgerDict = {};
        ledgerSnap.forEach(docSnap => { ledgerDict[docSnap.data().staffName] = { id: docSnap.id, ...docSnap.data() }; });

        let payrollData = {};

        // 1. Base Shifts (Night Shift Safe!)
        shiftSnap.forEach(docSnap => {
            let shift = docSnap.data();
            if (!shift.endTime) return; 
            let name = shift.cashier;
            
            if (!payrollData[name]) {
                payrollData[name] = { branch: shift.branch, hours: 0, deductions: 0, advances: 0, meals: 0, latePenalty: 0, logs: [], start: startDateRaw, end: endDateRaw, profile: staffDict[name] || {} };
            }

            let diffMs = shift.endTime.toDate() - shift.startTime.toDate();
            let hrs = diffMs / (1000 * 60 * 60);
            payrollData[name].hours += hrs;

            let sDate = shift.startTime.toDate();
            let eDate = shift.endTime.toDate();
            payrollData[name].logs.push({
                dateObj: sDate,
                endDateObj: eDate, // Needed for Night Shift matching
                date: sDate.toLocaleDateString('en-US', {month:'short', day:'numeric'}),
                in: sDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                out: eDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
                hrs: hrs.toFixed(2),
                remark: hrs >= 8 ? '<span style="color:#16a34a;">Complete</span>' : `<span style="color:#dc2626;">Short (${hrs.toFixed(1)}h)</span>`
            });
        });

        // 2. 🔥 AGGREGATE PENALTIES & ATTACH TO SHIFTS
        attSnap.forEach(docSnap => {
            let log = docSnap.data();
            let name = log.staffName;
            if (!name || !payrollData[name]) return;
            
            let penalty = parseFloat(log.penaltyAmount) || 0;
            if (penalty > 0) {
                // Add to the main money totals
                payrollData[name].latePenalty += penalty;
                payrollData[name].deductions += penalty; 
                
                if (log.timestamp) {
                    let logTimeMs = log.timestamp.toDate().getTime();
                    
                    // SMART MATCHER: Check if the penalty punch falls within 4 hours of the shift boundaries
                    // This perfectly links 12 AM punches back to the 6 PM shift!
                    let targetShift = payrollData[name].logs.find(s => {
                        let sMs = s.dateObj.getTime();
                        let eMs = s.endDateObj.getTime();
                        return logTimeMs >= (sMs - 14400000) && logTimeMs <= (eMs + 14400000);
                    });

                    if (targetShift) {
                        targetShift.remark += `<br><span style="color:#b91c1c; font-size:10px; font-weight:900;">-₱${penalty.toFixed(2)} Penalty</span>`;
                    }
                }
            }
        });

        // 3. Vales & Meals
        deductSnap.forEach(docSnap => {
            let deduct = docSnap.data();
            let name = deduct.staffName;
            if (!payrollData[name]) return; 

            let dDate = deduct.dateAdded ? deduct.dateAdded.toDate() : new Date();
            if (dDate > endTimestamp) return;

            let amt = parseFloat(deduct.amount) || 0;
            if (deduct.type === "Cash Advance") payrollData[name].advances += amt;
            else if (deduct.type === "Staff Meal") payrollData[name].meals += amt;
            
            payrollData[name].deductions += amt;
        });

        // 4. Finalize UI
        window.globalPayrollCache = payrollData;
        let html = '';
        let sortedNames = Object.keys(payrollData).sort((a,b) => a.localeCompare(b));
        
        for (let name of sortedNames) {
            let data = payrollData[name];
            data.name = name; 
            data.logs.sort((a,b) => a.dateObj - b.dateObj);

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
            data.rate = staffDict[name] ? (staffDict[name].hourlyRate || 0) : 0;

            html += `
                <tr>
                    <td><strong>👤 ${name}</strong></td>
                    <td><span class="badge badge-closed">${data.branch}</span></td>
                    <td><strong style="color: var(--primary);">${data.hours.toFixed(2)} hrs</strong></td>
                    <td style="color: var(--danger); font-weight: bold;">₱${data.deductions.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td>
                        <button class="btn-refresh" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer;" onclick="window.openPayslipModal('${name.replace(/'/g, "\\'")}')">🧾 Generate Payslip</button>
                    </td>
                </tr>
            `;
        }

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 30px; color: var(--success); font-weight: bold;">No shifts found for this cutoff period.</td></tr>';

    } catch (e) {
        console.error("Payroll Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: red;">Error generating payroll. Check console.</td></tr>';
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

    // 🔥 THE FIX: Universal setter for both Inputs and Text elements
    const safeSet = (id, val) => { 
        let el = document.getElementById(id); 
        if (!el) return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val;
        else el.innerText = val;
    };

    safeSet('psName', data.name || "Unknown");
    safeSet('psBranch', data.branch || "Unassigned");
    safeSet('psStart', data.start || "");
    safeSet('psEnd', data.end || "");
    
    let safeBasicPay = parseFloat(data.basicPay) || 0;
    safeSet('psBasicPay', safeBasicPay.toLocaleString(undefined, {minimumFractionDigits: 2}));
    
    safeSet('psDaysWorked', data.shiftsWorked || 0);
    safeSet('psDateHired', (data.profile && data.profile.dateHired) ? data.profile.dateHired : "---");
    
    // 🔥 THE DATE FIX: Automatically inject today's date into the Pay Distributed field
    let today = new Date();
    let formattedDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    safeSet('psPayDistributed', formattedDate);

    safeSet('psOvertime', data.nightBonus || 0);
    safeSet('psStraightBonus', data.straightBonus || 0); 
    safeSet('psHoliday', data.holidayPayTotal || 0);
    
    safeSet('psLate', data.lateDeduction || 0); 
    safeSet('psSSS', data.sss || 0);
    safeSet('psPhil', data.philhealth || 0);
    safeSet('psPagibig', data.pagibig || 0);
    safeSet('psAdvance', data.advances || 0);
    safeSet('psLoans', data.loans || 0);
    safeSet('psFoods', data.meals || 0);
    
    let dynamicArea = document.getElementById('psDynamicDeductionsArea');
    if (dynamicArea) {
        let customHtml = '';
        if (data.profile && data.profile.customDeductions && data.profile.customDeductions.length > 0) {
            data.profile.customDeductions.forEach((cd, idx) => {
                let amt = parseFloat(cd.amount) || 0;
                customHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 8px; font-size: 13px;">
                        <span>${cd.name}</span> 
                        <input type="number" id="psCustomDed_${idx}" class="ps-input ps-dynamic-deduction" value="${amt.toFixed(2)}" oninput="window.recalcPayslip()">
                    </div>
                `;
            });
        }
        dynamicArea.innerHTML = customHtml;
    }

    let attHtml = '';
    if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
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
    // 🔥 SMART EXTRACTOR: Grabs numbers perfectly from Text OR Inputs
    const getVal = (id) => { 
        let el = document.getElementById(id); 
        if (!el) return 0;
        let val = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value : el.innerText;
        return parseFloat(val.toString().replace(/,/g, '')) || 0;
    };

    const safeSetText = (id, val) => { let el = document.getElementById(id); if (el) el.innerText = val; };

    let basic = getVal('psBasicPay');
    let overtime = getVal('psOvertime');
    let straightBonus = getVal('psStraightBonus'); 
    let holiday = getVal('psHoliday');
    
    let late = getVal('psLate');
    let sss = getVal('psSSS');
    let phil = getVal('psPhil');
    let pagibig = getVal('psPagibig');
    let advance = getVal('psAdvance');
    let loans = getVal('psLoans');
    let foods = getVal('psFoods');
    
    let customDeductionsSum = 0;
    document.querySelectorAll('.ps-dynamic-deduction').forEach(inp => {
        customDeductionsSum += (parseFloat(inp.value) || 0);
    });

    let gross = basic + overtime + straightBonus + holiday; 
    let deductions = late + sss + phil + pagibig + advance + loans + foods + customDeductionsSum;
    let net = gross - deductions;

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
    
    let netPayStr = document.getElementById('psNetPay').innerText.replace(/,/g, '');
    let finalNetPay = parseFloat(netPayStr) || 0;

    // 🔥 THE MEAL/VALE EXTRACTOR FIX: Correctly reads the text numbers from the HTML
    const getFieldVal = (id) => {
        let el = document.getElementById(id);
        if (!el) return 0;
        let val = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value : el.innerText;
        return parseFloat(val.toString().replace(/,/g, '')) || 0;
    };

    let actualLoanDeducted = getFieldVal('psLoans');
    let actualValeDeducted = getFieldVal('psAdvance');
    let actualFoodDeducted = getFieldVal('psFoods');

    if (!window.liveAccounts || window.liveAccounts.length === 0) {
        if(typeof window.loadAccountsAndBudget === 'function') await window.loadAccountsAndBudget();
    }

    let optionsHtml = '';
    window.liveAccounts.forEach((a, i) => {
        optionsHtml += `<option value="${i}">${a.name} (Bal: ₱${a.balance.toLocaleString(undefined, {minimumFractionDigits: 2})})</option>`;
    });

    const { value: accIdx, isConfirmed } = await Swal.fire({
        title: '💸 Disburse Payroll',
        html: `
            <div style="font-size: 15px; color: #475569; margin-bottom: 20px;">
                Net Pay to Disburse: <br>
                <strong style="color: #16a34a; font-size: 28px;">₱${finalNetPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
            </div>
            <div style="text-align: left;">
                <label style="font-size: 12px; font-weight: bold; color: #334155; display: block; margin-bottom: 8px;">Select Account to Deduct From:</label>
                <select id="swal-acc-select" class="input-box" style="width: 100%; padding: 12px; font-size: 14px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; cursor: pointer; box-sizing: border-box;">
                    <option value="">-- Choose Account --</option>
                    ${optionsHtml}
                </select>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Confirm Payment',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#94a3b8',
        customClass: { popup: 'rounded-2xl shadow-2xl border border-gray-100' },
        preConfirm: () => {
            const val = document.getElementById('swal-acc-select').value;
            if (!val) { Swal.showValidationMessage('❌ Please select an account to deduct from.'); }
            return val;
        }
    });

    if (!isConfirmed || !accIdx) return; 

    let selAcc = window.liveAccounts[parseInt(accIdx)];
    if (!selAcc) { 
        Swal.fire('Error', 'Invalid account selected.', 'error');
        return; 
    }

    if (selAcc.balance < finalNetPay) {
        const confirmNegative = await Swal.fire({
            title: '⚠️ Insufficient Funds',
            html: `${selAcc.name} only has <strong>₱${selAcc.balance.toLocaleString()}</strong>.<br>Deducting this will make the account negative. Continue anyway?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Proceed',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#94a3b8',
            customClass: { popup: 'rounded-2xl' }
        });
        if (!confirmNegative.isConfirmed) return;
    }

    let btn = document.getElementById('btnFinalizePayslip');
    btn.innerText = "⏳ Processing..."; btn.disabled = true;
    
    try {
        await updateDoc(doc(db, "cash_accounts", selAcc.id), { balance: selAcc.balance - finalNetPay });

        await addDoc(collection(db, "expenses"), {
            branch: "Main Office", 
            amount: finalNetPay, 
            category: "Payroll",
            account: selAcc.name, 
            note: `Payslip for ${data.name} (${data.start} to ${data.end}) - Branch: ${data.branch}`, 
            timestamp: serverTimestamp()
        });

        if (actualLoanDeducted > 0) {
            let lId = data.ledgerId;
            if (!lId) {
                const slQ = query(collection(db, "staff_ledger"), where("staffName", "==", data.name));
                const slSnap = await getDocs(slQ);
                if (!slSnap.empty) lId = slSnap.docs[0].id;
            }

            if (lId) {
                const ledgerRef = doc(db, "staff_ledger", lId);
                const ledgerSnap = await getDoc(ledgerRef);
                if (ledgerSnap.exists()) {
                    let currentPaid = parseFloat(ledgerSnap.data().totalPaid) || 0;
                    await updateDoc(ledgerRef, { totalPaid: currentPaid + actualLoanDeducted });
                    
                    await addDoc(collection(db, "staff_deductions"), {
                        staffName: data.name,
                        type: "Company Loan Payment",
                        amount: actualLoanDeducted,
                        dateAdded: serverTimestamp(),
                        status: "Paid",
                        paidAt: serverTimestamp(),
                        remarks: `Auto-deducted from Payslip`
                    });
                }
            }
        }
        
        // 4. 🔥 SMART VALE & MEAL CLEARER 
        let remainingValeToClear = actualValeDeducted;
        let remainingFoodToClear = actualFoodDeducted;

        if (remainingValeToClear > 0 || remainingFoodToClear > 0) {
            const deductQ = query(collection(db, "staff_deductions"), where("staffName", "==", data.name));
            const deductSnap = await getDocs(deductQ);
            
            let pendingDeductions = [];
            deductSnap.forEach(d => {
                if (d.data().status === "Unpaid") pendingDeductions.push({ id: d.id, ...d.data() });
            });

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
                        remainingValeToClear = 0; 
                    }
                }
                else if (dData.type === "Staff Meal" && remainingFoodToClear > 0) {
                    if (remainingFoodToClear >= dAmt) {
                        await updateDoc(dRef, { status: "Paid", paidAt: serverTimestamp() });
                        remainingFoodToClear -= dAmt;
                    } else {
                        await updateDoc(dRef, { amount: dAmt - remainingFoodToClear });
                        remainingFoodToClear = 0; 
                    }
                }
            }
        }

        data.isPaid = true; 
        data.loans = actualLoanDeducted;
        data.advances = actualValeDeducted;
        data.meals = actualFoodDeducted;
        
        data.lateDeduction = getFieldVal('psLate');
        data.sss = getFieldVal('psSSS');
        data.philhealth = getFieldVal('psPhil');
        data.pagibig = getFieldVal('psPagibig');
        data.straightBonus = getFieldVal('psStraightBonus');
        data.holidayPayTotal = getFieldVal('psHoliday');
        data.nightBonus = getFieldVal('psOvertime');

        Object.keys(data).forEach(key => {
            if (data[key] === undefined) { data[key] = 0; }
        });

        await addDoc(collection(db, "payroll_records"), {
            staffName: data.name, startDate: data.start, endDate: data.end,
            frozenData: data, finalNetPay: finalNetPay, processedAt: serverTimestamp()
        });

        Swal.fire({
            title: '✅ Payroll Disbursed!',
            html: `<strong>₱${finalNetPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong> was successfully deducted from <strong>${selAcc.name}</strong>.<br><br><span style="font-size: 13px; color: #64748b;">All Vales and Loans have been accurately updated.</span>`,
            icon: 'success',
            confirmButtonColor: '#16a34a',
            customClass: { popup: 'rounded-2xl' }
        });
        
        if (btn) {
            btn.innerText = "✅ Paid & Done!";
            btn.style.background = "#16a34a";
            btn.style.cursor = "not-allowed";
            btn.disabled = true;
        }
        
        window.downloadPayslipImage();
        
        if (typeof window.loadLedger === 'function') window.loadLedger(); 
        if (typeof window.generateAutoPayslips === 'function') window.generateAutoPayslips(); 
        if (typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();

    } catch (e) {
        console.error(e); alert("❌ Failed to finalize payslip.");
        if (btn) { btn.innerText = "✅ Mark Paid & Auto-Deduct"; btn.disabled = false; }
    } 
};

// ==========================================
// 📸 PAYSLIP IMAGE DOWNLOADER (TABLET-FIXED)
// ==========================================
window.downloadPayslipImage = function() {
    const originalPayslip = document.getElementById('printablePayslip');
    const btn = document.getElementById('btnDownloadPayslip');
    let originalText = btn ? btn.innerText : "Download";
    
    if (btn) { btn.innerText = "⏳ Generating Image..."; btn.disabled = true; }

    // 1. Create a temporary, full-size clone outside the modal so tablets don't crop it!
    const printWrapper = document.createElement('div');
    printWrapper.style.position = 'absolute';
    printWrapper.style.left = '-9999px'; 
    printWrapper.style.top = '0';
    printWrapper.style.background = '#ffffff';
    printWrapper.style.width = '700px'; // Fixed width for perfect aspect ratio
    printWrapper.style.padding = '20px';
    printWrapper.style.boxSizing = 'border-box';
    
    const clone = originalPayslip.cloneNode(true);
    
    // 2. Convert all input boxes into static text so they render perfectly on mobile!
    clone.querySelectorAll('input').forEach(inp => {
        let span = document.createElement('span');
        span.innerText = inp.value;
        span.style.fontWeight = 'bold';
        span.style.fontSize = '14px';
        inp.parentNode.replaceChild(span, inp);
    });
    
    printWrapper.appendChild(clone);
    document.body.appendChild(printWrapper);

    // 3. Take the Ultra-HD screenshot of the un-cropped clone
    html2canvas(printWrapper, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
        let imgData = canvas.toDataURL("image/png");
        let link = document.createElement('a');
        
        let staffName = document.getElementById('psName').innerText.replace(/\s+/g, '_');
        let endDate = document.getElementById('psEnd').innerText;
        link.download = `Payslip_${staffName}_${endDate}.png`;
        
        link.href = imgData;
        link.click();

        document.body.removeChild(printWrapper); // Clean up the clone
        document.getElementById('payslipModal').style.display = 'none';

        if (btn) { btn.innerText = originalText; btn.disabled = false; }
    }).catch(err => {
        console.error("Error generating image:", err);
        alert("❌ Failed to generate image.");
        document.body.removeChild(printWrapper);
        if (btn) { btn.innerText = originalText; btn.disabled = false; }
    });
};

// ==========================================
// 📘 STAFF LOANS & LEDGER ENGINE (WITH AUTO-DEDUCT)
// ==========================================
window.loadLedger = async function() {
    const tbody = document.getElementById('ledgerTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 30px;">⏳ Calculating running balances...</td></tr>';

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

        // 🔥 THE ALPHABETICAL & ARCHIVE FIX: Put them in a Javascript Array first!
        let staffList = [];
        staffSnap.forEach(docSnap => {
            let staff = docSnap.data();
            
            // 🛑 Hide Resigned or Revoked Staff from the Ledger completely
            if (staff.status === 'Resigned' || staff.pin === 'REVOKED') return; 
            
            staffList.push({ id: docSnap.id, ...staff });
        });

        // Sort the array alphabetically by their first name
        staffList.sort((a, b) => (a.cashierName || "").localeCompare(b.cashierName || ""));

        let html = '';

        staffList.forEach(staff => {
            let name = staff.cashierName;
            
            let record = ledgerData[name] || { totalLoaned: 0, totalPaid: 0, cutoffDeduction: 0 };
            let balance = (record.totalLoaned || 0) - (record.totalPaid || 0);
            let cutoffDed = record.cutoffDeduction || 0;
            let unpaidVales = valesData[name] || 0;

            let balColor = balance > 0 ? 'var(--danger)' : 'var(--text-muted)';
            let balWeight = balance > 0 ? 'bold' : 'normal';
            let valeColor = unpaidVales > 0 ? '#ea580c' : 'var(--text-muted)';

            // 🔥 THE FIX: We pass `record.id` (the Ledger ID) to adjustStaffLoan instead of the Cashier ID!
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 12px;"><strong style="color: var(--primary);">👤 ${name}</strong></td>
                    <td style="padding: 12px;"><span class="badge badge-closed">${staff.branch}</span></td>
                    <td style="padding: 12px; font-weight: bold; color: #0284c7;">₱${(record.totalLoaned || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px; font-weight: bold; color: #16a34a;">₱${(record.totalPaid || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px; font-weight: ${balWeight}; color: ${balColor}; font-size: 15px;">₱${balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px; font-weight: bold; color: ${valeColor};">₱${unpaidVales.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px; font-weight: bold; color: #8b5cf6;">₱${cutoffDed.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td style="padding: 12px; display: flex; gap: 5px; flex-wrap: wrap;">
                        <button class="btn-refresh" style="background: #f3e8ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;" onclick="window.setAutoDeduct('${record.id}', '${name}', ${cutoffDed}, ${balance})">⚙️ Set Deduct</button>
                        <button class="btn-refresh" style="background: #f8fafc; border: 1px solid #cbd5e1; color: #475569; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;" onclick="window.adjustStaffLoan('${record.id}', '${name}', ${record.totalLoaned || 0}, ${record.totalPaid || 0})">✏️ Adjust</button>
                        <button class="btn-refresh" style="background: #e0f2fe; color: #0284c7; border: 1px solid #0284c7; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;" onclick="window.viewLedgerHistory('${name}')">📜 History</button>
                        <button class="btn-refresh" style="background: #fef3c7; color: #d97706; border: 1px solid #d97706; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;" onclick="window.issueLoan('${record.id}', '${name}', ${record.totalLoaned || 0})">➕ Loan</button>
                        <button class="btn-refresh" style="background: #dcfce7; color: #15803d; border: 1px solid #15803d; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;" onclick="window.logLoanPayment('${record.id}', '${name}', ${record.totalPaid || 0}, ${balance}, ${unpaidVales})">💸 Pay</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="8" class="text-center" style="padding: 30px; color: #64748b;">No active staff found.</td></tr>';

    } catch (e) {
        console.error("Ledger Error:", e);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: red; padding: 30px;">Error loading ledger.</td></tr>';
    }
};

window.setAutoDeduct = async function(docId, staffName, currentDed, balance) {
    if (balance <= 0) { 
        return Swal.fire('✅ No Debt', 'This employee has no outstanding balance.', 'success'); 
    }
    
    const { value: amtStr } = await Swal.fire({
        title: '⚙️ Set Auto-Deduct',
        html: `Set automatic per-cutoff deduction for <b>${staffName}</b>.<br><br>Remaining Balance: <b style="color:#dc2626; font-size:18px;">₱${balance.toLocaleString()}</b>`,
        input: 'number',
        inputLabel: 'Amount to deduct every payslip (₱):',
        inputValue: currentDed,
        showCancelButton: true,
        confirmButtonColor: '#d97706',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '💾 Save Deduction',
        customClass: { popup: 'rounded-2xl shadow-2xl' }
    });

    if (!amtStr) return;
    let amt = parseFloat(amtStr) || 0;
    if (amt < 0) return;
    if (amt > balance) { 
        await Swal.fire('⚠️ Cap Applied', `You set the deduction higher than their balance. We capped it at ₱${balance.toLocaleString()}.`, 'warning'); 
        amt = balance; 
    }
    
    try {
        Swal.fire({title: 'Saving...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        if (docId && docId !== 'undefined') {
            await updateDoc(doc(db, "staff_ledger", docId), { cutoffDeduction: amt });
            Swal.fire('✅ Saved', `${staffName} will now be automatically deducted ₱${amt.toLocaleString()} every cutoff.`, 'success');
            window.loadLedger();
        } else {
            Swal.fire('❌ Error', 'You must issue a loan first before setting a deduction rate.', 'error');
        }
    } catch (e) { Swal.fire('Error', 'Failed to set auto-deduct.', 'error'); console.error(e); }
};

window.issueLoan = async function(docId, staffName, currentLoaned) {
    const { value: formValues } = await Swal.fire({
        title: '💸 Issue Company Loan',
        html: `
            <div style="text-align: left; margin-top: 10px;">
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Amount to Loan (₱)</label>
                <input id="swal-loan-amt" type="number" class="swal2-input" placeholder="0.00" style="width: 100%; margin: 5px 0 15px; box-sizing: border-box; font-weight:bold; color:#0f766e;">
                
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Reason / Description</label>
                <input id="swal-loan-reason" type="text" class="swal2-input" placeholder="e.g. Tuition fee, Medical emergency" style="width: 100%; margin: 5px 0 10px; box-sizing: border-box;">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#0f766e',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '✅ Issue Loan',
        customClass: { popup: 'rounded-2xl shadow-2xl' },
        preConfirm: () => {
            const amt = document.getElementById('swal-loan-amt').value;
            const reason = document.getElementById('swal-loan-reason').value;
            if (!amt || parseFloat(amt) <= 0) { Swal.showValidationMessage('Please enter a valid loan amount'); return false; }
            if (!reason.trim()) { Swal.showValidationMessage('Please enter the reason for the loan'); return false; }
            return { amount: parseFloat(amt), reason: reason.trim() };
        }
    });

    if (!formValues) return;
    let amount = formValues.amount;
    let reason = formValues.reason;

    try {
        Swal.fire({title: 'Processing Loan...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
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
        
        // 🔥 THE FIX: Log the specific reason into the History Feed so you never forget!
        await addDoc(collection(db, "staff_deductions"), {
            staffName: staffName,
            type: "Company Loan Issued",
            amount: amount,
            dateAdded: serverTimestamp(),
            status: "Active",
            remarks: reason
        });

        Swal.fire('✅ Loan Issued!', `₱${amount.toLocaleString()} added to ${staffName}'s balance.\n\nReason Logged: ${reason}`, 'success');
        window.loadLedger();
    } catch (e) { console.error(e); Swal.fire('Error', "Failed to issue loan.", 'error'); }
};

window.logLoanPayment = async function(docId, staffName, currentPaid, currentBalance, unpaidVales) {
    // 1. Check if they owe ANYTHING at all
    if (currentBalance <= 0 && unpaidVales <= 0) { 
        return Swal.fire('✅ No Debt', 'This employee has no outstanding balance or unpaid vales.', 'success'); 
    }

    // 2. Build a beautiful breakdown UI
    let totalOwed = currentBalance + unpaidVales;
    let breakdownHtml = `<div style="text-align: left; background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 15px; font-size: 14px; border: 1px solid #e2e8f0;">`;
    breakdownHtml += `<b>${staffName}</b> owes a total of <b style="color: #dc2626; font-size: 18px;">₱${totalOwed.toLocaleString()}</b><br><br>`;
    if (currentBalance > 0) breakdownHtml += `<span style="color:#64748b;">• Company Loan:</span> <b style="color:#0f172a;">₱${currentBalance.toLocaleString()}</b><br>`;
    if (unpaidVales > 0) breakdownHtml += `<span style="color:#64748b;">• Unpaid Vales/Meals:</span> <b style="color:#0f172a;">₱${unpaidVales.toLocaleString()}</b>`;
    breakdownHtml += `</div>`;

    const { value: amountStr } = await Swal.fire({
        title: '💵 Log Manual Cash Payment',
        html: breakdownHtml,
        input: 'number',
        inputLabel: 'How much cash did they hand you? (₱)',
        inputPlaceholder: '0.00',
        showCancelButton: true,
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '✅ Confirm Payment',
        customClass: { popup: 'rounded-2xl shadow-2xl' }
    });

    if (!amountStr || amountStr.trim() === "") return;
    let amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return;
    if (amount > totalOwed) { 
        return Swal.fire('❌ Too High', `They only owe ₱${totalOwed.toLocaleString()}. You cannot log a payment higher than what they owe.`, 'error'); 
    }

    let remainingPayment = amount;

    try {
        Swal.fire({title: 'Processing Payment...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

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
                
                await addDoc(collection(db, "staff_deductions"), {
                    staffName: staffName,
                    type: "Company Loan Payment",
                    amount: remainingPayment,
                    dateAdded: serverTimestamp(),
                    status: "Paid",
                    paidAt: serverTimestamp(),
                    remarks: `Manual Cash Payment`
                });
            }
        }

        Swal.fire('✅ Payment Logged', `Payment of ₱${amount.toLocaleString()} successfully logged for ${staffName}!`, 'success');
        window.loadLedger();
    } catch (e) { 
        console.error(e); 
        Swal.fire('❌ Error', 'Failed to log manual payment. Check console.', 'error'); 
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
window.adjustStaffLoan = async function(ledgerId, staffName, currentLoan, currentPaid) {
    // 1. Ask the boss for the corrected numbers
    let newLoan = prompt(`[ADJUSTMENT] Enter the corrected TOTAL LOANED for ${staffName}:`, currentLoan);
    if (newLoan === null) return; 

    let newPaid = prompt(`[ADJUSTMENT] Enter the corrected TOTAL PAID for ${staffName}:`, currentPaid);
    if (newPaid === null) return; 

    // Convert them to safe numbers
    newLoan = parseFloat(newLoan) || 0;
    newPaid = parseFloat(newPaid) || 0;
    let newBalance = newLoan - newPaid;

    // 2. Final Confirmation Screen
    if (!confirm(`🚨 Confirm manual override for ${staffName}?\n\nTotal Loaned: ₱${newLoan.toFixed(2)}\nTotal Paid: ₱${newPaid.toFixed(2)}\nNew Remaining Balance: ₱${newBalance.toFixed(2)}`)) {
        return;
    }

    try {
        // 3. Update the correct staff_ledger document in Firebase
        if (ledgerId && ledgerId !== 'undefined') {
            await updateDoc(doc(db, "staff_ledger", ledgerId), {
                totalLoaned: newLoan,
                totalPaid: newPaid
            });
        } else {
            // If they never had a ledger profile before, generate one right now!
            await addDoc(collection(db, "staff_ledger"), {
                staffName: staffName,
                totalLoaned: newLoan,
                totalPaid: newPaid,
                cutoffDeduction: 0
            });
        }

        // 4. Create an audit log so you remember you made this adjustment
        await addDoc(collection(db, "manager_alerts"), {
            type: "LOAN_ADJUSTMENT",
            branch: "Main Office",
            message: `Manual ledger override for ${staffName}. New Balance forced to ₱${newBalance.toFixed(2)}.`,
            timestamp: serverTimestamp(),
            isRead: true 
        });

        alert("✅ Ledger successfully adjusted!");
        
        // 5. Instantly refresh the table WITHOUT reloading the whole app!
        window.loadLedger();

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
        // 🔥 THE FIX 1: Safely define the Start and End dates for the query!
        let startDateInputEl = document.getElementById('dashStartDate');
        let endDateInputEl = document.getElementById('dashEndDate');
        
        let startDateInput = startDateInputEl ? startDateInputEl.value : null;
        let endDateInput = endDateInputEl ? endDateInputEl.value : null;
        
        if (!startDateInput || !endDateInput) {
            let todayStr = new Date().toISOString().split('T')[0];
            startDateInput = todayStr; endDateInput = todayStr;
        }

        let startOfDay = new Date(startDateInput + 'T00:00:00');
        let endOfDay = new Date(endDateInput + 'T23:59:59');
        
        // 🔥 THE FIX 2: Calculate how many days they selected to compute the Loan Cut!
        let daysDiff = Math.round((endOfDay - startOfDay) / (1000 * 60 * 60 * 24));
        if (daysDiff < 1) daysDiff = 1;

        let dashFilter = document.getElementById('dashBranchFilter');
        let selectedBranch = dashFilter ? dashFilter.value : "All";
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
        if (isFranchisee) selectedBranch = window.sessionUser.branch;

        // 1. Fetch Sales 🔒 (Filtered by Branch)
        let q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        if (selectedBranch !== "All") {
            q = query(collection(db, "transactions"), where("branch", "==", selectedBranch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        }
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

        // 2. Fetch Actual Payouts Logged by Cashier 🔒 (Filtered by Branch)
        let payoutQ = query(collection(db, "grab_payouts"), where("dateStr", ">=", startDateInput), where("dateStr", "<=", endDateInput));
        if (selectedBranch !== "All") {
            payoutQ = query(collection(db, "grab_payouts"), where("branch", "==", selectedBranch), where("dateStr", ">=", startDateInput), where("dateStr", "<=", endDateInput));
        }
        const payoutSnap = await getDocs(payoutQ);

        // 🔥 THE FIX 3: Calculate the ACTUAL payouts logged by the cashiers!
        let actualGrabPayout = 0;
        let payoutLogsHtml = '';
        payoutSnap.forEach(docSnap => {
            let p = docSnap.data();
            let pAmt = parseFloat(p.amount) || 0;
            actualGrabPayout += pAmt;
            payoutLogsHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #cbd5e1; padding:2px 0;">
                <span style="color:#64748b; font-size:12px;">${p.dateStr} (${p.branch})</span>
                <strong style="color:#0f172a; font-size:12px;">₱${pAmt.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>
            </div>`;
        });
        if (actualGrabPayout === 0) payoutLogsHtml = `<div style="color:#94a3b8; font-size:11px; font-style:italic;">No payouts logged for this period.</div>`;

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
        // Allowing a generous 5 peso tolerance for floating point rounding issues!
        let varianceColor = variance < -5 ? '#dc2626' : (variance > 5 ? '#10b981' : '#475569');
        let varianceText = Math.abs(variance) <= 5 ? "Perfect Match" : `₱${variance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

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

                    <div style="display: flex; justify-content: space-between; background: ${variance < -5 ? '#fef2f2' : (variance > 5 ? '#f0fdf4' : '#f8fafc')}; padding: 10px; border-radius: 6px; border: 1px solid ${variance < -5 ? '#fecaca' : (variance > 5 ? '#bbf7d0' : '#e2e8f0')};">
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

// 2. The Master Pairing Engine (UPGRADED WITH STRICT LEDGER MATH & PENALTIES)
window.generateAutoPayslips = async function() {
    let startInput = document.getElementById('payrollStart').value;
    let endInput = document.getElementById('payrollEnd').value;
    let tableBody = document.getElementById('payrollGeneratorBody'); 

    if (!tableBody) return;
    if (!startInput || !endInput) { alert("Please select both Cutoff Start and End dates."); return; }

    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; font-weight:bold; color: #d97706;">⚙️ Crunching Strict HR Metrics...</td></tr>`;

    let sParts = startInput.split('-');
    let eParts = endInput.split('-');
    let trueStartDate = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0);
    let trueEndDate = new Date(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999);
    let fetchEndDate = new Date(trueEndDate); fetchEndDate.setHours(fetchEndDate.getHours() + 12);

    const parseTimeStr = (timeStr) => {
        let t = timeStr.toLowerCase().replace(/\s/g, '');
        let isPM = t.includes('pm'); let isNN = t.includes('nn');
        let parts = t.replace(/(am|pm|nn)/, '').split(':');
        let hour = parseInt(parts[0]) || 0; let minute = parts.length > 1 ? parseInt(parts[1]) : 0;
        if ((isPM || isNN) && hour < 12) hour += 12;
        if (t.includes('am') && hour === 12) hour = 0;
        return hour + (minute / 60);
    };

    try {
        const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
        let scheduleData = schedSnap.exists() ? schedSnap.data() : null;
        let holidaysObj = scheduleData ? (scheduleData.holidays || {}) : {};

        const prQ = query(collection(db, "payroll_records"), where("startDate", "==", startInput), where("endDate", "==", endInput));
        const prSnap = await getDocs(prQ);
        let paidRecords = {};
        prSnap.forEach(docSnap => { paidRecords[docSnap.data().staffName] = docSnap.data().frozenData; });

        const staffSnap = await getDocs(collection(db, "cashiers"));
        const ledgerSnap = await getDocs(collection(db, "staff_ledger"));
        let staffDict = {}; staffSnap.forEach(d => { staffDict[d.data().cashierName] = d.data(); });
        let ledgerDict = {}; ledgerSnap.forEach(d => { ledgerDict[d.data().staffName] = { id: d.id, ...d.data() }; });

        const attQ = query(collection(db, "attendance_logs"), where("timestamp", ">=", trueStartDate), where("timestamp", "<=", fetchEndDate), orderBy("timestamp", "asc"));
        const attSnap = await getDocs(attQ);

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
                staffData[name] = { branch: log.branch, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, holidayPayTotal: 0, foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, lateDeduction: 0, logs: [] };
            }

            // 🔥 GRAB THE MANUAL PENALTY FROM THE DATABASE!
            let manualPenalty = parseFloat(log.penaltyAmount) || 0;

            if (log.type === "TIME IN") {
                if (log.timestamp.toDate() <= trueEndDate) {
                    if (activeShifts[name]) {
                        let missedIn = activeShifts[name].time;
                        staffData[name].logs.push({ date: missedIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), in: missedIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), out: "MISSED", hrs: "0.00", remark: `<span style="color:#ef4444; font-weight:bold;">Missed Time Out</span>` });
                    }

                    let logDate = log.timestamp.toDate();
                    let lateMinutes = 0;
                    
                    if (scheduleData && scheduleData.currentSchedule) {
                        let lDay = logDate.getDate(); let lMonth = logDate.getMonth() + 1; let lYear = logDate.getFullYear();
                        if (scheduleData.currentYear === lYear && scheduleData.currentMonth === lMonth) {
                            let branchSched = scheduleData.currentSchedule[lDay] ? scheduleData.currentSchedule[lDay][log.branch] : null;
                            if (branchSched && branchSched.scheduled) {
                                let nickname = staffDict[name] ? (staffDict[name].scheduleNickname || name) : name;
                                let assignedShiftId = Object.keys(branchSched.scheduled).find(k => branchSched.scheduled[k] === nickname);
                                if (assignedShiftId && scheduleData.branchConfig[log.branch]) {
                                    let shiftConfig = scheduleData.branchConfig[log.branch].find(s => s.id === assignedShiftId);
                                    if (shiftConfig) {
                                        let match = shiftConfig.name.match(/\((.*?)-/);
                                        if (match && match[1]) {
                                            let expectedStartHour = parseTimeStr(match[1]); 
                                            if (expectedStartHour !== null) {
                                                let actualHour = logDate.getHours() + (logDate.getMinutes() / 60);
                                                let diffHours = actualHour - expectedStartHour;
                                                if (diffHours > -1.5 && diffHours < 4) {
                                                    lateMinutes = Math.floor(diffHours * 60);
                                                    if (lateMinutes < 0) lateMinutes = 0;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let dailyRate = staffDict[name] ? (parseFloat(staffDict[name].hourlyRate) || 0) : 0;
                    let ratePerHour = dailyRate / 8; 
                    let lateHoursToDeduct = Math.ceil(lateMinutes / 60); 
                    let lateAmount = (lateMinutes > 0 && !log.lateExempted) ? (lateHoursToDeduct * ratePerHour) : 0;

                    activeShifts[name] = { 
                        time: logDate, 
                        lateMinutes: lateMinutes, 
                        lateAmount: lateAmount, 
                        lateExempted: log.lateExempted || false,
                        lateHoursToDeduct: lateHoursToDeduct,
                        manualPenalty: manualPenalty // Save the manual penalty to apply at Time Out
                    };
                }
            } else if (log.type === "TIME OUT" && activeShifts[name]) {
                let timeIn = activeShifts[name].time;
                let lMins = activeShifts[name].lateMinutes;
                let lAmt = activeShifts[name].lateAmount;
                let lExempt = activeShifts[name].lateExempted;
                let lHrsDeduct = activeShifts[name].lateHoursToDeduct || 0;
                
                // Combine penalties if the user clicked the button on both Time In and Time Out!
                let totalManualPenaltyForShift = (activeShifts[name].manualPenalty || 0) + manualPenalty;
                
                let timeOut = log.timestamp.toDate();
                let hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                
                if (hoursWorked > 18) {
                    staffData[name].logs.push({ date: timeIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), in: timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), out: timeOut.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), hrs: hoursWorked.toFixed(2), remark: `<span style="color:#ef4444; font-weight:bold;">INVALID (${hoursWorked.toFixed(1)}h) - Use Manual Log</span>` });
                    delete activeShifts[name]; return; 
                }

                let remark = `<span style="color:#10b981; font-weight:bold;">Complete</span>`;
                let shiftMultiplier = 1; let thisShiftStraightBonus = 0; 
        
                if (hoursWorked < 1) {
                    shiftMultiplier = 0; remark = `<span style="color:#ef4444; font-weight:bold;">Misclick (Ignored)</span>`;
                } else if (hoursWorked >= 13.5) {
                    shiftMultiplier = 2; thisShiftStraightBonus = 50; 
                    staffData[name].straightDutyBonusTotal = (staffData[name].straightDutyBonusTotal || 0) + thisShiftStraightBonus;
                    remark = `<span style="color:#8b5cf6; font-weight:bold;">Straight Duty (2 Shifts)</span>`;
                } else if (hoursWorked < 8) {
                    let missingHours = (8 - hoursWorked).toFixed(1);
                    remark = `<span style="color:#ef4444; font-weight:bold;">Short (${missingHours}h)</span>`;
                }

                if (lMins > 0) {
                    if (lExempt) {
                        remark += `<br><span style="color:#16a34a; font-weight:bold;">(Late Exempted)</span>`;
                    } else {
                        remark += `<br><span style="color:#dc2626; font-weight:bold;">(Late ${lMins}m = -${lHrsDeduct}hr: -₱${lAmt.toFixed(2)})</span>`;
                        staffData[name].lateDeduction += lAmt; 
                    }
                }

                // 🔥 INJECT THE MANUAL PENALTY INTO THE MATH AND PAYSLIP REMARKS
                if (totalManualPenaltyForShift > 0) {
                    remark += `<br><span style="color:#b91c1c; font-weight:900; font-size:10px;">-₱${totalManualPenaltyForShift.toFixed(2)} Manual Penalty</span>`;
                    staffData[name].lateDeduction += totalManualPenaltyForShift;
                }

                let outHour = timeOut.getHours();
                let isNightEligible = staffDict[name] ? (staffDict[name].eligibleNightDiff !== false) : true;
                let thisShiftNightBonus = 0;

                if (outHour >= 0 && outHour <= 4) {
                    staffData[name].nightShifts += 1;
                    if (isNightEligible) { thisShiftNightBonus = 50; staffData[name].nightBonusTotal += thisShiftNightBonus; }
                }

                let logDateStr = `${timeIn.getFullYear()}-${String(timeIn.getMonth()+1).padStart(2,'0')}-${String(timeIn.getDate()).padStart(2,'0')}`;
                let hType = holidaysObj[logDateStr];
                let dailyRate = staffDict[name] ? (staffDict[name].hourlyRate || 0) : 0;
                let baseForHoliday = (dailyRate * shiftMultiplier) + thisShiftNightBonus;
                let hBonus = 0;

                if (hType === 'Regular') { hBonus = baseForHoliday * 0.50; remark += ` <span style="color:#ea580c; font-weight:bold;">(Reg Hol: +₱${hBonus.toFixed(2)})</span>`; } 
                else if (hType === 'Special') { hBonus = baseForHoliday * 0.10; remark += ` <span style="color:#ea580c; font-weight:bold;">(Spl Hol: +₱${hBonus.toFixed(2)})</span>`; }

                staffData[name].logs.push({ date: timeIn.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), in: timeIn.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), out: timeOut.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), hrs: hoursWorked.toFixed(2), remark: remark });
                staffData[name].totalHours += hoursWorked; staffData[name].shiftsWorked += shiftMultiplier; staffData[name].holidayPayTotal += hBonus;
                delete activeShifts[name];
            } else if (manualPenalty > 0) {
                // 🔥 IF THE LOG IS STANDALONE (Like a Manual Override), EXTRACT THE PENALTY DIRECTLY!
                staffData[name].lateDeduction += manualPenalty;
                let logTime = log.timestamp ? log.timestamp.toDate() : new Date();
                staffData[name].logs.push({ 
                    date: logTime.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), 
                    in: logTime.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }), 
                    out: "---", 
                    hrs: "0.00", 
                    remark: `<span style="color:#b91c1c; font-weight:900; font-size:10px;">-₱${manualPenalty.toFixed(2)} Manual Penalty</span>` 
                });
            }
        });

        deductSnap.forEach(docSnap => {
            let deduct = docSnap.data(); let name = deduct.staffName;
            let dDate = deduct.dateAdded ? deduct.dateAdded.toDate() : new Date();
            if (dDate > trueEndDate) return;
            if (!staffData[name]) {
                let branchName = staffDict[name] ? staffDict[name].branch : "Unknown";
                staffData[name] = { branch: branchName, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, holidayPayTotal: 0, foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, lateDeduction: 0, logs: [] };
            }
            let amt = parseFloat(deduct.amount) || 0;
            if (deduct.type === "Staff Meal") staffData[name].foodDeductions += amt;
            else if (deduct.type === "Cash Advance") staffData[name].cashAdvances += amt;
        });

        bonusSnap.forEach(docSnap => {
            let b = docSnap.data(); let name = b.staffName;
            if (!staffData[name]) {
                let branchName = staffDict[name] ? staffDict[name].branch : "Unknown";
                staffData[name] = { branch: branchName, totalHours: 0, shiftsWorked: 0, nightShifts: 0, nightBonusTotal: 0, holidayPayTotal: 0, foodDeductions: 0, cashAdvances: 0, loans: 0, ledgerId: null, sss: 0, pagibig: 0, philhealth: 0, lateDeduction: 0, logs: [] };
            }
            let amt = parseFloat(b.amount) || 0;
            staffData[name].nightBonusTotal += amt; 
            let bDate = b.dateAdded ? b.dateAdded.toDate() : new Date();
            staffData[name].logs.push({ date: bDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), in: "---", out: "---", hrs: "0.00", remark: `<span style="color:#ea580c; font-weight:bold;">+₱${amt.toFixed(2)} (Manual OT: ${b.remarks || 'Bonus'})</span>` });
        });
       
        let html = '';
        let allStaffNames = new Set([...Object.keys(staffData), ...Object.keys(paidRecords)]);
        let masterPayrollTotal = 0; 

        if (allStaffNames.size === 0) {
            html = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #64748b;">No shifts or deductions found for this cutoff.</td></tr>`;
        } else {
            for (let name of allStaffNames) {
                let d; let isPaid = false;
                if (paidRecords[name]) {
                    d = paidRecords[name]; isPaid = true; window.globalPayrollCache[name] = d; 
                } else {
                    d = staffData[name]; let profile = staffDict[name] || {}; let dailyRate = profile.hourlyRate || 0; 
                    d.basicPay = d.shiftsWorked * dailyRate;

                    let loanData = ledgerDict[name]; let autoLoanDeduction = 0;
                    if (loanData) {
                        let currentBalance = (loanData.totalLoaned || 0) - (loanData.totalPaid || 0);
                        if (currentBalance > 0) {
                            let setRate = loanData.cutoffDeduction || 0;
                            autoLoanDeduction = Math.min(setRate, currentBalance); d.ledgerId = loanData.id;
                        }
                    }
                    d.loans = autoLoanDeduction;
                    d.sss = profile.sssAmount || 0; d.pagibig = profile.pagibigAmount || 0; d.philhealth = profile.philHealthAmount || 0;
                    let profileCustomDeducts = profile.customDeductions || [];
                    let customDeductSum = 0; profileCustomDeducts.forEach(c => customDeductSum += c.amount);
                   
                    window.globalPayrollCache[name] = {
                        name: name, branch: d.branch, hours: d.totalHours, nightBonus: d.nightBonusTotal, holidayPayTotal: d.holidayPayTotal,
                        straightBonus: d.straightDutyBonusTotal || 0, advances: d.cashAdvances, meals: d.foodDeductions, loans: d.loans, ledgerId: d.ledgerId,
                        basicPay: d.basicPay || 0, isPaid: d.isPaid, shiftsWorked: d.shiftsWorked, lateDeduction: d.lateDeduction || 0,
                        logs: staffData[name].logs, profile: staffDict[name] || null, start: startInput, end: endInput,
                        sss: d.sss, philhealth: d.philhealth, pagibig: d.pagibig, customDeductionsTotal: customDeductSum
                    };
                    d = window.globalPayrollCache[name]; 
                }

                let totalDeduct = (d.meals || 0) + (d.advances || 0) + (d.loans || 0) + (d.sss || 0) + (d.pagibig || 0) + (d.philhealth || 0) + (d.lateDeduction || 0);
                let estGross = d.basicPay + (d.nightBonusTotal || 0) + (d.straightBonus || 0) + (d.holidayPayTotal || 0);
                let estNet = estGross - totalDeduct;
                if (estNet > 0) masterPayrollTotal += estNet;
                
                let bonusLabel = d.nightBonus > 0 ? `<br><span style="font-size:11px; color:#f59e0b; font-weight:bold;">+₱${d.nightBonus} Night Bonus</span>` : '';
                let straightLabel = (d.straightBonus || 0) > 0 ? `<br><span style="font-size:11px; color:#8b5cf6; font-weight:bold;">+₱${d.straightBonus.toFixed(2)} Straight Bonus</span>` : '';
                let holLabel = d.holidayPayTotal > 0 ? `<br><span style="font-size:11px; color:#ea580c; font-weight:bold;">+₱${d.holidayPayTotal.toFixed(2)} Holiday Pay</span>` : '';
                let foodLabel = d.meals > 0 ? `<br><span style="font-size:11px; color:#ef4444;">-₱${d.meals.toFixed(2)} (Meals)</span>` : '';
                let valeLabel = d.advances > 0 ? `<br><span style="font-size:11px; color:#ef4444;">-₱${d.advances.toFixed(2)} (Vale)</span>` : '';
                let loanLabel = d.loans > 0 ? `<br><span style="font-size:11px; color:#ef4444; font-weight:bold;">-₱${d.loans.toFixed(2)} (Ledger)</span>` : '';
                let lateLabel = d.lateDeduction > 0 ? `<br><span style="font-size:11px; color:#ef4444; font-weight:bold;">-₱${d.lateDeduction.toFixed(2)} (Late)</span>` : '';
        
                let buttonHtml = isPaid
                    ? `<button onclick="window.openPayslipModal('${name}')" style="background:#475569; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size: 12px; font-weight: bold; width: 100%;">✅ View Paid Payslip</button>`
                    : `<button onclick="window.openPayslipModal('${name}')" style="background:#047857; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size: 12px; font-weight: bold; width: 100%;">🧾 Generate Payslip</button>`;

                html += `
                    <tr style="border-bottom: 1px dashed #e2e8f0; ${isPaid ? "background: #f8fafc; opacity: 0.85;" : ""}">
                        <td style="padding: 12px; font-weight: bold; color: #1e293b;">${name}</td>
                        <td style="padding: 12px; color: #64748b;">${d.branch}</td>
                        <td style="padding: 12px; font-weight: bold;">${(d.hours || 0).toFixed(2)} hrs ${bonusLabel} ${straightLabel} ${holLabel}</td>
                        <td style="padding: 12px; font-weight: bold;">Total: ₱${totalDeduct.toFixed(2)} ${foodLabel} ${valeLabel} ${loanLabel} ${lateLabel}</td>
                        <td style="padding: 12px;">${buttonHtml}</td>
                    </tr>
                `;
            }
        }
        tableBody.innerHTML = html;

        let grandTotalContainer = document.getElementById('payrollGrandTotalContainer');
        if (grandTotalContainer && allStaffNames.size > 0) {
            grandTotalContainer.style.display = 'flex';
            document.getElementById('payrollGrandTotalAmount').innerText = '₱' + masterPayrollTotal.toLocaleString(undefined, {minimumFractionDigits: 2});
        }

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
// 🔍 REMITTANCE AUDIT ENGINE (TRUE LEDGER MATH UPGRADE)
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
                    <div id="remitAuditBody" style="padding:20px; background:#f8fafc; max-height: 80vh; overflow-y: auto;">Loading financial data...</div>
                </div>
            </div>
        `);
    }

    document.getElementById('remitAuditModal').style.display = 'flex';
    let body = document.getElementById('remitAuditBody');
    body.innerHTML = `<div style="text-align:center; padding: 40px; color: #64748b;">⏳ Crunching true ledger balance for ${branch}...</div>`;

    try {
        let unremittedCashAvailable = 0;
        
        // 1. Fetch Closed Shifts
        const shiftSnap = await getDocs(query(collection(db, "shifts"), where("branch", "==", branch), where("status", "==", "Closed")));
        shiftSnap.forEach(doc => {
            let d = doc.data();
            unremittedCashAvailable += (parseFloat(d.totalCashSales) || 0);
            unremittedCashAvailable -= (parseFloat(d.cashOut) || parseFloat(d.expenses) || 0);
        });

        // 2. Fetch Active Shifts
        const activeSnap = await getDocs(query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true)));
        for (let docSnap of activeSnap.docs) {
            let d = docSnap.data();
            let validStartTime = d.startTime && d.startTime.toDate ? d.startTime.toDate() : new Date(d.startTime);
            
            const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", validStartTime));
            const txSnap = await getDocs(txQ);
            txSnap.forEach(tDoc => {
                let tx = tDoc.data();
                if (tx.status !== 'Voided') {
                    if (tx.splitDetails) {
                        let cashSplit = tx.splitDetails.find(s => s.method === "Cash");
                        if (cashSplit) unremittedCashAvailable += cashSplit.amount;
                    } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                        unremittedCashAvailable += (tx.netTotal || 0);
                    }
                }
            });

            const expQ = query(collection(db, "expenses"), where("shiftId", "==", docSnap.id));
            const expSnap = await getDocs(expQ);
            expSnap.forEach(eDoc => {
                unremittedCashAvailable -= (parseFloat(eDoc.data().amount) || 0);
            });
        }

        // 3. Fetch Remittances to subtract them AND build the History list
        const remitSnap = await getDocs(query(collection(db, "remittances"), where("branch", "==", branch)));
        let recentRemittancesHtml = '';
        let remitsList = [];

        remitSnap.forEach(doc => {
            let d = doc.data();
            if (d.status !== "Rejected") {
                // VERY IMPORTANT: We DO NOT subtract the current remittance we are auditing! 
                // We want to know exactly how much cash they had available BEFORE this remittance.
                if (doc.id !== remitId) {
                    unremittedCashAvailable -= (parseFloat(d.amount) || 0);
                }
            }
            if (doc.id !== remitId) remitsList.push(d); // Add to history list
        });

        // Build the requested Remittance History list
        remitsList.sort((a,b) => b.timestamp - a.timestamp).slice(0, 4).forEach(r => {
            let rDate = r.timestamp ? r.timestamp.toDate().toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '';
            let sColor = r.status === 'Received' ? '#16a34a' : '#ea580c';
            recentRemittancesHtml += `<div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px dashed #cbd5e1; padding:6px 0;">
                <span style="color:#475569;">${rDate} <span style="font-size:10px; font-weight:bold; color:${sColor};">(${r.status})</span></span>
                <strong style="color:#0f172a;">₱${parseFloat(r.amount).toLocaleString(undefined, {minimumFractionDigits:2})}</strong>
            </div>`;
        });
        if (!recentRemittancesHtml) recentRemittancesHtml = '<div style="font-size:12px; color:#94a3b8; font-style:italic;">No previous remittances found.</div>';

        // 4. Calculate Variance!
        // Fix micro-decimal math errors
        if (unremittedCashAvailable < 0.1) unremittedCashAvailable = 0; 
        
        let diff = amount - unremittedCashAvailable;
        if (Math.abs(diff) < 0.1) diff = 0;

        let diffColor = diff === 0 ? '#16a34a' : (diff < 0 ? '#dc2626' : '#ea580c');
        let diffNote = diff === 0 ? "Perfect Match ✔️" : (diff < 0 ? "Shorting Detected 🔻" : "Over Remitted 🔺");

        body.innerHTML = `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                <div style="font-size:12px; color:#64748b; font-weight:bold; margin-bottom:5px;">TRUE LEDGER AUDIT</div>
                <div style="font-size:14px; font-weight:bold; color:#0f172a;">📍 ${branch}</div>
            </div>
            
            <table style="width:100%; border-collapse: collapse; font-size: 14px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
                <tr style="background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
                    <td style="padding: 15px; font-weight:bold; color:#0f172a;">Total Unremitted Cash Available</td>
                    <td style="padding: 15px; text-align:right; font-weight:900; color:#0f172a;">₱${unremittedCashAvailable.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
                <tr>
                    <td style="padding: 15px; font-weight:bold; color:#0ea5e9;">Cashier Currently Remitting</td>
                    <td style="padding: 15px; text-align:right; font-weight:900; color:#0ea5e9;">₱${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                </tr>
            </table>

            <div style="margin-top: 15px; text-align: center; padding: 15px; background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 8px;">
                <div style="font-size: 12px; font-weight: bold; color: #b45309;">VARIANCE ANALYSIS</div>
                <div style="font-size: 18px; font-weight: 900; color: ${diffColor}; margin-top: 5px;">${diffNote} <br>(₱${Math.abs(diff).toLocaleString(undefined, {minimumFractionDigits:2})})</div>
                <div style="font-size: 11px; color: #92400e; margin-top: 8px; font-style: italic;">*Note: This strictly calculates Unremitted Cash Profit (Sales minus Expenses) and completely ignores the drawer's starting float.</div>
            </div>

            <!-- 🔥 THE NEW REMITTANCE HISTORY BLOCK 🔥 -->
            <div style="margin-top: 15px; text-align: left; padding: 15px; background: white; border: 1px solid #cbd5e1; border-radius: 8px;">
                <div style="font-size: 11px; font-weight: bold; color: #64748b; margin-bottom: 5px; text-transform: uppercase;">Recent Remittance History</div>
                ${recentRemittancesHtml}
            </div>
            
            <button onclick="window.approveRemittance('${remitId}', ${amount}, '${branch}', '${channel}'); document.getElementById('remitAuditModal').style.display='none';" style="width:100%; margin-top:15px; padding:15px; background:#16a34a; color:white; font-weight:bold; border:none; border-radius:8px; cursor:pointer; font-size:16px; transition:0.2s;">Approve ₱${amount.toLocaleString()} Remittance</button>
        `;

    } catch(e) {
        console.error(e);
        body.innerHTML = `<div style="color:red; text-align:center; padding: 20px;">Failed to run audit. Check console.</div>`;
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
            }

            // 🔥 PHOTO PREVIEW BUTTON
            let photoBtn = data.photoUrl ? `<br><button onclick="window.viewSelfie('${data.photoUrl}', 'Invoice: ${data.invoiceNum || 'N/A'}')" style="margin-top:5px; background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; padding:4px 8px; border-radius:4px; font-size:10px; font-weight:bold; cursor:pointer;">📸 View OR</button>` : '';

            // 🔥 DELETE BUTTON
            let deleteBtn = `<button onclick="window.deletePayable('${docSnap.id}')" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:6px 10px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:12px; margin-left:0;" title="Delete">🗑️</button>`;

            // 🔥 THE FIX: Added "vertical-align: middle;" to all cells, and wrapped the buttons in an alignment div!
            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="vertical-align: middle; padding: 12px;"><strong style="color: var(--primary); font-size: 15px;">${data.supplier}</strong>${itemsHtml}</td>
                    <td style="font-family: monospace; color: #64748b; vertical-align: middle; padding: 12px;">${data.invoiceNum || 'N/A'} ${photoBtn}</td>
                    <td style="font-size: 13px; vertical-align: middle; padding: 12px;">${deliveryDate.toLocaleDateString()}</td>
                    <td style="font-weight: bold; color: ${dateColor}; vertical-align: middle; padding: 12px;">${dueDate.toLocaleDateString()}</td>
                    <td style="font-weight: bold; font-size: 15px; color: #1e293b; vertical-align: middle; padding: 12px;">₱${amount.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="vertical-align: middle; padding: 12px;">${statusHtml}</td>
                    <td style="vertical-align: middle; padding: 12px;">
                        <div style="display: flex; gap: 5px; align-items: center;">
                            <button onclick="window.openSettlePayable('${docSnap.id}', '${data.supplier}', ${amount}, '${data.invoiceNum}')" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">💸 Pay Now</button>
                            ${deleteBtn}
                        </div>
                    </td>
                </tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="color: #64748b; padding: 30px;">All payables are cleared! No outstanding debts.</td></tr>';
        document.getElementById('payTotalUnpaid').innerText = `₱${totalUnpaid.toLocaleString(undefined, {minimumFractionDigits:2})}`;
        document.getElementById('payTotalOverdue').innerText = overdueCount;
        document.getElementById('payDueSoon').innerText = dueSoonCount;
    } catch (e) { console.error("Payables Error:", e); tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: red;">Error fetching payables.</td></tr>'; }
};

// 🔥 TABS LOGIC
window.switchPayablesTab = function(tab) {
    document.getElementById('tabPayActive').style.color = tab === 'Active' ? '#0f766e' : '#64748b';
    document.getElementById('tabPayActive').style.borderBottomColor = tab === 'Active' ? '#0f766e' : 'transparent';
    document.getElementById('tabPayHistory').style.color = tab === 'History' ? '#0f766e' : '#64748b';
    document.getElementById('tabPayHistory').style.borderBottomColor = tab === 'History' ? '#0f766e' : 'transparent';
    
    document.getElementById('payablesActiveSection').style.display = tab === 'Active' ? 'block' : 'none';
    document.getElementById('payablesHistorySection').style.display = tab === 'History' ? 'block' : 'none';
    
    if (tab === 'History') window.loadPayablesHistory();
};

window.loadPayablesHistory = async function() {
    const tbody = document.getElementById('payablesHistoryBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading history...</td></tr>';
    try {
        const q = query(collection(db, "payables"), where("status", "==", "Paid"), orderBy("datePaid", "desc"), limit(50));
        const snap = await getDocs(q);
        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
            let datePaid = d.datePaid ? d.datePaid.toDate().toLocaleDateString() : 'Unknown';
            let photoBtn = d.photoUrl ? `<button onclick="window.viewSelfie('${d.photoUrl}', 'Invoice: ${d.invoiceNum || 'N/A'}')" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">📸 View</button>` : '-';
            
            html += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td><strong style="color: #334155;">${d.supplier}</strong></td>
                <td style="font-family: monospace; color: #64748b;">${d.invoiceNum || 'N/A'}</td>
                <td style="font-size: 13px;">${datePaid}</td>
                <td style="font-weight: bold; color: #16a34a;">₱${(parseFloat(d.amount)||0).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                <td style="font-size: 12px; color: #475569;">${d.paidFromAccount || 'Unknown'}</td>
                <td>${photoBtn}</td>
            </tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="color: #64748b; padding: 30px;">No paid history found.</td></tr>';
    } catch(e) {
        console.error(e); tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading history.</td></tr>';
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

window.payableItemsCart = [];
window.payableInventoryOptions = [];

// ========================================================
// 📦 SMART RECEIVE & PAYABLES ENGINE (CRASH-PROOF UPGRADE)
// ========================================================

window.openAddPayableModal = async function() {
    let modal = document.getElementById('addPayableModal');
    if(modal) modal.style.display = 'flex';
    
    // Safely clear inputs regardless of whether they use the old or new HTML IDs!
    let suppName = document.getElementById('paySupplierName') || document.getElementById('suppName');
    if(suppName) suppName.value = '';
    
    let invNum = document.getElementById('payInvoiceNum') || document.getElementById('suppInvoice');
    if(invNum) invNum.value = '';
    
    let amountBox = document.getElementById('payAmount') || document.getElementById('suppAmount');
    if(amountBox) amountBox.value = '';
    
    window.payableItemsCart = [];
    window.renderPayableItems();

    let itemInput = document.getElementById('payItemSelect');
    if (itemInput) {
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
    }

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
    let pendingItemBox = document.getElementById('payItemSelect');
    let pendingQtyBox = document.getElementById('payItemQty');
    if (pendingItemBox && pendingItemBox.value && pendingQtyBox && pendingQtyBox.value) {
        window.addPayableItem(); 
    }

    // Safely grab values regardless of old or new HTML IDs
    let suppBox = document.getElementById('paySupplierName') || document.getElementById('suppName');
    let invBox = document.getElementById('payInvoiceNum') || document.getElementById('suppInvoice');
    let amtBox = document.getElementById('payAmount') || document.getElementById('suppAmount');
    let termsBox = document.getElementById('payTerms') || document.getElementById('suppTerms');

    let supplier = suppBox ? suppBox.value.trim() : '';
    let invoice = invBox ? invBox.value.trim() : '';
    let amount = amtBox ? parseFloat(amtBox.value) : 0;
    
    // 🔥 THE FIX: Safely parse the terms. If it's text like "Cash / COD", it becomes NaN. 
    // We catch that and force it to be 0 days!
    let termsRaw = termsBox ? termsBox.value : "0";
    let terms = parseInt(termsRaw);
    if (isNaN(terms)) {
        terms = 0;
    }

    if (!supplier || isNaN(amount) || amount <= 0) { 
        Swal.fire('Missing Details', 'Please enter Supplier Name and a valid Amount.', 'warning'); 
        return; 
    }

    let btn = document.getElementById('btnSavePayable');
    if(btn) { btn.innerText = "⏳ Uploading & Saving..."; btn.disabled = true; }

    try {
        // 🔥 UPLOAD THE INVOICE PHOTO TO FIREBASE STORAGE
        let photoUrl = "";
        let fileInput = document.getElementById('payPhotoProof') || document.getElementById('suppPhoto');
        
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `payables/inv_${Date.now()}.${fileExt}`;
            const storageRef = ref(window.storage, fileName);
            const snapshot = await uploadBytes(storageRef, file);
            photoUrl = await getDownloadURL(snapshot.ref);
        }

        // Calculate exact due date based on the safe number
        let deliveryDate = new Date(); 
        let dueDate = new Date(); 
        dueDate.setDate(deliveryDate.getDate() + terms);
        
        await addDoc(collection(db, "payables"), {
            supplier: supplier, invoiceNum: invoice, amount: amount, termsDays: terms, deliveryDate: deliveryDate, dueDate: dueDate, status: "Unpaid",
            hasLinkedItems: window.payableItemsCart.length > 0, linkedItems: window.payableItemsCart,
            photoUrl: photoUrl, 
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

        Swal.fire({
            title: '✅ Success!',
            text: 'Invoice logged and inventory added to Main Office.',
            icon: 'success',
            confirmButtonColor: '#0f766e',
            customClass: { popup: 'rounded-2xl shadow-2xl' }
        });

        let modal = document.getElementById('addPayableModal');
        if(modal) modal.style.display = 'none';
        
        if (fileInput) fileInput.value = '';
        
        window.loadPayablesDashboard();
        if (typeof window.loadInventoryData === 'function') window.loadInventoryData();
        
    } catch (e) { 
        console.error(e);
        Swal.fire('Error', `Failed to save. Error: ${e.message}`, 'error'); 
    } finally { 
        if(btn) { btn.innerText = "💾 Log Delivery & Track Deadline"; btn.disabled = false; } 
    }
};

window.deletePayable = async function(id) {
    if(!confirm("⚠️ Delete this invoice? (Note: This will NOT undo any physical inventory that was already added).")) return;
    try {
        await deleteDoc(doc(db, "payables", id));
        window.loadPayablesDashboard();
    } catch(e) { alert("Failed to delete."); }
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

        // 3. Fetch Transactions within the Date Range (🔒 FRANCHISE LOCKED)
        let txQ = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        if (branchFilter && branchFilter !== "All") {
            txQ = query(collection(db, "transactions"), where("branch", "==", branchFilter), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay));
        }
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
    
    let now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('manAttDateTime').value = now.toISOString().slice(0,16);
    document.getElementById('manAttRemarks').value = '';

    try {
        const snap = await getDocs(collection(db, "cashiers"));
        let html = '<option value="">-- Select Staff --</option>';
        let staffList = [];
        
        snap.forEach(doc => {
            if (doc.data().status === 'Resigned') return; // 🛑 ARCHIVE FIX
            staffList.push(doc.data().cashierName);
        });
        
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
        // 📅 GOOGLE CALENDAR WEBHOOK ENGINE (Optional)
        // To use this, create a Zapier or Make.com Webhook and paste the URL here.
        const CALENDAR_WEBHOOK_URL = ""; // e.g., "https://hooks.zapier.com/hooks/catch/..."
        
        if (CALENDAR_WEBHOOK_URL) {
            try {
                fetch(CALENDAR_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        staffName: staffName,
                        branch: branch,
                        action: type,
                        time: logDate.toLocaleString('en-US'),
                        type: "Manual Override"
                    })
                }).catch(e => console.warn("Calendar Webhook silent fail (CORS/Network)"));
            } catch(e) {}
        }

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
    
    let now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('manOtDate').value = now.toISOString().split('T')[0];
    
    document.getElementById('manOtAmount').value = '';
    document.getElementById('manOtRemarks').value = '';

    try {
        const snap = await getDocs(collection(db, "cashiers"));
        let html = '<option value="">-- Select Staff --</option>';
        let staffList = [];
        
        snap.forEach(doc => {
            if (doc.data().status === 'Resigned') return; // 🛑 ARCHIVE FIX
            staffList.push(doc.data().cashierName);
        });
        
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
// 📈 ADVANCED CHART.JS ANALYTICS ENGINE (DATE SYNC UPGRADE)
// ========================================================
window.revenueChartInstance = null;
window.categoryChartInstance = null;

window.renderDashboardCharts = async function() {
    try {
        // 1. Grab the Branch Filter value
        let dashFilter = document.getElementById('dashBranchFilter');
        let selectedBranch = dashFilter ? dashFilter.value : "All";
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
        if (isFranchisee) selectedBranch = window.sessionUser.branch;

        // 2. Grab Dates directly from the Date Picker at the top of the dashboard!
        let startInput = document.getElementById('dashStartDate').value;
        let endInput = document.getElementById('dashEndDate').value;
        
        let startDay = new Date(startInput + 'T00:00:00');
        let endDay = new Date(endInput + 'T23:59:59');

        // Calculate how many days they selected
        let diffDays = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24));
        
        // 🔥 SMART DEFAULT: If they only pick ONE day (like today), a line chart looks broken with only 1 dot.
        // So we automatically stretch the chart 7 days backwards to give them a trend!
        if (diffDays <= 1) {
            startDay = new Date(endDay);
            startDay.setDate(endDay.getDate() - 6);
            startDay.setHours(0,0,0,0);
        }

        // 3. Setup Date Labels for the X-Axis dynamically based on their selection
        let dateLabels = [];
        let currentDate = new Date(startDay);
        while (currentDate <= endDay) {
            dateLabels.push(currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // 4. Fetch the Data from Firebase
        let txQ = query(collection(db, "transactions"), where("timestamp", ">=", startDay), where("timestamp", "<=", endDay));
        if (selectedBranch !== "All") {
            txQ = query(collection(db, "transactions"), where("branch", "==", selectedBranch), where("timestamp", ">=", startDay), where("timestamp", "<=", endDay));
        }
        const txSnap = await getDocs(txQ);

        // --- DATA BUCKETS ---
        let branchDailyTrend = {}; 
        let periodBranchMix = {}; 

        // 5. Crunch the numbers dynamically (BULLETPROOF SALES ONLY FILTER)
        txSnap.forEach(doc => {
            let tx = doc.data();
            
            // 🚫 STRICT ACCOUNTING LOCK: Ignore voids, remittances, and expenses!
            if (tx.status === "Voided") return;
            if (tx.type === "Remittance" || tx.type === "Cash Drop" || tx.type === "Expense" || tx.isRemittance === true) return;

            let txDate = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateLabel = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            let branch = tx.branch || "Unknown";

            let grossTx = 0;
            if (tx.cart && Array.isArray(tx.cart)) { 
                tx.cart.forEach(item => { 
                    let qty = parseFloat(item.qty) || 1;
                    let basePrice = parseFloat(item.variantPrice) || parseFloat(item.basePrice) || 0;
                    
                    // 🔥 THE FIX: Accurately calculate all Add-on prices!
                    let addonTotal = 0;
                    if (item.addons) {
                        for (let k in item.addons) {
                            addonTotal += (parseFloat(item.addons[k].price) || 0) * (parseFloat(item.addons[k].qty) || 0);
                        }
                    }
                    
                    grossTx += (basePrice + addonTotal) * qty; 
                }); 
            } else { 
                // Fallback for older transactions
                grossTx = parseFloat(tx.subTotalBeforeDiscount) || parseFloat(tx.netTotal) || 0; 
            }

            // 🚫 FINAL SAFETY CHECK: Real sales cannot be negative. Ignore cash-outs!
            if (grossTx <= 0) return;

            // 🚫 FINAL SAFETY CHECK: Real sales cannot be negative. Ignore cash-outs!
            if (grossTx <= 0) return;

            // A. Populate the Line Chart Data 
            if (!branchDailyTrend[branch]) {
                branchDailyTrend[branch] = new Array(dateLabels.length).fill(0); 
            }
            let dayIndex = dateLabels.indexOf(dateLabel);
            if (dayIndex !== -1) {
                branchDailyTrend[branch][dayIndex] += grossTx;
            }

            // B. Populate the Doughnut Chart Data 
            if (!periodBranchMix[branch]) periodBranchMix[branch] = 0;
            periodBranchMix[branch] += grossTx;
        });

        // 🎨 Beautiful Auto-Assigned Colors for the Branches
        const themeColors = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#f43f5e', '#64748b'];

        // ==========================================
        // 📉 DRAW THE DYNAMIC LINE CHART 
        // ==========================================
        const revCtx = document.getElementById('revenueTrendChart');
        if (window.revenueChartInstance) window.revenueChartInstance.destroy(); 

        let lineDatasets = [];
        let colorIndex = 0;
        
        for (let branch in branchDailyTrend) {
            let c = themeColors[colorIndex % themeColors.length];
            lineDatasets.push({
                label: branch,
                data: branchDailyTrend[branch],
                borderColor: c, backgroundColor: c, borderWidth: 3,
                pointBackgroundColor: 'white', pointBorderColor: c,
                pointBorderWidth: 2, pointRadius: 4, fill: false, tension: 0.4
            });
            colorIndex++;
        }

        window.revenueChartInstance = new Chart(revCtx, {
            type: 'line',
            data: { labels: dateLabels, datasets: lineDatasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, weight: 'bold' } } } },
                scales: { y: { beginAtZero: true, grid: { color: '#f8fafc' } }, x: { grid: { display: false } } },
                interaction: { mode: 'index', intersect: false } 
            }
        });

        // ==========================================
        // 🐙 DYNAMIC PIE CHART (SELECTED PERIOD)
        // ==========================================
        const catCtx = document.getElementById('categoryMixChart');
        if (window.categoryChartInstance) window.categoryChartInstance.destroy();

        let mixLabels = Object.keys(periodBranchMix);
        let mixData = Object.values(periodBranchMix);
        
        let doughnutColors = themeColors.slice(0, mixLabels.length);
        if (mixLabels.length === 0) { 
            mixLabels = ["No Sales in Period"]; mixData = [1]; doughnutColors = ['#e2e8f0']; 
        }

        window.categoryChartInstance = new Chart(catCtx, {
            type: 'doughnut',
            data: {
                labels: mixLabels,
                datasets: [{
                    data: mixData, backgroundColor: doughnutColors,
                    borderWidth: 2, borderColor: 'white', hoverOffset: 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '75%', 
                plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, weight: 'bold' } } } }
            }
        });

        // 🔥 SNEAKY UI RENAME: Update the static HTML text dynamically so it makes sense!
        document.querySelectorAll('div, h3, span').forEach(el => {
            if (el.innerText === "7-Day Gross Revenue Trend") el.innerText = "📈 Dynamic Gross Revenue Trend";
            if (el.innerText === "Today's Sales Mix") el.innerText = "🍕 Sales Mix (Selected Period)";
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
// 🧾 DYNAMIC DIGITAL RECEIPT VIEWER (UNDEFINED FIX)
// ==========================================
window.viewReceiptDetails = function(receiptId, customer, time, payment, total, cartEncoded) {
    let safeCashierName = "Cashier";
    try {
        let fullCashierName = window.globalShiftReports && Object.values(window.globalShiftReports).find(s => s.transactions && s.transactions.some(t => t.receiptId === receiptId))?.cashier || 'System';
        safeCashierName = fullCashierName.split(' ')[0]; 
    } catch(e) {}
    
    let cart = JSON.parse(decodeURIComponent(cartEncoded));
    let itemsHtml = '';

    cart.forEach(item => {
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
                    // 🔥 THE FIX: Fallback to the 'key' (which holds the flavor name) if addon.name is missing!
                    let addonName = addon.name || key; 
                    let addonPrice = parseFloat(addon.price) || 0;
                    addonsHtml += `<div style="font-size: 11px; color: #64748b; margin-left: 10px;">+ ${addonName} (₱${addonPrice} x ${addon.qty})</div>`;
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
// 🧾 MASTER SALES HISTORY & FINANCIAL ENGINE (SECURED)
// ========================================================
window.loadSalesHistoryTab = async function() {
    const tbodyTx = document.getElementById('historyTableBody');
    const tbodyShifts = document.getElementById('historyShiftsBody');
    const tbodyDaily = document.getElementById('historyDailyBody');
    const tbodyMonthly = document.getElementById('historyMonthlyBody');
    
    let branchFilterEl = document.getElementById('histBranchFilter');
    let branchFilter = branchFilterEl ? branchFilterEl.value : "All";
    
    // 🔒 FRANCHISE HARD LOCK
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    if (isFranchisee) {
        branchFilter = window.sessionUser.branch; // Force it to their branch
        if (branchFilterEl) {
            branchFilterEl.value = branchFilter;
            branchFilterEl.disabled = true;
        }
    }

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
            
            // 🔥 THE 5:00 AM BUSINESS DAY CUTOFF FIX (For Shifts)
            let businessShiftDate = new Date(sTime.getTime());
            if (businessShiftDate.getHours() < 5) {
                businessShiftDate.setDate(businessShiftDate.getDate() - 1);
            }
            let dateStr = businessShiftDate.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' });

            window.globalShiftReports[doc.id] = {
                id: doc.id,
                branch: s.branch,
                cashier: s.cashier,
                dateStr: dateStr,
                timeLabel: `${sTimeStr} - ${eTimeStr}`,
                timestamp: sTime,
                sales: 0, cogs: 0, voids: 0, txCount: 0,
                categorySales: {}, itemSales: {}, transactions: [] 
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
        let tNet = 0; let tCogs = 0; let tGrab = 0; let tGrabCount = 0; 
        let dailyAggregates = {}; let monthlyAggregates = {}; 
        let distOrderType = {}; let distPayment = {}; let distTotalSales = 0;

        // 5. PROCESS EVERYTHING
        allTxArray.forEach(tx => {
            if (branchFilter !== "All" && tx.branch !== branchFilter) return;

            let dDate = tx.timestamp ? tx.timestamp.toDate() : new Date();
            
            // 🔥 THE 5:00 AM BUSINESS DAY CUTOFF FIX (For Transactions)
            let businessDate = new Date(dDate.getTime());
            if (businessDate.getHours() < 5) {
                businessDate.setDate(businessDate.getDate() - 1);
            }
            
            let dateStr = businessDate.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' }); 
            let monthStr = businessDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' }); 
            let timeStr = dDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }); // Keep real time for display
            
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

                if (tx.paymentMethod === "Grab" || tx.orderType === "Grab") {
                    tGrab += txNet;
                    tGrabCount += 1; 
                }

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

            if (!dailyAggregates[dailyKey]) dailyAggregates[dailyKey] = { branch: tx.branch, date: dateStr, sales: 0, cogs: 0, txCount: 0, voids: 0 };
            if (isVoid) { dailyAggregates[dailyKey].voids += txNet; } 
            else { dailyAggregates[dailyKey].sales += txNet; dailyAggregates[dailyKey].cogs += txCogs; dailyAggregates[dailyKey].txCount += 1; }

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

        let grabCountEl = document.getElementById('histCountGrab');
        if (grabCountEl) grabCountEl.innerText = `${tGrabCount} Order${tGrabCount !== 1 ? 's' : ''}`;

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

// ========================================================
// 🍟 GLOBAL ADD-ONS CRUD ENGINE (WITH CUSTOM SORTING)
// ========================================================
window.globalAddonsCache = [];

window.loadGlobalAddons = async function() {
    const tbody = document.getElementById('globalAddonsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Fetching Add-Ons...</td></tr>';
    
    // 1. INJECT THE BANNER IF IT IS MISSING
    let tableContainer = tbody.closest('table').parentElement;
    if (!document.getElementById('btnMassSyncAddons')) {
        let syncBtnHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; background: #fffbeb; padding: 15px; border-radius: 8px; border: 1px dashed #fcd34d; flex-wrap: wrap; gap: 15px;">
                <div style="flex: 1; min-width: 300px;">
                    <h3 style="margin: 0; color: #d97706; font-size: 15px;">🚀 Mass Sync & Arrangement Engine</h3>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #92400e;">Use the Up/Down arrows to arrange your add-ons, then click <b>Save Display Order</b>. Click <b>Mass Sync</b> to push updates to the menu.</p>
                </div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <!-- The Mix & Match button is baked in here! -->
                    <button onclick="window.openGlobalMixMatchModal()" id="btnGlobalMixMatch" style="background: #d97706; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 4px 6px rgba(217, 119, 6, 0.3);">🐙 Global Mix & Match</button>
                    <button onclick="window.saveGlobalAddonLayout()" id="btnSaveAddonOrder" style="background: #8b5cf6; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 4px 6px rgba(139, 92, 246, 0.3);">💾 Save Display Order</button>
                    <button onclick="window.extractAddonsToGlobal()" style="background: white; color: #0ea5e9; border: 1px solid #0ea5e9; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px;">📥 Extract</button>
                    <button id="btnMassSyncAddons" onclick="window.syncGlobalAddonsToMenu()" style="background: #0ea5e9; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px;">🔄 Mass Sync</button>
                </div>
            </div>
        `;
        tableContainer.insertAdjacentHTML('beforebegin', syncBtnHtml);
        
        let theadTr = tbody.previousElementSibling.querySelector('tr');
        if (theadTr && theadTr.children[0].innerText !== "Sort") {
            let th = document.createElement('th');
            th.innerText = "Sort";
            th.style.width = "50px";
            theadTr.insertBefore(th, theadTr.children[0]);
        }
    }

    // 2. 🐙 FOOLPROOF INJECTOR: If the HTML banner already existed, force the button into it!
    let massSyncBtn = document.getElementById('btnMassSyncAddons');
    if (massSyncBtn && !document.getElementById('btnGlobalMixMatch')) {
        let btn = document.createElement('button');
        btn.id = "btnGlobalMixMatch";
        btn.innerHTML = "🐙 Global Mix & Match";
        btn.style.cssText = "background: #d97706; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-right: 10px; box-shadow: 0 4px 6px rgba(217, 119, 6, 0.3);";
        btn.onclick = window.openGlobalMixMatchModal;
        
        // Shoves the button right into the banner group!
        massSyncBtn.parentNode.insertBefore(btn, massSyncBtn.parentNode.firstChild);
    }

    try {
        const snap = await getDocs(collection(db, "global_addons"));
        
        // Fetch the custom saved layout
        const layoutSnap = await getDoc(doc(db, "settings", "pos_addon_layout"));
        let layoutOrder = layoutSnap.exists() ? layoutSnap.data().items || [] : [];

        let addons = [];
        snap.forEach(doc => addons.push({id: doc.id, ...doc.data()}));
        
        // Sort by Custom Layout first, fallback to Alphabetical
        addons.sort((a,b) => {
            let idxA = layoutOrder.indexOf(a.id);
            let idxB = layoutOrder.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
        
        window.globalAddonsCache = addons;
        if(typeof window.renderGlobalAddons === 'function') window.renderGlobalAddons();
    } catch(e) { console.error(e); }
};

window.renderGlobalAddons = function() {
    const tbody = document.getElementById('globalAddonsBody');
    let html = '';
    window.globalAddonsCache.forEach((d, index) => {
        let safeName = d.name ? d.name.replace(/'/g, "\\'") : '';
        let safeIng = d.linkedIngredient ? d.linkedIngredient.replace(/'/g, "\\'") : '';
        
        // 🔥 THE FIX: Safely check if the category is a list. If it is, join it with commas!
        let catStr = Array.isArray(d.category) ? d.category.join(', ') : (d.category || 'All');
        let safeCat = catStr.replace(/'/g, "\\'");

        // Added 'white-space: normal' to the category badge so long lists wrap nicely instead of stretching the table!
        html += `
            <tr data-id="${d.id}" draggable="true"
                ondragstart="window.handleAddonDragStart(event)"
                ondragover="window.handleAddonDragOver(event)"
                ondragenter="window.handleAddonDragEnter(event)"
                ondragleave="window.handleAddonDragLeave(event)"
                ondrop="window.handleAddonDrop(event)"
                ondragend="window.handleAddonDragEnd(event)"
                style="border-bottom: 1px solid #f1f5f9; background: white; transition: background 0.2s;">
                <td style="padding: 12px; display: flex; align-items: center; gap: 15px;">
                    <input type="checkbox" class="addon-select-cb" onchange="window.toggleAddonSelection(this)" style="transform: scale(1.4); cursor: pointer; accent-color: #8b5cf6;">
                    <span style="color: #94a3b8; font-size: 18px; cursor: grab;" title="Hold and drag to reorder">↕️</span>
                </td>
                <td style="font-weight: bold; color: #1e293b; padding: 12px;">${d.name}</td>
                <td style="font-weight: bold; color: #16a34a; padding: 12px;">₱${d.price}</td>
                <td style="color: #64748b; padding: 12px;">${d.linkedIngredient || 'None'} <span style="font-size:11px;">(Deducts: ${d.deductQty || 0})</span></td>
                <td style="padding: 12px;"><span class="badge badge-open" style="white-space: normal; text-align: center; line-height: 1.4;">${catStr}</span></td>
                <td style="padding: 12px; display:flex; gap: 5px;">
                    <button onclick="window.openGlobalAddonModal('${d.id}', '${safeName}', ${d.price || 0}, ${d.deductQty || 0}, '${safeIng}', '${safeCat}')" style="background:#fffbeb; color:#d97706; border:1px solid #fcd34d; padding:6px 12px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">✏️ Edit</button>
                    <button onclick="window.duplicateGlobalAddon('${safeName}', ${d.price || 0}, ${d.deductQty || 0}, '${safeIng}')" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; padding:6px 12px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">📋 Clone</button>
                    <button onclick="window.deleteGlobalAddon('${d.id}', '${safeName}')" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; padding:6px 12px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="6" class="text-center">No Global Add-Ons setup yet.</td></tr>';
};

window.moveGlobalAddon = function(index, direction) {
    let newIndex = index + direction;
    if (newIndex < 0 || newIndex >= window.globalAddonsCache.length) return;
    let temp = window.globalAddonsCache[index];
    window.globalAddonsCache[index] = window.globalAddonsCache[newIndex];
    window.globalAddonsCache[newIndex] = temp;
    window.renderGlobalAddons();
};

// Added "isSilent" so the auto-save doesn't interrupt your workflow with popups!
window.saveGlobalAddonLayout = async function(isSilent = false) {
    let btn = document.getElementById('btnSaveAddonOrder');
    if(btn && !isSilent) btn.innerText = "⏳ Saving...";

    let layoutIds = window.globalAddonsCache.map(a => a.id);
    let layoutNames = window.globalAddonsCache.map(a => (a.name || "").toLowerCase()); 
    
    try {
        await setDoc(doc(db, "settings", "pos_addon_layout"), { items: layoutIds, itemNames: layoutNames }, { merge: true });
        
        if (!isSilent) {
            Swal.fire({title: '💾 Saved!', text: 'Add-On arrangement saved. Cashier POS will update instantly.', icon: 'success', customClass: { popup: 'rounded-2xl' }});
        }
    } catch(e) {
        console.error(e); 
        if (!isSilent) Swal.fire('Error', 'Failed to save arrangement.', 'error');
    } finally {
        if(btn && !isSilent) btn.innerText = "💾 Save Display Order";
    }
};

// 🔥 NEW: 1-CLICK ADD-ON CLONER
window.duplicateGlobalAddon = function(name, price, qty, linkedIng) {
    // Opens the modal with the exact same details, but a blank ID so it saves as a NEW item!
    window.openGlobalAddonModal('', name + ' (Copy)', price, qty, linkedIng, 'All');
};

window.openGlobalAddonModal = async function(id = '', name = '', price = '0', qty = '0', linkedIng = '', cat = 'All') {
    document.getElementById('gaId').value = id;
    document.getElementById('gaName').value = name;
    document.getElementById('gaPrice').value = price;
    document.getElementById('gaQty').value = qty;
    
    let btn = document.getElementById('btnSaveGA');
    if (btn) btn.innerText = id ? "💾 Update Add-On" : "💾 Save New Add-On";

    document.getElementById('globalAddonModal').style.display = 'flex';
    
    let select = document.getElementById('gaIngredient');
    let catEl = document.getElementById('gaCategory');
    
    select.innerHTML = '<option value="">Scanning inventory...</option>';
    if (catEl) catEl.innerHTML = '<option value="All">Scanning menu categories...</option>';

    try {
        // 1. Fetch Live Inventory for the "Linked Raw Material" Dropdown
        // 🔥 THE FIX: ONLY scan the Main Office so you don't get 4 branches worth of duplicates!
        const invQ = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
        const invSnap = await getDocs(invQ);
        let html = '<option value="">-- No Linked Ingredient --</option>';
        
        let invItems = [];
        invSnap.forEach(d => invItems.push(d.data().name));
        invItems.sort();

        invItems.forEach(invName => { 
            let isSelected = (invName === linkedIng) ? "selected" : "";
            html += `<option value="${invName}" ${isSelected}>${invName}</option>`; 
        });
        
        select.innerHTML = html;

        // 2. 🔥 THE FIX: Fetch Live Categories for the "Menu Category" Dropdown
        const menuSnap = await getDocs(collection(db, "menu"));
        let uniqueCats = new Set();
        
        // Scan the entire menu and collect every unique category
        menuSnap.forEach(d => {
            if (d.data().category) uniqueCats.add(d.data().category.trim());
        });

        if (catEl) {
            let catHtml = '<option value="All">All Menu Items</option>';
            
            // Sort them alphabetically and build the dropdown list!
            Array.from(uniqueCats).sort().forEach(c => {
                let isSelected = (c === cat) ? "selected" : "";
                catHtml += `<option value="${c}" ${isSelected}>${c}</option>`;
            });
            
            catEl.innerHTML = catHtml;
            catEl.value = cat; // Ensure the correct option stays highlighted!
        }

    } catch(e) { 
        console.error("Modal Data Load Error:", e); 
    }
};

// 🔥 NEW: EXTRACT EXISTING ADDONS FROM MENU TO GLOBAL HUB
window.extractAddonsToGlobal = async function() {
    let confirmExtract = await Swal.fire({
        title: '📥 Extract Add-ons?',
        text: 'This will scan your entire menu and pull any existing add-ons into the Global Hub so you do not have to recreate them.',
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#0ea5e9',
        confirmButtonText: 'Yes, Extract Them'
    });

    if (!confirmExtract.isConfirmed) return;
    Swal.fire({ title: 'Scanning Menu...', didOpen: () => Swal.showLoading() });

    try {
        // Get what we already have globally so we don't duplicate
        const globalSnap = await getDocs(collection(db, "global_addons"));
        let existingGlobalNames = [];
        globalSnap.forEach(d => existingGlobalNames.push(d.data().name.toLowerCase()));
        
        // Scan the Menu
        const menuSnap = await getDocs(collection(db, "menu"));
        let extractedCount = 0;
        let uniqueExtracted = {};
        
        menuSnap.forEach(docSnap => {
            let menuItem = docSnap.data();
            let menuCat = menuItem.category || "All";
            
            if (menuItem.addons && Array.isArray(menuItem.addons)) {
                menuItem.addons.forEach(a => {
                    let nameLower = a.name.toLowerCase();
                    // If we haven't seen it yet globally, and we haven't tracked it in this run...
                    if (!existingGlobalNames.includes(nameLower) && !uniqueExtracted[nameLower]) {
                        uniqueExtracted[nameLower] = {
                            name: a.name,
                            price: parseFloat(a.price) || 0,
                            linkedIngredient: a.linkedIngredient || "",
                            deductQty: parseFloat(a.deductQty) || 0,
                            category: menuCat // Assigns it to the category of the item it was found on!
                        };
                    }
                });
            }
        });
        
        // Save them all to Global Hub
        let addPromises = [];
        for (let key in uniqueExtracted) {
            addPromises.push(addDoc(collection(db, "global_addons"), uniqueExtracted[key]));
            extractedCount++;
        }
        await Promise.all(addPromises);
        
        Swal.fire('✅ Extraction Complete!', `Found and copied ${extractedCount} unique add-ons into the Global Hub.`, 'success');
        window.loadGlobalAddons();
    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to extract add-ons.', 'error');
    }
};

window.syncGlobalAddonsToMenu = async function() {
    let confirmSync = await Swal.fire({
        title: '🚀 Mass Sync Add-Ons?',
        html: `This will scan your <b>entire menu</b> and automatically attach add-ons based on their Category.<br><br><span style="font-size: 12px; color: #ef4444;">Note: Existing add-ons will have their prices updated to match the Global Hub!</span>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#0ea5e9',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Yes, Sync Everything!',
        customClass: { popup: 'rounded-2xl shadow-xl' }
    });

    if (!confirmSync.isConfirmed) return;

    let btn = document.getElementById('btnMassSyncAddons');
    if (btn) { btn.innerText = "⏳ Scanning & Syncing Menu..."; btn.disabled = true; }

    try {
        const globalSnap = await getDocs(collection(db, "global_addons"));
        let globalAddons = [];
        globalSnap.forEach(d => globalAddons.push({ id: d.id, ...d.data() }));

        if (globalAddons.length === 0) {
            Swal.fire('No Add-ons', 'You have no Global Add-ons setup yet.', 'info');
            return;
        }

        const menuSnap = await getDocs(collection(db, "menu"));
        let updateCount = 0;
        let batchPromises = [];

        menuSnap.forEach(docSnap => {
            let menuItem = docSnap.data();
            let menuCat = (menuItem.category || "Uncategorized").toLowerCase();
            let currentAddons = menuItem.addons || [];
            let modified = false;

            // 🔥 THE SMART MATCHING UPGRADE
            // "saucy" will now accurately match "Bonito Takoyaki" (the item) OR "Takoyaki" (the category)!
            let matchingGlobals = globalAddons.filter(ga => {
                if (ga.category === "All") return true;
                let globalCatLower = (ga.category || "").toLowerCase();
                let itemNameLower = (menuItem.name || "").toLowerCase();
                return menuCat.includes(globalCatLower) || itemNameLower.includes(globalCatLower); 
            });

            matchingGlobals.forEach(ga => {
                let existingIndex = currentAddons.findIndex(a => a.name.toLowerCase() === ga.name.toLowerCase());
                
                let addonPayload = {
                    name: ga.name,
                    price: parseFloat(ga.price) || 0,
                    linkedIngredient: ga.linkedIngredient || "",
                    deductQty: parseFloat(ga.deductQty) || 0
                };

                if (existingIndex >= 0) {
                    // Update existing (to sync price/ingredient changes)
                    let ea = currentAddons[existingIndex];
                    if (ea.price !== addonPayload.price || ea.linkedIngredient !== addonPayload.linkedIngredient || ea.deductQty !== addonPayload.deductQty) {
                        currentAddons[existingIndex] = addonPayload;
                        modified = true;
                    }
                } else {
                    // Add brand new Add-on to the product
                    currentAddons.push(addonPayload);
                    modified = true;
                }
            });

            if (modified) {
                batchPromises.push(updateDoc(doc(db, "menu", docSnap.id), { addons: currentAddons }));
                updateCount++;
            }
        });

        await Promise.all(batchPromises);
        
        Swal.fire({
            title: '✅ Global Sync Complete!',
            text: `Successfully synced add-ons and prices to ${updateCount} menu items!`,
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });

    } catch (error) {
        console.error("Sync error:", error);
        Swal.fire('Error', 'Failed to mass-sync add-ons. Check console.', 'error');
    } finally {
        if (btn) { btn.innerText = "🔄 Mass Sync to Entire Menu"; btn.disabled = false; }
    }
};

window.saveGlobalAddon = async function() {
    let id = document.getElementById('gaId').value; 
    let name = document.getElementById('gaName').value.trim();
    let price = parseFloat(document.getElementById('gaPrice').value) || 0;
    let qty = parseFloat(document.getElementById('gaQty').value) || 0;
    let ing = document.getElementById('gaIngredient').value;
    let cat = document.getElementById('gaCategory').value;

    if (!name) { alert("Add-on name is required!"); return; }
    
    let btn = document.getElementById('btnSaveGA');
    let origText = btn.innerText;
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        let payload = { name: name, price: price, deductQty: qty, linkedIngredient: ing, category: cat };

        if (id) {
            await updateDoc(doc(db, "global_addons", id), payload);
            alert(`✅ Success! ${name} has been updated.`);
        } else {
            await addDoc(collection(db, "global_addons"), payload);
            alert(`✅ Success! ${name} added globally.`);
        }

        document.getElementById('globalAddonModal').style.display = 'none';
        window.loadGlobalAddons();
    } catch(e) { 
        console.error(e); alert("Failed to save."); 
    } finally { 
        btn.innerText = origText; btn.disabled = false; 
    }
};

// 🔥 CASCADE DELETE UPGRADE
window.deleteGlobalAddon = async function(id, name) {
    let confirmDelete = await Swal.fire({
        title: `Delete "${name}"?`,
        html: `Are you sure you want to completely delete this add-on?<br><br><span style="color: #ef4444; font-weight: bold;">This will permanently remove it from the Global Hub AND strip it from every single menu item!</span>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Yes, Delete Everywhere!',
        customClass: { popup: 'rounded-2xl shadow-xl' }
    });

    if (!confirmDelete.isConfirmed) return;

    Swal.fire({ title: 'Deleting & Syncing...', didOpen: () => Swal.showLoading() });

    try {
        // 1. Delete from Global Hub
        await deleteDoc(doc(db, "global_addons", id));
        
        // 2. Scan entire menu and strip it from all products!
        const menuSnap = await getDocs(collection(db, "menu"));
        let batchPromises = [];
        let updateCount = 0;
        
        menuSnap.forEach(docSnap => {
            let menuItem = docSnap.data();
            if (menuItem.addons && Array.isArray(menuItem.addons)) {
                let originalLength = menuItem.addons.length;
                let filteredAddons = menuItem.addons.filter(a => a.name.toLowerCase() !== name.toLowerCase());
                
                if (filteredAddons.length !== originalLength) {
                    batchPromises.push(updateDoc(doc(db, "menu", docSnap.id), { addons: filteredAddons }));
                    updateCount++;
                }
            }
        });
        
        await Promise.all(batchPromises);

        Swal.fire('✅ Deleted!', `"${name}" removed from Global Hub and stripped from ${updateCount} menu items.`, 'success');
        window.loadGlobalAddons();
    } catch(e) { 
        console.error(e); 
        Swal.fire('Error', 'Failed to execute cascade delete.', 'error'); 
    }
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

    // 🔥 DYNAMICALLY INJECT MIX & MATCH BOX AND WASTE REASONS
    if (!document.getElementById('configMixMatch')) {
        let container = document.getElementById('configPosTabs').parentElement.parentElement;
        container.insertAdjacentHTML('beforeend', `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px;">
                <h3 style="margin-top: 0; color: #334155; font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 5px;">🐙 Mix & Match Flavors</h3>
                <p style="font-size: 11px; color: #64748b; margin-bottom: 10px;">Comma-separated list of flavors for the Takoyaki Mix & Match.</p>
                <textarea id="configMixMatch" rows="4" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-family: monospace; font-size: 13px; box-sizing: border-box; resize: vertical;"></textarea>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 5px;">Example: Pork, Shrimp, Octopus, Ham & Cheese, Bacon & Cheese</div>
            </div>
            <div style="background: #fff1f2; border: 1px solid #fecaca; border-radius: 8px; padding: 15px; margin-top: 15px;">
                <h3 style="margin-top: 0; color: #be123c; font-size: 16px; border-bottom: 2px solid #fecaca; padding-bottom: 5px;">🗑️ Custom Waste Reasons</h3>
                <p style="font-size: 11px; color: #9f1239; margin-bottom: 10px;">Comma-separated list of reasons for the Waste & Spoilage log.</p>
                <textarea id="configWasteReasons" rows="3" style="width: 100%; padding: 10px; border: 1px solid #fca5a5; border-radius: 6px; font-family: monospace; font-size: 13px; box-sizing: border-box; resize: vertical;"></textarea>
                <div style="font-size: 10px; color: #fda4af; margin-top: 5px;">Example: Dropped / Spilled, Burnt / Overcooked, Spoiled / Expired, Pest Damage</div>
            </div>
        `);
    }

    try {
        const docRef = doc(db, "settings", "global_pos_config");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            let data = docSnap.data();
            document.getElementById('configPayMethods').value = (data.paymentMethods || []).join(', ');
            document.getElementById('configOrderTypes').value = (data.orderTypes || []).join(', ');
            document.getElementById('configPosTabs').value = (data.posTabs || []).join(', ');
            document.getElementById('configKitchenPrep').value = (data.kitchenPrepCats || ["Prepared Batch"]).join(', ');
            document.getElementById('configAuditList').value = (data.auditItems || []).join(', ');
            document.getElementById('configMixMatch').value = (data.mixMatchFlavors || ["Pork", "Shrimp", "Octopus", "Ham & Cheese", "Bacon & Cheese"]).join(', ');
            
            // 🔥 LOAD SAVED WASTE REASONS
            document.getElementById('configWasteReasons').value = (data.wasteReasons || ["Dropped / Spilled", "Burnt / Overcooked", "Spoiled / Expired", "Customer Replacement", "Pest Damage", "Other"]).join(', ');
        } else {
            // Defaults
            document.getElementById('configPayMethods').value = "Cash, GCash, Bank, Grab";
            document.getElementById('configOrderTypes').value = "Dine-In, Take-Out, Delivery, Grab";
            document.getElementById('configPosTabs').value = "Takoyaki, Milk Tea, Coffee, Add-ons";
            document.getElementById('configKitchenPrep').value = "Prepared Batch";
            document.getElementById('configAuditList').value = "320cc Paper Bowl, 520cc Paper Bowl, LB1 Box, Burger Box";
            document.getElementById('configMixMatch').value = "Pork, Shrimp, Octopus, Ham & Cheese, Bacon & Cheese";
            document.getElementById('configWasteReasons').value = "Dropped / Spilled, Burnt / Overcooked, Spoiled / Expired, Customer Replacement, Pest Damage, Other";
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
        let payMethods = document.getElementById('configPayMethods').value.split(',').map(s => s.trim()).filter(Boolean);
        let orderTypes = document.getElementById('configOrderTypes').value.split(',').map(s => s.trim()).filter(Boolean);
        let posTabs = document.getElementById('configPosTabs').value.split(',').map(s => s.trim()).filter(Boolean);
        let prepCats = document.getElementById('configKitchenPrep').value.split(',').map(s => s.trim()).filter(Boolean);
        let auditList = document.getElementById('configAuditList').value.split(',').map(s => s.trim()).filter(Boolean);
        let mixFlavors = document.getElementById('configMixMatch').value.split(',').map(s => s.trim()).filter(Boolean);
        let wasteReasons = document.getElementById('configWasteReasons').value.split(',').map(s => s.trim()).filter(Boolean);

        await setDoc(doc(db, "settings", "global_pos_config"), {
            paymentMethods: payMethods,
            orderTypes: orderTypes,
            posTabs: posTabs,
            kitchenPrepCats: prepCats,
            auditItems: auditList,
            mixMatchFlavors: mixFlavors,
            wasteReasons: wasteReasons, // 🔥 SAVES THE CUSTOM REASONS TO CLOUD
            lastUpdatedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp()
        }, { merge: true });

        Swal.fire({ title: '✅ Success!', text: 'POS Settings saved to Cloud.', icon: 'success', customClass: { popup: 'rounded-2xl' } });
    } catch (error) {
        console.error("Error saving config:", error); alert("❌ Failed to save.");
    } finally {
        btn.innerText = "💾 Save Changes to Cloud"; btn.disabled = false;
    }
};

window.editManagerPermissions = async function(docId, email, existingPerms) {
    const { value: currentPerms, isConfirmed } = await Swal.fire({
        title: '🔐 Edit Permissions',
        html: `
            <div style="text-align: left; margin-top: 10px;">
                <p style="font-size: 13px; color: #475569; margin-bottom: 15px;">Editing access for <strong>${email}</strong>.</p>
                <label style="font-size: 12px; font-weight: bold; color: #475569;">Authorized Tabs (Comma Separated):</label>
                <textarea id="swal-perms" class="input-box" style="width: 100%; height: 80px; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; outline: none; font-family: monospace; resize: none;">${existingPerms}</textarea>
                <div style="font-size: 11px; color: #64748b; background: #f8fafc; padding: 8px; border-radius: 6px; border: 1px dashed #cbd5e1;">
                    <strong>Available Options:</strong> accounts, transfers, payables, devices, payroll, inbox, ledger, schedule, products, purchases, dispatch, zreadings, history, expenses, branches, menu, receipt, inventory, alerts<br><br>
                    Type <strong>all</strong> to grant full Master Access.
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#2563eb', // Blue to match the button
        confirmButtonText: 'Update Access',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        preConfirm: () => {
            return document.getElementById('swal-perms').value.trim();
        }
    });

    if (!isConfirmed || !currentPerms) return;
    
    // Clean up their typing (forces lowercase, removes spaces)
    let permArray = currentPerms.split(',').map(t => t.trim().toLowerCase());
    
    try {
        await updateDoc(doc(db, "hq_managers", docId), { permissions: permArray });
        
        Swal.fire({
            title: '✅ Access Updated!',
            text: `${email} must refresh their app to see the new tabs.`,
            icon: 'success',
            confirmButtonColor: '#16a34a',
            customClass: { popup: 'rounded-2xl' }
        });
        
        window.loadAdminDashboard();
    } catch (e) {
        console.error(e); 
        Swal.fire('Error', 'Failed to update permissions.', 'error');
    }
};

window.loadInventoryAudits = async function() {
    const tbody = document.getElementById('auditLogsBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 20px;">Fetching audit logs...</td></tr>';

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
                
                // 🔥 SMART RECALCULATOR: Fixes corrupted historical data
                let physQty = parseFloat(c.physicalQty !== undefined ? c.physicalQty : c.actualQty) || 0;
                let sysQty = parseFloat(c.systemQty);
                let savedVariance = parseFloat(c.variance);

                // Work backward if systemQty is missing
                if (isNaN(sysQty)) {
                    if (!isNaN(savedVariance)) sysQty = physQty - savedVariance; 
                    else sysQty = physQty; 
                }

                let variance = physQty - sysQty;
                
                // Only charge money for shortages!
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
        
        if (document.getElementById('auditKpiAccuracy')) document.getElementById('auditKpiAccuracy').innerText = `${accuracy.toFixed(1)}%`;
        if (document.getElementById('auditKpiLoss')) document.getElementById('auditKpiLoss').innerText = `₱${globalLoss.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

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
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px;">Fetching historical data...</td></tr>';
    
    let counts = JSON.parse(decodeURIComponent(countsEncoded));
    
    try {
        // We only fetch live inventory to grab the ITEM COSTS, because old audits might not have saved the cost data!
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        
        let liveStockDb = {};
        snap.forEach(docSnap => {
            let item = docSnap.data();
            liveStockDb[item.name] = {
                cost: parseFloat(item.baseCost) || parseFloat(item.cost) || 0,
                uom: item.uom || ''
            };
        });

        let html = '';
        let totalLoss = 0;
        let totalItemsCounted = 0;
        let perfectItems = 0;

        counts.forEach(countObj => {
            let name = countObj.name || countObj.itemName;
            let physQty = parseFloat(countObj.physicalQty !== undefined ? countObj.physicalQty : countObj.actualQty) || 0;
            let dbItem = liveStockDb[name] || { cost: 0, uom: '' };
            let uom = countObj.uom || dbItem.uom;
            let cost = parseFloat(countObj.cost || dbItem.cost);

            // 🔥 SMART HISTORICAL RECOVERY: 
            // Look for the saved System Qty. If missing, look for saved Variance and work backward!
            let sysQty = parseFloat(countObj.systemQty);
            let savedVariance = parseFloat(countObj.variance);

            if (isNaN(sysQty)) {
                if (!isNaN(savedVariance)) {
                    sysQty = physQty - savedVariance; // Reconstruct the past system expected!
                } else {
                    sysQty = physQty; // Fallback for deeply corrupted old data
                }
            }

            // Calculate the true variance based on historical numbers
            let variance = physQty - sysQty;

            // 🔥 MASSIVE LOSS FIX: ONLY calculate financial loss if variance is NEGATIVE (Shortage)
            let loss = 0;
            if (variance < 0) {
                loss = Math.abs(variance) * cost;
            }
            
            totalLoss += loss;
            totalItemsCounted++;
            if (variance === 0) perfectItems++;

            let varColor = variance < 0 ? '#dc2626' : (variance > 0 ? '#16a34a' : '#64748b');
            let varText = variance === 0 ? 'Perfect' : `${variance > 0 ? '+' : ''}${variance.toFixed(1)} ${uom}`;

            html += `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 10px; font-weight: bold; color: #334155;">${name}</td>
                    <td style="padding: 10px; color: #64748b;">${sysQty.toFixed(1)} ${uom}</td>
                    <td style="padding: 10px; font-weight: bold; color: #0284c7;">${physQty.toFixed(1)} ${uom}</td>
                    <td style="padding: 10px; font-weight: bold; color: ${varColor};">${varText}</td>
                    <td style="padding: 10px; text-align: right; color: #dc2626; font-weight: bold;">${loss > 0 ? `₱${loss.toFixed(2)}` : '-'}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="padding: 20px;">No items recorded in this audit.</td></tr>';

        let accuracy = totalItemsCounted > 0 ? (perfectItems / totalItemsCounted) * 100 : 0;
        
        if (document.getElementById('auditModalAccuracy')) document.getElementById('auditModalAccuracy').innerText = `${accuracy.toFixed(1)}%`;
        if (document.getElementById('auditModalLoss')) document.getElementById('auditModalLoss').innerText = `₱${totalLoss.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    } catch (e) {
        console.error("Audit Details Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px; color: red;">Failed to load historical audit data.</td></tr>';
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
    document.getElementById('ledgerHistorySubtitle').innerText = staffName;
    document.getElementById('ledgerHistoryModal').style.display = 'flex';
    
    const tbody = document.getElementById('ledgerHistoryBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px; color: #64748b; font-weight: bold;">Loading complete financial ledger...</td></tr>';

    try {
        // Fetch ALL records for this staff member (Loans, Vales, Payments, etc.)
        const q = query(collection(db, "staff_deductions"), where("staffName", "==", staffName));
        const snap = await getDocs(q);

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px; color: #94a3b8; font-style: italic;">No financial history on record.</td></tr>';
            return;
        }

        let historyData = [];
        snap.forEach(docSnap => historyData.push({ id: docSnap.id, ...docSnap.data() }));

        // Sort locally by date (Newest first) so we don't trigger a Firebase Index error!
        historyData.sort((a, b) => (b.dateAdded?.toDate() || 0) - (a.dateAdded?.toDate() || 0));

        let html = '';
        historyData.forEach(d => {
            let dateStr = d.dateAdded ? d.dateAdded.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Unknown Date';
            let remarks = d.remarks || d.notes || 'None';
            let type = d.type || 'Deduction';
            let amount = parseFloat(d.amount) || 0;
            
            // Dynamic Badge Styling
            let statusBadge = '';
            if (d.status === 'Paid') {
                statusBadge = '<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">Paid</span>';
            } else if (d.status === 'Unpaid') {
                statusBadge = '<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">Unpaid</span>';
            } else {
                statusBadge = `<span style="background: #f1f5f9; color: #475569; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${d.status || 'Active'}</span>`;
            }

            // Dynamic Money Formatting (Green for Payments, Red for Debts)
            let amountFmt = '';
            if (type.includes('Payment') || type.includes('Auto-Deduct')) {
                amountFmt = `<span style="color: #16a34a; font-weight: 900; font-size: 14px;">+ ₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>`;
            } else {
                amountFmt = `<span style="color: #dc2626; font-weight: 900; font-size: 14px;">- ₱${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px 10px; font-size: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #334155;">${type}</td>
                    <td style="padding: 12px 10px; font-size: 12px; color: #475569;">${remarks}</td>
                    <td style="padding: 12px 10px;">${statusBadge}</td>
                    <td style="padding: 12px 10px; text-align: right;">${amountFmt}</td>
                </tr>
            `;
        });
        
        tbody.innerHTML = html;
    } catch (e) {
        console.error("Ledger History Error:", e);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 20px; color: #dc2626; font-weight: bold;">Error loading history.</td></tr>';
    }
};

// ==========================================
// 🛡️ BULLETPROOF: MARK DEDUCTION PAID ENGINE
// ==========================================
window.forceMarkDeductionPaid = async function(docId, staffName, staffDocId) {
    if (!confirm(`⚠️ Are you sure you want to manually mark this Vale/Meal as PAID?\n\nThis will instantly remove it from ${staffName}'s outstanding balance and clear it from their next payslip.`)) return;
    
    try {
        // 1. Force the database to clear the debt (Using new Date() ensures it never crashes!)
        await updateDoc(doc(db, "staff_deductions", docId), {
            status: "Paid",
            paidAt: new Date(), 
            manualOverride: true
        });
        
        alert(`✅ Success! The ₱ deduction for ${staffName} is officially cleared.`);
        
        // 2. AGGRESSIVE UI REFRESH: Refresh whichever modal you are currently looking at!
        if (document.getElementById('ledgerHistoryModal') && document.getElementById('ledgerHistoryModal').style.display === 'flex') {
            if (typeof window.viewLedgerHistory === 'function') window.viewLedgerHistory(staffName);
        }
        
        if (document.getElementById('employeeProfileModal') && document.getElementById('employeeProfileModal').style.display === 'flex') {
            if (staffDocId && typeof window.openEmployeeProfile === 'function') window.openEmployeeProfile(staffDocId);
        }
        
        // 3. BACKGROUND REFRESH: Force the Ledger table to recalculate its math!
        if (typeof window.loadLedger === 'function') {
            window.loadLedger();
        }
        
        // 4. PAYROLL REFRESH: If you are on the Payroll tab, force it to wipe the old math and regenerate!
        let payrollTab = document.getElementById('view-payroll');
        if (payrollTab && payrollTab.classList.contains('active')) {
            let startRaw = document.getElementById('payrollStart').value;
            let endRaw = document.getElementById('payrollEnd').value;
            
            // Only trigger the recalculation if they have dates entered
            if (startRaw && endRaw && typeof window.generateAutoPayslips === 'function') {
                window.generateAutoPayslips();
            }
        }
        
    } catch (e) {
        console.error("Error marking paid:", e);
        alert("❌ Failed to update deduction status. Please check your internet connection.");
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
    let dashFilter = document.getElementById('dashBranchFilter');
    let selectedBranch = dashFilter ? dashFilter.value : "All";
    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    if (isFranchisee) selectedBranch = window.sessionUser.branch;

    let newTarget = prompt(`Enter new Monthly Sales Target for ${selectedBranch} (₱):`);
    if (!newTarget || isNaN(newTarget)) return;
    
    // 🔥 THE FIX: We moved the watchdog reset switch directly inside the main function!
    window.hasLoadedSalesTarget = false;

    let payload = { updatedAt: serverTimestamp() };
    if (selectedBranch === "All") payload.amount = parseFloat(newTarget);
    else payload[selectedBranch] = parseFloat(newTarget);

    await setDoc(doc(db, "settings", "sales_target"), payload, { merge: true });
    window.loadMonthlyTarget();
};

window.loadMonthlyTarget = async function() {
    try {
        let dashFilter = document.getElementById('dashBranchFilter');
        let selectedBranch = dashFilter ? dashFilter.value : "All";
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
        if (isFranchisee) selectedBranch = window.sessionUser.branch;

        const snap = await getDoc(doc(db, "settings", "sales_target"));
        
        // Grab the specific branch target, or fallback to the global 'amount'
        let targetAmount = 0;
        if (snap.exists()) {
            let data = snap.data();
            targetAmount = (selectedBranch !== "All" && data[selectedBranch] !== undefined) ? parseFloat(data[selectedBranch]) : (parseFloat(data.amount) || 0);
        }
        
        let now = new Date();
        let firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        let lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        let daysInMonth = lastDay.getDate();
        let currentDay = now.getDate();
        let daysLeft = daysInMonth - currentDay + 1; // +1 includes today
        
        // 🔒 Apply Branch Filter to Query!
        let q = query(collection(db, "transactions"), where("timestamp", ">=", firstDay));
        if (selectedBranch !== "All") {
            q = query(collection(db, "transactions"), where("branch", "==", selectedBranch), where("timestamp", ">=", firstDay));
        }

        const txSnap = await getDocs(q);
        
        let mtdSales = 0;
        txSnap.forEach(d => {
            let tx = d.data();
            if (tx.status !== 'Voided') {
                if (tx.splitDetails && tx.splitDetails.length > 0) {
                    tx.splitDetails.forEach(split => {
                        let amount = parseFloat(split.amount) || 0;
                        if (split.method === 'Grab') mtdSales += (amount * 0.82); else mtdSales += amount;
                    });
                } else {
                    let amount = parseFloat(tx.netTotal) || 0;
                    if (tx.paymentMethod === 'Grab') mtdSales += (amount * 0.82); else mtdSales += amount;
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
            statusEl.innerText = "Target Not Set"; statusEl.style.color = "#94a3b8";
            paceEl.innerText = `Click Edit Target to begin for ${selectedBranch}`; paceEl.style.color = "#94a3b8";
        } else if (remainingToTarget <= 0) {
            statusEl.innerText = "🏆 Target Hit!"; statusEl.style.color = "#10b981";
            paceEl.innerText = "Goal achieved!"; paceEl.style.color = "#10b981";
        } else if (isBehind) {
            statusEl.innerText = "Behind Target"; statusEl.style.color = "#ef4444";
            paceEl.innerText = `₱${(expectedPace - mtdSales).toLocaleString(undefined, {minimumFractionDigits:2})} below pace`; paceEl.style.color = "#ef4444";
        } else {
            statusEl.innerText = "🔥 On Pace"; statusEl.style.color = "#10b981";
            paceEl.innerText = `₱${(mtdSales - expectedPace).toLocaleString(undefined, {minimumFractionDigits:2})} ahead of pace`; paceEl.style.color = "#10b981";
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

// ========================================================
// 🧠 TAKODEÁL CEO AI ORACLE & YIELD TRACKING ENGINE
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
        // 1. GATHER DATA SOURCES
        const qWaste = query(collection(db, "stock_logs"), where("timestamp", ">=", startDate));
        const qShifts = query(collection(db, "shifts"), where("startTime", ">=", startDate));
        const qInventory = query(collection(db, "inventory"), where("branch", "==", branch));
        const qTx = query(collection(db, "transactions"), where("timestamp", ">=", startDate));
        const qBom = collection(db, "bom");

        const [wasteSnap, shiftSnap, invSnap, txSnap, bomSnap] = await Promise.all([getDocs(qWaste), getDocs(qShifts), getDocs(qInventory), getDocs(qTx), getDocs(qBom)]);

        // 🚨 2. THE BANKRUPTCY & CAPITAL DRAIN ALGORITHM
        let branchInv = {};
        let maxCapitalTiedUp = 0;
        let maxCapitalItem = "None";
        let totalInventoryValue = 0;

        invSnap.forEach(doc => { 
            let d = doc.data();
            let cost = parseFloat(d.baseCost) || 0;
            let stock = parseFloat(d.currentStock) || 0;
            let totalValue = cost * stock;
            
            // Track total money sitting in the warehouse
            totalInventoryValue += totalValue;

            // Find the single item draining the most capital
            if (totalValue > maxCapitalTiedUp && stock > 0) {
                maxCapitalTiedUp = totalValue;
                maxCapitalItem = d.name;
            }

            branchInv[d.name] = { cost: cost, uom: d.uom || 'units' }; 
        });

        // 3. MAP RECIPES (BOM)
        let recipes = {};
        bomSnap.forEach(doc => {
            let d = doc.data();
            if (!recipes[d.menuItem]) recipes[d.menuItem] = [];
            recipes[d.menuItem].push({ ingredient: d.ingredientName, qty: parseFloat(d.qty) || 0 });
        });

        // 4. CRUNCH WASTE & AUDIT LOSS DATA
        let totalWasteValue = 0;
        let itemWasteMap = {};
        let missingInventoryEvents = 0;
        let actualUnexplainedLoss = {}; 

        wasteSnap.forEach(doc => {
            let data = doc.data();
            if (data.branch !== branch) return;
            
            let qtyLost = Math.abs(data.variance || 0);
            let itemName = data.item;
            let costPerUnit = branchInv[itemName] ? branchInv[itemName].cost : 0;
            let valueLost = qtyLost * costPerUnit;

            // Known Spoilage
            if (data.type === "Waste / Spoilage") {
                totalWasteValue += valueLost;
                if (!itemWasteMap[itemName]) itemWasteMap[itemName] = { qty: 0, value: 0 };
                itemWasteMap[itemName].qty += qtyLost;
                itemWasteMap[itemName].value += valueLost;
            }
            
            // Unexplained Audit Loss (Theft / Over-portioning)
            if (data.type === "Manager General Audit" || data.type === "Audit Adjustment (Penalty)") {
                if (data.variance < 0) { 
                    if (!actualUnexplainedLoss[itemName]) actualUnexplainedLoss[itemName] = 0;
                    actualUnexplainedLoss[itemName] += qtyLost;
                    missingInventoryEvents++;
                }
            }
        });

        let topWastedItem = "None";
        let maxWasteValue = 0;
        for (let item in itemWasteMap) {
            if (itemWasteMap[item].value > maxWasteValue) {
                maxWasteValue = itemWasteMap[item].value;
                topWastedItem = item;
            }
        }

        // 5. CRUNCH YIELD (Theoretical Burn vs Actual Burn)
        let theoreticalBurn = {};
        let totalSales = 0;

        txSnap.forEach(doc => {
            let tx = doc.data();
            if (tx.branch !== branch || tx.status === "Voided") return;
            
            let cSales = tx.totalCashSales !== undefined ? tx.totalCashSales : (tx.netTotal || 0);
            totalSales += cSales;

            if (tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let qtySold = item.qty || 1;
                    let recipe = recipes[item.name || item.itemName] || [];
                    
                    recipe.forEach(ing => {
                        if (!theoreticalBurn[ing.ingredient]) theoreticalBurn[ing.ingredient] = 0;
                        theoreticalBurn[ing.ingredient] += (ing.qty * qtySold);
                    });

                    if (item.addons) {
                        for (let key in item.addons) {
                            let addon = item.addons[key];
                            if (addon.qty > 0 && addon.linkedIngredient) {
                                if (!theoreticalBurn[addon.linkedIngredient]) theoreticalBurn[addon.linkedIngredient] = 0;
                                theoreticalBurn[addon.linkedIngredient] += (addon.deductQty * addon.qty * qtySold);
                            }
                        }
                    }
                });
            }
        });

        // 6. CRUNCH SHIFT AUDIT DATA
        let totalShifts = 0;
        let shiftsWithCashVariance = 0;
        let totalCashShortage = 0;

        shiftSnap.forEach(doc => {
            let data = doc.data();
            if (data.branch !== branch || data.status !== "Closed") return;

            totalShifts++;
            if (data.difference && data.difference < -5) { 
                shiftsWithCashVariance++;
                totalCashShortage += Math.abs(data.difference);
            }
        });

        let errorEvents = shiftsWithCashVariance + missingInventoryEvents;
        let accuracyScore = totalShifts > 0 ? Math.max(0, 100 - ((errorEvents / (totalShifts * 2)) * 100)) : 100;
        let avgSalesPerDay = days > 0 ? totalSales / days : 0;

        // 7. UPDATE UI CARDS (CRASH-PROOF FIX)
        const safeSetText = (id, text) => { let el = document.getElementById(id); if (el) el.innerText = text; };
        const safeSetHtml = (id, html) => { let el = document.getElementById(id); if (el) el.innerHTML = html; };
        const safeSetColor = (id, color) => { let el = document.getElementById(id); if (el) el.style.color = color; };

        safeSetText('aiStatWaste', `₱${totalWasteValue.toLocaleString(undefined, {minimumFractionDigits:2})}`);
        safeSetText('aiStatAccuracy', `${accuracyScore.toFixed(0)}%`);
        safeSetColor('aiStatAccuracy', accuracyScore > 85 ? "#16a34a" : "#dc2626");
        safeSetText('aiStatTopWaste', topWastedItem === "None" ? "Looking Good!" : `${topWastedItem}\n(₱${maxWasteValue.toFixed(2)} lost)`);
        safeSetText('aiStatShortage', `₱${totalCashShortage.toLocaleString(undefined, {minimumFractionDigits:2})}`);
        
        let capHtml = maxCapitalItem === "None" ? "Healthy Cash Flow" : `${maxCapitalItem}<br><span style="font-size:12px; color:#ef4444;">(₱${maxCapitalTiedUp.toLocaleString(undefined, {minimumFractionDigits:2})} tied up)</span>`;
        safeSetHtml('aiStatCapitalDrain', capHtml);

        // 8. 🧠 THE AI TEXT GENERATION ENGINE
        let reportHTML = `<p><strong>Analysis Period:</strong> Last ${days} days at ${branch}.</p>`;

        // A. Bankruptcy & Capital Alert
        if (maxCapitalTiedUp > (totalInventoryValue * 0.4) && maxCapitalTiedUp > 5000) {
            reportHTML += `<div style="background:#fff1f2; padding:15px; border-left:4px solid #be123c; margin-bottom:15px; border-radius:4px;">
                <strong style="color:#9f1239; font-size: 15px;">🚨 BANKRUPTCY RISK / CAPITAL DRAIN ALERT:</strong><br>
                You currently have <strong>₱${maxCapitalTiedUp.toLocaleString(undefined, {minimumFractionDigits:2})}</strong> entirely tied up in <strong>${maxCapitalItem}</strong>. This represents a massive portion of your total asset value (₱${totalInventoryValue.toLocaleString(undefined, {minimumFractionDigits:2})}). If this item spoils or does not sell fast enough, it will severely impact your daily cash flow and ability to pay operational expenses. Consider pausing restocks for this item immediately.
            </div>`;
        }

        // B. Sales & Performance
        reportHTML += `<p><strong>📈 Financial Pacing:</strong> Generated <strong>₱${totalSales.toLocaleString()}</strong> in revenue, averaging ₱${avgSalesPerDay.toLocaleString(undefined, {maximumFractionDigits:0})} per day. `;
        if (avgSalesPerDay > 5000) reportHTML += `Volume is extremely healthy, indicating strong local demand.`;
        else reportHTML += `Sales pacing is somewhat moderate. Consider launching localized promotions.`;
        reportHTML += `</p>`;

        // C. Staff Accountability
        reportHTML += `<p><strong>⚖️ Staff Integrity & Accuracy:</strong> Your staff's operational accuracy is <strong>${accuracyScore.toFixed(0)}%</strong>. `;
        if (accuracyScore < 85) reportHTML += `<span style="color:#dc2626; font-weight:bold;">Critical Alert:</span> High frequency of missing stock and drawer cash (₱${totalCashShortage.toLocaleString()}). Enforce strict blind counts.`;
        else reportHTML += `<span style="color:#16a34a; font-weight:bold;">Excellent.</span> Cash and inventory audits are highly aligned.`;
        reportHTML += `</p>`;

        // D. INGREDIENT YIELD & PORTIONING MATRIX
        reportHTML += `<h4 style="margin-top:25px; margin-bottom: 10px; color:#4c1d95; border-bottom: 2px solid #ddd; padding-bottom: 5px;">📊 Portion Control & Yield Variance Matrix</h4>`;
        reportHTML += `<table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px; background: white; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <thead style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                <tr>
                    <th style="padding: 10px;">Ingredient</th>
                    <th style="padding: 10px;">Expected Burn (Sales)</th>
                    <th style="padding: 10px;">Known Waste</th>
                    <th style="padding: 10px; color: #dc2626;">Unexplained Loss</th>
                    <th style="padding: 10px;">Portion Health</th>
                </tr>
            </thead>
            <tbody>
        `;

        let hasYieldData = false;
        for (let ing in theoreticalBurn) {
            let uom = branchInv[ing] ? branchInv[ing].uom : 'units';
            let ideal = theoreticalBurn[ing];
            let waste = itemWasteMap[ing] ? itemWasteMap[ing].qty : 0;
            let missing = actualUnexplainedLoss[ing] || 0;
            
            let tolerance = ideal * 0.05;
            let healthHtml = '';
            
            if (missing > tolerance) {
                healthHtml = `<span style="background: #fef2f2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">⚠️ Over-Portioning / Theft</span>`;
            } else if (missing < -tolerance) {
                healthHtml = `<span style="background: #fffbeb; color: #d97706; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🔻 Under-Portioning (Skimping)</span>`;
            } else {
                healthHtml = `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">✅ Perfect Yield</span>`;
            }

            if (ideal > 0 || waste > 0 || missing !== 0) {
                hasYieldData = true;
                reportHTML += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 10px; font-weight: bold; color: #334155;">${ing}</td>
                        <td style="padding: 10px; color: #0284c7; font-weight: bold;">${ideal.toFixed(2)} ${uom}</td>
                        <td style="padding: 10px; color: #64748b;">${waste.toFixed(2)} ${uom}</td>
                        <td style="padding: 10px; color: #dc2626; font-weight: 900;">${missing.toFixed(2)} ${uom}</td>
                        <td style="padding: 10px;">${healthHtml}</td>
                    </tr>
                `;
            }
        }
        
        if (!hasYieldData) reportHTML += `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">No yield data available. Ensure recipes are set up and audits are completed.</td></tr>`;
        reportHTML += `</tbody></table>`;
        reportHTML += `<p style="font-size: 11px; color: #94a3b8; font-style: italic; margin-top: 5px;">* Expected Burn is calculated directly from your BOM recipes multiplied by exact POS sales. Unexplained Loss is triggered by Audit Shortages.</p>`;

        document.getElementById('aiReportText').innerHTML = reportHTML;
        
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
                <div onclick="window.openForecasterItemTrace('${item.name.replace(/'/g, "\\'")}', '${branch}')" style="cursor: pointer; background: white; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.03); overflow: hidden; border: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 10px 25px rgba(0,0,0,0.1)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(0,0,0,0.03)';">
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
// 📝 MASTER GENERAL AUDIT ENGINE (WITH SMART CONVERSIONS)
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
                purchUom: data.purchaseUom || data.uom || 'units',
                convRate: parseFloat(data.conversionRate) || parseFloat(data.conversion) || 1,
                
                // Memories for when they use the search bar
                tempRawValue: undefined, 
                tempConvRate: 1, 
                tempDisplayUom: data.uom || 'units'
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
        if (search && !item.name.toLowerCase().includes(search) && !item.category.toLowerCase().includes(search)) return;

        let uomDropdownHtml = '';
        if (item.purchUom !== item.uom && item.convRate !== 1) {
            uomDropdownHtml = `
                <select id="auditUom_${index}" style="padding: 10px 5px; border: 2px solid #fdba74; border-left: none; border-radius: 0 6px 6px 0; background: #fffcf0; color: #92400e; font-weight: bold; outline: none; cursor: pointer; box-sizing: border-box; height: 100%;">
                    <option value="base" data-conv="1">${item.uom}</option>
                    <option value="purch" data-conv="${item.convRate}">${item.purchUom}</option>
                </select>
            `;
        } else {
            uomDropdownHtml = `<span style="padding: 11px 10px; background: #f8fafc; color: #64748b; border: 2px solid #e2e8f0; border-left: none; border-radius: 0 6px 6px 0; font-size: 11px; font-weight: bold; display: flex; align-items: center; box-sizing: border-box; height: 100%;">${item.uom}</span>`;
        }

        // 🔥 THE FIX: We use a static ID for the input box so Javascript can grab it reliably!
        html += `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px; font-weight: bold; color: #1e293b; font-size: 14px;">${item.name}</td>
                <td style="padding: 12px; text-align: center;"><span class="badge badge-closed">${item.category}</span></td>
                <td style="padding: 12px; text-align: center; font-weight: bold; color: #64748b; font-size: 15px;">${item.systemQty.toFixed(1)} <span style="font-size:11px; font-weight:normal;">${item.uom}</span></td>
                <td style="padding: 12px; border-left: 2px dashed #e2e8f0; background: #fffcf0;">
                    <div style="display: flex; justify-content: center; align-items: stretch; max-width: 180px; margin: 0 auto; height: 42px;">
                        <input type="number" id="auditInput_${index}" placeholder="${item.systemQty.toFixed(1)}" style="flex: 1; width: 100%; padding: 10px; border: 2px solid #fdba74; border-radius: 6px 0 0 6px; text-align: center; font-weight: 900; color: #ea580c; font-size: 16px; outline: none; box-sizing: border-box; height: 100%;">
                        ${uomDropdownHtml}
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding: 40px; color:#94a3b8; font-weight: bold;">No items match your search.</td></tr>';
};

window.submitGeneralAudit = async function() {
    let branch = document.getElementById('auditModalBranch').value;
    if (!branch) { alert("Please select a branch first."); return; }

    if (!confirm(`⚠️ CRITICAL ACTION: Are you sure you want to finalize this audit for ${branch}?`)) return;

    let btn = document.getElementById('btnSubmitGeneralAudit');
    btn.innerText = "⏳ Syncing Database..."; btn.disabled = true;

    try {
        let auditCounts = [];
        let itemsAudited = 0;

        for (let i = 0; i < window.globalAuditItems.length; i++) {
            let item = window.globalAuditItems[i];
            
            // 🔥 THE FIX: Grab the exact value they typed from the screen!
            let inputEl = document.getElementById(`auditInput_${i}`);
            
            // 🚨 STRICT CHECK: If the box is blank, WE SKIP IT ENTIRELY! It will NOT affect accuracy.
            if (!inputEl || inputEl.value.trim() === "") continue;

            let rawVal = parseFloat(inputEl.value);
            itemsAudited++;

            let uomSelect = document.getElementById(`auditUom_${i}`);
            let convRate = 1;
            let displayUom = item.uom;

            if (uomSelect && uomSelect.tagName === 'SELECT') {
                let selOpt = uomSelect.options[uomSelect.selectedIndex];
                convRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
                displayUom = selOpt.text;
            }

            let physicalQty = rawVal * convRate;
            let noteText = `General Audit (${rawVal} ${displayUom})`;
            let variance = physicalQty - item.systemQty;

            // If a variance is detected, push it to the database
            if (variance !== 0) {
                await updateDoc(doc(db, "inventory", item.id), { currentStock: physicalQty });

                await addDoc(collection(db, "stock_logs"), {
                    branch: branch,
                    item: item.name,
                    uom: item.uom,
                    oldQty: item.systemQty,
                    newQty: physicalQty,
                    variance: variance,
                    type: "Manager General Audit",
                    note: noteText,
                    user: window.sessionUser ? window.sessionUser.cashierName : "Manager",
                    timestamp: serverTimestamp()
                });
            }

            // ONLY push items they actually counted into the accuracy scorecard!
            auditCounts.push({
                name: item.name,
                systemQty: item.systemQty,
                physicalQty: physicalQty
            });
        }

        // 🚨 PREVENT BLANK SUBMISSIONS
        if (itemsAudited === 0) {
            Swal.fire('No Items Audited', 'You left all inputs blank. Please enter the physical counts before syncing.', 'info');
            btn.innerText = "💾 Sync & Finalize Audit"; btn.disabled = false;
            return;
        }

        await addDoc(collection(db, "stock_counts"), {
            branch: branch,
            cashier: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp(),
            counts: auditCounts
        });

        alert(`✅ Audit Complete! ${itemsAudited} items were accurately audited and synced.`);
        document.getElementById('generalAuditModal').style.display = 'none';
        
        if (typeof window.loadInventoryAudits === 'function') window.loadInventoryAudits(); 
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
    if (!name) return Swal.fire('Error', 'Branch name is required!', 'error');
    
    if (window.globalActiveBranches.includes(name)) {
        return Swal.fire('Duplicate', 'A branch with this name already exists!', 'warning');
    }

    let btn = document.getElementById('btnSaveNewBranch');
    btn.innerText = "⏳ Provisioning..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "branches"), { name: name, isCore: false, createdAt: serverTimestamp() });
        
        // 🔥 UI UPGRADE: Beautiful Success Modal
        Swal.fire({
            title: '🎉 Branch Online!',
            text: `${name} is now officially integrated into the TAKODEÁL system!`,
            icon: 'success',
            confirmButtonColor: '#8b5cf6', // Matches your purple modal theme
            customClass: { popup: 'rounded-2xl shadow-xl' }
        });
        
        document.getElementById('addBranchModal').style.display = 'none';
        window.loadBranchManager();
    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to add branch.', 'error');
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

// ⚙️ CENTRAL SETTINGS CONTROLLER (WITH ROYALTY ENGINE)
window.openBranchSettings = function(docId) {
    let d = window.globalBranchData[docId];
    if (!d) return;

    document.getElementById('settingBranchId').value = docId;
    document.getElementById('branchSettingsTitle').innerText = `⚙️ ${d.name} Settings`;
    document.getElementById('settingAddress').value = d.address || '';
    document.getElementById('settingContact').value = d.contact || '';
    document.getElementById('settingWifi').value = d.wifi || '';
    document.getElementById('settingPrinterSize').value = d.printerSize || '58mm';
    
    // 🔥 NEW: Inject the Royalty Setting dynamically if it doesn't exist yet!
    let formContainer = document.getElementById('settingPrinterSize').parentElement.parentElement;
    if (!document.getElementById('settingRoyalty')) {
        formContainer.insertAdjacentHTML('beforeend', `
            <div style="margin-top: 15px; background: #fffbeb; padding: 15px; border: 1px dashed #fcd34d; border-radius: 8px;">
                <label style="font-size: 12px; font-weight: bold; color: #b45309; display: block; margin-bottom: 5px;">👑 Franchise Royalty Percentage (%)</label>
                <div style="font-size: 10px; color: #d97706; margin-bottom: 8px;">Enter 0 for company-owned branches. The system will auto-deduct this % from Gross Sales at shift close.</div>
                <input type="number" id="settingRoyalty" class="input-box" placeholder="e.g. 5" style="width: 100%; border-color: #fcd34d; font-weight: bold; color: #92400e;">
            </div>
        `);
    }
    document.getElementById('settingRoyalty').value = d.royaltyPercent || 0;

    document.getElementById('branchSettingsModal').style.display = 'flex';
};

window.saveBranchSettings = async function() {
    let docId = document.getElementById('settingBranchId').value;
    let payload = {
        address: document.getElementById('settingAddress').value.trim(),
        contact: document.getElementById('settingContact').value.trim(),
        wifi: document.getElementById('settingWifi').value.trim(),
        printerSize: document.getElementById('settingPrinterSize').value,
        royaltyPercent: parseFloat(document.getElementById('settingRoyalty').value) || 0
    };

    try {
        await updateDoc(doc(db, "branches", docId), payload);
        alert(`✅ Settings & Royalties pushed globally!`);
        document.getElementById('branchSettingsModal').style.display = 'none';
        window.loadBranchManager();
    } catch (e) { console.error(e); alert("Failed to push settings."); }
};

// 💉 THE DOM INJECTOR

// Fire the engine up as soon as the app loads!
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { 
        if (typeof window.loadBranchManager === 'function') window.loadBranchManager(); 
    }, 1500); 
});

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

// 💉 THE DOM INJECTOR (FRANCHISE LOCK UPGRADE)
window.injectDynamicBranchDropdowns = function() {
    const standardSelects = ['empBranchAssign', 'manAttBranch', 'newAccBranch', 'newBudgetBranch', 'newInvBranch', 'editInvBranch', 'batchBranch', 'dispFrom', 'dispTo'];
    const filterSelects = ['dashBranchFilter', 'invBranchFilter', 'zReadingBranchFilter', 'transferBranchFilter', 'branchAlertFilter', 'histBranchFilter', 'burnRateBranch', 'auditModalBranch', 'forecasterBranchSelect', 'aiBranchSelect'];
    
    let stdHtml = '';
    let filterHtml = '<option value="All">🌐 All Branches</option>';
    let plainFilterHtml = '<option value="">-- Choose Branch --</option>'; 

    // 🔥 PHASE 2: FRANCHISEE ISOLATION PROTOCOL
    let isFranchiseMode = window.sessionUser && window.sessionUser.isFranchisee;
    let franchiseBranch = window.sessionUser ? window.sessionUser.branch : null;

    if (isFranchiseMode && franchiseBranch) {
        // Build the HTML to ONLY contain their assigned branch
        let icon = "📍";
        let label = `${icon} ${franchiseBranch}`;
        stdHtml = `<option value="${franchiseBranch}">${franchiseBranch}</option>`;
        filterHtml = `<option value="${franchiseBranch}">${label}</option>`;
        plainFilterHtml = `<option value="${franchiseBranch}">${franchiseBranch}</option>`;
    } else {
        // Standard HQ view (builds all branches)
        window.globalActiveBranches.forEach(b => {
            let icon = b === "Main Office" ? "🏢" : "📍";
            let label = `${icon} ${b}`;
            stdHtml += `<option value="${b}">${b}</option>`;
            filterHtml += `<option value="${b}">${label}</option>`;
            plainFilterHtml += `<option value="${b}">${b}</option>`;
        });
    }

    // Inject into standard dropdowns and lock them if needed
    standardSelects.forEach(id => {
        let el = document.getElementById(id);
        if (el) { 
            let oldVal = el.value; 
            el.innerHTML = stdHtml; 
            if (!isFranchiseMode && oldVal) el.value = oldVal; 
            if (isFranchiseMode) { el.value = franchiseBranch; el.disabled = true; } // LOCK
        }
    });

    // Inject into filter dropdowns and lock them if needed
    filterSelects.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            let oldVal = el.value;
            if (id === 'burnRateBranch' || id === 'auditModalBranch' || id === 'forecasterBranchSelect') el.innerHTML = plainFilterHtml;
            else el.innerHTML = filterHtml;
            
            if (!isFranchiseMode && oldVal) el.value = oldVal;
            if (isFranchiseMode) { el.value = franchiseBranch; el.disabled = true; } // LOCK
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
window.categoryImages = {}; // Memory to store the category photos!

window.loadPosLayout = async function() {
    const listDiv = document.getElementById('posCategoryArrangementList');
    if (!listDiv) return;
    listDiv.innerHTML = '<div style="color: #64748b; text-align: center; padding: 20px;">Loading live menu categories...</div>';
    
    try {
        // 1. Fetch all categories AND grab their images!
        const menuSnap = await getDocs(collection(db, "menu"));
        let categories = new Set();
        
        menuSnap.forEach(d => {
            let data = d.data();
            let cat = data.category;
            if (cat) {
                let catTrimmed = cat.trim();
                categories.add(catTrimmed);
                // Save the first image we find for this category to act as its Thumbnail!
                if (data.image && !window.categoryImages[catTrimmed]) {
                    window.categoryImages[catTrimmed] = data.image;
                }
            }
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
        // Find the image, or use a beautiful default burger icon!
        let imgSrc = window.categoryImages[cat];
        let imgHtml = imgSrc 
            ? `<img src="${imgSrc}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover; border: 1px solid #cbd5e1; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">` 
            : `<div style="width: 45px; height: 45px; border-radius: 8px; background: #f8fafc; border: 1px solid #cbd5e1; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0;">🍔</div>`;

        html += `
            <div style="display: flex; align-items: center; gap: 15px; background: #f8fafc; padding: 12px 15px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <button onclick="window.moveLayout('${index}', -1)" style="background: white; border: 1px solid #94a3b8; color: #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">▲ UP</button>
                    <button onclick="window.moveLayout('${index}', 1)" style="background: white; border: 1px solid #94a3b8; color: #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">▼ DOWN</button>
                </div>
                ${imgHtml}
                <div style="font-weight: 900; color: #1e293b; font-size: 16px; flex-grow: 1;">${cat}</div>
                <div style="font-weight: bold; font-size: 12px; color: #94a3b8; background: #e2e8f0; padding: 4px 8px; border-radius: 6px;">Pos: ${index + 1}</div>
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

// ==========================================
// 🗑️ MENU EDITOR: DELETE ITEM ENGINE
// ==========================================
window.deleteMenuItem = async function(docId) {
    // Beautiful SweetAlert Confirmation
    const confirmDelete = await Swal.fire({
        title: 'Delete Menu Item?',
        text: "Are you sure? This will remove the item from the POS and the Customer App permanently. This action cannot be undone.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626', // Red
        cancelButtonColor: '#94a3b8',  // Gray
        confirmButtonText: 'Yes, Delete it!',
        customClass: { popup: 'rounded-2xl shadow-2xl' }
    });

    if (confirmDelete.isConfirmed) {
        Swal.fire({ title: 'Deleting...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
        
        try {
            // Delete from Firebase
            await deleteDoc(doc(db, "menu", docId));
            
            Swal.fire({
                title: 'Deleted!',
                text: 'The item has been removed from your menu.',
                icon: 'success',
                confirmButtonColor: '#16a34a',
                customClass: { popup: 'rounded-2xl' }
            });
            
            // Reload the UI
            if (typeof window.loadMenuEditor === 'function') {
                window.loadMenuEditor();
            } else {
                // Fallback UI refresh
                let menuTab = document.querySelector('[onclick*="view-menu"]');
                if (menuTab) menuTab.click();
            }
            
        } catch (error) {
            console.error("Error deleting menu item: ", error);
            Swal.fire('Error', 'Failed to delete the item. Check your connection.', 'error');
        }
    }
};

// ==========================================
// 🧠 SMART AI FINANCIAL ADVISOR & CHART ENGINE
// ==========================================
window.revenueChartInstance = null;

window.loadSmartAIInsights = async function() {
    let adviceBox = document.getElementById('aiAdviceBox');
    if(adviceBox) adviceBox.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">🤖 Analyzing your business data...</div>';

    try {
        let thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // 1. Fetch Sales
        const txQ = query(collection(db, "transactions"), where("timestamp", ">=", thirtyDaysAgo));
        const txSnap = await getDocs(txQ);
        
        let dailySales = {};
        let totalNetSales = 0;
        let totalCogs = 0;

        txSnap.forEach(doc => {
            let tx = doc.data();
            if (tx.status !== 'Voided') {
                let dateStr = tx.timestamp.toDate().toLocaleDateString('en-US', {month:'short', day:'numeric'});
                if (!dailySales[dateStr]) dailySales[dateStr] = 0;
                
                dailySales[dateStr] += (parseFloat(tx.netTotal) || 0);
                totalNetSales += (parseFloat(tx.netTotal) || 0);
                totalCogs += (parseFloat(tx.totalCogs) || 0);
            }
        });

        // 2. Fetch Expenses
        const expQ = query(collection(db, "expenses"), where("timestamp", ">=", thirtyDaysAgo));
        const expSnap = await getDocs(expQ);
        let totalExpenses = 0;
        expSnap.forEach(e => totalExpenses += (parseFloat(e.data().amount) || 0));

        // 3. Render 30-Day Trend Chart
        let labels = Object.keys(dailySales);
        let dataPoints = Object.values(dailySales);
        
        let ctx = document.getElementById('revenueTrendChart');
        if (ctx) {
            if (window.revenueChartInstance) window.revenueChartInstance.destroy();
            window.revenueChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Gross Revenue (Last 30 Days)',
                        data: dataPoints,
                        borderColor: '#e5a93d',
                        backgroundColor: 'rgba(229, 169, 61, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // 4. THE AI ADVISOR ALGORITHM
        let netProfit = totalNetSales - totalCogs - totalExpenses;
        let profitMargin = totalNetSales > 0 ? (netProfit / totalNetSales) * 100 : 0;
        
        let aiAdvice = '';
        let aiColor = '#16a34a';

        if (profitMargin < 15) {
            aiColor = '#dc2626';
            aiAdvice = `
                <strong style="color: #dc2626;">⚠️ AI ALERT: Barely Surviving (Margin: ${profitMargin.toFixed(1)}%)</strong><br><br>
                Your operating expenses are eating your profits. You made ₱${totalNetSales.toLocaleString()}, but after COGS (₱${totalCogs.toLocaleString()}) and Expenses (₱${totalExpenses.toLocaleString()}), you only kept ₱${netProfit.toLocaleString()}.<br><br>
                <strong>💡 AI Action Plan:</strong><br>
                1. 🛑 Stop non-essential petty cash expenses immediately.<br>
                2. 📉 Audit your Waste Logs. High COGS means food is spoiling or portion sizes are too big.<br>
                3. 📱 <strong>Video Idea:</strong> Do a "Behind the Scenes" TikTok showing how much meat goes into your Takoyaki to justify prices without spending on Ads.
            `;
        } else if (profitMargin >= 15 && profitMargin < 35) {
            aiColor = '#d97706';
            aiAdvice = `
                <strong style="color: #d97706;">⚖️ AI INSIGHT: Stable but Stagnant (Margin: ${profitMargin.toFixed(1)}%)</strong><br><br>
                Your business is healthy, but we can squeeze more profit out of it.<br><br>
                <strong>💡 AI Action Plan:</strong><br>
                1. 🎯 Upsell! Train cashiers to push "Extra Cheese" and Drinks. Add-ons are 90% profit margin.<br>
                2. 📈 <strong>FB Ads Strategy:</strong> Run a ₱150/day Facebook Ad targeting a 5km radius around your worst-performing branch promoting a "Buy 1 Get 1 Drinks" deal during dead hours (2 PM - 5 PM).
            `;
        } else {
            aiColor = '#16a34a';
            aiAdvice = `
                <strong style="color: #16a34a;">🚀 AI INSIGHT: Highly Profitable! (Margin: ${profitMargin.toFixed(1)}%)</strong><br><br>
                Excellent financial health! Your expenses are low and sales are booming.<br><br>
                <strong>💡 AI Action Plan:</strong><br>
                1. 🏦 Save ${Math.floor(netProfit * 0.4).toLocaleString()} in a high-yield digital bank to prepare for a new branch.<br>
                2. 📱 <strong>Video Idea:</strong> Post a hype video of your long lines or sold-out signs. "Fear of Missing Out" (FOMO) marketing works best when you are already winning!
            `;
        }

        // Add Google Calendar Sync Button to Attendance
        let calendarIntegration = `
            <div style="margin-top: 20px; padding: 15px; background: #e0f2fe; border: 1px dashed #0284c7; border-radius: 8px;">
                <h4 style="margin:0 0 5px 0; color: #0369a1;">📅 Google Calendar Sync (Attendance)</h4>
                <p style="font-size:12px; color: #0c4a6e; margin-bottom: 10px;">Click below to generate a Zapier Webhook URL or manually push today's attendance to your Google Calendar.</p>
                <button onclick="window.open('https://calendar.google.com/calendar/r/eventedit?text=Takodeal+Shift+Review&details=Review+today%27s+attendance+logs+in+the+Manager+App', '_blank')" style="background: white; border: 1px solid #0284c7; padding: 8px 15px; border-radius: 6px; font-weight: bold; color: #0369a1; cursor: pointer;">+ Add Reminder to Google Calendar</button>
            </div>
        `;

        if(adviceBox) adviceBox.innerHTML = `
            <div style="background: #f8fafc; border: 2px solid ${aiColor}; padding: 20px; border-radius: 12px; font-size: 14px; line-height: 1.6;">
                ${aiAdvice}
                ${calendarIntegration}
            </div>
        `;

    } catch (e) {
        console.error(e);
        if(adviceBox) adviceBox.innerHTML = '<div style="color: red;">Error loading AI Insights.</div>';
    }
};

// ==========================================
// 🔍 FORENSIC ITEM TRACE LEDGER ENGINE (INDEX-FREE CRASH FIX)
// ==========================================
window.openItemLedger = async function(branch, itemName) {
    document.getElementById('itemLedgerModal').style.display = 'flex';
    document.getElementById('ledgerModalSubtitle').innerText = `${itemName} | ${branch}`;
    const tbody = document.getElementById('itemLedgerBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 30px;">⏳ Compiling forensic data...</td></tr>';

    try {
        const invQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", itemName));
        const invSnap = await getDocs(invQ);
        let currentStock = 0; let uom = '';
        if (!invSnap.empty) {
            currentStock = parseFloat(invSnap.docs[0].data().currentStock) || 0;
            uom = invSnap.docs[0].data().baseUom || invSnap.docs[0].data().uom || '';
        }
        
        let curStockEl = document.getElementById('ledgerCurrentStock');
        if (curStockEl) curStockEl.innerText = `${currentStock.toFixed(2)} ${uom}`;

        // 🔥 THE INDEX-FREE FIX: Local Sorting for Dispatch Logs
        let lastDelHtml = '<span style="color:#94a3b8; font-style:italic;">No deliveries recorded.</span>';
        if (branch !== "Main Office") {
            // We removed the orderBy() here to prevent Firebase from crashing!
            const delQ = query(collection(db, "dispatch_logs"), where("toBranch", "==", branch), where("item", "==", itemName));
            const delSnap = await getDocs(delQ);
            
            let delLogs = [];
            delSnap.forEach(d => {
                let data = d.data();
                if (data.status === "Received") delLogs.push(data);
            });
            
            // 🧠 Javascript does the heavy sorting safely in the background
            delLogs.sort((a, b) => {
                let timeA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime()) : 0;
                let timeB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime()) : 0;
                return timeB - timeA;
            });
            
            if (delLogs.length > 0) {
                let lastDel = delLogs[0];
                let delDate = lastDel.timestamp ? lastDel.timestamp.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : lastDel.date;
                lastDelHtml = `<strong style="color: #0ea5e9;">${delDate}</strong> <span style="font-size: 11px; color: #64748b;">(Qty: ${lastDel.receivedQty} ${lastDel.uom})</span>`;
            }
        } else {
            lastDelHtml = '<span style="color:#64748b; font-size:11px;">(HQ Source)</span>';
        }
        
        if (curStockEl && curStockEl.parentNode) {
            if (!document.getElementById('ledgerLastDeliveryUi')) {
                let uiDiv = document.createElement('div');
                uiDiv.id = 'ledgerLastDeliveryUi';
                uiDiv.style.cssText = "margin-top: 10px; font-size: 13px; color: #475569; border-top: 1px dashed #cbd5e1; padding-top: 10px;";
                curStockEl.parentNode.appendChild(uiDiv);
            }
            document.getElementById('ledgerLastDeliveryUi').innerHTML = `Last Branch Delivery: ${lastDelHtml}`;
        }

        let headerRow = tbody.previousElementSibling.querySelector('tr');
        if (headerRow) {
            headerRow.innerHTML = `
                <th style="padding: 10px; color: #475569; text-align: left;">Date & Time</th>
                <th style="padding: 10px; color: #475569; text-align: left;">User</th>
                <th style="padding: 10px; color: #475569; text-align: left;">Action Type</th>
                <th style="padding: 10px; color: #475569; text-align: right;">Old Qty</th>
                <th style="padding: 10px; color: #475569; text-align: right;">Variance</th>
                <th style="padding: 10px; color: #0f766e; text-align: right;">New Qty</th>
                <th style="padding: 10px; color: #475569; text-align: left; padding-left: 20px;">Notes</th>
            `;
        }

        // 🔥 THE INDEX-FREE FIX: Local Sorting for Stock Logs
        // We removed orderBy("timestamp", "desc") to prevent the Firebase crash!
        const logQ = query(collection(db, "stock_logs"), where("branch", "==", branch), where("item", "==", itemName));
        const logSnap = await getDocs(logQ);

        let logsArray = [];
        logSnap.forEach(doc => logsArray.push(doc.data()));

        // 🧠 Javascript takes over the sorting mathematically!
        logsArray.sort((a, b) => {
            let timeA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime()) : 0;
            let timeB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime()) : 0;
            return timeB - timeA;
        });

        let runningNewQty = currentStock;
        let lifetimeBought = 0;

        logsArray.forEach(d => {
            let variance = parseFloat(d.variance) || 0;
            let type = d.type || "Unknown";

            // 🔥 CRITICAL FIX: Trust the historical snapshot stored in Firebase!
            // Do not calculate backwards, as silent deductions will corrupt the math!
            d._renderNew = d.newQty !== undefined ? parseFloat(d.newQty) : runningNewQty;
            d._renderOld = d.oldQty !== undefined ? parseFloat(d.oldQty) : (d._renderNew - variance);

            // Update running qty just as a fallback for extremely old legacy logs
            runningNewQty = d._renderOld; 

            if (variance > 0 && (type.includes("Restock") || type.includes("Delivery") || type.includes("Received") || type.includes("Purchase"))) {
                lifetimeBought += variance;
            }
        });

        let html = '';
        logsArray.forEach(d => {
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            let variance = parseFloat(d.variance) || 0;
            let type = d.type || "Unknown";
            
            let varColor = variance > 0 ? '#16a34a' : (variance < 0 ? '#dc2626' : '#64748b');
            let varText = variance > 0 ? `+${variance}` : variance;
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 10px; color: #64748b; font-size: 11px;">${dateStr}</td>
                    <td style="padding: 10px; font-weight: bold; color: #334155;">${d.user || 'System'}</td>
                    <td style="padding: 10px;"><span style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #475569;">${type}</span></td>
                    <td style="padding: 10px; text-align: right; color: #94a3b8; font-weight: bold;">${d._renderOld.toFixed(2)}</td>
                    <td style="padding: 10px; font-weight: 900; color: ${varColor}; text-align: right;">${varText}</td>
                    <td style="padding: 10px; font-weight: 900; color: #0f766e; text-align: right;">${d._renderNew.toFixed(2)}</td>
                    <td style="padding: 10px; font-size: 11px; color: #64748b; font-style: italic; padding-left: 20px;">${d.note || '-'}</td>
                </tr>
            `;
        });

        let ltBoughtEl = document.getElementById('ledgerLifetimeBought');
        if (ltBoughtEl) ltBoughtEl.innerText = `${lifetimeBought.toFixed(2)} ${uom}`;
        
        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center" style="padding: 30px; color: #94a3b8;">No historical data found.</td></tr>';

    } catch (e) {
        console.error("Item Ledger Error:", e);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 30px; color: red;">Failed to load trace data. Check console.</td></tr>';
    }
};

// ==========================================
// ➕ DYNAMIC PROFILE DEDUCTION BUILDER
// ==========================================
window.addCustomDeductionRow = function(name = '', amount = '') {
    let container = document.getElementById('customDeductionsContainer');
    let div = document.createElement('div');
    div.className = 'custom-deduct-row';
    div.style.display = 'flex';
    div.style.gap = '10px';
    div.innerHTML = `
        <input type="text" class="cd-name input-box" placeholder="Name (e.g. Wi-Fi)" value="${name}" style="flex: 2; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none; background: white;">
        <input type="number" class="cd-amount input-box" placeholder="Amount (₱)" value="${amount}" style="flex: 1; padding: 10px; border: 1px solid #fca5a5; border-radius: 6px; outline: none; background: #fef2f2; color: #b91c1c; font-weight: bold;">
        <button type="button" onclick="this.parentElement.remove()" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 6px; padding: 0 15px; cursor: pointer; font-weight: bold; transition: 0.2s;" title="Remove Row">✖</button>
    `;
    container.appendChild(div);
};

// ==========================================
// ➕ DYNAMIC INVENTORY CATEGORY BUILDER
// ==========================================
window.handleCategoryDropdown = function(selectElement) {
    if (selectElement.value === "ADD_NEW") {
        let newCat = prompt("Enter the name of your new custom category:");
        
        if (newCat && newCat.trim() !== "") {
            newCat = newCat.trim();
            
            // Create the new option
            let newOption = document.createElement("option");
            newOption.value = newCat;
            newOption.innerText = newCat;
            
            // Insert it right before the "+ Add Custom Category..." button
            selectElement.insertBefore(newOption, selectElement.lastElementChild);
            
            // Auto-select the newly created category!
            selectElement.value = newCat;
        } else {
            // If they click cancel or leave it blank, revert back to the top option
            selectElement.selectedIndex = 0;
        }
    }
};

// ==========================================
// 📜 OFFBOARDING & COE GENERATOR ENGINE
// ==========================================
window.processResignation = async function() {
    let docId = document.getElementById('empProfileId').value;
    let name = document.getElementById('empFullName').value.trim();
    let dateHired = document.getElementById('empDateHired').value;
    let role = document.getElementById('empRole').value;
    
    if (!docId) { 
        Swal.fire('Error', 'Please save this employee to the database first before offboarding them.', 'error'); 
        return; 
    }

    const { value: reason, isConfirmed } = await Swal.fire({
        title: 'Offboard Staff Member?',
        html: `Process resignation for <strong>${name}</strong>?<br><br><span style="font-size: 13px; color: #64748b;">This will immediately REVOKE their POS login PIN so they cannot access the registers, and it will automatically generate their Certificate of Employment.</span>`,
        input: 'text',
        inputPlaceholder: 'Reason (e.g. Finished Contract, Resigned)',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'Yes, Offboard & Generate COE',
        customClass: { popup: 'rounded-2xl shadow-2xl' }
    });

    if (isConfirmed) {
        Swal.fire({ title: 'Processing Offboarding...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});
        
        try {
            // 1. Revoke their POS Access in Firebase
            await updateDoc(doc(db, "cashiers", docId), {
                pin: 'REVOKED', // Changes PIN to letters so the Numpad can never log them in again!
                status: 'Resigned',
                resignationReason: reason || 'N/A',
                dateResigned: new Date().toISOString().split('T')[0]
            });
            
            // 2. Generate and Download the COE Image
            window.generateCOEImage(name, dateHired, role);
            
            // 3. Refresh the UI
            document.getElementById('employeeProfileModal').style.display = 'none';
            if (typeof window.loadHRModule === 'function') window.loadHRModule(); 
            
            Swal.fire('Success!', `${name} has been successfully offboarded. Their login is revoked, and the COE is downloading!`, 'success');
        } catch(e) {
            console.error(e);
            Swal.fire('Error', 'Failed to process resignation. Check your internet connection.', 'error');
        }
    }
};

window.generateCOEImage = function(name, dateHired, role) {
    let template = document.getElementById('coeTemplate');
    template.style.display = 'block'; // Briefly show it to the camera
    
    // Inject the data
    document.getElementById('coeName').innerText = name.toUpperCase();
    document.getElementById('coeRole').innerText = role || "Staff Member";
    
    // Format the dates beautifully
    let hiredDate = dateHired ? new Date(dateHired).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "their start date";
    let todayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    document.getElementById('coeDateHired').innerText = hiredDate;
    document.getElementById('coeDateToday').innerText = todayDate;
    
    // Take the screenshot!
    html2canvas(template, { scale: 2, backgroundColor: "#ffffff" }).then(canvas => {
        let link = document.createElement('a');
        link.download = `COE_${name.replace(/\s+/g, '_')}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        template.style.display = 'none'; // Hide it again so it doesn't mess up your screen!
    });
};

// ========================================================
// 📦 STORE USE & CONSUMABLES HISTORY VIEWER
// ========================================================
window.viewStoreUseLogs = async function() {
    Swal.fire({ title: 'Fetching Logs...', didOpen: () => { Swal.showLoading(); } });

    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    let selectedBranch = isFranchisee ? window.sessionUser.branch : "All"; 

    try {
        let q = query(collection(db, "store_use_logs"), orderBy("timestamp", "desc"), limit(50));
        if (isFranchisee) {
            q = query(collection(db, "store_use_logs"), where("branch", "==", selectedBranch), orderBy("timestamp", "desc"), limit(50));
        }

        const snap = await getDocs(q);
        
        let html = `
        <div style="max-height: 50vh; overflow-y: auto; text-align: left; margin-top: 10px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead style="position: sticky; top: 0; background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                    <tr style="color: #64748b; border-bottom: 2px solid #e2e8f0;">
                        <th style="padding: 10px; text-align: left;">Date & Time</th>
                        <th style="padding: 10px; text-align: left;">Branch</th>
                        <th style="padding: 10px; text-align: left;">Items Used</th>
                        <th style="padding: 10px; text-align: right;">Total Cost Hit</th>
                        <th style="padding: 10px; text-align: left;">Logged By</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (snap.empty) {
            html += `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8; font-weight: bold;">No store use logs found.</td></tr>`;
        } else {
            snap.forEach(doc => {
                let d = doc.data();
                let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Unknown';
                let itemsList = d.items ? d.items.map(i => `<span style="color:#0ea5e9; font-weight:bold;">${i.qty}x</span> ${i.name}`).join('<br>') : 'Unknown';

                html += `
                <tr style="border-bottom: 1px solid #f8fafc;">
                    <td style="padding: 12px 10px; color: #475569;">${dateStr}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #0f766e;">${d.branch}</td>
                    <td style="padding: 12px 10px;">${itemsList}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #ef4444; text-align: right;">₱${parseFloat(d.totalCost||0).toFixed(2)}</td>
                    <td style="padding: 12px 10px; color: #64748b;">👤 ${d.loggedBy}</td>
                </tr>`;
            });
        }

        html += `</tbody></table></div>`;

        Swal.fire({
            title: '📦 Store Use & Consumables Log',
            html: html, width: '800px', showCloseButton: true,
            confirmButtonText: 'Close Viewer', confirmButtonColor: '#0f766e',
            customClass: { popup: 'rounded-2xl shadow-xl' }
        });

    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to load history logs.', 'error');
    }
};

// ========================================================
// 🔔 REAL-TIME LOGISTICS NOTIFICATION ENGINE
// ========================================================
window.poUnsubscribe = null;

window.startPOListener = function() {
    if (window.poUnsubscribe) window.poUnsubscribe(); // Clear old listener

    let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
    let myBranch = window.sessionUser ? window.sessionUser.branch : "Unknown";

    // 🔒 Listen for Pending Requests (Master hears all, Franchisee hears their own)
    let q = query(collection(db, "purchase_orders"), where("status", "==", "Pending"));
    if (isFranchisee) {
        q = query(collection(db, "purchase_orders"), where("branch", "==", myBranch), where("status", "==", "Pending"));
    }

    let initialLoad = true;

    window.poUnsubscribe = window.onSnapshot(q, (snapshot) => {
        let pendingCount = snapshot.docs.length;
        let newOrderArrived = false;

        // Check if the change is a BRAND NEW request (not just the app loading)
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" && !initialLoad) {
                newOrderArrived = true;
            }
        });

        // 1. Update the Red Badge on the Sidebar
        let badge = document.getElementById('poNotificationBadge');
        if (badge) {
            if (pendingCount > 0) {
                badge.innerText = pendingCount;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        // 2. Auto-Refresh the Dispatch Table if the Manager is currently looking at it!
        let dispatchView = document.getElementById('view-dispatch');
        if (dispatchView && dispatchView.classList.contains('active')) {
            if (typeof window.loadDispatchLogs === 'function') window.loadDispatchLogs();
        }

        // 3. Trigger the DING! and the Pop-up Toast
        if (newOrderArrived) {
            window.playManagerPing();
            Swal.fire({
                title: '🔔 New Stock Request!',
                text: 'A branch just reported an inventory variance or sent a Purchase Order.',
                icon: 'info',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 5000,
                customClass: { popup: 'shadow-2xl border border-blue-200' }
            });
        }

        initialLoad = false;
    });
};

// 🔊 The Audio Engine (Upgraded "Ding-Dong" Bell Sound)
window.playManagerPing = function() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();

        // Note 1 (Ding)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.type = 'sine'; // 🔥 FIXED: 'sine' is universally supported
        osc1.frequency.setValueAtTime(987.77, ctx.currentTime); 
        gain1.gain.setValueAtTime(1, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.4);

        // Note 2 (Dong)
        setTimeout(() => {
            try {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.type = 'sine'; // 🔥 FIXED
                osc2.frequency.setValueAtTime(1318.51, ctx.currentTime); 
                gain2.gain.setValueAtTime(1, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
                osc2.start(ctx.currentTime);
                osc2.stop(ctx.currentTime + 0.6);
            } catch(e) {}
        }, 150);
    } catch (e) { 
        console.log("Audio blocked by browser policy. Click anywhere on the screen first."); 
    }
};

// ========================================================
// ⚖️ HR DISCIPLINARY & SANCTION ENGINE (CRASH-FREE)
// ========================================================

// 🔥 THE BULLETPROOF TAB SWITCHER
window.switchPayrollTab = function(tabName) {
    // 1. If it's a separate page, use your native page switcher to jump there!
    if (tabName === 'Schedule') { window.switchView('schedule'); return; }
    if (tabName === 'Ledger') { window.switchView('ledger'); return; }

    let viewPayroll = document.getElementById('view-payroll');
    if (!viewPayroll) return;

    let sancSec = document.getElementById('payrollSectionSanctions');
    
    // Selects the Payslip and Attendance boxes (they have the "card" class)
    let feedCards = viewPayroll.querySelectorAll('.card'); 

    // Reset tab buttons inside the HR Hub
    viewPayroll.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = '#64748b';
        btn.style.borderBottomColor = 'transparent';
    });

    // Highlight active tab
    let activeBtn = document.getElementById('tabHr' + tabName);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.color = '#0f766e';
        activeBtn.style.borderBottomColor = '#0f766e';
    }

    // Toggle visibility seamlessly
    if (tabName === 'Feed') {
        if (sancSec) sancSec.style.display = 'none';
        feedCards.forEach(card => card.style.display = 'block');
    } else if (tabName === 'Sanctions') {
        feedCards.forEach(card => card.style.display = 'none');
        if (sancSec) {
            sancSec.style.display = 'block';
            if (typeof window.loadSanctionsDashboard === 'function') window.loadSanctionsDashboard();
        }
    }
};

// Make sure to populate the Branch Filter when the page loads
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        let filter = document.getElementById('sanctionBranchFilter');
        if (filter && filter.options.length <= 1 && window.globalActiveBranches) {
            let html = '<option value="All">All Branches</option>';
            window.globalActiveBranches.forEach(b => html += `<option value="${b}">${b}</option>`);
            filter.innerHTML = html;
            
            // Lock the dropdown if a Franchisee is viewing it
            if (window.sessionUser && window.sessionUser.isFranchisee) {
                filter.value = window.sessionUser.branch;
                filter.disabled = true;
            }
        }
    }, 2000);
});

window.loadSanctionsDashboard = async function() {
    const tbody = document.getElementById('sanctionsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading disciplinary records...</td></tr>';

    let branchFilter = document.getElementById('sanctionBranchFilter') ? document.getElementById('sanctionBranchFilter').value : "All";

    try {
        let q = query(collection(db, "hr_sanctions"), orderBy("timestamp", "desc"));
        if (branchFilter !== "All") {
            q = query(collection(db, "hr_sanctions"), where("branch", "==", branchFilter), orderBy("timestamp", "desc"));
        }
        
        const snap = await getDocs(q);
        let html = '';

        snap.forEach(docSnap => {
            let d = docSnap.data();
            d.id = docSnap.id; // Save ID for the printer
            
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
            
            let statusBadge = '';
            let printBtn = '';

            if (d.status === 'Pending Reply') {
                statusBadge = `<span style="background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; display: inline-block; margin-bottom: 4px;">⏳ Awaiting Staff Reply</span><br><span style="font-size: 11px; color: #64748b;">(POS is locked for this user)</span>`;
            } else if (d.status === 'Replied' || d.status === 'Resolved') {
                
                // Show the staff's reply and their digital signature!
                let signatureHtml = d.signatureBase64 
                    ? `<img src="${d.signatureBase64}" style="height: 40px; border-bottom: 1px solid #cbd5e1; margin-top: 5px; display: block; border-radius: 4px; background: white;">` 
                    : '';

                statusBadge = `
                    <span style="background: ${d.status === 'Resolved' ? '#dcfce7' : '#e0f2fe'}; color: ${d.status === 'Resolved' ? '#16a34a' : '#0284c7'}; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; display: inline-block; margin-bottom: 4px;">
                        ${d.status === 'Resolved' ? '✅ Resolved / Closed' : '📩 Staff Replied'}
                    </span><br>
                    <div style="font-size: 12px; color: #334155; font-style: italic; border-left: 2px solid ${d.status === 'Resolved' ? '#16a34a' : '#0ea5e9'}; padding-left: 8px; margin-top: 4px; max-width: 250px; white-space: normal;">
                        "${d.staffReply}"
                        ${signatureHtml}
                    </div>
                `;

                // 🔥 THE NEW PRINT/PDF BUTTON (Only available after they sign & reply!)
                let safeDocStr = encodeURIComponent(JSON.stringify(d));
                printBtn = `<button onclick="window.printFormalNTE('${safeDocStr}')" style="background: #f8fafc; color: #0f172a; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%; margin-top: 5px;">📄 Export as PDF / Print</button>`;
            }

            let severityColor = d.severity.includes('Warning') ? '#ea580c' : '#dc2626';

            let actionBtn = '';
            if (d.status === 'Replied') {
                actionBtn = `<button onclick="window.resolveSanction('${docSnap.id}', '${d.staffName}')" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%;">Accept & Resolve</button>`;
            } else if (d.status === 'Resolved') {
                actionBtn = `<button onclick="window.deleteSanction('${docSnap.id}')" style="background: white; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%;">🗑️ Delete Record</button>`;
            } else {
                actionBtn = `<button onclick="window.deleteSanction('${docSnap.id}')" style="background: white; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%;">🗑️ Cancel Notice</button>`;
            }
            // View Evidence Button
            let evidenceBtn = d.evidencePhoto 
                ? `<button onclick="window.viewSelfie('${d.evidencePhoto}', 'Evidence: ${d.type}')" style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px; width: 100%; margin-top: 5px;">📸 View Evidence</button>` 
                : '';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 15px; color: #64748b; font-size: 12px;">${dateStr}</td>
                    <td style="padding: 15px;">
                        <strong style="color: #0f172a; font-size: 14px;">👤 ${d.staffName}</strong><br>
                        <span style="font-size: 11px; color: #94a3b8;">${d.branch}</span>
                    </td>
                    <td style="padding: 15px;">
                        <strong style="color: #334155;">${d.type}</strong><br>
                        <span style="font-size: 11px; color: #64748b; font-style: italic; max-width: 200px; display: inline-block;">"${d.details}"</span>
                    </td>
                    <td style="padding: 15px;"><strong style="color: ${severityColor};">${d.severity}</strong></td>
                    <td style="padding: 15px;">${statusBadge}</td>
                    <td style="padding: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            ${actionBtn}
                            ${printBtn}
                            ${evidenceBtn}
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 40px; color: #64748b;">No disciplinary records found.</td></tr>';
    } catch (e) {
        console.error("Sanctions Load Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading data.</td></tr>';
    }
};

// ========================================================
// 🖨️ THE FORMAL NTE DOCUMENT GENERATOR (LEGAL FORMAT)
// ========================================================
window.printFormalNTE = function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    let issueDate = d.timestamp ? new Date(d.timestamp.seconds * 1000).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown Date';
    let repliedDate = d.repliedAt ? new Date(d.repliedAt.seconds * 1000).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
    
    // Open a new hidden window optimized specifically for A4 printing
    let printWindow = window.open('', '', 'width=800,height=900');
    
    let html = `
        <html>
        <head>
            <title>Official Record - ${d.staffName}</title>
            <style>
                body { font-family: 'Times New Roman', serif; margin: 40px; color: #000; line-height: 1.6; }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
                .title { font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 30px; letter-spacing: 1px; text-transform: uppercase; }
                .field-row { margin-bottom: 10px; }
                .field-label { font-weight: bold; width: 150px; display: inline-block; }
                .box { border: 1px solid #000; padding: 15px; margin-bottom: 25px; min-height: 80px; background: #fff; }
                .signature-section { display: flex; justify-content: space-between; margin-top: 50px; }
                .sig-box { width: 45%; text-align: center; }
                .sig-line { border-top: 1px solid #000; margin-top: 60px; padding-top: 5px; font-weight: bold; }
                
                @media print {
                    body { margin: 0; padding: 20px; }
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1 style="margin:0; font-size: 32px; letter-spacing: 3px; font-family: Arial, sans-serif;">TAKODEÁL</h1>
                <div style="font-size: 14px; font-family: Arial, sans-serif; color: #555;">Human Resources Department • ${d.branch} Branch</div>
            </div>

            <div class="title">OFFICIAL DISCIPLINARY RECORD / NOTICE TO EXPLAIN</div>

            <div class="field-row"><span class="field-label">Date Issued:</span> ${issueDate}</div>
            <div class="field-row"><span class="field-label">To (Employee):</span> <strong>${d.staffName}</strong></div>
            <div class="field-row"><span class="field-label">From (Manager):</span> ${d.issuedBy || 'Management'}</div>
            <div class="field-row"><span class="field-label">Violation Type:</span> ${d.type}</div>
            <div class="field-row"><span class="field-label">Severity Level:</span> <strong style="text-transform: uppercase;">${d.severity}</strong></div>

            <p style="margin-top: 30px; font-weight: bold;">I. INCIDENT REPORT (MANAGEMENT)</p>
            <div class="box">
                ${d.details}
            </div>

            <p style="margin-top: 20px; font-weight: bold;">II. EMPLOYEE WRITTEN EXPLANATION</p>
            <div style="font-size: 12px; margin-bottom: 5px;">Submitted digitally via POS System on: ${repliedDate}</div>
            <div class="box">
                ${d.staffReply}
            </div>

            <div class="signature-section">
                <div class="sig-box">
                    <img src="${d.signatureBase64}" style="height: 60px; display: block; margin: 0 auto -10px auto;">
                    <div class="sig-line">${d.staffName}</div>
                    <div style="font-size: 12px;">Employee Signature / Date</div>
                </div>
                
                <div class="sig-box">
                    <div class="sig-line">${d.issuedBy || 'Management'}</div>
                    <div style="font-size: 12px;">Authorized Management Signature</div>
                </div>
            </div>

            <div style="margin-top: 50px; text-align: center; font-size: 10px; color: #666; border-top: 1px dashed #ccc; padding-top: 10px;">
                * This document was generated electronically through the Takodeal Operating System and constitutes a formal HR record. *<br>
                Record ID: ${d.id}
            </div>
            
            <script>
                // Automatically open the print dialog!
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
};

window.openIssueSanctionModal = async function() {
    document.getElementById('issueSanctionModal').style.display = 'flex';
    document.getElementById('sanctionDetails').value = '';
    
    let select = document.getElementById('sanctionStaffSelect');
    select.innerHTML = '<option value="">Loading staff...</option>';
    
    try {
        const snap = await getDocs(collection(db, "cashiers"));
        let html = '<option value="">-- Select Staff Member --</option>';
        let staffList = [];
        
        let branchFilter = document.getElementById('sanctionBranchFilter') ? document.getElementById('sanctionBranchFilter').value : "All";
        let isFranchisee = window.sessionUser && window.sessionUser.isFranchisee;
        
        snap.forEach(doc => {
            let data = doc.data();
            // Filter list to only show staff in the relevant branch!
            if (branchFilter !== "All" && data.branch !== branchFilter) return;
            if (isFranchisee && data.branch !== window.sessionUser.branch) return;
            
            staffList.push({ name: data.cashierName, branch: data.branch });
        });
        
        staffList.sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
            html += `<option value="${s.name}" data-branch="${s.branch}">${s.name} (${s.branch})</option>`;
        });
        
        select.innerHTML = html;
    } catch (e) {
        console.error("Staff Load Error:", e);
        select.innerHTML = '<option value="">Error loading staff.</option>';
    }
};

window.submitNewSanction = async function() {
    let selectEl = document.getElementById('sanctionStaffSelect');
    if (!selectEl.value) return alert("Please select a staff member.");
    
    let staffName = selectEl.value;
    let branch = selectEl.options[selectEl.selectedIndex].getAttribute('data-branch');
    let type = document.getElementById('sanctionType').value;
    let severity = document.getElementById('sanctionSeverity').value;
    let details = document.getElementById('sanctionDetails').value.trim();

    if (!details) return alert("Please provide details of the incident.");

    let btn = document.getElementById('btnSaveSanction');
    btn.innerText = "⏳ Uploading & Issuing..."; btn.disabled = true;

    try {
        let evidenceUrl = "";
        let fileInput = document.getElementById('sanctionEvidencePhoto');
        
        // 🔥 UPLOAD EVIDENCE PHOTO TO STORAGE IF ATTACHED
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `hr_evidence/incident_${Date.now()}.${fileExt}`;
            const storageReference = ref(window.storage, fileName);
            const snapshot = await uploadBytes(storageReference, file);
            evidenceUrl = await getDownloadURL(snapshot.ref);
        }

        await addDoc(collection(db, "hr_sanctions"), {
            staffName: staffName,
            branch: branch,
            type: type,
            severity: severity,
            details: details,
            evidencePhoto: evidenceUrl, // Save the photo link!
            status: "Pending Reply", 
            issuedBy: window.sessionUser ? window.sessionUser.cashierName : "Manager",
            timestamp: serverTimestamp()
        });

        alert(`✅ Success! A Notice to Explain (NTE) has been issued to ${staffName}. Their Time Clock and POS are now locked until they reply.`);
        document.getElementById('issueSanctionModal').style.display = 'none';
        
        // Reset the file input
        if (fileInput) fileInput.value = '';
        
        window.loadSanctionsDashboard();

    } catch (e) {
        console.error("Error issuing sanction:", e);
        alert("Failed to issue notice.");
    } finally {
        btn.innerText = "🚀 Issue Digital Notice"; btn.disabled = false;
    }
};

window.resolveSanction = async function(docId, staffName) {
    if (!confirm(`Mark this issue as resolved for ${staffName}?`)) return;
    try {
        await updateDoc(doc(db, "hr_sanctions", docId), { status: "Resolved", resolvedAt: serverTimestamp() });
        window.loadSanctionsDashboard();
    } catch (e) { alert("Failed to resolve."); }
};

window.deleteSanction = async function(docId) {
    if (!confirm(`Are you sure you want to delete this record?`)) return;
    try {
        await deleteDoc(doc(db, "hr_sanctions", docId));
        window.loadSanctionsDashboard();
    } catch (e) { alert("Failed to delete."); }
};

// ========================================================
// 📋 STANDARD OPERATING PROCEDURES (SOP) ENGINE - MANAGER
// ========================================================
window.globalSopData = {}; 

window.switchSopTab = function(tab) {
    document.getElementById('sopTabBuilder').style.display = tab === 'Builder' ? 'block' : 'none';
    document.getElementById('sopTabLogs').style.display = tab === 'Logs' ? 'block' : 'none';
    if (tab === 'Logs') window.loadSopLogs();
};

window.loadSopManager = async function() {
    let pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.innerText = "📋 SOP Manager";
    }
  
    let bSelect = document.getElementById('sopBuilderBranch');
    let lSelect = document.getElementById('sopLogBranch');
    
    let opts = '<option value="">-- Choose Branch --</option>';
    let logOpts = '<option value="All">All Branches</option>';
    
    if (window.globalActiveBranches) {
        window.globalActiveBranches.forEach(b => {
            opts += `<option value="${b}">${b}</option>`;
            logOpts += `<option value="${b}">${b}</option>`;
        });
    }
    
    if (bSelect && bSelect.options.length <= 1) bSelect.innerHTML = opts;
    if (lSelect && lSelect.options.length <= 2) lSelect.innerHTML = logOpts;

    let today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    document.getElementById('sopLogDate').value = today.toISOString().split('T')[0];
};

window.loadSopRoles = async function() {
    let branch = document.getElementById('sopBuilderBranch').value;
    let roleSelect = document.getElementById('sopBuilderRole');
    document.getElementById('sopTasksContainer').style.display = 'none';
    
    if (!branch) { roleSelect.innerHTML = '<option value="">-- Choose Role --</option>'; return; }
    
    roleSelect.innerHTML = '<option value="">Loading...</option>';
    
    try {
        const docSnap = await getDoc(doc(db, "settings", "sop_" + branch));
        window.globalSopData = docSnap.exists() ? docSnap.data().roles || {} : {};
        
        let html = '<option value="">-- Choose Role --</option>';
        Object.keys(window.globalSopData).forEach(role => {
            html += `<option value="${role}">${role}</option>`;
        });
        roleSelect.innerHTML = html;
    } catch (e) {
        console.error(e); roleSelect.innerHTML = '<option value="">Error</option>';
    }
};

window.createNewSopRole = async function() {
    let branch = document.getElementById('sopBuilderBranch').value;
    if (!branch) return Swal.fire('Wait!', 'Please select a branch first.', 'warning');
    
    let roleName = prompt(`Enter new Role/Shift name for ${branch}:\n(e.g. "Staff 1 (9AM-5PM)")`);
    if (!roleName || roleName.trim() === "") return;
    roleName = roleName.trim();

    if (window.globalSopData[roleName]) return Swal.fire('Duplicate', 'This role already exists.', 'error');
    
    window.globalSopData[roleName] = []; 
    
    try {
        await setDoc(doc(db, "settings", "sop_" + branch), { roles: window.globalSopData }, { merge: true });
        Swal.fire('Created!', `${roleName} added. You can now add tasks to it.`, 'success');
        window.loadSopRoles();
    } catch (e) { console.error(e); }
};

window.deleteSopRole = async function() {
    let branch = document.getElementById('sopBuilderBranch').value;
    let roleName = document.getElementById('sopBuilderRole').value;
    if (!branch || !roleName) return;

    if (!confirm(`Are you sure you want to permanently delete the SOP for ${roleName}?`)) return;

    delete window.globalSopData[roleName];
    try {
        await setDoc(doc(db, "settings", "sop_" + branch), { roles: window.globalSopData });
        document.getElementById('sopTasksContainer').style.display = 'none';
        window.loadSopRoles();
    } catch (e) { console.error(e); }
};

window.loadSopTasks = function() {
    let roleName = document.getElementById('sopBuilderRole').value;
    let container = document.getElementById('sopTasksContainer');
    let list = document.getElementById('sopTasksList');
    
    if (!roleName) { container.style.display = 'none'; return; }
    
    document.getElementById('sopTaskTitle').innerText = `Tasks for: ${roleName}`;
    let tasks = window.globalSopData[roleName] || [];
    
    list.innerHTML = '';
    if (tasks.length === 0) {
        window.addSopTaskRow(); 
    } else {
        tasks.forEach(t => window.addSopTaskRow(t));
    }
    
    container.style.display = 'block';
};

window.addSopTaskRow = function(taskText = "") {
    let list = document.getElementById('sopTasksList');
    let div = document.createElement('div');
    div.style.cssText = "display: flex; gap: 10px; align-items: center;";
    div.innerHTML = `
        <span style="color: #94a3b8; cursor: grab;">↕️</span>
        <input type="text" class="sop-task-input" value="${taskText.replace(/"/g, '&quot;')}" placeholder="e.g. Count and verify cash drawer..." style="flex: 1; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none; font-weight: bold; color: #334155;">
        <button onclick="this.parentElement.remove()" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 15px; cursor: pointer; font-weight: bold;">✖</button>
    `;
    list.appendChild(div);
};

window.saveSopTasks = async function() {
    let branch = document.getElementById('sopBuilderBranch').value;
    let roleName = document.getElementById('sopBuilderRole').value;
    if (!branch || !roleName) return;

    let tasks = [];
    document.querySelectorAll('.sop-task-input').forEach(inp => {
        if (inp.value.trim() !== "") tasks.push(inp.value.trim());
    });

    let btn = document.getElementById('btnSaveSop');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        window.globalSopData[roleName] = tasks;
        await setDoc(doc(db, "settings", "sop_" + branch), { roles: window.globalSopData }, { merge: true });
        Swal.fire({ title: '✅ Saved!', text: `Checklist for ${roleName} updated globally. Cashier apps will sync instantly.`, icon: 'success', customClass: { popup: 'rounded-2xl' }});
    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to save tasks.', 'error');
    } finally {
        btn.innerText = "💾 Save Checklist to Cloud"; btn.disabled = false;
    }
};

window.loadSopLogs = async function() {
    const tbody = document.getElementById('sopLogsBody');
    let dateFilter = document.getElementById('sopLogDate').value;
    let branchFilter = document.getElementById('sopLogBranch').value;

    if (!dateFilter) return;

    let startOfDay = new Date(dateFilter + 'T00:00:00');
    let endOfDay = new Date(dateFilter + 'T23:59:59');

    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading logs...</td></tr>';

    try {
        let q = query(collection(db, "sop_logs"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(docSnap => {
            let d = docSnap.data();
            if (branchFilter !== "All" && d.branch !== branchFilter) return;

            let timeStr = d.timestamp.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
            let scoreColor = d.scorePercentage === 100 ? '#16a34a' : (d.scorePercentage >= 80 ? '#d97706' : '#dc2626');
            let dataEncoded = encodeURIComponent(JSON.stringify(d));

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px; color: #64748b;">${timeStr}</td>
                    <td style="padding: 12px;"><span class="badge badge-closed">${d.branch}</span></td>
                    <td style="padding: 12px; font-weight: bold; color: #1e293b;">${d.staffName}</td>
                    <td style="padding: 12px; color: #0284c7; font-weight: bold;">${d.roleName}</td>
                    <td style="padding: 12px; font-weight: 900; color: ${scoreColor}; font-size: 15px;">${d.scorePercentage}%</td>
                    <td style="padding: 12px;">
                        <button onclick="window.viewSopLog('${dataEncoded}')" style="background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; color: #334155; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔍 View Details</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #64748b;">No checklists submitted on this date.</td></tr>';
    } catch (e) {
        console.error("Log Fetch Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading logs.</td></tr>';
    }
};

window.viewSopLog = function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    document.getElementById('vSopStaff').innerText = d.staffName;
    document.getElementById('vSopRole').innerText = `${d.roleName} | ${d.timestamp.seconds ? new Date(d.timestamp.seconds * 1000).toLocaleString() : 'Unknown'}`;

    let html = '';
    d.tasks.forEach(t => {
        let isDone = t.status === 'done';
        let icon = isDone ? '✅' : '❌';
        let color = isDone ? '#16a34a' : '#dc2626';
        let bg = isDone ? '#f0fdf4' : '#fef2f2';
        let remarkHtml = !isDone ? `<div style="margin-top: 8px; font-size: 12px; color: #b91c1c; background: white; padding: 8px; border-radius: 4px; border: 1px dashed #fca5a5;"><strong>Reason:</strong> ${t.remark}</div>` : '';

        html += `
            <div style="background: ${bg}; border: 1px solid ${color}; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                <div style="display: flex; gap: 10px; align-items: flex-start;">
                    <span style="font-size: 18px;">${icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: bold; color: #1e293b; font-size: 14px; line-height: 1.4;">${t.task}</div>
                        ${remarkHtml}
                    </div>
                </div>
            </div>
        `;
    });

    document.getElementById('vSopTasksContent').innerHTML = html;
    document.getElementById('viewSopModal').style.display = 'flex';
};

// ========================================================
// 📱 SIDEBAR ARRANGEMENT ENGINE
// ========================================================
window.defaultSidebar = [
    { id: "nav-pos", icon: "🖥️", text: "Point of Sale" },
    { id: "nav-sales", icon: "🧾", text: "Shift Sales" },
    { id: "nav-stockcount", icon: "📋", text: "Stock Count" },
    { id: "nav-remit", icon: "💸", text: "Remit Cash to HQ" },
    { id: "nav-staffreq", icon: "📝", text: "Staff Requests" },
    { id: "nav-sop", icon: "📋", text: "Daily SOPs" },
    { id: "nav-prep", icon: "🔪", text: "Kitchen Prep" },
    { id: "nav-deliveries", icon: "🚚", text: "Incoming Stock" },
    { id: "nav-menumgr", icon: "🍔", text: "Menu Toggle" },
    { id: "nav-stockreq", icon: "📦", text: "Request Stock" },
    { id: "nav-waste", icon: "🗑️", text: "Log Waste" },
    { id: "nav-equipment", icon: "🛠️", text: "Assets & Equipment" },
    { id: "nav-timeclock", icon: "📸", text: "Time Clock" },
    { id: "nav-schedule", icon: "📅", text: "My Schedule" },
    { id: "nav-grab", icon: "🟢", text: "Log Grab Earnings" },
    { id: "nav-printer", icon: "🖨️", text: "Printer Setup" }
];

window.currentSidebarLayout = [];

window.loadSidebarLayout = async function() {
    const listDiv = document.getElementById('sidebarArrangementList');
    if (!listDiv) return;
    listDiv.innerHTML = '<div style="color: #64748b; text-align: center; padding: 20px;">Loading sidebar tabs...</div>';

    try {
        const docSnap = await getDoc(doc(db, "settings", "sidebar_layout"));
        let layout = docSnap.exists() ? docSnap.data().tabs || [] : [];

        // Smart merge: ensure all default tabs are present even if new ones were added later
        let mergedLayout = [];
        layout.forEach(item => {
            let found = window.defaultSidebar.find(d => d.id === item.id);
            if (found) mergedLayout.push(found);
        });

        // Push any missing default tabs to the bottom automatically
        window.defaultSidebar.forEach(d => {
            if (!mergedLayout.find(m => m.id === d.id)) mergedLayout.push(d);
        });

        window.currentSidebarLayout = mergedLayout;
        window.renderSidebarEditor();
    } catch(e) {
        console.error("Sidebar Load Error:", e);
        listDiv.innerHTML = '<div style="color: red; text-align: center;">Error loading layout data.</div>';
    }
};

window.moveSidebarLayout = function(index, direction) {
    let i = parseInt(index);
    let newIndex = i + direction;
    // Stop it from moving out of bounds
    if (newIndex < 0 || newIndex >= window.currentSidebarLayout.length) return;
    
    // Swap elements in the array
    let temp = window.currentSidebarLayout[i];
    window.currentSidebarLayout[i] = window.currentSidebarLayout[newIndex];
    window.currentSidebarLayout[newIndex] = temp;
    
    window.renderSidebarEditor();
};

window.renderSidebarEditor = function() {
    let listDiv = document.getElementById('sidebarArrangementList');
    let html = '';
    
    window.currentSidebarLayout.forEach((tab, index) => {
        html += `
            <div style="display: flex; align-items: center; gap: 15px; background: #f8fafc; padding: 12px 15px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <button onclick="window.moveSidebarLayout('${index}', -1)" style="background: white; border: 1px solid #94a3b8; color: #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">▲ UP</button>
                    <button onclick="window.moveSidebarLayout('${index}', 1)" style="background: white; border: 1px solid #94a3b8; color: #334155; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;">▼ DOWN</button>
                </div>
                <div style="width: 45px; height: 45px; border-radius: 8px; background: #fffbeb; border: 1px solid #fde68a; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0;">${tab.icon}</div>
                <div style="font-weight: 900; color: #1e293b; font-size: 16px; flex-grow: 1;">${tab.text}</div>
                <div style="font-weight: bold; font-size: 12px; color: #94a3b8; background: #e2e8f0; padding: 4px 8px; border-radius: 6px;">Pos: ${index + 1}</div>
            </div>`;
    });
    listDiv.innerHTML = html;
};

window.saveSidebarLayout = async function() {
    try {
        await setDoc(doc(db, "settings", "sidebar_layout"), { tabs: window.currentSidebarLayout }, { merge: true });
        Swal.fire({
            title: '✅ Saved!',
            text: 'Sidebar arrangement saved. Cashier apps will update on refresh.',
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
    } catch(e) { 
        console.error(e);
        Swal.fire('Error', 'Failed to save layout to cloud.', 'error');
    }
};

window.filterAuditTable = function() {
    let search = document.getElementById('auditModalSearch').value.toLowerCase();
    let tbody = document.getElementById('auditModalBody');
    let rows = tbody.getElementsByTagName('tr');
    
    for(let i = 0; i < rows.length; i++) {
        let nameTd = rows[i].getElementsByTagName('td')[0];
        let catTd = rows[i].getElementsByTagName('td')[1];
        if(nameTd && catTd) {
            let text = nameTd.innerText.toLowerCase() + " " + catTd.innerText.toLowerCase();
            rows[i].style.display = text.includes(search) ? "" : "none";
        }
    }
};

// ========================================================
// 📥 UPGRADED GLOBAL SALES EXPORTER (WITH VISIBILITY SCANNER)
// ========================================================
window.exportDashboardSalesCSV = async function() {
    // 1. 🔥 THE FIX: Actively scan the screen for the VISIBLE date boxes, ignoring all hidden tabs!
    let visibleDateInputs = Array.from(document.querySelectorAll('input[type="date"]')).filter(input => input.offsetWidth > 0 && input.offsetHeight > 0);
    let visibleSelects = Array.from(document.querySelectorAll('select')).filter(select => select.offsetWidth > 0 && select.offsetHeight > 0);

    let branch = 'All';
    if (visibleSelects.length > 0) {
        branch = visibleSelects[0].value;
        if (branch.includes("All")) branch = "All"; // Normalize "All Branches"
    }

    let startDateVal = new Date().toISOString().split('T')[0];
    let endDateVal = new Date().toISOString().split('T')[0];

    // Grab the exact dates the user is looking at!
    if (visibleDateInputs.length >= 2) {
        startDateVal = visibleDateInputs[0].value || startDateVal;
        endDateVal = visibleDateInputs[1].value || endDateVal;
    }

    let btn = document.getElementById('btnExportSales');
    let oldText = btn ? btn.innerText : "📥 Export Sales CSV";
    if (btn) { btn.innerText = "⏳ Generating Excel..."; btn.disabled = true; }

    try {
        // 2. Set precise timeframes for Firebase querying
        let startOfDay = new Date(startDateVal);
        startOfDay.setHours(0, 0, 0, 0);
        let endOfDay = new Date(endDateVal);
        endOfDay.setHours(23, 59, 59, 999);

        let q;
        if (branch === "All") {
            q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        } else {
            q = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        }

        const snap = await getDocs(q);

        if (snap.empty) {
            Swal.fire('No Data', 'No sales found for this date range.', 'info');
            if (btn) { btn.innerText = oldText; btn.disabled = false; }
            return;
        }

        // 3. Header with "Items Sold" included
        let csv = "OR#,Branch,Cashier,Customer,Items Sold,Gross Total,Discount,Net Total,Payment Method,Status,Date,Time\n";

        snap.forEach(docSnap => {
            let tx = docSnap.data();
            let d = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateStr = d.toLocaleDateString('en-PH');
            let timeStr = d.toLocaleTimeString('en-PH');

            // 🍔 Extract the Cart Items and Add-ons cleanly
            let itemsArr = [];
            if (tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let itemName = item.name || item.itemName;
                    let itemLine = `${item.qty}x ${itemName}`;
                    
                    if (item.addons) {
                        for (let key in item.addons) {
                            if (item.addons[key].qty > 0) {
                                itemLine += ` (+${item.addons[key].qty} ${key})`;
                            }
                        }
                    }
                    itemsArr.push(itemLine);
                });
            }
            let itemsJoined = itemsArr.join(" | ").replace(/"/g, '""');

            let gross = (tx.subTotalBeforeDiscount || tx.netTotal || 0).toFixed(2);
            let disc = (tx.globalDiscountAmount || 0).toFixed(2);
            let net = (tx.netTotal || 0).toFixed(2);

            let customer = (tx.customerName || 'Guest').replace(/"/g, '""');
            let cashier = (tx.cashier || 'Unknown').replace(/"/g, '""');
            let method = (tx.paymentMethod || 'Cash').replace(/"/g, '""');
            let status = (tx.status || 'Paid').replace(/"/g, '""');

            csv += `"${tx.receiptId || 'N/A'}","${tx.branch}","${cashier}","${customer}","${itemsJoined}","${gross}","${disc}","${net}","${method}","${status}","${dateStr}","${timeStr}"\n`;
        });

        // 4. Force UTF-8 encoding for Excel
        let csvFile = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        let downloadLink = document.createElement("a");
        let safeBranchName = branch.replace(/[^a-zA-Z0-9]/g, '_');
        downloadLink.download = `Takodeal_${safeBranchName}_Sales_${startDateVal}_to_${endDateVal}.csv`;
        downloadLink.href = window.URL.createObjectURL(csvFile);
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

    } catch (error) {
        console.error("Export Error:", error);
        Swal.fire('Error', 'Failed to generate CSV. Please check your internet connection.', 'error');
    } finally {
        if (btn) { btn.innerText = oldText; btn.disabled = false; }
    }
};

// ========================================================
// 🛠️ ASSETS & EQUIPMENT MANAGER ENGINE
// ========================================================

window.loadEquipmentDashboard = async function() {
    const tbody = document.getElementById('equipmentTableBody');
    if (!tbody) return;
    
    // Auto-populate branch filter
    let branchFilterEl = document.getElementById('equipBranchFilter');
    if (branchFilterEl && branchFilterEl.options.length <= 1) {
        let opts = '<option value="All">🌐 All Branches</option>';
        window.globalActiveBranches.forEach(b => opts += `<option value="${b}">${b}</option>`);
        branchFilterEl.innerHTML = opts;
    }
    
    let branchFilter = branchFilterEl ? branchFilterEl.value : "All";
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding: 30px;">⏳ Scanning registered hardware...</td></tr>';

    try {
        let q = query(collection(db, "equipment_assets"), orderBy("purchaseDate", "desc"));
        if (branchFilter !== "All") {
            q = query(collection(db, "equipment_assets"), where("branch", "==", branchFilter), orderBy("purchaseDate", "desc"));
        }
        
        const snap = await getDocs(q);
        let html = '';
        let activeValue = 0;
        let brokenValue = 0;

        snap.forEach(docSnap => {
            let d = docSnap.data();
            let cost = parseFloat(d.cost) || 0;
            
            if (d.status === "Active") activeValue += cost;
            else brokenValue += cost;

            let pDate = d.purchaseDate ? new Date(d.purchaseDate).toLocaleDateString() : '-';
            let oDate = d.operateDate ? new Date(d.operateDate).toLocaleDateString() : '-';
            let bDate = d.breakdownDate ? new Date(d.breakdownDate).toLocaleDateString() : '-';
            
            let timelineHtml = `
                <div style="font-size: 11px; color: #64748b;">
                    <div><strong style="color:#0f172a;">Purchased:</strong> ${pDate}</div>
                    <div><strong style="color:#16a34a;">Operating:</strong> ${oDate}</div>
                    ${d.status !== 'Active' ? `<div style="color:#dc2626;"><strong>Broken/Replaced:</strong> ${bDate}</div>` : ''}
                </div>
            `;

            let statusBadge = d.status === "Active" 
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">🟢 Active</span>`
                : `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">🔴 ${d.status}</span>`;

            // Action Buttons
            let actionHtml = `<div style="display:flex; gap: 5px; flex-direction:column;">`;
            if (d.status === "Active") {
                actionHtml += `<button onclick="window.markEquipmentBroken('${docSnap.id}', '${d.name.replace(/'/g, "\\'")}', '${d.branch}')" style="background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: bold; cursor: pointer;">⚠️ Report Breakdown</button>`;
            } else {
                actionHtml += `<span style="font-size: 11px; color: #94a3b8; font-style: italic;">Archived</span>`;
            }
            actionHtml += `<button onclick="window.deleteEquipment('${docSnap.id}')" style="background: white; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: bold; cursor: pointer;">🗑️ Delete</button></div>`;

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; ${d.status !== 'Active' ? 'opacity: 0.7; background: #f8fafc;' : ''}">
                    <td style="padding: 15px;">
                        <strong style="color: #1e293b; font-size: 14px;">${d.name}</strong><br>
                        <span style="font-size: 11px; color: #64748b; font-style: italic;">${d.details || 'No details'}</span>
                    </td>
                    <td style="padding: 15px;"><span class="badge badge-open">${d.branch}</span></td>
                    <td style="padding: 15px; font-weight: bold; color: ${d.status === 'Active' ? '#0f766e' : '#94a3b8'};">₱${cost.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding: 15px;">${timelineHtml}</td>
                    <td style="padding: 15px;">${statusBadge}</td>
                    <td style="padding: 15px; text-align: center;">${actionHtml}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center" style="padding: 30px; color: #94a3b8;">No equipment registered yet.</td></tr>';
        
        document.getElementById('equipTotalValue').innerText = `₱${activeValue.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('equipBrokenValue').innerText = `₱${brokenValue.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    } catch (e) {
        console.error("Equipment Load Error:", e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: red;">Error loading equipment data.</td></tr>';
    }
};

window.openAddEquipmentModal = async function() {
    let branchOptions = window.globalActiveBranches.map(b => `<option value="${b}">${b}</option>`).join('');
    
    // Check if accounts exist for the deduction integration
    let accountOptions = '<option value="">-- Do Not Deduct / Just Log Asset --</option>';
    if (window.liveAccounts) {
        window.liveAccounts.forEach(a => {
            if (a.branch === "Main Office") { // Only pull money from HQ accounts for CAPEX!
                accountOptions += `<option value="${a.id}|${a.name}">Deduct from ${a.name} (Bal: ₱${a.balance.toLocaleString()})</option>`;
            }
        });
    }

    const { value: formValues, isConfirmed } = await Swal.fire({
        title: '🛠️ Register Equipment',
        html: `
            <div style="text-align: left; margin-top: 10px;">
                <label style="font-size: 12px; font-weight: bold; color: #475569; display: block; margin-bottom: 5px;">Equipment Name</label>
                <input type="text" id="swal-eq-name" placeholder="e.g. Takoyaki 3-Pan Maker" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 15px; outline: none; box-sizing: border-box; font-weight: bold; font-size: 14px;">
                
                <label style="font-size: 12px; font-weight: bold; color: #475569; display: block; margin-bottom: 5px;">Details / Serial No.</label>
                <input type="text" id="swal-eq-details" placeholder="Brand, Model, Warranty info..." style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 15px; outline: none; box-sizing: border-box; font-weight: bold; font-size: 14px;">
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div>
                        <label style="font-size: 12px; font-weight: bold; color: #475569; display: block; margin-bottom: 5px;">Branch Assigned</label>
                        <select id="swal-eq-branch" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; box-sizing: border-box; font-weight: bold; cursor: pointer; font-size: 14px;">${branchOptions}</select>
                    </div>
                    <div>
                        <label style="font-size: 12px; font-weight: bold; color: #dc2626; display: block; margin-bottom: 5px;">Cost (₱)</label>
                        <input type="number" id="swal-eq-cost" placeholder="0.00" style="width: 100%; padding: 12px; border-radius: 6px; border: 2px solid #fca5a5; background: #fef2f2; outline: none; box-sizing: border-box; font-weight: 900; color: #dc2626; font-size: 15px;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div>
                        <label style="font-size: 12px; font-weight: bold; color: #475569; display: block; margin-bottom: 5px;">Purchase Date</label>
                        <input type="date" id="swal-eq-pdate" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; box-sizing: border-box; font-weight: bold; font-size: 14px;">
                    </div>
                    <div>
                        <label style="font-size: 12px; font-weight: bold; color: #475569; display: block; margin-bottom: 5px;">Operate Date (Installed)</label>
                        <input type="date" id="swal-eq-odate" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; box-sizing: border-box; font-weight: bold; font-size: 14px;">
                    </div>
                </div>

                <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 15px; border-radius: 8px;">
                    <label style="font-size: 12px; font-weight: bold; color: #0ea5e9; display: block; margin-bottom: 5px;">Optional: Financial Accounting (CAPEX)</label>
                    <span style="font-size: 11px; color: #64748b; margin-bottom: 10px; display: block;">Select an account below if you want this purchase to automatically deduct from your Cash & Budget ledger as an official expense.</span>
                    <select id="swal-eq-account" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; outline: none; box-sizing: border-box; font-weight: bold; cursor: pointer; font-size: 13px;">${accountOptions}</select>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '💾 Save Equipment',
        confirmButtonColor: '#0ea5e9',
        width: '550px',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        didOpen: () => {
            let today = new Date().toISOString().split('T')[0];
            document.getElementById('swal-eq-pdate').value = today;
            document.getElementById('swal-eq-odate').value = today;
        },
        preConfirm: () => {
            return {
                name: document.getElementById('swal-eq-name').value.trim(),
                details: document.getElementById('swal-eq-details').value.trim(),
                branch: document.getElementById('swal-eq-branch').value,
                cost: parseFloat(document.getElementById('swal-eq-cost').value) || 0,
                purchaseDate: document.getElementById('swal-eq-pdate').value,
                operateDate: document.getElementById('swal-eq-odate').value,
                accountData: document.getElementById('swal-eq-account').value // "id|name"
            }
        }
    });

    if (!isConfirmed || !formValues.name) return;

    Swal.fire({ title: 'Registering Asset...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        // 1. Save Asset
        await addDoc(collection(db, "equipment_assets"), {
            name: formValues.name,
            details: formValues.details,
            branch: formValues.branch,
            cost: formValues.cost,
            purchaseDate: formValues.purchaseDate,
            operateDate: formValues.operateDate,
            status: "Active",
            timestamp: serverTimestamp()
        });

        // 2. Optional: Log to P&L Expenses
        if (formValues.accountData && formValues.cost > 0) {
            let [accId, accName] = formValues.accountData.split('|');
            
            // Deduct from Bank/Cash
            let accRef = doc(db, "cash_accounts", accId);
            let accSnap = await getDoc(accRef);
            if (accSnap.exists()) {
                await updateDoc(accRef, { balance: (accSnap.data().balance || 0) - formValues.cost });
            }

            // Log Expense
            await addDoc(collection(db, "expenses"), {
                branch: formValues.branch,
                amount: formValues.cost,
                category: "Equipment / CAPEX",
                account: accName,
                description: `Asset Purchase: ${formValues.name}`,
                timestamp: new Date(formValues.purchaseDate + 'T12:00:00') // Log on purchase date
            });
            
            if (typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();
        }

        Swal.fire('✅ Asset Logged', `${formValues.name} successfully registered.`, 'success');
        window.loadEquipmentDashboard();
    } catch (e) {
        console.error("Save Asset Error:", e);
        Swal.fire('Error', 'Failed to register equipment.', 'error');
    }
};

window.markEquipmentBroken = async function(docId, name, branch) {
    const { value: reason, isConfirmed } = await Swal.fire({
        title: `⚠️ Report Breakdown`,
        html: `You are marking the <b>${name}</b> at <b>${branch}</b> as broken/inoperable.<br><br>`,
        input: 'text',
        inputPlaceholder: 'Reason (e.g. Motor burnt out, heating element died)',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d97706',
        confirmButtonText: 'Flag as Broken'
    });

    if (isConfirmed) {
        try {
            let today = new Date().toISOString().split('T')[0];
            await updateDoc(doc(db, "equipment_assets", docId), {
                status: "Broken",
                breakdownDate: today,
                breakdownReason: reason || "Unspecified",
                lastUpdated: serverTimestamp()
            });

            // Fire an alert to the security feed
            await addDoc(collection(db, "manager_alerts"), {
                type: "ASSET_BREAKDOWN", branch: branch,
                message: `🛠️ EQUIPMENT DOWN: ${name} was reported broken. Reason: ${reason || 'Unspecified'}.`,
                timestamp: serverTimestamp(), isRead: false
            });

            Swal.fire('Updated', `Asset marked as broken.`, 'success');
            window.loadEquipmentDashboard();
        } catch(e) {
            console.error(e);
            Swal.fire('Error', 'Failed to update asset.', 'error');
        }
    }
};

window.deleteEquipment = async function(docId) {
    if (!confirm("Delete this equipment record permanently? This will not refund any expenses logged in the ledger.")) return;
    try {
        await deleteDoc(doc(db, "equipment_assets", docId));
        window.loadEquipmentDashboard();
    } catch(e) { console.error(e); alert("Failed to delete."); }
};

// ==========================================
// 💸 MAIN OFFICE DIRECT SELL ENGINE (WITH UOM CONVERSION)
// ==========================================
window.sellMainOfficeStock = async function(docId, itemName, currentStock, uom, baseCost) {
    if (!window.liveAccounts || window.liveAccounts.length === 0) {
        if(typeof window.loadAccountsAndBudget === 'function') await window.loadAccountsAndBudget();
    }
    
    let accOptions = '<option value="">-- Select Account to Deposit To --</option>';
    window.liveAccounts.forEach(a => {
        if (a.branch === "Main Office") accOptions += `<option value="${a.id}|${a.name}">${a.name} (Bal: ₱${a.balance.toLocaleString()})</option>`;
    });

    Swal.fire({ title: 'Fetching UOMs...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // 🔥 THE FIX: Fetch the exact item data from the cloud to grab the UOM options!
    let purchUom = uom;
    let convRate = 1;
    try {
        const docSnap = await getDoc(doc(db, "inventory", docId));
        if (docSnap.exists()) {
            let data = docSnap.data();
            purchUom = data.purchaseUom || data.purchUom || uom;
            convRate = parseFloat(data.conversionRate) || parseFloat(data.conversion) || 1;
        }
    } catch(e) { console.error("Error fetching UOM data", e); }

    // Build the Dropdown or Static Span depending on if they have a conversion setup
    let uomDropdownHtml = '';
    if (purchUom.toLowerCase() !== uom.toLowerCase() && convRate !== 1) {
        uomDropdownHtml = `
            <select id="sellMoUom" style="padding: 14px; border: 2px solid #cbd5e1; border-left: none; border-radius: 0 8px 8px 0; background: #f8fafc; color: #0f172a; font-weight: bold; outline: none; cursor: pointer; box-sizing: border-box; height: 100%;">
                <option value="base" data-conv="1">${uom}</option>
                <option value="purch" data-conv="${convRate}">${purchUom}</option>
            </select>
        `;
    } else {
        uomDropdownHtml = `<span style="padding: 14px; background: #f8fafc; color: #64748b; border: 2px solid #cbd5e1; border-left: none; border-radius: 0 8px 8px 0; font-size: 14px; font-weight: bold; display: flex; align-items: center; box-sizing: border-box; height: 100%;">${uom}</span>`;
    }

    // Close the loading modal
    Swal.close();

    const { value: formVals, isConfirmed } = await Swal.fire({
        title: '💸 Direct Sale (HQ)',
        html: `
            <div style="text-align:left; font-size:14px; color:#475569; margin-bottom:15px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px dashed #cbd5e1;">
                Selling: <strong style="color:#0f172a; font-size: 15px;">${itemName}</strong> <br>
                <span style="font-size: 12px;">(In Stock: ${currentStock.toFixed(2)} ${uom})</span>
            </div>
            
            <div style="text-align: left; font-family: inherit;">
                <label style="font-weight:bold; font-size:12px; color:#475569; display: block; margin-bottom: 5px;">Qty to Sell:</label>
                <div style="display: flex; justify-content: center; align-items: stretch; margin-bottom: 15px; height: 50px;">
                    <input type="number" id="sellMoQty" placeholder="e.g. 5" style="flex: 1; width: 100%; padding: 14px; border: 2px solid #cbd5e1; border-radius: 8px 0 0 8px; outline: none; box-sizing: border-box; font-family: inherit; font-size: 16px; font-weight: bold; color: #0f172a; height: 100%;">
                    ${uomDropdownHtml}
                </div>
                
                <label style="font-weight:bold; font-size:12px; color:#dc2626; display: block; margin-bottom: 5px;">Total Selling Price (₱):</label>
                <input type="number" id="sellMoPrice" placeholder="e.g. 1500" style="width: 100%; padding: 14px; border-radius: 8px; border: 2px solid #fca5a5; background: #fef2f2; outline: none; box-sizing: border-box; font-family: inherit; font-weight: 900; color: #dc2626; font-size: 16px; margin-bottom: 15px;">
                
                <label style="font-weight:bold; font-size:12px; color:#475569; display: block; margin-bottom: 5px;">Deposit Funds To:</label>
                <select id="sellMoAcc" style="width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; box-sizing: border-box; font-family: inherit; font-size: 14px; font-weight: bold; cursor: pointer; background: white; color: #0f172a;">${accOptions}</select>
            </div>
        `,
        showCancelButton: true, 
        confirmButtonText: '💸 Confirm Sale', 
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#94a3b8',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        preConfirm: () => {
            let uomEl = document.getElementById('sellMoUom');
            let cRate = 1;
            let displayUom = uom;
            if (uomEl && uomEl.tagName === 'SELECT') {
                let selOpt = uomEl.options[uomEl.selectedIndex];
                cRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
                displayUom = selOpt.text;
            }

            return {
                rawQty: parseFloat(document.getElementById('sellMoQty').value),
                convRate: cRate,
                displayUom: displayUom,
                price: parseFloat(document.getElementById('sellMoPrice').value),
                acc: document.getElementById('sellMoAcc').value
            }
        }
    });

    if (!isConfirmed || !formVals) return;
    if (isNaN(formVals.rawQty) || formVals.rawQty <= 0 || isNaN(formVals.price) || formVals.price <= 0 || !formVals.acc) {
        return Swal.fire('Error', 'Please fill all fields with valid numbers.', 'error');
    }

    // Determine the actual amount to deduct from Firebase!
    let finalBaseQty = formVals.rawQty * formVals.convRate;

    if (finalBaseQty > currentStock) {
        return Swal.fire('Error', `Not enough stock to sell that amount.\n\nYou are trying to deduct ${finalBaseQty} ${uom}, but HQ only has ${currentStock} ${uom} in stock.`, 'error');
    }

    Swal.fire({ title: 'Processing Sale...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        let [accId, accName] = formVals.acc.split('|');
        
        // 1. Deduct Stock
        await updateDoc(doc(db, "inventory", docId), { currentStock: currentStock - finalBaseQty });
        
        // 2. Deposit Cash
        let accRef = doc(db, "cash_accounts", accId);
        let accSnap = await getDoc(accRef);
        let newBal = (accSnap.data().balance || 0) + formVals.price;
        await updateDoc(accRef, { balance: newBal });

        // 3. Log the income and trace it!
        await addDoc(collection(db, "account_logs"), {
            accountId: accId, accountName: accName, branch: "Main Office", action: "HQ Direct Sale",
            amount: formVals.price, newBalance: newBal, user: window.sessionUser ? window.sessionUser.cashierName : 'Owner',
            timestamp: serverTimestamp(), note: `Sold ${formVals.rawQty} ${formVals.displayUom} of ${itemName}`
        });

        await addDoc(collection(db, "stock_logs"), {
            branch: "Main Office", item: itemName, uom: uom, oldQty: currentStock, newQty: currentStock - finalBaseQty,
            variance: -finalBaseQty, type: "Direct Sale (HQ)", note: `Sold for ₱${formVals.price} (Input: ${formVals.rawQty} ${formVals.displayUom})`,
            user: window.sessionUser ? window.sessionUser.cashierName : "Owner", timestamp: serverTimestamp()
        });

        // Add to transactions so it shows in global revenue!
        await addDoc(collection(db, "transactions"), {
            branch: "Main Office", cashier: window.sessionUser ? window.sessionUser.cashierName : "Owner",
            receiptId: "HQ-SALE-" + Date.now().toString().slice(-5),
            netTotal: formVals.price, paymentMethod: accName, status: "Paid", orderType: "Wholesale/Direct",
            cart: [{ name: itemName, qty: formVals.rawQty, uom: formVals.displayUom, lineTotalFinal: formVals.price, category: "HQ Wholesale" }],
            timestamp: serverTimestamp()
        });

        Swal.fire({
            title: '✅ Sale Complete',
            text: `Successfully sold ${formVals.rawQty} ${formVals.displayUom} of ${itemName} for ₱${formVals.price}.`,
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
        
        window.loadInventoryData();
        if(typeof window.loadAccountsAndBudget === 'function') window.loadAccountsAndBudget();
    } catch(e) { 
        console.error(e); 
        Swal.fire('Error', 'Sale failed. Check console.', 'error'); 
    }
};

// ==========================================
// ➕ UNIVERSAL CUSTOM DROPDOWN ENGINE
// ==========================================
window.handleCustomDropdown = function(selectElement) {
    if (selectElement.value === "ADD_NEW") {
        let newOptionText = prompt("Enter your new custom option:");
        
        if (newOptionText && newOptionText.trim() !== "") {
            newOptionText = newOptionText.trim();
            
            // Create the new option
            let newOption = document.createElement("option");
            newOption.value = newOptionText;
            newOption.innerText = newOptionText;
            
            // Insert it right before the "➕ Add Custom..." button
            selectElement.insertBefore(newOption, selectElement.lastElementChild);
            
            // Auto-select the newly created option!
            selectElement.value = newOptionText;
        } else {
            // If they cancel, revert back to the top option
            selectElement.selectedIndex = 0;
        }
    }
};

// ==========================================
// 🖱️ MULTI-SELECT DRAG & DROP ENGINE
// ==========================================
window.draggedAddonRows = [];

window.toggleAddonSelection = function(checkbox) {
    let tr = checkbox.closest('tr');
    if (checkbox.checked) {
        tr.style.background = '#eff6ff'; // Highlights row in light blue
    } else {
        tr.style.background = 'white';
    }
};

window.handleAddonDragStart = function(e) {
    let tr = e.target.closest('tr');
    let tbody = tr.parentNode;
    
    // Find all checkboxes that are currently ticked
    let checkedRows = Array.from(tbody.querySelectorAll('.addon-select-cb:checked')).map(cb => cb.closest('tr'));
    
    // If they drag a row that IS NOT checked, only drag that single row
    if (!checkedRows.includes(tr)) {
        window.draggedAddonRows = [tr];
    } else {
        // If they drag a checked row, group ALL checked rows together!
        window.draggedAddonRows = checkedRows;
    }

    e.dataTransfer.effectAllowed = 'move';
    
    // Make dragged rows slightly transparent so you can see where they are going
    window.draggedAddonRows.forEach(row => row.style.opacity = '0.4');
};

window.handleAddonDragOver = function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
};

window.handleAddonDragEnter = function(e) {
    e.preventDefault();
    let tr = e.target.closest('tr');
    // Draw a purple line above the row they are hovering over
    if (tr && !window.draggedAddonRows.includes(tr)) {
        tr.style.borderTop = "3px solid #8b5cf6"; 
    }
};

window.handleAddonDragLeave = function(e) {
    let tr = e.target.closest('tr');
    if (tr) tr.style.borderTop = "";
};

window.handleAddonDrop = function(e) {
    e.stopPropagation();
    e.preventDefault();
    
    let targetTr = e.target.closest('tr');
    if (targetTr) targetTr.style.borderTop = "";
    
    if (!targetTr || window.draggedAddonRows.includes(targetTr)) return;

    let tbody = targetTr.parentNode;
    
    // Insert all dragged rows precisely above the target row
    window.draggedAddonRows.forEach(row => {
        tbody.insertBefore(row, targetTr);
        row.style.opacity = '1';
        
        // Clean up visual selection state
        row.style.background = 'white';
        let cb = row.querySelector('.addon-select-cb');
        if (cb) cb.checked = false;
    });
    
    // 🔥 THE CRITICAL FIX: Synchronize the Javascript memory with the new HTML order!
    let newCache = [];
    tbody.querySelectorAll('tr').forEach(tr => {
        let rowId = tr.getAttribute('data-id');
        if (rowId) {
            let foundItem = window.globalAddonsCache.find(a => a.id === rowId);
            if (foundItem) newCache.push(foundItem);
        }
    });
    window.globalAddonsCache = newCache; // Memory is now perfectly synced!
    
    window.draggedAddonRows = [];
    
    // 🔥 SECRET AUTO-SAVE: Instantly saves to Firebase without a popup!
    window.saveGlobalAddonLayout(true); 
};

window.handleAddonDragEnd = function(e) {
    if (window.draggedAddonRows) {
        window.draggedAddonRows.forEach(row => row.style.opacity = '1');
    }
    document.querySelectorAll('tr').forEach(t => t.style.borderTop = "");
    window.draggedAddonRows = [];
};

// ==========================================
// 💸 ATTENDANCE PENALTY ENGINE
// ==========================================
window.applyAttendancePenalty = async function(docId, staffName, dateStr, currentPenalty) {
    let penaltyInput = prompt(`Apply Late/Undertime Deduction for ${staffName} on ${dateStr}?\n\nEnter deduction amount (₱):\n(Enter 0 to remove penalty)`, currentPenalty);
    
    if (penaltyInput === null) return; 
    
    let penaltyAmt = parseFloat(penaltyInput);
    if (isNaN(penaltyAmt) || penaltyAmt < 0) {
        alert("❌ Invalid amount entered.");
        return;
    }

    try {
        // 🔥 THE FIX: Removed "window." from updateDoc, doc, and db!
        await updateDoc(doc(db, "attendance_logs", docId), {
            penaltyAmount: penaltyAmt
        });
        
        alert(`✅ Penalty of ₱${penaltyAmt.toFixed(2)} applied successfully to ${staffName}.`);
        
        if (typeof window.loadAttendanceLogs === 'function') window.loadAttendanceLogs(); 
    } catch (e) {
        console.error("Error applying penalty:", e);
        alert("❌ Failed to apply penalty. Check console.");
    }
};

// ==========================================
// 🌍 ENTERPRISE GLOBAL ADD-ON & MIX-MATCH ENGINE
// ==========================================

// 1. Inject the new "Global Mix & Match" Button next to your Add-On button
setTimeout(() => {
    let massSyncBtn = document.querySelector('button[onclick*="Mass Sync"]') || document.querySelector('button[onclick*="saveGlobalAddon"]');
    if (massSyncBtn && !document.getElementById('btnGlobalMixMatch')) {
        let btn = document.createElement('button');
        btn.id = "btnGlobalMixMatch";
        btn.innerHTML = "🐙 Manage Global Mix & Match";
        btn.style.cssText = "background: #d97706; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-left: 10px; box-shadow: 0 2px 4px rgba(217,119,6,0.3);";
        btn.onclick = window.openGlobalMixMatchModal;
        massSyncBtn.parentNode.insertBefore(btn, massSyncBtn);
    }
}, 2000);

// 2. OVERRIDE: Upgraded Multi-Category Global Add-On Modal
window.openGlobalAddonModal = async function(id = '', name = '', price = 0, deductQty = 0, linkedIng = '', categoryData = 'All') {
    Swal.fire({title: 'Loading Data...', allowOutsideClick: false, didOpen: ()=>Swal.showLoading()});
    
    let menuCats = new Set();
    let invOptions = '<option value="">-- No Linked Ingredient --</option>';
    try {
        const menuSnap = await getDocs(collection(db, "menu"));
        menuSnap.forEach(d => { if(d.data().category) menuCats.add(d.data().category); });
        
        const invSnap = await getDocs(query(collection(db, "inventory"), where("branch", "==", "Main Office")));
        let items = [];
        invSnap.forEach(d => items.push(d.data()));
        items.sort((a,b) => (a.name||"").localeCompare(b.name||""));
        items.forEach(i => {
            let sel = (i.name === linkedIng) ? 'selected' : '';
            invOptions += `<option value="${i.name}" ${sel}>${i.name}</option>`;
        });
        window.cachedInventoryOptions = invOptions.replace(/selected/g, ''); // Save clean list for later
    } catch(e){}

    let selectedArr = [];
    if (categoryData) {
        if (Array.isArray(categoryData)) selectedArr = categoryData;
        else selectedArr = categoryData.split(',').map(s=>s.trim());
    }

    let catHtml = `<div style="display:flex; flex-wrap:wrap; gap:10px; max-height:120px; overflow-y:auto; padding:10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;">
        <label style="width:100%; font-weight:bold; color:#0f172a;"><input type="checkbox" id="swalCatAll" ${selectedArr.includes('All')?'checked':''} onchange="document.querySelectorAll('.swal-cat-cb').forEach(c=>c.checked=this.checked)"> Apply to ALL Categories</label>
        <hr style="width:100%; margin:0; border:0; border-top:1px solid #e2e8f0;">`;
    Array.from(menuCats).sort().forEach(c => {
        let isChecked = selectedArr.includes(c) || selectedArr.includes('All') ? 'checked' : '';
        catHtml += `<label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" class="swal-cat-cb" value="${c}" ${isChecked}> ${c}</label>`;
    });
    catHtml += `</div>`;

    Swal.fire({
        title: id ? '✏️ Edit Global Add-On' : '➕ Create Global Add-On',
        html: `
            <div style="text-align:left; display:flex; flex-direction:column; gap:12px;">
                <div><label style="font-size:12px; font-weight:bold; color:#475569;">Add-On Name</label><input type="text" id="swalAoName" value="${name}" class="swal2-input" style="margin:0; width:100%; font-size:14px; box-sizing:border-box;"></div>
                <div style="display:flex; gap:10px;">
                    <div style="flex:1;"><label style="font-size:12px; font-weight:bold; color:#475569;">Extra Price (₱)</label><input type="number" id="swalAoPrice" value="${price}" class="swal2-input" style="margin:0; width:100%; font-size:14px; box-sizing:border-box;"></div>
                    <div style="flex:1;"><label style="font-size:12px; font-weight:bold; color:#475569;">Qty to Deduct</label><input type="number" id="swalAoQty" value="${deductQty}" class="swal2-input" style="margin:0; width:100%; font-size:14px; box-sizing:border-box;"></div>
                </div>
                <div><label style="font-size:12px; font-weight:bold; color:#475569;">Linked Raw Material (Live Inventory)</label><select id="swalAoIng" class="swal2-select" style="margin:0; width:100%; font-size:14px; box-sizing:border-box; outline:none;">${invOptions}</select></div>
                <div><label style="font-size:12px; font-weight:bold; color:#475569; display:block; margin-bottom:5px;">Applies To Which Menu Categories?</label>${catHtml}</div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Save Add-On',
        confirmButtonColor: '#0ea5e9',
        customClass: { popup: 'rounded-2xl shadow-2xl' },
        preConfirm: () => {
            let newName = document.getElementById('swalAoName').value.trim();
            let newPrice = parseFloat(document.getElementById('swalAoPrice').value) || 0;
            let newQty = parseFloat(document.getElementById('swalAoQty').value) || 0;
            let newIng = document.getElementById('swalAoIng').value;
            
            let cats = [];
            if (document.getElementById('swalCatAll').checked) cats = ["All"];
            else document.querySelectorAll('.swal-cat-cb:checked').forEach(c => cats.push(c.value));

            if (!newName) { Swal.showValidationMessage('Add-On Name is required'); return false; }
            if (cats.length === 0) { Swal.showValidationMessage('Select at least one category'); return false; }

            return { name: newName, price: newPrice, deductQty: newQty, linkedIngredient: newIng, category: cats };
        }
    }).then(async (res) => {
        if (res.isConfirmed) {
            Swal.fire({title:'Saving to Cloud...', allowOutsideClick: false, didOpen:()=>Swal.showLoading()});
            try {
                if (id) await updateDoc(doc(db, "global_addons", id), res.value);
                else await addDoc(collection(db, "global_addons"), res.value);
                
                Swal.fire({
                    title: '✅ Saved', 
                    text: 'Add-on updated successfully.', 
                    icon: 'success', 
                    timer: 1500, 
                    showConfirmButton: false,
                    customClass: { popup: 'rounded-2xl' }
                });
                
                // 🔥 THE FIX: Soft-refresh the table dynamically instead of refreshing the whole website!
                if (typeof window.loadGlobalAddons === 'function') {
                    window.loadGlobalAddons();
                }
            } catch(e) { 
                console.error(e); 
                Swal.fire('Error', 'Failed to save', 'error'); 
            }
        }
    });
};

// 3. NEW: The Global Mix & Match Configurator
window.openGlobalMixMatchModal = async function() {
    Swal.fire({title: 'Loading Data...', allowOutsideClick: false, didOpen: ()=>Swal.showLoading()});
    
    let menuCats = new Set();
    // 🔥 THE FIX: We build the dropdown list completely from scratch here!
    let invOptions = '<option value="">-- Select Raw Ingredient --</option>';

    try {
        const snap = await getDocs(collection(db, "menu"));
        snap.forEach(d => { if(d.data().category) menuCats.add(d.data().category); });

        // 🔥 THE FIX: Force fetch the inventory list from Main Office every single time!
        const invSnap = await getDocs(query(collection(db, "inventory"), where("branch", "==", "Main Office")));
        let items = [];
        invSnap.forEach(d => items.push(d.data()));
        items.sort((a,b) => (a.name||"").localeCompare(b.name||""));
        
        items.forEach(i => {
            invOptions += `<option value="${i.name}">${i.name}</option>`;
        });
        
        // Overwrite the global memory with the fresh, complete list!
        window.cachedInventoryOptions = invOptions;

    } catch(e){ console.error("Error loading Mix Match data:", e); }
    
    let existingConfig = { categories: [], flavors: [], mappings: [] };
    try {
        const snap = await getDoc(doc(db, "settings", "global_mixmatch"));
        if (snap.exists()) existingConfig = snap.data();
    } catch(e){}

    let catHtml = `<div style="display:flex; flex-wrap:wrap; gap:10px; max-height:120px; overflow-y:auto; padding:10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; margin-bottom:15px;">
        <label style="width:100%; font-weight:bold; color:#0f172a;"><input type="checkbox" id="gmmCatAll" ${existingConfig.categories.includes('All')?'checked':''} onchange="document.querySelectorAll('.gmm-cat-cb').forEach(c=>c.checked=this.checked)"> Apply to ALL Categories</label>
        <hr style="width:100%; margin:0; border:0; border-top:1px solid #e2e8f0;">`;
    Array.from(menuCats).sort().forEach(c => {
        let isChecked = existingConfig.categories.includes(c) || existingConfig.categories.includes('All') ? 'checked' : '';
        catHtml += `<label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" class="gmm-cat-cb" value="${c}" ${isChecked}> ${c}</label>`;
    });
    catHtml += `</div>`;

    let flavHtml = `<textarea id="gmmFlavors" class="swal2-textarea" style="margin:0; width:100%; height:80px; font-size:14px; box-sizing:border-box;" placeholder="Pork, Shrimp, Octopus, Bacon...">${(existingConfig.flavors || []).join(', ')}</textarea>`;

    Swal.fire({
        title: '🐙 Global Mix & Match',
        width: 700,
        html: `
            <div style="text-align:left; display:flex; flex-direction:column; gap:10px;">
                <div><label style="font-size:12px; font-weight:bold; color:#b45309; display:block; margin-bottom:5px;">1. Apply to Categories:</label>${catHtml}</div>
                <div><label style="font-size:12px; font-weight:bold; color:#b45309; display:block; margin-bottom:5px;">2. Flavors (Comma Separated):</label>${flavHtml}</div>
                <div><label style="font-size:12px; font-weight:bold; color:#b45309; display:block; margin-bottom:5px;">3. Link to Inventory (Qty to deduct per 1 piece):</label>
                     <div id="gmmMappingContainer" style="margin-top:5px; border: 1px dashed #fcd34d; padding:10px; border-radius:8px; background:#fffbeb;">Type flavors above to map them...</div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: '💾 Save Global Config',
        confirmButtonColor: '#d97706',
        customClass: { popup: 'rounded-2xl shadow-2xl' },
        didOpen: () => {
            window.gmmCurrentMappings = existingConfig.mappings || [];
            document.getElementById('gmmFlavors').addEventListener('input', window.renderGmmMapping);
            window.renderGmmMapping();
        },
        preConfirm: () => {
            let cats = [];
            if (document.getElementById('gmmCatAll').checked) cats = ["All"];
            else document.querySelectorAll('.gmm-cat-cb:checked').forEach(c => cats.push(c.value));
            
            let flavors = document.getElementById('gmmFlavors').value.split(',').map(s=>s.trim()).filter(Boolean);
            let mappings = [];
            document.querySelectorAll('.gmm-row').forEach(row => {
                let f = row.getAttribute('data-flavor');
                let ing = row.querySelector('.gmm-ing').value;
                let qty = parseFloat(row.querySelector('.gmm-qty').value) || 0;
                if(ing && qty > 0) mappings.push({ flavor: f, linkedIngredient: ing, deductQty: qty });
            });
            
            if (cats.length === 0) { Swal.showValidationMessage('Select at least one category'); return false; }
            if (flavors.length === 0) { Swal.showValidationMessage('Enter at least one flavor'); return false; }
            return { categories: cats, flavors: flavors, mappings: mappings };
        }
    }).then(async (res) => {
        if (res.isConfirmed) {
            Swal.fire({title:'Saving...', allowOutsideClick: false, didOpen:()=>Swal.showLoading()});
            await setDoc(doc(db, "settings", "global_mixmatch"), res.value);
            Swal.fire({title: '✅ Saved', text: 'Global Mix & Match activated!', icon: 'success', customClass: { popup: 'rounded-2xl' }});
        }
    });
};

window.renderGmmMapping = async function() {
    let container = document.getElementById('gmmMappingContainer');
    if (!container) return;
    let flavors = document.getElementById('gmmFlavors').value.split(',').map(s=>s.trim()).filter(Boolean);
    
    if (flavors.length === 0) { container.innerHTML = '<span style="font-size:12px; color:#92400e;">Type flavors above to map them...</span>'; return; }
    
    let html = '';
    flavors.forEach(flavor => {
        let existing = window.gmmCurrentMappings.find(m => m.flavor === flavor) || {};
        
        // This will now use the freshly downloaded list we built in the modal opener!
        let dropHtml = window.cachedInventoryOptions || '<option value="">-- Select Raw Ingredient --</option>';
        if (existing.linkedIngredient) dropHtml = dropHtml.replace(`value="${existing.linkedIngredient}"`, `value="${existing.linkedIngredient}" selected`);
        
        html += `
            <div class="gmm-row" data-flavor="${flavor}" style="display:flex; gap:8px; align-items:center; margin-bottom:8px; background:white; padding:8px; border-radius:6px; border:1px solid #fde68a;">
                <div style="flex:1; font-weight:bold; color:#92400e; font-size:13px;">🐙 ${flavor}</div>
                <select class="gmm-ing" style="flex:2; padding:8px; font-size:12px; border:1px solid #fcd34d; border-radius:4px; outline:none; box-sizing:border-box;">${dropHtml}</select>
                <input type="number" class="gmm-qty" placeholder="Qty" value="${existing.deductQty || ''}" style="width:70px; padding:8px; font-size:12px; border:1px solid #fcd34d; border-radius:4px; text-align:center; outline:none; box-sizing:border-box;">
            </div>
        `;
    });
    container.innerHTML = html;
};

// ==========================================
// 📢 CORPORATE BULLETIN & AI ENGINE
// ==========================================

// --- THE MINI GEMINI AI PROMPT BUILDER ---
window.generateAIPrompt = function() {
    let idea = document.getElementById('aiRoughIdea').value.trim();
    let style = document.getElementById('aiStyle').value;
    if (!idea) return Swal.fire('Oops', 'Type a rough idea first!', 'warning');

    let finalPrompt = `Create an image with the following requirements. \n\nCONTENT: A professional announcement poster conveying this message: "${idea}". \n\nSTYLE: ${style}, extremely high resolution, 8k, aspect ratio 16:9. \n\nTEXT: Ensure any visible text is large, legible, and directly related to the content.`;
    
    document.getElementById('aiFinalPrompt').value = finalPrompt;
};

window.copyAIPrompt = function() {
    let copyText = document.getElementById('aiFinalPrompt');
    copyText.select();
    document.execCommand("copy");
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Copied! Paste into Google Gemini.', showConfirmButton: false, timer: 2000});
};

// --- PUBLISH TO TABLETS ---
window.publishAnnouncement = async function() {
    let title = document.getElementById('announceTitle').value.trim();
    let message = document.getElementById('announceMessage').value.trim();
    let fileInput = document.getElementById('announceImages');

    if (!title) return Swal.fire('Error', 'Title is required', 'error');
    if (!fileInput.files || fileInput.files.length === 0) return Swal.fire('Error', 'At least one image is required', 'error');

    let btn = document.getElementById('btnPublishAnnounce');
    let origText = btn.innerText;
    btn.innerText = "⏳ Uploading..."; btn.disabled = true;

    try {
        let imageUrls = [];
        for (let file of fileInput.files) {
            const fileExt = file.name.split('.').pop();
            const fileName = `announcements/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            const storageRef = ref(db.app.options.storageBucket ? getStorage(db.app) : window.storage, fileName);
            const snapshot = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snapshot.ref);
            imageUrls.push(url);
        }

        await addDoc(collection(db, "announcements"), {
            title: title,
            message: message, // 🔥 SAVES THE NEW MESSAGE FIELD
            images: imageUrls,
            active: true,
            timestamp: serverTimestamp(),
            publisher: window.sessionUser ? window.sessionUser.cashierName : 'Owner'
        });

        Swal.fire({title: '🚀 Deployed!', text: 'Announcement blasted to all branches!', icon: 'success', customClass: { popup: 'rounded-2xl' }});
        
        document.getElementById('announceTitle').value = '';
        document.getElementById('announceMessage').value = '';
        fileInput.value = '';
        if (typeof window.loadAnnouncementHistory === 'function') window.loadAnnouncementHistory();
        
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to publish announcement. Check connection.', 'error');
    } finally {
        btn.innerText = origText; btn.disabled = false;
    }
};

window.loadAnnouncementHistory = async function() {
    const tbody = document.getElementById('announcementHistoryBody');
    if (!tbody) return;
    
    try {
        const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        
        let html = '';
        for (let docSnap of snap.docs) {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Just now';
            
            // 🔥 THE FIX: Strictly define the boolean state so the button math never breaks
            let isActive = d.active === true;
            
            let status = isActive ? '<span style="color:#16a34a; font-weight:bold; background:#dcfce7; padding:4px 8px; border-radius:4px;">Active (Forced)</span>' : '<span style="color:#64748b; font-weight:bold; background:#f1f5f9; padding:4px 8px; border-radius:4px;">Archived</span>';
            
            const sigQ = query(collection(db, "acknowledgments"), where("announcementId", "==", docSnap.id));
            const sigSnap = await getDocs(sigQ);
            let sigCount = sigSnap.size;
            
            let signedNames = [];
            sigSnap.forEach(sDoc => {
                let staffName = sDoc.data().staffName || 'Unknown';
                signedNames.push(staffName);
            });
            
            let namesDisplay = signedNames.length > 0 
                ? `<div style="font-size: 11px; color: #64748b; margin-top: 8px; line-height: 1.4;"><b>Signed by:</b> <span style="color: #4338ca;">${signedNames.join(', ')}</span></div>`
                : `<div style="font-size: 11px; color: #94a3b8; margin-top: 8px; font-style: italic;">No signatures yet</div>`;

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; color: #475569; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 12px; font-weight:bold; color: #1e293b; font-size: 15px;">${d.title}</td>
                    <td style="padding: 12px;">${status}</td>
                    <td style="padding: 12px; text-align: right; vertical-align: top;">
                        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 10px;">
                            <span style="background: #e0e7ff; color: #4338ca; padding: 6px 12px; border-radius: 6px; font-weight: bold;">📝 ${sigCount} Signed</span>
                            <button onclick="window.toggleAnnouncementStatus('${docSnap.id}', ${isActive})" style="background:white; color:#475569; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:bold; transition: 0.2s;">Toggle Status</button>
                        </div>
                        ${namesDisplay}
                    </td>
                </tr>
            `;
        }
        tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding:20px;">No announcements published yet.</td></tr>';
    } catch(e) { console.error(e); }
};

window.toggleAnnouncementStatus = async function(id, currentState) {
    try {
        // 🔥 THE FIX: Freeze the UI so the user can't spam click and crash the Firebase data stream!
        Swal.fire({title: 'Updating Status...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        
        // Guarantee the exact opposite state mathematically
        let newState = (currentState === true) ? false : true;
        
        await updateDoc(doc(db, "announcements", id), { active: newState });
        
        await window.loadAnnouncementHistory();
        
        // Let the user know the state changed cleanly
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: newState ? 'Announcement Activated!' : 'Announcement Archived!', 
            showConfirmButton: false, timer: 1500
        });
    } catch(e) {
        console.error("Toggle Error: ", e);
        Swal.fire('Error', 'Failed to update status. Check your internet connection.', 'error');
    }
};

// ==========================================
// 🏢 SMART HR ROUTING ENGINE
// ==========================================
window.navToHr = function(tabName) {
    // 1. Visually update ALL copies of the nav bar instantly
    document.querySelectorAll('.hr-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-target') === tabName) {
            btn.style.borderBottom = "3px solid #3b82f6";
            btn.style.color = "#0f172a";
        } else {
            btn.style.borderBottom = "3px solid transparent";
            btn.style.color = "#64748b";
        }
    });

    // 2. Route to the correct Master View securely
    if (tabName === 'Feed' || tabName === 'Sanctions') {
        if (typeof window.switchView === 'function') window.switchView('payroll');
        
        // Find the cards inside view-payroll to toggle them dynamically
        let feedCards = document.querySelectorAll('#view-payroll > .card');
        let sanctionsEl = document.getElementById('payrollSectionSanctions');
        
        if (tabName === 'Feed') {
            feedCards.forEach(card => card.style.display = 'block');
            if (sanctionsEl) sanctionsEl.style.display = 'none';
        } else {
            feedCards.forEach(card => card.style.display = 'none');
            if (sanctionsEl) sanctionsEl.style.display = 'block';
            if (typeof window.loadSanctionsDashboard === 'function') window.loadSanctionsDashboard();
        }
    } 
    else if (tabName === 'Schedule') {
        if (typeof window.switchView === 'function') window.switchView('schedule');
    } 
    else if (tabName === 'Ledger') {
        if (typeof window.switchView === 'function') window.switchView('ledger');
    }
};

// ==========================================
// 🧠 SMART SHIFT RULES ENGINE (NON-DESTRUCTIVE SYNC)
// ==========================================

// We use a slight delay to ensure all your original code has loaded before we safely intercept it
setTimeout(() => {
    // 1. Store your original working save function in memory
    const originalSaveShiftRules = window.saveShiftConfigChanges;
    
    // 2. Override the button to add the new Non-Destructive Magic!
    window.saveShiftConfigChanges = async function() {
        let btn = document.querySelector('button[onclick="saveShiftConfigChanges()"]');
        let origText = btn ? btn.innerText : "💾 Save Shift Rules";
        if (btn) { btn.innerText = "⏳ Syncing Rules safely..."; btn.disabled = true; }

        try {
            // Run your original save function so the database updates properly
            if (typeof originalSaveShiftRules === 'function') {
                let result = originalSaveShiftRules();
                if (result instanceof Promise) await result;
            }

            // Display a success message letting you know the staff were protected
            Swal.fire({
                title: '✅ Rules Synced!',
                text: 'Shift times and days updated successfully. Your assigned staff were NOT removed!',
                icon: 'success',
                timer: 3000,
                showConfirmButton: false,
                customClass: { popup: 'rounded-2xl' }
            });
            
            // 3. THE MAGIC: Soft-refresh the calendar visually without wiping the data!
            let container = document.getElementById('scheduleContainer');
            if (container) {
                container.innerHTML = '<div style="text-align:center; padding: 40px; color:#3b82f6; font-weight:bold; font-size:16px;">🔄 Applying new rules to calendar...</div>';
                
                setTimeout(async () => {
                    try {
                        // Re-download the database to grab the new shift names
                        const schedSnap = await window.getDoc(window.doc(window.db, "settings", "global_schedule"));
                        if (schedSnap.exists()) {
                            let data = schedSnap.data();
                            
                            // Load the protected memory variables
                            window.currentSchedule = data.currentSchedule || {};
                            window.branchConfig = data.branchConfig || {};
                            
                            // Redraw the visual calendar seamlessly
                            if (typeof window.renderScheduleGrid === 'function') {
                                window.renderScheduleGrid();
                            } else if (typeof window.navToHr === 'function') {
                                window.navToHr('Schedule');
                            }
                        }
                    } catch(e) { 
                        console.error("Soft Refresh Error:", e); 
                    }
                }, 1000);
            }
        } catch (error) {
            console.error(error);
        } finally {
            if (btn) { btn.innerText = origText; btn.disabled = false; }
        }
    };
}, 1500);

// ==========================================
// 📈 LIFETIME REMITTANCE & TREND ENGINE (FIXED)
// ==========================================

window.loadRemittanceAnalytics = async function() {
    const lifetimeContainer = document.getElementById('lifetimeRemittanceTabs');
    const ctx = document.getElementById('remittanceTrendChart');
    if (!lifetimeContainer) return;

    lifetimeContainer.innerHTML = '<div style="color:#64748b; font-weight:bold; padding: 15px;">⏳ Calculating entire network history...</div>';

    try {
        // 1. Fetch ALL transfers (Completely ignores the top date/branch filters!)
        const snap = await getDocs(collection(db, "cash_transfers"));
        
        let branchLifetime = {};
        let branchMonthly = {}; 
        let allMonths = new Set();
        let hasValidData = false;

        snap.forEach(doc => {
            let d = doc.data();
            let s = (d.status || '').toLowerCase();
            
            // 🔥 THE FIX: Accept ANY status as long as it isn't explicitly rejected, voided, or failed!
            let isApproved = !['rejected', 'declined', 'cancelled', 'void', 'voided', 'failed'].includes(s);
            
            // 🔥 THE FIX: Aggressively search for the branch name using every possible variable
            let branchName = d.branch || d.fromBranch || d.senderBranch || (d.fromAccount ? d.fromAccount.split(' - ')[0] : null);
            
            if (isApproved && branchName && branchName !== 'Main Office' && branchName !== 'HQ') {
                // 🔥 THE FIX: Aggressively search for the amount using every possible variable
                let amt = parseFloat(d.amount) || parseFloat(d.remittedAmount) || parseFloat(d.total) || parseFloat(d.cashAmount) || 0;
                
                if (amt > 0) {
                    hasValidData = true;
                    if (!branchLifetime[branchName]) branchLifetime[branchName] = 0;
                    branchLifetime[branchName] += amt;

                    // Extract the date properly to group by Month & Year (e.g. "Jul 2026")
                    let dateObj = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp || d.date || d.createdAt || Date.now());
                    let monthStr = dateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' }); 
                    allMonths.add(monthStr);

                    if (!branchMonthly[branchName]) branchMonthly[branchName] = {};
                    if (!branchMonthly[branchName][monthStr]) branchMonthly[branchName][monthStr] = 0;
                    branchMonthly[branchName][monthStr] += amt;
                }
            }
        });

        // 2. 🏆 RENDER THE LIFETIME BOXES
        let lifetimeHtml = '';
        let colors = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#f43f5e', '#14b8a6'];
        let colorIdx = 0;

        if (!hasValidData) {
            lifetimeHtml = '<div style="flex: 1; text-align: center; padding: 15px; color: #ef4444; font-weight:bold;">No historical remittances found yet.</div>';
        } else {
            // Sort branches alphabetically
            let sortedBranches = Object.keys(branchLifetime).sort();
            for (const branch of sortedBranches) {
                let total = branchLifetime[branch];
                let color = colors[colorIdx % colors.length];
                lifetimeHtml += `
                    <div style="flex: 1; min-width: 200px; background: white; border: 1px solid #cbd5e1; border-left: 5px solid ${color}; padding: 15px 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                        <div style="font-size: 11px; font-weight: 900; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">${branch}</div>
                        <div style="font-size: 22px; font-weight: 900; color: #0f172a; margin-top: 5px;">₱${total.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                    </div>
                `;
                colorIdx++;
            }
        }
        lifetimeContainer.innerHTML = lifetimeHtml;

        // 3. 📈 RENDER THE TREND GRAPH
        if (!ctx) return;
        
        let sortedMonths = Array.from(allMonths).sort((a, b) => new Date(a) - new Date(b));
        let datasets = [];
        colorIdx = 0;
        
        for (const branch of Object.keys(branchMonthly).sort()) {
            let dataPoints = sortedMonths.map(m => branchMonthly[branch][m] || 0);
            datasets.push({
                label: branch,
                data: dataPoints,
                borderColor: colors[colorIdx % colors.length],
                backgroundColor: colors[colorIdx % colors.length] + '33', // 20% opacity fill
                borderWidth: 3,
                tension: 0.4, // Makes the line smoothly curved
                fill: true,
                pointBackgroundColor: 'white',
                pointBorderColor: colors[colorIdx % colors.length],
                pointRadius: 4
            });
            colorIdx++;
        }

        // Destroy old chart if it exists to prevent glitching
        if (window.remittanceChartInstance) {
            window.remittanceChartInstance.destroy();
        }

        // If no data exists yet, push a blank placeholder so the chart doesn't crash
        if (datasets.length === 0) {
            datasets.push({ label: 'Awaiting Data', data: [0], borderColor: '#cbd5e1' });
            sortedMonths.push('No Data');
        }

        window.remittanceChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedMonths,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { font: { weight: 'bold', family: 'Segoe UI' } } },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleFont: { size: 14 },
                        bodyFont: { size: 14, weight: 'bold' },
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ₱' + context.raw.toLocaleString(undefined, {minimumFractionDigits:2});
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { weight: 'bold' } } },
                    y: { 
                        beginAtZero: true,
                        grid: { borderDash: [5, 5] },
                        ticks: { 
                            font: { weight: 'bold' },
                            callback: function(value) { return '₱' + value.toLocaleString(); } 
                        }
                    }
                }
            }
        });

    } catch(e) {
        console.error("Error loading remittance analytics:", e);
        lifetimeContainer.innerHTML = '<div style="color:#ef4444; padding:15px; font-weight:bold;">Failed to load lifetime data. Check console.</div>';
    }
};

// 🔥 THE FIX: Safely hook into the explorer function so we NEVER break the top boxes again!
setTimeout(() => {
    const oldExplorer = window.loadCashExplorer;
    window.loadCashExplorer = async function() {
        if (typeof oldExplorer === 'function') {
            try { await oldExplorer(); } catch(e) { console.error("Explorer Error:", e); }
        }
        // Run our new graph right after the top boxes finish safely loading!
        window.loadRemittanceAnalytics();
    };
}, 1500);

// ========================================================
// 📥 UPGRADED GLOBAL SALES EXPORTER (WITH ITEMS SOLD)
// ========================================================
window.exportDashboardSalesCSV = async function() {
    // 1. Grab the filters exactly as they appear on the Global Dashboard
    let branchSelect = document.getElementById('globalBranchFilter');
    let startDateInput = document.getElementById('globalStartDate');
    let endDateInput = document.getElementById('globalEndDate');

    let branch = branchSelect ? branchSelect.value : 'All';
    let startDateVal = startDateInput ? startDateInput.value : new Date().toISOString().split('T')[0];
    let endDateVal = endDateInput ? endDateInput.value : new Date().toISOString().split('T')[0];

    if (branch.includes("All")) branch = "All"; // Normalize "All Branches"

    let btn = document.getElementById('btnExportSales');
    let oldText = btn ? btn.innerText : "📥 Export Sales CSV";
    if (btn) { btn.innerText = "⏳ Generating Excel..."; btn.disabled = true; }

    try {
        // 2. Set precise timeframes for Firebase querying
        let startOfDay = new Date(startDateVal);
        startOfDay.setHours(0, 0, 0, 0);
        let endOfDay = new Date(endDateVal);
        endOfDay.setHours(23, 59, 59, 999);

        let q;
        if (branch === "All") {
            q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        } else {
            q = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
        }

        const snap = await getDocs(q);

        if (snap.empty) {
            Swal.fire('No Data', 'No sales found for this date range.', 'info');
            if (btn) { btn.innerText = oldText; btn.disabled = false; }
            return;
        }

        // 3. 🌟 THE UPGRADE: Added "Items Sold" to the header!
        let csv = "OR#,Branch,Cashier,Customer,Items Sold,Gross Total,Discount,Net Total,Payment Method,Status,Date,Time\n";

        snap.forEach(docSnap => {
            let tx = docSnap.data();
            let d = tx.timestamp ? tx.timestamp.toDate() : new Date();
            let dateStr = d.toLocaleDateString('en-PH');
            let timeStr = d.toLocaleTimeString('en-PH');

            // 🍔 Extract the Cart Items and Add-ons cleanly!
            let itemsArr = [];
            if (tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let itemName = item.name || item.itemName;
                    let itemLine = `${item.qty}x ${itemName}`;
                    
                    // Include any add-ons they purchased
                    if (item.addons) {
                        for (let key in item.addons) {
                            if (item.addons[key].qty > 0) {
                                itemLine += ` (+${item.addons[key].qty} ${key})`;
                            }
                        }
                    }
                    itemsArr.push(itemLine);
                });
            }
            let itemsJoined = itemsArr.join(" | ").replace(/"/g, '""'); // Format safely for CSV

            let gross = (tx.subTotalBeforeDiscount || tx.netTotal || 0).toFixed(2);
            let disc = (tx.globalDiscountAmount || 0).toFixed(2);
            let net = (tx.netTotal || 0).toFixed(2);

            let customer = (tx.customerName || 'Guest').replace(/"/g, '""');
            let cashier = (tx.cashier || 'Unknown').replace(/"/g, '""');
            let method = (tx.paymentMethod || 'Cash').replace(/"/g, '""');
            let status = (tx.status || 'Paid').replace(/"/g, '""');

            // Wrap every value in double quotes so Excel handles commas and formatting smoothly
            csv += `"${tx.receiptId || 'N/A'}","${tx.branch}","${cashier}","${customer}","${itemsJoined}","${gross}","${disc}","${net}","${method}","${status}","${dateStr}","${timeStr}"\n`;
        });

        // 4. Force UTF-8 encoding for Excel (This guarantees the Peso sign ₱ shows up perfectly!)
        let csvFile = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        let downloadLink = document.createElement("a");
        let safeBranchName = branch.replace(/[^a-zA-Z0-9]/g, '_');
        downloadLink.download = `Takodeal_${safeBranchName}_Sales_${startDateVal}_to_${endDateVal}.csv`;
        downloadLink.href = window.URL.createObjectURL(csvFile);
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

    } catch (error) {
        console.error("Export Error:", error);
        Swal.fire('Error', 'Failed to generate CSV. Please check your internet connection.', 'error');
    } finally {
        if (btn) { btn.innerText = oldText; btn.disabled = false; }
    }
};

// ========================================================
// 📥 MASTER EXCEL EXPORTER (INTELLIGENT INTERCEPTOR)
// ========================================================
window.downloadExcel = async function(tbodyId, fileName) {
    let tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    let table = tbody.closest('table');
    if (!table) return;

    let headers = Array.from(table.querySelectorAll('th, td')).map(cell => cell.innerText.trim().toUpperCase());

    // 🔥 INTERCEPTOR: If it's the Transactions tab, fetch directly from Cloud!
    if (headers.includes('OR#') || headers.includes('OR #') || tbodyId === 'historyTableBody' || tbodyId === 'tbTransBody') {
        let btn = document.activeElement;
        let oldText = btn && btn.tagName === 'BUTTON' ? btn.innerText : "Export Active Tab";
        if (btn && btn.tagName === 'BUTTON') { btn.innerText = "⏳ Fetching Items..."; btn.disabled = true; }

        try {
            let startInput = document.getElementById('histStartDate');
            let endInput = document.getElementById('histEndDate');
            let branchSelect = document.getElementById('histBranchFilter');

            let startDateVal = startInput ? startInput.value : new Date().toISOString().split('T')[0];
            let endDateVal = endInput ? endInput.value : new Date().toISOString().split('T')[0];

            let branch = 'All';
            if (branchSelect) {
                branch = branchSelect.value;
                if (branch.includes("All")) branch = "All";
            }

            let startOfDay = new Date(startDateVal);
            startOfDay.setHours(0, 0, 0, 0);
            let endOfDay = new Date(endDateVal);
            endOfDay.setHours(23, 59, 59, 999);

            // 🔥 THE FIX: Removed 'window.' from Firebase commands!
            let q;
            if (branch === "All") {
                q = query(collection(db, "transactions"), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
            } else {
                q = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startOfDay), where("timestamp", "<=", endOfDay), orderBy("timestamp", "desc"));
            }

            const snap = await getDocs(q);

            if (snap.empty) {
                Swal.fire('No Data', 'No transactions found for this date range.', 'info');
                if (btn && btn.tagName === 'BUTTON') { btn.innerText = oldText; btn.disabled = false; }
                return;
            }

            let csv = "OR#,Branch,Cashier,Customer,Items Sold,Gross Amount,Discount,Net Amount,Payment Method,Status,Date,Time\n";

            snap.forEach(docSnap => {
                let tx = docSnap.data();
                let d = tx.timestamp ? (tx.timestamp.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp)) : new Date();
                let dateStr = d.toLocaleDateString('en-PH');
                let timeStr = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

                let itemsArr = [];
                if (tx.cart && Array.isArray(tx.cart)) {
                    tx.cart.forEach(item => {
                        let itemName = item.name || item.itemName;
                        let itemLine = `${item.qty}x ${itemName}`;
                        if (item.addons) {
                            for (let key in item.addons) {
                                if (item.addons[key].qty > 0) itemLine += ` (+${item.addons[key].qty} ${key})`;
                            }
                        }
                        itemsArr.push(itemLine);
                    });
                }
                let itemsJoined = itemsArr.join(" | ").replace(/"/g, '""');

                let gross = (tx.subTotalBeforeDiscount || tx.netTotal || 0).toFixed(2);
                let disc = (tx.globalDiscountAmount || 0).toFixed(2);
                let net = (tx.netTotal || 0).toFixed(2);
                let customer = (tx.customerName || 'Guest').replace(/"/g, '""');
                let cashier = (tx.cashier || 'Unknown').replace(/"/g, '""');

                let method = tx.paymentMethod || 'Cash';
                if (tx.splitDetails && Array.isArray(tx.splitDetails)) {
                    method = tx.splitDetails.map(s => `${s.method}`).join(' & ');
                }
                method = method.replace(/"/g, '""');
                let status = (tx.status || 'Paid').replace(/"/g, '""');

                csv += `"${tx.receiptId || 'N/A'}","${tx.branch}","${cashier}","${customer}","${itemsJoined}","₱${gross}","₱${disc}","₱${net}","${method}","${status}","${dateStr}","${timeStr}"\n`;
            });

            let csvFile = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
            let downloadLink = document.createElement("a");
            let safeBranchName = branch.replace(/[^a-zA-Z0-9]/g, '_');
            downloadLink.download = `Takodeal_${safeBranchName}_Transactions_${startDateVal}_to_${endDateVal}.csv`;
            downloadLink.href = window.URL.createObjectURL(csvFile);
            downloadLink.style.display = "none";
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

        } catch (error) {
            console.error("Export Error:", error);
            Swal.fire('Error', 'Failed to generate CSV. Check connection.', 'error');
        } finally {
            if (btn && btn.tagName === 'BUTTON') { btn.innerText = oldText; btn.disabled = false; }
        }
        return;
    }

    // ==========================================
    // 📺 STANDARD SCREEN SCRAPER
    // ==========================================
    let rows = table.querySelectorAll('tr');
    let csv = [];
    let hideLastColExcel = false;

    for (let i = 0; i < rows.length; i++) {
        let row = [], cols = rows[i].querySelectorAll('td, th');
        let colCount = cols.length;

        let lastColText = cols[colCount - 1] ? cols[colCount - 1].innerText.trim().toUpperCase() : '';
        if (i === 0 && (lastColText === 'ACTION' || lastColText === 'VIEW' || lastColText === 'DETAILS')) {
            hideLastColExcel = true;
        }
        if (hideLastColExcel) colCount -= 1;

        for (let j = 0; j < colCount; j++) {
            let text = cols[j].innerText.replace(/"/g, '""').replace(/₱/g, '₱');
            row.push('"' + text + '"');
        }
        csv.push(row.join(","));
    }

    let csvFile = new Blob(["\uFEFF" + csv.join("\n")], {type: "text/csv;charset=utf-8;"});
    let tempLink = document.createElement("a");
    let dateTag = new Date().toISOString().split('T')[0];

    tempLink.download = `${fileName}_${dateTag}.csv`;
    tempLink.href = window.URL.createObjectURL(csvFile);
    tempLink.style.display = "none";
    document.body.appendChild(tempLink); tempLink.click(); document.body.removeChild(tempLink);
};

// ========================================================
// 🤝 FRANCHISE SIMULATOR & P&L ANALYTICS ENGINE
// ========================================================
window.runFranchiseSimulator = async function() {
    let branch = document.getElementById('simBranchSelect').value;
    let days = parseInt(document.getElementById('simDaysSelect').value);
    
    let btn = document.querySelector('button[onclick="runFranchiseSimulator()"]');
    btn.innerText = "⏳ Crunching..."; btn.disabled = true;

    let startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0,0,0,0);

    try {
        const menuSnap = await getDocs(collection(db, "menu"));
        let menuCategories = {};
        menuSnap.forEach(doc => {
            let item = doc.data();
            let cat = (item.category || "Takoyaki").toLowerCase(); 
            menuCategories[item.name] = cat;
        });

        // Fetch Transactions
        let txQ = branch === "All" 
            ? query(collection(db, "transactions"), where("timestamp", ">=", startDate))
            : query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", startDate));
        const txSnap = await getDocs(txQ);

        // Fetch Actual Expenses!
        let expQ = branch === "All"
            ? query(collection(db, "expenses"), where("timestamp", ">=", startDate))
            : query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", startDate));
        const expSnap = await getDocs(expQ);

        window.simulatedData = { tako: 0, tea: 0, coffee: 0, totalSales: 0, totalOpEx: 0, days: days };
        let activeBranchesFound = new Set();

        // Tally Sales
        txSnap.forEach(docSnap => {
            let tx = docSnap.data();
            if (tx.status === "Voided") return;
            activeBranchesFound.add(tx.branch);

            let txTotal = 0;
            if (tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let itemName = item.name || item.itemName;
                    let lineTotal = (item.variantPrice || item.basePrice || 0) * (item.qty || 1);
                    txTotal += lineTotal;
                    
                    let cat = menuCategories[itemName] || "takoyaki";
                    if (cat.includes("tea") || cat.includes("beverage") || cat.includes("drinks")) window.simulatedData.tea += lineTotal;
                    else if (cat.includes("coffee") || cat.includes("espresso")) window.simulatedData.coffee += lineTotal;
                    else window.simulatedData.tako += lineTotal;
                });
            }
            window.simulatedData.totalSales += txTotal;
        });

        // Tally Expenses (Exclude Remittances/Store Use so we get true Operating Expenses)
        expSnap.forEach(docSnap => {
            let exp = docSnap.data();
            let cat = (exp.category || "").toLowerCase();
            let desc = (exp.description || "").toLowerCase();
            if (!desc.includes("remittance") && cat !== "store consumables") {
                window.simulatedData.totalOpEx += (parseFloat(exp.amount) || 0);
            }
        });

        let branchDivisor = (branch === "All" && activeBranchesFound.size > 0) ? activeBranchesFound.size : 1;
        
        // Averages per branch
        window.simulatedData.tako /= branchDivisor;
        window.simulatedData.tea /= branchDivisor;
        window.simulatedData.coffee /= branchDivisor;
        window.simulatedData.totalSales /= branchDivisor;
        window.simulatedData.totalOpEx /= branchDivisor;

        document.getElementById('simTakoSales').innerText = `₱${window.simulatedData.tako.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        document.getElementById('simTeaSales').innerText = `₱${window.simulatedData.tea.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        document.getElementById('simCoffeeSales').innerText = `₱${window.simulatedData.coffee.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;

        document.getElementById('simTakoAvg').innerText = `₱${(window.simulatedData.tako / days).toLocaleString(undefined, {maximumFractionDigits:0})}`;
        document.getElementById('simTeaAvg').innerText = `₱${(window.simulatedData.tea / days).toLocaleString(undefined, {maximumFractionDigits:0})}`;
        document.getElementById('simCoffeeAvg').innerText = `₱${(window.simulatedData.coffee / days).toLocaleString(undefined, {maximumFractionDigits:0})}`;

        document.getElementById('simResultsContainer').style.display = 'block';
        window.calculateSimulatedRoyalty(); 

    } catch(e) {
        console.error("Simulator Error:", e);
        alert("Failed to run simulation. Check connection.");
    } finally {
        btn.innerText = "📊 Crunch Numbers"; btn.disabled = false;
    }
};

window.calculateSimulatedRoyalty = function() {
    if (!window.simulatedData) return;

    let takoPct = parseFloat(document.getElementById('simTakoPct').value) || 0;
    let teaPct = parseFloat(document.getElementById('simTeaPct').value) || 0;
    let coffeePct = parseFloat(document.getElementById('simCoffeePct').value) || 0;
    let foodCostPct = parseFloat(document.getElementById('simFoodCostPct').value) || 35; // Default 35%
    let franchiseCost = parseFloat(document.getElementById('simFranchiseCost').value) || 350000;

    let takoFee = window.simulatedData.tako * (takoPct / 100);
    let teaFee = window.simulatedData.tea * (teaPct / 100);
    let coffeeFee = window.simulatedData.coffee * (coffeePct / 100);
    let totalRoyaltyFee = takoFee + teaFee + coffeeFee;

    document.getElementById('simTakoFee').innerText = `₱${takoFee.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    document.getElementById('simTeaFee').innerText = `₱${teaFee.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    document.getElementById('simCoffeeFee').innerText = `₱${coffeeFee.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    
    // --- P&L MATH ---
    let grossSales = window.simulatedData.totalSales;
    let estCogs = grossSales * (foodCostPct / 100);
    // Net Profit = Gross - COGS - Real Expenses - Simulated Royalty
    let netProfit = grossSales - estCogs - window.simulatedData.totalOpEx - totalRoyaltyFee;
    let netMargin = grossSales > 0 ? (netProfit / grossSales) * 100 : 0;

    document.getElementById('simPlSales').innerText = `₱${grossSales.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    document.getElementById('simPlCogs').innerText = `- ₱${estCogs.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    document.getElementById('simPlOpex').innerText = `- ₱${window.simulatedData.totalOpEx.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    
    let netEl = document.getElementById('simPlNet');
    netEl.innerText = `₱${netProfit.toLocaleString(undefined, {minimumFractionDigits:2})}`;
    netEl.style.color = netProfit >= 0 ? '#0f766e' : '#dc2626'; // Red if losing money!
    
    document.getElementById('simPlMargin').innerText = `${netMargin.toFixed(1)}%`;
    document.getElementById('simPlMargin').style.color = netMargin >= 15 ? '#16a34a' : (netMargin > 0 ? '#d97706' : '#dc2626');

    // --- ROI MATH ---
    // Convert the selected period profit into a Monthly average to calculate ROI
    let monthlyAvgProfit = (netProfit / window.simulatedData.days) * 30;
    let roiMonths = monthlyAvgProfit > 0 ? (franchiseCost / monthlyAvgProfit) : 0;
    
    let roiEl = document.getElementById('simRoiMonths');
    if (roiMonths > 0) {
        roiEl.innerText = `${roiMonths.toFixed(1)} Months`;
        roiEl.style.color = roiMonths <= 18 ? '#0284c7' : '#dc2626'; // Warning if it takes too long
    } else {
        roiEl.innerText = "Never (Losing Money)";
        roiEl.style.color = '#dc2626';
    }
};

// ========================================================
// ✅ MANAGER GCASH / GRAB VERIFICATION ENGINE
// ========================================================
window.verifyDigitalPayment = async function(docId, receiptId) {
    if (!confirm(`Confirm receipt of funds for Order ${receiptId} into the bank account?`)) return;
    
    try {
        await updateDoc(doc(db, "transactions", docId), {
            paymentVerified: true,
            verifiedBy: window.sessionUser ? window.sessionUser.cashierName : 'Manager',
            verifiedAt: serverTimestamp()
        });
        
        // Refresh the modal to show the green badge!
        let branchTitle = document.getElementById('modalBranchName').innerText.replace('📊 ', '').replace(' Analytics', '');
        window.openBranchDetails(branchTitle);

        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Payment Verified!', showConfirmButton: false, timer: 1500
        });
    } catch(e) {
        console.error("Verification Error:", e);
        alert("Failed to verify payment. Check connection.");
    }
};

// ========================================================
// ✅ BULK VERIFICATION ENGINE
// ========================================================
window.bulkVerifyDigitalPayments = async function() {
    // Automatically scrapes the screen for all unverified buttons!
    let buttons = document.querySelectorAll('.btn-bulk-verify');
    if (buttons.length === 0) {
        Swal.fire({
            title: 'All Caught Up!', 
            text: 'There are no pending digital payments to verify.', 
            icon: 'info',
            customClass: { popup: 'rounded-2xl' }
        });
        return;
    }
    
    if (!confirm(`Are you sure you want to verify all ${buttons.length} pending digital payments?`)) return;
    
    Swal.fire({title: 'Verifying All...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    
    try {
        let promises = [];
        buttons.forEach(btn => {
            let docId = btn.getAttribute('data-txid');
            promises.push(updateDoc(doc(db, "transactions", docId), {
                paymentVerified: true,
                verifiedBy: window.sessionUser ? window.sessionUser.cashierName : 'Manager',
                verifiedAt: serverTimestamp()
            }));
        });
        
        await Promise.all(promises);
        
        // Refresh the modal to show the green badges
        let branchTitle = document.getElementById('modalBranchName').innerText.replace('📊 ', '').replace(' Analytics', '');
        window.openBranchDetails(branchTitle);
        
        Swal.fire({
            title: 'Success', 
            text: `Successfully verified ${buttons.length} payments!`, 
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
    } catch(e) {
        console.error("Bulk Verify Error:", e);
        Swal.fire('Error', 'Failed to bulk verify. Check connection.', 'error');
    }
};

// ========================================================
// ✨ MINI GEMINI PROMPT BUILDER (TAKODEÁL EDITION)
// ========================================================
window.generateAIPrompt = function() {
    const roughIdea = document.getElementById('aiRoughIdea').value.trim();
    const style = document.getElementById('aiStyle');
    const styleText = style.options[style.selectedIndex].text;
    const finalPromptEl = document.getElementById('aiFinalPrompt');

    if (!roughIdea) {
        Swal.fire({
            title: 'Hold on!', 
            text: 'Please type a rough idea for the announcement first.', 
            icon: 'warning',
            customClass: { popup: 'rounded-2xl' }
        });
        return;
    }

    // 🔥 This is the "Secret Sauce" - Injecting your exact brand DNA into the prompt!
    const engineeredPrompt = `Act as an Expert Corporate Communications Director and Master Graphic Designer for TAKODEÁL, a premium fast-growing Takoyaki and beverage franchise based in Davao City.

I need you to generate a highly detailed, professional image generation prompt and the exact copy/text for an internal staff poster.

THE ROUGH IDEA / TOPIC:
"${roughIdea}"

VISUAL STYLE REQUIRED:
${styleText}

TAKODEÁL BRANDING GUIDELINES:
- Colors: Deep slate/black, vibrant amber/orange, and crisp white.
- Audience: Branch Cashiers, Cooks, and Prep Staff.
- Tone: Professional, authoritative, highly readable, yet motivating and clear.

YOUR TASK:
1. Write a 1-paragraph image generation prompt (for an AI like Midjourney or DALL-E) that perfectly describes the layout, lighting, colors, and visual elements of this poster.
2. Below that, write the exact headline, sub-headline, and bullet points I should type onto the poster. Make the text punchy, strict, and easy for fast-paced food service staff to digest quickly.`;

    finalPromptEl.value = engineeredPrompt;
    
    // Quick visual flash to show it worked
    finalPromptEl.style.borderColor = "#10b981";
    finalPromptEl.style.backgroundColor = "#ecfdf5";
    setTimeout(() => {
        finalPromptEl.style.borderColor = "#8b5cf6";
        finalPromptEl.style.backgroundColor = "#f5f3ff";
    }, 500);
};

window.copyAIPrompt = function() {
    const finalPromptEl = document.getElementById('aiFinalPrompt');
    if (!finalPromptEl.value) {
        Swal.fire('Empty', 'Generate a prompt first before copying!', 'info');
        return;
    }
    
    // Highlight and copy the text
    finalPromptEl.select();
    document.execCommand("copy");
    
    Swal.fire({
        toast: true, position: 'top-end', icon: 'success', 
        title: '📋 Prompt Copied!', 
        text: 'Paste this into Google Gemini to get your exact design and wording.',
        showConfirmButton: false, timer: 3000,
        customClass: { popup: 'rounded-2xl shadow-xl border border-gray-100' }
    });
};

// ========================================================
// 💾 CSV ARCHIVE & PURGE ENGINE (STORAGE CLEANER)
// ========================================================
window.purgeOldWasteData = async function() {
    if(!confirm("⚠️ DATA PURGE: This will download all Approved/Rejected Waste Reports older than 30 days as an Excel CSV, and permanently delete them from the database to save memory.\n\nProceed?")) return;

    Swal.fire({title: "Scanning database...", didOpen: () => Swal.showLoading()});

    let thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
        const q = query(collection(db, "staff_requests"), where("type", "==", "Waste Report"), where("timestamp", "<", thirtyDaysAgo));
        const snap = await getDocs(q);

        if(snap.empty) {
            Swal.fire("All Clean!", "No waste reports older than 30 days found in the system.", "success");
            return;
        }

        let csvContent = "Date,Branch,Staff,Item,Qty,UOM,Reason,Status,Photo URL\n";
        let batchPromises = [];

        snap.forEach(docSnap => {
            let data = docSnap.data();
            // Don't delete pending requests, even if they are old!
            if (data.status === "Pending") return; 

            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : "Unknown";

            if (data.items) {
                data.items.forEach(item => {
                    // Wrap text in quotes to prevent commas from breaking the CSV
                    let row = `"${dateStr}","${data.branch}","${data.staffName}","${item.name}","${item.rawQty}","${item.displayUom}","${item.reason}","${data.status}","${item.photoUrl || 'No Photo Attached'}"`;
                    csvContent += row + "\n";
                });
            }
            batchPromises.push(deleteDoc(doc(db, "staff_requests", docSnap.id)));
        });

        if (batchPromises.length === 0) {
            Swal.fire("No Action Needed", "Only Pending requests were found older than 30 days.", "info");
            return;
        }

        // 1. Trigger the automatic CSV File Download to the Owner's PC
        let blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        let link = document.createElement("a");
        let url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Takodeal_Waste_Archive_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 2. Permanently delete the old records from Firebase
        await Promise.all(batchPromises);

        Swal.fire("✅ System Cleaned", `Downloaded CSV and successfully purged ${batchPromises.length} old records from the database!`, "success");

    } catch (e) {
        console.error("Purge Error:", e);
        Swal.fire("Error", "Failed to run the purge process.", "error");
    }
};

// ========================================================
// 🚚 UPGRADED LOGISTICS HUB (PER-BRANCH & TIME TABS)
// ========================================================
window.logisticsState = {
    activeBranch: 'All', // Defaults to showing all
    activeTab: 'requests', // Defaults to Stock Requests
    timeFilter: 'All', // 🔥 NEW DATE FILTER STATE
    requests: [],
    deliveries: []
};

window.startLogisticsListeners = function() {
    onSnapshot(collection(db, "purchase_orders"), (snap) => {
        window.logisticsState.requests = [];
        snap.forEach(doc => window.logisticsState.requests.push({id: doc.id, ...doc.data()}));
        window.logisticsState.requests.sort((a,b) => b.timestamp - a.timestamp);
        window.renderLogisticsUI();
    });

    onSnapshot(collection(db, "dispatch_logs"), (snap) => {
        window.logisticsState.deliveries = [];
        snap.forEach(doc => window.logisticsState.deliveries.push({id: doc.id, ...doc.data()}));
        window.logisticsState.deliveries.sort((a,b) => b.timestamp - a.timestamp);
        window.renderLogisticsUI();
    });
};

window.switchLogisticsBranch = function(branch) {
    window.logisticsState.activeBranch = branch;
    window.renderLogisticsUI();
};

window.switchLogisticsTimeFilter = function(filter) {
    window.logisticsState.timeFilter = filter;
    window.renderLogisticsUI();
};

window.switchLogisticsTab = function(tab) {
    window.logisticsState.activeTab = tab;
    
    let reqBtn = document.getElementById('tabLogRequests');
    let delBtn = document.getElementById('tabLogDeliveries');
    
    if (tab === 'requests') {
        reqBtn.style.borderBottom = '3px solid #0ea5e9'; reqBtn.style.color = '#0ea5e9'; reqBtn.style.background = 'white';
        delBtn.style.borderBottom = '3px solid transparent'; delBtn.style.color = '#64748b'; delBtn.style.background = 'transparent';
    } else {
        delBtn.style.borderBottom = '3px solid #0ea5e9'; delBtn.style.color = '#0ea5e9'; delBtn.style.background = 'white';
        reqBtn.style.borderBottom = '3px solid transparent'; reqBtn.style.color = '#64748b'; reqBtn.style.background = 'transparent';
    }
    window.renderLogisticsUI();
};

window.renderLogisticsUI = function() {
    let reqData = window.logisticsState.requests;
    let delData = window.logisticsState.deliveries;
    
    // 1. APPLY TIME FILTER
    let now = new Date();
    let cutoffDate = null;
    
    if (window.logisticsState.timeFilter === 'Today') {
        cutoffDate = new Date(now.setHours(0,0,0,0));
    } else if (window.logisticsState.timeFilter === 'Week') {
        cutoffDate = new Date(); cutoffDate.setDate(now.getDate() - 7);
    } else if (window.logisticsState.timeFilter === 'Month') {
        cutoffDate = new Date(); cutoffDate.setDate(now.getDate() - 30);
    }

    if (cutoffDate) {
        reqData = reqData.filter(r => { let d = r.timestamp ? (r.timestamp.toDate ? r.timestamp.toDate() : new Date(r.timestamp)) : new Date(0); return d >= cutoffDate; });
        delData = delData.filter(d => { let dt = d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate() : new Date(d.timestamp)) : new Date(d.date || 0); return dt >= cutoffDate; });
    }

    // 2. Branch Badges
    let branches = new Set(["Cabantian", "Citygate", "Maa"]);
    reqData.forEach(r => { if(r.branch) branches.add(r.branch); });
    delData.forEach(d => { if(d.toBranch) branches.add(d.toBranch); });
    
    let branchTabsHtml = `<button onclick="window.switchLogisticsBranch('All')" style="flex: 1; min-width: 100px; padding: 12px; font-weight: bold; font-size: 13px; border: none; border-bottom: 3px solid ${window.logisticsState.activeBranch === 'All' ? '#10b981' : 'transparent'}; background: ${window.logisticsState.activeBranch === 'All' ? 'white' : 'transparent'}; color: ${window.logisticsState.activeBranch === 'All' ? '#0f172a' : '#64748b'}; cursor: pointer; transition: 0.2s;">🌍 All Branches</button>`;
    
    Array.from(branches).sort().forEach(branch => {
        let pendingReqs = reqData.filter(r => r.branch === branch && (r.status === 'Pending' || r.status === 'Delayed')).length;
        let badgeHtml = pendingReqs > 0 ? `<span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 10px; font-size: 10px; margin-left: 5px;">${pendingReqs}</span>` : '';
        let isActive = window.logisticsState.activeBranch === branch;
        branchTabsHtml += `<button onclick="window.switchLogisticsBranch('${branch}')" style="flex: 1; min-width: 120px; padding: 12px; font-weight: bold; font-size: 13px; border: none; border-bottom: 3px solid ${isActive ? '#10b981' : 'transparent'}; background: ${isActive ? 'white' : 'transparent'}; color: ${isActive ? '#0f172a' : '#64748b'}; cursor: pointer; transition: 0.2s;">📍 ${branch} ${badgeHtml}</button>`;
    });
    document.getElementById('logisticsBranchTabs').innerHTML = branchTabsHtml;

    if (window.logisticsState.activeBranch !== 'All') {
        reqData = reqData.filter(r => r.branch === window.logisticsState.activeBranch);
        delData = delData.filter(d => d.toBranch === window.logisticsState.activeBranch);
    }

    let dispatchGroups = {};
    delData.forEach(del => {
        let groupKey = del.dispatchId || `${del.date}_${del.driver}`;
        if (!dispatchGroups[groupKey]) {
            dispatchGroups[groupKey] = { dispatchId: groupKey, toBranch: del.toBranch, date: del.date, time: del.time, driver: del.driver, status: del.status, items: [] };
        }
        dispatchGroups[groupKey].items.push(del);
    });

    document.getElementById('badgeLogReqs').innerText = reqData.filter(r => r.status === 'Pending' || r.status === 'Delayed').length;
    document.getElementById('badgeLogDels').innerText = Object.keys(dispatchGroups).length;

    let listContainer = document.getElementById('logisticsFeedList');
    let html = '';

    if (window.logisticsState.activeTab === 'requests') {
        if (reqData.length === 0) { html = `<div style="text-align:center; color:#64748b; padding: 60px; font-weight: bold;">No stock requests found.</div>`; } 
        else {
            reqData.forEach(req => {
                let isPending = req.status === 'Pending';
                let isDelayed = req.status && req.status.includes('Delayed');
                let bgCol = isPending || isDelayed ? '#fffbeb' : 'white';
                let borderCol = isPending || isDelayed ? '#fde68a' : '#e2e8f0';
                let statCol = isPending ? '#d97706' : (isDelayed ? '#dc2626' : '#16a34a');
                let dateStr = req.timestamp ? req.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';
                
                html += `
                    <div style="background: ${bgCol}; border: 1px solid ${borderCol}; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0 0 5px 0; color: #b45309; font-size: 16px;">📢 Stock Request from ${req.branch}</h3>
                            <div style="font-size: 13px; color: #92400e; font-weight: 500;">Requested by: ${req.requestedBy || 'Staff'}</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 5px;">📅 ${dateStr} • <strong>${req.items ? req.items.length : 0} items</strong></div>
                        </div>
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <div style="font-weight: bold; font-size: 13px; color: ${statCol};">${req.status}</div>
                            <button onclick="if(typeof window.reviewStockRequest === 'function') window.reviewStockRequest('${req.id}')" style="background: #0ea5e9; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(14,165,233,0.3); transition: 0.2s;">🔍 Review Request</button>
                        </div>
                    </div>
                `;
            });
        }
    } else {
        if (Object.keys(dispatchGroups).length === 0) { html = `<div style="text-align:center; color:#64748b; padding: 60px; font-weight: bold;">No deliveries found.</div>`; } 
        else {
            for (let key in dispatchGroups) {
                let group = dispatchGroups[key];
                
                let hasMissing = group.items.some(i => i.status === 'Lost in Transit' || i.status === 'Discrepancy');
                let allReceived = group.items.every(i => i.status === 'Received');
                
                // 🔥 SMART STATUS ENGINE
                let overallStatus = 'In Transit';
                if (group.items.some(i => i.status === 'In Transit')) overallStatus = 'In Transit';
                else if (group.items.every(i => i.status === 'Arrived' || i.status === 'Received') && !allReceived) overallStatus = 'Arrived at Branch';
                else if (hasMissing) overallStatus = 'Discrepancy / Lost';
                else if (allReceived) overallStatus = 'Received';

                let statCol = overallStatus === 'Received' ? '#16a34a' : (overallStatus === 'Arrived at Branch' ? '#8b5cf6' : (overallStatus === 'In Transit' ? '#0ea5e9' : '#dc2626'));
                
                let encodedGroup = encodeURIComponent(JSON.stringify(group)); 

                let actionButtons = '';
                if (overallStatus === 'In Transit') {
                    actionButtons = `<button onclick="window.markDispatchArrived('${encodedGroup}')" style="background: #8b5cf6; color: white; border: none; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">📍 Mark Arrived</button>`;
                }

                html += `
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0 0 5px 0; color: #0f172a; font-size: 16px;">📍 To: ${group.toBranch}</h3>
                            <div style="font-size: 13px; color: #475569; font-weight: 500;">🚚 Driver: ${group.driver || 'Unknown'}</div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 5px;">📅 ${group.date} at ${group.time} • <strong>${group.items.length} items</strong></div>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div style="background: ${statCol}; color: white; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: bold;">${overallStatus}</div>
                            ${actionButtons}
                            <button onclick="window.viewDeliveryDetails('${encodedGroup}')" style="background: white; color: #0ea5e9; border: 1px solid #bae6fd; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">🔍 Full Details</button>
                        </div>
                    </div>
                `;
            }
        }
    }
    listContainer.innerHTML = html;
};
// Auto-start the new tab engine
setTimeout(window.startLogisticsListeners, 1500);

// ========================================================
// 🔍 STOCK REQUEST REVIEW ENGINE (HQ APPROVALS)
// ========================================================
window.reviewStockRequest = async function(docId) {
    try {
        Swal.fire({title: 'Loading Request...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        
        const docRef = doc(db, "purchase_orders", docId);
        const snap = await getDoc(docRef);
        
        if (!snap.exists()) return Swal.fire('Error', 'This request could not be found.', 'error');
        
        let data = snap.data();
        let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';
        
        let itemsHtml = `
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 15px; text-align: left;">
                <div style="font-size: 12px; color: #64748b; font-weight: bold; text-transform: uppercase;">Requested By</div>
                <div style="font-size: 16px; color: #0f172a; font-weight: 900; margin-bottom: 10px;">👤 ${data.requestedBy || 'Staff'}</div>
                <div style="font-size: 12px; color: #64748b; font-weight: bold; text-transform: uppercase;">Date Submitted</div>
                <div style="font-size: 14px; color: #334155; font-weight: bold;">📅 ${dateStr}</div>
            </div>
            <div style="max-height: 250px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <thead style="background: #1e293b; color: white; position: sticky; top: 0;">
                        <tr>
                            <th style="padding: 10px;">Item Description</th>
                            <th style="padding: 10px; text-align: center;">Qty Requested</th>
                            <th style="padding: 10px; text-align: center;">Alert Type</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.items && data.items.length > 0) {
            data.items.forEach(item => {
                let alertColor = item.requestType === 'Out of Stock' ? '#dc2626' : (item.requestType === 'Low Stock' ? '#d97706' : '#0284c7');
                itemsHtml += `
                    <tr style="border-bottom: 1px solid #e2e8f0; background: white;">
                        <td style="padding: 10px; font-weight: bold; color: #334155;">${item.itemName}</td>
                        <td style="padding: 10px; text-align: center; font-weight: 900; color: #0ea5e9;">${item.displayQty || item.qty} <span style="font-size: 10px; color: #64748b;">${item.displayUom || item.uom}</span></td>
                        <td style="padding: 10px; text-align: center;"><span style="color: ${alertColor}; background: ${alertColor}15; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${item.requestType || 'Request'}</span></td>
                    </tr>
                `;
            });
        }
        itemsHtml += `</tbody></table></div>`;

        let actionResult = await Swal.fire({
            title: `📦 Request from ${data.branch}`,
            html: itemsHtml,
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: '🛒 Load to Dispatch Cart',
            denyButtonText: '❌ Postpone / Set Aside',
            cancelButtonText: 'Close Window',
            confirmButtonColor: '#16a34a',
            denyButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            width: 600,
            customClass: { popup: 'rounded-2xl shadow-2xl' }
        });

        if (actionResult.isConfirmed) {
            // 🔥 THE MEMORY FIX: Properly map fields and save to LocalStorage so it survives the tab switch!
            if (typeof window.dispatchCart === 'undefined') window.dispatchCart = [];
            
            data.items.forEach(reqItem => {
                let existing = window.dispatchCart.find(i => (i.itemName || i.name) === reqItem.itemName);
                let rawReqQty = parseFloat(reqItem.displayQty || reqItem.qty) || 0;
                let baseReqQty = parseFloat(reqItem.qty) || 0;
                
                if (existing) {
                    // 🔥 THE MERGE FIX: Sum the requested quantities!
                    existing.rawQty = (parseFloat(existing.rawQty) || 0) + rawReqQty;
                    existing.qty = (parseFloat(existing.qty) || 0) + baseReqQty;
                    // If it was already in the cart with 0 qty (e.g. out of stock), this forces the input box to wake up!
                    existing.requestType = "Merged Request"; 
                } else {
                    window.dispatchCart.push({
                        itemName: reqItem.itemName,
                        name: reqItem.itemName,
                        rawQty: rawReqQty, 
                        qty: baseReqQty,
                        uom: reqItem.displayUom || reqItem.uom,
                        baseUom: reqItem.uom,
                        friendlyUom: reqItem.displayUom || reqItem.uom,
                        selectedUom: (reqItem.displayUom !== reqItem.uom) ? 'purch' : 'base',
                        convRate: (baseReqQty > 0 && rawReqQty > 0) ? (baseReqQty / rawReqQty) : 1,
                        conversionRate: (baseReqQty > 0 && rawReqQty > 0) ? (baseReqQty / rawReqQty) : 1,
                        sourceId: reqItem.sourceId || reqItem.id,
                        requestType: reqItem.requestType || 'Request',
                        physicalStock: reqItem.physicalStock || 0,
                        systemStock: reqItem.systemStock || 0
                    });
                }
            });

            // 💾 SAVE TO BROWSER MEMORY (This prevents the cart from wiping when the tab switches!)
            localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));
            
            // Auto-set the destination dropdown memory
            localStorage.setItem('takodeal_dispatch_to', data.branch);

            // Link the PO ID so "Clear Cart" or "Send Dispatch" knows which request to update!
            let activePo = localStorage.getItem('takodeal_active_po') || "";
            if (!activePo.includes(docId)) {
                activePo = activePo ? activePo + ',' + docId : docId;
                localStorage.setItem('takodeal_active_po', activePo);
            }

            // Jump to the Dispatch Tab
            if (typeof window.switchView === 'function') window.switchView('dispatch'); 
            
            // Update the Database
            await updateDoc(docRef, {
                status: 'Approved',
                managerMessage: 'Approved and loaded into Dispatch Cart.',
                processedAt: serverTimestamp()
            });
            
            Swal.fire({title: 'Loaded to Cart! 🛒', text: `Items moved to Dispatch for ${data.branch}.`, icon: 'success', timer: 2000, showConfirmButton: false});
            
        } else if (actionResult.isDenied) {
            // 🔥 SET ASIDE / DELAY
            const { value: rejectReason } = await Swal.fire({
                title: 'Set Aside Request',
                input: 'text',
                inputLabel: 'Reason for postponement',
                inputPlaceholder: 'e.g., Out of stock at HQ, arriving tomorrow',
                showCancelButton: true,
                confirmButtonColor: '#dc2626',
                confirmButtonText: 'Submit Reason',
                inputValidator: (value) => { if (!value) return 'You need to provide a reason!'; }
            });
            
            if (rejectReason) {
                Swal.fire({title: 'Updating...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
                await updateDoc(docRef, {
                    status: 'Delayed',
                    managerMessage: rejectReason,
                    processedAt: serverTimestamp()
                });
                Swal.fire('Postponed', 'The request was set aside and the branch was notified.', 'info');
            }
        }
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to load request details.', 'error');
    }
};

// ========================================================
// 🚚 DELIVERY "FULL DETAILS" & RECALL VIEWER
// ========================================================
window.viewDeliveryDetails = function(encodedGroup) {
    let group = JSON.parse(decodeURIComponent(encodedGroup));
    
    // Find receiver info
    let receiverName = '<span style="color:#ef4444; font-style:italic;">Pending</span>';
    let receivedTimeStr = '<span style="color:#ef4444; font-style:italic;">Pending</span>';
    
    let receivedItem = group.items.find(i => i.receivedBy);
    if (receivedItem) {
        receiverName = receivedItem.receivedBy;
        if (receivedItem.receivedAt) {
            let rDate = receivedItem.receivedAt.seconds ? new Date(receivedItem.receivedAt.seconds * 1000) : new Date(receivedItem.receivedAt);
            receivedTimeStr = rDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' + rDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        }
    }

    let headerEl = document.getElementById('dispatchDetailsHeader');
    if(headerEl) {
        headerEl.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div style="border-right: 1px dashed #cbd5e1; padding-right: 15px;">
                    <div style="font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase;">Dispatch Info</div>
                    <div style="margin-top: 5px; color: #0f172a; font-size: 15px;"><strong>📍 To:</strong> ${group.toBranch}</div>
                    <div style="margin-top: 5px; color: #334155;"><strong>🚚 Driver:</strong> ${group.driver}</div>
                    <div style="margin-top: 5px; color: #475569; font-size: 12px;"><strong>📅 Sent:</strong> ${group.date} at ${group.time}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: #0f766e; font-weight: bold; text-transform: uppercase;">Receiving Info</div>
                    <div style="margin-top: 5px;"><strong>👤 Received By:</strong> <span style="color: #0f766e; font-weight: bold;">${receiverName}</span></div>
                    <div style="margin-top: 5px; color: #475569;"><strong>⏰ Arrived:</strong> ${receivedTimeStr}</div>
                </div>
            </div>
        `;
    }
    
    let tbody = document.getElementById('dispatchDetailsBody');
    let html = '';
    
    let canRecall = true; 
    let hasMissing = false; // 🔥 Tracking if we need the new button!
    
    group.items.forEach(item => {
        if (item.status !== 'In Transit') canRecall = false;
        if (item.status === 'Lost in Transit' || item.status === 'Discrepancy') hasMissing = true;

        let statColor = item.status === 'Received' ? '#16a34a' : (item.status === 'In Transit' ? '#0ea5e9' : (item.status === 'Arrived' ? '#8b5cf6' : '#dc2626'));
        let varText = item.variance ? `<span style="color:#dc2626; font-weight:bold;">${item.variance} ${item.uom}</span>` : `<span style="color:#94a3b8;">0</span>`;
        let receivedQty = item.receivedDisplayQty !== undefined ? item.receivedDisplayQty : (item.status === 'In Transit' || item.status === 'Arrived' ? '---' : 0);
        let expectedQty = item.displayQty || item.qty;
        let displayUom = item.displayUom || item.uom;

        let remarksHtml = item.receivingRemarks ? `<div style="font-size:11px; color:#ef4444; margin-top:4px; font-style:italic;">Reason: ${item.receivingRemarks}</div>` : '';
        
        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding:12px; font-weight:bold; color:#334155;">${item.item}</td>
                <td style="padding:12px; font-weight:bold; color:#0f172a; text-align:center;">${expectedQty} <span style="font-size:11px; color:#64748b;">${displayUom}</span></td>
                <td style="padding:12px; font-weight:bold; color:#0ea5e9; text-align:center;">${receivedQty} <span style="font-size:11px; color:#64748b;">${displayUom}</span></td>
                <td style="padding:12px; text-align:center;">${varText}</td>
                <td style="padding:12px; text-align:center;">
                    <span style="background:${statColor}15; color:${statColor}; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; border: 1px solid ${statColor}50;">${item.status}</span>
                    ${remarksHtml}
                </td>
            </tr>
        `;
    });
    
    if(tbody) tbody.innerHTML = html;

    let footerEl = document.getElementById('dispatchDetailsFooter');
    if (footerEl) {
        footerEl.innerHTML = '';
        
        // 🔥 INJECT RECALL OR REQUEUE BUTTONS INTELLIGENTLY
        if (canRecall) {
            footerEl.innerHTML += `<button onclick="window.recallDispatch('${encodedGroup}')" style="background: #f59e0b; color: white; border: none; padding: 12px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.3); font-size: 14px; transition: 0.2s; width: 100%; margin-bottom: 10px;">🔙 Back Load / Recall Dispatch</button>`;
        } 
        
        if (hasMissing) {
            footerEl.innerHTML += `<button onclick="window.requeueLostItems('${encodedGroup}')" style="background: #dc2626; color: white; border: none; padding: 12px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(220, 38, 38, 0.3); font-size: 14px; transition: 0.2s; width: 100%;">🔄 Auto-Requeue Lost Items to Requests</button>`;
        }

        if (!canRecall && !hasMissing) {
            footerEl.innerHTML = `<span style="font-size: 12px; color: #64748b; font-weight: bold; background: #e2e8f0; padding: 8px 15px; border-radius: 6px; display: block; text-align: center;">🔒 This delivery has been fully processed by the branch.</span>`;
        }
    }

    document.getElementById('dispatchDetailsModal').style.display = 'flex';
};

// ========================================================
// 📍 MARK DISPATCH AS ARRIVED ENGINE
// ========================================================
window.markDispatchArrived = async function(encodedGroup) {
    let group = JSON.parse(decodeURIComponent(encodedGroup));
    if (!confirm(`Mark delivery to ${group.toBranch} as ARRIVED?\n\nThe branch staff will now be notified and can begin receiving the items.`)) return;

    Swal.fire({title: 'Updating Status...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        let promises = [];
        group.items.forEach(item => {
            if (item.status === 'In Transit') {
                promises.push(updateDoc(doc(db, "dispatch_logs", item.id), { 
                    status: 'Arrived',
                    arrivedAt: serverTimestamp() 
                }));
            }
        });
        await Promise.all(promises);
        Swal.fire('Arrived!', 'Delivery marked as arrived at the branch.', 'success');
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to update status.', 'error');
    }
};

// ========================================================
// 🔄 AUTO-REQUEUE LOST ITEMS ENGINE
// ========================================================
window.requeueLostItems = async function(encodedGroup) {
    let group = JSON.parse(decodeURIComponent(encodedGroup));
    
    if (!confirm(`Re-queue all missing/lost items for ${group.toBranch} as a new Stock Request?`)) return;

    Swal.fire({title: 'Generating Request...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        let lostItems = group.items.filter(i => i.status === 'Lost in Transit' || i.status === 'Discrepancy');
        
        let poItems = lostItems.map(item => {
            let varianceQty = Math.abs(parseFloat(item.variance) || 0);
            let cRate = parseFloat(item.convRate) || 1;
            let displayQty = varianceQty / cRate; // Reverse engineers the original package size!

            return {
                itemName: item.item,
                name: item.item,
                qty: varianceQty,
                displayQty: displayQty,
                uom: item.baseUom || item.uom,
                displayUom: item.displayUom || item.purchaseUom || item.uom,
                requestType: 'Lost in Transit', // 🔥 This triggers the RED tag!
                physicalStock: 0,
                systemStock: 0
            };
        });

        // 1. Create the new Purchase Order
        await addDoc(collection(db, "purchase_orders"), {
            branch: group.toBranch,
            items: poItems,
            status: "Pending",
            type: "Lost Item Replacement",
            requestedBy: "System (Auto-Requeue)",
            timestamp: serverTimestamp()
        });

        // 2. Mark the dispatch logs as Re-queued so the button disappears
        let promises = lostItems.map(item => 
            updateDoc(doc(db, "dispatch_logs", item.id), { status: 'Lost (Re-queued)' })
        );
        await Promise.all(promises);

        Swal.fire('Success', 'Lost items have been instantly sent to the Stock Requests feed!', 'success');
        document.getElementById('dispatchDetailsModal').style.display = 'none';
        window.loadDispatchLogs(); // Refresh the list

    } catch (e) {
        console.error("Requeue Error:", e);
        Swal.fire('Error', 'Failed to requeue lost items. Check console.', 'error');
    }
};

// ========================================================
// 🔙 RECALL / BACK LOAD ENGINE (CART BLANK FIX)
// ========================================================
window.recallDispatch = async function(encodedGroup) {
    let group = JSON.parse(decodeURIComponent(encodedGroup));
    
    if (!confirm("⚠️ RECALL DISPATCH?\n\nThis will remove the delivery from the destination branch, refund the inventory back to HQ, and load the items into your Dispatch Cart to edit. Proceed?")) return;

    Swal.fire({title: 'Recalling Delivery...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        if (typeof window.dispatchCart === 'undefined') window.dispatchCart = [];
        
        let branchSelect = document.getElementById('dispTo');
        if(branchSelect) branchSelect.value = group.toBranch;

        for (let item of group.items) {
            let originBranch = item.fromBranch || "Main Office";
            const invQ = query(collection(db, "inventory"), where("branch", "==", originBranch), where("name", "==", item.item));
            const invSnap = await getDocs(invQ);
            
            if (!invSnap.empty) {
                let invDoc = invSnap.docs[0];
                let currentStock = parseFloat(invDoc.data().currentStock) || 0;
                let refundQty = parseFloat(item.qty) || 0; 
                
                await updateDoc(invDoc.ref, { currentStock: currentStock + refundQty });
                
                await addDoc(collection(db, "stock_logs"), {
                    branch: originBranch,
                    item: item.item,
                    oldQty: currentStock,
                    newQty: currentStock + refundQty,
                    variance: refundQty,
                    type: "Dispatch Recalled",
                    note: `Recalled delivery originally sent to ${group.toBranch}`,
                    user: localStorage.getItem('cashierName') || 'Manager',
                    timestamp: serverTimestamp()
                });
            }

            // 🔥 THE FIX: Added exact variable mapping so the UI input boxes don't render blank!
            window.dispatchCart.push({
                id: item.sourceId || item.id,
                sourceId: item.sourceId || item.id,
                itemName: item.item,
                name: item.item,
                rawQty: parseFloat(item.displayQty) || parseFloat(item.qty) || 0,
                qty: parseFloat(item.qty) || 0,
                uom: item.baseUom || item.uom,
                baseUom: item.baseUom || item.uom,
                friendlyUom: item.displayUom || item.uom,
                purchaseUom: item.purchaseUom || item.displayUom || item.uom,
                selectedUom: (item.displayUom !== item.uom) ? 'purch' : 'base',
                convRate: parseFloat(item.convRate) || 1,
                conversionRate: parseFloat(item.convRate) || 1,
                category: item.category || "Ingredients"
            });

            await deleteDoc(doc(db, "dispatch_logs", item.id));
        }

        localStorage.setItem('takodeal_dispatch_cart', JSON.stringify(window.dispatchCart));

        if (typeof window.renderDispatchCart === 'function') window.renderDispatchCart();
        if (typeof window.switchView === 'function') window.switchView('dispatch');
        
        document.getElementById('dispatchDetailsModal').style.display = 'none';
        Swal.fire({title: 'Recalled!', text: 'Dispatch reverted. Items are back in your Dispatch Cart.', icon: 'success', timer: 2500, showConfirmButton: false});

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to recall dispatch. Check connection.', 'error');
    }
};

// ========================================================
// 👥 LIVE STAFF ON DUTY ENGINE (REAL-TIME UPGRADE)
// ========================================================
window.fetchLiveStaffOnDuty = function() {
    let container = document.getElementById('liveStaffGrid');
    if (!container) return;
    
    try {
        // 1. Get the very beginning of today
        let startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);
        
        // 2. TRUE REAL-TIME LISTENER (Bypasses offline cache freezing)
        const q = query(collection(db, "attendance_logs"), where("timestamp", ">=", startOfDay));
        
        onSnapshot(q, (snap) => {
            let latestPunches = {};
            
            // 3. Find the LATEST punch for every single staff member today
            snap.forEach(docSnap => {
                let data = docSnap.data();
                let staff = data.staffName;
                let punchTime = data.timestamp ? (data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp)) : new Date();
                
                if (!latestPunches[staff] || punchTime > latestPunches[staff].time) {
                    latestPunches[staff] = {
                        branch: data.branch,
                        type: data.type, // "TIME IN" or "TIME OUT"
                        time: punchTime
                    };
                }
            });
            
            // 4. Filter: Keep ONLY staff whose latest punch was "TIME IN"
            let activeStaffByBranch = {};
            for (let staff in latestPunches) {
                let punch = latestPunches[staff];
                if (punch.type === "TIME IN") {
                    if (!activeStaffByBranch[punch.branch]) {
                        activeStaffByBranch[punch.branch] = [];
                    }
                    activeStaffByBranch[punch.branch].push({
                        name: staff,
                        timeIn: punch.time
                    });
                }
            }
            
            // 5. Render the UI Boxes
            let html = '';
            let branches = Object.keys(activeStaffByBranch).sort();
            
            if (branches.length === 0) {
                html = '<div style="grid-column: 1/-1; background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center; color: #64748b; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">No staff members are currently timed in today.</div>';
            } else {
                branches.forEach(branch => {
                    let staffListHtml = '';
                    
                    // Sort staff by who timed in earliest
                    activeStaffByBranch[branch].sort((a,b) => a.timeIn - b.timeIn);
                    
                    activeStaffByBranch[branch].forEach(s => {
                        let timeStr = s.timeIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        staffListHtml += `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 16px;">👤</span>
                                    <span style="font-weight: bold; color: #334155; font-size: 13px;">${s.name}</span>
                                </div>
                                <span style="font-size: 11px; background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 6px; font-weight: bold; border: 1px solid #bbf7d0;">In @ ${timeStr}</span>
                            </div>
                        `;
                    });
                    
                    html += `
                        <div style="background: white; border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                            <h4 style="margin: 0 0 10px 0; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 15px;">📍 ${branch}</span>
                                <span style="background: #0f766e; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px;">${activeStaffByBranch[branch].length} Active</span>
                            </h4>
                            <div style="display: flex; flex-direction: column;">
                                ${staffListHtml}
                            </div>
                        </div>
                    `;
                });
            }
            
            container.innerHTML = html;
            
        }, (error) => {
            console.error("Live Staff Listener Error:", error);
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444; background: #fef2f2; padding: 20px; border-radius: 8px; border: 1px dashed #fca5a5;">Failed to load live staff data. Check console.</div>';
        });
        
    } catch (e) {
        console.error("Live Staff Setup Error:", e);
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444; background: #fef2f2; padding: 20px; border-radius: 8px; border: 1px dashed #fca5a5;">Failed to initialize live staff scanner.</div>';
    }
};

// Auto-start the scanner!
setTimeout(() => {
    window.fetchLiveStaffOnDuty();
}, 1500);

// ========================================================
// ⚠️ UNVERIFIED DIGITAL PAYMENTS ENGINE (SALES HISTORY)
// ========================================================

// 1. Upgrade the History Tab Switcher to include the new tab
window.switchHistoryTab = function(tabName) {
    // Hide all sections and reset tabs
    ['Tx', 'Shifts', 'Daily', 'Monthly', 'Reports', 'Unverified'].forEach(id => {
        let sec = document.getElementById('histSec' + id);
        if (sec) sec.style.display = 'none';
        
        let tab = document.getElementById('tabHist' + id);
        if (tab) {
            tab.style.borderBottom = '3px solid transparent';
            tab.style.color = id === 'Unverified' ? '#ef4444' : '#64748b'; // Keep unverified slightly red
        }
    });

    // Show active section
    let activeSec = document.getElementById('histSec' + tabName);
    let activeTab = document.getElementById('tabHist' + tabName);
    
    if (activeSec) activeSec.style.display = 'block';
    if (activeTab) {
        activeTab.style.borderBottom = tabName === 'Unverified' ? '3px solid #dc2626' : '3px solid #0f766e';
        activeTab.style.color = tabName === 'Unverified' ? '#dc2626' : '#0f766e';
    }

    if (tabName === 'Unverified') window.loadUnverifiedHistory();
};

// 2. Fetch the Unverified Payments
window.pendingVerifications = []; // Store IDs for "Verify All" button

window.loadUnverifiedHistory = async function() {
    let tbody = document.getElementById('unverifiedHistoryBody');
    if(!tbody) return;
    
    // 🔥 DYNAMICALLY UPDATE THE TABLE HEADERS FOR THE NEW LAYOUT
    let theadTr = tbody.previousElementSibling;
    if (theadTr && theadTr.tagName === 'THEAD') {
        theadTr = theadTr.querySelector('tr');
    }
    if (theadTr) {
        theadTr.innerHTML = `
            <th style="padding: 10px 15px; color: #475569; text-align: left; font-size: 11px; text-transform: uppercase;">Date & Time</th>
            <th style="padding: 10px 15px; color: #475569; text-align: left; font-size: 11px; text-transform: uppercase;">Branch</th>
            <th style="padding: 10px 15px; color: #0284c7; text-align: left; font-size: 11px; text-transform: uppercase;">Cashier & Customer</th>
            <th style="padding: 10px 15px; color: #475569; text-align: left; font-size: 11px; text-transform: uppercase;">Order Details</th>
            <th style="padding: 10px 15px; color: #475569; text-align: left; font-size: 11px; text-transform: uppercase;">Payment</th>
            <th style="padding: 10px 15px; color: #475569; text-align: right; font-size: 11px; text-transform: uppercase;">Amount</th>
            <th style="padding: 10px 15px; color: #475569; text-align: center; font-size: 11px; text-transform: uppercase;">Action</th>
        `;
    }

    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 40px; font-weight: bold; color: #64748b;">⏳ Scanning database for unverified payments...</td></tr>';
    
    try {
        let lookBack = new Date();
        lookBack.setDate(lookBack.getDate() - 7);
        
        const q = query(collection(db, "transactions"), where("timestamp", ">=", lookBack));
        const snap = await getDocs(q);
        
        let html = '';
        window.pendingVerifications = [];
        let count = 0;

        let txArray = [];
        let seenReceipts = {}; 

        snap.forEach(doc => {
            let tx = doc.data();
            let method = (tx.paymentMethod || '').toLowerCase();
            if (tx.status !== 'Voided' && method !== 'cash' && method !== '' && tx.paymentVerified !== true) {
                let rId = tx.receiptId || tx.id;
                if (!seenReceipts[rId]) {
                    seenReceipts[rId] = true;
                    txArray.push({id: doc.id, ...tx});
                }
            }
        });

        // Sort newest first
        txArray.sort((a, b) => b.timestamp - a.timestamp);

        txArray.forEach(tx => {
            count++;
            window.pendingVerifications.push(tx.id);
            let dateStr = tx.timestamp ? (tx.timestamp.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp)).toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';
            let timeStr = tx.timestamp ? (tx.timestamp.toDate ? tx.timestamp.toDate() : new Date(tx.timestamp)).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : 'Unknown';
            let methodColor = tx.paymentMethod.toLowerCase() === 'gcash' ? '#0284c7' : '#ea580c';

            let safeCustomer = (tx.customerName || 'Guest').replace(/'/g, "\\'");
            let safeCashier = tx.cashier || 'Unknown';
            let safeCart = encodeURIComponent(JSON.stringify(tx.cart || tx.items || []));

            // 🔥 NEW: Extract the items sold to show them directly in the table!
            let itemsHtml = '';
            if (tx.cart && Array.isArray(tx.cart)) {
                tx.cart.forEach(item => {
                    let itemName = item.name || item.itemName;
                    itemsHtml += `<div style="font-size: 12px; color: #334155; margin-bottom: 2px;">• ${item.qty}x ${itemName}</div>`;
                });
            } else {
                itemsHtml = `<div style="font-size: 12px; color: #94a3b8; font-style: italic;">No items recorded</div>`;
            }

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: white;">
                    <td style="padding: 15px; font-weight: bold; color: #334155; vertical-align: top;">${dateStr}<br><span style="font-size: 11px; color: #64748b; font-weight: normal; font-family: monospace;">${tx.receiptId || tx.id}</span></td>
                    <td style="padding: 15px; font-weight: bold; color: #0f172a; vertical-align: top;">${tx.branch}</td>
                    <td style="padding: 15px; vertical-align: top;">
                        <div style="font-weight: bold; color: #0284c7;">👤 ${safeCashier}</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">🛒 ${safeCustomer}</div>
                    </td>
                    <td style="padding: 15px; max-width: 200px; vertical-align: top;">${itemsHtml}</td>
                    <td style="padding: 15px; font-weight: 900; color: ${methodColor}; text-transform: uppercase; vertical-align: top;">${tx.paymentMethod}</td>
                    <td style="padding: 15px; font-weight: 900; color: #16a34a; text-align: right; font-size: 16px; vertical-align: top;">₱${parseFloat(tx.netTotal).toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                    <td style="padding: 15px; text-align: center; vertical-align: top;">
                        <div style="display: flex; gap: 5px; justify-content: center; align-items: center; flex-direction: column;">
                            <button onclick="window.verifySingleHistoryPayment('${tx.id}')" style="background: #16a34a; color: white; border: none; padding: 8px 15px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px; width: 100%; box-shadow: 0 2px 4px rgba(22,163,74,0.3);">✅ Verify</button>
                            <button onclick="window.viewReceiptDetails('${tx.receiptId || tx.id}', '${safeCustomer}', '${timeStr}', '${tx.paymentMethod}', ${tx.netTotal}, '${safeCart}')" style="background: white; border: 1px solid #cbd5e1; color: #334155; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; width: 100%;">🔍 View Full</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        if (count === 0) {
            html = '<tr><td colspan="7" class="text-center" style="padding: 40px; font-weight: bold; color: #16a34a; font-size: 16px;">🎉 All caught up! No pending digital payments to verify.</td></tr>';
        }

        tbody.innerHTML = html;
        window.updateUnverifiedBadges(count);

    } catch(e) {
        console.error("Error loading unverified:", e);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 30px; color: #dc2626; font-weight: bold;">❌ Failed to load data. Check console.</td></tr>';
    }
};

// 3. Action Buttons
window.verifySingleHistoryPayment = async function(txId) {
    try {
        Swal.fire({title: 'Verifying...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        await updateDoc(doc(db, "transactions", txId), { paymentVerified: true });
        Swal.fire({title: 'Verified!', icon: 'success', timer: 1500, showConfirmButton: false});
        window.loadUnverifiedHistory(); // Refresh the list
    } catch(e) {
        Swal.fire('Error', 'Failed to verify payment.', 'error');
    }
};

window.verifyAllPendingHistory = async function() {
    if(!window.pendingVerifications || window.pendingVerifications.length === 0) return Swal.fire('Oops', 'No payments to verify!', 'info');
    
    if(!confirm(`Are you sure you want to verify all ${window.pendingVerifications.length} payments?`)) return;

    Swal.fire({
        title: 'Verifying Payments...', 
        html: `Please wait, processing <b>0</b> of ${window.pendingVerifications.length}...`,
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading()
    });

    try {
        let count = 0;
        
        // Loop through each ID and use the standard update function we know works
        for (let id of window.pendingVerifications) {
            await updateDoc(doc(db, "transactions", id), { paymentVerified: true });
            count++;
            
            // Update the loading screen text every 5 items so the browser doesn't freeze
            if (count % 5 === 0 || count === window.pendingVerifications.length) {
                Swal.update({ html: `Please wait, processing <b style="color:#0ea5e9;">${count}</b> of ${window.pendingVerifications.length}...` });
            }
        }

        Swal.fire({
            title: 'All Verified!', 
            text: 'The cashiers alarms are now cleared.', 
            icon: 'success', 
            timer: 2000, 
            showConfirmButton: false
        });
        
        window.loadUnverifiedHistory();
        
    } catch(e) {
        console.error("Batch Verification Error:", e); // Added to console so we can see exact errors!
        Swal.fire('Error', 'Failed to verify payments. Check the developer console.', 'error');
    }
};

// 4. Background Scanner for the Sidebar Badge
window.updateUnverifiedBadges = function(count) {
    let badge1 = document.getElementById('badgeUnverifiedTx');
    let badge2 = document.getElementById('sidebarBadgeUnverified');
    if(badge1) { badge1.innerText = count; badge1.style.display = count > 0 ? 'inline-block' : 'none'; }
    if(badge2) { badge2.innerText = count; badge2.style.display = count > 0 ? 'inline-block' : 'none'; }
};

window.startManagerUnverifiedScanner = function() {
    setInterval(async () => {
        try {
            let lookBack = new Date();
            lookBack.setDate(lookBack.getDate() - 7);
            const q = query(collection(db, "transactions"), where("timestamp", ">=", lookBack));
            const snap = await getDocs(q);
            
            let count = 0;
            snap.forEach(doc => {
                let tx = doc.data();
                let method = (tx.paymentMethod || '').toLowerCase();
                if (tx.status !== 'Voided' && method !== 'cash' && method !== '' && tx.paymentVerified !== true) count++;
            });
            window.updateUnverifiedBadges(count);
        } catch(e) {}
    }, 30000); // Scans in the background every 30 seconds
};

setTimeout(window.startManagerUnverifiedScanner, 4000); // Start scanner on boot

// ==========================================
// 🍳 LIVE PREP TIMER UPDATER ENGINE
// ==========================================
setInterval(() => {
    document.querySelectorAll('.live-prep-timer').forEach(el => {
        let txTime = parseInt(el.getAttribute('data-time'));
        let minutesElapsed = Math.floor((Date.now() - txTime) / 60000);
        
        if (minutesElapsed < 10) {
            let timeLeft = 10 - minutesElapsed;
            el.innerHTML = `🍳 COOKING (${timeLeft}m)`;
        } else {
            // Determine if it's the rounded pill (History) or square badge (Analytics)
            let isPill = el.style.borderRadius === '12px';
            if (isPill) {
                el.outerHTML = `<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:12px; font-size:11px;">Paid</span>`;
            } else {
                el.outerHTML = `<span class="badge badge-active"><span class="status-dot green"></span> PAID</span>`;
            }
        }
    });
}, 15000); // Ticks every 15 seconds!
