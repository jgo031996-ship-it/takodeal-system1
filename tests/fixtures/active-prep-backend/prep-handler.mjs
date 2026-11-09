import {createHash} from 'node:crypto';
import {planPrepBatch,planPrepReversal,prepCanonical,prepId,PREP_VERSION} from './prep-model.mjs';
import {resolveHQAccount,savedPin} from './relief-core/hq-account-model.js';
import {activeAccessStaff} from './access-model.mjs';
export const PREP_OWNER='jgo031996@gmail.com',PREP_ORIGIN='https://takodeal-owner.vercel.app',PREP_CASHIER_ORIGIN='https://takodeal-cashier.vercel.app',PREP_MAX_BYTES=4096;
const routes=new Set(['/prep/preview','/prep/commit','/prep/reversal-preview','/prep/reverse']);
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
const fields=(value,keys,required=keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const fingerprint=value=>createHash('sha256').update(prepCanonical(value)).digest('hex'),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inactive=row=>!row||row.active===false||row.blocked===true||row.archived===true||row.deleted===true||/^(inactive|disabled|archived|deleted|blocked|revoked|closed)$/i.test(row.status||'');
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const operationId=value=>prepId(value)&&value.length>=8&&value.length<=96;
const reason=value=>typeof value==='string'&&value.trim().length>=8&&value.length<=1000&&!/[\u0000-\u001f\u007f]/.test(value);
const model=work=>{try{return work();}catch(error){fail(409,'prep/review-required',error.message);}};
const planFields=['version','kind','branch','outputInventoryId','outputName','qty','purchaseUnit','outputBaseQuantity','effects','recipe'];
const trustedOwner=actor=>actor.email?.toLowerCase()===PREP_OWNER&&actor.email_verified===true&&actor.firebase?.sign_in_provider==='google.com';
const actorFields=actor=>actor.prepApp==='cashier'?{actorUid:actor.uid,actorEmail:actor.email||'',actorType:'cashier',staffId:actor.cashier.staffId,deviceId:actor.cashier.deviceId,sessionId:actor.cashier.sessionId}:{actorUid:actor.uid,actorEmail:PREP_OWNER};
const savedActorKey=row=>row.actorType==='cashier'?{actorUid:row.actorUid,staffId:row.staffId,deviceId:row.deviceId,sessionId:row.sessionId}:{actorUid:row.actorUid};
const actorKey=actor=>savedActorKey(actorFields(actor));
const validSavedActor=row=>prepId(row.actorUid)&&(row.actorType==='cashier'?prepId(row.staffId)&&prepId(row.deviceId)&&prepId(row.sessionId)&&row.sessionId.length>=16&&typeof row.actorEmail==='string':row.actorEmail===PREP_OWNER);
function savedOperation(row,id){
 const plan=Object.fromEntries(planFields.map(key=>[key,row[key]])),intent={outputInventoryId:row.outputInventoryId,qty:row.qty,reason:row.reason};
 if(row.version!==1||row.kind!=='owner-prep'||row.operationId!==id||!validSavedActor(row)||typeof row.reason!=='string'||!hash(row.intentHash)||!hash(row.expectedFingerprint)||!Array.isArray(row.effects)||row.effects.length<2||row.effects.length>31||row.intentHash!==fingerprint(intent)||row.expectedFingerprint!==fingerprint({plan,intent,...savedActorKey(row)}))fail(409,'prep/audit-incomplete','The saved prep movement audit is incomplete or changed. HQ must review a documented stock correction.');
}
function savedQuote(row,id){if(row.version!==1||row.kind!=='owner-prep-quote'||row.operationId!==id||!validSavedActor(row)||!Number.isSafeInteger(row.expiresAt)||!fields(row.intent,['outputInventoryId','qty','reason'])||!plain(row.plan)||!hash(row.intentHash)||!hash(row.expectedFingerprint)||row.intentHash!==fingerprint(row.intent)||row.expectedFingerprint!==fingerprint({plan:row.plan,intent:row.intent,...savedActorKey(row)}))fail(409,'prep/quote-incomplete','The saved prep preview needs HQ review. No stock changes were confirmed.');}
async function authority(tx,actor,branch,now){
 if(actor.prepApp==='cashier'){
  const session=await tx.get('staff_login_sessions',actor.uid),context=actor.cashier,expires=session?.expiresAt?.toMillis?.()??Date.parse(session?.expiresAt||'');
  if(!session||session.schemaVersion!==1||session.uid!==actor.uid||session.app!=='cashier'||session.staffId!==context.staffId||session.deviceId!==context.deviceId||session.sessionId!==context.sessionId||!Number.isFinite(expires)||expires<=now()||branch!=null&&session.branch!==branch)fail(403,'prep/staff-session-required','Sign in again on this approved Cashier device before preparing stock.');
  const profile=await tx.get('cashiers',session.staffId);if(!activeAccessStaff(profile)||profile.accessRevision!==session.profileRevision)fail(403,'prep/staff-session-required','The selected employee changed. Sign in again before preparing stock.');
  if(trustedOwner(actor)){const mirrors=await tx.deviceRecords(context.deviceId);if(mirrors.length!==1||mirrors[0].status!=='Active'||mirrors[0].branch!==session.branch||String(mirrors[0].appType||'').trim().toLowerCase()==='staff')fail(403,'prep/device-required','This Cashier device needs HQ approval.');}
  else{const binding=await tx.get('pos_bindings',actor.uid);if(!binding||binding.uid!==actor.uid||binding.status!=='Active'||binding.deviceId!==context.deviceId||binding.branch!==session.branch||!prepId(binding.legacyDeviceDocId))fail(403,'prep/device-required','This Cashier device needs HQ approval.');const mirror=await tx.get('pos_devices',binding.legacyDeviceDocId);if(!mirror||mirror.status!=='Active'||mirror.deviceId!==context.deviceId||mirror.branch!==session.branch||String(mirror.appType||'').trim().toLowerCase()==='staff')fail(403,'prep/device-required','This Cashier device needs HQ approval.');}
  actor.prepActorName=profile.cashierName;
  if(!trustedOwner(actor)){if(branch!=null){const branches=await tx.branchRecords(branch);if(branches.length!==1||inactive(branches[0]))fail(409,'prep/branch-unavailable','Choose one active saved branch.');}return;}
 }
 const records=await tx.ownerRecords();if(!records.length||records.some(row=>row.email?.toLowerCase()!==PREP_OWNER||inactive(row)||row.uid&&row.uid!==actor.uid))fail(403,'prep/owner-unavailable','HQ must confirm this active Owner account before changing prep.');
 let account;try{account=resolveHQAccount(records.map(row=>({id:row.id,data:row})));}catch{fail(403,'prep/owner-unavailable','HQ must resolve the saved Owner account before changing prep.');}
 if(inactive(account)||/^(REVOKED|BLOCKED)$/i.test(savedPin(account))||/franchise/i.test(account.role||''))fail(403,'prep/owner-unavailable','HQ must confirm this active Owner account before changing prep.');
 if(branch!=null){const branches=await tx.branchRecords(branch);if(branches.length!==1||branches[0].name!==branch||inactive(branches[0]))fail(409,'prep/branch-unavailable','Choose one active, unambiguous saved branch.');}
}
async function freshPlan(tx,input,assertBranch){
 const output=await tx.get('inventory',input.outputInventoryId);if(!output)fail(409,'prep/item-unavailable','The prepared stock item is missing. Refresh inventory.');
 await assertBranch(output.branch);
 const recipes=await tx.recipeRows(output.name),ingredients=[];
 for(const name of [...new Set(recipes.map(row=>row.ingredientName))]){if(typeof name!=='string'||!name)fail(409,'prep/recipe-unavailable','A saved recipe ingredient needs review.');const rows=await tx.ingredientRows(output.branch,name);if(rows.length!==1)fail(409,'prep/recipe-unavailable','Each recipe ingredient needs one exact stock record in this branch.');ingredients.push(rows[0]);}
 return model(()=>planPrepBatch({output,recipes,ingredients,qty:input.qty}));
}
const view=(operationId,plan,extra={})=>({operationId,branch:plan.branch,outputInventoryId:plan.outputInventoryId,outputName:plan.outputName,qty:plan.qty,purchaseUnit:plan.purchaseUnit,outputBaseQuantity:plan.outputBaseQuantity,effects:plan.effects,...extra});
export function createPrepHandler({verifyToken,store,now=Date.now}={}){
 if(typeof verifyToken!=='function'||typeof store?.transaction!=='function')throw Error('Trusted Owner authentication and prep transactions are required.');
 async function execute(path,input,actor){return store.transaction(async tx=>{
  await authority(tx,actor,undefined,now);
  const op=await tx.get('prep_operations',input.operationId);
  if(op)savedOperation(op,input.operationId);
  if(path==='/prep/preview'){
   const intent={outputInventoryId:input.outputInventoryId,qty:input.qty,reason:input.reason||''},intentHash=fingerprint(intent);
   if(op){await authority(tx,actor,op.branch,now);if(prepCanonical(savedActorKey(op))!==prepCanonical(actorKey(actor))||op.intentHash!==intentHash)fail(409,'prep/operation-conflict','This prep reference belongs to different confirmed details.');return view(op.operationId,op,{alreadySaved:true,canCommit:false,expectedFingerprint:op.expectedFingerprint});}
   const old=await tx.get('prep_quotes',input.operationId),expiresAt=now()+10*60*1000;
   if(old)savedQuote(old,input.operationId);
   if(old&&(prepCanonical(savedActorKey(old))!==prepCanonical(actorKey(actor))||old.intentHash!==intentHash))fail(409,'prep/operation-conflict','This prep reference belongs to different confirmed details.');
   const close=async(message,expired=false)=>{await authority(tx,actor,old.plan.branch,now);if(old.status!=='closed')tx.closeQuote(input.operationId);return view(input.operationId,old.plan,{canCommit:false,notSaved:true,quoteClosed:true,expired,blockers:[message]});};
   if(old&&(old.status==='closed'||old.expiresAt<=now()))return close('The earlier preview is closed. No prep was saved under this reference. Start a fresh review.',old.expiresAt<=now());
   let plan;try{plan=await freshPlan(tx,input,branch=>authority(tx,actor,branch,now));}catch(error){if(old&&error.status===409)return close(error.message);throw error;}
   await authority(tx,actor,plan.branch,now);const expectedFingerprint=fingerprint({plan,intent,...actorKey(actor)});
   if(old){if(old.expectedFingerprint!==expectedFingerprint)return close('Stock, units or the recipe changed. The earlier preview is closed without preparing stock.');return view(input.operationId,plan,{canCommit:true,expectedFingerprint,expiresAt:old.expiresAt});}
   tx.createQuote(input.operationId,{version:PREP_VERSION,kind:'owner-prep-quote',operationId:input.operationId,...actorFields(actor),intent,intentHash,plan,expectedFingerprint,expiresAt,createdAt:tx.serverTimestamp()});
   return view(input.operationId,plan,{canCommit:true,expectedFingerprint,expiresAt});
  }
  if(path==='/prep/commit'){
   if(op){await authority(tx,actor,op.branch,now);if(prepCanonical(savedActorKey(op))!==prepCanonical(actorKey(actor))||op.expectedFingerprint!==input.expectedFingerprint)fail(409,'prep/operation-conflict','This prep reference belongs to different confirmed details.');return view(op.operationId,op,{saved:true,alreadySaved:true});}
   const quote=await tx.get('prep_quotes',input.operationId);if(quote)savedQuote(quote,input.operationId);if(!quote||prepCanonical(savedActorKey(quote))!==prepCanonical(actorKey(actor))||quote.expectedFingerprint!==input.expectedFingerprint||quote.status==='closed'||quote.expiresAt<=now())fail(409,'prep/quote-changed','The prep preview expired or changed. Nothing was prepared by this attempt. Retry its same item and quantity to confirm the saved result before starting a fresh review.');
   const plan=await freshPlan(tx,quote.intent,branch=>authority(tx,actor,branch,now));await authority(tx,actor,plan.branch,now);
   if(fingerprint({plan,intent:quote.intent,...actorKey(actor)})!==input.expectedFingerprint||prepCanonical(plan)!==prepCanonical(quote.plan))fail(409,'prep/source-changed','Stock, units or the recipe changed after your preview. Nothing was prepared; review it again.');
   const record={...plan,operationId:input.operationId,intentHash:quote.intentHash,expectedFingerprint:input.expectedFingerprint,reason:quote.intent.reason,...actorFields(actor),committedAt:tx.serverTimestamp(),outputLogId:'prep-'+input.operationId+'-0'};
   for(const [index,effect]of plan.effects.entries()){tx.updateStock(effect.id,effect.beforeUpdateTime,effect.afterStock);tx.createLog('prep-'+input.operationId+'-'+index,{version:1,prepOperationId:input.operationId,branch:plan.branch,inventoryId:effect.id,item:effect.name,uom:effect.unit,oldQty:effect.beforeStock,newQty:effect.afterStock,variance:effect.delta,type:index===0?(actor.prepApp==='cashier'?'End-of-Shift Kitchen Prep':'Manager Prep Batch'):'Kitchen Prep Ingredient',...(index===0?{purchQty:plan.qty,purchUom:plan.purchaseUnit}:{}),note:index===0?(actor.prepApp==='cashier'?'Cashier-confirmed audited prep':'Owner-confirmed audited prep'):'Ingredient used in '+plan.outputName,user:actor.prepActorName||PREP_OWNER,...actorFields(actor),timestamp:tx.serverTimestamp()});}
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
  for(const [index,effect]of plan.effects.entries()){tx.updateStock(effect.id,effect.beforeUpdateTime,effect.afterStock);tx.createLog('prep-reverse-'+input.operationId+'-'+index,{version:1,prepOperationId:input.operationId,prepReversalId:input.operationId,branch:plan.branch,inventoryId:effect.id,item:effect.name,uom:effect.unit,oldQty:effect.beforeStock,newQty:effect.afterStock,variance:effect.delta,type:'Owner Prep Reversal',note:input.reason,user:PREP_OWNER,timestamp:tx.serverTimestamp()});}
  tx.createReversal(input.operationId,{...plan,actorUid:actor.uid,actorEmail:PREP_OWNER,requestId:input.requestId,reason:input.reason,expectedFingerprint,recordedAt:tx.serverTimestamp()});
  return view(op.operationId,op,{saved:true,alreadyReversed:false,requestId:input.requestId});
 });}
 return async request=>{
  const origin=request.origin,response=(status,body)=>({status,body,headers:{'Cache-Control':'no-store','Content-Type':'application/json','X-Takodeal-Prep-Version':'1',Vary:'Origin',...([PREP_ORIGIN,PREP_CASHIER_ORIGIN].includes(origin)?{'Access-Control-Allow-Origin':origin}:{})}});
  try{
   if(![PREP_ORIGIN,PREP_CASHIER_ORIGIN].includes(origin)||origin===PREP_CASHIER_ORIGIN&&!['/prep/preview','/prep/commit'].includes(request.path))fail(403,'prep/origin-required','Open prep review in the approved Owner app.');
   if(!routes.has(request.path))fail(404,'prep/route-unavailable','This prep action is unavailable.');
   if(request.method==='OPTIONS'){if(request.preflightMethod!=='POST'||String(request.preflightHeaders||'').split(',').map(value=>value.trim().toLowerCase()).some(value=>!['authorization','content-type'].includes(value)))fail(403,'prep/preflight-denied','Use the approved Owner app.');return {...response(204,null),headers:{...response(204,null).headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}};}
   if(request.method!=='POST'||Object.keys(request.query||{}).length||!/^application\/json(?:;|$)/i.test(request.contentType||'')||!Number.isSafeInteger(request.rawSize)||request.rawSize<1||request.rawSize>PREP_MAX_BYTES||Buffer.byteLength(JSON.stringify(request.body||{}))>PREP_MAX_BYTES)fail(400,'prep/invalid-request','The prep request is incomplete or too large.');
   const token=/^Bearer ([^\s]{20,8192})$/.exec(request.authorization||'')?.[1];if(!token)fail(401,'prep/token-required','Sign in with the verified Owner account.');let actor;try{actor=await verifyToken(token,true);}catch{fail(401,'prep/token-required','Sign in again to confirm the Owner account.');}
   if(!prepId(actor?.uid)||(origin===PREP_CASHIER_ORIGIN&&actor.firebase?.sign_in_provider==='anonymous'?false:actor.email?.toLowerCase()!==PREP_OWNER||actor.email_verified!==true||actor.firebase?.sign_in_provider!=='google.com'))fail(403,'prep/owner-required','Only the verified Google Owner may confirm prep or its reversal.');
   const body=request.body,path=request.path,cashierOrigin=origin===PREP_CASHIER_ORIGIN;
   if(cashierOrigin){if(!fields(body?.cashier,['staffId','deviceId','sessionId'])||!prepId(body.cashier.staffId)||!prepId(body.cashier.deviceId)||!prepId(body.cashier.sessionId)||body.cashier.sessionId.length<16)fail(400,'prep/staff-session-required','Sign in to the exact employee account on this Cashier device.');actor={...actor,prepApp:'cashier',cashier:body.cashier};}
   if(!operationId(body?.operationId)||path==='/prep/preview'&&(!fields(body,['operationId','outputInventoryId','qty','reason',...(cashierOrigin?['cashier']:[])],['operationId','outputInventoryId','qty'])||!prepId(body.outputInventoryId)||typeof body.qty!=='number'||!Number.isFinite(body.qty)||body.qty<=0||body.qty>1e6||body.reason!=null&&!reason(body.reason))||path==='/prep/commit'&&(!fields(body,['operationId','expectedFingerprint',...(cashierOrigin?['cashier']:[])])||!hash(body.expectedFingerprint))||path==='/prep/reversal-preview'&&!fields(body,['operationId'])||path==='/prep/reverse'&&(!fields(body,['operationId','expectedFingerprint','reason','requestId'])||!hash(body.expectedFingerprint)||!reason(body.reason)||!operationId(body.requestId)))fail(400,'prep/invalid-request','Review the exact saved prep details and use an 8–1,000 character reason for reversal.');
   await store.rateOwner?.(actor.uid);return response(200,await execute(path,body,actor));
  }catch(error){return response(error.status||503,{code:error.code||'prep/unavailable',message:error.status?error.message:'Prep could not be verified. Nothing further was confirmed. Retry the same details or ask HQ to review the saved operation.'});}
 };
}
