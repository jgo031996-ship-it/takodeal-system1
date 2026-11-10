// Fictional records only. Hosted/manual gate: do not start while the user's PC is busy.
// TAKODEAL_TEST_TOOLS must contain runtime.json and the reviewed Firestore emulator jar.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {createPrepHandler,PREP_CASHIER_ORIGIN,PREP_ORIGIN,PREP_OWNER} from '../functions/cash-remittance-review/prep-handler.mjs';
import {createPrepStore} from '../functions/cash-remittance-review/prep-store.mjs';
import {prepTimestampToken} from '../functions/cash-remittance-review/prep-model.mjs';

const host='127.0.0.1',port=8874,projectId='demo-prep-review',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-test Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(root,'functions/cash-remittance-review/package.json'));
const {initializeApp,deleteApp,cert}=req('firebase-admin/app'),{getFirestore,FieldValue}=req('firebase-admin/firestore');
const priorMetadataDetection=process.env.METADATA_SERVER_DETECTION;process.env.METADATA_SERVER_DETECTION='none';
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The local emulator runtime is missing.');
let app,db,child,output='',sequence=0,handler,actor,cashier,input,serviceNow,branch='Test Branch';
const reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});}),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
before(async()=>{
 if(await reachable())throw Error('Refusing an occupied test port.');
 child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-16000));
 const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('The dedicated prep-review emulator did not start: '+output);await pause(100);}
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 app=initializeApp({projectId,credential:cert({projectId,clientEmail:'synthetic-emulator@'+projectId+'.iam.gserviceaccount.com',privateKey})},'prep-review-emulator');db=getFirestore(app);db.settings({host:endpoint,ssl:false});
},{timeout:45000});
beforeEach(async()=>{
 serviceNow=Date.now();branch='Test Branch';++sequence;actor={uid:'test-prep-review-'+sequence,firebase:{sign_in_provider:'anonymous'}};cashier={staffId:'test-prep-crew',deviceId:'DEV-REVIEW-SYNTHETIC',sessionId:'test-prep-review-session-0123456789-'+sequence};input={operationId:'review-emulator-'+sequence,outputInventoryId:'output',qty:2};
 const batch=db.batch();for(const path of ['inventory/raw2','inventory/raw3','inventory/output-alt','bom/recipe-alt'])batch.delete(db.doc(path));
 for(const [path,value]of Object.entries({'hq_managers/owner':{email:PREP_OWNER,role:'Owner',active:true,pin:'SYNTHETIC',permissions:['all']},'branches/test':{name:branch,active:true},'cashiers/test-prep-crew':{cashierName:'SYNTHETIC Crew',branch:'Home Branch',active:true,pin:'TEST-ONLY'},'inventory/output':{name:'Test Sauce',branch,category:'Prepared Batch',baseUom:'Gram',uom:'Gram',purchaseUom:'Batch',conversionRate:1000,currentStock:0},'inventory/raw':{name:'Test Raw',branch,baseUom:'Gram',uom:'Gram',currentStock:5000},'bom/recipe':{menuItem:'Test Sauce',ingredientName:'Test Raw',qty:1000,uom:'Gram'},'transactions/unchanged':{netTotal:123,paymentVerified:true},'payroll_records/unchanged':{isPaid:true,finalNetPay:321}}))batch.set(db.doc(path),value);await batch.commit();await authorize();
 handler=createPrepHandler({store:createPrepStore(db,{serverTimestamp:()=>FieldValue.serverTimestamp(),now:()=>serviceNow}),verifyToken:async(_token,revoked)=>{assert.equal(revoked,true);return actor;},now:()=>serviceNow});
});
after(async()=>{if(db)await db.terminate();if(app)await deleteApp(app);if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(3000)]);}if(priorMetadataDetection===undefined)delete process.env.METADATA_SERVER_DETECTION;else process.env.METADATA_SERVER_DETECTION=priorMetadataDetection;});
async function authorize(){const profile=await db.doc('cashiers/'+cashier.staffId).get(),revision=profile.updateTime.seconds+'|'+profile.updateTime.nanoseconds,batch=db.batch();batch.set(db.doc('staff_login_sessions/'+actor.uid),{schemaVersion:1,uid:actor.uid,app:'cashier',...cashier,branch,profileRevision:revision,expiresAt:new Date(serviceNow+3600000)});batch.set(db.doc('pos_bindings/'+actor.uid),{uid:actor.uid,status:'Active',deviceId:cashier.deviceId,branch,legacyDeviceDocId:'test-device'});batch.set(db.doc('pos_devices/test-device'),{status:'Active',deviceId:cashier.deviceId,branch,appType:'Cashier'});await batch.commit();}
const row=async path=>(await db.doc(path).get()).data();
const call=(route,values=input,extra={})=>{const body={...values,cashier};return handler({method:'POST',path:'/prep/'+route,origin:PREP_CASHIER_ORIGIN,authorization:'Bearer '+'x'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body,...extra});};
const warning=async()=>{const result=await call('preview');assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.code,'prep/review-required');return result.body.review;};
const skip=review=>({...input,branch,declaredName:review.outputName,expectedIssueFingerprint:review.issueFingerprint,skipReason:'SkipForNow'});

