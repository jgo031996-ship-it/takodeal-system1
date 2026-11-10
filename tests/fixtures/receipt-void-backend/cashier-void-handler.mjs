import {accessId,accessDevice,accessDocumentId,isAccessOwner} from './access-model.mjs';
import {CashierVoidError,CASHIER_VOID_REASONS,voidFields,voidText,voidFail} from './cashier-void-model.mjs';
export const CASHIER_VOID_ORIGIN='https://takodeal-cashier.vercel.app';
const routes=new Set(['/cashier-void/preview','/cashier-void/commit','/cashier-void/status','/cashier-void/cancel','/cashier-void/replacement-claim']);
const common=['operationId','deviceId','staffId','sessionId','branch','shiftId','saleId','receiptId','reason'],op=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{8,96}$/.test(value),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function createCashierVoidHandler({verifyToken,store,now=Date.now}={}){
 if(typeof verifyToken!=='function'||typeof store?.execute!=='function'||typeof store?.rate!=='function')throw Error('A trusted Cashier void service is required.');
 // Counts denied/repeated requests before source reads. Instance-local bounds
 // supplement (and do not replace) the shared UID transaction rate counter.
 const buckets=new Map();function localRate(key,max){const slot=Math.floor(now()/600000),old=buckets.get(key),count=old?.slot===slot?old.count:0;if(count>=max)voidFail(429,'rate-limit','Too many void checks. Wait a few minutes and retry the same reference.');if(buckets.size>=4000&&!buckets.has(key)){for(const [id,row]of buckets)if(row.slot!==slot)buckets.delete(id);if(buckets.size>=4000)voidFail(429,'rate-limit','Void checks are temporarily busy. Retry the same reference later.');}buckets.set(key,{slot,count:count+1});}
 return async request=>{
  const headers={'Cache-Control':'no-store',Pragma:'no-cache','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',Vary:'Origin',...(request.origin===CASHIER_VOID_ORIGIN?{'Access-Control-Allow-Origin':CASHIER_VOID_ORIGIN}:{})},response=(status,body)=>({status,headers,body});
  try{
   if(request.origin!==CASHIER_VOID_ORIGIN)voidFail(403,'origin','Open this action in the approved Cashier app.');
   if(!routes.has(request.path))voidFail(404,'route','This void action is unavailable.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).some(value=>!['authorization','content-type'].includes(value)))voidFail(403,'preflight','Use the approved Cashier app.');return {...response(204,null),headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};}
   const limit=request.path==='/cashier-void/replacement-claim'?140*1024:8192;
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>limit||!request.body||Buffer.byteLength(JSON.stringify(request.body))>limit)voidFail(400,'request','Reopen the original receipt and review the exact void choice.');
   localRate('global',1200);localRate('ip:'+String(request.trustedIP||'unavailable').slice(0,200),300);
   const bearer=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!bearer)voidFail(401,'sign-in','Reconnect and sign in again before reviewing this receipt.');
   let actor;try{actor=await verifyToken(bearer,true);}catch{voidFail(401,'sign-in','Sign in again to verify this approved tablet.');}
   if(!accessId(actor?.uid)||actor.firebase?.sign_in_provider!=='anonymous'&&!isAccessOwner(actor))voidFail(403,'identity','Use the approved Cashier tablet identity or the already signed-in verified Owner desktop account.');localRate('uid:'+actor.uid,180);
   const body=request.body,path=request.path;let keys=common;
   if(Object.hasOwn(body,'pinVerificationId'))keys=[...common,'pinVerificationId'];
   if(path==='/cashier-void/preview'&&Object.hasOwn(body,'ownerUnitReview'))keys=[...keys,'ownerUnitReview'];
   if(path==='/cashier-void/commit')keys=[...keys,'expectedFingerprint'];
   if(path==='/cashier-void/replacement-claim')keys=[...keys,'expectedFingerprint','phase','restoreAttemptId','claimToken',...(body.phase==='checkout'?['checkoutAttemptId','payload']:[])];
   if(!voidFields(body,keys)||!op(body.operationId)||!accessDevice(body.deviceId)||!accessId(body.staffId)||!accessId(body.sessionId)||body.sessionId.length<16||!voidText(body.branch,120)||!accessDocumentId(body.shiftId)||!accessDocumentId(body.saleId)||!voidText(body.receiptId,200)||!CASHIER_VOID_REASONS.includes(body.reason)||keys.includes('expectedFingerprint')&&!hash(body.expectedFingerprint)||path==='/cashier-void/replacement-claim'&&(!['draft','checkout','abandon'].includes(body.phase)||!op(body.restoreAttemptId)||!hash(body.claimToken)||body.phase==='checkout'&&!op(body.checkoutAttemptId)))voidFail(400,'request','The void details changed or are incomplete. Keep the original reference and reopen its review.');
   if(Object.hasOwn(body,'ownerUnitReview')&&(!isAccessOwner(actor)||!voidFields(body.ownerUnitReview,['confirmed','fingerprint','reason'])||body.ownerUnitReview.confirmed!==true||!hash(body.ownerUnitReview.fingerprint)||!voidText(body.ownerUnitReview.reason,1000)||body.ownerUnitReview.reason.trim().length<8))voidFail(400,'request','Only the verified Owner can explicitly confirm each unknown original unit with a documented reason.');
   if(Object.hasOwn(body,'pinVerificationId')&&(!accessId(body.pinVerificationId)||!body.pinVerificationId.startsWith('pin-')))voidFail(400,'request','Confirm the original cashier PIN for this exact saved receipt.');
   await store.rate(actor.uid);return response(200,await store.execute(path,body,actor));
  }catch(error){if(error instanceof CashierVoidError)return response(error.status,{code:error.code,message:error.message,...(error.code==='cashier-void/legacy-unit-review-required'&&error.details?.unitReview?{unitReview:error.details.unitReview}:{})});return response(503,{code:'cashier-void/unavailable',message:'The saved void result could not be confirmed. Keep the same reference and check its status before starting another attempt.'});}
 };
}
