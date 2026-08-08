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

window.storage = storage; 
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

// 🔥 THE MISSING FIREBASE BRIDGE 🔥
window.addDoc = addDoc;
window.serverTimestamp = serverTimestamp;
window.increment = increment;
window.limit = limit;
window.orderBy = orderBy;
window.ref = ref;
window.uploadBytes = uploadBytes;
window.getDownloadURL = getDownloadURL;

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

    // 📢 NEW: THE COMPLIANCE INTERCEPTOR! Check if they have unread announcements!
    if (staffData) {
        // We trigger the modal asynchronously so the UI still loads smoothly behind it!
        setTimeout(() => { window.checkForAnnouncements(staffData.cashierName); }, 1500);
    }
    // 🔥 SECURITY WALL REMOVED! Floating staff are now authorized to log in anywhere.
    return staffData; // Allows the login!

  } catch (error) {
    console.error("Database error:", error);
    return null;
  }
};

// --- 🔥 INSTANT-BOOT & LIVE REAL-TIME MENU ENGINE ---
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
                price: parseFloat(item.price || item.basePrice) || 0, // 🔥 FORCE THE TRUE PRICE
                id: item.id
            });
            window.masterPOSData.phantomVariants[baseName].sort((a, b) => a.price - b.price);
        } else {
            groupedMenu.push(item);
        }
    });
    return groupedMenu;
};

window.menuListenerUnsubscribe = null;

