// Takodeál Staff Engine v3.0 - Fleet Access Fix
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, query, where, doc, updateDoc, addDoc, setDoc, serverTimestamp, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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

console.log("🚀 Takodeál Staff Portal Booted (v3.0 - Fleet Engine Active)");

window.BRANCH_ZONES = {
    "Cabantian": { lat: 7.130415, lng: 125.617306 },
    "Citygate":  { lat: 7.111076, lng: 125.612883 },
    "Maa":       { lat: 7.078632, lng: 125.583441 },
    "Main Office": { lat: 7.153756, lng: 125.595667 }
};
window.ALLOWED_RADIUS_METERS = 50;

// ==========================================
// 🔒 DEVICE FLEET & SECURITY ENGINE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    localStorage.removeItem('takodeal_device_trusted');

    let deviceId = localStorage.getItem('takodeal_device_id');

    if (!deviceId) {
        document.getElementById('deviceAuthOverlay').style.display = 'flex';
        document.getElementById('registerCard').style.display = 'block';
        document.getElementById('pendingCard').style.display = 'none';
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'none';
    } else {
        window.listenToDeviceStatus(deviceId);
    }
});

window.requestDeviceAccess = async function() {
    let name = document.getElementById('deviceNameInput').value.trim();
    if (!name) return Swal.fire('Required', 'Please enter a device name (e.g. Aljhon Phone).', 'warning');

    let btn = document.querySelector('#registerCard .btn-primary');
    btn.innerText = "⏳ Registering..."; btn.disabled = true;

    try {
        // Generate a standard unique ID
        const newDeviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();

        // Send payload explicitly mapping to the fields your Manager App table renders
        await setDoc(doc(db, "devices", newDeviceId), {
            deviceName: name + " (Staff)",
            branch: "Main Office",
            status: "Blocked",
            registrationDate: new Date().toLocaleDateString('en-US'),
            timestamp: serverTimestamp()
        });

        localStorage.setItem('takodeal_device_id', newDeviceId);
        window.listenToDeviceStatus(newDeviceId);

    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to connect to HQ.', 'error');
        btn.innerText = "Request Access"; btn.disabled = false;
    }
};

window.listenToDeviceStatus = function(deviceId) {
    document.getElementById('deviceAuthOverlay').style.display = 'flex';
    document.getElementById('registerCard').style.display = 'none';
    document.getElementById('pendingCard').style.display = 'block';
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'none';

    onSnapshot(doc(db, "devices", deviceId), (docSnap) => {
        if (docSnap.exists()) {
            let status = docSnap.data().status;
            if (status === 'Active') {
                document.getElementById('deviceAuthOverlay').style.display = 'none';
                window.checkNormalLogin();
            } else {
                document.getElementById('deviceAuthOverlay').style.display = 'flex';
                document.getElementById('registerCard').style.display = 'none';
                document.getElementById('pendingCard').style.display = 'block';
                document.getElementById('loginOverlay').style.display = 'none';
            }
        }
    });
};

window.checkNormalLogin = function() {
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
        
        if(!window.clockStarted) { window.startLiveClock(); window.clockStarted = true; }
        window.loadAnnouncements();
        window.startInboxListener();
    } else {
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
    }
};

window.loginStaff = async function() {
    let pinInput = document.getElementById('loginPin').value.trim();
    let errorMsg = document.getElementById('loginError');
    let btn = document.querySelector('#loginOverlay .btn-primary');

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
            staffData = snapStr.docs[0].data(); docId = snapStr.docs[0].id;
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
            
            if(!window.clockStarted) { window.startLiveClock(); window.clockStarted = true; }
            window.loadAnnouncements();
            window.startInboxListener();
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
            localStorage.removeItem('takodeal_staff_name');
            localStorage.removeItem('takodeal_staff_id');
            localStorage.removeItem('takodeal_staff_pic');
            location.reload(); 
        }
    });
};

// ==========================================
// 📋 PROFILE ENGINE
// ==========================================
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
    document.getElementById('profPin').value = ''; 
    
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

        await updateDoc(doc(db, "cashiers", staffId), { profilePicUrl: photoUrl });
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

    let newPin = document.getElementById('profPin').value.trim();
    if (newPin) payload.pin = newPin;

    if (!payload.cashierName) return Swal.fire('Required', 'Full Name cannot be empty.', 'warning');

    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        await updateDoc(doc(db, "cashiers", staffId), payload);
        localStorage.setItem('takodeal_staff_name', payload.cashierName);
        document.getElementById('loggedInName').innerText = payload.cashierName;

        let successMsg = newPin ? 'Your profile and new PIN have been securely saved.' : 'Your HR profile has been securely synced to HQ.';
        Swal.fire('✅ Saved', successMsg, 'success');
        document.getElementById('profileModal').style.display = 'none';
        document.getElementById('profPin').value = ''; 
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
    
    if (viewId === 'timeclock') window.startCameraAndGPS();
    else window.stopCamera();
};

