import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createGCashReconciliationMutations,GCASH_RECONCILIATION_ENDPOINT,reconciliationMappedRows} from '../takodeal-manager/gcash-reconciliation-client.js';
import {createPaymentReconciliationService} from '../takodeal-manager/payment-reconciliation-service.js';
import {createGCashReconciliationStore} from '../functions/cash-remittance-review/gcash-reconciliation-store.mjs';
import {createGCashReconciliationHandler} from '../functions/cash-remittance-review/gcash-reconciliation-handler.mjs';
import {adminMemory} from './helpers/admin-memory.mjs';
import {gcashActor as actor,gcashRow as row,gcashSettings as settings,gcashSeed as seed,gcashFile as fileSha256} from './helpers/gcash-reconciliation-fixture.mjs';
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({fetcher,timeoutMs}={}){
 const h=adminMemory();seed(h.put);const calls=[],user={uid:actor.uid,email:actor.email,emailVerified:true,providerData:[{providerId:'google.com'}],getIdToken:async()=>'SYNTHETIC_OWNER_TOKEN_123456789'};
 const api={auth:{currentUser:user},sessionUser:{uid:actor.uid,email:actor.email,isOwner:true,isFranchisee:false,permissions:['all'],allowedBranches:['All']},isBranchAllowed:()=>true,db:h.db,doc:(_db,table,id)=>h.db.doc(table+'/'+id),collection:(_db,table)=>h.db.collection(table),where:(field,op,value)=>({field,op,value}),limit:count=>({count}),query:(ref,...filters)=>filters.reduce((q,c)=>c.field?q.where(c.field,c.op,c.value):q.limit(c.count),ref),getDocFromServer:async ref=>({id:ref.path.split('/')[1],metadata:{fromCache:false,hasPendingWrites:false},exists:()=>h.rows.has(ref.path),data:()=>h.get(ref.path)}),getDocsFromServer:async query=>{const snapshot=await query.get();return{metadata:{fromCache:false,hasPendingWrites:false},docs:snapshot.docs.map(doc=>({...doc,exists:()=>doc.exists,metadata:{fromCache:false,hasPendingWrites:false}}))};},runTransaction(){throw Error('Configured browser mutations must never write Firestore');},serverTimestamp(){throw Error('No browser mutation timestamp');}};
 const handler=createGCashReconciliationHandler({verifyToken:async(_token,revoked)=>{assert.equal(revoked,true);return actor;},store:createGCashReconciliationStore(h.db,{serverTimestamp:h.serverTimestamp})});
 const mutations=createGCashReconciliationMutations(api,{timeoutMs:timeoutMs||25000,fetcher:async(url,request)=>{calls.push({url,request});if(fetcher)return fetcher(url,request);const parsed=new URL(url),body=JSON.parse(request.body),result=await handler({origin:'https://takodeal-owner.vercel.app',path:parsed.pathname.replace('/cashRemittanceReview',''),method:request.method,query:{},contentType:'application/json',authorization:request.headers.Authorization,rawSize:Buffer.byteLength(request.body),body});return{ok:result.status===200,status:result.status,url,json:async()=>result.body};}});
 return{...h,api,user,calls,mutations,service:createPaymentReconciliationService(api,{crypto:webcrypto,mutations})};
}
test('actual browser service keeps CSV preview local and uses the trusted broker exclusively for atomic mutation and replay',async()=>{
 const h=fixture(),plan=await h.service.preview({fileSha256,rows:[row({feeAmount:'2',netAmount:'98',sourceProduct:'LOCAL_PRIVATE_PRODUCT'})]});
 assert.equal(plan.matches.length,1);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
 const result=await h.service.verify(plan);assert.equal(result.verified,1);assert.equal(h.get('transactions/tx-a').netTotal,100);assert.equal(h.get('transactions/tx-a').paymentVerified,true);
 assert.equal(h.calls[0].url,GCASH_RECONCILIATION_ENDPOINT+'/verify');assert.equal(h.calls[0].request.credentials,'omit');assert.equal(h.calls[0].request.redirect,'error');assert.doesNotMatch(h.calls[0].request.body,/LOCAL_PRIVATE_PRODUCT|feeAmount|netAmount|automaticEligible|"source"/);
 const replay=await h.service.verify(plan);assert.equal(replay.alreadyVerified,1);assert.equal(h.calls.length,2);
});
test('settings optional-hook integration never falls back to browser writes on success or a rejected transport',async()=>{
 const h=fixture(),desired=settings();desired.providers.GCash.timeToleranceMinutes=5;const result=await h.service.saveSettings(desired,{expectedRevision:1});assert.equal(result.revision,2);assert.equal(h.get('payment_reconciliation_settings/main').revision,2);assert.equal(h.calls[0].url,GCASH_RECONCILIATION_ENDPOINT+'/settings');
 const denied=fixture({fetcher:async()=>({ok:false,status:503,json:async()=>({message:'PRIVATE_SOURCE'})})});await assert.rejects(denied.service.saveSettings(desired,{expectedRevision:1}),error=>!error.message.includes('PRIVATE_SOURCE'));assert.equal(denied.writes.length,0);
});
test('mapped request evidence excludes raw CSV, payer names, contact, products, fees, net and parser text',()=>{
 const rows=reconciliationMappedRows([{...row(),rawCSV:'PRIVATE_CSV',customerName:'PRIVATE_NAME',phone:'PRIVATE_PHONE',sourceProduct:'PRIVATE_PRODUCT',feeAmount:'2',netAmount:'98',parseError:'PRIVATE_FORMULA'}]);
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_|feeAmount|netAmount|customerName|phone|rawCSV/);assert.equal(rows[0].parseError,true);
});
test('late token and replaced same-UID Owner session cannot dispatch or accept another context',async()=>{
 const token=deferred(),h=fixture();h.user.getIdToken=()=>token.promise;const work=h.mutations.saveSettings({...settings(),revision:2},{expectedRevision:1});await tick();h.api.sessionUser={...h.api.sessionUser};token.resolve('SYNTHETIC_OLD_TOKEN');await assert.rejects(work,/workspace changed/);assert.equal(h.calls.length,0);
 const response=deferred(),other=fixture({fetcher:async()=>response.promise});const pending=other.mutations.saveSettings({...settings(),revision:2},{expectedRevision:1});await tick();other.api.auth.currentUser={...other.user};response.resolve({ok:true,json:async()=>({schemaVersion:1,settings:{...settings(),revision:2}})});await assert.rejects(pending,/workspace changed/);
});
test('retired token timeout cannot send the PIN-free mutation later and preserves all local state',async()=>{
 const token=deferred(),h=fixture({timeoutMs:5});h.user.getIdToken=()=>token.promise;const before=structuredClone([...h.rows]);await assert.rejects(h.mutations.saveSettings({...settings(),revision:2},{expectedRevision:1}),{code:'payment-reconciliation-unconfirmed'});token.resolve('SYNTHETIC_LATE_TOKEN');await tick();assert.equal(h.calls.length,0);assert.deepEqual([...h.rows],before);
});
test('malformed, foreign or redirected responses never claim a verified result or expose remote source text',async()=>{
 for(const response of [{ok:true,redirected:true,json:async()=>({})},{ok:true,json:async()=>({schemaVersion:1,settings:settings()})},{ok:false,status:403,json:async()=>({message:'PRIVATE_SERVER_SOURCE'})}]){
  const h=fixture({fetcher:async()=>response});await assert.rejects(h.mutations.saveSettings({...settings(),revision:2},{expectedRevision:1}),error=>!error.message.includes('PRIVATE_'));assert.equal(h.writes.length,0);
 }
});
test('one explicit approval sends at most25 exact candidates per call and preserves authoritative new/already counts',async()=>{
 const calls=[],h=fixture({fetcher:async(_url,request)=>{const input=JSON.parse(request.body);calls.push(input);return{ok:true,json:async()=>({schemaVersion:1,verified:input.matches.length,alreadyVerified:input.alreadyVerified.length,held:[],results:[...input.alreadyVerified.map(row=>({...row,alreadyVerified:true})),...input.matches.map(row=>({...row,alreadyVerified:false}))].map(row=>({transactionId:row.transactionId,claimId:row.claimId,alreadyVerified:row.alreadyVerified,fileSha256}))})};}});
 const rows=Array.from({length:51},(_,index)=>row({rowId:'row-'+index})),matches=rows.map((row,index)=>({rowId:row.rowId,rowIndex:index,transactionId:'receipt-'+index,claimId:index.toString(16).padStart(64,'0'),sourceFingerprint:'b'.repeat(64),automaticEligible:true}));
 const result=await h.mutations.verify({plan:{fileSha256,settingsRevision:1,settingsFingerprint:'c'.repeat(64),matches,unresolved:[]},rows});assert.deepEqual(calls.map(row=>row.matches.length),[25,25,1]);assert.equal(result.verified,51);assert.equal(result.alreadyVerified,0);
});
