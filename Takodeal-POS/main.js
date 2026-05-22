 // ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS (MUST BE AT THE VERY TOP)
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp, doc, getDoc, updateDoc, limit, orderBy, deleteDoc, onSnapshot, increment, setDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
// 🔥 NEW: Import Firebase Storage
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

window.onSnapshot = onSnapshot;

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
const storage = getStorage(app); // 🔥 Turn on the engine

window.storage = storage; // Export it for the staff meal function!

enableIndexedDbPersistence(db).then(() => {
    console.log("🚀 TAKODEÁL Offline Mode is ACTIVE!");
}).catch((err) => {
    if (err.code == 'failed-precondition') console.warn("Offline persistence failed: Multiple tabs open.");
    else if (err.code == 'unimplemented') console.warn("Offline persistence is not supported.");
});

window.db = db;
window.query = query;
window.where = where;
window.collection = collection;
window.getDocs = getDocs;
window.deleteDoc = deleteDoc;
window.doc = doc;
window.updateDoc = updateDoc;

console.log("🔥 Firebase Engine is LIVE!");

// ==========================================
// 🏷️ SMART TAB TITLE ENGINE
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    let savedBranch = localStorage.getItem('takodeal_device_branch');
    if (savedBranch) {
        document.title = "TAKODEÁL (" + savedBranch + ")";
    } else {
        document.title = "TAKODEÁL - Device Setup";
    }
});

// ========================================================
// 📱 2. DEVICE LOCK & SETUP ENGINE
// ========================================================
document.addEventListener("DOMContentLoaded", () => {
  let deviceBranch = localStorage.getItem('takodeal_device_branch');

  if (!deviceBranch) {
    document.getElementById('deviceSetupOverlay').style.display = 'flex';
  } else {
    let locDisplay = document.getElementById('displayDeviceLocation');
    if (locDisplay) locDisplay.innerText = deviceBranch;
    window.POS_BRANCH = deviceBranch;
  }
});

window.lockDeviceToBranch = async function () {
  let selectedBranch = document.getElementById('setupBranchSelect').value;
  let deviceName = prompt("Give this device a name (e.g., 'Counter Tablet 1' or 'Dianne Phone'):", "New Device");
  if (!deviceName) return; 

  try {
    let deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    localStorage.setItem('takodeal_device_branch', selectedBranch);
    localStorage.setItem('takodeal_device_id', deviceId);
    localStorage.setItem('takodeal_device_name', deviceName);

    await addDoc(collection(db, "pos_devices"), {
      deviceId: deviceId,
      deviceName: deviceName,
      branch: selectedBranch,
      status: 'Pending', // 🔥 DEFAULTS TO PENDING NOW!
      registeredAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });

    alert(`⏳ Device Registered!\n\nPlease tell the Manager to approve "${deviceName}" in the HQ Control Center before you can log in.`);
    location.reload();
  } catch (e) {
    console.error("Registration Error:", e);
    alert("❌ Failed to register device. Check internet connection.");
  }
};

// --- THE FIREBASE PIN SEARCHER ---
window.verifyPin = async function (pin) {
  try {
    // 🚨 1. NEW DEVICE SECURITY CHECK 🚨
    let deviceId = localStorage.getItem('takodeal_device_id');
    if (deviceId) {
        const devQ = query(collection(db, "pos_devices"), where("deviceId", "==", deviceId));
        const devSnap = await getDocs(devQ);
        
        if (!devSnap.empty) {
            let devStatus = devSnap.docs[0].data().status;
            if (devStatus === 'Pending') {
                alert("⏳ DEVICE PENDING APPROVAL\n\nThe Manager has not approved this device yet. Please ask them to approve it in the Device Fleet tab.");
                return null; // Blocks login!
            }
            if (devStatus === 'Blocked') {
                alert("🚫 DEVICE BLOCKED\n\nThis device has been blocked by the Manager.");
                return null; // Blocks login!
            }
        } else {
            alert("❌ UNREGISTERED DEVICE\n\nThis device was removed from the HQ. Please clear your browser data and re-register.");
            return null;
        }
    }

    // 2. PROCEED WITH NORMAL PIN CHECK
    const q = window.query(window.collection(window.db, "cashiers"), window.where("pin", "==", pin));
    const snapshot = await window.getDocs(q);

    if (snapshot.empty) return null; // PIN is wrong

    let staffData = snapshot.docs[0].data();
    let deviceBranch = localStorage.getItem('takodeal_device_branch');

    // 🛡️ THE DEVICE SECURITY WALL
    if (staffData.branch !== deviceBranch && staffData.branch !== "Main Office") {
      alert(`❌ Access Denied: You are assigned to ${staffData.branch || 'Unassigned'}, but this tablet is located at ${deviceBranch}.`);
      return null; // Blocks the login!
    }

    return staffData; // Allows the login!

  } catch (error) {
    console.error("Database error:", error);
    return null;
  }
};

// --- THE SMART FIREBASE MENU GROUPER ---
window.fetchMenu = async function () {
  try {
    const snapshot = await getDocs(collection(db, "menu"));
    let rawItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    let groupedMenu = [];
    masterPOSData.phantomVariants = {}; // Stores the hidden sizes!

    rawItems.forEach(item => {
        let name = item.name;
        // 🧠 Smart Regex: Looks for " 8 Pcs", " L", " M", " Duo" at the end of the name
        let match = name.match(/^(.*?)\s+(\d+\s*Pcs|[SML]|Duo|Solo|Trio|Squad)$/i);
        
        if (match) {
            let baseName = match[1].trim(); // e.g., "Bonito Takoyaki Original"
            let sizeName = match[2].trim(); // e.g., "8 Pcs"
            
            // If we haven't seen this base name yet, create ONE card for it
            let existingBase = groupedMenu.find(i => i.name === baseName && i.category === item.category);
            if (!existingBase) {
                let baseItem = { ...item, name: baseName, isGrouped: true };
                groupedMenu.push(baseItem);
                masterPOSData.phantomVariants[baseName] = [];
            }
            
            // Store the specific size, price, and REAL database name in memory
            masterPOSData.phantomVariants[baseName].push({
                realName: item.name,
                sizeLabel: sizeName,
                price: parseFloat(item.price) || 0,
                id: item.id
            });
            
            // Sort the variants from cheapest to most expensive (e.g. 4 Pcs -> 6 Pcs)
            masterPOSData.phantomVariants[baseName].sort((a, b) => a.price - b.price);
            
        } else {
            // It's a normal item with no sizes, add it normally
            groupedMenu.push(item);
        }
    });

    return groupedMenu;
  } catch (error) {
    console.error("Error fetching menu:", error);
    return [];
  }
};

window.loadPOSData = async function() {
    let products = await window.fetchMenu();
    masterPOSData.items = products;
    masterPOSData.variants = {}; // Legacy variants
    masterPOSData.addons = [];

    // 🔥 PHASE 2: FETCH GLOBAL SETTINGS FROM MANAGER HUB 🔥
    try {
        const configSnap = await getDoc(doc(db, "settings", "global_pos_config"));
        if (configSnap.exists()) {
            let configData = configSnap.data();
            masterPOSData.settings = {
                orderTypes: configData.orderTypes && configData.orderTypes.length > 0 ? configData.orderTypes : ["Dine-In", "Take-Out", "Delivery"],
                payMethods: configData.paymentMethods && configData.paymentMethods.length > 0 ? configData.paymentMethods : ["Cash", "GCash"]
            };
            let dbCats = [...new Set(products.map(p => p.category))].filter(Boolean);
            masterPOSData.categories = configData.posTabs && configData.posTabs.length > 0 ? configData.posTabs : (dbCats.length > 0 ? dbCats : ["Takoyaki", "Milk Tea", "Coffee"]);
        } else {
            let dbCats = [...new Set(products.map(p => p.category))].filter(Boolean);
            masterPOSData.categories = dbCats.length > 0 ? dbCats : ["Takoyaki", "Milk Tea", "Coffee"];
            masterPOSData.settings = { orderTypes: ["Dine-In", "Take-Out", "Delivery", "Grab"], payMethods: ["Cash", "GCash", "Bank"] };
        }
    } catch (e) {
        console.warn("Could not load global config, using defaults", e);
    }

    masterPOSData.stockLevels = {};
    const invSnap = await getDocs(query(collection(db, "inventory"), where("branch", "==", window.POS_BRANCH)));
    invSnap.forEach(doc => masterPOSData.stockLevels[doc.data().name] = doc.data().currentStock);

    masterPOSData.bom = [];
    const bomSnap = await getDocs(collection(db, "bom"));
    bomSnap.forEach(doc => masterPOSData.bom.push(doc.data()));

    buildCategories();

    let otHtml = ''; 
    masterPOSData.settings.orderTypes.forEach(t => otHtml += `<option value="${t}">${t}</option>`); 
    document.getElementById('mainOrderType').innerHTML = otHtml;
    
    // 🔀 INJECT SPLIT PAYMENT BUTTON
    let pmHtml = ''; 
    let optHtml = ''; // For the dropdowns
    masterPOSData.settings.payMethods.forEach((m, idx) => { 
        let act = idx === 0 ? 'active' : ''; 
        if (idx === 0) window.selectedPaymentMethod = m; 
        pmHtml += `<button class="pay-btn ${act}" onclick="setPaymentMethod(this, '${m}'); document.getElementById('splitPaymentContainer').style.display='none';">${m}</button>`; 
        optHtml += `<option value="${m}">${m}</option>`;
    }); 
    pmHtml += `<button class="pay-btn split-btn" onclick="window.toggleSplitPaymentUI(event)" style="background:#8b5cf6; color:white; border:none; box-shadow: 0 4px 6px rgba(139,92,246,0.3);">🔀 Split</button>`;
    
    let payGrid = document.querySelector('.payment-grid');
    if (payGrid) {
        payGrid.innerHTML = pmHtml;
        
        // Inject the Split Inputs right below the buttons!
        if (!document.getElementById('splitPaymentContainer')) {
            payGrid.insertAdjacentHTML('afterend', `
                <div id="splitPaymentContainer" style="display:none; margin-top: 15px; background: #f8fafc; padding: 15px; border-radius: 8px; border: 2px dashed #8b5cf6;">
                    <div style="font-size:12px; font-weight:bold; color:#8b5cf6; margin-bottom:10px;">SPLIT PAYMENT DETAILS</div>
                    <div style="display:flex; justify-content:space-between; margin-bottom: 10px;">
                        <select id="splitMethod1" style="padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; flex: 1; margin-right: 10px; font-weight:bold;">${optHtml}</select>
                        <input type="number" id="splitAmount1" placeholder="Amount" style="padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; width: 100px; text-align:right; font-weight:bold; color:#0f766e;" onkeyup="window.calcSplitRemaining()" onchange="window.calcSplitRemaining()">
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom: 10px;">
                        <select id="splitMethod2" style="padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; flex: 1; margin-right: 10px; font-weight:bold;">${optHtml}</select>
                        <input type="number" id="splitAmount2" placeholder="Amount" style="padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; width: 100px; text-align:right; font-weight:bold; color:#0f766e;" onkeyup="window.calcSplitRemaining()" onchange="window.calcSplitRemaining()">
                    </div>
                    <div style="text-align: right; font-size: 14px; font-weight: 900; color: #ef4444;" id="splitRemainingAlert">Total Split Entered: ₱0.00</div>
                </div>
            `);
        } else {
            // Update dropdowns if they already exist
            document.getElementById('splitMethod1').innerHTML = optHtml;
            document.getElementById('splitMethod2').innerHTML = optHtml;
        }
    }
};

window.toggleSplitPaymentUI = function(event) {
    let container = document.getElementById('splitPaymentContainer');
    if (container.style.display === 'none') {
        container.style.display = 'block';
        window.selectedPaymentMethod = 'Split';
        document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
        event.target.classList.add('active');
        window.calcSplitRemaining();
    } else {
        container.style.display = 'none';
        document.getElementById('splitAmount1').value = '';
        document.getElementById('splitAmount2').value = '';
    }
};

