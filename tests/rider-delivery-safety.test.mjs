import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firestoreHarness} from './helpers/firestore-harness.mjs';
import {claimDeliveryAtomic,acceptPingAtomic,pickupDeliveryAtomic,completeDeliveryAtomic,rejectPingAtomic,reviewRiderStatusAtomic,reviewRiderTopUpAtomic,requestRiderTopUpAtomic,setRiderAvailabilityAtomic,deliveryPaymentPlan,riderMoneyCents} from '../takodeal-delivery/rider-delivery-safety.js';
import {captureRiderManagerActor,configureRiderManagerAuthority,installRiderManagementSafety} from '../takodeal-manager/rider-management.js';
import {createWorkspaceSession} from '../takodeal-manager/workspace-access-model.js';
const order={branch:'Maa',orderType:'Delivery',totalAmount:640,deliveryFee:50,paymentMode:'Cash',status:'ready',items:[{name:'Takoyaki',qty:1}],customerEmail:'sample@example.test',orderCode:'TKDL-SAMPLE'};
const rider={status:'active',name:'Sample Rider',phone:'09000000000',plateNumber:'SAMPLE',walletBalance:2000,isAcceptingOrders:true};
function fixture(){
    const h=firestoreHarness();h.put('incoming_orders/order',order);h.put('riders/a',rider);h.put('riders/b',{...rider,name:'Other Rider'});
    const actor={authUid:'anonymous-a',riderId:'a',sessionEpoch:1},api={...h.api};let current={...actor};
    api.captureRiderActor=()=>({...current});api.assertRiderActor=value=>{assert.deepEqual(value,current,'Rider session changed');};
    api.getDocFromServer=async ref=>({id:ref.id,exists:()=>h.docs.has(ref.path),data:()=>structuredClone(h.get(ref.path))});
    return {h,api,actor,switchActor:value=>{current=value;}};
}
function managerFixture({permissions=['riders'],assignedBranch=['All'],role='Manager',email='hq@example.test'}={}){
    const f=fixture(),user={uid:'hq-user',email,emailVerified:true},saved={email,role,fullName:'Sample Manager',permissions,assignedBranch,pin:'1111',active:true};
    f.h.put('hq_managers/hq',saved);f.h.put('rider_topups/topup',{riderId:'a',riderName:'Sample Rider',reference:'REF-SAMPLE',proofUrl:'https://example.invalid/proof.jpg',status:'pending'});
    f.api.auth={currentUser:user};f.api.sessionUser=createWorkspaceSession(user,saved);configureRiderManagerAuthority(f.api);
    return {...f,user,saved,manager:captureRiderManagerActor(f.api)};
}
const claim=f=>({orderId:'order',operationId:'claim-one',actor:f.actor});
const topup=f=>({requestId:'topup',riderId:'a',operationId:'credit-one',actor:f.manager,decision:'approved',amount:500});
test('shared Rider and Manager transaction code is byte-identical',()=>assert.equal(readFileSync(new URL('../takodeal-delivery/rider-delivery-safety.js',import.meta.url),'utf8'),readFileSync(new URL('../takodeal-manager/rider-delivery-safety.js',import.meta.url),'utf8')));
test('cash claim atomically debits the existing whole total including delivery fee and preserves sale/cart fields',async()=>{
    const f=fixture(),result=await claimDeliveryAtomic(f.api,claim(f));assert.equal(result.debited,640);assert.equal(f.h.get('riders/a').walletBalance,1360);
    const saved=f.h.get('incoming_orders/order');assert.equal(saved.status,'out_for_delivery');assert.equal(saved.riderId,'a');assert.equal(saved.riderClaim.debitCents,64000);assert.equal(saved.riderClaim.actorUid,'anonymous-a');
    for(const key of ['items','totalAmount','deliveryFee','branch','customerEmail','paymentMode'])assert.deepEqual(saved[key],order[key]);assert.equal(f.h.docs.size,3);
});
test('two riders racing to claim one ready order produce exactly one winner and one wallet debit',async()=>{
    const f=fixture(),bActor={authUid:'anonymous-b',riderId:'b',sessionEpoch:1},bApi={...f.api,captureRiderActor:()=>bActor,assertRiderActor:value=>assert.deepEqual(value,bActor)};
    const results=await Promise.allSettled([claimDeliveryAtomic(f.api,claim(f)),claimDeliveryAtomic(bApi,{orderId:'order',operationId:'claim-b',actor:bActor})]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);
    assert.equal(f.h.get('riders/a').walletBalance+f.h.get('riders/b').walletBalance,3360);assert.ok(f.h.retries()>0);
});
test('same claim concurrent calls and lost acknowledgement debit only once',async()=>{
    const f=fixture();await Promise.all([claimDeliveryAtomic(f.api,claim(f)),claimDeliveryAtomic(f.api,claim(f))]);assert.equal(f.h.get('riders/a').walletBalance,1360);
    const g=fixture();g.h.loseNextAck();await assert.rejects(claimDeliveryAtomic(g.api,claim(g)),/Connection lost/);assert.equal((await claimDeliveryAtomic(g.api,claim(g))).alreadySaved,true);assert.equal(g.h.get('riders/a').walletBalance,1360);
});
test('rejected transaction keeps both the ready order and wallet intact',async()=>{
    const f=fixture();f.h.failNextCommit();await assert.rejects(claimDeliveryAtomic(f.api,claim(f)),/Commit rejected/);assert.deepEqual(f.h.get('incoming_orders/order'),order);assert.deepEqual(f.h.get('riders/a'),rider);
});
test('fresh approval, branch, payment and order state checks reject unsafe claims',async()=>{
    const changes=[['riders/a',{...rider,status:'pending_approval'}],['riders/a',{...rider,status:'rejected'}],['riders/a',{...rider,status:'banned'}],['riders/a',{...rider,status:'unknown'}],['riders/a',{...rider,allowedBranches:['Cabantian']}],['riders/a',{...rider,walletBalance:639}],
        ['incoming_orders/order',{...order,status:'completed'}],['incoming_orders/order',{...order,riderId:'b'}],['incoming_orders/order',{...order,orderType:'Pickup'}],['incoming_orders/order',{...order,paymentMode:''}],['incoming_orders/order',{...order,totalAmount:-1}]];
    for(const [path,data] of changes){const f=fixture();f.h.put(path,data);await assert.rejects(claimDeliveryAtomic(f.api,claim(f)));assert.deepEqual(f.h.get(path),data);if(path!=='riders/a')assert.equal(f.h.get('riders/a').walletBalance,2000);}
});
test('prepaid fields use Customer paymentMode or POS paymentMethod; mismatches fail clearly',()=>{
    assert.deepEqual(deliveryPaymentPlan({...order,paymentMode:'Online'}),{kind:'prepaid',debitCents:0,totalCents:64000});
    assert.equal(deliveryPaymentPlan({...order,paymentMode:undefined,paymentMethod:'GCash'}).kind,'prepaid');assert.throws(()=>deliveryPaymentPlan({...order,paymentMethod:'GCash'}),/disagree/);
    assert.equal(riderMoneyCents('123.45'),12345);for(const value of ['',NaN,Infinity,-1,'200x','1.001',{},null])assert.throws(()=>riderMoneyCents(value));
});
function prepaid(f,patch={},receiptPatch={}){
    f.h.put('incoming_orders/order',{...order,paymentMode:'Online',paymentStatus:'paid',receiptId:'TKDL-SAMPLE',...patch});
    f.h.put('transactions/receipt',{receiptId:'TKDL-SAMPLE',branch:'Maa',paymentMethod:'GCash',paymentVerified:true,status:'Paid',mobileOrderId:'order',...receiptPatch});
}
test('exact HQ-verified prepaid receipt permits claim without any wallet debit',async()=>{
    const f=fixture();prepaid(f);const result=await claimDeliveryAtomic(f.api,claim(f));assert.equal(result.debited,0);assert.equal(f.h.get('riders/a').walletBalance,2000);assert.equal(f.h.get('incoming_orders/order').riderClaim.paymentKind,'prepaid');
    const g=fixture();g.h.put('incoming_orders/delivery-sale',{...order,orderType:undefined,paymentMode:undefined,paymentMethod:'GCash',orderCode:'TKDL-SAMPLE'});g.h.put('transactions/receipt',{receiptId:'TKDL-SAMPLE',branch:'Maa',paymentMethod:'GCash',paymentVerified:true,status:'Paid'});
    assert.equal((await claimDeliveryAtomic(g.api,{...claim(g),orderId:'delivery-sale'})).debited,0);
});
test('encoded-but-unverified, voided, ambiguous, missing or other-order prepaid receipts never permit claim',async()=>{
    for(const scenario of ['unverified','voided','cash','other-branch','other-order','missing','duplicate','unpaid']){
        const f=fixture();prepaid(f,scenario==='unpaid'?{paymentStatus:'unpaid'}:{},scenario==='unverified'?{paymentVerified:false}:scenario==='voided'?{status:'Voided'}:scenario==='cash'?{paymentMethod:'Cash'}:scenario==='other-branch'?{branch:'Cabantian'}:scenario==='other-order'?{mobileOrderId:'other'}:{});
        if(scenario==='missing')f.h.docs.delete('transactions/receipt');if(scenario==='duplicate')f.h.put('transactions/duplicate',{...f.h.get('transactions/receipt')});
        await assert.rejects(claimDeliveryAtomic(f.api,claim(f)),/receipt|paid|another order/);assert.equal(f.h.get('incoming_orders/order').status,'ready');assert.equal(f.h.get('riders/a').walletBalance,2000);
    }
});
test('receipt verification and rider approval are rechecked inside transaction, not trusted from preflight',async()=>{
    for(const at of ['receipt','rider']){const f=fixture();prepaid(f);const original=f.api.runTransaction;f.api.runTransaction=(db,callback)=>{const path=at==='receipt'?'transactions/receipt':'riders/a';f.h.put(path,{...f.h.get(path),...(at==='receipt'?{paymentVerified:false}:{status:'banned'})});return original(db,callback);};await assert.rejects(claimDeliveryAtomic(f.api,claim(f)));assert.equal(f.h.get('incoming_orders/order').status,'ready');}
});
test('account changes or same-account re-login during a pending read cannot claim',async()=>{
    for(const different of [true,false]){const f=fixture(),original=f.api.getDocFromServer;f.api.getDocFromServer=async ref=>{const snap=await original(ref);f.switchActor(different?{...f.actor,riderId:'b'}:{...f.actor,sessionEpoch:2});return snap;};await assert.rejects(claimDeliveryAtomic(f.api,claim(f)),/session changed/);assert.equal(f.h.get('riders/a').walletBalance,2000);assert.equal(f.h.get('incoming_orders/order').status,'ready');}
});
test('ping accept is atomic, requires its exact current target and keeps existing delivery tracking status',async()=>{
    const f=fixture();f.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'a'});await acceptPingAtomic(f.api,claim(f));assert.equal(f.h.get('incoming_orders/order').status,'out_for_delivery');assert.equal(f.h.get('incoming_orders/order').pingedRider,null);assert.equal(f.h.get('riders/a').walletBalance,1360);
    const g=fixture();g.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'b'});await assert.rejects(acceptPingAtomic(g.api,claim(g)),/no longer assigned/);assert.equal(g.h.get('riders/a').walletBalance,2000);
});
test('ping rejection preserves previous declined riders and cannot clear a later target',async()=>{
    const f=fixture();f.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'a',declinedBy:['older']});f.h.loseNextAck();await assert.rejects(rejectPingAtomic(f.api,claim(f)),/Connection lost/);assert.equal((await rejectPingAtomic(f.api,claim(f))).alreadySaved,true);assert.deepEqual(f.h.get('incoming_orders/order').declinedBy,['older','a']);assert.equal(f.h.get('riders/a').walletBalance,2000);
    const g=fixture();g.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'b',declinedBy:['older']});await assert.rejects(rejectPingAtomic(g.api,claim(g)),/another rider/);assert.equal(g.h.get('incoming_orders/order').pingedRider,'b');assert.deepEqual(g.h.get('incoming_orders/order').declinedBy,['older']);
});
test('legacy owned ongoing delivery can complete once with proof without recalculating stock, receipts or wallet',async()=>{
    const f=fixture();f.h.put('incoming_orders/order',{...order,status:'out_for_delivery',riderId:'a'});const input={...claim(f),operationId:'complete-one',proofUrl:'https://example.invalid/sample-proof.jpg'};
    f.h.loseNextAck();await assert.rejects(completeDeliveryAtomic(f.api,input),/Connection lost/);assert.equal((await completeDeliveryAtomic(f.api,input)).alreadySaved,true);assert.equal(f.h.get('incoming_orders/order').status,'completed');assert.equal(f.h.get('incoming_orders/order').proofOfDeliveryUrl,input.proofUrl);assert.equal(f.h.get('riders/a').walletBalance,2000);assert.equal(f.h.docs.size,3);
    await assert.rejects(completeDeliveryAtomic(f.api,{...input,proofUrl:'https://example.invalid/changed.jpg'}),/different delivery change/);
});
test('completion refuses other rider, wrong stage, revoked rider, stale actor and missing/unsafe proof',async()=>{
    for(const scenario of ['other','ready','banned','actor','proof']){const f=fixture();f.h.put('incoming_orders/order',{...order,status:scenario==='ready'?'ready':'out_for_delivery',riderId:scenario==='other'?'b':'a'});if(scenario==='banned')f.h.put('riders/a',{...rider,status:'banned'});if(scenario==='actor')f.switchActor({...f.actor,sessionEpoch:2});await assert.rejects(completeDeliveryAtomic(f.api,{...claim(f),proofUrl:scenario==='proof'?'javascript:alert(1)':'https://example.invalid/proof.jpg'}));assert.notEqual(f.h.get('incoming_orders/order').status,'completed');}
});
test('optional pickup records metadata once while retaining out_for_delivery compatibility',async()=>{
    const f=fixture();f.h.put('incoming_orders/order',{...order,status:'out_for_delivery',riderId:'a'});await pickupDeliveryAtomic(f.api,claim(f));assert.equal((await pickupDeliveryAtomic(f.api,claim(f))).alreadySaved,true);assert.equal(f.h.get('incoming_orders/order').status,'out_for_delivery');assert.ok(f.h.get('incoming_orders/order').riderPickedUpAt);assert.equal(f.h.get('riders/a').walletBalance,2000);
});
test('two Managers crediting the same pending request produce exactly one credit',async()=>{
    const f=managerFixture(),otherUser={uid:'other-hq',email:'other-hq@example.test',emailVerified:true},otherSaved={...f.saved,email:otherUser.email};f.h.put('hq_managers/other',otherSaved);
    const otherApi={...f.api,auth:{currentUser:otherUser},sessionUser:createWorkspaceSession(otherUser,otherSaved)};configureRiderManagerAuthority(otherApi);const otherActor=captureRiderManagerActor(otherApi);
    const results=await Promise.allSettled([reviewRiderTopUpAtomic(f.api,topup(f)),reviewRiderTopUpAtomic(otherApi,{...topup(f),actor:otherActor,operationId:'other-credit'})]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.h.get('riders/a').walletBalance,2500);assert.equal(f.h.get('rider_topups/topup').status,'approved');assert.ok(f.h.retries()>0);
});
test('top-up lost ACK retries once; different amount/decision/actor cannot reuse the operation',async()=>{
    const f=managerFixture();f.h.loseNextAck();await assert.rejects(reviewRiderTopUpAtomic(f.api,topup(f)),/Connection lost/);assert.equal((await reviewRiderTopUpAtomic(f.api,topup(f))).alreadySaved,true);assert.equal(f.h.get('riders/a').walletBalance,2500);
    await assert.rejects(reviewRiderTopUpAtomic(f.api,{...topup(f),amount:501}),/attempt was changed/);await assert.rejects(reviewRiderTopUpAtomic(f.api,{...topup(f),decision:'rejected'}),/attempt was changed/);assert.equal(f.h.get('riders/a').walletBalance,2500);
});
test('concurrent cash claim and top-up retain both wallet movements',async()=>{
    const f=managerFixture();await Promise.all([claimDeliveryAtomic(f.api,claim(f)),reviewRiderTopUpAtomic(f.api,topup(f))]);assert.equal(f.h.get('riders/a').walletBalance,1860);assert.equal(f.h.get('incoming_orders/order').status,'out_for_delivery');assert.equal(f.h.get('rider_topups/topup').status,'approved');
});
test('top-up commit rejection changes neither request nor wallet; reject changes only review metadata',async()=>{
    const f=managerFixture();f.h.failNextCommit();await assert.rejects(reviewRiderTopUpAtomic(f.api,topup(f)),/Commit rejected/);assert.equal(f.h.get('rider_topups/topup').status,'pending');assert.equal(f.h.get('riders/a').walletBalance,2000);
    await reviewRiderTopUpAtomic(f.api,{...topup(f),decision:'rejected'});assert.equal(f.h.get('rider_topups/topup').status,'rejected');assert.equal(f.h.get('riders/a').walletBalance,2000);assert.equal(f.h.get('rider_topups/topup').processedBy,'hq@example.test');
});
test('top-up refuses wrong rider, unapproved rider, invalid money and already processed legacy request',async()=>{
    for(const scenario of ['wrong-rider','inactive','legacy-approved','invalid']){const f=managerFixture();if(scenario==='wrong-rider')f.h.put('rider_topups/topup',{...f.h.get('rider_topups/topup'),riderId:'b'});if(scenario==='inactive')f.h.put('riders/a',{...rider,status:'rejected'});if(scenario==='legacy-approved')f.h.put('rider_topups/topup',{...f.h.get('rider_topups/topup'),status:'approved'});await assert.rejects(reviewRiderTopUpAtomic(f.api,{...topup(f),...(scenario==='invalid'?{amount:Infinity}:{})}));assert.equal(f.h.get('riders/a').walletBalance,2000);}
});
test('approval is explicit, audited and idempotent; stale decision cannot override another Manager',async()=>{
    const f=managerFixture();f.h.put('riders/a',{...rider,status:'pending_approval',isAcceptingOrders:true});const input={riderId:'a',operationId:'approval-one',actor:f.manager,status:'active',expectedStatus:'pending_approval'};
    f.h.loseNextAck();await assert.rejects(reviewRiderStatusAtomic(f.api,input),/Connection lost/);assert.equal((await reviewRiderStatusAtomic(f.api,input)).alreadySaved,true);assert.equal(f.h.get('riders/a').status,'active');assert.equal(f.h.get('riders/a').isAcceptingOrders,false);assert.equal(f.h.get('riders/a').statusReviewedBy,'hq@example.test');assert.equal(f.h.get('riders/a').approvalOperation.fromStatus,'pending_approval');
    await reviewRiderStatusAtomic(f.api,{...input,operationId:'suspend',status:'banned',expectedStatus:'active'});await assert.rejects(reviewRiderStatusAtomic(f.api,input),/already changed/);assert.equal(f.h.get('riders/a').status,'banned');
});
test('Manager actions require verified Google identity, fresh saved riders permission and explicit fleet branch scope',async()=>{
    for(const scenario of ['unverified','signed-out','session','permission','revoked','scope','missing-scope','blocked']){
        const f=managerFixture(scenario==='scope'?{assignedBranch:['Maa']}:{});
        if(scenario==='unverified')f.api.auth.currentUser.emailVerified=false;if(scenario==='signed-out')f.api.auth.currentUser=null;if(scenario==='session')f.api.sessionUser=null;
        if(scenario==='permission')f.api.sessionUser.permissions=['dashboard'];
        if(scenario==='revoked')f.h.put('hq_managers/hq',{...f.saved,permissions:['dashboard']});if(scenario==='missing-scope')f.h.put('hq_managers/hq',{...f.saved,assignedBranch:undefined});if(scenario==='blocked')f.h.put('hq_managers/hq',{...f.saved,blocked:true});
        await assert.rejects(reviewRiderTopUpAtomic(f.api,topup(f)));assert.equal(f.h.get('riders/a').walletBalance,2000);assert.equal(f.h.get('rider_topups/topup').status,'pending');
    }
});
test('a branch-scoped Manager may review a rider explicitly assigned only to that same branch',async()=>{
    const f=managerFixture({assignedBranch:['Maa']});f.h.put('riders/a',{...rider,allowedBranches:['Maa']});await reviewRiderTopUpAtomic(f.api,topup(f));assert.equal(f.h.get('riders/a').walletBalance,2500);
});
test('canonical duplicate HQ permission winner and fresh revocation during transaction are authoritative',async()=>{
    const f=managerFixture();f.h.put('hq_managers/hq',{...f.saved,permissionsUpdatedAt:{seconds:1}});f.h.put('hq_managers/new-permission',{...f.saved,permissions:['dashboard'],permissionsUpdatedAt:{seconds:2}});await assert.rejects(reviewRiderTopUpAtomic(f.api,topup(f)),/saved permissions/);
    const g=managerFixture(),original=g.api.runTransaction;g.api.runTransaction=(db,callback)=>{g.h.put('hq_managers/hq',{...g.saved,permissions:['dashboard']});return original(db,callback);};await assert.rejects(reviewRiderTopUpAtomic(g.api,topup(g)),/saved permissions/);assert.equal(g.h.get('riders/a').walletBalance,2000);
});
test('Manager identity changes during pending reads cannot mutate approval or wallet',async()=>{
    const f=managerFixture(),original=f.api.getDocsFromServer;f.api.getDocsFromServer=async query=>{const snap=await original(query);f.api.auth.currentUser={...f.user,uid:'other'};return snap;};await assert.rejects(reviewRiderTopUpAtomic(f.api,topup(f)));assert.equal(f.h.get('riders/a').walletBalance,2000);
});
test('stable rider top-up submission survives lost ACK without reopening a reviewed request',async()=>{
    const f=fixture(),input={topupId:'request-ref',operationId:'request-one',actor:f.actor,reference:'REF-001',proofUrl:'https://example.invalid/proof.jpg'};
    f.h.loseNextAck();await assert.rejects(requestRiderTopUpAtomic(f.api,input),/Connection lost/);assert.equal((await requestRiderTopUpAtomic(f.api,input)).alreadySaved,true);f.h.put('rider_topups/request-ref',{...f.h.get('rider_topups/request-ref'),status:'approved',amountAdded:500});
    assert.equal((await requestRiderTopUpAtomic(f.api,input)).status,'approved');assert.equal(f.h.get('rider_topups/request-ref').amountAdded,500);assert.equal(f.h.get('riders/a').walletBalance,2000);
    await assert.rejects(requestRiderTopUpAtomic(f.api,{...input,proofUrl:'https://example.invalid/changed.jpg'}),/different request/);assert.equal([...f.h.docs.keys()].filter(path=>path.startsWith('rider_topups/')).length,1);
});
test('availability updates only fresh approved rider and keeps displayed state unchanged on failed save',async()=>{
    const f=fixture();f.h.put('riders/a',{...rider,isAcceptingOrders:false});await setRiderAvailabilityAtomic(f.api,{actor:f.actor,isAcceptingOrders:true});assert.equal(f.h.get('riders/a').isAcceptingOrders,true);assert.equal((await setRiderAvailabilityAtomic(f.api,{actor:f.actor,isAcceptingOrders:true})).alreadySaved,true);
    f.h.put('riders/a',{...f.h.get('riders/a'),status:'banned'});await assert.rejects(setRiderAvailabilityAtomic(f.api,{actor:f.actor,isAcceptingOrders:false}),/approval/);assert.equal(f.h.get('riders/a').isAcceptingOrders,true);
});
test('new cash and ping claims require fresh online availability; owned completion remains possible after going offline',async()=>{
    for(const ping of [false,true]){const f=fixture();f.h.put('riders/a',{...rider,isAcceptingOrders:false});if(ping)f.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'a'});await assert.rejects((ping?acceptPingAtomic:claimDeliveryAtomic)(f.api,claim(f)),/Go online/);assert.equal(f.h.get('riders/a').walletBalance,2000);}
    const f=fixture();f.h.put('riders/a',{...rider,isAcceptingOrders:false});f.h.put('incoming_orders/order',{...order,status:'out_for_delivery',riderId:'a'});await completeDeliveryAtomic(f.api,{...claim(f),proofUrl:'https://example.invalid/proof.jpg'});assert.equal(f.h.get('incoming_orders/order').status,'completed');
});
test('actual Manager review wrapper locks immediately, uses fresh rider name, cancels safely and rechecks actor after dialog',async()=>{
    const f=managerFixture(),dialogs=[];let resolveDialog;f.api.Swal={fire:async options=>{dialogs.push(options);if(options.showCancelButton)return new Promise(resolve=>{resolveDialog=resolve;});return {};}};f.api.crypto={randomUUID:()=> 'sample-id'};installRiderManagementSafety(f.api);
    const pending=f.api.updateRiderStatus('a','banned','<bad cached name>');assert.equal(f.api.riderManagementSafety.busy(),true);assert.equal(await f.api.updateRiderStatus('a','banned'),false);
    while(!resolveDialog)await Promise.resolve();assert.match(dialogs[0].text,/Sample Rider/);assert.equal(dialogs[0].html,undefined);f.api.auth.currentUser={...f.user,uid:'other'};resolveDialog({isConfirmed:true});assert.equal(await pending,false);assert.equal(f.h.get('riders/a').status,'active');assert.equal(f.api.riderManagementSafety.busy(),false);
});
test('already committed claim cannot silently accept changed financial terms',async()=>{
    const f=fixture();await claimDeliveryAtomic(f.api,claim(f));f.h.put('incoming_orders/order',{...f.h.get('incoming_orders/order'),totalAmount:700});await assert.rejects(claimDeliveryAtomic(f.api,claim(f)),/changed after this claim/);assert.equal(f.h.get('riders/a').walletBalance,1360);
});
test('reject preserves all retained decline entries and holds inconsistent legacy history',async()=>{
    const f=fixture();f.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'a',declinedBy:['older',{legacy:'retained'}]});await rejectPingAtomic(f.api,claim(f));assert.deepEqual(f.h.get('incoming_orders/order').declinedBy,['older',{legacy:'retained'},'a']);
    const g=fixture();g.h.put('incoming_orders/order',{...order,status:'looking_for_rider',pingedRider:'a',declinedBy:'legacy value'});await assert.rejects(rejectPingAtomic(g.api,claim(g)),/inconsistent/);assert.equal(g.h.get('incoming_orders/order').declinedBy,'legacy value');assert.equal(g.h.get('incoming_orders/order').pingedRider,'a');
});
test('verified main Owner can review legacy global fleet without inventing another account branch assignment',async()=>{
    const f=managerFixture({email:'jgo031996@gmail.com'});f.h.put('hq_managers/hq',{...f.saved,assignedBranch:undefined});await reviewRiderTopUpAtomic(f.api,topup(f));assert.equal(f.h.get('riders/a').walletBalance,2500);assert.equal(f.h.get('hq_managers/hq').assignedBranch,undefined);
});
test('Manager approval wrapper cancelled dialog creates no audit or status change',async()=>{
    const f=managerFixture();f.api.Swal={fire:async()=>({isConfirmed:false})};installRiderManagementSafety(f.api);assert.equal(await f.api.updateRiderStatus('a','banned'),false);assert.equal(f.h.get('riders/a').status,'active');assert.equal(f.h.get('riders/a').approvalOperation,undefined);
});
test('actual Manager top-up wrapper credits once and refuses a second review after request completion',async()=>{
    const f=managerFixture(),dialogs=[];f.api.Swal={fire:async options=>{dialogs.push(options);return {isConfirmed:true,value:'500.00'};}};f.api.crypto={randomUUID:()=> 'test-op'};installRiderManagementSafety(f.api);
    assert.equal(await f.api.approveTopUp('topup','a','ignored cached name'),true);assert.equal(f.h.get('riders/a').walletBalance,2500);assert.equal(await f.api.approveTopUp('topup','a'),false);assert.equal(f.h.get('riders/a').walletBalance,2500);assert.match(dialogs.at(-1).text,/already been reviewed/);
});
test('actor changes during transaction reads and rejected top-up submission cannot create stale requests',async()=>{
    for(const scenario of ['actor','unapproved','commit']){const f=fixture(),original=f.api.runTransaction,input={topupId:'request',operationId:'request-one',actor:f.actor,reference:'REF-001',proofUrl:'https://example.invalid/proof.jpg'};
        if(scenario==='actor')f.api.runTransaction=(db,callback)=>original(db,tx=>callback({...tx,get:async ref=>{const snap=await tx.get(ref);f.switchActor({...f.actor,sessionEpoch:2});return snap;}}));
        if(scenario==='unapproved')f.h.put('riders/a',{...rider,status:'pending_approval'});if(scenario==='commit')f.h.failNextCommit();await assert.rejects(requestRiderTopUpAtomic(f.api,input));assert.equal(f.h.get('rider_topups/request'),undefined);
    }
});
