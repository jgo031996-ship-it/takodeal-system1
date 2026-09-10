// ========================================================
// 🔥 FIREBASE ENGINE
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// 🔥 NEW: Import the Auth module for Silent Login
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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
const auth = getAuth(app);

// 🔥 SILENT AUTHENTICATION: This satisfies Firebase Security Rules 
// so riders can upload their license and selfie without Google Sign-In!
signInAnonymously(auth).catch((error) => {
    console.error("Silent Auth Failed:", error.message);
});

window.currentRider = null;
window.gpsInterval = null;
window.activePingId = null;
window.pingCountdown = null;

// ==========================================
// 📝 REGISTRATION & LOGIN
// ==========================================
window.registerRider = async function() {
    let name = document.getElementById('regName').value.trim();
    let phone = document.getElementById('regPhone').value.replace(/[^0-9]/g, '');
    let vehicle = document.getElementById('regVehicle').value.trim();
    let plate = document.getElementById('regPlate').value.trim();
    let pin = document.getElementById('regPin').value.trim();
    let licenseFile = document.getElementById('regLicense').files[0];
    let orcrFile = document.getElementById('regORCR').files[0];
    let selfieFile = document.getElementById('regSelfie').files[0];

    if (!name || !phone || !vehicle || !plate || !pin || !licenseFile || !orcrFile || !selfieFile) {
        return Swal.fire('Incomplete', 'Please fill all fields and upload all required documents.', 'warning');
    }

    Swal.fire({title: 'Uploading Documents...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        const licSnap = await uploadBytes(ref(storage, `riders/licenses/${phone}_${Date.now()}`), licenseFile);
        const licUrl = await getDownloadURL(licSnap.ref);

        const orcrSnap = await uploadBytes(ref(storage, `riders/orcr/${phone}_${Date.now()}`), orcrFile);
        const orcrUrl = await getDownloadURL(orcrSnap.ref);

        const selfSnap = await uploadBytes(ref(storage, `riders/selfies/${phone}_${Date.now()}`), selfieFile);
        const selfUrl = await getDownloadURL(selfSnap.ref);

        await addDoc(collection(db, "riders"), {
            name: name, phone: phone, vehicle: vehicle, plateNumber: plate.toUpperCase(), pin: pin,
            licenseUrl: licUrl, orcrUrl: orcrUrl, selfieUrl: selfUrl,
            status: "pending_approval", walletBalance: 0, rating: 5.0, totalDeliveries: 0, joinedAt: serverTimestamp()
        });

        Swal.fire('Application Sent!', 'HQ is reviewing your documents. You will be able to log in once approved.', 'success').then(() => {
            document.getElementById('registerView').style.display = 'none';
            document.getElementById('loginView').style.display = 'block';
        });
    } catch (e) { console.error(e); Swal.fire('Error', 'Registration failed.', 'error'); }
};

window.requestTopUp = async function() {
    const { value: formValues } = await Swal.fire({
        title: 'Wallet Top-Up',
        html: `
            <div style="font-size: 14px; color: #475569; margin-bottom: 20px; line-height: 1.4;">
                Send your GCash payment to HQ, then enter the Reference Number and upload the screenshot below.
            </div>
            <div style="text-align: left;">
                <label style="font-size: 12px; font-weight: bold; color: #0ea5e9;">GCash Ref No. (Required)</label>
                <input type="text" id="topupRef" class="swal2-input" placeholder="e.g. 123456789" style="width: 100%; box-sizing: border-box; margin: 5px 0 15px 0;">
                
                <label style="font-size: 12px; font-weight: bold; color: #0ea5e9;">Upload Screenshot (Required)</label>
                <input type="file" id="topupProof" class="swal2-file" accept="image/*" style="width: 100%; box-sizing: border-box; margin: 5px 0 0 0; display: block; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: white;">
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Submit Proof',
        confirmButtonColor: '#0ea5e9',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        preConfirm: () => {
            // Grab the values right before the user submits
            let refInput = document.getElementById('topupRef').value.trim();
            let fileInput = document.getElementById('topupProof').files[0];
            
            if (!refInput) {
                Swal.showValidationMessage('Please enter the GCash Reference Number.');
                return false;
            }
            if (!fileInput) {
                Swal.showValidationMessage('Please upload the GCash screenshot.');
                return false;
            }
            
            return { reference: refInput, file: fileInput };
        }
    });

    // If the user successfully filled out the form and clicked Submit
    if (formValues) {
        Swal.fire({title: 'Uploading Proof...', text: 'Please wait...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        
        try {
            // 1. Upload the image to Firebase Storage securely
            let file = formValues.file;
            let fileExt = file.name.split('.').pop();
            const storageRef = ref(storage, `riders/topups/${window.currentRider.phone}_${Date.now()}.${fileExt}`);
            const snapshot = await uploadBytes(storageRef, file);
            const photoUrl = await getDownloadURL(snapshot.ref);

            // 2. Save the request to the database with the photo URL
            await addDoc(collection(db, "rider_topups"), {
                riderId: window.currentRider.id,
                riderName: window.currentRider.name,
                reference: formValues.reference,
                proofUrl: photoUrl,
                status: "pending",
                timestamp: serverTimestamp()
            });

            Swal.fire({
                title: 'Sent!', 
                text: 'HQ will verify the screenshot and credit your wallet shortly.', 
                icon: 'success', 
                customClass: { popup: 'rounded-2xl' }
            });
        } catch (error) {
            console.error("Top-Up Error:", error);
            Swal.fire('Error', 'Failed to submit top-up request. Please check your connection.', 'error');
        }
    }
};

window.loginRider = async function() {
    let phone = document.getElementById('loginPhone').value.replace(/[^0-9]/g, '');
    let pin = document.getElementById('loginPin').value.trim();

    if (!phone || !pin) return Swal.fire('Error', 'Enter phone and PIN.', 'error');
    Swal.fire({title: 'Authenticating...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        const q = query(collection(db, "riders"), where("phone", "==", phone), where("pin", "==", pin));
        const snap = await getDocs(q);

        if (snap.empty) {
            return Swal.fire('Access Denied', 'Incorrect phone number or PIN.', 'error');
        }

        let rider = { id: snap.docs[0].id, ...snap.docs[0].data() };

        if (rider.status === "pending_approval") {
            return Swal.fire('Account Pending', 'Your account is still being reviewed by HQ.', 'info');
        }

        if (rider.status === "banned") {
            return Swal.fire('Account Suspended', 'Please contact management.', 'error');
        }

        // Login Success
        window.currentRider = rider;
        document.getElementById('authOverlay').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        
        document.getElementById('profileName').innerText = rider.name;
        document.getElementById('profileWallet').innerText = (rider.walletBalance || 0).toFixed(2);
        
        Swal.close();
        window.startLiveGPS(); // Start broadcasting location
        window.listenForPings(); // Listen for incoming orders

    } catch (e) { console.error(e); Swal.fire('Error', 'Login failed.', 'error'); }
};

// ==========================================
// 📍 LIVE GPS BROADCASTING
// ==========================================
window.startLiveGPS = function() {
    if (!navigator.geolocation) return alert("GPS not supported.");

    // Update location every 15 seconds
    window.gpsInterval = setInterval(() => {
        if (document.getElementById('statusToggle').innerText !== "ONLINE") return;

        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                await updateDoc(doc(db, "riders", window.currentRider.id), {
                    lastLat: pos.coords.latitude,
                    lastLng: pos.coords.longitude,
                    lastActive: serverTimestamp()
                });
            } catch(e) { console.error("GPS Sync Error", e); }
        }, (err) => console.log(err), { enableHighAccuracy: true });
    }, 15000);
};

window.toggleRiderStatus = async function() {
    let btn = document.getElementById('statusToggle');
    let isOnline = btn.innerText === "ONLINE";
    
    if (isOnline) {
        btn.innerText = "OFFLINE";
        btn.style.background = "#ef4444";
    } else {
        btn.innerText = "ONLINE";
        btn.style.background = "#10b981";
    }

    try {
        await updateDoc(doc(db, "riders", window.currentRider.id), {
            isAcceptingOrders: !isOnline
        });
    } catch(e) {}
};

// ========================================================
// 📡 LIVE DISPATCH LISTENER
// ========================================================
function startDispatchListener() {
    // For now, we will pull all "ready" orders. Later we can filter by specific branches.
    const q = query(
        collection(db, "incoming_orders"), 
        where("status", "in", ["ready", "out_for_delivery"])
    );

    onSnapshot(q, (snapshot) => {
        window.activeDeliveries = [];
        snapshot.forEach((doc) => {
            window.activeDeliveries.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort: Out for Delivery at the top, newer Ready orders below
        window.activeDeliveries.sort((a, b) => {
            if (a.status === "out_for_delivery" && b.status !== "out_for_delivery") return -1;
            if (a.status !== "out_for_delivery" && b.status === "out_for_delivery") return 1;
            return 0;
        });

        renderDispatchBoard();
    });
}

// ========================================================
// 🛵 RENDER DISPATCH BOARD
// ========================================================
function renderDispatchBoard() {
    const board = document.getElementById('dispatchBoard');
    
    if (window.activeDeliveries.length === 0) {
        board.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 40px; font-weight: bold;">No pending deliveries.</div>`;
        return;
    }

    let html = '';
    window.activeDeliveries.forEach(order => {
        let orderCode = order.orderCode || order.id;
        let customerName = (order.customerName || 'Guest').split('(')[0].trim();
        let address = order.deliveryAddress || "Address not provided";
        let mapQuery = encodeURIComponent(address);
        
        // Action Button Logic
        let actionBtn = '';
        if (order.status === "ready") {
            actionBtn = `<button class="btn-action" style="background: #f59e0b;" onclick="window.claimDelivery('${order.id}')">Claim Delivery</button>`;
        } else if (order.status === "out_for_delivery") {
            actionBtn = `<button class="btn-action" style="background: #10b981;" onclick="window.completeDelivery('${order.id}')">✅ Mark Delivered</button>`;
        }

        html += `
            <div class="order-card">
                <div class="order-header">
                    <span class="order-id">${orderCode}</span>
                    <span class="order-total">₱${(order.totalAmount || 0).toFixed(2)}</span>
                </div>
                
                <div class="customer-info">
                    <span class="customer-name">👤 ${customerName}</span>
                    <div style="color: #94a3b8; margin-top: 5px;">📞 ${order.contactNumber || 'No number'}</div>
                    <div style="margin-top: 10px; color: #e2e8f0;">📍 ${address}</div>
                </div>

                <a href="https://www.google.com/maps/search/?api=1&query=${mapQuery}" target="_blank" style="text-decoration: none;">
                    <button class="btn-map">🗺️ Open in Google Maps</button>
                </a>
                
                ${actionBtn}
            </div>
        `;
    });

    board.innerHTML = html;
}

// ========================================================
// 🛠️ RIDER ACTIONS
// ========================================================
window.claimDelivery = async function(orderId) {
    // In the future, we will stamp this with the Rider's actual name
    try {
        await updateDoc(doc(db, "incoming_orders", orderId), {
            status: "out_for_delivery",
            riderClaimedAt: serverTimestamp(),
            riderName: "TAKODEÁL Rider" 
        });
        Swal.fire({toast: true, position: 'top', icon: 'success', title: 'Delivery Claimed!', showConfirmButton: false, timer: 1500});
    } catch(e) { console.error("Error claiming:", e); }
};

window.completeDelivery = async function(orderId) {
    // This perfectly triggers your POS History tab to update!
    if(!confirm("Are you sure this order has been successfully delivered and paid?")) return;

    try {
        await updateDoc(doc(db, "incoming_orders", orderId), {
            status: "completed",
            deliveredAt: serverTimestamp()
        });
        Swal.fire('Delivered!', 'Great job. The order has been marked complete.', 'success');
    } catch(e) { console.error("Error completing:", e); }
};

// ==========================================
// 🚨 THE 15-SECOND PING ENGINE
// ==========================================
window.listenForPings = function() {
    if (!window.currentRider) return;

    // Listen specifically for orders targeting THIS rider
    const q = query(collection(db, "incoming_orders"), 
        where("pingedRider", "==", window.currentRider.id), 
        where("status", "==", "looking_for_rider")
    );

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
                let order = change.doc.data();
                window.triggerIncomingPing(change.doc.id, order);
            }
            if (change.type === "removed") {
                // If HQ cancels or reassigns it before the timer runs out
                window.closePingModal();
            }
        });
    });
};