window.calcSplitRemaining = function() {
    let a1 = parseFloat(document.getElementById('splitAmount1').value) || 0;
    let a2 = parseFloat(document.getElementById('splitAmount2').value) || 0;
    let totalInput = a1 + a2;
    document.getElementById('splitRemainingAlert').innerText = `Total Split Entered: ₱${totalInput.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('splitRemainingAlert').style.color = "#8b5cf6";
};

// --- THE SHIFT ENGINE ---
window.checkShiftStatus = async function (branch) {
  try {
    const q = query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      let data = snap.docs[0].data();
      // NEW: We now grab the exact Firebase Server Time the shift started!
      return { active: true, startedBy: data.cashier, startTime: data.startTime };
    }
    return { active: false };
  } catch (error) { console.error(error); return { active: false }; }
};

window.openNewShift = async function (branch, cashier, startCash) {
  try {
    const docRef = await addDoc(collection(db, "shifts"), {
      branch: branch,
      // 🔥 THE AUTOMATIC MEMORY GRABBER
      cashier: localStorage.getItem('cashierName') || localStorage.getItem('activeCashier') || cashier || 'Unknown',
      startingCash: startCash,
      startTime: serverTimestamp(),
      active: true,
      grossSales: 0,
      netSales: 0
    });
    return docRef.id;
  } catch (error) {
    console.error(error);
    return null;
  }
};

// --- THE CHECKOUT ENGINE (STREAMLINED & FAST) ---
window.processCheckout = async function (payload) {
  try {
    // 🔀 SPLIT PAYMENT INTERCEPTOR & VALIDATOR
    let splitContainer = document.getElementById('splitPaymentContainer');
    if (splitContainer && splitContainer.style.display !== 'none') {
        let m1 = document.getElementById('splitMethod1').value;
        let a1 = parseFloat(document.getElementById('splitAmount1').value) || 0;
        let m2 = document.getElementById('splitMethod2').value;
        let a2 = parseFloat(document.getElementById('splitAmount2').value) || 0;
        
        // Strict Math Check!
        if (Math.abs((a1 + a2) - payload.netTotal) > 0.01) {
            alert(`❌ ERROR: The Split Amounts (₱${a1+a2}) do not match the Order Total (₱${payload.netTotal})!\n\nPlease adjust the split amounts.`);
            return null; // Abort checkout!
        }
        
        payload.paymentMethod = `Split (${m1} & ${m2})`;
        payload.splitDetails = [
            { method: m1, amount: a1 },
            { method: m2, amount: a2 }
        ];
    }

    let d = new Date();
    let dateStr = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

    // 🔥 FIX: Global Continuous Receipt Counter
    const txSnap = await getDocs(collection(db, "transactions"));
    let globalCount = txSnap.size + 1;
    
    // Format: 20260521-00001 (Removes shift text completely)
    const receiptId = `${dateStr}-${globalCount.toString().padStart(5, '0')}`;

    addDoc(collection(db, "transactions"), {
      ...payload, receiptId: receiptId, timestamp: serverTimestamp()
    });

    // ==========================================
    // 🏦 AUTO-ROUTE SALES TO MANAGER LEDGER (SPLIT READY)
    // ==========================================
    try {
        let paymentsToRoute = payload.splitDetails ? payload.splitDetails : [{ method: payload.paymentMethod || 'Cash', amount: payload.netTotal || 0 }];

        for (let p of paymentsToRoute) {
            if (p.amount <= 0) continue; // Skip if they put 0 for one method
            
            const accQuery = query(collection(db, "cash_accounts"), where("branch", "==", payload.branch), where("name", "==", p.method));
            const accSnap = await getDocs(accQuery);

            if (!accSnap.empty) {
                let accDoc = accSnap.docs[0];
                await updateDoc(doc(db, "cash_accounts", accDoc.id), { 
                    balance: (parseFloat(accDoc.data().balance) || 0) + p.amount 
                });
            } else {
                await addDoc(collection(db, "cash_accounts"), { 
                    branch: payload.branch, name: p.method, balance: p.amount 
                });
            }
        }
    } catch (ledgerError) { console.error("Ledger Auto-Route Error: ", ledgerError); }

    // 2. Offload Inventory Updates
    setTimeout(async () => {
        let lowStockTriggered = false;
        
        for (let cartItem of payload.cart) {
            let itemName = cartItem.name || cartItem.itemName;
            let qtySold = cartItem.qty || 1;

            const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
            const bomSnap = await getDocs(bomQ);
            for (let bomDoc of bomSnap.docs) {
                let recipeData = bomDoc.data();
                let totalAmountToDeduct = (recipeData.qty || 0) * qtySold;
                const invQ = query(collection(db, "inventory"), where("branch", "==", payload.branch), where("name", "==", recipeData.ingredientName));
                const invSnap = await getDocs(invQ);
                if (!invSnap.empty) {
                    let invData = invSnap.docs[0].data();
                    let newStock = (invData.currentStock || 0) - totalAmountToDeduct;
                    await updateDoc(invSnap.docs[0].ref, { currentStock: newStock });
                    if (newStock <= (invData.reorderLevel || 5)) lowStockTriggered = true;
                }
            }

            if (cartItem.addons) {
                for (let addonKey in cartItem.addons) {
                    let addon = cartItem.addons[addonKey];
                    if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                        let totalAddonDeduct = addon.deductQty * addon.qty * qtySold;
                        const addonInvQ = query(collection(db, "inventory"), where("branch", "==", payload.branch), where("name", "==", addon.linkedIngredient));
                        const addonInvSnap = await getDocs(addonInvQ);
                        if (!addonInvSnap.empty) {
                            let invData = addonInvSnap.docs[0].data();
                            let newStock = (invData.currentStock || 0) - totalAddonDeduct;
                            await updateDoc(addonInvSnap.docs[0].ref, { currentStock: newStock });
                            if (newStock <= (invData.reorderLevel || 5)) lowStockTriggered = true;
                        }
                    }
                }
            }
        }
        
        if (lowStockTriggered) window.pendingLowStockAlarm = true;

        let totalBallsInOrder = 0;
        for (let cartItem of payload.cart) {
            let match = (cartItem.name || cartItem.itemName).match(/(\d+)\s*Pcs/i);
            if (match) totalBallsInOrder += (parseInt(match[1]) * (cartItem.qty || 1));
        }
        if (totalBallsInOrder > 0) {
            await setDoc(doc(db, "settings", "global_stats"), { totalTakoyakiBalls: increment(totalBallsInOrder) }, { merge: true });
        }
    }, 100); 

    // Auto-close split container after successful checkout
    if (splitContainer) splitContainer.style.display = 'none';

    return receiptId;
  } catch (error) { console.error(error); return null; }
};

// --- THE DASHBOARD ENGINE ---
window.getSalesDashboardData = async function (branch, shiftStartTime) {
  try {
    if (!shiftStartTime) return [];

    // 🔥 FIX 1: Force the time into a proper object so Firebase can read it!
    let validStartTime = shiftStartTime instanceof Date ? shiftStartTime : (shiftStartTime && shiftStartTime.toDate ? shiftStartTime.toDate() : new Date(shiftStartTime));

    const q = query(collection(db, "transactions"),
      where("branch", "==", branch),
      where("timestamp", ">=", validStartTime)
    );
    const snapshot = await getDocs(q);

    let transactions = [];
    snapshot.forEach(doc => { transactions.push({ id: doc.id, ...doc.data() }); });
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    return transactions;
  } catch (error) { console.error("Dashboard Error:", error); return []; }
};

// --- LIVE SHIFT & CLOSE ENGINE ---
window.getLiveShiftDetails = async function (branch) {
  try {
    const shiftQ = query(collection(db, "shifts"), where("branch", "==", branch), where("active", "==", true), limit(1));
    const shiftSnap = await getDocs(shiftQ);
    if (shiftSnap.empty) return null;

    const shiftDoc = shiftSnap.docs[0];
    const shiftData = shiftDoc.data();

    // 🔥 FIX 1: Force the time into a proper object so Firebase can read it!
    let validStartTime = shiftData.startTime && shiftData.startTime.toDate ? shiftData.startTime.toDate() : new Date(shiftData.startTime);

    // 1. Get Transactions
    const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", validStartTime));
    const txSnap = await getDocs(txQ);

    // 2. Get Expenses (Cash Out)
    // 🔥 FIX 2: ONLY look for expenses that were explicitly linked to THIS exact drawer shift!
    const expQ = query(collection(db, "expenses"), where("shiftId", "==", shiftDoc.id));
    const expSnap = await getDocs(expQ);
    
    let totalExpenses = 0;
    expSnap.forEach(e => { totalExpenses += (e.data().amount || 0); });

    let cashIn = 0;
    txSnap.forEach(d => {
      let tx = d.data();
      if (tx.status !== "Voided") {
        // 🔥 NEW: Calculate Cash perfectly, even if it's split!
        if (tx.splitDetails) {
            let cashSplit = tx.splitDetails.find(s => s.method === "Cash");
            if (cashSplit) cashIn += cashSplit.amount;
        } else if (tx.paymentMethod === "Cash" || !tx.paymentMethod) {
            cashIn += tx.netTotal || 0;
        }
      }
    });

    return {
      logId: shiftDoc.id, 
      startedBy: shiftData.cashier,
      startTime: validStartTime, 
      startingCash: shiftData.startingCash || 0,
      cashIn: cashIn,
      cashOut: totalExpenses, // Now strictly isolated to this drawer!
      expectedCash: (shiftData.startingCash || 0) + cashIn - totalExpenses
    };
  } catch (e) { console.error(e); return null; }
};

window.closeShift = async function (branch, shiftId, actualCash, expectedCash, diff) {
  try {
    const shiftRef = doc(db, "shifts", shiftId);
    await updateDoc(shiftRef, { active: false, endTime: serverTimestamp(), actualCash: actualCash, expectedCash: expectedCash, difference: diff });
    return true;
  } catch (e) { console.error(e); throw e; }
};

window.closeShift = async function (branch, shiftId, actualCash, expectedCash, diff) {
  try {
    const shiftRef = doc(db, "shifts", shiftId);
    await updateDoc(shiftRef, { active: false, endTime: serverTimestamp(), actualCash: actualCash, expectedCash: expectedCash, difference: diff });
    return true;
  } catch (e) { console.error(e); throw e; }
};

// --- EXPENSE ENGINE ---
window.getBranchInventoryForExpense = async function (branch) { return []; }; // Placeholder until Inventory Phase

window.processPettyCashExpense = async function (payload) {
  try {
    await addDoc(collection(db, "expenses"), { ...payload, timestamp: serverTimestamp() });
    return "Expense recorded successfully!";
  } catch (e) { console.error(e); throw e; }
};

// --- INVENTORY & STOCK COUNT ENGINE ---
window.getInventoryForCount = async function (branch) {
  try {
    // Looks for a master list of raw materials for this branch
    const q = query(collection(db, "inventory"), where("branch", "==", branch));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("Inventory Fetch Error:", e);
    return [];
  }
};

window.submitInventoryCheck = async function (branch, cashier, counts) {
  try {
    await addDoc(collection(db, "stock_counts"), {
      branch: branch,
      cashier: cashier,
      counts: counts,
      timestamp: serverTimestamp()
    });
    return true;
  } catch (e) {
    console.error("Stock Count Submit Error:", e);
    throw e;
  }
};

// --- PARKED ORDERS ENGINE ---
window.parkOrderToDB = async function (payload) {
  try {
    const docRef = await addDoc(collection(db, "parked_orders"), { ...payload, timestamp: serverTimestamp() });
    return docRef.id;
  } catch (e) { console.error(e); return null; }
};

window.getParkedOrders = async function (branch) {
  try {
    const q = query(collection(db, "parked_orders"), where("branch", "==", branch));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) { console.error(e); return []; }
};

window.deleteParkedOrder = async function (docId) {
  try {
    await deleteDoc(doc(db, "parked_orders", docId));
    return true;
  } catch (e) { console.error(e); return false; }
};

// --- VOID & DETAILS ENGINE (WITH INVENTORY REPLENISHMENT) ---
window.voidTransaction = async function (receiptId, cashierName, branch) {
  try {
    const q = query(collection(db, "transactions"), where("receiptId", "==", receiptId));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("Transaction not found");
    
    const txDoc = snap.docs[0];
    const docId = txDoc.id;
    const txData = txDoc.data();

    // Prevent double-voiding glitches
    if (txData.status === "Voided") {
        alert("⚠️ This transaction is already voided.");
        return false;
    }

    // 1. Void the transaction record
    await updateDoc(doc(db, "transactions", docId), { status: "Voided", voidedBy: cashierName, voidTime: serverTimestamp() });

    // 2. 🔥 INVENTORY REPLENISHMENT ENGINE 🔥
    if (txData.cart && Array.isArray(txData.cart)) {
      for (let cartItem of txData.cart) {
        let itemName = cartItem.name || cartItem.itemName;
        let qtyVoided = cartItem.qty || 1;

        // --- A. REPLENISH MAIN RECIPE (BOM) ---
        const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
        const bomSnap = await getDocs(bomQ);

        for (let bomDoc of bomSnap.docs) {
          let recipeData = bomDoc.data();
          let ingredientName = recipeData.ingredientName;
          
          // Calculate exactly how much to return (+ instead of -)
          let totalAmountToReturn = (recipeData.qty || 0) * qtyVoided;

          // Find the ingredient in this specific branch's inventory
          const invQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", ingredientName));
          const invSnap = await getDocs(invQ);

          if (!invSnap.empty) {
            let invDocRef = invSnap.docs[0].ref;
            let invData = invSnap.docs[0].data();
            
            // Add it back to the current stock!
            let newStock = (invData.currentStock || 0) + totalAmountToReturn;
            await updateDoc(invDocRef, { currentStock: newStock });
          }
        }

        // --- B. REPLENISH ADD-ONS ---
        if (cartItem.addons) {
            for (let addonKey in cartItem.addons) {
                let addon = cartItem.addons[addonKey];
                
                // If the addon has a linked ingredient, return it!
                if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                    let totalAddonReturn = addon.deductQty * addon.qty * qtyVoided;

                    const addonInvQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", addon.linkedIngredient));
                    const addonInvSnap = await getDocs(addonInvQ);

                    if (!addonInvSnap.empty) {
                        let invDocRef = addonInvSnap.docs[0].ref;
                        let invData = addonInvSnap.docs[0].data();
                        
                        let newStock = (invData.currentStock || 0) + totalAddonReturn;
                        await updateDoc(invDocRef, { currentStock: newStock });
                    }
                }
            }
        }
        
      }
    }

    // 🔥 NEW: REVERSE THE 1 MILLION BALLS TRACKER 🔥
    let totalBallsToReturn = 0;
    for (let cartItem of txData.cart) {
        let itemName = cartItem.name || cartItem.itemName;
        // Smart AI: Looks for "8 Pcs", "15 Pcs" etc. just like the checkout engine
        let match = itemName.match(/(\d+)\s*Pcs/i);
        if (match) {
            let ballsInBox = parseInt(match[1]);
            totalBallsToReturn += (ballsInBox * (cartItem.qty || 1));
        }
    }

    // If they voided Takoyaki, deduct it from the Global Vault!
    if (totalBallsToReturn > 0) {
        const statsRef = doc(db, "settings", "global_stats");
        // We use a negative increment to subtract the balls!
        await setDoc(statsRef, { 
            totalTakoyakiBalls: increment(-totalBallsToReturn) 
        }, { merge: true });
    }

    // 3. 🚨 THE MANAGER ALARM
    await addDoc(collection(db, "manager_alerts"), {
      type: "VOID_ALERT",
      branch: branch,
      cashier: cashierName,
      receiptId: receiptId,
      message: `WARNING: Cashier ${cashierName} voided Receipt ${receiptId}. Inventory has been automatically replenished.`,
      timestamp: serverTimestamp(),
      isRead: false
    });

    return true;
  } catch (e) { 
    console.error(e); 
    throw e; 
  }
};

// --- RECEIPT DETAILS ENGINE ---
window.getReceiptDetails = async function (receiptId) {
  try {
    const q = query(collection(db, "transactions"), where("receiptId", "==", receiptId));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data();
  } catch (e) { console.error(e); return null; }
};

window.viewReceiptDetails = async function (receiptId) {
    let tx = await window.getReceiptDetails(receiptId);
    if (!tx) { alert("Receipt not found!"); return; }

    let modalHtml = `
        <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed #ccc;">
            <div style="font-weight: bold; font-size: 16px;">OR# ${tx.receiptId}</div>
            <div style="font-size: 12px; color: #666;">Date: ${tx.timestamp ? tx.timestamp.toDate().toLocaleString() : 'Unknown'}</div>
            <div style="font-size: 12px; color: #666;">Cashier: ${tx.cashier || 'Unknown'}</div>
            <div style="font-size: 12px; color: #666;">Order Type: <strong style="color:var(--primary);">${tx.orderType || 'N/A'}</strong></div>
            <div style="font-size: 12px; color: #666;">Method: ${tx.paymentMethod || 'Cash'}</div>
            <div style="font-size: 12px; color: #666; margin-top:5px; font-weight:bold;">Status: <span style="color:${tx.status==='Voided' ? 'red' : 'green'};">${tx.status || 'Paid'}</span></div>
        </div>
        <div style="max-height: 250px; overflow-y: auto; margin-bottom: 15px;">
    `;

    if (tx.cart && tx.cart.length > 0) {
        tx.cart.forEach(item => {
            let addonsText = '';
            if (item.addons) {
                for(let key in item.addons) {
                    if(item.addons[key].qty > 0) addonsText += `<br><span style="color:#d97706; font-size:11px; margin-left:10px;">+ ${item.addons[key].qty}x ${key}</span>`;
                }
            }
            modalHtml += `
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
                    <div><strong>${item.qty}x ${item.name}</strong><br><span style="font-size:11px; color:#888;">${item.variantName !== 'Standard' ? item.variantName : ''}</span>${addonsText}</div>
                    <div style="font-weight: bold;">₱${(item.lineTotalFinal || 0).toFixed(2)}</div>
                </div>
            `;
        });
    }

    modalHtml += `
        </div>
        <div style="border-top: 1px solid #eee; padding-top: 15px; font-size: 18px; font-weight: bold; text-align: right; color: var(--primary);">
            TOTAL: ₱${(tx.netTotal || 0).toFixed(2)}
        </div>
    `;

    document.getElementById('txDetailBody').innerHTML = modalHtml;
    document.getElementById('txDetailModal').style.display = 'flex';
};

// ========================================================
// 💵 CASH DENOMINATION CALCULATOR
// ========================================================
const denominations = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

// This builds the table when the modal opens
window.buildDenominationTable = function () {
  const tbody = document.getElementById('denominationTable');
  if (!tbody) return;

  let html = '';
  denominations.forEach(d => {
    html += `
      <tr>
        <td style="padding: 4px 0; font-weight: bold;">₱${d}</td>
        <td style="padding: 4px 0;">
          <input type="number" id="qty${d}" min="0" onkeyup="calculateDenominations()" onchange="calculateDenominations()" style="width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 4px; text-align: center;">
        </td>
        <td id="tot${d}" style="padding: 4px 0; text-align: right; color: #555;">₱0.00</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
};

