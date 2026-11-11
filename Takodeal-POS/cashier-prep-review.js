import {isMeasuredPrep,measuredSchema,measuredIntent,measuredYieldMarkup} from './cashier-prep-measured.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fields=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ACTUAL_PRODUCTION_DECLARATION='AdditionalUnloggedProduction';
export const isActualPrep=record=>record?.protocol==='actual-v2';
const actualSchema=(view,record)=>isMeasuredPrep(record)?measuredSchema(view,record):isActualPrep(record)?view?.schemaVersion===2&&view.protocol==='actual-prep-v2'&&view.actualProductionDeclaration===ACTUAL_PRODUCTION_DECLARATION:view?.schemaVersion===1;
function issue(value){if(!object(value)||typeof value.code!=='string'||!/^[a-z0-9-]{1,80}$/.test(value.code)||!text(value.message,2000)||!object(value.details))return false;let size;try{size=JSON.stringify(value.details).length;}catch{return false;}return size<=12000;}

// Only the fixed server's typed semantic response can offer Skip. A timeout,
// authorization error or an uncertain commit never becomes a recipe decision.
export function prepSemanticReview(result,{status,record,actor}={}){
 if(!object(record)||!object(actor)||status!==409||result?.code!=='prep/review-required'||record.commitStarted===true||record.expectedFingerprint&&record.commitStarted!==false)return null;
 const row=result.review;
 if(!object(row)||!actualSchema(row,record)||row.skippable!==true||row.operationId!==record.operationId||row.outputInventoryId!==record.outputInventoryId||row.qty!==record.qty||row.branch!==actor.branch||!text(row.outputName,200)||!hash(row.issueFingerprint)||!issue(row.issue))return null;
 return JSON.parse(JSON.stringify(row));
}
export function prepReviewSaved(view,record,actor){
 if(!object(record)||record.state==='saved'||!object(actor)||!object(view)||!actualSchema(view,record)||view.operationId!==record.operationId||view.outputInventoryId!==record.outputInventoryId||view.qty!==record.qty||view.branch!==actor.branch||!text(view.outputName,200)||view.canCommit!==false||view.notSaved!==true||view.reviewSaved!==true||view.skipped!==true||view.reviewId!==record.operationId||view.status!=='Pending'||view.stockPosted!==false||!hash(view.sourceFingerprint)||record.reviewIssueFingerprint&&view.sourceFingerprint!==record.reviewIssueFingerprint||!issue(view.issue))return false;
 return true;
}
export function prepReviewMarkup(review,declaredName){
 if(review?.schemaVersion===3)return '<div class="cashier-prep-review-note"><strong>'+escape(declaredName||review.outputName)+'</strong><p>'+escape(review.qty)+' input batches · '+escape(review.branch)+'</p><p>'+escape(review.issue.message)+'</p></div><p>Skip STOCK POSTING and send this unposted batch to the protected Owner review. No output or raw deduction is posted. '+(review.measurement===null?'No actual output measurement is inferred.':'The recorded total measurement is retained in its original reference.')+'</p><p>Keep the reference and do not log this same batch again until its unposted outcome is reviewed.</p>';
 if(review?.schemaVersion===2)return '<div class="cashier-prep-review-note"><strong>'+escape(declaredName||review.outputName)+'</strong><p>'+escape(review.qty)+' requested quantity · '+escape(review.branch)+'</p><p>'+escape(review.issue.message)+'</p></div><p>Skip stock posting for this batch and send its quantity, saved issue and your note to the protected Owner review. No prepared stock or ingredient deduction is posted. This does not claim the physical batch was cancelled.</p><p>Keep its reference. Do not enter the same production again until the Owner has reviewed this unposted batch.</p>';
 return '<div class="cashier-prep-review-note"><strong>'+escape(declaredName||review.outputName)+'</strong><p>'+escape(review.qty)+' requested quantity · '+escape(review.branch)+'</p><p>'+escape(review.issue.message)+'</p></div><p>Skip only this batch for now. Its quantity, saved issue and your note will be retained in a protected Owner review. No prepared stock or ingredient deduction is posted for a skipped batch. Other batches stay in the cart.</p><p>If it was already physically prepared, keep the batch for review instead of reporting it as skipped.</p>';
}

