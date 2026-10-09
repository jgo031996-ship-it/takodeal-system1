import {initializeApp,getApp} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import {getFirestore,doc,getDocFromServer,runTransaction,serverTimestamp,query,where,collection,getDocsFromServer} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
import {createDocumentStore} from './staff-document-store.js';
export const documentSdk={doc,getDocFromServer,runTransaction,serverTimestamp,query,where,collection,getDocsFromServer,onAuthStateChanged};
export async function createStaffDocumentFirebase(config,identity,{isHQ=false}={}) {
    let app;
    if(isHQ)app=getApp();
    else { try {app=getApp('staff-private-documents');} catch {app=initializeApp(config,'staff-private-documents');} }
    const auth=getAuth(app),db=getFirestore(app);
    if(!isHQ && !auth.currentUser)await signInAnonymously(auth);
    return {auth,db,sdk:documentSdk,store:createDocumentStore({sdk:documentSdk,auth,db,identity,isHQ})};
}