// This instantly calculates the math when they type a number
window.calculateDenominations = function () {
  let grandTotal = 0;

  denominations.forEach(d => {
    let input = document.getElementById(`qty${d}`);
    let qty = parseInt(input.value) || 0;
    let subtotal = qty * d;

    document.getElementById(`tot${d}`).innerText = `₱${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    grandTotal += subtotal;
  });

  document.getElementById('grandTotalCash').innerText = `₱${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return grandTotal;
};

// Call this when clicking your "End Shift" button to open the new UI
window.openEndShiftClearance = async function () {
  buildDenominationTable();
  document.getElementById('endShiftModal').style.display = 'flex';

  let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
  const q = query(collection(db, "inventory"), where("branch", "==", branch));
  const snap = await getDocs(q);

  // 🔥 THE VIP LIST: Type the EXACT names of the items you want them to count here!
  // Make sure the spelling matches your Firebase inventory perfectly.
  const itemsToCount = [
      "320cc Paper Bowl", 
      "520cc Paper Bowl", 
      "LB1 Box", 
      "Burger Box",
      "Hotdog Box",
      "Boba Straw",
      "Thin Straw",
      "U-Cup M",
      "U-Cup L",
      "Coffee Cup L",
      "Coffee Cup M",
      "Coffee Lid",
      "Y-Cup M",
      "Y-Cup L",
      "Flat Lid",
  ];

  let html = '';
  snap.forEach(docSnap => {
      let i = docSnap.data();
      
      // Only render the input box if the item's name is in our VIP list above
      if (itemsToCount.includes(i.name)) {
          html += `<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #fcd34d; padding-bottom: 8px; margin-bottom: 8px;">
                      <label style="font-size: 13px; font-weight: bold; color: #444;">${i.name}:</label>
                      <input type="number" class="input-box shift-count-input" data-name="${i.name}" style="width: 80px; padding: 6px; text-align: center; border: 1px solid #ccc; border-radius: 6px;" placeholder="Qty">
                   </div>`;
      }
  });
  
  if(html === '') html = '<div style="font-size:12px; color:#888; text-align: center; padding: 10px;">No tracking items found. Please check spelling in the VIP List.</div>';
  document.getElementById('dynamicShiftStockCount').innerHTML = html;
};

// ========================================================
// 🛑 SUBMIT COMPREHENSIVE SHIFT CLOSE (WITH AUTO-SWEEP & SECURITY LOCK)
// ========================================================
window.submitComprehensiveCloseShift = async function () {
    let declaredCash = calculateDenominations();

    let cashBreakdown = {};
    denominations.forEach(d => {
        cashBreakdown[`₱${d}`] = parseInt(document.getElementById(`qty${d}`).value) || 0;
    });

    let physicalStock = {};
    document.querySelectorAll('.shift-count-input').forEach(inp => {
        let val = parseInt(inp.value) || 0;
        physicalStock[inp.getAttribute('data-name')] = val;
    });

    try {
        let shiftId = activeShiftDetails.logId;
        if (!shiftId) { alert("No active shift found to close."); return; }
        
        let branchName = localStorage.getItem('takodeal_device_branch') || 'Unknown';

        // 1. FETCH TRANSACTIONS & SEPARATE DIGITAL FUNDS
        let transactions = await window.getSalesDashboardData(branchName, activeShiftDetails.startTime);
        let totalCashSales = 0;
        let totalDigitalSales = 0;
        let digitalBreakdown = {}; // 🔥 Tracker for Auto-Sweep

        if (transactions && transactions.length > 0) {
            transactions.forEach(tx => {
                if (tx.status !== 'Voided') {
                    // 🔥 NEW: Process Split Breakdowns for Shift Closing!
                    if (tx.splitDetails) {
                        tx.splitDetails.forEach(split => {
                            if (split.method === 'Cash') {
                                totalCashSales += split.amount;
                            } else {
                                totalDigitalSales += split.amount;
                                if (!digitalBreakdown[split.method]) digitalBreakdown[split.method] = 0;
                                digitalBreakdown[split.method] += split.amount;
                            }
                        });
                    } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                        totalCashSales += tx.netTotal;
                    } else {
                        totalDigitalSales += tx.netTotal;
                        let method = tx.paymentMethod;
                        if (!digitalBreakdown[method]) digitalBreakdown[method] = 0;
                        digitalBreakdown[method] += tx.netTotal;
                    }
                }
            });
        }

        let expectedCash = activeShiftDetails.startingCash + totalCashSales - activeShiftDetails.cashOut;

        // 🚨 ========================================================
        // 🔒 THE "ZERO CASH" SECURITY LOCK
        // ========================================================
        if (expectedCash > 0 && declaredCash === 0) {
            alert(`⛔ SECURITY LOCKOUT!\n\nThe system expects ₱${expectedCash.toFixed(2)} in your drawer.\n\nYou cannot submit a blank or zero physical cash count. Please recount your drawer and enter the actual physical bills.`);
            return; // Stops the shift from closing!
        }
        // ========================================================

        // 2. CLOSE THE SHIFT RECORD
        await updateDoc(doc(db, "shifts", shiftId), {
            active: false,
            endTime: serverTimestamp(),
            declaredCash: declaredCash,
            expectedCash: expectedCash,
            totalCashSales: totalCashSales, 
            totalDigitalSales: totalDigitalSales,
            digitalBreakdown: digitalBreakdown, // Saves exact Grab/GCash amounts for reports
            cashBreakdown: cashBreakdown, 
            physicalStockCount: physicalStock, 
            status: "Closed"
        });

        // ========================================================
        // 🧹 THE AUTO-SWEEP ENGINE (Teleports Digital Funds to HQ!)
        // ========================================================
        for (let method in digitalBreakdown) {
            if (method.toLowerCase() === "gcash") continue; 
            let amountToDeposit = digitalBreakdown[method];
            if (amountToDeposit > 0) {
                // 🔥 THE FIX: We force the search to look ONLY in the "Main Office" branch!
                const accQ = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", method));
                const accSnap = await getDocs(accQ);
         
                if (!accSnap.empty) {
                    let accDoc = accSnap.docs[0];
                    let currentBal = accDoc.data().balance || 0;
                    
                    // Silently deposit the money into the Main Office!
                    await updateDoc(accDoc.ref, { balance: currentBal + amountToDeposit });
                    
                    // Create an audit log for the Manager App history tab
                    await addDoc(collection(db, "account_logs"), {
                        accountId: accDoc.id,
                        accountName: method,
                        branch: "Main Office",
                        action: "Auto-Sweep (Shift Close)",
                        amount: amountToDeposit,
                        newBalance: currentBal + amountToDeposit,
                        user: localStorage.getItem('cashierName') || 'System Auto-Sweep',
                        timestamp: serverTimestamp(),
                        note: `Auto-deposit from ${branchName} Shift ID: ${shiftId.substring(0,6)}...`
                    });
                } else {
                    // FALLBACK: If you forgot to create a "GCash" account in the Main Office, it creates one for you!
                    const newAccRef = await addDoc(collection(db, "cash_accounts"), {
                        name: method,
                        branch: "Main Office",
                        balance: amountToDeposit,
                        createdAt: serverTimestamp()
                    });
                    await addDoc(collection(db, "account_logs"), {
                        accountId: newAccRef.id, accountName: method, branch: "Main Office", action: "Auto-Sweep (New Account Generated)",
                        amount: amountToDeposit, newBalance: amountToDeposit, user: 'System', timestamp: serverTimestamp(), note: `From ${branchName}`
                    });
                }
            }
        }

        // 3. FRAUD ALARM ENGINE (For Physical Cash Only)
        let variance = declaredCash - expectedCash;
        if (variance !== 0) {
            let currentCashier = localStorage.getItem('cashierName') || 'Unknown';
            let varianceType = variance < 0 ? "SHORT" : "OVER";
            
            await addDoc(collection(db, "manager_alerts"), {
                type: "VARIANCE_ALERT", branch: branchName, cashier: currentCashier, shiftId: shiftId,
                expected: expectedCash, declared: declaredCash, varianceAmount: variance, stockCounts: physicalStock, 
                message: `CASH ${varianceType}: ₱${Math.abs(variance).toFixed(2)} variance detected.`,
                explanationCause: "Awaiting Staff Letter...", explanationMessage: "", explanationStatus: "Pending", 
                timestamp: serverTimestamp(), isRead: false
            });
        }

        alert(`✅ Shift Closed & Bookkeeping Complete!\n\nCash Sales: ₱${totalCashSales.toFixed(2)}\nDigital Sales: ₱${totalDigitalSales.toFixed(2)}\n\n(Digital sales were automatically swept to HQ Bank ledgers).`);

        localStorage.removeItem('currentShiftId');
        if (typeof closeModal === 'function') closeModal('endShiftModal');
        else document.getElementById('endShiftModal').style.display = 'none';

        if (typeof checkCurrentShift === 'function') checkCurrentShift();

    } catch (error) {
        console.error("Error closing shift:", error);
        alert("❌ Failed to close shift. Check your connection.");
    }
};
// ========================================================
// 💸 SMART EXPENSE & INVENTORY RESTOCK ENGINE
// ========================================================

// 1. Open Modal & Fetch Live Inventory for Dropdown
window.openExpenseModal = async function () {
  document.getElementById('expenseModal').style.display = 'flex';
  document.getElementById('expenseQtyDiv').style.display = 'none'; // Reset to general
  let branch = localStorage.getItem('takodeal_device_branch') || localStorage.getItem('branch') || 'Unknown';
  let select = document.getElementById('expenseType');

  // Keep the General option, clear the rest
  select.innerHTML = '<option value="general">General Expense (Fare, Ice, Cleaning Supplies)</option>';

  try {
    const q = query(collection(db, "inventory"), where("branch", "==", branch));
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      let item = docSnap.data();
      let itemName = item.name || item.itemName || item.item;
      if (itemName) {
        let opt = document.createElement('option');
        opt.value = docSnap.id; // Store Firebase ID for instant updating
        opt.text = `📦 Restock: ${itemName}`;
        select.appendChild(opt);
      }
    });
  } catch (e) {
    console.error("Error loading inventory for expenses:", e);
  }
};

