// 1. Check if the device knows where it is when the app loads
document.addEventListener("DOMContentLoaded", () => {
  let deviceBranch = localStorage.getItem('takodeal_device_branch');

  if (!deviceBranch) {
    // If it doesn't know, trap the user in the setup screen!
    document.getElementById('deviceSetupOverlay').style.display = 'flex';
  } else {
    // If it knows, show it on the login screen
    let locDisplay = document.getElementById('displayDeviceLocation');
    if (locDisplay) locDisplay.innerText = deviceBranch;

    // 🔥 VERY IMPORTANT: Override the global branch variable for the POS engine!
    window.POS_BRANCH = deviceBranch;
  }
});

// 2. The function to lock the device
window.lockDeviceToBranch = async function () {
  let selectedBranch = document.getElementById('setupBranchSelect').value;
  let deviceName = prompt("Give this device a name (e.g., 'Counter Tablet 1' or 'Samsung S23'):", "New Tablet");

  if (!deviceName) return; // Cancel if no name given

  try {
    // 1. Create a unique ID for this specific tablet
    let deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    // 2. Save to local memory (so the tablet remembers who it is)
    localStorage.setItem('takodeal_device_branch', selectedBranch);
    localStorage.setItem('takodeal_device_id', deviceId);
    localStorage.setItem('takodeal_device_name', deviceName);

    // 3. REGISTER WITH THE CLOUD (This makes it show up in the Manager App!)
    await addDoc(collection(db, "pos_devices"), {
      deviceId: deviceId,
      deviceName: deviceName,
      branch: selectedBranch,
      status: 'Active',
      registeredAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });

    alert(`✅ Success! This device is now registered and locked to ${selectedBranch}.`);
    location.reload();

  } catch (e) {
    console.error("Registration Error:", e);
    alert("❌ Failed to register device. Check internet connection.");
  }
};

// --- TAKODEAL FIREBASE ENGINE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp, doc, getDoc, updateDoc, limit, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Your secure database keys
const firebaseConfig = {
  apiKey: "AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4",
  authDomain: "takodeal-pos.firebaseapp.com",
  projectId: "takodeal-pos",
  storageBucket: "takodeal-pos.firebasestorage.app",
  messagingSenderId: "248826111383",
  appId: "1:248826111383:web:48bf1e2c172298079bd0d2"
};

// Ignite the Engine
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Make the database available to our POS
window.db = db;
window.query = query;
window.where = where;
window.collection = collection;
window.getDocs = getDocs;

console.log("🔥 Firebase Engine is LIVE!");

