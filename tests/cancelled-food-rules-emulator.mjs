// Local emulator regression runner; implementation owned by printer agent.
import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {createCancelledOrderEngine} from '../Takodeal-POS/cancelled-orders.js';
import {createOnlineRefundEngine} from '../takodeal-manager/online-refunds.js';
import {createSaleEngine,SALE_VERSION,saleFingerprint} from '../Takodeal-POS/pos-safety.js';

// Standalone, real full-rule test. Not a *.test.mjs CI test: Java/local tools
// are required. The launcher itself refuses an occupied port or non-demo host.
// No Firebase CLI, cloud credentials or production project can be selected.
const host='127.0.0.1',port=8789,projectId='demo-cancelled-platform-food';
const endpoint=host+':'+port;
if(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST!==endpoint)throw Error('Refusing a non-isolated Firestore emulator endpoint.');
process.env.FIRESTORE_EMULATOR_HOST=endpoint;
const root=fileURLToPath(new URL('../',import.meta.url)),tools=resolve(root,'../staff-nextlevel-tools');
const requireTools=createRequire(resolve(tools,'package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=requireTools('@firebase/rules-unit-testing');
const sdk=requireTools('firebase/firestore');
const {doc,collection,query,where,getDocsFromServer,getDocFromServer,runTransaction,increment,serverTimestamp,setDoc,updateDoc,writeBatch,setLogLevel}=sdk;
setLogLevel('silent'); // Expected denials are asserted below, not console noise.
const java=JSON.parse(readFileSync(resolve(tools,'runtime.json'),'utf8')).java;
const jar=resolve(tools,'emulators/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(java)||!existsSync(jar))throw Error('The isolated Firestore emulator/Java runtime is missing.');
let env,child,output='';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function reachable(){return new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(300);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});}
before(async()=>{
    if(await reachable())throw Error('Refusing to reuse an occupied emulator port.');
    child=spawn(java,['-jar',jar,'--host',host,'--port',String(port),'--project_id',projectId],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.on('error',error=>{output+=String(error);});
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-12000);});
    const deadline=Date.now()+25000;
    while(!await reachable()){if(child.exitCode!==null||Date.now()>deadline)throw Error('Local emulator failed to start: '+output);await pause(100);}
    env=await initializeTestEnvironment({projectId,firestore:{host,port,rules:readFileSync(resolve(root,'firestore.rules'),'utf8')}});
},{timeout:40000});
after(async()=>{await env?.cleanup();if(child && child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),pause(3000)]);}});

