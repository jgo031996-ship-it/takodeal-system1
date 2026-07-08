// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS (MUST BE AT THE VERY TOP)
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, getDocs, query, where, serverTimestamp, doc, getDoc, updateDoc, limit, orderBy, deleteDoc, onSnapshot, increment, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
// ========================================================
// 🌍 GLOBAL GPS GEOFENCING CONFIGURATION
// ========================================================
// Define the exact Latitude and Longitude for each branch.
window.BRANCH_ZONES = {
    "Cabantian": { lat: 7.130415364656105, lng: 125.61730650596441 }, // <-- Replace these numbers
    "Citygate":  { lat: 7.111076870173231, lng: 125.61288375028629 }, // <-- Replace these numbers
    "Maa":       { lat: 7.078632967828137, lng: 125.58344165239423 }, // <-- Replace these numbers
    "Main Office": { lat: 7.153756836823165, lng: 125.5956673848104 }    // Optional (bypassed for testing)
};

// Set how far away (in meters) a staff member can be from the store to successfully Time In.
// 50 meters is a very generous radius that accounts for inaccurate phone GPS.
window.ALLOWED_RADIUS_METERS = 50;

// The mathematical engine that calculates the distance between the phone and the store.
window.getDistanceInMeters = function(lat1, lon1, lat2, lon2) {
    var R = 6371e3; // Radius of the earth in meters
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
};
const storage = getStorage(app); // 🔥 Turn on the engine

// 🔥 THE NEW ENTERPRISE OFFLINE ENGINE 🔥
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

window.storage = storage; // Export it for the staff meal function!
window.db = db;
window.query = query;
window.where = where;
window.collection = collection;
window.getDocs = getDocs;
window.deleteDoc = deleteDoc;
window.doc = doc;
window.updateDoc = updateDoc;
window.getDoc = getDoc;
window.setDoc = setDoc;

console.log("🚀 TAKODEÁL Cashier Offline Mode is ACTIVE!");

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

// ==========================================
// 📡 100% OFFLINE NETWORK STATUS ENGINE
// ==========================================
window.isAppOnline = navigator.onLine;

window.updateNetworkStatusUI = function() {
    let statusBadge = document.getElementById('liveClock').nextElementSibling;
    if (statusBadge) {
        if (window.isAppOnline) {
            statusBadge.innerHTML = `<span style="background: #16a34a; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; box-shadow: 0 0 5px rgba(22,163,74,0.5);">🟢 ONLINE & SYNCING</span>`;
        } else {
            statusBadge.innerHTML = `<span style="background: #dc2626; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; box-shadow: 0 0 5px rgba(220,38,38,0.5);">🔴 OFFLINE (SAVING LOCALLY)</span>`;
        }
    }
};

window.addEventListener('online', () => { window.isAppOnline = true; window.updateNetworkStatusUI(); });
window.addEventListener('offline', () => { window.isAppOnline = false; window.updateNetworkStatusUI(); });

// Run once on boot
setTimeout(window.updateNetworkStatusUI, 1000);

// 🔥 THE LOCAL HARD-DRIVE BACKUP ENGINE
// If the internet completely dies on refresh, it will load the last known menu from the tablet!
window.saveMenuToLocalHardDrive = function(menuData) {
    localStorage.setItem('takodeal_offline_menu', JSON.stringify(menuData));
};

window.getMenuFromLocalHardDrive = function() {
    let cached = localStorage.getItem('takodeal_offline_menu');
    return cached ? JSON.parse(cached) : [];
};

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

// --- THE SMART FIREBASE PIN SEARCHER ---
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
                return "BLOCKED"; // Stops double-alerting
            }
            if (devStatus === 'Blocked') {
                alert("🚫 DEVICE BLOCKED\n\nThis device has been blocked by the Manager.");
                return "BLOCKED"; // Stops double-alerting
            }
        } else {
            alert("❌ UNREGISTERED DEVICE\n\nThis device was removed from the HQ. Please clear your browser data and re-register.");
            return "BLOCKED";
        }
    }

    // 2. PROCEED WITH SMART PIN CHECK (String vs Number Fix!)
    let staffData = null;
    
    // First, try searching for the exact String they typed
    const qStr = window.query(window.collection(window.db, "cashiers"), window.where("pin", "==", pin));
    const snapStr = await window.getDocs(qStr);

    if (!snapStr.empty) {
        staffData = snapStr.docs[0].data();
    } else {
        // FALLBACK: If string fails, convert it to a Number and search again!
        let pinNum = parseInt(pin);
        if (!isNaN(pinNum)) {
            const qNum = window.query(window.collection(window.db, "cashiers"), window.where("pin", "==", pinNum));
            const snapNum = await window.getDocs(qNum);
            if (!snapNum.empty) {
                staffData = snapNum.docs[0].data();
            }
        }
    }

    if (!staffData) return null; // PIN is genuinely wrong

    // 🛑 INJECT THE SANCTION CHECKER HERE BEFORE ALLOWING LOGIN!
    // We don't 'await' it here so it doesn't slow down the login, but it will pop up instantly on the dashboard!
    if (typeof window.checkActiveSanctions === 'function') {
        window.checkActiveSanctions(staffData.cashierName);
    }

    // 🔥 SECURITY WALL REMOVED! Floating staff are now authorized to log in anywhere.
    return staffData; // Allows the login!

  } catch (error) {
    console.error("Database error:", error);
    return null;
  }
};

// --- THE SMART FIREBASE MENU GROUPER (WITH OFFLINE BACKUP) ---
window.fetchMenu = async function () {
  try {
    const snapshot = await window.getDocs(window.collection(window.db, "menu"));
    let rawItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (rawItems.length > 0) window.saveMenuToLocalHardDrive(rawItems);
    return window.processRawItemsIntoMenu(rawItems);
  } catch (error) {
    console.warn("Cloud fetch failed. Loading menu from offline hard drive backup...", error);
    let offlineItems = window.getMenuFromLocalHardDrive();
    return window.processRawItemsIntoMenu(offlineItems);
  }
};

window.processRawItemsIntoMenu = function(rawItems) {
    let groupedMenu = [];
    if (!window.masterPOSData) window.masterPOSData = {};
    window.masterPOSData.phantomVariants = {}; 

    rawItems.forEach(item => {
        let name = item.name;
        let match = name.match(/^(.*?)\s+(\d+\s*Pcs|[SML]|Duo|Solo|Trio|Squad)$/i);
        
        if (match) {
            let baseName = match[1].trim(); 
            let sizeName = match[2].trim(); 
            
            let existingBase = groupedMenu.find(i => i.name === baseName && i.category === item.category);
            if (!existingBase) {
                let baseItem = { ...item, name: baseName, isGrouped: true };
                groupedMenu.push(baseItem);
                window.masterPOSData.phantomVariants[baseName] = [];
            }
            
            window.masterPOSData.phantomVariants[baseName].push({
                realName: item.name,
                sizeLabel: sizeName,
                price: parseFloat(item.price) || 0,
                id: item.id
            });
            window.masterPOSData.phantomVariants[baseName].sort((a, b) => a.price - b.price);
        } else {
            groupedMenu.push(item);
        }
    });
    return groupedMenu;
};

window.loadPOSData = async function() {
    window.applySidebarLayout(); 
    let products = await window.fetchMenu();
    window.masterPOSData.items = products;
    window.masterPOSData.variants = {}; 
    window.masterPOSData.addons = [];

    try {
        const configSnap = await window.getDoc(window.doc(window.db, "settings", "global_pos_config"));
        if (configSnap.exists()) {
            let configData = configSnap.data();
            window.masterPOSData.settings = {
                orderTypes: configData.orderTypes && configData.orderTypes.length > 0 ? configData.orderTypes : ["Dine-In", "Take-Out", "Delivery"],
                payMethods: configData.paymentMethods && configData.paymentMethods.length > 0 ? configData.paymentMethods : ["Cash", "GCash"],
                mixMatchFlavors: configData.mixMatchFlavors || ["Pork", "Shrimp", "Octopus", "Ham & Cheese", "Bacon & Cheese"]
            };
            let dbCats = [...new Set(products.map(p => p.category))].filter(Boolean);
            window.masterPOSData.categories = configData.posTabs && configData.posTabs.length > 0 ? configData.posTabs : (dbCats.length > 0 ? dbCats : ["Takoyaki", "Milk Tea", "Coffee"]);
        } else {
            let dbCats = [...new Set(products.map(p => p.category))].filter(Boolean);
            window.masterPOSData.categories = dbCats.length > 0 ? dbCats : ["Takoyaki", "Milk Tea", "Coffee"];
            window.masterPOSData.settings = { 
                orderTypes: ["Dine-In", "Take-Out", "Delivery", "Grab"], 
                payMethods: ["Cash", "GCash", "Bank"],
                mixMatchFlavors: ["Pork", "Shrimp", "Octopus", "Ham & Cheese", "Bacon & Cheese"] 
            };
        }

        window.masterPOSData.addonLayoutNames = [];
        const layoutSnap = await window.getDoc(window.doc(window.db, "settings", "pos_addon_layout"));
        if (layoutSnap.exists() && layoutSnap.data().itemNames) {
            window.masterPOSData.addonLayoutNames = layoutSnap.data().itemNames;
        }

    } catch (e) {
        console.warn("Could not load global config, using defaults", e);
    }

    window.masterPOSData.stockLevels = {};
    const invSnap = await window.getDocs(window.query(window.collection(window.db, "inventory"), window.where("branch", "==", window.POS_BRANCH)));
    invSnap.forEach(doc => window.masterPOSData.stockLevels[doc.data().name] = doc.data().currentStock);

    window.masterPOSData.bom = [];
    const bomSnap = await window.getDocs(window.collection(window.db, "bom"));
    bomSnap.forEach(doc => window.masterPOSData.bom.push(doc.data()));

    if (typeof buildCategories === 'function') buildCategories();
    else if (typeof window.buildCategories === 'function') window.buildCategories();

    let otHtml = ''; 
    window.masterPOSData.settings.orderTypes.forEach(t => otHtml += `<option value="${t}">${t}</option>`); 
    document.getElementById('mainOrderType').innerHTML = otHtml;
    
    let pmHtml = ''; 
    let optHtml = ''; 
    window.masterPOSData.settings.payMethods.forEach((m, idx) => { 
        let act = idx === 0 ? 'active' : ''; 
        if (idx === 0) window.selectedPaymentMethod = m; 
        pmHtml += `<button class="pay-btn ${act}" onclick="setPaymentMethod(this, '${m}'); document.getElementById('splitPaymentContainer').style.display='none';">${m}</button>`; 
        optHtml += `<option value="${m}">${m}</option>`;
    }); 
    pmHtml += `<button class="pay-btn split-btn" onclick="window.toggleSplitPaymentUI(event)" style="background:#8b5cf6; color:white; border:none; box-shadow: 0 4px 6px rgba(139,92,246,0.3);">🔀 Split</button>`;
    
    let payGrid = document.querySelector('.payment-grid');
    if (payGrid) {
        payGrid.innerHTML = pmHtml;
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
            document.getElementById('splitMethod1').innerHTML = optHtml;
            document.getElementById('splitMethod2').innerHTML = optHtml;
        }
    }
};

// --- UPGRADED CART & VARIANT LOGIC ---
window.openAddOrderModal = async function(name, basePrice, existingItem = null) {
    if (!window.masterPOSData) window.masterPOSData = {};
    if (!window.cart) window.cart = [];

    if (existingItem) { 
        window.pendingItem = JSON.parse(JSON.stringify(existingItem)); 
        window.editIndex = window.cart.indexOf(existingItem); 
    } else { 
        window.pendingItem = { name: name, basePrice: basePrice, variantName: 'Standard', variantPrice: basePrice, qty: 1, notes: '', addons: {}, discountType: 'none', discountVal: 0, isGrouped: false, realName: name }; 
        window.editIndex = -1; 
    }

    let phantomSizes = window.masterPOSData.phantomVariants ? window.masterPOSData.phantomVariants[name] : null;
    let hasSizes = phantomSizes && phantomSizes.length > 0;
    
    if (hasSizes && !existingItem) {
        window.pendingItem.isGrouped = true;
        window.pendingItem.realName = phantomSizes[0].realName;
        window.pendingItem.basePrice = phantomSizes[0].price;
        window.pendingItem.variantPrice = phantomSizes[0].price;
    }

    document.getElementById('modalItemName').innerText = window.pendingItem.name;
    let priceHeader = document.getElementById('modalItemPrice').parentElement;
    
    if (hasSizes && !existingItem) {
        priceHeader.style.display = 'none'; 
    } else {
        priceHeader.style.display = 'flex';
        document.getElementById('modalItemPrice').innerText = '₱ ' + window.pendingItem.basePrice.toFixed(2);
    }

    document.getElementById('modalMainQty').innerText = window.pendingItem.qty;
    document.getElementById('orderNotesInput').value = window.pendingItem.notes;
    document.getElementById('variantModal').style.display = 'flex';

    let oldDropdown = document.getElementById('addonSelectDropdown');
    if(oldDropdown) oldDropdown.style.display = 'none';

    let variantContainer = document.getElementById('variantOptions');
    let variantSection = variantContainer ? variantContainer.parentElement : null;
    
    if (hasSizes) {
        if (variantSection) variantSection.style.display = 'block';
        if (variantContainer) {
            variantContainer.style.width = '100%'; 
            variantContainer.style.display = 'block';
            
            let sizeHtml = '<div style="display: flex; flex-wrap: wrap; gap: 12px; width: 100%; margin-bottom: 15px;">';
            
            phantomSizes.forEach((sizeObj, idx) => {
                let isActive = (window.pendingItem.realName === sizeObj.realName) ? 'active' : '';
                sizeHtml += `
                    <div class="size-btn ${isActive}" onclick="window.selectRealVariant('${sizeObj.realName}', ${sizeObj.price}, this)" style="flex: 1 1 calc(50% - 12px); min-width: 130px; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box;">
                        <div class="sz-name" style="margin-bottom: 5px;">${sizeObj.sizeLabel}</div>
                        <div class="sz-price">₱${sizeObj.price.toFixed(2)}</div>
                    </div>
                `;
            });
            sizeHtml += '</div>';
            variantContainer.innerHTML = sizeHtml;
        }
    } else {
        if (variantSection) variantSection.style.display = 'none';
    }

    try {
        const q = window.query(window.collection(window.db, "menu"), window.where("name", "==", window.pendingItem.realName));
        const snap = await window.getDocs(q);

        if (!snap.empty) {
            let itemData = snap.docs[0].data();

            let imgContainer = document.getElementById('modalDynamicImage');
            if (!imgContainer) {
                imgContainer = document.createElement('div');
                imgContainer.id = 'modalDynamicImage';
                document.getElementById('modalItemName').parentElement.parentElement.insertAdjacentElement('beforebegin', imgContainer);
            }
            if (itemData.image) {
                imgContainer.innerHTML = `<div style="text-align: center; margin-bottom: 15px; display: flex; justify-content: center; background: #f8fafc; border-radius: 12px;"><img src="${itemData.image}" style="width: 100%; max-height: 160px; object-fit: contain; border-radius: 12px;"></div>`;
            } else {
                imgContainer.innerHTML = '';
            }

            let addonContainer = document.getElementById('addonSelectDropdown').parentElement;
            let newUiHtml = '';

            if (itemData.addons && itemData.addons.length > 0) {
                let groupedAddons = {};
                itemData.addons.forEach(a => {
                    if (!groupedAddons[a.name]) groupedAddons[a.name] = { ...a, price: parseFloat(a.price) || 0 };
                    else groupedAddons[a.name].price += (parseFloat(a.price) || 0);
                });

                let addonsList = Object.values(groupedAddons);
                
                if (window.masterPOSData && window.masterPOSData.addonLayoutNames) {
                    addonsList.sort((a,b) => {
                        let idxA = window.masterPOSData.addonLayoutNames.indexOf(a.name.toLowerCase());
                        let idxB = window.masterPOSData.addonLayoutNames.indexOf(b.name.toLowerCase());
                        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                        if (idxA !== -1) return -1;
                        if (idxB !== -1) return 1;
                        return a.name.localeCompare(b.name);
                    });
                }
                
                let baseFlavors = addonsList.filter(a => a.price === 0);
                let extras = addonsList.filter(a => a.price > 0);

                if (baseFlavors.length > 0) {
                    newUiHtml += `
                        <label style="font-size: 11px; font-weight: bold; color: #64748b; display: block; margin-bottom: 5px; width: 100%;">BASE FLAVOR (Required)</label>
                        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px; margin-bottom: 15px; display: flex; flex-direction: column; gap: 8px; width: 100%;">
                    `;
                    
                    baseFlavors.forEach((bf, bfIdx) => {
                        let isChecked = '';
                        if (existingItem) {
                            if (existingItem.addons && existingItem.addons[bf.name]) isChecked = 'checked';
                        } else {
                            if (bfIdx === 0) isChecked = 'checked';
                        }

                        newUiHtml += `
                            <label style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 13px; font-weight: bold; color: #b45309;">
                                <span><input type="radio" name="baseSauce" class="addon-radio" value="${bf.name}|0|${bf.linkedIngredient || ''}|${bf.deductQty || 0}" ${isChecked} style="accent-color: #d97706; transform: scale(1.2); margin-right: 8px;" onchange="window.updateModalTotals()"> ${bf.name}</span>
                                <span style="color: #d97706; font-size: 11px;">Free</span>
                            </label>
                        `;
                    });
                    newUiHtml += `</div>`;
                }

                if (extras.length > 0) {
                    newUiHtml += `<label style="font-size: 11px; font-weight: bold; color: #64748b; display: block; margin-bottom: 5px; width: 100%;">EXTRA ADD-ONS (Optional)</label><div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px; width: 100%;">`;
                    extras.forEach(a => {
                        let isChecked = (existingItem && existingItem.addons && existingItem.addons[a.name]) ? 'checked' : '';
                        newUiHtml += `
                            <label style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #f8fafc; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; font-weight: bold; color: #334155; box-sizing: border-box;">
                                <span><input type="checkbox" class="addon-checkbox" value="${a.name}|${a.price}|${a.linkedIngredient || ''}|${a.deductQty || 0}" ${isChecked} style="transform: scale(1.2); margin-right: 8px;" onchange="window.updateModalTotals()"> ${a.name}</span>
                                <span style="color: #0f766e;">+₱${a.price.toFixed(2)}</span>
                            </label>
                        `;
                    });
                    newUiHtml += `</div>`;
                }
            }

            if (newUiHtml === '') newUiHtml = '<div style="font-size:12px; color:#94a3b8; text-align:center; padding:10px; width:100%;">No add-ons available.</div>';
            
            let dynamicAddonDiv = document.getElementById('dynamicAddonUI');
            if(!dynamicAddonDiv) {
                dynamicAddonDiv = document.createElement('div');
                dynamicAddonDiv.id = 'dynamicAddonUI';
                dynamicAddonDiv.style.width = '100%';
                addonContainer.appendChild(dynamicAddonDiv);
            }
            dynamicAddonDiv.innerHTML = newUiHtml;

            // 🔥 3. ITEM-SPECIFIC MIX & MATCH BUILDER 🔥
            window.mixMatchState = {};
            let hasMixMatch = itemData.mixMatchFlavors && itemData.mixMatchFlavors.length > 0;
            let customArea = document.getElementById('takoyakiCustomizationArea');
            
            if (customArea) {
                if (hasMixMatch) {
                    itemData.mixMatchFlavors.forEach(flavor => {
                        window.mixMatchState[flavor] = 0;
                    });
                    
                    customArea.style.display = 'block';
                    document.getElementById('mixMatchPanel').style.display = 'none';
                    document.getElementById('mixMatchToggleIcon').innerText = '▼';
                    
                    let sizeMatch = window.pendingItem.realName ? window.pendingItem.realName.match(/(\d+)\s*Pcs/i) : window.pendingItem.name.match(/(\d+)\s*Pcs/i);
                    window.maxMixMatch = sizeMatch ? parseInt(sizeMatch[1]) : 8; 
                    window.renderMixMatchList();
                } else {
                    customArea.style.display = 'none';
                }
            }
        }
    } catch (error) { console.error("Error loading item details:", error); }
    
    if (typeof window.updateModalTotals === 'function') window.updateModalTotals(); 
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
      // 🔥 THE CRITICAL FIX: We MUST grab the actual Document ID (shiftId) so orders can attach to it!
      return { active: true, startedBy: data.cashier, startTime: data.startTime, shiftId: snap.docs[0].id };
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

// --- THE 100% OFFLINE CHECKOUT ENGINE (INSTANT & NON-BLOCKING) ---
window.processCheckout = async function (payload) {
  try {
    // 🔀 SPLIT PAYMENT INTERCEPTOR & VALIDATOR
    let splitContainer = document.getElementById('splitPaymentContainer');
    if (splitContainer && splitContainer.style.display !== 'none') {
        let m1 = document.getElementById('splitMethod1').value;
        let a1 = parseFloat(document.getElementById('splitAmount1').value) || 0;
        let m2 = document.getElementById('splitMethod2').value;
        let a2 = parseFloat(document.getElementById('splitAmount2').value) || 0;
        
        if (Math.abs((a1 + a2) - payload.netTotal) > 0.01) {
            alert(`❌ ERROR: The Split Amounts (₱${a1+a2}) do not match the Order Total (₱${payload.netTotal})!\n\nPlease adjust the split amounts.`);
            return null; 
        }
        
        payload.paymentMethod = `Split (${m1} & ${m2})`;
        payload.splitDetails = [ { method: m1, amount: a1 }, { method: m2, amount: a2 } ];
    }

    let d = new Date();
    let dateStr = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

    // 🔥 100% OFFLINE RECEIPT GENERATOR!
    // Instead of asking the cloud to count receipts (which hangs when offline), we generate a localized, guaranteed-unique ID instantly.
    let localCounter = parseInt(localStorage.getItem('takodeal_offline_rcpt_count')) || 1;
    localStorage.setItem('takodeal_offline_rcpt_count', localCounter + 1);
    
    // Format: 20260521-0012-A8F (Date - Local Count - Random Hash to prevent collisions across tablets)
    let randomHash = Math.random().toString(36).substring(2, 5).toUpperCase();
    const receiptId = `${dateStr}-${localCounter.toString().padStart(4, '0')}-${randomHash}`;

    // 🚀 BACKGROUND FIREBASE WRITE (We DO NOT 'await' this. We let it queue silently!)
    addDoc(collection(db, "transactions"), {
      ...payload, receiptId: receiptId, timestamp: serverTimestamp()
    }).catch(e => console.warn("Transaction queued locally for background sync.", e));

    // ==========================================
    // 🏦 AUTO-ROUTE & INVENTORY (SILENT BACKGROUND WORKERS)
    // We wrap all of this in an async timeout so it NEVER blocks the receipt from printing!
    // ==========================================
    setTimeout(async () => {
        // 1. Auto-Route Sales
        try {
            let paymentsToRoute = payload.splitDetails ? payload.splitDetails : [{ method: payload.paymentMethod || 'Cash', amount: payload.netTotal || 0 }];
            for (let p of paymentsToRoute) {
                if (p.amount <= 0) continue; 
                const accQuery = query(collection(db, "cash_accounts"), where("branch", "==", payload.branch), where("name", "==", p.method));
                const accSnap = await getDocs(accQuery);

                if (!accSnap.empty) {
                    let accDoc = accSnap.docs[0];
                    await updateDoc(doc(db, "cash_accounts", accDoc.id), { balance: (parseFloat(accDoc.data().balance) || 0) + p.amount });
                } else {
                    await addDoc(collection(db, "cash_accounts"), { branch: payload.branch, name: p.method, balance: p.amount });
                }
            }
        } catch (err) { console.warn("Ledger auto-route queued locally.", err); }

        // 2. Inventory Updates (SILENT MODE - NO SPAM LOGS!)
        try {
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
                        
                        // Just update the live stock silently
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
                                
                                // Just update the live stock silently
                                await updateDoc(addonInvSnap.docs[0].ref, { currentStock: newStock });
                                if (newStock <= (invData.reorderLevel || 5)) lowStockTriggered = true;
                            }
                        }
                    }
                }
            }
            if (lowStockTriggered) window.pendingLowStockAlarm = true;

            // 3. Takoyaki Global Vault Counter
            let totalBallsInOrder = 0;
            for (let cartItem of payload.cart) {
                let match = (cartItem.name || cartItem.itemName).match(/(\d+)\s*Pcs/i);
                if (match) totalBallsInOrder += (parseInt(match[1]) * (cartItem.qty || 1));
            }
            if (totalBallsInOrder > 0) {
                await setDoc(doc(db, "settings", "global_stats"), { totalTakoyakiBalls: increment(totalBallsInOrder) }, { merge: true });
            }
        } catch(err) { console.warn("Inventory deduction queued locally.", err); }

    }, 10); 
    // ^ The timeout is set to 10ms so it immediately gets out of the way of the main UI thread!

    // Auto-close split container
    if (splitContainer) splitContainer.style.display = 'none';

    // 🔥 INSTANT RETURN: The cashier sees the success screen immediately, regardless of network speed!
    return receiptId;
  } catch (error) { 
      console.error(error); 
      // Ultimate fallback so the cashier isn't stuck
      return "OFFLINE-" + Date.now().toString().slice(-6); 
  }
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
    const q = query(collection(db, "inventory"), where("branch", "==", branch));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("Inventory Fetch Error:", e);
    return [];
  }
};