// A renewed login may inspect an old attempt, but it never adopts the old
// session's authority to post stock. Only exact terminal server evidence can
// finish that original local reference.
export async function prepRecoveryStatus(view,record,actor,{crypto=globalThis.crypto}={}){
 if(!fields(view,['schemaVersion','operationId','state','terminal','stockPosted','canCommit','recoveryFingerprint','source','quoteClosed','reviewed','reversed'])||view.schemaVersion!==1||view.operationId!==record?.operationId||!['saved','skipped','closed','pending','unknown'].includes(view.state)||view.canCommit!==false||!hash(view.recoveryFingerprint)||['terminal','quoteClosed','reviewed','reversed'].some(key=>typeof view[key]!=='boolean'))return null;
 let original;try{original=JSON.parse(record.scope);}catch{return null;}
 if(!object(original)||['uid','staffId','deviceId','branch'].some(key=>typeof original[key]!=='string'||!original[key]||original[key]!==actor?.[key])||typeof original.staffSessionId!=='string'||!original.staffSessionId)return null;
 const terminal=['saved','skipped','closed'].includes(view.state);
 if(view.terminal!==terminal||view.stockPosted!==(view.state==='saved'?true:view.state==='unknown'?null:false)||view.reversed&&view.state!=='saved'||view.reviewed&&view.state!=='skipped'||view.state==='closed'&&!view.quoteClosed||view.state==='unknown'&&(view.source!==null||view.quoteClosed))return null;
 if(view.source===null)return ['closed','unknown'].includes(view.state)?JSON.parse(JSON.stringify(view)):null;
 const source=view.source;
 if(!fields(source,['branch','outputInventoryId','outputName','qty','intentHash','actorFingerprint'])||source.branch!==original.branch||source.outputInventoryId!==record.outputInventoryId||source.qty!==record.qty||!text(source.outputName,200)||!hash(source.intentHash)||!hash(source.actorFingerprint)||typeof crypto?.subtle?.digest!=='function')return null;
 const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(isMeasuredPrep(record)&&record.measurement===null&&view.state==='saved')return null;
 if(source.intentHash!==await digest(isMeasuredPrep(record)?measuredIntent(record):{outputInventoryId:record.outputInventoryId,qty:record.qty,reason:record.reason||'',...(isActualPrep(record)?{actualProductionDeclaration:ACTUAL_PRODUCTION_DECLARATION}:{})})||source.actorFingerprint!==await digest({actorUid:original.uid,staffId:original.staffId,deviceId:original.deviceId,sessionId:original.staffSessionId}))return null;
 return JSON.parse(JSON.stringify(view));
}

export function prepYieldMarkup(view,record){
 if(isMeasuredPrep(record))return measuredYieldMarkup(view,record);
 const output=view.effects?.find(row=>row.id===record.outputInventoryId&&row.role==='output');
 if(!output||!Number.isFinite(output.delta)||output.delta<=0||typeof output.unit!=='string'||typeof view.purchaseUnit!=='string'||!view.purchaseUnit.trim())throw Error('The prepared output units need review before saving this batch.');
 const number=value=>escape(Number(value).toLocaleString(undefined,{maximumFractionDigits:8}));
 return '<div class="cashier-prep-yield"><strong>'+(isActualPrep(record)?'ADDITIONAL production not already logged: ':'Entered quantity: ')+number(record.qty)+' '+escape(view.purchaseUnit)+'</strong><strong>Prepared output added: '+number(output.delta)+' '+escape(output.unit)+'</strong><span>1 '+escape(view.purchaseUnit)+' = '+number(output.delta/record.qty)+' '+escape(output.unit)+' using this item’s saved conversion.</span><p>Confirm the number of '+escape(view.purchaseUnit)+' actually made'+(isActualPrep(record)?' and not previously logged':'')+'. Do not enter grams as packs or batches. This adds the output shown above; it does not reset the recorded stock.</p></div>';
}