test('active crew or manager assigned to another branch can purchase without a permission failure',async()=>{
    await adminUpdate('cashiers/'+staffId,{branch:'Cabantian',role:'Manager'});const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));assert.equal((await read('staff_deductions/'+purchaseId)).staffId,staffId);
});
test('legacy unbound anonymous Cashier can commit the validated pair while protected branches still deny it',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false});const f=await cancelled(anon('legacy-cashier'));await assertSucceeds(f.e.purchase(purchaser(f.quote)));assert.equal((await read('staff_deductions/'+purchaseId)).amount,192);
});
test('legacy compatibility refuses a revoked binding, another-branch binding and verified customer identity',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false});const writes=await packet();for(const db of [anon('revoked-pos'),anon('other-branch-pos'),google('sample-customer','customer@example.invalid')])await assertFails(commitPacket(db,writes));
});
test('a customer-order gate still requires approval even with sales protection disabled',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false,requireCashierForCustomerOrders:true});const writes=await packet();await assertFails(commitPacket(anon('legacy-cashier'),writes));
});
function refundInput(){return {sourceSaleId,staffId,reason:'wrong_food',details:'SAMPLE wrong filling',evidence:'SAMPLE platform reference',refundConfirmed:true,refundAmount:80,policyReviewed:true,reviewNote:'SAMPLE reviewed responsibility and staff response'};}
function refundEngine(db=google('synthetic-owner','jgo031996@gmail.com')){return createOnlineRefundEngine({...api(db),auth:{currentUser:{email:'jgo031996@gmail.com'}}},{ownerCheck:()=>true});}
test('verified Owner records the authorized charge and notice atomically, reviews it and can withdraw before payroll',async()=>{
    const e=refundEngine(),before=await read('transactions/'+sourceSaleId),id='online-refund-'+sourceSaleId;await assertSucceeds(e.record(refundInput()));assert.deepEqual(await read('transactions/'+sourceSaleId),before);const ledger=await read('staff_deductions/'+id);assert.equal(ledger.amount,80);assert.equal(ledger.proposedAmount,80);assert.equal(ledger.status,'Unpaid');await assertSucceeds(e.review({id,revision:0,response:'SAMPLE staff response',reviewNote:'SAMPLE reviewed evidence',policyReviewed:true}));await assertSucceeds(e.review({id,revision:1,response:'SAMPLE staff response',reviewNote:'SAMPLE no responsibility established',dismiss:true}));assert.equal((await read('staff_deductions/'+id)).status,'Dismissed');
});
for(const dbName of ['anonymous','hq','customer'])test(dbName+' cannot record or approve an online refund salary charge',async()=>{
    const db=dbName==='anonymous'?anon('approved-pos'):google('not-owner',dbName+'@example.invalid');await assertFails(refundEngine(db).record(refundInput()));assert.equal(await read('staff_deductions/online-refund-'+sourceSaleId),undefined);
});
test('unpaired amount changes, paid statuses and ledger deletion remain denied even to Owner',async()=>{
    const db=google('synthetic-owner','jgo031996@gmail.com'),e=refundEngine(db),id='online-refund-'+sourceSaleId;await e.record(refundInput());
    for(const change of [{amount:90},{status:'Pending Review'},{status:'Paid'},{proposedAmount:100},{staffId:'other-person'}])await assertFails(updateDoc(doc(db,'staff_deductions/'+id),change));
    await assertFails(sdk.deleteDoc(doc(db,'staff_deductions/'+id)));await assertFails(updateDoc(doc(db,'online_order_incidents/'+id),{status:'Dismissed'}));
});
test('an unpaired pending ledger cannot be created by Owner',async()=>{
    const db=google('synthetic-owner','jgo031996@gmail.com');await assertFails(setDoc(doc(db,'staff_deductions/online-refund-orphan'),{type:'Online Order Refund',category:'Online Order Refunds',status:'Pending Review',amount:0,staffId,staffName,sourceSaleId,sourceReceiptId:'EMULATOR-ORIGINAL',incidentId:'online-refund-orphan',proposedAmount:80,dateAdded:serverTimestamp(),loggedBy:'jgo031996@gmail.com'}));
});