// ==========================================
// 📢 BULLETIN BOARD ENGINE
// ==========================================
window.loadAnnouncements = async function() {
    let container = document.getElementById('bulletinList');
    let cashierName = localStorage.getItem('takodeal_staff_name');
    if (!cashierName) return;

    try {
        const q = query(collection(db, "announcements"), where("active", "==", true));
        const snap = await getDocs(q);

        const ackQ = query(collection(db, "acknowledgments"), where("staffName", "==", cashierName));
        const ackSnap = await getDocs(ackQ);

        let signatures = {};
        ackSnap.forEach(doc => { let d = doc.data(); signatures[d.announcementId] = d; });

        let announcementsArray = [];
        snap.forEach(docSnap => announcementsArray.push({id: docSnap.id, ...docSnap.data()}));
        announcementsArray.sort((a,b) => b.timestamp - a.timestamp); 

        let html = '';
        announcementsArray.forEach(ann => {
            let dateStr = ann.timestamp ? ann.timestamp.toDate().toLocaleDateString() : 'Recent';
            let sigData = signatures[ann.id];
            let shortMsg = ann.message ? ann.message.substring(0, 100) + (ann.message.length > 100 ? '...' : '') : '';

            let statusBadge = sigData
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #bbf7d0;">✅ Signed</span>`
                : `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #fecaca;">❌ Unread</span>`;

            let sigDateStr = sigData && sigData.timestamp ? sigData.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';

            let safeData = {
                title: ann.title || 'Announcement',
                message: ann.message || '',
                images: ann.images || [],
                dateStr: dateStr,
                hasSignature: !!sigData,
                signatureImg: sigData ? sigData.signature : '',
                signatureDate: sigDateStr
            };
            let modalData = encodeURIComponent(JSON.stringify(safeData));

            html += `
                <div class="req-item-card" onclick="window.viewAnnouncement('${modalData}')" style="cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: transform 0.2s;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                        <h3 style="margin:0; color:#0f172a; font-size: 15px; flex: 1;">${ann.title}</h3>
                        <div style="margin-left: 10px;">${statusBadge}</div>
                    </div>
                    <div style="font-size:11px; color:#64748b; margin-bottom:10px;">📅 Published: ${dateStr}</div>
                    <p style="font-size:13px; color:#334155; margin:0 0 10px 0; line-height: 1.4;">${shortMsg}</p>
                    <div style="font-size: 11px; color: #0ea5e9; font-weight: bold; text-align: right;">View Full Details &rarr;</div>
                </div>
            `;
        });
        container.innerHTML = html || '<div style="text-align:center; padding: 40px; color: #94a3b8;">No new announcements.</div>';
    } catch (e) { console.error(e); container.innerHTML = '<div style="text-align:center; padding: 40px; color: #dc2626;">Error loading announcements.</div>';}
};

window.viewAnnouncement = function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    let imagesHtml = '';
    if (data.images && data.images.length > 0) {
        imagesHtml = `<div style="display: flex; gap: 10px; overflow-x: auto; margin-top: 15px; padding-bottom: 5px;">`;
        data.images.forEach(img => {
            imagesHtml += `<img src="${img}" style="height: 120px; border-radius: 6px; border: 1px solid #cbd5e1; object-fit: cover; cursor: pointer;" onclick="window.open('${img}', '_blank')">`;
        });
        imagesHtml += `</div>`;
    }

    let sigHtml = data.hasSignature 
        ? `<div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1; text-align: center; background: #f8fafc; border-radius: 8px; padding: 15px;">
            <span style="font-size: 12px; color: #16a34a; font-weight: bold; display: block; margin-bottom: 10px;">✅ You acknowledged this on ${data.signatureDate}</span>
            <img src="${data.signatureImg}" style="height: 50px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px;">
           </div>`
        : `<div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1; text-align: center; background: #fef2f2; border-radius: 8px; padding: 15px;">
            <span style="font-size: 12px; color: #dc2626; font-weight: bold; display: block;">❌ You have not signed this yet.</span>
           </div>`;

    Swal.fire({
        title: `<div style="text-align:left; font-size: 18px; color: #0f172a; margin-bottom: 10px;">${data.title}</div>`,
        html: `<div style="text-align: left;">
                <div style="font-size: 12px; color: #64748b; margin-bottom: 15px;">📅 Published: ${data.dateStr}</div>
                <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${data.message || ''}</div>
                ${imagesHtml}${sigHtml}
               </div>`,
        showCloseButton: true, showConfirmButton: false
    });
};