window.loadPOSData = async function() {
    window.applySidebarLayout(); 
    
    // 1. Load Global Configs & Addons FIRST
    try {
        const configSnap = await window.getDoc(window.doc(window.db, "settings", "global_pos_config"));
        if (configSnap.exists()) {
            let configData = configSnap.data();
            window.masterPOSData.settings = {
                orderTypes: configData.orderTypes && configData.orderTypes.length > 0 ? configData.orderTypes : ["Dine-In", "Take-Out", "Delivery", "Grab"],
                payMethods: configData.paymentMethods && configData.paymentMethods.length > 0 ? configData.paymentMethods : ["Cash", "GCash"]
            };
        }
        
        const catLayoutSnap = await window.getDoc(window.doc(window.db, "settings", "pos_layout"));
        if (catLayoutSnap.exists() && catLayoutSnap.data().categories) {
            window.masterPOSData.categories = catLayoutSnap.data().categories;
        }

        const itemLayoutSnap = await window.getDoc(window.doc(window.db, "settings", "pos_item_layout"));
        if (itemLayoutSnap.exists()) {
            window.globalItemLayout = itemLayoutSnap.data().items || [];
        }
        
        const addonLayoutSnap = await window.getDoc(window.doc(window.db, "settings", "pos_addon_layout"));
        if (addonLayoutSnap.exists() && addonLayoutSnap.data().itemNames) {
            window.masterPOSData.addonLayoutNames = addonLayoutSnap.data().itemNames;
        }
        
        window.masterPOSData.addons = [];
        const addonsSnap = await window.getDocs(window.collection(window.db, "global_addons"));
        addonsSnap.forEach(doc => window.masterPOSData.addons.push(doc.data()));
        
        // Mix match configs
        window.masterPOSData.globalMixMatch = { categories: [], flavors: [], mappings: [] };
        const mmSnap = await window.getDoc(window.doc(window.db, "settings", "global_mixmatch"));
        if (mmSnap.exists()) window.masterPOSData.globalMixMatch = mmSnap.data();
        
    } catch(e) { console.warn("Config load error", e); }

    // 2. Start LIVE Menu Listener (Never caches old prices again!)
    if (window.menuListenerUnsubscribe) window.menuListenerUnsubscribe();
    
    let currentBranch = localStorage.getItem('takodeal_device_branch');
    let allowedCats = [];
    try {
        if (currentBranch) {
            const bSnap = await window.getDocs(window.query(window.collection(window.db, "branches"), window.where("name", "==", currentBranch)));
            if (!bSnap.empty && bSnap.docs[0].data().allowedCategories) {
                allowedCats = bSnap.docs[0].data().allowedCategories;
            }
        }
    } catch(e) {}

    const menuQ = window.query(window.collection(window.db, "menu"));
    
    window.menuListenerUnsubscribe = window.onSnapshot(menuQ, async (snapshot) => {
        let rawItems = [];
        snapshot.forEach(doc => rawItems.push({ id: doc.id, ...doc.data() }));
        
        // 🔥 THE PRICE FIX: Forcefully update the memory cache so old prices are DESTROYED
        localStorage.setItem('takodeal_offline_menu', JSON.stringify(rawItems));
        
        if (allowedCats.length > 0) {
            rawItems = rawItems.filter(item => allowedCats.includes(item.category));
        }

        let processed = window.processRawItemsIntoMenu(rawItems);
        window.masterPOSData.items = processed;

        // 🔥 FORCE THE UI TO REDRAW INSTANTLY
        if (typeof window.buildCategories === 'function') {
            window.buildCategories();
        }
        
        // 🔥 IF A CATEGORY IS ALREADY OPEN, REDRAW THE GRID TO SHOW NEW PRICES!
        if (window.currentDepartment && typeof window.renderTopCategories === 'function') {
            window.renderTopCategories();
        }
    });

    let otHtml = ''; window.masterPOSData.settings.orderTypes.forEach(t => otHtml += `<option value="${t}">${t}</option>`); 
    let otSelect = document.getElementById('mainOrderType');
    otSelect.innerHTML = otHtml;

    // 🔥 NEW: Auto-sync Payment Method when Grab/Foodpanda is selected 🔥
    otSelect.addEventListener('change', function() {
        let val = this.value.toLowerCase();
        
        if (val.includes('grab')) {
            let btn = Array.from(document.querySelectorAll('.pay-btn')).find(b => b.innerText.toLowerCase().includes('grab'));
            if (btn) btn.click();
        } else if (val.includes('foodpanda') || val.includes('panda')) {
            let btn = Array.from(document.querySelectorAll('.pay-btn')).find(b => b.innerText.toLowerCase().includes('foodpanda') || b.innerText.toLowerCase().includes('panda'));
            if (btn) btn.click();
        }
    });
    window.masterPOSData.settings.payMethods.forEach((m, idx) => { 
        let act = idx === 0 ? 'active' : ''; if (idx === 0) window.selectedPaymentMethod = m; 
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

// ========================================================
// 🛒 CORE ORDERING & CART ENGINE
// ========================================================
window.openAddOrderModal = async function(name, basePrice, existingItem = null) {
    // 🔥 THE FIX: Explicitly WIPE the ghost memory clean every time the modal opens!
    window.currentBaseFlavorsInfo = [];
    window.baseFlavorState = {};
    window.mixMatchState = {};
    window.maxMixMatch = 0;

    if (!window.masterPOSData) window.masterPOSData = {};
    if (!window.cart) window.cart = [];

    let baseName = name;
    let match = name.match(/^(.*?)\s+(\d+\s*Pcs|[SML]|Duo|Solo|Trio|Squad)$/i);
    if (match) {
        baseName = match[1].trim();
    }

    if (existingItem) { 
        window.pendingItem = JSON.parse(JSON.stringify(existingItem)); 
        window.editIndex = window.cart.indexOf(existingItem); 
        window.pendingItem.realName = window.pendingItem.realName || window.pendingItem.name;
    } else { 
        window.pendingItem = { name: name, basePrice: basePrice, variantName: 'Standard', variantPrice: basePrice, qty: 1, notes: '', addons: {}, discountType: 'none', discountVal: 0, isGrouped: false, realName: name }; 
        window.editIndex = -1; 
    }

    let phantomSizes = window.masterPOSData.phantomVariants ? window.masterPOSData.phantomVariants[baseName] : null;
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
            let cat = itemData.category || "Uncategorized";

            // 🌍 GLOBAL INTERCEPTOR ENGINE
            let gmm = window.masterPOSData.globalMixMatch;
            if (gmm && gmm.categories && (gmm.categories.includes('All') || gmm.categories.includes(cat))) {
                itemData.mixMatchFlavors = gmm.flavors || [];
                itemData.mixMatchConfig = gmm.mappings || [];
            }

            if (!itemData.addons) itemData.addons = [];
            window.masterPOSData.addons.forEach(ga => {
                let gaCats = Array.isArray(ga.category) ? ga.category : (ga.category ? ga.category.split(',').map(s=>s.trim()) : []);
                if (gaCats.includes('All') || gaCats.includes(cat)) {
                    if (!itemData.addons.find(a => a.name === ga.name)) itemData.addons.push(ga);
                }
            });

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
                    window.currentBaseFlavorsInfo = baseFlavors;
                    let defaultQty = existingItem ? 0 : window.pendingItem.qty;
                    
                    baseFlavors.forEach((bf, bfIdx) => {
                        if (existingItem && existingItem.addons && existingItem.addons[bf.name]) {
                            window.baseFlavorState[bf.name] = existingItem.addons[bf.name].qty;
                        } else {
                            window.baseFlavorState[bf.name] = (bfIdx === 0) ? defaultQty : 0;
                        }
                    });

                    newUiHtml += `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px; width: 100%;">
                            <label style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase;">BASE FLAVOR (Required)</label>
                            <span id="baseFlavorCounter" style="font-size: 11px; font-weight: bold; color: #b45309;">0 Pcs</span>
                        </div>
                        <div id="baseFlavorList" style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px; margin-bottom: 15px; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;"></div>
                    `;
                }

                if (extras.length > 0) {
                    newUiHtml += `<label style="font-size: 11px; font-weight: bold; color: #64748b; display: block; margin-bottom: 5px; width: 100%;">EXTRA ADD-ONS (Optional)</label><div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px; width: 100%;">`;
                    extras.forEach(a => {
                        let isChecked = (existingItem && existingItem.addons && existingItem.addons[a.name]) ? 'checked' : '';
                        newUiHtml += `
                            <label style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #f8fafc; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; font-weight: bold; color: #334155; box-sizing: border-box;">
                                <span><input type="checkbox" class="addon-checkbox" value="${a.name}|${a.price}|${a.linkedIngredient || ''}|${a.deductQty || 0}" ${isChecked} style="transform: scale(1.2); margin-right: 8px;" onchange="if(typeof window.updateModalTotals==='function') window.updateModalTotals(); else updateModalTotals();"> ${a.name}</span>
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
            
            if (typeof window.renderBaseFlavorsList === 'function') window.renderBaseFlavorsList();

            // 🐙 ITEM-SPECIFIC MIX & MATCH BUILDER
            window.mixMatchState = {};
            let hasMixMatch = itemData.mixMatchFlavors && itemData.mixMatchFlavors.length > 0;
            let customArea = document.getElementById('takoyakiCustomizationArea');
            
            if (customArea) {
                if (hasMixMatch) {
                    itemData.mixMatchFlavors.forEach(flavor => {
                        window.mixMatchState[flavor] = (existingItem && existingItem.mixMatchState && existingItem.mixMatchState[flavor]) ? existingItem.mixMatchState[flavor] : 0;
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
    } catch (error) { 
        console.error("Error loading item details:", error); 
    }
    
    if (typeof window.updateModalTotals === 'function') window.updateModalTotals(); 
};

window.renderBaseFlavorsList = function() {
    let list = document.getElementById('baseFlavorList');
    let counterDisplay = document.getElementById('baseFlavorCounter');
    if (!list || !counterDisplay || !window.currentBaseFlavorsInfo) return;

    let requiredTotal = window.pendingItem.qty;
    let currentTotal = Object.values(window.baseFlavorState).reduce((a, b) => a + b, 0);
    
    counterDisplay.innerText = `${currentTotal} / ${requiredTotal} Pcs`;
    counterDisplay.style.color = currentTotal === requiredTotal ? "#16a34a" : "#dc2626";

    let html = '';
    window.currentBaseFlavorsInfo.forEach(bf => {
        let count = window.baseFlavorState[bf.name] || 0;
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 6px 10px; border: 1px solid #fde68a; border-radius: 6px;">
                <span style="font-size: 13px; font-weight: bold; color: #b45309;">${bf.name} <span style="font-size: 10px; color: #d97706;">(Free)</span></span>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button class="btn-qty-small" style="width: 26px; height: 26px; border-color: #fcd34d; color: #d97706; font-size: 16px; line-height: 1;" onclick="window.adjustBaseFlavorQty('${bf.name}', -1)">-</button>
                    <span style="font-weight: 900; font-size: 14px; color: #0f172a; width: 20px; text-align: center;">${count}</span>
                    <button class="btn-qty-small" style="width: 26px; height: 26px; border-color: #fcd34d; color: #d97706; font-size: 16px; line-height: 1;" onclick="window.adjustBaseFlavorQty('${bf.name}', 1)">+</button>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
};

window.adjustBaseFlavorQty = function(flavor, delta) {
    let requiredTotal = window.pendingItem.qty;
    let currentTotal = Object.values(window.baseFlavorState).reduce((a, b) => a + b, 0);
    let currentCount = window.baseFlavorState[flavor] || 0;

    if (delta > 0 && currentTotal >= requiredTotal) {
        document.getElementById('baseFlavorCounter').style.animation = "shake 0.5s";
        setTimeout(() => document.getElementById('baseFlavorCounter').style.animation = "", 500);
        return; 
    }
    if (delta < 0 && currentCount <= 0) return; 

    window.baseFlavorState[flavor] = currentCount + delta;
    window.renderBaseFlavorsList();
};

window.adjustModalMainQty = function(delta) {
    let cur = parseInt(document.getElementById('modalMainQty').innerText) || 1;
    if (cur + delta > 0) {
        window.pendingItem.qty = cur + delta;
        document.getElementById('modalMainQty').innerText = window.pendingItem.qty;
        
        if (window.currentBaseFlavorsInfo && window.currentBaseFlavorsInfo.length > 0) {
            let firstFlavor = window.currentBaseFlavorsInfo[0].name;
            if (delta > 0) {
                window.baseFlavorState[firstFlavor] += delta;
            } else {
                for (let f of window.currentBaseFlavorsInfo) {
                    if (window.baseFlavorState[f.name] > 0) {
                        window.baseFlavorState[f.name] -= 1;
                        break;
                    }
                }
            }
            if (typeof window.renderBaseFlavorsList === 'function') window.renderBaseFlavorsList();
        }

        window.updateModalTotals();
    }
};

window.setDiscountType = function(type) {
    window.pendingItem.discountType = type;
    document.querySelectorAll('.discount-grid .var-btn').forEach(b => b.classList.remove('active'));
    let dvi = document.getElementById('discountValueInput');
    dvi.style.display = type === 'none' ? 'none' : 'block';
    dvi.value = '';
    
    if (type === 'none') { document.getElementById('btnDiscNone').classList.add('active'); window.pendingItem.discountVal = 0; }
    else if (type === 'percentage') { document.getElementById('btnDiscPerc').classList.add('active'); dvi.placeholder = "Enter %"; }
    else if (type === 'fixed') { document.getElementById('btnDiscFixed').classList.add('active'); dvi.placeholder = "Enter amount"; }
    
    window.updateModalTotals();
};

window.updateModalTotals = function() {
    let qty = parseInt(document.getElementById('modalMainQty').innerText) || 1;
    let addonsTotal = 0; 

    document.querySelectorAll('.addon-checkbox:checked').forEach(cb => {
        let parts = cb.value.split('|');
        addonsTotal += (parseFloat(parts[1]) || 0);
    });

    let lineTotal = (window.pendingItem.variantPrice + addonsTotal) * qty;
    let discInput = parseFloat(document.getElementById('discountValueInput').value) || 0; 
    window.pendingItem.discountVal = discInput;

    let calcDisc = 0;
    if (window.pendingItem.discountType === 'percentage' && discInput > 0) calcDisc = lineTotal * (discInput / 100);
    else if (window.pendingItem.discountType === 'fixed' && discInput > 0) calcDisc = discInput;

    let finalTotal = lineTotal - calcDisc;

    document.getElementById('modalLiveTotal').innerText = '₱ ' + (finalTotal < 0 ? 0 : finalTotal).toFixed(2);
    document.getElementById('confirmAddToCartText').innerText = window.editIndex > -1 ? 'Update Order' : 'Add to Order';
};

window.confirmAddOrUpdateToCart = function() {
    let qty = parseInt(document.getElementById('modalMainQty').innerText) || 1; 
    window.pendingItem.notes = document.getElementById('orderNotesInput').value;
    window.pendingItem.name = window.pendingItem.realName || window.pendingItem.name;
    window.pendingItem.addons = {}; 

    if (window.currentBaseFlavorsInfo && window.currentBaseFlavorsInfo.length > 0) {
        let totalBase = Object.values(window.baseFlavorState).reduce((a, b) => a + b, 0);
        if (totalBase !== qty) {
            Swal.fire('Incomplete Flavors', `Please select exactly ${qty} base flavor(s). You have currently selected ${totalBase}.`, 'warning');
            return;
        }
        
        for (let flavor in window.baseFlavorState) {
            let count = window.baseFlavorState[flavor];
            if (count > 0) {
                let bfInfo = window.currentBaseFlavorsInfo.find(b => b.name === flavor);
                window.pendingItem.addons[flavor] = { name: flavor, price: 0, qty: count, linkedIngredient: bfInfo.linkedIngredient || '', deductQty: bfInfo.deductQty || 0 };
            }
        }
    }

    if (typeof window.mixMatchState !== 'undefined') {
        let totalCustomPcs = Object.values(window.mixMatchState).reduce((a, b) => a + b, 0);
        if (totalCustomPcs > 0) {
            window.pendingItem.notes = window.pendingItem.notes ? window.pendingItem.notes + " | MIX: " : "MIX: ";
            for (let flavor in window.mixMatchState) {
                let count = window.mixMatchState[flavor];
                if (count > 0) {
                    let linkedIng = flavor;
                    let deductQty = 1; 
                    
                    if (window.masterPOSData && window.masterPOSData.addons) {
                        let matchingAddon = window.masterPOSData.addons.find(a => (a.name || "").toLowerCase() === flavor.toLowerCase());
                        if (matchingAddon) {
                            linkedIng = matchingAddon.linkedIngredient || flavor;
                            deductQty = parseFloat(matchingAddon.deductQty) || 1;
                        }
                    }

                    window.pendingItem.addons[`${flavor} Filling`] = { name: `${flavor} Filling`, price: 0, qty: count, linkedIngredient: linkedIng, deductQty: deductQty };
                    window.pendingItem.notes += `${count} ${flavor}, `;
                }
            }
            window.pendingItem.notes = window.pendingItem.notes.replace(/, $/, '');
        }
    } 

    document.querySelectorAll('.addon-checkbox:checked').forEach(cb => {
        let p = cb.value.split('|');
        window.pendingItem.addons[p[0]] = { name: p[0], price: parseFloat(p[1]), qty: 1, linkedIngredient: p[2], deductQty: parseFloat(p[3]) };
    });

    let addonsTotal = 0; 
    for (let key in window.pendingItem.addons) addonsTotal += (window.pendingItem.addons[key].price * window.pendingItem.addons[key].qty);
    
    let lineTotalBeforeDisc = (window.pendingItem.variantPrice + addonsTotal) * qty;
    let rowDiscount = 0;
    if (window.pendingItem.discountType === 'percentage' && window.pendingItem.discountVal > 0) rowDiscount = lineTotalBeforeDisc * (window.pendingItem.discountVal / 100);
    else if (window.pendingItem.discountType === 'fixed' && window.pendingItem.discountVal > 0) rowDiscount = window.pendingItem.discountVal;
    
    let finalTotal = lineTotalBeforeDisc - rowDiscount;
    window.pendingItem.lineTotalFinal = finalTotal < 0 ? 0 : finalTotal; 
    window.pendingItem.qty = qty;
    
    if (window.editIndex >= 0) { 
        window.cart[window.editIndex] = JSON.parse(JSON.stringify(window.pendingItem)); 
        window.editIndex = -1; 
    } else { 
        window.cart.push(JSON.parse(JSON.stringify(window.pendingItem))); 
    }
    
    if (typeof window.closeModal === 'function') {
        window.closeModal('variantModal'); 
    } else if (typeof closeModal === 'function') {
        closeModal('variantModal');
    }
    
    window.renderCart();
};

window.renderCart = function() {
    const list = document.getElementById('cartList'); let grandTotal = 0; list.innerHTML = '';
    if (!window.cart || window.cart.length === 0) { 
        list.innerHTML = '<li style="padding: 30px; text-align: center; color: #aaa; font-style: italic;">Menu is empty.</li>'; 
        document.getElementById('displaySubTotal').innerText = '₱0.00'; 
        document.getElementById('displayGrandTotal').innerText = '₱0.00'; 
        window.currentGrandTotal = 0; 
    } else {
        window.cart.forEach((item, index) => {
            grandTotal += item.lineTotalFinal;
            let notesText = item.notes ? `<div style="color:#222; font-style:italic; font-size:12px; margin-top:4px; font-weight:600;">${item.notes}</div>` : '';

            let addonsText = '';
            if (item.addons) {
                for (let key in item.addons) {
                    let addon = item.addons[key];
                    if (addon.qty > 0) {
                        let priceText = (addon.price && addon.price > 0) ? `(₱${(addon.price * addon.qty).toFixed(2)})` : '';
                        addonsText += `<div style="color:#d97706; font-size:11px; margin-top:2px; font-weight:600;">+ ${addon.qty}x ${addon.name || key} <span style="color:#64748b;">${priceText}</span></div>`;
                    }
                }
            }

            list.innerHTML += `<li class="cart-item" onclick="window.openAddOrderModal('${item.name}', ${item.basePrice}, window.cart[${index}])">
                <div class="cart-item-desc">
                    <span class="cart-item-name">${item.name}</span>
                    <div class="cart-item-subtext">${addonsText}${notesText}</div>
                </div>
                <div class="cart-item-price">₱${item.variantPrice.toFixed(2)}</div>
                <div class="cart-item-qty">x ${item.qty}</div>
                <div class="cart-item-sub">₱${item.lineTotalFinal.toFixed(2)}</div>
                <button class="btn-remove" onclick="window.cart.splice(${index}, 1); window.renderCart(); event.stopPropagation();">✖</button>
            </li>`;
        });
        window.currentGrandTotal = grandTotal; 
        document.getElementById('displaySubTotal').innerText = '₱ ' + grandTotal.toFixed(2); 
        document.getElementById('displayGrandTotal').innerText = '₱ ' + grandTotal.toFixed(2);
    }
};

window.clearCart = function() { 
    if (!window.cart || window.cart.length === 0) return; 
    if (confirm("Clear order?")) { 
        window.cart = []; 
        window.renderCart(); 
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

// ========================================================
// 🛒 TRUE OFFLINE CHECKOUT & SYNC ENGINE
// ========================================================
window.offlineQueue = JSON.parse(localStorage.getItem('takodeal_offline_queue')) || [];
window.isSyncing = false;
window.isProcessingOrder = false; // 🛡️ Initialize the lock variable

window.processCheckout = async function (payload) {
    // 🛡️ 1. THE SHIELD: Instantly block spam-clicks!
    if (window.isProcessingOrder) {
        console.warn("Checkout Shield activated: Ignored rapid double-click!");
        return null; 
    }
    window.isProcessingOrder = true; // Lock the checkout process

    try {
        // 🔥 THE CASHIER OVERRIDE FIX: 
        // This forces the receipt to use the person actively logged into the screen right now,
        // ignoring who originally opened the shift!
        let activeCashierName = (window.sessionUser && window.sessionUser.cashierName) 
            ? window.sessionUser.cashierName 
            : (localStorage.getItem('cashierName') || 'Unknown');
        
        payload.cashier = activeCashierName;

        // 🔥 TAG DIGITAL PAYMENTS AS UNVERIFIED AUTOMATICALLY
        if (payload.paymentMethod && payload.paymentMethod.toLowerCase() !== "cash") {
            payload.paymentVerified = false;
        } else {
            payload.paymentVerified = true; // Cash is pre-verified by the cashier
        }

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

        // 🔥 100% OFFLINE RECEIPT GENERATOR!
        let d = new Date();
        let dateStr = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
        let localCounter = parseInt(localStorage.getItem('takodeal_offline_rcpt_count')) || 1;
        localStorage.setItem('takodeal_offline_rcpt_count', localCounter + 1);
        let randomHash = Math.random().toString(36).substring(2, 5).toUpperCase();
        const receiptId = `${dateStr}-${localCounter.toString().padStart(4, '0')}-${randomHash}`;

        // Stamp the payload with the exact local time and receipt ID
        payload.receiptId = receiptId;
        payload.localTimestamp = new Date().toISOString(); 

        // 1. PUSH TO LOCAL OFFLINE QUEUE (Saves securely to the tablet's hard drive)
        window.offlineQueue.push(payload);
        localStorage.setItem('takodeal_offline_queue', JSON.stringify(window.offlineQueue));

        // Auto-close split container
        if (splitContainer) splitContainer.style.display = 'none';

        // 2. WAKE UP THE BACKGROUND SYNC ROBOT
        window.syncOfflineQueue();

        // 3. INSTANT RETURN: The cashier sees the success screen immediately!
        return receiptId;

    } catch (error) { 
        console.error("Critical Checkout Error:", error); 
        return "OFFLINE-" + Date.now().toString().slice(-6); 
    } finally {
        // 🔓 2. THE RELEASE: Always unlock the button when the process finishes!
        window.isProcessingOrder = false;
    }
};

// ========================================================
// ⚡ ATOMIC BATCH SYNC ENGINE (CORRUPTION & LEAK FIX)
// ========================================================
window.syncOfflineQueue = async function() {
    if (window.isSyncing || window.offlineQueue.length === 0) return;
    
    window.isSyncing = true;
    let badge = document.getElementById('liveClock').nextElementSibling;

    try {
        // We use a predefined inventory cache so we only ask Firebase for the Document ID once!
        let localInvCache = {};

        while (window.offlineQueue.length > 0) {
            if (badge) {
                badge.innerHTML = `<span style="background: #eab308; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 10px;">⏳ SYNCING SALES (${window.offlineQueue.length})...</span>`;
            }

            let payload = window.offlineQueue[0];
            let promises = []; // Using Promise.all instead of writeBatch prevents crash loops!
            
            // 1. Save Transaction to Firebase
            let txRef = window.doc(window.collection(window.db, "transactions"));
            promises.push(window.setDoc(txRef, {
                ...payload,
                timestamp: new Date(payload.localTimestamp)
            }));

            // 2. Gather all ingredient deductions (Base Recipe + Addons)
            let ingredientsToDeduct = {};

            if (payload.cart && Array.isArray(payload.cart)) {
                payload.cart.forEach(cartItem => {
                    let itemName = cartItem.name || cartItem.itemName;
                    let qtySold = cartItem.qty || 1;

                    // A. Deduct Base Recipe (Reads from Tablet Memory, ZERO Network Lag!)
                    let recipe = (window.masterPOSData && window.masterPOSData.bom) ? window.masterPOSData.bom.filter(b => b.menuItem === itemName) : [];
                    recipe.forEach(r => {
                        if (!ingredientsToDeduct[r.ingredientName]) ingredientsToDeduct[r.ingredientName] = 0;
                        ingredientsToDeduct[r.ingredientName] += (r.qty || 0) * qtySold;
                    });

                    // B. Deduct Add-ons & Mix-Match Fillings (The missing leak!)
                    if (cartItem.addons) {
                        for (let key in cartItem.addons) {
                            let addon = cartItem.addons[key];
                            if (addon.qty > 0 && addon.linkedIngredient && addon.deductQty > 0) {
                                if (!ingredientsToDeduct[addon.linkedIngredient]) ingredientsToDeduct[addon.linkedIngredient] = 0;
                                ingredientsToDeduct[addon.linkedIngredient] += (addon.deductQty * addon.qty * qtySold);
                            }
                        }
                    }
                });
            }

            // 3. Process Live Inventory Deductions
            for (let ing in ingredientsToDeduct) {
                let totalDeduct = ingredientsToDeduct[ing];
                if (totalDeduct > 0) {
                    // Check local cache first to avoid hanging on a fluctuating network
                    if (!localInvCache[ing]) {
                        const invQ = window.query(window.collection(window.db, "inventory"), window.where("branch", "==", payload.branch), window.where("name", "==", ing));
                        const invSnap = await window.getDocs(invQ);
                        if (!invSnap.empty) {
                            localInvCache[ing] = invSnap.docs[0].ref;
                        }
                    }
                    
                    if (localInvCache[ing]) {
                        promises.push(window.updateDoc(localInvCache[ing], { 
                            currentStock: window.increment(-totalDeduct) 
                        }));
                    }
                }
            }

            // 4. Execute everything simultaneously. If offline, Firebase caches these naturally!
            await Promise.all(promises);

            // 5. Remove processed order from local queue securely
            window.offlineQueue.shift();
            localStorage.setItem('takodeal_offline_queue', JSON.stringify(window.offlineQueue));
        }
    } catch(e) {
        console.warn("Offline Sync Paused: Will retry automatically when connection stabilizes.", e);
    } finally {
        window.isSyncing = false;
        if (window.isAppOnline && typeof window.updateNetworkStatusUI === 'function') {
            window.updateNetworkStatusUI();
        } else if (badge && window.isAppOnline === false) {
            badge.innerHTML = `<span style="background: #dc2626; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; box-shadow: 0 0 5px rgba(220,38,38,0.5);">🔴 OFFLINE (SAVING LOCALLY)</span>`;
        } else if (badge) {
            badge.innerHTML = `<span style="background: #16a34a; color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 10px; box-shadow: 0 0 5px rgba(22,163,74,0.5);">🟢 ONLINE & SYNCING</span>`;
        }
    }
};

// Automatically wake up the robot whenever the tablet connects to Wi-Fi
window.addEventListener('online', () => { 
    window.isAppOnline = true; 
    if(typeof window.updateNetworkStatusUI === 'function') window.updateNetworkStatusUI(); 
    window.syncOfflineQueue(); 
});

// Run once on boot to clear out any trapped sales from yesterday
setTimeout(window.syncOfflineQueue, 5000);

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

// --- RECEIPT DETAILS ENGINE (UNDEFINED FIX APPLIED) ---
window.viewReceiptDetails = async function (receiptId) {
    let tx = await window.getReceiptDetails(receiptId);
    if (!tx) { alert("Receipt not found!"); return; }

    let isCashTx = !tx.paymentMethod || tx.paymentMethod === 'Cash' || tx.paymentMethod.includes('Split');
    let displayTotal = isCashTx ? '***' : (tx.netTotal || 0).toFixed(2);

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
                    if(item.addons[key].qty > 0) {
                        // 🔥 THE FIX: Fallback to the dictionary key if addon.name is undefined!
                        let addonName = item.addons[key].name || key; 
                        addonsText += `<br><span style="color:#d97706; font-size:11px; margin-left:10px;">+ ${item.addons[key].qty}x ${addonName}</span>`;
                    }
                }
            }
            
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
// 🛑 SUBMIT COMPREHENSIVE SHIFT CLOSE (WITH MALL LEDGER)
// ========================================================
window.submitComprehensiveCloseShift = async function () {
    let confirmBtn = document.querySelector('#endShiftModal .btn-place:last-child') || document.querySelector('button[onclick*="MASTER_CloseShift"]');
    if (confirmBtn && confirmBtn.disabled) return; 

    let origText = confirmBtn ? confirmBtn.innerText : '🛑 Confirm & End Shift';
    if (confirmBtn) { 
        confirmBtn.innerText = "⏳ Verifying Count..."; 
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

        // 2. Identify Shift Safely
        let shiftId = (typeof activeShiftDetails !== 'undefined' && activeShiftDetails) ? activeShiftDetails.logId : localStorage.getItem('currentShiftId');
        if (!shiftId) throw new Error("No active shift found to close.");
        
        let branchName = localStorage.getItem('takodeal_device_branch') || 'Unknown';
        let cashierName = (window.sessionUser && window.sessionUser.cashierName) ? window.sessionUser.cashierName : (localStorage.getItem('cashierName') || 'Unknown');
        
        let startTime = new Date();
        if (typeof activeShiftDetails !== 'undefined' && activeShiftDetails && activeShiftDetails.startTime) {
            startTime = activeShiftDetails.startTime;
            if (startTime.toDate) startTime = startTime.toDate(); 
        } else {
            startTime.setHours(0,0,0,0);
        }

        // 3. Crunch Transactions
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

        // 4. Crunch Expenses
        const expQ = query(collection(db, "expenses"), where("branch", "==", branchName), where("timestamp", ">=", startTime));
        const expSnap = await getDocs(expQ);
        let cashOut = 0;
        expSnap.forEach(e => cashOut += (parseFloat(e.data().amount) || 0));

        let startingCash = (typeof activeShiftDetails !== 'undefined' && activeShiftDetails) ? (activeShiftDetails.startingCash || 0) : 0;
        let expectedCash = startingCash + totalCashSales - cashOut;

        if (expectedCash > 0 && declaredCash === 0) {
            Swal.fire('⛔ SECURITY LOCKOUT', `The system has logged cash sales for this shift.<br><br>You cannot submit a blank or zero physical cash count. Please recount your drawer and enter the actual physical bills.`, 'error');
            if (confirmBtn) { confirmBtn.innerText = origText; confirmBtn.disabled = false; }
            return;
        }

        // 5. THE VARIANCE SWEETALERT
        let variance = declaredCash - expectedCash;
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
                return; 
            }
            
            await addDoc(collection(db, "manager_alerts"), {
                type: "VARIANCE_ALERT", branch: branchName, cashier: cashierName, shiftId: shiftId,
                expected: expectedCash, declared: declaredCash, varianceAmount: variance, stockCounts: {}, 
                message: `CASH ${isOver ? "OVER" : "SHORT"}: ₱${Math.abs(variance).toFixed(2)} variance detected.`,
                explanationCause: "Awaiting Staff Letter...", explanationMessage: "", explanationStatus: "Pending", 
                timestamp: serverTimestamp(), isRead: false
            });
        }

        confirmBtn.innerText = "⏳ Saving to Cloud...";
        
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

        // 7. FIREBASE: AUTO-SWEEP DIGITAL PAYMENTS
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

        // 👑 7.5 FRANCHISE ROYALTY & PROFIT SHARING ENGINE
        try {
            const bQ = query(collection(db, "branches"), where("name", "==", branchName));
            const bSnap = await getDocs(bQ);
            let royaltyPct = 0;
            if (!bSnap.empty) royaltyPct = parseFloat(bSnap.docs[0].data().royaltyPercent) || 0;

            if (royaltyPct > 0) {
                let totalGrossForRoyalty = totalCashSales + totalDigitalSales;
                let royaltyAmount = totalGrossForRoyalty * (royaltyPct / 100);

                if (royaltyAmount > 0) {
                    await addDoc(collection(db, "expenses"), {
                        branch: branchName, amount: royaltyAmount, category: "Franchise Royalty Fee", account: "System Auto-Deduct", 
                        note: `Auto-Deducted ${royaltyPct}% Royalty from ₱${totalGrossForRoyalty.toFixed(2)} Total Sales`, timestamp: serverTimestamp()
                    });

                    const eqQ = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", "Owner's Equity"));
                    const eqSnap = await getDocs(eqQ);
                    
                    if (!eqSnap.empty) {
                        let eqDoc = eqSnap.docs[0];
                        let newBal = (parseFloat(eqDoc.data().balance) || 0) + royaltyAmount;
                        await updateDoc(eqDoc.ref, { balance: newBal });
                        await addDoc(collection(db, "account_logs"), { accountId: eqDoc.id, accountName: "Owner's Equity", branch: "Main Office", action: "Royalty Collection", amount: royaltyAmount, newBalance: newBal, user: "System Auto-Sweep", timestamp: serverTimestamp(), note: `From ${branchName} Z-Reading` });
                    } else {
                        const newEqRef = await addDoc(collection(db, "cash_accounts"), { branch: "Main Office", name: "Owner's Equity", balance: royaltyAmount, createdAt: serverTimestamp() });
                        await addDoc(collection(db, "account_logs"), { accountId: newEqRef.id, accountName: "Owner's Equity", branch: "Main Office", action: "Royalty Collection (Account Created)", amount: royaltyAmount, newBalance: royaltyAmount, user: "System Auto-Sweep", timestamp: serverTimestamp(), note: `From ${branchName} Z-Reading` });
                    }
                }
            }
        } catch(e) { console.error("Royalty Engine Error:", e); }

        // 🛍️ 7.6 MALL BRANCH MANAGER FUND AUTO-DEPOSIT
        try {
            const bQ = query(collection(db, "branches"), where("name", "==", branchName));
            const bSnap = await getDocs(bQ);
            let isMallBranch = false;
            if (!bSnap.empty) {
                isMallBranch = bSnap.docs[0].data().isMallBranch === true;
            }

            if (isMallBranch) {
                // Net Cash = Declared Physical Cash - Starting Float
                let netCashEarned = declaredCash - startingCash;
                
                if (netCashEarned !== 0) {
                    const accQ = query(collection(db, "cash_accounts"), where("branch", "==", branchName), where("name", "==", "Manager Fund"));
                    const accSnap = await getDocs(accQ);
                    
                    if (!accSnap.empty) {
                        let accDoc = accSnap.docs[0];
                        let currentBal = parseFloat(accDoc.data().balance) || 0;
                        let newBal = currentBal + netCashEarned;
                        
                        await updateDoc(accDoc.ref, { balance: newBal });
                        await addDoc(collection(db, "account_logs"), {
                            accountId: accDoc.id, accountName: "Manager Fund", branch: branchName, action: "Z-Reading Deposit (Net)",
                            amount: netCashEarned, newBalance: newBal, user: cashierName, timestamp: serverTimestamp(), note: `Shift Close: Declared ₱${declaredCash.toFixed(2)} - Float ₱${startingCash.toFixed(2)}`
                        });
                    } else {
                        const newAccRef = await addDoc(collection(db, "cash_accounts"), { name: "Manager Fund", branch: branchName, balance: netCashEarned, createdAt: serverTimestamp() });
                        await addDoc(collection(db, "account_logs"), {
                            accountId: newAccRef.id, accountName: "Manager Fund", branch: branchName, action: "Z-Reading Deposit (Account Created)",
                            amount: netCashEarned, newBalance: netCashEarned, user: "System", timestamp: serverTimestamp(), note: `Shift Close: Declared ₱${declaredCash.toFixed(2)} - Float ₱${startingCash.toFixed(2)}`
                        });
                    }
                }
            }
        } catch(e) { console.error("Mall Branch Deposit Error:", e); }

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

        // 9. Memory Wipe & UI Reset
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

window.safeSubmitComprehensiveCloseShift = window.submitComprehensiveCloseShift;

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
    window.isMallBranch = false;
    
    // 1. Fetch Inventory
    try {
        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
            let item = docSnap.data();
            item.id = docSnap.id;
            window.expenseInventoryCache.push(item);
        });
    } catch (e) { console.error("Error loading inventory for expenses:", e); }

    // 2. Fetch Branch Settings (Check for Mall Branch Mode)
    try {
        const bSnap = await getDocs(query(collection(db, "branches"), where("name", "==", branch)));
        if (!bSnap.empty) {
            window.isMallBranch = bSnap.docs[0].data().isMallBranch || false;
        }
    } catch(e) {}

    // 3. Inject the UI dynamically
    let sourceContainer = document.getElementById('expenseSourceContainer');
    if (!sourceContainer) {
        let titleBar = document.querySelector('#expenseModal .modal > div:nth-child(1)');
        let newDiv = document.createElement('div');
        newDiv.id = 'expenseSourceContainer';
        newDiv.style.cssText = "padding: 0 20px; background: #f8fafc;";
        titleBar.insertAdjacentElement('afterend', newDiv);
        sourceContainer = document.getElementById('expenseSourceContainer');
    }

    if (window.isMallBranch) {
        sourceContainer.innerHTML = `
            <div style="margin-top: 15px; background: #fffbeb; padding: 15px; border-radius: 8px; border: 2px dashed #fcd34d;">
                <label style="font-size: 13px; font-weight: bold; color: #b45309; display: block; margin-bottom: 5px;">💳 Source of Funds</label>
                <select id="expFundSource" class="input-box" style="width: 100%; padding: 12px; font-weight: bold; color: #92400e; background: white; border-color: #fcd34d; outline: none; cursor: pointer; font-size: 14px;">
                    <option value="Drawer">💵 POS Cash Drawer (Deducts from Z-Reading)</option>
                    <option value="Manager Fund">💼 Manager's Floating Cash (No Z-Reading Impact)</option>
                </select>
                <div style="font-size: 11px; color: #d97706; margin-top: 8px; font-weight: bold;">If the Manager bought this using the weekly remittance money, select "Manager's Floating Cash".</div>
            </div>
        `;
    } else {
        sourceContainer.innerHTML = '';
    }
};

// Mobile-friendly custom search dropdown (UPGRADED WITH "OTHERS" OPTION)
window.filterExpenseSearch = function() {
    let input = document.getElementById('expSearchInput').value.toLowerCase();
    let resultsDiv = document.getElementById('expSearchResults');
    window.selectedExpenseItem = null; // Reset selection on typing

    if (input.length < 1) { resultsDiv.style.display = 'none'; return; }

    let filtered = window.expenseInventoryCache.filter(i => (i.name || '').toLowerCase().includes(input));
    let html = '';
    
    filtered.forEach(item => {
        let safeItemStr = encodeURIComponent(JSON.stringify(item));
        html += `<div onclick="window.selectExpenseItem('${safeItemStr}')" style="padding: 12px 15px; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 14px; font-weight: bold; color: #334155; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">📦 Restock: ${item.name} <span style="font-size:11px; color:#94a3b8;">(${item.uom || ''})</span></div>`;
    });

    // 🔥 NEW: ALWAYS SHOW THE "OTHERS" OPTION AT THE BOTTOM!
    let customVal = document.getElementById('expSearchInput').value.trim();
    html += `
        <div onclick="window.selectCustomExpense()" style="padding: 12px 15px; background: #fffbeb; cursor: pointer; font-size: 14px; font-weight: bold; color: #d97706; border-top: 1px dashed #fcd34d; transition: background 0.2s;" onmouseover="this.style.background='#fef3c7'" onmouseout="this.style.background='#fffbeb'">
            📝 Others (Log "${customVal}" as General Expense)
        </div>
    `;

    resultsDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
};

// 🔥 NEW: Custom Expense Trigger
window.selectCustomExpense = function() {
    window.selectedExpenseItem = null; // Tells the system it's NOT physical stock
    document.getElementById('expSearchResults').style.display = 'none';
    
    // Hide UOM container if it exists
    let uomContainer = document.getElementById('expUomContainer');
    if (uomContainer) uomContainer.style.display = 'none';

    // Auto-fill QTY to 1 for general expenses so the cashier doesn't get stuck!
    let qtyInput = document.getElementById('expQtyInput');
    if (qtyInput && qtyInput.value === '') qtyInput.value = '1';

    // Move cursor to the Cost box automatically
    document.getElementById('expAmtInput').focus();
};

window.selectExpenseItem = function(encodedItem) {
    let item = JSON.parse(decodeURIComponent(encodedItem));
    window.selectedExpenseItem = item;
    document.getElementById('expSearchInput').value = `Restock: ${item.name}`;
    document.getElementById('expSearchResults').style.display = 'none';

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
    let rawQty = parseFloat(document.getElementById('expQtyInput').value);
    let cost = parseFloat(document.getElementById('expAmtInput').value) || 0;

    // 🔥 THE FIX: If they selected "Others", default the QTY to 1 if it's missing!
    if (!window.selectedExpenseItem && (isNaN(rawQty) || rawQty <= 0)) {
        rawQty = 1;
    }

    if (!desc || cost <= 0 || isNaN(rawQty) || rawQty <= 0) { 
        alert("Enter a description and a valid cost."); 
        return; 
    }

    let baseQty = rawQty;
    let displayUom = 'unit(s)'; // Default for General Expenses
    let convRate = 1;

    if (window.selectedExpenseItem) {
        let uomSelect = document.getElementById('expUomSelect');
        displayUom = window.selectedExpenseItem.uom;
        if (uomSelect && uomSelect.value === 'purch') {
            convRate = parseFloat(window.selectedExpenseItem.conversionRate) || 1;
            baseQty = rawQty * convRate; 
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
        // 🔥 THE FIX: Identifies "Others" dynamically in the cart UI!
        let qtyText = item.isRestock && item.displayQty > 0 
            ? `<br><span style="color:#16a34a; font-size:11px;">+${item.displayQty} ${item.displayUom} (${item.baseQty} ${item.uom} to inventory)</span>` 
            : `<br><span style="color:#ca8a04; font-size:11px; font-weight:bold;">(General Expense / Others)</span>`;
            
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

        let fundSource = document.getElementById('expFundSource') ? document.getElementById('expFundSource').value : "Drawer";

        // 2. Process each item in cart
        for (let item of window.expenseCart) {
            
            let finalDescription = item.description;
            if (item.isRestock && item.displayQty > 0) {
                finalDescription = `${item.description} (Qty: ${item.displayQty} ${item.displayUom})`;
            }

            await addDoc(collection(db, "expenses"), {
                branch: branch,
                shiftId: fundSource === "Drawer" ? activeShiftDetails.logId : "Manager_Fund",
                cashier: cashier,
                amount: item.cost,
                description: finalDescription,
                receiptPhoto: photoUrl, 
                paidFrom: fundSource, // 🔥 TELLS THE HQ EXACTLY WHERE THE MONEY CAME FROM!
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

                    await addDoc(collection(db, "stock_logs"), {
                        branch: branch, item: item.dbName, uom: item.uom, oldQty: currentStock, newQty: newTotalStock, variance: item.baseQty,
                        type: "Store Restock (Expense)", note: `Purchased ${item.displayQty} ${item.displayUom} for ₱${item.cost}`, user: cashier, timestamp: serverTimestamp()
                    });
                }
            }
        }

        // 🔥 ONLY DEDUCT FROM THE DRAWER IF THEY SELECTED DRAWER!
        if (fundSource === "Drawer") {
            const shiftRef = doc(db, "shifts", activeShiftDetails.logId);
            const shiftSnap = await getDoc(shiftRef);
            let currentExp = shiftSnap.data().expenses || shiftSnap.data().cashOut || 0;
            await updateDoc(shiftRef, { expenses: currentExp + grandTotal, cashOut: currentExp + grandTotal });
            alert(`✅ Success! ₱${grandTotal.toFixed(2)} deducted from POS drawer for ${window.expenseCart.length} item(s).`);
        } else {
            alert(`✅ Success! Logged ${window.expenseCart.length} item(s). Deducted from Manager's Floating Cash.`);
        }

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
    // 📩 PROCESSED REQUEST INTERCEPTOR (APPROVED & REJECTED)
    // ==========================================
    try {
        const reqQ = query(collection(db, "staff_requests"), where("staffName", "==", staffName));
        const reqSnap = await getDocs(reqQ);
        
        let unreadRequest = null;
        let unreadReqId = null;
        let nowMs = Date.now();
        
        // 🔥 THE FIX: Hard cutoff date! Anything older than this is instantly purged in the background.
        let updateCutoff = new Date('2026-07-20T00:00:00').getTime();

        reqSnap.forEach(docSnap => {
            let data = docSnap.data();
            
            if (!data.staffAcknowledged && (data.status === "Rejected" || data.status === "Approved")) {
                
                let actionTime = data.processedAt ? (data.processedAt.toDate ? data.processedAt.toDate().getTime() : new Date(data.processedAt).getTime()) : (data.timestamp ? data.timestamp.toDate().getTime() : 0);
                let ageInDays = (nowMs - actionTime) / (1000 * 60 * 60 * 24);

                // Only block the Time Clock if the decision happened in the last 2 days AND after our update!
                if (ageInDays <= 2 && actionTime > updateCutoff) {
                    unreadRequest = data;
                    unreadReqId = docSnap.id;
                } else {
                    // Silently clear out ancient requests in the background so they don't pile up!
                    updateDoc(doc(db, "staff_requests", docSnap.id), { staffAcknowledged: true }).catch(e => console.log("Silently cleared old request."));
                }
            }
        });

        if (unreadRequest) {
            let clockModal = document.getElementById('timeClockModal');
            if (clockModal) clockModal.style.display = 'none';

            let reqDetails = unreadRequest.amount ? `₱${unreadRequest.amount.toLocaleString()}` : (unreadRequest.item || unreadRequest.leaveType || unreadRequest.explanationCause || "Request");
            
            let isApproved = unreadRequest.status === "Approved";
            let titleTxt = isApproved ? '✅ Request Approved' : '❌ Request Rejected';
            let iconType = isApproved ? 'success' : 'error';
            let colorHex = isApproved ? '#16a34a' : '#dc2626';
            let bgHex = isApproved ? '#dcfce7' : '#f8fafc';
            let replyTxt = unreadRequest.managerReply || (isApproved ? 'Approved by Management.' : 'No specific reason provided.');

            const result = await Swal.fire({
                title: titleTxt,
                html: `Management has reviewed your recent request and it was <b>${unreadRequest.status}</b>.<br><br>
                       <div style="text-align:left; background:${bgHex}; padding:15px; border-radius:8px; border:1px solid #e2e8f0; margin-top:10px;">
                           <span style="font-size:12px; color:#64748b; font-weight:bold;">REQUEST TYPE:</span><br>
                           <span style="font-size:14px; font-weight:bold; color:#1e293b;">${unreadRequest.type} (${reqDetails})</span><br><br>
                           <span style="font-size:12px; color:#64748b; font-weight:bold;">MANAGER'S MESSAGE:</span><br>
                           <span style="font-size:14px; color:${colorHex}; font-style:italic;">"${replyTxt}"</span>
                       </div>
                       <br><span style="font-size:13px; color:#475569; font-weight:bold;">Please acknowledge this message to unlock the Time Clock.</span>`,
                icon: iconType,
                confirmButtonText: 'I Understand',
                confirmButtonColor: '#0f766e',
                allowOutsideClick: false,
                customClass: { popup: 'rounded-2xl shadow-2xl border border-gray-100' }
            });

            if (result.isConfirmed) {
                Swal.fire({title: 'Clearing Alert...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
                await updateDoc(doc(db, "staff_requests", unreadReqId), { staffAcknowledged: true });
                
                Swal.fire({
                    title: 'Unlocked',
                    text: 'You may now try timing in/out again.',
                    icon: 'success',
                    timer: 2000,
                    showConfirmButton: false,
                    customClass: { popup: 'rounded-2xl' }
                });
            }

            document.getElementById('clockStaffPin').value = ''; 
            unlockUI(); 
            return; 
        }
    } catch(e) {
        console.error("Processed Request Check Failed:", e);
    }

    // ==========================================
    // 🛡️ ANTI-DOUBLE PUNCH, PENALTIES & HR LOCKS
    // ==========================================
    let userLogs = [];
    try {
        // Try the optimal indexed query first
        const q = query(collection(db, "attendance_logs"), 
            where("staffName", "==", staffName), 
            orderBy("timestamp", "desc"), 
            limit(1)
        );
        const lastLogSnap = await getDocs(q);
        lastLogSnap.forEach(docSnap => userLogs.push(docSnap.data()));
    } catch(e) {
        console.warn("Firebase Index missing. Falling back to unbreakable index-free scan...");
        // 🔥 THE INDEX-FREE FALLBACK: Grabs the last 3 days and sorts mathematically!
        let lookBack = new Date();
        lookBack.setHours(lookBack.getHours() - 72); 
        
        const fallbackQ = query(collection(db, "attendance_logs"), where("timestamp", ">=", lookBack));
        const fallbackSnap = await getDocs(fallbackQ);
        
        fallbackSnap.forEach(docSnap => {
            let data = docSnap.data();
            if (data.staffName === staffName) {
                userLogs.push(data);
            }
        });
        
        // Sort newest first
        userLogs.sort((a, b) => b.timestamp.toDate().getTime() - a.timestamp.toDate().getTime());
    }

    try {
        if (userLogs.length > 0) {
            let lastLog = userLogs[0]; // The absolute most recent log
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
                        photoBase64: "", // 🔥 THE FIX: Blank photo so it is explicitly obvious they missed it!
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

            // 🔥 UPGRADE: Strict Double Time Out Blocker!
            if (type === "TIME OUT" && lastType === "TIME OUT") {
                alert(`❌ You already Timed Out!\n\nYou cannot Time Out twice in a row. Please Time In first.`);
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
                alert(`🚨 SHIFT VIOLATION DETECTED (${hoursSinceLastLog.toFixed(1)} hrs)\n\nYou have exceeded the 14-hour single-shift limit. The Manager has been notified to review this time punch.`);
            }

            // 🔥 Check if the staff profile has the Working Student toggle enabled!
            let isWorkingStudent = staffProfile.isWorkingStudent === true;

            // 🔥 THE UNDERTIME FIX: Intercept Time Outs under 8 hours (BUT IGNORE WORKING STUDENTS!)
            if (type === "TIME OUT" && lastType === "TIME IN" && hoursSinceLastLog < 8 && hoursSinceLastLog >= 0.25 && !isWorkingStudent) {
                
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
                let finalBranch = localStorage.getItem('takodeal_device_branch') || 'Unknown';
                await addDoc(collection(db, "staff_requests"), {
                    type: "Reason Letter",
                    staffName: staffName,
                    branch: finalBranch,
                    status: "Pending",
                    explanationCause: "Undertime",
                    explanationMessage: `Clocked out early after ${hoursSinceLastLog.toFixed(1)} hours. Reason: ${reason}`,
                    timestamp: new Date() 
                });
                
                Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Undertime Letter Sent!', showConfirmButton: false, timer: 3000});
            }
        }
    } catch(e) {
        console.error("Lock Engine Processing Error:", e);
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

        let paymentColor = '#f59e0b';
        let paymentLabel = 'Cash (Pay at Counter)';
        if (o.paymentMode && o.paymentMode.toLowerCase() !== 'cash') {
            paymentColor = '#3b82f6';
            let refText = o.paymentReference || o.gcashRef || 'No Ref';
            paymentLabel = `${o.paymentMode} (Verify Ref: ${refText})`;
        }

        let customerName = o.customerName || o.name || 'Mobile Customer';
        customerName = customerName.split('(')[0].trim(); 
        
        let contactInfo = o.contactNumber ? `📞 ${o.contactNumber}` : 'No Phone Provided';
        let orderTime = o.preferredTime ? `⏰ Advance Time: ${o.preferredTime}` : 'ASAP';

        // 🔥 THE MAP LINK FIX 🔥
        let searchAddr = encodeURIComponent(o.deliveryAddress || '');
        let mapBtn = o.mapLink ? `<a href="${o.mapLink}" target="_blank" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; text-decoration:none; display:inline-block; margin-right: 5px;">🗺️ Open Pinned Map</a>` : (o.deliveryAddress ? `<a href="https://www.google.com/maps/search/?api=1&query=${searchAddr}" target="_blank" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; text-decoration:none; display:inline-block; margin-right: 5px;">🗺️ Search Address</a>` : '');
        let photoBtn = o.locationImage ? `<a href="${o.locationImage}" target="_blank" style="background:#e0e7ff; color:#4f46e5; border:1px solid #c7d2fe; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; text-decoration:none; display:inline-block;">📸 View Landmark</a>` : '';
        let locText = o.deliveryAddress ? `<div style="font-size:12px; color:#475569; margin-top:8px; padding:8px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0;">📍 <strong>Delivery Address:</strong><br>${o.deliveryAddress}</div>` : '';
        
        let changeStr = o.changeFor ? `<div style="font-size:11px; color:#b91c1c; font-weight:bold; margin-top:6px; background: white; padding: 4px; border-radius: 4px;">⚠️ Prepare Change For: ₱${o.changeFor}</div>` : '';

        html += `<div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px; align-items: flex-start;">
                        <div>
                            <strong style="font-size:16px;">👤 ${customerName}</strong><br>
                            <span style="font-size:12px; color:#64748b; font-weight:bold;">${contactInfo} | ${orderTime}</span>
                        </div>
                        <strong style="color:var(--primary); font-size:16px;">₱${(o.totalAmount || 0).toFixed(2)}</strong>
                    </div>
                    
                    <div style="font-size: 12px; font-weight: bold; color: white; background: ${paymentColor}; padding: 8px; border-radius: 4px; text-align: center;">
                        ${paymentLabel}
                        ${changeStr}
                    </div>
                    
                    ${locText}
                    <div style="margin-top: 8px;">
                        ${mapBtn}
                        ${photoBtn}
                    </div>
                    
                    <div style="margin-bottom:15px; margin-top:15px;">${itemsHtml}</div>
                    
                    <div style="display:flex; gap:10px;">
                        <button class="btn-clear" style="flex:1; padding:10px; font-size:13px; color:#ef4444; border-color:#ef4444;" onclick="window.rejectMobileOrder('${o.id}')">✖ Reject</button>
                        <button class="btn-place" style="flex:2; padding:10px; font-size:13px;" onclick="window.acceptMobileOrder('${o.id}')">📥 Accept & Set Time</button>
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

    // 🔥 PREP TIME SELECTOR 🔥
    const { value: prepTime } = await Swal.fire({
        title: '⏱️ Set Preparation Time',
        text: 'How long will this order take? The customer will see this on their live tracker.',
        input: 'select',
        inputOptions: { '10': '10 Minutes', '15': '15 Minutes', '20': '20 Minutes', '30': '30 Minutes', '45': '45 Minutes', '60': '1 Hour' },
        inputPlaceholder: 'Select prep time',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        customClass: { popup: 'rounded-2xl' }
    });

    if (!prepTime) return;

    if (typeof cart !== 'undefined' && cart.length > 0) {
        if (!confirm("You have items in your current cart. Overwrite them with this mobile order?")) return;
    }

    cart = order.items.map(i => ({
        name: i.name, basePrice: i.price, variantName: 'Standard', variantPrice: i.price,
        qty: i.quantity, lineTotalFinal: i.price * i.quantity, discountType: 'none', discountVal: 0,
        addons: i.addons || {}, notes: i.notes || '📱 Mobile App Order'
    }));

    document.getElementById('finalCustomerName').value = order.customerName;
    let orderTypeDrop = document.getElementById('mainOrderType');
    if (orderTypeDrop && order.orderType) orderTypeDrop.value = order.orderType;

    // 🔥 UPDATE FIREBASE SO CUSTOMER CAN TRACK IT (DO NOT DELETE IT YET!)
    await window.updateDoc(window.doc(window.db, "incoming_orders", docId), {
        status: "preparing",
        prepTime: parseInt(prepTime),
        acceptedAt: window.serverTimestamp()
    });

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

// ========================================================
// 🚚 INCOMING DISPATCH RECEIVER (SMART TAB ENGINE)
// ========================================================
window.incomingDeliveriesList = [];

setTimeout(() => {
    let safeBranch = localStorage.getItem('takodeal_device_branch');
    if (!safeBranch) return;

    // 🔥 THE FIX: Tell the Cashier App to listen for BOTH "In Transit" AND "Arrived" statuses!
    onSnapshot(query(collection(db, "dispatch_logs"), where("toBranch", "==", safeBranch), where("status", "in", ["In Transit", "Arrived"])), (snap) => {
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
        if (document.getElementById('view-stockreq') && document.getElementById('view-stockreq').classList.contains('active')) {
             if (typeof window.loadStockRequestUI === 'function') window.loadStockRequestUI();
        }
        // Also refresh the Deliveries tab if they are in it!
        if (document.getElementById('view-deliveries') && document.getElementById('view-deliveries').classList.contains('active')) {
             if (typeof window.renderDeliveriesTab === 'function') window.renderDeliveriesTab();
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

    // 📦 STEP 1: GROUP SEPARATE FIREBASE DOCS BY DISPATCH
    let dispatchGroups = {};
    window.incomingDeliveriesList.forEach(del => {
        let groupKey = del.dispatchId || `${del.date}_${del.driver}`;
        if (!dispatchGroups[groupKey]) {
            dispatchGroups[groupKey] = {
                dispatchId: groupKey,
                date: del.date || 'Recent Date',
                time: del.time || '--:--',
                driver: del.driver || 'Assigned Driver',
                status: del.status || 'In Transit', // 🔥 WE NOW TRACK THE STATUS
                items: []
            };
        }
        dispatchGroups[groupKey].items.push(del);
    });

    // 📦 STEP 2: BUILD A SINGLE INVOICE SHEET CARD FOR EACH DISPATCH
    let html = '';
    for (let key in dispatchGroups) {
        let dispatch = dispatchGroups[key];
        
        // 🔥 SECURITY LOCK: Check if it actually arrived!
        let isArrived = dispatch.status === 'Arrived';
        
        let itemsTableRows = '';
        dispatch.items.forEach(item => {
            let friendlyQty = item.displayQty || item.qty;
            let friendlyUom = item.displayUom || item.uom;
            
            // Generate the inputs ONLY if it has arrived
            let inputHtml = '';
            let exceptionHtml = '';
            
            if (isArrived) {
                inputHtml = `<input type="number" id="recv_val_${item.id}" data-expected="${friendlyQty}" placeholder="${friendlyQty}" style="width: 85px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center; font-weight: bold; outline: none;">`;
                exceptionHtml = `
                    <label style="display: flex; align-items: center; justify-content: center; gap: 4px; background: #fff5f5; border: 1px dashed #fca5a5; padding: 6px 10px; border-radius: 6px; color: #dc2626; font-size: 11px; font-weight: bold; cursor: pointer; margin-bottom: 6px; width: 100%; box-sizing: border-box;">
                        <input type="checkbox" id="missing_check_${item.id}" onchange="window.toggleMissingItemRow('${item.id}')" style="accent-color: #dc2626; cursor: pointer;"> Not Delivered
                    </label>
                    <input type="text" id="remark_val_${item.id}" placeholder="Remarks / Reason..." style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; box-sizing: border-box; outline: none; text-align: center;">
                `;
            } else {
                inputHtml = `<span style="color: #94a3b8; font-size: 12px; font-style: italic;">🔒 Locked</span>`;
                exceptionHtml = `<span style="color: #94a3b8; font-size: 12px; font-style: italic;">🔒 Locked</span>`;
            }
            
            itemsTableRows += `
                <tr style="border-bottom: 1px solid #f1f5f9;" id="row_${item.id}">
                    <td style="padding: 12px 8px; font-weight: bold; color: #334155;">📦 ${item.item}</td>
                    <td style="padding: 12px 8px; font-weight: bold; color: #0284c7; text-align: center;">${friendlyQty} ${friendlyUom}</td>
                    <td style="padding: 12px 8px; text-align: center;">${inputHtml}</td>
                    <td style="padding: 12px 8px; text-align: center; vertical-align: top;">${exceptionHtml}</td>
                </tr>
            `;
        });

        // Toggle the Bottom Action Area
        let actionHtml = '';
        if (isArrived) {
            actionHtml = `
                <div style="background: #fff1f2; color: #be123c; padding: 10px; border-radius: 6px; font-size: 12px; font-weight: bold; margin-bottom: 15px; border: 1px dashed #fecaca;">
                    ⚠️ IMPORTANT: Enter the physical quantity using the UNIT SHOWN below (e.g. Jars, Bottles, Sacks). DO NOT type grams or mL. The system will convert it automatically!
                </div>
                <button id="btn_submit_dispatch_${key}" onclick="window.submitGroupedDispatch('${key}', '${encodeURIComponent(JSON.stringify(dispatch.items))}'); setTimeout(()=>window.loadStockRequestUI(), 2000);" style="width: 100%; background: #16a34a; color: white; border: none; padding: 15px; font-weight: bold; font-size: 15px; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 12px rgba(22,163,74,0.2); transition: 0.2s;">
                    📥 Confirm and Receive Complete Shipment
                </button>`;
        } else {
            actionHtml = `
                <div style="background: #eff6ff; color: #0369a1; border: 2px dashed #bae6fd; padding: 15px; text-align: center; font-weight: bold; border-radius: 8px; font-size: 14px;">
                    🚚 This shipment is still In Transit. The receiving controls will unlock once HQ/Driver marks it as "Arrived".
                </div>`;
        }

        let statusBadge = isArrived 
            ? `<span style="background:#dcfce7; color:#16a34a; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; display: inline-block;">📍 Status: Arrived</span>`
            : `<span style="background:#fef3c7; color:#d97706; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; display: inline-block;">🚚 Status: In Transit</span>`;

        html += `
            <div style="background: white; border: 2px solid #cbd5e1; padding: 20px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; align-items: center;">
                    <div>
                        <h3 style="margin: 0; color: #0f172a; font-size: 16px; letter-spacing: 0.3px;">📋 SHIPMENT DISPATCH TRACK SHEET</h3>
                        <span style="font-size: 12px; color: #64748b; font-weight: 500;">Dispatched: <strong>${dispatch.date} @ ${dispatch.time}</strong></span>
                    </div>
                    <div style="text-align: right;">
                        <div style="margin-bottom: 5px;">${statusBadge}</div>
                        <span style="background:#e0f2fe; color:#0369a1; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; display: inline-block;">Driver: ${dispatch.driver}</span>
                    </div>
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
                    <tbody>${itemsTableRows}</tbody>
                </table>
                ${actionHtml}
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
    
    // 🔥 THE FIX: Dynamically update the UOM dropdown based on the exact item selected!
    let uomDrop = document.getElementById('wasteUomSelect');
    if (uomDrop) {
        let bUom = item.uom || item.baseUom || 'Units';
        let pUom = item.purchaseUom || item.purchUom || 'Bulk';
        let conv = parseFloat(item.conversionRate) || parseFloat(item.conversion) || 1;

        if (bUom.toLowerCase() !== pUom.toLowerCase() && conv !== 1) {
            uomDrop.innerHTML = `
                <option value="purch" data-conv="${conv}">${pUom}</option>
                <option value="base" data-conv="1" selected>${bUom}</option>
            `;
        } else {
            uomDrop.innerHTML = `<option value="base" data-conv="1" selected>${bUom}</option>`;
        }
    }

    document.getElementById('wasteQty').focus(); // Automatically move cursor to the Qty box!
};

window.addWasteToCart = function() {
    let itemInput = document.getElementById('wasteSearchInput');
    let rawQty = parseFloat(document.getElementById('wasteQty').value);
    let reason = document.getElementById('wasteReason').value;
    let photoInput = document.getElementById('wastePhotoInput');

    if (!itemInput || !itemInput.value || isNaN(rawQty) || rawQty <= 0) {
        return Swal.fire('Error', 'Please select a valid item and enter a quantity.', 'error');
    }

    if (!photoInput.files || photoInput.files.length === 0) {
        return Swal.fire('Photo Required', 'Management requires a photo of the dropped/spoiled item before it can be submitted.', 'warning');
    }

    let itemName = itemInput.value.trim();
    let uomDrop = document.getElementById('wasteUomSelect');
    
    // 🔥 THE FIX: Extract UOMs safely from the newly selected item in memory
    let baseUom = window.selectedWasteItem ? (window.selectedWasteItem.uom || window.selectedWasteItem.baseUom || 'units') : 'units';
    let convRate = 1;
    let displayUom = baseUom;

    if (uomDrop && uomDrop.tagName === 'SELECT') {
        let selOpt = uomDrop.options[uomDrop.selectedIndex];
        convRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
        displayUom = selOpt.text;
    }

    let finalQty = rawQty * convRate; 

    if (typeof window.wasteCart === 'undefined') window.wasteCart = [];

    window.wasteCart.push({
        id: window.selectedWasteItem ? window.selectedWasteItem.id : null,
        name: itemName, 
        rawQty: rawQty, 
        displayUom: displayUom,
        baseQty: finalQty, 
        baseUom: baseUom, 
        reason: reason,
        file: photoInput.files[0], // Store the image file!
        cost: (window.selectedWasteItem ? (window.selectedWasteItem.baseCost || window.selectedWasteItem.cost) : 0) || 0
    });

    document.getElementById('wasteQty').value = '';
    itemInput.value = '';
    photoInput.value = ''; // Reset photo
    if(uomDrop) uomDrop.innerHTML = '<option value="base" data-conv="1">Units</option>';
    
    if (typeof window.renderWasteCart === 'function') window.renderWasteCart();
};

window.renderWasteCart = function() {
    let tbody = document.getElementById('wasteCartBody');
    let container = document.getElementById('wasteCartContainer');
    if (!tbody || !container) return;

    if (window.wasteCart.length > 0) {
        container.style.display = 'block';
        let html = '';
        window.wasteCart.forEach((item, idx) => {
            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0;">
                        <strong style="color: #0f172a;">${item.name}</strong> <span style="font-size: 10px; color: #16a34a;">(📸 Photo Attached)</span><br>
                        <span style="font-size: 11px; color: #dc2626;">Reason: ${item.reason}</span>
                    </td>
                    <td style="padding: 8px 0; text-align: right;">
                        <strong style="color: #dc2626;">${item.rawQty} ${item.displayUom}</strong>
                    </td>
                    <td style="padding: 8px 0; text-align: right;">
                        <button onclick="window.wasteCart.splice(${idx}, 1); window.renderWasteCart();" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: bold;">✖</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } else {
        container.style.display = 'none';
        tbody.innerHTML = '';
    }
};

window.submitWasteCart = async function() {
    if (!window.wasteCart || window.wasteCart.length === 0) return Swal.fire('Empty', 'Your waste list is empty.', 'info');

    let btn = document.getElementById('btnSubmitWasteCart');
    let origText = btn ? btn.innerText : "🗑️ Submit Waste to HQ for Approval";
    if(btn) { btn.innerText = "⏳ Uploading Photos to HQ..."; btn.disabled = true; }

    let branch = localStorage.getItem('takodeal_device_branch');
    let cashier = localStorage.getItem('cashierName') || 'Staff';

    try {
        let totalValueLost = 0;
        let uploadedItems = [];

        // 1. Upload all photos to Firebase Storage securely
        for (let item of window.wasteCart) {
            let photoUrl = "";
            if (item.file) {
                const fileExt = item.file.name.split('.').pop();
                const fileName = `waste_proofs/${branch}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                const storageReference = window.ref(window.storage, fileName);
                const snapshot = await window.uploadBytes(storageReference, item.file);
                photoUrl = await window.getDownloadURL(snapshot.ref);
            }

            let itemLoss = item.baseQty * item.cost;
            totalValueLost += itemLoss;

            uploadedItems.push({
                id: item.id, name: item.name, rawQty: item.rawQty, displayUom: item.displayUom,
                qty: item.baseQty, uom: item.baseUom, reason: item.reason, photoUrl: photoUrl
            });
        }

        // 2. Submit to the Manager's Staff Request Inbox
        // 🔥 THE ULTIMATE FIX: We create our own custom ID and use setDoc! NO ADDDOC ALLOWED!
        let customDocId = "waste_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        let newRequestRef = window.doc(window.db, "staff_requests", customDocId);
        
        await window.setDoc(newRequestRef, {
            type: "Waste Report",
            branch: branch,
            staffName: cashier,
            items: uploadedItems,
            totalValueLost: totalValueLost,
            status: "Pending",
            timestamp: window.serverTimestamp ? window.serverTimestamp() : new Date()
        });

        Swal.fire({
            title: '✅ Submitted for Approval', 
            text: `Sent ${window.wasteCart.length} item(s) and photos to the Manager App. Inventory will update once approved!`, 
            icon: 'success', 
            customClass: { popup: 'rounded-2xl' }
        });
        
        window.wasteCart = [];
        if (typeof window.renderWasteCart === 'function') window.renderWasteCart();
        
    } catch (e) {
        console.error("Waste Submit Error:", e);
        Swal.fire('Error', 'Failed to submit waste report. Check console for details.', 'error');
    } finally {
        if(btn) { btn.innerText = origText; btn.disabled = false; }
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
// 📅 BRANCH SCHEDULE ENGINE (WITH SWAP READINESS)
// ========================================================
window.loadBranchSchedule = async function() {
    const container = document.getElementById('cashierScheduleContainer');
    if (!container) return;
    
    let deviceBranch = localStorage.getItem('takodeal_device_branch');
    if (!deviceBranch) {
        container.innerHTML = '<div style="text-align:center; padding: 40px; color:#dc2626; font-weight:bold;">❌ Please lock this device to a branch first in the setup screen.</div>';
        return;
    }

    container.innerHTML = `<div style="text-align:center; padding: 40px; color:#64748b; font-size: 16px;">⏳ Fetching ${deviceBranch} schedule from HQ...</div>`;

    try {
        // Download the giant Global Schedule
        const schedSnap = await window.getDoc(window.doc(window.db, "settings", "global_schedule"));
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

        // 🔥 THE FIX: Beautiful fallback for test branches without shifts!
        if (!branchConfig[deviceBranch]) {
            container.innerHTML = `
                <div style="background: #f8fafc; padding: 40px; border-radius: 12px; border: 2px dashed #cbd5e1; text-align: center; margin-top: 20px;">
                    <span style="font-size: 45px; display: block; margin-bottom: 15px;">🏢</span>
                    <h3 style="margin: 0 0 10px 0; color: #334155; font-size: 20px;">No Shifts Configured</h3>
                    <p style="color: #64748b; font-size: 15px; margin: 0;">The Manager has not set up the schedule for <b>${deviceBranch}</b> yet.</p>
                </div>`;
            return;
        }

        if (!year || !month || Object.keys(schedule).length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color:#64748b;">The schedule for this month is currently empty.</div>';
            return;
        }

        const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
        let todayDay = new Date().getDate();
        let currentMonth = new Date().getMonth() + 1;

        let html = `
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                <div style="text-align: left;">
                    <h3 style="margin: 0; color: #0f766e; font-size: 20px;">📅 ${monthName} Schedule</h3>
                    <div style="font-size: 13px; color: #64748b; margin-top: 5px;">Showing all shifts for: <strong>📍 ${deviceBranch}</strong></div>
                </div>
                <div style="text-align: right;">
                    <button class="btn-refresh" onclick="window.loadBranchSchedule()" style="background: white; border: 1px solid #cbd5e1; padding: 8px 12px; border-radius: 6px; font-weight: bold; color: #334155; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔄 Refresh</button>
                </div>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 15px;">
        `;

        let activeShifts = branchConfig[deviceBranch].filter(s => s.active);

        // Loop through all days in the month
        for (let day = 1; day <= 31; day++) {
            if (!schedule[day] || !schedule[day][deviceBranch]) continue;
            
            let bData = schedule[day][deviceBranch];
            let dateObj = new Date(year, month - 1, day);
            let dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            let isToday = (day === todayDay && month === currentMonth);
            
            // Highlight card if it's today
            let cardBg = isToday ? '#f0fdf4' : 'white';
            let cardBorder = isToday ? '#16a34a' : '#cbd5e1';
            let headerBg = isToday ? '#16a34a' : '#f8fafc';
            let headerText = isToday ? 'white' : '#1e293b';

            let fullDateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            let holidayType = holidays[fullDateKey];
            let holBadge = holidayType ? `<span style="background: ${holidayType === 'Regular' ? '#fee2e2' : '#fef3c7'}; color: ${holidayType === 'Regular' ? '#dc2626' : '#ea580c'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 10px;">⭐ ${holidayType} Holiday</span>` : '';

            html += `
                <div style="background: ${cardBg}; border: 2px solid ${cardBorder}; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05);" ${isToday ? 'id="todayScheduleCard"' : ''}>
                    <div style="background: ${headerBg}; color: ${headerText}; padding: 10px 15px; font-weight: bold; display: flex; align-items: center; border-bottom: 1px solid ${cardBorder};">
                        ${isToday ? '⭐ TODAY: ' : ''}${dateStr} ${holBadge}
                    </div>
                    <div style="padding: 15px;">
            `;

            // Print the Active Shifts
            activeShifts.forEach(shift => {
                let assignedStaff = bData.scheduled[shift.id];
                
                // SWAP LOGIC HOOK
                let isSwapped = bData.swaps && bData.swaps[shift.id]; 
                let swapBadge = isSwapped ? `<span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 5px;" title="Swapped with ${isSwapped.originalStaff}">🔄 Swap</span>` : '';

                if (assignedStaff && assignedStaff !== "N/A") {
                    let staffColor = assignedStaff === "UNFILLED" ? "#ef4444" : "#0f766e";
                    let staffText = assignedStaff === "UNFILLED" ? "⚠️ Needs Staff" : `👤 ${assignedStaff}`;

                    html += `
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e2e8f0; padding: 8px 0;">
                            <div style="color: #475569; font-weight: bold; font-size: 14px;">
                                ${shift.name}
                                <div style="font-size: 11px; color: #94a3b8; font-weight: normal;">${shift.startTime || ''} - ${shift.endTime || ''}</div>
                            </div>
                            <div style="text-align: right;">
                                <strong style="color: ${staffColor}; font-size: 15px;">${staffText}</strong>
                                ${swapBadge}
                            </div>
                        </div>
                    `;
                }
            });

            // Print Standby and Off staff for awareness
            let restText = bData.rest.length > 0 ? bData.rest.join(', ') : 'None';
            html += `
                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding: 8px 0; font-size: 13px; margin-top: 5px;">
                    <span style="color: #64748b; font-weight: bold;">☕ Standby / Reliever:</span>
                    <span style="color: #d97706; font-weight: bold;">${restText}</span>
                </div>
            `;

            let offText = bData.unavailable.length > 0 ? bData.unavailable.map(u => `${u.name} (${u.status})`).join(', ') : 'None';
            html += `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px;">
                    <span style="color: #64748b; font-weight: bold;">🏖️ Off / Leave:</span>
                    <span style="color: #dc2626; font-weight: bold;">${offText}</span>
                </div>
            </div></div>
            `;
        }

        html += `</div>`; // Close grid container
        container.innerHTML = html;

        // Auto-scroll to today's schedule if it exists!
        setTimeout(() => {
            let todayCard = document.getElementById('todayScheduleCard');
            if (todayCard) {
                todayCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 500);

    } catch (e) {
        console.error("Error loading branch schedule:", e);
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
// 📦 INTERNAL STOCK REQUEST ENGINE (SMART VARIANCES & MODAL CART)
// ========================================================
window.stockReqItemsFlat = [];

window.saveReqDraft = function() {
    let selects = document.querySelectorAll('.req-type-select');
    if (selects.length === 0) return; 

    let draft = {};
    let count = 0;
    selects.forEach(select => {
        if (select.value && select.value !== "None") {
            let id = select.getAttribute('data-id');
            let countEl = document.getElementById(`actualCount_${id}`);
            let uomEl = document.getElementById(`actualUom_${id}`);
            
            draft[id] = {
                type: select.value,
                count: countEl ? countEl.value : "",
                uom: uomEl ? uomEl.value : "base"
            };
            count++;
        }
    });
    localStorage.setItem('takodeal_stock_req_draft', JSON.stringify(draft));
    
    let btnCart = document.getElementById('btnViewStockCart');
    if (btnCart) {
        btnCart.innerText = `🛒 View Cart (${count})`;
        if (count > 0) {
            btnCart.style.animation = "pulse 0.5s";
            setTimeout(() => btnCart.style.animation = "", 500);
        }
    }
};

// 🛒 FLOATING MODAL CART UI (WITH FULL DETAILS)
window.openStockReqCartModal = function() {
    let savedDraft = JSON.parse(localStorage.getItem('takodeal_stock_req_draft')) || {};
    let html = '';
    let hasItems = false;

    for (let id in savedDraft) {
        let req = savedDraft[id];
        if (req.type !== "None") {
            let itemData = window.stockReqItemsFlat.find(i => i.id === id);
            if (!itemData) continue;
            
            hasItems = true;
            let itemName = itemData.name;
            let qtyText = req.type === "Out of Stock" ? "0" : (req.count !== "" ? req.count : "<i style='color:#ef4444; font-weight: 900; font-size: 12px;'>Missing Count 🚨</i>");
            
            let pUom = itemData.purchaseUom || itemData.uom || 'units';
            let bUom = itemData.uom || 'units';
            let uomText = req.uom === "purch" ? pUom : bUom;

            let alertColor = req.type === "Out of Stock" ? "#dc2626" : "#d97706";
            let alertBg = req.type === "Out of Stock" ? "#fef2f2" : "#fffbeb";
            let alertBorder = req.type === "Out of Stock" ? "#fca5a5" : "#fcd34d";

            // 🔥 INJECTS FULL DETAILS (Current Stock & Reorder Level) INTO THE CART
            let reorderLvl = itemData.reorderLevel || itemData.lowStockAlert || 5;
            let sysStock = parseFloat(itemData.currentStock) || 0;
            let conv = parseFloat(itemData.conversionRate) || parseFloat(itemData.conversion) || 1;
            let displaySysStock = (req.uom === "purch") ? (sysStock / conv).toFixed(1) : sysStock.toFixed(1);

            html += `
                <div style="padding: 15px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: white; text-align: left;">
                    <div style="flex: 1;">
                        <strong style="color: #1e293b; font-size: 14px;">${itemName}</strong>
                        <div style="margin-top: 4px; display: flex; gap: 8px; align-items: center;">
                            <span style="background: ${alertBg}; color: ${alertColor}; border: 1px solid ${alertBorder}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">${req.type}</span>
                        </div>
                        <div style="font-size: 10px; color: #64748b; margin-top: 5px; font-weight: bold;">
                            System Expected: ${displaySysStock} ${uomText} | ⚠️ Reorder Level: ${reorderLvl} ${bUom}
                        </div>
                    </div>
                    <div style="text-align: right; color: #0284c7; font-weight: 900; font-size: 15px; margin-right: 15px;">
                        ${qtyText} <span style="font-size: 11px; color: #64748b; font-weight: normal;">${uomText}</span>
                    </div>
                    <button onclick="window.removeStockReqItem('${id}')" style="background: #fef2f2; color: #ef4444; border: 1px solid #fca5a5; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px; transition: 0.2s;" title="Remove Item">✖</button>
                </div>
            `;
        }
    }

    if (!hasItems) {
        return Swal.fire('Cart is Empty', 'Please mark items as Low Stock or Out of Stock from the list first.', 'info');
    }

    Swal.fire({
        title: '🛒 Request Cart',
        html: `<div style="max-height: 45vh; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">${html}</div>`,
        showCancelButton: true,
        confirmButtonText: '🚀 Send to HQ',
        cancelButtonText: 'Keep Editing',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b',
        customClass: { popup: 'rounded-2xl shadow-xl' }
    }).then((result) => {
        if (result.isConfirmed) {
            window.submitStockRequest();
        }
    });
};

window.removeStockReqItem = function(id) {
    let savedDraft = JSON.parse(localStorage.getItem('takodeal_stock_req_draft')) || {};
    
    if (savedDraft[id]) {
        delete savedDraft[id];
        localStorage.setItem('takodeal_stock_req_draft', JSON.stringify(savedDraft));
    }

    let selectEl = document.getElementById('reqType_' + id);
    if (selectEl) {
        selectEl.value = "None";
        if (typeof window.toggleActualCount === 'function') window.toggleActualCount(id);
    }

    let count = 0;
    for (let key in savedDraft) {
        if (savedDraft[key].type && savedDraft[key].type !== "None") count++;
    }
    let btnCart = document.getElementById('btnViewStockCart');
    if (btnCart) btnCart.innerText = `🛒 View Cart (${count})`;

    if (count > 0) {
        window.openStockReqCartModal();
    } else {
        Swal.close();
        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Cart cleared', showConfirmButton: false, timer: 1500 });
    }
};

// 🚨 PENDING/REJECTED MODAL UI ENGINES (WITH SECURITY LOCK)
window.openPendingModal = function(encodedOrders) {
    let pendingOrders = JSON.parse(decodeURIComponent(encodedOrders));
    let html = `<p style="font-size: 13px; color: #64748b; margin-top: 0; text-align: left;">You have ${pendingOrders.length} active request(s) pending review by HQ.</p>`;
    
    let currentCashier = localStorage.getItem('cashierName') || 'Staff';

    pendingOrders.forEach(order => {
        let dateStr = order.timestamp ? new Date(order.timestamp.seconds ? order.timestamp.seconds * 1000 : order.timestamp).toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Recent';
        
        order.items.forEach(i => {
            let liveItem = window.stockReqItemsFlat.find(live => live.id === i.sourceId || live.name === i.itemName);
            if (liveItem) {
                i.itemName = liveItem.name;
                if (i.selectedUom === 'purch' || i.displayUom === i.purchaseUom) {
                    i.displayUom = liveItem.purchaseUom || liveItem.uom;
                } else {
                    i.displayUom = liveItem.uom;
                }
            }
        });

        let pItemsHtml = order.items.map(i => `
            <div style="display:flex; justify-content:space-between; padding: 6px 0; border-bottom: 1px dashed #cbd5e1;">
                <span style="font-weight:bold; color:#334155; font-size:13px;">${i.itemName} <br><span style="color:#ef4444; font-size:10px;">(${i.requestType})</span></span>
                <strong style="color:#d97706; font-size:14px;">${i.displayQty} <span style="font-size:11px; color:#64748b;">${i.displayUom}</span></strong>
            </div>
        `).join('');

        let safeOrderStr = encodeURIComponent(JSON.stringify(order));
        
        // 🔥 SECURITY CHECK: Block editing/canceling if they didn't make the request!
        let actionButtonsHtml = '';
        if (order.requestedBy === currentCashier) {
            actionButtonsHtml = `
                <div style="display: flex; gap: 1px; border-top: 1px solid #cbd5e1;">
                    <button onclick="window.editPendingRequest('${safeOrderStr}')" style="flex:1; background: #0ea5e9; color: white; border: none; padding: 12px; font-weight: bold; cursor: pointer; font-size: 13px;">✏️ Edit Items</button>
                    <button onclick="window.cancelPendingRequest('${order.id}')" style="flex:1; background: #ef4444; color: white; border: none; padding: 12px; font-weight: bold; cursor: pointer; font-size: 13px;">✖ Cancel</button>
                </div>
            `;
        } else {
            actionButtonsHtml = `
                <div style="border-top: 1px solid #cbd5e1; padding: 12px; text-align: center; color: #94a3b8; font-size: 12px; font-weight: bold; background: #f1f5f9; font-style: italic;">
                    🔒 Locked (Requested by ${order.requestedBy})
                </div>
            `;
        }

        html += `
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 15px; overflow: hidden; text-align: left;">
                <div style="background: #e2e8f0; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase;">Requested By</div>
                        <div style="font-size: 14px; font-weight: 900; color: #0f172a;">👤 ${order.requestedBy || 'Staff'}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">⏰ ${dateStr}</div>
                    </div>
                    <div style="background: #fef3c7; color: #d97706; border: 1px solid #fcd34d; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;">
                        ${order.status === 'Drafting' ? 'Drafting (HQ)' : 'Pending HQ'}
                    </div>
                </div>
                <div style="padding: 10px 15px; max-height: 180px; overflow-y: auto;">
                    ${pItemsHtml}
                </div>
                ${actionButtonsHtml}
            </div>
        `;
    });

    Swal.fire({
        title: '⏳ Awaiting HQ Approval',
        html: `<div style="max-height: 65vh; overflow-y: auto; overflow-x: hidden; padding-right: 5px;">${html}</div>`,
        showConfirmButton: false,
        showCloseButton: true,
        customClass: { popup: 'rounded-2xl shadow-xl' }
    });
};

window.openRejectedModal = function(encodedOrders) {
    let rejectedOrders = JSON.parse(decodeURIComponent(encodedOrders));
    let html = `<p style="font-size: 13px; color: #64748b; margin-top: 0; text-align: left;">You have ${rejectedOrders.length} rejected request(s). You can load them back to the cart to fix errors, or dismiss them.</p>`;
    
    rejectedOrders.forEach(order => {
        let dateStr = order.timestamp ? new Date(order.timestamp.seconds ? order.timestamp.seconds * 1000 : order.timestamp).toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Recent';
        let safeOrderStr = encodeURIComponent(JSON.stringify(order));
        
        let pItemsHtml = order.items.map(i => `<div style="font-size: 12px; color: #334155; padding: 2px 0;">• ${i.displayQty} ${i.displayUom} <b>${i.itemName}</b></div>`).join('');

        html += `
            <div style="background: #fff1f2; border: 1px solid #fca5a5; border-radius: 8px; margin-bottom: 15px; overflow: hidden; text-align: left;">
                <div style="background: #fef2f2; padding: 10px 15px; border-bottom: 1px solid #fca5a5;">
                    <div style="font-size: 11px; font-weight: bold; color: #dc2626; text-transform: uppercase;">Manager's Note:</div>
                    <div style="font-size: 13px; color: #9f1239; font-style: italic; margin-bottom: 8px;">"${order.rejectReason || 'Please fix and resubmit.'}"</div>
                    <div style="font-size: 11px; color: #ef4444;">Requested by: <b>${order.requestedBy || 'Staff'}</b> at ${dateStr}</div>
                </div>
                <div style="padding: 10px 15px; max-height: 120px; overflow-y: auto;">${pItemsHtml}</div>
                <div style="display: flex; gap: 1px; border-top: 1px solid #fca5a5;">
                    <button onclick="window.editPendingRequest('${safeOrderStr}')" style="flex:1; background: #0ea5e9; color: white; border: none; padding: 10px; font-weight: bold; cursor: pointer; font-size: 12px;">✏️ Load Back & Fix</button>
                    <button onclick="window.acknowledgeRejectedRequest('${order.id}')" style="flex:1; background: #f8fafc; color: #475569; border: none; padding: 10px; font-weight: bold; cursor: pointer; font-size: 12px;">✖ Dismiss</button>
                </div>
            </div>
        `;
    });

    Swal.fire({
        title: '❌ HQ Rejected Requests',
        html: `<div style="max-height: 65vh; overflow-y: auto; overflow-x: hidden; padding-right: 5px;">${html}</div>`,
        showConfirmButton: false, showCloseButton: true,
        customClass: { popup: 'rounded-2xl shadow-xl border border-red-200' }
    });
};

window.acknowledgeRejectedRequest = async function(docId) {
    try {
        await updateDoc(doc(db, "purchase_orders", docId), { cashierAcknowledged: true });
        if (typeof Swal !== 'undefined') Swal.close();
        window.loadStockRequestUI(); 
    } catch(e) { console.error(e); }
};

window.cancelPendingRequest = async function(docId) {
    if (!confirm("Are you sure you want to permanently cancel this request?")) return;
    try {
        await deleteDoc(doc(db, "purchase_orders", docId));
        Swal.fire({title: 'Cancelled', text: 'Request has been safely cancelled.', icon: 'success', timer: 1500, showConfirmButton: false});
        if (typeof Swal !== 'undefined') Swal.close();
        window.loadStockRequestUI();
    } catch(e) { console.error(e); Swal.fire('Error', 'Failed to cancel.', 'error'); }
};

// 🔥 FIX: Instantly close previous modal using Swal.fire instead of confirm!
window.editPendingRequest = async function(encodedOrder) {
    let order = JSON.parse(decodeURIComponent(encodedOrder));
    
    let confirmEdit = await Swal.fire({
        title: 'Load Back to Cart?',
        text: 'This will pull this request back into your cart so you can edit the quantities. Proceed?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0ea5e9',
        confirmButtonText: 'Yes, Load it!'
    });

    if (!confirmEdit.isConfirmed) return;

    try {
        let draft = JSON.parse(localStorage.getItem('takodeal_stock_req_draft')) || {};
        order.items.forEach(i => {
            if (i.sourceId) {
                draft[i.sourceId] = { type: i.requestType, count: i.displayQty, uom: i.selectedUom || (i.displayUom === i.purchaseUom ? "purch" : "base") };
            }
        });
        localStorage.setItem('takodeal_stock_req_draft', JSON.stringify(draft));
        
        await deleteDoc(doc(db, "purchase_orders", order.id));
        
        if (typeof Swal !== 'undefined') Swal.close(); // Forces any background modal to vanish!
        
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Loaded back into your cart!', showConfirmButton: false, timer: 3000 });
        window.loadStockRequestUI();
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to load request into cart.', 'error');
    }
};

window.submitStockRequest = async function() {
    let branch = localStorage.getItem('takodeal_device_branch');
    let cashier = localStorage.getItem('cashierName') || 'Staff';
    let itemsToRequest = [];
    let fraudAlerts = []; 
    let uniqueItemCheck = new Set(); // 🛡️ Duplicate Prevention Engine

    let selects = document.querySelectorAll('.req-type-select');
    let hasMissingCount = false;

    selects.forEach(select => {
        if (select.value !== "None") {
            let id = select.getAttribute('data-id');
            let actualCountEl = document.getElementById(`actualCount_${id}`);
            
            // 🚨 VALIDATION 1: Prevent Missing Counts for Low Stock
            if (select.value === "Low Stock") {
                if (!actualCountEl || actualCountEl.value.trim() === "") {
                    hasMissingCount = true;
                    return; // Skip processing this item for now
                }
            }

            let itemData = window.stockReqItemsFlat.find(i => i.id === id);
            if (!itemData) return; 

            // 🚨 VALIDATION 2: Duplicate Interceptor
            if (uniqueItemCheck.has(itemData.id)) return;
            uniqueItemCheck.add(itemData.id);

            let uomSelectEl = document.getElementById(`actualUom_${id}`);
            let rawCount = actualCountEl && actualCountEl.value !== "" ? parseFloat(actualCountEl.value) : 0;
            let convRate = 1;
            let displayUom = itemData.uom;

            if (uomSelectEl && uomSelectEl.tagName === 'SELECT') {
                let selOpt = uomSelectEl.options[uomSelectEl.selectedIndex];
                convRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
                displayUom = selOpt.text;
            }

            let actualCount = rawCount * convRate; 
            let sysStock = parseFloat(select.getAttribute('data-sys')) || 0;

            if (select.value === "Low Stock" || select.value === "Out of Stock") {
                if (actualCount < (sysStock - 1)) {
                    let expectedInDisplayUom = sysStock / convRate;
                    fraudAlerts.push({ name: itemData.name, declared: rawCount, expected: expectedInDisplayUom, uom: displayUom });
                }
            }

            itemsToRequest.push({
                itemName: itemData.name, qty: 0, requestType: select.value, uom: itemData.uom, sourceId: itemData.id,
                systemStock: sysStock, physicalStock: actualCount, displayQty: rawCount, displayUom: displayUom,     
                category: itemData.category || "Ingredients", purchaseUom: itemData.purchaseUom || itemData.uom, convRate: itemData.conversionRate || 1
            });
        }
    });

    if (hasMissingCount) {
        return Swal.fire({
            title: 'Missing Count Detected 🚨', 
            text: 'You marked an item as "Low Stock" but forgot to enter the physical quantity. Please enter the count or remove it from the cart.', 
            icon: 'error',
            customClass: { popup: 'rounded-2xl' }
        });
    }

    if (itemsToRequest.length === 0) {
        return Swal.fire('Empty Request', 'Please mark at least one item as Low Stock or Out of Stock.', 'warning');
    }

    let btn = document.querySelector('button[onclick="window.submitStockRequest()"]') || document.querySelector('.swal2-confirm');
    let origText = btn ? btn.innerText : "🚀 Send Request to HQ";
    if (btn) { btn.innerText = "⏳ Sending..."; btn.disabled = true; }

    try {
        await addDoc(collection(db, "purchase_orders"), {
            branch: branch, 
            type: "Internal Request", 
            items: itemsToRequest, 
            status: "Pending", 
            requestedBy: cashier, 
            timestamp: new Date() 
        });

        for (let alert of fraudAlerts) {
            await addDoc(collection(db, "manager_alerts"), {
                type: "STOCK_REQUEST_FRAUD", branch: branch, cashier: cashier,
                message: `🕵️‍♂️ FRAUD ALERT: ${cashier} requested ${alert.name}. They declared they have ${alert.declared} ${alert.uom}, but the system expects ${alert.expected.toFixed(2)} ${alert.uom}. Possible missing stock!`,
                timestamp: new Date(), isRead: false
            });
        }

        localStorage.removeItem('takodeal_stock_req_draft');
        Swal.fire('✅ Sent to HQ!', 'Your stock request has been submitted securely.', 'success');
        window.loadStockRequestUI(); 
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to send request.', 'error');
    } finally {
        if (btn) { btn.innerText = origText; btn.disabled = false; }
    }
};

window.filterStockReq = function() {
    let input = document.getElementById('stockReqSearch').value.toLowerCase();
    let rows = document.querySelectorAll('.stock-req-row');
    let categories = document.querySelectorAll('.stock-req-category');

    rows.forEach(row => {
        if (row.getAttribute('data-name').includes(input)) {
            row.style.display = 'grid'; row.classList.add('visible-row');
        } else {
            row.style.display = 'none'; row.classList.remove('visible-row');
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
            
            let statusBg = '#f1f5f9'; let statusColor = '#475569';
            if (d.status === 'Pending') { statusBg = '#fef3c7'; statusColor = '#d97706'; }
            else if (d.status === 'Rejected') { statusBg = '#fee2e2'; statusColor = '#dc2626'; d.status = '❌ Rejected by HQ'; }
            else if (d.status === 'Drafting') { statusBg = '#bae6fd'; statusColor = '#0284c7'; d.status = 'Preparing (HQ)'; }
            else if (d.status === 'Approved' || d.status === 'In Transit') { statusBg = '#dcfce7'; statusColor = '#16a34a'; d.status = 'Dispatch on the way 🚚'; }
            else if (d.status === 'Completed') { statusBg = '#f1f5f9'; statusColor = '#64748b'; }
            else if (d.status === 'Partially Dispatched') { statusBg = '#e0e7ff'; statusColor = '#0284c7'; }
            else if (d.status === 'Delayed') { statusBg = '#fef2f2'; statusColor = '#dc2626'; d.status = 'Delayed (Out of Stock)'; }

            let modalItems = (d.items || []).map(i => {
                let itemStatus = 'Pending';
                if (d.status === 'Completed' || d.status === 'Dispatch on the way 🚚' || d.status === 'Partially Dispatched') {
                    itemStatus = 'Processed';
                } else if (d.status === 'Delayed (Out of Stock)' || d.status === 'Delayed') {
                    itemStatus = 'Out of Stock';
                } else if (d.status === '❌ Rejected by HQ') {
                    itemStatus = 'Rejected';
                }
                
                return { itemName: i.itemName, displayQty: i.displayQty, qty: i.qty, displayUom: i.displayUom, uom: i.uom, status: itemStatus };
            });

            let encodedItems = encodeURIComponent(JSON.stringify(modalItems));
            let itemsButton = `<button onclick="window.viewStockRequestItems('${encodedItems}')" style="background: white; border: 1px solid #cbd5e1; color: #0f766e; font-weight: bold; padding: 8px 12px; border-radius: 6px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.05); font-size: 13px; transition: 0.2s;">📦 View Items (${modalItems.length})</button>`;
            
            let msgHtml = d.managerMessage ? `<div style="margin-top: 8px; padding: 8px; background: white; border: 1px dashed #fca5a5; font-size: 11px; color: #b91c1c; border-radius: 6px;"><b>HQ Note:</b> ${d.managerMessage}</div>` : '';

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 15px 12px; color: #64748b; font-size: 13px; font-weight: bold;">${dateStr}</td>
                    <td style="padding: 15px 12px; font-weight: bold; color: #334155; font-size: 14px;">👤 ${d.requestedBy || 'Staff'}</td>
                    <td style="padding: 15px 12px;">
                        <span style="background: ${statusBg}; color: ${statusColor}; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block;">${d.status}</span>
                        ${msgHtml}
                    </td>
                    <td style="padding: 15px 12px;">${itemsButton}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="4" class="text-center" style="padding: 20px;">No requests found.</td></tr>';
    } catch(e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:red; padding: 20px;">Error loading history.</td></tr>';
    }
};

window.viewStockRequestItems = function(itemsJson) {
    let items = JSON.parse(decodeURIComponent(itemsJson));
    
    let html = `
    <div style="max-height: 60vh; overflow-y: auto; text-align: left;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead style="background: #f8fafc; position: sticky; top: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <tr>
                    <th style="padding: 12px; color: #475569; border-bottom: 2px solid #cbd5e1;">Item Description</th>
                    <th style="padding: 12px; color: #475569; border-bottom: 2px solid #cbd5e1; text-align: center;">Qty Requested</th>
                    <th style="padding: 12px; color: #475569; border-bottom: 2px solid #cbd5e1;">HQ Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    items.forEach(i => {
        let statusBadge = '';
        if (i.status === 'Processed') statusBadge = '<span style="color: #16a34a; background: #dcfce7; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">Processed</span>';
        else if (i.status === 'Out of Stock') statusBadge = '<span style="color: #dc2626; background: #fef2f2; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">Out of Stock</span>';
        else statusBadge = `<span style="color: #d97706; background: #fffbeb; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">${i.status || 'Pending'}</span>`;

        html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px; font-weight: bold; color: #1e293b;">${i.itemName}</td>
                <td style="padding: 12px; text-align: center; font-weight: bold; color: #0284c7;">${i.displayQty || i.qty || 0} <span style="font-size: 11px; color: #64748b;">${i.displayUom || i.uom || ''}</span></td>
                <td style="padding: 12px;">${statusBadge}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;

    Swal.fire({
        title: '📦 Requested Items',
        html: html, width: 700, showConfirmButton: true, confirmButtonText: 'Close Window',
        confirmButtonColor: '#64748b', customClass: { popup: 'rounded-2xl shadow-2xl' }
    });
};

window.loadStockRequestUI = async function() {
    let container = document.getElementById('stockReqList');
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) return;

    let oldCss = document.getElementById('historyOverflowFix');
    if (oldCss) oldCss.remove();
    document.head.insertAdjacentHTML('beforeend', `<style id="historyOverflowFix">td div[style*="color"], td ul { max-height: 150px; overflow-y: auto; padding-right: 5px; display: block; }</style>`);

    if (typeof window.listenToStockRequests === 'function') window.listenToStockRequests(branch);

    container = document.getElementById('stockReqList');

    try {
        const qBranch = query(collection(db, "inventory"), where("branch", "==", branch));
        const snapBranch = await getDocs(qBranch);

        const qHQ = query(collection(db, "inventory"), where("branch", "==", "Main Office"));
        const snapHQ = await getDocs(qHQ);
        let hqStockMap = {};
        snapHQ.forEach(doc => { hqStockMap[doc.data().name] = parseFloat(doc.data().currentStock || 0); });

        let itemsByCategory = {};
        snapBranch.forEach(docSnap => {
            let data = docSnap.data();
            if (data.allowRequest !== false) {
                let cat = data.category || "Uncategorized";
                if (!itemsByCategory[cat]) itemsByCategory[cat] = [];
                itemsByCategory[cat].push({ id: docSnap.id, ...data });
            }
        });

        window.stockReqItemsFlat = [];
        let html = '';

        Object.keys(itemsByCategory).sort().forEach(category => {
            html += `<div class="stock-req-category" style="background: #e2e8f0; padding: 10px 15px; font-weight: bold; color: #334155; margin-top: 10px; font-size: 14px; text-transform: uppercase; border-radius: 6px;">📁 ${category}</div>`;

            let items = itemsByCategory[category];
            items.sort((a, b) => a.name.localeCompare(b.name));

            items.forEach((item) => {
                window.stockReqItemsFlat.push(item);
                let conv = parseFloat(item.conversionRate) || parseFloat(item.conversion) || 1;
                
                let purchStock = parseFloat(item.currentStock || 0) / conv;
                let safeStockDisplay = purchStock.toFixed(2);
                let displayUomLabel = item.purchaseUom || item.purchUom || item.uom || 'units';

                let hqStock = hqStockMap[item.name] || 0;
                let hqStatus = hqStock > 0
                    ? `<span style="color: #16a34a; font-weight: bold; font-size: 10px; background: #dcfce7; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;">🟢 HQ HAS STOCK</span>`
                    : `<span style="color: #dc2626; font-weight: bold; font-size: 10px; background: #fee2e2; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px;">🔴 HQ OUT OF STOCK</span>`;

                let pUom = item.purchaseUom || item.uom || 'units';
                let bUom = item.uom || 'units';

                let uomOptions = '';
                if (pUom.toLowerCase() !== bUom.toLowerCase() && conv > 1) {
                    uomOptions += `<option value="purch" data-conv="${conv}">${pUom}</option>`;
                }
                uomOptions += `<option value="base" data-conv="1">${bUom}</option>`;

                // 🔥 THE FIX: Accurately display the Reorder Level in Purchase UOM to the Cashier!
                let reorderLevelBase = parseFloat(item.reorderLevel) || parseFloat(item.lowStockAlert) || 5;
                let reorderLevelPurch = reorderLevelBase / conv;
                
                // Check if current Purch Stock is lower than or equal to the Reorder Purch Stock
                let isCriticallyLow = purchStock <= reorderLevelPurch;
                let stockColor = isCriticallyLow ? '#ef4444' : '#334155';
                
                let reorderBadge = `<span style="font-size: 9px; color: ${isCriticallyLow ? '#dc2626' : '#d97706'}; margin-top: 4px; font-weight: bold; background: ${isCriticallyLow ? '#fef2f2' : '#fffbeb'}; border: 1px dashed ${isCriticallyLow ? '#fca5a5' : '#fcd34d'}; padding: 2px 4px; border-radius: 4px;">⚠️ Reorder Lvl: ${reorderLevelPurch.toFixed(2)} ${pUom}</span>`;

                html += `
                <div class="stock-req-row" data-name="${item.name.toLowerCase()}" style="display: grid; grid-template-columns: 2fr 1fr 1.5fr 1fr; gap: 10px; align-items: center; padding: 12px 10px; border-bottom: 1px solid #f1f5f9;">
                    <div style="font-weight: bold; color: #334155; font-size: 14px;">
                        ${item.name} <br>
                        ${hqStatus}
                    </div>
                    <div style="text-align: center; font-family: monospace; font-size: 13px; color: #64748b; display: flex; flex-direction: column;">
                        <strong style="font-size: 14px; color: ${stockColor};">${safeStockDisplay}</strong>
                        <span style="font-size: 10px; color: #94a3b8;">${displayUomLabel}</span>
                        ${reorderBadge}
                    </div>
                    <div>
                        <select id="reqType_${item.id}" class="input-box req-type-select" data-id="${item.id}" data-sys="${item.currentStock || 0}" style="border-color: #cbd5e1; font-weight: bold; color: #475569; padding: 8px; font-size: 12px; cursor: pointer; width: 100%; outline: none;" onchange="if(typeof window.toggleActualCount === 'function') window.toggleActualCount('${item.id}'); window.saveReqDraft();">
                            <option value="None">-- No Request --</option>
                            <option value="Low Stock">⚠️ Low Stock</option>
                            <option value="Out of Stock">❌ Out of Stock</option>
                            <option value="Stock Request">General Request</option>
                        </select>
                    </div>
                    <div>
                        <div id="actualCountContainer_${item.id}" style="display: none; align-items: center; gap: 5px;">
                            <input type="number" id="actualCount_${item.id}" placeholder="Count?" class="input-box" style="flex: 1; text-align: center; border-color: #fcd34d; background: #fffbeb; font-weight: bold; color: #d97706; padding: 8px; font-size: 13px; width: 100%; box-sizing: border-box; outline: none;" oninput="window.saveReqDraft()">
                            <select id="actualUom_${item.id}" style="padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; background: white; color: #64748b; font-weight: bold; outline: none; cursor: pointer;" onchange="window.saveReqDraft()">
                                ${uomOptions}
                            </select>
                        </div>
                    </div>
                </div>`;
            });
        });
        
        if (container) container.innerHTML = html;

        try {
            let savedDraft = JSON.parse(localStorage.getItem('takodeal_stock_req_draft'));
            if (savedDraft) {
                for (let id in savedDraft) {
                    let select = document.getElementById(`reqType_${id}`);
                    let countEl = document.getElementById(`actualCount_${id}`);
                    let uomEl = document.getElementById(`actualUom_${id}`);
                    
                    if (select && savedDraft[id].type && savedDraft[id].type !== "None") {
                        select.value = savedDraft[id].type;
                        if (typeof window.toggleActualCount === 'function') window.toggleActualCount(id);
                    }
                    if (countEl && savedDraft[id].count !== "") countEl.value = savedDraft[id].count;
                    if (uomEl && savedDraft[id].uom) uomEl.value = savedDraft[id].uom;
                }
            }
        } catch(e) {}

    } catch (e) {
        console.error(e); 
        if(container) container.innerHTML = '<div style="text-align:center; padding:20px; color:red;">Failed to load request data. Check console.</div>';
    }
};

// ==========================================
// 📡 REAL-TIME SYNC ENGINE (CRASH & VANISH FIX)
// ==========================================
window.stockReqPoUnsubscribe = null;

window.listenToStockRequests = function(branch) {
    if (window.stockReqPoUnsubscribe) window.stockReqPoUnsubscribe();

    const poQ = query(collection(db, "purchase_orders"), where("branch", "==", branch));
    
    window.stockReqPoUnsubscribe = onSnapshot(poQ, (poSnap) => {
        let allOrders = [];
        poSnap.forEach(docSnap => { allOrders.push({id: docSnap.id, ...docSnap.data()}); });
        
        // Sort in memory to guarantee newest items are at the top
        allOrders.sort((a, b) => {
            let tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime()) : 0;
            let tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime()) : 0;
            return tB - tA;
        });

        // 🔥 THE FIX: Gather ALL pending and rejected orders into arrays!
        let pendingOrders = allOrders.filter(o => o.status === "Pending" || o.status === "Drafting");
        let rejectedOrders = allOrders.filter(o => o.status === "Rejected" && !o.cashierAcknowledged);

        // 🔘 Update the UI Buttons instantly!
        let btnContainer = document.getElementById('stockReqDynamicBtns');
        if (btnContainer) {
            let pendingBtnHtml = '';
            if (rejectedOrders.length > 0) {
                let safeOrdersStr = encodeURIComponent(JSON.stringify(rejectedOrders));
                pendingBtnHtml = `<button onclick="window.openRejectedModal('${safeOrdersStr}')" style="background: #ef4444; color: white; border: none; padding: 12px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3); white-space: nowrap; animation: pulse 1.5s infinite;">❌ HQ Rejected (${rejectedOrders.length})</button>`;
            } else if (pendingOrders.length > 0) {
                let safeOrdersStr = encodeURIComponent(JSON.stringify(pendingOrders));
                pendingBtnHtml = `<button onclick="window.openPendingModal('${safeOrdersStr}')" style="background: #f59e0b; color: white; border: none; padding: 12px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3); white-space: nowrap;">⏳ Pending HQ (${pendingOrders.length})</button>`;
            }
            
            let draftCount = 0;
            try {
                let savedDraft = JSON.parse(localStorage.getItem('takodeal_stock_req_draft'));
                if (savedDraft) {
                    for (let id in savedDraft) {
                        if (savedDraft[id].type && savedDraft[id].type !== "None") draftCount++;
                    }
                }
            } catch(e) {}

            let cartBtnHtml = `<button onclick="window.openStockReqCartModal()" id="btnViewStockCart" style="background: #10b981; color: white; border: none; padding: 12px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3); white-space: nowrap;">🛒 View Cart (${draftCount})</button>`;
            btnContainer.innerHTML = pendingBtnHtml + cartBtnHtml;
        }
        
        // Ghost Vanish Fix
        let swalTitle = document.getElementById('swal2-title');
        if (swalTitle) {
            if (swalTitle.innerText.includes('Awaiting HQ Approval') && pendingOrders.length === 0) {
                if (typeof Swal !== 'undefined') { Swal.close(); Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Request status updated by HQ', showConfirmButton: false, timer: 3000 }); }
            }
            if (swalTitle.innerText.includes('HQ Rejected') && rejectedOrders.length === 0) {
                if (typeof Swal !== 'undefined') Swal.close();
            }
        }
    });
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

window.editPendingRequest = async function(encodedOrder) {
    let order = JSON.parse(decodeURIComponent(encodedOrder));
    if (!confirm("This will pull your request back into draft mode so you can edit the quantities. Continue?")) return;

    try {
        // 🔥 MERGE FIX: Safely merge into the existing cart instead of wiping it!
        let draft = JSON.parse(localStorage.getItem('takodeal_stock_req_draft')) || {};
        
        order.items.forEach(i => {
            if (i.sourceId) {
                draft[i.sourceId] = {
                    type: i.requestType,
                    count: i.displayQty,
                    uom: i.selectedUom || (i.displayUom === i.purchaseUom ? "purch" : "base")
                };
            }
        });
        
        localStorage.setItem('takodeal_stock_req_draft', JSON.stringify(draft));
        if (typeof Swal !== 'undefined') Swal.close();
        
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Loaded back into your cart!', 
            showConfirmButton: false, timer: 3000
        });
        
        window.loadStockRequestUI();
    } catch(e) {
        console.error(e); Swal.fire('Error', 'Failed to load request into cart.', 'error');
    }
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
// 📱 SIDEBAR AUTO-ARRANGEMENT ENGINE (SYNC & HIDE)
// ========================================================
window.applySidebarLayout = async function() {
    try {
        const docSnap = await window.getDoc(window.doc(window.db, "settings", "sidebar_layout"));
        if (docSnap.exists() && docSnap.data().tabs) {
            let layout = docSnap.data().tabs;
            let navMenu = document.querySelector('.nav-menu');
            if (!navMenu) return;
            
            layout.forEach(tabData => {
                let id = tabData.id;
                let el = document.getElementById(id);
                if (el) {
                    // 1. Move it into the correct order
                    navMenu.appendChild(el); 
                    
                    // 2. Hide it if the Manager turned it off!
                    if (tabData.isHidden) {
                        el.style.display = 'none';
                    } else {
                        el.style.display = 'flex'; // Sidebar items use flex layout
                    }
                }
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

// ========================================================
// 🔪 KITCHEN PREP TAB & HISTORY ENGINE
// ========================================================
window.switchPrepTab = function(tab) {
    // 🔥 THE FIX: Use 'flex' instead of 'block' so the side-by-side cart doesn't break!
    document.getElementById('prepTabNew').style.display = tab === 'New' ? 'flex' : 'none';
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
    if(!confirm(`⚠️ Are you sure you want to UNDO the prep batch for ${itemName}?\n\nThis will subtract ${varianceAmount} from prepared stock AND securely return the raw ingredients back to your vault.`)) return;
    
    try {
        let branch = localStorage.getItem('takodeal_device_branch');
        
        // 1. Fetch the exact log so we know exactly how many batches they made!
        const logRef = doc(db, "stock_logs", logId);
        const logSnap = await getDoc(logRef);
        
        if (!logSnap.exists()) {
            return Swal.fire('Error', 'This log has already been deleted.', 'error');
        }
        
        let logData = logSnap.data();
        let purchQtyToReturn = logData.purchQty || 1; // Grab the batch multiplier

        // 2. Deduct the finished product from the shelf
        const q = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", itemName));
        const snap = await getDocs(q);
        
        if(!snap.empty) {
            let itemRef = snap.docs[0].ref;
            let currentStock = parseFloat(snap.docs[0].data().currentStock) || 0;
            await updateDoc(itemRef, { currentStock: currentStock - varianceAmount });
        }

        // 3. 🔥 THE UPGRADE: Auto-replenish Raw Ingredients using the BOM!
        const bomQ = query(collection(db, "bom"), where("menuItem", "==", itemName));
        const bomSnap = await getDocs(bomQ);

        if (!bomSnap.empty) {
            for (let bomDoc of bomSnap.docs) {
                let recipe = bomDoc.data();
                let rawIngredient = recipe.ingredientName;
                let amountToReturn = (recipe.qty || 0) * purchQtyToReturn;

                const rawQ = query(collection(db, "inventory"), where("branch", "==", branch), where("name", "==", rawIngredient));
                const rawSnap = await getDocs(rawQ);

                if (!rawSnap.empty) {
                    let rawRef = rawSnap.docs[0].ref;
                    let rawData = rawSnap.docs[0].data();
                    let currentRawStock = parseFloat(rawData.currentStock) || 0;

                    // Add it back to the vault!
                    await updateDoc(rawRef, { currentStock: currentRawStock + amountToReturn });

                    // Log the replenishment in the ledger for the Manager
                    await addDoc(collection(db, "stock_logs"), {
                        branch: branch, item: rawIngredient, uom: rawData.uom || 'units',
                        oldQty: currentRawStock, newQty: currentRawStock + amountToReturn,
                        variance: amountToReturn,
                        type: "Kitchen Prep Undone",
                        note: `Returned raw ingredients from voided ${purchQtyToReturn} batch(es) of ${itemName}`,
                        user: localStorage.getItem('cashierName') || 'System', timestamp: serverTimestamp()
                    });
                }
            }
        }

        // 4. Delete the old log
        await deleteDoc(logRef); 
        
        Swal.fire({ title: '✅ Undone!', text: 'Prep batch reversed and raw ingredients returned to the vault.', icon: 'success', customClass: { popup: 'rounded-2xl' } });
        window.loadKitchenPrepHistory(); // Refresh table
        
    } catch(e) {
        console.error(e);
        Swal.fire('Error', 'Failed to undo prep batch. Check connection.', 'error');
    }
};

// ========================================================
// 🧹 DEDICATED CONSUMABLES & STORE USE ENGINE
// ========================================================
window.consumablesCart = [];
window.consumableCategories = ["Consumables", "Cleaning Supplies", "Packaging"]; 

window.loadConsumablesView = async function() {
    let grid = document.getElementById('consumablesItemGrid');
    let header = document.getElementById('consumablesCategoryHeader');
    if(!grid) return;
    
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b; font-weight:bold;">Fetching Store Supplies...</div>';

    try {
        const configSnap = await window.getDoc(window.doc(window.db, "settings", "global_pos_config"));
        if (configSnap.exists() && configSnap.data().consumableCats) {
            window.consumableCategories = configSnap.data().consumableCats.map(c => c.trim().toLowerCase());
        } else {
            window.consumableCategories = window.consumableCategories.map(c => c.toLowerCase());
        }

        let branch = localStorage.getItem('takodeal_device_branch');
        const q = window.query(window.collection(window.db, "inventory"), window.where("branch", "==", branch));
        const snap = await window.getDocs(q);

        let items = [];
        snap.forEach(doc => {
            let d = doc.data();
            let cat = (d.category || "").trim().toLowerCase();
            if (window.consumableCategories.includes(cat)) {
                items.push({ id: doc.id, ...d });
            }
        });

        items.sort((a,b) => a.name.localeCompare(b.name));

        let activeCats = [...new Set(items.map(i => i.category || 'Uncategorized'))];
        let catHtml = `<button class="cat-btn active" onclick="window.filterConsumables('All', this)">All Supplies</button>`;
        activeCats.forEach(c => {
            catHtml += `<button class="cat-btn" onclick="window.filterConsumables('${c}', this)">${c.toUpperCase()}</button>`;
        });
        header.innerHTML = catHtml;

        window.consumablesData = items;
        window.filterConsumables('All', header.firstElementChild);

    } catch (e) {
        console.error("Consumables Load Error:", e);
        grid.innerHTML = '<div style="grid-column: 1/-1; color: red; text-align: center;">Error loading consumables. Check connection.</div>';
    }
};

window.filterConsumables = function(category, btn) {
    if (btn) {
        document.querySelectorAll('#consumablesCategoryHeader .cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    
    let grid = document.getElementById('consumablesItemGrid');
    grid.innerHTML = '';
    
    let filtered = category === 'All' ? window.consumablesData : window.consumablesData.filter(i => i.category === category);
    
    if (filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8;">No items found.</div>';
        return;
    }

    filtered.forEach(item => {
        let stock = parseFloat(item.currentStock) || 0;
        
        // 🔥 THE FIX: GRAB ALL THE UOMS AND CONVERSION RATES!
        let bUom = item.uom || item.baseUom || 'units';
        let pUom = item.purchaseUom || item.purchUom || bUom;
        let conv = parseFloat(item.conversionRate) || parseFloat(item.conversion) || 1;

        let bgStyle = item.image ? `background-image: url('${item.image}');` : `background-color: #f1f5f9;`;

        grid.innerHTML += `
            <div class="item-card" onclick="window.addToConsumablesCart('${item.id}', '${item.name.replace(/'/g, "\\'")}', '${bUom}', '${pUom}', ${conv})">
                <div class="item-card-bg" style="${bgStyle}"></div>
                <div class="item-name-overlay">${item.name}<br><span style="color:#10b981; font-size: 11px;">Stock: ${stock.toFixed(1)} ${bUom}</span></div>
            </div>
        `;
    });
};

window.addToConsumablesCart = async function(id, name, bUom, pUom, conv) {
    
    // Build the Dropdown!
    let uomOptions = '';
    if (pUom.toLowerCase() !== bUom.toLowerCase() && conv > 1) {
        uomOptions += `<option value="purch" data-conv="${conv}">${pUom}</option>`;
    }
    uomOptions += `<option value="base" data-conv="1" selected>${bUom}</option>`;

    const { value: formValues } = await Swal.fire({
        title: 'Store Use',
        html: `
            <div style="color: #475569; font-size: 14px; margin-bottom: 15px;">How much <strong style="color: #0f172a;">${name}</strong> are you taking?</div>
            <div style="display: flex; gap: 10px; justify-content: center; align-items: stretch;">
                <input type="number" id="swalConsQty" class="swal2-input" placeholder="0" style="width: 100px; margin: 0; text-align: center; font-weight: bold; outline: none; border: 1px solid #cbd5e1;">
                <select id="swalConsUom" class="swal2-select" style="margin: 0; padding: 10px; font-weight: bold; cursor: pointer; border: 1px solid #cbd5e1; border-radius: 6px; outline: none;">
                    ${uomOptions}
                </select>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Add to Cart',
        confirmButtonColor: '#0ea5e9',
        customClass: { popup: 'rounded-2xl shadow-xl' },
        preConfirm: () => {
            let qty = parseFloat(document.getElementById('swalConsQty').value);
            if (isNaN(qty) || qty <= 0) {
                Swal.showValidationMessage('Please enter a valid quantity');
                return false;
            }
            let sel = document.getElementById('swalConsUom');
            let selOpt = sel.options[sel.selectedIndex];
            let cRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
            let displayUom = selOpt.text;
            
            return { rawQty: qty, displayUom: displayUom, baseQty: qty * cRate, bUom: bUom };
        }
    });

    if (!formValues) return;

    let existing = window.consumablesCart.find(i => i.id === id);
    if (existing) {
        existing.qty += formValues.baseQty;
        existing.displayMsg = `${existing.qty.toFixed(2)} ${formValues.bUom}`; // If they stack it, just show the base total
    } else {
        window.consumablesCart.push({ 
            id: id, 
            name: name, 
            uom: formValues.bUom, // Strict base unit used for deduction math
            qty: formValues.baseQty, // Strict base math for deduction math
            displayMsg: `${formValues.rawQty} ${formValues.displayUom}` // Friendly UI label
        });
    }
    window.renderConsumablesCart();
};

window.renderConsumablesCart = function() {
    let list = document.getElementById('consumablesCartList');
    if (window.consumablesCart.length === 0) {
        list.innerHTML = '<li style="padding: 30px; text-align: center; color: #aaa; font-style: italic;">Cart is empty.</li>';
        return;
    }
    let html = '';
    window.consumablesCart.forEach((item, index) => {
        let display = item.displayMsg || `${item.qty} ${item.uom}`;
        html += `
            <li class="cart-item" style="border-bottom: 1px solid #f1f5f9;">
                <div class="cart-item-desc"><span class="cart-item-name" style="color:#0f172a;">${item.name}</span></div>
                <div class="cart-item-qty" style="color: #0ea5e9; font-weight: 900;">${display}</div>
                <div class="cart-item-sub"><button class="btn-remove" onclick="window.consumablesCart.splice(${index}, 1); window.renderConsumablesCart();" style="background: #fef2f2; color:#dc2626; border:1px solid #fca5a5; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">✖</button></div>
            </li>
        `;
    });
    list.innerHTML = html;
};

window.submitConsumablesCart = async function() {
    if (window.consumablesCart.length === 0) {
        return Swal.fire('Empty', 'Cart is empty.', 'info');
    }

    const confirmResult = await Swal.fire({
        title: 'Confirm Store Use',
        text: 'This will directly deduct these items from Live Inventory. It will NOT be recorded as a sale.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Log it!',
        confirmButtonColor: '#0ea5e9',
        customClass: { popup: 'rounded-2xl' }
    });

    if (!confirmResult.isConfirmed) return;

    let btn = document.getElementById('btnSubmitConsumables');
    btn.innerText = "⏳ Processing..."; btn.disabled = true;

    let branch = localStorage.getItem('takodeal_device_branch');
    let cashier = localStorage.getItem('cashierName') || 'Staff';

    try {
        for (let item of window.consumablesCart) {
            const invRef = window.doc(window.db, "inventory", item.id);
            const invSnap = await window.getDoc(invRef);
            if (invSnap.exists()) {
                let stock = parseFloat(invSnap.data().currentStock) || 0;
                await window.updateDoc(invRef, { currentStock: stock - item.qty });

                // 🔥 Fix: Using JS Date to avoid the Firebase serverTimestamp glitch!
                await window.addDoc(window.collection(window.db, "stock_logs"), {
                    branch: branch,
                    item: item.name,
                    uom: item.uom,
                    oldQty: stock,
                    newQty: stock - item.qty,
                    variance: -item.qty,
                    type: "Store Use",
                    note: "Consumables taken for branch use",
                    user: cashier,
                    timestamp: new Date() 
                });
            }
        }

        await window.addDoc(window.collection(window.db, "store_use_logs"), {
            branch: branch,
            loggedBy: cashier,
            items: window.consumablesCart,
            timestamp: new Date()
        });

        window.consumablesCart = [];
        window.renderConsumablesCart();
        window.loadConsumablesView(); // Refreshes grid stock instantly
        
        Swal.fire({ title: '✅ Success', text: 'Items successfully logged and deducted from inventory.', icon: 'success', customClass: { popup: 'rounded-2xl' }});

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to log consumables.', 'error');
    } finally {
        btn.innerHTML = "📦 Log & Deduct Inventory"; btn.disabled = false;
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
        let cashierName = (window.sessionUser && window.sessionUser.cashierName) ? window.sessionUser.cashierName : (localStorage.getItem('cashierName') || 'Unknown');

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

        let unverifiedDigitalCount = 0;

        txSnap.forEach(docSnap => {
            let tx = docSnap.data();
            if (tx.status !== 'Voided') {
                
                // 🚨 CHECK IF MANAGER HAS VERIFIED DIGITAL PAYMENTS
                if (tx.paymentMethod && tx.paymentMethod.toLowerCase() !== 'cash' && tx.paymentVerified !== true) {
                    unverifiedDigitalCount++;
                }

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

        // 🚨 UNVERIFIED DIGITAL PAYMENTS WARNING (SOFT LOCK) 🚨
        if (unverifiedDigitalCount > 0) {
            let proceed = await Swal.fire({
                title: '⚠️ Unverified Payments', 
                html: `You have <b style="color:#d97706; font-size:18px;">${unverifiedDigitalCount} unverified digital payment(s)</b>.<br><br>You may end your shift, but these will carry over and remain flagged in the system. The Manager will audit them tomorrow morning.`, 
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'End Shift Anyway',
                cancelButtonText: 'Wait, let me check',
                confirmButtonColor: '#d97706',
                cancelButtonColor: '#64748b',
                customClass: { popup: 'rounded-2xl shadow-2xl' }
            });
            
            // If they click "Wait", abort the closing process
            if (!proceed.isConfirmed) {
                let confirmBtn = document.querySelector('#endShiftModal .btn-place') || document.querySelector('button[onclick*="MASTER_CloseShift"]');
                if (confirmBtn) { confirmBtn.innerText = "🛑 Confirm & End Shift"; confirmBtn.disabled = false; }
                return;
            }
        }

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

        // 👑 7.5 FRANCHISE ROYALTY & PROFIT SHARING ENGINE
        try {
            const bQ = query(collection(db, "branches"), where("name", "==", branchName));
            const bSnap = await getDocs(bQ);
            let royaltyPct = 0;
            if (!bSnap.empty) royaltyPct = parseFloat(bSnap.docs[0].data().royaltyPercent) || 0;

            if (royaltyPct > 0) {
                // Calculate royalty against total gross digital + cash sales
                let totalGrossForRoyalty = totalCashSales + totalDigitalSales;
                let royaltyAmount = totalGrossForRoyalty * (royaltyPct / 100);

                if (royaltyAmount > 0) {
                    // 1. Log the Expense against the Franchise Branch so their P&L is accurate
                    await addDoc(collection(db, "expenses"), {
                        branch: branchName, 
                        amount: royaltyAmount, 
                        category: "Franchise Royalty Fee",
                        account: "System Auto-Deduct", 
                        note: `Auto-Deducted ${royaltyPct}% Royalty from ₱${totalGrossForRoyalty.toFixed(2)} Total Sales`,
                        timestamp: serverTimestamp()
                    });

                    // 2. Route the funds directly to the Main Office "Owner's Equity" Account!
                    const eqQ = query(collection(db, "cash_accounts"), where("branch", "==", "Main Office"), where("name", "==", "Owner's Equity"));
                    const eqSnap = await getDocs(eqQ);
                    
                    if (!eqSnap.empty) {
                        let eqDoc = eqSnap.docs[0];
                        let newBal = (parseFloat(eqDoc.data().balance) || 0) + royaltyAmount;
                        await updateDoc(eqDoc.ref, { balance: newBal });
                        await addDoc(collection(db, "account_logs"), {
                            accountId: eqDoc.id, accountName: "Owner's Equity", branch: "Main Office", action: "Royalty Collection",
                            amount: royaltyAmount, newBalance: newBal, user: "System Auto-Sweep", timestamp: serverTimestamp(), note: `From ${branchName} Z-Reading`
                        });
                    } else {
                        // Create the account if it's the very first time!
                        const newEqRef = await addDoc(collection(db, "cash_accounts"), { branch: "Main Office", name: "Owner's Equity", balance: royaltyAmount, createdAt: serverTimestamp() });
                        await addDoc(collection(db, "account_logs"), {
                            accountId: newEqRef.id, accountName: "Owner's Equity", branch: "Main Office", action: "Royalty Collection (Account Created)",
                            amount: royaltyAmount, newBalance: royaltyAmount, user: "System Auto-Sweep", timestamp: serverTimestamp(), note: `From ${branchName} Z-Reading`
                        });
                    }
                }
            }
        } catch(e) { console.error("Royalty Engine Error:", e); }

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

window.updateWasteUomLabel = async function() {
    let itemInput = document.getElementById('wasteSearchInput');
    let uomDrop = document.getElementById('wasteUomSelect');
    if (!itemInput || !uomDrop || !itemInput.value) return;

    let itemName = itemInput.value.trim();
    let branch = localStorage.getItem('takodeal_device_branch');

    try {
        // Direct live lookup to guarantee we get the exact UOMs!
        const q = window.query(window.collection(window.db, "inventory"), window.where("branch", "==", branch), window.where("name", "==", itemName));
        const snap = await window.getDocs(q);

        if (!snap.empty) {
            let item = snap.docs[0].data();
            let bUom = item.uom || item.baseUom || 'units';
            let pUom = item.purchaseUom || item.purchUom || 'Bulk';
            let conv = parseFloat(item.conversionRate) || parseFloat(item.conversion) || 1;
            
            // Only show two options if they are actually different!
            if (bUom.toLowerCase() !== pUom.toLowerCase() && conv !== 1) {
                uomDrop.innerHTML = `<option value="purch" data-conv="${conv}">${pUom}</option><option value="base" data-conv="1">${bUom}</option>`;
            } else {
                uomDrop.innerHTML = `<option value="base" data-conv="1">${bUom}</option>`;
            }
            
            // Store conversion in memory for the Add To Cart function
            window.currentWasteItemConv = conv;
            window.currentWasteItemBUom = bUom;
            window.currentWasteItemPUom = pUom;
            window.currentWasteItemId = snap.docs[0].id;
        }
    } catch(e) {}
};

// Override the Add To Cart function to support the UOM conversion
window.addWasteToCart = function() {
    let itemInput = document.getElementById('wasteSearchInput');
    let rawQty = parseFloat(document.getElementById('wasteQty').value);
    let reason = document.getElementById('wasteReason').value;

    if (!itemInput || !itemInput.value || isNaN(rawQty) || rawQty <= 0) {
        return Swal.fire('Error', 'Please select a valid item and enter a quantity.', 'error');
    }

    let itemName = itemInput.value.trim();
    let uomDrop = document.getElementById('wasteUomSelect');
    
    let convRate = 1;
    let displayUom = window.currentWasteItemBUom || 'units';
    let baseUom = window.currentWasteItemBUom || 'units';

    if (uomDrop && uomDrop.tagName === 'SELECT') {
        let selOpt = uomDrop.options[uomDrop.selectedIndex];
        convRate = parseFloat(selOpt.getAttribute('data-conv')) || 1;
        displayUom = selOpt.text;
    }

    let finalQty = rawQty * convRate; 

    if (typeof window.wasteCart === 'undefined') window.wasteCart = [];

    window.wasteCart.push({
        id: window.currentWasteItemId || null,
        name: itemName,
        rawQty: rawQty,
        displayUom: displayUom,
        baseQty: finalQty,
        baseUom: baseUom,
        reason: reason
    });

    // Clear Inputs
    document.getElementById('wasteQty').value = '';
    itemInput.value = '';
    if(uomDrop) uomDrop.innerHTML = '<option value="base" data-conv="1">Units</option>';
    
    // Render Cart
    if (typeof window.renderWasteCart === 'function') window.renderWasteCart();
};

window.renderWasteCart = function() {
    let tbody = document.getElementById('wasteCartBody');
    let container = document.getElementById('wasteCartContainer');
    
    if (!tbody || !container) return;

    if (window.wasteCart.length > 0) {
        container.style.display = 'block';
        let html = '';
        window.wasteCart.forEach((item, idx) => {
            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0;">
                        <strong style="color: #0f172a;">${item.name}</strong><br>
                        <span style="font-size: 11px; color: #dc2626;">Reason: ${item.reason}</span>
                    </td>
                    <td style="padding: 8px 0; text-align: right;">
                        <strong style="color: #dc2626;">-${item.rawQty} ${item.displayUom}</strong><br>
                        <span style="font-size: 10px; color: #64748b;">(Deducts ${item.baseQty} ${item.baseUom})</span>
                    </td>
                    <td style="padding: 8px 0; text-align: right;">
                        <button onclick="window.wasteCart.splice(${idx}, 1); window.renderWasteCart();" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: bold;">✖</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } else {
        container.style.display = 'none';
        tbody.innerHTML = '';
    }
};

window.submitWasteCart = async function() {
    if (!window.wasteCart || window.wasteCart.length === 0) return Swal.fire('Empty', 'Your waste list is empty.', 'info');

    let btn = document.getElementById('btnSubmitWasteCart');
    let origText = btn ? btn.innerText : "Permanently Deduct All Items";
    if(btn) { btn.innerText = "⏳ Processing..."; btn.disabled = true; }

    let branch = localStorage.getItem('takodeal_device_branch');
    let cashier = localStorage.getItem('cashierName') || 'Staff';

    try {
        for (let item of window.wasteCart) {
            // Fetch current stock directly so we don't accidentally overwrite with stale data
            let q = window.query(window.collection(window.db, "inventory"), window.where("branch", "==", branch), window.where("name", "==", item.name));
            let snap = await window.getDocs(q);
            
            if (!snap.empty) {
                let invDoc = snap.docs[0];
                let currentStock = parseFloat(invDoc.data().currentStock) || 0;
                let newStock = currentStock - item.baseQty;

                await window.updateDoc(invDoc.ref, { currentStock: newStock });

                await window.addDoc(window.collection(window.db, "stock_logs"), {
                    branch: branch,
                    item: item.name,
                    uom: item.baseUom,
                    oldQty: currentStock,
                    newQty: newStock,
                    variance: -item.baseQty,
                    displayQty: item.rawQty,
                    displayUom: item.displayUom,
                    type: "Waste / Spoilage",
                    note: item.reason,
                    user: cashier,
                    timestamp: new Date()
                });
            }
        }

        Swal.fire('✅ Waste Logged', `Successfully deducted ${window.wasteCart.length} items from inventory.`, 'success');
        
        window.wasteCart = [];
        window.renderWasteCart();
        
        if (typeof window.loadWasteHistory === 'function') window.loadWasteHistory();

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'Failed to process waste. Check internet connection.', 'error');
    } finally {
        if(btn) { btn.innerText = origText; btn.disabled = false; }
    }
};

// ==========================================
// 📢 FORCED COMPLIANCE CAROUSEL ENGINE
// ==========================================
window.activeAnnouncements = [];
window.currentBulletinIndex = 0;
window.currentSlideIndex = 0;
window.hasSignedBulletin = false;

window.checkForAnnouncements = async function(cashierName) {
    try {
        // 1. Get ALL active announcements
        const q = window.query(window.collection(window.db, "announcements"), window.where("active", "==", true));
        const snap = await window.getDocs(q);
        
        let unread = [];
        for (let docSnap of snap.docs) {
            // 2. Did THIS specific cashier sign it?
            const ackQ = window.query(window.collection(window.db, "acknowledgments"), 
                window.where("announcementId", "==", docSnap.id),
                window.where("staffName", "==", cashierName)
            );
            const ackSnap = await window.getDocs(ackQ);
            
            if (ackSnap.empty) {
                unread.push({ id: docSnap.id, ...docSnap.data() });
            }
        }

        if (unread.length > 0) {
            window.activeAnnouncements = unread;
            window.currentBulletinIndex = 0;
            window.openBulletinModal();
        }
    } catch(e) { console.error("Announcement Check Error:", e); }
};

window.openBulletinModal = function() {
    let announcement = window.activeAnnouncements[window.currentBulletinIndex];
    if (!announcement) return;

    document.getElementById('bulletinModal').style.display = 'flex';
    document.getElementById('bulletinTitle').innerText = announcement.title || "Important Announcement";
    
    // 🔥 Inject the new message description
    let msgEl = document.getElementById('bulletinMessage');
    if (msgEl) {
        if (announcement.message && announcement.message.trim() !== "") {
            msgEl.innerText = announcement.message;
            msgEl.style.display = 'block';
        } else {
            msgEl.style.display = 'none'; // Hide if no message was typed
        }
    }

    window.currentSlideIndex = 0;
    
    // Wake up the signature pad!
    setTimeout(() => { window.initBulletinSignaturePad(); }, 300);
    
    window.renderBulletinSlide();
};

window.renderBulletinSlide = function() {
    let announcement = window.activeAnnouncements[window.currentBulletinIndex];
    let totalSlides = announcement.images.length;
    let currentImage = announcement.images[window.currentSlideIndex];

    document.getElementById('bulletinImage').src = currentImage;
    document.getElementById('bulletinProgress').innerText = `Slide ${window.currentSlideIndex + 1} of ${totalSlides}`;
    
    // Set the Download Button link directly to the current image
    let dlBtn = document.getElementById('btnBulletinDownload');
    dlBtn.onclick = () => window.open(currentImage, '_blank');

    let btnNext = document.getElementById('btnBulletinNext');
    let btnAck = document.getElementById('btnBulletinAcknowledge');
    let sigArea = document.getElementById('bulletinSignatureArea');

    if (window.currentSlideIndex >= totalSlides - 1) {
        // LAST SLIDE! Hide "Next", show "Acknowledge" and Signature Pad!
        btnNext.style.display = 'none';
        btnAck.style.display = 'block';
        sigArea.style.display = 'block';
    } else {
        btnNext.style.display = 'block';
        btnAck.style.display = 'none';
        sigArea.style.display = 'none';
    }
};

window.nextBulletinSlide = function() {
    let announcement = window.activeAnnouncements[window.currentBulletinIndex];
    if (window.currentSlideIndex < announcement.images.length - 1) {
        window.currentSlideIndex++;
        window.renderBulletinSlide();
    }
};

// --- THE INDEPENDENT SIGNATURE PAD (OFFSET FIX) ---
window.initBulletinSignaturePad = function() {
    let oldCanvas = document.getElementById('bulletinCanvas');
    if (!oldCanvas) return;
    
    let newCanvas = oldCanvas.cloneNode(true);
    oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
    
    // 🔥 THE FIX: Sync internal resolution to CSS display size to fix the offset!
    newCanvas.width = newCanvas.offsetWidth;
    newCanvas.height = newCanvas.offsetHeight;
    
    const ctx = newCanvas.getContext('2d');
    let isDrawing = false;
    window.hasSignedBulletin = false;
    ctx.clearRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f766e';

    const startPosition = (e) => { isDrawing = true; window.hasSignedBulletin = true; draw(e); };
    const stopPosition = () => { isDrawing = false; ctx.beginPath(); };
    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault(); // Stops the tablet screen from scrolling
        
        let x, y;
        const rect = newCanvas.getBoundingClientRect();
        
        // Calculate the scale difference to perfectly track the finger!
        const scaleX = newCanvas.width / rect.width;
        const scaleY = newCanvas.height / rect.height;

        if (e.type.includes('touch')) {
            x = (e.touches[0].clientX - rect.left) * scaleX;
            y = (e.touches[0].clientY - rect.top) * scaleY;
        } else {
            x = (e.clientX - rect.left) * scaleX;
            y = (e.clientY - rect.top) * scaleY;
        }
        ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y);
    };

    newCanvas.addEventListener('mousedown', startPosition);
    newCanvas.addEventListener('mousemove', draw);
    newCanvas.addEventListener('mouseup', stopPosition);
    newCanvas.addEventListener('mouseout', stopPosition);
    newCanvas.addEventListener('touchstart', startPosition, { passive: false });
    newCanvas.addEventListener('touchmove', draw, { passive: false });
    newCanvas.addEventListener('touchend', stopPosition);
};

window.clearBulletinSignature = function() {
    const canvas = document.getElementById('bulletinCanvas');
    if (canvas) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); window.hasSignedBulletin = false; }
};

// --- SUBMITTING COMPLIANCE (FIXED) ---
window.submitBulletinAcknowledgment = async function() {
    if (!window.hasSignedBulletin) {
        return Swal.fire('Signature Required', 'You must sign the pad to acknowledge reading this announcement.', 'error');
    }

    let btn = document.getElementById('btnBulletinAcknowledge');
    btn.innerText = "⏳ Saving..."; btn.disabled = true;

    try {
        const canvas = document.getElementById('bulletinCanvas');
        const signatureBase64 = canvas.toDataURL('image/png');
        let announcement = window.activeAnnouncements[window.currentBulletinIndex];
        let cashier = localStorage.getItem('cashierName') || 'Staff';

        // 1. Save Signature to Database
        await addDoc(collection(db, "acknowledgments"), {
            announcementId: announcement.id,
            staffName: cashier,
            signature: signatureBase64,
            // 🔥 THE FIX: Use standard JavaScript Date so Firebase doesn't panic
            timestamp: new Date() 
        });

        // 2. Move to the next unread announcement, or close if finished!
        window.currentBulletinIndex++;
        if (window.currentBulletinIndex < window.activeAnnouncements.length) {
            window.clearBulletinSignature();
            window.openBulletinModal();
            btn.innerText = "✅ Sign & Acknowledge"; btn.disabled = false;
        } else {
            // Because we lowered the z-index, this alert will now pop up perfectly on top!
            Swal.fire({title: 'All Caught Up!', text: 'Thank you for reviewing the updates.', icon: 'success', timer: 2000, showConfirmButton: false, customClass: { popup: 'rounded-2xl' }});
            document.getElementById('bulletinModal').style.display = 'none';
        }

    } catch (e) {
        console.error(e); Swal.fire('Error', 'Failed to save signature. Check connection.', 'error');
        btn.innerText = "✅ Sign & Acknowledge"; btn.disabled = false;
    }
};

// ========================================================
// 🚨 PERSISTENT 48-HOUR UNVERIFIED PAYMENT ALARM
// ========================================================
window.startUnverifiedListener = function() {
    setInterval(async () => {
        try {
            let branch = localStorage.getItem('takodeal_device_branch');
            if (!branch) return;

            let currentShiftId = localStorage.getItem('currentShiftId');
            let salesTab = document.getElementById('nav-sales'); 
            let existingBanner = document.getElementById('globalUnverifiedBanner');

            // Look back 48 hours to catch yesterday's unverified payments!
            let lookBack = new Date();
            lookBack.setHours(lookBack.getHours() - 48);

            const txQ = window.query(
                window.collection(window.db, "transactions"), 
                window.where("branch", "==", branch),
                window.where("timestamp", ">=", lookBack)
            );
            const txSnap = await window.getDocs(txQ);
            
            let unverifiedCount = 0;
            let currentShiftUnverified = 0;
            let gcashTotal = 0;
            let grabTotal = 0;

            txSnap.forEach(doc => {
                let tx = doc.data();
                if (tx.status !== 'Voided') {
                    let method = (tx.paymentMethod || '').toLowerCase();
                    let amount = parseFloat(tx.netTotal) || 0;

                    // Only sum GCash/Grab math for the CURRENT shift
                    if (tx.shiftId === currentShiftId) {
                        if (method === 'gcash') gcashTotal += amount;
                        if (method === 'grab') grabTotal += amount;
                    }

                    // Check verification for ANY transaction in the last 48 hours
                    if (method !== 'cash' && method !== '' && tx.paymentVerified !== true) {
                        unverifiedCount++;
                        if (tx.shiftId === currentShiftId) currentShiftUnverified++;
                    }
                }
            });

            // Update the sidebar math with current shift totals
            if (currentShiftId) {
                document.querySelectorAll('*').forEach(el => {
                    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) { 
                        if (el.innerText.includes('Grab: ₱')) {
                            el.innerText = `Grab: ₱${grabTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                        }
                        if (el.innerText.includes('GCash: ₱') || el.innerText.includes('Gcash: ₱')) {
                            el.innerText = `GCash: ₱${gcashTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                        }
                    }
                });
            }

            // Handle the Red Sidebar Tab (Only blinks if the CURRENT shift has unverified items)
            if (currentShiftUnverified > 0 && currentShiftId) {
                if (salesTab) {
                    salesTab.innerHTML = `<span style="font-size: 20px; animation: pulse 1s infinite;">🚨</span><div class="nav-item-text" style="color: #dc2626; font-weight: 900; animation: pulse 1s infinite;">Shift Sales (${currentShiftUnverified})</div>`;
                    salesTab.style.background = '#fef2f2';
                    salesTab.style.borderLeftColor = '#dc2626';
                }
            } else {
                if (salesTab) {
                    salesTab.innerHTML = `<span>🧾</span><div class="nav-item-text">Shift Sales</div>`;
                    salesTab.style.background = '';
                    salesTab.style.borderLeftColor = '';
                }
            }

            // Handle the Global Floating Banner (Shows if ANY payment in 48 hours is unverified!)
            if (unverifiedCount > 0 && !window.hideUnverifiedBanner) {
                if (!existingBanner) {
                    existingBanner = document.createElement('div');
                    existingBanner.id = 'globalUnverifiedBanner';
                    existingBanner.style.cssText = "position: fixed; top: 15px; left: 50%; transform: translateX(-50%); background: #fff1f2; color: #dc2626; border: 2px dashed #fca5a5; padding: 10px 20px; border-radius: 50px; font-weight: bold; display: flex; gap: 15px; align-items: center; box-shadow: 0 10px 25px rgba(220, 38, 38, 0.4); z-index: 999999;";
                    document.body.appendChild(existingBanner);
                }
                
                existingBanner.innerHTML = `
                    <span style="font-size:24px; animation: pulse 1s infinite; cursor: pointer;" onclick="if(typeof Swal !== 'undefined') Swal.fire('Action Required', 'The Manager must verify these digital payments in the HQ App.', 'warning')">🚨</span>
                    <div style="text-align: center; cursor: pointer;" onclick="if(typeof Swal !== 'undefined') Swal.fire('Action Required', 'The Manager must verify these digital payments in the HQ App.', 'warning')">
                        <div style="font-size:14px; font-weight:900;">ACTION REQUIRED: ${unverifiedCount} Unverified Payment(s)!</div>
                    </div>
                    <span onclick="document.getElementById('globalUnverifiedBanner').style.display='none'; window.hideUnverifiedBanner=true;" style="font-size: 24px; cursor: pointer; color: #9f1239; padding-left: 10px; font-weight: bold; transition: 0.2s;" title="Dismiss">&times;</span>
                `;
                existingBanner.style.display = 'flex';
            } else {
                if (existingBanner) existingBanner.style.display = 'none';
            }

        } catch(e) { }
    }, 5000);
};

// Start the scanner!
setTimeout(window.startUnverifiedListener, 3000);

// ==========================================
// 📢 CASHIER BULLETIN & SIGNATURE ENGINE
// ==========================================
window.hasAutoShownBulletin = false; // Prevents the popup from spamming every time they click a tab
window.isSignatureBlank = true;

window.loadBulletinHistory = async function() {
    let container = document.getElementById('bulletinHistoryList');
    if (!container) return;
    
    let cashierName = localStorage.getItem('cashierName') || (window.sessionUser ? window.sessionUser.cashierName : null);
    if (!cashierName) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#dc2626; font-weight:bold;">❌ Please log in to view your announcements.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b; font-weight:bold;">⏳ Fetching corporate announcements...</div>';

    try {
        // 1. Get all active announcements from HQ
        const annQ = query(collection(db, "announcements"), where("active", "==", true));
        const annSnap = await getDocs(annQ);
        
        // 2. Get this specific cashier's signatures
        const ackQ = query(collection(db, "acknowledgments"), where("staffName", "==", cashierName));
        const ackSnap = await getDocs(ackQ);
        
        // Map the signatures to the announcement ID
        let signatures = {};
        ackSnap.forEach(doc => {
            let d = doc.data();
            signatures[d.announcementId] = d;
        });

        let announcementsArray = [];
        annSnap.forEach(doc => announcementsArray.push({id: doc.id, ...doc.data()}));
        announcementsArray.sort((a,b) => b.timestamp - a.timestamp); // Newest first

        let html = '';
        let unreadAnnouncements = [];

        announcementsArray.forEach(ann => {
            let dateStr = ann.timestamp ? ann.timestamp.toDate().toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'Unknown Date';
            let sigData = signatures[ann.id];
            let shortMsg = ann.message ? ann.message.substring(0, 100) + (ann.message.length > 100 ? '...' : '') : '';

            let statusBadge = sigData
                ? `<span style="background: #dcfce7; color: #16a34a; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #bbf7d0;">✅ Signed</span>`
                : `<span style="background: #fee2e2; color: #dc2626; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #fecaca; animation: pulse 2s infinite;">❌ Requires Signature</span>`;

            let sigDateStr = sigData && sigData.timestamp ? (sigData.timestamp.toDate ? sigData.timestamp.toDate() : new Date(sigData.timestamp)).toLocaleDateString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Unknown';

            let safeData = {
                id: ann.id, 
                title: ann.title || 'Announcement',
                message: ann.message || '',
                images: ann.images || [],
                dateStr: dateStr,
                hasSignature: !!sigData,
                signatureImg: sigData ? sigData.signature : '',
                signatureDate: sigDateStr
            };
            
            let modalData = encodeURIComponent(JSON.stringify(safeData));

            // Track unread announcements for the auto-popup!
            if (!sigData) unreadAnnouncements.push(modalData);

            html += `
                <div onclick="window.viewAnnouncement('${modalData}')" style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 15px; cursor: pointer; transition: transform 0.2s;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px;">
                        <h3 style="margin: 0; color: #0f172a; font-size: 16px;">${ann.title}</h3>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 10px;">Published: ${dateStr}</div>
                    <div style="margin-top: 10px; font-size: 13px; color: #334155; line-height: 1.5;">${shortMsg}</div>
                    <div style="font-size: 12px; color: #0ea5e9; font-weight: bold; text-align: right; margin-top: 10px;">View Full Details & Sign &rarr;</div>
                </div>
            `;
        });

        if (html === '') {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b; font-weight:bold;">No announcements found.</div>';
        } else {
            container.innerHTML = html;
        }

        // 🔥 THE AUTO-POPUP ENGINE
        if (unreadAnnouncements.length > 0 && !window.hasAutoShownBulletin) {
            window.hasAutoShownBulletin = true;
            setTimeout(() => {
                window.viewAnnouncement(unreadAnnouncements[0]); 
            }, 1000); 
        }

    } catch (e) {
        console.error("Bulletin Fetch Error:", e);
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#dc2626; font-weight:bold;">❌ Error connecting to the server.</div>';
    }
};

window.viewAnnouncement = function(encodedData) {
    let data = JSON.parse(decodeURIComponent(encodedData));
    let imagesHtml = '';
    
    if (data.images && data.images.length > 0) {
        imagesHtml = `<div style="display: flex; gap: 10px; overflow-x: auto; margin-top: 15px; padding-bottom: 5px;">`;
        data.images.forEach(img => {
            imagesHtml += `<img src="${img}" style="height: 120px; border-radius: 6px; border: 1px solid #cbd5e1; object-fit: cover; cursor: pointer;" onclick="window.open('${img}', '_blank')">`;
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
        // 🔥 THE SIGNATURE PAD UI 🔥
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

    Swal.fire({
        title: `<div style="text-align:left; font-size: 18px; color: #0f172a; margin-bottom: 5px;">${data.title}</div>`,
        
        // Ensure max-height is set so the internal scrollbar is forced to appear!
        html: `<div style="text-align: left; max-height: 50vh; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-right: 10px; margin-bottom: 10px;">
                <div style="font-size: 12px; color: #64748b; margin-bottom: 15px;">📅 Published: ${data.dateStr}</div>
                <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${data.message || ''}</div>
                ${imagesHtml}
                ${sigHtml}
               </div>`,
               
        showCloseButton: true, 
        showConfirmButton: false,
        allowOutsideClick: data.hasSignature,
        // 🔥 THE FIX: Tell SweetAlert itself not to stretch past the screen!
        customClass: { popup: 'rounded-2xl shadow-2xl', htmlContainer: 'custom-swal-html' },
        didOpen: () => {
            if (!data.hasSignature) {
                window.initSignaturePad();
            }
        }
    });
};

window.initSignaturePad = function() {
    const canvas = document.getElementById('sigCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    window.isSignatureBlank = true;

    let drawing = false;

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
        e.preventDefault(); 
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

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

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

    let sigDataUrl = canvas.toDataURL("image/png");
    let cashierName = localStorage.getItem('cashierName') || (window.sessionUser ? window.sessionUser.cashierName : 'Unknown Staff');

    try {
        await addDoc(collection(db, "acknowledgments"), {
            announcementId: announcementId,
            staffName: cashierName,
            signature: sigDataUrl,
            timestamp: serverTimestamp()
        });

        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: 'Acknowledgment saved!', 
            showConfirmButton: false, timer: 2500
        });

        Swal.close();
        window.loadBulletinHistory();

    } catch (e) {
        console.error("Signature Save Error:", e);
        Swal.showValidationMessage("Failed to save signature. Check connection.");
        btn.innerText = origText; btn.disabled = false;
    }
};

// ========================================================
// 🏆 LIVE GAMIFICATION LEADERBOARD (LOGIN SCREEN)
// ========================================================
window.fetchLoginRanking = async function() {
    let widget = document.getElementById('loginRankingWidget');
    let listEl = document.getElementById('loginRankingList');
    let quoteEl = document.getElementById('loginRankingQuote');
    
    if (!widget || !listEl || !quoteEl) return;

    let myBranch = localStorage.getItem('takodeal_device_branch');
    if (!myBranch) return; // Hide widget if device isn't registered yet

    // Only fetch and show if the login screen is actually visible
    let loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay && loginOverlay.style.display === 'none') return;

    widget.style.display = 'block';

    try {
        let startOfDay = new Date();
        startOfDay.setHours(0,0,0,0);

        const q = window.query(window.collection(window.db, "transactions"), window.where("timestamp", ">=", startOfDay));
        const snap = await window.getDocs(q);

        // Ensure this branch is always on the board, even if sales are 0
        let salesByBranch = {};
        salesByBranch[myBranch] = 0; 

        snap.forEach(docSnap => {
            let tx = docSnap.data();
            if (tx.status !== 'Voided') {
                let br = tx.branch || 'Unknown';
                let amt = parseFloat(tx.netTotal) || 0;
                if (!salesByBranch[br]) salesByBranch[br] = 0;
                salesByBranch[br] += amt;
            }
        });

        // Convert to array and sort highest to lowest
        let leaderboard = Object.keys(salesByBranch).map(br => {
            return { branch: br, sales: salesByBranch[br] };
        });
        leaderboard.sort((a, b) => b.sales - a.sales);

        let html = '';
        let myRank = -1;
        let medals = ['🥇', '🥈', '🥉'];

        leaderboard.forEach((entry, index) => {
            if (entry.branch === myBranch) myRank = index + 1;
            
            let medal = index < 3 ? medals[index] : '🏅';
            let isMe = entry.branch === myBranch;
            let rowBg = isMe ? 'rgba(255,255,255,0.15)' : 'transparent';
            let rowColor = isMe ? '#ffffff' : '#94a3b8';
            let rowWeight = isMe ? '900' : 'normal';
            let salesColor = isMe ? '#10b981' : '#64748b';

            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: ${rowBg}; padding: 6px 10px; border-radius: 6px;">
                    <span style="color: ${rowColor}; font-weight: ${rowWeight}; font-size: 14px;">${medal} ${entry.branch}</span>
                    <span style="color: ${salesColor}; font-weight: 900; font-size: 14px;">₱${entry.sales.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                </div>
            `;
        });

        listEl.innerHTML = html;

        // 🧠 DYNAMIC ENCOURAGEMENT QUOTES
        if (leaderboard[0].sales === 0) {
            quoteEl.innerHTML = "🚀 The board is empty! Ring up the first sale and take the lead!";
            quoteEl.style.color = "#bae6fd";
        } else if (myRank === 1) {
            quoteEl.innerHTML = `🔥 You are the <b>#1 Top Seller</b> today! Keep up the blazing pace, ${myBranch}!`;
            quoteEl.style.color = "#fef08a"; // Gold
        } else if (myRank === 2) {
            let diff = leaderboard[0].sales - salesByBranch[myBranch];
            quoteEl.innerHTML = `⚡ You're in <b>2nd place</b>! Just ₱${diff.toLocaleString()} away from taking the crown!`;
            quoteEl.style.color = "#e2e8f0"; // Silver
        } else if (myRank === 3) {
            quoteEl.innerHTML = `💪 You're <b>#3</b> today! Time to turn up the heat and climb the ranks!`;
            quoteEl.style.color = "#fed7aa"; // Bronze
        } else {
            quoteEl.innerHTML = `📈 You are rank <b>#${myRank}</b>. Let's make some noise and push harder!`;
            quoteEl.style.color = "#bae6fd";
        }

    } catch (e) {
        console.error("Ranking error:", e);
    }
};

// Start the Leaderboard Engine
setTimeout(window.fetchLoginRanking, 2000); // Run once on boot
setInterval(window.fetchLoginRanking, 30000); // Auto-update every 30 seconds

// ==========================================
// 🔪 KITCHEN PREP ENGINE & CART SYSTEM (UNIFIED)
// ==========================================
window.kitchenPrepCart = [];

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
        const configSnap = await getDoc(doc(db, "settings", "global_pos_config"));
        let allowedCats = ["Prepared Batch"]; 
        if (configSnap.exists() && configSnap.data().kitchenPrepCats && configSnap.data().kitchenPrepCats.length > 0) {
            allowedCats = configSnap.data().kitchenPrepCats.map(c => c.trim().toLowerCase());
        }

        const q = query(collection(db, "inventory"), where("branch", "==", branch));
        const snap = await getDocs(q);
        
        let html = '';
        let hasItems = false;
        
        let items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

        items.forEach(d => {
            let itemCat = (d.category || "").trim().toLowerCase();
            if (!allowedCats.includes(itemCat)) return;
            if (d.showInPrep === false) return;
            
            hasItems = true;
         
            let baseUom = d.uom || d.baseUom || 'units';
            let purchUom = d.purchaseUom || d.purchUom || 'Batch'; 

            let imgSrc = d.image || d.imageUrl;
            let iconHtml = imgSrc 
                ? `<img src="${imgSrc}" style="width: 55px; height: 55px; border-radius: 50%; object-fit: cover; border: 2px solid #e2e8f0; margin-bottom: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">` 
                : `<div style="width: 55px; height: 55px; background: #f8fafc; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 10px; border: 2px solid #e2e8f0;">🔪</div>`;

            html += `
                <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center; transition: transform 0.2s;">
                    ${iconHtml}
                    <h3 style="margin: 0 0 5px 0; color: #1e293b; font-size: 16px; font-weight: 900;">${d.name}</h3>
                    <span style="background: #f1f5f9; color: #475569; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-bottom: 15px;">Stock: ${(parseFloat(d.currentStock)||0).toFixed(1)} ${baseUom}</span>
                    
                    <button onclick="window.addToPrepCart('${d.id}', '${d.name.replace(/'/g, "\\'")}', '${branch}', '${purchUom}', '${baseUom}')" style="background: linear-gradient(135deg, #0ea5e9, #0284c7); color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; box-shadow: 0 4px 6px rgba(2, 132, 199, 0.3); font-size: 14px; transition: 0.2s;">
                        + Add to Cart (${purchUom})
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
        window.renderPrepCart(); 
    } catch (e) {
        console.error("Prep Load Error:", e);
        container.innerHTML = `<div style="color:#ef4444; text-align:center; grid-column:1/-1; padding: 20px;">Failed to load items. Check connection.</div>`;
    }
};

window.addToPrepCart = async function(invId, itemName, branch, purchUom, baseUom) {
    if (!purchUom || purchUom === 'undefined') purchUom = 'Batch';
    if (!baseUom || baseUom === 'undefined') baseUom = 'units';

    const { value: qtyRaw } = await Swal.fire({
        title: 'Add to Prep Cart',
        html: `<div style="margin-bottom: 10px; color: #475569; font-size: 15px;">How many <strong>${purchUom}s</strong> of <strong style="color: #0f172a;">${itemName}</strong>?</div>`,
        input: 'number',
        inputPlaceholder: `Enter number of ${purchUom}s...`,
        inputAttributes: { min: 0.1, step: 'any' },
        showCancelButton: true,
        confirmButtonText: '➕ Add to Cart',
        confirmButtonColor: '#0ea5e9',
        cancelButtonColor: '#94a3b8',
        customClass: { popup: 'rounded-2xl shadow-2xl border border-gray-100' }
    });

    if (!qtyRaw) return; 
    let parsedQty = parseFloat(qtyRaw);

    let existing = window.kitchenPrepCart.find(i => i.id === invId);
    if (existing) {
        existing.purchQty += parsedQty; 
    } else {
        window.kitchenPrepCart.push({
            id: invId,
            name: itemName,
            branch: branch,
            purchQty: parsedQty,
            purchUom: purchUom,
            baseUom: baseUom
        });
    }

    window.renderPrepCart();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Added to Cart', showConfirmButton: false, timer: 1500 });
};

window.removeFromPrepCart = function(index) {
    window.kitchenPrepCart.splice(index, 1);
    window.renderPrepCart();
};

window.renderPrepCart = function() {
    let container = document.getElementById('prepCartBody');
    if (!container) return;

    if (window.kitchenPrepCart.length === 0) {
        container.innerHTML = '<div style="padding: 30px; text-align: center; color: #94a3b8; font-weight: bold; font-size: 14px;">Cart is empty.<br><span style="font-size: 11px; font-weight: normal;">Tap an item on the left to begin.</span></div>';
        return;
    }

    let html = '';
    window.kitchenPrepCart.forEach((item, index) => {
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #e2e8f0; background: white;">
                <div>
                    <strong style="color: #0f172a; font-size: 14px;">${item.name}</strong><br>
                    <span style="color: #0ea5e9; font-weight: bold; font-size: 13px;">+${item.purchQty} ${item.purchUom}</span>
                </div>
                <button onclick="window.removeFromPrepCart(${index})" style="background: #fef2f2; color: #ef4444; border: 1px solid #fca5a5; padding: 6px 10px; border-radius: 6px; font-weight: bold; font-size: 11px; cursor: pointer;">✖</button>
            </div>
        `;
    });

    container.innerHTML = html;
};

window.confirmPrepCart = async function() {
    if (!window.kitchenPrepCart || window.kitchenPrepCart.length === 0) {
        return Swal.fire('Cart Empty', 'Please add items to the prep cart first.', 'warning');
    }

    const confirmResult = await Swal.fire({
        title: 'Confirm Kitchen Prep',
        html: `<div style="color: #475569;">You are about to securely log <strong>${window.kitchenPrepCart.length}</strong> batch(es) to your live inventory.<br><br><span style="font-size: 12px; color: #64748b;">This will automatically deduct the raw ingredients used.</span></div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '✅ Yes, Log Everything!',
        confirmButtonColor: '#16a34a',
        cancelButtonColor: '#ef4444',
        customClass: { popup: 'rounded-2xl shadow-2xl' }
    });

    if (!confirmResult.isConfirmed) return;

    Swal.fire({ title: 'Processing...', text: 'Updating inventory & recipes...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

    try {
        let missingItems = [];
        let safeCashierName = localStorage.getItem('cashierName') || "Kitchen Staff";
        let totalItemsLogged = 0;

        for (let item of window.kitchenPrepCart) {
            const invRef = doc(db, "inventory", item.id);
            const invSnap = await getDoc(invRef);
            
            if (invSnap.exists()) {
                let invData = invSnap.data();
                let currentStock = invData.currentStock || 0;
                
                let convRate = parseFloat(invData.conversionRate) || parseFloat(invData.conversion) || 1;
                let baseQtyToAdd = item.purchQty * convRate;

                await updateDoc(invRef, { currentStock: currentStock + baseQtyToAdd });

                const bomQ = query(collection(db, "bom"), where("menuItem", "==", item.name));
                const bomSnap = await getDocs(bomQ);

                if (!bomSnap.empty) {
                    for (let bomDoc of bomSnap.docs) {
                        let recipe = bomDoc.data();
                        let rawIngredient = recipe.ingredientName;
                        let totalAmountToDeduct = (recipe.qty || 0) * item.purchQty; 

                        const rawQ = query(collection(db, "inventory"), where("branch", "==", item.branch), where("name", "==", rawIngredient));
                        const rawSnap = await getDocs(rawQ);

                        if (!rawSnap.empty) {
                            let rawRef = rawSnap.docs[0].ref;
                            let rawCurrentStock = rawSnap.docs[0].data().currentStock || 0;
                            await updateDoc(rawRef, { currentStock: rawCurrentStock - totalAmountToDeduct });
                        } else {
                            if (!missingItems.includes(rawIngredient)) missingItems.push(rawIngredient);
                        }
                    }
                }

                await addDoc(collection(db, "stock_logs"), {
                    branch: item.branch, item: item.name, variance: baseQtyToAdd, uom: item.baseUom,
                    purchUom: item.purchUom, purchQty: item.purchQty, 
                    type: "End-of-Shift Kitchen Prep", note: `Prepared ${item.purchQty} ${item.purchUom}(s) by ${safeCashierName}`, timestamp: new Date()
                });
                
                totalItemsLogged++;
            }
        }

        let msg = `<div style="text-align: left; font-size: 14px;">✅ Successfully logged <strong>${totalItemsLogged}</strong> batches to the vault.`;
        if (missingItems.length > 0) {
            msg += `<br><br><span style="color: #dc2626;">⚠️ <strong>Warning:</strong> The following raw ingredients are missing from the ${window.kitchenPrepCart[0].branch} warehouse and were not deducted: <strong>${missingItems.join(", ")}</strong></span>`;
        }
        msg += `</div>`;
        
        Swal.fire({ title: 'Success!', html: msg, icon: 'success', confirmButtonColor: '#16a34a', customClass: { popup: 'rounded-2xl' } });
        
        window.kitchenPrepCart = [];
        window.renderPrepCart();
        window.loadKitchenPrep(); 
        
    } catch (e) {
        console.error("Prep Batch Error:", e);
        Swal.fire('Error', '❌ Failed to log prep batch. Check connection.', 'error');
    }
};

// ========================================================
// 🖋️ MASTER UNIVERSAL SIGNATURE ENGINE (OVERRIDES ALL DUPLICATES)
// ========================================================
window.initSignaturePad = function() {
    // 1. Smartly detect WHICH modal is currently visible on the screen!
    let activeCanvasId = null;
    if (document.getElementById('signatureCanvas') && document.getElementById('signatureCanvas').offsetWidth > 0) {
        activeCanvasId = 'signatureCanvas'; // Sanctions / NTE Modal
    } else if (document.getElementById('sigCanvas') && document.getElementById('sigCanvas').offsetWidth > 0) {
        activeCanvasId = 'sigCanvas'; // Bulletin Board Modal (New)
    } else if (document.getElementById('bulletinCanvas') && document.getElementById('bulletinCanvas').offsetWidth > 0) {
        activeCanvasId = 'bulletinCanvas'; // Bulletin Board Modal (Old Backup)
    }

    if (!activeCanvasId) return;

    let oldCanvas = document.getElementById(activeCanvasId);
    
    // 2. Clone the canvas to wipe out any duplicate ghost event listeners
    let newCanvas = oldCanvas.cloneNode(true);
    oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
    
    // 3. 🔥 THE MAGIC FIX: Force the internal drawing resolution to match the physical screen size!
    newCanvas.width = newCanvas.offsetWidth || 300;
    newCanvas.height = newCanvas.offsetHeight || 150;
    
    const ctx = newCanvas.getContext('2d');
    let isDrawing = false;
    
    // Reset the correct safety variables
    if (activeCanvasId === 'signatureCanvas') {
        window.hasSignedNTE = false;
    } else {
        window.isSignatureBlank = true;
        window.hasSignedBulletin = false;
    }

    ctx.clearRect(0, 0, newCanvas.width, newCanvas.height);
    
    // 4. Style the pen (Thick, smooth, and color-coded!)
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Red ink for Sanctions, Deep Slate for Bulletins
    ctx.strokeStyle = activeCanvasId === 'signatureCanvas' ? '#dc2626' : '#0f172a'; 

    const getPos = (e) => {
        const rect = newCanvas.getBoundingClientRect();
        // Calculate the exact scale difference to perfectly track the finger!
        const scaleX = newCanvas.width / rect.width;
        const scaleY = newCanvas.height / rect.height;
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const startPosition = (e) => {
        isDrawing = true;
        // Flip the safety switches so the Submit button works!
        if (activeCanvasId === 'signatureCanvas') window.hasSignedNTE = true;
        else { window.isSignatureBlank = false; window.hasSignedBulletin = true; }
        
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        e.preventDefault(); // CRITICAL: Stops the tablet screen from pulling/scrolling while drawing!
    };

    const draw = (e) => {
        if (!isDrawing) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        e.preventDefault();
    };

    const stopPosition = () => {
        isDrawing = false;
        ctx.closePath(); 
    };

    // Attach Mouse listeners (For PC)
    newCanvas.addEventListener('mousedown', startPosition);
    newCanvas.addEventListener('mousemove', draw);
    newCanvas.addEventListener('mouseup', stopPosition);
    newCanvas.addEventListener('mouseout', stopPosition);

    // Attach Touch listeners (For Tablets)
    newCanvas.addEventListener('touchstart', startPosition, { passive: false });
    newCanvas.addEventListener('touchmove', draw, { passive: false });
    newCanvas.addEventListener('touchend', stopPosition);
};

// Protect against old HTML buttons trying to call different names!
window.initBulletinSignaturePad = window.initSignaturePad;

// Universal Clear Button
window.clearSignature = function() {
    ['signatureCanvas', 'sigCanvas', 'bulletinCanvas'].forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    });
    // Lock everything down again
    window.hasSignedNTE = false;
    window.isSignatureBlank = true;
    window.hasSignedBulletin = false;
};

// Protect against old HTML buttons trying to call different names!
window.clearBulletinSignature = window.clearSignature;

// ==========================================
// 🚀 HYBRID MULTI-PRINTER & RAWBT HUB
// ==========================================
window.mainPrinterChar = null;
window.kitchenPrinterChar = null;
window.barPrinterChar = null;

window.switchPrinterMode = function(mode) {
    localStorage.setItem('takodeal_printer_mode', mode);
    let bleUI = document.getElementById('blePrinterSetup');
    let rawbtUI = document.getElementById('rawbtPrinterSetup');
    if (bleUI) bleUI.style.display = mode === 'ble' ? 'flex' : 'none';
    if (rawbtUI) rawbtUI.style.display = mode === 'rawbt' ? 'block' : 'none';
};

window.openPrinterManager = function() {
    let currentMode = localStorage.getItem('takodeal_printer_mode') || 'ble';
    let isBle = currentMode === 'ble';

    Swal.fire({
        title: '🖨️ Printer Management',
        html: `
            <div style="margin-bottom: 15px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #cbd5e1; text-align: left;">
                <label style="font-weight: bold; color: #334155; font-size: 14px; display: flex; flex-direction: column; gap: 8px;">
                    <span>⚙️ Printer Engine Mode:</span>
                    <select id="printerModeSelect" onchange="window.switchPrinterMode(this.value)" style="padding: 10px; border-radius: 6px; border: 1px solid #94a3b8; font-weight: bold; width: 100%; outline: none; background: white; cursor: pointer;">
                        <option value="ble" ${isBle ? 'selected' : ''}>⚡ Fast Direct Bluetooth (New)</option>
                        <option value="rawbt" ${!isBle ? 'selected' : ''}>🐢 Legacy App (RawBT)</option>
                    </select>
                </label>
            </div>

            <div id="blePrinterSetup" style="display:${isBle ? 'flex' : 'none'}; flex-direction:column; gap:12px; text-align: left;">
                <p style="font-size: 12px; color: #64748b; margin-top: 0; text-align: center;">Pair modern printers and test connections.</p>
                
                <div style="display: flex; gap: 10px;">
                    <button onclick="window.connectSpecificPrinter('main')" style="flex:2; padding:12px; background:${window.mainPrinterChar ? '#16a34a' : '#f8fafc'}; color:${window.mainPrinterChar ? 'white' : '#334155'}; border:1px solid #cbd5e1; border-radius:8px; font-weight:bold; font-size:14px; cursor:pointer;">
                        ${window.mainPrinterChar ? '✅ Main Paired' : '🧾 Pair Main'}
                    </button>
                    <button onclick="window.testPrint('main', event)" style="flex:1; padding:12px; background:#0ea5e9; color:white; border:none; border-radius:8px; font-weight:bold; font-size:14px; cursor:pointer; box-shadow: 0 2px 4px rgba(14,165,233,0.3);">Test 🖨️</button>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button onclick="window.connectSpecificPrinter('kitchen')" style="flex:2; padding:12px; background:${window.kitchenPrinterChar ? '#d97706' : '#f8fafc'}; color:${window.kitchenPrinterChar ? 'white' : '#334155'}; border:1px solid #cbd5e1; border-radius:8px; font-weight:bold; font-size:14px; cursor:pointer;">
                        ${window.kitchenPrinterChar ? '✅ Kitchen Paired' : '🍳 Pair Kitchen'}
                    </button>
                    <button onclick="window.testPrint('kitchen', event)" style="flex:1; padding:12px; background:#0ea5e9; color:white; border:none; border-radius:8px; font-weight:bold; font-size:14px; cursor:pointer; box-shadow: 0 2px 4px rgba(14,165,233,0.3);">Test 🖨️</button>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button onclick="window.connectSpecificPrinter('bar')" style="flex:2; padding:12px; background:${window.barPrinterChar ? '#0284c7' : '#f8fafc'}; color:${window.barPrinterChar ? 'white' : '#334155'}; border:1px solid #cbd5e1; border-radius:8px; font-weight:bold; font-size:14px; cursor:pointer;">
                        ${window.barPrinterChar ? '✅ Bar Paired' : '🥤 Pair Bar'}
                    </button>
                    <button onclick="window.testPrint('bar', event)" style="flex:1; padding:12px; background:#0ea5e9; color:white; border:none; border-radius:8px; font-weight:bold; font-size:14px; cursor:pointer; box-shadow: 0 2px 4px rgba(14,165,233,0.3);">Test 🖨️</button>
                </div>
            </div>
            
            <div id="rawbtPrinterSetup" style="display:${!isBle ? 'block' : 'none'}; padding: 15px; background: #fffbeb; border: 1px dashed #d97706; border-radius: 8px; color: #b45309; font-size: 13px; font-weight: bold; text-align: left;">
                ⚠️ Legacy Mode Active.<br><br>The POS will bypass the browser and route tickets to the RawBT Android App. Ensure Printer 001 is paired in your Android Bluetooth settings.
            </div>
        `,
        showConfirmButton: true,
        confirmButtonText: 'Done',
        confirmButtonColor: '#64748b',
        customClass: { popup: 'rounded-2xl shadow-xl' }
    });
};

// 🔥 NEW: Test Print Engine
window.testPrint = async function(target, event) {
    let escpos = "\x1B\x40\n";
    escpos += "\x1B\x61\x01"; // Center Align
    escpos += "\x1B\x21\x30"; // Double Width & Height
    escpos += "TEST PRINT\n";
    escpos += "\x1B\x21\x00"; // Normal Size
    escpos += "--------------------------------\n";
    escpos += "Printer is connected successfully!\n";
    escpos += "Target: " + target.toUpperCase() + "\n";
    escpos += "--------------------------------\n\n\n\n";
    escpos += "\x1D\x56\x41\x10"; // Cut Paper
    
    let btn = event.target;
    let oldText = btn.innerText;
    btn.innerText = "⏳...";
    btn.disabled = true;

    try {
        await window.sendToBluetoothPrinter(escpos, false, target);
    } catch(e) {}
    
    btn.innerText = oldText;
    btn.disabled = false;
};

window.connectSpecificPrinter = async function(target) {
    try {
        let device = null;
        // Check if the tablet already remembers this specific printer
        let savedDeviceId = localStorage.getItem(`takodeal_printer_${target}_id`);

        // 🔥 PHASE 1: THE SILENT MEMORY BYPASS (SPEED UPGRADE)
        if (savedDeviceId && navigator.bluetooth && navigator.bluetooth.getDevices) {
            const permittedDevices = await navigator.bluetooth.getDevices();
            // Look through the authorized devices for our saved ID
            device = permittedDevices.find(d => d.id === savedDeviceId);
            
            if (device) {
                console.log(`Found authorized ${target} printer in memory. Bypassing scan...`);
            }
        }

        // 🔥 PHASE 2: FALLBACK MANUAL SCAN (First Time Setup)
        if (!device) {
            console.log(`No memory for ${target} printer. Opening Bluetooth scanner...`);
            device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    '000018f0-0000-1000-8000-00805f9b34fb', 
                    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', 
                    '0000ae30-0000-1000-8000-00805f9b34fb'
                ]
            });
            // Save the unique ID so we never have to scan for it again!
            localStorage.setItem(`takodeal_printer_${target}_id`, device.id);
        }

        Swal.fire({title: 'Pairing...', text: 'Connecting to hardware...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        
        // Establish the GATT connection
        const server = await device.gatt.connect();
        let foundChar = null;
        const services = await server.getPrimaryServices();
        
        for (let service of services) {
            const characteristics = await service.getCharacteristics();
            for (let char of characteristics) {
                if (char.properties.write || char.properties.writeWithoutResponse) {
                    foundChar = char; 
                    break;
                }
            }
            if (foundChar) break;
        }

        if (foundChar) {
            // Assign to the correct global variable based on the target
            if (target === 'main') window.mainPrinterChar = foundChar;
            else if (target === 'kitchen') window.kitchenPrinterChar = foundChar;
            else if (target === 'bar') window.barPrinterChar = foundChar;

            Swal.fire({ 
                toast: true, position: 'top-end', icon: 'success', 
                title: `${target.toUpperCase()} Printer Paired!`, 
                showConfirmButton: false, timer: 2000 
            });
            
            window.openPrinterManager(); // Re-open the menu to show the green checkmark
            
            // Handle accidental disconnects gracefully
            device.addEventListener('gattserverdisconnected', () => {
                console.warn(`${target.toUpperCase()} Printer disconnected.`);
                if (target === 'main') window.mainPrinterChar = null;
                else if (target === 'kitchen') window.kitchenPrinterChar = null;
                else if (target === 'bar') window.barPrinterChar = null;
                
                Swal.fire({
                    toast: true, position: 'top-end', icon: 'warning',
                    title: `${target.toUpperCase()} Printer Offline`, 
                    text: 'Bluetooth connection lost.',
                    showConfirmButton: false, timer: 4000
                });
            });
            
        } else {
            throw new Error("Device does not support direct ESC/POS writing.");
        }
    } catch (error) {
        console.error(error);
        
        // If the cashier simply clicked "Cancel" on the scan popup, fail silently
        if (error.name === 'NotFoundError' || error.code === 8) {
            Swal.close();
            return;
        }
        
        // If it was a genuine failure, alert them
        Swal.fire('Connection Failed', error.message || 'Could not connect to printer. Please ensure it is powered on.', 'error')
            .then(() => window.openPrinterManager());
    }
};

// ==========================================
// 🛡️ RAW BYTE ENGINE & BULLETPROOF IMAGE PROCESSOR
// ==========================================
window.stringToBuffer = function(str) {
    let buffer = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) buffer[i] = str.charCodeAt(i) & 0xFF;
    return buffer;
};

window.concatBuffers = function(buffers) {
    let totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    let result = new Uint8Array(totalLength);
    let offset = 0;
    for (let b of buffers) {
        result.set(b, offset);
        offset += b.length;
    }
    return result;
};

// ==========================================
// 🖼️ ESC/POS BINARY IMAGE PROCESSOR
// ==========================================
window.encodeImageForPrinter = async function(base64Image, scaleWidth, scaleHeight) {
    return new Promise((resolve) => {
        let img = new Image();
        
        img.onload = function() {
            try {
                let canvas = document.createElement('canvas');
                let ctx = canvas.getContext('2d', { willReadFrequently: true });
                
                let baseWidth = 200; 
                let targetWidth = baseWidth * (scaleWidth || 1);
                targetWidth = Math.floor(targetWidth / 8) * 8; // Must be multiple of 8
                let targetHeight = Math.floor((img.height / img.width) * targetWidth);
                
                canvas.width = targetWidth; 
                canvas.height = targetHeight;
                
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let bytesWidth = canvas.width / 8;
                let bytesHeight = canvas.height;
                
                let buffer = new Uint8Array(8 + (bytesWidth * bytesHeight));
                buffer.set([0x1D, 0x76, 0x30, 0x00, bytesWidth & 0xFF, (bytesWidth >> 8) & 0xFF, bytesHeight & 0xFF, (bytesHeight >> 8) & 0xFF], 0);
                
                let offset = 8;
                for (let y = 0; y < canvas.height; y++) {
                    for (let x = 0; x < bytesWidth; x++) {
                        let byte = 0;
                        for (let bit = 0; bit < 8; bit++) {
                            let px = (y * canvas.width + (x * 8 + bit)) * 4;
                            let r = imgData[px], g = imgData[px+1], b = imgData[px+2], a = imgData[px+3];
                            if (a < 128) { r = 255; g = 255; b = 255; } 
                            let luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b);
                            if (luminance < 128) byte |= (1 << (7 - bit));
                        }
                        buffer[offset++] = byte;
                    }
                }
                
                let finalBuffer = new Uint8Array(buffer.length + 6);
                finalBuffer.set([0x1B, 0x61, 0x01], 0); // Center Align
                finalBuffer.set(buffer, 3);
                finalBuffer.set([0x1B, 0x61, 0x00], 3 + buffer.length); // Left Align
                
                resolve(finalBuffer);
            } catch (e) {
                console.warn("Logo processing failed, skipping logo...", e);
                resolve(null); 
            }
        };
        img.onerror = function() { console.warn("Logo failed to load."); resolve(null); };
        img.src = base64Image;
    });
};

// ==========================================
// ⚡ DIRECT BLUETOOTH SENDER & QUEUE SYSTEM
// ==========================================
window.bluetoothPrintQueue = [];
window.isBluetoothPrinting = false;

window.processBluetoothQueue = async function() {
    // If it's already printing, or the line is empty, do nothing!
    if (window.isBluetoothPrinting || window.bluetoothPrintQueue.length === 0) return;
    
    window.isBluetoothPrinting = true; // Lock the door!
    let job = window.bluetoothPrintQueue.shift(); // Grab the first receipt in line
    
    try {
        let buffer = (job.data instanceof Uint8Array) ? job.data : window.stringToBuffer(job.data);
        const CHUNK_SIZE = 64;
        for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
            await job.activeChar.writeValue(buffer.slice(i, i + CHUNK_SIZE));
            await new Promise(resolve => setTimeout(resolve, 40)); 
        }
    } catch(e) {
        console.error("Print Error:", e);
        if (job.activeChar === window.kitchenPrinterChar) window.kitchenPrinterChar = null;
        else if (job.activeChar === window.barPrinterChar) window.barPrinterChar = null;
        else window.mainPrinterChar = null;
    } finally {
        window.isBluetoothPrinting = false; // Unlock the door!
        // Wait half a second for the printer hardware to breathe, then process the next one!
        setTimeout(window.processBluetoothQueue, 500); 
    }
};

window.sendToBluetoothPrinter = async function(data, isJustDrawer = false, target = 'main') {
    let currentMode = localStorage.getItem('takodeal_printer_mode') || 'ble';
    
    if (currentMode === 'rawbt') {
        let textData = (data instanceof Uint8Array) ? new TextDecoder().decode(data) : data;
        if (!isJustDrawer) textData += "\n\n\n\n";
        let base64Encoded = btoa(unescape(encodeURIComponent(textData)));
        window.location.href = "intent:base64," + base64Encoded + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
        return;
    }

    let activeChar = null;
    if (target === 'kitchen') activeChar = window.kitchenPrinterChar || window.mainPrinterChar;
    else if (target === 'bar') activeChar = window.barPrinterChar || window.mainPrinterChar;
    else activeChar = window.mainPrinterChar;

    if (!activeChar) {
        console.log("Printer not active. Attempting auto-reconnect...");
        await window.autoConnectPrinters();
        
        if (target === 'kitchen') activeChar = window.kitchenPrinterChar || window.mainPrinterChar;
        else if (target === 'bar') activeChar = window.barPrinterChar || window.mainPrinterChar;
        else activeChar = window.mainPrinterChar;
    }
    
    if (!activeChar) {
        Swal.fire('🖨️ Printer Offline', 'The printer is disconnected or asleep. Please tap the Printer Hub icon to reconnect it.', 'warning');
        return; 
    }

    // Send the receipt to the waiting line instead of attacking the printer!
    window.bluetoothPrintQueue.push({ data: data, activeChar: activeChar });
    window.processBluetoothQueue();
};

// Auto-override the sidebar button
setTimeout(() => {
    let printerBtn = document.getElementById('nav-printer');
    if (printerBtn) {
        printerBtn.removeAttribute('onclick');
        printerBtn.onclick = window.openPrinterManager;
        printerBtn.innerHTML = `<span style="font-size: 18px;">🖨️</span><div class="nav-item-text">Printer Hub</div>`;
    }
}, 2000);

// Helper function to stitch Binary Buffers together
window.concatBuffers = function(buffers) {
    let totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    let result = new Uint8Array(totalLength);
    let offset = 0;
    for (let b of buffers) {
        result.set(b, offset);
        offset += b.length;
    }
    return result;
};

// ==========================================
// 🔗 REPRINT & PARKED ORDERS ROUTING HUB
// ==========================================
window.reprintReceipt = async function(encodedOrder) {
    let order = JSON.parse(decodeURIComponent(encodedOrder));
    window.lastTransactionData = order; // Feed it into the engine
    await window.printReceipt('customer');
};

window.printParkedOrder = async function(encodedData) {
    let d = JSON.parse(decodeURIComponent(encodedData));
    
    // Morph the parked data to look exactly like a live transaction
    window.lastTransactionData = {
        cart: d.cart || d.items || [],
        orderType: (d.orderType || "DINE-IN") + " (PARKED)",
        customerName: d.customerName || d.customer || "Guest",
        cashierName: d.cashierName || localStorage.getItem('cashierName') || "Staff",
        netTotal: d.totalDue || d.netTotal || 0,
        amountReceived: 0, // Forces the beautiful ">> UNPAID ORDER <<" badge!
        paymentMethod: "UNPAID",
        globalDiscountAmount: d.globalDiscountAmount || 0,
        globalDiscountReason: d.globalDiscountReason || ""
    };
    
    await window.printReceipt('customer');
};

// ==========================================
// 🚀 SMART UPDATE & VERSION CONTROL ENGINE
// ==========================================
setTimeout(() => {
    let branch = localStorage.getItem('takodeal_device_branch');
    if (!branch) return;

    // Initialize local version memory if it doesn't exist
    if (!localStorage.getItem('takodeal_local_version')) {
        localStorage.setItem('takodeal_local_version', '0');
    }

    // Silently listen to this branch's document in Firebase
    window.onSnapshot(window.doc(window.db, "branches", branch), (docSnap) => {
        if (docSnap.exists()) {
            // It reads the Timestamp of the latest update!
            let cloudVersion = parseFloat(docSnap.data().approvedVersion) || 0;
            let localVersion = parseFloat(localStorage.getItem('takodeal_local_version')) || 0;
            
            let updateBanner = document.getElementById('updateAppBanner');
            if (updateBanner) {
                // If the Manager pushed a newer timestamp, show the button!
                if (cloudVersion > localVersion) {
                    updateBanner.style.display = 'flex';
                    // Save the target timestamp so the button knows what to upgrade to
                    window.TARGET_UPDATE_VERSION = cloudVersion;
                } else {
                    updateBanner.style.display = 'none';
                }
            }
        }
    });
}, 5000); // Wait 5 seconds after boot so it doesn't interrupt login

// ==========================================
// 🚀 THE SMART UPDATE & CACHE NUKE ENGINE
// ==========================================

// 1. The function that runs when they click the Red Banner at the top
window.forceAppUpdate = function() {
    Swal.fire({
        title: 'Updating System...',
        html: 'Downloading the latest features from HQ.<br><b>Please wait, the app will restart...</b>',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    if (window.TARGET_UPDATE_VERSION) {
        localStorage.setItem('takodeal_local_version', window.TARGET_UPDATE_VERSION.toString());
    }

    window.executeCacheWipe();
};

// 2. The function that runs when they click the "Force System Update" button on the Login Screen
window.manualHardUpdate = function() {
    Swal.fire({
        title: 'Force Update?',
        text: 'This will clear the app cache and download the newest files from the server. You will not lose your device registration.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0ea5e9',
        confirmButtonText: 'Yes, Update Now!'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({title: 'Clearing Cache...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
            window.executeCacheWipe();
        }
    });
};

// 3. The surgical strike that kills the Service Worker WITHOUT wiping the Device ID!
window.executeCacheWipe = function() {
    // A. Unregister the stubborn Service Workers
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister();
            }
        });
    }

    // B. Nuke the old PWA file storage
    if ('caches' in window) {
        caches.keys().then(names => { 
            for (let name of names) caches.delete(name); 
        }).then(() => {
            // C. Force reload the page from Vercel bypassing the browser cache
            setTimeout(() => {
                window.location.reload(true);
            }, 1500); 
        });
    } else {
        setTimeout(() => { window.location.reload(true); }, 1500); 
    }
};

// ==========================================
// 📡 AUTOMATIC VERSION REPORTER
// ==========================================
setTimeout(async () => {
    try {
        const vRef = window.doc(window.db, "settings", "live_cashier_version");
        const vSnap = await window.getDoc(vRef);
        let currentHighest = vSnap.exists() ? (parseFloat(vSnap.data().version) || 10.0) : 10.0;
        let myVersion = parseFloat(window.LOCAL_APP_VERSION) || 10.0;
        
        // If this tablet (or your testing PC) is running newer code than the Cloud, update the Cloud!
        if (myVersion > currentHighest) {
            await window.setDoc(vRef, { 
                version: myVersion, 
                updatedOn: new Date().toISOString() 
            }, { merge: true });
        }
    } catch (e) {
        console.warn("Version check skipped:", e);
    }
}, 8000); // Waits 8 seconds so it doesn't slow down the POS boot sequence

// ==========================================
// 🖨️ SILENT BLUETOOTH AUTO-RECONNECT ENGINE
// ==========================================
window.autoConnectPrinters = async function() {
    let currentMode = localStorage.getItem('takodeal_printer_mode') || 'ble';
    if (currentMode !== 'ble') return; // Only applies to modern direct Bluetooth mode
    
    let targets = ['main', 'kitchen', 'bar'];
    let connectedCount = 0;

    for (let target of targets) {
        let savedDeviceId = localStorage.getItem(`takodeal_printer_${target}_id`);
        if (savedDeviceId && navigator.bluetooth && navigator.bluetooth.getDevices) {
            try {
                const permittedDevices = await navigator.bluetooth.getDevices();
                let device = permittedDevices.find(d => d.id === savedDeviceId);
                
                if (device) {
                    console.log(`Auto-connecting to ${target} printer in background...`);
                    
                    // We must add an event listener to handle accidental disconnects!
                    device.addEventListener('gattserverdisconnected', () => {
                        console.warn(`${target.toUpperCase()} Printer disconnected.`);
                        if (target === 'main') window.mainPrinterChar = null;
                        else if (target === 'kitchen') window.kitchenPrinterChar = null;
                        else if (target === 'bar') window.barPrinterChar = null;
                    });

                    const server = await device.gatt.connect();
                    let foundChar = null;
                    const services = await server.getPrimaryServices();
                    
                    for (let service of services) {
                        const characteristics = await service.getCharacteristics();
                        for (let char of characteristics) {
                            if (char.properties.write || char.properties.writeWithoutResponse) {
                                foundChar = char; break;
                            }
                        }
                        if (foundChar) break;
                    }

                    if (foundChar) {
                        if (target === 'main') window.mainPrinterChar = foundChar;
                        else if (target === 'kitchen') window.kitchenPrinterChar = foundChar;
                        else if (target === 'bar') window.barPrinterChar = foundChar;
                        connectedCount++;
                    }
                }
            } catch (e) {
                console.warn(`Failed to auto-connect ${target} printer:`, e);
            }
        }
    }
    
    if (connectedCount > 0) {
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success', 
            title: `🖨️ ${connectedCount} Printer(s) Auto-Connected!`, 
            showConfirmButton: false, timer: 3000
        });
    }
};

// Run on boot if already logged in!
setTimeout(() => {
    let existingCashier = localStorage.getItem('cashierName');
    if (existingCashier && typeof window.autoConnectPrinters === 'function') {
        window.autoConnectPrinters();
    }
}, 3000);
