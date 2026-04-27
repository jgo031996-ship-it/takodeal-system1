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
// 💸 SMART REMITTANCE ENGINE (CASHIER APP)
// ========================================================
window.openRemittanceModal = async function () {
  document.getElementById('remittanceModal').style.display = 'flex';
  switchRemittanceTab('form');

  // 🧠 SECURE MEMORY GRABBER (Forces the logged-in user's name)
  let currentCashier = window.sessionUser ? window.sessionUser.cashierName : (localStorage.getItem('cashierName') || 'Unknown');
  document.getElementById('remitCashier').value = currentCashier;

  // 🏦 FETCH LIVE HQ ACCOUNTS FOR DROPDOWN
  let channelSelect = document.getElementById('remitChannel');
  channelSelect.innerHTML = '<option value="">⏳ Fetching HQ Accounts...</option>';

  try {
      // Look ONLY for accounts belonging to the Main Office
      const q = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"));
      const snap = await getDocs(q);
      
      // Keep Physical Handover as the default first option for cash deliveries
      let optionsHtml = '<option value="Physical Handover">Physical Handover (Cash)</option>';

      snap.forEach(doc => {
          let acc = doc.data();
          // Add accounts from the database (skip if it's named literally "Cash" to avoid confusion with Handover)
          if(acc.name !== "Cash") { 
              optionsHtml += `<option value="${acc.name}">${acc.name}</option>`;
          }
      });

      // Inject the live options into the dropdown!
      channelSelect.innerHTML = optionsHtml;
  } catch (e) {
      console.error("Error fetching HQ accounts:", e);
      channelSelect.innerHTML = '<option value="Physical Handover">Physical Handover (Fallback)</option>';
  }
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
  let branch = window.sessionUser ? window.sessionUser.branch : (localStorage.getItem('takodeal_device_branch') || 'Unknown Branch');
  let startDate = document.getElementById('remitStartDate').value;
  let endDate = document.getElementById('remitEndDate').value;
  
  // 🔒 SECURITY CHECK: Pull the name straight from memory, ignoring any HTML tampering
  let cashier = window.sessionUser ? window.sessionUser.cashierName : (localStorage.getItem('cashierName') || 'Unknown');
  
  let amount = parseFloat(document.getElementById('remitAmount').value);
  let channel = document.getElementById('remitChannel').value;
  let recipient = document.getElementById('remitRecipient').value;
  let refNum = document.getElementById('remitRefNum').value;

  if (!startDate || !endDate || !cashier || !amount || !channel || !recipient) {
    alert("Please fill in all fields! (Reference Number is optional)");
    return;
  }

  // Prevent double-clicking
  let btn = document.querySelector('button[onclick="submitRemittance()"]');
  if(btn) { btn.innerText = "⏳ Sending..."; btn.disabled = true; }

  try {
    await addDoc(collection(db, "remittances"), {
      branch: branch,
      salesPeriodStart: startDate,
      salesPeriodEnd: endDate,
      cashier: cashier, // <--- Secured!
      amount: amount,
      channel: channel,
      recipient: recipient,
      referenceNumber: refNum,
      status: "Pending", 
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
  } finally {
      if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
  }
};

// Fetch History for the Tab (With Live Status!)
window.loadRemittanceHistory = async function () {
  const tbody = document.getElementById('remitHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Fetching records...</td></tr>';

  let branch = window.sessionUser ? window.sessionUser.branch : (localStorage.getItem('takodeal_device_branch') || 'Unknown Branch');

  try {
    const q = query(collection(db, "remittances"), where("branch", "==", branch), orderBy("timestamp", "desc"), limit(20));
    const snap = await getDocs(q);

    let html = '';
    snap.forEach(docSnap => {
      let data = docSnap.data();
      let dateLogged = data.timestamp ? data.timestamp.toDate().toLocaleDateString() : 'Just now';
      
      // Look at the status from the cloud!
      let status = data.status || "Pending";
      let statusBadge = status === "Received"
          ? `<div style="margin-top: 4px; font-size: 10px; background: #dcfce7; color: #16a34a; padding: 3px 6px; border-radius: 4px; display: inline-block; font-weight: bold;">✅ Received by HQ</div>`
          : `<div style="margin-top: 4px; font-size: 10px; background: #fef9c3; color: #ca8a04; padding: 3px 6px; border-radius: 4px; display: inline-block; font-weight: bold;">⏳ Pending / On Hold</div>`;

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
          <td style="padding: 12px 8px; text-align: right;">
            <div style="color: #16a34a; font-weight: bold; font-size: 15px;">₱${data.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            ${statusBadge}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || '<tr><td colspan="4" style="text-align: center; padding: 20px;">No remittances logged yet.</td></tr>';
  } catch (error) {
    console.error("Error loading remittance history:", error);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Firebase Index Required! Please press F12 and click the index link.</td></tr>';
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
// THERMAL BLUETOOTH PRINTING ENGINE (PRO RECEIPT UPGRADE)
// ==========================================
window.printThermalReceipt = async function () {
    // If the cart is empty, don't print!
    if (!window.currentOrder || window.currentOrder.length === 0) {
        alert("No items to print!");
        return;
    }

    try {
        // 1. Fetch your custom layout from the Manager App!
        const docRef = doc(db, "settings", "global_receipt");
        const docSnap = await getDoc(docRef);
        
        let headerName = "TAKODEAL"; 
        let headerContact = "09629721305";
        let footerMsg = "Acknowledgement Receipt\nThank you!";

        // 🤖 --- NEW: AUTO-DETECT BRANCH ADDRESS --- 🤖
        let currentBranch = window.sessionUser?.branch || localStorage.getItem('branch') || "Main Office";
        let headerAddress = "";

        if (currentBranch === "Cabantian") {
            headerAddress = "B14L6 Deca Homes Cabantian";
        } else if (currentBranch === "Maa") {
            headerAddress = "Maa Branch Exact Address"; // <-- Type your Maa address here!
        } else if (currentBranch === "Citygate") {
            headerAddress = "Citygate Branch Exact Address"; // <-- Type your Citygate address here!
        } else {
            headerAddress = "Davao City"; 
        }

        if (docSnap.exists()) {
            const layout = docSnap.data();
            headerName = layout.storeName || headerName;
            headerAddress = layout.address || headerAddress;
            headerContact = layout.contact || headerContact;
            // If you have a custom footer saved in Firebase, it will use it here
            if (layout.footerMessage) footerMsg = layout.footerMessage;
        }

        // 2. Build the exact text layout for the thermal printer
        let receiptText = "";
        
        // --- THE LOGO UPGRADE ---
        // RawBT will grab this image directly from your Vercel site!
        receiptText += `<center><img src="https://takodeal-owner.vercel.app/logo.jpg" width="200"></center>\n`;

        // --- HEADER ---
        // (If your logo already has the word TAKODEAL on it, you can delete this next line!)
        receiptText += `<center><b><font size="4">${headerName}</font></b></center>\n`;
        if (headerAddress) receiptText += `<center>${headerAddress}</center>\n`;
        if (headerContact) receiptText += `<center>${headerContact}</center>\n`;
        receiptText += `================================\n`;
        
        // --- TRANSACTION DETAILS ---
        const now = new Date();
        let dateStr = now.toISOString().split('T')[0]; // Creates YYYY-MM-DD
        let timeStr = now.toTimeString().split(' ')[0].substring(0,5); // Creates HH:MM
        
        // Generates a random 6-digit receipt number for the active checkout
        let tempReceiptNo = Math.floor(100000 + Math.random() * 900000);

        receiptText += `Receipt No: ${tempReceiptNo}\n`;
        receiptText += `Date: ${dateStr}\n`;
        receiptText += `Time: ${timeStr}\n`;
        receiptText += `Cashier: ${localStorage.getItem('cashierName') || 'Staff'}\n`;
        receiptText += `================================\n`;
        receiptText += `ITEM/S PURCHASED\n`;
        receiptText += `--------------------------------\n`;

        // --- ITEMS LOOP (Pro Layout) ---
        let totalQty = 0;
        let grandTotal = 0;
        
        window.currentOrder.forEach(item => {
            // Line 1: Item Name
            receiptText += `${item.name || item.itemName}\n`;
    
            // THE FIX: Stop the Double Math!
            // Grab the true total directly from the item, don't recalculate it.
            let itemTotal = parseFloat(item.subtotal || item.lineTotalFinal || item.price);
            
            // Find the TRUE unit price by dividing the total by the quantity
            let qty = parseFloat(item.qty) || 1;
            let trueUnitPrice = itemTotal / qty;
    
            // Line 2: Qty x True Unit Price      Total
            let qtyStr = `${qty.toFixed(1)}      x ${trueUnitPrice.toFixed(2)}`;
            let totalStr = `${itemTotal.toFixed(2)}`;
    
            // Math to push the Total all the way to the right edge!
            let spacePadding = 32 - qtyStr.length - totalStr.length;
            let paddingStr = " ".repeat(Math.max(1, spacePadding));
    
            receiptText += `${qtyStr}${paddingStr}${totalStr}\n`;
    
            totalQty += qty;
            grandTotal += itemTotal; // This will now perfectly match the 243!
        });
        receiptText += "--------------------------------\n";
    
        // 1. SHOW DISCOUNT (We need to tell it where to find your discount!)
        // Boss Jostuart: Replace the '0' below with your actual discount variable or input!
        let discountAmt = 0; 
        if (typeof order !== 'undefined' && order.discount) discountAmt = parseFloat(order.discount);
        
        if (discountAmt > 0) {
            receiptText += `[L]Discount:[R]-P${discountAmt.toFixed(2)}\n`;
        }
    
        // 2. SHOW FINAL TOTAL DUE (Using YOUR grandTotal from line 934!)
        let finalTotal = grandTotal; 
        receiptText += `[L]<b>TOTAL DUE</b>[R]<b>P${finalTotal.toFixed(2)}</b>\n`;
        
        // 3. SHOW PAYMENT & CHANGE
        // Boss Jostuart: Replace the '0' below with your actual cash received variable or input!
        let amountPaid = 0;
        if (typeof order !== 'undefined' && order.amountReceived) amountPaid = parseFloat(order.amountReceived);
    
        if (amountPaid > 0) {
            let changeAmt = amountPaid - finalTotal;
            
            receiptText += "--------------------------------\n";
            receiptText += `[L]Amount Received:[R]P${amountPaid.toFixed(2)}\n`;
            receiptText += `[L]Change Amount:[R]P${changeAmt.toFixed(2)}\n`;
        }
        
        receiptText += "--------------------------------\n";
        receiptText += "[C]Thank you for dining with us!\n";
        receiptText += "\n\n\n"; // Feed paper at the end
      

        receiptText += `--------------------------------\n`;
        
        // --- TOTALS BLOCK ---
        receiptText += `Subtotal: ${grandTotal.toFixed(2)}\n`;
        receiptText += `Discount: -0.00\n`;
        receiptText += `Service Fee: 0.00\n`;
        receiptText += `Delivery Fee: 0.00\n`;
        receiptText += `Total: ${grandTotal.toFixed(2)}\n`;
        receiptText += `--------------------------------\n`;
        
        // Note: If you have a specific variable tracking how much cash the customer handed you, 
        // put it here. Otherwise, it will just default to exact change!
        let amountReceived = window.cashTendered || grandTotal; 
        let changeAmount = amountReceived - grandTotal;

        receiptText += `Amount Received: ${amountReceived.toFixed(2)}\n`;
        receiptText += `Payment Method: Cash\n`;
        receiptText += `Change Amount: ${changeAmount.toFixed(2)}\n`;
        receiptText += `\n`;
        
        // --- FOOTER ---
        receiptText += `<center>${footerMsg}</center>\n`;
        receiptText += `\n\n\n`; // Feed paper slightly

        // 3. Send the command to the Android Tablet's Print Service (RawBT)
        const printIntentUrl = "rawbt:" + encodeURIComponent(receiptText);
        
        // Execute the print!
        window.location.href = printIntentUrl;

    } catch (error) {
        console.error("Print Error:", error);
        alert("Could not connect to printer settings.");
    }
};

// ==========================================
// 📸 NATIVE CAMERA & ATTENDANCE ENGINE
// ==========================================
let cameraStream = null;

window.openTimeClockModal = async function() {
    document.getElementById('timeClockModal').style.display = 'flex';
    document.getElementById('clockStaffName').value = "";
    
    try {
        // Request the tablet's front camera
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        document.getElementById('clockVideo').srcObject = cameraStream;
    } catch (err) {
        console.error("Camera error:", err);
        alert("Could not access the camera. Please ensure permissions are granted in your browser settings.");
    }
};

window.closeTimeClock = function() {
    document.getElementById('timeClockModal').style.display = 'none';
    // Turn off the camera light to save battery!
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
};

window.submitAttendance = async function(type) {
    const staffName = document.getElementById('clockStaffName').value;
    if (!staffName) { alert("Please select your name first!"); return; }

    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    const branchName = localStorage.getItem('takodeal_device_branch') || 'Unknown';

    // 1. Snap the photo!
    canvas.width = 320;
    canvas.height = 240;
    canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
    const photoData = canvas.toDataURL('image/jpeg', 0.7);

    // 2. 🌍 CAPTURE GPS LOCATION
    let lat = "Unknown";
    let lng = "Unknown";
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
        });
        lat = position.coords.latitude;
        lng = position.coords.longitude;
    } catch (geoErr) {
        console.warn("Could not get GPS. Staff might have blocked location access.");
    }

    try {
        // 3. Save it all to Firebase
        await addDoc(collection(db, "attendance_logs"), {
            staffName: staffName,
            branch: branchName,
            type: type, 
            timestamp: serverTimestamp(),
            photoBase64: photoData,
            locationLat: lat,   // Saves the Latitude!
            locationLng: lng    // Saves the Longitude!
        });

        alert(`✅ ${staffName}, your ${type} has been successfully logged with a photo and GPS Location!`);
        closeTimeClock();

    } catch (error) {
        console.error("Attendance Error:", error);
        alert("Failed to log attendance. Check connection.");
    }
};

// --- NEW PRO RECEIPT FOR PARKED ORDERS ---
window.printParkedReceipt = async function(docId, preloadedData = null) {
    let order = preloadedData; 
    
    // THE SILENT NINJA: Fetch directly from Firebase without touching the screen!
    if (!order) { 
        try {
            const docRef = doc(db, "parked_orders", docId); 
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                order = docSnap.data();
                order.id = docId; 
            } else {
                alert("❌ Order not found in the database!");
                return;
            }
        } catch (e) {
            console.error("🔴 Failed to fetch order silently:", e);
            alert("❌ Failed to connect to database for printing.");
            return;
        }
    } 
    
    if (!order) return;

    // ==========================================
    // 🖨️ PURE TEXT FORMATTER (32 CHARACTERS WIDE)
    // ==========================================
    const center = (text) => {
        let width = 32;
        if (text.length >= width) return text;
        return " ".repeat(Math.floor((width - text.length) / 2)) + text;
    };
    const alignLR = (left, right) => {
        let spaces = 32 - left.length - right.length;
        if (spaces < 1) spaces = 1;
        return left + " ".repeat(spaces) + right;
    };

    let r = "";
    
    // --- HEADER ---
    r += center("TAKODEAL") + "\n";
    let branchStr = order.branch || (window.sessionUser ? window.sessionUser.branch : "Davao City");
    r += center(branchStr) + "\n";
    r += "================================\n";
    
    // --- ORDER DETAILS ---
    let d = new Date();
    r += `Date: ${d.toLocaleDateString()}\n`;
    r += `Time: ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}\n`;
    
    let customerStr = order.customerName || order.customer || order.table || "Guest";
    r += `Customer: ${customerStr}\n`;
    
    let cashierName = (window.sessionUser && window.sessionUser.name) ? window.sessionUser.name : "Cashier";
    r += `Cashier: ${cashierName}\n`;
    
    r += "================================\n";
    r += "ITEM/S PURCHASED\n";
    r += "--------------------------------\n";
    
    let total = 0;
    
    // --- ITEMS LOOP ---
    if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
            let qty = parseFloat(item.qty) || 1;
            let name = item.name || "Item";
            let price = parseFloat(item.price) || 0;
            let lineTotal = parseFloat(item.lineTotalFinal || (price * qty) || 0);
            total += lineTotal;
            
            // 1. Print the item name on its own line
            r += name + "\n";
            // 2. Format Qty x Price, and push the lineTotal to the far right!
            let leftLine = `${qty.toFixed(1)}      x ${price.toFixed(2)}`;
            let rightLine = lineTotal.toFixed(2);
            r += alignLR(leftLine, rightLine) + "\n";
        });
    }
    
    r += "--------------------------------\n";
    r += alignLR("TOTAL DUE:", total.toFixed(2)) + "\n";
    r += "--------------------------------\n\n";
    
    // --- THE BOLD NOTE & FOOTER ---
    r += center("** PLEASE PAY AT COUNTER **") + "\n\n";
    r += center("Acknowledgement Receipt") + "\n";
    r += center("Thank you!") + "\n";
    r += "\n\n\n"; // Feed paper at the end

    // --- SEND TO RAWBT (AS PLAIN TEXT INTENT) ---
    let encodedText = encodeURIComponent(r); 
    let intentUrl = "intent:" + encodedText + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter;end;";
    window.location.href = intentUrl;
};

// ==========================================
// 🗑️ PARKED ORDER DELETER & SETTINGS MATCHER
// ==========================================
window.deleteParkedOrder = async function(docId) {
    try {
        await deleteDoc(doc(db, "parked_orders", docId));
    } catch(e) { console.error("Error deleting parked order:", e); }
};

window.getReceiptSettings = async function() {
    try {
        const snap = await getDoc(doc(db, "settings", "global_receipt"));
        if (snap.exists()) return snap.data();
    } catch(e) { console.warn("No global receipt settings found yet."); }
    return null;
};

// ==========================================
// 🔍 UPGRADED VIEW DETAILS (Separates Add-ons in UI)
// ==========================================
window.viewReceiptDetails = async function (receiptId) {
  try {
    document.getElementById('txDetailTitle').innerText = "Loading " + receiptId + "...";
    document.getElementById('txDetailBody').innerHTML = "Fetching...";
    document.getElementById('txDetailModal').style.display = 'flex';

    let tx = await window.getReceiptDetails(receiptId);
    if (!tx) { document.getElementById('txDetailBody').innerHTML = "Receipt not found."; return; }

    document.getElementById('txDetailTitle').innerText = "Receipt: " + receiptId;

    let html = `<div style="margin-bottom:15px; font-size:13px; color:#555;">
         <div><strong>Date:</strong> ${tx.timestamp ? tx.timestamp.toDate().toLocaleString() : 'N/A'}</div>
         <div><strong>Cashier:</strong> ${tx.cashier || 'Unknown'}</div>
         ${tx.customerName ? `<div><strong>Customer:</strong> ${tx.customerName}</div>` : ''}
         <div><strong>Method:</strong> ${tx.paymentMethod || '-'}</div>
         <div><strong>Status:</strong> ${tx.status === 'Voided' ? '<span style="color:red; font-weight:bold;">VOIDED</span>' : '<span style="color:green; font-weight:bold;">PAID</span>'}</div>
       </div><table style="width:100%; border-collapse:collapse; font-size:13px;"><tr style="border-bottom:1px solid #ddd; text-align:left;"><th>Item</th><th>Qty</th><th style="text-align:right;">Subtotal</th></tr>`;

    if (tx.cart && Array.isArray(tx.cart)) {
      tx.cart.forEach(i => {
        let qty = i.qty || 1;
        let basePrice = parseFloat(i.variantPrice || i.basePrice || i.price || 0);
        let baseLineTotal = basePrice * qty;
        
        let addonsHtml = '';
        if (i.addons) { 
            for (let key in i.addons) { 
                let addon = i.addons[key];
                if (addon.qty > 0) { 
                    let addPrice = parseFloat(addon.price || 0);
                    let addLineTotal = addPrice * (addon.qty * qty);
                    addonsHtml += `<tr style="border-bottom:1px dashed #eee; font-size:12px;">
                        <td style="padding:4px 0; padding-left:15px; color:#d97706;">+ ${addon.qty}x ${key}</td>
                        <td style="padding:4px 0; color:#d97706;">x${qty}</td>
                        <td style="padding:4px 0; text-align:right; color:#d97706;">₱${addLineTotal.toFixed(2)}</td>
                    </tr>`; 
                } 
            } 
        }
        
        let variantTxt = (i.variantName && i.variantName !== 'Standard') ? `<br><span style="font-size:11px; color:#777;">${i.variantName}</span>` : '';
        
        html += `<tr style="border-bottom: ${addonsHtml ? 'none' : '1px solid #eee'};">
            <td style="padding:8px 0;"><strong>${i.name || 'Item'}</strong>${variantTxt}</td>
            <td style="padding:8px 0;">x${qty}</td>
            <td style="padding:8px 0; text-align:right;">₱${baseLineTotal.toFixed(2)}</td>
        </tr>`;
        html += addonsHtml;
      });
    }

    let received = parseFloat(tx.amountReceived) || 0;
    let net = parseFloat(tx.netTotal) || 0;
    let change = received - net; if (change < 0) change = 0;

    html += `</table><div style="text-align:right; margin-top:15px; font-size:18px; font-weight:bold;">Total: ₱${net.toFixed(2)}</div>`;
    if (tx.paymentMethod === 'Cash') { html += `<div style="text-align:right; font-size:13px; color:#666; margin-top:5px;">Cash Tendered: ₱${received.toFixed(2)}<br>Change: ₱${change.toFixed(2)}</div>`; }
    document.getElementById('txDetailBody').innerHTML = html;
  } catch (error) { console.error(error); }
};

// ==========================================
// 📍 GPS & SELFIE TIME CLOCK ENGINE
// ==========================================

// ⚠️ BOSS JOSTUART: UPDATE THESE COORDINATES!
// Go to Google Maps, right-click your exact branch building, and copy the Latitude/Longitude numbers!
const BRANCH_ZONES = {
    "Cabantian": { lat: 7.130420626391755, lng: 125.61730998805625 }, // Example coordinates
    "Citygate": { lat: 7.111077615812063, lng: 125.61288981236622 },  // Example coordinates
    "Maa": { lat: 7.078642149249695, lng: 125.58343773215358 },       // Example coordinates
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
window.openTimeClockModal = async function() {
    document.getElementById('timeClockModal').style.display = 'flex';
    document.getElementById('clockStaffName').value = ""; // Reset dropdown
    
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        document.getElementById('clockVideo').srcObject = cameraStream;
    } catch (e) {
        console.error("Camera Error:", e);
        alert("⚠️ Camera access is required for the Time Clock!");
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
    if (!staffName) { alert("❌ Please select your name."); return; }

    const branch = sessionUser.branch;
    const targetZone = BRANCH_ZONES[branch];

    if (!targetZone) {
        alert(`❌ GPS Configuration Missing for ${branch}. Please contact the Owner.`);
        return;
    }

    // A. Snap the Photo!
    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.6); // Compress slightly for faster upload

    // B. Get GPS & Validate
    if (!navigator.geolocation) {
        alert("❌ Geolocation is not supported by this browser.");
        return;
    }

    // Disable buttons while calculating
    let buttons = document.querySelectorAll('#timeClockModal button');
    buttons.forEach(b => b.disabled = true);

    navigator.geolocation.getCurrentPosition(async (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;

        // C. Calculate Distance
        const distance = getDistanceInMeters(userLat, userLng, targetZone.lat, targetZone.lng);

        if (distance > ALLOWED_RADIUS_METERS) {
            alert(`🚨 SECURITY LOCKOUT!\n\nYou are ${Math.round(distance)} meters away from the ${branch} branch.\nYou must be within ${ALLOWED_RADIUS_METERS} meters to clock in or out!`);
            buttons.forEach(b => b.disabled = false);
            return;
        }

        // D. Secure! Save to Firebase
        try {
            await addDoc(collection(db, "attendance_logs"), {
                staffName: staffName,
                branch: branch,
                type: type, // "TIME IN" or "TIME OUT"
                timestamp: new Date(),
                locationLat: userLat,
                locationLng: userLng,
                distanceMeters: Math.round(distance),
                photoBase64: photoBase64
            });

            alert(`✅ ${type} SUCCESS!\n\nIdentity and Location Verified for ${staffName}.`);
            window.closeTimeClock();
        } catch (error) {
            console.error("Firebase Error:", error);
            alert("❌ Failed to log attendance. Check internet connection.");
        } finally {
            buttons.forEach(b => b.disabled = false);
        }

    }, (error) => {
        console.error("GPS Error:", error);
        alert("❌ GPS access is required to use the Time Clock. Please enable Location Services on this tablet.");
        buttons.forEach(b => b.disabled = false);
    }, { enableHighAccuracy: true }); // Force high accuracy mode for mobile GPS
};