// 🔥 UPGRADED SEARCHABLE STOCK COUNT
window.openInventoryCheckModal = async function() {
    document.getElementById('invCheckListContainer').innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Fetching inventory...</div>'; 
    document.getElementById('inventoryCheckModal').style.display = 'flex';
    
    // Clear out the permanent search bar at the top!
    let searchBox = document.getElementById('cashierStockSearch');
    if (searchBox) searchBox.value = '';

    let items = await window.getInventoryForCount(sessionUser.branch);
    window.tempStockList = items.filter(i => {
        let cat = (i.category || "").toLowerCase();
        return !cat.includes("prepared batch") && !cat.includes("prep batch") && !cat.includes("raw material");
    }).sort((a, b) => a.name.localeCompare(b.name)); 

    window.renderStockCountUI('');
};

window.renderStockCountUI = function(searchTerm = '') {
    let container = document.getElementById('invCheckListContainer');
    let html = '';

    let filtered = window.tempStockList.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (filtered.length === 0) {
        html += '<div style="text-align:center; padding:20px; color:#888;">No items found.</div>';
    } else {
        filtered.forEach(i => { 
            let existingVal = window.tempCountData ? (window.tempCountData[i.name] || '') : '';
            html += `<div class="count-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f1f1;">
                <div style="flex: 2; font-weight:600; color:#444; font-size:14px;">${i.name}</div>
                <div style="flex: 1; color:#888; font-size:12px; text-align: center;">${i.uom || 'units'}</div>
                <div style="flex: 1;"><input type="number" class="count-input count-target-input" data-item="${i.name}" placeholder="Qty" value="${existingVal}" onchange="window.saveTempCount(this)" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; text-align: center;"></div>
            </div>`; 
        }); 
    }
    
    container.innerHTML = html;
};

window.saveTempCount = function(input) {
    if(!window.tempCountData) window.tempCountData = {};
    window.tempCountData[input.getAttribute('data-item')] = input.value;
};

window.submitInventoryCheck = async function () {
    let counts = [];
    if(window.tempCountData) {
        Object.keys(window.tempCountData).forEach(name => {
            let val = parseFloat(window.tempCountData[name]);
            if(!isNaN(val)) counts.push({ name: name, physicalQty: val });
        });
    }
    if (counts.length === 0) { alert("Please enter at least one quantity before submitting."); return; }
    
    let btn = document.getElementById('btnSubmitInvCheck'); btn.innerText = "Submitting..."; btn.disabled = true;
    try { 
        await addDoc(collection(db, "stock_counts"), {
            branch: sessionUser.branch,
            cashier: sessionUser.cashierName,
            counts: counts,
            timestamp: serverTimestamp()
        });
        alert("End-of-day stock count submitted securely!"); 
        window.tempCountData = {}; // Clear temp memory
        closeModal('inventoryCheckModal'); 
    }
    catch (e) { alert("Error submitting stock count. Check connection."); } 
    btn.innerText = "Submit Count"; btn.disabled = false;
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

            // 🔥 THE FIX: Changed 'safeFirstName' to 'cashierName' so it doesn't crash!
            await addDoc(collection(db, "stock_logs"), {
                branch: branch,
                item: ingredientName,
                uom: invData.uom || 'units',
                oldQty: invData.currentStock || 0,
                newQty: newStock,
                variance: totalAmountToReturn, 
                type: "Transaction Voided",
                note: `Receipt ${receiptId} voided by ${cashierName}`,
                user: cashierName,
                timestamp: serverTimestamp()
            });
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

                      // 🔥 THE FIX: Changed 'safeFirstName' to 'cashierName' here as well!
                      await addDoc(collection(db, "stock_logs"), {
                          branch: branch,
                          item: addon.linkedIngredient,
                          uom: invData.uom || 'units',
                          oldQty: invData.currentStock || 0,
                          newQty: newStock,
                          variance: totalAddonReturn, 
                          type: "Transaction Voided (Addon)",
                          note: `Receipt ${receiptId} voided by ${cashierName}`,
                          user: cashierName,
                          timestamp: serverTimestamp()
                      });
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
        let match = itemName.match(/(\d+)\s*Pcs/i);
        if (match) {
            let ballsInBox = parseInt(match[1]);
            totalBallsToReturn += (ballsInBox * (cartItem.qty || 1));
        }
    }

    if (totalBallsToReturn > 0) {
        const statsRef = doc(db, "settings", "global_stats");
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

    // 🚨 SECURITY: Mask the totals if physical cash was involved
    let isCashTx = !tx.paymentMethod || tx.paymentMethod === 'Cash' || tx.paymentMethod.includes('Split');
    let displayTotal = isCashTx ? `<span style="color:#94a3b8; font-family: monospace;">*** (Hidden)</span>` : (tx.netTotal || 0).toFixed(2);

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
            
            // Mask individual line items too, otherwise they will just add them up!
            let lineTotalDisplay = isCashTx ? '***' : (item.lineTotalFinal || 0).toFixed(2);

            modalHtml += `
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
                    <div><strong>${item.qty}x ${item.name}</strong><br><span style="font-size:11px; color:#888;">${item.variantName !== 'Standard' ? item.variantName : ''}</span>${addonsText}</div>
                    <div style="font-weight: bold; color: ${isCashTx ? '#94a3b8' : '#333'}">₱${lineTotalDisplay}</div>
                </div>
            `;
        });
    }

    modalHtml += `
        </div>
        <div style="border-top: 1px solid #eee; padding-top: 15px; font-size: 18px; font-weight: bold; text-align: right; color: var(--primary);">
            TOTAL: ₱${displayTotal}
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
window.calculateDenominations = function() {
    let breakdown = {};
    // Grab all the dynamic inputs we created in the End Shift Modal
    document.querySelectorAll('.denom-input').forEach(input => {
        let val = input.getAttribute('data-val');
        let pcs = parseInt(input.value) || 0;
        if (pcs > 0) {
            breakdown["₱" + val] = pcs;
        }
    });
    return breakdown;
};

// Call this when clicking your "End Shift" button to open the new UI
window.openEndShiftClearance = async function() {
    if (typeof closeModal === 'function') closeModal('shiftModal');
    let endModal = document.getElementById('endShiftModal');
    if (endModal) endModal.style.display = 'flex';

    // 1. Render denominations table (Sorted 1000 down to 1)
    let denomHtml = '';
    let denominations = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
    denominations.forEach(val => {
        denomHtml += `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 8px 5px; font-weight: bold; color: #555;">₱${val}</td>
            <td style="padding: 8px 5px;"><input type="number" class="denom-input input-box" data-val="${val}" placeholder="0" style="width: 100%; text-align: center; padding: 6px;" onkeyup="if(typeof window.calculateGrandTotalCash === 'function') window.calculateGrandTotalCash()" onchange="if(typeof window.calculateGrandTotalCash === 'function') window.calculateGrandTotalCash()"></td>
            <td style="padding: 8px 5px; text-align: right; font-weight: bold; color: var(--primary);" class="denom-row-total">₱0.00</td>
        </tr>`;
    });
    
    // 🛡️ CRASH-PROOF WRAPPER: Only set innerHTML if the table actually exists!
    let denomTable = document.getElementById('denominationTable');
    if (denomTable) {
        denomTable.innerHTML = denomHtml;
    } else {
        console.warn("HTML ID 'denominationTable' is missing. Skipping.");
    }
    
    if (typeof window.calculateGrandTotalCash === 'function') window.calculateGrandTotalCash(); 

    // 2. FETCH KITCHEN PREP LOGS FOR THIS SHIFT
    let prepContainer = document.getElementById('dynamicShiftPrepLogs');
    
    // 🛡️ CRASH-PROOF WRAPPER: Only fetch logs if the prep container exists!
    if (prepContainer) {
        prepContainer.innerHTML = '<div style="text-align:center; font-size: 13px; color: #888; padding: 20px;">Fetching prep logs...</div>';
        
        try {
            if (typeof currentShift === 'undefined' || !currentShift || !currentShift.startTime) {
                prepContainer.innerHTML = '<div style="text-align:center; color: #dc2626;">No active shift found.</div>';
                return;
            }
            
            // Remove "window." prefix for Firebase functions!
            const q = query(collection(db, "stock_logs"), 
                where("branch", "==", sessionUser.branch), 
                where("timestamp", ">=", currentShift.startTime)
            );
            const snap = await getDocs(q);
            
            let logs = [];
            snap.forEach(doc => {
                let d = doc.data();
                if (d.type && (d.type.toLowerCase().includes("prep") || d.type.toLowerCase().includes("batch"))) {
                    logs.push(d);
                }
            });

            logs.sort((a,b) => b.timestamp - a.timestamp); 
            
            let html = '';
            if (logs.length > 0) {
                logs.forEach(log => {
                    let t = log.timestamp.toDate().toLocaleTimeString('en-PH', {hour:'2-digit', minute:'2-digit'});
                    html += `
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #fcd34d; padding: 8px 0;">
                            <div>
                                <strong style="color: #92400e; font-size: 13px;">${log.item}</strong><br>
                                <span style="font-size: 10px; color: #b45309;">${t}</span>
                            </div>
                            <strong style="color: #16a34a; font-size: 14px;">+${log.variance} ${log.uom}</strong>
                        </div>
                    `;
                });
            } else {
                html = '<div style="text-align:center; font-size: 13px; color: #b45309; padding: 20px; font-style: italic;">No kitchen prep logged during this shift.</div>';
            }
            prepContainer.innerHTML = html;
        } catch(e) {
            console.error("Prep Fetch Error:", e);
            prepContainer.innerHTML = '<div style="text-align:center; color: #dc2626;">Error fetching logs. Check console.</div>';
        }
    } else {
        console.warn("HTML ID 'dynamicShiftPrepLogs' is missing. Skipping prep fetch.");
    }
};

// Also apply a crash-proof wrapper to the total calculator just in case!
window.calculateGrandTotalCash = function() {
    let total = 0;
    document.querySelectorAll('.denom-input').forEach(input => {
        let val = parseInt(input.getAttribute('data-val'));
        let pcs = parseInt(input.value) || 0;
        let rowTotal = val * pcs;
        total += rowTotal;
        
        let rowTotalEl = input.parentElement.nextElementSibling;
        if (rowTotalEl) {
            rowTotalEl.innerText = '₱' + rowTotal.toLocaleString(undefined, {minimumFractionDigits: 2});
        }
    });
    
    let grandTotalEl = document.getElementById('grandTotalCash');
    if (grandTotalEl) {
        grandTotalEl.innerText = '₱' + total.toLocaleString(undefined, {minimumFractionDigits: 2});
    }
};

// ========================================================
// 🛑 SUBMIT COMPREHENSIVE SHIFT CLOSE (CRASH-PROOF EDITION)
// ========================================================
window.submitComprehensiveCloseShift = async function () {
    // 1. Grab the button safely to prevent double-clicks
    let confirmBtn = document.querySelector('#endShiftModal .btn-place:last-child') || document.querySelector('button[onclick*="submitComprehensiveCloseShift"]');
    if (confirmBtn && confirmBtn.disabled) return; 

    let origText = confirmBtn ? confirmBtn.innerText : '🛑 Confirm & End Shift';
    if (confirmBtn) { 
        confirmBtn.innerText = "⏳ Verifying Count..."; 
        confirmBtn.disabled = true; 
    }

    try {
        // 2. Crash-Proof Cash Breakdown Reader
        let declaredCash = 0;
        let cashBreakdown = {};
        
        document.querySelectorAll('.denom-input').forEach(input => {
            let val = parseInt(input.getAttribute('data-val'));
            let pcs = parseInt(input.value) || 0;
            if (pcs > 0) {
                cashBreakdown["₱" + val] = pcs;
                declaredCash += (val * pcs);
            }
        });

        // Bypass Physical Stock (Since we replaced it with Kitchen Prep Logs)
        let physicalStock = {};

        // 3. Identify Shift Safely
        let shiftId = (typeof activeShiftDetails !== 'undefined' && activeShiftDetails) ? activeShiftDetails.logId : localStorage.getItem('currentShiftId');
        if (!shiftId) throw new Error("No active shift found to close.");
        
        let branchName = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let cashierName = localStorage.getItem('cashierName') || 'Unknown';
        
        // Ensure we have a valid Date object for queries
        let startTime = new Date();
        if (typeof activeShiftDetails !== 'undefined' && activeShiftDetails && activeShiftDetails.startTime) {
            startTime = activeShiftDetails.startTime;
            if (startTime.toDate) startTime = startTime.toDate(); // Convert Firestore Timestamp to JS Date
        } else {
            startTime.setHours(0,0,0,0);
        }

        // 4. Crunch Transactions
        let totalCashSales = 0; let totalDigitalSales = 0;
        let digitalBreakdown = {}; let shiftIngredientBurn = {}; 

        // We removed 'window.' from the Firebase commands so they work correctly!
        const txQ = query(collection(db, "transactions"), where("branch", "==", branchName), where("timestamp", ">=", startTime));
        const txSnap = await getDocs(txQ);

        txSnap.forEach(docSnap => {
            let tx = docSnap.data();
            if (tx.status !== 'Voided') {
                if (tx.cart) {
                    tx.cart.forEach(item => {
                        let itemName = item.name || item.itemName;
                        let qty = item.qty || 1;
                        let recipe = (typeof masterPOSData !== 'undefined' && masterPOSData.bom) ? masterPOSData.bom.filter(b => b.menuItem === itemName) : [];
                        recipe.forEach(r => {
                            if (!shiftIngredientBurn[r.ingredientName]) shiftIngredientBurn[r.ingredientName] = 0;
                            shiftIngredientBurn[r.ingredientName] += (r.qty * qty);
                        });
                        if (item.addons) {
                            for (let key in item.addons) {
                                let addon = item.addons[key];
                                if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                                    if (!shiftIngredientBurn[addon.linkedIngredient]) shiftIngredientBurn[addon.linkedIngredient] = 0;
                                    shiftIngredientBurn[addon.linkedIngredient] += (addon.deductQty * addon.qty * qty);
                                }
                            }
                        }
                    });
                }
                if (tx.splitDetails) {
                    tx.splitDetails.forEach(split => {
                        if (split.method === 'Cash') totalCashSales += split.amount;
                        else {
                            totalDigitalSales += split.amount;
                            digitalBreakdown[split.method] = (digitalBreakdown[split.method] || 0) + split.amount;
                        }
                    });
                } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                    totalCashSales += tx.netTotal;
                } else {
                    totalDigitalSales += tx.netTotal;
                    digitalBreakdown[tx.paymentMethod] = (digitalBreakdown[tx.paymentMethod] || 0) + tx.netTotal;
                }
            }
        });

        // 5. Crunch Expenses
        const expQ = query(collection(db, "expenses"), where("branch", "==", branchName), where("timestamp", ">=", startTime));
        const expSnap = await getDocs(expQ);
        let cashOut = 0;
        expSnap.forEach(e => cashOut += (parseFloat(e.data().amount) || 0));

        let startingCash = (typeof activeShiftDetails !== 'undefined' && activeShiftDetails) ? (activeShiftDetails.startingCash || 0) : 0;
        let expectedCash = startingCash + totalCashSales - cashOut;

        // 🚨 ZERO CASH LOCKOUT
        if (expectedCash > 0 && declaredCash === 0) {
            Swal.fire('⛔ SECURITY LOCKOUT', `The system has logged cash sales for this shift.<br><br>You cannot submit a blank or zero physical cash count. Please recount your drawer and enter the actual physical bills.`, 'error');
            if (confirmBtn) { confirmBtn.innerText = origText; confirmBtn.disabled = false; }
            return;
        }

        // 6. THE VARIANCE SWEETALERT (Interactive check!)
        let variance = declaredCash - expectedCash;
        // Allow a generous 2 peso floating point margin
        if (Math.abs(variance) > 2) {
            let isOver = variance > 0;
            let alertTitle = isOver ? '📈 Cash Overage Detected' : '🚨 Cash Shortage Detected';
            let alertHtml = isOver 
                ? `Your declared cash is <b>MORE</b> than the system expects.<br><br>Do not remove any overage. Submit the full physical amount for HQ review.<br><br>Do you want to permanently submit this Z-Reading?`
                : `Your declared cash is <b>SHORT</b> of the system expectation.<br><br>You will be required to submit a Reason Letter to HQ immediately after closing.<br><br>Do you want to permanently submit this Z-Reading?`;

            const result = await Swal.fire({
                title: alertTitle,
                html: alertHtml,
                icon: isOver ? 'info' : 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, End Shift',
                cancelButtonText: 'No, Re-count Cash',
                confirmButtonColor: isOver ? '#d97706' : '#dc2626',
                cancelButtonColor: '#64748b',
                customClass: { popup: 'rounded-2xl shadow-2xl' }
            });

            if (!result.isConfirmed) {
                if (confirmBtn) { confirmBtn.innerText = origText; confirmBtn.disabled = false; }
                return; // User aborted to recount!
            }
            
            // Log the Variance Alert to HQ
            await addDoc(collection(db, "manager_alerts"), {
                type: "VARIANCE_ALERT", branch: branchName, cashier: cashierName, shiftId: shiftId,
                expected: expectedCash, declared: declaredCash, varianceAmount: variance, stockCounts: {}, 
                message: `CASH ${isOver ? "OVER" : "SHORT"}: ₱${Math.abs(variance).toFixed(2)} variance detected.`,
                explanationCause: "Awaiting Staff Letter...", explanationMessage: "", explanationStatus: "Pending", 
                timestamp: serverTimestamp(), isRead: false
            });
        }

        confirmBtn.innerText = "⏳ Saving to Cloud...";
        
        // 7. FIREBASE: CLOSE SHIFT
        await updateDoc(doc(db, "shifts", shiftId), {
            active: false,
            endTime: serverTimestamp(),
            declaredCash: declaredCash,
            expectedCash: expectedCash,
            totalCashSales: totalCashSales, 
            totalDigitalSales: totalDigitalSales,
            digitalBreakdown: digitalBreakdown,
            cashBreakdown: cashBreakdown, 
            physicalStockCount: {}, // Purged
            status: "Closed"
        });

        // 8. FIREBASE: AUTO-SWEEP
        for (let method in digitalBreakdown) {
            if (method.toLowerCase() === "gcash") continue; 
            let amountToDeposit = digitalBreakdown[method];
            if (amountToDeposit > 0) {
                const accQ = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", method));
                const accSnap = await getDocs(accQ);
                if (!accSnap.empty) {
                    let accDoc = accSnap.docs[0];
                    let currentBal = accDoc.data().balance || 0;
                    await updateDoc(accDoc.ref, { balance: currentBal + amountToDeposit });
                    await addDoc(collection(db, "account_logs"), {
                        accountId: accDoc.id, accountName: method, branch: "Main Office", action: "Auto-Sweep (Shift Close)",
                        amount: amountToDeposit, newBalance: currentBal + amountToDeposit, user: cashierName, timestamp: serverTimestamp(), note: `From ${branchName}`
                    });
                } else {
                    const newAccRef = await addDoc(collection(db, "cash_accounts"), { name: method, branch: "Main Office", balance: amountToDeposit, createdAt: serverTimestamp() });
                    await addDoc(collection(db, "account_logs"), {
                        accountId: newAccRef.id, accountName: method, branch: "Main Office", action: "Auto-Sweep (New Account Generated)", amount: amountToDeposit, newBalance: amountToDeposit, user: 'System', timestamp: serverTimestamp(), note: `From ${branchName}`
                    });
                }
            }
        }

        // 9. FIREBASE: BATCH LOGS
        for (let ingName in shiftIngredientBurn) {
            let totalBurn = shiftIngredientBurn[ingName];
            if (totalBurn > 0) {
                await addDoc(collection(db, "stock_logs"), {
                    branch: branchName, item: ingName, uom: "Units", oldQty: "Shift", newQty: "Summary",
                    variance: -totalBurn, type: "Shift Sales Deduction", note: `Ingredients used during ${cashierName}'s shift`,
                    user: cashierName, timestamp: serverTimestamp()
                });
            }
        }

        // 10. CLEANUP & UI RESET
        localStorage.removeItem('currentShiftId');
        localStorage.removeItem('takodeal_sop_progress');
        if (typeof activeShiftDetails !== 'undefined') activeShiftDetails = null;
        if (typeof currentShift !== 'undefined') currentShift = null;

        let endModal = document.getElementById('endShiftModal');
        if (endModal) endModal.style.display = 'none';

        let topBtn = document.getElementById('btnTopShift');
        let lock = document.getElementById('shiftLockout');
        let placeBtn = document.getElementById('btnMainPlaceOrder');
        if (topBtn) topBtn.innerText = "🔴 Shift Closed";
        if (lock) lock.style.display = "flex";
        if (placeBtn) placeBtn.disabled = true;

        Swal.fire({
            title: '✅ Shift Closed!',
            text: `Bookkeeping Complete.\nCash Sales: ₱${totalCashSales.toFixed(2)}\nDigital Sales: ₱${totalDigitalSales.toFixed(2)}`,
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });

        if (typeof checkCurrentShift === 'function') await checkCurrentShift();
        if (typeof window.loadSalesDashboard === 'function') window.loadSalesDashboard();

    } catch (error) {
        console.error("Error closing shift:", error);
        Swal.fire('❌ Error', 'Failed to close shift: ' + error.message, 'error');
    } finally {
        if (confirmBtn) { confirmBtn.innerText = origText; confirmBtn.disabled = false; }
    }
};

// Ensure HTML correctly points to this new master function!
window.safeSubmitComprehensiveCloseShift = window.submitComprehensiveCloseShift;

// ========================================================
// 💸 UPGRADED MULTI-ITEM EXPENSE & RESTOCK CART ENGINE
// ========================================================
window.expenseCart = [];
window.expenseInventoryCache = [];
window.selectedExpenseItem = null; // Holds the DB item if they select one

window.openExpenseModal = async function () {
    document.getElementById('expenseModal').style.display = 'flex';
    document.getElementById('expSearchInput').value = '';
    document.getElementById('expQtyInput').value = '';
    document.getElementById('expAmtInput').value = '';
    window.expenseCart = [];
    window.renderExpenseCart();

    let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
    window.expenseInventoryCache = [];
    
    try {
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
            let item = docSnap.data();
            item.id = docSnap.id;
            window.expenseInventoryCache.push(item);
        });
    } catch (e) { console.error("Error loading inventory for expenses:", e); }
};