// 2. Show/Hide the Quantity Box based on selection
window.toggleExpenseQty = function () {
  let val = document.getElementById('expenseType').value;
  if (val === 'general') {
    document.getElementById('expenseQtyDiv').style.display = 'none';
  } else {
    document.getElementById('expenseQtyDiv').style.display = 'block';
  }
};

// 3. Submit Expense, Deduct Cash, & Add Inventory
window.submitSmartExpense = async function () {
  let amount = parseFloat(document.getElementById('expenseAmount').value);
  let desc = document.getElementById('expenseDesc').value || '';
  let typeId = document.getElementById('expenseType').value;
  let qty = parseInt(document.getElementById('expenseQty').value) || 0;

  if (!amount || amount <= 0) { alert("Please enter a valid amount."); return; }
  if (!activeShiftDetails || !activeShiftDetails.logId) { alert("No active shift found to attach this expense to!"); return; }

  let selectEl = document.getElementById('expenseType');
  let selectedText = selectEl.options[selectEl.selectedIndex].text;
  let finalDesc = typeId === 'general' ? desc : `RESTOCK [${qty} added] ${selectedText} - ${desc}`;

  try {
    // A. Update the Active Shift's Total Expenses
    const shiftRef = doc(db, "shifts", activeShiftDetails.logId);
    const shiftSnap = await getDoc(shiftRef);
    let currentExp = shiftSnap.data().expenses || shiftSnap.data().cashOut || 0;

    await updateDoc(shiftRef, {
      expenses: currentExp + amount,
      cashOut: currentExp + amount // Kept for backwards compatibility with your old code
    });

    // B. If it's an Inventory item, automatically increase the branch stock!
    if (typeId !== 'general' && qty > 0) {
      const invRef = doc(db, "inventory", typeId);
      const invSnap = await getDoc(invRef);
      let currentStock = invSnap.data().currentStock || invSnap.data().stock || invSnap.data().quantity || 0;

      await updateDoc(invRef, {
        currentStock: currentStock + qty,
        stock: currentStock + qty // Kept for backwards compatibility
      });
    }

    // C. Keep a permanent receipt of the transaction
    let branch = localStorage.getItem('takodeal_device_branch') || localStorage.getItem('branch');
    let cashier = localStorage.getItem('cashierName') || 'Unknown';
    await addDoc(collection(db, "expenses"), {
      branch: branch,
      shiftId: activeShiftDetails.logId,
      cashier: cashier,
      amount: amount,
      description: finalDesc,
      timestamp: serverTimestamp()
    });

    alert(`✅ ₱${amount.toFixed(2)} deducted from drawer.\n${typeId !== 'general' ? `📦 Inventory updated with +${qty} items.` : ''}`);

    // Close and clean up
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseDesc').value = '';
    document.getElementById('expenseQty').value = '';
    document.getElementById('expenseModal').style.display = 'none';

    // Refresh Shift UI so the new Expected Cash is immediately visible
    if (typeof checkCurrentShift === 'function') checkCurrentShift();

  } catch (e) {
    console.error("Error submitting expense:", e);
    alert("❌ Failed to log expense. Check console.");
  }
};

// --- LIVE CLOCK ENGINE ---
function startLiveClock() {
  const clockEl = document.getElementById('liveClock');
  if (!clockEl) return;

  setInterval(() => {
    const now = new Date();
    // Creates format: "10:17 PM"
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    // Creates format: "Thu, Apr 16"
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    
    clockEl.innerHTML = `${timeStr} &nbsp;&nbsp; ${dateStr}`;
  }, 1000);
}
startLiveClock();

// ==========================================
// ✉️ REASON LETTER ENGINE
// ==========================================
window.openExplanationModal = async function() {
    let cashier = localStorage.getItem('cashierName') || localStorage.getItem('activeCashier');
    let selectList = document.getElementById('explainAlertId');
    selectList.innerHTML = '<option>Loading your records...</option>';
    document.getElementById('explanationModal').style.display = 'flex';

    try {
        const q = query(collection(db, "manager_alerts"), 
            where("type", "==", "VARIANCE_ALERT"), 
            where("cashier", "==", cashier),
            where("explanationStatus", "==", "Pending")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            selectList.innerHTML = '<option value="">No pending variances found! Excellent job.</option>';
            return;
        }

        let html = '';
        snap.forEach(doc => {
            let data = doc.data();
            let dateStr = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : 'Recent';
            html += `<option value="${doc.id}">${dateStr} - ₱${Math.abs(data.varianceAmount).toFixed(2)} ${data.varianceAmount < 0 ? 'SHORT' : 'OVER'}</option>`;
        });
        selectList.innerHTML = html;

    } catch (e) {
        console.error(e);
        selectList.innerHTML = '<option value="">Error connecting.</option>';
    }
};

window.submitReasonLetter = async function() {
    let alertId = document.getElementById('explainAlertId').value;
    let cause = document.getElementById('explainCause').value;
    let message = document.getElementById('explainMessage').value;

    if (!alertId) { alert("No variance selected."); return; }
    if (!message) { alert("You must type a detailed explanation."); return; }

    try {
        await updateDoc(doc(db, "manager_alerts", alertId), {
            explanationCause: cause,
            explanationMessage: message,
            explanationStatus: "Submitted - Awaiting Owner Approval"
        });

        alert("✅ Reason Letter successfully sent to the Owner's Security Feed.");
        document.getElementById('explanationModal').style.display = 'none';
        document.getElementById('explainMessage').value = '';
    } catch (e) { console.error(e); alert("Failed to send letter."); }
};

// ==========================================
// 🛡️ PHASE 4: INVENTORY VALIDATION HUB
// ==========================================
window.validateStockLevels = async function(cartPayload) {
    let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
    let requiredIngredients = {}; 

    // 1. Calculate the TOTAL amount of every ingredient needed for this specific order
    for (let item of cartPayload) {
        let itemName = item.name || item.itemName;
        let qtySold = item.qty || 1;

        // A. Sum up the Main Recipe (BOM)
        const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
        const bomSnap = await getDocs(bomQ);
        bomSnap.forEach(docSnap => {
            let ing = docSnap.data().ingredientName;
            let amountNeeded = (docSnap.data().qty || 0) * qtySold;
            if (!requiredIngredients[ing]) requiredIngredients[ing] = 0;
            requiredIngredients[ing] += amountNeeded;
        });

        // B. Sum up the Add-Ons
        if (item.addons) {
            for (let key in item.addons) {
                let addon = item.addons[key];
                if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                    let amountNeeded = addon.deductQty * addon.qty * qtySold;
                    let ing = addon.linkedIngredient;
                    if (!requiredIngredients[ing]) requiredIngredients[ing] = 0;
                    requiredIngredients[ing] += amountNeeded;
                }
            }
        }
    }

    // 2. Check the requirements against the Live Branch Inventory
    let warnings = [];
    for (let ing in requiredIngredients) {
        let needed = requiredIngredients[ing];
        
        const invQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", ing));
        const invSnap = await getDocs(invQ);

        if (!invSnap.empty) {
            let currentStock = invSnap.docs[0].data().currentStock || 0;
            let uom = invSnap.docs[0].data().uom || 'units';
            
            // 🚨 THE TRIGGER: If they need more than they have!
            if (currentStock < needed) {
                warnings.push(`- ${ing}: Need ${needed.toFixed(2)} ${uom}, but only ${currentStock.toFixed(2)} ${uom} left!`);
            }
        } else {
            warnings.push(`- ${ing}: Missing entirely from ${branch} inventory!`);
        }
    }

    return warnings; // Returns an array of warning messages
};

// ==========================================
// 🚪 SIGN OUT ENGINE (WITH CACHE BUSTING)
// ==========================================
window.logoutCashier = function() {
    if (confirm("Are you sure you want to sign out of this account?")) {
        localStorage.removeItem('cashierName'); 
        window.sessionUser = null;
        // 🔥 THE FIX: Forces the browser to completely dump the cache and reload fresh!
        window.location.href = window.location.pathname + "?t=" + new Date().getTime(); 
    }
};

