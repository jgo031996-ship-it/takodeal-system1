// Fictional data and generated credentials, dedicated loopback project only.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createGCashReconciliationStore} from '../functions/cash-remittance-review/gcash-reconciliation-store.mjs';
import {createGCashReconciliationHandler} from '../functions/cash-remittance-review/gcash-reconciliation-handler.mjs';
import {gcashActor as actor,gcashSettings as settings,gcashRow as row,gcashSale as sale,gcashHQ as hq,gcashSeed as seed,gcashBody as body} from './helpers/gcash-reconciliation-fixture.mjs';
const host='127.0.0.1',port=8847,endpoint=host+':'+port,projectId='demo-gcash-reconciliation-broker';
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing another Firestore endpoint.');process.env.FIRESTORE_EMULATOR_HOST=endpoint;process.env.METADATA_SERVER_DETECTION='none';
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json')),sdkRoot=resolve(process.env.GCASH_TEST_SDK_ROOT||resolve(root,'functions/cash-remittance-review'));
assert.equal(readFileSync(resolve(sdkRoot,'package-lock.json'),'utf8'),readFileSync(resolve(root,'functions/cash-remittance-review/package-lock.json'),'utf8'),'Only byte-identical locked SDK dependencies may be reused');
const admin=createRequire(resolve(sdkRoot,'package.json')),{initializeTestEnvironment}=req('@firebase/rules-unit-testing'),{initializeApp,deleteApp,cert}=admin('firebase-admin/app'),{getFirestore,FieldValue,Timestamp}=admin('firebase-admin/firestore');
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');if(!existsSync(java)||!existsSync(jar))throw Error('Missing local emulator runtime.');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),reachable=()=>new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});
let child,env,db,app,output='';
before(async()=>{
 if(await reachable())throw Error('Refusing occupied emulator port8847.');child=spawn(java,['-Xmx1024m','-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',value=>output=(output+value).slice(-18000));
 const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error('Local emulator startup failed: '+output);await pause(100);}
 env=await initializeTestEnvironment({projectId,firestore:{host,port}});
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 app=initializeApp({projectId,credential:cert({projectId,clientEmail:'synthetic@'+projectId+'.iam.gserviceaccount.com',privateKey})},'gcash-loopback-only');db=getFirestore(app);db.settings({host:endpoint,ssl:false});assert.equal(app.options.projectId,projectId);
},{timeout:45000});
after(async()=>{await db?.terminate();if(app)await deleteApp(app);await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
beforeEach(async()=>env.clearFirestore());
async function seeded(options){const values=[];seed((path,value)=>values.push([path,value]),options);const batch=db.batch();for(const [path,value]of values)batch.set(db.doc(path),value);await batch.commit();}
const store=(database=db)=>createGCashReconciliationStore(database,{serverTimestamp:()=>FieldValue.serverTimestamp()});
const saved=async path=>(await db.doc(path).get()).data();
const financial=async()=>({bank:await saved('cash_accounts/private-bank'),payroll:await saved('payroll_records/paid')});
async function counts(){return Object.fromEntries(await Promise.all(['payment_reconciliation_imports','payment_reconciliation_rows','payment_reconciliation_receipts'].map(async table=>[table,(await db.collection(table).get()).size])));}

test('actual persisted NaN request counter cannot reset its shared quota or touch financial records',async()=>{
 await seeded();const id='gcash-reconciliation-'+createHash('sha256').update(actor.uid+'|0').digest('hex'),before=await financial();await db.doc('cash_remittance_attempts/'+id).set({count:NaN});
 const service=createGCashReconciliationStore(db,{now:()=>0,serverTimestamp:()=>FieldValue.serverTimestamp()});await assert.rejects(service.rate(actor.uid),error=>error.status===429);assert.ok(Number.isNaN((await saved('cash_remittance_attempts/'+id)).count));assert.deepEqual(await financial(),before);assert.deepEqual(Object.values(await counts()),[0,0,0]);
});

test('actual Admin commit and lost-ACK retry preserve money and exact Timestamp nanoseconds with reciprocal immutable claims',async()=>{
 const source=sale({timestamp:new Timestamp(Date.parse('2026-10-31T02:00:00Z')/1000,123456000)});await seeded({sales:[source]});const input=await body({sales:[source]}),before=await financial();
 const first=await store().verify(input,actor);assert.equal(first.verified,1);const claim=await saved('payment_reconciliation_receipts/tx-a'),receipt=await saved('transactions/tx-a');assert.equal(claim.sourceAt.nanoseconds,123456000);assert.notEqual(claim.sourceAt.nanoseconds%1000000,0);assert.equal(receipt.netTotal,100);assert.equal(receipt.paymentVerified,true);assert.deepEqual(await financial(),before);
 assert.deepEqual(await saved('payment_reconciliation_rows/'+claim.claimId),claim);const beforeCounts=await counts(),replay=await store().verify(input,actor);assert.equal(replay.alreadyVerified,1);assert.equal(replay.verified,0);assert.deepEqual(await counts(),beforeCounts);
});
test('two actual concurrent retries of one exact file serialize to one verification and one already-saved result',async()=>{
 await seeded();const input=await body(),outcomes=await Promise.all([store().verify(input,actor),store().verify(input,actor)]);assert.equal(outcomes.reduce((sum,row)=>sum+row.verified,0),1);assert.equal(outcomes.reduce((sum,row)=>sum+row.alreadyVerified,0),1);assert.deepEqual(Object.values(await counts()),[1,1,1]);
},{timeout:20000});
test('different external references cannot concurrently claim the same legacy receipt or create an orphan import',async()=>{
 const source=sale({customerName:''});await seeded({sales:[source]});const one=await body({rows:[row({reference:'0001'})],sales:[source]}),two=await body({rows:[row({reference:'0002'})],sales:[source],fileSha256:'b'.repeat(64)}),outcomes=await Promise.allSettled([store().verify(one,actor),store().verify(two,actor)]);
 assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected').length,1);assert.deepEqual(Object.values(await counts()),[1,1,1]);assert.equal((await saved('transactions/tx-a')).netTotal,100);
},{timeout:20000});
test('fresh source, bridge, role, index and branch revocation deny without modifying any business record',async()=>{
 for(const patch of [{table:'hq_email_access',id:actor.email,data:{active:false}},{table:'hq_managers',id:'owner',data:{...hq(),blocked:true}},{table:'hq_account_index',id:actor.email,data:{active:false}}]){
  await env.clearFirestore();await seeded();const input=await body(),before=await financial();await db.doc(patch.table+'/'+patch.id).set(patch.data);await assert.rejects(store().verify(input,actor),error=>error.status===403);assert.equal((await saved('transactions/tx-a')).paymentVerified,false);assert.deepEqual(Object.values(await counts()),[0,0,0]);assert.deepEqual(await financial(),before);
 }
});
test('historical receipt at a known closed branch remains eligible, while duplicate branch registration is held',async()=>{
 await seeded();await db.doc('branches/maa').set({name:'Maa',status:'Closed',active:false,archived:true});const input=await body(),result=await store().verify(input,actor);assert.equal(result.verified,1);assert.equal((await saved('transactions/tx-a')).netTotal,100);
 await env.clearFirestore();await seeded();await db.doc('branches/duplicate').set({name:'Maa'});await assert.rejects(store().verify(await body(),actor),error=>error.status===403);assert.equal((await saved('transactions/tx-a')).paymentVerified,false);
});
test('replay holds altered verification actor or sub-millisecond audit timestamp despite unchanged payment fingerprint',async()=>{
 for(const kind of ['actor','time']){
  await env.clearFirestore();await seeded();const input=await body();await store().verify(input,actor);const receipt=await saved('transactions/tx-a'),timestamp=receipt.verifiedAt;
  const later=timestamp.nanoseconds>=999999000?new Timestamp(timestamp.seconds+1,0):new Timestamp(timestamp.seconds,timestamp.nanoseconds+1000);
  await db.doc('transactions/tx-a').update(kind==='actor'?{verifiedBy:'other@example.test'}:{verifiedAt:later});const before=await counts();await assert.rejects(store().verify(input,actor),error=>error.status===409);assert.deepEqual(await counts(),before);
 }
});
test('source and refund changes after matching queries are rechecked transactionally before verification',async()=>{
 for(const kind of ['amount','refund','prior-metadata','duplicate-receipt']){
  await env.clearFirestore();await seeded();let injected=false;
  const database={doc:path=>db.doc(path),runTransaction:work=>db.runTransaction(work),collection:table=>{
   const query=db.collection(table);if(table!=='transactions')return query;
   const wrap=value=>new Proxy(value,{get(target,key){if(key==='get')return async()=>{const snapshot=await target.get();if(!injected){injected=true;if(kind==='amount')await db.doc('transactions/tx-a').update({netTotal:101});else if(kind==='prior-metadata')await db.doc('transactions/tx-a').update({paymentReconciliationVersion:1,paymentReconciliationId:'other-evidence'});else if(kind==='duplicate-receipt')await db.doc('transactions/concurrent-receipt').set(sale({id:'concurrent-receipt'}));else await db.doc('online_order_incidents/online-refund-tx-a').set({status:'Pending Review'});}return snapshot;};const member=target[key];return typeof member==='function'? (...args)=>{const next=member.apply(target,args);return next&&typeof next.get==='function'?wrap(next):next;}:member;}});return wrap(query);
  }};
  await assert.rejects(store(database).verify(await body(),actor),error=>error.status===409);assert.equal((await saved('transactions/tx-a')).paymentVerified,false);assert.deepEqual(Object.values(await counts()),[0,0,0]);
 }
});
test('per-row partial completion survives a later revocation and an exact retry recovers without repeating its earlier claim',async()=>{
 const sales=[sale({paymentReference:'00001234'}),sale({id:'tx-b',paymentReference:'00005678',customerName:'00005678'})],rows=[row(),row({rowId:'r2',reference:'00005678'})];await seeded({sales});let revoked=false;
 const database={doc:path=>db.doc(path),collection:table=>db.collection(table),runTransaction:async work=>{
  let created=false;const result=await db.runTransaction(tx=>work(new Proxy(tx,{get(target,key){if(key==='create')return(ref,...args)=>{if(ref.path.startsWith('payment_reconciliation_receipts/'))created=true;return target.create(ref,...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}})));
  if(created&&!revoked){revoked=true;await db.doc('hq_email_access/'+actor.email).set({active:false});}return result;
 }};
 const input=await body({rows,sales});await assert.rejects(store(database).verify(input,actor),error=>error.status===403);assert.equal((await saved('transactions/tx-a')).paymentVerified,true);assert.equal((await saved('transactions/tx-b')).paymentVerified,false);assert.deepEqual(Object.values(await counts()),[1,1,1]);
 await db.doc('hq_email_access/'+actor.email).set({active:true,role:'Owner',permissions:['all'],allowedBranches:['All']});const resumed=await store().verify(input,actor);assert.equal(resumed.alreadyVerified,1);assert.equal(resumed.verified,1);assert.deepEqual(Object.values(await counts()),[1,2,2]);
},{timeout:20000});
test('handler rejects forged token, non-Owner Google and arbitrary eligible flags before source or financial access',async()=>{
 await seeded();const input=await body(),base={origin:'https://takodeal-owner.vercel.app',path:'/gcash-reconciliation/verify',method:'POST',query:{},contentType:'application/json',rawSize:JSON.stringify(input).length,body:input,authorization:'Bearer SYNTHETIC_GOOGLE_TOKEN_123456789'};
 for(const verifyToken of [async()=>{throw Error('SYNTHETIC_INVALID_SIGNATURE');},async()=>({...actor,email:'manager@example.test'})]){const handler=createGCashReconciliationHandler({verifyToken,store:store()});assert.ok([401,403].includes((await handler(base)).status));}
 const handler=createGCashReconciliationHandler({verifyToken:async()=>actor,store:store()});assert.equal((await handler({...base,body:{...input,eligible:true}})).status,400);assert.equal((await saved('transactions/tx-a')).paymentVerified,false);assert.deepEqual(Object.values(await counts()),[0,0,0]);
});
test('conflicting import metadata or settings revision never partially verifies a receipt; exact settings save recovers',async()=>{
 await seeded();const input=await body();await db.doc('payment_reconciliation_imports/'+input.fileSha256).set({schemaVersion:1,fileSha256:input.fileSha256,rowCount:9});await assert.rejects(store().verify(input,actor),error=>error.status===409);assert.equal((await saved('transactions/tx-a')).paymentVerified,false);assert.equal((await db.collection('payment_reconciliation_rows').get()).size,0);
 const desired={...settings(),revision:2};desired.providers.GCash.timeToleranceMinutes=5;await store().saveSettings({settings:desired,expectedRevision:1},actor);const result=await store().saveSettings({settings:desired,expectedRevision:1},actor);assert.equal(result.settings.revision,2);await assert.rejects(store().verify(input,actor),error=>error.status===409);
});