// Mobile-friendly custom search dropdown
window.filterExpenseSearch = function() {
    let input = document.getElementById('expSearchInput').value.toLowerCase();
    let resultsDiv = document.getElementById('expSearchResults');
    window.selectedExpenseItem = null; // Reset selection on typing

    if (input.length < 1) { resultsDiv.style.display = 'none'; return; }

    let filtered = window.expenseInventoryCache.filter(i => (i.name || '').toLowerCase().includes(input));
    let html = '';
    
    filtered.forEach(item => {
        let safeItemStr = encodeURIComponent(JSON.stringify(item));
        html += `<div onclick="window.selectExpenseItem('${safeItemStr}')" style="padding: 12px 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 14px; font-weight: bold; color: #334155;">📦 Restock: ${item.name} <span style="font-size:11px; color:#94a3b8;">(${item.uom || ''})</span></div>`;
    });

    if (html === '') {
        html = `<div style="padding: 12px 15px; font-size: 13px; color: #64748b; font-style: italic;">No inventory found. This will be saved as a General Expense.</div>`;
    }

    resultsDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
};

window.selectExpenseItem = function(encodedItem) {
    let item = JSON.parse(decodeURIComponent(encodedItem));
    window.selectedExpenseItem = item;
    document.getElementById('expSearchInput').value = `Restock: ${item.name}`;
    document.getElementById('expSearchResults').style.display = 'none';

    // 🔥 SHOW UOM DROPDOWN
    let uomContainer = document.getElementById('expUomContainer');
    let uomSelect = document.getElementById('expUomSelect');
    if (uomContainer && uomSelect) {
        uomContainer.style.display = 'block';
        let html = `<option value="base">${item.uom || 'units'}</option>`;
        if (item.purchaseUom) {
            html = `<option value="purch">${item.purchaseUom} (x${item.conversionRate || 1})</option>` + html;
        }
        uomSelect.innerHTML = html;
    }

    document.getElementById('expQtyInput').focus();
};

window.addExpenseToCart = function() {
    let desc = document.getElementById('expSearchInput').value.trim();
    let rawQty = parseFloat(document.getElementById('expQtyInput').value) || 0;
    let cost = parseFloat(document.getElementById('expAmtInput').value) || 0;

    if (!desc || cost <= 0) { alert("Enter a description and a valid cost."); return; }

    // 🔥 SMART UOM MATH
    let baseQty = rawQty;
    let displayUom = '';
    let convRate = 1;

    if (window.selectedExpenseItem) {
        let uomSelect = document.getElementById('expUomSelect');
        displayUom = window.selectedExpenseItem.uom;
        if (uomSelect && uomSelect.value === 'purch') {
            convRate = parseFloat(window.selectedExpenseItem.conversionRate) || 1;
            baseQty = rawQty * convRate; // Multiply by bulk size!
            displayUom = window.selectedExpenseItem.purchaseUom;
        }
    }

    let cartItem = {
        description: desc,
        cost: cost,
        displayQty: rawQty,
        baseQty: baseQty,
        displayUom: displayUom,
        isRestock: window.selectedExpenseItem !== null,
        dbId: window.selectedExpenseItem ? window.selectedExpenseItem.id : null,
        dbName: window.selectedExpenseItem ? window.selectedExpenseItem.name : null,
        uom: window.selectedExpenseItem ? window.selectedExpenseItem.uom : null
    };

    window.expenseCart.push(cartItem);
    
    // Clear inputs for next item
    document.getElementById('expSearchInput').value = '';
    document.getElementById('expQtyInput').value = '';
    document.getElementById('expAmtInput').value = '';
    if(document.getElementById('expUomContainer')) document.getElementById('expUomContainer').style.display = 'none';
    window.selectedExpenseItem = null;
    
    window.renderExpenseCart();
};

window.removeExpenseItem = function(index) {
    window.expenseCart.splice(index, 1);
    window.renderExpenseCart();
};

window.renderExpenseCart = function() {
    let tbody = document.getElementById('expenseCartBody');
    let totalEl = document.getElementById('expenseCartTotal');
    let total = 0;

    if (window.expenseCart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 15px; color: #94a3b8;">Cart is empty.</td></tr>';
        totalEl.innerText = '₱0.00';
        return;
    }

    let html = '';
    window.expenseCart.forEach((item, index) => {
        total += item.cost;
        let qtyText = item.isRestock && item.displayQty > 0 ? `<br><span style="color:#16a34a; font-size:11px;">+${item.displayQty} ${item.displayUom} (${item.baseQty} ${item.uom} to inventory)</span>` : '';
        html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px; font-weight: bold; color: #334155;">${item.description} ${qtyText}</td>
                <td style="padding: 10px; font-weight: bold; color: #dc2626;">₱${item.cost.toFixed(2)}</td>
                <td style="padding: 10px; text-align: right;"><button onclick="window.removeExpenseItem(${index})" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; border-radius:4px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">✖</button></td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    totalEl.innerText = `₱${total.toFixed(2)}`;
};

window.submitExpenseCart = async function() {
    if (window.expenseCart.length === 0) { alert("Cart is empty!"); return; }
    if (!activeShiftDetails || !activeShiftDetails.logId) { alert("No active shift found to attach these expenses to!"); return; }

    let btn = document.getElementById('btnSubmitExpenseCart');
    btn.innerText = "⏳ Processing..."; btn.disabled = true;

    let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
    let cashier = localStorage.getItem('cashierName') || 'Unknown';
    let grandTotal = window.expenseCart.reduce((sum, item) => sum + item.cost, 0);

    try {
        // 1. 🛡️ UPLOAD PHOTO SAFELY
        let photoUrl = null;
        let fileInput = document.getElementById('expenseReceiptPhoto');
        if (fileInput && fileInput.files.length > 0) {
            btn.innerText = "⏳ Uploading Photo...";
            try {
                const file = fileInput.files[0];
                const fileExt = file.name.split('.').pop();
                const storageRef = ref(window.storage, `expenses/${branch}_${Date.now()}.${fileExt}`);
                const snapshot = await uploadBytes(storageRef, file);
                photoUrl = await getDownloadURL(snapshot.ref);
            } catch (err) {
                console.error("Storage upload failed:", err);
                alert("⚠️ Photo upload failed (Check Firebase Storage Permissions). The expense will still be saved, but without the photo attached.");
            }
        }

        // 2. Process each item in cart
        for (let item of window.expenseCart) {
            
            // 🔥 THE FIX: Inject the Quantity directly into the description so the Manager Expense Feed can read it!
            let finalDescription = item.description;
            if (item.isRestock && item.displayQty > 0) {
                finalDescription = `${item.description} (Qty: ${item.displayQty} ${item.displayUom})`;
            }

            await addDoc(collection(db, "expenses"), {
                branch: branch,
                shiftId: activeShiftDetails.logId,
                cashier: cashier,
                amount: item.cost,
                description: finalDescription,
                receiptPhoto: photoUrl, 
                timestamp: serverTimestamp()
            });

            // 3. 🧠 THE AUTO-AVERAGE COSTING & INVENTORY INJECTOR
            if (item.isRestock && item.dbId && item.baseQty > 0) {
                const invRef = doc(db, "inventory", item.dbId);
                const invSnap = await getDoc(invRef);
                if (invSnap.exists()) {
                    let d = invSnap.data();
                    let currentStock = parseFloat(d.currentStock) || 0;
                    let currentAvgCost = parseFloat(d.cost) || 0;
                    
                    let unitCostOfThisPurchase = item.cost / item.baseQty;
                    let newTotalValue = (currentStock * currentAvgCost) + item.cost;
                    let newTotalStock = currentStock + item.baseQty;
                    let newAverageCost = newTotalStock > 0 ? (newTotalValue / newTotalStock) : unitCostOfThisPurchase;

                    await updateDoc(invRef, {
                        currentStock: newTotalStock,
                        cost: newAverageCost 
                    });

                    // Log the stock addition
                    await addDoc(collection(db, "stock_logs"), {
                        branch: branch, item: item.dbName, uom: item.uom, oldQty: currentStock, newQty: newTotalStock, variance: item.baseQty,
                        type: "Store Restock (Expense)", note: `Purchased ${item.displayQty} ${item.displayUom} for ₱${item.cost}`, user: cashier, timestamp: serverTimestamp()
                    });
                }
            }
        }

        const shiftRef = doc(db, "shifts", activeShiftDetails.logId);
        const shiftSnap = await getDoc(shiftRef);
        let currentExp = shiftSnap.data().expenses || shiftSnap.data().cashOut || 0;
        await updateDoc(shiftRef, { expenses: currentExp + grandTotal, cashOut: currentExp + grandTotal });

        alert(`✅ Success! ₱${grandTotal.toFixed(2)} deducted from drawer for ${window.expenseCart.length} item(s).`);
        document.getElementById('expenseModal').style.display = 'none';
        
        if (typeof checkCurrentShift === 'function') checkCurrentShift();

    } catch (e) {
        console.error("Expense Cart Error:", e);
        alert("❌ Failed to process expenses. Check connection.");
    } finally {
        if (btn) { btn.innerText = "Submit All Expenses"; btn.disabled = false; }
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
    
    let todayObj = new Date();
    let todayStr = todayObj.toISOString().split('T')[0];
    document.getElementById('remitEndDate').value = todayStr;
    document.getElementById('remitStartDate').value = "Loading..."; 

    // 🔥 MONDAY COUNTDOWN ENGINE
    let dayOfWeek = todayObj.getDay(); // 0 is Sunday, 1 is Monday...
    let daysUntilMonday = (1 + 7 - dayOfWeek) % 7;
    if (daysUntilMonday === 0) daysUntilMonday = 7; // If today is Monday, next is 7 days

    let alertBox = document.getElementById('remitCountdownAlert');
    if (daysUntilMonday === 7) {
        alertBox.innerText = "🚨 TODAY IS MANDATORY REMITTANCE DAY! (MONDAY)";
        alertBox.style.background = "#fef2f2"; alertBox.style.color = "#dc2626"; alertBox.style.borderColor = "#fca5a5";
    } else {
        alertBox.innerText = `⏳ Next Mandatory Remittance: Monday (${daysUntilMonday} days left)`;
        alertBox.style.background = "#eff6ff"; alertBox.style.color = "#1d4ed8"; alertBox.style.borderColor = "#3b82f6";
    }

    try {
        let safeBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        // Pull the exact end date of their LAST remittance
        const q = query(collection(db, "remittances"), where("branch", "==", safeBranch), orderBy("timestamp", "desc"), limit(1));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            let lastData = snap.docs[0].data();
            let lastEndDateStr = lastData.salesPeriodEnd || lastData.timestamp.toDate().toISOString().split('T')[0];
            
            // Set Start Date to the day AFTER they last remitted
            let nextStartDate = new Date(lastEndDateStr);
            nextStartDate.setDate(nextStartDate.getDate() + 1);
            document.getElementById('remitStartDate').value = nextStartDate.toISOString().split('T')[0];
        } else {
            document.getElementById('remitStartDate').value = todayStr; 
        }
    } catch (e) {
        console.error("Error fetching last remittance:", e);
        document.getElementById('remitStartDate').value = todayStr;
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
    let remitAmount = parseFloat(document.getElementById('remitAmount').value);
    let channel = document.getElementById('remitChannel').value;
    let recipient = document.getElementById('remitRecipient').value.trim();
    let refNum = document.getElementById('remitRefNum').value.trim();
    let startDate = document.getElementById('remitStartDate').value;
    let endDate = document.getElementById('remitEndDate').value;
    
    if (isNaN(remitAmount) || remitAmount <= 0 || !channel || !recipient) { alert("❌ Fill out Amount, Channel, and Recipient."); return; }

    let btn = document.querySelector("button[onclick='submitRemittance()']");
    if(btn) { btn.innerText = "⏳ Auditing Drawer..."; btn.disabled = true; }

    try {
        let userPin = document.getElementById('remitPinCode').value;
        let identity = await window.verifyPin(userPin);
        if (!identity) { alert("❌ Incorrect PIN."); if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; } return; }

        // 💸 NEW MATH: Look ONLY at the latest drawer balances!
        let drawerCash = 0;
        let shiftIdToLog = "Accumulated_Floating";
        
        const activeQ = query(collection(db, "shifts"), where("branch", "==", safeBranch), where("active", "==", true), limit(1));
        const activeSnap = await getDocs(activeQ);
        
        if (!activeSnap.empty) {
            let shiftData = activeSnap.docs[0].data();
            shiftIdToLog = activeSnap.docs[0].id;
            let start = parseFloat(shiftData.startingCash) || 0;
            let cashOut = parseFloat(shiftData.cashOut) || 0;
            
            let cashSales = 0;
            let validStartTime = shiftData.startTime.toDate ? shiftData.startTime.toDate() : new Date(shiftData.startTime);
            const txQ = query(collection(db, "transactions"), where("branch", "==", safeBranch), where("timestamp", ">=", validStartTime));
            const txSnap = await getDocs(txQ);
            txSnap.forEach(d => {
                let tx = d.data();
                if (tx.status !== 'Voided') {
                    if (tx.splitDetails) {
                        let cashSplit = tx.splitDetails.find(s => s.method === "Cash");
                        if (cashSplit) cashSales += cashSplit.amount;
                    } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                        cashSales += (tx.netTotal || 0);
                    }
                }
            });
            drawerCash = (start + cashSales) - cashOut;
        } else {
            const lastShiftQ = query(collection(db, "shifts"), where("branch", "==", safeBranch), where("status", "==", "Closed"), orderBy("endTime", "desc"), limit(1));
            const lastShiftSnap = await getDocs(lastShiftQ);
            if (!lastShiftSnap.empty) {
                drawerCash = parseFloat(lastShiftSnap.docs[0].data().declaredCash) || 0;
            }
        }

        if (remitAmount > drawerCash + 500) { 
            alert(`⛔ REMITTANCE BLOCKED\n\nActual Cash in ${safeBranch} Drawer: ₱${drawerCash.toFixed(2)}\nAmount You Entered: ₱${remitAmount.toFixed(2)}\n\nYou cannot remit more physical cash than what is currently in the drawer!`);
            if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; }
            return;
        }

        await addDoc(collection(db, "remittances"), {
            branch: safeBranch, cashier: identity.cashierName, amount: remitAmount,
            channel: channel, recipient: recipient, referenceNumber: refNum,
            salesPeriodStart: startDate, salesPeriodEnd: endDate,
            status: "Pending", timestamp: serverTimestamp()
        });

        // Log the expense so it removes the physical cash from the building correctly
        await addDoc(collection(db, "expenses"), {
            branch: safeBranch, shiftId: shiftIdToLog, cashier: identity.cashierName, amount: remitAmount,
            description: `[REMITTANCE TO HQ] - ${channel} to ${recipient}`, timestamp: serverTimestamp()
        });

        alert("✅ Remittance sent to HQ!");
        document.getElementById('remitAmount').value = ''; document.getElementById('remitRefNum').value = '';
        window.switchRemittanceTab('history');
    } catch (e) { console.error(e); alert("❌ Failed to remit."); } 
    finally { if(btn) { btn.innerText = "Submit Remittance to HQ"; btn.disabled = false; } }
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
let cameraStream = null;
let currentBranchStaffCache = []; // DECLARED ONLY ONCE HERE!

// ==========================================
// 🤖 FACE RECOGNITION AI ENGINE
// ==========================================
window.isFaceAiReady = false;

window.initFaceAI = async function() {
    let statusEl = document.getElementById('faceAiStatus');
    if (window.isFaceAiReady) {
        if(statusEl) statusEl.innerHTML = "🤖 Face AI Ready. Look at the camera.";
        return;
    }
    try {
        if(statusEl) statusEl.innerHTML = "🤖 Downloading AI Models... Please wait.";
        // We pull the raw models from the developer's public CDN
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        
        window.isFaceAiReady = true;
        if(statusEl) statusEl.innerHTML = "🤖 Face AI Ready. Select your name.";
    } catch(e) {
        console.error("Face AI Error:", e);
        if(statusEl) statusEl.innerHTML = "⚠️ Face AI failed to load. Use PIN.";
    }
};

window.openTimeClockModal = async function() {
    document.getElementById('timeClockModal').style.display = 'flex';
    document.getElementById('clockStaffPin').value = ''; 
    let select = document.getElementById('clockStaffName');
    select.innerHTML = '<option value="">Loading Staff...</option>';
    
    try {
        // 🔥 ALL STAFF FETCH: No branch limits. Anyone can log in here!
        const q = query(collection(db, "cashiers"));
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
        
        // 🤖 Start downloading the AI Brain in the background
        window.initFaceAI();
        
    } catch (e) { 
        console.error(e); 
        alert("⚠️ Error loading Time Clock. Check Camera permissions."); 
    }
};

window.closeTimeClock = function() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    document.getElementById('timeClockModal').style.display = 'none';
};

window.isProcessingAttendance = false;