// ==========================================
// 💸 REMIT CASH TO HQ ENGINE
// ==========================================
window.openRemittanceModal = async function() {
    let safeCashierName = localStorage.getItem('cashierName');
    if (!safeCashierName && typeof window.sessionUser !== 'undefined' && window.sessionUser) {
        safeCashierName = window.sessionUser.cashierName;
    }
    if (!safeCashierName) safeCashierName = "Unknown Staff"; 
    
    document.getElementById('remittanceModal').style.display = 'flex';
    document.getElementById('remitCashier').value = safeCashierName;
    
    let today = new Date().toISOString().split('T')[0];
    document.getElementById('remitEndDate').value = today;
    document.getElementById('remitStartDate').value = "Loading..."; // Visual cue

    try {
        let safeBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        // 🔥 Fetch the exact date of the last successful remittance!
        const q = query(collection(db, "remittances"), where("branch", "==", safeBranch), orderBy("timestamp", "desc"), limit(1));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            let lastDate = snap.docs[0].data().timestamp.toDate();
            // We set the start date to the exact date they last sent money
            document.getElementById('remitStartDate').value = lastDate.toISOString().split('T')[0];
        } else {
            document.getElementById('remitStartDate').value = today; // Fallback
        }
    } catch (e) {
        console.error("Error fetching last remittance:", e);
        document.getElementById('remitStartDate').value = today;
    }
    
    window.switchRemittanceTab('form');
    window.loadHqAccountsForRemittance();
};

window.switchRemittanceTab = function(tab) {
    if (tab === 'form') {
        document.getElementById('remitFormSection').style.display = 'block';
        document.getElementById('remitHistorySection').style.display = 'none';
        document.getElementById('tabRemitForm').style.borderBottom = '3px solid #047857';
        document.getElementById('tabRemitHistory').style.borderBottom = '3px solid transparent';
    } else {
        document.getElementById('remitFormSection').style.display = 'none';
        document.getElementById('remitHistorySection').style.display = 'block';
        document.getElementById('tabRemitForm').style.borderBottom = '3px solid transparent';
        document.getElementById('tabRemitHistory').style.borderBottom = '3px solid #047857';
        window.loadRemittanceHistory();
    }
};

window.loadHqAccountsForRemittance = async function() {
    let select = document.getElementById('remitChannel');
    select.innerHTML = '<option value="">Loading HQ Accounts...</option>';
    try {
        // 🔥 ONLY pull accounts assigned to the Main Office
        const q = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"));
        const snap = await getDocs(q);
        
        // 🛡️ Use a "Set" to automatically prevent any accidental duplicate names
        let uniqueAccounts = new Set();
        snap.forEach(docSnap => { 
            if (docSnap.data().name) uniqueAccounts.add(docSnap.data().name); 
        });
        
        let html = '<option value="">-- Select Transfer Method --</option>';
        uniqueAccounts.forEach(accountName => { 
            html += `<option value="${accountName}">${accountName}</option>`; 
        });
        html += '<option value="Physical Handover">Physical Handover (Cash)</option>';
        
        select.innerHTML = html;
    } catch (e) { 
        console.error("Error loading accounts:", e); 
    }
};

window.submitRemittance = async function() {
    let safeBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
    let safeCashier = localStorage.getItem('cashierName') || 'Unknown';

    let amountStr = document.getElementById('remitAmount').value;
    let remitAmount = parseFloat(amountStr);
    let channel = document.getElementById('remitChannel').value;
    let recipient = document.getElementById('remitRecipient').value.trim();
    let refNum = document.getElementById('remitRefNum').value.trim();
    let startDate = document.getElementById('remitStartDate').value;
    let endDate = document.getElementById('remitEndDate').value;

    if (isNaN(remitAmount) || remitAmount <= 0 || !channel || !recipient) {
        alert("❌ Please fill out the Amount, Channel, and Recipient correctly."); return;
    }

    let btn = document.querySelector("button[onclick='submitRemittance()']");
    if(btn) { btn.innerText = "⏳ Verifying Drawer..."; btn.disabled = true; }

    try {
        // 🔥 FIX: Renamed 'shiftSnap' to 'activeShiftSnap' to prevent the duplicate declaration crash!
        const shiftQ = query(collection(db, "shifts"), where("branch", "==", safeBranch), where("active", "==", true), limit(1));
        const activeShiftSnap = await getDocs(shiftQ);
        
        if (activeShiftSnap.empty) {
            alert("❌ You must have an Active Shift open to remit cash!\n\n(If you just opened a shift, ensure your internet is connected)."); 
            if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
            return;
        }

        let shiftDoc = activeShiftSnap.docs[0];
        let liveShift = shiftDoc.data();
        let shiftId = shiftDoc.id;
        
        let validStartTime = liveShift.startTime && liveShift.startTime.toDate ? liveShift.startTime.toDate() : new Date(liveShift.startTime);

        // 🔒 1. EXACT MATH SECURITY CHECK (PHYSICAL CASH ONLY)
        const txQ = query(collection(db, "transactions"), where("branch", "==", safeBranch), where("timestamp", ">=", validStartTime));
        const txSnap = await getDocs(txQ);
        
        let currentCashInDrawer = (liveShift.startingCash || 0) - (liveShift.cashOut || 0);

        if (!txSnap.empty) {
            txSnap.forEach(d => {
                let tx = d.data();
                if (tx.status !== 'Voided') {
                    if (tx.splitDetails) {
                        let cashSplit = tx.splitDetails.find(s => s.method === "Cash");
                        if (cashSplit) currentCashInDrawer += cashSplit.amount;
                    } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                        currentCashInDrawer += (tx.netTotal || 0);
                    }
                }
            });
        }

        if (remitAmount > currentCashInDrawer) {
            alert(`⛔ REMITTANCE BLOCKED (SHORTAGE DETECTED)\n\nSystem Expected Cash: ₱${currentCashInDrawer.toFixed(2)}\nAmount You Entered: ₱${remitAmount.toFixed(2)}\n\nYou cannot remit more physical cash than what is supposed to be in your drawer!`);
            if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
            return;
        }

        // 🔒 2. SECURITY PIN AUTHORIZATION
        let userPin = document.getElementById('remitPinCode').value;
        if (!userPin) {
            alert("❌ Please enter your 4-Digit PIN to authorize this transfer.");
            if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
            return;
        }
        let identity = await window.verifyPin(userPin);
        if (!identity) {
            alert("❌ Unauthorized. Incorrect PIN.");
            if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
            return;
        }

        let payload = {
            branch: safeBranch,
            cashier: identity.cashierName, // Use the authorized person's name
            salesPeriodStart: startDate,
            salesPeriodEnd: endDate,
            amount: remitAmount,
            channel: channel,
            recipient: recipient,
            referenceNumber: refNum,
            status: "Pending", 
            timestamp: serverTimestamp()
        };

        // 3. Save to HQ Hub
        await addDoc(collection(db, "remittances"), payload);
        
        // 4. 🔥 TRUE DRAWER DEDUCTION
        const shiftRef = doc(db, "shifts", liveShift.logId);
        const shiftSnap = await getDoc(shiftRef);
        if (shiftSnap.exists()) {
            let currentExp = shiftSnap.data().cashOut || 0;
            // It adds to "cashOut", which lowers the final Expected Drawer Cash for Z-Reading
            await updateDoc(shiftRef, { cashOut: currentExp + remitAmount, expenses: currentExp + remitAmount });
        }

        // 5. Audit Log (So the Manager can trace where the drawer cash went)
        await addDoc(collection(db, "expenses"), {
            branch: safeBranch,
            shiftId: liveShift.logId,
            cashier: identity.cashierName,
            amount: remitAmount,
            description: `[REMITTANCE TO HQ] - ${channel} to ${recipient}`,
            timestamp: serverTimestamp()
        });

        alert("✅ Security Cleared! Cash Drop successfully recorded and deducted from your active drawer.");
        document.getElementById('remitAmount').value = '';
        document.getElementById('remitRefNum').value = '';
        window.switchRemittanceTab('history');
        if (typeof checkCurrentShift === 'function') checkCurrentShift(); 

    } catch (e) { 
        console.error(e); alert("❌ Failed to send remittance."); 
    } finally {
        if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
    }
};

