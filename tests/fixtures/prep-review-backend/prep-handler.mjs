import {createHash} from 'node:crypto';
import {planPrepBatch,planPrepReversal,prepCanonical,prepId,prepTimestampToken,PREP_VERSION} from './prep-model.mjs';
import {resolveHQAccount,savedPin} from './relief-core/hq-account-model.js';
import {activeAccessStaff} from './access-model.mjs';
import {PrepSourceReviewError,normalizedPrepName,prepSemanticIssue,prepReviewSourceSnapshot,prepReviewFingerprint,prepReviewSourceReferences,savedPrepReview} from './prep-review-model.mjs';
export const PREP_OWNER='jgo031996@gmail.com',PREP_ORIGIN='https://takodeal-owner.vercel.app',PREP_CASHIER_ORIGIN='https://takodeal-cashier.vercel.app',PREP_MAX_BYTES=4096;
const routes=new Set(['/prep/preview','/prep/commit','/prep/reversal-preview','/prep/reverse','/prep/review-skip','/prep/reviews','/prep/review-read']);
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
const fields=(value,keys,required=keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const fingerprint=value=>createHash('sha256').update(prepCanonical(value)).digest('hex'),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inactive=row=>!row||row.active===false||row.blocked===true||row.archived===true||row.deleted===true||/^(inactive|disabled|archived|deleted|blocked|revoked|closed)$/i.test(row.status||'');
class PrepRequestError extends Error{constructor(status,code,message,extra={}){super(message);this.status=status;this.code=code;Object.assign(this,extra);}}
const fail=(status,code,message,extra)=>{throw new PrepRequestError(status,code,message,extra);};
const operationId=value=>prepId(value)&&value.length>=8&&value.length<=96;
const reason=value=>typeof value==='string'&&value.trim().length>=8&&value.length<=1000&&!/[\u0000-\u001f\u007f]/.test(value);
const planFields=['version','kind','branch','outputInventoryId','outputName','qty','purchaseUnit','outputBaseQuantity','effects','recipe'];
const provenance=row=>row.recipeMatch?{recipeMatch:row.recipeMatch}:{};
const validProvenance=row=>!row.recipeMatch||fields(row.recipeMatch,['method','outputName','recipeName'])&&row.recipeMatch.method==='whitespace-only'&&row.recipeMatch.outputName===row.outputName&&typeof row.recipeMatch.recipeName==='string'&&row.recipeMatch.recipeName.length<=160&&normalizedPrepName(row.recipeMatch.outputName)===normalizedPrepName(row.recipeMatch.recipeName);
const trustedOwner=actor=>actor.email?.toLowerCase()===PREP_OWNER&&actor.email_verified===true&&actor.firebase?.sign_in_provider==='google.com';
const actorFields=actor=>actor.prepApp==='cashier'?{actorUid:actor.uid,actorEmail:actor.email||'',actorType:'cashier',staffId:actor.cashier.staffId,deviceId:actor.cashier.deviceId,sessionId:actor.cashier.sessionId}:{actorUid:actor.uid,actorEmail:PREP_OWNER};
const savedActorKey=row=>row.actorType==='cashier'?{actorUid:row.actorUid,staffId:row.staffId,deviceId:row.deviceId,sessionId:row.sessionId}:{actorUid:row.actorUid};
const actorKey=actor=>savedActorKey(actorFields(actor));
const validSavedActor=row=>prepId(row.actorUid)&&(row.actorType==='cashier'?prepId(row.staffId)&&prepId(row.deviceId)&&prepId(row.sessionId)&&row.sessionId.length>=16&&typeof row.actorEmail==='string':row.actorEmail===PREP_OWNER);
function savedOperation(row,id){
 const plan=Object.fromEntries(planFields.map(key=>[key,row[key]])),intent={outputInventoryId:row.outputInventoryId,qty:row.qty,reason:row.reason};
 if(row.version!==1||row.kind!=='owner-prep'||row.operationId!==id||!validSavedActor(row)||!validProvenance(row)||typeof row.reason!=='string'||!hash(row.intentHash)||!hash(row.expectedFingerprint)||!Array.isArray(row.effects)||row.effects.length<2||row.effects.length>31||row.intentHash!==fingerprint(intent)||row.expectedFingerprint!==fingerprint({plan,intent,...savedActorKey(row),...provenance(row)}))fail(409,'prep/audit-incomplete','The saved prep movement audit is incomplete or changed. HQ must review a documented stock correction.');
}
function savedQuote(row,id){if(row.version!==1||row.kind!=='owner-prep-quote'||row.operationId!==id||!validSavedActor(row)||!validProvenance({...row,outputName:row.plan?.outputName})||!Number.isSafeInteger(row.expiresAt)||!fields(row.intent,['outputInventoryId','qty','reason'])||!plain(row.plan)||!hash(row.intentHash)||!hash(row.expectedFingerprint)||row.intentHash!==fingerprint(row.intent)||row.expectedFingerprint!==fingerprint({plan:row.plan,intent:row.intent,...savedActorKey(row),...provenance(row)}))fail(409,'prep/quote-incomplete','The saved prep preview needs HQ review. No stock changes were confirmed.');}
async function authority(tx,actor,branch,now){
 if(actor.prepApp==='cashier'){
  const session=await tx.get('staff_login_sessions',actor.uid),context=actor.cashier,expires=session?.expiresAt?.toMillis?.()??Date.parse(session?.expiresAt||'');
  if(!session||session.schemaVersion!==1||session.uid!==actor.uid||session.app!=='cashier'||session.staffId!==context.staffId||session.deviceId!==context.deviceId||session.sessionId!==context.sessionId||!Number.isFinite(expires)||expires<=now()||branch!=null&&session.branch!==branch)fail(403,'prep/staff-session-required','Sign in again on this approved Cashier device before preparing stock.');
  const profile=await tx.get('cashiers',session.staffId);if(!activeAccessStaff(profile)||profile.accessRevision!==session.profileRevision)fail(403,'prep/staff-session-required','The selected employee changed. Sign in again before preparing stock.');
  if(trustedOwner(actor)){const mirrors=await tx.deviceRecords(context.deviceId);if(mirrors.length!==1||mirrors[0].status!=='Active'||mirrors[0].branch!==session.branch||String(mirrors[0].appType||'').trim().toLowerCase()==='staff')fail(403,'prep/device-required','This Cashier device needs HQ approval.');}
  else{const binding=await tx.get('pos_bindings',actor.uid);if(!binding||binding.uid!==actor.uid||binding.status!=='Active'||binding.deviceId!==context.deviceId||binding.branch!==session.branch||!prepId(binding.legacyDeviceDocId))fail(403,'prep/device-required','This Cashier device needs HQ approval.');const mirror=await tx.get('pos_devices',binding.legacyDeviceDocId);if(!mirror||mirror.status!=='Active'||mirror.deviceId!==context.deviceId||mirror.branch!==session.branch||String(mirror.appType||'').trim().toLowerCase()==='staff')fail(403,'prep/device-required','This Cashier device needs HQ approval.');}
  actor.prepActorName=profile.cashierName;actor.prepBranch=session.branch;
  if(!trustedOwner(actor)){if(branch!=null){const branches=await tx.branchRecords(branch);if(branches.length!==1||inactive(branches[0]))fail(409,'prep/branch-unavailable','Choose one active saved branch.');}return;}
 }
 const records=await tx.ownerRecords();if(!records.length||records.some(row=>row.email?.toLowerCase()!==PREP_OWNER||inactive(row)||row.uid&&row.uid!==actor.uid))fail(403,'prep/owner-unavailable','HQ must confirm this active Owner account before changing prep.');
 let account;try{account=resolveHQAccount(records.map(row=>({id:row.id,data:row})));}catch{fail(403,'prep/owner-unavailable','HQ must resolve the saved Owner account before changing prep.');}
 if(inactive(account)||/^(REVOKED|BLOCKED)$/i.test(savedPin(account))||/franchise/i.test(account.role||''))fail(403,'prep/owner-unavailable','HQ must confirm this active Owner account before changing prep.');
 if(branch!=null){const branches=await tx.branchRecords(branch);if(branches.length!==1||branches[0].name!==branch||inactive(branches[0]))fail(409,'prep/branch-unavailable','Choose one active, unambiguous saved branch.');}
}
async function freshPlan(tx,input,assertBranch,{actor}={}){
 const context={output:null,recipes:[],ingredientGroups:[],recipeNames:[],outputNames:[],recipeMatch:null};
 try{
  const output=await tx.get('inventory',input.outputInventoryId);context.output=output;
  if(!output)throw new PrepSourceReviewError('output-missing','The selected prepared item is no longer saved. Ask the Owner to review its inventory reference.');
  if(typeof output.branch!=='string'||!output.branch||output.branch.trim()!==output.branch||output.branch.length>128||/^all$/i.test(output.branch)||/[\u0000-\u001f\u007f]/.test(output.branch))fail(409,'prep/source-scope-invalid','This saved prepared item has no valid branch scope. Ask the Owner to review its inventory reference before reporting or preparing it.');
  await assertBranch(output.branch);
  if(typeof output.name!=='string'||!output.name.trim()||output.name.length>160||/[\u0000-\u001f\u007f]/.test(output.name))throw new PrepSourceReviewError('output-label-invalid','The saved prepared-item name needs Owner review.');
  try{planPrepBatch({output,recipes:[],ingredients:[],qty:input.qty});}catch(error){if(error?.name!=='PrepModelError'||error.issueCode!=='recipe-unavailable')throw error;}
  let recipes=await tx.recipeRows(output.name),recipeName=output.name;
  if(!recipes.length){
   const normalized=normalizedPrepName(output.name);
   if(typeof output.name!=='string'||!normalized||output.name.length>160||/[\u0000-\u001f\u007f]/.test(output.name))throw new PrepSourceReviewError('output-label-invalid','The saved prepared-item name needs Owner review.');
   const names=await tx.recipeNameRows(),matching=names.filter(row=>typeof row.menuItem==='string'&&normalizedPrepName(row.menuItem)===normalized),unique=[...new Set(matching.map(row=>row.menuItem))];context.recipeNames=matching;
   if(!unique.length)throw new PrepSourceReviewError('recipe-unavailable','No exact or uniquely whitespace-matched saved recipe exists for this prepared item. Ask the Owner to review its recipe.');
   if(unique.length!==1)throw new PrepSourceReviewError('recipe-name-ambiguous','More than one whitespace-equivalent recipe name exists. The Owner must resolve the saved names before preparing stock.');
   const outputs=(await tx.preparedNameRows(output.branch)).filter(row=>String(row.category||'').trim().toLowerCase()==='prepared batch'&&typeof row.name==='string'&&normalizedPrepName(row.name)===normalized);context.outputNames=outputs;
   if(outputs.length!==1||outputs[0].id!==output.id)throw new PrepSourceReviewError('output-name-ambiguous','More than one whitespace-equivalent prepared output exists in this branch. The Owner must resolve the inventory names first.');
   recipeName=unique[0];recipes=await tx.recipeRows(recipeName);context.recipeMatch={method:'whitespace-only',outputName:output.name,recipeName};
  }
  context.recipes=recipes;if(recipes.length>30)throw new PrepSourceReviewError('recipe-unavailable','This saved recipe contains more than 30 ingredient rows. Ask the Owner to review its exact recipe before preparing stock.');const ingredients=[];
  for(const name of [...new Set(recipes.map(row=>row.ingredientName))]){
   if(typeof name!=='string'||!name.trim()||name.length>160||/[\u0000-\u001f\u007f]/.test(name))throw new PrepSourceReviewError('invalid-recipe','A saved recipe ingredient name needs Owner review.');
   const rows=await tx.ingredientRows(output.branch,name);context.ingredientGroups.push({name,rows});
   if(rows.length!==1)throw new PrepSourceReviewError(rows.length?'duplicate-ingredient':'ingredient-missing',rows.length?'More than one saved '+name+' stock record exists in this branch. Ask the Owner to resolve the duplicate.':'The saved recipe ingredient '+name+' has no exact stock record in this branch. Ask the Owner to review it.',{ingredientName:name,matches:rows.length});
   ingredients.push(rows[0]);
  }
  const plan=planPrepBatch({output,recipes,ingredients,qty:input.qty,recipeName});return {plan,recipeMatch:context.recipeMatch};
 }catch(error){
  const issue=prepSemanticIssue(error);if(!issue)throw error;
  const branch=context.output?.branch||actor?.prepBranch,intent={outputInventoryId:input.outputInventoryId,qty:input.qty,reason:input.reason||''},snapshot=prepReviewSourceSnapshot(context);
  const outputName=typeof context.output?.name==='string'&&context.output.name.trim()&&context.output.name.length<=160&&!/[\u0000-\u001f\u007f]/.test(context.output.name)?context.output.name:'Unavailable prepared item';
  const review=actor?.prepApp==='cashier'&&typeof branch==='string'&&branch?{schemaVersion:1,skippable:true,operationId:input.operationId,branch,outputInventoryId:input.outputInventoryId,outputName,qty:input.qty,issue,issueFingerprint:prepReviewFingerprint({actor:actorKey(actor),intent,branch,snapshot,issue})}:null;
  fail(409,'prep/review-required',issue.message,{...(review?{review}:{}),reviewSnapshot:snapshot});
 }
}
const issueView=issue=>({code:issue.code,message:issue.message,details:issue.details});
const reviewView=row=>({schemaVersion:1,operationId:row.operationId,branch:row.branch,outputInventoryId:row.outputInventoryId,outputName:row.outputName,qty:row.qty,canCommit:false,notSaved:true,reviewSaved:true,skipped:true,reviewId:row.operationId,status:'Pending',stockPosted:false,sourceFingerprint:row.sourceFingerprint,issue:issueView(row.issue)});
const reviewIntent=input=>({outputInventoryId:input.outputInventoryId,qty:input.qty,reason:input.reason||'',branch:input.branch,declaredName:input.declaredName,skipReason:input.skipReason,note:input.note||''});
function privateReview(row,id){try{savedPrepReview(row,id);const token=prepTimestampToken(row.createdAt),createdAt=token&&new Date(Number(token.split(':')[0])*1000+Number(token.split(':')[1])/1e6).toISOString();if(!createdAt||!operationId(id)||typeof row.outputName!=='string'||!row.outputName.trim()||row.outputName.length>160||typeof row.declaredName!=='string'||row.declaredName.length>160||typeof row.reason!=='string'||row.reason.length>1000||typeof row.note!=='string'||row.note.length>500||typeof row.staffName!=='string'||row.staffName.length>200||typeof row.issue.code!=='string'||!/^[a-z0-9-]{1,80}$/.test(row.issue.code)||row.issue.message.length>2000||!plain(row.issue.details))throw Error();return {operationId:id,branch:row.branch,outputInventoryId:row.outputInventoryId,outputName:row.outputName,qty:row.qty,status:'Pending',stockPosted:false,createdAt};}catch{fail(409,'prep/review-incomplete','The saved prep review needs Owner confirmation. Keep its original reference.');}}

const view=(operationId,plan,extra={})=>({operationId,branch:plan.branch,outputInventoryId:plan.outputInventoryId,outputName:plan.outputName,qty:plan.qty,purchaseUnit:plan.purchaseUnit,outputBaseQuantity:plan.outputBaseQuantity,effects:plan.effects,...provenance(plan),...(plan.effects?.[0]?.beforeStock<0?{warnings:[{code:'negative-output-balance',message:'The recorded prepared stock starts negative. This batch adds its real output quantity while retaining any remaining deficit; it does not reset stock to zero.'}]}:{}),...extra});
export function createPrepHandler({verifyToken,store,now=Date.now}={}){
 if(typeof verifyToken!=='function'||typeof store?.transaction!=='function')throw Error('Trusted Owner authentication and prep transactions are required.');
 async function execute(path,input,actor){return store.transaction(async tx=>{
  await authority(tx,actor,undefined,now);
  if(path==='/prep/reviews'){
   if(input.afterOperationId!==undefined){const cursor=await tx.get('prep_review_requests',input.afterOperationId);if(!cursor)fail(409,'prep/review-unavailable','The private review cursor was not found. Refresh the newest page.');privateReview(cursor,input.afterOperationId);}
   const records=await tx.reviewRows(input.afterOperationId),reviews=records.slice(0,20).map(row=>privateReview(row,row.id));return {schemaVersion:1,reviews,hasMore:records.length>20,nextAfterOperationId:records.length>20?reviews[reviews.length-1].operationId:null};
  }
  if(path==='/prep/review-read'){const row=await tx.get('prep_review_requests',input.operationId);if(!row)fail(409,'prep/review-unavailable','This private prep review was not found. Refresh the Owner inbox.');const summary=privateReview(row,input.operationId);return {schemaVersion:1,review:{...summary,declaredName:row.declaredName,reason:row.reason,note:row.note,issue:issueView(row.issue),reportedBy:{staffId:row.staffId,staffName:row.staffName},sourceFingerprint:row.sourceFingerprint}};}
  if(actor.prepApp==='cashier'&&input.branch!==undefined&&input.branch!==actor.prepBranch)fail(403,'prep/device-required','The selected branch changed. Reopen prep on this approved Cashier device.');
  const op=await tx.get('prep_operations',input.operationId);
  if(op)savedOperation(op,input.operationId);
  const review=await tx.get('prep_review_requests',input.operationId);
  if(review){
   try{savedPrepReview(review,input.operationId);}catch{fail(409,'prep/review-incomplete','The saved prep review needs Owner confirmation. Keep its original reference; no new stock was confirmed.');}
   await authority(tx,actor,review.branch,now);
   if(op)fail(409,'prep/audit-incomplete','This prep has conflicting saved outcomes. Keep the original reference and ask the Owner to review it.');
   if(['/prep/preview','/prep/commit','/prep/review-skip'].includes(path)){
    if(prepCanonical(savedActorKey(review))!==prepCanonical(actorKey(actor)))fail(409,'prep/operation-conflict','This prep reference belongs to another confirmed employee or session.');
    if(path==='/prep/commit')fail(409,'prep/review-pending','This item was skipped for Owner review. No stock was prepared under this reference.');
    const intent={outputInventoryId:input.outputInventoryId,qty:input.qty,reason:input.reason||''};
    if(review.intentHash!==fingerprint(intent)||path==='/prep/review-skip'&&(review.reviewIntentHash!==fingerprint(reviewIntent(input))||review.sourceFingerprint!==input.expectedIssueFingerprint))fail(409,'prep/operation-conflict','This prep reference belongs to different saved review details.');
    return reviewView(review);
   }
  }
  if(path==='/prep/review-skip'){
   if(actor.prepApp!=='cashier'||actor.prepBranch!==input.branch)fail(403,'prep/device-required','Use the exact approved Cashier branch and employee to report this prep.');
   const intent={outputInventoryId:input.outputInventoryId,qty:input.qty,reason:input.reason||''},intentHash=fingerprint(intent);
   if(op){await authority(tx,actor,op.branch,now);if(prepCanonical(savedActorKey(op))!==prepCanonical(actorKey(actor))||op.intentHash!==intentHash)fail(409,'prep/operation-conflict','This reference already prepared different confirmed details.');return view(op.operationId,op,{saved:true,alreadySaved:true,skipped:false,reviewSaved:false,canCommit:false});}
   const old=await tx.get('prep_quotes',input.operationId);if(old){savedQuote(old,input.operationId);if(prepCanonical(savedActorKey(old))!==prepCanonical(actorKey(actor))||old.intentHash!==intentHash)fail(409,'prep/operation-conflict','The original prep preview belongs to different details.');}
   let blocked;try{await freshPlan(tx,input,branch=>authority(tx,actor,branch,now),{actor});}catch(error){if(error instanceof PrepRequestError&&error.review?.skippable===true)blocked=error;else throw error;}
   if(!blocked)fail(409,'prep/review-not-needed','The saved recipe and stock now support this item. Refresh its prep preview or remove the unposted draft; no item was silently prepared or skipped.');
   if(blocked.review.branch!==input.branch||blocked.review.issueFingerprint!==input.expectedIssueFingerprint)fail(409,'prep/review-changed','The recipe or stock issue changed. Reopen this item’s current warning before choosing Skip for now.');
   await authority(tx,actor,input.branch,now);
   const record={version:1,kind:'cashier-prep-review',operationId:input.operationId,...actorFields(actor),staffName:actor.prepActorName,branch:input.branch,outputInventoryId:input.outputInventoryId,outputName:blocked.review.outputName,declaredName:input.declaredName,qty:input.qty,reason:intent.reason,intentHash,reviewIntentHash:fingerprint(reviewIntent(input)),skipReason:'SkipForNow',note:input.note||'',issue:blocked.review.issue,sourceFingerprint:input.expectedIssueFingerprint,sources:prepReviewSourceReferences(blocked.reviewSnapshot),status:'Pending',stockPosted:false,createdAt:tx.serverTimestamp()};
   if(old&&old.status!=='closed')tx.closeQuote(input.operationId);
   tx.createReview(input.operationId,record);
   return reviewView(record);
  }
  if(path==='/prep/preview'){
   const intent={outputInventoryId:input.outputInventoryId,qty:input.qty,reason:input.reason||''},intentHash=fingerprint(intent);
   if(op){await authority(tx,actor,op.branch,now);if(prepCanonical(savedActorKey(op))!==prepCanonical(actorKey(actor))||op.intentHash!==intentHash)fail(409,'prep/operation-conflict','This prep reference belongs to different confirmed details.');return view(op.operationId,op,{alreadySaved:true,canCommit:false,expectedFingerprint:op.expectedFingerprint});}
   const old=await tx.get('prep_quotes',input.operationId),expiresAt=now()+10*60*1000;
   if(old)savedQuote(old,input.operationId);
   if(old&&(prepCanonical(savedActorKey(old))!==prepCanonical(actorKey(actor))||old.intentHash!==intentHash))fail(409,'prep/operation-conflict','This prep reference belongs to different confirmed details.');
   const close=async(message,expired=false)=>{await authority(tx,actor,old.plan.branch,now);if(old.status!=='closed')tx.closeQuote(input.operationId);return view(input.operationId,old.plan,{canCommit:false,notSaved:true,quoteClosed:true,expired,blockers:[message]});};
   if(old&&(old.status==='closed'||old.expiresAt<=now()))return close('The earlier preview is closed. No prep was saved under this reference. Start a fresh review.',old.expiresAt<=now());
   let fresh;try{fresh=await freshPlan(tx,input,branch=>authority(tx,actor,branch,now),{actor});}catch(error){if(old&&error.status===409)return close(error.message);throw error;}
   const {plan}=fresh;await authority(tx,actor,plan.branch,now);const expectedFingerprint=fingerprint({plan,intent,...actorKey(actor),...provenance(fresh)});
   if(old){if(old.expectedFingerprint!==expectedFingerprint)return close('Stock, units or the recipe changed. The earlier preview is closed without preparing stock.');return view(input.operationId,plan,{canCommit:true,expectedFingerprint,expiresAt:old.expiresAt,...provenance(fresh)});}
   tx.createQuote(input.operationId,{version:PREP_VERSION,kind:'owner-prep-quote',operationId:input.operationId,...actorFields(actor),intent,intentHash,plan,...provenance(fresh),expectedFingerprint,expiresAt,createdAt:tx.serverTimestamp()});
   return view(input.operationId,plan,{canCommit:true,expectedFingerprint,expiresAt,...provenance(fresh)});
  }
  if(path==='/prep/commit'){
   if(op){await authority(tx,actor,op.branch,now);if(prepCanonical(savedActorKey(op))!==prepCanonical(actorKey(actor))||op.expectedFingerprint!==input.expectedFingerprint)fail(409,'prep/operation-conflict','This prep reference belongs to different confirmed details.');return view(op.operationId,op,{saved:true,alreadySaved:true});}
   const quote=await tx.get('prep_quotes',input.operationId);if(quote)savedQuote(quote,input.operationId);if(!quote||prepCanonical(savedActorKey(quote))!==prepCanonical(actorKey(actor))||quote.expectedFingerprint!==input.expectedFingerprint||quote.status==='closed'||quote.expiresAt<=now())fail(409,'prep/quote-changed','The prep preview expired or changed. Nothing was prepared by this attempt. Retry its same item and quantity to confirm the saved result before starting a fresh review.');
   const fresh=await freshPlan(tx,{...quote.intent,operationId:input.operationId},branch=>authority(tx,actor,branch,now),{actor}),{plan}=fresh;await authority(tx,actor,plan.branch,now);
   if(fingerprint({plan,intent:quote.intent,...actorKey(actor),...provenance(fresh)})!==input.expectedFingerprint||prepCanonical(plan)!==prepCanonical(quote.plan))fail(409,'prep/source-changed','Stock, units or the recipe changed after your preview. Nothing was prepared; review it again.');
   const record={...plan,...provenance(fresh),operationId:input.operationId,intentHash:quote.intentHash,expectedFingerprint:input.expectedFingerprint,reason:quote.intent.reason,...actorFields(actor),committedAt:tx.serverTimestamp(),outputLogId:'prep-'+input.operationId+'-0'};
   for(const [index,effect]of plan.effects.entries()){tx.updateStock(effect.id,effect.beforeUpdateTime,effect.afterStock,{role:effect.role,outputInventoryId:plan.outputInventoryId});tx.createLog('prep-'+input.operationId+'-'+index,{version:1,prepOperationId:input.operationId,branch:plan.branch,inventoryId:effect.id,item:effect.name,uom:effect.unit,oldQty:effect.beforeStock,newQty:effect.afterStock,variance:effect.delta,type:index===0?(actor.prepApp==='cashier'?'End-of-Shift Kitchen Prep':'Manager Prep Batch'):'Kitchen Prep Ingredient',...(index===0?{purchQty:plan.qty,purchUom:plan.purchaseUnit}:{}),note:index===0?(actor.prepApp==='cashier'?'Cashier-confirmed audited prep':'Owner-confirmed audited prep'):'Ingredient used in '+plan.outputName,user:actor.prepActorName||PREP_OWNER,...actorFields(actor),timestamp:tx.serverTimestamp()});}
   tx.createOperation(input.operationId,record);return view(input.operationId,plan,{saved:true,alreadySaved:false});
  }
  if(!op)fail(409,'prep/legacy-record','This older prep has no trusted movement snapshot. Automatic reversal is unavailable; review a documented stock correction with HQ.');
  await authority(tx,actor,op.branch,now);const prior=await tx.get('prep_reversals',input.operationId);
  if(prior){if(path==='/prep/reverse'&&prior.requestId===input.requestId&&(prior.expectedFingerprint!==input.expectedFingerprint||prior.reason!==input.reason||prior.actorUid!==actor.uid))fail(409,'prep/operation-conflict','This reversal reference belongs to different confirmed details.');return view(op.operationId,op,{alreadyReversed:true,canReverse:false,saved:true,requestId:prior.requestId});}
  const current=await Promise.all(op.effects.map(effect=>tx.get('inventory',effect.id)));let plan;
  try{plan=planPrepReversal(op,current);}catch(error){if(path==='/prep/reversal-preview')return view(op.operationId,op,{canReverse:false,blockers:[error.message]});fail(409,'prep/reversal-held',error.message);}
  const expectedFingerprint=fingerprint({plan,sourceFingerprint:op.expectedFingerprint});
  if(path==='/prep/reversal-preview')return view(op.operationId,op,{canReverse:true,expectedFingerprint,reversalEffects:plan.effects,blockers:[]});
  if(input.expectedFingerprint!==expectedFingerprint)fail(409,'prep/source-changed','The reversal preview changed. Reopen the saved prep before confirming.');
  for(const [index,effect]of plan.effects.entries()){tx.updateStock(effect.id,effect.beforeUpdateTime,effect.afterStock,{role:effect.role,outputInventoryId:plan.outputInventoryId});tx.createLog('prep-reverse-'+input.operationId+'-'+index,{version:1,prepOperationId:input.operationId,prepReversalId:input.operationId,branch:plan.branch,inventoryId:effect.id,item:effect.name,uom:effect.unit,oldQty:effect.beforeStock,newQty:effect.afterStock,variance:effect.delta,type:'Owner Prep Reversal',note:input.reason,user:PREP_OWNER,timestamp:tx.serverTimestamp()});}
  tx.createReversal(input.operationId,{...plan,actorUid:actor.uid,actorEmail:PREP_OWNER,requestId:input.requestId,reason:input.reason,expectedFingerprint,recordedAt:tx.serverTimestamp()});
  return view(op.operationId,op,{saved:true,alreadyReversed:false,requestId:input.requestId});
 });}
 return async request=>{
  const origin=request.origin,response=(status,body)=>({status,body,headers:{'Cache-Control':'no-store','Content-Type':'application/json','X-Takodeal-Prep-Version':'1',Vary:'Origin',...([PREP_ORIGIN,PREP_CASHIER_ORIGIN].includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}});
  try{
   if(![PREP_ORIGIN,PREP_CASHIER_ORIGIN].includes(origin)||origin===PREP_CASHIER_ORIGIN&&!['/prep/preview','/prep/commit','/prep/review-skip'].includes(request.path))fail(403,'prep/origin-required','Open prep review in the approved Owner app.');
   if(request.path==='/prep/review-skip'&&origin!==PREP_CASHIER_ORIGIN)fail(403,'prep/origin-required','Use the approved Cashier item warning to request Owner review.');
   if(!routes.has(request.path))fail(404,'prep/route-unavailable','This prep action is unavailable.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).some(value=>!['authorization','content-type'].includes(value)))fail(403,'prep/preflight-denied','Use the approved Owner app.');return {...response(204,null),headers:{...response(204,null).headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};}
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:;|$)/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>PREP_MAX_BYTES||Buffer.byteLength(JSON.stringify(request.body||{}))>PREP_MAX_BYTES)fail(400,'prep/invalid-request','The prep request is incomplete or too large.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)fail(401,'prep/token-required','Sign in with the verified Owner account.');let actor;try{actor=await verifyToken(token,true);}catch{fail(401,'prep/token-required','Sign in again to confirm the Owner account.');}
   if(!prepId(actor?.uid)||(origin===PREP_CASHIER_ORIGIN&&actor.firebase?.sign_in_provider==='anonymous'?false:actor.email?.toLowerCase()!==PREP_OWNER||actor.email_verified!==true||actor.firebase?.sign_in_provider!=='google.com'))fail(403,'prep/owner-required','Only the verified Google Owner may confirm prep or its reversal.');
   const body=request.body,path=request.path,cashierOrigin=origin===PREP_CASHIER_ORIGIN;
   if(cashierOrigin){if(!fields(body?.cashier,['staffId','deviceId','sessionId'])||!prepId(body.cashier.staffId)||!prepId(body.cashier.deviceId)||!prepId(body.cashier.sessionId)||body.cashier.sessionId.length<16)fail(400,'prep/staff-session-required','Sign in to the exact employee account on this Cashier device.');actor={...actor,prepApp:'cashier',cashier:body.cashier};}
   if(path!=='/prep/reviews'&&!operationId(body?.operationId))fail(400,'prep/invalid-request','Keep the original stable prep reference.');
   const cashierFields=cashierOrigin?['cashier']:[],quantity=typeof body.qty==='number'&&Number.isFinite(body.qty)&&body.qty>0&&body.qty<=1e6;
   const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
   const branch=value=>typeof value==='string'&&value.trim().length>0&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
   const note=value=>typeof value==='string'&&value.length<=500&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
   const valid=path==='/prep/reviews'?fields(body,['afterOperationId'],[])&&(body.afterOperationId===undefined||operationId(body.afterOperationId))
    :path==='/prep/review-read'?fields(body,['operationId'])
    :path==='/prep/preview'?fields(body,['operationId','outputInventoryId','qty','reason',...cashierFields,...(cashierOrigin?['branch','declaredName']:[])],['operationId','outputInventoryId','qty'])&&prepId(body.outputInventoryId)&&quantity&&(body.reason==null||reason(body.reason))&&(body.branch===undefined||branch(body.branch))&&(body.declaredName===undefined||label(body.declaredName))
    :path==='/prep/commit'?fields(body,['operationId','expectedFingerprint',...cashierFields])&&hash(body.expectedFingerprint)
    :path==='/prep/reversal-preview'?fields(body,['operationId'])
    :path==='/prep/reverse'?fields(body,['operationId','expectedFingerprint','reason','requestId'])&&hash(body.expectedFingerprint)&&reason(body.reason)&&operationId(body.requestId)
    :fields(body,['operationId','outputInventoryId','qty','branch','declaredName','expectedIssueFingerprint','skipReason','cashier','reason','note'],['operationId','outputInventoryId','qty','branch','declaredName','expectedIssueFingerprint','skipReason','cashier'])&&prepId(body.outputInventoryId)&&quantity&&branch(body.branch)&&label(body.declaredName)&&hash(body.expectedIssueFingerprint)&&body.skipReason==='SkipForNow'&&(body.reason===undefined||reason(body.reason))&&(body.note===undefined||note(body.note));
   if(!valid)fail(400,'prep/invalid-request','Review the exact saved item, quantity, branch and original prep reference before continuing.');
   await store.rateOwner?.(actor.uid);return response(200,await execute(path,body,actor));
  }catch(error){if(error instanceof PrepRequestError||error?.code==='prep/rate-limit'&&error.status===429)return response(error.status,{code:error.code,message:error.message,...(error.review?{review:error.review}:{})});return response(503,{code:'prep/unavailable',message:'Prep could not be verified. Nothing further was confirmed. Retry the same details or ask HQ to review the saved operation.'});}
 };
}
