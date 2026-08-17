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
// 🔥 THE FIREBASE BRIDGE FIX 🔥
window.query = query;
window.where = where;
window.collection = collection;
window.getDocs = getDocs;
window.getDoc = getDoc;
window.addDoc = addDoc;
window.updateDoc = updateDoc;
window.deleteDoc = deleteDoc;
window.doc = doc;
window.setDoc = setDoc;
window.serverTimestamp = serverTimestamp;
window.orderBy = orderBy;

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
    if(btn) { btn.innerText = "⏳ Registering..."; btn.disabled = true; }

    let targetBranch = selectedBranch;
    if (selectedBranch === 'Auto') {
        targetBranch = window.getClosestBranch() || "Main Office";
    }

    try {
        let deviceId = localStorage.getItem('takodeal_device_id');
        if (!deviceId) {
            deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();
            localStorage.setItem('takodeal_device_id', deviceId);
        }

        await setDoc(doc(db, "pos_devices", deviceId), {
            deviceId: deviceId,
            deviceName: name + " (Staff)",
            branch: targetBranch,
            status: "Pending", // Prevent "Blocked" from triggering aggressive manager alerts
            registeredAt: serverTimestamp(),
            lastActive: serverTimestamp()
        });

        window.listenToDeviceStatus(deviceId);

    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to connect to HQ.', 'error');
        if(btn) { btn.innerText = "Request Access"; btn.disabled = false; }
    }
};