window.submitAttendance = async function(type) {
    // 1. INSTANT LOCAL LOCK (Stops double-tapping instantly)
    if (window.isProcessingAttendance) return;
    window.isProcessingAttendance = true;

    let buttons = document.querySelectorAll('#timeClockModal button');
    buttons.forEach(b => {
        b.disabled = true;
        if (b.innerText === type) b.innerText = "⏳ Syncing..."; 
    });

    const staffName = document.getElementById('clockStaffName').value;
    const inputPin = document.getElementById('clockStaffPin').value.trim();

    // Helper function to safely unlock the UI if something fails
    const unlockUI = () => {
        window.isProcessingAttendance = false;
        buttons.forEach(b => b.disabled = false);
        let btnIn = document.querySelector('button[onclick*="TIME IN"]');
        if(btnIn) btnIn.innerText = "TIME IN";
        let btnOut = document.querySelector('button[onclick*="TIME OUT"]');
        if(btnOut) btnOut.innerText = "TIME OUT";
    };

    if (!staffName) { 
        alert("❌ Please select your name."); 
        unlockUI();
        return; 
    }

    // 2. OFFLINE COOLDOWN LOCK
    let punchCooldownKey = `takodeal_punch_${staffName}`;
    let lastPunchTime = localStorage.getItem(punchCooldownKey);
    if (lastPunchTime && (Date.now() - parseInt(lastPunchTime) < 60000)) { 
        alert("⏳ Sync in progress!\n\nYour previous punch is still processing due to slow internet. Please wait 1 minute before trying again to prevent duplicate logs.");
        unlockUI();
        return;
    }

    let staffProfile = window.currentBranchStaffCache ? window.currentBranchStaffCache.find(s => s.cashierName === staffName) : null;
    
    // 🔥 THE FIX: If the tablet's temporary memory is empty, fetch the profile directly from the Cloud!
    if (!staffProfile) {
        try {
            const staffQ = query(collection(db, "cashiers"), where("cashierName", "==", staffName));
            const staffSnap = await getDocs(staffQ);
            
            if (!staffSnap.empty) {
                staffProfile = staffSnap.docs[0].data();
            } else {
                alert(`❌ Error: ${staffName}'s profile could not be found in the database. Please contact the Manager.`);
                unlockUI();
                return;
            }
        } catch (e) {
            console.error("Staff Fetch Error:", e);
            alert("❌ Error connecting to the cloud to verify your profile. Please check the tablet's internet connection.");
            unlockUI();
            return;
        }
    }
    
    // ==========================================
    // 🤖 FACE AI VERIFICATION & REGISTRATION
    // ==========================================
    let faceVerified = false;

    if (window.isFaceAiReady) {
        let statusEl = document.getElementById('faceAiStatus');
        statusEl.innerHTML = "🤖 Scanning facial geometry... Hold still.";
        const videoEl = document.getElementById('clockVideo');
        
        try {
            const detection = await faceapi.detectSingleFace(videoEl).withFaceLandmarks().withFaceDescriptor();

            if (detection) {
                if (staffProfile.faceDescriptor && staffProfile.faceDescriptor.length > 0) {
                    const savedDescriptor = new Float32Array(staffProfile.faceDescriptor);
                    const distance = faceapi.euclideanDistance(detection.descriptor, savedDescriptor);
                    
                    if (distance < 0.55) {
                        faceVerified = true;
                        statusEl.innerHTML = "✅ Identity Verified!";
                    } else {
                        alert(`❌ AI Face Mismatch! (Security Distance: ${distance.toFixed(2)})\n\nYou do not match the registered face for ${staffName}.\nIf you are ${staffName}, please enter your PIN to bypass.`);
                        statusEl.innerHTML = "🤖 Face AI Ready.";
                    }
                } else {
                    if (inputPin && staffProfile.pin === inputPin) {
                        const cashierQ = query(collection(db, "cashiers"), where("cashierName", "==", staffName));
                        const cashierSnap = await getDocs(cashierQ);
                        if (!cashierSnap.empty) {
                            await updateDoc(cashierSnap.docs[0].ref, {
                                faceDescriptor: Array.from(detection.descriptor)
                            });
                            alert("✅ Face ID Successfully Registered!\n\nFor your next shift, you can leave the PIN blank and just look at the camera.");
                            faceVerified = true;
                        }
                    } else {
                        alert("🤖 Face Registration Required!\n\nYou do not have a Face ID saved yet. Please enter your 4-Digit PIN to register your face securely.");
                        statusEl.innerHTML = "🤖 Enter PIN to register face.";
                        unlockUI();
                        return;
                    }
                }
            } else {
                if (!confirm("❌ AI could not detect a face clearly. Please ensure you are in a well-lit area and looking at the camera.\n\nClick OK to bypass the AI and use your manual PIN.")) {
                    statusEl.innerHTML = "🤖 Ready. Look at camera.";
                    unlockUI();
                    return;
                }
            }
        } catch(e) { console.error("AI processing error:", e); }
    }

    // ==========================================
    // 🔒 FALLBACK: MANUAL PIN VERIFICATION
    // ==========================================
    if (!faceVerified) {
        if (!inputPin || staffProfile.pin !== inputPin) {
            alert("❌ INTRUDER ALERT: Incorrect PIN for " + staffName);
            document.getElementById('clockStaffPin').value = ''; 
            unlockUI();
            return;
        }
    }

    // ==========================================
    // 🚨 HR SANCTION & NTE LOCK (TIME CLOCK BLOCKER)
    // ==========================================
    try {
        const nteQ = query(collection(db, "hr_sanctions"), where("staffName", "==", staffName), where("status", "==", "Pending Reply"));
        const nteSnap = await getDocs(nteQ);
        
        if (!nteSnap.empty) {
            let nteData = nteSnap.docs[0].data();
            let nteId = nteSnap.docs[0].id;
            
            let clockModal = document.getElementById('timeClockModal');
            if (clockModal) clockModal.style.display = 'none';
            
            let nteModal = document.getElementById('sanctionModal') || document.getElementById('nteModal');
            
            if (nteModal) {
                nteModal.style.display = 'flex';
                if (document.getElementById('sancDocId')) document.getElementById('sancDocId').value = nteId;
                if (document.getElementById('sancTitle')) document.getElementById('sancTitle').innerText = nteData.type;
                if (document.getElementById('sancDetails')) document.getElementById('sancDetails').innerText = nteData.details;
                if (typeof window.clearSignature === 'function') window.clearSignature();
            } else {
                Swal.fire({
                    title: '🚨 TIME CLOCK LOCKED',
                    html: `You have an unresolved <b>Notice to Explain (NTE)</b> regarding:<br><br>
                           <span style="color:#dc2626; font-weight:bold; font-size:16px;">"${nteData.type}"</span><br><br>
                           <span style="color:#475569; font-size:14px;">You <b>cannot Time In</b> until you acknowledge and reply to this notice.</span><br><br>
                           <i>Please log out the current POS user and log in with your PIN to read and sign your notice.</i>`,
                    icon: 'error',
                    confirmButtonText: 'Understood',
                    confirmButtonColor: '#dc2626',
                    allowOutsideClick: false,
                    customClass: { popup: 'rounded-2xl shadow-2xl border border-red-100' }
                });
            }
            
            document.getElementById('clockStaffPin').value = ''; 
            unlockUI(); 
            return; 
        }
    } catch(e) {
        console.error("NTE Check Failed:", e);
    }

    // ==========================================
    // 🛡️ ANTI-DOUBLE PUNCH, PENALTIES & HR LOCKS
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

            if (type === "TIME IN" && lastType === "TIME IN") {
                if (hoursSinceLastLog > 12) {
                    const penaltyConfirm = await Swal.fire({
                        title: '⚠️ Missing Time-Out Detected',
                        html: `You forgot to TIME OUT during your previous shift.<br><br><span style="color:#dc2626; font-weight:bold; font-size:16px;">PENALTY APPLIED:</span><br><span style="color:#475569; font-size:14px;">Your pay for the missing clock-out shift will be delayed and paid on the <b>NEXT CUT-OFF</b>.</span><br><br>Do you accept this penalty and wish to Time In for today?`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#d97706',
                        cancelButtonColor: '#64748b',
                        confirmButtonText: 'Accept Penalty & Time In',
                        customClass: { popup: 'rounded-2xl shadow-2xl border border-red-100' }
                    });

                    if (!penaltyConfirm.isConfirmed) {
                        document.getElementById('clockStaffPin').value = ''; unlockUI(); return; 
                    }

                    let autoOutTime = new Date(lastTime.getTime() + (9 * 60 * 60 * 1000));
                    
                    await addDoc(collection(db, "attendance_logs"), {
                        staffName: staffName, 
                        branch: lastLog.branch, 
                        type: "AUTO TIME OUT (Penalty)", 
                        timestamp: autoOutTime, 
                        locationLat: lastLog.locationLat || 0, 
                        locationLng: lastLog.locationLng || 0, 
                        distanceMeters: lastLog.distanceMeters || 0, 
                        photoBase64: lastLog.photoBase64 || "",
                        penaltyApplied: true,
                        notes: "Forced Auto-Out. Paid next cut-off."
                    });

                    await addDoc(collection(db, "manager_alerts"), {
                        type: "ATTENDANCE_PENALTY", branch: localStorage.getItem('takodeal_device_branch') || 'Unknown', cashier: staffName,
                        message: `HR PENALTY: ${staffName} forgot to Time Out yesterday. System auto-closed their shift at 9 hours and applied the 'Paid Next Cut-Off' penalty.`,
                        timestamp: new Date(), isRead: false
                    });
                    
                } else {
                    alert(`❌ You are already Timed In!\n\nYou must TIME OUT of your current shift before starting a new one.`);
                    document.getElementById('clockStaffPin').value = ''; unlockUI(); return; 
                }
            }

            if (type === "TIME OUT" && lastType === "TIME OUT" && hoursSinceLastLog < 1) {
                alert(`❌ You already Timed Out recently!\n\nPlease avoid double-tapping.`);
                document.getElementById('clockStaffPin').value = ''; unlockUI(); return; 
            }
            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSinceLastLog < 0.25) {
                alert(`❌ You just Timed In a few minutes ago!\n\nTo prevent double-shifts and payroll errors, you must wait at least 15 minutes before Timing Out.`);
                document.getElementById('clockStaffPin').value = ''; unlockUI(); return; 
            }

            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSinceLastLog > 14) {
                await addDoc(collection(db, "manager_alerts"), {
                    type: "ATTENDANCE_ALERT", branch: localStorage.getItem('takodeal_device_branch') || 'Unknown', cashier: staffName,
                    message: `URGENT HR ALERT: ${staffName} just timed out after ${hoursSinceLastLog.toFixed(1)} hours. Straight Duties MUST be logged as two separate shifts.`,
                    timestamp: new Date(), isRead: false
                });
              // 🔥 THE UNDERTIME FIX: Intercept Time Outs under 8 hours!
            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSinceLastLog < 8 && hoursSinceLastLog >= 0.25) {
                const { value: reason, isConfirmed } = await Swal.fire({
                    title: '⚠️ Undertime Detected',
                    html: `You have only worked <b>${hoursSinceLastLog.toFixed(1)} hours</b> today.<br><br>You must provide a valid reason for timing out early. This will be submitted directly to the Manager's Inbox.`,
                    input: 'text',
                    inputPlaceholder: 'Reason for leaving early...',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Submit & Time Out',
                    confirmButtonColor: '#dc2626',
                    customClass: { popup: 'rounded-2xl shadow-xl' }
                });

                if (!isConfirmed || !reason) {
                    unlockUI(); return; 
                }

                // Auto-submit Reason Letter to the Manager App
                await addDoc(collection(db, "staff_requests"), {
                    type: "Reason Letter",
                    staffName: staffName,
                    branch: finalBranch,
                    status: "Pending",
                    explanationCause: "Undertime",
                    explanationMessage: `Clocked out early after ${hoursSinceLastLog.toFixed(1)} hours. Reason: ${reason}`,
                    timestamp: new Date() // Use JS Date for cross-app compatibility
                });
                
                Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Undertime Letter Sent!', showConfirmButton: false, timer: 3000});
            }
                alert(`🚨 SHIFT VIOLATION DETECTED (${hoursSinceLastLog.toFixed(1)} hrs)\n\nYou have exceeded the 14-hour single-shift limit. The Manager has been notified to review this time punch.`);
            }

            // 🔥 THE UNDERTIME FIX: Intercept Time Outs under 8 hours!
            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSinceLastLog < 8 && hoursSinceLastLog >= 0.25) {
                const { value: reason, isConfirmed } = await Swal.fire({
                    title: '⚠️ Undertime Detected',
                    html: `You have only worked <b>${hoursSinceLastLog.toFixed(1)} hours</b> today.<br><br>You must provide a valid reason for timing out early. This will be submitted directly to the Manager's Inbox.`,
                    input: 'text',
                    inputPlaceholder: 'Reason for leaving early...',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Submit & Time Out',
                    confirmButtonColor: '#dc2626',
                    customClass: { popup: 'rounded-2xl shadow-xl' }
                });

                if (!isConfirmed || !reason) {
                    unlockUI(); return; 
                }

                // Auto-submit Reason Letter to the Manager App
                await addDoc(collection(db, "staff_requests"), {
                    type: "Reason Letter",
                    staffName: staffName,
                    branch: finalBranch,
                    status: "Pending",
                    explanationCause: "Undertime",
                    explanationMessage: `Clocked out early after ${hoursSinceLastLog.toFixed(1)} hours. Reason: ${reason}`,
                    timestamp: new Date() // Use JS Date for cross-app compatibility
                });
                
                Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Undertime Letter Sent!', showConfirmButton: false, timer: 3000});
            }
        }
    } catch(e) {
        console.warn("Fast query failed. Using fallback lock method...", e);
    }

    // ==========================================
    // 🌍 GPS GEOFENCING & AUTO-ROUTING
    // ==========================================
    const video = document.getElementById('clockVideo');
    const canvas = document.getElementById('clockCanvas');
    let photoBase64 = "";
    
    if (video && canvas && video.videoWidth > 0) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        photoBase64 = canvas.toDataURL('image/jpeg', 0.6); 
    }

    if (!navigator.geolocation) { 
        alert("❌ Geolocation is not supported."); 
        unlockUI(); return; 
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const userLat = position.coords.latitude; 
        const userLng = position.coords.longitude;
        
        let deviceBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let finalBranch = deviceBranch;
        let finalDistance = 0;

        // 🔥 THE FIX: Smart GPS Bypass for the Main Office!
        if (deviceBranch !== "Main Office") {
            const targetZone = window.BRANCH_ZONES ? window.BRANCH_ZONES[deviceBranch] : null;
            if (!targetZone) { 
                Swal.fire({
                    title: 'GPS Error',
                    text: `❌ GPS Configuration Missing for ${deviceBranch}.`,
                    icon: 'error',
                    confirmButtonText: 'Understood',
                    confirmButtonColor: '#ef4444'
                });
                unlockUI(); return; 
            }
            
            if (typeof window.getDistanceInMeters === 'function') {
                finalDistance = window.getDistanceInMeters(userLat, userLng, targetZone.lat, targetZone.lng);

                if (finalDistance > (window.ALLOWED_RADIUS_METERS || 50)) {
                    Swal.fire({
                        title: '🚨 SECURITY LOCKOUT!',
                        html: `You are <b>${Math.round(finalDistance)}m</b> away from ${deviceBranch}.<br>You must be within ${window.ALLOWED_RADIUS_METERS || 50}m to clock in!`,
                        icon: 'error',
                        confirmButtonText: 'Understood',
                        confirmButtonColor: '#ef4444'
                    });
                    unlockUI(); return;
                }
            }
        }
        
        try {
            await addDoc(collection(db, "attendance_logs"), {
                staffName: staffName, 
                branch: finalBranch, 
                type: type, 
                timestamp: new Date(),
                locationLat: userLat, 
                locationLng: userLng, 
                distanceMeters: Math.round(finalDistance), 
                photoBase64: photoBase64
            });
            
            localStorage.setItem(punchCooldownKey, Date.now());
            
            Swal.fire({
                title: '✅ Success!',
                text: `${type} SUCCESS at ${finalBranch}!\nIdentity and Location Verified.`,
                icon: 'success',
                timer: 2500,
                showConfirmButton: false,
                customClass: { popup: 'rounded-2xl' }
            });

            if (typeof window.closeTimeClock === 'function') window.closeTimeClock();
        } catch (error) { 
            console.error(error); alert("❌ Failed to log attendance."); 
        } 
        finally { unlockUI(); }
    }, (error) => { 
        alert("❌ GPS access required to Time In."); 
        unlockUI(); 
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
    } else if (type === 'Reason Letter') {
        let cause = document.getElementById('explainCause').value;
        let msg = document.getElementById('explainMessage').value.trim(); 
        if (!msg) return Swal.fire('Error', 'Please provide a detailed explanation.', 'error');
        payload.details = `Cause: ${cause}\n"${msg}"`; // This perfectly passes the text to the Manager App!
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
        // 1. Read the POS Config Hub to see which CATEGORIES are allowed
        const configSnap = await getDoc(doc(db, "settings", "global_pos_config"));
        let allowedCats = ["Prepared Batch"]; // Default fallback
        if (configSnap.exists() && configSnap.data().kitchenPrepCats && configSnap.data().kitchenPrepCats.length > 0) {
            // Normalize to lowercase so it matches safely even if capitalized differently
            allowedCats = configSnap.data().kitchenPrepCats.map(c => c.trim().toLowerCase());
        }

        // 2. Fetch inventory for this branch
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        
        let html = '';
        let hasItems = false;
        
        let items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        items.forEach(d => {
            let itemCat = (d.category || "").trim().toLowerCase();
            
            // 🔥 STRICT FILTER: Only show items if their category is in the POS Config Hub!
            if (!allowedCats.includes(itemCat)) return;
            if (d.showInPrep === false) return;
            
            hasItems = true;
         
            let baseUom = d.uom || d.baseUom || 'units';
            let purchUom = d.purchaseUom || d.purchUom || 'Batch'; 

            // 🔥 SAFELY SET UP IMAGES OUTSIDE THE HTML BLOCK
            let imgSrc = d.image || d.imageUrl;
            let iconHtml = imgSrc 
                ? `<img src="${imgSrc}" style="width: 55px; height: 55px; border-radius: 50%; object-fit: cover; border: 2px solid #e2e8f0; margin-bottom: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">` 
                : `<div style="width: 55px; height: 55px; background: #f8fafc; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 10px; border: 2px solid #e2e8f0;">🔪</div>`;

            // INJECT INTO HTML STRING
            html += `
                <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center; transition: transform 0.2s;">
                    ${iconHtml}
                    <h3 style="margin: 0 0 5px 0; color: #1e293b; font-size: 16px; font-weight: 900;">${d.name}</h3>
                    <span style="background: #f1f5f9; color: #475569; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-bottom: 15px;">Stock: ${(parseFloat(d.currentStock)||0).toFixed(1)} ${baseUom}</span>
                    
                    <button onclick="window.logPrepBatch('${d.id}', '${d.name.replace(/'/g, "\\'")}', '${branch}', '${purchUom}', '${baseUom}')" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.3); font-size: 14px; transition: 0.2s;">
                        + Log Prep (${purchUom})
                    </button>
                </div>
            `;
        });
        
        if (!hasItems) {
            html = `<div style="text-align:center; padding:40px; color:#94a3b8; grid-column:1/-1;">
                <span style="font-size: 40px; display: block; margin-bottom: 15px;">🕵️‍♂️</span>
                No Kitchen Prep items found.<br>In your Manager App > POS Config Hub, ensure "Kitchen Prep Categories" matches the categories of your prep items (e.g. Prepared Batch).
            </div>`;
        }
        
        container.innerHTML = html;
    } catch (e) {
        console.error("Prep Load Error:", e);
        container.innerHTML = `<div style="color:#ef4444; text-align:center; grid-column:1/-1; padding: 20px;">Failed to load items. Check connection.</div>`;
    }
};