window.triggerIncomingPing = function(orderId, orderData) {
    if (window.activePingId === orderId) return; // Prevent duplicate triggers
    
    window.activePingId = orderId;
    window.currentPingData = orderData;
    
    let modal = document.getElementById('incomingOrderPing');
    document.getElementById('pingDistance').innerText = `₱${(orderData.deliveryFee || 50).toFixed(2)} Fee`;
    document.getElementById('pingStore').innerText = orderData.branch;
    document.getElementById('pingAddress').innerText = orderData.deliveryAddress;
    
    modal.style.display = 'block';
    
    // Play a loud ringing sound!
    let audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.loop = true; audio.play().catch(e => console.log(e));
    window.pingAudio = audio;

    // Start 15 Second Countdown
    let timeLeft = 15;
    let timerEl = document.getElementById('pingTimer');
    timerEl.innerText = `${timeLeft}s`;

    window.pingCountdown = setInterval(() => {
        timeLeft--;
        timerEl.innerText = `${timeLeft}s`;
        if (timeLeft <= 0) {
            window.rejectPing(); // Auto-reject if they ignore it
        }
    }, 1000);
};

window.closePingModal = function() {
    document.getElementById('incomingOrderPing').style.display = 'none';
    if (window.pingCountdown) clearInterval(window.pingCountdown);
    if (window.pingAudio) window.pingAudio.pause();
    window.activePingId = null;
    window.currentPingData = null;
};

