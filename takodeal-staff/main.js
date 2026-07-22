// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, query, where, doc, updateDoc, addDoc, serverTimestamp, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
const db = getFirestore(app);
const storage = getStorage(app);
window.db = db;
window.storage = storage;

console.log("🚀 Takodeál Staff Portal Booted Successfully!");

// 🌍 BRANCH COORDINATES FOR GPS
window.BRANCH_ZONES = {
    "Cabantian": { lat: 7.130415, lng: 125.617306 },
    "Citygate":  { lat: 7.111076, lng: 125.612883 },
    "Maa":       { lat: 7.078632, lng: 125.583441 },
    "Main Office": { lat: 7.153756, lng: 125.595667 }
};
window.ALLOWED_RADIUS_METERS = 50;

// ==========================================
// 🔒 LOGIN & PROFILE ENGINE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    let savedName = localStorage.getItem('takodeal_staff_name');
    let savedPic = localStorage.getItem('takodeal_staff_pic');
    
    if (savedName) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        document.getElementById('loggedInName').innerText = savedName;
        if (savedPic) {
            document.getElementById('topAvatar').innerText = '';
            document.getElementById('topAvatar').style.backgroundImage = `url('${savedPic}')`;
        }
        window.startLiveClock();
        window.loadAnnouncements();
    }
});

window.loginStaff = async function() {
    let pinInput = document.getElementById('loginPin').value.trim();
    let errorMsg = document.getElementById('loginError');
    let btn = document.querySelector('.login-card .btn-primary');

    if (pinInput.length < 1) {
        errorMsg.innerText = "❌ Please enter your PIN.";
        errorMsg.style.display = 'block';
        return;
    }

    btn.innerText = "⏳ Verifying..."; btn.disabled = true; errorMsg.style.display = 'none';

    try {
        const qStr = query(collection(db, "cashiers"), where("pin", "==", pinInput));
        const snapStr = await getDocs(qStr);
        let staffData = null; let docId = null;

        if (!snapStr.empty) {
            staffData = snapStr.docs[0].data();
            docId = snapStr.docs[0].id;
        } else {
            let pinNum = parseInt(pinInput);
            if (!isNaN(pinNum)) {
                const qNum = query(collection(db, "cashiers"), where("pin", "==", pinNum));
                const snapNum = await getDocs(qNum);
                if (!snapNum.empty) { staffData = snapNum.docs[0].data(); docId = snapNum.docs[0].id; }
            }
        }

        if (staffData) {
            localStorage.setItem('takodeal_staff_name', staffData.cashierName);
            localStorage.setItem('takodeal_staff_id', docId);
            localStorage.setItem('takodeal_staff_pic', staffData.profilePicUrl || '');
            
            document.getElementById('loggedInName').innerText = staffData.cashierName;
            if (staffData.profilePicUrl) {
                document.getElementById('topAvatar').innerText = '';
                document.getElementById('topAvatar').style.backgroundImage = `url('${staffData.profilePicUrl}')`;
            }
            
            document.getElementById('loginOverlay').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('loginOverlay').style.display = 'none';
                document.getElementById('appContainer').style.display = 'flex';
                document.getElementById('loginPin').value = ''; 
                document.getElementById('loginOverlay').style.opacity = '1';
            }, 300);
            
            window.startLiveClock();
            window.loadAnnouncements();
        } else {
            errorMsg.innerText = "❌ Incorrect PIN. Please try again."; errorMsg.style.display = 'block';
        }
    } catch (e) {
        console.error(e); errorMsg.innerText = "❌ Connection error."; errorMsg.style.display = 'block';
    } finally {
        btn.innerText = "Secure Login"; btn.disabled = false;
    }
};

window.logoutStaff = function() {
    Swal.fire({
        title: 'Sign Out?', text: "You will need your PIN to access your portal again.", icon: 'question',
        showCancelButton: true, confirmButtonColor: '#0f766e', confirmButtonText: 'Yes, sign out'
    }).then((result) => {
        if (result.isConfirmed) {
            localStorage.clear(); // Wipe session
            location.reload(); // Hard reset
        }
    });
};

// --- PROFILE DATA & PICTURE ENGINE ---
window.selectedProfileFile = null;

