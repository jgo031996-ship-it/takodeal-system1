import {payrollAdjustmentDay,payrollAdjustmentCents} from './payroll-adjustment-model.js';
export const PAYROLL_RECOVERY_LABEL='Previous payroll recovery';
const prefix=PAYROLL_RECOVERY_LABEL+'\n';
const key=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,180}$/.test(value);
export function payrollRecoveryDetails(value){
 const staffId=value?.staffId,originalStart=payrollAdjustmentDay(value?.originalStart),originalEnd=payrollAdjustmentDay(value?.originalEnd),sourcePayrollRecordId=value?.sourcePayrollRecordId,sourceNetPay=payrollAdjustmentCents(value?.sourceNetPay)/100;
 if(!key(staffId)||staffId.length>160||!key(sourcePayrollRecordId)||originalStart>originalEnd)throw Error('Confirm the original paid payroll and saved employee before reviewing a recovery.');
 const requestedEffectiveDate=value.requestedEffectiveDate?payrollAdjustmentDay(value.requestedEffectiveDate):null;if(requestedEffectiveDate&&requestedEffectiveDate<=originalEnd)throw Error('The requested recovery date must follow the original paid cutoff.');
 const reason=value.reason===undefined?null:String(value.reason).trim();if(reason!==null&&(reason.length<8||reason.length>1500))throw Error('The saved payroll recovery reason is incomplete.');
 const verified=value.sourceFingerprint!==undefined||value.correctedNetPay!==undefined||value.recoveryGeneration!==undefined;
 let proof={};if(verified){const correctedNetPay=payrollAdjustmentCents(value.correctedNetPay,{zero:true})/100,sourceFingerprint=value.sourceFingerprint,recoveryGeneration=value.recoveryGeneration;if(!/^[a-f0-9]{64}$/.test(sourceFingerprint||'')||!Number.isSafeInteger(recoveryGeneration)||recoveryGeneration<0||recoveryGeneration>250||correctedNetPay>=sourceNetPay)throw Error('Confirm the original paid source and its documented corrected net pay.');proof={version:2,correctedNetPay,sourceFingerprint,recoveryGeneration,overpaymentAmount:(payrollAdjustmentCents(sourceNetPay)-payrollAdjustmentCents(correctedNetPay,{zero:true}))/100};}
 return {staffId,originalStart,originalEnd,sourcePayrollRecordId,sourceNetPay,...proof,...(requestedEffectiveDate?{requestedEffectiveDate}:{}),...(reason!==null?{reason}:{})};
}
// The existing protected review schema retains this readable structured
// reference in its immutable evidence field; no new Rules fields are needed.
export function payrollRecoveryEvidence(value){const row=payrollRecoveryDetails(value);return prefix+'Cutoff: '+row.originalStart+' to '+row.originalEnd+'\nOriginal payslip: '+row.sourcePayrollRecordId+'\nSaved net paid (PHP): '+row.sourceNetPay.toFixed(2)+'\nEmployee account: '+row.staffId+(row.requestedEffectiveDate?'\nRequested payroll date: '+row.requestedEffectiveDate:'')+(row.version===2?'\nCorrected net (PHP): '+row.correctedNetPay.toFixed(2)+'\nSource fingerprint: '+row.sourceFingerprint+'\nRecovery generation: '+row.recoveryGeneration:'');}
export function readPayrollRecoveryEvidence(value){
 if(typeof value!=='string'||!value.startsWith(prefix))return null;
 const match=value.match(/^Previous payroll recovery\nCutoff: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\nOriginal payslip: ([-A-Za-z0-9_]{1,180})\nSaved net paid \(PHP\): (\d+\.\d{2})\nEmployee account: ([-A-Za-z0-9_]{1,160})(?:\nRequested payroll date: (\d{4}-\d{2}-\d{2}))?(?:\nCorrected net \(PHP\): (\d+\.\d{2})\nSource fingerprint: ([a-f0-9]{64})\nRecovery generation: (\d{1,3}))?$/);
 if(!match)throw Error('The original payroll recovery reference is incomplete. Reopen its saved review.');
 return payrollRecoveryDetails({originalStart:match[1],originalEnd:match[2],sourcePayrollRecordId:match[3],sourceNetPay:Number(match[4]),staffId:match[5],requestedEffectiveDate:match[6],...(match[7]!==undefined?{correctedNetPay:Number(match[7]),sourceFingerprint:match[8],recoveryGeneration:Number(match[9])}:{})});
}
export function payrollRecoveryFromReview(row){
 const recovery=readPayrollRecoveryEvidence(row?.evidence);
 if(!recovery&&String(row?.label||'').startsWith(PAYROLL_RECOVERY_LABEL))throw Error('This payroll recovery is missing its original paid reference.');
 if(recovery&&(row.staffId!==recovery.staffId||row.category!=='Other'||row.incidentDate!==recovery.originalEnd||row.label!==PAYROLL_RECOVERY_LABEL+' · '+recovery.originalStart+' to '+recovery.originalEnd||Number(row.sourceLossCents)>payrollAdjustmentCents(recovery.overpaymentAmount??recovery.sourceNetPay)))throw Error('The original payroll recovery details conflict with its reviewed amount.');
 return recovery?{...recovery,...(typeof row.details==='string'?{reason:row.details}:{})}:null;
}
export function validatePayrollRecoverySource(reference,row){
 const recovery=payrollRecoveryDetails(reference),frozen=row?.frozenData,ids=[row?.staffId,frozen?.staffId,frozen?.profile?.staffId,frozen?.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
 if(!row||!frozen||typeof frozen!=='object'||Array.isArray(frozen)||!ids.length||ids.some(id=>id!==recovery.staffId)||row.startDate!==recovery.originalStart||row.endDate!==recovery.originalEnd||row.isPaid===false||frozen.isPaid===false||row.pendingSync===true||frozen.pendingSync===true||[row.status,row.paymentStatus,row.paymentState].some(status=>/^(draft|pending|unpaid|cancelled|canceled|voided|failed)$/i.test(String(status||'')))||row.finalNetPay==null||payrollAdjustmentCents(row.finalNetPay)!==payrollAdjustmentCents(recovery.sourceNetPay)||frozen.finalNetPay!=null&&payrollAdjustmentCents(frozen.finalNetPay)!==payrollAdjustmentCents(recovery.sourceNetPay))throw Error('The original paid payroll no longer matches this recovery review. Confirm its saved employee, cutoff and paid amount.');
 return recovery;
}
const canonical=value=>{
 if(value instanceof Date){if(!Number.isFinite(+value))throw Error('The original payroll contains an invalid saved date.');return ['timestamp',Math.floor(+value/1000),(+value%1000+1000)%1000*1e6];}
 if(value&&typeof value==='object'&&Number.isSafeInteger(value.seconds)&&Number.isSafeInteger(value.nanoseconds??0)&&Object.keys(value).every(key=>['seconds','nanoseconds','type'].includes(key)))return ['timestamp',value.seconds,value.nanoseconds??0];
 if(value===null)return ['null'];
 if(typeof value!=='object')return [typeof value,typeof value==='number'?String(value):value];
 return Array.isArray(value)?['array',value.map(canonical)]:['map',Object.keys(value).sort().map(key=>[key,canonical(value[key])])];
};
async function sha(value,cryptoApi=globalThis.crypto){if(!cryptoApi?.subtle)throw Error('Reload the app to confirm the original payroll source.');return [...new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function payrollRecoverySourceFingerprint(row,cryptoApi){
 // Staff acknowledgment can be completed independently of this review. All
 // original financial, frozen attendance, wage and payment fields stay bound.
 const {id,acknowledged,acknowledgedAt,signatureBase64,...source}=row||{};return sha(JSON.stringify(canonical(source)),cryptoApi);
}
export async function assertPayrollRecoverySource(reference,row,cryptoApi){const checked=validatePayrollRecoverySource(reference,row);if(checked.version!==2)throw Error('This legacy recovery needs a fresh original-payroll review. Dismiss and recreate it before collecting.');if(await payrollRecoverySourceFingerprint(row,cryptoApi)!==checked.sourceFingerprint)throw Error('The original paid payroll changed. Reopen and review its corrected amount before any recovery.');return checked;}
export async function payrollRecoveryOperationId(reference,cryptoApi){const row=payrollRecoveryDetails(reference);if(row.version!==2)throw Error('Review the original payroll before creating a recovery.');const digest=await sha(JSON.stringify(['payroll-recovery',row.staffId,row.sourcePayrollRecordId,row.recoveryGeneration]),cryptoApi);return [digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20,32)].join('-');}
export function payrollRecoveryPeers(rows,reference){const selected=payrollRecoveryDetails(reference);return rows.filter(row=>{const r=payrollRecoveryFromReview(row);return r&&r.staffId===selected.staffId&&r.sourcePayrollRecordId===selected.sourcePayrollRecordId;});}
export function assertPayrollRecoveryPeers(rows,reference,currentId){const peers=payrollRecoveryPeers(rows,reference),conflict=peers.find(row=>row.id!==currentId&&row.status!=='Dismissed');if(conflict){const error=Error('A recovery for this original payroll already exists. Open its saved review instead of creating another.');error.code='payroll-recovery-existing';error.recoveryId=conflict.id;throw error;}return peers;}
