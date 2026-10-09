// These client transactions prevent races in the app. Existing legacy Rules do
// not bind an anonymous Firebase UID to a rider; this is not server authorization.
const text=value=>typeof value==='string'?value.trim():'';
const normalized=value=>text(value).toLowerCase();
const fingerprint=value=>JSON.stringify(value);
const validId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
function id(value,label){if(!validId(value))throw Error(`Choose a valid ${label}.`);return value;}
export function riderMoneyCents(value,label='amount') {
    if(typeof value!=='number' && !(typeof value==='string' && /^\d+(?:\.\d{1,2})?$/.test(value.trim())))throw Error(`The ${label} is invalid. Ask HQ to review it.`);
    const number=Number(value),cents=Math.round(number*100);
    if(!Number.isFinite(number) || number<0 || !Number.isSafeInteger(cents) || Math.abs(number*100-cents)>0.00001)throw Error(`The ${label} is invalid. Ask HQ to review it.`);
    return cents;
}
export function isApprovedRider(data){return ['active','approved'].includes(normalized(data?.status));}
function actorFor(api,input){
    if(typeof api.captureRiderActor!=='function' || typeof api.assertRiderActor!=='function')throw Error('Sign in again before changing a delivery.');
    const actor=input || api.captureRiderActor();api.assertRiderActor(actor);
    if(!actor?.authUid || !validId(actor.riderId))throw Error('Sign in again before changing a delivery.');
    return actor;
}
function assertRider(api,actor,data,branch=''){
    api.assertRiderActor(actor);
    if(!isApprovedRider(data))throw Error('Your rider approval is no longer active. Ask Manager to review it.');
    // Existing approved Main Office riders remain global. An explicit saved
    // assignment, when present, is authoritative and must include this branch.
    if(branch && Object.hasOwn(data,'allowedBranches')){
        const branches=Array.isArray(data.allowedBranches)?data.allowedBranches.map(text).filter(Boolean):[];
        if(!branches.includes('All') && !branches.includes(branch))throw Error('This delivery is outside your assigned branches.');
    }
}
function delivery(order,orderId){
    if(!text(order?.branch))throw Error('The delivery branch is missing. Refresh the board.');
    const type=normalized(order.orderType);
    if(type ? !type.includes('delivery') : !(text(order.deliveryAddress) || orderId.startsWith('delivery-')))throw Error('This is a pickup order, not a rider delivery.');
    return order;
}
export function deliveryPaymentPlan(order){
    const mode=normalized(order.paymentMode),method=normalized(order.paymentMethod);
    const cash=value=>['cash','cod','cash on delivery','cash-on-delivery'].includes(value);
    if(mode && method && cash(mode)!==cash(method))throw Error('The payment fields disagree. Ask the cashier to review this order.');
    const selected=mode || method;
    if(!selected)throw Error('The payment method is missing. Ask the cashier to review this order.');
    const total=riderMoneyCents(order.totalAmount,'order total');
    if(total<=0)throw Error('The delivery total must be greater than zero.');
    return {kind:cash(selected)?'cash':'prepaid',debitCents:cash(selected)?total:0,totalCents:total};
}
async function receiptFor(api,actor,orderId){
    const snap=await api.getDocFromServer(api.doc(api.db,'incoming_orders',orderId));api.assertRiderActor(actor);
    if(!snap.exists())throw Error('The delivery is no longer available.');
    const order=delivery(snap.data(),orderId),plan=deliveryPaymentPlan(order);
    if(plan.kind==='cash')return null;
    const receiptId=text(order.receiptId || order.orderCode);
    if(!receiptId)throw Error('HQ must verify the prepaid receipt before this delivery can be claimed.');
    const found=await api.getDocsFromServer(api.query(api.collection(api.db,'transactions'),api.where('receiptId','==',receiptId),api.where('branch','==',order.branch)));api.assertRiderActor(actor);
    if(found.docs.length!==1)throw Error('The prepaid receipt is missing or ambiguous. Ask HQ to review it.');
    return {id:found.docs[0].id,receiptId,branch:order.branch};
}
function verifiedReceipt(order,linked,snapshot){
    if(!linked || !snapshot?.exists())throw Error('HQ must verify the prepaid receipt before this delivery can be claimed.');
    const receipt=snapshot.data(),status=normalized(receipt.status),method=normalized(receipt.paymentMethod);
    if(receipt.branch!==order.branch || receipt.receiptId!==text(order.receiptId || order.orderCode) || linked.branch!==order.branch || linked.receiptId!==receipt.receiptId ||
       ['voided','void','cancelled','canceled','unpaid','pending'].includes(status) || receipt.paymentVerified!==true || !method || ['cash','cod','cash on delivery'].includes(method))
        throw Error('The prepaid receipt is not HQ-verified or was voided. Ask HQ to review it.');
    if(order.paymentStatus!==undefined && normalized(order.paymentStatus)!=='paid')throw Error('The online order is not recorded as paid. Ask the cashier to review it.');
    if(receipt.mobileOrderId && receipt.mobileOrderId!==order.id)throw Error('The prepaid receipt belongs to another order.');
}
function markerMatches(marker,operationId,actor,signature){
    if(marker?.operationId!==operationId)return false;
    if(marker.actorUid!==actor.authUid || marker.riderId!==actor.riderId || marker.signature!==signature)throw Error('This attempt was already used for a different delivery change. Refresh before retrying.');
    return true;
}
const claimTerms=(order,plan)=>fingerprint({branch:order.branch,totalCents:plan.totalCents,paymentKind:plan.kind,receiptId:text(order.receiptId || order.orderCode)});
async function claim(api,input,ping){
    const orderId=id(input.orderId,'delivery'),operationId=id(input.operationId,'save attempt'),actor=actorFor(api,input.actor);
    const linked=await receiptFor(api,actor,orderId);
    return api.runTransaction(api.db,async tx=>{
        api.assertRiderActor(actor);
        const orderRef=api.doc(api.db,'incoming_orders',orderId),riderRef=api.doc(api.db,'riders',actor.riderId);
        const orderSnap=await tx.get(orderRef);api.assertRiderActor(actor);
        const riderSnap=await tx.get(riderRef);api.assertRiderActor(actor);
        if(!orderSnap.exists() || !riderSnap.exists())throw Error('The delivery or rider record is missing. Refresh before retrying.');
        const order={...orderSnap.data(),id:orderId},rider=riderSnap.data();delivery(order,orderId);assertRider(api,actor,rider,order.branch);
        const plan=deliveryPaymentPlan(order),terms=claimTerms(order,plan),signature=fingerprint({action:ping?'accept-ping':'claim',orderId,riderId:actor.riderId}),old=order.riderClaim;
        if(markerMatches(old,operationId,actor,signature)){
            if(order.riderId!==actor.riderId || !['out_for_delivery','completed'].includes(order.status) || old.orderTerms!==terms)throw Error('The delivery changed after this claim. Ask Manager to review it.');
            return {alreadySaved:true,debited:old.debitCents/100,walletBalance:riderMoneyCents(rider.walletBalance ?? 0,'wallet balance')/100};
        }
        if(rider.isAcceptingOrders!==true)throw Error('Go online before accepting a new delivery.');
        if(order.riderId || order.status!==(ping?'looking_for_rider':'ready'))throw Error('Another rider or cashier already changed this delivery. Refresh the board.');
        if(ping && order.pingedRider!==actor.riderId)throw Error('This offer is no longer assigned to you.');
        if(!ping && order.pingedRider && order.pingedRider!==actor.riderId)throw Error('This delivery is reserved for another rider.');
        const balance=riderMoneyCents(rider.walletBalance ?? 0,'wallet balance');
        if(plan.kind==='prepaid'){
            const receipt=linked?await tx.get(api.doc(api.db,'transactions',linked.id)):null;api.assertRiderActor(actor);verifiedReceipt(order,linked,receipt);
        }
        if(balance<plan.debitCents)throw Error(`Insufficient wallet funds. This cash delivery needs ₱${(plan.debitCents/100).toFixed(2)}.`);
        assertRider(api,actor,rider,order.branch);
        const stamp=api.serverTimestamp(),nextBalance=(balance-plan.debitCents)/100;
        tx.update(orderRef,{status:'out_for_delivery',riderId:actor.riderId,riderName:text(rider.name),riderPhone:text(rider.phone),riderPlate:text(rider.plateNumber),riderSelfie:text(rider.selfieUrl),
            riderClaimedAt:stamp,acceptedAt:stamp,pingedRider:null,riderClaim:{version:1,operationId,actorUid:actor.authUid,riderId:actor.riderId,signature,orderTerms:terms,debitCents:plan.debitCents,paymentKind:plan.kind,claimedAt:stamp}});
        if(plan.debitCents)tx.update(riderRef,{walletBalance:nextBalance});
        return {saved:true,debited:plan.debitCents/100,walletBalance:nextBalance};
    });
}
export const claimDeliveryAtomic=(api,input)=>claim(api,input,false);
export const acceptPingAtomic=(api,input)=>claim(api,input,true);
async function ownedChange(api,input,complete){
    const orderId=id(input.orderId,'delivery'),operationId=id(input.operationId,'save attempt'),actor=actorFor(api,input.actor);
    let proofUrl='';if(complete){try{const url=new URL(input.proofUrl);if(url.protocol!=='https:' || url.username || url.password)throw Error();proofUrl=url.href;}catch{throw Error('Upload a valid delivery proof before completing this order.');}}
    const signature=fingerprint({action:complete?'complete':'pickup',orderId,riderId:actor.riderId,...(complete?{proofUrl}:{})});
    return api.runTransaction(api.db,async tx=>{
        const orderRef=api.doc(api.db,'incoming_orders',orderId),riderRef=api.doc(api.db,'riders',actor.riderId);
        const orderSnap=await tx.get(orderRef);api.assertRiderActor(actor);const riderSnap=await tx.get(riderRef);api.assertRiderActor(actor);
        if(!orderSnap.exists() || !riderSnap.exists())throw Error('The delivery or rider is missing.');
        const order=orderSnap.data(),rider=riderSnap.data();assertRider(api,actor,rider,order.branch);
        const key=complete?'riderCompletion':'riderPickup',marker=order[key];
        if(markerMatches(marker,operationId,actor,signature)){
            if(order.riderId!==actor.riderId || (complete?order.status!=='completed':!['out_for_delivery','completed'].includes(order.status)))throw Error('This delivery changed after the save.');
            return {alreadySaved:true};
        }
        if(order.riderId!==actor.riderId || order.status!=='out_for_delivery')throw Error('Only the assigned rider can update an ongoing delivery.');
        if(!complete && order.riderPickup)throw Error('Pickup was already recorded. Refresh this delivery.');
        assertRider(api,actor,rider,order.branch);
        const stamp=api.serverTimestamp(),patch={[key]:{version:1,operationId,actorUid:actor.authUid,riderId:actor.riderId,signature,recordedAt:stamp}};
        if(complete)Object.assign(patch,{status:'completed',deliveredAt:stamp,proofOfDeliveryUrl:proofUrl});else patch.riderPickedUpAt=stamp;
        tx.update(orderRef,patch);return {saved:true};
    });
}
export const pickupDeliveryAtomic=(api,input)=>ownedChange(api,input,false);
export const completeDeliveryAtomic=(api,input)=>ownedChange(api,input,true);
export async function rejectPingAtomic(api,input){
    const orderId=id(input.orderId,'delivery'),operationId=id(input.operationId,'save attempt'),actor=actorFor(api,input.actor),signature=fingerprint({action:'reject-ping',orderId,riderId:actor.riderId});
    return api.runTransaction(api.db,async tx=>{
        const orderRef=api.doc(api.db,'incoming_orders',orderId),orderSnap=await tx.get(orderRef);api.assertRiderActor(actor);
        const riderSnap=await tx.get(api.doc(api.db,'riders',actor.riderId));api.assertRiderActor(actor);
        if(!orderSnap.exists() || !riderSnap.exists())throw Error('The offer or rider is missing.');
        const order=orderSnap.data(),rider=riderSnap.data();assertRider(api,actor,rider,order.branch);
        if(order.declinedBy!==undefined && !Array.isArray(order.declinedBy))throw Error('The saved decline history is inconsistent. Ask Manager to review it.');
        const declines=order.riderDeclines || {},marker=declines[actor.riderId],declined=Array.isArray(order.declinedBy)?[...order.declinedBy]:[];
        if(markerMatches(marker,operationId,actor,signature)){
            if(order.pingedRider===actor.riderId || !declined.includes(actor.riderId))throw Error('This offer changed after the decline. Refresh it.');
            return {alreadySaved:true};
        }
        if(order.status!=='looking_for_rider' || order.riderId || order.pingedRider!==actor.riderId)throw Error('This offer changed or was assigned to another rider.');
        assertRider(api,actor,rider,order.branch);
        tx.update(orderRef,{pingedRider:null,declinedBy:[...new Set([...declined,actor.riderId])],riderDeclines:{...declines,[actor.riderId]:{version:1,operationId,actorUid:actor.authUid,riderId:actor.riderId,signature,recordedAt:api.serverTimestamp()}}});return {saved:true};
    });
}
async function managerContext(api,actor){
    if(typeof api.loadRiderManagerAuthority!=='function' || typeof api.assertRiderManagerAuthority!=='function')throw Error('Unlock Rider Fleet with an approved Manager account.');
    const authority=await api.loadRiderManagerAuthority(actor);api.assertRiderManagerAuthority(actor,authority.rows,[]);return authority;
}
async function managerRows(tx,api,actor,authority){
    const rows=[];for(const ref of authority.refs){const snap=await tx.get(ref);api.assertRiderManagerAuthority(actor,authority.rows,[]);if(snap.exists())rows.push({id:ref.id,data:snap.data()});}
    return rows;
}
const riderScope=rider=>Array.isArray(rider.allowedBranches) && rider.allowedBranches.length?rider.allowedBranches:['All'];
export async function reviewRiderStatusAtomic(api,input){
    const riderId=id(input.riderId,'rider'),operationId=id(input.operationId,'save attempt'),actor=input.actor;
    if(!['active','rejected','banned'].includes(input.status) || typeof input.expectedStatus!=='string')throw Error('Choose an explicit rider approval action.');
    const authority=await managerContext(api,actor),signature=fingerprint({riderId,status:input.status,expectedStatus:input.expectedStatus});
    return api.runTransaction(api.db,async tx=>{
        const rows=await managerRows(tx,api,actor,authority),ref=api.doc(api.db,'riders',riderId),snap=await tx.get(ref);api.assertRiderManagerAuthority(actor,rows,[]);
        if(!snap.exists())throw Error('This rider no longer exists.');const rider=snap.data();api.assertRiderManagerAuthority(actor,rows,riderScope(rider));
        const marker=rider.approvalOperation;
        if(marker?.operationId===operationId){if(marker.actorUid!==actor.authUid || marker.signature!==signature || rider.status!==input.status)throw Error('This approval attempt changed. Reload the rider.');return {alreadySaved:true};}
        if(rider.status!==input.expectedStatus || rider.status===input.status)throw Error('Another Manager already changed this rider. Refresh before reviewing.');
        if(input.status==='rejected' && rider.status!=='pending_approval')throw Error('Only a pending application can be rejected.');
        if(input.status==='banned' && !isApprovedRider(rider))throw Error('Only an active rider can be suspended.');
        if(input.status==='active' && !['pending_approval','rejected','banned','approved'].includes(rider.status))throw Error('This legacy status needs explicit review before activation.');
        api.assertRiderManagerAuthority(actor,rows,riderScope(rider));const stamp=api.serverTimestamp();
        tx.update(ref,{status:input.status,isAcceptingOrders:false,approvalOperation:{version:1,operationId,actorUid:actor.authUid,actorEmail:actor.email,signature,fromStatus:rider.status,status:input.status,recordedAt:stamp},statusReviewedAt:stamp,statusReviewedBy:actor.email});return {saved:true};
    });
}
export async function reviewRiderTopUpAtomic(api,input){
    const requestId=id(input.requestId,'top-up request'),riderId=id(input.riderId,'rider'),operationId=id(input.operationId,'save attempt'),actor=input.actor;
    if(!['approved','rejected'].includes(input.decision))throw Error('Choose a top-up review action.');
    const amount=input.decision==='approved'?riderMoneyCents(input.amount,'top-up amount'):0;
    if(input.decision==='approved' && amount<=0)throw Error('Enter the exact positive amount received.');
    const authority=await managerContext(api,actor),signature=fingerprint({requestId,riderId,decision:input.decision,amount});
    return api.runTransaction(api.db,async tx=>{
        const rows=await managerRows(tx,api,actor,authority),requestRef=api.doc(api.db,'rider_topups',requestId),riderRef=api.doc(api.db,'riders',riderId);
        const requestSnap=await tx.get(requestRef);api.assertRiderManagerAuthority(actor,rows,[]);const riderSnap=await tx.get(riderRef);api.assertRiderManagerAuthority(actor,rows,[]);
        if(!requestSnap.exists() || !riderSnap.exists())throw Error('The top-up request or rider is missing.');
        const request=requestSnap.data(),rider=riderSnap.data();api.assertRiderManagerAuthority(actor,rows,riderScope(rider));
        if(request.riderId!==riderId)throw Error('The top-up request belongs to another rider.');
        const marker=request.reviewOperation;
        if(marker?.operationId===operationId){if(marker.actorUid!==actor.authUid || marker.signature!==signature || request.status!==input.decision)throw Error('This top-up attempt was changed. Refresh before retrying.');return {alreadySaved:true,walletBalance:riderMoneyCents(rider.walletBalance ?? 0,'wallet balance')/100};}
        if(request.status!=='pending')throw Error('This top-up has already been reviewed. No additional money was added.');
        if(input.decision==='approved' && !isApprovedRider(rider))throw Error('Approve or restore this rider before crediting the wallet.');
        const balance=riderMoneyCents(rider.walletBalance ?? 0,'wallet balance'),next=balance+amount;
        if(!Number.isSafeInteger(next))throw Error('The wallet amount cannot be represented safely.');
        api.assertRiderManagerAuthority(actor,rows,riderScope(rider));const stamp=api.serverTimestamp();
        tx.update(requestRef,{status:input.decision,...(input.decision==='approved'?{amountAdded:amount/100}:{}),processedAt:stamp,processedBy:actor.email,
            reviewOperation:{version:1,operationId,actorUid:actor.authUid,actorEmail:actor.email,signature,amountCents:amount,decision:input.decision,recordedAt:stamp}});
        if(input.decision==='approved')tx.update(riderRef,{walletBalance:next/100});return {saved:true,walletBalance:next/100};
    });
}
export async function requestRiderTopUpAtomic(api,input){
    const topupId=id(input.topupId,'top-up request'),operationId=id(input.operationId,'save attempt'),actor=actorFor(api,input.actor),reference=text(input.reference);
    if(!reference || reference.length>100)throw Error('Enter a payment reference of at most 100 characters.');
    let proofUrl;try{const url=new URL(input.proofUrl);if(url.protocol!=='https:' || url.username || url.password)throw Error();proofUrl=url.href;}catch{throw Error('Upload a valid payment proof before sending the request.');}
    const signature=fingerprint({topupId,riderId:actor.riderId,reference,proofUrl});
    return api.runTransaction(api.db,async tx=>{
        const riderSnap=await tx.get(api.doc(api.db,'riders',actor.riderId));api.assertRiderActor(actor);
        const ref=api.doc(api.db,'rider_topups',topupId),existing=await tx.get(ref);api.assertRiderActor(actor);
        if(!riderSnap.exists())throw Error('Your rider record is missing.');const rider=riderSnap.data();assertRider(api,actor,rider);
        if(existing.exists()){
            const data=existing.data();
            if(data.riderId!==actor.riderId || data.reference!==reference || data.proofUrl!==proofUrl || data.requestOperation?.signature!==signature || data.requestOperation?.actorUid!==actor.authUid)
                throw Error('This reference already has a different request. Ask HQ to review it before submitting again.');
            return {alreadySaved:true,status:data.status,topupId};
        }
        assertRider(api,actor,rider);const stamp=api.serverTimestamp();
        tx.set(ref,{riderId:actor.riderId,riderName:text(rider.name),reference,proofUrl,status:'pending',timestamp:stamp,
            requestOperation:{version:1,operationId,actorUid:actor.authUid,riderId:actor.riderId,signature,recordedAt:stamp}});
        return {saved:true,status:'pending',topupId};
    });
}
export async function setRiderAvailabilityAtomic(api,input){
    const actor=actorFor(api,input.actor);if(typeof input.isAcceptingOrders!=='boolean')throw Error('Choose Online or Offline.');
    return api.runTransaction(api.db,async tx=>{
        const ref=api.doc(api.db,'riders',actor.riderId),snap=await tx.get(ref);api.assertRiderActor(actor);
        if(!snap.exists())throw Error('Your rider record is missing.');const rider=snap.data();assertRider(api,actor,rider);
        if(rider.isAcceptingOrders===input.isAcceptingOrders)return {alreadySaved:true};
        tx.update(ref,{isAcceptingOrders:input.isAcceptingOrders,availabilityUpdatedAt:api.serverTimestamp()});return {saved:true};
    });
}
