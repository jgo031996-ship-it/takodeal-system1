// ========================================================
// 🔥 1. FIREBASE ENGINE & IMPORTS 
// ========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, collection, addDoc, getDocs, getDoc, query, where, serverTimestamp, doc, updateDoc, limit, orderBy, onSnapshot, setDoc, deleteDoc, enableNetwork, disableNetwork, getDocsFromServer, getDocFromServer, runTransaction, increment, startAfter } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
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
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const storage = getStorage(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache(), experimentalAutoDetectLongPolling: true });

window.db = db; window.storage = storage;
window.auth = auth; window.provider = provider; 
window.query = query; window.where = where; window.collection = collection;
window.getDocs = getDocs; window.getDoc = getDoc; window.addDoc = addDoc;
window.updateDoc = updateDoc; window.deleteDoc = deleteDoc; window.doc = doc;
window.serverTimestamp = serverTimestamp; window.orderBy = orderBy; window.limit = limit;
window.enableNetwork = enableNetwork; 
window.disableNetwork = disableNetwork;


import { installFranchiseWorkspace } from './franchise-workspace.js';
Object.assign(window,{setDoc,getDocsFromServer,getDocFromServer,runTransaction,increment,startAfter});
installFranchiseWorkspace(window);
