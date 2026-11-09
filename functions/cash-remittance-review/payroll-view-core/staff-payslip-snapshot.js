// Saved Owner figures only. No current profile, attendance or deduction ledger
// is consulted to reconstruct an already shared or paid payslip.
import {payslipDeductionBreakdown} from './payroll-deduction-details.js';
const clean=value=>typeof value==='string'?value.trim():'';
const clone=value=>JSON.parse(JSON.stringify(value));
const owns=(value,key)=>value[key]!==undefined&&value[key]!==null;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function savedPayslipCents(value,{missing=false,negative=false}={}){
  if(value===undefined||value===null){if(missing)return 0;throw Error('The saved payslip amount needs HQ review.');}
  if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))throw Error('The saved payslip amount needs HQ review.');
  const cents=Math.round(Number(value)*100);if(!Number.isSafeInteger(cents)||!negative&&cents<0||Math.abs(cents)>1000000000000)throw Error('The saved payslip amount needs HQ review.');return cents;
}
export function payslipSavedAmounts(data={}){
  const value={...data};
  for(const [key,legacy]of [['nightBonus','overtime'],['holidayPayTotal','holiday'],['perfBonus','performanceBonus']])if(!owns(value,key))value[key]=value[legacy]??0;
  const income=['basicPay','nightBonus','straightBonus','holidayPayTotal','perfBonus','payrollAdjustments'];
  const deductions=['lateDeduction','sss','philhealth','pagibig','advances','meals','loans','onlineRefunds','cashShortages','ownerDeductions'];
  for(const key of [...income,...deductions])value[key]=savedPayslipCents(value[key],{missing:true})/100;
  const custom=value.customDeductions??value.profile?.customDeductions??[];
  if(!Array.isArray(custom))throw Error('The saved deduction labels need HQ review.');
  for(const row of custom)if(row)savedPayslipCents(row.amount,{missing:true});
  if(owns(value,'customDeductionsTotal'))savedPayslipCents(value.customDeductionsTotal);
  const grossCents=income.reduce((sum,key)=>sum+savedPayslipCents(value[key]),0);
  const totalCents=savedPayslipCents(payslipDeductionBreakdown(value).total);
  return {...Object.fromEntries([...income,...deductions].map(key=>[key,value[key]])),grossPay:grossCents/100,totalDeductions:totalCents/100,
    ...(owns(value,'finalNetPay')?{finalNetPay:savedPayslipCents(value.finalNetPay,{negative:true})/100}:{})};
}
export function normalizeStaffPayslip(record,{staffId,legacyNames=[]}={}, {shared=false}={}){
  if(!record||typeof record!=='object'||Array.isArray(record))throw Error('The saved payslip is unavailable.');
  const source=shared?record.snapshot:record.frozenData;
  if(!source||typeof source!=='object'||Array.isArray(source))throw Error('This record has no saved Owner payslip snapshot.');
  const ids=[record.staffId,source.staffId,source.profile?.staffId,source.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
  if(!staffId||ids.some(value=>typeof value!=='string'||value!==staffId))throw Error('The saved payslip has conflicting employee identities. Ask HQ to review it.');
  const name=clean(source.name)||clean(record.staffName);
  if(!ids.length&&!legacyNames.includes(name)||!name||record.staffName&&clean(record.staffName)!==name)throw Error('This older payslip needs its exact employee identity confirmed by HQ.');
  const start=record.startDate??source.start??source.startDate,end=record.endDate??source.end??source.endDate;
  if(!validDate(start)||!validDate(end)||start>end||[source.start,source.startDate].some(value=>value!=null&&value!==start)||[source.end,source.endDate].some(value=>value!=null&&value!==end))throw Error('The saved payslip cutoff needs HQ review.');
  if(shared){
    if(record.schemaVersion!==1||record.kind!=='owner-shared-payslip'||record.status!=='Published'||source.isPaid!==false||!Number.isSafeInteger(record.revision)||record.revision<1||source.attendanceReviewRequired||source.salaryReviewRequired)throw Error('This shared payslip is held for Owner review.');
  }else if(source.isPaid===false||record.isPaid===false||/^(draft|unpaid|pending|cancelled|canceled|voided|failed)$/i.test(clean(record.status)))throw Error('This saved payroll is not a confirmed payment.');
  const net=savedPayslipCents(record.finalNetPay,{negative:true});
  if(owns(source,'finalNetPay')&&savedPayslipCents(source.finalNetPay,{negative:true})!==net)throw Error('The saved net pay does not match its frozen payslip. Ask HQ to review it.');
  const amounts=payslipSavedAmounts(source);
  if(shared&&(savedPayslipCents(source.grossPay)!==savedPayslipCents(amounts.grossPay)||savedPayslipCents(source.totalDeductions)!==savedPayslipCents(amounts.totalDeductions)||savedPayslipCents(amounts.grossPay)-savedPayslipCents(amounts.totalDeductions)!==net))throw Error('The shared payslip totals need Owner review.');
  if(record.branch&&source.branch&&record.branch!==source.branch)throw Error('The saved payslip branch does not match its original snapshot.');
  return {...clone(source),...amounts,staffId,name,branch:source.branch||record.branch||'',start,end,startDate:start,endDate:end,finalNetPay:net/100,
    isPaid:!shared,recordState:shared?'shared':'paid',recordId:record.id||'',processedAt:shared?null:record.processedAt??null,
    ...(shared?{publishedAt:record.publishedAt,publicationRevision:record.revision}:{}),
    ...(!shared&&(record.signatureBase64??source.staffSignature)?{staffSignature:record.signatureBase64??source.staffSignature}:{})};
}
export const payslipCutoffKey=value=>JSON.stringify([value.start??value.startDate,value.end??value.endDate]);