test('actual Admin negative raw Skip creates one private Pending review without public alert or stock/log/prep/money writes',async()=>{
 await db.doc('inventory/raw').update({currentStock:-35});const review=await warning();assert.equal(review.issue.code,'invalid-stock-quantity');assert.equal(review.issue.details.recordedStock,-35);const request={...skip(review),note:'Owner please check counted stock.'};
 const [a,b]=await Promise.all([call('review-skip',request),call('review-skip',request)]);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(b.status,200,JSON.stringify(b.body));assert.equal(a.body.stockPosted,false);assert.equal(a.body.sourceFingerprint,review.issueFingerprint);
 const saved=await db.doc('prep_review_requests/'+input.operationId).get(),alert=await db.doc('manager_alerts/prep-review-'+input.operationId).get();assert.equal(saved.exists,true);assert.equal(alert.exists,false);assert.equal(saved.data().status,'Pending');assert.equal(saved.data().qty,2);assert.equal(saved.data().note,request.note);
 assert.equal((await row('inventory/raw')).currentStock,-35);assert.equal((await row('inventory/output')).currentStock,0);assert.equal((await db.doc('prep_operations/'+input.operationId).get()).exists,false);assert.equal((await db.doc('stock_logs/prep-'+input.operationId+'-0').get()).exists,false);assert.deepEqual(await row('transactions/unchanged'),{netTotal:123,paymentVerified:true});assert.deepEqual(await row('payroll_records/unchanged'),{isPaid:true,finalNetPay:321});
 // A discarded success reply must recover the same terminal outcome, not stock prep.
 assert.equal((await call('preview')).body.reviewSaved,true);assert.equal((await call('review-skip',request)).body.reviewId,input.operationId);assert.equal((await call('commit',{operationId:input.operationId,expectedFingerprint:'a'.repeat(64)})).body.code,'prep/review-pending');assert.equal((await db.doc('prep_review_requests/'+input.operationId).get()).updateTime.isEqual(saved.updateTime),true);assert.equal((await db.collection('manager_alerts').get()).size,0);
});
test('actual Admin negative output adds its real batch delta, preserves the deficit and reverses once from nanosecond proofs',async()=>{
 await db.doc('inventory/output').update({currentStock:-5000});const quote=await call('preview');assert.equal(quote.status,200,JSON.stringify(quote.body));assert.equal(quote.body.effects[0].afterStock,-3000);const request={operationId:input.operationId,expectedFingerprint:quote.body.expectedFingerprint};
 const [a,b]=await Promise.all([call('commit',request),call('commit',request)]);assert.ok([a,b].every(result=>result.status===200),JSON.stringify([a,b]));assert.equal([a,b].filter(result=>result.body.alreadySaved===false).length,1);assert.equal((await row('inventory/output')).currentStock,-3000);assert.equal((await row('inventory/raw')).currentStock,3000);
 const op=await db.doc('prep_operations/'+input.operationId).get(),stock=await db.doc('inventory/output').get();assert.equal(prepTimestampToken(op.createTime),prepTimestampToken(stock.updateTime));
 const owner=createPrepHandler({store:createPrepStore(db,{serverTimestamp:()=>FieldValue.serverTimestamp()}),verifyToken:async()=>({uid:'test-owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'}})}),ownerCall=(route,body)=>owner({method:'POST',path:'/prep/'+route,origin:PREP_ORIGIN,authorization:'Bearer '+'x'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body});
 const view=await ownerCall('reversal-preview',{operationId:input.operationId});assert.equal(view.body.canReverse,true,JSON.stringify(view.body));const body={operationId:input.operationId,requestId:'reverse-'+input.operationId,reason:'Duplicate recorded batch was not made',expectedFingerprint:view.body.expectedFingerprint};assert.equal((await ownerCall('reverse',body)).status,200);assert.equal((await ownerCall('reverse',body)).body.alreadyReversed,true);assert.equal((await row('inventory/output')).currentStock,-5000);assert.equal((await row('inventory/raw')).currentStock,5000);
});
test('actual Admin raw shortage is still blocked and cannot be hidden by a negative output',async()=>{
 await db.doc('inventory/output').update({currentStock:-9000});await db.doc('inventory/raw').update({currentStock:100});const review=await warning();assert.equal(review.issue.code,'insufficient-stock');assert.equal((await call('review-skip',skip(review))).status,200);assert.equal((await row('inventory/output')).currentStock,-9000);assert.equal((await row('inventory/raw')).currentStock,100);
});
test('actual Admin source ABA/changed issues and fixed stock reject old warning without saving a review',async()=>{
 await db.doc('inventory/raw').update({currentStock:-1});const review=await warning(),request=skip(review);await db.doc('inventory/raw').update({currentStock:-2});await db.doc('inventory/raw').update({currentStock:-1});assert.equal((await call('review-skip',request)).body.code,'prep/review-changed');assert.equal((await db.doc('prep_review_requests/'+input.operationId).get()).exists,false);await db.doc('inventory/raw').update({currentStock:5000});assert.equal((await call('review-skip',request)).body.code,'prep/review-not-needed');
});
test('actual Admin valid commit wins over an overlapping Skip and never records a false skipped outcome',async()=>{
 const quote=await call('preview'),commit={operationId:input.operationId,expectedFingerprint:quote.body.expectedFingerprint},request={...input,branch,declaredName:'Test Sauce',expectedIssueFingerprint:'a'.repeat(64),skipReason:'SkipForNow'};
 const [saved,review]=await Promise.all([call('commit',commit),call('review-skip',request)]);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.ok(review.status===409&&review.body.code==='prep/review-not-needed'||review.status===200&&review.body.alreadySaved===true,JSON.stringify(review));assert.equal((await db.doc('prep_review_requests/'+input.operationId).get()).exists,false);assert.equal((await row('inventory/raw')).currentStock,3000);assert.equal((await call('review-skip',request)).body.skipped,false);
});
test('actual Admin Skip closes the original private quote and racing original commit cannot post unsafe stock',async()=>{
 const quote=await call('preview');await db.doc('inventory/raw').update({currentStock:-1});
 // A commit failure is a definite non-save from the server, not a network inference.
 const attempt=await call('commit',{operationId:input.operationId,expectedFingerprint:quote.body.expectedFingerprint});assert.equal(attempt.status,409);assert.equal(attempt.body.review.operationId,input.operationId);const request=skip(attempt.body.review);
 const [review,late]=await Promise.all([call('review-skip',request),call('commit',{operationId:input.operationId,expectedFingerprint:quote.body.expectedFingerprint})]);assert.equal(review.status,200,JSON.stringify(review.body));assert.equal(late.status,409);assert.equal((await row('prep_quotes/'+input.operationId)).status,'closed');assert.equal((await db.doc('prep_operations/'+input.operationId).get()).exists,false);assert.equal((await row('inventory/raw')).currentStock,-1);
});
for(const selectedBranch of ['Citygate','Cabantian','Maa','Main Office'])test('actual Admin exact unique whitespace Sauce mapping keeps saved recipe identity in '+selectedBranch,async()=>{
 branch=selectedBranch;await db.doc('branches/test').update({name:branch});await authorize();await db.doc('inventory/output').update({branch,name:'Takoyaki Sauce  Regular'});await db.doc('inventory/raw').update({branch});await db.doc('bom/recipe').update({menuItem:'Takoyaki Sauce Regular'});
 const quote=await call('preview');assert.equal(quote.status,200,JSON.stringify(quote.body));assert.equal(quote.body.recipeMatch.method,'whitespace-only');assert.equal(quote.body.outputName,'Takoyaki Sauce  Regular');assert.equal((await call('commit',{operationId:input.operationId,expectedFingerprint:quote.body.expectedFingerprint})).status,200);const operation=await row('prep_operations/'+input.operationId);assert.equal(operation.recipe[0].id,'recipe');assert.equal(operation.recipe[0].quantityPerBatch,1000);assert.equal(operation.recipeMatch.recipeName,'Takoyaki Sauce Regular');assert.equal((await row('bom/recipe')).menuItem,'Takoyaki Sauce Regular');assert.equal((await row('inventory/raw')).currentStock,3000);
});
test('actual Admin ambiguous whitespace candidates and changed candidate revision cannot reuse source proof',async()=>{
 await db.doc('inventory/output').update({name:'Test  Sauce'});await db.doc('bom/recipe-alt').set({...await row('bom/recipe'),menuItem:' Test Sauce '});const review=await warning();assert.equal(review.issue.code,'recipe-name-ambiguous');await db.doc('bom/recipe-alt').update({note:'Reviewed but still ambiguous'});assert.equal((await call('review-skip',skip(review))).body.code,'prep/review-changed');assert.equal((await row('inventory/raw')).currentStock,5000);
});
test('actual Admin known UID/mirror/source/session revocation blocks new and saved Skip without exposing saved issue',async()=>{
 await db.doc('inventory/raw').update({currentStock:-1});const review=await warning(),request=skip(review);assert.equal((await call('review-skip',request)).status,200);await db.doc('pos_devices/test-device').update({status:'Revoked'});let result=await call('review-skip',request);assert.equal(result.status,403);assert.equal(result.body.issue,undefined);assert.equal(result.body.reviewSaved,undefined);
 await db.doc('pos_devices/test-device').update({status:'Active'});await db.doc('branches/test').update({active:false});result=await call('preview');assert.equal(result.status,409);assert.equal(result.body.issue,undefined);
});
test('actual Admin three duplicate raw sources produce a semantic review with zero consumption',async()=>{
 const raw=await row('inventory/raw'),batch=db.batch();batch.set(db.doc('inventory/raw2'),raw);batch.set(db.doc('inventory/raw3'),raw);await batch.commit();const review=await warning();assert.equal(review.issue.code,'duplicate-ingredient');assert.equal(review.issue.details.matches,3);assert.equal((await call('review-skip',skip(review))).status,200);assert.equal((await row('inventory/raw')).currentStock,5000);assert.equal((await row('inventory/raw2')).currentStock,5000);
});
function ownerApi(changes={}){const owner={uid:'synthetic-owner',email:PREP_OWNER,email_verified:true,firebase:{sign_in_provider:'google.com'},...changes},service=createPrepHandler({store:createPrepStore(db,{serverTimestamp:()=>FieldValue.serverTimestamp()}),verifyToken:async(_token,revoked)=>{assert.equal(revoked,true);return owner;}});return (route,body={})=>service({method:'POST',path:'/prep/'+route,origin:PREP_ORIGIN,authorization:'Bearer '+'x'.repeat(30),contentType:'application/json',query:{},rawSize:Buffer.byteLength(JSON.stringify(body)),body});}
test('actual Admin Owner-only inbox has private exact details and stable bounded twenty-row saved-snapshot pagination',async()=>{
 await db.doc('inventory/raw').update({currentStock:-1});const review=await warning(),note='Private Owner-only note';await call('review-skip',{...skip(review),note});const template=await row('prep_review_requests/'+input.operationId),batch=db.batch();for(let i=0;i<25;i++){const id='pagination-private-'+String(i).padStart(2,'0');batch.create(db.doc('prep_review_requests/'+id),{...template,operationId:id,createdAt:new Date('2099-01-01T00:00:'+String(i).padStart(2,'0')+'Z')});}await batch.commit();
 const read=ownerApi(),first=await read('reviews');assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.reviews.length,20);assert.equal(first.body.hasMore,true);assert.equal(first.body.reviews[0].operationId,'pagination-private-24');assert.equal(first.body.nextAfterOperationId,'pagination-private-05');assert.deepEqual(Object.keys(first.body.reviews[0]).sort(),['operationId','branch','outputInventoryId','outputName','qty','status','stockPosted','createdAt'].sort());
 const second=await read('reviews',{afterOperationId:first.body.nextAfterOperationId});assert.equal(second.status,200,JSON.stringify(second.body));assert.ok(second.body.reviews.length>=5&&second.body.reviews.length<=20);assert.equal(second.body.reviews[0].operationId,'pagination-private-04');assert.ok(second.body.reviews.every(record=>!first.body.reviews.some(prior=>prior.operationId===record.operationId)));
 const detail=await read('review-read',{operationId:input.operationId});assert.equal(detail.status,200);assert.equal(detail.body.review.note,note);assert.equal(detail.body.review.qty,2);assert.equal(detail.body.review.reportedBy.staffId,cashier.staffId);assert.equal(detail.body.review.actorUid,undefined);assert.equal(detail.body.review.sessionId,undefined);assert.equal(detail.body.review.sources,undefined);assert.equal((await db.collection('manager_alerts').get()).size,0);
 assert.equal((await read('reviews',{afterOperationId:'missing-review-reference'})).body.code,'prep/review-unavailable');assert.equal((await read('reviews',{afterOperationId:input.operationId,createdAt:'forged'})).status,400);
});
test('actual Admin private review reads deny Cashier/non-Google/unverified/foreign/revoked Owner without disclosing issue details',async()=>{
 await db.doc('inventory/raw').update({currentStock:-1});const review=await warning();await call('review-skip',skip(review));assert.equal((await call('reviews',{})).status,403);assert.equal((await call('review-read',{operationId:input.operationId})).status,403);
 for(const changes of [{email:'foreign@example.test'},{email_verified:false},{firebase:{sign_in_provider:'password'}}]){const read=ownerApi(changes);assert.equal((await read('reviews')).status,403);assert.equal((await read('review-read',{operationId:input.operationId})).status,403);}
 const read=ownerApi();await db.doc('hq_managers/owner').update({pin:'REVOKED'});const result=await read('review-read',{operationId:input.operationId});assert.equal(result.status,403);assert.equal(result.body.review,undefined);assert.equal((await read('reviews')).status,403);
});
test('actual Admin both private Owner reads honor canonical lifecycle flags and each trimmed credential revocation marker',async()=>{
 await db.doc('inventory/raw').update({currentStock:-1});const review=await warning();await call('review-skip',skip(review));const read=ownerApi(),base={email:PREP_OWNER,role:'Owner',active:true,pin:'SYNTHETIC',permissions:['all']};
 const patches=[{isActive:false},...['disabled','isArchived','isDeleted','revoked','offboarded','resigned','terminated'].map(key=>({[key]:true})),{status:' inactive '},{employmentStatus:' contract ended '},{contractStatus:' revoked '},{pin:' revoked '},{pin:'SYNTHETIC',securityPin:' bLoCkEd '}];
 for(const patch of patches){await db.doc('hq_managers/owner').set({...base,...patch});assert.equal((await read('reviews')).status,403,JSON.stringify(patch));assert.equal((await read('review-read',{operationId:input.operationId})).status,403,JSON.stringify(patch));}
 await db.doc('hq_managers/owner').set({...base,pin:1234,securityPin:5678});assert.equal((await read('reviews')).status,200);assert.equal((await read('review-read',{operationId:input.operationId})).status,200);
});