const branch='Maa',shiftId='emulator-source-shift',sourceSaleId='emulator-source-sale',staffId='emulator-staff',staffName='Synthetic Rules Staff',pin='5678';
const purchaseId='cancelled-food-'+sourceSaleId;
const bom=[{menuItem:'6 Pcs Takoyaki',ingredientName:'Batter',qty:6}];
const input={sourceSaleId,branch,shiftId,cashier:'Synthetic Cashier'};
const anon=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'anonymous'}}).firestore();
const google=(uid,email)=>env.authenticatedContext(uid,{email,email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const api=db=>({db,doc,collection,query,where,getDocsFromServer,runTransaction,increment,serverTimestamp});
const engine=db=>createCancelledOrderEngine(api(db),{sessionCheck:()=>true});
const purchaser=(quote,changes={})=>({...input,staffId,staffName,pin,quote,...changes});
const admin=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const adminSet=(path,data)=>admin(db=>setDoc(doc(db,path),data));
const adminUpdate=(path,data)=>admin(db=>updateDoc(doc(db,path),data));
const read=path=>getDocFromServer(doc(anon('approved-pos'),path)).then(snap=>snap.data());
beforeEach(async()=>{
    await env.clearFirestore();
    await admin(async db=>{
        const batch=writeBatch(db);
        batch.set(doc(db,'offline_policy/'+branch),{protectSalesV2:true});
        batch.set(doc(db,'pos_bindings/approved-pos'),{status:'Active',branch});
        batch.set(doc(db,'pos_bindings/other-branch-pos'),{status:'Active',branch:'Cabantian'});
        batch.set(doc(db,'pos_bindings/revoked-pos'),{status:'Revoked',branch});
        batch.set(doc(db,'shifts/'+shiftId),{branch,active:true,status:'Open',startingCash:2000,salesRevision:0});
        batch.set(doc(db,'settings/global_pos_config'),{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:20});
        batch.set(doc(db,'cashiers/'+staffId),{cashierName:staffName,branch,role:'Staff',status:'Active',pin});
        batch.set(doc(db,'inventory/emulator-batter'),{name:'Batter',branch,currentStock:100,uom:'units'});
        await batch.commit();
        const sales=createSaleEngine(api(db)),payload={saleVersion:SALE_VERSION,saleId:sourceSaleId,receiptId:'EMULATOR-ORIGINAL',branch,shiftId,cashier:'Synthetic Cashier',status:'Paid',paymentMethod:'Grab',orderType:'Grab',netTotal:200,subTotalBeforeDiscount:240,localTimestamp:'2026-10-11T01:00:00Z',cart:[{name:'6 Pcs Takoyaki',qty:2,lineTotalFinal:240}]};
        await sales.commit(await sales.prepare(payload,bom));
    });
});
async function cancelled(db=anon('approved-pos')){const e=engine(db);await e.cancel({...input,reason:'customer'});return {db,e,quote:await e.quote(input)};}
async function setAmount(gross,net=gross){
    const sale=await read('transactions/'+sourceSaleId);sale.netTotal=net;if(gross===null)delete sale.subTotalBeforeDiscount;else sale.subTotalBeforeDiscount=gross;
    sale.cart=[{name:'6 Pcs Takoyaki',qty:2,lineTotalFinal:net}];
    await admin(async db=>{const b=writeBatch(db);b.set(doc(db,'transactions/'+sourceSaleId),sale);b.update(doc(db,'pos_sale_commits/'+sourceSaleId),{fingerprint:saleFingerprint(sale)});await b.commit();});
}
async function packet(){
    const f=await cancelled(),writes=[],base=api(f.db);
    base.runTransaction=(db,callback)=>runTransaction(db,tx=>callback({get:reference=>tx.get(reference),
        set:(reference,data,options)=>writes.push({kind:'set',path:reference.path,data,options}),update:(reference,data)=>writes.push({kind:'update',path:reference.path,data})}));
    await createCancelledOrderEngine(base,{sessionCheck:()=>true}).purchase(purchaser(f.quote));return writes;
}
function commitPacket(db,writes){const batch=writeBatch(db);for(const write of writes){const reference=doc(db,write.path);if(write.kind==='update')batch.update(reference,write.data);else if(write.options)batch.set(reference,write.data,write.options);else batch.set(reference,write.data);}return batch.commit();}

test('full production rules compile and actual approved anonymous POS cancellation/purchase both commit',async()=>{
    const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));
    const source=await read('transactions/'+sourceSaleId),purchase=await read('transactions/'+purchaseId),charge=await read('staff_deductions/'+purchaseId);
    assert.equal(source.status,'Voided');assert.equal(source.inventoryState,'applied');assert.equal(purchase.netTotal,192);assert.equal(charge.amount,192);assert.equal(charge.status,'Unpaid');assert.deepEqual(purchase.inventoryMovements,[]);assert.equal((await read('inventory/emulator-batter')).currentStock,88);
});
test('new typed purchase remains valid on a legacy unprotected branch',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false});const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));assert.equal((await read('staff_deductions/'+purchaseId)).amount,192);
});
test('Owner and active All-scoped HQ can edit the two new policy fields; scoped HQ cannot',async()=>{
    await adminSet('hq_email_access/synthetic-all@example.invalid',{active:true,allowedBranches:['All']});await adminSet('hq_email_access/synthetic-maa@example.invalid',{active:true,allowedBranches:['Maa']});
    const config=db=>doc(db,'settings/global_pos_config');
    await assertSucceeds(updateDoc(config(google('synthetic-owner','jgo031996@gmail.com')),{cancelledFoodDiscountPct:30,cancelledFoodPurchaseEnabled:false}));
    await assertSucceeds(updateDoc(config(google('synthetic-all','synthetic-all@example.invalid')),{cancelledFoodDiscountPct:20,cancelledFoodPurchaseEnabled:true}));
    await assertFails(updateDoc(config(google('synthetic-maa','synthetic-maa@example.invalid')),{cancelledFoodDiscountPct:100}));
});
test('approved anonymous POS cannot change or remove the new policy fields but unrelated legacy settings updates remain allowed',async()=>{
    const db=anon('approved-pos'),config=doc(db,'settings/global_pos_config');
    for(const change of [{cancelledFoodDiscountPct:100},{cancelledFoodPurchaseEnabled:false},{cancelledFoodDiscountPct:sdk.deleteField()},{cancelledFoodPurchaseEnabled:sdk.deleteField()}])await assertFails(updateDoc(config,change));
    await assertFails(sdk.deleteDoc(config));await assertFails(setDoc(config,{legacyOtherSetting:1}));
    await assertSucceeds(updateDoc(config,{legacyOtherSetting:1}));assert.equal((await read('settings/global_pos_config')).legacyOtherSetting,1);
    await assertSucceeds(setDoc(doc(db,'settings/synthetic_legacy_setting'),{value:1}));await assertSucceeds(sdk.deleteDoc(doc(db,'settings/synthetic_legacy_setting')));
});
test('new policy values validate boolean and numeric percentage while Owner removal remains intentional',async()=>{
    const db=google('synthetic-owner','jgo031996@gmail.com'),config=doc(db,'settings/global_pos_config');
    for(const change of [{cancelledFoodDiscountPct:-1},{cancelledFoodDiscountPct:101},{cancelledFoodDiscountPct:'20'},{cancelledFoodPurchaseEnabled:'true'}])await assertFails(updateDoc(config,change));
    await assertSucceeds(updateDoc(config,{cancelledFoodDiscountPct:0}));await assertSucceeds(updateDoc(config,{cancelledFoodDiscountPct:100}));
    await assertSucceeds(updateDoc(config,{cancelledFoodDiscountPct:sdk.deleteField(),cancelledFoodPurchaseEnabled:sdk.deleteField()}));
    await assertSucceeds(setDoc(config,{cancelledFoodDiscountPct:20,cancelledFoodPurchaseEnabled:true}));
});
for(const uid of ['unapproved-pos','revoked-pos','other-branch-pos'])test(`${uid} cannot cancel a protected receipt or create a new salary charge`,async()=>{
    await assertFails(engine(anon(uid)).cancel({...input,reason:'customer'}));assert.equal((await read('transactions/'+sourceSaleId)).status,'Paid');
    const writes=await packet();await assertFails(commitPacket(anon(uid),writes));assert.equal(await read('staff_deductions/'+purchaseId),undefined);
});
for(const platform of ['grab',' GRAB ','foodpanda',' panda '])test(`normalized saved platform ${JSON.stringify(platform)} works in the actual app and full rules`,async()=>{
    await adminUpdate('transactions/'+sourceSaleId,{paymentMethod:platform});const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));
});
for(const role of ['STAFF',' staff crew ','Cashier','Crew','Manager',' manager '])test(`active registered buyer role ${JSON.stringify(role)} is accepted`,async()=>{
    await adminUpdate('cashiers/'+staffId,{role});const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));
});
for(const gross of [171,199.95,199.99,90.25,0.03])test(`cent rounding for gross ${gross} passes the exact actual purchase payload`,async()=>{
    await setAmount(gross);const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));const charged=await read('staff_deductions/'+purchaseId);assert.equal(charged.amount,(Math.round(gross*100)-Math.round(Math.round(gross*100)*0.2))/100);
});
for(const value of ['20',' 20 ','2e1'])test(`numeric-string percent ${JSON.stringify(value)} remains compatible with the actual validated quote`,async()=>{
    await adminUpdate('settings/global_pos_config',{cancelledFoodDiscountPct:value});const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));
});
test('missing gross subtotal uses original net fallback instead of denying a valid legacy-shaped v2 receipt',async()=>{await setAmount(null,171);const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));assert.equal((await read('staff_deductions/'+purchaseId)).amount,136.8);});
test('raw amount forgery cannot bypass the app to create a different deduction',async()=>{
    const writes=await packet();for(const write of writes){if(write.path==='transactions/'+purchaseId)write.data={...write.data,netTotal:1,globalDiscountAmount:239};if(write.path==='staff_deductions/'+purchaseId)write.data={...write.data,amount:1};}await assertFails(commitPacket(anon('approved-pos'),writes));assert.equal(await read('transactions/'+purchaseId),undefined);
});
for(const protectedBranch of [true,false])test(`valid 20-line order fits complete rules limits with protectSalesV2=${protectedBranch}`,async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:protectedBranch});
    const sale=await read('transactions/'+sourceSaleId);sale.cart=Array.from({length:20},(_,index)=>({name:'Synthetic Food '+index,category:'Takoyaki',qty:index+1,lineTotalFinal:12,notes:'Synthetic test line '+index,addons:{}}));sale.subTotalBeforeDiscount=240;
    await admin(async db=>{const batch=writeBatch(db);batch.set(doc(db,'transactions/'+sourceSaleId),sale);batch.update(doc(db,'pos_sale_commits/'+sourceSaleId),{fingerprint:saleFingerprint(sale)});await batch.commit();});
    const f=await cancelled();await assertSucceeds(f.e.purchase(purchaser(f.quote)));assert.equal((await read('transactions/'+purchaseId)).cart.length,20);
});