export function validateActualPrepView(view,record,actor){
 const fail=()=>{throw Error('The actual-production result could not be verified. Reference: '+String(record?.operationId||'unavailable')+'. Keep its quantity and ask Owner to check this exact reference in Security Alerts → Private prep reviews. No replacement attempt was created.');},finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12;
 if(!isActualPrep(record)||!actualSchema(view,record)||view.operationId!==record.operationId||view.outputInventoryId!==record.outputInventoryId||view.qty!==record.qty||view.branch!==actor.branch||!hash(view.expectedFingerprint)||!hash(view.warningFingerprint)||record.expectedFingerprint&&record.expectedFingerprint!==view.expectedFingerprint||record.warningFingerprint&&record.warningFingerprint!==view.warningFingerprint||typeof view.requiresWarningAcknowledgement!=='boolean'||!Array.isArray(view.effects)||view.effects.length<2||view.effects.length>31||!Array.isArray(view.stockWarnings)||view.stockWarnings.length>30||!text(view.purchaseUnit,40)||typeof view.canCommit!=='boolean'||(view.alreadySaved===true||view.saved===true)&&(view.canCommit!==false||view.notSaved===true||view.skipped===true||view.stockPosted===false))fail();
 const seen=new Set();let output;const affected=[];
 for(const effect of view.effects){if(!object(effect)||typeof effect.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(effect.id)||seen.has(effect.id)||effect.branch!==actor.branch||!text(effect.name,160)||!text(effect.unit,40)||!finite(effect.beforeStock)||!finite(effect.afterStock)||!finite(effect.delta)||!effect.delta||!/^[-]?\d{1,12}:\d{9}$/.test(effect.beforeUpdateTime||'')||Math.abs(effect.beforeStock+effect.delta-effect.afterStock)>Math.max(1,Math.abs(effect.beforeStock),Math.abs(effect.afterStock),Math.abs(effect.delta))*Number.EPSILON*8)fail();seen.add(effect.id);if(effect.id===record.outputInventoryId){if(effect.role!=='output'||effect.delta<=0||output)fail();output=effect;}else{if(effect.role!=='ingredient'||effect.delta>=0)fail();if(effect.beforeStock<0||effect.afterStock<0)affected.push(effect);}}
 if(!output||view.effects[0]!==output||view.outputName!==output.name||!text(view.outputName,160)||view.outputBaseQuantity!==output.delta||view.requiresWarningAcknowledgement!==(affected.length>0)||view.stockWarnings.length!==affected.length)fail();
 const warned=new Set();for(const warning of view.stockWarnings){const effect=affected.find(row=>row.id===warning?.inventoryId);if(!fields(warning,['inventoryId','itemName','unit','beforeStock','delta','afterStock'])||!effect||warned.has(warning.inventoryId)||warning.itemName!==effect.name||warning.unit!==effect.unit||warning.beforeStock!==effect.beforeStock||warning.delta!==effect.delta||warning.afterStock!==effect.afterStock)fail();warned.add(warning.inventoryId);}
 return view;
}

export function actualPrepWarningMarkup(view){
 if(!view.requiresWarningAcknowledgement)return '';
 const number=value=>escape(Number(value).toLocaleString(undefined,{maximumFractionDigits:8}));
 return '<div class="cashier-prep-stock-warning"><strong>Raw stock warning — recording actual production</strong><p>The following saved raw balances will remain or become negative. Recipe usage is still deducted in full.</p>'+view.stockWarnings.map(row=>'<div><strong>'+escape(row.itemName)+'</strong><span>Before: '+number(row.beforeStock)+' '+escape(row.unit)+'</span><span>Recipe consumed: '+number(-row.delta)+' '+escape(row.unit)+'</span><span>After: '+number(row.afterStock)+' '+escape(row.unit)+'</span></div>').join('')+'<p>This does not add a delivery, reset stock or approve an inventory adjustment. A protected warning linked to this posted batch will be available to the Owner.</p></div>';
}

export async function verifyActualPrepWarning(view,record,{crypto=globalThis.crypto}={}){
 if(!isActualPrep(record)||typeof crypto?.subtle?.digest!=='function')throw Error('The exact actual-production warning could not be verified. Keep reference '+String(record?.operationId||'unavailable')+'.');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({version:2,kind:'actual-prep-warning-ack',operationId:record.operationId,expectedFingerprint:view.expectedFingerprint,rows:view.stockWarnings})));
 if([...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')!==view.warningFingerprint)throw Error('The actual-production warning does not match its frozen preview. Keep reference '+record.operationId+' and ask Owner to review it.');
 return view;
}
