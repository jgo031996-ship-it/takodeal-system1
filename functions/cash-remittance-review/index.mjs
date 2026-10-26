import {initializeApp,getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {onRequest} from 'firebase-functions/v2/https';
import {createCashRemittanceReview} from './service.mjs';
import {createCashRemittanceStore} from './store.mjs';
const app=getApps().find(value=>value.name==='cash-remittance-review')||initializeApp({projectId:'takodeal-pos'},'cash-remittance-review'),db=getFirestore(app);
const serialize=value=>value?.toDate?value.toDate().toISOString():value instanceof Date?value.toISOString():Array.isArray(value)?value.map(serialize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,serialize(item)])):value;
const handle=createCashRemittanceReview({verifyToken:(token,revoked)=>getAuth(app).verifyIdToken(token,revoked),store:createCashRemittanceStore(db)});
export const cashRemittanceReview=onRequest({region:'asia-southeast1',memory:'256MiB',cpu:1,concurrency:4,minInstances:0,maxInstances:2,timeoutSeconds:60,cors:false,invoker:'public',serviceAccount:'cash-remittance-review@takodeal-pos.iam.gserviceaccount.com'},async(request,response)=>{
 const result=await handle({method:request.method,path:request.path,query:request.query,origin:request.get('Origin'),contentType:request.get('Content-Type'),authorization:request.get('Authorization'),rawSize:request.rawBody?.length,body:request.body,trustedIP:request.socket?.remoteAddress,preflightMethod:request.get('Access-Control-Request-Method'),preflightHeaders:request.get('Access-Control-Request-Headers')});response.status(result.status).set(result.headers);if(result.body===null)response.end();else response.json(serialize(result.body));
});