window.openProfile = async function() {
    let pic = localStorage.getItem('takodeal_staff_pic');
    let preview = document.getElementById('profilePreview');
    let placeholder = document.getElementById('profilePlaceholder');
    let staffId = localStorage.getItem('takodeal_staff_id');
    
    // 1. Setup the Picture
    if (pic && pic.length > 5) {
        preview.src = pic; preview.style.display = 'block'; placeholder.style.display = 'none';
    } else {
        preview.style.display = 'none'; placeholder.style.display = 'flex';
    }
    
    window.selectedProfileFile = null;
    
    // 2. Fetch the latest HR Data from Firebase!
    try {
        const docRef = doc(db, "cashiers", staffId);
        const docSnap = await window.getDoc(docRef);
        
        if (docSnap.exists()) {
            let d = docSnap.data();
            document.getElementById('profFullName').value = d.cashierName || '';
            document.getElementById('profNickname').value = d.scheduleName || '';
            document.getElementById('profPhone').value = d.phone || '';
            document.getElementById('profAddress').value = d.address || '';
            document.getElementById('profEmergName').value = d.emergencyName || '';
            document.getElementById('profEmergNum').value = d.emergencyNumber || '';
            document.getElementById('profEmail').value = d.email || '';
            document.getElementById('profGcashName').value = d.gcashName || '';
            document.getElementById('profGcashNum').value = d.gcashNumber || '';
            document.getElementById('profGotymeName').value = d.gotymeName || '';
            document.getElementById('profGotymeNum').value = d.gotymeNumber || '';
            document.getElementById('profSss').value = d.sssNumber || '';
            document.getElementById('profPhilhealth').value = d.philhealthNumber || '';
            document.getElementById('profPagibig').value = d.pagibigNumber || '';
        }
    } catch(e) { console.error("Error fetching profile data:", e); }

    document.getElementById('profileModal').style.display = 'flex';
};

window.previewProfileImage = async function(event) {
    const file = event.target.files[0];
    if (file) {
        window.selectedProfileFile = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('profilePreview').src = e.target.result;
            document.getElementById('profilePreview').style.display = 'block';
            document.getElementById('profilePlaceholder').style.display = 'none';
        }
        reader.readAsDataURL(file);
        
        // Auto-Upload the picture the moment they select it!
        await window.uploadProfilePicture();
    }
};

window.uploadProfilePicture = async function() {
    if (!window.selectedProfileFile) return;
    
    let staffName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');

    try {
        const fileExt = window.selectedProfileFile.name.split('.').pop();
        const fileName = `staff_profiles/${staffName.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`;
        const storageReference = ref(storage, fileName);
        
        const snapshot = await uploadBytes(storageReference, window.selectedProfileFile);
        const photoUrl = await getDownloadURL(snapshot.ref);

        // Update Cashier Database
        await updateDoc(doc(db, "cashiers", staffId), { profilePicUrl: photoUrl });
        
        // Update Local Memory & Header Icon
        localStorage.setItem('takodeal_staff_pic', photoUrl);
        document.getElementById('topAvatar').innerText = '';
        document.getElementById('topAvatar').style.backgroundImage = `url('${photoUrl}')`;
        
        Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Photo Uploaded!', showConfirmButton: false, timer: 2000});
    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to upload photo.', 'error');
    }
};

window.saveProfileData = async function() {
    let staffId = localStorage.getItem('takodeal_staff_id');
    let btn = document.getElementById('btnSaveProfileData');
    
    // Grab all the typed data
    let payload = {
        cashierName: document.getElementById('profFullName').value.trim(),
        scheduleName: document.getElementById('profNickname').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        address: document.getElementById('profAddress').value.trim(),
        emergencyName: document.getElementById('profEmergName').value.trim(),
        emergencyNumber: document.getElementById('profEmergNum').value.trim(),
        email: document.getElementById('profEmail').value.trim(),
        gcashName: document.getElementById('profGcashName').value.trim(),
        gcashNumber: document.getElementById('profGcashNum').value.trim(),
        gotymeName: document.getElementById('profGotymeName').value.trim(),
        gotymeNumber: document.getElementById('profGotymeNum').value.trim(),
        sssNumber: document.getElementById('profSss').value.trim(),
        philhealthNumber: document.getElementById('profPhilhealth').value.trim(),
        pagibigNumber: document.getElementById('profPagibig').value.trim()
    };

    if (!payload.cashierName) return Swal.fire('Required', 'Full Name cannot be empty.', 'warning');

    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        await updateDoc(doc(db, "cashiers", staffId), payload);
        
        // Update the name on their screen in case they changed it
        localStorage.setItem('takodeal_staff_name', payload.cashierName);
        document.getElementById('loggedInName').innerText = payload.cashierName;

        Swal.fire('✅ Saved', 'Your HR profile has been securely synced to HQ.', 'success');
        document.getElementById('profileModal').style.display = 'none';
    } catch (e) {
        console.error("Save Profile Error:", e);
        Swal.fire('Error', 'Failed to save data. Check internet connection.', 'error');
    } finally {
        btn.innerText = "💾 Save Employee Data"; btn.disabled = false;
    }
};