window.logPrepBatch = async function(invId, itemName, branch, purchUom, baseUom) {
    if (!purchUom || purchUom === 'undefined') purchUom = 'Batch';
    if (!baseUom || baseUom === 'undefined') baseUom = 'units';

    // 🌟 BEAUTIFUL INPUT POPUP
    const { value: qtyRaw } = await Swal.fire({
        title: '🔪 Kitchen Prep',
        html: `<div style="margin-bottom: 10px; color: #475569; font-size: 15px;">How many <strong>${purchUom}s</strong> of <strong style="color: #0f172a;">${itemName}</strong> did you prepare today?</div>`,
        input: 'number',
        inputPlaceholder: `Enter number of ${purchUom}s...`,
        inputAttributes: { min: 0.1, step: 'any' },
        showCancelButton: true,
        confirmButtonText: 'Next ➡',
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#94a3b8',
        customClass: { popup: 'rounded-2xl shadow-2xl border border-gray-100' }
    });

    if (!qtyRaw) return; // User cancelled
    let qty = parseFloat(qtyRaw);

    // 🌟 BEAUTIFUL CONFIRMATION POPUP
    const confirmResult = await Swal.fire({
        title: 'Confirm Logging',
        html: `<div style="color: #475569;">You are about to log:<br><strong style="font-size: 22px; color: #16a34a; display: block; margin: 10px 0;">${qty} ${purchUom}(s)</strong> of <strong style="font-size: 18px;">${itemName}</strong>.<br><br><span style="font-size: 12px; color: #64748b;">This will automatically convert to ${baseUom} and deduct the raw ingredients used.</span></div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '✅ Yes, Log it!',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#ef4444',
        customClass: { popup: 'rounded-2xl shadow-2xl' }
    });

    if (!confirmResult.isConfirmed) return;

    // Show loading spinner
    Swal.fire({ title: 'Processing...', text: 'Updating inventory & recipes...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    try {
        const invRef = doc(db, "inventory", invId);
        const invSnap = await getDoc(invRef);
        let invData = invSnap.data();
        let currentStock = invData.currentStock || 0;
        
        let convRate = parseFloat(invData.conversionRate) || parseFloat(invData.conversion) || 1;
        let baseQtyToAdd = qty * convRate;

        await updateDoc(invRef, { currentStock: currentStock + baseQtyToAdd });

        const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
        const bomSnap = await getDocs(bomQ);
        let missingItems = [];

        if (!bomSnap.empty) {
            for (let bomDoc of bomSnap.docs) {
                let recipe = bomDoc.data();
                let rawIngredient = recipe.ingredientName;
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

        let safeCashierName = localStorage.getItem('cashierName') || "Kitchen Staff";
        await addDoc(collection(db, "stock_logs"), {
            branch: branch, item: itemName, variance: baseQtyToAdd, uom: baseUom,
            purchUom: purchUom, purchQty: qty, // 🔥 SAVES THE PACK SIZE TO THE DB!
            type: "End-of-Shift Kitchen Prep", note: `Prepared ${qty} ${purchUom}(s) by ${safeCashierName}`, timestamp: new Date()
        });

        // 🌟 BEAUTIFUL SUCCESS POPUP
        let msg = `<div style="text-align: left; font-size: 14px;">✅ Added <strong>+${baseQtyToAdd.toLocaleString()} ${baseUom}</strong> to the vault.`;
        if (missingItems.length > 0) {
            msg += `<br><br><span style="color: #dc2626;">⚠️ <strong>Warning:</strong> The following raw ingredients are missing from the ${branch} warehouse and were not deducted: <strong>${missingItems.join(", ")}</strong></span>`;
        }
        msg += `</div>`;
        
        Swal.fire({ title: 'Success!', html: msg, icon: 'success', confirmButtonColor: '#16a34a', customClass: { popup: 'rounded-2xl' } });
        
        window.loadKitchenPrep(); 
    } catch (e) {
        console.error("Prep Batch Error:", e);
        Swal.fire('Error', '❌ Failed to log prep batch. Check connection.', 'error');
    }
};

// ==========================================
// 📱 MOBILE ORDERS ENGINE & LISTENER
// ==========================================
window.mobileOrdersList = [];
window.mobileOrdersUnsubscribe = null;
window.hasLoadedMobileOrdersOnce = false; // Memory to track logins
// ==========================================
// 🚨 MOBILE EMERGENCY KILL SWITCH ENGINE
// ==========================================
window.isMobileOrderingActive = true; // Defaults to accepting

// Listens silently to see if another tablet already turned it off
setTimeout(() => {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) return;

    onSnapshot(doc(db, "settings", "status_" + branch), (docSnap) => {
        let btn = document.getElementById('btnMobileKillSwitch');
        if (docSnap.exists()) {
            let data = docSnap.data();
            window.isMobileOrderingActive = data.mobileOrdersActive !== false; // Defaults to true if undefined
        } else {
            window.isMobileOrderingActive = true;
        }

        if (btn) {
            if (window.isMobileOrderingActive) {
                btn.style.background = "#16a34a"; // Green
                btn.innerHTML = "🟢 Accepting";
            } else {
                btn.style.background = "#b91c1c"; // Dark Red
                btn.innerHTML = "🔴 PAUSED";
            }
        }
    });
}, 3000);

window.toggleMobileOrderingStatus = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) { alert("Branch not set!"); return; }

    let newState = !window.isMobileOrderingActive;
    
    if (!newState) {
        if (!confirm("🚨 WARNING: This will immediately PAUSE the Customer App for your branch. Customers will see a 'Currently Unavailable' message and cannot place orders.\n\nAre you sure you want to pause mobile ordering?")) return;
    }

    let btn = document.getElementById('btnMobileKillSwitch');
    btn.innerText = "⏳..."; btn.disabled = true;

    try {
        await setDoc(doc(db, "settings", "status_" + branch), { 
            mobileOrdersActive: newState,
            lastUpdatedBy: localStorage.getItem('cashierName') || 'System',
            lastUpdated: serverTimestamp()
        }, { merge: true });
        
    } catch(e) {
        console.error("Kill Switch Error:", e);
        alert("Failed to toggle Mobile Ordering. Check internet connection.");
    } finally {
        btn.disabled = false;
    }
};

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
        
    // 🔥 PART 3 FIX: ADD THE ERROR CATCHER HERE!
    }, (error) => {
        console.error("Firebase Mobile Orders Error:", error);
        alert("Firebase Error: " + error.message + "\n\n(If you see this, turn off Tracking Prevention in your browser shield icon!)");
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

        let imgSrc = item.image || item.imageUrl;
        let imgHtml = imgSrc 
            ? `<img src="${imgSrc}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">` 
            : `<div style="width: 50px; height: 50px; border-radius: 8px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 24px; border: 1px solid #cbd5e1;">🍲</div>`;

        html += `
            <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; background: white; display: flex; flex-direction: column; justify-content: space-between; gap: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div style="display: flex; align-items: center; gap: 15px;">
                    ${imgHtml}
                    <div style="flex: 1;">
                        <div style="font-weight: bold; color: #1e293b; font-size: 15px; line-height: 1.2;">${item.name}</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 600;">${item.category || 'Uncategorized'}</div>
                    </div>
                </div>
                <button onclick="window.toggleItemStatus('${item.id}', ${!isAvail})" style="width: 100%; padding: 12px; border-radius: 8px; font-weight: bold; font-size: 14px; border: 2px solid ${statusColor}; color: ${statusColor}; background: ${isAvail ? '#f0fdf4' : '#fef2f2'}; cursor: pointer; transition: all 0.2s;">
                    ${statusText}
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
        
        // 🔥 FIX: Removed "window." prefixes so it correctly uses the imported Firebase functions!
        const itemRef = doc(db, "menu", docId);
        const itemSnap = await getDoc(itemRef);
        let unavailableBranches = itemSnap.data().unavailableAt || [];

        // Add or remove this specific branch from the "Sold Out" list
        if (makeAvailable) {
            unavailableBranches = unavailableBranches.filter(b => b !== branch);
        } else {
            if (!unavailableBranches.includes(branch)) unavailableBranches.push(branch);
        }

        // 1. Update Cloud
        await updateDoc(itemRef, { unavailableAt: unavailableBranches });
        
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
    // 🔥 Lock in the customer details from the mobile order!
    let customerInput = document.getElementById('customerName') || document.getElementById('checkoutCustomerName');
    let orderTypeDrop = document.getElementById('orderType') || document.getElementById('checkoutOrderType');
        
    // (orderData is usually the variable name for the selected order. If yours is named 'order' or 'mobileOrder', change it below!)
    if (customerInput) {
         customerInput.value = order.customerName || order.name || "Mobile Customer";
    }
    if (orderTypeDrop) {
         orderTypeDrop.value = order.orderType || "Take-Out";
    }
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

// ========================================================
// 🚚 INCOMING DISPATCH RECEIVER (SMART TAB ENGINE)
// ========================================================
window.incomingDeliveriesList = [];

setTimeout(() => {
    let safeBranch = localStorage.getItem('takodeal_device_branch');
    if (!safeBranch) return;

    // Listens silently in the background
    onSnapshot(query(collection(db, "dispatch_logs"), where("toBranch", "==", safeBranch), where("status", "==", "In Transit")), (snap) => {
        window.incomingDeliveriesList = [];
        snap.forEach(doc => window.incomingDeliveriesList.push({ id: doc.id, ...doc.data() }));

        // Light up the Notification Badge
        let badge = document.getElementById('deliveryBadge');
        if (badge) {
            if (window.incomingDeliveriesList.length > 0) {
                badge.innerText = window.incomingDeliveriesList.length;
                badge.style.display = 'inline-block';
                badge.style.animation = 'pulse 2s infinite';
            } else {
                badge.style.display = 'none';
                badge.style.animation = 'none';
            }
        }

        // If they are currently looking at the tab, refresh it instantly
        if (document.getElementById('view-deliveries') && document.getElementById('view-deliveries').classList.contains('active')) {
             window.renderDeliveriesTab();
        }
    });
}, 3000);

window.renderDeliveriesTab = function() {
    let container = document.getElementById('deliveriesContainer');
    if (!container) return;

    if (window.incomingDeliveriesList.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 40px; color: #94a3b8; font-size: 16px; background: #f8fafc; border-radius: 8px;">No incoming deliveries at this time.</div>';
        return;
    }

    // 📦 STEP 1: GROUP SEPARATE FIREBASE DOCS BY DISPATCH / SHIPMENT SHEET
    let dispatchGroups = {};
    window.incomingDeliveriesList.forEach(del => {
        let groupKey = del.dispatchId || `${del.date}_${del.driver}`;
        if (!dispatchGroups[groupKey]) {
            dispatchGroups[groupKey] = {
                dispatchId: groupKey,
                date: del.date || 'Recent Date',
                time: del.time || '--:--',
                driver: del.driver || 'Assigned Driver',
                items: []
            };
        }
        dispatchGroups[groupKey].items.push(del);
    });

    // 📦 STEP 2: BUILD A SINGLE INVOICE SHEET CARD FOR EACH DISPATCH
    let html = '';
    for (let key in dispatchGroups) {
        let dispatch = dispatchGroups[key];
        
        let itemsTableRows = '';
        dispatch.items.forEach(item => {
            let friendlyQty = item.displayQty || item.qty;
            let friendlyUom = item.displayUom || item.uom;
            
            itemsTableRows += `
                <tr style="border-bottom: 1px solid #f1f5f9;" id="row_${item.id}">
                    <td style="padding: 12px 8px; font-weight: bold; color: #334155;">📦 ${item.item}</td>
                    <td style="padding: 12px 8px; font-weight: bold; color: #0284c7; text-align: center;">${friendlyQty} ${friendlyUom}</td>
                    <td style="padding: 12px 8px; text-align: center;">
                        <input type="number" id="recv_val_${item.id}" data-expected="${friendlyQty}" placeholder="${friendlyQty}" style="width: 85px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; font-weight: bold; outline: none;">
                    </td>
                    <td style="padding: 12px 8px; text-align: center; vertical-align: top;">
                        <label style="display: flex; align-items: center; justify-content: center; gap: 4px; background: #fff5f5; border: 1px dashed #fca5a5; padding: 6px 10px; border-radius: 6px; color: #dc2626; font-size: 11px; font-weight: bold; cursor: pointer; margin-bottom: 6px; width: 100%; box-sizing: border-box;">
                            <input type="checkbox" id="missing_check_${item.id}" onchange="window.toggleMissingItemRow('${item.id}')" style="accent-color: #dc2626; cursor: pointer;"> Not Delivered
                        </label>
                        <input type="text" id="remark_val_${item.id}" placeholder="Remarks / Reason..." style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; box-sizing: border-box; outline: none; text-align: center;">
                    </td>
                </tr>
            `;
        });

        html += `
            <div style="background: white; border: 2px solid #cbd5e1; padding: 20px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; align-items: center;">
                    <div>
                        <h3 style="margin: 0; color: #0f172a; font-size: 16px; letter-spacing: 0.3px;">📋 SHIPMENT DISPATCH TRACK SHEET</h3>
                        <span style="font-size: 12px; color: #64748b; font-weight: 500;">Dispatched: <strong>${dispatch.date} @ ${dispatch.time}</strong></span>
                    </div>
                    <div style="text-align: right;">
                        <span style="background:#e0f2fe; color:#0369a1; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; display: inline-block;">🚚 Driver: ${dispatch.driver}</span>
                    </div>
                </div>
                <div style="background: #fff1f2; color: #be123c; padding: 10px; border-radius: 6px; font-size: 12px; font-weight: bold; margin-bottom: 15px; border: 1px dashed #fecaca;">
                    ⚠️ IMPORTANT: Enter the physical quantity using the UNIT SHOWN below (e.g. Jars, Bottles, Sacks). DO NOT type grams or mL. The system will convert it automatically!
                </div>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; text-align: left; font-size: 13px;">
                    <thead>
                        <tr style="background: #f8fafc; color: #475569; border-bottom: 1px solid #cbd5e1;">
                            <th style="padding: 10px 8px;">Item Description</th>
                            <th style="padding: 10px 8px; text-align: center;">Expected</th>
                            <th style="padding: 10px 8px; text-align: center;">Actual Received</th>
                            <th style="padding: 10px 8px; text-align: center;">Security Exception</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsTableRows}
                    </tbody>
                </table>

                <button id="btn_submit_dispatch_${key}" onclick="window.submitGroupedDispatch('${key}', '${encodeURIComponent(JSON.stringify(dispatch.items))}')" style="width: 100%; background: #16a34a; color: white; border: none; padding: 15px; font-weight: bold; font-size: 15px; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 12px rgba(22,163,74,0.2); transition: 0.2s;">
                    📥 Confirm and Receive Complete Shipment
                </button>
            </div>
        `;
    }
    container.innerHTML = html;
};

// Quick UI Toggle visual treatment for missing items
window.toggleMissingItemRow = function(itemId) {
    let isChecked = document.getElementById(`missing_check_${itemId}`).checked;
    let inputField = document.getElementById(`recv_val_${itemId}`);
    let row = document.getElementById(`row_${itemId}`);
    
    if (isChecked) {
        inputField.value = 0;
        inputField.disabled = true;
        row.style.background = '#fff5f5';
    } else {
        inputField.value = '';
        inputField.disabled = false;
        row.style.background = 'transparent';
    }
};

window.submitGroupedDispatch = async function(groupKey, encodedItems) {
    let items = JSON.parse(decodeURIComponent(encodedItems));
    let masterBtn = document.getElementById(`btn_submit_dispatch_${groupKey}`);
    
    let itemsToProcess = [];
    for (let item of items) {
        let isMissing = document.getElementById(`missing_check_${item.id}`).checked;
        let inputVal = document.getElementById(`recv_val_${item.id}`).value;
        let remarkVal = document.getElementById(`remark_val_${item.id}`).value.trim();
        let actualDisplayQty = parseFloat(inputVal);

        if (isMissing) {
            actualDisplayQty = 0;
        } else if (isNaN(actualDisplayQty) || actualDisplayQty < 0) {
            actualDisplayQty = parseFloat(document.getElementById(`recv_val_${item.id}`).placeholder);
        }

        itemsToProcess.push({
            ...item,
            actualDisplayQty: actualDisplayQty,
            isMissing: isMissing,
            remarks: remarkVal
        });
    }

    if (!confirm(`Are you sure you want to verify receipt for this entire shipment sheet?`)) return;

    if (masterBtn) { masterBtn.innerText = "⏳ Processing Bulk Safe-Deposit..."; masterBtn.disabled = true; }
    let safeBranch = localStorage.getItem('takodeal_device_branch');

    try {
        await Promise.all(itemsToProcess.map(async (item) => {
            let convRate = item.convRate || 1;
            let baseUom = item.uom;
            let actualBaseQty = item.actualDisplayQty * convRate;
            let expectedDisplayQty = item.displayQty || item.qty;
            let expectedBaseQty = expectedDisplayQty * convRate;
            let varianceBase = actualBaseQty - expectedBaseQty;

            let exceptionStatus = "Received";
            if (item.isMissing) {
                exceptionStatus = "Lost in Transit";
            } else if (varianceBase !== 0) {
                exceptionStatus = "Discrepancy";
            }

            if (!item.isMissing && actualBaseQty > 0) {
                const targetQ = query(collection(db, "inventory"), where("branch", "==", safeBranch), where("name", "==", item.item));
                const targetSnap = await getDocs(targetQ);

                let oldStockForLog = 0;

                if (targetSnap.empty) {
                    await addDoc(collection(db, "inventory"), { 
                        branch: safeBranch, name: item.item, uom: baseUom, currentStock: actualBaseQty, 
                        category: item.category || "Ingredients", purchaseUom: item.purchaseUom || baseUom,
                        conversionOriginal: convRate, conversionRate: convRate, cost: item.cost || 0, reorderLevel: item.reorderLevel || 10, showInPrep: true
                    });
                } else {
                    let tRef = targetSnap.docs[0].ref;
                    let originalStock = targetSnap.docs[0].data().currentStock || 0;
                    oldStockForLog = originalStock;

                    // 🔥 THE WIPE-THE-SLATE FIX
                    // If current stock is negative (ghost debt), we force it to 0 before adding the delivery!
                    let baseStockMath = originalStock < 0 ? 0 : originalStock;
                    let newStock = baseStockMath + actualBaseQty;

                    await updateDoc(tRef, { currentStock: newStock });
                }

                // Add a note in the Manager's Trace Ledger so they know the ghost debt was wiped!
                let resetNote = oldStockForLog < 0 ? ` (Wiped ${oldStockForLog.toFixed(2)} negative ghost debt)` : '';

                await addDoc(collection(db, "stock_logs"), {
                    branch: safeBranch, item: item.item, uom: baseUom, oldQty: oldStockForLog,
                    newQty: (oldStockForLog < 0 ? 0 : oldStockForLog) + actualBaseQty, variance: actualBaseQty, 
                    type: "Delivery Received", note: `Group Batch Shipment Confirmed${resetNote}`, user: localStorage.getItem('cashierName') || 'System', timestamp: serverTimestamp()
                });
            }

            await updateDoc(doc(db, "dispatch_logs", item.id), {
                status: exceptionStatus,
                receivedQty: actualBaseQty, 
                variance: varianceBase,     
                receivedDisplayQty: item.actualDisplayQty, 
                receivedAt: serverTimestamp(),
                receivedBy: localStorage.getItem('cashierName') || 'Cashier',
                receivingRemarks: item.remarks
            });

            if (item.isMissing || varianceBase !== 0) {
                await addDoc(collection(db, "manager_alerts"), {
                    type: "DELIVERY_DISCREPANCY",
                    branch: safeBranch,
                    cashier: localStorage.getItem('cashierName') || 'Cashier',
                    message: `SH_ALERT: ${item.item} delivery discrepancy flagged at ${safeBranch}. Status: ${exceptionStatus}. Expected: ${expectedDisplayQty}, Got: ${item.actualDisplayQty}. Note: "${item.remarks || 'No remarks'}"`,
                    timestamp: serverTimestamp(),
                    isRead: false
                });
            }
        }));

        alert("🎉 Complete shipment sheet successfully verified and deposited to database registers!");

    } catch (error) {
        console.error("Bulk Process Error: ", error);
        alert("❌ Bulk write execution failure. Please check your data connection settings.");
    } finally {
        if (masterBtn) { masterBtn.innerText = "Confirm and Receive Complete Shipment"; masterBtn.disabled = false; }
    }
};

// ========================================================
// 🗑️ UPGRADED WASTE & SPOILAGE ENGINE (MULTI-CART & ALERTS)
// ========================================================
window.wasteCart = [];
window.wasteInventoryCache = [];
window.selectedWasteItem = null;

window.loadWasteItems = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) return;

    window.wasteInventoryCache = [];
    try {
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        
        let items = [];
        snap.forEach(doc => {
            let data = doc.data();
            data.id = doc.id;
            items.push(data);
        });
        
        // Sort alphabetically so the search works smoothly
        items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        window.wasteInventoryCache = items;
        
        window.loadWasteHistory(); // Load the table below it
    } catch (e) {
        console.error("Waste Items Error:", e);
    }
};

window.filterWasteSearch = function() {
    let input = document.getElementById('wasteSearchInput').value.toLowerCase();
    let resultsDiv = document.getElementById('wasteSearchResults');
    window.selectedWasteItem = null; // Reset selection

    if (input.length < 1) { 
        resultsDiv.style.display = 'none'; 
        return; 
    }

    let filtered = window.wasteInventoryCache.filter(i => (i.name || '').toLowerCase().includes(input));
    let html = '';
    
    filtered.forEach(item => {
        let safeItemStr = encodeURIComponent(JSON.stringify(item));
        html += `<div onclick="window.selectWasteItem('${safeItemStr}')" style="padding: 12px 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 14px; font-weight: bold; color: #334155; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">🗑️ ${item.name} <span style="font-size:11px; color:#94a3b8; font-weight: normal; margin-left: 5px;">(Live Stock: ${parseFloat(item.currentStock||0).toFixed(1)} ${item.uom || ''})</span></div>`;
    });

    if (html === '') html = `<div style="padding: 12px 15px; font-size: 13px; color: #64748b; font-style: italic;">No items match your search.</div>`;

    resultsDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
};

window.selectWasteItem = function(encodedItem) {
    let item = JSON.parse(decodeURIComponent(encodedItem));
    window.selectedWasteItem = item;
    
    document.getElementById('wasteSearchInput').value = item.name;
    document.getElementById('wasteSearchResults').style.display = 'none';
    document.getElementById('wasteQty').focus(); // Automatically move cursor to the Qty box!
};

window.addWasteToCart = function() {
    if (!window.selectedWasteItem) { 
        Swal.fire('Select Item', 'Please search and select an item from the dropdown list first.', 'warning'); 
        return; 
    }
    
    let qty = parseFloat(document.getElementById('wasteQty').value);
    let reason = document.getElementById('wasteReason').value;

    if (isNaN(qty) || qty <= 0) { 
        Swal.fire('Invalid Qty', 'Please enter a valid quantity greater than 0.', 'warning'); 
        return; 
    }

    let itemData = window.selectedWasteItem;

    // Safety Warning: Prevent negative stock visually
    if (qty > itemData.currentStock) {
        if (!confirm(`⚠️ WARNING: The system says you only have ${itemData.currentStock} ${itemData.uom || ''} left.\nWasting ${qty} will push your inventory into the negatives. Continue?`)) {
            return;
        }
    }

    // Add to the temporary cart array
    window.wasteCart.push({
        id: itemData.id,
        name: itemData.name,
        qty: qty,
        uom: itemData.uom || 'units',
        reason: reason,
        cost: parseFloat(itemData.baseCost) || parseFloat(itemData.cost) || 0
    });

    // Clear inputs for the next item
    document.getElementById('wasteSearchInput').value = '';
    document.getElementById('wasteQty').value = '';
    window.selectedWasteItem = null;
    
    window.renderWasteCart();
};

window.removeWasteItem = function(index) {
    window.wasteCart.splice(index, 1);
    window.renderWasteCart();
};

window.renderWasteCart = function() {
    let tbody = document.getElementById('wasteCartBody');
    let container = document.getElementById('wasteCartContainer');
    
    if (window.wasteCart.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    let html = '';
    window.wasteCart.forEach((item, index) => {
        html += `
            <tr style="border-bottom: 1px dashed #cbd5e1;">
                <td style="padding: 10px; font-weight: bold; color: #b91c1c;">${item.name}</td>
                <td style="padding: 10px; font-weight: 900; font-size: 15px;">${item.qty} <span style="font-size:11px; font-weight:normal; color:#64748b;">${item.uom}</span></td>
                <td style="padding: 10px; color: #475569; font-style: italic;">${item.reason}</td>
                <td style="padding: 10px; text-align: right;">
                    <button onclick="window.removeWasteItem(${index})" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-weight: bold; font-size: 11px;">✖ Remove</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
};

window.submitWasteCart = async function() {
    if (window.wasteCart.length === 0) {
        Swal.fire('Empty List', 'Please add items to the waste list before submitting.', 'info');
        return;
    }

    let branch = localStorage.getItem('takodeal_device_branch');
    let cashierName = localStorage.getItem('cashierName') || "Cashier";
    
    if (!confirm(`Are you sure you want to permanently deduct these ${window.wasteCart.length} items from your inventory?`)) return;

    let btn = document.getElementById('btnSubmitWasteCart');
    let origText = btn.innerText;
    btn.innerText = "⏳ Processing Waste...";
    btn.disabled = true;

    try {
        let totalValueLost = 0;
        let wasteDetailsString = [];

        // Loop through everything in the cart and deduct it
        for (let item of window.wasteCart) {
            let invRef = doc(db, "inventory", item.id);
            let invSnap = await getDoc(invRef);
            
            if (invSnap.exists()) {
                let currentStock = parseFloat(invSnap.data().currentStock) || 0;
                let newStock = currentStock - item.qty;

                // 1. Deduct from Live Inventory
                await updateDoc(invRef, { currentStock: newStock });

                // 2. Log to Global Stock History
                await addDoc(collection(db, "stock_logs"), {
                    branch: branch,
                    item: item.name,
                    uom: item.uom,
                    oldQty: currentStock,
                    newQty: newStock,
                    variance: -Math.abs(item.qty),
                    type: "Waste / Spoilage",
                    note: `Reason: ${item.reason}`,
                    user: cashierName,
                    timestamp: serverTimestamp()
                });

                // Calculate the financial loss
                let itemLoss = item.qty * item.cost;
                totalValueLost += itemLoss;
                wasteDetailsString.push(`${item.qty}x ${item.name}`);
            }
        }

        // 🚨 3. FIRE THE MANAGER SECURITY ALERT!
        await addDoc(collection(db, "manager_alerts"), {
            type: "WASTE_ALERT",
            branch: branch,
            cashier: cashierName,
            message: `WASTE REPORT: ${cashierName} logged ${window.wasteCart.length} item(s) as waste (${wasteDetailsString.join(', ')}). Est Value Lost: ₱${totalValueLost.toFixed(2)}.`,
            timestamp: serverTimestamp(),
            isRead: false
        });

        Swal.fire({
            title: '✅ Waste Logged',
            text: `Successfully deducted ${window.wasteCart.length} items from inventory. Management has been notified.`,
            icon: 'success',
            confirmButtonColor: '#16a34a',
            customClass: { popup: 'rounded-2xl' }
        });

        // Clean up the screen
        window.wasteCart = [];
        window.renderWasteCart();
        window.loadWasteHistory();

    } catch (e) {
        console.error("Waste Cart Error:", e);
        Swal.fire('Error', 'Failed to log waste. Check internet connection.', 'error');
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
};

window.loadWasteHistory = async function() {
    let tbody = document.getElementById('wasteHistoryBody');
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!tbody || !branch) return;

    try {
        // We only want to show Waste logs from today, for this specific branch
        let startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        const q = query(collection(db, "stock_logs"), 
            where("branch", "==", branch), 
            where("type", "==", "Waste / Spoilage"), 
            where("timestamp", ">=", startOfDay),
            orderBy("timestamp", "desc")
        );
        const snap = await getDocs(q);

        let html = '';
        snap.forEach(docSnap => {
            let d = docSnap.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : 'Just now';
            
            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 15px; color: #64748b; font-size: 13px;">${dateStr}</td>
                    <td style="padding: 15px; font-weight: bold; color: #334155; font-size: 14px;">${d.item}</td>
                    <td style="padding: 15px; font-weight: 900; color: #ef4444; font-size: 16px;">-${Math.abs(d.variance)} <span style="font-size: 11px; font-weight: normal; color: #94a3b8;">${d.uom}</span></td>
                    <td style="padding: 15px; color: #475569; font-style: italic;">${d.note}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding: 30px; color: #64748b;">No waste logged today! 🎉</td></tr>';
    } catch (e) {
        console.error("Waste History Error:", e);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: red;">Error fetching logs.</td></tr>';
    }
};

// ========================================================
// 📅 PERSONAL CASHIER SCHEDULE ENGINE
// ========================================================
window.loadPersonalSchedule = async function() {
    const container = document.getElementById('cashierScheduleContainer');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; padding: 40px; color:#64748b; font-size: 16px;">⏳ Fetching your schedule from HQ...</div>';

    // 1. Get the name of whoever is currently using the tablet
    let safeCashierName = localStorage.getItem('cashierName');
    if (!safeCashierName) {
        container.innerHTML = '<div style="text-align:center; padding: 40px; color:#dc2626; font-weight:bold;">❌ Please log in via the Time Clock / Lock Screen to view your schedule.</div>';
        return;
    }

    try {
        // 🔥 THE FIX: Removed 'window.' from all Firebase commands!
        const cashiersQ = query(collection(db, "cashiers"), where("cashierName", "==", safeCashierName));
        const cashiersSnap = await getDocs(cashiersQ);
        
        let schedName = safeCashierName; // Default to full name if no nickname is found
        if (!cashiersSnap.empty) {
            let cData = cashiersSnap.docs[0].data();
            if (cData.scheduleName && cData.scheduleName.trim() !== '') {
                schedName = cData.scheduleName; 
            }
        }

        // 3. Download the giant Global Schedule
        const schedSnap = await getDoc(doc(db, "settings", "global_schedule"));
        if (!schedSnap.exists()) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color:#64748b;">No schedule has been published by HQ yet.</div>';
            return;
        }

        const schedData = schedSnap.data();
        const branchConfig = schedData.branchConfig || {};
        const schedule = schedData.currentSchedule || {};
        const year = schedData.currentYear;
        const month = schedData.currentMonth;
        const holidays = schedData.holidays || {};

        if (!year || !month || Object.keys(schedule).length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color:#64748b;">The schedule for this month is currently empty.</div>';
            return;
        }

        // Format the Header
        const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

        let html = `
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px; text-align: center; display: flex; justify-content: space-between; align-items: center;">
                <div style="text-align: left;">
                    <h3 style="margin: 0; color: #0f766e; font-size: 20px;">🗓️ ${monthName}</h3>
                    <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Filtering shifts for: <strong>${schedName}</strong></div>
                </div>
                <div style="text-align: right;">
                    <button class="btn-refresh" onclick="window.loadPersonalSchedule()" style="background: white; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 6px; font-weight: bold; color: #334155; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔄 Refresh Schedule</button>
                </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <thead style="background: #0f172a; color: white;">
                    <tr>
                        <th style="padding: 15px;">Date</th>
                        <th style="padding: 15px;">Location</th>
                        <th style="padding: 15px;">Shift / Status</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let shiftCount = 0;

        // 4. Extract ONLY their shifts!
        for (let day = 1; day <= 31; day++) {
            if (!schedule[day]) continue;
            
            let dateObj = new Date(year, month - 1, day);
            let dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            // Check if this date is a holiday!
            let fullDateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            let holidayType = holidays[fullDateKey];
            let holBadge = holidayType ? `<br><span style="background: ${holidayType === 'Regular' ? '#fee2e2' : '#fef3c7'}; color: ${holidayType === 'Regular' ? '#dc2626' : '#ea580c'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; display: inline-block; margin-top: 4px;">⭐ ${holidayType} Holiday</span>` : '';

            let dailyShifts = [];

            // Search through every branch to see where they are assigned today
            for (let branch in schedule[day]) {
                let bData = schedule[day][branch];
                
                // A. Check if Scheduled for a specific Shift
                for (let sId in bData.scheduled) {
                    if (bData.scheduled[sId] === schedName) {
                        let shiftInfo = branchConfig[branch].find(s => s.id === sId);
                        let shiftName = shiftInfo ? shiftInfo.name : "Unknown Shift";
                        dailyShifts.push({ branch, status: `<span style="color: #0284c7; font-weight: 900; font-size: 15px;">${shiftName}</span>` });
                    }
                }

                // B. Check if on Standby
                if (bData.rest && bData.rest.includes(schedName)) {
                    dailyShifts.push({ branch, status: `<span style="color: #16a34a; font-weight: bold; font-style: italic;">Standby / Reliever</span>` });
                }

                // C. Check if Unavailable/Leave/Off
                let unavailMatch = bData.unavailable ? bData.unavailable.find(u => u.name === schedName) : null;
                if (unavailMatch) {
                    dailyShifts.push({ branch, status: `<span style="color: #ef4444; font-weight: bold; text-decoration: line-through;">${unavailMatch.status}</span>` });
                }
            }

            // Print the rows
            if (dailyShifts.length > 0) {
                dailyShifts.forEach(ds => {
                    html += `
                        <tr style="border-bottom: 1px solid #e2e8f0; background: white; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                            <td style="padding: 15px; font-weight: bold; color: #334155;">${dateStr} ${holBadge}</td>
                            <td style="padding: 15px;"><span class="badge badge-open">${ds.branch}</span></td>
                            <td style="padding: 15px;">${ds.status}</td>
                        </tr>
                    `;
                    shiftCount++;
                });
            }
        }

        html += `</tbody></table>`;

        if (shiftCount === 0) {
            container.innerHTML = `
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center;">
                    <h3 style="margin: 0; color: #0f766e; font-size: 18px;">${monthName}</h3>
                    <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Filtering shifts for: <strong>${schedName}</strong></div>
                    <div style="margin-top: 30px; font-weight: bold; color: #ef4444;">You have no shifts assigned for this month.</div>
                </div>
            `;
        } else {
            container.innerHTML = html;
        }

    } catch (e) {
        console.error("Error loading personal schedule:", e);
        container.innerHTML = '<div style="text-align:center; padding: 40px; color:red; font-weight: bold;">❌ Failed to load schedule. Please check your internet connection.</div>';
    }
};

window.filterCashierStock = function() {
    let input = document.getElementById('cashierStockSearch').value;
    window.renderStockCountUI(input);
};

// ==========================================
// 🚨 MOBILE EMERGENCY KILL SWITCH ENGINE
// ==========================================
window.isMobileOrderingActive = true; 

setTimeout(() => {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) return;

    onSnapshot(doc(db, "settings", "status_" + branch), (docSnap) => {
        let btn = document.getElementById('btnMobileKillSwitch');
        if (docSnap.exists()) {
            let data = docSnap.data();
            window.isMobileOrderingActive = data.mobileOrdersActive !== false; 
        } else {
            window.isMobileOrderingActive = true;
        }

        if (btn) {
            if (window.isMobileOrderingActive) {
                btn.style.background = "#16a34a";
                btn.innerHTML = "🟢 Accepting";
            } else {
                btn.style.background = "#b91c1c";
                btn.innerHTML = "🔴 PAUSED";
            }
        }
    });
}, 3000);

window.toggleMobileOrderingStatus = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) { alert("Branch not set!"); return; }

    let newState = !window.isMobileOrderingActive;
    
    if (!newState) {
        if (!confirm("🚨 WARNING: This will immediately PAUSE the Customer App for your branch. Customers will see a 'Currently Unavailable' message and cannot place orders.\n\nAre you sure you want to pause mobile ordering?")) return;
    }

    let btn = document.getElementById('btnMobileKillSwitch');
    btn.innerText = "⏳..."; btn.disabled = true;

    try {
        await setDoc(doc(db, "settings", "status_" + branch), { 
            mobileOrdersActive: newState,
            lastUpdatedBy: localStorage.getItem('cashierName') || 'System',
            lastUpdated: serverTimestamp()
        }, { merge: true });
        
    } catch(e) {
        console.error("Kill Switch Error:", e);
        alert("Failed to toggle Mobile Ordering. Check internet connection.");
    } finally {
        btn.disabled = false;
    }
};