window.loadRemittanceHistory = async function() {
    const tbody = document.getElementById('remitHistoryTableBody');
    tbody.innerHTML = '<tr><td style="padding:20px; text-align:center;">Fetching history...</td></tr>';
    
    try {
        // 🛡️ Bulletproof branch grabber for the database query
        let safeBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        
        const q = query(collection(db, "remittances"), where("branch", "==", safeBranch), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Just now';
            let statusColor = d.status === "Received" ? "#16a34a" : "#d97706";
            html += `
                <tr style="border-bottom: 1px solid #cbd5e1;">
                    <td style="padding: 10px; font-weight: bold; color: #334155;">₱${d.amount.toLocaleString()}</td>
                    <td style="padding: 10px; font-size: 12px; color: #64748b;">To: ${d.channel}</td>
                    <td style="padding: 10px; font-size: 12px; color: #64748b;">${dateStr}</td>
                    <td style="padding: 10px; font-weight: bold; color: ${statusColor}; text-align: right;">${d.status}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html || '<tr><td style="padding:20px; text-align:center;">No previous transfers.</td></tr>';
    } catch (e) { 
        console.error(e); 
        tbody.innerHTML = '<tr><td style="padding:20px; text-align:center; color:red;">Error loading history.</td></tr>'; 
    }
};

// ==========================================
// 📍 GPS & SELFIE TIME CLOCK ENGINE
// ==========================================
const BRANCH_ZONES = {
    "Cabantian": { lat: 7.130420626391755, lng: 125.61730998805625 }, 
    "Citygate": { lat: 7.111077615812063, lng: 125.61288981236622 },  
    "Maa": { lat: 7.078642149249695, lng: 125.58343773215358 },        
    "Main Office": { lat: 7.1539090939416266, lng: 125.59588373531139 }
};
const ALLOWED_RADIUS_METERS = 30; 
let cameraStream = null;
let currentBranchStaffCache = []; // DECLARED ONLY ONCE HERE!

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const p1 = lat1 * Math.PI/180; const p2 = lat2 * Math.PI/180;
    const deltaP = (lat2-lat1) * Math.PI/180; const deltaLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(deltaP/2) * Math.sin(deltaP/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

window.openTimeClockModal = async function() {
    document.getElementById('timeClockModal').style.display = 'flex';
    document.getElementById('clockStaffPin').value = ''; 
    let select = document.getElementById('clockStaffName');
    select.innerHTML = '<option value="">Loading Staff...</option>';
    try {
        let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        const q = query(collection(db, "cashiers"), where("branch", "in", [branch, "Main Office"]));
        const snap = await getDocs(q);
        currentBranchStaffCache = [];
        let html = '<option value="">-- Select Your Name --</option>';
        snap.forEach(docSnap => {
            let data = docSnap.data();
            currentBranchStaffCache.push(data); 
            html += `<option value="${data.cashierName}">${data.cashierName}</option>`;
        });
        select.innerHTML = html;
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        document.getElementById('clockVideo').srcObject = cameraStream;
    } catch (e) { console.error(e); alert("⚠️ Error loading Time Clock. Check Camera permissions."); }
};

window.closeTimeClock = function() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    document.getElementById('timeClockModal').style.display = 'none';
};

window.submitAttendance = async function(type) {
    // 1. INSTANTLY FREEZE BUTTONS TO PREVENT RAPID DOUBLE TAPPING!
    let buttons = document.querySelectorAll('#timeClockModal button');
    buttons.forEach(b => b.disabled = true);

    const staffName = document.getElementById('clockStaffName').value;
    const inputPin = document.getElementById('clockStaffPin').value.trim();

    if (!staffName || !inputPin) { 
        alert("❌ Please select your name and enter your PIN."); 
        buttons.forEach(b => b.disabled = false);
        return; 
    }

    let staffProfile = currentBranchStaffCache.find(s => s.cashierName === staffName);
    if (!staffProfile || staffProfile.pin !== inputPin) {
        alert("❌ INTRUDER ALERT: Incorrect PIN for " + staffName);
        document.getElementById('clockStaffPin').value = ''; 
        buttons.forEach(b => b.disabled = false);
        return;
    }

    // ==========================================
    // 🔥 THE BULLETPROOF ANTI-DOUBLE-PUNCH LOCK
    // ==========================================
    try {
        const q = query(collection(db, "attendance_logs"), 
            where("staffName", "==", staffName), 
            orderBy("timestamp", "desc"), 
            limit(1)
        );
        const lastLogSnap = await getDocs(q);
        
        if (!lastLogSnap.empty) {
            let lastLog = lastLogSnap.docs[0].data();
            let lastType = lastLog.type; 
            let lastTime = lastLog.timestamp.toDate();
            let now = new Date();
            
            let hoursSinceLastLog = (now - lastTime) / (1000 * 60 * 60);

            // 🛑 STRICT LOCK: If you are Timed In, you MUST Time Out next. No exceptions.
            if (type === "TIME IN" && lastType === "TIME IN") {
                alert(`❌ You are already Timed In!\n\nYou must TIME OUT of your current shift before starting a new one.\n\n(If you forgot to Time Out yesterday, please use the 'Manual Log' in the Manager App to fix your records.)`);
                document.getElementById('clockStaffPin').value = ''; buttons.forEach(b => b.disabled = false); return; 
            }
            if (type === "TIME OUT" && lastType === "TIME OUT" && hoursSinceLastLog < 1) {
                alert(`❌ You already Timed Out recently!\n\nPlease avoid double-tapping.`);
                document.getElementById('clockStaffPin').value = ''; buttons.forEach(b => b.disabled = false); return; 
            }
            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSinceLastLog < 0.05) {
                alert(`❌ You just Timed In a few minutes ago!\n\nWait until your shift is over to Time Out.`);
                document.getElementById('clockStaffPin').value = ''; buttons.forEach(b => b.disabled = false); return; 
            }
        }
    } catch(e) {
        console.warn("Fast query failed. Using fallback lock method...");
        const fallbackQ = query(collection(db, "attendance_logs"), where("staffName", "==", staffName));
        const fallbackSnap = await getDocs(fallbackQ);
        let latestLog = null;
        
        fallbackSnap.forEach(doc => {
            let data = doc.data();
            if (!latestLog || data.timestamp > latestLog.timestamp) latestLog = data;
        });
        
        if (latestLog) {
            if (type === "TIME IN" && latestLog.type === "TIME IN") {
                alert(`❌ You are already Timed In! You must Time Out first.`);
                document.getElementById('clockStaffPin').value = ''; buttons.forEach(b => b.disabled = false); return; 
            }
        }
    }

    // ==========================================
    // 🌍 GPS & SMART NEAREST-BRANCH DETECTOR
    // ==========================================
    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.6); 

    if (!navigator.geolocation) { 
        alert("❌ Geolocation is not supported."); 
        buttons.forEach(b => b.disabled = false); return; 
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const userLat = position.coords.latitude; 
        const userLng = position.coords.longitude;
        
        let deviceBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let isVIP = (staffProfile.branch === 'Main Office' || deviceBranch === 'Main Office' || (staffProfile.role && staffProfile.role.includes('Owner')));
        
        let finalBranch = deviceBranch;
        let finalDistance = 0;

        if (isVIP && typeof BRANCH_ZONES !== 'undefined') {
            // 🌟 NEAREST BRANCH RADAR FOR MANAGERS 🌟
            let closestBranch = "Main Office";
            let shortestDistance = Infinity;

            for (const [branchName, zone] of Object.entries(BRANCH_ZONES)) {
                let d = getDistanceInMeters(userLat, userLng, zone.lat, zone.lng);
                if (d < shortestDistance) {
                    shortestDistance = d;
                    closestBranch = branchName;
                }
            }
            // Assign them to the branch they are physically closest to!
            finalBranch = closestBranch; 
            finalDistance = shortestDistance;
        } else {
            // NORMAL STAFF LOGIC (Strict Geofencing)
            const targetZone = BRANCH_ZONES[deviceBranch];
            if (!targetZone) { 
                alert(`❌ GPS Configuration Missing for ${deviceBranch}.`); 
                buttons.forEach(b => b.disabled = false); return; 
            }
            finalDistance = getDistanceInMeters(userLat, userLng, targetZone.lat, targetZone.lng);

            if (finalDistance > ALLOWED_RADIUS_METERS) {
                alert(`🚨 SECURITY LOCKOUT!\nYou are ${Math.round(finalDistance)}m away from ${deviceBranch}.\nMust be within ${ALLOWED_RADIUS_METERS}m!`);
                buttons.forEach(b => b.disabled = false); return;
            }
        }
        
        try {
            await addDoc(collection(db, "attendance_logs"), {
                staffName: staffName, 
                branch: finalBranch, // Will save as the auto-detected branch!
                type: type, 
                timestamp: new Date(),
                locationLat: userLat, 
                locationLng: userLng, 
                distanceMeters: Math.round(finalDistance), 
                photoBase64: photoBase64
            });
            alert(`✅ ${type} SUCCESS at ${finalBranch}!\nIdentity and Location Verified.`);
            window.closeTimeClock();
        } catch (error) { 
            console.error(error); alert("❌ Failed to log attendance."); 
        } 
        finally { buttons.forEach(b => b.disabled = false); }
    }, (error) => { 
        alert("❌ GPS access required."); 
        buttons.forEach(b => b.disabled = false); 
    }, { enableHighAccuracy: true }); 
};

// ==========================================
// 📥 STAFF REQUEST HUB (WITH INBOX)
// ==========================================
window.openStaffRequestsModal = function() {
    document.getElementById('staffRequestsModal').style.display = 'flex';
    window.switchRequestTab('Advance'); 
};

window.switchRequestTab = function(tabName) {
    const tabs = ['Advance', 'Leave', 'Meal', 'Reason', 'Inbox'];
    tabs.forEach(t => {
        let btn = document.getElementById('tabReq' + t); let form = document.getElementById('formReq' + t);
        if (!btn || !form) return;
        if (t === tabName) {
            btn.style.borderBottom = "3px solid #3b82f6"; btn.style.color = "#0f172a"; btn.style.background = "white"; form.style.display = "block";
            if (tabName === 'Inbox') window.loadStaffPersonalInbox();
        } else {
            btn.style.borderBottom = "3px solid transparent"; btn.style.color = "#64748b"; btn.style.background = "transparent"; form.style.display = "none";
        }
    });
};
window.loadStaffPersonalInbox = async function() {
    // 🛡️ Bulletproof name grabber
    let safeCashierName = localStorage.getItem('cashierName') || 'Unknown Staff';

    let container = document.getElementById("staffPersonalInboxList");
    container.innerHTML = "<div style='padding:20px; text-align:center; color:#666;'>Loading your records...</div>";
    
    try {
        const q = query(collection(db, "staff_requests"), where("staffName", "==", safeCashierName), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(docSnap => {
            let d = docSnap.data(); 
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Recent';
            
            let statusBadge = `<span style="background: #fef9c3; color: #d97706; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">Pending Review</span>`;
            if (d.status === "Approved") statusBadge = `<span style="background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">✅ Approved</span>`;
            if (d.status === "Rejected") statusBadge = `<span style="background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">❌ Rejected</span>`;
            
            // 🔥 NEW: MANAGER REPLY UI
            let replyHtml = '';
            if (d.managerReply) {
                replyHtml = `
                <div style="margin-top: 12px; padding: 10px; background: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 4px; font-size: 12px; color: #334155;">
                    <strong style="color: #0f172a;">Owner Reply:</strong><br>
                    <span style="font-style: italic;">"${d.managerReply}"</span>
                </div>`;
            }

            // 🔥 NEW: PROOF OF PAYMENT UI
            let proofHtml = '';
            if (d.proofImageUrl) {
                proofHtml = `
                <div style="margin-top: 10px;">
                    <a href="${d.proofImageUrl}" target="_blank" style="display: inline-block; background: #e0e7ff; color: #4f46e5; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; text-decoration: none;">
                        📄 View Payment Screenshot
                    </a>
                </div>`;
            }

            html += `
                <div style="background: white; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;"><strong style="color: #334155;">${d.type}</strong>${statusBadge}</div>
                    <div style="font-size: 12px; color: #64748b; margin-bottom: 5px;">Submitted: ${dateStr}</div>
                    <div style="font-size: 14px; font-weight: bold; color: var(--primary);">${d.amount ? '₱' + d.amount : ''} ${d.item || d.leaveType || ''}</div>
                    ${replyHtml}
                    ${proofHtml}
                </div>`;
        });
        
        container.innerHTML = html || '<div style="padding:20px; text-align:center; color:#64748b;">No requests found.</div>';
    } catch (e) { 
        console.error(e); 
        container.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Error checking inbox.</div>'; 
    }
};

window.submitStaffRequest = async function(requestType) {
    // 🛡️ Bulletproof name and branch grabbers!
    let safeCashierName = localStorage.getItem('cashierName') || 'Unknown Staff';
    let safeBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown Branch';
    
    let payload = { type: requestType, staffName: safeCashierName, branch: safeBranch, status: "Pending", timestamp: new Date() };
    
    if (requestType === "Cash Advance") {
        payload.amount = parseFloat(document.getElementById('reqAdvAmount').value); 
        payload.reason = document.getElementById('reqAdvReason').value.trim();
        if (isNaN(payload.amount) || payload.amount <= 0 || !payload.reason) { alert("❌ Valid amount and reason required."); return; }
    } else if (requestType === "Leave") {
        payload.startDate = document.getElementById('reqLeaveStart').value; 
        payload.endDate = document.getElementById('reqLeaveEnd').value;
        payload.leaveType = document.getElementById('reqLeaveType').value; 
        payload.reason = document.getElementById('reqLeaveReason').value.trim();
        if (!payload.startDate || !payload.endDate || !payload.reason) { alert("❌ Dates and reason required."); return; }
    } else if (requestType === "Staff Meal") {
        payload.item = document.getElementById('reqMealItem').value.trim(); 
        payload.amount = parseFloat(document.getElementById('reqMealCost').value);
        if (!payload.item || isNaN(payload.amount) || payload.amount < 0) { alert("❌ Item and cost required."); return; }
        
        // 🔥 UPLOAD THE PROOF IMAGE
        let imageFile = document.getElementById('reqMealProof').files[0];
        if (imageFile) {
            try {
                let btns = document.querySelectorAll('#formReqMeal button');
                if(btns.length > 0) btns[0].innerText = "Uploading proof...";
                
                const fileExt = imageFile.name.split('.').pop();
                const fileName = `staff_requests/meal_${Date.now()}.${fileExt}`;
                const storageRef = ref(window.storage, fileName); 
                const snapshot = await uploadBytes(storageRef, imageFile);
                payload.proofImageUrl = await getDownloadURL(snapshot.ref);
            } catch (e) { console.error("Upload failed", e); }
        }
    } else if (requestType === "Reason Letter") {
        let alertId = document.getElementById('explainAlertId').value;
        if (!alertId || alertId.includes("Loading")) {
             alert("❌ Please select a specific variance or shift to explain."); return;
        }
    }
    
    try {
        await addDoc(collection(db, "staff_requests"), payload);
        alert(`✅ Success! ${requestType} submitted.`);
        
        // Clean up the forms
        document.getElementById('reqAdvAmount').value = ''; document.getElementById('reqAdvReason').value = '';
        document.getElementById('reqLeaveStart').value = ''; document.getElementById('reqLeaveEnd').value = '';
        document.getElementById('reqLeaveReason').value = ''; document.getElementById('reqMealItem').value = '';
        document.getElementById('reqMealCost').value = ''; 
        
        // Reset the button text if it was changed
        let btns = document.querySelectorAll('#formReqMeal button');
        if(btns.length > 0) btns[0].innerText = "Log Staff Meal";

        document.getElementById('staffRequestsModal').style.display = 'none';
    } catch (error) { 
        console.error(error); 
        alert("❌ Failed to submit."); 
        let btns = document.querySelectorAll('#formReqMeal button');
        if(btns.length > 0) btns[0].innerText = "Log Staff Meal";
    }
};

// ==========================================
// 🔪 KITCHEN PREP ENGINE
// ==========================================
window.loadKitchenPrep = async function() {
    let container = document.getElementById('kitchenPrepList');
    if (!container) return;
    
    let branch = localStorage.getItem('takodeal_device_branch') || (window.sessionUser ? window.sessionUser.branch : null);
    if (!branch) {
        container.innerHTML = `<div style="color:#ef4444; text-align:center; grid-column:1/-1;">Error: Cannot detect your branch.</div>`;
        return;
    }

    container.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b; grid-column:1/-1;">Fetching Prep Items for ${branch}...</div>`;

    try {
        // 🔥 FIX: Read directly from your Manager App's POS Config Hub!
        const configSnap = await getDoc(doc(db, "settings", "global_pos_config"));
        let allowedCats = ["Prepared Batch"]; // Default fallback
        if (configSnap.exists() && configSnap.data().kitchenPrepCats && configSnap.data().kitchenPrepCats.length > 0) {
            allowedCats = configSnap.data().kitchenPrepCats;
        }

        // Search inventory using the exact categories you typed in the Manager App
        const q = query(collection(db, "inventory"), where("branch", "==", branch), where("category", "in", allowedCats));
        const snap = await getDocs(q);
        
        let html = '';
        if (snap.empty) {
            html = `<div style="text-align:center; padding:20px; color:#64748b; grid-column:1/-1;">No Kitchen Prep items found. Make sure your items' categories match what you typed in the POS Config Hub.</div>`;
        } else {
            snap.forEach(docSnap => {
                let d = docSnap.data();
                html += `
                    <div style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; background: #ffffff; text-align: center;">
                        <h3 style="margin: 0 0 10px 0; color: #0f172a; font-size: 16px;">${d.name}</h3>
                        <p style="margin: 0 0 15px 0; color: #64748b; font-size: 12px;">Current Stock: <strong style="color:#0f172a;">${(d.currentStock||0).toFixed(1)} ${d.baseUom || 'batch'}</strong></p>
                        <button onclick="window.logPrepBatch('${docSnap.id}', '${d.name}', '${branch}')" style="background: #f59e0b; color: white; border: none; padding: 10px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);">
                            + Log 1 Batch Made
                        </button>
                    </div>
                `;
            });
        }
        container.innerHTML = html;
    } catch (e) {
        console.error("Prep Load Error:", e);
        container.innerHTML = `<div style="color:#ef4444; text-align:center; grid-column:1/-1;">Failed to load items. Check connection.</div>`;
    }
};

window.logPrepBatch = async function(invId, itemName, branch) {
    let qty = prompt(`How many batches of ${itemName} did you prepare today?`, "1");
    if (!qty || isNaN(qty) || qty <= 0) return;
    
    qty = parseFloat(qty);
    if (!confirm(`Confirm logging ${qty} batch(es) of ${itemName}?\n\nThis will automatically restore negative stocks and deduct the raw ingredients used.`)) return;

    try {
        const invRef = doc(db, "inventory", invId);
        
        // 1. ADD TO PREP BATCH INVENTORY 
        const invSnap = await getDoc(invRef);
        let invData = invSnap.data();
        let currentStock = invData.currentStock || 0;
        
        // 🔥 THE FIX: Multiply by the Conversion Rate so it adds Grams, not just "1"!
        let convRate = parseFloat(invData.conversionRate) || parseFloat(invData.conversion) || 1;
        let baseQtyToAdd = qty * convRate;

        await updateDoc(invRef, {
            currentStock: currentStock + baseQtyToAdd
        });

        // 2. AUTO-DEDUCT RAW INGREDIENTS VIA BOM
        const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
        const bomSnap = await getDocs(bomQ);
        
        let missingItems = [];

        if (!bomSnap.empty) {
            for (let bomDoc of bomSnap.docs) {
                let recipe = bomDoc.data();
                let rawIngredient = recipe.ingredientName;
                
                // Deduct the ingredients based on how many BATCHES they made
                let totalAmountToDeduct = (recipe.qty || 0) * qty; 

                const rawQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", rawIngredient));
                const rawSnap = await getDocs(rawQ);

                if (!rawSnap.empty) {
                    let rawRef = rawSnap.docs[0].ref;
                    let rawCurrentStock = rawSnap.docs[0].data().currentStock || 0;
                    
                    await updateDoc(rawRef, { currentStock: rawCurrentStock - totalAmountToDeduct });
                } else {
                    missingItems.push(rawIngredient);
                }
            }
        }

        // 3. LOG THE ACTION FOR THE OWNER'S AUDIT TRAIL
        let safeCashierName = localStorage.getItem('cashierName') || "Kitchen Staff";
        await addDoc(collection(db, "stock_logs"), {
            branch: branch,
            item: itemName,
            variance: baseQtyToAdd, // 🔥 Logs the actual Grams added!
            type: "End-of-Shift Kitchen Prep",
            note: `Prepared ${qty} batch(es) by ${safeCashierName}`,
            timestamp: new Date()
        });

        // 4. SHOW SUCCESS MESSAGE
        let msg = `✅ Successfully logged ${qty} batch(es) of ${itemName}!\nAdded +${baseQtyToAdd.toLocaleString()} ${invData.uom || invData.baseUom} to the vault.`;
        if (missingItems.length > 0) {
            msg += `\n\n⚠️ Warning: The following raw ingredients are missing from the ${branch} warehouse and were not deducted: ${missingItems.join(", ")}`;
        }
        
        alert(msg);
        window.loadKitchenPrep(); // Instantly refresh the UI
        
    } catch (e) {
        console.error("Prep Batch Error:", e);
        alert("❌ Failed to log prep batch. Check console.");
    }
};

// ==========================================
// 📱 MOBILE ORDERS ENGINE & LISTENER
// ==========================================
window.mobileOrdersList = [];
window.mobileOrdersUnsubscribe = null;
window.hasLoadedMobileOrdersOnce = false; // Memory to track logins

window.startMobileOrdersListener = function(branch) {
    if (window.mobileOrdersUnsubscribe) {
        window.mobileOrdersUnsubscribe(); 
    }

    const q = window.query(
        window.collection(window.db, "incoming_orders"),
        window.where("branch", "==", branch),
        window.where("status", "==", "mobile_queue")
    );

    window.mobileOrdersUnsubscribe = window.onSnapshot(q, (snapshot) => {
        window.mobileOrdersList = [];
        let newOrdersFound = false;

        snapshot.forEach((doc) => {
            window.mobileOrdersList.push({ id: doc.id, ...doc.data() });
        });

        // Check if a brand new order arrived while they were staring at the screen
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" && window.hasLoadedMobileOrdersOnce) {
                newOrdersFound = true;
            }
        });

        // Update the Red Notification Badge
        let badge = document.getElementById('mobileBadge');
        if (badge) {
            if (window.mobileOrdersList.length > 0) {
                badge.innerText = window.mobileOrdersList.length;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }

        // Refresh UI if the cashier is currently looking at the modal
        if (document.getElementById('mobileOrdersModal').style.display === 'flex') {
            window.showMobileOrders();
        }

        // 🔥 THE NEW RING LOGIC: 
        // Ring if a new order arrives OR if they just logged in and an order is waiting!
        if (newOrdersFound || (!window.hasLoadedMobileOrdersOnce && window.mobileOrdersList.length > 0)) {
            window.startMobileOrderAlarm();
        }

        window.hasLoadedMobileOrdersOnce = true; // Mark that they have officially logged in
    });
};