// ==========================================
// 📱 NAVIGATION ENGINE
// ==========================================
window.switchView = function(viewId, btnElement) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    let targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    
    // Trigger View Specific Logic
    if (viewId === 'timeclock') window.startCameraAndGPS();
    else window.stopCamera();
};

// ==========================================
// 📢 BULLETIN BOARD ENGINE
// ==========================================
window.loadAnnouncements = async function() {
    let container = document.getElementById('bulletinList');
    try {
        const q = query(collection(db, "announcements"), where("active", "==", true));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(docSnap => {
            let data = docSnap.data();
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : 'Recent';
            html += `
                <div class="req-item-card">
                    <h3 style="margin:0 0 5px 0; color:#0f172a;">${data.title}</h3>
                    <div style="font-size:11px; color:#64748b; margin-bottom:10px;">📅 ${dateStr}</div>
                    <p style="font-size:13px; color:#334155;">${data.message || ''}</p>
                </div>
            `;
        });
        container.innerHTML = html || '<div style="text-align:center; padding: 40px; color: #94a3b8;">No new announcements.</div>';
    } catch (e) { console.error(e); }
};

// ==========================================
// ⏱️ TIME CLOCK, CAMERA & GPS ENGINE
// ==========================================
window.cameraStream = null;

window.startLiveClock = function() {
    setInterval(() => {
        const now = new Date();
        document.getElementById('liveTime').innerHTML = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('liveDate').innerHTML = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }, 1000);
};

window.startCameraAndGPS = async function() {
    // 1. Start Camera
    let videoEl = document.getElementById('clockVideo');
    let statusEl = document.getElementById('cameraStatus');
    try {
        window.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        videoEl.srcObject = window.cameraStream;
        statusEl.innerText = "🟢 Camera Active (AI Standby)";
        statusEl.style.background = "rgba(22, 163, 74, 0.8)";
    } catch (e) {
        statusEl.innerText = "❌ Camera Access Denied";
        statusEl.style.background = "rgba(220, 38, 38, 0.8)";
    }

    // 2. Start GPS
    let gpsEl = document.getElementById('gpsStatus');
    if (!navigator.geolocation) {
        gpsEl.innerText = "❌ GPS not supported on this device."; gpsEl.style.color = "#dc2626"; gpsEl.style.background = "#fef2f2";
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            window.currentLat = position.coords.latitude;
            window.currentLng = position.coords.longitude;
            gpsEl.innerText = "🟢 Location Verified"; gpsEl.style.color = "#16a34a"; gpsEl.style.background = "#dcfce7";
        },
        (error) => {
            gpsEl.innerText = "❌ Please enable GPS location."; gpsEl.style.color = "#dc2626"; gpsEl.style.background = "#fef2f2";
        }, 
        { enableHighAccuracy: true }
    );
};

window.stopCamera = function() {
    if (window.cameraStream) {
        window.cameraStream.getTracks().forEach(t => t.stop());
        window.cameraStream = null;
    }
};

window.getDistanceInMeters = function(lat1, lon1, lat2, lon2) {
    var R = 6371e3; var dLat = (lat2 - lat1) * Math.PI / 180; var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
};

window.punchTime = async function(type) {
    if (!window.currentLat || !window.currentLng) return Swal.fire('GPS Required', 'Please wait for GPS verification or enable Location Services.', 'warning');
    
    // Find closest branch
    let closestBranch = "Unknown";
    let minDistance = 999999;
    for (let branch in window.BRANCH_ZONES) {
        let zone = window.BRANCH_ZONES[branch];
        let dist = window.getDistanceInMeters(window.currentLat, window.currentLng, zone.lat, zone.lng);
        if (dist < minDistance) { minDistance = dist; closestBranch = branch; }
    }

    if (minDistance > window.ALLOWED_RADIUS_METERS) {
        return Swal.fire('Out of Range', `You are ${Math.round(minDistance)}m away from ${closestBranch}. You must be within ${window.ALLOWED_RADIUS_METERS}m to punch in.`, 'error');
    }

    // Capture Photo
    let photoBase64 = "";
    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    if (video && canvas && video.videoWidth > 0) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        photoBase64 = canvas.toDataURL('image/jpeg', 0.6); 
    }

    let staffName = localStorage.getItem('takodeal_staff_name');
    let btnIn = document.getElementById('btnTimeIn'); let btnOut = document.getElementById('btnTimeOut');
    btnIn.disabled = true; btnOut.disabled = true;

    try {
        await addDoc(collection(db, "attendance_logs"), {
            staffName: staffName, branch: closestBranch, type: type, timestamp: serverTimestamp(),
            locationLat: window.currentLat, locationLng: window.currentLng, distanceMeters: Math.round(minDistance),
            photoBase64: photoBase64
        });
        Swal.fire('✅ Success', `${type} logged at ${closestBranch}!`, 'success');
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to log time. Check connection.', 'error'); } 
    finally { btnIn.disabled = false; btnOut.disabled = false; }
};

