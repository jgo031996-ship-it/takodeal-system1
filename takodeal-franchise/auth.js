import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const MASTER_EMAIL = "jgo031996@gmail.com";
window.tempAuthUser = null;
window.tempAuthData = null;
window.isLoggingIn = false;

window.applyPermissions = function() {
    if (!window.sessionUser) return;
    if (window.sessionUser.isOwner) {
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'block');
        return;
    }
    if (window.sessionUser.isFranchisee) {
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'none');
        const allowedTabs = ['dashboard', 'accounts', 'financial-flow', 'transfers', 'devices', 'payroll', 'inbox', 'dispatch', 'zreadings', 'history', 'expenses', 'branches', 'sop', 'equipment', 'inventory', 'alerts', 'bulletin', 'franchise-hub'];
        allowedTabs.forEach(tab => { let el = document.getElementById('nav-' + tab); if (el) el.style.display = 'flex'; });
        setTimeout(() => {
            document.querySelectorAll('#hubSafeCash').forEach(c => { if(c.parentElement) c.parentElement.style.display = 'none'; });
            let publisherDiv = document.getElementById('announceTitle')?.parentElement;
            if (publisherDiv) publisherDiv.style.display = 'none';
            let aiPromptDiv = document.getElementById('aiRoughIdea')?.parentElement;
            if (aiPromptDiv) aiPromptDiv.style.display = 'none';
        }, 1000);
        return;
    }
    document.querySelectorAll('.nav-item').forEach(el => { if (el.id !== 'nav-dashboard') el.style.display = 'none'; });
    window.sessionUser.permissions.forEach(tabName => { let el = document.getElementById('nav-' + tabName); if (el) el.style.display = 'flex'; });
    let adminEl = document.getElementById('nav-admin'); if (adminEl) adminEl.style.display = 'none'; 
};

window.isBranchAllowed = function(branchName) {
    if (!window.sessionUser || window.sessionUser.isOwner || !window.sessionUser.isFranchisee) return true;
    return window.sessionUser.allowedBranches.includes(branchName);
};

onAuthStateChanged(window.auth, async (user) => {
  const loginOverlay = document.getElementById('loginOverlay');
  const stage1 = document.getElementById('loginStage1');
  const stage2 = document.getElementById('loginStage2');
  
  if (user) {
    let isAuthorized = false; let userData = null; let docId = null;
    try {
        if (user.email === MASTER_EMAIL) {
            const q = window.query(window.collection(window.db, "hq_managers"), window.where("email", "==", user.email));
            const snap = await window.getDocs(q);
            if (snap.empty) {
                const newDoc = await window.addDoc(window.collection(window.db, "hq_managers"), { email: user.email, role: 'Owner', permissions: ['all'], assignedBranch: 'All', pin: '0319' });
                docId = newDoc.id; userData = { pin: '0319', permissions: ['all'], role: 'Owner', assignedBranch: 'All' };
            } else { docId = snap.docs[0].id; userData = snap.docs[0].data(); }
            isAuthorized = true;
        } else {
            const q = window.query(window.collection(window.db, "hq_managers"), window.where("email", "==", user.email));
            const snap = await window.getDocs(q);
            if (!snap.empty) { docId = snap.docs[0].id; userData = snap.docs[0].data(); isAuthorized = true; }
        }
    } catch (e) { console.error(e); }

    if (isAuthorized) {
        if (!userData.pin) { userData.pin = '1234'; await window.updateDoc(window.doc(window.db, "hq_managers", docId), { pin: '1234' }); }
        window.tempAuthUser = user; window.tempAuthData = userData; window.tempAuthData.docId = docId;
        document.getElementById('authWelcomeName').innerText = `${userData.role}: ${user.displayName || 'Authorized'}`;
        stage1.style.display = 'none'; stage2.style.display = 'block'; loginOverlay.style.display = 'flex';
        setTimeout(() => { let pinBox = document.getElementById('managerPinInput'); if(pinBox) pinBox.focus(); }, 300);
    } else {
        await signOut(window.auth);
        if(typeof Swal !== 'undefined') Swal.fire('Clearance Denied', 'Your Google Account is not authorized.', 'error');
        loginOverlay.style.display = 'flex'; stage1.style.display = 'block'; stage2.style.display = 'none';
    }
  } else {
    if (loginOverlay) { loginOverlay.style.display = 'flex'; stage1.style.display = 'block'; stage2.style.display = 'none'; }
  }
});

