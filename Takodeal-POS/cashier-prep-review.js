const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fields=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function issue(value){if(!object(value)||typeof value.code!=='string'||!/^[a-z0-9-]{1,80}$/.test(value.code)||!text(value.message,2000)||!object(value.details))return false;let size;try{size=JSON.stringify(value.details).length;}catch{return false;}return size<=12000;}

// Only the fixed server's typed semantic response can offer Skip. A timeout,
// authorization error or an uncertain commit never becomes a recipe decision.
export function prepSemanticReview(result,{status,record,actor}={}){
 if(!object(record)||!object(actor)||status!==409||result?.code!=='prep/review-required'||record.commitStarted===true||record.expectedFingerprint&&record.commitStarted!==false)return null;
 const row=result.review;
 if(!object(row)||row.schemaVersion!==1||row.skippable!==true||row.operationId!==record.operationId||row.outputInventoryId!==record.outputInventoryId||row.qty!==record.qty||row.branch!==actor.branch||!text(row.outputName,200)||!hash(row.issueFingerprint)||!issue(row.issue))return null;
 return JSON.parse(JSON.stringify(row));
}
export function prepReviewSaved(view,record,actor){
 if(!object(record)||record.state==='saved'||!object(actor)||!object(view)||view.schemaVersion!==1||view.operationId!==record.operationId||view.outputInventoryId!==record.outputInventoryId||view.qty!==record.qty||view.branch!==actor.branch||!text(view.outputName,200)||view.canCommit!==false||view.notSaved!==true||view.reviewSaved!==true||view.skipped!==true||view.reviewId!==record.operationId||view.status!=='Pending'||view.stockPosted!==false||!hash(view.sourceFingerprint)||record.reviewIssueFingerprint&&view.sourceFingerprint!==record.reviewIssueFingerprint||!issue(view.issue))return false;
 return true;
}
export function prepReviewMarkup(review,declaredName){
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
 if(source.intentHash!==await digest({outputInventoryId:record.outputInventoryId,qty:record.qty,reason:record.reason||''})||source.actorFingerprint!==await digest({actorUid:original.uid,staffId:original.staffId,deviceId:original.deviceId,sessionId:original.staffSessionId}))return null;
 return JSON.parse(JSON.stringify(view));
}

export function prepYieldMarkup(view,record){
 const output=view.effects?.find(row=>row.id===record.outputInventoryId&&row.role==='output');
 if(!output||!Number.isFinite(output.delta)||output.delta<=0||typeof output.unit!=='string'||typeof view.purchaseUnit!=='string'||!view.purchaseUnit.trim())throw Error('The prepared output units need review before saving this batch.');
 const number=value=>escape(Number(value).toLocaleString(undefined,{maximumFractionDigits:8}));
 return '<div class="cashier-prep-yield"><strong>Entered quantity: '+number(record.qty)+' '+escape(view.purchaseUnit)+'</strong><strong>Prepared output added: '+number(output.delta)+' '+escape(output.unit)+'</strong><span>1 '+escape(view.purchaseUnit)+' = '+number(output.delta/record.qty)+' '+escape(output.unit)+' using this item’s saved conversion.</span><p>Confirm the number of '+escape(view.purchaseUnit)+' actually made. Do not enter grams as packs or batches. This adds the output shown above; it does not reset the recorded stock.</p></div>';
}
