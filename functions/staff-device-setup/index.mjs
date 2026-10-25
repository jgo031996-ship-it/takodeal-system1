import {initializeApp,getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {onRequest} from 'firebase-functions/v2/https';
import {createStaffDeviceSetup,PRODUCTION_ORIGINS} from './service.mjs';

// ADC only; no exported keys, client-side verifier or client impersonation.
const app=getApps().find(candidate=>candidate.name==='staff-device-setup')||initializeApp({projectId:'takodeal-pos'},'staff-device-setup');
const db=getFirestore(app);
const handle=createStaffDeviceSetup({
 verifyToken:(token,checkRevoked)=>getAuth(app).verifyIdToken(token,checkRevoked),
 allowedOrigins:PRODUCTION_ORIGINS,
 store:{transaction:callback=>db.runTransaction(tx=>callback({
  async get(path){const snapshot=await tx.get(db.doc(path));return snapshot.exists?snapshot.data():null;},
  set:(path,data)=>tx.set(db.doc(path),data),
  delete:path=>tx.delete(db.doc(path))
 }))}
});
export const staffDeviceSetup=onRequest({
 region:'asia-southeast1',memory:'512MiB',cpu:1,concurrency:4,minInstances:0,maxInstances:2,
 timeoutSeconds:30,cors:false,invoker:'public',serviceAccount:'staff-device-setup@takodeal-pos.iam.gserviceaccount.com'
},async(request,response)=>{
 // Never trust a client-provided forwarding header as a rate-limit identity.
 // The socket peer is trusted transport evidence, though Cloud Run's proxy can
 // group several clients under one bucket. UID and global limits also apply.
 const result=await handle({method:request.method,path:request.path,query:request.query,
  origin:request.get('Origin'),contentType:request.get('Content-Type'),authorization:request.get('Authorization'),
  rawSize:request.rawBody?.length,body:request.body,trustedIP:request.socket?.remoteAddress,
  preflightMethod:request.get('Access-Control-Request-Method'),preflightHeaders:request.get('Access-Control-Request-Headers')});
 response.status(result.status).set(result.headers);if(result.body===null)response.end();else response.json(result.body);
});
