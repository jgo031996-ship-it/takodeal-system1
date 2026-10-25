import { createCollectionCache } from './collection-cache.js';
import { createDeviceStore } from './device-store.js';
import { createHQAccountReader } from './hq-account-reader.js';
import { installFirestoreHealth, guardFirestoreOperations } from './firestore-health.js';
import { initializeApp, onLog } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, getDocs, getDoc, getDocsFromServer, getDocFromServer, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, increment, enableNetwork, disableNetwork, writeBatch, startAfter, runTransaction } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmAWBbW7tTnIQkm2kTcJ-MLrjKHNGKcp4",
  authDomain: "takodeal-pos.firebaseapp.com",
  projectId: "takodeal-pos",
  storageBucket: "takodeal-pos.firebasestorage.app",
  messagingSenderId: "248826111383",
  appId: "1:248826111383:web:48bf1e2c172298079bd0d2"
};

const health = installFirestoreHealth(window, {onLog});
const firestore = guardFirestoreOperations(health, {getDocs, getDoc, addDoc, getDocsFromServer, getDocFromServer,
  updateDoc, deleteDoc, setDoc, writeBatch, onSnapshot, runTransaction, enableNetwork, disableNetwork});
const app = initializeApp(firebaseConfig);
window.deviceFleetConnection={projectId:firebaseConfig.projectId,apiKey:firebaseConfig.apiKey,getToken:()=>window.auth.currentUser?.getIdToken()};

// Expose Core Engines Globally
window.db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
window.auth = getAuth(app);
window.readHQAccountFromServer = createHQAccountReader({projectId:firebaseConfig.projectId,apiKey:firebaseConfig.apiKey,auth:window.auth,
  getAppCheckToken:typeof window.getHQAppCheckToken==='function'?()=>window.getHQAppCheckToken():undefined,
  onDiagnostic:status=>{window.managerAccountCheckStatus=status;}});
window.provider = new GoogleAuthProvider();
window.storage = getStorage(app);

// Expose Firebase Functions Globally (Bridge for main.js)
window.query = query; window.where = where; window.collection = collection;
window.getDocs = firestore.getDocs; window.getDoc = firestore.getDoc; window.addDoc = firestore.addDoc;
window.getDocsFromServer = firestore.getDocsFromServer; window.getDocFromServer = firestore.getDocFromServer;
window.updateDoc = firestore.updateDoc; window.deleteDoc = firestore.deleteDoc; window.doc = doc;
window.setDoc = firestore.setDoc; window.serverTimestamp = serverTimestamp;
window.increment = increment; window.orderBy = orderBy; window.limit = limit;
window.ref = ref; window.uploadBytes = uploadBytes; window.getDownloadURL = getDownloadURL;
window.writeBatch = firestore.writeBatch; window.onSnapshot = firestore.onSnapshot; window.startAfter = startAfter;
window.runTransaction = firestore.runTransaction;
window.enableNetwork = firestore.enableNetwork; window.disableNetwork = firestore.disableNetwork;

// Views share one cache and invalidate it after edits or edits in another tab.
const cache = createCollectionCache(async name => {
    const snap = await firestore.getDocs(collection(window.db, name));
    return snap.docs.map(row => ({id:row.id,...row.data()}));
}, { storage: createDeviceStore(), scope: () => window.sessionUser && window.auth.currentUser?.uid || '' });
const cacheChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('takodeal-manager-cache') : null;
cacheChannel?.addEventListener('message', event => cache.invalidate(event.data));
window.fetchCachedCollection = name => window.sessionUser ? cache.get(name) : Promise.reject(new Error('Unlock the Manager before loading tab data.'));
window.invalidateCache = name => { const pending = cache.invalidate(name); cacheChannel?.postMessage(name); return pending; };
window.clearManagerMemoryCache = () => cache.clearMemory();