// ==========================================
// 📥 ACCEPT OR REJECT
// ==========================================
window.acceptPing = async function() {
    let orderId = window.activePingId;
    let order = window.currentPingData;
    if (!orderId || !order) return;

    // 🛡️ ANTI-THEFT WALLET CHECK
    // If the customer is paying in Cash, the rider MUST have enough in their wallet to cover the food cost!
    let requiresWalletDeduction = (order.paymentMethod || 'Cash').toLowerCase() === 'cash';
    let foodTotal = order.totalAmount || 0;

    if (requiresWalletDeduction && (window.currentRider.walletBalance < foodTotal)) {
        Swal.fire('Insufficient Funds', `Customer is paying cash. You need at least ₱${foodTotal.toFixed(2)} in your digital wallet to accept this. Please Top-Up!`, 'error');
        window.rejectPing(); // Auto-pass to the next rider
        return;
    }

    clearInterval(window.pingCountdown);
    document.getElementById('btnAcceptPing').innerText = "Processing...";

    try {
        let updates = {
            status: "out_for_delivery",
            riderId: window.currentRider.id,
            riderName: window.currentRider.name,
            riderPhone: window.currentRider.phone,
            riderPlate: window.currentRider.plateNumber,
            riderSelfie: window.currentRider.selfieUrl || "",
            acceptedAt: serverTimestamp()
        };

        await updateDoc(doc(db, "incoming_orders", orderId), updates);

        // Deduct Wallet
        if (requiresWalletDeduction) {
            let newBalance = window.currentRider.walletBalance - foodTotal;
            await updateDoc(doc(db, "riders", window.currentRider.id), { walletBalance: newBalance });
            window.currentRider.walletBalance = newBalance;
            document.getElementById('profileWallet').innerText = newBalance.toFixed(2);
        }

        window.closePingModal();
        Swal.fire({toast: true, position: 'top', icon: 'success', title: 'Order Secured!', showConfirmButton: false, timer: 1500});
        
    } catch(e) { console.error(e); }
};

window.rejectPing = async function() {
    let orderId = window.activePingId;
    window.closePingModal();

    if (orderId) {
        try {
            // Push this rider into the declinedBy array and clear the pingedRider so the POS knows to find the next guy!
            const orderRef = doc(db, "incoming_orders", orderId);
            await updateDoc(orderRef, {
                pingedRider: null,
                declinedBy: window.firebase ? window.firebase.firestore.FieldValue.arrayUnion(window.currentRider.id) : [], // If using modular SDK, ensure arrayUnion is imported
            });
        } catch(e) { console.error(e); }
    }
};
