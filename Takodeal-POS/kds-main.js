import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

window.kdsCart = [];
window.branchName = localStorage.getItem('takodeal_kds_branch');
window.staffName = localStorage.getItem('takodeal_kds_staff') || 'Kitchen Staff';

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    if (!window.branchName) {
        document.getElementById('setupOverlay').style.display = 'flex';
    } else {
        document.getElementById('setupOverlay').style.display = 'none';
        document.getElementById('displayBranch').innerText = `📍 ${window.branchName} | 👤 ${window.staffName}`;
        loadPrepItems();
    }
    setInterval(() => {
        document.getElementById('clockDisplay').innerText = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
});

window.lockKDS = function() {
    let b = document.getElementById('kdsBranch').value;
    let s = document.getElementById('kdsStaff').value.trim();
    if (!b || !s) { alert("Please enter branch and name."); return; }
    localStorage.setItem('takodeal_kds_branch', b);
    localStorage.setItem('takodeal_kds_staff', s);
    location.reload();
};

window.switchTab = function(tab) {
    // Allows for future expansion into Live Order Tickets!
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tab === 'prep' ? 'tabPrep' : 'tabTickets').classList.add('active');
};

// --- PREP STATION ENGINE ---
async function loadPrepItems() {
    const grid = document.getElementById('prepGrid');
    try {
        // 1. Get Settings
        const configSnap = await getDoc(doc(db, "settings", "global_pos_config"));
        let allowedCats = ["Prepared Batch"];
        if (configSnap.exists() && configSnap.data().kitchenPrepCats) {
            allowedCats = configSnap.data().kitchenPrepCats.map(c => c.trim().toLowerCase());
        }

        // 2. Fetch Inventory
        const q = query(collection(db, "inventory"), where("branch", "==", window.branchName));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(docSnap => {
            let d = docSnap.data();
            let cat = (d.category || "").trim().toLowerCase();
            if (allowedCats.includes(cat) && d.showInPrep !== false) {
                let bUom = d.uom || 'units';
                let pUom = d.purchaseUom || d.purchUom || 'Batch';
                let stock = parseFloat(d.currentStock) || 0;
                // 🔥 THE SMART PHOTO FALLBACK ENGINE
                let imgCircle = d.image 
                    ? `<div style="width: 70px; height: 70px; border-radius: 50%; margin: 0 auto 12px auto; background-image: url('${d.image}'); background-size: cover; background-position: center; border: 3px solid #0ea5e9; box-shadow: 0 4px 10px rgba(0,0,0,0.4);"></div>`
                    : `<div style="width: 70px; height: 70px; border-radius: 50%; margin: 0 auto 12px auto; background-color: #0f172a; border: 3px solid #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);">🥣</div>`;
                
                html += `
                    <div class="prep-card" onclick="addToCart('${docSnap.id}', '${d.name.replace(/'/g, "\\'")}', '${pUom}', '${bUom}')">
                        ${imgCircle}
                        <h3 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 900; color: white; line-height: 1.2;">${d.name}</h3>
                        <span style="background: #0f172a; color: #38bdf8; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #334155;">Shelf: ${stock.toFixed(1)} ${bUom}</span>
                    </div>
                `;
            }
        });
        
        grid.innerHTML = html || '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 50px;">No prep items found. Check HQ Settings.</div>';
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ef4444; padding: 50px;">Failed to load connection to vault.</div>';
    }
}

window.addToCart = async function(invId, name, purchUom, baseUom) {
    const { value: qty } = await Swal.fire({
        title: 'Log Kitchen Batch',
        html: `<div style="color: #64748b; margin-bottom: 10px;">How many <b>${purchUom}s</b> of <b>${name}</b> did you prepare?</div>`,
        input: 'number',
        inputAttributes: { min: 0.1, step: 'any' },
        background: '#1e293b', color: '#f8fafc',
        confirmButtonColor: '#0ea5e9',
        customClass: { popup: 'rounded-2xl' }
    });

    if (!qty) return;

    let existing = window.kdsCart.find(i => i.id === invId);
    if (existing) existing.purchQty += parseFloat(qty);
    else window.kdsCart.push({ id: invId, name: name, purchQty: parseFloat(qty), purchUom: purchUom, baseUom: baseUom });
    
    renderCart();
};