// ==========================================
// ⏱️ TIME CLOCK, CAMERA & GPS ENGINE
// ==========================================
window.cameraStream = null;

window.startLiveClock = function() {
    setInterval(() => {
        const now = new Date();
        const timeEl = document.getElementById('liveTime');
        const dateEl = document.getElementById('liveDate');
        if (timeEl) timeEl.innerHTML = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (dateEl) dateEl.innerHTML = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }, 1000);
};

window.startCameraAndGPS = async function() {
    let videoEl = document.getElementById('clockVideo');
    let statusEl = document.getElementById('cameraStatus');
    try {
        window.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        videoEl.srcObject = window.cameraStream;
        statusEl.innerText = "🟢 Camera Active (AI Standby)"; statusEl.style.background = "rgba(22, 163, 74, 0.8)";
    } catch (e) {
        statusEl.innerText = "❌ Camera Access Denied"; statusEl.style.background = "rgba(220, 38, 38, 0.8)";
    }

    let gpsEl = document.getElementById('gpsStatus');
    if (!navigator.geolocation) {
        gpsEl.innerText = "❌ GPS not supported on this device."; gpsEl.style.color = "#dc2626"; gpsEl.style.background = "#fef2f2";
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            window.currentLat = position.coords.latitude; window.currentLng = position.coords.longitude;
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
        window.cameraStream.getTracks().forEach(t => t.stop()); window.cameraStream = null;
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
        return Swal.fire('Cooldown Active', 'Please wait 1 minute before punching again.', 'warning');
    }

    if (!window.currentLat || !window.currentLng) return Swal.fire('GPS Required', 'Please wait for GPS verification.', 'warning');
    
    let closestBranch = "Unknown"; let minDistance = 999999;
    for (let branch in window.BRANCH_ZONES) {
        let zone = window.BRANCH_ZONES[branch];
        let dist = window.getDistanceInMeters(window.currentLat, window.currentLng, zone.lat, zone.lng);
        if (dist < minDistance) { minDistance = dist; closestBranch = branch; }
    }

    if (minDistance > window.ALLOWED_RADIUS_METERS) {
        return Swal.fire('Out of Range', `You are ${Math.round(minDistance)}m away from ${closestBranch}. You must be within ${window.ALLOWED_RADIUS_METERS}m to punch in.`, 'error');
    }

    let photoBase64 = "";
    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    if (video && canvas && video.videoWidth > 0) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0);
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
        
        localStorage.setItem('takodeal_last_punch', Date.now()); 
        Swal.fire('✅ Success', `${type} logged at ${closestBranch}!`, 'success');
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to log time.', 'error'); } 
    finally { btnIn.disabled = false; btnOut.disabled = false; }
};

// ==========================================
// 📥 STAFF REQUESTS & INBOX ENGINE
// ==========================================
window.openReqForm = function(type) {
    if (type === 'Inbox') return window.loadInbox();
    let formHtml = ''; window.currentReqType = type;
    document.getElementById('reqModalTitle').innerText = type + " Request";

    if (type === 'Leave') {
        formHtml = `<div class="form-group"><label>Start Date</label><input type="date" id="reqStart"></div>
            <div class="form-group"><label>End Date</label><input type="date" id="reqEnd"></div>
            <div class="form-group"><label>Reason</label><textarea id="reqReason" rows="3"></textarea></div>`;
    } else if (type === 'Cash Advance') {
        formHtml = `<div class="form-group"><label>Amount (₱)</label><input type="number" id="reqAmount" placeholder="0.00"></div>
            <div class="form-group"><label>Reason / Purpose</label><textarea id="reqReason" rows="2"></textarea></div>`;
    } else if (type === 'Staff Meal') {
        formHtml = `<div class="form-group"><label>Menu Item Consumed</label><input type="text" id="reqItem" placeholder="e.g. 4 Pcs Pork"></div>
            <div class="form-group"><label>Equivalent Cost (₱)</label><input type="number" id="reqAmount" placeholder="0.00"></div>
            <div class="form-group"><label>Attach POS Receipt Photo *</label><input type="file" id="reqMealProof" accept="image/*" style="border: 1px dashed #0f766e; background: #f0fdf4; padding: 10px;"></div>`;
    }
    
    document.getElementById('reqModalBody').innerHTML = formHtml;
    document.getElementById('requestModal').style.display = 'flex';
};

