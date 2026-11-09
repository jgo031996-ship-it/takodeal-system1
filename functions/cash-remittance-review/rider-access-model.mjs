import {randomBytes,pbkdf2 as pbkdf2Callback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const pbkdf2=promisify(pbkdf2Callback);
export const RIDER_SESSION_MS=8*60*60*1000;
export const riderAccessId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export const riderAccessHash=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)).digest('hex');
export function riderAccessPhone(value){if(typeof value!=='string'||value.length>30||!/^[+\d\s()-]+$/.test(value))throw Error('Enter a valid Philippine mobile number.');let phone=value.replace(/\D/g,'');if(/^639\d{9}$/.test(phone))phone='0'+phone.slice(2);if(!/^09\d{9}$/.test(phone))throw Error('Enter a valid Philippine mobile number.');return phone;}
export const riderAccessPhoneVariants=phone=>[phone,'63'+phone.slice(1),'+63'+phone.slice(1)];
export const riderAccessPin=value=>typeof value==='string'&&value.length>0&&value.length<=64&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
export async function hashRiderAccessPin(pin){if(!riderAccessPin(pin))throw Error('Enter your Rider PIN.');const salt=randomBytes(16).toString('hex'),hash=await pbkdf2(pin,Buffer.from(salt,'hex'),300000,32,'sha256');return {version:1,iterations:300000,salt,hash:hash.toString('hex')};}
export function validRiderVerifier(value){return value&&Object.keys(value).sort().join(',')==='hash,iterations,salt,version'&&value.version===1&&value.iterations===300000&&/^[a-f0-9]{32}$/.test(value.salt)&&/^[a-f0-9]{64}$/.test(value.hash);}
export async function verifyRiderAccessPin(pin,verifier){if(!riderAccessPin(pin)||!validRiderVerifier(verifier))return false;const hash=await pbkdf2(pin,Buffer.from(verifier.salt,'hex'),verifier.iterations,32,'sha256');return timingSafeEqual(hash,Buffer.from(verifier.hash,'hex'));}
export const legacyRiderPinMatches=(pin,saved)=>riderAccessPin(pin)&&riderAccessPin(String(saved??'').trim())&&timingSafeEqual(createHash('sha256').update(pin).digest(),createHash('sha256').update(String(saved).trim()).digest());
export const riderLoginEligible=row=>Boolean(row&&row.active!==false&&row.archived!==true&&row.deleted!==true&&row.blocked!==true&&['active','approved','pending_approval','pending','awaiting_approval'].includes(String(row.status||'').trim().toLowerCase()));
export function riderAccessBranchAllowed(row,branch){
 if(!riderLoginEligible(row)||!['active','approved'].includes(String(row.status).trim().toLowerCase()))return false;
 if(Object.hasOwn(row,'allowedBranches'))return Array.isArray(row.allowedBranches)&&row.allowedBranches.length>0&&row.allowedBranches.length<=30&&row.allowedBranches.every(b=>typeof b==='string'&&b&&b.trim()===b&&b.length<=128)&&row.allowedBranches.some(b=>b==='All'||b===branch);
 return (row.fleetType==null||row.fleetType==='Main Office')&&(row.franchiseAccess==null||row.franchiseAccess===true);
}
export function riderReceiptVerified(order,receipt,orderId){
 const norm=value=>String(value??'').trim().toLowerCase(),cash=value=>['cash','cod','cash on delivery','cash-on-delivery'].includes(norm(value)),mode=order.paymentMode,method=order.paymentMethod,selected=mode||method,receiptId=String(order.receiptId||order.orderCode||'').trim();
 return Boolean(receipt&&selected&&!cash(selected)&&(!mode||!method||cash(mode)===cash(method))&&receiptId&&receipt.branch===order.branch&&receipt.receiptId===receiptId&&receipt.paymentVerified===true&&!['voided','void','cancelled','canceled','unpaid','pending'].includes(norm(receipt.status))&&norm(receipt.paymentMethod)&&!cash(receipt.paymentMethod)&&(!receipt.mobileOrderId||receipt.mobileOrderId===orderId)&&(order.paymentStatus===undefined||norm(order.paymentStatus)==='paid'));
}
export const RIDER_PUBLIC_FIELDS=['name','phone','vehicle','plateNumber','licenseUrl','orcrUrl','selfieUrl','status','walletBalance','rating','totalDeliveries','joinedAt','fleetType','franchiseAccess','isAcceptingOrders','allowedBranches','branch','lastLat','lastLng','lastActive','approvalReason','statusReason','riderAuthRevision','riderPinManaged'];
export const publicAccessRider=(id,row)=>Object.fromEntries([['id',id],...RIDER_PUBLIC_FIELDS.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])]);
export function validateRiderAccessRegistration(body){
 const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
 if(!text(body.name,100)||!text(body.vehicle,100)||!text(body.plateNumber,30)||!/^\d{4}$/.test(body.pin||'')||!riderAccessId(body.registrationId)||body.registrationId.length<12||!/^[a-f0-9]{64}$/.test(body.fingerprint||''))throw Error('Review your name, motorcycle, plate, four-digit PIN and application photos.');
 return {name:body.name.trim(),phone:riderAccessPhone(body.phone),vehicle:body.vehicle.trim(),plateNumber:body.plateNumber.trim().toUpperCase()};
}
export function validateRiderAccessUploads(uploads,registrationId,uid){
 const folders={license:'licenses',orcr:'orcr',selfie:'selfies'};
 if(!uploads||typeof uploads!=='object'||Array.isArray(uploads)||Object.keys(uploads).sort().join(',')!=='license,orcr,selfie')throw Error('Submit all three application photos.');
 return Object.entries(folders).map(([key,folder])=>{const row=uploads[key];if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='mime,path,sha256,size,url'||!['image/jpeg','image/png','image/webp'].includes(row.mime)||!Number.isSafeInteger(row.size)||row.size<=0||row.size>8*1024*1024||!/^[a-f0-9]{64}$/.test(row.sha256||''))throw Error('An application photo needs review.');const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[row.mime],path='riders/'+folder+'/'+registrationId+'.'+extension;let url;try{url=new URL(row.url);}catch{throw Error('Use the saved application photo uploads.');}if(row.path!==path||url.origin!=='https://firebasestorage.googleapis.com'||url.username||url.password||url.hash||url.pathname!=='/v0/b/takodeal-pos.firebasestorage.app/o/'+encodeURIComponent(path)||url.searchParams.get('alt')!=='media'||!url.searchParams.get('token')||[...url.searchParams.keys()].sort().join(',')!=='alt,token')throw Error('Use this application’s own saved photo uploads.');return {key,...row,uid,registrationId};});
}
