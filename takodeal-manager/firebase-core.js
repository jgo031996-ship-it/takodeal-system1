import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, increment, enableNetwork, disableNetwork, writeBatch, startAfter } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
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

// Expose Core Engines Globally
window.db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
window.auth = getAuth(app);
window.provider = new GoogleAuthProvider();
window.storage = getStorage(app);

// Expose Firebase Functions Globally (Bridge for main.js)
window.query = query; window.where = where; window.collection = collection;
window.getDocs = getDocs; window.getDoc = getDoc; window.addDoc = addDoc;
window.updateDoc = updateDoc; window.deleteDoc = deleteDoc; window.doc = doc;
window.setDoc = setDoc; window.serverTimestamp = serverTimestamp;
window.increment = increment; window.orderBy = orderBy; window.limit = limit;
window.ref = ref; window.uploadBytes = uploadBytes; window.getDownloadURL = getDownloadURL;
window.writeBatch = writeBatch; window.onSnapshot = onSnapshot; window.startAfter = startAfter;
window.enableNetwork = enableNetwork; window.disableNetwork = disableNetwork;

// TAKODEAL GLOBAL CACHE ENGINE
window.TK_CACHE = {
    menu: null, bom: null, inventory: null,
    lastMenu: 0, lastBom: 0, lastInventory: 0,
    ttl: 60 * 1000 
};

window.fetchCachedCollection = async function(colName) {
    let now = Date.now();
    let timeKey = 'last' + colName.charAt(0).toUpperCase() + colName.slice(1); 
    
    if (window.TK_CACHE[colName] && (now - window.TK_CACHE[timeKey] < window.TK_CACHE.ttl)) {
        console.log(`📦 Loaded ${colName.toUpperCase()} from RAM (0 Firebase Reads)`);
        return window.TK_CACHE[colName];
    }

    console.log(`☁️ Fetching ${colName.toUpperCase()} from Firebase...`);
    const snap = await window.getDocs(window.collection(window.db, colName));
    let data = [];
    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
    
    window.TK_CACHE[colName] = data;
    window.TK_CACHE[timeKey] = now;
    return data;
};

window.invalidateCache = function(colName) { window.TK_CACHE[colName] = null; };

console.log("🚀 TAKODEÁL Offline Storage & Cache is ACTIVE!");