// ==========================================
// 📍 UI INITIALIZATION: LOGIN SCREEN BRANCH DISPLAY
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // 🔥 THE FIX: Tell it to look for the exact memory key your Setup Engine uses!
    let savedBranch = localStorage.getItem("takodeal_device_branch");
    
    let branchDisplay = document.getElementById("loginBranchDisplay");
    
    if (branchDisplay) {
        if (savedBranch) {
            // It found the branch! Display it and remove the red warning color.
            branchDisplay.innerText = `📍 ${savedBranch}`;
            branchDisplay.style.color = "#fca5a5"; // A nice soft red/orange to match your UI
        } else {
            // If the tablet hasn't been registered to a branch yet
            branchDisplay.innerText = `📍 Unassigned Device`;
            branchDisplay.style.color = "#ef4444"; // Turns bright red to alert you!
        }
    }
});

// ========================================================
// 📦 INTERNAL STORE USE ENGINE (EXPENSE & P&L TRACKER)
// ========================================================
window.processStoreUse = async function() {
    if (!window.cart || window.cart.length === 0) {
        Swal.fire('Empty Cart', 'Please select the consumable items first.', 'warning');
        return;
    }

    let btn = document.querySelector('button[onclick="window.processStoreUse()"]');
    if (btn) { btn.innerText = "⏳ Logging..."; btn.disabled = true; }

    try {
        let totalCost = 0;
        let itemsLogged = [];

        for (let item of window.cart) {
            // 1. Find the item in the Live Inventory to get its TRUE COST and CURRENT STOCK
            const invQ = query(collection(db, "inventory"), where("branch", "==", window.currentBranch), where("name", "==", item.name));
            const invSnap = await getDocs(invQ);

            if (!invSnap.empty) {
                let invDoc = invSnap.docs[0];
                let invData = invDoc.data();
                let currentStock = invData.currentStock || 0;
                
                // 🔥 Calculate the actual cost to the business, not the "Selling Price"
                let trueCostPerUnit = parseFloat(invData.baseCost) || parseFloat(invData.cost) || 0;
                totalCost += (trueCostPerUnit * item.qty);

                // 2. Deduct from Live Stock
                await updateDoc(invDoc.ref, { currentStock: currentStock - item.qty });

                // 3. Log to the Trace Ledger
                await addDoc(collection(db, "stock_logs"), {
                    branch: window.currentBranch, item: item.name,
                    oldQty: currentStock, newQty: currentStock - item.qty, variance: -item.qty,
                    type: "Store Use", note: `Internal Consumables used by staff`,
                    user: window.cashierName || "Staff", timestamp: serverTimestamp()
                });
            }
            itemsLogged.push(`${item.qty}x ${item.name}`);
        }

        // 4. Hit the P&L! Send the cost directly to the Expenses Database
        if (totalCost > 0) {
            await addDoc(collection(db, "expenses"), {
                branch: window.currentBranch, amount: totalCost, 
                category: "Store Consumables", description: `Internal Use: ${itemsLogged.join(', ')}`,
                loggedBy: window.cashierName || "Staff", timestamp: serverTimestamp()
            });
        }

        // 5. Send to the Manager's Dedicated History Log
        await addDoc(collection(db, "store_use_logs"), {
            branch: window.currentBranch, items: window.cart, totalCost: totalCost,
            loggedBy: window.cashierName || "Staff", timestamp: serverTimestamp()
        });

        Swal.fire({
            title: '📦 Logged for Store Use!',
            text: 'Items deducted from stock and recorded as an operating expense.',
            icon: 'success', timer: 2000, showConfirmButton: false, customClass: { popup: 'rounded-2xl' }
        });

        // Close the modal and clear the cart!
        let modal = document.getElementById('paymentModal') || document.getElementById('checkoutModal');
        if (modal) modal.style.display = 'none';
        
        window.cart = [];
        if (typeof renderCart === 'function') renderCart();

    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to log consumables.', 'error');
    } finally {
        if (btn) { btn.innerText = "📦 Consumables"; btn.disabled = false; }
    }
};

// ========================================================
// 📦 INTERNAL STOCK REQUEST ENGINE (SMART VARIANCES)
// ========================================================
window.stockReqItemsFlat = [];

window.loadStockRequestUI = async function() {
    let container = document.getElementById('stockReqList');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Fetching live inventory & HQ status...</div>';

    try {
        // 1. Fetch Branch Inventory
        const qBranch = query(collection(db, "inventory"), where("branch", "==", sessionUser.branch));
        const snapBranch = await getDocs(qBranch);

        // 2. Fetch Main Office Inventory (To see if HQ has stock!)
        const qHQ = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
        const snapHQ = await getDocs(qHQ);
        let hqStockMap = {};
        snapHQ.forEach(doc => { hqStockMap[doc.data().name] = parseFloat(doc.data().currentStock || 0); });

        // 3. Process & Group by Category
        let itemsByCategory = {};
        snapBranch.forEach(docSnap => {
            let data = docSnap.data();
            let cat = data.category || "Uncategorized";
            if (!cat.toLowerCase().includes("prepared batch") && !cat.toLowerCase().includes("prep batch")) {
                if (!itemsByCategory[cat]) itemsByCategory[cat] = [];
                itemsByCategory[cat].push({ id: docSnap.id, ...data });
            }
        });

        window.stockReqItemsFlat = [];
        let html = '';

        Object.keys(itemsByCategory).sort().forEach(category => {
            // Category Header
            html += `<div class="stock-req-category" style="background: #e2e8f0; padding: 10px 15px; font-weight: bold; color: #334155; margin-top: 10px; font-size: 14px; text-transform: uppercase; border-radius: 6px;">📁 ${category}</div>`;

            let items = itemsByCategory[category];
            items.sort((a, b) => a.name.localeCompare(b.name));

            items.forEach((item) => {
                window.stockReqItemsFlat.push(item);
                let safeStock = parseFloat(item.currentStock || 0).toFixed(2);
                
                // HQ Availability Badge
                let hqStock = hqStockMap[item.name] || 0;
                let hqStatus = hqStock > 0
                    ? `<span style="color: #16a34a; font-weight: bold; font-size: 10px; background: #dcfce7; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;">🟢 HQ HAS STOCK</span>`
                    : `<span style="color: #dc2626; font-weight: bold; font-size: 10px; background: #fee2e2; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;">🔴 HQ OUT OF STOCK</span>`;

                html += `
                <div class="stock-req-row" data-name="${item.name.toLowerCase()}" style="display: grid; grid-template-columns: 2fr 1fr 1.5fr 1fr; gap: 10px; align-items: center; padding: 12px 10px; border-bottom: 1px solid #f1f5f9;">
                    <div style="font-weight: bold; color: #334155; font-size: 14px;">
                        ${item.name} <br>
                        ${hqStatus}
                    </div>
                    <div style="text-align: center; font-family: monospace; font-size: 13px; color: #64748b; display: flex; flex-direction: column;">
                        <strong style="font-size: 14px; color: #334155;">${safeStock}</strong>
                        <span style="font-size: 10px; color: #94a3b8;">${item.uom || 'units'}</span>
                    </div>
                    <div>
                        <select id="reqType_${item.id}" class="input-box req-type-select" data-id="${item.id}" style="border-color: #cbd5e1; font-weight: bold; color: #475569; padding: 8px; font-size: 12px; cursor: pointer; width: 100%; outline: none;" onchange="window.toggleActualCount('${item.id}')">
                            <option value="None">--- Normal ---</option>
                            <option value="Low Stock">⚠️ Low Stock</option>
                            <option value="Out of Stock">❌ Out of Stock</option>
                        </select>
                    </div>
                    <div>
                        <input type="number" id="actualCount_${item.id}" placeholder="Count?" class="input-box" style="text-align: center; border-color: #fcd34d; background: #fffbeb; font-weight: bold; color: #d97706; padding: 8px; font-size: 13px; display: none; width: 100%; box-sizing: border-box;">
                    </div>
                </div>`;
            });
        });

        container.innerHTML = html;
    } catch (e) {
        console.error(e); container.innerHTML = '<div style="text-align:center; padding:20px; color:red;">Failed to load inventory.</div>';
    }
};

window.filterStockReq = function() {
    let input = document.getElementById('stockReqSearch').value.toLowerCase();
    let rows = document.querySelectorAll('.stock-req-row');
    let categories = document.querySelectorAll('.stock-req-category');

    rows.forEach(row => {
        if (row.getAttribute('data-name').includes(input)) {
            row.style.display = 'grid';
            row.classList.add('visible-row');
        } else {
            row.style.display = 'none';
            row.classList.remove('visible-row');
        }
    });

    categories.forEach(cat => {
        let nextEl = cat.nextElementSibling;
        let hasVisible = false;
        while(nextEl && nextEl.classList.contains('stock-req-row')) {
            if (nextEl.classList.contains('visible-row')) { hasVisible = true; break; }
            nextEl = nextEl.nextElementSibling;
        }
        cat.style.display = hasVisible || input === '' ? 'block' : 'none';
    });
};

window.openShiftModal = function() {
    if (!systemReady) return;
    
    if (!currentShift) {
        document.getElementById('shiftViewOpen').style.display = "block";
        document.getElementById('shiftViewClose').style.display = "none";
        
        let nameEl = document.getElementById('inputShiftCashier'); 
        if (nameEl) nameEl.value = ""; 
        
        let inputStart = document.getElementById('inputStartingCash');
        inputStart.placeholder = "Enter physical cash count...";
        inputStart.value = ""; // 🔥 BLIND COUNT: Never auto-fill this box!

        // 🔥 THE BEHAVIORAL WARNING: Check the last shift's variance!
        const q = query(collection(db, "shifts"), where("branch", "==", sessionUser.branch), where("status", "==", "Closed"), orderBy("endTime", "desc"), limit(1));
        getDocs(q).then(snap => {
            let noteEl = document.getElementById('lastShiftNote');
            if(!noteEl) {
                noteEl = document.createElement('div');
                noteEl.id = 'lastShiftNote';
                noteEl.style.cssText = "font-size: 13px; font-weight: bold; margin-top: 15px; padding: 12px; border-radius: 6px; text-align: center; line-height: 1.4;";
                inputStart.parentNode.appendChild(noteEl);
            }

            if(!snap.empty) {
                let lastShift = snap.docs[0].data();
                
                // Grab the math from the previous shift to see if it was short/over
                let expected = parseFloat(lastShift.expectedCash) || 0;
                let declared = parseFloat(lastShift.declaredCash) || parseFloat(lastShift.actualCash) || 0;
                let diff = declared - expected;

                // Save to memory for the interceptor, but keep it hidden from UI!
                window.lastEndingCash = declared; 

                // 🔥 THE FIX: Keep it BLIND! Never auto-fill the amount!
                inputStart.value = ""; 

                // We allow a tiny 5 centavo tolerance for floating point math
                if (Math.abs(diff) <= 0.05) {
                    noteEl.innerHTML = `✅ The previous shift closed with a <b>Perfect Count</b>.`;
                    noteEl.style.background = "#dcfce7"; noteEl.style.color = "#16a34a"; noteEl.style.border = "1px solid #bbf7d0";
                } else if (diff > 0.05) {
                    noteEl.innerHTML = `⚠️ The previous shift closed with a <b>CASH OVERAGE</b>.<br><span style="font-size:11px; font-weight:normal; color:#b45309;">Please double-count the drawer carefully.</span>`;
                    noteEl.style.background = "#fffbeb"; noteEl.style.color = "#d97706"; noteEl.style.border = "1px solid #fde68a";
                } else {
                    noteEl.innerHTML = `🚨 The previous shift closed with a <b>CASH SHORTAGE</b>.<br><span style="font-size:11px; font-weight:normal; color:#b91c1c;">Please double-count the drawer carefully.</span>`;
                    noteEl.style.background = "#fef2f2"; noteEl.style.color = "#dc2626"; noteEl.style.border = "1px solid #fecaca";
                }
                noteEl.style.display = "block";
            } else {
                window.lastEndingCash = 0;
                inputStart.value = "";
                noteEl.style.display = "none";
            }
        });

        document.getElementById('shiftModal').style.display = "flex";
    } else {
        let btn = document.getElementById('btnTopShift'); let oldText = btn.innerText; btn.innerText = "⏳ Data..."; btn.disabled = true;
        window.getLiveShiftDetails(sessionUser.branch).then(details => {
            if (!details) return; activeShiftDetails = details;
            document.getElementById('shiftViewOpen').style.display = "none"; document.getElementById('shiftViewClose').style.display = "block";
            document.getElementById('shiftActiveDetails').innerText = `Started By: ${details.startedBy}  |  Start Time: ${new Date(details.startTime).toLocaleString()}`;
            document.getElementById('scStartingCash').innerText = '₱' + details.startingCash.toFixed(2);
            document.getElementById('scCashOut').innerText = '- ₱' + details.cashOut.toFixed(2);
            document.getElementById('shiftModal').style.display = "flex"; btn.innerText = oldText; btn.disabled = false;
        });
    }
};

window.submitOpenShift = async function() {
    try {
        let shiftName = sessionUser.cashierName || localStorage.getItem('cashierName') || 'Unknown';
        let startEl = document.getElementById('inputStartingCash');
        let startCash = (startEl && parseFloat(startEl.value)) ? parseFloat(startEl.value) : 0;
        let lastEndingCash = window.lastEndingCash || 0;

        // 🔥 THE INTERCEPTOR: If they type less cash than the previous shift left!
        if (startCash !== lastEndingCash && lastEndingCash > 0) {
            let diff = lastEndingCash - startCash;
            if (diff > 0) {
                let result = await Swal.fire({
                    title: '⚠️ Missing Cash Detected!',
                    html: `The previous shift left <b>₱${lastEndingCash.toFixed(2)}</b> in the drawer.<br>You are trying to start with only <b>₱${startCash.toFixed(2)}</b>.<br><br><span style="color:#ef4444; font-weight:bold; font-size: 16px;">Where did the ₱${diff.toFixed(2)} go?</span>`,
                    icon: 'warning',
                    showDenyButton: true,
                    showCancelButton: true,
                    confirmButtonText: 'Owner/Manager Took It',
                    denyButtonText: 'I Don\'t Know (Shortage)',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#10b981',
                    denyButtonColor: '#ef4444',
                    customClass: { popup: 'rounded-2xl' }
                });

                if (result.isConfirmed) {
                    // Auto-log it as a Remittance so it fixes the accounting!
                    await addDoc(collection(db, "remittances"), {
                        branch: sessionUser.branch,
                        cashierName: "Auto-Logged (Shift Start)",
                        amount: diff,
                        type: "Cash Collection",
                        channel: "Owner Collection",
                        timestamp: serverTimestamp(),
                        dateStr: new Date().toLocaleDateString('en-CA')
                    });
                    Swal.fire('Logged!', `₱${diff} was auto-logged as an Owner Collection.`, 'success');
                } else if (result.isDenied) {
                    // Log it as an unexplained missing expense
                    await addDoc(collection(db, "expenses"), {
                        branch: sessionUser.branch,
                        amount: diff,
                        category: "Unexplained Shortage",
                        description: `Missing cash between shifts (Expected: ₱${lastEndingCash}, Started With: ₱${startCash})`,
                        loggedBy: shiftName,
                        timestamp: serverTimestamp()
                    });
                    Swal.fire('Logged', `₱${diff} was recorded as an unexplained shortage.`, 'info');
                } else {
                    return; // User clicked Cancel
                }
            }
        }

        let btn = document.getElementById('btnOpenShiftSubmit');
        if (btn) { btn.innerText = "Opening..."; btn.disabled = true; }

        let shiftId = await window.openNewShift(sessionUser.branch, shiftName, startCash);
        if (shiftId) {
            await window.checkCurrentShift();
            closeModal('shiftModal');
        } else {
            alert("Failed to open shift. Check connection!");
        }
        if (btn) { btn.innerText = "Open Shift"; btn.disabled = false; }
    } catch (e) { console.error(e); }
};

// ========================================================
// 📊 Z-READING PRE-FLIGHT CHECK ENGINE (BLIND COUNT SECURED)
// ========================================================

window.safeSubmitComprehensiveCloseShift = async function() {
    let parked = await window.getParkedOrders(sessionUser.branch);
    let confirmBtn = document.querySelector('#endShiftModal .btn-place');
    if (confirmBtn) { confirmBtn.innerText = "⏳ Verifying Count..."; confirmBtn.disabled = true; }
    if (parked && parked.length > 0) {
        Swal.fire('⚠️ Strict System Lock', `You have ${parked.length} parked order(s) still open. You must pay or cancel them before the system will accept this Z-Reading.`, 'warning');
        closeModal('endShiftModal');
        return;
    }

    let btn = document.querySelector('button[onclick="safeSubmitComprehensiveCloseShift()"]');
    let origText = btn ? btn.innerText : '🛑 Confirm & End Shift';
    if(btn) { btn.innerText = "Verifying Count..."; btn.disabled = true; }

    try {
        // 1. PULL DECLARED CASH DIRECTLY FROM THE GRAND TOTAL DISPLAY!
        let totalDeclaredStr = document.getElementById('grandTotalCash').innerText.replace(/[₱,]/g, '').trim();
        let totalDeclared = parseFloat(totalDeclaredStr) || 0;

        // 2. PULL EXPECTED CASH FROM THE OFFICIAL SHIFT MEMORY ENGINE!
        let expectedCash = 0;
        let details = await window.getLiveShiftDetails(sessionUser.branch);
        
        if (details) {
            // 🔥 THE FIX: We bypass manual math entirely and just grab the exact expectedCash calculated by the Master Shift Engine!
            expectedCash = parseFloat(details.expectedCash) || 0;
        }

        let variance = totalDeclared - expectedCash;

        // 3. 🚨 THE STRICT BLIND COUNT UI (No amounts revealed!)
        let title = "";
        let messageHtml = "";
        let icon = "warning";
        let confirmButtonColor = "";

        // We allow a tiny 5 centavo tolerance for JavaScript decimal math
        if (Math.abs(variance) <= 0.05) {
            title = 'Perfect Shift! 🎯';
            confirmButtonColor = '#10b981';
            icon = 'success';
            messageHtml = `<div style="color: #10b981; font-size: 16px; font-weight: bold; margin-bottom: 5px;">Your cash count matches the system perfectly!</div>`;
        } else if (variance > 0.05) {
            title = 'Cash Overage Detected 📈';
            confirmButtonColor = '#f59e0b'; // Warning Orange
            icon = 'warning';
            messageHtml = `
                <div style="color: #d97706; font-size: 16px; font-weight: bold; margin-bottom: 8px;">Your declared cash is MORE than expected.</div>
                <div style="font-size: 13px; color: #475569;">Do not remove any overage. Submit the full amount for HQ review.</div>
            `;
        } else {
            title = 'Cash Shortage Detected 📉';
            confirmButtonColor = '#ef4444'; // Danger Red
            icon = 'error';
            messageHtml = `
                <div style="color: #dc2626; font-size: 16px; font-weight: bold; margin-bottom: 8px;">Your declared cash is LESS than expected.</div>
                <div style="font-size: 13px; color: #475569;">Please double-check your drawer for dropped bills or missing receipts.</div>
            `;
        }

        let confirm = await Swal.fire({
            title: title,
            html: `
                <div style="text-align: center; background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    ${messageHtml}
                </div>
                <br><p style="font-size: 13px; color: #64748b; font-weight: bold; margin:0;">Do you want to permanently submit this Z-Reading?</p>
            `,
            icon: icon,
            showCancelButton: true,
            confirmButtonText: 'Yes, End Shift',
            cancelButtonText: 'No, Re-count Cash',
            confirmButtonColor: confirmButtonColor,
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-2xl shadow-xl' }
        });

        if (!confirm.isConfirmed) {
            if(btn) { btn.innerText = origText; btn.disabled = false; }
            return;
        }

        // 4. They confirmed! Proceed to the actual submit function!
        if (typeof window.submitComprehensiveCloseShift === 'function') {
            window.submitComprehensiveCloseShift(); 
        } else if (typeof submitComprehensiveCloseShift === 'function') {
            submitComprehensiveCloseShift();
        }

    } catch(e) {
        console.error("Z-Reading Error:", e);
        Swal.fire("Error", "Error calculating variance. Proceeding to force close.", "warning");
        if (typeof window.submitComprehensiveCloseShift === 'function') window.submitComprehensiveCloseShift();
    } finally {
        if(btn) { btn.innerText = origText; btn.disabled = false; }
        if(confirmBtn) { confirmBtn.innerText = "🛑 Confirm & End Shift"; confirmBtn.disabled = false; }
    }
};

// ========================================================
// 🛑 HR SANCTION LOCK SCREEN ENGINE (WITH SIGNATURE)
// ========================================================
window.hasSignedNTE = false;

window.initSignaturePad = function() {
    const canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let isDrawing = false;

    // Reset variables on load
    window.hasSignedNTE = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Style the pen
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';

    const startPosition = (e) => {
        isDrawing = true;
        window.hasSignedNTE = true; // Flips to true the moment they touch the pad!
        draw(e);
    };

    const stopPosition = () => {
        isDrawing = false;
        ctx.beginPath(); // Prevents lines from connecting weirdly
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault(); // CRITICAL: Stops the tablet screen from scrolling while drawing!

        let x, y;
        const rect = canvas.getBoundingClientRect();
        
        // Handle both Touch (Tablets) and Mouse (PC)
        if (e.type.includes('touch')) {
            x = e.touches[0].clientX - rect.left;
            y = e.touches[0].clientY - rect.top;
        } else {
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        }

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    // Remove old listeners to prevent duplicates
    canvas.replaceWith(canvas.cloneNode(true));
    const newCanvas = document.getElementById('signatureCanvas');

    // Mouse listeners
    newCanvas.addEventListener('mousedown', startPosition);
    newCanvas.addEventListener('mousemove', draw);
    newCanvas.addEventListener('mouseup', stopPosition);
    newCanvas.addEventListener('mouseout', stopPosition);

    // Touch listeners (for tablets/phones)
    newCanvas.addEventListener('touchstart', startPosition, { passive: false });
    newCanvas.addEventListener('touchmove', draw, { passive: false });
    newCanvas.addEventListener('touchend', stopPosition);
};

window.clearSignature = function() {
    const canvas = document.getElementById('signatureCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.hasSignedNTE = false;
    }
};

window.checkActiveSanctions = async function(staffName) {
    if (!staffName) return;
    
    try {
        const q = query(collection(db, "hr_sanctions"), where("staffName", "==", staffName), where("status", "==", "Pending Reply"));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            let sanction = snap.docs[0].data();
            let sanctionId = snap.docs[0].id;

            document.getElementById('activeSanctionId').value = sanctionId;
            document.getElementById('sanctionLockType').innerText = sanction.type || "Violation";
            document.getElementById('sanctionLockSeverity').innerText = sanction.severity || "Warning";
            document.getElementById('sanctionLockDetails').innerText = sanction.details || "No details provided.";
            document.getElementById('sanctionStaffReply').value = ""; 

            document.getElementById('hrSanctionModal').style.display = 'flex';
            
            // 🔥 WAKE UP THE SIGNATURE PAD!
            setTimeout(() => { window.initSignaturePad(); }, 300);
        }
    } catch (e) { console.error("Error checking sanctions:", e); }
};

