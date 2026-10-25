import {initializeApp,getApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {getFirestore,doc,getDocFromServer,runTransaction,serverTimestamp,query,where,collection,getDocsFromServer} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {createDocumentStore} from './staff-document-store.js';
import {guardFirestoreOperations} from './firestore-health.js';
export const documentSdk={doc,getDocFromServer,runTransaction,serverTimestamp,query,where,collection,getDocsFromServer,onAuthStateChanged};
export async function createStaffDocumentFirebase(config,identity,{isHQ=false}={}) {
    let app;
    if(isHQ)app=getApp();
    else { try {app=getApp('staff-private-documents');} catch {app=initializeApp(config,'staff-private-documents');} }
    const auth=getAuth(app),db=getFirestore(app);
    if(!isHQ && !auth.currentUser)await signInAnonymously(auth);
    const sdk=isHQ ? guardFirestoreOperations(window.managerCloudHealth,documentSdk) : documentSdk;
    return {auth,db,sdk,store:createDocumentStore({sdk,auth,db,identity,isHQ})};
}
