const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
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
