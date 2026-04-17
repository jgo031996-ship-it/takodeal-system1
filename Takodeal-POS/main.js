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
// 🛑 SUBMIT COMPREHENSIVE SHIFT CLOSE
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

    alert("✅ Shift Closed Successfully! Breakdown and Inventory logs have been sent to the Manager App.");

    // Clear Local Storage
    localStorage.removeItem('currentShiftId');
    closeModal('endShiftModal');

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
// 💸 REMITTANCE ENGINE (CASHIER APP)
// ========================================================
window.openRemittanceModal = function () {
  document.getElementById('remittanceModal').style.display = 'flex';
  switchRemittanceTab('form');

  // 🧠 Automatic Memory Grabber (Same as Shift engine)
  let currentCashier = localStorage.getItem('cashierName') || localStorage.getItem('activeCashier') || '';
  document.getElementById('remitCashier').value = currentCashier;
};

// Controls the Tabs
window.switchRemittanceTab = function (tab) {
  if (tab === 'form') {
    document.getElementById('remitFormSection').style.display = 'block';
    document.getElementById('remitHistorySection').style.display = 'none';
    document.getElementById('tabRemitForm').style.borderBottom = '3px solid #047857';
    document.getElementById('tabRemitForm').style.background = 'white';
    document.getElementById('tabRemitForm').style.color = '#000';
    document.getElementById('tabRemitHistory').style.borderBottom = '3px solid transparent';
    document.getElementById('tabRemitHistory').style.background = 'transparent';
    document.getElementById('tabRemitHistory').style.color = '#64748b';
  } else {
    document.getElementById('remitFormSection').style.display = 'none';
    document.getElementById('remitHistorySection').style.display = 'block';
    document.getElementById('tabRemitHistory').style.borderBottom = '3px solid #047857';
    document.getElementById('tabRemitHistory').style.background = 'white';
    document.getElementById('tabRemitHistory').style.color = '#000';
    document.getElementById('tabRemitForm').style.borderBottom = '3px solid transparent';
    document.getElementById('tabRemitForm').style.background = 'transparent';
    document.getElementById('tabRemitForm').style.color = '#64748b';

    // Automatically fetch history when clicking the tab
    loadRemittanceHistory();
  }
};

// Submit to Database
window.submitRemittance = async function () {
  let branch = localStorage.getItem('takodeal_device_branch') || localStorage.getItem('branch') || 'Unknown Branch';
  let startDate = document.getElementById('remitStartDate').value;
  let endDate = document.getElementById('remitEndDate').value;
  let cashier = document.getElementById('remitCashier').value;
  let amount = parseFloat(document.getElementById('remitAmount').value);
  let channel = document.getElementById('remitChannel').value;
  let recipient = document.getElementById('remitRecipient').value;
  let refNum = document.getElementById('remitRefNum').value;

  if (!startDate || !endDate || !cashier || !amount || !channel || !recipient) {
    alert("Please fill in all fields! (Reference Number is optional)");
    return;
  }

  try {
    await addDoc(collection(db, "remittances"), {
      branch: branch,
      salesPeriodStart: startDate,
      salesPeriodEnd: endDate,
      cashier: cashier,
      amount: amount,
      channel: channel,
      recipient: recipient,
      referenceNumber: refNum,
      status: "Pending", // <--- THIS NEW LINE HERE!
      timestamp: serverTimestamp()
    });

    alert("✅ Remittance securely sent to HQ!");

    // Clear the money fields so they don't accidentally double-submit
    document.getElementById('remitAmount').value = '';
    document.getElementById('remitRefNum').value = '';

    // Automatically flip to history to prove it saved
    switchRemittanceTab('history');

  } catch (error) {
    console.error("Error saving remittance:", error);
    alert("❌ Failed to save remittance. Check connection.");
  }
};

// Fetch History for the Tab
window.loadRemittanceHistory = async function () {
  const tbody = document.getElementById('remitHistoryTableBody');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Fetching records...</td></tr>';

  let branch = localStorage.getItem('takodeal_device_branch') || localStorage.getItem('branch') || 'Unknown Branch';

  try {
    // Note: This asks Firebase to filter by branch AND sort by time. 
    const q = query(collection(db, "remittances"), where("branch", "==", branch), orderBy("timestamp", "desc"), limit(20));
    const snap = await getDocs(q);

    let html = '';
    snap.forEach(docSnap => {
      let data = docSnap.data();
      let dateLogged = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : 'Just now';

      html += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 12px 8px; color: #64748b;">${dateLogged}</td>
          <td style="padding: 12px 8px; font-weight: bold; color: #334155;">
            <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">By ${data.cashier}</div>
            ${data.salesPeriodStart} to ${data.salesPeriodEnd}
          </td>
          <td style="padding: 12px 8px;">
            <div>${data.channel} ➡️ ${data.recipient}</div>
            <div style="font-size: 11px; color: #0284c7; font-family: monospace;">Ref: ${data.referenceNumber || 'N/A'}</div>
          </td>
          <td style="padding: 12px 8px; text-align: right; color: #16a34a; font-weight: bold; font-size: 15px;">₱${data.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="4" style="text-align: center; padding: 20px;">No remittances logged yet.</td></tr>';
  } catch (error) {
    console.error("Error loading remittance history:", error);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Firebase Index Required! Please press F12 and click the index link in the console.</td></tr>';
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
