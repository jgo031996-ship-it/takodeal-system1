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

// ==========================================
// 🔒 DEVICE FLEET & SECURITY ENGINE
// ==========================================
window.requestDeviceAccess = async function() {
    let name = document.getElementById('deviceNameInput').value.trim();
    let selectedBranch = document.getElementById('deviceBranchInput').value;

    if (!name) return Swal.fire('Required', 'Please enter a device name (e.g. Aljhon Phone).', 'warning');

    let btn = document.querySelector('#registerCard .btn-primary');
    btn.innerText = "⏳ Registering..."; btn.disabled = true;

    // Detect branch via GPS if set to Auto or default to chosen option
    let targetBranch = selectedBranch;
    if (selectedBranch === 'Auto') {
        targetBranch = window.getClosestBranch() || "Main Office";
    }

    try {
        const newDeviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();

        await setDoc(doc(db, "pos_devices", newDeviceId), {
            deviceName: name + " (Staff)",
            branch: targetBranch,
            status: "Blocked",
            registeredAt: serverTimestamp()
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

    onSnapshot(doc(db, "pos_devices", deviceId), (docSnap) => {
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

window.getClosestBranch = function() {
    if (!window.currentLat || !window.currentLng) return null;
    let closestBranch = "Main Office";
    let minDistance = 999999;
    for (let branch in window.BRANCH_ZONES) {
        let zone = window.BRANCH_ZONES[branch];
        let dist = window.getDistanceInMeters(window.currentLat, window.currentLng, zone.lat, zone.lng);
        if (dist < minDistance) { minDistance = dist; closestBranch = branch; }
    }
    return closestBranch;
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
    if (viewId === 'payslip') window.loadPayslipVault();
};

// ==========================================
// 📢 BULLETIN BOARD & SIGNATURE ENGINE
// ==========================================
window.hasAutoShownBulletin = false; // Prevents the popup from spamming every time they change tabs

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
        let unreadAnnouncements = [];

        announcementsArray.forEach(ann => {
            let dateStr = ann.timestamp ? ann.timestamp.toDate().toLocaleDateString() : 'Recent';
            let sigData = signatures[ann.id];
            let shortMsg = ann.message ? ann.message.substring(0, 100) + (ann.message.length > 100 ? '...' : '') : '';

            let statusBadge = sigData
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #bbf7d0;">✅ Signed</span>`
                : `<span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #fecaca; animation: pulse 2s infinite;">❌ Requires Signature</span>`;

            let sigDateStr = sigData && sigData.timestamp ? sigData.timestamp.toDate().toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';

            let safeData = {
                id: ann.id, // We need this to save the signature!
                title: ann.title || 'Announcement',
                message: ann.message || '',
                images: ann.images || [],
                dateStr: dateStr,
                hasSignature: !!sigData,
                signatureImg: sigData ? sigData.signature : '',
                signatureDate: sigDateStr
            };
            
            let modalData = encodeURIComponent(JSON.stringify(safeData));

            // Track unread announcements for the auto-popup!
            if (!sigData) unreadAnnouncements.push(modalData);

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

        // 🔥 THE AUTO-POPUP ENGINE
        // If there is an unread announcement and we haven't shown it this session, force it open!
        if (unreadAnnouncements.length > 0 && !window.hasAutoShownBulletin) {
            window.hasAutoShownBulletin = true;
            setTimeout(() => {
                window.viewAnnouncement(unreadAnnouncements[0]); // Pops the most recent unread one!
            }, 1000); // 1-second delay so the app UI has time to load smoothly behind it
        }

    } catch (e) { 
        console.error(e); 
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #dc2626;">Error loading announcements.</div>';
    }
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

    let sigHtml = '';

    if (data.hasSignature) {
        sigHtml = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1; text-align: center; background: #f8fafc; border-radius: 8px; padding: 15px; border: 1px solid #bbf7d0;">
                <span style="font-size: 12px; color: #16a34a; font-weight: bold; display: block; margin-bottom: 10px;">✅ You acknowledged this on ${data.signatureDate}</span>
                <img src="${data.signatureImg}" style="height: 60px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px;">
            </div>`;
    } else {
        // 🔥 THE NEW SIGNATURE PAD UI 🔥
        sigHtml = `
            <div style="margin-top: 25px; padding: 20px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 12px;">
                <h4 style="margin: 0 0 5px 0; color: #b45309; text-align: center; font-size: 15px;">Mandatory Acknowledgment</h4>
                <p style="font-size: 11px; color: #92400e; text-align: center; margin-bottom: 15px;">Please sign your name inside the box below to confirm you have read and understood this update.</p>
                
                <div style="background: white; border: 2px dashed #d97706; border-radius: 8px; overflow: hidden; touch-action: none; position: relative;">
                    <canvas id="sigCanvas" width="300" height="150" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none;"></canvas>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 15px;">
                    <button onclick="window.clearSignature()" style="flex: 1; background: white; color: #64748b; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">Clear</button>
                    <button onclick="window.submitSignature('${data.id}')" id="btnSubmitSig" style="flex: 2; background: #0f766e; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(15, 118, 110, 0.3);">Submit Signature</button>
                </div>
            </div>`;
    }

    Swal.fire({
        title: `<div style="text-align:left; font-size: 18px; color: #0f172a; margin-bottom: 10px;">${data.title}</div>`,
        html: `<div style="text-align: left; max-height: 70vh; overflow-y: auto; padding-right: 5px;">
                <div style="font-size: 12px; color: #64748b; margin-bottom: 15px;">📅 Published: ${data.dateStr}</div>
                <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${data.message || ''}</div>
                ${imagesHtml}
                ${sigHtml}
               </div>`,
        showCloseButton: true, 
        showConfirmButton: false,
        allowOutsideClick: data.hasSignature, // Forces them to sign it instead of clicking away!
        customClass: { popup: 'rounded-2xl shadow-2xl' },
        didOpen: () => {
            if (!data.hasSignature) {
                // Initialize the drawing engine immediately after SweetAlert opens!
                window.initSignaturePad();
            }
        }
    });
};

window.isSignatureBlank = true;

window.initSignaturePad = function() {
    const canvas = document.getElementById('sigCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Make lines look like a smooth pen!
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    window.isSignatureBlank = true;

    let drawing = false;

    // Accurate coordinates regardless of screen size
    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startDraw = (e) => { 
        drawing = true; 
        window.isSignatureBlank = false;
        const pos = getPos(e); 
        ctx.beginPath(); 
        ctx.moveTo(pos.x, pos.y); 
        e.preventDefault(); // Stops the screen from scrolling on mobile!
    };

    const draw = (e) => { 
        if (!drawing) return; 
        const pos = getPos(e); 
        ctx.lineTo(pos.x, pos.y); 
        ctx.stroke(); 
        e.preventDefault(); 
    };

    const stopDraw = (e) => { 
        drawing = false; 
        ctx.closePath(); 
        if(e) e.preventDefault(); 
    };

    // Mouse Events
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

    // Touch Events (For mobile phones!)
    canvas.addEventListener('touchstart', startDraw, {passive: false});
    canvas.addEventListener('touchmove', draw, {passive: false});
    canvas.addEventListener('touchend', stopDraw, {passive: false});
};

window.clearSignature = function() {
    const canvas = document.getElementById('sigCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.isSignatureBlank = true;
    }
};

window.submitSignature = async function(announcementId) {
    const canvas = document.getElementById('sigCanvas');
    if (!canvas) return;

    if (window.isSignatureBlank) {
        return Swal.showValidationMessage("Please draw your signature in the box first.");
    }

    let btn = document.getElementById('btnSubmitSig');
    let origText = btn.innerText;
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    // Convert the drawing to a Base64 image string
    let sigDataUrl = canvas.toDataURL("image/png");
    let staffName = localStorage.getItem('takodeal_staff_name');

    try {
        await addDoc(collection(db, "acknowledgments"), {
            announcementId: announcementId,
            staffName: staffName,
            signature: sigDataUrl,
            timestamp: serverTimestamp()
        });

        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Thank you! Acknowledgment saved.', 
            showConfirmButton: false, timer: 2500
        });

        // Close the modal and reload the list so it instantly turns into a Green Checkmark!
        Swal.close();
        window.loadAnnouncements();

    } catch (e) {
        console.error("Signature Save Error:", e);
        Swal.showValidationMessage("Failed to save signature. Check connection.");
        btn.innerText = origText; btn.disabled = false;
    }
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

// ==========================================
// ⏱️ STRICT TIME CLOCK & SOP BLOCKER ENGINE (CRASH-PROOF)
// ==========================================
window.punchTime = async function(type) {
    let staffName = localStorage.getItem('takodeal_staff_name');
    if (!staffName) return Swal.fire('Error', 'Not logged in.', 'error');

    let btnIn = document.getElementById('btnTimeIn'); 
    let btnOut = document.getElementById('btnTimeOut');
    if (btnIn) btnIn.disabled = true; 
    if (btnOut) btnOut.disabled = true;

    try {
        Swal.fire({title: 'Verifying with HQ...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

        // 1. ☁️ LIVE CLOUD DOUBLE-PUNCH SHIELD
        let lookBack = new Date();
        lookBack.setHours(lookBack.getHours() - 18); 
        
        // 🔥 THE FIX: Removed the composite ">=" timestamp query to bypass the Index crash!
        const q = query(collection(db, "attendance_logs"), where("staffName", "==", staffName));
        const snap = await getDocs(q);
        
        let userLogs = [];
        snap.forEach(doc => {
            let d = doc.data();
            // Filter the time locally instead of asking Firebase to do it!
            if (d.timestamp && d.timestamp.toDate() >= lookBack) {
                userLogs.push(d);
            }
        });
        
        userLogs.sort((a,b) => b.timestamp.toDate() - a.timestamp.toDate());

        if (userLogs.length > 0) {
            let lastLog = userLogs[0];
            let lastType = lastLog.type;
            let lastTime = lastLog.timestamp.toDate();
            let hoursSince = (new Date() - lastTime) / (1000 * 60 * 60);

            if (type === "TIME IN" && lastType === "TIME IN" && hoursSince < 12) {
                Swal.fire('Already Timed In', 'You are already clocked in! (Checked via cloud). Please Time Out first.', 'error');
                return;
            }
            if (type === "TIME OUT" && lastType.includes("TIME OUT")) {
                Swal.fire('Already Timed Out', 'You are already clocked out! (Checked via cloud). Please Time In first.', 'error');
                return;
            }
            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSince < 0.25) {
                Swal.fire('Too Soon', 'You just timed in less than 15 minutes ago. Please wait before timing out.', 'warning');
                return;
            }
        } else if (type === "TIME OUT") {
            Swal.fire('No Time In Found', 'You cannot Time Out without Timing In first today.', 'error');
            return;
        }

        // 2. 📋 THE DAILY SOP COMPLIANCE BLOCKER (ONLY ON TIME OUT)
        if (type === "TIME OUT") {
            let startOfDay = new Date();
            startOfDay.setHours(0,0,0,0);
            
            // 🔥 THE FIX: Removed the composite ">=" timestamp query to bypass the Index crash!
            const sopQ = query(collection(db, "sop_logs"), where("staffName", "==", staffName));
            const sopSnap = await getDocs(sopQ);
            
            let hasSopToday = false;
            sopSnap.forEach(doc => {
                let d = doc.data();
                // Filter the time locally instead of asking Firebase to do it!
                if (d.timestamp && d.timestamp.toDate() >= startOfDay) {
                    hasSopToday = true;
                }
            });
            
            if (!hasSopToday) {
                Swal.fire({
                    title: '📋 SOP Required!',
                    html: 'You cannot Time Out until you have submitted your Daily SOP Checklist.<br><br><span style="font-size:12px; color:#dc2626; font-weight:bold;">If tasks are unfinished, you must mark them as "Missed" and type a reason.</span>',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Go to SOP',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#0f766e',
                    customClass: { popup: 'rounded-2xl' }
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.switchView('sop', document.querySelectorAll('.bottom-nav .nav-item')[4]);
                    }
                });
                return; // Completely stops the Time Out from proceeding!
            }
        }

        // 3. 📍 GPS VERIFICATION
        if (!window.currentLat || !window.currentLng) {
            Swal.fire('GPS Required', 'Please wait for GPS verification. Ensure your location is turned on.', 'warning');
            return;
        }
        
        let closestBranch = "Unknown"; let minDistance = 999999;
        for (let branch in window.BRANCH_ZONES) {
            let zone = window.BRANCH_ZONES[branch];
            let dist = window.getDistanceInMeters(window.currentLat, window.currentLng, zone.lat, zone.lng);
            if (dist < minDistance) { minDistance = dist; closestBranch = branch; }
        }

        if (minDistance > window.ALLOWED_RADIUS_METERS) {
            Swal.fire('Out of Range', `You are ${Math.round(minDistance)}m away from ${closestBranch}. You must be within ${window.ALLOWED_RADIUS_METERS}m to punch.`, 'error');
            return;
        }

        // 4. 📸 PHOTO CAPTURE
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

        // 5. 💾 SAVE TO FIREBASE
        await addDoc(collection(db, "attendance_logs"), {
            staffName: staffName, branch: closestBranch, type: type, timestamp: serverTimestamp(),
            locationLat: window.currentLat, locationLng: window.currentLng, distanceMeters: Math.round(minDistance),
            photoBase64: photoBase64
        });
        
        Swal.fire('✅ Success', `${type} logged securely at ${closestBranch}!`, 'success');

    } catch(e) { 
        console.error(e); 
        Swal.fire('Error', 'Failed to log time. Check internet connection.', 'error'); 
    } 
    finally { 
        if(btnIn) btnIn.disabled = false; 
        if(btnOut) btnOut.disabled = false; 
    }
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

// ==========================================
// 📥 STAFF INBOX (WITH DETAILED EXTRACTOR)
// ==========================================
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
            let proofHtml = d.proofImageUrl ? `<div style="margin-top: 8px; font-size: 11px;"><a href="${d.proofImageUrl}" target="_blank" style="color:#0ea5e9; text-decoration:none; font-weight:bold;">📸 View Receipt Attached</a></div>` : '';

            // 🔥 THE FIX: EXPLICITLY EXTRACT THE REQUEST DETAILS!
            let detailText = "";
            if (d.type === "Leave") detailText = `📅 ${d.startDate} to ${d.endDate} (${d.leaveType})<br><span style="color:#64748b; font-size:12px;">Reason: ${d.reason}</span>`;
            else if (d.type === "Cash Advance") detailText = `💸 ₱${(parseFloat(d.amount)||0).toFixed(2)}<br><span style="color:#64748b; font-size:12px;">Reason: ${d.reason}</span>`;
            else if (d.type === "Staff Meal") detailText = `🍔 ${d.item} (₱${(parseFloat(d.amount)||0).toFixed(2)})`;
            else if (d.type === "Reason Letter") detailText = `✉️ ${d.explanationCause || 'Letter'}<br><span style="color:#64748b; font-size:12px;">${d.explanationMessage || ''}</span>`;
            else if (d.type === "Waste Report") detailText = `🗑️ Waste Log (₱${(parseFloat(d.totalValueLost)||0).toFixed(2)})<br><span style="color:#64748b; font-size:12px;">${(d.items || []).length} items submitted</span>`;
            else detailText = d.reason || d.item || "";

            html += `
                <div class="req-item-card" style="border-left: 4px solid ${color}; margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <strong style="color:#0f172a; font-size:15px;">${d.type}</strong>
                        <span style="background:${bg}; color:${color}; font-weight:bold; font-size:11px; padding:4px 8px; border-radius:6px; height: fit-content;">${d.status}</span>
                    </div>
                    <div style="font-size:13px; color:#334155; margin-bottom: 10px; font-weight: 500; line-height: 1.4;">
                        ${detailText}
                    </div>
                    <div style="font-size:11px; color:#94a3b8;">📅 Submitted: ${d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Recent'}</div>
                    ${proofHtml}${replyHtml}
                </div>
            `;
            if ((d.status === 'Approved' || d.status === 'Rejected') && !d.staffAcknowledged) updateDoc(doc(db, "staff_requests", d.id), { staffAcknowledged: true });
        });
        listEl.innerHTML = html || '<div style="color:#64748b; font-size:13px; text-align:center;">No requests found.</div>';
    } catch(e) { console.error(e); listEl.innerHTML = 'Error loading inbox.'; }
};

// ==========================================
// 📋 DYNAMIC MULTI-BRANCH SOP ENGINE
// ==========================================
window.currentSopRoles = {};

// Hook into view navigation
const originalSwitchView = window.switchView;
window.switchView = function(viewId, btnElement) {
    if (typeof originalSwitchView === 'function') originalSwitchView(viewId, btnElement);

    if (viewId === 'sop') {
        window.initSopModule();
    }
};

window.initSopModule = async function() {
    let branchSelect = document.getElementById('sopBranchSelect');
    let gpsBadge = document.getElementById('sopGpsBadge');
    let staffName = localStorage.getItem('takodeal_staff_name');

    let targetBranch = window.getClosestBranch() || "Cabantian"; // Initial fallback

    if (gpsBadge) {
        gpsBadge.innerText = "⏳ Syncing with Active Shift...";
        gpsBadge.style.background = "#fffbeb";
        gpsBadge.style.color = "#d97706";
    }

    try {
        // 🔥 SMART CLOUD SYNC: Find out exactly where they timed in!
        if (staffName) {
            // We use the same index-free query we used for the Time Clock so it never crashes!
            const q = query(collection(db, "attendance_logs"), where("staffName", "==", staffName));
            const snap = await getDocs(q);
            
            let userLogs = [];
            snap.forEach(doc => {
                let d = doc.data();
                if (d.timestamp) userLogs.push(d);
            });
            
            // Sort locally (Newest first)
            userLogs.sort((a,b) => b.timestamp.toDate() - a.timestamp.toDate());

            // Check their very last punch
            if (userLogs.length > 0) {
                let lastLog = userLogs[0];
                // If their last action was a TIME IN, lock the SOP to that exact branch!
                if (lastLog.type.includes("TIME IN")) {
                    targetBranch = lastLog.branch || targetBranch;
                }
            }
        }
    } catch(e) {
        console.error("Error fetching shift branch:", e);
    }

    // Apply the branch to the dropdown
    if (branchSelect) {
        branchSelect.value = targetBranch;
    }

    // Update the visual badge so they know it worked
    if (gpsBadge) {
        gpsBadge.innerText = `📍 Synced to Shift Location: ${targetBranch}`;
        gpsBadge.style.background = "#dcfce7";
        gpsBadge.style.color = "#16a34a";
    }

    // Trigger the role loader automatically!
    await window.onSopBranchChange();
};

window.onSopBranchChange = async function() {
    let branch = document.getElementById('sopBranchSelect').value;
    let roleSelect = document.getElementById('sopRoleSelect');
    
    document.getElementById('sopTasksContainer').style.display = 'none';
    document.getElementById('sopEmptyState').style.display = 'block';
    
    if (!branch) return;
    
    roleSelect.innerHTML = '<option value="">⏳ Loading roles...</option>';

    try {
        // Pull exact roles configured in Manager App for this branch
        const docSnap = await getDoc(doc(db, "settings", "sop_" + branch));
        window.currentSopRoles = docSnap.exists() ? (docSnap.data().roles || {}) : {};

        let roleKeys = Object.keys(window.currentSopRoles);
        let html = '<option value="">-- Select Role / Shift --</option>';

        if (roleKeys.length === 0) {
            html = '<option value="">No roles configured for this branch</option>';
        } else {
            roleKeys.forEach(role => {
                html += `<option value="${role}">${role}</option>`;
            });
        }
        roleSelect.innerHTML = html;

    } catch (e) {
        console.error("SOP Fetch Error:", e);
        roleSelect.innerHTML = '<option value="">Error loading tasks</option>';
    }
};

window.renderSopTasks = function() {
    let roleName = document.getElementById('sopRoleSelect').value;
    let branch = document.getElementById('sopBranchSelect').value;
    let container = document.getElementById('sopTasksContainer');
    let emptyState = document.getElementById('sopEmptyState');
    let list = document.getElementById('sopTaskList');

    if (!roleName || !window.currentSopRoles[roleName]) {
        container.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    let tasks = window.currentSopRoles[roleName] || [];
    document.getElementById('sopTitleHeader').innerText = `Tasks for ${roleName}`;
    
    // 🔥 THE MEMORY ENGINE: Check if they started this checklist earlier today!
    let draftKey = `takodeal_sop_draft_${branch}_${roleName}`;
    let savedDraft = [];
    try { savedDraft = JSON.parse(localStorage.getItem(draftKey)) || []; } catch(e){}

    let html = '';
    tasks.forEach((taskText, index) => {
        // Retrieve memory states
        let isChecked = savedDraft[index] ? savedDraft[index].checked : false;
        let savedRemark = savedDraft[index] ? savedDraft[index].remark : "";

        // Notice the new oninput="window.updateSopProgress()" attached to the text box!
        html += `
            <div class="sop-task-item" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; transition: 0.2s;">
                <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                    <input type="checkbox" class="sop-chk" data-index="${index}" onchange="window.updateSopProgress()" ${isChecked ? 'checked' : ''} style="width: 20px; height: 20px; margin-top: 2px; accent-color: #0f766e; cursor: pointer;">
                    <div style="flex: 1;">
                        <span style="font-size: 14px; font-weight: bold; color: #0f172a; line-height: 1.4; display: block;">${taskText}</span>
                        <input type="text" class="sop-remark" placeholder="Optional remark/note if skipped or issue found..." value="${savedRemark}" oninput="window.updateSopProgress()" style="width: 100%; padding: 6px 10px; margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; box-sizing: border-box;">
                    </div>
                </label>
            </div>
        `;
    });

    list.innerHTML = html || '<div style="color:#64748b; font-style:italic;">No tasks defined for this role.</div>';
    emptyState.style.display = 'none';
    container.style.display = 'block';
    
    window.updateSopProgress();
};

window.updateSopProgress = function() {
    let allChecks = document.querySelectorAll('.sop-chk');
    let checkedCount = document.querySelectorAll('.sop-chk:checked').length;
    let total = allChecks.length;

    let badge = document.getElementById('sopProgressBadge');
    if (badge) {
        badge.innerText = `${checkedCount}/${total} Done`;
        if (checkedCount === total && total > 0) {
            badge.style.background = "#dcfce7";
            badge.style.color = "#16a34a";
        } else {
            badge.style.background = "#e0f2fe";
            badge.style.color = "#0284c7";
        }
    }

    // 🔥 THE MEMORY ENGINE: Auto-save the state to LocalStorage every time they type or click!
    let branch = document.getElementById('sopBranchSelect').value;
    let roleName = document.getElementById('sopRoleSelect').value;
    
    if (branch && roleName && total > 0) {
        let draftKey = `takodeal_sop_draft_${branch}_${roleName}`;
        let draftData = [];
        document.querySelectorAll('.sop-task-item').forEach(item => {
            draftData.push({
                checked: item.querySelector('.sop-chk').checked,
                remark: item.querySelector('.sop-remark').value
            });
        });
        localStorage.setItem(draftKey, JSON.stringify(draftData));
    }
};

window.submitSopChecklist = async function() {
    let branch = document.getElementById('sopBranchSelect').value;
    let roleName = document.getElementById('sopRoleSelect').value;
    let staffName = localStorage.getItem('takodeal_staff_name') || 'Staff';

    if (!roleName) return Swal.fire('Required', 'Please select your role first.', 'warning');

    let taskItems = document.querySelectorAll('.sop-task-item');
    if (taskItems.length === 0) return Swal.fire('Empty', 'No tasks to submit.', 'warning');

    let completedTasks = [];
    let doneCount = 0;

    taskItems.forEach(item => {
        let taskText = item.querySelector('span').innerText;
        let isChecked = item.querySelector('.sop-chk').checked;
        let remark = item.querySelector('.sop-remark').value.trim();

        if (isChecked) doneCount++;

        completedTasks.push({
            task: taskText,
            status: isChecked ? 'done' : 'skipped',
            remark: remark
        });
    });

    let scorePercentage = Math.round((doneCount / taskItems.length) * 100);

    let btn = document.getElementById('btnSubmitSop');
    btn.innerText = "⏳ Submitting to HQ..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "sop_logs"), {
            branch: branch,
            staffName: staffName,
            roleName: roleName,
            scorePercentage: scorePercentage,
            tasks: completedTasks,
            timestamp: serverTimestamp()
        });

        // 🔥 THE MEMORY ENGINE: Wipe the memory clean only AFTER successful submission!
        localStorage.removeItem(`takodeal_sop_draft_${branch}_${roleName}`);

        Swal.fire({
            title: '✅ SOP Submitted!',
            text: `Compliance Score: ${scorePercentage}%. Your report has been logged to HQ.`,
            icon: 'success',
            confirmButtonColor: '#0f766e',
            customClass: { popup: 'rounded-2xl' }
        });

        // Reset check selections visually
        document.querySelectorAll('.sop-chk').forEach(c => c.checked = false);
        document.querySelectorAll('.sop-remark').forEach(r => r.value = '');
        window.updateSopProgress();

    } catch (e) {
        console.error("SOP Submit Error:", e);
        Swal.fire('Error', 'Failed to submit checklist. Check connection.', 'error');
    } finally {
        btn.innerText = "🚀 Submit Completed Checklist"; btn.disabled = false;
    }
};

// ==========================================
// 💸 PAYSLIP VAULT & LIVE ESTIMATOR ENGINE
// ==========================================
window.switchPayslipTab = function(tabName) {
    let liveBtn = document.getElementById('btnTabLivePay');
    let pastBtn = document.getElementById('btnTabPastPay');
    
    if (tabName === 'Live') {
        liveBtn.style.background = '#0f766e'; liveBtn.style.color = 'white'; liveBtn.style.border = 'none';
        pastBtn.style.background = 'transparent'; pastBtn.style.color = '#64748b'; pastBtn.style.border = 'none';
        document.getElementById('payslipLiveSection').style.display = 'block';
        document.getElementById('payslipPastSection').style.display = 'none';
    } else {
        pastBtn.style.background = '#0f172a'; pastBtn.style.color = 'white'; pastBtn.style.border = 'none';
        liveBtn.style.background = 'transparent'; liveBtn.style.color = '#64748b'; liveBtn.style.border = 'none';
        document.getElementById('payslipLiveSection').style.display = 'none';
        document.getElementById('payslipPastSection').style.display = 'block';
    }
};

window.loadPayslipVault = async function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffName || !staffId) return;

    // 1. Calculate Current Cutoff Dates
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    let startDateStr, endDateStr;

    if (today.getDate() <= 15) {
        startDateStr = `${yyyy}-${mm}-01`;
        endDateStr = `${yyyy}-${mm}-15`;
    } else {
        startDateStr = `${yyyy}-${mm}-16`;
        let lastDay = new Date(yyyy, today.getMonth() + 1, 0).getDate();
        endDateStr = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
    }

    document.getElementById('liveCutoffDates').innerText = `Cutoff Period: ${startDateStr} to ${endDateStr}`;
    let startTimestamp = new Date(startDateStr + 'T00:00:00');
    let endTimestamp = new Date(endDateStr + 'T23:59:59');

    try {
        // --- FETCH LIVE ESTIMATE DATA ---
        const staffRef = await getDoc(doc(db, "cashiers", staffId));
        let dailyRate = staffRef.exists() ? (parseFloat(staffRef.data().hourlyRate) || 0) : 0;
        let ratePerHour = dailyRate / 8;

        const attQ = query(collection(db, "attendance_logs"), where("staffName", "==", staffName), where("timestamp", ">=", startTimestamp), where("timestamp", "<=", endTimestamp));
        const attSnap = await getDocs(attQ);

        // 🔥 THE FIX: Fetch Manual Overtime & Bonuses!
        const bonusQ = query(collection(db, "staff_bonuses"), where("staffName", "==", staffName), where("dateAdded", ">=", startTimestamp), where("dateAdded", "<=", endTimestamp));
        const bonusSnap = await getDocs(bonusQ);
        let totalBonuses = 0;
        bonusSnap.forEach(b => { totalBonuses += (parseFloat(b.data().amount) || 0); });

        let totalHours = 0;
        let totalLatePenalty = 0;
        let activeShifts = {};
        let shiftPairs = [];
        let tempIn = null;
        let sortedAttLogs = [];
        
        attSnap.forEach(docSnap => {
            let log = docSnap.data();
            let penalty = parseFloat(log.penaltyAmount) || 0;
            totalLatePenalty += penalty;
            
            sortedAttLogs.push(log);

            if (log.type === "TIME IN") {
                tempIn = log.timestamp.toDate();
                activeShifts[staffName] = log.timestamp.toDate();
            } else if (log.type.includes("TIME OUT") && activeShifts[staffName]) {
                let timeIn = activeShifts[staffName];
                let timeOut = log.timestamp.toDate();
                let hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                if (hoursWorked <= 18) totalHours += hoursWorked; 
                
                shiftPairs.push({ in: timeIn, out: timeOut, hrs: hoursWorked, penalty: log.penaltyApplied });
                tempIn = null;
                delete activeShifts[staffName];
            }
        });

        if (tempIn) {
            shiftPairs.push({ in: tempIn, out: "Active Shift", hrs: 0, penalty: false, isActive: true });
        }

        let estGross = totalHours * ratePerHour;

        const dedQ = query(collection(db, "staff_deductions"), where("staffName", "==", staffName), where("status", "==", "Unpaid"));
        const dedSnap = await getDocs(dedQ);
        let unpaidVales = 0;
        let activeDeductions = [];
        
        dedSnap.forEach(d => {
            let val = parseFloat(d.data().amount) || 0;
            unpaidVales += val;
            activeDeductions.push(d.data());
        });

        // 🔥 THE FIX: Add Overtime to the Net Pay Math!
        let estNet = (estGross + totalBonuses) - totalLatePenalty - unpaidVales;

        document.getElementById('liveEstGross').innerText = '₱' + estGross.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstLates').innerText = '-₱' + totalLatePenalty.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstVales').innerText = '-₱' + unpaidVales.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstNetPay').innerText = '₱' + Math.max(0, estNet).toLocaleString(undefined, {minimumFractionDigits: 2});

        // 🔥 THE FIX: Inject the Overtime row dynamically into the UI!
        let grossRow = document.getElementById('liveEstGross').parentElement;
        if (!document.getElementById('liveEstOTRow')) {
            grossRow.insertAdjacentHTML('afterend', `
                <div id="liveEstOTRow" style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px;">
                    <span style="color: #64748b; font-weight: bold;">Overtime / Bonuses:</span>
                    <strong id="liveEstOT" style="color: #0ea5e9;">+₱0.00</strong>
                </div>
            `);
        }
        document.getElementById('liveEstOT').innerText = '+₱' + totalBonuses.toLocaleString(undefined, {minimumFractionDigits: 2});

        // --- DETAILED ATTENDANCE & DEDUCTIONS TABLES ---
        let logsContainer = document.getElementById('liveCutoffDetailedLogs');
        if (!logsContainer) {
            let liveSection = document.getElementById('payslipLiveSection');
            logsContainer = document.createElement('div');
            logsContainer.id = 'liveCutoffDetailedLogs';
            liveSection.appendChild(logsContainer);
        }

        let detailsHtml = `
            <div style="margin-top: 20px; background: white; border-radius: 12px; border: 1px solid #cbd5e1; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <h3 style="margin-top: 0; color: #334155; font-size: 14px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">⏱️ Attendance Logs (This Cutoff)</h3>
                <div style="max-height: 250px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
                        <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 5;">
                            <tr><th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Date</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">In</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Out</th><th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Hrs</th></tr>
                        </thead>
                        <tbody>
        `;

        if (shiftPairs.length > 0) {
            shiftPairs.reverse().forEach(p => {
                let dateStr = p.in.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
                let inStr = p.in.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
                let outStr = p.isActive ? '<span style="color:#0ea5e9; font-style:italic;">Active Shift</span>' : p.out.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'});
                let hrStr = p.isActive ? '<span style="color:#94a3b8;">--</span>' : `${p.hrs.toFixed(2)}h`;
                let pAlert = p.penalty ? `<br><span style="color:#ef4444; font-size:9px; font-weight:bold;">PENALTY</span>` : '';
                
                detailsHtml += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 8px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 10px 8px; color: #16a34a; font-weight: bold;">${inStr}</td>
                    <td style="padding: 10px 8px; color: #dc2626; font-weight: bold;">${outStr}${pAlert}</td>
                    <td style="padding: 10px 8px; font-weight: bold; color: #334155;">${hrStr}</td>
                </tr>`;
            });
        } else {
            detailsHtml += `<tr><td colspan="4" style="padding: 15px; text-align: center; color: #94a3b8;">No valid Time In/Out pairs found.</td></tr>`;
        }
        detailsHtml += `</tbody></table></div></div>`;

        detailsHtml += `
            <div style="margin-top: 15px; background: white; border-radius: 12px; border: 1px solid #fca5a5; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <h3 style="margin-top: 0; color: #b91c1c; font-size: 14px; border-bottom: 2px solid #fecaca; padding-bottom: 8px;">💸 Active Unpaid Deductions</h3>
                <div style="max-height: 150px; overflow-y: auto;">
        `;

        if (activeDeductions.length > 0) {
            activeDeductions.forEach(d => {
                let dDate = d.dateAdded || d.timestamp;
                let dateStr = dDate ? dDate.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) : '';
                detailsHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 8px 0; border-bottom: 1px dashed #e2e8f0;">
                        <div>
                            <strong style="color: #334155;">${d.type}</strong><br>
                            <span style="font-size: 11px; color: #64748b;">${dateStr} - ${d.remarks || d.item || 'Pending'}</span>
                        </div>
                        <strong style="color: #dc2626;">-₱${parseFloat(d.amount).toFixed(2)}</strong>
                    </div>
                `;
            });
        } else {
            detailsHtml += `<div style="padding: 15px; text-align: center; color: #94a3b8; font-size: 12px;">No active deductions. You're clear! 🎉</div>`;
        }
        detailsHtml += `</div></div>`;

        logsContainer.innerHTML = detailsHtml;

        // --- FETCH PAST PAYSLIPS VAULT ---
        const prQ = query(collection(db, "payroll_records"), where("staffName", "==", staffName), orderBy("processedAt", "desc"));
        const prSnap = await getDocs(prQ);

        let historyHtml = '';
        prSnap.forEach(docSnap => {
            let d = docSnap.data();
            let pd = d.frozenData || {};
            
            // 🔥 Inject the exact date the Manager approved the payroll into the data package!
            pd.processedAt = d.processedAt; 
            
            let dateStr = d.processedAt ? d.processedAt.toDate().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'Recently';
            let safeData = encodeURIComponent(JSON.stringify(pd));

            historyHtml += `
                <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0 0 5px 0; color: #0f172a; font-size: 15px;">Cutoff: ${d.startDate || '?'} to ${d.endDate || '?'}</h3>
                        <div style="font-size: 12px; color: #64748b;">Disbursed: ${dateStr}</div>
                        <div style="font-size: 16px; font-weight: 900; color: #16a34a; margin-top: 5px;">Net: ₱${(d.finalNetPay || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                    </div>
                    <div>
                        <button onclick="window.viewPastPayslip('${safeData}')" style="background: #f0f9ff; color: #0284c7; border: 1px solid #bae6fd; padding: 10px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: 0.2s;">🔍 View Record</button>
                    </div>
                </div>
            `;
        });

        document.getElementById('payslipHistoryList').innerHTML = historyHtml || '<div style="text-align:center; padding: 40px; color: #94a3b8;">No past payslips found.</div>';

    } catch (e) {
        console.error("Payslip Fetch Error:", e);
        document.getElementById('liveCutoffDates').innerText = "Error loading data.";
        document.getElementById('payslipHistoryList').innerHTML = '<div style="text-align:center; padding: 40px; color: #ef4444;">Error connecting to HQ database.</div>';
    }
};

// ==========================================
// 🧾 THE UPGRADED PAYSLIP UI ENGINE
// ==========================================
window.viewPastPayslip = function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    // Safely extract the date it was disbursed
    let disbursedDateStr = 'Pending';
    if (d.processedAt) {
        let pDate = d.processedAt.seconds ? new Date(d.processedAt.seconds * 1000) : new Date(d.processedAt);
        disbursedDateStr = pDate.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } else {
        disbursedDateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    // Use the actual data from the frozen snapshot (Manager App format)
    let basicPay = parseFloat(d.basicPay || 0).toFixed(2);
    let otPay = parseFloat(d.nightBonus || d.overtime || 0).toFixed(2);
    let straightPay = parseFloat(d.straightBonus || 0).toFixed(2);
    let holPay = parseFloat(d.holidayPayTotal || d.holiday || 0).toFixed(2);
    let grossIncome = (parseFloat(basicPay) + parseFloat(otPay) + parseFloat(straightPay) + parseFloat(holPay)).toFixed(2);

    let lateDeduct = parseFloat(d.lateDeduction || 0).toFixed(2);
    let sss = parseFloat(d.sss || 0).toFixed(2);
    let phil = parseFloat(d.philhealth || 0).toFixed(2);
    let pagibig = parseFloat(d.pagibig || 0).toFixed(2);
    let vale = parseFloat(d.advances || 0).toFixed(2);
    let loans = parseFloat(d.loans || 0).toFixed(2);
    let meals = parseFloat(d.meals || 0).toFixed(2);
    let customDeducts = parseFloat(d.customDeductionsTotal || 0).toFixed(2);
    
    // Calculate total deductions properly
    let totalDeduct = (parseFloat(lateDeduct) + parseFloat(sss) + parseFloat(phil) + parseFloat(pagibig) + parseFloat(vale) + parseFloat(loans) + parseFloat(meals) + parseFloat(customDeducts)).toFixed(2);
    
    // Ensure Net Pay is accurate
    let netPay = parseFloat(d.finalNetPay || (grossIncome - totalDeduct)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    let html = `
        <div style="background: white; padding: 20px; border: 2px solid #0f172a; border-radius: 8px; font-family: 'Arial', sans-serif; color: #000; text-align: left; max-width: 100%; box-sizing: border-box;">
            
            <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 15px;">
                <h2 style="margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 2px;">TAKODEÁL</h2>
                <div style="font-size: 14px; color: #333;">Official Payslip</div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 13px; margin-bottom: 20px;">
                <div>
                    <div style="margin-bottom: 4px;"><strong>Employee:</strong> <span style="border-bottom: 1px solid #000; padding-bottom: 2px;">${d.name || d.staffName}</span></div>
                    <div style="margin-bottom: 4px;"><strong>Department:</strong> <span style="border-bottom: 1px solid #000; padding-bottom: 2px;">${d.branch || 'N/A'}</span></div>
                </div>
                <div>
                    <div style="margin-bottom: 4px;"><strong>Cutoff:</strong> <span style="border-bottom: 1px solid #000; padding-bottom: 2px;">${d.start || d.startDate} to ${d.end || d.endDate}</span></div>
                    <div style="margin-bottom: 4px;"><strong>Disbursed:</strong> <span style="border-bottom: 1px solid #000; padding-bottom: 2px;">${disbursedDateStr}</span></div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; border: 2px solid #000; font-size: 12px; margin-bottom: 20px;">
                <!-- INCOME COLUMN -->
                <div style="border-right: 2px solid #000;">
                    <div style="background: #e2e8f0; padding: 8px; font-weight: bold; border-bottom: 2px solid #000; text-align: center; font-size: 13px;">INCOME</div>
                    <div style="padding: 10px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Basic Pay (${d.shiftsWorked || 0} shifts)</span> <strong>${basicPay}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Overtime / Night Diff</span> <strong>${otPay}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Straight Duty Bonus</span> <strong>${straightPay}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Holiday Pay</span> <strong>${holPay}</strong></div>
                    </div>
                    <div style="border-top: 2px solid #000; padding: 10px; display: flex; justify-content: space-between; font-weight: 900; font-size: 13px;">
                        <span>GROSS INCOME</span> <span>${grossIncome}</span>
                    </div>
                </div>

                <!-- DEDUCTIONS COLUMN -->
                <div>
                    <div style="background: #e2e8f0; padding: 8px; font-weight: bold; border-bottom: 2px solid #000; text-align: center; font-size: 13px;">DEDUCTIONS</div>
                    <div style="padding: 10px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Late/Undertime</span> <strong>${lateDeduct}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>SSS / Phil / Pag-IBIG</span> <strong>${(parseFloat(sss)+parseFloat(phil)+parseFloat(pagibig)).toFixed(2)}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Cash Advance (Vale)</span> <strong>${vale}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Company Loans</span> <strong>${loans}</strong></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span>Foods / Custom</span> <strong>${(parseFloat(meals) + parseFloat(customDeducts)).toFixed(2)}</strong></div>
                    </div>
                    <div style="border-top: 2px solid #000; padding: 10px; display: flex; justify-content: space-between; font-weight: 900; font-size: 13px;">
                        <span>TOTAL DEDUCT</span> <span>${totalDeduct}</span>
                    </div>
                </div>
            </div>

            <div style="display: flex; align-items: stretch; margin-top: 10px; border: 2px solid #000;">
                <div style="background: #e2e8f0; padding: 15px 20px; font-weight: 900; font-size: 18px; border-right: 2px solid #000; display: flex; align-items: center;">NET PAY</div>
                <div style="flex: 1; padding: 15px 20px; font-weight: 900; font-size: 26px; text-align: center; color: #16a34a;">₱${netPay}</div>
            </div>
            
            <div style="text-align: center; margin-top: 15px; font-size: 10px; color: #64748b; font-style: italic;">
                System Generated Digital Payslip • Takodeal POS
            </div>
        </div>
    `;

    Swal.fire({
        html: html,
        width: '600px',
        showConfirmButton: true,
        confirmButtonText: 'Close',
        confirmButtonColor: '#0f172a',
        customClass: { popup: 'rounded-2xl shadow-2xl p-0' }
    });
};