window.submitSanctionReply = async function() {
    let sanctionId = document.getElementById('activeSanctionId').value;
    let replyText = document.getElementById('sanctionStaffReply').value.trim();

    if (!replyText || replyText.length < 15) {
        Swal.fire('Too Short', 'You must provide a detailed written explanation (at least 15 characters).', 'warning');
        return;
    }

    if (!window.hasSignedNTE) {
        Swal.fire('Signature Required', 'Please sign inside the signature box to legally acknowledge this notice.', 'error');
        return;
    }

    let btn = document.getElementById('btnSubmitSanctionReply');
    btn.innerText = "⏳ Submitting..."; btn.disabled = true;

    try {
        // 🔥 CAPTURE THE SIGNATURE AS AN IMAGE!
        const canvas = document.getElementById('signatureCanvas');
        const signatureDataUrl = canvas.toDataURL('image/png');

        await updateDoc(doc(db, "hr_sanctions", sanctionId), {
            staffReply: replyText,
            signatureBase64: signatureDataUrl, // Saves the drawing to the cloud!
            status: "Replied",
            repliedAt: serverTimestamp()
        });

        Swal.fire('✅ Submitted', 'Your explanation and signature have been securely logged. The POS is now unlocked.', 'success');
        document.getElementById('hrSanctionModal').style.display = 'none';

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to submit. Check internet connection.', 'error');
    } finally {
        btn.innerText = "Submit & Unlock"; btn.disabled = false;
    }
};

window.logoutCashier = function() {
    localStorage.removeItem('cashierName');
    localStorage.removeItem('cashierBranch');
    localStorage.removeItem('cashierPermissions');
    location.reload(); // Hard refresh to kick them out
};

// ========================================================
// 🛑 HR SANCTION LOCK SCREEN ENGINE (WITH SIGNATURE)
// ========================================================
window.hasSignedNTE = false;

window.initSignaturePad = function() {
    const canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let isDrawing = false;

    // Reset variables on load
    window.hasSignedNTE = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Style the pen
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';

    const startPosition = (e) => {
        isDrawing = true;
        window.hasSignedNTE = true; // Flips to true the moment they touch the pad!
        draw(e);
    };

    const stopPosition = () => {
        isDrawing = false;
        ctx.beginPath(); // Prevents lines from connecting weirdly
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault(); // CRITICAL: Stops the tablet screen from scrolling while drawing!

        let x, y;
        const rect = canvas.getBoundingClientRect();
        
        // Handle both Touch (Tablets) and Mouse (PC)
        if (e.type.includes('touch')) {
            x = e.touches[0].clientX - rect.left;
            y = e.touches[0].clientY - rect.top;
        } else {
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        }

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    };

    // Mouse listeners
    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopPosition);
    canvas.addEventListener('mouseout', stopPosition);

    // Touch listeners (for tablets/phones)
    canvas.addEventListener('touchstart', startPosition, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopPosition);
};

window.clearSignature = function() {
    const canvas = document.getElementById('signatureCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.hasSignedNTE = false;
    }
};

window.checkActiveSanctions = async function(staffName) {
    if (!staffName) return;
    
    try {
        const q = query(collection(db, "hr_sanctions"), where("staffName", "==", staffName), where("status", "==", "Pending Reply"));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            let sanction = snap.docs[0].data();
            let sanctionId = snap.docs[0].id;

            document.getElementById('activeSanctionId').value = sanctionId;
            document.getElementById('sanctionLockType').innerText = sanction.type || "Violation";
            document.getElementById('sanctionLockSeverity').innerText = sanction.severity || "Warning";
            document.getElementById('sanctionLockDetails').innerText = sanction.details || "No details provided.";
            document.getElementById('sanctionStaffReply').value = ""; 

            document.getElementById('hrSanctionModal').style.display = 'flex';
            
            // 🔥 WAKE UP THE SIGNATURE PAD!
            setTimeout(() => { window.initSignaturePad(); }, 300);
        }
    } catch (e) { console.error("Error checking sanctions:", e); }
};

window.submitSanctionReply = async function() {
    let sanctionId = document.getElementById('activeSanctionId').value;
    let replyText = document.getElementById('sanctionStaffReply').value.trim();

    if (!replyText || replyText.length < 15) {
        Swal.fire('Too Short', 'You must provide a detailed written explanation (at least 15 characters).', 'warning');
        return;
    }

    if (!window.hasSignedNTE) {
        Swal.fire('Signature Required', 'Please sign inside the signature box to legally acknowledge this notice.', 'error');
        return;
    }

    let btn = document.getElementById('btnSubmitSanctionReply');
    btn.innerText = "⏳ Submitting..."; btn.disabled = true;

    try {
        // 🔥 CAPTURE THE SIGNATURE AS AN IMAGE!
        const canvas = document.getElementById('signatureCanvas');
        const signatureDataUrl = canvas.toDataURL('image/png');

        await updateDoc(doc(db, "hr_sanctions", sanctionId), {
            staffReply: replyText,
            signatureBase64: signatureDataUrl, // Saves the drawing to the cloud!
            status: "Replied",
            repliedAt: serverTimestamp()
        });

        Swal.fire('✅ Submitted', 'Your explanation and signature have been securely logged. The POS is now unlocked.', 'success');
        document.getElementById('hrSanctionModal').style.display = 'none';

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to submit. Check internet connection.', 'error');
    } finally {
        btn.innerText = "Submit Explanation & Unlock"; btn.disabled = false;
    }
};

// ========================================================
// 📋 DAILY SOP CHECKLIST ENGINE (MULTI-STAFF & SCROLL FIX)
// ========================================================
window.cashierSopData = {}; 
window.currentSopTasks = []; 

window.loadSopView = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) { alert("Device branch not set!"); return; }

    document.getElementById('sopViewBranchText').innerText = `📍 ${branch}`;
    let select = document.getElementById('sopRoleSelect');
    
    // Don't re-download if we already have it in memory to keep it lightning fast
    if (Object.keys(window.cashierSopData).length === 0) {
        select.innerHTML = '<option value="">⏳ Downloading checklists...</option>';
        try {
            const docSnap = await getDoc(doc(db, "settings", "sop_" + branch));
            if (docSnap.exists() && docSnap.data().roles) {
                window.cashierSopData = docSnap.data().roles;
            } else {
                select.innerHTML = '<option value="">No checklists setup by Manager yet.</option>';
                return;
            }
        } catch (e) {
            console.error("SOP Fetch Error:", e);
            select.innerHTML = '<option value="">❌ Connection Error</option>';
            return;
        }
    }

    // Build the dropdown
    let html = '<option value="">-- Choose Your Shift / Role --</option>';
    Object.keys(window.cashierSopData).forEach(role => {
        html += `<option value="${role}">${role}</option>`;
    });
    select.innerHTML = html;
    
    // Clear the container on load so it's fresh
    document.getElementById('sopChecklistContainer').innerHTML = '<div style="text-align:center; padding: 60px; color:#94a3b8; font-weight: bold; font-size: 16px;">Select your role above to view your tasks.</div>';
};

window.handleSopRoleChange = function() {
    let role = document.getElementById('sopRoleSelect').value;
    let container = document.getElementById('sopChecklistContainer');

    if (!role) {
        container.innerHTML = '<div style="text-align:center; padding: 60px; color:#94a3b8; font-weight: bold; font-size: 16px;">Select your role above to view your tasks.</div>';
        window.currentSopTasks = [];
        return;
    }

    // 🔥 THE SCROLL FIX: Forces the tablet to contain the list and create a scrollbar!
    container.style.maxHeight = "55vh"; 
    container.style.overflowY = "auto";
    container.style.paddingRight = "10px";
    container.style.paddingBottom = "20px";

    // 🔥 THE MULTI-STAFF MEMORY FIX: Create a unique save file for THIS role TODAY!
    let today = new Date().toISOString().split('T')[0];
    let branch = localStorage.getItem('takodeal_device_branch');
    let memoryKey = `takodeal_sop_${branch}_${today}_${role}`;

    let savedProgress = localStorage.getItem(memoryKey);

    if (savedProgress) {
        try {
            // Load their specific saved progress
            window.currentSopTasks = JSON.parse(savedProgress);
        } catch(e) {
            // Failsafe
            let tasks = window.cashierSopData[role] || [];
            window.currentSopTasks = tasks.map(t => ({ task: t, status: null, remark: "" }));
        }
    } else {
        // Initialize fresh blank tasks for this specific role
        let tasks = window.cashierSopData[role] || [];
        window.currentSopTasks = tasks.map(t => ({ task: t, status: null, remark: "" }));
    }
    
    window.renderSopChecklist();
};

window.renderSopChecklist = function() {
    let role = document.getElementById('sopRoleSelect').value;
    let container = document.getElementById('sopChecklistContainer');
    
    if (!role || window.currentSopTasks.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 60px; color:#94a3b8; font-weight: bold; font-size: 16px;">Select your role above to view your tasks.</div>';
        return;
    }

    let html = '';
    window.currentSopTasks.forEach((item, index) => {
        let isDone = item.status === 'done';
        let isFail = item.status === 'fail';
        
        let btnDoneStyle = isDone ? "background: #dcfce7; border-color: #16a34a; color: #15803d;" : "background: white; border-color: #cbd5e1; color: #64748b;";
        let btnFailStyle = isFail ? "background: #fee2e2; border-color: #dc2626; color: #b91c1c;" : "background: white; border-color: #cbd5e1; color: #64748b;";
        let remarkDisplay = isFail ? "block" : "none";

        // Protect text so apostrophes don't break the input box!
        let safeRemark = item.remark ? item.remark.replace(/"/g, '&quot;') : '';

        html += `
            <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                <div style="font-size: 16px; font-weight: bold; color: #1e293b; margin-bottom: 12px; line-height: 1.4;">${index + 1}. ${item.task}</div>
                
                <div style="display: flex; gap: 10px;">
                    <button id="btn_sop_done_${index}" onclick="window.markSopTask(${index}, 'done')" style="flex: 1; padding: 12px; border-radius: 6px; border: 2px solid #cbd5e1; font-weight: bold; cursor: pointer; transition: 0.2s; ${btnDoneStyle}">✅ Done</button>
                    <button id="btn_sop_fail_${index}" onclick="window.markSopTask(${index}, 'fail')" style="flex: 1; padding: 12px; border-radius: 6px; border: 2px solid #cbd5e1; font-weight: bold; cursor: pointer; transition: 0.2s; ${btnFailStyle}">❌ Missed</button>
                </div>

                <div id="sop_remark_container_${index}" style="display: ${remarkDisplay}; margin-top: 12px;">
                    <input type="text" id="sop_remark_${index}" placeholder="Why was this missed? (Required)" value="${safeRemark}" onkeyup="window.currentSopTasks[${index}].remark = this.value; window.saveSopProgress();" style="width: 100%; padding: 12px; border: 1px solid #fca5a5; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-weight: bold; font-size: 14px; outline: none; box-sizing: border-box;">
                </div>
            </div>
        `;
    });

    // 🔥 THE SUBMIT FIX: We inject the Submit button safely INSIDE the scrollable list at the very bottom!
    html += `
        <div style="margin-top: 20px; padding-top: 15px; border-top: 2px dashed #cbd5e1; padding-bottom: 30px;">
            <button id="btnSubmitSopInside" onclick="window.submitSopChecklist()" style="width: 100%; padding: 15px; background: #0f766e; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 6px rgba(15, 118, 110, 0.3);">🚀 Submit ${role} Checklist</button>
        </div>
    `;

    container.innerHTML = html;
};

// Extremely tactile feedback
window.markSopTask = function(index, status) {
    window.currentSopTasks[index].status = status;
    
    let btnDone = document.getElementById(`btn_sop_done_${index}`);
    let btnFail = document.getElementById(`btn_sop_fail_${index}`);
    let remarkBox = document.getElementById(`sop_remark_container_${index}`);

    if (status === 'done') {
        btnDone.style.background = '#dcfce7'; btnDone.style.borderColor = '#16a34a'; btnDone.style.color = '#15803d';
        btnFail.style.background = 'white'; btnFail.style.borderColor = '#cbd5e1'; btnFail.style.color = '#64748b';
        remarkBox.style.display = 'none';
        window.currentSopTasks[index].remark = ""; 
        let remarkInp = document.getElementById(`sop_remark_${index}`);
        if(remarkInp) remarkInp.value = "";
    } else {
        btnFail.style.background = '#fee2e2'; btnFail.style.borderColor = '#dc2626'; btnFail.style.color = '#b91c1c';
        btnDone.style.background = 'white'; btnDone.style.borderColor = '#cbd5e1'; btnDone.style.color = '#64748b';
        remarkBox.style.display = 'block';
    }
    
    window.saveSopProgress(); // Instantly save to hard drive!
};

// 🔥 The Auto-Saver (Now uses independent role memory)
window.saveSopProgress = function() {
    let role = document.getElementById('sopRoleSelect').value;
    if (!role || window.currentSopTasks.length === 0) return;
    
    let today = new Date().toISOString().split('T')[0];
    let branch = localStorage.getItem('takodeal_device_branch');
    let memoryKey = `takodeal_sop_${branch}_${today}_${role}`;
    
    localStorage.setItem(memoryKey, JSON.stringify(window.currentSopTasks));
};

window.submitSopChecklist = async function() {
    let role = document.getElementById('sopRoleSelect').value;
    if (!role || window.currentSopTasks.length === 0) return Swal.fire('Error', 'Please select a role first.', 'error');

    let branch = localStorage.getItem('takodeal_device_branch');
    let cashierName = localStorage.getItem('cashierName') || "Unknown Cashier";

    // 🛑 VALIDATION: Ensure every task is marked, and every 'fail' has a reason!
    let totalTasks = window.currentSopTasks.length;
    let completedTasks = 0;

    for (let i = 0; i < totalTasks; i++) {
        let t = window.currentSopTasks[i];
        if (t.status === null) {
            return Swal.fire('Incomplete', `You forgot to mark Task #${i + 1} as Done or Missed!`, 'warning');
        }
        if (t.status === 'fail' && t.remark.trim() === '') {
            return Swal.fire('Reason Required', `You marked Task #${i + 1} as Missed. You must type a reason why!`, 'error');
        }
        if (t.status === 'done') completedTasks++;
    }

    let btn = document.getElementById('btnSubmitSopInside');
    if (btn) { btn.innerText = "⏳ Submitting..."; btn.disabled = true; }

    try {
        let score = Math.round((completedTasks / totalTasks) * 100);

        await addDoc(collection(db, "sop_logs"), {
            branch: branch,
            staffName: cashierName,
            roleName: role,
            tasks: window.currentSopTasks,
            scorePercentage: score,
            timestamp: serverTimestamp()
        });

        Swal.fire({
            title: '✅ Submitted!',
            text: `SOP Checklist submitted securely to management. Score: ${score}%`,
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
        
        // 🔥 WIPE ONLY THIS ROLE'S MEMORY SO THEY CAN DO IT FRESH TOMORROW!
        let today = new Date().toISOString().split('T')[0];
        let memoryKey = `takodeal_sop_${branch}_${today}_${role}`;
        localStorage.removeItem(memoryKey);
        
        document.getElementById('sopRoleSelect').value = "";
        document.getElementById('sopChecklistContainer').innerHTML = '<div style="text-align:center; padding: 40px; color:#16a34a; font-weight: bold; font-size: 16px;">✅ Checklist Successfully Submitted. Thank you!</div>';
        window.currentSopTasks = [];

    } catch (e) {
        console.error("SOP Submit Error:", e);
        Swal.fire('Error', 'Failed to submit checklist. Check connection.', 'error');
    } finally {
        if (btn) { btn.innerText = `🚀 Submit ${role} Checklist`; btn.disabled = false; }
    }
};
// ========================================================
// 💵 PHYSICAL HARDWARE CASH DRAWER KICK ENGINE
// ========================================================
window.kickCashDrawer = function() {
    // Standard ESC/POS sequence to trigger cash drawer kick on pin 2
    let drawerPulseCommand = "\x1B\x40\x1B\x70\x00\x19\x96";
    
    try {
        let base64Command = btoa(unescape(encodeURIComponent(drawerPulseCommand)));
        window.location.href = "intent:base64," + base64Command + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
        console.log("⚡ Hardware electrical pulse sent to cash drawer.");
    } catch(e) {
        console.error("Hardware control error:", e);
    }
};

// ========================================================
// 📱 SIDEBAR AUTO-ARRANGEMENT ENGINE (SYNC)
// ========================================================
window.applySidebarLayout = async function() {
    try {
        const docSnap = await getDoc(doc(db, "settings", "sidebar_layout"));
        if (docSnap.exists() && docSnap.data().tabs) {
            let layout = docSnap.data().tabs;
            let navMenu = document.querySelector('.nav-menu');
            if (!navMenu) return;
            
            // Reorder the DOM elements! 
            // By appending them, they automatically move to the bottom in order.
            layout.forEach(tabData => {
                let id = tabData.id;
                let el = document.getElementById(id);
                if (el) navMenu.appendChild(el); 
            });
        }
    } catch (e) {
        console.error("Failed to load sidebar layout from Cloud.", e);
    }
};

// ========================================================
// 📦 SMART BRANCH STOCK REQUEST ENGINE (WITH HISTORY)
// ========================================================
window.switchStockReqTab = function(tab) {
    document.getElementById('stockReqTabNew').style.display = tab === 'New' ? 'block' : 'none';
    document.getElementById('stockReqTabHistory').style.display = tab === 'History' ? 'block' : 'none';
    
    document.getElementById('btnTabReqNew').style.background = tab === 'New' ? '#0ea5e9' : 'white';
    document.getElementById('btnTabReqNew').style.color = tab === 'New' ? 'white' : '#475569';
    document.getElementById('btnTabReqNew').style.border = tab === 'New' ? 'none' : '1px solid #cbd5e1';

    document.getElementById('btnTabReqHist').style.background = tab === 'History' ? '#0ea5e9' : 'white';
    document.getElementById('btnTabReqHist').style.color = tab === 'History' ? 'white' : '#475569';
    document.getElementById('btnTabReqHist').style.border = tab === 'History' ? 'none' : '1px solid #cbd5e1';

    if (tab === 'History') window.loadStockRequestHistory();
};

window.globalHqStockCache = [];

window.loadStockRequestUI = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) return;

    const listDiv = document.getElementById('stockReqList');
    if (!listDiv) return;
    listDiv.innerHTML = '<div style="text-align:center; padding: 20px; color: #94a3b8;">Loading inventory data...</div>';

    try {
        // 1. Fetch HQ Stock
        const hqQ = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
        const hqSnap = await getDocs(hqQ);
        window.globalHqStockCache = [];
        hqSnap.forEach(doc => {
            let data = doc.data();
            // 🔥 THE FIX: Respect the allowRequest toggle set by the Manager!
            if (data.allowRequest !== false) {
                window.globalHqStockCache.push({ id: doc.id, ...data });
            }
        });

        window.globalHqStockCache.sort((a,b) => a.name.localeCompare(b.name));

        // 2. Fetch Local Branch Stock for comparison
        const brQ = query(collection(db, "inventory"), where("branch", "==", branch));
        const brSnap = await getDocs(brQ);
        let branchStockDict = {};
        brSnap.forEach(doc => {
            let d = doc.data();
            branchStockDict[d.name] = d.currentStock || 0;
        });

        window.renderStockReqList(branchStockDict);

    } catch (e) {
        console.error("Request Stock Error:", e);
        listDiv.innerHTML = '<div style="text-align:center; padding: 20px; color: red;">Failed to load data.</div>';
    }
};

window.renderStockReqList = function(branchStockDict) {
    let html = '';
    window.globalHqStockCache.forEach((item, idx) => {
        let hqStock = parseFloat(item.currentStock) || 0;
        let localStock = branchStockDict[item.name] !== undefined ? branchStockDict[item.name] : 0;
        let hqStatus = hqStock > 0 ? `<span style="color: #16a34a;">HQ Has Stock</span>` : `<span style="color: #dc2626;">HQ Out of Stock</span>`;

        // 🔥 THE UOM FIX: Build the Dropdown for Pack vs Pieces!
        let pUom = item.purchaseUom || item.uom || 'units';
        let bUom = item.uom || 'units';
        let conv = parseFloat(item.conversionRate) || parseFloat(item.conversion) || 1;

        let uomOptions = '';
        if (pUom.toLowerCase() !== bUom.toLowerCase() && conv > 1) {
            uomOptions += `<option value="purch" data-conv="${conv}">${pUom}</option>`;
        }
        uomOptions += `<option value="base" data-conv="1">${bUom}</option>`;

        html += `
            <div class="stock-req-row" data-name="${item.name.toLowerCase()}" style="display: grid; grid-template-columns: 2fr 1fr 1.5fr 1fr; gap: 10px; padding: 12px 10px; border-bottom: 1px solid #f1f5f9; align-items: center;">
                <div>
                    <strong style="color: #1e293b; font-size: 14px;">${item.name}</strong><br>
                    <span style="font-size: 11px;">${hqStatus}</span>
                </div>
                <div style="text-align: center; font-weight: bold; color: #64748b;">
                    ${parseFloat(localStock).toFixed(1)} <span style="font-size:10px;">${item.uom}</span>
                </div>
                <div style="text-align: center;">
                    <select id="reqType_${item.id}" class="input-box req-type-select" data-id="${item.id}" data-sys="${localStock}" style="border-color: #cbd5e1; font-weight: bold; color: #475569; padding: 8px; font-size: 12px; cursor: pointer; width: 100%; outline: none;" onchange="window.toggleActualCount('${item.id}')">
                        <option value="None">-- No Request --</option>
                        <option value="Low Stock">⚠️ Low Stock</option>
                        <option value="Out of Stock">❌ Out of Stock</option>
                        <option value="Stock Request">General Request</option>
                    </select>
                </div>
                <div style="text-align: center;">
                    <div id="actualCountContainer_${item.id}" style="display: none; align-items: center; gap: 5px;">
                        <input type="number" id="actualCount_${item.id}" placeholder="0" class="input-box" style="flex: 1; text-align: center; border-color: #fcd34d; background: #fffbeb; font-weight: bold; color: #d97706; padding: 8px; font-size: 13px; width: 100%; box-sizing: border-box; outline: none;">
                        <select id="actualUom_${item.id}" style="padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; background: white; color: #64748b; font-weight: bold; outline: none; cursor: pointer;">
                            ${uomOptions}
                        </select>
                    </div>
                </div>
            </div>
        `;
    });
    document.getElementById('stockReqList').innerHTML = html;
};

window.toggleActualCount = function(id) {
    let select = document.getElementById(`reqType_${id}`);
    let container = document.getElementById(`actualCountContainer_${id}`);
    let actualInput = document.getElementById(`actualCount_${id}`);
    
    if (select.value === "Low Stock") {
        if (container) container.style.display = "flex";
        actualInput.value = "";
        actualInput.readOnly = false;
        actualInput.style.background = "#fffbeb";
        actualInput.style.borderColor = "#fcd34d";
        actualInput.style.color = "#d97706";
    } else if (select.value === "Out of Stock") {
        if (container) container.style.display = "flex";
        actualInput.value = "0"; 
        actualInput.readOnly = true; 
        actualInput.style.background = "#fee2e2";
        actualInput.style.borderColor = "#f87171";
        actualInput.style.color = "#dc2626";
    } else {
        if (container) container.style.display = "none";
        actualInput.value = "";
    }
};

window.submitStockRequest = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    let cashier = localStorage.getItem('cashierName') || 'Staff';
    let itemsToRequest = [];
    let fraudAlerts = []; 

    let selects = document.querySelectorAll('.req-type-select');

    selects.forEach(select => {
        if (select.value !== "None") {
            let id = select.getAttribute('data-id');
            let itemData = window.globalHqStockCache.find(i => i.id === id);
            if (!itemData) return; 

            let actualCountEl = document.getElementById(`actualCount_${id}`);
            let uomSelectEl = document.getElementById(`actualUom_${id}`);
            
            let rawCount = actualCountEl && actualCountEl.value !== "" ? parseFloat(actualCountEl.value) : 0;
            let convRate = 1;
            let displayUom = itemData.uom;

            // 🔥 Convert Pack input to Pieces logic!
            if (uomSelectEl && uomSelectEl.tagName === 'SELECT') {
                let selOpt = uomSelectEl.options[uomSelectEl.selectedIndex];
                convRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
                displayUom = selOpt.text;
            }

            let actualCount = rawCount * convRate; 
            let sysStock = parseFloat(select.getAttribute('data-sys')) || 0;

            if (select.value === "Low Stock" || select.value === "Out of Stock") {
                if (actualCount < (sysStock - 1)) {
                    fraudAlerts.push({
                        name: itemData.name,
                        declared: rawCount, 
                        expected: sysStock,
                        uom: displayUom
                    });
                }
            }

            itemsToRequest.push({
                itemName: itemData.name,
                qty: 0, 
                requestType: select.value, 
                uom: itemData.uom,
                sourceId: itemData.id,
                systemStock: sysStock, 
                physicalStock: actualCount, // The true converted base quantity
                displayQty: rawCount,       // The exact number they typed
                displayUom: displayUom,     // E.g. "Pack"
                category: itemData.category || "Ingredients",
                purchaseUom: itemData.purchaseUom || itemData.uom,
                convRate: itemData.conversionRate || 1
            });
        }
    });

    if (itemsToRequest.length === 0) {
        return Swal.fire('Empty Request', 'Please mark at least one item as Low Stock or Out of Stock.', 'warning');
    }

    let btn = document.querySelector('button[onclick="window.submitStockRequest()"]');
    let origText = btn.innerText;
    btn.innerText = "⏳ Sending..."; btn.disabled = true;

    try {
        await addDoc(collection(db, "purchase_orders"), {
            branch: branch,
            type: "Internal Request",
            items: itemsToRequest,
            status: "Pending",
            requestedBy: cashier,
            timestamp: serverTimestamp()
        });

        for (let alert of fraudAlerts) {
            await addDoc(collection(db, "manager_alerts"), {
                type: "STOCK_REQUEST_FRAUD",
                branch: branch,
                cashier: cashier,
                message: `🕵️‍♂️ FRAUD ALERT: ${cashier} requested ${alert.name}. They declared they have ${alert.declared} ${alert.uom}, but the system expects ${alert.expected.toFixed(1)} ${itemData.uom}. Possible missing stock!`,
                timestamp: serverTimestamp(),
                isRead: false
            });
        }

        Swal.fire('✅ Sent to HQ!', 'Your stock request has been submitted. Check the History tab to track it.', 'success');
        window.loadStockRequestUI(); 
        window.switchStockReqTab('History'); 
    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to send request.', 'error');
    } finally {
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    }
};

