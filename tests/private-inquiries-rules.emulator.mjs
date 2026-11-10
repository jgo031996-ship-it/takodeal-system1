// Fictional records, real Firebase SDK and loopback Rules emulator only.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
// Fictional server-owned index fixture; these fields match the live index's
// sourceAccess contract. No production index or business data is loaded.
const sourceFields=['email','role','permissions','assignedBranch','active','isActive','blocked','status','disabled','archived','isArchived','deleted','isDeleted','revoked','offboarded','resigned','terminated','employmentStatus','contractStatus'];
const hqSourceAccess=row=>Object.fromEntries(sourceFields.map(key=>[key,row[key]??null]));
const host='127.0.0.1',port=8858,projectId='demo-private-inquiries',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing non-test endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(process.env.TAKODEAL_TEST_TOOLS||resolve(root,'../staff-nextlevel-tools')),req=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=req('@firebase/rules-unit-testing'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,query,where,orderBy,limit,writeBatch,serverTimestamp,Timestamp,deleteField}=sdk;
const {java}=JSON.parse(readFileSync(resolve(tools,'runtime.json'))),jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');let child,env,output='';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),reachable=()=>new Promise(done=>{const socket=createConnection({host,port});socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>done(false));socket.once('timeout',()=>{socket.destroy();done(false);});});
before(async()=>{if(await reachable())throw Error('Occupied test port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-24000));const until=Date.now()+30000;while(!await reachable()){if(child.exitCode!==null||Date.now()>until)throw Error(output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:45000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});beforeEach(async()=>env.clearFirestore());
const google=(uid,email,extra={})=>env.authenticatedContext(uid,{email,email_verified:true,firebase:{sign_in_provider:'google.com'},...extra}).firestore();
const own=()=>google('sample-customer','own@example.test'),other=()=>google('sample-foreign','foreign@example.test'),owner=()=>google('sample-owner','jgo031996@gmail.com');
const anonymous=()=>env.authenticatedContext('sample-anonymous',{firebase:{sign_in_provider:'anonymous'}}).firestore(),publicDB=()=>env.unauthenticatedContext().firestore();
const seed=rows=>env.withSecurityRulesDisabled(async c=>{for(const [path,row]of Object.entries(rows))await setDoc(doc(c.firestore(),path),row);});
const branch='Synthetic Branch',items=[{name:'Synthetic Food',quantity:1,price:100,notes:'SYNTHETIC PRIVATE NOTE'}];
const order=()=>({customerEmail:'own@example.test',customerName:'Synthetic Customer',status:'completed',orderCode:'SYNTHETIC-CODE',branch,orderType:'Delivery',items});
const review=(extra={})=>({version:1,orderId:'order',orderCode:'SYNTHETIC-CODE',branch,orderType:'Delivery',sourceItems:items,totalItemsCount:1,text:'Synthetic feedback',timestamp:Timestamp.now(),customer:'Synthetic Customer',email:'own@example.test',status:'Pending',isPublished:false,...extra});
const lead=(extra={})=>({name:'Synthetic Person',phone:'09000000000',email:'inquiry@example.test',location:'Synthetic City',formatInterest:'undecided',status:'Pending',timestamp:serverTimestamp(),...extra});
const feedback=(extra={})=>({text:'Synthetic feedback',timestamp:serverTimestamp(),customerName:'Anonymous Guest',email:'None',...extra});
async function hq({permissions=['customerapp'],branches=[branch],bridge,profileExtra={},indexExtra={}}={}){
 const email='hq@example.test',uid='sample-hq',profile={email,uid,role:'Manager',permissions,assignedBranch:branches,active:true,pin:'1234',...profileExtra};
 const index={schemaVersion:1,email,active:true,ambiguous:false,role:profile.role,permissions,allowedBranches:branches,sourceProfileId:'sample-hq',sourceAccess:hqSourceAccess(profile),...indexExtra};
 await seed({'hq_managers/sample-hq':profile,['hq_account_index/'+email]:index,...(bridge?{['hq_email_access/'+email]:bridge}:{})});
 return google(uid,email);
}
test('own Google review reads and exact-email loyalty query succeed; public and foreign access fail',async()=>{
 await seed({'reviews/review-order':review()});const db=own();
 await assertSucceeds(getDocFromServer(doc(db,'reviews/review-order')));
 assert.equal((await assertSucceeds(getDocsFromServer(query(collection(db,'reviews'),where('email','==','own@example.test'))))).size,1);
 for(const bad of [publicDB(),anonymous(),other(),google('unverified','own@example.test',{email_verified:false}),google('password','own@example.test',{firebase:{sign_in_provider:'password'}})]){
  await assertFails(getDocFromServer(doc(bad,'reviews/review-order')));await assertFails(getDocsFromServer(collection(bad,'reviews')));
 }
 await assertFails(getDocsFromServer(query(collection(db,'reviews'),where('email','==','foreign@example.test'))));
 await assertFails(getDocsFromServer(query(collection(db,'reviews'),orderBy('timestamp','desc'),limit(30))));
});
test('review missing-document lookup supports fresh canonical Customer transaction without exposing saved foreign rows',async()=>{
 const db=own();assert.equal((await assertSucceeds(getDocFromServer(doc(db,'reviews/review-order')))).exists(),false);
 await seed({'reviews/review-foreign':review({email:'foreign@example.test'})});await assertFails(getDocFromServer(doc(db,'reviews/review-foreign')));
});
test('actual canonical review plus source prompt marker commits once with saved source fields',async()=>{
 await seed({'incoming_orders/order':order()});const db=own(),batch=writeBatch(db);
 batch.set(doc(db,'reviews/review-order'),review({timestamp:serverTimestamp()}));batch.update(doc(db,'incoming_orders/order'),{reviewPrompted:true});
 await assertSucceeds(batch.commit());const saved=await getDocFromServer(doc(db,'reviews/review-order'));assert.equal(saved.data().status,'Pending');assert.equal(saved.data().isPublished,false);
 await assertFails(setDoc(doc(db,'reviews/review-order'),review({timestamp:serverTimestamp()})));
});
test('forged review identity, source, status, publication, timestamp and extra fields are denied',async()=>{
 await seed({'incoming_orders/order':{...order(),reviewPrompted:true}});const db=own();
 for(const extra of [{email:'foreign@example.test'},{orderCode:'FORGED'},{branch:'Foreign Branch'},{customer:'FORGED'},{sourceItems:[{name:'FORGED'}]},{totalItemsCount:2},{status:'Approved'},{isPublished:true},{text:' '},{text:'a'.repeat(1501)},{timestamp:Timestamp.fromMillis(0)},{secret:'FORGED'}])await assertFails(setDoc(doc(db,'reviews/review-order'),review({timestamp:serverTimestamp(),...extra})));
 await assertFails(setDoc(doc(db,'reviews/random-id'),review({timestamp:serverTimestamp()})));
 for(const bad of [publicDB(),anonymous(),other()])await assertFails(setDoc(doc(bad,'reviews/review-order'),review({timestamp:serverTimestamp()})));
});
test('incomplete or unacknowledged source prevents review creation',async()=>{
 const db=own();for(const status of ['preparing','ready']){await seed({'incoming_orders/order':{...order(),status,reviewPrompted:true}});await assertFails(setDoc(doc(db,'reviews/review-order'),review({timestamp:serverTimestamp()})));}
 await seed({'incoming_orders/order':order()});await assertFails(setDoc(doc(db,'reviews/review-order'),review({timestamp:serverTimestamp()})));
});
test('Customer cannot change review text, identity, status or publication after creation',async()=>{
 await seed({'reviews/review-order':review()});const db=own();for(const patch of [{text:'FORGED'},{email:'foreign@example.test'},{branch:'Foreign Branch'},{status:'Approved',isPublished:true}])await assertFails(updateDoc(doc(db,'reviews/review-order'),patch));await assertFails(deleteDoc(doc(db,'reviews/review-order')));
});
test('Owner can list and approve or hide a saved review, but cannot rewrite or delete its evidence',async()=>{
 await seed({'reviews/review-order':review()});const db=owner();await assertSucceeds(getDocsFromServer(collection(db,'reviews')));
 await assertSucceeds(updateDoc(doc(db,'reviews/review-order'),{status:'Approved',isPublished:true}));await assertSucceeds(updateDoc(doc(db,'reviews/review-order'),{status:'Hidden',isPublished:false}));
 for(const patch of [{status:'Approved',isPublished:false},{text:'FORGED',status:'Approved',isPublished:true},{email:deleteField()}])await assertFails(updateDoc(doc(db,'reviews/review-order'),patch));await assertFails(deleteDoc(doc(db,'reviews/review-order')));
});
test('fresh branch HQ can query and moderate only its saved customerapp review branch',async()=>{
 await seed({'reviews/review-order':review(),'reviews/foreign':review({branch:'Foreign Branch'})});const db=await hq();
 await assertSucceeds(getDocsFromServer(query(collection(db,'reviews'),where('branch','in',[branch]),orderBy('timestamp','desc'),limit(101))));
 await assertSucceeds(updateDoc(doc(db,'reviews/review-order'),{status:'Approved',isPublished:true}));
 await assertFails(getDocsFromServer(collection(db,'reviews')));await assertFails(getDocFromServer(doc(db,'reviews/foreign')));await assertFails(updateDoc(doc(db,'reviews/foreign'),{status:'Approved',isPublished:true}));
});
test('stale source, revoked PIN, disabled or ambiguous index and foreign UID deny private review access',async()=>{
 for(const kind of ['source','pin','securityPin','index','ambiguous','uid']){
  await env.clearFirestore();await seed({'reviews/review-order':review()});const db=await hq();
  const patch=kind==='source'?{active:false}:kind==='pin'?{pin:' blocked '}:kind==='securityPin'?{securityPin:' revoked '}:kind==='uid'?{uid:'foreign-uid'}:null;
  if(patch)await seed({'hq_managers/sample-hq':{email:'hq@example.test',uid:'sample-hq',role:'Manager',permissions:['customerapp'],assignedBranch:[branch],active:true,pin:'1234',...patch}});
  else await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'hq_account_index/hq@example.test'),kind==='index'?{active:false}:{ambiguous:true}));
  await assertFails(getDocFromServer(doc(db,'reviews/review-order')));
 }
});
test('optional HQ bridge intersects both permissions and branches rather than expanding access',async()=>{
 await seed({'reviews/review-order':review()});const db=await hq({bridge:{active:true,role:'Manager',permissions:['all'],allowedBranches:['All']}});await assertSucceeds(getDocFromServer(doc(db,'reviews/review-order')));
 await seed({'hq_email_access/hq@example.test':{active:true,role:'Manager',permissions:['crm'],allowedBranches:['All']}});await assertFails(getDocFromServer(doc(db,'reviews/review-order')));
 await seed({'hq_email_access/hq@example.test':{active:true,role:'Manager',permissions:['customerapp'],allowedBranches:['Foreign Branch']}});await assertFails(getDocFromServer(doc(db,'reviews/review-order')));
});
test('public inquiry and guest-feedback forms keep bounded legitimate submission working',async()=>{
 const db=publicDB();await assertSucceeds(setDoc(doc(db,'franchise_leads/lead'),lead()));await assertSucceeds(setDoc(doc(db,'customer_feedback/feedback'),feedback()));
 for(const table of ['franchise_leads','customer_feedback'])for(const bad of [db,anonymous(),own()]){await assertFails(getDocFromServer(doc(bad,table,table==='franchise_leads'?'lead':'feedback')));await assertFails(getDocsFromServer(collection(bad,table)));}
});
test('oversized, blank, status-forged and extra-field public submissions fail',async()=>{
 const db=publicDB();for(const extra of [{status:'Contacted'},{name:' '},{location:' '},{formatInterest:'INVALID'},{phone:'1'},{name:'a'.repeat(101)},{timestamp:Timestamp.fromMillis(0)},{secret:'FORGED'}])await assertFails(setDoc(doc(db,'franchise_leads/lead'),lead(extra)));
 for(const extra of [{text:' '},{text:'a'.repeat(4001)},{customerName:'a'.repeat(201)},{email:'a'.repeat(255)},{timestamp:Timestamp.fromMillis(0)},{status:'Approved'}])await assertFails(setDoc(doc(db,'customer_feedback/feedback'),feedback(extra)));
});
test('Owner can privately review inquiries and mark Contacted while original contact evidence stays immutable',async()=>{
 await seed({'franchise_leads/lead':{...lead(),timestamp:Timestamp.now()},'customer_feedback/feedback':{...feedback(),timestamp:Timestamp.now()}});const db=owner();
 await assertSucceeds(getDocsFromServer(query(collection(db,'franchise_leads'),orderBy('timestamp','desc'),limit(201))));await assertSucceeds(getDocFromServer(doc(db,'customer_feedback/feedback')));
 await assertSucceeds(updateDoc(doc(db,'franchise_leads/lead'),{status:'Contacted'}));
 for(const patch of [{email:'FORGED'},{phone:'FORGED'},{status:'Deleted'},{name:deleteField()}])await assertFails(updateDoc(doc(db,'franchise_leads/lead'),patch));
 await assertFails(deleteDoc(doc(db,'franchise_leads/lead')));await assertFails(updateDoc(doc(db,'customer_feedback/feedback'),{text:'FORGED'}));await assertFails(deleteDoc(doc(db,'customer_feedback/feedback')));
});
test('CRM and feedback records require the matching global HQ permission, with branch-only grants denied',async()=>{
 await seed({'franchise_leads/lead':{...lead(),timestamp:Timestamp.now()},'customer_feedback/feedback':{...feedback(),timestamp:Timestamp.now()}});
 let db=await hq({permissions:['crm'],branches:['All']});await assertSucceeds(getDocFromServer(doc(db,'franchise_leads/lead')));await assertSucceeds(updateDoc(doc(db,'franchise_leads/lead'),{status:'Contacted'}));await assertFails(getDocFromServer(doc(db,'customer_feedback/feedback')));
 db=await hq({permissions:['reviews'],branches:['All']});await assertSucceeds(getDocFromServer(doc(db,'customer_feedback/feedback')));await assertFails(getDocFromServer(doc(db,'franchise_leads/lead')));
 db=await hq({permissions:['all'],branches:[branch]});await assertFails(getDocFromServer(doc(db,'franchise_leads/lead')));await assertFails(getDocFromServer(doc(db,'customer_feedback/feedback')));
});
