// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, query, where, doc, updateDoc, addDoc, serverTimestamp, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
        window.startInboxListener();
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
            window.startInboxListener();
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
    
    if (pic && pic.length > 5) {
        preview.src = pic; preview.style.display = 'block'; placeholder.style.display = 'none';
    } else {
        preview.style.display = 'none'; placeholder.style.display = 'flex';
    }
    
    window.selectedProfileFile = null;
    document.getElementById('profPin').value = ''; // Always clear PIN field on load
    
    try {
        const docRef = doc(db, "cashiers", staffId);
        const docSnap = await getDoc(docRef);
        
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
            
            // Render the Read-Only Deductions
            document.getElementById('viewSssDed').innerText = '₱' + (parseFloat(d.sssDeduction) || 0).toFixed(2);
            document.getElementById('viewPhDed').innerText = '₱' + (parseFloat(d.philhealthDeduction) || 0).toFixed(2);
            document.getElementById('viewPagibigDed').innerText = '₱' + (parseFloat(d.pagibigDeduction) || 0).toFixed(2);
            
            let customDedText = "None";
            if (d.customDeductions && d.customDeductions.length > 0) {
                customDedText = d.customDeductions.map(c => `${c.name}: ₱${parseFloat(c.amount).toFixed(2)}`).join('<br>');
            }
            document.getElementById('viewCustomDed').innerHTML = customDedText;
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

    // Grab the new PIN (if they typed one)
    let newPin = document.getElementById('profPin').value.trim();
    if (newPin) {
        payload.pin = newPin; // Appends it to the save payload!
    }

    if (!payload.cashierName) return Swal.fire('Required', 'Full Name cannot be empty.', 'warning');

    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        await updateDoc(doc(db, "cashiers", staffId), payload);
        
        localStorage.setItem('takodeal_staff_name', payload.cashierName);
        document.getElementById('loggedInName').innerText = payload.cashierName;

        let successMsg = newPin ? 'Your profile and new PIN have been securely saved.' : 'Your HR profile has been securely synced to HQ.';
        Swal.fire('✅ Saved', successMsg, 'success');
        
        document.getElementById('profileModal').style.display = 'none';
        document.getElementById('profPin').value = ''; // Wipe PIN field for security
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
    let lastPunch = localStorage.getItem('takodeal_last_punch');
    if (lastPunch && (Date.now() - parseInt(lastPunch) < 60000)) {
        return Swal.fire('Cooldown Active', 'Please wait 1 minute before punching again to prevent accidental double-logs.', 'warning');
    }
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
            photoBase64: photoBase64, localStorage.setItem('takodeal_last_punch', Date.now());
        });
        Swal.fire('✅ Success', `${type} logged at ${closestBranch}!`, 'success');
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to log time. Check connection.', 'error'); } 
    finally { btnIn.disabled = false; btnOut.disabled = false; }
};

// ==========================================
// 📥 STAFF REQUESTS & INBOX ENGINE
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
            <div class="form-group">
                <label>Attach POS Receipt Photo *</label>
                <input type="file" id="reqMealProof" accept="image/*" style="border: 1px dashed #0f766e; background: #f0fdf4; padding: 10px;">
            </div>
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
        staffAcknowledged: false, // Tracks if staff has read the manager's reply
        timestamp: serverTimestamp()
    };

    let fileToUpload = null;

    if (payload.type === 'Leave') {
        payload.startDate = document.getElementById('reqStart').value;
        payload.endDate = document.getElementById('reqEnd').value;
        payload.reason = document.getElementById('reqReason').value.trim();
        if (!payload.startDate || !payload.reason) return Swal.fire('Incomplete', 'Fill all required fields.', 'warning');
    } else if (payload.type === 'Cash Advance') {
        payload.amount = parseFloat(document.getElementById('reqAmount').value);
        payload.reason = document.getElementById('reqReason').value.trim();
        if (!payload.amount || !payload.reason) return Swal.fire('Incomplete', 'Fill all required fields.', 'warning');
    } else if (payload.type === 'Staff Meal') {
        payload.item = document.getElementById('reqItem').value.trim();
        payload.amount = parseFloat(document.getElementById('reqAmount').value);
        fileToUpload = document.getElementById('reqMealProof').files[0];
        if (!payload.item || !payload.amount || !fileToUpload) return Swal.fire('Incomplete', 'You must fill all fields and attach the receipt photo.', 'warning');
    }

    let btn = document.getElementById('btnSubmitReq');
    btn.innerText = fileToUpload ? "⏳ Uploading Photo..." : "⏳ Sending..."; 
    btn.disabled = true;

    try {
        // Handle Photo Upload if Staff Meal
        if (fileToUpload) {
            const fileExt = fileToUpload.name.split('.').pop();
            const fileName = `staff_requests/meal_${payload.staffName.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`;
            const storageReference = ref(storage, fileName);
            const snapshot = await uploadBytes(storageReference, fileToUpload);
            payload.proofImageUrl = await getDownloadURL(snapshot.ref);
        }

        await addDoc(collection(db, "staff_requests"), payload);
        Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Submitted to HQ!', showConfirmButton: false, timer: 2000});
        document.getElementById('requestModal').style.display = 'none';
    } catch(e) { 
        console.error(e); Swal.fire('Error', 'Failed to send request.', 'error'); 
    } finally { 
        btn.innerText = "🚀 Submit to HQ"; btn.disabled = false; 
    }
};

