import {OWNER_EMAIL,createWorkspaceSession,canOpenHrTab} from './workspace-access-model.js';
import {resolveHQAccount} from './hq-account-model.js';
import {activeStaffProfile} from './staff-lifecycle-model.js';
import {readPayrollSnapshot} from './payroll-preview-guard.js';
import {sameSavedPayrollValue,ordinaryPayrollId} from './payroll-settlement.js';
import {PAYROLL_ADJUSTMENT_TYPE,payrollAdjustmentInput,payrollAdjustmentId,payrollAdjustmentDetail,validatePayrollAdjustmentRecord} from './payroll-adjustment-model.js';
import {PAYROLL_RECOVERY_LABEL,payrollRecoveryEvidence,payrollRecoveryFromReview,validatePayrollRecoverySource} from './payroll-recovery-model.js';

const text=value=>String(value??'').trim();
const key=value=>{if(typeof value!=='string'||!/^[-A-Za-z0-9_]{1,180}$/.test(value))throw Error('Open the exact saved employee or payroll record.');return value;};
const phToday=now=>new Date(+now+8*3600000).toISOString().slice(0,10);
export function payrollAdjustmentActor(api){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||String(user.email||'').toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true||!canOpenHrTab(session,'Feed'))throw Error('Only the verified Owner can review previous payroll credits.');
 return JSON.stringify([user.uid,user.email.toLowerCase(),session.uid,session.email,session.isOwner,session.permissions,session.allowedBranches]);
}
export const canManagePayrollAdjustments=api=>{try{payrollAdjustmentActor(api);return true;}catch{return false;}};
function savedAuthorization(api,rows){
 const account=resolveHQAccount(rows.map(row=>({id:row.id,data:row}))),session=createWorkspaceSession(api.auth.currentUser,account);
 if(account.active===false||account.blocked===true||/blocked|disabled|inactive|revoked/i.test(text(account.status))||/^(blocked|revoked)$/i.test(text(account.pin))||!session.isOwner||session.isFranchisee||!canOpenHrTab(session,'Feed'))throw Error('Your saved Owner access could not be confirmed.');
}
function confirmedOriginal(row){
 const frozen=row?.frozenData;
 if(!frozen||typeof frozen!=='object'||Array.isArray(frozen)||frozen.isPaid===false||row.isPaid===false||/^(draft|pending|unpaid|cancelled|canceled|voided|failed)$/i.test(text(row.status))||row.finalNetPay===null||row.finalNetPay===undefined||!Number.isFinite(Number(row.finalNetPay))||Number(row.finalNetPay)<0)throw Error('The original saved payslip is incomplete. Ask HQ to reconcile it before creating a credit.');
 return row;
}
function belongs(row,staff,uniqueName){
 const ids=[row.staffId,row.frozenData?.staffId,row.frozenData?.profile?.staffId,row.frozenData?.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
 return ids.length?ids.every(value=>value===staff.staffId):uniqueName&&row.staffName===staff.staffName&&(row.branch||row.frozenData?.branch)===staff.branch;
}
async function digest(api,value){
 const crypto=api.crypto||globalThis.crypto;if(!crypto?.subtle)throw Error('Reload the Owner app to create a stable payroll review reference.');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function createPayrollAdjustmentService(api,{now=()=>new Date()}={}){
 const pending=new Map(),ref=(table,id)=>api.doc(api.db,table,id);
 const query=(table,filters)=>api.query(api.collection(api.db,table),...filters.map(([name,value])=>api.where(name,'==',value)),...(typeof api.limit==='function'?[api.limit(251)]:[]));
 const readMany=async reference=>{const snapshot=await readPayrollSnapshot(api,reference);if(snapshot.docs.length>250)throw Error('This employee has too much history for one complete review. Ask HQ to reconcile it.');return snapshot.docs.map(row=>({...row.data(),id:row.id}));};
 const fresh=async reference=>{const snap=await api.getDocFromServer(reference);if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the saved payroll records.');return snap;};
 const scope=assertCurrent=>{const actor=payrollAdjustmentActor(api);return()=>{assertCurrent?.();if(payrollAdjustmentActor(api)!==actor)throw Error('The Owner account changed. Reopen the payroll credit review.');};};
 async function listStaff({assertCurrent}={}){
  const guard=scope(assertCurrent);guard();const [hq,profiles]=await Promise.all([readMany(query('hq_managers',[['email',OWNER_EMAIL]])),readMany(api.collection(api.db,'cashiers'))]);guard();savedAuthorization(api,hq);
  return profiles.filter(profile=>activeStaffProfile(profile)&&text(profile.cashierName)&&text(profile.branch)).map(profile=>({staffId:profile.id,staffName:profile.cashierName,branch:profile.branch})).sort((a,b)=>a.staffName.localeCompare(b.staffName)||a.staffId.localeCompare(b.staffId));
 }
 async function inspect(staffId,{assertCurrent}={}){
  staffId=key(staffId);const guard=scope(assertCurrent);guard();
  const [person,hq]=await Promise.all([fresh(ref('cashiers',staffId)),readMany(query('hq_managers',[['email',OWNER_EMAIL]]))]);guard();savedAuthorization(api,hq);
  if(!person.exists())throw Error('The saved employee profile is missing.');const profile=person.data();
  if(!text(profile.cashierName)||!text(profile.branch))throw Error('The saved employee name or branch is incomplete.');
  const staff={staffId,staffName:profile.cashierName,branch:profile.branch,active:activeStaffProfile(profile)};
  const [byId,byName,directory,credits,recoveryReviews]=await Promise.all([
   readMany(query('payroll_records',[['staffId',staffId]])),readMany(query('payroll_records',[['staffName',staff.staffName]])),
   readMany(query('cashiers',[['cashierName',staff.staffName]])),readMany(query('staff_bonuses',[['staffId',staffId],['type',PAYROLL_ADJUSTMENT_TYPE]])),readMany(query('owner_deduction_reviews',[['staffId',staffId]]))
  ]);guard();
  const uniqueName=directory.length===1&&directory[0].id===staffId;
  const history=[...new Map([...byId,...byName].filter(row=>belongs(row,staff,uniqueName)).map(row=>[row.id,row])).values()];
  const recoveries=recoveryReviews.filter(row=>payrollRecoveryFromReview(row));
  return {staff,profile,hq,history,credits,recoveries,uniqueName};
 }
 async function prepareRecovery(input,{assertCurrent}={}){
  const normalized=payrollAdjustmentInput(input,{today:phToday(now())}),guard=scope(assertCurrent);guard();if(!normalized.sourcePayrollRecordId)throw Error('Choose a confirmed original paid payslip before reviewing a recovery.');
  const view=await inspect(normalized.staffId,{assertCurrent:guard});guard();if(!view.staff.active)throw Error('Open an active saved employee before requesting a future payroll recovery.');
  const source=view.history.find(row=>row.id===normalized.sourcePayrollRecordId);if(!source)throw Error('The original paid payroll does not belong to this saved employee.');
  const reference={staffId:normalized.staffId,originalStart:normalized.originalStart,originalEnd:normalized.originalEnd,sourcePayrollRecordId:source.id,sourceNetPay:Number(source.finalNetPay),requestedEffectiveDate:normalized.effectiveDate};validatePayrollRecoverySource(reference,source);
  if(normalized.amount>reference.sourceNetPay)throw Error('A proposed recovery cannot exceed the confirmed original net amount paid.');
  const fingerprint=await digest(api,JSON.stringify({...normalized,sourceNetPay:reference.sourceNetPay}));guard();const uuid=[fingerprint.slice(0,8),fingerprint.slice(8,12),fingerprint.slice(12,16),fingerprint.slice(16,20),fingerprint.slice(20,32)].join('-');
  return {operationId:uuid,staffId:normalized.staffId,category:'Other',label:PAYROLL_RECOVERY_LABEL+' · '+normalized.originalStart+' to '+normalized.originalEnd,incidentDate:normalized.originalEnd,details:normalized.reason,evidence:payrollRecoveryEvidence(reference),actualLoss:normalized.amount,proposedAmount:normalized.amount,payrollRecovery:reference};
 }
 function shared(kind,id,intent,work){
  const pendingKey=kind+'|'+id,existing=pending.get(pendingKey);if(existing){if(existing.intent!==intent)return Promise.reject(Error('This review is already being saved with different details. Wait for its result.'));return existing.promise;}
  const entry={intent};entry.promise=Promise.resolve().then(work).finally(()=>{if(pending.get(pendingKey)===entry)pending.delete(pendingKey);});pending.set(pendingKey,entry);return entry.promise;
 }
 async function create(input,{assertCurrent}={}){
  const normalized=payrollAdjustmentInput(input,{today:phToday(now())}),guard=scope(assertCurrent);guard();
  const view=await inspect(normalized.staffId,{assertCurrent:guard});guard();
  if(!view.staff.active)throw Error('Open an active saved employee before adding a credit to a future unpaid payslip.');
  const intent=JSON.stringify({...normalized,staffName:view.staff.staffName,branch:view.staff.branch});
  const id='payroll-adjustment-'+await digest(api,intent);guard();
  const originals=view.history.filter(row=>row.startDate===normalized.originalStart&&row.endDate===normalized.originalEnd);
  if(originals.length>1)throw Error('More than one original payroll covers this cutoff. Reconcile it before adding a credit.');
  if(originals.length){confirmedOriginal(originals[0]);if(normalized.sourcePayrollRecordId!==originals[0].id)throw Error('Choose the saved original payslip for this paid cutoff.');}
  else if(normalized.sourcePayrollRecordId)throw Error('The selected original payslip does not match this employee and cutoff.');
  return shared('create',id,intent,async()=>{
   const sourceSentinelIds=[ordinaryPayrollId(normalized.staffId,normalized.originalStart,normalized.originalEnd),key('refund-payroll-'+normalized.staffId+'-'+normalized.originalStart+'-'+normalized.originalEnd)];
   const references=[ref('staff_bonuses',id),ref('cashiers',normalized.staffId),...view.hq.map(row=>ref('hq_managers',row.id)),...originals.map(row=>ref('payroll_records',key(row.id))),...sourceSentinelIds.map(id=>ref('payroll_records',id))];
   return api.runTransaction(api.db,async tx=>{
    const snapshots=await Promise.all(references.map(reference=>tx.get(reference)));guard();
    const [existing,person,...remaining]=snapshots;
    const hq=remaining.slice(0,view.hq.length).map((snapshot,index)=>{if(!snapshot.exists())throw Error('Saved Owner access changed.');return {...snapshot.data(),id:view.hq[index].id};});savedAuthorization(api,hq);
    if(!person.exists()||person.data().cashierName!==view.staff.staffName||person.data().branch!==view.staff.branch||!activeStaffProfile(person.data()))throw Error('The saved employee changed. Reopen this review.');
    if(existing.exists()){
     const row={...existing.data(),id};validatePayrollAdjustmentRecord(row,{staffId:normalized.staffId,name:view.staff.staffName,branch:view.staff.branch});
     if(row.createIntent!==intent)throw Error('The saved payroll credit differs from this review. Reopen its history.');
     const detail=payrollAdjustmentDetail(row);for(const field of ['amount','originalStart','originalEnd','effectiveDate','reason','sourcePayrollRecordId'])if(detail[field]!==normalized[field])throw Error('The saved payroll credit was changed. Ask HQ to review it.');
     return {id,alreadySaved:true,status:row.status};
    }
    for(let index=0;index<sourceSentinelIds.length;index++)if(remaining[view.hq.length+originals.length+index].exists()&&!originals.some(row=>row.id===sourceSentinelIds[index]))throw Error('An original payment appeared while this credit was being reviewed. Reopen the review and select its confirmed paid payslip.');
    for(let index=0;index<originals.length;index++){
     const snap=remaining[view.hq.length+index];if(!snap.exists())throw Error('The original paid payroll disappeared. Reopen this review.');
     const row={...confirmedOriginal(snap.data()),id:originals[index].id};if(!belongs(row,view.staff,view.uniqueName)||row.startDate!==normalized.originalStart||row.endDate!==normalized.originalEnd||row.finalNetPay!==originals[index].finalNetPay||!sameSavedPayrollValue(row.frozenData,originals[index].frozenData))throw Error('The original saved payroll changed. Reopen its review.');
    }
    guard();const createdAt=api.serverTimestamp();tx.set(ref('staff_bonuses',id),{...normalized,id,type:PAYROLL_ADJUSTMENT_TYPE,payrollAdjustmentVersion:1,staffName:view.staff.staffName,branch:view.staff.branch,status:'Unpaid',createIntent:intent,dateAdded:createdAt,createdAt,createdByUid:api.auth.currentUser.uid,createdByEmail:OWNER_EMAIL});
    return {id,alreadySaved:false,status:'Unpaid'};
   });
  });
 }
 async function cancel(id,{reason,assertCurrent}={}){
  id=payrollAdjustmentId(id);reason=text(reason);if(reason.length<8||reason.length>1500)throw Error('Explain why this unpaid credit is being cancelled.');const guard=scope(assertCurrent);guard();
  const initial=await fresh(ref('staff_bonuses',id));guard();if(!initial.exists())throw Error('This payroll adjustment is missing.');const record={...initial.data(),id};validatePayrollAdjustmentRecord(record);const view=await inspect(record.staffId,{assertCurrent:guard});guard();
  return shared('cancel',id,reason,()=>api.runTransaction(api.db,async tx=>{
   const [current,...hqSnapshots]=await Promise.all([tx.get(ref('staff_bonuses',id)),...view.hq.map(row=>tx.get(ref('hq_managers',row.id)))]);guard();savedAuthorization(api,hqSnapshots.map((snapshot,index)=>{if(!snapshot.exists())throw Error('Your saved Owner access changed.');return {...snapshot.data(),id:view.hq[index].id};}));
   if(!current.exists())throw Error('This payroll credit is missing.');const row={...current.data(),id};validatePayrollAdjustmentRecord(row);
   if(row.status==='Cancelled'){if((row.cancel??row.cancelReason)!==reason)throw Error('This credit was already cancelled with another saved reason.');return {id,alreadySaved:true,status:'Cancelled'};}
   validatePayrollAdjustmentRecord(row,{staffId:view.staff.staffId,unpaid:true});
   if(row.createIntent!==record.createIntent||JSON.stringify(payrollAdjustmentDetail(row))!==JSON.stringify(payrollAdjustmentDetail(record)))throw Error('This payroll credit changed. Refresh its history.');
   tx.update(ref('staff_bonuses',id),{status:'Cancelled',cancel:reason,at:api.serverTimestamp()});return {id,alreadySaved:false,status:'Cancelled'};
  }));
 }
 return {listStaff,inspect,prepareRecovery,create,cancel,isSaving:id=>[...pending.keys()].some(key=>key.endsWith('|'+id))};
}