// Generates a simple, loud browser "ding" without needing an audio file
// --- THE LOUD NOTIFICATION PING FIX ---
// --- THE LOUD 10-SECOND REPEATING ALARM ENGINE ---
window.audioCtx = null;
window.orderAlarmInterval = null;
window.orderAlarmTimeout = null;

window.playNotificationPing = function() {
    try {
        if (!window.audioCtx) window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (window.audioCtx.state === 'suspended') window.audioCtx.resume();

        const osc1 = window.audioCtx.createOscillator();
        const gain1 = window.audioCtx.createGain();
        osc1.connect(gain1); gain1.connect(window.audioCtx.destination);
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(987.77, window.audioCtx.currentTime); 
        gain1.gain.setValueAtTime(1, window.audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, window.audioCtx.currentTime + 0.4);
        osc1.start(window.audioCtx.currentTime); osc1.stop(window.audioCtx.currentTime + 0.4);

        setTimeout(() => {
            try {
                const osc2 = window.audioCtx.createOscillator();
                const gain2 = window.audioCtx.createGain();
                osc2.connect(gain2); gain2.connect(window.audioCtx.destination);
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(1318.51, window.audioCtx.currentTime); 
                gain2.gain.setValueAtTime(1, window.audioCtx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, window.audioCtx.currentTime + 0.6);
                osc2.start(window.audioCtx.currentTime); osc2.stop(window.audioCtx.currentTime + 0.6);
            } catch(e){}
        }, 150);
    } catch (e) { console.error("Audio ping error:", e); }
};

window.startMobileOrderAlarm = function() {
    window.stopMobileOrderAlarm(); // Clear any existing alarm
    window.playNotificationPing(); // Play the first ring immediately
    
    // Repeat the ring every 2 seconds FOREVER until they check the order!
    window.orderAlarmInterval = setInterval(() => {
        // Auto-stop if the cashier opens the menu!
        if (document.getElementById('mobileOrdersModal').style.display === 'flex') {
            window.stopMobileOrderAlarm();
            return;
        }
        window.playNotificationPing();
    }, 2000);
};

window.stopMobileOrderAlarm = function() {
    if (window.orderAlarmInterval) clearInterval(window.orderAlarmInterval);
    // Removed the timeout clearer since the timeout no longer exists!
};

window.stopMobileOrderAlarm = function() {
    if (window.orderAlarmInterval) clearInterval(window.orderAlarmInterval);
    if (window.orderAlarmTimeout) clearTimeout(window.orderAlarmTimeout);
};

window.showMobileOrders = function() {
    window.stopMobileOrderAlarm();
    document.getElementById('mobileOrdersModal').style.display = 'flex';
    let container = document.getElementById('mobileListContainer');

    if (window.mobileOrdersList.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 20px; color: #777;">Queue is empty. No incoming orders.</div>';
        return;
    }

    let html = '';
    window.mobileOrdersList.forEach(o => {
        let itemsHtml = o.items.map(i => {
            return `<div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px; border-bottom:1px dashed #eee; padding-bottom:3px;">
                      <div><strong>${i.quantity}x ${i.name}</strong></div>
                      <div style="font-weight:bold;">₱${(i.price * i.quantity).toFixed(2)}</div>
                    </div>`;
        }).join('');

        let paymentColor = o.paymentMode === 'gcash' ? '#3b82f6' : '#f59e0b';
        let paymentLabel = o.paymentMode === 'gcash' ? 'GCash (Verify Ref: ' + (o.gcashRef || 'No Ref') + ')' : 'Cash (Pay at Counter)';

        // 🔥 THE NEW DELIVERY DETAILS (Fixed Variable Names!)
        let locText = o.deliveryAddress ? `<div style="font-size:12px; color:#475569; margin-top:8px; padding:8px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0;">📍 <strong>Delivery Address:</strong><br>${o.deliveryAddress}</div>` : '';
        let photoBtn = o.locationImage ? `<div style="margin-top:8px;"><a href="${o.locationImage}" target="_blank" style="background:#e0e7ff; color:#4f46e5; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; text-decoration:none; display:inline-block; border:1px solid #c7d2fe;">📸 View Landmark Photo</a></div>` : '';

        html += `<div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">
                        <strong style="font-size:16px;">👤 ${o.customerName}</strong>
                        <strong style="color:var(--primary); font-size:16px;">₱${(o.totalAmount || 0).toFixed(2)}</strong>
                    </div>
                    <div style="font-size: 12px; font-weight: bold; color: white; background: ${paymentColor}; padding: 8px; border-radius: 4px; text-align: center;">
                        ${paymentLabel}
                    </div>
                    ${locText}
                    ${photoBtn}
                    <div style="margin-bottom:15px; margin-top:15px;">${itemsHtml}</div>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-clear" style="flex:1; padding:10px; font-size:13px; color:#ef4444; border-color:#ef4444;" onclick="window.rejectMobileOrder('${o.id}')">✖ Reject</button>
                        <button class="btn-place" style="flex:2; padding:10px; font-size:13px;" onclick="window.acceptMobileOrder('${o.id}')">📥 Send to Cart</button>
                    </div>
                 </div>`;
    });
    container.innerHTML = html;
};

// ==========================================
// 🍔 UPGRADED MENU TOGGLE ENGINE (SEARCH + DROPDOWN)
// ==========================================

window.globalMenuToggleList = []; // Stores items in memory for instant searching