// --- NOTIFICATION ENGINE ---
window.playNotificationPing = function() {
    try {
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(1318.51, audioCtx.currentTime);
        gain.gain.setValueAtTime(1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.5);
    } catch(e){}
};

window.startInboxListener = function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    if (!staffName) return;

    const q = query(collection(db, "staff_requests"), where("staffName", "==", staffName));
    onSnapshot(q, (snapshot) => {
        let unreadCount = 0;
        snapshot.forEach(doc => {
            let d = doc.data();
            // Count if it's Approved/Rejected AND the staff hasn't read it yet!
            if ((d.status === 'Approved' || d.status === 'Rejected') && !d.staffAcknowledged) {
                unreadCount++;
            }
        });

        let badge = document.getElementById('navReqBadge');
        if (badge) {
            if (unreadCount > 0) {
                badge.style.display = 'block';
                badge.innerText = unreadCount;
                if (window.lastUnreadCount !== undefined && unreadCount > window.lastUnreadCount) window.playNotificationPing();
                window.lastUnreadCount = unreadCount;
            } else {
                badge.style.display = 'none';
                window.lastUnreadCount = 0;
            }
        }
    });
};

window.loadInbox = async function() {
    let container = document.getElementById('reqInboxContainer');
    let listEl = document.getElementById('reqInboxList');
    container.style.display = 'block';
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Loading...</div>';

    try {
        const q = query(collection(db, "staff_requests"), where("staffName", "==", localStorage.getItem('takodeal_staff_name')));
        const snap = await getDocs(q);
        
        let docsArray = [];
        snap.forEach(docSnap => docsArray.push({id: docSnap.id, ...docSnap.data()}));
        docsArray.sort((a,b) => b.timestamp - a.timestamp); // Newest first

        let html = '';
        docsArray.forEach(d => {
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Recent';
            let color = d.status === 'Approved' ? '#16a34a' : (d.status === 'Rejected' ? '#dc2626' : '#d97706');
            let bg = d.status === 'Approved' ? '#dcfce7' : (d.status === 'Rejected' ? '#fef2f2' : '#fffbeb');
            
            let replyHtml = d.managerReply ? `<div style="margin-top: 8px; padding: 8px; background: #f8fafc; border-left: 3px solid ${color}; border-radius: 4px; font-size: 12px; color: #475569;"><b>HQ Reply:</b> ${d.managerReply}</div>` : '';
            let proofHtml = d.proofImageUrl ? `<div style="margin-top: 8px; font-size: 11px;"><a href="${d.proofImageUrl}" target="_blank" style="color:#0ea5e9; text-decoration:none;">📸 View Receipt Attached</a></div>` : '';

            html += `
                <div class="req-item-card" style="border-left: 4px solid ${color};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <strong style="color:#0f172a; font-size:14px;">${d.type}</strong>
                        <span style="background:${bg}; color:${color}; font-weight:bold; font-size:11px; padding:4px 8px; border-radius:6px;">${d.status}</span>
                    </div>
                    <div style="font-size:11px; color:#64748b;">📅 Submitted: ${dateStr}</div>
                    ${proofHtml}
                    ${replyHtml}
                </div>
            `;

            // 🔥 Mark as Read: If they open the inbox, acknowledge any unread replies!
            if ((d.status === 'Approved' || d.status === 'Rejected') && !d.staffAcknowledged) {
                updateDoc(doc(db, "staff_requests", d.id), { staffAcknowledged: true });
            }
        });
        
        listEl.innerHTML = html || '<div style="color:#64748b; font-size:13px; text-align:center;">No requests found.</div>';
    } catch(e) { console.error(e); listEl.innerHTML = 'Error loading inbox.'; }
};
