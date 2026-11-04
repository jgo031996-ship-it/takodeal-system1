import {payrollAdjustmentDay,payrollAdjustmentCents} from './payroll-adjustment-model.js';
export const PAYROLL_RECOVERY_LABEL='Previous payroll recovery';
const prefix=PAYROLL_RECOVERY_LABEL+'\n';
const key=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,180}$/.test(value);
export function payrollRecoveryDetails(value){
 const staffId=value?.staffId,originalStart=payrollAdjustmentDay(value?.originalStart),originalEnd=payrollAdjustmentDay(value?.originalEnd),sourcePayrollRecordId=value?.sourcePayrollRecordId,sourceNetPay=payrollAdjustmentCents(value?.sourceNetPay)/100;
 if(!key(staffId)||staffId.length>160||!key(sourcePayrollRecordId)||originalStart>originalEnd)throw Error('Confirm the original paid payroll and saved employee before reviewing a recovery.');
 const requestedEffectiveDate=value.requestedEffectiveDate?payrollAdjustmentDay(value.requestedEffectiveDate):null;if(requestedEffectiveDate&&requestedEffectiveDate<=originalEnd)throw Error('The requested recovery date must follow the original paid cutoff.');
 const reason=value.reason===undefined?null:String(value.reason).trim();if(reason!==null&&(reason.length<8||reason.length>1500))throw Error('The saved payroll recovery reason is incomplete.');
 return {staffId,originalStart,originalEnd,sourcePayrollRecordId,sourceNetPay,...(requestedEffectiveDate?{requestedEffectiveDate}:{}),...(reason!==null?{reason}:{})};
}
// The existing protected review schema retains this readable structured
// reference in its immutable evidence field; no new Rules fields are needed.
export function payrollRecoveryEvidence(value){const row=payrollRecoveryDetails(value);return prefix+'Cutoff: '+row.originalStart+' to '+row.originalEnd+'\nOriginal payslip: '+row.sourcePayrollRecordId+'\nSaved net paid (PHP): '+row.sourceNetPay.toFixed(2)+'\nEmployee account: '+row.staffId+(row.requestedEffectiveDate?'\nRequested payroll date: '+row.requestedEffectiveDate:'');}
export function readPayrollRecoveryEvidence(value){
 if(typeof value!=='string'||!value.startsWith(prefix))return null;
 const match=value.match(/^Previous payroll recovery\nCutoff: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\nOriginal payslip: ([-A-Za-z0-9_]{1,180})\nSaved net paid \(PHP\): (\d+\.\d{2})\nEmployee account: ([-A-Za-z0-9_]{1,160})(?:\nRequested payroll date: (\d{4}-\d{2}-\d{2}))?$/);
 if(!match)throw Error('The original payroll recovery reference is incomplete. Reopen its saved review.');
 return payrollRecoveryDetails({originalStart:match[1],originalEnd:match[2],sourcePayrollRecordId:match[3],sourceNetPay:Number(match[4]),staffId:match[5],requestedEffectiveDate:match[6]});
}
export function payrollRecoveryFromReview(row){
 const recovery=readPayrollRecoveryEvidence(row?.evidence);
 if(!recovery&&String(row?.label||'').startsWith(PAYROLL_RECOVERY_LABEL))throw Error('This payroll recovery is missing its original paid reference.');
 if(recovery&&(row.staffId!==recovery.staffId||row.category!=='Other'||row.incidentDate!==recovery.originalEnd||row.label!==PAYROLL_RECOVERY_LABEL+' · '+recovery.originalStart+' to '+recovery.originalEnd||Number(row.sourceLossCents)>payrollAdjustmentCents(recovery.sourceNetPay)))throw Error('The original payroll recovery details conflict with its reviewed amount.');
 return recovery?{...recovery,...(typeof row.details==='string'?{reason:row.details}:{})}:null;
}
export function validatePayrollRecoverySource(reference,row){
 const recovery=payrollRecoveryDetails(reference),frozen=row?.frozenData,ids=[row?.staffId,frozen?.staffId,frozen?.profile?.staffId,frozen?.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
 if(!row||!frozen||typeof frozen!=='object'||Array.isArray(frozen)||!ids.length||ids.some(id=>id!==recovery.staffId)||row.startDate!==recovery.originalStart||row.endDate!==recovery.originalEnd||row.isPaid===false||frozen.isPaid===false||/^(draft|pending|unpaid|cancelled|canceled|voided|failed)$/i.test(String(row.status||''))||row.finalNetPay==null||payrollAdjustmentCents(row.finalNetPay)!==payrollAdjustmentCents(recovery.sourceNetPay)||frozen.finalNetPay!=null&&payrollAdjustmentCents(frozen.finalNetPay)!==payrollAdjustmentCents(recovery.sourceNetPay))throw Error('The original paid payroll no longer matches this recovery review. Confirm its saved employee, cutoff and paid amount.');
 return recovery;
}