window.filterStockReq = function() {
    let search = document.getElementById('stockReqSearch').value.toLowerCase();
    document.querySelectorAll('.stock-req-row').forEach(row => {
        if (row.getAttribute('data-name').includes(search)) row.style.display = 'grid';
        else row.style.display = 'none';
    });
};

window.loadStockRequestHistory = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    const tbody = document.getElementById('stockReqHistoryBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Loading history...</td></tr>';

    try {
        const q = query(collection(db, "purchase_orders"), where("branch", "==", branch), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);

        let html = '';
        snap.forEach(doc => {
            let d = doc.data();
            let dateStr = d.timestamp ? d.timestamp.toDate().toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Unknown';
            
            // 🔥 THE FIX: Map the colors and statuses to match HQ!
            let statusBg = '#f1f5f9'; let statusColor = '#475569';
            if (d.status === 'Pending') { statusBg = '#fef3c7'; statusColor = '#d97706'; }
            else if (d.status === 'Drafting') { statusBg = '#bae6fd'; statusColor = '#0284c7'; d.status = 'Preparing (HQ)'; }
            else if (d.status === 'Approved' || d.status === 'In Transit') { statusBg = '#dcfce7'; statusColor = '#16a34a'; d.status = 'Dispatch on the way 🚚'; }
            else if (d.status === 'Completed') { statusBg = '#f1f5f9'; statusColor = '#64748b'; }
            else if (d.status === 'Partially Dispatched') { statusBg = '#e0e7ff'; statusColor = '#0284c7'; }
            else if (d.status === 'Delayed') { statusBg = '#fef2f2'; statusColor = '#dc2626'; d.status = 'Delayed (Out of Stock)'; }

            let itemsList = d.items.map(i => `<div style="font-size: 11px; margin-bottom: 2px;">• <strong style="color:#0f172a;">${i.itemName}</strong> <span style="color:#ef4444;">(${i.requestType})</span></div>`).join('');
            
            // Show the manager's message if they pushed items back!
            let msgHtml = d.managerMessage ? `<div style="margin-top: 5px; padding: 5px; background: white; border: 1px dashed #cbd5e1; font-size: 10px; color: #b91c1c; border-radius: 4px;"><b>HQ Note:</b> ${d.managerMessage}</div>` : '';

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; color: #64748b; font-size: 12px;">${dateStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #334155;">👤 ${d.requestedBy || 'Staff'}</td>
                    <td style="padding: 12px;">
                        <span style="background: ${statusBg}; color: ${statusColor}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; display: inline-block;">${d.status}</span>
                        ${msgHtml}
                    </td>
                    <td style="padding: 12px;">${itemsList}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding: 20px;">No requests found.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:red;">Error loading history.</td></tr>';
    }
};

// ========================================================
// 📦 STORE USE / CONSUMABLES CHECKOUT ENGINE (PATCHED)
// ========================================================
window.processStoreUse = async function() {
    if (typeof cart === 'undefined' || cart.length === 0) {
        Swal.fire('Empty Cart', 'Please add items to the cart first before logging as Store Use.', 'warning');
        return;
    }

    if (!confirm("Log these items as Store Use/Consumables? This will instantly deduct them from inventory with ₱0 Revenue.")) return;

    // 🔥 THE BUG FIX: Safely grab the button using a flexible selector so it never crashes!
    let btn = document.querySelector('button[onclick*="processStoreUse"]');
    let origText = btn ? btn.innerText : "Log as Store Use";
    if (btn) { btn.innerText = "⏳ Processing..."; btn.disabled = true; }

    try {
        let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let cashier = localStorage.getItem('cashierName') || 'Unknown';
        let totalCostHit = 0;
        let usedItems = [];
        
        cart.forEach(item => {
            totalCostHit += (item.variantPrice || item.basePrice || 0) * item.qty;
            usedItems.push({ name: item.name, qty: item.qty });
        });

        // 1. Send it through the master checkout engine as 0 Revenue so Inventory still deducts the recipes!
        let payload = {
            branch: branch, cashier: cashier,
            shiftId: (typeof currentShift !== 'undefined' && currentShift) ? currentShift.shiftId : "UNKNOWN",
            orderType: "Store Use", paymentMethod: "Store Use",
            subTotalBeforeDiscount: 0, globalDiscountType: 'none', globalDiscountValue: 0, globalDiscountAmount: 0,
            netTotal: 0, amountReceived: 0, cart: cart, status: "Store Use" 
        };

        // This triggers your main POS logic!
        let receiptId = await window.processCheckout(payload);

        // 2. Log to the dedicated Store Use Feed for the Manager App
        if (receiptId) {
            await addDoc(collection(db, "store_use_logs"), {
                branch: branch, loggedBy: cashier, items: usedItems, totalCost: totalCostHit, timestamp: serverTimestamp()
            });
        }

        // 3. Clean up the UI
        cart = []; 
        if (typeof renderCart === 'function') renderCart(); 
        if (typeof closeModal === 'function') closeModal('checkoutModal');
        let paymentModal = document.getElementById('paymentModal');
        if (paymentModal) paymentModal.style.display = 'none';

        Swal.fire({
            title: '✅ Logged!',
            text: 'Items marked for store use and inventory safely deducted.',
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });
        
    } catch(e) { 
        console.error("Store Use Error:", e); 
        Swal.fire('Error', 'Failed to log store use. ' + e.message, 'error'); 
    } finally { 
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    }
};

// ========================================================
// 🔪 KITCHEN PREP TAB & HISTORY ENGINE
// ========================================================
window.switchPrepTab = function(tab) {
    document.getElementById('prepTabNew').style.display = tab === 'New' ? 'block' : 'none';
    document.getElementById('prepTabHistory').style.display = tab === 'History' ? 'block' : 'none';
    
    document.getElementById('btnTabPrepNew').style.background = tab === 'New' ? '#8b5cf6' : 'white';
    document.getElementById('btnTabPrepNew').style.color = tab === 'New' ? 'white' : '#475569';
    document.getElementById('btnTabPrepNew').style.border = tab === 'New' ? 'none' : '1px solid #cbd5e1';

    document.getElementById('btnTabPrepHist').style.background = tab === 'History' ? '#8b5cf6' : 'white';
    document.getElementById('btnTabPrepHist').style.color = tab === 'History' ? 'white' : '#475569';
    document.getElementById('btnTabPrepHist').style.border = tab === 'History' ? 'none' : '1px solid #cbd5e1';

    if (tab === 'History') window.loadKitchenPrepHistory();
};

window.loadKitchenPrepHistory = async function() {
    const tbody = document.getElementById('kitchenPrepHistoryBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Loading prep history...</td></tr>';
    
    let branch = localStorage.getItem('takodeal_device_branch');
    let today = new Date();
    today.setHours(0,0,0,0);

    try {
        const q = query(collection(db, "stock_logs"), where("branch", "==", branch), where("timestamp", ">=", today));
        const snap = await getDocs(q);
        
        let logs = [];
        snap.forEach(doc => {
            let d = doc.data();
            // Look for any log marked as Prep or Batch!
            if (d.type && (d.type.toLowerCase().includes("prep") || d.type.toLowerCase().includes("batch"))) {
                logs.push({ id: doc.id, ...d });
            }
        });

        logs.sort((a,b) => b.timestamp - a.timestamp); // Newest first

        let html = '';
        logs.forEach(log => {
            let timeStr = log.timestamp ? log.timestamp.toDate().toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'}) : 'Unknown';
            // 🔥 THE UOM FIX: Shows Both Base and Purchase UOM beautifully
            let pUom = log.purchUom || 'Bulk';
            let pQty = log.purchQty ? log.purchQty : '-';
            let purchDisplay = log.purchQty ? `(${pQty} ${pUom}s)` : '';

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; color: #64748b; font-size: 12px;">${timeStr}</td>
                    <td style="padding: 12px; font-weight: bold; color: #1e293b;">${log.item}</td>
                    <td style="padding: 12px;">
                        <strong style="color: #10b981; font-size: 14px;">+${log.variance} ${log.uom}</strong><br>
                        <span style="color: #0ea5e9; font-size: 11px; font-weight: bold;">${purchDisplay}</span>
                    </td>
                    <td style="padding: 12px;">
                        <button onclick="window.undoKitchenPrep('${log.id}', '${log.item}', ${log.variance})" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 11px;">✖ Undo</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #94a3b8;">No prep batches logged today.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: red;">Error loading history.</td></tr>';
    }
};

window.undoKitchenPrep = async function(logId, itemName, varianceAmount) {
    if(!confirm(`⚠️ Are you sure you want to UNDO the prep batch for ${itemName}?\n\nThis will instantly subtract ${varianceAmount} from the inventory.`)) return;
    
    try {
        let branch = localStorage.getItem('takodeal_device_branch');
        const q = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", itemName));
        const snap = await getDocs(q);
        
        if(!snap.empty) {
            let itemRef = snap.docs[0].ref;
            let currentStock = parseFloat(snap.docs[0].data().currentStock) || 0;
            await updateDoc(itemRef, { currentStock: currentStock - varianceAmount });
        }

        await deleteDoc(doc(db, "stock_logs", logId)); // Delete the log
        alert("✅ Prep batch successfully undone!");
        window.loadKitchenPrepHistory(); // Refresh table
    } catch(e) {
        console.error(e);
        alert("Failed to undo prep batch.");
    }
};

// ========================================================
// 📦 STORE USE / CONSUMABLES CHECKOUT ENGINE
// ========================================================
window.processStoreUse = async function() {
    if (typeof cart === 'undefined' || cart.length === 0) {
        Swal.fire('Empty Cart', 'Please select the consumable items first.', 'warning');
        return;
    }

    if (!confirm("Log these items as Store Use/Consumables? This will instantly deduct them from inventory with ₱0 Revenue.")) return;

    let btn = document.querySelector('button[onclick="window.processStoreUse()"]');
    let origText = btn.innerText;
    btn.innerText = "⏳ Processing..."; btn.disabled = true;

    try {
        let branch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let cashier = localStorage.getItem('cashierName') || 'Unknown';
        let totalCostHit = 0;
        let usedItems = [];
        
        cart.forEach(item => {
            totalCostHit += (item.variantPrice || item.basePrice || 0) * item.qty;
            usedItems.push({ name: item.name, qty: item.qty });
        });

        let payload = {
            branch: branch, cashier: cashier,
            shiftId: (typeof currentShift !== 'undefined' && currentShift) ? currentShift.shiftId : "UNKNOWN",
            orderType: "Store Use", paymentMethod: "Store Use",
            subTotalBeforeDiscount: 0, globalDiscountType: 'none', globalDiscountValue: 0, globalDiscountAmount: 0,
            netTotal: 0, amountReceived: "0", cart: cart, status: "Store Use" 
        };

        let receiptId = await window.processCheckout(payload);

        if (receiptId) {
            await window.addDoc(window.collection(window.db, "store_use_logs"), {
                branch: branch, loggedBy: cashier, items: usedItems, totalCost: totalCostHit, timestamp: window.serverTimestamp()
            });
        }

        cart = []; if (typeof renderCart === 'function') renderCart(); 
        if (typeof closeModal === 'function') closeModal('checkoutModal');
        Swal.fire('✅ Logged!', 'Items marked for store use and inventory safely deducted.', 'success');
        
    } catch(e) { 
        console.error(e); Swal.fire('Error', 'Failed to log store use.', 'error'); 
    } finally { 
        btn.innerText = origText; btn.disabled = false; 
    }
};

// ========================================================
// 🛑 THE MASTER SHIFT CLOSING ENGINE (CRASH-PROOF & BLIND)
// ========================================================
window.MASTER_CloseShift = async function () {
    let confirmBtn = document.querySelector('button[onclick*="MASTER_CloseShift"]');
    let origText = confirmBtn ? confirmBtn.innerText : 'Confirm & End Shift';

    if (confirmBtn) {
        confirmBtn.innerHTML = "⏳ Processing Shift...";
        confirmBtn.disabled = true;
    }

    try {
        // 1. Read Cash Drawer Securely
        let declaredCash = 0;
        let cashBreakdown = {};
        document.querySelectorAll('.denom-input').forEach(input => {
            let val = parseInt(input.getAttribute('data-val'));
            let pcs = parseInt(input.value) || 0;
            if (pcs > 0) {
                cashBreakdown["₱" + val] = pcs;
                declaredCash += (val * pcs);
            }
        });

        // 2. Identify Shift Data
        let shiftId = (typeof activeShiftDetails !== 'undefined' && activeShiftDetails) ? activeShiftDetails.logId : localStorage.getItem('currentShiftId');
        if (!shiftId) throw new Error("No active shift found to close.");

        let branchName = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let cashierName = localStorage.getItem('cashierName') || 'Unknown';

        let startTime = new Date();
        if (typeof activeShiftDetails !== 'undefined' && activeShiftDetails && activeShiftDetails.startTime) {
            startTime = activeShiftDetails.startTime;
            if (startTime.toDate) startTime = startTime.toDate();
        } else {
            startTime.setHours(0,0,0,0);
        }

        // 3. Crunch Sales & Split Payments
        let totalCashSales = 0; let totalDigitalSales = 0;
        let digitalBreakdown = {}; let shiftIngredientBurn = {};

        const txQ = query(collection(db, "transactions"), where("branch", "==", branchName), where("timestamp", ">=", startTime));
        const txSnap = await getDocs(txQ);

        txSnap.forEach(docSnap => {
            let tx = docSnap.data();
            if (tx.status !== 'Voided') {
                if (tx.cart) {
                    tx.cart.forEach(item => {
                        let itemName = item.name || item.itemName;
                        let qty = item.qty || 1;
                        let recipe = (typeof masterPOSData !== 'undefined' && masterPOSData.bom) ? masterPOSData.bom.filter(b => b.menuItem === itemName) : [];
                        recipe.forEach(r => {
                            if (!shiftIngredientBurn[r.ingredientName]) shiftIngredientBurn[r.ingredientName] = 0;
                            shiftIngredientBurn[r.ingredientName] += (r.qty * qty);
                        });
                        if (item.addons) {
                            for (let key in item.addons) {
                                let addon = item.addons[key];
                                if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                                    if (!shiftIngredientBurn[addon.linkedIngredient]) shiftIngredientBurn[addon.linkedIngredient] = 0;
                                    shiftIngredientBurn[addon.linkedIngredient] += (addon.deductQty * addon.qty * qty);
                                }
                            }
                        }
                    });
                }

                if (tx.splitDetails) {
                    tx.splitDetails.forEach(split => {
                        if (split.method === 'Cash') totalCashSales += split.amount;
                        else {
                            totalDigitalSales += split.amount;
                            digitalBreakdown[split.method] = (digitalBreakdown[split.method] || 0) + split.amount;
                        }
                    });
                } else if (tx.paymentMethod === 'Cash' || !tx.paymentMethod) {
                    totalCashSales += tx.netTotal;
                } else {
                    totalDigitalSales += tx.netTotal;
                    digitalBreakdown[tx.paymentMethod] = (digitalBreakdown[tx.paymentMethod] || 0) + tx.netTotal;
                }
            }
        });

        const expQ = query(collection(db, "expenses"), where("branch", "==", branchName), where("timestamp", ">=", startTime));
        const expSnap = await getDocs(expQ);
        let cashOut = 0;
        expSnap.forEach(e => cashOut += (parseFloat(e.data().amount) || 0));

        let startingCash = (typeof activeShiftDetails !== 'undefined' && activeShiftDetails) ? (activeShiftDetails.startingCash || 0) : 0;
        let expectedCash = startingCash + totalCashSales - cashOut;

        // 4. Zero Cash Lockout Security
        if (expectedCash > 0 && declaredCash === 0) {
            Swal.fire('⛔ SECURITY LOCKOUT', `The system has logged cash sales for this shift.<br><br>You cannot submit a blank or zero physical cash count. Please recount your drawer and enter the actual physical bills.`, 'error');
            if (confirmBtn) { confirmBtn.innerHTML = origText; confirmBtn.disabled = false; }
            return;
        }

        // 5. The Variance SweetAlert (🔥 100% BLIND COUNT FIX)
        let variance = declaredCash - expectedCash;
        if (Math.abs(variance) > 2) {
            let isOver = variance > 0;
            let alertTitle = isOver ? '📈 Cash Overage Detected' : '🚨 Cash Shortage Detected';
            
            // 🔥 REMOVED THE EXACT AMOUNTS FROM THE UI!
            let alertHtml = isOver 
                ? `Your declared cash is <b>MORE</b> than the system expects.<br><br>Do not remove any overage. Submit the full amount for HQ review.<br><br>Do you want to permanently submit this Z-Reading?`
                : `Your declared cash is <b>SHORT</b> of the system expectation.<br><br>You will be required to submit a Reason Letter to HQ immediately after closing.<br><br>Do you want to permanently submit this Z-Reading?`;

            const result = await Swal.fire({
                title: alertTitle,
                html: alertHtml,
                icon: isOver ? 'info' : 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, End Shift',
                cancelButtonText: 'No, Re-count Cash',
                confirmButtonColor: isOver ? '#d97706' : '#dc2626',
                cancelButtonColor: '#64748b',
                customClass: { popup: 'rounded-2xl shadow-2xl' }
            });

            if (!result.isConfirmed) {
                if (confirmBtn) { confirmBtn.innerHTML = origText; confirmBtn.disabled = false; }
                return; 
            }

            // We still silently log the exact variance to the Manager HQ Feed!
            await addDoc(collection(db, "manager_alerts"), {
                type: "VARIANCE_ALERT", branch: branchName, cashier: cashierName, shiftId: shiftId,
                expected: expectedCash, declared: declaredCash, varianceAmount: variance, stockCounts: {}, 
                message: `CASH ${isOver ? "OVER" : "SHORT"}: ₱${Math.abs(variance).toFixed(2)} variance detected.`,
                explanationCause: "Awaiting Staff Letter...", explanationMessage: "", explanationStatus: "Pending", 
                timestamp: serverTimestamp(), isRead: false
            });
        }

        if (confirmBtn) confirmBtn.innerHTML = "⏳ Saving to Cloud...";
        
        // 6. FIREBASE: CLOSE SHIFT
        await updateDoc(doc(db, "shifts", shiftId), {
            active: false,
            endTime: serverTimestamp(),
            declaredCash: declaredCash,
            expectedCash: expectedCash,
            totalCashSales: totalCashSales, 
            totalDigitalSales: totalDigitalSales,
            digitalBreakdown: digitalBreakdown,
            cashBreakdown: cashBreakdown, 
            physicalStockCount: {}, 
            status: "Closed"
        });

        // 7. FIREBASE: AUTO-SWEEP
        for (let method in digitalBreakdown) {
            if (method.toLowerCase() === "gcash") continue; 
            let amountToDeposit = digitalBreakdown[method];
            if (amountToDeposit > 0) {
                const accQ = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", method));
                const accSnap = await getDocs(accQ);
                if (!accSnap.empty) {
                    let accDoc = accSnap.docs[0];
                    let currentBal = accDoc.data().balance || 0;
                    await updateDoc(accDoc.ref, { balance: currentBal + amountToDeposit });
                    await addDoc(collection(db, "account_logs"), {
                        accountId: accDoc.id, accountName: method, branch: "Main Office", action: "Auto-Sweep (Shift Close)",
                        amount: amountToDeposit, newBalance: currentBal + amountToDeposit, user: cashierName, timestamp: serverTimestamp(), note: `From ${branchName}`
                    });
                } else {
                    const newAccRef = await addDoc(collection(db, "cash_accounts"), { name: method, branch: "Main Office", balance: amountToDeposit, createdAt: serverTimestamp() });
                    await addDoc(collection(db, "account_logs"), {
                        accountId: newAccRef.id, accountName: method, branch: "Main Office", action: "Auto-Sweep (New Account)", amount: amountToDeposit, newBalance: amountToDeposit, user: 'System', timestamp: serverTimestamp(), note: `From ${branchName}`
                    });
                }
            }
        }

        // 8. Deduct Ingredient Burn
        for (let ingName in shiftIngredientBurn) {
            let totalBurn = shiftIngredientBurn[ingName];
            if (totalBurn > 0) {
                await addDoc(collection(db, "stock_logs"), {
                    branch: branchName, item: ingName, uom: "Units", oldQty: "Shift", newQty: "Summary",
                    variance: -totalBurn, type: "Shift Sales Deduction", note: `Ingredients used during ${cashierName}'s shift`,
                    user: cashierName, timestamp: serverTimestamp()
                });
            }
        }

        // 9. Memory Wipe & Force UI Lockout
        localStorage.removeItem('currentShiftId');
        localStorage.removeItem('takodeal_sop_progress');
        if (typeof activeShiftDetails !== 'undefined') activeShiftDetails = null;
        if (typeof currentShift !== 'undefined') currentShift = null;

        let endModal = document.getElementById('endShiftModal');
        if (endModal) endModal.style.display = 'none';

        let topBtn = document.getElementById('btnTopShift');
        let lock = document.getElementById('shiftLockout');
        let placeBtn = document.getElementById('btnMainPlaceOrder');
        if (topBtn) topBtn.innerText = "🔴 Shift Closed";
        if (lock) lock.style.display = "flex";
        if (placeBtn) placeBtn.disabled = true;

        // 🔥 THE SUCCESS FIX: Do not show exact Sales Totals!
        Swal.fire({
            title: '✅ SHIFT CLOSED!',
            text: 'Your shift has been successfully ended and securely logged to HQ.',
            icon: 'success',
            customClass: { popup: 'rounded-2xl' }
        });

        if (typeof checkCurrentShift === 'function') await checkCurrentShift();
        if (typeof window.loadSalesDashboard === 'function') window.loadSalesDashboard();

    } catch (error) {
        console.error("Error closing shift:", error);
        Swal.fire('❌ Error', 'Failed to close shift: ' + error.message, 'error');
        if (confirmBtn) { confirmBtn.innerHTML = origText; confirmBtn.disabled = false; }
    }
};
