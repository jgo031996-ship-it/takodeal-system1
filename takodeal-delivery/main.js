// ========================================================
// 🔥 FIREBASE ENGINE
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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

window.currentRider = null;
window.gpsInterval = null;
window.activePingId = null;
window.pingCountdown = null;

// ==========================================
// 📝 REGISTRATION & LOGIN
// ==========================================
window.registerRider = async function() {
    let name = document.getElementById('regName').value.trim();
    let phone = document.getElementById('regPhone').value.trim();
    let vehicle = document.getElementById('regVehicle').value.trim();
    let pin = document.getElementById('regPin').value.trim();
    let licenseFile = document.getElementById('regLicense').files[0];
    let selfieFile = document.getElementById('regSelfie').files[0];

    if (!name || !phone || !vehicle || !pin || !licenseFile || !selfieFile) {
        return Swal.fire('Incomplete', 'Please fill all fields and upload both photos.', 'warning');
    }

    Swal.fire({title: 'Uploading Documents...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

    try {
        // Upload License
        const licRef = ref(storage, `riders/licenses/${phone}_${Date.now()}`);
        const licSnap = await uploadBytes(licRef, licenseFile);
        const licUrl = await getDownloadURL(licSnap.ref);

        // Upload Selfie (Used to show the customer)
        const selfRef = ref(storage, `riders/selfies/${phone}_${Date.now()}`);
        const selfSnap = await uploadBytes(selfRef, selfieFile);
        const selfUrl = await getDownloadURL(selfSnap.ref);

        // Save to Database
        await addDoc(collection(db, "riders"), {
            name: name,
            phone: phone,
            vehicle: vehicle,
            pin: pin,
            licenseUrl: licUrl,
            selfieUrl: selfUrl,
            status: "pending_approval", // HQ must approve them first!
            walletBalance: 0,
            rating: 5.0,
            totalDeliveries: 0,
            joinedAt: serverTimestamp()
        });

        Swal.fire('Application Sent!', 'Your profile is under review by HQ. You will be able to log in once approved.', 'success').then(() => {
            document.getElementById('registerView').style.display = 'none';
            document.getElementById('loginView').style.display = 'block';
        });

    } catch (e) { console.error(e); Swal.fire('Error', 'Registration failed.', 'error'); }
};

window.loginRider = async function() {
    let phone = document.getElementById('loginPhone').value.trim();
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

// Start the engine
startDispatchListener();
