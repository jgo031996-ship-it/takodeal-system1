import {randomBytes} from 'node:crypto';
import {accessId,accessDevice,accessDocumentId,activeAccessStaff} from './access-model.mjs';
import {CASHIER_VOID_VERSION,canonicalCashierVoidJSON,voidHash,voidDigest,voidRevision,voidMillis,voidText,voidFields,voidFail,voidHold,verifyVoidSource,voidEffects,verifyReplacementPayload,replacementReceiptMatches} from './cashier-void-model.mjs';
import {createCashierVoidHistoricalReader} from './cashier-void-history.mjs';

const TABLES=Object.freeze({quotes:'cashier_void_quotes',operations:'cashier_void_operations',sources:'cashier_void_sources'});
const actorKey=(actor,body)=>({uid:actor.uid,staffId:body.staffId,deviceId:body.deviceId,branch:body.branch});
const intent=body=>({saleId:body.saleId,receiptId:body.receiptId,shiftId:body.shiftId,reason:body.reason});
const keyFor=(uid,id)=>voidDigest(uid+'\0'+id),sourceKey=body=>voidDigest(body.branch+'\0'+body.saleId);
const same=(a,b)=>canonicalCashierVoidJSON(a)===canonicalCashierVoidJSON(b);
const deny=()=>voidFail(403,'approval-required','This tablet or employee setup is not confirmed for receipt changes. Ask the Owner to review its protected Cashier approval or sign in again as yourself. Keep any saved receipt or void reference; normal Cashier work is unchanged.');
const data=snap=>snap?.exists?snap.data():null;
const wrapped=snap=>snap?.exists?{data:snap.data(),createTime:snap.createTime,updateTime:snap.updateTime}:null;
const safeNumber=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12;
function owned(record,actor,body){
 if(record.schemaVersion!==1||record.operationId!==body.operationId||!same(record.actor,actorKey(actor,body))||!same(record.intent,intent(body))||record.intentHash!==voidHash(intent(body)))voidFail(409,'operation-conflict','This void reference belongs to a different employee, receipt, shift, or reason. Keep the original reference and ask the Owner to review it.');
}
function view(record,body,{replacementState,blockers=[]}={}){
 const saved=record?.state==='saved',quote=record?.kind==='cashier-void-quote';
 let replacement=null;if(record?.replacement){const claim=record.checkoutClaim,draft=record.draftClaim;replacement={saleId:record.replacement.saleId,receiptId:record.replacement.receiptId,claimToken:record.replacement.claimToken,cart:record.source.cart,state:replacementState||(record.abandonment?'abandoned':claim?'claimed':draft?'draft':'unclaimed'),restoreAttemptId:draft?.restoreAttemptId||record.abandonment?.restoreAttemptId||null,checkoutAttemptId:claim?.checkoutAttemptId||null,payloadHash:claim?.payloadHash||null,blockers};}
 return {schemaVersion:1,operationId:body.operationId,sourceSaleId:body.saleId,sourceReceiptId:body.receiptId,branch:body.branch,shiftId:body.shiftId,reason:body.reason,state:saved?'saved':quote?'preview':record?.state==='cancelled'?'cancelled':'unknown',sourceFingerprint:record?.sourceFingerprint||null,expectedFingerprint:record?.expectedFingerprint||null,expiresAt:quote?record.expiresAt:null,source:record?.source||null,effects:(record?.effects||[]).map(({revision,...effect})=>effect),replacement};
}
export function createCashierVoidStore(db,{serverTimestamp,now=Date.now,randomToken=()=>randomBytes(32).toString('hex'),historicalReader=createCashierVoidHistoricalReader(db,{now})}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted Cashier void database and clock are required.');
 async function rate(uid){
  const slot=Math.floor(now()/600000),ref=db.doc('cash_remittance_attempts/cashier-void-'+voidDigest(uid));
  return db.runTransaction(async tx=>{const row=data(await tx.get(ref));if(row&&(!Number.isSafeInteger(row.slot)||!Number.isSafeInteger(row.count)||row.count<0||row.slot>slot))voidFail(429,'rate-limit','Void checks are temporarily held. Wait a few minutes before checking the same operation again.');const count=row?.slot===slot?row.count:0;if(count>=120)voidFail(429,'rate-limit','Too many void checks. Wait a few minutes and retry the same reference.');tx.set(ref,{purpose:'cashier-void',slot,count:count+1,expiresAt:new Date((slot+2)*600000)});});
 }
 async function execute(path,body,actor){return db.runTransaction(async tx=>{
  // All authority, source, inventory, and claim reads happen in this SAME Admin
  // transaction; optimistic retries cannot adopt a revoked device or closed shift.
  const read=async(table,id)=>{if(!accessDocumentId(id))voidHold('The saved source reference is invalid.');return wrapped(await tx.get(db.doc(table+'/'+id)));};
  const session=(await read('staff_login_sessions',actor.uid))?.data;
  if(!accessId(actor.uid)||actor.firebase?.sign_in_provider!=='anonymous'||!session||session.schemaVersion!==1||session.uid!==actor.uid||session.app!=='cashier'||session.staffId!==body.staffId||session.deviceId!==body.deviceId||session.branch!==body.branch||session.sessionId!==body.sessionId||!Number.isFinite(voidMillis(session.expiresAt))||voidMillis(session.expiresAt)<=now())deny();
  const profile=await read('cashiers',body.staffId);if(!activeAccessStaff(profile?.data)||!voidRevision(profile.updateTime)||session.profileRevision!==voidRevision(profile.updateTime))deny();
  const binding=(await read('pos_bindings',actor.uid))?.data;
  if(!binding||binding.uid!==actor.uid||binding.status!=='Active'||binding.deviceId!==body.deviceId||binding.branch!==body.branch||!accessId(binding.legacyDeviceDocId))deny();
  const mirror=(await read('pos_devices',binding.legacyDeviceDocId))?.data;if(!mirror||mirror.status!=='Active'||mirror.deviceId!==body.deviceId||mirror.branch!==body.branch||String(mirror.appType||'').trim().toLowerCase()==='staff'||mirror.uid&&mirror.uid!==actor.uid)deny();
  const actorIdentity=actorKey(actor,body),operationKey=keyFor(actor.uid,body.operationId),operationRef=db.doc(TABLES.operations+'/'+operationKey),quoteRef=db.doc(TABLES.quotes+'/'+operationKey),sourceRef=db.doc(TABLES.sources+'/'+sourceKey(body));
  const operation=data(await tx.get(operationRef));if(operation)owned(operation,actor,body);
  const quote=data(await tx.get(quoteRef));if(quote)owned(quote,actor,body);
  const shift=await read('shifts',body.shiftId),shiftIsOpen=()=>Boolean(shift?.data&&shift.data.branch===body.branch&&shift.data.active===true&&[undefined,'Open'].includes(shift.data.status)&&(shift.data.shiftId===undefined||shift.data.shiftId===body.shiftId)&&Number.isSafeInteger(shift.data.salesRevision??0)&&(shift.data.salesRevision??0)>=0),openShift=()=>{
   if(!shiftIsOpen())voidHold('The original shift is closed or changed. The Owner must review any void or replacement.');
   return shift.data.salesRevision??0;
  };
  async function replacementState(record,{allowClosed=false}={}){
   if(!record.replacement)return {state:undefined,blockers:[]};
   const receipt=await read('transactions',record.replacement.saleId),marker=await read('pos_sale_commits',record.replacement.saleId);
   if(receipt||marker){
    if(record.checkoutClaim&&receipt&&marker&&replacementReceiptMatches(receipt,marker,record.checkoutClaim))return {state:'committed',blockers:[]};
    return {state:'conflict',blockers:['A replacement record already exists but its exact confirmed checkout could not be proved. Keep the original reference and ask the Owner to review it.']};
   }
   if(record.abandonment)return {state:'abandoned',blockers:[]};
   if(!allowClosed&&!shiftIsOpen())return {state:'conflict',blockers:['The original shift is closed or changed. The Owner must review any replacement.']};
   return {state:record.checkoutClaim?'claimed':record.draftClaim?'draft':'unclaimed',blockers:[]};
  }
  if(operation){
   if(operation.kind!=='cashier-void-operation'||!['saved','cancelled'].includes(operation.state))voidHold('The saved void outcome needs Owner review.');
   if(path==='/cashier-void/preview'||path==='/cashier-void/status'||path==='/cashier-void/cancel'||path==='/cashier-void/commit'){
    if(path==='/cashier-void/commit'&&(operation.expectedFingerprint!==body.expectedFingerprint||operation.initiatingSessionId!==body.sessionId))voidFail(409,'operation-conflict','Use the original confirmed void reference. A different preview cannot replace it.');
    const replacement=await replacementState(operation);return view(operation,body,{replacementState:replacement.state,blockers:replacement.blockers});
   }
   if(path==='/cashier-void/replacement-claim'){
    if(operation.state!=='saved'||operation.intent.reason!=='WrongPunched'||!operation.replacement||operation.expectedFingerprint!==body.expectedFingerprint||body.claimToken!==operation.replacement.claimToken)voidHold('This saved void does not authorize a replacement checkout.');
    const replacement=await replacementState(operation,{allowClosed:body.phase==='abandon'});
    if(['conflict','committed','abandoned'].includes(replacement.state))return view(operation,body,{replacementState:replacement.state,blockers:replacement.blockers});
    if(operation.draftClaim&&operation.draftClaim.restoreAttemptId!==body.restoreAttemptId)voidFail(409,'draft-owned','This correction is already open in its original tab. Resume that exact draft or ask the Owner to review it.');
    if(body.phase==='abandon'){
     if(operation.checkoutClaim)voidFail(409,'replacement-held','A checkout is already claimed or awaiting confirmation. Keep that exact receipt and check its status; it cannot be discarded as an unpaid draft.');
     const abandonment={restoreAttemptId:body.restoreAttemptId,sessionId:body.sessionId,actorUid:actor.uid,abandonedAt:serverTimestamp()};tx.update(operationRef,{abandonment});operation.abandonment=abandonment;return view(operation,body);
    }
    openShift();
    if(body.phase==='draft'){
     if(!operation.draftClaim){const draftClaim={restoreAttemptId:body.restoreAttemptId,sessionId:body.sessionId,claimedAt:serverTimestamp()};tx.update(operationRef,{draftClaim});operation.draftClaim=draftClaim;}
     return view(operation,body);
    }
    if(!operation.draftClaim)voidHold('Claim the original correction draft before starting its checkout.');
    const prepared=verifyReplacementPayload(body.payload,operation,profile.data.cashierName);
    if(prepared.checkoutAttemptId!==body.checkoutAttemptId)voidHold('The checkout attempt changed. Keep the original saved draft.');
    if(operation.checkoutClaim){if(operation.checkoutClaim.checkoutAttemptId!==prepared.checkoutAttemptId||operation.checkoutClaim.payloadHash!==prepared.payloadHash)voidFail(409,'replacement-conflict','A different replacement checkout is already reserved. Do not take another payment. Resume the original saved checkout or ask the Owner to review it.');return view(operation,body);}
    const checkoutClaim={...prepared,restoreAttemptId:body.restoreAttemptId,sessionId:body.sessionId,claimedAt:serverTimestamp()};tx.update(operationRef,{checkoutClaim});operation.checkoutClaim=checkoutClaim;return view(operation,body);
   }
  }
  if(path==='/cashier-void/status')return view(quote,body);
  if(path==='/cashier-void/cancel'){
   const cancelled={schemaVersion:1,kind:'cashier-void-operation',operationId:body.operationId,actor:actorIdentity,initiatingSessionId:body.sessionId,intent:intent(body),intentHash:voidHash(intent(body)),state:'cancelled',cancelledAt:serverTimestamp()};tx.create(operationRef,cancelled);return view(cancelled,body);
  }
  if(path==='/cashier-void/replacement-claim')voidHold('The original void is not confirmed. Retry its exact saved reference before starting a replacement.');
  if(path==='/cashier-void/commit'&&!quote)voidFail(409,'preview-changed','Open and confirm the original receipt preview before voiding it.');
  const salesRevision=openShift(),source=await read('transactions',body.saleId),marker=await read('pos_sale_commits',body.saleId),priorSource=data(await tx.get(sourceRef));
  if(priorSource)voidFail(409,'source-already-voided','This receipt was already handled by another void operation. No replacement cart may be restored from this attempt.');
  const proof=verifyVoidSource({source,marker,...intent(body),branch:body.branch}),saleTime=voidMillis(source.data.timestamp),shiftStart=voidMillis(shift.data.startTime);
  if(!Number.isFinite(saleTime)||!Number.isFinite(shiftStart)||saleTime<shiftStart||saleTime>now()+300000)voidHold('The receipt timestamp does not belong to this open shift. Ask the Owner to review it.');
  const audit=await read('settings','audit_'+encodeURIComponent(body.branch).replace(/\./g,'%2E'));
  if(proof.inventoryState==='applied'&&audit?.data.active===true)voidHold('A physical stock count is active. Finish that count or ask the Owner before returning stock.');
  const inventory=[];if(proof.inventoryState==='applied')for(const movement of proof.movements){const row=await read('inventory',movement.inventoryId);if(row?.data.branch!==body.branch)voidHold('A saved ingredient belongs to another branch. Ask the Owner to review it.');inventory.push(row);}
  const missingUnits=proof.movements.filter(row=>!row.unitSnapshot);
  const unitProof=proof.inventoryState==='applied'&&missingUnits.length?(quote?.unitProof||await historicalReader({sourceTime:source.createTime,branch:body.branch,movements:missingUnits})):[];
  const effects=voidEffects(proof,inventory,unitProof),sourceView={netTotal:proof.netTotal,inventoryState:proof.inventoryState,cart:proof.cart};
  const plan={actor:actorIdentity,sessionId:body.sessionId,intent:intent(body),sourceFingerprint:proof.fingerprint,sourceRevision:proof.revision,shiftRevision:voidRevision(shift.updateTime),salesRevision,auditRevision:audit?voidRevision(audit.updateTime):'',unitProof,effects};
  const expectedFingerprint=voidHash(plan);
  if(path==='/cashier-void/preview'){
   if(quote){if(quote.expectedFingerprint!==expectedFingerprint||quote.initiatingSessionId!==body.sessionId||quote.expiresAt<=now())voidFail(409,'preview-changed','The receipt, stock, shift, or preview changed. Cancel this reference and start a fresh review.');return view(quote,body);}
   const record={schemaVersion:1,kind:'cashier-void-quote',operationId:body.operationId,actor:actorIdentity,initiatingSessionId:body.sessionId,intent:intent(body),intentHash:voidHash(intent(body)),sourceFingerprint:proof.fingerprint,expectedFingerprint,source:sourceView,effects,unitProof,expiresAt:now()+5*60000,createdAt:serverTimestamp()};tx.create(quoteRef,record);return view(record,body);
  }
  if(!quote||quote.expiresAt<=now()||quote.expectedFingerprint!==body.expectedFingerprint||quote.expectedFingerprint!==expectedFingerprint||quote.initiatingSessionId!==body.sessionId)voidFail(409,'preview-changed','The confirmed preview expired or changed. Cancel this reference and review the original receipt again. Nothing further was voided by this attempt.');
  const stats=proof.balls>0?await read('settings','global_stats'):null;if(proof.balls>0&&(!stats?.data||!safeNumber(stats.data.totalTakoyakiBalls)||!safeNumber(stats.data['balls_'+body.branch])||stats.data.totalTakoyakiBalls<proof.balls||stats.data['balls_'+body.branch]<proof.balls))voidHold('The saved sales counters need Owner review before this void can be recorded.');
  const suffix=voidDigest(body.branch+'\0'+body.saleId),replacement=body.reason==='WrongPunched'?{saleId:'sale-voidfix-'+suffix,receiptId:'FIX-'+suffix.slice(0,32).toUpperCase(),claimToken:randomToken()}:null;
  if(replacement){if(!/^[a-f0-9]{64}$/.test(replacement.claimToken))throw Error('A secure replacement token is required.');if(await read('transactions',replacement.saleId)||await read('pos_sale_commits',replacement.saleId))voidHold('The reserved correction receipt already exists. Ask the Owner to review it before any replacement payment.');}
  const at=serverTimestamp(),record={schemaVersion:CASHIER_VOID_VERSION,kind:'cashier-void-operation',operationId:body.operationId,actor:actorIdentity,actorName:profile.data.cashierName,initiatingSessionId:body.sessionId,intent:intent(body),intentHash:quote.intentHash,state:'saved',sourceFingerprint:proof.fingerprint,expectedFingerprint,source:sourceView,effects,replacement,committedAt:at};
  // Every read above precedes the first write. The shift write serializes with
  // close/count/other voids, and all stock/log/counter/audit effects commit once.
  for(const effect of effects){tx.update(db.doc('inventory/'+effect.id),{currentStock:effect.afterStock});tx.create(db.doc('stock_logs/void-'+sourceKey(body)+'-'+voidDigest(effect.id)),{schemaVersion:1,branch:body.branch,inventoryId:effect.id,sourceSaleId:body.saleId,sourceReceiptId:body.receiptId,operationId:body.operationId,voidReason:body.reason,item:effect.name,uom:effect.unit,oldQty:effect.beforeStock,newQty:effect.afterStock,variance:effect.quantity,type:'Transaction Voided',note:'Original saved deduction reversed · '+body.reason,user:profile.data.cashierName,actorUid:actor.uid,staffId:body.staffId,deviceId:body.deviceId,timestamp:at});}
  tx.update(db.doc('transactions/'+body.saleId),{status:'Voided',voidedBy:profile.data.cashierName,voidTime:at,inventoryState:proof.inventoryState==='applied'?'reversed':'cancelled',voidOperationId:body.operationId,voidReason:body.reason,voidActorUid:actor.uid,voidStaffId:body.staffId});
  if(proof.balls>0)tx.update(db.doc('settings/global_stats'),{totalTakoyakiBalls:stats.data.totalTakoyakiBalls-proof.balls,['balls_'+body.branch]:stats.data['balls_'+body.branch]-proof.balls,lastSaleId:body.saleId,lastSaleBranch:body.branch,lastSaleDirection:-1});
  tx.update(db.doc('shifts/'+body.shiftId),{salesRevision:salesRevision+1});
  tx.create(db.doc('manager_alerts/void-'+sourceKey(body)),{type:'VOID_ALERT',schemaVersion:1,branch:body.branch,shiftId:body.shiftId,saleId:body.saleId,receiptId:body.receiptId,operationId:body.operationId,voidReason:body.reason,cashier:profile.data.cashierName,staffId:body.staffId,actorUid:actor.uid,message:'Receipt voided: '+body.reason+'. '+(effects.length?'Original saved stock deductions were returned.':'Unapplied stock deductions were cancelled; no stock was added.'),timestamp:at,isRead:false});
  tx.create(sourceRef,{schemaVersion:1,operationKey,operationId:body.operationId,actor:actorIdentity,intentHash:quote.intentHash,sourceFingerprint:proof.fingerprint,replacementSaleId:replacement?.saleId||null,committedAt:at});tx.create(operationRef,record);
  return view(record,body);
 });}
 return {rate,execute};
}