window.listenToDeviceStatus = function(deviceId) {
    let regCard = document.getElementById('registerCard');
    let penCard = document.getElementById('pendingCard');
    let authOverlay = document.getElementById('deviceAuthOverlay');
    
    if(authOverlay) authOverlay.style.display = 'flex';
    if(regCard) regCard.style.display = 'none';
    if(penCard) penCard.style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'none';

    onSnapshot(doc(db, "pos_devices", deviceId), (docSnap) => {
        let blockScreen = document.getElementById('deviceBlockedOverlay');

        if (docSnap.exists()) {
            let status = docSnap.data().status;
            
            // 🔥 THE BUG FIX: The Manager app uses "Approved" but the Staff App expected "Active"!
            // Now it accepts both!
            if (status === 'Active' || status === 'Approved') {
                if(authOverlay) authOverlay.style.display = 'none';
                if(blockScreen) blockScreen.style.display = 'none';
                window.checkNormalLogin();
                window.listenToIncomingSwaps();
            } else {
                if(authOverlay) authOverlay.style.display = 'none';
                
                if (!blockScreen) {
                    blockScreen = document.createElement('div');
                    blockScreen.id = 'deviceBlockedOverlay';
                    blockScreen.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px; backdrop-filter: blur(4px);";
                    blockScreen.innerHTML = `
                        <div style="background: white; padding: 30px; border-radius: 16px; max-width: 400px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                            <h2 style="color: #dc2626; margin-top: 0; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                <span style="font-size: 24px;">🚫</span> Access Blocked
                            </h2>
                            <p style="color: #475569; font-size: 14px; margin-bottom: 20px; line-height: 1.5;">This device is locked. Please ask HQ to click <b>Approve</b> in the Fleet Management Dashboard to grant access.</p>
                            <div style="font-size: 45px; margin-bottom: 20px;">🔒</div>
                            <div style="font-size: 11px; color: #94a3b8; font-weight: bold; background: #f1f5f9; padding: 8px; border-radius: 6px; border: 1px dashed #cbd5e1;">Device ID: ${deviceId}</div>
                        </div>
                    `;
                    document.body.appendChild(blockScreen);
                }
                blockScreen.style.display = 'flex';
            }
        } else {
            // 🔥 THE LOOP KILLER: If deleted by Manager, wipe local memory so it stops spamming HQ!
            localStorage.removeItem('takodeal_device_id');
            if(blockScreen) blockScreen.style.display = 'none';
            if(authOverlay) authOverlay.style.display = 'flex';
            if(regCard) regCard.style.display = 'block';
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
    // 🔥 SECURITY UPGRADE: Wipe memory on refresh so they MUST enter PIN every time!
    localStorage.removeItem('takodeal_staff_name');
    localStorage.removeItem('takodeal_staff_id');
    localStorage.removeItem('takodeal_staff_pic');
    
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
    
    // Clear the PIN box just in case
    let pinBox = document.getElementById('loginPin');
    if (pinBox) pinBox.value = '';
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
            // Re-establish session memory
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
            window.checkContractLifecycle(docId);
            window.listenToIncomingSwaps(); // 🔥 Ensures the Shift Swapping listener starts!
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
        const docSnap = await getDoc(doc(db, "cashiers", staffId));
        
        if (docSnap.exists()) {
            let d = docSnap.data();
            document.getElementById('profFullName').value = d.cashierName || '';
            document.getElementById('profNickname').value = d.scheduleNickname || '';
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

            // Show uploaded ID links if they exist!
            const setupIdLink = (linkId, url) => {
                let el = document.getElementById(linkId);
                if (el && url) { el.href = url; el.style.display = 'inline-block'; }
            };
            setupIdLink('linkSss', d.sssIdUrl);
            setupIdLink('linkPhilhealth', d.philhealthIdUrl);
            setupIdLink('linkPagibig', d.pagibigIdUrl);
            
            document.getElementById('viewSssDed').innerText = '₱' + (parseFloat(d.sssDeduction) || 0).toFixed(2);
            document.getElementById('viewPhDed').innerText = '₱' + (parseFloat(d.philhealthDeduction) || 0).toFixed(2);
            document.getElementById('viewPagibigDed').innerText = '₱' + (parseFloat(d.pagibigDeduction) || 0).toFixed(2);
            
            let customDedText = "None";
            if (d.customDeductions && d.customDeductions.length > 0) {
                customDedText = d.customDeductions.map(c => `${c.name}: ₱${parseFloat(c.amount).toFixed(2)}`).join('<br>');
            }
            document.getElementById('viewCustomDed').innerHTML = customDedText;
            // 🔥 LOAD PROMOTION HISTORY
            let historyHtml = "";
            if (d.roleHistory && d.roleHistory.length > 0) {
                historyHtml = `<ul style="margin: 0; padding-left: 20px; line-height: 1.6;">`;
                d.roleHistory.forEach(h => {
                    historyHtml += `<li>Promoted to <b>${h.role}</b> <br><span style="color: #94a3b8; font-size: 11px;">(Effective: ${h.date})</span></li>`;
                });
                historyHtml += `</ul>`;
            } else {
                historyHtml = `<span>Current Role: <b>${d.role || 'Crew'}</b></span>`;
            }
            let elRoleHist = document.getElementById('profRoleHistory');
            if(elRoleHist) elRoleHist.innerHTML = historyHtml;

            // 🔥 LOAD SIGNED CONTRACTS VAULT
            let contractsHtml = "";
            if (d.signedContracts && Object.keys(d.signedContracts).length > 0) {
                let safeData = encodeURIComponent(JSON.stringify(d));
                if (d.signedContracts.initial) {
                    contractsHtml += `<button type="button" onclick="window.reprintContract('Initial', '${safeData}', '${d.signedContracts.initial}')" style="background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; padding:12px; border-radius:6px; cursor:pointer; font-weight:bold; text-align: left; display: flex; justify-content: space-between; align-items: center;"><span>📄 Initial Employment Contract</span> <span style="color: #16a34a; font-size: 11px;">Signed: ${d.signedContracts.initial}</span></button>`;
                }
                if (d.signedContracts.extension) {
                    contractsHtml += `<button type="button" onclick="window.reprintContract('Extension', '${safeData}', '${d.signedContracts.extension}')" style="background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; padding:12px; border-radius:6px; cursor:pointer; font-weight:bold; text-align: left; display: flex; justify-content: space-between; align-items: center;"><span>📄 6-Month Extension</span> <span style="color: #16a34a; font-size: 11px;">Signed: ${d.signedContracts.extension}</span></button>`;
                }
                if (d.signedContracts.regularization) {
                    contractsHtml += `<button type="button" onclick="window.reprintContract('Regularization', '${safeData}', '${d.signedContracts.regularization}')" style="background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; padding:12px; border-radius:6px; cursor:pointer; font-weight:bold; text-align: left; display: flex; justify-content: space-between; align-items: center;"><span>🌟 Regularization Contract</span> <span style="color: #16a34a; font-size: 11px;">Signed: ${d.signedContracts.regularization}</span></button>`;
                }
            } else {
                contractsHtml = `<span style="color: #94a3b8; font-size: 13px;"><i>No signed contracts on file yet.</i></span>`;
            }
            let elContracts = document.getElementById('profContracts');
            if(elContracts) elContracts.innerHTML = contractsHtml;
        }
    } catch(e) { console.error("Error fetching profile data:", e); }

    document.getElementById('profileModal').style.display = 'flex';
};

window.saveProfileData = async function() {
    let staffId = localStorage.getItem('takodeal_staff_id');
    let btn = document.getElementById('btnSaveProfileData');
    
    // Grab the values from the boxes first
    let sssVal = document.getElementById('profSss').value.trim();
    let philVal = document.getElementById('profPhilhealth').value.trim();
    let pagVal = document.getElementById('profPagibig').value.trim();
    let gotymeNameVal = document.getElementById('profGotymeName').value.trim();
    let gotymeNumVal = document.getElementById('profGotymeNum').value.trim();
    let emergNumVal = document.getElementById('profEmergNum').value.trim();

    let payload = {
        cashierName: document.getElementById('profFullName').value.trim(),
        scheduleNickname: document.getElementById('profNickname').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        address: document.getElementById('profAddress').value.trim(),
        emergencyName: document.getElementById('profEmergName').value.trim(),
        
        // 🚨 EMERGENCY NUMBER Y-SPLITTER (Covers all possible Manager App names)
        emergencyNumber: emergNumVal,
        emergencyPhone: emergNumVal,
        emergencyContact: emergNumVal,
        emergencyContactNumber: emergNumVal,
        emergNum: emergNumVal,
        
        email: document.getElementById('profEmail').value.trim(),
        gcashName: document.getElementById('profGcashName').value.trim(),
        gcashNumber: document.getElementById('profGcashNum').value.trim(),
        
        // 💳 GOTYME Y-SPLITTER (Covers all case-sensitive variations)
        gotymeName: gotymeNameVal,
        gotyme: gotymeNameVal,
        goTymeName: gotymeNameVal,
        
        gotymeNumber: gotymeNumVal,
        gotymeNum: gotymeNumVal,
        gotymeAcc: gotymeNumVal,
        gotymeAccount: gotymeNumVal,
        goTymeNumber: gotymeNumVal,
        goTymeAccount: gotymeNumVal,
        gotymeAccountNumber: gotymeNumVal,
        
        sss: sssVal,
        sssNumber: sssVal,
        
        philhealth: philVal,
        philhealthNumber: philVal,
        
        pagibig: pagVal,
        pagibigNumber: pagVal
    };

    let newPin = document.getElementById('profPin').value.trim();
    if (newPin) payload.pin = newPin;

    if (!payload.cashierName) return Swal.fire('Required', 'Full Name cannot be empty.', 'warning');

    btn.innerText = "⏳ Saving Secure Files..."; btn.disabled = true;

    try {
        // 🔥 ID UPLOADER ENGINE
        const uploadGovID = async (inputId, folderPath) => {
            let fileEl = document.getElementById(inputId);
            if (fileEl && fileEl.files.length > 0) {
                let file = fileEl.files[0];
                const fileExt = file.name.split('.').pop();
                const fileName = `${folderPath}/${staffId}_${Date.now()}.${fileExt}`;
                const storageRef = ref(window.storage || getStorage(db.app), fileName);
                const snapshot = await uploadBytes(storageRef, file);
                return await getDownloadURL(snapshot.ref);
            }
            return null;
        };

        let sssUrl = await uploadGovID('imgSss', 'government_ids/sss');
        if (sssUrl) payload.sssIdUrl = sssUrl;

        let philUrl = await uploadGovID('imgPhilhealth', 'government_ids/philhealth');
        if (philUrl) payload.philhealthIdUrl = philUrl;

        let pagUrl = await uploadGovID('imgPagibig', 'government_ids/pagibig');
        if (pagUrl) payload.pagibigIdUrl = pagUrl;

        await updateDoc(doc(db, "cashiers", staffId), payload);
        localStorage.setItem('takodeal_staff_name', payload.cashierName);
        document.getElementById('loggedInName').innerText = payload.cashierName;

        let successMsg = newPin ? 'Your profile, files, and PIN have been saved.' : 'Your HR profile and IDs have securely synced to HQ.';
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

// 🔥 THE DOLE CONTRACT LIFECYCLE & RENEWAL ENGINE
window.checkContractLifecycle = async function(staffId) {
    try {
        const docSnap = await getDoc(doc(db, "cashiers", staffId));
        if (!docSnap.exists()) return;
        let d = docSnap.data();

        if (!d.dateHired) return; 

        if (d.pin && String(d.pin).toUpperCase() === 'REVOKED') return;
        if (d.status === 'Resigned' || d.contractStatus === 'Resigned') return;
        
        if (d.role && (d.role.toLowerCase().includes('owner') || d.role.toLowerCase().includes('manager'))) return;

        // 🔥 1. INTERCEPT NEW HIRES
        if (d.contractStatus === 'Pending Initial Contract') {
            window.showInitialContract(staffId, d);
            return;
        }

        if (d.contractStatus === 'Regular' || d.contractStatus === 'Extended' || d.contractStatus === 'Active') return;

        // 🔥 2. INTERCEPT REGULARIZATION OFFERS
        if (d.contractStatus === 'Pending Regularization') {
            window.showRegularizationContract(staffId, d);
            return;
        }

        // 🔥 3. INTERCEPT 6-MONTH EXTENSION OFFERS
        if (d.contractStatus === 'Pending Renewal') {
            window.showRenewalContract(staffId, d);
            return;
        }

        let hiredDate = new Date(d.dateHired);
        let contractEnd = new Date(hiredDate);
        contractEnd.setMonth(contractEnd.getMonth() + 6);

        let today = new Date();
        let daysLeft = Math.ceil((contractEnd - today) / (1000 * 60 * 60 * 24));

        if (daysLeft <= 0) {
            window.coePendingData = d; 
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('appContainer').style.display = 'none';
            
            let overlay = document.getElementById('coeFarewellOverlay');
            overlay.style.display = 'flex';
            
            let msgEl = overlay.querySelector('p');
            if (msgEl) {
                msgEl.innerHTML = `Your probationary contract period with <b>TAKODEÁL</b> has officially concluded.<br><br><span style="color: #c2410c; font-weight: bold;">Please wait for Management to issue your Regularization, a Contract Extension, or your final Clearance.</span>`;
            }

            document.getElementById('coeStaffName').innerText = d.cashierName;
            document.getElementById('coeDateHired').innerText = hiredDate.toLocaleDateString();
            document.getElementById('coeDateEnded').innerText = today.toLocaleDateString();
        } else if (daysLeft <= 30) {
            let lastWarn = localStorage.getItem('takodeal_last_contract_warn');
            let todayStr = today.toDateString();
            
            if (lastWarn !== todayStr) {
                Swal.fire({
                    title: '⏳ Contract Expiring Soon',
                    text: `You have ${daysLeft} days remaining on your 6-month probationary contract. Please coordinate with Management.`,
                    icon: 'warning', toast: true, position: 'top', timer: 8000, showConfirmButton: false
                });
                localStorage.setItem('takodeal_last_contract_warn', todayStr);
            }
        }
    } catch (e) {
        console.error("Contract Engine Error:", e);
    }
};

// 📄 1. INITIAL EMPLOYMENT CONTRACT UI
window.showInitialContract = function(staffId, data) {
    let dateToday = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    let dateHired = data.dateHired ? new Date(data.dateHired).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : dateToday;
    let dailySalary = parseFloat(data.hourlyRate || 0).toFixed(2);
    
    let branchAddress = "Davao City, Philippines";
    if (data.branch === 'Cabantian') branchAddress = "Blk 14, Lot 6, Deca Homes Subdivision, Barangay Cabantian, Davao City";
    if (data.branch === 'Citygate') branchAddress = "Citygate, Buhangin, Davao City";
    if (data.branch === 'Maa') branchAddress = "Maa, Davao City";

    let contractHtml = `
        <h2 style="text-align: center; color: #0f766e; text-transform: uppercase; margin-bottom: 20px;">Employment Contract</h2>
        <p>This Employment Contract ("Agreement") is made and entered into by and between:</p>
        <p><b>TAKODEAL TAKOYAKI FOODCART</b>, a duly registered business engaged in food operations, with principal place of business located at ${branchAddress}, herein referred to as the "Employer";</p>
        <p>-and-</p>
        <p><b>${data.cashierName.toUpperCase()}</b>, of legal age, residing at ${data.address || 'Davao City, Philippines'}, herein referred to as the "Employee".</p>
        
        <h4 style="color: #0f172a;">1. POSITION AND COMMENCEMENT</h4>
        <p>The Employer hereby employs the Employee as a <b>${data.role}</b>. Employment shall commence on <b>${dateHired}</b> and shall be valid for a period of six (6) months.</p>

        <h4 style="color: #0f172a;">2. WORK SCHEDULE AND COMPENSATION</h4>
        <p>The Employee shall receive a daily basic salary of <b>₱${(dailySalary * 8).toFixed(2)}</b>. The Employee is entitled to one (1) day off per week. Working hours shall be determined by the Employer.</p>

        <h4 style="color: #0f172a;">3. ATTENDANCE, ABSENCES AND TARDINESS POLICY</h4>
        <p><b>Absences:</b> Failure to notify management before the start of the scheduled shift shall be considered an unexcused absence.<br>
        <b>Tardiness:</b> Repeated tardiness shall be subject to disciplinary action. Management reserves the right to deduct corresponding time or wages for late arrivals.<br>
        <b>Sanctions for Violations:</b> 1st Offense (Verbal Warning) • 2nd Offense (Written Warning) • 3rd Offense (1-Day Suspension) • 4th Offense (3-Day Suspension) • 5th Offense (7-Day Suspension) • 6th Offense (14-Day Suspension) • 7th Offense (Termination / Dismissal).</p>

        <h4 style="color: #0f172a;">4. CONFIDENTIALITY AGREEMENT</h4>
        <p>The Employee agrees to keep all proprietary information strictly confidential. Disclosure to outside parties shall incur a <b>One Million Pesos (₱1,000,000.00)</b> penalty.</p>

        <h4 style="color: #0f172a;">5. HEALTH DECLARATION</h4>
        <p>The Employee affirms they are physically fit for a food-handling environment. The Employer is not responsible for medical expenses related to concealed critical illnesses.</p>

        <h4 style="color: #0f172a;">6. NOTICE OF RESIGNATION</h4>
        <p>The Employee agrees to render a 30-day notice prior to voluntarily resigning to avoid financial damages equivalent to the cost incurred due to the unserved notice period.</p>

        <h4 style="color: #0f172a;">7. COMPANY UNIFORM AND PROPERTY</h4>
        <p>Items provided on a borrowed basis must be cared for and returned upon resignation to avoid payroll deductions.</p>

        ${window.getSignaturePadHTML(staffId, 'Initial')}
    `;
    window.renderContractOverlay(contractHtml, data);
};

// 📄 2. REGULARIZATION CONTRACT UI (Replaces the old Extension UI)
window.showRenewalContract = window.showRegularizationContract = function(staffId, data) {
    let dateToday = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    let dailySalary = parseFloat(data.hourlyRate || 0).toFixed(2);

    let contractHtml = `
        <h2 style="text-align: center; color: #10b981; text-transform: uppercase; margin-bottom: 20px;">Regularization of Employment Agreement</h2>
        <p>This Regularization Agreement is executed on <b>${dateToday}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${data.cashierName.toUpperCase()}</b> ("Employee").</p>
        <h4 style="color: #0f172a;">1. REGULARIZATION OF EMPLOYMENT</h4>
        <p>Effective <b>${dateToday}</b>, the Employer hereby grants the Employee <b>REGULAR (PERMANENT)</b> employment status.</p>
        <h4 style="color: #0f172a;">2. COMPENSATION & REAFFIRMATION</h4>
        <p>The daily basic salary is <b>₱${(dailySalary * 8).toFixed(2)}</b>. All original policies (Attendance, ₱1,000,000.00 Confidentiality penalty, 30-Day Notice) remain in full force.</p>
        
        ${window.getSignaturePadHTML(staffId, 'Regularization')}
    `;
    window.renderContractOverlay(contractHtml, data);
};

// ⚙️ OVERLAY RENDERER & SIGNATURE UI
window.getSignaturePadHTML = function(staffId, type) {
    return `
        <div style="background: #f8fafc; border: 2px dashed #0f766e; padding: 20px; border-radius: 8px; margin-top: 30px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; color: #0f766e;">Required Digital Signature</h3>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">Please sign your name inside the box below to legally accept this contract.</p>
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; touch-action: none; position: relative; margin-bottom: 15px;">
                <canvas id="contractSigCanvas" style="width: 100%; height: 150px; cursor: crosshair; touch-action: none;"></canvas>
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="window.clearContractSignature()" style="flex: 1; background: white; color: #64748b; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer;">Clear Signature</button>
                <button onclick="window.acceptContract('${staffId}', '${type}')" style="flex: 2; background: #10b981; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3);">📝 Sign & Accept Contract</button>
            </div>
        </div>
    `;
};

window.renderContractOverlay = function(contractHtml, data) {
    window.coePendingData = data; 
    let overlay = document.getElementById('renewalContractOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'renewalContractOverlay';
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(5px);";
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="background: white; padding: 40px; border-radius: 12px; max-width: 800px; width: 100%; max-height: 85vh; overflow-y: auto; text-align: left; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">${contractHtml}</div>`;
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'none';
    overlay.style.display = 'flex';

    // Wake up the signature pad once the HTML is injected!
    setTimeout(() => { window.initContractSignaturePad(); }, 300);
};

// ✍️ SIGNATURE PAD LOGIC
window.isContractSignatureBlank = true;

window.initContractSignaturePad = function() {
    let canvas = document.getElementById('contractSigCanvas');
    if (!canvas) return;
    
    // Fix scaling for crisp lines on mobile screens
    canvas.width = canvas.offsetWidth || 400;
    canvas.height = canvas.offsetHeight || 150;
    
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    window.isContractSignatureBlank = true;

    let drawing = false;

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startDraw = (e) => { 
        drawing = true; 
        window.isContractSignatureBlank = false;
        const pos = getPos(e); 
        ctx.beginPath(); 
        ctx.moveTo(pos.x, pos.y); 
        e.preventDefault(); 
    };

    const draw = (e) => { 
        if (!drawing) return; 
        const pos = getPos(e); 
        ctx.lineTo(pos.x, pos.y); 
        ctx.stroke(); 
        e.preventDefault(); 
    };

    const stopDraw = (e) => { drawing = false; ctx.closePath(); };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);
    canvas.addEventListener('touchstart', startDraw, {passive: false});
    canvas.addEventListener('touchmove', draw, {passive: false});
    canvas.addEventListener('touchend', stopDraw, {passive: false});
};

window.clearContractSignature = function() {
    const canvas = document.getElementById('contractSigCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.isContractSignatureBlank = true;
    }
};

// ✅ UNIVERSAL CONTRACT ACCEPTOR (SAVES SIGNATURE)
window.acceptContract = async function(staffId, type) {
    if (window.isContractSignatureBlank) {
        return Swal.fire('Signature Required', 'Please sign your name in the box to legally accept this contract.', 'warning');
    }

    Swal.fire({title: 'Signing & Generating PDF...', text: 'Please wait while we attach your signature and government IDs...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    try {
        const canvas = document.getElementById('contractSigCanvas');
        const signatureBase64 = canvas.toDataURL('image/png');

        let todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        
        let newStatus = 'Active';
        let updatePayload = { 
            contractStatus: newStatus,
            contractSignature: signatureBase64 // Save the signature drawing to Firebase!
        };
        
        if (type === 'Initial') { updatePayload.contractStatus = 'Active'; updatePayload['signedContracts.initial'] = todayStr; }
        if (type === 'Extension') { 
            let today = new Date(); let yyyy = today.getFullYear(); let mm = String(today.getMonth() + 1).padStart(2, '0'); let dd = String(today.getDate()).padStart(2, '0');
            updatePayload.contractStatus = 'Extended'; updatePayload.dateHired = `${yyyy}-${mm}-${dd}`; updatePayload['signedContracts.extension'] = todayStr; 
        }
        if (type === 'Regularization') { updatePayload.contractStatus = 'Regular'; updatePayload['signedContracts.regularization'] = todayStr; }

        await updateDoc(doc(db, "cashiers", staffId), updatePayload);
        
        // Pass the signature into local memory so the PDF generator can use it instantly!
        window.coePendingData.contractSignature = signatureBase64;

        document.getElementById('renewalContractOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        
        // Trigger the automatic PDF download!
        window.downloadContractPDF(type, window.coePendingData, todayStr, true);

    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to sign contract. Check connection.', 'error');
    }
};

// ========================================================
// 🖨️ UNIVERSAL HR PDF CONTRACT GENERATOR (WITH SIGNATURE & IDs)
// ========================================================
window.downloadContractPDF = function(type, data, signDate, isStaffApp = false) {
    let dailySalary = parseFloat((data.hourlyRate || 0) * 8).toFixed(2);
    if (dailySalary === "0.00" && data.dailyRate) dailySalary = parseFloat(data.dailyRate).toFixed(2);

    let branchAddress = "Davao City, Philippines";
    if (data.branch === 'Cabantian') branchAddress = "Blk 14, Lot 6, Deca Homes Subdivision, Barangay Cabantian, Davao City";
    if (data.branch === 'Citygate') branchAddress = "Citygate, Buhangin, Davao City";
    if (data.branch === 'Maa') branchAddress = "Maa, Davao City";

    let isRegular = (type === 'Regularization' || type === 'Extension');
    let title = isRegular ? "REGULARIZATION OF EMPLOYMENT AGREEMENT" : "EMPLOYMENT CONTRACT";

    let durationText = isRegular 
        ? `Effective <b>${signDate}</b>, the Employer hereby grants the Employee <b>REGULAR (PERMANENT)</b> employment status.`
        : `Employment shall commence on <b>${data.dateHired || signDate}</b> and shall be valid for a period of six (6) months, subject to the terms and conditions of this Agreement.`;

    let content = `
        <div style="font-size: 13px; line-height: 1.5; text-align: justify; color: #1e293b;">
            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">1. Position and Commencement</h4>
            <p style="margin: 0 0 10px 0;">The Employer hereby employs the Employee as a <b>${data.role || 'Service Crew'}</b> for Takodeal. The Employee agrees to faithfully and diligently perform duties assigned by the Employer. ${durationText}</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">2. Work Schedule and Compensation</h4>
            <p style="margin: 0 0 10px 0;">The Employee shall receive a daily basic salary of <b>₱${dailySalary}</b>. The Employee is scheduled to work up to six (6) days per week, subject to operational needs. Working hours shall be determined by the Employer.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">3. Attendance, Absences and Tardiness Policy</h4>
            <p style="margin: 0 0 10px 0;">
                <b>Absences:</b> Failure to notify management before the start of the scheduled shift shall be considered an unexcused absence.<br>
                <b>Tardiness:</b> Repeated tardiness shall be subject to disciplinary action. Management reserves the right to deduct corresponding time or wages for late arrivals.<br>
                <b>Sanctions for Violations:</b> 1st Offense (Verbal Warning) • 2nd Offense (Written Warning) • 3rd Offense (1-Day Suspension) • 4th Offense (3-Day Suspension) • 5th Offense (7-Day Suspension) • 6th Offense (14-Day Suspension) • 7th Offense (Termination / Dismissal).
            </p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">4. Confidentiality Agreement</h4>
            <p style="margin: 0 0 10px 0;">The Employee agrees to keep all proprietary information strictly confidential (recipes, processes, suppliers). Disclosure to outside parties is a serious breach, making the Employee liable to pay a <b>One Million Pesos (₱1,000,000.00)</b> penalty to the Employer.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">5. Health Declaration</h4>
            <p style="margin: 0 0 10px 0;">The Employee affirms they are physically fit for a food-handling environment. The Employer is not responsible for medical expenses related to concealed critical illnesses.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">6. Notice of Resignation</h4>
            <p style="margin: 0 0 10px 0;">The Employee agrees to render a <b>30-day notice</b> prior to voluntarily resigning to avoid financial damages equivalent to the cost incurred due to the unserved notice period.</p>

            <h4 style="color: #0f172a; margin: 15px 0 5px 0; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">7. Company Uniform and Property</h4>
            <p style="margin: 0 0 10px 0;">Items provided on a borrowed basis (cap, apron, t-shirt) must be cared for and returned upon resignation to avoid payroll deductions.</p>
        </div>
    `;

    // 4. Gather Uploaded IDs from Database for Page 2
    let idImagesHtml = "";
    let ids = [];
    if (data.sssIdUrl) ids.push(data.sssIdUrl);
    if (data.philhealthIdUrl) ids.push(data.philhealthIdUrl);
    if (data.pagibigIdUrl) ids.push(data.pagibigIdUrl);

    if (ids.length > 0) {
        idImagesHtml += `<div style="page-break-before: always; padding-top: 40px;">`;
        idImagesHtml += `<h3 style="text-align: center; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 30px;">ATTACHED VALID IDs</h3>`;
        idImagesHtml += `<div style="display: flex; flex-direction: column; gap: 30px; align-items: center;">`;
        ids.forEach(url => {
            idImagesHtml += `<img src="${url}" style="max-width: 90%; max-height: 350px; border: 2px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">`;
        });
        idImagesHtml += `</div></div>`;
    }

    // 🔥 THE SIGNATURE INJECTOR 🔥
    let employeeSignatureHtml = data.contractSignature 
        ? `<img src="${data.contractSignature}" style="height: 60px; display: block; margin-bottom: -10px;">` 
        : `<div style="height: 50px; display: block; margin-bottom: 5px;"></div>`;

    // 5. Combine into Final PDF Container
    let container = document.createElement('div');
    container.innerHTML = `
        <div style="padding: 40px 50px; font-family: 'Helvetica', 'Arial', sans-serif; color: #1e293b; background: white; width: 800px; box-sizing: border-box;">
            <div style="text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px;">
                <h1 style="margin: 0; font-size: 32px; letter-spacing: 2px; color: #0f172a;">TAKODEÁL</h1>
                <p style="margin: 5px 0 0 0; color: #64748b; font-size: 12px; text-transform: uppercase;">${branchAddress}</p>
            </div>
            <h2 style="text-align: center; color: #b45309; font-size: 18px; text-transform: uppercase; margin-bottom: 20px;">${title}</h2>
            <p style="margin-bottom: 15px; font-size: 13px; line-height: 1.5;">This Agreement is executed on <b>${signDate}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${(data.cashierName || 'Employee').toUpperCase()}</b> ("Employee").</p>
            
            ${content}
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; font-size: 13px;">
                <div>
                    ${employeeSignatureHtml}
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px; padding-bottom: 5px;"><b>${(data.cashierName || 'Employee').toUpperCase()}</b></div>
                    <span style="color: #64748b;">Employee Digitally Accepted</span>
                </div>
                <div>
                    <div style="height: 50px; display: block; margin-bottom: 5px;"></div>
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px; padding-bottom: 5px;"><b>Chery Ann R. Fonda</b></div>
                    <span style="color: #64748b;">Owner / Employer</span>
                </div>
            </div>
            ${idImagesHtml}
        </div>`;
    
    Swal.fire({title: 'Generating PDF...', text: 'Attaching IDs and formatting contract...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    
    // 6. Execute PDF Engine
    let opt = {
        margin: 0,
        filename: `${title.replace(/\s+/g, '_')}_${(data.cashierName || 'Employee').replace(/\s+/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true }, 
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(container).save().then(() => {
        if (isStaffApp) {
            Swal.fire({
                title: '<div style="font-size: 32px; animation: bounce 1s infinite;">🎉 CONGRATULATIONS! 🎉</div>',
                html: `<b>Welcome to the next chapter of your journey at TAKODEÁL!</b> 🐙<br><br>Your contract has been officially signed and a PDF soft copy has been downloaded to your device for your records.`,
                icon: 'success',
                confirmButtonText: 'Awesome! 🚀',
                confirmButtonColor: '#10b981',
                customClass: { popup: 'rounded-2xl shadow-2xl p-6' }
            });
        } else {
            Swal.close();
        }
    }).catch(err => {
        console.error("PDF Gen Error:", err);
        Swal.fire('Warning', 'Contract generated, but there was an issue attaching the ID photos. Please ensure IDs are uploaded in the Staff Profile.', 'warning');
    });
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

// ==========================================
// 📱 NAVIGATION ENGINE
// ==========================================
window.switchView = function(viewId, btnElement) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    let targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        // 🔥 THE FIX: Auto-highlights the tab even if triggered by code!
        let autoBtn = document.querySelector(`.bottom-nav .nav-item[onclick*="'${viewId}'"]`);
        if (autoBtn) autoBtn.classList.add('active');
    }
    
    if (viewId === 'timeclock') window.startCameraAndGPS();
    else window.stopCamera();
    if (viewId === 'payslip') window.loadPayslipVault();
    if (viewId === 'schedule') window.loadStaffSchedule();
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
                id: ann.id,
                title: ann.title || 'Announcement',
                subHeadline: ann.subHeadline || '', // 🔥 Fetch new field
                message: ann.message || '',
                footerMessage: ann.footerMessage || '', // 🔥 Fetch new field
                images: ann.images || [],
                dateStr: dateStr,
                hasSignature: !!sigData,
                signatureImg: sigData ? sigData.signature : '',
                signatureDate: sigDateStr
            };
            
            let modalData = encodeURIComponent(JSON.stringify(safeData));

            if (!sigData) unreadAnnouncements.push(modalData);

            html += `
                <div class="req-item-card" onclick="window.viewAnnouncement('${modalData}')" style="cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: transform 0.2s;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                        <h3 style="margin:0; color:#0f172a; font-size: 15px; flex: 1;">${ann.title}</h3>
                        <div style="margin-left: 10px;">${statusBadge}</div>
                    </div>
                    ${ann.subHeadline ? `<div style="font-size:12px; font-weight:bold; color:#0ea5e9; margin-bottom:6px;">${ann.subHeadline}</div>` : ''}
                    <div style="font-size:11px; color:#64748b; margin-bottom:10px;">📅 Published: ${dateStr}</div>
                    <p style="font-size:13px; color:#334155; margin:0 0 10px 0; line-height: 1.4;">${shortMsg}</p>
                    <div style="font-size: 11px; color: #0ea5e9; font-weight: bold; text-align: right;">View Full Details &rarr;</div>
                </div>
            `;
        });
        
        container.innerHTML = html || '<div style="text-align:center; padding: 40px; color: #94a3b8;">No new announcements.</div>';

        if (unreadAnnouncements.length > 0 && !window.hasAutoShownBulletin) {
            window.hasAutoShownBulletin = true;
            setTimeout(() => {
                window.viewAnnouncement(unreadAnnouncements[0]); 
            }, 1000); 
        }

    } catch (e) { 
        console.error(e); 
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #dc2626;">Error loading announcements.</div>';
    }
};

// 🔥 THE NEW SPLASH SCREEN FUNCTION 🔥
window.showExtraLargeImage = function(imgSrc) {
    let existing = document.getElementById('announceImageOverlay');
    if (existing) existing.remove();
    
    let overlay = document.createElement('div');
    overlay.id = 'announceImageOverlay';
    overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 100000; display: flex; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(5px);";
    
    overlay.innerHTML = `
        <button onclick="document.getElementById('announceImageOverlay').remove()" style="position: absolute; top: 20px; right: 20px; background: #ef4444; color: white; border: 2px solid white; border-radius: 50%; width: 45px; height: 45px; font-size: 22px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.4); transition: 0.2s;">✖</button>
        <img src="${imgSrc}" style="max-width: 95%; max-height: 80vh; object-fit: contain; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
        <div style="color: white; margin-top: 20px; font-size: 14px; font-weight: bold; background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.2);">Tap the ✖ in the top right to read details and sign</div>
    `;
    document.body.appendChild(overlay);
};

window.viewAnnouncement = function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    
    // Create wide, beautiful banner images inside the modal (with click-to-enlarge)
    let imagesHtml = '';
    if (data.images && data.images.length > 0) {
        imagesHtml = `<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px; padding-bottom: 5px;">`;
        data.images.forEach(img => {
            imagesHtml += `<img src="${img}" style="width: 100%; max-height: 250px; border-radius: 8px; border: 1px solid #cbd5e1; object-fit: cover; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.05);" onclick="window.showExtraLargeImage('${img}')">
            <div style="text-align: center; font-size: 10px; color: #94a3b8; font-weight: bold;">Tap image to enlarge 🔍</div>`;
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

    // 🔥 Inject New Sub-Headline & Footer
    let subHeadlineHtml = data.subHeadline ? `<div style="font-size: 16px; font-weight: 900; color: #0ea5e9; margin-bottom: 15px; line-height: 1.3;">${data.subHeadline}</div>` : '';
    let footerHtml = data.footerMessage ? `<div style="font-size: 12px; color: #64748b; margin-top: 25px; padding-top: 15px; border-top: 2px dashed #e2e8f0; text-align: center; font-style: italic; font-weight: bold;">${data.footerMessage}</div>` : '';

    Swal.fire({
        title: `<div style="text-align:left; font-size: 22px; font-weight: 900; color: #0f172a; margin-bottom: 5px; line-height: 1.2; text-transform: uppercase;">${data.title}</div>`,
        html: `<div style="text-align: left; max-height: 75vh; overflow-y: auto; padding-right: 5px;">
                <div style="font-size: 12px; font-weight: bold; color: #64748b; margin-bottom: 15px; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">📅 Published: ${data.dateStr}</div>
                ${subHeadlineHtml}
                <div style="font-size: 15px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${data.message || ''}</div>
                ${imagesHtml}
                ${sigHtml}
                ${footerHtml}
               </div>`,
        showCloseButton: true, 
        showConfirmButton: false,
        allowOutsideClick: data.hasSignature,
        customClass: { popup: 'rounded-2xl shadow-2xl p-4' },
        didOpen: () => {
            if (!data.hasSignature) window.initSignaturePad();
            
            // 🔥 THE MAGIC SPLASH SCREEN TRIGGER: Auto-open the massive image!
            if (data.images && data.images.length > 0) {
                window.showExtraLargeImage(data.images[0]);
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
        
        const q = query(collection(db, "attendance_logs"), where("staffName", "==", staffName));
        const snap = await getDocs(q);
        
        let userLogs = [];
        snap.forEach(doc => {
            let d = doc.data();
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
            
            const sopQ = query(collection(db, "sop_logs"), where("staffName", "==", staffName));
            const sopSnap = await getDocs(sopQ);
            
            let hasSopToday = false;
            sopSnap.forEach(doc => {
                let d = doc.data();
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
                return; 
            }
        }

        // 3. 📍 GPS VERIFICATION (MOVED UP FOR LATE CHECKER)
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

        // 4. ⏰ THE STRICT LATE DETECTOR & PHOTO INTERCEPTOR
        if (type === "TIME IN") {
            try {
                let nickname = staffName;
                const staffDocSnap = await getDoc(doc(db, "cashiers", localStorage.getItem('takodeal_staff_id')));
                if (staffDocSnap.exists()) {
                    nickname = staffDocSnap.data().scheduleNickname || staffName;
                }

                const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
                if (schedSnap.exists()) {
                    let scheduleData = schedSnap.data();
                    let logDate = new Date();
                    let lDay = logDate.getDate(); let lMonth = logDate.getMonth() + 1; let lYear = logDate.getFullYear();
                    
                    if (scheduleData.currentYear === lYear && scheduleData.currentMonth === lMonth && scheduleData.currentSchedule) {
                        let branchSched = scheduleData.currentSchedule[lDay] ? scheduleData.currentSchedule[lDay][closestBranch] : null;
                        
                        if (branchSched && branchSched.scheduled) {
                            let assignedShiftId = Object.keys(branchSched.scheduled).find(k => branchSched.scheduled[k] === nickname || branchSched.scheduled[k] === staffName);
                            
                            if (assignedShiftId && scheduleData.branchConfig[closestBranch]) {
                                let shiftConfig = scheduleData.branchConfig[closestBranch].find(s => s.id === assignedShiftId);
                                if (shiftConfig) {
                                    let expectedStartHour = null;
                                    if (shiftConfig.startTime) {
                                        let parts = shiftConfig.startTime.split(':');
                                        expectedStartHour = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
                                    } else {
                                        const parseTimeStr = (timeStr) => {
                                            let t = timeStr.toLowerCase().replace(/\s/g, '');
                                            let isPM = t.includes('pm'); let isNN = t.includes('nn');
                                            let parts = t.replace(/(am|pm|nn)/, '').split(':');
                                            let hour = parseInt(parts[0]) || 0; let minute = parts.length > 1 ? parseInt(parts[1]) : 0;
                                            if ((isPM || isNN) && hour < 12) hour += 12;
                                            if (t.includes('am') && hour === 12) hour = 0;
                                            return hour + (minute / 60);
                                        };
                                        let match = shiftConfig.name.match(/\((.*?)-/);
                                        if (match && match[1]) expectedStartHour = parseTimeStr(match[1]);
                                    }
                                    
                                    if (expectedStartHour !== null) {
                                        let actualHour = logDate.getHours() + (logDate.getMinutes() / 60);
                                        let diffHours = actualHour - expectedStartHour;
                                        
                                        // Trigger interceptor if they are more than 3 minutes late!
                                        if (diffHours > 0.05 && diffHours < 4) {
                                            let lateMins = Math.floor(diffHours * 60);
                                            
                                            Swal.close(); // Close the loading screen to show the modal!

                                            const { value: lateForm, isConfirmed } = await Swal.fire({
                                                title: '⏰ You are Late!',
                                                html: `
                                                    <div style="font-size: 14px; color: #475569; margin-bottom: 15px; text-align: left;">
                                                        You are <b>${lateMins} minutes late</b> for your shift.<br><br>
                                                        You are strictly required to provide a valid reason and attach a screenshot of your message sent to the Owner, Manager, or HR.
                                                    </div>
                                                    <textarea id="lateReason" placeholder="Enter your valid reason here..." style="width: 100%; padding: 12px; border: 2px solid #cbd5e1; border-radius: 8px; margin-bottom: 15px; font-family: inherit; resize: none; outline: none; font-weight: bold; box-sizing: border-box;"></textarea>
                                                    <label style="font-size: 12px; font-weight: bold; color: #dc2626; display: block; margin-bottom: 5px; text-align: left;">Upload Screenshot Proof 📸 *</label>
                                                    <input type="file" id="lateProof" accept="image/*" style="width: 100%; padding: 10px; border: 2px dashed #fca5a5; border-radius: 8px; box-sizing: border-box; background: #fef2f2; color: #b91c1c; font-weight: bold; outline: none;">
                                                `,
                                                showCancelButton: true,
                                                confirmButtonText: 'Submit & Time In',
                                                cancelButtonText: 'Cancel',
                                                confirmButtonColor: '#ef4444',
                                                cancelButtonColor: '#64748b',
                                                allowOutsideClick: false,
                                                customClass: { popup: 'rounded-2xl shadow-xl border border-red-100' },
                                                preConfirm: () => {
                                                    let reason = document.getElementById('lateReason').value.trim();
                                                    let file = document.getElementById('lateProof').files[0];
                                                    if (!reason || !file) {
                                                        Swal.showValidationMessage("Both a reason and a screenshot proof are strictly required to time in.");
                                                        return false;
                                                    }
                                                    return { reason, file };
                                                }
                                            });

                                            // If they click cancel, abort the Time In silently
                                            if (!isConfirmed) return; 

                                            Swal.fire({title: 'Uploading Proof...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

                                            let proofUrl = "";
                                            const fileExt = lateForm.file.name.split('.').pop();
                                            const fileName = `staff_requests/late_${staffName.replace(/\s+/g, '_')}_${Date.now()}.${fileExt}`;
                                            const storageRef = ref(window.storage || getStorage(db.app), fileName);
                                            const snapshot = await uploadBytes(storageRef, lateForm.file);
                                            proofUrl = await getDownloadURL(snapshot.ref);

                                            // Submits immediately to the Manager's Request Inbox!
                                            await addDoc(collection(db, "staff_requests"), {
                                                type: "Reason Letter",
                                                staffName: staffName,
                                                branch: closestBranch,
                                                status: "Pending",
                                                explanationCause: "Tardiness / Late Arrival",
                                                explanationMessage: `Clocked in ${lateMins} minutes late. Reason: ${lateForm.reason}`,
                                                proofImageUrl: proofUrl,
                                                timestamp: serverTimestamp()
                                            });
                                            
                                            // Show verifying again
                                            Swal.fire({title: 'Verifying location...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch(e) {
                console.error("Late Checker Error:", e);
            }
        }

        // 5. 📸 PHOTO CAPTURE
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

        // 6. 💾 SAVE TO FIREBASE
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

    // 🔥 THE CRASH FIX: Indestructible Date Converter
    const safeDate = (fbDate) => {
        if (!fbDate) return new Date();
        if (fbDate.toDate) return fbDate.toDate();
        let d = new Date(fbDate);
        return isNaN(d.getTime()) ? new Date() : d; // Defaults to now if the date is corrupted
    };

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
        let staffProfile = staffRef.exists() ? staffRef.data() : {};
        let dailyRate = parseFloat(staffProfile.hourlyRate) || 0;
        let ratePerHour = dailyRate / 8;
        let nickname = staffProfile.scheduleNickname || staffName;
        let isNightEligible = staffProfile.eligibleNightDiff !== false;

        const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
        let scheduleData = schedSnap.exists() ? schedSnap.data() : null;
        let holidaysObj = scheduleData ? (scheduleData.holidays || {}) : {};

        const parseTimeStr = (timeStr) => {
            let t = timeStr.toLowerCase().replace(/\s/g, '');
            let isPM = t.includes('pm'); let isNN = t.includes('nn');
            let parts = t.replace(/(am|pm|nn)/, '').split(':');
            let hour = parseInt(parts[0]) || 0; let minute = parts.length > 1 ? parseInt(parts[1]) : 0;
            if ((isPM || isNN) && hour < 12) hour += 12;
            if (t.includes('am') && hour === 12) hour = 0;
            return hour + (minute / 60);
        };

        const attQ = query(collection(db, "attendance_logs"), where("staffName", "==", staffName));
        const attSnap = await getDocs(attQ);

        let filteredAttLogs = [];
        attSnap.forEach(docSnap => {
            let log = docSnap.data();
            if (log.timestamp) {
                let t = safeDate(log.timestamp);
                if (t >= startTimestamp && t <= endTimestamp) {
                    filteredAttLogs.push(log);
                }
            }
        });
        
        // 🔥 THE CRASH FIX: Use .getTime() to prevent NaN sorting errors
        filteredAttLogs.sort((a, b) => safeDate(a.timestamp).getTime() - safeDate(b.timestamp).getTime());

        const bonusQ = query(collection(db, "staff_bonuses"), where("staffName", "==", staffName));
        const bonusSnap = await getDocs(bonusQ);

        let totalBonuses = 0;
        let bonusesList = [];
        bonusSnap.forEach(docSnap => { 
            let b = docSnap.data();
            if (b.dateAdded) {
                let t = safeDate(b.dateAdded);
                if (t >= startTimestamp && t <= endTimestamp) {
                    let amt = parseFloat(b.amount) || 0;
                    totalBonuses += amt; 
                    bonusesList.push(b); 
                }
            }
        });

        let totalHours = 0;
        let shiftsWorked = 0; 
        let totalLatePenalty = 0;
        let activeShifts = {};
        let shiftPairs = [];
        
        filteredAttLogs.forEach(log => {
            let manualPenalty = parseFloat(log.penaltyAmount) || 0;
            
            // 🔥 THE CRASH FIX: Ensure logType is ALWAYS a string before checking it!
            let logType = typeof log.type === 'string' ? log.type.toUpperCase() : "UNKNOWN";

            if (logType === "TIME IN") {
                let logDate = safeDate(log.timestamp); 
                let lateMinutes = 0;
                let wasScheduled = false;
                let expectedStartHour = null; // 🔥 THE SCOPE FIX: Moved here so the whole block can see it!

                if (scheduleData && scheduleData.currentSchedule) {
                    let lDay = logDate.getDate(); let lMonth = logDate.getMonth() + 1; let lYear = logDate.getFullYear();
                    if (scheduleData.currentYear === lYear && scheduleData.currentMonth === lMonth) {
                        
                        let branchSafe = log.branch || "Unknown";
                        let branchSched = scheduleData.currentSchedule[lDay] ? scheduleData.currentSchedule[lDay][branchSafe] : null;
                        
                        if (branchSched && branchSched.scheduled) {
                            let assignedShiftId = Object.keys(branchSched.scheduled).find(k => branchSched.scheduled[k] === nickname || branchSched.scheduled[k] === staffName);
                            
                            if (assignedShiftId && scheduleData.branchConfig && scheduleData.branchConfig[branchSafe]) {
                                wasScheduled = true;
                                let shiftConfig = scheduleData.branchConfig[branchSafe].find(s => s.id === assignedShiftId);
                                if (shiftConfig) {
                                    // 🔥 We removed 'let' here so it uses the variable we defined at the top!
                                    if (shiftConfig.startTime) {
                                        let parts = String(shiftConfig.startTime).split(':');
                                        expectedStartHour = parseInt(parts[0]) + (parseInt(parts[1]) / 60);
                                    } else if (shiftConfig.name) {
                                        let match = shiftConfig.name.match(/\((.*?)-/);
                                        if (match && match[1]) expectedStartHour = parseTimeStr(match[1]);
                                    }

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

                let effectiveDailyRate = dailyRate;
                if (isNightEligible && expectedStartHour !== null && expectedStartHour >= 14) {
                    effectiveDailyRate += 50; 
                }
                let currentRatePerHour = effectiveDailyRate / 8;

                let lateHoursToDeduct = Math.ceil(lateMinutes / 60); 
                let lateAmount = (lateMinutes > 0 && !log.lateExempted) ? (lateHoursToDeduct * currentRatePerHour) : 0;

                activeShifts[staffName] = { 
                    time: logDate, 
                    lateMinutes: lateMinutes, 
                    lateAmount: lateAmount, 
                    lateExempted: log.lateExempted || false,
                    lateHoursToDeduct: lateHoursToDeduct,
                    manualPenalty: manualPenalty,
                    wasScheduled: wasScheduled 
                };

            } else if (logType.includes("TIME OUT") && activeShifts[staffName]) {
                let timeIn = activeShifts[staffName].time;
                let lMins = activeShifts[staffName].lateMinutes;
                let lAmt = activeShifts[staffName].lateAmount;
                let lExempt = activeShifts[staffName].lateExempted;
                let wasScheduled = activeShifts[staffName].wasScheduled; 
                
                let totalManualPenaltyForShift = (activeShifts[staffName].manualPenalty || 0) + manualPenalty;
                
                let timeOut = safeDate(log.timestamp);
                let hoursWorked = (timeOut.getTime() - timeIn.getTime()) / (1000 * 60 * 60);
                
                if (hoursWorked > 18) {
                    shiftPairs.push({ dateObj: timeIn, in: timeIn, out: timeOut, hrs: hoursWorked, remark: `<span style="color:#ef4444; font-weight:bold;">INVALID (${hoursWorked.toFixed(1)}h)</span>` });
                    delete activeShifts[staffName]; return; 
                }

                let isAutoClosed = logType === "TIME OUT (AUTO)";
                let remark = isAutoClosed ? `<span style="color:#d97706; font-weight:bold;">Auto-Closed</span>` : `<span style="color:#10b981; font-weight:bold;">Complete</span>`;
                
                let shiftMultiplier = 1; 
        
                if (hoursWorked < 1 && !isAutoClosed) {
                    shiftMultiplier = 0;
                    remark = `<span style="color:#ef4444; font-weight:bold;">Misclick (Ignored)</span>`;
                } else if (hoursWorked >= 13.5) {
                    shiftMultiplier = 2;
                    totalBonuses += 50; 
                    remark = `<span style="color:#8b5cf6; font-weight:bold;">Straight Duty</span>`;
                } else if (hoursWorked < 8 && !isAutoClosed) {
                    if (wasScheduled) {
                        let missingHours = (8 - hoursWorked).toFixed(1);
                        remark = `<span style="color:#ef4444; font-weight:bold;">Short (${missingHours}h)</span>`;
                    } else {
                        remark = `<span style="color:#10b981; font-weight:bold;">Complete (Unscheduled)</span>`;
                    }
                }

                let outHour = timeOut.getHours();
                let thisShiftNightBonus = 0;

                if (outHour >= 0 && outHour <= 4) {
                    if (isNightEligible) { 
                        thisShiftNightBonus = 50; 
                        totalBonuses += thisShiftNightBonus; 
                    }
                }

                let logDateStr = `${timeIn.getFullYear()}-${String(timeIn.getMonth()+1).padStart(2,'0')}-${String(timeIn.getDate()).padStart(2,'0')}`;
                let hType = holidaysObj[logDateStr];
                let baseForHoliday = (dailyRate * shiftMultiplier) + thisShiftNightBonus;
                let hBonus = 0;

                if (hType === 'Regular') { 
                    hBonus = baseForHoliday * 0.50; 
                    totalBonuses += hBonus; 
                    remark += ` <br><span style="color:#ea580c; font-weight:bold;">(Reg Hol: +₱${hBonus.toFixed(2)})</span>`; 
                } 
                else if (hType === 'Special') { 
                    hBonus = baseForHoliday * 0.10; 
                    totalBonuses += hBonus; 
                    remark += ` <br><span style="color:#ea580c; font-weight:bold;">(Spl Hol: +₱${hBonus.toFixed(2)})</span>`; 
                }

                if (lMins > 0) {
                    if (lExempt) {
                        remark += `<br><span style="color:#16a34a; font-weight:bold;">(Late Exempted)</span>`;
                    } else {
                        remark += `<br><span style="color:#dc2626; font-weight:bold;">(Late ${lMins}m = -₱${lAmt.toFixed(2)})</span>`;
                        totalLatePenalty += lAmt; 
                    }
                }

                if (totalManualPenaltyForShift > 0) {
                    remark += `<br><span style="color:#b91c1c; font-weight:900; font-size:10px;">-₱${totalManualPenaltyForShift.toFixed(2)} Manual Penalty</span>`;
                    totalLatePenalty += totalManualPenaltyForShift;
                }

                shiftsWorked += shiftMultiplier;
                totalHours += hoursWorked;
                
                shiftPairs.push({ 
                    dateObj: timeIn, 
                    in: timeIn, 
                    out: timeOut, 
                    hrs: hoursWorked, 
                    remark: remark,
                    lateMins: (!lExempt && lMins > 0) ? lMins : 0 
                });
                
                delete activeShifts[staffName];
            } else if (manualPenalty > 0) {
                totalLatePenalty += manualPenalty;
                let logTime = log.timestamp ? safeDate(log.timestamp) : new Date();
                shiftPairs.push({ 
                    dateObj: logTime, 
                    in: logTime, 
                    out: null, 
                    hrs: 0, 
                    remark: `<span style="color:#b91c1c; font-weight:900; font-size:10px;">-₱${manualPenalty.toFixed(2)} Manual Penalty</span>`,
                    lateMins: 0 
                });
            }
        });

        if (activeShifts[staffName]) {
            shiftPairs.push({ 
                dateObj: activeShifts[staffName].time, 
                in: activeShifts[staffName].time, 
                out: "Active Shift", 
                hrs: 0, 
                remark: `<span style="color:#0ea5e9; font-style:italic;">Active Shift</span>`,
                lateMins: (!activeShifts[staffName].lateExempted && activeShifts[staffName].lateMinutes > 0) ? activeShifts[staffName].lateMinutes : 0,
                isActive: true
            });
        }

        bonusesList.forEach(b => {
            let amt = parseFloat(b.amount) || 0;
            let bDate = b.dateAdded ? safeDate(b.dateAdded) : new Date();
            let dateStr = bDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            
            let existingLog = shiftPairs.find(l => l.in && l.in.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) === dateStr);
            
            if (existingLog) {
                if (existingLog.remark.includes('Complete')) {
                    existingLog.remark = existingLog.remark.replace('Complete', 'Complete (w/ Overtime)');
                }
                existingLog.remark += `<br><span style="color:#ea580c; font-weight:bold;">+₱${amt.toFixed(2)} (Manual OT: ${b.remarks || 'Bonus'})</span>`;
            } else {
                shiftPairs.push({ 
                    dateObj: bDate, 
                    in: null, 
                    out: null, 
                    hrs: 0, 
                    remark: `<span style="color:#ea580c; font-weight:bold;">+₱${amt.toFixed(2)} (Manual OT: ${b.remarks || 'Bonus'})</span>`,
                    lateMins: 0 
                });
            }
        });

        let estGross = shiftsWorked * dailyRate;

        const dedQ = query(collection(db, "staff_deductions"), where("staffName", "==", staffName), where("status", "==", "Unpaid"));
        const dedSnap = await getDocs(dedQ);
        let unpaidVales = 0;
        let activeDeductions = [];
        
        dedSnap.forEach(d => {
            let val = parseFloat(d.data().amount) || 0;
            unpaidVales += val;
            activeDeductions.push(d.data());
        });

        let estNet = (estGross + totalBonuses) - totalLatePenalty - unpaidVales;

        document.getElementById('liveEstGross').innerText = '₱' + estGross.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstLates').innerText = '-₱' + totalLatePenalty.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstVales').innerText = '-₱' + unpaidVales.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('liveEstNetPay').innerText = '₱' + Math.max(0, estNet).toLocaleString(undefined, {minimumFractionDigits: 2});

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
                            <tr>
                                <th style="padding: 8px; border-bottom: 1px solid #cbd5e1;">Date</th>
                                <th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">In</th>
                                <th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">Out</th>
                                <th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">Hrs</th>
                                <th style="padding: 8px; border-bottom: 1px solid #cbd5e1; text-align: center;">Remarks</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (shiftPairs.length > 0) {
            // 🔥 THE CRASH FIX: Safe sorting via getTime()
            shiftPairs.sort((a,b) => b.dateObj.getTime() - a.dateObj.getTime()).forEach(p => {
                let dateStr = p.dateObj.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
                let inStr = p.in ? p.in.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'}) : '---';
                let outStr = p.isActive ? '<span style="color:#0ea5e9; font-style:italic;">Active Shift</span>' : (p.out ? (typeof p.out === 'string' ? p.out : p.out.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})) : '---');
                
                // 🔥 THE CRASH FIX: Safe parseFloat
                let safeHrs = parseFloat(p.hrs);
                let hrStr = p.isActive ? '<span style="color:#94a3b8;">--</span>' : (isNaN(safeHrs) ? '0.00h' : `${safeHrs.toFixed(2)}h`);
                
                let inColor = '#16a34a'; 
                if (p.lateMins && p.lateMins > 0) {
                    inStr += `<br><span style="color:#dc2626; font-size:10px; font-weight:bold;">Late: ${p.lateMins}m</span>`;
                    inColor = '#dc2626'; 
                }

                let outColor = '#16a34a'; 
                if (p.remark && (p.remark.includes('Short') || p.remark.includes('INVALID') || p.remark.includes('Missed') || p.remark.includes('Ignored'))) {
                    outColor = '#dc2626'; 
                }
                if (p.isActive) outColor = '#0ea5e9'; 

                detailsHtml += `<tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 8px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 10px 8px; color: ${inColor}; font-weight: bold; text-align: center; vertical-align: middle;">${inStr}</td>
                    <td style="padding: 10px 8px; color: ${outColor}; font-weight: bold; text-align: center; vertical-align: middle;">${outStr}</td>
                    <td style="padding: 10px 8px; font-weight: bold; color: #334155; text-align: center; vertical-align: middle;">${hrStr}</td>
                    <td style="padding: 10px 8px; font-size: 11px; text-align: center; vertical-align: middle;">${p.remark}</td>
                </tr>`;
            });
        } else {
            detailsHtml += `<tr><td colspan="5" style="padding: 15px; text-align: center; color: #94a3b8;">No valid Time In/Out pairs found.</td></tr>`;
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
                let dateStr = dDate ? safeDate(dDate).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) : '';
                detailsHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 8px 0; border-bottom: 1px dashed #e2e8f0;">
                        <div>
                            <strong style="color: #334155;">${d.type}</strong><br>
                            <span style="font-size: 11px; color: #64748b;">${dateStr} - <span style="color:#ef4444; font-weight:bold;">Unpaid</span> (${d.remarks || d.item || 'Salary Deduction'})</span>
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

        const prQ = query(collection(db, "payroll_records"), where("staffName", "==", staffName));
        const prSnap = await getDocs(prQ);

        let prLogs = [];
        prSnap.forEach(docSnap => prLogs.push(docSnap.data()));
        // 🔥 THE CRASH FIX: Safe sorting for processed records
        prLogs.sort((a, b) => safeDate(b.processedAt).getTime() - safeDate(a.processedAt).getTime());

        let historyHtml = '';
        prLogs.forEach(d => {
            let pd = d.frozenData || {};
            pd.processedAt = d.processedAt; 
            
            let dateStr = d.processedAt ? safeDate(d.processedAt).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'Recently';
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
        document.getElementById('liveEstNetPay').innerText = "Error";
        let parentEl = document.getElementById('liveEstNetPay').parentElement;
        if(parentEl) {
            let errorP = parentEl.querySelector('.error-text');
            if(!errorP) {
                parentEl.innerHTML += `<p class="error-text" style="color: #fca5a5; font-size: 12px; font-weight: bold; margin-top: 10px;">Error loading data.</p>`;
            }
        }
        document.getElementById('payslipHistoryList').innerHTML = '<div style="text-align:center; padding: 40px; color: #ef4444;">Error connecting to HQ database.</div>';
    }
};

// ==========================================
// 🧾 THE UPGRADED PAYSLIP UI ENGINE
// ==========================================
window.viewPastPayslip = function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    let disbursedDateStr = 'Pending';
    if (d.processedAt) {
        let pDate = d.processedAt.seconds ? new Date(d.processedAt.seconds * 1000) : new Date(d.processedAt);
        disbursedDateStr = pDate.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } else {
        disbursedDateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

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
    
    let totalDeduct = (parseFloat(lateDeduct) + parseFloat(sss) + parseFloat(phil) + parseFloat(pagibig) + parseFloat(vale) + parseFloat(loans) + parseFloat(meals) + parseFloat(customDeducts)).toFixed(2);
    let netPay = parseFloat(d.finalNetPay || (grossIncome - totalDeduct)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    let logoUrl = "https://takodeal-owner.vercel.app/payslip%20logo.jpg";

    let html = `
        <div style="background: white; padding: 20px; font-family: 'Segoe UI', Arial, sans-serif; color: black; text-align: left; max-width: 100%; box-sizing: border-box;">
            
            <div style="border: 3px solid black; padding: 2px;">
                <div style="border: 1px solid black; padding: 20px;">
                    
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid black; padding-bottom: 15px; margin-bottom: 15px;">
                        <div style="width: 140px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            <img src="${logoUrl}" alt="Takodeal Logo" style="width: 90px; object-fit: contain; border-radius: 8px;">
                        </div>
                        <div style="text-align: center; flex: 1;">
                            <h1 style="margin: 0; font-size: 32px; letter-spacing: 2px;">TAKODEÁL</h1>
                            <p style="margin: 5px 0 0 0; font-size: 16px;">Payslip</p>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; font-size: 14px;">
                        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 5px;">
                            <strong style="text-align: right; padding-right: 10px;">Employee Name:</strong> <span style="border-bottom: 1px solid black; font-weight: bold;">${d.name || d.staffName}</span>
                            <strong style="text-align: right; padding-right: 10px;">Department:</strong> <span style="border-bottom: 1px solid black;">${d.branch || 'N/A'}</span>
                            <strong style="text-align: right; padding-right: 10px;">Date Hired:</strong> <span>${d.dateHired || '---'}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 140px 1fr; gap: 5px;">
                            <strong style="text-align: right; padding-right: 10px;">Cutoff Started:</strong> <span style="border-bottom: 1px solid black;">${d.start || d.startDate}</span>
                            <strong style="text-align: right; padding-right: 10px;">Cutoff Ended:</strong> <span style="border-bottom: 1px solid black;">${d.end || d.endDate}</span>
                            <strong style="text-align: right; padding-right: 10px;">Pay Distributed:</strong> <span style="border-bottom: 1px solid black;">${disbursedDateStr}</span>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid black;">
                        
                        <div style="border-right: 1px solid black;">
                            <div style="background: #e2e8f0; padding: 8px; font-weight: bold; border-bottom: 1px solid black; text-align: left;">INCOME</div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px dashed #cbd5e1;">
                                <span>Basic Pay (${d.shiftsWorked || 0} days)</span> <span style="font-weight: bold;">${basicPay}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px dashed #cbd5e1;">
                                <span>Overtime / Night Diff</span> <span>${otPay}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px dashed #cbd5e1;">
                                <span>Straight Duty Bonus</span> <span>${straightPay}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid black;">
                                <span>Holiday Pay</span> <span>${holPay}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 12px 8px; font-weight: bold; font-size: 16px;">
                                <span>GROSS INCOME</span> <span>${grossIncome}</span>
                            </div>
                        </div>

                        <div>
                            <div style="background: #e2e8f0; padding: 8px; font-weight: bold; border-bottom: 1px solid black; text-align: left;">DEDUCTIONS</div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>Late/Undertime</span> <span>${lateDeduct}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>SSS</span> <span>${sss}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>PhilHealth</span> <span>${phil}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>Pag-IBIG</span> <span>${pagibig}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>Cash Advance (Vale)</span> <span>${vale}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>Company Loans</span> <span>${loans}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 13px;">
                                <span>Foods / Custom</span> <span>${(parseFloat(meals) + parseFloat(customDeducts)).toFixed(2)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; padding: 8px; font-weight: bold; background: #f1f5f9; border-top: 1px solid black;">
                                <span>TOTAL DEDUCTIONS</span> <span>${totalDeduct}</span>
                            </div>
                        </div>

                    </div>

                    <div style="display: flex; justify-content: flex-start; align-items: center; margin-top: 20px;">
                        <div style="background: #cbd5e1; padding: 10px 20px; font-weight: bold; font-size: 18px; border: 1px solid black; width: 120px; text-align: center;">
                            NET PAY
                        </div>
                        <div style="padding: 10px 20px; font-weight: bold; font-size: 22px; margin-left: 20px; border-bottom: 2px solid black;">
                            ${netPay}
                        </div>
                    </div>

                </div>
            </div>
            
            <div style="text-align: center; margin-top: 15px; font-size: 10px; color: #64748b; font-style: italic;">
                System Generated Digital Payslip • Takodeal POS
            </div>
        </div>
    `;

    Swal.fire({
        html: html,
        width: '750px', // Wider to accommodate the new 2-column layout
        showConfirmButton: true,
        confirmButtonText: 'Close',
        confirmButtonColor: '#0f172a',
        customClass: { popup: 'rounded-2xl shadow-2xl p-0' }
    });
};

// ==========================================
// 🗓️ PERSONAL STAFF SCHEDULE & SWAP ENGINE
// ==========================================
window.cachedSchedData = null; // Memory to make swaps lightning fast

window.loadStaffSchedule = async function() {
    let container = document.getElementById('scheduleContainer');
    if (!container) return;
    
    let staffName = localStorage.getItem('takodeal_staff_name');
    if (!staffName) {
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #ef4444; font-weight: bold;">Not logged in.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding: 40px; color: #0ea5e9; font-weight: bold;">⏳ Downloading your schedule...</div>';

    try {
        const staffQ = query(collection(db, "cashiers"), where("cashierName", "==", staffName));
        const staffSnap = await getDocs(staffQ);
        
        let nickname = staffName;
        let myBranch = null;
        
        if (!staffSnap.empty) {
            let data = staffSnap.docs[0].data();
            nickname = data.scheduleNickname || staffName;
            myBranch = data.branch;
        }

        // 🔥 THE FIX: SMART NAME MATCHER! 
        let isMatch = (assignedName) => {
            if (!assignedName || assignedName === "N/A" || assignedName === "UNFILLED") return false;
            let aName = assignedName.toLowerCase().trim();
            let sName = staffName.toLowerCase().trim();
            let nName = nickname.toLowerCase().trim();
            
            if (aName === sName || aName === nName) return true;
            if (sName.includes(aName) && aName.length >= 3) return true;
            return false;
        };

        const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
        if (!schedSnap.exists() || !schedSnap.data().currentSchedule) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color: #64748b; font-weight: bold;">HQ has not published a schedule yet.</div>';
            return;
        }

        let schedData = schedSnap.data();
        window.cachedSchedData = schedData; // Save to memory for swapping!

        let year = schedData.currentYear;
        let month = schedData.currentMonth;
        
        let picker = document.getElementById('staffMonthPicker');
        let selectedYear = year;
        let selectedMonth = month;

        if (picker && picker.value) {
            let parts = picker.value.split('-');
            selectedYear = parseInt(parts[0]);
            selectedMonth = parseInt(parts[1]);
        } else if (picker) {
            picker.value = `${year}-${String(month).padStart(2, '0')}`;
        }

        if (selectedYear !== year || selectedMonth !== month) {
            let niceMonth = new Date(selectedYear, selectedMonth - 1).toLocaleString('en-PH', { month: 'long', year: 'numeric' });
            container.innerHTML = `<div style="text-align:center; padding: 40px; color: #64748b; font-weight: bold;">HQ has not published the schedule for ${niceMonth} yet.</div>`;
            return;
        }

        let monthName = new Date(year, month - 1).toLocaleString('en-PH', { month: 'long' });
        
        let branchConfig = schedData.branchConfig || {};
        let schedule = schedData.currentSchedule;
        let holidays = schedData.holidays || {};

        let html = `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div style="background: #0f172a; color: white; padding: 15px; text-align: center;">
                    <h3 style="margin: 0; font-size: 18px;">🗓️ ${monthName} ${year}</h3>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px; font-weight: bold;">Home Branch: ${myBranch || 'Unassigned'}</div>
                </div>
                <div style="max-height: 60vh; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            <tr>
                                <th style="padding: 12px 15px; color: #475569; border-bottom: 2px solid #cbd5e1; width: 35%;">Date</th>
                                <th style="padding: 12px 15px; color: #475569; border-bottom: 2px solid #cbd5e1;">Shift Status</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        let daysInMonth = new Date(year, month, 0).getDate();
        let hasShifts = false;

        let todayObj = new Date();
        todayObj.setHours(0,0,0,0);

        for (let day = 1; day <= daysInMonth; day++) {
            let dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            let dateObj = new Date(year, month - 1, day);
            let displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            let isFutureOrToday = dateObj >= todayObj;

            let dayData = schedule[day];
            if (!dayData) continue;

            let shiftFound = null;
            let isStandby = false;
            let isLeave = false;
            let leaveReason = "";
            let assignedToBranch = "";

            // 🔥 THE GLOBAL SCANNER FIX: 
            // Loop through EVERY SINGLE BRANCH in the company to find their name!
            let allBranches = Object.keys(dayData);

            for (let b of allBranches) {
                if (!dayData[b]) continue;
                
                let leaveRecord = (dayData[b].unavailable || []).find(u => isMatch(u.name));
                if (leaveRecord) { 
                    isLeave = true; leaveReason = leaveRecord.status; assignedToBranch = b; break; 
                }

                if ((dayData[b].rest || []).some(r => isMatch(r))) {
                    isStandby = true; assignedToBranch = b; break;
                }

                let scheduledKeys = Object.keys(dayData[b].scheduled || {});
                for (let sId of scheduledKeys) {
                    if (isMatch(dayData[b].scheduled[sId])) {
                        if (branchConfig[b]) {
                            let sConf = branchConfig[b].find(s => s.id === sId);
                            if (sConf) { shiftFound = sConf; assignedToBranch = b; break; }
                        }
                    }
                }
                if (shiftFound) break; // Stop scanning once we find them working!
            }

            let holType = holidays[dStr];
            let holBadge = holType ? `<div style="font-size: 10px; color: #ea580c; font-weight: bold; margin-top: 4px;">🎉 ${holType} Holiday</div>` : '';

            let rowBg = "white";
            let statusHtml = '<span style="color: #94a3b8; font-style: italic;">No Schedule</span>';

            // Show a Relief Badge if they are working outside their home branch!
            let reliefBadge = '';
            if (assignedToBranch && assignedToBranch !== myBranch) {
                reliefBadge = `<div style="font-size: 10px; color: #b45309; font-weight: bold; background: #fef3c7; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; border: 1px solid #fde68a;">🌍 Relief: ${assignedToBranch}</div>`;
            }

            if (isLeave) {
                rowBg = "#fef2f2";
                statusHtml = `<span style="background: #fecaca; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🚫 ${leaveReason}</span>${reliefBadge}`;
                hasShifts = true;
            } else if (isStandby) {
                rowBg = "#fffbeb";
                statusHtml = `<span style="background: #fde68a; color: #b45309; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">🛋️ Standby / Day Off</span>${reliefBadge}`;
                hasShifts = true;
            } else if (shiftFound) {
                rowBg = "#f0fdf4";
                
                let timeString = shiftFound.name;
                if (shiftFound.startTime && shiftFound.endTime) {
                    let formatTime = (time24) => {
                        let [h, m] = time24.split(':'); h = parseInt(h);
                        let ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
                        return `${h}:${m} ${ampm}`;
                    };
                    timeString = `<div style="font-weight: 900; color: #0f172a;">${shiftFound.name}</div><div style="font-size: 11px; color: #0ea5e9; margin-top: 2px;">⏰ ${formatTime(shiftFound.startTime)} to ${formatTime(shiftFound.endTime)}</div>`;
                } else {
                    timeString = `<div style="font-weight: 900; color: #0f172a;">${shiftFound.name}</div>`;
                }

                // The Request Swap Button!
                let swapBtn = isFutureOrToday ? `<button onclick="window.initiateSwapRequest(${day}, '${dStr}', '${assignedToBranch}', '${shiftFound.id}', '${shiftFound.name.replace(/'/g, "\\'")}')" style="margin-top: 8px; background: white; color: #d97706; border: 1px solid #fcd34d; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); width: 100%;">🔄 Request Swap</button>` : '';

                statusHtml = timeString + reliefBadge + swapBtn;
                hasShifts = true;
            }

            let isToday = (dStr === todayObj.toISOString().split('T')[0]);
            let todayBorder = isToday ? 'border-left: 4px solid #0ea5e9;' : '';
            let todayBadge = isToday ? '<br><span style="background: #0ea5e9; color: white; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; display: inline-block; margin-top: 4px;">TODAY</span>' : '';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9; background: ${rowBg};">
                    <td style="padding: 12px 15px; color: #334155; font-weight: bold; ${todayBorder}">${displayDate} ${todayBadge}${holBadge}</td>
                    <td style="padding: 12px 15px;">${statusHtml}</td>
                </tr>
            `;
        }

        html += `</tbody></table></div></div>`;
        
        if (!hasShifts) html = '<div style="text-align:center; padding: 40px; color: #64748b; font-weight: bold;">You have no assigned shifts for this month.</div>';
        container.innerHTML = html;

    } catch (error) {
        console.error("Staff Schedule Error:", error);
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #ef4444; font-weight: bold;">❌ Failed to load schedule. Check connection.</div>';
    }
};

window.initiateSwapRequest = function(day, dateStr, branch, myShiftId, myShiftName) {
    let schedData = window.cachedSchedData;
    if(!schedData) return Swal.fire('Error', 'Schedule data is missing. Please refresh.', 'error');

    let dayData = schedData.currentSchedule[day][branch];
    if(!dayData) return Swal.fire('Error', 'Branch schedule missing for this day.', 'error');

    let select = document.getElementById('swapCandidateSelect');
    select.innerHTML = '<option value="">-- Choose Co-Worker --</option>';

    let staffName = localStorage.getItem('takodeal_staff_name');
    
    // 🔥 THE FIX: The Smart Matcher prevents them from seeing themselves!
    let isMatch = (assignedName) => {
        if (!assignedName || assignedName === "N/A" || assignedName === "UNFILLED") return false;
        let aName = assignedName.toLowerCase().trim();
        let sName = staffName.toLowerCase().trim();
        if (aName === sName || sName.includes(aName)) return true;
        return false;
    };

    // 1. Co-workers currently scheduled today
    let optGroupShift = document.createElement('optgroup');
    optGroupShift.label = "🔄 Swap with Scheduled Staff";
    for(let sId in dayData.scheduled) {
        let assignee = dayData.scheduled[sId];
        // ONLY show if it's NOT them!
        if(!isMatch(assignee) && assignee !== "N/A" && assignee !== "UNFILLED") {
            let sConf = schedData.branchConfig[branch].find(s => s.id === sId);
            if (sConf) {
                optGroupShift.innerHTML += `<option value="${assignee}|${sId}|${sConf.name}">${assignee} (Currently: ${sConf.name})</option>`;
            }
        }
    }
    if (optGroupShift.children.length > 0) select.appendChild(optGroupShift);

    // 2. Co-workers on Standby today
    let optGroupStandby = document.createElement('optgroup');
    optGroupStandby.label = "🛋️ Ask Standby Staff to Cover";
    if(dayData.rest) {
        dayData.rest.forEach(r => {
            if(!isMatch(r)) {
                optGroupStandby.innerHTML += `<option value="${r}|STANDBY|Standby">${r} (Currently: On Standby)</option>`;
            }
        });
    }
    if (optGroupStandby.children.length > 0) select.appendChild(optGroupStandby);

    if(select.options.length <= 1) {
        return Swal.fire({title: 'No Candidates', text: 'No one is available to swap with you on this day.', icon: 'info', customClass: { popup: 'rounded-2xl' }});
    }

    document.getElementById('swapModalDetails').innerHTML = `You are requesting to trade your <b>${myShiftName}</b> shift on <b style="color: #0f172a;">${dateStr}</b>.`;
    window.pendingSwapData = { day, dateStr, branch, myShiftId, myShiftName };
    document.getElementById('swapRequestModal').style.display = 'flex';
};

window.submitSwapRequest = async function() {
    let candidateVal = document.getElementById('swapCandidateSelect').value;
    if(!candidateVal) return Swal.fire('Required', 'Please select someone to swap with.', 'warning');

    let [targetName, targetShiftId, targetShiftName] = candidateVal.split('|');
    let requesterName = localStorage.getItem('takodeal_staff_name');
    let d = window.pendingSwapData;

    let btn = document.getElementById('btnSendSwap');
    btn.innerText = "⏳ Sending..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "shift_swaps"), {
            requesterName: requesterName,
            targetName: targetName,
            branch: d.branch,
            dateStr: d.dateStr,
            dayIndex: d.day,
            requesterShiftId: d.myShiftId,
            requesterShiftName: d.myShiftName,
            targetShiftId: targetShiftId,
            targetShiftName: targetShiftName,
            status: "Pending",
            timestamp: serverTimestamp()
        });

        Swal.fire({
            title: '✅ Request Sent!', 
            text: `Swap request sent to ${targetName}. You will be notified when they respond.`, 
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
        
        document.getElementById('swapRequestModal').style.display = 'none';
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to send request.', 'error');
    } finally {
        btn.innerText = "Send Request"; btn.disabled = false;
    }
};

window.listenToIncomingSwaps = async function() {
    let staffName = localStorage.getItem('takodeal_staff_name');
    let staffId = localStorage.getItem('takodeal_staff_id');
    if (!staffName) return;

    let nickname = staffName;
    try {
        const docSnap = await getDoc(doc(db, "cashiers", staffId));
        if(docSnap.exists()) nickname = docSnap.data().scheduleNickname || staffName;
    } catch(e) {}

    let isMatch = (assignedName) => {
        if (!assignedName || assignedName === "N/A" || assignedName === "UNFILLED") return false;
        let aName = assignedName.toLowerCase().trim();
        let sName = staffName.toLowerCase().trim();
        let nName = nickname.toLowerCase().trim();
        if (aName === sName || aName === nName) return true;
        if (sName.includes(aName) && aName.length >= 3) return true;
        return false;
    };

    onSnapshot(query(collection(db, "shift_swaps"), where("status", "==", "Pending")), (snap) => {
        
        // 🔥 DYNAMIC UI INJECTOR: Ensure the container exists and doesn't get wiped!
        let container = document.getElementById('incomingSwapsContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'incomingSwapsContainer';
            container.style.cssText = "display: none; padding: 0 15px; margin-bottom: 15px; text-align: left;";
            
            // Insert it safely outside the scheduleContainer so it survives refreshes!
            let viewSched = document.getElementById('view-schedule');
            let monthPicker = document.getElementById('staffMonthPicker');
            if (monthPicker) {
                monthPicker.parentElement.insertAdjacentElement('afterend', container);
            } else if (viewSched) {
                viewSched.insertBefore(container, document.getElementById('scheduleContainer'));
            }
        }

        let badge = document.getElementById('navSchedBadge');
        let myPendingSwaps = [];
        
        snap.forEach(docSnap => {
            let d = docSnap.data();
            // Did this request use my short name OR my full name?
            if (isMatch(d.targetName)) {
                myPendingSwaps.push({ id: docSnap.id, ...d });
            }
        });

        if (myPendingSwaps.length === 0) {
            container.style.display = 'none';
            if(badge) badge.style.display = 'none';
            return;
        }

        if(badge) badge.style.display = 'inline-block';

        let html = '<h3 style="color: #ea580c; margin-top:0; font-size:15px; border-bottom: 2px dashed #fcd34d; padding-bottom: 8px;">🔄 Shift Swap Requests</h3>';
        
        myPendingSwaps.forEach(d => {
            html += `
                <div style="background: #fffbeb; border: 1px solid #fcd34d; padding: 15px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="font-size: 13px; color: #b45309; margin-bottom: 12px; line-height: 1.5;">
                        <strong style="color: #92400e; font-size: 14px;">${d.requesterName}</strong> wants to swap shifts on <strong style="color: #92400e;">${d.dateStr}</strong>.<br>
                        They will take your <b>${d.targetShiftName}</b>, and you will take their <b>${d.requesterShiftName}</b>.
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button onclick="window.handleIncomingSwap('${d.id}', 'Approved')" style="flex:1; background: #16a34a; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);">✅ Accept</button>
                        <button onclick="window.handleIncomingSwap('${d.id}', 'Rejected')" style="flex:1; background: #ef4444; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);">❌ Reject</button>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        container.style.display = 'block';
    });
};

window.handleIncomingSwap = async function(swapId, action) {
    if (!confirm(`Are you sure you want to ${action.toUpperCase()} this swap?`)) return;

    Swal.fire({title: 'Processing...', allowOutsideClick: false, didOpen: ()=>Swal.showLoading()});

    try {
        if (action === "Rejected") {
            await updateDoc(doc(db, "shift_swaps", swapId), { status: "Rejected" });
            Swal.fire({title: 'Rejected', text: 'The request was declined.', icon: 'info', customClass: { popup: 'rounded-2xl' }});
            return;
        }

        // 🔥 IF APPROVED: WE DO THE COMPLEX CALENDAR MATH!
        const swapSnap = await getDoc(doc(db, "shift_swaps", swapId));
        let sData = swapSnap.data();

        const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
        let globalSched = schedSnap.data();

        let dayData = globalSched.currentSchedule[sData.dayIndex][sData.branch];

        let isMatch = (dbName, reqName) => {
            if (!dbName || !reqName) return false;
            let a = dbName.toLowerCase().trim();
            let b = reqName.toLowerCase().trim();
            if (a === b) return true;
            if (a.includes(b) && b.length >= 3) return true;
            if (b.includes(a) && a.length >= 3) return true;
            return false;
        };

        // 1. Safety check: Find the EXACT names currently sitting in the schedule slots
        let rActual = dayData.scheduled[sData.requesterShiftId];
        let tActual = sData.targetShiftId === 'STANDBY' ? 
                      (dayData.rest.find(n => isMatch(n, sData.targetName)) || null) : 
                      dayData.scheduled[sData.targetShiftId];

        // If either one of them isn't where they said they were, the schedule changed. Abort!
        if (!isMatch(rActual, sData.requesterName) || !isMatch(tActual, sData.targetName)) {
            await updateDoc(doc(db, "shift_swaps", swapId), { status: "Failed - Schedule Changed" });
            return Swal.fire('Error', 'The Master Schedule has changed since this request was made. Swap cancelled.', 'error');
        }

        // 🔥 THE FIX: Create the paper trail object so the Cashier App knows a trade happened!
        if (!dayData.swaps) dayData.swaps = {};

        // 2. Perform the Swap mathematically!
        // A. Give Target's shift to Requester
        if (sData.targetShiftId === 'STANDBY') {
            dayData.rest = dayData.rest.filter(n => n !== tActual); // Remove target from rest
            dayData.rest.push(rActual); // Put requester in rest
        } else {
            dayData.scheduled[sData.targetShiftId] = rActual;
            // Log the trade!
            dayData.swaps[sData.targetShiftId] = { originalStaff: tActual, newStaff: rActual };
        }

        // B. Give Requester's shift to Target
        dayData.scheduled[sData.requesterShiftId] = tActual;
        // Log the trade!
        dayData.swaps[sData.requesterShiftId] = { originalStaff: rActual, newStaff: tActual };

        // 3. Save the new calendar back to Cloud
        await updateDoc(doc(db, "settings", "global_schedule"), {
            currentSchedule: globalSched.currentSchedule
        });

        // 4. Update the Swap Status
        await updateDoc(doc(db, "shift_swaps", swapId), { status: "Approved" });

        Swal.fire({title: '✅ Swapped!', text: 'Your schedule has been successfully updated.', icon: 'success', customClass: { popup: 'rounded-2xl' }});
        
        // Close the modal before reloading so it doesn't get stuck!
        let swapModal = document.getElementById('swapRequestModal');
        if (swapModal) swapModal.style.display = 'none';

        window.loadStaffSchedule(); // Visually refresh their screen!

    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to process swap.', 'error');
    }
};

// ==========================================
// 🖨️ UNIVERSAL HR DOCUMENT PRINTER (STAFF APP)
// ==========================================
window.reprintContract = function(type, encodedData, signDate) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    let printWin = window.open('', '', 'width=850,height=900');
    printWin.document.write(window.getContractPrintHTML(type, data, signDate));
};

window.getContractPrintHTML = function(type, data, signDate) {
    let title = ""; let content = "";
    let logoUrl = window.location.origin + '/payslip%20logo.jpg';
    
    if (type === 'Initial') {
        title = "Employment Contract";
        content = `
            <p><b>1. POSITION AND COMMENCEMENT</b><br>The Employer hereby employs the Employee as a <b>${data.role}</b>. Employment shall commence on <b>${data.dateHired || signDate}</b> and shall be valid for a period of six (6) months.</p>
            <p><b>2. WORK SCHEDULE AND COMPENSATION</b><br>The Employee shall receive a daily basic salary of <b>₱${(data.hourlyRate * 8).toFixed(2)}</b>. Entitled to one (1) day off per week.</p>
            <p><b>3. ATTENDANCE AND ABSENCES POLICY</b><br>Unexcused absences and tardiness are subject to progressive disciplinary action (Verbal Warning, Written Warning, Suspension, Termination).</p>
            <p><b>4. CONFIDENTIALITY AGREEMENT</b><br>Strict maintenance of proprietary recipes under penalty of <b>₱1,000,000.00</b> for breaches.</p>
            <p><b>5. HEALTH DECLARATION</b><br>Employee affirms physical fitness for a food-handling environment.</p>
            <p><b>6. NOTICE OF RESIGNATION</b><br>Mandatory 30-day notice prior to voluntary resignation.</p>
            <p><b>7. COMPANY UNIFORM AND PROPERTY</b><br>Obligation to care for and return provided items to avoid payroll deductions.</p>
        `;
    } else if (type === 'Extension') {
        title = "Contract Renewal & Extension";
        let contractEnd = new Date(signDate); contractEnd.setMonth(contractEnd.getMonth() + 6);
        content = `
            <p><b>1. EXTENSION OF EMPLOYMENT</b><br>Employment is extended as <b>${data.role}</b> for an additional six (6) months from <b>${signDate}</b> to <b>${contractEnd.toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})}</b>. This is the final probationary phase.</p>
            <p><b>2. COMPENSATION</b><br>Daily basic salary remains <b>₱${(data.hourlyRate * 8).toFixed(2)}</b>.</p>
            <p><b>3. REAFFIRMATION OF TERMS</b><br>All original policies (Attendance, ₱1M Confidentiality penalty, 30-Day Notice) remain in full force.</p>
            <p><b>4. PATHWAY TO REGULARIZATION</b><br>Upon successful completion, the Employee may be offered a regularized contract.</p>
        `;
    } else if (type === 'Regularization') {
        title = "Regularization of Employment";
        content = `
            <p><b>1. REGULARIZATION</b><br>Effective <b>${signDate}</b>, the Employer hereby grants the Employee <b>REGULAR (PERMANENT)</b> employment status.</p>
            <p><b>2. COMPENSATION</b><br>Daily basic salary of <b>₱${(data.hourlyRate * 8).toFixed(2)}</b>.</p>
            <p><b>3. REAFFIRMATION OF TERMS</b><br>All original policies (Attendance, ₱1M Confidentiality penalty, 30-Day Notice) remain in full force.</p>
            <p><b>4. TERMINATION</b><br>Employment may only be terminated for just or authorized causes as provided by the Philippine Labor Code.</p>
        `;
    }

    return `
        <html><head><title>${title} - ${data.cashierName}</title></head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: 0 auto; line-height: 1.6; position: relative;">
            <img src="${logoUrl}" style="position: absolute; left: 40px; top: 30px; width: 100px; height: 100px; object-fit: contain;">
            <div style="text-align: center; margin-bottom: 30px; padding-top: 10px;">
                <h1 style="margin: 0; font-size: 38px; letter-spacing: 2px; color: #0f172a;">TAKODEÁL</h1>
                <p style="margin: 0; color: #64748b; font-size: 14px; text-transform: uppercase;">Davao City, Philippines</p>
            </div>
            <hr style="border: none; border-top: 3px solid #0f172a; margin-bottom: 40px;">
            <h2 style="text-align: center; color: #b45309; text-transform: uppercase;">${title}</h2>
            <p>This Agreement is executed on <b>${signDate}</b> between <b>TAKODEAL TAKOYAKI FOODCART</b> ("Employer") and <b>${data.cashierName.toUpperCase()}</b> ("Employee").</p>
            ${content}
            <div style="margin-top: 80px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
                <div>
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px;"><b>${data.cashierName.toUpperCase()}</b></div>
                    <span style="font-size: 14px; color: #64748b;">Employee Signature / Digitally Accepted</span>
                </div>
                <div>
                    <div style="border-bottom: 1px solid #1e293b; margin-bottom: 5px;"><b>Chery Ann R. Fonda</b></div>
                    <span style="font-size: 14px; color: #64748b;">CEO, Founder & General Manager</span>
                </div>
            </div>
            <script>setTimeout(() => { window.print(); window.close(); }, 1500);</script>
        </body></html>
    `;
};

// ========================================================
// 📅 DYNAMIC SCHEDULE IMAGE NOTIFICATION ENGINE
// ========================================================

if (typeof window.originalViewAnnouncement === 'undefined') {
    window.originalViewAnnouncement = window.viewAnnouncement;
}

window.viewAnnouncement = async function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    
    // Quick fetch to check if it has the secret "isSchedule" flag!
    let isSchedule = false;
    try {
        const docSnap = await window.getDoc(window.doc(window.db, "announcements", data.id));
        if (docSnap.exists() && docSnap.data().isSchedule) {
            isSchedule = true;
        }
    } catch(e) {}

    // 🔥 THE NEW SCHEDULE IMAGE POPUP ENGINE 🔥
    if (isSchedule) {
        let imgUrl = data.images && data.images.length > 0 ? data.images[0] : '';
        
        let ackBtnHtml = data.hasSignature 
            ? `<div style="width: 100%; background: #dcfce7; color: #16a34a; padding: 15px; border-radius: 8px; font-weight: 900; font-size: 16px; text-align: center; border: 2px solid #bbf7d0;">✅ You acknowledged this schedule on ${data.signatureDate}</div>`
            : `<button onclick="window.submitScheduleAck('${data.id}')" id="btnAckSched" style="width: 100%; background: #10b981; color: white; border: none; padding: 15px; border-radius: 8px; font-weight: 900; font-size: 18px; cursor: pointer; box-shadow: 0 4px 6px rgba(16, 163, 74, 0.3);">✅ I ACKNOWLEDGE MY SHIFTS</button>`;

        let modalHtml = `
            <div id="schedulePopupOverlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 100000; display: flex; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(5px);">
                <div style="background: white; padding: 15px; border-radius: 12px; width: 95vw; max-width: 700px; max-height: 95vh; display: flex; flex-direction: column; align-items: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                    <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 10px;">
                        <h2 style="margin: 0; color: #0f172a; text-transform: uppercase; font-size: 18px;">📅 New Schedule Posted</h2>
                        ${data.hasSignature ? `<button onclick="document.getElementById('schedulePopupOverlay').remove()" style="background: #ef4444; color: white; border: none; width: 30px; height: 30px; border-radius: 6px; font-weight: bold; cursor: pointer;">✖</button>` : ''}
                    </div>
                    <div style="flex: 1; overflow-y: auto; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 15px; background: #f8fafc;">
                        <img src="${imgUrl}" style="width: 100%; height: auto; display: block;">
                    </div>
                    ${ackBtnHtml}
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        return; // Intercepts and stops the normal Bulletin Board from opening!
    }

    // If it's a normal memo announcement, run the standard code!
    window.originalViewAnnouncement(encodedData);
};

window.submitScheduleAck = async function(announcementId) {
    let btn = document.getElementById('btnAckSched');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    let cashierName = localStorage.getItem('cashierName') || localStorage.getItem('takodeal_staff_name') || 'Staff';

    // A visual trick so the Manager App sees a text graphic instead of a broken signature image!
    let quickSigImg = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='50'%3E%3Ctext x='10' y='30' font-family='Arial' font-size='18' font-weight='bold' fill='%2316a34a'%3E%E2%9C%85 1-Click Acknowledged%3C/text%3E%3C/svg%3E";

    try {
        await window.addDoc(window.collection(window.db, "acknowledgments"), {
            announcementId: announcementId,
            staffName: cashierName,
            signature: quickSigImg,
            timestamp: window.serverTimestamp()
        });

        document.getElementById('schedulePopupOverlay').remove();
        
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Schedule Acknowledged!', 
            showConfirmButton: false, timer: 2500
        });

        // If there's another unread announcement in the queue, automatically show it!
        if (typeof window.currentBulletinIndex !== 'undefined' && window.activeAnnouncements) {
            window.currentBulletinIndex++;
            if (window.currentBulletinIndex < window.activeAnnouncements.length) {
                let nextData = window.activeAnnouncements[window.currentBulletinIndex];
                let encoded = encodeURIComponent(JSON.stringify(nextData));
                window.viewAnnouncement(encoded);
            } else {
                window.hasAutoShownBulletin = true;
            }
        }

        // Refresh the backend lists
        if (typeof window.loadBulletinHistory === 'function') window.loadBulletinHistory();
        if (typeof window.loadAnnouncements === 'function') window.loadAnnouncements();

    } catch (e) {
        console.error("Ack Error:", e);
        Swal.fire("Error", "Failed to acknowledge schedule.", "error");
        btn.innerText = "✅ I ACKNOWLEDGE MY SHIFTS"; btn.disabled = false;
    }
};

// ========================================================
// 🚨 STAFF APP: HR SANCTION INTERCEPTOR & SIGNATURE ENGINE
// ========================================================
window.hasSignedStaffNTE = false;

window.initStaffAppSignaturePad = function() {
    const canvas = document.getElementById('staffAppSignatureCanvas');
    if (!canvas) return;
    
    // Sync resolution to device width for perfect tracking on phones
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    window.hasSignedStaffNTE = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    const startDraw = (e) => { 
        isDrawing = true; window.hasSignedStaffNTE = true; 
        const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault(); 
    };
    const draw = (e) => { 
        if (!isDrawing) return; 
        const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); e.preventDefault(); 
    };
    const stopDraw = () => { isDrawing = false; ctx.closePath(); };

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
};

window.clearStaffAppSignature = function() {
    const canvas = document.getElementById('staffAppSignatureCanvas');
    if (canvas) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        window.hasSignedStaffNTE = false;
    }
};

window.checkActiveSanctions = async function(staffName) {
    if (!staffName) return;
    
    try {
        // Query Firebase for unresolved sanctions for this specific user
        const q = query(collection(db, "hr_sanctions"), where("staffName", "==", staffName), where("status", "==", "Pending Reply"));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            let sanction = snap.docs[0].data();
            let sanctionId = snap.docs[0].id;

            // Inject the details into the lockdown modal
            document.getElementById('activeSanctionId').value = sanctionId;
            document.getElementById('sanctionLockType').innerText = sanction.type || "Violation";
            document.getElementById('sanctionLockSeverity').innerText = sanction.severity || "Warning";
            document.getElementById('sanctionLockDetails').innerText = sanction.details || "No details provided.";
            document.getElementById('sanctionStaffReply').value = ""; 

            // Show the unbreakable overlay
            document.getElementById('staffAppSanctionModal').style.display = 'flex';
            
            // Wake up the signature pad
            setTimeout(() => { window.initStaffAppSignaturePad(); }, 300);
        }
    } catch (e) { console.error("Error checking sanctions:", e); }
};

window.submitStaffAppSanctionReply = async function() {
    let sanctionId = document.getElementById('activeSanctionId').value;
    let replyText = document.getElementById('sanctionStaffReply').value.trim();

    if (!replyText || replyText.length < 15) {
        Swal.fire('Explanation Too Short', 'You must provide a detailed written explanation (at least 15 characters) before unlocking the app.', 'warning');
        return;
    }

    if (!window.hasSignedStaffNTE) {
        Swal.fire('Signature Required', 'Please sign inside the signature box using your finger to legally acknowledge this notice.', 'error');
        return;
    }

    let btn = document.getElementById('btnSubmitAppSanction');
    btn.innerText = "⏳ Submitting to HQ..."; btn.disabled = true;

    try {
        const canvas = document.getElementById('staffAppSignatureCanvas');
        const signatureDataUrl = canvas.toDataURL('image/png');

        await updateDoc(doc(db, "hr_sanctions", sanctionId), {
            staffReply: replyText,
            signatureBase64: signatureDataUrl, 
            status: "Replied",
            repliedAt: serverTimestamp()
        });

        Swal.fire({
            title: '✅ Notice Acknowledged', 
            text: 'Your explanation and signature have been securely logged to HQ. Your app is now unlocked.', 
            icon: 'success', 
            customClass: { popup: 'rounded-2xl' }
        });
        
        document.getElementById('staffAppSanctionModal').style.display = 'none';

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to submit. Check internet connection.', 'error');
    } finally {
        btn.innerText = "Submit & Unlock App"; btn.disabled = false;
    }
};

// ========================================================
// 🚨 STAFF APP: SANCTION WATCHDOG ENGINE
// ========================================================
window.isCheckingSanction = false;

// This watchdog wakes up every 5 seconds and scans the cloud
setInterval(() => {
    // Grab the name depending on what your Staff App uses to store the login
    let staffName = localStorage.getItem('staffName') || localStorage.getItem('cashierName');
    let sanctionModal = document.getElementById('staffAppSanctionModal');
    
    // If they are logged in, and the modal isn't already showing
    if (staffName && sanctionModal && sanctionModal.style.display === 'none') {
        if (!window.isCheckingSanction) {
            window.isCheckingSanction = true;
            
            // Check Firebase for active NTEs
            window.checkActiveSanctions(staffName).finally(() => {
                // Unlock the checker after 5 seconds so it can scan again
                setTimeout(() => { window.isCheckingSanction = false; }, 5000); 
            });
        }
    }
}, 5000);

// ========================================================
// ⚖️ STAFF APP: SANCTION HISTORY VIEWER
// ========================================================
window.loadMySanctionsHistory = async function() {
    // Show the container
    document.getElementById('staffSanctionsHistorySection').style.display = 'block';
    
    let container = document.getElementById('mySanctionsList');
    let staffName = localStorage.getItem('takodeal_staff_name') || localStorage.getItem('cashierName');
    
    if (!staffName) {
        container.innerHTML = '<div style="text-align:center; color:#dc2626; font-weight:bold;">Error: Not logged in.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; color:#64748b; font-weight:bold; padding: 20px;">⏳ Fetching your records from HQ...</div>';

    try {
        const q = window.query(
            window.collection(window.db, "hr_sanctions"), 
            window.where("staffName", "==", staffName)
        );
        const snap = await window.getDocs(q);

        let records = [];
        snap.forEach(doc => records.push({ id: doc.id, ...doc.data() }));

        // Sort newest first
        records.sort((a,b) => {
            let tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime()) : 0;
            let tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime()) : 0;
            return tB - tA;
        });

        let html = '';
        records.forEach(d => {
            let dateStr = d.timestamp ? (d.timestamp.toDate ? d.timestamp.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : new Date(d.timestamp).toLocaleDateString()) : 'Unknown Date';
            
            let statusBadge = '';
            if (d.status === 'Pending Reply') {
                statusBadge = `<span style="background: #fef2f2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; border: 1px solid #fca5a5;">⚠️ Action Required</span>`;
            } else if (d.status === 'Resolved') {
                statusBadge = `<span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; border: 1px solid #bbf7d0;">✅ Resolved</span>`;
            } else {
                statusBadge = `<span style="background: #e0f2fe; color: #0284c7; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; border: 1px solid #bae6fd;">📩 Sent to HQ</span>`;
            }

            let replyHtml = '';
            if (d.staffReply) {
                replyHtml = `
                    <div style="margin-top: 10px; padding: 10px; background: white; border-radius: 6px; border: 1px dashed #cbd5e1;">
                        <span style="font-size: 11px; font-weight: bold; color: #64748b;">YOUR EXPLANATION:</span>
                        <div style="font-size: 13px; color: #334155; font-style: italic; margin-top: 4px;">"${d.staffReply}"</div>
                    </div>
                `;
            }

            html += `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div>
                            <strong style="color: #b91c1c; font-size: 15px; display: block;">${d.type}</strong>
                            <span style="font-size: 11px; color: #64748b;">Issued: ${dateStr}</span>
                        </div>
                        ${statusBadge}
                    </div>
                    
                    <div style="font-size: 13px; font-weight: bold; color: #ea580c; margin-bottom: 8px;">Penalty: ${d.severity}</div>
                    
                    <div style="font-size: 13px; color: #334155; background: white; padding: 10px; border-radius: 6px; border-left: 3px solid #dc2626;">
                        <span style="font-size: 11px; font-weight: bold; color: #dc2626; display: block; margin-bottom: 4px;">HQ REPORT:</span>
                        ${d.details}
                    </div>
                    
                    ${replyHtml}
                </div>
            `;
        });

        container.innerHTML = html || '<div style="text-align:center; color:#16a34a; font-weight:bold; padding: 20px;">🎉 Clean Record! You have no sanctions or notices.</div>';

    } catch (e) {
        console.error("Sanctions History Error:", e);
        container.innerHTML = '<div style="text-align:center; color:#dc2626; font-weight:bold;">❌ Failed to load records.</div>';
    }
};