window.loadMenuManager = async function() {
    let container = document.getElementById('menuManagerList');
    let filterDropdown = document.getElementById('categoryFilter');
    
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b; grid-column:1/-1;">Fetching Menu...</div>';

    try {
        const snap = await window.getDocs(window.collection(window.db, "menu"));
        const hiddenCategories = ["consumables", "prep batch", "raw materials", "packaging"];
        let uniqueCategories = new Set();
        
        window.globalMenuToggleList = []; // Clear memory

        snap.forEach(docSnap => {
            let item = docSnap.data();
            item.id = docSnap.id;
            let catName = item.category || "Uncategorized";
            
            // Only push visible items to the manager list
            if (!hiddenCategories.includes(catName.toLowerCase())) {
                window.globalMenuToggleList.push(item);
                uniqueCategories.add(catName);
            }
        });

        // 1. Populate the Category Dropdown dynamically!
        let dropdownHtml = '<option value="All">All Items</option>';
        Array.from(uniqueCategories).sort().forEach(cat => {
            dropdownHtml += `<option value="${cat}">${cat}</option>`;
        });
        if (filterDropdown) filterDropdown.innerHTML = dropdownHtml;

        // 2. Render the grid
        window.renderMenuToggleList(window.globalMenuToggleList);

        let topTitle = document.getElementById('topBarTitle');
        if (topTitle) topTitle.innerText = "🍔 Menu Toggle";

    } catch (e) {
        console.error("Menu Toggle Error:", e);
        container.innerHTML = '<div style="color:red; grid-column:1/-1; text-align:center;">Error loading menu.</div>';
    }
};

window.renderMenuToggleList = function(itemsToRender) {
    let container = document.getElementById('menuManagerList');
    let html = '';

    if (itemsToRender.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b; grid-column:1/-1;">No items match your search.</div>';
        return;
    }

    itemsToRender.forEach(item => {
        let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let isAvail = !(item.unavailableAt && item.unavailableAt.includes(branch));
        let statusColor = isAvail ? '#16a34a' : '#ef4444';
        let statusText = isAvail ? 'Available' : 'Sold Out';
        let bgClass = isAvail ? 'white' : '#f8fafc';

        html += `
            <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; background: ${bgClass}; display: flex; flex-direction: column; justify-content: space-between; gap: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div style="width: 45px; height: 45px; border-radius: 8px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 22px; border: 1px solid #e2e8f0;">🍲</div>
                    <div style="flex: 1;">
                        <div style="font-weight: bold; color: #1e293b; font-size: 15px; line-height: 1.2;">${item.name}</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 600;">${item.category || 'Uncategorized'}</div>
                    </div>
                </div>
                <button onclick="window.toggleItemStatus('${item.id}', ${!isAvail})" style="width: 100%; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 14px; border: 2px solid ${statusColor}; color: ${statusColor}; background: ${isAvail ? 'transparent' : '#fef2f2'}; cursor: pointer; transition: all 0.2s;">
                    ${statusText} (Click to Change)
                </button>
            </div>
        `;
    });
    container.innerHTML = html;
};

// --- THE SMART SEARCH & FILTER FUNCTION ---
window.filterMenuToggle = function() {
    let searchText = document.getElementById('menuToggleSearch').value.toLowerCase();
    let selectedCategory = document.getElementById('categoryFilter').value;

    let filteredItems = window.globalMenuToggleList.filter(item => {
        let matchesSearch = item.name.toLowerCase().includes(searchText);
        let matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Instantly redraw the grid!
    window.renderMenuToggleList(filteredItems);
};

// --- THE SMART BRANCH-SPECIFIC TOGGLE ---
window.toggleItemStatus = async function(docId, makeAvailable) {
    try {
        let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        const itemRef = window.doc(window.db, "menu", docId);
        const itemSnap = await window.getDoc(itemRef);
        let unavailableBranches = itemSnap.data().unavailableAt || [];

        // Add or remove this specific branch from the "Sold Out" list
        if (makeAvailable) {
            unavailableBranches = unavailableBranches.filter(b => b !== branch);
        } else {
            if (!unavailableBranches.includes(branch)) unavailableBranches.push(branch);
        }

        // 1. Update Cloud
        await window.updateDoc(itemRef, { unavailableAt: unavailableBranches });
        
        // 2. Update local memory immediately!
        let item = window.globalMenuToggleList.find(i => i.id === docId);
        if (item) item.unavailableAt = unavailableBranches;
        
        // 3. Re-apply the search filter instantly
        window.filterMenuToggle(); 
        
    } catch (e) {
        console.error("Error updating status:", e);
        alert("Failed to update status.");
    }
};

// --- UPDATED MOBILE ORDER ACTIONS (FOR LIVE TRACKING) ---
window.acceptMobileOrder = async function(docId) {
    let order = window.mobileOrdersList.find(o => o.id === docId);
    if (!order) return;

    if (typeof cart !== 'undefined' && cart.length > 0) {
        if (!confirm("You have items in your current cart. Overwrite them with this mobile order?")) return;
    }

    cart = order.items.map(i => ({
        name: i.name,
        basePrice: i.price,
        variantName: 'Standard',
        variantPrice: i.price,
        qty: i.quantity,
        lineTotalFinal: i.price * i.quantity,
        discountType: 'none',
        discountVal: 0,
        addons: i.addons || {},
        notes: i.notes || '📱 Mobile App Order'
    }));

    document.getElementById('finalCustomerName').value = order.customerName;

    // UPDATE STATUS TO "PREPARING" INSTEAD OF DELETING!
    // (Because the listener only looks for "mobile_queue", it will still disappear from this screen)
    await window.updateDoc(window.doc(window.db, "incoming_orders", docId), {
        status: "preparing"
    });

    // 🔥 THE FIX: Cashier App must remember this ID! 🔥
    window.activeMobileOrderId = docId;

    if (typeof renderCart === 'function') renderCart();
    closeModal('mobileOrdersModal');
};

window.rejectMobileOrder = async function(docId) {
    if (!confirm("Are you sure you want to reject this order? The customer will be notified.")) return;
    
    // UPDATE STATUS TO "REJECTED" INSTEAD OF DELETING!
    await window.updateDoc(window.doc(window.db, "incoming_orders", docId), {
        status: "rejected"
    });
};

// ==========================================
// 🚚 GLOBAL DELIVERY TOGGLE ENGINE
// ==========================================
window.deliveryEnabled = true;

// Listens to the cloud to see if delivery is currently on or off
onSnapshot(doc(db, "settings", "global_delivery"), (docSnap) => {
    if (docSnap.exists()) {
        window.deliveryEnabled = docSnap.data().enabled;
    } else {
        window.deliveryEnabled = true; // Default to ON
    }
    
    let textEl = document.getElementById('deliveryStatusText');
    let btnEl = document.getElementById('btnToggleDelivery');
    
    if (textEl && btnEl) {
        textEl.innerText = window.deliveryEnabled ? "ON" : "OFF";
        btnEl.style.background = window.deliveryEnabled ? "#10b981" : "#ef4444"; // Green for ON, Red for OFF
    }
});

window.toggleGlobalDelivery = async function() {
    let newState = !window.deliveryEnabled;
    if (!confirm(`Are you sure you want to turn Delivery ${newState ? 'ON' : 'OFF'} for all customers across all branches?`)) return;
    
    try {
        await setDoc(doc(db, "settings", "global_delivery"), { 
            enabled: newState,
            lastChangedBy: localStorage.getItem('cashierName') || 'Cashier',
            timestamp: serverTimestamp()
        }, { merge: true });
    } catch(e) {
        console.error("Delivery Toggle Error", e);
        alert("❌ Failed to toggle delivery. Check connection.");
    }
};

window.closeAndNextOrder = function() {
    // 1. Close the modal
    document.getElementById('receiptModal').style.display = 'none';
    
    // 2. Check if the alarm was tripped during checkout
    if (window.pendingLowStockAlarm) {
        alert("⚠️ LOW STOCK ALERT\n\nSome ingredients used in the last order are running low. Please notify the Manager to check the Live Inventory dashboard.");
        window.pendingLowStockAlarm = false; // Reset the alarm
    }
};

window.openGrabEarningsModal = function() {
    document.getElementById('grabEarningsModal').style.display = 'flex';
    // Auto-set date to today based on their local time zone!
    let now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('grabEarnDate').value = now.toISOString().split('T')[0];
    document.getElementById('grabEarnAmount').value = '';
};

window.submitGrabEarnings = async function() {
    let dateVal = document.getElementById('grabEarnDate').value;
    let amount = parseFloat(document.getElementById('grabEarnAmount').value);
    let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
    let cashier = localStorage.getItem('cashierName') || 'Unknown';

    if (!dateVal || isNaN(amount)) { alert("Please fill out the date and amount."); return; }

    let btn = document.getElementById('btnSaveGrabEarn');
    btn.innerText = "Saving..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "grab_payouts"), {
            dateStr: dateVal, amount: amount, branch: branch, cashier: cashier, timestamp: serverTimestamp()
        });
        alert(`✅ Grab Net Earnings of ₱${amount.toFixed(2)} logged for ${dateVal}!`);
        document.getElementById('grabEarningsModal').style.display = 'none';
    } catch (e) {
        console.error(e); alert("Failed to log earnings.");
    } finally {
        btn.innerText = "💾 Save Earnings"; btn.disabled = false;
    }
};

// ==========================================
// 🚦 BUSY MODE / PREP TIME ENGINE
// ==========================================
window.isBusyMode = false;

window.toggleBusyMode = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) { alert("Branch not set!"); return; }

    window.isBusyMode = !window.isBusyMode;
    let btn = document.getElementById('btnToggleBusy');
    
    // Update UI
    if (window.isBusyMode) {
        btn.innerHTML = "🔴 BUSY MODE (+30m)";
        btn.style.background = "#ef4444";
    } else {
        btn.innerHTML = "🟢 Normal Prep (15m)";
        btn.style.background = "#10b981";
    }

    // Save to Firebase so the Customer App can see it!
    try {
        await window.setDoc(window.doc(window.db, "settings", "status_" + branch), { 
            busyMode: window.isBusyMode,
            lastUpdated: window.serverTimestamp()
        }, { merge: true });
    } catch(e) {
        console.error("Error setting busy mode:", e);
    }
};

// Check current status on load
setTimeout(async () => {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (branch) {
        window.onSnapshot(window.doc(window.db, "settings", "status_" + branch), (docSnap) => {
            if (docSnap.exists()) {
                window.isBusyMode = docSnap.data().busyMode || false;
                let btn = document.getElementById('btnToggleBusy');
                if (btn) {
                    if (window.isBusyMode) {
                        btn.innerHTML = "🔴 BUSY MODE (+30m)";
                        btn.style.background = "#ef4444";
                    } else {
                        btn.innerHTML = "🟢 Normal Prep (15m)";
                        btn.style.background = "#10b981";
                    }
                }
            }
        });
    }
}, 3000);

// ==========================================
// 🐙 TAKOYAKI MIX & MATCH ENGINE
// ==========================================
window.mixMatchState = {
    'Pork': 0,
    'Shrimp': 0,
    'Octopus': 0,
    'Ham & Cheese': 0,
    'Bacon & Cheese': 0
};
window.maxMixMatch = 8;

window.toggleMixMatchUI = function() {
    let panel = document.getElementById('mixMatchPanel');
    let icon = document.getElementById('mixMatchToggleIcon');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        icon.innerText = '▲';
    } else {
        panel.style.display = 'none';
        icon.innerText = '▼';
    }
};

window.adjustMixMatch = function(flavor, delta) {
    let currentTotal = Object.values(window.mixMatchState).reduce((a, b) => a + b, 0);
    if (delta > 0 && currentTotal >= window.maxMixMatch) {
        alert(`You can only select up to ${window.maxMixMatch} pieces for this size!`);
        return;
    }
    if (window.mixMatchState[flavor] + delta >= 0) {
        window.mixMatchState[flavor] += delta;
        window.renderMixMatchList();
    }
};

window.renderMixMatchList = function() {
    let list = document.getElementById('mixMatchList');
    let currentTotal = Object.values(window.mixMatchState).reduce((a, b) => a + b, 0);
    document.getElementById('mixMatchCounter').innerText = `${currentTotal} / ${window.maxMixMatch} Pcs`;

    let html = '';
    for (let flavor in window.mixMatchState) {
        let count = window.mixMatchState[flavor];
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 8px 12px; border-radius: 6px; border: 1px solid #fde68a;">
                <span style="font-size: 13px; font-weight: bold; color: #92400e;">${flavor}</span>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button class="btn-qty-small" style="width: 28px; height: 28px; border-color: #fcd34d; color: #d97706;" onclick="window.adjustMixMatch('${flavor}', -1)">-</button>
                    <span style="font-weight: bold; width: 20px; text-align: center; color: #92400e;">${count}</span>
                    <button class="btn-qty-small" style="width: 28px; height: 28px; border-color: #fcd34d; color: #d97706;" onclick="window.adjustMixMatch('${flavor}', 1)">+</button>
                </div>
            </div>
        `;
    }
    list.innerHTML = html;
};