// --- THE FIREBASE PIN SEARCHER ---
window.verifyPin = async function (pin) {
  try {
    // 🔥 CHANGED "employees" to "cashiers" so it perfectly syncs with your Manager App!
    const q = query(collection(db, "cashiers"), where("pin", "==", pin));
    const snapshot = await getDocs(q);

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

// --- THE FIREBASE MENU FETCHER ---
window.fetchMenu = async function () {
  try {
    // 🔥 CHANGED from "products" to "menu" to sync with Manager HQ!
    const snapshot = await getDocs(collection(db, "menu"));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error fetching menu:", error);
    return [];
  }
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

// --- THE CHECKOUT ENGINE (WITH AUTO-DEDUCT & LOW STOCK ALARM) ---
window.processCheckout = async function (payload) {
  try {
    let d = new Date();
    let dateStr = d.getFullYear().toString() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0');
    let shiftCode = payload.shiftId ? payload.shiftId.slice(-4).toUpperCase() : "0000";

    const q = query(collection(db, "transactions"), where("shiftId", "==", payload.shiftId || ""));
    const snap = await getDocs(q);
    let orderNum = (snap.size + 1).toString().padStart(3, '0');
    const receiptId = `${dateStr}-${shiftCode}-${orderNum}`;

    await addDoc(collection(db, "transactions"), {
      ...payload, receiptId: receiptId, timestamp: serverTimestamp()
    });

    // 🔥 THE AUTO-DEDUCT & ALARM ENGINE 🔥
    let lowStockWarnings = []; // We will collect dying ingredients here

    if (payload.cart && Array.isArray(payload.cart)) {
      for (let cartItem of payload.cart) {
        let itemName = cartItem.name || cartItem.itemName;
        let qtySold = cartItem.qty || 1;

        const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
        const bomSnap = await getDocs(bomQ);

        for (let bomDoc of bomSnap.docs) {
          let recipeData = bomDoc.data();
          let ingredientName = recipeData.ingredientName;
          let recipeQtyNeeded = recipeData.qty || 0;
          let totalAmountToDeduct = recipeQtyNeeded * qtySold;

          const invQ = query(collection(db, "inventory"), where("branch", "==", payload.branch), where("name", "==", ingredientName));
          const invSnap = await getDocs(invQ);

          if (!invSnap.empty) {
            let invDocRef = invSnap.docs[0].ref;
            let invData = invSnap.docs[0].data();
            let currentStock = invData.currentStock || 0;
            let reorderLevel = invData.reorderLevel || 5; // The safe line!

            let newStock = currentStock - totalAmountToDeduct;

            // Update the cloud quietly
            await updateDoc(invDocRef, { currentStock: newStock });

            // 🚨 TRIGGER THE RADAR: If it drops below the safe line, remember it!
            if (newStock <= reorderLevel) {
              // Prevent duplicates if multiple items use the same ingredient
              if (!lowStockWarnings.includes(ingredientName)) {
                lowStockWarnings.push(ingredientName);
              }
            }
          }
        }
      }
    }

    // 🚨 SOUND THE ALARM AFTER CHECKOUT 🚨
    if (lowStockWarnings.length > 0) {
      setTimeout(() => {
        alert(`⚠️ LOW STOCK WARNING ⚠️\n\nPlease notify the Manager immediately!\nThe following items are running critically low:\n\n- ${lowStockWarnings.join('\n- ')}`);
      }, 500); // Waits half a second so the receipt screen loads first
    }

    return receiptId;
  } catch (error) {
    console.error(error);
    return null;
  }
};

// --- THE DASHBOARD ENGINE ---
window.getSalesDashboardData = async function (branch, shiftStartTime) {
  try {
    // ANTI-FRAUD: If there is no shift start time, refuse to show sales!
    if (!shiftStartTime) return [];

    // Search for transactions ONLY from this branch, and ONLY after the shift started
    const q = query(collection(db, "transactions"),
      where("branch", "==", branch),
      where("timestamp", ">=", shiftStartTime)
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

    // 1. Get Transactions
    const txQ = query(collection(db, "transactions"), where("branch", "==", branch), where("timestamp", ">=", shiftData.startTime));
    const txSnap = await getDocs(txQ);

    // 2. Get Expenses (Cash Out)
    const expQ = query(collection(db, "expenses"), where("branch", "==", branch), where("timestamp", ">=", shiftData.startTime));
    const expSnap = await getDocs(expQ);
    let totalExpenses = 0;
    expSnap.forEach(e => { totalExpenses += (e.data().amount || 0); });

    let cashIn = 0;
    txSnap.forEach(d => {
      let tx = d.data();
      // Only count cash that wasn't voided!
      if (tx.status !== "Voided" && tx.paymentMethod === "Cash") {
        cashIn += tx.netTotal || 0;
      }
    });

    return {
      logId: shiftDoc.id, startedBy: shiftData.cashier,
      startTime: shiftData.startTime.toDate().toISOString(),
      startingCash: shiftData.startingCash || 0,
      cashIn: cashIn,
      cashOut: totalExpenses, // Now we track expenses!
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

// --- VOID & DETAILS ENGINE ---
window.voidTransaction = async function (receiptId, cashierName, branch) {
  try {
    const q = query(collection(db, "transactions"), where("receiptId", "==", receiptId));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("Transaction not found");
    const docId = snap.docs[0].id;

    // 1. Void the transaction
    await updateDoc(doc(db, "transactions", docId), { status: "Voided", voidedBy: cashierName, voidTime: serverTimestamp() });

    // 2. 🔥 THE MANAGER ALARM: Write to the push notification pipeline!
    await addDoc(collection(db, "manager_alerts"), {
      type: "VOID_ALERT",
      branch: branch,
      cashier: cashierName,
      receiptId: receiptId,
      message: `WARNING: Cashier ${cashierName} voided Receipt ${receiptId}.`,
      timestamp: serverTimestamp(),
      isRead: false
    });

    return true;
  } catch (e) { console.error(e); throw e; }
};

// --- MISSING RECEIPT DETAILS ENGINE ---
window.getReceiptDetails = async function (receiptId) {
  try {
    const q = query(collection(db, "transactions"), where("receiptId", "==", receiptId));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data();
  } catch (e) {
    console.error(e);
    return null;
  }
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
window.openEndShiftClearance = function () {
  buildDenominationTable();
  // Clear out old physical counts
  ['count320cc', 'count520cc', 'countBoxes', 'countStraws'].forEach(id => {
    if (document.getElementById(id)) document.getElementById(id).value = '';
  });
  document.getElementById('endShiftModal').style.display = 'flex';
};

// ========================================================
// 🛑 SUBMIT COMPREHENSIVE SHIFT CLOSE (WITH ANTI-FRAUD ALARM)
// ========================================================
window.submitComprehensiveCloseShift = async function () {
  // 1. Get the exact total they counted
  let declaredCash = calculateDenominations();

  // 2. Gather the Cash Breakdown for the history logs
  let cashBreakdown = {};
  denominations.forEach(d => {
    cashBreakdown[`₱${d}`] = parseInt(document.getElementById(`qty${d}`).value) || 0;
  });

  // 3. Gather Physical Stock Counts
  let physicalStock = {
    '320cc Paper Bowls': parseInt(document.getElementById('count320cc').value) || 0,
    '520cc Paper Bowls': parseInt(document.getElementById('count520cc').value) || 0,
    'Takoyaki Boxes': parseInt(document.getElementById('countBoxes').value) || 0,
    'Straws': parseInt(document.getElementById('countStraws').value) || 0
  };

  // 4. Update the Shift in Firebase
  try {
    let shiftId = activeShiftDetails.logId;
    if (!shiftId) {
      alert("No active shift found to close.");
      return;
    }

    // Save everything to the database
    await updateDoc(doc(db, "shifts", shiftId), {
      active: false,
      endTime: serverTimestamp(),
      declaredCash: declaredCash,
      cashBreakdown: cashBreakdown, // The exact 1000s, 500s, etc.
      physicalStockCount: physicalStock, // The exact cups, boxes, etc.
      status: "Closed"
    });

    // 🔥 THE ANTI-FRAUD ALARM ENGINE 🔥
    let expectedCash = activeShiftDetails.expectedCash || 0;
    let variance = declaredCash - expectedCash;

    if (variance !== 0) {
      let branchName = localStorage.getItem('takodeal_device_branch') || 'Unknown';
      let currentCashier = localStorage.getItem('cashierName') || 'Unknown';
      let varianceType = variance < 0 ? "SHORT" : "OVER";
      
      await addDoc(collection(db, "manager_alerts"), {
        type: "VARIANCE_ALERT",
        branch: branchName,
        cashier: currentCashier,
        shiftId: shiftId,
        expected: expectedCash,
        declared: declaredCash,
        varianceAmount: variance,
        stockCounts: physicalStock, // We send you their stock counts to check for cheating!
        message: `CASH ${varianceType}: ₱${Math.abs(variance).toFixed(2)} variance detected.`,
        explanationCause: "Awaiting Staff Letter...",
        explanationMessage: "",
        explanationStatus: "Pending", // You will approve this in the Manager App!
        timestamp: serverTimestamp(),
        isRead: false
      });
    }

    alert("✅ Shift Closed Successfully! Breakdown and Inventory logs have been sent to the Manager App.");

    // Clear Local Storage
    localStorage.removeItem('currentShiftId');
    if (typeof closeModal === 'function') closeModal('endShiftModal');
    else document.getElementById('endShiftModal').style.display = 'none';

    // Refresh the UI to lock the register
    if (typeof checkCurrentShift === 'function') {
      checkCurrentShift();
    }

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
// REASON LETTER ENGINE
// ==========================================
window.openExplanationModal = async function() {
    let cashier = localStorage.getItem('cashierName') || localStorage.getItem('activeCashier');
    let selectList = document.getElementById('explainAlertId');
    selectList.innerHTML = '<option>Loading your records...</option>';
    document.getElementById('explanationModal').style.display = 'flex';

    try {
        // Find ONLY the unresolved shorts/overs for this specific cashier!
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
        selectList.innerHTML = '<option value="">Error connecting. Press F12 to check Firebase Index.</option>';
    }
};

window.submitReasonLetter = async function() {
    let alertId = document.getElementById('explainAlertId').value;
    let cause = document.getElementById('explainCause').value;
    let message = document.getElementById('explainMessage').value;

    if (!alertId) { alert("No variance selected."); return; }
    if (!message) { alert("You must type a detailed explanation."); return; }

    try {
        // Update the Manager Alert with the Cashier's confession
        await updateDoc(doc(db, "manager_alerts", alertId), {
            explanationCause: cause,
            explanationMessage: message,
            explanationStatus: "Submitted - Awaiting Owner Approval"
        });

        alert("✅ Reason Letter successfully sent to the Owner's Security Feed.");
        document.getElementById('explanationModal').style.display = 'none';
        document.getElementById('explainMessage').value = '';

    } catch (e) {
        console.error(e); alert("Failed to send letter.");
    }
};

// ==========================================
// 📍 GPS & SELFIE TIME CLOCK ENGINE
// ==========================================

// ⚠️ BOSS JOSTUART: UPDATE THESE COORDINATES!
const BRANCH_ZONES = {
    "Cabantian": { lat: 7.130420626391755, lng: 125.61730998805625 }, 
    "Citygate": { lat: 7.111077615812063, lng: 125.61288981236622 },  
    "Maa": { lat: 7.078642149249695, lng: 125.58343773215358 },       
    "Main Office": { lat: 7.1539090939416266, lng: 125.59588373531139 }
};

const ALLOWED_RADIUS_METERS = 100; // The digital fence size!
let cameraStream = null;

// 1. Haversine Formula to calculate exact meters between two GPS points
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const deltaP = (lat2-lat1) * Math.PI/180;
    const deltaLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(deltaP/2) * Math.sin(deltaP/2) +
              Math.cos(p1) * Math.cos(p2) *
              Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 2. Open Modal & Turn on Front Camera
let currentBranchStaffCache = []; // Caches staff data to check PINs!

window.openTimeClockModal = async function() {
    document.getElementById('timeClockModal').style.display = 'flex';
    document.getElementById('clockStaffPin').value = ''; // Reset PIN
    
    let select = document.getElementById('clockStaffName');
    select.innerHTML = '<option value="">Loading Staff...</option>';

    try {
        // Fetch staff assigned to this specific tablet's branch
        let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        const q = query(collection(db, "cashiers"), where("branch", "in", [branch, "Main Office"]));
        const snap = await getDocs(q);
        
        currentBranchStaffCache = [];
        let html = '<option value="">-- Select Your Name --</option>';
        snap.forEach(doc => {
            let data = doc.data();
            currentBranchStaffCache.push(data); // Save in memory for PIN checking
            html += `<option value="${data.cashierName}">${data.cashierName}</option>`;
        });
        select.innerHTML = html;

        // Start Camera
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        document.getElementById('clockVideo').srcObject = cameraStream;
    } catch (e) {
        console.error("Camera/DB Error:", e);
        alert("⚠️ Error loading Time Clock. Check Camera permissions.");
    }
};

// 3. Close Modal & Turn off Camera
window.closeTimeClock = function() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    document.getElementById('timeClockModal').style.display = 'none';
};

// 4. The Main Submit Function
window.submitAttendance = async function(type) {
    const staffName = document.getElementById('clockStaffName').value;
    const inputPin = document.getElementById('clockStaffPin').value.trim();

    if (!staffName) { alert("❌ Please select your name."); return; }
    if (!inputPin) { alert("❌ Please enter your 4-Digit Security PIN."); return; }

    // 🔥 PIN SECURITY CHECK
    let staffProfile = currentBranchStaffCache.find(s => s.cashierName === staffName);
    if (!staffProfile || staffProfile.pin !== inputPin) {
        alert("❌ INTRUDER ALERT: Incorrect PIN for " + staffName);
        document.getElementById('clockStaffPin').value = ''; // wipe it
        return;
    }

    const branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
    const targetZone = BRANCH_ZONES[branch];

    if (!targetZone) {
        alert(`❌ GPS Configuration Missing for ${branch}. Please contact the Owner.`); return;
    }

    // A. Snap the Photo!
    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.6); 

    // B. Get GPS & Validate
    if (!navigator.geolocation) { alert("❌ Geolocation is not supported."); return; }

    let buttons = document.querySelectorAll('#timeClockModal button');
    buttons.forEach(b => b.disabled = true);

    navigator.geolocation.getCurrentPosition(async (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        const distance = getDistanceInMeters(userLat, userLng, targetZone.lat, targetZone.lng);

        if (distance > ALLOWED_RADIUS_METERS) {
            alert(`🚨 SECURITY LOCKOUT!\n\nYou are ${Math.round(distance)} meters away from the ${branch} branch.\nYou must be within ${ALLOWED_RADIUS_METERS} meters to clock in or out!`);
            buttons.forEach(b => b.disabled = false); return;
        }

        try {
            await addDoc(collection(db, "attendance_logs"), {
                staffName: staffName, branch: branch, type: type, timestamp: new Date(),
                locationLat: userLat, locationLng: userLng, distanceMeters: Math.round(distance),
                photoBase64: photoBase64
            });

            alert(`✅ ${type} SUCCESS!\n\nIdentity and Location Verified for ${staffName}.`);
            window.closeTimeClock();
        } catch (error) {
            console.error(error); alert("❌ Failed to log attendance.");
        } finally { buttons.forEach(b => b.disabled = false); }

    }, (error) => {
        alert("❌ GPS access is required to use the Time Clock.");
        buttons.forEach(b => b.disabled = false);
    }, { enableHighAccuracy: true }); 
};

// ==========================================
// 📝 STAFF REQUEST & DEDUCTION HUB ENGINE
// ==========================================

window.openStaffRequestsModal = function() {
    document.getElementById('staffRequestsModal').style.display = 'flex';
    window.switchRequestTab('Advance'); // Default to Cash Advance tab
};

window.switchRequestTab = function(tabName) {
    const tabs = ['Advance', 'Leave', 'Meal', 'Reason', 'Inbox'];
    tabs.forEach(t => {
        let btn = document.getElementById('tabReq' + t);
        let form = document.getElementById('formReq' + t);
        if (!btn || !form) return;
        
        if (t === tabName) {
            btn.style.borderBottom = "3px solid #3b82f6";
            btn.style.color = "#0f172a";
            btn.style.background = "white";
            form.style.display = "block";
            // 🔥 If they open Inbox, trigger the fetch!
            if (tabName === 'Inbox') window.loadStaffPersonalInbox();
        } else {
            btn.style.borderBottom = "3px solid transparent";
            btn.style.color = "#64748b";
            btn.style.background = "transparent";
            form.style.display = "none";
        }
    });
};

window.loadStaffPersonalInbox = async function() {
    let container = document.getElementById('staffPersonalInboxList');
    container.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">Loading your records...</div>';

    try {
        // Fetch requests ONLY for the currently logged-in cashier
        const q = query(collection(db, "staff_requests"), where("staffName", "==", sessionUser.cashierName), orderBy("timestamp", "desc"));
        const snap = await getDocs(q);
        
        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleDateString() : 'Recent';
            
            // Format Status Badges
            let statusBadge = `<span style="background: #fef9c3; color: #d97706; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">Pending Review</span>`;
            if (d.status === "Approved") statusBadge = `<span style="background: #dcfce7; color: #15803d; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">✅ Approved</span>`;
            if (d.status === "Rejected") statusBadge = `<span style="background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">❌ Rejected</span>`;

            html += `
                <div style="background: white; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <strong style="color: #334155;">${d.type}</strong>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 12px; color: #64748b; margin-bottom: 5px;">Submitted: ${dateStr}</div>
                    <div style="font-size: 14px; font-weight: bold; color: var(--primary);">
                        ${d.amount ? '₱' + d.amount : ''} ${d.item || d.leaveType || ''}
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html || '<div style="padding:20px; text-align:center; color:#64748b;">No requests found.</div>';
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Error checking inbox.</div>';
    }
};

window.submitStaffRequest = async function(requestType) {
    let payload = {
        type: requestType,
        staffName: sessionUser.cashierName,
        branch: sessionUser.branch,
        status: "Pending", // Owner needs to approve/review these in Manager App
        timestamp: new Date()
    };

    // Gather data based on the type of request
    if (requestType === "Cash Advance") {
        payload.amount = parseFloat(document.getElementById('reqAdvAmount').value);
        payload.reason = document.getElementById('reqAdvReason').value.trim();
        if (isNaN(payload.amount) || payload.amount <= 0 || !payload.reason) {
            alert("❌ Please enter a valid amount and reason."); return;
        }
    } 
    else if (requestType === "Leave") {
        payload.startDate = document.getElementById('reqLeaveStart').value;
        payload.endDate = document.getElementById('reqLeaveEnd').value;
        payload.leaveType = document.getElementById('reqLeaveType').value;
        payload.reason = document.getElementById('reqLeaveReason').value.trim();
        if (!payload.startDate || !payload.endDate || !payload.reason) {
            alert("❌ Please fill out all dates and a reason."); return;
        }
    }
    else if (requestType === "Staff Meal") {
        payload.item = document.getElementById('reqMealItem').value.trim();
        payload.amount = parseFloat(document.getElementById('reqMealCost').value);
        if (!payload.item || isNaN(payload.amount) || payload.amount < 0) {
            alert("❌ Please enter the item consumed and a valid deduction cost."); return;
        }
    }
    else if (requestType === "Reason Letter") {
        payload.alertId = document.getElementById('explainAlertId').value;
        payload.cause = document.getElementById('explainCause').value;
        payload.message = document.getElementById('explainMessage').value.trim();
        if (!payload.message) {
            alert("❌ Please provide a detailed explanation."); return;
        }
    }

    try {
        // Send to a unified "staff_requests" collection in Firebase
        await addDoc(collection(db, "staff_requests"), payload);
        
        alert(`✅ Success! Your ${requestType} has been securely submitted to the Main Office for review.`);
        
        // Clear the forms
        document.getElementById('reqAdvAmount').value = '';
        document.getElementById('reqAdvReason').value = '';
        document.getElementById('reqLeaveStart').value = '';
        document.getElementById('reqLeaveEnd').value = '';
        document.getElementById('reqLeaveReason').value = '';
        document.getElementById('reqMealItem').value = '';
        document.getElementById('reqMealCost').value = '';
        document.getElementById('explainMessage').value = '';

        document.getElementById('staffRequestsModal').style.display = 'none';

    } catch (error) {
        console.error("Error submitting request:", error);
        alert("❌ Failed to submit request to the cloud. Check internet connection.");
    }
};

// ==========================================
// 🚪 SIGN OUT ENGINE
// ==========================================
window.logoutCashier = function() {
    if (confirm("Are you sure you want to sign out of this account?")) {
        localStorage.removeItem('cashierName'); // Clear memory
        sessionUser = null;
        location.reload(); // Instantly returns to the PIN Lock screen
    }
};

// ==========================================
// 💸 REMIT CASH TO HQ ENGINE
// ==========================================
window.openRemittanceModal = function() {
    document.getElementById('remittanceModal').style.display = 'flex';
    document.getElementById('remitCashier').value = sessionUser.cashierName;
    
    // Auto-fill dates with today
    let today = new Date().toISOString().split('T')[0];
    document.getElementById('remitStartDate').value = today;
    document.getElementById('remitEndDate').value = today;
    
    window.switchRemittanceTab('form');
    
    // Load HQ Bank Accounts for the dropdown!
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
        const q = query(collection(db, "cash_accounts"));
        const snap = await getDocs(q);
        let html = '<option value="">-- Select Transfer Method --</option>';
        snap.forEach(doc => {
            html += `<option value="${doc.data().name}">${doc.data().name}</option>`;
        });
        html += '<option value="Physical Handover">Physical Handover (Cash)</option>';
        select.innerHTML = html;
    } catch (e) {
        console.error("Error loading accounts:", e);
    }
};

window.submitRemittance = async function() {
    let payload = {
        branch: sessionUser.branch,
        cashier: sessionUser.cashierName,
        salesPeriodStart: document.getElementById('remitStartDate').value,
        salesPeriodEnd: document.getElementById('remitEndDate').value,
        amount: parseFloat(document.getElementById('remitAmount').value),
        channel: document.getElementById('remitChannel').value,
        recipient: document.getElementById('remitRecipient').value.trim(),
        referenceNumber: document.getElementById('remitRefNum').value.trim(),
        status: "Pending", // HQ needs to approve it!
        timestamp: serverTimestamp()
    };

    if (isNaN(payload.amount) || payload.amount <= 0 || !payload.channel || !payload.recipient) {
        alert("❌ Please fill out Amount, Channel, and Recipient."); return;
    }

    try {
        await addDoc(collection(db, "remittances"), payload);
        alert("✅ Remittance securely sent to HQ! Waiting for Owner's approval.");
        
        document.getElementById('remitAmount').value = '';
        document.getElementById('remitRefNum').value = '';
        window.switchRemittanceTab('history');
    } catch (e) {
        console.error(e); alert("❌ Failed to send remittance.");
    }
};

window.loadRemittanceHistory = async function() {
    const tbody = document.getElementById('remitHistoryTableBody');
    tbody.innerHTML = '<tr><td style="padding:20px; text-align:center;">Fetching history...</td></tr>';
    try {
        const q = query(collection(db, "remittances"), where("branch", "==", sessionUser.branch), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
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
        console.error(e); tbody.innerHTML = '<tr><td style="padding:20px; text-align:center; color:red;">Error loading history.</td></tr>';
    }
};
