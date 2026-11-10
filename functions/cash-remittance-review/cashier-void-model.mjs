import {createHash} from 'node:crypto';
import {accessDocumentId} from './access-model.mjs';

export const CASHIER_VOID_VERSION=1;
export const CASHIER_VOID_REASONS=Object.freeze(['OrderCancelled','WrongPunched']);
export class CashierVoidError extends Error{constructor(status,code,message){super(message);this.name='CashierVoidError';this.status=status;this.code='cashier-void/'+code;}}
export const voidFail=(status,code,message)=>{throw new CashierVoidError(status,code,message);};
export const voidHold=message=>voidFail(409,'owner-review',message);
export const voidPlain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
export const voidFields=(value,keys,required=keys)=>voidPlain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key));
export const voidText=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export const voidHash=value=>createHash('sha256').update(canonicalCashierVoidJSON(value)).digest('hex');
export const voidDigest=value=>createHash('sha256').update(value).digest('hex');
export function voidTimestamp(value){
 const seconds=value?.seconds??value?._seconds,nanos=value?.nanoseconds??value?._nanoseconds;
 if(Number.isSafeInteger(seconds)&&Number.isInteger(nanos)&&nanos>=0&&nanos<1e9)return {seconds,nanoseconds:nanos};
 if(value instanceof Date&&Number.isFinite(+value)){const seconds=Math.floor(+value/1000);return {seconds,nanoseconds:(+value-seconds*1000)*1e6};}
 return null;
}
export const voidRevision=value=>{const stamp=voidTimestamp(value);return stamp?stamp.seconds+'|'+stamp.nanoseconds:'';};
export const voidMillis=value=>{const stamp=voidTimestamp(value);return stamp?stamp.seconds*1000+stamp.nanoseconds/1e6:NaN;};
// Also accepts Firestore Timestamp/Date only for private source proofs. Replacement
// payloads are separately required to be JSON data, so browser hashing is simply
// SHA256(UTF8(JSON.stringify(recursively sorted object keys; array order retained))).
export function canonicalCashierVoidJSON(value){
 let nodes=0;const visit=(row,depth)=>{
  if(++nodes>20000||depth>15)voidHold('The saved order is too complex for an automatic void. Ask the Owner to review it.');
  if(row===null||typeof row==='boolean')return row;
  if(typeof row==='number'){if(!Number.isFinite(row))voidHold('A saved order number needs Owner review.');return row;}
  if(typeof row==='string'){if(row.length>12000)voidHold('A saved order field is too large. Ask the Owner to review it.');return row;}
  const stamp=voidTimestamp(row);if(stamp&&!voidPlain(row))return {$timestamp:[stamp.seconds,stamp.nanoseconds]};
  if(Array.isArray(row)){if(row.length>2000)voidHold('The saved order has too many entries.');return row.map(item=>visit(item,depth+1));}
  if(!voidPlain(row))voidHold('The saved order has an unsupported value. Ask the Owner to review it.');
  const result={};for(const key of Object.keys(row).sort()){if(['__proto__','constructor','prototype'].includes(key)||row[key]===undefined)voidHold('The saved order has an unsupported field. Ask the Owner to review it.');result[key]=visit(row[key],depth+1);}return result;
 };
 const output=JSON.stringify(visit(value,0));if(Buffer.byteLength(output)>196608)voidHold('The saved order exceeds the safe review size. Ask the Owner to review it.');return output;
}
const finite=(value,{positive=false,max=1e12}={})=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=max&&(!positive||value>0);
const money=value=>finite(value,{max:1e9})&&value>=0&&Math.abs(value*100-Math.round(value*100))<1e-5;
const savedFingerprint=row=>canonicalCashierVoidJSON({branch:row.branch,receiptId:row.receiptId,netTotal:Number(row.netTotal??0),cart:row.cart||[]});
function countBalls(cart){return cart.reduce((sum,item)=>{const name=[item.realName,item.name,item.itemName].filter(Boolean).join(' '),category=String(item.category||'');if(!/takoyaki/i.test(name+' '+category)||/extra|sauce|take\s*out|packaging|box/i.test(name))return sum;const pack=(name+' '+(item.variantName||'')).match(/(\d+)\s*(?:pcs|pieces)\b/i),qty=Number(item.qty??1);return !pack||!Number.isFinite(qty)||qty<=0?sum:sum+Number(pack[1])*qty;},0);}
export function editableVoidCart(cart){
 if(!Array.isArray(cart)||cart.length<1||cart.length>100)voidHold('This saved cart needs Owner review before it can be corrected.');
 return cart.map(item=>{
  if(!voidPlain(item)||!voidText(item.name,200)||!finite(item.qty,{positive:true,max:10000})||!money(item.basePrice)||!money(item.variantPrice))voidHold('A saved item is missing its editable unit prices or quantity. Ask the Owner to review this receipt.');
  const result={name:item.name,basePrice:item.basePrice,variantPrice:item.variantPrice,qty:item.qty,discountType:'none',discountVal:0,addons:{}};
  for(const key of ['realName','variantName','orderType'])if(item[key]!==undefined){if(!voidText(item[key],200))voidHold('A saved item option needs Owner review.');result[key]=item[key];}
  if(item.notes!==undefined){if(typeof item.notes!=='string'||item.notes.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.notes))voidHold('A saved item note needs Owner review.');result.notes=item.notes;}
  if(item.isGrouped!==undefined){if(typeof item.isGrouped!=='boolean')voidHold('A saved item variant needs Owner review.');result.isGrouped=item.isGrouped;}
  if(item.addons!==undefined&&(!voidPlain(item.addons)||Object.keys(item.addons).length>40))voidHold('Saved add-ons need Owner review.');
  let addonsTotal=0;for(const [key,addon]of Object.entries(item.addons||{})){
   if(!voidText(key,200)||['__proto__','constructor','prototype'].includes(key)||!voidPlain(addon)||!money(addon.price)||!finite(addon.qty,{max:10000})||addon.qty<0)voidHold('A saved add-on has no valid price or quantity.');
   const copy={price:addon.price,qty:addon.qty};if(addon.name!==undefined){if(!voidText(addon.name,200))voidHold('A saved add-on name needs review.');copy.name=addon.name;}
   if(addon.linkedIngredient!==undefined){if(typeof addon.linkedIngredient!=='string'||addon.linkedIngredient.length>200||/[\u0000-\u001f\u007f]/.test(addon.linkedIngredient))voidHold('A saved add-on stock link needs review.');copy.linkedIngredient=addon.linkedIngredient;}
   if(addon.deductQty!==undefined){if(!finite(addon.deductQty)||addon.deductQty<0)voidHold('A saved add-on stock quantity needs review.');copy.deductQty=addon.deductQty;}
   result.addons[key]=copy;addonsTotal+=addon.price*addon.qty;
  }
  const total=(item.variantPrice+addonsTotal)*item.qty;if(!finite(total)||total<0)voidHold('A saved item total needs review.');result.lineTotalFinal=total;return result;
 });
}
export function voidUnitIdentity(row){
 const identity={schemaVersion:1,baseUom:row?.baseUom===undefined?null:row.baseUom,uom:row?.uom===undefined?null:row.uom};
 if([identity.baseUom,identity.uom].some(value=>value!==null&&(typeof value!=='string'||value.length<1||value.length>64||/[\u0000-\u001f\u007f]/.test(value)))||![identity.baseUom,identity.uom].some(value=>typeof value==='string'&&value.trim()))voidHold('The original inventory unit is missing or inconsistent. Ask the Owner to review this stock reversal.');
 if(identity.baseUom?.trim()&&identity.uom?.trim()&&identity.baseUom.trim().toLowerCase()!==identity.uom.trim().toLowerCase())voidHold('The saved inventory unit aliases conflict. Ask the Owner to review the original stock units.');
 return identity;
}
export function validVoidUnitSnapshot(value){return voidFields(value,['schemaVersion','baseUom','uom'])&&value.schemaVersion===1&&sameUnit(value,voidUnitIdentity(value));}
const sameUnit=(a,b)=>canonicalCashierVoidJSON(a)===canonicalCashierVoidJSON(b);
export function verifyVoidSource({source,marker,saleId,receiptId,branch,shiftId}){
 const row=source?.data,commit=marker?.data;
 if(!row||!commit)voidHold('The original receipt or its permanent saved-sale proof is missing. Ask the Owner to review it.');
 const joint=voidRevision(source.createTime);
 const requestLag=voidMillis(source.createTime)-voidMillis(commit.committedAt);
 // REQUEST_TIME is millisecond request processing time, not the precise write
 // commit timestamp. The immutable FOUR document metadata times remain exact.
 if(!joint||voidRevision(source.updateTime)!==joint||voidRevision(marker.createTime)!==joint||voidRevision(marker.updateTime)!==joint||!Number.isFinite(requestLag)||requestLag<0||requestLag>300000)voidHold('This receipt was edited or adjusted after its original sale. Ask the Owner to review the stock and payment evidence.');
 if(!voidFields(commit,['saleId','branch','receiptId','fingerprint','committedAt'])||commit.saleId!==saleId||commit.branch!==branch||commit.receiptId!==receiptId||commit.fingerprint!==savedFingerprint(row))voidHold('The original sale proof does not match this receipt. Ask the Owner to reconcile it.');
 if(row.saleVersion!==2||row.saleId!==saleId||row.receiptId!==receiptId||row.branch!==branch||row.shiftId!==shiftId||!['applied','deferred'].includes(row.inventoryState)||![undefined,'Paid','Completed','Complete','Settled','Received'].includes(row.status)||!money(row.netTotal))voidHold('Only an unchanged completed POS receipt from this open shift can be voided here. Ask the Owner to review this record.');
 const method=typeof row.paymentMethod==='string'?row.paymentMethod.trim().toLowerCase():'';
 if(!method||method==='salary deduction'||/grab|foodpanda|panda|split|refund|return/.test(method)||row.paymentVerified!==undefined&&typeof row.paymentVerified!=='boolean'||row.paymentVerified===true&&method!=='cash')voidHold('This verified or externally linked payment needs Owner review. Use its payment or prepared-cancellation process.');
 const linked=['paymentReconciliationVersion','paymentReconciliationId','paymentReconciliationFile','manualVerification','preparedCancellation','cancelledFoodSourceId','cancelledFoodPurchaseId','cancelledFoodAllocationVersion','cancelledFoodLastPurchaseId','cancelledFoodPurchasedUnits','refundId','refund','refundedAt','refundAmount','refundedBy','returnedAt','returnId','splitDetails'];
 if(linked.some(key=>Object.hasOwn(row,key)))voidHold('This receipt has a payment, refund, or prepared-food link. Ask the Owner to use the linked cancellation or reconciliation process.');
 if(row.isMobileOrder===true||row.mobileOrderId||row.mobileOrderCode||row.orderType==='Delivery'||row.mealStaffName||row.mealIdentityId||row.mealLevelId||row.mealRole||row.globalDiscountType&&!['none','percentage','fixed'].includes(row.globalDiscountType))voidHold('Mobile, delivery, and meal receipts need their linked Owner cancellation process.');
 if(row.isPendingSync===true||row.inventoryReviewRequired===true||row.inventoryIssues?.length||row.recipeIssues?.length)voidHold('This receipt has unresolved stock evidence. Ask the Owner to review its captured deductions.');
 if(!Array.isArray(row.inventoryMovements)||row.inventoryMovements.length>150||new Set(row.inventoryMovements.map(item=>item?.inventoryId)).size!==row.inventoryMovements.length)voidHold('The saved stock movements are missing, duplicated, or too large.');
 for(const effect of row.inventoryMovements)if(!voidFields(effect,['inventoryId','ingredientName','quantity','unitSnapshot'],['inventoryId','ingredientName','quantity'])||!accessDocumentId(effect.inventoryId)||!voidText(effect.ingredientName,200)||!finite(effect.quantity,{positive:true})||effect.unitSnapshot!==undefined&&!validVoidUnitSnapshot(effect.unitSnapshot))voidHold('A saved stock deduction needs Owner review.');
 const balls=countBalls(row.cart||[]);if(!finite(balls)||balls<0||row.statsApplied!==true||row.ballsCounted!==balls)voidHold('The original sales counters need Owner review.');
 const cart=editableVoidCart(row.cart),fingerprint=voidHash({source:row,sourceRevision:joint,marker:commit,markerRevision:voidRevision(marker.updateTime)});
 return {fingerprint,revision:joint,cart,netTotal:row.netTotal,inventoryState:row.inventoryState,movements:row.inventoryMovements,balls,legacyFingerprint:commit.fingerprint};
}
export function voidEffects(proof,inventory,unitProof=[]){
 if(proof.inventoryState==='deferred')return [];
 return proof.movements.map((movement,index)=>{const saved=inventory[index],row=saved?.data;
  if(!row||row.name!==movement.ingredientName||typeof row.branch!=='string'||!finite(row.currentStock)||!voidRevision(saved.updateTime))voidHold('A captured inventory record changed or has an invalid stock balance. Ask the Owner to review it.');
  const original=movement.unitSnapshot||unitProof.find(row=>row.id===movement.inventoryId)?.unitSnapshot;
  if(!original||!validVoidUnitSnapshot(original)||!sameUnit(original,voidUnitIdentity(row)))voidHold('This older receipt has no matching original stock-unit proof. Ask the Owner to review a documented reversal; no stock was returned.');
  const unit=[row.baseUom,row.uom].find(value=>typeof value==='string'&&value.trim());if(!voidText(unit,64))voidHold('A captured inventory unit is missing. Ask the Owner to review it.');
  const after=row.currentStock+movement.quantity;if(!finite(after))voidHold('The restored stock balance exceeds the safe range.');
  return {id:movement.inventoryId,name:movement.ingredientName,unit,quantity:movement.quantity,beforeStock:row.currentStock,afterStock:after,revision:voidRevision(saved.updateTime)};
 });
}
const payloadKeys=['branch','cashier','shiftId','orderType','paymentMethod','subTotalBeforeDiscount','globalDiscountType','globalDiscountValue','globalDiscountAmount','globalDiscountReason','netTotal','customerName','paymentReference','platformOrderId','amountReceived','cart','resumeRecoveryId','wasParked','isMobileOrder','mobileOrderCode','mobileOrderId','deliveryFee','mealStaffName','mealLevelId','mealLevelName','mealRole','mealIdentityId','mealIdentitySource','customCheckoutSelections','deliveryAddress','contactNumber','saleId','receiptId','localTimestamp','saleVersion','auditDeferred','recipeSnapshot','recipeSnapshotStatus','recipeSnapshotReason','recipeSnapshotCapturedAt','recipeSnapshotRevision','recipeVersion','recipeRevisionId','recipeCapturedAt','inventoryMovements','inventoryIssues','recipeIssues','inventoryReviewRequired','paymentVerified','voidCorrection'];
export function verifyReplacementPayload(payload,operation,actorName){
 if(!voidFields(payload,payloadKeys,['branch','cashier','shiftId','orderType','paymentMethod','netTotal','cart','saleId','receiptId','localTimestamp','saleVersion','inventoryMovements','voidCorrection'])||Buffer.byteLength(canonicalCashierVoidJSON(payload))>131072)voidHold('The replacement checkout contains unsupported fields. Keep this exact draft and ask the Owner to review it.');
 const expected={schemaVersion:1,operationId:operation.operationId,sourceSaleId:operation.intent.saleId,sourceReceiptId:operation.intent.receiptId,sourceFingerprint:operation.sourceFingerprint,checkoutAttemptId:payload.voidCorrection?.checkoutAttemptId,claimTokenHash:voidDigest(operation.replacement.claimToken)};
 if(canonicalCashierVoidJSON(payload.voidCorrection)!==canonicalCashierVoidJSON(expected)||!voidText(expected.checkoutAttemptId,96)||!/^[-A-Za-z0-9_]{8,96}$/.test(expected.checkoutAttemptId)||payload.branch!==operation.actor.branch||payload.shiftId!==operation.intent.shiftId||payload.cashier!==actorName||payload.saleId!==operation.replacement.saleId||payload.receiptId!==operation.replacement.receiptId||payload.saleVersion!==2||!money(payload.netTotal)||!Number.isFinite(Date.parse(payload.localTimestamp)))voidHold('The replacement checkout does not match its reserved correction. Keep the same draft and ask the Owner to review it.');
 if(!voidText(payload.paymentMethod,80)||payload.orderType==='Delivery'||payload.isMobileOrder===true||payload.mobileOrderId||payload.mobileOrderCode||payload.mealStaffName||payload.mealIdentityId||payload.mealLevelId||payload.mealRole||payload.globalDiscountType&&!['none','percentage','fixed'].includes(payload.globalDiscountType)||/grab|foodpanda|panda|split|salary|refund/i.test(payload.paymentMethod)||payload.paymentVerified!==undefined&&typeof payload.paymentVerified!=='boolean'||payload.paymentVerified===true&&payload.paymentMethod.trim().toLowerCase()!=='cash')voidHold('Use a separate reviewed checkout for linked payments, meals, or delivery. This correction supports ordinary receipts only.');
 editableVoidCart(payload.cart);
 const cartKeys=['name','basePrice','variantName','variantPrice','qty','notes','addons','discountType','discountVal','isGrouped','realName','orderType','lineTotalFinal','category'];
 for(const item of payload.cart){if(!voidFields(item,cartKeys,['name','basePrice','variantPrice','qty','addons','discountType','discountVal','lineTotalFinal']))voidHold('The replacement cart contains unsupported saved fields. Keep the draft and ask the Owner to review it.');for(const addon of Object.values(item.addons))if(!voidFields(addon,['name','price','qty','linkedIngredient','deductQty'],['price','qty']))voidHold('A replacement add-on contains unsupported saved fields.');}
 if(!Array.isArray(payload.inventoryMovements)||payload.inventoryMovements.length>150||new Set(payload.inventoryMovements.map(row=>row?.inventoryId)).size!==payload.inventoryMovements.length||payload.inventoryReviewRequired===true||payload.inventoryIssues?.length||payload.recipeIssues?.length)voidHold('The replacement stock recipe needs review before it can be queued.');
 for(const movement of payload.inventoryMovements)if(!voidFields(movement,['inventoryId','ingredientName','quantity','unitSnapshot'])||!accessDocumentId(movement.inventoryId)||!voidText(movement.ingredientName,200)||!finite(movement.quantity,{positive:true})||!validVoidUnitSnapshot(movement.unitSnapshot))voidHold('The replacement contains an invalid captured stock movement.');
 const expectedReceipt={...payload};delete expectedReceipt.recipeSnapshot;
 return {payloadHash:voidHash(payload),expectedReceipt,legacyFingerprint:savedFingerprint(payload),checkoutAttemptId:expected.checkoutAttemptId};
}
export function replacementReceiptMatches(receipt,marker,claim){
 if(!receipt?.data||!marker?.data)return false;
 const row=receipt.data,saved=marker.data,expected=claim.expectedReceipt;
 if(!voidFields(saved,['saleId','branch','receiptId','fingerprint','committedAt'])||saved.saleId!==expected.saleId||saved.receiptId!==expected.receiptId||saved.branch!==expected.branch||saved.fingerprint!==claim.legacyFingerprint)return false;
 const derived=new Set(['inventoryMovements','inventoryIssues','recipeIssues','inventoryReviewRequired','paymentVerified']);
 if(Object.keys(expected).some(key=>!derived.has(key)&&(!Object.hasOwn(row,key)||canonicalCashierVoidJSON(row[key])!==canonicalCashierVoidJSON(expected[key]))))return false;
 if(typeof row.paymentVerified!=='boolean'||expected.paymentVerified===true&&row.paymentVerified!==true)return false;
 if(expected.paymentVerified===false&&row.paymentVerified===true&&(!voidText(row.verifiedBy,200)||!Number.isFinite(voidMillis(row.verifiedAt))))return false;
 if(!Array.isArray(row.inventoryMovements)||!Array.isArray(row.inventoryIssues)||!Array.isArray(row.recipeIssues))return false;
 const original=expected.inventoryMovements,held=[];let next=0;
 for(const movement of original){if(next<row.inventoryMovements.length&&sameUnit(row.inventoryMovements[next],movement)){next++;continue;}held.push({inventoryId:movement.inventoryId,ingredientName:movement.ingredientName,quantity:movement.quantity,lookupName:movement.ingredientName,reason:'unit-changed',matches:1});}
 if(next!==row.inventoryMovements.length||!sameUnit(row.inventoryIssues,[...(expected.inventoryIssues||[]),...held])||!sameUnit(row.recipeIssues,expected.recipeIssues||[])||row.inventoryReviewRequired!==(row.inventoryIssues.length>0||row.recipeIssues.length>0))return false;
 return row.statsApplied===true&&row.ballsCounted===countBalls(expected.cart)&&['applied','deferred'].includes(row.inventoryState)&&![ 'Voided','Parked','Cancelled'].includes(row.status)&&Number.isFinite(voidMillis(row.timestamp))&&voidMillis(row.timestamp)===Date.parse(expected.localTimestamp);
}
