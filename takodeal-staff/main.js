// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Same secure vault used by the Manager and Cashier apps!
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
window.db = db;

console.log("🚀 Takodeál Staff Portal Booted Successfully!");

// ==========================================
// 🔒 LOGIN ENGINE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    let savedSession = localStorage.getItem('takodeal_staff_name');
    if (savedSession) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        document.getElementById('loggedInName').innerText = savedSession;
    }
});

window.loginStaff = async function() {
    let pinInput = document.getElementById('loginPin').value.trim();
    let errorMsg = document.getElementById('loginError');
    let btn = document.querySelector('.login-card .btn-primary');

    // 🛑 REMOVED THE EXACT 4-DIGIT REQUIREMENT!
    if (pinInput.length < 1) {
        errorMsg.innerText = "❌ Please enter your PIN.";
        errorMsg.style.display = 'block';
        return;
    }

    btn.innerText = "⏳ Verifying...";
    btn.disabled = true;
    errorMsg.style.display = 'none';

    try {
        // Search the exact same cashiers database the POS uses!
        const qStr = query(collection(db, "cashiers"), where("pin", "==", pinInput));
        const snapStr = await getDocs(qStr);
        let staffData = null;

        if (!snapStr.empty) {
            staffData = snapStr.docs[0].data();
        } else {
            // Fallback: Check if PIN was saved as a Number instead of a String
            let pinNum = parseInt(pinInput);
            if (!isNaN(pinNum)) {
                const qNum = query(collection(db, "cashiers"), where("pin", "==", pinNum));
                const snapNum = await getDocs(qNum);
                if (!snapNum.empty) staffData = snapNum.docs[0].data();
            }
        }

        if (staffData) {
            localStorage.setItem('takodeal_staff_name', staffData.cashierName);
            document.getElementById('loggedInName').innerText = staffData.cashierName;
            
            // Beautiful smooth transition
            document.getElementById('loginOverlay').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('loginOverlay').style.display = 'none';
                document.getElementById('appContainer').style.display = 'flex';
                document.getElementById('loginPin').value = ''; 
                document.getElementById('loginOverlay').style.opacity = '1';
            }, 300);
            
            // Initialize Dashboard Data
            window.startLiveClock();
        } else {
            errorMsg.innerText = "❌ Incorrect PIN. Please try again.";
            errorMsg.style.display = 'block';
        }
    } catch (e) {
        console.error(e);
        errorMsg.innerText = "❌ Connection error. Please check your internet.";
        errorMsg.style.display = 'block';
    } finally {
        btn.innerText = "Secure Login";
        btn.disabled = false;
    }
};

window.logoutStaff = function() {
    Swal.fire({
        title: 'Sign Out?',
        text: "You will need your PIN to access your portal again.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0f766e',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Yes, sign out'
    }).then((result) => {
        if (result.isConfirmed) {
            localStorage.removeItem('takodeal_staff_name');
            document.getElementById('appContainer').style.display = 'none';
            document.getElementById('loginOverlay').style.display = 'flex';
            
            // Reset to default tab
            let firstTab = document.querySelector('.bottom-nav .nav-item');
            if (firstTab) window.switchView('bulletin', firstTab);
        }
    });
};

// ==========================================
// 📱 NAVIGATION ENGINE
// ==========================================
window.switchView = function(viewId, btnElement) {
    // 1. Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    
    // 2. Show target view
    let targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    // 3. Update bottom nav highlighting
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        // Fallback if called programmatically
        let backupBtn = document.querySelector(`.bottom-nav .nav-item[onclick*="${viewId}"]`);
        if (backupBtn) backupBtn.classList.add('active');
    }
};

// ==========================================
// ⏱️ LIVE CLOCK ENGINE
// ==========================================
window.startLiveClock = function() {
    const timeEl = document.getElementById('liveTime');
    const dateEl = document.getElementById('liveDate');
    if (!timeEl || !dateEl) return;

    setInterval(() => {
        const now = new Date();
        timeEl.innerHTML = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dateEl.innerHTML = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }, 1000);
};

// Placeholder for future form functions
window.openReqForm = function(type) {
    Swal.fire({
        title: 'Coming Soon',
        text: 'The ' + type + ' request module is currently being configured by HQ.',
        icon: 'info',
        confirmButtonColor: '#0f766e'
    });
};

window.punchTime = function(type) {
    Swal.fire({
        title: 'GPS Connecting...',
        text: 'The location and AI verification engine is currently being synced with your branch coordinates.',
        icon: 'info',
        confirmButtonColor: '#0f766e'
    });
};