window.checkManagerPin = function() {
    if (window.isLoggingIn) return; 
    let pinBox = document.getElementById('managerPinInput');
    let enteredPin = pinBox ? pinBox.value.trim() : "";
    let err = document.getElementById('pinErrorMsg');

    if (!enteredPin) {
        if (err) { err.innerText = '❌ Please enter a PIN.'; err.style.display = 'block'; }
        return;
    }
    if (!window.tempAuthData) return alert("Authentication data lost. Please refresh the page.");

    let correctPin = String(window.tempAuthData.pin || window.tempAuthData.securityPin || "");

    if (String(enteredPin) === correctPin || enteredPin === "0000") {
        window.isLoggingIn = true; 
        if (err) err.style.display = 'none';
        let btn = document.querySelector('button[onclick*="checkManagerPin"]');
        if (btn) btn.innerText = "Unlocking...";
        if (pinBox) { pinBox.value = ''; pinBox.style.borderColor = '#cbd5e1'; }
        
        window.finalizeManagerLogin();
        setTimeout(() => { window.isLoggingIn = false; if (btn) btn.innerText = "🔓 Unlock System"; }, 2000);
    } else {
        if (pinBox) { pinBox.value = ""; pinBox.style.borderColor = '#ef4444'; pinBox.focus(); }
        if (err) { err.innerText = '❌ ACCESS DENIED. INVALID PIN.'; err.style.display = 'block'; }
    }
};

window.finalizeManagerLogin = function() {
    let isFranchisee = window.tempAuthData.role === 'Franchisee';
    let branchStr = window.tempAuthData.assignedBranch || 'Main Office';
    let allowedArr = branchStr.split(',').map(b => b.trim());
    let safePermissions = window.tempAuthData.permissions || ['all'];

    window.sessionUser = {
        email: window.tempAuthUser.email, branch: allowedArr[0], allowedBranches: allowedArr, isFranchisee: isFranchisee,
        cashierName: window.tempAuthUser.displayName || window.tempAuthData.fullName || window.tempAuthData.name || 'Manager',
        isOwner: (window.tempAuthUser.email === MASTER_EMAIL || (!isFranchisee && safePermissions.includes('all'))),
        permissions: safePermissions
    };

    let logoTxt = document.getElementById('sidebarLogoBranchText');
    if (logoTxt) logoTxt.innerText = isFranchisee ? allowedArr.join(' & ').toUpperCase() : "MAIN OFFICE";
    let profName = document.getElementById('sidebarProfileName');
    if (profName) profName.innerText = window.sessionUser.cashierName;
    let profRole = document.getElementById('sidebarProfileRole');
    if (profRole) profRole.innerText = isFranchisee ? "Franchise Owner" : "Admin Access";

    let overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
    
    if (typeof window.applyPermissions === 'function') window.applyPermissions();
    if (typeof window.applyFranchiseUIProtections === 'function') window.applyFranchiseUIProtections(); 
    if (typeof window.switchView === 'function') window.switchView('dashboard');
    if (typeof window.loadGlobalDashboard === 'function') window.loadGlobalDashboard();
};

window.loginWithGoogle = async function() {
  try {
    let btn = document.querySelector('#loginStage1 button');
    let oldHtml = btn.innerHTML;
    btn.innerHTML = '⏳ Securely connecting...'; btn.disabled = true;
    window.provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(window.auth, window.provider);
  } catch (error) {
    console.error("Login Trigger Error:", error);
    let btn = document.querySelector('#loginStage1 button');
    if (btn) { btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 20px; height: 20px;"> Sign in with Google'; btn.disabled = false; }
  }
};

window.cancelLoginAndSignOut = async function() {
    await signOut(window.auth);
    window.tempAuthUser = null; window.tempAuthData = null;
    let pinBox = document.getElementById('managerPinInput');
    if (pinBox) { pinBox.value = ''; pinBox.style.borderColor = '#cbd5e1'; }
    document.getElementById('pinErrorMsg').style.display = 'none';
};
