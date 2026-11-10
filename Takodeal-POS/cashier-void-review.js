import {voidClone,voidHash,voidId} from './cashier-void-model.js';
import {isCashierOwnerActionUser} from './cashier-protected-action.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unit=value=>value===null||typeof value==='string'&&value.length<=64&&!/[\u0000-\u001f\u007f]/.test(value);
export function legacyVoidUnitReview(error,record,user){
 if(error?.status!==409||error.code!=='cashier-void/legacy-unit-review-required'||record?.state!=='pending'||record.commitStarted!==false||!isCashierOwnerActionUser(user))return null;
 const review=error.unitReview;if(!object(review)||review.schemaVersion!==1||!voidHash(review.fingerprint)||!voidHash(review.sourceFingerprint)||!text(review.disclaimer,2000)||!Array.isArray(review.rows)||!review.rows.length||review.rows.length>150)return null;
 const seen=new Set();for(const row of review.rows){const snapshot=row?.unitSnapshot;if(!object(row)||!voidId(row.inventoryId)||seen.has(row.inventoryId)||!text(row.ingredientName,200)||!Number.isFinite(row.quantity)||row.quantity<=0||!object(snapshot)||snapshot.schemaVersion!==1||!unit(snapshot.baseUom)||!unit(snapshot.uom)||![snapshot.baseUom,snapshot.uom].some(value=>typeof value==='string'&&value.trim()))return null;seen.add(row.inventoryId);}
 return voidClone(review);
}
export function legacyVoidUnitMarkup(review,receiptId){
 return '<p><strong>Receipt '+escape(receiptId)+'</strong></p><p>'+escape(review.disclaimer)+'</p><div class="cashier-void-movements">'+review.rows.map((row,index)=>'<article><strong>'+escape(row.ingredientName)+'</strong><span>Saved quantity: '+escape(row.quantity)+'</span><span>Current unit: '+escape(row.unitSnapshot.baseUom||row.unitSnapshot.uom)+'</span><label><input type="checkbox" id="void-unit-ack-'+index+'"> I have checked this item and its unit.</label></article>').join('')+'</div><p>Original units were not saved. Confirm these units from your records before returning stock. No stock changes until the final void confirmation.</p>';
}
export function validLegacyVoidReason(value){return typeof value==='string'&&value.trim().length>=8&&value.length<=1000&&!/[\u0000-\u001f\u007f]/.test(value);}
