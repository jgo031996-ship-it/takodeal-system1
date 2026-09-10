// ========================================================
// 🔥 FIREBASE ENGINE
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

window.activeDeliveries = [];

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
