// Isolated local emulator and synthetic records. Never connects to a real project.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {previewSupplyRequest,submitSupplyRequest,signSupplyDeliveryReceipt} from '../takodeal-franchise/franchise-supply-actions.js';
import {cleanSupplyItem,supplyDispatchItems,supplyTotals} from '../takodeal-franchise/franchise-supply-model.js';
import {previewFranchiseDispatchPricing} from '../takodeal-manager/franchise-dispatch-pricing.js';
import {commitDispatch,transitionDispatch,receiveDispatch} from '../takodeal-manager/dispatch-safety.js';
const host='127.0.0.1',port=8795,projectId='demo-franchise-business-upgrade',endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing another Firestore endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools'),requireTools=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=requireTools('@firebase/rules-unit-testing');
const sdk=requireTools('firebase/firestore');sdk.setLogLevel('silent');
const {doc,setDoc,updateDoc,deleteDoc,serverTimestamp,writeBatch,collection,query,where,getDocFromServer,getDocsFromServer,runTransaction}=sdk;
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'))).java,jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('Local emulator runtime missing.');
let env,child,output='';const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reachable=()=>new Promise(resolve=>{const s=createConnection({host,port});s.setTimeout(300);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false);});});
before(async()=>{if(await reachable())throw Error('Refusing occupied emulator port.');child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-16000));const deadline=Date.now()+25000;while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error('Emulator startup failed: '+output);await pause(100);}env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});},{timeout:40000});
after(async()=>{await env?.cleanup();if(child&&child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});
const ownerEmail='jgo031996@gmail.com',branchEmail='sample-franchise@example.test',otherEmail='sample-other-franchise@example.test';
const google=(uid,email,verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified,firebase:{sign_in_provider:'google.com'}}).firestore();
const owner=()=>google('sample-owner',ownerEmail),branch=()=>google('sample-franchise',branchEmail),other=()=>google('sample-other',otherEmail);
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const at=()=>serverTimestamp();
function request(){const items=[cleanSupplyItem({hqItemId:'sample-sauce',name:'SAMPLE Sauce',displayQty:2,displayUom:'Pack',baseUom:'grams',convRate:1000,supplyQuote:{version:2,currency:'PHP',quantity:2,unitPrice:120,total:240}})];return {branch:'SAMPLE Agdao',items,dispatchItems:supplyDispatchItems(items),status:'Pending',type:'Franchise Order',requestedBy:'SAMPLE Franchise owner',requestedByUid:'sample-franchise',requestedByEmail:branchEmail,quoteVersion:2,quoteRecordedAt:at(),timestamp:at(),supplyInvoice:supplyTotals(items)};}
function dispatched(){return {status:'Completed',dispatchBatchId:'sample-delivery',dispatchLogIds:['sample-delivery-0'],completedAt:at(),dispatchInvoice:{version:1,currency:'PHP',orderId:'sample-order',branch:'SAMPLE Agdao',dispatchBatchId:'sample-delivery',lines:[{dispatchLogId:'sample-delivery-0',hqItemId:'sample-sauce',name:'SAMPLE Sauce',displayQty:2,displayUom:'Pack',conversionRate:1000,unitPrice:120,total:240}],subtotal:240,grandTotal:240,unpricedItems:0,approvedByUid:'sample-owner',approvedByEmail:ownerEmail,recordedAt:at()}};}
function receipt(){return {version:1,branch:'SAMPLE Agdao',dispatchBatchId:'sample-delivery',dispatchLogIds:['sample-delivery-0'],receivedByUid:'sample-franchise',receivedByEmail:branchEmail,receivedByName:'SAMPLE Recipient',signaturePng:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',recordedAt:at(),verification:[{id:'sample-delivery-0',status:'Received',expectedQty:2000,receivedQty:2000,displayUom:'Pack',receivedDisplayQty:2}]};}
const orderRef=(db,id='sample-order')=>doc(db,'franchise_supply_orders',id),stubRef=(db,id='sample-order')=>doc(db,'purchase_orders',id);
const stubFor=full=>({quoteVersion:2,branch:full.branch,status:'Pending',type:'Franchise Order',requestedBy:full.requestedBy,timestamp:full.timestamp,items:full.dispatchItems});
async function create(db=branch(),{id='sample-order',patch={},stubPatch={},privateOnly=false,stubOnly=false}={}){const full={...request(),...patch},batch=writeBatch(db);if(!stubOnly)batch.set(orderRef(db,id),full);if(!privateOnly)batch.set(stubRef(db,id),{...stubFor(full),...stubPatch});return batch.commit();}
async function finalize(db=owner(),patch={},stubPatch={}){const full={...dispatched(),...patch},batch=writeBatch(db);batch.update(orderRef(db),full);batch.update(stubRef(db),{status:full.status,dispatchBatchId:full.dispatchBatchId,completedAt:full.completedAt,...stubPatch});return batch.commit();}
async function approve(){await create();await finalize();}
function assertPublicStub(data,{completed=false}={}){assert.deepEqual(Object.keys(data).sort(),(completed?['quoteVersion','branch','status','type','requestedBy','timestamp','items','dispatchBatchId','completedAt']:['quoteVersion','branch','status','type','requestedBy','timestamp','items']).sort());for(const item of data.items)assert.deepEqual(Object.keys(item).sort(),['hqItemId','name','itemName','rawQty','displayQty','displayUom','baseUom','qty','convRate','requestType'].sort());assert.doesNotMatch(JSON.stringify(data),/requestedByEmail|requestedByUid|receivedBy|approvedBy|dispatchInvoice|supplyInvoice|deliveryReceipt|supplyQuote|unitPrice|grandTotal|quotedSubtotal|signaturePng|baseCost|markupPercent|iVBORw0KGgo|@/);}
beforeEach(async()=>{await env.clearFirestore();await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'hq_email_access',branchEmail),{active:true,permissions:['dispatch','payroll'],allowedBranches:['SAMPLE Agdao']});batch.set(doc(db,'hq_email_access',otherEmail),{active:true,permissions:['dispatch'],allowedBranches:['SAMPLE Maa']});await batch.commit();});});
test('approved branch creates a priced request; unassigned, unverified and anonymous identities cannot',async()=>{
 await assertSucceeds(create());
 for(const db of [other(),google('sample-franchise',branchEmail,false),env.authenticatedContext('anonymous',{firebase:{sign_in_provider:'anonymous'}}).firestore(),env.unauthenticatedContext().firestore()])await assertFails(create(db,{id:'unauthorized-'+crypto.randomUUID()}));
});
test('revoked and permissionless protected grants cannot create priced requests',async()=>{
 for(const grant of [{active:false,permissions:['dispatch'],allowedBranches:['SAMPLE Agdao']},{active:true,permissions:['payroll'],allowedBranches:['SAMPLE Agdao']},{active:true,permissions:['dispatch'],allowedBranches:['SAMPLE Maa']}]){
  await admin(db=>setDoc(doc(db,'hq_email_access',branchEmail),grant));await assertFails(create());
 }
});
test('creation cannot smuggle a delivery invoice, receipt or another actor',async()=>{
 for(const patch of [{dispatchInvoice:dispatched().dispatchInvoice},{deliveryReceipt:receipt()},{requestedByUid:'another-user'},{requestedByEmail:otherEmail},{sourceOrderId:'forged-owner-link'},{quoteVersion:1,deliveryReceipt:receipt()}])await assertFails(create(branch(),{id:'forged-'+crypto.randomUUID(),patch}));
});
test('private full request and public logistics stub must be a matching same-ID atomic pair',async()=>{
 for(const options of [{privateOnly:true},{stubOnly:true},{stubPatch:{branch:'SAMPLE Maa'}},{stubPatch:{items:[]}},{stubPatch:{requestedBy:'Different requester'}},{stubPatch:{timestamp:new Date(0)}},{stubPatch:{type:'Unrelated request'}}]){
  const id='invalid-pair-'+crypto.randomUUID();await assertFails(create(branch(),{id,...options}));await admin(async db=>{assert.equal((await getDocFromServer(orderRef(db,id))).exists(),false);assert.equal((await getDocFromServer(stubRef(db,id))).exists(),false);});
 }
 await assertSucceeds(create());assertPublicStub((await getDocFromServer(stubRef(branch()))).data());
});
test('saved customer prices and identities cannot be edited, downgraded or deleted',async()=>{
 await create();
 for(const db of [owner(),branch(),other()])for(const patch of [{items:[]},{branch:'SAMPLE Maa'},{quoteVersion:1},{requestedByUid:'other'},{supplyInvoice:{version:1,currency:'PHP',grandTotal:0}}])await assertFails(updateDoc(orderRef(db),patch));
 await assertFails(deleteDoc(orderRef(owner())));await assertFails(setDoc(orderRef(branch()),{branch:'SAMPLE Agdao',status:'Pending'}));
});
test('HQ finalizes the immutable delivery invoice; branch recipients cannot issue their own final price',async()=>{
 await create();await assertFails(finalize(branch(),{dispatchInvoice:{...dispatched().dispatchInvoice,approvedByUid:'sample-franchise',approvedByEmail:branchEmail}}));
 await assertSucceeds(finalize());await assertFails(updateDoc(orderRef(owner()),{'dispatchInvoice.grandTotal':1}));
});
test('private invoice and public completion finalize atomically with the same dispatch batch',async()=>{
 await create();await assertFails(updateDoc(orderRef(owner()),dispatched()));await assertFails(updateDoc(stubRef(owner()),{status:'Completed',dispatchBatchId:'sample-delivery',completedAt:at()}));
 await assertFails(finalize(owner(),{},{dispatchBatchId:'different-public-batch'}));await assertSucceeds(finalize());
 for(const status of ['Pending','Cancelled'])await assertFails(updateDoc(stubRef(owner()),{status}));
 await assertFails(updateDoc(stubRef(owner()),{completedAt:at()}));await assertFails(updateDoc(stubRef(owner()),{completedAt:new Date(0)}));
 assertPublicStub((await getDocFromServer(stubRef(owner()))).data(),{completed:true});
});
test('a non-Owner HQ invoice issuer needs protected supply access to both source and destination',async()=>{
 await create();const email='sample-hq-shipper@example.test',db=google('sample-shipper',email),payload=()=>({...dispatched(),dispatchInvoice:{...dispatched().dispatchInvoice,approvedByUid:'sample-shipper',approvedByEmail:email}});
 await admin(db=>setDoc(doc(db,'hq_email_access',email),{active:true,permissions:['dispatch'],allowedBranches:['Main Office']}));await assertFails(finalize(db,payload()));
 await admin(db=>setDoc(doc(db,'hq_email_access',email),{active:true,permissions:['dispatch'],allowedBranches:['SAMPLE Agdao']}));await assertFails(finalize(db,payload()));
 await admin(db=>setDoc(doc(db,'hq_email_access',email),{active:true,permissions:['dispatch'],allowedBranches:['Main Office','SAMPLE Agdao']}));await assertSucceeds(finalize(db,payload()));
});
test('invoice batch, order, branch, issuer and time must match the saved operation',async()=>{
 await create();for(const patch of [{orderId:'other'},{branch:'SAMPLE Maa'},{dispatchBatchId:'other'},{approvedByUid:'forged'},{approvedByEmail:branchEmail},{recordedAt:new Date(0)}])await assertFails(finalize(owner(),{dispatchInvoice:{...dispatched().dispatchInvoice,...patch}}));
});
test('assigned recipient signs a saved HQ invoice exactly once, without editing prices or quantities',async()=>{
 await approve();await assertSucceeds(updateDoc(orderRef(branch()),{deliveryReceipt:receipt()}));
 await assertFails(updateDoc(orderRef(branch()),{'deliveryReceipt.receivedByName':'Different recipient'}));await assertFails(updateDoc(orderRef(owner()),{deliveryReceipt:receipt()}));await assertFails(deleteDoc(orderRef(owner())));
});
test('private invoices and signatures permit only the assigned branch and protected HQ GET/LIST',async()=>{
 await approve();await updateDoc(orderRef(branch()),{deliveryReceipt:receipt()});
 await assertSucceeds(getDocFromServer(orderRef(branch())));await assertSucceeds(getDocFromServer(orderRef(owner())));
 const rejected=[other(),google('unverified',branchEmail,false),env.authenticatedContext('anonymous',{firebase:{sign_in_provider:'anonymous'}}).firestore(),env.unauthenticatedContext().firestore()];
 for(const db of rejected){await assertFails(getDocFromServer(orderRef(db)));await assertFails(getDocsFromServer(query(collection(db,'franchise_supply_orders'),where('branch','==','SAMPLE Agdao'))));await assertFails(getDocsFromServer(collection(db,'franchise_supply_orders')));}
 await assertSucceeds(getDocsFromServer(query(collection(branch(),'franchise_supply_orders'),where('branch','==','SAMPLE Agdao'))));await assertFails(getDocsFromServer(collection(branch(),'franchise_supply_orders')));
 await assertSucceeds(getDocsFromServer(collection(owner(),'franchise_supply_orders')));
 const email='sample-hq-reader@example.test',db=google('sample-reader',email);await admin(db=>setDoc(doc(db,'hq_email_access',email),{active:true,permissions:['dispatch'],allowedBranches:['Main Office']}));await assertSucceeds(getDocFromServer(orderRef(db)));await assertSucceeds(getDocsFromServer(collection(db,'franchise_supply_orders')));
 await admin(db=>setDoc(doc(db,'hq_email_access',email),{active:false,permissions:['dispatch'],allowedBranches:['Main Office']}));await assertFails(getDocFromServer(orderRef(db)));await assertFails(getDocsFromServer(collection(db,'franchise_supply_orders')));
});
test('public legacy logistics GET/LIST stays usable while new stubs expose no private invoice, email, totals or signature',async()=>{
 await approve();await updateDoc(orderRef(branch()),{deliveryReceipt:receipt()});
 for(const db of [branch(),other(),env.authenticatedContext('anonymous',{firebase:{sign_in_provider:'anonymous'}}).firestore(),env.unauthenticatedContext().firestore()]){
  const stub=(await assertSucceeds(getDocFromServer(stubRef(db)))).data();assertPublicStub(stub,{completed:true});const list=await assertSucceeds(getDocsFromServer(collection(db,'purchase_orders')));assert.equal(list.size,1);assertPublicStub(list.docs[0].data(),{completed:true});
 }
 for(const patch of [{dispatchInvoice:dispatched().dispatchInvoice},{deliveryReceipt:receipt()},{supplyInvoice:request().supplyInvoice},{requestedByEmail:branchEmail}]){
  await assertFails(updateDoc(stubRef(branch()),patch));await assertFails(setDoc(stubRef(branch(),'private-field-'+crypto.randomUUID()),{branch:'SAMPLE Agdao',status:'Pending',...patch}));
 }
});
test('another branch cannot overwrite the private record or take over its public pair and immutable invoice',async()=>{
 await approve();const before=(await getDocFromServer(orderRef(owner()))).data(),stubBefore=(await getDocFromServer(stubRef(owner()))).data();
 await assertFails(create(other(),{patch:{branch:'SAMPLE Maa',requestedByUid:'sample-other',requestedByEmail:otherEmail,requestedBy:'SAMPLE Other Recipient'}}));await assertFails(updateDoc(stubRef(other()),{branch:'SAMPLE Maa'}));await assertFails(updateDoc(orderRef(other()),{deliveryReceipt:{...receipt(),receivedByUid:'sample-other',receivedByEmail:otherEmail}}));
 assert.deepEqual((await getDocFromServer(orderRef(owner()))).data(),before);assert.deepEqual((await getDocFromServer(stubRef(owner()))).data(),stubBefore);
});
test('receipt requires an HQ invoice, correct branch, exact delivery IDs, authenticated actor and PNG signature',async()=>{
 await create();await assertFails(updateDoc(orderRef(branch()),{deliveryReceipt:receipt()}));await finalize();
 await assertFails(updateDoc(orderRef(other()),{deliveryReceipt:{...receipt(),receivedByUid:'sample-other',receivedByEmail:otherEmail}}));
 for(const patch of [{branch:'SAMPLE Maa'},{dispatchBatchId:'other'},{dispatchLogIds:['other']},{receivedByUid:'forged'},{receivedByEmail:otherEmail},{signaturePng:'javascript:alert(1)'},{recordedAt:new Date(0)},{verification:[]}])await assertFails(updateDoc(orderRef(branch()),{deliveryReceipt:{...receipt(),...patch}}));
});
test('legacy unpriced requests retain their preceding compatibility path',async()=>{
 const db=branch();await assertSucceeds(setDoc(doc(db,'purchase_orders/legacy'),{branch:'SAMPLE Agdao',items:[],status:'Pending'}));await assertSucceeds(updateDoc(doc(db,'purchase_orders/legacy'),{status:'Drafting'}));await assertSucceeds(deleteDoc(doc(owner(),'purchase_orders/legacy')));
});
test('actual supply services create a priced order and save an immutable signed delivery receipt',async()=>{
 const signature='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 await admin(async db=>{await setDoc(doc(db,'hq_managers/sample-franchise-account'),{email:branchEmail,role:'franchisee',permissions:['dispatch','payroll'],assignedBranch:'SAMPLE Agdao',active:true,pin:'SAMPLE-ONLY'});await setDoc(doc(db,'hq_managers/sample-owner-account'),{email:ownerEmail,role:'Owner',permissions:['all'],assignedBranch:'All',active:true,pin:'SAMPLE-HQ'});await setDoc(doc(db,'branches/sample-agdao'),{name:'SAMPLE Agdao',isFranchise:true,active:true});await setDoc(doc(db,'inventory/sample-sauce'),{name:'SAMPLE Sauce',branch:'Main Office',allowRequest:true,baseCost:.1,franchiseMarkupPercent:20,conversionRate:1000,uom:'grams',purchaseUom:'Pack',currentStock:5000});});
 const db=branch(),user={uid:'sample-franchise',email:branchEmail,emailVerified:true,providerData:[{providerId:'google.com'}]},api={db,doc,collection,query,where,getDocFromServer,getDocsFromServer,runTransaction,serverTimestamp,auth:{currentUser:user},sessionUser:{uid:user.uid,email:branchEmail,branch:'SAMPLE Agdao',role:'Franchise owner',isFranchisee:true,allowedBranches:['SAMPLE Agdao'],permissions:['dispatch','payroll'],cashierName:'SAMPLE Franchise owner'}};
 const preview=await previewSupplyRequest(api,[{hqItemId:'sample-sauce',name:'SAMPLE Sauce',displayQty:2,displayUom:'Pack'}]);
 await assertSucceeds(submitSupplyRequest(api,preview,'sample-order'));
 assertPublicStub((await getDocFromServer(stubRef(env.unauthenticatedContext().firestore()))).data());
 assert.equal((await getDocFromServer(orderRef(db))).data().requestedByEmail,branchEmail);
 const hqUser={uid:'sample-owner',email:ownerEmail,emailVerified:true,providerData:[{providerId:'google.com'}]},hq={...api,db:owner(),getDocs:getDocsFromServer,auth:{currentUser:hqUser},sessionUser:{uid:hqUser.uid,email:ownerEmail,isOwner:true,isFranchisee:false,role:'Owner',allowedBranches:['All'],permissions:['all'],cashierName:'SAMPLE HQ'},isBranchAllowed:()=>true};
 const draft={source:'Main Office',destination:'SAMPLE Agdao',purchaseOrderIds:['sample-order'],items:[{hqItemId:'sample-sauce',itemName:'SAMPLE Sauce',qty:2000,rawQty:2,baseUom:'grams',friendlyUom:'Pack',convRate:1000,purchaseOrderId:'sample-order',purchaseOrderLineIndex:0}]},supplyPricing=await previewFranchiseDispatchPricing(hq,draft);
 await assertSucceeds(commitDispatch(hq,{id:'sample-delivery',...draft,driver:'SAMPLE Driver',actor:'SAMPLE HQ',supplyPricing}));
 assert.equal((await getDocFromServer(doc(hq.db,'franchise_ledger/supply-sample-delivery'))).data().amount,240);
 assert.equal((await getDocFromServer(doc(hq.db,'inventory/sample-sauce'))).data().currentStock,3000);
 await assert.rejects(signSupplyDeliveryReceipt(api,{orderId:'sample-order',signaturePng:signature}),/verify|receive|unverified/i);
 await assertSucceeds(transitionDispatch(hq,{ids:['sample-delivery-0'],mode:'arrive',actor:'SAMPLE Driver'}));
 const receiving={branch:'SAMPLE Agdao',actor:'SAMPLE Recipient',items:[{id:'sample-delivery-0',actualDisplayQty:2,isMissing:false,remarks:'SAMPLE complete delivery'}]};assert.equal(await assertSucceeds(receiveDispatch(api,receiving)),1);assert.equal(await assertSucceeds(receiveDispatch(api,receiving)),0);
 await assertSucceeds(signSupplyDeliveryReceipt(api,{orderId:'sample-order',signaturePng:signature}));
 const signed=(await getDocFromServer(orderRef(db))).data();assert.equal(signed.deliveryReceipt.receivedByUid,user.uid);assert.equal(signed.dispatchInvoice.grandTotal,240);
 assert.equal((await signSupplyDeliveryReceipt(api,{orderId:'sample-order',signaturePng:signature})).alreadySigned,true);
 await assertFails(updateDoc(orderRef(db),{'dispatchInvoice.grandTotal':0}));
 const publicStub=(await getDocFromServer(stubRef(env.unauthenticatedContext().firestore()))).data();assertPublicStub(publicStub,{completed:true});assert.equal(publicStub.dispatchBatchId,'sample-delivery');
 await assertFails(getDocFromServer(orderRef(other())));await assertFails(getDocFromServer(orderRef(env.unauthenticatedContext().firestore())));
});

