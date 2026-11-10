import {webcrypto,createHash} from 'node:crypto';
import {isAccessOwner,accessDocumentId} from './access-model.mjs';
import {buildHQAccessIndex,HQ_SOURCE_ACCESS_FIELDS} from './company-access-index.mjs';
import {canonicalPaymentJSON as json,defaultReconciliationSettings,normalizeReconciliationSettings,normalizeStatementRows,normalizePaymentReceipt,paymentDayRange,paymentReceiptProjection,paymentSHA256,buildPaymentReconciliationPlan,PAYMENT_RECONCILIATION_LIMITS as LIMIT,reconciliationError,reconciliationSettingsInput,reconciliationVerifyInput} from './gcash-reconciliation-model.mjs';
const TABLE={settings:'payment_reconciliation_settings',imports:'payment_reconciliation_imports',rows:'payment_reconciliation_rows',receipts:'payment_reconciliation_receipts'};
const sourceFields=['branch','paymentMethod','netTotal','timestamp','status','paymentStatus','paymentVerified','paymentReconciliationVersion','paymentReconciliationId','isPendingSync','splitDetails','preparedCancellation','cancelledFoodSourceId','cancelled','canceled','refunded','refundAmount','paymentReference','platformOrderId','customerName'];
const data=snapshot=>snapshot?.exists?snapshot.data():null;
const denied=()=>{throw reconciliationError(403,'denied','Your current verified Owner account or branch access could not be confirmed.');};
const changed=message=>{throw reconciliationError(409,'changed',message||'Receipt evidence or matching settings changed. Prepare a fresh preview.');};
const fingerprint=value=>paymentSHA256(json(value),webcrypto);
const timestampParts=value=>{
 if(Number.isSafeInteger(value?.seconds)&&Number.isInteger(value?.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1e9)return[value.seconds,value.nanoseconds];
 if(value instanceof Date&&Number.isFinite(+value)){const seconds=Math.floor(+value/1000);return[seconds,(+value-seconds*1000)*1e6];}
 return null;
};

export function createGCashReconciliationStore(db,{serverTimestamp,now=Date.now}={}){
 if(typeof db?.runTransaction!=='function'||typeof db?.collection!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted reconciliation store is required.');
 const ref=(table,id)=>db.doc(table+'/'+id);
 async function authority(tx,actor,branches=[],{global=false}={}){
  if(!isAccessOwner(actor))denied();
  const email=actor.email.toLowerCase(),profiles=await tx.get(db.collection('hq_managers').select(...HQ_SOURCE_ACCESS_FIELDS,'pin','securityPin').limit(201));
  if(profiles.size>200)denied();
  const matching=profiles.docs.filter(row=>String(row.data().email||'').trim().toLowerCase()===email);if(matching.length!==1)denied();
  const source=matching[0],profile=source.data(),expected=buildHQAccessIndex([{id:source.id,data:profile}])[0];
  const [indexSnap,bridgeSnap]=await Promise.all([tx.get(ref('hq_account_index',email)),tx.get(ref('hq_email_access',email))]);
  const index=data(indexSnap),bridge=data(bridgeSnap);
  if(!accessDocumentId(source.id)||!expected?.active||String(expected.role).toLowerCase()!=='owner'||!index?.active||index.schemaVersion!==1||index.sourceProfileId!==source.id||['sourceAccess','permissions','allowedBranches','role'].some(key=>json(index[key])!==json(expected[key]))||bridge&&(bridge.active!==true||bridge.role&&bridge.role!==index.role)||[profile.pin,profile.securityPin].some(value=>/^(REVOKED|BLOCKED)$/i.test(String(value||''))))denied();
  const scoped=row=>Array.isArray(row?.permissions)&&row.permissions.includes('all')&&Array.isArray(row?.allowedBranches)&&(row.allowedBranches.includes('All')||!global&&branches.every(branch=>row.allowedBranches.includes(branch)));
  if(!scoped(index)||bridge&&!scoped(bridge))denied();
  for(const branch of [...new Set(branches)]){
   const saved=await tx.get(db.collection('branches').where('name','==',branch).limit(3));
   // Closed stores retain their historical receipts. Require an exact unique
   // registered branch and saved scope, without requiring it to be open today.
   if(saved.size!==1)denied();
  }
  return{uid:actor.uid,email};
 }
 async function assertSource(snapshot,claim){
  if(!snapshot?.exists)changed('A previously verified receipt is missing. Owner review is required.');
  const source={...snapshot.data(),id:claim.transactionId};
  const claimedAt=timestampParts(claim.verifiedAt),verifiedAt=timestampParts(source.verifiedAt);
  if(source.paymentVerified!==true||source.paymentReconciliationVersion!==1||source.paymentReconciliationId!==claim.claimId||source.paymentReconciliationFile!==claim.fileSha256||source.verifiedBy!==claim.verifiedByEmail||!claimedAt||!verifiedAt||json(claimedAt)!==json(verifiedAt)||await fingerprint(paymentReceiptProjection({...source,paymentVerified:false}))!==claim.sourceFingerprint)changed('A previously verified receipt changed or its flag was reset. Owner review is required.');
 }
 async function recover(tx,match,actor){
  const [rowSnap,receiptSnap,sourceSnap]=await Promise.all([tx.get(ref(TABLE.rows,match.claimId)),tx.get(ref(TABLE.receipts,match.transactionId)),tx.get(ref('transactions',match.transactionId))]);
  const row=data(rowSnap),receipt=data(receiptSnap);
  if(!row&&!receipt)return null;
  if(!row||!receipt||json(row)!==json(receipt)||row.schemaVersion!==1||row.claimId!==match.claimId||row.transactionId!==match.transactionId||row.sourceFingerprint!==match.sourceFingerprint)changed('The payment or receipt already belongs to a different saved verification.');
  await authority(tx,actor,[row.branch]);await assertSource(sourceSnap,row);
  return{transactionId:match.transactionId,claimId:match.claimId,alreadyVerified:true,fileSha256:row.fileSha256};
 }
 async function loadCandidates(rows,settings,scope,targets){
  const normalized=normalizeStatementRows(rows,settings,{scope:scope||undefined});
  const allScopes=new Set(normalized.filter(row=>row.eligible).map(row=>row.branch+'\0'+row.day));if(allScopes.size>LIMIT.scopes)changed('This file spans too many branch/day groups. Import a smaller reporting period.');
  const selected=new Set(targets.map(row=>row.rowId)),scopes=[...new Map(normalized.filter(row=>row.eligible&&selected.has(row.rowId)).map(row=>[row.branch+'\0'+row.day,{branch:row.branch,day:row.day}])).values()];
  const receipts=[];let fetched=0;
  for(const item of scopes){
   const cap=Math.min(LIMIT.scopeRows+1,LIMIT.transactions-fetched);if(cap<1)changed('The receipt-read budget was reached. Choose a smaller reporting period.');
   const period=paymentDayRange(item.day),snapshot=await db.collection('transactions').where('branch','==',item.branch).where('timestamp','>=',period.start).where('timestamp','<',period.end).select(...sourceFields).limit(cap).get();
   fetched+=snapshot.docs.length;
   if(snapshot.docs.length>LIMIT.scopeRows||cap<LIMIT.scopeRows+1&&snapshot.docs.length===cap)changed('A branch/day has too many receipts for one safe verification.');
   for(const saved of snapshot.docs){const value=saved.data();if(value.branch!==item.branch)changed('A receipt query returned another branch.');receipts.push({...value,id:saved.id});}
  }
  return{normalized,receipts};
 }
 return{
  async rate(uid){
   const slot=Math.floor(now()/60000),id='gcash-reconciliation-'+createHash('sha256').update(uid+'|'+slot).digest('hex');
   return db.runTransaction(async tx=>{const target=ref('cash_remittance_attempts',id),saved=data(await tx.get(target)),count=saved?.count??0;if(!Number.isSafeInteger(count)||count<0||count>=60)throw reconciliationError(429,'rate','Too many reconciliation requests. Wait a minute before retrying this preview.');tx.set(target,{count:count+1,expiresAt:new Date((slot+2)*60000)});});
  },
  async saveSettings(body,actor){
   const input=reconciliationSettingsInput(body);
   return db.runTransaction(async tx=>{
    const target=ref(TABLE.settings,'main'),snapshot=await tx.get(target),previous=snapshot.exists?normalizeReconciliationSettings(snapshot.data()):defaultReconciliationSettings();
    await authority(tx,actor,input.settings.branchAliases.map(row=>row.branch),{global:true});
    if(previous.revision===input.settings.revision&&json(previous)===json(input.settings))return{schemaVersion:1,settings:input.settings};
    if(previous.revision!==input.expectedRevision)changed('Matching settings changed. Reload before saving.');
    tx.set(target,{...input.settings,updatedAt:serverTimestamp(),updatedByUid:actor.uid,updatedByEmail:actor.email.toLowerCase()});
    return{schemaVersion:1,settings:input.settings};
   });
  },
  async verify(body,actor){
   const input=reconciliationVerifyInput(body),results=[],held=[],remaining=[];
   // A current authority check precedes every payment or receipt read, including retries.
   await db.runTransaction(tx=>authority(tx,actor));
   for(const match of [...input.alreadyVerified,...input.matches]){
    const saved=await db.runTransaction(async tx=>{await authority(tx,actor);return recover(tx,match,actor);});
    if(saved)results.push(saved);else if(input.alreadyVerified.includes(match))changed('A previously verified payment claim is missing. Owner review is required.');else remaining.push(match);
   }
   if(remaining.length){
    const settings=await db.runTransaction(async tx=>{await authority(tx,actor);const snap=await tx.get(ref(TABLE.settings,'main'));if(!snap.exists)changed('The saved matching settings no longer exist.');return normalizeReconciliationSettings(snap.data());});
    if(settings.revision!==input.settingsRevision||await fingerprint(settings)!==input.settingsFingerprint)changed('Matching settings changed. Prepare a fresh preview.');
    const completed=new Set(results.map(row=>row.transactionId)),completedIndices=new Set([...input.matches,...input.alreadyVerified].filter(row=>completed.has(row.transactionId)).map(row=>row.rowIndex)),activeRows=input.rows.filter((_,index)=>!completedIndices.has(index));
    const normalized=normalizeStatementRows(activeRows,settings,{scope:input.scope||undefined});
    const branches=[...new Set(normalized.filter(row=>row.eligible).map(row=>row.branch))];await db.runTransaction(tx=>authority(tx,actor,branches));
    const {receipts}=await loadCandidates(activeRows,settings,input.scope,remaining),plan=await buildPaymentReconciliationPlan({fileSha256:input.fileSha256,rows:activeRows,transactions:receipts,settings,scope:input.scope||undefined,crypto:webcrypto});
    for(const match of remaining){
     const candidate=plan.matches.find(row=>row.rowId===match.rowId);
     if(!candidate||candidate.transactionId!==match.transactionId||candidate.claimId!==match.claimId||candidate.sourceFingerprint!==match.sourceFingerprint)changed('Receipt evidence or matching candidates changed. Preview the file again.');
     if(input.automatic&&!candidate.automaticEligible){held.push({rowId:match.rowId,rowIndex:match.rowIndex,reason:'The saved receipt has no explicit matching payment reference. Review the evidence manually.'});continue;}
     const result=await db.runTransaction(async tx=>{
      await authority(tx,actor,[candidate.branch]);
      const saved=await recover(tx,match,actor);if(saved)return saved;
      const [settingsSnap,transactionSnap,importSnap,refundSnap]=await Promise.all([tx.get(ref(TABLE.settings,'main')),tx.get(ref('transactions',match.transactionId)),tx.get(ref(TABLE.imports,input.fileSha256)),tx.get(ref('online_order_incidents','online-refund-'+match.transactionId))]);
      if(!settingsSnap.exists||!transactionSnap.exists)changed('The matching settings or receipt no longer exists.');
      if(refundSnap.exists&&refundSnap.data().status!=='Dismissed')changed('An Owner refund case is pending or active for this receipt.');
      const currentSettings=normalizeReconciliationSettings(settingsSnap.data()),transaction={...transactionSnap.data(),id:match.transactionId};
      if(currentSettings.revision!==input.settingsRevision||await fingerprint(currentSettings)!==input.settingsFingerprint)changed('Matching settings changed during verification.');
      try{normalizePaymentReceipt(transaction,currentSettings);}catch{changed('The receipt is no longer eligible for statement verification. Prepare a fresh preview.');}
      if(await fingerprint(paymentReceiptProjection(transaction))!==match.sourceFingerprint)changed('The receipt changed during verification. Prepare a fresh preview.');
      // The earlier query is advisory. Repeat the complete exact branch/day
      // candidate set inside this row's transaction, so a concurrent receipt
      // insertion cannot inherit the earlier plan's uniqueness decision.
      const period=paymentDayRange(candidate.day),pool=await tx.get(db.collection('transactions').where('branch','==',candidate.branch).where('timestamp','>=',period.start).where('timestamp','<',period.end).select(...sourceFields).limit(LIMIT.scopeRows+1));
      if(pool.docs.length>LIMIT.scopeRows)changed('This branch/day is too large to prove a complete unique match. Import a smaller reporting period.');
      const atomicPlan=await buildPaymentReconciliationPlan({fileSha256:input.fileSha256,rows:activeRows,transactions:pool.docs.map(saved=>({...saved.data(),id:saved.id})),settings:currentSettings,scope:input.scope||undefined,crypto:webcrypto}),atomic=atomicPlan.matches.find(row=>row.rowId===match.rowId);
      if(!atomic||atomic.transactionId!==match.transactionId||atomic.claimId!==match.claimId||atomic.sourceFingerprint!==match.sourceFingerprint||input.automatic&&!atomic.automaticEligible)changed('Matching candidates changed during verification. Prepare a fresh preview.');
      const file=data(importSnap);if(file&&(file.schemaVersion!==1||file.fileSha256!==input.fileSha256||file.rowCount!==input.rows.length))changed('This file has conflicting saved import metadata.');
      const stamp=serverTimestamp(),email=actor.email.toLowerCase(),claim={schemaVersion:1,claimId:match.claimId,transactionId:match.transactionId,fileSha256:input.fileSha256,provider:candidate.provider,branch:candidate.branch,day:candidate.day,grossCents:candidate.grossCents,statementAt:new Date(candidate.statementAt),sourceAt:transaction.timestamp,sourceFingerprint:match.sourceFingerprint,settingsRevision:input.settingsRevision,verifiedAt:stamp,verifiedByUid:actor.uid,verifiedByEmail:email};
      if(!file)tx.create(ref(TABLE.imports,input.fileSha256),{schemaVersion:1,fileSha256:input.fileSha256,rowCount:input.rows.length,createdAt:stamp,createdByUid:actor.uid,createdByEmail:email});
      tx.create(ref(TABLE.rows,match.claimId),claim);tx.create(ref(TABLE.receipts,match.transactionId),claim);
      tx.update(ref('transactions',match.transactionId),{paymentVerified:true,verifiedBy:email,verifiedAt:stamp,paymentReconciliationVersion:1,paymentReconciliationId:match.claimId,paymentReconciliationFile:input.fileSha256});
      return{transactionId:match.transactionId,claimId:match.claimId,alreadyVerified:false,fileSha256:input.fileSha256};
     });results.push(result);
    }
   }
   await db.runTransaction(tx=>authority(tx,actor));
   return{schemaVersion:1,verified:results.filter(row=>!row.alreadyVerified).length,alreadyVerified:results.filter(row=>row.alreadyVerified).length,results,held};
  }
 };
}