window.renderCart = function() {
    let container = document.getElementById('prepCart');
    if (window.kdsCart.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 50px; font-size: 14px;">Cart is empty.<br>Tap a batch to start.</div>';
        return;
    }

    let html = '';
    window.kdsCart.forEach((item, index) => {
        html += `
            <div class="cart-item">
                <div class="cart-item-info">
                    <strong style="font-size: 14px; color: white;">${item.name}</strong>
                    <span style="color: var(--success); font-weight: 900; font-size: 16px;">+${item.purchQty} ${item.purchUom}</span>
                </div>
                <button onclick="window.kdsCart.splice(${index}, 1); renderCart();" style="background: #450a0a; color: #ef4444; border: 1px solid #7f1d1d; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer;">✖</button>
            </div>
        `;
    });
    container.innerHTML = html;
};

window.submitKitchenPrep = async function() {
    if (window.kdsCart.length === 0) return Swal.fire({title: 'Empty', text: 'Cart is empty.', icon: 'warning', background: '#1e293b', color: '#fff'});

    Swal.fire({ title: 'Logging to Vault...', background: '#1e293b', color: '#fff', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        let missingItems = [];

        for (let item of window.kdsCart) {
            // 1. ADD BATCH YIELD TO INVENTORY
            const invRef = doc(db, "inventory", item.id);
            const invSnap = await getDoc(invRef);
            if (!invSnap.exists()) continue;

            let invData = invSnap.data();
            let convRate = parseFloat(invData.conversionRate) || 1;
            let baseQtyToAdd = item.purchQty * convRate;
            await updateDoc(invRef, { currentStock: (invData.currentStock || 0) + baseQtyToAdd });

            // 2. DEDUCT RAW INGREDIENTS USING BOM
            const bomQ = query(collection(db, "bom"), where("menuItem", "==", item.name));
            const bomSnap = await getDocs(bomQ);

            if (!bomSnap.empty) {
                for (let bomDoc of bomSnap.docs) {
                    let recipe = bomDoc.data();
                    let rawIngredient = recipe.ingredientName;
                    let amountToDeduct = (recipe.qty || 0) * item.purchQty;

                    const rawQ = query(collection(db, "inventory"), where("branch", "==", window.branchName), where("name", "==", rawIngredient));
                    const rawSnap = await getDocs(rawQ);

                    if (!rawSnap.empty) {
                        let rawRef = rawSnap.docs[0].ref;
                        await updateDoc(rawRef, { currentStock: (rawSnap.docs[0].data().currentStock || 0) - amountToDeduct });
                    } else {
                        missingItems.push(rawIngredient);
                    }
                }
            }

            // 3. LOG TO TRACEABILITY LEDGER
            await addDoc(collection(db, "stock_logs"), {
                branch: window.branchName, item: item.name, variance: baseQtyToAdd, uom: item.baseUom,
                purchUom: item.purchUom, purchQty: item.purchQty, 
                type: "KITCHEN KDS PREP", note: `Prepared ${item.purchQty} ${item.purchUom}(s) by ${window.staffName} (KDS Tablet)`, 
                timestamp: serverTimestamp()
            });
        }

        let msg = `Logged ${window.kdsCart.length} batches to inventory.`;
        if (missingItems.length > 0) msg += `<br><br>⚠️ Missing Raw Ingredients: ${missingItems.join(', ')}`;
        
        Swal.fire({ title: 'Success!', html: msg, icon: 'success', background: '#1e293b', color: '#fff' });
        
        window.kdsCart = [];
        renderCart();
        loadPrepItems(); // Refresh the grid

    } catch (e) {
        console.error(e);
        Swal.fire({ title: 'Error', text: 'Failed to log batches.', icon: 'error', background: '#1e293b', color: '#fff' });
    }
};