import {issueDisciplineCase as issueFranchiseCase,reviewDisciplineCase as reviewFranchiseCase,cancelDisciplineCase as cancelFranchiseCase,readDisciplineContext as readFranchiseContext} from '../takodeal-franchise/franchise-discipline-actions.js';
import {acknowledgeSanction,phDay} from '../takodeal-franchise/sanction-schedule.js';
const disciplineBranch='SAMPLE Agdao',disciplineStaff='sample-discipline-crew',disciplineName='SAMPLE Discipline Crew';
async function disciplineApi(){
 await admin(async db=>{await setDoc(doc(db,'hq_managers/sample-franchise-reviewer'),{email:branchEmail,role:'Franchise owner',assignedBranch:disciplineBranch,permissions:['payroll'],pin:'SAMPLE-test-PIN',active:true});await setDoc(doc(db,'cashiers',disciplineStaff),{cashierName:disciplineName,branch:disciplineBranch,active:true,pin:'SAMPLE-staff-PIN'});});
 return {...sdk,db:branch(),auth:{currentUser:{uid:'sample-franchise',email:branchEmail,emailVerified:true,providerData:[{providerId:'google.com'}]}},sessionUser:{uid:'sample-franchise',email:branchEmail,branch:disciplineBranch,allowedBranches:[disciplineBranch],permissions:['payroll'],role:'Franchise owner',isFranchisee:true,isOwner:false,cashierName:'SAMPLE Franchise Reviewer'}};
}
const disciplineInput=()=>({staffId:disciplineStaff,staffName:disciplineName,branch:disciplineBranch,type:'SAMPLE reported procedure',details:'SAMPLE incident details awaiting the staff explanation.',effectiveDate:phDay(),expectedPolicyRevision:0,proposedLevelId:null});
const disciplineDecision=(relatedCaseIds=[])=>({outcome:'Confirmed',levelId:'written-warning',effectiveDate:phDay(),reason:'SAMPLE the staff explanation and supporting facts were reviewed.',expectedRevision:0,expectedPolicyRevision:0,relatedCaseIds});
const disciplineReply=(api,id)=>acknowledgeSanction(api,{id,staffName:disciplineName,reply:'SAMPLE complete signed staff explanation for separate management review.',signature:'SAMPLE test signature'},{identity:()=>({staffId:disciplineStaff,staffName:disciplineName})});
test('actual Franchise v2 service follows protected grants and Staff reply protocol while Owner policy and legacy mutation stay denied',async()=>{
 const api=await disciplineApi(),id='franchise-case';await assertSucceeds(issueFranchiseCase(api,disciplineInput(),{id}));await assertSucceeds(disciplineReply(api,id));await assertSucceeds(reviewFranchiseCase(api,id,disciplineDecision(),{changeId:'franchise-review'}));
 let row=(await sdk.getDocFromServer(doc(api.db,'hr_sanctions',id))).data();assert.equal(row.caseNumber,1);assert.equal(row.finding,'Confirmed');assert.equal(row.reviewedByUid,'sample-franchise');assert.equal(row.reviewedAction.suspensionDays,0);
 for(const patch of [{status:'Resolved'},{caseVersion:1},{effectiveDate:'2030-01-01'},{amount:100},{deductionId:'forged'}])await assertFails(updateDoc(doc(api.db,'hr_sanctions',id),patch));
 await assertFails(setDoc(doc(api.db,'settings/discipline_policy'),{version:1,revision:1,levels:[{id:'warning',label:'SAMPLE warning',suspensionDays:0}],changeId:'forged-franchise-policy',intent:'SAMPLE disallowed future policy edit',updatedAt:at(),updatedByUid:'sample-franchise',updatedByEmail:branchEmail}));
 await assertSucceeds(cancelFranchiseCase(api,id,{expectedRevision:1,reason:'SAMPLE archive after completed branch review.'},{changeId:'franchise-archive'}));row=(await sdk.getDocFromServer(doc(api.db,'hr_sanctions',id))).data();assert.equal(row.status,'Archived');assert.equal(row.finding,'Confirmed');assert.equal((await readFranchiseContext(api,{id:disciplineStaff})).nextCaseNumber,2);
 await admin(db=>setDoc(doc(db,'hq_email_access',branchEmail),{active:false,permissions:['payroll'],allowedBranches:[disciplineBranch]}));await assert.rejects(issueFranchiseCase(api,disciplineInput(),{id:'revoked-franchise-case'}),/protected sanctions/);
});
test('actual Franchise service reviews with five same-staff same-branch confirmed cases within Rules limits',async()=>{
 const api=await disciplineApi(),related=[];
 for(let index=0;index<5;index++){const id='franchise-prior-'+index;await assertSucceeds(issueFranchiseCase(api,disciplineInput(),{id}));await assertSucceeds(disciplineReply(api,id));await assertSucceeds(reviewFranchiseCase(api,id,disciplineDecision(),{changeId:'review-prior-'+index}));related.push(id);}
 const id='franchise-next-case';await assertSucceeds(issueFranchiseCase(api,{...disciplineInput(),type:'SAMPLE different incident type'},{id}));await assertSucceeds(disciplineReply(api,id));await assertSucceeds(reviewFranchiseCase(api,id,disciplineDecision(related),{changeId:'review-five-priors'}));
 const row=(await sdk.getDocFromServer(doc(api.db,'hr_sanctions',id))).data();assert.equal(row.caseNumber,6);assert.equal(row.finding,'Confirmed');assert.deepEqual(row.relatedCaseIds,related);assert.equal((await sdk.getDocsFromServer(sdk.collection(api.db,'staff_deductions'))).size,0);
});
test('consolidated legacy collections preserve the original GET LIST create update delete permissions and recursive depth',{timeout:120000},async()=>{
 // Frozen expectations derived from the preceding named policies, SHA256:
 // 925467994036fd27bf6830fd466602de388632d93349a07dc6f95c91ff50124c.
 // Columns are collection, read (GET/LIST), create, update, delete. P = public,
 // H = the preceding isHQUser() signed-in grant, O = preceding Owner grant.
 // These fixtures deliberately do not read the candidate Rules or work files.
 const flat=[
  ['global_addons','P','O','O','O'],['bom','P','O','O','O'],['branches','P','P','P','P'],['menu','P','O','P','O'],
  ['stock_logs','P','P','P','O'],['manager_alerts','P','P','P','H'],['sop_logs','P','P','P','H'],['shift_swaps','P','P','P','H'],
  ['shifts','P','P','P','O'],['expenses','P','P','P','H'],['remittances','P','P','P','O'],['account_logs','P','P','P','H'],
  ['cash_accounts','P','P','P','H'],['inventory','P','P','P','O'],['stock_counts','P','P','P','O'],['dispatch_logs','P','P','P','H'],
  ['parked_orders','P','P','P','P'],['pos_devices','P','P','P','H'],['staff_requests','P','P','P','H'],
  ['staff_ledger','P','H','H','H'],['staff_bonuses','P','H','H','H'],['budgets','H','H','H','H'],['equipment_assets','H','H','H','H'],
  ['yield_logs','H','H','H','H'],['grab_payouts','P','P','H','H'],['foodpanda_payouts','P','P','H','H'],['payables','H','H','H','H'],
  ['hq_restocks','H','H','H','H'],['franchise_ledger','P','P','P','H'],['franchise_comms','P','P','P','H'],['riders','H','H','H','H'],['rider_topups','H','H','H','H']
 ];
 const recursive=['customer_app_categories','suppliers','daily_metrics','archived_months','franchise_accounts','franchise_budgets'];
 assert.equal(flat.length,32);assert.equal(recursive.length,6);
 const targets=flat.map(([name,...policy])=>({path:name,policy}));
 for(const name of recursive)for(const path of [name,name+'/compat-parent/compat-children'])targets.push({path,policy:['H','H','H','H']});
 // All of these paths were outside every preceding named grant. A flat legacy
 // path must not become recursive, and a prefilter cannot grant near names.
 for(const path of ['inventory_suffix','prefix_inventory','franchise_supply_orders_backup','inventory\n','inventory/compat-parent/compat-private-children'])targets.push({path,policy:['D','D','D','D']});
 const actors=[{id:'public',db:env.unauthenticatedContext().firestore(),signed:false,owner:false},{id:'hq',db:other(),signed:true,owner:false},{id:'owner',db:owner(),signed:true,owner:true}];
 await admin(async db=>{const batch=writeBatch(db);for(const target of targets)for(const actor of actors)for(const method of ['get','update','delete'])batch.set(doc(db,target.path,'compat-'+actor.id+'-'+method),{fixture:'SAMPLE legacy permission equivalence',actor:actor.id});await batch.commit();});
 let operations=0;
 for(const target of targets)for(const actor of actors)for(const [method,column]of [['get',0],['list',0],['create',1],['update',2],['delete',3]]){
  const rule=target.policy[column],allowed=rule==='P'||rule==='H'&&actor.signed||rule==='O'&&actor.owner;
  const reference=doc(actor.db,target.path,'compat-'+actor.id+'-'+method),operation=method==='get'?()=>getDocFromServer(reference):method==='list'?()=>getDocsFromServer(collection(actor.db,target.path)):method==='create'?()=>setDoc(reference,{fixture:'SAMPLE new legacy row'}):method==='update'?()=>updateDoc(reference,{compatibilityUpdate:true}):()=>deleteDoc(reference);
  try{if(allowed)await assertSucceeds(operation());else await assertFails(operation());}catch(error){error.message=target.path+' · '+actor.id+' · '+method+' · expected '+(allowed?'allowed':'denied')+': '+error.message;throw error;}operations++;
 }
 assert.equal(operations,735);
});