window.submitStaffRequest = async function() {
    let payload = { type: window.currentReqType, staffName: localStorage.getItem('takodeal_staff_name'), status: "Pending", staffAcknowledged: false, timestamp: serverTimestamp() };
    let fileToUpload = null;

    if (payload.type === 'Leave') {
        payload.startDate = document.getElementById('reqStart').value; payload.endDate = document.getElementById('reqEnd').value; payload.reason = document.getElementById('reqReason').value.trim();
        if (!payload.startDate || !payload.reason) return Swal.fire('Incomplete', 'Fill all required fields.', 'warning');
    } else if (payload.type === 'Cash Advance') {
        payload.amount = parseFloat(document.getElementById('reqAmount').value); payload.reason = document.getElementById('reqReason').value.trim();
        if (!payload.amount || !payload.reason) return Swal.fire('Incomplete', 'Fill all required fields.', 'warning');
    } else if (payload.type === 'Staff Meal') {
        payload.item = document.getElementById('reqItem').value.trim(); payload.amount = parseFloat(document.getElementById('reqAmount').value); fileToUpload = document.getElementById('reqMealProof').files[0];
        if (!payload.item || !payload.amount || !fileToUpload) return Swal.fire('Incomplete', 'You must attach the receipt photo.', 'warning');
    }

    let btn = document.getElementById('btnSubmitReq');
    btn.innerText = fileToUpload ? "⏳ Uploading Photo..." : "⏳ Sending..."; btn.disabled = true;

    try {
        if (fileToUpload) {
            const fileName = `staff_requests/meal_${payload.staffName.replace(/\s+/g, '_')}_${Date.now()}.${fileToUpload.name.split('.').pop()}`;
            const snapshot = await uploadBytes(ref(storage, fileName), fileToUpload);
            payload.proofImageUrl = await getDownloadURL(snapshot.ref);
        }
        await addDoc(collection(db, "staff_requests"), payload);
        Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Submitted to HQ!', showConfirmButton: false, timer: 2000});
        document.getElementById('requestModal').style.display = 'none';
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to send request.', 'error'); } 
    finally { btn.innerText = "🚀 Submit to HQ"; btn.disabled = false; }
};

window.playNotificationPing = function() {
    try {
        let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(1318.51, audioCtx.currentTime);
        gain.gain.setValueAtTime(1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.5);
    } catch(e){}
};

window.startInboxListener = function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    if (!staffName) return;

    onSnapshot(query(collection(db, "staff_requests"), where("staffName", "==", staffName)), (snapshot) => {
        let unreadCount = 0;
        snapshot.forEach(doc => { let d = doc.data(); if ((d.status === 'Approved' || d.status === 'Rejected') && !d.staffAcknowledged) unreadCount++; });
        let badge = document.getElementById('navReqBadge');
        if (badge) {
            if (unreadCount > 0) {
                badge.style.display = 'block'; badge.innerText = unreadCount;
                if (window.lastUnreadCount !== undefined && unreadCount > window.lastUnreadCount) window.playNotificationPing();
                window.lastUnreadCount = unreadCount;
            } else { badge.style.display = 'none'; window.lastUnreadCount = 0; }
        }
    });
};

window.loadInbox = async function() {
    let listEl = document.getElementById('reqInboxList');
    document.getElementById('reqInboxContainer').style.display = 'block';
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Loading...</div>';

    try {
        const snap = await getDocs(query(collection(db, "staff_requests"), where("staffName", "==", localStorage.getItem('takodeal_staff_name'))));
        let docsArray = []; snap.forEach(docSnap => docsArray.push({id: docSnap.id, ...docSnap.data()}));
        docsArray.sort((a,b) => b.timestamp - a.timestamp); 

        let html = '';
        docsArray.forEach(d => {
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
                    <div style="font-size:11px; color:#64748b;">📅 Submitted: ${d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Recent'}</div>
                    ${proofHtml}${replyHtml}
                </div>
            `;
            if ((d.status === 'Approved' || d.status === 'Rejected') && !d.staffAcknowledged) updateDoc(doc(db, "staff_requests", d.id), { staffAcknowledged: true });
        });
        listEl.innerHTML = html || '<div style="color:#64748b; font-size:13px; text-align:center;">No requests found.</div>';
    } catch(e) { console.error(e); listEl.innerHTML = 'Error loading inbox.'; }
};