// ==========================================
// 📥 STAFF REQUESTS ENGINE
// ==========================================
window.openReqForm = function(type) {
    if (type === 'Inbox') return window.loadInbox();

    let formHtml = '';
    window.currentReqType = type;
    document.getElementById('reqModalTitle').innerText = type + " Request";

    if (type === 'Leave') {
        formHtml = `
            <div class="form-group"><label>Start Date</label><input type="date" id="reqStart"></div>
            <div class="form-group"><label>End Date</label><input type="date" id="reqEnd"></div>
            <div class="form-group"><label>Reason</label><textarea id="reqReason" rows="3"></textarea></div>
        `;
    } else if (type === 'Cash Advance') {
        formHtml = `
            <div class="form-group"><label>Amount (₱)</label><input type="number" id="reqAmount" placeholder="0.00"></div>
            <div class="form-group"><label>Reason / Purpose</label><textarea id="reqReason" rows="2"></textarea></div>
        `;
    } else if (type === 'Staff Meal') {
        formHtml = `
            <div class="form-group"><label>Menu Item Consumed</label><input type="text" id="reqItem" placeholder="e.g. 4 Pcs Pork"></div>
            <div class="form-group"><label>Equivalent Cost (₱)</label><input type="number" id="reqAmount" placeholder="0.00"></div>
        `;
    }
    
    document.getElementById('reqModalBody').innerHTML = formHtml;
    document.getElementById('requestModal').style.display = 'flex';
};

window.submitStaffRequest = async function() {
    let payload = {
        type: window.currentReqType,
        staffName: localStorage.getItem('takodeal_staff_name'),
        status: "Pending",
        timestamp: serverTimestamp()
    };

    if (payload.type === 'Leave') {
        payload.startDate = document.getElementById('reqStart').value;
        payload.endDate = document.getElementById('reqEnd').value;
        payload.reason = document.getElementById('reqReason').value;
        if (!payload.startDate || !payload.reason) return alert("Fill all fields.");
    } else if (payload.type === 'Cash Advance') {
        payload.amount = parseFloat(document.getElementById('reqAmount').value);
        payload.reason = document.getElementById('reqReason').value;
        if (!payload.amount || !payload.reason) return alert("Fill all fields.");
    } else if (payload.type === 'Staff Meal') {
        payload.item = document.getElementById('reqItem').value;
        payload.amount = parseFloat(document.getElementById('reqAmount').value);
        if (!payload.item || !payload.amount) return alert("Fill all fields.");
    }

    let btn = document.getElementById('btnSubmitReq');
    btn.innerText = "Sending..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "staff_requests"), payload);
        Swal.fire('Sent!', 'Request submitted to HQ.', 'success');
        document.getElementById('requestModal').style.display = 'none';
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to send.', 'error'); }
    finally { btn.innerText = "🚀 Submit to HQ"; btn.disabled = false; }
};

window.loadInbox = async function() {
    let container = document.getElementById('reqInboxContainer');
    let listEl = document.getElementById('reqInboxList');
    container.style.display = 'block';
    listEl.innerHTML = 'Loading...';

    try {
        const q = query(collection(db, "staff_requests"), where("staffName", "==", localStorage.getItem('takodeal_staff_name')));
        const snap = await getDocs(q);
        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Recent';
            let color = d.status === 'Approved' ? '#16a34a' : (d.status === 'Rejected' ? '#dc2626' : '#d97706');
            html += `
                <div class="req-item-card">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <strong style="color:#0f172a;">${d.type}</strong>
                        <span style="color:${color}; font-weight:bold; font-size:12px;">${d.status}</span>
                    </div>
                    <div style="font-size:11px; color:#64748b;">📅 ${dateStr}</div>
                </div>
            `;
        });
        listEl.innerHTML = html || '<div style="color:#64748b; font-size:13px;">No requests found.</div>';
    } catch(e) { listEl.innerHTML = 'Error loading inbox.'; }
};
