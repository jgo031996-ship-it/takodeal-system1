import { createCollectionCache } from './collection-cache.js';
import { createDeviceStore } from './device-store.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, getDocs, getDoc, getDocsFromServer, getDocFromServer, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, increment, enableNetwork, disableNetwork, writeBatch, startAfter, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
window.getDocsFromServer = getDocsFromServer; window.getDocFromServer = getDocFromServer;
window.updateDoc = updateDoc; window.deleteDoc = deleteDoc; window.doc = doc;
window.setDoc = setDoc; window.serverTimestamp = serverTimestamp;
window.increment = increment; window.orderBy = orderBy; window.limit = limit;
window.ref = ref; window.uploadBytes = uploadBytes; window.getDownloadURL = getDownloadURL;
window.writeBatch = writeBatch; window.onSnapshot = onSnapshot; window.startAfter = startAfter;
window.runTransaction = runTransaction;
window.enableNetwork = enableNetwork; window.disableNetwork = disableNetwork;

// Views share one cache and invalidate it after edits or edits in another tab.
const cache = createCollectionCache(async name => {
    const snap = await getDocs(collection(window.db, name));
    return snap.docs.map(row => ({id:row.id,...row.data()}));
}, { storage: createDeviceStore(), scope: () => window.sessionUser && window.auth.currentUser?.uid || '' });
const cacheChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('takodeal-manager-cache') : null;
cacheChannel?.addEventListener('message', event => cache.invalidate(event.data));
window.fetchCachedCollection = name => window.sessionUser ? cache.get(name) : Promise.reject(new Error('Unlock the Manager before loading tab data.'));
window.invalidateCache = name => { cache.invalidate(name); cacheChannel?.postMessage(name); };
window.clearManagerMemoryCache = () => cache.clearMemory();
