import {initializeApp,getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {onRequest} from 'firebase-functions/v2/https';
import {createBranchScheduleProposals} from './service.mjs';
const app=getApps().find(item=>item.name==='branch-schedule-proposals')||initializeApp({projectId:'takodeal-pos'},'branch-schedule-proposals'),db=getFirestore(app);
const handle=createBranchScheduleProposals({verifyToken:(token,revoked)=>getAuth(app).verifyIdToken(token,revoked),store:{transaction:callback=>db.runTransaction(tx=>{
 const reads=new Map();let wrote=false;
 return callback({get(path){if(wrote)throw Error('Read all proposal references before writing.');if(!reads.has(path)){if(reads.size>=500)throw Error('The saved schedule needs an HQ history review.');reads.set(path,tx.get(db.doc(path)).then(row=>row.exists?row.data():null));}return reads.get(path);},set(path,data){wrote=true;tx.set(db.doc(path),data);}});
})}});
export const branchScheduleProposals=onRequest({region:'asia-southeast1',memory:'256MiB',cpu:1,concurrency:4,minInstances:0,maxInstances:2,timeoutSeconds:60,cors:false,invoker:'public',serviceAccount:'branch-schedule-proposals@takodeal-pos.iam.gserviceaccount.com'},async(request,response)=>{
 const result=await handle({method:request.method,path:request.path,query:request.query,origin:request.get('Origin'),contentType:request.get('Content-Type'),authorization:request.get('Authorization'),rawSize:request.rawBody?.length,body:request.body,trustedIP:request.socket?.remoteAddress,preflightMethod:request.get('Access-Control-Request-Method'),preflightHeaders:request.get('Access-Control-Request-Headers')});
 response.status(result.status).set(result.headers);if(result.body===null)response.end();else response.json(result.body);
});