test('legacy unprotected branch cannot replace the source pointer with a second new purchase/charge',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false});
    const writes=await packet();await assertSucceeds(commitPacket(anon('approved-pos'),writes));
    const secondId='cancelled-food-second-synthetic';
    const second=writes.map(write=>{
        const path=write.path.replace(purchaseId,secondId),data={...write.data};
        if(write.path==='transactions/'+sourceSaleId)data.cancelledFoodPurchaseId=secondId;
        if(write.path==='transactions/'+purchaseId)data.saleId=secondId;
        if(write.path==='staff_deductions/'+purchaseId)data.purchaseId=secondId;
        if(write.path==='pos_sale_commits/'+purchaseId)data.saleId=secondId;
        if(write.path==='settings/global_stats')data.lastSaleId=secondId;
        if(write.path==='shifts/'+shiftId)data.salesRevision=3;
        return {...write,path,data};
    });
    await assertFails(commitPacket(anon('approved-pos'),second));
    assert.equal((await read('transactions/'+sourceSaleId)).cancelledFoodPurchaseId,purchaseId);assert.equal(await read('transactions/'+secondId),undefined);assert.equal(await read('staff_deductions/'+secondId),undefined);
});
test('raw paired batch cannot falsify deduction discount/source audit metadata or frozen quote',async()=>{
    const writes=await packet();
    for(const change of [{originalAmount:1},{discountPct:99},{discountAmount:239},{sourceReceiptId:'wrong-receipt'},{sourcePlatform:'Cash'},{receiptId:'wrong-purchase'}]){
        const forged=writes.map(write=>write.path==='staff_deductions/'+purchaseId?{...write,data:{...write.data,...change}}:write);await assertFails(commitPacket(anon('approved-pos'),forged));
    }
    const forged=writes.map(write=>write.path==='transactions/'+purchaseId?{...write,data:{...write.data,cancelledFoodQuote:{...write.data.cancelledFoodQuote,amount:1}}}:write);await assertFails(commitPacket(anon('approved-pos'),forged));assert.equal(await read('staff_deductions/'+purchaseId),undefined);
});
test('legacy branch typed recovery rejects malformed or unsupported original source metadata and missing marker',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false});const writes=await packet(),source=await read('transactions/'+sourceSaleId);
    for(const change of [{saleVersion:1},{saleId:'wrong-source'},{paymentMethod:'Cash'},{inventoryState:'cancelled'},{cart:[]}]){
        await adminSet('transactions/'+sourceSaleId,{...source,...change});await assertFails(commitPacket(anon('approved-pos'),writes));assert.equal(await read('staff_deductions/'+purchaseId),undefined);
    }
    await adminSet('transactions/'+sourceSaleId,source);await admin(db=>sdk.deleteDoc(doc(db,'pos_sale_commits/'+sourceSaleId)));await assertFails(commitPacket(anon('approved-pos'),writes));
});
test('new receipt v2 identity, source receipt, discount type, zero cash and frozen source fingerprint are server validated',async()=>{
    await adminUpdate('offline_policy/'+branch,{protectSalesV2:false});const writes=await packet();
    for(const change of [{saleVersion:1},{saleId:'wrong-purchase'},{cancelledFoodSourceReceiptId:'wrong-original'},{globalDiscountType:'staff_meal'},{amountReceived:192}]){
        const forged=writes.map(write=>write.path==='transactions/'+purchaseId?{...write,data:{...write.data,...change}}:write);await assertFails(commitPacket(anon('approved-pos'),forged));
    }
    const forged=writes.map(write=>write.path==='transactions/'+purchaseId?{...write,data:{...write.data,cancelledFoodQuote:{...write.data.cancelledFoodQuote,fingerprint:'forged'}}}:write);await assertFails(commitPacket(anon('approved-pos'),forged));assert.equal(await read('staff_deductions/'+purchaseId),undefined);
});
test('a missing paired deduction or source-link write rejects the entire receipt creation',async()=>{
    const writes=await packet();for(const omitted of ['staff_deductions/'+purchaseId,'transactions/'+sourceSaleId])await assertFails(commitPacket(anon('approved-pos'),writes.filter(write=>write.path!==omitted)));assert.equal(await read('transactions/'+purchaseId),undefined);
});
test('direct unpaired Foods charge is denied for approved anonymous POS',async()=>{await assertFails(setDoc(doc(anon('approved-pos'),'staff_deductions/forged'),{type:'Cancelled Food Purchase',purchaseId:'forged',branch,staffId,staffName,amount:100,status:'Unpaid',category:'Foods',dateAdded:serverTimestamp()}));});
for(const changes of [{role:'Owner'},{role:''},{role:'Mystery Role'},{status:'resigned'},{status:' INACTIVE '},{active:false},{archived:true},{pin:'REVOKED'},{pin:'',securityPin:'REVOKED'}])test(`raw saved profile ${JSON.stringify(changes)} is denied by rules even after the app prepared an earlier valid packet`,async()=>{
    const writes=await packet();await adminUpdate('cashiers/'+staffId,changes);await assertFails(commitPacket(anon('approved-pos'),writes));assert.equal(await read('staff_deductions/'+purchaseId),undefined);
});
test('typing literal REVOKED cannot turn a revoked saved PIN into a valid new salary purchase',async()=>{
    const f=await cancelled();await adminUpdate('cashiers/'+staffId,{pin:'REVOKED'});await assert.rejects(f.e.purchase(purchaser(f.quote,{pin:'REVOKED'})),/PIN|access/i);assert.equal(await read('staff_deductions/'+purchaseId),undefined);
});
test('discount disable/change after packet preparation is server-denied rather than accepting a stale quote',async()=>{const writes=await packet();await adminUpdate('settings/global_pos_config',{cancelledFoodPurchaseEnabled:false});await assertFails(commitPacket(anon('approved-pos'),writes));await adminUpdate('settings/global_pos_config',{cancelledFoodPurchaseEnabled:true,cancelledFoodDiscountPct:25});await assertFails(commitPacket(anon('approved-pos'),writes));});
test('shift closed after packet preparation refuses all financial and receipt writes',async()=>{const writes=await packet();await adminUpdate('shifts/'+shiftId,{active:false,status:'Closed'});await assertFails(commitPacket(anon('approved-pos'),writes));});
test('replaying the same raw purchase batch cannot debit twice while the engine acknowledges the committed result',async()=>{const writes=await packet();await assertSucceeds(commitPacket(anon('approved-pos'),writes));await assertFails(commitPacket(anon('approved-pos'),writes));const f=engine(anon('approved-pos')),saved=await read('transactions/'+purchaseId);await assertSucceeds(f.purchase(purchaser(saved.cancelledFoodQuote)));assert.equal((await read('staff_deductions/'+purchaseId)).amount,192);assert.equal((await read('shifts/'+shiftId)).salesRevision,2);});
test('approved POS cannot update or delete the new Foods deduction after purchase',async()=>{const f=await cancelled();await f.e.purchase(purchaser(f.quote));await assertFails(updateDoc(doc(f.db,'staff_deductions/'+purchaseId),{amount:1}));await assertFails(sdk.deleteDoc(doc(f.db,'staff_deductions/'+purchaseId)));});
test('same-engine concurrent real transactions make one purchase and one Foods deduction',async()=>{const f=await cancelled();await Promise.all([f.e.purchase(purchaser(f.quote)),f.e.purchase(purchaser(f.quote))]);assert.equal((await read('staff_deductions/'+purchaseId)).amount,192);assert.equal((await read('shifts/'+shiftId)).salesRevision,2);});
test('retained deferred prepared ingredients resume once under the protected sale transition',async()=>{await adminUpdate('transactions/'+sourceSaleId,{inventoryState:'deferred'});await adminUpdate('inventory/emulator-batter',{currentStock:100});const f=await cancelled();await f.e.purchase(purchaser(f.quote));const sales=createSaleEngine(api(f.db));await assertSucceeds(sales.resumeAudit(branch));await assertSucceeds(sales.resumeAudit(branch));assert.equal((await read('inventory/emulator-batter')).currentStock,88);});


test('staff Inbox is restricted to the approved employee device and replies cannot change charges',async()=>{
 const id='online-refund-'+sourceSaleId;await refundEngine().record(refundInput());await adminSet('staff_document_devices/own-staff-phone',{uid:'own-staff-phone',staffId,active:true});await adminSet('staff_document_devices/other-staff-phone',{uid:'other-staff-phone',staffId:'another-employee',active:true});
 const own=anon('own-staff-phone'),other=anon('other-staff-phone');await assertSucceeds(getDocsFromServer(query(collection(own,'staff_deduction_notices'),where('staffId','==',staffId))));await assertFails(getDocFromServer(doc(other,'staff_deduction_notices/'+id)));await assertFails(getDocsFromServer(collection(own,'staff_deduction_notices')));
 await assertSucceeds(updateDoc(doc(own,'staff_deduction_notices/'+id),{staffReply:'SAMPLE employee response',replyRevision:1,repliedAt:serverTimestamp(),repliedByUid:'own-staff-phone'}));await assertFails(updateDoc(doc(own,'staff_deduction_notices/'+id),{amount:0}));await assertFails(updateDoc(doc(own,'staff_deductions/'+id),{amount:0}));await assertFails(updateDoc(doc(other,'staff_deduction_notices/'+id),{staffReply:'spoofed',replyRevision:2,repliedAt:serverTimestamp(),repliedByUid:'other-staff-phone'}));await assertSucceeds(updateDoc(doc(own,'staff_deduction_notices/'+id),{readRevision:1,readAt:serverTimestamp()}));
});
test('legacy pending incident needs explicit Owner application and receives its first Inbox notice',async()=>{
 const id='online-refund-'+sourceSaleId;await refundEngine().record(refundInput());await admin(async db=>{await updateDoc(doc(db,'online_order_incidents/'+id),{version:1,status:'Pending Review',amount:0,authorizedAmount:0});await updateDoc(doc(db,'staff_deductions/'+id),{status:'Pending Review',amount:0,authorizedAmount:0,noticeRevision:0});await sdk.deleteDoc(doc(db,'staff_deduction_notices/'+id));});
 await assert.rejects(refundEngine().review({id,revision:0,response:'SAMPLE employee response',reviewNote:'SAMPLE policy review'}),/reviewed payroll policy/);await assertSucceeds(refundEngine().review({id,revision:0,response:'SAMPLE employee response',reviewNote:'SAMPLE policy review',policyReviewed:true}));assert.equal((await read('staff_deductions/'+id)).amount,80);await assertSucceeds(getDocFromServer(doc(google('owner-read','jgo031996@gmail.com'),'staff_deduction_notices/'+id)));
});
test('a non-Owner cannot forge a private notice or approve their own employee binding',async()=>{
 const id='online-refund-'+sourceSaleId;await refundEngine().record(refundInput());const staff=anon('unapproved-staff-phone');await assertFails(getDocFromServer(doc(staff,'staff_deduction_notices/'+id)));await assertFails(setDoc(doc(staff,'staff_document_devices/unapproved-staff-phone'),{uid:'unapproved-staff-phone',staffId,active:true}));await assertFails(setDoc(doc(staff,'staff_deduction_notices/orphan'),{id:'orphan',staffId,amount:0}));
});
test('full rules allow atomic Owner payroll settlement and deny ledger edits afterwards',async()=>{
 const {createRefundPayrollEngine}=await import('../takodeal-manager/refund-payroll.js');const id='online-refund-'+sourceSaleId,db=google('owner-pay','jgo031996@gmail.com');await refundEngine(db).record(refundInput());await adminSet('cash_accounts/sample-account',{name:'SAMPLE Account',balance:1000});const data={name:staffName,staffId,start:'2026-10-01',end:'2026-10-15',onlineRefunds:80,onlineRefundRows:[{id,amount:80}],advances:0,meals:0,loans:0};await assertSucceeds(createRefundPayrollEngine({...api(db),auth:{currentUser:{uid:'owner-pay',email:'jgo031996@gmail.com'}}},{ownerCheck:()=>true}).pay({data,accountId:'sample-account',finalNetPay:420}));assert.equal((await read('staff_deductions/'+id)).status,'Paid');assert.equal((await read('cash_accounts/sample-account')).balance,580);await assertFails(updateDoc(doc(db,'staff_deductions/'+id),{status:'Unpaid'}));await assertFails(updateDoc(doc(db,'payroll_records/refund-payroll-'+staffId+'-2026-10-01-2026-10-15'),{finalNetPay:999}));
});
